begin;
-- Explicit location-owner grants. Existing ownership and club-board rows never
-- create permission implicitly, and this grant cannot grant device management.
create table if not exists dartflow_private.club_location_planning_grants(
 id uuid primary key,club_id uuid not null references dartflow_private.clubs(id),
 location_id uuid not null references dartflow_private.locations(id),
 status text not null check(status in('active','revoked')),
 starts_at timestamptz,ends_at timestamptz,
 windows jsonb not null check(jsonb_typeof(windows)='array' and jsonb_array_length(windows) between 1 and 28),
 revision integer not null default 1 check(revision>0),
 reason text not null check(length(reason) between 1 and 1000),
 granted_by uuid not null references dartflow_private.profiles(id),
 updated_at timestamptz not null default clock_timestamp(),
 unique(club_id,location_id),check(ends_at is null or starts_at is null or ends_at>starts_at)
);
create index if not exists club_planning_grants_location on dartflow_private.club_location_planning_grants(location_id,status);
create table if not exists dartflow_private.club_location_planning_boards(
 grant_id uuid not null references dartflow_private.club_location_planning_grants(id) on delete cascade,
 board_id uuid not null references dartflow_private.location_boards(board_id),
 active boolean not null default true,primary key(grant_id,board_id)
);
create index if not exists club_planning_grant_board on dartflow_private.club_location_planning_boards(board_id,grant_id)where active;
create table if not exists dartflow_private.competition_wizard_drafts(
 id uuid primary key,club_id uuid not null references dartflow_private.clubs(id),
 owner_id uuid not null references dartflow_private.profiles(id),
 revision integer not null default 1 check(revision>0),step integer not null check(step between 1 and 6),
 status text not null default 'draft' check(status in('draft','published')),
 config jsonb not null check(jsonb_typeof(config)='object' and octet_length(config::text)<=65536),
 published_season_id uuid unique references dartflow_private.competition_seasons(id),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check((status='published')=(published_season_id is not null))
);
create index if not exists competition_wizard_club on dartflow_private.competition_wizard_drafts(club_id,updated_at desc,id);
create index if not exists competition_wizard_owner on dartflow_private.competition_wizard_drafts(owner_id,id);
create table if not exists dartflow_private.competition_wizard_receipts(
 actor_id uuid not null references dartflow_private.profiles(id),request_id uuid not null,
 club_id uuid not null references dartflow_private.clubs(id),draft_id uuid references dartflow_private.competition_wizard_drafts(id),
 location_id uuid references dartflow_private.locations(id),payload_hash text not null,response jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(actor_id,request_id)
);
create index if not exists competition_wizard_receipts_draft on dartflow_private.competition_wizard_receipts(draft_id)where draft_id is not null;
create table if not exists dartflow_private.competition_wizard_bookings(
 fixture_id uuid not null,revision integer not null default 1 check(revision>0),draft_id uuid not null references dartflow_private.competition_wizard_drafts(id),
 season_id uuid not null references dartflow_private.competition_seasons(id),
 reservation_id uuid not null unique references dartflow_private.board_reservations(id),
 created_at timestamptz not null default clock_timestamp(),primary key(fixture_id,revision)
);
create index if not exists competition_wizard_booking_season on dartflow_private.competition_wizard_bookings(season_id,fixture_id);
do $$declare t text;r text;begin
 foreach t in array array['club_location_planning_grants','club_location_planning_boards','competition_wizard_drafts','competition_wizard_receipts','competition_wizard_bookings']loop
  execute format('alter table dartflow_private.%I enable row level security',t);
  execute format('revoke all on dartflow_private.%I from public',t);
  foreach r in array array['anon','authenticated','service_role']loop
   if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on dartflow_private.%I from %I',t,r);end if;
  end loop;
  execute format('drop policy if exists wizard_runtime on dartflow_private.%I',t);
  execute format('create policy wizard_runtime on dartflow_private.%I to dartflow_app using(true)with check(true)',t);
  execute format('grant select,insert on dartflow_private.%I to dartflow_app',t);
 end loop;
end$$;
grant update(status,starts_at,ends_at,windows,revision,reason,granted_by,updated_at)on dartflow_private.club_location_planning_grants to dartflow_app;
grant update(active)on dartflow_private.club_location_planning_boards to dartflow_app;
grant update(config,step,revision,status,published_season_id,updated_at)on dartflow_private.competition_wizard_drafts to dartflow_app;
create or replace function dartflow_private.guard_published_competition_draft()returns trigger language plpgsql set search_path='' as $$begin
 if old.status='published'and new is distinct from old then raise exception 'Published wizard configuration is immutable'using errcode='42501';end if;return new;
end$$;
drop trigger if exists published_competition_draft_immutable on dartflow_private.competition_wizard_drafts;
create trigger published_competition_draft_immutable before update on dartflow_private.competition_wizard_drafts for each row execute function dartflow_private.guard_published_competition_draft();
revoke all on function dartflow_private.guard_published_competition_draft()from public;
-- Both the wizard and the existing location approval use these physical rows.
-- Future writes are protected without changing or revalidating historic rows.
create or replace function dartflow_private.guard_board_booking_overlap()returns trigger language plpgsql set search_path='' as $$
declare target uuid;target_location uuid;target_status text;from_time timestamptz;to_time timestamptz;target_boards uuid[];begin
 if tg_table_name='reservation_boards'then
  target:=new.reservation_id;select starts_at,ends_at,status,location_id into from_time,to_time,target_status,target_location from dartflow_private.board_reservations where id=target;
  if target_status<>'accepted'then return new;end if;
  select array_agg(board_id order by board_id)into target_boards from(select rb.board_id from dartflow_private.reservation_boards rb where rb.reservation_id=target union select new.board_id)all_boards;
 else
  if new.status<>'accepted'then return new;end if;target:=new.id;target_location:=new.location_id;from_time:=new.starts_at;to_time:=new.ends_at;
  select array_agg(board_id order by board_id)into target_boards from dartflow_private.reservation_boards where reservation_id=target;
 end if;
 -- Physical operations already use location -> sorted boards. The location lock
 -- also serializes multi-row mapping statements whose later rows are not visible yet.
 perform id from dartflow_private.locations where id=target_location for update;
 perform id from dartflow_private.boards where id=any(target_boards)order by id for update;
 if exists(select 1 from dartflow_private.location_boards where board_id=any(target_boards)and location_id<>target_location)then raise exception 'Reservation board belongs to another location'using errcode='23514';end if;
 if exists(select 1 from dartflow_private.reservation_boards rb join dartflow_private.board_reservations r on r.id=rb.reservation_id
  where rb.board_id=any(target_boards)and r.id<>target and r.status='accepted'and r.starts_at<to_time and from_time<r.ends_at)
 then raise exception 'Physical board booking overlap'using errcode='23P01';end if;return new;
end$$;
drop trigger if exists board_booking_overlap_insert on dartflow_private.reservation_boards;
create trigger board_booking_overlap_insert before insert or update of board_id,reservation_id on dartflow_private.reservation_boards for each row execute function dartflow_private.guard_board_booking_overlap();
drop trigger if exists board_booking_overlap_accept on dartflow_private.board_reservations;
create trigger board_booking_overlap_accept before update of status,starts_at,ends_at on dartflow_private.board_reservations for each row execute function dartflow_private.guard_board_booking_overlap();
revoke all on function dartflow_private.guard_board_booking_overlap()from public;
insert into dartflow_private.feature_versions(name,version)values('club_competition_wizard',1)on conflict(name)do update set version=excluded.version;
commit;
