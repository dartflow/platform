begin;
create table if not exists dartflow_private.blog_posts(
 id uuid primary key,site_id text not null,environment text not null check(environment in('development','staging','production')),
 external_id text,draft_revision integer not null default 0,live_revision integer,
 status text not null default 'draft' check(status in('draft','scheduled','published','archived')),
 first_published_at timestamptz,published_at timestamptz,scheduled_at timestamptz,scheduled_revision integer,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(site_id,environment,external_id),check((scheduled_at is null)=(scheduled_revision is null))
);
create table if not exists dartflow_private.blog_revisions(
 post_id uuid not null references dartflow_private.blog_posts(id) on delete cascade,revision integer not null check(revision>0),
 schema_version integer not null default 1 check(schema_version=1),data jsonb not null,
 created_by uuid references dartflow_private.profiles(id),created_at timestamptz not null default clock_timestamp(),primary key(post_id,revision)
);
create table if not exists dartflow_private.blog_routes(
 site_id text not null,environment text not null,slug text not null,post_id uuid not null references dartflow_private.blog_posts(id) on delete cascade,
 was_live boolean not null default false,created_at timestamptz not null default clock_timestamp(),primary key(site_id,environment,slug)
);
create table if not exists dartflow_private.blog_media(
 id uuid primary key,site_id text not null,environment text not null,mime text not null check(mime in('image/png','image/jpeg','image/webp')),
 width integer not null check(width>0 and width<=12000),height integer not null check(height>0 and height<=12000),
 checksum text not null,bytes bytea not null check(octet_length(bytes)<=12000000),created_by uuid references dartflow_private.profiles(id),created_at timestamptz not null default clock_timestamp()
);
create table if not exists dartflow_private.blog_tokens(
 id uuid primary key,site_id text not null,environment text not null,name text not null,token_hash text not null unique,prefix text not null,
 scopes jsonb not null,expires_at timestamptz not null,revoked_at timestamptz,created_by uuid not null references dartflow_private.profiles(id),created_at timestamptz not null default clock_timestamp()
);
create table if not exists dartflow_private.blog_receipts(
 site_id text not null,environment text not null,operation text not null,key text not null,fingerprint text not null,response jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(site_id,environment,operation,key)
);
create table if not exists dartflow_private.blog_audit(
 id bigint generated always as identity primary key,site_id text not null,environment text not null,operation text not null,
 post_id uuid references dartflow_private.blog_posts(id) on delete set null,actor_id uuid references dartflow_private.profiles(id),
 metadata jsonb not null default '{}',created_at timestamptz not null default clock_timestamp()
);
create table if not exists dartflow_private.blog_invalidation(
 post_id uuid not null references dartflow_private.blog_posts(id) on delete cascade,revision integer not null,processed_at timestamptz,created_at timestamptz not null default clock_timestamp(),primary key(post_id,revision)
);
create index if not exists blog_posts_live on dartflow_private.blog_posts(site_id,environment,first_published_at desc,id) where live_revision is not null and status<>'archived';
create index if not exists blog_posts_scheduled on dartflow_private.blog_posts(site_id,environment,scheduled_at,id) where scheduled_revision is not null;
create index if not exists blog_routes_post on dartflow_private.blog_routes(post_id);
create index if not exists blog_media_scope on dartflow_private.blog_media(site_id,environment,created_at desc);
create index if not exists blog_audit_created on dartflow_private.blog_audit(site_id,environment,created_at desc);
create index if not exists blog_invalidation_pending on dartflow_private.blog_invalidation(created_at) where processed_at is null;
do $$ declare t text;r text;begin
 foreach t in array array['blog_posts','blog_revisions','blog_routes','blog_media','blog_tokens','blog_receipts','blog_audit','blog_invalidation']loop
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
-- Revisions and receipts are immutable to the runtime; all edits append new rows.
revoke update,delete on dartflow_private.blog_revisions,dartflow_private.blog_receipts,dartflow_private.blog_audit from dartflow_app;
grant usage,select on sequence dartflow_private.blog_audit_id_seq to dartflow_app;
insert into dartflow_private.feature_versions(name,version)values('blog_publication',1)on conflict(name)do update set version=excluded.version;
commit;
