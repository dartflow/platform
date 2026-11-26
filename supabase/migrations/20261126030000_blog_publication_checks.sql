begin;
create table if not exists dartflow_private.blog_publication_checks(
 post_id uuid not null,revision integer not null,site_id text not null,environment text not null,destination_id text not null,
 origin text not null,slug text not null,expected_marker text not null check(expected_marker~'^[a-f0-9]{64}$'),
 state text not null default 'pending' check(state in('pending','confirmed','superseded')),
 attempts integer not null default 0,last_error_code text,checked_at timestamptz,confirmed_at timestamptz,
 next_attempt_at timestamptz not null default clock_timestamp(),created_at timestamptz not null default clock_timestamp(),
 primary key(post_id,revision),foreign key(post_id,revision)references dartflow_private.blog_revisions(post_id,revision)on delete cascade
);
create index if not exists blog_publication_checks_pending on dartflow_private.blog_publication_checks(site_id,environment,next_attempt_at)where state='pending';
alter table dartflow_private.blog_publication_checks enable row level security;
revoke all on dartflow_private.blog_publication_checks from public;
do $$ declare r text;begin
 foreach r in array array['anon','authenticated','service_role']loop
  if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on dartflow_private.blog_publication_checks from %I',r);end if;
 end loop;
end $$;
drop policy if exists app_access on dartflow_private.blog_publication_checks;
create policy app_access on dartflow_private.blog_publication_checks to dartflow_app using(true)with check(true);
grant select,insert,update on dartflow_private.blog_publication_checks to dartflow_app;
insert into dartflow_private.feature_versions(name,version)values('blog_publication_checks',1)on conflict(name)do update set version=excluded.version;
commit;
