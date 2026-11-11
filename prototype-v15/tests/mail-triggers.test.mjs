import test from 'node:test';
import assert from 'node:assert/strict';
import {createClubs} from '../public/clubs.js';
import {createCommunity} from '../public/community.js';
import {createRooms} from '../public/rooms.js';
import {createPortal} from '../public/portal.js';
import {createCompetitions} from '../public/competitions.js';
import {createVenueEvent,venueAction} from '../public/venue-engine.js';
import {MAIL_TEMPLATES,renderMail} from '../public/mail-engine.js';
import {collectVenueMailEvents} from '../public/mail-trigger-hooks.js';

globalThis.document={addEventListener(){},getElementById(){return null;}};
globalThis.location={origin:'https://dartflow.example',pathname:'/'};
function context() {
  const messages=[];
  const db={role:'player',players:Array.from({length:24},(_,i)=>({id:i+1,name:`Speler ${i+1}`,email:`speler${i+1}@voorbeeld.test`,status:'approved',avg:55})),matches:[],tournaments:[],play:{community:{rooms:[]},social:{friends:[],favorites:[],blocked:[],reports:[],requests:[]}}};
  let route='',matchId=0;
  const c={db,esc:v=>String(v??''),icon:()=>'',P:id=>db.players.find(p=>p.id===Number(id))||{name:'Gast'},short:id=>`Speler ${id}`,avatar:()=>'',badge:()=>'',button:()=>'',header:()=>'',sectionHeading:()=>'',empty:()=>'',toast(){},save(){},showModal(){},closeModal(){},render(){},go:value=>route=value,routeParam:()=>route.split('/')[1]||'',openMatch:id=>matchId=id,roomId:()=>matchId,baseUrl:'https://dartflow.example',scopeId:()=>db.play.activeClubId??null,scopeName:()=>db.play.activeClubId?'Club':'Dartflow',emitMail:event=>{const template=MAIL_TEMPLATES.find(t=>t.id===event.templateId);assert.ok(template,`Unknown template ${event.templateId}`);assert.deepEqual(renderMail(template,event.variables).missing,[],`Missing payload ${event.templateId}`);messages.push(event);}};
  return {c,db,messages};
}
const action=(module,name,dataset)=>module.handleAction(name,{dataset});
const form=(module,name,values)=>module.handleForm({dataset:{form:name}},values);

test('a membership request and decision notify the owning club once',()=>{
  const {c,db,messages}=context();const clubs=createClubs(c);clubs.init();
  db.play.activeClubId=702;
  c.go('clubs/703');action(clubs,'clubs-join',{id:'703'});
  const club=db.play.clubs.items.find(c=>c.id===703),request=club.requests[0];
  assert.equal(messages.length,1);assert.equal(messages[0].templateId,'club-request');assert.equal(messages[0].scopeId,703);assert.equal(messages[0].recipient.email,'speler11@voorbeeld.test');
  action(clubs,'clubs-join',{id:'703'});assert.equal(messages.length,1);
  db.role='admin';action(clubs,'clubs-approve',{id:String(request.id),club:'703'});
  assert.equal(messages.length,2);assert.equal(messages[1].templateId,'club-decision');assert.equal(messages[1].recipient.email,'speler1@voorbeeld.test');assert.equal(messages[1].scopeId,703);
  action(clubs,'clubs-approve',{id:String(request.id),club:'703'});assert.equal(messages.length,2);
});

test('friend acceptance emits once, in global scope even from a club',()=>{
  const {c,db,messages}=context();db.play.activeClubId=702;
  const noop={init(){}};const portal=createPortal(c,noop,noop,noop);portal.init();
  action(portal,'portal-friend',{id:'8'});assert.equal(messages[0].templateId,'friend-request');assert.equal(messages[0].scopeId,null);assert.equal(messages[0].recipient.email,'speler8@voorbeeld.test');
  action(portal,'portal-friend',{id:'8'});assert.equal(messages.length,1);
  const request=db.play.social.requests.find(r=>r.to===8);
  action(portal,'portal-simulate-friend',{id:String(request.id)});
  assert.equal(messages.length,2);assert.equal(messages[1].templateId,'friend-accepted');assert.equal(messages[1].recipient.email,'speler1@voorbeeld.test');
  action(portal,'portal-simulate-friend',{id:String(request.id)});assert.equal(messages.length,2);
});

test('a room invitation and accepted challenge generate no duplicate match invitation',()=>{
  const {c,db,messages}=context();createClubs(c).init();db.play.activeClubId=702;
  const rooms=createRooms(c);c.createGame=options=>rooms.createGame(options);
  const community=createCommunity(c);community.init();
  form(community,'community-create',{name:'Vriendenavond',maxMembers:'6',type:'private',friend:'2'});
  const room=db.play.community.rooms.find(r=>r.name==='Vriendenavond');
  assert.equal(messages.length,1);assert.equal(messages[0].templateId,'room-invite');assert.equal(messages[0].scopeId,702);
  action(community,'community-simulate-join',{id:String(room.id),player:'2'});
  form(community,'community-challenge',{roomId:room.id,opponentId:2,startScore:501,bestOf:5,ranked:'no'});
  assert.equal(messages.length,2);assert.equal(messages[1].templateId,'challenge-invite');
  const challenge=room.challenges[0];action(community,'community-accept',{id:String(room.id),challenge:String(challenge.id)});
  assert.equal(messages.length,3);assert.equal(messages[2].templateId,'challenge-accepted');assert.equal(messages[2].recipient.email,'speler1@voorbeeld.test');
  action(community,'community-accept',{id:String(room.id),challenge:String(challenge.id)});assert.equal(messages.length,3);
  action(community,'community-mute',{id:String(room.id),player:'2'});assert.equal(messages.at(-1).templateId,'moderation-notice');
});

test('time proposal informs the opponent, agreement informs both once',()=>{
  const {c,db,messages}=context();db.role='admin';db.play.activeClubId=701;const competitions=createCompetitions(c);competitions.init();
  const league=db.play.leagues.find(l=>l.id===501),fixture=league.fixtures.find(f=>f.players.includes(1)&&f.status==='scheduled');
  form(competitions,'comp-plan',{id:fixture.id,time:'2026-12-11T20:00',message:'Vrijdag?'});
  assert.equal(messages.length,1);assert.equal(messages[0].templateId,'fixture-changed');assert.equal(messages[0].scopeId,701);
  action(competitions,'comp-accept-time',{id:fixture.id});assert.equal(messages.length,3);assert.deepEqual(messages.slice(1).map(m=>m.templateId),['fixture-scheduled','fixture-scheduled']);
  action(competitions,'comp-accept-time',{id:fixture.id});assert.equal(messages.length,3);
  db.play.activeClubId=null;const open=db.play.leagues.find(l=>l.clubId==null);action(competitions,'comp-join',{id:String(open.id)});assert.equal(messages.at(-1).templateId,'competition-entry');assert.equal(messages.at(-1).scopeId,null);
});

test('venue collector uses new logs, sends promotion and skips guests without addresses',()=>{
  const {db}=context();let previous=createVenueEvent({id:'open',clubId:701,settings:{capacity:2}},1000);
  let next=venueAction(previous,'signup',{id:1,name:'Speler 1'},2000).state;
  let messages=collectVenueMailEvents(previous,next,db.players,'https://dartflow.example',[]);
  assert.deepEqual(messages.map(m=>m.templateId),['tournament-approved']);assert.equal(messages[0].scopeId,701);
  previous=next;next=venueAction(previous,'signup',{id:2,name:'Speler 2'},3000).state;
  previous=next;next=venueAction(previous,'signup',{id:3,name:'Speler 3'},4000).state;
  messages=collectVenueMailEvents(previous,next,db.players,'https://dartflow.example');assert.equal(messages[0].templateId,'tournament-waitlist');
  previous=next;next=venueAction(previous,'withdraw',{playerId:1},5000).state;
  messages=collectVenueMailEvents(previous,next,db.players,'https://dartflow.example');assert.deepEqual(messages.map(m=>m.templateId),['tournament-withdrawn','tournament-promoted']);
  assert.deepEqual(collectVenueMailEvents(next,next,db.players,'https://dartflow.example'),[]);
  previous=next;next=venueAction(previous,'signup',{id:999,name:'Gast'},6000).state;
  assert.deepEqual(collectVenueMailEvents(previous,next,db.players,'https://dartflow.example'),[]);
});

test('venue calls and terminal results select current state and omit obsolete confirmations',()=>{
  const {db}=context();const previous={id:'open',clubId:701,sequence:5,log:[],players:[],matches:[],boards:[],settings:{startScore:501,bestOf:5}};
  const next={...previous,sequence:7,log:[{id:7,type:'confirmed',matchId:'P1',at:8000},{id:6,type:'pending',matchId:'P1',at:7999}],matches:[{id:'P1',players:[1,2],status:'confirmed',score:[3,1]}]};
  let messages=collectVenueMailEvents(previous,next,db.players,'https://dartflow.example');
  assert.deepEqual(messages.map(m=>m.templateId),['result-confirmed','result-confirmed']);
  const called={...previous,sequence:6,log:[{id:6,type:'called',matchId:'P1',boardId:'B1',at:7000}],matches:[{id:'P1',players:[1,2],status:'called'}],boards:[{id:'B1',name:'Bord 1'}]};
  messages=collectVenueMailEvents(previous,called,db.players,'https://dartflow.example');assert.equal(messages.length,2);assert.equal(messages[0].templateId,'board-call');assert.equal(messages[0].variables.boardName,'Bord 1');
});
