import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {closeDatabase,executeMatchCommand,getMatch} from '../lib/db';
import {newGame,validateSettings} from '../lib/domain';
import {sendMatchSignal} from '../lib/platform';
import type {MatchState,MatchCommand} from '../lib/types';
import {cleanupNotificationFixtures} from './helpers/cleanup-v17';
try{process.loadEnvFile('.env.local');}catch{}
const local=(value?:string)=>{try{return !!value&&['127.0.0.1','localhost','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
test('mandatory camera enforces two fresh authorized endpoint observations before start and every new score',{skip:process.env.DARTFLOW_DATA_MODE!=='local'||!local(process.env.DARTFLOW_DATABASE_ADMIN_URL)||!local(process.env.DARTFLOW_DATABASE_URL)},async()=>{
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();
 const players=[randomUUID(),randomUUID(),randomUUID()],event=randomUUID(),club=randomUUID(),id=randomUUID(),suffix=id.slice(0,8),receipts:string[]=[];
 const settings=validateSettings({startScore:301,bestOfLegs:1});
 const state:MatchState={id,eventId:event,clubId:club,boardId:null,revision:0,status:'ready',players:players.slice(0,2).map((id,i)=>({id,name:`Camera ${i} ${suffix}`})),writerId:players[0],settings,accepted:[true,true],confirmations:[false,false],resultRevision:null,game:newGame(id,players.slice(0,2),settings),previousSets:[],winnerId:null,resultPublished:false,dispute:null,cameraRequired:true};
 const heartbeat=async(actor:string,overrides:Record<string,unknown>={})=>{const requestId=randomUUID();receipts.push(requestId);return sendMatchSignal(actor,id,{requestId,type:'preflight',payload:{purpose:'media-ready',callId:suffix,video:true,connected:true,peerVideo:true,...overrides}});};
 const command=async(action:MatchCommand['action'])=>({matchId:id,requestId:randomUUID(),expectedRevision:(await getMatch(players[0],id)).revision,action});
 try{
  for(const [i,player]of players.entries())await admin.query('insert into dartflow_private.profiles(id,name,display_name,display_name_confirmed)values($1,$2,$3,true)',[player,`camera_${suffix}_${i}`,`Camera ${i} ${suffix}`]);
  await admin.query("insert into dartflow_private.clubs(id,name)values($1,'Camera readiness fixture')",[club]);
  for(const player of players)await admin.query("insert into dartflow_private.club_memberships(club_id,user_id,role)values($1,$2,'player')",[club,player]);
  await admin.query("insert into dartflow_private.events(id,club_id,name,date,capacity)values($1,$2,'Camera readiness fixture',current_date,4)",[event,club]);
  await admin.query('insert into dartflow_private.matches(id,club_id,event_id,revision,state)values($1,$2,$3,0,$4)',[id,club,event,JSON.stringify(state)]);
  for(const [i,player]of players.slice(0,2).entries())await admin.query('insert into dartflow_private.match_players(match_id,user_id,position)values($1,$2,$3)',[id,player,i]);
  await assert.rejects(executeMatchCommand(players[0],await command({type:'start'})),{code:'camera_required'});
  await assert.rejects(heartbeat(players[2]),{code:'forbidden'});
  await heartbeat(players[0]);await assert.rejects(executeMatchCommand(players[0],await command({type:'start'})),{code:'camera_required'});
  await heartbeat(players[1],{callId:'other-call'});await assert.rejects(executeMatchCommand(players[0],await command({type:'start'})),{code:'camera_required'});
  await heartbeat(players[1]);const start=await command({type:'start'});assert.equal((await executeMatchCommand(players[0],start)).status,'live');
  await heartbeat(players[1],{video:false});await assert.rejects(executeMatchCommand(players[0],await command({type:'score',score:60})),{code:'camera_required'});
  assert.equal((await executeMatchCommand(players[0],start)).revision,1,'An accepted exact retry remains accepted after media loss.');
  await heartbeat(players[1]);await admin.query("update dartflow_private.platform_signals set created_at=clock_timestamp()-interval '21 seconds' where match_id=$1 and sender_id=$2",[id,players[0]]);
  await assert.rejects(executeMatchCommand(players[0],await command({type:'score',score:60})),{code:'camera_required'});
  await heartbeat(players[0]);assert.equal((await executeMatchCommand(players[0],await command({type:'score',score:60}))).remaining[0],241);
  await heartbeat(players[1],{peerVideo:false});await assert.rejects(executeMatchCommand(players[0],await command({type:'score',score:60})),{code:'camera_required'});
 }finally{
  try{
   await cleanupNotificationFixtures(admin,players);
   await admin.query('delete from dartflow_private.platform_receipts where request_id=any($1::uuid[])',[receipts]);
   await admin.query('delete from dartflow_private.platform_signals where match_id=$1',[id]);
   for(const table of ['action_receipts','visits','match_players'])await admin.query(`delete from dartflow_private.${table} where match_id=$1`,[id]);
   await admin.query('delete from dartflow_private.audit_events where event_id=$1',[event]);
   await admin.query('delete from dartflow_private.matches where id=$1',[id]);await admin.query('delete from dartflow_private.events where id=$1',[event]);
   await admin.query('delete from dartflow_private.club_memberships where club_id=$1',[club]);await admin.query('delete from dartflow_private.clubs where id=$1',[club]);
   await admin.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[players]);
  }finally{await admin.end();await closeDatabase();}
 }
});
