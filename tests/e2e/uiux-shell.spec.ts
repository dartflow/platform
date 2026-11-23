import {test,expect,type BrowserContext,type Locator,type Page,type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {MatchView,Overview,Profile} from '../../lib/types';
import type {PlatformEntity,PlatformOverview} from '../../lib/platform-types';
import type {PlayerExperience} from '../../lib/player-experience-types';

const origin='http://localhost:3000';
const owner='00000000-0000-4000-8000-000000000001';
async function login(context:BrowserContext,baseURL:string|undefined){
  if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Shell UI acceptance requires loopback fixtures.');
  expect((await(await context.request.get('/api/session')).json()).local).toBe(true);
  const response=await context.request.post('/api/auth/local',{headers:{Origin:origin},data:{userId:owner,next:'/app'}});
  expect(response.status(),await response.text()).toBe(200);
}
async function capture(page:Page,info:TestInfo,name:string){
  await page.evaluate(()=>document.fonts.ready);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await info.attach(name,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
}
async function fling(context:BrowserContext,page:Page,scroller:Locator){
  await scroller.evaluate(node=>{node.scrollTop=0;});
  const before=await scroller.evaluate(node=>node.scrollTop),box=await scroller.boundingBox();
  expect(box).not.toBeNull();
  const cdp=await context.newCDPSession(page);
  try{
    const x=Math.round(box!.x+box!.width*.65),y=Math.round(Math.min(page.viewportSize()!.height-80,box!.y+box!.height-70));
    // Dispatch actual touch input: Chromium's synthetic touch scroll command can
    // complete without input in a mobile emulated context. Timed move events
    // build velocity, then the assertion requires movement after finger release.
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let step=1;step<=14;step++){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*20}]});
      await page.waitForTimeout(12);
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    const releasedAt=await scroller.evaluate(node=>node.scrollTop);
    await expect.poll(()=>scroller.evaluate(node=>node.scrollTop)).toBeGreaterThan(Math.max(before+50,releasedAt+3));
  }finally{await cdp.detach();}
}

test('desktop navigation marks subroutes and mobile More retains touch scrolling, close focus and keyboard destinations',async({browser,baseURL},info)=>{
  test.setTimeout(120000);
  const desktop=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
  try{
    await login(desktop,baseURL);const page=await desktop.newPage();await page.goto('/app/settings/notifications');
    const rail=page.getByRole('navigation',{name:'Desktopnavigatie',exact:true});
    await expect(rail).toBeVisible();await expect(rail.getByRole('link',{name:'Instellingen',exact:true})).toHaveAttribute('aria-current','page');
    await expect(rail.locator('a[aria-current="page"]')).toHaveCount(1);
    const width=(await page.locator('.df-app-rail').boundingBox())!.width;expect(width).toBeGreaterThanOrEqual(195);expect(width).toBeLessThanOrEqual(220);
    await expect(page.getByRole('navigation',{name:'Hoofdnavigatie',exact:true})).toBeHidden();
    await capture(page,info,'shell-desktop-settings-subroute-1440');
  }finally{await desktop.close();}
  for(const viewport of[{width:360,height:568},{width:390,height:844}]){
    const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,serviceWorkers:'block'});
    try{
      await login(context,baseURL);const page=await context.newPage();await page.goto('/app');
      const primary=page.getByRole('navigation',{name:'Hoofdnavigatie',exact:true}),trigger=primary.getByRole('button',{name:'Meer',exact:true}),dialog=page.getByRole('dialog',{name:'Meer DartFlow',exact:true});
      await expect(primary).toBeVisible();await expect(page.getByRole('navigation',{name:'Desktopnavigatie',exact:true})).toBeHidden();
      await trigger.click();await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Menu sluiten',exact:true}).click();await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
      await trigger.click();await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
      await trigger.click();await fling(context,page,dialog.locator('.df-more-content'));
      await capture(page,info,`shell-more-touch-${viewport.width}`);
      const settings=dialog.getByRole('link',{name:'Profiel & instellingen',exact:true});await settings.focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(`${origin}/app/settings`);
      await expect(page.locator('[data-workspace="settings"]')).toBeVisible();await page.goBack();await expect(page).toHaveURL(`${origin}/app`);
      await trigger.click();await expect(dialog).toBeVisible();await fling(context,page,dialog.locator('.df-more-content'));
      await capture(page,info,`shell-more-touch-after-back-${viewport.width}`);
      const inbox=dialog.getByRole('link',{name:'Jouw meldingen',exact:true});await inbox.focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(`${origin}/app/notifications`);await expect(page.locator('.notification-inbox')).toBeVisible();
      await primary.getByRole('link',{name:'Vandaag',exact:true}).focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(`${origin}/app`);await expect(page.locator('.df-today')).toBeVisible();
    }finally{await context.close();}
  }
});

function match(user:Profile,opponent:Profile,status:MatchView['status']):MatchView{
  return{id:randomUUID(),clubId:randomUUID(),eventId:randomUUID(),boardId:null,revision:1,status,players:[user,opponent],writerId:user.id,settings:{startScore:501,bestOfLegs:3,bestOfSets:1,inRule:'single',outRule:'double'},accepted:[true,true],confirmations:[false,true],resultRevision:null,winnerId:status==='result'?user.id:null,resultPublished:false,dispute:null,remaining:status==='result'?[0,261]:[441,501],legs:status==='result'?[2,0]:[0,0],sets:[0,0],turn:0,checkout:null,visits:[],stats:[{total:0,darts:0,oneEighties:0,highestFinish:0},{total:0,darts:0,oneEighties:0,highestFinish:0}],legNumber:1,setNumber:1,permissions:{canScore:false,canWrite:false,canManage:false,canAccept:false,canConfirm:status==='result',canTakeOver:false,canUndo:false,canPause:false,canResume:false,canRequestCorrection:false,canAnswerCorrection:false,canCancelCorrection:false}};
}
function event(name:string,days:number,status='planned',kind:'league'|'tournament'='tournament'):PlatformEntity{
  const at=new Date();at.setUTCDate(at.getUTCDate()+days);at.setUTCHours(19,0,0,0);
  return{id:randomUUID(),kind,name,ownerId:owner,clubId:null,visibility:'public',revision:1,state:{name,date:at.toISOString(),status},members:[],canManage:false};
}

test('Today presentation prioritizes the own active match, deduplicates it, orders three agenda items and favorites, then offers confirmation and an empty state',async({browser,baseURL},info)=>{
  test.setTimeout(120000);
  const context=await browser.newContext({serviceWorkers:'block'});
  try{
    await login(context,baseURL);
    // Only GET presentation responses are layered over the actual local actor/API data.
    // This test makes no server scoring, authorization or persistence coverage claim.
    const baseline:PlatformOverview=await(await context.request.get('/api/platform')).json(),overview:Overview=await(await context.request.get('/api/overview')).json(),experience:PlayerExperience=await(await context.request.get('/api/player-experience')).json(),mine=await(await context.request.get('/api/play/mine')).json();
    const user=baseline.profile,opponent=baseline.players.find(player=>player.id!==user.id)??{id:randomUUID(),name:'Tegenstander'},other={...opponent,id:randomUUID(),name:'Andere speler'};
    const live=match(user,opponent,'live'),confirmation=match(user,opponent,'result'),foreign=match(opponent,other,'live'),nextId=randomUUID();
    let phase:'live'|'confirmation'|'empty'='live';
    const closed=event('Gesloten evenement',1),archived=event('Gearchiveerd evenement',1),completed=event('Afgerond evenement',1);closed.state.closed=true;archived.state.archived=true;completed.state.completed=true;
    const agenda=[event('Agenda daarna',3),event('Agenda vierde',5),event('Geannuleerd',1,'canceled'),closed,event('Agenda morgen',1),archived,completed,event('Voorbij',-2),event('Agenda later',2,'planned','league')];
    const friends=[{id:randomUUID(),name:'Anna',status:'friend' as const,favorite:false},{id:randomUUID(),name:'Zeno',status:'friend' as const,favorite:true},{id:randomUUID(),name:'Bea',status:'friend' as const,favorite:true},{id:randomUUID(),name:'Verzoek',status:'incoming' as const,favorite:true}];
    await context.addInitScript(()=>localStorage.removeItem('dartflow-club'));
    await context.route('**/api/platform',route=>{expect(route.request().method()).toBe('GET');return route.fulfill({json:{...baseline,matches:phase==='live'?[confirmation,foreign,live]:phase==='confirmation'?[foreign,confirmation]:[foreign],friends,leagues:agenda.filter(item=>item.kind==='league'),tournaments:agenda.filter(item=>item.kind==='tournament')}});});
    await context.route('**/api/overview**',route=>{if(new URL(route.request().url()).pathname!=='/api/overview')return route.continue();expect(route.request().method()).toBe('GET');return route.fulfill({json:{...overview,matches:phase==='live'?[confirmation,foreign,live]:phase==='confirmation'?[foreign,confirmation]:[foreign]}});});
    await context.route('**/api/play/mine',route=>{expect(route.request().method()).toBe('GET');return route.fulfill({json:{...mine,sessions:[]}});});
    await context.route('**/api/player-experience',route=>{
      expect(route.request().method()).toBe('GET');const featured=phase==='live'?live:confirmation;
      const fixture={seasonId:randomUUID(),revision:0,seasonName:'Lokale presentatieproef',fixtureId:randomUUID(),scope:'internal' as const,status:'scheduled' as const,round:1,startsAt:'2091-06-01T19:00:00Z',windowStart:'2091-06-01T18:00:00Z',windowEnd:'2091-06-01T21:00:00Z',opponent:'Geplande tegenstander',boardIds:[],matchId:nextId,writerId:user.id,checkedIn:false,available:true,canCheckIn:false,canConfirm:false,href:`/wedstrijd/${nextId}`};
      return route.fulfill({json:{...experience,fixtures:phase==='empty'?[]:[{...fixture,fixtureId:randomUUID(),matchId:featured.id,href:`/wedstrijd/${featured.id}`},fixture],resume:phase==='empty'?[]:[{id:featured.id,players:featured.players.map(player=>player.name),remaining:featured.remaining,writer:user.name,lastVisit:null,revision:1,href:`/wedstrijd/${featured.id}`}],actions:[]}});
    });
    const page=await context.newPage();
    for(const viewport of[{width:1440,height:900},{width:390,height:844},{width:360,height:568}]){
      await page.setViewportSize(viewport);phase='live';await page.goto('/app');
      const card=page.getByRole('region',{name:'Jouw wedstrijd',exact:true});
      await expect(card.getByRole('link',{name:'Hervat je partij',exact:true})).toHaveAttribute('href',`/wedstrijd/${live.id}`);await expect(card.locator('.df-current-player strong')).toHaveText(['441','501']);
      await expect(page.locator(`.df-today a[href="/wedstrijd/${live.id}"]`)).toHaveCount(1);await expect(page.locator('.experience-fixture')).toHaveCount(1);await expect(page.locator('.experience-fixture')).toContainText('Geplande tegenstander');
      await expect(page.locator('.df-program-item .df-list-text strong')).toHaveText(['Agenda morgen','Agenda later','Agenda daarna']);await expect(page.locator('.df-friend-item strong')).toHaveText(['Bea','Zeno','Anna']);await expect(page.getByRole('link',{name:'Alle evenementen',exact:true})).toHaveAttribute('href','/app/events');await expect(page.getByRole('link',{name:'Alle vrienden',exact:true})).toHaveAttribute('href','/app/friends');
      await capture(page,info,`shell-today-own-active-${viewport.width}`);
      phase='confirmation';await page.reload();await expect(card.getByRole('link',{name:'Bevestig je uitslag',exact:true})).toHaveAttribute('href',`/wedstrijd/${confirmation.id}`);await expect(page.locator(`.df-today a[href="/wedstrijd/${confirmation.id}"]`)).toHaveCount(1);await capture(page,info,`shell-today-confirmation-${viewport.width}`);
      phase='empty';await page.reload();await expect(card).toHaveCount(0);await expect(page.getByRole('region',{name:'Baan openen',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Bekijk de banen',exact:true})).toHaveAttribute('href','/app/baan');await capture(page,info,`shell-today-empty-${viewport.width}`);
    }
  }finally{await context.close();}
});
