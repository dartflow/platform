begin;
create table if not exists dartflow_private.competition_board_lobbies (
 id uuid primary key,
 season_id uuid not null references dartflow_private.competition_seasons(id) on delete cascade,
 fixture_id uuid not null,
 slot_id uuid not null,
 match_id uuid not null references dartflow_private.matches(id) on delete cascade,
 board_id uuid not null references dartflow_private.boards(id) on delete cascade,
 owner_id uuid not null references dartflow_private.profiles(id),
 player_ids uuid[] not null check(cardinality(player_ids)=2 and player_ids[1]<>player_ids[2]),
 writer_id uuid not null references dartflow_private.profiles(id),
 confirmations jsonb not null default '{}'::jsonb check(jsonb_typeof(confirmations)='object' and confirmations-player_ids::text[]='{}'::jsonb),
 status text not null default 'waiting' check(status in('waiting','ready','started','expired','canceled')),
 expires_at timestamptz not null,
 revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check(owner_id=any(player_ids) and writer_id=owner_id),
 check(expires_at>created_at and expires_at<=created_at+interval '3 minutes')
);
create unique index if not exists competition_lobby_one_board on dartflow_private.competition_board_lobbies(board_id) where status in('waiting','ready');
create unique index if not exists competition_lobby_one_slot on dartflow_private.competition_board_lobbies(season_id,slot_id) where status in('waiting','ready');
create index if not exists competition_lobby_match on dartflow_private.competition_board_lobbies(match_id,created_at desc);
alter table dartflow_private.competition_board_lobbies enable row level security;
drop policy if exists competition_lobby_runtime on dartflow_private.competition_board_lobbies;
create policy competition_lobby_runtime on dartflow_private.competition_board_lobbies to dartflow_app using(true) with check(true);
revoke all on dartflow_private.competition_board_lobbies from public;
grant select,insert on dartflow_private.competition_board_lobbies to dartflow_app;
grant update(confirmations,status,revision,updated_at) on dartflow_private.competition_board_lobbies to dartflow_app;

create table if not exists dartflow_private.competition_lobby_receipts (
 actor_id uuid not null references dartflow_private.profiles(id),
 request_id uuid not null,
 lobby_id uuid not null references dartflow_private.competition_board_lobbies(id) on delete cascade,
 fingerprint text not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,request_id)
);
alter table dartflow_private.competition_lobby_receipts enable row level security;
drop policy if exists competition_lobby_receipt_runtime on dartflow_private.competition_lobby_receipts;
create policy competition_lobby_receipt_runtime on dartflow_private.competition_lobby_receipts to dartflow_app using(true) with check(true);
revoke all on dartflow_private.competition_lobby_receipts from public;
grant select,insert on dartflow_private.competition_lobby_receipts to dartflow_app;
do $$declare r text;begin foreach r in array array['anon','authenticated','service_role']loop
 if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on dartflow_private.competition_board_lobbies,dartflow_private.competition_lobby_receipts from %I',r);end if;
end loop;end$$;
insert into dartflow_private.feature_versions(name,version) values('competition_board_lobbies',1) on conflict(name) do update set version=excluded.version;
commit;
