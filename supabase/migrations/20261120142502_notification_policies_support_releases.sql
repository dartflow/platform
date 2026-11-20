begin;
create table if not exists dartflow_private.notification_preferences(
 user_id uuid not null references dartflow_private.profiles(id) on delete cascade,
 category text not null, channel text not null check(channel in('inbox','email','push')),
 enabled boolean not null, updated_at timestamptz not null default now(),primary key(user_id,category,channel)
);
create table if not exists dartflow_private.notification_rules(
 environment text not null,event_id text not null,channel text not null check(channel in('inbox','email','push')),
 mode text not null check(mode in('follow','on','off')),revision integer not null default 1,
 updated_by uuid references dartflow_private.profiles(id) on delete set null,updated_at timestamptz not null default now(),
 primary key(environment,event_id,channel)
);
create table if not exists dartflow_private.notification_rule_audit(
 id uuid primary key,environment text not null,event_id text not null,channel text not null,
 actor_id uuid references dartflow_private.profiles(id) on delete set null,
 old_mode text not null,new_mode text not null,created_at timestamptz not null default now()
);
create table if not exists dartflow_private.notification_commands(
 environment text not null,actor_id uuid not null references dartflow_private.profiles(id) on delete cascade,
 request_id uuid not null,payload_hash text not null,response jsonb not null,created_at timestamptz not null default now(),
 primary key(environment,actor_id,request_id)
);
create table if not exists dartflow_private.notification_product_subscriptions(
 user_id uuid not null references dartflow_private.profiles(id) on delete cascade,
 product text not null check(product in('dartflow','oche-live')),channel text not null check(channel in('web','android')),
 enabled boolean not null default true,expires_at timestamptz not null,updated_at timestamptz not null default now(),
 primary key(user_id,product,channel)
);
create table if not exists dartflow_private.product_releases(
 id uuid primary key,product text not null check(product in('dartflow','oche-live')),
 channel text not null check(channel in('web','android','all')),version text not null,title text not null,body text not null,
 revision integer not null default 1,status text not null default 'draft' check(status in('draft','published')),
 author_id uuid references dartflow_private.profiles(id) on delete set null,
 published_by uuid references dartflow_private.profiles(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),published_at timestamptz,
 unique(product,channel,version),check((status='published')=(published_at is not null))
);
create index if not exists product_releases_publication on dartflow_private.product_releases(product,channel,published_at desc)where status='published';
create table if not exists dartflow_private.notification_previews(
 id uuid primary key,environment text not null,actor_id uuid not null references dartflow_private.profiles(id) on delete cascade,
 draft jsonb not null,projection jsonb not null,audience_hash text not null,expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create table if not exists dartflow_private.notification_campaigns(
 id uuid primary key,environment text not null,preview_id uuid not null unique,
 actor_id uuid references dartflow_private.profiles(id) on delete set null,
 kind text not null check(kind in('release','platform')),release_id uuid references dartflow_private.product_releases(id),
 title text not null,body text not null,href text not null,
 product text not null check(product in('dartflow','oche-live')),channel text not null check(channel in('web','android','all')),
 audience jsonb not null,recipient_count integer not null,inbox_count integer not null,push_count integer not null,
 created_at timestamptz not null default now()
);
create table if not exists dartflow_private.notification_campaign_recipients(
 campaign_id uuid not null references dartflow_private.notification_campaigns(id) on delete cascade,
 recipient_id uuid not null references dartflow_private.profiles(id) on delete cascade,
 status text not null default 'queued' check(status in('queued','enqueued','ineligible')),
 created_at timestamptz not null default now(),primary key(campaign_id,recipient_id)
);
create index if not exists notification_campaign_recipient on dartflow_private.notification_campaign_recipients(recipient_id);
create table if not exists dartflow_private.notification_test_messages(
 id uuid primary key,environment text not null,actor_id uuid references dartflow_private.profiles(id) on delete set null,
 recipient_id uuid not null references dartflow_private.profiles(id) on delete cascade,
 title text not null,body text not null,href text,expires_at timestamptz not null,created_at timestamptz not null default now()
);
create table if not exists dartflow_private.web_push_keys(
 environment text primary key,public_key text not null,private_cipher jsonb not null,created_at timestamptz not null default now()
);
create table if not exists dartflow_private.web_push_subscriptions(
 id uuid primary key,environment text not null,user_id uuid not null references dartflow_private.profiles(id) on delete cascade,
 installation_id uuid not null,endpoint_hash text not null,subscription_cipher jsonb not null,
 enabled boolean not null default true,expires_at timestamptz not null,last_seen_at timestamptz not null default now(),
 unique(environment,installation_id),unique(environment,endpoint_hash)
);
create index if not exists web_push_subscriptions_user on dartflow_private.web_push_subscriptions(user_id);
create table if not exists dartflow_private.web_push_outbox(
 id uuid primary key,inbox_id uuid not null references dartflow_private.native_push_inbox(id) on delete cascade,
 subscription_id uuid not null references dartflow_private.web_push_subscriptions(id) on delete cascade,
 status text not null default 'queued' check(status in('queued','processing','retry','accepted','received','opened','expired','suppressed','failed','uncertain')),
 attempts integer not null default 0,available_at timestamptz not null default now(),claim_token uuid,lease_until timestamptz,
 error_category text,provider_accepted_at timestamptz,received_at timestamptz,opened_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(inbox_id,subscription_id)
);
create index if not exists web_push_outbox_due on dartflow_private.web_push_outbox(available_at)where status in('queued','retry','processing');
alter table dartflow_private.web_push_outbox add column if not exists received_at timestamptz;
alter table dartflow_private.web_push_outbox drop constraint if exists web_push_outbox_status_check;
alter table dartflow_private.web_push_outbox add constraint web_push_outbox_status_check check(status in('queued','processing','retry','accepted','received','opened','expired','suppressed','failed','uncertain'));
alter table dartflow_private.native_push_inbox drop constraint if exists native_push_inbox_category_check;
alter table dartflow_private.native_push_inbox add constraint native_push_inbox_category_check check(category in('Sociaal','Wedstrijden','Competitie','Toernooien','Vereniging','Supporttickets','Productreleases','Platformberichten','Beveiliging','Reserveringen','Moderatie','Chat'));
alter table dartflow_private.native_push_inbox add column if not exists inbox_allowed boolean not null default true;
-- All personal data stays behind the existing server principal; no Data API access.
do $$declare t text;r text;begin
 foreach t in array array['notification_preferences','notification_rules','notification_rule_audit','notification_commands','notification_product_subscriptions','product_releases','notification_previews','notification_campaigns','notification_campaign_recipients','notification_test_messages','web_push_keys','web_push_subscriptions','web_push_outbox']loop
  execute format('alter table dartflow_private.%I enable row level security',t);
  foreach r in array array['public','anon','authenticated','service_role']loop
   if r='public' or exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on dartflow_private.%I from %I',t,r);end if;
  end loop;
  execute format('grant select,insert,update,delete on dartflow_private.%I to dartflow_app',t);
  execute format('drop policy if exists notification_runtime on dartflow_private.%I',t);
  execute format('create policy notification_runtime on dartflow_private.%I to dartflow_app using(true)with check(true)',t);
 end loop;
end$$;
-- Receipts, audit and confirmed campaign manifests are append-only for runtime.
revoke update,delete on dartflow_private.notification_commands,dartflow_private.notification_rule_audit,dartflow_private.notification_campaigns,dartflow_private.notification_test_messages,dartflow_private.web_push_keys from dartflow_app;
revoke update,delete on dartflow_private.notification_previews from dartflow_app;
grant update(expires_at)on dartflow_private.notification_previews to dartflow_app;
revoke update,delete on dartflow_private.notification_campaign_recipients from dartflow_app;
grant update(status)on dartflow_private.notification_campaign_recipients to dartflow_app;
revoke delete on dartflow_private.notification_rules from dartflow_app;
revoke update,delete on dartflow_private.product_releases from dartflow_app;
grant update(product,channel,version,title,body,revision,status,published_by,published_at,updated_at)on dartflow_private.product_releases to dartflow_app;
-- The existing soft-deletion trigger also revokes browser installations immediately.
create or replace function dartflow_private.erase_native_push_on_account_removal()returns trigger language plpgsql set search_path=pg_catalog,dartflow_private,pg_temp as $$
begin
 if new.deletion_requested_at is not null or new.deleted_at is not null then
  delete from dartflow_private.native_push_devices where user_id=new.id;
  delete from dartflow_private.native_push_inbox where recipient_id=new.id;
  delete from dartflow_private.web_push_subscriptions where user_id=new.id;
 end if;return new;
end$$;
revoke all on function dartflow_private.erase_native_push_on_account_removal()from public;
-- The existing confirmed privacy job invokes this owner-only helper. No new definer entry point.
create or replace function dartflow_private.scrub_notification_account(actor uuid)returns void
language plpgsql set search_path=pg_catalog,dartflow_private as $$
begin
 delete from dartflow_private.notification_preferences where user_id=actor;
 delete from dartflow_private.notification_product_subscriptions where user_id=actor;
 delete from dartflow_private.notification_commands where actor_id=actor or response::text like '%'||actor::text||'%';
 delete from dartflow_private.notification_previews where actor_id=actor or draft::text like '%'||actor::text||'%';
 delete from dartflow_private.notification_campaign_recipients where recipient_id=actor;
 delete from dartflow_private.notification_test_messages where recipient_id=actor or actor_id=actor;
 delete from dartflow_private.web_push_subscriptions where user_id=actor;
 update dartflow_private.notification_campaigns set actor_id=null,audience='{"kind":"erased"}'::jsonb where actor_id=actor;
 update dartflow_private.notification_campaigns c set audience=jsonb_set(audience,'{userIds}',coalesce((select jsonb_agg(v)from jsonb_array_elements(coalesce(c.audience->'userIds','[]'))v where v<>to_jsonb(actor::text)),'[]'::jsonb))where audience->'userIds' @> to_jsonb(array[actor::text]);
 update dartflow_private.notification_rule_audit set actor_id=null where actor_id=actor;
 update dartflow_private.notification_rules set updated_by=null where updated_by=actor;
 delete from dartflow_private.product_releases where author_id=actor and status='draft';
 update dartflow_private.product_releases set author_id=null where author_id=actor;
 update dartflow_private.product_releases set published_by=null where published_by=actor;
end$$;
revoke all on function dartflow_private.scrub_notification_account(uuid)from public,dartflow_app,dartflow_privacy_worker;
do $$declare definition text;r text;begin
 foreach r in array array['anon','authenticated','service_role']loop
  if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on function dartflow_private.scrub_notification_account(uuid)from %I',r);end if;
 end loop;
 definition=pg_get_functiondef('dartflow_private.erase_account_job(uuid,uuid)'::regprocedure);
 if position('perform dartflow_private.scrub_notification_account(a);'in definition)=0 then
  if position('delete from dartflow_private.club_memberships where user_id=a;'in definition)=0 then raise exception 'Account erasure integration anchor missing';end if;
  definition=replace(definition,'delete from dartflow_private.club_memberships where user_id=a;','delete from dartflow_private.club_memberships where user_id=a;'||chr(10)||' perform dartflow_private.scrub_notification_account(a);');execute definition;
 end if;
end$$;
insert into dartflow_private.feature_versions(name,version)values('notification_policies',1),('product_releases',1)on conflict(name)do update set version=excluded.version;
commit;
