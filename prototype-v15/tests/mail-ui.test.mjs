import test from 'node:test';
import assert from 'node:assert/strict';
import {createMail} from '../public/mail.js';
import {MAIL_TEMPLATES,createMailItem,resolveTemplate} from '../public/mail-engine.js';

function harness(initialScope=null) {
  let scope=initialScope;
  const calls={saves:0,renders:0,modals:[],toasts:[]};
  const ctx={
    db:{role:'admin'},scopeId:()=>scope,scopeName:()=>scope===null?'Dartflow Wereldwijd':'De Puinruimers',
    icon:()=>'',esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    save:()=>calls.saves++,render:()=>calls.renders++,go:()=>{},toast:value=>calls.toasts.push(value),
    showModal:(...args)=>calls.modals.push(args),closeModal:()=>{},button:()=>''
  };
  const ui=createMail(ctx);ui.init();
  return {ctx,ui,calls,setScope:value=>scope=value};
}
const edit=(ui,values)=>ui.handleForm({dataset:{form:'mail-template'}},{scopeKey:'global',templateId:'welcome',...MAIL_TEMPLATES.find(t=>t.id==='welcome'),...values});
const action=(ui,name,id)=>ui.handleAction('mail-'+name,{dataset:{id}}, {preventDefault(){}});
const event=(db,id,scopeId=null)=>createMailItem(db,{templateId:'welcome',eventId:id,scopeId,recipient:{name:'Rick',email:'rick@voorbeeld.test'},variables:MAIL_TEMPLATES.find(t=>t.id==='welcome').example});

test('Draft stays separate from event mail until publication and publishes into future snapshots',()=>{
  const {ctx,ui}=harness();
  const original=resolveTemplate(ctx.db,'welcome').subject;
  edit(ui,{subject:'Concept voor {{name}}'});
  assert.equal(ctx.db.mail.templates.global.welcome.draft.subject,'Concept voor {{name}}');
  const before=event(ctx.db,'before-publication');
  assert.equal(before.subject,original.replace('{{name}}','Rick van Dijk'));
  action(ui,'publish','welcome');
  const after=event(ctx.db,'after-publication');
  assert.equal(after.subject,'Concept voor Rick van Dijk');
  assert.equal(after.version,2);
  assert.equal(before.template.subject,original);
});

test('Reading club editor preserves global inheritance while explicit club publication is isolated',()=>{
  const {ctx,ui,setScope}=harness();
  edit(ui,{subject:'Wereldwijd voor {{name}}'});action(ui,'publish','welcome');
  ctx.db.mail.templates.global['club-request']={enabled:false};
  setScope(701);ui.init();ui.render();
  assert.equal(resolveTemplate(ctx.db,'welcome',701).subject,'Wereldwijd voor {{name}}');
  assert.equal(resolveTemplate(ctx.db,'club-request',701).enabled,false);
  ui.handleForm({dataset:{form:'mail-template'}},{scopeKey:'701',templateId:'welcome',...MAIL_TEMPLATES.find(t=>t.id==='welcome'),subject:'Clubmail voor {{name}}'});
  action(ui,'publish','welcome');
  assert.equal(resolveTemplate(ctx.db,'welcome',701).subject,'Clubmail voor {{name}}');
  assert.equal(resolveTemplate(ctx.db,'welcome',702).subject,'Wereldwijd voor {{name}}');
  assert.equal(resolveTemplate(ctx.db,'welcome',null).subject,'Wereldwijd voor {{name}}');
});

test('Stale scope forms and player mutations are refused',()=>{
  const {ctx,ui,setScope,calls}=harness();
  setScope(701);edit(ui,{subject:'Verouderd formulier'});
  assert.equal(calls.saves,0);
  assert.equal(resolveTemplate(ctx.db,'welcome').subject,MAIL_TEMPLATES.find(t=>t.id==='welcome').subject);
  ctx.db.role='player';
  action(ui,'toggle','welcome');
  ui.handleForm({dataset:{form:'mail-settings'}},{scopeKey:'701',senderName:'Onbevoegd'});
  assert.equal(calls.saves,0);
  assert.equal(ctx.db.mail.settings['701'],undefined);
});

test('OTP preview and forged OTP test form do not create any outbox entry',()=>{
  const {ctx,ui,calls}=harness();
  action(ui,'test-open','auth-otp');
  assert.equal(calls.modals.length,1);
  assert.equal(ctx.db.mail.outbox.length,0);
  ui.handleForm({dataset:{form:'mail-test'}},{scopeKey:'global',templateId:'auth-otp',name:'Rick',email:'rick@voorbeeld.test'});
  assert.equal(ctx.db.mail.outbox.length,0);
});

test('Draft test records the reviewed draft and retry preserves snapshot despite later publication',()=>{
  const {ctx,ui}=harness();
  edit(ui,{subject:'Concepttest {{name}}',body:'Hoi {{name}}, {{missingExample}}'});
  ui.handleForm({dataset:{form:'mail-test'}},{scopeKey:'global',templateId:'welcome',name:'Danny',email:'danny@voorbeeld.test'});
  const item=ctx.db.mail.outbox[0];
  assert.equal(item.status,'failed');
  assert.equal(item.draft,true);
  assert.equal(item.subject,'Concepttest Danny');
  assert.equal(item.template.body,'Hoi {{name}}, {{missingExample}}');
  ctx.db.mail.templates.global.welcome.published={subject:'Nieuw gepubliceerd {{name}}',body:'Hoi {{name}}'};
  item.variables.missingExample='aangevuld';
  action(ui,'retry',item.id);
  assert.equal(item.status,'simulated');
  assert.equal(item.subject,'Concepttest Danny');
  assert.equal(item.template.subject,'Concepttest {{name}}');
  assert.equal(item.attempts,2);
});

test('Outbox stays scoped and failed test with invalid email cannot turn successful on retry',()=>{
  const {ctx,ui,setScope}=harness();
  ui.handleForm({dataset:{form:'mail-test'}},{scopeKey:'global',templateId:'welcome',name:'Rick',email:'invalid'});
  const item=ctx.db.mail.outbox[0];
  assert.equal(item.status,'failed');
  action(ui,'retry',item.id);
  assert.equal(item.status,'failed');
  const attempts=item.attempts;
  setScope(701);ui.init();
  action(ui,'retry',item.id);
  assert.equal(item.attempts,attempts);
  assert.ok(!ui.render().includes('invalid</small>'));
});
