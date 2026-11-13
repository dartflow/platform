import type { BlogDoc } from './blog-content';

export const BLOG_AUTHORS=[{id:'redactie',name:'DartFlow redactie'}] as const;
export const BLOG_CATEGORIES=[{id:'toernooien',name:'Toernooien'},{id:'competities',name:'Competities'},{id:'verenigingen',name:'Verenigingen'},{id:'oche-live',name:'Oche Live'},{id:'training',name:'Training'},{id:'nieuws',name:'Nieuws'},{id:'tips',name:'Tips & inspiratie'}] as const;
export const BLOG_SCOPES=['read','media:write','drafts:write','publish'] as const;
export type BlogScope=typeof BLOG_SCOPES[number];
export type BlogData={type:'blog'|'article';noindex?:boolean;featured?:boolean;locale:string;title:string;slug:string;excerpt:string;content:BlogDoc;seo:{title:string;description:string};authorId:string;categoryId:string;tags:string[];hero:{assetId:string;alt:string;focalPoint:{x:number;y:number};ratio?:string};ogImageAssetId?:string};
export type BlogArticle=BlogData&{id:string;externalId:string|null;revision:number;draftRevision:number;liveRevision:number|null;status:'draft'|'scheduled'|'published'|'archived';firstPublishedAt:string|null;publishedAt:string|null;updatedAt:string;scheduledAt:string|null;author:{id:string;name:string};category:{id:string;name:string};hero:BlogData['hero']&{url:string;width:number;height:number};ogImage:{url:string;width:number;height:number;alt:string};publicUrl:string;schemaVersion:1};
export type BlogMedia={assetId:string;width:number;height:number;type:string;url:string;bytes:number};
export class BlogError extends Error{constructor(readonly code:string,message:string,readonly status=422,readonly field?:string,readonly currentRevision?:number){super(message);}}
