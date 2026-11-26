import {cache} from 'react';
import type {BlogArticle} from '@/lib/blog-types';
import {renderBlogDocument} from '@/lib/blog-content';
import {getLiveArticle,listLiveArticles,listLiveBlogPage} from '@/lib/blog-store';
import type {PublicBlogPost} from './blog-public';

export function publicBlogPost(article:BlogArticle):PublicBlogPost{
 const rendered=renderBlogDocument(article.content),hero=article.hero;
 const ratio=hero.width&&hero.height?hero.width/hero.height:2/3;
 const knownRatios:[number,string][]=[[2/3,'2:3'],[3/4,'3:4'],[4/5,'4:5'],[1,'1:1'],[9/16,'9:16'],[16/9,'16:9']];
 const matched=hero.ratio||knownRatios.find(([value])=>Math.abs(ratio-value)<.02)?.[1]||'2:3';
 return {id:article.id,slug:article.slug,title:article.title,excerpt:article.excerpt,featured:article.featured,noindex:article.noindex,category:article.category.name,author:article.author.name,tags:article.tags,type:article.type,locale:article.locale,publishedAt:article.firstPublishedAt||article.publishedAt||undefined,updatedAt:article.updatedAt,seoTitle:article.seo.title,seoDescription:article.seo.description,hero:hero.url?{src:hero.url,alt:hero.alt,width:hero.width,height:hero.height,x:hero.focalPoint.x,y:hero.focalPoint.y,ratio:matched}:null,social:article.ogImage?.url?{src:article.ogImage.url,alt:article.ogImage.alt,width:article.ogImage.width,height:article.ogImage.height}:null,...rendered,externalId:article.externalId,revision:article.liveRevision??article.revision};
}
// Request-scoped memoization keeps the body and metadata on the same accepted live revision.
export const liveBlogPosts=cache(async()=> (await listLiveArticles({limit:1000})).map(publicBlogPost));
export const liveBlogArchive=cache(async(page:string,category='',search='')=>{const result=await listLiveBlogPage({page,category,search});return {...result,posts:result.posts.map(publicBlogPost)};});
export const liveBlogArticle=cache(async(slug:string)=>{const result=await getLiveArticle(slug);return {article:result.article?publicBlogPost(result.article):null,redirect:result.redirect};});
