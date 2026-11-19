begin;
create table if not exists dartflow_private.match_correction_requests(
 id uuid primary key,match_id uuid not null references dartflow_private.matches(id)on delete cascade,
 requested_by uuid not null references dartflow_private.profiles(id),reason text not null,
 base_revision integer not null,result_revision integer not null,undo_count integer not null check(undo_count between 1 and 100),
 prior_state jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index if not exists match_correction_requests_match on dartflow_private.match_correction_requests(match_id,created_at desc,id);
create table if not exists dartflow_private.match_correction_decisions(
 request_id uuid primary key references dartflow_private.match_correction_requests(id)on delete cascade,
 actor_id uuid not null references dartflow_private.profiles(id),decision text not null check(decision in('approved','rejected','cancelled')),
 reason text not null,detail jsonb not null default '{}',created_at timestamptz not null default clock_timestamp()
);
create table if not exists dartflow_private.match_result_versions(
 match_id uuid not null references dartflow_private.matches(id)on delete cascade,result_revision integer not null,
 snapshot jsonb not null,state jsonb not null,recorded_at timestamptz not null default clock_timestamp(),primary key(match_id,result_revision)
);
create table if not exists dartflow_private.match_correction_dependencies(
 request_id uuid not null references dartflow_private.match_correction_requests(id)on delete cascade,
 match_id uuid not null references dartflow_private.matches(id)on delete cascade,result_revision integer not null,fixture_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),primary key(request_id,match_id)
);
create table if not exists dartflow_private.match_correction_repairs(
 request_id uuid primary key references dartflow_private.match_correction_requests(id)on delete cascade,
 actor_id uuid not null references dartflow_private.profiles(id),reason text not null,before_event jsonb not null,after_event jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create table if not exists dartflow_private.match_correction_receipts(
 actor_id uuid not null references dartflow_private.profiles(id)on delete cascade,request_id uuid not null,
 match_id uuid not null references dartflow_private.matches(id)on delete cascade,payload_hash text not null,response jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(actor_id,request_id)
);
create table if not exists dartflow_private.ranking_primary_correction_holds(
 request_id uuid not null references dartflow_private.match_correction_requests(id)on delete cascade,
 list_id uuid not null references dartflow_private.ranking_lists(id)on delete cascade,
 entity_id uuid not null references dartflow_private.platform_entities(id)on delete cascade,
 created_at timestamptz not null default clock_timestamp(),primary key(request_id,list_id)
);
create table if not exists dartflow_private.ranking_primary_correction_releases(
 request_id uuid not null,list_id uuid not null,actor_id uuid not null references dartflow_private.profiles(id),reason text not null,
 generation_id uuid not null references dartflow_private.ranking_generations(id)on delete cascade,created_at timestamptz not null default clock_timestamp(),
 primary key(request_id,list_id),foreign key(request_id,list_id)references dartflow_private.ranking_primary_correction_holds(request_id,list_id)on delete cascade
);
alter table dartflow_private.ranking_primary_correction_releases drop constraint if exists ranking_primary_correction_releases_generation_id_fkey;
alter table dartflow_private.ranking_primary_correction_releases add constraint ranking_primary_correction_releases_generation_id_fkey foreign key(generation_id)references dartflow_private.ranking_generations(id)on delete cascade;
do $$declare t text;r text;begin
 foreach t in array array['match_correction_requests','match_correction_decisions','match_result_versions','match_correction_dependencies','match_correction_repairs','match_correction_receipts','ranking_primary_correction_holds','ranking_primary_correction_releases']loop
  execute format('alter table dartflow_private.%I enable row level security',t);
  execute format('revoke all on dartflow_private.%I from public',t);
  foreach r in array array['anon','authenticated','service_role']loop
   if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on dartflow_private.%I from %I',t,r);end if;
  end loop;
  execute format('drop policy if exists app_access on dartflow_private.%I',t);
  execute format('create policy app_access on dartflow_private.%I to dartflow_app using(true)with check(true)',t);
  execute format('grant select,insert on dartflow_private.%I to dartflow_app',t);
  execute format('revoke update,delete on dartflow_private.%I from dartflow_app',t);
 end loop;
end $$;
-- Withdraw only the reviewed current projection. Its exact primary version remains immutable.
drop policy if exists season_only_result_reopen on dartflow_private.match_results;
create policy season_only_result_reopen on dartflow_private.match_results as restrictive for delete to dartflow_app using(
 exists(select 1 from dartflow_private.platform_match_links l join dartflow_private.competition_seasons s on s.id=l.entity_id where l.match_id=match_results.match_id)
 or exists(select 1 from dartflow_private.match_correction_requests q join dartflow_private.match_correction_decisions d on d.request_id=q.id
  join dartflow_private.match_result_versions v on v.match_id=q.match_id and v.result_revision=q.result_revision
  where q.match_id=match_results.match_id and q.result_revision=match_results.result_revision and d.decision='approved' and v.snapshot=match_results.snapshot)
 or exists(select 1 from dartflow_private.match_correction_dependencies c join dartflow_private.match_correction_decisions d on d.request_id=c.request_id
  join dartflow_private.match_result_versions v on v.match_id=c.match_id and v.result_revision=c.result_revision
  where c.match_id=match_results.match_id and c.result_revision=match_results.result_revision and d.decision='approved' and v.snapshot=match_results.snapshot)
);
insert into dartflow_private.feature_versions(name,version)values('primary_match_corrections',1)on conflict(name)do update set version=excluded.version;
commit;
