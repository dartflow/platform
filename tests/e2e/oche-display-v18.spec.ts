import {test,expect,type BrowserContext} from '@playwright/test';
import type {ClubBoardScreenView,Visit} from '../../lib/types';

const boardId='11111111-1111-4111-8111-111111111111';
function visitsFor(left:number[],right:number[]):Visit[]{
 const remaining=[501,501],visits:Visit[]=[];
 for(let row=0;row<Math.max(left.length,right.length);row++)for(let side=0;side<2;side++){const score=(side===0?left:right)[row];if(score===undefined)continue;const before=remaining[side];remaining[side]-=score;visits.push({player:`player-${side+1}`,playerIndex:side,score,darts:3,remainingBefore:before,remainingAfter:remaining[side],bust:false,leg:1,checkout:remaining[side]===0});}
 return visits;
}
function fixture():ClubBoardScreenView{
 const visits=visitsFor([85,100,60,58,50],[45,100,60,60,48]);
 return {board:{id:boardId,name:'Baan 04',clubName:'Locatie',access:'all',publicScan:true,blocked:false,occupied:true,playUrl:`/baan/${boardId}`,screenUrl:`/baanscherm/${boardId}`,locationKind:'venue'},status:'playing',snapshot:{board:{id:boardId,name:'Baan 04'},event:{name:'Lokale wedstrijd'},sessionKey:'oche-v18-fixture',scoreEvents:[],match:{id:'fixture-match',revision:10,status:'live',scoringMode:'shared-writer',players:[{id:'player-1',name:'Danny'},{id:'player-2',name:'Rick'}],remaining:[148,188],legs:[0,0],sets:[0,0],turn:0,checkout:null,visits,currentLegVisits:visits,currentLegStartScore:501,winnerId:null,resultPublished:false,writerId:'',settings:{startScore:501,bestOfLegs:3,bestOfSets:1},stats:[{total:353,darts:15,oneEighties:0,highestFinish:0},{total:313,darts:15,oneEighties:0,highestFinish:0}],legNumber:1,setNumber:1,paused:false}}};
}
async function installFixture(context:BrowserContext,read:()=>ClubBoardScreenView){
 await context.route(`**/api/board-screens/${boardId}`,route=>route.fulfill({json:read()}));
}
function localOnly(baseURL:string|undefined){if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Display fixtures require a loopback origin.');}

test('live scorecard keeps mirrored rows, canonical leg data, stable number fonts and manual scroll across polls and undo',async({browser,baseURL},testInfo)=>{
 localOnly(baseURL);const context=await browser.newContext({viewport:{width:960,height:540},serviceWorkers:'block',reducedMotion:'reduce'});let data=fixture();
 try{
  await installFixture(context,()=>data);const page=await context.newPage();await page.goto(`/baanscherm/${boardId}`);await expect(page.locator('.sprint-number')).toHaveText(['148','188']);await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('.sprint-table thead th')).toHaveText(['Worp','Rest','Rest','Worp']);await expect(page.locator('.sprint-table tbody tr').last().locator('td')).toHaveText(['50','148','188','48']);
  const dimensions=await page.locator('.sprint-score').first().boundingBox();const numberFont=await page.locator('.sprint-number').first().evaluate(node=>({size:getComputedStyle(node).fontSize,line:getComputedStyle(node).lineHeight,family:getComputedStyle(node).fontFamily}));
  await testInfo.attach('oche-live-v18-540x960',{body:await page.screenshot(),contentType:'image/png'});
  const next={player:'player-1',playerIndex:0,score:60,darts:3,remainingBefore:148,remainingAfter:88,bust:false,leg:1,checkout:false};
  data={...data,snapshot:{...data.snapshot,scoreEvents:[{id:'accepted-11',revision:11,kind:'score',score:60,playerIndex:0}],match:{...data.snapshot.match!,revision:11,remaining:[88,188],turn:1,visits:[...data.snapshot.match!.visits,next],currentLegVisits:[...data.snapshot.match!.visits,next]}}};
  await expect(page.locator('.sprint-number')).toHaveText(['88','188']);await expect(page.locator('.sprint-table tbody tr').last().locator('td')).toHaveText(['60','88','','']);
  expect(await page.locator('.sprint-score').first().boundingBox()).toEqual(dimensions);expect(await page.locator('.sprint-number').first().evaluate(node=>({size:getComputedStyle(node).fontSize,line:getComputedStyle(node).lineHeight,family:getComputedStyle(node).fontFamily}))).toEqual(numberFont);
  await expect.poll(()=>page.locator('.sprint-scroll').evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
  await page.locator('.sprint-scroll').evaluate(node=>{node.scrollTop=0;});data={...data,snapshot:{...data.snapshot,match:{...data.snapshot.match!,revision:12,paused:true}}};
  await expect(page.locator('.sprint-status')).toHaveText('Gepauzeerd');expect(await page.locator('.sprint-scroll').evaluate(node=>node.scrollTop)).toBe(0);
  const undoVisits=data.snapshot.match!.visits.slice(0,-1);data={...data,snapshot:{...data.snapshot,scoreEvents:[{id:'undo-13',revision:13,kind:'undo'}],match:{...data.snapshot.match!,revision:13,remaining:[148,188],paused:false,visits:undoVisits,currentLegVisits:undoVisits}}};
  await expect(page.locator('.sprint-number')).toHaveText(['148','188']);expect(await page.locator('.sprint-scroll').evaluate(node=>node.scrollTop)).toBe(0);
  const current:Visit={player:'player-1',playerIndex:0,score:0,darts:3,remainingBefore:301,remainingAfter:301,bust:true,leg:1,checkout:false};data={...data,snapshot:{...data.snapshot,scoreEvents:[],match:{...data.snapshot.match!,revision:14,setNumber:2,legNumber:1,remaining:[301,301],visits:[...undoVisits,current],currentLegVisits:[current],currentLegStartScore:301}}};
  await expect(page.locator('.sprint-start td')).toHaveText(['–','301','301','–']);await expect(page.locator('.sprint-table tbody tr').first().locator('td')).toHaveText(['0','301','','']);await expect(page.locator('.sprint-throw[data-bust=true]')).toHaveText('0');expect(await page.locator('.sprint-scroll').evaluate(node=>node.scrollTop)).toBe(0);
  data={...data,snapshot:{...data.snapshot,match:{...data.snapshot.match!,revision:15,remaining:[1,301]}}};await expect(page.locator('.sprint-number')).toHaveText(['1','301']);expect(await page.locator('.sprint-number').first().evaluate(node=>getComputedStyle(node).fontSize)).toBe(numberFont.size);
  const now=Date.now();data={...data,snapshot:{...data.snapshot,boardActivity:{sessionId:boardId,sourceId:'fixture-match',sourceKind:'match',kind:'free',phase:'warning',serverNow:now,activityAt:now-120000,warningAt:now,deadlineAt:now+60000,warningEpoch:'fixture-warning',extensionsUsed:0,maxExtensions:2,boardIds:[boardId],canExtend:true}}};
  await expect(page.locator('.board-activity-display')).toBeVisible();
  const bounds=await page.evaluate(()=>{const rect=(selector:string)=>{const r=document.querySelector(selector)!.getBoundingClientRect();return{x:r.x,right:r.right,height:r.height};};return{warning:rect('.board-activity-display'),header:rect('.sprint-head'),footer:rect('.sprint-foot'),frame:rect('.sprint-frame')};});
  expect(bounds.warning.x).toBeGreaterThanOrEqual(bounds.footer.right-.5);expect(bounds.warning.right).toBeLessThanOrEqual(bounds.header.x+.5);expect(bounds.warning.height).toBeCloseTo(bounds.frame.height,1);

 }finally{await context.close();}
});

test('standby follows one five-ten-fifteen clock, shares both QR targets and restarts only after leaving an eligible free board',async({browser,baseURL})=>{
 localOnly(baseURL);const context=await browser.newContext({viewport:{width:960,height:540},serviceWorkers:'block',reducedMotion:'reduce'});let data=fixture();data={...data,status:'available',board:{...data.board,occupied:false},snapshot:{...data.snapshot,match:null,sessionKey:'idle-board'}};
 try{
  await installFixture(context,()=>data);const page=await context.newPage();await page.clock.install();await page.goto(`/baanscherm/${boardId}`);await expect(page.locator('.oche-stage')).toHaveAttribute('data-standby-slide','1');
  await page.clock.fastForward(5200);await expect(page.locator('.oche-stage')).toHaveAttribute('data-standby-slide','2');await expect(page.getByRole('heading',{name:'Scan en speel.',exact:true})).toBeVisible();expect(await page.locator('.oche-slide--qr .oche-headline>p').evaluate(node=>getComputedStyle(node).textWrap)).toBe('wrap');
  const targets=await page.locator('.oche-slide .club-board-qr>a').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')));expect(targets).toEqual([`/baan/${boardId}`,`/baan/${boardId}`]);const images=await page.locator('.oche-slide .qr-image').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('src')));expect(images[0]).toBe(images[1]);
  await page.clock.fastForward(10000);await expect(page.locator('.oche-stage')).toHaveAttribute('data-standby-slide','3');await expect(page.getByRole('heading',{name:'Zo speel je.',exact:true})).toBeVisible();await expect(page.locator('.oche-slide--steps li')).toHaveCount(4);expect(await page.locator('.oche-carousel-atmosphere i').first().evaluate(node=>getComputedStyle(node).animationName)).toBe('none');
  await page.clock.fastForward(15000);await expect(page.locator('.oche-stage')).toHaveAttribute('data-standby-slide','1');
  data={...data,status:'reserved',board:{...data.board,publicScan:false},reservation:{label:'Geplande speeldag',startsAt:new Date().toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),overrun:false}};await page.clock.fastForward(2100);await expect(page.getByRole('heading',{name:'Baan gereserveerd.',exact:true})).toBeVisible();await expect(page.locator('[data-standby-slide]')).toHaveCount(0);
  data={...data,status:'available',board:{...data.board,publicScan:true},reservation:undefined};await page.clock.fastForward(2100);await expect(page.locator('.oche-stage')).toHaveAttribute('data-standby-slide','1');
  data={...data,status:'closed',board:{...data.board,closed:true,publicScan:false}};await page.clock.fastForward(2100);await expect(page.getByRole('heading',{name:'Baan gesloten.',exact:true})).toBeVisible();await expect(page.locator('[data-standby-slide]')).toHaveCount(0);
 }finally{await context.close();}
});


test('paired-capability warning continuation preserves the existing scorecard node, accepted turns and manual scroll',async({browser,baseURL})=>{
 localOnly(baseURL);const context=await browser.newContext({viewport:{width:960,height:540},serviceWorkers:'block',reducedMotion:'reduce'});let data=fixture();let reads=0,continuations=0;
 const visits=visitsFor([85,100,60,58,50,60],[45,100,60,60,48]);const now=Date.now();
 data={...data,snapshot:{...data.snapshot,scoreEvents:[{id:'accepted-11',revision:11,kind:'score',score:60,playerIndex:0}],match:{...data.snapshot.match!,revision:11,remaining:[88,188],turn:1,visits,currentLegVisits:visits},boardActivity:{sessionId:boardId,sourceId:'fixture-match',sourceKind:'match',kind:'free',phase:'warning',serverNow:now,activityAt:now-120000,warningAt:now,deadlineAt:now+60000,warningEpoch:'paired-fixture-warning',extensionsUsed:0,maxExtensions:2,boardIds:[boardId],canExtend:true}}};
 try{
  // Display capability and all server responses are local fixtures; this does not assert real device authorization.
  await context.route(`**/api/board-screens/${boardId}`,route=>{reads++;return route.fulfill({json:data});});
  await context.route(`**/api/board-screens/${boardId}/continue`,async route=>{
   expect(route.request().method()).toBe('POST');const body=route.request().postDataJSON();expect(body.sessionId).toBe(boardId);expect(body.warningEpoch).toBe('paired-fixture-warning');expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/);continuations++;
   const continuedAt=Date.now();const activity={...data.snapshot.boardActivity!,phase:'active' as const,serverNow:continuedAt,activityAt:continuedAt,warningAt:continuedAt+120000,deadlineAt:continuedAt+180000,warningEpoch:'paired-fixture-continued',extensionsUsed:1};
   data={...data,snapshot:{...data.snapshot,boardActivity:activity}};await route.fulfill({json:{activity}});
  });
  const page=await context.newPage();await page.goto(`/baanscherm/${boardId}`);await expect(page.locator('.board-activity-display')).toBeVisible();await expect(page.locator('.sprint-number')).toHaveText(['88','188']);await page.evaluate(()=>document.fonts.ready);
  const card=await page.locator('.sprint-scroll').elementHandle();expect(card).not.toBeNull();await card!.evaluate(node=>{node.scrollTop=20;});const position=await card!.evaluate(node=>node.scrollTop);expect(position).toBeGreaterThan(0);
  const turns=await page.locator('.sprint-table').innerText(),readsBefore=reads;await page.getByRole('button',{name:'Doorspelen',exact:true}).click();
  await expect(page.locator('.board-activity-display')).toHaveCount(0);await expect.poll(()=>reads).toBeGreaterThan(readsBefore);expect(continuations).toBe(1);
  expect(await card!.evaluate(node=>node.isConnected&&node===document.querySelector('.sprint-scroll'))).toBe(true);expect(await card!.evaluate(node=>node.scrollTop)).toBe(position);
  await expect(page.locator('.sprint-number')).toHaveText(['88','188']);expect(await page.locator('.sprint-table').innerText()).toBe(turns);await expect(page.locator('.sprint-table tbody tr')).toHaveCount(6);
 }finally{await context.close();}
});
