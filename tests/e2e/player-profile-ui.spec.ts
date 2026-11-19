import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {Overview,Profile} from '../../lib/types';
import type {PlayerStatisticsResponse,StatisticsMatchRow,StatisticsSummary} from '../../lib/player-statistics-types';
import {summarizePlayerStatistics} from '../../lib/player-statistics';

const actor='00000000-0000-4000-8000-000000000002';
function localOnly(baseURL:string|undefined){if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Profile UI fixtures require a loopback origin.');}
const profile:Profile={id:actor,name:'Robin Dart',username:'robindart',displayName:'Robin Dart',displayNameConfirmed:true,usernameLocked:true,fullName:'Robin Private',onboardingComplete:true,pinConfigured:true,showPublicStatistics:false};
function overview(user:Profile):Overview{return{profile:user,clubs:[],currentClub:null,events:[],matches:[],boards:[],participants:[],history:[],standings:[],permissions:{canManage:false}};}
function platform(user:Profile){return{profile:user,matches:[],history:[],players:[],clubs:[],clubBoards:[],rooms:[],trainings:[],leagues:[],tournaments:[],lobbies:[],friends:[],blocked:[],preferences:{}};}
async function pins(page:Page,pin='012345'){await page.getByLabel('Spelerspincode',{exact:true}).and(page.locator('input')).fill(pin);await page.getByLabel('Herhaal spelerspincode',{exact:true}).fill(pin);}

for(const provider of ['google','email'])test(`${provider} login proposal requires confirmed username, display label and PIN before returning to its original lobby`,async({browser,baseURL})=>{
 localOnly(baseURL);const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),lobbyId=randomUUID(),target=`/app/lobby/${lobbyId}`;
 let authenticated=false,completed=false,failed=false,firstRequestId='';const user:Profile={id:actor,name:'Speler',username:null,displayName:null,fullName:provider==='google'?'Robin Google':null,usernameLocked:false,displayNameConfirmed:false,onboardingComplete:false,pinConfigured:false};
 const destinations:string[]=[];
 try{
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());let body:unknown={};
   if(url.pathname==='/api/session')body={user:authenticated?(completed?profile:user):null,local:false,environment:'development',requiresDisplayName:authenticated&&!completed,requiresProfileCompletion:authenticated&&!completed};
   else if(url.pathname==='/api/auth/google'){authenticated=true;destinations.push(url.pathname);return route.fulfill({status:302,headers:{location:`/inloggen?next=${encodeURIComponent(target)}`},body:''});}
   else if(url.pathname==='/api/auth/otp'){expect(route.request().postDataJSON()).toMatchObject({email:'ui-registration@example.invalid',next:target});destinations.push(url.pathname);body={ok:true};}
   else if(url.pathname==='/api/auth/verify'){expect(route.request().postDataJSON()).toMatchObject({token:'12345678',next:target});authenticated=true;destinations.push(url.pathname);body={next:target};}
   else if(url.pathname==='/api/profile/username-availability')body={valid:true,available:true,username:'robindart',locked:false};
   else if(url.pathname==='/api/profile/complete'){
    const input=route.request().postDataJSON();expect(input).toMatchObject({username:'@robindart',displayName:'Robin Dart',pin:'012345',pinConfirmation:'012345'});
    if(!failed){failed=true;firstRequestId=input.requestId;return route.fulfill({status:503,json:{error:'Lokaal gesimuleerde tijdelijke opslagfout.'}});}
    expect(input.requestId).toBe(firstRequestId);completed=true;body={ok:true,user:profile};
   }else if(url.pathname==='/api/overview')body=overview(profile);
   else if(url.pathname==='/api/platform')body=platform(profile);
   else if(url.pathname.startsWith('/api/community'))body={posts:[],messages:[],nextCursor:null};
   else if(url.pathname==='/api/mail/preferences')body={preferences:[]};
   await route.fulfill({json:body});
  });
  await page.goto(`/inloggen?next=${encodeURIComponent(target)}`);
  if(provider==='google')await page.getByRole('link',{name:'Doorgaan met Google',exact:true}).click();
  else{await page.getByLabel('E-mailadres',{exact:true}).fill('ui-registration@example.invalid');await page.getByRole('button',{name:'Stuur mij een inlogcode',exact:true}).click();await page.getByLabel('Inlogcode',{exact:true}).fill('12345678');await page.getByRole('button',{name:'Code bevestigen',exact:true}).click();}
  await expect(page.getByRole('heading',{name:'Maak je spelersprofiel compleet',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Profiel opslaan en verder',exact:true})).toBeDisabled();await expect(page.getByLabel('Displaynaam',{exact:true})).toBeEmpty();await expect(page.getByLabel('Volledige naam',{exact:true})).toHaveValue(provider==='google'?'Robin Google':'');
  await page.getByLabel('Gebruikersnaam',{exact:true}).fill('@robindart');await page.getByLabel('Displaynaam',{exact:true}).fill('Robin Dart');await page.getByRole('checkbox',{name:'Ik bevestig @robindart als mijn vaste, onveranderbare gebruikersnaam.'}).check();await pins(page);await page.getByRole('button',{name:'Profiel opslaan en verder',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'tijdelijke opslagfout'})).toBeVisible();await expect(page.getByLabel('Spelerspincode',{exact:true}).and(page.locator('input'))).toBeEmpty();await expect(page.getByLabel('Herhaal spelerspincode',{exact:true})).toBeEmpty();await pins(page);await Promise.all([page.waitForEvent('domcontentloaded'),page.getByRole('button',{name:'Profiel opslaan en verder',exact:true}).click()]);
  await expect(page).toHaveURL(target);expect(completed).toBe(true);expect(destinations).toEqual(provider==='google'?['/api/auth/google']:['/api/auth/otp','/api/auth/verify']);
  expect(await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}))).not.toContain('012345');
 }finally{await context.close();}
});

test('PIN settings expose status, clear failed changes and use a fresh own login to reset without showing PIN data',async({browser,baseURL})=>{
 localOnly(baseURL);const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage();let changes=0,recentAuth=false;const calls:string[]=[];
 try{
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());let body:unknown={};
   if(url.pathname==='/api/session')body={user:profile,local:false,environment:'development',requiresDisplayName:false,requiresProfileCompletion:false};
   else if(url.pathname==='/api/overview')body=overview(profile);
   else if(url.pathname==='/api/platform')body=platform(profile);
   else if(url.pathname==='/api/mail/preferences')body={preferences:[]};
   else if(url.pathname==='/api/profile/player-pin'){
    const input=route.request().postDataJSON();calls.push(input.mode);expect(input.pin).toBe('012345');expect(input.pinConfirmation).toBe('012345');
    if(input.mode==='change'){changes++;expect(input.currentPin).toBe(changes===1?'999999':'001234');if(changes===1)return route.fulfill({status:403,json:{error:'Gebruikersnaam of spelerspincode klopt niet.'}});}
    if(input.mode==='reset'&&!recentAuth)return route.fulfill({status:403,json:{error:'Log opnieuw in via Google of een e-mailcode om je spelerspincode opnieuw in te stellen.'}});
    body={ok:true,pinConfigured:true};
   }else if(url.pathname==='/api/auth/google'){expect(url.searchParams.get('reauth')).toBe('1');expect(url.searchParams.get('next')).toBe('/app/settings?pin=reset');recentAuth=true;return route.fulfill({status:302,headers:{location:'/app/settings?pin=reset'},body:''});}
   else if(url.pathname.startsWith('/api/community'))body={posts:[],messages:[],nextCursor:null};
   await route.fulfill({json:body});
  });
  await page.goto('/app/settings');await expect(page.getByLabel('Gebruikersnaam',{exact:true})).toHaveAttribute('readonly','');await expect(page.getByLabel('Volledige naam',{exact:true})).toHaveValue('Robin Private');const section=page.getByRole('region',{name:'Spelerspincode',exact:true});await expect(section).toContainText('Status: Ingesteld');await expect(section.getByLabel('Huidige spelerspincode',{exact:true})).toBeEmpty();await expect(section.getByLabel('Huidige spelerspincode',{exact:true})).toHaveAttribute('type','password');await expect(page.getByRole('checkbox',{name:'Historische profielcijfers tonen op openbare Oche Live-baanschermen'})).not.toBeChecked();
  await section.getByLabel('Huidige spelerspincode',{exact:true}).fill('999999');await pins(page);await section.getByRole('button',{name:'Pincode wijzigen',exact:true}).click();await expect(section.getByRole('alert')).toContainText('Gebruikersnaam of spelerspincode klopt niet.');for(const label of ['Huidige spelerspincode','Spelerspincode','Herhaal spelerspincode'])await expect(section.getByLabel(label,{exact:true}).and(page.locator('input'))).toBeEmpty();
  await section.getByLabel('Huidige spelerspincode',{exact:true}).fill('001234');await pins(page);await section.getByRole('button',{name:'Pincode wijzigen',exact:true}).click();await expect(section.getByRole('status')).toContainText('Je spelerspincode is opgeslagen.');
  await section.getByRole('button',{name:'Pincode vergeten?',exact:true}).click();const verify=section.getByRole('link',{name:'Opnieuw verifiëren via Google of e-mail',exact:true});await expect(verify).toHaveAttribute('href','/inloggen?reauth=1&next=%2Fapp%2Fsettings%3Fpin%3Dreset');
  await pins(page);await section.getByRole('button',{name:'Opnieuw instellen',exact:true}).click();await expect(section.getByRole('alert')).toContainText('Log opnieuw in');await expect(section.getByLabel('Spelerspincode',{exact:true}).and(page.locator('input'))).toBeEmpty();
  await verify.click();await expect(page.getByRole('heading',{name:'Bevestig je aanmelding',exact:true})).toBeVisible();await page.getByRole('link',{name:'Doorgaan met Google',exact:true}).click();await expect(page).toHaveURL('/app/settings?pin=reset');await pins(page);await page.getByRole('button',{name:'Opnieuw instellen',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Je spelerspincode is opgeslagen.'})).toBeVisible();
  expect(calls).toEqual(['change','change','reset','reset']);expect(await page.locator('.player-profile-form').innerHTML()).not.toContain('012345');expect(await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}))).not.toContain('012345');
 }finally{await context.close();}
});

function statsFixture(url:URL):PlayerStatisticsResponse{
 const all:StatisticsMatchRow[]=Array.from({length:26},(_,index)=>({id:`90000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,completedAt:new Date(Date.UTC(2026,10,12-index)).toISOString(),players:[profile,{id:`80000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,name:`Tegenstander ${index+1}`}],opponent:{id:`80000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,name:`Tegenstander ${index+1}`},result:index%2?'V':'W',legs:index%2?[1,3]:[3,1],sets:[0,0],startScore:Number(url.searchParams.get('startScore')||501),outRule:'double-out',average:index===5?null:66.8,measured:index!==5}));
 const offset=Number(url.searchParams.get('offset')||0),opponentOffset=Number(url.searchParams.get('opponentOffset')||0),practiceOffset=Number(url.searchParams.get('practiceOffset')||0);
 const summary:StatisticsSummary={...summarizePlayerStatistics([],actor),played:26,won:13,lost:13,winPercentage:50,form:all.slice(0,5),last50:{window:26,measured:25,average:66.8,label:'Gemeten in 25 van 26 duels',trend:all.map(row=>({id:row.id,completedAt:row.completedAt,average:row.average}))}};
 const page=(current:number)=>({offset:current,limit:25,total:26,hasMore:current+25<26});
 const search=url.searchParams.get('search')??'',opponents=all.filter(row=>row.opponent!.name.toLowerCase().includes(search.toLowerCase()));
 return{filter:{startScore:Number(url.searchParams.get('startScore')||501) as 501,outRule:'double-out'},summary,matches:all.slice(offset,offset+25),pagination:page(offset),opponents:opponents.slice(opponentOffset,opponentOffset+25).map(row=>({opponent:row.opponent!,played:5,won:3,lost:2,drawn:0,legsWon:12,legsLost:8,lastPlayedAt:row.completedAt,lastResult:row,recent:all.slice(0,5)})),opponentPagination:{...page(opponentOffset),total:opponents.length,hasMore:opponentOffset+25<opponents.length},tournaments:[{id:'local-tournament',name:'Clubtoernooi',kind:'tournament',classification:'1e plaats',summary,administrative:[{id:'local-bye',phase:'knockout',round:1,status:'bye'}]}],practice:{sessions:all.slice(practiceOffset,practiceOffset+25).map((row,index)=>({id:row.id,name:practiceOffset===0&&index===0?'Dubbeltraining':practiceOffset===0&&index===1?'170-checkouttraining':'501 tegen Dartbot',mode:practiceOffset===0&&index===0?'around':practiceOffset===0&&index===1?'170':'bot',completedAt:row.completedAt,startScore:practiceOffset===0&&index===1?170:501,average:practiceOffset===0&&index<2?null:75,darts:20,highestFinish:100,bestLegDarts:20,hits:17,attempts:24,progress:8})),pagination:page(practiceOffset),records:[{mode:'bot',startScore:501,sessions:24,bestAverage:75,bestLegDarts:20,highestFinish:100,bestHits:null},{mode:'around',startScore:501,sessions:1,bestAverage:null,bestLegDarts:null,highestFinish:null,bestHits:17},{mode:'170',startScore:170,sessions:1,bestAverage:null,bestLegDarts:null,highestFinish:100,bestHits:null}]}};
}

test('four profile statistic views paginate at 25, filter rules, search opponents and open their stable-ID history',async({browser,baseURL})=>{
 localOnly(baseURL);const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage();const queries:URL[]=[];
 try{
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());let body:unknown={};
   if(url.pathname==='/api/session')body={user:profile,local:false,environment:'development',requiresDisplayName:false,requiresProfileCompletion:false};
   else if(url.pathname==='/api/overview')body=overview(profile);
   else if(url.pathname==='/api/platform')body=platform(profile);
   else if(url.pathname==='/api/player-statistics'){queries.push(url);body=statsFixture(url);}
   else if(url.pathname==='/api/mail/preferences')body={preferences:[]};
   else if(url.pathname.startsWith('/api/community'))body={posts:[],messages:[],nextCursor:null};
   await route.fulfill({json:body});
  });
  await page.goto('/app/statistics?view=matches');await expect(page.getByRole('tablist',{name:'Statistiekweergave'}).getByRole('tab')).toHaveCount(4);await expect(page.getByText('Gemeten in 25 van 26 duels · 501 · open in · dubbel uit')).toBeVisible();await expect(page.locator('.player-statistics table tbody tr')).toHaveCount(25);await expect(page.getByRole('img',{name:/Trend van 25 gemeten wedstrijden/})).toBeVisible();
  await page.getByRole('button',{name:'Volgende',exact:true}).click();await expect(page.locator('.player-statistics table tbody tr')).toHaveCount(1);await expect.poll(()=>queries.at(-1)?.searchParams.get('offset')).toBe('25');await expect(page.getByText('26–26 van 26')).toBeVisible();
  await page.getByRole('tab',{name:'Tegenstanders',exact:true}).click();await expect(page.locator('.profile-opponent')).toHaveCount(25);await expect(page.locator('.profile-opponent').first().locator('tbody tr')).toHaveCount(5);await page.getByRole('button',{name:'Volgende',exact:true}).click();await expect(page.locator('.profile-opponent')).toHaveCount(1);await expect.poll(()=>queries.at(-1)?.searchParams.get('opponentOffset')).toBe('25');
  await page.getByLabel('Zoek tegenstander',{exact:true}).fill('Tegenstander 2');await expect(page.locator('.profile-opponent')).toHaveCount(8);await expect.poll(()=>queries.at(-1)?.searchParams.get('opponentOffset')).toBe('0');await page.getByRole('button',{name:'Volledige onderlinge historie',exact:true}).first().click();await expect(page.getByRole('tab',{name:'Wedstrijden',exact:true})).toHaveAttribute('aria-selected','true');await expect.poll(()=>queries.at(-1)?.searchParams.get('opponent')).toBe('80000000-0000-4000-8000-000000000002');await expect.poll(()=>queries.at(-1)?.searchParams.get('offset')).toBe('0');
  await page.getByRole('tab',{name:'Toernooien',exact:true}).click();await expect(page.getByRole('heading',{name:'Clubtoernooi',exact:true})).toBeVisible();await expect(page.getByText('Officiële klassering: 1e plaats')).toBeVisible();await page.getByText('Byes en administratieve uitslagen',{exact:true}).click();await expect(page.getByText('knockout · ronde 1 · bye',{exact:false})).toBeVisible();
  await page.getByRole('tab',{name:'Oefenen',exact:true}).click();await expect(page.getByRole('heading',{name:'Opgeslagen oefeningen',exact:true})).toBeVisible();const around=page.locator('.profile-opponent').filter({has:page.getByRole('link',{name:/Dubbeltraining/})}),checkout=page.locator('.profile-opponent').filter({has:page.getByRole('link',{name:/170-checkouttraining/})});await expect(around).toContainText(/17\s*\/\s*24/);await expect(around).not.toContainText('AVG');await expect(checkout).not.toContainText('AVG');await expect(checkout).toContainText(/finish.*100/i);await page.getByRole('button',{name:'Volgende',exact:true}).click();await expect.poll(()=>queries.at(-1)?.searchParams.get('practiceOffset')).toBe('25');await expect(page.getByText('26–26 van 26')).toBeVisible();
  await page.getByRole('tab',{name:'Wedstrijden',exact:true}).click();await page.getByRole('combobox',{name:'Speltype',exact:true}).selectOption('301');await expect(page.getByText('Gemeten in 25 van 26 duels · 301 · open in · dubbel uit')).toBeVisible();await expect.poll(()=>queries.at(-1)?.searchParams.get('startScore')).toBe('301');await expect.poll(()=>queries.at(-1)?.searchParams.get('offset')).toBe('0');
 }finally{await context.close();}
});
