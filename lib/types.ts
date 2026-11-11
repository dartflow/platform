export type Role = 'organizer' | 'player';
export type { ClubBoardView,ClubBoardScreenView } from './platform-types';
export type Profile = { id: string; name: string; email?: string; role?: Role; displayNameConfirmed?: boolean };
export type Club = { id: string; name: string; role: Role };
export type Settings = { startScore: 301 | 501 | 701; bestOfLegs: number; bestOfSets: number; legLimit?: number };
export type Visit = { player: string; playerIndex: number; score: number; darts: number; remainingBefore: number; remainingAfter: number; bust: boolean; leg: number; checkout: boolean };
export type Stats = { total: number; darts: number; oneEighties: number; highestFinish: number; legsWon?: number; average?: number };
export type Game = { id: string; players: string[]; startScore: number; bestOf: number; legLimit?: number; legs: number[]; remaining: number[]; turn: number; legStarter: number; status: 'live' | 'finished'; visits: Visit[]; history: Omit<Game, 'history'>[]; stats: Stats[]; winner?: string | null; draw?: boolean };
export type MatchState = {
  id: string; clubId: string; eventId: string; boardId: string | null; revision: number;
  status: 'planned' | 'called' | 'ready' | 'live' | 'result' | 'confirmed' | 'disputed';
  players: Profile[]; writerId: string; settings: Settings; accepted: boolean[];
  scoringMode?: 'shared-writer' | 'per-player';
  delegatedWriterId?: string | null;
  callRef?:string|null;
  paused?:boolean;pausedBy?:string|null;scoringRevision?:number;
  correction?:{id:string;requestedBy:string;reason:string;undoCount:number;visitCount:number;scoringRevision:number}|null;
  administrativeDecision?:{type:'walkover';actorId:string;reason:string};
  confirmations: boolean[]; resultRevision: number | null; game: Game; previousSets: Game[];
  winnerId: string | null; resultPublished: boolean; dispute: string | null;
};
export type MatchView = Omit<MatchState, 'game' | 'previousSets'> & {
  offlineSupported?: boolean;
  remaining: number[]; legs: number[]; sets: number[]; turn: number; checkout: string | null;
  visits: Visit[]; stats: Stats[]; legNumber: number; setNumber: number;
  permissions: { canScore: boolean; canWrite: boolean; canManage: boolean; canAccept: boolean; canConfirm: boolean; canTakeOver: boolean; canUndo: boolean;canPause:boolean;canResume:boolean;canRequestCorrection:boolean;canAnswerCorrection:boolean;canCancelCorrection:boolean };
};
export type MatchAction =
  | { type: 'call'; boardId: string;callRef?:string }
  | { type: 'accept' | 'start' | 'undo' | 'take-over' | 'confirm' | 'release' | 'recover' }
  | {type:'pause';reason?:string}
  | {type:'resume'}
  | {type:'request-correction';reason:string}
  | {type:'approve-correction'|'reject-correction'|'cancel-correction';correctionId:string}
  | { type: 'score'; score: number; darts?: number; doubleConfirmed?: boolean }
  | { type: 'dispute'; reason: string }
  | { type: 'resolve'; reason: string; decision: 'resume' | 'accept' };
export type MatchCommand = { requestId: string; matchId: string; expectedRevision: number; action: MatchAction };
export type EventAction = { type: 'register' | 'withdraw' | 'check-in'; playerId?: string } | { type: 'plan'; playerIds: string[]; settings?: Partial<Settings> };
export type EventView = { id: string; clubId: string; name: string; date: string; capacity: number; canManage: boolean };
export type EntryView = { id: string; eventId: string; playerId: string; name: string; status: 'registered' | 'waitlisted' | 'withdrawn'; checkedIn: boolean };
export type BoardView = { id: string; eventId: string; name: string; blocked: boolean; matchId: string | null };
export type ResultView = { matchId: string; players: Profile[]; legs: number[]; sets: number[]; winnerId: string | null; revision: number };
export type Overview = {
  profile: Profile; clubs: Club[]; currentClub: Club | null; events: EventView[];
  matches: MatchView[]; boards: BoardView[]; participants: EntryView[]; history: ResultView[];
  standings: { playerId: string; name: string; played: number; won: number; drawn: number; points: number }[];
  permissions: { canManage: boolean };
};
export type PublicSnapshot = { board: { id: string; name: string }; event: { name: string }; match: null | Pick<MatchView, 'id' | 'revision' | 'status' | 'players' | 'remaining' | 'legs' | 'sets' | 'turn' | 'checkout' | 'visits' | 'winnerId' | 'resultPublished' | 'settings' | 'writerId' | 'stats' | 'legNumber' | 'setNumber' | 'paused'> };
