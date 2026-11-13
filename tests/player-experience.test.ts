import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {boardGamePreference} from '../lib/player-experience-store';
import {experienceWeekStart,focusedTrainingValue,updatePlayerExperience,getPlayerExperience} from '../lib/player-experience';
import {safeNext} from '../lib/config';
import {newTraining,trainingAction} from '../lib/platform-domain';
import {closeDatabase} from '../lib/db';
import {createBoardScreenDevice,pairBoardScreenDevice,heartbeatBoardScreen,listBoardScreenDevices,setBoardScreenPreferences,getBoardScreen,revokeBoardScreenDevice} from '../lib/board-screens';
try{process.loadEnvFile('.env.local');}catch{/* CI supplies a loopback database. */}
function local(value:string|undefined){try{return Boolean(value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname));}catch{return false;}}
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&local(process.env.DARTFLOW_DATABASE_URL)&&local(process.env.DARTFLOW_DATABASE_ADMIN_URL);
test('new player routes preserve safe own-origin login return and use Amsterdam calendar weeks across DST',()=>{
 const id=randomUUID();for(const path of ['/app/feed/discover',`/app/feed/share/${id}`,`/app/feed/result/${id}`,`/app/competities/${id}?fixture=${id}`,'/app/training-advies','/app/schermbeheer'])assert.equal(safeNext(path),path);
 for(const path of [`/app/feed/result/${id}?next=https://evil.invalid`,`/app/competities/${id}?fixture=${id}&evil=1`,'//evil.invalid/app/feed','/app/feed/result/unknown'])assert.equal(safeNext(path),'/');
 assert.equal(new Date(experienceWeekStart(new Date('2026-11-15T23:15:00Z'))).toISOString(),'2026-11-15T23:00:00.000Z');
 assert.equal(new Date(experienceWeekStart(new Date('2026-06-14T22:15:00Z'))).toISOString(),'2026-06-14T22:00:00.000Z');
 assert.equal(new Date(experienceWeekStart(new Date('2026-10-25T13:00:00Z'))).toISOString(),'2026-10-18T22:00:00.000Z');
});
test('focused training preserves zero and bust visits, completes First 9 server-side and compares only a complete nine darts',()=>{
 const id=randomUUID(),actor=randomUUID();let state=newTraining(id,actor,{mode:'solo',startScore:501,focus:'first9'});
 assert.equal(focusedTrainingValue('first9',state.game),null);
 for(const score of [180,0,60])state=trainingAction(state,{type:'training.score',score});
 assert.equal(state.completed,true);assert.equal(focusedTrainingValue('first9',state.game),80);assert.equal(state.game?.visits.length,3);
 state=trainingAction(state,{type:'training.undo'});assert.equal(state.completed,false);assert.equal(focusedTrainingValue('first9',state.game),null);
 state=trainingAction(state,{type:'training.score',score:100});assert.equal(focusedTrainingValue('first9',state.game),280/3);
 assert.throws(()=>newTraining(id,actor,{mode:'bot',focus:'first9'}),{code:'invalid_focus'});
 assert.deepEqual(boardGamePreference({mode:'solo',startScore:301,bestOfLegs:5}),{mode:'solo',startScore:301,bestOfLegs:1});
 assert.throws(()=>boardGamePreference({mode:'local',startScore:170,bestOfLegs:3}),{code:'invalid_settings'});
});
test('preferences and display management persist across sessions and enforce current board and device authority',{skip:!configured},async()=>{
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();
 const owner=randomUUID(),player=randomUUID(),outsider=randomUUID(),club=randomUUID(),event=randomUUID(),board=randomUUID(),otherBoard=randomUUID(),ids=[owner,player,outsider];
 try{
  for(const id of ids)await admin.query('insert into dartflow_private.profiles(id,name) values($1,$2)',[id,`Experience ${id.slice(0,8)}`]);
  await admin.query('insert into dartflow_private.clubs(id,name) values($1,$2)',[club,'Experience fixture']);
  for(const id of [owner,player])await admin.query('insert into dartflow_private.club_memberships(club_id,user_id,role) values($1,$2,$3)',[club,id,id===owner?'organizer':'player']);
  await admin.query('insert into dartflow_private.events(id,club_id,name,date,capacity) values($1,$2,$3,current_date,8)',[event,club,'Experience fixture']);
  await admin.query('insert into dartflow_private.event_staff(event_id,user_id) values($1,$2)',[event,owner]);
  for(const id of [board,otherBoard])await admin.query('insert into dartflow_private.boards(id,event_id,name) values($1,$2,$3)',[id,event,'Experience board']);
  await updatePlayerExperience(player,{type:'favorite',boardId:board,favorite:true});await updatePlayerExperience(player,{type:'favorite',boardId:board,favorite:true});
  await updatePlayerExperience(player,{type:'board-game',boardId:board,mode:'local',startScore:301,bestOfLegs:5});await updatePlayerExperience(player,{type:'weekly-goal',weeklyGoal:7});
  const saved=(await admin.query('select * from dartflow_private.player_experience where user_id=$1',[player])).rows[0];assert.deepEqual(saved.favorites,[board]);assert.equal(saved.weekly_goal,7);assert.equal(saved.last_games[board].startScore,301);
  await assert.rejects(updatePlayerExperience(outsider,{type:'favorite',boardId:board,favorite:true}),{status:403});await assert.rejects(updatePlayerExperience(player,{type:'weekly-goal',weeklyGoal:99}),{code:'invalid_goal'});
  const visible=await getPlayerExperience(player);assert.equal(visible.weeklyGoal,7);assert.equal(visible.boards.find(b=>b.id===board)?.favorite,true);assert.deepEqual(visible.boards.find(b=>b.id===board)?.devices,[]);
  await assert.rejects(setBoardScreenPreferences(player,board,{rotation:0}),{status:403});await assert.rejects(setBoardScreenPreferences(owner,board,{rotation:180}),{code:'invalid_rotation'});
  await setBoardScreenPreferences(owner,board,{rotation:270});const issued=await createBoardScreenDevice(owner,board,'Experience tablet'),paired=await pairBoardScreenDevice(board,issued.pairing.code);
  assert.deepEqual(await heartbeatBoardScreen(board),{paired:false});assert.deepEqual(await heartbeatBoardScreen(otherBoard,paired.token),{paired:false});assert.deepEqual(await heartbeatBoardScreen(board,paired.token),{paired:true});
  const screen=await getBoardScreen(board,paired.token);assert.equal(screen.screen?.rotation,270);assert.equal(JSON.stringify(screen).includes(issued.device.id),false);assert.ok((await listBoardScreenDevices(owner,board)).devices[0].lastSeenAt);
  await revokeBoardScreenDevice(owner,board,issued.device.id);assert.deepEqual(await heartbeatBoardScreen(board,paired.token),{paired:false});
  await updatePlayerExperience(player,{type:'favorite',boardId:board,favorite:false});assert.deepEqual((await admin.query('select favorites from dartflow_private.player_experience where user_id=$1',[player])).rows[0].favorites,[]);
 }finally{
  try{for(const table of ['audit_events','board_screen_devices','event_staff','screen_capabilities'])await admin.query(`delete from dartflow_private.${table} where event_id=$1`,[event]);await admin.query('delete from dartflow_private.boards where event_id=$1',[event]);await admin.query('delete from dartflow_private.events where id=$1',[event]);await admin.query('delete from dartflow_private.club_memberships where club_id=$1',[club]);await admin.query('delete from dartflow_private.clubs where id=$1',[club]);await admin.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[ids]);}finally{await admin.end();await closeDatabase();}
 }
});
