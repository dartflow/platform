import {database,eventAccess} from './db';
import {DomainError} from './domain';

/** Event-scoped director data, including personal events without a real club. */
export async function getEventBoards(actorId:string,eventId:string){
 const client=database(),access=await eventAccess(client,actorId,eventId);
 if(!access.canManage)throw new DomainError('forbidden','Alleen de wedstrijdleiding kan de banen van dit evenement beheren.',403);
 const {rows}=await client.query<{id:string;eventId:string;name:string;blocked:boolean;matchId:string|null}>(`select b.id,b.event_id as "eventId",b.name,b.blocked,case when m.event_id=b.event_id then m.id else null end as "matchId" from dartflow_private.boards b left join dartflow_private.matches m on m.board_id=b.id where b.event_id=$1 order by b.name,b.id`,[eventId]);
 return {boards:rows};
}
