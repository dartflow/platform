import {NextRequest,NextResponse} from 'next/server';
import {actorId} from './auth';
import {appConfig} from './config';
import {consumeRateLimit} from './db';
import {BlogError,type BlogArticle} from './blog-types';
import {archiveBlogArticle,getBlogDraft,listBlogAdmin,publishBlogRevision,requireBlogAdmin,saveBlogDraft,scheduleBlogRevision,unscheduleBlogRevision,listBlogRevisions,restoreBlogRevision} from './blog-store';
import {socialHeroStatus} from './socialhero-connection';
import {listBlogTaxonomy} from './blog-taxonomy';
import {database} from './db';
import {randomUUID} from 'node:crypto';

const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'}});
async function editorPost(post:BlogArticle,actor:string){
  const live=post.liveRevision?(post.revision===post.liveRevision?post:await getBlogDraft(actor,post.id,post.liveRevision)):null;
  const publicationCheck=post.liveRevision?(await database().query('select state,last_error_code as \"lastError\",checked_at as \"checkedAt\" from dartflow_private.blog_publication_checks where post_id=$1 and revision=$2',[post.id,post.liveRevision])).rows[0]??null:null;
  return {...post,authorName:post.author.name,categoryName:post.category.name,publicationCheck,status:post.scheduledAt?'scheduled':post.status,publishedAt:post.firstPublishedAt,publicUrl:live?.publicUrl??post.publicUrl,author:post.authorId,category:post.categoryId,seoTitle:post.seo.title,seoDescription:post.seo.description,
    liveSlug:live?.slug??null,
    hasUnpublishedChanges:post.liveRevision!==null&&post.liveRevision!==post.draftRevision,
    hero:{...post.hero,src:post.hero.url,x:post.hero.focalPoint.x,y:post.hero.focalPoint.y},
    social:post.ogImageAssetId?{assetId:post.ogImageAssetId,src:post.ogImage.url,alt:post.ogImage.alt}:null};
}
async function read(request:NextRequest){
  const reader=request.body?.getReader();if(!reader)throw new BlogError('VALIDATION_ERROR','Ongeldige aanvraag.');
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>500_000){await reader.cancel();throw new BlogError('PAYLOAD_TOO_LARGE','Het artikel is te groot.',413);}chunks.push(value);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString());if(value&&typeof value==='object'&&!Array.isArray(value))return value as Record<string,unknown>;}catch{throw new BlogError('VALIDATION_ERROR','Ongeldige JSON.');}
  throw new BlogError('VALIDATION_ERROR','Gebruik een JSON-object.');
}
export async function handleBlogAdminApi(request:NextRequest,parts:string[]):Promise<NextResponse|null>{
  if(parts[0]!=='blog'||parts[1]!=='admin')return null;
  try{
    const actor=await actorId(request);if(!actor)throw new BlogError('UNAUTHENTICATED','Log in om Blogbeheer te openen.',401);
    await requireBlogAdmin(actor);
    const rate=await consumeRateLimit(`blog:admin:${actor}`,request.method==='GET'?120:40,60);
    if(!rate.allowed)return NextResponse.json({error:{code:'RATE_LIMITED',message:`Wacht ${rate.retryAfter} seconden en probeer opnieuw.`}},{status:429,headers:{'Retry-After':String(rate.retryAfter),'Cache-Control':'private, no-store'}});
    if(request.method!=='GET'&&(request.headers.get('origin')!==appConfig().origin||request.headers.get('sec-fetch-site')==='cross-site'))throw new BlogError('PERMISSION_DENIED','Ververs de pagina en probeer opnieuw.',403);
    if(request.method==='GET'){
      if(request.nextUrl.searchParams.get('action')==='revisions')return json({revisions:await listBlogRevisions(actor,String(request.nextUrl.searchParams.get('id')))});
      return json({posts:await Promise.all((await listBlogAdmin(actor)).filter(p=>p.status!=='archived').map(post=>editorPost(post,actor))),...await listBlogTaxonomy(),
        socialHero:await socialHeroStatus(actor),
        capabilities:{blogPath:'/blog',contentTypes:['blog','article']}});
    }
    if(request.method!=='POST')throw new BlogError('METHOD_NOT_ALLOWED','Deze methode is niet beschikbaar.',405);
    if(parts[2]==='media'){
      // Bounded streaming is handled by the shared media endpoint; the editor sends a raw FormData file.
      const {uploadBlogMedia}=await import('./blog-api');
      const media=await uploadBlogMedia(request,{actor},request.headers.get('Idempotency-Key')||randomUUID());
      return json({...media,src:media.url},201);
    }
    const data=await read(request),id=String(data.id||''),revision=Number(data.revision),requestId=String(data.requestId||'');
    if(data.action==='save'){
      if(!data.post||typeof data.post!=='object'||Array.isArray(data.post))throw new BlogError('VALIDATION_ERROR','Ongeldige artikelgegevens.');
      const raw=data.post as Record<string,unknown>,hero=(raw.hero??{}) as Record<string,unknown>,social=raw.social as Record<string,unknown>|null;
      const result=await saveBlogDraft(actor,{id:raw.id?String(raw.id):undefined,expectedRevision:data.revision===null?undefined:revision,requestId,data:{
        type:raw.type,locale:raw.locale,title:raw.title,slug:raw.slug,excerpt:raw.excerpt,content:raw.content,
        authorId:raw.author,categoryId:raw.category,tags:raw.tags,seo:{title:raw.seoTitle,description:raw.seoDescription},
        hero:{assetId:hero.assetId,alt:hero.alt,focalPoint:{x:hero.x,y:hero.y},ratio:hero.ratio},
        ...(social?.assetId?{ogImageAssetId:social.assetId}:{}),noindex:raw.noindex,featured:raw.featured}});
      return json({post:await editorPost(result.article,actor)});
    }
    let actedRevision:number;
    if(data.action==='publish')actedRevision=(await publishBlogRevision(actor,id,revision,requestId)).revision;
    else if(data.action==='schedule')actedRevision=(await scheduleBlogRevision(actor,id,revision,String(data.scheduledAt),requestId)).revision;
    else if(data.action==='unschedule')actedRevision=(await unscheduleBlogRevision(actor,id,requestId)).revision;
    else if(data.action==='archive'){await archiveBlogArticle(actor,id,requestId);return json({archived:true});}
    else if(data.action==='restore')actedRevision=(await restoreBlogRevision(actor,id,Number(data.restoreRevision),revision,requestId)).revision;
    else throw new BlogError('VALIDATION_ERROR','Onbekende blogactie.');
    return json({post:await editorPost(await getBlogDraft(actor,id,actedRevision),actor)});
  }catch(error){
    if(error instanceof BlogError)return json({error:{code:error.code,message:error.message,field:error.field,currentRevision:error.currentRevision}},error.status);
    console.error('Blogbeheer: verwerking mislukt.');return json({error:{code:'INTERNAL_ERROR',message:'De wijziging kon niet worden opgeslagen. Je invoer blijft bewaard; probeer opnieuw.'}},500);
  }
}
