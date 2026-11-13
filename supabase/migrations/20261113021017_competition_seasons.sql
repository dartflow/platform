begin;
create table if not exists dartflow_private.competition_seasons(
 id uuid primary key references dartflow_private.platform_entities(id) on delete cascade,
 scope text not null check(scope in('internal','national')),club_id uuid references dartflow_private.clubs(id),
 owner_id uuid not null references dartflow_private.profiles(id),status text not null,state jsonb not null,
 revision integer not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists seasons_scope_status on dartflow_private.competition_seasons(scope,status,updated_at desc,id);
create index if not exists seasons_club on dartflow_private.competition_seasons(club_id,updated_at desc,id);
create unique index if not exists seasons_event_lookup on dartflow_private.competition_seasons((state->>'eventId'));
create table if not exists dartflow_private.season_representations(
 season_id uuid not null references dartflow_private.competition_seasons(id) on delete cascade,
 user_id uuid not null references dartflow_private.profiles(id),club_id uuid not null references dartflow_private.clubs(id),
 primary key(season_id,user_id)
);
create index if not exists season_representations_club on dartflow_private.season_representations(season_id,club_id);
create table if not exists dartflow_private.season_receipts(
 actor_id uuid not null references dartflow_private.profiles(id) on delete cascade,request_id uuid not null,
 payload_hash text not null,season_id uuid not null references dartflow_private.competition_seasons(id) on delete cascade,
 match_id uuid references dartflow_private.matches(id) on delete set null,created_at timestamptz not null default now(),
 primary key(actor_id,request_id)
);
create table if not exists dartflow_private.season_pin_receipts(
 actor_id uuid not null references dartflow_private.profiles(id) on delete cascade,request_id uuid not null,
 match_id uuid not null references dartflow_private.matches(id) on delete cascade,target_id uuid not null references dartflow_private.profiles(id),
 fingerprint text not null,created_at timestamptz not null default now(),primary key(actor_id,request_id)
);
do $$ declare t text;r text;begin
 foreach t in array array['competition_seasons','season_representations','season_receipts','season_pin_receipts']loop
  execute format('alter table dartflow_private.%I enable row level security',t);
  execute format('revoke all on dartflow_private.%I from public',t);
  foreach r in array array['anon','authenticated','service_role']loop
   if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on dartflow_private.%I from %I',t,r);end if;
  end loop;
  execute format('drop policy if exists app_access on dartflow_private.%I',t);
  execute format('create policy app_access on dartflow_private.%I to dartflow_app using(true) with check(true)',t);
  execute format('grant select,insert,update,delete on dartflow_private.%I to dartflow_app',t);
 end loop;
end $$;
-- Published legacy results stay immutable. Only explicitly season-managed results can
-- be withdrawn by the audited, authorized season correction transaction.
grant delete on dartflow_private.match_results to dartflow_app;
drop policy if exists season_only_result_reopen on dartflow_private.match_results;
create policy season_only_result_reopen on dartflow_private.match_results as restrictive for delete to dartflow_app
 using(exists(select 1 from dartflow_private.platform_match_links l join dartflow_private.competition_seasons s on s.id=l.entity_id where l.match_id=match_results.match_id));
-- Preserve one official match identity across an approved, audited board transfer.
-- The runtime cannot change historical mappings for legacy, active or completed matches.
grant update(board_id,reservation_id) on dartflow_private.reservation_matches to dartflow_app;
drop policy if exists interrupted_season_board_transfer on dartflow_private.reservation_matches;
create policy interrupted_season_board_transfer on dartflow_private.reservation_matches as restrictive for update to dartflow_app
 using(exists(select 1 from dartflow_private.matches m join dartflow_private.platform_match_links l on l.match_id=m.id join dartflow_private.competition_seasons s on s.id=l.entity_id
  where m.id=reservation_matches.match_id and m.board_id is null and m.state->>'status'='interrupted'))
 with check(exists(select 1 from dartflow_private.matches m join dartflow_private.platform_match_links l on l.match_id=m.id join dartflow_private.competition_seasons s on s.id=l.entity_id
  join dartflow_private.board_reservations r on r.id=reservation_matches.reservation_id and r.event_id=m.event_id
  join dartflow_private.reservation_boards rb on rb.reservation_id=r.id and rb.board_id=reservation_matches.board_id
  where m.id=reservation_matches.match_id and m.board_id is null and m.state->>'status'='interrupted' and r.status='accepted' and r.starts_at<=clock_timestamp() and r.ends_at>clock_timestamp()));
insert into dartflow_private.feature_versions(name,version)values('competition_seasons',1)on conflict(name)do update set version=excluded.version;
commit;
