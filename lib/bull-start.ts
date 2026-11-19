import {DomainError} from './domain';
import {matchSideIndex} from './match-sides';
import type {BullState,Game,MatchState,StartDecision} from './types';
export const bullPending=(state:Pick<MatchState,'bull'>)=>Boolean(state.bull&&state.bull.status!=='complete');
export function bullTurn(bull:BullState):0|1{return bull.order[bull.throws.filter(t=>t.round===bull.round).length]??bull.order[0];}
export function canThrowBull(state:MatchState,actor:string):boolean{
 if(!state.bull||state.bull.status!=='throwing'||!['ready','live'].includes(state.status)||state.paused)return false;
 const side=bullTurn(state.bull);return matchSideIndex(state,actor)===side||(state.scoringMode==='per-player'?state.remoteWriterIds?.[side]===actor:state.writerId===actor||state.delegatedWriterId===actor);
}
export function canConfirmCompanionBull(state:MatchState,actor:string):boolean{return !!state.bull&&state.bull.status==='confirming'&&!state.bull.confirmed[1]&&!state.paused&&state.scoringMode!=='per-player'&&state.localCompanion?.writerId===actor&&state.writerId===actor&&state.players[0]?.id===actor&&state.localCompanion?.playerId===state.players[1]?.id&&Boolean(state.localCompanion?.lobbyId);}
export function canConfirmBull(state:MatchState,actor:string):boolean{const side=matchSideIndex(state,actor);return !!state.bull&&state.bull.status==='confirming'&&side>=0&&!state.bull.confirmed[side]&&!state.paused;}
function makeBull(state:MatchState,reason:BullState['reason']):BullState{return {reason,setNumber:state.previousSets.length+1,legNumber:state.game.legs[0]+state.game.legs[1]+1,status:'throwing',round:1,order:[0,1],throws:[],confirmed:[false,false]};}
function setInitial(state:MatchState,decision:StartDecision){state.startDecision=decision;if(decision.starter!==undefined){state.game.turn=decision.starter;state.game.legStarter=decision.starter;}}
export function prepareInitialStart(state:MatchState):void{
 const procedure=state.settings.startProcedure;if(!procedure||state.startDecision||state.previousSets.length||state.game.visits.length||!state.accepted.every(Boolean))return;
 setInitial(state,{procedure,ruleVersion:1,...(procedure==='home-first'?{starter:0 as const}:{})});if(procedure==='bull')state.bull=makeBull(state,'match');
}
export function drawStart(state:MatchState,starter:0|1|undefined):void{
 if(state.status!=='ready'||state.settings.startProcedure!=='server-lot'||state.startDecision?.starter!==undefined||starter!==0&&starter!==1)throw new DomainError('start_draw_unavailable','De serverloting kan eenmaal na beide akkoorden plaatsvinden.',409);
 setInitial(state,{procedure:'server-lot',ruleVersion:1,starter});
}
export function assertStartReady(state:MatchState):void{if(state.settings.startProcedure&&(state.startDecision?.starter===undefined||bullPending(state)))throw new DomainError('start_procedure_pending','Rond eerst de gepubliceerde startprocedure en beide bullbevestigingen af.',409);}
export function throwBull(state:MatchState,actor:string,hit:unknown):void{
 if(!canThrowBull(state,actor))throw new DomainError('bull_not_your_turn','Alleen de actuele bullwerper of toegewezen schrijver kan deze bullpijl vastleggen.',403);
 if(!['DB','SB','outside'].includes(String(hit)))throw new DomainError('invalid_bull','Kies dubbele bull, enkele bull of buiten de bull.');
 const bull=state.bull!;if(bull.throws.length>=2000)throw new DomainError('bull_limit','Vraag de wedstrijdleiding om deze uitzonderlijke bullreeks te behandelen.',409);
 bull.throws.push({round:bull.round,side:bullTurn(bull),hit:hit as 'DB'|'SB'|'outside'});const pair=bull.throws.filter(t=>t.round===bull.round);if(pair.length!==2)return;
 const value={DB:2,SB:1,outside:0};if(value[pair[0].hit]===value[pair[1].hit]){bull.round++;bull.order=[bull.order[1],bull.order[0]];}else{bull.winner=value[pair[0].hit]>value[pair[1].hit]?pair[0].side:pair[1].side;bull.status='confirming';}
}
export function confirmBull(state:MatchState,actor:string,companion=false):void{
 if(!(companion?canConfirmCompanionBull(state,actor):canConfirmBull(state,actor)))throw new DomainError('bull_confirmation_unavailable','Beide zijden bevestigen ieder hun eigen bulluitslag.',403);
 const bull=state.bull!;bull.confirmed[companion?1:matchSideIndex(state,actor)]=true;if(!bull.confirmed.every(Boolean))return;bull.status='complete';const starter=bull.winner!;
 if(bull.reason==='match')setInitial(state,{procedure:'bull',ruleVersion:1,starter});else{state.game.legStartOverrides??={};state.game.legStartOverrides[String(bull.legNumber)]=starter;state.game.turn=starter;}
}
export function lastLegStarter(game:Game):number{const leg=game.legs[0]+game.legs[1]+(game.status==='finished'?0:1);return game.legStartOverrides?.[String(leg)]??(game.legStarter+leg-1)%2;}
export function synchronizeDecidingBull(state:MatchState):void{
 const game=state.game,leg=game.legs[0]+game.legs[1]+1,set=state.previousSets.length+1;
 if(state.bull?.reason==='deciding-leg'&&(state.bull.setNumber!==set||state.bull.legNumber!==leg||game.status!=='live')){state.bullHistory??=[];state.bullHistory.push(state.bull);delete state.bull;}
 if(state.status!=='live'||state.settings.decidingLeg!=='rebull'||game.legLimit||game.bestOf<=1||game.status!=='live'||game.legs.some(n=>n!==Math.ceil((game.legWinByTwo?.maximum??game.bestOf)/2)-1)||game.visits.some(v=>v.leg===leg))return;
 if(state.bull?.reason==='deciding-leg')return;
 const prior=state.bullHistory?.findLast(b=>b.reason==='deciding-leg'&&b.setNumber===set&&b.legNumber===leg&&b.status==='complete');
 if(state.bull){state.bullHistory??=[];state.bullHistory.push(state.bull);}state.bull=prior?structuredClone(prior):makeBull(state,'deciding-leg');
 if(prior?.winner!==undefined){game.legStartOverrides??={};game.legStartOverrides[String(leg)]=prior.winner;game.turn=prior.winner;}
}
/** No actor identity, private evidence or invented match visits in the public display. */
export function publicBullStart(state:Pick<MatchState,'bull'|'startDecision'>):Pick<MatchState,'bull'|'startDecision'>{
 const d=state.startDecision,b=state.bull;return {...(d?{startDecision:{procedure:d.procedure,ruleVersion:1 as const,...(d.starter===0||d.starter===1?{starter:d.starter}:{})}}:{}),...(b?{bull:{reason:b.reason,setNumber:b.setNumber,legNumber:b.legNumber,status:b.status,round:b.round,order:[b.order[0],b.order[1]] as [0|1,0|1],throws:b.throws.map(t=>({round:t.round,side:t.side,hit:t.hit})),...(b.winner===0||b.winner===1?{winner:b.winner}:{}),confirmed:[b.confirmed[0]===true,b.confirmed[1]===true] as [boolean,boolean]}}:{})};
}
