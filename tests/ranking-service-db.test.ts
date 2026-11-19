import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {closeDatabase,executeMatchCommand,getMatch} from '../lib/db';
import {executePlatformCommand,getPlatformOverview,reconcilePlatformResults} from '../lib/platform';
import {executeRankingServiceCommand,getEventRankingDetails} from '../lib/ranking-service';
import {getRankings} from '../lib/rankings';
import {NATIONAL_RATING_ID,NATIONAL_CIRCUIT_ID} from '../lib/ranking-generations';
import type {PlatformCommand,PlatformEntity} from '../lib/platform-types';
import type {MatchAction,MatchView} from '../lib/types';
import {dartValue}from'../lib/x01-rules';
import{executeMatchCorrectionCommand,getMatchCorrections}from'../lib/match-corrections';
import type{MatchCorrectionCommand}from'../lib/match-corrections-types';

try{process.loadEnvFile('.env.local');}catch{/* CI supplies loopback. */}
const loopback=(value?:string)=>{try{return !!value&&['127.0.0.1','localhost','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);
test('four official destinations use one sport source, immutable admission and atomic correction generations',{skip:!configured},async t=>{
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();
 const people=Array.from({length:20},()=>randomUUID()),host=people[0],a=people[1],b=people[2],c=people[3],guest=people[18],outsider=people[19],club=randomUUID(),otherClub=randomUUID(),suffix=randomUUID().slice(0,8);
 const entities:string[]=[],events:string[]=[],matches:string[]=[],lists:string[]=[],syntheticClubs:string[]=[];
 const platform=(actor:string,action:PlatformCommand['action'])=>executePlatformCommand(actor,{requestId:randomUUID(),action});
 const ranking=(actor:string,action:{type:string;[key:string]:unknown},requestId=randomUUID())=>executeRankingServiceCommand(actor,{requestId,action});
 const act=(view:MatchView,actor:string,action:MatchAction)=>executeMatchCommand(actor,{matchId:view.id,requestId:randomUUID(),expectedRevision:view.revision,action});
 const correct=(actor:string,action:MatchCorrectionCommand['action'],requestId:string=randomUUID())=>executeMatchCorrectionCommand(actor,{requestId,action});
 async function makeEvent(participants:string[],format='knockout',personal=false,settings:Record<string,unknown>={}):Promise<PlatformEntity>{
  const made=await platform(host,{type:'tournament.create',name:`Ranking event ${suffix}`,clubId:personal?null:club,ownership:personal?'personal':'club',visibility:'public',eligibility:'all',format,capacity:32,boards:1,requireWriter:false,...settings});
  const event=made.entity!;entities.push(event.id,String(event.state.roomId));events.push(event.state.eventId!);
  if(personal)syntheticClubs.push(event.state.coreClubId!);
  for(const player of participants){await platform(player,{type:'competition.register',id:event.id});await platform(host,{type:'competition.checkin',id:event.id,userId:player});}
  return (await platform(host,{type:'competition.plan',id:event.id})).entity!;
 }
 async function declare(event:PlatformEntity,listId:string,approve=true,rules?:unknown):Promise<string>{
  const request=await ranking(host,{type:'event.request',entityId:event.id,listId,...(rules?{rules}:{})});
  if(approve)await ranking(host,{type:'event.approve',declarationId:request.id,decision:'approve',reason:'Gepubliceerd sportreglement en organisator gecontroleerd.'});
  return request.id;
 }
 async function accept(event:PlatformEntity,participants:string[]){for(const player of participants)await ranking(player,{type:'event.accept',entityId:event.id});}
 async function start(event:PlatformEntity,fixtureId=event.state.fixtures![0].id):Promise<MatchView>{
  const made=await platform(host,{type:'fixture.start',id:event.id,fixtureId});matches.push(made.matchId!);let view=await getMatch(host,made.matchId!);
  for(const player of view.players)view=await act(view,player.id,{type:'accept'});
  return view;
 }
 async function finish(view:MatchView,winner:string=a):Promise<MatchView>{
  if(view.status==='ready')view=await act(view,view.players[0].id,{type:'start'});let guard=0;
  while(view.status==='live'){
   if(view.settings.discipline==='cricket'){
    assert.ok(guard++<100);const hits:string[]=[];
    if(view.players[view.turn].id!==winner)hits.push('MISS','MISS','MISS');else{
     const marks=[...view.cricket!.marks[view.turn]],targets=[20,19,18,17,16,15,25];
     while(hits.length<3){const index=marks.findIndex(value=>value<3);if(index<0)break;const need=3-marks[index],target=targets[index],count=target===25?Math.min(2,need):need;hits.push(target===25?(count===2?'DB':'SB'):`${count===3?'T':count===2?'D':'S'}${target}`);marks[index]+=count;}
    }
    view=await act(view,view.writerId,{type:'score',score:hits.reduce((sum,hit)=>sum+dartValue(hit),0),darts:hits.length,dartHits:hits});continue;
   }
   assert.ok(guard++<100);const current=view.remaining[view.turn],score=view.players[view.turn].id===winner?Math.min(180,current):0;
   view=await act(view,view.writerId,{type:'score',score,darts:3,doubleConfirmed:score>0&&score===current});
  }
  for(const player of view.players)view=await act(view,player.id,{type:'confirm'});
  await reconcilePlatformResults();return view;
 }
 try{
  for(const[index,id]of people.entries()){
   await admin.query('insert into dartflow_private.profiles(id,name,display_name,display_name_confirmed)values($1,$2,$3,true)',[id,`official_${suffix}_${index}`,`Official ${index} ${suffix}`]);
   await admin.query("insert into dartflow_private.player_safety_acceptances(user_id,version,age_confirmed)values($1,'2026-11-18',true)",[id]);
  }
  await admin.query("insert into dartflow_private.platform_roles(user_id,role)values($1,'admin')",[host]);
  for(const id of[club,otherClub])await admin.query("insert into dartflow_private.clubs(id,name)values($1,'Official ranking integration club')",[id]);
  for(const player of people.slice(0,18))await admin.query('insert into dartflow_private.club_memberships(club_id,user_id,role)values($1,$2,$3)',[club,player,player===host?'organizer':'player']);
  await admin.query("insert into dartflow_private.club_memberships(club_id,user_id,role)values($1,$2,'organizer')",[otherClub,outsider]);
  const clubRating=(await ranking(host,{type:'list.create',clubId:club,kind:'rating',name:'Official club rating'})).id;lists.push(clubRating);
  const clubCircuit=(await ranking(host,{type:'list.create',clubId:club,kind:'circuit',name:'Official club circuit',policy:{minimumStarters:2}})).id;lists.push(clubCircuit);
  let first:PlatformEntity,firstMatch:MatchView;
  await t.test('club authority is scoped, personal sources stay excluded, declaration conflicts block publication',async()=>{
   await assert.rejects(ranking(outsider,{type:'list.create',clubId:club,kind:'rating',name:'Wrong club'}),{code:'forbidden'});
   const personal=await makeEvent([a,b],'knockout',true);
   await assert.rejects(declare(personal,NATIONAL_RATING_ID),{code:'ranking_personal_forbidden'});
   first=await makeEvent([a,b]);
   await assert.rejects(declare(first,NATIONAL_RATING_ID,true,[{enabled:true},{enabled:false}]),{code:'ranking_rule_conflict'});
   const pending=await declare(first,NATIONAL_RATING_ID,false);
   await assert.rejects(ranking(outsider,{type:'event.approve',declarationId:pending,decision:'approve',reason:'Wrong authority'}),{code:'forbidden'});
   await ranking(host,{type:'event.approve',declarationId:pending,decision:'approve',reason:'Landelijke toelating expliciet bevestigd.'});
   for(const id of[NATIONAL_CIRCUIT_ID,clubRating,clubCircuit])await declare(first,id);
   await assert.rejects(ranking(host,{type:'list.policy',listId:clubRating,policy:{k:16}}),{code:'ranking_policy_locked'});
   await assert.rejects(platform(host,{type:'competition.settings',id:first.id,eligibility:'code'}),{code:'ranking_event_rules_locked'});
   assert.equal((await getEventRankingDetails(a,first.id)).declarations.length,4);
   firstMatch=await start(first);
   await assert.rejects(act(firstMatch,a,{type:'start'}),{code:'ranking_event_confirmation_required'});
   await accept(first,[a,b]);
   const before=await getRankings(a,{listId:clubRating});assert.equal(before.me?.rating,1500);
   firstMatch=await finish(firstMatch);
  });
  await t.test('one confirmed source books both ratings and both circuits without invented fieldsize points',async()=>{
   for(const id of[NATIONAL_RATING_ID,clubRating])assert.equal((await getRankings(a,{listId:id})).me?.rating,1516);
   assert.equal((await getRankings(a,{listId:NATIONAL_CIRCUIT_ID})).me?.rating,0);
   await ranking(host,{type:'event.finalize',entityId:first!.id});
   const national=await getRankings(a,{listId:NATIONAL_CIRCUIT_ID}),local=await getRankings(a,{listId:clubCircuit});
   assert.equal(national.me?.points,0);assert.equal(local.me?.points,10);assert.equal(local.me?.position,1);
   assert.equal((await getRankings(b,{listId:clubCircuit})).me?.points,7);
   const generation=local.generation?.id;await ranking(host,{type:'event.finalize',entityId:first!.id});assert.equal((await getRankings(a,{listId:clubCircuit})).generation?.id,generation);
   assert.equal((await admin.query('select count(*)::int n from dartflow_private.ranking_sources where match_id=$1',[firstMatch!.id])).rows[0].n,2);
   assert.equal((await admin.query('select 1 from dartflow_private.ranking_reservations where match_id=$1',[firstMatch!.id])).rowCount,0);
   assert.equal((await getRankings(a,{listId:NATIONAL_RATING_ID})).managementSources?.length,0);
   await assert.rejects(getRankings(outsider,{listId:clubRating}),{code:'forbidden'});
   await assert.rejects(declare(first!,clubRating),{code:'ranking_event_started'});
  });
  await t.test('a correction atomically replays later opponents, retains the old generation and enforces independent review/revisions',async()=>{
   const second=await makeEvent([a,c]);await declare(second,NATIONAL_RATING_ID);await accept(second,[a,c]);await finish(await start(second));
   const prior=await getRankings(host),source=prior.managementSources!.find(row=>row.matchId===firstMatch!.id)!;
   const beforeA=(await getRankings(a)).me!.rating,beforeC=(await getRankings(c)).me!.rating;
   assert.ok(beforeA>1516&&beforeC>1484&&beforeC<1500);
   const requestId=randomUUID(),command={type:'source.decide',sourceId:source.id,expectedRevision:source.revision,decision:'void',reason:'Onafhankelijk vastgestelde ongeldige sportbron.'};
   const decision=await ranking(host,command,requestId);assert.deepEqual(await ranking(host,command,requestId),decision);
   assert.equal((await getRankings(a)).me?.rating,1516);assert.equal((await getRankings(c)).me?.rating,1484);assert.equal((await getRankings(b)).me?.rating,1500);
   assert.equal((await getRankings(a,{listId:clubRating})).me?.rating,1516,'separate club destination keeps its independently admitted source');
   assert.notEqual(decision.generation,prior.generation?.id);
   const old=(await admin.query<{rating:number}>('select rating from dartflow_private.ranking_generation_accounts where generation_id=$1 and player_id=$2',[prior.generation?.id,a])).rows[0];assert.equal(old.rating,beforeA);
   await assert.rejects(ranking(host,{...command,decision:'restore'}),{code:'revision_conflict'});
   await admin.query("insert into dartflow_private.platform_roles(user_id,role)values($1,'admin')",[a]);
   await assert.rejects(ranking(a,{...command,expectedRevision:source.revision+1,decision:'restore'}),{code:'ranking_independent_review_required'});
   await admin.query('delete from dartflow_private.platform_roles where user_id=$1',[a]);
   await ranking(host,{...command,expectedRevision:source.revision+1,decision:'restore'});
   assert.equal((await getRankings(a)).me?.rating,beforeA);assert.equal((await getRankings(c)).me?.rating,beforeC);
  });
  await t.test('best five selection is rebuilt from six real events and official rematches do not use the free cap',async()=>{
   for(let i=0;i<5;i++){const event=await makeEvent([a,b]);await declare(event,clubCircuit);await accept(event,[a,b]);await finish(await start(event));await ranking(host,{type:'event.finalize',entityId:event.id});}
   const result=await getRankings(a,{listId:clubCircuit});assert.equal(result.me?.played,6);assert.equal(result.me?.points,50);assert.equal(result.me?.results?.filter(row=>row.counting).length,5);
   const independent=await getRankings(host,{listId:clubCircuit}),source=independent.managementSources!.find(row=>row.entityId===first!.id&&row.playersNames.includes(`Official 1 ${suffix}`))!;
   await ranking(host,{type:'source.decide',sourceId:source.id,expectedRevision:source.revision,decision:'void',reason:'Circuitbron herzien zonder andere eindplaatsen op te schuiven.'});
   const after=await getRankings(a,{listId:clubCircuit});assert.equal(after.me?.points,50);assert.equal(after.me?.played,5);assert.equal(after.me?.results?.filter(row=>row.counting).length,5);
   assert.equal((await getRankings(b,{listId:clubCircuit})).me?.points,35);
  });
  await t.test('guest winners keep their real placing while club members keep their actual lower place',async()=>{
   const event=await makeEvent([a,guest]);await declare(event,clubCircuit);await accept(event,[a,guest]);await finish(await start(event),guest);await ranking(host,{type:'event.finalize',entityId:event.id});
   const member=await getRankings(a,{listId:clubCircuit});assert.equal(member.history[0].place,2);assert.equal(member.history[0].points,7);
   assert.equal((await admin.query<{n:number}>(`select count(*)::int n from dartflow_private.ranking_generation_accounts g join dartflow_private.ranking_lists l on l.active_generation=g.generation_id where l.id=$1 and g.player_id=$2`,[clubCircuit,guest])).rows[0].n,0);
  });
  await t.test('a complete sixteen-starter event crosses the real national field threshold exactly once',async()=>{
   let event=await makeEvent(people.slice(1,17));await declare(event,NATIONAL_CIRCUIT_ID);await accept(event,people.slice(1,17));
   let completed=0;
   for(;;){
    event=(await getPlatformOverview(host)).tournaments.find(item=>item.id===event.id)!;
    const fixture=event.state.fixtures!.find(item=>item.status==='scheduled'&&item.players.every(Boolean));if(!fixture)break;
    assert.ok(completed++<16);const winner=fixture.players.includes(a)?a:fixture.players[0]!;await finish(await start(event,fixture.id),winner);
   }
   assert.equal(completed,15);await ranking(host,{type:'event.finalize',entityId:event.id});
   const rows=await getRankings(a,{listId:NATIONAL_CIRCUIT_ID});assert.equal(rows.me?.points,10);assert.equal(rows.me?.position,1);
   const sources=await admin.query<{n:number;minimum:number;maximum:number}>("select count(*)::int n,min((r.data->>'starters')::int)as minimum,max((r.data->>'starters')::int)as maximum from dartflow_private.ranking_sources s join dartflow_private.ranking_source_revisions r on r.source_id=s.id and r.revision=1 where s.entity_id=$1 and s.list_id=$2",[event.id,NATIONAL_CIRCUIT_ID]);
   assert.deepEqual(sources.rows[0],{n:16,minimum:16,maximum:16});
  });
  await t.test('Swiss and both double-elimination final variants publish real completed event circuit places',async()=>{
   for(const format of['double-elimination-reset','double-elimination-single','swiss']){
    let event=await makeEvent([a,b,c,people[4]],format);const list=(await ranking(host,{type:'list.create',clubId:club,kind:'circuit',name:format,policy:{minimumStarters:2}})).id;lists.push(list);await declare(event,list);await accept(event,[a,b,c,people[4]]);
    let count=0;
    for(;;){
     event=(await getPlatformOverview(host)).tournaments.find(item=>item.id===event.id)!;
     const fixture=event.state.fixtures!.find(item=>item.status==='scheduled'&&item.players.every(Boolean));
     if(!fixture){
      if(format==='swiss'&&Math.max(...event.state.fixtures!.map(item=>item.round))<event.state.tournamentRules!.swissRounds!){await platform(host,{type:'competition.next-round',id:event.id});continue;}
      break;
     }
     assert.ok(count++<12);const winner=format==='double-elimination-reset'&&fixture.phase==='final'?fixture.players[1]!:fixture.players.includes(a)?a:fixture.players[0]!;
     await finish(await start(event,fixture.id),winner);
    }
    assert.ok(count>=4);await ranking(host,{type:'event.finalize',entityId:event.id});const result=await getRankings(a,{listId:list});assert.equal(result.me?.points,10);assert.equal(result.me?.position,1);
   }
  });
  await t.test('Cricket club rating books its actual marks game without changing any X01 destination',async()=>{
   const id=(await ranking(host,{type:'list.create',clubId:club,kind:'rating',name:'Afzonderlijke Cricket-reeks',policy:{discipline:'cricket',cricketMode:'standard'}})).id;lists.push(id);
   const event=await makeEvent([a,b],'knockout',false,{discipline:'cricket',cricketMode:'standard'});
   await assert.rejects(declare(event,NATIONAL_RATING_ID),{code:'ranking_discipline_ineligible'});await declare(event,id);await accept(event,[a,b]);
   const before=(await getRankings(a)).me!.rating;const result=await finish(await start(event));assert.equal(result.settings.discipline,'cricket');assert.equal(result.cricket?.marks.some(side=>side.every(value=>value===3)),true);
   assert.equal((await getRankings(a,{listId:id})).me?.rating,1516);assert.equal((await getRankings(a)).me?.rating,before);
   const different=await makeEvent([a,b],'knockout',false,{discipline:'cricket',cricketMode:'no-score'});await assert.rejects(declare(different,id),{code:'ranking_format_ineligible'});
  });
  await t.test('an independent primary correction withdraws all destinations, preserves proof and replays the changed actual winner',async()=>{
   const ratingId=(await ranking(host,{type:'list.create',clubId:club,kind:'rating',name:'Primary correction rating'})).id,circuitId=(await ranking(host,{type:'list.create',clubId:club,kind:'circuit',name:'Primary correction circuit',policy:{minimumStarters:2}})).id;lists.push(ratingId,circuitId);
   const event=await makeEvent([a,b]);for(const id of[NATIONAL_RATING_ID,NATIONAL_CIRCUIT_ID,ratingId,circuitId])await declare(event,id);await accept(event,[a,b]);
   const original=await finish(await start(event));await ranking(host,{type:'event.finalize',entityId:event.id});assert.equal((await getRankings(a,{listId:ratingId})).me?.rating,1516);assert.equal((await getRankings(a,{listId:circuitId})).me?.points,10);
   const current=await getMatch(a,original.id),before=(await getRankings(a)).me!.rating;assert.equal((await getMatchCorrections(a,current.id)).canRequest,true);
   const requestId=randomUUID(),command={type:'correction.request' as const,matchId:current.id,expectedRevision:current.revision,undoCount:1,reason:'De werkelijk gegooide laatste finish is onjuist ingevoerd.'},request=await correct(a,command,requestId);assert.deepEqual(await correct(a,command,requestId),request);
   await assert.rejects(getMatchCorrections(outsider,current.id),{code:'forbidden'});await assert.rejects(correct(a,{type:'correction.decide',correctionId:request.id,decision:'approve',reason:'Eigen uitslag.'}),{code:'independent_correction_review_required'});
   await correct(current.players.find(p=>p.id!==a)!.id,{type:'correction.respond',correctionId:request.id,reason:'Reactie van de tegenpartij op de aangewezen worp.'});
   const decisionId=randomUUID(),decision={type:'correction.decide' as const,correctionId:request.id,decision:'approve' as const,reason:'Beide spelers en de schrijver zijn gehoord; herstel uitsluitend de laatste werkelijke beurt.'};await correct(host,decision,decisionId);assert.deepEqual(await correct(host,decision,decisionId),{ok:true,id:request.id,matchId:current.id,status:'approved'});
   let resumed=await getMatch(a,current.id);assert.equal(resumed.status,'live');assert.equal(resumed.boardId,null);assert.equal(resumed.resultPublished,false);assert.deepEqual(resumed.confirmations,[false,false]);assert.equal(resumed.visits.length,current.visits.length-1);
   assert.equal((await getRankings(a,{listId:ratingId})).me?.rating,1500);assert.equal((await getRankings(a,{listId:circuitId})).me?.points,0);assert.ok((await getRankings(a)).me!.rating<before);
   assert.equal((await admin.query('select 1 from dartflow_private.match_results where match_id=$1',[current.id])).rowCount,0);assert.equal((await admin.query('select 1 from dartflow_private.match_result_versions where match_id=$1 and result_revision=$2',[current.id,current.resultRevision])).rowCount,1);
   await assert.rejects(ranking(host,{type:'event.finalize',entityId:event.id}),{code:'primary_correction_dependency_hold'});
   resumed=await finish(resumed,b);assert.equal(resumed.winnerId,b);assert.notEqual(resumed.resultRevision,current.resultRevision);
   assert.equal((await getRankings(a,{listId:ratingId})).me?.rating,1484);assert.equal((await getRankings(b,{listId:ratingId})).me?.rating,1516);assert.equal((await getRankings(a,{listId:circuitId})).me?.points,0);
   assert.equal((await admin.query('select 1 from dartflow_private.match_result_versions where match_id=$1',[current.id])).rowCount,2);assert.equal((await admin.query('select 1 from dartflow_private.match_results where match_id=$1 and result_revision=$2',[current.id,resumed.resultRevision])).rowCount,1);
   await assert.rejects(ranking(host,{type:'event.finalize',entityId:event.id}),{code:'ranking_circuit_recertification_required'});
   for(const listId of[NATIONAL_CIRCUIT_ID,circuitId])await ranking(host,{type:'event.recertify',entityId:event.id,listId,reason:'Gewijzigde werkelijke eindstand en bronhandtekeningen onafhankelijk gecontroleerd.'});
   const corrected=await getRankings(b,{listId:circuitId});assert.equal(corrected.me?.points,10);assert.equal((await getRankings(a,{listId:circuitId})).me?.points,7);
   await ranking(host,{type:'event.recertify',entityId:event.id,listId:circuitId,reason:'Dezelfde beoordeelde definitieve bron.'});assert.equal((await getRankings(b,{listId:circuitId})).generation?.id,corrected.generation?.id,'same recertification cannot duplicate source revisions');
  });
  await t.test('a played dependent final is held, archived and replayed with canonical participants after independent repair',async()=>{
   let event=await makeEvent([a,b,c,people[4]]);const ratingId=(await ranking(host,{type:'list.create',clubId:club,kind:'rating',name:'Dependent final rating'})).id,circuitId=(await ranking(host,{type:'list.create',clubId:club,kind:'circuit',name:'Dependent final circuit',policy:{minimumStarters:2}})).id;lists.push(ratingId,circuitId);
   const firstRound=event.state.fixtures!.filter(fixture=>fixture.round===1),oldFinal=event.state.fixtures!.at(-1)!;
   await declare(event,ratingId,true,[{enabled:false},{fixtureId:oldFinal.id,enabled:true}]);await declare(event,circuitId);await accept(event,[a,b,c,people[4]]);
   const semi=await finish(await start(event,firstRound[0].id),firstRound[0].players[0]!);await finish(await start(event,firstRound[1].id),firstRound[1].players[0]!);
   event=(await getPlatformOverview(host)).tournaments.find(row=>row.id===event.id)!;const final=event.state.fixtures!.find(row=>row.id===oldFinal.id)!;const oldPlayed=await finish(await start(event,final.id),semi.winnerId!);await ranking(host,{type:'event.finalize',entityId:event.id});
   const source=await getMatch(semi.players[0].id,semi.id),request=await correct(source.players[0].id,{type:'correction.request',matchId:source.id,expectedRevision:source.revision,undoCount:1,reason:'De finish in de halve finale klopt niet met de werkelijke worp.'});await correct(source.players[1].id,{type:'correction.respond',correctionId:request.id,reason:'Reactie tegenpartij vóór onafhankelijke behandeling.'});await correct(host,{type:'correction.decide',correctionId:request.id,decision:'approve',reason:'De bron en alle afhankelijkheden moeten gecontroleerd hersteld worden.'});
   const held=await getMatchCorrections(host,source.id);assert.deepEqual(held.dependencyHold?.downstreamFixtureIds,[final.id]);assert.equal((await getMatch(host,oldPlayed.id)).status,'disputed');assert.equal((await admin.query('select 1 from dartflow_private.match_results where match_id=$1',[oldPlayed.id])).rowCount,0);assert.equal((await admin.query('select 1 from dartflow_private.match_result_versions where match_id=$1',[oldPlayed.id])).rowCount,1);
   await assert.rejects(platform(host,{type:'fixture.start',id:event.id,fixtureId:final.id}),{code:'primary_correction_dependency_hold'});await assert.rejects(correct(host,{type:'correction.repair',correctionId:request.id,reason:'Te vroeg herstellen.'}),{code:'correction_source_unconfirmed'});
   const newWinner=source.players.find(player=>player.id!==source.winnerId)!.id;await finish(await getMatch(host,source.id),newWinner);assert.equal((await getMatchCorrections(host,source.id)).requests[0].canRepair,true);
   await correct(host,{type:'correction.repair',correctionId:request.id,reason:'De oude finale is ongeldig door gewijzigde plaatsing; speel de canonieke nieuwe finale opnieuw.'});event=(await getPlatformOverview(host)).tournaments.find(row=>row.id===event.id)!;
   const nextFinal=event.state.fixtures!.at(-1)!;assert.notEqual(nextFinal.id,final.id);assert.equal(nextFinal.matchId,undefined);assert.equal(nextFinal.players.includes(newWinner),true);assert.equal(nextFinal.players.includes(source.winnerId!),false);assert.equal((await getMatch(host,oldPlayed.id)).status,'abandoned');assert.equal((await getMatchCorrections(host,source.id)).dependencyHold,null);
   const result=await finish(await start(event,nextFinal.id),newWinner);assert.equal((await admin.query('select eligible from dartflow_private.ranking_match_admissions a join dartflow_private.ranking_event_declarations d on d.id=a.declaration_id where a.match_id=$1 and d.list_id=$2',[result.id,ratingId])).rows[0].eligible,true,'the immutable published slot rule follows its approved repaired slot');
   await ranking(host,{type:'event.recertify',entityId:event.id,listId:circuitId,reason:'Nieuwe eindstand volgt de opnieuw werkelijk gespeelde finale en twee handtekeningen.'});assert.equal((await getRankings(newWinner,{listId:circuitId})).me?.points,10);assert.equal((await admin.query('select 1 from dartflow_private.match_correction_repairs where request_id=$1',[request.id])).rowCount,1);
  });
  await t.test('a separate real consolation title preserves main circuit places and does not inherit broad match rating admission',async()=>{
   let event=await makeEvent([a,b,c,people[4]],'knockout',false,{consolation:true,consolationTitle:'Afzonderlijke clubtroosttitel'});const ratingId=(await ranking(host,{type:'list.create',clubId:club,kind:'rating',name:'Main rating without inherited consolation'})).id,circuitId=(await ranking(host,{type:'list.create',clubId:club,kind:'circuit',name:'Main circuit without consolation bonus',policy:{minimumStarters:2}})).id;lists.push(ratingId,circuitId);await declare(event,ratingId);await declare(event,circuitId);await accept(event,[a,b,c,people[4]]);
   for(;;){event=(await getPlatformOverview(host)).tournaments.find(row=>row.id===event.id)!;const ready=event.state.fixtures!.find(f=>f.status==='scheduled'&&f.players.every(Boolean));if(!ready)break;await finish(await start(event,ready.id),ready.players[0]!);}
   event=(await getPlatformOverview(host)).tournaments.find(row=>row.id===event.id)!;assert.equal(event.state.completed,true);assert.equal(event.state.consolation?.completed,true);assert.notEqual(event.state.consolation?.championId,event.state.championId);const cup=event.state.fixtures!.find(f=>f.purpose==='consolation')!;assert.equal((await admin.query('select 1 from dartflow_private.ranking_sources where match_id=$1',[cup.matchId])).rowCount,0);assert.equal((await admin.query('select 1 from dartflow_private.ranking_sources where list_id=$1 and entity_id=$2',[ratingId,event.id])).rowCount,0);assert.equal((await admin.query('select 1 from dartflow_private.ranking_sources where list_id=$1 and match_id=any($2::uuid[])',[ratingId,event.state.fixtures!.filter(f=>!f.purpose).map(f=>f.matchId!)])).rowCount,3);
   await ranking(host,{type:'event.finalize',entityId:event.id});const titlePoints=await getRankings(event.state.consolation!.championId!,{listId:circuitId});assert.equal(titlePoints.me?.points,5,'the consolation champion retains the actual shared third main placing');const winnerPoints=await getRankings(event.state.championId as string,{listId:circuitId});assert.equal(winnerPoints.me?.points,10);await ranking(host,{type:'event.finalize',entityId:event.id});assert.equal((await getRankings(a,{listId:circuitId})).generation?.id,winnerPoints.generation?.id);
  });
  await t.test('event copies contain only empty settings and coorganizers keep one bounded current event scope',async()=>{
   const personal=await makeEvent([a,b],'knockout',true),copyCommand={type:'competition.copy',id:personal.id,name:'Nieuwe clubeditie op basis van eigen concept',ownership:'club',clubId:club,date:'2026-12-01'},requestId=randomUUID();
   const made=await executePlatformCommand(host,{requestId,action:copyCommand});const copied=made.entity!;entities.push(copied.id,String(copied.state.roomId));events.push(copied.state.eventId!);assert.notEqual(copied.id,personal.id);assert.notEqual(copied.state.eventId,personal.state.eventId);assert.equal(copied.clubId,club);assert.equal(copied.state.ownership,'club');assert.deepEqual(copied.state.fixtures,[]);assert.deepEqual(copied.state.rankingDestinations,[]);assert.equal(copied.members.filter(row=>row.attributes.registered===true).length,0);assert.equal((await admin.query('select 1 from dartflow_private.entries where event_id=$1',[copied.state.eventId])).rowCount,0);assert.equal((await getEventRankingDetails(host,copied.id)).declarations.length,0);assert.equal((await executePlatformCommand(host,{requestId,action:copyCommand})).id,copied.id);
   await assert.rejects(platform(host,{...copyCommand,clubId:otherClub}),{code:'forbidden'});await assert.rejects(platform(a,{type:'competition.coorganizer',id:personal.id,userId:a,enabled:true}),{code:'forbidden'});
   await platform(host,{type:'competition.coorganizer',id:personal.id,userId:outsider,enabled:true});const changed=await platform(outsider,{type:'competition.settings',id:personal.id,name:'Lokale medebeheerder mag deze editie beheren'});assert.equal(changed.entity?.canManage,true);assert.equal((await admin.query('select 1 from dartflow_private.platform_roles where user_id=$1',[outsider])).rowCount,0);await assert.rejects(platform(outsider,{type:'competition.coorganizer',id:personal.id,userId:c,enabled:true}),{code:'forbidden'});await assert.rejects(platform(outsider,{type:'competition.copy',id:personal.id,name:'Geen platformescalatie',ownership:'platform'}),{code:'forbidden'});
   const localCopyId=randomUUID(),localCopyAction={type:'competition.copy',id:personal.id,name:'Eigen lege persoonlijke kopie',ownership:'personal'};const local=await executePlatformCommand(outsider,{requestId:localCopyId,action:localCopyAction}),localEvent=local.entity!;entities.push(localEvent.id,String(localEvent.state.roomId));events.push(localEvent.state.eventId!);syntheticClubs.push(localEvent.state.coreClubId!);assert.deepEqual(localEvent.state.fixtures,[]);
   await platform(host,{type:'competition.coorganizer',id:personal.id,userId:outsider,enabled:false});await assert.rejects(platform(outsider,{type:'competition.settings',id:personal.id,name:'Geen oude rechten'}),{code:'forbidden'});await assert.rejects(executePlatformCommand(outsider,{requestId:localCopyId,action:localCopyAction}),{code:'forbidden'});assert.equal((await admin.query('select 1 from dartflow_private.club_memberships where club_id=$1 and user_id=$2',[personal.state.coreClubId,outsider])).rowCount,0);
   await assert.rejects(platform(host,{type:'competition.coorganizer',id:copied.id,userId:outsider,enabled:true}),{code:'forbidden'});await assert.rejects(platform(host,{type:'competition.coorganizer',id:personal.id,userId:host,enabled:false}),{code:'owner_role_locked'});
  });
  await t.test('closing a list preserves approved event promises and writes its reason to a private immutable audit',async()=>{
   const requestId=randomUUID(),reason='Nieuwe edities sluiten na de laatste gepubliceerde avond.';
   await ranking(host,{type:'list.close',listId:clubCircuit,closesAt:new Date().toISOString(),reason},requestId);
   const event=await makeEvent([a,b]);await assert.rejects(declare(event,clubCircuit),{code:'ranking_closed'});
   assert.equal((await getEventRankingDetails(host,first!.id)).declarations.find(row=>row.listId===clubCircuit)?.status,'approved');
   assert.equal((await admin.query<{reason:string}>("select detail->>'reason'as reason from dartflow_private.ranking_service_audit where actor_id=$1 and request_id=$2",[host,requestId])).rows[0].reason,reason);
  });
 }finally{
  try{
   await admin.query('delete from dartflow_private.feed_items where author_id=any($1::uuid[])',[people]);
   for(const table of['mail_outbox','mail_events'])await admin.query(`delete from dartflow_private.${table} where recipient_key=any($1::text[])`,[people.map(id=>`user:${id}`)]);
   await admin.query('delete from dartflow_private.ranking_lists where id=any($1::uuid[])',[lists]);
   const found=(await admin.query<{id:string}>('select id from dartflow_private.matches where event_id=any($1::uuid[])',[events])).rows.map(row=>row.id);matches.push(...found);
   for(const table of['player_match_kickoffs','match_results','match_confirmations','action_receipts','visits','match_players','platform_match_links'])await admin.query(`delete from dartflow_private.${table} where match_id=any($1::uuid[])`,[matches]);
   await admin.query('delete from dartflow_private.audit_events where event_id=any($1::uuid[])',[events]);await admin.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])',[people]);
   await admin.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])',[people]);
   await admin.query('delete from dartflow_private.matches where event_id=any($1::uuid[])',[events]);await admin.query('delete from dartflow_private.platform_entities where id=any($1::uuid[])',[entities]);
   for(const table of['standings','entries','boards','event_staff'])await admin.query(`delete from dartflow_private.${table} where event_id=any($1::uuid[])`,[events]);await admin.query('delete from dartflow_private.events where id=any($1::uuid[])',[events]);
   await admin.query('delete from dartflow_private.club_memberships where club_id=any($1::uuid[])',[[club,otherClub,...syntheticClubs]]);await admin.query('delete from dartflow_private.clubs where id=any($1::uuid[])',[[club,otherClub,...syntheticClubs]]);await admin.query('delete from dartflow_private.platform_roles where user_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);
  }finally{await admin.end();await closeDatabase();}
 }
});
