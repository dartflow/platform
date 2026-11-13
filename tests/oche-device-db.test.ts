import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {closeDatabase,database} from '../lib/db';
import {createBoardScreenDevice,getBoardScreen,pairBoardScreenDevice,revokeBoardScreenDevice} from '../lib/board-screens';
import {newGame,scoreGame} from '../lib/domain';
import {authorizeOcheAccess,claimOcheInstallation,cleanupOcheDevices,getOcheInstallationStatus,getOcheManagement,manageOcheDevice,redeemOcheInstallation,refreshOcheSession,selectOcheHomeSession,setOcheLimit,startOcheInstallation} from '../lib/oche-device-store';
import {getOcheDeviceSnapshot,pollOcheDeviceEvents} from '../lib/oche-device-projection';
import {createOcheAccess,decryptOcheReceipt,encryptOcheReceipt,secretHash} from '../lib/oche-device-crypto';
import type {OchePlatform,OchePairing,OcheClaim,OcheSession} from '../lib/oche-device-types';
import type {MatchState} from '../lib/types';
import {executePlatformCommand} from '../lib/platform';
try{process.loadEnvFile('.env.local');}catch{/* loopback CI injects its own secrets */}
const loopback=(value:string|undefined)=>{try{return !!value&&['127.0.0.1','localhost','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);

test('persistent Oche device grants enforce scopes, quotas, retries, rotation and live revocation',{skip:!configured},async t=>{
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();
 const people=Array.from({length:5},()=>randomUUID()),[owner,player,outsider,central,manager]=people,club=randomUUID(),locations:string[]=[],events:string[]=[],boards:string[]=[],installations:string[]=[],requests:string[]=[],matches:string[]=[],legacyIds:string[]=[];
 const request=()=>{const id=randomUUID();requests.push(id);return id;};
 const start=async(platform:OchePlatform='android')=>{const result=await startOcheInstallation({platform,requestId:request()});installations.push(result.installationId);return result;};
 const claim=(device:OchePairing,extra:Partial<OcheClaim>={},actor:string=owner)=>claimOcheInstallation(actor,{code:device.code,scope:'home',name:'Testscherm',requestId:request(),...extra});
 const redeem=(device:OchePairing&{installationSecret:string},nonce=request())=>redeemOcheInstallation(device.installationId,device.installationSecret,nonce);
 const venue=async()=>{const id=randomUUID();locations.push(id);await admin.query("insert into dartflow_private.locations(id,owner_id,kind,name) values($1,$2,'venue','Oche testlocatie')",[id,owner]);return id;};
 const board=async(locationId:string,publicScreen=false)=>{const id=randomUUID(),eventId=randomUUID();boards.push(id);events.push(eventId);await admin.query("insert into dartflow_private.events(id,club_id,name,date,capacity) values($1,$2,'Oche testevenement',current_date,8)",[eventId,club]);await admin.query("insert into dartflow_private.boards(id,event_id,name) values($1,$2,'Baan 1')",[id,eventId]);await admin.query('insert into dartflow_private.location_boards(board_id,location_id,home_event_id,public_screen) values($1,$2,$3,$4)',[id,locationId,eventId,publicScreen]);return id;};
 const revoke=async(id:string)=>manageOcheDevice(owner,id,{action:'revoke',requestId:request()});
 try{
  for(const [index,id] of people.entries())await admin.query('insert into dartflow_private.profiles(id,name,display_name_confirmed) values($1,$2,true)',[id,`oche${index}${randomUUID().slice(0,8)}`]);
  await admin.query("insert into dartflow_private.clubs(id,name) values($1,'Oche testclub')",[club]);
  for(const id of [owner,player])await admin.query('insert into dartflow_private.club_memberships(club_id,user_id,role) values($1,$2,$3)',[club,id,id===owner?'organizer':'player']);
  await admin.query("insert into dartflow_private.platform_roles(user_id,role) values($1,'admin')",[central]);
  await t.test('start is recoverable; code and 256-bit installation secret stay out of plaintext storage',async()=>{
   const requestId=request(),first=await startOcheInstallation({platform:'android-tv',requestId});installations.push(first.installationId);
   assert.deepEqual(await startOcheInstallation({platform:'android-tv',requestId}),first);assert.equal(Buffer.from(first.installationSecret,'base64url').length,32);assert.match(first.code,/^[0-9A-HJKMNP-TV-Z]{4}–[0-9A-HJKMNP-TV-Z]{4}$/);
   assert.equal(new URL(first.verificationUrl).search,'');assert.equal(new URL(first.verificationUrl).hash,`#code=${first.code.replace('–','')}`);
   const row=(await admin.query('select * from dartflow_private.oche_installations where id=$1',[first.installationId])).rows[0];assert.equal(row.secret_hash,secretHash(first.installationSecret));assert.equal(JSON.stringify(row).includes(first.installationSecret),false);assert.equal(JSON.stringify(row).includes(first.code),false);
   assert.equal((await getOcheInstallationStatus(first.installationId,first.installationSecret)).pairing?.code,first.code);
   await assert.rejects(getOcheInstallationStatus(first.installationId,'x'.repeat(43)),{status:401});
  });
  await t.test('equivalent UUID casing shares bootstrap, account and nonce retry receipts',async()=>{
   const bootstrap=request(),first=await startOcheInstallation({platform:'android',requestId:bootstrap});installations.push(first.installationId);
   assert.deepEqual(await startOcheInstallation({platform:'android',requestId:bootstrap.toUpperCase()}),first);
   const claimKey=request(),input={code:first.code,scope:'home' as const,name:'Case-safe scherm',requestId:claimKey};const approved=await claimOcheInstallation(owner,input);
   assert.deepEqual(await claimOcheInstallation(owner.toUpperCase(),{...input,requestId:claimKey.toUpperCase()}),approved);
   const nonce=request(),session=await redeem(first,nonce);assert.deepEqual(await redeemOcheInstallation(first.installationId.toUpperCase(),first.installationSecret,nonce.toUpperCase()),session);
   const refreshNonce=request(),rotated=await refreshOcheSession(session.refreshToken!,refreshNonce);assert.deepEqual(await refreshOcheSession(session.refreshToken!,refreshNonce.toUpperCase()),rotated);
   const rename=request();await manageOcheDevice(owner,session.deviceId,{action:'rename',name:'Gelijke aanvraag',requestId:rename});assert.deepEqual(await manageOcheDevice(owner.toUpperCase(),session.deviceId.toUpperCase(),{action:'rename',name:'Gelijke aanvraag',requestId:rename.toUpperCase()}),{ok:true});
   const selection=request();await selectOcheHomeSession(owner,{sourceId:null,requestId:selection});assert.deepEqual(await selectOcheHomeSession(owner.toUpperCase(),{sourceId:null,requestId:selection.toUpperCase()}),{ok:true});await revoke(session.deviceId);
   const locationId=await venue(),limitKey=request(),limit=await setOcheLimit(central,{locationId,maximum:3,requestId:limitKey});assert.deepEqual(await setOcheLimit(central.toUpperCase(),{locationId:locationId.toUpperCase(),maximum:3,requestId:limitKey.toUpperCase()}),limit);
  });
  await t.test('only one simultaneous home claim succeeds and Android/browser share the same reserved slot',async()=>{
   const first=await start('android'),second=await start('browser');
   const results=await Promise.allSettled([claim(first),claim(second)]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
   const rejected=results.find(result=>result.status==='rejected');assert.equal(rejected?.status==='rejected'&&rejected.reason.code,'device_limit');
   const chosen=results[0].status==='fulfilled'?first:second,nonce=request(),session=await redeem(chosen,nonce);assert.deepEqual(await redeem(chosen,nonce),session);
   await assert.rejects(redeem(chosen),{code:'invalid_code'});assert.equal((await getOcheManagement(owner)).home.active,1);
   assert.equal((await getOcheDeviceSnapshot(session.accessToken!)).scope,'home');await revoke(session.deviceId);
   await assert.rejects(authorizeOcheAccess(session.accessToken!),{status:401});
  });
  await t.test('claim retries are durable, replacements are explicit and the old device survives until atomic redeem',async()=>{
   const initial=await start();await claim(initial);const old=await redeem(initial),replacement=await start('browser');
   await assert.rejects(claim(replacement),{code:'device_limit'});
   const requestId=request(),payload={code:replacement.code,scope:'home' as const,name:'Nieuwe tablet',replaceDeviceId:old.deviceId,requestId};
   const approved=await claimOcheInstallation(owner,payload);assert.deepEqual(await claimOcheInstallation(owner,payload),approved);
   await assert.rejects(claimOcheInstallation(owner,{...payload,name:'Andere naam'}),{code:'idempotency_conflict'});
   assert.equal((await authorizeOcheAccess(old.accessToken!)).id,old.deviceId);
   const another=await start();await assert.rejects(claim(another,{replaceDeviceId:old.deviceId}),{code:'replacement_pending'});
   const next=await redeem(replacement);await assert.rejects(authorizeOcheAccess(old.accessToken!),{status:401});assert.equal((await getOcheManagement(owner)).home.active,1);await revoke(next.deviceId);
  });
  await t.test('new code cancels its reservation, invalidates the old code and can approve again in the same installation',async()=>{
   const initial=await start();await claim(initial);assert.equal((await getOcheManagement(owner)).home.reserved,1);
   const next=await startOcheInstallation({platform:'android',requestId:request(),installationId:initial.installationId,installationSecret:initial.installationSecret});assert.notEqual(next.code,initial.code);
   assert.equal((await getOcheManagement(owner)).home.reserved,0);await assert.rejects(claim(initial),{code:'invalid_code'});await claim(next);const session=await redeem(next);await revoke(session.deviceId);
  });
  await t.test('a remotely revoked browser can start a fresh identity with its old installation cookie',async()=>{
   const first=await start('browser');await claim(first);const old=await redeem(first);await revoke(old.deviceId);
   const retryId=request(),next=await startOcheInstallation({platform:'browser',requestId:retryId,installationId:first.installationId,installationSecret:first.installationSecret});installations.push(next.installationId);
   assert.deepEqual(await startOcheInstallation({platform:'browser',requestId:retryId,installationId:next.installationId,installationSecret:next.installationSecret}),next);
   assert.notEqual(next.installationId,first.installationId);assert.notEqual(next.installationSecret,first.installationSecret);await claim(next);const session=await redeem(next);await revoke(session.deviceId);
  });
  await t.test('new-code regeneration racing approval cannot leave a hidden reservation or a stale active code',async()=>{
   for(let iteration=0;iteration<5;iteration++){
    const first=await start();const result=await Promise.allSettled([claim(first),startOcheInstallation({platform:'android',requestId:request().toUpperCase(),installationId:first.installationId.toUpperCase(),installationSecret:first.installationSecret})]);
    const regenerated=result[1];if(regenerated.status!=='fulfilled')throw regenerated.reason;
    assert.equal((await getOcheInstallationStatus(first.installationId,first.installationSecret)).state,'pending');assert.equal((await getOcheManagement(owner)).home.reserved,0);
    await assert.rejects(claim(first),{code:'invalid_code'});await claim(regenerated.value);const session=await redeem(regenerated.value);await revoke(session.deviceId);
   }
  });
  await t.test('an uppercase installation waits on the same lower-case regeneration/claim guard',async()=>{
   const first=await start();let completed=false;
   await admin.query('begin');await admin.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`oche:installation:${first.installationId}`]);
   const regenerating=startOcheInstallation({platform:'android',requestId:request(),installationId:first.installationId.toUpperCase(),installationSecret:first.installationSecret}).then(value=>{completed=true;return value;});
   try{await new Promise(resolve=>setTimeout(resolve,75));assert.equal(completed,false);const claiming=claim(first);await admin.query('commit');const results=await Promise.allSettled([regenerating,claiming]);const next=results[0];if(next.status!=='fulfilled')throw next.reason;
    assert.equal((await getOcheManagement(owner)).home.reserved,0);await claim(next.value);const session=await redeem(next.value);await revoke(session.deviceId);
   }finally{await admin.query('rollback');await regenerating;}
  });
  await t.test('expired codes/reservations release capacity without a client, and stale redeem cannot activate',async()=>{
   const expired=await start();await admin.query("update dartflow_private.oche_installations set expires_at=clock_timestamp()-interval '1 second' where id=$1",[expired.installationId]);assert.equal((await getOcheInstallationStatus(expired.installationId,expired.installationSecret)).state,'expired');await assert.rejects(claim(expired),{code:'invalid_code'});
   const reserved=await start();await claim(reserved);await admin.query("update dartflow_private.oche_reservations set expires_at=clock_timestamp()-interval '1 second' where installation_id=$1",[reserved.installationId]);
   await cleanupOcheDevices();assert.equal((await getOcheManagement(owner)).home.reserved,0);await assert.rejects(redeem(reserved),{code:'invalid_code'});
  });
  await t.test('one actor operation key serializes mutations across different capacity scopes',async()=>{
   const a=await venue(),b=await venue(),first=await start(),second=await start(),sharedClaim=request();
   const approved=await Promise.allSettled([claim(first,{scope:'location',locationId:a,requestId:sharedClaim}),claim(second,{scope:'location',locationId:b,requestId:sharedClaim})]);
   assert.equal(approved.filter(result=>result.status==='fulfilled').length,1);const duplicate=approved.find(result=>result.status==='rejected');assert.equal(duplicate?.status==='rejected'&&duplicate.reason.code,'idempotency_conflict');
   assert.equal((await admin.query("select count(*)::int as n from dartflow_private.oche_reservations where location_id=any($1::uuid[]) and state='approved'",[[a,b]])).rows[0].n,1);
   const winner=approved[0].status==='fulfilled'?first:second,other=winner===first?second:first,otherLocation=winner===first?b:a;const active=await redeem(winner);await claim(other,{scope:'location',locationId:otherLocation});const peer=await redeem(other);
   const sharedDevice=request(),renamed=await Promise.allSettled([manageOcheDevice(owner,active.deviceId,{action:'rename',name:'Een gewijzigd scherm',requestId:sharedDevice}),manageOcheDevice(owner,peer.deviceId,{action:'rename',name:'Nog een gewijzigd scherm',requestId:sharedDevice})]);
   assert.equal(renamed.filter(result=>result.status==='fulfilled').length,1);const rejectedRename=renamed.find(result=>result.status==='rejected');assert.equal(rejectedRename?.status==='rejected'&&rejectedRename.reason.code,'idempotency_conflict');
   const rows=(await admin.query('select name from dartflow_private.oche_devices where id=any($1::uuid[])',[[active.deviceId,peer.deviceId]])).rows;assert.equal(rows.filter(row=>row.name!=='Testscherm').length,1);
   const sharedLimit=request(),limited=await Promise.allSettled([setOcheLimit(central,{locationId:a,maximum:3,requestId:sharedLimit}),setOcheLimit(central,{locationId:b,maximum:4,requestId:sharedLimit})]);
   assert.equal(limited.filter(result=>result.status==='fulfilled').length,1);const rejectedLimit=limited.find(result=>result.status==='rejected');assert.equal(rejectedLimit?.status==='rejected'&&rejectedLimit.reason.code,'idempotency_conflict');
   assert.equal((await admin.query('select count(*)::int as n from dartflow_private.oche_location_limits where location_id=any($1::uuid[])',[[a,b]])).rows[0].n,1);
   const centralContext=await getOcheManagement(central);assert.equal(centralContext.canManageLimits,true);assert.equal(centralContext.locations.find(row=>row.locationId===a)?.canManageScreens,false);assert.equal((await getOcheManagement(owner)).locations.find(row=>row.locationId===a)?.canManageScreens,true);
   await revoke(active.deviceId);await revoke(peer.deviceId);
  });
  await t.test('venue claims serialize the last slot; central override and above-limit replacement follow shared capacity',async()=>{
   const locationId=await venue(),physical=await board(locationId),first=await start('android'),second=await start('browser'),third=await start('android-tv');
   const results=await Promise.allSettled([first,second,third].map(device=>claim(device,{scope:'location',locationId,boardId:physical})));assert.equal(results.filter(result=>result.status==='fulfilled').length,2);
   const active=[];for(const [index,result] of results.entries())if(result.status==='fulfilled')active.push(await redeem([first,second,third][index]));
   const waiting=[first,second,third][results.findIndex(result=>result.status==='rejected')];
   await assert.rejects(setOcheLimit(owner,{locationId,maximum:3,requestId:request()}),{status:403});
   await setOcheLimit(central,{locationId,maximum:3,requestId:request()});await claim(waiting,{scope:'location',locationId});active.push(await redeem(waiting));
   const below=await setOcheLimit(central,{locationId,maximum:2,requestId:request()});assert.equal(below.active,3);assert.equal(below.aboveLimit,true);
   const replacement=await start();await assert.rejects(claim(replacement,{scope:'location',locationId,replaceDeviceId:active[0].deviceId}),{code:'device_limit'});
   await revoke(active[2].deviceId);await claim(replacement,{scope:'location',locationId,replaceDeviceId:active[0].deviceId});const swapped=await redeem(replacement);assert.equal((await getOcheManagement(owner)).locations.find(row=>row.locationId===locationId)?.active,2);
   await revoke(active[1].deviceId);await revoke(swapped.deviceId);
  });
  await t.test('upper/lower-case location UUIDs share one last-slot capacity mutex',async()=>{
   const locationId=await venue(),initial=await start();await claim(initial,{scope:'location',locationId});const active=await redeem(initial),first=await start(),second=await start('browser');
   await admin.query('begin');await admin.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`oche:v1:location:${locationId}`]);let completed=false;
   const upper=claim(second,{scope:'location',locationId:locationId.toUpperCase()},owner.toUpperCase()).then(result=>{completed=true;return result;},error=>{completed=true;throw error;});
   try{
    await new Promise(resolve=>setTimeout(resolve,100));assert.equal(completed,false);const lower=claim(first,{scope:'location',locationId});await admin.query('commit');const attempts=await Promise.allSettled([lower,upper]);
    assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);const blocked=attempts.find(result=>result.status==='rejected');assert.equal(blocked?.status==='rejected'&&blocked.reason.code,'device_limit');
    const winner=attempts[0].status==='fulfilled'?first:second,paired=await redeem(winner);assert.equal((await getOcheManagement(owner)).locations.find(row=>row.locationId===locationId)?.active,2);await revoke(active.deviceId);await revoke(paired.deviceId);
   }finally{await admin.query('rollback');await upper.catch(()=>undefined);}
  });
  await t.test('legacy private browser grants consume the same quota; the old provisioning endpoint cannot bypass it',async()=>{
   const locationId=await venue(),physical=await board(locationId),eventId=(await admin.query('select event_id from dartflow_private.boards where id=$1',[physical])).rows[0].event_id,id=randomUUID(),raw='k'.repeat(43);legacyIds.push(id);
   await admin.query("insert into dartflow_private.board_screen_devices(id,board_id,event_id,created_by,name,token_hash,pairing_expires_at,paired_at,expires_at) values($1,$2,$3,$4,'Bestaande browser',$5,now()+interval '10 minutes',now(),now()+interval '1 year')",[id,physical,eventId,owner,secretHash(raw)]);
   assert.equal((await getBoardScreen(physical,raw)).status,'available');await assert.rejects(createBoardScreenDevice(owner,physical),{code:'use_screen_pairing'});
   const first=await start();await claim(first,{scope:'location',locationId});const session=await redeem(first),second=await start();await assert.rejects(claim(second,{scope:'location',locationId}),{code:'device_limit'});
   const context=await getOcheManagement(owner);assert.equal(context.locations.find(row=>row.locationId===locationId)?.active,2);assert.equal(context.legacyDevices.find(row=>row.id===id)?.boardId,physical);
   await revokeBoardScreenDevice(owner,physical,id);await assert.rejects(getBoardScreen(physical,raw),{status:403});await claim(second,{scope:'location',locationId});const extra=await redeem(second);await revoke(session.deviceId);await revoke(extra.deviceId);
  });
  await t.test('preexisting legacy pairing reservations serialize with v1 claim and revocation on the same scope',async()=>{
   const locationId=await venue(),physical=await board(locationId),eventId=(await admin.query('select event_id from dartflow_private.boards where id=$1',[physical])).rows[0].event_id,id=randomUUID(),code=randomUUID().replaceAll('-','').slice(0,12).toUpperCase();legacyIds.push(id);
   await admin.query("insert into dartflow_private.board_screen_devices(id,board_id,event_id,created_by,name,pairing_hash,pairing_expires_at,expires_at) values($1,$2,$3,$4,'Oude code',$5,now()+interval '10 minutes',now()+interval '1 year')",[id,physical,eventId,owner,secretHash(code)]);
   const first=await start(),second=await start();const outcomes=await Promise.allSettled([claim(first,{scope:'location',locationId}),claim(second,{scope:'location',locationId})]);assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
   const winner=outcomes[0].status==='fulfilled'?first:second;await setOcheLimit(central,{locationId,maximum:1,requestId:request()});await assert.rejects(pairBoardScreenDevice(physical,code),{code:'device_limit'});await setOcheLimit(central,{locationId,maximum:2,requestId:request()});
   await Promise.allSettled([pairBoardScreenDevice(physical,code),revokeBoardScreenDevice(owner,physical,id)]);assert.ok((await admin.query('select revoked_at from dartflow_private.board_screen_devices where id=$1',[id])).rows[0].revoked_at);await assert.rejects(pairBoardScreenDevice(physical,code),{code:'invalid_pairing'});
   const native=await redeem(winner);assert.equal((await getOcheManagement(owner)).locations.find(row=>row.locationId===locationId)?.active,1);await revoke(native.deviceId);
  });
  await t.test('a limit lowered after approval also blocks activation and leaves replacement credentials valid',async()=>{
   const locationId=await venue(),first=await start();await claim(first,{scope:'location',locationId});const old=await redeem(first),pending=await start();await claim(pending,{scope:'location',locationId});
   await setOcheLimit(central,{locationId,maximum:1,requestId:request()});await assert.rejects(redeem(pending),{code:'device_limit'});assert.equal((await authorizeOcheAccess(old.accessToken!)).id,old.deviceId);
   await setOcheLimit(central,{locationId,maximum:2,requestId:request()});const second=await redeem(pending),replacement=await start();await claim(replacement,{scope:'location',locationId,replaceDeviceId:old.deviceId});
   await setOcheLimit(central,{locationId,maximum:1,requestId:request()});await assert.rejects(redeem(replacement),{code:'device_limit'});assert.equal((await authorizeOcheAccess(old.accessToken!)).id,old.deviceId);await revoke(old.deviceId);await revoke(second.deviceId);
  });
  await t.test('refresh rotates with replay recovery, concurrent requests cannot revive a previous credential',async()=>{
   const device=await start();await claim(device);const first=await redeem(device),nonce=request();const next=await refreshOcheSession(first.refreshToken!,nonce);
   assert.notEqual(next.refreshToken,first.refreshToken);assert.deepEqual(await refreshOcheSession(first.refreshToken!,nonce),next);await assert.rejects(refreshOcheSession(first.refreshToken!,request()),{status:401});
   const outcomes=await Promise.allSettled([refreshOcheSession(next.refreshToken!,request()),refreshOcheSession(next.refreshToken!,request())]);assert.equal(outcomes.filter(value=>value.status==='fulfilled').length,1);
   await assert.rejects(refreshOcheSession(first.refreshToken!,nonce),{status:401});await revoke(first.deviceId);
  });
  await t.test('a lost redeem/refresh answer recovers after short access expiry without another slot or rotation',async()=>{
   const expireReceiptAccess=async(principal:string,operation:string,requestId:string)=>{
    const receipt=(await admin.query('select response_cipher from dartflow_private.oche_device_receipts where principal=$1 and operation=$2 and request_id=$3',[principal,operation,requestId])).rows[0];
    const response=decryptOcheReceipt<OcheSession>(receipt.response_cipher),expired=Date.now()-1000;
    response.accessExpiresAt=new Date(expired).toISOString();response.accessToken=createOcheAccess(response.deviceId,1,expired);
    await admin.query('update dartflow_private.oche_device_receipts set response_cipher=$4 where principal=$1 and operation=$2 and request_id=$3',[principal,operation,requestId,encryptOcheReceipt(response)]);
   };
   const device=await start();await claim(device);const redeemNonce=request(),first=await redeem(device,redeemNonce);await expireReceiptAccess(`installation:${device.installationId}`,'redeem',redeemNonce);
   const recovery=await redeem(device,redeemNonce);assert.equal(recovery.refreshToken,first.refreshToken);assert.equal((await authorizeOcheAccess(recovery.accessToken!)).id,first.deviceId);assert.equal((await getOcheManagement(owner)).home.active,1);
   const refreshNonce=request(),next=await refreshOcheSession(first.refreshToken!,refreshNonce);await expireReceiptAccess(`refresh:${secretHash(first.refreshToken!)}`,'refresh',refreshNonce);
   const refreshed=await refreshOcheSession(first.refreshToken!,refreshNonce);assert.equal(refreshed.refreshToken,next.refreshToken);assert.equal((await authorizeOcheAccess(refreshed.accessToken!)).id,first.deviceId);assert.equal((await admin.query('select generation from dartflow_private.oche_device_credentials where device_id=$1',[first.deviceId])).rows[0].generation,2);await revoke(first.deviceId);
  });
  await t.test('board ownership, live scoped rights and anonymous public screens stay isolated',async()=>{
   const locationId=await venue(),otherLocation=await venue(),physical=await board(locationId),other=await board(otherLocation),device=await start();
   await assert.rejects(claim(device,{scope:'location',locationId},outsider),{status:403});await assert.rejects(claim(device,{scope:'location',locationId,boardId:other}),{code:'invalid_board'});
   await admin.query('insert into dartflow_private.location_members(location_id,user_id,granted_by) values($1,$2,$3)',[locationId,manager,owner]);
   await claim(device,{scope:'location',locationId,boardId:physical},manager);const session=await redeem(device);
   await assert.rejects(getBoardScreen(physical),{code:'screen_pairing_required'});
   const view=await getOcheDeviceSnapshot(session.accessToken!);assert.equal(view.board?.id,physical);assert.equal(view.display?.screen?.paired,false);assert.deepEqual(view.permissions,{read:true,score:false,extend:false});
   const serialized=JSON.stringify(view);for(const secret of [...people,session.refreshToken!,session.accessToken!,device.installationSecret])assert.equal(serialized.includes(secret),false);
   await assert.rejects(manageOcheDevice(owner,session.deviceId,{action:'assign',boardId:other,requestId:request()}),{code:'invalid_board'});
   await admin.query('delete from dartflow_private.location_members where location_id=$1 and user_id=$2',[locationId,manager]);await assert.rejects(getOcheDeviceSnapshot(session.accessToken!),{status:403});
   await revoke(session.deviceId);
  });
  await t.test('an open event poll is re-authorized after assignment or revocation within the five-second budget',async()=>{
   const locationId=await venue(),physical=await board(locationId),device=await start();await claim(device,{scope:'location',locationId});const session=await redeem(device);
   const waiting=await pollOcheDeviceEvents(session.accessToken!);assert.equal(waiting.snapshot.state,'unassigned');
   await manageOcheDevice(owner,session.deviceId,{action:'assign',boardId:physical,requestId:request()});await assert.rejects(pollOcheDeviceEvents(session.accessToken!,waiting.eventId),{status:401});
   const refreshed=await refreshOcheSession(session.refreshToken!,request()),poll=await pollOcheDeviceEvents(refreshed.accessToken!,waiting.eventId);assert.equal(poll.snapshot.board?.id,physical);assert.equal(poll.reset,true);
   const began=performance.now();await revoke(session.deviceId);await new Promise(resolve=>setTimeout(resolve,2000));await assert.rejects(pollOcheDeviceEvents(refreshed.accessToken!,poll.eventId),{status:401});assert.ok(performance.now()-began<5000);
  });
  await t.test('home projection only follows an explicitly selected own match and strips full account data',async()=>{
   const eventId=randomUUID();events.push(eventId);await admin.query("insert into dartflow_private.events(id,club_id,name,date,capacity) values($1,$2,'Eigen thuiswedstrijd',current_date,8)",[eventId,club]);
   const id=randomUUID();matches.push(id);const settings={startScore:501 as const,bestOfLegs:3,bestOfSets:1};const game=scoreGame(newGame(id,[owner,player],settings),180);
   const state:MatchState={id,clubId:club,eventId,boardId:null,revision:1,status:'live',players:[{id:owner,name:'Speler een',email:'private1@example.test'},{id:player,name:'Speler twee',email:'private2@example.test'}],writerId:owner,settings,accepted:[true,true],confirmations:[false,false],resultRevision:null,game,previousSets:[],winnerId:null,resultPublished:false,dispute:null};
   await admin.query('insert into dartflow_private.matches(id,club_id,event_id,revision,state) values($1,$2,$3,1,$4)',[id,club,eventId,JSON.stringify(state)]);for(const [position,user]of [owner,player].entries())await admin.query('insert into dartflow_private.match_players(match_id,user_id,position) values($1,$2,$3)',[id,user,position]);
   const device=await start();await claim(device);const session=await redeem(device);assert.equal((await getOcheDeviceSnapshot(session.accessToken!)).display,null);
   await assert.rejects(selectOcheHomeSession(outsider,{sourceId:id,requestId:request()}),{status:403});await selectOcheHomeSession(owner,{sourceId:id,requestId:request()});const snapshot=await getOcheDeviceSnapshot(session.accessToken!);
   assert.deepEqual(snapshot.display?.snapshot.match?.remaining,[321,501]);assert.equal(snapshot.display?.board.publicScan,false);assert.equal(snapshot.display?.snapshot.match?.visits[0].score,180);
   const serialized=JSON.stringify(snapshot);for(const secret of [owner,player,club,eventId,id,'private1@example.test','permissions":{"canScore'])assert.equal(serialized.includes(secret),false);
   // The snapshot must finish using its tenth pool slot, without requesting an
   // eleventh connection from inside the home match projection.
   const held:pg.PoolClient[]=[];let pending:ReturnType<typeof getOcheDeviceSnapshot>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
   try{
    for(let index=0;index<9;index++)held.push(await database().connect());
    pending=getOcheDeviceSnapshot(session.accessToken!);
    const available=await Promise.race([pending,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Home snapshot attempted to borrow an additional pool connection.')),1900);})]);
    assert.deepEqual(available.display?.snapshot.match?.remaining,[321,501]);
   }finally{if(timer)clearTimeout(timer);for(const client of held)client.release();await pending?.catch(()=>undefined);}
   await selectOcheHomeSession(owner,{sourceId:null,requestId:request()});assert.equal((await getOcheDeviceSnapshot(session.accessToken!)).display,null);await revoke(session.deviceId);
  });
  await t.test('boardless home training receives durable score and undo events without replaying an accepted retry',async()=>{
   const created=await executePlatformCommand(owner,{requestId:request(),action:{type:'training.create',mode:'solo',startScore:501}}),sourceId=created.id!;
   const device=await start();await claim(device);const session=await redeem(device);await selectOcheHomeSession(owner,{sourceId,requestId:request()});
   const baseline=await getOcheDeviceSnapshot(session.accessToken!);assert.equal(baseline.display?.snapshot.scoreEvents?.length,0);
   const command={requestId:request(),expectedRevision:created.entity!.revision,action:{type:'training.score',id:sourceId,score:180}};const accepted=await executePlatformCommand(owner,command);
   const update=await pollOcheDeviceEvents(session.accessToken!,baseline.eventId),scored=update.snapshot;assert.equal(update.reset,false);assert.notEqual(update.eventId,baseline.eventId);assert.equal(scored.display?.snapshot.scoreEvents?.at(-1)?.score,180);assert.equal(scored.display?.snapshot.match?.remaining[0],321);
   assert.equal((await pollOcheDeviceEvents(session.accessToken!,update.eventId)).reset,false);assert.equal((await pollOcheDeviceEvents(session.accessToken!,'unknown-old-cursor')).reset,true);
   const id=scored.display?.snapshot.scoreEvents?.at(-1)?.id;await executePlatformCommand(owner,command);assert.deepEqual((await getOcheDeviceSnapshot(session.accessToken!)).display?.snapshot.scoreEvents,scored.display?.snapshot.scoreEvents);
   const undone=await executePlatformCommand(owner,{requestId:request(),expectedRevision:accepted.entity!.revision,action:{type:'training.undo',id:sourceId}});const afterUndo=await getOcheDeviceSnapshot(session.accessToken!);assert.equal(afterUndo.display?.snapshot.scoreEvents?.at(-1)?.kind,'undo');assert.equal(afterUndo.display?.snapshot.match?.remaining[0],501);
   let progress=await executePlatformCommand(owner,{requestId:request(),expectedRevision:undone.entity!.revision,action:{type:'training.score',id:sourceId,score:180}});const replay=await getOcheDeviceSnapshot(session.accessToken!);assert.notEqual(replay.display?.snapshot.scoreEvents?.at(-1)?.id,id);assert.equal(replay.display?.snapshot.scoreEvents?.filter(event=>event.kind==='score').length,2);
   for(let index=0;index<66;index++)progress=await executePlatformCommand(owner,{requestId:request(),expectedRevision:progress.entity!.revision,action:{type:'training.score',id:sourceId,score:0}});
   const gap=await pollOcheDeviceEvents(session.accessToken!,replay.eventId);assert.equal(gap.reset,true);assert.equal(gap.snapshot.display?.snapshot.scoreEvents?.length,64);
   await executePlatformCommand(owner,{requestId:request(),expectedRevision:progress.entity!.revision,action:{type:'training.score',id:sourceId,score:0}});assert.equal((await pollOcheDeviceEvents(session.accessToken!,gap.eventId)).reset,false);await revoke(session.deviceId);
  });
  await t.test('private device tables have RLS and browser roles cannot select credentials',async()=>{
   const rows=(await admin.query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='dartflow_private' and relname like 'oche_%' and relkind='r'")).rows;assert.equal(rows.length,8);for(const row of rows)assert.equal(row.relrowsecurity,true);
   assert.equal((await admin.query("select has_table_privilege('public','dartflow_private.oche_device_credentials','select') as readable")).rows[0].readable,false);
  });
 }finally{
  await admin.query('rollback');await admin.query('delete from dartflow_private.oche_device_receipts where request_id=any($1::uuid[])',[requests]);
  await admin.query('delete from dartflow_private.oche_device_audit where actor_id=any($1::uuid[])',[people]);
  await admin.query('delete from dartflow_private.oche_reservations where created_by=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.oche_devices where created_by=any($1::uuid[])',[people]);
  await admin.query('delete from dartflow_private.oche_installations where id=any($1::uuid[])',[installations]);await admin.query('delete from dartflow_private.oche_home_selections where owner_id=any($1::uuid[])',[people]);
  await admin.query('delete from dartflow_private.board_screen_devices where id=any($1::uuid[])',[legacyIds]);await admin.query('delete from dartflow_private.audit_events where actor_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.auth_limits where key=any($1::text[])',[boards.map(id=>`board-screen-pair:${id}`)]);
  await admin.query('delete from dartflow_private.oche_location_limits where updated_by=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.location_boards where board_id=any($1::uuid[])',[boards]);
  await admin.query('delete from dartflow_private.location_members where location_id=any($1::uuid[])',[locations]);await admin.query('delete from dartflow_private.locations where id=any($1::uuid[])',[locations]);
  await admin.query('delete from dartflow_private.match_players where match_id=any($1::uuid[])',[matches]);await admin.query('delete from dartflow_private.matches where id=any($1::uuid[])',[matches]);await admin.query('delete from dartflow_private.boards where id=any($1::uuid[])',[boards]);
  await admin.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.platform_members where entity_id in(select id from dartflow_private.platform_entities where owner_id=any($1::uuid[]))',[people]);await admin.query('delete from dartflow_private.invitation_codes where entity_id in(select id from dartflow_private.platform_entities where owner_id=any($1::uuid[]))',[people]);await admin.query('delete from dartflow_private.platform_entities where owner_id=any($1::uuid[])',[people]);
  await admin.query('delete from dartflow_private.events where id=any($1::uuid[])',[events]);await admin.query('delete from dartflow_private.club_memberships where club_id=$1',[club]);await admin.query('delete from dartflow_private.clubs where id=$1',[club]);
  await admin.query('delete from dartflow_private.platform_roles where user_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);await admin.end();await closeDatabase();
 }
});
