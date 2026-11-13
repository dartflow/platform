import {randomBytes,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {database} from './db';
import {DomainError} from './domain';
import {appConfig} from './config';
import {locationManager} from './location-access';
import {uuid} from './platform-store';
import {codeDigest,createOcheAccess,decryptOcheReceipt,encryptOcheReceipt,formatOcheCode,newOcheCode,readOcheAccess,secretHash} from './oche-device-crypto';
import type {OcheCapacity,OcheClaim,OcheClaimResult,OcheDevice,OcheManagement,OchePairing,OchePairingStatus,OchePlatform,OcheScope,OcheSession} from './oche-device-types';

type Client=Pick<PoolClient,'query'>;
type Scope={scope:OcheScope;ownerId:string|null;locationId:string|null};
export type OcheDeviceRow={id:string;installation_id:string;scope:OcheScope;owner_id:string|null;location_id:string|null;board_id:string|null;created_by:string;name:string;platform:OchePlatform;grant_version:number;created_at:Date;last_seen_at:Date|null;revoked_at:Date|null};
type Installation={id:string;platform:OchePlatform;secret_hash:string;code_hash:string|null;code_cipher:string|null;state:'pending'|'approved'|'redeemed'|'revoked';expires_at:Date};
type Reservation={scope:OcheScope;id:string;installation_id:string;owner_id:string|null;location_id:string|null;board_id:string|null;created_by:string;name:string;replaces_device_id:string|null;expires_at:Date;state:'approved'|'redeemed'|'expired'|'cancelled'};
const credential=/^[A-Za-z0-9_-]{43}$/;
const ms=(value:Date|string)=>new Date(value).getTime();
const iso=(value:Date|string)=>new Date(value).toISOString();
const unavailable=()=>new DomainError('device_unauthorized','Dit scherm moet opnieuw worden gekoppeld.',401);
const invalidCode=()=>new DomainError('invalid_code','De koppelcode is ongeldig, gebruikt of verlopen.',400);
const scopeOf=(row:{scope:OcheScope;owner_id:string|null;location_id:string|null}):Scope=>({scope:row.scope,ownerId:row.owner_id,locationId:row.location_id});
export async function ocheTransaction<T>(run:(client:PoolClient)=>Promise<T>):Promise<T>{
 const client=await database().connect();try{await client.query('begin');const value=await run(client);await client.query('commit');return value;}catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
async function now(client:Client):Promise<number>{return Math.floor(Number((await client.query<{now:string}>('select extract(epoch from clock_timestamp())*1000 as now')).rows[0].now));}
async function lockScope(client:Client,scope:Scope):Promise<void>{await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`oche:v1:${scope.scope}:${scope.ownerId??scope.locationId}`]);}
async function lockInstallation(client:Client,id:string):Promise<void>{await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`oche:installation:${id}`]);}
async function lockRequest(client:Client,principal:string,operation:string,requestId:string):Promise<void>{await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`oche:receipt:${principal}:${operation}:${requestId}`]);}
async function receipt<T>(client:Client,principal:string,operation:string,requestId:string,payload:unknown):Promise<T|undefined>{
 const row=(await client.query<{payload_hash:string;response_cipher:string}>('select payload_hash,response_cipher from dartflow_private.oche_device_receipts where principal=$1 and operation=$2 and request_id=$3 and expires_at>clock_timestamp()',[principal,operation,uuid(requestId)])).rows[0];
 if(!row)return;
 if(row.payload_hash!==secretHash(JSON.stringify(payload)))throw new DomainError('idempotency_conflict','Deze aanvraag is al gebruikt met andere gegevens.',409);
 return decryptOcheReceipt<T>(row.response_cipher);
}
async function saveReceipt(client:Client,principal:string,operation:string,requestId:string,payload:unknown,response:unknown,seconds=600):Promise<void>{
 const saved=await client.query('insert into dartflow_private.oche_device_receipts(principal,operation,request_id,payload_hash,response_cipher,expires_at) values($1,$2,$3,$4,$5,clock_timestamp()+$6*interval \'1 second\') on conflict(principal,operation,request_id) do update set payload_hash=excluded.payload_hash,response_cipher=excluded.response_cipher,expires_at=excluded.expires_at where dartflow_private.oche_device_receipts.expires_at<=clock_timestamp()',[principal,operation,requestId,secretHash(JSON.stringify(payload)),encryptOcheReceipt(response),seconds]);
 if(saved.rowCount!==1)throw new DomainError('idempotency_conflict','Deze aanvraag is al gebruikt met andere gegevens.',409);
}
async function audit(client:Client,actor:string|null,action:string,deviceId:string|null,detail:unknown={}):Promise<void>{await client.query('insert into dartflow_private.oche_device_audit(actor_id,device_id,action,detail) values($1,$2,$3,$4)',[actor,deviceId,action,JSON.stringify(detail)]);}
export function ocheName(value:unknown):string{const label=typeof value==='string'?value.trim().replace(/\s+/g,' '):'';if(!label||label.length>80||/[\p{Cc}\p{Cf}]/u.test(label))throw new DomainError('device_name','Geef het scherm een naam van maximaal 80 tekens.');return label;}
async function requireProfile(client:Client,actor:string):Promise<void>{if(!(await client.query('select 1 from dartflow_private.profiles where id=$1',[uuid(actor)])).rowCount)throw new DomainError('forbidden','Je account heeft geen schermbeheer.',403);}
async function requireScopeManager(client:Client,actor:string,scope:Scope):Promise<void>{
 if(scope.scope==='home'){if(scope.ownerId!==actor)throw new DomainError('forbidden','Alleen de eigenaar beheert dit thuisscherm.',403);await requireProfile(client,actor);return;}
 if(!scope.locationId||!await locationManager(client,actor,scope.locationId))throw new DomainError('forbidden','Je hebt geen actueel schermbeheer voor deze locatie.',403);
 if(!(await client.query("select 1 from dartflow_private.locations where id=$1 and kind='venue'",[scope.locationId])).rowCount)throw new DomainError('invalid_location','Kies een fysieke locatie.',400);
}
async function requireBoard(client:Client,scope:Scope,boardId:string|null):Promise<void>{
 if(scope.scope==='home'){if(boardId)throw new DomainError('invalid_board','Een thuisscherm volgt een eigen sessie.');return;}
 if(boardId&&!(await client.query('select 1 from dartflow_private.location_boards where board_id=$1 and location_id=$2 and archived_at is null',[uuid(boardId),scope.locationId])).rowCount)throw new DomainError('invalid_board','Deze baan hoort niet bij de gekozen locatie.',400);
}
async function sweepScope(client:Client,scope:Scope):Promise<void>{
 await client.query("update dartflow_private.oche_reservations set state='expired' where state='approved' and expires_at<=clock_timestamp() and scope=$1 and (owner_id=$2 or location_id=$3)",[scope.scope,scope.ownerId,scope.locationId]);
}
async function capacity(client:Client,scope:Scope):Promise<OcheCapacity>{
 const row=(await client.query<{active:number;reserved:number;maximum:number;name:string}>(`select
 (select count(*)::int from dartflow_private.oche_devices d where d.scope=$1 and d.revoked_at is null and(d.owner_id=$2 or d.location_id=$3))+
 (select count(*)::int from dartflow_private.board_screen_devices d join dartflow_private.location_boards lb on lb.board_id=d.board_id join dartflow_private.locations l on l.id=lb.location_id where d.revoked_at is null and d.expires_at>clock_timestamp() and d.paired_at is not null and (($1='home' and l.kind='home' and l.owner_id=$2) or($1='location' and l.id=$3))) as active,
 (select count(*)::int from dartflow_private.oche_reservations r where r.scope=$1 and r.state='approved' and r.expires_at>clock_timestamp() and(r.owner_id=$2 or r.location_id=$3) and (r.replaces_device_id is null or not exists(select 1 from dartflow_private.oche_devices old where old.id=r.replaces_device_id and old.revoked_at is null)))+
 (select count(*)::int from dartflow_private.board_screen_devices d join dartflow_private.location_boards lb on lb.board_id=d.board_id join dartflow_private.locations l on l.id=lb.location_id where d.revoked_at is null and d.expires_at>clock_timestamp() and d.paired_at is null and d.pairing_expires_at>clock_timestamp() and (($1='home' and l.kind='home' and l.owner_id=$2) or($1='location' and l.id=$3))) as reserved,
 case when $1='home' then 1 else coalesce((select maximum from dartflow_private.oche_location_limits where location_id=$3),2) end as maximum,
 case when $1='home' then 'Mijn scherm thuis' else (select name from dartflow_private.locations where id=$3) end as name`,[scope.scope,scope.ownerId,scope.locationId])).rows[0];
 return {scope:scope.scope,locationId:scope.locationId,name:row.name,maximum:row.maximum,active:row.active,reserved:row.reserved,aboveLimit:row.active+row.reserved>row.maximum};
}
async function installation(client:Client,id:string,secret:string,lock=false):Promise<Installation>{
 if(!credential.test(secret)||!/^[0-9a-f-]{36}$/i.test(id))throw unavailable();
 const row=(await client.query<Installation>(`select * from dartflow_private.oche_installations where id=$1 and secret_hash=$2${lock?' for update':''}`,[uuid(id),secretHash(secret)])).rows[0];
 if(!row)throw unavailable();if(row.state==='revoked')throw new DomainError('device_revoked','Dit scherm is ontkoppeld.',410);return row;
}
function pairing(row:Installation,code:string,serverNow:number):OchePairing{return {installationId:row.id,code:formatOcheCode(code),expiresAt:iso(row.expires_at),serverNow,verificationUrl:`${appConfig().origin}/koppel-scherm#code=${code}`,pollAfterMs:2000};}
export async function startOcheInstallation(input:{platform:OchePlatform;requestId:string;installationId?:string;installationSecret?:string}):Promise<OchePairing&{installationSecret:string}>{
 if(!['browser','android','android-tv'].includes(input.platform))throw new DomainError('invalid_platform','Kies een ondersteund schermtype.');uuid(input.requestId);
 return ocheTransaction(async client=>{
  const principal=`bootstrap:${input.requestId}`;
  if(input.installationId)uuid(input.installationId);
  await lockRequest(client,principal,'start',input.requestId);
  if(input.installationId)await lockInstallation(client,input.installationId);
  if(input.installationId)await installation(client,input.installationId,input.installationSecret??'');
  const payload={platform:input.platform};const previous=await receipt<OchePairing&{installationSecret:string}>(client,principal,'start',input.requestId,payload);if(previous)return previous;
  let id=input.installationId,secret=input.installationSecret;
  if(id){
   const reservation=(await client.query<Reservation>('select * from dartflow_private.oche_reservations where installation_id=$1',[id])).rows[0];
   if(reservation){await lockScope(client,scopeOf(reservation));await client.query("update dartflow_private.oche_reservations set state='cancelled' where installation_id=$1 and state='approved'",[id]);}
   const existing=await installation(client,id,secret??'',true);
   // An explicit new code starts a new installation identity after pairing. The
   // previous display keeps its slot until the manager explicitly replaces it.
   // This also makes the browser's recovery button work after a remote revoke.
   if(existing.state==='redeemed'){id=randomUUID();secret=randomBytes(32).toString('base64url');}
  }else{id=randomUUID();secret=randomBytes(32).toString('base64url');}
  for(let attempt=0;attempt<32;attempt++){
   const code=newOcheCode();
   await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`oche:code:${codeDigest(code)}`]);
   if((await client.query('select 1 from dartflow_private.oche_installations where code_hash=$1 and id<>$2',[codeDigest(code),id])).rowCount)continue;
   const result=await client.query<Installation>(`insert into dartflow_private.oche_installations(id,platform,secret_hash,code_hash,code_cipher,expires_at) values($1,$2,$3,$4,$5,clock_timestamp()+interval '10 minutes')
    on conflict(id) do update set code_hash=excluded.code_hash,code_cipher=excluded.code_cipher,state='pending',expires_at=excluded.expires_at,updated_at=clock_timestamp() returning *`,[id,input.platform,secretHash(secret!),codeDigest(code),encryptOcheReceipt(code)]);
   const response={...pairing(result.rows[0],code,await now(client)),installationSecret:secret!};await saveReceipt(client,principal,'start',input.requestId,payload,response);return response;
  }
  throw new DomainError('pairing_unavailable','Koppelen is tijdelijk niet beschikbaar.',503);
 });
}
export async function getOcheInstallationStatus(id:string,secret:string):Promise<OchePairingStatus>{
 const row=await installation(database(),id,secret),serverNow=await now(database());
 const state=row.state!=='redeemed'&&ms(row.expires_at)<=serverNow?'expired':row.state;
 return {state,serverNow,expiresAt:iso(row.expires_at),pollAfterMs:2000,...(state==='pending'&&row.code_cipher?{pairing:pairing(row,decryptOcheReceipt<string>(row.code_cipher),serverNow)}:{})};
}
export async function claimOcheInstallation(actor:string,input:OcheClaim):Promise<OcheClaimResult>{
 const digest=codeDigest(input.code),name=ocheName(input.name),scope:Scope={scope:input.scope,ownerId:input.scope==='home'?uuid(actor):null,locationId:input.scope==='location'?uuid(input.locationId):null};
 if(!['home','location'].includes(input.scope))throw new DomainError('invalid_scope','Kies thuis of een eigen locatie.');
 const boardId=input.boardId?uuid(input.boardId):null,replacementId=input.replaceDeviceId?uuid(input.replaceDeviceId):null,requestId=uuid(input.requestId);
 return ocheTransaction(async client=>{
  await lockRequest(client,`actor:${actor}`,'claim',requestId);
  const payload={digest,name,scope,boardId,replacementId};await requireScopeManager(client,actor,scope);
  const confirmed=await receipt<OcheClaimResult>(client,`actor:${actor}`,'claim',requestId,payload);if(confirmed)return confirmed;
  // Pairing operations take an installation guard before the capacity scope.
  // A concurrent new-code request cannot miss a just-approved reservation.
  const candidate=(await client.query<{id:string}>('select id from dartflow_private.oche_installations where code_hash=$1',[digest])).rows[0];if(!candidate)throw invalidCode();await lockInstallation(client,candidate.id);
  await lockScope(client,scope);await requireScopeManager(client,actor,scope);await sweepScope(client,scope);
  const replay=await receipt<OcheClaimResult>(client,`actor:${actor}`,'claim',requestId,payload);if(replay)return replay;
  const row=(await client.query<Installation>('select * from dartflow_private.oche_installations where code_hash=$1 for update',[digest])).rows[0];const serverNow=await now(client);
  if(!row||row.state!=='pending'||ms(row.expires_at)<=serverNow)throw invalidCode();
  await requireBoard(client,scope,boardId);const count=await capacity(client,scope);
  if(replacementId){
   const old=(await client.query<OcheDeviceRow>('select * from dartflow_private.oche_devices where id=$1 for update',[replacementId])).rows[0];
   if(!old||old.revoked_at||old.scope!==scope.scope||old.owner_id!==scope.ownerId||old.location_id!==scope.locationId)throw new DomainError('invalid_replacement','Kies een actief scherm binnen dezelfde omgeving.',409);
   if(count.aboveLimit)throw Object.assign(new DomainError('device_limit','Boven limiet. Ontkoppel eerst een scherm voordat je vervangt.',409),{capacity:count});
   if((await client.query("select 1 from dartflow_private.oche_reservations where replaces_device_id=$1 and state='approved'",[replacementId])).rowCount)throw new DomainError('replacement_pending','Voor dit scherm loopt al een vervanging.',409);
  }else if(count.active+count.reserved>=count.maximum)throw Object.assign(new DomainError('device_limit','Limiet bereikt. Kies expliciet een bestaand scherm om te vervangen.',409),{capacity:count});
  const id=randomUUID();const inserted=await client.query<{expires_at:Date}>(`insert into dartflow_private.oche_reservations(id,installation_id,scope,owner_id,location_id,board_id,created_by,name,replaces_device_id,expires_at)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,least($10::timestamptz,clock_timestamp()+interval '2 minutes'))
   on conflict(installation_id) do update set id=excluded.id,scope=excluded.scope,owner_id=excluded.owner_id,location_id=excluded.location_id,board_id=excluded.board_id,created_by=excluded.created_by,name=excluded.name,replaces_device_id=excluded.replaces_device_id,expires_at=excluded.expires_at,state='approved',created_at=clock_timestamp()
   where dartflow_private.oche_reservations.state in('expired','cancelled') returning expires_at`,[id,row.id,scope.scope,scope.ownerId,scope.locationId,boardId,actor,name,replacementId,row.expires_at]);
  if(!inserted.rows.length)throw invalidCode();
  await client.query("update dartflow_private.oche_installations set state='approved',expires_at=$2,updated_at=clock_timestamp() where id=$1",[row.id,inserted.rows[0].expires_at]);
  const response:OcheClaimResult={state:'approved',reservationId:id,expiresAt:iso(inserted.rows[0].expires_at),capacity:await capacity(client,scope)};
  await saveReceipt(client,`actor:${actor}`,'claim',requestId,payload,response);await audit(client,actor,'screen.claim',null,{reservationId:id,scope:scope.scope,locationId:scope.locationId,replacementId});return response;
 });
}
async function issueSession(client:Client,device:OcheDeviceRow):Promise<OcheSession>{
 const serverNow=await now(client),refresh=randomBytes(32).toString('base64url'),refreshExpiresAt=new Date(serverNow+365*86400000).toISOString(),accessExpiresAt=new Date(serverNow+120000).toISOString();
 await client.query(`insert into dartflow_private.oche_device_credentials(device_id,refresh_hash,refresh_expires_at) values($1,$2,$3) on conflict(device_id) do update set refresh_hash=excluded.refresh_hash,refresh_expires_at=excluded.refresh_expires_at,generation=dartflow_private.oche_device_credentials.generation+1`,[device.id,secretHash(refresh),refreshExpiresAt]);
 return {deviceId:device.id,accessExpiresAt,refreshExpiresAt,accessToken:createOcheAccess(device.id,device.grant_version,serverNow+120000),refreshToken:refresh};
}
async function assertCurrentDevice(client:Client,row:OcheDeviceRow|undefined):Promise<OcheDeviceRow>{
 if(!row||row.revoked_at)throw unavailable();
 await requireScopeManager(client,row.created_by,scopeOf(row));await requireBoard(client,scopeOf(row),row.board_id);return row;
}
async function recoveredAccess(client:Client,session:OcheSession,device:OcheDeviceRow):Promise<OcheSession>{
 const serverNow=await now(client),original=readOcheAccess(session.accessToken!);
 // Receipts live longer than access JWTs. Recover the same refresh generation
 // with a current access projection, without rotating again or allocating a slot.
 if(original.expires<=serverNow||original.version!==device.grant_version)return {...session,accessExpiresAt:new Date(serverNow+120000).toISOString(),accessToken:createOcheAccess(device.id,device.grant_version,serverNow+120000)};
 return session;
}
export async function redeemOcheInstallation(id:string,secret:string,nonce:string):Promise<OcheSession>{
 uuid(nonce);return ocheTransaction(async client=>{
  await lockInstallation(client,id);
  await installation(client,id,secret);
  const before=(await client.query<Reservation>('select * from dartflow_private.oche_reservations where installation_id=$1',[id])).rows[0];if(!before)throw new DomainError('not_approved','Bevestig deze code eerst op je telefoon.',409);
  await lockScope(client,scopeOf(before));const row=await installation(client,id,secret,true);const principal=`installation:${id}`,payload={secret:secretHash(secret)};
  const replay=await receipt<OcheSession>(client,principal,'redeem',nonce,payload);
  if(replay){const device=await assertCurrentDevice(client,(await client.query<OcheDeviceRow>('select * from dartflow_private.oche_devices where id=$1',[replay.deviceId])).rows[0]);
   const stored=(await client.query<{refresh_hash:string}>('select refresh_hash from dartflow_private.oche_device_credentials where device_id=$1 and refresh_expires_at>clock_timestamp()',[device.id])).rows[0];if(stored?.refresh_hash!==secretHash(replay.refreshToken!))throw new DomainError('refresh_replayed','Gebruik de actuele schermsessie.',409);return recoveredAccess(client,replay,device);}
  const reservation=(await client.query<Reservation>('select * from dartflow_private.oche_reservations where installation_id=$1 for update',[id])).rows[0];
  const serverNow=await now(client);if(!reservation||reservation.state!=='approved'||row.state!=='approved'||ms(reservation.expires_at)<=serverNow)throw invalidCode();
  await requireScopeManager(client,reservation.created_by,scopeOf(reservation));await requireBoard(client,scopeOf(reservation),reservation.board_id);
  const currentCapacity=await capacity(client,scopeOf(reservation));if(currentCapacity.aboveLimit)throw Object.assign(new DomainError('device_limit','De schermlimiet is verlaagd. Maak eerst ruimte vrij.',409),{capacity:currentCapacity});
  if(reservation.replaces_device_id){
   const old=(await client.query<OcheDeviceRow>('select * from dartflow_private.oche_devices where id=$1 for update',[reservation.replaces_device_id])).rows[0];
   if(old&&!old.revoked_at){await client.query('update dartflow_private.oche_devices set revoked_at=clock_timestamp(),grant_version=grant_version+1 where id=$1',[old.id]);await client.query('delete from dartflow_private.oche_device_credentials where device_id=$1',[old.id]);await audit(client,reservation.created_by,'screen.replaced',old.id);}
  }
  const device=(await client.query<OcheDeviceRow>(`insert into dartflow_private.oche_devices(id,installation_id,scope,owner_id,location_id,board_id,created_by,name,platform,last_seen_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()) returning *`,[randomUUID(),id,reservation.scope,reservation.owner_id,reservation.location_id,reservation.board_id,reservation.created_by,reservation.name,row.platform])).rows[0];
  await client.query("update dartflow_private.oche_reservations set state='redeemed' where id=$1",[reservation.id]);await client.query("update dartflow_private.oche_installations set state='redeemed',code_hash=null,code_cipher=null,updated_at=clock_timestamp() where id=$1",[id]);
  const response=await issueSession(client,device);await saveReceipt(client,principal,'redeem',nonce,payload,response);await audit(client,reservation.created_by,'screen.activated',device.id);return response;
 });
}
export async function refreshOcheSession(refreshToken:string,nonce:string):Promise<OcheSession>{
 if(!credential.test(refreshToken))throw unavailable();uuid(nonce);const digest=secretHash(refreshToken);
 return ocheTransaction(async client=>{
  await lockRequest(client,`refresh:${digest}`,'refresh',nonce);
  // The receipt principal is a one-way digest of the previous refresh credential.
  const replay=await receipt<OcheSession>(client,`refresh:${digest}`,'refresh',nonce,{});
  const before=(await client.query<OcheDeviceRow>(`select d.* from dartflow_private.oche_devices d join dartflow_private.oche_device_credentials c on c.device_id=d.id where c.refresh_hash=$1 and c.refresh_expires_at>clock_timestamp()`,[digest])).rows[0];
  const candidate=before??(replay?(await client.query<OcheDeviceRow>('select * from dartflow_private.oche_devices where id=$1',[replay.deviceId])).rows[0]:undefined);if(!candidate)throw unavailable();
  await lockScope(client,scopeOf(candidate));const device=await assertCurrentDevice(client,(await client.query<OcheDeviceRow>('select * from dartflow_private.oche_devices where id=$1 for update',[candidate.id])).rows[0]);
  const current=(await client.query<{refresh_hash:string;refresh_expires_at:Date}>('select * from dartflow_private.oche_device_credentials where device_id=$1 for update',[device.id])).rows[0];
  if(replay){if(current?.refresh_hash!==secretHash(replay.refreshToken!)||ms(current.refresh_expires_at)<=await now(client))throw unavailable();return recoveredAccess(client,replay,device);}
  if(!current||current.refresh_hash!==digest||ms(current.refresh_expires_at)<=await now(client))throw unavailable();
  const response=await issueSession(client,device);await saveReceipt(client,`refresh:${digest}`,'refresh',nonce,{},response);return response;
 });
}
export async function authorizeOcheAccess(token:string,client:Client=database()):Promise<OcheDeviceRow>{
 const access=readOcheAccess(token);uuid(access.deviceId);const row=(await client.query<OcheDeviceRow>('select * from dartflow_private.oche_devices where id=$1',[access.deviceId])).rows[0];
 const device=await assertCurrentDevice(client,row);if(device.grant_version!==access.version||access.expires<=await now(client))throw unavailable();
 await client.query("update dartflow_private.oche_devices set last_seen_at=clock_timestamp() where id=$1 and(last_seen_at is null or last_seen_at<clock_timestamp()-interval '10 seconds')",[row.id]);return device;
}
async function listDevices(client:Client,actor:string):Promise<OcheDevice[]>{
 const rows=(await client.query<OcheDeviceRow&{location_name:string|null;board_name:string|null}>(`select d.*,l.name as location_name,b.name as board_name from dartflow_private.oche_devices d left join dartflow_private.locations l on l.id=d.location_id left join dartflow_private.boards b on b.id=d.board_id
  where (d.scope='home' and d.owner_id=$1) or(d.scope='location' and(l.owner_id=$1 or exists(select 1 from dartflow_private.location_members lm where lm.location_id=l.id and lm.user_id=$1))) order by d.created_at desc limit 500`,[actor])).rows;
 const serverNow=await now(client);return rows.map(row=>({id:row.id,name:row.name,platform:row.platform,scope:row.scope,locationId:row.location_id,locationName:row.location_name,boardId:row.board_id,boardName:row.board_name,lastSeenAt:row.last_seen_at?iso(row.last_seen_at):null,online:!row.revoked_at&&Boolean(row.last_seen_at&&serverNow-ms(row.last_seen_at)<15000),createdAt:iso(row.created_at),revoked:Boolean(row.revoked_at),grantVersion:row.grant_version}));
}
export async function getOcheManagement(actor:string):Promise<OcheManagement>{
 const client=database();await requireProfile(client,actor);
 const canManageLimits=Boolean((await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role in('owner','admin')",[actor])).rowCount);
 const locations=(await client.query<{id:string;name:string}>(`select l.id,l.name from dartflow_private.locations l where l.kind='venue' and(l.owner_id=$1 or exists(select 1 from dartflow_private.location_members lm where lm.location_id=l.id and lm.user_id=$1) or $2) order by l.name,l.id limit 200`,[actor,canManageLimits])).rows;
 const choices:OcheManagement['locations']=[];for(const location of locations){const count=await capacity(client,{scope:'location',ownerId:null,locationId:location.id});const boards=(await client.query<{id:string;name:string}>('select b.id,b.name from dartflow_private.location_boards lb join dartflow_private.boards b on b.id=lb.board_id where lb.location_id=$1 and lb.archived_at is null order by b.name,b.id',[location.id])).rows;choices.push({...count,canManageScreens:await locationManager(client,actor,location.id),boards});}
 const sessions=(await client.query<{id:string;name:string;kind:'match'|'lobby'|'training'}>(`select id,name,kind from (
  select m.id,concat_ws(' – ',m.state->'players'->0->>'name',m.state->'players'->1->>'name') as name,'match' as kind,m.updated_at as updated_at from dartflow_private.matches m where m.state->>'status' not in('abandoned','interrupted') and exists(select 1 from dartflow_private.match_players p where p.match_id=m.id and p.user_id=$1)
  union all select e.id,coalesce(e.state->>'name',case when e.kind='training' then 'Oefenwedstrijd' else 'Wedstrijdlobby' end),e.kind,e.updated_at from dartflow_private.platform_entities e where e.kind in('lobby','training') and e.owner_id=$1 and coalesce(e.state->>'closed','false')<>'true' and coalesce(e.state->>'discarded','false')<>'true'
 ) source order by updated_at desc,id limit 50`,[actor])).rows;
 const selected=(await client.query<{source_id:string|null}>('select source_id from dartflow_private.oche_home_selections where owner_id=$1',[actor])).rows[0]?.source_id??null;
 const legacyRows=(await client.query<{id:string;name:string;kind:'home'|'venue';location_id:string;location_name:string;board_id:string;board_name:string;paired_at:Date|null;expires_at:Date;last_seen_at:Date|null}>(`select d.id,d.name,l.kind,l.id as location_id,l.name as location_name,b.id as board_id,b.name as board_name,d.paired_at,d.expires_at,d.last_seen_at from dartflow_private.board_screen_devices d join dartflow_private.location_boards lb on lb.board_id=d.board_id join dartflow_private.locations l on l.id=lb.location_id join dartflow_private.boards b on b.id=d.board_id
  where d.revoked_at is null and d.expires_at>clock_timestamp() and(d.paired_at is not null or d.pairing_expires_at>clock_timestamp()) and(l.owner_id=$1 or exists(select 1 from dartflow_private.location_members lm where lm.location_id=l.id and lm.user_id=$1)) order by d.created_at desc limit 500`,[actor])).rows;
 const legacyDevices:OcheManagement['legacyDevices']=legacyRows.map(row=>({id:row.id,name:row.name,scope:row.kind==='home'?'home':'location',locationId:row.location_id,locationName:row.location_name,boardId:row.board_id,boardName:row.board_name,paired:Boolean(row.paired_at),expiresAt:iso(row.expires_at),lastSeenAt:row.last_seen_at?iso(row.last_seen_at):null}));
 return {serverNow:await now(client),canManageLimits,home:await capacity(client,{scope:'home',ownerId:actor,locationId:null}),locations:choices,devices:await listDevices(client,actor),legacyDevices,homeSessions:sessions,selectedHomeSessionId:selected,defaultLocationMaximum:2};
}
/** Compatibility bridge: old private grants keep working and consume the same
 * capacity. New physical displays must start through /oche-live. Call before
 * taking any legacy device row lock, like the v1 scope mutations. */
export async function lockOcheLegacyBoardScope(client:Client,boardId:string):Promise<Scope|null>{
 const row=(await client.query<{location_id:string;owner_id:string;kind:'home'|'venue'}>('select l.id as location_id,l.owner_id,l.kind from dartflow_private.location_boards lb join dartflow_private.locations l on l.id=lb.location_id where lb.board_id=$1',[uuid(boardId)])).rows[0];
 if(!row)return null;const scope:Scope={scope:row.kind==='home'?'home':'location',ownerId:row.kind==='home'?row.owner_id:null,locationId:row.kind==='venue'?row.location_id:null};await lockScope(client,scope);return scope;
}
export async function assertOcheLegacyActivationCapacity(client:Client,scope:Scope|null):Promise<void>{
 if(!scope)return;await sweepScope(client,scope);const count=await capacity(client,scope);if(count.aboveLimit)throw Object.assign(new DomainError('device_limit','Limiet bereikt. Ontkoppel eerst een bestaand scherm in Schermen.',409),{capacity:count});
}
export async function manageOcheDevice(actor:string,id:string,input:{action:'rename'|'assign'|'revoke';name?:unknown;boardId?:unknown;requestId:string}):Promise<{ok:true}>{
 const deviceId=uuid(id),requestId=uuid(input.requestId);if(!['rename','assign','revoke'].includes(input.action))throw new DomainError('invalid_action','Onbekende schermactie.');
 return ocheTransaction(async client=>{
  await lockRequest(client,`actor:${actor}`,'device',requestId);
  const before=(await client.query<OcheDeviceRow>('select * from dartflow_private.oche_devices where id=$1',[deviceId])).rows[0];if(!before)throw new DomainError('not_found','Dit scherm bestaat niet.',404);
  await lockScope(client,scopeOf(before));await requireScopeManager(client,actor,scopeOf(before));
  const payload={id:deviceId,action:input.action,name:input.name??null,boardId:input.boardId??null},replay=await receipt<{ok:true}>(client,`actor:${actor}`,'device',requestId,payload);if(replay)return replay;
  const row=(await client.query<OcheDeviceRow>('select * from dartflow_private.oche_devices where id=$1 for update',[deviceId])).rows[0];
  if(input.action==='revoke'){
   await client.query('update dartflow_private.oche_devices set revoked_at=coalesce(revoked_at,clock_timestamp()),grant_version=grant_version+case when revoked_at is null then 1 else 0 end where id=$1',[row.id]);
   await client.query('delete from dartflow_private.oche_device_credentials where device_id=$1',[row.id]);
   await client.query("update dartflow_private.oche_reservations set state='cancelled' where replaces_device_id=$1 and state='approved'",[row.id]);
  }else{
   if(row.revoked_at)throw new DomainError('device_revoked','Dit scherm is ontkoppeld.',410);
   if(input.action==='rename')await client.query('update dartflow_private.oche_devices set name=$2 where id=$1',[row.id,ocheName(input.name)]);
   else{const boardId=input.boardId===null||input.boardId===undefined?null:uuid(input.boardId);await requireBoard(client,scopeOf(row),boardId);await client.query('update dartflow_private.oche_devices set board_id=$2,grant_version=grant_version+1 where id=$1',[row.id,boardId]);}
  }
  const result={ok:true as const};await saveReceipt(client,`actor:${actor}`,'device',requestId,payload,result);await audit(client,actor,`screen.${input.action}`,row.id);return result;
 });
}
export async function setOcheLimit(actor:string,input:{locationId:string;maximum:number;requestId:string}):Promise<OcheCapacity>{
 const locationId=uuid(input.locationId),requestId=uuid(input.requestId);if(!Number.isSafeInteger(input.maximum)||input.maximum<1||input.maximum>1000)throw new DomainError('invalid_limit','Kies een geheel maximum van 1 tot en met 1000.');
 return ocheTransaction(async client=>{
  await lockRequest(client,`actor:${actor}`,'limit',requestId);
  const scope:Scope={scope:'location',ownerId:null,locationId};await lockScope(client,scope);
  if(!(await client.query("select 1 from dartflow_private.platform_roles where user_id=$1 and role in('owner','admin')",[actor])).rowCount)throw new DomainError('forbidden','Alleen centraal beheer kan schermlimieten wijzigen.',403);
  if(!(await client.query("select 1 from dartflow_private.locations where id=$1 and kind='venue'",[locationId])).rowCount)throw new DomainError('not_found','Deze locatie bestaat niet.',404);
  const replay=await receipt<OcheCapacity>(client,`actor:${actor}`,'limit',requestId,input);if(replay)return replay;
  await sweepScope(client,scope);await client.query('insert into dartflow_private.oche_location_limits(location_id,maximum,updated_by) values($1,$2,$3) on conflict(location_id) do update set maximum=$2,updated_by=$3,updated_at=clock_timestamp()',[locationId,input.maximum,actor]);
  const result=await capacity(client,scope);await saveReceipt(client,`actor:${actor}`,'limit',requestId,input,result);await audit(client,actor,'screen.limit',null,{locationId,maximum:input.maximum});return result;
 });
}
export async function selectOcheHomeSession(actor:string,input:{sourceId:string|null;requestId:string}):Promise<{ok:true}>{
 const sourceId=input.sourceId===null?null:uuid(input.sourceId),requestId=uuid(input.requestId);
 return ocheTransaction(async client=>{
  await lockRequest(client,`actor:${actor}`,'home-session',requestId);
  await lockScope(client,{scope:'home',ownerId:uuid(actor),locationId:null});await requireProfile(client,actor);
  const replay=await receipt<{ok:true}>(client,`actor:${actor}`,'home-session',requestId,{sourceId});if(replay)return replay;
  if(sourceId&&!(await client.query(`select 1 where exists(select 1 from dartflow_private.matches m join dartflow_private.match_players p on p.match_id=m.id and p.user_id=$2 where m.id=$1 and m.state->>'status' not in('abandoned','interrupted')) or exists(select 1 from dartflow_private.platform_entities e where e.id=$1 and e.owner_id=$2 and e.kind in('lobby','training') and coalesce(e.state->>'closed','false')<>'true' and coalesce(e.state->>'discarded','false')<>'true')`,[sourceId,actor])).rowCount)throw new DomainError('forbidden','Kies uitsluitend een eigen actieve sessie.',403);
  await client.query('insert into dartflow_private.oche_home_selections(owner_id,source_id) values($1,$2) on conflict(owner_id) do update set source_id=$2,updated_at=clock_timestamp()',[actor,sourceId]);
  const result={ok:true as const};await saveReceipt(client,`actor:${actor}`,'home-session',requestId,{sourceId},result);await audit(client,actor,'screen.home-session',null);return result;
 });
}
export async function logoutOcheDevice(token:string):Promise<void>{
 const current=await authorizeOcheAccess(token);await manageOcheDevice(current.created_by,current.id,{action:'revoke',requestId:randomUUID()});
}
/** Existing worker may call this; capacity checks already expire reservations synchronously. */
export async function cleanupOcheDevices():Promise<void>{
 await database().query("update dartflow_private.oche_reservations set state='expired' where state='approved' and expires_at<=clock_timestamp()");
 await database().query('delete from dartflow_private.oche_device_receipts where expires_at<clock_timestamp()');
 await database().query("update dartflow_private.oche_installations set code_hash=null,code_cipher=null where expires_at<clock_timestamp() and state='pending' and code_hash is not null");
}
