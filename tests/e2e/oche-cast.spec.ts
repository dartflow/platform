import {test,expect,type Page,type ElementHandle} from '@playwright/test';
import QRCode from 'qrcode';
import type {ClubBoardScreenView,Visit} from '../../lib/types';

const boardId='55555555-5555-4555-8555-555555555555';
const viewport={width:1920,height:1080};
function liveFixture():ClubBoardScreenView{
 const remaining=[501,501],visits:Visit[]=[];
 const scores=[[85,100,60,58,50],[45,100,60,60,48]];
 for(let row=0;row<5;row++)for(let side=0;side<2;side++){
  const before=remaining[side],score=scores[side][row];remaining[side]-=score;
  visits.push({player:`player-${side+1}`,playerIndex:side,score,darts:3,remainingBefore:before,remainingAfter:remaining[side],bust:false,leg:1,checkout:false});
 }
 return {board:{id:boardId,name:'Castbaan 04',clubName:'Lokale castfixture',access:'all',publicScan:true,blocked:false,occupied:true,playUrl:`/baan/${boardId}`,screenUrl:`/baanscherm/${boardId}`,locationKind:'venue'},status:'playing',snapshot:{board:{id:boardId,name:'Castbaan 04'},event:{name:'Lokale castfixture'},sessionKey:'cast-fixture-match',scoreEvents:[],match:{id:'cast-fixture-match',revision:10,status:'live',scoringMode:'shared-writer',players:[{id:'player-1',name:'Danny'},{id:'player-2',name:'Rick'}],remaining,legs:[0,0],sets:[0,0],turn:0,checkout:null,visits,currentLegVisits:visits,currentLegStartScore:501,winnerId:null,resultPublished:false,writerId:'player-1',settings:{startScore:501,bestOfLegs:3,bestOfSets:1},stats:[{total:353,darts:15,oneEighties:0,highestFinish:0},{total:313,darts:15,oneEighties:0,highestFinish:0}],legNumber:1,setNumber:1,paused:false}}};
}
function standbyFixture():ClubBoardScreenView{
 const data=liveFixture();return {...data,status:'available',board:{...data.board,occupied:false},snapshot:{...data.snapshot,sessionKey:'cast-fixture-idle',match:null}};
}
async function castGeometry(page:Page,surface:ElementHandle<HTMLElement|SVGElement>){
 expect(await surface.evaluate(node=>node.isConnected&&node===document.querySelector('.oche-cast-surface'))).toBe(true);
 const geometry=await page.locator('.oche-cast-surface').evaluate(node=>{
  const element=node as HTMLElement,frame=document.querySelector('.oche-cast-viewport')!;
  const rect=(value:Element)=>{const r=value.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  const transform=new DOMMatrixReadOnly(getComputedStyle(element).transform);
  return {width:element.offsetWidth,height:element.offsetHeight,rotation:[transform.a,transform.b,transform.c,transform.d],surface:rect(element),frame:rect(frame),viewport:[innerWidth,innerHeight],overflow:document.documentElement.scrollWidth-innerWidth};
 });
 expect(geometry.width).toBe(1080);expect(geometry.height).toBe(1920);expect(geometry.viewport).toEqual([1920,1080]);
 for(const[index,value]of [0,1,-1,0].entries())expect(geometry.rotation[index]).toBeCloseTo(value,5);
 for(const box of [geometry.surface,geometry.frame]){
  expect(box.left).toBeCloseTo(0,1);expect(box.top).toBeCloseTo(0,1);expect(box.right).toBeCloseTo(1920,1);expect(box.bottom).toBeCloseTo(1080,1);
 }
 expect(geometry.overflow).toBeLessThanOrEqual(1);
}
async function fullFiveRows(page:Page){
 await expect(page.locator('.sprint-table tbody tr')).toHaveCount(5);
 const geometry=await page.locator('.sprint-scroll').evaluate(node=>{
  const box=node.getBoundingClientRect();
  return {scrollTop:node.scrollTop,rows:[...node.querySelectorAll('tbody tr')].map(row=>{
   const r=row.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
   return {within:r.left>=box.left-.5&&r.right<=box.right+.5&&r.top>=box.top-.5&&r.bottom<=box.bottom+.5,uncovered:hit?.closest('tbody tr')===row};
  })};
 });
 expect(geometry.scrollTop).toBe(0);expect(geometry.rows).toHaveLength(5);expect(geometry.rows.every(row=>row.within&&row.uncovered)).toBe(true);
}
async function newestRowVisible(page:Page){
 await expect.poll(()=>page.locator('.sprint-scroll').evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
 const position=await page.locator('.sprint-scroll').evaluate(node=>{
  const scroll=node as HTMLElement,row=node.querySelector('tbody tr:last-child') as HTMLElement;let top=0,parent:HTMLElement|null=row;
  while(parent&&parent!==scroll){top+=parent.offsetTop;parent=parent.offsetParent as HTMLElement|null;}
  return {reachesScroll:parent===scroll,bottom:top+row.offsetHeight,visibleBottom:scroll.scrollTop+scroll.clientHeight};
 });
 expect(position.reachesScroll).toBe(true);expect(position.bottom).toBeLessThanOrEqual(position.visibleBottom+1);
}
async function sharpFixedQr(page:Page,absoluteTarget:string){
 const images=page.locator('.oche-slide .qr-image');await expect(images).toHaveCount(2);
 const qr=QRCode.create(absoluteTarget,{errorCorrectionLevel:'M'}),modules=qr.modules.size;
 const source=await images.evaluateAll(nodes=>nodes.map(node=>(node as HTMLImageElement).src));expect(source[0]).toBe(source[1]);expect(source[0]).toMatch(/^data:image\/png;base64,/);
 expect(await page.locator('.oche-slide .club-board-qr>a').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')))).toEqual([`/baan/${boardId}`,`/baan/${boardId}`]);
 const pixels=await page.locator('.oche-slide--qr .qr-image').evaluate(async(node,input)=>{
  const image=node as HTMLImageElement;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const context=canvas.getContext('2d')!;context.drawImage(image,0,0);const bytes=context.getImageData(0,0,canvas.width,canvas.height).data;
  let left=canvas.width,top=canvas.height,right=-1,bottom=-1,unexpected=0,mismatches=0;
  const dark=(offset:number)=>bytes[offset]===17&&bytes[offset+1]===25&&bytes[offset+2]===23&&bytes[offset+3]===255;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
   const offset=(y*canvas.width+x)*4;
   if(dark(offset)){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
   else if(bytes[offset]!==255||bytes[offset+1]!==255||bytes[offset+2]!==255||bytes[offset+3]!==255)unexpected++;
  }
  const pitch=canvas.width/(input.modules+8);
  for(let y=0;y<input.modules;y++)for(let x=0;x<input.modules;x++){
   const px=Math.floor((x+4.5)*pitch),py=Math.floor((y+4.5)*pitch);
   if(Number(dark((py*canvas.width+px)*4))!==input.bits[y*input.modules+x])mismatches++;
  }
  const r=image.getBoundingClientRect();
  return {width:canvas.width,height:canvas.height,quiet:[left,top,canvas.width-1-right,canvas.height-1-bottom],unexpected,mismatches,renderedWidth:r.width,renderedHeight:r.height,dpr:devicePixelRatio};
 },{modules,bits:Array.from(qr.modules.data)});
 expect(pixels.width).toBe(1024);expect(pixels.height).toBe(1024);expect(pixels.unexpected).toBe(0);expect(pixels.mismatches).toBe(0);
 for(const quiet of pixels.quiet)expect(quiet).toBeGreaterThanOrEqual(Math.floor(4*pixels.width/(modules+8))-1);
 expect(pixels.renderedWidth).toBeGreaterThan(300);expect(pixels.renderedWidth).toBeCloseTo(pixels.renderedHeight,1);expect(pixels.width).toBeGreaterThanOrEqual(pixels.renderedWidth*pixels.dpr);
 return source[0];
}
async function installationFitsSurface(page:Page){
 await page.getByRole('button',{name:'Installeer dit baanscherm',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Installeer dit baanscherm',exact:true})).toBeVisible();
 const backdrop=await page.locator('.pwa-install-backdrop').boundingBox();
 expect(backdrop).toEqual({x:0,y:0,width:1920,height:1080});
 const dialog=await page.getByRole('dialog',{name:'Installeer dit baanscherm',exact:true}).boundingBox();
 expect(dialog!.x).toBeGreaterThanOrEqual(0);expect(dialog!.y).toBeGreaterThanOrEqual(0);
 expect(dialog!.x+dialog!.width).toBeLessThanOrEqual(1920);expect(dialog!.y+dialog!.height).toBeLessThanOrEqual(1080);
 await page.getByRole('button',{name:'Installatie sluiten',exact:true}).click();
}

for(const path of [`/baanscherm/${boardId}`,`/oche-live/${boardId}/`])test(`landscape cast keeps one rotated portrait surface, sharp fixed QR and fullscreen through every state on ${path.split('/')[1]}`,async({browser,baseURL},testInfo)=>{
 if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw new Error('Cast fixtures require the loopback app.');
 const context=await browser.newContext({viewport,screen:viewport,serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage();let data=standbyFixture();
 const requests:{method:string;path:string}[]=[];
 try{
  // This page has public read-only transport only; no profile, assignment or DB fixture changes.
  await context.route('**/api/**',route=>{
   const request=route.request(),url=new URL(request.url());requests.push({method:request.method(),path:url.pathname});
   return url.pathname===`/api/board-screens/${boardId}`&&request.method()==='GET'?route.fulfill({json:data}):route.fulfill({status:404,json:{error:'Unexpected public cast fixture request'}});
  });
  await page.clock.install();await page.goto(path);await expect(page.locator('.oche-stage')).toHaveAttribute('data-standby-slide','1');await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('.oche-cast-surface')).toHaveCount(1);const surface=await page.locator('.oche-cast-surface').elementHandle();expect(surface).not.toBeNull();await castGeometry(page,surface!);
  await page.clock.fastForward(5200);await expect(page.locator('.oche-stage')).toHaveAttribute('data-standby-slide','2');
  const qr=await sharpFixedQr(page,new URL(`/baan/${boardId}`,baseURL).href);await castGeometry(page,surface!);
  await expect(page.getByRole('button',{name:'Installeer dit baanscherm',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Volledig scherm',exact:true}).click();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===document.documentElement)).toBe(true);await castGeometry(page,surface!);await expect(page.getByRole('button',{name:'Installeer dit baanscherm',exact:true})).toBeVisible();
  await installationFitsSurface(page);
  await page.getByRole('button',{name:'Volledig scherm',exact:true}).click();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);await castGeometry(page,surface!);
  await page.clock.fastForward(10000);await expect(page.locator('.oche-stage')).toHaveAttribute('data-standby-slide','3');expect(await page.locator('.oche-slide--steps .qr-image').getAttribute('src')).toBe(qr);await castGeometry(page,surface!);
  data=liveFixture();await page.clock.fastForward(850);await expect(page.locator('.sprint-number')).toHaveText(['148','188']);await fullFiveRows(page);await castGeometry(page,surface!);
  await installationFitsSurface(page);
  const append=async(side:number,score:number)=>{
   const match=data.snapshot.match!,remaining=[...match.remaining],before=remaining[side];remaining[side]-=score;
   const visit:Visit={player:`player-${side+1}`,playerIndex:side,score,darts:3,remainingBefore:before,remainingAfter:remaining[side],bust:false,leg:1,checkout:false},revision=match.revision+1;
   data={...data,snapshot:{...data.snapshot,scoreEvents:[{id:`cast-accepted-${revision}`,revision,kind:'score',score,playerIndex:side}],match:{...match,revision,remaining,turn:1-side,paused:false,visits:[...match.visits,visit],currentLegVisits:[...match.currentLegVisits!,visit]}}};
   await page.clock.fastForward(850);await expect(page.locator('.sprint-number').nth(side)).toHaveText(String(remaining[side]));await newestRowVisible(page);
  };
  await append(0,60);await expect(page.locator('.sprint-table tbody tr')).toHaveCount(6);
  await page.locator('.sprint-scroll').evaluate(node=>{node.scrollTop=0;});data={...data,snapshot:{...data.snapshot,match:{...data.snapshot.match!,revision:data.snapshot.match!.revision+1,paused:true}}};
  await page.clock.fastForward(850);await expect(page.locator('.sprint-status')).toHaveText('Gepauzeerd');expect(await page.locator('.sprint-scroll').evaluate(node=>node.scrollTop)).toBe(0);
  await append(1,60);await append(0,26);await expect(page.locator('.sprint-table tbody tr')).toHaveCount(7);await castGeometry(page,surface!);
  const now=Date.now();data={...data,snapshot:{...data.snapshot,boardActivity:{sessionId:boardId,sourceId:'cast-fixture-match',sourceKind:'match',kind:'free',phase:'warning',serverNow:now,activityAt:now-120000,warningAt:now,deadlineAt:now+60000,warningEpoch:'cast-fixture-warning',extensionsUsed:0,maxExtensions:2,boardIds:[boardId],canExtend:false}}};
  await page.clock.fastForward(850);await expect(page.locator('.board-activity-display')).toBeVisible();await expect(page.locator('.board-activity-hint')).toHaveText('Tik op Doorspelen op je telefoon');await castGeometry(page,surface!);
  await testInfo.attach(`oche-cast-warning-${path.split('/')[1]}`,{body:await page.screenshot(),contentType:'image/png'});
  data=standbyFixture();await page.clock.fastForward(850);await expect(page.locator('.oche-stage')).toHaveAttribute('data-standby-slide','1');await expect(page.locator('.sprint-frame')).toHaveCount(0);await castGeometry(page,surface!);
  expect(requests.length).toBeGreaterThan(0);expect(requests.every(request=>request.method==='GET'&&request.path===`/api/board-screens/${boardId}`)).toBe(true);
 }finally{await context.close();}
});
