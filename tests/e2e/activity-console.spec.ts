import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {matchView,newGame} from '../../lib/domain';
import type {MatchState,MatchView,Overview} from '../../lib/types';
import type {BoardActivityView} from '../../lib/board-activity-types';

const actor='00000000-0000-4000-8000-000000000002',opponent='00000000-0000-4000-8000-000000000003';
function snapshot():MatchView{
 const id=randomUUID(),eventId=randomUUID(),clubId=randomUUID(),boardId=randomUUID(),settings={startScore:501 as const,bestOfLegs:3,bestOfSets:1};
 const state:MatchState={id,eventId,clubId,boardId,revision:4,status:'live',scoringMode:'per-player',players:[{id:actor,name:'Noor Dart'},{id:opponent,name:'Sam Dart'}],writerId:actor,settings,accepted:[true,true],confirmations:[false,false],resultRevision:null,game:newGame(id,[actor,opponent],settings),previousSets:[],winnerId:null,resultPublished:false,dispute:null};
 const now=Date.now(),activity:BoardActivityView={sessionId:randomUUID(),sourceId:id,sourceKind:'match',kind:'free',phase:'warning',serverNow:now,activityAt:now-125000,warningAt:now-5000,deadlineAt:now+55000,warningEpoch:randomUUID(),extensionsUsed:0,maxExtensions:2,boardIds:[boardId],canExtend:true};
 return {...matchView(state,actor,false),boardActivity:activity};
}
async function fits(page:Page){
 const bounds=await page.getByRole('dialog',{name:'Schermvullende score-invoer'}).evaluate(element=>{
  const keypad=element.querySelector('.score-console-keypad')!.getBoundingClientRect(),confirm=element.querySelector('.score-console-confirm')!.getBoundingClientRect(),notice=element.querySelector('.board-activity-phone')!.getBoundingClientRect();
  return {height:innerHeight,width:innerWidth,overflow:element.scrollHeight-element.clientHeight,keypadTop:keypad.top,keypadBottom:keypad.bottom,keypadRight:keypad.right,keypadHeight:keypad.height,confirmTop:confirm.top,confirmBottom:confirm.bottom,noticeBottom:notice.bottom};
 });
 expect(bounds.overflow).toBeLessThanOrEqual(1);expect(bounds.keypadTop).toBeGreaterThanOrEqual(bounds.noticeBottom);expect(bounds.keypadHeight).toBeGreaterThanOrEqual(120);expect(bounds.keypadBottom).toBeLessThanOrEqual(bounds.confirmTop);expect(bounds.keypadRight).toBeLessThanOrEqual(bounds.width);expect(bounds.confirmBottom).toBeLessThanOrEqual(bounds.height);
}

for(const viewport of [{width:390,height:844},{width:360,height:640}])test(`warning retains reachable scoring and server extension state at ${viewport.width}x${viewport.height}`,async({browser,baseURL})=>{
 if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw new Error('Mocked activity UI requires the loopback development app.');
 const context=await browser.newContext({viewport}),page=await context.newPage();let current=snapshot();const submitted:Record<string,unknown>[]=[],continuations:Record<string,unknown>[]=[];
 const overview:Overview={profile:{id:actor,name:'Noor Dart',username:'noordart',displayName:'Noor Dart',usernameLocked:true,displayNameConfirmed:true},clubs:[],currentClub:null,events:[],matches:[],boards:[],participants:[],history:[],standings:[],permissions:{canManage:false}};
 try{
  // Only this page's transport is mocked. No fixture account, score, assignment or provider is changed.
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),method=route.request().method();let body:unknown={};
   if(url.pathname==='/api/session')body={user:overview.profile,local:true,environment:'development',requiresDisplayName:false};
   else if(url.pathname==='/api/overview')body=overview;
   else if(url.pathname===`/api/matches/${current.id}`)body=current;
   else if(url.pathname===`/api/boards/${current.boardId}`)body={board:{id:current.boardId,name:'Baan 1'},event:{id:current.eventId,name:'Oche Live'}};
   else if(url.pathname===`/api/matches/${current.id}/invitation`)body={invitation:null};
   else if(url.pathname==='/api/board-activity/continue'&&method==='POST'){
    continuations.push(route.request().postDataJSON());const now=Date.now();current={...current,boardActivity:{...current.boardActivity!,phase:'active',serverNow:now,activityAt:now,warningAt:now+120000,deadlineAt:now+180000,warningEpoch:randomUUID(),extensionsUsed:1}};body={activity:current.boardActivity};
   }else if(url.pathname===`/api/matches/${current.id}/actions`&&method==='POST'){
    submitted.push(route.request().postDataJSON());current={...current,revision:current.revision+1,remaining:[441,501],turn:1,permissions:{...current.permissions,canScore:false,canWrite:false}};body=current;
   }else if(url.pathname.startsWith('/api/community'))body={messages:[],posts:[],nextCursor:null};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto(`/wedstrijd/${current.id}`);const consoleView=page.getByRole('dialog',{name:'Schermvullende score-invoer'});await expect(consoleView).toBeVisible();
  const notice=consoleView.getByRole('region',{name:'Baanactiviteit'});await expect(notice).toBeVisible();await expect(notice.getByRole('button',{name:/Doorspelen/})).toBeEnabled();await fits(page);
  await page.getByRole('button',{name:'Cijfer 6',exact:true}).click();await page.getByRole('button',{name:'Cijfer 0',exact:true}).click();await expect(page.getByRole('button',{name:'Bevestigen',exact:true})).toBeEnabled();await fits(page);
  await notice.getByRole('button',{name:/Doorspelen/}).click();await expect(notice).toHaveCount(0);expect(continuations).toHaveLength(1);expect(continuations[0].sessionId).toBe(current.boardActivity!.sessionId);
  await expect(consoleView.getByLabel('Bezoekscore',{exact:true})).toHaveValue('60');await page.getByRole('button',{name:'Bevestigen',exact:true}).click();await expect(page.locator('.console-remaining').first()).toHaveText('441');expect(submitted).toHaveLength(1);expect((submitted[0].action as {score:number}).score).toBe(60);
 }finally{await context.close();}
});
