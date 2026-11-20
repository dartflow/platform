import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {database,closeDatabase} from '../lib/db';
import {executePlatformCommand,getPlatformOverview} from '../lib/platform';
import {clubView} from '../lib/club-domain';
import {entity} from '../lib/platform-store';
import {clubPermission,clubReviewerMailApplicable,clubInvitationMailApplicable} from '../lib/club-access';
import type {ClubEntity} from '../lib/club-types';
import type {PlatformCommand} from '../lib/platform-types';
try{process.loadEnvFile('.env.local');}catch{/* Explicit loopback-only database required. */}
const local=(input:string|undefined)=>{try{return Boolean(input&&['localhost','127.0.0.1','[::1]'].includes(new URL(input).hostname));}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&local(process.env.DARTFLOW_DATABASE_URL)&&local(process.env.DARTFLOW_DATABASE_ADMIN_URL);

test('v17 club ownership, scoped grants, intake, targeted invitations and durable mail are atomic',{skip:!configured},async t=>{
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await admin.connect();
 const owner=randomUUID(),reviewer=randomUUID(),alice=randomUUID(),bob=randomUUID(),outsider=randomUUID(),people=[owner,reviewer,alice,bob,outsider],clubs:string[]=[];
 const run=(actor:string,action:PlatformCommand['action'],expectedRevision?:number,requestId=randomUUID())=>executePlatformCommand(actor,{requestId,action,...(expectedRevision===undefined?{}:{expectedRevision})});
 const project=async(actor:string,id:string)=>(await getPlatformOverview(actor)).clubs.find(c=>c.id===id) as ClubEntity;
 try{
  for(const [index,id]of people.entries())await admin.query('insert into dartflow_private.profiles(id,name,display_name) values($1,$2,$3)',[id,`clubv17${id.slice(0,8)}`,`Club v17 fixture ${index}`]);
  const created=await run(owner,{type:'club.create',name:'V17 transactional club',capacity:8}),club=created.id!;clubs.push(club);
  const other=(await run(outsider,{type:'club.create',name:'V17 separate club'})).id!;clubs.push(other);
  for(const target of [reviewer,bob]){await run(target,{type:'club.request',id:club});await run(owner,{type:'club.approve',id:club,userId:target});}
  await t.test('only owner manages roles; custom grants and assignments cannot cross clubs',async()=>{
   await run(owner,{type:'club.role.save',id:club,name:'Intakebeoordelaar',permissions:['members.approve','members.invite']});const role=(await project(owner,club)).clubDetails.roles.find(r=>r.name==='Intakebeoordelaar')!;
   await run(owner,{type:'club.member.roles',id:club,userId:reviewer,role:'member',roleIds:[role.id]});assert.equal(await clubPermission(database(),club,reviewer,'members.approve'),true);assert.equal(await clubPermission(database(),club,reviewer,'settings.edit'),false);
   await assert.rejects(run(reviewer,{type:'club.role.save',id:club,name:'Escalation',permissions:['settings.edit']}),{status:403});await assert.rejects(run(reviewer,{type:'club.role',id:club,userId:bob,role:'owner'}),{status:403});
   await assert.rejects(run(outsider,{type:'club.member.roles',id:other,userId:owner,roleIds:[role.id]}));assert.equal(await clubPermission(database(),other,reviewer,'members.approve'),false);
   await assert.rejects(run(owner,{type:'club.role.save',id:club,name:'Physical rights',permissions:['locations.manage']}),{code:'club_permissions'});
   await run(owner,{type:'club.role',id:club,userId:bob,role:'admin'});assert.equal(await clubPermission(database(),club,bob,'settings.edit'),true);await assert.rejects(run(bob,{type:'club.role.save',id:club,name:'Admin escalation',permissions:[]}),{status:403});await assert.rejects(run(bob,{type:'club.transfer',id:club,userId:owner}),{status:403});await assert.rejects(run(bob,{type:'club.deactivate',id:club}),{status:403});await run(owner,{type:'club.role',id:club,userId:bob,role:'member'});
   await run(bob,{type:'club.request',id:other});await run(outsider,{type:'club.approve',id:other,userId:bob});await assert.rejects(run(outsider,{type:'club.member.roles',id:other,userId:bob,roleIds:[role.id]}),{code:'invalid_role'});await assert.rejects(database().query('insert into dartflow_private.club_member_roles(club_id,user_id,role_id) values($1,$2,$3)',[other,bob,role.id]),{code:'23503'});
  });
  let requestId='';const secretAnswer='PRIVATE-INVOICE-ANSWER-MUST-NOT-BE-MAILED';
  await t.test('intake versions and answers are validated, preserved and private; receipt/review mail deduplicate',async()=>{
   await run(owner,{type:'club.settings',id:club,joinPolicy:'intake',intakeIntroduction:'Waarom deze vereniging?',intakeQuestions:[{id:'reason',label:'Oorspronkelijke vraag',type:'textarea',required:true},{id:'level',label:'Niveau',type:'select',required:true,options:['Nieuw','Ervaren']}]});
   const form=(await project(alice,club)).clubDetails;await assert.rejects(run(alice,{type:'club.request',id:club,intakeVersion:form.intakeVersion-1,answers:{reason:'Goed',level:'Nieuw'}}),{code:'intake_changed'});
   await assert.rejects(run(alice,{type:'club.request',id:club,intakeVersion:form.intakeVersion,answers:{reason:'Goed',level:'forged'}}),{code:'intake_answer'});
   const commandId=randomUUID(),action={type:'club.request',id:club,intakeVersion:form.intakeVersion,answers:{reason:secretAnswer,level:'Nieuw'}};const submitted=await run(alice,action,undefined,commandId);requestId=String(submitted.requestId);await run(alice,action,undefined,commandId);await run(alice,action);
   const jobs=(await admin.query('select template_id,recipient_id,snapshot from dartflow_private.mail_outbox where entity_id=$1 and event_id like $2',[club,`club-request:${requestId}:%`])).rows;assert.equal(jobs.filter(j=>j.template_id==='club-request-received').length,1);assert.deepEqual(jobs.filter(j=>j.template_id==='club-request').map(j=>j.recipient_id).sort(),[owner,reviewer].sort());assert.ok(!JSON.stringify(jobs).includes(secretAnswer));
   await run(owner,{type:'club.settings',id:club,intakeQuestions:[{id:'reason',label:'Nieuwe vraag',type:'text',required:false}]});
   assert.equal((await project(reviewer,club)).clubDetails.requests.find(r=>r.id===requestId)?.answers[0].label,'Oorspronkelijke vraag');assert.equal((await project(bob,club)).clubDetails.requests.some(r=>r.id===requestId),false);assert.equal((await project(outsider,club)).clubDetails.requests.some(r=>r.id===requestId),false);
   await assert.rejects(database().query("update dartflow_private.club_join_requests set answers='[]' where id=$1",[requestId]),{code:'42501'});await assert.rejects(admin.query("update dartflow_private.club_join_requests set answers='[]' where id=$1",[requestId]),{code:'23514'});
   assert.equal(await clubReviewerMailApplicable(database(),club,reviewer,`club-request:${requestId}:reviewers`),true);
   await run(owner,{type:'club.member.roles',id:club,userId:reviewer,roleIds:[]});assert.equal(await clubReviewerMailApplicable(database(),club,reviewer,`club-request:${requestId}:reviewers`),false);await assert.rejects(run(reviewer,{type:'club.approve',id:club,requestId}),{status:403});
   const role=(await project(owner,club)).clubDetails.roles.find(r=>r.name==='Intakebeoordelaar')!;await run(owner,{type:'club.member.roles',id:club,userId:reviewer,roleIds:[role.id]});
  });
  await t.test('two reviewers race one pending request; first terminal transition wins and one decision mail exists',async()=>{
   const [first,second]=await Promise.all([run(owner,{type:'club.approve',id:club,requestId,reason:'Welkom'}),run(reviewer,{type:'club.reject',id:club,requestId,reason:'Ander besluit'})]);assert.equal(Boolean(first.alreadyProcessed)||Boolean(second.alreadyProcessed),true);
   const state=(await admin.query('select status from dartflow_private.club_join_requests where id=$1',[requestId])).rows[0].status;assert.ok(['approved','rejected'].includes(state));assert.equal((await admin.query("select count(*)::int n from dartflow_private.mail_outbox where entity_id=$1 and event_id=$2 and template_id='club-decision'",[club,`club-decision:${requestId}`])).rows[0].n,1);
   assert.equal(await clubReviewerMailApplicable(database(),club,reviewer,`club-request:${requestId}:reviewers`),false);
  });
  await t.test('targeted invitations are not bearer-code joins, deduplicate and respect current join policy',async()=>{
   await run(owner,{type:'club.settings',id:club,joinPolicy:'invite'});await assert.rejects(run(outsider,{type:'club.request',id:club,code:created.code}),{code:'invite_required'});
   await run(owner,{type:'club.invite',id:club,userId:outsider});await run(owner,{type:'club.invite',id:club,userId:outsider});const invitation=(await project(outsider,club)).clubDetails.invites.find(i=>i.status==='pending')!;
   assert.equal(await clubInvitationMailApplicable(database(),club,outsider,`club-invite:${invitation.id}`),true);assert.equal((await admin.query("select count(*)::int n from dartflow_private.mail_outbox where entity_id=$1 and template_id='club-invite'",[club])).rows[0].n,1);
   await assert.rejects(run(alice,{type:'club.invite.accept',id:club,inviteId:invitation.id}),{status:404});await run(owner,{type:'club.settings',id:club,joinPolicy:'closed'});await assert.rejects(run(outsider,{type:'club.invite.accept',id:club,inviteId:invitation.id}),{code:'club_closed'});await run(owner,{type:'club.settings',id:club,joinPolicy:'invite'});await run(outsider,{type:'club.invite.accept',id:club,inviteId:invitation.id});await run(outsider,{type:'club.invite.accept',id:club,inviteId:invitation.id});assert.equal((await project(outsider,club)).clubAccess.isMember,true);assert.equal(await clubInvitationMailApplicable(database(),club,outsider,`club-invite:${invitation.id}`),false);
  });
  await t.test('open admissions serialize remaining capacity and repeated membership makes no second decision job',async()=>{
   const capacityClub=(await run(owner,{type:'club.create',name:'V17 last available seat',capacity:2})).id!;clubs.push(capacityClub);await run(owner,{type:'club.settings',id:capacityClub,joinPolicy:'open'});
   const results=await Promise.allSettled([run(alice,{type:'club.request',id:capacityClub}),run(bob,{type:'club.request',id:capacityClub})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const rejected=results.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.equal(rejected.reason.code,'capacity_reached');
   const joined=results[0].status==='fulfilled'?alice:bob;await run(joined,{type:'club.request',id:capacityClub});assert.equal((await admin.query("select count(*)::int n from dartflow_private.mail_outbox where entity_id=$1 and template_id='club-decision'",[capacityClub])).rows[0].n,1);
  });
  await t.test('receipt replay rechecks bans, owner blocks and private ex-member scope',async()=>{
   const id=(await run(owner,{type:'club.create',name:'V17 revoked receipt scope'})).id!;clubs.push(id);const commandId=randomUUID(),action={type:'club.request',id};await run(alice,action,undefined,commandId);
   await admin.query("update dartflow_private.platform_members set status='banned' where entity_id=$1 and user_id=$2",[id,alice]);await assert.rejects(run(alice,action,undefined,commandId),{status:403});
   await admin.query("update dartflow_private.platform_members set status='pending' where entity_id=$1 and user_id=$2",[id,alice]);await run(owner,{type:'friend.block',userId:alice});await assert.rejects(run(alice,action,undefined,commandId),{status:403});await run(owner,{type:'friend.unblock',userId:alice});
   await admin.query("update dartflow_private.platform_members set status='left' where entity_id=$1 and user_id=$2",[id,alice]);await admin.query("update dartflow_private.platform_entities set visibility='private' where id=$1",[id]);await assert.rejects(run(alice,action,undefined,commandId),{status:403});
  });
  await t.test('ownership transfer is atomic and retained exactly once; lifecycle immediately revokes scoped grants',async()=>{
   const staleOwnerRow=await entity(database(),club);
   const race=await Promise.allSettled([run(owner,{type:'club.transfer',id:club,userId:reviewer}),run(owner,{type:'club.transfer',id:club,userId:bob})]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);const record=(await admin.query("select e.owner_id,count(*) filter(where m.role='owner' and m.status='active')::int owners from dartflow_private.platform_entities e join dartflow_private.platform_members m on m.entity_id=e.id where e.id=$1 group by e.owner_id",[club])).rows[0];assert.equal(record.owners,1);assert.notEqual(record.owner_id,owner);const refreshed=await clubView(database(),staleOwnerRow,owner);assert.equal(refreshed.ownerId,record.owner_id);assert.equal(refreshed.clubAccess.isOwner,false);assert.equal(refreshed.clubDetails.requests.some(r=>r.userId===alice),false);await assert.rejects(run(owner,{type:'club.role.save',id:club,name:'Stale owner',permissions:[]}),{status:403});
   await assert.rejects(database().query("update dartflow_private.platform_members set status='left' where entity_id=$1 and user_id=$2",[club,record.owner_id]),{code:'23514'});
   await run(record.owner_id,{type:'club.deactivate',id:club});assert.equal(await clubPermission(database(),club,reviewer,'members.approve'),false);await assert.rejects(run(bob,{type:'club.request',id:club}),{code:'club_inactive'});await run(record.owner_id,{type:'club.restore',id:club});assert.equal((await project(record.owner_id,club)).clubDetails.lifecycle,'active');
   await run(record.owner_id,{type:'club.deactivate',id:club});await admin.query("update dartflow_private.platform_entities set state=jsonb_set(state,'{deleteAfter}',to_jsonb('2000-01-01T00:00:00Z'::text)) where id=$1",[club]);await assert.rejects(run(record.owner_id,{type:'club.restore',id:club}),{code:'restore_expired'});
  });
 }finally{
  for(const club of clubs){for(const table of ['mail_outbox','mail_events','mail_templates','mail_template_versions','mail_policies'])await admin.query(`delete from dartflow_private.${table} where scope_key=$1`,[`club:${club}`]);await admin.query('delete from dartflow_private.club_join_requests where club_id=$1',[club]);await admin.query('delete from dartflow_private.club_invites where club_id=$1',[club]);await admin.query('delete from dartflow_private.platform_audit where entity_id=$1',[club]);await admin.query('delete from dartflow_private.platform_entities where id=$1',[club]);await admin.query('delete from dartflow_private.club_memberships where club_id=$1',[club]);await admin.query('delete from dartflow_private.club_intake_versions where club_id=$1',[club]);await admin.query('delete from dartflow_private.clubs where id=$1',[club]);}
  await admin.query('delete from dartflow_private.platform_audit where actor_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.platform_receipts where actor_id=any($1::uuid[])',[people]);await admin.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);await admin.end();await closeDatabase();
 }
});
