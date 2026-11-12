-- Physical ownership is independent of club membership. Existing board UUIDs are never replaced.
begin;
create table if not exists dartflow_private.location_accounts (
 user_id uuid primary key references dartflow_private.profiles,
 home_enabled boolean not null default false,
 venue_enabled boolean not null default false
);
create table if not exists dartflow_private.locations (
 id uuid primary key,
 owner_id uuid not null references dartflow_private.profiles,
 kind text not null check(kind in ('home','venue')),
 name text not null check(length(btrim(name)) between 1 and 60),
 timezone text not null default 'Europe/Amsterdam',
 created_at timestamptz not null default now()
);
create unique index if not exists locations_one_home_per_owner on dartflow_private.locations(owner_id) where kind='home';
create index if not exists locations_owner on dartflow_private.locations(owner_id,created_at,id);
create table if not exists dartflow_private.location_members (
 location_id uuid not null references dartflow_private.locations on delete cascade,
 user_id uuid not null references dartflow_private.profiles,
 granted_by uuid not null references dartflow_private.profiles,
 created_at timestamptz not null default now(),
 primary key(location_id,user_id)
);
create index if not exists location_members_user on dartflow_private.location_members(user_id,location_id);
create index if not exists location_members_granter on dartflow_private.location_members(granted_by);
create table if not exists dartflow_private.location_boards (
 board_id uuid primary key references dartflow_private.boards on delete cascade,
 location_id uuid not null references dartflow_private.locations,
 home_event_id uuid not null unique references dartflow_private.events,
 home_owner_id uuid unique references dartflow_private.profiles,
 reservation_enabled boolean not null default false,
 public_screen boolean not null default true,
 archived_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists location_boards_location on dartflow_private.location_boards(location_id,created_at,board_id);
create table if not exists dartflow_private.board_reservations (
 id uuid primary key,
 location_id uuid not null references dartflow_private.locations,
 requester_id uuid not null references dartflow_private.profiles,
 club_id uuid not null references dartflow_private.clubs,
 event_id uuid not null references dartflow_private.events,
 starts_at timestamptz not null,
 ends_at timestamptz not null check(ends_at>starts_at),
 board_count integer not null check(board_count between 1 and 16),
 max_matches integer not null check(max_matches between 1 and 32),
 status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled')),
 revision integer not null default 0 check(revision>=0),
 reason text not null default '' check(length(reason)<=300),
 decided_by uuid references dartflow_private.profiles,
 decided_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists board_reservations_location_window on dartflow_private.board_reservations(location_id,starts_at,ends_at) where status='accepted';
create index if not exists board_reservations_requester on dartflow_private.board_reservations(requester_id,created_at desc,id);
create index if not exists board_reservations_event on dartflow_private.board_reservations(event_id,status,starts_at,ends_at);
create index if not exists board_reservations_club on dartflow_private.board_reservations(club_id,created_at desc,id);
create index if not exists board_reservations_decider on dartflow_private.board_reservations(decided_by);
create table if not exists dartflow_private.reservation_boards (
 reservation_id uuid not null references dartflow_private.board_reservations,
 board_id uuid not null references dartflow_private.location_boards,
 primary key(reservation_id,board_id)
);
create index if not exists reservation_boards_physical on dartflow_private.reservation_boards(board_id,reservation_id);
create table if not exists dartflow_private.reservation_matches (
 reservation_id uuid not null references dartflow_private.board_reservations,
 match_id uuid not null unique references dartflow_private.matches on delete cascade,
 board_id uuid not null references dartflow_private.location_boards,
 created_at timestamptz not null default now(),
 primary key(reservation_id,match_id)
);
create index if not exists reservation_matches_board on dartflow_private.reservation_matches(board_id,created_at desc);
-- Existing physical creators keep ownership independently of later club role changes.
-- A dedicated location per legacy board avoids inventing ownership for other club admins.
insert into dartflow_private.location_accounts(user_id,venue_enabled)
 select distinct created_by,true from dartflow_private.club_boards
 on conflict(user_id) do update set venue_enabled=true;
insert into dartflow_private.locations(id,owner_id,kind,name)
 select cb.board_id,cb.created_by,'venue',left(c.name||' · '||b.name,60)
 from dartflow_private.club_boards cb join dartflow_private.clubs c on c.id=cb.club_id join dartflow_private.boards b on b.id=cb.board_id
 where not exists(select 1 from dartflow_private.location_boards lb where lb.board_id=cb.board_id)
 on conflict(id) do nothing;
insert into dartflow_private.location_boards(board_id,location_id,home_event_id,public_screen)
 select cb.board_id,cb.board_id,cb.event_id,true from dartflow_private.club_boards cb
 on conflict(board_id) do nothing;
do $$ declare table_name text;role_name text;begin
 foreach table_name in array array['location_accounts','locations','location_members','location_boards','board_reservations','reservation_boards','reservation_matches'] loop
  execute format('alter table dartflow_private.%I enable row level security',table_name);
  if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename=table_name and policyname='server_runtime') then
   execute format('create policy server_runtime on dartflow_private.%I to dartflow_app using(true) with check(true)',table_name);
  end if;
  execute format('revoke all on dartflow_private.%I from public',table_name);
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if exists(select 1 from pg_roles where rolname=role_name) then execute format('revoke all on dartflow_private.%I from %I',table_name,role_name);end if;
  end loop;
 end loop;
end $$;
grant select,insert on dartflow_private.location_accounts,dartflow_private.locations,dartflow_private.location_members,dartflow_private.location_boards,dartflow_private.board_reservations,dartflow_private.reservation_boards,dartflow_private.reservation_matches to dartflow_app;
grant update(home_enabled,venue_enabled) on dartflow_private.location_accounts to dartflow_app;
grant update(id,name,timezone) on dartflow_private.locations to dartflow_app;
grant delete on dartflow_private.location_members to dartflow_app;
grant update(reservation_enabled,public_screen,archived_at) on dartflow_private.location_boards to dartflow_app;
grant update(id,status,revision,reason,decided_by,decided_at) on dartflow_private.board_reservations to dartflow_app;
insert into dartflow_private.feature_versions(name,version) values('physical_locations',1) on conflict(name) do update set version=excluded.version;
commit;
