import type {Metadata} from 'next';
import {appConfig} from '@/lib/config';
import {liveBlogPosts} from '@/components/blog-data';
import {BlogPublicPage,blogMetadata,renderBlogIndexBody} from '@/components/blog-public';
export const dynamic='force-dynamic';
type Context={searchParams:Promise<Record<string,string|string[]|undefined>>};
const first=(value:string|string[]|undefined)=>(Array.isArray(value)?value[0]:value)||'';
export async function generateMetadata({searchParams}:Context):Promise<Metadata>{const search=await searchParams;return blogMetadata(appConfig().origin,undefined,Boolean(first(search.categorie)||first(search.q)));}
export default async function BlogIndex({searchParams}:Context){const [posts,search]=await Promise.all([liveBlogPosts(),searchParams]);const origin=appConfig().origin;return <BlogPublicPage origin={origin} body={renderBlogIndexBody(posts,origin,first(search.categorie),first(search.q))}/>;}
