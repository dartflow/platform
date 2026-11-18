-- Privacy processing is isolated from the web role. Install as the migration owner.
begin;
alter table dartflow_private.profiles add column if not exists deletion_requested_at timestamptz;
alter table dartflow_private.profiles add column if not exists deleted_at timestamptz;
grant update(deletion_requested_at) on dartflow_private.profiles to dartflow_app;
create table if not exists dartflow_private.account_deletion_jobs(
 id uuid primary key,actor_id uuid not null unique references dartflow_private.profiles,
 request_id uuid not null,requested_at timestamptz not null default clock_timestamp(),
 status text not null default 'pending' check(status in('pending','app_erased','completed')),
 app_erased_at timestamptz,completed_at timestamptz,
 attempts integer not null default 0,available_at timestamptz not null default clock_timestamp(),
 lease_token uuid,lease_until timestamptz,last_error_code text,
 unique(actor_id,request_id)
);
create index if not exists account_deletion_due on dartflow_private.account_deletion_jobs(available_at,id) where status<>'completed';
alter table dartflow_private.account_deletion_jobs enable row level security;
revoke all on dartflow_private.account_deletion_jobs from public;
do $$ declare r text;begin
 foreach r in array array['anon','authenticated','service_role'] loop
  if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on dartflow_private.account_deletion_jobs from %I',r);end if;
 end loop;
 if not exists(select 1 from pg_roles where rolname='dartflow_privacy_worker') then
  create role dartflow_privacy_worker login nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
 end if;
end $$;
grant usage on schema dartflow_private to dartflow_privacy_worker;
grant select,insert on dartflow_private.account_deletion_jobs to dartflow_app;
revoke update on dartflow_private.account_deletion_jobs from dartflow_privacy_worker;
grant select on dartflow_private.account_deletion_jobs to dartflow_privacy_worker;
grant update(status,app_erased_at,completed_at,attempts,available_at,lease_token,lease_until,last_error_code) on dartflow_private.account_deletion_jobs to dartflow_privacy_worker;
drop policy if exists app_requests on dartflow_private.account_deletion_jobs;
create policy app_requests on dartflow_private.account_deletion_jobs to dartflow_app using(true) with check(true);
drop policy if exists privacy_processing on dartflow_private.account_deletion_jobs;
create policy privacy_processing on dartflow_private.account_deletion_jobs to dartflow_privacy_worker using(true) with check(true);

-- Runtime may request erasure once, but cannot clear the tombstone or recreate PII.
create or replace function dartflow_private.guard_deleted_profile() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_user='dartflow_app' and(old.deletion_requested_at is not null or old.deleted_at is not null) then
  raise exception 'Account is being deleted' using errcode='42501';
 end if;
 return new;
end $$;
drop trigger if exists prevent_profile_resurrection on dartflow_private.profiles;
create trigger prevent_profile_resurrection before update on dartflow_private.profiles for each row execute function dartflow_private.guard_deleted_profile();
revoke all on function dartflow_private.guard_deleted_profile() from public;

-- Recursively remove identity labels from denormalized match/result/receipt JSON.
-- IDs stay stable to preserve bracket/result integrity; their profile is a tombstone.
create or replace function dartflow_private.scrub_deleted_identity(value jsonb,labels text[],actor text) returns jsonb
language plpgsql immutable set search_path=pg_catalog,dartflow_private as $$
declare result jsonb;item record;label text;s text;own_identity boolean;
begin
 if value is null then return null;end if;
 if jsonb_typeof(value)='object' then
  result='{}'::jsonb;
  own_identity=(value->>'id'=actor or value->>'userId'=actor or value->>'playerId'=actor or value->>'profileId'=actor);
  for item in select key,val from jsonb_each(value) e(key,val) loop
   if own_identity and item.key in('name','displayName','display_name','username','full_name') then
    result=result||jsonb_build_object(item.key,'Verwijderde speler');
   elsif own_identity and item.key in('email','avatar','avatarUrl','avatar_url','picture','phone') then
    result=result||jsonb_build_object(item.key,null);
   else
    result=result||jsonb_build_object(item.key,dartflow_private.scrub_deleted_identity(item.val,labels,actor));
   end if;
  end loop;
  return result;
 elsif jsonb_typeof(value)='array' then
  select coalesce(jsonb_agg(dartflow_private.scrub_deleted_identity(v,labels,actor) order by ord),'[]'::jsonb) into result from jsonb_array_elements(value) with ordinality e(v,ord);return result;
 elsif jsonb_typeof(value)='string' then
  s=value#>>'{}';
  foreach label in array labels loop
   if label is not null and length(label)>=3 then s=replace(s,label,'Verwijderde speler');end if;
  end loop;
  return to_jsonb(s);
 end if;
 return value;
end $$;
revoke all on function dartflow_private.scrub_deleted_identity(jsonb,text[],text) from public;

-- Narrow privileged operation: only the separate worker can call it, and only for
-- a durable, user-confirmed job claimed with the exact current unexpired lease.
-- The app has NO EXECUTE privilege and no direct cleanup/admin database credential.
create or replace function dartflow_private.erase_account_job(job_id uuid,claim uuid) returns void
language plpgsql security definer set search_path=pg_catalog,dartflow_private,pg_temp as $$
declare job dartflow_private.account_deletion_jobs%rowtype;p dartflow_private.profiles%rowtype;col record;labels text[];a uuid;
begin
 select * into job from dartflow_private.account_deletion_jobs where id=job_id for update;
 if not found or job.status<>'pending' or claim is null or job.lease_token is null or job.lease_until is null or job.lease_token is distinct from claim or job.lease_until<=clock_timestamp() then
  raise exception 'Unclaimed erasure job' using errcode='42501';
 end if;
 a=job.actor_id;
 select * into p from dartflow_private.profiles where id=a for update;
 if not found or p.deletion_requested_at is null then raise exception 'Missing confirmed tombstone' using errcode='42501';end if;
 labels=array[p.email,p.name,p.display_name];

 -- Detach physical assignments. Official progress is retained and interrupted.
 update dartflow_private.matches m set board_id=null,revision=revision+1,updated_at=clock_timestamp(),
 state=jsonb_set(jsonb_set(jsonb_set(m.state,'{boardId}','null'),'{paused}','true'),'{status}',to_jsonb(case when exists(select 1 from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id where l.match_id=m.id and e.kind in('league','tournament')) then 'interrupted'::text else 'abandoned'::text end))
 where exists(select 1 from dartflow_private.match_players mp where mp.match_id=m.id and mp.user_id=a)
 and m.state->>'status' not in('confirmed','abandoned') and not exists(select 1 from dartflow_private.match_results r where r.match_id=m.id);
 delete from dartflow_private.board_activity_links where session_id in(select id from dartflow_private.board_activity_sessions where a=any(actor_ids));
 update dartflow_private.board_activity_sessions set status=case when kind='official' then 'interrupted' else 'released' end,ended_at=coalesce(ended_at,clock_timestamp()),reason='account-deletion' where a=any(actor_ids) and status in('active','completed');
 update dartflow_private.platform_entities set state=jsonb_build_object('name','Verwijderde sessie','closed',true,'completed',true,'discarded',true,'boardHeld',false,'boardLeaseUntil',0),invite_hash=null,invite_expires_at=clock_timestamp(),revision=revision+1 where owner_id=a and kind in('training','lobby');
 delete from dartflow_private.invitation_codes where entity_id in(select id from dartflow_private.platform_entities where owner_id=a);

 -- Remove credentials, identity/contact data, relationships and authored content.
 if to_regclass('dartflow_private.play_review_accounts') is not null then
  delete from dartflow_private.play_review_accounts where user_id=a;
  update dartflow_private.play_review_accounts set review_details=null,companion_user_id=null where companion_user_id=a;
 end if;
 delete from dartflow_private.player_pin_verifiers where user_id=a;
 delete from dartflow_private.player_pin_receipts where actor_id=a or target_id=a;
 delete from dartflow_private.season_pin_receipts where actor_id=a or target_id=a;
 delete from dartflow_private.platform_relationships where source_id=a or target_id=a;
 delete from dartflow_private.platform_preferences where user_id=a;
 delete from dartflow_private.player_experience where user_id=a;
 delete from dartflow_private.feed_preferences where user_id=a;
 delete from dartflow_private.mail_preferences where user_id=a;
 delete from dartflow_private.profile_setup_receipts where actor_id=a;
 delete from dartflow_private.platform_receipts where actor_id=a;
 delete from dartflow_private.action_receipts where actor_id=a;
 delete from dartflow_private.feed_receipts where actor_id=a;
 delete from dartflow_private.season_receipts where actor_id=a;
 delete from dartflow_private.platform_signals where sender_id=a or target_id=a;
 delete from dartflow_private.feed_replies where author_id=a;
 delete from dartflow_private.feed_likes where user_id=a;
 delete from dartflow_private.community_likes where user_id=a;
 update dartflow_private.feed_items set title='',body='',deleted=true,pin_until=null where author_id=a;
 update dartflow_private.community_posts set body='Verwijderd',deleted=true where author_id=a;
 update dartflow_private.community_messages set body='Verwijderd',deleted=true where author_id=a;
 update dartflow_private.community_messages set body='Oche Live: een officiële partij is onderbroken na een accountverwijdering. De wedstrijdleiding handelt het vervolg af.'
 where body like 'Oche Live:%' and scope_id in(select ml.entity_id from dartflow_private.platform_match_links ml join dartflow_private.match_players mp on mp.match_id=ml.match_id where mp.user_id=a);
 update dartflow_private.platform_messages set body='Verwijderd',deleted=true where author_id=a;
 update dartflow_private.feed_shares set revoked_at=coalesce(revoked_at,clock_timestamp()) where created_by=a;
 update dartflow_private.platform_reports set reason='Verwijderd privacyverzoek' where reporter_id=a or target_id=a;
 -- A club's non-login tombstone owner row must remain if it is the last owner;
 -- otherwise its existing DB invariant would make deleting an account impossible.
 -- It has no PII and can never authenticate. Other memberships are removed.
 delete from dartflow_private.platform_members m where m.user_id=a and not exists(select 1 from dartflow_private.platform_entities e where e.id=m.entity_id and e.kind='club' and e.owner_id=a);
 update dartflow_private.platform_members set attributes='{}'::jsonb where user_id=a;
 delete from dartflow_private.event_staff where user_id=a;
 delete from dartflow_private.club_memberships where user_id=a;
 delete from dartflow_private.location_members where user_id=a;
 delete from dartflow_private.season_representations where user_id=a;
 delete from dartflow_private.platform_roles where user_id=a;
 if to_regclass('dartflow_private.play_review_accounts') is not null then
  execute 'delete from dartflow_private.play_review_accounts where user_id=$1' using a;
 end if;
 delete from dartflow_private.club_join_requests where user_id=a;
 delete from dartflow_private.club_invites where user_id=a;
 delete from dartflow_private.platform_registrations where user_id=a;
 update dartflow_private.entries set status='withdrawn',checked_in=false where user_id=a;
 update dartflow_private.screen_capabilities set revoked_at=coalesce(revoked_at,clock_timestamp()) where created_by=a;
 update dartflow_private.platform_cast_grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where created_by=a;
 update dartflow_private.board_screen_devices set revoked_at=coalesce(revoked_at,clock_timestamp()),pairing_hash=null where created_by=a;
 delete from dartflow_private.oche_device_credentials where device_id in(select id from dartflow_private.oche_devices where owner_id=a or created_by=a);
 update dartflow_private.oche_devices set revoked_at=coalesce(revoked_at,clock_timestamp()),name='Ontkoppeld scherm' where owner_id=a or created_by=a;
 update dartflow_private.oche_installations set state='revoked',code_hash=null,code_cipher=null where id in(select installation_id from dartflow_private.oche_devices where owner_id=a or created_by=a);
 update dartflow_private.oche_reservations set state='cancelled',name='Verwijderde reservering' where owner_id=a or created_by=a;
 delete from dartflow_private.oche_device_receipts where principal=a::text;
 delete from dartflow_private.oche_home_selections where owner_id=a;
 update dartflow_private.blog_tokens set revoked_at=coalesce(revoked_at,clock_timestamp()) where created_by=a;
 delete from dartflow_private.mail_provider_events ev where ev.job_id in(select id from dartflow_private.mail_outbox where recipient_id=a or recipient_key='user:'||a::text or (p.email is not null and recipient=p.email));
 delete from dartflow_private.mail_outbox where recipient_id=a or recipient_key='user:'||a::text or (p.email is not null and recipient=p.email);
 delete from dartflow_private.mail_events where recipient_key='user:'||a::text or recipient_key=p.email;
 delete from dartflow_private.mail_suppressions where recipient_key='user:'||a::text or recipient_key=p.email;
 update dartflow_private.owner_bootstrap set email='removed-'||a::text||'@invalid.dartflow.nl' where consumed_by=a or email=p.email;

 -- Animation events deliberately contain no actor ID. Resolve their playerIndex
 -- through the stable match participant relation, including previous usernames.
 update dartflow_private.board_score_events e set visit=jsonb_set(e.visit,'{playerName}',to_jsonb('Verwijderde speler'::text))
 from dartflow_private.match_players mp where mp.match_id=e.source_id and mp.user_id=a
 and e.visit->'playerIndex'=to_jsonb(mp.position);
 -- Training animation caches belong to the owner's discarded private session.
 delete from dartflow_private.board_score_events e where exists(select 1 from dartflow_private.platform_entities pe where pe.id=e.source_id and pe.owner_id=a and pe.kind='training');

 -- Scrub denormalized labels in all private JSON records, including results,
 -- invitations, audits, fixtures, caches and outbox messages addressed to others.
 for col in select c.table_name,c.column_name from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name where c.table_schema='dartflow_private' and c.data_type='jsonb' and t.table_type='BASE TABLE' and c.table_name<>'club_join_requests' loop
  execute format('update dartflow_private.%I set %I=dartflow_private.scrub_deleted_identity(%I,$1,$2) where position($2 in %I::text)>0 or($3 is not null and position($3 in %I::text)>0)',col.table_name,col.column_name,col.column_name,col.column_name,col.column_name) using labels,a::text,p.email;
 end loop;
 update dartflow_private.profiles set name='Verwijderde speler',display_name='Verwijderde speler',email=null,email_verified=false,display_name_confirmed=false,show_public_statistics=false,onboarding_complete=false,deleted_at=clock_timestamp() where id=a;
 update dartflow_private.account_deletion_jobs set status='app_erased',app_erased_at=clock_timestamp(),last_error_code=null where id=job.id;
 -- Run deferred ownership invariants before leaving the privileged operation;
 -- the isolated worker intentionally has no general SELECT on club/member tables.
 set constraints all immediate;
end $$;
revoke all on function dartflow_private.erase_account_job(uuid,uuid) from public,dartflow_app;
grant execute on function dartflow_private.erase_account_job(uuid,uuid) to dartflow_privacy_worker;
insert into dartflow_private.feature_versions(name,version) values('account_deletion',2) on conflict(name) do update set version=excluded.version;
commit;
