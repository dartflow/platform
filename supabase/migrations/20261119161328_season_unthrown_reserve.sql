-- Match participants stay immutable after the first throw. This narrow operation
-- permits an approved season reserve while preserving the original match UUID.
create or replace function dartflow_private.reassign_unstarted_season_players(target uuid,expected_revision integer,new_players uuid[])
returns void language plpgsql security definer set search_path=pg_catalog,dartflow_private as $$
declare m dartflow_private.matches%rowtype;s jsonb;f jsonb;home_team jsonb;away_team jsonb;
begin
 if cardinality(new_players)<>2 or new_players[1]=new_players[2] or array_position(new_players,null) is not null then raise exception 'invalid season sides' using errcode='22023';end if;
 select * into m from dartflow_private.matches where id=target for update;
 if not found or m.revision<>expected_revision or m.state->>'status' not in('called','ready','live')
 or jsonb_array_length(coalesce(m.state->'game'->'visits','[]'))<>0 or jsonb_array_length(coalesce(m.state->'previousSets','[]'))<>0
 or exists(select 1 from dartflow_private.audit_events where match_id=target and action='score')
 or exists(select 1 from dartflow_private.match_results where match_id=target)
 or exists(select 1 from dartflow_private.ranking_reservations where match_id=target)
 or exists(select 1 from dartflow_private.ranking_match_admissions where match_id=target)
 then raise exception 'season participant assignment is locked' using errcode='42501';end if;
 select cs.state into s from dartflow_private.platform_match_links l join dartflow_private.competition_seasons cs on cs.id=l.entity_id where l.match_id=target;
 if s is null or s->>'format' not in('teams','doubles') or s->>'status' not in('planned','active') then raise exception 'not an open team season' using errcode='42501';end if;
 select value into f from jsonb_array_elements(s->'fixtures') where exists(select 1 from jsonb_array_elements(value->'slots') slot where slot->>'matchId'=target::text);
 select value into home_team from jsonb_array_elements(s->'teams') where value->>'id'=f->>'homeId' and value->>'status'='active';
 select value into away_team from jsonb_array_elements(s->'teams') where value->>'id'=f->>'awayId' and value->>'status'='active';
 if home_team is null or away_team is null or not(home_team->'playerIds' ? new_players[1]::text) or not(away_team->'playerIds' ? new_players[2]::text)
 or not exists(select 1 from dartflow_private.club_memberships where club_id=(home_team->>'clubId')::uuid and user_id=new_players[1])
 or not exists(select 1 from dartflow_private.club_memberships where club_id=(away_team->>'clubId')::uuid and user_id=new_players[2])
 then raise exception 'reserve is outside the approved season roster' using errcode='42501';end if;
 delete from dartflow_private.match_players where match_id=target;
 insert into dartflow_private.match_players(match_id,user_id,position)values(target,new_players[1],0),(target,new_players[2],1);
end $$;
revoke all on function dartflow_private.reassign_unstarted_season_players(uuid,integer,uuid[]) from public;
grant execute on function dartflow_private.reassign_unstarted_season_players(uuid,integer,uuid[]) to dartflow_app;
do $$begin if exists(select 1 from pg_roles where rolname='anon')then revoke all on function dartflow_private.reassign_unstarted_season_players(uuid,integer,uuid[]) from anon;end if;if exists(select 1 from pg_roles where rolname='authenticated')then revoke all on function dartflow_private.reassign_unstarted_season_players(uuid,integer,uuid[]) from authenticated;end if;if exists(select 1 from pg_roles where rolname='service_role')then revoke all on function dartflow_private.reassign_unstarted_season_players(uuid,integer,uuid[]) from service_role;end if;end$$;
