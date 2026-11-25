import {test,expect,type Page} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import type {OcheDisplaySnapshot,OchePairing} from '../../lib/oche-device-types';

const fixture=async(name:string)=>JSON.parse(await readFile(`contracts/fixtures/oche-display-v1-panels/${name}.json`,'utf8')) as OcheDisplaySnapshot;
async function display(page:Page,read:()=>OcheDisplaySnapshot){
 await page.route('**/api/oche/v1/snapshot?**',route=>route.fulfill({json:read()}));
 await page.route('**/api/oche/v1/events?**',route=>route.fulfill({json:{apiVersion:1,eventId:read().eventId,reset:false,snapshot:read()}}));
 await page.goto('/oche-live');
}

test('first start requires confirmation, back preserves choice, failed code and restart keep saved layout',async({page})=>{
 let starts=0,fail=true,proposed:unknown=null;
 const pairing:OchePairing={installationId:'00000000-0000-4000-8000-000000000001',code:'ABCD-2345',expiresAt:new Date(Date.now()+600000).toISOString(),serverNow:Date.now(),verificationUrl:'http://localhost:3000/koppel-scherm#code=ABCD2345',pollAfterMs:2000};
 for(const path of ['snapshot?**','refresh','status'])await page.route(`**/api/oche/v1/${path}`,route=>route.fulfill({status:401,json:{code:'device_unauthorized'}}));
 await page.route('**/api/oche/v1/start',async route=>{starts++;proposed=route.request().postDataJSON().layoutProposal;await route.fulfill(fail?{status:503,json:{message:'Probeer opnieuw.'}}:{json:pairing});});
 await page.goto('/oche-live');await expect(page.getByRole('heading',{name:'Hoe staat dit scherm?'})).toBeVisible();expect(starts).toBe(0);
 await page.getByRole('button',{name:'Horizontaal 16:9',exact:true}).click();await page.getByRole('button',{name:'Doorgaan',exact:true}).click();await page.getByRole('button',{name:/Twee scoreborden/}).click();await page.getByRole('button',{name:'Terug',exact:true}).click();await expect(page.getByRole('button',{name:'Horizontaal 16:9',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByRole('button',{name:'Doorgaan',exact:true}).click();await expect(page.getByRole('button',{name:/Twee scoreborden/})).toHaveAttribute('aria-pressed','true');await page.getByRole('button',{name:'Opslaan en doorgaan'}).click();await expect.poll(()=>starts).toBe(1);expect(proposed).toEqual({orientation:'landscape',scoreboards:2});await expect(page.getByRole('heading',{name:'Koppelcode verlopen'})).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('dartflow-oche-layout-v1'))).toBe(JSON.stringify(proposed));fail=false;await page.reload();await expect(page.locator('.oche-device-code')).toHaveText('ABCD–2345');await expect(page.getByRole('heading',{name:'Hoe staat dit scherm?'})).toHaveCount(0);
});

test('portrait confirmation skips scoreboard count and D-pad reaches save',async({page})=>{
 for(const path of ['snapshot?**','refresh','status'])await page.route(`**/api/oche/v1/${path}`,route=>route.fulfill({status:401,json:{code:'device_unauthorized'}}));
 let body:unknown;await page.route('**/api/oche/v1/start',route=>{body=route.request().postDataJSON();return route.fulfill({status:503,json:{message:'Fixture offline'}});});
 await page.setViewportSize({width:1080,height:1920});await page.goto('/oche-live');const choice=page.getByRole('button',{name:/Verticaal 9:16/});await expect(choice).toHaveAttribute('aria-pressed','true');await expect(choice).toBeFocused();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await expect(page.getByRole('button',{name:'Opslaan en doorgaan'})).toBeFocused();await page.keyboard.press('Enter');await expect.poll(()=>body).toMatchObject({layoutProposal:{orientation:'portrait',scoreboards:1}});await expect(page.getByRole('heading',{name:'Hoeveel scoreborden wil je tonen?'})).toHaveCount(0);
});

test('legacy active match is uninterrupted, migration can be deferred and remains in menu',async({page})=>{
 let snapshot=await fixture('both-live');delete snapshot.layout;delete snapshot.panels;
 await display(page,()=>snapshot);await expect(page.locator('.sprint-number')).toHaveText(['148','188']);await expect(page.locator('.oche-layout-wizard')).toHaveCount(0);
 snapshot={...snapshot,display:null,state:'standby',eventId:'safe-start'};await expect(page.getByRole('heading',{name:'Hoe staat dit scherm?'})).toBeVisible();await page.getByRole('button',{name:'Later',exact:true}).click();await page.reload();await expect(page.locator('.oche-layout-wizard')).toHaveCount(0);await page.getByRole('button',{name:'Schermmenu'}).click();await page.getByRole('button',{name:'Schermindeling wijzigen'}).click();await expect(page.getByRole('heading',{name:'Hoe staat dit scherm?'})).toBeVisible();
});

test('split fixtures keep QR fixed, isolate scores, events, warnings, missing lanes and revocation',async({page},testInfo)=>{
 test.setTimeout(90000);let snapshot=await fixture('left-live-right-free'),revoked=false;const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/oche/v1/snapshot?**',route=>route.fulfill({json:snapshot}));await page.route('**/api/oche/v1/events?**',route=>route.fulfill(revoked?{status:410,json:{code:'device_revoked',message:'Dit scherm is ontkoppeld.'}}:{json:{apiVersion:1,eventId:snapshot.eventId,reset:false,snapshot}}));await page.goto('/oche-live');
 const left=page.getByRole('region',{name:'Baan links',exact:true}),right=page.getByRole('region',{name:'Baan rechts',exact:true});
 await expect(left.locator('.sprint-number')).toHaveText(['148','188']);await expect(page.locator('.oche-wayfinder-card[data-position=right] .qr-image')).toBeVisible();
 const qr=page.locator('.oche-wayfinder-card[data-position=right] .qr-image');const before=await qr.boundingBox();const info=await page.locator('.oche-wayfinder-card[data-position=right]').boundingBox();expect(before!.x+before!.width).toBeLessThanOrEqual(info!.x+info!.width);expect(before!.y+before!.height).toBeLessThanOrEqual(info!.y+info!.height);await page.waitForTimeout(5200);expect(await qr.boundingBox()).toEqual(before);await expect(page.locator('.oche-wayfinder-card[data-position=right] .club-board-qr>a')).toHaveAttribute('href',`/baan/${snapshot.panels![1].sourceId}`);
 await mkdir('docs/evidence/oche-splitscreen',{recursive:true});
 for(const [width,height]of [[1920,1080],[1280,720]]){
  await page.setViewportSize({width,height});const panels=await page.locator('.oche-device-panel').evaluateAll(nodes=>nodes.map(node=>{const b=node.getBoundingClientRect(),score=node.querySelector('.sprint-scroll')?.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,scrollBottom:score?.bottom};}));expect(panels[0].width).toBeCloseTo(panels[1].width,0);expect(panels[0].x+panels[0].width).toBeLessThanOrEqual(panels[1].x);expect(panels[0].scrollBottom).toBeLessThanOrEqual(height);for(const card of await page.locator('.oche-device-panel-content').all()){const b=await card.boundingBox();expect(b!.height/b!.width).toBeCloseTo(16/9,2);}expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  const path=`docs/evidence/oche-splitscreen/left-live-right-free-${width}x${height}.png`;await page.screenshot({path});await testInfo.attach(`mixed-${width}`,{path,contentType:'image/png'});
 }
 snapshot=await fixture('both-live');await expect(right.locator('.sprint-number')).toHaveCount(2);await expect(qr).toHaveCount(0);const rightScores=await right.locator('.sprint-number').allTextContents();
 const leftMatch=snapshot.panels![0].snapshot!.display!.snapshot.match!;leftMatch.remaining=[88,188];leftMatch.revision++;const visit={player:'player-1',playerIndex:0,score:60,darts:3 as const,remainingBefore:148,remainingAfter:88,bust:false,leg:leftMatch.legNumber,checkout:false};leftMatch.visits=[...leftMatch.visits,visit];leftMatch.currentLegVisits=[...(leftMatch.currentLegVisits??leftMatch.visits.slice(0,-1)),visit];
 await expect(left.locator('.sprint-number')).toHaveText(['88','188']);await expect(right.locator('.sprint-number')).toHaveText(rightScores);
 for(const [width,height]of [[1920,1080],[1280,720]]){await page.setViewportSize({width,height});const path=`docs/evidence/oche-splitscreen/both-live-${width}x${height}.png`;await page.screenshot({path});await testInfo.attach(`both-${width}`,{path,contentType:'image/png'});}
 const live=snapshot.panels![0].snapshot!.display!.snapshot;live.match!.revision++;live.scoreEvents=[...(live.scoreEvents??[]),{id:'new-left-180',revision:live.match!.revision,kind:'score',score:180,playerIndex:0}];await expect(left.getByRole('status',{name:'Maximum: 180'})).toBeVisible();await expect(right.locator('.oche-celebration')).toHaveCount(0);
 live.boardActivity={sessionId:'fixture-warning',sourceId:'fixture-match',sourceKind:'match',boardIds:[snapshot.panels![0].sourceId!],kind:'free',phase:'warning',activityAt:Date.now()-125000,warningAt:Date.now()-5000,deadlineAt:Date.now()+55000,serverNow:Date.now(),warningEpoch:'warn-left',extensionsUsed:0,maxExtensions:2,canExtend:true} as NonNullable<typeof live.boardActivity>;
 await expect(left.getByText('Tik op Doorspelen op je telefoon',{exact:true})).toBeVisible();await expect(right.locator('.sprint-number')).toHaveText(rightScores);
 snapshot.panels![0]={position:'left',sourceId:snapshot.panels![0].sourceId,status:'unavailable',snapshot:null};await expect(left.getByRole('heading',{name:'Baan niet beschikbaar'})).toBeVisible();await expect(right.locator('.sprint-number')).toHaveText(rightScores);
 revoked=true;await expect(page.getByRole('heading',{name:'Scherm ontkoppeld'})).toBeVisible({timeout:5000});await expect(page.locator('.sprint-number,.oche-wayfinder-card .qr-image')).toHaveCount(0);expect(errors).toEqual([]);
});

test('saved portrait and landscape never follow viewport or switch source',async({page})=>{
 let snapshot=await fixture('both-live');delete snapshot.panels;snapshot.layout={orientation:'portrait',scoreboards:1};
 await display(page,()=>snapshot);
 for(const [width,height]of [[1920,1080],[1280,720],[1080,1920]]){await page.setViewportSize({width,height});await expect(page.locator('.sprint-number')).toHaveText(['148','188']);const bounds=await page.locator('.sprint-frame').boundingBox();expect(bounds!.height/bounds!.width).toBeCloseTo(16/9,2);expect(bounds!.height).toBeLessThanOrEqual(height);await expect(page.locator('.oche-device-display')).toHaveAttribute('data-layout','portrait');}
 snapshot={...snapshot,layout:{orientation:'landscape',scoreboards:1}};await expect(page.locator('.oche-device-display')).toHaveAttribute('data-layout','landscape');for(const [width,height]of [[1920,1080],[1280,720],[1080,1920]]){await page.setViewportSize({width,height});const bounds=await page.locator('.sprint-frame').boundingBox();expect(bounds!.width/bounds!.height).toBeCloseTo(16/9,2);await expect(page.locator('.sprint-number')).toHaveText(['148','188']);}
});

test('pane session changes and primary reset baseline only that lane, and offline hides both play QRs',async({page})=>{
 let snapshot=await fixture('both-live'),reset=false;await page.route('**/api/oche/v1/snapshot?**',route=>route.fulfill({json:snapshot}));await page.route('**/api/oche/v1/events?**',route=>route.fulfill({json:{apiVersion:1,eventId:snapshot.eventId,reset,snapshot}}));await page.goto('/oche-live');
 const left=page.getByRole('region',{name:'Baan links',exact:true}),right=page.getByRole('region',{name:'Baan rechts',exact:true});await expect(left.locator('.sprint-number')).toHaveCount(2);await expect(right.locator('.sprint-number')).toHaveCount(2);
 const first=snapshot.panels![0].snapshot!.display!.snapshot,second=snapshot.panels![1].snapshot!.display!.snapshot;
 // Left switches source with historical maximum; the same poll accepts a fresh right maximum.
 first.sessionKey='new-left-session';first.match!.revision=20;first.scoreEvents=[{id:'old-left-180',revision:20,kind:'score',score:180,playerIndex:0}];second.match!.revision++;second.scoreEvents=[...(second.scoreEvents??[]),{id:'fresh-right-180',revision:second.match!.revision,kind:'score',score:180,playerIndex:0}];reset=true;
 await expect(right.getByRole('status',{name:'Maximum: 180'})).toBeVisible();await expect(left.locator('.oche-celebration')).toHaveCount(0);
 // Both become independently available, showing different canonical links at once.
 const free=await fixture('left-live-right-free');snapshot=free;const freeLeft=structuredClone(free.panels![1]);freeLeft.position='left';freeLeft.sourceId=free.board!.id;freeLeft.snapshot!.board={...free.board!};freeLeft.snapshot!.display!.board.id=free.board!.id;freeLeft.snapshot!.display!.board.name=free.board!.name;snapshot.panels![0]=freeLeft;reset=false;
 await expect(page.locator('.oche-wayfinder-card .qr-image')).toHaveCount(2);await expect(page.locator('.oche-wayfinder-card[data-position=left] .club-board-qr>a')).toHaveAttribute('href',`/baan/${free.board!.id}`);await expect(page.locator('.oche-wayfinder-card[data-position=right] .club-board-qr>a')).toHaveAttribute('href',`/baan/${free.panels![1].sourceId}`);
 await page.context().setOffline(true);await expect(page.locator('.oche-device-offline')).toBeVisible();await expect(page.locator('.oche-wayfinder-card .qr-image')).toHaveCount(0);await page.context().setOffline(false);await expect(page.locator('.oche-wayfinder-card .qr-image')).toHaveCount(2);await expect(page.locator('.oche-celebration')).toHaveCount(0);
});

test('a paired proposal keeps effective layout until server confirmation and single-lane errors use panel status',async({page})=>{
 let snapshot=await fixture('both-live');let proposals=0;await display(page,()=>snapshot);
 await page.route('**/api/oche/v1/layout-proposal',route=>{proposals++;expect(route.request().postDataJSON().layout).toEqual({orientation:'portrait',scoreboards:1});return route.fulfill({json:{installationId:'draft',code:'ABCD-2345',expiresAt:new Date(Date.now()+600000).toISOString(),serverNow:Date.now(),verificationUrl:'http://localhost:3000/koppel-scherm#code=ABCD2345'}});});
 await page.getByRole('button',{name:'Schermmenu'}).click();await page.getByRole('button',{name:'Schermindeling wijzigen'}).click();await page.getByRole('button',{name:/Verticaal 9:16/}).click();await page.getByRole('button',{name:'Opslaan en doorgaan'}).click();await expect(page.getByRole('heading',{name:'Bevestig op je telefoon'})).toBeVisible();expect(proposals).toBe(1);await expect(page.locator('.oche-device-display')).toHaveAttribute('data-layout','dual');
 snapshot={...snapshot,layout:{orientation:'portrait',scoreboards:1},configurationRevision:(snapshot.configurationRevision??0)+1};await expect(page.locator('.oche-device-display')).toHaveAttribute('data-layout','portrait');await expect(page.locator('.oche-layout-confirm')).toHaveCount(0);
 snapshot={...snapshot,display:null,panels:[{position:'left',sourceId:snapshot.board!.id,status:'unavailable',snapshot:null}]};await expect(page.getByRole('heading',{name:'Baan niet beschikbaar'})).toBeVisible();await expect(page.locator('.sprint-number')).toHaveCount(0);
});
