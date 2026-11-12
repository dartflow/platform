import type {PoolClient}from'pg';
import {DomainError}from'./domain';

/** Every assignment locks the same sorted actor keys after its event lock. */
export async function lockPlayingActors(client:Pick<PoolClient,'query'>,ids:string[]):Promise<void>{
 for(const id of [...new Set(ids)].sort())await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`playing:${id}`]);
}
export async function assertPlayersFree(client:Pick<PoolClient,'query'>,ids:string[],exceptMatchId:string|null=null):Promise<void>{
 const active=await client.query(`select 1 from dartflow_private.matches m where ($2::uuid is null or m.id<>$2) and m.state->>'status' in ('called','ready','live','result','disputed') and (exists(select 1 from dartflow_private.match_players p where p.match_id=m.id and p.user_id=any($1::uuid[])) or(m.state->>'delegatedWriterId'=m.state->>'writerId' and m.state->>'delegatedWriterId'=any($3::text[]))) limit 1`,[ids,exceptMatchId,ids]);
 if(active.rowCount)throw new DomainError('players_busy','Een speler of schrijver heeft al een actieve partij.',409);
}
export async function boardLease(client:Pick<PoolClient,'query'>,boardId:string,exceptEntityId:string|null=null):Promise<{id:string;kind:string;owner_id:string;revision:number;state:Record<string,unknown>}|null>{
 const {rows}=await client.query(`select id,kind,owner_id,revision,state from dartflow_private.platform_entities where ($2::uuid is null or id<>$2) and state->>'boardId'=$1 and coalesce(state->>'closed','false')<>'true' and ((kind='lobby' and state->>'matchId' is null and (state->>'boardLeaseUntil')::bigint>$3) or(kind='training' and state->>'boardHeld'='true' and (state->>'boardLeaseUntil')::bigint>$3)) order by created_at limit 1`,[boardId,exceptEntityId,Date.now()]);
 return rows[0]??null;
}
export async function assertBoardUnreserved(client:Pick<PoolClient,'query'>,boardId:string,eventId:string,exceptEntityId:string|null=null,fixtureId?:string):Promise<void>{
 if(await boardLease(client,boardId,exceptEntityId))throw new DomainError('board_reserved','Deze baan is gereserveerd door een lopende opstelling.',409);
 const {rows}=await client.query(`select state->'boardReservations'->$2 as reservation from dartflow_private.platform_entities where state->>'eventId'=$1 and kind in ('league','tournament') and state->'boardReservations' ? $2`,[eventId,boardId]);
 if(rows.some(row=>!fixtureId||row.reservation?.fixtureId!==fixtureId))throw new DomainError('board_reserved','Deze baan heeft een reservering van de wedstrijdleiding.',409);
}
