import type {PoolClient} from 'pg';
import type {MatchAction,MatchState} from './types';
import {DomainError} from './domain';
import {matchMediaActors} from './match-sides';

/** Short lived endpoint observations. Camera content is never stored. */
export async function assertMatchCameraReady(client:Pick<PoolClient,'query'>,state:MatchState,action:MatchAction):Promise<void>{
 if(!state.cameraRequired||!['start','score','resume'].includes(action.type))return;
 const actors=matchMediaActors(state);
 const rows=(await client.query<{sender_id:string;payload:{callId?:string;video?:boolean;connected?:boolean;peerVideo?:boolean};fresh:boolean}>(`select distinct on(sender_id) sender_id,payload,created_at>clock_timestamp()-interval '20 seconds' as fresh from dartflow_private.platform_signals where match_id=$1 and sender_id=any($2::uuid[]) and kind='preflight' and payload->>'purpose'='media-ready' order by sender_id,id desc`,[state.id,actors])).rows;
 if(new Set(actors).size!==2||rows.length!==2||rows.some(row=>!row.fresh||row.payload.video!==true||row.payload.connected!==true||row.payload.peerVideo!==true||typeof row.payload.callId!=='string'||!row.payload.callId)||rows[0].payload.callId!==rows[1].payload.callId)throw new DomainError('camera_required','Dit reglement vereist een actieve cameraverbinding aan beide zijden. Verbind beide camera’s voordat je start of verder scoort.',409);
}
