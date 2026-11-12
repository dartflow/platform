-- V17 club relationships are private server data. Existing event/board ownership stays separate.
begin;
create table if not exists dartflow_private.club_roles (
 club_id uuid not null references dartflow_private.clubs(id) on delete cascade,
 id uuid not null,
 name text not null check(length(name) between 1 and 64),
 permissions text[] not null default '{}' check(permissions <@ array['members.invite','members.approve','chat.moderate','competitions.manage','tournaments.manage','settings.edit']::text[]),
 primary key(club_id,id), unique(club_id,name)
);
create table if not exists dartflow_private.club_member_roles (
 club_id uuid not null,user_id uuid not null,role_id uuid not null,
 primary key(club_id,user_id,role_id),
 foreign key(club_id,user_id) references dartflow_private.club_memberships(club_id,user_id) on delete cascade,
 foreign key(club_id,role_id) references dartflow_private.club_roles(club_id,id) on delete cascade
);
create table if not exists dartflow_private.club_intake_versions (
 club_id uuid not null references dartflow_private.clubs(id) on delete cascade,
 version integer not null check(version>0),introduction text not null default '',questions jsonb not null default '[]' check(jsonb_typeof(questions)='array'),created_at timestamptz not null default now(),
 primary key(club_id,version)
);
create table if not exists dartflow_private.club_join_requests (
 id uuid primary key,club_id uuid not null,user_id uuid not null references dartflow_private.profiles(id),version integer not null,
 kind text not null check(kind in ('intake','open','invite')),
 answers jsonb not null default '[]' check(jsonb_typeof(answers)='array'),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(),reviewed_at timestamptz,reviewed_by uuid references dartflow_private.profiles(id),reason text,
 foreign key(club_id,version) references dartflow_private.club_intake_versions(club_id,version)
);
create unique index if not exists club_one_pending_request on dartflow_private.club_join_requests(club_id,user_id) where status='pending';
create index if not exists club_request_scope on dartflow_private.club_join_requests(club_id,status,created_at,id);
create table if not exists dartflow_private.club_invites (
 id uuid primary key,club_id uuid not null references dartflow_private.clubs(id) on delete cascade,user_id uuid not null references dartflow_private.profiles(id),invited_by uuid not null references dartflow_private.profiles(id),
 status text not null default 'pending' check(status in ('pending','accepted','declined','revoked','expired')),created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '7 days',decided_at timestamptz
);
create unique index if not exists club_one_pending_invite on dartflow_private.club_invites(club_id,user_id) where status='pending';
-- Backfill only metadata for existing platform clubs; do not invent owners for core-only event clubs.
insert into dartflow_private.club_intake_versions(club_id,version) select id,1 from dartflow_private.platform_entities where kind='club' on conflict do nothing;
update dartflow_private.platform_members m set role='member' from dartflow_private.platform_entities e where e.id=m.entity_id and e.kind='club' and m.role='owner' and m.user_id<>e.owner_id;
insert into dartflow_private.platform_members(entity_id,user_id,role,status) select id,owner_id,'owner','active' from dartflow_private.platform_entities where kind='club' on conflict(entity_id,user_id) do update set role='owner',status='active' where (dartflow_private.platform_members.role,dartflow_private.platform_members.status) is distinct from ('owner','active');
-- Re-applying this additive migration must flush existing deferred owner triggers before DDL.
set constraints all immediate;
create unique index if not exists platform_one_active_owner on dartflow_private.platform_members(entity_id) where role='owner' and status='active';
create or replace function dartflow_private.enforce_one_club_owner() returns trigger language plpgsql security invoker set search_path=pg_catalog,dartflow_private as $$
declare target uuid; expected uuid; actual integer;
begin
 if tg_table_name='platform_entities' then target=coalesce(new.id,old.id); else target=coalesce(new.entity_id,old.entity_id); end if;
 select owner_id into expected from dartflow_private.platform_entities where id=target and kind='club';
 if expected is null then return null; end if;
 select count(*) into actual from dartflow_private.platform_members where entity_id=target and role='owner' and status='active';
 if actual<>1 or not exists(select 1 from dartflow_private.platform_members where entity_id=target and user_id=expected and role='owner' and status='active') then raise exception 'Club must retain exactly its active owner' using errcode='23514'; end if;
 return null;
end $$;
drop trigger if exists club_owner_entity_guard on dartflow_private.platform_entities;
create constraint trigger club_owner_entity_guard after insert or update on dartflow_private.platform_entities deferrable initially deferred for each row execute function dartflow_private.enforce_one_club_owner();
drop trigger if exists club_owner_member_guard on dartflow_private.platform_members;
create constraint trigger club_owner_member_guard after insert or update or delete on dartflow_private.platform_members deferrable initially deferred for each row execute function dartflow_private.enforce_one_club_owner();
create or replace function dartflow_private.keep_club_request_snapshot() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$begin
 if (new.id,new.club_id,new.user_id,new.version,new.kind,new.answers,new.created_at) is distinct from (old.id,old.club_id,old.user_id,old.version,old.kind,old.answers,old.created_at) then raise exception 'Submitted club intake is immutable' using errcode='23514'; end if;return new;
end $$;
drop trigger if exists club_request_snapshot_guard on dartflow_private.club_join_requests;
create trigger club_request_snapshot_guard before update on dartflow_private.club_join_requests for each row execute function dartflow_private.keep_club_request_snapshot();
revoke all on function dartflow_private.enforce_one_club_owner(),dartflow_private.keep_club_request_snapshot() from public;
grant execute on function dartflow_private.enforce_one_club_owner(),dartflow_private.keep_club_request_snapshot() to dartflow_app;
do $$declare table_name text; role_name text;begin
 foreach table_name in array array['club_roles','club_member_roles','club_intake_versions','club_join_requests','club_invites'] loop
 execute format('alter table dartflow_private.%I enable row level security',table_name);
 execute format('revoke all on dartflow_private.%I from public',table_name);
 foreach role_name in array array['anon','authenticated','service_role'] loop
 if exists(select 1 from pg_roles where rolname=role_name) then execute format('revoke all on dartflow_private.%I from %I',table_name,role_name); end if;
 end loop;
 if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename=table_name and policyname='server_runtime') then execute format('create policy server_runtime on dartflow_private.%I to dartflow_app using(true) with check(true)',table_name);end if;
 end loop;
end $$;
grant select,insert,update,delete on dartflow_private.club_roles,dartflow_private.club_member_roles to dartflow_app;
grant select,insert on dartflow_private.club_intake_versions,dartflow_private.club_join_requests,dartflow_private.club_invites to dartflow_app;
grant update(status,reviewed_at,reviewed_by,reason) on dartflow_private.club_join_requests to dartflow_app;
grant update(status,decided_at) on dartflow_private.club_invites to dartflow_app;
insert into dartflow_private.feature_versions(name,version) values('v17_clubs',1) on conflict(name) do update set version=excluded.version;
commit;
