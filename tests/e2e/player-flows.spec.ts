import {openMatchDetails} from './helpers/score-console';
import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import type {MatchView} from '../../lib/types';

try{process.loadEnvFile('.env.local');}catch{/* CI supplies an explicit loopback fixture. */}
const origin='http://localhost:3000',aId='00000000-0000-4000-8000-000000000002',bId='00000000-0000-4000-8000-000000000003';
async function login(page:Page,name:string){await page.goto('/inloggen?next=/app');await page.getByRole('button',{name:new RegExp(name)}).click();}
async function command(context:BrowserContext,action:Record<string,unknown>){const result=await context.request.post('/api/platform/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),action}});expect(result.status(),await result.text()).toBe(200);return result.json();}
async function matchAction(context:BrowserContext,id:string,action:Record<string,unknown>){const state:MatchView=await(await context.request.get(`/api/matches/${id}`)).json();const result=await context.request.post(`/api/matches/${id}/actions`,{headers:{Origin:origin},data:{requestId:randomUUID(),expectedRevision:state.revision,action}});expect(result.status(),await result.text()).toBe(200);return result.json() as Promise<MatchView>;}

test('mandatory profile completion and two-browser turn input cover home, hybrid and local shared writer',async({browser,baseURL})=>{
  test.setTimeout(180000);
  if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname)||!process.env.DARTFLOW_DATABASE_ADMIN_URL||!['localhost','127.0.0.1'].includes(new URL(process.env.DARTFLOW_DATABASE_ADMIN_URL).hostname))throw Error('Player-flow tests require the local fixture database.');
  const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
  const first=await browser.newContext({viewport:{width:390,height:844}}),second=await browser.newContext();
  const createdMatches:string[]=[];
  const previous=(await owner.query('select id,name,display_name_confirmed from dartflow_private.profiles where id=any($1::uuid[])',[[aId,bId]])).rows;
  try{
    expect((await(await first.request.get('/api/session')).json()).local).toBe(true);
    await owner.query("update dartflow_private.profiles set name='Nieuwe speler',display_name_confirmed=false where id=$1",[aId]);
    // The Google provider proposal follows exactly the same explicit confirmation screen.
    await owner.query("update dartflow_private.profiles set name='Raymond Google voorstel',display_name_confirmed=false where id=$1",[bId]);
    const a=await first.newPage(),b=await second.newPage();await login(a,'Michael de Groot');
    await expect(a.getByRole('heading',{name:'Kies je gebruikersnaam'})).toBeVisible();
    const name=a.getByLabel('Gebruikersnaam',{exact:true});await expect(name).toBeEmpty();await name.fill('   ');
    await expect(a.getByRole('button',{name:'Gebruikersnaam bevestigen en verder'})).toBeDisabled();
    const empty=await first.request.post('/api/platform/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),action:{type:'profile.update',name:'   '}}});expect(empty.status()).toBe(400);
    const blocked=await first.request.post('/api/platform/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),action:{type:'lobby.create',setup:'remote'}}});expect(blocked.status()).toBe(409);expect((await blocked.json()).code).toBe('display_name_required');
    await name.fill('Noor Dart');await a.getByRole('button',{name:'Gebruikersnaam bevestigen en verder'}).click();await expect(a).toHaveURL('/app');
    await login(b,'Raymond van Dijk');await expect(b.getByLabel('Gebruikersnaam',{exact:true})).toHaveValue('Raymond Google voorstel');
    await b.getByLabel('Gebruikersnaam',{exact:true}).fill('  nOoR   dArT  ');await b.getByRole('button',{name:'Gebruikersnaam bevestigen en verder'}).click();await expect(b.getByRole('alert').filter({hasText:'Deze gebruikersnaam is al in gebruik'})).toBeVisible();expect((await(await second.request.get('/api/session')).json()).user.displayNameConfirmed).toBe(false);
    await b.getByLabel('Gebruikersnaam',{exact:true}).fill('Sam Dart');await b.getByRole('button',{name:'Gebruikersnaam bevestigen en verder'}).click();await expect(b).toHaveURL('/app');
    expect((await(await first.request.get('/api/session')).json()).user.name).toBe('Noor Dart');expect((await(await second.request.get('/api/session')).json()).user.name).toBe('Sam Dart');
    for(const setup of ['remote','hybrid','localone']){
      const own=setup!=='localone';
      const lobby=await command(first,{type:'lobby.create',name:`Turn browser ${setup}`,setup,startScore:301,bestOfLegs:1});
      await command(second,{type:'lobby.join',id:lobby.id,code:lobby.code});
      await a.goto(`/app/lobby/${lobby.id}`);await expect(a.locator('.workspace-row strong').filter({hasText:/^Noor Dart$/})).toBeVisible();await expect(a.locator('.workspace-row strong').filter({hasText:/^Sam Dart$/})).toBeVisible();
      await command(first,{type:'lobby.ready',id:lobby.id});await command(second,{type:'lobby.ready',id:lobby.id});
      const started=await command(first,{type:'lobby.start',id:lobby.id}),id=started.matchId;createdMatches.push(id);
      await matchAction(first,id,{type:'accept'});await matchAction(second,id,{type:'accept'});let state=await matchAction(first,id,{type:'start'});
      await a.goto(`/wedstrijd/${id}`);await b.goto(`/wedstrijd/${id}`);await openMatchDetails(a);await openMatchDetails(b);
      await expect(a.getByRole('heading',{name:'Noor Dart — Sam Dart'})).toBeVisible();
      await expect(a.getByLabel('Wedstrijd uitnodiging').getByText(`Wedstrijdcode: ${lobby.code}`,{exact:true})).toBeVisible();await expect(b.getByRole('heading',{name:'Noor Dart — Sam Dart'})).toBeVisible();
      await a.getByLabel('Bezoekscore',{exact:true}).fill('100');await a.getByRole('button',{name:'Score invoeren',exact:true}).click();
      await expect(a.locator('.remaining').first()).toHaveText('201');await expect(b.locator('.remaining').first()).toHaveText('201');
      const scorer=own?b:a;
      if(own){await expect(a.getByLabel('Bezoekscore',{exact:true})).toHaveCount(0);await expect(b.getByRole('button',{name:'Schrijven overnemen',exact:true})).toHaveCount(0);}
      else await expect(b.getByLabel('Bezoekscore',{exact:true})).toHaveCount(0);
      await scorer.getByLabel('Bezoekscore',{exact:true}).fill('60');await scorer.getByRole('button',{name:'Score invoeren',exact:true}).click();
      await expect(a.locator('.remaining').nth(1)).toHaveText('241');await expect(b.locator('.remaining').nth(1)).toHaveText('241');
      state=await(await first.request.get(`/api/matches/${id}`)).json();expect(state.visits).toHaveLength(2);
      for(let turn=0;state.status==='live'&&turn<8;turn++){
        const current=own&&state.turn===1?second:first,remaining=state.remaining[state.turn];
        state=await matchAction(current,id,{type:'score',score:state.turn===0?remaining>170?remaining-40:remaining:0,...(state.turn===0&&remaining<=170?{doubleConfirmed:true}:{})});
      }
      expect(state.status).toBe('result');await matchAction(first,id,{type:'confirm'});await matchAction(second,id,{type:'confirm'});
    }
  }finally{
    for(const id of createdMatches){try{
      let state:MatchView=await(await first.request.get(`/api/matches/${id}`)).json();
      for(let turn=0;state.status==='live'&&turn<12;turn++){const remaining=state.remaining[state.turn],context=state.scoringMode==='per-player'&&state.turn===1?second:first;state=await matchAction(context,id,{type:'score',score:state.turn===0?remaining>170?remaining-40:remaining:0,...(state.turn===0&&remaining<=170?{doubleConfirmed:true}:{})});}
      if(state.status==='result'){await matchAction(first,id,{type:'confirm'});await matchAction(second,id,{type:'confirm'});}
    }catch{/* Preserve the original failure; all records are isolated local fixtures. */}}
    await Promise.allSettled([first.close(),second.close()]);
    for(const row of previous)await owner.query('update dartflow_private.profiles set name=$2,display_name_confirmed=$3 where id=$1',[row.id,row.name,row.display_name_confirmed]);
    await owner.end();
  }
});
