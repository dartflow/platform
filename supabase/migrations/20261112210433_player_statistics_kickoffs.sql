begin;
-- Only aggregate kickoff values are frozen; results/visits remain the canonical statistics source.
create table if not exists dartflow_private.player_match_kickoffs (
 match_id uuid primary key references dartflow_private.matches(id) on delete cascade,
 board_ids uuid[] not null default '{}',
 snapshot jsonb not null,
 created_at timestamptz not null default now()
);
do $$ begin
 if exists(select 1 from pg_constraint where conrelid='dartflow_private.player_match_kickoffs'::regclass and conname='player_match_kickoffs_match_id_fkey' and confdeltype<>'c') then
  alter table dartflow_private.player_match_kickoffs drop constraint player_match_kickoffs_match_id_fkey;
  alter table dartflow_private.player_match_kickoffs add constraint player_match_kickoffs_match_id_fkey foreign key(match_id) references dartflow_private.matches(id) on delete cascade;
 end if;
end $$;
alter table dartflow_private.player_match_kickoffs enable row level security;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename='player_match_kickoffs' and policyname='server_runtime') then
  create policy server_runtime on dartflow_private.player_match_kickoffs to dartflow_app using(true) with check(true);
 end if;
end $$;
revoke all on dartflow_private.player_match_kickoffs from public;
do $$ declare role_name text;begin
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if exists(select 1 from pg_roles where rolname=role_name) then execute format('revoke all on dartflow_private.player_match_kickoffs from %I',role_name);end if;
 end loop;
end $$;
grant select,insert,delete on dartflow_private.player_match_kickoffs to dartflow_app;
grant update(board_ids) on dartflow_private.player_match_kickoffs to dartflow_app;
create index if not exists player_match_kickoffs_boards on dartflow_private.player_match_kickoffs using gin(board_ids);
create index if not exists match_players_user_history on dartflow_private.match_players(user_id,match_id);
create index if not exists match_results_completed_order on dartflow_private.match_results(created_at desc,match_id desc);
create index if not exists completed_practice_by_owner on dartflow_private.platform_entities(owner_id,updated_at desc,id) where kind='training' and state->>'completed'='true' and coalesce(state->>'discarded','false')<>'true';
insert into dartflow_private.feature_versions(name,version) values('player_statistics',1) on conflict(name) do update set version=excluded.version;
commit;
