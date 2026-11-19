export type CorrectionCategory='score'|'eligibility'|'conduct'|'camera'|'other';
export type CorrectionPolicy={requestHours:number;appealHours:number;responseHours:number;evidenceDays:number};
export type CorrectionMoment={visitIndex:number;setNumber:number;leg:number;playerName:string;score:number;darts:number;bust:boolean;checkout:boolean};
export type MatchCorrectionView={
 id:string;status:'pending'|'approved'|'rejected'|'cancelled';requestedBy:string;requestedByName:string;reason:string;
 baseRevision:number;resultRevision:number;undoCount:number;createdAt:string;decidedBy:string|null;decisionReason:string|null;decidedAt:string|null;
 canReview:boolean;canCancel:boolean;canRepair?:boolean;
 category?:CorrectionCategory;moment?:CorrectionMoment|null;evidenceText?:string;evidenceExpired?:boolean;retainUntil?:string;responseDueAt?:string;
 responses?:{actorId:string;actorName:string;reason:string;at:string;evidenceText?:string}[];appealOf?:string;appealDeadline?:string;canRespond?:boolean;canAppeal?:boolean;canClose?:boolean;closedAt?:string;
 timeline?:{type:string;actorName:string;at:string;reason?:string}[];
};
export type MatchCorrectionsView={
 matchId:string;canRequest:boolean;canReview:boolean;maxUndoCount:number;requests:MatchCorrectionView[];unavailableReason?:string;
 policy?:CorrectionPolicy;moments?:CorrectionMoment[];
 dependencyHold:null|{requestId:string;entityId:string;downstreamFixtureIds:string[];message:string};
};
export type MatchCorrectionCommand={requestId:string;action:
 |{type:'correction.request';matchId:string;expectedRevision:number;undoCount:number;reason:string;category?:CorrectionCategory;visitIndex?:number;evidenceText?:string;lateReason?:string}
 |{type:'correction.decide';correctionId:string;decision:'approve'|'reject';reason:string}
 |{type:'correction.cancel';correctionId:string}
 |{type:'correction.repair';correctionId:string;reason:string}
 |{type:'correction.respond';correctionId:string;reason:string;evidenceText?:string}
 |{type:'correction.appeal';correctionId:string;reason:string;evidenceText?:string}
 |{type:'correction.close';correctionId:string;reason:string}
};
export type MatchCorrectionResponse={ok:true;id:string;matchId:string;status:MatchCorrectionView['status'];dependencyHold?:MatchCorrectionsView['dependencyHold']};
