begin;

-- Additive connector state; legacy editorial/API records retain their null destination.
alter table dartflow_private.blog_posts add column if not exists destination_id text;
alter table dartflow_private.blog_media add column if not exists destination_id text;
alter table dartflow_private.blog_receipts add column if not exists destination_id text not null default '';
alter table dartflow_private.blog_tokens add column if not exists connection_id text;
alter table dartflow_private.blog_tokens add column if not exists destination_id text;
alter table dartflow_private.blog_tokens add column if not exists credential_state text not null default 'active' check(credential_state in('pending','active'));
alter table dartflow_private.blog_tokens add column if not exists provisioning_expires_at timestamptz;
alter table dartflow_private.blog_posts drop constraint if exists blog_posts_site_id_environment_external_id_key;
create unique index if not exists blog_posts_destination_external on dartflow_private.blog_posts(site_id,environment,coalesce(destination_id,''),external_id);
alter table dartflow_private.blog_receipts drop constraint if exists blog_receipts_pkey;
alter table dartflow_private.blog_receipts add primary key(site_id,environment,destination_id,operation,key);
create index if not exists blog_media_destination on dartflow_private.blog_media(site_id,environment,destination_id,id);

create table if not exists dartflow_private.socialhero_settings(
 site_id text not null,environment text not null check(environment in('development','staging','production')),
 publish_enabled boolean not null default false,current_attempt uuid,primary key(site_id,environment)
);
create table if not exists dartflow_private.socialhero_connections(
 id uuid primary key,site_id text not null,environment text not null,origin text not null,provider_origin text not null,
 code_hash text not null,connection_id text,destination_id text,token_id uuid references dartflow_private.blog_tokens(id),
 status text not null check(status in('claiming','pending','active','rejected','expired','disconnected')),
 expires_at timestamptz,temporary_secret jsonb,created_by uuid not null references dartflow_private.profiles(id),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(site_id,environment,connection_id)
);
create index if not exists socialhero_connections_site on dartflow_private.socialhero_connections(site_id,environment,created_at desc);
create index if not exists socialhero_connections_token on dartflow_private.socialhero_connections(token_id);
do $$ declare t text;r text;begin
 foreach t in array array['socialhero_settings','socialhero_connections']loop
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
insert into dartflow_private.feature_versions(name,version)values('socialhero_connector',1)on conflict(name)do update set version=excluded.version;
commit;
