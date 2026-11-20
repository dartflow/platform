import {openMatchDetails} from './helpers/score-console';
import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import type {MatchView} from '../../lib/types';

try{process.loadEnvFile('.env.local');}catch{/* CI supplies an explicit loopback fixture. */}
const localUserIds=[1,2,3,4].map(value=>`00000000-0000-4000-8000-${String(value).padStart(12,'0')}`);
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
  const previous=(await owner.query('select id,name,display_name,display_name_confirmed,onboarding_complete,show_public_statistics,full_name,username_locked_at::text,identity_needs_review from dartflow_private.profiles where id=any($1::uuid[])',[localUserIds])).rows;
  const verifiers=(await owner.query('select to_jsonb(v) as value from dartflow_private.player_pin_verifiers v where user_id=any($1::uuid[])',[localUserIds])).rows.map(row=>row.value);
  const pinReceipts=(await owner.query('select to_jsonb(v) as value from dartflow_private.player_pin_receipts v where actor_id=any($1::uuid[]) or target_id=any($1::uuid[])',[localUserIds])).rows.map(row=>row.value);
  const setupReceipts=(await owner.query('select to_jsonb(v) as value from dartflow_private.profile_setup_receipts v where actor_id=any($1::uuid[])',[localUserIds])).rows.map(row=>row.value);
  const pinLimits=(await owner.query("select to_jsonb(v) as value from dartflow_private.auth_limits v where key like 'pin:%'")).rows.map(row=>row.value);
  const suffix=randomUUID().slice(0,6),firstHandle=`noorui${suffix}`,secondHandle=`samui${suffix}`;
  try{
    expect((await(await first.request.get('/api/session')).json()).local).toBe(true);
    await owner.query('begin');await owner.query('set local session_replication_role=replica');
    await owner.query("update dartflow_private.profiles set name='Nieuwe speler',display_name=null,full_name=null,username_locked_at=null,identity_needs_review=true,display_name_confirmed=false,onboarding_complete=false where id=$1",[aId]);
    // A local fixture proposal exercises onboarding without calling a Google provider.
    await owner.query("update dartflow_private.profiles set name='Nieuwe speler',display_name=null,full_name='Raymond Google voorstel',username_locked_at=null,identity_needs_review=true,display_name_confirmed=false,onboarding_complete=false where id=$1",[bId]);
    await owner.query('commit');
    await owner.query('delete from dartflow_private.player_pin_verifiers where user_id=any($1::uuid[])',[[aId,bId]]);
    const a=await first.newPage(),b=await second.newPage();await login(a,'Michael de Groot');
    await expect(a.getByRole('heading',{name:'Maak je spelersprofiel compleet'})).toBeVisible();
    const name=a.getByLabel('Gebruikersnaam',{exact:true}),display=a.getByLabel('Displaynaam',{exact:true}),pin=a.getByLabel('Spelerspincode',{exact:true}),repeat=a.getByLabel('Herhaal spelerspincode',{exact:true}),save=a.getByRole('button',{name:'Profiel opslaan en verder'});
    await expect(name).toBeEmpty();await expect(display).toBeEmpty();await name.fill('   ');await expect(save).toBeDisabled();
    const empty=await first.request.post('/api/profile/complete',{headers:{Origin:origin},data:{requestId:randomUUID(),username:'   ',displayName:'Noor Dart',pin:'012345',pinConfirmation:'012345'}});expect(empty.status()).toBe(400);
    const blocked=await first.request.post('/api/platform/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),action:{type:'lobby.create',setup:'remote'}}});expect(blocked.status()).toBe(409);expect((await blocked.json()).code).toBe('display_name_required');
    await name.fill('@'+firstHandle);await display.fill('Noor Dart');await a.getByRole('checkbox',{name:/Ik bevestig/}).check();await expect(pin).toHaveAttribute('type','password');await expect(pin).toHaveAttribute('inputmode','numeric');
    for(const value of ['01234','01234a']){await pin.fill(value);await repeat.fill(value);await expect(save).toBeDisabled();await expect(a.getByRole('status').filter({hasText:'Vul precies zes cijfers in.'})).toBeVisible();}
    await pin.fill('012345');await repeat.fill('012346');await expect(save).toBeDisabled();await expect(a.getByRole('status').filter({hasText:'De spelerspincodes zijn niet gelijk.'})).toBeVisible();
    await repeat.fill('012345');let failedAttemptId='';
    await a.route('**/api/profile/complete',async route=>{failedAttemptId=route.request().postDataJSON().requestId;await route.fulfill({status:503,json:{error:'Lokale test: tijdelijk opslaan niet beschikbaar.'}});},{times:1});
    await save.click();await expect(a.getByRole('alert').filter({hasText:'tijdelijk opslaan niet beschikbaar'})).toBeVisible();await expect(pin).toBeEmpty();await expect(repeat).toBeEmpty();
    await pin.fill('012345');await repeat.fill('012345');
    await a.route('**/api/profile/complete',async route=>{expect(route.request().postDataJSON().requestId).toBe(failedAttemptId);await route.continue();},{times:1});
    await Promise.all([a.waitForEvent('domcontentloaded'),save.click()]);await expect(a).toHaveURL('/app');
    await login(b,'Raymond van Dijk');await expect(b.getByRole('heading',{name:'Maak je spelersprofiel compleet'})).toBeVisible();await expect(b.getByLabel('Displaynaam',{exact:true})).toBeEmpty();await expect(b.getByLabel('Volledige naam',{exact:true})).toHaveValue('Raymond Google voorstel');
    // Model a stale availability response; the actual completion endpoint must reject the taken claim.
    await b.route('**/api/profile/username-availability?*',route=>route.fulfill({json:{valid:true,available:true,username:firstHandle,locked:false}}),{times:1});
    await b.getByLabel('Gebruikersnaam',{exact:true}).fill('@'+firstHandle.toUpperCase());await b.getByLabel('Displaynaam',{exact:true}).fill('Sam Dart');await b.getByRole('checkbox',{name:/Ik bevestig/}).check();await b.getByLabel('Spelerspincode',{exact:true}).fill('001234');await b.getByLabel('Herhaal spelerspincode',{exact:true}).fill('001234');await b.getByRole('button',{name:'Profiel opslaan en verder'}).click();
    await expect(b.getByRole('alert').filter({hasText:'Deze gebruikersnaam is al in gebruik'})).toBeVisible();expect((await(await second.request.get('/api/session')).json()).user.displayNameConfirmed).toBe(false);await expect(b.getByLabel('Spelerspincode',{exact:true})).toBeEmpty();await expect(b.getByLabel('Herhaal spelerspincode',{exact:true})).toBeEmpty();
    await b.getByLabel('Gebruikersnaam',{exact:true}).fill(secondHandle);await b.getByRole('checkbox',{name:/Ik bevestig/}).check();await b.getByLabel('Spelerspincode',{exact:true}).fill('001234');await b.getByLabel('Herhaal spelerspincode',{exact:true}).fill('001234');await Promise.all([b.waitForEvent('domcontentloaded'),b.getByRole('button',{name:'Profiel opslaan en verder'}).click()]);await expect(b).toHaveURL('/app');
    const firstSession=(await(await first.request.get('/api/session')).json()).user,secondSession=(await(await second.request.get('/api/session')).json()).user;
    expect(firstSession).toMatchObject({id:aId,name:'Noor Dart',username:firstHandle,pinConfigured:true});expect(secondSession).toMatchObject({id:bId,name:'Sam Dart',username:secondHandle,pinConfigured:true});
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
    // Restore every local login fixture, including private verifier/receipt state, without logging secrets.
    await owner.query('begin');
    try{
      await owner.query('set local session_replication_role=replica');
      for(const row of previous)await owner.query('update dartflow_private.profiles set name=$2,display_name=$3,display_name_confirmed=$4,onboarding_complete=$5,show_public_statistics=$6,full_name=$7,username_locked_at=$8,identity_needs_review=$9 where id=$1',[row.id,row.name,row.display_name,row.display_name_confirmed,row.onboarding_complete,row.show_public_statistics,row.full_name,row.username_locked_at,row.identity_needs_review]);
      await owner.query('delete from dartflow_private.player_pin_receipts where actor_id=any($1::uuid[]) or target_id=any($1::uuid[])',[localUserIds]);
      await owner.query('delete from dartflow_private.profile_setup_receipts where actor_id=any($1::uuid[])',[localUserIds]);
      await owner.query('delete from dartflow_private.player_pin_verifiers where user_id=any($1::uuid[])',[localUserIds]);
      for(const row of verifiers)await owner.query('insert into dartflow_private.player_pin_verifiers select * from jsonb_populate_record(null::dartflow_private.player_pin_verifiers,$1::jsonb)',[JSON.stringify(row)]);
      for(const row of pinReceipts)await owner.query('insert into dartflow_private.player_pin_receipts select * from jsonb_populate_record(null::dartflow_private.player_pin_receipts,$1::jsonb)',[JSON.stringify(row)]);
      for(const row of setupReceipts)await owner.query('insert into dartflow_private.profile_setup_receipts select * from jsonb_populate_record(null::dartflow_private.profile_setup_receipts,$1::jsonb)',[JSON.stringify(row)]);
      await owner.query("delete from dartflow_private.auth_limits where key like 'pin:%'");
      for(const row of pinLimits)await owner.query('insert into dartflow_private.auth_limits select * from jsonb_populate_record(null::dartflow_private.auth_limits,$1::jsonb)',[JSON.stringify(row)]);
      // Compare privately in memory; failures never print names, verifiers, PIN receipts or limits.
      const restored=(await owner.query('select id,name,display_name,display_name_confirmed,onboarding_complete,show_public_statistics,full_name,username_locked_at::text,identity_needs_review from dartflow_private.profiles where id=any($1::uuid[])',[localUserIds])).rows;
      const same=(left:unknown[],right:unknown[])=>JSON.stringify(left.map(value=>JSON.stringify(value)).sort())===JSON.stringify(right.map(value=>JSON.stringify(value)).sort());
      if(!same(previous,restored))throw Error('The local profile fixture was not restored exactly.');
      for(const [table,where,params,expected]of [
        ['player_pin_verifiers','user_id=any($1::uuid[])',[localUserIds],verifiers],
        ['player_pin_receipts','actor_id=any($1::uuid[]) or target_id=any($1::uuid[])',[localUserIds],pinReceipts],
        ['profile_setup_receipts','actor_id=any($1::uuid[])',[localUserIds],setupReceipts],
        ['auth_limits',"key like 'pin:%'",[],pinLimits]
      ]as const){const actual=(await owner.query(`select to_jsonb(v)as value from dartflow_private.${table} v where ${where}`,[...params])).rows.map(row=>row.value);if(!same([...expected],actual))throw Error('The local private fixture was not restored exactly.');}
      await owner.query('commit');
    }catch(error){await owner.query('rollback');throw error;}finally{await owner.end();}
  }
});
