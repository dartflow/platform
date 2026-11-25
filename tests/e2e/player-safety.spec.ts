import {test,expect} from '@playwright/test';
const actor='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',post='77777777-7777-4777-8777-777777777777';
const profile={id:actor,name:'Synthetic player',username:'synthetic',displayName:'Synthetic player',usernameLocked:true,pinConfigured:true,onboardingComplete:true,displayNameConfirmed:true};
const state={rulesVersion:'2026-11-18',rulesUrl:'https://dartflow.nl/communityregels',termsUrl:'https://dartflow.nl/voorwaarden',minimumAge:13,acceptedVersion:null,acceptedAt:null,requiresAcceptance:true,reportCategories:[],contactEmail:'info@dartflow.nl'};
test('player web safety accepts explicit age/rules, reports a real reference and blocks at mobile width',async({browser,baseURL})=>{
 if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Only isolated loopback data may be used.');
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage();
 const actions:Record<string,unknown>[]=[];let accepted=false,blocked=false;
 try{
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let body:unknown={};
   if(path==='/api/session')body={user:profile,local:true,environment:'development'};
   else if(path==='/api/overview')body={profile,clubs:[],events:[],matches:[],boards:[],history:[],participants:[],standings:[],permissions:{canManage:false}};
   else if(path==='/api/platform')body={profile,clubs:[],rooms:[],lobbies:[],friends:[],players:[],leagues:[],tournaments:[],trainings:[],matches:[],history:[],clubBoards:[],preferences:{}};
   else if(path==='/api/feed')body={channels:[{key:'friends',id:actor,kind:'friends',name:'Vrienden',visibility:'friends',following:true,mode:'all',canPost:true,canReact:true,canManage:false,membersCanPost:true,reactions:true,maxPinDays:7,href:'/app/feed'}],posts:blocked?[]:[{id:post,channel:'friends',category:'post',title:'',body:'Synthetic community post',authorName:'Synthetic opponent',authorId:other,createdAt:'2026-11-18T12:00:00Z',important:false,pinUntil:null,likes:0,liked:false,replyCount:0,canDelete:false,canManage:false,reactions:true,href:null}],pins:[],nextCursor:null,upcoming:[]};
   else if(path==='/api/platform/actions'){
    const action=route.request().postDataJSON().action;actions.push(action);
    if(action.type==='safety.accept')accepted=true;
    if(action.type==='friend.block')blocked=true;
    body=action.type.startsWith('safety.')?{ok:true,...state,requiresAcceptance:!accepted,acceptedVersion:accepted?state.rulesVersion:null}:{ok:true,id:post};
   }
   await route.fulfill({json:body});
  });
  await page.goto('/app/feed');
  await expect(page.getByRole('heading',{name:'Veilig samen spelen'})).toBeVisible();
  const accept=page.getByRole('button',{name:'Accepteren en doorgaan'});await expect(accept).toBeDisabled();
  await page.getByRole('checkbox',{name:'Ik ben minimaal 13 jaar.'}).check();await expect(accept).toBeDisabled();
  await page.getByRole('checkbox',{name:'Ik ga akkoord met de voorwaarden en communityregels.'}).check();await accept.click();
  await expect(page.getByLabel('Bericht',{exact:true})).toBeVisible();expect(actions).toContainEqual({type:'safety.accept',version:'2026-11-18',accepted:true,ageConfirmed:true});
  await page.getByRole('button',{name:'Melden / blokkeren',exact:true}).click();
  await page.getByLabel('Reden',{exact:true}).selectOption('privacy');await page.getByLabel('Toelichting',{exact:true}).fill('Synthetic regression explanation');
  await page.getByRole('button',{name:'Melding versturen'}).click();
  await expect(page.getByRole('status').filter({hasText:'Melding ontvangen'})).toBeVisible();
  expect(actions).toContainEqual({type:'report.create',targetType:'post',targetId:post,category:'privacy',reason:'Synthetic regression explanation'});
  await page.getByRole('button',{name:'Melden / blokkeren',exact:true}).click();page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Speler blokkeren',exact:true}).click();
  await expect(page.getByText('Synthetic community post',{exact:true})).toHaveCount(0);
  expect(actions).toContainEqual({type:'friend.block',userId:other});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }finally{await context.close();}
});
test('public rules, terms and privacy identify the player app and contact without claiming scanner telemetry',async({page})=>{
 await page.goto('/communityregels');await expect(page.getByRole('heading',{name:'Communityregels.',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'6. Veiligheid van minderjarigen'})).toBeVisible();
 await expect(page.locator('main')).toContainText('info@dartflow.nl');
 await page.goto('/voorwaarden');await expect(page.getByRole('heading',{name:'Gebruiksvoorwaarden.',exact:true})).toBeVisible();
 await page.goto('/privacy');await expect(page.locator('main')).toContainText('native DartFlow-spelersapp');await expect(page.locator('main')).toContainText('Camera2 en ZXing');await expect(page.locator('main')).not.toContainText('info@dgwebservices.nl');
});
