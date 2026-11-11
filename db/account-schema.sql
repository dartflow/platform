-- Additive v15 account support. Existing profile IDs and core schema version remain valid.
begin;
alter table dartflow_private.profiles add column if not exists email text;
alter table dartflow_private.profiles add column if not exists email_verified boolean not null default false;
create table if not exists dartflow_private.platform_roles (
  user_id uuid primary key references dartflow_private.profiles,
  role text not null check(role in ('owner','admin')),
  granted_at timestamptz not null default now()
);
create table if not exists dartflow_private.feature_versions (
  name text primary key,
  version integer not null check(version>0)
);
alter table dartflow_private.platform_roles enable row level security;
alter table dartflow_private.feature_versions enable row level security;
do $$ declare t text; begin
  foreach t in array array['platform_roles','feature_versions'] loop
    if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename=t and policyname='server_runtime') then
      execute format('create policy server_runtime on dartflow_private.%I for select to dartflow_app using (true)',t);
    end if;
  end loop;
end $$;
grant select on dartflow_private.platform_roles,dartflow_private.feature_versions to dartflow_app;
revoke insert,update,delete on dartflow_private.platform_roles,dartflow_private.feature_versions from dartflow_app;
grant insert(id,name,email,email_verified),update(name,email,email_verified) on dartflow_private.profiles to dartflow_app;
-- Public Auth identity is verified in server code; metadata never grants a platform role.
create table if not exists dartflow_private.owner_bootstrap (
  email text primary key,
  consumed_by uuid references dartflow_private.profiles,
  consumed_at timestamptz
);
alter table dartflow_private.owner_bootstrap enable row level security;
revoke all on dartflow_private.owner_bootstrap from public,dartflow_app;
insert into dartflow_private.owner_bootstrap(email) values('info@dgwebservices.nl') on conflict do nothing;
-- Only the independently verified hosted Auth row can consume Danny's explicit owner invitation.
-- The web role cannot read Auth users, alter this allowlist, or directly grant platform roles.
create or replace function dartflow_private.consume_owner_bootstrap() returns trigger
language plpgsql security definer set search_path='' as $$
declare verified_email text; invitation dartflow_private.owner_bootstrap%rowtype;
begin
  if to_regclass('auth.users') is null then return new; end if;
  select lower(u.email) into verified_email from auth.users u
    where u.id=new.id and u.email_confirmed_at is not null and u.deleted_at is null;
  if verified_email is null then return new; end if;
  select * into invitation from dartflow_private.owner_bootstrap
    where email=verified_email and consumed_by is null for update;
  if not found then return new; end if;
  insert into dartflow_private.platform_roles(user_id,role) values(new.id,'owner')
    on conflict(user_id) do update set role='owner';
  update dartflow_private.owner_bootstrap set consumed_by=new.id,consumed_at=now()
    where email=verified_email and consumed_by is null;
  return new;
end;
$$;
revoke all on function dartflow_private.consume_owner_bootstrap() from public,dartflow_app;
do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_roles where rolname=r) then
      execute format('revoke all on dartflow_private.owner_bootstrap from %I',r);
      execute format('revoke all on function dartflow_private.consume_owner_bootstrap() from %I',r);
    end if;
  end loop;
end $$;
drop trigger if exists dartflow_owner_bootstrap on dartflow_private.profiles;
create trigger dartflow_owner_bootstrap after insert or update of email,email_verified on dartflow_private.profiles
  for each row execute function dartflow_private.consume_owner_bootstrap();
commit;
