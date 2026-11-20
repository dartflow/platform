-- Generated with Supabase CLI 3.2.0. Preserve account IDs and sports relations.
begin;
lock table dartflow_private.profiles in share row exclusive mode;
alter table dartflow_private.profiles add column if not exists full_name text;
alter table dartflow_private.profiles add column if not exists username_locked_at timestamptz;
alter table dartflow_private.profiles add column if not exists identity_needs_review boolean not null default false;
create table if not exists dartflow_private.profile_identity_migration_audit(
 profile_id uuid primary key references dartflow_private.profiles(id)on delete cascade,
 old_username text,old_display_name text,decision text not null,created_at timestamptz not null default clock_timestamp()
);
alter table dartflow_private.profile_identity_migration_audit enable row level security;
revoke all on dartflow_private.profile_identity_migration_audit from public;
-- The old generated Unicode-17 character ranges stay authoritative on older ICU.
do $$begin
 if to_regprocedure('dartflow_private.username_characters_valid(text)')is null then
  execute replace(pg_get_functiondef('dartflow_private.valid_username(text)'::regprocedure),'FUNCTION dartflow_private.valid_username(', 'FUNCTION dartflow_private.username_characters_valid(');
 end if;
end$$;
create or replace function dartflow_private.normalize_username(value text)returns text
language sql immutable strict parallel safe set search_path=pg_catalog as $$
 select case when left(n,1)='@'then substring(n from 2)else n end from(select normalize(value,NFKC)n)s
$$;
create or replace function dartflow_private.valid_username(value text)returns boolean
language sql immutable strict parallel safe set search_path=pg_catalog,dartflow_private as $$
 select value!~forbidden and n!~forbidden and left(n,1)<>'@'and dartflow_private.username_characters_valid(n)
 from(select dartflow_private.normalize_username(value)n,U&'[\0001-\0020\007F-\00A0\00AD\034F\0600-\0605\061C\06DD\070F\0890-\0891\08E2\115F-\1160\1680\17B4-\17B5\180B-\180F\2000-\200F\2028-\202F\205F-\206F\3000\3164\FE00-\FE0F\FEFF\FFA0\FFF0-\FFFB\+0110BD\+0110CD\+013430-\+01343F\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0000-\+0E0FFF]'forbidden)s
$$;
-- Verified provider personal metadata stays private; never infer a public display name.
do $$begin if to_regclass('auth.users')is not null then
 execute $sql$update dartflow_private.profiles p set full_name=left(nullif(btrim(regexp_replace(normalize(coalesce(nullif(u.raw_user_meta_data->>'full_name',''),nullif(u.raw_user_meta_data->>'name','')),NFC),'[[:cntrl:]]','','g')),''),160)from auth.users u where u.id=p.id and p.full_name is null and p.deleted_at is null$sql$;
end if;end$$;
-- Rebuild after normalization changes; never choose an arbitrary collision winner.
drop index if exists dartflow_private.profiles_unique_confirmed_username;
drop trigger if exists profiles_normalize_username on dartflow_private.profiles;
insert into dartflow_private.profile_identity_migration_audit(profile_id,old_username,old_display_name,decision)
 select id,name,display_name,case when display_name_confirmed and dartflow_private.valid_username(name)and not exists(
 select 1 from dartflow_private.profiles other where other.id<>p.id and other.display_name_confirmed and dartflow_private.username_key(other.name)=dartflow_private.username_key(p.name))then 'retained_canonical_claim'else 'owner_review_required'end
 from dartflow_private.profiles p where username_locked_at is null and deleted_at is null
 on conflict(profile_id)do nothing;
update dartflow_private.profiles p set
 full_name=case when full_name is not null then full_name when a.decision='owner_review_required'and name<>'Nieuwe speler'and(display_name is null or display_name=name)then name else null end,
 display_name=case when a.decision='owner_review_required'and display_name=name then null else nullif(display_name,'')end,
 name=case when a.decision='retained_canonical_claim'then dartflow_private.username_key(name)else 'Nieuwe speler'end,
 display_name_confirmed=a.decision='retained_canonical_claim',
 username_locked_at=case when a.decision='retained_canonical_claim'then clock_timestamp()else null end,
 identity_needs_review=a.decision='owner_review_required'
 from dartflow_private.profile_identity_migration_audit a where a.profile_id=p.id and p.username_locked_at is null and p.deleted_at is null;
create unique index profiles_unique_confirmed_username on dartflow_private.profiles(dartflow_private.username_key(name))where display_name_confirmed;
create or replace function dartflow_private.normalize_profile_username()returns trigger
language plpgsql security invoker set search_path=pg_catalog,dartflow_private as $$
begin
 -- Existing owner-only erasure may retire a claim, never reassign it to a player.
 if tg_op='UPDATE'and new.deleted_at is not null and old.deleted_at is null and current_user<>'dartflow_app'then
  new.full_name=null;new.username_locked_at=null;new.identity_needs_review=false;
  update dartflow_private.profile_identity_migration_audit set old_username=null,old_display_name=null where profile_id=old.id;
  return new;
 end if;
 if tg_op='UPDATE'and old.username_locked_at is not null then
  if not new.display_name_confirmed or not dartflow_private.valid_username(new.name)or dartflow_private.username_key(new.name)<>old.name
   or new.username_locked_at is distinct from old.username_locked_at then
   raise exception 'username_locked'using errcode='23514',constraint='profiles_username_immutable';
  end if;
  new.name=old.name;return new;
 end if;
 if new.display_name_confirmed then
  if not dartflow_private.valid_username(new.name)then raise exception 'invalid_username'using errcode='23514',constraint='profiles_valid_username';end if;
  new.name=dartflow_private.username_key(new.name);new.username_locked_at=clock_timestamp();
 else
  new.username_locked_at=null;
 end if;
 return new;
end$$;
create trigger profiles_normalize_username before insert or update of name,display_name_confirmed,username_locked_at,deleted_at on dartflow_private.profiles for each row execute function dartflow_private.normalize_profile_username();
create or replace view dartflow_private.profile_labels with(security_invoker=true)as
 select id,coalesce(nullif(display_name,''),case when display_name_confirmed then name end,'Speler')as name,
 case when display_name_confirmed then name end as username,display_name,email,email_verified,display_name_confirmed,show_public_statistics,onboarding_complete from dartflow_private.profiles;
revoke all on dartflow_private.profile_labels from public;
grant select on dartflow_private.profile_labels to dartflow_app;
grant select(full_name,username_locked_at,identity_needs_review),insert(full_name,display_name),update(full_name,identity_needs_review)on dartflow_private.profiles to dartflow_app;
revoke all on function dartflow_private.username_characters_valid(text)from public;
grant execute on function dartflow_private.username_characters_valid(text)to dartflow_app;
do $$declare r text;begin foreach r in array array['anon','authenticated','service_role']loop if exists(select 1 from pg_roles where rolname=r)then
 execute format('revoke all on dartflow_private.profile_identity_migration_audit,dartflow_private.profile_labels from %I',r);
 execute format('revoke all on function dartflow_private.username_characters_valid(text),dartflow_private.normalize_username(text),dartflow_private.valid_username(text),dartflow_private.normalize_profile_username()from %I',r);
 end if;end loop;end$$;
-- Rendered social copies must not retain an erased actor at another recipient.
create or replace function dartflow_private.scrub_social_identity_mail(actor uuid)returns void
language plpgsql security definer set search_path=pg_catalog,dartflow_private as $$
declare ids uuid[];
begin
 select coalesce(array_agg(o.id),'{}'::uuid[])into ids from dartflow_private.mail_outbox o where
  o.snapshot#>>'{renderContext,actorId}'=actor::text or o.snapshot#>>'{renderContext,opponentId}'=actor::text
  or exists(select 1 from dartflow_private.mail_events e where e.environment=o.environment and e.scope_key=o.scope_key and e.event_id=o.event_id and e.template_id=o.template_id and e.recipient_key=o.recipient_key and e.actor_id=actor)
  or(o.recipient_key like 'user:%' and exists(select 1 from dartflow_private.platform_audit a where a.actor_id=actor and (
   (o.template_id in('friend-request','friend-accepted','room-invite')
    and a.action=case o.template_id when 'friend-request' then 'friend.request' when 'friend-accepted' then 'friend.accept' else 'room.invite' end
    and o.event_id='platform:'||(a.detail->>'requestId')||':'||o.template_id||':'||substr(o.recipient_key,6))
   or(o.template_id in('challenge-invite','challenge-accepted','challenge-cancelled')
    and ((o.template_id='challenge-invite' and a.action in('lobby.create','board.start'))
      or(o.template_id='challenge-accepted' and a.action in('lobby.join','board.join'))
      or(o.template_id='challenge-cancelled' and a.action='lobby.cancel'))
    and o.event_id=(a.detail->>'requestId')||':'||o.template_id||':'||substr(o.recipient_key,6))
  )));
 delete from dartflow_private.mail_provider_events where job_id=any(ids);
 delete from dartflow_private.mail_outbox where id=any(ids);
 if to_regclass('dartflow_private.native_push_inbox')is not null then
  delete from dartflow_private.native_push_inbox where reference->>'actorId'=actor::text or reference->>'opponentId'=actor::text;
 end if;
end$$;
revoke all on function dartflow_private.scrub_social_identity_mail(uuid)from public,dartflow_app;
do $$declare r text;definition text;begin
 foreach r in array array['anon','authenticated','service_role']loop if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on function dartflow_private.scrub_social_identity_mail(uuid)from %I',r);end if;end loop;
 if to_regprocedure('dartflow_private.erase_account_job(uuid,uuid)')is not null then
  definition=pg_get_functiondef('dartflow_private.erase_account_job(uuid,uuid)'::regprocedure);
  if position('perform dartflow_private.scrub_social_identity_mail(a);'in definition)=0 then
   if position(' -- Remove credentials'in definition)=0 then raise exception 'Expected account erasure integration anchor missing';end if;
   definition=replace(definition,' -- Remove credentials',' perform dartflow_private.scrub_social_identity_mail(a);'||chr(10)||' -- Remove credentials');execute definition;
  end if;
 end if;
 if to_regprocedure('dartflow_private.scrub_deleted_identity(jsonb,text[],text)')is not null then
  definition=pg_get_functiondef('dartflow_private.scrub_deleted_identity(jsonb,text[],text)'::regprocedure);
  definition=replace(definition,'''full_name'',''playerName''','''full_name'',''fullName'',''playerName''');execute definition;
 end if;
end$$;
update dartflow_private.profiles set full_name=null,identity_needs_review=false where deleted_at is not null;
update dartflow_private.profile_identity_migration_audit set old_username=null,old_display_name=null where exists(select 1 from dartflow_private.profiles p where p.id=profile_id and p.deleted_at is not null);
insert into dartflow_private.feature_versions(name,version)values('immutable_private_identity',1)on conflict(name)do update set version=excluded.version;
commit;
