import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

try{process.loadEnvFile('.env.local');}catch{/* CI supplies the loopback fixture. */}
const origin='http://localhost:3000';
async function login(page:Page,next='/app/clubs'){await page.goto(`/inloggen?next=${encodeURIComponent(next)}`);await page.getByRole('button',{name:/Danny Goldenbelt/}).click();await expect(page).toHaveURL(new URL(next,origin).href);}
async function command(context:BrowserContext,action:Record<string,unknown>,revision?:number){
  const response=await context.request.post('/api/platform/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),action,...(revision===undefined?{}:{expectedRevision:revision})}});
  expect(response.status(),await response.text()).toBe(200);return response.json();
}
async function manifest(page:Page){
  const link=page.locator('head link[rel=manifest]');await expect(link).toHaveCount(1);await expect(link).toHaveAttribute('crossorigin','use-credentials');
  const href=await link.getAttribute('href');return {href,data:await(await page.request.get(href!)).json()};
}

test('fixed board apps retain separate manifests, QR, live/offline state and explicit fallback binding',async({browser,baseURL})=>{
  test.setTimeout(120000);
  if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('PWA tests require a loopback fixture.');
  const owner=await browser.newContext(),viewer=await browser.newContext({viewport:{width:960,height:540}});
  const manager=await owner.newPage();let training:{id:string;entity:{revision:number}}|null=null;
  try{
    expect((await(await owner.request.get('/api/session')).json()).local).toBe(true);await login(manager);
    const suffix=randomUUID().slice(0,6),club=await command(owner,{type:'club.create',name:`PWA ${suffix}`});
    await command(owner,{type:'location.enable-venue'});const a=(await command(owner,{type:'club-board.create',clubId:club.id,name:`Baan 1 ${suffix}`})).board;
    const b=(await command(owner,{type:'club-board.create',clubId:club.id,name:`Baan 2 ${suffix}`})).board;
    let authRequests=0;viewer.on('request',request=>{if(/^\/(api\/session|api\/auth|auth)(\/|$)/.test(new URL(request.url()).pathname))authRequests++;});
    const first=await viewer.newPage(),second=await viewer.newPage();
    await first.goto(a.screenUrl);await expect(first.getByRole('heading',{name:a.name,exact:true})).toBeVisible();const am=await manifest(first);
    await second.goto(b.screenUrl);await expect(second.getByRole('heading',{name:b.name,exact:true})).toBeVisible();const bm=await manifest(second);
    expect(am.data.id).not.toBe(bm.data.id);expect(am.data.start_url).toBe(a.screenUrl);expect(bm.data.start_url).toBe(b.screenUrl);expect(am.data.scope).toBe(a.screenUrl);expect(bm.data.scope).toBe(b.screenUrl);
    await first.reload();expect((await manifest(first)).data.id).toBe(am.data.id);
    await command(owner,{type:'club-board.update',boardId:a.id,name:`Hoofdbaan ${suffix}`});await expect(first.getByRole('heading',{name:`Hoofdbaan ${suffix}`,exact:true})).toBeVisible();const renamed=await manifest(first);
    expect(renamed.data.name).toBe(`Oche Live · Hoofdbaan ${suffix}`);for(const key of ['id','start_url','scope'])expect(renamed.data[key]).toBe(am.data[key]);
    await expect(first.getByRole('link',{name:'Open deze baan ↗',exact:true})).toHaveAttribute('href',a.playUrl);
    training=await command(owner,{type:'board.start',boardId:a.id,mode:'solo',startScore:501});
    await expect(first.locator('.sprint-number').first()).toHaveText('501');await expect(second.getByRole('heading',{name:'Scan en speel.',exact:true})).toBeVisible();
    const scored=await command(owner,{type:'training.score',id:training!.id,score:180},training!.entity.revision);training=scored;
    await expect(first.locator('.sprint-number').first()).toHaveText('321');
    await viewer.setOffline(true);await expect(first.getByRole('status').filter({hasText:'Offline'})).toBeVisible();await expect(first.locator('.sprint-number').first()).toHaveText('321');
    await command(owner,{type:'training.finish',id:training!.id},training!.entity.revision);training=await command(owner,{type:'board.start',boardId:a.id,mode:'solo',startScore:301});
    await viewer.setOffline(false);await expect(first.locator('.sprint-number').first()).toHaveText('301');await expect(first.getByRole('status').filter({hasText:'Offline'})).toHaveCount(0);
    // A natural checkout releases the board without a separate finish button.
    training=await command(owner,{type:'training.score',id:training!.id,score:180},training!.entity.revision);
    await command(owner,{type:'training.score',id:training!.id,score:121,doubleConfirmed:true},training!.entity.revision);training=null;
    await expect(first.getByRole('heading',{name:'Scan en speel.',exact:true})).toBeVisible();
    const idle=await(await viewer.request.get(`/api/board-screens/${a.id}`)).json();expect(idle.status).toBe('available');expect(idle.snapshot.match).toBeNull();
    const fallback=await viewer.newPage();await fallback.goto(`/scorebord?baan=${a.id}`);await expect(fallback.getByLabel('Vaste baanlink of baan-ID')).toHaveValue(a.id);
    // Query parameters propose a board; only this explicit action persists it.
    expect(await fallback.evaluate(()=>localStorage.getItem('dartflow-scorebord-fixed-board-v1'))).toBeNull();
    await fallback.getByRole('button',{name:'Dit scherm aan deze baan koppelen'}).click();await expect(fallback).toHaveURL('/scorebord');await expect(fallback.getByRole('heading',{name:`Hoofdbaan ${suffix}`,exact:true})).toBeVisible();
    expect((await manifest(fallback)).data.id).toBe('/scorebord');
    await second.goto(b.screenUrl);await fallback.reload();await expect(fallback.getByRole('heading',{name:`Hoofdbaan ${suffix}`,exact:true})).toBeVisible();expect((await manifest(fallback)).data.start_url).toBe('/scorebord');
    expect(await fallback.evaluate(()=>localStorage.getItem('dartflow-scorebord-fixed-board-v1'))).toBe(a.id);expect(authRequests).toBe(0);
    await first.evaluate(async()=>{await navigator.serviceWorker.ready;await fetch('/assets/pwa/player-192.png');});
    const cached=await first.evaluate(async()=>{
      const entries:{url:string;method:string;status:number;responseType:string;hasSetCookie:boolean;contentType:string;anonymousShell:string|null}[]=[];
      for(const key of await caches.keys())if(key.startsWith('dartflow-static-')){
        const cache=await caches.open(key);
        for(const request of await cache.keys()){
          const response=await cache.match(request);
          entries.push({url:request.url,method:request.method,status:response?.status??0,responseType:response?.type??'',hasSetCookie:response?.headers.has('set-cookie')??false,contentType:response?.headers.get('content-type')??'',anonymousShell:response?.headers.get('x-dartflow-offline-shell')??null});
        }
      }
      return entries;
    });
    expect(cached.length).toBeGreaterThan(0);
    for(const entry of cached){
      const url=new URL(entry.url),path=url.pathname;
      expect(url.origin).toBe(origin);expect(url.search).toBe('');expect(url.hash).toBe('');expect(path.includes('..')).toBe(false);
      expect(entry.method).toBe('GET');expect(entry.responseType).toBe('basic');expect(entry.status).toBeGreaterThanOrEqual(200);expect(entry.status).toBeLessThan(300);expect(entry.hasSetCookie).toBe(false);
      const artwork=/^\/assets\/(?:pwa\/(?:player|scoreboard|oche-live)-(?:180|192|512)\.png|dartflow-logo\.svg|dartflow-icon\.svg|dartboard\.svg)$/.test(path);
      const immutableBundle=/^\/_next\/static\/(?:chunks|css|media)\/[A-Za-z0-9_./-]+\.(?:js|css|woff2)$/.test(path);
      const anonymousShell=path==='/speelsessie'&&entry.anonymousShell==='1'&&entry.contentType.startsWith('text/html');
      expect(artwork||immutableBundle||anonymousShell,`Unexpected cached path: ${path}`).toBe(true);
      // Private account HTML, live APIs and mutation requests never become an
      // offline response. The sole HTML exception is the marked anonymous shell.
      expect(/^\/(?:api|auth|app|wedstrijd|spelen|baan|baanscherm|scorebord)(?:\/|$)/.test(path)).toBe(false);
      if(entry.contentType.includes('text/html'))expect(anonymousShell).toBe(true);
    }
    expect(cached.filter(entry=>new URL(entry.url).pathname==='/speelsessie')).toHaveLength(1);
    expect(cached.some(entry=>/^\/_next\/static\/(?:chunks|css|media)\//.test(new URL(entry.url).pathname))).toBe(true);

  }finally{
    await viewer.setOffline(false);if(training)await command(owner,{type:'training.finish',id:training.id},training.entity.revision).catch(()=>{});
    await Promise.allSettled([owner.close(),viewer.close()]);
  }
});

test('player start retains login intent, native prompt is used and standalone installation UI is hidden',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844}}),standalone=await browser.newContext();
  try{
    const page=await context.newPage();await page.goto('/speler');await page.getByRole('link',{name:'Inloggen',exact:true}).click();expect(new URL(page.url()).searchParams.get('next')).toBe('/speler');
    await page.getByRole('button',{name:/Danny Goldenbelt/}).click();await expect(page).toHaveURL('/speler');expect((await manifest(page)).data.name).toBe('DartFlow Speler');
    // The desktop/menu button is tested on a wide viewport; phone menus keep the same component.
    await page.setViewportSize({width:1400,height:900});const button=page.getByRole('button',{name:'Installeer DartFlow',exact:true});await expect(button).toBeVisible();
    await page.evaluate(()=>{const event=new Event('beforeinstallprompt',{cancelable:true}) as Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};(window as Window&{pwaPrompts?:number}).pwaPrompts=0;event.prompt=async()=>{(window as Window&{pwaPrompts?:number}).pwaPrompts!++;};event.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(event);});
    await button.click();expect(await page.evaluate(()=>(window as Window&{pwaPrompts?:number}).pwaPrompts)).toBe(1);await expect(page.getByRole('dialog',{name:'Installeer DartFlow'})).toHaveCount(0);
    await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));await expect(button).toBeVisible();
    await button.click();await expect(page.getByRole('dialog',{name:'Installeer DartFlow'})).toBeVisible();await expect(page.getByRole('link',{name:'/speler',exact:true})).toBeVisible();
    await standalone.addInitScript(()=>Object.defineProperty(navigator,'standalone',{get:()=>true}));const installed=await standalone.newPage();await login(installed,'/speler');await expect(installed.getByRole('button',{name:'Installeer DartFlow',exact:true})).toHaveCount(0);
    expect((await manifest(installed)).data.id).toBe('/speler');
  }finally{await Promise.allSettled([context.close(),standalone.close()]);}
});

test('private board pairing survives reopening, stays board-scoped and revocation clears the screen',async({browser})=>{
  test.setTimeout(90000);
  const databaseUrl=process.env.DARTFLOW_DATABASE_ADMIN_URL;if(!databaseUrl||!['localhost','127.0.0.1'].includes(new URL(databaseUrl).hostname))throw Error('Private screen browser tests require a local database.');
  const database=new pg.Client({connectionString:databaseUrl});await database.connect();
  const owner=await browser.newContext(),display=await browser.newContext({viewport:{width:960,height:540}});
  try{
    const manager=await owner.newPage();await login(manager);const suffix=randomUUID().slice(0,6);
    const tournament=await command(owner,{type:'tournament.create',name:`Private screen ${suffix}`,boards:2});
    const boards=(await database.query('select id,name from dartflow_private.boards where event_id=$1 order by name',[tournament.entity.state.eventId])).rows;
    expect(boards).toHaveLength(2);const [a,b]=boards;
    const screen=await display.newPage();let authRequests=0;display.on('request',request=>{if(/^\/(api\/session|api\/auth|auth)(\/|$)/.test(new URL(request.url()).pathname))authRequests++;});
    await screen.goto(`/baanscherm/${a.id}`);await expect(screen.getByRole('heading',{name:'Koppel dit baanscherm'})).toBeVisible();await expect(screen.getByRole('button',{name:'Installeer dit baanscherm'})).toBeVisible();
    const created=await owner.request.post(`/api/boards/${a.id}/screen-devices`,{headers:{Origin:origin},data:{name:`TV fixture ${suffix}`}});expect(created.status(),await created.text()).toBe(200);const grant=await created.json();
    await screen.getByLabel('Koppelcode van de wedstrijdleiding').fill(grant.pairing.code);await screen.getByRole('button',{name:'Dit baanscherm koppelen',exact:true}).click();await expect(screen.getByRole('heading',{name:a.name,exact:true})).toBeVisible();
    await expect(screen.getByRole('button',{name:'Installeer dit baanscherm'})).toBeVisible();expect((await manifest(screen)).data.name).toBe(`Oche Live · ${a.name}`);
    const cookies=await display.cookies(`${origin}/api/board-screens/${a.id}`);const device=cookies.find(cookie=>cookie.name==='dartflow-screen');expect(device?.httpOnly).toBe(true);expect(device?.path).toBe(`/api/board-screens/${a.id}`);
    expect((await display.cookies(`${origin}/api/board-screens/${b.id}`)).some(cookie=>cookie.name==='dartflow-screen')).toBe(false);expect((await display.cookies(`${origin}/api/session`)).some(cookie=>cookie.name==='dartflow-screen')).toBe(false);
    await screen.reload();await expect(screen.getByRole('heading',{name:a.name,exact:true})).toBeVisible();const other=await display.newPage();await other.goto(`/baanscherm/${b.id}`);await expect(other.getByRole('heading',{name:'Koppel dit baanscherm'})).toBeVisible();
    const revoked=await owner.request.delete(`/api/boards/${a.id}/screen-devices/${grant.device.id}`,{headers:{Origin:origin}});expect(revoked.status()).toBe(200);await expect(screen.getByRole('heading',{name:'Koppel dit baanscherm'})).toBeVisible();await expect(screen.getByRole('heading',{name:a.name,exact:true})).toHaveCount(0);await expect(screen.locator('.sprint-number')).toHaveCount(0);expect(authRequests).toBe(0);
  }finally{await Promise.allSettled([owner.close(),display.close()]);await database.end();}
});

const installFixtureBoard='11111111-1111-4111-8111-111111111111';
async function installFixture(context:BrowserContext){
 await context.route(`**/api/board-screens/${installFixtureBoard}`,route=>route.fulfill({json:{board:{id:installFixtureBoard,name:'Baan installatie',clubName:'Lokale fixture',access:'all',publicScan:true,blocked:false,occupied:false,playUrl:`/baan/${installFixtureBoard}`,screenUrl:`/baanscherm/${installFixtureBoard}`,locationKind:'venue'},status:'available',snapshot:{board:{id:installFixtureBoard,name:'Baan installatie'},event:{name:'Lokale fixture'},match:null,sessionKey:'pwa-install-fixture',scoreEvents:[]}}}));
}

test('browser DOM fullscreen retains board installation, its fallback instructions and a native prompt through exit',async({browser,baseURL})=>{
 if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Fullscreen installation fixtures require loopback.');
 const context=await browser.newContext({viewport:{width:1920,height:1080},serviceWorkers:'block'});
 try{
  await installFixture(context);const page=await context.newPage();await page.goto(`/baanscherm/${installFixtureBoard}`);const install=page.getByRole('button',{name:'Installeer dit baanscherm',exact:true});await expect(install).toBeVisible();
  // This is Chromium's actual DOM Fullscreen API; no installed-app media mode is mocked here.
  await page.getByRole('button',{name:'Volledig scherm',exact:true}).click();await expect.poll(()=>page.evaluate(()=>Boolean(document.fullscreenElement))).toBe(true);await expect(install).toBeVisible();
  await install.click();await expect(page.getByRole('dialog',{name:'Installeer dit baanscherm',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:`/baanscherm/${installFixtureBoard}`,exact:true})).toBeVisible();await page.getByRole('button',{name:'Installatie sluiten',exact:true}).click();
  await page.evaluate(()=>{const event=new Event('beforeinstallprompt',{cancelable:true}) as Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};(window as Window&{pwaPrompts?:number}).pwaPrompts=0;event.prompt=async()=>{(window as Window&{pwaPrompts?:number}).pwaPrompts!++;};event.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(event);});
  await install.click();expect(await page.evaluate(()=>(window as Window&{pwaPrompts?:number}).pwaPrompts)).toBe(1);await expect(page.getByRole('dialog',{name:'Installeer dit baanscherm',exact:true})).toHaveCount(0);
  await page.evaluate(()=>document.exitFullscreen());await expect.poll(()=>page.evaluate(()=>Boolean(document.fullscreenElement))).toBe(false);await expect(install).toBeVisible();await install.click();await expect(page.getByRole('dialog',{name:'Installeer dit baanscherm',exact:true})).toBeVisible();
 }finally{await context.close();}
});

test('fullscreen alone is not an app window while observed standalone, minimal-ui and iOS app windows remain installed',async({browser,baseURL})=>{
 if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Display-mode fixtures require loopback.');
 for(const scenario of [{mode:'fullscreen',ios:false,app:false},{mode:'standalone',ios:false,app:true},{mode:'minimal-ui',ios:false,app:true},{mode:'browser',ios:true,app:true}]){
  const context=await browser.newContext({viewport:{width:1920,height:1080},serviceWorkers:'block'});
  try{
   // These media modes model launch context; they do not claim a physical OS installation.
   await context.addInitScript(({initialMode,ios})=>{
    let mode=initialMode;const original=window.matchMedia.bind(window),queries=new Set<MediaQueryList>();
    const matches=(query:string)=>Array.from(query.matchAll(/\(display-mode:\s*([-\w]+)\)/g)).some(match=>match[1]===mode);
    window.matchMedia=query=>{const result=original(query);if(query.includes('display-mode:')){Object.defineProperty(result,'matches',{get:()=>matches(query)});queries.add(result);}return result;};
    Object.defineProperty(navigator,'standalone',{get:()=>ios});
    (window as Window&{setPwaDisplayMode?:(next:string)=>void}).setPwaDisplayMode=next=>{const previous=new Map(Array.from(queries,query=>[query,query.matches]));mode=next;for(const query of queries)if(previous.get(query)!==query.matches)query.dispatchEvent(new MediaQueryListEvent('change',{matches:query.matches,media:query.media}));};
   },{initialMode:scenario.mode,ios:scenario.ios});
   await installFixture(context);const page=await context.newPage();await page.goto(`/baanscherm/${installFixtureBoard}`);await expect(page.locator('.oche-stage')).toBeVisible();const install=page.getByRole('button',{name:'Installeer dit baanscherm',exact:true});
   if(scenario.app){
    await expect(install).toHaveCount(0);await page.getByRole('button',{name:'Volledig scherm',exact:true}).click();await expect.poll(()=>page.evaluate(()=>Boolean(document.fullscreenElement))).toBe(true);
    await page.evaluate(()=>(window as Window&{setPwaDisplayMode?:(next:string)=>void}).setPwaDisplayMode!('fullscreen'));await expect(install).toHaveCount(0);
    await page.evaluate(()=>document.exitFullscreen());await page.evaluate(()=>(window as Window&{setPwaDisplayMode?:(next:string)=>void}).setPwaDisplayMode!('browser'));await expect(install).toHaveCount(0);
   }else{
    await expect(install).toBeVisible();await install.click();await expect(page.getByRole('dialog',{name:'Installeer dit baanscherm',exact:true})).toBeVisible();await page.getByRole('button',{name:'Installatie sluiten',exact:true}).click();
    await page.evaluate(()=>(window as Window&{setPwaDisplayMode?:(next:string)=>void}).setPwaDisplayMode!('browser'));await expect(install).toBeVisible();
   }
  }finally{await context.close();}
 }
});
