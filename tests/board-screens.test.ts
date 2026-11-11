import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';
import {boardScreenCookiePath,createBoardScreenDevice,getBoardScreen,listBoardScreenDevices,pairBoardScreenDevice,revokeBoardScreenDevice} from '../lib/board-screens';
import {closeDatabase,database,executeEventCommand,executeMatchCommand,getMatch} from '../lib/db';
import {executePlatformCommand} from '../lib/platform';
import type {MatchAction} from '../lib/types';
import type {PlatformCommand} from '../lib/platform-types';
try{process.loadEnvFile('.env.local');}catch{/* CI supplies its loopback fixture. */}
const loopback=(value:string|undefined)=>{try{return Boolean(value&&['127.0.0.1','localhost','[::1]'].includes(new URL(value).hostname));}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);

test('fixed board displays isolate durable read-only devices, lifecycle snapshots and current manager authority',{skip:!configured},async t=>{
 const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
 const manager=randomUUID(),p1=randomUUID(),p2=randomUUID(),outsider=randomUUID(),people=[manager,p1,p2,outsider];
 const club=randomUUID(),event=randomUUID(),publicEvent=randomUUID(),board=randomUUID(),board2=randomUUID(),publicBoard=randomUUID(),boards=[board,board2,publicBoard],events=[event,publicEvent];
 const run=(actor:string,action:PlatformCommand['action'],expectedRevision?:number)=>executePlatformCommand(actor,{requestId:randomUUID(),action,...(expectedRevision===undefined?{}:{expectedRevision})});
 let token='';
 try{
  for(const [index,id] of people.entries())await owner.query('insert into dartflow_private.profiles(id,name) values($1,$2)',[id,`Board screen fixture ${index}`]);
  await owner.query('insert into dartflow_private.clubs(id,name) values($1,$2)',[club,'Private screen fixture club']);
  for(const id of [manager,p1,p2])await owner.query('insert into dartflow_private.club_memberships(club_id,user_id,role) values($1,$2,$3)',[club,id,id===manager?'organizer':'player']);
  for(const id of events){await owner.query('insert into dartflow_private.events(id,club_id,name,date,capacity) values($1,$2,$3,current_date,8)',[id,club,'Private screen fixture event']);await owner.query('insert into dartflow_private.event_staff(event_id,user_id) values($1,$2)',[id,manager]);}
  for(const [index,id] of boards.entries())await owner.query('insert into dartflow_private.boards(id,event_id,name) values($1,$2,$3)',[id,id===publicBoard?publicEvent:event,`Baan ${index+1}`]);
  await owner.query("insert into dartflow_private.club_boards(board_id,club_id,event_id,name,access,created_by) values($1,$2,$3,'Baan 3','club',$4)",[publicBoard,club,publicEvent,manager]);
  await t.test('existing club-only playing admission retains its anonymous public display contract',async()=>{
   assert.equal((await getBoardScreen(publicBoard)).status,'available');
   assert.equal((await getBoardScreen(publicBoard)).board.access,'club');
   await assert.rejects(getBoardScreen(board),{status:403,code:'screen_pairing_required'});
   await assert.rejects(getBoardScreen(board,'invalid'),{status:403,code:'screen_pairing_required'});
   await assert.rejects(getBoardScreen(randomUUID()),{status:404});
  });
  await t.test('only the current event manager creates and lists pairing codes; storage and projections contain no raw secret',async()=>{
   await assert.rejects(createBoardScreenDevice(p1,board),{status:403});await assert.rejects(listBoardScreenDevices(outsider,board),{status:403});
   await assert.rejects(createBoardScreenDevice(manager,board,'   '),{code:'device_name'});
   const created=await createBoardScreenDevice(manager,board,'  Tablet   aan de muur  ');
   assert.match(created.pairing.code,/^[A-F0-9]{12}$/);assert.equal(created.device.name,'Tablet aan de muur');assert.equal(created.device.paired,false);
   assert.equal(created.pairing.screenUrl,`/baanscherm/${board}`);
   const stored=(await owner.query('select pairing_hash,token_hash from dartflow_private.board_screen_devices where id=$1',[created.device.id])).rows[0];
   assert.equal(stored.pairing_hash,createHash('sha256').update(created.pairing.code).digest('hex'));assert.equal(stored.token_hash,null);
   const paired=await pairBoardScreenDevice(board,created.pairing.code.toLowerCase().replace(/(.{4})(?=.)/g,'$1-'));
   token=paired.token;assert.match(token,/^[A-Za-z0-9_-]{43}$/);assert.equal(paired.maxAge,365*24*60*60);
   const storedPaired=(await owner.query('select pairing_hash,token_hash from dartflow_private.board_screen_devices where id=$1',[created.device.id])).rows[0];
   assert.equal(storedPaired.pairing_hash,null);assert.equal(storedPaired.token_hash,createHash('sha256').update(token).digest('hex'));
   assert.equal((await listBoardScreenDevices(manager,board)).devices[0].paired,true);
   const view=JSON.stringify(await getBoardScreen(board,token));assert.equal(view.includes(token),false);assert.equal(view.includes(manager),false);assert.equal(view.includes(club),false);
   const listed=JSON.stringify(await listBoardScreenDevices(manager,board));assert.equal(listed.includes(token),false);assert.equal(listed.includes(created.pairing.code),false);assert.equal(listed.includes('hash'),false);
   assert.equal(boardScreenCookiePath(board),`/api/board-screens/${board}`);
   await assert.rejects(pairBoardScreenDevice(board,created.pairing.code),{code:'invalid_pairing'});
  });
  await t.test('one-use pairing serializes simultaneous claims and a device is valid on its exact board only',async()=>{
   const created=await createBoardScreenDevice(manager,board2);
   const claims=await Promise.allSettled([pairBoardScreenDevice(board2,created.pairing.code),pairBoardScreenDevice(board2,created.pairing.code)]);
   assert.equal(claims.filter(result=>result.status==='fulfilled').length,1);assert.equal(claims.filter(result=>result.status==='rejected').length,1);
   const claimed=claims.find(result=>result.status==='fulfilled');assert.ok(claimed?.status==='fulfilled');
   assert.equal((await getBoardScreen(board2,claimed.value.token)).status,'available');
   await assert.rejects(getBoardScreen(board2,token),{code:'screen_pairing_required'});await assert.rejects(getBoardScreen(board,claimed.value.token),{code:'screen_pairing_required'});
  });
  await t.test('the same fixed screen follows live score, release, a new match and solo without leaking internal state',async()=>{
   for(const id of [p1,p2]){await executeEventCommand(id,event,{type:'register'});await executeEventCommand(id,event,{type:'check-in'});}
   const start=async()=>{
    const planned=await executeEventCommand(manager,event,{type:'plan',playerIds:[p1,p2],settings:{startScore:301,bestOfLegs:1}});let match=await getMatch(p1,planned.matchId!);
    const send=async(actor:string,action:MatchAction)=>match=await executeMatchCommand(actor,{requestId:randomUUID(),matchId:match.id,expectedRevision:match.revision,action});
    await send(manager,{type:'call',boardId:board});await send(p1,{type:'accept'});await send(p2,{type:'accept'});await send(p1,{type:'start'});return {send,get:()=>match};
   };
   const first=await start();await first.send(p1,{type:'score',score:180});
   await owner.query("update dartflow_private.matches set state=jsonb_set(jsonb_set(jsonb_set(state,'{privateNote}','\"screen-fixture-private\"'),'{players,0,email}','\"private@example.test\"'),'{settings,secret}','\"screen-fixture-private\"') where id=$1",[first.get().id]);
   const live=await getBoardScreen(board,token);assert.equal(live.snapshot.match?.remaining[0],121);assert.equal(live.snapshot.match?.id,`board-${board}`);
   const serialized=JSON.stringify(live);for(const secret of [...people,event,club,first.get().id,'screen-fixture-private','private@example.test'])assert.equal(serialized.includes(secret),false);
   await assert.rejects(getBoardScreen(board2),{code:'screen_pairing_required'});
   await first.send(p1,{type:'score',score:0});await first.send(p1,{type:'score',score:121,doubleConfirmed:true});await first.send(p1,{type:'confirm'});await first.send(p2,{type:'confirm'});await first.send(manager,{type:'release'});
   assert.equal((await getBoardScreen(board,token)).status,'available');assert.equal((await getBoardScreen(board,token)).snapshot.match,null);
   await owner.query('update dartflow_private.boards set name=$2 where id=$1',[board,'Hernoemde Baan 1']);
   const second=await start();assert.notEqual(second.get().id,first.get().id);
   const newGame=await getBoardScreen(board,token);assert.equal(newGame.board.name,'Hernoemde Baan 1');assert.equal(newGame.board.screenUrl,live.board.screenUrl);assert.deepEqual(newGame.snapshot.match?.remaining,[301,301]);
   await second.send(p1,{type:'score',score:180});await second.send(p1,{type:'score',score:0});await second.send(p1,{type:'score',score:121,doubleConfirmed:true});await second.send(p1,{type:'confirm'});await second.send(p2,{type:'confirm'});await second.send(manager,{type:'release'});
   const training=await run(p1,{type:'board.start',boardId:board,mode:'solo'});assert.equal((await getBoardScreen(board,token)).snapshot.match?.players.length,1);
   const scored=await run(p1,{type:'training.score',id:training.id,score:60},training.entity!.revision);assert.equal((await getBoardScreen(board,token)).snapshot.match?.remaining[0],441);
   await run(p1,{type:'training.finish',id:training.id},scored.entity!.revision);assert.equal((await getBoardScreen(board,token)).status,'available');
  });
  await t.test('natural solo checkout atomically frees the fixed screen and stale undo or score replay cannot reclaim a new session',async()=>{
   const training=await run(p1,{type:'board.start',boardId:board,mode:'solo',startScore:301});
   const first=await run(p1,{type:'training.score',id:training.id,score:180},training.entity!.revision);
   assert.equal((await getBoardScreen(board,token)).snapshot.match?.remaining[0],121);
   const finalCommand={requestId:randomUUID(),expectedRevision:first.entity!.revision,action:{type:'training.score',id:training.id,score:121,doubleConfirmed:true}};
   const finished=await executePlatformCommand(p1,finalCommand);
   assert.equal(finished.entity!.state.completed,true);assert.equal(finished.entity!.state.game?.remaining[0],0);
   assert.equal(finished.entity!.state.boardHeld,false);assert.equal(finished.entity!.state.boardLeaseUntil,0);
   assert.equal((await getBoardScreen(board,token)).status,'available');assert.equal((await getBoardScreen(board,token)).snapshot.match,null);
   await assert.rejects(run(p1,{type:'training.undo',id:training.id},finished.entity!.revision),{code:'board_session_expired',status:409});
   const next=await run(p2,{type:'board.start',boardId:board,mode:'solo',startScore:301});
   assert.equal((await getBoardScreen(board,token)).snapshot.match?.players[0].name,'Board screen fixture 2');
   const replayed=await executePlatformCommand(p1,finalCommand);assert.equal(replayed.entity!.revision,finished.entity!.revision);
   await assert.rejects(run(p1,{type:'training.undo',id:training.id},finished.entity!.revision),{code:'board_session_expired',status:409});
   const stored=(await owner.query('select state from dartflow_private.platform_entities where id=$1',[training.id])).rows[0].state;
   assert.equal(stored.completed,true);assert.equal(stored.boardHeld,false);assert.equal(stored.game.remaining[0],0);assert.equal(stored.game.visits.length,2);assert.equal(stored.undo.length,2);
   assert.equal((await getBoardScreen(board,token)).snapshot.match?.remaining[0],301);
   assert.equal((await owner.query('select state->>\'boardHeld\' as held from dartflow_private.platform_entities where id=$1',[next.id])).rows[0].held,'true');
   await run(p2,{type:'training.finish',id:next.id},next.entity!.revision);
   const lobby=await run(p1,{type:'board.start',boardId:board,mode:'local',startScore:301});assert.equal((await getBoardScreen(board,token)).status,'waiting');
   await run(p1,{type:'lobby.cancel',id:lobby.id});assert.equal((await getBoardScreen(board,token)).status,'available');
  });
  await t.test('completed training without a physical board retains its existing undo behavior',async()=>{
   const training=await run(p1,{type:'training.create',mode:'solo',startScore:301});
   const first=await run(p1,{type:'training.score',id:training.id,score:180},training.entity!.revision);
   const finished=await run(p1,{type:'training.score',id:training.id,score:121,doubleConfirmed:true},first.entity!.revision);assert.equal(finished.entity!.state.completed,true);
   const restored=await run(p1,{type:'training.undo',id:training.id},finished.entity!.revision);
   assert.equal(restored.entity!.state.completed,false);assert.equal(restored.entity!.state.game?.remaining[0],121);
   await run(p1,{type:'training.finish',id:training.id},restored.entity!.revision);
  });
  await t.test('revocation and expiry reject a paired device, and a removed manager cannot leave device authority behind',async()=>{
   const created=await createBoardScreenDevice(manager,board);const paired=await pairBoardScreenDevice(board,created.pairing.code);
   await assert.rejects(revokeBoardScreenDevice(p1,board,created.device.id),{status:403});await assert.rejects(revokeBoardScreenDevice(manager,board2,created.device.id),{status:404});
   await revokeBoardScreenDevice(manager,board,created.device.id);await assert.rejects(getBoardScreen(board,paired.token),{code:'screen_pairing_required'});
   assert.equal((await listBoardScreenDevices(manager,board)).devices.find(device=>device.id===created.device.id)?.revoked,true);
   const expiring=await createBoardScreenDevice(manager,board);const expiredToken=await pairBoardScreenDevice(board,expiring.pairing.code);
   await owner.query("update dartflow_private.board_screen_devices set expires_at=now()-interval '1 second' where id=$1",[expiring.device.id]);await assert.rejects(getBoardScreen(board,expiredToken.token),{code:'screen_pairing_required'});
   const pending=await createBoardScreenDevice(manager,board);
   await owner.query('delete from dartflow_private.event_staff where event_id=$1 and user_id=$2',[event,manager]);
   await assert.rejects(getBoardScreen(board,token),{code:'screen_pairing_required'});await assert.rejects(pairBoardScreenDevice(board,pending.pairing.code),{code:'invalid_pairing'});
   await owner.query('insert into dartflow_private.event_staff(event_id,user_id) values($1,$2)',[event,manager]);
   const timed=await createBoardScreenDevice(manager,board);await owner.query("update dartflow_private.board_screen_devices set pairing_expires_at=now()-interval '1 second' where id=$1",[timed.device.id]);await assert.rejects(pairBoardScreenDevice(board,timed.pairing.code),{code:'invalid_pairing'});
  });
  await t.test('a queued creation rechecks manager rights after waiting for an event mutation',async()=>{
   await owner.query('begin');await owner.query('select id from dartflow_private.events where id=$1 for update',[event]);
   const pending=Promise.allSettled([createBoardScreenDevice(manager,board,'Queued screen')]);
   let blocked=false;
   try{
    for(let attempt=0;attempt<100&&!blocked;attempt++){await owner.query('select pg_stat_clear_snapshot()');blocked=Boolean((await owner.query("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query='select id from dartflow_private.events where id=$1 for update') as waiting")).rows[0].waiting);if(!blocked)await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(blocked,true);await owner.query('delete from dartflow_private.event_staff where event_id=$1 and user_id=$2',[event,manager]);await owner.query('commit');
   }finally{await owner.query('rollback');}
   const result=(await pending)[0];assert.equal(result.status,'rejected');assert.equal(result.status==='rejected'?result.reason.status:null,403);
   await owner.query('insert into dartflow_private.event_staff(event_id,user_id) values($1,$2)',[event,manager]);
  });
  await t.test('failed guesses consume durable limits even though no device transaction commits',async()=>{
   const created=await createBoardScreenDevice(manager,board2);await owner.query('delete from dartflow_private.auth_limits where key=$1',[`board-screen-pair:${board2}`]);
   for(let i=0;i<20;i++)await assert.rejects(pairBoardScreenDevice(board2,'invalid'),{code:'invalid_pairing'});
   await assert.rejects(pairBoardScreenDevice(board2,created.pairing.code),{code:'rate_limited',status:429});
   assert.equal((await owner.query('select count from dartflow_private.auth_limits where key=$1',[`board-screen-pair:${board2}`])).rows[0].count,21);
  });
  await t.test('device storage remains private with RLS and narrow runtime update grants',async()=>{
   const rls=(await owner.query("select relrowsecurity from pg_class where oid='dartflow_private.board_screen_devices'::regclass")).rows[0].relrowsecurity;assert.equal(rls,true);
   const privileges=(await database().query("select has_table_privilege(current_user,'dartflow_private.board_screen_devices','DELETE') as delete_allowed,has_column_privilege(current_user,'dartflow_private.board_screen_devices','created_by','UPDATE') as issuer_update,has_column_privilege(current_user,'dartflow_private.board_screen_devices','token_hash','UPDATE') as token_update")).rows[0];
   assert.deepEqual(privileges,{delete_allowed:false,issuer_update:false,token_update:true});
  });
 }finally{
  await owner.query('rollback');
  const matches=(await owner.query('select id from dartflow_private.matches where event_id=any($1::uuid[])',[events])).rows.map(row=>row.id);
  const entities=(await owner.query('select id from dartflow_private.platform_entities where owner_id=any($1::uuid[])',[people])).rows.map(row=>row.id);
  const jobs=(await owner.query('select id from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people])).rows.map(row=>row.id);
  await owner.query('delete from dartflow_private.mail_provider_events where job_id=any($1::uuid[])',[jobs]);await owner.query('delete from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.mail_events where recipient_key=any($1::text[])',[people.map(id=>`user:${id}`)]);
  for(const table of ['platform_signals','platform_match_links','action_receipts','match_confirmations','visits','match_results','match_players'])await owner.query(`delete from dartflow_private.${table} where match_id=any($1::uuid[])`,[matches]);
  await owner.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.platform_entities where id=any($1::uuid[])',[entities]);
  for(const table of ['audit_events','board_screen_devices','screen_capabilities','matches','standings','entries','event_staff'])await owner.query(`delete from dartflow_private.${table} where event_id=any($1::uuid[])`,[events]);
  await owner.query('delete from dartflow_private.club_boards where board_id=$1',[publicBoard]);await owner.query('delete from dartflow_private.boards where id=any($1::uuid[])',[boards]);await owner.query('delete from dartflow_private.events where id=any($1::uuid[])',[events]);
  await owner.query('delete from dartflow_private.club_memberships where club_id=$1',[club]);await owner.query('delete from dartflow_private.clubs where id=$1',[club]);await owner.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);
  await owner.query('delete from dartflow_private.auth_limits where key=any($1::text[])',[boards.map(id=>`board-screen-pair:${id}`)]);await owner.end();await closeDatabase();
 }
});
