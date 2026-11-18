begin;
create table if not exists dartflow_private.play_review_accounts (
 environment text primary key check(environment in ('staging','production')),
 user_id uuid not null references dartflow_private.profiles(id),
 email text not null check(length(email) between 3 and 254),
 password_envelope jsonb not null,
 review_details jsonb,
 companion_user_id uuid references dartflow_private.profiles(id),
 enabled boolean not null default true,
 created_at timestamptz not null default now()
);
alter table dartflow_private.play_review_accounts add column if not exists review_details jsonb;
alter table dartflow_private.play_review_accounts add column if not exists companion_user_id uuid references dartflow_private.profiles(id);
revoke all on dartflow_private.play_review_accounts from public;
alter table dartflow_private.play_review_accounts enable row level security;
do $$ declare role_name text; begin
 foreach role_name in array array['anon','authenticated'] loop
  if exists(select 1 from pg_roles where rolname=role_name)then
   execute format('revoke all on dartflow_private.play_review_accounts from %I',role_name);
  end if;
 end loop;
 if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename='play_review_accounts' and policyname='server_runtime_read')then
  create policy server_runtime_read on dartflow_private.play_review_accounts for select to dartflow_app using(true);
 end if;
 if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename='play_review_accounts' and policyname='server_runtime_disable')then
  create policy server_runtime_disable on dartflow_private.play_review_accounts for update to dartflow_app using(true) with check(true);
 end if;
end $$;
grant select on dartflow_private.play_review_accounts to dartflow_app;
grant update(enabled) on dartflow_private.play_review_accounts to dartflow_app;
commit;
