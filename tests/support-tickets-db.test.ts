import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {closeDatabase,database} from '../lib/db';
import {requestAccountDeletion} from '../lib/account-removal';
import {getNativePush,executeNativePushCommand} from '../lib/native-push';
import {executeSupportCommand,getSupportTicket,getSupportTickets,supportNotificationRecipientEligible} from '../lib/support-tickets';
import type {SupportAction,SupportCommand,SupportTicketDetail} from '../lib/support-types';
try{process.loadEnvFile('.env.local');}catch{/* CI injects explicit loopback targets. */}
const local=(value?:string)=>{try{return!!value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
const enabled=process.env.DARTFLOW_DATA_MODE==='local'&&local(process.env.DARTFLOW_DATABASE_URL)&&local(process.env.DARTFLOW_DATABASE_ADMIN_URL);

test('support tickets preserve public privacy, current authority, transactional events and canonical DF identities',{skip:!enabled},async t=>{
 const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
 const worker=new pg.Pool({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL,options:'-c role=dartflow_privacy_worker',max:1});
 const user=randomUUID(),other=randomUUID(),admin=randomUUID(),agent=randomUUID(),clubOwner=randomUUID(),erased=randomUUID(),badMail=randomUUID(),actors=[user,other,admin,agent,clubOwner,erased,badMail],club=randomUUID(),marker=randomUUID();
 const ticketIds:string[]=[],requests:string[]=[];
 const cmd=async(actor:string,action:SupportAction,expectedRevision?:number,requestId:string=randomUUID())=>{requests.push(requestId);const response=await executeSupportCommand(actor,{requestId,expectedRevision,action});if(!ticketIds.includes(response.ticket.id))ticketIds.push(response.ticket.id);return response;};
 const own=async(actor:string,id:string)=>(await getSupportTicket(actor,id)).ticket;
 const managed=async(id:string)=>(await getSupportTicket(admin,id,true)).ticket;
 const mail=async(id:string,template?:string)=>(await owner.query('select * from dartflow_private.mail_outbox where entity_id=$1 and($2::text is null or template_id=$2)order by created_at,id',[id,template??null])).rows;
 const count=async(table:string,where:string,args:unknown[])=>(await owner.query(`select count(*)::int n from dartflow_private.${table} where ${where}`,args)).rows[0].n;
 let ticket:SupportTicketDetail,creation:SupportCommand,otherTicket='',originalNumber='';
 try{
  for(const[index,id]of actors.entries())await owner.query('insert into dartflow_private.profiles(id,name,display_name,display_name_confirmed,email,email_verified)values($1,$2,$3,true,$4,true)',[id,`support${index}${marker.replaceAll('-','')}`,'Public support fixture',id===badMail?'invalid-address':`support-${id}@example.com`]);
  await owner.query("insert into dartflow_private.platform_roles(user_id,role)values($1,'admin'),($2,'admin')",[admin,agent]);
  await owner.query('insert into dartflow_private.clubs(id,name)values($1,$2)',[club,`Support ACL ${marker}`]);await owner.query("insert into dartflow_private.club_memberships(club_id,user_id,role)values($1,$2,'organizer')",[club,clubOwner]);
  await t.test('concurrent retries create one server-numbered ticket, one receipt and one neutral acknowledgment',async()=>{
   creation={requestId:randomUUID(),action:{type:'ticket.create',category:'playing',subject:`Private subject ${marker}`,body:`Private original description ${marker}`}};requests.push(creation.requestId);
   const results=await Promise.all([executeSupportCommand(user,creation),executeSupportCommand(user,creation)]);ticket=results[0].ticket;originalNumber=ticket.number;ticketIds.push(ticket.id);
   assert.equal(results[1].ticket.id,ticket.id);assert.match(ticket.number,/^DF-[1-9]\d+$/);assert.equal(results.filter(r=>r.replayed).length,1);assert.equal(ticket.revision,1);assert.equal(ticket.timeline.length,1);assert.equal(ticket.waitingOn,'support');assert.equal(ticket.management,undefined);
   assert.equal(await count('support_ticket_receipts','actor_id=$1 and request_id=$2',[user,creation.requestId]),1);assert.equal(await count('support_ticket_events','ticket_id=$1',[ticket.id]),1);
   const acknowledgments=await mail(ticket.id,'support-received');assert.equal(acknowledgments.length,1);assert.equal(acknowledgments[0].recipient_id,user);assert.ok(JSON.stringify(acknowledgments[0].snapshot).includes(ticket.number));assert.ok(!JSON.stringify(acknowledgments[0].snapshot).includes(marker));
   assert.equal(await count('native_push_inbox',"recipient_id=$1 and template_id='support-received'",[user]),0);
   const created=await mail(ticket.id,'support-created');assert.ok(created.some(r=>r.recipient_id===admin));assert.ok(created.some(r=>r.recipient_id===agent));assert.ok(created.every(r=>r.recipient_id!==user));
   await assert.rejects(executeSupportCommand(user,{...creation,action:{...creation.action,subject:'Altered retry'}as SupportAction}),{code:'request_reused'});
  });
  await t.test('different creations receive unique DF numbers and own lists page and search server-side',async()=>{
   const results=await Promise.all([cmd(user,{type:'ticket.create',category:'boards',subject:`Second ${marker}`,body:'A second question'}),cmd(other,{type:'ticket.create',category:'account',subject:`Other ${marker}`,body:'An unrelated owner'})]);
   otherTicket=results[1].ticket.id;assert.equal(new Set([ticket.number,...results.map(r=>r.ticket.number)]).size,3);
   const ownList=await getSupportTickets(user,{q:marker,limit:1});assert.equal(ownList.total,2);assert.equal(ownList.tickets.length,1);assert.equal((await getSupportTickets(user,{q:marker,limit:1,offset:1})).tickets.length,1);assert.equal((await getSupportTickets(user,{q:ticket.number})).tickets[0].id,ticket.id);assert.equal((await getSupportTickets(user,{category:'account',q:marker})).total,0);
   for(const actor of[other,clubOwner]){await assert.rejects(getSupportTicket(actor,ticket.id),{status:404});await assert.rejects(getSupportTicket(actor,ticket.id,true),{code:'forbidden'});await assert.rejects(getSupportTickets(actor,{},true),{code:'forbidden'});await assert.rejects(cmd(actor,{type:'ticket.admin.note',ticketId:ticket.id,body:'Forged administration'},1),{code:'forbidden'});}
   await assert.rejects(cmd(other,{type:'ticket.reply',ticketId:ticket.id,body:'Foreign reply'},1),{status:404});
   await assert.rejects(getSupportTickets(user,{priority:'urgent'}),{code:'support_input'});await assert.rejects(getSupportTickets(user,{limit:101}),{code:'support_input'});
  });
  await t.test('internal notes, priority and assignment leave the entire owner projection and search unchanged',async()=>{
   const before=await own(user,ticket.id);let internal=await managed(ticket.id);
   internal=(await cmd(admin,{type:'ticket.admin.note',ticketId:ticket.id,body:`SECRET-INTERNAL-${marker}`},internal.revision)).ticket;
   internal=(await cmd(admin,{type:'ticket.admin.update',ticketId:ticket.id,priority:'urgent',assigneeId:agent},internal.revision)).ticket;
   assert.deepEqual(await own(user,ticket.id),before);assert.equal((await getSupportTickets(user,{q:`SECRET-INTERNAL-${marker}`})).total,0);assert.equal((await getSupportTickets(admin,{q:`SECRET-INTERNAL-${marker}`,priority:'urgent',assignee:agent},true)).tickets[0].id,ticket.id);
   assert.equal(internal.management!.assignee!.id,agent);assert.equal(internal.management!.priority,'urgent');assert.equal(internal.management!.timeline.filter(e=>e.visibility==='internal').length,3);assert.ok(internal.management!.timeline.filter(e=>e.visibility==='internal').every(e=>e.actor?.id===admin&&Number.isFinite(Date.parse(e.createdAt))));assert.equal((await mail(ticket.id)).filter(r=>['support-answered','support-status-changed'].includes(r.template_id)).length,0);
   await assert.rejects(cmd(admin,{type:'ticket.admin.update',ticketId:ticket.id,assigneeId:clubOwner},internal.revision),{code:'support_assignee'});
   ticket=before;
  });
  await t.test('a public reply and its status change produce one owner notification with a direct private destination',async()=>{
   const internal=await managed(ticket.id);const requestId=randomUUID();const action:SupportAction={type:'ticket.admin.reply',ticketId:ticket.id,body:`Public answer ${marker}`,status:'waiting_for_user'};
   const answered=await cmd(admin,action,internal.revision,requestId);await cmd(admin,action,internal.revision,requestId);
   ticket=await own(user,ticket.id);assert.equal(ticket.status,'waiting_for_user');assert.equal(ticket.waitingOn,'user');assert.equal(ticket.revision,2);assert.equal(ticket.timeline.at(-1)!.body,`Public answer ${marker}`);assert.equal(ticket.timeline.at(-1)!.actorName,'DartFlow Support');assert.equal(answered.ticket.management!.publicRevision,ticket.revision);
   const jobs=await mail(ticket.id,'support-answered');assert.equal(jobs.length,1);assert.equal(jobs[0].recipient_id,user);assert.equal(jobs[0].snapshot.communication.href,`/app/support/${ticket.id}`);assert.ok(!jobs[0].snapshot.communication.body.includes(marker));assert.equal(await count('support_ticket_events',"ticket_id=$1 and kind='status'",[ticket.id]),0);
   const inboxId=(await owner.query("select id from dartflow_private.native_push_inbox where recipient_id=$1 and template_id='support-answered'and event_id=$2",[user,jobs[0].event_id])).rows[0].id;
   const item=(await getNativePush(user)).items.find(row=>row.id===inboxId)!;assert.equal(item.available,true);assert.equal(item.href,`/app/support/${ticket.id}`);assert.ok(item.title.includes(ticket.number));assert.equal(item.actor,undefined);assert.ok(!JSON.stringify(item).includes(marker));
   assert.deepEqual(await executeNativePushCommand(user,{requestId:randomUUID(),action:{type:'notification.open',id:inboxId}}),{ok:true,available:true,href:`/app/support/${ticket.id}`});assert.equal((await getNativePush(user)).items.find(row=>row.id===inboxId)!.opened,true);
   const reply=await cmd(user,{type:'ticket.reply',ticketId:ticket.id,body:'My requested follow-up'},ticket.revision);ticket=reply.ticket;assert.equal(ticket.status,'in_progress');assert.equal(ticket.waitingOn,'support');const responses=await mail(ticket.id,'support-user-replied');assert.equal(responses.length,1);assert.equal(responses[0].recipient_id,agent);
  });
  await t.test('close and reopen preserve identity, reject stale concurrency and replay accepted actions after closure',async()=>{
   const revision=ticket.revision;const race=await Promise.allSettled([cmd(user,{type:'ticket.reply',ticketId:ticket.id,body:'First device'},revision),cmd(user,{type:'ticket.close',ticketId:ticket.id},revision)]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.filter(r=>r.status==='rejected'&&r.reason.code==='revision_conflict').length,1);
   ticket=await own(user,ticket.id);if(ticket.status!=='closed')ticket=(await cmd(user,{type:'ticket.close',ticketId:ticket.id},ticket.revision)).ticket;
   await assert.rejects(cmd(user,{type:'ticket.reply',ticketId:ticket.id,body:'Closed conversation'},ticket.revision),{code:'ticket_closed'});
   assert.equal((await executeSupportCommand(user,creation)).ticket.id,ticket.id);assert.equal((await executeSupportCommand(user,creation)).replayed,true);
   ticket=(await cmd(user,{type:'ticket.reopen',ticketId:ticket.id,body:'The question remains'},ticket.revision)).ticket;assert.equal(ticket.status,'in_progress');assert.equal(ticket.waitingOn,'support');assert.equal(ticket.number,originalNumber);assert.ok((await mail(ticket.id,'support-reopened')).every(r=>r.recipient_id===agent));
   const internal=await managed(ticket.id);const resolved=await cmd(admin,{type:'ticket.admin.status',ticketId:ticket.id,status:'resolved',reason:'Resolution recorded'},internal.revision);assert.equal(resolved.ticket.status,'resolved');assert.equal((await mail(ticket.id,'support-status-changed')).length,1);assert.equal((await own(user,ticket.id)).permissions.canReopen,true);
  });
  await t.test('role revocation rejects known receipts and fresh recipient selection falls back to the authorized queue',async()=>{
   const current=await getSupportTicket(agent,ticket.id,true),action:SupportAction={type:'ticket.admin.note',ticketId:ticket.id,body:'A former staff note'},requestId=randomUUID();await cmd(agent,action,current.ticket.revision,requestId);
   await owner.query('delete from dartflow_private.platform_roles where user_id=$1',[agent]);await assert.rejects(cmd(agent,action,current.ticket.revision,requestId),{code:'forbidden'});await assert.rejects(getSupportTicket(agent,ticket.id,true),{code:'forbidden'});
   const ref={ticketId:ticket.id,ticketNumber:ticket.number,recipientView:'support'as const};assert.equal(await supportNotificationRecipientEligible(database(),agent,ref),false);assert.equal(await supportNotificationRecipientEligible(database(),admin,ref),true);assert.equal(await supportNotificationRecipientEligible(database(),clubOwner,ref),false);
   const oldInbox=(await owner.query("select id from dartflow_private.native_push_inbox where recipient_id=$1 and reference#>>'{communication,reference,ticketId}'=$2 order by created_at limit 1",[agent,ticket.id])).rows[0].id;
   const revoked=(await getNativePush(agent)).items.find(row=>row.id===oldInbox)!;assert.equal(revoked.available,false);assert.equal(revoked.href,undefined);const opened=await executeNativePushCommand(agent,{requestId:randomUUID(),action:{type:'notification.open',id:oldInbox}});assert.ok('available'in opened);assert.equal(opened.available,false);
   ticket=await own(user,ticket.id);await cmd(user,{type:'ticket.reopen',ticketId:ticket.id},ticket.revision);const newest=(await mail(ticket.id,'support-reopened')).filter(r=>r.recipient_id===admin);assert.equal(newest.length,1);assert.equal((await getSupportTickets(admin,{status:'open',q:marker},true)).tickets.some(r=>r.id===ticket.id),true);
  });
  await t.test('subject and category changes retain the UUID and DF number and publish only a public details event',async()=>{
   const current=await managed(ticket.id),changed=(await cmd(admin,{type:'ticket.admin.update',ticketId:ticket.id,subject:`Revised subject ${marker}`,category:'competition'},current.revision)).ticket;
   assert.equal(changed.id,ticket.id);assert.equal(changed.number,originalNumber);const publicView=await own(user,ticket.id);assert.equal(publicView.subject,`Revised subject ${marker}`);assert.equal(publicView.category,'competition');assert.equal(publicView.timeline.at(-1)!.type,'details');assert.equal(publicView.revision,current.management!.publicRevision+1);assert.equal(JSON.stringify(publicView).includes('previousSubject'),false);
  });
  await t.test('a real notification validation failure rolls back the ticket, events and earlier queued recipients',async()=>{
   const requestId=randomUUID(),subject=`Rollback ${marker}`;requests.push(requestId);await assert.rejects(executeSupportCommand(badMail,{requestId,action:{type:'ticket.create',category:'other',subject,body:'Invalid verified mail prevents enqueue'}}),{code:'email'});
   assert.equal(await count('support_tickets','owner_id=$1',[badMail]),0);assert.equal(await count('support_ticket_receipts','actor_id=$1 and request_id=$2',[badMail,requestId]),0);assert.equal(await count('mail_events','actor_id=$1',[badMail]),0);
  });
  await t.test('legacy empty timelines and missing owner labels remain safe while invalid input cannot forge identity',async()=>{
   const id=randomUUID();ticketIds.push(id);await owner.query('insert into dartflow_private.support_tickets(id,owner_id,category,subject)values($1,$2,$3,$4)',[id,user,'other','Imported historical question']);assert.deepEqual((await own(user,id)).timeline,[]);assert.deepEqual((await managed(id)).management!.timeline,[]);
   await assert.rejects(executeSupportCommand(user,{requestId:randomUUID(),action:{type:'ticket.create',category:'other',subject:'',body:'Missing subject'}}),{code:'invalid_text'});
   await assert.rejects(executeSupportCommand(user,{requestId:randomUUID(),action:{type:'ticket.create',category:'other',subject:'Forged',body:'Body',number:'DF-1'}}as unknown as SupportCommand),{code:'support_input'});
   await assert.rejects(executeSupportCommand(user,{requestId:randomUUID(),action:{type:'ticket.close',ticketId:id}}),{code:'revision_required'});
  });
  await t.test('runtime cannot rewrite ticket identity, sequence, audit events or idempotency receipts',async()=>{
   await assert.rejects(database().query('update dartflow_private.support_tickets set ticket_number=1 where id=$1',[ticket.id]),{code:'42501'});await assert.rejects(owner.query('update dartflow_private.support_tickets set ticket_number=1 where id=$1',[ticket.id]),{code:'23514'});
   await assert.rejects(database().query("select setval('dartflow_private.support_ticket_number_seq',1)"),{code:'42501'});
   for(const table of['support_ticket_events','support_ticket_receipts']){await assert.rejects(database().query(`delete from dartflow_private.${table} where ticket_id=$1`,[ticket.id]),{code:'42501'});await assert.rejects(database().query(`update dartflow_private.${table} set ticket_id=$1 where ticket_id=$1`,[ticket.id]),{code:'42501'});}
   const checks=(await owner.query("select relrowsecurity from pg_class where oid=any(array['dartflow_private.support_tickets'::regclass,'dartflow_private.support_ticket_events'::regclass,'dartflow_private.support_ticket_receipts'::regclass])")).rows;assert.equal(checks.length,3);assert.ok(checks.every(r=>r.relrowsecurity));
   const request=randomUUID(),audit=randomUUID();await owner.query("insert into dartflow_private.notification_commands(environment,actor_id,request_id,payload_hash,response)values('development',$1,$2,$3,'{}')",[admin,request,'immutable-fixture']);await owner.query("insert into dartflow_private.notification_rule_audit(id,environment,event_id,channel,actor_id,old_mode,new_mode)values($1,'development','support-created','inbox',$2,'follow','on')",[audit,admin]);
   for(const[table,where,args]of[['notification_commands','actor_id=$1 and request_id=$2',[admin,request]],['notification_rule_audit','id=$1',[audit]]]as const){await assert.rejects(database().query(`delete from dartflow_private.${table} where ${where}`,[...args]),{code:'42501'});await assert.rejects(database().query(`update dartflow_private.${table} set actor_id=$1 where actor_id=$1`,[admin]),{code:'42501'});assert.equal(await count(table,where,[...args]),1);}
   await assert.rejects(database().query('select dartflow_private.scrub_support_account($1)',[user]),{code:'42501'});await assert.rejects(worker.query('select dartflow_private.scrub_support_account($1)',[user]),{code:'42501'});
  });
  await t.test('confirmed erasure removes private ticket content and access while retaining unrelated conversations',async()=>{
   const personal=(await cmd(erased,{type:'ticket.create',category:'account',subject:`Erase subject ${marker}`,body:`Erase body ${marker}`})).ticket;await cmd(admin,{type:'ticket.admin.note',ticketId:personal.id,body:`Erase internal ${marker}`},personal.revision);
   const unrelatedBefore=await own(other,otherTicket);
   await requestAccountDeletion(erased,{requestId:randomUUID(),confirmation:'VERWIJDEREN'},{recentAuth:true});await assert.rejects(getSupportTicket(erased,personal.id),{code:'account_deleted'});assert.ok((await owner.query('select body from dartflow_private.support_ticket_events where ticket_id=$1',[personal.id])).rows.some(r=>r.body));
   const job=(await owner.query('select id from dartflow_private.account_deletion_jobs where actor_id=$1',[erased])).rows[0].id,lease=randomUUID();await owner.query("update dartflow_private.account_deletion_jobs set lease_token=$2,lease_until=clock_timestamp()+interval '5 minutes'where id=$1",[job,lease]);await worker.query('select dartflow_private.erase_account_job($1,$2)',[job,lease]);
   const scrubbed=await managed(personal.id);assert.equal(scrubbed.subject,'Verwijderd supportticket');assert.equal(scrubbed.status,'closed');assert.ok(scrubbed.management!.timeline.every(e=>e.body===null&&Object.keys(e.changes).length===0&&e.actor===null));assert.equal(scrubbed.permissions.canReply,false);assert.equal(scrubbed.permissions.canReopen,false);assert.equal(await count('support_ticket_receipts','ticket_id=$1',[personal.id]),0);assert.deepEqual(await own(other,otherTicket),unrelatedBefore);
  });
 }finally{
  try{
   const ids=(await owner.query('select id from dartflow_private.support_tickets where owner_id=any($1::uuid[])or id=any($2::uuid[])',[actors,ticketIds])).rows.map(r=>r.id);
   await owner.query('delete from dartflow_private.mail_provider_events where job_id in(select id from dartflow_private.mail_outbox where entity_id=any($1::uuid[])or recipient_id=any($2::uuid[]))',[ids,actors]);await owner.query('delete from dartflow_private.mail_outbox where entity_id=any($1::uuid[])or recipient_id=any($2::uuid[])',[ids,actors]);await owner.query('delete from dartflow_private.mail_events where actor_id=any($1::uuid[])or recipient_key=any($2::text[])',[actors,actors.map(id=>`user:${id}`)]);
   await owner.query("delete from dartflow_private.native_push_inbox where recipient_id=any($1::uuid[])or reference#>>'{communication,reference,ticketId}'=any($2::text[])",[actors,ids]);await owner.query('delete from dartflow_private.support_tickets where id=any($1::uuid[])',[ids]);await owner.query('delete from dartflow_private.notification_commands where actor_id=any($1::uuid[])',[actors]);await owner.query('delete from dartflow_private.notification_rule_audit where actor_id=any($1::uuid[])',[actors]);await owner.query('delete from dartflow_private.account_deletion_jobs where actor_id=any($1::uuid[])',[actors]);await owner.query('delete from dartflow_private.club_memberships where club_id=$1',[club]);await owner.query('delete from dartflow_private.clubs where id=$1',[club]);await owner.query('delete from dartflow_private.platform_roles where user_id=any($1::uuid[])',[actors]);await owner.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[actors]);
  }finally{await worker.end();await owner.end();await closeDatabase();}
 }
});
