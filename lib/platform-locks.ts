import type {PoolClient}from'pg';
import {DomainError}from'./domain';

/** Every assignment locks the same sorted actor keys after its event lock. */
export async function lockPlayingActors(client:Pick<PoolClient,'query'>,ids:string[]):Promise<void>{
 for(const id of [...new Set(ids)].sort())await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`playing:${id}`]);
}
export async function assertPlayersFree(client:Pick<PoolClient,'query'>,ids:string[],exceptMatchId:string|null=null):Promise<void>{
 const active=await client.query(`select 1 from dartflow_private.matches m where ($2::uuid is null or m.id<>$2) and m.state->>'status' in ('called','ready','live','result','disputed','interrupted') and not(m.state->>'status'='interrupted'and exists(select 1 from dartflow_private.platform_match_links l join dartflow_private.platform_entities e on e.id=l.entity_id where l.match_id=m.id and e.kind='lobby')) and (exists(select 1 from dartflow_private.match_players p where p.match_id=m.id and p.user_id=any($1::uuid[])) or exists(select 1 from jsonb_array_elements(coalesce(m.state->'sideParticipants','[]'::jsonb)) side cross join lateral jsonb_array_elements(side.value) person where person.value->>'id'=any($3::text[])) or exists(select 1 from jsonb_array_elements_text(coalesce(m.state->'remoteWriterIds','[]'::jsonb)) writer where writer.value=any($3::text[])) or(m.state->>'delegatedWriterId'=m.state->>'writerId' and m.state->>'delegatedWriterId'=any($3::text[]))) limit 1`,[ids,exceptMatchId,ids]);
 if((await client.query("select 1 from dartflow_private.play_sessions where status='active'and($2::uuid is null or id<>$2)and exists(select 1 from jsonb_array_elements(state->'participants')p where p->>'accountId'=any($1::text[])or p->>'claimedBy'=any($1::text[]))limit 1",[ids,exceptMatchId])).rowCount)throw new DomainError('players_busy','Een speler heeft al een actieve speelsessie.',409);
 if(active.rowCount)throw new DomainError('players_busy','Een speler of schrijver heeft al een actieve partij.',409);
}
export async function boardLease(client:Pick<PoolClient,'query'>,boardId:string,exceptEntityId:string|null=null,exceptCompetitionLobbyId:string|null=null):Promise<{id:string;kind:string;owner_id:string;revision:number;state:Record<string,unknown>}|null>{
 const activity=await client.query(`select s.source_id as id,s.source_kind as kind,coalesce(e.owner_id,s.actor_ids[1]) as owner_id,coalesce(m.revision,e.revision,0) as revision,coalesce(m.state,e.state,'{}'::jsonb) as state from dartflow_private.board_activity_links l join dartflow_private.board_activity_sessions s on s.id=l.session_id left join dartflow_private.platform_entities e on e.id=s.source_id left join dartflow_private.matches m on m.id=s.source_id where l.board_id=$1 and ($2::uuid is null or s.source_id<>$2) and s.status in('active','completed') limit 1`,[boardId,exceptEntityId]);
 if(activity.rows.length)return activity.rows[0];
 const {rows}=await client.query(`select id,kind,owner_id,revision,state from dartflow_private.platform_entities where ($2::uuid is null or id<>$2) and (state->>'boardId'=$1 or exists(select 1 from jsonb_each_text(case when jsonb_typeof(state->'remoteBoardIds')='object' then state->'remoteBoardIds' else '{}'::jsonb end) mapped where mapped.value=$1)) and coalesce(state->>'closed','false')<>'true' and ((kind='lobby' and (state->>'matchId' is null or exists(select 1 from dartflow_private.matches waiting where waiting.id::text=state->>'matchId' and waiting.state->>'status' in('called','ready'))) and (state->>'boardLeaseUntil')::bigint>$3) or(kind='training' and state->>'boardHeld'='true' and (state->>'boardLeaseUntil')::bigint>$3)) order by created_at limit 1`,[boardId,exceptEntityId,Date.now()]);
 if(rows[0])return rows[0];
 // Official QR setup shares the board's existing short lease policy. Returning
 // the season source preserves the board projection; only the exact verified
 // lobby may consume its own lease, even inside the same season.
 const competition=(await client.query("select season_id as id,'competition-lobby'::text as kind,owner_id,revision,jsonb_build_object('competitionLobbyId',id,'matchId',match_id,'boardId',board_id,'eventId',(select state->>'eventId' from dartflow_private.competition_seasons where id=season_id)) as state from dartflow_private.competition_board_lobbies where board_id=$1 and ($2::uuid is null or id<>$2) and status in('waiting','ready') and expires_at>clock_timestamp() limit 1",[boardId,exceptCompetitionLobbyId])).rows[0];
 if(competition)return competition;
 return(await client.query("select id,'play-session'::text as kind,owner_account_id as owner_id,revision,state from dartflow_private.play_sessions where $1=any(board_ids)and($2::uuid is null or id<>$2)and status='active'limit 1",[boardId,exceptEntityId])).rows[0]??null;
}
export async function assertBoardUnreserved(client:Pick<PoolClient,'query'>,boardId:string,eventId:string,exceptEntityId:string|null=null,fixtureId?:string,exceptCompetitionLobbyId:string|null=null):Promise<void>{
 if(await boardLease(client,boardId,exceptEntityId,exceptCompetitionLobbyId))throw new DomainError('board_reserved','Deze baan is gereserveerd door een lopende opstelling.',409);
 const {rows}=await client.query(`select state->'boardReservations'->$2 as reservation from dartflow_private.platform_entities where state->>'eventId'=$1 and kind in ('league','tournament') and state->'boardReservations' ? $2`,[eventId,boardId]);
 if(rows.some(row=>!fixtureId||row.reservation?.fixtureId!==fixtureId))throw new DomainError('board_reserved','Deze baan heeft een reservering van de wedstrijdleiding.',409);
}
