import {test,expect,type Page} from '@playwright/test';
import type {ClubBoardScreenView,Visit} from '../../lib/types';

const boardId='55555555-5555-4555-8555-555555555555',grant='a'.repeat(43);
function fixture():ClubBoardScreenView{
 const remaining=[501,501],visits:Visit[]=[],scores=[[85,100,60,58,50],[45,100,60,60,48]];
 for(let row=0;row<5;row++)for(let side=0;side<2;side++){const before=remaining[side],score=scores[side][row];remaining[side]-=score;visits.push({player:`player-${side+1}`,playerIndex:side,score,darts:3,remainingBefore:before,remainingAfter:remaining[side],bust:false,leg:1,checkout:false});}
 return {board:{id:boardId,name:'Statistiekbaan',clubName:'Lokale UI-fixture',access:'all',publicScan:true,blocked:false,occupied:true,playUrl:`/baan/${boardId}`,screenUrl:`/baanscherm/${boardId}`,locationKind:'venue'},status:'playing',snapshot:{board:{id:boardId,name:'Statistiekbaan'},event:{name:'Lokale UI-fixture'},sessionKey:'statistics-fixture',scoreEvents:[],statistics:{players:[{playerIndex:0,last50:{average:53.2,measured:32,window:50},live:{average:70.6,oneEighties:0,highestFinish:0}},{playerIndex:1,last50:{average:58.1,measured:12,window:12},live:{average:62.6,oneEighties:0,highestFinish:0}}]},match:{id:'statistics-fixture',revision:10,status:'live',scoringMode:'shared-writer',players:[{id:'player-1',name:'Danny'},{id:'player-2',name:'Rick'}],remaining,legs:[0,0],sets:[0,0],turn:0,checkout:null,visits,currentLegVisits:visits,currentLegStartScore:501,winnerId:null,resultPublished:false,writerId:'player-1',settings:{startScore:501,bestOfLegs:3,bestOfSets:1},stats:[{total:353,darts:15,oneEighties:0,highestFinish:0},{total:313,darts:15,oneEighties:0,highestFinish:0}],legNumber:1,setNumber:1,paused:false}}};
}
async function fiveRows(page:Page){
 await expect(page.locator('.sprint-table tbody tr')).toHaveCount(5);
 const result=await page.locator('.sprint-scroll').evaluate(node=>{const element=node as HTMLElement,row=node.querySelector('tbody tr') as HTMLElement;return{height:element.clientHeight,headers:(node.querySelector('thead') as HTMLElement).offsetHeight,row:row.offsetHeight,overflow:document.documentElement.scrollWidth-innerWidth};});
 expect(result.height-result.headers).toBeGreaterThanOrEqual(5*result.row-2);expect(result.overflow).toBeLessThanOrEqual(1);
}

for(const viewport of [{width:1080,height:1920},{width:720,height:1280},{width:1920,height:1080}])test(`Oche historical snapshot stays fixed with live statistics, privacy removal and five rows at ${viewport.width}x${viewport.height}`,async({browser,baseURL},testInfo)=>{
 if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Oche statistics fixtures require the loopback app.');
 const cast=viewport.width>viewport.height,context=await browser.newContext({viewport,serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage();let data=fixture();
 try{
  await context.route('**/api/**',route=>{const url=new URL(route.request().url());return url.pathname===`/api/board-screens/${boardId}`?route.fulfill({json:data}):url.pathname===`/api/screen/${grant}`?route.fulfill({json:data.snapshot}):route.fulfill({status:404,json:{error:'Unexpected local fixture request'}});});
  await page.clock.install();await page.goto(cast?`/baanscherm/${boardId}`:`/scherm/${grant}`);await expect(page.locator('.sprint-number')).toHaveText(['148','188']);await page.evaluate(()=>document.fonts.ready);await fiveRows(page);
  await expect(page.locator('.sprint-history-average')).toHaveText(['Laatste 50 · 53,2','Laatste 50 · 58,1']);const original=await page.locator('.sprint-score').first().boundingBox();
  await testInfo.attach(`oche-historical-${viewport.width}x${viewport.height}`,{body:await page.screenshot(),contentType:'image/png'});
  const match=data.snapshot.match!,visit:Visit={player:'player-2',playerIndex:1,score:180,darts:3,remainingBefore:188,remainingAfter:8,bust:false,leg:1,checkout:false};
  data={...data,snapshot:{...data.snapshot,scoreEvents:[{id:'statistics-180',revision:11,kind:'score',score:180,playerIndex:1}],statistics:{players:[data.snapshot.statistics!.players[0],{...data.snapshot.statistics!.players[1],live:{average:493/18*3,oneEighties:1,highestFinish:0}}]},match:{...match,revision:11,remaining:[148,8],turn:0,visits:[...match.visits,visit],currentLegVisits:[...match.currentLegVisits!,visit]}}};
  await page.clock.fastForward(1800);await expect(page.locator('.sprint-number')).toHaveText(['148','8']);await expect(page.locator('.sprint-history-average')).toHaveText(['Laatste 50 · 53,2','Laatste 50 · 58,1']);await expect(page.getByLabel('Statistieken Rick')).toContainText('82,2');await expect(page.getByLabel('Statistieken Rick').locator('dd').last()).toHaveText('1');expect(await page.locator('.sprint-score').first().boundingBox()).toEqual(original);await expect(page.locator('.oche-celebration')).toBeVisible();
  await page.clock.fastForward(2500);data=fixture();data={...data,snapshot:{...data.snapshot,match:{...data.snapshot.match!,revision:12},statistics:{players:data.snapshot.statistics!.players.map(player=>({...player,last50:null}))}}};await page.clock.fastForward(1800);await expect(page.locator('.sprint-number')).toHaveText(['148','188']);await expect(page.locator('.sprint-history-average')).toHaveText(['\u00a0','\u00a0']);expect(await page.locator('.sprint-score').first().boundingBox()).toEqual(original);await fiveRows(page);
  await testInfo.attach(`oche-statistics-${viewport.width}x${viewport.height}`,{body:await page.screenshot(),contentType:'image/png'});
 }finally{await context.close();}
});

test('lobby shows only projected head-to-head and recap yields to next assignment or closed board',async({browser,baseURL},testInfo)=>{
 if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Oche lobby fixtures require the loopback app.');
 const context=await browser.newContext({viewport:{width:1920,height:1080},serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage();let data=fixture();data={...data,status:'waiting',snapshot:{...data.snapshot,match:null,statistics:{players:[],headToHead:{names:['Danny','Rick'],wins:[8,5],drawn:0,previousLegs:[3,2]}}}};
 try{
  await context.route(`**/api/board-screens/${boardId}`,route=>route.fulfill({json:data}));await page.clock.install();await page.goto(`/baanscherm/${boardId}`);await expect(page.getByRole('complementary',{name:'Onderlinge balans'})).toContainText('Danny leidt 8–5');await expect(page.getByText('Vorige partij 3–2')).toBeVisible();
  data={...data,snapshot:{...data.snapshot,statistics:{players:[]}}};await page.clock.fastForward(850);await expect(page.getByRole('complementary',{name:'Onderlinge balans'})).toHaveCount(0);
  data={...data,status:'available',board:{...data.board,occupied:false},snapshot:{...data.snapshot,statistics:{players:[],recap:{expiresAt:new Date(Date.now()+15000).toISOString(),players:[{name:'Danny',legs:3,sets:1,average:57.6,highestFinish:100,averageDifference:4.4,personalRecord:true},{name:'Rick',legs:2,sets:0,average:55.1,highestFinish:40,averageDifference:null,personalRecord:false}]}}}};
  await page.clock.fastForward(850);await expect(page.getByRole('status',{name:'Wedstrijd terugblik'})).toContainText('4,4 boven je laatste 50');await expect(page.getByText('Persoonlijk record',{exact:true})).toBeVisible();
  await testInfo.attach('oche-recap',{body:await page.screenshot(),contentType:'image/png'});
  data={...data,status:'closed',board:{...data.board,closed:true,publicScan:false}};await page.clock.fastForward(850);await expect(page.getByRole('heading',{name:'Baan gesloten.',exact:true})).toBeVisible();await expect(page.getByRole('status',{name:'Wedstrijd terugblik'})).toHaveCount(0);
  data=fixture();await page.clock.fastForward(850);await expect(page.locator('.sprint-number')).toHaveText(['148','188']);await expect(page.getByRole('status',{name:'Wedstrijd terugblik'})).toHaveCount(0);
 }finally{await context.close();}
});
