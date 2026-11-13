import {cleanupFeedFixtures} from './helpers/cleanup-v17';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {getLocationOverview} from '../lib/locations';
import {getBoardScreen,createBoardScreenDevice,pairBoardScreenDevice} from '../lib/board-screens';
import {closeDatabase,database,eventAccess,executeEventCommand,executeMatchCommand,getBoardForActor,getMatch,getOverview} from '../lib/db';
import {executePlatformCommand,reconcilePlatformResults} from '../lib/platform';
import type {PlatformCommand} from '../lib/platform-types';
import type {MatchAction} from '../lib/types';
try{process.loadEnvFile('.env.local');}catch{/* CI supplies its explicit loopback fixture. */}
const loopback=(value:string|undefined)=>{try{return Boolean(value&&['127.0.0.1','localhost','[::1]'].includes(new URL(value).hostname));}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);

test('locations, personal home boards and UTC event reservations have independent authority and atomic capacity',{skip:!configured},async t=>{
 const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
 const venueOwner=randomUUID(),manager=randomUUID(),clubOwner=randomUUID(),p1=randomUUID(),p2=randomUUID(),stranger=randomUUID(),otherClubOwner=randomUUID(),people=[venueOwner,manager,clubOwner,p1,p2,stranger,otherClubOwner];
 const club=randomUUID(),otherClub=randomUUID(),event=randomUUID(),otherEvent=randomUUID(),clubs:string[]=[club,otherClub];
 const run=(actor:string,action:PlatformCommand['action'],expectedRevision?:number,requestId=randomUUID())=>executePlatformCommand(actor,{requestId,action,...(expectedRevision===undefined?{}:{expectedRevision})});
 let loc='',board='',board2='',foreignBoard='',foreignLocation='';
 const future=Math.floor((Date.now()+60*60_000)/1000)*1000;
 const request=(start=future,end=future+60*60_000,boardCount=1,eventId=event,maxMatches=4)=>run(eventId===otherEvent?otherClubOwner:clubOwner,{type:'reservation.request',locationId:loc,eventId,startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString(),boardCount,maxMatches});
 try{
  for(const [index,id] of people.entries())await owner.query('insert into dartflow_private.profiles(id,name) values($1,$2)',[id,`Location fixture ${index}`]);
  for(const [index,id] of clubs.entries())await owner.query('insert into dartflow_private.clubs(id,name) values($1,$2)',[id,`Location fixture club ${index}`]);
  for(const [user,clubId,role] of [[clubOwner,club,'organizer'],[p1,club,'player'],[p2,club,'player'],[otherClubOwner,otherClub,'organizer']] as const)await owner.query('insert into dartflow_private.club_memberships(club_id,user_id,role) values($1,$2,$3)',[clubId,user,role]);
  for(const [id,clubId,creator] of [[event,club,clubOwner],[otherEvent,otherClub,otherClubOwner]]){await owner.query('insert into dartflow_private.events(id,club_id,name,date,capacity) values($1,$2,$3,current_date,16)',[id,clubId,`Reserved day ${id}`]);await owner.query('insert into dartflow_private.event_staff(event_id,user_id) values($1,$2)',[id,creator]);}
  await t.test('activation and ownership are independent of platform and club roles; one fixed home board is enforced concurrently',async()=>{
   await assert.rejects(run(venueOwner,{type:'location.create',name:'Missing activation'}),{code:'location_inactive',status:403});
   await run(p1,{type:'location.enable-home'});const home=(await getLocationOverview(p1)).locations.find(l=>l.kind==='home')!;
   const attempts=await Promise.allSettled([run(p1,{type:'location.board.create',locationId:home.id,name:'Eigen thuisbaan'}),run(p1,{type:'location.board.create',locationId:home.id,name:'Tweede thuisbaan'})]);
   assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(attempts.filter(r=>r.status==='rejected').length,1);
   const ownHome=(await getLocationOverview(p1)).locations.find(l=>l.kind==='home')!.boards[0];assert.equal(ownHome.publicScreen,false);assert.equal(ownHome.playUrl,`/baan/${ownHome.id}`);
   await assert.rejects(run(clubOwner,{type:'location.board.update',locationId:home.id,boardId:ownHome.id,name:'Club cannot manage'}),{status:403});
   await assert.rejects(getBoardForActor(p2,ownHome.id),{status:403});await assert.rejects(getBoardScreen(ownHome.id),{code:'screen_pairing_required'});
   const pairing=await createBoardScreenDevice(p1,ownHome.id,'Eigen scoretablet'),paired=await pairBoardScreenDevice(ownHome.id,pairing.pairing.code);assert.equal((await getBoardScreen(ownHome.id,paired.token)).board.name,ownHome.name);
   const practice=await run(p1,{type:'board.start',boardId:ownHome.id,mode:'solo'});await run(p1,{type:'training.finish',id:practice.id},practice.entity!.revision);
   const homeCount=(await owner.query('select count(*)::int as n from dartflow_private.location_boards where home_owner_id=$1',[p1])).rows[0].n;assert.equal(homeCount,1);
  });
  await t.test('location owners delegate physical management without granting club membership or event access',async()=>{
   await run(venueOwner,{type:'location.enable-venue'});loc=(await run(venueOwner,{type:'location.create',name:'De vaste Oche',timezone:'Europe/Amsterdam'})).id!;
   board=(await run(venueOwner,{type:'location.board.create',locationId:loc,name:'Locatiebaan 1'})).id!;board2=(await run(venueOwner,{type:'location.board.create',locationId:loc,name:'Locatiebaan 2'})).id!;
   await assert.rejects(run(clubOwner,{type:'location.board.update',locationId:loc,boardId:board,enabled:true}),{status:403});
   await run(venueOwner,{type:'location.manager.add',locationId:loc,userId:manager});
   await run(manager,{type:'location.board.update',locationId:loc,boardId:board,enabled:true});await run(manager,{type:'location.board.update',locationId:loc,boardId:board2,enabled:true});
   await assert.rejects(run(manager,{type:'location.manager.add',locationId:loc,userId:stranger}),{status:403});
   assert.equal((await getLocationOverview(manager)).locations.find(l=>l.id===loc)?.role,'manager');
   assert.equal((await owner.query('select 1 from dartflow_private.club_memberships where user_id=any($1::uuid[])',[[venueOwner,manager]])).rowCount,0);
   await assert.rejects(eventAccess(owner,venueOwner,event),{status:403});await assert.rejects(run(manager,{type:'reservation.request',locationId:loc,eventId:event,startsAt:new Date(future).toISOString(),endsAt:new Date(future+60_000).toISOString(),boardCount:1,maxMatches:1}),{status:403});
   await run(stranger,{type:'location.enable-venue'});foreignLocation=(await run(stranger,{type:'location.create',name:'Andere fysieke locatie'})).id!;foreignBoard=(await run(stranger,{type:'location.board.create',locationId:foreignLocation,name:'Andere locatiebaan'})).id!;
   await run(stranger,{type:'location.board.update',locationId:foreignLocation,boardId:foreignBoard,enabled:true});
  });
  await t.test('request windows require explicit offsets and current organizer rights; only the location decides exact assigned capacity',async()=>{
   await assert.rejects(run(p1,{type:'reservation.request',locationId:loc,eventId:event,startsAt:new Date(future).toISOString(),endsAt:new Date(future+60_000).toISOString(),boardCount:1,maxMatches:1}),{status:403});
   await assert.rejects(run(clubOwner,{type:'reservation.request',locationId:loc,eventId:event,startsAt:'2026-11-12T18:30',endsAt:'2026-11-12T20:30',boardCount:1,maxMatches:1}),{code:'invalid_window'});
   await assert.rejects(run(clubOwner,{type:'reservation.request',locationId:loc,eventId:otherEvent,startsAt:new Date(future).toISOString(),endsAt:new Date(future+60_000).toISOString(),boardCount:1,maxMatches:1}),{status:403});
   const r=await request(future+5*60*60_000,future+6*60*60_000,2);
   await assert.rejects(run(clubOwner,{type:'reservation.accept',reservationId:r.id,boardIds:[board,board2]},0),{status:403});
   await assert.rejects(run(venueOwner,{type:'reservation.accept',reservationId:r.id,boardIds:[board]},0),{code:'reservation_capacity'});
   await assert.rejects(run(venueOwner,{type:'reservation.accept',reservationId:r.id,boardIds:[board,foreignBoard]},0),{code:'board_unavailable'});
   await run(manager,{type:'reservation.decline',reservationId:r.id,reason:'Andere tijd graag'},0);
   const scoped=(await getLocationOverview(clubOwner)).reservations.find(item=>item.id===r.id)!;assert.equal(scoped.status,'declined');assert.equal(scoped.boards.length,0);assert.equal(scoped.reason,'Andere tijd graag');
   assert.equal((await getLocationOverview(stranger)).reservations.some(item=>item.id===r.id),false);
  });
  await t.test('simultaneous overlap approvals assign a physical board at most once while half-open adjacent windows remain valid',async()=>{
   const first=await request(),overlap=await request(future+30*60_000,future+90*60_000);
   const results=await Promise.allSettled([run(venueOwner,{type:'reservation.accept',reservationId:first.id,boardIds:[board]},0),run(manager,{type:'reservation.accept',reservationId:overlap.id,boardIds:[board]},0)]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);const rejected=results.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.equal(rejected.reason.code,'reservation_overlap');
   const acceptedId=results[0].status==='fulfilled'?first.id!:overlap.id!,accepted=(await getLocationOverview(venueOwner)).reservations.find(r=>r.id===acceptedId)!;
   const adjacent=await request(new Date(accepted.endsAt).getTime(),new Date(accepted.endsAt).getTime()+60*60_000);await run(manager,{type:'reservation.accept',reservationId:adjacent.id,boardIds:[board]},0);
   const capacity=await request(future,future+60*60_000,2);await assert.rejects(run(manager,{type:'reservation.accept',reservationId:capacity.id,boardIds:[board,board2]},0),{code:'reservation_overlap'});
   await run(venueOwner,{type:'reservation.cancel',reservationId:acceptedId},1);await run(clubOwner,{type:'reservation.cancel',reservationId:adjacent.id},1);
   const cancelled=(await getLocationOverview(venueOwner)).reservations.find(r=>r.id===acceptedId)!;assert.equal(cancelled.status,'cancelled');
   await run(manager,{type:'reservation.accept',reservationId:capacity.id,boardIds:[board,board2]},0);
   await run(manager,{type:'reservation.cancel',reservationId:capacity.id},1);
  });
  await t.test('approval rechecks requester permissions rather than trusting the originally submitted role',async()=>{
   const r=await request(future+8*60*60_000,future+9*60*60_000);await owner.query("update dartflow_private.club_memberships set role='player' where club_id=$1 and user_id=$2",[club,clubOwner]);
   await assert.rejects(run(manager,{type:'reservation.accept',reservationId:r.id,boardIds:[board]},0),{status:403});
   assert.equal((await getLocationOverview(manager)).reservations.find(item=>item.id===r.id)?.status,'pending');await owner.query("update dartflow_private.club_memberships set role='organizer' where club_id=$1 and user_id=$2",[club,clubOwner]);
  });
  await t.test('fixed reservation routes honor current scoped custom organizer grants without legacy staff and redact immediately after revocation',async()=>{
   const scopedClub=(await run(clubOwner,{type:'club.create',name:'Scoped reservation organizers'})).id!;clubs.push(scopedClub);
   await run(stranger,{type:'club.request',id:scopedClub});await run(clubOwner,{type:'club.approve',id:scopedClub,userId:stranger});
   const competition=await run(clubOwner,{type:'tournament.create',clubId:scopedClub,name:'Toernooiregie op een vaste baan',boards:1,format:'knockout'}),eventId=String(competition.entity!.state.eventId);
   const r=await run(clubOwner,{type:'reservation.request',locationId:loc,eventId,startsAt:new Date(Date.now()-60_000).toISOString(),endsAt:new Date(Date.now()+30*60_000).toISOString(),boardCount:1,maxMatches:2});
   await run(venueOwner,{type:'reservation.accept',reservationId:r.id,boardIds:[board2]},0);
   assert.equal((await owner.query('select role from dartflow_private.club_memberships where club_id=$1 and user_id=$2',[scopedClub,stranger])).rows[0].role,'player');
   assert.equal((await owner.query('select 1 from dartflow_private.event_staff where event_id=$1 and user_id=$2',[eventId,stranger])).rowCount,0);
   assert.equal((await owner.query('select 1 from dartflow_private.entries where event_id=$1 and user_id=$2',[eventId,stranger])).rowCount,0);
   await run(clubOwner,{type:'club.role.save',id:scopedClub,name:'Baanregie',permissions:['competitions.manage']});
   const role=(await owner.query('select id from dartflow_private.club_roles where club_id=$1 and name=$2',[scopedClub,'Baanregie'])).rows[0].id;
   await run(clubOwner,{type:'club.member.roles',id:scopedClub,userId:stranger,roleIds:[role]});
   assert.equal((await eventAccess(database(),stranger,eventId)).canManage,false);
   assert.equal((await getBoardForActor(stranger,board2)).reservation?.label,'Gereserveerd voor een speeldag');
   const action={type:'reservation.request',locationId:loc,eventId,startsAt:new Date(future+10*60*60_000).toISOString(),endsAt:new Date(future+11*60*60_000).toISOString(),boardCount:1,maxMatches:1};
   await assert.rejects(run(stranger,action),{status:403});
   await run(clubOwner,{type:'club.role.save',id:scopedClub,roleId:role,name:'Baanregie',permissions:['tournaments.manage']});
   assert.equal((await eventAccess(database(),stranger,eventId)).canManage,true);
   const allowed=await getBoardForActor(stranger,board2);assert.equal(allowed.event.id,eventId);assert.equal(allowed.reservation?.label,competition.entity!.name);assert.equal(allowed.canStart,false);
   await run(stranger,action);
   await run(clubOwner,{type:'club.member.roles',id:scopedClub,userId:stranger,roleIds:[]});
   assert.equal((await eventAccess(database(),stranger,eventId)).canManage,false);
   const revoked=await getBoardForActor(stranger,board2);assert.equal(revoked.reservation?.label,'Gereserveerd voor een speeldag');assert.equal(JSON.stringify(revoked).includes(eventId),false);assert.equal(JSON.stringify(revoked).includes(competition.entity!.name),false);
   await assert.rejects(run(stranger,action),{status:403});
  });
  await t.test('an approved physical board maps an existing event fixture without changing its identity or granting another club access',async()=>{
   const competition=await run(clubOwner,{type:'tournament.create',clubId:club,name:'Gereseveerde verenigingsspeeldag',boards:1,format:'knockout',requireWriter:false,startScore:301,bestOfLegs:1});
   for(const actor of [p1,p2]){await run(actor,{type:'competition.register',id:competition.id});await run(actor,{type:'competition.checkin',id:competition.id});}
   const planned=await run(clubOwner,{type:'competition.plan',id:competition.id}),fixture=planned.entity!.state.fixtures!.find(f=>f.status==='scheduled')!;
   const eventId=String(competition.entity!.state.eventId),r=await run(clubOwner,{type:'reservation.request',locationId:loc,eventId,startsAt:new Date(Date.now()-60_000).toISOString(),endsAt:new Date(Date.now()+30*60_000).toISOString(),boardCount:1,maxMatches:1});
   await run(venueOwner,{type:'reservation.accept',reservationId:r.id,boardIds:[board]},0);
   const before=(await owner.query('select event_id from dartflow_private.boards where id=$1',[board])).rows[0].event_id;
   const viewer=await getBoardScreen(board);assert.equal(viewer.reservation?.label,competition.entity!.name);assert.equal(viewer.board.screenUrl,`/baanscherm/${board}`);assert.equal(viewer.board.playUrl,`/baan/${board}`);
   const unrelated=await getBoardForActor(otherClubOwner,board);assert.equal(unrelated.canStart,false);assert.equal(unrelated.reservation?.canPrepare,false);assert.equal(JSON.stringify(unrelated).includes(competition.entity!.name),false);assert.equal(JSON.stringify(unrelated).includes(eventId),false);
   await assert.rejects(run(otherClubOwner,{type:'board.start',boardId:board,mode:'solo'}),{code:'board_reserved'});
   await assert.rejects(run(venueOwner,{type:'reservation.fixture.start',reservationId:r.id,boardId:board,fixtureId:fixture.id}),{status:403});
   const first=fixture.players[0]!,second=fixture.players[1]!;const preparedView=await getBoardForActor(first,board);assert.equal(preparedView.reservation?.canPrepare,true);assert.equal(preparedView.reservation?.fixtureId,fixture.id);
   const started=await run(first,{type:'reservation.fixture.start',reservationId:r.id,boardId:board,fixtureId:fixture.id});assert.ok(started.matchId);
   let match=await getMatch(first,started.matchId!);assert.equal(match.boardId,board);assert.equal(match.eventId,eventId);assert.equal((await getBoardForActor(second,board)).matchId,match.id);
   const send=async(actor:string,action:MatchAction)=>match=await executeMatchCommand(actor,{requestId:randomUUID(),matchId:match.id,expectedRevision:match.revision,action});
   await send(first,{type:'accept'});await send(second,{type:'accept'});await send(first,{type:'start'});await send(first,{type:'score',score:180});assert.equal((await getBoardScreen(board)).snapshot.match?.remaining[0],121);
   assert.equal((await getOverview(clubOwner,club)).boards.some(b=>b.id===board&&b.eventId===eventId),true);
   await assert.rejects(run(clubOwner,{type:'board.block',id:competition.id,boardId:board,blocked:true}),{status:403});
   await owner.query("update dartflow_private.board_reservations set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 second' where id=$1",[r.id]);
   const overrun=await getBoardScreen(board);assert.equal(overrun.reservation?.overrun,true);assert.equal(overrun.reservation?.label,competition.entity!.name);
   await send(first,{type:'score',score:0});await send(first,{type:'score',score:121,doubleConfirmed:true});await send(first,{type:'confirm'});await send(second,{type:'confirm'});await reconcilePlatformResults();
   assert.equal((await getBoardScreen(board)).snapshot.match,null);assert.equal((await getBoardForActor(stranger,board)).canStart,true);
   const another=await executeEventCommand(clubOwner,eventId,{type:'plan',playerIds:[first,second],settings:{startScore:301,bestOfLegs:1}}),anotherMatch=await getMatch(clubOwner,another.matchId!);
   await assert.rejects(executeMatchCommand(clubOwner,{requestId:randomUUID(),matchId:anotherMatch.id,expectedRevision:anotherMatch.revision,action:{type:'call',boardId:board}}),{code:'reservation_window'});
   await owner.query("update dartflow_private.board_reservations set ends_at=now()+interval '10 minutes' where id=$1",[r.id]);
   await assert.rejects(executeMatchCommand(clubOwner,{requestId:randomUUID(),matchId:anotherMatch.id,expectedRevision:anotherMatch.revision,action:{type:'call',boardId:board}}),{code:'reservation_capacity'});
   await owner.query("update dartflow_private.board_reservations set ends_at=now()-interval '1 second' where id=$1",[r.id]);
   assert.equal((await owner.query('select event_id from dartflow_private.boards where id=$1',[board])).rows[0].event_id,before);assert.equal((await owner.query('select count(*)::int as n from dartflow_private.reservation_matches where reservation_id=$1',[r.id])).rows[0].n,1);
   assert.equal((await owner.query('select 1 from dartflow_private.club_memberships where club_id=$1 and user_id=$2',[club,venueOwner])).rowCount,0);
  });
  await t.test('physical management closes idle boards, plans occupied closure and binds explicit force confirmation to the current session',async()=>{
   const view=async()=>(await getLocationOverview(venueOwner)).locations.find(l=>l.id===loc)!.boards.find(b=>b.id===board)!;
   for(const type of ['location.board.open','location.board.close','location.board.force-release'])await assert.rejects(run(clubOwner,{type,locationId:loc,boardId:board}),{status:403});
   await run(manager,{type:'location.board.close',locationId:loc,boardId:board});assert.equal((await view()).effectiveStatus,'closed');assert.equal((await getBoardScreen(board)).status,'closed');assert.equal((await getBoardForActor(p1,board)).canStart,false);
   await assert.rejects(run(p1,{type:'board.start',boardId:board,mode:'solo'}),{code:'board_closed'});
   await run(manager,{type:'location.board.open',locationId:loc,boardId:board});assert.equal((await view()).effectiveStatus,'open');
   const training=await run(p1,{type:'board.start',boardId:board,mode:'solo',startScore:301});await run(manager,{type:'location.board.close',locationId:loc,boardId:board});
   assert.equal((await view()).closePending,true);assert.equal((await view()).effectiveStatus,'occupied');assert.equal((await getBoardScreen(board)).status,'playing');
   const scored=await run(p1,{type:'training.score',id:training.id,score:60},training.entity!.revision);assert.equal((await getBoardScreen(board)).snapshot.match?.remaining[0],241);
   await run(p1,{type:'training.finish',id:training.id},scored.entity!.revision);assert.equal((await view()).closed,true);assert.equal((await view()).closePending,false);assert.equal((await getBoardScreen(board)).status,'closed');
   await run(venueOwner,{type:'location.board.open',locationId:loc,boardId:board});const next=await run(p1,{type:'board.start',boardId:board,mode:'solo'}),active=await view();assert.ok(active.activity);assert.equal(active.activeGame?.id,next.id);
   const action={type:'location.board.force-release',locationId:loc,boardId:board,expectedSessionId:active.activity!.sessionId,confirmedSourceId:next.id,confirmedBoardName:active.name,reason:'Tablet verlaten door spelers'};
   await assert.rejects(run(venueOwner,{...action,confirmedBoardName:'Verkeerde baan'}),{code:'release_confirmation'});
   await assert.rejects(run(venueOwner,{...action,confirmedSourceId:training.id}),{code:'release_confirmation'});
   const requestId=randomUUID();await run(venueOwner,action,undefined,requestId);assert.equal((await view()).effectiveStatus,'open');assert.equal((await getBoardScreen(board)).snapshot.match,null);
   await assert.rejects(run(p1,{type:'training.score',id:next.id,score:60},next.entity!.revision),{code:'board_session_expired'});
   const successor=await run(p1,{type:'board.start',boardId:board,mode:'solo'});await run(venueOwner,action,undefined,requestId);assert.equal((await view()).activeGame?.id,successor.id);
   await assert.rejects(run(venueOwner,action),{code:'assignment_changed'});await run(p1,{type:'training.finish',id:successor.id},successor.entity!.revision);
   assert.equal((await owner.query("select count(*)::int as n from dartflow_private.audit_events where actor_id=$1 and action='location.board.force-release' and detail->>'reason'=$2",[venueOwner,action.reason])).rows[0].n,1);
   const lobby=await run(p1,{type:'board.start',boardId:board,mode:'local'});await run(manager,{type:'location.board.close',locationId:loc,boardId:board});assert.equal((await view()).closed,true);assert.equal((await view()).closePending,false);assert.equal((await getBoardScreen(board)).status,'closed');await run(p1,{type:'lobby.cancel',id:lobby.id});await run(manager,{type:'location.board.open',locationId:loc,boardId:board});
  });
  await t.test('per-board reservation requests preserve the requested physical board and reject replacement or closed choices',async()=>{
   const startsAt=new Date(future+12*60*60_000).toISOString(),endsAt=new Date(future+13*60*60_000).toISOString();
   const action={type:'reservation.request',locationId:loc,eventId:event,preferredBoardId:board,startsAt,endsAt,boardCount:1,maxMatches:1},r=await run(clubOwner,action);
   assert.equal((await getLocationOverview(venueOwner)).reservations.find(item=>item.id===r.id)?.preferredBoardId,board);
   await assert.rejects(run(manager,{type:'reservation.accept',reservationId:r.id,boardIds:[board2]},0),{code:'reservation_board'});
   await run(manager,{type:'reservation.accept',reservationId:r.id,boardIds:[board]},0);await run(manager,{type:'reservation.cancel',reservationId:r.id},1);
   await run(manager,{type:'location.board.close',locationId:loc,boardId:board});await assert.rejects(run(clubOwner,action),{code:'board_unavailable'});await run(manager,{type:'location.board.open',locationId:loc,boardId:board});
  });
  await t.test('forced official release preserves progress and fixture authority while applying planned closure',async()=>{
   for(const actor of [p1,p2]){await executeEventCommand(actor,event,{type:'register'});await executeEventCommand(actor,event,{type:'check-in'});}
   const r=await run(clubOwner,{type:'reservation.request',locationId:loc,eventId:event,startsAt:new Date().toISOString(),endsAt:new Date(Date.now()+20*60_000).toISOString(),boardCount:1,maxMatches:1});await run(venueOwner,{type:'reservation.accept',reservationId:r.id,boardIds:[board]},0);
   const planned=await executeEventCommand(clubOwner,event,{type:'plan',playerIds:[p1,p2],settings:{startScore:301,bestOfLegs:1}});let match=await getMatch(p1,planned.matchId!);
   const send=async(actor:string,action:MatchAction)=>match=await executeMatchCommand(actor,{requestId:randomUUID(),matchId:match.id,expectedRevision:match.revision,action});
   await send(clubOwner,{type:'call',boardId:board});await send(p1,{type:'accept'});await send(p2,{type:'accept'});await send(p1,{type:'start'});await send(p1,{type:'score',score:60});
   const active=(await getLocationOverview(venueOwner)).locations.find(l=>l.id===loc)!.boards.find(b=>b.id===board)!;assert.equal(active.activity?.kind,'official');
   await run(manager,{type:'location.board.close',locationId:loc,boardId:board});await run(manager,{type:'location.board.force-release',locationId:loc,boardId:board,expectedSessionId:active.activity!.sessionId,confirmedSourceId:match.id,confirmedBoardName:active.name,reason:'Locatie sluit voor onderhoud'});
   const interrupted=await getMatch(p1,match.id);assert.equal(interrupted.status,'interrupted');assert.equal(interrupted.boardId,null);assert.equal(interrupted.remaining[0],241);assert.equal(interrupted.visits.length,1);assert.equal((await getBoardScreen(board)).status,'closed');
   assert.equal((await owner.query('select 1 from dartflow_private.match_results where match_id=$1',[match.id])).rowCount,0);assert.equal((await owner.query('select count(*)::int as n from dartflow_private.visits where match_id=$1',[match.id])).rows[0].n,1);
   await run(manager,{type:'location.board.open',locationId:loc,boardId:board});assert.equal((await getBoardScreen(board)).status,'reserved');await owner.query("update dartflow_private.board_reservations set starts_at=now()-interval '2 minutes',ends_at=now()-interval '1 second' where id=$1",[r.id]);
  });
  await t.test('a delegated manager is rechecked after a blocked location lock and loses replay rights immediately',async()=>{
   const req=randomUUID(),action={type:'location.board.update',locationId:loc,boardId:board,name:'Nieuwe fysieke baannaam'};await run(manager,action,undefined,req);
   await owner.query('begin');await owner.query('select id from dartflow_private.locations where id=$1 for update',[loc]);
   const queued=Promise.allSettled([run(manager,{type:'location.board.update',locationId:loc,boardId:board,enabled:false})]);
   try{let blocked=false;for(let i=0;i<100&&!blocked;i++){await owner.query('select pg_stat_clear_snapshot()');blocked=Boolean((await owner.query("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select id,owner_id,kind,name,timezone from dartflow_private.locations%') as waiting")).rows[0].waiting);if(!blocked)await new Promise(r=>setTimeout(r,10));}assert.equal(blocked,true);await owner.query('delete from dartflow_private.location_members where location_id=$1 and user_id=$2',[loc,manager]);await owner.query('commit');}finally{await owner.query('rollback');}
   const outcome=(await queued)[0];assert.equal(outcome.status,'rejected');assert.equal(outcome.status==='rejected'?outcome.reason.status:null,403);
   await assert.rejects(run(manager,action,undefined,req),{status:403});assert.equal((await getLocationOverview(manager)).locations.some(l=>l.id===loc),false);
   assert.equal((await getBoardScreen(board)).board.name,action.name);assert.equal((await getBoardScreen(board)).board.screenUrl,`/baanscherm/${board}`);
  });
  await t.test('all seven private relations use RLS and runtime cannot reassign ownership or extend reservation windows',async()=>{
   const tables=['location_accounts','locations','location_members','location_boards','board_reservations','reservation_boards','reservation_matches'];
   for(const table of tables)assert.equal((await owner.query('select relrowsecurity from pg_class where oid=$1::regclass',[`dartflow_private.${table}`])).rows[0].relrowsecurity,true);
   const flags=(await database().query("select has_column_privilege(current_user,'dartflow_private.locations','owner_id','UPDATE') as owner_update,has_column_privilege(current_user,'dartflow_private.location_boards','location_id','UPDATE') as move_board,has_column_privilege(current_user,'dartflow_private.board_reservations','ends_at','UPDATE') as extend_window")).rows[0];assert.deepEqual(flags,{owner_update:false,move_board:false,extend_window:false});
  });
 }finally{
  try{
  await owner.query('rollback');
  await owner.query('begin');
  await cleanupFeedFixtures(owner,people);
  const locations=(await owner.query('select id from dartflow_private.locations where owner_id=any($1::uuid[])',[people])).rows.map(row=>row.id);
  const physicalEvents=(await owner.query('select home_event_id from dartflow_private.location_boards where location_id=any($1::uuid[])',[locations])).rows.map(row=>row.home_event_id);
  const internalClubs=(await owner.query('select distinct club_id from dartflow_private.events where id=any($1::uuid[])',[physicalEvents])).rows.map(row=>row.club_id);
  const allClubs=[...new Set([...clubs,...internalClubs])],events=(await owner.query('select id from dartflow_private.events where club_id=any($1::uuid[])',[allClubs])).rows.map(row=>row.id);
  const matches=(await owner.query('select id from dartflow_private.matches where event_id=any($1::uuid[])',[events])).rows.map(row=>row.id),entities=(await owner.query('select id from dartflow_private.platform_entities where owner_id=any($1::uuid[])',[people])).rows.map(row=>row.id);
  const reservations=(await owner.query('select id from dartflow_private.board_reservations where location_id=any($1::uuid[])',[locations])).rows.map(row=>row.id),jobs=(await owner.query('select id from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people])).rows.map(row=>row.id);
  await owner.query('delete from dartflow_private.mail_provider_events where job_id=any($1::uuid[])',[jobs]);await owner.query('delete from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.mail_events where recipient_key=any($1::text[])',[people.map(id=>`user:${id}`)]);
  for(const table of ['reservation_matches','reservation_boards'])await owner.query(`delete from dartflow_private.${table} where reservation_id=any($1::uuid[])`,[reservations]);await owner.query('delete from dartflow_private.board_reservations where id=any($1::uuid[])',[reservations]);
  for(const table of ['platform_signals','platform_match_links','action_receipts','match_confirmations','visits','match_results','match_players'])await owner.query(`delete from dartflow_private.${table} where match_id=any($1::uuid[])`,[matches]);
  for(const table of ['platform_cast_grants','platform_messages','platform_reports','platform_audit','platform_members'])await owner.query(`delete from dartflow_private.${table} where ${['platform_messages','platform_reports'].includes(table)?'room_id':'entity_id'}=any($1::uuid[])`,[entities]);
  await owner.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.platform_entities where id=any($1::uuid[])',[entities]);
  for(const table of ['audit_events','board_screen_devices','screen_capabilities','matches','standings','entries','event_staff'])await owner.query(`delete from dartflow_private.${table} where event_id=any($1::uuid[])`,[events]);
  await owner.query('delete from dartflow_private.audit_events where actor_id=any($1::uuid[])',[people]);
  await owner.query('delete from dartflow_private.location_boards where location_id=any($1::uuid[])',[locations]);await owner.query('delete from dartflow_private.boards where event_id=any($1::uuid[])',[events]);await owner.query('delete from dartflow_private.events where id=any($1::uuid[])',[events]);
  await owner.query('delete from dartflow_private.location_members where location_id=any($1::uuid[])',[locations]);await owner.query('delete from dartflow_private.locations where id=any($1::uuid[])',[locations]);await owner.query('delete from dartflow_private.location_accounts where user_id=any($1::uuid[])',[people]);
  await owner.query('delete from dartflow_private.club_join_requests where club_id=any($1::uuid[])',[allClubs]);await owner.query('delete from dartflow_private.club_memberships where club_id=any($1::uuid[])',[allClubs]);await owner.query('delete from dartflow_private.clubs where id=any($1::uuid[])',[allClubs]);await owner.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);await owner.query('commit');
  }finally{await owner.query('rollback').catch(()=>undefined);await owner.end();await closeDatabase();}
 }
});
