import type {Settings} from './types';

export type CompetitionLobbyPlayer={id:string;name:string;username?:string|null;confirmed:boolean;method?:'account'|'pin'};
export type CompetitionBoardCandidate={seasonId:string;seasonName:string;revision:number;fixtureId:string;slotId:string;slotIndex:number;round:number;opponent:{id:string;name:string;username?:string|null};startsAt:string|null;windowStart:string;windowEnd:string;boardName:string;settings:Settings;canOpen:boolean;blockedReason?:string;matchId?:string;resumeUrl?:string};
export type CompetitionBoardLobby={id:string;revision:number;seasonId:string;seasonName:string;fixtureId:string;slotId:string;matchId:string;boardId:string;boardName:string;round:number;settings:Settings;expiresAt:string;status:'waiting'|'ready'|'started'|'expired'|'canceled';players:[CompetitionLobbyPlayer,CompetitionLobbyPlayer];writerId:string;writerName:string;writerDeviceLabel:string;canConfirm:boolean;canStart:boolean;canCancel:boolean;matchUrl:string};
export type CompetitionBoardContext={boardId:string;candidates:CompetitionBoardCandidate[];lobby?:CompetitionBoardLobby};
export type CompetitionLobbyDisplay={competitionName:string;round:number;players:[{name:string;confirmed:boolean},{name:string;confirmed:boolean}];writerName:string;expiresAt:string};
