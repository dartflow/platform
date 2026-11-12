import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {matchView,newGame} from '../../lib/domain';
import type {MatchState,Overview,Profile} from '../../lib/types';

const actor='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
const profile:Profile={id:actor,name:'Eerste speler',username:'firstplayer',displayNameConfirmed:true};
const overview:Overview={profile,clubs:[],currentClub:null,events:[],matches:[],boards:[],participants:[],history:[],standings:[],permissions:{canManage:false}};
function localOnly(baseURL:string|undefined){if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('UI fixtures require a loopback app.');}

test('one-phone PIN form masks leading zero, clears every attempt and retries an uncertain success without changing session',async({browser,baseURL})=>{
 localOnly(baseURL);const context=await browser.newContext({viewport:{width:360,height:640},serviceWorkers:'block'}),page=await context.newPage();
 const lobbyId=randomUUID(),boardId=randomUUID();let joined=false,attempts=0,pauseRefresh=false;const requests:{requestId:string;pin:string;username:string}[]=[];
 const entity=()=>({id:lobbyId,name:'Lokale baanlobby',kind:'lobby',ownerId:actor,clubId:null,visibility:'private',revision:joined?2:1,inviteCode:'K7M2',state:{boardId,setup:'localone',ready:joined?{[other]:true}:{},closed:false},members:[{id:actor,name:profile.name,role:'owner',status:'active'},...(joined?[{id:other,name:'Tweede speler',role:'member',status:'active',attributes:{pinLinkedBy:actor}}]:[])]});
 try{
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());let data:unknown={};
   if(url.pathname==='/api/session')data={user:profile,local:true,environment:'development',requiresDisplayName:false,requiresPlayerPin:false};
   else if(url.pathname==='/api/overview')data=overview;
   else if(url.pathname==='/api/platform'){if(pauseRefresh)return route.fulfill({status:503,json:{error:'Tijdelijke verbindingstest'}});data={profile,matches:[],history:[],players:[],clubs:[],clubBoards:[],rooms:[],trainings:[],leagues:[],tournaments:[],lobbies:[entity()],friends:[],blocked:[],preferences:{}};}
   else if(url.pathname==='/api/player-pin/lobby-add'){
    const body=route.request().postDataJSON();requests.push(body);expect(body.lobbyId).toBe(lobbyId);attempts++;
    if(attempts===1)return route.fulfill({status:400,json:{error:'Gebruikersnaam of spelerspincode klopt niet.'}});
    if(attempts===2){joined=true;pauseRefresh=true;return route.abort('failed');}
    pauseRefresh=false;
    data={ok:true,id:lobbyId,entity:entity()};
   }
   await route.fulfill({json:data});
  });
  await page.goto(`/app/lobby/${lobbyId}`);await page.getByRole('button',{name:'Speler toevoegen',exact:true}).click();
  await expect(page.getByText('Geef je telefoon aan je tegenstander.',{exact:false})).toBeVisible();await expect(page.getByText('Tweede speler',{exact:true})).toHaveCount(0);
  const pin=page.getByLabel('Spelerspincode',{exact:true});await expect(pin).toHaveAttribute('type','password');await expect(pin).toHaveAttribute('inputmode','numeric');
  await expect(page.getByLabel('Gebruikersnaam',{exact:true})).toHaveAttribute('maxlength','81');await page.getByLabel('Gebruikersnaam',{exact:true}).fill('@'+'a'.repeat(80));await expect(page.getByLabel('Gebruikersnaam',{exact:true})).toHaveValue('@'+'a'.repeat(80));
  await page.getByLabel('Gebruikersnaam',{exact:true}).fill('@ secondplayer');await pin.fill('012345');await expect(pin).toHaveValue('012345');await page.getByRole('button',{name:'Toevoegen',exact:true}).click();
  await expect(pin).toBeEmpty();await expect(page.getByRole('alert').filter({hasText:'Gebruikersnaam of spelerspincode klopt niet.'})).toBeVisible();await expect(page.getByText('Tweede speler',{exact:true})).toHaveCount(0);
  await pin.fill('012345');await page.getByRole('button',{name:'Sluiten',exact:true}).click();await page.getByRole('button',{name:'Speler toevoegen',exact:true}).click();await expect(pin).toBeEmpty();
  await pin.fill('012345');await page.getByRole('button',{name:'Toevoegen',exact:true}).click();await expect(pin).toBeEmpty();await page.getByRole('button',{name:'Koppeling controleren zonder pincode',exact:true}).click();await expect(page.getByText('Tweede speler',{exact:true}).first()).toBeVisible();await expect(page.getByRole('button',{name:'Speler toevoegen',exact:true})).toHaveCount(0);
  expect(requests).toHaveLength(3);expect(requests[0].pin).toBe('012345');expect(requests[1].username).toBe('@ secondplayer');expect(requests[2].requestId).toBe(requests[1].requestId);expect(requests[2].pin).toBe('');
  expect(await page.evaluate(async()=>(await(await fetch('/api/session')).json()).user.id)).toBe(actor);
  const stored=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));expect(stored).not.toContain('012345');expect(stored).not.toContain('secondplayer');
  await page.reload();await expect(page.getByText('Tweede speler',{exact:true}).first()).toBeVisible();
 }finally{await context.close();}
});

for(const viewport of [{width:390,height:844},{width:360,height:640}])test(`checkout records one-tap darts and optional double attempts at ${viewport.width}x${viewport.height}`,async({browser,baseURL})=>{
 localOnly(baseURL);const context=await browser.newContext({viewport,serviceWorkers:'block'}),page=await context.newPage();
 const id=randomUUID(),settings={startScore:501 as const,bestOfLegs:1,bestOfSets:1};const source:MatchState={id,eventId:randomUUID(),clubId:randomUUID(),boardId:null,revision:3,status:'live',players:[profile,{id:other,name:'Tweede speler'}],writerId:actor,settings,accepted:[true,true],confirmations:[false,false],resultRevision:null,game:{...newGame(id,[actor,other],settings),remaining:[40,188]},previousSets:[],winnerId:null,resultPublished:false,dispute:null};let current=matchView(source,actor,false);const scores:Record<string,unknown>[]=[];
 try{
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());let data:unknown={};
   if(url.pathname==='/api/session')data={user:profile,local:true,environment:'development',requiresDisplayName:false,requiresPlayerPin:false};
   else if(url.pathname==='/api/overview')data=overview;
   else if(url.pathname===`/api/matches/${id}`)data=current;
   else if(url.pathname===`/api/matches/${id}/invitation`)data={invitation:null};
   else if(url.pathname===`/api/matches/${id}/actions`){scores.push(route.request().postDataJSON());current={...current,revision:4,status:'result',remaining:[0,188],permissions:{...current.permissions,canScore:false,canWrite:false}};data=current;}
   await route.fulfill({json:data});
  });
  await page.goto(`/wedstrijd/${id}`);await expect(page.getByRole('dialog',{name:'Schermvullende score-invoer'})).toBeVisible();
  await page.getByRole('button',{name:'Cijfer 4',exact:true}).click();await page.getByRole('button',{name:'Cijfer 0',exact:true}).click();await page.getByRole('button',{name:'Finish in 1 dart',exact:true}).click();
  await expect(page.getByRole('button',{name:'Finish in 1 dart',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Darts & correctie',exact:true}).click();await page.getByLabel('Darts op de uitgooidubbel',{exact:true}).selectOption('1');await page.getByRole('button',{name:'Opties sluiten',exact:true}).click();
  const layout=await page.locator('.score-console').evaluate(node=>{const keypad=node.querySelector('.score-console-keypad')!.getBoundingClientRect(),button=node.querySelector('.score-console-confirm')!.getBoundingClientRect();return{height:innerHeight,overflow:node.scrollHeight-node.clientHeight,keypadBottom:keypad.bottom,buttonTop:button.top,buttonBottom:button.bottom};});expect(layout.overflow).toBeLessThanOrEqual(1);expect(layout.keypadBottom).toBeLessThanOrEqual(layout.buttonTop);expect(layout.buttonBottom).toBeLessThanOrEqual(layout.height);
  await page.getByRole('button',{name:'Finish bevestigen',exact:true}).click();await expect(page.getByRole('dialog',{name:'Schermvullende score-invoer'})).toHaveCount(0);expect(scores).toHaveLength(1);expect(scores[0].action).toMatchObject({type:'score',score:40,darts:1,doubleConfirmed:true,doubleAttempts:1});
 }finally{await context.close();}
});
