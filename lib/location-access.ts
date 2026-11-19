import {DomainError} from './domain';
import {clubPermission} from './club-access';
import {uuid,type Client} from './platform-store';
import type {ReservedBoardContext} from './location-types';
import {seasonEventAccess} from './seasons';

export type PhysicalBoardRow={board_id:string;location_id:string;home_event_id:string;owner_id:string;kind:'home'|'venue';location_name:string;timezone:string;reservation_enabled:boolean;public_screen:boolean;archived_at:Date|null;closed_at:Date|null;close_after_session:boolean;name:string;blocked:boolean};
export type ActiveReservation={id:string;event_id:string;club_id:string;event_name:string;starts_at:Date;ends_at:Date;max_matches:number;location_id:string};
/** Shared by reservation mutations and the fixed player route; always reads current scoped grants. */
export async function reservationOrganizer(client:Client,actor:string,eventId:string,lockClub=false):Promise<{id:string;club_id:string;name:string;kind:'league'|'tournament'|'event'}>{
 const result=await client.query<{id:string;club_id:string;name:string;kind:'league'|'tournament'|'event'}>(`select e.id,e.club_id,e.name,coalesce((select pe.kind from dartflow_private.platform_entities pe where pe.kind in('league','tournament') and pe.state->>'eventId'=e.id::text order by pe.id limit 1),'event') as kind from dartflow_private.events e
  where e.id=$1 and not exists(select 1 from dartflow_private.location_boards lb where lb.home_event_id=e.id) and not exists(select 1 from dartflow_private.club_boards cb where cb.event_id=e.id)`,[uuid(eventId)]);
 if(!result.rows.length)throw new DomainError('event_unavailable','Kies een bestaande speeldag van jouw vereniging.',403);
 const row=result.rows[0];
 if(lockClub)await client.query("select id from dartflow_private.platform_entities where id=$1 and kind='club' for share",[row.club_id]);
 const allowed=row.kind==='tournament'?await clubPermission(client,row.club_id,actor,'tournaments.manage'):row.kind==='league'?await clubPermission(client,row.club_id,actor,'competitions.manage'):await clubPermission(client,row.club_id,actor,'tournaments.manage')||await clubPermission(client,row.club_id,actor,'competitions.manage');
 if(!allowed&&(await seasonEventAccess(client,actor,eventId))?.canManage!==true)throw new DomainError('forbidden','Je hebt geen actueel organisatierecht voor deze verenigingsspeeldag.',403);
 return row;
}
export async function canOrganizeReservedEvent(client:Client,actor:string,eventId:string):Promise<boolean>{
 try{await reservationOrganizer(client,actor,eventId);return true;}catch(error){if(error instanceof DomainError&&[403,404].includes(error.status))return false;throw error;}
}
export async function physicalBoard(client:Client,id:string):Promise<PhysicalBoardRow|null>{
 const result=await client.query<PhysicalBoardRow>(`select lb.*,l.owner_id,l.kind,l.name as location_name,l.timezone,b.name,b.blocked
  from dartflow_private.location_boards lb join dartflow_private.locations l on l.id=lb.location_id join dartflow_private.boards b on b.id=lb.board_id where lb.board_id=$1`,[id]);
 return result.rows[0]??null;
}
export async function locationManager(client:Client,actor:string,locationId:string):Promise<boolean>{
 return Boolean((await client.query(`select 1 from dartflow_private.locations l where l.id=$1 and(l.owner_id=$2 or exists(select 1 from dartflow_private.location_members lm where lm.location_id=l.id and lm.user_id=$2))`,[locationId,actor])).rowCount);
}
export async function activeBoardReservation(client:Client,boardId:string,lock=false):Promise<ActiveReservation|null>{
 const result=await client.query<ActiveReservation>(`select r.id,r.event_id,r.club_id,e.name as event_name,r.starts_at,r.ends_at,r.max_matches,r.location_id
  from dartflow_private.reservation_boards rb join dartflow_private.board_reservations r on r.id=rb.reservation_id join dartflow_private.events e on e.id=r.event_id
  where rb.board_id=$1 and r.status='accepted' and r.starts_at<=clock_timestamp() and r.ends_at>clock_timestamp() order by r.starts_at,r.id limit 1${lock?' for update of r':''}`,[boardId]);
 const row=result.rows[0];return row&&row.starts_at.getTime()<=Date.now()&&row.ends_at.getTime()>Date.now()?row:null;
}
/** A home's internal scoring container grants no club role or membership. */
export async function locationHomeEventAccess(client:Client,actor:string,eventId:string):Promise<Record<string,unknown>|null>{
 const row=(await client.query<PhysicalBoardRow>(`select lb.*,l.owner_id,l.kind,l.name as location_name,l.timezone,b.name,b.blocked
  from dartflow_private.location_boards lb join dartflow_private.locations l on l.id=lb.location_id join dartflow_private.boards b on b.id=lb.board_id where lb.home_event_id=$1`,[eventId])).rows[0];
 if(!row)return null;
 // Legacy club-board admission remains a separate playing policy.
 if((await client.query('select 1 from dartflow_private.club_boards where board_id=$1',[row.board_id])).rowCount)return null;
 const manage=await locationManager(client,actor,row.location_id);
 if(!manage&&(row.kind==='home'||row.archived_at)){
  const involved=await client.query(`select 1 where exists(select 1 from dartflow_private.platform_entities pe join dartflow_private.platform_members pm on pm.entity_id=pe.id and pm.user_id=$2 and pm.status in('active','invited')
   where pe.kind='lobby' and pe.state->>'boardId'=$1 and coalesce(pe.state->>'closed','false')<>'true' and (pe.state->>'boardLeaseUntil')::bigint>floor(extract(epoch from now())*1000))
   or exists(select 1 from dartflow_private.matches m join dartflow_private.match_players mp on mp.match_id=m.id and mp.user_id=$2 where m.event_id=$3)`,[row.board_id,actor,eventId]);
  if(!involved.rowCount)throw new DomainError('forbidden','Deze thuisbaan of locatie is niet beschikbaar voor jouw account.',403);
 }
 const core=(await client.query('select * from dartflow_private.events where id=$1',[eventId])).rows[0];
 return {...core,role:manage?'organizer':'player',staff:manage,canManage:manage,physicalLocation:{id:row.location_id,name:row.location_name,boardId:row.board_id,kind:row.kind}};
}
/** Caller holds the physical board row lock. Temporary use never moves its ownership/event. */
export async function assertPhysicalBoardEvent(client:Client,boardId:string,eventId:string,matchId?:string,consume=false):Promise<void>{
 const physical=await physicalBoard(client,boardId);
 if(!physical){
  if(!(await client.query('select 1 from dartflow_private.boards where id=$1 and event_id=$2',[boardId,eventId])).rowCount)throw new DomainError('board_unavailable','Deze baan hoort niet bij deze speeldag.',409);
  return;
 }
 if(physical.archived_at||physical.blocked)throw new DomainError('board_unavailable','Deze fysieke baan is buiten gebruik.',409);
 if(physical.closed_at)throw new DomainError('board_closed','Deze baan is gesloten voor nieuwe partijen.',409);
 if(physical.close_after_session&&(!matchId||!(await client.query('select 1 from dartflow_private.matches where id=$1 and board_id=$2',[matchId,boardId])).rowCount))throw new DomainError('board_closed','Deze baan sluit na de huidige partij en neemt geen nieuwe partijen aan.',409);
 const reservation=await activeBoardReservation(client,boardId,consume);
 if(!reservation){
  if(eventId!==physical.home_event_id)throw new DomainError('reservation_window','Deze partij kan alleen in het goedgekeurde tijdvak op deze baan worden gestart.',409);
  return;
 }
 if(reservation.event_id!==eventId)throw new DomainError('board_reserved','Deze baan is tijdelijk gereserveerd voor een andere speeldag.',409);
 if(!consume||!matchId)return;
 const prior=await client.query('select reservation_id,board_id from dartflow_private.reservation_matches where match_id=$1 and board_id=$2',[matchId,boardId]);
 if(prior.rows.length){if(prior.rows[0].reservation_id!==reservation.id||prior.rows[0].board_id!==boardId)throw new DomainError('reservation_match','Deze partij heeft al een andere reserveringskoppeling.',409);return;}
 const used=await client.query<{count:number}>('select count(distinct match_id)::int as count from dartflow_private.reservation_matches where reservation_id=$1',[reservation.id]);
 if(used.rows[0].count>=reservation.max_matches)throw new DomainError('reservation_capacity','Het afgesproken maximum aantal partijen voor dit tijdvak is bereikt.',409);
 await client.query('insert into dartflow_private.reservation_matches(reservation_id,match_id,board_id) values($1,$2,$3)',[reservation.id,matchId,boardId]);
}
export async function eventPhysicalBoards(client:Client,eventId:string,lock=false):Promise<{id:string;event_id:string;name:string;blocked:boolean}[]>{
 const result=await client.query<{id:string;event_id:string;name:string;blocked:boolean}>(`select b.id,b.event_id,b.name,b.blocked from dartflow_private.boards b
  where (b.event_id=$1 or exists(select 1 from dartflow_private.reservation_boards rb join dartflow_private.board_reservations r on r.id=rb.reservation_id
   where rb.board_id=b.id and r.event_id=$1 and r.status='accepted' and r.starts_at<=now() and r.ends_at>now()))
  order by b.id${lock?' for update of b':''}`,[eventId]);
 return result.rows;
}
export async function locationScreenContext(client:Client,boardId:string,matchId?:string):Promise<{physical:PhysicalBoardRow;reservation:{label:string;startsAt:string;endsAt:string;overrun:boolean}|null}|null>{
 const physical=await physicalBoard(client,boardId);if(!physical)return null;
 let reservation:ActiveReservation|null=null;
 if(matchId){reservation=(await client.query<ActiveReservation>(`select r.id,r.event_id,r.club_id,e.name as event_name,r.starts_at,r.ends_at,r.max_matches,r.location_id
   from dartflow_private.reservation_matches rm join dartflow_private.board_reservations r on r.id=rm.reservation_id join dartflow_private.events e on e.id=r.event_id where rm.board_id=$1 and rm.match_id=$2`,[boardId,matchId])).rows[0]??null;}
 if(!matchId)reservation??=await activeBoardReservation(client,boardId);
 return {physical,reservation:reservation?{label:reservation.event_name,startsAt:reservation.starts_at.toISOString(),endsAt:reservation.ends_at.toISOString(),overrun:reservation.ends_at.getTime()<=Date.now()}:null};
}
export async function playerReservationContext(client:Client,actor:string,boardId:string):Promise<{eventId:string;canParticipate:boolean;context:ReservedBoardContext}|null>{
 const reservation=await activeBoardReservation(client,boardId);if(!reservation)return null;
 const registered=Boolean((await client.query("select 1 from dartflow_private.entries where event_id=$1 and user_id=$2 and status='registered'",[reservation.event_id,actor])).rowCount);
 const staff=await canOrganizeReservedEvent(client,actor,reservation.event_id);
 let fixtureId:string|undefined,seasonId:string|undefined,seasonFixtureId:string|undefined;
 if(registered||staff){
  const event=await client.query<{id:string;state:{seasonManaged?:boolean;fixtures?:{id:string;players:(string|null)[];status:string}[]}}>("select id,state from dartflow_private.platform_entities where kind in('league','tournament') and state->>'eventId'=$1 order by id limit 1",[reservation.event_id]);
  const next=event.rows[0]?.state.fixtures?.find(f=>f.status==='scheduled'&&f.players[0]===actor&&f.players.every(Boolean));fixtureId=next?.id;
  if(event.rows[0]?.state.seasonManaged){seasonId=event.rows[0].id;if(fixtureId){const source=(await client.query<{state:{fixtures:{id:string;slots:{id:string}[]}[]}}>('select state from dartflow_private.competition_seasons where id=$1',[seasonId])).rows[0];seasonFixtureId=source?.state.fixtures.find(f=>f.slots.some(slot=>slot.id===fixtureId))?.id;}}
 }
 return {eventId:reservation.event_id,canParticipate:registered||staff,context:{id:reservation.id,label:registered||staff?reservation.event_name:'Gereserveerd voor een speeldag',startsAt:reservation.starts_at.toISOString(),endsAt:reservation.ends_at.toISOString(),overrun:false,canPrepare:Boolean(fixtureId),...(fixtureId?{fixtureId}:{}),...(seasonId?{seasonId,seasonFixtureId}:{})}};
}
