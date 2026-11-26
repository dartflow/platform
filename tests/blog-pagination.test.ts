import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {closeDatabase} from '../lib/db';
import {BLOG_PUBLIC_PAGE_SIZE,blogRuntime,listLiveBlogPage,normalizeBlogPageNumber} from '../lib/blog-store';
import {BLOG_AUTHORS,BLOG_CATEGORIES,type BlogData} from '../lib/blog-types';
import {blogIndexPageUrl,renderBlogIndexBody,type PublicBlogPost} from '../components/blog-public';

try{process.loadEnvFile('.env.local');}catch{/* CI supplies loopback credentials. */}
const loopback=(value:string|undefined)=>{try{return !!value&&['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
const configured=process.env.DARTFLOW_DATA_MODE==='local'&&loopback(process.env.DARTFLOW_DATABASE_URL)&&loopback(process.env.DARTFLOW_DATABASE_ADMIN_URL);
const card=(index:number):PublicBlogPost=>({id:String(index),slug:`artikel-${index}`,title:`Artikel ${index}`,excerpt:'Een leesbaar artikel.',category:'Tips & inspiratie',author:'DartFlow redactie',tags:[],html:'<p>De volledige tekst.</p>',headings:[],readMinutes:1,publishedAt:new Date(Date.UTC(2026,0,1,0,0,index)).toISOString()});

test('blog pagination validates page numbers and preserves filters in accessible navigation',()=>{
 for(const value of [undefined,'','0','-1','1.2','1e3','not-a-page',Infinity,NaN,[],{}])assert.equal(normalizeBlogPageNumber(value),1);
 assert.equal(normalizeBlogPageNumber('002'),2);assert.equal(normalizeBlogPageNumber('51'),51);
 assert.equal(blogIndexPageUrl(1),'\/blog');
 const url=new URL(blogIndexPageUrl(3,'Tips & inspiratie','één club & meer'),'https://dartflow.nl');
 assert.equal(url.searchParams.get('categorie'),'Tips & inspiratie');assert.equal(url.searchParams.get('q'),'één club & meer');assert.equal(url.searchParams.get('page'),'3');
 const posts=Array.from({length:20},(_,index)=>card(index)),pagination={page:1,pageSize:20,total:65,totalPages:4,categories:['Tips & inspiratie'],featuredId:'0'};
 const first=renderBlogIndexBody(posts,'https://dartflow.nl','','',pagination);
 assert.equal((first.match(/class="blog-feature"/g)||[]).length,1);assert.equal((first.match(/class="blog-card"/g)||[]).length,19);
 assert.equal((first.match(/class="blog-card-link" href="\/blog\/artikel-0"/g)||[]).length,0);
 assert.ok(first.includes('1–20 van 65 artikelen'));assert.ok(first.includes('aria-current="page" aria-label="Pagina 1"'));assert.ok(first.includes('rel="next">Volgende'));
 const second=renderBlogIndexBody(posts,'https://dartflow.nl','Tips & inspiratie','club',{...pagination,page:2});
 assert.equal((second.match(/class="blog-feature"/g)||[]).length,0);assert.equal((second.match(/class="blog-card"/g)||[]).length,20);
 assert.ok(second.includes('21–40 van 65 artikelen'));assert.ok(second.includes('rel="prev">Vorige'));assert.ok(second.includes('rel="next">Volgende'));
 assert.ok(second.includes('categorie=Tips+%26+inspiratie&amp;q=club&amp;page=3'));assert.ok(second.includes('aria-label="Blogpagina’s"'));
 const last=renderBlogIndexBody(posts.slice(0,5),'https://dartflow.nl','','',{...pagination,page:4});assert.ok(!last.includes('rel="next"'));assert.ok(last.includes('61–65 van 65 artikelen'));
});

test('live archive pages reach beyond one thousand posts and search only accepted live content',{skip:!configured},async t=>{
 const originalSite=process.env.DARTFLOW_SOCIALHERO_SITE_ID,site=`pagination-${randomUUID()}`,otherSite=`pagination-other-${randomUUID()}`;
 process.env.DARTFLOW_SOCIALHERO_SITE_ID=site;
 const owner=new pg.Client({connectionString:process.env.DARTFLOW_DATABASE_ADMIN_URL});await owner.connect();
 const r=blogRuntime(),ids:string[]=Array.from({length:1005},()=>randomUUID()),extraIds:string[]=Array.from({length:4},()=>randomUUID());
 const data=(index:number):BlogData=>({type:'blog',locale:'nl-NL',title:index===2?'100%_controle':`Artikel ${index}`,slug:`pagination-${index}`,excerpt:'Een artikel uit het archief.',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:index===0?'Dé juiste opstelling voor de finale.':'Een openbaar artikel.'}]}]},seo:{title:`Artikel ${index}`,description:'Een beschrijving.'},authorId:index===0?'danny':'redactie',categoryId:index<2?'clubstrategie':'nieuws',tags:index===0?['Lokaalclub']:[],hero:{assetId:'',alt:'',focalPoint:{x:.5,y:.5}},featured:index===1004});
 try{
  const taxonomy=[...BLOG_AUTHORS.map(row=>({...row,kind:'author'})),...BLOG_CATEGORIES.map(row=>({...row,kind:'category'})),{id:'danny',name:'Danny de Vries',kind:'author'},{id:'clubstrategie',name:'Clubstrategie',kind:'category'}];
  await owner.query('insert into dartflow_private.blog_taxonomy(site_id,environment,kind,id,name)select $1,$2,row.kind,row.id,row.name from jsonb_to_recordset($3::jsonb) as row(kind text,id text,name text)',[site,r.environment,JSON.stringify(taxonomy)]);
  const rows=ids.map((id,index)=>({id,data:data(index),at:new Date(Date.UTC(2026,0,1)-index*1000).toISOString()}));
  await owner.query("insert into dartflow_private.blog_posts(id,site_id,environment,draft_revision,live_revision,status,first_published_at,published_at)select row.id,$1,$2,1,1,'published',row.at,row.at from jsonb_to_recordset($3::jsonb) as row(id uuid,at timestamptz)",[site,r.environment,JSON.stringify(rows)]);
  await owner.query('insert into dartflow_private.blog_revisions(post_id,revision,data)select row.id,1,row.data from jsonb_to_recordset($1::jsonb) as row(id uuid,data jsonb)',[JSON.stringify(rows)]);
  for(const [index,status,postSite,environment] of [[0,'draft',site,r.environment],[1,'archived',site,r.environment],[2,'published',site,r.environment==='production'?'staging':'production'],[3,'published',otherSite,r.environment]] as const){
   await owner.query('insert into dartflow_private.blog_posts(id,site_id,environment,draft_revision,live_revision,status,first_published_at,published_at)values($1,$2,$3,1,$4,$5,clock_timestamp(),clock_timestamp())',[extraIds[index],postSite,environment,status==='draft'?null:1,status]);
   await owner.query('insert into dartflow_private.blog_revisions(post_id,revision,data)values($1,1,$2)',[extraIds[index],JSON.stringify({...data(2000+index),title:'Verborgen wedstrijd',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Een verborgen wedstrijd.'}]}]}})]);
  }
  // A later private revision must not enter either the count or the search text.
  await owner.query('insert into dartflow_private.blog_revisions(post_id,revision,data)values($1,2,$2)',[ids[3],JSON.stringify({...data(3),title:'Verborgen wijziging'})]);
  await owner.query('update dartflow_private.blog_posts set draft_revision=2 where id=$1',[ids[3]]);
  await t.test('twenty articles per page include the first-page feature without duplicates',async()=>{
   const first=await listLiveBlogPage(),second=await listLiveBlogPage({page:2});
   assert.equal(BLOG_PUBLIC_PAGE_SIZE,20);assert.equal(first.total,1005);assert.equal(first.totalPages,51);assert.equal(first.posts.length,20);assert.equal(second.posts.length,20);
   assert.equal(first.posts[0].id,ids[1004]);assert.equal(first.featuredId,ids[1004]);
   assert.equal(new Set([...first.posts,...second.posts].map(post=>post.id)).size,40);assert.equal(second.posts.some(post=>post.id===ids[1004]),false);
   assert.equal(first.posts.some(post=>extraIds.includes(post.id)),false);
   const last=await listLiveBlogPage({page:'999999'});assert.equal(last.page,51);assert.equal(last.posts.length,5);assert.equal(last.posts.at(-1)?.id,ids[1003]);
  });
  await t.test('category display names, author names, body text, tags and literal symbols remain searchable',async()=>{
   const category=await listLiveBlogPage({category:'CLUBSTRATÉGIE'});assert.equal(category.category,'Clubstrategie');assert.equal(category.total,2);assert.equal(category.featuredId,null);
   for(const search of ['juiste strategie','dé juiste','danny','lokaalclub']){const result=await listLiveBlogPage({search});assert.equal(result.total,1,search);assert.equal(result.posts[0].id,ids[0]);}
   assert.equal((await listLiveBlogPage({search:'%_'})).total,1);
   assert.equal((await listLiveBlogPage({search:'verborgen'})).total,0);
   const unknown=await listLiveBlogPage({category:'Een onbekende categorie',page:40});assert.equal(unknown.total,0);assert.equal(unknown.page,1);assert.deepEqual(unknown.posts,[]);
   await owner.query("update dartflow_private.blog_taxonomy set name='Clubplannen' where site_id=$1 and environment=$2 and kind='category' and id='clubstrategie'",[site,r.environment]);
   const renamed=await listLiveBlogPage({category:'Clubplannen'});assert.equal(renamed.total,2);assert.equal(renamed.posts[0].category.name,'Clubplannen');assert.ok(renamed.categories.includes('Clubplannen'));assert.equal((await listLiveBlogPage({category:'Clubstrategie'})).total,0);
  });
 }finally{
  await owner.query('delete from dartflow_private.blog_posts where site_id=any($1::text[])',[[site,otherSite]]);
  await owner.query('delete from dartflow_private.blog_taxonomy where site_id=$1',[site]);await owner.end();await closeDatabase();
  if(originalSite===undefined)delete process.env.DARTFLOW_SOCIALHERO_SITE_ID;else process.env.DARTFLOW_SOCIALHERO_SITE_ID=originalSite;
 }
});
