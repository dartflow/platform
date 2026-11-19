import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {closeDatabase,executeMatchCommand,getMatch} from '../lib/db';
import {executePlatformCommand,getPlatformOverview,reconcilePlatformResults} from '../lib/platform';
import {executeRankingServiceCommand} from '../lib/ranking-service';
import {getRankings} from '../lib/rankings';
import {NATIONAL_CIRCUIT_ID} from '../lib/ranking-service-types';
import type {PlatformCommand,PlatformEntity} from '../lib/platform-types';
import type {MatchAction,MatchView} from '../lib/types';
import {beginFixtureCleanup} from './helpers/cleanup-v17';

try {process.loadEnvFile('.env.local');} catch {/* CI supplies isolated loopback credentials. */}
const loopback=(value?:string)=>{try{return !!value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);

test('national circuit finalization uses fifteen and thirty-two actual starters rather than registrations',{skip:!configured},async t=>{
 const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
 const people:string[]=Array.from({length:50},()=>randomUUID()),host=people[0],absent=people.slice(48),club=randomUUID(),suffix=randomUUID().slice(0,8);
 const entities:string[]=[],events:string[]=[];
 const platform=(actor:string,action:PlatformCommand['action'])=>executePlatformCommand(actor,{requestId:randomUUID(),action});
 const ranking=(actor:string,action:{type:string;[key:string]:unknown},requestId:string=randomUUID())=>executeRankingServiceCommand(actor,{requestId,action});
 const act=(view:MatchView,actor:string,action:MatchAction)=>executeMatchCommand(actor,{matchId:view.id,requestId:randomUUID(),expectedRevision:view.revision,action});
 async function current(id:string):Promise<PlatformEntity>{return (await getPlatformOverview(host)).tournaments.find(event=>event.id===id)!;}
 async function play(event:PlatformEntity,fixtureId:string):Promise<void>{
  const started=await platform(host,{type:'fixture.start',id:event.id,fixtureId});let match=await getMatch(host,started.matchId!);
  for(const player of match.players)match=await act(match,player.id,{type:'accept'});
  match=await act(match,match.players[0].id,{type:'start'});
  let visits=0;
  while(match.status==='live'){
   assert.ok(visits++<100,'a genuine BO5 must finish');
   const score=match.turn===0?Math.min(180,match.remaining[0]):0;
   match=await act(match,match.writerId,{type:'score',score,darts:3,doubleConfirmed:score>0&&score===match.remaining[0]});
  }
  for(const player of match.players)match=await act(match,player.id,{type:'confirm'});
  assert.equal(match.status,'confirmed');assert.equal(match.resultPublished,true);
  await reconcilePlatformResults();
 }
 try{
  for(const[index,id]of people.entries()){
   await owner.query('insert into dartflow_private.profiles(id,name,display_name,display_name_confirmed)values($1,$2,$2,true)',[id,`field_boundary_${suffix}_${index}`]);
   await owner.query("insert into dartflow_private.player_safety_acceptances(user_id,version,age_confirmed)values($1,'2026-11-18',true)",[id]);
  }
  await owner.query('insert into dartflow_private.clubs(id,name)values($1,$2)',[club,`Field boundary club ${suffix}`]);
  for(const id of people)await owner.query('insert into dartflow_private.club_memberships(club_id,user_id,role)values($1,$2,$3)',[club,id,id===host?'organizer':'player']);
  await owner.query("insert into dartflow_private.platform_roles(user_id,role)values($1,'admin')",[host]);
  for(const[count,players]of[[15,people.slice(1,16)],[32,people.slice(16,48)]]as const){
   await t.test(`${count} checked-in first-throw starters finalize ${count-1} genuine matches with the national points table exactly once`,async()=>{
    let event=(await platform(host,{type:'tournament.create',name:`National field ${count} ${suffix}`,ownership:'club',clubId:club,visibility:'public',eligibility:'all',capacity:64,format:'knockout',boards:1,requireWriter:false,drawCheckedInOnly:true,startScore:501,bestOfLegs:5})).entity!;
    entities.push(event.id,String(event.state.roomId));events.push(event.state.eventId!);
    for(const player of[...players,...absent])await platform(player,{type:'competition.register',id:event.id});
    for(const player of players)await platform(host,{type:'competition.checkin',id:event.id,userId:player});
    event=(await platform(host,{type:'competition.plan',id:event.id})).entity!;
    assert.equal(event.members.filter(member=>member.attributes.registered===true).length,count+2);
    assert.equal(event.state.tournamentRules!.seedOrder.length,count);
    const requested=await ranking(host,{type:'event.request',entityId:event.id,listId:NATIONAL_CIRCUIT_ID});
    await ranking(host,{type:'event.approve',declarationId:requested.id,decision:'approve',reason:'Vooraf erkende landelijke veldgrensproef met echte check-in en sportieve scorekaarten.'});
    for(const player of players)await ranking(player,{type:'event.accept',entityId:event.id});
    let matches=0;
    for(;;){
     event=await current(event.id);const fixture=event.state.fixtures!.find(fixture=>fixture.status==='scheduled'&&fixture.players.every(Boolean));
     if(!fixture)break;
     assert.ok(matches++<count);await play(event,fixture.id);
     if(matches===1){
      await assert.rejects(ranking(host,{type:'event.finalize',entityId:event.id}),{code:'ranking_event_incomplete'});
      assert.equal((await owner.query('select 1 from dartflow_private.ranking_sources where list_id=$1 and entity_id=$2',[NATIONAL_CIRCUIT_ID,event.id])).rowCount,0,'unfinished evenings never publish individual circuit points');
     }
    }
    event=await current(event.id);assert.equal(event.state.completed,true);assert.equal(matches,count-1);
    assert.equal(event.state.fixtures!.filter(fixture=>fixture.status==='bye').length,count===15?1:0);
    const states=(await owner.query<{state:{players:{id:string}[];game:{visits:{player:string}[]};confirmations:boolean[];resultPublished:boolean;status:string}}>('select state from dartflow_private.matches where event_id=$1',[event.state.eventId])).rows.map(row=>row.state);
    assert.equal(states.length,count-1);assert.ok(states.every(state=>state.status==='confirmed'&&state.resultPublished&&state.confirmations.every(Boolean)&&state.game.visits.length>0));
    assert.deepEqual(new Set(states.flatMap(state=>state.players.map(player=>player.id))),new Set(players),'every counted starter actually threw in a sporting completed match');
    assert.deepEqual(new Set(states.flatMap(state=>state.game.visits.map(visit=>visit.player))),new Set(players),'the stored actual dart visits, rather than only assigned participant identities, prove each first throw');
    const finalizeId=randomUUID(),action={type:'event.finalize',entityId:event.id},receipt=await ranking(host,action,finalizeId);
    const ledger=(await owner.query<{source_id:string;data:{players:string[];starters:number;place:number;points:number;played:boolean;eligible:boolean};revision:number;verdict:string}>(`select s.id source_id,r.data,r.revision,r.verdict from dartflow_private.ranking_sources s join dartflow_private.ranking_source_revisions r on r.source_id=s.id where s.list_id=$1 and s.entity_id=$2 order by(r.data->>'place')::int,s.id`,[NATIONAL_CIRCUIT_ID,event.id])).rows;
    assert.equal(ledger.length,count);assert.ok(ledger.every(row=>row.revision===1&&row.verdict==='valid'&&row.data.starters===count&&row.data.played&&row.data.eligible));
    assert.deepEqual(new Set(ledger.flatMap(row=>row.data.players)),new Set(players));
    const expected:Record<number,number>=count===15?{1:0,2:0,3:0,5:0,9:0}:{1:15,2:10,3:7,5:5,9:3,17:1};
    for(const row of ledger){
     assert.equal(row.data.points,expected[row.data.place],`published national band for place ${row.data.place} at field ${count}`);
     const view=await getRankings(row.data.players[0],{listId:NATIONAL_CIRCUIT_ID}),booking=view.history.find(entry=>entry.entityId===event.id)!;
     assert.equal(booking.sourceId,row.source_id);assert.equal(booking.points,row.data.points);assert.equal(booking.place,row.data.place);assert.equal(view.me!.points,row.data.points);
    }
    if(count===15)assert.equal(ledger.reduce((total,row)=>total+row.data.points,0),0,'seventeen registrations with only fifteen starters cannot cross the national minimum');
    else{
     assert.deepEqual(ledger.map(row=>row.data.place),[1,2,3,3,...Array(4).fill(5),...Array(8).fill(9),...Array(16).fill(17)]);
     assert.equal(ledger.reduce((total,row)=>total+row.data.points,0),99);
    }
    const before=await getRankings(players[0],{listId:NATIONAL_CIRCUIT_ID}),generation=before.generation!.id;
    assert.deepEqual(await ranking(host,action,finalizeId),receipt);await ranking(host,action);
    const after=await getRankings(players[0],{listId:NATIONAL_CIRCUIT_ID});assert.equal(after.generation!.id,generation);assert.deepEqual(after.history,before.history);assert.deepEqual(after.me,before.me);
    assert.equal((await owner.query('select 1 from dartflow_private.ranking_generation_bookings where generation_id=$1 and source_id=any($2::uuid[])',[generation,ledger.map(row=>row.source_id)])).rowCount,count);
    assert.equal((await owner.query('select 1 from dartflow_private.ranking_sources where list_id=$1 and entity_id=$2',[NATIONAL_CIRCUIT_ID,event.id])).rowCount,count);
   });
  }
 }finally{try{
  await beginFixtureCleanup(owner,people);
  const matchIds=(await owner.query<{id:string}>('select id from dartflow_private.matches where event_id=any($1::uuid[])',[events])).rows.map(row=>row.id);
  for(const table of['mail_outbox','mail_events'])await owner.query(`delete from dartflow_private.${table} where recipient_key=any($1::text[])`,[people.map(id=>`user:${id}`)]);
  for(const table of['player_match_kickoffs','match_results','match_confirmations','action_receipts','visits','match_players','platform_match_links'])await owner.query(`delete from dartflow_private.${table} where match_id=any($1::uuid[])`,[matchIds]);
  await owner.query('delete from dartflow_private.board_activity_sessions where event_id=any($1::uuid[])',[events]);await owner.query('delete from dartflow_private.audit_events where event_id=any($1::uuid[])',[events]);await owner.query('delete from dartflow_private.matches where event_id=any($1::uuid[])',[events]);
  await owner.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.platform_entities where id=any($1::uuid[])',[entities]);
  for(const table of['standings','entries','boards','event_staff'])await owner.query(`delete from dartflow_private.${table} where event_id=any($1::uuid[])`,[events]);await owner.query('delete from dartflow_private.events where id=any($1::uuid[])',[events]);await owner.query('delete from dartflow_private.club_memberships where club_id=$1',[club]);await owner.query('delete from dartflow_private.clubs where id=$1',[club]);await owner.query('delete from dartflow_private.platform_roles where user_id=any($1::uuid[])',[people]);await owner.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);await owner.query('commit');
 }finally{await owner.end();await closeDatabase();}}
});
