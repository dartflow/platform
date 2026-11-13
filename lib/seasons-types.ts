import type {Settings} from './types';

export type SeasonStatus='draft'|'registration'|'planned'|'active'|'completed'|'archived';
export type SeasonFormat='singles'|'teams'|'doubles'|'cup'|'ladder'|'drop-in'|'champions';
export type SeasonSettings={
 scheduleMode:'fixed'|'flex';playMode:'local'|'remote';startDate:string;playTime:string;timezone:string;
 roundDays:number;windowDays:number;slotMinutes:number;boardCount:number;boardIds:string[];capacity:number;
 legMode:'bestOf'|'fixed';legs:number;startScore:301|501|701;pointsWin:number;pointsDraw:number;pointsLoss:number;
 ranking:'points'|'legs';visibility:'members'|'public'|'invite';lineupHours:number;confirmHours:number;checkInMinutes:number;
 returnLegs:boolean;roundGating:boolean;blackouts:string[];inhaalWeeks:number;withdrawalPolicy:'progress'|'preserve'|'remove';
 promotionPlaces:number;relegationPlaces:number;slotCount:4|7;allowMultipleTeams:boolean;cameraRequired:boolean;notes:string;
};
export type SeasonParticipant={id:string;name:string;divisionId:string;status:'active'|'waiting'|'invited'|'withdrawn';available:boolean;checkedIn:boolean;restUntil?:string};
export type SeasonTeam={id:string;name:string;clubId:string;divisionId:string;captainId:string;deputyId:string|null;playerIds:string[];status:'active'|'waiting'|'withdrawn'};
export type SeasonSlot={id:string;index:number;players:[string|null,string|null];starter:0|1;status:'scheduled'|'live'|'provisional'|'confirmed'|'administrative'|'interrupted'|'canceled';matchId?:string;score?:[number,number];winnerId?:string|null;administrative?:{winner:0|1|null;reason:string};resultRevision?:number;canPinCheckIn?:boolean};
export type SeasonLineup={players:(string|null)[];submittedAt:string|null;submittedBy:string};
export type SeasonFixture={
 id:string;round:number;divisionId:string;homeId:string;awayId:string;status:'scheduled'|'proposed'|'live'|'provisional'|'confirmed'|'disputed'|'administrative'|'interrupted'|'canceled';
 startsAt?:string;endsAt?:string;windowStart:string;windowEnd:string;boardIds:string[];writerId?:string;slots:SeasonSlot[];
 lineups:{home?:SeasonLineup;away?:SeasonLineup};confirmations:string[];checkIns:string[];availability?:Record<string,boolean>;
 proposal?:{startsAt:string;endsAt:string;boardIds:string[];by:string;side:string};
 dispute?:{reason:string;actorId:string;at:string};confirmedAt?:string;administrative?:{score:[number,number];reason:string;points?:[number,number]};
 capabilities?:{canLineupHome:boolean;canLineupAway:boolean;canPropose:boolean;canConfirm:boolean;canDispute:boolean;canStart:boolean;canCheckIn:boolean;canManage:boolean};
};
export type SeasonDecision={id:string;actorId:string;at:string;action:string;reason:string;fixtureId?:string;previous?:unknown};
export type SeasonRound={number:number;startsAt:string;endsAt:string;released:boolean};
export type SeasonStanding={id:string;name:string;divisionId:string;position:number;shared:boolean;played:number;won:number;drawn:number;lost:number;points:number;deduction:number;partiesFor:number;partiesAgainst:number;legsFor:number;legsAgainst:number;form:('W'|'G'|'V')[]};
export type SeasonState={id:string;revision:number;name:string;scope:'internal'|'national';clubId:string|null;ownerId:string;managerIds:string[];status:SeasonStatus;format:SeasonFormat;settings:SeasonSettings;rulesVersion:number;publishedAt:string|null;eventId:string;coreClubId:string;divisions:{id:string;name:string;region?:string}[];participants:SeasonParticipant[];teams:SeasonTeam[];rounds:SeasonRound[];fixtures:SeasonFixture[];decisions:SeasonDecision[];deductions:Record<string,number>;createdAt:string;copiedFrom?:string};
export type SeasonView=SeasonState&{standings:SeasonStanding[];canManage:boolean;myTeamIds:string[];capabilities:{canEnroll:boolean;canRegisterTeam:boolean;canPlay:boolean;unsupportedReason:string|null};eligiblePlayers:{id:string;name:string;clubIds:string[]}[];boards:{id:string;name:string;clubId:string}[];statistics:{playerId:string;name:string;played:number;average:number|null;oneEighties:number;highestFinish:number;firstNine:number|null;bestLegDarts:number|null}[];conflicts:{fixtureId:string;reason:string}[]};
export type SeasonsOverview={seasons:SeasonView[];clubs:{id:string;name:string;canManage:boolean}[];canCreateNational:boolean};
export type SeasonCommand={requestId:string;expectedRevision?:number;action:{type:string;seasonId?:string;[key:string]:unknown}};
export type SeasonResponse={ok:true;id:string;season:SeasonView;matchId?:string};
export type SeasonFeedSource={id:string;seasonId:string;revision:number;name:string;scope:'internal'|'national';clubId:string|null;visibility:SeasonSettings['visibility'];participantIds:string[];home:{id:string;name:string};away:{id:string;name:string};score:[number,number];legs:[number,number];matchIds:string[];confirmedAt:string;href:string;canShare:boolean;settings?:Settings;setup?:'localone';canRematch:boolean};
export type SeasonPlayerFixture={seasonId:string;revision:number;seasonName:string;fixtureId:string;scope:SeasonState['scope'];status:SeasonFixture['status'];round:number;startsAt:string|null;windowStart:string;windowEnd:string;opponent:string;boardIds:string[];matchId:string|null;writerId:string|null;checkedIn:boolean;available:boolean;canCheckIn:boolean;canConfirm:boolean;href:string};
export function coreSeasonSettings(settings:SeasonSettings):Settings{return {startScore:settings.startScore,bestOfLegs:settings.legMode==='fixed'?Math.min(settings.legs+1,9):settings.legs,bestOfSets:1,...(settings.legMode==='fixed'?{legLimit:settings.legs}:{})};}
