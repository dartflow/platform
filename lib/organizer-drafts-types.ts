export type OrganizerDraftKind='tournament'|'season';
export type OrganizerOwnership='personal'|'club'|'platform';
export type OrganizerDraft={id:string;ownerId:string;kind:OrganizerDraftKind;ownership:OrganizerOwnership;clubId:string|null;name:string;revision:number;step:string;values:Record<string,unknown>;createdAt:string;updatedAt:string;canEdit:boolean};
export type OrganizerDraftCommand={requestId:string;action:{type:'draft.save'|'draft.delete';id?:string;expectedRevision:number;kind?:OrganizerDraftKind;ownership?:OrganizerOwnership;clubId?:string|null;name?:string;step?:string;values?:Record<string,unknown>}};
export type OrganizerDraftResponse={ok:true;id:string;draft?:OrganizerDraft};
