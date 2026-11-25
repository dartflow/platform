import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {boardManifest, manifestForPath, playerManifest, scoreboardManifest} from '../lib/pwa';

const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
test('player, fallback and physical boards have independent immutable installation identities',()=>{
  const player=playerManifest(),fallback=scoreboardManifest(),a=boardManifest(first,'Baan 1'),b=boardManifest(second,'Baan 2'),renamed=boardManifest(first,'Hoofdbaan');
  assert.equal(new Set([player.id,fallback.id,a.id,b.id]).size,4);
  assert.equal(player.start_url,'/speler');assert.equal(player.name,'DartFlow Speler');assert.equal(fallback.start_url,'/scorebord');
  for(const key of ['id','start_url','scope'] as const)assert.equal(a[key],renamed[key]);
  assert.equal(a.start_url,`/baanscherm/${first}`);assert.equal(a.scope,a.start_url);assert.equal(b.scope,b.start_url);
  assert.equal(renamed.name,'Oche Live · Hoofdbaan');assert.equal(boardManifest(first.toUpperCase(),'Baan').id,a.id);
  assert.throws(()=>boardManifest('../other','Baan'));
  assert.equal(JSON.stringify(a).includes('token'),false);assert.equal(JSON.stringify(a).includes('wedstrijd'),false);
});
test('the manifest reference is derived only from the current physical route',()=>{
  assert.equal(manifestForPath(['baanscherm',first]),`/api/board-screens/${first}/manifest.webmanifest`);
  assert.equal(manifestForPath(['oche-live',first]),manifestForPath(['baanscherm',first]));
  assert.equal(manifestForPath(['baanscherm',second]),`/api/board-screens/${second}/manifest.webmanifest`);
  assert.equal(manifestForPath(['baanscherm',first]),`/api/board-screens/${first}/manifest.webmanifest`);
  assert.equal(manifestForPath(['baanscherm','invalid']),undefined);assert.equal(manifestForPath([]),undefined);
  assert.equal(manifestForPath(['speler']),'/speler/manifest.webmanifest');assert.equal(manifestForPath(['app','play']),'/speler/manifest.webmanifest');assert.equal(manifestForPath(['scorebord']),'/scorebord/manifest.webmanifest');
});
test('service worker only handles exact static artwork and never HTML, live data, sessions, credentials or mutations',async()=>{
  const source=await readFile('public/sw.js','utf8');
  const handlers=new Map<string,(event:unknown)=>void>();
  const stored=new Map<string,unknown>();let network=0;
  const cache={match:async(request:{url:string})=>stored.get(request.url),put:async(request:{url:string},response:unknown)=>{stored.set(request.url,response);}};
  const response={ok:true,type:'basic',headers:new Headers(),clone(){return this;}};
  const scope={location:{origin:'https://dartflow.nl'},addEventListener:(name:string,handler:(event:unknown)=>void)=>handlers.set(name,handler),skipWaiting:async()=>{},clients:{claim:async()=>{}}};
  vm.runInNewContext(source,{self:scope,URL,caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true},fetch:async()=>{network++;return response;}});
  const fetchEvent=(path:string,method='GET',mode='cors')=>{
    let pending:Promise<unknown>|undefined;
    handlers.get('fetch')!({request:{url:new URL(path,'https://dartflow.nl').href,method,mode},respondWith:(value:Promise<unknown>)=>{pending=value;}});
    return pending;
  };
  for(const [path,method,mode] of [
    ['/api/session','GET','cors'],['/api/board-screens/'+first,'GET','cors'],['/api/matches/anything/actions','POST','cors'],['/auth/callback?code=secret','GET','navigate'],['/wedstrijd/anything','GET','navigate'],['/baanscherm/'+first,'GET','navigate'],['/assets/dartflow-logo.svg?code=secret','GET','cors'],['https://other.example/assets/dartflow-logo.svg','GET','cors'],['/_next/static/file.js','GET','cors'],['/assets/dartflow-logo.svg','POST','cors'],
  ])assert.equal(fetchEvent(path,method,mode),undefined,path);
  assert.equal(network,0);assert.equal(stored.size,0);
  await fetchEvent('/assets/pwa/player-192.png');assert.equal(network,1);assert.equal(stored.size,1);
  await fetchEvent('/assets/pwa/player-192.png');assert.equal(network,1);
});

test('offline fallback stores only the marked anonymous shell; accepted account HTML and private APIs never enter a cache',async()=>{
 const source=await readFile('public/sw.js','utf8'),handlers=new Map<string,(event:unknown)=>void>(),stored=new Map<string,unknown>(),calls:{path:string;credentials?:string}[]=[];let offline=false;
 const key=(request:string|{url:string})=>typeof request==='string'?new URL(request,'https://dartflow.nl').href:request.url;
 const cache={match:async(request:string|{url:string})=>stored.get(key(request)),put:async(request:string|{url:string},response:unknown)=>{stored.set(key(request),response);}};
 const shell={ok:true,type:'basic',headers:new Headers({'X-DartFlow-Offline-Shell':'1','Content-Type':'text/html'}),text:async()=>'<script src="/_next/static/chunks/app-abc123.js"></script>',clone(){return this;}},account={ok:true,type:'basic',headers:new Headers({'Content-Type':'text/html'}),clone(){return this;}};
 vm.runInNewContext(source,{self:{location:{origin:'https://dartflow.nl'},addEventListener:(n:string,h:(e:unknown)=>void)=>handlers.set(n,h),skipWaiting:async()=>{},clients:{claim:async()=>{}}},URL,caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true},fetch:async(request:string|{url:string},init?:{credentials?:string})=>{if(offline)throw Error('offline');const path=new URL(key(request)).pathname;calls.push({path,credentials:init?.credentials});return path==='/speelsessie'?shell:account;}});
 let installed:Promise<unknown>|undefined;handlers.get('install')!({waitUntil:(p:Promise<unknown>)=>{installed=p;}});await installed;assert.deepEqual(calls,[{path:'/speelsessie',credentials:'omit'},{path:'/_next/static/chunks/app-abc123.js',credentials:'omit'}]);assert.equal(stored.size,2);
 const visit=(path:string)=>{let promise:Promise<unknown>|undefined;handlers.get('fetch')!({request:{url:new URL(path,'https://dartflow.nl').href,method:'GET',mode:'navigate'},respondWith:(p:Promise<unknown>)=>{promise=p;}});return promise;};
 assert.equal(await visit(`/wedstrijd/${first}`),account);assert.equal(stored.size,2);assert.equal(visit('/api/session'),undefined);assert.equal(visit('/auth/callback?code=private'),undefined);offline=true;assert.equal(await visit(`/wedstrijd/${first}`),shell);assert.equal(await visit(`/spelen/${first}`),shell);assert.equal(stored.has(`https://dartflow.nl/wedstrijd/${first}`),false);
});
