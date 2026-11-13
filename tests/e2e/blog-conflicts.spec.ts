import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const actor='00000000-0000-4000-8000-000000000001';
async function fixture(request:APIRequestContext,origin:string){
 const headers={Origin:origin};
 expect((await request.post('/api/auth/local',{headers,data:{userId:actor,next:'/blog/beheer'}})).status()).toBe(200);
 const upload=await request.post('/api/blog/media',{headers:{...headers,'Idempotency-Key':randomUUID()},multipart:{file:{name:'club.webp',mimeType:'image/webp',buffer:await readFile('public/assets/blog/toernooi-hero.webp')}}});
 expect(upload.status(),await upload.text()).toBe(201);const media=await upload.json(),slug='conflict-'+randomUUID(),title='Conflicttest '+randomUUID().slice(0,8);
 const save=await request.post('/api/blog/posts',{headers,data:{requestId:randomUUID(),data:{title,slug,type:'blog',locale:'nl-NL',excerpt:'Een lokaal regressieartikel over revisies.',authorId:'redactie',categoryId:'toernooien',tags:[],seo:{title,description:'Dit artikel controleert uitsluitend lokale revisies.'},hero:{assetId:media.assetId,alt:'Een darttoernooi in de club.',focalPoint:{x:.5,y:.5},ratio:'2:3'},content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'De oorspronkelijke tekst.'}]}]}}}});
 expect(save.status(),await save.text()).toBe(201);const result=await save.json();return {id:result.id,slug,title,headers};
}
async function open(page:Page,title:string){await page.goto('/blog/beheer');await page.locator('.studio-post').filter({hasText:title}).click();await expect(page.locator('#studio-editor .tiptap')).toContainText('De oorspronkelijke tekst.');}
async function append(page:Page,text:string){await page.locator('#studio-editor .tiptap').click();await page.keyboard.press('ControlOrMeta+End');await page.keyboard.type(text);}

test('two editors retain conflicting input, explicitly save it as a new revision and restore without changing live content',async({browser,baseURL})=>{
 test.setTimeout(120000);if(!baseURL||new URL(baseURL).hostname!=='localhost')throw Error('Local editorial fixtures only.');
 const context=await browser.newContext({baseURL,viewport:{width:1440,height:1000}}),anonymous=await browser.newContext({baseURL}),request=context.request;let id='';
 try{
  const f=await fixture(request,baseURL);id=f.id;
  expect((await request.post(`/api/blog/posts/${id}/publish`,{headers:f.headers,data:{requestId:randomUUID(),revision:1}})).status()).toBe(200);
  const first=await context.newPage(),second=await context.newPage();await open(first,f.title);await open(second,f.title);
  await append(first,' Tekst uit eerste tab.');await first.locator('#studio-save').click();await expect(first.locator('#studio-status')).toContainText('Het concept is opgeslagen.');
  await append(second,' Mijn invoer uit tweede tab.');await second.locator('#studio-save').click();await expect(second.locator('#studio-status')).toContainText('elders gewijzigd');await expect(second.locator('#studio-editor .tiptap')).toContainText('Mijn invoer uit tweede tab.');
  await second.getByRole('button',{name:'Conflict herstellen',exact:true}).click();await expect(second.locator('#studio-dialog')).toBeVisible();
  const previewHref=await second.getByRole('link',{name:'Bekijk opgeslagen revisie',exact:true}).getAttribute('href');expect(previewHref).toContain(id);
  const preview=await context.newPage();await preview.goto(previewHref!);await expect(preview.locator('.blog-prose')).toContainText('Tekst uit eerste tab.');await expect(preview.locator('.blog-prose')).not.toContainText('Mijn invoer uit tweede tab.');await preview.close();
  await second.getByRole('button',{name:'Mijn invoer als nieuwe revisie bewaren',exact:true}).click();await expect(second.locator('#studio-status')).toContainText('als nieuwe revisie opgeslagen');
  let current=(await(await request.get(`/api/blog/posts/${id}`)).json()).post;expect(current.draftRevision).toBe(3);expect(current.liveRevision).toBe(1);
  expect(await(await anonymous.request.get(`/blog/${f.slug}`)).text()).not.toContain('Mijn invoer uit tweede tab.');
  await second.getByRole('button',{name:'Revisiegeschiedenis',exact:true}).click();await expect(second.locator('#studio-dialog-title')).toHaveText('Revisiegeschiedenis');
  const revisionOne=second.locator('.studio-revision-list > p').filter({hasText:/^Revisie 1 ·/});await expect(revisionOne).toHaveCount(1);await revisionOne.getByRole('button',{name:'Als concept herstellen',exact:true}).click();
  await expect(second.locator('#studio-status')).toContainText('hersteld als nieuw concept');await expect(second.locator('#studio-editor .tiptap')).not.toContainText('Mijn invoer uit tweede tab.');
  current=(await(await request.get(`/api/blog/posts/${id}`)).json()).post;expect(current.draftRevision).toBe(4);expect(current.liveRevision).toBe(1);
  expect(await(await anonymous.request.get(`/blog/${f.slug}`)).text()).toContain('De oorspronkelijke tekst.');
 }finally{if(id)await request.post(`/api/blog/posts/${id}/archive`,{headers:{Origin:baseURL},data:{requestId:randomUUID()}});await context.close();await anonymous.close();}
});

test('mobile editor keeps toolbar, slash commands, table actions and links reachable without horizontal scroll',async({browser,baseURL})=>{
 test.setTimeout(90000);if(!baseURL||new URL(baseURL).hostname!=='localhost')throw Error('Local editorial fixtures only.');
 const context=await browser.newContext({baseURL,viewport:{width:390,height:844}}),request=context.request;let id='';
 try{
  const f=await fixture(request,baseURL);id=f.id;const page=await context.newPage();await open(page,f.title);const editor=page.locator('#studio-editor .tiptap');
  await editor.click();await page.keyboard.press('ControlOrMeta+End');await page.keyboard.press('Enter');await page.keyboard.type('/');await expect(page.locator('#studio-slash')).toBeVisible();await page.locator('#studio-slash [data-slash="heading2"]').click();await page.keyboard.type('Mobiele kop');await expect(editor.locator('h2')).toContainText('Mobiele kop');
  await page.keyboard.press('Enter');await page.locator('.studio-toolbar [data-command="table"]').click();await expect(editor.locator('table')).toHaveCount(1);await page.locator('#studio-more summary').click();await page.locator('.studio-toolbar [data-command="addRowAfter"]').click();await expect(editor.locator('tr')).toHaveCount(4);
  await page.locator('#studio-more summary').click();await expect(page.locator('#studio-more .studio-menu-pop')).toBeVisible();const box=await page.locator('#studio-more .studio-menu-pop').boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(390);await page.locator('#studio-more summary').click();
  await page.locator('.studio-toolbar [data-command="link"]').click();await expect(page.locator('#studio-dialog-title')).toContainText('Link');await page.locator('#studio-dialog-close').click();
  for(const width of [390,360,320]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.locator('#studio-save')).toBeVisible();}
 }finally{if(id)await request.post(`/api/blog/posts/${id}/archive`,{headers:{Origin:baseURL},data:{requestId:randomUUID()}});await context.close();}
});

function futureAmsterdamTime(hours:number){
 return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(Date.now()+hours*60*60*1000)).replace(' ','T');
}

test('confirmed planning changes get new operation keys so schedule A cancel schedule B cancel leaves no publication scheduled',async({browser,baseURL})=>{
 test.setTimeout(120000);if(!baseURL||new URL(baseURL).hostname!=='localhost')throw Error('Local editorial fixtures only.');
 const context=await browser.newContext({baseURL,viewport:{width:1440,height:1000}}),request=context.request;let id='';
 try{
  const f=await fixture(request,baseURL);id=f.id;const page=await context.newPage(),cancelKeys:string[]=[];await open(page,f.title);
  page.on('request',req=>{if(req.method()==='POST'&&new URL(req.url()).pathname==='/api/blog/admin'){const data=req.postDataJSON();if(data.action==='unschedule'&&data.id===id)cancelKeys.push(data.requestId);}});
  for(const hours of [26,28]){
   const wallTime=futureAmsterdamTime(hours);
   await page.locator('#studio-publish').click();await page.locator('#studio-dialog input[type="datetime-local"]').fill(wallTime);await page.getByRole('button',{name:'Inplannen',exact:true}).click();
   await expect(page.locator('#studio-status')).toContainText('Publicatie ingepland');let current=(await(await request.get(`/api/blog/posts/${id}`)).json()).post;expect(current.scheduledAt).toBeTruthy();expect(current.draftRevision).toBe(1);expect(current.liveRevision).toBeNull();
   const displayed=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(current.scheduledAt)).replace(' ','T');expect(displayed).toBe(wallTime);
   await page.getByRole('button',{name:'Planning annuleren',exact:true}).click();await expect(page.locator('#studio-status')).toContainText('publicatieplanning is geannuleerd');current=(await(await request.get(`/api/blog/posts/${id}`)).json()).post;expect(current.scheduledAt).toBeNull();expect(current.status).toBe('draft');expect(current.draftRevision).toBe(1);expect(current.liveRevision).toBeNull();
  }
  expect(cancelKeys).toHaveLength(2);expect(cancelKeys[0]).not.toBe(cancelKeys[1]);
 }finally{if(id)await request.post(`/api/blog/posts/${id}/archive`,{headers:{Origin:baseURL},data:{requestId:randomUUID()}});await context.close();}
});

test('an ambiguous save retries the same operation and returns its acted revision before rejecting publication of unseen newer content',async({browser,baseURL})=>{
 test.setTimeout(120000);if(!baseURL||new URL(baseURL).hostname!=='localhost')throw Error('Local editorial fixtures only.');
 const context=await browser.newContext({baseURL,viewport:{width:1440,height:1000}}),anonymous=await browser.newContext({baseURL}),request=context.request;let id='';
 try{
  const f=await fixture(request,baseURL);id=f.id;const page=await context.newPage();await open(page,f.title);
  let interrupted=false,actedRevision=0,interceptionFailure:Error|undefined;const saveKeys:string[]=[],saveRevisions:number[]=[];
  await page.route('**/api/blog/admin',async route=>{
   const req=route.request(),payload=req.method()==='POST'?req.postDataJSON():null;
   if(payload?.action!=='save'||payload.post?.id!==id){await route.continue();return;}
   saveKeys.push(payload.requestId);saveRevisions.push(payload.revision);
   if(interrupted){await route.continue();return;}
   interrupted=true;
   try{
   const committed=await route.fetch();expect(committed.status(),await committed.text()).toBe(200);const acted=(await committed.json()).post;actedRevision=acted.revision;expect(actedRevision).toBe(2);
   const changed=await request.put(`/api/blog/posts/${id}`,{headers:f.headers,data:{requestId:randomUUID(),expectedRevision:actedRevision,data:{type:acted.type,locale:acted.locale,title:'Ongeziene titel uit een andere tab',slug:acted.slug,excerpt:'Deze wijziging is nooit in de editor bekeken.',authorId:acted.author,categoryId:acted.category,tags:acted.tags,seo:{title:acted.seoTitle,description:acted.seoDescription},hero:{assetId:acted.hero.assetId,alt:acted.hero.alt,focalPoint:{x:acted.hero.x,y:acted.hero.y},ratio:acted.hero.ratio},content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Ongeziene tekst uit de andere editor.'}]}]}}}});
   expect(changed.status(),await changed.text()).toBe(200);expect((await changed.json()).revision).toBe(3);
   }catch(error){interceptionFailure=error instanceof Error?error:new Error(String(error));}finally{await route.abort('connectionreset');}
  });
  await append(page,' Mijn opgeslagen maar niet bevestigde tekst.');await page.locator('#studio-save').click();await expect(page.locator('#studio-status')).toHaveAttribute('data-error','true');await expect(page.locator('#studio-save')).toBeEnabled();expect(interceptionFailure?.message).toBeUndefined();
  await expect(page.locator('#studio-editor .tiptap')).toContainText('Mijn opgeslagen maar niet bevestigde tekst.');
  let current=(await(await request.get(`/api/blog/posts/${id}`)).json()).post;expect(current.draftRevision).toBe(3);expect(current.liveRevision).toBeNull();
  const retry=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/blog/admin'&&response.request().postDataJSON().action==='save');
  await page.locator('#studio-save').click();const retriedResponse=await retry;expect(retriedResponse.status()).toBe(200);const retried=(await retriedResponse.json()).post;expect(retried.revision).toBe(actedRevision);expect(retried.draftRevision).toBe(3);
  await expect(page.locator('#studio-status')).toContainText('Het concept is opgeslagen.');await expect(page.locator('#studio-editor .tiptap')).toContainText('Mijn opgeslagen maar niet bevestigde tekst.');await expect(page.locator('#studio-editor .tiptap')).not.toContainText('Ongeziene tekst');await expect(page.locator('#studio-title')).toHaveValue(f.title);
  expect(saveKeys).toHaveLength(2);expect(saveKeys[0]).toBe(saveKeys[1]);expect(saveRevisions).toEqual([1,1]);
  await page.locator('#studio-publish').click();const publishing=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/blog/admin'&&response.request().postDataJSON().action==='publish');await page.getByRole('button',{name:'Nu publiceren',exact:true}).click();const published=await publishing;expect(published.request().postDataJSON().revision).toBe(2);expect(published.status()).toBe(412);
  await expect(page.locator('#studio-status')).toHaveAttribute('data-error','true');await expect(page.locator('#studio-editor .tiptap')).not.toContainText('Ongeziene tekst');current=(await(await request.get(`/api/blog/posts/${id}`)).json()).post;expect(current.liveRevision).toBeNull();expect(current.draftRevision).toBe(3);expect((await anonymous.request.get(`/blog/${f.slug}`)).status()).toBe(404);
 }finally{if(id)await request.post(`/api/blog/posts/${id}/archive`,{headers:{Origin:baseURL},data:{requestId:randomUUID()}});await context.close();await anonymous.close();}
});
