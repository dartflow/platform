begin;
-- Personal preferences never confer board or competition rights.
create table if not exists dartflow_private.player_experience (
 user_id uuid primary key references dartflow_private.profiles(id) on delete cascade,
 favorites uuid[] not null default '{}',
 last_games jsonb not null default '{}',
 weekly_goal integer not null default 3 check(weekly_goal between 1 and 14),
 updated_at timestamptz not null default now(),
 check(cardinality(favorites)<=100),check(jsonb_typeof(last_games)='object')
);
alter table dartflow_private.player_experience enable row level security;

create table if not exists dartflow_private.board_screen_preferences (
 board_id uuid primary key references dartflow_private.boards(id) on delete cascade,
 rotation integer not null default 90 check(rotation in(0,90,270)),
 updated_by uuid not null references dartflow_private.profiles(id),
 updated_at timestamptz not null default now()
);
alter table dartflow_private.board_screen_preferences enable row level security;
do $$ declare t text;r text;begin
 foreach t in array array['player_experience','board_screen_preferences'] loop
  execute format('revoke all on dartflow_private.%I from public',t);
  foreach r in array array['anon','authenticated','service_role'] loop
   if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on dartflow_private.%I from %I',t,r);end if;
  end loop;
  execute format('drop policy if exists runtime_only on dartflow_private.%I',t);
  execute format('create policy runtime_only on dartflow_private.%I to dartflow_app using(true) with check(true)',t);
 end loop;
end $$;
grant select,insert,update,delete on dartflow_private.player_experience to dartflow_app;
grant select,insert,update on dartflow_private.board_screen_preferences to dartflow_app;
alter table dartflow_private.board_screen_devices add column if not exists last_seen_at timestamptz;
grant update(last_seen_at) on dartflow_private.board_screen_devices to dartflow_app;
insert into dartflow_private.feature_versions(name,version) values('player_experience',1) on conflict(name) do update set version=excluded.version;
commit;
