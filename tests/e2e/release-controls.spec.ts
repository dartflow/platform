import{test,expect,type BrowserContext,type Page}from'@playwright/test';
import{randomUUID}from'node:crypto';
import type{MatchView}from'../../lib/types';
const origin='http://localhost:3000';
const people={host:'00000000-0000-4000-8000-000000000001',a:'00000000-0000-4000-8000-000000000002',b:'00000000-0000-4000-8000-000000000003'};
async function login(page:Page,name:string){await page.goto('/inloggen?next=/app');await page.getByRole('button',{name:new RegExp(name)}).click();await expect(page).toHaveURL('/app');}
async function local(context:BrowserContext,baseURL:string|undefined){if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname)||(await(await context.request.get('/api/session')).json()).local!==true)throw Error('Release controls require the loopback fixture application.');}
async function command(context:BrowserContext,path:string,action:Record<string,unknown>){const r=await context.request.post(path,{headers:{Origin:origin},data:{requestId:randomUUID(),action}});expect(r.status(),await r.text()).toBe(200);return r.json();}
async function read(context:BrowserContext,id:string):Promise<MatchView>{const r=await context.request.get(`/api/matches/${id}`);expect(r.status(),await r.text()).toBe(200);return r.json();}
async function match(context:BrowserContext,id:string,action:Record<string,unknown>):Promise<MatchView>{const v=await read(context,id),r=await context.request.post(`/api/matches/${id}/actions`,{headers:{Origin:origin},data:{requestId:randomUUID(),expectedRevision:v.revision,action}});expect(r.status(),await r.text()).toBe(200);return r.json();}

test('club manager pauses and resumes one real ranking while participant sees no private reason',async({browser,baseURL},info)=>{
 const owner=await browser.newContext({viewport:{width:1440,height:900}}),player=await browser.newContext({viewport:{width:390,height:844}});
 try{
  await local(owner,baseURL);const manager=await owner.newPage(),member=await player.newPage();await login(manager,'Danny Goldenbelt');await login(member,'Michael de Groot');
  const suffix=randomUUID().slice(0,8),club=await command(owner,'/api/platform/actions',{type:'club.create',name:`Publicatieclub ${suffix}`,description:'Lokale acceptatieproef.'});
  await command(owner,'/api/platform/actions',{type:'club.settings',id:club.id,joinPolicy:'open'});await command(player,'/api/platform/actions',{type:'club.request',id:club.id});
  const name=`Publicatiestand ${suffix}`,list=await command(owner,'/api/rankings/actions',{type:'list.create',clubId:club.id,kind:'rating',name});
  await manager.goto('/app/rankings');await manager.getByRole('combobox',{name:'Kies een ranking of circuit'}).selectOption(list.id);await expect(manager.getByRole('heading',{name,exact:true})).toBeVisible();
  const management=manager.locator('details').filter({has:manager.locator('summary').filter({hasText:`${name} beheren`})});await management.locator('summary').click();
  const privateReason=`ALLEEN-LEIDING-${suffix}`;await management.getByLabel('Reden van publicatiebesluit',{exact:true}).fill(privateReason);await management.getByRole('button',{name:'Publicatie pauzeren',exact:true}).click();await expect(management.getByRole('button',{name:'Herbouwen en publicatie hervatten',exact:true})).toBeVisible();
  await member.goto('/app/rankings');await member.getByRole('combobox',{name:'Kies een ranking of circuit'}).selectOption(list.id);await expect(member.getByRole('status').filter({hasText:'Publicatie tijdelijk gepauzeerd.'})).toBeVisible();await expect(member.getByText(privateReason,{exact:false})).toHaveCount(0);await expect(member.getByRole('button',{name:'Herbouwen en publicatie hervatten',exact:true})).toHaveCount(0);
  const participant=await(await player.request.get(`/api/rankings?listId=${list.id}`)).json();expect(participant.selectedList.publication.reason).toBeNull();expect(participant.selectedList.publication.pending).toBe(false);
  await info.attach('ranking-pause-manager-desktop',{body:await manager.screenshot(),contentType:'image/png'});await info.attach('ranking-pause-player-mobile',{body:await member.screenshot(),contentType:'image/png'});
  await management.getByLabel('Reden van publicatiebesluit',{exact:true}).fill('Geaccepteerde bronnen gecontroleerd; publicatie hervatten.');await management.getByRole('button',{name:'Herbouwen en publicatie hervatten',exact:true}).click();await expect(management.getByRole('button',{name:'Publicatie pauzeren',exact:true})).toBeVisible();
  const resumed=await(await owner.request.get(`/api/rankings?listId=${list.id}`)).json();expect(resumed.selectedList.publication).toMatchObject({paused:false,revision:2});expect(resumed.history).toHaveLength(0);
 }finally{await Promise.allSettled([owner.close(),player.close()]);}
});

test('real tournament offline conflict preserves both readings and the manager resolves it in the web UI',async({browser,baseURL},info)=>{
 test.setTimeout(120000);const owner=await browser.newContext({viewport:{width:1440,height:900}}),first=await browser.newContext({viewport:{width:390,height:844}}),second=await browser.newContext({viewport:{width:390,height:844}});let id:string|undefined;
 try{
  await local(owner,baseURL);const manager=await owner.newPage(),a=await first.newPage(),b=await second.newPage();await login(manager,'Danny Goldenbelt');await login(a,'Michael de Groot');await login(b,'Raymond van Dijk');
  const e=await command(owner,'/api/platform/actions',{type:'tournament.create',name:`Offline avond ${randomUUID().slice(0,8)}`,ownership:'personal',clubId:null,visibility:'private',eligibility:'all',format:'knockout',capacity:16,boards:1,requireWriter:false});
  for(const[ctx,userId]of[[first,people.a],[second,people.b]]as const){await command(ctx,'/api/platform/actions',{type:'competition.register',id:e.id,code:e.code});await command(owner,'/api/platform/actions',{type:'competition.checkin',id:e.id,userId});}
  const planned=await command(owner,'/api/platform/actions',{type:'competition.plan',id:e.id}),started=await command(owner,'/api/platform/actions',{type:'fixture.start',id:e.id,fixtureId:planned.entity.state.fixtures[0].id});id=started.matchId;
  await match(first,id!,{type:'accept'});await match(second,id!,{type:'accept'});let v=await read(owner,id!);const original=v.writerId===people.a?first:second,other=original===first?second:first;v=await match(original,id!,{type:'start'});
  const stale={requestId:randomUUID(),expectedRevision:v.revision,offline:true,action:{type:'score',score:90,darts:3}};v=await match(original,id!,{type:'score',score:60,darts:3});v=await match(other,id!,{type:'take-over'});v=await match(other,id!,{type:'score',score:0,darts:3});const accepted=structuredClone(v.visits);
  const rejected=await original.request.post(`/api/matches/${id}/actions`,{headers:{Origin:origin},data:stale});expect(rejected.status(),await rejected.text()).toBe(409);v=await read(owner,id!);expect(v.visits).toEqual(accepted);expect(v.paused).toBe(true);
  await manager.goto(`/wedstrijd/${id}`);const panel=manager.locator('section.panel').filter({has:manager.getByRole('heading',{name:'Offline scoreconflict',exact:true})});await expect(panel.getByRole('alert')).toContainText('Deze partij wacht op beoordeling door de sessiebeheerder of wedstrijdleiding.');await expect(panel.locator('ol')).toContainText('90 punten');
  await a.goto(`/wedstrijd/${id}`);await expect(a.getByRole('heading',{name:'Offline scoreconflict',exact:true})).toBeVisible();await expect(a.getByRole('button',{name:'Besluit vastleggen',exact:true})).toHaveCount(0);await expect(a.getByRole('dialog',{name:'Schermvullende score-invoer'})).toHaveCount(0);
  await info.attach('offline-conflict-manager-desktop',{body:await manager.screenshot(),contentType:'image/png'});await info.attach('offline-conflict-writer-mobile',{body:await a.screenshot(),contentType:'image/png'});
  await panel.getByRole('combobox',{name:'Geldige lezing',exact:true}).selectOption('keep-server');await panel.getByLabel('Reden',{exact:true}).fill('Beide scorekaarten gecontroleerd; de twee geaccepteerde beurten blijven staan.');await panel.getByRole('button',{name:'Besluit vastleggen',exact:true}).click();await expect(panel).toContainText('Afgehandeld:');v=await read(owner,id!);expect(v.offlineConflict?.status).toBe('resolved');expect(v.visits).toEqual(accepted);expect(v.paused).toBe(false);
 }finally{
  try{if(id){let v=await read(owner,id);if(v.offlineConflict?.status==='open')v=await match(owner,id,{type:'resolve-offline-conflict',conflictId:v.offlineConflict.id,reason:'Lokale proefopruiming: geaccepteerde scorekaart behouden.'});for(let i=0;v.status==='live'&&i<100;i++){const ctx=v.writerId===people.a?first:second,remaining=v.remaining[v.turn],score=v.turn===0?Math.min(180,remaining):0;v=await match(ctx,id,{type:'score',score,darts:3,doubleConfirmed:score>0&&score===remaining});}if(v.status==='result'){await match(first,id,{type:'confirm'});await match(second,id,{type:'confirm'});}}}
  finally{await Promise.allSettled([owner.close(),first.close(),second.close()]);}
 }
});
