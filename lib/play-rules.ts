import {dartValue,evaluateX01Visit} from './x01-rules';
import type {PlayRules,PlayState,PlaySnapshot,PlaySide,PlayProgress,PlayVisitInput,PlayVisit,PlayOutRule,PlayLegSource,PlayLegSourceVisit,PlaySourceEligibility,PlayFinishAdvice} from './play-types';
export type * from './play-types';

export class PlayRuleError extends Error {
 constructor(public code:string,message:string,public status=400){super(message);this.name='PlayRuleError';}
}
function fail(code:string,message:string):never{throw new PlayRuleError(code,message);}
const copy=<T>(value:T):T=>structuredClone(value);
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:fail('invalid_rules','Kies geldige spelregels.');
const integer=(value:unknown,fallback:number,min:number,max:number)=>{const n=value??fallback;return typeof n==='number'&&Number.isInteger(n)&&n>=min&&n<=max?n:fail('invalid_rules','Kies een geldig geheel getal voor deze spelregel.');};
const choice=<T extends string>(value:unknown,values:readonly T[],fallback:T):T=>value===undefined?fallback:typeof value==='string'&&values.includes(value as T)?value as T:fail('invalid_rules','Kies een ondersteunde spelregel.');
const bool=(value:unknown,fallback:boolean)=>value===undefined?fallback:typeof value==='boolean'?value:fail('invalid_rules','Kies aan of uit voor deze spelregel.');
const outRule=(value:unknown)=>choice(value,['straight','double','master'] as const,'double');
const series=(input:Record<string,unknown>)=>{const bestOfLegs=integer(input.bestOfLegs,1,1,19),bestOfSets=integer(input.bestOfSets,1,1,5);if(bestOfLegs%2===0||bestOfSets%2===0)fail('invalid_rules','Best-of legs en sets zijn oneven.');return {bestOfLegs,bestOfSets};};
const allHits=['MISS',...Array.from({length:20},(_,i)=>i+1).flatMap(n=>['S','D','T'].map(m=>m+n)),'SB','DB'];
const possible=[new Set([0])];
for(let n=1;n<=3;n++)possible.push(new Set([...possible[n-1]].flatMap(a=>allHits.map(hit=>a+dartValue(hit)))));
const numericTargets=Array.from({length:20},(_,i)=>i+1);
export const BINGO_LINES=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]] as const;

/** A public card code contains positions only, never session access or participants. */
export function createBingoCard(seed:string):{card:number[];cardCode:string}{
 if(typeof seed!=='string'||!seed.length||seed.length>1000)fail('invalid_card','Geef een geldige kaartbron op.');
 let value=2166136261;for(const char of seed)value=Math.imul(value^char.charCodeAt(0),16777619)>>>0;
 const random=()=>{value=(value+0x6D2B79F5)>>>0;let n=value;n=Math.imul(n^(n>>>15),n|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296;};
 const numbers=[...numericTargets];for(let i=numbers.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[numbers[i],numbers[j]]=[numbers[j],numbers[i]];}
 const card=numbers.slice(0,9);return {card,cardCode:'DFB1-'+card.map(n=>n.toString(36).toUpperCase().padStart(2,'0')).join('')};
}
export function bingoCardFromCode(code:string):number[]{
 if(typeof code!=='string'||!/^DFB1-[0-9A-Z]{18}$/.test(code))fail('invalid_card','Deze kaartcode is ongeldig.');
 const card=code.slice(5).match(/../g)!.map(n=>parseInt(n,36));
 if(new Set(card).size!==9||card.some(n=>n<1||n>20))fail('invalid_card','Een kaart bevat negen verschillende dubbels van D1 tot en met D20.');
 return card;
}
/** Route suggestions use the actual finish rule and available darts, never a presumed target. */
export function finishRoutes(remaining:number,dartsLeft=3,rule:PlayOutRule='double',limit=3):string[][]{
 if(!Number.isInteger(remaining)||remaining<1||remaining>180||!Number.isInteger(dartsLeft)||dartsLeft<1||dartsLeft>3||!['straight','double','master'].includes(rule))return [];
 const cap=Math.max(1,Math.min(16,Math.trunc(limit)||3)),routes:string[][]=[];
 const ordered=[...numericTargets].reverse().flatMap(n=>['T'+n,'D'+n,'S'+n]).concat(['DB','SB']);
 const find=(left:number,available:number,prefix:string[])=>{
  if(routes.length>=cap)return;
  for(const hit of ordered){
   if(routes.length>=cap)return;
   const result=evaluateX01Visit({remaining:left,outRule:rule,hits:[hit]});
   if(result.endReason==='finish'){routes.push([...prefix,hit]);continue;}
   if(result.endReason==='turn'&&available>1&&result.remaining<=60*(available-1))find(result.remaining,available-1,[...prefix,hit]);
  }
 };
 for(let n=1;n<=dartsLeft&&routes.length<cap;n++){
  const before=routes.length;find(remaining,n,[]);
  if(before!==routes.length){const unique=new Map(routes.map(r=>[r.join(','),r]));routes.splice(0,routes.length,...unique.values());}
 }
 return routes.slice(0,cap);
}
export function normalizePlayRules(raw:unknown):PlayRules{
 const input=object(raw);if(input.version!==undefined&&input.version!==1)fail('unsupported_rule_version','Werk de app bij voor deze versie van de spelregels.');
 const mode=choice(input.mode,['x01','cricket','tactics','around','bingo','finish','leg-challenge'] as const,'x01');
 if(mode==='x01'){
  const startScore=integer(input.startScore,501,301,701);if(![301,501,701].includes(startScore))fail('invalid_rules','Kies 301, 501 of 701.');
  return {version:1,mode,startScore:startScore as 301|501|701,inRule:choice(input.inRule,['single','double'] as const,startScore===301?'double':'single'),outRule:outRule(input.outRule),...series(input)};
 }
 if(mode==='cricket')return {version:1,mode,points:bool(input.points,true),...series(input)};
 if(mode==='tactics'){
  const preset=choice(input.preset,['tactics-5','tactics-3'] as const,'tactics-5'),points=bool(input.points,true);
  return {version:1,mode,preset,requiredMarks:preset==='tactics-5'?5:3,points,tieRule:preset==='tactics-5'&&points?'replay':'first-closed',...series(input)};
 }
 if(mode==='around')return {version:1,mode,segment:choice(input.segment,['any','single','double','triple'] as const,'any'),bull:choice(input.bull,['off','any','outer','inner'] as const,'any'),order:choice(input.order,['ascending','descending'] as const,'ascending'),hitsPerTarget:integer(input.hitsPerTarget,1,1,10)};
 if(mode==='bingo'){const win=choice(input.win,['line','full-card'] as const,'line');if(input.cardCode!==undefined)bingoCardFromCode(String(input.cardCode));return {version:1,mode,win,...(input.cardCode!==undefined?{cardCode:String(input.cardCode)}:{})};}
 if(mode==='finish'){
  const rule=outRule(input.outRule),target=integer(input.target,68,rule==='straight'?1:2,180);
  if(!finishRoutes(target,3,rule,1).length)fail('invalid_finish','Deze reststand is niet in drie pijlen te finishen onder de gekozen uitregel.');
  return {version:1,mode,target,attemptCount:integer(input.attemptCount,5,1,50),outRule:rule,routeHelp:bool(input.routeHelp,true)};
 }
 const supplied=object(input.source),eligibility=legSourceEligibility(supplied);
 const source:PlayLegSource={matchId:String(supplied.matchId??''),version:String(supplied.version??''),playerId:String(supplied.playerId??''),startScore:supplied.startScore as PlayLegSource['startScore'],inRule:supplied.inRule as PlayLegSource['inRule'],outRule:supplied.outRule as PlayOutRule,valid:supplied.valid===true,visits:Array.isArray(supplied.visits)?supplied.visits.map(raw=>{const row=object(raw);return {score:row.score as number,remainingBefore:row.remainingBefore as number,remainingAfter:row.remainingAfter as number,bust:row.bust as boolean,checkout:row.checkout as boolean,...(Array.isArray(row.dartHits)?{dartHits:[...row.dartHits] as string[]}:{}),...(row.actualDarts!==undefined?{actualDarts:row.actualDarts as number|null}:{})};}):[]};
 if(!eligibility.eligible)fail('ineligible_leg',eligibility.reason??'Deze bronleg is niet geschikt.');
 const comparison=choice(input.comparison,['darts','visits'] as const,eligibility.comparison!);
 if(comparison==='darts'&&eligibility.comparison!=='darts')fail('unreliable_dart_count','De bronleg heeft onvoldoende betrouwbare pijlaantallen. Vergelijk op beurten.');
 source.visitCount=source.visits.length;source.totalDarts=eligibility.reliableDarts;
 return {version:1,mode,source,comparison};
}
function initialProgress(rules:PlayRules,count:number):PlayProgress{
 if(rules.mode==='x01')return {mode:'x01',remaining:Array(count).fill(rules.startScore),opened:Array(count).fill(rules.inRule!=='double')};
 if(rules.mode==='cricket'||rules.mode==='tactics'){
  const targets=Array.from({length:rules.mode==='cricket'?6:11},(_,i)=>20-i).concat(25);
  return {mode:rules.mode,targets,requiredMarks:rules.mode==='cricket'?3:rules.requiredMarks,marks:Array.from({length:count},()=>targets.map(()=>0)),points:Array(count).fill(0),creditedMarks:Array(count).fill(0)};
 }
 if(rules.mode==='around'){const targets=rules.order==='ascending'?[...numericTargets]:[...numericTargets].reverse();if(rules.bull!=='off')targets.push(25);return {mode:'around',targets,targetIndex:Array(count).fill(0),targetHits:Array(count).fill(0),successes:Array(count).fill(0),darts:Array(count).fill(0)};}
 if(rules.mode==='bingo')return {mode:'bingo',card:bingoCardFromCode(rules.cardCode!),cardCode:rules.cardCode!,filled:Array.from({length:count},()=>Array(9).fill(false)),darts:Array(count).fill(0),winningPattern:null};
 if(rules.mode==='finish')return {mode:'finish',remaining:rules.target,dartsLeft:3,attemptNumber:1,completed:[]};
 return {mode:'leg-challenge',remaining:rules.source.startScore,opened:rules.source.inRule!=='double',revealedSourceVisits:0,sourceVisitCount:rules.source.visits.length,sourceRemaining:rules.source.startScore,comparison:rules.comparison,sourceDarts:legSourceEligibility(rules.source).reliableDarts,ownDarts:0,ownVisits:0,sourceChanged:false,sourceInvalidated:false};
}
function validateSides(sides:PlaySide[],rules:PlayRules){
 if(!Array.isArray(sides)||!sides.length||sides.length>4)fail('invalid_sides','Kies één tot vier deelnemers of twee teams.');
 if(sides.length>2&&rules.mode!=='bingo')fail('invalid_sides','Deze spelvorm ondersteunt solo of twee zijden.');
 if(['finish','leg-challenge'].includes(rules.mode)&&sides.length!==1)fail('invalid_sides','Deze oefening heeft één speler.');
 if(sides.some(s=>!s||typeof s.id!=='string'||!s.id||!Array.isArray(s.playerIds)||!s.playerIds.length||s.playerIds.length>8||s.playerIds.some(p=>typeof p!=='string'||!p)))fail('invalid_sides','Leg de deelnemers en spelersvolgorde vast.');
 if(new Set(sides.map(s=>s.id)).size!==sides.length||new Set(sides.flatMap(s=>s.playerIds)).size!==sides.flatMap(s=>s.playerIds).length)fail('duplicate_player','Een deelnemer kan eenmaal in dezelfde partij spelen.');
 if(sides.some(s=>s.playerIds.length>1)&&(rules.mode!=='bingo'||sides.length!==2))fail('invalid_teams','Dubbelbingo met teams gebruikt twee teams.');
}
export function newPlayState(id:string,sides:PlaySide[],input:PlayRules,starter=0):PlayState{
 if(typeof id!=='string'||!id||id.length>200)fail('invalid_session','Een partij heeft een geldige identiteit nodig.');
 let rules=normalizePlayRules(input);validateSides(sides,rules);
 if(!Number.isInteger(starter)||starter<0||starter>=sides.length)fail('invalid_starter','Kies een deelnemer als starter.');
 if(rules.mode==='bingo'&&!rules.cardCode)rules={...rules,cardCode:createBingoCard(id).cardCode};
 return {id,mode:rules.mode,ruleVersion:1,rules,sides:copy(sides),turn:starter,currentThrowerId:sides[starter].playerIds[0],status:'live',starter,set:1,leg:1,attempt:1,legs:sides.map(()=>0),sets:sides.map(()=>0),progress:initialProgress(rules,sides.length),visits:[],attempts:[],result:null,undo:[]};
}
function snapshot(state:PlayState):PlaySnapshot{const {undo,...frame}=copy(state);void undo;return frame;}
function advanceTurn(state:PlayState){
 state.turn=(state.turn+1)%state.sides.length;
 const ownVisits=state.visits.filter(v=>v.sideId===state.sides[state.turn].id).length;
 state.currentThrowerId=state.sides[state.turn].playerIds[ownVisits%state.sides[state.turn].playerIds.length];
}
function finish(state:PlayState,side:number,reason:string){state.status='finished';state.result={kind:state.sides.length===1?'completed':'win',winnerSideId:state.sides[side].id,reason};}
function winLeg(state:PlayState,side:number){
 state.attempts.push({number:state.attempt,set:state.set,leg:state.leg,starter:state.starter,status:'won',winnerSideId:state.sides[side].id,fromVisit:state.visits.findIndex(v=>v.leg===state.leg&&v.set===state.set&&v.attempt===state.attempt)+1,toVisit:state.visits.length});
 const rules=state.rules;
 if(!('bestOfLegs'in rules)){finish(state,side,'De gekozen reeks is voltooid.');return;}
 state.legs[side]++;
 if(state.legs[side]>=Math.floor(rules.bestOfLegs/2)+1){
  state.sets[side]++;
  if(state.sets[side]>=Math.floor(rules.bestOfSets/2)+1){finish(state,side,'De partij is gewonnen.');return;}
  state.legs=state.sides.map(()=>0);state.set++;
 }
 state.leg++;state.attempt++;state.starter=(state.starter+1)%state.sides.length;state.turn=state.starter;
 state.progress=initialProgress(rules,state.sides.length);state.currentThrowerId=state.sides[state.turn].playerIds[0];
}
function hits(input:PlayVisitInput){
 if(!Array.isArray(input.dartHits)||input.dartHits.length<1||input.dartHits.length>3)fail('dart_detail_required','Registreer één tot drie werkelijk geworpen pijlen.');
 input.dartHits.forEach(hit=>{try{dartValue(hit);}catch{fail('invalid_dart','Kies een geldige single, dubbel, triple, bull of mis.');}});
 if(input.darts!==undefined&&input.darts!==input.dartHits.length)fail('invalid_darts','Het aantal pijlen wijkt af van de pijlregistratie.');
 if(input.intendedTargets!==undefined){if(!Array.isArray(input.intendedTargets)||input.intendedTargets.length!==input.dartHits.length)fail('invalid_target','Leg per pijl het beoogde doel of onbekend vast.');for(const target of input.intendedTargets)if(target!==null&&!allHits.includes(target))fail('invalid_target','Kies een geldig beoogd doel.');}
 return input.dartHits;
}
/** Accepted journal input is a whitelist; client metadata never becomes public score state. */
function canonicalVisitInput(raw:PlayVisitInput):PlayVisitInput{
 const value=object(raw),input:PlayVisitInput={};
 for(const key of ['score','darts','doubleAttempts'] as const)if(value[key]!==undefined){const n=value[key];if(key==='doubleAttempts'&&n===null){input[key]=null;continue;}if(typeof n!=='number'||!Number.isInteger(n)||n<0||n>(key==='score'?180:3)||key==='darts'&&n<1)fail(key==='doubleAttempts'?'invalid_attempts':key==='darts'?'invalid_darts':'invalid_total','Registreer een geldig werkelijk totaal of pijlaantal.');input[key]=n;}
 for(const key of ['doubleConfirmed','bust'] as const)if(value[key]!==undefined){if(typeof value[key]!=='boolean')fail('invalid_visit','Bevestig de werkelijke finish of bust.');input[key]=value[key];}
 if(value.dartHits!==undefined)input.dartHits=value.dartHits as string[];
 if(value.intendedTargets!==undefined)input.intendedTargets=value.intendedTargets as (string|null)[];
 if(input.dartHits!==undefined){const darts=hits(input),observed=darts.reduce((sum,hit)=>sum+dartValue(hit),0);if(input.score!==undefined&&input.score!==observed)fail('invalid_total','Het totaal wijkt af van de ingevoerde pijlen.');input.dartHits=[...darts];if(input.intendedTargets)input.intendedTargets=[...input.intendedTargets];}
 else if(input.intendedTargets!==undefined)fail('invalid_target','Een beoogd doel hoort bij een werkelijk geregistreerde pijl.');
 return input;
}
function observedAttempts(input:PlayVisitInput):number|null{
 if(input.intendedTargets){const observed=input.intendedTargets.some(t=>t===null)?null:input.intendedTargets.filter(t=>t==='DB'||t?.startsWith('D')).length;if(input.doubleAttempts!==undefined&&input.doubleAttempts!==null&&input.doubleAttempts!==observed)fail('invalid_attempts','De dubbelpogingen wijken af van de geregistreerde doelen.');return observed;}
 if(input.doubleAttempts!==undefined&&input.doubleAttempts!==null){if(!Number.isInteger(input.doubleAttempts)||input.doubleAttempts<0||input.doubleAttempts>(input.dartHits?.length??input.darts??3))fail('invalid_attempts','Kies het werkelijk geregistreerde aantal dubbelpogingen.');return input.doubleAttempts;}
 return null;
}
function visit(state:PlayState,input:PlayVisitInput):PlayVisit{return {number:state.visits.length+1,sideId:state.sides[state.turn].id,throwerId:state.currentThrowerId,set:state.set,leg:state.leg,attempt:state.attempt,...(input.dartHits?{dartHits:[...input.dartHits]}:{}),...(input.intendedTargets?{intendedTargets:[...input.intendedTargets]}:{}),score:0,observedScore:input.dartHits?input.dartHits.reduce((sum,hit)=>sum+dartValue(hit),0):null,countingDarts:input.dartHits?.length??3,actualDarts:input.dartHits?.length??input.darts??null,bust:false,finish:false,doubleAttempts:observedAttempts(input),input:copy(input)};}
function x01Visit(remaining:number,opened:boolean,rule:PlayOutRule,input:PlayVisitInput){
 if(input.dartHits){hits(input);const evaluated=evaluateX01Visit({remaining,opened,outRule:rule,hits:input.dartHits});if(input.score!==undefined&&input.score!==evaluated.observedScore)fail('invalid_total','Het totaal wijkt af van de ingevoerde pijlen.');if(input.bust!==undefined&&input.bust!==(evaluated.endReason==='bust'))fail('invalid_visit','De bustbevestiging wijkt af van de werkelijke pijlen.');return {...evaluated,actualDarts:input.dartHits.length};}
 if(!opened)fail('dart_detail_required','Registreer de openingsfase per pijl.');
 const score=input.score,count=input.darts??3;
 if(typeof score!=='number'||!Number.isInteger(score)||score<0||score>180||!Number.isInteger(count)||count<1||count>3||!possible[count].has(score))fail('invalid_total','Deze score is niet mogelijk met het gekozen aantal pijlen.');
 const left=remaining-score,bust=input.bust===true||left<0||(rule!=='straight'&&left===1),checkout=left===0&&!bust;
 if(input.bust&&score!==0)fail('invalid_total','Een expliciete bust boekt nul punten.');
 if(checkout){if(input.darts===undefined)fail('checkout_darts_required','Bevestig het aantal gebruikte pijlen bij de checkout.');if(!finishRoutes(remaining,count,rule,1).length)fail('invalid_checkout','Deze finish is niet mogelijk met de beschikbare pijlen.');if(rule!=='straight'&&!input.doubleConfirmed)fail('checkout_confirmation_required','Bevestig de geldige einddubbel of eindtriple.');}
 if(input.doubleConfirmed&&!checkout)fail('invalid_checkout','Deze beurt finisht de actuele reststand niet.');
 return {remaining:bust?remaining:left,opened,endReason:bust?'bust' as const:checkout?'finish' as const:'turn' as const,observedScore:score,points:bust?0:score,countedDarts:checkout?count:3,actualDarts:input.darts??null};
}
export function scorePlayVisit(source:PlayState,raw:PlayVisitInput):PlayState{
 const input=canonicalVisitInput(raw);
 if(source.ruleVersion!==1||source.rules.version!==1)fail('unsupported_rule_version','Werk de app bij voor deze versie van de spelregels.');
 if(source.status!=='live')fail('not_live',source.status==='replay-required'?'Deze onbesliste poging moet eerst worden overgespeeld.':'Deze partij is afgelopen.');
 const next=copy(source);next.undo.push(snapshot(source));if(next.undo.length>300)next.undo.shift();
 const rules=next.rules,p=next.progress,side=next.turn;
 if(rules.mode==='x01'&&p.mode==='x01'){
  const before=p.remaining[side],opened=p.opened[side],result=x01Visit(before,opened,rules.outRule,input),row=visit(next,input);
  Object.assign(row,{score:result.points,observedScore:result.observedScore,countingDarts:result.countedDarts,actualDarts:result.actualDarts,bust:result.endReason==='bust',finish:result.endReason==='finish',remainingBefore:before,remainingAfter:result.remaining,openedBefore:opened,openedAfter:result.opened});
  p.remaining[side]=result.remaining;p.opened[side]=result.opened;next.visits.push(row);if(row.finish)winLeg(next,side);else advanceTurn(next);return next;
 }
 if((rules.mode==='cricket'||rules.mode==='tactics')&&(p.mode==='cricket'||p.mode==='tactics')){
  const darts=hits(input),row=visit(next,input),required=p.requiredMarks;let won=false,replay=false;
  for(const [index,hit]of darts.entries()){
   const target=hit==='SB'||hit==='DB'?25:Number(hit.slice(1)),slot=p.targets.indexOf(target),marks=hit==='DB'?2:hit==='SB'?1:hit.startsWith('T')?3:hit.startsWith('D')?2:hit.startsWith('S')?1:0;
   if(slot>=0&&marks){const closing=Math.min(required-p.marks[side][slot],marks),extra=marks-closing;p.marks[side][slot]+=closing;p.creditedMarks[side]+=closing;if(rules.points&&p.marks.some((values,other)=>other!==side&&values[slot]<required)){p.points[side]+=extra*target;p.creditedMarks[side]+=extra;}}
   const closed=p.marks[side].every(n=>n===required),otherPoints=p.points.filter((_,i)=>i!==side);
   won=closed&&(!rules.points||otherPoints.every(points=>rules.mode==='tactics'&&rules.preset==='tactics-5'?p.points[side]>points:p.points[side]>=points));
   replay=rules.mode==='tactics'&&rules.tieRule==='replay'&&p.marks.every(values=>values.every(n=>n===required))&&p.points.every(points=>points===p.points[0]);
   if((won||replay)&&index!==darts.length-1)fail('darts_after_finish','Er kan geen pijl volgen na de beslissende pijl.');
  }
  row.score=p.points[side]-(source.progress.mode==='cricket'||source.progress.mode==='tactics'?source.progress.points[side]:0);row.finish=won;next.visits.push(row);
  if(replay){next.status='replay-required';return next;}if(won)winLeg(next,side);else advanceTurn(next);return next;
 }
 if(rules.mode==='around'&&p.mode==='around'){
  const darts=hits(input),row=visit(next,input);let won=false;
  for(const [index,hit]of darts.entries()){
   const target=p.targets[p.targetIndex[side]],value=hit==='SB'||hit==='DB'?25:Number(hit.slice(1));
   const valid=target===25?(rules.bull==='any'&&(hit==='SB'||hit==='DB')||rules.bull==='outer'&&hit==='SB'||rules.bull==='inner'&&hit==='DB'):value===target&&(rules.segment==='any'&&/^[SDT]/.test(hit)||rules.segment==='single'&&hit.startsWith('S')||rules.segment==='double'&&hit.startsWith('D')||rules.segment==='triple'&&hit.startsWith('T'));
   p.darts[side]++;if(valid){p.successes[side]++;p.targetHits[side]++;if(p.targetHits[side]===rules.hitsPerTarget){p.targetHits[side]=0;p.targetIndex[side]++;}}
   won=p.targetIndex[side]===p.targets.length;if(won&&index!==darts.length-1)fail('darts_after_finish','De gekozen reeks is na deze pijl voltooid.');
  }
  row.score=p.successes[side]-(source.progress.mode==='around'?source.progress.successes[side]:0);row.finish=won;next.visits.push(row);if(won)finish(next,side,'De gekozen reeks is voltooid.');else advanceTurn(next);return next;
 }
 if(rules.mode==='bingo'&&p.mode==='bingo'){
  const darts=hits(input),row=visit(next,input);let pattern:readonly number[]|undefined;
  for(const [index,hit]of darts.entries()){
   p.darts[side]++;if(/^D([1-9]|1[0-9]|20)$/.test(hit)){const slot=p.card.indexOf(Number(hit.slice(1)));if(slot>=0)p.filled[side][slot]=true;}
   pattern=rules.win==='full-card'?(p.filled[side].every(Boolean)?numericTargets.slice(0,9).map(n=>n-1):undefined):BINGO_LINES.find(line=>line.every(slot=>p.filled[side][slot]));
   if(pattern&&index!==darts.length-1)fail('darts_after_finish','De kaart is na deze pijl gewonnen.');
  }
  row.score=p.filled[side].filter(Boolean).length-(source.progress.mode==='bingo'?source.progress.filled[side].filter(Boolean).length:0);row.finish=Boolean(pattern);next.visits.push(row);
  if(pattern){p.winningPattern=[...pattern];finish(next,side,'De gekozen bingoregel is voltooid.');}else advanceTurn(next);return next;
 }
 if(rules.mode==='finish'&&p.mode==='finish'){
  const darts=hits(input);if(darts.length>p.dartsLeft)fail('darts_exhausted','Deze poging heeft onvoldoende resterende pijlen.');
  const before=p.remaining,result=evaluateX01Visit({remaining:before,outRule:rules.outRule,hits:darts}),row=visit(next,input);p.remaining=result.endReason==='bust'?rules.target:result.remaining;p.dartsLeft-=darts.length;
  Object.assign(row,{score:result.points,remainingBefore:before,remainingAfter:p.remaining,bust:result.endReason==='bust',finish:result.endReason==='finish'});next.visits.push(row);
  if(result.endReason!=='turn'||p.dartsLeft===0){
   const own=next.visits.filter(v=>v.attempt===next.attempt),attempts=own.every(v=>v.doubleAttempts!==null)?own.reduce((sum,v)=>sum+v.doubleAttempts!,0):null;
   p.completed.push({number:p.attemptNumber,success:row.finish,bust:row.bust,remaining:p.remaining,darts:3-p.dartsLeft,doubleAttempts:attempts,visitNumber:row.number});
   if(p.completed.length===rules.attemptCount){next.status='finished';next.result={kind:'completed',winnerSideId:next.sides[0].id,reason:'Alle finishpogingen zijn geregistreerd.'};}
   else{p.attemptNumber++;next.attempt++;p.remaining=rules.target;p.dartsLeft=3;}
  }
  return next;
 }
 if(rules.mode==='leg-challenge'&&p.mode==='leg-challenge'){
  if(rules.comparison==='darts'){const darts=hits(input);if(darts.length>p.sourceDarts!-p.ownDarts)fail('darts_exhausted','Er zijn niet zoveel vergelijkbare pijlen meer over.');}
  const before=p.remaining,opened=p.opened,result=x01Visit(before,opened,rules.source.outRule,input),row=visit(next,input);
  p.remaining=result.remaining;p.opened=result.opened;p.ownVisits++;p.ownDarts+=result.actualDarts??0;p.revealedSourceVisits=Math.min(p.ownVisits,p.sourceVisitCount,rules.source.visits.length);p.sourceRemaining=rules.source.visits[p.revealedSourceVisits-1]?.remainingAfter??p.sourceRemaining;
  Object.assign(row,{score:result.points,observedScore:result.observedScore,countingDarts:result.countedDarts,actualDarts:result.actualDarts,bust:result.endReason==='bust',finish:result.endReason==='finish',remainingBefore:before,remainingAfter:result.remaining,openedBefore:opened,openedAfter:result.opened});next.visits.push(row);
  const own=rules.comparison==='darts'?p.ownDarts:p.ownVisits,reference=rules.comparison==='darts'?p.sourceDarts!:p.sourceVisitCount;
  if(row.finish||own>=reference){next.status='finished';const kind=row.finish?(own<reference?'win':own===reference?'draw':'loss'):'loss';next.result={kind,winnerSideId:kind==='win'?next.sides[0].id:null,reason:rules.comparison==='darts'?'Vergelijking op werkelijk geregistreerde pijlen.':'Vergelijking op beurten; dezelfde finishbeurt is gelijkspel.'};}
  return next;
 }
 return fail('invalid_state','De vastgelegde spelregels en stand horen niet bij elkaar.');
}
export function undoPlayVisit(source:PlayState):PlayState{
 if(!source.undo.length)fail('no_undo','Er is geen geaccepteerde invoer om terug te draaien.');
 return {...copy(source.undo.at(-1)!),undo:copy(source.undo.slice(0,-1))};
}
export function restartPlayAttempt(source:PlayState,starter=(source.starter+1)%source.sides.length):PlayState{
 if(source.mode!=='tactics'||source.status!=='replay-required')fail('replay_unavailable','Alleen een volledig gesloten gelijke Tactics 5 wordt overgespeeld.');
 if(!Number.isInteger(starter)||starter<0||starter>=source.sides.length)fail('invalid_starter','Kies de starter volgens de vastgelegde startprocedure.');
 const next=copy(source);next.undo.push(snapshot(source));if(next.undo.length>300)next.undo.shift();
 next.attempts.push({number:next.attempt,set:next.set,leg:next.leg,starter:next.starter,status:'replayed',winnerSideId:null,fromVisit:next.visits.findIndex(v=>v.attempt===next.attempt)+1,toVisit:next.visits.length});
 next.attempt++;next.starter=starter;next.turn=starter;next.currentThrowerId=next.sides[starter].playerIds[0];next.progress=initialProgress(next.rules,next.sides.length);next.status='live';return next;
}
/** Invalid old sources get a reason, never invented checkout darts or opening misses. */
export function legSourceEligibility(raw:unknown):PlaySourceEligibility{
 const bad=(reason:string):PlaySourceEligibility=>({eligible:false,reason,comparison:null,reliableDarts:null});
 try{
  const source=object(raw)as unknown as PlayLegSource;
  if(source.valid!==true)return bad('Deze bronleg is ongeldig verklaard.');
  if([source.matchId,source.version,source.playerId].some(value=>typeof value!=='string'||!value||value.length>200)||![301,501,701].includes(source.startScore)||!['single','double'].includes(source.inRule)||!['straight','double','master'].includes(source.outRule))return bad('De partij-identiteit, bronversie of relevante spelregels ontbreken.');
  if(!Array.isArray(source.visits)||!source.visits.length||source.visits.length>1000)return bad('Deze bronleg heeft geen geaccepteerde beurtvolgorde.');
  let remaining:number=source.startScore,opened=source.inRule!=='double',reliable=true,darts=0;
  for(const [index,row]of source.visits.entries()){
   if(row.remainingBefore!==remaining||!Number.isInteger(row.score)||row.score<0||row.score>180||typeof row.bust!=='boolean'||typeof row.checkout!=='boolean')return bad('De geaccepteerde reststanden sluiten niet op elkaar aan.');
   if(row.dartHits){
    const result=evaluateX01Visit({remaining,opened,outRule:source.outRule,hits:row.dartHits});
    if(result.remaining!==row.remainingAfter||result.endReason==='bust'!==row.bust||result.endReason==='finish'!==row.checkout||result.points!==row.score)return bad('De bronpijlen en uitslag spreken elkaar tegen.');
    opened=result.opened;
   }else{
    if(!opened)return bad('De openingspijlen of openingsstatus van deze dubbel-in-leg ontbreken.');
    if(row.bust&&row.score!==0)return bad('Een bust in de bronleg boekt nul punten.');
    const available=row.actualDarts??3;if(!Number.isInteger(available)||available<1||available>3||!possible[available].has(row.score))return bad('Een beurttotaal is niet mogelijk met de geregistreerde pijlen.');
    if(row.bust?row.remainingAfter!==remaining:row.remainingAfter!==remaining-row.score||row.remainingAfter<0||(source.outRule!=='straight'&&row.remainingAfter===1))return bad('De bronleg bevat een ongeldige reststand.');
    if(row.checkout&&(row.remainingAfter!==0||!finishRoutes(remaining,available,source.outRule,1).length))return bad('De bronleg heeft geen geldige checkout.');
   }
   if(row.checkout!==(!row.bust&&row.remainingAfter===0)||row.checkout&&index!==source.visits.length-1)return bad('De bronleg eindigt niet op precies één geldige checkout.');
   const actual=row.dartHits?.length??row.actualDarts;
   if(row.dartHits&&row.actualDarts!==undefined&&row.actualDarts!==null&&row.actualDarts!==row.dartHits.length)return bad('De bron bevat tegenstrijdige pijlaantallen.');
   if(!Number.isInteger(actual)||Number(actual)<1||Number(actual)>3)reliable=false;else darts+=Number(actual);
   remaining=row.remainingAfter;
  }
  if(remaining!==0||!source.visits.at(-1)!.checkout)return bad('Deze bronleg is niet voltooid.');
  return {eligible:true,reason:null,comparison:reliable?'darts':'visits',reliableDarts:reliable?darts:null};
 }catch{return bad('De oude registratie bevat onvoldoende betrouwbare regel- of pijlgegevens.');}
}
export function markLegSourceStatus(source:PlayState,current:{version:string;valid:boolean}):PlayState{
 if(source.rules.mode!=='leg-challenge'||source.progress.mode!=='leg-challenge')fail('invalid_mode','Deze partij is geen leguitdaging.');
 const version=source.rules.source.version,next=copy(source),progress=next.progress as Extract<PlayProgress,{mode:'leg-challenge'}>;progress.sourceChanged=current.version!==version;progress.sourceInvalidated=!current.valid;return next;
}
export type FinishAdviceSource={id:string;completedAt:string;accepted:boolean;outRule:PlayOutRule;visits:PlayLegSourceVisit[]};
/** Accuracy is unknown if even one intended target is missing; totals do not reveal intent. */
export function playDoubleAccuracy(state:Pick<PlayState,'visits'>):{attempts:number|null;hits:number|null;percentage:number|null}{
 let attempts=0,hitCount=0;
 for(const row of state.visits){if(!row.dartHits||!row.intendedTargets||row.intendedTargets.length!==row.dartHits.length||row.intendedTargets.some(target=>target===null))return {attempts:null,hits:null,percentage:null};for(const [index,target]of row.intendedTargets.entries())if(target==='DB'||target?.startsWith('D')){attempts++;if(row.dartHits[index]===target)hitCount++;}}
 return {attempts,hits:hitCount,percentage:attempts?100*hitCount/attempts:null};
}
/** At most one repeated, actually observed finish. No intended-double inference from totals. */
export function finishAdvice(records:FinishAdviceSource[],now=Date.now(),windowDays=7):PlayFinishAdvice|null{
 if(!Number.isFinite(now)||!Number.isInteger(windowDays)||windowDays<1||windowDays>90)fail('invalid_window','Kies een geldige adviesperiode.');
 const groups=new Map<string,{target:number;outRule:PlayOutRule;frequency:number;last:number}>(),seen=new Set<string>();let sourceVisitCount=0;
 for(const record of records){const at=Date.parse(record.completedAt);if(!record.accepted||!record.id||seen.has(record.id)||!Number.isFinite(at)||at>now||at<now-windowDays*86400000||!['straight','double','master'].includes(record.outRule))continue;seen.add(record.id);
  for(const row of record.visits){const n=row.remainingBefore;if(!Number.isInteger(n)||!finishRoutes(n,3,record.outRule,1).length||!Number.isInteger(row.score)||!possible[3].has(row.score)||row.remainingAfter<0||record.outRule!=='straight'&&row.remainingAfter===1||row.bust&&row.remainingAfter!==n||!row.bust&&row.remainingAfter!==n-row.score||row.checkout!==(!row.bust&&row.remainingAfter===0)||row.checkout&&!finishRoutes(n,row.actualDarts??3,record.outRule,1).length)continue;sourceVisitCount++;const key=record.outRule+':'+n,group=groups.get(key)??{target:n,outRule:record.outRule,frequency:0,last:0};group.frequency++;group.last=Math.max(group.last,at);groups.set(key,group);}
 }
 const selected=[...groups.values()].filter(g=>g.frequency>=2).sort((a,b)=>b.frequency-a.frequency||b.last-a.last||a.target-b.target||a.outRule.localeCompare(b.outRule))[0];
 return selected?{target:selected.target,frequency:selected.frequency,windowDays,outRule:selected.outRule,sourceVisitCount,explanation:`${selected.frequency} geaccepteerde beurten begonnen de afgelopen ${windowDays} dagen op ${selected.target} onder ${selected.outRule} uit.`}:null;
}
