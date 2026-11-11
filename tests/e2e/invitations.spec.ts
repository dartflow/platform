import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
try{process.loadEnvFile('.env.local');}catch{/* CI supplies the isolated fixture. */}
const origin='http://localhost:3000',prefix=`Short invite browser ${randomUUID().slice(0,8)}`;
let owner:pg.Client;
async function login(page:Page,name:string,next='/app/lobby'){
 await page.goto(`/inloggen?next=${encodeURIComponent(next)}`);await page.getByRole('button',{name:new RegExp(name)}).click();await expect(page).toHaveURL(new URL(next,origin).href);
}
test.beforeAll(async()=>{
 const url=process.env.DARTFLOW_DATABASE_ADMIN_URL;
 if(process.env.DARTFLOW_DATA_MODE!=='local'||!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('Invitation browser tests require the explicit loopback fixture.');
 owner=new pg.Client({connectionString:url});await owner.connect();
});
test.afterAll(async()=>{
 if(!owner)return;
 const entities=(await owner.query("select id from dartflow_private.platform_entities where state->>'name' like $1",[`${prefix}%`])).rows.map(row=>row.id);
 const jobs=(await owner.query('select id from dartflow_private.mail_outbox where entity_id=any($1::uuid[])',[entities])).rows.map(row=>row.id);
 await owner.query('delete from dartflow_private.mail_provider_events where job_id=any($1::uuid[])',[jobs]);
 await owner.query('delete from dartflow_private.mail_events where (environment,scope_key,event_id,template_id,recipient_key) in(select environment,scope_key,event_id,template_id,recipient_key from dartflow_private.mail_outbox where entity_id=any($1::uuid[]))',[entities]);
 await owner.query('delete from dartflow_private.mail_outbox where entity_id=any($1::uuid[])',[entities]);
 await owner.query('delete from dartflow_private.platform_audit where entity_id=any($1::uuid[])',[entities]);
 await owner.query("delete from dartflow_private.platform_receipts where response->>'id'=any($1::text[])",[entities]);
 await owner.query('delete from dartflow_private.platform_members where entity_id=any($1::uuid[])',[entities]);await owner.query('delete from dartflow_private.platform_entities where id=any($1::uuid[])',[entities]);await owner.end();
});

test('four-character codes and copied own-origin links open the same invitation, with clear denied and expired feedback',async({browser})=>{
 test.setTimeout(90000);
 const first=await browser.newContext({permissions:['clipboard-read','clipboard-write']}),second=await browser.newContext(),outsider=await browser.newContext(),anonymous=await browser.newContext();
 try{
  const host=await first.newPage(),guest=await second.newPage(),bad=await outsider.newPage(),anon=await anonymous.newPage();
  await login(host,'Danny Goldenbelt');await host.getByLabel('Wedstrijdnaam',{exact:true}).fill(`${prefix} shared match`);await host.getByRole('button',{name:'Lobby openen',exact:true}).click();
  await expect(host).toHaveURL(/\/app\/lobby\/[a-f0-9-]{36}\?code=[A-Z0-9]{4}$/);
  const created=new URL(host.url()),id=created.pathname.split('/').at(-1)!,code=created.searchParams.get('code')!;
  await expect(host.locator('.workspace-code')).toHaveText(code);await host.reload();await expect(host.locator('.workspace-code')).toHaveText(code);
  await host.getByRole('button',{name:'Uitnodigingslink kopiëren',exact:true}).click();await expect(host.getByRole('status').filter({hasText:'Uitnodigingslink gekopieerd.'})).toBeVisible();
  const shortLink=await host.evaluate(()=>navigator.clipboard.readText());expect(shortLink).toBe(`${origin}/w/${code}`);
  await anon.goto(shortLink);await expect(anon.getByRole('link',{name:'Inloggen',exact:true})).toHaveAttribute('href',`/inloggen?next=${encodeURIComponent(`/w/${code}`)}`);
  await login(guest,'Michael de Groot');await guest.getByLabel('Wedstrijdcode',{exact:true}).fill(code.toLowerCase());await guest.getByRole('button',{name:'Aansluiten',exact:true}).click();
  await expect(guest).toHaveURL(`${origin}/app/lobby/${id}`);await expect(guest.getByRole('heading',{name:`${prefix} shared match`,exact:true})).toBeVisible();
  await guest.goto(`${origin}/w/${code.toLowerCase()}`);await expect(guest).toHaveURL(`${origin}/app/lobby/${id}?code=${code}`);await expect(guest.getByRole('heading',{name:`${prefix} shared match`,exact:true})).toBeVisible();
  expect((await owner.query("select count(*)::int as n from dartflow_private.platform_members where entity_id=$1 and status='active'",[id])).rows[0].n).toBe(2);
  await login(bad,'Speler andere club');await bad.getByLabel('Wedstrijdcode',{exact:true}).fill('invalid-code');await bad.getByRole('button',{name:'Aansluiten',exact:true}).click();await expect(bad.getByRole('alert').filter({hasText:'Deze uitnodiging is ongeldig of niet beschikbaar.'})).toContainText('Deze uitnodiging is ongeldig of niet beschikbaar.');
  const directedResponse=await first.request.post('/api/platform/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),action:{type:'lobby.create',name:`${prefix} directed match`,opponentId:'00000000-0000-4000-8000-000000000002'}}});expect(directedResponse.status()).toBe(200);const directed=await directedResponse.json();
  await bad.goto(`/w/${directed.code}`);await expect(bad.getByRole('alert').filter({hasText:'Deze uitnodiging is ongeldig of niet beschikbaar.'})).toHaveText('Deze uitnodiging is ongeldig of niet beschikbaar.');
  const expiredResponse=await first.request.post('/api/platform/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),action:{type:'lobby.create',name:`${prefix} expired match`}}});expect(expiredResponse.status()).toBe(200);const expired=await expiredResponse.json();
  await owner.query("update dartflow_private.platform_entities set invite_expires_at=now()-interval '1 second' where id=$1",[expired.id]);
  await bad.goto(`/w/${expired.code}`);await expect(bad.getByRole('alert').filter({hasText:'Deze uitnodiging is ongeldig of niet beschikbaar.'})).toHaveText('Deze uitnodiging is ongeldig of niet beschikbaar.');
 }finally{await first.close();await second.close();await outsider.close();await anonymous.close();}
});
