import type {PoolClient} from 'pg';
import {database} from './db';
import {BLOG_AUTHORS,BLOG_CATEGORIES,BlogError,type BlogData} from './blog-types';
import {blogOperation,blogRuntime,blogTransaction,requireBlogAdmin} from './blog-store';

type Client=Pick<PoolClient,'query'>;
export type BlogTaxonomyKind='author'|'category';
export type BlogTaxonomyEntry={id:string;name:string;active:boolean;revision:number};
export type BlogTaxonomy={authors:BlogTaxonomyEntry[];categories:BlogTaxonomyEntry[]};
const defaults=()=>({authors:BLOG_AUTHORS.map(row=>({...row,active:true,revision:1})),categories:BLOG_CATEGORIES.map(row=>({...row,active:true,revision:1}))});
function kind(value:unknown):BlogTaxonomyKind{if(value!=='author'&&value!=='category')throw new BlogError('VALIDATION_ERROR','Kies auteurs of categorieën.',422,'kind');return value;}
function id(value:unknown){if(typeof value!=='string'||!/^[a-z0-9][a-z0-9-]{0,99}$/.test(value))throw new BlogError('VALIDATION_ERROR','Gebruik een vaste ID met maximaal 100 kleine letters, cijfers en streepjes.',422,'id');return value;}
function name(value:unknown){if(typeof value!=='string'||!value.trim()||value.trim().length>120||/[\u0000-\u001f\u007f]/.test(value))throw new BlogError('VALIDATION_ERROR','Vul een naam van maximaal 120 tekens in.',422,'name');return value.trim();}
async function ensureDefaults(client:Client){
 const r=blogRuntime(),initial=defaults();
 const rows=[...initial.authors.map(row=>({...row,kind:'author'})),...initial.categories.map(row=>({...row,kind:'category'}))];
 await client.query("insert into dartflow_private.blog_taxonomy(site_id,environment,kind,id,name) select $1,$2,x.kind,x.id,x.name from jsonb_to_recordset($3::jsonb) as x(kind text,id text,name text) on conflict(site_id,environment,kind,id) do nothing",[r.siteId,r.environment,JSON.stringify(rows)]);
}
/** Capabilities and public rendering read the same records; a fresh installation
 * can still present the legacy defaults before its first editorial write. */
export async function listBlogTaxonomy(client:Client=database(),includeInactive=false):Promise<BlogTaxonomy>{
 const r=blogRuntime(),rows=(await client.query('select kind,id,name,active,revision from dartflow_private.blog_taxonomy where site_id=$1 and environment=$2 order by name,id',[r.siteId,r.environment])).rows;
 if(!rows.length)return defaults();
 const entries=rows.filter(row=>includeInactive||row.active).map(row=>({kind:row.kind,id:row.id,name:row.name,active:row.active,revision:row.revision}));
 return {authors:entries.filter(row=>row.kind==='author').map(({id,name,active,revision})=>({id,name,active,revision})),categories:entries.filter(row=>row.kind==='category').map(({id,name,active,revision})=>({id,name,active,revision}))};
}
/** Called inside the existing draft/publication transaction, retaining shared
 * locks so archiving cannot race a newly accepted article reference. */
export async function validateBlogTaxonomy(client:Client,data:Pick<BlogData,'authorId'|'categoryId'>){
 await ensureDefaults(client);const r=blogRuntime();
 const rows=(await client.query("select kind,id,active from dartflow_private.blog_taxonomy where site_id=$1 and environment=$2 and ((kind='author' and id=$3)or(kind='category' and id=$4)) for share",[r.siteId,r.environment,data.authorId,data.categoryId])).rows;
 for(const [value,field,entryId] of [['author','authorId',data.authorId],['category','categoryId',data.categoryId]]as const)if(!rows.some(row=>row.kind===value&&row.id===entryId&&row.active))throw new BlogError('VALIDATION_ERROR',value==='author'?'Kies een bestaande actieve auteur.':'Kies een bestaande actieve categorie.',422,field);
}
export async function resolveBlogTaxonomy(data:Pick<BlogData,'authorId'|'categoryId'>,client:Client=database()){
 const taxonomy=await listBlogTaxonomy(client,true);
 const author=taxonomy.authors.find(row=>row.id===data.authorId),category=taxonomy.categories.find(row=>row.id===data.categoryId);
 return {author:{id:data.authorId,name:author?.name??data.authorId},category:{id:data.categoryId,name:category?.name??data.categoryId}};
}
type TaxonomyInput={kind:unknown;id:unknown;name?:unknown;expectedRevision:unknown;requestId:string};
async function changeTaxonomy(actor:string,input:TaxonomyInput,action:'save'|'archive'|'restore'){
 const entryKind=kind(input.kind),entryId=id(input.id),entryName=action==='save'?name(input.name):undefined;
 if(!Number.isSafeInteger(input.expectedRevision)||Number(input.expectedRevision)<0)throw new BlogError('VALIDATION_ERROR','Geef de actuele revisie op; gebruik 0 bij een nieuwe vermelding.',422,'expectedRevision');
 return blogTransaction(async client=>{
  await requireBlogAdmin(actor,client);await ensureDefaults(client);const r=blogRuntime();
  return (await blogOperation(client,`taxonomy:${entryKind}:${action}`,input.requestId,{id:entryId,name:entryName,expectedRevision:input.expectedRevision},async()=>{
   await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['blog-taxonomy',r.siteId,r.environment,entryKind,entryId])]);
   const previous=(await client.query('select id,name,active,revision from dartflow_private.blog_taxonomy where site_id=$1 and environment=$2 and kind=$3 and id=$4 for update',[r.siteId,r.environment,entryKind,entryId])).rows[0] as BlogTaxonomyEntry|undefined;
   if((previous?.revision??0)!==input.expectedRevision)throw new BlogError('REVISION_CONFLICT','Deze vermelding is elders gewijzigd. Laad de actuele lijst en probeer opnieuw.',409,'expectedRevision',previous?.revision??0);
   if(action!=='save'&&!previous)throw new BlogError('POST_NOT_FOUND','Deze auteur of categorie bestaat niet.',404);
   if(action==='archive'&&(entryKind==='author'&&entryId==='redactie'||entryKind==='category'&&entryId==='nieuws'))throw new BlogError('PERMISSION_DENIED','De standaardauteur en standaardcategorie blijven beschikbaar voor nieuwe artikelen.',403);
   const active=action==='archive'?false:action==='restore'?true:previous?.active??true;
   const result=(await client.query("insert into dartflow_private.blog_taxonomy(site_id,environment,kind,id,name,active,updated_by) values($1,$2,$3,$4,$5,$6,$7) on conflict(site_id,environment,kind,id) do update set name=excluded.name,active=excluded.active,revision=blog_taxonomy.revision+1,updated_by=excluded.updated_by,updated_at=clock_timestamp() returning id,name,active,revision",[r.siteId,r.environment,entryKind,entryId,entryName??previous!.name,active,actor])).rows[0] as BlogTaxonomyEntry;
   await client.query('insert into dartflow_private.blog_audit(site_id,environment,operation,actor_id,metadata)values($1,$2,$3,$4,$5)',[r.siteId,r.environment,`taxonomy.${action}`,actor,JSON.stringify({kind:entryKind,id:entryId,revision:result.revision})]);
   await client.query("insert into dartflow_private.blog_invalidation(post_id,revision) select p.id,p.live_revision from dartflow_private.blog_posts p join dartflow_private.blog_revisions v on v.post_id=p.id and v.revision=p.live_revision where p.site_id=$1 and p.environment=$2 and v.data->>$3=$4 on conflict(post_id,revision)do update set processed_at=null",[r.siteId,r.environment,entryKind==='author'?'authorId':'categoryId',entryId]);
   return result;
  })).result;
 });
}
export async function saveBlogTaxonomy(actor:string,input:TaxonomyInput){return changeTaxonomy(actor,input,'save');}
export async function archiveBlogTaxonomy(actor:string,input:TaxonomyInput){return changeTaxonomy(actor,input,'archive');}
export async function restoreBlogTaxonomy(actor:string,input:TaxonomyInput){return changeTaxonomy(actor,input,'restore');}
