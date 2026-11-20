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
// Push carries only opaque identifiers. Resolve text after checking the current
// cookie, account and exact browser subscription; never cache private responses.
self.addEventListener('push',event=>{event.waitUntil((async()=>{
 let p;try{p=event.data.json();}catch{return;}
 const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
 if(!p||!uuid(p.id)||!uuid(p.subscriptionId)||!uuid(p.installationId))return;
 try{const q=new URLSearchParams({subscriptionId:p.subscriptionId,installationId:p.installationId}),r=await fetch(`/api/notifications/delivery/${p.id}?${q}`,{credentials:'same-origin',cache:'no-store'});if(!r.ok)return;
 const v=await r.json();if(v.id!==p.id||v.href!==`/app/notifications/${p.id}`||typeof v.title!=='string'||typeof v.body!=='string')return;
 await self.registration.showNotification(v.title.slice(0,120),{body:v.body.slice(0,240),tag:`dartflow-${p.id}`,icon:'/assets/pwa/player-192.png',badge:'/assets/pwa/player-192.png',data:{id:p.id,href:v.href}});
 }catch{/* The saved inbox remains available when background networking fails. */}
})());});
self.addEventListener('notificationclick',event=>{event.notification.close();const v=event.notification.data;if(!v||typeof v.id!=='string'||v.href!==`/app/notifications/${v.id}`||!/^\/app\/notifications\/[0-9a-f-]{36}$/.test(v.href))return;
 event.waitUntil((async()=>{const target=new URL(v.href,self.location.origin).href,windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const w of windows){if(new URL(w.url).origin===self.location.origin){await w.navigate(target);await w.focus();return;}}await self.clients.openWindow(target);})());
});
