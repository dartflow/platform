import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {MatchAction,MatchView} from '../../lib/types';
import type {PlatformEntity,PlatformResponse} from '../../lib/platform-types';

async function login(page:Page,name:string){await page.goto('/inloggen?next=/app');await page.getByRole('button',{name:new RegExp(name)}).click();await expect(page).toHaveURL('/app');}
async function platform(context:BrowserContext,origin:string,action:Record<string,unknown>):Promise<PlatformResponse>{const response=await context.request.post('/api/platform/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),action}});expect(response.status(),await response.text()).toBe(200);return response.json();}
async function read(context:BrowserContext,id:string):Promise<MatchView>{const response=await context.request.get(`/api/matches/${id}`);expect(response.status()).toBe(200);return response.json();}
async function act(context:BrowserContext,origin:string,id:string,action:MatchAction){const current=await read(context,id),response=await context.request.post(`/api/matches/${id}/actions`,{headers:{Origin:origin},data:{requestId:randomUUID(),expectedRevision:current.revision,action}});expect(response.status(),await response.text()).toBe(200);return response.json() as Promise<MatchView>;}

test('real HTTP tournament bull ties reverse order, requires two identities and reaches the public Oche scorecard',async({browser,baseURL},info)=>{
 test.setTimeout(120000);if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Bull acceptance uses only the explicit loopback environment.');
 const origin=new URL(baseURL).origin,first=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),second=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),publicViewer=await browser.newContext({serviceWorkers:'block'});
 const a=await first.newPage(),b=await second.newPage(),display=await publicViewer.newPage();let matchId:string|undefined,screenId:string|undefined;
 const identities=new Map<string,{context:BrowserContext;page:Page}>();
 try{
  // No mocked API routes or fabricated match snapshots: every sport transition
  // below goes through the running application and its ordinary two logins.
  expect((await(await first.request.get('/api/session')).json()).local).toBe(true);await login(a,'Michael de Groot');await login(b,'Raymond van Dijk');
  for(const [context,page]of [[first,a],[second,b]] as const){const session=await(await context.request.get('/api/session')).json();identities.set(session.user.id,{context,page});}
  const created=await platform(first,origin,{type:'tournament.create',ownership:'personal',name:`Bull browser ${randomUUID().slice(0,8)}`,capacity:2,format:'knockout',boards:1,requireWriter:false,startScore:501,bestOfLegs:1,startProcedure:'bull',setOpener:'alternate-sets',decidingLeg:'rebull'});
  for(const context of[first,second]){await platform(context,origin,{type:'competition.register',id:created.id,code:created.code});await platform(context,origin,{type:'competition.checkin',id:created.id});}
  const planned=await platform(first,origin,{type:'competition.plan',id:created.id}),event=planned.entity as PlatformEntity,fixture=event.state.fixtures!.find(f=>f.status==='scheduled'&&f.players.every(Boolean))!;
  const boardResponse=await first.request.get(`/api/events/${event.state.eventId}/boards`);expect(boardResponse.status()).toBe(200);const board=(await boardResponse.json()).boards.find((candidate:{blocked:boolean;matchId:string|null})=>!candidate.blocked&&!candidate.matchId);expect(board).toBeTruthy();
  matchId=(await platform(first,origin,{type:'fixture.assign',id:event.id,fixtureId:fixture.id,boardId:board.id})).matchId!;const id=matchId;
  await a.goto(`/wedstrijd/${id}`);await b.goto(`/wedstrijd/${id}`);
  const syncUI=async(page:Page)=>{const current=await read(first,id);await expect(page.locator('.revision-label')).toContainText(`revisie ${current.revision}`);};
  for(const page of[a,b]){await syncUI(page);await page.getByRole('button',{name:'Ik ben klaar om te spelen',exact:true}).click();await expect.poll(async()=>(await read(first,id)).accepted.filter(Boolean).length).toBe(page===a?1:2);}
  await expect.poll(async()=>(await read(first,id)).status).toBe('ready');
  let state=await read(first,id);expect(state.settings).toMatchObject({startProcedure:'bull',setOpener:'alternate-sets',decidingLeg:'rebull'});expect(state.visits).toHaveLength(0);
  const issued=await first.request.post('/api/screens',{headers:{Origin:origin},data:{eventId:state.eventId,boardId:state.boardId}});expect(issued.status(),await issued.text()).toBe(200);const screen=await issued.json();screenId=screen.id;
  const snapshot=async()=>{const response=await publicViewer.request.get(`/api/screen/${screen.url.split('/').at(-1)}`);expect(response.status(),await response.text()).toBe(200);return response.json();};
  const throwViaUI=async(side:number,label:string)=>{const page=identities.get(state.players[side].id)!.page;await syncUI(page);await page.getByRole('region',{name:'Startprocedure',exact:true}).getByRole('button',{name:label,exact:true}).click();};
  for(const page of[a,b])await expect(page.getByRole('button',{name:'Wedstrijd starten',exact:true}).first()).toBeDisabled();
  await throwViaUI(0,'Enkele bull');await expect.poll(async()=>(await read(first,id)).bull?.throws.length).toBe(1);await throwViaUI(1,'Enkele bull');
  await expect.poll(async()=>(await read(first,id)).bull?.round).toBe(2);state=await read(first,id);expect(state.bull!.order).toEqual([1,0]);
  await throwViaUI(1,'Dubbele bull');await expect.poll(async()=>(await read(first,id)).bull?.throws.length).toBe(3);await throwViaUI(0,'Buiten de bull');
  await expect.poll(async()=>(await read(first,id)).bull?.status).toBe('confirming');expect((await read(first,id)).visits).toHaveLength(0);
  await syncUI(a);await a.getByRole('button',{name:'Bevestig bulluitslag namens mijn zijde',exact:true}).click();
  await expect.poll(async()=>(await read(first,id)).bull?.confirmed.filter(Boolean).length).toBe(1);for(const page of[a,b])await expect(page.getByRole('button',{name:'Wedstrijd starten',exact:true}).first()).toBeDisabled();
  await syncUI(b);await b.getByRole('button',{name:'Bevestig bulluitslag namens mijn zijde',exact:true}).click();await expect.poll(async()=>(await read(first,id)).bull?.status).toBe('complete');
  const publicState=(await snapshot()).match;expect(publicState.bull).toMatchObject({round:2,winner:1,confirmed:[true,true],status:'complete'});expect(Object.keys(publicState.bull).sort()).toEqual(['confirmed','legNumber','order','reason','round','setNumber','status','throws','winner']);for(const hit of publicState.bull.throws)expect(Object.keys(hit).sort()).toEqual(['hit','round','side']);for(const actorId of identities.keys())expect(JSON.stringify({bull:publicState.bull,startDecision:publicState.startDecision})).not.toContain(actorId);
  await display.goto(screen.url);await expect(display.locator('.sprint-number')).toHaveText(['501','501']);
  await syncUI(a);await a.getByRole('button',{name:'Wedstrijd starten',exact:true}).first().click();await expect.poll(async()=>(await read(first,id)).status).toBe('live');state=await read(first,id);expect(state.turn).toBe(1);
  const writer=identities.get(state.writerId)!.page;await expect(writer.getByRole('dialog',{name:'Schermvullende score-invoer'})).toBeVisible();for(const digit of ['1','0','0'])await writer.getByRole('dialog',{name:'Schermvullende score-invoer'}).getByRole('button',{name:`Cijfer ${digit}`,exact:true}).click();await writer.getByRole('button',{name:'Bevestigen',exact:true}).click();
  await expect.poll(async()=>(await read(first,id)).visits.length).toBe(1);state=await read(first,id);expect(state.remaining).toEqual([501,401]);await expect(display.locator('.sprint-number')).toHaveText(['501','401']);await info.attach('real-bull-tie-and-first-visit',{body:await display.screenshot(),contentType:'image/png'});
  // Complete this recreational source through the same backend so the shared
  // local accounts and board are free for the following acceptance scenarios.
  for(let count=0;state.status==='live'&&count<20;count++){const remaining=state.remaining[state.turn],score=remaining>170?Math.min(180,remaining-40):remaining;state=await act(identities.get(state.writerId)!.context,origin,id,{type:'score',score,...(score===remaining?{doubleConfirmed:true}:{})});}
  expect(state.status).toBe('result');for(const player of state.players)state=await act(identities.get(player.id)!.context,origin,id,{type:'confirm'});expect(state.status).toBe('confirmed');
 }finally{
  if(matchId)await (async()=>{let current=await read(first,matchId!);if(!['called','ready','live','result'].includes(current.status))return;for(const player of current.players)if(!current.accepted[current.players.indexOf(player)])current=await act(identities.get(player.id)!.context,origin,matchId!,{type:'accept'});for(let count=0;current.bull&&current.bull.status!=='complete'&&count<8;count++){if(current.bull.status==='throwing')current=await act(identities.get(current.writerId)!.context,origin,matchId!,{type:'bull-throw',hit:current.bull.throws.filter(t=>t.round===current.bull!.round).length?'outside':'DB'});else for(const player of current.players)if(!current.bull!.confirmed[current.players.indexOf(player)])current=await act(identities.get(player.id)!.context,origin,matchId!,{type:'bull-confirm'});}if(current.status==='ready')current=await act(first,origin,matchId!,{type:'start'});for(let count=0;current.status==='live'&&count<20;count++){const remaining=current.remaining[current.turn],score=remaining>170?Math.min(180,remaining-40):remaining;current=await act(identities.get(current.writerId)!.context,origin,matchId!,{type:'score',score,...(score===remaining?{doubleConfirmed:true}:{})});}if(current.status==='result')for(const player of current.players)if(!current.confirmations[current.players.indexOf(player)])current=await act(identities.get(player.id)!.context,origin,matchId!,{type:'confirm'});})().catch(()=>{});
  if(screenId)await first.request.delete(`/api/screens/${screenId}`,{headers:{Origin:origin}}).catch(()=>{});await Promise.allSettled([first.close(),second.close(),publicViewer.close()]);
 }
});
