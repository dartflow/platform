export type CommunityKind = 'platform'|'club'|'league'|'tournament'|'match';
export type CommunityScope = {kind:CommunityKind;id:string;name:string;canModerate:boolean;canWrite:boolean};
export type FeedPost = {id:string;scopeKind:CommunityKind;scopeId:string;scopeName:string;authorId:string;authorName:string;body:string;createdAt:string;likes:number;liked:boolean;replyCount:number;parentId:string|null;canDelete:boolean};
export type FeedPage = {posts:FeedPost[];nextCursor:string|null;scopes:CommunityScope[]};
export type CommunityMessage = {id:string;sequence:number;authorId:string;authorName:string;body:string;createdAt:string;deleted:boolean};
export type ChatPage = {scope:CommunityScope;messages:CommunityMessage[];cursor:number};
