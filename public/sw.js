/* Static artwork only. Sessions, HTML, live scores and every mutation use the network. */
const DARTFLOW_CACHE = 'dartflow-static-v1';
const DARTFLOW_STATIC = new Set([
  '/assets/dartflow-logo.svg',
  '/assets/dartflow-icon.svg',
  '/assets/dartboard.svg',
  '/assets/pwa/player-180.png',
  '/assets/pwa/player-192.png',
  '/assets/pwa/player-512.png',
  '/assets/pwa/scoreboard-180.png',
  '/assets/pwa/scoreboard-192.png',
  '/assets/pwa/scoreboard-512.png',
]);
self.addEventListener('install', event => {event.waitUntil(self.skipWaiting());});
self.addEventListener('activate', event => {event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('dartflow-static-') && key !== DARTFLOW_CACHE) await caches.delete(key);
  await self.clients.claim();
})());});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.mode === 'navigate' || url.origin !== self.location.origin || url.search || !DARTFLOW_STATIC.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(DARTFLOW_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic' && !response.headers.has('set-cookie')) await cache.put(request, response.clone());
    return response;
  })());
});
