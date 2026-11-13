import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {actorId} from '@/lib/auth';
import {appConfig} from '@/lib/config';
import {BlogError,type BlogArticle} from '@/lib/blog-types';
import {getBlogDraft} from '@/lib/blog-store';
import {publicBlogPost} from '@/components/blog-data';
import {BlogPublicPage,renderBlogArticleBody} from '@/components/blog-public';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Redactiepreview | DartFlow',robots:{index:false,follow:false,noarchive:true}};
type Context={params:Promise<{id:string}>;searchParams:Promise<{revisie?:string}>};
export default async function BlogPreview({params,searchParams}:Context){
 const actor=await actorId();if(!actor)notFound();
 const {id}=await params,query=await searchParams,revision=query.revisie&&/^\d+$/.test(query.revisie)?Number(query.revisie):undefined;
 let article:BlogArticle;
 try{article=await getBlogDraft(actor,id,revision);}catch(error){if(error instanceof BlogError&&[401,403,404].includes(error.status))notFound();throw error;}
 const post=publicBlogPost(article),origin=appConfig().origin;
 return <BlogPublicPage post={post} origin={origin} preview body={renderBlogArticleBody(post,[],origin,true)}/>;
}
