import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {database,getBoardForActor} from './db';
import {applyMatchAction,DomainError} from './domain';
import {enqueueDomainMail} from './integrations-mail';
import {assertAccountActive} from './account-removal';
import {assertPhysicalBoardEvent,physicalBoard} from './location-access';
import {assertBoardUnreserved,assertPlayersFree,lockPlayingActors} from './platform-locks';
import {canonical,createCoreMatch,entity,transaction,uuid,type Client} from './platform-store';
import {seasonBoardLobbyAccess as seasons} from './seasons';
import {seasonSlotSettings} from './season-rules';
import {seasonFixturePlayMode} from './season-play-mode';
import {isTeamSeason,slotPeople} from './seasons-formats';
import {limitPlayerPinAttempts,playerPinVerifier,recordPlayerPinOutcome,verifyPlayerPin} from './player-pin';
import {validUsername} from './display-name';
import type {SeasonState,SeasonFixture,SeasonSlot} from './seasons-types';
import type {MatchState} from './types';
import type {CompetitionBoardCandidate,CompetitionBoardContext,CompetitionBoardLobby,CompetitionLobbyDisplay} from './competition-board-lobby-types';

type Confirmation={method:'account'|'pin';at:string;pinVersion?:number};
type Row={id:string;season_id:string;fixture_id:string;slot_id:string;match_id:string;board_id:string;owner_id:string;player_ids:[string,string];writer_id:string;confirmations:Record<string,Confirmation>;status:CompetitionBoardLobby['status'];expires_at:Date;revision:number};
type Input={requestId?:unknown;action?:{type?:unknown;boardId?:unknown;seasonId?:unknown;fixtureId?:unknown;slotId?:unknown;lobbyId?:unknown}};
const millis=(value:Date|string)=>new Date(value).getTime();
const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
const now=async(client:Client)=>Number((await client.query('select extract(epoch from clock_timestamp())*1000 as now')).rows[0].now);
const expired=(row:Row,time:number)=>['waiting','ready'].includes(row.status)&&millis(row.expires_at)<=time;
function fixture(s:SeasonState,id:string):SeasonFixture{const f=s.fixtures.find(f=>f.id===id);if(!f)throw new DomainError('assignment_changed','Deze geplande ontmoeting is niet meer beschikbaar.',409);return f;}
function slot(f:SeasonFixture,id:string):SeasonSlot{const value=f.slots.find(x=>x.id===id);if(!value)throw new DomainError('assignment_changed','Dit onderdeel is gewijzigd. Open de actuele competitieplanning.',409);return value;}
function reason(s:SeasonState,f:SeasonFixture,p:SeasonSlot,time:number):string|undefined{
 if(!['planned','active'].includes(s.status)||!s.publishedAt)return 'Het programma is nog niet gepubliceerd om te spelen.';
 if(!s.rounds.some(r=>r.number===f.round&&r.released))return 'Deze ronde is nog niet vrijgegeven door de competitieleiding.';
 if(['canceled','administrative','confirmed','disputed','provisional'].includes(f.status)||['confirmed','provisional','canceled','administrative'].includes(p.status))return 'Deze partij is afgehandeld, geannuleerd of wacht op een besluit.';
 if(time<Date.parse(f.windowStart))return 'Deze partij mag nog niet starten: het bestaande speelvenster is nog niet open.';
 if(time>=Date.parse(f.windowEnd))return 'Het bestaande speelvenster is verstreken. Vraag de competitieleiding om herstel.';
 if(seasonFixturePlayMode(s,f)!=='local')return 'Open de competitieplanning om de twee fysieke zijden of de speelwijze vast te leggen.';
 if(isTeamSeason(s)&&!(f.lineups.home?.submittedAt&&f.lineups.away?.submittedAt))return 'Beide captains moeten eerst hun definitieve opstelling indienen.';
 if(slotPeople(p).length!==2||!p.players.every(Boolean))return 'Dit onderdeel vereist de volledige team- of koppelopstelling via de competitieplanning.';
 if(slotPeople(p).some(id=>f.availability?.[id]===false||s.participants.find(e=>e.id===id)?.available===false))return 'Een geplande speler is als niet beschikbaar gemeld.';
}
async function readState(client:Client,actor:string,id:string){const s=await seasons.read(client,id);if(!await seasons.readable(client,s,actor))throw new DomainError('forbidden','Je hebt geen toegang tot deze competitie.',403);return s;}
async function assertPeople(client:Client,s:SeasonState,f:SeasonFixture,p:SeasonSlot,actor:string){
 const ids=slotPeople(p);if(ids.length!==2||!ids.includes(actor)||!p.players.every(Boolean))throw new DomainError('wrong_participant','Alleen de twee geplande spelers kunnen deze baanlobby bevestigen.',403);
 for(const id of ids){await assertAccountActive(id,client);const team=s.teams.find(t=>t.playerIds.includes(id));if(isTeamSeason(s)&&(!team||team.status!=='active')||!isTeamSeason(s)&&!s.participants.some(e=>e.id===id&&e.status==='active'))throw new DomainError('player_ineligible','Een geplande speler is niet meer speelgerechtigd.',409);await seasons.eligible(client,id,team?.clubId??s.clubId);}
 if((await client.query("select 1 from dartflow_private.platform_relationships where kind='block' and((source_id=$1 and target_id=$2)or(source_id=$2 and target_id=$1))",ids)).rowCount)throw new DomainError('blocked','Deze spelers kunnen nu geen gezamenlijke baanlobby openen.',403);
}
async function assertBoard(client:Client,s:SeasonState,f:SeasonFixture,boardId:string,allowedLobbyId:string|null=null){
 const board=(await client.query<{id:string;name:string;blocked:boolean}>('select id,name,blocked from dartflow_private.boards where id=$1 for update',[boardId])).rows[0];if(!board||board.blocked)throw new DomainError('board_unavailable','Deze baan is niet beschikbaar.',409);
 if((await client.query("select 1 from dartflow_private.competition_board_lobbies where board_id=$1 and($2::uuid is null or id<>$2)and status in('waiting','ready')and expires_at>clock_timestamp()",[boardId,allowedLobbyId])).rowCount)throw new DomainError('board_reserved','Deze baan wordt al klaargezet voor een andere geplande partij.',409);
 const location=await physicalBoard(client,boardId);if(location?.archived_at||location?.closed_at||location?.close_after_session)throw new DomainError('board_closed','Deze baan neemt geen nieuwe partijen aan.',409);
 const clubs=s.scope==='internal'?[s.clubId]:s.teams.filter(t=>[f.homeId,f.awayId].includes(t.id)).map(t=>t.clubId);
 if(!(await client.query('select 1 from dartflow_private.club_boards where board_id=$1 and(club_id=any($2::uuid[]) or $3::boolean)',[boardId,clubs.filter(Boolean),s.scope==='national'&&s.settings.boardIds.includes(boardId)])).rowCount)throw new DomainError('board_unavailable','Deze baan hoort niet bij de betrokken vereniging of competitie.',403);
 if(f.boardIds.length&&!f.boardIds.includes(boardId))throw new DomainError('planned_board_changed','De partij staat op een andere baan gepland. Open de competitieplanning.',409);
 await assertPhysicalBoardEvent(client,boardId,s.eventId);await assertBoardUnreserved(client,boardId,s.eventId,s.id,undefined,allowedLobbyId);
 if((await client.query('select 1 from dartflow_private.matches where board_id=$1',[boardId])).rowCount)throw new DomainError('board_occupied','De baan is inmiddels bezet. Open de actuele partij of kies opnieuw via de planning.',409);
 return board;
}
async function labels(client:Client,ids:string[]){return(await client.query<{id:string;name:string;username:string|null}>('select id,name,username from dartflow_private.profile_labels where id=any($1::uuid[])',[ids])).rows;}
/** A PIN proof is current only until that player changes or resets it. */
async function validConfirmations(client:Client,row:Row):Promise<Record<string,Confirmation>>{
 const result:Record<string,Confirmation>={};
 for(const id of row.player_ids){const proof=row.confirmations[id];if(proof&&(row.status==='started'||proof.method==='account'||proof.pinVersion===(await playerPinVerifier(id,client))?.version))result[id]=proof;}
 return result;
}
async function rowView(client:Client,row:Row,actor:string):Promise<CompetitionBoardLobby>{
 const s=await readState(client,actor,row.season_id),f=fixture(s,row.fixture_id),p=slot(f,row.slot_id);await assertPeople(client,s,f,p,actor);
 if(!p.players.every((id,index)=>id===row.player_ids[index])||p.matchId!==row.match_id)throw new DomainError('assignment_changed','De geplande spelers zijn gewijzigd. Scan opnieuw of open de competitieplanning.',409);
 const time=await now(client),names=await labels(client,row.player_ids),board=(await client.query<{name:string}>('select name from dartflow_private.boards where id=$1',[row.board_id])).rows[0];
 const confirmations=await validConfirmations(client,row),currentStatus=['waiting','ready'].includes(row.status)?row.player_ids.every(id=>Boolean(confirmations[id]))?'ready':'waiting':row.status,status=expired(row,time)?'expired':currentStatus,active=['waiting','ready'].includes(status),problem=reason(s,f,p,time);
 const writerName=names.find(p=>p.id===row.writer_id)?.name??'Eerste speler';
 return{id:row.id,revision:row.revision,seasonId:s.id,seasonName:s.name,fixtureId:f.id,slotId:p.id,matchId:row.match_id,boardId:row.board_id,boardName:board?.name??'Baan',round:f.round,settings:seasonSlotSettings(s.settings,f,p),expiresAt:new Date(row.expires_at).toISOString(),status,players:row.player_ids.map(id=>({id,name:names.find(p=>p.id===id)?.name??'Speler',username:names.find(p=>p.id===id)?.username,confirmed:Boolean(confirmations[id]),...(confirmations[id]?{method:confirmations[id].method}:{})})) as CompetitionBoardLobby['players'],writerId:row.writer_id,writerName,writerDeviceLabel:'Bediening met het account van de eerste speler',canConfirm:active&&!problem&&!confirmations[actor],canStart:active&&!problem&&actor===row.writer_id&&row.player_ids.every(id=>Boolean(confirmations[id])),canCancel:active&&actor===row.owner_id,matchUrl:`/wedstrijd/${row.match_id}`};
}
async function byId(client:Client,id:string,lock=false):Promise<Row>{const row=(await client.query<Row>(`select * from dartflow_private.competition_board_lobbies where id=$1${lock?' for update':''}`,[id])).rows[0];if(!row)throw new DomainError('not_found','Deze wedstrijdlobby bestaat niet.',404);return row;}
async function save(client:Client,row:Row){row.revision++;await client.query('update dartflow_private.competition_board_lobbies set confirmations=$2,status=$3,revision=$4,updated_at=clock_timestamp() where id=$1',[row.id,JSON.stringify(row.confirmations),row.status,row.revision]);}
async function planningLock(client:Client){await client.query("select pg_advisory_xact_lock(hashtextextended('dartflow-season-planning',0))");}
async function lockSeason(client:Client,actor:string,id:string){const peek=await readState(client,actor,id);await client.query('select id from dartflow_private.events where id=$1 for update',[peek.eventId]);const s=await seasons.read(client,id,true);if(!await seasons.readable(client,s,actor))throw new DomainError('forbidden','Je hebt geen actueel recht voor deze competitie.',403);return s;}

export async function getCompetitionBoardContext(actor:string,boardId:string):Promise<CompetitionBoardContext>{
 uuid(actor);uuid(boardId);await getBoardForActor(actor,boardId);const client=database(),time=await now(client),candidates:CompetitionBoardCandidate[]=[];
 const board=(await client.query<{name:string;club_id:string|null}>('select b.name,cb.club_id from dartflow_private.boards b left join dartflow_private.club_boards cb on cb.board_id=b.id where b.id=$1',[boardId])).rows[0];
 const rows=(await client.query<{state:SeasonState}>("select state from dartflow_private.competition_seasons where status in('planned','active') and(exists(select 1 from jsonb_array_elements(state->'participants') p where p->>'id'=$1)or exists(select 1 from jsonb_array_elements(state->'teams') t where t->'playerIds' ? $1))",[actor])).rows;
 for(const {state:s} of rows){if(!await seasons.readable(client,s,actor))continue;for(const f of s.fixtures){
  if(s.clubId!==board.club_id&&!s.settings.boardIds.includes(boardId)&&!s.teams.some(t=>[f.homeId,f.awayId].includes(t.id)&&t.clubId===board.club_id))continue;
  for(const p of f.slots){if(!slotPeople(p).includes(actor)||['confirmed','provisional','canceled','administrative'].includes(p.status)||['confirmed','administrative','canceled'].includes(f.status))continue;
   let blockedReason=reason(s,f,p,time);if(f.boardIds.length&&!f.boardIds.includes(boardId))blockedReason='Deze partij staat op een andere baan gepland.';
   try{await assertPeople(client,s,f,p,actor);}catch(error){if(error instanceof DomainError)blockedReason=error.message;else throw error;}
   const opponentId=slotPeople(p).find(id=>id!==actor)??'',name=(await labels(client,opponentId?[opponentId]:[]))[0];const existing=p.matchId?(await client.query<{state:MatchState}>('select state from dartflow_private.matches where id=$1',[p.matchId])).rows[0]?.state:undefined;
   candidates.push({seasonId:s.id,seasonName:s.name,revision:s.revision,fixtureId:f.id,slotId:p.id,slotIndex:p.index,round:f.round,opponent:{id:opponentId,name:name?.name??'Tegenstander',username:name?.username},startsAt:f.startsAt??null,windowStart:f.windowStart,windowEnd:f.windowEnd,boardName:board.name,settings:seasonSlotSettings(s.settings,f,p),canOpen:!blockedReason,...(blockedReason?{blockedReason}:{}),...(p.matchId?{matchId:p.matchId}:{}),...(existing&&existing.boardId&&['called','ready','live','result','interrupted'].includes(existing.status)?{resumeUrl:`/wedstrijd/${existing.id}`}:{})});
  }
 }}
 const waiting=(await client.query<Row>("select * from dartflow_private.competition_board_lobbies where board_id=$1 and $2=any(player_ids) and(status in('waiting','ready') and expires_at>clock_timestamp() or status='started' and exists(select 1 from dartflow_private.matches m where m.id=match_id and m.board_id=$1)) order by created_at desc limit 1",[boardId,actor])).rows[0];
 let lobby:CompetitionBoardLobby|undefined;if(waiting)try{lobby=await rowView(client,waiting,actor);}catch(error){if(!(error instanceof DomainError&&[403,409].includes(error.status)))throw error;}
 return{boardId,candidates:candidates.sort((a,b)=>(a.startsAt??a.windowStart).localeCompare(b.startsAt??b.windowStart)||a.slotId.localeCompare(b.slotId)),...(lobby?{lobby}:{})};
}

export async function executeCompetitionLobbyCommand(actor:string,input:Input){
 uuid(actor);const requestId=uuid(input.requestId),a=input.action;if(!a||!['open','confirm','prepare','cancel'].includes(String(a.type)))throw new DomainError('invalid_action','Kies een geldige wedstrijdlobbyactie.');
 const fingerprint=digest(a);await assertAccountActive(actor);
 return transaction(async client=>{
  await planningLock(client);const prior=(await client.query<{lobby_id:string;fingerprint:string}>('select lobby_id,fingerprint from dartflow_private.competition_lobby_receipts where actor_id=$1 and request_id=$2',[actor,requestId])).rows[0];
  if(prior){if(prior.fingerprint!==fingerprint)throw new DomainError('request_reused','Dit actie-ID is al voor een andere keuze gebruikt.',409);const row=await byId(client,prior.lobby_id);return{ok:true,lobby:await rowView(client,row,actor),...(row.status==='started'?{matchId:row.match_id,url:`/wedstrijd/${row.match_id}`}:{})};}
  let row:Row;let created=false;
  if(a.type==='open'){
   const boardId=uuid(a.boardId),s=await lockSeason(client,actor,uuid(a.seasonId)),f=fixture(s,uuid(a.fixtureId)),p=slot(f,uuid(a.slotId));await assertPeople(client,s,f,p,actor);const problem=reason(s,f,p,await now(client));if(problem)throw new DomainError('fixture_not_ready',problem,409);
   await client.query("update dartflow_private.competition_board_lobbies set status='expired',revision=revision+1,updated_at=clock_timestamp() where status in('waiting','ready') and expires_at<=clock_timestamp() and(board_id=$1 or(season_id=$2 and slot_id=$3))",[boardId,s.id,p.id]);
   const existing=(await client.query<Row>("select * from dartflow_private.competition_board_lobbies where season_id=$1 and slot_id=$2 and status in('waiting','ready') for update",[s.id,p.id])).rows[0];
   if(existing){if(existing.board_id!==boardId)throw new DomainError('lobby_other_board','Deze partij heeft al een lobby op een andere baan. Open de competitieplanning.',409);row=existing;}
   else{
    await assertBoard(client,s,f,boardId);await lockPlayingActors(client,p.players as string[]);await assertPlayersFree(client,p.players as string[],p.matchId??null);
    if(p.matchId){const match=(await client.query<{state:MatchState}>('select state from dartflow_private.matches where id=$1 for update',[p.matchId])).rows[0]?.state;if(!match||match.boardId||!['planned','called'].includes(match.status)||match.game.visits.length)throw new DomainError('match_active','Deze partij heeft al een actuele scorekaart. Open de oorspronkelijke wedstrijd.',409);}
    else{p.matchId=await createCoreMatch(client,await entity(client,s.id),p.players as string[],seasonSlotSettings(s.settings,f,p),p.id);await client.query("update dartflow_private.matches set state=jsonb_set(state,'{status}','\"planned\"'::jsonb) where id=$1",[p.matchId]);await seasons.save(client,s);}
    row=(await client.query<Row>("insert into dartflow_private.competition_board_lobbies(id,season_id,fixture_id,slot_id,match_id,board_id,owner_id,player_ids,writer_id,expires_at)values($1,$2,$3,$4,$5,$6,$7,$8,$7,clock_timestamp()+interval '120 seconds')returning *",[randomUUID(),s.id,f.id,p.id,p.matchId,boardId,actor,p.players])).rows[0];created=true;
   }
   await confirm(client,row,actor,s,f,p,{method:'account',at:new Date().toISOString()});
   const opponent=row.player_ids.find(id=>id!==row.owner_id)!;
   if(created)await enqueueDomainMail(client,{id:`competition-lobby:${row.id}:opened`,templateId:'competition-lobby-ready',scope:'platform',recipientId:opponent,actorId:row.owner_id,entityId:s.id,competitionLobby:{id:row.id},expiresAt:new Date(row.expires_at).toISOString(),variables:{eventName:s.name,boardName:(await client.query<{name:string}>('select name from dartflow_private.boards where id=$1',[row.board_id])).rows[0].name,actionUrl:`/baan/${row.board_id}`}});
  }else{
   const peek=await byId(client,uuid(a.lobbyId)),s=await lockSeason(client,actor,peek.season_id);row=await byId(client,peek.id,true);const f=fixture(s,row.fixture_id),p=slot(f,row.slot_id);await assertPeople(client,s,f,p,actor);
   if(!p.players.every((id,i)=>id===row.player_ids[i])||p.matchId!==row.match_id)throw new DomainError('assignment_changed','De geplande partij is gewijzigd. Scan opnieuw.',409);
   if(a.type==='prepare'&&row.status==='started'){await client.query('insert into dartflow_private.competition_lobby_receipts(actor_id,request_id,lobby_id,fingerprint)values($1,$2,$3,$4)',[actor,requestId,row.id,fingerprint]);return{ok:true,lobby:await rowView(client,row,actor),matchId:row.match_id,url:`/wedstrijd/${row.match_id}`};}
   if(expired(row,await now(client))||!['waiting','ready'].includes(row.status))throw new DomainError('lobby_expired','Deze lobby is verlopen of gesloten. Scan opnieuw; de oorspronkelijke geplande partij blijft behouden.',409);
   if(a.type==='cancel'){if(actor!==row.owner_id)throw new DomainError('forbidden','Alleen de eerste speler kan deze tijdelijke baanlobby sluiten.',403);row.status='canceled';await save(client,row);}
   else if(a.type==='confirm'){const problem=reason(s,f,p,await now(client));if(problem)throw new DomainError('fixture_not_ready',problem,409);await confirm(client,row,actor,s,f,p,{method:'account',at:new Date().toISOString()});}
   else{
    if(actor!==row.writer_id||!row.player_ids.every(id=>Boolean(row.confirmations[id])))throw new DomainError('players_not_confirmed','Beide verschillende geplande spelers moeten eerst hun eigen deelname bevestigen.',409);
    const problem=reason(s,f,p,await now(client));if(problem)throw new DomainError('fixture_not_ready',problem,409);await assertBoard(client,s,f,row.board_id,row.id);
    for(const id of row.player_ids.filter(id=>row.confirmations[id]?.method==='pin').sort())await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`player-pin:${id}`]);
    for(const id of row.player_ids){const confirmation=row.confirmations[id];if(confirmation.method==='pin'&&confirmation.pinVersion!==(await playerPinVerifier(id,client))?.version)throw new DomainError('player_pin_changed','De pincode is gewijzigd. Laat de tegenstander opnieuw bevestigen.',409);}
    const matchId=await seasons.start(client,s,f,actor,{type:'season.start',fixtureId:f.id,slotIndex:p.index,boardId:row.board_id,writerId:actor},requestId,false,row.id);
    let match=(await client.query<{state:MatchState}>('select state from dartflow_private.matches where id=$1 for update',[matchId])).rows[0].state;for(const participant of row.player_ids)match=applyMatchAction(match,participant,false,{type:'accept'});await client.query('update dartflow_private.matches set state=$2,revision=$3,updated_at=clock_timestamp() where id=$1',[matchId,JSON.stringify(match),match.revision]);
    row.status='started';await save(client,row);await seasons.save(client,s);
   }
  }
  await client.query('insert into dartflow_private.competition_lobby_receipts(actor_id,request_id,lobby_id,fingerprint)values($1,$2,$3,$4)',[actor,requestId,row.id,fingerprint]);
  await client.query("insert into dartflow_private.platform_audit(actor_id,entity_id,action,detail)values($1,$2,$3,$4)",[actor,row.season_id,`competition-lobby.${String(a.type)}`,JSON.stringify({requestId,lobbyId:row.id,matchId:row.match_id,boardId:row.board_id})]);
  return{ok:true,lobby:await rowView(client,row,actor),...(row.status==='started'?{matchId:row.match_id,url:`/wedstrijd/${row.match_id}`}:{})};
 });
}
async function confirm(client:Client,row:Row,target:string,s:SeasonState,f:SeasonFixture,p:SeasonSlot,confirmation:Confirmation){
 if(!row.player_ids.includes(target))throw new DomainError('wrong_participant','Deze account hoort niet bij de geplande tegenstander.',403);
 await assertPeople(client,s,f,p,target);row.confirmations[target]=confirmation;row.status=row.player_ids.every(id=>Boolean(row.confirmations[id]))?'ready':'waiting';
 if(!f.checkIns.includes(target))f.checkIns.push(target);const participant=s.participants.find(e=>e.id===target);if(participant)participant.checkedIn=true;
 await save(client,row);await seasons.save(client,s);
}

export async function confirmCompetitionLobbyPin(actor:string,input:{requestId?:unknown;lobbyId?:unknown;username?:unknown;pin?:unknown},ipKey?:string){
 uuid(actor);const requestId=uuid(input.requestId),lobbyId=uuid(input.lobbyId);await assertAccountActive(actor);
 const key=(await database().query<{key:string}>('select dartflow_private.username_key($1) as key',[typeof input.username==='string'?input.username:''])).rows[0].key,fingerprint=digest({type:'pin',lobbyId,key});
 const peek=await byId(database(),lobbyId);await rowView(database(),peek,actor);if(peek.owner_id!==actor)throw new DomainError('forbidden','Alleen de eerste speler kan de geplande tegenstander op dit toestel laten bevestigen.',403);
 const prior=(await database().query<{lobby_id:string;fingerprint:string}>('select lobby_id,fingerprint from dartflow_private.competition_lobby_receipts where actor_id=$1 and request_id=$2',[actor,requestId])).rows[0];
 if(prior){if(prior.fingerprint!==fingerprint||prior.lobby_id!==lobbyId)throw new DomainError('request_reused','Deze aanvraag is al voor een andere koppeling gebruikt.',409);return{ok:true,lobby:await rowView(database(),await byId(database(),lobbyId),actor)};}
 if(expired(peek,await now(database()))||!['waiting','ready'].includes(peek.status))throw new DomainError('lobby_expired','Deze tijdelijke lobby is verlopen. Scan opnieuw.',409);
 await limitPlayerPinAttempts(actor,key,'link',ipKey);const target=validUsername(input.username)?(await database().query<{id:string}>('select id from dartflow_private.profiles where display_name_confirmed and dartflow_private.username_key(name)=$1',[key])).rows[0]?.id:null,verifier=target?await playerPinVerifier(target):null;
 const valid=await verifyPlayerPin(input.pin,verifier);if(!valid||!target||!verifier||target===actor||!peek.player_ids.includes(target)){await recordPlayerPinOutcome(actor,'rejected','official-link',target??undefined);throw new DomainError('player_pin_invalid','Gebruikersnaam of spelerspincode van de geplande tegenstander klopt niet. De tegenstander kan ook met het eigen account dezelfde QR scannen.',403);}
 return transaction(async client=>{
  await planningLock(client);const s=await lockSeason(client,actor,peek.season_id),row=await byId(client,lobbyId,true),f=fixture(s,row.fixture_id),p=slot(f,row.slot_id);
  const old=(await client.query<{fingerprint:string}>('select fingerprint from dartflow_private.competition_lobby_receipts where actor_id=$1 and request_id=$2',[actor,requestId])).rows[0];if(old){if(old.fingerprint!==fingerprint)throw new DomainError('request_reused','Dit actie-ID is al gebruikt.',409);return{ok:true,lobby:await rowView(client,row,actor)};}
  if(row.owner_id!==actor||expired(row,await now(client))||!['waiting','ready'].includes(row.status)||!p.players.every((id,i)=>id===row.player_ids[i]))throw new DomainError('lobby_expired','De lobby of geplande tegenstander is gewijzigd. Scan opnieuw.',409);
  const problem=reason(s,f,p,await now(client));if(problem)throw new DomainError('fixture_not_ready',problem,409);await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`player-pin:${target}`]);const current=await playerPinVerifier(target,client);if(!current||current.version!==verifier.version||current.verifier!==verifier.verifier)throw new DomainError('player_pin_changed','De spelerspincode is gewijzigd. Bevestig opnieuw.',409);
  await confirm(client,row,target,s,f,p,{method:'pin',pinVersion:verifier.version,at:new Date().toISOString()});
  await client.query('insert into dartflow_private.competition_lobby_receipts(actor_id,request_id,lobby_id,fingerprint)values($1,$2,$3,$4)',[actor,requestId,lobbyId,fingerprint]);
  await client.query('insert into dartflow_private.season_pin_receipts(actor_id,request_id,match_id,target_id,fingerprint)values($1,$2,$3,$4,$5)',[actor,requestId,row.match_id,target,fingerprint]);
  await client.query("insert into dartflow_private.platform_audit(actor_id,entity_id,action,detail)values($1,$2,'player-pin.competition-lobby',$3)",[actor,s.id,JSON.stringify({requestId,lobbyId,matchId:row.match_id,targetId:target})]);
  return{ok:true,lobby:await rowView(client,row,actor)};
 });
}

/** Caller already authorized this fixed display. Only public labels and confirmation state leave the server. */
export async function readCompetitionLobbyDisplay(client:Client,boardId:string):Promise<CompetitionLobbyDisplay|undefined>{
 const row=(await client.query<Row>("select * from dartflow_private.competition_board_lobbies where board_id=$1 and status in('waiting','ready') and expires_at>clock_timestamp() limit 1",[boardId])).rows[0];if(!row)return;
 const s=await seasons.read(client,row.season_id),f=fixture(s,row.fixture_id),p=slot(f,row.slot_id);if(reason(s,f,p,await now(client))||!p.players.every((id,i)=>id===row.player_ids[i]))return;
 try{await assertPeople(client,s,f,p,row.owner_id);}catch(error){if(error instanceof DomainError)return;throw error;}
 const names=await labels(client,row.player_ids),confirmations=await validConfirmations(client,row);return{competitionName:s.name,round:f.round,players:row.player_ids.map(id=>({name:names.find(p=>p.id===id)?.name??'Speler',confirmed:Boolean(confirmations[id])})) as CompetitionLobbyDisplay['players'],writerName:names.find(p=>p.id===row.writer_id)?.name??'Eerste speler',expiresAt:new Date(row.expires_at).toISOString()};
}

/** The worker rechecks the same planned identities and window before delivery. */
export async function competitionLobbyMailApplicable(client:Pick<PoolClient,'query'>,lobbyId:string,recipientId:string):Promise<boolean>{
 try{
  const row=await byId(client,lobbyId);if(!['waiting','ready'].includes(row.status)||new Date(row.expires_at).getTime()<=await now(client)||recipientId===row.owner_id||!row.player_ids.includes(recipientId)||row.confirmations[recipientId])return false;
  const s=await readState(client,recipientId,row.season_id),f=fixture(s,row.fixture_id),p=slot(f,row.slot_id);
  if(reason(s,f,p,await now(client))||p.matchId!==row.match_id||!p.players.every((id,i)=>id===row.player_ids[i]))return false;
  await assertPeople(client,s,f,p,recipientId);
  const board=(await client.query<{blocked:boolean;occupied:boolean}>('select blocked,exists(select 1 from dartflow_private.matches where board_id=b.id)as occupied from dartflow_private.boards b where id=$1',[row.board_id])).rows[0];
  if(!board||board.blocked||board.occupied)return false;
  const physical=await physicalBoard(client,row.board_id);if(physical?.archived_at||physical?.closed_at||physical?.close_after_session)return false;
  await assertPhysicalBoardEvent(client,row.board_id,s.eventId);return true;
 }catch(error){if(error instanceof DomainError)return false;throw error;}
}
