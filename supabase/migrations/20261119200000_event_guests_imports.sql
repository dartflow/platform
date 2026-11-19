begin;
-- A guest is an event-scoped scoring identity, never an authentication principal.
create table if not exists dartflow_private.event_guests(
 profile_id uuid primary key references dartflow_private.profiles(id)on delete cascade,
 entity_id uuid not null references dartflow_private.platform_entities(id)on delete cascade,
 name text not null check(length(btrim(name))between 1 and 80),created_by uuid not null references dartflow_private.profiles(id),
 created_at timestamptz not null default clock_timestamp(),unique(entity_id,profile_id)
);
create index if not exists event_guests_entity on dartflow_private.event_guests(entity_id,created_at,profile_id);
create table if not exists dartflow_private.participant_import_previews(
 id uuid primary key,entity_id uuid not null references dartflow_private.platform_entities(id)on delete cascade,
 actor_id uuid not null references dartflow_private.profiles(id)on delete cascade,base_revision integer not null,
 csv text not null check(octet_length(csv)<=65536),report jsonb not null,expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp()
);
create table if not exists dartflow_private.event_guest_claims(
 id uuid primary key,entity_id uuid not null references dartflow_private.platform_entities(id)on delete cascade,
 guest_id uuid not null references dartflow_private.event_guests(profile_id)on delete cascade,
 account_id uuid not null references dartflow_private.profiles(id)on delete cascade,proposed_by uuid not null references dartflow_private.profiles(id),
 reason text not null check(length(btrim(reason))between 1 and 1000),created_at timestamptz not null default clock_timestamp(),
 unique(id,entity_id,guest_id,account_id),check(guest_id<>account_id)
);
create index if not exists event_guest_claims_account on dartflow_private.event_guest_claims(account_id,created_at,id);
create table if not exists dartflow_private.event_guest_claim_decisions(
 claim_id uuid primary key,entity_id uuid not null,guest_id uuid not null,account_id uuid not null,
 actor_id uuid not null references dartflow_private.profiles(id)on delete cascade,decision text not null check(decision in('accept','decline')),
 reason text not null default '' check(length(reason)<=1000),created_at timestamptz not null default clock_timestamp(),
 foreign key(claim_id,entity_id,guest_id,account_id)references dartflow_private.event_guest_claims(id,entity_id,guest_id,account_id)on delete cascade,
 check(actor_id=account_id)
);
create unique index if not exists event_guest_one_history_owner on dartflow_private.event_guest_claim_decisions(guest_id)where decision='accept';
create unique index if not exists event_guest_one_identity_per_event on dartflow_private.event_guest_claim_decisions(entity_id,account_id)where decision='accept';
create table if not exists dartflow_private.organizer_participant_receipts(
 actor_id uuid not null references dartflow_private.profiles(id)on delete cascade,request_id uuid not null,payload_hash text not null,
 entity_id uuid not null references dartflow_private.platform_entities(id)on delete cascade,response jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(actor_id,request_id)
);
do $$declare t text;r text;begin
 foreach t in array array['event_guests','participant_import_previews','event_guest_claims','event_guest_claim_decisions','organizer_participant_receipts']loop
  execute format('alter table dartflow_private.%I enable row level security',t);
  execute format('revoke all on dartflow_private.%I from public',t);
  foreach r in array array['anon','authenticated','service_role']loop
   if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on dartflow_private.%I from %I',t,r);end if;
  end loop;
  execute format('drop policy if exists app_access on dartflow_private.%I',t);
  execute format('create policy app_access on dartflow_private.%I to dartflow_app using(true)with check(true)',t);
  execute format('grant select,insert on dartflow_private.%I to dartflow_app',t);
  execute format('revoke update,delete on dartflow_private.%I from dartflow_app',t);
 end loop;
end $$;
grant insert(display_name,display_name_confirmed,onboarding_complete)on dartflow_private.profiles to dartflow_app;
-- Only short-lived preview input is erased. Applied roster and sporting sources
-- are independent. Keep the request fingerprint and an explicit expiry receipt.
create or replace function dartflow_private.purge_expired_participant_previews(batch_size integer default 100)returns integer
language plpgsql security definer set search_path=pg_catalog,dartflow_private,pg_temp as $$
declare expired uuid[];removed integer;
begin
 select coalesce(array_agg(id),'{}'::uuid[])into expired from(select id from dartflow_private.participant_import_previews where expires_at<=clock_timestamp()order by expires_at,id limit least(500,greatest(1,coalesce(batch_size,100)))for update skip locked)batch;
 update dartflow_private.organizer_participant_receipts set response=(response-'preview')||jsonb_build_object('previewExpired',true)where response#>>'{preview,id}'=any(expired::text[]);
 insert into dartflow_private.platform_audit(actor_id,entity_id,action,detail)select actor_id,entity_id,'participants.preview.expired',jsonb_build_object('removed',count(*),'system',true)from dartflow_private.participant_import_previews where id=any(expired)group by actor_id,entity_id;
 delete from dartflow_private.participant_import_previews where id=any(expired);get diagnostics removed=row_count;
 return removed;
end $$;
revoke all on function dartflow_private.purge_expired_participant_previews(integer)from public,dartflow_privacy_worker;
grant execute on function dartflow_private.purge_expired_participant_previews(integer)to dartflow_app;
do $$declare r text;begin foreach r in array array['anon','authenticated','service_role']loop if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on function dartflow_private.purge_expired_participant_previews(integer)from %I',r);end if;end loop;end $$;
-- Extend the existing claimed erasure transaction by stable identity, without
-- granting the web role direct scrub or immutable-journal mutation privileges.
create or replace function dartflow_private.scrub_event_guest_claims(actor uuid)returns void
language plpgsql security definer set search_path=pg_catalog,dartflow_private,pg_temp as $$
declare guest uuid;col record;scope_ids uuid[];
begin
 if not exists(select 1 from dartflow_private.account_deletion_jobs where actor_id=actor and status='pending'and lease_token is not null and lease_until>clock_timestamp())then
  raise exception 'Unclaimed guest alias erasure'using errcode='42501';
 end if;
 select coalesce(array_agg(distinct entity_id),'{}'::uuid[])into scope_ids from(
  select entity_id from dartflow_private.event_guest_claim_decisions where account_id=actor and decision='accept'
  union select preview.entity_id from dartflow_private.participant_import_previews preview where preview.actor_id=actor or exists(select 1 from jsonb_array_elements(preview.report->'rows')r where r->>'playerId'=actor::text or exists(select 1 from dartflow_private.profiles p where p.id=actor and dartflow_private.username_key(r->>'username')=dartflow_private.username_key(p.name)))
 )scopes;
 -- Preview CSV has no participant IDs. It is temporary input, not a sporting
 -- source; remove the affected event previews instead of guessing by a name.
 delete from dartflow_private.participant_import_previews where entity_id=any(scope_ids)or actor_id=actor;
 delete from dartflow_private.organizer_participant_receipts where entity_id=any(scope_ids)or actor_id=actor;
 update dartflow_private.platform_audit set detail=jsonb_set(detail,'{reason}',to_jsonb('Verwijderd privacyverzoek'::text))where action in('guest.claim.propose','guest.claim.decide')and detail->>'claimId'in(select id::text from dartflow_private.event_guest_claims where account_id=actor);
 update dartflow_private.event_guest_claims set reason='Verwijderd privacyverzoek'where account_id=actor;
 update dartflow_private.event_guest_claim_decisions set reason='Verwijderd privacyverzoek'where account_id=actor;
 for guest in select guest_id from dartflow_private.event_guest_claim_decisions where account_id=actor and decision='accept'loop
  update dartflow_private.event_guests set name='Verwijderde speler'where profile_id=guest;
  update dartflow_private.profiles set name='removed-guest-'||guest::text,display_name='Verwijderde speler',display_name_confirmed=false,show_public_statistics=false,onboarding_complete=false,deletion_requested_at=coalesce(deletion_requested_at,clock_timestamp()),deleted_at=coalesce(deleted_at,clock_timestamp())where id=guest;
  delete from dartflow_private.mail_provider_events ev where ev.job_id in(select o.id from dartflow_private.mail_outbox o where exists(select 1 from dartflow_private.match_players p where p.match_id=o.entity_id and p.user_id=guest));
  delete from dartflow_private.mail_outbox o where exists(select 1 from dartflow_private.match_players p where p.match_id=o.entity_id and p.user_id=guest);
  update dartflow_private.board_score_events ev set visit=jsonb_set(visit,'{playerName}',to_jsonb('Verwijderde speler'::text))where exists(select 1 from dartflow_private.match_players p where p.match_id=ev.source_id and p.user_id=guest and p.position::text=ev.visit->>'playerIndex');
  for col in select c.table_name,c.column_name from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name where c.table_schema='dartflow_private'and c.data_type='jsonb'and t.table_type='BASE TABLE'loop
   execute format('update dartflow_private.%I set %I=dartflow_private.scrub_deleted_identity(%I,$1,$2)where position($2 in %I::text)>0',col.table_name,col.column_name,col.column_name,col.column_name)using '{}'::text[],guest::text;
  end loop;
 end loop;
end $$;
revoke all on function dartflow_private.scrub_event_guest_claims(uuid)from public,dartflow_app,dartflow_privacy_worker;
do $$declare r text;definition text;begin
 foreach r in array array['anon','authenticated','service_role']loop
  if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on function dartflow_private.scrub_event_guest_claims(uuid)from %I',r);end if;
 end loop;
 definition=pg_get_functiondef('dartflow_private.erase_account_job(uuid,uuid)'::regprocedure);
 if position('perform dartflow_private.scrub_event_guest_claims(a);'in definition)=0 then
  if position(' -- Remove credentials'in definition)=0 then raise exception 'Expected erasure integration anchor missing';end if;
  definition=replace(definition,' -- Remove credentials',' perform dartflow_private.scrub_event_guest_claims(a);'||chr(10)||' -- Remove credentials');execute definition;
 end if;
end $$;
insert into dartflow_private.feature_versions(name,version)values('event_guests_imports',1)on conflict(name)do update set version=excluded.version;
commit;
