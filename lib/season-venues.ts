import type {PoolClient} from 'pg';
import {DomainError} from './domain';
import {reservationOrganizer} from './location-access';
import type {SeasonState} from './seasons-types';

/** Neutral venues require the same owner's explicit reservation as tournaments. */
export async function seasonVenueBoards(client:Pick<PoolClient,'query'>,season:Pick<SeasonState,'eventId'>,currentOnly=false):Promise<{id:string;name:string;clubId:string}[]> {
 const rows=(await client.query<{id:string;name:string;requester_id:string}>(`select b.id,b.name,r.requester_id from dartflow_private.board_reservations r join dartflow_private.reservation_boards rb on rb.reservation_id=r.id join dartflow_private.boards b on b.id=rb.board_id join dartflow_private.location_boards lb on lb.board_id=b.id join dartflow_private.locations l on l.id=lb.location_id where r.event_id=$1 and r.status='accepted' and r.ends_at>clock_timestamp() and (not $2::boolean or r.starts_at<=clock_timestamp()) and l.kind='venue' and lb.archived_at is null and lb.closed_at is null and not lb.close_after_session and not b.blocked order by b.id,r.id limit 256`,[season.eventId,currentOnly])).rows,result:{id:string;name:string;clubId:string}[]=[];
 for(const row of rows){try{await reservationOrganizer(client,row.requester_id,season.eventId);}catch(error){if(error instanceof DomainError&&[403,404].includes(error.status))continue;throw error;}if(!result.some(board=>board.id===row.id))result.push({id:row.id,name:row.name,clubId:''});}
 return result;
}
