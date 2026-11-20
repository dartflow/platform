import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import pg from 'pg';
import {closeDatabase,executeMatchCommand,getMatch,getProfile} from '../lib/db';
import {executePlatformCommand,getPlatformOverview} from '../lib/platform';
import {entity,transaction} from '../lib/platform-store';
import type {PlatformCommand} from '../lib/platform-types';
import {getPlayerPinStatus,limitPlayerPinAttempts,playerPinVerifier,preparePlayerPinUpdate,savePreparedPlayerPin,updatePlayerPin,verifyPlayerPin} from '../lib/player-pin';
import {addLocalLobbyPlayer} from '../lib/player-pin-lobby';
import type {MatchAction} from '../lib/types';

try{process.loadEnvFile('.env.local');}catch{/* Local fixtures only. */}
const loopback=(value:string|undefined)=>{try{return Boolean(value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname));}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);

test('private player PIN lifecycle and atomic one-phone local coupling',{skip:!configured},async t=>{
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();
 const suffix=randomUUID().slice(0,8),people=Array.from({length:4},()=>randomUUID()),[first,second,third,outsider]=people;
 const names=people.map((_,i)=>`Pin${i}-${suffix}`),club=randomUUID(),event=randomUUID(),board=randomUUID(),location=randomUUID();
 const envNames=['DARTFLOW_PLAYER_PIN_PEPPERS','DARTFLOW_PLAYER_PIN_PEPPER_VERSION','DARTFLOW_PLAYER_PIN_MEMORY_KIB','DARTFLOW_PLAYER_PIN_PASSES','DARTFLOW_PLAYER_PIN_ACTOR_LIMIT','DARTFLOW_PLAYER_PIN_TARGET_LIMIT','DARTFLOW_PLAYER_PIN_GLOBAL_LIMIT','DARTFLOW_PLAYER_PIN_WINDOW_SECONDS'];
 const previous=envNames.map(key=>process.env[key]);const originalLimits=(await admin.query("select key,count,reset_at from dartflow_private.auth_limits where key like 'pin:%'")).rows;
 process.env.DARTFLOW_PLAYER_PIN_PEPPERS=`test:${Buffer.alloc(32,113).toString('base64')}`;process.env.DARTFLOW_PLAYER_PIN_PEPPER_VERSION='test';
 process.env.DARTFLOW_PLAYER_PIN_MEMORY_KIB='19456';process.env.DARTFLOW_PLAYER_PIN_PASSES='2';process.env.DARTFLOW_PLAYER_PIN_ACTOR_LIMIT='100';process.env.DARTFLOW_PLAYER_PIN_TARGET_LIMIT='50';process.env.DARTFLOW_PLAYER_PIN_GLOBAL_LIMIT='1000';
 const run=(actor:string,action:Record<string,unknown>)=>executePlatformCommand(actor,{requestId:randomUUID(),action:action as PlatformCommand['action']});
 const setPin=(actor:string,pin:string,mode='initial',currentPin?:string,recentAuth=false)=>updatePlayerPin(actor,{requestId:randomUUID(),pin,pinConfirmation:pin,mode,currentPin},{recentAuth});
 const lobbies:string[]=[],matches:string[]=[];
 const create=async(settings:Record<string,unknown>={})=>{const created=await run(first,{type:'board.start',boardId:board,mode:'local',startScore:301,bestOfLegs:1,...settings});lobbies.push(created.id!);return created;};
 const add=(lobbyId:string,username=names[1],pin:unknown='012345',requestId=randomUUID(),actor=first,expectedRevision?:number)=>addLocalLobbyPlayer(actor,{lobbyId,username,pin,requestId,expectedRevision});
 const cancel=async(id:string)=>{await run(first,{type:'lobby.cancel',id});};
 try{
  for(const[index,id]of people.entries())await admin.query('insert into dartflow_private.profiles(id,name,display_name_confirmed) values($1,$2,true)',[id,names[index]]);
  await admin.query('insert into dartflow_private.clubs(id,name) values($1,$2)',[club,`PIN fixtures ${suffix}`]);
  for(const id of people)await admin.query("insert into dartflow_private.club_memberships(club_id,user_id,role) values($1,$2,'player')",[club,id]);
  await admin.query('insert into dartflow_private.events(id,club_id,name,date,capacity) values($1,$2,$3,current_date,8)',[event,club,`PIN event ${suffix}`]);
  await admin.query('insert into dartflow_private.boards(id,event_id,name) values($1,$2,$3)',[board,event,`PIN board ${suffix}`]);
  await admin.query("insert into dartflow_private.locations(id,owner_id,kind,name) values($1,$2,'venue',$3)",[location,first,`PIN venue ${suffix}`]);
  await admin.query('insert into dartflow_private.location_boards(board_id,location_id,home_event_id,reservation_enabled) values($1,$2,$3,true)',[board,location,event]);
  await t.test('missing status, leading-zero setup, private storage, safe repeat and immutable existing account',async()=>{
   assert.deepEqual(await getPlayerPinStatus(second),{pinConfigured:false});const before=await getProfile(second);
   const input={requestId:randomUUID(),pin:'012345',pinConfirmation:'012345',mode:'initial'};
   assert.deepEqual(await updatePlayerPin(second,input,{recentAuth:false}),{ok:true,pinConfigured:true});await updatePlayerPin(second,input,{recentAuth:false});
   assert.deepEqual(await getPlayerPinStatus(second),{pinConfigured:true});const after=await getProfile(second);assert.equal(after.id,before.id);assert.equal(after.name,before.name);assert.equal(after.displayNameConfirmed,before.displayNameConfirmed);
   const row=await playerPinVerifier(second);assert.ok(row);assert.equal(row.verifier.includes('012345'),false);assert.equal(await verifyPlayerPin('012345',row),true);assert.equal(await verifyPlayerPin('12345',row),false);
   assert.equal((await admin.query('select version from dartflow_private.player_pin_verifiers where user_id=$1',[second])).rows[0].version,1);
   const publicResult=JSON.stringify(await getPlatformOverview(second));assert.equal(publicResult.includes(row.verifier),false);assert.equal(publicResult.includes(row.salt),false);
   const rls=(await admin.query("select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='dartflow_private' and c.relname='player_pin_verifiers'")).rows[0];assert.equal(rls.relrowsecurity,true);
   assert.equal((await admin.query("select exists(select 1 from information_schema.table_privileges where table_schema='dartflow_private' and table_name='player_pin_verifiers' and grantee='PUBLIC' and privilege_type='SELECT') allowed")).rows[0].allowed,false);
  });
  await t.test('failed profile save rolls PIN back and the same prepared update can safely retry',async()=>{
   const prepared=await preparePlayerPinUpdate(third,{requestId:randomUUID(),pin:'065432',pinConfirmation:'065432'},{recentAuth:false});
   await assert.rejects(transaction(async client=>{await savePreparedPlayerPin(client,third,prepared);throw new Error('simulated profile failure');}),/simulated profile failure/);
   assert.deepEqual(await getPlayerPinStatus(third),{pinConfigured:false});await transaction(client=>savePreparedPlayerPin(client,third,prepared));assert.deepEqual(await getPlayerPinStatus(third),{pinConfigured:true});
  });
  await t.test('change and recent verified reset invalidate the old PIN immediately',async()=>{
   await assert.rejects(setPin(second,'012346','change','999999'),{code:'player_pin_invalid'});
   await setPin(second,'012346','change','012345');assert.equal(await verifyPlayerPin('012345',await playerPinVerifier(second)),false);
   await assert.rejects(setPin(second,'012345','reset',undefined,false),{code:'player_pin_reauth'});
   await setPin(second,'012345','reset',undefined,true);assert.equal(await verifyPlayerPin('012346',await playerPinVerifier(second)),false);
  });
  await t.test('unknown username, missing PIN and incorrect PIN share verification feedback',async()=>{
   const lobby=await create();
   for(const[username,pin]of [[`Unknown-${suffix}`,'012345'],[names[3],'012345'],[names[1],'999999'],[`@@${names[1]}`,'012345']])await assert.rejects(add(lobby.id!,username,pin),{code:'player_pin_invalid',message:'Gebruikersnaam of spelerspincode klopt niet.',status:403});
   assert.equal((await transaction(client=>entity(client,lobby.id!))).revision,lobby.entity!.revision);await cancel(lobby.id!);
  });
  await t.test('wrong owner, full lobby, self, expired lease and revision reject without new grant',async()=>{
   await setPin(first,'001122');let lobby=await create();
   await assert.rejects(add(lobby.id!,names[1],'012345',randomUUID(),outsider),{code:'forbidden'});
   await assert.rejects(add(lobby.id!,names[0],'001122'),{code:'same_player'});
   await assert.rejects(add(lobby.id!,names[1],'012345',randomUUID(),first,99),{code:'revision_conflict'});
   await admin.query("update dartflow_private.platform_entities set state=jsonb_set(state,'{boardLeaseUntil}','0') where id=$1",[lobby.id]);
   await assert.rejects(add(lobby.id!),{code:'board_session_expired'});await admin.query("update dartflow_private.platform_entities set state=jsonb_set(state,'{boardLeaseUntil}',to_jsonb($2::bigint)) where id=$1",[lobby.id,Date.now()+120000]);await cancel(lobby.id!);lobby=await create();
   await run(third,{type:'lobby.join',id:lobby.id,boardId:board});await assert.rejects(add(lobby.id!),{code:'lobby_full'});await cancel(lobby.id!);
  });
  await t.test('target blocking and stale PIN version are rejected transactionally',async()=>{
   const lobby=await create();await run(first,{type:'friend.block',userId:second});await assert.rejects(add(lobby.id!),{code:'player_pin_invalid'});await run(first,{type:'friend.unblock',userId:second});
   const prepared=await preparePlayerPinUpdate(second,{requestId:randomUUID(),pin:'032145',pinConfirmation:'032145',currentPin:'012345',mode:'change'},{recentAuth:false});
   await setPin(second,'012347','change','012345');await assert.rejects(transaction(client=>savePreparedPlayerPin(client,second,prepared)),{code:'player_pin_changed'});await setPin(second,'012345','change','012347');await cancel(lobby.id!);
  });
  await t.test('a PIN version changed after KDF verification cannot claim the lobby seat',async()=>{
   const lobby=await create(),key=`player-pin:${second}`;
   await admin.query('begin');await admin.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
   const pending=add(lobby.id!).then(value=>({value,error:null}),error=>({value:null,error}));
   try{
    let waiting=false;
    for(let i=0;i<150&&!waiting;i++){
     waiting=(await admin.query<{waiting:boolean}>(`select exists(select 1 from pg_locks where locktype='advisory' and not granted
      and classid::bigint=((hashtextextended($1,0)>>32)&4294967295) and objid::bigint=(hashtextextended($1,0)&4294967295)) as waiting`,[key])).rows[0].waiting;
     if(!waiting)await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal(waiting,true,'coupling must have finished verification before the version changes');
    await admin.query('update dartflow_private.player_pin_verifiers set version=version+1 where user_id=$1',[second]);await admin.query('commit');
   }finally{await admin.query('rollback');}
   const outcome=await pending;assert.equal(outcome.error?.code,'player_pin_invalid');assert.equal(outcome.value,null);
   assert.equal((await admin.query("select count(*)::int as n from dartflow_private.platform_members where entity_id=$1 and status='active'",[lobby.id])).rows[0].n,1);await cancel(lobby.id!);
  });
  await t.test('persistent KDF leases cap expensive concurrent work before verification',async()=>{
   const ids=Array.from({length:4},()=>randomUUID());
   try{
    for(const id of ids)await admin.query("insert into dartflow_private.player_pin_kdf_leases(id,expires_at) values($1,clock_timestamp()+interval '1 minute')",[id]);
    await assert.rejects(verifyPlayerPin('012345',await playerPinVerifier(second)),{code:'player_pin_cooldown',status:429});
   }finally{await admin.query('delete from dartflow_private.player_pin_kdf_leases where id=any($1::uuid[])',[ids]);}
  });
  await t.test('persistent target cooldown precedes KDF and recovers after its window',async()=>{
   const target=`isolated-${suffix}`;process.env.DARTFLOW_PLAYER_PIN_TARGET_LIMIT='2';process.env.DARTFLOW_PLAYER_PIN_WINDOW_SECONDS='30';
   await limitPlayerPinAttempts(first,target);await limitPlayerPinAttempts(third,target);await assert.rejects(limitPlayerPinAttempts(outsider,target),{code:'player_pin_cooldown',status:429});
   await admin.query("update dartflow_private.auth_limits set reset_at=clock_timestamp()-interval '1 second' where key like 'pin:link:target:%'");await limitPlayerPinAttempts(outsider,target);
   process.env.DARTFLOW_PLAYER_PIN_TARGET_LIMIT='50';delete process.env.DARTFLOW_PLAYER_PIN_WINDOW_SECONDS;
  });
  await t.test('database-canonical Unicode keys share one target cooldown and one successful receipt across casing and leading @',async()=>{
   for(const stem of ['ΟΣ\u1C89','\u1C89Σ','ΟΣ\u{10D50}','ΟΣ\u{16EA0}']){
    const username=`${stem}-${suffix}`,canonical=(await admin.query<{key:string}>('select dartflow_private.username_key($1) as key',[username])).rows[0].key;
    assert.notEqual(username.toLocaleLowerCase('nl'),canonical);
    const unicodeTarget=randomUUID();people.push(unicodeTarget);await admin.query('insert into dartflow_private.profiles(id,name,display_name_confirmed)values($1,$2,true)',[unicodeTarget,username]);await admin.query("insert into dartflow_private.club_memberships(club_id,user_id,role)values($1,$2,'player')",[club,unicodeTarget]);await setPin(unicodeTarget,'012345');
    const lobby=await create();process.env.DARTFLOW_PLAYER_PIN_TARGET_LIMIT='2';
    const targetBucket=`pin:link:target:${createHmac('sha256',Buffer.alloc(32,113)).update('dartflow-player-pin:').update(canonical).digest('hex')}`;
    try{
     await assert.rejects(add(lobby.id!,username,'999999'),{code:'player_pin_invalid'});
     await assert.rejects(add(lobby.id!,canonical,'999999'),{code:'player_pin_invalid'});
     await assert.rejects(add(lobby.id!,`@${canonical}`,'999999'),{code:'player_pin_cooldown',status:429});
     assert.equal((await admin.query('select count(*)::int n from dartflow_private.auth_limits where key=$1',[targetBucket])).rows[0].n,1);
     await admin.query("update dartflow_private.auth_limits set reset_at=clock_timestamp()-interval '1 second' where key=$1",[targetBucket]);
     process.env.DARTFLOW_PLAYER_PIN_TARGET_LIMIT='50';
     const requestId=randomUUID(),accepted=await add(lobby.id!,username,'012345',requestId),retry=await add(lobby.id!,`@${canonical}`,'',requestId);
     assert.equal(accepted.entity!.members.find(p=>p.id===unicodeTarget)?.status,'active');assert.equal(retry.id,accepted.id);
     assert.equal((await admin.query("select count(*)::int n from dartflow_private.player_pin_receipts where actor_id=$1 and request_id=$2 and kind='lobby-add'",[first,requestId])).rows[0].n,1);
    }finally{process.env.DARTFLOW_PLAYER_PIN_TARGET_LIMIT='50';await cancel(lobby.id!);}
   }
  });
  await t.test('PIN and normal QR scan race for one second seat, and successful empty-PIN retry restores the lobby',async()=>{
   const lobby=await create(),requestId=randomUUID();
   const outcomes=await Promise.allSettled([add(lobby.id!,names[1],'012345',requestId),run(third,{type:'lobby.join',id:lobby.id,boardId:board})]);assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
   const members=(await admin.query("select user_id from dartflow_private.platform_members where entity_id=$1 and status='active'",[lobby.id])).rows;assert.equal(members.length,2);
   if(outcomes[0].status==='fulfilled'){const retry=await add(lobby.id!,names[1],'',requestId);assert.equal(retry.entity!.members.find(p=>p.id===second)?.status,'active');}
   await cancel(lobby.id!);
  });
  await t.test('simultaneous retries of one successful PIN request return the same current lobby',async()=>{
   const lobby=await create(),requestId=randomUUID(),results=await Promise.all([add(lobby.id!,names[1],'012345',requestId),add(lobby.id!,names[1],'012345',requestId)]);
   assert.equal(results[0].id,lobby.id);assert.equal(results[1].id,lobby.id);assert.equal(results[0].entity!.revision,results[1].entity!.revision);
   assert.equal((await admin.query("select count(*)::int as n from dartflow_private.player_pin_receipts where actor_id=$1 and request_id=$2 and kind='lobby-add'",[first,requestId])).rows[0].n,1);
   await cancel(lobby.id!);
  });
  await t.test('PIN fields on the generic command endpoint never create command receipts',async()=>{
   for(const action of [{type:'profile.update',name:names[0],pin:'012345'},{type:'room.create',name:'Probe',unknown:{playerPin:'012345'}}]){
    const requestId=randomUUID();await assert.rejects(executePlatformCommand(first,{requestId,action}),{code:'private_field'});
    assert.equal((await admin.query('select count(*)::int as n from dartflow_private.platform_receipts where actor_id=$1 and request_id=$2',[first,requestId])).rows[0].n,0);
   }
  });
  await t.test('one phone writes both turns and publishes one shared result for the original stable accounts',async()=>{
   const lobby=await create(),requestId=randomUUID(),response=await add(lobby.id!,`@${names[1].toUpperCase()}`,'012345',requestId,first,lobby.entity!.revision);
   assert.equal(response.entity!.members.find(p=>p.id===second)?.attributes.pinLinkedBy,first);
   assert.equal(JSON.stringify(response).includes('012345'),false);assert.equal(JSON.stringify(response).includes('verifier'),false);
   await add(lobby.id!,`@${names[1].toUpperCase()}`,'',requestId);
   await run(first,{type:'lobby.starter',id:lobby.id,starterId:first});
   await run(first,{type:'lobby.ready',id:lobby.id});const started=await run(first,{type:'lobby.start',id:lobby.id});const matchId=started.matchId!;matches.push(matchId);
   let match=await getMatch(first,matchId);assert.equal(match.localCompanion!.playerId,second);assert.equal(match.accepted[1],true);assert.equal(match.writerId,first);
   const send=async(action:MatchAction)=>{match=await executeMatchCommand(first,{requestId:randomUUID(),matchId,expectedRevision:match.revision,action});};
   await send({type:'accept'});await send({type:'start'});
   for(const action of [{type:'score' as const,score:60,pin:'012345'},{type:'score' as const,score:60,metadata:{currentPin:'012345'}}]){
    const requestId=randomUUID();await assert.rejects(executeMatchCommand(first,{requestId,matchId,expectedRevision:match.revision,action}),{code:'private_field'});
    assert.equal((await admin.query('select count(*)::int as n from dartflow_private.action_receipts where match_id=$1 and actor_id=$2 and request_id=$3',[matchId,first,requestId])).rows[0].n,0);
    assert.equal((await getMatch(first,matchId)).revision,match.revision);
   }
   await send({type:'score',score:180});await send({type:'score',score:60});await send({type:'score',score:121,doubleConfirmed:true,darts:3});
   assert.equal(match.status,'result');assert.equal(match.visits[1].player,second);await send({type:'confirm'});assert.equal(match.status,'confirmed');assert.deepEqual(match.confirmations,[true,true]);
   assert.equal((await admin.query('select count(*)::int as n from dartflow_private.match_results where match_id=$1',[matchId])).rows[0].n,1);
   for(const id of [first,second])assert.equal((await getPlatformOverview(id)).history.filter(item=>item.matchId===matchId).length,1);
   await assert.rejects(add(lobby.id!,names[2],'065432'),{code:'lobby_started'});
  });

  await t.test('real PIN-linked local companion has a separate explicit bull signature without granting remote or organizer impersonation',async()=>{
   const lobby=await create({startProcedure:'bull'});await add(lobby.id!,names[1],'012345',randomUUID(),first,lobby.entity!.revision);await run(first,{type:'lobby.ready',id:lobby.id});const started=await run(first,{type:'lobby.start',id:lobby.id}),matchId=started.matchId!;matches.push(matchId);let match=await getMatch(first,matchId);const send=async(action:MatchAction)=>{match=await executeMatchCommand(first,{requestId:randomUUID(),matchId,expectedRevision:match.revision,action});};await send({type:'accept'});await send({type:'bull-throw',hit:'DB'});await send({type:'bull-throw',hit:'outside'});await send({type:'bull-confirm'});assert.deepEqual(match.bull!.confirmed,[true,false]);assert.equal(match.permissions.canBullConfirmCompanion,true);await assert.rejects(executeMatchCommand(outsider,{requestId:randomUUID(),matchId,expectedRevision:match.revision,action:{type:'bull-confirm-companion'}}));await assert.rejects(send({type:'start'}),{code:'start_procedure_pending'});await send({type:'bull-confirm-companion'});assert.deepEqual(match.bull!.confirmed,[true,true]);assert.equal(match.visits.length,0);assert.equal((await admin.query("select count(*)::int n from dartflow_private.audit_events where match_id=$1 and action='bull-confirm-companion'",[matchId])).rows[0].n,1);await send({type:'start'});await send({type:'score',score:180});await send({type:'score',score:60});await send({type:'score',score:121,doubleConfirmed:true,darts:3});await send({type:'confirm'});assert.equal(match.status,'confirmed');assert.equal(match.rankingEligibility?.eligible,false);assert.equal(match.rankingDestinations?.length,0);
  });
 }finally{
  await admin.query('begin');
  try{
   await admin.query('delete from dartflow_private.board_activity_sessions where event_id=$1',[event]);
   for(const table of ['mail_outbox','mail_events'])await admin.query(`delete from dartflow_private.${table} where recipient_key=any($1::text[])`,[people.map(id=>`user:${id}`)]);
   for(const table of ['visits','match_confirmations','match_results','action_receipts','match_players','platform_match_links'])await admin.query(`delete from dartflow_private.${table} where match_id=any($1::uuid[])`,[matches]);
   await admin.query('delete from dartflow_private.audit_events where event_id=$1',[event]);await admin.query('delete from dartflow_private.matches where id=any($1::uuid[])',[matches]);
   await admin.query('delete from dartflow_private.player_pin_receipts where actor_id=any($1::uuid[])',[people]);
   await admin.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])',[people]);
   await admin.query('delete from dartflow_private.invitation_codes where entity_id=any($1::uuid[])',[lobbies]);await admin.query('delete from dartflow_private.platform_entities where id=any($1::uuid[])',[lobbies]);
   await admin.query('delete from dartflow_private.screen_capabilities where event_id=$1',[event]);await admin.query('delete from dartflow_private.entries where event_id=$1',[event]);
   await admin.query('delete from dartflow_private.location_boards where location_id=$1',[location]);await admin.query('delete from dartflow_private.locations where id=$1',[location]);
   await admin.query('delete from dartflow_private.boards where id=$1',[board]);await admin.query('delete from dartflow_private.events where id=$1',[event]);await admin.query('delete from dartflow_private.clubs where id=$1',[club]);await admin.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);
   await admin.query("delete from dartflow_private.auth_limits where key like 'pin:%'");for(const row of originalLimits)await admin.query('insert into dartflow_private.auth_limits(key,count,reset_at) values($1,$2,$3)',[row.key,row.count,row.reset_at]);
   await admin.query('commit');
  }catch(error){await admin.query('rollback');throw error;}finally{envNames.forEach((key,index)=>{if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];});await admin.end();await closeDatabase();}
 }
});
