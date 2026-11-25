-- Expand the private display registry; board_id remains the v1 primary lane.
-- No physical device/reservation counting changes and no browser table grants.
begin;
create or replace function dartflow_private.oche_valid_layout(value jsonb) returns boolean language sql immutable set search_path='' as $$
 select value is null or coalesce(jsonb_typeof(value)='object' and value->>'orientation' in('portrait','landscape') and value->'scoreboards' in('1'::jsonb,'2'::jsonb) and (value->>'orientation'='landscape' or value->'scoreboards'='1'::jsonb),false)
$$;
revoke all on function dartflow_private.oche_valid_layout(jsonb) from public;
grant execute on function dartflow_private.oche_valid_layout(jsonb) to dartflow_app;
alter table dartflow_private.oche_devices add column if not exists layout jsonb;
alter table dartflow_private.oche_devices add column if not exists secondary_board_id uuid references dartflow_private.boards;
alter table dartflow_private.oche_devices add column if not exists configuration_revision integer not null default 0;
alter table dartflow_private.oche_reservations add column if not exists layout jsonb;
alter table dartflow_private.oche_reservations add column if not exists secondary_board_id uuid references dartflow_private.boards;
alter table dartflow_private.oche_installations add column if not exists layout_proposal jsonb;
alter table dartflow_private.oche_installations add column if not exists target_device_id uuid references dartflow_private.oche_devices on delete cascade;
alter table dartflow_private.oche_installations add column if not exists proposal_revision integer;
create index if not exists oche_device_secondary_board on dartflow_private.oche_devices(secondary_board_id) where secondary_board_id is not null;
create index if not exists oche_reservation_secondary_board on dartflow_private.oche_reservations(secondary_board_id) where secondary_board_id is not null;
create index if not exists oche_installation_target_device on dartflow_private.oche_installations(target_device_id) where target_device_id is not null;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='oche_device_layout') then
  alter table dartflow_private.oche_devices add constraint oche_device_layout check(dartflow_private.oche_valid_layout(layout) and configuration_revision>=0 and (scope<>'home' or coalesce(layout->>'scoreboards','1')='1') and (secondary_board_id is null or (scope='location' and layout->>'scoreboards'='2') is true) and (secondary_board_id is null or board_id is null or secondary_board_id<>board_id));
 end if;
 if not exists(select 1 from pg_constraint where conname='oche_reservation_layout') then
  alter table dartflow_private.oche_reservations add constraint oche_reservation_layout check(dartflow_private.oche_valid_layout(layout) and (scope<>'home' or coalesce(layout->>'scoreboards','1')='1') and (secondary_board_id is null or (scope='location' and layout->>'scoreboards'='2') is true) and (secondary_board_id is null or board_id is null or secondary_board_id<>board_id));
 end if;
 if not exists(select 1 from pg_constraint where conname='oche_installation_layout') then
  alter table dartflow_private.oche_installations add constraint oche_installation_layout check(dartflow_private.oche_valid_layout(layout_proposal) and (target_device_id is null or (layout_proposal is not null and proposal_revision>=0) is true));
 end if;
end $$;
create or replace function dartflow_private.oche_validate_assignment() returns trigger language plpgsql set search_path='' as $$
begin
 if new.scope='location' then
  if not exists(select 1 from dartflow_private.locations l where l.id=new.location_id and l.kind='venue') then raise check_violation using message='Oche location must be a physical venue';end if;
  if new.board_id is not null and not exists(select 1 from dartflow_private.location_boards lb where lb.board_id=new.board_id and lb.location_id=new.location_id and lb.archived_at is null) then raise check_violation using message='Oche board must belong to its location';end if;
  if new.secondary_board_id is not null and not exists(select 1 from dartflow_private.location_boards lb where lb.board_id=new.secondary_board_id and lb.location_id=new.location_id and lb.archived_at is null) then raise check_violation using message='Oche secondary board must belong to its location';end if;
 end if;
 return new;
end $$;
drop trigger if exists oche_device_assignment on dartflow_private.oche_devices;
create trigger oche_device_assignment before insert or update of scope,location_id,board_id,secondary_board_id,layout on dartflow_private.oche_devices for each row execute function dartflow_private.oche_validate_assignment();
drop trigger if exists oche_reservation_assignment on dartflow_private.oche_reservations;
create trigger oche_reservation_assignment before insert or update of scope,location_id,board_id,secondary_board_id,layout on dartflow_private.oche_reservations for each row execute function dartflow_private.oche_validate_assignment();
revoke all on function dartflow_private.oche_validate_assignment() from public;
insert into dartflow_private.feature_versions(name,version) values('oche_screen_layout',1) on conflict(name) do update set version=excluded.version;
commit;
