import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

test('editor preserves drafts, publishes an explicit revision and refreshes server-rendered homepage cards',async({browser,baseURL})=>{
 test.setTimeout(120000);
 if(!baseURL||new URL(baseURL).hostname!=='localhost')throw Error('Only local fixtures may run this editorial scenario.');
 const context=await browser.newContext({viewport:{width:1440,height:900}}),anonymous=await browser.newContext();
 const origin=baseURL,headers={Origin:origin},request=context.request;let id='';
 try{
  expect((await(await request.get('/api/session')).json()).local).toBe(true);
  expect((await request.post('/api/auth/local',{headers,data:{userId:'00000000-0000-4000-8000-000000000001',next:'/blog/beheer'}})).status()).toBe(200);
  const upload=await request.post('/api/blog/media',{headers:{...headers,'Idempotency-Key':randomUUID()},multipart:{file:{name:'hero.webp',mimeType:'image/webp',buffer:await readFile('public/assets/blog/toernooi-hero.webp')}}});
  expect(upload.status(),await upload.text()).toBe(201);const media=await upload.json(),slug=`browser-blog-${randomUUID()}`;
  const save=await request.post('/api/blog/posts',{headers,data:{requestId:randomUUID(),data:{title:'Een lokaal clubtoernooi organiseren',slug,excerpt:'Een praktisch artikel voor wedstrijdleiding en spelers.',locale:'nl-NL',type:'blog',authorId:'redactie',categoryId:'toernooien',tags:['Clubtoernooi'],seo:{title:'Clubtoernooi organiseren | DartFlow',description:'Maak samen een duidelijke planning voor een geslaagde clubavond.'},hero:{assetId:media.assetId,alt:'Een lokaal darttoernooi in een clubkantine.',focalPoint:{x:.5,y:.5},ratio:'2:3'},content:{type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'Voorbereiding'}]},{type:'paragraph',content:[{type:'text',text:'De bestaande concepttekst blijft privé.'}]}]}}}});
  expect(save.status(),await save.text()).toBe(201);id=(await save.json()).id;
  const page=await context.newPage();await page.goto('/blog/beheer');
  await page.locator('.studio-post').filter({hasText:'Een lokaal clubtoernooi organiseren'}).click();
  await expect(page.locator('#studio-editor .tiptap')).toContainText('De bestaande concepttekst blijft privé.');
  expect((await anonymous.request.get(`/blog/${slug}`)).status()).toBe(404);
  expect((await anonymous.request.get(`/blog/beheer/voorbeeld/${id}`)).status()).toBe(404);
  await page.locator('#studio-title').fill('Een gewijzigde clubtoernooititel');
  await expect(page.locator('#studio-slug')).toHaveValue(slug);
  await page.locator('#studio-editor .tiptap').click();await page.keyboard.press('ControlOrMeta+End');await page.keyboard.type(' Nieuwe tekst uit Tiptap.');
  await page.getByRole('button',{name:'Concept opslaan',exact:true}).click();
  await expect(page.locator('#studio-status')).toContainText('Het concept is opgeslagen.');
  await page.reload();await page.locator('.studio-post').filter({hasText:'Een gewijzigde clubtoernooititel'}).click();
  await expect(page.locator('#studio-editor .tiptap')).toContainText('Nieuwe tekst uit Tiptap.');
  await page.locator('#studio-publish').click();await page.getByRole('button',{name:'Nu publiceren',exact:true}).click();
  await expect(page.locator('#studio-status')).toContainText('Het artikel is gepubliceerd.');
  const html=await(await anonymous.request.get(`/blog/${slug}`)).text();expect(html).toContain('Nieuwe tekst uit Tiptap.');expect(html).toContain('application/ld+json');expect(html.split('</head>')[0]).toContain(`href="${origin}/blog/${slug}"`);expect(html).toContain(`href="${origin}/blog/${slug}"`);
  const home=await(await anonymous.request.get('/')).text();expect(home).toContain('Een gewijzigde clubtoernooititel');expect(home.indexOf('id="community"')).toBeLessThan(home.indexOf('Laatste artikelen'));
  await page.locator('#studio-editor .tiptap').click();await page.keyboard.press('ControlOrMeta+End');await page.keyboard.type(' Dit blijft nog concept.');await page.locator('#studio-save').click();await expect(page.locator('#studio-status')).toContainText('Het concept is opgeslagen.');
  expect(await(await anonymous.request.get(`/blog/${slug}`)).text()).not.toContain('Dit blijft nog concept.');
  await page.setViewportSize({width:390,height:844});await expect(page.locator('#studio-save')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{
  if(id)await request.post(`/api/blog/posts/${id}/archive`,{headers,data:{requestId:randomUUID()}});
  await context.close();await anonymous.close();
 }
});
