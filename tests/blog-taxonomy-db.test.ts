import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {closeDatabase,database} from '../lib/db';
import {getBlogDraft,saveBlogDraft,validateBlogData} from '../lib/blog-store';
import {archiveBlogTaxonomy,listBlogTaxonomy,restoreBlogTaxonomy,saveBlogTaxonomy} from '../lib/blog-taxonomy';

try{process.loadEnvFile('.env.local');}catch{/* CI injects its isolated loopback credentials. */}
const loopback=(value:string|undefined)=>{try{return !!value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);
test('blog taxonomy keeps structural validation synchronous and accepts configured record identifiers',()=>{
 assert.equal(validateBlogData({title:'Test',authorId:'clubredactie',categoryId:'jeugd'}).authorId,'clubredactie');
 assert.throws(()=>validateBlogData({title:'Test',authorId:'../another-site'}),{field:'authorId'});
 assert.throws(()=>validateBlogData({title:'Test',categoryId:'not a stable id'}),{field:'categoryId'});
});

test('editable authors and categories use scoped records, revisions, durable receipts and ordinary blog validation',{skip:!configured},async t=>{
 const previous={DARTFLOW_ENV:process.env.DARTFLOW_ENV,DARTFLOW_SOCIALHERO_SITE_ID:process.env.DARTFLOW_SOCIALHERO_SITE_ID};
 const siteId=`taxonomy-${randomUUID()}`,actor=randomUUID(),outsider=randomUUID();process.env.DARTFLOW_ENV='development';process.env.DARTFLOW_SOCIALHERO_SITE_ID=siteId;
 const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
 const key=()=>`taxonomy:${randomUUID()}`;
 const authorInput={kind:'author',id:'clubredactie',name:'Clubredactie',expectedRevision:0,requestId:key()};
 let articleId='';
 const data={title:'Een bericht uit de club',authorId:'clubredactie',categoryId:'jeugd',content:{format:'markdown',body:'Een bericht van de nieuwe redactie.'}};
 try{
  for(const [id,name] of [[actor,'Taxonomy beheer'],[outsider,'Taxonomy speler']])await owner.query('insert into dartflow_private.profiles(id,name,display_name)values($1,$2,$2)',[id,name.replaceAll(' ','')]);
  await owner.query("insert into dartflow_private.platform_roles(user_id,role)values($1,'admin')",[actor]);
  await t.test('defaults survive migration and only platform administrators can change records',async()=>{
   const defaults=await listBlogTaxonomy();assert.ok(defaults.authors.some(row=>row.id==='redactie'));assert.ok(defaults.categories.some(row=>row.id==='nieuws'));
   await assert.rejects(saveBlogTaxonomy(outsider,authorInput),{code:'PERMISSION_DENIED'});
   assert.equal((await owner.query('select count(*)::int n from dartflow_private.blog_taxonomy where site_id=$1',[siteId])).rows[0].n,0);
  });
  await t.test('create and rename use optimistic revisions and immutable idempotency results',async()=>{
   const created=await saveBlogTaxonomy(actor,authorInput);assert.deepEqual(created,{id:'clubredactie',name:'Clubredactie',active:true,revision:1});assert.deepEqual(await saveBlogTaxonomy(actor,authorInput),created);
   await assert.rejects(saveBlogTaxonomy(actor,{...authorInput,name:'Different payload'}),{code:'IDEMPOTENCY_CONFLICT'});
   await assert.rejects(saveBlogTaxonomy(actor,{...authorInput,name:'Stale change',requestId:key()}),{code:'REVISION_CONFLICT',currentRevision:1});
   await saveBlogTaxonomy(actor,{kind:'category',id:'jeugd',name:'Jeugd & opleiding',expectedRevision:0,requestId:key()});
   const saved=await saveBlogDraft(actor,{data,requestId:key()});articleId=saved.id;assert.equal(saved.article.author.name,'Clubredactie');assert.equal(saved.article.category.name,'Jeugd & opleiding');
   await saveBlogTaxonomy(actor,{...authorInput,name:'Clubredactie Noord',expectedRevision:1,requestId:key()});assert.equal((await getBlogDraft(actor,articleId)).author.name,'Clubredactie Noord');
   assert.deepEqual(await saveBlogTaxonomy(actor,authorInput),created,'replay returns its original immutable result after a later rename');
  });
  await t.test('both editor and connector draft service reject missing and inactive records',async()=>{
   await assert.rejects(saveBlogDraft(actor,{data:{...data,authorId:'unconfigured-author'},requestId:key()}),{code:'VALIDATION_ERROR',field:'authorId'});
   await archiveBlogTaxonomy(actor,{kind:'category',id:'jeugd',expectedRevision:1,requestId:key()});
   assert.equal((await listBlogTaxonomy()).categories.some(row=>row.id==='jeugd'),false);
   assert.equal((await listBlogTaxonomy(undefined,true)).categories.find(row=>row.id==='jeugd')?.active,false);
   assert.equal((await getBlogDraft(actor,articleId)).category.name,'Jeugd & opleiding','historical article references remain readable');
   await assert.rejects(saveBlogDraft(actor,{data,requestId:key()}),{code:'VALIDATION_ERROR',field:'categoryId'});
   await restoreBlogTaxonomy(actor,{kind:'category',id:'jeugd',expectedRevision:2,requestId:key()});assert.equal((await listBlogTaxonomy()).categories.find(row=>row.id==='jeugd')?.revision,3);
   await assert.rejects(archiveBlogTaxonomy(actor,{kind:'author',id:'redactie',expectedRevision:1,requestId:key()}),{code:'PERMISSION_DENIED'});
   await assert.rejects(archiveBlogTaxonomy(actor,{kind:'category',id:'nieuws',expectedRevision:1,requestId:key()}),{code:'PERMISSION_DENIED'});
  });
  await t.test('another site and environment do not expose custom records; authorization is checked before replay',async()=>{
   process.env.DARTFLOW_ENV='staging';assert.equal((await listBlogTaxonomy()).authors.some(row=>row.id==='clubredactie'),false);process.env.DARTFLOW_ENV='development';
   process.env.DARTFLOW_SOCIALHERO_SITE_ID=`other-${siteId}`;assert.equal((await listBlogTaxonomy()).categories.some(row=>row.id==='jeugd'),false);process.env.DARTFLOW_SOCIALHERO_SITE_ID=siteId;
   await owner.query('delete from dartflow_private.platform_roles where user_id=$1',[actor]);await assert.rejects(saveBlogTaxonomy(actor,authorInput),{code:'PERMISSION_DENIED'});
   await owner.query("insert into dartflow_private.platform_roles(user_id,role)values($1,'admin')",[actor]);
  });
  await t.test('private storage has RLS and no public grants; runtime cannot delete historical records',async()=>{
   assert.equal((await owner.query("select relrowsecurity from pg_class where oid='dartflow_private.blog_taxonomy'::regclass")).rows[0].relrowsecurity,true);
   assert.equal((await owner.query("select count(*)::int n from information_schema.role_table_grants where table_schema='dartflow_private' and table_name='blog_taxonomy' and grantee in('PUBLIC','anon','authenticated','service_role')")).rows[0].n,0);
   await assert.rejects(database().query('delete from dartflow_private.blog_taxonomy where site_id=$1',[siteId]),{code:'42501'});
  });
 }finally{
  process.env.DARTFLOW_ENV='development';process.env.DARTFLOW_SOCIALHERO_SITE_ID=siteId;
  for(const table of ['blog_audit','blog_posts','blog_receipts','blog_taxonomy'])await owner.query(`delete from dartflow_private.${table} where site_id=$1 and environment='development'`,[siteId]);
  await owner.query('delete from dartflow_private.platform_roles where user_id=any($1::uuid[])',[[actor,outsider]]);await owner.query('delete from dartflow_private.profiles where id=any($1::uuid[])',[[actor,outsider]]);
  await owner.end();await closeDatabase();for(const [name,value]of Object.entries(previous)){if(value===undefined)delete process.env[name];else process.env[name]=value;}
 }
});
