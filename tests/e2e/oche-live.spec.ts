import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const origin='http://localhost:3000',fixtureId='11111111-1111-4111-8111-111111111111';
const visualFixture={board:{id:fixtureId,name:'Mijn thuisbaan',clubName:'Thuis',access:'club',publicScan:false,blocked:false,occupied:false,playUrl:`/baan/${fixtureId}`,screenUrl:`/baanscherm/${fixtureId}`,locationKind:'home'},status:'available',snapshot:{board:{id:fixtureId,name:'Mijn thuisbaan'},event:{name:'Thuis'},match:null,sessionKey:'visual-reference-idle',scoreEvents:[]}};

test('restricted home cast fills the landscape signal and retains its installed board identity',async({browser,baseURL},testInfo)=>{
  if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Visual fixtures are restricted to loopback.');
  const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,serviceWorkers:'block'});
  try{
    await context.route(`**/api/board-screens/${fixtureId}`,route=>route.fulfill({json:visualFixture}));
    const page=await context.newPage();await page.goto(`/oche-live/${fixtureId}`);await expect(page.getByRole('heading',{name:'Scan en speel.',exact:true})).toBeVisible();await expect(page.locator('.oche-qr img')).toHaveAttribute('src',/^data:image\/png/);await page.evaluate(()=>document.fonts.ready);
    await expect(page.locator('head link[rel=manifest]')).toHaveAttribute('href',`/api/board-screens/${fixtureId}/manifest.webmanifest`);await expect(page.getByRole('link',{name:'Registreren, aanmelden en spelen',exact:true})).toHaveAttribute('href',`/baan/${fixtureId}`);
    for(const [width,height]of [[1920,1080],[1280,720],[960,540]]){
      await page.setViewportSize({width,height});await expect(page.getByRole('button',{name:'Volledig scherm',exact:true})).toBeVisible();
      const layout=await page.locator('.oche-stage').evaluate(node=>{const element=node as HTMLElement,r=element.getBoundingClientRect(),qr=node.querySelector('.oche-qr img') as HTMLImageElement;return{width:element.clientWidth,height:element.clientHeight,rect:{x:r.x,y:r.y,width:r.width,height:r.height},qrWidth:qr.getBoundingClientRect().width,qrHeight:qr.getBoundingClientRect().height,qrCardWidth:(node.querySelector('.oche-qr') as HTMLElement).clientWidth,pageWidth:document.documentElement.scrollWidth};});
      expect(layout.width).toBe(height);expect(layout.height).toBe(width);expect(layout.rect).toEqual({x:0,y:0,width,height});expect(layout.pageWidth).toBeLessThanOrEqual(width+1);expect(layout.qrCardWidth).toBeCloseTo(height*.48,0);expect(layout.qrWidth).toBeGreaterThan(height*.45);expect(layout.qrHeight).toBeCloseTo(layout.qrWidth,1);
    }
    await page.setViewportSize({width:1920,height:1080});await testInfo.attach('oche-home-cast-1920x1080',{body:await page.screenshot(),contentType:'image/png'});
  }finally{await context.close();}
});

async function command(context:BrowserContext,action:Record<string,unknown>,expectedRevision?:number,requestId=randomUUID()){
 const response=await context.request.post('/api/platform/actions',{headers:{Origin:origin},data:{requestId,action,...(expectedRevision===undefined?{}:{expectedRevision})}});expect(response.status(),await response.text()).toBe(200);return response.json();
}
async function ready(page:Page,score:string){await expect(page.locator('.sprint-number').first()).toHaveText(score);}

test('real accepted board actions celebrate once, skip initial/reconnect/undo and preserve the final checkout after release',async({browser,baseURL},testInfo)=>{
 test.setTimeout(120000);if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Score-event tests require loopback fixtures.');
 const owner=await browser.newContext(),display=await browser.newContext({viewport:{width:960,height:540},reducedMotion:'reduce',serviceWorkers:'block',recordVideo:{dir:testInfo.outputPath('oche-video'),size:{width:960,height:540}}});let page:Page|undefined;let training:{id:string;entity:{revision:number}}|null=null;
 try{
  const manager=await owner.newPage();await manager.goto('/inloggen?next=/app/clubs');await manager.getByRole('button',{name:/Danny Goldenbelt/}).click();await expect(manager).toHaveURL('/app/clubs');
  const suffix=randomUUID().slice(0,6),club=await command(owner,{type:'club.create',name:`Oche actions ${suffix}`});await command(owner,{type:'location.enable-venue'});const board=(await command(owner,{type:'club-board.create',clubId:club.id,name:`Oche ${suffix}`})).board;
  training=await command(owner,{type:'board.start',boardId:board.id,mode:'solo',startScore:501});page=await display.newPage();await page.goto(board.screenUrl);await ready(page,'501');await expect(page.locator('.oche-celebration')).toHaveCount(0);
  await page.evaluate(()=>{const seen=new Set<string>();(window as Window&{ocheObserved?:string[]}).ocheObserved=[];new MutationObserver(()=>{document.querySelectorAll('.oche-celebration[data-event-id]').forEach(node=>{const id=node.getAttribute('data-event-id')!;if(!seen.has(id)){seen.add(id);(window as Window&{ocheObserved?:string[]}).ocheObserved!.push(id);}});}).observe(document.body,{childList:true,subtree:true});});
  const requestId=randomUUID(),revision=training!.entity.revision;const score={type:'training.score',id:training!.id,score:180};training=await command(owner,score,revision,requestId);await expect(page.getByRole('status',{name:'Maximum: 180'})).toBeVisible();expect(await page.locator('.oche-celebration').evaluate(node=>getComputedStyle(node).animationName)).toBe('none');await expect(page.locator('.oche-celebration')).toHaveCount(0);
  await command(owner,score,revision,requestId);await page.waitForTimeout(2200);expect(await page.evaluate(()=>(window as Window&{ocheObserved?:string[]}).ocheObserved!.length)).toBe(1);
  await display.setOffline(true);await expect(page.locator('.board-screen-offline')).toBeVisible();training=await command(owner,{type:'training.score',id:training!.id,score:180},training!.entity.revision);await display.setOffline(false);await ready(page,'141');await expect(page.locator('.oche-celebration')).toHaveCount(0);
  training=await command(owner,{type:'training.undo',id:training!.id},training!.entity.revision);await ready(page,'321');training=await command(owner,{type:'training.undo',id:training!.id},training!.entity.revision);await ready(page,'501');expect(await page.evaluate(()=>(window as Window&{ocheObserved?:string[]}).ocheObserved!.length)).toBe(1);
  await page.emulateMedia({reducedMotion:'no-preference'});
  for(const remaining of ['321','141']){training=await command(owner,{type:'training.score',id:training!.id,score:180},training!.entity.revision);await ready(page,remaining);await expect(page.getByRole('status',{name:'Maximum: 180'})).toBeVisible();expect(await page.locator('.oche-celebration').evaluate(node=>getComputedStyle(node).animationName)).toBe('oche-arrive');await expect(page.locator('.oche-celebration')).toHaveCount(0);}
  const lastId=training!.id;await command(owner,{type:'training.score',id:lastId,score:141,doubleConfirmed:true},training!.entity.revision);training=null;
  // The final cue belongs to the confirmed checkout, before the new standby clock reaches its QR slide.
  await expect(page.getByRole('status',{name:'Hoge finish: 141'})).toBeVisible();await expect(page.locator('.oche-celebration')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as Window&{ocheObserved?:string[]}).ocheObserved!.length)).toBe(4);
  await expect(page.locator('.oche-stage[data-standby-slide]')).toBeVisible();await expect(page.getByRole('heading',{name:'Scan en speel.',exact:true})).toBeVisible();
  const initial=await display.newPage();await initial.goto(board.screenUrl);await expect(initial.locator('.oche-stage')).toHaveAttribute('data-standby-slide','1');await expect(initial.locator('.oche-celebration')).toHaveCount(0);
  await expect(initial.getByRole('heading',{name:'Scan en speel.',exact:true})).toBeVisible();await expect(initial.locator('.oche-celebration')).toHaveCount(0);
 }finally{await display.setOffline(false);if(training)await command(owner,{type:'training.finish',id:training.id},training.entity.revision).catch(()=>{});const video=page?.video();await Promise.allSettled([owner.close(),display.close()]);if(video)await testInfo.attach('oche-live-confirmed-actions-reconnect-undo-and-motion',{path:await video.path(),contentType:'video/webm'});}
});


test('legacy token and spectator displays use confirmed event cues without replaying the initial snapshot',async({browser,baseURL})=>{
 test.setTimeout(30000);if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Legacy display fixtures require loopback.');
 const token='L'.repeat(43);
 for(const routePath of [`/scherm/${token}`,`/app/spectator/${token}`]){
  const context=await browser.newContext({viewport:{width:540,height:960},serviceWorkers:'block',reducedMotion:'reduce'});
  try{
   const snapshot={sessionKey:'legacy-fixture-session',scoreEvents:[{id:'old-maximum',revision:1,kind:'score',score:180,playerIndex:0}],board:{id:fixtureId,name:'Baan legacy'},event:{name:'Schermcompatibiliteit'},match:{id:'legacy-match',revision:1,status:'live',players:[{id:'player-1',name:'Robin'},{id:'player-2',name:'Sam'}],remaining:[321,501],legs:[0,0],sets:[0,0],turn:1,checkout:null,visits:[],winnerId:null,resultPublished:false,writerId:'',settings:{startScore:501,bestOfLegs:1,bestOfSets:1},stats:[],legNumber:1,setNumber:1,paused:false}};
   let current:Record<string,unknown>=snapshot;
   await context.route(`**/api/screen/${token}`,route=>route.fulfill({json:current}));
   await context.route('**/api/session',route=>route.fulfill({json:{user:null,local:true}}));
   const page=await context.newPage();await page.goto(routePath);await ready(page,'321');await expect(page.locator('.oche-celebration')).toHaveCount(0);
   current={...snapshot,scoreEvents:[...snapshot.scoreEvents,{id:'fresh-maximum',revision:2,kind:'score',score:180,playerIndex:1}],match:{...snapshot.match,revision:2,remaining:[321,321],turn:0}};
   await expect(page.getByRole('status',{name:'Maximum: 180'})).toBeVisible();await expect(page.locator('.oche-celebration')).toHaveCount(0);await page.waitForTimeout(1650);await expect(page.locator('.oche-celebration')).toHaveCount(0);
   current={...snapshot,scoreEvents:[{id:'fresh-finish',revision:3,kind:'score',score:121,checkout:true,playerName:'Robin'}],match:null};
   await expect(page.getByRole('status',{name:'Hoge finish: 121'})).toBeVisible();await expect(page.locator('.oche-celebration')).toHaveCount(0);
  }finally{await context.close();}
 }
});
