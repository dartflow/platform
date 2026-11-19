export type MatchRanking = {
  policyVersion: string;
  consents: [boolean, boolean];
  status: 'pending' | 'reserved' | 'booked';
  reservedAt?: string;
  booking?: {
    sequence: number;
    before: [number, number];
    after: [number, number];
    deltas: [number, number];
  };
};

export type RankingEligibility = { eligible: boolean; reason: string | null };
export type MatchRankingDestination={listId:string;name:string;scope:'national'|'club';kind:'rating'|'circuit';policyVersion:string;status:'admitted'|'excluded'|'booked'|'void';generation:string|null;sourceId?:string;sourceRevision?:number;before?:number[];after?:number[];deltas?:number[];reason?:string|null};
export type RankingRow = {
  playerId: string;
  name: string;
  rating: number;
  displayRating: number;
  position: number | null;
  played: number;
  uniqueOpponents: number;
  provisional: boolean;
  active: boolean;
  lastPlayedAt: string | null;
  points?:number;
  results?:{sourceId:string;points:number;place:number;sequence:number;counting:boolean}[];
};

export type RankingsResponse = {
  qualification?:import('./circuit-qualifications').CircuitQualificationView|null;
  qualificationUnavailableReason?:string;
  canCreateQualification?:boolean;
  lists?:import('./ranking-service-types').RankingListView[];
  selectedList?:import('./ranking-service-types').RankingListView;
  approvals?:import('./ranking-service-types').RankingDeclarationView[];
  generation?:{id:string;previousId:string|null;createdAt:string;sourceCount:number}|null;
  managementSources?:{id:string;revision:number;kind:'match'|'event';matchId:string|null;entityId:string|null;verdict:'valid'|'void';playersNames:string[];reason:string;sequence:number}[];
  policy: {
    version: string;
    initialRating: number;
    k: number;
    placementMatches: number;
    placementOpponents: number;
    activeDays: number;
    freeMatchesPerWindow: number;
    windowDays: number;
  };
  updatedAt: string;
  rows: RankingRow[];
  me: RankingRow | null;
  history: {
    matchId: string;
    sequence: number;
    before: number;
    after: number;
    delta: number;
    recordedAt: string;
    opponentName: string;
    sourceId?:string;
    sourceRevision?:number;
    sourceKind?:'match'|'event';
    entityId?:string|null;
    points?:number;
    place?:number|null;
  }[];
};
