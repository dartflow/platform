-- Private server-only projections. The API checks current scoped access for every request.
begin;
create table if not exists dartflow_private.community_posts (
 id uuid primary key, scope_kind text not null check(scope_kind in ('platform','club','league','tournament')),
 scope_id uuid not null, author_id uuid not null references dartflow_private.profiles,
 parent_id uuid references dartflow_private.community_posts,
 body text not null check(length(btrim(body)) between 1 and 4000), deleted boolean not null default false,
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists community_posts_scope_page on dartflow_private.community_posts(scope_kind,scope_id,created_at desc,id desc) where parent_id is null and not deleted;
create index if not exists community_posts_parent on dartflow_private.community_posts(parent_id,created_at,id);
create index if not exists community_posts_author on dartflow_private.community_posts(author_id);
create table if not exists dartflow_private.community_likes (
 post_id uuid not null references dartflow_private.community_posts, user_id uuid not null references dartflow_private.profiles,
 primary key(post_id,user_id)
);
create index if not exists community_likes_user on dartflow_private.community_likes(user_id);
create table if not exists dartflow_private.community_messages (
 sequence bigint generated always as identity primary key, id uuid not null unique,
 scope_kind text not null check(scope_kind in ('club','league','tournament','match')), scope_id uuid not null,
 author_id uuid not null references dartflow_private.profiles,
 body text not null check(length(btrim(body)) between 1 and 2000), deleted boolean not null default false,
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists community_messages_scope on dartflow_private.community_messages(scope_kind,scope_id,sequence);
create index if not exists community_messages_author on dartflow_private.community_messages(author_id);
-- Preserve existing online/hybrid match conversations when moving to scoped chat.
insert into dartflow_private.community_messages(id,scope_kind,scope_id,author_id,body,created_at)
 select md5('legacy-match-chat:'||s.id::text)::uuid,'match',s.match_id,s.sender_id,s.payload->>'body',s.created_at
 from dartflow_private.platform_signals s join dartflow_private.matches m on m.id=s.match_id
 where s.kind='chat' and m.state->>'scoringMode'='per-player' and jsonb_typeof(s.payload->'body')='string' and length(btrim(s.payload->>'body')) between 1 and 2000
 on conflict(id) do nothing;
create table if not exists dartflow_private.community_moderation (
 scope_kind text not null check(scope_kind in ('club','league','tournament','match')), scope_id uuid not null,
 user_id uuid not null references dartflow_private.profiles, muted_until timestamptz, banned boolean not null default false,
 updated_by uuid not null references dartflow_private.profiles, primary key(scope_kind,scope_id,user_id)
);
create index if not exists community_moderation_user on dartflow_private.community_moderation(user_id);
create index if not exists community_moderation_actor on dartflow_private.community_moderation(updated_by);
-- Public event IDs contain no account IDs, bearer credentials or original request IDs.
create table if not exists dartflow_private.board_score_events (
 id uuid primary key, board_id uuid not null references dartflow_private.boards on delete cascade, source_id uuid not null,
 revision integer not null check(revision>0), ordinal integer not null default 0,
 kind text not null check(kind in ('score','undo')), visit jsonb,
 created_at timestamptz not null default clock_timestamp(), unique(source_id,revision,ordinal)
);
create index if not exists board_score_events_board on dartflow_private.board_score_events(board_id,created_at desc,id desc);
create index if not exists board_score_events_source on dartflow_private.board_score_events(source_id,revision,ordinal);
alter table dartflow_private.board_score_events drop constraint if exists board_score_events_board_id_fkey;
alter table dartflow_private.board_score_events add constraint board_score_events_board_id_fkey foreign key(board_id) references dartflow_private.boards on delete cascade;
do $$ declare item text; begin
 foreach item in array array['community_posts','community_likes','community_messages','community_moderation','board_score_events'] loop
  execute format('alter table dartflow_private.%I enable row level security',item);
  if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename=item and policyname='server_runtime') then
   execute format('create policy server_runtime on dartflow_private.%I to dartflow_app using(true) with check(true)',item);
  end if;
  execute format('revoke all on dartflow_private.%I from public',item);
  if exists(select 1 from pg_roles where rolname='anon') then execute format('revoke all on dartflow_private.%I from anon',item);end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then execute format('revoke all on dartflow_private.%I from authenticated',item);end if;
  if exists(select 1 from pg_roles where rolname='service_role') then execute format('revoke all on dartflow_private.%I from service_role',item);end if;
 end loop;
end $$;
grant select,insert,update on dartflow_private.community_posts,dartflow_private.community_messages,dartflow_private.community_moderation to dartflow_app;
grant select,insert,delete on dartflow_private.community_likes to dartflow_app;
grant select,insert on dartflow_private.board_score_events to dartflow_app;
grant usage,select on sequence dartflow_private.community_messages_sequence_seq to dartflow_app;
insert into dartflow_private.feature_versions(name,version) values('v17_community',1),('v17_score_events',1) on conflict(name) do update set version=excluded.version;
commit;
