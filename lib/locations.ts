import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {database} from './db';
import {DomainError} from './domain';
import {boardLease} from './platform-locks';
import {lockBoardActivity,readBoardActivity,releaseBoardActivity} from './board-activity';
import {autoAssign} from './platform-competitions';
import {entity,save,uuid} from './platform-store';
import type {Client} from './platform-store';
import type {PlatformCommand,PlatformResponse} from './platform-types';
import type {BoardReservation,LocationBoard,LocationOverview,PhysicalLocation} from './location-types';
import {activeBoardReservation,locationManager,physicalBoard,reservationOrganizer as organizer,canOrganizeReservedEvent as currentOrganizer} from './location-access';
import {enqueueAuditedNotification} from './notification-audit-source';

type LocationRow={id:string;owner_id:string;kind:'home'|'venue';name:string;timezone:string};
type ReservationRow={id:string;location_id:string;requester_id:string;club_id:string;event_id:string;preferred_board_id:string|null;starts_at:Date;ends_at:Date;board_count:number;max_matches:number;status:BoardReservation['status'];revision:number;reason:string};
function label(value:unknown,max=60):string{
 const normalized=typeof value==='string'?value.normalize('NFC').trim().replace(/\s+/g,' '):'';
 if(!normalized||normalized.length>max||/[\p{Cc}\p{Cf}]/u.test(normalized))throw new DomainError('invalid_text',`Vul geldige tekst in van maximaal ${max} tekens.`);
 return normalized;
}
function timezone(value:unknown):string{
 const zone=value===undefined?'Europe/Amsterdam':String(value);
 try{new Intl.DateTimeFormat('nl-NL',{timeZone:zone}).format();}catch{throw new DomainError('invalid_timezone','Kies een geldige tijdzone.');}
 return zone;
}
function count(value:unknown,max:number):number{const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>max)throw new DomainError('invalid_capacity',`Kies een aantal van 1 tot ${max}.`);return n;}
function instant(value:unknown):Date{
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)||Number.isNaN(new Date(value).getTime()))throw new DomainError('invalid_window','Gebruik een geldig tijdstip met tijdzone.');
 return new Date(value);
}
async function location(client:Client,id:string,lock=false):Promise<LocationRow>{
 const result=await client.query<LocationRow>(`select id,owner_id,kind,name,timezone from dartflow_private.locations where id=$1${lock?' for update':''}`,[uuid(id)]);
 if(!result.rows.length)throw new DomainError('not_found','Deze locatie bestaat niet.',404);return result.rows[0];
}
async function managed(client:Client,actor:string,id:string,ownerOnly=false,lock=true):Promise<LocationRow>{
 const row=await location(client,id,lock);
 if(ownerOnly?row.owner_id!==actor:!await locationManager(client,actor,row.id))throw new DomainError('forbidden',ownerOnly?'Alleen de locatie-eigenaar kan dit aanpassen.':'Je hebt geen beheerrecht voor deze locatie.',403);
 return row;
}
async function audit(client:Client,actor:string,action:string,detail:Record<string,unknown>,eventId:string|null=null,clubId:string|null=null):Promise<void>{
 await client.query('insert into dartflow_private.audit_events(actor_id,club_id,event_id,action,detail) values($1,$2,$3,$4,$5)',[actor,clubId,eventId,action,JSON.stringify(detail)]);
}
async function reservation(client:Client,id:string,lock=false):Promise<ReservationRow>{
 const result=await client.query<ReservationRow>(`select * from dartflow_private.board_reservations where id=$1${lock?' for update':''}`,[uuid(id)]);
 if(!result.rows.length)throw new DomainError('not_found','Deze reservering bestaat niet.',404);return result.rows[0];
}
async function managedBoardState(client:Client,boardId:string):Promise<Pick<LocationBoard,'activity'|'activeGame'|'reservation'|'closed'|'closePending'|'effectiveStatus'>>{
 const physical=await physicalBoard(client,boardId);if(!physical)throw new DomainError('not_found','Deze fysieke baan bestaat niet.',404);
 const activity=await readBoardActivity(client,boardId),match=(await client.query<{id:string;state:{players:{name:string}[];scoringMode?:string}}>('select id,state from dartflow_private.matches where board_id=$1',[boardId])).rows[0],lease=match?null:await boardLease(client,boardId);
 const sourceId=activity?.sourceId??match?.id??lease?.id;
 let activeGame:LocationBoard['activeGame']=null;
 if(sourceId){
  const playerNames=match?match.state.players.map(p=>p.name):(await client.query<{name:string}>(`select p.name from dartflow_private.platform_entities pe join dartflow_private.profile_labels p on p.id=pe.owner_id where pe.id=$1
   union select p.name from dartflow_private.platform_members pm join dartflow_private.profile_labels p on p.id=pm.user_id where pm.entity_id=$1 and pm.status in('active','invited') order by name`,[sourceId])).rows.map(p=>p.name);
  const boards=(await client.query<{id:string;name:string}>('select id,name from dartflow_private.boards where id=any($1::uuid[]) order by id',[activity?.boardIds??[boardId]])).rows;
  activeGame={id:sourceId,kind:activity?.kind??'free',label:playerNames.length?playerNames.join(' – '):lease?.kind==='training'?'Solo-oefenpartij':'Huidige partij',playerNames,remote:Boolean(boards.length>1||match?.state.scoringMode==='per-player'||lease?.state.setup==='remote'||lease?.state.setup==='hybrid'),boards};
 }
 let reserved=await activeBoardReservation(client,boardId);
 if(match){const linked=(await client.query<NonNullable<typeof reserved>>(`select r.id,r.event_id,r.club_id,e.name as event_name,r.starts_at,r.ends_at,r.max_matches,r.location_id
   from dartflow_private.reservation_matches rm join dartflow_private.board_reservations r on r.id=rm.reservation_id join dartflow_private.events e on e.id=r.event_id where rm.match_id=$1 and rm.board_id=$2`,[match.id,boardId])).rows[0];if(linked)reserved=linked;}
 const reservationView=reserved?{id:reserved.id,label:reserved.event_name,eventId:reserved.event_id,startsAt:reserved.starts_at.toISOString(),endsAt:reserved.ends_at.toISOString(),overrun:reserved.ends_at.getTime()<=Date.now()}:null;
 const closed=Boolean(physical.closed_at),closePending=physical.close_after_session;
 const effectiveStatus=physical.archived_at?'archived':physical.blocked?'blocked':closed?'closed':activeGame?'occupied':closePending?'closed':reservationView?'reserved':'open';
 return {activity,activeGame,reservation:reservationView,closed,closePending,effectiveStatus};
}
export async function getLocationOverview(actor:string):Promise<LocationOverview>{
 const client=database(),id=uuid(actor);
 const rights=(await client.query<{home_enabled:boolean;venue_enabled:boolean}>('select home_enabled,venue_enabled from dartflow_private.location_accounts where user_id=$1',[id])).rows[0];
 const owned=(await client.query<LocationRow>(`select l.id,l.owner_id,l.kind,l.name,l.timezone from dartflow_private.locations l where l.owner_id=$1 or exists(select 1 from dartflow_private.location_members lm where lm.location_id=l.id and lm.user_id=$1) order by l.kind,l.created_at,l.id limit 100`,[id])).rows;
 const locations:PhysicalLocation[]=[];
 for(const loc of owned){
  const boards=(await client.query<{id:string;name:string;reservation_enabled:boolean;archived_at:Date|null;public_screen:boolean;legacy_club:boolean;blocked:boolean;occupied:boolean}>(`select b.id,b.name,lb.reservation_enabled,lb.archived_at,lb.public_screen,b.blocked,exists(select 1 from dartflow_private.club_boards cb where cb.board_id=b.id) as legacy_club,
   (exists(select 1 from dartflow_private.matches m where m.board_id=b.id) or exists(select 1 from dartflow_private.board_activity_links al join dartflow_private.board_activity_sessions ac on ac.id=al.session_id where al.board_id=b.id and ac.status in('active','completed')) or exists(select 1 from dartflow_private.platform_entities pe where pe.state->>'boardId'=b.id::text and coalesce(pe.state->>'closed','false')<>'true' and (pe.state->>'boardLeaseUntil')::bigint>floor(extract(epoch from now())*1000) and((pe.kind='training' and pe.state->>'boardHeld'='true') or(pe.kind='lobby' and pe.state->>'matchId' is null)))) as occupied
   from dartflow_private.location_boards lb join dartflow_private.boards b on b.id=lb.board_id where lb.location_id=$1 order by lb.created_at,b.id`,[loc.id])).rows;
  const managers=loc.owner_id===id?(await client.query<{id:string;name:string}>('select p.id,p.name from dartflow_private.location_members lm join dartflow_private.profile_labels p on p.id=lm.user_id where lm.location_id=$1 order by p.name,p.id',[loc.id])).rows:[];
  const projected:LocationBoard[]=[];for(const b of boards)projected.push({id:b.id,name:b.name,locationId:loc.id,enabled:b.reservation_enabled,archived:Boolean(b.archived_at),publicScreen:b.public_screen,legacyClub:b.legacy_club,blocked:b.blocked,occupied:b.occupied,...await managedBoardState(client,b.id),playUrl:`/baan/${b.id}`,screenUrl:`/baanscherm/${b.id}`});
  locations.push({id:loc.id,name:loc.name,kind:loc.kind,timezone:loc.timezone,role:loc.owner_id===id?'owner':'manager',managers,boards:projected});
 }
 const available=(await client.query<{id:string;name:string;timezone:string;board_id:string;board_name:string}>(`select l.id,l.name,l.timezone,b.id as board_id,b.name as board_name from dartflow_private.locations l join dartflow_private.location_boards lb on lb.location_id=l.id join dartflow_private.boards b on b.id=lb.board_id where l.kind='venue' and lb.reservation_enabled and lb.archived_at is null and lb.closed_at is null and not lb.close_after_session and not b.blocked order by l.name,l.id,b.name,b.id limit 500`)).rows;
 const bookableLocations=[...new Set(available.map(row=>row.id))].map(locationId=>{const first=available.find(row=>row.id===locationId)!;return {id:first.id,name:first.name,timezone:first.timezone,boards:available.filter(row=>row.id===locationId).map(row=>({id:row.board_id,name:row.board_name}))};});
 const candidates=(await client.query<{id:string;name:string;club_id:string;club_name:string}>(`select e.id,e.name,e.club_id,c.name as club_name from dartflow_private.events e join dartflow_private.clubs c on c.id=e.club_id where (exists(select 1 from dartflow_private.club_memberships cm where cm.club_id=c.id and cm.user_id=$1) or exists(select 1 from dartflow_private.competition_seasons cs where cs.state->>'eventId'=e.id::text and(cs.owner_id=$1 or cs.state->'managerIds' ? $1::text or cs.scope='national' and exists(select 1 from dartflow_private.platform_roles pr where pr.user_id=$1 and pr.role in('owner','admin'))))) and not exists(select 1 from dartflow_private.location_boards lb where lb.home_event_id=e.id) and not exists(select 1 from dartflow_private.club_boards cb where cb.event_id=e.id) order by e.date desc,e.id limit 200`,[id])).rows;
 const events:LocationOverview['events']=[];for(const candidate of candidates)if(await currentOrganizer(client,id,candidate.id)){const e=await organizer(client,id,candidate.id);events.push({id:e.id,name:e.name,clubId:e.club_id,clubName:candidate.club_name,kind:e.kind});}
 const rows=(await client.query<ReservationRow&{location_name:string;timezone:string;event_name:string;club_name:string;used_matches:number;overrun:boolean}>(`select r.*,l.name as location_name,l.timezone,e.name as event_name,c.name as club_name,(select count(distinct match_id)::int from dartflow_private.reservation_matches rm where rm.reservation_id=r.id) as used_matches,
  (r.ends_at<=now() and exists(select 1 from dartflow_private.reservation_matches rm join dartflow_private.matches m on m.id=rm.match_id where rm.reservation_id=r.id and(m.board_id=rm.board_id or exists(select 1 from dartflow_private.board_activity_links bal join dartflow_private.board_activity_sessions bas on bas.id=bal.session_id where bal.board_id=rm.board_id and bas.source_kind='match' and bas.source_id=m.id and bas.event_id=m.event_id and bas.status in('active','completed'))))) as overrun
  from dartflow_private.board_reservations r join dartflow_private.locations l on l.id=r.location_id join dartflow_private.events e on e.id=r.event_id join dartflow_private.clubs c on c.id=r.club_id
  where r.requester_id=$1 or l.owner_id=$1 or exists(select 1 from dartflow_private.location_members lm where lm.location_id=l.id and lm.user_id=$1) or exists(select 1 from dartflow_private.event_staff s where s.event_id=r.event_id and s.user_id=$1)
  order by r.created_at desc,r.id limit 200`,[id])).rows;
 const reservations:BoardReservation[]=[];
 for(const r of rows){const canDecide=await locationManager(client,id,r.location_id),canOrganize=events.some(e=>e.id===r.event_id);if(!canDecide&&!canOrganize&&r.requester_id!==id)continue;
  const boards=(await client.query<{id:string;name:string}>('select b.id,b.name from dartflow_private.reservation_boards rb join dartflow_private.boards b on b.id=rb.board_id where rb.reservation_id=$1 order by b.name,b.id',[r.id])).rows;
  reservations.push({id:r.id,locationId:r.location_id,locationName:r.location_name,timezone:r.timezone,eventId:r.event_id,eventName:r.event_name,clubId:r.club_id,clubName:r.club_name,requesterId:r.requester_id,startsAt:r.starts_at.toISOString(),endsAt:r.ends_at.toISOString(),boardCount:r.board_count,maxMatches:r.max_matches,status:r.status,revision:r.revision,reason:r.reason,canDecide,canCancel:(canDecide||canOrganize)&&(r.status==='pending'||r.status==='accepted'&&r.starts_at.getTime()>Date.now()),...(r.preferred_board_id?{preferredBoardId:r.preferred_board_id}:{}),boards,usedMatches:r.used_matches,overrun:r.overrun});
 }
 return {serverNow:Number((await client.query<{now:string}>('select extract(epoch from clock_timestamp())*1000 as now')).rows[0].now),rights:{home:Boolean(rights?.home_enabled),venue:Boolean(rights?.venue_enabled)},locations,bookableLocations,events,reservations};
}
/** Compatibility creation requires independently activated physical ownership. */
export async function ensureLegacyPhysicalBoard(client:Client,actor:string,boardId:string,eventId:string,name:string):Promise<void>{
 if(!(await client.query('select 1 from dartflow_private.location_accounts where user_id=$1 and venue_enabled',[actor])).rowCount)throw new DomainError('location_inactive','Activeer eerst je eigen locatiebeheer bij Mijn banen & locaties. Een verenigingsrol geeft geen baanbeheer.',403);
 const locationId=randomUUID();
 await client.query("insert into dartflow_private.locations(id,owner_id,kind,name) values($1,$2,'venue',$3)",[locationId,actor,label(name)]);
 await client.query('insert into dartflow_private.location_boards(board_id,location_id,home_event_id,public_screen) values($1,$2,$3,true)',[boardId,locationId,eventId]);
}
export async function revalidateLocationCommand(client:Client,actor:string,command:PlatformCommand,response:PlatformResponse):Promise<void>{
 const a=command.action;
 if(a.type.startsWith('location.')&&!['location.enable-home','location.enable-venue'].includes(a.type)){
  const id=a.type==='location.create'?response.id:a.locationId;
  if(id)await managed(client,actor,uuid(id),['location.rename','location.manager.add','location.manager.remove'].includes(a.type),false);
 }
 if(a.type.startsWith('reservation.')){
  const r=await reservation(client,uuid(a.reservationId??response.id));
  if(a.type==='reservation.accept'||a.type==='reservation.decline')await managed(client,actor,r.location_id,false,false);
  else if(a.type==='reservation.fixture.start'){
   const linked=await client.query<{state:{fixtures?:{id:string;players:(string|null)[]}[]}}>("select state from dartflow_private.platform_entities where state->>'eventId'=$1 and kind in('league','tournament')",[r.event_id]);
   if(!linked.rows[0]?.state.fixtures?.some(f=>f.id===a.fixtureId&&f.players.includes(actor))&&!await currentOrganizer(client,actor,r.event_id))throw new DomainError('forbidden','Deze partij hoort bij andere deelnemers.',403);
  }else if(!await locationManager(client,actor,r.location_id)&&!await currentOrganizer(client,actor,r.event_id))throw new DomainError('forbidden','Je hebt geen actueel recht voor deze reservering.',403);
 }
}
export async function locationAction(client:PoolClient,actor:string,command:PlatformCommand):Promise<PlatformResponse|null>{
 const a=command.action;
 if(a.type==='location.enable-home'||a.type==='location.enable-venue'){
  const home=a.type==='location.enable-home';
  await client.query(`insert into dartflow_private.location_accounts(user_id,home_enabled,venue_enabled) values($1,$2,$3) on conflict(user_id) do update set ${home?'home_enabled':'venue_enabled'}=true`,[actor,home,!home]);
  if(home){const id=randomUUID();await client.query("insert into dartflow_private.locations(id,owner_id,kind,name) values($1,$2,'home','Thuis') on conflict(owner_id) where kind='home' do nothing",[id,actor]);}
  return {ok:true};
 }
 if(a.type==='location.create'){
  if(!(await client.query('select 1 from dartflow_private.location_accounts where user_id=$1 and venue_enabled',[actor])).rowCount)throw new DomainError('location_inactive','Activeer eerst locatiebeheer.',403);
  const id=randomUUID();await client.query("insert into dartflow_private.locations(id,owner_id,kind,name,timezone) values($1,$2,'venue',$3,$4)",[id,actor,label(a.name),timezone(a.timezone)]);await audit(client,actor,a.type,{locationId:id});return {ok:true,id};
 }
 if(a.type==='reservation.fixture.start'){
  const r=await reservation(client,uuid(a.reservationId));
  const linked=(await client.query<{id:string}>("select id from dartflow_private.platform_entities where state->>'eventId'=$1 and kind in('league','tournament') order by id limit 1",[r.event_id])).rows[0];
  if(!linked)throw new DomainError('event_unavailable','Deze speeldag heeft nog geen wedstrijdplanning.',409);
  const row=await entity(client,linked.id,true),fixture=row.state.fixtures?.find(f=>f.id===a.fixtureId),boardId=uuid(a.boardId);
  if(!fixture||fixture.players[0]!==actor&&!await currentOrganizer(client,actor,r.event_id))throw new DomainError('forbidden','Alleen de aangewezen eerste speler of wedstrijdleiding kan deze partij oproepen.',403);
  const active=await activeBoardReservation(client,boardId);
  if(active?.id!==r.id)throw new DomainError('reservation_window','Deze baan kan alleen binnen het goedgekeurde tijdvak worden gebruikt.',409);
  if(fixture.matchId){const current=await client.query('select 1 from dartflow_private.matches where id=$1 and board_id=$2',[fixture.matchId,boardId]);if(current.rowCount)return {ok:true,id:r.id,matchId:fixture.matchId};}
  const assigned=await autoAssign(client,row,{fixtureId:fixture.id,boardId},{actorId:actor,requestId:command.requestId});
  if(!assigned.length)throw new DomainError('assignment_unavailable','Beide aangewezen spelers moeten ingecheckt en beschikbaar zijn. Controleer ook baan en schrijver.',409);
  await save(client,row);return {ok:true,id:r.id,matchId:assigned[0].matchId};
 }
 if(a.type==='reservation.request'){
  const event=await organizer(client,actor,uuid(a.eventId),true),locationId=uuid(a.locationId),loc=await location(client,locationId,true);
  if(loc.kind!=='venue')throw new DomainError('location_unavailable','Een thuisbaan kan niet worden gereserveerd.',403);
  const start=instant(a.startsAt),end=instant(a.endsAt),boardCount=count(a.boardCount,16),maxMatches=count(a.maxMatches,32);
  if(start.getTime()<Date.now()-300_000||end.getTime()<=Math.max(Date.now(),start.getTime())||end.getTime()-start.getTime()>7*24*60*60_000)throw new DomainError('invalid_window','Kies een toekomstig tijdvak van maximaal zeven dagen.');
  const available=await client.query<{count:number}>('select count(*)::int as count from dartflow_private.location_boards lb join dartflow_private.boards b on b.id=lb.board_id where lb.location_id=$1 and lb.reservation_enabled and lb.archived_at is null and lb.closed_at is null and not lb.close_after_session and not b.blocked',[loc.id]);
  if(available.rows[0].count<boardCount)throw new DomainError('reservation_capacity','Deze locatie heeft onvoldoende opengestelde banen.',409);
  const preferredBoardId=a.preferredBoardId===undefined?null:uuid(a.preferredBoardId);
  if(preferredBoardId&&!(await client.query('select 1 from dartflow_private.location_boards lb join dartflow_private.boards b on b.id=lb.board_id where lb.location_id=$1 and lb.board_id=$2 and lb.reservation_enabled and lb.archived_at is null and lb.closed_at is null and not lb.close_after_session and not b.blocked',[loc.id,preferredBoardId])).rowCount)throw new DomainError('board_unavailable','Deze aangevraagde baan is niet beschikbaar bij de gekozen locatie.',409);
  const id=randomUUID();await client.query('insert into dartflow_private.board_reservations(id,location_id,requester_id,club_id,event_id,starts_at,ends_at,board_count,max_matches,preferred_board_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,loc.id,actor,event.club_id,event.id,start.toISOString(),end.toISOString(),boardCount,maxMatches,preferredBoardId]);
  const managers=(await client.query('select owner_id as id from dartflow_private.locations where id=$1 union select user_id from dartflow_private.location_members where location_id=$1',[loc.id])).rows.map(p=>p.id);
  await enqueueAuditedNotification(client,{eventId:`reservation:${id}:requested`,templateId:'reservation-requested',actorId:actor,recipientIds:managers,source:{kind:'reservation',reservationId:id,revision:0},href:'/app/locations',status:'Er staat een nieuwe baanreserveringsaanvraag klaar.'});
  await audit(client,actor,a.type,{reservationId:id,locationId:loc.id,startsAt:start.toISOString(),endsAt:end.toISOString(),boardCount,maxMatches,preferredBoardId},event.id,event.club_id);return {ok:true,id};
 }
 if(['reservation.accept','reservation.decline','reservation.cancel'].includes(a.type)){
  const before=await reservation(client,uuid(a.reservationId));
  // Club permissions cannot be removed while this decision validates the original organizer.
  await client.query("select id from dartflow_private.platform_entities where id=$1 and kind='club' for share",[before.club_id]);
  const loc=await location(client,before.location_id,true),canManage=await locationManager(client,actor,loc.id);
  if(a.type!=='reservation.cancel'&&!canManage)throw new DomainError('forbidden','Alleen locatiebeheer kan een aanvraag beoordelen.',403);
  if(a.type==='reservation.cancel'&&!canManage&&!await currentOrganizer(client,actor,before.event_id))throw new DomainError('forbidden','Je hebt geen actueel recht om deze reservering te annuleren.',403);
  const boardIds=a.type==='reservation.accept'&&Array.isArray(a.boardIds)?[...new Set(a.boardIds.map(uuid))].sort():[];
  if(a.type==='reservation.accept'){
   if(boardIds.length!==before.board_count)throw new DomainError('reservation_capacity','Wijs precies het aangevraagde aantal banen toe.');
   await client.query('select id from dartflow_private.boards where id=any($1::uuid[]) order by id for update',[boardIds]);
  }
  const r=await reservation(client,before.id,true);
  if(command.expectedRevision!==r.revision)throw new DomainError('revision_conflict','Deze reservering is gewijzigd. Ververs en probeer opnieuw.',409);
  if(r.ends_at.getTime()<=Date.now()||(a.type==='reservation.cancel'?(r.status!=='pending'&&(r.status!=='accepted'||r.starts_at.getTime()<=Date.now())):r.status!=='pending'))throw new DomainError('reservation_changed','Deze aanvraag is verwerkt, verlopen of het tijdvak is al begonnen.',409);
  const desired=a.type==='reservation.accept'?'accepted':a.type==='reservation.decline'?'declined':'cancelled';
  if(desired==='accepted'){
   await organizer(client,r.requester_id,r.event_id);
   if(r.preferred_board_id&&!boardIds.includes(r.preferred_board_id))throw new DomainError('reservation_board','Wijs ook de expliciet aangevraagde baan toe.',409);
   const valid=await client.query('select 1 from dartflow_private.location_boards lb join dartflow_private.boards b on b.id=lb.board_id where lb.location_id=$1 and lb.board_id=any($2::uuid[]) and lb.reservation_enabled and lb.archived_at is null and lb.closed_at is null and not lb.close_after_session and not b.blocked',[loc.id,boardIds]);
   if(valid.rowCount!==boardIds.length)throw new DomainError('board_unavailable','Een gekozen baan is uitgeschakeld of hoort bij een andere locatie.',409);
   const overlaps=await client.query(`select 1 from dartflow_private.reservation_boards rb join dartflow_private.board_reservations other on other.id=rb.reservation_id where rb.board_id=any($1::uuid[]) and other.status='accepted' and other.starts_at<$3 and $2<other.ends_at limit 1`,[boardIds,r.starts_at,r.ends_at]);
   if(overlaps.rowCount)throw new DomainError('reservation_overlap','Een gekozen baan is in dit tijdvak al gereserveerd.',409);
   for(const id of boardIds)await client.query('insert into dartflow_private.reservation_boards(reservation_id,board_id) values($1,$2)',[r.id,id]);
  }
  const reason=a.reason===undefined?'':typeof a.reason==='string'?a.reason.trim().slice(0,300):'';
  await client.query('update dartflow_private.board_reservations set status=$2,revision=revision+1,reason=$3,decided_by=$4,decided_at=now() where id=$1',[r.id,desired,reason,actor]);
  const recipients=(await client.query('select owner_id as id from dartflow_private.locations where id=$1 union select user_id from dartflow_private.location_members where location_id=$1 union select user_id from dartflow_private.club_memberships where club_id=$2 union select user_id from dartflow_private.event_staff where event_id=$3',[loc.id,r.club_id,r.event_id])).rows.map(p=>p.id);
  await enqueueAuditedNotification(client,{eventId:`reservation:${r.id}:${command.requestId}`,templateId:'reservation-updated',actorId:actor,recipientIds:[r.requester_id,...recipients],source:{kind:'reservation',reservationId:r.id,revision:r.revision+1},href:'/app/locations',status:desired==='accepted'?'Je reservering is bevestigd.':desired==='declined'?'De reserveringsaanvraag is afgewezen.':'De reservering is geannuleerd.'});
  await audit(client,actor,a.type,{reservationId:r.id,locationId:loc.id,boardIds,startsAt:r.starts_at.toISOString(),endsAt:r.ends_at.toISOString()},r.event_id,r.club_id);return {ok:true,id:r.id};
 }
 if(!a.type.startsWith('location.'))return null;
 const loc=await managed(client,actor,uuid(a.locationId),['location.rename','location.manager.add','location.manager.remove'].includes(a.type));
 if(a.type==='location.rename'){
  await client.query('update dartflow_private.locations set name=$2,timezone=$3 where id=$1',[loc.id,label(a.name),a.timezone===undefined?loc.timezone:timezone(a.timezone)]);
 }else if(a.type==='location.manager.add'||a.type==='location.manager.remove'){
  if(loc.kind!=='venue')throw new DomainError('forbidden','Een thuisbaan heeft alleen een eigenaar.',403);
  const user=uuid(a.userId);if(user===loc.owner_id)throw new DomainError('location_owner','De eigenaar is geen gedelegeerde beheerder.');
  if(!(await client.query('select 1 from dartflow_private.profiles where id=$1',[user])).rowCount)throw new DomainError('profile_missing','Dit spelersprofiel bestaat niet.',404);
  const changed=a.type==='location.manager.add'?await client.query('insert into dartflow_private.location_members(location_id,user_id,granted_by) values($1,$2,$3) on conflict do nothing returning user_id',[loc.id,user,actor]):await client.query('delete from dartflow_private.location_members where location_id=$1 and user_id=$2 returning user_id',[loc.id,user]);
  if(changed.rowCount)await enqueueAuditedNotification(client,{eventId:`location-role:${loc.id}:${command.requestId}`,templateId:'location-role-changed',actorId:actor,recipientIds:[user],source:{kind:'location-role',locationId:loc.id,playerId:user,manager:a.type==='location.manager.add'},href:'/app/locations',status:a.type==='location.manager.add'?'Je hebt gedeeld fysiek locatiebeheer gekregen.':'Je gedeelde fysieke locatiebeheer is ingetrokken.'});
 }else if(a.type==='location.board.create'){
  if(loc.kind==='home'&&(await client.query('select 1 from dartflow_private.location_boards where location_id=$1',[loc.id])).rowCount)throw new DomainError('home_board_exists','Je hebt al een vaste thuisbaan.',409);
  const existing=await client.query<{count:number}>('select count(*)::int as count from dartflow_private.location_boards where location_id=$1',[loc.id]);if(existing.rows[0].count>=32)throw new DomainError('location_capacity','Een locatie heeft maximaal 32 vaste banen.',409);
  const boardId=randomUUID(),clubId=randomUUID(),eventId=randomUUID(),name=label(a.name,40);
  // An internal scoring container is not a discoverable club and grants nobody club membership.
  await client.query('insert into dartflow_private.clubs(id,name) values($1,$2)',[clubId,`Locatie · ${loc.id}`]);
  await client.query('insert into dartflow_private.events(id,club_id,name,date,capacity) values($1,$2,$3,current_date,128)',[eventId,clubId,loc.name]);
  await client.query('insert into dartflow_private.boards(id,event_id,name) values($1,$2,$3)',[boardId,eventId,name]);
  await client.query('insert into dartflow_private.location_boards(board_id,location_id,home_event_id,home_owner_id,public_screen) values($1,$2,$3,$4,$5)',[boardId,loc.id,eventId,loc.kind==='home'?loc.owner_id:null,loc.kind==='venue']);
  await audit(client,actor,a.type,{locationId:loc.id,boardId});return {ok:true,id:boardId,locationId:loc.id};
 }else if(['location.board.open','location.board.close','location.board.force-release'].includes(a.type)){
  const boardId=uuid(a.boardId),before=await physicalBoard(client,boardId);if(before?.location_id!==loc.id)throw new DomainError('not_found','Deze baan hoort niet bij deze locatie.',404);
  if(a.type==='location.board.force-release'){
   const sessionId=uuid(a.expectedSessionId),locked=await lockBoardActivity(client,sessionId),current=await readBoardActivity(client,boardId);
   if(!locked||!current||current.sessionId!==sessionId||!['active','warning','completed'].includes(locked.view.phase)||!locked.view.boardIds.includes(boardId))throw new DomainError('assignment_changed','Deze baan heeft inmiddels een andere of geen actieve partij. Vernieuw de bevestiging.',409);
   const physical=await physicalBoard(client,boardId),sourceId=uuid(a.confirmedSourceId),detail=await managedBoardState(client,boardId);
   if(physical?.location_id!==loc.id||!await locationManager(client,actor,loc.id))throw new DomainError('forbidden','Je hebt geen actueel beheerrecht voor deze baan.',403);
   if(typeof a.confirmedBoardName!=='string'||a.confirmedBoardName.normalize('NFC').trim()!==physical.name.normalize('NFC')||sourceId!==current.sourceId)throw new DomainError('release_confirmation','Bevestig de actuele baannaam en wedstrijd voordat je vrijgeeft.');
   if(detail.activeGame?.remote&&a.confirmedRemoteEffect!==true)throw new DomainError('remote_confirmation','Bevestig dat de tegenstander en alle gekoppelde banen ook worden geraakt.');
   const reason=label(a.reason,300);
   await releaseBoardActivity(client,{sessionId,reason:'forced',actorId:actor});
   await audit(client,actor,a.type,{locationId:loc.id,boardId,sessionId,sourceId,kind:current.kind,boardIds:current.boardIds,reason,remote:Boolean(detail.activeGame?.remote)});
   return {ok:true,id:loc.id,releasedSessionId:sessionId};
  }
  await client.query('select id from dartflow_private.boards where id=$1 for update',[boardId]);
  const physical=await physicalBoard(client,boardId);if(!physical||physical.location_id!==loc.id)throw new DomainError('not_found','Deze baan hoort niet bij deze locatie.',404);
  if(a.type==='location.board.open'){
   if(physical.archived_at)throw new DomainError('board_unavailable','Herstel deze buiten gebruik gestelde baan eerst.',409);
   await client.query('update dartflow_private.location_boards set closed_at=null,close_after_session=false where board_id=$1',[boardId]);
   await client.query('update dartflow_private.boards set blocked=false where id=$1',[boardId]);
   await audit(client,actor,a.type,{locationId:loc.id,boardId});
  }else{
   const lease=await boardLease(client,boardId),occupied=Boolean((await client.query('select 1 from dartflow_private.matches where board_id=$1',[boardId])).rowCount||lease?.kind==='training');
   await client.query('update dartflow_private.location_boards set closed_at=case when $2 then null else clock_timestamp() end,close_after_session=$2 where board_id=$1',[boardId,occupied]);
   await audit(client,actor,a.type,{locationId:loc.id,boardId,afterCurrentSession:occupied});
  }
  return {ok:true,id:loc.id};
 }else if(a.type==='location.board.update'){
  const boardId=uuid(a.boardId),before=await physicalBoard(client,boardId);if(before?.location_id!==loc.id)throw new DomainError('not_found','Deze baan hoort niet bij deze locatie.',404);
  await client.query('select id from dartflow_private.boards where id=$1 for update',[boardId]);
  const occupied=Boolean((await client.query('select 1 from dartflow_private.matches where board_id=$1',[boardId])).rowCount||await boardLease(client,boardId));
  if((a.archived===true||a.blocked===true)&&occupied)throw new DomainError('board_occupied','Rond eerst de actieve partij of training af.',409);
  if(a.archived===true&&(await client.query("select 1 from dartflow_private.reservation_boards rb join dartflow_private.board_reservations r on r.id=rb.reservation_id where rb.board_id=$1 and r.status='accepted' and r.ends_at>now()",[boardId])).rowCount)throw new DomainError('board_reserved','Deze baan heeft nog een goedgekeurde reservering.',409);
  if(a.enabled!==undefined&&typeof a.enabled!=='boolean'||a.archived!==undefined&&typeof a.archived!=='boolean'||a.publicScreen!==undefined&&typeof a.publicScreen!=='boolean'||a.blocked!==undefined&&typeof a.blocked!=='boolean')throw new DomainError('invalid_board','Kies geldige baaninstellingen.');
  if(a.publicScreen===false&&(await client.query('select 1 from dartflow_private.club_boards where board_id=$1',[boardId])).rowCount)throw new DomainError('legacy_public_screen','Dit bestaande verenigingsscherm behoudt zijn openbare schermlinks. Nieuwe locatiebanen ondersteunen een afgeschermd scherm.');
  if(loc.kind==='home'&&a.enabled===true)throw new DomainError('home_reservation','Een thuisbaan kan niet voor verenigingsaanvragen worden opengesteld.');
  await client.query('update dartflow_private.boards set name=$2,blocked=$3 where id=$1',[boardId,a.name===undefined?before.name:label(a.name,40),a.blocked??before.blocked]);
  await client.query('update dartflow_private.location_boards set reservation_enabled=$2,public_screen=$3,archived_at=$4 where board_id=$1',[boardId,a.enabled??before.reservation_enabled,a.publicScreen??before.public_screen,a.archived===undefined?before.archived_at:a.archived?new Date():null]);
 }else throw new DomainError('invalid_action','Onbekende locatieactie.');
 await audit(client,actor,a.type,{locationId:loc.id,...(a.boardId?{boardId:a.boardId}:{})});return {ok:true,id:loc.id};
}
