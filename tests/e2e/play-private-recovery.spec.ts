import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import type {PlayResponse,PlaySessionView} from '../../lib/play-session-types';
import {openMatchDetails} from './helpers/score-console';
try{process.loadEnvFile('.env.local');}catch{/* CI supplies the loopback fixture. */}
function requireLocal(baseURL?:string){for(const url of[baseURL,process.env.DARTFLOW_DATABASE_ADMIN_URL])if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw Error('Private play recovery requires an explicit loopback app and fixture database.');}
async function create(context:BrowserContext,origin:string){
 expect((await(await context.request.get('/api/session')).json()).local).toBe(true);
 const suffix=randomUUID().slice(0,8),response=await context.request.post('/api/play/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),action:{type:'session.create',deviceMode:'shared',players:[{name:`Lea ${suffix}`},{name:`Noor ${suffix}`}],rules:{mode:'x01',startScore:501,inRule:'single'}}}});
 expect(response.status(),await response.text()).toBe(200);const result=await response.json() as PlayResponse,session=result.session!,controller=session.privateAccess!.grants.find(g=>g.purpose==='controller')!;return{session,controller};
}
async function read(context:BrowserContext,id:string,token:string):Promise<PlaySessionView>{const response=await context.request.get(`/api/play/sessions/${id}`,{headers:{'X-DartFlow-Play-Capability':token}});expect(response.status(),await response.text()).toBe(200);return response.json();}
async function stored(page:Page,id:string){return page.evaluate(id=>JSON.parse(localStorage.getItem(`dartflow-play-v1:${id}`)!),id);}
async function score(page:Page,factor:'Enkel'|'Triple',hit:string){const form=page.locator('.play-input');await form.getByRole('button',{name:factor,exact:true}).click();await form.getByRole('button',{name:hit,exact:true}).click();await form.getByRole('button',{name:'Beurt vastleggen',exact:true}).click();}
async function accepted(page:Page,id:string,count:number){await expect.poll(async()=>{const r=await stored(page,id);return{pending:r?.queue.length,visits:r?.session.game.visits.length};}).toEqual({pending:0,visits:count});}
async function cleanup(ids:string[]){const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();try{await admin.query('begin');for(const table of['play_receipts','play_capabilities'])await admin.query(`delete from dartflow_private.${table} where session_id=any($1::uuid[])`,[ids]);await admin.query('delete from dartflow_private.play_sessions where id=any($1::uuid[])',[ids]);await admin.query('commit');}finally{await admin.query('rollback');await admin.end();}}

test('anonymous private writer transfer survives app return and the former writer cannot submit another score',async({browser,baseURL},info)=>{
 requireLocal(baseURL);const first=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),second=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),ids:string[]=[];
 try{
  const {session,controller}=await create(first,new URL(baseURL!).origin);ids.push(session.id);const page=await first.newPage(),other=await second.newPage();await page.goto(controller.url);await expect(page.locator('.play-input')).toBeVisible();await score(page,'Triple','T20');await accepted(page,session.id,1);
  await openMatchDetails(page);await page.getByText('Telefoons, bewaren en sessie beheren',{exact:true}).click();await page.getByRole('combobox',{name:'Deelnemer',exact:true}).selectOption(session.participants[1].id);await page.getByRole('textbox',{name:'Reden',exact:true}).fill('Gecontroleerde overdracht naar de tweede telefoon');await page.getByRole('button',{name:'Schrijver overdragen aan gekozen deelnemer',exact:true}).click();
  const link=page.locator('.play-private-link').filter({has:page.getByRole('heading',{name:`${session.participants[1].name} · Eigen telefoon`,exact:true})}).getByRole('link',{name:'Privélink openen',exact:true});await expect(link).toBeVisible();const url=(await link.getAttribute('href'))!,token=new URL(url,baseURL).hash.slice('#participant='.length),moved=await read(first,session.id,controller.token);expect(moved.writer.participantId).toBe(session.participants[1].id);expect(moved.writer.epoch).toBe(session.writer.epoch+1);expect(moved.permissions.canScore).toBe(false);
  const rejected=await first.request.post('/api/play/actions',{headers:{Origin:new URL(baseURL!).origin,'X-DartFlow-Play-Capability':controller.token},data:{requestId:randomUUID(),sessionId:session.id,expectedRevision:moved.revision,action:{type:'session.score',writerEpoch:moved.writer.epoch,rulesHash:moved.rulesHash,input:{dartHits:['S20']}}}});expect(rejected.status(),await rejected.text()).toBe(403);
  await other.goto(url);await expect(other.locator('.play-input').getByRole('button',{name:'Beurt vastleggen',exact:true})).toBeDisabled();await score(other,'Enkel','S20');await accepted(other,session.id,2);await other.reload();await expect(other.locator('.play-session-heading')).toContainText('Verwerkt');const restored=await stored(other,session.id);expect(restored.token).toBe(token);expect(restored.session.writer.participantId).toBe(session.participants[1].id);expect(restored.session.id).toBe(session.id);
  await score(other,'Triple','T19');await accepted(other,session.id,3);const actual=await read(second,session.id,token);expect(actual.game.visits.map(v=>v.dartHits)).toEqual([['T20'],['S20'],['T19']]);expect(actual.rankingEligible).toBe(false);expect(actual.participants.every(p=>p.isGuest&&!p.claimed)).toBe(true);await info.attach('private-writer-transfer-recovered',{body:await other.screenshot(),contentType:'image/png'});
 }finally{await Promise.allSettled([first.close(),second.close()]);await cleanup(ids);}
});

test('a visit entered while a real refresh is in flight stays persisted and is replayed exactly once',async({browser,baseURL},info)=>{
 requireLocal(baseURL);const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),ids:string[]=[];const network=await context.newCDPSession(page);
 try{
  const {session,controller}=await create(context,new URL(baseURL!).origin);ids.push(session.id);await page.goto(controller.url);await expect(page.locator('.play-input')).toBeVisible();await accepted(page,session.id,0);
  // Chromium delays actual traffic; no route interception or fabricated server
  // response is used. The score is entered after GET starts and before it returns.
  await network.send('Network.enable');await network.send('Network.emulateNetworkConditions',{offline:false,latency:1800,downloadThroughput:-1,uploadThroughput:-1});const path=`/api/play/sessions/${session.id}`,request=page.waitForRequest(r=>r.method()==='GET'&&new URL(r.url()).pathname===path),response=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname===path);await page.evaluate(()=>window.dispatchEvent(new Event('online')));await request;
  await score(page,'Triple','T20');const queued=await stored(page,session.id);expect(queued.queue).toHaveLength(1);const requestId=queued.queue[0].requestId;expect(queued.queue[0].input.dartHits).toEqual(['T20']);await info.attach('new-visit-during-real-inflight-refresh',{body:await page.screenshot(),contentType:'image/png'});await(await response).finished();await network.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await expect.poll(async()=>(await read(context,session.id,controller.token)).game.visits.length).toBe(1);await accepted(page,session.id,1);await page.reload();await accepted(page,session.id,1);expect((await read(context,session.id,controller.token)).game.visits.map(v=>v.dartHits)).toEqual([['T20']]);
  // The exact generated visit ID has one durable receipt, not a replacement
  // request generated by a refresh or app return.
  const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();try{expect((await admin.query('select count(*)::int n from dartflow_private.play_receipts where session_id=$1 and request_id=$2',[session.id,requestId])).rows[0].n).toBe(1);}finally{await admin.end();}
 }finally{await network.detach();await context.close();await cleanup(ids);}
});

test('two personal guest claim links restore their own completed participation without granting either phone write access',async({browser,baseURL},info)=>{
 requireLocal(baseURL);const owner=await browser.newContext({serviceWorkers:'block'}),first=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),second=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),ids:string[]=[];
 try{
  const {session,controller}=await create(owner,new URL(baseURL!).origin);ids.push(session.id);let current=await read(owner,session.id,controller.token);
  const send=async(action:unknown)=>{const response=await owner.request.post('/api/play/actions',{headers:{Origin:new URL(baseURL!).origin,'X-DartFlow-Play-Capability':controller.token},data:{requestId:randomUUID(),sessionId:session.id,expectedRevision:current.revision,action}});expect(response.status(),await response.text()).toBe(200);const result=await response.json() as PlayResponse;current=result.session!;return result;};
  for(const dartHits of[['T20','T20','T20'],['MISS'],['T20','T20','T20'],['MISS'],['T20','T19','D12']])await send({type:'session.score',writerEpoch:current.writer.epoch,rulesHash:current.rulesHash,input:{dartHits}});
  expect(current.status).toBe('completed');const links=[];for(const participant of session.participants){const result=await send({type:'session.issue-link',participantId:participant.id,purpose:'claim'});links.push(result.session!.privateAccess!.grants.find(g=>g.purpose==='claim')!);}
  for(const [index,context]of[first,second].entries()){
   const page=await context.newPage();await page.goto(links[index].url);await expect(page.getByRole('heading',{name:'Bewaar je eigen gastresultaat',exact:true})).toBeVisible();await expect(page.locator('.play-session-heading')).toContainText('Afgerond');await expect(page.getByRole('link',{name:'Aanmelden of account maken',exact:true})).toBeVisible();await expect(page.locator('.play-input')).toHaveCount(0);
   const preview=await stored(page,session.id);expect(preview.session.currentParticipantId).toBe(session.participants[index].id);expect(preview.session.permissions).toMatchObject({canClaim:true,canScore:false,canUndo:false,canManage:false,canTransfer:false});expect(preview.token).toBeUndefined();expect(preview.session.participants.every((p:{accountId?:string})=>!p.accountId)).toBe(true);expect(preview.session.rankingEligible).toBe(false);
   await page.reload();await expect(page.locator('.play-session-heading')).toContainText('Afgerond');expect((await stored(page,session.id)).session.currentParticipantId).toBe(session.participants[index].id);expect(new URL(page.url()).hash).toBe('');await info.attach(`guest-${index+1}-own-private-claim-preview`,{body:await page.screenshot(),contentType:'image/png'});
  }
  const canonical=await read(owner,session.id,controller.token);expect(canonical.game.visits).toHaveLength(5);expect(canonical.participants.every(p=>!p.claimed&&!p.accountId)).toBe(true);expect(canonical.rankingEligible).toBe(false);
 }finally{await Promise.allSettled([owner.close(),first.close(),second.close()]);await cleanup(ids);}
});

test('an actually expired private controller link offers account history and help without score input',async({browser,baseURL})=>{
 requireLocal(baseURL);const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),ids:string[]=[];
 try{const {session,controller}=await create(context,new URL(baseURL!).origin);ids.push(session.id);const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();try{await admin.query("update dartflow_private.play_capabilities set expires_at=clock_timestamp()-interval '1 second' where session_id=$1 and purpose='controller'",[session.id]);}finally{await admin.end();}
  const page=await context.newPage();await page.goto(controller.url);await expect(page.getByRole('heading',{name:'Deze privélink is verlopen',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Eigen historie openen',exact:true})).toHaveAttribute('href','/inloggen?next=/app/history');await expect(page.getByRole('link',{name:'Bekijk de mogelijkheden',exact:true})).toHaveAttribute('href','/handleiding/gast-bewaren');await expect(page.locator('.play-input')).toHaveCount(0);await page.reload();await expect(page.getByRole('heading',{name:'Deze privélink is verlopen',exact:true})).toBeVisible();
 }finally{await context.close();await cleanup(ids);}
});
