import{test}from'node:test';
import assert from'node:assert/strict';
import{randomUUID}from'node:crypto';
import pg from'pg';
import{database,closeDatabase,getProfile,getMatch,createScreen,getPublicSnapshot}from'../lib/db';
import{executePlatformCommand,getPlatformOverview}from'../lib/platform';
import{ensureAuthProfile}from'../lib/accounts';
import{usernameAvailability}from'../lib/profile-name';
import{searchPlayers}from'../lib/player-search';
import{normalizeUsername,validUsername}from'../lib/display-name';
import{newGame}from'../lib/domain';
import{recordScoreEvents}from'../lib/score-events';
import type{MatchState}from'../lib/types';
try{process.loadEnvFile('.env.local');}catch{/* Explicit loopback fixture only. */}
const loopback=(value:string|undefined)=>{try{return Boolean(value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname));}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);
test('immutable public identity works through real profile/auth/relationship/match APIs and normal database privileges',{skip:!configured},async t=>{
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();
 const people=Array.from({length:5},()=>randomUUID()),[first,second,third,google,peer]=people,suffix=randomUUID().replaceAll('-','').slice(0,10),handle=`identity${suffix}`,club=randomUUID(),event=randomUUID(),match=randomUUID(),board=randomUUID();
 const update=(actor:string,fields:Record<string,unknown>)=>executePlatformCommand(actor,{requestId:randomUUID(),action:{type:'profile.update',...fields}});
 let winner=first,loser=second;
 try{
  for(const id of [first,second,third])await admin.query("insert into dartflow_private.profiles(id,name,display_name_confirmed)values($1,'Nieuwe speler',false)",[id]);
  await admin.query('insert into dartflow_private.profiles(id,name,display_name)values($1,$2,$3)',[peer,`peer${suffix}`,'Dezelfde Display']);
  await t.test('all raw whitespace and invisible username requests fail before claim',async()=>{
   for(const username of ['a b',' a','a ','a\tb','a\nb','a\u00a0b','a\u200bb','a\u034fb','a\ufe0fb'])await assert.rejects(update(first,{username}),{code:'display_name'});
   assert.equal((await getProfile(first)).username,null);assert.equal((await getProfile(first)).usernameLocked,false);
  });
  await t.test('two simultaneous Unicode/case-equivalent first claims yield one success and explicit conflict',async()=>{
   const fullwidth=handle.replace(/[a-z]/g,c=>String.fromCharCode(c.charCodeAt(0)+0xfee0));
   const results=await Promise.allSettled([update(first,{username:`@${fullwidth}`,displayName:'Dezelfde Display',fullName:'Private First Person'}),update(second,{username:handle.toUpperCase(),displayName:'Dezelfde Display',fullName:'Private Second Person'})]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const rejected=results.find(r=>r.status==='rejected')as PromiseRejectedResult;assert.equal(rejected.reason.code,'username_taken');
   winner=results[0].status==='fulfilled'?first:second;loser=winner===first?second:first;
   assert.equal((await getProfile(winner)).username,handle);assert.equal((await getProfile(winner)).usernameLocked,true);
   assert.equal((await usernameAvailability(loser,handle.toUpperCase())).available,false);
   await update(loser,{username:`other${suffix}`,displayName:'Dezelfde Display'});
  });
  await t.test('claimed handle rejects legacy changes and direct aliases; canonical identical repeat succeeds',async()=>{
   await assert.rejects(update(winner,{name:`changed${suffix}`}),{code:'username_locked',status:409});
   await assert.rejects(update(winner,{username:`changed${suffix}`}),{code:'username_locked',status:409});
   await update(winner,{username:handle.toUpperCase(),displayName:'Dezelfde Display'});
   for(const sql of ['update dartflow_private.profiles set name=$2 where id=$1','update dartflow_private.profiles set name=$2,display_name_confirmed=false where id=$1'])await assert.rejects(database().query(sql,[winner,`direct${suffix}`]),{code:'23514',constraint:'profiles_username_immutable'});
   await assert.rejects(database().query('update dartflow_private.profiles set display_name_confirmed=false where id=$1',[winner]),{code:'23514'});
   assert.equal((await getProfile(winner)).username,handle);
  });
  await t.test('Node and PostgreSQL share canonical Unicode handling and reject the same raw invisible inputs',async()=>{
   const samples=['@Ｄａｎｎｙ','E\u0308','ΣΟΣ','İ','\u1C89','\u{10D50}','\u{16EA0}','¼','²','Ⅷ','a b','a\u00a0b','a\u200bb','a\u034fb','a\ufe0fb','\u00a8a'];
   for(const value of samples){const r=(await admin.query('select dartflow_private.username_key($1)key,dartflow_private.valid_username($1)valid',[value])).rows[0];assert.equal(r.key,normalizeUsername(value),value);assert.equal(r.valid,validUsername(value),value);}
  });
  await t.test('private full/display edits preserve IDs, friendships and every score; all shared projections use public names',async()=>{
   await admin.query('insert into dartflow_private.clubs(id,name)values($1,$2)',[club,'Identity privacy fixture']);
   await admin.query("insert into dartflow_private.club_memberships(club_id,user_id,role)values($1,$2,'organizer'),($1,$3,'player')",[club,winner,peer]);
   await admin.query('insert into dartflow_private.events(id,club_id,name,date,capacity)values($1,$2,$3,current_date,10)',[event,club,'Identity privacy fixture']);
   await admin.query('insert into dartflow_private.event_staff(event_id,user_id)values($1,$2)',[event,winner]);
   await admin.query('insert into dartflow_private.boards(id,event_id,name)values($1,$2,$3)',[board,event,'Identity board']);
   await admin.query("insert into dartflow_private.platform_relationships(source_id,target_id,kind)values($1,$2,'friend'),($2,$1,'friend')",[winner,peer]);
   const settings={startScore:501 as const,bestOfLegs:3,bestOfSets:1};
   const state:MatchState={id:match,eventId:event,clubId:club,boardId:board,revision:4,status:'live',players:[{id:winner,name:'OLD PRIVATE SNAPSHOT',fullName:'DO NOT LEAK',email:'private@example.invalid'},{id:peer,name:'Old peer'}],writerId:winner,settings,accepted:[true,true],confirmations:[false,false],resultRevision:null,game:newGame(match,[winner,peer],settings),previousSets:[],winnerId:null,resultPublished:false,dispute:null};
   await admin.query('insert into dartflow_private.matches(id,club_id,event_id,board_id,revision,state)values($1,$2,$3,$4,$5,$6)',[match,club,event,board,4,JSON.stringify(state)]);
   for(const[position,id]of[winner,peer].entries())await admin.query('insert into dartflow_private.match_players(match_id,user_id,position)values($1,$2,$3)',[match,id,position]);
   await update(winner,{fullName:'Unsearchable Secret Person',displayName:'Public Pijl'});
   const own=await getProfile(winner),publicMatch=await getMatch(peer,match),overview=await getPlatformOverview(peer);
   await recordScoreEvents(admin,board,match,4,'score',[{score:60,playerIndex:0,playerName:'OLD PRIVATE SNAPSHOT'}]);
   const screen=await createScreen(winner,event,board),display=await getPublicSnapshot(screen.token);
   assert.equal(display.match?.players[0].name,'Public Pijl');assert.ok(!JSON.stringify(display).includes('OLD PRIVATE SNAPSHOT'));assert.ok(!JSON.stringify(display).includes('DO NOT LEAK'));assert.ok(!JSON.stringify(display).includes('private@example.invalid'));assert.equal(display.scoreEvents?.[0]?.playerName,undefined);
   assert.equal(own.id,winner);assert.equal(own.fullName,'Unsearchable Secret Person');assert.equal(own.username,handle);
   assert.equal(publicMatch.players[0].name,'Public Pijl');assert.equal(publicMatch.players[0].username,handle);
   for(const output of [publicMatch,overview.players,overview.friends,overview.matches]){const serialized=JSON.stringify(output);assert.ok(!serialized.includes('Unsearchable Secret Person'));assert.ok(!serialized.includes('OLD PRIVATE SNAPSHOT'));assert.ok(!serialized.includes('DO NOT LEAK'));assert.ok(!serialized.includes('private@example.invalid'));}
   const saved=(await admin.query('select state from dartflow_private.matches where id=$1',[match])).rows[0].state;assert.deepEqual(saved.game,state.game);assert.equal(saved.revision,5);
   assert.equal((await admin.query("select count(*)::int n from dartflow_private.platform_relationships where kind='friend'and(source_id=$1 or target_id=$1)",[winner])).rows[0].n,2);
   assert.ok(overview.players.some(p=>p.id===winner&&p.username===handle&&p.displayName==='Public Pijl'));
  });
  await t.test('directory search reads only public fields and applies discoverability and blocks before paging',async()=>{
   const byHandle=await searchPlayers(peer,`@${handle.toUpperCase()}`);assert.equal(byHandle.players.length,1);assert.equal(byHandle.players[0].id,winner);assert.equal(byHandle.players[0].avatar,null);
   const duplicates=await searchPlayers(third,'Dezelfde Display');assert.ok(duplicates.players.some(p=>p.id===loser));assert.ok(duplicates.players.some(p=>p.id===peer));assert.notEqual(duplicates.players.find(p=>p.id===loser)!.username,duplicates.players.find(p=>p.id===peer)!.username);
   assert.deepEqual((await searchPlayers(peer,'Unsearchable Secret Person')).players,[]);assert.ok(!JSON.stringify(byHandle).includes('fullName'));assert.ok(!JSON.stringify(byHandle).includes('email'));
   await executePlatformCommand(winner,{requestId:randomUUID(),action:{type:'preferences.update',discoverable:false}});assert.deepEqual((await searchPlayers(peer,handle)).players,[]);await executePlatformCommand(winner,{requestId:randomUUID(),action:{type:'preferences.update',discoverable:true}});
   await executePlatformCommand(peer,{requestId:randomUUID(),action:{type:'friend.block',userId:winner}});assert.deepEqual((await searchPlayers(peer,handle)).players,[]);
  });
  await t.test('verified Google personal metadata remains private until public identity is explicitly chosen',async()=>{
   const user={id:google,user_metadata:{full_name:'Google Private Person',name:'Google Private Alternate',role:'owner',display_name_confirmed:true}};
   await ensureAuthProfile(user);const own=await getProfile(google);assert.equal(own.fullName,'Google Private Person');assert.equal(own.name,'Speler');assert.equal(own.username,null);assert.equal(own.displayName,null);
   const before=await getPlatformOverview(peer);assert.ok(!JSON.stringify(before.players).includes('Google Private'));
   await update(google,{username:`google${suffix}`,displayName:'Public Google',fullName:'Own Private Name'});await ensureAuthProfile(user);
   assert.equal((await getProfile(google)).fullName,'Own Private Name');assert.equal((await getProfile(google)).displayName,'Public Google');
   assert.equal((await admin.query('select 1 from dartflow_private.platform_roles where user_id=$1',[google])).rowCount,0);
  });
 }finally{
  try{for(const table of ['platform_receipts','platform_audit'])await admin.query(`delete from dartflow_private.${table} where actor_id=any($1::uuid[])`,[people]);
   await admin.query('delete from dartflow_private.platform_preferences where user_id=any($1::uuid[])',[people]);
   await admin.query('delete from dartflow_private.platform_relationships where source_id=any($1::uuid[])or target_id=any($1::uuid[])',[people]);
   await admin.query('delete from dartflow_private.screen_capabilities where board_id=$1',[board]);await admin.query('delete from dartflow_private.board_score_events where board_id=$1',[board]);await admin.query('delete from dartflow_private.audit_events where event_id=$1',[event]);await admin.query('delete from dartflow_private.match_players where match_id=$1',[match]);await admin.query('delete from dartflow_private.matches where id=$1',[match]);await admin.query('delete from dartflow_private.boards where id=$1',[board]);await admin.query('delete from dartflow_private.event_staff where event_id=$1',[event]);await admin.query('delete from dartflow_private.events where id=$1',[event]);await admin.query('delete from dartflow_private.club_memberships where club_id=$1',[club]);await admin.query('delete from dartflow_private.clubs where id=$1',[club]);await admin.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);
  }finally{await admin.end();await closeDatabase();}
 }
});
