export type ReleaseProduct='dartflow'|'oche-live';
export type ReleaseChannel='web'|'android'|'all';
export type ProductRelease={id:string;product:ReleaseProduct;channel:ReleaseChannel;version:string;title:string;body:string;revision:number;status:'draft'|'published';createdAt:string;updatedAt:string;publishedAt:string|null;publishedBy:string|null};
export type ProductReleaseList={items:ProductRelease[]};
export type ProductReleaseAdmin={drafts:ProductRelease[];published:ProductRelease[];canManage:boolean};
export type ProductReleaseAction={type:'release.save';id?:string;expectedRevision:number;product:ReleaseProduct;channel:ReleaseChannel;version:string;title:string;body:string}|{type:'release.publish';id:string;expectedRevision:number};
export type ProductReleaseCommand={requestId:string;action:ProductReleaseAction};
export type ProductReleaseResult={ok:true;id:string;release:ProductRelease};
