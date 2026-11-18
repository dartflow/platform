-- Server-only evidence of a versioned rules acceptance. No birthdate is collected.
create table if not exists dartflow_private.player_safety_acceptances (
 user_id uuid not null references dartflow_private.profiles on delete cascade,
 version text not null check(length(version) between 1 and 40),
 age_confirmed boolean not null check(age_confirmed),
 accepted_at timestamptz not null default now(),
 primary key(user_id,version)
);
alter table dartflow_private.player_safety_acceptances enable row level security;
revoke all on dartflow_private.player_safety_acceptances from public;
do $$ declare restricted_role text; begin
 foreach restricted_role in array array['anon','authenticated'] loop
  if exists(select 1 from pg_roles where rolname=restricted_role) then execute format('revoke all on dartflow_private.player_safety_acceptances from %I',restricted_role);end if;
 end loop;
 if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename='player_safety_acceptances' and policyname='server_runtime') then
  create policy server_runtime on dartflow_private.player_safety_acceptances to dartflow_app using(true) with check(true);
 end if;
end $$;
grant select,insert,update,delete on dartflow_private.player_safety_acceptances to dartflow_app;
alter table dartflow_private.platform_reports add column if not exists target_type text;
alter table dartflow_private.platform_reports add column if not exists content_id uuid;
alter table dartflow_private.platform_reports add column if not exists scope_kind text;
alter table dartflow_private.platform_reports add column if not exists scope_id uuid;
alter table dartflow_private.platform_reports add column if not exists category text;
create index if not exists platform_reports_reporter_time on dartflow_private.platform_reports(reporter_id,created_at desc);
create index if not exists platform_reports_scope_status on dartflow_private.platform_reports(scope_kind,scope_id,status,created_at);
