import type {Metadata} from 'next';
import {notFound,permanentRedirect} from 'next/navigation';
import {appConfig} from '@/lib/config';
import {liveBlogArticle,liveBlogPosts} from '@/components/blog-data';
import {BlogPublicPage,blogMetadata,blogRedirectLocation,renderBlogArticleBody} from '@/components/blog-public';
export const dynamic='force-dynamic';
type Context={params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
export async function generateMetadata({params}:Context):Promise<Metadata>{const {article}=await liveBlogArticle((await params).slug);return article?blogMetadata(appConfig().origin,article):{title:'Artikel niet gevonden | DartFlow',robots:{index:false,follow:false}};}
export default async function BlogArticle({params,searchParams}:Context){const {article,redirect}=await liveBlogArticle((await params).slug);if(redirect)permanentRedirect(blogRedirectLocation(redirect,await searchParams));if(!article)notFound();const origin=appConfig().origin,posts=await liveBlogPosts();return <BlogPublicPage origin={origin} post={article} body={renderBlogArticleBody(article,posts,origin)}/>;}
