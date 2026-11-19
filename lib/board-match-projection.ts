import type {PoolClient} from 'pg';
import type {MatchState} from './types';
/** A second remote board must have an active approved session for this exact source. */
export async function assignedBoardMatch(client:Pick<PoolClient,'query'>,boardId:string):Promise<MatchState|null>{
 const row=(await client.query<{state:MatchState}>(`select m.state from dartflow_private.matches m join dartflow_private.boards b on b.id=$1
  where ((m.board_id=b.id and (m.event_id=b.event_id or exists(select 1 from dartflow_private.reservation_matches rm join dartflow_private.board_reservations r on r.id=rm.reservation_id where rm.match_id=m.id and rm.board_id=b.id and r.event_id=m.event_id and r.status='accepted'))) or exists(select 1 from dartflow_private.board_activity_links l join dartflow_private.board_activity_sessions s on s.id=l.session_id where l.board_id=b.id and s.source_id=m.id and s.source_kind='match' and s.event_id=m.event_id and s.status in('active','completed') and (m.board_id=b.id or m.state->'remoteBoardIds' @> to_jsonb(b.id::text))))
  and m.state->>'status' not in('abandoned','interrupted') order by m.updated_at desc,m.id desc limit 1`,[boardId])).rows[0];
 return row?.state??null;
}
