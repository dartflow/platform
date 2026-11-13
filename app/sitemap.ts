import type {MetadataRoute} from 'next';
import {appConfig} from '@/lib/config';
import {listLiveArticles} from '@/lib/blog-store';
export const dynamic='force-dynamic';
export default async function sitemap():Promise<MetadataRoute.Sitemap>{
 const origin=appConfig().origin;if(origin!=='https://dartflow.nl')return [];
 const posts=[];
 for(let offset=0;;offset+=1000){const batch=await listLiveArticles({limit:1000,offset});posts.push(...batch);if(batch.length<1000)break;}
 return [{url:origin,changeFrequency:'monthly',priority:1},{url:origin+'/blog',changeFrequency:'weekly',priority:.8},...posts.filter(post=>!post.noindex).map(post=>({url:origin+'/blog/'+encodeURIComponent(post.slug),lastModified:post.updatedAt,changeFrequency:'monthly' as const,priority:.7}))];
}
