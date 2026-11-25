import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {MatchView} from '../../lib/types';
import {chooseScoreInputMode} from './helpers/score-console';

const origin='http://localhost:3000';
async function login(page:Page,name:string){await page.goto('/inloggen?next=/app');await page.getByRole('button',{name:new RegExp(name)}).click();await expect(page).toHaveURL('/app');}
async function platform(context:BrowserContext,action:Record<string,unknown>,revision?:number){const response=await context.request.post('/api/platform/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),...(revision===undefined?{}:{expectedRevision:revision}),action}});expect(response.status(),await response.text()).toBe(200);return response.json();}
async function training(context:BrowserContext,id:string){return (await(await context.request.get('/api/platform')).json()).trainings.find((entity:{id:string})=>entity.id===id);}
async function matchAction(context:BrowserContext,id:string,action:Record<string,unknown>):Promise<MatchView>{const state:MatchView=await(await context.request.get(`/api/matches/${id}`)).json();const response=await context.request.post(`/api/matches/${id}/actions`,{headers:{Origin:origin},data:{requestId:randomUUID(),expectedRevision:state.revision,action}});expect(response.status(),await response.text()).toBe(200);return response.json();}
async function assertFits(page:Page){
  await expect(page.getByRole('dialog',{name:'Schermvullende score-invoer'})).toBeVisible();
  await expect(page.locator('.topbar')).toBeHidden();await expect(page.locator('.bottom-nav')).toBeHidden();
  expect(await page.locator('.app-shell').evaluate(element=>element.closest('[inert]')!==null)).toBe(true);
  const layout=await page.locator('.score-console').evaluate(element=>{
    const bounds=element.getBoundingClientRect(),confirm=element.querySelector('.score-console-confirm')!.getBoundingClientRect(),keypad=element.querySelector('.score-console-keypad')!.getBoundingClientRect();
    return {height:innerHeight,width:innerWidth,bottom:bounds.bottom,right:bounds.right,confirmBottom:confirm.bottom,keypadTop:keypad.top,keypadBottom:keypad.bottom,overflow:element.scrollHeight-element.clientHeight};
  });
  expect(layout.bottom).toBeLessThanOrEqual(layout.height+1);expect(layout.right).toBeLessThanOrEqual(layout.width+1);expect(layout.confirmBottom).toBeLessThanOrEqual(layout.height);expect(layout.keypadTop).toBeGreaterThan(0);expect(layout.keypadBottom).toBeLessThanOrEqual(layout.confirmBottom);expect(layout.overflow).toBeLessThanOrEqual(1);
}
async function digits(page:Page,value:string){await page.getByRole('button',{name:'Gehele score wissen',exact:true}).click();for(const digit of value)await page.getByRole('button',{name:`Cijfer ${digit}`,exact:true}).click();}

test('solo console fits small portraits, retains draft, and retries a committed lost response exactly once',async({browser,baseURL})=>{
  test.setTimeout(120000);
  if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Console test requires the local fixture.');
  const context=await browser.newContext({viewport:{width:320,height:568}}),page=await context.newPage();let id:string|undefined;
  try{
    expect((await(await context.request.get('/api/session')).json()).local).toBe(true);await login(page,'Michael de Groot');
    const created=await platform(context,{type:'training.create',mode:'solo',startScore:301});id=created.id;
    await page.goto(`/app/training/${id}`);await assertFits(page);await expect(page.locator('.console-remaining')).toHaveText('301');
    await digits(page,'181');await expect(page.getByRole('button',{name:'Bevestigen',exact:true})).toBeDisabled();await expect(page.getByRole('status')).toContainText('0 tot en met 180');await assertFits(page);
    await digits(page,'100');await chooseScoreInputMode(page,'per-dart');const active=page.getByRole('dialog',{name:'Schermvullende score-invoer',exact:true});await expect(active).toHaveCount(1);expect((await training(context,id!)).state.game.visits).toHaveLength(0);await chooseScoreInputMode(page,'total');await expect(active).toHaveCount(1);await expect(active.getByLabel('Bezoekscore',{exact:true})).toHaveValue('100');await page.getByRole('button',{name:'Terug naar wedstrijd',exact:true}).click();await expect(page.locator('.training-remaining')).toHaveText('301');
    await page.getByRole('button',{name:'Scoreweergave openen',exact:true}).click();await expect(page.getByRole('dialog',{name:'Schermvullende score-invoer'}).getByLabel('Bezoekscore',{exact:true})).toHaveValue('100');await assertFits(page);
    await page.setViewportSize({width:390,height:844});await assertFits(page);
    const attempts:{requestId:string;expectedRevision:number}[]=[];let abortFirst=true;
    await page.route('**/api/platform/actions',async route=>{
      const body=route.request().postDataJSON();
      if(body.action.type==='training.score'&&body.action.id===id){attempts.push({requestId:body.requestId,expectedRevision:body.expectedRevision});if(abortFirst){abortFirst=false;const response=await route.fetch();expect(response.status(),await response.text()).toBe(200);await route.abort('failed');return;}}
      await route.continue();
    });
    await page.getByRole('button',{name:'Bevestigen',exact:true}).click();
    await expect.poll(async()=>((await training(context,id!)).state.game.visits as unknown[]).length).toBe(1);
    await page.getByRole('button',{name:'Darts & correctie',exact:true}).click();await page.getByRole('button',{name:'Zelfde worp opnieuw proberen',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Schermvullende score-invoer'}).getByLabel('Bezoekscore',{exact:true})).toBeEmpty();await expect(page.locator('.console-remaining')).toHaveText('201');
    expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual(attempts[0]);const state=await training(context,id!);expect(state.state.game.visits).toHaveLength(1);expect(state.revision).toBe(attempts[0].expectedRevision+1);
    await page.getByRole('button',{name:'Opties sluiten',exact:true}).click();await context.setOffline(true);await expect(page.getByRole('status')).toContainText('Geen verbinding');await assertFits(page);await context.setOffline(false);await expect(page.getByRole('status')).not.toContainText('Geen verbinding');
    await digits(page,'180');await page.getByRole('button',{name:'Bevestigen',exact:true}).click();await expect(page.locator('.console-remaining')).toHaveText('21');
    await digits(page,'21');await page.setViewportSize({width:320,height:568});await assertFits(page);await expect(page.getByRole('button',{name:'Finish bevestigen',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Finish in 2 darts',exact:true}).click();await page.getByRole('button',{name:'Finish bevestigen',exact:true}).click();await expect(page.getByRole('dialog',{name:'Schermvullende score-invoer'})).toHaveCount(0);await expect(page.locator('.training-remaining')).toHaveText('0');
    // The console projects the finish before its ACK; cleanup must observe the committed result.
    await expect.poll(async()=>{const entity=await training(context,id!);const visits=entity.state.game.visits;const last=visits.at(-1);return{completed:entity.state.completed,revision:entity.revision,visits:visits.length,lastScore:last?.score,lastDarts:last?.darts};}).toEqual({completed:true,revision:attempts[0].expectedRevision+3,visits:3,lastScore:21,lastDarts:2});
  }finally{
    await context.setOffline(false);if(id){const entity=await training(context,id);if(entity&&!entity.state.completed)await platform(context,{type:'training.finish',id},entity.revision);}await context.close();
  }
});

test('one fullscreen console follows home and hybrid own turns and local shared-writer takeover with live Sprint',async({browser})=>{
  test.setTimeout(180000);
  const first=await browser.newContext({viewport:{width:320,height:568}}),second=await browser.newContext({viewport:{width:390,height:844}});
  const a=await first.newPage(),b=await second.newPage(),screen=await first.newPage();let activeId:string|undefined;
  try{
    expect((await(await first.request.get('/api/session')).json()).local).toBe(true);await login(a,'Michael de Groot');await login(b,'Raymond van Dijk');
    for(const setup of ['remote','hybrid','localone']){
      const lobby=await platform(first,{type:'lobby.create',name:`Console ${setup}`,setup,startScore:301,bestOfLegs:1});
      await platform(second,{type:'lobby.join',id:lobby.id,code:lobby.code});await platform(first,{type:'lobby.ready',id:lobby.id});await platform(second,{type:'lobby.ready',id:lobby.id});
      const started=await platform(first,{type:'lobby.start',id:lobby.id});activeId=started.matchId;const id=activeId!;
      await matchAction(first,id,{type:'accept'});await matchAction(second,id,{type:'accept'});await matchAction(first,id,{type:'start'});
      await a.goto(`/wedstrijd/${id}`);await b.goto(`/wedstrijd/${id}`);await screen.goto(`/app/spectator/${id}`);await assertFits(a);await assertFits(b);
      await digits(a,'100');await chooseScoreInputMode(a,'per-dart');const active=a.getByRole('dialog',{name:'Schermvullende score-invoer',exact:true});await expect(active).toHaveCount(1);await active.getByRole('button',{name:'Triple',exact:true}).click();await active.getByRole('button',{name:'T20',exact:true}).click();await chooseScoreInputMode(a,'total');await expect(active).toHaveCount(1);await expect(active.getByLabel('Bezoekscore',{exact:true})).toHaveValue('100');await chooseScoreInputMode(a,'per-dart');await expect(active.getByLabel('Ingevoerde pijlen')).toContainText('T20');expect((await(await first.request.get(`/api/matches/${id}`)).json()).visits).toHaveLength(0);await chooseScoreInputMode(a,'total');await expect(active.getByLabel('Bezoekscore',{exact:true})).toHaveValue('100');await a.getByRole('button',{name:'Bevestigen',exact:true}).dblclick();await expect(a.locator('.console-remaining').first()).toHaveText('201');await expect(b.locator('.console-remaining').first()).toHaveText('201');await expect(screen.locator('.sprint-number').first()).toHaveText('201');
      const own=setup!=='localone';await expect(a.getByRole('dialog',{name:'Schermvullende score-invoer'}).getByLabel('Bezoekscore',{exact:true}))[own?'toBeDisabled':'toBeEnabled']();await expect(b.getByRole('dialog',{name:'Schermvullende score-invoer'}).getByLabel('Bezoekscore',{exact:true}))[own?'toBeEnabled':'toBeDisabled']();
      if(!own){await b.getByRole('button',{name:'Darts & correctie',exact:true}).click();await b.getByRole('button',{name:'Schrijven overnemen',exact:true}).click();await b.getByRole('button',{name:'Opties sluiten',exact:true}).click();}
      await digits(b,'60');await b.getByRole('button',{name:'Bevestigen',exact:true}).click();await expect(a.locator('.console-remaining').nth(1)).toHaveText('241');await expect(b.locator('.console-remaining').nth(1)).toHaveText('241');await expect(screen.locator('.sprint-number').nth(1)).toHaveText('241');
      let state:MatchView=await(await first.request.get(`/api/matches/${id}`)).json();expect(state.visits).toHaveLength(2);
      for(let turn=0;state.status==='live'&&turn<10;turn++){const remaining=state.remaining[state.turn],actor=own?(state.turn===0?first:second):second;state=await matchAction(actor,id,{type:'score',score:state.turn===0?remaining>170?remaining-40:remaining:0,...(state.turn===0&&remaining<=170?{doubleConfirmed:true}:{})});}
      expect(state.status).toBe('result');await matchAction(first,id,{type:'confirm'});await matchAction(second,id,{type:'confirm'});activeId=undefined;
    }
  }finally{
    try{
      if(activeId){let state:MatchView=await(await first.request.get(`/api/matches/${activeId}`)).json();for(let turn=0;state.status==='live'&&turn<12;turn++){const remaining=state.remaining[state.turn],actor=state.scoringMode==='per-player'?(state.turn===0?first:second):state.writerId==='00000000-0000-4000-8000-000000000003'?second:first;state=await matchAction(actor,activeId,{type:'score',score:state.turn===0?remaining>170?Math.min(180,remaining-40):remaining:0,darts:3,...(state.turn===0&&remaining<=170?{doubleConfirmed:true}:{})});}if(state.status==='result'){await matchAction(first,activeId,{type:'confirm'});await matchAction(second,activeId,{type:'confirm'});}}
    }finally{
      await Promise.allSettled([first.close(),second.close()]);
    }
  }
});
