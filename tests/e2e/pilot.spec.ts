import {test,expect,type Page,type BrowserContext} from '@playwright/test';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import type {MatchView} from '../../lib/types';

try {process.loadEnvFile('.env.local');} catch {/* CI uses process environment. */}
const origin='http://localhost:3000';
const ids={organizer:'00000000-0000-4000-8000-000000000001',p1:'00000000-0000-4000-8000-000000000002',p2:'00000000-0000-4000-8000-000000000003',outsider:'00000000-0000-4000-8000-000000000004',club:'10000000-0000-4000-8000-000000000001'};
const eventId=randomUUID(),boardId=randomUUID(); const eventName=`Browserpilot ${eventId.slice(0,8)}`;
let owner:pg.Client;
async function login(page:Page,name:string,next='/') {
  await page.goto(`/inloggen?next=${encodeURIComponent(next)}`);
  await page.getByRole('button',{name:new RegExp(name)}).click();
  await expect(page).toHaveURL(new URL(next,origin).href);
  await expect(page.locator('.content')).toBeVisible();
}
async function action(context:BrowserContext,id:string,state:MatchView,command:Record<string,unknown>,requestId=randomUUID()) {
  const response=await context.request.post(`/api/matches/${id}/actions`,{headers:{Origin:origin},data:{requestId,matchId:id,expectedRevision:state.revision,action:command}});
  expect(response.status(),await response.text()).toBe(200);
  return await response.json() as MatchView;
}
test.beforeAll(async()=>{
  if(process.env.DARTFLOW_DATA_MODE!=='local' || !process.env.DARTFLOW_DATABASE_ADMIN_URL || !['localhost','127.0.0.1'].includes(new URL(process.env.DARTFLOW_DATABASE_ADMIN_URL).hostname)) throw new Error('Browserpilot vereist expliciet de lokale fixture-database.');
  owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
  await owner.query('insert into dartflow_private.events(id,club_id,name,date,capacity) values($1,$2,$3,current_date,2)',[eventId,ids.club,eventName]);
  await owner.query('insert into dartflow_private.event_staff(event_id,user_id) values($1,$2)',[eventId,ids.organizer]);
  await owner.query('insert into dartflow_private.boards(id,event_id,name) values($1,$2,$3)',[boardId,eventId,'Browserbaan']);
  for(const id of [ids.p1,ids.p2]) await owner.query("insert into dartflow_private.entries(id,event_id,user_id,status) values($1,$2,$3,'registered')",[randomUUID(),eventId,id]);
});
test.afterAll(async()=>{
  if(!owner) return;
  for(const table of ['action_receipts','visits','match_confirmations','match_players']) await owner.query(`delete from dartflow_private.${table} where match_id in(select id from dartflow_private.matches where event_id=$1)`,[eventId]);
  for(const table of ['audit_events','match_results','screen_capabilities','standings']) await owner.query(`delete from dartflow_private.${table} where event_id=$1`,[eventId]);
  for(const table of ['matches','boards','entries','event_staff']) await owner.query(`delete from dartflow_private.${table} where event_id=$1`,[eventId]);
  await owner.query('delete from dartflow_private.events where id=$1',[eventId]);await owner.end();
});

test('two players, an organizer and independent screen complete the authoritative pilot',async({browser})=>{
  const manager=await browser.newContext(),p1=await browser.newContext({viewport:{width:390,height:844}}),p2=await browser.newContext({viewport:{width:360,height:780}}),screen=await browser.newContext({viewport:{width:540,height:960}});
  const m=await manager.newPage(),a=await p1.newPage(),b=await p2.newPage(),display=await screen.newPage();
  await login(m,'Danny Goldenbelt'); await login(a,'Michael de Groot','/evenementen'); await login(b,'Raymond van Dijk','/evenementen');
  await mkdir('test-results/evidence',{recursive:true});
  await m.setViewportSize({width:1440,height:1000});await m.screenshot({path:'test-results/evidence/dashboard.png',fullPage:true});
  for(const page of [a,b]) await page.locator('article').filter({has:page.getByRole('heading',{name:eventName,exact:true})}).getByRole('button',{name:'Ik ben aanwezig'}).click();
  const plan=await manager.request.post(`/api/events/${eventId}/actions`,{headers:{Origin:origin},data:{type:'plan',playerIds:[ids.p1,ids.p2],settings:{startScore:301,bestOfLegs:1,bestOfSets:1}}});expect(plan.status()).toBe(200);
  const {matchId}=await plan.json(); let state=await (await manager.request.get(`/api/matches/${matchId}`)).json() as MatchView;
  state=await action(manager,matchId,state,{type:'call',boardId});
  const capResponse=await manager.request.post('/api/screens',{headers:{Origin:origin},data:{eventId,boardId}});expect(capResponse.status()).toBe(200);const capability=await capResponse.json();
  await display.goto(capability.url);await expect(display.locator('.screen-context h1')).toHaveText('Browserbaan');
  await a.goto(`/wedstrijd/${matchId}`);await a.getByRole('button',{name:'Ik ben klaar om te spelen'}).click();
  await b.goto(`/wedstrijd/${matchId}`);await b.getByRole('button',{name:'Ik ben klaar om te spelen'}).click();
  await m.goto(`/wedstrijd/${matchId}`);await m.getByRole('button',{name:'Wedstrijd starten',exact:true}).click();
  await a.getByRole('textbox',{name:'Bezoekscore'}).fill('180');await a.getByRole('button',{name:'Score invoeren',exact:true}).click();
  await expect(display.locator('.screen-player').first().locator('strong').first()).toHaveText('121');
  await expect(b.locator('.remaining').first()).toHaveText('121');
  await a.screenshot({path:'test-results/evidence/mobile-score.png',fullPage:true});await display.screenshot({path:'test-results/evidence/vertical-screen.png',fullPage:true});
  await b.getByRole('button',{name:'Schrijven overnemen'}).click();await expect(b.getByRole('textbox',{name:'Bezoekscore'})).toBeVisible();
  await expect(a.getByRole('textbox',{name:'Bezoekscore'})).toHaveCount(0);
  await b.getByRole('textbox',{name:'Bezoekscore'}).fill('60');await b.getByRole('button',{name:'Score invoeren',exact:true}).click();
  await expect(display.locator('.screen-player').nth(1).locator('strong').first()).toHaveText('241');
  for(const [width,height] of [[390,693],[540,960]]) {
    await display.setViewportSize({width,height});
    expect(await display.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1 && document.documentElement.scrollHeight<=innerHeight+1),`Live 9:16 ${width}x${height} overflow`).toBe(true);
  }
  await b.reload();await expect(b.locator('.remaining').nth(1)).toHaveText('241');
  // A lost request is retained with its original action ID and replayed once after reconnect.
  await p2.setOffline(true);await b.getByRole('textbox',{name:'Bezoekscore'}).fill('81');await b.getByRole('button',{name:'Score invoeren',exact:true}).click();
  await expect(b.getByText('Actie bewaard op dit toestel',{exact:true})).toBeVisible();
  await p2.setOffline(false);await expect(b.locator('.remaining').first()).toHaveText('40');
  await b.getByRole('textbox',{name:'Bezoekscore'}).fill('0');await b.getByRole('button',{name:'Score invoeren',exact:true}).click();
  await expect(b.locator('.turn-indicator').first()).toHaveText('AAN DE BEURT');
  await b.getByRole('textbox',{name:'Bezoekscore'}).fill('39');await b.getByRole('button',{name:'Score invoeren',exact:true}).click();
  await expect(b.locator('tbody tr').first()).toContainText('BUST');
  await b.getByRole('textbox',{name:'Bezoekscore'}).fill('0');await b.getByRole('button',{name:'Score invoeren',exact:true}).click();
  await expect(b.locator('.turn-indicator').first()).toHaveText('AAN DE BEURT');
  await b.getByRole('textbox',{name:'Bezoekscore'}).fill('40');await expect(b.getByRole('button',{name:'Finish bevestigen'})).toBeDisabled();
  await b.getByRole('checkbox').check();await b.getByRole('button',{name:'Finish bevestigen'}).click();
  await expect(a.getByRole('button',{name:'Uitslag bevestigen',exact:true})).toBeVisible();
  await a.getByRole('button',{name:'Uitslag bevestigen',exact:true}).click();
  state=await (await p1.request.get(`/api/matches/${matchId}`)).json();expect(state.status).toBe('result');
  await expect(b.locator('.confirmation-row > span').first()).toHaveClass('confirmed');
  await b.getByRole('button',{name:'Uitslag bevestigen',exact:true}).click();await expect(display.getByText('Uitslag bevestigd',{exact:true})).toBeVisible();
  for(const [width,height] of [[390,693],[540,960]]) {
    await display.setViewportSize({width,height});
    expect(await display.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1 && document.documentElement.scrollHeight<=innerHeight+1),`Result 9:16 ${width}x${height} overflow`).toBe(true);
  }
  await a.goto('/historie');await expect(a.locator('tbody tr').filter({hasText:'Michael de Groot — Raymond van Dijk'}).first()).toBeVisible();
  const row=await owner.query('select count(*)::int n from dartflow_private.match_results where match_id=$1',[matchId]);expect(row.rows[0].n).toBe(1);
  const oldLink=await p1.request.get(`/api/matches/${matchId}`);expect((await oldLink.json()).id).toBe(matchId);
  await manager.close();await p1.close();await p2.close();await screen.close();
});

test('mobile layouts and authorization boundaries remain usable',async({browser})=>{
  const context=await browser.newContext();const page=await context.newPage();await login(page,'Danny Goldenbelt');
  for(const [width,height] of [[320,568],[360,780],[390,844],[667,375],[768,900],[1440,1000]]) {
    await page.setViewportSize({width,height});
    for(const route of ['/','/spelen','/evenementen','/wedstrijdleiding','/clubbeheer','/historie']) {
      await page.goto(route);await expect(page.locator('.content')).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route} ${width} overflow`).toBe(true);
    }
  }
  const forged=await context.request.post('/api/auth/local',{headers:{Origin:origin,Host:'staging.dartflow.nl'},data:{userId:ids.organizer}});expect(forged.status()).not.toBe(200);
  const crossOrigin=await context.request.post('/api/auth/local',{headers:{Origin:'https://evil.example'},data:{userId:ids.organizer}});expect(crossOrigin.status()).toBe(403);
  const large=await context.request.post('/api/auth/local',{headers:{Origin:origin},data:{userId:ids.organizer,padding:'x'.repeat(9000)}});expect(large.status()).toBe(413);
  const wrongMatch=await context.request.post('/api/matches/30000000-0000-4000-8000-000000000001/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),expectedRevision:0,matchId:randomUUID(),action:{type:'start'}}});expect(wrongMatch.status()).toBe(409);
  await context.close();const outsider=await browser.newContext();const o=await outsider.newPage();await login(o,'Speler andere club');
  const denied=await outsider.request.get('/api/overview?clubId='+ids.club);expect(denied.status()).toBe(403);
  const anon=await browser.newContext();expect((await anon.request.get('/api/overview')).status()).toBe(401);
  await outsider.close();await anon.close();
});
