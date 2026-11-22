import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import type {PlayResponse,PlaySessionView} from '../../lib/play-session-types';

try{process.loadEnvFile('.env.local');}catch{/* CI supplies the isolated loopback fixture. */}
function requireLocal(baseURL?:string){for(const value of[baseURL,process.env.DARTFLOW_DATABASE_ADMIN_URL])if(!value||!['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname))throw Error('Full-screen score proof requires an explicit loopback application and database.');}
async function create(context:BrowserContext,origin:string,rules:Record<string,unknown>,solo=false){
 const response=await context.request.post('/api/play/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),action:{type:'session.create',deviceMode:'shared',players:solo?[{name:'Finishspeler'}]:[{name:'Rico'},{name:'Raymond'}],rules}}});expect(response.status(),await response.text()).toBe(200);
 const result=await response.json() as PlayResponse,session=result.session!,controller=session.privateAccess!.grants.find(grant=>grant.purpose==='controller')!;return{session,controller};
}
async function read(context:BrowserContext,id:string,token:string):Promise<PlaySessionView>{const response=await context.request.get(`/api/play/sessions/${id}`,{headers:{'X-DartFlow-Play-Capability':token}});expect(response.status(),await response.text()).toBe(200);return response.json();}
async function cleanup(ids:string[]){const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();try{await admin.query('begin');for(const table of['play_receipts','play_capabilities'])await admin.query(`delete from dartflow_private.${table} where session_id=any($1::uuid[])`,[ids]);await admin.query('delete from dartflow_private.play_sessions where id=any($1::uuid[])',[ids]);await admin.query('commit');}finally{await admin.query('rollback');await admin.end();}}
const consoleFor=(page:Page)=>page.getByRole('dialog',{name:'Schermvullende score-invoer',exact:true});

test('a real two-player practice opens fullscreen and preserves an unsubmitted dart through close, Escape and browser Back',async({browser,baseURL},info)=>{
 requireLocal(baseURL);const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),ids:string[]=[];
 try{
  const {session,controller}=await create(context,new URL(baseURL!).origin,{mode:'x01',startScore:501});ids.push(session.id);await page.goto(controller.url);const dialog=consoleFor(page);await expect(dialog).toBeVisible();await expect(dialog.locator('.play-big')).toHaveText(['501','501']);await expect(dialog).toContainText('Rico aan de beurt');
  await dialog.getByRole('button',{name:'Triple',exact:true}).click();await dialog.getByRole('button',{name:'T20',exact:true}).click();await expect(dialog.getByLabel('Ingevoerde pijlen')).toContainText('T20');expect((await read(context,session.id,controller.token)).game.visits).toHaveLength(0);
  await dialog.getByRole('button',{name:'Terug naar wedstrijd',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'Scoreweergave openen',exact:true})).toBeVisible();await page.getByRole('button',{name:'Scoreweergave openen',exact:true}).click();await expect(dialog.getByLabel('Ingevoerde pijlen')).toContainText('T20');
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await page.getByRole('button',{name:'Scoreweergave openen',exact:true}).click();await expect(dialog.getByLabel('Ingevoerde pijlen')).toContainText('T20');
  const url=page.url();await page.goBack();await expect(dialog).toHaveCount(0);await expect(page).toHaveURL(url);await page.getByRole('button',{name:'Scoreweergave openen',exact:true}).click();await expect(dialog).toBeVisible();await expect(dialog.getByLabel('Ingevoerde pijlen')).toContainText('T20');expect((await read(context,session.id,controller.token)).game.visits).toHaveLength(0);
  await dialog.getByRole('button',{name:'Beurt vastleggen',exact:true}).click();await expect.poll(async()=>(await read(context,session.id,controller.token)).game.visits.length).toBe(1);const accepted=await read(context,session.id,controller.token);expect(accepted.game.visits[0]).toMatchObject({dartHits:['T20'],actualDarts:1});expect(accepted.game.progress).toMatchObject({mode:'x01',remaining:[441,501]});await expect(dialog.locator('.play-big')).toHaveText(['441','501']);await expect(dialog).toContainText('Raymond aan de beurt');await info.attach('real-two-player-fullscreen-score',{body:await page.screenshot(),contentType:'image/png'});
 }finally{await context.close();await cleanup(ids);}
});

test('fullscreen finish training preserves its optional intended target and records one actual finishing dart',async({browser,baseURL},info)=>{
 requireLocal(baseURL);const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),ids:string[]=[];
 try{
  const {session,controller}=await create(context,new URL(baseURL!).origin,{mode:'finish',target:40,attemptCount:1,outRule:'double',routeHelp:true},true);ids.push(session.id);await page.goto(controller.url);const dialog=consoleFor(page);await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Dubbel',exact:true}).click();await dialog.getByRole('button',{name:'D20',exact:true}).click();await expect(dialog.getByRole('button',{name:'D19',exact:true})).toBeDisabled();
  await dialog.locator('summary').filter({hasText:'Doelen & routehulp (optioneel)'}).click();const target=dialog.getByRole('combobox',{name:'Bedoeld doel pijl 1 · D20',exact:true});await target.selectOption('D20');await dialog.getByRole('button',{name:'Terug naar wedstrijd',exact:true}).click();await expect(dialog).toHaveCount(0);await page.getByRole('button',{name:'Scoreweergave openen',exact:true}).click();await expect(target).toHaveValue('D20');expect((await read(context,session.id,controller.token)).game.visits).toHaveLength(0);
  await dialog.getByRole('button',{name:'Beurt vastleggen',exact:true}).click();await expect.poll(async()=>(await read(context,session.id,controller.token)).status).toBe('completed');const accepted=await read(context,session.id,controller.token);expect(accepted.game.visits).toHaveLength(1);expect(accepted.game.visits[0]).toMatchObject({dartHits:['D20'],intendedTargets:['D20'],actualDarts:1,doubleAttempts:1,finish:true});await expect(dialog).toHaveCount(0);await expect(page).toHaveURL(new RegExp(`/spelen/${session.id}$`));await info.attach('real-finish-one-dart-accepted',{body:await page.screenshot(),contentType:'image/png'});
 }finally{await context.close();await cleanup(ids);}
});
