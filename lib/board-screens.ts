import {getOcheStatistics} from './player-statistics-db';
import {calculatePlayerMeasures,currentPlayerProfiles} from './player-statistics';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {database,eventAccess,consumeRateLimit} from './db';
import {getClubBoardScreen} from './club-boards';
import {readBoardScoreEvents} from './score-events';
import {checkout,DomainError,matchView} from './domain';
import {boardLease} from './platform-locks';
import {readBoardActivity,publicBoardActivity,boardDeviceCanExtend} from './board-activity';
import {uuid} from './platform-store';
import type {ClubBoardScreenView} from './platform-types';
import type {BoardScreenDevice,Game,MatchState,PublicSnapshot,Stats,Visit} from './types';
import {locationManager,locationScreenContext,physicalBoard} from './location-access';

export const BOARD_SCREEN_COOKIE='dartflow-screen';
export const BOARD_SCREEN_DEVICE_SECONDS=365*24*60*60;
export const boardScreenCookiePath=(boardId:string)=>`/api/board-screens/${uuid(boardId).toLowerCase()}`;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
type BoardRow={id:string;event_id:string;club_id:string;name:string;blocked:boolean;event_name:string;club_name:string;public_screen:boolean;club_screen:boolean;state:MatchState|null};
async function board(client:Pick<PoolClient,'query'>,boardId:string):Promise<BoardRow>{
 const result=await client.query<BoardRow>(`select b.id,b.event_id,e.club_id,b.name,b.blocked,e.name as event_name,c.name as club_name,coalesce(lb.public_screen,(cb.board_id is not null)) as public_screen,(cb.board_id is not null) as club_screen,m.state
  from dartflow_private.boards b join dartflow_private.events e on e.id=b.event_id join dartflow_private.clubs c on c.id=e.club_id
  left join dartflow_private.club_boards cb on cb.board_id=b.id and cb.event_id=b.event_id
  left join dartflow_private.location_boards lb on lb.board_id=b.id
  left join dartflow_private.matches m on m.board_id=b.id where b.id=$1`,[uuid(boardId)]);
 if(!result.rows.length)throw new DomainError('not_found','Deze baan bestaat niet.',404);
 return result.rows[0];
}
async function transaction<T>(run:(client:PoolClient)=>Promise<T>):Promise<T>{
 const client=await database().connect();
 try{await client.query('begin');const value=await run(client);await client.query('commit');return value;}
 catch(error){await client.query('rollback');throw error;}
 finally{client.release();}
}
async function manager(client:Pick<PoolClient,'query'>,actorId:string,row:BoardRow):Promise<void>{
 const physical=await physicalBoard(client,row.id);
 if(physical){if(!await locationManager(client,actorId,physical.location_id))throw new DomainError('forbidden','Alleen de actuele locatiebeheerder kan een vast scherm koppelen of intrekken.',403);return;}
 const access=await eventAccess(client,uuid(actorId),row.event_id);
 if(!access.canManage)throw new DomainError('forbidden','Alleen de actuele wedstrijdleiding kan een vast scherm koppelen of intrekken.',403);
}
/** Match the event -> club ordering used by board mutations, then read current roles. */
async function lockedManagerBoard(client:PoolClient,actorId:string,boardId:string):Promise<BoardRow>{
 const before=await board(client,boardId);
 const physical=await physicalBoard(client,boardId);
 if(physical){await client.query('select id from dartflow_private.locations where id=$1 for update',[physical.location_id]);const current=await board(client,boardId);await manager(client,actorId,current);return current;}
 await client.query('select id from dartflow_private.events where id=$1 for update',[before.event_id]);
 await client.query("select id from dartflow_private.platform_entities where id=$1 and kind='club' for share",[before.club_id]);
 const current=await board(client,boardId);await manager(client,actorId,current);return current;
}
function deviceView(row:Record<string,unknown>):BoardScreenDevice{
 return {id:String(row.id),name:String(row.name),createdAt:new Date(row.created_at as string).toISOString(),expiresAt:new Date(row.expires_at as string).toISOString(),paired:row.paired_at!==null,revoked:row.revoked_at!==null,lastSeenAt:row.last_seen_at?new Date(row.last_seen_at as string).toISOString():null};
}
async function audit(client:PoolClient,actorId:string,row:BoardRow,action:string,deviceId:string):Promise<void>{
 await client.query('insert into dartflow_private.audit_events(actor_id,club_id,event_id,action,detail) values($1,$2,$3,$4,$5)',[actorId,row.club_id,row.event_id,action,JSON.stringify({boardId:row.id,deviceId})]);
}
export async function listBoardScreenDevices(actorId:string,boardId:string):Promise<{publicScreen:boolean;devices:BoardScreenDevice[]}>{
 const row=await board(database(),boardId);await manager(database(),actorId,row);
 const result=await database().query('select id,name,created_at,expires_at,paired_at,revoked_at,last_seen_at from dartflow_private.board_screen_devices where board_id=$1 order by created_at desc limit 100',[row.id]);
 return {publicScreen:row.public_screen,devices:result.rows.map(deviceView)};
}
export async function createBoardScreenDevice(actorId:string,boardId:string,name?:unknown):Promise<{device:BoardScreenDevice;pairing:{code:string;expiresAt:string;screenUrl:string}}>{
 const label=name===undefined?'Vast baanscherm':typeof name==='string'?name.trim().replace(/\s+/g,' '):'';
 if(!label||label.length>80||/[\p{Cc}\p{Cf}]/u.test(label))throw new DomainError('device_name','Geef het scherm een naam van maximaal 80 tekens.');
 return transaction(async client=>{
  const row=await lockedManagerBoard(client,actorId,boardId);
  const count=await client.query<{count:number}>('select count(*)::int as count from dartflow_private.board_screen_devices where board_id=$1 and revoked_at is null and expires_at>now() and (paired_at is not null or pairing_expires_at>now())',[row.id]);
  if(count.rows[0].count>=20)throw new DomainError('device_limit','Trek eerst een oude schermkoppeling in. Per baan zijn maximaal twintig schermen toegestaan.',409);
  const id=randomUUID();
  for(let attempt=0;attempt<32;attempt++){
   const code=randomBytes(6).toString('hex').toUpperCase();
   const result=await client.query(`insert into dartflow_private.board_screen_devices(id,board_id,event_id,created_by,name,pairing_hash,pairing_expires_at,expires_at)
    values($1,$2,$3,$4,$5,$6,now()+interval '10 minutes',now()+interval '1 year') on conflict(pairing_hash) do nothing
    returning id,name,created_at,expires_at,paired_at,revoked_at,pairing_expires_at`,[id,row.id,row.event_id,actorId,label,hash(code)]);
   if(!result.rows.length)continue;
   await audit(client,actorId,row,'board-screen.device.create',id);
   return {device:deviceView(result.rows[0]),pairing:{code,expiresAt:new Date(result.rows[0].pairing_expires_at).toISOString(),screenUrl:`/baanscherm/${row.id}`}};
  }
  throw new DomainError('pairing_unavailable','Het scherm kon niet gekoppeld worden. Probeer opnieuw.',503);
 });
}
export async function revokeBoardScreenDevice(actorId:string,boardId:string,deviceId:string):Promise<void>{
 await transaction(async client=>{
  const row=await lockedManagerBoard(client,actorId,boardId);
  const result=await client.query('update dartflow_private.board_screen_devices set revoked_at=coalesce(revoked_at,now()),pairing_hash=null where id=$1 and board_id=$2 returning id',[uuid(deviceId),row.id]);
  if(!result.rowCount)throw new DomainError('not_found','Deze schermkoppeling bestaat niet.',404);
  await audit(client,actorId,row,'board-screen.device.revoke',deviceId);
 });
}
/** No player session is created. The returned secret is written only to an HttpOnly cookie. */
export async function pairBoardScreenDevice(boardId:string,input:unknown):Promise<{token:string;maxAge:number}>{
 const id=uuid(boardId);
 // Autocommit outside the pairing transaction: failed guesses and replays retain their cost.
 const attempt=await consumeRateLimit(`board-screen-pair:${id}`,20,60);
 if(!attempt.allowed)throw Object.assign(new DomainError('rate_limited','Te veel koppelpogingen. Wacht even en probeer opnieuw.',429),{retryAfter:attempt.retryAfter});
 const code=typeof input==='string'?input.replace(/[\s-]/g,'').toUpperCase():'';
 if(!/^[A-F0-9]{12}$/.test(code))throw new DomainError('invalid_pairing','De koppelcode is ongeldig, gebruikt of verlopen.',400);
 return transaction(async client=>{
  const result=await client.query<{id:string;event_id:string;created_by:string}>(`select id,event_id,created_by from dartflow_private.board_screen_devices where board_id=$1 and pairing_hash=$2
    and paired_at is null and revoked_at is null and expires_at>now() and pairing_expires_at>now() for update`,[id,hash(code)]);
  if(!result.rows.length)throw new DomainError('invalid_pairing','De koppelcode is ongeldig, gebruikt of verlopen.',400);
  const device=result.rows[0],row=await board(client,id);
  // Removing the issuing manager's rights also removes their outstanding device authority.
  try{await manager(client,device.created_by,row);}catch(error){if(error instanceof DomainError&&error.status===403)throw new DomainError('invalid_pairing','De koppelcode is ongeldig, gebruikt of verlopen.',400);throw error;}
  const token=randomBytes(32).toString('base64url');
  await client.query('update dartflow_private.board_screen_devices set token_hash=$2,pairing_hash=null,paired_at=now() where id=$1',[device.id,hash(token)]);
  return {token,maxAge:BOARD_SCREEN_DEVICE_SECONDS};
 });
}
function screenDenied():DomainError{return new DomainError('screen_pairing_required','Dit baanscherm moet eenmalig door de wedstrijdleiding worden gekoppeld.',403);}
async function authorizeScreen(row:BoardRow,token?:string,client:Pick<PoolClient,'query'>=database()):Promise<void>{
 // Existing club screen visibility is independent of the club's playing admission rules.
 if(row.public_screen)return;
 if(token&&/^[A-Za-z0-9_-]{43}$/.test(token)){
  const devices=await client.query<{created_by:string}>(`select created_by from dartflow_private.board_screen_devices where board_id=$1 and event_id=$2 and token_hash=$3
   and paired_at is not null and revoked_at is null and expires_at>now()`,[row.id,row.event_id,hash(token)]);
  if(devices.rows.length){try{await manager(client,devices.rows[0].created_by,row);return;}catch(error){if(!(error instanceof DomainError&&error.status===403))throw error;}}
 }
 throw screenDenied();
}
const displayVisits=(visits:Visit[]):Visit[]=>visits.map(v=>({player:`player-${v.playerIndex+1}`,playerIndex:v.playerIndex,score:v.score,darts:v.darts,remainingBefore:v.remainingBefore,remainingAfter:v.remainingAfter,bust:v.bust,leg:v.leg,checkout:v.checkout}));
const displayStats=(stats:Stats[]):Stats[]=>stats.map(s=>({total:s.total,darts:s.darts,oneEighties:s.oneEighties,highestFinish:s.highestFinish,...(s.legsWon===undefined?{}:{legsWon:s.legsWon}),average:s.average??(s.darts?3*s.total/s.darts:0),...(s.measurementComplete===undefined?{}:{measurementComplete:s.measurementComplete})}));
/** Fixed physical identity, fresh assignment every read, and only the Sprint display allowlist. */
export async function getBoardScreen(boardId:string,deviceToken?:string):Promise<ClubBoardScreenView>{
 const client=await database().connect();
 try{await client.query('begin isolation level repeatable read read only');const result=await readBoardScreen(client,boardId,deviceToken);let paired=false;
  if(deviceToken&&/^[A-Za-z0-9_-]{43}$/.test(deviceToken)){const device=(await client.query<{created_by:string}>("select created_by from dartflow_private.board_screen_devices where board_id=$1 and token_hash=$2 and paired_at is not null and revoked_at is null and expires_at>now()",[uuid(boardId),hash(deviceToken)])).rows[0];if(device)try{await manager(client,device.created_by,await board(client,boardId));paired=true;}catch(e){if(!(e instanceof DomainError&&e.status===403))throw e;}}
  result.screen={paired,rotation:(await client.query<{rotation:0|90|270}>('select rotation from dartflow_private.board_screen_preferences where board_id=$1',[uuid(boardId)])).rows[0]?.rotation??90};await client.query('commit');return result;}
 catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
/** A public URL alone cannot claim that a particular paired device is online. */
export async function heartbeatBoardScreen(boardId:string,token?:string):Promise<{paired:boolean}>{
 if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))return{paired:false};
 return transaction(async client=>{
  const row=await board(client,boardId),device=(await client.query<{id:string;created_by:string}>(`select id,created_by from dartflow_private.board_screen_devices where board_id=$1 and event_id=$2 and token_hash=$3 and paired_at is not null and revoked_at is null and expires_at>now() for update`,[row.id,row.event_id,hash(token)])).rows[0];
  if(!device)return{paired:false};
  try{await manager(client,device.created_by,row);}catch(e){if(e instanceof DomainError&&e.status===403)return{paired:false};throw e;}
  await client.query("update dartflow_private.board_screen_devices set last_seen_at=clock_timestamp() where id=$1 and (last_seen_at is null or last_seen_at<clock_timestamp()-interval '10 seconds')",[device.id]);return{paired:true};
 });
}
export async function setBoardScreenPreferences(actor:string,boardId:string,input:Record<string,unknown>):Promise<{ok:true}>{
 if(![0,90,270].includes(input.rotation as number))throw new DomainError('invalid_rotation','Kies 0°, 90° of 270°.');
 return transaction(async client=>{const row=await lockedManagerBoard(client,actor,boardId);await client.query('insert into dartflow_private.board_screen_preferences(board_id,rotation,updated_by) values($1,$2,$3) on conflict(board_id) do update set rotation=$2,updated_by=$3,updated_at=now()',[row.id,input.rotation,actor]);await audit(client,actor,row,'board-screen.rotation',row.id);return{ok:true};});
}
async function readBoardScreen(client:PoolClient,boardId:string,deviceToken?:string):Promise<ClubBoardScreenView>{
 const row=await board(client,boardId);await authorizeScreen(row,deviceToken,client);
 const rawActivity=await readBoardActivity(client,row.id);
 const deviceCanExtend=Boolean(rawActivity&&await boardDeviceCanExtend(client,row.id,deviceToken));
 const activity=publicBoardActivity(rawActivity,deviceCanExtend);
 if(row.club_screen){const projection=await getClubBoardScreen(row.id,client);if(activity)projection.snapshot.boardActivity=activity;return projection;}
 if(!row.state&&rawActivity?.sourceKind==='match'&&['active','warning'].includes(rawActivity.phase))row.state=(await client.query<{state:MatchState}>('select state from dartflow_private.matches where id=$1',[rawActivity.sourceId])).rows[0]?.state??null;
 const lease=await boardLease(client,row.id),location=await locationScreenContext(client,row.id,row.state?.id??lease?.id);let match:PublicSnapshot['match']=null;
 if(row.state){
  const labels=await client.query<{id:string;name:string}>('select id,name from dartflow_private.profile_labels where id=any($1::uuid[])',[row.state.players.map(p=>p.id)]);
  row.state=currentPlayerProfiles(row.state,labels.rows);
  const view=matchView(row.state,'',false);
  match={id:`board-${row.id}`,revision:view.revision,status:view.status,players:view.players.map((p,i)=>({id:`player-${i+1}`,name:p.name})),remaining:view.remaining,legs:view.legs,sets:view.sets,turn:view.turn,checkout:view.checkout,visits:displayVisits(view.currentLegVisits??[]),currentLegVisits:displayVisits(view.currentLegVisits??[]),currentLegStartScore:view.currentLegStartScore,scoringMode:view.scoringMode,winnerId:view.winnerId?`player-${view.players.findIndex(p=>p.id===view.winnerId)+1}`:null,resultPublished:view.resultPublished,settings:{startScore:view.settings.startScore,bestOfLegs:view.settings.bestOfLegs,bestOfSets:view.settings.bestOfSets,...(view.settings.legLimit===undefined?{}:{legLimit:view.settings.legLimit})},writerId:'',stats:displayStats(view.stats),legNumber:view.legNumber,setNumber:view.setNumber,paused:Boolean(view.paused)};
 }else if(lease?.kind==='training'){
  const game=lease.state.game as Game;
  const profile=await client.query<{name:string}>('select name from dartflow_private.profile_labels where id=$1',[lease.owner_id]);
  match={id:`board-${row.id}`,revision:lease.revision,status:game.status==='finished'?'result':'live',players:[{id:'player-1',name:profile.rows[0]?.name??'Speler'}],remaining:[game.remaining[0]],legs:[game.legs[0]],sets:[0],turn:0,checkout:game.status==='live'?checkout(game.remaining[0]):null,visits:displayVisits(game.visits),currentLegVisits:displayVisits(game.visits.filter(v=>v.leg===game.legs[0]+(game.status==='finished'?0:1))),currentLegStartScore:game.startScore,winnerId:game.status==='finished'?'player-1':null,resultPublished:false,settings:{startScore:game.startScore as 301|501|701,bestOfLegs:1,bestOfSets:1},writerId:'',stats:displayStats([{...game.stats[0],average:calculatePlayerMeasures([game],lease.owner_id).average??0}]),legNumber:Math.max(1,...game.visits.map(v=>v.leg)),setNumber:1,paused:false};
 }
 const occupied=Boolean(row.state||lease);
 const closed=Boolean(location?.physical.closed_at),closePending=Boolean(location?.physical.close_after_session);
 const blocked=row.blocked||Boolean(location?.physical.archived_at),eventName=location?.reservation?.label??location?.physical.location_name??row.event_name;
 const statistics=await getOcheStatistics(client,{boardId:row.id,state:row.state,lobbyId:lease?.kind==='lobby'?lease.id:null,allowRecap:!row.state&&!lease&&!blocked&&!closed&&!closePending&&!location?.reservation});
 return {board:{id:row.id,name:row.name,clubName:location?.physical.location_name??row.event_name,access:location?.physical.kind==='venue'?'all':'club',blocked,occupied,closed,closePending,publicScan:row.public_screen&&!blocked&&!closed&&!closePending&&!location?.reservation,playUrl:`/baan/${row.id}`,screenUrl:`/baanscherm/${row.id}`,...(location?{locationKind:location.physical.kind}:{})},status:match?'playing':blocked?'blocked':closed||closePending?'closed':lease?'waiting':location?.reservation?'reserved':'available',snapshot:{board:{id:row.id,name:row.name},event:{name:eventName},match,...(statistics?{statistics}:{}),...(activity?{boardActivity:activity}:{}),...await readBoardScoreEvents(client,row.id,row.state?.id??lease?.id,match?.revision)},...(location?.reservation?{reservation:location.reservation}:{})};
}
