begin;
create table if not exists dartflow_private.play_leg_challenges(
 id uuid primary key,owner_id uuid not null references dartflow_private.profiles(id),source_kind text not null check(source_kind in('match','play')),
 source_id uuid not null,access_share_id uuid,source_player_id text not null,set_number integer not null check(set_number>0),leg_number integer not null check(leg_number>0),
 source jsonb not null,source_name text not null,visibility text not null check(visibility in('private','friends','link')),
 recipient_ids uuid[] not null default '{}',link_hash text not null unique,key_version text not null,
 revoked_at timestamptz,created_at timestamptz not null default clock_timestamp()
);
create index if not exists play_leg_challenges_owner on dartflow_private.play_leg_challenges(owner_id,created_at desc);
create table if not exists dartflow_private.play_challenge_receipts(
 actor_id uuid not null references dartflow_private.profiles(id),request_id uuid not null,payload_hash text not null,
 challenge_id uuid references dartflow_private.play_leg_challenges(id),created_at timestamptz not null default clock_timestamp(),primary key(actor_id,request_id)
);
create table if not exists dartflow_private.play_saved_finish_advice(
 user_id uuid primary key references dartflow_private.profiles(id),advice jsonb not null,saved_at timestamptz not null default clock_timestamp()
);
do $$declare t text;r text;begin
 foreach t in array array['play_leg_challenges','play_challenge_receipts','play_saved_finish_advice']loop
 execute format('alter table dartflow_private.%I enable row level security',t);
 execute format('revoke all on dartflow_private.%I from public',t);
 foreach r in array array['anon','authenticated','service_role']loop if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on dartflow_private.%I from %I',t,r);end if;end loop;
 if not exists(select 1 from pg_policies where schemaname='dartflow_private' and tablename=t and policyname='runtime')then execute format('create policy runtime on dartflow_private.%I to dartflow_app using(true)with check(true)',t);end if;
 execute format('revoke all on dartflow_private.%I from dartflow_app',t);
 execute format('grant select,insert on dartflow_private.%I to dartflow_app',t);
 end loop;
end$$;
-- Runtime may revoke a challenge and update its own saved advice, but cannot
-- rewrite frozen sources, ownership, link proofs or immutable retry receipts.
grant update(revoked_at)on dartflow_private.play_leg_challenges to dartflow_app;
grant update(advice,saved_at)on dartflow_private.play_saved_finish_advice to dartflow_app;
-- Only the already authorized owner erasure function can remove a private identity.
create or replace function dartflow_private.scrub_play_challenge_identity(actor uuid)returns void
language plpgsql security definer set search_path=pg_catalog,dartflow_private as $$begin
 update dartflow_private.play_leg_challenges set revoked_at=coalesce(revoked_at,clock_timestamp()),source_name='Verwijderde speler',source=jsonb_set(jsonb_set(source,'{playerId}','"removed"'::jsonb),'{valid}','false'::jsonb)where owner_id=actor or source_player_id=actor::text;
 update dartflow_private.play_leg_challenges set recipient_ids=array_remove(recipient_ids,actor)where actor=any(recipient_ids);
 delete from dartflow_private.play_saved_finish_advice where user_id=actor;
end$$;
revoke all on function dartflow_private.scrub_play_challenge_identity(uuid)from public,dartflow_app;
do $$declare r text;definition text;begin
 foreach r in array array['anon','authenticated','service_role']loop if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on function dartflow_private.scrub_play_challenge_identity(uuid)from %I',r);end if;end loop;
 if to_regprocedure('dartflow_private.erase_account_job(uuid,uuid)')is not null then
 definition=pg_get_functiondef('dartflow_private.erase_account_job(uuid,uuid)'::regprocedure);
 if position('perform dartflow_private.scrub_play_challenge_identity(a);'in definition)=0 then
 if position(' -- Remove credentials'in definition)=0 then raise exception 'Expected erasure hook missing';end if;
 definition=replace(definition,' -- Remove credentials',' perform dartflow_private.scrub_play_challenge_identity(a);'||chr(10)||' -- Remove credentials');execute definition;
 end if;end if;
end$$;
insert into dartflow_private.feature_versions(name,version)values('play_leg_challenges',1)on conflict(name)do update set version=excluded.version;
commit;
