/* Cache public artwork, immutable bundles and one anonymous offline shell only. */
const DARTFLOW_CACHE='dartflow-static-v3';
const SHELL='/speelsessie';
const DARTFLOW_STATIC=new Set(['/assets/dartflow-logo.svg','/assets/dartflow-icon.svg','/assets/dartboard.svg','/assets/pwa/player-180.png','/assets/pwa/player-192.png','/assets/pwa/player-512.png','/assets/pwa/scoreboard-180.png','/assets/pwa/scoreboard-192.png','/assets/pwa/scoreboard-512.png','/assets/pwa/oche-live-180.png','/assets/pwa/oche-live-192.png','/assets/pwa/oche-live-512.png']);
const bundle=path=>/^\/_next\/static\/(?:chunks|css|media)\/[A-Za-z0-9_./-]+\.(?:js|css|woff2)$/.test(path)&&!path.includes('..');
const safe=response=>response.ok&&response.type==='basic'&&!response.headers.has('set-cookie');
async function primeShell(){const cache=await caches.open(DARTFLOW_CACHE),response=await fetch(SHELL,{credentials:'omit',cache:'reload'});if(!safe(response)||response.headers.get('x-dartflow-offline-shell')!=='1'||!response.headers.get('content-type')?.startsWith('text/html'))return;await cache.put(SHELL,response.clone());const html=await response.text(),paths=[...html.matchAll(/(?:src|href)="([^" ]+)"/g)].map(v=>v[1]).filter(bundle);await Promise.all(paths.map(async path=>{try{const asset=await fetch(path,{credentials:'omit'});if(safe(asset))await cache.put(path,asset);}catch{/* Already cached bundles remain available. */}}));}
self.addEventListener('install',event=>{event.waitUntil((async()=>{try{await primeShell();}catch{/* Installing still supports artwork when offline. */}await self.skipWaiting();})());});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('dartflow-static-')&&key!==DARTFLOW_CACHE)await caches.delete(key);await self.clients.claim();})());});
self.addEventListener('fetch',event=>{const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==self.location.origin||url.search)return;
 if(request.mode==='navigate'){
  if(url.pathname!==SHELL&&!/^\/(?:spelen|wedstrijd)\/[0-9a-f-]{36}$/.test(url.pathname))return;
  event.respondWith((async()=>{try{return await fetch(request);}catch(error){const cached=await(await caches.open(DARTFLOW_CACHE)).match(SHELL);if(cached)return cached;throw error;}})());return;
 }
 if(!DARTFLOW_STATIC.has(url.pathname)&&!bundle(url.pathname))return;
 event.respondWith((async()=>{const cache=await caches.open(DARTFLOW_CACHE),cached=await cache.match(request);if(cached)return cached;const response=await fetch(request);if(safe(response))await cache.put(request,response.clone());return response;})());
});
