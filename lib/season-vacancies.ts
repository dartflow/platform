import {randomUUID} from 'node:crypto';
import {DomainError} from './domain';
import {createVacancyTie,divisionLevel} from './season-divisions';
import type {SeasonState,SeasonStanding,SeasonVacancy} from './seasons-types';

export const VACANCY_ORDER_POLICY='Eerst het oorspronkelijke niveau, daarna de gepubliceerde eindplaats (met afgewerkte plaatsingsbeslissers), punten, legsaldo en gewonnen legs. Volledige gelijkheid over parallelpoules vereist een gespeelde 501 best-of-five-beslissing. Alleen na uitputting volgt vooraf gepubliceerde kwalificatie.';
/** Freeze sporting priority while copying: identifiers only identify tied entrants. */
export function vacancySportingOrder(source:SeasonState,standings:SeasonStanding[],target:SeasonState):NonNullable<NonNullable<SeasonState['promotionSource']>['sportingOrder']>{
 const assigned=source.promotionPlan!.assignments;
 const rows=standings.filter(row=>assigned.some(a=>a.entryId===row.id)).map(row=>{
  const assignment=assigned.find(a=>a.entryId===row.id)!,from=source.divisions.find(d=>d.id===row.divisionId)!,to=source.divisions.find(d=>d.id===assignment.toDivisionId)!;
  const tie=source.promotionPlan!.ties.find(t=>t.phase==='complete'&&t.playerIds.includes(row.id));
  return {id:row.id,level:divisionLevel(source,to),key:[divisionLevel(source,from),row.position+(tie?tie.order.indexOf(row.id):0),-row.points,-(row.legsFor-row.legsAgainst),-row.legsFor]};
 });
 rows.sort((a,b)=>a.level-b.level||a.key.reduce((n,v,i)=>n||v-b.key[i],0));
 const groups:{level:number;playerIds:string[]}[]=[];let previous:typeof rows[number]|undefined;
 for(const row of rows){if(previous&&row.level===previous.level&&row.key.every((v,i)=>v===previous!.key[i]))groups.at(-1)!.playerIds.push(row.id);else groups.push({level:row.level,playerIds:[row.id]});previous=row;}
 return {publishedAt:target.createdAt,policy:VACANCY_ORDER_POLICY,groups};
}
export function assertVacancyEditable(s:SeasonState):void{
 if(s.format!=='singles'||!s.promotionSource?.sportingOrder||!s.promotionSource.divisionQuotas||s.publishedAt||!['draft','registration'].includes(s.status)||s.fixtures.some(f=>!f.classification))throw new DomainError('vacancy_locked','Vul vacatures in het nieuwe individuele concept vóór het reguliere programma; de gepubliceerde sportieve bron is verplicht.',409);
}
export function vacantPlaces(s:SeasonState,divisionId:string):number{return Math.max(0,(s.promotionSource?.divisionQuotas?.[divisionId]??0)-s.participants.filter(p=>p.divisionId===divisionId&&p.status==='active').length);}
export function planSeasonVacancy(s:SeasonState,divisionId:string,eligible:Set<string>,reason:string):SeasonVacancy{
 assertVacancyEditable(s);const division=s.divisions.find(d=>d.id===divisionId);if(!division)throw new DomainError('invalid_division','Deze divisie bestaat niet.');
 if(!vacantPlaces(s,divisionId))throw new DomainError('no_vacancy','Deze divisie heeft geen vrije gepubliceerde plaats.',409);
 if(s.vacancies?.some(v=>!['confirmed','canceled'].includes(v.status)))throw new DomainError('vacancy_pending','Rond eerst het open vacaturevoorstel af; zo blijft de volgorde eenduidig.',409);
 const level=divisionLevel(s,division),lower=[...new Set(s.divisions.map(d=>divisionLevel(s,d)))].filter(n=>n>level).sort((a,b)=>a-b)[0];
 const group=s.promotionSource!.sportingOrder!.groups.filter(g=>g.level===lower).map(g=>g.playerIds.filter(id=>eligible.has(id)&&s.participants.some(p=>p.id===id&&p.status==='active'&&divisionLevel(s,s.divisions.find(d=>d.id===p.divisionId)!)===lower))).find(ids=>ids.length);
 const vacancy:SeasonVacancy={id:randomUUID(),divisionId,sourceRevision:s.promotionSource!.revision,status:'qualification',candidateIds:group??[],reason,createdAt:new Date().toISOString()};
 if(group?.length===1){vacancy.status='ready';vacancy.candidateId=group[0];}else if(group&&group.length>1){vacancy.status='deciding';vacancy.tieId=createVacancyTie(s,divisionId,group).id;}
 (s.vacancies??=[]).push(vacancy);return vacancy;
}
export function confirmSeasonVacancy(s:SeasonState,v:SeasonVacancy,eligible:Set<string>,actor:string):void{
 assertVacancyEditable(s);if(v.status!=='ready'||!v.candidateId)throw new DomainError('vacancy_pending','De aangekondigde sportieve beslissing of kwalificatie is nog niet definitief.',409);
 if(!vacantPlaces(s,v.divisionId))throw new DomainError('no_vacancy','De gepubliceerde vrije plaats is al bezet.',409);
 const candidate=s.participants.find(p=>p.id===v.candidateId),target=s.divisions.find(d=>d.id===v.divisionId)!;
 if(!candidate||!eligible.has(candidate.id)||!['active','waiting'].includes(candidate.status)||candidate.status==='active'&&divisionLevel(s,s.divisions.find(d=>d.id===candidate.divisionId)!)<=divisionLevel(s,target))throw new DomainError('candidate_ineligible','De gerechtigde kandidaat is niet meer beschikbaar. Publiceer een nieuw voorstel.',409);
 if(candidate.status==='waiting'&&s.participants.filter(p=>p.status==='active').length>=s.settings.capacity)throw new DomainError('capacity_reached','Het seizoen heeft geen vrije deelnemersplaats.',409);
 v.fromDivisionId=candidate.divisionId;candidate.divisionId=v.divisionId;candidate.status='active';candidate.checkedIn=false;v.status='confirmed';v.confirmedAt=new Date().toISOString();v.confirmedBy=actor;
}
