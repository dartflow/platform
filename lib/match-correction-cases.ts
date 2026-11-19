import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {DomainError} from './domain';
import {text} from './platform-store';
import type {MatchState} from './types';
import type {CorrectionCategory,CorrectionMoment,CorrectionPolicy} from './match-corrections-types';
export type CaseEntry={id:string;request_id:string;actor_id:string;actor_name:string;kind:'opened'|'response'|'appeal'|'closed'|'access'|'purged';data:Record<string,unknown>;retain_until:Date;created_at:Date};
type Client=Pick<PoolClient,'query'>;
export const DEFAULT_CORRECTION_POLICY:CorrectionPolicy={requestHours:24,appealHours:48,responseHours:24,evidenceDays:30};
export function validateCorrectionPolicy(value:unknown):CorrectionPolicy{
 const v=value&&typeof value==='object'?value as Record<string,unknown>:{};const result={...DEFAULT_CORRECTION_POLICY};for(const key of Object.keys(result)as(keyof CorrectionPolicy)[]){const n=v[key]??result[key],max=key==='evidenceDays'?365:168;if(!Number.isInteger(n)||Number(n)<1||Number(n)>max)throw new DomainError('invalid_correction_policy','Controleer de gepubliceerde bezwaar-, reactie-, beroep- en bewaartermijnen.');result[key]=Number(n);}return result;
}
export function correctionMoments(state:MatchState):CorrectionMoment[]{let visitIndex=0;return [...state.previousSets,state.game].flatMap((game,index)=>game.visits.map(visit=>({visitIndex:visitIndex++,setNumber:index+1,leg:visit.leg,playerName:state.players[visit.playerIndex]?.name??'Speler',score:visit.score,darts:visit.darts,bust:visit.bust,checkout:visit.checkout})));}
export async function caseEntries(client:Client,ids:string[]):Promise<CaseEntry[]>{if(!ids.length)return[];return(await client.query<CaseEntry>(`select c.*,coalesce(nullif(p.display_name,''),p.name)actor_name from dartflow_private.match_correction_case_entries c join dartflow_private.profiles p on p.id=c.actor_id where c.request_id=any($1::uuid[])order by c.created_at,c.id`,[ids])).rows;}
export async function caseNow(client:Client):Promise<Date>{return(await client.query<{at:Date}>('select clock_timestamp()at')).rows[0].at;}
export async function appendCaseEntry(client:Client,requestId:string,actor:string,kind:CaseEntry['kind'],data:Record<string,unknown>,retainUntil:Date):Promise<void>{await client.query('insert into dartflow_private.match_correction_case_entries(id,request_id,actor_id,kind,data,retain_until)values($1,$2,$3,$4,$5,$6)',[randomUUID(),requestId,actor,kind,JSON.stringify(data),retainUntil]);}
export function evidence(value:unknown):string|undefined{if(value===undefined||value===null||value==='')return undefined;return text(value,4000);}
export function category(value:unknown):CorrectionCategory{const c=value??'score';if(!['score','eligibility','conduct','camera','other'].includes(String(c)))throw new DomainError('invalid_correction_category','Kies een geldige bezwaarcategorie.');return c as CorrectionCategory;}
export function casePolicy(entries:CaseEntry[]):CorrectionPolicy{return validateCorrectionPolicy(entries.find(e=>e.kind==='opened')?.data.policy);}
export function caseRetention(entries:CaseEntry[],createdAt:Date):Date{return entries.find(e=>e.kind==='opened')?.retain_until??new Date(createdAt.getTime()+DEFAULT_CORRECTION_POLICY.evidenceDays*86400000);}
export function caseResponseDue(entries:CaseEntry[],createdAt:Date):Date{return new Date(createdAt.getTime()+casePolicy(entries).responseHours*3600000);}
export function hasOpponentResponse(entries:CaseEntry[],requestedBy:string,participants:string[]):boolean{return entries.some(e=>e.kind==='response'&&e.actor_id!==requestedBy&&participants.includes(e.actor_id));}
