import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRooms} from '../public/rooms.js';

test('rooms created with the same clock and entropy retain distinct numeric identities, turns and confirmed results',t=>{
 t.mock.method(Date,'now',()=>1_800_000_000_000);
 t.mock.method(Math,'random',()=>0);
 const previous=Object.fromEntries(['document','sessionStorage','location','window'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 t.after(()=>{for(const[key,descriptor]of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 const fields={},data={players:[{id:1,name:'QA one',avg:70,status:'approved'},{id:2,name:'QA two',avg:80,status:'approved'}],matches:[]},finished=[];
 let currentId=0;
 globalThis.document={addEventListener(){},getElementById:id=>fields[id]??null,querySelectorAll:()=>[]};
 globalThis.sessionStorage={getItem(){return null;},setItem(){}};
 globalThis.location={origin:'https://example.test',pathname:'/'};
 globalThis.window={};
 const context={get db(){return data;},icon:()=>'',esc:String,avatar:()=>'',badge:String,button:()=>'',header:()=>'',sectionHeading:()=>'',empty:()=>'',toast(){},save(){},showModal(){},closeModal(){},go(){},openMatch:id=>{currentId=id;},render(){},roomId:()=>currentId,onFinished:match=>finished.push(match.id),P:id=>data.players.find(player=>player.id===id),short:id=>context.P(id).name,baseUrl:'https://example.test/'};
 const rooms=createRooms(context),action=(type,dataset={})=>rooms.handleAction(type,{dataset});
 const ready=()=>{fields['room-board-check']={checked:true};action('room-ready');action('room-opponent-ready');action('room-start');};
 const score=(value,darts=3)=>{fields['room-score']={value:String(value),disabled:false};fields['room-darts']={value:String(darts)};fields['room-score-error']={textContent:''};action('room-submit');};
 const firstId=rooms.createGame({startScore:301,bestOf:1,opponentId:2});ready();score(60);action('room-actor',{actor:'1'});
 const first=structuredClone(data.matches.find(match=>match.id===firstId));
 assert.deepEqual(first.remaining,[241,301]);assert.equal(data.play.rooms[firstId].actor,1);

 const secondId=rooms.createGame({startScore:301,bestOf:1,opponentId:2,communityRoomId:'qa-room'});
 assert.ok(Number.isSafeInteger(firstId)&&Number.isSafeInteger(secondId));assert.notEqual(secondId,firstId);
 assert.notEqual(data.play.rooms[firstId],data.play.rooms[secondId]);assert.equal(data.play.rooms[secondId].actor,0);
 ready();score(180);action('room-actor',{actor:'1'});score(0);action('room-actor',{actor:'0'});score(121);
 let second=data.matches.find(match=>match.id===secondId);
 assert.equal(second.status,'live');assert.equal(second.visits.length,2,'checkout waits for explicit double confirmation');
 action('room-double',{darts:'3'});second=data.matches.find(match=>match.id===secondId);
 assert.equal(second.status,'finished');assert.equal(data.play.rooms[secondId].phase,'finished');assert.equal(second.visits.length,3);assert.equal(second.visits.at(-1).score,121);assert.equal(second.visits.at(-1).checkout,true);
 action('room-confirm-result');assert.deepEqual(finished,[]);action('room-confirm-opponent');action('room-confirm-opponent');assert.deepEqual(finished,[secondId]);
 assert.deepEqual(data.matches.find(match=>match.id===firstId),first,'finishing another room must preserve the earlier scorecard');
 assert.equal(data.play.rooms[firstId].actor,1);assert.equal(data.play.rooms[secondId].communityRoomId,'qa-room');
 assert.equal(new Set(data.matches.map(match=>match.id)).size,data.matches.length);
});
