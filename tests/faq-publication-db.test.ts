import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {closeDatabase,database} from '../lib/db';
import {executeFaqAdminCommand,getFaqAdmin,getPublishedFaq} from '../lib/faq-publication';
import type {FaqAdminCommand} from '../lib/faq-publication';
try{process.loadEnvFile('.env.local');}catch{/* Explicit local fixtures only. */}
const local=(value?:string)=>{try{return Boolean(value&&['127.0.0.1','localhost','[::1]'].includes(new URL(value).hostname));}catch{return false;}};
const enabled=process.env.DARTFLOW_DATA_MODE==='local'&&local(process.env.DARTFLOW_DATABASE_URL)&&local(process.env.DARTFLOW_DATABASE_ADMIN_URL);
test('FAQ drafts, preview and immutable publications share one version without exposing unpublished content',{skip:!enabled},async t=>{
 const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();const editor=randomUUID(),viewer=randomUUID(),questionId=`fixture-${randomUUID()}`,actors=[editor,viewer];
 const command=(action:FaqAdminCommand['action'],actor=editor,requestId:string=randomUUID())=>executeFaqAdminCommand(actor,{requestId,action});
 try{
  for(const [index,id] of actors.entries())await owner.query('insert into dartflow_private.profiles(id,name)values($1,$2)',[id,`faq_${questionId}_${index}`]);
  await owner.query("insert into dartflow_private.platform_roles(user_id,role)values($1,'admin')",[editor]);
  const initial=await getPublishedFaq(),item={id:questionId,question:'Een nieuwe openbare vraag?',answer:'Dit antwoord is nog een concept.',category:'Organiseren',keywords:['accent','café'],audience:'organizer' as const};
  const save={type:'faq.save' as const,questionId,expectedRevision:0,item},requestId=randomUUID(),saved=await command(save,editor,requestId);
  await t.test('draft save is private, role checked and idempotent',async()=>{
   assert.deepEqual(await command(save,editor,requestId),saved);assert.equal((await getPublishedFaq({id:questionId})).items.length,0);assert.equal((await getFaqAdmin(editor)).drafts.find(row=>row.id===saved.id)?.revision,1);
   await assert.rejects(getFaqAdmin(viewer),{code:'forbidden'});await assert.rejects(command(save,viewer),{code:'forbidden'});await assert.rejects(command({...save,item:{...item,answer:'Andere inhoud'}},editor,requestId),{code:'request_reused'});
  });
  await t.test('same-revision devices produce one save and one conflict',async()=>{
   const results=await Promise.allSettled([command({...save,expectedRevision:1,item:{...item,answer:'Antwoord vanaf desktop.'}}),command({...save,expectedRevision:1,item:{...item,answer:'Antwoord vanaf Android.'}})]);
   assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected'&&result.reason.code==='revision_conflict').length,1);
  });
  const current=(await getFaqAdmin(editor)).drafts.find(row=>row.id===saved.id)!,first=await command({type:'faq.publish',draftId:current.id,expectedRevision:current.revision,expectedVersion:initial.version,reason:'Gecontroleerde eerste publicatie'});
  await t.test('publication uses the saved revision, preserves all source questions and applies all-word accent search',async()=>{
   const publicData=await getPublishedFaq();assert.equal(publicData.version,first.version);assert.equal(publicData.items.length,initial.items.length+1);assert.equal((await getPublishedFaq({q:'nieuwe cafe'})).items.some(row=>row.id===questionId),true);
   await assert.rejects(command({type:'faq.publish',draftId:current.id,expectedRevision:1,expectedVersion:first.version,reason:'Verouderd concept'}),{code:'revision_conflict'});
  });
  const secondDraft=await command({...save,expectedRevision:2,item:{...item,answer:'Herziene gepubliceerde uitleg.'}}),second=await command({type:'faq.publish',draftId:secondDraft.id,expectedRevision:3,expectedVersion:first.version,reason:'Een tweede gecontroleerde versie'});
  await t.test('stale publication refuses overwrite and history restore creates a new immutable version',async()=>{
   await assert.rejects(command({type:'faq.publish',draftId:current.id,expectedRevision:3,expectedVersion:first.version,reason:'Stale publicatie'}),{code:'revision_conflict'});
   const restored=await command({type:'faq.restore',publicationId:first.id,expectedVersion:second.version,reason:'Herstel naar de eerste gecontroleerde inhoud'});assert.notEqual(restored.version,first.version);assert.equal((await getPublishedFaq({id:questionId})).items[0].answer,current.item.answer);assert.equal((await getFaqAdmin(editor)).history.filter(row=>[first.id,second.id,restored.id].includes(row.id)).length,3);
   await assert.rejects(database().query('delete from dartflow_private.faq_publications where id=$1',[first.id]),{code:'42501'});
  });
  await t.test('role revocation also refuses receipt replay; invalid IDs and empty content are rejected',async()=>{
   await assert.rejects(command({...save,item:{...item,id:'Bad ID'}}),{code:'invalid_faq'});await assert.rejects(command({...save,item:{...item,answer:' '}}),{code:'invalid_faq'});
   await owner.query('delete from dartflow_private.platform_roles where user_id=$1',[editor]);await assert.rejects(command(save,editor,requestId),{code:'forbidden'});
  });
 }finally{
  await owner.query('delete from dartflow_private.faq_commands where actor_id=any($1::uuid[])',[actors]);await owner.query('delete from dartflow_private.faq_drafts where author_id=any($1::uuid[])',[actors]);await owner.query('delete from dartflow_private.faq_publications where actor_id=any($1::uuid[])',[actors]);await owner.query('delete from dartflow_private.platform_roles where user_id=any($1::uuid[])',[actors]);await owner.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[actors]);await owner.end();await closeDatabase();
 }
});
