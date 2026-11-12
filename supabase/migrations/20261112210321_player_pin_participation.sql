begin;
-- Missing rows mean 'nog instellen'; no existing profile, history or game is rewritten.
create table if not exists dartflow_private.player_pin_verifiers (
 user_id uuid primary key references dartflow_private.profiles(id) on delete cascade,
 version integer not null check(version>0),
 pepper_version text not null check(pepper_version~'^[a-zA-Z0-9_-]{1,32}$'),
 salt text not null check(length(salt)=24),verifier text not null check(length(verifier)=44),
 memory integer not null check(memory between 19456 and 131072),
 passes integer not null check(passes between 2 and 8),parallelism integer not null check(parallelism=1),
 changed_at timestamptz not null default clock_timestamp()
);
create table if not exists dartflow_private.player_pin_receipts (
 actor_id uuid not null references dartflow_private.profiles(id) on delete cascade,
 request_id uuid not null,kind text not null check(kind in('update','lobby-add')),
 fingerprint text not null check(length(fingerprint)=64),
 lobby_id uuid references dartflow_private.platform_entities(id) on delete cascade,
 target_id uuid references dartflow_private.profiles(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,request_id,kind)
);
create index if not exists player_pin_receipts_lobby on dartflow_private.player_pin_receipts(lobby_id) where lobby_id is not null;
create table if not exists dartflow_private.player_pin_kdf_leases (
 id uuid primary key,expires_at timestamptz not null
);
do $$ declare t text;role_name text;begin
 foreach t in array array['player_pin_verifiers','player_pin_receipts','player_pin_kdf_leases'] loop
  execute format('alter table dartflow_private.%I enable row level security',t);
  execute format('drop policy if exists app_only on dartflow_private.%I',t);
  execute format('create policy app_only on dartflow_private.%I to dartflow_app using(true) with check(true)',t);
  execute format('revoke all on dartflow_private.%I from public',t);
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if exists(select 1 from pg_roles where rolname=role_name) then execute format('revoke all on dartflow_private.%I from %I',t,role_name);end if;
  end loop;
 end loop;
end $$;
grant select,insert,update on dartflow_private.player_pin_verifiers to dartflow_app;
grant select,insert on dartflow_private.player_pin_receipts to dartflow_app;
grant select,insert,delete on dartflow_private.player_pin_kdf_leases to dartflow_app;
insert into dartflow_private.feature_versions(name,version) values('player_pins',1) on conflict(name) do update set version=excluded.version;
commit;
