import {test,expect} from '@playwright/test';
import type {CompetitionBoardContext,CompetitionBoardLobby} from '../../lib/competition-board-lobby-types';
import type {ClubBoardScreenView,Profile} from '../../lib/types';

const boardId='55555555-5555-4555-8555-555555555555',actor='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
const profile:Profile={id:actor,name:'Noor Dart',displayName:'Noor Dart',username:'noordart',usernameLocked:true,displayNameConfirmed:true,onboardingComplete:true,pinConfigured:true};
const lobby:CompetitionBoardLobby={id:'66666666-6666-4666-8666-666666666666',revision:1,seasonId:'77777777-7777-4777-8777-777777777777',seasonName:'Verenigingscompetitie',fixtureId:'88888888-8888-4888-8888-888888888888',slotId:'99999999-9999-4999-8999-999999999999',matchId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',boardId,boardName:'Baan 1',round:2,settings:{startScore:501,bestOfLegs:5,bestOfSets:1,startProcedure:'bull'},expiresAt:new Date(Date.now()+120000).toISOString(),status:'waiting',players:[{id:actor,name:'Noor Dart',username:'noordart',confirmed:true,method:'account'},{id:other,name:'Sam Dart',username:'samdart',confirmed:false}],writerId:actor,writerName:'Noor Dart',writerDeviceLabel:'Bediening met het account van de eerste speler',canConfirm:false,canStart:false,canCancel:true,matchUrl:'/wedstrijd/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};

test('board QR offers the actual planned match, keeps PIN private and restores the same lobby on reload',async({browser,baseURL},info)=>{
 if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Loopback UI fixture required.');
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage();
 let current:CompetitionBoardContext={boardId,candidates:[{seasonId:lobby.seasonId,seasonName:lobby.seasonName,revision:1,fixtureId:lobby.fixtureId,slotId:lobby.slotId,slotIndex:0,round:2,opponent:{id:other,name:'Sam Dart',username:'samdart'},startsAt:null,windowStart:new Date(Date.now()-60000).toISOString(),windowEnd:new Date(Date.now()+3600000).toISOString(),boardName:'Baan 1',settings:lobby.settings,canOpen:true}]};
 const pinCalls:Record<string,unknown>[]=[],commands:string[]=[];
 try{
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let value:unknown={};
   if(path==='/api/session')value={user:profile,local:false,environment:'development',requiresProfileCompletion:false};
   else if(path==='/api/overview')value={profile,clubs:[],currentClub:null,events:[],matches:[],boards:[],participants:[],history:[],standings:[],permissions:{canManage:false}};
   else if(path==='/api/platform')value={profile,matches:[],history:[],players:[],clubs:[],clubBoards:[],rooms:[],trainings:[],leagues:[],tournaments:[],lobbies:[],friends:[],blocked:[],preferences:{}};
   else if(path===`/api/boards/${boardId}`)value={board:{id:boardId,name:'Baan 1',blocked:false,occupied:Boolean(current.lobby)},event:{id:lobby.seasonId,name:'Verenigingscompetitie'},canStart:!current.lobby};
   else if(path===`/api/boards/${boardId}/competition`)value=current;
   else if(path==='/api/competition-lobbies/actions'){
    const command=route.request().postDataJSON();commands.push(command.action.type);expect(command.action).toMatchObject({type:'open',boardId,seasonId:lobby.seasonId,fixtureId:lobby.fixtureId,slotId:lobby.slotId});current={...current,lobby};value={ok:true,lobby};
   }else if(path==='/api/competition-lobbies/player-pin'){
    pinCalls.push(route.request().postDataJSON());expect(pinCalls.at(-1)).toMatchObject({lobbyId:lobby.id,username:'@samdart',pin:'012345'});
    if(pinCalls.length===1)return route.fulfill({status:403,json:{error:'Gebruikersnaam of spelerspincode klopt niet.'}});
    const ready:CompetitionBoardLobby={...lobby,status:'ready',revision:2,canStart:true,players:[lobby.players[0],{...lobby.players[1],confirmed:true,method:'pin'}]};current={...current,lobby:ready};value={ok:true,lobby:ready};
   }
   await route.fulfill({json:value});
  });
  await page.goto(`/baan/${boardId}`);const panel=page.getByRole('region',{name:'Competitiewedstrijd via baan-QR'});
  await expect(panel.getByRole('heading',{name:'Competitiewedstrijd starten?'})).toBeVisible();await expect(panel).toContainText('Sam Dart');await expect(panel).toContainText('@samdart');
  await panel.getByRole('button',{name:'Ja, competitiewedstrijd starten',exact:true}).click();await expect(panel.getByRole('heading',{name:'Wedstrijdlobby',exact:true})).toBeVisible();
  await expect(panel).toContainText('Bediening met het account van de eerste speler');await expect(panel.getByRole('button',{name:/Beide spelers bevestigd/})).toHaveCount(0);
  const pin=panel.getByLabel('Eigen spelerspincode tegenstander',{exact:true});await expect(pin).toHaveAttribute('type','password');await panel.getByLabel('Gebruikersnaam tegenstander',{exact:true}).fill('@samdart');await pin.fill('012345');await panel.getByRole('button',{name:'Geplande tegenstander bevestigen',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('klopt niet');await expect(pin).toBeEmpty();
  await pin.fill('012345');await panel.getByRole('button',{name:'Geplande tegenstander bevestigen',exact:true}).click();await expect(panel.getByRole('button',{name:'Beide spelers bevestigd · Open officiële partij',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}))).not.toContain('012345');
  await page.reload();await expect(panel.getByRole('button',{name:/Beide spelers bevestigd/})).toBeVisible();expect(commands).toEqual(['open']);expect(await page.evaluate(()=>(document.documentElement.scrollWidth<=innerWidth+1))).toBe(true);
  await info.attach('competition-qr-phone',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
 }finally{await context.close();}
});

for(const viewport of [{width:1920,height:1080},{width:1080,height:1920}])test(`Oche competition waiting screen fits ${viewport.width}×${viewport.height} with public confirmations`,async({browser,baseURL},info)=>{
 if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Loopback UI fixture required.');
 const context=await browser.newContext({viewport,serviceWorkers:'block'}),page=await context.newPage();
 const data:ClubBoardScreenView={board:{id:boardId,name:'Baan 1',clubName:'Vereniging',access:'all',blocked:false,occupied:true,publicScan:true,playUrl:`/baan/${boardId}`,screenUrl:`/baanscherm/${boardId}`},screen:{rotation:0},status:'waiting',snapshot:{board:{id:boardId,name:'Baan 1'},event:{name:'Verenigingscompetitie'},match:null,competitionLobby:{competitionName:lobby.seasonName,round:2,players:[{name:'Noor Dart',confirmed:true},{name:'Sam Dart',confirmed:false}],writerName:'Noor Dart',expiresAt:lobby.expiresAt}}};
 try{
  await page.route(`**/api/board-screens/${boardId}`,route=>route.fulfill({json:data}));
  await page.route(`**/api/boards/${boardId}/screen`,route=>route.fulfill({json:data}));
  await page.route('**/api/**',async route=>{if(new URL(route.request().url()).pathname.includes(boardId))return route.fulfill({json:data});return route.fulfill({json:{}});});
  await page.goto(`/baanscherm/${boardId}`);await expect(page.getByRole('region',{name:'Competitielobby'})).toContainText('Noor Dart');await expect(page.getByRole('region',{name:'Competitielobby'})).toContainText('Wacht op bevestiging');await expect(page.getByRole('region',{name:'Competitielobby'}).locator('input')).toHaveCount(0);await expect(page.locator('.score-form')).toHaveCount(0);
  for(const selector of ['.oche-headline h2','.oche-competition-lobby','.oche-qr']){const box=await page.locator(selector).boundingBox();expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(-1);expect(box!.y).toBeGreaterThanOrEqual(-1);expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width+1);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height+1);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
  await info.attach(`competition-oche-${viewport.width}x${viewport.height}`,{body:await page.screenshot(),contentType:'image/png'});
 }finally{await context.close();}
});
