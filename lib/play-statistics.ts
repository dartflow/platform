import{createHash}from'node:crypto';
import{database}from'./db';
import{DomainError}from'./domain';
import{assertAccountActive}from'./account-removal';
import{canonical,uuid}from'./platform-store';
import type{PlayMode,PlayState}from'./play-types';
import type{StoredPlaySession}from'./play-session-types';
export type PlayStatisticsSource='free'|'practice'|'challenge';
export type PlayStatisticsFilters={mode?:PlayMode;source?:PlayStatisticsSource;startScore?:301|501|701;inRule?:'single'|'double';outRule?:'straight'|'double'|'master'};
export type PlayStatisticsRuleProfile=Record<string,string|number|boolean|number[]>;
export type PlayStatisticsMetrics={visits:number;darts:number|null;countingDarts:number;points:number|null;average:number|null;successes:number|null;attempts:number|null;marksPerRound:number|null;doubleAttempts:number|null;doubleHits:number|null;doublePercentage:number|null};
export type PlayStatisticsRow=PlayStatisticsMetrics&{sessionId:string;mode:PlayMode;source:PlayStatisticsSource;completedAt:string;ruleVersion:number;rules:PlayStatisticsRuleProfile;ownParticipantId:string;groupId:string};
export type PlayStatisticsGroup=PlayStatisticsMetrics&{id:string;mode:PlayMode;source:PlayStatisticsSource;rules:PlayStatisticsRuleProfile;sessions:number};
export type PlayStatisticsResponse={filters:PlayStatisticsFilters;definitions:string[];rows:PlayStatisticsRow[];groups:PlayStatisticsGroup[]};
const modes:PlayMode[]=['x01','cricket','tactics','around','bingo','finish','leg-challenge'];
export function parsePlayStatisticsFilters(raw:unknown):PlayStatisticsFilters{
 const input=raw&&typeof raw==='object'?raw as Record<string,unknown>:{},out:PlayStatisticsFilters={};
 for(const[key,allowed]of Object.entries({mode:modes,source:['free','practice','challenge'],startScore:[301,501,701],inRule:['single','double'],outRule:['straight','double','master']})){
  const value=input[key];if(value===undefined||value===null||value==='')continue;const normalized=key==='startScore'?Number(value):value;
  if(!allowed.includes(normalized as never))throw new DomainError('invalid_statistics_filter','Kies een geldige spelvorm, bron of vastgelegd regelprofiel.');Object.assign(out,{[key]:normalized});
 }return out;
}
/** Comparable sporting rules only; no card, participant or historical-source identity. */
export function playStatisticsRuleProfile(game:Pick<PlayState,'rules'|'sides'|'ruleVersion'>):PlayStatisticsRuleProfile{
 const r=game.rules,base={version:game.ruleVersion,mode:r.mode,teamSizes:game.sides.map(s=>s.playerIds.length)};
 if(r.mode==='leg-challenge')return{...base,startScore:r.source.startScore,inRule:r.source.inRule,outRule:r.source.outRule,comparison:r.comparison};
 if(r.mode==='bingo')return{...base,win:r.win};
 // Every other rules union contains only the validated, frozen rule fields.
 return{...r,...base};
}
const sum=(values:number[])=>values.reduce((n,value)=>n+value,0);
const nullableSum=(values:(number|null)[])=>values.some(v=>v===null)?null:sum(values as number[]);
const round=(value:number)=>Math.round(value*10000)/10000;
/** Reconstruct marks from actual ordered dart hits, including already closed targets. */
function ownCreditedMarks(game:PlayState,participant:string):number|null{
 if(game.rules.mode!=='cricket'&&game.rules.mode!=='tactics')return null;
 const rules=game.rules,required=rules.mode==='cricket'?3:rules.requiredMarks,targets=Array.from({length:rules.mode==='cricket'?6:11},(_,i)=>20-i).concat(25);let total=0,key='',marks:number[][]=[];
 for(const visit of game.visits){
  const attempt=`${visit.set}:${visit.leg}:${visit.attempt}`;if(attempt!==key){key=attempt;marks=game.sides.map(()=>targets.map(()=>0));}
  if(!visit.dartHits)return null;const side=game.sides.findIndex(s=>s.id===visit.sideId);if(side<0)return null;
  for(const hit of visit.dartHits){const target=hit==='DB'||hit==='SB'?25:Number(hit.slice(1)),slot=targets.indexOf(target),amount=hit==='DB'?2:hit==='SB'?1:hit.startsWith('T')?3:hit.startsWith('D')?2:hit.startsWith('S')?1:0;if(slot<0||!amount)continue;
   const closing=Math.min(required-marks[side][slot],amount),extra=amount-closing;marks[side][slot]+=closing;
   if(visit.throwerId===participant)total+=closing+(rules.points&&marks.some((other,index)=>index!==side&&other[slot]<required)?extra:0);
  }
 }return total;
}
export function playScoreStatistics(game:PlayState,participant:string):PlayStatisticsMetrics{
 const own=game.visits.filter(v=>v.throwerId===participant),mode=game.mode,darts=nullableSum(own.map(v=>v.actualDarts)),countingDarts=sum(own.map(v=>v.countingDarts)),points=['x01','leg-challenge','cricket','tactics','finish'].includes(mode)?sum(own.map(v=>v.score)):null;
 let successes:number|null=null,attempts:number|null=null,marksPerRound:number|null=null;
 if(mode==='cricket'||mode==='tactics'){successes=ownCreditedMarks(game,participant);attempts=darts;marksPerRound=successes!==null&&darts?round(3*successes/darts):null;}
 if(mode==='around'||mode==='bingo'){successes=sum(own.map(v=>v.score));attempts=darts;}
 if(mode==='finish'&&game.progress.mode==='finish'){const numbers=new Set(own.map(v=>v.number)),completed=game.progress.completed.filter(a=>numbers.has(a.visitNumber));successes=completed.filter(a=>a.success).length;attempts=completed.length;}
 const doubleAttempts=nullableSum(own.map(v=>v.doubleAttempts));
 // A hit on another double is not proof that the intended double was hit.
 const aimKnown=own.every(v=>v.dartHits&&v.intendedTargets&&v.dartHits.length===v.intendedTargets.length&&v.intendedTargets.every(target=>target!==null)),doubleHits=doubleAttempts!==null&&aimKnown?sum(own.map(v=>v.dartHits!.filter((hit,index)=>{const target=v.intendedTargets![index];return Boolean(target&&(target==='DB'||target.startsWith('D'))&&hit===target);}).length)):null;
 return{visits:own.length,darts,countingDarts,points,average:['x01','leg-challenge'].includes(mode)&&points!==null&&countingDarts?round(3*points/countingDarts):null,successes,attempts,marksPerRound,doubleAttempts,doubleHits,doublePercentage:doubleAttempts&&doubleHits!==null?round(100*doubleHits/doubleAttempts):null};
}
export function groupPlayStatistics(rows:PlayStatisticsRow[]):PlayStatisticsGroup[]{
 const grouped=new Map<string,PlayStatisticsRow[]>();for(const row of rows)grouped.set(row.groupId,[...(grouped.get(row.groupId)??[]),row]);
 return[...grouped.entries()].map(([id,items])=>{const first=items[0],visits=sum(items.map(r=>r.visits)),darts=nullableSum(items.map(r=>r.darts)),countingDarts=sum(items.map(r=>r.countingDarts)),points=nullableSum(items.map(r=>r.points)),successes=nullableSum(items.map(r=>r.successes)),attempts=nullableSum(items.map(r=>r.attempts)),doubleAttempts=nullableSum(items.map(r=>r.doubleAttempts)),doubleHits=nullableSum(items.map(r=>r.doubleHits));
  return{id,mode:first.mode,source:first.source,rules:first.rules,sessions:items.length,visits,darts,countingDarts,points,average:['x01','leg-challenge'].includes(first.mode)&&points!==null&&countingDarts?round(3*points/countingDarts):null,successes,attempts,marksPerRound:['cricket','tactics'].includes(first.mode)&&successes!==null&&darts?round(3*successes/darts):null,doubleAttempts,doubleHits,doublePercentage:doubleAttempts&&doubleHits!==null?round(100*doubleHits/doubleAttempts):null};
 });
}
export const PLAY_STATISTICS_DEFINITIONS=[
 'Alleen afgeronde eigen of expliciet geclaimde deelnames tellen mee, eenmaal per oorspronkelijke sessie. Vrijspel, oefenen en uitdagingen blijven afzonderlijke bronnen; officiële 501-statistieken en ranking worden niet gewijzigd.',
 'Beurten, punten en successen horen uitsluitend bij de daadwerkelijk geregistreerde werper. Partner- en tegenstanderbeurten worden niet als eigen prestaties geboekt.',
 'Pijlen zijn uitsluitend werkelijk geregistreerde pijlen. Ontbreekt een werkelijk pijlaantal, dan blijft het totaal onbekend. Telpijlen zijn drie per niet-gefinishte beurt en het geregistreerde aantal bij een finish. Bij dubbel openen tellen openingsmissers mee als telpijlen, terwijl hun punten vóór de openingsdubbel nul blijven.',
 'Het X01-gemiddelde is drie maal de geldig geboekte punten gedeeld door telpijlen, inclusief getelde bustpijlen. Dit gemiddelde kan verschillen van een gemiddelde per werkelijk geworpen pijl, bijvoorbeeld bij een vroeg geëindigde bustbeurt.',
 'Bij Cricket en Tactics zijn successen geldige sluitings- en scorende treffers; treffers op een door alle zijden gesloten doel tellen niet. Treffergemiddelde is drie maal deze treffers gedeeld door werkelijk geregistreerde pijlen.',
 'Bij Around the Clock zijn successen geldige treffers op het actuele doel, bij Dubbelbingo nieuw gevulde eigen vakken. Pogingen zijn de werkelijk geregistreerde pijlen. Finishtraining telt voltooide pogingen en werkelijk geslaagde finishes.',
 'Dubbelpogingen tellen alleen met expliciet geregistreerde doelen of bevestigde pogingenaantallen. Dubbelhits tellen alleen wanneer de werkelijk geraakte dubbel overeenkomt met het expliciet beoogde doel. Zonder volledige doelregistratie blijven dubbelhits en dubbelpercentage onbekend; een beurttotaal bewijst geen gemiste dubbel.',
 'Vergelijkingen gebruiken uitsluitend dezelfde bron en hetzelfde vaste regelprofiel, inclusief teamgrootte en routehulp. Willekeurige bingokaarten en persoonlijke bronidentiteiten vormen geen afzonderlijke meetgroep.'
];
export async function getPlayStatistics(accountId:string,input:PlayStatisticsFilters={}):Promise<PlayStatisticsResponse>{
 const actor=uuid(accountId),filters=parsePlayStatisticsFilters(input);await assertAccountActive(actor);
 const records=(await database().query<{id:string;state:StoredPlaySession}>(`select s.id,s.state from dartflow_private.play_sessions s join dartflow_private.profiles p on p.id=$1 where p.deleted_at is null and p.deletion_requested_at is null and s.status='completed'and exists(select 1 from jsonb_array_elements(s.state->'participants')v where v->>'accountId'=$1::text or v->>'claimedBy'=$1::text)order by s.state->>'completedAt'desc,s.id`,[actor])).rows;
 const rows:PlayStatisticsRow[]=[];
 for(const {id,state}of records){const own=state.participants.find(p=>p.accountId===actor||p.claimedBy===actor);if(!own||!state.completedAt||state.game.status!=='finished')continue;const rules=playStatisticsRuleProfile(state.game),mode=state.game.mode,source=state.statisticsClass;
  if(filters.mode&&mode!==filters.mode||filters.source&&source!==filters.source||filters.startScore&&rules.startScore!==filters.startScore||filters.inRule&&rules.inRule!==filters.inRule||filters.outRule&&rules.outRule!==filters.outRule)continue;
  const groupId=createHash('sha256').update(canonical({source,rules})).digest('hex');rows.push({sessionId:id,mode,source,completedAt:state.completedAt,ruleVersion:state.game.ruleVersion,rules,ownParticipantId:own.id,groupId,...playScoreStatistics(state.game,own.id)});
 }
 return{filters,definitions:[...PLAY_STATISTICS_DEFINITIONS],rows,groups:groupPlayStatistics(rows)};
}
