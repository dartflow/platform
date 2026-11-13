import type {PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import type {ScoreEvent} from './score-events';
import type {Game,MatchView,Visit} from './types';

const eventId=(sourceId:string,id:string,ordinal=0)=>createHash('sha256').update(`oche-home-event:v1:${sourceId}:${id}:${ordinal}`).digest('hex').slice(0,32);
type StoredEvent={id:string;action:string;revision:number;response:{entity?:{state?:{game?:Game;undo?:Game[]}}}&Partial<MatchView>};
/** Reuse immutable accepted command receipts. No second event/statistics ledger is
 * introduced, and abandoned-session receipt erasure remains effective. Call only
 * after ownership/participation checks for the explicitly selected home source. */
export async function readOcheHomeEvents(client:Pick<PoolClient,'query'>,sourceId:string,ownerId:string,kind:'match'|'training',maximumRevision:number):Promise<ScoreEvent[]>{
 const query=kind==='training'?`select a.id::text,a.action,(a.detail->>'revision')::int as revision,r.response from dartflow_private.platform_audit a
  join dartflow_private.platform_receipts r on r.actor_id=a.actor_id and r.request_id::text=a.detail->>'requestId'
  where a.entity_id=$1 and a.actor_id=$2 and a.action in('training.score','training.undo') and (a.detail->>'revision')::int<=$3 order by a.id desc limit 64`
  :`select a.id::text,a.action,(a.detail->>'revision')::int as revision,r.response from dartflow_private.audit_events a
  join dartflow_private.action_receipts r on r.match_id=a.match_id and r.actor_id=a.actor_id and r.request_id::text=a.detail->>'requestId'
  where a.match_id=$1 and exists(select 1 from dartflow_private.match_players p where p.match_id=a.match_id and p.user_id=$2) and a.action in('score','undo','approve-correction') and (a.detail->>'revision')::int<=$3 order by a.id desc limit 64`;
 const rows=(await client.query<StoredEvent>(query,[sourceId,ownerId,maximumRevision])).rows.reverse();const events:ScoreEvent[]=[];
 for(const row of rows){
  const undo=['training.undo','undo','approve-correction'].includes(row.action);
  if(undo){events.push({id:eventId(sourceId,row.id),revision:row.revision,kind:'undo'});continue;}
  let accepted:Visit[]=[];
  if(kind==='training'){
   const state=row.response.entity?.state;
   if(state?.game){const previous=state.undo?.at(-1)?.visits.length;if(previous!==undefined)accepted=state.game.visits.slice(previous);}
  }else if(row.response.visits?.length)accepted=[row.response.visits.at(-1)!];
  for(const [ordinal,visit] of accepted.entries())events.push({id:eventId(sourceId,row.id,ordinal),revision:row.revision,kind:'score',score:visit.score,checkout:visit.checkout,bust:visit.bust,playerIndex:visit.playerIndex});
 }
 return events;
}
