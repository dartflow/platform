export const NATIONAL_RATING_ID = '10000000-0000-4000-8000-000000000001';
export const NATIONAL_CIRCUIT_ID = '10000000-0000-4000-8000-000000000002';

export type RankingPolicy = {
  version: string;
  discipline: 'x01'|'cricket';
  cricketMode?:'standard'|'no-score';
  startScore: 301 | 501 | 701;
  bestOfLegs: number[];
  initialRating: number;
  k: number;
  placementMatches: number;
  placementOpponents: number;
  activeDays: number;
  season: string;
  eventCount: number;
  bestResults: number;
  minimumStarters: number;
  allowGuests: boolean;
};
export type RankingList = {
  id: string;
  name: string;
  kind: 'rating' | 'circuit';
  scope: 'national' | 'club';
  clubId: string | null;
  policyVersion: number;
  policy: RankingPolicy;
  generation: string | null;
  closesAt: string | null;
  canManage: boolean;
};
export type RankingListView=RankingList;
export type RankingDeclarationView={id:string;entityId:string;eventName:string;listId:string;listName:string;scope:'national'|'club';kind:'rating'|'circuit';status:'pending'|'approved'|'rejected';policyVersion:number;policy:RankingPolicy;rules:RankingRule[];reason:string|null;canApprove:boolean;accepted:boolean;canRecertify?:boolean;recertificationRequired?:boolean;reconfirmationRequired?:boolean};
export type RankingEventDetails={entityId:string;name:string;ownership:string;canRequest:boolean;canFinalize:boolean;canAccept?:boolean;fixtures?:{id:string;phase:RankingRule['phase'];round:number}[];rosterReconfirmations?:import('./ranking-rosters').RankingRosterReconfirmation[];declarations:RankingDeclarationView[];availableLists:RankingListView[]};
export type RankingRule = { phase?: 'pool' | 'knockout' | 'league'|'winners'|'losers'|'final'|'reset'|'swiss'; round?: number; fixtureId?: string; enabled: boolean };
export type RankingServiceCommand = { requestId: string; action: { type: string; [key: string]: unknown } };
export type RankingServiceResponse = { ok: true; id: string; generation?: string; affectedPlayers?: number; previousGeneration?: string | null };
