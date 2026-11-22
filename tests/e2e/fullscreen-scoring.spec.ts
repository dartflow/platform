import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import type {PlayResponse,PlaySessionView} from '../../lib/play-session-types';
import {choosePerDartInput} from './helpers/score-console';

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
  const {session,controller}=await create(context,new URL(baseURL!).origin,{mode:'x01',startScore:501});ids.push(session.id);await page.goto(controller.url);const dialog=consoleFor(page);await expect(dialog).toBeVisible();await choosePerDartInput(page);await expect(dialog.locator('.play-big')).toHaveText(['501','501']);await expect(dialog).toContainText('Rico aan de beurt');
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

test('a real board session can extend its warning from fullscreen without recording a score',async({browser,baseURL},info)=>{
 requireLocal(baseURL);const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),ids:string[]=[],admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});
 const person=randomUUID(),club=randomUUID(),event=randomUUID(),board=randomUUID(),suffix=randomUUID().slice(0,8);
 await admin.connect();
 try{
  await admin.query('begin');
  await admin.query('insert into dartflow_private.profiles(id,name,display_name,display_name_confirmed)values($1,$2,$3,true)',[person,`fullscreen_timer_${suffix}`,'Fullscreen timer owner']);
  await admin.query('insert into dartflow_private.clubs(id,name)values($1,$2)',[club,`Fullscreen timer ${suffix}`]);
  await admin.query('insert into dartflow_private.events(id,club_id,name,date,capacity)values($1,$2,$3,current_date,16)',[event,club,`Fullscreen timer ${suffix}`]);
  await admin.query('insert into dartflow_private.boards(id,event_id,name)values($1,$2,$3)',[board,event,`Timerbaan ${suffix}`]);
  await admin.query("insert into dartflow_private.club_boards(board_id,club_id,event_id,name,access,created_by)values($1,$2,$3,$4,'all',$5)",[board,club,event,`Timerbaan ${suffix}`,person]);
  await admin.query('commit');
  const response=await context.request.post('/api/play/actions',{headers:{Origin:new URL(baseURL!).origin},data:{requestId:randomUUID(),action:{type:'session.create',boardId:board,deviceMode:'shared',players:[{name:'Timer Rico'},{name:'Timer Raymond'}],rules:{mode:'x01',startScore:501,inRule:'single'}}}});
  expect(response.status(),await response.text()).toBe(200);const created=await response.json() as PlayResponse,session=created.session!,controller=session.privateAccess!.grants.find(grant=>grant.purpose==='controller')!;ids.push(session.id);expect(session.boardIds).toEqual([board]);expect(session.deadlineAt).not.toBeNull();
  // Only this fixture's inactivity timestamps move into the warning window;
  // creation, access, extension and acceptance use the real application API.
  expect((await admin.query("update dartflow_private.play_sessions set activity_at=clock_timestamp()-interval '125 seconds',deadline_at=clock_timestamp()+interval '55 seconds' where id=$1 and status='active' returning id",[session.id])).rowCount).toBe(1);
  const before=await read(context,session.id,controller.token);expect(before.extensionsUsed).toBe(0);expect(before.serverNow).toBeGreaterThan(before.warningAt);expect(before.deadlineAt!).toBeGreaterThan(before.serverNow);
  await page.goto(controller.url);const dialog=consoleFor(page);await expect(dialog).toBeVisible();await choosePerDartInput(page);const warning=dialog.locator('.score-console-board-warning'),extend=warning.getByRole('button',{name:/^Doorgaan · \d+s$/});
  await expect(warning).toBeVisible();await expect(extend).toBeEnabled();
  for(const width of[320,390]){await page.setViewportSize({width,height:844});await expect(extend).toBeInViewport();const bounds=await extend.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width);}
  await page.setViewportSize({width:320,height:568});await expect(extend).toBeInViewport();const fit=await dialog.evaluate(node=>{const input=node.querySelector('.dart-console-input')!,r=input.getBoundingClientRect(),keys=[...node.querySelectorAll('.dart-score-pad>.play-keypad>button')],submit=node.querySelector('.dart-pad-submit')!.getBoundingClientRect();return{overflow:input.scrollHeight-input.clientHeight,submitBottom:submit.bottom,inputBottom:r.bottom,keys:keys.map(key=>{const b=key.getBoundingClientRect();return{width:b.width,height:b.height,bottom:b.bottom};})};});expect(fit.overflow).toBeLessThanOrEqual(1);expect(fit.submitBottom).toBeLessThanOrEqual(fit.inputBottom+1);expect(fit.keys).toHaveLength(20);for(const key of fit.keys){expect(key.width).toBeGreaterThanOrEqual(48);expect(key.height).toBeGreaterThanOrEqual(48);expect(key.bottom).toBeLessThanOrEqual(fit.inputBottom+1);}await page.setViewportSize({width:390,height:844});
  const confirmation=page.waitForResponse(result=>new URL(result.url()).pathname==='/api/play/actions'&&result.request().method()==='POST'&&result.request().postDataJSON()?.action?.type==='session.extend');await extend.click();const confirmed=await confirmation;expect(confirmed.status(),await confirmed.text()).toBe(200);
  const extended=(await confirmed.json() as PlayResponse).session!;expect(extended.id).toBe(session.id);expect(extended.extensionsUsed).toBe(1);expect(extended.revision).toBe(before.revision+1);expect(extended.warningEpoch).not.toBe(before.warningEpoch);expect(extended.activityAt).toBeGreaterThan(before.activityAt);expect(extended.deadlineAt!).toBeGreaterThan(before.deadlineAt!);expect(extended.deadlineAt!-extended.activityAt).toBe(180000);expect(extended.boardIds).toEqual([board]);expect(extended.status).toBe('active');expect(extended.game.visits).toHaveLength(0);
  await expect(warning).toHaveCount(0);await expect(dialog).toBeVisible();await expect(dialog.locator('.play-big')).toHaveText(['501','501']);const canonical=await read(context,session.id,controller.token);expect(canonical.extensionsUsed).toBe(1);expect(canonical.deadlineAt).toBe(extended.deadlineAt);expect(canonical.game.visits).toHaveLength(0);await info.attach('real-fullscreen-inactivity-extension',{body:await page.screenshot(),contentType:'image/png'});
 }finally{
  await context.close();await admin.query('rollback');await cleanup(ids);
  try{await admin.query('begin');await admin.query('delete from dartflow_private.club_boards where board_id=$1',[board]);await admin.query('delete from dartflow_private.boards where id=$1',[board]);await admin.query('delete from dartflow_private.events where id=$1',[event]);await admin.query('delete from dartflow_private.clubs where id=$1',[club]);await admin.query('delete from dartflow_private.profiles where id=$1',[person]);await admin.query('commit');}finally{await admin.query('rollback');await admin.end();}
 }
});
