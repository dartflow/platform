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
