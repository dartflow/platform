begin;
lock table dartflow_private.profiles in share row exclusive mode;
alter table dartflow_private.profiles add column if not exists display_name text;
alter table dartflow_private.profiles add column if not exists show_public_statistics boolean not null default false;
alter table dartflow_private.profiles add column if not exists onboarding_complete boolean not null default true;
update dartflow_private.profiles set display_name=name where display_name is null and onboarding_complete;
drop index if exists dartflow_private.profiles_unique_confirmed_username;
create or replace function dartflow_private.normalize_username(value text) returns text
language sql immutable strict parallel safe set search_path=pg_catalog as $$
 select case when left(n,1)='@' then btrim(substring(n from 2)) else n end
 from (select btrim(regexp_replace(normalize(value,NFC),U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g')) n) cleaned
$$;
-- Keep legacy identities and visible labels. Conflicting claims return to onboarding.
update dartflow_private.profiles p set display_name_confirmed=false
where p.display_name_confirmed and (
 not dartflow_private.valid_username(p.name) or left(dartflow_private.normalize_username(p.name),1)='@'
 or exists(select 1 from dartflow_private.profiles other where other.id<>p.id and other.display_name_confirmed
  and dartflow_private.username_key(other.name)=dartflow_private.username_key(p.name))
);
update dartflow_private.profiles set name=dartflow_private.normalize_username(name)
 where display_name_confirmed and name is distinct from dartflow_private.normalize_username(name);
create unique index profiles_unique_confirmed_username
 on dartflow_private.profiles(dartflow_private.username_key(name)) where display_name_confirmed;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='dartflow_private.profiles'::regclass and conname='profiles_confirmed_username_canonical') then
  alter table dartflow_private.profiles add constraint profiles_confirmed_username_canonical
   check(not display_name_confirmed or(name=dartflow_private.normalize_username(name) and left(name,1)<>'@'));
 end if;
end $$;
create or replace view dartflow_private.profile_labels with(security_invoker=true) as
 select id,coalesce(nullif(display_name,''),name) as name,name as username,display_name,email,email_verified,
 display_name_confirmed,show_public_statistics,onboarding_complete from dartflow_private.profiles;
revoke all on dartflow_private.profile_labels from public;
grant select on dartflow_private.profile_labels to dartflow_app;
grant update(display_name,show_public_statistics,onboarding_complete) on dartflow_private.profiles to dartflow_app;
grant insert(onboarding_complete) on dartflow_private.profiles to dartflow_app;
create table if not exists dartflow_private.profile_setup_receipts (
 actor_id uuid not null references dartflow_private.profiles(id) on delete cascade,
 request_id uuid not null,fingerprint text not null,created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,request_id)
);
alter table dartflow_private.profile_setup_receipts enable row level security;
revoke all on dartflow_private.profile_setup_receipts from public;
do $$ declare role_name text; begin
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if exists(select 1 from pg_roles where rolname=role_name) then
   execute format('revoke all on dartflow_private.profile_labels,dartflow_private.profile_setup_receipts from %I',role_name);
  end if;
 end loop;
end $$;
drop policy if exists app_access on dartflow_private.profile_setup_receipts;
create policy app_access on dartflow_private.profile_setup_receipts to dartflow_app using(true) with check(true);
grant select,insert on dartflow_private.profile_setup_receipts to dartflow_app;
insert into dartflow_private.feature_versions(name,version) values('player_profile_identity',1)
 on conflict(name) do update set version=excluded.version;
commit;
