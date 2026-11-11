-- Additive v15 platform fragment. The migration owner installs this after schema.sql.
create table if not exists dartflow_private.platform_entities (
  id uuid primary key,
  kind text not null check(kind in ('training','club','room','lobby','league','tournament')),
  owner_id uuid not null references dartflow_private.profiles,
  club_id uuid references dartflow_private.clubs,
  visibility text not null check(visibility in ('public','private','club')),
  revision integer not null default 0 check(revision>=0),
  state jsonb not null check(jsonb_typeof(state)='object'),
  invite_hash text,
  invite_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(visibility<>'club' or club_id is not null)
);
create index if not exists platform_entities_owner on dartflow_private.platform_entities(owner_id,kind);
create index if not exists platform_entities_club on dartflow_private.platform_entities(club_id) where club_id is not null;
create table if not exists dartflow_private.platform_members (
  entity_id uuid references dartflow_private.platform_entities on delete cascade,
  user_id uuid references dartflow_private.profiles,
  role text not null check(role in ('owner','admin','captain','moderator','member')),
  status text not null check(status in ('active','pending','invited','waitlisted','banned','left')),
  attributes jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key(entity_id,user_id)
);
create index if not exists platform_members_user on dartflow_private.platform_members(user_id,entity_id,status);
create table if not exists dartflow_private.platform_preferences (
  user_id uuid primary key references dartflow_private.profiles,
  discoverable boolean not null default true,
  allow_requests boolean not null default true
);
create table if not exists dartflow_private.platform_relationships (
  source_id uuid references dartflow_private.profiles,
  target_id uuid references dartflow_private.profiles,
  kind text not null check(kind in ('request','friend','block','favorite')),
  created_at timestamptz not null default now(),
  primary key(source_id,target_id,kind),
  check(source_id<>target_id)
);
create index if not exists platform_relationships_target on dartflow_private.platform_relationships(target_id,source_id,kind);
create table if not exists dartflow_private.platform_messages (
  id uuid primary key,
  room_id uuid not null references dartflow_private.platform_entities,
  author_id uuid not null references dartflow_private.profiles,
  body text not null check(length(body) between 1 and 2000),
  deleted boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists platform_messages_room on dartflow_private.platform_messages(room_id,created_at,id);
create table if not exists dartflow_private.platform_reports (
  id uuid primary key,
  reporter_id uuid not null references dartflow_private.profiles,
  target_id uuid references dartflow_private.profiles,
  room_id uuid references dartflow_private.platform_entities,
  reason text not null check(length(reason) between 1 and 2000),
  created_at timestamptz not null default now()
);
create table if not exists dartflow_private.platform_receipts (
  actor_id uuid references dartflow_private.profiles,
  request_id uuid not null,
  payload_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,request_id)
);
create table if not exists dartflow_private.platform_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references dartflow_private.profiles,
  entity_id uuid references dartflow_private.platform_entities,
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table if not exists dartflow_private.platform_match_links (
  match_id uuid primary key references dartflow_private.matches,
  entity_id uuid not null references dartflow_private.platform_entities,
  fixture_id text not null,
  projected boolean not null default false,
  unique(entity_id,fixture_id)
);
create index if not exists platform_match_links_unprojected on dartflow_private.platform_match_links(match_id) where not projected;
create table if not exists dartflow_private.platform_signals (
  id bigint generated always as identity primary key,
  match_id uuid not null references dartflow_private.matches,
  sender_id uuid not null references dartflow_private.profiles,
  target_id uuid references dartflow_private.profiles,
  kind text not null check(kind in ('offer','answer','ice','hangup','chat','preflight')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists platform_signals_match on dartflow_private.platform_signals(match_id,id);
-- The only data path is the server, which validates the current session and scopes.
do $$ declare table_name text; role_name text; begin
  foreach table_name in array array['platform_entities','platform_members','platform_preferences','platform_relationships','platform_messages','platform_reports','platform_receipts','platform_audit','platform_match_links','platform_signals'] loop
    execute format('alter table dartflow_private.%I enable row level security',table_name);
    if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename=table_name and policyname='server_runtime') then
      execute format('create policy server_runtime on dartflow_private.%I to dartflow_app using (true) with check (true)',table_name);
    end if;
    execute format('revoke all on dartflow_private.%I from public',table_name);
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if exists(select 1 from pg_roles where rolname=role_name) then execute format('revoke all on dartflow_private.%I from %I',table_name,role_name); end if;
    end loop;
  end loop;
end $$;
grant select,insert,update,delete on dartflow_private.platform_entities,dartflow_private.platform_members,dartflow_private.platform_preferences,dartflow_private.platform_relationships,dartflow_private.platform_messages,dartflow_private.platform_match_links to dartflow_app;
grant select,insert on dartflow_private.platform_reports,dartflow_private.platform_receipts,dartflow_private.platform_audit,dartflow_private.platform_signals to dartflow_app;
grant usage,select on sequence dartflow_private.platform_audit_id_seq,dartflow_private.platform_signals_id_seq to dartflow_app;
-- Authenticated, authorized platform commands provision clubs, events and boards.
grant insert on dartflow_private.clubs,dartflow_private.club_memberships,dartflow_private.events,dartflow_private.event_staff,dartflow_private.boards to dartflow_app;
grant update,delete on dartflow_private.club_memberships to dartflow_app;
grant delete on dartflow_private.event_staff to dartflow_app;
grant update(blocked) on dartflow_private.boards to dartflow_app;
create table if not exists dartflow_private.platform_cast_grants (
  id uuid primary key,
  entity_id uuid not null references dartflow_private.platform_entities,
  token_hash text not null unique,
  created_by uuid not null references dartflow_private.profiles,
  expires_at timestamptz not null,
  revoked_at timestamptz
);
alter table dartflow_private.platform_cast_grants enable row level security;
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename='platform_cast_grants' and policyname='server_runtime') then
    create policy server_runtime on dartflow_private.platform_cast_grants to dartflow_app using (true) with check (true);
  end if;
end $$;
revoke all on dartflow_private.platform_cast_grants from public;
do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on dartflow_private.platform_cast_grants from %I',r); end if;
  end loop;
end $$;
grant select,insert,update on dartflow_private.platform_cast_grants to dartflow_app;
alter table dartflow_private.platform_reports add column if not exists status text not null default 'open' check(status in ('open','resolved'));
alter table dartflow_private.platform_reports add column if not exists decision text;
alter table dartflow_private.platform_reports add column if not exists reviewed_by uuid references dartflow_private.profiles;
grant update(status,decision,reviewed_by) on dartflow_private.platform_reports to dartflow_app;
create table if not exists dartflow_private.platform_registrations (
  user_id uuid primary key references dartflow_private.profiles,
  status text not null check(status in ('pending','approved','rejected')),
  reason text,
  reviewed_by uuid references dartflow_private.profiles,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table dartflow_private.platform_registrations enable row level security;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename='platform_registrations' and policyname='server_runtime') then create policy server_runtime on dartflow_private.platform_registrations to dartflow_app using(true) with check(true); end if;
end $$;
revoke all on dartflow_private.platform_registrations from public;
do $$ declare r text; begin
 foreach r in array array['anon','authenticated','service_role'] loop if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on dartflow_private.platform_registrations from %I',r); end if; end loop;
end $$;
grant select,insert,update on dartflow_private.platform_registrations to dartflow_app;
-- Profile edits are scoped by freshly checked club/event management commands.
grant update(name) on dartflow_private.clubs to dartflow_app;
grant update(name,date,capacity) on dartflow_private.events to dartflow_app;
