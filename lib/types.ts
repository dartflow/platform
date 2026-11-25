export type Role = 'organizer' | 'player';
export type { ClubBoardView,ClubBoardScreenView } from './platform-types';
export type Profile = { id: string; name: string; email?: string; role?: Role; displayNameConfirmed?: boolean;username?:string|null;displayName?:string|null;fullName?:string|null;usernameLocked?:boolean;identityNeedsReview?:boolean;avatar?:string|null;pinConfigured?:boolean;showPublicStatistics?:boolean;onboardingComplete?:boolean };
export type Club = { id: string; name: string; role: Role };
export type StartDecision={procedure:'bull'|'server-lot'|'home-first';ruleVersion:1;starter?:0|1};
export type BullState={reason:'match'|'deciding-leg';setNumber:number;legNumber:number;status:'throwing'|'confirming'|'complete';round:number;order:[0|1,0|1];throws:{round:number;side:0|1;hit:'DB'|'SB'|'outside'}[];winner?:0|1;confirmed:[boolean,boolean]};
export type Settings = { legWinByTwo?:import('./match-winning-rules').WinByTwo;setWinByTwo?:import('./match-winning-rules').WinByTwo;startProcedure?:StartDecision['procedure'];setOpener?:'continuous'|'alternate-sets';decidingLeg?:'continue'|'rebull'; discipline?:'x01'|'cricket'|'tactics';cricketMode?:'standard'|'no-score';tacticsPreset?:'tactics-5'|'tactics-3';tacticsMode?:'standard'|'no-score'; startScore: 301 | 501 | 701; bestOfLegs: number; bestOfSets: number; legLimit?: number;inRule?:'single'|'double';outRule?:'straight'|'double'|'master';sideStartScores?:[number,number] };
export type Visit = { tactics?:{attempt:number;marksBefore:number[];marksAfter:number[];pointsBefore:number;pointsAfter:number;creditedMarks:number};cricket?:{marksBefore:number[];marksAfter:number[];pointsBefore:number;pointsAfter:number;creditedMarks:number}; player: string; playerIndex: number; throwerId?:string; score: number; darts: number; remainingBefore: number; remainingAfter: number; bust: boolean; leg: number; checkout: boolean; measurementVersion?:1; doubleAttempts?:number|null;dartHits?:string[];observedScore?:number;openedBefore?:boolean;openedAfter?:boolean;endReason?:'turn'|'bust'|'finish' };
export type Stats = { total: number; darts: number; oneEighties: number; highestFinish: number; legsWon?: number; average?: number;measurementComplete?:boolean;hundredPlus?:number;hundredFortyPlus?:number;firstNine?:number|null;bestLegDarts?:number|null;checkoutPercentage?:number|null };
export type Game = { tactics?:import('./tactics').TacticsState;tacticsPreset?:Settings['tacticsPreset'];tacticsMode?:Settings['tacticsMode'];legWinByTwo?:import('./match-winning-rules').WinByTwo;legStartOverrides?:Record<string,0|1>; discipline?:Settings['discipline'];cricketMode?:Settings['cricketMode'];cricket?:import('./cricket').CricketState; id: string; players: string[]; sidePlayers?:[string[],string[]]; legOffset?:number; startScore: number; bestOf: number; legLimit?: number; legs: number[]; remaining: number[]; turn: number; legStarter: number; status: 'live' | 'finished'; visits: Visit[]; history: Omit<Game, 'history'>[]; stats: Stats[]; winner?: string | null; draw?: boolean;inRule?:Settings['inRule'];outRule?:Settings['outRule'];sideStartScores?:[number,number];opened?:[boolean,boolean] };
export type MatchState = {startDecision?:StartDecision;bull?:BullState;bullHistory?:BullState[];
  guestPlayerIds?:string[];
  id: string; clubId: string; eventId: string; boardId: string | null; revision: number;
  status: 'planned' | 'called' | 'ready' | 'live' | 'result' | 'confirmed' | 'disputed' | 'abandoned' | 'interrupted';
  players: Profile[]; writerId: string; settings: Settings; accepted: boolean[];
  sideParticipants?:[Profile[],Profile[]]; sideNames?:[string,string];
  scoringMode?: 'shared-writer' | 'per-player';
  remoteBoardIds?:[string,string];remoteWriterIds?:[string,string];cameraRequired?:boolean;
  delegatedWriterId?: string | null;
  localCompanion?:{playerId:string;writerId:string;lobbyId:string};
  ranking?:import('./ranking-types').MatchRanking;
  primaryCorrection?:{requestId:string;originalResultRevision:number;phase:'rescoring'|'confirmed'};
  callRef?:string|null;
  offlineConflict?:import('./offline-score-conflicts').OfflineScoreConflict;
  paused?:boolean;pausedBy?:string|null;scoringRevision?:number;
  correction?:{id:string;requestedBy:string;reason:string;undoCount:number;visitCount:number;scoringRevision:number}|null;
  administrativeDecision?:{type:'walkover';actorId:string;reason:string};
  boardInterruption?:{sessionId:string;reason:'timeout'|'forced';at:string;previousStatus:MatchState['status']};
  confirmations: boolean[]; resultRevision: number | null; game: Game; previousSets: Game[];
  winnerId: string | null; resultPublished: boolean; dispute: string | null;
};
export type MatchView = Omit<MatchState, 'game' | 'previousSets'> & {
  guestOperators?:{id:string;name:string;permissions:{canAccept:boolean;canConfirm:boolean;canScore:boolean;canUndo:boolean;canStart:boolean;canDrawStart:boolean;canBullThrow:boolean;canBullConfirm:boolean}}[];
  currentThrower?:Profile;cricket?:import('./cricket').CricketState;tactics?:import('./tactics').TacticsState;
  rankingDestinations?:import('./ranking-types').MatchRankingDestination[];
  rankingEligibility?:import('./ranking-types').RankingEligibility;
  offlineSupported?: boolean;
  scoringState?:Game;
  freeSession?:{canResume:boolean;canMove:boolean};
  boardActivity?:import('./board-activity-types').BoardActivityView;
  currentLegVisits?:Visit[];
  currentLegStartScore?:number;
  remaining: number[]; legs: number[]; sets: number[]; turn: number; checkout: string | null;
  visits: Visit[]; stats: Stats[]; legNumber: number; setNumber: number;
  permissions: { canDrawStart?:boolean;canBullThrow?:boolean;canBullConfirm?:boolean;canBullConfirmCompanion?:boolean;canMedia?:boolean;canScore: boolean; canWrite: boolean; canManage: boolean; canAccept: boolean; canConfirm: boolean; canTakeOver: boolean; canUndo: boolean;canPause:boolean;canResume:boolean;canRequestCorrection:boolean;canAnswerCorrection:boolean;canCancelCorrection:boolean };
};
export type MatchAction =
  | { type: 'call'; boardId: string;callRef?:string }
  | { type: 'accept' | 'start' | 'undo' | 'take-over' | 'confirm' | 'release' | 'recover' }
  | {type:'draw-start'|'bull-confirm'|'bull-confirm-companion'}
  | {type:'bull-throw';hit:'DB'|'SB'|'outside'}
  | {type:'pause';reason?:string}
  | {type:'resume'}
  | {type:'resolve-offline-conflict';conflictId:string;reason:string;decision?:'keep-server'|'use-offline'}
  | {type:'ranking-consent';consent:boolean}
  | {type:'request-correction';reason:string}
  | {type:'approve-correction'|'reject-correction'|'cancel-correction';correctionId:string}
  | { type: 'score'; score: number; darts?: number; doubleConfirmed?: boolean;doubleAttempts?:number|null;dartHits?:string[];bust?:boolean }
  | { type: 'dispute'; reason: string }
  | { type: 'resolve'; reason: string; decision: 'resume' | 'accept' };
export type MatchCommand = { guestId?:string;offline?:boolean;requestId: string; matchId: string; expectedRevision: number; action: MatchAction };
export type EventAction = { type: 'register' | 'withdraw' | 'check-in'; playerId?: string } | { type: 'plan'; playerIds: string[]; settings?: Partial<Settings> };
export type EventView = { id: string; clubId: string; name: string; date: string; capacity: number; canManage: boolean };
export type EntryView = { id: string; eventId: string; playerId: string; name: string; status: 'registered' | 'waitlisted' | 'withdrawn'; checkedIn: boolean };
export type BoardView = { id: string; eventId: string; name: string; blocked: boolean; matchId: string | null };
export type BoardScreenDevice = {id:string;name:string;createdAt:string;expiresAt:string;paired:boolean;revoked:boolean;lastSeenAt?:string|null};
export type ResultView = { matchId: string; players: Profile[]; legs: number[]; sets: number[]; winnerId: string | null; revision: number };
export type Overview = {
  profile: Profile; clubs: Club[]; currentClub: Club | null; events: EventView[];
  matches: MatchView[]; boards: BoardView[]; participants: EntryView[]; history: ResultView[];
  standings: { playerId: string; name: string; played: number; won: number; drawn: number; points: number }[];
  permissions: { canManage: boolean };
};
export type PublicSnapshot = {
 play?:import('./play-session-types').PublicPlaySession;
 competitionLobby?:import('./competition-board-lobby-types').CompetitionLobbyDisplay;
 pendingCall?:{label:string;players:[string,string];writerName?:string};
 encounter?:{name:string;homeName:string;awayName:string;score:[number,number];legs:[number,number];component:{index:number;label:string}};
 theme?:import('./oche-device-types').OcheScreenTheme; statistics?:import('./player-statistics-types').OcheHistoricalStatistics;sessionKey?:string;scoreEvents?:import('./score-events').ScoreEvent[];boardActivity?:import('./board-activity-types').BoardActivityView; board: { id: string; name: string }; event: { name: string }; match: null | Pick<MatchView, 'id' | 'revision' | 'status' | 'players' | 'remaining' | 'legs' | 'sets' | 'turn' | 'checkout' | 'visits' | 'currentLegVisits' | 'currentLegStartScore' | 'winnerId' | 'resultPublished' | 'settings' | 'writerId' | 'scoringMode' | 'stats' | 'legNumber' | 'setNumber' | 'paused' | 'sideParticipants' | 'sideNames' | 'currentThrower' | 'cricket' | 'tactics' | 'bull' | 'startDecision'> };
