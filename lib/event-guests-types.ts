import type {ResultView} from './types';
export type ParticipantImportRow={line:number;name:string;username?:string;kind:'account'|'guest';status:'add'|'skip'|'ambiguous'|'invalid';reason:string;playerId?:string};
export type ParticipantImportPreview={id:string;baseRevision:number;rows:ParticipantImportRow[];summary:{add:number;skip:number;ambiguous:number;invalid:number};missingColumns:string[];drawImpact:string;expiresAt:string};
export type EventGuestClaim={id:string;entityId:string;eventName:string;guestId:string;guestName:string;accountId:string;accountName:string;proposedByName:string;reason:string;status:'pending'|'accepted'|'declined';canAccept:boolean;createdAt:string};
export type OrganizerParticipants={entityId:string;revision:number;canManage:boolean;canImport:boolean;drawPublished:boolean;allowGuests:boolean;guests:{id:string;name:string;status:string;checkedIn:boolean;claim?:Pick<EventGuestClaim,'id'|'status'|'accountId'|'accountName'>}[]};
export type GuestHistory={entityId:string;eventName:string;guestId:string;guestName:string;matches:ResultView[];classification?:string};
export type MyGuestClaims={claims:EventGuestClaim[];history:GuestHistory[]};
export type OrganizerParticipantCommand={requestId:string;expectedRevision?:number;action:
 |{type:'participants.preview';entityId:string;csv:string}
 |{type:'participants.apply';entityId:string;previewId:string}
 |{type:'guest.add';entityId:string;name:string}
 |{type:'guest.checkin';entityId:string;guestId:string}
 |{type:'guest.claim.propose';entityId:string;guestId:string;accountId:string;reason:string}
 |{type:'guest.claim.decide';claimId:string;decision:'accept'|'decline';reason?:string}
};
export type OrganizerParticipantResponse={ok:true;entityId:string;revision:number;preview?:ParticipantImportPreview;previewExpired?:boolean;applied?:{added:number;skipped:number;invalid:number};guestId?:string;claimId?:string};
