import test from 'node:test';
import assert from 'node:assert/strict';
import {MAIL_TEMPLATES,MAIL_TEMPLATE_IDS,initializeMail,resolveTemplate,renderMail,createMailItem,safeMailUrl} from '../public/mail-engine.js';

const payload=(templateId='challenge-invite',extra={})=>({templateId,eventId:'challenge-77-created',scopeId:701,recipient:{name:'Rick van Dijk',email:'rick@voorbeeld.test'},variables:{...MAIL_TEMPLATES.find(t=>t.id===templateId).example},...extra});

test('every catalog template has a complete accessible HTML and plain text example',()=>{
  assert.equal(new Set(MAIL_TEMPLATE_IDS).size,32);
  for(const t of MAIL_TEMPLATES){
    const result=renderMail(t,t.example);
    assert.deepEqual(result.missing,[],t.id);
    assert.match(result.html,/<html lang="nl">/);
    assert.match(result.html,/role="presentation"/);
    assert.match(result.html,/max-width:600px/);
    assert.ok(result.subject.length>0,t.id);
    assert.ok(result.text.includes('DARTFLOW'),t.id);
    assert.doesNotMatch(result.html,/{{\s*\w+\s*}}/,t.id);
    assert.doesNotMatch(result.text,/{{\s*\w+\s*}}/,t.id);
  }
});

test('untrusted placeholder and edited content cannot become HTML or unsafe CTA links',()=>{
  const t=MAIL_TEMPLATES.find(t=>t.id==='club-request');
  const hostile='<img src=x onerror=alert(1)> & "quoted"';
  const result=renderMail({...t,title:'<script>alert(1)</script> {{name}}'}, {...t.example,name:hostile,actorName:hostile,actionUrl:'javascript:alert(1)'});
  assert.ok(result.missing.includes('actionUrl'));
  assert.doesNotMatch(result.html,/<script|onerror="|href="javascript:/);
  const images=result.html.match(/<img\b[^>]*>/gi) || [];
  assert.equal(images.length,1);
  assert.match(images[0],/^<img src="https:\/\/[^"/]+\/assets\/dartflow-logo\.png" alt="DartFlow"/);
  assert.match(result.html,/&lt;script&gt;/);
  assert.match(result.html,/&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;quoted&quot;/);
  assert.equal(safeMailUrl('data:text/html,<script>bad</script>'),'');
  assert.equal(safeMailUrl('https://user:pass@example.test'),'');
  assert.equal(safeMailUrl('http://example.test/#test'),'http://example.test/#test');
});

test('actual event outbox fails on missing variables and invalid recipients without fixture substitution',()=>{
  const db={};
  const item=createMailItem(db,payload('challenge-invite',{recipient:{name:'Rick',email:'rick@example.test\r\nBcc:other@example.test'},variables:{name:'Rick',actionUrl:'https://example.test/#match'}}));
  assert.equal(item.status,'failed');
  assert.ok(item.missing.includes('actorName'));
  assert.ok(item.missing.includes('startScore'));
  assert.ok(item.missing.includes('recipient.email'));
  assert.doesNotMatch(item.text,/Mike de Bruin/);
  assert.throws(()=>createMailItem(db,{...payload(),eventId:''}),/eventId/);
});

test('published copy inherits platform then club; drafts and cross-club data never affect delivery',()=>{
  const db={};initializeMail(db);
  db.mail.templates.global={'club-decision':{published:{title:'Globaal titel',subject:'Globaal {{name}}'},version:3}};
  db.mail.templates['701']={'club-decision':{draft:{subject:'Nog concept'},published:{title:'Puinruimers titel'},version:2}};
  const club=resolveTemplate(db,'club-decision',701),other=resolveTemplate(db,'club-decision',703);
  assert.equal(club.title,'Puinruimers titel');
  assert.equal(club.subject,'Globaal {{name}}');
  assert.equal(other.title,'Globaal titel');
  assert.equal(other.inherited,true);
  db.mail.templates['701']['club-decision'].published.body='Nieuw {{unknownMandatory}}';
  assert.ok(resolveTemplate(db,'club-decision',701).variables.includes('unknownMandatory'));
});

test('idempotency includes event, recipient, template and tenant; sent snapshot survives later template edits',()=>{
  const db={};const request=payload();
  const first=createMailItem(db,request);
  assert.equal(first.status,'simulated');
  assert.equal(createMailItem(db,request),first);
  assert.equal(db.mail.outbox.length,1);
  createMailItem(db,payload('challenge-invite',{scopeId:703}));
  createMailItem(db,payload('challenge-invite',{recipient:{name:'Tom',email:'tom@voorbeeld.test'}}));
  assert.equal(db.mail.outbox.length,3);
  db.mail.templates['701']={'challenge-invite':{published:{subject:'Aangepast onderwerp'},version:2}};
  assert.notEqual(first.subject,'Aangepast onderwerp');
  assert.equal(first.version,1);
  assert.match(first.html,/Laat je pijlen spreken/);
});

test('disabled triggers and tenant pause suppress events; auth stays locked and its code is never logged',()=>{
  const db={};initializeMail(db);
  db.mail.templates.global={'club-request':{enabled:false},'auth-otp':{enabled:false,published:{title:'Globale Auth'}}};
  db.mail.templates['701']={'auth-otp':{enabled:false,published:{title:'Club mag Auth niet wijzigen'}}};
  assert.equal(createMailItem(db,payload('club-request')),null);
  assert.equal(createMailItem(db,payload('board-call')),null);
  assert.equal(resolveTemplate(db,'auth-otp',701).title,'Globale Auth');
  assert.equal(resolveTemplate(db,'auth-otp',701).enabled,true);
  db.mail.settings['701']={enabled:false};
  assert.equal(createMailItem(db,payload()),null);
  assert.equal(createMailItem(db,payload('challenge-invite',{kind:'test'})).status,'simulated');
  const otp=createMailItem(db,payload('auth-otp',{variables:{name:'Rick',actionUrl:'https://example.test',otp:'123456'}}));
  assert.equal(otp.status,'simulated');
  assert.equal(otp.variables.otp,'••••••');
  assert.doesNotMatch(JSON.stringify(db.mail),/123456/);
});

test('initialization preserves existing demo mail and domain data',()=>{
  const db={players:[{id:1}],mail:{outbox:[{id:'old'}],templates:{global:{welcome:{version:2}}},settings:{global:{enabled:true}},events:[{id:'old'}]}};
  initializeMail(db);initializeMail(db);
  assert.equal(db.mail.outbox.length,1);
  assert.equal(db.mail.templates.global.welcome.version,2);
  assert.equal(db.players[0].id,1);
});
