import type {Game,MatchState,MatchView,Profile,Settings,Visit} from './types';

/** Two side anchors remain stable; real participants and visit attribution are separate. */
export const matchParticipants=(state:Pick<MatchState,'players'|'sideParticipants'>):Profile[]=>state.sideParticipants?state.sideParticipants.flat():state.players;
export const matchSideIndex=(state:Pick<MatchState,'players'|'sideParticipants'>,actorId:string):number=>state.sideParticipants?state.sideParticipants.findIndex(side=>side.some(player=>player.id===actorId)):state.players.findIndex(player=>player.id===actorId);
export const isMultiPlayerMatch=(state:Pick<MatchState,'sideParticipants'>):boolean=>Boolean(state.sideParticipants?.some(side=>side.length>1));
/** A remote game has two designated camera/writer endpoints, even with larger sides. */
export const matchMediaActors=(state:Pick<MatchState,'players'|'remoteWriterIds'>):string[]=>state.remoteWriterIds??state.players.map(player=>player.id);
export function gameThrowerId(game:Game):string{
 const side=game.turn,roster=game.sidePlayers?.[side];
 if(!roster?.length)return game.players[side];
 const completedLegs=game.legs[0]+game.legs[1],leg=completedLegs+1;
 const turns=game.visits.filter(visit=>visit.leg===leg&&visit.playerIndex===side).length;
 return roster[((game.legOffset??0)+completedLegs+turns)%roster.length];
}
export function attachMatchSides(state:MatchState,sides:[Profile[],Profile[]],names?:[string,string]):void{
 if(!['planned','called'].includes(state.status)||state.game.visits.length||state.previousSets.length)throw new Error('De werpvolgorde staat vast zodra de partij start.');
 if(sides.length!==2||sides.some((side,index)=>side.length<1||side.length>4||side[0].id!==state.players[index].id)||new Set(sides.flat().map(player=>player.id)).size!==sides.flat().length)throw new Error('Kies twee verschillende zijden met één tot vier unieke spelers en dezelfde eerste speler.');
 state.sideParticipants=structuredClone(sides);state.sideNames=names?.map(name=>name.trim().slice(0,120)) as [string,string]|undefined;
 state.game.sidePlayers=sides.map(side=>side.map(player=>player.id)) as [string[],string[]];
}

/** Public displays retain partner/thrower names without exposing account IDs. */
export function publicMatchSides(view:Pick<MatchView,'sideParticipants'|'sideNames'|'currentThrower'>):Pick<MatchView,'sideParticipants'|'sideNames'|'currentThrower'>{
 if(!view.sideParticipants)return {};
 const sides=view.sideParticipants.map((side,index)=>side.map((player,member)=>({id:`player-${index+1}-member-${member+1}`,name:player.name}))) as [Profile[],Profile[]];
 const side=view.sideParticipants.findIndex(roster=>roster.some(player=>player.id===view.currentThrower?.id)),member=side<0?-1:view.sideParticipants[side].findIndex(player=>player.id===view.currentThrower?.id);
 return {sideParticipants:sides,...(view.sideNames?{sideNames:[...view.sideNames] as [string,string]}:{}),...(side>=0&&member>=0?{currentThrower:sides[side][member]}:{})};
}
export function publicMatchVisit(view:Pick<MatchView,'sideParticipants'>,visit:Visit):Visit{
 const {throwerId}=visit,side=visit.playerIndex,member=view.sideParticipants?.[side]?.findIndex(player=>player.id===throwerId)??-1;
 const base:Visit={player:'',playerIndex:side,score:visit.score,darts:visit.darts,remainingBefore:visit.remainingBefore,remainingAfter:visit.remainingAfter,bust:visit.bust,leg:visit.leg,checkout:visit.checkout,...(visit.cricket?{cricket:{marksBefore:[...visit.cricket.marksBefore],marksAfter:[...visit.cricket.marksAfter],pointsBefore:visit.cricket.pointsBefore,pointsAfter:visit.cricket.pointsAfter,creditedMarks:visit.cricket.creditedMarks}}:{})};
 return {...base,player:`player-${side+1}`,...(member>=0?{throwerId:`player-${side+1}-member-${member+1}`}:{})};
}
export function publicMatchSettings(settings:Settings):Settings{return {startScore:settings.startScore,bestOfLegs:settings.bestOfLegs,bestOfSets:settings.bestOfSets,...(settings.legLimit===undefined?{}:{legLimit:settings.legLimit}),...(settings.discipline?{discipline:settings.discipline}:{}),...(settings.cricketMode?{cricketMode:settings.cricketMode}:{}),...(settings.inRule?{inRule:settings.inRule}:{}),...(settings.outRule?{outRule:settings.outRule}:{}),...(settings.sideStartScores?{sideStartScores:[...settings.sideStartScores] as [number,number]}:{})};}
