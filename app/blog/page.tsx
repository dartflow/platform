import type {Metadata} from 'next';
import {appConfig} from '@/lib/config';
import {liveBlogArchive} from '@/components/blog-data';
import {BlogPublicPage,blogMetadata,renderBlogIndexBody} from '@/components/blog-public';
export const dynamic='force-dynamic';
type Context={searchParams:Promise<Record<string,string|string[]|undefined>>};
const first=(value:string|string[]|undefined)=>(Array.isArray(value)?value[0]:value)||'';
async function archive(searchParams:Context['searchParams']){const search=await searchParams;return liveBlogArchive(first(search.page),first(search.categorie),first(search.q));}
export async function generateMetadata({searchParams}:Context):Promise<Metadata>{
 const result=await archive(searchParams),origin=appConfig().origin,filtered=Boolean(result.category||result.search),metadata=blogMetadata(origin,undefined,filtered);
 if(!filtered&&result.page>1){const canonical=`${origin}/blog?page=${result.page}`;metadata.alternates={canonical};metadata.openGraph={...metadata.openGraph,url:canonical};metadata.title=`DartFlow Blog · Pagina ${result.page}`;}
 return metadata;
}
export default async function BlogIndex({searchParams}:Context){const result=await archive(searchParams),origin=appConfig().origin;return <BlogPublicPage origin={origin} body={renderBlogIndexBody(result.posts,origin,result.category,result.search,result)}/>;}
