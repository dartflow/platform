begin;

create table if not exists dartflow_private.socialhero_destination_policies(
 site_id text not null,environment text not null check(environment in('development','staging','production')),
 destination_id text not null,draft_enabled boolean not null,publish_enabled boolean not null,
 decided_by uuid references dartflow_private.profiles(id),decided_at timestamptz not null default clock_timestamp(),
 decision_source text not null check(decision_source in('legacy','pairing','admin')),
 primary key(site_id,environment,destination_id),check(not publish_enabled or draft_enabled),
 check(decision_source='legacy' or decided_by is not null)
);
create table if not exists dartflow_private.socialhero_permission_events(
 id bigint generated always as identity primary key,
 site_id text not null,environment text not null,destination_id text not null,
 draft_enabled boolean not null,publish_enabled boolean not null,
 actor_id uuid references dartflow_private.profiles(id),source text not null check(source in('legacy','pairing','admin')),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(site_id,environment,destination_id) references dartflow_private.socialhero_destination_policies(site_id,environment,destination_id),
 check(not publish_enabled or draft_enabled),check(source='legacy' or actor_id is not null)
);
create index if not exists socialhero_permission_events_destination on dartflow_private.socialhero_permission_events(site_id,environment,destination_id,id);

-- Old local false values are explicit opt-outs for every already known destination.
-- No historic chooser was recorded: retain that fact instead of attributing a choice.
with known as(
 select distinct on(c.site_id,c.environment,c.destination_id)
 c.site_id,c.environment,c.destination_id,
 coalesce(t.scopes ? 'drafts:write',true) as draft_enabled,
 coalesce(s.publish_enabled,false) and coalesce(t.scopes ? 'drafts:write',true) as publish_enabled
 from dartflow_private.socialhero_connections c
 left join dartflow_private.socialhero_settings s on s.site_id=c.site_id and s.environment=c.environment
 left join dartflow_private.blog_tokens t on t.id=c.token_id
 where c.destination_id is not null
 order by c.site_id,c.environment,c.destination_id,c.created_at desc,c.id desc
),imported as(
 insert into dartflow_private.socialhero_destination_policies(site_id,environment,destination_id,draft_enabled,publish_enabled,decision_source)
 select site_id,environment,destination_id,draft_enabled,publish_enabled,'legacy' from known
 on conflict(site_id,environment,destination_id)do nothing
 returning *
)
insert into dartflow_private.socialhero_permission_events(site_id,environment,destination_id,draft_enabled,publish_enabled,source,created_at)
select site_id,environment,destination_id,draft_enabled,publish_enabled,'legacy',decided_at from imported;

alter table dartflow_private.socialhero_connections add column if not exists requested_draft boolean;
alter table dartflow_private.socialhero_connections add column if not exists requested_publish boolean;
alter table dartflow_private.socialhero_connections add column if not exists last_checked_at timestamptz;
update dartflow_private.socialhero_connections c set
 requested_draft=coalesce(c.requested_draft,(select p.draft_enabled from dartflow_private.socialhero_destination_policies p where p.site_id=c.site_id and p.environment=c.environment and p.destination_id=c.destination_id),true),
 requested_publish=coalesce(c.requested_publish,(select p.publish_enabled from dartflow_private.socialhero_destination_policies p where p.site_id=c.site_id and p.environment=c.environment and p.destination_id=c.destination_id),(select s.publish_enabled from dartflow_private.socialhero_settings s where s.site_id=c.site_id and s.environment=c.environment),false)
where c.requested_draft is null or c.requested_publish is null;
alter table dartflow_private.socialhero_connections alter column requested_draft set default true;
alter table dartflow_private.socialhero_connections alter column requested_publish set default true;
alter table dartflow_private.socialhero_connections alter column requested_draft set not null;
alter table dartflow_private.socialhero_connections alter column requested_publish set not null;

-- Tokens remain the serialized enforcement point for in-flight editorial writes.
update dartflow_private.blog_tokens t set scopes=to_jsonb(array['read']::text[]
 ||case when p.draft_enabled then array['media:write','drafts:write'] else array[]::text[] end
 ||case when p.draft_enabled and p.publish_enabled then array['publish'] else array[]::text[] end)
from dartflow_private.socialhero_destination_policies p
where t.site_id=p.site_id and t.environment=p.environment and t.destination_id=p.destination_id
 and t.connection_id is not null and t.revoked_at is null;

do $$ declare t text;r text;begin
 foreach t in array array['socialhero_destination_policies','socialhero_permission_events']loop
  execute format('alter table dartflow_private.%I enable row level security',t);
  execute format('revoke all on dartflow_private.%I from public',t);
  foreach r in array array['anon','authenticated','service_role']loop
   if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on dartflow_private.%I from %I',t,r);end if;
  end loop;
  execute format('drop policy if exists app_access on dartflow_private.%I',t);
  execute format('create policy app_access on dartflow_private.%I to dartflow_app using(true) with check(true)',t);
 end loop;
end $$;
revoke all on dartflow_private.socialhero_destination_policies,dartflow_private.socialhero_permission_events from dartflow_app;
grant select,insert,update on dartflow_private.socialhero_destination_policies to dartflow_app;
grant select,insert on dartflow_private.socialhero_permission_events to dartflow_app;
grant usage,select on sequence dartflow_private.socialhero_permission_events_id_seq to dartflow_app;
insert into dartflow_private.feature_versions(name,version)values('socialhero_permissions',1)on conflict(name)do update set version=excluded.version;
commit;
