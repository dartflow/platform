-- Additive display-only device registry. Never grants player/account credentials.
begin;
create table if not exists dartflow_private.oche_location_limits(
 location_id uuid primary key references dartflow_private.locations on delete cascade,
 maximum integer not null check(maximum between 1 and 1000),
 updated_by uuid not null references dartflow_private.profiles,
 updated_at timestamptz not null default clock_timestamp()
);
create table if not exists dartflow_private.oche_home_selections(
 owner_id uuid primary key references dartflow_private.profiles on delete cascade,
 source_id uuid,
 updated_at timestamptz not null default clock_timestamp()
);
create table if not exists dartflow_private.oche_devices(
 id uuid primary key,
 installation_id uuid not null unique,
 scope text not null check(scope in('home','location')),
 owner_id uuid references dartflow_private.profiles,
 location_id uuid references dartflow_private.locations,
 board_id uuid references dartflow_private.boards,
 created_by uuid not null references dartflow_private.profiles,
 name text not null check(length(btrim(name)) between 1 and 80),
 platform text not null check(platform in('browser','android','android-tv')),
 grant_version integer not null default 1 check(grant_version>0),
 created_at timestamptz not null default clock_timestamp(),
 last_seen_at timestamptz,
 revoked_at timestamptz,
 check((scope='home' and owner_id is not null and location_id is null and board_id is null) or(scope='location' and owner_id is null and location_id is not null))
);
create index if not exists oche_devices_home_capacity on dartflow_private.oche_devices(owner_id) where revoked_at is null and scope='home';
create index if not exists oche_devices_location_capacity on dartflow_private.oche_devices(location_id) where revoked_at is null and scope='location';
create index if not exists oche_devices_issuer on dartflow_private.oche_devices(created_by);
create unique index if not exists oche_one_active_home_device on dartflow_private.oche_devices(owner_id) where scope='home' and revoked_at is null;
create table if not exists dartflow_private.oche_device_credentials(
 device_id uuid primary key references dartflow_private.oche_devices on delete cascade,
 refresh_hash text not null unique check(refresh_hash ~ '^[a-f0-9]{64}$'),
 refresh_expires_at timestamptz not null,
 generation integer not null default 1 check(generation>0)
);
create table if not exists dartflow_private.oche_installations(
 id uuid primary key,
 platform text not null check(platform in('browser','android','android-tv')),
 secret_hash text not null check(secret_hash ~ '^[a-f0-9]{64}$'),
 code_hash text unique check(code_hash is null or code_hash ~ '^[a-f0-9]{64}$'),
 code_cipher text,
 state text not null default 'pending' check(state in('pending','approved','redeemed','revoked')),
 expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
do $$ begin
 if not exists(select 1 from pg_constraint where conname='oche_devices_installation_fk' and conrelid='dartflow_private.oche_devices'::regclass) then
  alter table dartflow_private.oche_devices add constraint oche_devices_installation_fk foreign key(installation_id) references dartflow_private.oche_installations;
 end if;
end $$;
create table if not exists dartflow_private.oche_reservations(
 id uuid primary key,
 installation_id uuid not null unique references dartflow_private.oche_installations on delete cascade,
 scope text not null check(scope in('home','location')),
 owner_id uuid references dartflow_private.profiles,
 location_id uuid references dartflow_private.locations,
 board_id uuid references dartflow_private.boards,
 created_by uuid not null references dartflow_private.profiles,
 name text not null check(length(btrim(name)) between 1 and 80),
 replaces_device_id uuid references dartflow_private.oche_devices,
 expires_at timestamptz not null,
 state text not null default 'approved' check(state in('approved','redeemed','expired','cancelled')),
 created_at timestamptz not null default clock_timestamp(),
 check((scope='home' and owner_id is not null and location_id is null and board_id is null) or(scope='location' and owner_id is null and location_id is not null))
);
create unique index if not exists oche_reservation_replacement_unique on dartflow_private.oche_reservations(replaces_device_id) where state='approved' and replaces_device_id is not null;
create index if not exists oche_reservation_home_capacity on dartflow_private.oche_reservations(owner_id,expires_at) where state='approved';
create index if not exists oche_reservation_location_capacity on dartflow_private.oche_reservations(location_id,expires_at) where state='approved';
create table if not exists dartflow_private.oche_device_receipts(
 principal text not null,
 operation text not null,
 request_id uuid not null,
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 response_cipher text not null,
 expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(principal,operation,request_id)
);
create index if not exists oche_receipts_expiry on dartflow_private.oche_device_receipts(expires_at);
create table if not exists dartflow_private.oche_device_audit(
 id bigint generated always as identity primary key,
 actor_id uuid references dartflow_private.profiles,
 device_id uuid,
 action text not null,
 detail jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists oche_audit_actor on dartflow_private.oche_device_audit(actor_id,created_at desc);
-- Home displays read existing accepted receipts, not a second score ledger.
create index if not exists oche_home_training_events on dartflow_private.platform_audit(entity_id,id desc) where action in('training.score','training.undo');
create index if not exists oche_home_match_events on dartflow_private.audit_events(match_id,id desc) where action in('score','undo','approve-correction');
do $$ declare tab text; begin
 foreach tab in array array['oche_location_limits','oche_home_selections','oche_devices','oche_device_credentials','oche_installations','oche_reservations','oche_device_receipts','oche_device_audit'] loop
  execute format('alter table dartflow_private.%I enable row level security',tab);
  execute format('revoke all on dartflow_private.%I from public',tab);
  if exists(select 1 from pg_roles where rolname='anon') then execute format('revoke all on dartflow_private.%I from anon',tab);end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then execute format('revoke all on dartflow_private.%I from authenticated',tab);end if;
  if exists(select 1 from pg_roles where rolname='service_role') then execute format('revoke all on dartflow_private.%I from service_role',tab);end if;
  execute format('grant select,insert,update,delete on dartflow_private.%I to dartflow_app',tab);
  if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename=tab and policyname='runtime_only') then
   execute format('create policy runtime_only on dartflow_private.%I to dartflow_app using(true) with check(true)',tab);
  end if;
 end loop;
end $$;
grant usage,select on sequence dartflow_private.oche_device_audit_id_seq to dartflow_app;
-- Pairing uses installation guard -> shared capacity scope -> row locks.
-- Other capacity mutations use that same shared scope -> device row locks.
-- These triggers protect scoped assignments even from a future runtime caller.
create or replace function dartflow_private.oche_validate_assignment() returns trigger language plpgsql set search_path='' as $$
begin
 if new.scope='location' then
  if not exists(select 1 from dartflow_private.locations l where l.id=new.location_id and l.kind='venue') then raise check_violation using message='Oche location must be a physical venue';end if;
  if new.board_id is not null and not exists(select 1 from dartflow_private.location_boards lb where lb.board_id=new.board_id and lb.location_id=new.location_id and lb.archived_at is null) then raise check_violation using message='Oche board must belong to its location';end if;
 end if;
 return new;
end $$;
drop trigger if exists oche_device_assignment on dartflow_private.oche_devices;
create trigger oche_device_assignment before insert or update of scope,location_id,board_id on dartflow_private.oche_devices for each row execute function dartflow_private.oche_validate_assignment();
drop trigger if exists oche_reservation_assignment on dartflow_private.oche_reservations;
create trigger oche_reservation_assignment before insert or update of scope,location_id,board_id on dartflow_private.oche_reservations for each row execute function dartflow_private.oche_validate_assignment();
revoke all on function dartflow_private.oche_validate_assignment() from public;
insert into dartflow_private.feature_versions(name,version) values('oche_display_devices',1) on conflict(name) do update set version=excluded.version;
commit;
