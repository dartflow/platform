import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import {closeDatabase} from '../lib/db';
import {executePlatformCommand} from '../lib/platform';
import {getClubhouse,executeClubhouseCommand,getClubhouseChannel} from '../lib/clubhouse';
import {getClubhouseTheme,executeThemeCommand} from '../lib/clubhouse-theme';
import {clubCalendar,readClubCalendarFeed,updateClubCalendarFeed} from '../lib/clubhouse-calendar';
import {executeFeedAction,getFeedState,getFeedPost} from '../lib/feed';
import {acceptPlayerSafety,COMMUNITY_RULES_VERSION} from '../lib/player-safety';
import {getCommunityFeed} from '../lib/community';
import type {ClubhouseCommand,ClubhouseView} from '../lib/clubhouse-types';
try{process.loadEnvFile('.env.local');}catch{/* Only explicit loopback fixtures. */}
const loopback=(raw:string|undefined)=>{try{return !!raw&&['localhost','127.0.0.1','[::1]'].includes(new URL(raw).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);
test('Clubhouse authorizes current memberships, premium, channel scopes and concurrent capacity against real SQL',{skip:!configured},async t=>{
 const db=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await db.connect();
 const [owner,alice,bob,outsider,platformAdmin]=Array.from({length:5},()=>randomUUID()),people=[owner,alice,bob,outsider,platformAdmin],clubs:string[]=[];
 const command=(actor:string,action:ClubhouseCommand['action'],expectedRevision?:number,requestId=randomUUID())=>executeClubhouseCommand(actor,{requestId,expectedRevision,action});
 const feed=(actor:string,action:Record<string,unknown>,requestId=randomUUID())=>executeFeedAction(actor,{requestId,action});
 try{
  for(const [i,id]of people.entries())await db.query('insert into dartflow_private.profiles(id,name,display_name)values($1,$2,$3)',[id,'clubhouse'+id.replaceAll('-','').slice(0,15),'Lid '+i]);
  for(const id of people)await acceptPlayerSafety(id,{version:COMMUNITY_RULES_VERSION,accepted:true,ageConfirmed:true});
  await db.query("insert into dartflow_private.platform_roles(user_id,role)values($1,'admin')",[platformAdmin]);
  for(const name of ['Clubhouse A','Clubhouse B'])clubs.push((await executePlatformCommand(owner,{requestId:randomUUID(),action:{type:'club.create',name}})).id!);
  const [club,other]=clubs;
  for(const c of clubs)for(const actor of [alice,bob]){await db.query("insert into dartflow_private.platform_members(entity_id,user_id,role,status)values($1,$2,'member','active')",[c,actor]);await db.query("insert into dartflow_private.club_memberships(club_id,user_id,role)values($1,$2,'player')",[c,actor]);}
  await t.test('public visibility and forged club IDs never grant private access or management',async()=>{
   await assert.rejects(getClubhouse(outsider,club),{status:403});await assert.rejects(command(alice,{type:'team.save',clubId:club,name:'Escalation',captainId:alice,memberIds:[alice],reserveIds:[]}),{status:403});
   await assert.rejects(command(owner,{type:'entitlement.grant',clubId:club,startsAt:'2026-01-01T00:00:00Z',endsAt:'2099-01-01T00:00:00Z'}),{status:403});
  });
  await t.test('draft versus published branding, platform entitlement and deterministic personal/context choice',async()=>{
   await command(owner,{type:'branding.save',clubId:club,design:{name:'Huisstijl',primary:'#000000',secondary:'#ffffff',logoData:null}},0);
   assert.equal((await getClubhouseTheme(alice)).options.length,0);await assert.rejects(command(owner,{type:'branding.publish',clubId:club},1),{code:'premium_required'});
   await command(platformAdmin,{type:'entitlement.grant',clubId:club,startsAt:'2026-01-01T00:00:00Z',endsAt:'2099-01-01T00:00:00Z'});await command(owner,{type:'branding.publish',clubId:club},1);
   assert.equal((await getClubhouseTheme(alice)).effective.clubId,club);
   const selected=await executeThemeCommand(alice,{requestId:randomUUID(),expectedRevision:0,action:{type:'preference',mode:'club',clubId:club,colorMode:'dark'}});assert.equal(selected.preference.revision,1);
   await assert.rejects(executeThemeCommand(alice,{requestId:randomUUID(),expectedRevision:0,action:{type:'preference',mode:'dartflow',clubId:null,colorMode:'light'}}),{status:409});
   await command(platformAdmin,{type:'entitlement.grant',clubId:other,startsAt:'2026-01-01T00:00:00Z',endsAt:'2099-01-01T00:00:00Z'});await command(owner,{type:'branding.save',clubId:other,design:{name:'B',primary:'#ff0000',secondary:'#0000ff',logoData:null}},0);await command(owner,{type:'branding.publish',clubId:other},1);
   assert.equal((await getClubhouseTheme(bob)).needsChoice,true);assert.equal((await getClubhouseTheme(alice,other)).effective.clubId,other);
   await command(platformAdmin,{type:'entitlement.revoke',clubId:club});const revoked=await getClubhouseTheme(alice);assert.equal(revoked.effective.clubId,null);assert.equal(revoked.needsChoice,true);assert.equal(revoked.options[0].clubId,other);
   assert.equal((await getClubhouseTheme(alice,club)).effective.clubId,null);
  });
  let teamId='';
  await t.test('teams validate current own rosters and prevent stale or cross-club edits',async()=>{
   const view=await command(owner,{type:'team.save',clubId:club,name:'A-team',captainId:alice,memberIds:[alice],reserveIds:[bob]},0) as ClubhouseView;teamId=view.teams[0].id;
   await assert.rejects(command(owner,{type:'team.save',clubId:other,id:teamId,name:'forged',captainId:alice,memberIds:[alice],reserveIds:[]},1),{status:404});
   await assert.rejects(command(owner,{type:'team.save',clubId:club,id:teamId,name:'overlap',captainId:alice,memberIds:[alice],reserveIds:[alice]},1),{code:'invalid_roster'});
   await assert.rejects(command(owner,{type:'team.save',clubId:club,id:teamId,name:'stale',captainId:alice,memberIds:[alice],reserveIds:[bob]},0),{status:409});
  });
  let activityId='';
  await t.test('last calendar place serializes, wait-list promotes once, ICS and revocable feeds share current ACL',async()=>{
   const view=await command(owner,{type:'activity.save',clubId:club,title:'Clubavond',description:'Agenda\ngeen injectie',startsAt:'2090-06-01T18:00:00+02:00',endsAt:'2090-06-01T20:00:00+02:00',timeZone:'Europe/Amsterdam',capacity:1,location:'Eigen lokaal',organizerName:'Bestuur'},0) as ClubhouseView;activityId=view.activities[0].id;
   await Promise.all([command(alice,{type:'activity.join',clubId:club,id:activityId}),command(bob,{type:'activity.join',clubId:club,id:activityId})]);const after=(await getClubhouse(owner,club)).activities[0];assert.equal(after.registered,1);assert.equal(after.waitlisted,1);assert.equal(after.participants.length,2);
   const winner=after.participants.find(p=>p.status==='registered')!.userId;await command(winner,{type:'activity.leave',clubId:club,id:activityId});assert.equal((await getClubhouse(owner,club)).activities[0].registered,1);
   const ics=await clubCalendar(alice,club,'http://localhost:3000');assert.ok(ics.includes('BEGIN:VEVENT'));assert.ok(ics.includes('DTSTART:20900601T160000Z'));
   const link=await updateClubCalendarFeed(alice,club,'http://localhost:3000');assert.ok('url'in link);const token='url'in link?String(link.url).split('/').at(-1)!:'';assert.ok((await readClubCalendarFeed(token,'http://localhost:3000')).includes('Clubavond'));
   await updateClubCalendarFeed(alice,club,'http://localhost:3000',true);await assert.rejects(readClubCalendarFeed(token,'http://localhost:3000'),{status:404});
  });
  await t.test('last volunteer slot is atomic and command retries cannot create duplicate subscriptions',async()=>{
   const view=await command(owner,{type:'task.save',clubId:club,title:'Bardienst',description:'Dinsdag',capacity:1,status:'open',privateNote:'Alleen bestuur'},0) as ClubhouseView,id=view.tasks[0].id;
   const results=await Promise.allSettled([command(alice,{type:'task.volunteer',clubId:club,id}),command(bob,{type:'task.volunteer',clubId:club,id})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await getClubhouse(owner,club)).tasks[0].volunteerIds.length,1);assert.equal((await getClubhouse(alice,club)).tasks[0].privateNote,undefined);
  });
  await t.test('private team and board channels, real unread/read cursor and immediate scope revocation',async()=>{
   let view=await command(owner,{type:'channel.save',clubId:club,name:'Team A',kind:'team',teamId},0) as ClubhouseView;const channel=view.channels.find(c=>c.kind==='team')!;
   await command(alice,{type:'channel.message',clubId:club,channelId:channel.id,body:'TEAM-PRIVATE-MESSAGE'});assert.equal((await getClubhouse(bob,club)).channels.find(c=>c.id===channel.id)!.unread,1);
   await db.query("insert into dartflow_private.platform_relationships(source_id,target_id,kind)values($1,$2,'block')",[bob,alice]);assert.equal((await getClubhouse(bob,club)).channels.find(c=>c.id===channel.id)!.unread,0);assert.equal((await getClubhouseChannel(bob,club,channel.id)).messages.length,0);await db.query("delete from dartflow_private.platform_relationships where source_id=$1 and target_id=$2 and kind='block'",[bob,alice]);
   const page=await getClubhouseChannel(bob,club,channel.id);assert.equal(page.messages.length,1);await command(bob,{type:'channel.read',clubId:club,channelId:channel.id,cursor:page.cursor});assert.equal((await getClubhouse(bob,club)).channels.find(c=>c.id===channel.id)!.unread,0);
   await assert.rejects(executePlatformCommand(outsider,{requestId:randomUUID(),action:{type:'report.create',targetType:'club-channel-message',targetId:page.messages[0].id,category:'privacy',reason:'Geen toegang tot privéteam.'}}),{status:403});
   const messageReport=await executePlatformCommand(bob,{requestId:randomUUID(),action:{type:'report.create',targetType:'club-channel-message',targetId:page.messages[0].id,category:'privacy',reason:'Beoordeel dit echte teambericht.'}});assert.ok((await getClubhouse(owner,club)).reports.some(r=>r.id===messageReport.id&&r.targetType==='club-channel-message'));await command(owner,{type:'report.resolve',clubId:club,reportId:String(messageReport.id),operation:'no-action',reason:'Na beoordeling geen ingreep nodig.'});
   view=await command(owner,{type:'channel.save',clubId:club,name:'Bestuur',kind:'board'},0) as ClubhouseView;const board=view.channels.find(c=>c.kind==='board')!;await assert.rejects(getClubhouseChannel(alice,club,board.id),{status:403});
   await db.query("insert into dartflow_private.club_channel_messages(id,channel_id,author_id,body)select gen_random_uuid(),$1,$2,'Ouder bericht '||n from generate_series(1,105)n",[channel.id,alice]);const recent=await getClubhouseChannel(alice,club,channel.id);assert.equal(recent.messages.length,100);assert.equal(recent.hasMoreBefore,true);const older=await getClubhouseChannel(alice,club,channel.id,0,recent.nextBefore!);assert.equal(older.messages.length,6);assert.equal(older.hasMoreBefore,false);assert.ok(older.messages.every(m=>m.sequence<recent.messages[0].sequence));
   await command(owner,{type:'team.save',clubId:club,id:teamId,name:'A-team',captainId:alice,memberIds:[alice],reserveIds:[]},1);await assert.rejects(getClubhouseChannel(bob,club,channel.id),{status:403});
  });
  await t.test('feed polls, edits, anonymous totals and shared legacy projection preserve ACL and vote policy',async()=>{
   const composed=await feed(alice,{type:'compose',channel:`club:${club}`,body:'Stem op de clubavond',poll:{options:['Dinsdag','Vrijdag'],endsAt:'2090-01-01T00:00:00Z',multiple:false,allowChange:false}}).catch(e=>{assert.equal(e.code,'invalid_poll');return null;});assert.equal(composed,null);
   const post=await feed(alice,{type:'compose',channel:`club:${club}`,body:'Stem op de clubavond',poll:{options:['Dinsdag','Vrijdag'],endsAt:new Date(Date.now()+86400000).toISOString(),multiple:false,allowChange:false}});const state=await getFeedState(bob,{channel:`club:${club}`}),item=[...state.posts,...state.pins].find(p=>p.id===post.id)!;assert.ok(item.extras?.poll);const poll=item.extras.poll;
   await feed(bob,{type:'poll.vote',itemId:item.id,optionIds:[poll.options[0].id]});await assert.rejects(feed(bob,{type:'poll.vote',itemId:item.id,optionIds:[poll.options[1].id]}),{code:'vote_locked'});await assert.rejects(feed(outsider,{type:'poll.vote',itemId:item.id,optionIds:[poll.options[0].id]}),{status:403});
   await feed(alice,{type:'edit',itemId:item.id,expectedRevision:1,body:'Gewijzigde vraag'});const legacy=(await getCommunityFeed(alice,{kind:'club',id:club})).posts.find(p=>p.id===item.id)!;assert.equal(legacy.authorName,'Lid 1');assert.equal(legacy.body,'Gewijzigde vraag');assert.equal((await getFeedPost(alice,item.id,`club:${club}`)).post.body,'Gewijzigde vraag');await assert.rejects(getFeedPost(alice,item.id,`club:${other}`),{status:404});assert.equal(legacy.extras?.poll?.totalVoters,1);assert.equal(legacy.extras?.revision,2);assert.ok(!JSON.stringify(legacy.extras?.poll).includes(bob));
   await feed(alice,{type:'poll.close',itemId:item.id});await assert.rejects(feed(alice,{type:'poll.vote',itemId:item.id,optionIds:[poll.options[0].id]}),{code:'poll_closed'});
  });
  await t.test('safe raster attachments, old pinned posts and exact object links retain their club ACL',async()=>{
   await assert.rejects(feed(alice,{type:'compose',channel:`club:${club}`,body:'Onveilig',attachments:[{name:'script.svg',data:'data:image/svg+xml;base64,PHN2Zy8+'}]}),{code:'club_logo'});
   const image=await sharp({create:{width:4,height:4,channels:3,background:'#ff0000'}}).png().toBuffer(),made=await feed(alice,{type:'compose',channel:`club:${club}`,body:'Veilige bijlage',attachments:[{name:'Clubfoto',data:`data:image/png;base64,${image.toString('base64')}`}]}),id=String(made.id);
   const photo=(await getFeedPost(bob,id,`club:${club}`)).post;assert.match(photo.extras!.attachments[0].data,/^data:image\/webp;base64,/);await assert.rejects(getFeedPost(outsider,id),{status:403});
   await db.query("update dartflow_private.feed_items set created_at=now()-interval '1 year' where id=$1",[id]);await db.query("update dartflow_private.community_posts set created_at=now()-interval '1 year' where id=$1",[id]);await feed(owner,{type:'pin',itemId:id,days:1});assert.ok((await getFeedState(bob,{channel:`club:${club}`})).pins.some(p=>p.id===id));
   assert.ok((await getFeedState(bob,{channel:`club:${club}`,sort:'popular'})).posts.length>0);
  });
  await t.test('task changes remain visible, responsible members can finish their own task, and notifications respect fresh membership',async()=>{
   const made=await command(owner,{type:'task.save',clubId:club,title:'Eigen dienst',description:'Afspraken',ownerId:alice,capacity:1,status:'open',startsAt:'2090-06-01T18:00:00+02:00',endsAt:'2090-06-01T19:00:00+02:00',function:'Bar',activityId},0)as ClubhouseView,id=made.tasks.find(t=>t.title==='Eigen dienst')!.id;
   await command(alice,{type:'task.volunteer',clubId:club,id});let task=(await getClubhouse(owner,club)).tasks.find(t=>t.id===id)!;
   await command(owner,{type:'task.save',clubId:club,id,title:task.title,description:task.description,ownerId:alice,capacity:1,status:'open',startsAt:'2090-06-01T19:00:00+02:00',endsAt:'2090-06-01T20:00:00+02:00',function:'Bar',activityId},task.revision);task=(await getClubhouse(alice,club)).tasks.find(t=>t.id===id)!;assert.ok(task.startsAt);assert.ok(task.volunteerIds.includes(alice));
   assert.equal((await db.query("select count(*)::int n from dartflow_private.mail_events where scope_key=$1 and template_id='club-task-update'",[`club:${club}`])).rows[0].n,1);
   await assert.rejects(command(bob,{type:'task.status',clubId:club,id,status:'done'},task.revision),{status:403});await command(alice,{type:'task.status',clubId:club,id,status:'done'},task.revision);assert.equal((await getClubhouse(alice,club)).tasks.find(t=>t.id===id)!.status,'done');
  });
  await t.test('club moderation reports remain private, custom grants are scoped, and review uses the existing canonical report service',async()=>{
   const post=await feed(alice,{type:'compose',channel:`club:${club}`,body:'Te beoordelen clubbericht'});const reported=await executePlatformCommand(bob,{requestId:randomUUID(),action:{type:'report.create',targetType:'post',targetId:String(post.id),category:'privacy',reason:'Beoordeel dit binnen de club.'}}),reportId=String(reported.id);
   assert.equal((await getClubhouse(alice,club)).reports.length,0);await assert.rejects(command(bob,{type:'report.resolve',clubId:club,reportId,operation:'remove-content',reason:'Geen recht'}),{status:403});
   const role=await executePlatformCommand(owner,{requestId:randomUUID(),action:{type:'club.role.save',id:club,name:'Clubmoderator eigenrecht',permissions:['chat.moderate']}});const roleId=role.entity!.state?((role.entity as ClubhouseView['club']).clubDetails.roles.find(r=>r.name==='Clubmoderator eigenrecht')!.id):'';
   await executePlatformCommand(owner,{requestId:randomUUID(),action:{type:'club.member.roles',id:club,userId:bob,role:'member',roleIds:[roleId]}});assert.ok((await getClubhouse(bob,club)).reports.some(r=>r.id===reportId));
   await assert.rejects(command(bob,{type:'report.resolve',clubId:other,reportId,operation:'no-action',reason:'Verkeerde club'}),{status:403});
   await command(bob,{type:'report.resolve',clubId:club,reportId,operation:'remove-content',reason:'Privébericht verwijderd na beoordeling.'});await assert.rejects(getFeedPost(alice,String(post.id)),{status:404});assert.equal((await db.query('select status from dartflow_private.platform_reports where id=$1',[reportId])).rows[0].status,'resolved');
  });
  await t.test('suspension removes private reads and premium eligibility; transfer needs valid recipient acceptance',async()=>{
   await assert.rejects(executePlatformCommand(owner,{requestId:randomUUID(),action:{type:'club.transfer',id:club,userId:alice}}),{code:'transfer_acceptance_required'});
   const offered=await command(owner,{type:'ownership.offer',clubId:club,recipientId:alice}) as ClubhouseView;assert.equal(offered.club.ownerId,owner);await assert.rejects(command(bob,{type:'ownership.accept',clubId:club,transferId:offered.ownershipTransfer!.id}),{status:409});await command(alice,{type:'ownership.accept',clubId:club,transferId:offered.ownershipTransfer!.id});assert.equal((await getClubhouse(owner,club)).club.ownerId,alice);
   await command(alice,{type:'member.suspend',clubId:club,userId:bob});await assert.rejects(getClubhouse(bob,club),{status:403});assert.ok(!(await getClubhouseTheme(bob)).options.some(c=>c.clubId===club));await command(alice,{type:'member.restore',clubId:club,userId:bob});assert.equal((await getClubhouse(bob,club)).club.clubAccess.isMember,true);
  });
 }finally{
  try{
  await db.query('delete from dartflow_private.mail_provider_events where job_id in(select id from dartflow_private.mail_outbox where recipient_id=any($1::uuid[]))',[people]);
  await db.query('delete from dartflow_private.mail_outbox where recipient_id=any($1::uuid[])',[people]);
  await db.query('delete from dartflow_private.mail_events where actor_id=any($1::uuid[])',[people]);
  for(const c of clubs){await db.query('delete from dartflow_private.platform_reports where scope_id=$1',[c]);await db.query('delete from dartflow_private.feed_items where channel=any($1::text[])',[[`club:${c}`,`club-public:${c}`]]);await db.query('delete from dartflow_private.community_posts where scope_id=$1',[c]);await db.query('delete from dartflow_private.community_messages where scope_id=$1',[c]);for(const table of ['mail_outbox','mail_events','mail_templates','mail_template_versions','mail_policies'])await db.query(`delete from dartflow_private.${table} where scope_key=$1`,[`club:${c}`]);await db.query('delete from dartflow_private.platform_audit where entity_id=$1',[c]);await db.query('delete from dartflow_private.platform_entities where id=$1',[c]);await db.query('delete from dartflow_private.club_memberships where club_id=$1',[c]);await db.query('delete from dartflow_private.club_intake_versions where club_id=$1',[c]);await db.query('delete from dartflow_private.clubs where id=$1',[c]);}
  await db.query('delete from dartflow_private.feed_receipts where actor_id=any($1::uuid[])',[people]);await db.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])',[people]);await db.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])',[people]);await db.query('delete from dartflow_private.platform_roles where user_id=any($1::uuid[])',[people]);await db.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);}finally{await db.end();await closeDatabase();}
 }
});
