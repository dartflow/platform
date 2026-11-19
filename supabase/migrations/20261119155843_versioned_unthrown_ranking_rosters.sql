begin;
create table if not exists dartflow_private.ranking_match_roster_versions(
 match_id uuid not null references dartflow_private.matches(id)on delete cascade,version integer not null check(version>0),
 old_revision integer not null,old_state jsonb not null,new_players uuid[] not null,requires_consent boolean not null,
 admissions jsonb not null,confirmations jsonb not null,actor_id uuid not null references dartflow_private.profiles(id),reason text not null,
 created_at timestamptz not null default clock_timestamp(),primary key(match_id,version),check(cardinality(new_players)=2)
);
create table if not exists dartflow_private.ranking_match_roster_confirmations(
 match_id uuid not null,version integer not null,player_id uuid not null references dartflow_private.profiles(id),
 confirmed_at timestamptz not null default clock_timestamp(),primary key(match_id,version,player_id),
 foreign key(match_id,version)references dartflow_private.ranking_match_roster_versions(match_id,version)on delete cascade
);
do $$declare t text;r text;begin
 foreach t in array array['ranking_match_roster_versions','ranking_match_roster_confirmations']loop
  execute format('alter table dartflow_private.%I enable row level security',t);
  execute format('revoke all on dartflow_private.%I from public',t);
  foreach r in array array['anon','authenticated','service_role']loop if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on dartflow_private.%I from %I',t,r);end if;end loop;
  execute format('drop policy if exists app_access on dartflow_private.%I',t);
  execute format('create policy app_access on dartflow_private.%I to dartflow_app using(true)with check(true)',t);
  execute format('grant select,insert on dartflow_private.%I to dartflow_app',t);
  execute format('revoke update,delete on dartflow_private.%I from dartflow_app',t);
 end loop;
end $$;
create or replace function dartflow_private.revoke_unthrown_season_ranking(target uuid,expected_revision integer,new_players uuid[],actor uuid,explanation text)
returns integer language plpgsql security definer set search_path=pg_catalog,dartflow_private as $$
declare m dartflow_private.matches%rowtype;s jsonb;f jsonb;home_team jsonb;away_team jsonb;scope_club uuid;allowed boolean;archived jsonb;consents jsonb;next_version integer;needs_consent boolean;
begin
 if cardinality(new_players)<>2 or new_players[1]=new_players[2] or array_position(new_players,null)is not null or length(trim(explanation))not between 1 and 1000 then raise exception 'invalid roster declaration'using errcode='22023';end if;
 select *into m from dartflow_private.matches where id=target for update;
 if not found or m.revision<>expected_revision or m.state->>'status'not in('called','ready','live')
 or jsonb_array_length(coalesce(m.state->'game'->'visits','[]'))<>0 or jsonb_array_length(coalesce(m.state->'previousSets','[]'))<>0
 or exists(select 1 from dartflow_private.audit_events where match_id=target and action='score')
 or exists(select 1 from dartflow_private.match_results where match_id=target)
 or exists(select 1 from dartflow_private.ranking_sources where match_id=target)
 or exists(select 1 from dartflow_private.ranking_reservations where match_id=target)
 then raise exception 'ranking roster is locked after its first actual throw'using errcode='42501';end if;
 select cs.state into s from dartflow_private.platform_match_links l join dartflow_private.competition_seasons cs on cs.id=l.entity_id where l.match_id=target;
 if s is null or s->>'format'not in('teams','doubles')or s->>'status'not in('planned','active')then raise exception 'not an open team season'using errcode='42501';end if;
 if not exists(select 1 from dartflow_private.profiles where id=actor and deleted_at is null and deletion_requested_at is null)then raise exception 'inactive manager'using errcode='42501';end if;
 if s->>'scope'='national'then allowed:=exists(select 1 from dartflow_private.platform_roles where user_id=actor and role in('owner','admin'));
 else
  scope_club:=(s->>'clubId')::uuid;
  select exists(select 1 from dartflow_private.club_memberships c left join dartflow_private.platform_entities e on e.id=c.club_id and e.kind='club'
   left join dartflow_private.platform_members pm on pm.entity_id=e.id and pm.user_id=actor where c.club_id=scope_club and c.user_id=actor
   and(e.id is null or(pm.status='active'and coalesce(e.state->>'lifecycle','active')not in('inactive','deleted')))
   and((s->'managerIds')?actor::text or(e.id is null and c.role='organizer')or e.owner_id=actor or pm.role='admin'
    or exists(select 1 from dartflow_private.club_member_roles mr join dartflow_private.club_roles r on r.id=mr.role_id and r.club_id=mr.club_id where mr.club_id=scope_club and mr.user_id=actor and 'competitions.manage'=any(r.permissions))))into allowed;
 end if;
 if not allowed then raise exception 'current season manager required'using errcode='42501';end if;
 select value into f from jsonb_array_elements(s->'fixtures')where exists(select 1 from jsonb_array_elements(value->'slots')slot where slot->>'matchId'=target::text);
 select value into home_team from jsonb_array_elements(s->'teams')where value->>'id'=f->>'homeId'and value->>'status'='active';
 select value into away_team from jsonb_array_elements(s->'teams')where value->>'id'=f->>'awayId'and value->>'status'='active';
 if home_team is null or away_team is null or not(home_team->'playerIds'?new_players[1]::text)or not(away_team->'playerIds'?new_players[2]::text)
 or not exists(select 1 from dartflow_private.club_memberships where club_id=(home_team->>'clubId')::uuid and user_id=new_players[1])
 or not exists(select 1 from dartflow_private.club_memberships where club_id=(away_team->>'clubId')::uuid and user_id=new_players[2])
 then raise exception 'new players must belong to the approved season rosters'using errcode='42501';end if;
 select jsonb_agg(to_jsonb(a)),coalesce(bool_or(a.eligible),false)into archived,needs_consent from dartflow_private.ranking_match_admissions a where match_id=target;
 if archived is null then return 0;end if;
 select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb)into consents from dartflow_private.ranking_event_confirmations c where c.declaration_id in(select declaration_id from dartflow_private.ranking_match_admissions where match_id=target);
 select coalesce(max(version),0)+1 into next_version from dartflow_private.ranking_match_roster_versions where match_id=target;
 insert into dartflow_private.ranking_match_roster_versions(match_id,version,old_revision,old_state,new_players,requires_consent,admissions,confirmations,actor_id,reason)values(target,next_version,m.revision,m.state,new_players,needs_consent,archived,consents,actor,trim(explanation));
 delete from dartflow_private.ranking_match_admissions where match_id=target;
 return next_version;
end $$;
revoke all on function dartflow_private.revoke_unthrown_season_ranking(uuid,integer,uuid[],uuid,text)from public;
grant execute on function dartflow_private.revoke_unthrown_season_ranking(uuid,integer,uuid[],uuid,text)to dartflow_app;
do $$declare r text;begin foreach r in array array['anon','authenticated','service_role']loop if exists(select 1 from pg_roles where rolname=r)then execute format('revoke all on function dartflow_private.revoke_unthrown_season_ranking(uuid,integer,uuid[],uuid,text)from %I',r);end if;end loop;end $$;
insert into dartflow_private.feature_versions(name,version)values('ranking_roster_versions',1)on conflict(name)do update set version=excluded.version;
commit;
