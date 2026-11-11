-- Execute as the migration owner, never as the web runtime identity.
begin;
create schema if not exists dartflow_private;
revoke all on schema dartflow_private from public;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='dartflow_app') then
    create role dartflow_app login nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end $$;
create table if not exists dartflow_private.schema_migrations (version integer primary key, applied_at timestamptz not null default now());
insert into dartflow_private.schema_migrations(version) values(1) on conflict do nothing;
create table if not exists dartflow_private.profiles (id uuid primary key, name text not null check (length(name) between 1 and 80));
create table if not exists dartflow_private.clubs (id uuid primary key, name text not null);
create table if not exists dartflow_private.club_memberships (club_id uuid references dartflow_private.clubs on delete cascade, user_id uuid references dartflow_private.profiles, role text not null check (role in ('organizer','player')), primary key(club_id,user_id));
create table if not exists dartflow_private.events (id uuid primary key, club_id uuid not null references dartflow_private.clubs, name text not null, date date not null, capacity integer not null check(capacity>0));
create table if not exists dartflow_private.event_staff (event_id uuid references dartflow_private.events, user_id uuid references dartflow_private.profiles, primary key(event_id,user_id));
create table if not exists dartflow_private.entries (id uuid primary key, event_id uuid references dartflow_private.events, user_id uuid references dartflow_private.profiles, status text not null check(status in ('registered','waitlisted','withdrawn')), checked_in boolean not null default false, created_at timestamptz not null default now(), unique(event_id,user_id));
create table if not exists dartflow_private.boards (id uuid primary key, event_id uuid references dartflow_private.events, name text not null, blocked boolean not null default false);
create table if not exists dartflow_private.matches (id uuid primary key, club_id uuid references dartflow_private.clubs, event_id uuid references dartflow_private.events, board_id uuid references dartflow_private.boards, revision integer not null check(revision>=0), state jsonb not null, updated_at timestamptz not null default now());
create unique index if not exists one_active_match_per_board on dartflow_private.matches(board_id) where board_id is not null;
create table if not exists dartflow_private.match_players (match_id uuid references dartflow_private.matches, user_id uuid references dartflow_private.profiles, position integer not null check(position in (0,1)), primary key(match_id,user_id), unique(match_id,position));
create table if not exists dartflow_private.visits (match_id uuid references dartflow_private.matches, sequence integer not null, data jsonb not null, primary key(match_id,sequence));
create table if not exists dartflow_private.match_confirmations (match_id uuid references dartflow_private.matches, user_id uuid references dartflow_private.profiles, result_revision integer not null, primary key(match_id,user_id));
create table if not exists dartflow_private.match_results (match_id uuid primary key references dartflow_private.matches, event_id uuid references dartflow_private.events, result_revision integer not null, snapshot jsonb not null, created_at timestamptz not null default now());
create table if not exists dartflow_private.standings (event_id uuid references dartflow_private.events, user_id uuid references dartflow_private.profiles, played integer not null default 0, won integer not null default 0, drawn integer not null default 0, points integer not null default 0, primary key(event_id,user_id));
create table if not exists dartflow_private.action_receipts (match_id uuid references dartflow_private.matches, actor_id uuid references dartflow_private.profiles, request_id uuid not null, payload_hash text not null, response jsonb not null, created_at timestamptz not null default now(), primary key(match_id,actor_id,request_id));
create table if not exists dartflow_private.audit_events (id bigint generated always as identity primary key, actor_id uuid references dartflow_private.profiles, club_id uuid references dartflow_private.clubs, event_id uuid references dartflow_private.events, match_id uuid references dartflow_private.matches, action text not null, detail jsonb not null default '{}', created_at timestamptz not null default now());
create table if not exists dartflow_private.screen_capabilities (id uuid primary key, event_id uuid references dartflow_private.events, board_id uuid references dartflow_private.boards, token_hash text unique not null, created_by uuid references dartflow_private.profiles, revoked_at timestamptz, expires_at timestamptz not null);
create table if not exists dartflow_private.auth_limits (key text primary key, count integer not null, reset_at timestamptz not null);
-- The schema is excluded from PostgREST; explicit revokes also protect accidental exposure.
do $$ declare role_name text; table_name text; begin
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if exists (select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on schema dartflow_private from %I',role_name);
      execute format('revoke all on all tables in schema dartflow_private from %I',role_name);
      execute format('revoke all on all sequences in schema dartflow_private from %I',role_name);
    end if;
  end loop;
  foreach table_name in array array['schema_migrations','profiles','clubs','club_memberships','events','event_staff','entries','boards','matches','match_players','visits','match_confirmations','match_results','standings','action_receipts','audit_events','screen_capabilities','auth_limits'] loop
    execute format('alter table dartflow_private.%I enable row level security',table_name);
    if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename=table_name and policyname='server_runtime') then
      execute format('create policy server_runtime on dartflow_private.%I to dartflow_app using (true) with check (true)',table_name);
    end if;
  end loop;
end $$;
grant usage on schema dartflow_private to dartflow_app;
grant select,insert,update,delete on dartflow_private.schema_migrations,dartflow_private.profiles,dartflow_private.clubs,dartflow_private.club_memberships,dartflow_private.events,dartflow_private.event_staff,dartflow_private.entries,dartflow_private.boards,dartflow_private.matches,dartflow_private.match_players,dartflow_private.visits,dartflow_private.match_confirmations,dartflow_private.match_results,dartflow_private.standings,dartflow_private.action_receipts,dartflow_private.audit_events,dartflow_private.screen_capabilities,dartflow_private.auth_limits to dartflow_app;
grant usage,select on sequence dartflow_private.audit_events_id_seq to dartflow_app;
revoke insert,update,delete on dartflow_private.schema_migrations,dartflow_private.profiles,dartflow_private.clubs,dartflow_private.club_memberships,dartflow_private.event_staff,dartflow_private.events,dartflow_private.boards from dartflow_app;
revoke update,delete on dartflow_private.audit_events,dartflow_private.action_receipts,dartflow_private.match_results,dartflow_private.match_players from dartflow_app;
revoke delete on dartflow_private.matches from dartflow_app;
-- PostgreSQL requires UPDATE on at least one column for SELECT FOR UPDATE row locks.
grant update(id) on dartflow_private.events,dartflow_private.boards to dartflow_app;
-- Web writes are constrained by typed server commands and fresh database authorization.
-- No public RPC, auth metadata role or service-role key is used.
-- Later migrations own their tables and grants; replaying this bootstrap cannot widen them.
alter default privileges in schema dartflow_private revoke all on tables from public;
alter default privileges in schema dartflow_private revoke all on functions from public;
commit;
