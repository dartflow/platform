begin;
create table if not exists dartflow_private.feed_preferences(
 user_id uuid not null references dartflow_private.profiles on delete cascade,channel text not null,
 following boolean not null,mode text not null default 'all' check(mode in('all','important','muted')),primary key(user_id,channel)
);
create table if not exists dartflow_private.feed_policies(
 channel text primary key,members_can_post boolean not null default true,reactions boolean not null default true,
 max_pin_days integer not null default 7 check(max_pin_days in(1,3,7)),updated_by uuid references dartflow_private.profiles
);
create table if not exists dartflow_private.feed_items(
 id uuid primary key,channel text not null,author_id uuid not null references dartflow_private.profiles,
 category text not null check(category in('post','result','event','update','achievement')),
 title text not null default '',body text not null default '',important boolean not null default false,
 source_kind text check(source_kind in('match','encounter','event')),source_id uuid,source_revision integer,
 dedupe_key text unique,deleted boolean not null default false,pin_until timestamptz,legacy_community boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check(length(body)<=4000 and length(title)<=160),check((source_id is null)=(source_kind is null))
);
alter table dartflow_private.feed_items add column if not exists legacy_community boolean not null default false;
create index if not exists feed_items_channel_page on dartflow_private.feed_items(channel,created_at desc,id desc) where not deleted;
create index if not exists feed_items_source on dartflow_private.feed_items(source_kind,source_id);
create index if not exists feed_items_author on dartflow_private.feed_items(author_id);
create index if not exists feed_policies_updated_by on dartflow_private.feed_policies(updated_by);
create table if not exists dartflow_private.feed_likes(item_id uuid not null references dartflow_private.feed_items on delete cascade,user_id uuid not null references dartflow_private.profiles on delete cascade,primary key(item_id,user_id));
create index if not exists feed_likes_user on dartflow_private.feed_likes(user_id);
create table if not exists dartflow_private.feed_replies(id uuid primary key,item_id uuid not null references dartflow_private.feed_items on delete cascade,author_id uuid not null references dartflow_private.profiles,body text not null check(length(btrim(body)) between 1 and 4000),created_at timestamptz not null default clock_timestamp());
alter table dartflow_private.feed_replies drop constraint if exists feed_replies_body_check;
alter table dartflow_private.feed_replies add constraint feed_replies_body_check check(length(btrim(body)) between 1 and 4000);
create index if not exists feed_replies_item_page on dartflow_private.feed_replies(item_id,created_at,id);
create index if not exists feed_replies_author on dartflow_private.feed_replies(author_id);
create table if not exists dartflow_private.feed_shares(
 id uuid primary key,source_kind text not null check(source_kind in('match','encounter')),source_id uuid not null,
 created_by uuid not null references dartflow_private.profiles,audience text not null check(audience in('private','club','public')),
 club_id uuid,revoked_at timestamptz,created_at timestamptz not null default clock_timestamp()
);
create index if not exists feed_shares_source on dartflow_private.feed_shares(source_kind,source_id);
create index if not exists feed_shares_creator on dartflow_private.feed_shares(created_by);
create table if not exists dartflow_private.feed_receipts(actor_id uuid not null references dartflow_private.profiles on delete cascade,request_id uuid not null,fingerprint text not null,response jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(actor_id,request_id));
do $$ declare item text; begin
 foreach item in array array['feed_preferences','feed_policies','feed_items','feed_likes','feed_replies','feed_shares','feed_receipts'] loop
  execute format('alter table dartflow_private.%I enable row level security',item);
  if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename=item and policyname='server_runtime') then execute format('create policy server_runtime on dartflow_private.%I to dartflow_app using(true) with check(true)',item);end if;
  execute format('revoke all on dartflow_private.%I from public',item);
  if exists(select 1 from pg_roles where rolname='anon') then execute format('revoke all on dartflow_private.%I from anon',item);end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then execute format('revoke all on dartflow_private.%I from authenticated',item);end if;
  if exists(select 1 from pg_roles where rolname='service_role') then execute format('revoke all on dartflow_private.%I from service_role',item);end if;
 end loop;
end $$;
grant select,insert,update on dartflow_private.feed_preferences,dartflow_private.feed_policies,dartflow_private.feed_items,dartflow_private.feed_shares to dartflow_app;
grant select,insert,delete on dartflow_private.feed_likes to dartflow_app;
grant select,insert,delete on dartflow_private.feed_replies to dartflow_app;
grant select,insert on dartflow_private.feed_receipts to dartflow_app;
insert into dartflow_private.feature_versions(name,version) values('feed_channels',1) on conflict(name) do update set version=excluded.version;
commit;
