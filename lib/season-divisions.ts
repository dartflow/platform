import {randomUUID} from 'node:crypto';
import {DomainError} from './domain';
import {knockout,roundRobin,advanceFixtures} from './platform-domain';
import {drawTournamentPlayers} from './tournament-formats';
import {seasonWindow} from './seasons-formats';
import type {SeasonState,SeasonStanding,PromotionPlan,PromotionTie,SeasonFixture,SeasonDivision} from './seasons-types';

export const divisionLevel=(s:SeasonState,d:SeasonDivision)=>d.level??s.divisions.indexOf(d)+1;
export function divisionMetadata(value:unknown,index:number):Pick<SeasonDivision,'level'|'targetSize'|'promotionPlaces'|'relegationPlaces'>{
 const v=value&&typeof value==='object'?value as Record<string,unknown>:{};const read=(key:string,fallback:number,min:number,max:number)=>{const n=v[key]===undefined?fallback:Number(v[key]);if(!Number.isInteger(n)||n<min||n>max)throw new DomainError('invalid_divisions',`Controleer divisieveld ${key}.`);return n;};
 return {level:read('level',index+1,1,12),targetSize:read('targetSize',10,8,12),...(v.promotionPlaces===undefined?{}:{promotionPlaces:read('promotionPlaces',1,0,12)}),...(v.relegationPlaces===undefined?{}:{relegationPlaces:read('relegationPlaces',1,0,12)})};
}
/** A frozen generation supplies exact ratings. UUID never decides a rating tie. */
export function seedSeasonDivisions(s:SeasonState,ratings:{playerId:string;rating:number;established:boolean}[],source:{rankingListId:string;generation:string|null},seed:string=randomUUID()):void{
 if(s.format!=='singles'||s.fixtures.length||s.publishedAt)throw new DomainError('seed_locked','Deel individuele divisies in vóór programma en publicatie.',409);
 const entrants=s.participants.filter(p=>p.status==='active');if(entrants.length<8)throw new DomainError('division_too_small','Een divisie vereist minimaal acht deelnemers.',409);const draw=drawTournamentPlayers(entrants.map(p=>p.id),seed),tie=(id:string)=>draw.indexOf(id);
 const levels=[...new Set(s.divisions.map(d=>divisionLevel(s,d)))].sort((a,b)=>a-b),lowest=levels.at(-1)!;
 if(entrants.some(p=>!ratings.some(r=>r.playerId===p.id&&r.established)&&(!p.placementChoice||p.placementChoice==='qualification'&&!p.qualification)))throw new DomainError('placement_choice_required','Nieuwe spelers kiezen instapklasse of een definitieve kwalificatie.',409);
 const allocations=new Map(s.divisions.map(d=>[d.id,[] as string[]])),capacity=(level:number)=>s.divisions.filter(d=>divisionLevel(s,d)===level).reduce((n,d)=>n+(d.targetSize??10),0),assigned=new Map<number,string[]>();
 for(const level of levels)assigned.set(level,[]);
 // Qualified new entrants occupy their published level before established seeding.
 for(const p of entrants.filter(p=>!ratings.some(r=>r.playerId===p.id&&r.established)&&p.placementChoice==='qualification').sort((a,b)=>tie(a.id)-tie(b.id))){const level=p.qualification!.level;if(!assigned.has(level))throw new DomainError('invalid_division','Het kwalificatieniveau bestaat niet.');assigned.get(level)!.push(p.id);}
 const established=entrants.filter(p=>ratings.some(r=>r.playerId===p.id&&r.established)).sort((a,b)=>ratings.find(r=>r.playerId===b.id)!.rating-ratings.find(r=>r.playerId===a.id)!.rating||tie(a.id)-tie(b.id));
 for(const p of established){const level=levels.find(level=>assigned.get(level)!.length<capacity(level));if(level===undefined)p.status='waiting';else assigned.get(level)!.push(p.id);}
 for(const p of entrants.filter(p=>!ratings.some(r=>r.playerId===p.id&&r.established)&&p.placementChoice==='entry').sort((a,b)=>tie(a.id)-tie(b.id))){if(assigned.get(lowest)!.length>=capacity(lowest))p.status='waiting';else assigned.get(lowest)!.push(p.id);}
 for(const level of levels){const groups=s.divisions.filter(d=>divisionLevel(s,d)===level),ids=assigned.get(level)!;
  if(ids.length>capacity(level))throw new DomainError('division_capacity','De kwalificatie overschrijdt de gepubliceerde capaciteit.',409);
  for(const [index,id]of ids.entries()){const block=Math.floor(index/groups.length),offset=index%groups.length;let group=groups[block%2===0?offset:groups.length-1-offset];if(allocations.get(group.id)!.length>=(group.targetSize??10))group=groups.find(d=>allocations.get(d.id)!.length<(d.targetSize??10))!;allocations.get(group.id)!.push(id);s.participants.find(p=>p.id===id)!.divisionId=group.id;}
 }
 for(const ids of allocations.values())if(ids.length>0&&ids.length<8)throw new DomainError('division_too_small','Voeg aangrenzende niveaus samen of gebruik de wachtlijst: een poule vereist acht tot twaalf deelnemers.',409);
 s.seedSnapshot={...source,closedAt:new Date().toISOString(),drawSeed:seed,rows:entrants.map(p=>({playerId:p.id,rating:ratings.find(r=>r.playerId===p.id)?.rating??null,established:ratings.some(r=>r.playerId===p.id&&r.established),divisionId:p.status==='active'?p.divisionId:null,choice:p.placementChoice??'rating'}))};
}
function classificationFixture(s:SeasonState,tie:PromotionTie,players:[string,string],phase:'pool'|'knockout',graphId?:string):SeasonFixture{
 const round=Math.max(0,...s.rounds.map(r=>r.number))+1,window=seasonWindow(s,round);s.rounds.find(r=>r.number===round)!.released=true;
 return {id:randomUUID(),round,divisionId:tie.divisionId,homeId:players[0],awayId:players[1],status:'scheduled',...window,boardIds:[],lineups:{},confirmations:[],checkIns:[],settings:{startScore:501,bestOfLegs:5,bestOfSets:1},classification:{kind:tie.kind??'promotion',tieId:tie.id,phase,...(graphId?{graphId}:{})},slots:[{id:randomUUID(),index:0,players,starter:0,status:'scheduled',kind:'single'}]};
}
function startTieBracket(s:SeasonState,tie:PromotionTie):void{tie.phase='knockout';tie.bracket=knockout(drawTournamentPlayers(tie.remaining,tie.seed));}
/** Boundary ranks remain reserved while real deciding games are open. No points are rewritten. */
export function refreshPromotionTies(s:SeasonState):void{
 const ties=[...(s.promotionPlan?.ties??[]),...(s.vacancyTies??[])];
 for(const tie of ties){if(tie.phase==='complete')continue;
  if(tie.phase==='pool'){
   const fs=s.fixtures.filter(f=>f.classification?.tieId===tie.id&&f.classification.phase==='pool');if(fs.some(f=>f.status!=='confirmed'))continue;
   const wins=(id:string)=>fs.filter(f=>f.slots[0].winnerId===id).length,groups=tie.playerIds.map(id=>({id,wins:wins(id)})).sort((a,b)=>b.wins-a.wins||tie.playerIds.indexOf(a.id)-tie.playerIds.indexOf(b.id));
   // If all sport ranks are unique the mini-pool is decisive; otherwise the published KO series orders all tied entrants.
   if(new Set(groups.map(r=>r.wins)).size===groups.length){tie.order=groups.map(r=>r.id);tie.phase='complete';continue;}startTieBracket(s,tie);
  }
  if(tie.phase==='knockout'){
   for(const f of s.fixtures.filter(f=>f.classification?.tieId===tie.id&&f.classification.phase==='knockout')){const g=tie.bracket!.find(g=>g.id===f.classification!.graphId);if(g&&f.status==='confirmed'){g.status='confirmed';g.winnerId=f.slots[0].winnerId;g.score=f.slots[0].score;g.matchId=f.slots[0].matchId;}}
   advanceFixtures(tie.bracket!);const last=Math.max(...tie.bracket!.map(g=>g.round)),final=tie.bracket!.find(g=>g.round===last);
   if(final?.status==='confirmed'&&final.winnerId){tie.order.push(final.winnerId);tie.remaining=tie.remaining.filter(id=>id!==final.winnerId);if(tie.remaining.length===1){tie.order.push(tie.remaining[0]);tie.phase='complete';continue;}startTieBracket(s,tie);}
   for(const g of tie.bracket!.filter(g=>g.status!=='bye'&&g.players.every(Boolean)))if(!s.fixtures.some(f=>f.classification?.graphId===g.id))s.fixtures.push(classificationFixture(s,tie,g.players as [string,string],'knockout',g.id));
  }
 }
 if(s.promotionPlan)s.promotionPlan.complete=s.promotionPlan.ties.every(t=>t.phase==='complete');
 for(const vacancy of s.vacancies??[]){if(vacancy.status!=='deciding')continue;const tie=ties.find(t=>t.id===vacancy.tieId);if(tie?.phase==='complete'){vacancy.candidateId=tie.order[0];vacancy.status='ready';}}
}
export function createVacancyTie(s:SeasonState,divisionId:string,playerIds:string[]):PromotionTie{
 const tie:PromotionTie={id:randomUUID(),kind:'vacancy',playerIds:[...playerIds],divisionId,order:[],remaining:[...playerIds],phase:playerIds.length===2?'knockout':'pool',seed:randomUUID()};
 (s.vacancyTies??=[]).push(tie);if(playerIds.length===2)startTieBracket(s,tie);else for(const pair of roundRobin(playerIds))s.fixtures.push(classificationFixture(s,tie,pair.players as [string,string],'pool'));refreshPromotionTies(s);return tie;
}
export function planSeasonPromotions(s:SeasonState,standings:SeasonStanding[]):void{
 if(s.format!=='singles'||s.status!=='completed')throw new DomainError('season_not_complete','Promotie volgt de definitieve individuele seizoenstand.',409);
 if(s.promotionPlan)return;
 const levels=[...new Set(s.divisions.map(d=>divisionLevel(s,d)))].sort((a,b)=>a-b),transitions:PromotionPlan['transitions']=[],ties:PromotionTie[]=[];
 for(let i=1;i<levels.length;i++){const upper=s.divisions.filter(d=>divisionLevel(s,d)===levels[i-1]),lower=s.divisions.filter(d=>divisionLevel(s,d)===levels[i]),up=lower.reduce((n,d)=>n+(d.promotionPlaces??s.settings.promotionPlaces),0),down=upper.reduce((n,d)=>n+(d.relegationPlaces??s.settings.relegationPlaces),0);if(up!==down)throw new DomainError('unbalanced_transition',`In- en uitstroom tussen niveau ${levels[i-1]} en ${levels[i]} verschillen (${up}/${down}).`,409);transitions.push({fromLevel:levels[i],toLevel:levels[i-1],count:up},{fromLevel:levels[i-1],toLevel:levels[i],count:down});}
 for(const d of s.divisions){const rows=standings.filter(r=>r.divisionId===d.id&&s.participants.some(p=>p.id===r.id&&p.status==='active')).sort((a,b)=>a.position-b.position),level=divisionLevel(s,d),up=level===levels[0]?0:d.promotionPlaces??s.settings.promotionPlaces,down=level===levels.at(-1)?0:d.relegationPlaces??s.settings.relegationPlaces;if(up+down>rows.length)throw new DomainError('invalid_transition','Promotie en degradatie overlappen.');
  for(const cut of [up,rows.length-down]){if(cut<=0||cut>=rows.length||rows[cut-1].position!==rows[cut].position)continue;const ids=rows.filter(r=>r.position===rows[cut].position).map(r=>r.id);if(ties.some(t=>t.divisionId===d.id&&t.playerIds[0]===ids[0]))continue;const tie:PromotionTie={id:randomUUID(),playerIds:ids,divisionId:d.id,order:[],remaining:[...ids],phase:ids.length===2?'knockout':'pool',seed:randomUUID()};ties.push(tie);if(ids.length===2)startTieBracket(s,tie);else for(const pair of roundRobin(ids))s.fixtures.push(classificationFixture(s,tie,pair.players as [string,string],'pool'));}
 }
 s.promotionPlan={sourceRevision:s.revision,createdAt:new Date().toISOString(),transitions,assignments:[],ties,complete:ties.length===0};refreshPromotionTies(s);
}
/** Returns the new-season assignment only. Source participants, scores and table remain untouched. */
export function promotionAssignments(s:SeasonState,standings:SeasonStanding[]):PromotionPlan['assignments']{
 const plan=s.promotionPlan;if(!plan||!plan.complete)throw new DomainError('promotion_pending','Reserveer plaatsen totdat alle beslissingspartijen definitief zijn.',409);
 const levels=[...new Set(s.divisions.map(d=>divisionLevel(s,d)))].sort((a,b)=>a-b),byLevel=new Map(levels.map(level=>[level,[] as string[]])),result:PromotionPlan['assignments']=[];
 for(const d of s.divisions){const rows=standings.filter(r=>r.divisionId===d.id&&s.participants.some(p=>p.id===r.id&&p.status==='active')).sort((a,b)=>a.position-b.position||(plan.ties.find(t=>t.playerIds.includes(a.id)&&t.playerIds.includes(b.id))?.order.indexOf(a.id)??0)-(plan.ties.find(t=>t.playerIds.includes(a.id)&&t.playerIds.includes(b.id))?.order.indexOf(b.id)??0)),level=divisionLevel(s,d),li=levels.indexOf(level),up=li===0?0:d.promotionPlaces??s.settings.promotionPlaces,down=li===levels.length-1?0:d.relegationPlaces??s.settings.relegationPlaces;
  rows.forEach((row,i)=>byLevel.get(i<up?levels[li-1]:i>=rows.length-down?levels[li+1]:level)!.push(row.id));
 }
 for(const level of levels){const groups=s.divisions.filter(d=>divisionLevel(s,d)===level);for(const [i,id]of byLevel.get(level)!.entries()){const block=Math.floor(i/groups.length),offset=i%groups.length,to=groups[block%2===0?offset:groups.length-1-offset];result.push({entryId:id,fromDivisionId:s.participants.find(p=>p.id===id)!.divisionId,toDivisionId:to.id});}}
 plan.assignments=result;return result;
}
