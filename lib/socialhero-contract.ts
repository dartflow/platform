/** Public SocialHero blog API v1. No framework, database or site dependencies. */
export type SocialHeroEnvironment = 'staging' | 'production';
export type SocialHeroScope = 'read' | 'draft' | 'publish';
export type SocialHeroPairingRequest = {
 code:string; attemptId:string; siteId:string; origin:string;
 environment:SocialHeroEnvironment; contractVersion:1;
};
export type SocialHeroPairingClaim = {
 connectionId:string; destinationId:string; accessToken:string; expiresAt:string;
};
export type SocialHeroPostInput = {
 baseRevision:number|null; type:'blog'|'article'; locale:string; title:string;
 content:{format:'markdown';body:string}; slug?:string; excerpt?:string;
 authorId?:string; categoryId?:string; tags?:string[];
 seo?:{title?:string;description?:string};
 hero?:{assetId:string;alt:string;focalPoint?:{x:number;y:number}};
 ogImageAssetId?:string;
};
export type SocialHeroPostStatus = {
 postId:string; externalId:string; slug:string; state:'draft'|'publishing'|'published';
 revision:number; draftRevision:number|null; publishedRevision:number|null;
 previewUrl:string|null; publicUrl:string|null; publishedAt:string|null;
};
export type SocialHeroMediaAsset = {assetId:string;mimeType:string;width:number;height:number};
export type SocialHeroCapabilities = {
 contractVersion:1; connectionId:string; destinationId:string;
 credentialState:'pending'|'active'; siteId:string; siteName:string; origin:string;
 environment:SocialHeroEnvironment; blogPath:string;
 contentTypes:('blog'|'article')[]; locales:string[]; scopes:SocialHeroScope[];
 authors:{id:string;name:string}[]; categories:{id:string;name:string}[];
 media:{mimeTypes:string[];maxBytes:number;maxPixels?:number;maxDimension?:number};
 optionalFields?:string[]; publicationRequirements?:string[];
};
export type SocialHeroErrorResponse = {code:string;message:string;requestId:string};
