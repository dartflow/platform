import {validateSeasonSlotRules} from './season-rules';
import {randomUUID} from 'node:crypto';
import {DomainError,validateSettings} from './domain';
import {generateCup,refreshLadder,isTeamSeason,seasonSlotCount,cupPlacings} from './seasons-formats';
import type {SeasonSettings,SeasonState,SeasonFixture,SeasonStanding,SeasonFormat} from './seasons-types';

const day=86_400_000;
export function seasonSettings(input:unknown={}):SeasonSettings{
 const v=input&&typeof input==='object'?input as Record<string,unknown>:{};
 const num=(key:string,fallback:number,min:number,max:number)=>{const n=v[key]===undefined?fallback:Number(v[key]);if(!Number.isInteger(n)||n<min||n>max)throw new DomainError('invalid_settings',`Ongeldige instelling: ${key}.`);return n;};
 const choice=<T extends string>(key:string,values:T[],fallback:T):T=>{if(v[key]===undefined)return fallback;if(!values.includes(v[key] as T))throw new DomainError('invalid_settings',`Ongeldige instelling: ${key}.`);return v[key] as T;};
 const date=v.startDate===undefined?new Date(Date.now()+day).toISOString().slice(0,10):String(v.startDate);
 if(!/^\d{4}-\d\d-\d\d$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw new DomainError('invalid_settings','Kies een geldige startdatum.');
 const playTime=String(v.playTime??'19:30');if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(playTime))throw new DomainError('invalid_settings','Kies een geldige speeltijd.');
 const timezone=String(v.timezone??'Europe/Amsterdam');try{new Intl.DateTimeFormat('nl',{timeZone:timezone}).format();}catch{throw new DomainError('invalid_settings','Kies een geldige tijdzone.');}
 const legMode=choice('legMode',['bestOf','fixed'],'bestOf'),legs=num('legs',5,1,99);if(legMode==='bestOf'&&legs%2===0)throw new DomainError('invalid_settings','Best of gebruikt een oneven aantal legs.');
 const startScore=num('startScore',501,301,701);if(![301,501,701].includes(startScore))throw new DomainError('invalid_settings','Gebruik 301, 501 of 701.');
 const list=(key:string,max:number)=>{if(v[key]===undefined)return [];if(!Array.isArray(v[key])||v[key].length>max||v[key].some(x=>typeof x!=='string'))throw new DomainError('invalid_settings',`Ongeldige lijst: ${key}.`);return [...new Set(v[key] as string[])];};
 const blackouts=list('blackouts',60);if(blackouts.some(d=>!/^\d{4}-\d\d-\d\d$/.test(d)||!Number.isFinite(Date.parse(d))))throw new DomainError('invalid_settings','Controleer de speelvrije datums.');
 const slotCount=num('slotCount',4,4,7);if(![4,7].includes(slotCount))throw new DomainError('invalid_settings','Gebruik vier of zeven slots.');
 const startRules=validateSettings({...(v.legWinByTwo?{legWinByTwo:v.legWinByTwo as SeasonSettings['legWinByTwo']}:{}),...(v.setWinByTwo?{setWinByTwo:v.setWinByTwo as SeasonSettings['setWinByTwo']}:{}),startScore:startScore as 301|501|701,bestOfLegs:legMode==='fixed'?7:([1,3,5,7,9,11,13,15,17,19].includes(legs)?legs:5),...(legMode==='fixed'&&[6,8,10].includes(legs)?{legLimit:legs}:{}),...(v.inRule?{inRule:v.inRule as 'single'}:{}),...(v.outRule?{outRule:v.outRule as 'double'}:{}),...(v.sideStartScores?{sideStartScores:v.sideStartScores as [number,number]}:{}),bestOfSets:num('bestOfSets',1,1,5),...(v.startProcedure?{startProcedure:v.startProcedure as 'bull'}:{}),...(v.setOpener?{setOpener:v.setOpener as 'continuous'}:{}),...(v.decidingLeg?{decidingLeg:v.decidingLeg as 'continue'}:{})});
 if(legMode==='fixed'&&(startRules.bestOfSets!==1||startRules.decidingLeg==='rebull'))throw new DomainError('invalid_settings','Vaste legs gebruiken één set zonder rebullbeslisser.');
 const transferDeadline=v.transferDeadline?String(v.transferDeadline):null;if(transferDeadline&&!Number.isFinite(Date.parse(transferDeadline)))throw new DomainError('invalid_settings','Kies een geldige transferdeadline.');
 return {...(startRules.legWinByTwo?{legWinByTwo:startRules.legWinByTwo}:{}),...(startRules.setWinByTwo?{setWinByTwo:startRules.setWinByTwo}:{}),...(startRules.inRule?{inRule:startRules.inRule}:{}),...(startRules.outRule?{outRule:startRules.outRule}:{}),...(startRules.sideStartScores?{sideStartScores:startRules.sideStartScores}:{}),...(v.slotRules!==undefined?{slotRules:validateSeasonSlotRules(v.slotRules,startRules)}:{}),...(startRules.startProcedure?{startProcedure:startRules.startProcedure}:{}),...(startRules.setOpener?{setOpener:startRules.setOpener}:{}),...(startRules.decidingLeg?{decidingLeg:startRules.decidingLeg}:{}),bestOfSets:startRules.bestOfSets,ladderDistance:num('ladderDistance',3,1,10),ladderAnswerHours:num('ladderAnswerHours',48,1,168),ladderPlayDays:num('ladderPlayDays',7,1,30),transferDeadline,scheduleMode:choice('scheduleMode',['fixed','flex'],'fixed'),playMode:choice('playMode',['local','remote','hybrid'],'local'),startDate:date,playTime,timezone,roundDays:num('roundDays',7,1,90),windowDays:num('windowDays',7,1,90),slotMinutes:num('slotMinutes',45,5,240),boardCount:num('boardCount',3,1,32),boardIds:list('boardIds',32),capacity:num('capacity',16,2,128),legMode,legs,startScore:startScore as 301|501|701,pointsWin:num('pointsWin',2,0,99),pointsDraw:num('pointsDraw',1,0,99),pointsLoss:num('pointsLoss',0,0,99),ranking:choice('ranking',['points','legs'],'points'),visibility:choice('visibility',['members','public','invite'],'members'),lineupHours:num('lineupHours',24,0,720),confirmHours:num('confirmHours',48,1,720),checkInMinutes:num('checkInMinutes',30,0,1440),returnLegs:v.returnLegs===true,roundGating:v.roundGating===true,blackouts,inhaalWeeks:num('inhaalWeeks',1,0,8),withdrawalPolicy:choice('withdrawalPolicy',['progress','preserve','remove'],'progress'),promotionPlaces:num('promotionPlaces',1,0,20),relegationPlaces:num('relegationPlaces',1,0,20),slotCount:slotCount as 4|7,allowMultipleTeams:v.allowMultipleTeams===true,cameraRequired:v.cameraRequired===true,notes:typeof v.notes==='string'?v.notes.trim().slice(0,2000):''};
}
/** Resolve a wall-clock time in the published IANA zone; reject non-existent DST times. */
export function seasonInstant(date:string,time:string,zone:string):string{
 const desired=Date.parse(`${date}T${time}:00Z`);let guess=desired;
 const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 for(let i=0;i<4;i++){const p=Object.fromEntries(formatter.formatToParts(guess).map(x=>[x.type,x.value]));const actual=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);const delta=desired-actual;if(delta===0)return new Date(guess).toISOString();guess+=delta;}
 throw new DomainError('invalid_window','Deze lokale speeltijd bestaat niet door de tijdzonewisseling. Kies een andere tijd.');
}
export function seasonCapability(format:SeasonFormat,settings:SeasonSettings):{supported:boolean;reason:string|null}{
 if(settings.legMode==='bestOf'&&![1,3,5,7,9].includes(settings.legs))return {supported:false,reason:'De bestaande score-engine ondersteunt best of 1, 3, 5, 7 of 9 legs.'};
 if(settings.legMode==='fixed'&&![6,8,10].includes(settings.legs))return {supported:false,reason:'Gebruik zes, acht of tien vaste legs in de bestaande score-engine.'};
 if(['cup','champions','ladder'].includes(format)&&settings.legMode==='fixed')return {supported:false,reason:'Deze vorm vereist een winnaar. Publiceer best-of legs.'};
 if(settings.cameraRequired&&settings.playMode==='local')return {supported:false,reason:'Verplichte camera is alleen beschikbaar voor officiële remote partijen.'};
 return {supported:true,reason:null};
}
export function fixtureTotals(f:SeasonFixture):{score:[number,number];legs:[number,number]}{
 if(f.administrative)return {score:f.administrative.score,legs:[0,0]};
 const score:[number,number]=[0,0],legs:[number,number]=[0,0];
 for(const slot of f.slots){if(slot.administrative){if(slot.administrative.winner!==null)score[slot.administrative.winner]++;continue;}if(!slot.score||!['confirmed','provisional'].includes(slot.status))continue;legs[0]+=slot.score[0];legs[1]+=slot.score[1];if(slot.score[0]>slot.score[1])score[0]++;else if(slot.score[1]>slot.score[0])score[1]++;}
 return {score,legs};
}
function entries(s:SeasonState){return isTeamSeason(s)?s.teams:s.participants;}
export function seasonWithdrawalProgress(s:SeasonState,id:string):{planned:number;played:number;excluded:boolean}{const all=s.fixtures.filter(f=>!f.classification&&[f.homeId,f.awayId].includes(id)),played=all.filter(f=>f.status==='confirmed'&&!f.administrative&&f.slots.some(slot=>slot.status==='confirmed'&&!slot.administrative&&slot.matchId)).length;return{planned:all.length,played,excluded:s.settings.withdrawalPolicy==='remove'||s.settings.withdrawalPolicy==='progress'&&(all.length===0||played*2<all.length)};}
function withdrawnExcluded(s:SeasonState,id:string):boolean{const e=entries(s).find(x=>x.id===id);return e?.status==='withdrawn'&&(s.withdrawals?.[id]?.excluded??seasonWithdrawalProgress(s,id).excluded);}
export function seasonStandings(s:SeasonState):SeasonStanding[]{
 refreshLadder(s);
 const rows=entries(s).map(e=>({id:e.id,name:e.name,divisionId:e.divisionId,position:0,shared:false,played:0,won:0,drawn:0,lost:0,points:0,deduction:s.deductions[e.id]??0,partiesFor:0,partiesAgainst:0,legsFor:0,legsAgainst:0,form:[] as ('W'|'G'|'V')[]}));
 const valid=s.fixtures.filter(f=>!f.classification&&['confirmed','administrative'].includes(f.status)&&!withdrawnExcluded(s,f.homeId)&&!withdrawnExcluded(s,f.awayId));
 const add=(row:SeasonStanding,side:0|1,f:SeasonFixture)=>{const {score,legs}=fixtureTotals(f),other=side===0?1:0,own=isTeamSeason(s)||f.administrative?score[side]:legs[side],opp=isTeamSeason(s)||f.administrative?score[other]:legs[other],won=own>opp,draw=own===opp;row.played++;row.won+=+won;row.drawn+=+draw;row.lost+=+(!won&&!draw);row.partiesFor+=score[side];row.partiesAgainst+=score[other];row.legsFor+=legs[side];row.legsAgainst+=legs[other];row.points+=f.administrative?.points?.[side]??(won?s.settings.pointsWin:draw?s.settings.pointsDraw:s.settings.pointsLoss);row.form.push(won?'W':draw?'G':'V');};
 for(const f of [...valid].sort((a,b)=>(a.confirmedAt??'').localeCompare(b.confirmedAt??'')||a.id.localeCompare(b.id))){const a=rows.find(r=>r.id===f.homeId),b=rows.find(r=>r.id===f.awayId);if(a&&b){add(a,0,f);add(b,1,f);}}
 for(const row of rows){row.points-=row.deduction;row.form=row.form.slice(-5).reverse();}
 const primary=(r:SeasonStanding)=>s.settings.ranking==='legs'?r.legsFor:r.points;
 const national=s.scope==='national';
 const base=(a:SeasonStanding,b:SeasonStanding)=>primary(b)-primary(a)||(national?(b.partiesFor-b.partiesAgainst)-(a.partiesFor-a.partiesAgainst):(b.legsFor-b.legsAgainst)-(a.legsFor-a.legsAgainst))||(!national?b.legsFor-a.legsFor:0);
 const sorted=rows.sort((a,b)=>a.divisionId.localeCompare(b.divisionId)||base(a,b)||a.id.localeCompare(b.id));
 for(const division of s.divisions){const group=sorted.filter(r=>r.divisionId===division.id);let cursor=0;while(cursor<group.length){let end=cursor+1;while(end<group.length&&base(group[cursor],group[end])===0)end++;const tied=group.slice(cursor,end),ids=tied.map(r=>r.id);const meetings=valid.filter(f=>ids.includes(f.homeId)&&ids.includes(f.awayId)),complete=ids.length>1&&ids.every(a=>ids.every(b=>a===b||meetings.filter(f=>(f.homeId===a&&f.awayId===b)||(f.homeId===b&&f.awayId===a)).length>=(s.settings.returnLegs?2:1)));const mini=(id:string)=>meetings.reduce((n,f)=>{const side=f.homeId===id?0:f.awayId===id?1:null;if(side===null)return n;const t=fixtureTotals(f),score=isTeamSeason(s)?t.score:t.legs;return n+(score[side]>score[1-side]?s.settings.pointsWin:score[side]===score[1-side]?s.settings.pointsDraw:s.settings.pointsLoss);},0);const tie=(a:SeasonStanding,b:SeasonStanding)=>(complete?mini(b.id)-mini(a.id):0)||((b.legsFor-b.legsAgainst)-(a.legsFor-a.legsAgainst));tied.sort((a,b)=>tie(a,b)||a.id.localeCompare(b.id));tied.forEach((r,i)=>{r.position=cursor+i+1;r.shared=i>0&&tie(tied[i-1],r)===0;if(r.shared){r.position=tied[i-1].position;tied[i-1].shared=true;}});group.splice(cursor,end-cursor,...tied);cursor=end;}sorted.splice(sorted.findIndex(r=>r.divisionId===division.id),group.length,...group);}
 if(s.format==='ladder'&&s.ladder){return s.ladder.order.flatMap((id,index)=>{const row=rows.find(r=>r.id===id);return row?[{...row,position:index+1,shared:false}]:[];});}
 if(s.cup){const places=cupPlacings(s);return rows.map(row=>({...row,position:places.get(row.id)??0,shared:[...places.values()].filter(p=>p===places.get(row.id)).length>1})).sort((a,b)=>(a.position||999)-(b.position||999)||a.id.localeCompare(b.id));}
 return sorted;
}
/** Circle schedule with balanced Berger home roles and date/timezone preserving windows. */
function generateRegularSeasonFixtures(s:SeasonState):void{
 if(s.fixtures.some(f=>f.slots.some(x=>x.matchId)))throw new DomainError('schedule_started','Een gestart programma kan niet opnieuw worden gegenereerd.',409);
 s.fixtures=[];s.rounds=[];if(s.format==='ladder'){const ids=s.participants.filter(p=>p.status==='active').map(p=>p.id);if(ids.length<2)throw new DomainError('insufficient_entries','Een ladder vereist minimaal twee spelers.',409);s.ladder={initialOrder:ids,order:[...ids],challenges:[]};return;}
 if(s.format==='drop-in')return;
 if(s.format==='cup'||s.format==='champions'){generateCup(s);return;}
 let maxRound=0;
 for(const division of s.divisions){const ids=entries(s).filter(e=>e.divisionId===division.id&&e.status==='active').map(e=>e.id);if(ids.length<2)continue;const rotation:(string|null)[]=[...ids];if(rotation.length%2)rotation.push(null);const rounds=rotation.length-1;maxRound=Math.max(maxRound,rounds*(s.settings.returnLegs?2:1));
  for(let r=0;r<rounds;r++){for(let i=0;i<rotation.length/2;i++){let home=rotation[i],away=rotation[rotation.length-1-i];if(!home||!away)continue;if((i===0&&r%2===1)||(i>0&&i%2===1))[home,away]=[away,home];for(let leg=0;leg<(s.settings.returnLegs?2:1);leg++){const round=r+1+leg*rounds;const h=leg?away:home,a=leg?home:away;s.fixtures.push({id:randomUUID(),round,divisionId:division.id,homeId:h,awayId:a,status:'scheduled',windowStart:'',windowEnd:'',boardIds:[],slots:Array.from({length:seasonSlotCount(s)},(_,index)=>({id:randomUUID(),index,players:isTeamSeason(s)?[null,null]:[h,a],starter:index%2===0?0:1,status:'scheduled'})),lineups:{},confirmations:[],checkIns:[]});}}rotation.splice(1,0,rotation.pop()!);}
 }
 if(!s.fixtures.length)throw new DomainError('insufficient_entries','Voeg minimaal twee toegelaten deelnemers of teams aan dezelfde divisie toe.',409);
 let offset=0;for(let round=1;round<=maxRound;round++){let date=new Date(Date.parse(s.settings.startDate+'T12:00:00Z')+offset*day).toISOString().slice(0,10);while(s.settings.blackouts.includes(date)){offset++;date=new Date(Date.parse(s.settings.startDate+'T12:00:00Z')+offset*day).toISOString().slice(0,10);}const start=seasonInstant(date,s.settings.playTime,s.settings.timezone),end=new Date(Date.parse(start)+s.settings.windowDays*day).toISOString();s.rounds.push({number:round,startsAt:start,endsAt:end,released:!s.settings.roundGating});const fixtures=s.fixtures.filter(f=>f.round===round);fixtures.forEach((f,index)=>{f.windowStart=start;f.windowEnd=end;if(s.settings.scheduleMode==='fixed'){const block=Math.floor(index/s.settings.boardCount);f.startsAt=new Date(Date.parse(start)+block*seasonSlotCount(s)*s.settings.slotMinutes*60_000).toISOString();f.endsAt=new Date(Date.parse(f.startsAt)+seasonSlotCount(s)*s.settings.slotMinutes*60_000).toISOString();const board=s.settings.boardIds[index%s.settings.boardCount];if(board)f.boardIds=[board];}});offset+=s.settings.roundDays;}
}

/** Placement scorecards survive creation of the following regular programme. */
export function generateSeasonFixtures(s:SeasonState):void{
 const placement=s.fixtures.filter(f=>f.classification),placementRounds=s.rounds.filter(r=>placement.some(f=>f.round===r.number));
 if(placement.some(f=>!['confirmed','canceled'].includes(f.status)))throw new DomainError('placement_pending','Werk eerst de aangekondigde plaatsingspartijen definitief af.',409);
 s.fixtures=s.fixtures.filter(f=>!f.classification);generateRegularSeasonFixtures(s);
 const max=Math.max(0,...s.rounds.map(r=>r.number)),mapping=new Map(placementRounds.map((r,i)=>[r.number,max+i+1]));
 for(const r of placementRounds)s.rounds.push({...r,number:mapping.get(r.number)!});for(const f of placement){f.round=mapping.get(f.round)!;s.fixtures.push(f);}
}
