-- Durable, revocable, board-bound read-only screen credentials. No raw credential is stored.
begin;
create table if not exists dartflow_private.board_screen_devices (
 id uuid primary key,
 board_id uuid not null references dartflow_private.boards on delete cascade,
 event_id uuid not null references dartflow_private.events on delete cascade,
 created_by uuid not null references dartflow_private.profiles,
 name text not null check(length(btrim(name)) between 1 and 80),
 token_hash text unique check(token_hash is null or token_hash ~ '^[a-f0-9]{64}$'),
 pairing_hash text unique check(pairing_hash is null or pairing_hash ~ '^[a-f0-9]{64}$'),
 pairing_expires_at timestamptz not null,
 paired_at timestamptz,
 expires_at timestamptz not null,
 revoked_at timestamptz,
 created_at timestamptz not null default now(),
 constraint screen_device_pair_consistency check((paired_at is null and token_hash is null) or (paired_at is not null and token_hash is not null and pairing_hash is null))
);
create index if not exists board_screen_devices_board on dartflow_private.board_screen_devices(board_id,created_at desc);
create index if not exists board_screen_devices_event on dartflow_private.board_screen_devices(event_id);
create index if not exists board_screen_devices_issuer on dartflow_private.board_screen_devices(created_by);
alter table dartflow_private.board_screen_devices enable row level security;
do $$ declare role_name text; begin
 if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename='board_screen_devices' and policyname='server_runtime') then
  create policy server_runtime on dartflow_private.board_screen_devices to dartflow_app using(true) with check(true);
 end if;
 revoke all on dartflow_private.board_screen_devices from public;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if exists(select 1 from pg_roles where rolname=role_name) then execute format('revoke all on dartflow_private.board_screen_devices from %I',role_name); end if;
 end loop;
end $$;
grant select,insert on dartflow_private.board_screen_devices to dartflow_app;
grant update(token_hash,pairing_hash,paired_at,revoked_at) on dartflow_private.board_screen_devices to dartflow_app;
insert into dartflow_private.feature_versions(name,version) values('board_screen_devices',1) on conflict(name) do update set version=excluded.version;
commit;
