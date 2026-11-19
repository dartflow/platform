begin;
create table if not exists dartflow_private.match_offline_conflicts(
 id uuid primary key,case_id uuid not null,match_id uuid not null references dartflow_private.matches(id)on delete cascade,
 actor_id uuid not null references dartflow_private.profiles(id),request_id uuid not null,
 expected_revision integer not null,canonical_revision integer not null,action jsonb not null,accepted_state jsonb not null,
 status text not null default 'open'check(status in('open','resolved')),reason text,resolved_by uuid references dartflow_private.profiles(id),
 created_at timestamptz not null default clock_timestamp(),resolved_at timestamptz,
 unique(match_id,actor_id,request_id),check(expected_revision>=0 and canonical_revision>expected_revision)
);
create index if not exists match_offline_conflicts_case on dartflow_private.match_offline_conflicts(case_id,created_at,id);
alter table dartflow_private.match_offline_conflicts enable row level security;
revoke all on dartflow_private.match_offline_conflicts from public;
do $$declare r text;begin foreach r in array array['anon','authenticated','service_role']loop if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on dartflow_private.match_offline_conflicts from %I',r);end if;end loop;end $$;
drop policy if exists app_access on dartflow_private.match_offline_conflicts;
create policy app_access on dartflow_private.match_offline_conflicts to dartflow_app using(true)with check(true);
grant select,insert on dartflow_private.match_offline_conflicts to dartflow_app;
revoke update on dartflow_private.match_offline_conflicts from dartflow_app;
grant update(status,reason,resolved_by,resolved_at)on dartflow_private.match_offline_conflicts to dartflow_app;
revoke delete on dartflow_private.match_offline_conflicts from dartflow_app;
insert into dartflow_private.feature_versions(name,version)values('offline_score_conflicts',1)on conflict(name)do update set version=excluded.version;
commit;
