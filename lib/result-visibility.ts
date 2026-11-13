/** Core results exist before a national encounter is final. All history/export readers
 * use the same source gate; standings and Feed use their season projection. */
export const finalResultSql=`not exists(
 select 1 from dartflow_private.platform_match_links result_link join dartflow_private.platform_entities result_origin on result_origin.id=result_link.entity_id
 where result_link.match_id=r.match_id and result_origin.state->>'seasonManaged'='true' and not exists(
  select 1 from dartflow_private.competition_seasons result_season cross join lateral jsonb_array_elements(coalesce(result_season.state->'fixtures','[]'::jsonb)) result_fixture
  cross join lateral jsonb_array_elements(coalesce(result_fixture->'slots','[]'::jsonb)) result_slot
  where result_season.id=result_origin.id and result_fixture->>'status' in('confirmed','administrative')
   and result_slot->>'matchId'=r.match_id::text and result_slot->>'status'='confirmed' and coalesce(result_slot->'administrative','null'::jsonb)='null'::jsonb
 ))`;
