begin;
create table if not exists dartflow_private.native_push_devices (
 id uuid primary key, environment text not null check(environment in('development','staging','production')),
 user_id uuid not null references dartflow_private.profiles(id) on delete cascade,
 installation_id uuid not null, package_name text not null, token_hash text not null, token_cipher jsonb not null,
 enabled boolean not null default true, last_seen_at timestamptz not null default now(), expires_at timestamptz not null,
 unique(environment,installation_id), unique(environment,token_hash),
 check(package_name=case environment when 'production' then 'nl.dartflow.app' when 'staging' then 'nl.dartflow.app.staging' else 'nl.dartflow.app.dev' end)
);
create index if not exists native_push_devices_recipient on dartflow_private.native_push_devices(environment,user_id) where enabled;
create index if not exists native_push_devices_user on dartflow_private.native_push_devices(user_id);
create table if not exists dartflow_private.native_push_inbox (
 id uuid primary key, environment text not null, recipient_id uuid not null references dartflow_private.profiles(id) on delete cascade,
 event_id text not null, template_id text not null, category text not null check(category in('Sociaal','Wedstrijden','Competitie','Toernooien')),
 scope_key text not null, reference jsonb not null, action_path text not null, created_at timestamptz not null default now(), expires_at timestamptz not null,
 opened_at timestamptz, unique(environment,recipient_id,event_id,template_id)
);
create index if not exists native_push_inbox_actor on dartflow_private.native_push_inbox(environment,recipient_id,created_at desc);
create index if not exists native_push_inbox_recipient on dartflow_private.native_push_inbox(recipient_id);
create table if not exists dartflow_private.native_push_outbox (
 id uuid primary key, inbox_id uuid not null references dartflow_private.native_push_inbox(id) on delete cascade,
 device_id uuid not null references dartflow_private.native_push_devices(id) on delete cascade,
 recipient_id uuid not null references dartflow_private.profiles(id) on delete cascade,
 status text not null check(status in('queued','processing','retry','accepted','received','opened','expired','suppressed','failed','uncertain')),
 attempts integer not null default 0, available_at timestamptz not null default now(), claim_token uuid, lease_until timestamptz,
 provider_id text, error_category text, received_at timestamptz, opened_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(inbox_id,device_id)
);
create index if not exists native_push_outbox_due on dartflow_private.native_push_outbox(available_at,id) where status in('queued','retry','processing');
create index if not exists native_push_outbox_device on dartflow_private.native_push_outbox(device_id);
create index if not exists native_push_outbox_recipient on dartflow_private.native_push_outbox(recipient_id);
alter table dartflow_private.native_push_devices enable row level security;
alter table dartflow_private.native_push_inbox enable row level security;
alter table dartflow_private.native_push_outbox enable row level security;
revoke all on dartflow_private.native_push_devices,dartflow_private.native_push_inbox,dartflow_private.native_push_outbox from public;
do $$begin
 if exists(select 1 from pg_roles where rolname='anon')then revoke all on dartflow_private.native_push_devices,dartflow_private.native_push_inbox,dartflow_private.native_push_outbox from anon;end if;
 if exists(select 1 from pg_roles where rolname='authenticated')then revoke all on dartflow_private.native_push_devices,dartflow_private.native_push_inbox,dartflow_private.native_push_outbox from authenticated;end if;
 if exists(select 1 from pg_roles where rolname='service_role')then revoke all on dartflow_private.native_push_devices,dartflow_private.native_push_inbox,dartflow_private.native_push_outbox from service_role;end if;
end$$;
grant select,insert,update,delete on dartflow_private.native_push_devices,dartflow_private.native_push_inbox,dartflow_private.native_push_outbox to dartflow_app;
drop policy if exists native_push_runtime on dartflow_private.native_push_devices;
create policy native_push_runtime on dartflow_private.native_push_devices to dartflow_app using(true)with check(true);
drop policy if exists native_push_runtime on dartflow_private.native_push_inbox;
create policy native_push_runtime on dartflow_private.native_push_inbox to dartflow_app using(true)with check(true);
drop policy if exists native_push_runtime on dartflow_private.native_push_outbox;
create policy native_push_runtime on dartflow_private.native_push_outbox to dartflow_app using(true)with check(true);
-- Both the initial soft-deletion request and the existing privacy-worker erasure
-- remove tokens and private inbox data. Cascades erase pending/leased deliveries.
create or replace function dartflow_private.erase_native_push_on_account_removal()returns trigger language plpgsql set search_path=pg_catalog,dartflow_private,pg_temp as $$
begin
 if new.deletion_requested_at is not null or new.deleted_at is not null then
  delete from dartflow_private.native_push_devices where user_id=new.id;
  delete from dartflow_private.native_push_inbox where recipient_id=new.id;
 end if;
 return new;
end$$;
revoke all on function dartflow_private.erase_native_push_on_account_removal()from public;
drop trigger if exists erase_native_push_on_account_removal on dartflow_private.profiles;
create trigger erase_native_push_on_account_removal after update of deletion_requested_at,deleted_at on dartflow_private.profiles for each row execute function dartflow_private.erase_native_push_on_account_removal();
delete from dartflow_private.native_push_devices d using dartflow_private.profiles p where p.id=d.user_id and(p.deletion_requested_at is not null or p.deleted_at is not null);
delete from dartflow_private.native_push_inbox i using dartflow_private.profiles p where p.id=i.recipient_id and(p.deletion_requested_at is not null or p.deleted_at is not null);
insert into dartflow_private.feature_versions(name,version)values('native_push',1)on conflict(name)do update set version=excluded.version;
commit;
