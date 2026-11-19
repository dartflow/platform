begin;
-- Free-play participants are session-scoped identities, never Auth or club roles.
create table if not exists dartflow_private.play_sessions(
 id uuid primary key,event_id uuid references dartflow_private.events(id),owner_account_id uuid references dartflow_private.profiles(id),
 revision integer not null default 0 check(revision>=0),status text not null check(status in('active','interrupted','completed')),
 state jsonb not null check(jsonb_typeof(state)='object'),board_ids uuid[] not null default '{}',
 activity_at timestamptz not null default clock_timestamp(),deadline_at timestamptz,warning_epoch uuid not null,
 extensions_used integer not null default 0 check(extensions_used between 0 and 2),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create index if not exists play_sessions_board_ids on dartflow_private.play_sessions using gin(board_ids);
create index if not exists play_sessions_due on dartflow_private.play_sessions(deadline_at)where status='active';
create table if not exists dartflow_private.play_capabilities(
 id uuid primary key,session_id uuid not null references dartflow_private.play_sessions(id)on delete cascade,
 participant_id uuid,purpose text not null check(purpose in('controller','participant','claim','recovery')),
 token_hash text not null unique,key_version text not null,expires_at timestamptz,revoked_at timestamptz,
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists play_capabilities_session on dartflow_private.play_capabilities(session_id,purpose,participant_id);
create table if not exists dartflow_private.play_receipts(
 session_id uuid not null references dartflow_private.play_sessions(id)on delete cascade,actor_key text not null,
 request_id uuid not null,payload_hash text not null,action text not null,revision integer not null,
 response jsonb not null,state jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(session_id,actor_key,request_id)
);
create index if not exists play_receipts_revision on dartflow_private.play_receipts(session_id,revision);
create index if not exists play_receipts_request on dartflow_private.play_receipts(actor_key,request_id);
create table if not exists dartflow_private.play_retention_policy(
 singleton boolean primary key default true check(singleton),revision integer not null default 1,
 claim_days integer not null default 7 check(claim_days between 1 and 90),
 recovery_days integer not null default 7 check(recovery_days between 1 and 90)
);
insert into dartflow_private.play_retention_policy(singleton)values(true)on conflict do nothing;
do $$declare t text;r text;begin
 foreach t in array array['play_sessions','play_capabilities','play_receipts','play_retention_policy']loop
  execute format('alter table dartflow_private.%I enable row level security',t);
  execute format('revoke all on dartflow_private.%I from public',t);
  foreach r in array array['anon','authenticated','service_role']loop if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on dartflow_private.%I from %I',t,r);end if;end loop;
  execute format('drop policy if exists play_runtime on dartflow_private.%I',t);
  execute format('create policy play_runtime on dartflow_private.%I to dartflow_app using(true)with check(true)',t);
  execute format('grant select on dartflow_private.%I to dartflow_app',t);
 end loop;
end$$;
grant insert on dartflow_private.play_sessions,dartflow_private.play_capabilities,dartflow_private.play_receipts to dartflow_app;
grant update(revision,status,state,board_ids,event_id,activity_at,deadline_at,warning_epoch,extensions_used,updated_at)on dartflow_private.play_sessions to dartflow_app;
grant update(expires_at,revoked_at)on dartflow_private.play_capabilities to dartflow_app;
grant update(revision,claim_days,recovery_days)on dartflow_private.play_retention_policy to dartflow_app;
-- Privacy helpers are owner-only, invoked inside the existing claimed erasure.
create or replace function dartflow_private.scrub_play_account_fields(value jsonb,actor text)returns jsonb
language plpgsql immutable set search_path=pg_catalog,dartflow_private as $$
declare result jsonb;item record;
begin
 if jsonb_typeof(value)='object'then
  result='{}';for item in select key,val from jsonb_each(value)e(key,val)loop
   if item.key in('accountId','claimedBy')and item.val=to_jsonb(actor)then continue;end if;
   result=result||jsonb_build_object(item.key,dartflow_private.scrub_play_account_fields(item.val,actor));
  end loop;return result;
 elsif jsonb_typeof(value)='array'then select coalesce(jsonb_agg(dartflow_private.scrub_play_account_fields(v,actor)order by n),'[]')into result from jsonb_array_elements(value)with ordinality e(v,n);return result;
 end if;return value;
end$$;
revoke all on function dartflow_private.scrub_play_account_fields(jsonb,text)from public,dartflow_app;
create or replace function dartflow_private.scrub_play_account(actor uuid)returns void
language plpgsql security definer set search_path=pg_catalog,dartflow_private as $$
declare s record;participant_identity text;ids text[];clean jsonb;
begin
 if not exists(select 1 from dartflow_private.account_deletion_jobs where actor_id=actor and status='pending'and lease_token is not null and lease_until>clock_timestamp())then raise exception 'Unclaimed play erasure'using errcode='42501';end if;
 for s in select id,state,owner_account_id from dartflow_private.play_sessions where owner_account_id=actor or exists(select 1 from jsonb_array_elements(state->'participants')p where p->>'accountId'=actor::text or p->>'claimedBy'=actor::text)loop
  select coalesce(array_agg(p->>'id'),'{}')into ids from jsonb_array_elements(s.state->'participants')p where p->>'accountId'=actor::text or p->>'claimedBy'=actor::text;
  -- A play participant uses its own stable UUID even after an account claim.
  -- Remove that actor's label from another user's private challenge copy too.
  if to_regclass('dartflow_private.play_leg_challenges')is not null then
   execute 'update dartflow_private.play_leg_challenges set source_name=''Verwijderde speler'',revoked_at=coalesce(revoked_at,clock_timestamp()),source=jsonb_set(source,''{valid}'',''false''::jsonb)where source_kind=''play''and source_id=$1 and source_player_id=any($2)'using s.id,ids;
  end if;
  clean=s.state;foreach participant_identity in array ids loop clean=dartflow_private.scrub_deleted_identity(clean,'{}',participant_identity);update dartflow_private.play_receipts set state=dartflow_private.scrub_deleted_identity(state,'{}',participant_identity),response=dartflow_private.scrub_deleted_identity(response,'{}',participant_identity)where session_id=s.id;end loop;
  update dartflow_private.play_sessions set state=dartflow_private.scrub_play_account_fields(clean,actor::text),owner_account_id=case when owner_account_id=actor then null else owner_account_id end where id=s.id;
  update dartflow_private.play_receipts set state=dartflow_private.scrub_play_account_fields(state,actor::text),response=dartflow_private.scrub_play_account_fields(response,actor::text),actor_key=case when actor_key='account:'||actor::text then 'erased:'||md5(actor::text)else actor_key end where session_id=s.id;
  delete from dartflow_private.play_capabilities where session_id=s.id and(participant_id::text=any(ids)or(s.owner_account_id=actor and purpose='controller'));
 end loop;
end$$;
revoke all on function dartflow_private.scrub_play_account(uuid)from public,dartflow_app,dartflow_privacy_worker;
create or replace function dartflow_private.purge_expired_play_access(batch_size integer default 100)returns integer
language plpgsql security definer set search_path=pg_catalog,dartflow_private as $$
declare s record;p record;clean jsonb;total integer=0;
begin
 for s in select id,state from dartflow_private.play_sessions where status in('interrupted','completed')and coalesce((state->>'claimExpiresAt')::timestamptz,(state->>'recoverExpiresAt')::timestamptz)<=clock_timestamp()and coalesce(state->>'guestDataAnonymized','false')<>'true'order by updated_at limit least(500,greatest(1,coalesce(batch_size,100)))for update skip locked loop
  clean=s.state;for p in select value,ordinality from jsonb_array_elements(s.state->'participants')with ordinality loop
   if p.value->>'accountId'is null and p.value->>'claimedBy'is null then
    clean=dartflow_private.scrub_deleted_identity(clean,'{}',p.value->>'id');
    update dartflow_private.play_receipts set state=dartflow_private.scrub_deleted_identity(state,'{}',p.value->>'id'),response=dartflow_private.scrub_deleted_identity(response,'{}',p.value->>'id')where session_id=s.id;
   end if;
  end loop;
  update dartflow_private.play_sessions set state=jsonb_set(clean,'{guestDataAnonymized}','true')where id=s.id;
  delete from dartflow_private.play_capabilities where session_id=s.id and expires_at<=clock_timestamp();total=total+1;
 end loop;return total;
end$$;
revoke all on function dartflow_private.purge_expired_play_access(integer)from public,dartflow_privacy_worker;
grant execute on function dartflow_private.purge_expired_play_access(integer)to dartflow_app;
do $$declare r text;definition text;begin
 foreach r in array array['anon','authenticated','service_role']loop if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on function dartflow_private.scrub_play_account_fields(jsonb,text),dartflow_private.scrub_play_account(uuid),dartflow_private.purge_expired_play_access(integer)from %I',r);end if;end loop;
 definition=pg_get_functiondef('dartflow_private.erase_account_job(uuid,uuid)'::regprocedure);
 if position('perform dartflow_private.scrub_play_account(a);'in definition)=0 then
  if position(' -- Remove credentials'in definition)=0 then raise exception 'Expected play erasure integration anchor missing';end if;
  definition=replace(definition,' -- Remove credentials',' perform dartflow_private.scrub_play_account(a);'||chr(10)||' -- Remove credentials');execute definition;
 end if;
end$$;
-- A validated offline queue can project beyond the accepted revision; its
-- first proved base remains strictly older than the canonical scorecard.
alter table dartflow_private.match_offline_conflicts add column if not exists queue_base_revision integer;
alter table dartflow_private.match_offline_conflicts drop constraint if exists match_offline_conflicts_check;
do $$begin if not exists(select 1 from pg_constraint where conrelid='dartflow_private.match_offline_conflicts'::regclass and conname='offline_queue_base_valid')then
 alter table dartflow_private.match_offline_conflicts add constraint offline_queue_base_valid check(expected_revision>=0 and canonical_revision>coalesce(queue_base_revision,expected_revision)and(queue_base_revision is null or(queue_base_revision>=0 and expected_revision>=queue_base_revision and expected_revision<queue_base_revision+100)));
end if;end$$;
insert into dartflow_private.feature_versions(name,version)values('resumable_guest_play_sessions',1)on conflict(name)do update set version=excluded.version;
commit;
