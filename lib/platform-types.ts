import type { Game, MatchView, Profile, PublicSnapshot,ResultView, Settings } from './types';

export type ClubBoardView = { id:string;clubId:string;name:string;access:'all'|'club';blocked:boolean;occupied:boolean;closed?:boolean;closePending?:boolean;publicScan?:boolean;canManage:boolean;playUrl:string;screenUrl:string };
export type ClubBoardScreenView = {board:Omit<ClubBoardView,'clubId'|'canManage'>&{clubName:string;locationKind?:'home'|'venue'};status:'available'|'waiting'|'playing'|'blocked'|'closed'|'reserved';snapshot:PublicSnapshot;screen?:{rotation:0|90|270;paired?:boolean};reservation?:{label:string;startsAt:string;endsAt:string;overrun:boolean}};

export type PlatformKind = 'training' | 'club' | 'room' | 'lobby' | 'league' | 'tournament';
export type PlatformMember = { id: string; name: string; role: string; status: string; attributes: Record<string, unknown> };
export type PoolCriterion='points'|'legDifference'|'legsFor'|'headToHead';
export type FixtureSource = { fixtureId?: string; outcome?: 'winner'|'loser';playedOnly?:boolean; pool?: string; position?: number;criteria?:PoolCriterion[];resolvedPlayerId?:string;poolProof?:string };
export type Fixture = { id: string; players: (string | null)[]; round: number; phase: 'pool' | 'knockout' | 'league' | 'winners' | 'losers' | 'final' | 'reset' | 'swiss'; pool?: string; sources?: FixtureSource[]; status: 'scheduled' | 'proposed' | 'live' | 'confirmed' | 'bye' | 'void'; matchId?: string; winnerId?: string | null; score?: number[]; proposedBy?: string; proposedTime?: string; time?: string; resetOf?: string; pairingNotice?: string; started?: boolean; administrative?: boolean;purpose?:'bronze'|'pool-decider'|'consolation';decisionId?:string;requiresRelease?:boolean;released?:boolean;settings?:Settings;rankingEligibleSingle?:boolean };
export type TournamentDraw={revision:number;method:'random'|'seeded'|'manual';closedAt:string;input:{playerId:string;name:string;clubGroup?:string}[];seedPlayerIds:string[];order:string[];spreadClubs:boolean;notices:string[];bronze:boolean;consolation?:boolean;consolationTitle?:string;poolCriteria:PoolCriterion[];reason?:string;seed:string};
export type PoolRow={id:string;position:number;shared:boolean;played:number;won:number;drawn:number;points:number;legsFor:number;legsAgainst:number;headToHead:number|null};
export type PoolDecision={id:string;pool:string;playerIds:string[];phase:'pool'|'knockout'|'complete';fixtureIds:string[];order:string[];seed:string;sourceProof:string;stale?:boolean;groups?:{playerIds:string[];offset:number;fixtureIds:string[]}[]};
export type TournamentControl={version:1;poolCriteria:PoolCriterion[];releasedRounds:number[];decisions:PoolDecision[];poolTables?:{pool:string;rows:PoolRow[];blockedGroups:{playerIds:string[]}[]}[]};
export type TournamentRules = {algorithmVersion:string;seedOrder:string[];drawSeed:string;swissRounds?:number;finalVariant?:'reset'|'single';draw?:TournamentDraw};
export type PlatformState = {
  name: string; description?: string; capacity?: number; mode?: 'solo' | 'bot' | 'around' | '170';
  game?: Game; rounds?: number[]; completed?: boolean; botAverage?: number; undo?: Game[];
  settings?: Settings; setup?: string; ready?: Record<string, boolean>; matchId?: string;
  eventId?: string; coreClubId?: string; fixtures?: Fixture[]; format?: string; poolCount?: number;
  tournamentRules?: TournamentRules; swissRounds?: number;
  consolation?:import('./tournament-consolation').ConsolationState;
  tournamentRuleOverrides?:import('./tournament-rule-overrides').TournamentRuleOverride[];
  tournamentControl?:TournamentControl;drawHistory?:{draw:TournamentDraw;fixtures:Fixture[]}[];
  cast?: { scene: string; boardId?: string; preview?: string; updatedAt: string }; closed?: boolean;
  [key: string]: unknown;
};
export type PlatformEntity = { id: string; kind: PlatformKind; name: string; ownerId: string; clubId: string | null; visibility: string; revision: number; state: PlatformState; members: PlatformMember[]; canManage: boolean;inviteCode?:string;boardActivity?:import('./board-activity-types').BoardActivityView };
export type PlatformMessage = { id: string; authorId: string; authorName: string; body: string; createdAt: string };
export type PlatformOverview = { profile: Profile;matches:MatchView[];history:ResultView[]; players: Profile[]; clubs: PlatformEntity[];clubBoards:ClubBoardView[]; rooms: PlatformEntity[]; trainings: PlatformEntity[]; leagues: PlatformEntity[]; tournaments: PlatformEntity[]; lobbies: PlatformEntity[]; friends: (Profile & { status: 'friend' | 'incoming' | 'outgoing'; favorite: boolean })[]; blocked: Profile[]; preferences: { discoverable: boolean; allowRequests: boolean }; messages: Record<string, PlatformMessage[]>;registrations: {userId:string;name:string;status:string;reason:string|null}[];reports:{id:string;reporterId:string;reporterName:string;targetId:string|null;roomId:string|null;roomName:string;reason:string;status:string;decision:string|null;canManage:boolean}[];canManageRegistrations:boolean;statistics:{played:number;won:number;drawn:number;average:number;oneEighties:number;highestFinish:number;totalDarts:number;trainingSessions:number} };
export type PlatformCommand = { requestId: string; expectedRevision?: number; action: { type: string; [key: string]: unknown } };
export type PlatformResponse = { ok: true; id?: string; matchId?: string; code?: string; entity?: PlatformEntity; [key: string]: unknown };
