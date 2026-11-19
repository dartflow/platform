import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {assertAccountActive,getAccountDeletionStatus,requestAccountDeletion} from '../lib/account-removal';
import {processAccountRemovalBatch} from '../lib/account-removal-worker';
import {closeDatabase,database} from '../lib/db';
import {playerPinVerifier} from '../lib/player-pin';
import {newGame,scoreGame} from '../lib/domain';
import {ensureBoardActivity} from '../lib/board-activity';
import type {MatchState} from '../lib/types';

try{process.loadEnvFile('.env.local');}catch{/* CI supplies loopback credentials. */}
const loopback=(value:string|undefined)=>{try{return !!value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL)&&loopback(process.env.DARTFLOW_DATABASE_URL);

test('durable privacy erasure blocks access, retries Auth safely, scrubs prior names and preserves official result identity',{skip:!configured},async t=>{
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();
 const worker=new pg.Pool({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL,options:'-c role=dartflow_privacy_worker',max:2});
 const actor=randomUUID(),other=randomUUID(),club=randomUUID(),event=randomUUID(),match=randomUUID(),room=randomUUID(),post=randomUUID(),ownedClub=randomUUID(),training=randomUUID();
 const activeMatches:string[]=[],boards:string[]=[],entities:string[]=[],sessions:string[]=[],mailIds:string[]=[];const invite=randomUUID(),joinRequest=randomUUID(),fixtureEntity=randomUUID(),mailEnvironment=`synthetic-${randomUUID()}`;
 const name=`Privacy-${randomUUID().slice(0,8)}`,displayName='Ann',address=`${actor}@example.invalid`;
 try{
  for(const[id,label]of [[actor,name],[other,`Other-${randomUUID().slice(0,8)}`]])await admin.query('insert into dartflow_private.profiles(id,name,display_name,email,display_name_confirmed)values($1,$2,$3,$4,true)',[id,label,displayName,id===actor?address:null]);
  await admin.query('insert into dartflow_private.clubs(id,name)values($1,$2)',[club,'Synthetic privacy club']);
  await admin.query('insert into dartflow_private.events(id,club_id,name,date,capacity)values($1,$2,$3,current_date,8)',[event,club,'Synthetic official result']);
  const snapshot={id:match,players:[{id:actor,name:'Historical previous display name',email:address},{id:other,name:'Ann',displayName:'Anna'}],title:'Annual club event',legs:[3,1],winnerId:actor};
  await admin.query('insert into dartflow_private.matches(id,club_id,event_id,revision,state)values($1,$2,$3,1,$4)',[match,club,event,JSON.stringify({...snapshot,status:'confirmed',resultPublished:true})]);
  for(const[id,index]of [[actor,0],[other,1]])await admin.query('insert into dartflow_private.match_players(match_id,user_id,position)values($1,$2,$3)',[match,id,index]);
  await admin.query('insert into dartflow_private.match_results(match_id,event_id,result_revision,snapshot)values($1,$2,1,$3)',[match,event,JSON.stringify(snapshot)]);
  await admin.query('insert into dartflow_private.club_invites(id,club_id,user_id,invited_by)values($1,$2,$3,$4)',[invite,club,other,actor]);
  await admin.query('insert into dartflow_private.club_intake_versions(club_id,version)values($1,1)',[club]);
  await admin.query("insert into dartflow_private.club_join_requests(id,club_id,user_id,version,kind)values($1,$2,$3,1,'open')",[joinRequest,club,actor]);
  await admin.query("insert into dartflow_private.platform_entities(id,kind,owner_id,visibility,state)values($1,'league',$2,'private',$3)",[fixtureEntity,other,JSON.stringify({name:'Annual club event',fixtures:[{id:'fixture-one',players:[actor,other]}]})]);entities.push(fixtureEntity);
  for(const[source,eventId,body]of [[match,`match:${match}:synthetic:result-confirmed`,'Historical previous display name versus Ann'],[club,`club-invite:${invite}`,'Ann invited you'],[club,`unrelated:${randomUUID()}`,'Annual event for Ann and Anna'],[club,`club-request:${joinRequest}:reviewers`,'Ann asked to join'],[fixtureEntity,`reminder:fixture:${fixtureEntity}:fixture-one:synthetic`,'Your opponent is Ann']]){
   const id=randomUUID();mailIds.push(id);
   await admin.query("insert into dartflow_private.mail_outbox(id,environment,scope_key,event_id,template_id,recipient_key,recipient_id,kind,status,snapshot,template_version,transport_key,entity_id)values($1,'staging','platform',$2,'result-confirmed',$3,$4,'event','sent',$5,'1',$6,$7)",[id,eventId,`user:${other}`,other,JSON.stringify({subject:body,html:`<p>${body}</p>`,text:body,...(source===fixtureEntity?{reminder:{fixtureId:'fixture-one',at:'synthetic'}}:{}),replyTo:address,from:{name:'Other account',address:'other@example.invalid'}}),`synthetic/${id}`,source]);
   await admin.query("insert into dartflow_private.mail_provider_events(environment,provider_event_id,provider_message_id,event_type,occurred_at,job_id)values('staging',$1,$2,'delivered',clock_timestamp(),$3)",[`synthetic-${id}`,`message-${id}`,id]);
   await admin.query("insert into dartflow_private.mail_events(environment,scope_key,event_id,template_id,recipient_key,payload_hash)values('staging','platform',$1,'result-confirmed',$2,'synthetic-no-content')",[eventId,`user:${other}`]);
  }
  await admin.query("insert into dartflow_private.mail_policies(environment,scope_key,settings,updated_by)values($1,'platform',$2,$3)",[mailEnvironment,JSON.stringify({replyTo:address,fromName:'Ann'}),other]);
  await admin.query("insert into dartflow_private.integration_settings(environment,provider,settings)values($1,'resend',$2)",[mailEnvironment,JSON.stringify({mode:'live',replyTo:address,from:{name:'Ann',address},testRecipients:[address,'other@example.invalid']})]);
  await admin.query("insert into dartflow_private.platform_entities(id,kind,owner_id,visibility,state)values($1,'room',$2,'private',$3)",[room,other,JSON.stringify({name:'Synthetic privacy room'})]);
  await admin.query('insert into dartflow_private.platform_messages(id,room_id,author_id,body)values($1,$2,$3,$4)',[randomUUID(),room,actor,'Synthetic private message']);
  await admin.query("insert into dartflow_private.platform_relationships(source_id,target_id,kind)values($1,$2,'friend')",[actor,other]);
  await admin.query("insert into dartflow_private.community_posts(id,scope_kind,scope_id,author_id,body)values($1,'platform',$2,$3,$4)",[post,club,actor,'Synthetic post']);
  await admin.query('insert into dartflow_private.player_pin_verifiers(user_id,version,pepper_version,salt,verifier,memory,passes,parallelism)values($1,1,$2,$3,$4,19456,2,1)',[actor,'synthetic','A'.repeat(24),'B'.repeat(44)]);
  // A synthetic companion credential uses the otherwise unused production
  // fixture slot, independently of play-review.test.ts's staging fixture.
  await admin.query('insert into dartflow_private.play_review_accounts(environment,user_id,email,password_envelope,review_details,companion_user_id)values($1,$2,$3,$4,$5,$6)',[
   'production',other,'synthetic-review@example.invalid',JSON.stringify({fixture:'other-primary-credential'}),JSON.stringify({fixture:'companion-private-credential',profileId:actor}),actor]);
  await admin.query('begin');
  await admin.query("insert into dartflow_private.platform_entities(id,kind,owner_id,visibility,club_id,state)values($1,'club',$2,'club',$3,$4)",[ownedClub,actor,club,JSON.stringify({name:'Synthetic owned club'})]);
  await admin.query("insert into dartflow_private.platform_members(entity_id,user_id,role,status)values($1,$2,'owner','active')",[ownedClub,actor]);
  await admin.query('commit');
  for(const kind of ['free','official'] as const){
   const id=randomUUID(),board=randomUUID(),linked=randomUUID(),settings={startScore:301 as const,bestOfLegs:1,bestOfSets:1};
   boards.push(board);activeMatches.push(id);entities.push(linked);
   const game=scoreGame(newGame(id,[actor,other],settings),60);
   const state:MatchState={id,clubId:club,eventId:event,boardId:board,revision:0,status:'live',players:[{id:actor,name},{id:other,name:'Other synthetic player'}],writerId:actor,settings,accepted:[true,true],confirmations:[false,false],resultRevision:null,game,previousSets:[],winnerId:null,resultPublished:false,dispute:null};
   await admin.query('insert into dartflow_private.boards(id,event_id,name)values($1,$2,$3)',[board,event,`Synthetic ${kind} board`]);
   await admin.query('insert into dartflow_private.matches(id,club_id,event_id,board_id,revision,state)values($1,$2,$3,$4,0,$5)',[id,club,event,board,JSON.stringify(state)]);
   for(const[player,index]of [[actor,0],[other,1]])await admin.query('insert into dartflow_private.match_players(match_id,user_id,position)values($1,$2,$3)',[id,player,index]);
   await admin.query('insert into dartflow_private.visits(match_id,sequence,data)values($1,1,$2)',[id,JSON.stringify(game.visits[0])]);
   await admin.query('insert into dartflow_private.platform_entities(id,kind,owner_id,visibility,state)values($1,$2,$3,$4,$5)',[linked,kind==='free'?'lobby':'tournament',other,'private',JSON.stringify({name:`Synthetic ${kind}`,eventId:event,matchId:id,boardId:board})]);
   await admin.query('insert into dartflow_private.platform_match_links(match_id,entity_id,fixture_id)values($1,$2,$3)',[id,linked,'synthetic-fixture']);
   const client=await database().connect();try{await client.query('begin');const activity=await ensureBoardActivity(client,{sourceId:id,sourceKind:'match',boardIds:[board],eventId:event,kind,actorIds:[actor,other]});sessions.push(activity.sessionId);await client.query('commit');}catch(error){await client.query('rollback');throw error;}finally{client.release();}
  }
  await admin.query("insert into dartflow_private.platform_entities(id,kind,owner_id,visibility,state)values($1,'training',$2,'private','{}')",[training,actor]);
  for(const[source,position,label,ordinal]of [[match,0,'Historical animation username',0],[match,1,'Opponent animation preserved',1],[training,0,'Historical solo username',0]])await admin.query("insert into dartflow_private.board_score_events(id,board_id,source_id,revision,ordinal,kind,visit)values($1,$2,$3,1,$4,'score',$5)",[randomUUID(),boards[0],source,ordinal,JSON.stringify({playerIndex:position,playerName:label,score:60})]);

  await t.test('stable identity cleanup preserves other players with equal and substring display names and shared titles',async()=>{
   const value={players:[{id:actor,name:'Old personal label',displayName:'Ann',email:address,avatarUrl:'https://example.invalid/own.png'},{id:other,name:'Ann',displayName:'Anna',email:'other@example.invalid'}],title:'Annual club event',notes:['Ann','Anna'],actorId:actor,actorName:'Historical actor label',opponentId:other,opponentName:'Ann',author:{userId:actor,name:'Previous own name'}};
   const actual=(await admin.query('select dartflow_private.scrub_deleted_identity($1::jsonb,$2::text[],$3) value',[JSON.stringify(value),[address,name,displayName],actor])).rows[0].value;
   assert.deepEqual(actual,{...value,players:[{...value.players[0],name:'Verwijderde speler',displayName:'Verwijderde speler',email:null,avatarUrl:null},value.players[1]],actorName:'Verwijderde speler',author:{userId:actor,name:'Verwijderde speler'}});
   const again=(await admin.query('select dartflow_private.scrub_deleted_identity($1::jsonb,$2::text[],$3) value',[JSON.stringify(actual),[address,name,displayName],actor])).rows[0].value;
   assert.deepEqual(again,actual);
  });

  await t.test('normal web role cannot execute privileged erasure or read worker admin configuration',async()=>{
   await assert.rejects(database().query('select dartflow_private.erase_account_job($1,$2)',[randomUUID(),randomUUID()]),{code:'42501'});
   assert.equal((await admin.query("select has_function_privilege('dartflow_app','dartflow_private.erase_account_job(uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,false);
  });
  await t.test('isolated worker cannot browse application PII, insert jobs, change actor identity or bypass row security',async()=>{
   for(const table of ['profiles','player_pin_verifiers','play_review_accounts'])await assert.rejects(worker.query(`select * from dartflow_private.${table} limit 0`),{code:'42501'});
   await assert.rejects(worker.query('insert into dartflow_private.account_deletion_jobs(id,actor_id,request_id) select $1::uuid,$2::uuid,$3::uuid where false',[randomUUID(),actor,randomUUID()]),{code:'42501'});
   await assert.rejects(worker.query('update dartflow_private.account_deletion_jobs set actor_id=$2 where id=$1',[randomUUID(),other]),{code:'42501'});
   await assert.rejects(worker.query('delete from dartflow_private.account_deletion_jobs where id=$1',[randomUUID()]),{code:'42501'});
   await assert.rejects(database().query("update dartflow_private.account_deletion_jobs set status='completed' where id=$1",[randomUUID()]),{code:'42501'});
   const role=(await admin.query("select rolsuper,rolcreaterole,rolcreatedb,rolinherit,rolbypassrls from pg_roles where rolname='dartflow_privacy_worker'")).rows[0];
   assert.deepEqual(role,{rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolinherit:false,rolbypassrls:false});
   const routine=(await admin.query("select p.proconfig,has_function_privilege('dartflow_privacy_worker',p.oid,'EXECUTE') worker_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dartflow_private' and p.proname='erase_account_job'")).rows[0];
   assert.deepEqual(routine.proconfig,['search_path=pg_catalog, dartflow_private, pg_temp']);assert.equal(routine.worker_execute,true);
  });
  await t.test('simultaneous confirmations produce one durable operation and deny new PIN coupling immediately',async()=>{
   const id=randomUUID(),results=await Promise.all([requestAccountDeletion(actor,{requestId:id,confirmation:'VERWIJDEREN'},{recentAuth:true}),requestAccountDeletion(actor,{requestId:id,confirmation:'VERWIJDEREN'},{recentAuth:true})]);
   assert.deepEqual(results[0],results[1]);assert.equal((await getAccountDeletionStatus(actor)).status,'pending');
   await assert.rejects(assertAccountActive(actor),{code:'account_deleted'});assert.equal(await playerPinVerifier(actor),null);
   assert.equal((await admin.query('select count(*)::int n from dartflow_private.account_deletion_jobs where actor_id=$1',[actor])).rows[0].n,1);
   const pendingJob=(await admin.query('select id from dartflow_private.account_deletion_jobs where actor_id=$1',[actor])).rows[0].id;
   await assert.rejects(worker.query('select dartflow_private.erase_account_job($1,null)',[pendingJob]),{code:'42501'});
   await assert.rejects(database().query('update dartflow_private.profiles set email=$2 where id=$1',[actor,'resurrection@example.invalid']),{code:'42501'});
  });
  await t.test('confirmation immediately frees physical boards while retaining both players sporting history for anonymization',async()=>{
   assert.equal((await admin.query('select count(*)::int n from dartflow_private.board_activity_links where board_id=any($1::uuid[])',[boards])).rows[0].n,0);
   const free=(await admin.query('select state from dartflow_private.matches where id=$1',[activeMatches[0]])).rows[0].state;
   const official=(await admin.query('select state from dartflow_private.matches where id=$1',[activeMatches[1]])).rows[0].state;
   assert.equal(free.status,'interrupted');assert.equal(free.game.remaining[0],241);assert.equal(free.game.visits.length,1);assert.equal(free.game.visits[0].player,actor);assert.equal(free.boardId,null);
   assert.equal(official.status,'interrupted');assert.equal(official.game.remaining[0],241);assert.equal(official.game.visits.length,1);assert.equal(official.boardId,null);
   assert.equal((await admin.query('select count(*)::int n from dartflow_private.visits where match_id=$1',[activeMatches[0]])).rows[0].n,1);
  });
  await t.test('application erasure commits before external Auth failure and retry does not repeat erasure',async()=>{
   const failed=await processAccountRemovalBatch(worker,async()=>{throw new Error('synthetic Auth unavailable');},1);
   assert.deepEqual(failed,{processed:0,retrying:1});
   assert.equal((await admin.query('select status from dartflow_private.account_deletion_jobs where actor_id=$1',[actor])).rows[0].status,'app_erased');
   const row=(await admin.query('select * from dartflow_private.profiles where id=$1',[actor])).rows[0];assert.equal(row.email,null);assert.equal(row.name,'Verwijderde speler');assert.ok(row.deleted_at);
   for(const table of ['player_pin_verifiers','platform_relationships'])assert.equal((await admin.query(`select count(*)::int n from dartflow_private.${table} where ${table==='player_pin_verifiers'?'user_id=$1':'source_id=$1 or target_id=$1'}`,[actor])).rows[0].n,0);
   assert.equal((await admin.query('select body from dartflow_private.platform_messages where author_id=$1',[actor])).rows[0].body,'Verwijderd');
   const saved=(await admin.query('select snapshot from dartflow_private.match_results where match_id=$1',[match])).rows[0].snapshot;
   assert.equal(saved.players[0].id,actor);assert.equal(saved.players[0].name,'Verwijderde speler');assert.equal(saved.players[0].email,null);assert.deepEqual(saved.legs,[3,1]);assert.equal(saved.players[1].name,'Ann');assert.equal(saved.players[1].displayName,'Anna');assert.equal(saved.title,'Annual club event');
   assert.equal(JSON.stringify(saved).includes('Historical previous display name'),false);assert.equal(JSON.stringify(saved).includes(address),false);
   const preservedFree=(await admin.query('select state from dartflow_private.matches where id=$1',[activeMatches[0]])).rows[0].state;assert.equal(preservedFree.players[0].name,'Verwijderde speler');assert.equal(preservedFree.players[1].name,'Other synthetic player');assert.equal(preservedFree.game.remaining[0],241);assert.equal(preservedFree.game.visits.length,1);assert.equal(preservedFree.game.visits[0].player,actor);
   const remainingReview=(await admin.query("select password_envelope,review_details,companion_user_id from dartflow_private.play_review_accounts where environment='production' and user_id=$1",[other])).rows[0];
   assert.equal(remainingReview.review_details,null);assert.equal(remainingReview.companion_user_id,null);assert.deepEqual(remainingReview.password_envelope,{fixture:'other-primary-credential'});
   await admin.query('update dartflow_private.account_deletion_jobs set available_at=clock_timestamp() where actor_id=$1',[actor]);
   const seen:string[]=[];const done=await Promise.all([processAccountRemovalBatch(worker,async id=>{seen.push(id);},1),processAccountRemovalBatch(worker,async id=>{seen.push(id);},1)]);
   assert.equal(done.reduce((n,r)=>n+r.processed,0),1);assert.deepEqual(seen,[actor]);assert.equal((await getAccountDeletionStatus(actor)).status,'completed');
   await assert.rejects(assertAccountActive(actor),{code:'account_deleted'});
   assert.equal((await admin.query("select count(*)::int n from dartflow_private.platform_members where entity_id=$1 and user_id=$2 and role='owner'",[ownedClub,actor])).rows[0].n,1);
  });
  await t.test('rendered notices are removed by their stable sources while unrelated same-name notices and delivery deduplication stay intact',async()=>{
   const saved=(await admin.query('select id,snapshot from dartflow_private.mail_outbox where id=any($1::uuid[])',[mailIds])).rows;
   assert.equal(saved.length,1);assert.equal(saved[0].id,mailIds[2]);assert.equal(saved[0].snapshot.text,'Annual event for Ann and Anna');
   assert.equal(saved[0].snapshot.replyTo,null);assert.deepEqual(saved[0].snapshot.from,{name:'Other account',address:'other@example.invalid'});
   assert.deepEqual((await admin.query('select settings from dartflow_private.mail_policies where environment=$1',[mailEnvironment])).rows[0].settings,{replyTo:null,fromName:'Ann'});
   assert.deepEqual((await admin.query('select settings from dartflow_private.integration_settings where environment=$1',[mailEnvironment])).rows[0].settings,{mode:'log',replyTo:null,from:null,testRecipients:['other@example.invalid']});
   assert.equal((await admin.query('select count(*)::int n from dartflow_private.mail_provider_events where job_id=any($1::uuid[])',[mailIds])).rows[0].n,1);
   assert.equal((await admin.query('select count(*)::int n from dartflow_private.mail_events where recipient_key=$1',[`user:${other}`])).rows[0].n,5);
  });
  await t.test('historical animation names are scrubbed by stable match participant and private solo caches removed',async()=>{
   const animations=(await admin.query('select visit from dartflow_private.board_score_events where source_id=$1 order by ordinal',[match])).rows;
   assert.equal(animations.length,2);assert.equal(animations[0].visit.playerName,'Verwijderde speler');assert.equal(animations[1].visit.playerName,'Opponent animation preserved');
   assert.equal((await admin.query('select count(*)::int n from dartflow_private.board_score_events where source_id=$1',[training])).rows[0].n,0);
  });
 }finally{
  await worker.end();
  await admin.query('rollback');
  await admin.query('delete from dartflow_private.account_deletion_jobs where actor_id=$1',[actor]);
  await admin.query('delete from dartflow_private.mail_provider_events where job_id=any($1::uuid[])',[mailIds]);
  await admin.query('delete from dartflow_private.mail_outbox where id=any($1::uuid[])',[mailIds]);
  await admin.query('delete from dartflow_private.mail_events where recipient_key=$1',[`user:${other}`]);
  await admin.query('delete from dartflow_private.club_invites where id=$1',[invite]);
  await admin.query('delete from dartflow_private.club_join_requests where id=$1',[joinRequest]);
  await admin.query('delete from dartflow_private.mail_policies where environment=$1',[mailEnvironment]);
  await admin.query('delete from dartflow_private.integration_settings where environment=$1',[mailEnvironment]);
  await admin.query('delete from dartflow_private.play_review_accounts where user_id=any($1::uuid[])',[[actor,other]]);
  await admin.query('delete from dartflow_private.platform_messages where room_id=$1',[room]);
  await admin.query('delete from dartflow_private.community_posts where id=$1',[post]);
  await admin.query('delete from dartflow_private.platform_relationships where source_id=any($1::uuid[]) or target_id=any($1::uuid[])',[[actor,other]]);
  await admin.query('delete from dartflow_private.player_pin_verifiers where user_id=$1',[actor]);
  await admin.query('delete from dartflow_private.platform_entities where id=$1',[room]);
  await admin.query('delete from dartflow_private.board_score_events where source_id=any($1::uuid[])',[[match,training,...activeMatches]]);
  await admin.query('delete from dartflow_private.platform_entities where id=$1',[training]);
  await admin.query('delete from dartflow_private.community_messages where scope_id=any($1::uuid[])',[entities]);
  await admin.query('delete from dartflow_private.audit_events where actor_id=$1 or match_id=any($2::uuid[])',[actor,activeMatches]);
  await admin.query('delete from dartflow_private.board_activity_receipts where session_id=any($1::uuid[])',[sessions]);
  await admin.query('delete from dartflow_private.board_activity_links where session_id=any($1::uuid[])',[sessions]);
  await admin.query('delete from dartflow_private.board_activity_sessions where id=any($1::uuid[])',[sessions]);
  await admin.query('delete from dartflow_private.platform_match_links where match_id=any($1::uuid[])',[activeMatches]);
  await admin.query('delete from dartflow_private.match_confirmations where match_id=any($1::uuid[])',[activeMatches]);
  await admin.query('delete from dartflow_private.visits where match_id=any($1::uuid[])',[activeMatches]);
  await admin.query('delete from dartflow_private.match_players where match_id=any($1::uuid[])',[activeMatches]);
  await admin.query('delete from dartflow_private.matches where id=any($1::uuid[])',[activeMatches]);
  await admin.query('delete from dartflow_private.boards where id=any($1::uuid[])',[boards]);
  await admin.query('delete from dartflow_private.platform_entities where id=any($1::uuid[])',[entities]);
  await admin.query('begin');await admin.query('delete from dartflow_private.platform_members where entity_id=$1',[ownedClub]);await admin.query('delete from dartflow_private.platform_entities where id=$1',[ownedClub]);await admin.query('commit');
  await admin.query('delete from dartflow_private.match_results where match_id=$1',[match]);await admin.query('delete from dartflow_private.match_players where match_id=$1',[match]);await admin.query('delete from dartflow_private.matches where id=$1',[match]);
  await admin.query('delete from dartflow_private.events where id=$1',[event]);await admin.query('delete from dartflow_private.clubs where id=$1',[club]);await admin.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[[actor,other]]);
  await admin.end();await closeDatabase();
 }
});
