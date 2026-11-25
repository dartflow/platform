import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {normalizeDisplayName,requiresDisplayName,validDisplayName} from '../lib/display-name';
import {ensureAuthProfile} from '../lib/accounts';
import {closeDatabase,executeMatchCommand,getMatch,getProfile} from '../lib/db';
import {executePlatformCommand,getPlatformOverview} from '../lib/platform';
import {newGame} from '../lib/domain';
import type {MatchState} from '../lib/types';

test('scoreboard names trim Unicode whitespace, reject placeholders/empty/control data and preserve international names',()=>{
  for(const name of ['', ' \t\n\u00a0 ', 'Nieuwe speler',' nieuwe   SPELER ','\u200b','---','a\u0000b','a'.repeat(81)])assert.equal(validDisplayName(name),false,name);
  assert.equal(normalizeDisplayName('  Zoë\u00a0  de Groot  '),'Zoë de Groot');
  for(const name of ['Zoë de Groot','李明','محمد','Darter 42'])assert.equal(validDisplayName(name),true);
  assert.equal(requiresDisplayName({name:'Google voorstel',displayNameConfirmed:false}),true);
  assert.equal(requiresDisplayName({name:'Bestaande speler',username:'bestaandespeler',displayNameConfirmed:true}),false);
});

try{process.loadEnvFile('.env.local');}catch{/* Explicit CI loopback config. */}
const loopback=(value:string|undefined)=>{try{return Boolean(value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname));}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL)&&loopback(process.env.DARTFLOW_DATABASE_URL);
test('email/Google proposals require explicit confirmation and placeholder repair preserves account, rights and match scores',{skip:!configured},async t=>{
  const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
  const actor=randomUUID(),other=randomUUID(),google=randomUUID(),club=randomUUID(),event=randomUUID(),matchId=randomUUID(),people=[actor,other,google];
  const command=(id:string,name:unknown,displayName?:string)=>executePlatformCommand(id,{requestId:randomUUID(),action:{type:'profile.update',name,...(displayName?{displayName}:{})}});
  try{
    await owner.query('insert into dartflow_private.profiles(id,name,display_name_confirmed) values($1,$2,false),($3,$4,true)',[actor,'Nieuwe speler',other,'Tegenstander']);
    await owner.query('update dartflow_private.profiles set display_name=$2 where id=$1',[other,'Tegenstander']);
    await owner.query('insert into dartflow_private.clubs(id,name) values($1,$2)',[club,'Name repair fixture']);
    await owner.query("insert into dartflow_private.club_memberships(club_id,user_id,role) values($1,$2,'organizer'),($1,$3,'player')",[club,actor,other]);
    await owner.query('insert into dartflow_private.events(id,club_id,name,date,capacity) values($1,$2,$3,current_date,10)',[event,club,'Name repair fixture']);
    await owner.query('insert into dartflow_private.event_staff(event_id,user_id) values($1,$2)',[event,actor]);
    const settings={startScore:501 as const,bestOfLegs:3,bestOfSets:1};
    const state:MatchState={id:matchId,eventId:event,clubId:club,boardId:null,revision:4,status:'live',players:[{id:actor,name:'Nieuwe speler'},{id:other,name:'Tegenstander'}],writerId:actor,settings,accepted:[true,true],confirmations:[false,false],resultRevision:null,game:newGame(matchId,[actor,other],settings),previousSets:[],winnerId:null,resultPublished:false,dispute:null};
    await owner.query('insert into dartflow_private.matches(id,club_id,event_id,revision,state) values($1,$2,$3,$4,$5)',[matchId,club,event,state.revision,JSON.stringify(state)]);
    for(const [position,id] of [actor,other].entries())await owner.query('insert into dartflow_private.match_players(match_id,user_id,position) values($1,$2,$3)',[matchId,id,position]);
    await t.test('whitespace and placeholder rejected at real server command; play endpoints cannot bypass completion',async()=>{
      for(const name of ['',' \t\u00a0 ','Nieuwe speler'])await assert.rejects(command(actor,name),{code:'display_name',status:400});
      await assert.rejects(executePlatformCommand(actor,{requestId:randomUUID(),action:{type:'lobby.create',setup:'remote'}}),{code:'display_name_required'});
      await assert.rejects(executeMatchCommand(actor,{matchId,requestId:randomUUID(),expectedRevision:4,action:{type:'score',score:60}}),{code:'display_name_required'});
    });
    await t.test('repair confirms exactly one account and updates active match name without changing game/history/club rights',async()=>{
      await command(actor,'zoedegroot','Zoë de Groot');
      const profile=await getProfile(actor);assert.equal(profile.name,'Zoë de Groot');assert.equal(profile.displayNameConfirmed,true);assert.equal(profile.id,actor);
      const current=(await owner.query('select state from dartflow_private.matches where id=$1',[matchId])).rows[0].state;
      assert.equal(current.players[0].name,'Zoë de Groot');assert.equal(current.players[1].name,'Tegenstander');assert.deepEqual(current.game,state.game);assert.equal(current.revision,5);
      assert.equal((await owner.query('select role from dartflow_private.club_memberships where club_id=$1 and user_id=$2',[club,actor])).rows[0].role,'organizer');
      assert.deepEqual((await getMatch(other,matchId)).players.map(p=>p.name),['Zoë de Groot','Tegenstander']);
      assert.equal((await getPlatformOverview(actor)).profile.name,'Zoë de Groot');
    });
    await t.test('verified Google name is only a proposal and metadata cannot assert confirmation; repeat login retains chosen name',async()=>{
      const identity={id:google,user_metadata:{full_name:'Google voorstel',display_name_confirmed:true,role:'owner'}};
      await ensureAuthProfile(identity);const proposal=await getProfile(google);assert.equal(proposal.name,'Speler');assert.equal(proposal.fullName,'Google voorstel');assert.equal(proposal.displayNameConfirmed,false);
      await assert.rejects(executePlatformCommand(google,{requestId:randomUUID(),action:{type:'lobby.create',setup:'hybrid'}}),{code:'display_name_required'});
      await command(google,'eigenbevestigdenaam','Eigen bevestigde naam');await ensureAuthProfile(identity);
      assert.equal((await getProfile(google)).name,'Eigen bevestigde naam');assert.equal((await getProfile(google)).displayNameConfirmed,true);
      assert.equal((await owner.query('select 1 from dartflow_private.platform_roles where user_id=$1',[google])).rowCount,0);
    });
    await t.test('verified email identity without metadata needs the same name confirmation',async()=>{
      await ensureAuthProfile({id:actor,user_metadata:{}});assert.equal((await getProfile(actor)).name,'Zoë de Groot');
      await owner.query('delete from dartflow_private.platform_receipts where actor_id=$1',[google]);await owner.query('delete from dartflow_private.platform_audit where actor_id=$1',[google]);await owner.query('delete from dartflow_private.profiles where id=$1',[google]);
      await ensureAuthProfile({id:google,user_metadata:{}});assert.equal((await getProfile(google)).name,'Speler');assert.equal((await getProfile(google)).displayNameConfirmed,false);
      await command(google,'emailspeler','E-mail speler');assert.equal((await getProfile(google)).name,'E-mail speler');
    });
  }finally{
    await owner.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])',[people]);
    await owner.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])',[people]);
    await owner.query('delete from dartflow_private.match_players where match_id=$1',[matchId]);await owner.query('delete from dartflow_private.matches where id=$1',[matchId]);
    await owner.query('delete from dartflow_private.event_staff where event_id=$1',[event]);await owner.query('delete from dartflow_private.events where id=$1',[event]);await owner.query('delete from dartflow_private.club_memberships where club_id=$1',[club]);await owner.query('delete from dartflow_private.clubs where id=$1',[club]);
    await owner.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);await owner.end();await closeDatabase();
  }
});
