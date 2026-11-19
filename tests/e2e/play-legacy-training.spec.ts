import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {openMatchDetails} from './helpers/score-console';

try{process.loadEnvFile('.env.local');}catch{/* CI supplies its own explicit loopback database. */}
async function login(page:Page){await page.goto('/inloggen?next=/app');await page.getByRole('button',{name:/Danny Goldenbelt/}).click();await expect(page).toHaveURL('/app');}
async function local(context:BrowserContext,baseURL:string|undefined){
 for(const value of[baseURL,process.env.DARTFLOW_DATABASE_ADMIN_URL])if(!value||!['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname))throw Error('Legacy offline acceptance requires a loopback application and fixture database.');
 expect((await(await context.request.get('/api/session')).json()).local).toBe(true);
}
async function create(context:BrowserContext,origin:string){const response=await context.request.post('/api/platform/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),action:{type:'training.create',mode:'solo',startScore:301,inRule:'single'}}});expect(response.status(),await response.text()).toBe(200);return(await response.json()).entity;}
async function read(context:BrowserContext,id:string){const response=await context.request.get(`/api/trainings/${id}`);expect(response.status(),await response.text()).toBe(200);return(await response.json()).entity;}
async function visit(context:BrowserContext,origin:string,id:string,score:number){const entity=await read(context,id),response=await context.request.post('/api/platform/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),expectedRevision:entity.revision,action:{type:'training.score',id,score,darts:3}}});expect(response.status(),await response.text()).toBe(200);return(await response.json()).entity;}
async function cleanup(id?:string){
 if(!id)return;
 const client=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await client.connect();
 try{await client.query('begin');
  // Only the UUID returned by this test's own training.create is removed.
  await client.query('delete from dartflow_private.board_score_events where source_id=$1',[id]);
  await client.query("delete from dartflow_private.platform_receipts where response->>'id'=$1 or response->'entity'->>'id'=$1 or response->>'sourceId'=$1",[id]);
  await client.query('delete from dartflow_private.platform_audit where entity_id=$1',[id]);
  await client.query("delete from dartflow_private.platform_entities where id=$1 and kind='training'",[id]);
  await client.query('commit');
 }finally{await client.query('rollback');await client.end();}
}
async function digits(page:Page,value:string){const dialog=page.getByRole('dialog',{name:'Schermvullende score-invoer',exact:true});await dialog.getByRole('button',{name:'Gehele score wissen',exact:true}).click();for(const digit of value)await dialog.getByRole('button',{name:`Cijfer ${digit}`,exact:true}).click();}
/** Only local Storage transport is faulted; all sporting actions use the real server. */
async function storageFailure(page:Page,kind:'write'|'remove'|null){
 await page.evaluate(kind=>{
  const fixture=window as Window&{legacyStorageOriginal?:{setItem:typeof Storage.prototype.setItem;removeItem:typeof Storage.prototype.removeItem}};
  if(fixture.legacyStorageOriginal){Storage.prototype.setItem=fixture.legacyStorageOriginal.setItem;Storage.prototype.removeItem=fixture.legacyStorageOriginal.removeItem;delete fixture.legacyStorageOriginal;}
  if(kind===null)return;
  const original={setItem:Storage.prototype.setItem,removeItem:Storage.prototype.removeItem};fixture.legacyStorageOriginal=original;
  if(kind==='write')Storage.prototype.setItem=function(key,value){if(key.startsWith('dartflow-legacy-training-queue:'))throw new DOMException('Synthetic device quota exceeded','QuotaExceededError');original.setItem.call(this,key,value);};
  else Storage.prototype.removeItem=function(key){if(key.startsWith('dartflow-legacy-training-queue:'))throw new DOMException('Synthetic storage unavailable','SecurityError');original.removeItem.call(this,key);};
 },kind);
}
async function queued(page:Page,id:string){return page.evaluate(id=>{const key=Object.keys(localStorage).find(key=>key.startsWith('dartflow-legacy-training-queue:')&&key.endsWith(`:${id}`));return key?JSON.parse(localStorage.getItem(key)!).commands as {requestId:string}[]:[];},id);}

test('legacy solo console and detail form retain two actual offline visits, reject a storage failure, and retry accepted cleanup once',async({browser,baseURL},info)=>{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});let id:string|undefined;
 try{
  await local(context,baseURL);const page=await context.newPage();await login(page);const entity=await create(context,new URL(baseURL!).origin);id=entity.id;
  await page.goto(`/app/training/${id}`);const console=page.getByRole('dialog',{name:'Schermvullende score-invoer',exact:true});await expect(console).toBeVisible();await expect(console).toContainText('Solo 301');await expect(page.locator('.console-remaining')).toHaveText('301');
  await context.setOffline(true);await storageFailure(page,'write');await digits(page,'153');await console.getByRole('button',{name:'Bevestigen',exact:true}).click();
  await expect(console.getByRole('status')).toContainText('Toestelopslag is niet beschikbaar');await expect(console.getByLabel('Bezoekscore',{exact:true})).toHaveValue('153');await expect(page.locator('.console-remaining')).toHaveText('301');expect(await queued(page,id!)).toEqual([]);
  await storageFailure(page,null);await console.getByRole('button',{name:'Bevestigen',exact:true}).click();await expect(page.locator('.console-remaining')).toHaveText('148');await expect(console.getByLabel('Bezoekscore',{exact:true})).toBeEmpty();
  await openMatchDetails(page);await expect(page.getByRole('heading',{name:'Solo 301',exact:true})).toBeVisible();await page.getByRole('spinbutton',{name:'Beurtscore',exact:true}).fill('60');await page.getByRole('button',{name:'Score invoeren',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'2 bewaarde acties'})).toBeVisible();await expect(page.locator('.training-remaining')).toHaveText('88');const originalIds=(await queued(page,id!)).map(command=>command.requestId);expect(originalIds).toHaveLength(2);
  await info.attach('legacy-console-and-detail-two-offline-visits',{body:await page.screenshot(),contentType:'image/png'});
  // A committed server ACK followed by failing local removal must retain the
  // original IDs rather than report successful durable cleanup or drop them.
  await storageFailure(page,'remove');await context.setOffline(false);await expect.poll(async()=>(await read(context,id!)).state.game.visits.length).toBe(2);const storageAlert=page.getByRole('alert').filter({hasText:'Toestelopslag is niet beschikbaar'});await expect(storageAlert).toHaveCount(1);await expect(storageAlert).toBeVisible();expect((await queued(page,id!)).map(command=>command.requestId)).toEqual(originalIds);
  await storageFailure(page,null);await page.getByRole('button',{name:'Zelfde worp opnieuw proberen',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Verwerkt · 2 geaccepteerde beurten'})).toBeVisible();expect(await queued(page,id!)).toEqual([]);
  const actual=await read(context,id!);expect(actual.id).toBe(id);expect(actual.state.game.visits.map((v:{score:number})=>v.score)).toEqual([153,60]);expect(actual.state.game.remaining[0]).toBe(88);
  await page.reload();await expect(page.locator('.console-remaining')).toHaveText('88');await openMatchDetails(page);await expect(page.locator('.training-remaining')).toHaveText('88');expect((await read(context,id!)).state.game.visits).toHaveLength(2);
 }finally{await context.setOffline(false);await context.close();await cleanup(id);}
});

test('legacy solo web owner compares complete offline reading and records a reasoned choice',async({browser,baseURL},info)=>{
 const phone=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),second=await browser.newContext({serviceWorkers:'block'});let id:string|undefined;
 try{
  await local(phone,baseURL);const page=await phone.newPage(),other=await second.newPage();await login(page);await login(other);const origin=new URL(baseURL!).origin,entity=await create(phone,origin);id=entity.id;await visit(phone,origin,id!,153);await page.goto(`/app/training/${id}`);await expect(page.locator('.console-remaining')).toHaveText('148');await openMatchDetails(page);
  await phone.setOffline(true);for(const score of[60,0]){await page.getByRole('spinbutton',{name:'Beurtscore',exact:true}).fill(String(score));await page.getByRole('button',{name:'Score invoeren',exact:true}).click();}await expect(page.locator('.training-remaining')).toHaveText('88');await visit(second,origin,id!,40);await phone.setOffline(false);
  const panel=page.getByRole('region',{name:'Offline trainingsbesluit',exact:true});await expect(panel).toBeVisible();await expect(panel).toContainText('Geaccepteerd: 108');await expect(panel).toContainText('Bewaarde lezing: 88');await panel.getByRole('combobox',{name:'Geldige scorekaart',exact:true}).selectOption('use-offline');await panel.getByRole('textbox',{name:'Reden',exact:true}).fill('Beide volledige scorekaarten gecontroleerd; de bewaarde reeks klopt.');await info.attach('legacy-training-both-scorecards',{body:await panel.screenshot(),contentType:'image/png'});await panel.getByRole('button',{name:'Besluit vastleggen',exact:true}).click();await expect(panel).toContainText('Afgehandeld:');
  const actual=await read(phone,id!);expect(actual.state.game.visits.map((v:{score:number})=>v.score)).toEqual([153,60,0]);expect(actual.state.game.remaining[0]).toBe(88);expect(actual.state.offlineConflict.decision).toBe('use-offline');
 }finally{await phone.setOffline(false);await Promise.allSettled([phone.close(),second.close()]);await cleanup(id);}
});
