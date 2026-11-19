begin;

-- Additive only: no historical match receives a declaration or rating booking.
create table if not exists dartflow_private.ranking_policies (
 id text primary key,sequence bigint not null default 0 check(sequence>=0),
 published_at timestamptz not null default clock_timestamp()
);
insert into dartflow_private.ranking_policies(id) values('national-x01-2026-11-v1') on conflict(id) do nothing;

create table if not exists dartflow_private.ranking_reservations (
 match_id uuid primary key references dartflow_private.matches(id) on delete cascade,
 policy_version text not null references dartflow_private.ranking_policies(id),
 player_a uuid not null references dartflow_private.profiles(id),
 player_b uuid not null references dartflow_private.profiles(id),
 reserved_at timestamptz not null,first_throw_at timestamptz,
 declaration_revision integer not null check(declaration_revision>=0),
 check(player_a<player_b)
);
create index if not exists ranking_reservation_pair_window on dartflow_private.ranking_reservations(player_a,player_b,reserved_at desc);
create index if not exists ranking_reservation_player_b on dartflow_private.ranking_reservations(player_b);

create table if not exists dartflow_private.ranking_accounts (
 player_id uuid primary key references dartflow_private.profiles(id),
 rating double precision not null default 1500 check(rating>'-Infinity'::float8 and rating<'Infinity'::float8),
 played integer not null default 0 check(played>=0),
 unique_opponents integer not null default 0 check(unique_opponents>=0 and unique_opponents<=played),
 last_played_at timestamptz
);
create index if not exists ranking_account_order on dartflow_private.ranking_accounts(rating desc,player_id);

create table if not exists dartflow_private.ranking_opponents (
 player_id uuid not null references dartflow_private.ranking_accounts(player_id) on delete cascade,
 opponent_id uuid not null references dartflow_private.profiles(id),
 primary key(player_id,opponent_id),check(player_id<>opponent_id)
);
create index if not exists ranking_opponent_inverse on dartflow_private.ranking_opponents(opponent_id);

create table if not exists dartflow_private.ranking_bookings (
 match_id uuid primary key references dartflow_private.matches(id) on delete cascade,
 policy_version text not null references dartflow_private.ranking_policies(id),
 sequence bigint not null check(sequence>0),result_revision integer not null check(result_revision>=0),
 players uuid[] not null check(cardinality(players)=2 and players[1]<>players[2]),
 winner_id uuid not null references dartflow_private.profiles(id),
 before_ratings double precision[] not null check(cardinality(before_ratings)=2),
 after_ratings double precision[] not null check(cardinality(after_ratings)=2),
 deltas double precision[] not null check(cardinality(deltas)=2 and abs(deltas[1]+deltas[2])<1e-10),
 played_at timestamptz not null,
 unique(policy_version,sequence),check(winner_id=any(players))
);
create index if not exists ranking_booking_winner on dartflow_private.ranking_bookings(winner_id);
create index if not exists ranking_booking_players on dartflow_private.ranking_bookings using gin(players);

do $$ declare t text;r text;begin
 foreach t in array array['ranking_policies','ranking_reservations','ranking_accounts','ranking_opponents','ranking_bookings']loop
  execute format('alter table dartflow_private.%I enable row level security',t);
  execute format('revoke all on dartflow_private.%I from public',t);
  foreach r in array array['anon','authenticated','service_role']loop
   if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on dartflow_private.%I from %I',t,r);end if;
  end loop;
  execute format('drop policy if exists app_access on dartflow_private.%I',t);
  execute format('create policy app_access on dartflow_private.%I to dartflow_app using(true) with check(true)',t);
  execute format('grant select on dartflow_private.%I to dartflow_app',t);
 end loop;
end $$;
grant update(sequence) on dartflow_private.ranking_policies to dartflow_app;
grant insert on dartflow_private.ranking_reservations,dartflow_private.ranking_accounts,dartflow_private.ranking_opponents,dartflow_private.ranking_bookings to dartflow_app;
grant update(first_throw_at) on dartflow_private.ranking_reservations to dartflow_app;
grant update(rating,played,unique_opponents,last_played_at) on dartflow_private.ranking_accounts to dartflow_app;
-- Policy versions, declarations, pair identity and the durable books cannot be rewritten by runtime.
revoke update,delete on dartflow_private.ranking_bookings,dartflow_private.ranking_opponents from dartflow_app;
revoke delete on dartflow_private.ranking_policies,dartflow_private.ranking_reservations,dartflow_private.ranking_accounts from dartflow_app;
insert into dartflow_private.feature_versions(name,version) values('national_player_rating',1) on conflict(name) do update set version=excluded.version;
commit;
