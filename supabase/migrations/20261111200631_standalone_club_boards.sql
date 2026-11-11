-- Persistent physical club boards, independently of competitions and tournaments.
-- Each has a dedicated internal core event so existing scoring/lease locks remain authoritative.
begin;
create table if not exists dartflow_private.club_boards (
  board_id uuid primary key references dartflow_private.boards,
  club_id uuid not null references dartflow_private.clubs,
  event_id uuid not null unique references dartflow_private.events,
  name text not null check (length(btrim(name)) between 1 and 80),
  access text not null default 'all' check (access in ('all','club')),
  created_by uuid not null references dartflow_private.profiles,
  created_at timestamptz not null default now()
);
create unique index if not exists club_boards_unique_name on dartflow_private.club_boards(club_id,lower(name));
create index if not exists club_boards_created_by on dartflow_private.club_boards(created_by);
create index if not exists platform_entities_board_lookup on dartflow_private.platform_entities((state->>'boardId')) where kind in ('lobby','training');
alter table dartflow_private.club_boards enable row level security;
do $$ declare role_name text; begin
  if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename='club_boards' and policyname='server_runtime') then
    create policy server_runtime on dartflow_private.club_boards to dartflow_app using (true) with check (true);
  end if;
  revoke all on dartflow_private.club_boards from public;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on dartflow_private.club_boards from %I',role_name);
    end if;
  end loop;
end $$;
-- Server commands validate fresh membership and serialize against the board's event lock.
grant select,insert on dartflow_private.club_boards to dartflow_app;
grant update(name,access) on dartflow_private.club_boards to dartflow_app;
grant update(name) on dartflow_private.boards to dartflow_app;
insert into dartflow_private.feature_versions(name,version) values ('club_boards',1) on conflict(name) do update set version=excluded.version;
commit;
