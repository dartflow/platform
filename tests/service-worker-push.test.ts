import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
const id='51119e0f-1eb6-46b2-a43a-81cb52db04bf';
const subscriptionId='54c11f35-784c-4f41-b2b3-a8d9b72cfe95';
const installationId='8fb00ede-0a21-4922-a127-b8997e9345ec';
async function harness(response:unknown={id,title:'DartFlow',body:'Er staat een bericht klaar.',href:`/app/notifications/${id}`},status=200){
 const handlers=new Map<string,(event:unknown)=>void>(),requests:{url:string;options:RequestInit}[]=[],shown:{title:string;options:Record<string,unknown>}[]=[],opened:string[]=[];
 let closed=0;
 const self={location:{origin:'https://dartflow.example'},addEventListener:(name:string,handler:(event:unknown)=>void)=>handlers.set(name,handler),registration:{showNotification:async(title:string,options:Record<string,unknown>)=>{shown.push({title,options});}},clients:{matchAll:async()=>[],openWindow:async(url:string)=>{opened.push(url);}}};
 runInNewContext(source,{self,URL,URLSearchParams,fetch:async(url:string,options:RequestInit)=>{requests.push({url,options});return {ok:status>=200&&status<300,json:async()=>response};}});
 const dispatch=async(name:string,event:Record<string,unknown>)=>{const work:Promise<unknown>[]=[];handlers.get(name)!({...event,waitUntil:(p:Promise<unknown>)=>work.push(p)});await Promise.all(work);};
 return {requests,shown,opened,push:async(payload:unknown)=>dispatch('push',{data:{json:()=>payload}}),click:async(data:unknown)=>dispatch('notificationclick',{notification:{data,close:()=>{closed++;}}}),closed:()=>closed};
}

test('background push resolves opaque identifiers with the current authenticated session and does not trust payload text',async()=>{
 const h=await harness();await h.push({id,subscriptionId,installationId,title:'Private caller text',body:'Private ticket body',href:'https://outside.example'});
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,`/api/notifications/delivery/${id}?subscriptionId=${subscriptionId}&installationId=${installationId}`);assert.equal(h.requests[0].options.credentials,'same-origin');assert.equal(h.requests[0].options.cache,'no-store');
 assert.equal(h.shown.length,1);assert.equal(h.shown[0].title,'DartFlow');assert.equal(h.shown[0].options.body,'Er staat een bericht klaar.');assert.equal(JSON.stringify(h.shown).includes('Private'),false);
});
test('background push is silent after account or subscription access is rejected',async()=>{
 const h=await harness({title:'Private stale text'},403);await h.push({id,subscriptionId,installationId});assert.equal(h.requests.length,1);assert.equal(h.shown.length,0);
});
test('malformed push identifiers do not trigger authenticated network requests',async()=>{
 const h=await harness();for(const payload of [null,{}, {id:'../../admin',subscriptionId,installationId},{id,subscriptionId:'wrong',installationId}])await h.push(payload);assert.equal(h.requests.length,0);assert.equal(h.shown.length,0);
});
test('background push rejects a response pointing outside the opaque inbox route',async()=>{
 const h=await harness({id,title:'DartFlow',body:'Update',href:'https://outside.example'});await h.push({id,subscriptionId,installationId});assert.equal(h.shown.length,0);
});
test('notification click opens only its same-origin opaque inbox route for fresh destination checks',async()=>{
 const h=await harness();await h.click({id,href:'https://outside.example'});await h.click({id,href:'/app/admin/support'});assert.equal(h.opened.length,0);
 await h.click({id,href:`/app/notifications/${id}`});assert.deepEqual(h.opened,[`https://dartflow.example/app/notifications/${id}`]);assert.equal(h.closed(),3);
});
