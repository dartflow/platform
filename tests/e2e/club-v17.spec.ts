import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
const origin='http://localhost:3000';
async function login(page:Page,name:string,next:string){await page.goto(`/inloggen?next=${encodeURIComponent(next)}`);await page.getByRole('button',{name:new RegExp(name)}).click();await expect(page).toHaveURL(new URL(next,origin).href);}

test('club intake works on a separate phone, keeps answers private, and the owner reviews and brands the club',async({browser,baseURL})=>{
 test.setTimeout(120000);
 if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw new Error('Club acceptance requires the local fixture application.');
 const owner=await browser.newContext({viewport:{width:1440,height:1050}}),phone=await browser.newContext({viewport:{width:390,height:844}}),outsider=await browser.newContext({viewport:{width:412,height:915}});
 let premiumClubId:string|undefined;
 try{
  const session=await owner.request.get('/api/session');if(!(await session.json()).local)throw new Error('Only local fixture authentication is allowed.');
  const manager=await owner.newPage(),player=await phone.newPage(),visitor=await outsider.newPage(),suffix=randomUUID().slice(0,8),name=`Intakevereniging ${suffix}`,privateAnswer=`ALLEEN-BEVEILIGDE-INTAKE-${suffix}`;
  await login(manager,'Danny Goldenbelt','/app/clubs');
  const create=manager.locator('form').filter({has:manager.getByRole('heading',{name:'Vereniging oprichten',exact:true})});await create.getByLabel('Naam',{exact:true}).fill(name);await create.getByRole('button',{name:'Vereniging aanmaken',exact:true}).click();await expect(manager).toHaveURL(/\/app\/clubs\/[a-f0-9-]{36}(?:\?|$)/);
  const clubId=new URL(manager.url()).pathname.split('/').at(-1)!,path=`/app/clubs/${clubId}`;
  const navigation=manager.getByRole('navigation',{name:'Verenigingsonderdelen'});await navigation.getByRole('link',{name:'Verenigingsbeheer',exact:true}).click();await expect(manager).toHaveURL(`${path}/beheer`);
  const settings=manager.locator('.club-workspace section.panel').filter({has:manager.getByRole('heading',{name:'Verenigingsinstellingen',exact:true})});await settings.getByLabel('Lidmaatschapsbeleid').selectOption('intake');await settings.getByLabel('Toelichting bij de intake').fill('Vertel iets over je dartservaring.');
  const questions=settings.getByRole('group',{name:'Intakevragen'});await questions.getByRole('button',{name:'Vraag toevoegen',exact:true}).click();await questions.getByLabel('Vraag',{exact:true}).nth(0).fill('Motivatie');await questions.getByRole('combobox',{name:'Type',exact:true}).nth(0).selectOption('textarea');await questions.getByLabel('Verplicht',{exact:true}).nth(0).check();await questions.getByRole('button',{name:'Vraag toevoegen',exact:true}).click();await questions.getByLabel('Vraag',{exact:true}).nth(1).fill('Voorkeursavond');await questions.getByRole('combobox',{name:'Type',exact:true}).nth(1).selectOption('select');await questions.getByLabel('Keuzes, één per regel').fill('Woensdag\nVrijdag');await questions.getByLabel('Verplicht',{exact:true}).nth(1).check();
  const saved=manager.waitForResponse(r=>r.url().endsWith('/api/platform/actions')&&r.request().method()==='POST');await settings.getByRole('button',{name:'Instellingen opslaan',exact:true}).click();expect((await saved).status()).toBe(200);
  await expect.poll(async()=>{const data=await(await owner.request.get('/api/platform')).json();return data.clubs.find((c:{id:string})=>c.id===clubId)?.clubDetails?.intakeQuestions.length;}).toBe(2);
  await login(player,'Michael de Groot',path);await expect(player.getByText('Vertel iets over je dartservaring.',{exact:true})).toBeVisible();await player.getByLabel(/^Motivatie/).fill(privateAnswer);await player.getByLabel(/^Voorkeursavond/).selectOption('Vrijdag');await player.getByRole('button',{name:'Aanvraag versturen',exact:true}).click();await expect(player.getByText('Je aanvraag is opgeslagen.',{exact:false})).toBeVisible();
  await login(visitor,'Raymond van Dijk',path);const visitorData=await(await outsider.request.get('/api/platform')).json();expect(JSON.stringify(visitorData)).not.toContain(privateAnswer);await expect(visitor.getByText(privateAnswer,{exact:true})).toHaveCount(0);await expect(visitor.getByRole('button',{name:'Aanvragen',exact:true})).toHaveCount(0);await expect(visitor.getByRole('button',{name:'Rollen',exact:true})).toHaveCount(0);
  await navigation.getByRole('link',{name:/^Leden(?:\s*\d+)?$/,exact:true}).click();await expect(manager).toHaveURL(`${path}/leden`);await expect(manager.getByText(privateAnswer,{exact:true})).toBeVisible();const request=manager.locator('.club-workspace article').filter({hasText:privateAnswer});await request.getByLabel(/^Reden/).fill('Welkom bij de vereniging.');await request.getByRole('button',{name:'Accepteren',exact:true}).click();await expect(request.getByRole('button',{name:'Accepteren',exact:true})).toHaveCount(0);
  await expect.poll(async()=>{const data=await(await phone.request.get('/api/platform')).json();return data.clubs.find((c:{id:string})=>c.id===clubId)?.clubAccess.isMember;}).toBe(true);await player.reload();await expect(player.locator('.ch-workspace')).toBeVisible();await expect(player.getByRole('navigation',{name:'Verenigingsonderdelen'}).getByRole('link',{name:'Leden',exact:true})).toBeVisible();await player.goto(`${path}/beheer`);await expect(player.getByRole('heading',{name:'Rollen en eigendom',exact:true})).toHaveCount(0);await expect(player.getByRole('heading',{name:'Verenigingsinstellingen',exact:true})).toHaveCount(0);await player.goto(path);
  await navigation.getByRole('link',{name:'Verenigingsbeheer',exact:true}).click();
  const image=await sharp({create:{width:32,height:32,channels:4,background:'#b7f62b'}}).png().toBuffer();
  // Existing club logo storage remains supported; it does not bypass premium publication.
  await settings.getByLabel(/Verenigingslogo/).setInputFiles({name:'vereniging.png',mimeType:'image/png',buffer:image});
  await expect.poll(async()=>{const data=await(await owner.request.get('/api/platform')).json();return data.clubs.find((c:{id:string})=>c.id===clubId)?.clubDetails.logoData;}).toMatch(/^data:image\/webp;base64,/);
  const branding=manager.locator('section.panel').filter({has:manager.getByRole('heading',{name:'Clubhuisstijl',exact:true})}),publish=branding.getByRole('button',{name:'Opgeslagen huisstijl publiceren',exact:true});
  await expect(publish).toBeDisabled();
  const priorTheme=(await(await owner.request.get(`/api/theme?clubId=${clubId}`)).json()).effective;
  await branding.getByLabel('Naam huisstijl',{exact:true}).fill(`Huisstijl ${suffix}`);await branding.getByLabel('Primaire kleur',{exact:true}).fill('#123456');await branding.getByLabel('Secundaire kleur',{exact:true}).fill('#789abc');await branding.getByLabel(/^Logo \(PNG/).setInputFiles({name:'huisstijl.png',mimeType:'image/png',buffer:image});
  await expect(branding.getByRole('img',{name:'Voorvertoning logo',exact:true})).toHaveAttribute('src',/^data:image\/png;base64,/);
  const draftSaved=manager.waitForResponse(r=>r.url().endsWith('/api/clubhouse/actions')&&r.request().method()==='POST');await branding.getByRole('button',{name:'Ontwerp opslaan',exact:true}).click();expect((await draftSaved).status()).toBe(200);
  expect((await(await owner.request.get(`/api/theme?clubId=${clubId}`)).json()).effective.clubId).toBe(priorTheme.clubId);await expect(publish).toBeDisabled();
  // Only the seeded platform administrator grants the synthetic club a bounded right.
  const grant=await owner.request.post('/api/clubhouse/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),action:{type:'entitlement.grant',clubId,startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString()}}});expect(grant.status(),await grant.text()).toBe(200);premiumClubId=clubId;
  await manager.reload();await expect(publish).toBeEnabled();const published=manager.waitForResponse(r=>r.url().endsWith('/api/clubhouse/actions')&&r.request().method()==='POST');await publish.click();expect((await published).status()).toBe(200);
  await manager.goto(path);await expect(manager.getByRole('img',{name:`Logo ${name}`,exact:true})).toHaveAttribute('src',/^data:image\/webp;base64,/);
  const publishedTheme=(await(await owner.request.get(`/api/theme?clubId=${clubId}`)).json()).effective;expect(publishedTheme.clubId).toBe(clubId);expect(publishedTheme.brandingRevision).toBeGreaterThan(0);
  const dark=await manager.evaluate(()=>document.documentElement.dataset.dartflowTheme==='dark');await expect.poll(()=>manager.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--ch-primary').trim())).toBe(publishedTheme.tokens[dark?'dark':'light'].primary);
  await player.reload();await expect(player.getByRole('img',{name:`Logo ${name}`,exact:true})).toBeVisible();
  expect(await player.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  for(const viewport of [{width:390,height:844},{width:412,height:915}]){
   await player.setViewportSize(viewport);
   const layout=await player.evaluate(()=>{const club=document.querySelector('.ch-workspace')!.getBoundingClientRect(),tabs=document.querySelector('.ch-page-nav') as HTMLElement;tabs.scrollLeft=tabs.scrollWidth;const reached=tabs.scrollLeft,max=Math.max(0,tabs.scrollWidth-tabs.clientWidth);tabs.scrollLeft=0;return{clubWidth:club.width,clubRight:club.right,tabsWidth:tabs.getBoundingClientRect().width,tabsOverflow:getComputedStyle(tabs).overflowX,reached,max,pageWidth:document.documentElement.scrollWidth};});
   expect(layout.clubWidth).toBeLessThanOrEqual(viewport.width);expect(layout.clubRight).toBeLessThanOrEqual(viewport.width+1);expect(layout.tabsWidth).toBeLessThanOrEqual(layout.clubWidth+1);expect(layout.tabsOverflow).toBe('auto');expect(layout.reached).toBe(layout.max);expect(layout.pageWidth).toBeLessThanOrEqual(viewport.width+1);
  }

 }finally{try{if(premiumClubId){const revoked=await owner.request.post('/api/clubhouse/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),action:{type:'entitlement.revoke',clubId:premiumClubId}}});expect(revoked.status(),await revoked.text()).toBe(200);}}finally{await Promise.all([owner.close(),phone.close(),outsider.close()]);}}
});
