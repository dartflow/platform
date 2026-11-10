import assert from 'node:assert/strict';
import {createRooms} from '../public/rooms.js';
const el={};
global.document={addEventListener(){},getElementById:id=>el[id]||null,querySelectorAll:()=>[]};
global.sessionStorage={getItem(){return null},setItem(){}};
global.location={origin:'https://example.test',pathname:'/'};
global.window={};
let data={players:[{id:1,name:'Rick',avg:70,status:'approved'},{id:2,name:'Mike',avg:80,status:'approved'}],matches:[]},id=0,finished=0,notice='';
const c={get db(){return data},icon:()=>'',esc:String,avatar:()=>'',badge:String,button:()=>'',header:()=>'',sectionHeading:()=>'',empty:()=>'',toast:m=>notice=m,save(){},showModal(){},closeModal(){},go(){},openMatch:n=>id=n,render(){},roomId:()=>id,onFinished:()=>finished++,P:n=>data.players.find(p=>p.id===n),short:n=>c.P(n).name,baseUrl:'https://example.test/'};
const rooms=createRooms(c),act=(a,dataset={})=>rooms.handleAction(a,{dataset});
function ready(){el['room-board-check']={checked:true};act('room-ready');act('room-opponent-ready');act('room-start');}
function score(value,darts=3){el['room-score']={value:String(value),disabled:false};el['room-darts']={value:String(darts)};el['room-score-error']={textContent:''};act('room-submit');}
rooms.init();assert.equal(data.players.at(-1).id,900);
rooms.createGame({startScore:501,opponentId:2,cameraRequired:true});
let m=data.matches.at(-1),meta=data.play.rooms[id];
score(60);assert.equal(m.visits.length,0,'lobby blocks scoring');
act('room-ready');assert.equal(meta.ready[0],true);act('room-start');assert.equal(meta.phase,'lobby','cannotstartwithmissingopponentorboard');
act('room-opponent-ready');el['room-board-check']={checked:true};act('room-ready');act('room-ready');act('room-start');assert.equal(meta.phase,'playing');
score(60);m=data.matches.at(-1);assert.equal(m.remaining[0],441);score(60);assert.equal(data.matches.at(-1).visits.length,1,'no doubled remote score');
act('room-disconnect');score(60);assert.equal(data.matches.at(-1).visits.length,1,'paused match blocks scoring');act('room-resume');
act('room-actor',{actor:'1'});score(60);assert.equal(data.matches.at(-1).visits.length,2);act('room-actor',{actor:'0'});act('room-correct');assert.equal(meta.correction.count,2);act('room-correction-accept');assert.ok(meta.correction,'requestor cannot approve own correction');act('room-actor',{actor:'1'});act('room-correction-accept');assert.equal(data.matches.at(-1).visits.length,0);assert.equal(meta.correction,null);assert.equal(JSON.parse(JSON.stringify(meta)).actor,undefined,'perspective is not shared state');
console.log('PASS lobby, turn lock, disconnect, correction consent and local perspective');
rooms.createGame({startScore:301,bestOf:1,opponentId:2,communityRoomId:'club-alpha'});ready();m=data.matches.at(-1);meta=data.play.rooms[id];m.remaining=[40,40];score(40,1);assert.equal(m.visits.length,0,'double requires confirmation');act('room-double',{darts:'1'});m=data.matches.at(-1);assert.equal(m.status,'finished');assert.equal(meta.phase,'finished');act('room-confirm-result');assert.equal(finished,0);act('room-confirm-opponent');assert.equal(finished,1);act('room-confirm-opponent');assert.equal(finished,1,'confirmed result applied once');assert.equal(meta.communityRoomId,'club-alpha');
console.log('PASS double finish, joint result confirmation, idempotence and club room association');
rooms.createGame({startScore:301,legLimit:4,setup:'localone',opponentId:2});ready();for(let i=0;i<4;i++){m=data.matches.at(-1);m.remaining[m.turn]=40;score(40,1);act('room-double',{darts:'1'});}m=data.matches.at(-1);assert.equal(m.status,'finished');assert.equal(m.draw,true);assert.deepEqual(m.legs,[2,2]);
console.log('PASS fixed-leg draw completes through shared scoreboard');
rooms.createGame({opponentId:900,type:'ranked',botLevel:70});meta=data.play.rooms[id];assert.equal(meta.type,'practice','bot excluded from ranked mode');el['room-board-check']={checked:true};act('room-ready');act('room-start');score(60);act('room-demo-turn');assert.equal(data.matches.at(-1).visits.length,2);assert.equal(data.matches.at(-1).turn,0);
console.log('PASS legal Dartbot visit and practice-only classification');
