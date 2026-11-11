-- Only active matches linked to a persisted remote/hybrid free-play lobby change.
-- Historical results, visits, standings and local/delegated-writer matches are preserved.
begin;
update dartflow_private.matches m
set state=jsonb_set(
    jsonb_set(
      jsonb_set(m.state,'{scoringMode}','"per-player"'::jsonb),
      '{writerId}',m.state->'players'->((m.state#>>'{game,turn}')::integer)->'id'),
    '{revision}',to_jsonb(m.revision+1)),
    revision=m.revision+1,
    updated_at=now()
from dartflow_private.platform_match_links l
join dartflow_private.platform_entities e on e.id=l.entity_id
where m.id=l.match_id
  and e.kind='lobby' and e.state->>'setup' in ('remote','hybrid')
  and m.state->>'status' in ('planned','called','ready','live','result','disputed')
  and m.state->>'scoringMode' is distinct from 'per-player'
  and jsonb_array_length(m.state->'players')=2
  and m.state#>>'{game,turn}' in ('0','1')
  and jsonb_typeof(m.state->'players'->((m.state#>>'{game,turn}')::integer)->'id')='string';
insert into dartflow_private.feature_versions(name,version) values('per_player_scoring',1) on conflict(name) do update set version=excluded.version;
commit;
