-- Short codes are private lookup data; existing 24-character invitation hashes stay intact.
begin;
create table if not exists dartflow_private.invitation_codes (
 code text primary key check (code ~ '^[A-Z0-9]{4}$'),
 entity_id uuid not null references dartflow_private.platform_entities on delete cascade,
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create index if not exists invitation_codes_entity on dartflow_private.invitation_codes(entity_id);
create index if not exists invitation_codes_expiry on dartflow_private.invitation_codes(expires_at);
alter table dartflow_private.invitation_codes enable row level security;
do $$ declare role_name text; begin
 if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename='invitation_codes' and policyname='server_runtime') then
  create policy server_runtime on dartflow_private.invitation_codes to dartflow_app using (true) with check (true);
 end if;
 revoke all on dartflow_private.invitation_codes from public;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if exists(select 1 from pg_roles where rolname=role_name) then execute format('revoke all on dartflow_private.invitation_codes from %I',role_name); end if;
 end loop;
end $$;
grant select,insert,delete on dartflow_private.invitation_codes to dartflow_app;
grant update(entity_id,expires_at) on dartflow_private.invitation_codes to dartflow_app;
insert into dartflow_private.feature_versions(name,version) values ('short_invitations',1) on conflict(name) do update set version=excluded.version;
commit;
