import {prepareInitialStart,drawStart,assertStartReady,throwBull,confirmBull,bullPending,canThrowBull,canConfirmBull,canConfirmCompanionBull,synchronizeDecidingBull,lastLegStarter} from './bull-start';
import {calculatePlayerMeasures} from './player-statistics';
import {NATIONAL_RATING_POLICY} from './ranking-policy';
import {newCricket,scoreCricketGame} from './cricket';
import {dartValue} from './x01-rules';
import {evaluateX01Visit} from './x01-rules';
import {gameThrowerId,matchParticipants,matchSideIndex,isMultiPlayerMatch,matchMediaActors} from './match-sides';
import{seriesWinner}from'./match-winning-rules';
import type { Game, MatchAction, MatchState, MatchView, Settings } from './types';

export class DomainError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
const fail = (message: string, code = 'invalid_action', status = 400): never => { throw new DomainError(code, message, status); };
const clone = <T>(value: T): T => structuredClone(value);
const fields = Array.from({ length: 20 }, (_, index) => 20 - index);
const darts = [...fields.map(n => ({ score: n * 3, label: `T${n}` })), { score: 50, label: 'Bull' }, ...fields.map(n => ({ score: n * 2, label: `D${n}` })), { score: 25, label: '25' }, ...fields.map(n => ({ score: n, label: `${n}` })), { score: 0, label: 'Mis' }];
const doubles = [...fields.map(n => ({ score: n * 2, label: `D${n}` })), { score: 50, label: 'Bull' }];
const possible = [new Set([0])];
for (let count = 1; count <= 3; count++) possible.push(new Set([...possible[count - 1]].flatMap(a => darts.map(b => a + b.score))));
function finishRoute(score: number, count: number): string[] | null {
  if (score < 2 || score > 170 || count < 1 || count > 3) return null;
  if (count === 1) { const dart = doubles.find(d => d.score === score); return dart ? [dart.label] : null; }
  for (const dart of darts) { const route = finishRoute(score - dart.score, count - 1); if (route) return [dart.label, ...route]; }
  return null;
}
export function checkout(score: number): string | null {
  for (let count = 1; count <= 3; count++) { const route = finishRoute(score, count); if (route) return route.join(' · '); }
  return null;
}
export function validateSettings(input: Partial<Settings> = {}): Settings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Ongeldige partijinstellingen.');
  const value: Settings = { startScore: input.startScore ?? 501, bestOfLegs: input.bestOfLegs ?? 3, bestOfSets: input.bestOfSets ?? 1, ...(input.legLimit !== undefined ? { legLimit: input.legLimit } : {}) };
  if (![301, 501, 701].includes(value.startScore) || ![1, 3, 5, 7, 9, 11, 13, 15, 17, 19].includes(value.bestOfLegs) || ![1, 3, 5].includes(value.bestOfSets) || (value.legLimit !== undefined && (![6, 8, 10].includes(value.legLimit) || value.bestOfSets !== 1))) fail('Kies 301, 501 of 701 en een geldige best-of. Vaste zes, acht of tien legs ondersteunt één set.');
  if(input.inRule!==undefined){if(!['single','double'].includes(input.inRule))fail('Kies single of double in.');value.inRule=input.inRule;}
  if(input.outRule!==undefined){if(!['straight','double','master'].includes(input.outRule))fail('Kies straight, double of master out.');value.outRule=input.outRule;}
  if(input.sideStartScores!==undefined){if(!Array.isArray(input.sideStartScores)||input.sideStartScores.length!==2||input.sideStartScores.some(n=>!Number.isInteger(n)||n<(value.outRule==='straight'?1:2)||n>1001))fail('Kies per zijde een geldige handicap-startscore tot 1001.');value.sideStartScores=[...input.sideStartScores];}
  if(input.discipline!==undefined){if(!['x01','cricket'].includes(input.discipline))fail('Kies X01 of Cricket.');value.discipline=input.discipline;}
  if(input.cricketMode!==undefined){if(!['standard','no-score'].includes(input.cricketMode))fail('Kies standaard Cricket of no score.');value.cricketMode=input.cricketMode;}
  for(const [key,allowed] of [['startProcedure',['bull','server-lot','home-first']],['setOpener',['continuous','alternate-sets']],['decidingLeg',['continue','rebull']]] as const){const item=input[key];if(item!==undefined){if(!(allowed as readonly string[]).includes(item))fail('Kies een geldige start-, set- of beslissingsprocedure.');Object.assign(value,{[key]:item});}}
  if(value.legLimit&&value.decidingLeg==='rebull')fail('Vaste legs gebruiken geen beslissingsleg met rebull.');
  for(const [key,bestOf]of[['legWinByTwo',value.bestOfLegs],['setWinByTwo',value.bestOfSets]]as const){const rule=input[key];if(rule===undefined)continue;if(value.legLimit||bestOf<3||!rule||typeof rule!=='object'||Array.isArray(rule)||!Number.isInteger(rule.maximum)||rule.maximum<bestOf||rule.maximum>99||rule.maximum%2!==1)fail('Twee verschil vereist een best-of vanaf drie en een oneven absoluut maximum tot 99, minimaal het basis-best-of.');value[key]={maximum:rule.maximum};}
  if(value.discipline==='cricket'&&(value.sideStartScores||value.inRule==='double'||value.outRule&&value.outRule!=='double'))fail('Cricket heeft eigen marks en punten; X01-opening, uitgooien en handicap zijn hier niet van toepassing.');
  return value;
}
export function newGame(id: string, players: string[], settings: Settings, starter = 0,sidePlayers?:[string[],string[]],legOffset=0): Game {
  return { id, players,...(settings.legWinByTwo?{legWinByTwo:{maximum:settings.legWinByTwo.maximum}}:{}),...(settings.discipline==='cricket'?{discipline:'cricket',cricketMode:settings.cricketMode??'standard',cricket:newCricket()}:{}),...(sidePlayers?{sidePlayers:clone(sidePlayers),legOffset}:{}), startScore: settings.startScore, bestOf: settings.bestOfLegs, ...(settings.legLimit ? { legLimit: settings.legLimit } : {}), legs: [0, 0], remaining: settings.discipline==='cricket'?[0,0]:settings.sideStartScores?[...settings.sideStartScores]:[settings.startScore, settings.startScore],...(settings.inRule?{inRule:settings.inRule,opened:[settings.inRule!=='double',settings.inRule!=='double'] as [boolean,boolean]}:{}),...(settings.outRule?{outRule:settings.outRule}:{}),...(settings.sideStartScores?{sideStartScores:[...settings.sideStartScores] as [number,number]}:{}), turn: starter, legStarter: starter, status: 'live', visits: [], history: [], stats: [0, 1].map(() => ({ darts: 0, total: 0, oneEighties: 0, highestFinish: 0, legsWon: 0 })) };
}
export function scoreGame(source: Game, score: number, count = 3, doubleConfirmed = false,doubleAttempts?:number|null,dartHits?:string[],explicitBust=false): Game {
  if (source.status !== 'live') fail('Deze set is afgelopen.');
  if(source.discipline==='cricket'){try{if(!dartHits||dartHits.length!==count||dartHits.reduce((sum,hit)=>sum+dartValue(hit),0)!==score)fail('Registreer de werkelijke Cricket-pijlen.','dart_detail_required');return scoreCricketGame(source,dartHits!);}catch(error){if(error instanceof DomainError)throw error;fail(error instanceof Error?error.message:'Ongeldige Cricket-beurt.','invalid_darts');}}
  if (!Number.isInteger(count) || count < 1 || count > 3 || !Number.isInteger(score) || score < 0 || score > 180 || !possible[count]?.has(score)) fail('Deze score is niet mogelijk met het gekozen aantal darts.');
  const player = source.turn, before = source.remaining[player];
  let left=before-score,bust=left<0||left===1,legWon=left===0,detail:ReturnType<typeof evaluateX01Visit>|undefined;
  if(dartHits!==undefined){
    try{detail=evaluateX01Visit({remaining:before,opened:source.opened?.[player]??source.inRule!=='double',outRule:source.outRule,hits:dartHits});}catch(error){fail(error instanceof Error?error.message:'Ongeldige pijlregistratie.','invalid_darts');}
    if(detail!.observedScore!==score||count!==dartHits.length)fail('Het beurttotaal en aantal pijlen komen niet overeen met de ingevoerde pijlen.','invalid_darts');
    left=detail!.remaining;bust=detail!.endReason==='bust';legWon=detail!.endReason==='finish';score=detail!.points;
  }else{
    if(source.inRule==='double'||source.outRule&&source.outRule!=='double')fail('Gebruik pijl-voor-pijl invoer voor deze spelregels.','dart_detail_required');
    if(explicitBust){if(score!==0||doubleConfirmed)fail('Een expliciete bust boekt nul punten.');bust=true;legWon=false;left=before;}
    if(legWon&&!finishRoute(score,count))fail('Deze finish is niet mogelijk met dubbel uit.');
    if(legWon&&!doubleConfirmed)fail('Bevestig de beslissende dubbel.','needs_double',422);
    if(doubleConfirmed&&!legWon)fail('De finish is gewijzigd. Controleer de actuele stand.');
  }
  if(doubleAttempts!==undefined&&doubleAttempts!==null&&(!Number.isInteger(doubleAttempts)||doubleAttempts<0||doubleAttempts>(legWon?count:3)||(legWon&&(source.outRule??'double')==='double'&&doubleAttempts<1)))fail('Kies een geldig aantal pogingen op de uitgooidubbel.','double_attempts');
  const countedDarts=legWon?count:3;
  const next = clone(source);
  const { history, ...snapshot } = clone(source);
  void history;
  next.history.push(snapshot);
  if(detail)next.opened=[...(source.opened??[source.inRule!=='double',source.inRule!=='double'])] as [boolean,boolean];
  if(detail)next.opened![player]=detail.opened;
  next.stats[player].darts += countedDarts;
  next.stats[player].total += bust ? 0 : score;
  if (score === 180 && !bust) next.stats[player].oneEighties++;
  next.remaining[player] = bust ? before : left;
  next.visits.push({ player: source.players[player], playerIndex: player,...(source.sidePlayers?{throwerId:gameThrowerId(source)}:{}), score, darts: countedDarts, measurementVersion:1,...(detail?{dartHits:[...dartHits!],observedScore:detail.observedScore,openedBefore:source.opened?.[player]??source.inRule!=='double',openedAfter:detail.opened,endReason:detail.endReason}:{}),...(doubleAttempts===undefined?{}:{doubleAttempts}),remainingBefore: before, remainingAfter: next.remaining[player], bust, leg: source.legs[0] + source.legs[1] + 1, checkout: legWon });
  if (!legWon) { next.turn = 1 - player; return next; }
  next.legs[player]++;
  next.stats[player].legsWon = (next.stats[player].legsWon ?? 0) + 1;
  next.stats[player].highestFinish = Math.max(next.stats[player].highestFinish, score);
  if (next.legLimit ? next.legs[0] + next.legs[1] >= next.legLimit : seriesWinner(next.legs,next.bestOf,next.legWinByTwo)!==null) {
    next.status = 'finished';
    next.winner = next.legLimit && next.legs[0] === next.legs[1] ? null : next.players[next.legs[0] > next.legs[1] ? 0 : 1];
    next.draw = next.winner === null;
  } else { next.remaining = next.sideStartScores?[...next.sideStartScores]:[next.startScore, next.startScore]; if(next.inRule)next.opened=[next.inRule!=='double',next.inRule!=='double']; next.turn = (next.legStarter + next.legs[0] + next.legs[1]) % 2; }
  return next;
}
export function setScore(match: MatchState): number[] {
  return [0, 1].map(index => [...match.previousSets, match.game].filter(game => game.status === 'finished' && game.winner === match.players[index].id).length);
}
function undoMatchVisit(next: MatchState): void {
  if (!next.game.history.length && next.previousSets.length) next.game = next.previousSets.pop()!;
  if (!next.game.history.length) fail('Er is geen beurt om terug te draaien.');
  next.game = { ...clone(next.game.history.at(-1)!), history: clone(next.game.history.slice(0, -1)) };
  next.winnerId = null; next.resultRevision = null; next.status = 'live';
}
const matchVisits = (state:MatchState) => [...state.previousSets,state.game].flatMap(game=>game.visits);
const perPlayerScoring = (state:MatchState) => state.scoringMode==='per-player';
const currentScorer = (state:MatchState) => perPlayerScoring(state)?state.remoteWriterIds?.[state.game.turn]??gameThrowerId(state.game):state.writerId;
const canUndoOwnVisit = (state:MatchState,actorId:string) => !perPlayerScoring(state)||(state.remoteWriterIds?.includes(actorId)?state.remoteWriterIds[matchVisits(state).at(-1)?.playerIndex??-1]===actorId:(matchVisits(state).at(-1)?.throwerId??matchVisits(state).at(-1)?.player)===actorId);
export function applyMatchAction(source: MatchState, actorId: string, isOrganizer: boolean, action: MatchAction,server?:{drawStarter?:0|1}): MatchState {
  const next = clone(source), index = matchSideIndex(source,actorId);
  if(source.status==='abandoned')fail('Deze baansessie is verlopen of vrijgegeven. Start een nieuwe partij.','board_session_released',410);
  if(source.status==='interrupted'&&action.type!=='call')fail('Deze officiële wedstrijd is onderbroken. De wedstrijdleiding kan een beschikbare baan opnieuw toewijzen.','match_interrupted',409);
  const participant = () => { if (index < 0) fail('Alleen de toegewezen spelers kunnen dit doen.', 'forbidden', 403); };
  const writer = () => { if (index < 0 && source.delegatedWriterId !== actorId) participant(); };
  const manager = () => { if (!isOrganizer) fail('Alleen de wedstrijdleiding kan dit doen.', 'forbidden', 403); };
  switch (action.type) {
    case 'ranking-consent': {
      participant();
      if(isMultiPlayerMatch(source))fail('Een dubbel of teamgame heeft geen individuele landelijke rating.','ranking_ineligible',409);
      if(typeof action.consent!=='boolean')fail('Kies of deze partij voor je landelijke rating meetelt.');
      if(!['planned','called','ready'].includes(source.status)||source.previousSets.length||source.game.visits.length||source.ranking?.status==='reserved'||source.ranking?.status==='booked')fail('De rankingkeuze staat vast zodra de partij start.','ranking_locked',409);
      next.ranking??={policyVersion:NATIONAL_RATING_POLICY.version,consents:[false,false],status:'pending'};
      next.ranking.consents[index]=action.consent;
      break;
    }
    case 'call': manager(); if (!['planned','called','interrupted'].includes(source.status)) fail('Deze partij kan niet worden opgeroepen.'); next.boardId = action.boardId; next.status = 'called';next.callRef=action.callRef??`${source.id}:${source.revision+1}`;next.accepted=[false,false];next.paused=false;next.correction=null; break;
    case 'accept': participant(); if (source.status !== 'called' && source.status !== 'ready') fail('Deze partij wacht niet op akkoord.'); next.accepted[index] = true; if (next.accepted.every(Boolean)) {next.status = 'ready';prepareInitialStart(next);} break;
    case 'start': if (!isOrganizer) participant(); if (source.status !== 'ready' || !source.accepted.every(Boolean)) fail('Beide spelers moeten eerst akkoord geven.'); assertStartReady(source);next.status = 'live'; break;
    case 'draw-start':if(!isOrganizer)participant();drawStart(next,server?.drawStarter);break;
    case 'bull-throw':throwBull(next,actorId,action.hit);break;
    case 'bull-confirm':confirmBull(next,actorId);break;
    case 'bull-confirm-companion':confirmBull(next,actorId,true);break;
    case 'take-over': participant(); if(perPlayerScoring(source))fail('Iedere speler voert op de eigen beurt zijn eigen worp in.','per_player_scoring',409);if (source.status !== 'live') fail('Alleen tijdens een lopende partij.'); next.writerId = actorId; break;
    case 'pause': if(!isOrganizer)participant();if(source.status!=='live'||source.paused)fail('Deze partij kan nu niet gepauzeerd worden.');if(action.reason!==undefined&&(typeof action.reason!=='string'||action.reason.length>1000))fail('Geef een geldige pauzereden.');next.paused=true;next.pausedBy=actorId;break;
    case 'resume':if(!isOrganizer)participant();if(source.status!=='live'||!source.paused)fail('Deze partij is niet gepauzeerd.');next.paused=false;next.pausedBy=null;break;
    case 'request-correction':{
      participant();if(!['live','result'].includes(source.status)||source.resultPublished||source.confirmations.some(Boolean)||source.correction)fail('Deze partij kan nu geen correctieverzoek ontvangen.','correction_unavailable',409);
      if(typeof action.reason!=='string'||!action.reason.trim()||action.reason.length>1000)fail('Licht je correctieverzoek toe.');
      const visits=matchVisits(source),last=visits.findLastIndex(v=>(v.throwerId??v.player)===actorId);if(last<0)fail('Je hebt nog geen eigen beurt om te herstellen.');
      const undoCount=visits.length-last;if(undoCount>100)fail('Vraag de wedstrijdleiding om deze oudere correctie te behandelen.');
      next.scoringRevision=source.scoringRevision??source.revision;
      next.correction={id:`${source.id}:${source.revision+1}`,requestedBy:actorId,reason:action.reason.trim(),undoCount,visitCount:visits.length,scoringRevision:next.scoringRevision};break;
    }
    case 'approve-correction':case 'reject-correction':case 'cancel-correction':{
      const request=source.correction;if(!request||action.correctionId!==request.id)fail('Dit correctieverzoek is gewijzigd of afgehandeld.','correction_conflict',409);
      if(action.type==='cancel-correction'){if(actorId!==request!.requestedBy&&!isOrganizer)fail('Alleen de aanvrager kan dit verzoek intrekken.','forbidden',403);next.correction=null;break;}
      participant();if(matchSideIndex(source,actorId)===matchSideIndex(source,request!.requestedBy))fail('Alleen de tegenstander kan dit verzoek beoordelen.','forbidden',403);
      if(action.type==='approve-correction'){
        if(source.resultPublished||source.confirmations.some(Boolean)||!['live','result'].includes(source.status)||source.scoringRevision!==request!.scoringRevision||matchVisits(source).length!==request!.visitCount)fail('De stand is gewijzigd sinds het verzoek. Vernieuw de partij.','correction_conflict',409);
        for(let i=0;i<request!.undoCount;i++)undoMatchVisit(next);
        next.scoringRevision=source.revision+1;
      }
      next.correction=null;break;
    }
    case 'score': if(perPlayerScoring(source)){if(!source.remoteWriterIds?.includes(actorId))participant();}else writer();if(bullPending(source))fail('Rond eerst de bullprocedure af.','bull_pending',409);if(source.paused)fail('De partij is gepauzeerd.','match_paused',409);if(source.correction)fail('Handel eerst het correctieverzoek af.','correction_pending',409);if(source.status!=='live'||currentScorer(source)!==actorId)fail(perPlayerScoring(source)?'Je kunt alleen je eigen worp invoeren wanneer je aan de beurt bent.':'Alleen de huidige schrijver mag scoren.',perPlayerScoring(source)?'not_your_turn':'not_writer',403);
      next.scoringRevision=source.revision+1;
      next.game = scoreGame(source.game, action.score, action.darts ?? 3, action.doubleConfirmed === true,action.doubleAttempts,action.dartHits,action.bust===true);
      if (next.game.status === 'finished') {
        const winner = seriesWinner(setScore(next),source.settings.bestOfSets,source.settings.setWinByTwo);
        if (winner !== null || source.settings.legLimit) { next.status = 'result'; next.winnerId = winner !== null ? next.players[winner].id : next.game.winner ?? null; next.resultRevision = source.revision + 1; }
        else { next.previousSets.push(next.game); next.game = newGame(next.id, next.players.map(p => p.id), next.settings, next.settings.setOpener==='alternate-sets'?((next.startDecision?.starter??next.previousSets[0].legStarter)+next.previousSets.length)%2:(lastLegStarter(next.previousSets.at(-1)!)+1)%2,source.game.sidePlayers,next.previousSets.reduce((sum,game)=>sum+game.legs[0]+game.legs[1],0)); }
      }
      break;
    case 'undo': if(perPlayerScoring(source)){if(!source.remoteWriterIds?.includes(actorId))participant();}else writer();if ((!perPlayerScoring(source)&&source.writerId!==actorId)||!canUndoOwnVisit(source,actorId)||!['live','result'].includes(source.status)||source.confirmations.some(Boolean)||source.resultPublished) fail(perPlayerScoring(source)?'Je kunt alleen je eigen laatste onbevestigde worp terugdraaien.':'Alleen de schrijver kan een onbevestigde beurt terugdraaien.','forbidden',403);
      if(source.paused)fail('De partij is gepauzeerd.','match_paused',409);if(source.correction)fail('Handel eerst het correctieverzoek af.','correction_pending',409);
      undoMatchVisit(next);next.scoringRevision=source.revision+1;break;
    case 'confirm': participant();if(source.correction)fail('Handel eerst het correctieverzoek af.','correction_pending',409); if (source.status !== 'result' && source.status !== 'confirmed') fail('Er is geen uitslag om te bevestigen.'); next.confirmations[index] = true; if(source.scoringMode!=='per-player'&&source.localCompanion?.writerId===actorId&&source.writerId===actorId&&source.players[0]?.id===actorId&&source.localCompanion.playerId===source.players[1]?.id&&Boolean(source.localCompanion.lobbyId))next.confirmations=[true,true]; if (next.confirmations.every(Boolean)) { next.status = 'confirmed'; next.resultPublished = true; } break;
    case 'dispute': participant(); if (source.status !== 'result' || source.resultPublished) fail('Deze uitslag kan niet meer worden betwist.'); if (typeof action.reason !== 'string' || !action.reason.trim()) fail('Vul een reden in.'); next.dispute = action.reason.trim().slice(0, 1000); next.status = 'disputed'; break;
    case 'resolve': manager(); if (source.status !== 'disputed' || typeof action.reason !== 'string' || !action.reason.trim() || !['resume', 'accept'].includes(action.decision)) fail('Kies een beslissing en motiveer deze.'); next.dispute = null; next.confirmations = [false, false]; next.status = 'result';
      next.correction=null;next.paused=false;next.pausedBy=null;
      if (action.decision === 'resume') {next.scoringRevision=source.revision+1; if (!next.game.history.length) fail('Er is geen laatste beurt om te herstellen.'); next.game = { ...clone(next.game.history.at(-1)!), history: clone(next.game.history.slice(0, -1)) }; next.status = 'live'; next.winnerId = null; next.resultRevision = null; } break;
    case 'release': manager(); if (source.status !== 'confirmed') fail('Beide spelers moeten eerst de uitslag bevestigen.'); next.boardId = null;next.callRef=null; break;
    case 'recover': manager(); if (!source.resultPublished || !source.confirmations.every(Boolean)) fail('Alleen een bevestigde uitslag kan worden herverwerkt.'); break;
    default: fail('Onbekende partijactie.');
  }
  if(perPlayerScoring(next))next.writerId=currentScorer(next);
  if(['score','undo','approve-correction'].includes(action.type))synchronizeDecidingBull(next);
  next.revision++;
  return next;
}
export function matchView(match: MatchState, actorId: string, isOrganizer: boolean): MatchView {
  const { game, previousSets, ...base } = match;
  const currentLeg=game.legs[0]+game.legs[1]+(game.status==='finished'?0:1);
  const ownIndex = matchSideIndex(match,actorId), participant=ownIndex>=0;
  const writer = participant || match.delegatedWriterId === actorId,conflicted=match.offlineConflict?.status==='open';
  const canWrite=(perPlayerScoring(match)?participant||Boolean(match.remoteWriterIds?.includes(actorId)):writer)&&currentScorer(match)===actorId&&match.status==='live'&&!match.paused&&!match.correction&&!bullPending(match)&&!conflicted;
  return { ...base,...(game.cricket?{cricket:game.cricket}:{}),...(match.sideParticipants?{currentThrower:matchParticipants(match).find(player=>player.id===gameThrowerId(game))}:{}),scoringMode:perPlayerScoring(match)?'per-player':'shared-writer',writerId:currentScorer(match),remaining: game.remaining, legs: game.legs, sets: setScore(match), turn: game.turn, checkout: match.status === 'live'&&game.discipline!=='cricket'&&(game.outRule??'double')==='double' ? checkout(game.remaining[game.turn]) : null,
    visits: [...previousSets, game].flatMap(g => g.visits),currentLegVisits:game.visits.filter(v=>v.leg===currentLeg),currentLegStartScore:game.sideStartScores?.[game.turn]??game.startScore, stats: match.players.map((player,index)=>{if(game.cricket)return {total:game.cricket.points[index],darts:[...previousSets,game].flatMap(set=>set.visits).filter(visit=>visit.playerIndex===index).reduce((sum,visit)=>sum+visit.darts,0),oneEighties:0,highestFinish:0,measurementComplete:false};const stats=calculatePlayerMeasures([...previousSets,game],player.id);return{total:stats.points,darts:stats.darts,oneEighties:stats.oneEighties,highestFinish:stats.highestFinish,average:stats.average===null?0:stats.average,measurementComplete:stats.complete,hundredPlus:stats.hundredPlus,hundredFortyPlus:stats.hundredFortyPlus,firstNine:stats.firstNine,bestLegDarts:stats.bestLegDarts,checkoutPercentage:stats.checkoutPercentage};}),
    legNumber: game.legs[0] + game.legs[1] + (game.status === 'finished' ? 0 : 1), setNumber: previousSets.length + 1,
    permissions: {canDrawStart:!conflicted&&match.status==='ready'&&match.settings.startProcedure==='server-lot'&&match.startDecision?.starter===undefined&&(participant||isOrganizer),canBullThrow:!conflicted&&canThrowBull(match,actorId),canBullConfirm:!conflicted&&canConfirmBull(match,actorId),canBullConfirmCompanion:!conflicted&&canConfirmCompanionBull(match,actorId), canMedia:matchMediaActors(match).includes(actorId)&&['called','ready','live','result','disputed'].includes(match.status),canManage: isOrganizer,canWrite,canScore:canWrite, canAccept: !conflicted&&participant && ['called', 'ready'].includes(match.status) && !match.accepted[ownIndex], canConfirm: !conflicted&&participant && match.status === 'result' && !match.confirmations[ownIndex] && !match.correction, canTakeOver:!conflicted&&!perPlayerScoring(match)&&participant&&match.status==='live'&&match.writerId!==actorId,canUndo:!conflicted&&(perPlayerScoring(match)?(participant||Boolean(match.remoteWriterIds?.includes(actorId)))&&canUndoOwnVisit(match,actorId):writer&&match.writerId===actorId)&&['live','result'].includes(match.status)&&!match.resultPublished&&!match.confirmations.some(Boolean)&&!match.paused&&!match.correction&&game.history.length+previousSets.length>0,
      canPause:!conflicted&&(participant||isOrganizer)&&match.status==='live'&&!match.paused,canResume:!conflicted&&(participant||isOrganizer)&&match.status==='live'&&match.paused===true,
      canRequestCorrection:!conflicted&&participant&&['live','result'].includes(match.status)&&!match.resultPublished&&!match.confirmations.some(Boolean)&&!match.correction&&matchVisits(match).some(v=>(v.throwerId??v.player)===actorId),
      canAnswerCorrection:!conflicted&&participant&&Boolean(match.correction)&&matchSideIndex(match,match.correction!.requestedBy)!==ownIndex,canCancelCorrection:!conflicted&&Boolean(match.correction)&&(isOrganizer||match.correction?.requestedBy===actorId) }
  };
}
