import type { Game, MatchView, Profile, PublicSnapshot,ResultView, Settings } from './types';

export type ClubBoardView = { id:string;clubId:string;name:string;access:'all'|'club';blocked:boolean;occupied:boolean;closed?:boolean;closePending?:boolean;publicScan?:boolean;canManage:boolean;playUrl:string;screenUrl:string };
export type ClubBoardScreenView = {board:Omit<ClubBoardView,'clubId'|'canManage'>&{clubName:string;locationKind?:'home'|'venue'};status:'available'|'waiting'|'playing'|'blocked'|'closed'|'reserved';snapshot:PublicSnapshot;reservation?:{label:string;startsAt:string;endsAt:string;overrun:boolean}};

export type PlatformKind = 'training' | 'club' | 'room' | 'lobby' | 'league' | 'tournament';
export type PlatformMember = { id: string; name: string; role: string; status: string; attributes: Record<string, unknown> };
export type Fixture = { id: string; players: (string | null)[]; round: number; phase: 'pool' | 'knockout' | 'league'; pool?: string; sources?: { fixtureId?: string; pool?: string; position?: number }[]; status: 'scheduled' | 'proposed' | 'live' | 'confirmed' | 'bye'; matchId?: string; winnerId?: string | null; score?: number[]; proposedBy?: string; proposedTime?: string; time?: string };
export type PlatformState = {
  name: string; description?: string; capacity?: number; mode?: 'solo' | 'bot' | 'around' | '170';
  game?: Game; rounds?: number[]; completed?: boolean; botAverage?: number; undo?: Game[];
  settings?: Settings; setup?: string; ready?: Record<string, boolean>; matchId?: string;
  eventId?: string; coreClubId?: string; fixtures?: Fixture[]; format?: string; poolCount?: number;
  cast?: { scene: string; boardId?: string; preview?: string; updatedAt: string }; closed?: boolean;
  [key: string]: unknown;
};
export type PlatformEntity = { id: string; kind: PlatformKind; name: string; ownerId: string; clubId: string | null; visibility: string; revision: number; state: PlatformState; members: PlatformMember[]; canManage: boolean;inviteCode?:string;boardActivity?:import('./board-activity-types').BoardActivityView };
export type PlatformMessage = { id: string; authorId: string; authorName: string; body: string; createdAt: string };
export type PlatformOverview = { profile: Profile;matches:MatchView[];history:ResultView[]; players: Profile[]; clubs: PlatformEntity[];clubBoards:ClubBoardView[]; rooms: PlatformEntity[]; trainings: PlatformEntity[]; leagues: PlatformEntity[]; tournaments: PlatformEntity[]; lobbies: PlatformEntity[]; friends: (Profile & { status: 'friend' | 'incoming' | 'outgoing'; favorite: boolean })[]; blocked: Profile[]; preferences: { discoverable: boolean; allowRequests: boolean }; messages: Record<string, PlatformMessage[]>;registrations: {userId:string;name:string;status:string;reason:string|null}[];reports:{id:string;reporterId:string;reporterName:string;targetId:string|null;roomId:string|null;roomName:string;reason:string;status:string;decision:string|null;canManage:boolean}[];canManageRegistrations:boolean;statistics:{played:number;won:number;drawn:number;average:number;oneEighties:number;highestFinish:number;totalDarts:number;trainingSessions:number} };
export type PlatformCommand = { requestId: string; expectedRevision?: number; action: { type: string; [key: string]: unknown } };
export type PlatformResponse = { ok: true; id?: string; matchId?: string; code?: string; entity?: PlatformEntity; [key: string]: unknown };
