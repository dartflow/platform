import {test,expect,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import type {CoreScoreQueue} from '../../lib/core-offline';
import type {MatchView} from '../../lib/types';

try{process.loadEnvFile('.env.local');}catch{/* CI supplies its explicit loopback fixture. */}
const actors={manager:'00000000-0000-4000-8000-000000000001',first:'00000000-0000-4000-8000-000000000002',second:'00000000-0000-4000-8000-000000000003'};
function requireLocal(baseURL?:string){for(const value of[baseURL,process.env.DARTFLOW_DATABASE_ADMIN_URL])if(!value||!['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname))throw Error('Canonical offline browser proof requires an explicit loopback app and fixture database.');}
async function login(page:Page,name:string){await page.goto('/inloggen?next=/app');await page.getByRole('button',{name:new RegExp(name)}).click();await expect(page).toHaveURL('/app');}
async function read(context:BrowserContext,id:string):Promise<MatchView>{const r=await context.request.get(`/api/matches/${id}`);expect(r.status(),await r.text()).toBe(200);return r.json();}
async function match(context:BrowserContext,origin:string,id:string,action:Record<string,unknown>):Promise<MatchView>{const current=await read(context,id),r=await context.request.post(`/api/matches/${id}/actions`,{headers:{Origin:origin},data:{requestId:randomUUID(),expectedRevision:current.revision,action}});expect(r.status(),await r.text()).toBe(200);return r.json();}
async function stored(page:Page,actor:string,id:string):Promise<CoreScoreQueue|null>{return page.evaluate(({actor,id})=>JSON.parse(localStorage.getItem(`dartflow-core-queue-v1:${actor}:${id}`)??'null'),{actor,id});}
async function consoleScore(page:Page,score:number){const dialog=page.getByRole('dialog',{name:'Schermvullende score-invoer',exact:true});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Gehele score wissen',exact:true}).click();for(const digit of String(score))await dialog.getByRole('button',{name:`Cijfer ${digit}`,exact:true}).click();await dialog.getByRole('button',{name:'Bevestigen',exact:true}).click();}
async function storageFault(page:Page,key:string,onLoad=false){
 const install=(key:string)=>{const target=window as Window&{__dartflowStorageFaultKey?:string};target.__dartflowStorageFaultKey=key;const original=Storage.prototype.setItem;Storage.prototype.setItem=function(name,value){if(name===target.__dartflowStorageFaultKey)throw new DOMException('Deliberate storage quota fault','QuotaExceededError');return original.call(this,name,value);};};
 if(onLoad)await page.addInitScript(install,key);else await page.evaluate(install,key);
}
async function shellReady(page:Page){await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await expect.poll(async()=>page.evaluate(async()=>{for(const name of await caches.keys()){const response=await(await caches.open(name)).match('/speelsessie');if(response?.headers.get('x-dartflow-offline-shell')==='1')return true;}return false;})).toBe(true);}

/** New event/club/match IDs only. The pre-existing local login profiles are never edited. */
async function fixture(browser:Browser,baseURL:string){
 const contexts=await Promise.all(Array.from({length:3},()=>browser.newContext({viewport:{width:390,height:844}}))),[owner,first,second]=contexts,pages=await Promise.all(contexts.map(context=>context.newPage())),[manager,a,b]=pages,requests:string[]=[],entities:string[]=[],matches:string[]=[];let eventId:string|undefined,clubId:string|undefined;
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();
 const command=async(context:BrowserContext,action:Record<string,unknown>)=>{const requestId=randomUUID();requests.push(requestId);const response=await context.request.post('/api/platform/actions',{headers:{Origin:baseURL},data:{requestId,action}});expect(response.status(),await response.text()).toBe(200);return response.json();};
 const cleanup=async()=>{
  await Promise.allSettled(contexts.map(context=>context.close()));
  try{await admin.query('begin');
   // Only event IDs emitted by this fixture are removed, including generated
   // notification copies and their dedupe rows; no actor-wide cleanup occurs.
   const sources=[...entities,...matches],mailIds=(await admin.query<{event_id:string}>("select event_id from dartflow_private.mail_outbox where entity_id=any($1::uuid[]) union select event_id from dartflow_private.mail_events where split_part(event_id,':',1)=any($2::text[]) or split_part(event_id,':',1)='match'and split_part(event_id,':',2)=any($3::text[])",[sources,requests,matches])).rows.map(row=>row.event_id);
   await admin.query('delete from dartflow_private.native_push_inbox where event_id=any($1::text[]) or reference->>\'entityId\'=any($2::text[])',[mailIds,sources]);
   await admin.query('delete from dartflow_private.mail_provider_events where job_id in(select id from dartflow_private.mail_outbox where entity_id=any($1::uuid[]))',[sources]);
   await admin.query('delete from dartflow_private.mail_outbox where entity_id=any($1::uuid[])',[sources]);await admin.query('delete from dartflow_private.mail_events where event_id=any($1::text[])',[mailIds]);
   for(const table of['platform_signals','player_match_kickoffs','match_results','match_confirmations','action_receipts','visits','match_players','platform_match_links'])await admin.query(`delete from dartflow_private.${table} where match_id=any($1::uuid[])`,[matches]);
   await admin.query('delete from dartflow_private.audit_events where match_id=any($1::uuid[]) or event_id=$2',[matches,eventId??null]);
   await admin.query('delete from dartflow_private.matches where id=any($1::uuid[])',[matches]);
   await admin.query('delete from dartflow_private.platform_audit where entity_id=any($1::uuid[])',[entities]);await admin.query('delete from dartflow_private.platform_receipts where request_id=any($1::uuid[])',[requests]);
   for(const table of['platform_messages','platform_reports'])await admin.query(`delete from dartflow_private.${table} where room_id=any($1::uuid[])`,[entities]);
   await admin.query('delete from dartflow_private.platform_entities where id=any($1::uuid[])',[entities]);
   for(const table of['board_activity_sessions','screen_capabilities','entries','boards','event_staff','standings'])await admin.query(`delete from dartflow_private.${table} where event_id=$1`,[eventId??null]);
   await admin.query('delete from dartflow_private.events where id=$1',[eventId??null]);await admin.query('delete from dartflow_private.club_memberships where club_id=$1',[clubId??null]);await admin.query('delete from dartflow_private.clubs where id=$1',[clubId??null]);await admin.query('commit');
  }finally{await admin.query('rollback');await admin.end();}
 };
 try{
  expect((await(await owner.request.get('/api/session')).json()).local).toBe(true);await login(manager,'Danny Goldenbelt');await login(a,'Michael de Groot');await login(b,'Raymond van Dijk');
  const created=await command(owner,{type:'tournament.create',name:`Core offline ${randomUUID().slice(0,8)}`,ownership:'personal',visibility:'private',eligibility:'all',format:'knockout',capacity:2,boards:1,requireWriter:false,startScore:501,bestOfLegs:5,inRule:'single',outRule:'double',startProcedure:'home-first'});entities.push(created.id,created.entity.state.roomId);eventId=created.entity.state.eventId;clubId=created.entity.state.coreClubId;
  for(const[context,userId]of[[first,actors.first],[second,actors.second]]as const){await command(context,{type:'competition.register',id:created.id,code:created.code});await command(owner,{type:'competition.checkin',id:created.id,userId});}
  const plan=await command(owner,{type:'competition.plan',id:created.id}),started=await command(owner,{type:'fixture.start',id:created.id,fixtureId:plan.entity.state.fixtures[0].id}),id=String(started.matchId);matches.push(id);
  await match(first,baseURL,id,{type:'accept'});await match(second,baseURL,id,{type:'accept'});const ready=await read(owner,id),writer=ready.writerId===actors.first?first:second,other=writer===first?second:first,writerPage=writer===first?a:b,actor=writer===first?actors.first:actors.second;
  await match(writer,baseURL,id,{type:'start'});await writerPage.goto(`/wedstrijd/${id}`);await expect(writerPage.getByRole('dialog',{name:'Schermvullende score-invoer',exact:true})).toBeVisible();await expect.poll(async()=>Boolean((await stored(writerPage,actor,id))?.base.scoringState)).toBe(true);await shellReady(writerPage);
  return{owner,manager,writer,other,writerPage,actor,id,admin,cleanup};
 }catch(error){await cleanup();throw error;}
}

test('canonical shared writer retains two actual offline scores across a service-worker reload and replays each original action once',async({browser,baseURL},info)=>{
 test.setTimeout(120000);requireLocal(baseURL);const f=await fixture(browser,baseURL!);
 try{
  const base=await read(f.writer,f.id);expect(base.scoringMode).toBe('shared-writer');await f.writerPage.evaluate(id=>localStorage.removeItem(`dartflow-core-last-actor:${id}`),f.id);await storageFault(f.writerPage,`dartflow-core-last-actor:${f.id}`);await f.writer.setOffline(true);
  await consoleScore(f.writerPage,60);await consoleScore(f.writerPage,40);await expect(f.writerPage.getByRole('dialog',{name:'Schermvullende score-invoer',exact:true}).getByRole('status').filter({hasText:'Wacht op verbinding (2)'})).toBeVisible();await expect.poll(async()=>(await stored(f.writerPage,f.actor,f.id))?.commands.length).toBe(2);const queue=(await stored(f.writerPage,f.actor,f.id))!;expect(queue.commands.map(c=>c.action)).toEqual([{type:'score',score:60,darts:3,doubleConfirmed:false},{type:'score',score:40,darts:3,doubleConfirmed:false}]);const requestIds=queue.commands.map(c=>c.requestId);
  expect(await f.writerPage.evaluate(id=>localStorage.getItem(`dartflow-core-last-actor:${id}`),f.id)).toBeNull();await f.writerPage.reload();await expect(f.writerPage.getByRole('heading',{name:'Partij hervatten',exact:true})).toBeVisible();await expect(f.writerPage.getByRole('status').filter({hasText:'Wacht op verbinding (2)'})).toBeVisible();await expect(f.writerPage.locator('.play-big')).toHaveText(['441','461']);expect((await stored(f.writerPage,f.actor,f.id))!.commands.map(c=>c.requestId)).toEqual(requestIds);await info.attach('canonical-two-offline-visits-after-index-quota-fault-and-reload',{body:await f.writerPage.screenshot(),contentType:'image/png'});
  await f.writer.setOffline(false);await f.writerPage.evaluate(()=>window.dispatchEvent(new Event('online')));await expect.poll(async()=>(await stored(f.writerPage,f.actor,f.id))?.commands.length).toBe(0);const accepted=await read(f.writer,f.id);expect(accepted.id).toBe(f.id);expect(accepted.visits.map(v=>v.score)).toEqual([60,40]);expect(accepted.remaining).toEqual([441,461]);
  // Retry the same real replay request; accepted receipts must prevent another visit.
  const retried=await f.writer.request.post(`/api/platform/matches/${f.id}/replay`,{headers:{Origin:baseURL!},data:{matchId:f.id,baseRevision:queue.base.revision,commands:queue.commands}});expect(retried.status(),await retried.text()).toBe(200);expect((await retried.json()).accepted).toEqual(requestIds);expect((await read(f.writer,f.id)).visits).toEqual(accepted.visits);
  expect((await f.admin.query('select count(*)::int n from dartflow_private.action_receipts where match_id=$1 and request_id=any($2::uuid[])',[f.id,requestIds])).rows[0].n).toBe(2);expect((await f.admin.query('select count(*)::int n from dartflow_private.ranking_sources where match_id=$1',[f.id])).rows[0].n).toBe(0);
 }finally{await f.writer.setOffline(false);await f.cleanup();}
});

test('canonical primary-storage failure on reload stays visible and retains the unqueued score until storage recovers',async({browser,baseURL})=>{
 test.setTimeout(120000);requireLocal(baseURL);const f=await fixture(browser,baseURL!),errors:string[]=[];
 try{
  f.writerPage.on('pageerror',error=>errors.push(error.message));await storageFault(f.writerPage,`dartflow-core-queue-v1:${f.actor}:${f.id}`,true);await f.writerPage.reload();
  const dialog=f.writerPage.getByRole('dialog',{name:'Schermvullende score-invoer',exact:true});await expect(dialog).toBeVisible();await expect(dialog.getByRole('status')).toContainText('Toestelopslag is niet beschikbaar');
  await consoleScore(f.writerPage,60);await expect(dialog.getByRole('textbox',{name:'Bezoekscore',exact:true})).toHaveValue('60');await expect(dialog.getByRole('status')).toContainText('Je invoer is nog niet bewaard');expect((await stored(f.writerPage,f.actor,f.id))!.commands).toHaveLength(0);expect((await read(f.writer,f.id)).visits).toHaveLength(0);expect(errors).toEqual([]);
  await f.writerPage.evaluate(()=>{delete(window as Window&{__dartflowStorageFaultKey?:string}).__dartflowStorageFaultKey;});await dialog.getByRole('button',{name:'Bevestigen',exact:true}).click();await expect.poll(async()=>(await read(f.writer,f.id)).visits.map(v=>v.score)).toEqual([60]);await expect.poll(async()=>(await stored(f.writerPage,f.actor,f.id))?.commands.length).toBe(0);expect(errors).toEqual([]);
 }finally{await f.cleanup();}
});

test('canonical manager compares both actual offline readings and selects the checked offline sequence with a reason',async({browser,baseURL},info)=>{
 test.setTimeout(120000);requireLocal(baseURL);const f=await fixture(browser,baseURL!);
 try{
  await f.writer.setOffline(true);await consoleScore(f.writerPage,90);await consoleScore(f.writerPage,0);await expect.poll(async()=>(await stored(f.writerPage,f.actor,f.id))?.commands.length).toBe(2);const queue=(await stored(f.writerPage,f.actor,f.id))!;
  await match(f.other,baseURL!,f.id,{type:'take-over'});await match(f.other,baseURL!,f.id,{type:'score',score:60,darts:3});await match(f.other,baseURL!,f.id,{type:'score',score:0,darts:3});const original=await read(f.owner,f.id);expect(original.remaining).toEqual([441,501]);
  await f.writer.setOffline(false);await f.writerPage.evaluate(()=>window.dispatchEvent(new Event('online')));await expect.poll(async()=>(await read(f.owner,f.id)).offlineConflict?.status).toBe('open');await f.manager.goto(`/wedstrijd/${f.id}`);
  const panel=f.manager.locator('section.panel').filter({has:f.manager.getByRole('heading',{name:'Offline scoreconflict',exact:true})});await expect(panel).toContainText('Server: 441 – 501 · 2 beurten');await expect(panel).toContainText('Offline: 411 – 501 · 2 beurten');await expect(panel.locator('ol li')).toHaveCount(2);await panel.getByRole('combobox',{name:'Geldige lezing',exact:true}).selectOption('use-offline');const reason='Beide volledige lezingen met de schrijver gecontroleerd; de offline reeks 90 en 0 is juist.';await panel.getByRole('textbox',{name:'Reden',exact:true}).fill(reason);await info.attach('canonical-both-readings-before-use-offline',{body:await panel.screenshot(),contentType:'image/png'});await panel.getByRole('button',{name:'Besluit vastleggen',exact:true}).click();await expect(panel).toContainText(`Afgehandeld: ${reason}`);
  const chosen=await read(f.owner,f.id);expect(chosen.id).toBe(f.id);expect(chosen.offlineConflict).toMatchObject({status:'resolved',decision:'use-offline',reason});expect(chosen.paused).toBe(false);expect(chosen.visits.map(v=>v.score)).toEqual([90,0]);expect(chosen.remaining).toEqual([411,501]);
  const preserved=(await f.admin.query<{action:{score:number};status:string;reason:string;accepted_state:{canonicalState:{game:{visits:{score:number}[]}}}}>('select action,status,reason,accepted_state from dartflow_private.match_offline_conflicts where match_id=$1 order by expected_revision',[f.id])).rows;expect(preserved.map(v=>v.action.score)).toEqual([90,0]);expect(preserved.every(v=>v.status==='resolved'&&v.reason===reason)).toBe(true);expect(preserved[0].accepted_state.canonicalState.game.visits.map(v=>v.score)).toEqual([60,0]);
  await expect.poll(async()=>(await stored(f.writerPage,f.actor,f.id))?.commands.length).toBe(0);expect(queue.commands).toHaveLength(2);await info.attach('canonical-use-offline-reasoned-decision',{body:await panel.screenshot(),contentType:'image/png'});
 }finally{await f.writer.setOffline(false);await f.cleanup();}
});

test('a new canonical visit entered during a real GET retains its proven base when the acknowledged prefix is followed by a writer takeover',async({browser,baseURL},info)=>{
 test.setTimeout(120000);requireLocal(baseURL);const f=await fixture(browser,baseURL!),protocol=await f.writer.newCDPSession(f.writerPage);let releaseReads=()=>{},replayRequest:string|undefined;
 try{
  const base=await read(f.writer,f.id);await f.writer.setOffline(true);await consoleScore(f.writerPage,60);await expect.poll(async()=>(await stored(f.writerPage,f.actor,f.id))?.commands.length).toBe(1);
  // Delay actual requests/responses only. Every score and response still comes
  // from the running server; no match state or HTTP payload is manufactured.
  let heldReads=0,holdReads=true;const readGate=new Promise<void>(resolve=>{releaseReads=resolve;});await f.writer.route(`**/api/matches/${f.id}`,async route=>{if(holdReads&&route.request().method()==='GET'){heldReads++;await readGate;}await route.continue();});
  protocol.on('Fetch.requestPaused',async event=>{if(event.responseStatusCode!==undefined&&!replayRequest)replayRequest=event.requestId;else await protocol.send('Fetch.continueResponse',{requestId:event.requestId});});
  await protocol.send('Fetch.enable',{patterns:[{urlPattern:`${baseURL}/api/platform/matches/${f.id}/replay`,requestStage:'Response'}]});
  await f.writer.setOffline(false);await f.writerPage.evaluate(()=>window.dispatchEvent(new Event('online')));await expect.poll(()=>heldReads).toBeGreaterThanOrEqual(2);await consoleScore(f.writerPage,40);const original=(await stored(f.writerPage,f.actor,f.id))!;expect(original.commands).toHaveLength(2);expect(original.commands.map(c=>c.expectedRevision)).toEqual([base.revision,base.revision+1]);holdReads=false;releaseReads();
  await expect.poll(()=>replayRequest).toBeTruthy();expect((await read(f.owner,f.id)).visits.map(v=>v.score)).toEqual([60]);await match(f.other,baseURL!,f.id,{type:'take-over'});await match(f.other,baseURL!,f.id,{type:'score',score:0,darts:3});await protocol.send('Fetch.continueResponse',{requestId:replayRequest!});await protocol.send('Fetch.disable');await f.writer.unroute(`**/api/matches/${f.id}`);
  await expect.poll(async()=>(await read(f.owner,f.id)).offlineConflict?.status,{timeout:20000}).toBe('open');const retained=(await stored(f.writerPage,f.actor,f.id))!;expect(retained.base.revision).toBe(base.revision);expect(retained.commands.map(c=>c.requestId)).toEqual(original.commands.map(c=>c.requestId));
  const conflicted=await read(f.owner,f.id);expect(conflicted.visits.map(v=>v.score)).toEqual([60,0]);expect(conflicted.offlineConflict?.readings?.offline?.visits.map(v=>v.score)).toEqual([60,40]);expect(conflicted.offlineConflict?.readings?.offline?.remaining).toEqual([441,461]);expect((await f.admin.query('select count(*)::int n from dartflow_private.action_receipts where match_id=$1 and request_id=$2',[f.id,original.commands[0].requestId])).rows[0].n).toBe(1);
  await f.manager.goto(`/wedstrijd/${f.id}`);const panel=f.manager.locator('section.panel').filter({has:f.manager.getByRole('heading',{name:'Offline scoreconflict',exact:true})});await expect(panel).toContainText('Server: 441 – 501 · 2 beurten');await expect(panel).toContainText('Offline: 441 – 461 · 2 beurten');await info.attach('canonical-inflight-get-preserves-acknowledged-prefix-and-new-visit',{body:await panel.screenshot(),contentType:'image/png'});
 }finally{releaseReads();await protocol.send('Fetch.disable').catch(()=>undefined);await f.writer.unroute(`**/api/matches/${f.id}`).catch(()=>undefined);await f.writer.setOffline(false);await f.cleanup();}
});
