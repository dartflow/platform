begin;
create table if not exists dartflow_private.blog_taxonomy(
 site_id text not null,environment text not null check(environment in('development','staging','production')),
 kind text not null check(kind in('author','category')),id text not null check(id~'^[a-z0-9][a-z0-9-]{0,99}$'),
 name text not null check(length(btrim(name)) between 1 and 120),active boolean not null default true,
 revision integer not null default 1 check(revision>0),updated_by uuid references dartflow_private.profiles(id),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 primary key(site_id,environment,kind,id)
);
with scopes as(
 select site_id,environment from dartflow_private.blog_posts
 union select site_id,environment from dartflow_private.blog_tokens
 union select site_id,environment from dartflow_private.socialhero_settings
 union select 'dartflow',unnest(array['development','staging','production'])
),defaults(kind,id,name)as(values
 ('author','redactie','DartFlow redactie'),('category','toernooien','Toernooien'),
 ('category','competities','Competities'),('category','verenigingen','Verenigingen'),
 ('category','oche-live','Oche Live'),('category','training','Training'),
 ('category','nieuws','Nieuws'),('category','tips','Tips & inspiratie')
)
insert into dartflow_private.blog_taxonomy(site_id,environment,kind,id,name)
 select s.site_id,s.environment,d.kind,d.id,d.name from scopes s cross join defaults d
 on conflict(site_id,environment,kind,id)do nothing;
alter table dartflow_private.blog_taxonomy enable row level security;
revoke all on dartflow_private.blog_taxonomy from public;
do $$declare role_name text;begin
 foreach role_name in array array['anon','authenticated','service_role']loop
  if exists(select 1 from pg_roles where rolname=role_name)then
   execute format('revoke all on dartflow_private.blog_taxonomy from %I',role_name);
  end if;
 end loop;
end $$;
drop policy if exists app_access on dartflow_private.blog_taxonomy;
create policy app_access on dartflow_private.blog_taxonomy to dartflow_app using(true)with check(true);
grant select,insert,update on dartflow_private.blog_taxonomy to dartflow_app;
insert into dartflow_private.feature_versions(name,version)values('blog_taxonomy',1)
 on conflict(name)do update set version=excluded.version;
commit;
