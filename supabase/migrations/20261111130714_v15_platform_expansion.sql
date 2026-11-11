-- v15 additive expansion; the migration runner owns the transaction.
-- Existing core schema version 1 and IDs remain valid for app rollback.

-- Additive v15 account support. Existing profile IDs and core schema version remain valid.
alter table dartflow_private.profiles add column if not exists email text;
alter table dartflow_private.profiles add column if not exists email_verified boolean not null default false;
create table if not exists dartflow_private.platform_roles (
  user_id uuid primary key references dartflow_private.profiles,
  role text not null check(role in ('owner','admin')),
  granted_at timestamptz not null default now()
);
create table if not exists dartflow_private.feature_versions (
  name text primary key,
  version integer not null check(version>0)
);
alter table dartflow_private.platform_roles enable row level security;
alter table dartflow_private.feature_versions enable row level security;
do $$ declare t text; begin
  foreach t in array array['platform_roles','feature_versions'] loop
    if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename=t and policyname='server_runtime') then
      execute format('create policy server_runtime on dartflow_private.%I for select to dartflow_app using (true)',t);
    end if;
  end loop;
end $$;
grant select on dartflow_private.platform_roles,dartflow_private.feature_versions to dartflow_app;
revoke insert,update,delete on dartflow_private.platform_roles,dartflow_private.feature_versions from dartflow_app;
grant insert(id,name,email,email_verified),update(name,email,email_verified) on dartflow_private.profiles to dartflow_app;
-- Public Auth identity is verified in server code; metadata never grants a platform role.
create table if not exists dartflow_private.owner_bootstrap (
  email text primary key,
  consumed_by uuid references dartflow_private.profiles,
  consumed_at timestamptz
);
alter table dartflow_private.owner_bootstrap enable row level security;
revoke all on dartflow_private.owner_bootstrap from public,dartflow_app;
insert into dartflow_private.owner_bootstrap(email) values('info@dgwebservices.nl') on conflict do nothing;
-- Only the independently verified hosted Auth row can consume Danny's explicit owner invitation.
-- The web role cannot read Auth users, alter this allowlist, or directly grant platform roles.
create or replace function dartflow_private.consume_owner_bootstrap() returns trigger
language plpgsql security definer set search_path='' as $$
declare verified_email text; invitation dartflow_private.owner_bootstrap%rowtype;
begin
  if to_regclass('auth.users') is null then return new; end if;
  select lower(u.email) into verified_email from auth.users u
    where u.id=new.id and u.email_confirmed_at is not null and u.deleted_at is null;
  if verified_email is null then return new; end if;
  select * into invitation from dartflow_private.owner_bootstrap
    where email=verified_email and consumed_by is null for update;
  if not found then return new; end if;
  insert into dartflow_private.platform_roles(user_id,role) values(new.id,'owner')
    on conflict(user_id) do update set role='owner';
  update dartflow_private.owner_bootstrap set consumed_by=new.id,consumed_at=now()
    where email=verified_email and consumed_by is null;
  return new;
end;
$$;
revoke all on function dartflow_private.consume_owner_bootstrap() from public,dartflow_app;
do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_roles where rolname=r) then
      execute format('revoke all on dartflow_private.owner_bootstrap from %I',r);
      execute format('revoke all on function dartflow_private.consume_owner_bootstrap() from %I',r);
    end if;
  end loop;
end $$;
drop trigger if exists dartflow_owner_bootstrap on dartflow_private.profiles;
create trigger dartflow_owner_bootstrap after insert or update of email,email_verified on dartflow_private.profiles
  for each row execute function dartflow_private.consume_owner_bootstrap();

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

-- Additive v15 integration schema; included in the generated reviewed migration.
create table if not exists dartflow_private.integration_settings (environment text not null, provider text not null, revision integer not null default 0, settings jsonb not null default '{}', updated_at timestamptz not null default now(), primary key(environment,provider));
create table if not exists dartflow_private.integration_credentials (environment text not null, kind text not null check(kind in ('resend-api','resend-webhook')), key_version integer not null, nonce text not null, ciphertext text not null, tag text not null, changed_by uuid references dartflow_private.profiles, changed_at timestamptz not null default now(), primary key(environment,kind));
create table if not exists dartflow_private.integration_audit (id uuid primary key, environment text not null, actor_id uuid references dartflow_private.profiles, operation text not null, outcome text not null, detail jsonb not null default '{}', created_at timestamptz not null default now());
create table if not exists dartflow_private.mail_templates (environment text not null, scope_key text not null, template_id text not null, revision integer not null default 0, draft jsonb not null, published jsonb, published_version integer not null default 0, enabled boolean not null default true, updated_by uuid references dartflow_private.profiles, updated_at timestamptz not null default now(), primary key(environment,scope_key,template_id));
create table if not exists dartflow_private.mail_template_versions (environment text not null, scope_key text not null, template_id text not null, version integer not null, fields jsonb not null, actor_id uuid references dartflow_private.profiles, created_at timestamptz not null default now(), primary key(environment,scope_key,template_id,version));
create table if not exists dartflow_private.mail_events (environment text not null, scope_key text not null, event_id text not null, template_id text not null, recipient_key text not null, payload_hash text not null, actor_id uuid references dartflow_private.profiles, created_at timestamptz not null default now(), primary key(environment,scope_key,event_id,template_id,recipient_key));
alter table dartflow_private.mail_events add column if not exists payload_hash text not null default '';
create table if not exists dartflow_private.mail_outbox (id uuid primary key, environment text not null, scope_key text not null, event_id text not null, template_id text not null, recipient_key text not null, recipient_id uuid references dartflow_private.profiles, recipient text, kind text not null check(kind in ('event','test','preview')), status text not null default 'queued', snapshot jsonb not null, template_version text not null, transport_key text not null unique, attempts integer not null default 0, first_attempt_at timestamptz, available_at timestamptz not null default now(), expires_at timestamptz, claim_token uuid, lease_until timestamptz, provider_message_id text, last_error text, entity_id uuid, entity_revision integer, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(environment,scope_key,event_id,template_id,recipient_key));
create index if not exists mail_outbox_due on dartflow_private.mail_outbox(environment,available_at) where status in ('queued','retry','processing');
create index if not exists mail_outbox_provider on dartflow_private.mail_outbox(environment,provider_message_id);
create table if not exists dartflow_private.mail_provider_events (environment text not null, provider_event_id text not null, provider_message_id text not null, event_type text not null, occurred_at timestamptz not null, job_id uuid references dartflow_private.mail_outbox, created_at timestamptz not null default now(), primary key(environment,provider_event_id));
create table if not exists dartflow_private.mail_suppressions (environment text not null, recipient_key text not null, category text not null, created_at timestamptz not null default now(), primary key(environment,recipient_key));
create table if not exists dartflow_private.mail_policies (environment text not null, scope_key text not null, revision integer not null default 0, settings jsonb not null default '{}', updated_by uuid references dartflow_private.profiles, updated_at timestamptz not null default now(), primary key(environment,scope_key));
create table if not exists dartflow_private.mail_preferences (user_id uuid references dartflow_private.profiles, category text not null, enabled boolean not null default true, primary key(user_id,category));
do $$ declare table_name text; role_name text; begin
 for table_name in select unnest(array['integration_settings','integration_credentials','integration_audit','mail_templates','mail_template_versions','mail_events','mail_outbox','mail_provider_events','mail_suppressions','mail_policies','mail_preferences']) loop
  execute format('alter table dartflow_private.%I enable row level security',table_name);
  if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename=table_name and policyname='server_runtime') then execute format('create policy server_runtime on dartflow_private.%I to dartflow_app using (true) with check (true)',table_name); end if;
  execute format('revoke all on dartflow_private.%I from public',table_name);
  foreach role_name in array array['anon','authenticated','service_role'] loop if exists(select 1 from pg_roles where rolname=role_name) then execute format('revoke all on dartflow_private.%I from %I',table_name,role_name); end if; end loop;
  execute format('grant select,insert,update,delete on dartflow_private.%I to dartflow_app',table_name);
 end loop;
end $$;
revoke update,delete on dartflow_private.integration_audit,dartflow_private.mail_template_versions,dartflow_private.mail_events from dartflow_app;
insert into dartflow_private.feature_versions(name,version) values ('v15',15) on conflict(name) do update set version=excluded.version;
