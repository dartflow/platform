begin;
create table if not exists dartflow_private.club_branding_entitlements (
 club_id uuid primary key references dartflow_private.clubs(id) on delete cascade,
 entitlement_key text not null default 'association.branding.global' check(entitlement_key='association.branding.global'),
 starts_at timestamptz not null,ends_at timestamptz not null,revoked_at timestamptz,granted_by uuid not null references dartflow_private.profiles(id),check(ends_at>starts_at)
);
create table if not exists dartflow_private.club_branding_versions (
 club_id uuid primary key references dartflow_private.clubs(id) on delete cascade,
 draft jsonb,published jsonb,revision integer not null default 0,published_revision integer not null default 0,updated_at timestamptz not null default now()
);
create table if not exists dartflow_private.club_branding_history (
 club_id uuid not null references dartflow_private.clubs(id) on delete cascade,revision integer not null,stage text not null check(stage in('draft','published')),design jsonb not null,actor_id uuid references dartflow_private.profiles(id) on delete set null,created_at timestamptz not null default now(),primary key(club_id,revision,stage)
);
create table if not exists dartflow_private.player_theme_preferences (
 user_id uuid primary key references dartflow_private.profiles(id) on delete cascade,
 mode text not null check(mode in('auto','dartflow','club')),club_id uuid references dartflow_private.clubs(id) on delete set null,
 color_mode text not null check(color_mode in('system','light','dark')),revision integer not null default 1
);
create table if not exists dartflow_private.club_teams (
 id uuid primary key,club_id uuid not null references dartflow_private.clubs(id) on delete cascade,name text not null,
 captain_id uuid not null references dartflow_private.profiles(id),member_ids uuid[] not null,reserve_ids uuid[] not null default '{}',active boolean not null default true,revision integer not null default 1,
 check(cardinality(member_ids)>0 and captain_id=any(member_ids)),check(not(member_ids&&reserve_ids))
);
create index if not exists club_teams_club on dartflow_private.club_teams(club_id);
create table if not exists dartflow_private.club_activities (
 id uuid primary key,club_id uuid not null references dartflow_private.clubs(id) on delete cascade,title text not null,description text not null default '',
 starts_at timestamptz not null,ends_at timestamptz not null,time_zone text not null default 'Europe/Amsterdam',capacity integer not null check(capacity between 1 and 10000),revision integer not null default 1,check(ends_at>starts_at)
);
alter table dartflow_private.club_activities add column if not exists location text not null default '';
alter table dartflow_private.club_activities add column if not exists organizer_name text not null default '';
alter table dartflow_private.club_activities add column if not exists type text not null default 'club';
alter table dartflow_private.club_activities add column if not exists organizer_id uuid references dartflow_private.profiles(id);
alter table dartflow_private.club_activities add column if not exists last_change text not null default '';
alter table dartflow_private.club_activities add column if not exists updated_at timestamptz not null default now();
create index if not exists club_activities_club on dartflow_private.club_activities(club_id,starts_at);
create table if not exists dartflow_private.club_activity_entries (
 activity_id uuid not null references dartflow_private.club_activities(id) on delete cascade,user_id uuid not null references dartflow_private.profiles(id) on delete cascade,
 status text not null check(status in('registered','waitlisted')),created_at timestamptz not null default now(),primary key(activity_id,user_id)
);
create table if not exists dartflow_private.club_tasks (
 id uuid primary key,club_id uuid not null references dartflow_private.clubs(id) on delete cascade,title text not null,description text not null default '',
 owner_id uuid references dartflow_private.profiles(id),deadline timestamptz,status text not null check(status in('open','in_progress','done')),capacity integer not null check(capacity between 1 and 1000),
 revision integer not null default 1,private_note text not null default '',activity jsonb not null default '[]'
);
alter table dartflow_private.club_tasks add column if not exists starts_at timestamptz;
alter table dartflow_private.club_tasks add column if not exists ends_at timestamptz;
alter table dartflow_private.club_tasks add column if not exists function text not null default '';
alter table dartflow_private.club_tasks add column if not exists activity_id uuid references dartflow_private.club_activities(id) on delete set null;
alter table dartflow_private.club_tasks drop constraint if exists club_tasks_time_window;
alter table dartflow_private.club_tasks add constraint club_tasks_time_window check((starts_at is null and ends_at is null)or(starts_at is not null and ends_at>starts_at));
create table if not exists dartflow_private.club_task_volunteers (
 task_id uuid not null references dartflow_private.club_tasks(id) on delete cascade,user_id uuid not null references dartflow_private.profiles(id) on delete cascade,primary key(task_id,user_id)
);
create table if not exists dartflow_private.clubhouse_receipts (
 user_id uuid not null references dartflow_private.profiles(id) on delete cascade,request_id uuid not null,club_id uuid not null references dartflow_private.clubs(id) on delete cascade,payload_hash text not null,created_at timestamptz not null default now(),primary key(user_id,request_id)
);
create table if not exists dartflow_private.clubhouse_audit (
 id uuid primary key,club_id uuid not null references dartflow_private.clubs(id) on delete cascade,actor_id uuid references dartflow_private.profiles(id) on delete set null,action text not null,detail jsonb not null,created_at timestamptz not null default now()
);
create table if not exists dartflow_private.club_ownership_transfers (
 id uuid primary key,club_id uuid not null references dartflow_private.clubs(id) on delete cascade,owner_id uuid not null references dartflow_private.profiles(id),recipient_id uuid not null references dartflow_private.profiles(id),expires_at timestamptz not null,status text not null check(status in('pending','accepted','cancelled')),check(owner_id<>recipient_id)
);
create unique index if not exists club_ownership_pending on dartflow_private.club_ownership_transfers(club_id) where status='pending';
create table if not exists dartflow_private.club_calendar_feeds (
 user_id uuid not null references dartflow_private.profiles(id) on delete cascade,club_id uuid not null references dartflow_private.clubs(id) on delete cascade,token_hash text not null unique,expires_at timestamptz not null,primary key(user_id,club_id)
);
create table if not exists dartflow_private.club_channels (
 id uuid primary key,club_id uuid not null references dartflow_private.clubs(id) on delete cascade,name text not null,kind text not null check(kind in('team','board')),
 team_id uuid references dartflow_private.club_teams(id) on delete cascade,write_policy text not null default 'members' check(write_policy in('members','managers')),active boolean not null default true,revision integer not null default 1,check((kind='team')=(team_id is not null))
);
create table if not exists dartflow_private.club_channel_messages (
 id uuid primary key,channel_id uuid not null references dartflow_private.club_channels(id) on delete cascade,sequence bigint generated always as identity,
 author_id uuid not null references dartflow_private.profiles(id),body text not null,created_at timestamptz not null default now(),deleted boolean not null default false
);
create index if not exists club_channel_messages_scope on dartflow_private.club_channel_messages(channel_id,sequence);
create table if not exists dartflow_private.club_channel_reads (
 channel_id uuid not null references dartflow_private.club_channels(id) on delete cascade,user_id uuid not null references dartflow_private.profiles(id) on delete cascade,cursor bigint not null default 0,primary key(channel_id,user_id)
);
create table if not exists dartflow_private.club_general_chat_reads (
 club_id uuid not null references dartflow_private.clubs(id) on delete cascade,user_id uuid not null references dartflow_private.profiles(id) on delete cascade,cursor bigint not null default 0,primary key(club_id,user_id)
);
alter table dartflow_private.feed_items add column if not exists content_revision integer not null default 1;
create table if not exists dartflow_private.feed_attachments (
 id uuid primary key,item_id uuid not null references dartflow_private.feed_items(id) on delete cascade,name text not null,mime text not null check(mime='image/webp'),data text not null check(octet_length(data)<=180000)
);
create table if not exists dartflow_private.feed_polls (
 id uuid primary key,item_id uuid not null unique references dartflow_private.feed_items(id) on delete cascade,ends_at timestamptz not null,multiple boolean not null,allow_change boolean not null,options jsonb not null check(jsonb_typeof(options)='array' and jsonb_array_length(options) between 2 and 8)
);
create table if not exists dartflow_private.feed_poll_votes (
 poll_id uuid not null references dartflow_private.feed_polls(id) on delete cascade,user_id uuid not null references dartflow_private.profiles(id) on delete cascade,option_id uuid not null,created_at timestamptz not null default now(),primary key(poll_id,user_id,option_id)
);
create table if not exists dartflow_private.feed_content_audit (
 id uuid primary key,item_id uuid not null references dartflow_private.feed_items(id) on delete cascade,actor_id uuid references dartflow_private.profiles(id) on delete set null,action text not null,detail jsonb not null,created_at timestamptz not null default now()
);
alter table dartflow_private.club_invites add column if not exists invited_role text not null default 'member';
alter table dartflow_private.club_roles drop constraint if exists club_roles_permissions_check;
alter table dartflow_private.club_roles add constraint club_roles_permissions_check check(permissions <@ array['members.invite','members.approve','members.manage','chat.moderate','competitions.manage','tournaments.manage','settings.edit','branding.manage','calendar.manage','teams.manage','tasks.manage','dues.manage','channels.manage']::text[]);
do $$declare t text;r text;begin
 foreach t in array array['club_branding_entitlements','club_branding_versions','club_branding_history','player_theme_preferences','club_teams','club_activities','club_activity_entries','club_tasks','club_task_volunteers','clubhouse_receipts','clubhouse_audit','club_ownership_transfers','club_calendar_feeds','club_channels','club_channel_messages','club_channel_reads','club_general_chat_reads','feed_attachments','feed_polls','feed_poll_votes','feed_content_audit'] loop
 execute format('alter table dartflow_private.%I enable row level security',t);
 execute format('revoke all on dartflow_private.%I from public',t);
 foreach r in array array['anon','authenticated','service_role'] loop
 if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on dartflow_private.%I from %I',t,r);end if;
 end loop;
 execute format('grant select,insert,update,delete on dartflow_private.%I to dartflow_app',t);
 execute format('drop policy if exists clubhouse_runtime on dartflow_private.%I',t);
 execute format('create policy clubhouse_runtime on dartflow_private.%I to dartflow_app using(true) with check(true)',t);
 end loop;
end$$;
revoke update,delete on dartflow_private.clubhouse_audit,dartflow_private.feed_content_audit,dartflow_private.club_branding_history,dartflow_private.clubhouse_receipts from dartflow_app;
grant usage,select on sequence dartflow_private.club_channel_messages_sequence_seq to dartflow_app;
-- A departed member cannot retain a future place, volunteer slot or calendar token.
-- Preserve completed activities and immutable competition/team snapshots.
create or replace function dartflow_private.cleanup_clubhouse_departure()returns trigger language plpgsql set search_path='' as $$
declare item record;remaining integer;begin
 for item in select a.id,a.capacity from dartflow_private.club_activities a join dartflow_private.club_activity_entries e on e.activity_id=a.id where a.club_id=old.club_id and e.user_id=old.user_id and a.starts_at>clock_timestamp() order by a.id for update of a loop
  delete from dartflow_private.club_activity_entries where activity_id=item.id and user_id=old.user_id;
  select greatest(0,item.capacity-count(*)::integer)into remaining from dartflow_private.club_activity_entries where activity_id=item.id and status='registered';
  update dartflow_private.club_activity_entries set status='registered' where(activity_id,user_id)in(
   select e.activity_id,e.user_id from dartflow_private.club_activity_entries e join dartflow_private.platform_members m on m.entity_id=old.club_id and m.user_id=e.user_id and m.status='active' join dartflow_private.club_memberships c on c.club_id=old.club_id and c.user_id=e.user_id where e.activity_id=item.id and e.status='waitlisted' order by e.created_at,e.user_id limit remaining);
 end loop;
 delete from dartflow_private.club_task_volunteers v using dartflow_private.club_tasks t where v.task_id=t.id and t.club_id=old.club_id and t.status<>'done' and v.user_id=old.user_id;
 delete from dartflow_private.club_calendar_feeds where club_id=old.club_id and user_id=old.user_id;
 return old;
end$$;
revoke all on function dartflow_private.cleanup_clubhouse_departure()from public;
drop trigger if exists clubhouse_departure on dartflow_private.club_memberships;
create trigger clubhouse_departure after delete on dartflow_private.club_memberships for each row execute function dartflow_private.cleanup_clubhouse_departure();
-- Account erasure runs only after a durable confirmed job and its exact worker
-- lease have been checked by erase_account_job. This helper has no public or
-- runtime entry point; it inherits that function's owner context.
create or replace function dartflow_private.scrub_clubhouse_account(actor uuid)returns void
language plpgsql set search_path=pg_catalog,dartflow_private as $$
begin
 update dartflow_private.club_channel_messages set body='Verwijderd',deleted=true,sequence=default
 where author_id=actor and(not deleted or body<>'Verwijderd');
 delete from dartflow_private.feed_attachments where item_id in(select id from dartflow_private.feed_items where author_id=actor);
 delete from dartflow_private.feed_poll_votes where user_id=actor;
 delete from dartflow_private.feed_polls where item_id in(select id from dartflow_private.feed_items where author_id=actor);
 delete from dartflow_private.player_theme_preferences where user_id=actor;
 delete from dartflow_private.club_calendar_feeds where user_id=actor;
 delete from dartflow_private.club_channel_reads where user_id=actor;
 delete from dartflow_private.club_general_chat_reads where user_id=actor;
 delete from dartflow_private.club_activity_entries where user_id=actor;
 delete from dartflow_private.club_task_volunteers where user_id=actor;
 update dartflow_private.club_tasks set owner_id=null where owner_id=actor;
 update dartflow_private.club_activities set organizer_id=null,organizer_name='Verwijderde speler' where organizer_id=actor;
 update dartflow_private.club_ownership_transfers set status='cancelled' where status='pending'and(owner_id=actor or recipient_id=actor);
 delete from dartflow_private.clubhouse_receipts where user_id=actor;
 -- Unpublished personal work is erased. Published club configuration, its
 -- bookings and official results remain; the existing stable-ID JSON scrubber
 -- anonymizes participant labels in the shared records and cached receipts.
 delete from dartflow_private.competition_wizard_receipts where actor_id=actor or draft_id in(select id from dartflow_private.competition_wizard_drafts where owner_id=actor and status='draft');
 delete from dartflow_private.competition_wizard_drafts where owner_id=actor and status='draft';
end$$;
revoke all on function dartflow_private.scrub_clubhouse_account(uuid)from public,dartflow_app,dartflow_privacy_worker;
do $$declare definition text;r text;begin
 foreach r in array array['anon','authenticated','service_role']loop
  if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on function dartflow_private.scrub_clubhouse_account(uuid)from %I',r);end if;
 end loop;
 definition=pg_get_functiondef('dartflow_private.erase_account_job(uuid,uuid)'::regprocedure);
 if position('perform dartflow_private.scrub_clubhouse_account(a);'in definition)=0 then
  if position('delete from dartflow_private.club_memberships where user_id=a;'in definition)=0 then raise exception 'Account erasure integration anchor missing';end if;
  -- Departure triggers first promote waiting members into the released future
  -- places; erasure then removes the remaining historical personal entries.
  definition=replace(definition,'delete from dartflow_private.club_memberships where user_id=a;','delete from dartflow_private.club_memberships where user_id=a;'||chr(10)||' perform dartflow_private.scrub_clubhouse_account(a);');
  execute definition;
 end if;
end$$;
insert into dartflow_private.feature_versions(name,version)values('clubhouse',1)on conflict(name)do update set version=excluded.version;
commit;
