export type BoardActivityPhase='active'|'warning'|'released'|'interrupted'|'completed';
export type BoardActivityView={sessionId:string;sourceId:string;sourceKind:'training'|'lobby'|'match';kind:'free'|'official';phase:BoardActivityPhase;serverNow:number;activityAt:number;warningAt:number;deadlineAt:number;warningEpoch:string;extensionsUsed:number;maxExtensions:2;boardIds:string[];canExtend:boolean;reason?:string};
export function boardActivityClock(activityAt:number,serverNow:number):{phase:'active'|'warning'|'expired';warningAt:number;deadlineAt:number;remainingSeconds:number}{
 const warningAt=activityAt+120000,deadlineAt=activityAt+180000;
 return {phase:serverNow>=deadlineAt?'expired':serverNow>=warningAt?'warning':'active',warningAt,deadlineAt,remainingSeconds:Math.max(0,Math.ceil((deadlineAt-serverNow)/1000))};
}
