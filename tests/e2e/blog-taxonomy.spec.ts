import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

const taxonomy={authors:[{id:'redactie',name:'DartFlow redactie',active:true,revision:1},{id:'clubredactie',name:'Clubredactie Noord',active:true,revision:1}],categories:[{id:'nieuws',name:'Nieuws',active:true,revision:1},{id:'jeugd',name:'Jeugd & opleiding',active:true,revision:1}]};
function article(id:string,title:string,author='redactie',category='nieuws'){
 return {id,title,author,category,slug:`fixture-${id}`,excerpt:'Een herkenbaar lokaal artikel.',type:'blog',locale:'nl-NL',tags:[],status:'draft',revision:1,draftRevision:1,liveRevision:null,publishedAt:null,scheduledAt:null,hasUnpublishedChanges:false,seoTitle:title,seoDescription:'Een veilige beschrijving voor dit artikel.',hero:null,social:null,content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Bewaar deze bestaande artikeltekst.'}]}]}};
}

test('editor filters use editable taxonomy, show author names and keep unsaved text when adding a name',async({page,baseURL})=>{
 if(!baseURL||new URL(baseURL).hostname!=='localhost')throw Error('Local editorial fixtures only.');
 const posts=[article(randomUUID(),'Een clubbericht','clubredactie','jeugd'),article(randomUUID(),'Een nieuwsbericht')];
 const mutable={authors:[...taxonomy.authors],categories:[...taxonomy.categories]};
 await page.route('**/api/blog/admin',route=>route.fulfill({json:{posts,...mutable}}));
 await page.route('**/api/blog/taxonomy',async route=>{
  if(route.request().method()==='GET'){await route.fulfill({json:mutable});return;}
  const data=route.request().postDataJSON(),entry={id:data.id,name:data.name,active:true,revision:1};
  mutable.authors.push(entry);await route.fulfill({json:{entry,...mutable}});
 });
 expect((await page.request.get('/api/blog/taxonomy')).status()).toBe(401);
 expect((await page.request.post('/api/auth/local',{headers:{Origin:baseURL},data:{userId:'00000000-0000-4000-8000-000000000001',next:'/blog/beheer'}})).status()).toBe(200);
 expect((await page.request.get('/api/blog/taxonomy')).status()).toBe(200);
 expect((await page.request.post('/api/blog/taxonomy',{headers:{Origin:'https://outside.example.com'},data:{action:'save',kind:'author',id:'forbidden-origin',name:'Rejected',expectedRevision:0,requestId:randomUUID()}})).status()).toBe(403);
 await page.goto('/blog/beheer');
 await expect(page.locator('.studio-post').first()).toContainText('Clubredactie Noord');
 await page.locator('#studio-category-filter').selectOption('jeugd');await expect(page.locator('.studio-post')).toHaveCount(1);await expect(page.locator('.studio-post')).toContainText('Een clubbericht');
 await page.locator('#studio-category-filter').selectOption('');await page.locator('#studio-author-filter').selectOption('redactie');await expect(page.locator('.studio-post')).toHaveCount(1);await expect(page.locator('.studio-post')).toContainText('Een nieuwsbericht');
 await page.locator('#studio-author-filter').selectOption('');
 expect(await page.locator('#studio-locale option').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value))).toEqual(['nl-NL','en-GB','en-US']);
 await page.locator('#studio-title').fill('Deze niet-opgeslagen titel blijft staan');
 const settings=page.locator('#blog-taxonomy-settings');await settings.locator('summary').click();
 await settings.getByLabel('Vaste ID').fill('gastredactie');await settings.getByLabel('Naam',{exact:true}).fill('Gastredactie');await settings.getByRole('button',{name:'Opslaan',exact:true}).click();
 await expect(settings.getByRole('status')).toContainText('Sla een openstaand artikel op');await expect(settings).toContainText('Gastredactie');await expect(page.locator('#studio-title')).toHaveValue('Deze niet-opgeslagen titel blijft staan');
 await expect(page.locator('#studio-editor .tiptap')).toContainText('Bewaar deze bestaande artikeltekst.');
});

test('unconfirmed publication has a clear retry state and refreshing its status preserves entered edits',async({page,baseURL})=>{
 if(!baseURL||new URL(baseURL).hostname!=='localhost')throw Error('Local editorial fixtures only.');
 const post={...article(randomUUID(),'Een gecontroleerde publicatie'),status:'published',liveRevision:1,publishedAt:'2026-11-26T10:00:00.000Z',publicUrl:baseURL+'/blog/fixture-check',publicationCheck:{state:'pending',lastError:'PUBLIC_VERSION_NOT_VISIBLE',checkedAt:'2026-11-26T10:01:00.000Z'}};
 let confirmed=false;
 await page.route('**/api/blog/admin',route=>route.fulfill({json:{posts:[{...post,publicationCheck:{...post.publicationCheck,state:confirmed?'confirmed':'pending'}}],...taxonomy}}));
 await page.route('**/api/blog/taxonomy',route=>route.fulfill({json:taxonomy}));
 expect((await page.request.post('/api/auth/local',{headers:{Origin:baseURL},data:{userId:'00000000-0000-4000-8000-000000000001',next:'/blog/beheer'}})).status()).toBe(200);
 await page.goto('/blog/beheer');
 await expect(page.locator('#studio-post-status')).toHaveText('Publicatie controleren');await expect(page.locator('#studio-publish-meta')).toContainText('wordt automatisch opnieuw geprobeerd');await expect(page.locator('#studio-publish-meta')).not.toContainText('PUBLIC_VERSION_NOT_VISIBLE');
 await page.locator('#studio-title').fill('Niet-opgeslagen invoer tijdens controle');
 confirmed=true;await page.getByRole('button',{name:'Publicatiestatus vernieuwen'}).click();
 await expect(page.locator('#studio-post-status')).toHaveText('Gepubliceerd');await expect(page.locator('#studio-title')).toHaveValue('Niet-opgeslagen invoer tijdens controle');await expect(page.locator('#studio-editor .tiptap')).toContainText('Bewaar deze bestaande artikeltekst.');
});
