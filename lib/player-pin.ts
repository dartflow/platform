import {argon2,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import type {PoolClient} from 'pg';
import {database,consumeRateLimit} from './db';
import {DomainError} from './domain';
import {canonical,transaction,uuid} from './platform-store';
import {enqueueAuditedNotification} from './notification-audit-source';

type Query=Pick<PoolClient,'query'>;
type PinMode='initial'|'change'|'reset';
type PinRow={user_id:string;version:number;pepper_version:string;salt:string;verifier:string;memory:number;passes:number;parallelism:number};
export type PreparedPlayerPin={actor:string;requestId:string;mode:PinMode;fingerprint:string;previousVersion:number;value:Omit<PinRow,'user_id'|'version'>;replayed:boolean};
const verificationFailure=()=>new DomainError('player_pin_invalid','Gebruikersnaam of spelerspincode klopt niet.',403);
function setting(name:string,fallback:number,min:number,max:number):number {
 const raw=process.env[name];const value=raw===undefined?fallback:Number(raw);
 if(!Number.isSafeInteger(value)||value<min||value>max)throw new DomainError('player_pin_configuration','Spelerspincode is tijdelijk niet beschikbaar.',503);
 return value;
}
export function playerPinPolicy(){
 return {memory:setting('DARTFLOW_PLAYER_PIN_MEMORY_KIB',32768,19456,131072),passes:setting('DARTFLOW_PLAYER_PIN_PASSES',3,2,8),parallelism:1,
  actorLimit:setting('DARTFLOW_PLAYER_PIN_ACTOR_LIMIT',10,1,100),targetLimit:setting('DARTFLOW_PLAYER_PIN_TARGET_LIMIT',5,1,50),windowSeconds:setting('DARTFLOW_PLAYER_PIN_WINDOW_SECONDS',900,30,3600),
  globalLimit:setting('DARTFLOW_PLAYER_PIN_GLOBAL_LIMIT',60,1,1000),concurrency:setting('DARTFLOW_PLAYER_PIN_CONCURRENCY',4,1,8),minimumMs:200};
}
function secret(version?:string):{version:string;value:Buffer}{
 const current=process.env.DARTFLOW_PLAYER_PIN_PEPPER_VERSION||'';
 try {
  const pairs=(process.env.DARTFLOW_PLAYER_PIN_PEPPERS||'').split(',').map(pair=>pair.split(':'));
  if(pairs.some(pair=>pair.length!==2)||new Set(pairs.map(pair=>pair[0])).size!==pairs.length)throw Error();
  const map=Object.fromEntries(pairs);
  const selected=version??current;
  if(!/^[a-zA-Z0-9_-]{1,32}$/.test(selected))throw Error();
  const raw=map[selected];
  if(typeof raw!=='string'||! /^[A-Za-z0-9+/]{43}=$/.test(raw))throw Error();
  const value=Buffer.from(raw,'base64');if(value.length!==32)throw Error();
  return {version:selected,value};
 }catch{throw new DomainError('player_pin_configuration','Spelerspincode is tijdelijk niet beschikbaar.',503);}
}
export function playerPinConfigured():boolean{try{secret();playerPinPolicy();return true;}catch{return false;}}
function hmac(value:string):string{return createHmac('sha256',secret().value).update('dartflow-player-pin:').update(value).digest('hex');}
export function validPlayerPin(value:unknown):value is string{return typeof value==='string'&&/^[0-9]{6}$/.test(value);}
export function validatePlayerPinFields(pin:unknown,confirmation:unknown):asserts pin is string {
 if(!validPlayerPin(pin))throw new DomainError('player_pin_format','Spelerspincode: vul precies zes cijfers in.');
 if(!validPlayerPin(confirmation))throw new DomainError('player_pin_confirmation','Herhaal spelerspincode: vul precies zes cijfers in.');
 if(pin!==confirmation)throw new DomainError('player_pin_mismatch','Herhaal spelerspincode: de pincodes komen niet overeen.');
}
async function derive(pin:string,row:Pick<PinRow,'salt'|'pepper_version'|'memory'|'passes'|'parallelism'>):Promise<Buffer>{
 if(row.memory<19456||row.memory>131072||row.passes<2||row.passes>8||row.parallelism!==1)throw new DomainError('player_pin_configuration','Spelerspincode is tijdelijk niet beschikbaar.',503);
 return new Promise((resolve,reject)=>argon2('argon2id',{message:pin,nonce:Buffer.from(row.salt,'base64'),secret:secret(row.pepper_version).value,memory:row.memory,passes:row.passes,parallelism:row.parallelism,tagLength:32},(error,key)=>error?reject(new DomainError('player_pin_unavailable','Spelerspincode is tijdelijk niet beschikbaar.',503)):resolve(key)));
}
async function readVerifier(client:Query,user:string,lock=false):Promise<PinRow|null>{
 const {rows}=await client.query<PinRow>(`select user_id,version,pepper_version,salt,verifier,memory,passes,parallelism from dartflow_private.player_pin_verifiers where user_id=$1 and exists(select 1 from dartflow_private.profiles p where p.id=user_id and p.deletion_requested_at is null and p.deleted_at is null)${lock?' for update':''}`,[uuid(user)]);return rows[0]??null;
}
/** Security metadata only. Never pass submitted usernames, PINs, hashes or request bodies. */
export async function recordPlayerPinOutcome(actor:string,outcome:'rejected'|'cooldown',scope:string,targetId?:string):Promise<void>{
 await database().query("insert into dartflow_private.platform_audit(actor_id,action,detail) values($1,$2,$3)",[uuid(actor),`player-pin.${outcome}`,JSON.stringify({scope,...(targetId?{targetId:uuid(targetId)}:{})})]);
}
/** Owner status only: never return a verifier, salt, pepper version, or PIN. */
export async function getPlayerPinStatus(actor:string,client:Query=database()):Promise<{pinConfigured:boolean}>{
 const result=await client.query('select 1 from dartflow_private.player_pin_verifiers where user_id=$1',[uuid(actor)]);return {pinConfigured:Boolean(result.rowCount)};
}
/** targetKey is the exact database username_key, or a stable account ID for owner operations. */
export async function limitPlayerPinAttempts(actor:string,targetKey:string,scope='link',ipKey?:string):Promise<void>{
 const policy=playerPinPolicy();
 for(const [key,max,seconds]of [[`pin:${scope}:actor:${uuid(actor)}`,policy.actorLimit,policy.windowSeconds],[`pin:${scope}:target:${hmac(targetKey)}`,policy.targetLimit,policy.windowSeconds],['pin:kdf:global',policy.globalLimit,60],...(ipKey?[[`pin:ip:${hmac(ipKey)}`,Math.max(20,policy.actorLimit*4),policy.windowSeconds]]:[])] as [string,number,number][]){
  const result=await consumeRateLimit(key,max,seconds);
  if(!result.allowed){await recordPlayerPinOutcome(actor,'cooldown',scope);throw Object.assign(new DomainError('player_pin_cooldown',`Tijdelijk geen nieuwe pincodepogingen. Probeer over ${result.retryAfter} seconden opnieuw.`,429),{retryAfter:result.retryAfter});}
 }
}
/** A database lease bounds memory-intensive work across all application processes. */
async function withKdf<T>(run:()=>Promise<T>):Promise<T>{
 const id=randomUUID(),started=performance.now();
 await transaction(async client=>{
  await client.query("select pg_advisory_xact_lock(hashtextextended('player-pin-kdf',0))");
  await client.query('delete from dartflow_private.player_pin_kdf_leases where expires_at<=clock_timestamp()');
  const {rows}=await client.query<{n:number}>('select count(*)::int as n from dartflow_private.player_pin_kdf_leases');
  if(rows[0].n>=playerPinPolicy().concurrency)throw Object.assign(new DomainError('player_pin_cooldown','Pincodecontrole is even bezet. Probeer over enkele seconden opnieuw.',429),{retryAfter:3});
  await client.query("insert into dartflow_private.player_pin_kdf_leases(id,expires_at) values($1,clock_timestamp()+interval '60 seconds')",[id]);
 });
 try{return await run();}finally{
  await database().query('delete from dartflow_private.player_pin_kdf_leases where id=$1',[id]);
  const delay=playerPinPolicy().minimumMs-(performance.now()-started);if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
 }
}
export async function verifyPlayerPin(pin:unknown,row:PinRow|null):Promise<boolean>{
 const policy=playerPinPolicy(),current=secret();
 const candidate=row??{salt:createHmac('sha256',current.value).update('dummy-verification-salt').digest().subarray(0,16).toString('base64'),pepper_version:current.version,memory:policy.memory,passes:policy.passes,parallelism:1};
 return withKdf(async()=>{
  const actual=await derive(validPlayerPin(pin)?pin:'000000',candidate),expected=row?Buffer.from(row.verifier,'base64'):Buffer.alloc(32);
  const matches=expected.length===actual.length&&timingSafeEqual(expected,actual);return Boolean(row&&validPlayerPin(pin)&&matches);
 });
}
export async function preparePlayerPinUpdate(actor:string,input:{requestId:unknown;pin:unknown;pinConfirmation:unknown;currentPin?:unknown;mode?:unknown},options:{recentAuth:boolean}):Promise<PreparedPlayerPin>{
 const id=uuid(actor),requestId=uuid(input.requestId),mode=(input.mode??'initial') as PinMode;
 if(!['initial','change','reset'].includes(mode))throw new DomainError('player_pin_mode','Kies instellen, wijzigen of opnieuw instellen.');
 validatePlayerPinFields(input.pin,input.pinConfirmation);
 const fingerprint=hmac(canonical({mode,pin:input.pin,currentPin:input.currentPin??null}));
 const receipt=await database().query<{fingerprint:string}>('select fingerprint from dartflow_private.player_pin_receipts where actor_id=$1 and request_id=$2 and kind=$3',[id,requestId,'update']);
 if(receipt.rows.length){if(receipt.rows[0].fingerprint!==fingerprint)throw new DomainError('request_reused','Deze aanvraag is al voor andere gegevens gebruikt.',409);return {actor:id,requestId,mode,fingerprint,previousVersion:0,value:{} as PreparedPlayerPin['value'],replayed:true};}
 await limitPlayerPinAttempts(id,id,'manage');
 const previous=await readVerifier(database(),id);
 if(mode==='initial'&&previous)throw new DomainError('player_pin_exists','Er is al een spelerspincode ingesteld. Kies Wijzigen.',409);
 if(mode==='reset'&&!options.recentAuth)throw new DomainError('player_pin_reauth','Log opnieuw in via Google of een e-mailcode om je spelerspincode opnieuw in te stellen.',403);
 if(mode==='change'&&!await verifyPlayerPin(input.currentPin,previous)){await recordPlayerPinOutcome(id,'rejected','manage',id);throw verificationFailure();}
 const policy=playerPinPolicy(),value={salt:randomBytes(16).toString('base64'),pepper_version:secret().version,memory:policy.memory,passes:policy.passes,parallelism:1};
 const verifier=await withKdf(()=>derive(input.pin as string,value));
 return {actor:id,requestId,mode,fingerprint,previousVersion:previous?.version??0,value:{...value,verifier:verifier.toString('base64')},replayed:false};
}
/** Save in the profile transaction so username completion and PIN either both commit or neither does. */
export async function savePreparedPlayerPin(client:PoolClient,actor:string,prepared:PreparedPlayerPin):Promise<void>{
 if(prepared.actor!==uuid(actor))throw new DomainError('forbidden','Deze spelerspincode hoort bij een ander account.',403);
 await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`player-pin:${actor}`]);
 const active=await client.query('select id from dartflow_private.profiles where id=$1 and deletion_requested_at is null and deleted_at is null for update',[actor]);
 if(!active.rowCount)throw new DomainError('account_deleted','Dit account wordt verwijderd of is verwijderd.',403);
 const prior=await client.query<{fingerprint:string}>('select fingerprint from dartflow_private.player_pin_receipts where actor_id=$1 and request_id=$2 and kind=$3',[actor,prepared.requestId,'update']);
 if(prior.rows.length){if(prior.rows[0].fingerprint!==prepared.fingerprint)throw new DomainError('request_reused','Deze aanvraag is al voor andere gegevens gebruikt.',409);return;}
 if(prepared.replayed)throw new DomainError('player_pin_retry','Controleer je profiel en probeer opnieuw.',409);
 const previous=await readVerifier(client,actor,true);
 if((previous?.version??0)!==prepared.previousVersion)throw new DomainError('player_pin_changed','Je spelerspincode is inmiddels gewijzigd. Probeer opnieuw.',409);
 const value=prepared.value;
 await client.query(`insert into dartflow_private.player_pin_verifiers(user_id,version,pepper_version,salt,verifier,memory,passes,parallelism) values($1,$2,$3,$4,$5,$6,$7,$8)
  on conflict(user_id) do update set version=excluded.version,pepper_version=excluded.pepper_version,salt=excluded.salt,verifier=excluded.verifier,memory=excluded.memory,passes=excluded.passes,parallelism=excluded.parallelism,changed_at=clock_timestamp()`,[actor,prepared.previousVersion+1,value.pepper_version,value.salt,value.verifier,value.memory,value.passes,value.parallelism]);
 await client.query("insert into dartflow_private.player_pin_receipts(actor_id,request_id,kind,fingerprint) values($1,$2,'update',$3)",[actor,prepared.requestId,prepared.fingerprint]);
 await client.query("insert into dartflow_private.platform_audit(actor_id,action,detail) values($1,'player-pin.updated',$2)",[actor,JSON.stringify({mode:prepared.mode,version:prepared.previousVersion+1})]);
 if(previous)await enqueueAuditedNotification(client,{eventId:`player-pin:${actor}:${prepared.previousVersion+1}`,templateId:'player-pin-changed',actorId:actor,recipientIds:[actor],allowSelf:true,source:{kind:'account',accountId:actor},href:'/app/profiel',status:'Je spelerspincode is gewijzigd. Heb je dit niet gedaan, neem dan contact op met DartFlow Support.'});
}
export async function updatePlayerPin(actor:string,input:Parameters<typeof preparePlayerPinUpdate>[1],options:{recentAuth:boolean}):Promise<{ok:true;pinConfigured:true}>{
 const prepared=await preparePlayerPinUpdate(actor,input,options);await transaction(client=>savePreparedPlayerPin(client,actor,prepared));return {ok:true,pinConfigured:true};
}
/** Internal only; use the version again under the coupling transaction lock. */
export async function playerPinVerifier(user:string,client:Query=database()):Promise<PinRow|null>{return readVerifier(client,user);}
