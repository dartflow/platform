begin;
create table if not exists dartflow_private.faq_drafts(
 id uuid primary key,question_id text not null unique,revision integer not null check(revision>0),item jsonb not null,
 audience text not null check(audience in('all','player','captain','organizer','club','platform')),
 author_id uuid not null references dartflow_private.profiles(id),updated_at timestamptz not null default clock_timestamp(),
 check(octet_length(item::text)<=24000)
);
create table if not exists dartflow_private.faq_publications(
 id uuid primary key,version text not null unique,items jsonb not null,actor_id uuid not null references dartflow_private.profiles(id),
 reason text not null,created_at timestamptz not null default clock_timestamp(),previous_id uuid references dartflow_private.faq_publications(id)
);
create table if not exists dartflow_private.faq_commands(
 actor_id uuid not null references dartflow_private.profiles(id),request_id uuid not null,payload_hash text not null,response jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(actor_id,request_id)
);
do $$declare t text;r text;begin
 foreach t in array array['faq_drafts','faq_publications','faq_commands']loop
  execute format('alter table dartflow_private.%I enable row level security',t);
  execute format('revoke all on dartflow_private.%I from public',t);
  foreach r in array array['anon','authenticated','service_role']loop
   if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on dartflow_private.%I from %I',t,r);end if;
  end loop;
  execute format('drop policy if exists app_access on dartflow_private.%I',t);
  execute format('create policy app_access on dartflow_private.%I to dartflow_app using(true)with check(true)',t);
  execute format('grant select,insert on dartflow_private.%I to dartflow_app',t);
 end loop;
end $$;
grant update(revision,item,audience,author_id,updated_at) on dartflow_private.faq_drafts to dartflow_app;
revoke update,delete on dartflow_private.faq_publications,dartflow_private.faq_commands from dartflow_app;
insert into dartflow_private.feature_versions(name,version)values('faq_publication',1)on conflict(name)do update set version=excluded.version;
commit;
