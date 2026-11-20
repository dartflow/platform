import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { MAIL_CATALOG } from '../lib/integrations-catalog';
import { decryptCredential, encryptCredential, integrationRuntime, mailScopeAccess, type Envelope } from '../lib/integrations-core';
import { deliveryStatus, retryAfterSeconds, renderMail, transportBoundary, validateMailFields } from '../lib/integrations-mail';
try{process.loadEnvFile('.env.local');}catch{/* CI injects loopback URLs. */}

function runtime(values:Record<string,string|undefined>,run:()=>void) {const saved=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));try{for(const [key,value]of Object.entries(values)){if(value===undefined)delete process.env[key];else process.env[key]=value;}run();}finally{for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}}
const base={DARTFLOW_DATA_MODE:'local',DARTFLOW_APP_ORIGIN:'http://localhost:3000',DARTFLOW_ENV:'development'};
test('mail catalog preserves original templates and includes scoped club and season follow-up notices',()=>{const originalIds=["auth-otp","welcome","club-request","club-decision","club-role","friend-request","friend-accepted","challenge-invite","challenge-accepted","challenge-cancelled","fixture-scheduled","fixture-changed","fixture-reminder","competition-entry","tournament-entry","tournament-approved","tournament-rejected","tournament-changed","tournament-waitlist","tournament-promoted","tournament-withdrawn","tournament-reminder","board-call","result-confirm","result-confirmed","result-disputed","result-resolved","room-invite","moderation-notice","moderation-report","registration-received","registration-decision"];assert.equal(originalIds.length,32);assert.deepEqual(MAIL_CATALOG.map(row=>row.id).sort(),[...originalIds,'club-invite','club-request-received','fixture-overdue','season-team-role','season-reserve','season-completed','season-play-mode','competition-lobby-ready','club-activity-update','club-activity-withdrawal','club-task-update'].sort());assert.equal(new Set(MAIL_CATALOG.map(row=>row.id)).size,43);assert.equal(MAIL_CATALOG.find(row=>row.id==='auth-otp')?.readOnly,true);assert.equal(MAIL_CATALOG.find(row=>row.id==='board-call')?.enabled,false);for(const row of MAIL_CATALOG.filter(row=>!row.readOnly))assert.deepEqual(validateMailFields(row.id,row.fields),row.fields);assert.throws(()=>validateMailFields('auth-otp',MAIL_CATALOG[0].fields),{code:'auth_template'});});
test('template validation rejects unknown variables, HTML field injection and header newlines',()=>{const template=MAIL_CATALOG.find(row=>row.id==='welcome')!;assert.throws(()=>validateMailFields(template.id,{...template.fields,subject:'{{otp}}'}),{code:'mail_variable'});assert.throws(()=>validateMailFields(template.id,{...template.fields,subject:'Hello\r\nBcc: attacker@example.com'}),{code:'mail_fields'});assert.throws(()=>validateMailFields(template.id,{...template.fields,html:'<script />'}),{code:'unknown_field'});});
test('renderer escapes every text context and chooses a fixed app-owned CTA',()=>{runtime(base,()=>{const template=MAIL_CATALOG.find(row=>row.id==='welcome')!;const rendered=renderMail('welcome',{...template.fields,body:'{{name}} <img src=x onerror=alert(1)>'},{name:'<script>alert("x")</script>',actionUrl:'https://evil.example/steal'});assert.ok(!rendered.html.includes('<script>'));assert.ok(!rendered.html.includes('<img src=x'));assert.ok(rendered.html.includes('&lt;script&gt;'));assert.ok(rendered.html.includes('href="http://localhost:3000/app"'));assert.ok(!rendered.html.includes('evil.example'));assert.ok(rendered.text.includes('<script>'));});});
test('authenticated encryption binds envelopes to environment, project and secret kind with fresh nonces',()=>{const key=randomBytes(32).toString('base64');runtime({...base,DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY:key},()=>{const secret='re_private_test_credential';const first=encryptCredential(secret,'resend-api'),second=encryptCredential(secret,'resend-api');assert.notEqual(first.nonce,second.nonce);assert.notEqual(first.ciphertext,second.ciphertext);assert.equal(decryptCredential(first,'resend-api'),secret);assert.ok(!JSON.stringify(first).includes(secret));assert.throws(()=>decryptCredential(first,'resend-webhook'),{code:'credential_invalid'});const changed={...first,ciphertext:Buffer.from('tampered').toString('base64')} satisfies Envelope;assert.throws(()=>decryptCredential(changed,'resend-api'),{code:'credential_invalid'});runtime({DARTFLOW_ENV:'staging'},()=>assert.throws(()=>decryptCredential(first,'resend-api'),{code:'credential_invalid'}));});});
test('credential storage fails closed without an exact 32-byte server key',()=>{runtime({...base,DARTFLOW_INTEGRATIONS_ENCRYPTION_KEY:'not-a-key'},()=>assert.throws(()=>encryptCredential('re_private','resend-api'),{code:'encryption_unconfigured'}));});
test('fixed Supabase project binding rejects cross-environment configuration',()=>{runtime({DARTFLOW_DATA_MODE:'supabase',DARTFLOW_APP_ORIGIN:'https://staging.dartflow.nl',DARTFLOW_ENV:'staging',NEXT_PUBLIC_SUPABASE_URL:'https://wlrnowuownakqqgjxnbb.supabase.co'},()=>assert.throws(()=>integrationRuntime(),{code:'integration_project'}));runtime({DARTFLOW_DATA_MODE:'supabase',DARTFLOW_APP_ORIGIN:'https://dartflow.nl',DARTFLOW_ENV:'production',NEXT_PUBLIC_SUPABASE_URL:'https://wlrnowuownakqqgjxnbb.supabase.co'},()=>assert.equal(integrationRuntime().projectRef,'wlrnowuownakqqgjxnbb'));});
test('transport checks both exact recipient allowlists again and cannot widen the runtime mode',()=>{runtime({...base,DARTFLOW_MAIL_MAX_MODE:'test',DARTFLOW_MAIL_TEST_RECIPIENTS:'allowed@example.com'},()=>{const settings={mode:'test' as const,from:null,replyTo:null,testRecipients:['allowed@example.com']};assert.equal(transportBoundary({environment:'development',recipient:'allowed@example.com',kind:'test'},settings),'send');assert.equal(transportBoundary({environment:'development',recipient:'other@example.com',kind:'test'},settings),'suppress');assert.equal(transportBoundary({environment:'development',recipient:'allowed@example.com',kind:'test'},{...settings,testRecipients:[]}),'suppress');assert.equal(transportBoundary({environment:'development',recipient:'allowed@example.com',kind:'test'},{...settings,mode:'live'}),'suppress');assert.equal(transportBoundary({environment:'development',recipient:'other@example.com',kind:'event'},{...settings,mode:'log'}),'log');assert.throws(()=>transportBoundary({environment:'production',recipient:'allowed@example.com',kind:'test'},settings),{code:'mail_environment'});});});
test('late accepted events cannot undo delivery or complaint and complaint wins after delivery',()=>{assert.equal(deliveryStatus('delivered','email.sent'),'delivered');assert.equal(deliveryStatus('delivered','email.complained'),'complained');assert.equal(deliveryStatus('complained','email.delivered'),'complained');assert.equal(deliveryStatus('bounced','email.sent'),'bounced');assert.equal(deliveryStatus('accepted','email.delivered'),'delivered');assert.equal(deliveryStatus('accepted','contact.created'),'accepted');});

test('retry scheduling respects bounded Retry-After seconds and HTTP dates',()=>{const now=Date.parse('2026-11-11T12:00:00Z');assert.equal(retryAfterSeconds('120',now),120);assert.equal(retryAfterSeconds('99999',now),3600);assert.equal(retryAfterSeconds('Wed, 11 Nov 2026 12:02:00 GMT',now),120);assert.equal(retryAfterSeconds('Wed, 11 Nov 2026 11:59:00 GMT',now),null);assert.equal(retryAfterSeconds('invalid',now),null);});

const loopback=(value:string|undefined)=>{try{return !!value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
const localDatabase=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL)&&loopback(process.env.DARTFLOW_DATABASE_URL);
test('club mail access follows current settings grants and lifecycle while preserving explicit platform ownership',{skip:!localDatabase},async()=>{
 const admin=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL}),appPool=new pg.Pool({connectionString:process.env.DARTFLOW_DATABASE_URL});
 const club=randomUUID(),owner=randomUUID(),manager=randomUUID(),editor=randomUUID(),platformOwner=randomUUID(),role=randomUUID(),people=[owner,manager,editor,platformOwner],scope=`club:${club}`;
 await admin.connect();const app=await appPool.connect();
 try{
  await admin.query('begin');
  for(const id of people)await admin.query('insert into dartflow_private.profiles(id,name) values($1,$2)',[id,`Mail-${id.slice(0,8)}`]);
  await admin.query('insert into dartflow_private.clubs(id,name) values($1,$2)',[club,'Scoped mail regression']);
  for(const [id,coreRole]of [[owner,'organizer'],[manager,'organizer'],[editor,'player']])await admin.query('insert into dartflow_private.club_memberships(club_id,user_id,role) values($1,$2,$3)',[club,id,coreRole]);
  await admin.query("insert into dartflow_private.platform_entities(id,kind,owner_id,visibility,state) values($1,'club',$2,'public',$3)",[club,owner,JSON.stringify({name:'Scoped mail regression',lifecycle:'active'})]);
  for(const [id,baseRole]of [[owner,'owner'],[manager,'admin'],[editor,'member']])await admin.query("insert into dartflow_private.platform_members(entity_id,user_id,role,status) values($1,$2,$3,'active')",[club,id,baseRole]);
  await admin.query('insert into dartflow_private.club_roles(club_id,id,name,permissions) values($1,$2,$3,$4)',[club,role,'Mail editor',['settings.edit']]);
  await admin.query('insert into dartflow_private.club_member_roles(club_id,user_id,role_id) values($1,$2,$3)',[club,editor,role]);
  await admin.query("insert into dartflow_private.platform_roles(user_id,role) values($1,'owner')",[platformOwner]);
  await admin.query('commit');
  for(const actor of [owner,manager,editor])await mailScopeAccess(actor,scope,app);
  await assert.rejects(mailScopeAccess(editor,'platform',app),{code:'owner_required'});
  await admin.query('update dartflow_private.club_roles set permissions=$3 where club_id=$1 and id=$2',[club,role,[]]);
  await assert.rejects(mailScopeAccess(editor,scope,app),{code:'mail_forbidden'});
  await admin.query("update dartflow_private.platform_members set status='left' where entity_id=$1 and user_id=$2",[club,manager]);
  await assert.rejects(mailScopeAccess(manager,scope,app),{code:'mail_forbidden'});
  for(const lifecycle of ['inactive','deleted']){
   await admin.query("update dartflow_private.platform_entities set state=jsonb_set(state,'{lifecycle}',to_jsonb($2::text)) where id=$1",[club,lifecycle]);
   await assert.rejects(mailScopeAccess(owner,scope,app),{code:'mail_forbidden'});
   await assert.rejects(mailScopeAccess(manager,scope,app),{code:'mail_forbidden'});
   await mailScopeAccess(platformOwner,scope,app);
  }
  await mailScopeAccess(platformOwner,'platform',app);
 }finally{
  await admin.query('rollback');
  await admin.query('delete from dartflow_private.platform_entities where id=$1',[club]);
  await admin.query('delete from dartflow_private.clubs where id=$1',[club]);
  await admin.query('delete from dartflow_private.platform_roles where user_id=$1',[platformOwner]);
  await admin.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[people]);
  app.release();await Promise.all([admin.end(),appPool.end()]);
 }
});
