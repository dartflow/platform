import type{PlayRules,PlaySnapshot,PlayState,PlayVisitInput}from'./play-types';
export type PlayPrincipal={accountId?:string|null;token?:string|null;ipKey?:string};
export type PlayParticipant={id:string;name:string;isGuest:boolean;claimed:boolean;accountId?:string|null};
export type PlayPermission={canScore:boolean;canUndo:boolean;canManage:boolean;canResume:boolean;canMove:boolean;canTransfer:boolean;canResolve:boolean;canReplayAttempt:boolean;canClaim:boolean};
export type PlayGrant={participantId?:string;purpose:'controller'|'participant'|'claim'|'recovery';token:string;expiresAt:string|null;url:string};
export type PlayConflict={id:string;status:'open'|'resolved';canonicalRevision:number;createdAt:string;commands:{requestId:string;expectedRevision:number;writerEpoch:number;participantId:string|null;input:PlayVisitInput}[];canonical:{turn:number;lastVisit:number;progress:PlaySnapshot['progress']};reason?:string;decision?:'keep-server'|'use-offline';resolvedBy?:string;baseGame?:PlayState;canonicalGame?:PlayState};
export type PlaySessionView={id:string;sourceName?:string;challengeId?:string;currentParticipantId?:string|null;revision:number;status:'active'|'interrupted'|'completed';deviceMode:'shared'|'individual';rules:PlayRules;rulesHash:string;game:PlaySnapshot;participants:PlayParticipant[];boardIds:string[];boards:{id:string;name:string}[];writer:{participantId:string|null;epoch:number;lastAcceptedVisit:number};permissions:PlayPermission;serverNow:number;activityAt:number;warningAt:number;deadlineAt:number|null;warningEpoch:string;extensionsUsed:number;maxExtensions:2;claimExpiresAt:string|null;recoverExpiresAt:string|null;conflict?:PlayConflict;privateAccess?:{grants:PlayGrant[]};statisticsClass:'free'|'practice'|'challenge';rankingEligible:false;interruptedAt?:string|null;completedAt?:string|null};
export type PublicPlaySession={id:string;sourceName?:string;sessionKey:string;version:1;revision:number;status:PlaySessionView['status'];mode:PlayRules['mode'];rules:PlayRules;game:PlaySnapshot;participants:{id:string;name:string}[];writerName:string;serverNow:number;activityAt:number;warningAt:number;deadlineAt:number|null;extensionsUsed:number;maxExtensions:2};
export type PlayBoardView={board:{id:string;name:string;available:boolean;status:'available'|'occupied'|'reserved'|'closed';reason?:string};canStart:boolean;requiresAccount:boolean;play?:PublicPlaySession;officialUrl?:string};
export type PlayRetentionPolicy={claimDays:number;recoveryDays:number;revision:number};
export type PlayQueuedCommand={requestId:string;expectedRevision:number;writerEpoch:number;rulesHash:string;participantId?:string;input:PlayVisitInput};
export type PlayAction=
 |{type:'session.create';boardId?:string;deviceMode:'shared'|'individual';players:{name:string;accountId?:string}[];sides?:number[][];rules:unknown;starter?:number}
 |{type:'session.score';input:PlayVisitInput;writerEpoch:number;rulesHash:string;participantId?:string;offline?:boolean}
 |{type:'session.undo';writerEpoch:number;rulesHash:string}
 |{type:'session.replay';commands:PlayQueuedCommand[]}
 |{type:'session.interrupt';reason?:string}
 |{type:'session.resume';boardId?:string}
 |{type:'session.move';boardId:string;reason?:string}
 |{type:'session.transfer';participantId:string;pendingRequestIds:string[];reason:string}
 |{type:'session.resolve-conflict';conflictId:string;decision:'keep-server'|'use-offline';reason:string}
 |{type:'session.restart-attempt'}
 |{type:'session.extend';warningEpoch:string}
 |{type:'session.issue-link';participantId:string;purpose:'participant'|'claim'|'recovery'}
 |{type:'session.join';name?:string}
 |{type:'session.pin';participantId:string;username:string;pin:string}
 |{type:'session.claim';claimToken:string}
 |{type:'policy.update';claimDays:number;recoveryDays:number;expectedPolicyRevision:number};
export type PlayCommand={requestId:string;sessionId?:string;expectedRevision?:number;action:PlayAction};
export type PlayResponse={ok:true;session?:PlaySessionView;policy?:PlayRetentionPolicy;accepted?:string[];pending?:string[];conflict?:boolean;claimedParticipantId?:string};
export type StoredPlayParticipant=PlayParticipant&{createdAsGuest:boolean;claimedAt?:string;claimedBy?:string};
export type StoredPlaySession={id:string;deviceMode:'shared'|'individual';game:PlayState;participants:StoredPlayParticipant[];writerParticipantId:string|null;writerCapabilityId:string|null;writerEpoch:number;writerHistory:{epoch:number;capabilityId:string|null;participantId:string|null;fromRevision:number;untilRevision?:number}[];rulesHash:string;statisticsClass:PlaySessionView['statisticsClass'];conflicts:PlayConflict[];completedAt:string|null;interruptedAt:string|null;claimExpiresAt:string|null;recoverExpiresAt:string|null;claimDays:number;recoveryDays:number;challengeId?:string;challengeRequestHash?:string;sourceVersion?:string};
