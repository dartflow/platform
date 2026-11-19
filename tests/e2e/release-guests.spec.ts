import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {OrganizerParticipants,OrganizerParticipantResponse} from '../../lib/event-guests-types';

async function login(page:Page,name:string){await page.goto('/inloggen?next=/app');await page.getByRole('button',{name:new RegExp(name)}).click();await expect(page).toHaveURL('/app');}

test('real web import previews without roster writes, applies guests once and preserves organizer authority',async({browser,baseURL},info)=>{
 test.setTimeout(60000);
 if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Guest acceptance requires the explicit loopback application.');
 const origin=new URL(baseURL).origin,owner=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'}),other=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 const roster=async(context:BrowserContext,id:string):Promise<OrganizerParticipants>=>{const r=await context.request.get(`/api/organizer-participants/${id}`);expect(r.status(),await r.text()).toBe(200);return r.json();};
 try{
  expect((await(await owner.request.get('/api/session')).json()).local).toBe(true);
  const manager=await owner.newPage(),outsider=await other.newPage();await login(manager,'Danny Goldenbelt');await login(outsider,'Michael de Groot');
  const suffix=randomUUID().slice(0,8),first=`Gast Een ${suffix}`,second=`Gast Twee ${suffix}`,created=await owner.request.post('/api/platform/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),action:{type:'tournament.create',ownership:'personal',visibility:'private',eligibility:'all',name:`Gastimport ${suffix}`,format:'knockout',capacity:8,boards:1,requireWriter:false}}});
  expect(created.status(),await created.text()).toBe(200);const event=await created.json(),before=await roster(owner,event.id);expect(before.guests).toHaveLength(0);
  await manager.goto(`/app/hall/${event.id}`);const panel=manager.getByRole('region',{name:'Gastdeelnemers en import',exact:true});await expect(panel).toBeVisible();await panel.getByText('Deelnemerslijst controleren en importeren',{exact:true}).click();
  await panel.getByRole('textbox',{name:'CSV met name, username en type',exact:true}).fill(`name,username,type\n${first},,guest\n${second},,guest\n${first},,guest\n`);
  const previewResponse=manager.waitForResponse(r=>r.url().endsWith('/api/organizer-participants')&&r.request().method()==='POST');await panel.getByRole('button',{name:'Importpreview maken',exact:true}).click();
  const previewHttp=await previewResponse;expect(previewHttp.status(),await previewHttp.text()).toBe(200);const preview=await previewHttp.json() as OrganizerParticipantResponse;expect(preview.preview?.summary).toMatchObject({add:2,skip:0,ambiguous:1,invalid:0});
  await expect(panel.getByText('2 toevoegen · 0 overslaan · 1 ambigu · 0 ongeldig',{exact:true})).toBeVisible();const afterPreview=await roster(owner,event.id);expect(afterPreview.guests).toEqual(before.guests);expect(afterPreview.revision).toBe(before.revision);
  const applying=manager.waitForResponse(r=>r.url().endsWith('/api/organizer-participants')&&r.request().method()==='POST');await panel.getByRole('button',{name:'Gecontroleerde geldige regels één keer toevoegen',exact:true}).click();const appliedHttp=await applying;expect(appliedHttp.status(),await appliedHttp.text()).toBe(200);const applied=await appliedHttp.json();expect(applied.applied).toEqual({added:2,skipped:0,invalid:1});
  const appliedRoster=await roster(owner,event.id);expect(appliedRoster.guests.map(g=>g.name).sort()).toEqual([first,second].sort());expect(appliedRoster.guests.every(g=>!g.checkedIn)).toBe(true);await expect(panel.getByRole('heading',{name:first,exact:true})).toBeVisible();await expect(panel.getByRole('heading',{name:second,exact:true})).toBeVisible();
  const retry=await owner.request.post('/api/organizer-participants',{headers:{Origin:origin},data:appliedHttp.request().postDataJSON()});expect(retry.status(),await retry.text()).toBe(200);expect(await retry.json()).toEqual(applied);expect((await roster(owner,event.id)).guests).toEqual(appliedRoster.guests);
  await panel.getByRole('button',{name:'Importpreview maken',exact:true}).click();await expect(panel.getByText('0 toevoegen · 0 overslaan · 3 ambigu · 0 ongeldig',{exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'Gecontroleerde geldige regels één keer toevoegen',exact:true})).toBeDisabled();
  const denied=await other.request.get(`/api/organizer-participants/${event.id}`);expect(denied.status()).toBe(403);expect(await denied.text()).not.toContain(first);
  const forged=await other.request.post('/api/organizer-participants',{headers:{Origin:origin},data:{requestId:randomUUID(),expectedRevision:appliedRoster.revision,action:{type:'guest.checkin',entityId:event.id,guestId:appliedRoster.guests[0].id}}});expect(forged.status()).toBe(403);expect((await roster(owner,event.id)).guests).toEqual(appliedRoster.guests);
  const accounts=await(await owner.request.get('/api/platform')).json();for(const guest of appliedRoster.guests)expect(accounts.players.some((p:{id:string})=>p.id===guest.id)).toBe(false);
  await info.attach('real-import-preview-and-event-guests',{body:await manager.screenshot(),contentType:'image/png'});
 }finally{await Promise.allSettled([owner.close(),other.close()]);}
});
