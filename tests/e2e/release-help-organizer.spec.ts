import {test,expect} from '@playwright/test';

test('public FAQ searches the shared source and a direct question works without login',async({page,request},info)=>{
 const api=await request.get('/api/faq?q=scorekaart');expect(api.ok()).toBe(true);const data=await api.json();expect(data.version).toBe('2026.11.19');expect(data.items.length).toBeGreaterThan(0);
 await page.setViewportSize({width:390,height:844});await page.goto('/help');await expect(page.getByRole('heading',{name:'Help & FAQ',exact:true})).toBeVisible();
 await page.getByRole('searchbox',{name:'Zoek een vraag'}).fill('scorekaart');await expect(page.locator('.faq-answers details')).toHaveCount(data.items.length);
 await page.goto(`/help/${data.items[0].id}`);await expect(page.locator('details[open] summary')).toHaveText(data.items[0].question);await expect(page.locator('details[open]')).toContainText(data.items[0].answer);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await info.attach('faq-public-mobile',{body:await page.screenshot(),contentType:'image/png'});
 await page.goto('/help/does-not-exist');await expect(page.getByRole('heading',{name:'404'})).toBeVisible();
});

for(const width of [390,1440])test(`personal organizer has an independent web entry and explicit ownership at ${width}px`,async({page},info)=>{
 const user={id:'00000000-0000-4000-8000-000000000002',name:'Lokale organisator',username:'organisator',displayName:'Lokale organisator',usernameLocked:true,displayNameConfirmed:true,onboardingComplete:true};
 const platform={profile:user,matches:[],history:[],players:[],clubs:[],clubBoards:[],rooms:[],trainings:[],leagues:[],tournaments:[],lobbies:[],friends:[],blocked:[],preferences:{discoverable:true,allowRequests:true},messages:{},registrations:[],reports:[],canManageRegistrations:false,statistics:{played:0,won:0,drawn:0,average:0,oneEighties:0,highestFinish:0,totalDarts:0,trainingSessions:0}};
 const calls:Record<string,unknown>[]=[];
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;const body=path==='/api/session'?{user,local:true}:path==='/api/platform'?platform:path==='/api/overview'?{profile:user,clubs:[],currentClub:null,events:[],matches:[],boards:[],participants:[],history:[],standings:[],permissions:{canManage:false}}:path==='/api/player-experience'?{actions:[],fixtures:[],boards:[],goals:{}}:path==='/api/platform/actions'?(calls.push(route.request().postDataJSON()),{error:'Controleer de invoer opnieuw.'}):{};await route.fulfill({status:path==='/api/platform/actions'?409:200,json:body});});
 await page.setViewportSize({width,height:900});await page.goto('/app/hall');await page.getByRole('button',{name:'Nieuw toernooi',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Omgeving',exact:true})).toHaveValue('personal');await page.getByLabel('Naam',{exact:true}).fill('Vrijdagcup vrienden');await page.getByLabel('Datum',{exact:true}).fill('2026-12-04');
 await page.getByRole('button',{name:'Evenement aanmaken',exact:true}).click();await expect.poll(()=>calls.length).toBe(1);expect(calls[0]).toMatchObject({action:{type:'tournament.create',ownership:'personal',clubId:null,visibility:'private',name:'Vrijdagcup vrienden'}});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await info.attach(`personal-organizer-web-${width}`,{body:await page.screenshot(),contentType:'image/png'});
});
