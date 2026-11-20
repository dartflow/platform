import {createHash} from 'node:crypto';
import {DomainError} from './domain';
import {canonical,uuid} from './platform-store';
import {generateSeasonFixtures,seasonCapability,seasonSettings} from './seasons-domain';
import {knockout} from './platform-domain';
import {refreshCup} from './seasons-formats';
import type {SeasonState,SeasonFixture,SeasonSettings} from './seasons-types';
import type {CompetitionWizardConfig,CompetitionWizardIssue,CompetitionWizardPreview,CompetitionWizardFixture,CompetitionWizardTeam} from './competition-wizard-types';

const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const timePattern=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const day=86_400_000;
const validDate=(value:string)=>datePattern.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3));
const clock=(value:number)=>`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
export const wizardConfigurationHash=(value:CompetitionWizardConfig)=>createHash('sha256').update(canonical(value)).digest('hex');
export function wizardUuid(source:string):string{const h=createHash('sha256').update(source).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}

/** Save incomplete forms, while bounding every persisted field and excluding arbitrary private keys. */
export function normalizeCompetitionWizardConfig(input:unknown):CompetitionWizardConfig{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new DomainError('invalid_configuration','Geef een geldig competitieconcept.');
 const raw=input as Record<string,unknown>;if(raw.version!==undefined&&raw.version!==1)throw new DomainError('invalid_configuration','Deze configuratieversie wordt niet ondersteund.');
 const v=input as Record<string,unknown>,p=(v.planning&&typeof v.planning==='object'?v.planning:{})as Record<string,unknown>;
 const text=(value:unknown,max:number,fallback='')=>{if(value===undefined)return fallback;if(typeof value!=='string'||value.length>max)throw new DomainError('invalid_configuration','Een conceptveld is te lang of heeft een ongeldige waarde.');return value.trim();};
 const ids=(value:unknown,max=128):string[]=>{if(value===undefined)return[];if(!Array.isArray(value)||value.length>max)throw new DomainError('invalid_configuration','Kies een begrensde deelnemers- of banenlijst.');return value.map(uuid);};
 const integer=(value:unknown,fallback:number,min:number,max:number)=>{if(value===undefined)return fallback;if(!Number.isInteger(value)||Number(value)<min||Number(value)>max)throw new DomainError('invalid_configuration','Een numerieke conceptinstelling valt buiten het toegestane bereik.');return Number(value);};
 const list=<T>(value:unknown,max:number,parse:(v:unknown)=>T):T[]=>{if(value===undefined)return[];if(!Array.isArray(value)||value.length>max)throw new DomainError('invalid_configuration','Deze conceptlijst bevat te veel waarden.');return value.map(parse);};
 const variant=v.variant??'singles',system=v.system??'round-robin';if(!['singles','doubles','teams'].includes(String(variant))||!['round-robin','knockout'].includes(String(system)))throw new DomainError('invalid_configuration','Kies een ondersteunde interne competitievorm.');
 const teams=list(v.teams,64,item=>{if(!item||typeof item!=='object')throw new DomainError('invalid_configuration','Kies een geldige eigen teamselectie.');const t=item as Record<string,unknown>;return{id:uuid(t.id),name:text(t.name,100),captainId:t.captainId?uuid(t.captainId):'',deputyId:t.deputyId?uuid(t.deputyId):null,playerIds:ids(t.playerIds,8),reserveIds:ids(t.reserveIds,4)};});
 const rawRules=v.rules??{};if(!rawRules||typeof rawRules!=='object'||Array.isArray(rawRules))throw new DomainError('invalid_configuration','Gebruik benoemde spelregels.');
 const keys=['legWinByTwo','setWinByTwo','inRule','outRule','sideStartScores','slotRules','startProcedure','setOpener','decidingLeg','bestOfSets','legMode','legs','startScore','pointsWin','pointsDraw','pointsLoss','ranking','visibility','lineupHours','confirmHours','checkInMinutes','withdrawalPolicy','promotionPlaces','relegationPlaces','slotCount','cameraRequired','notes','tiebreaks'];
 const rules=Object.fromEntries(Object.entries(rawRules).filter(([key])=>keys.includes(key))) as CompetitionWizardConfig['rules'];
 if(Buffer.byteLength(JSON.stringify(rules))>12_000)throw new DomainError('invalid_configuration','De aanvullende spelregels zijn te groot.');
 const offsets=p.offsets===undefined?{}:p.offsets;if(!offsets||typeof offsets!=='object'||Array.isArray(offsets)||Object.keys(offsets).length>512||Object.entries(offsets).some(([key,value])=>!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(key)||typeof value!=='string'||!/^[-+]\d\d:\d\d$/.test(value)))throw new DomainError('invalid_configuration','Kies geldige tijdzone-offsets bij de betreffende lokale tijdstippen.');
 const gating=p.roundGating??'manual';if(!['manual','automatic'].includes(String(gating)))throw new DomainError('invalid_configuration','Kies handmatige of automatische rondevrijgave.');
 return{version:1,title:text(v.title,100),season:text(v.season,100),description:text(v.description,2000),organizerName:text(v.organizerName,100),variant:variant as CompetitionWizardConfig['variant'],system:system as CompetitionWizardConfig['system'],playerIds:ids(v.playerIds),teams,rules:structuredClone(rules),boardIds:ids(v.boardIds,32),planning:{startDate:text(p.startDate,10),endDate:p.endDate?text(p.endDate,10):null,weekdays:list(p.weekdays,7,x=>integer(x,0,0,6)),startTime:text(p.startTime,5,'19:30'),endTime:text(p.endTime,5,'23:00'),timezone:text(p.timezone,100,'Europe/Amsterdam'),matchMinutes:integer(p.matchMinutes,45,5,960),changeMinutes:integer(p.changeMinutes,5,0,120),breaks:list(p.breaks,10,item=>{if(!item||typeof item!=='object')throw new DomainError('invalid_configuration','Kies geldige pauzes.');const b=item as Record<string,unknown>;return{startTime:text(b.startTime,5),endTime:text(b.endTime,5)};}),excludedDates:list(p.excludedDates,180,x=>text(x,10)),roundGating:gating as 'manual'|'automatic',returnLegs:p.returnLegs===true,offsets:structuredClone(offsets)as Record<string,string>}};
}

/** Candidate instants are derived from the IANA zone, never the server's local timezone. */
export function competitionLocalInstant(date:string,time:string,zone:string,chosenOffset?:string):{instant:string;offset:string;candidates:string[]}{
 if(!validDate(date)||!timePattern.test(time))throw new DomainError('invalid_local_time','Kies een bestaande kalenderdatum en tijd.');
 const target=Date.parse(`${date}T${time}:00Z`),format=new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 const local=(instant:number)=>{const p=Object.fromEntries(format.formatToParts(instant).map(part=>[part.type,part.value]));return`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;};
 const offsets=new Set<number>();for(let hours=-36;hours<=36;hours+=6){const at=target+hours*3600_000;offsets.add(Date.parse(local(at)+'Z')-at);}
 const candidates=[...offsets].map(offset=>({at:target-offset,offset})).filter(row=>local(row.at)===`${date}T${time}:00`).sort((a,b)=>a.at-b.at).map(row=>{const n=Math.abs(row.offset)/60_000;return{instant:new Date(row.at).toISOString(),offset:`${row.offset<0?'-':'+'}${clock(n)}`};});
 if(!candidates.length)throw new DomainError('nonexistent_local_time','Dit lokale tijdstip bestaat niet door de zomertijdwisseling. Kies een andere speeltijd.');
 if(candidates.length>1&&!chosenOffset)throw new DomainError('ambiguous_local_time',`Dit lokale tijdstip komt tweemaal voor. Kies expliciet ${candidates.map(c=>c.offset).join(' of ')}.`);
 const found=chosenOffset?candidates.find(c=>c.offset===chosenOffset):candidates[0];if(!found)throw new DomainError('invalid_local_offset','De gekozen UTC-offset hoort niet bij deze lokale tijd en tijdzone.');
 return{...found,candidates:candidates.map(c=>c.offset)};
}

export type WizardRoster={players:{id:string;name:string}[];teams:CompetitionWizardTeam[]};
export function buildCompetitionWizardPreview(config:CompetitionWizardConfig,draftId:string,revision:number,roster:WizardRoster):{preview:CompetitionWizardPreview;season:SeasonState|null}{
 const issues:CompetitionWizardIssue[]=[],warnings:CompetitionWizardIssue[]=[],add=(step:CompetitionWizardIssue['step'],path:string,code:string,message:string)=>issues.push({step,path,code,message}),p=config.planning,entries=config.variant==='singles'?roster.players.map(player=>({...player,playerIds:[player.id]})):roster.teams;
 if(!config.title)add(1,'title','required','Geef de competitie een titel.');if(!config.season)add(1,'season','required','Geef het seizoen een herkenbare naam.');
 if(config.system==='knockout'&&config.variant!=='singles')add(1,'system','unsupported_system','Het bestaande bekersysteem gebruikt individuele spelers. Kies iedereen-tegen-iedereen voor koppels en teams.');
 if(entries.length<2||entries.length>32)add(2,'playerIds','participant_count','Kies minimaal twee en maximaal 32 deelnemers of teams in deze wizard.');
 const all=entries.flatMap(e=>e.playerIds),selected=config.variant==='singles'?config.playerIds:config.teams.map(t=>t.id);if(new Set(selected).size!==selected.length||new Set(all).size!==all.length)add(2,'teams','duplicate_player','Een speler of team kan slechts eenmaal aan deze competitie deelnemen.');
 for(const team of roster.teams){const min=config.variant==='doubles'?2:4,max=config.variant==='doubles'?3:8;if(team.playerIds.length<min||team.playerIds.length>max||!team.name||!team.playerIds.includes(team.captainId)||team.deputyId===team.captainId||team.deputyId&&!team.playerIds.includes(team.deputyId)||team.reserveIds.some(id=>!team.playerIds.includes(id))||new Set(team.reserveIds).size!==team.reserveIds.length||team.playerIds.length-team.reserveIds.length<min)add(2,'teams','invalid_roster','Een eigen team heeft een complete basisselectie, captain en geldige, afzonderlijke reserves.');}
 if(!validDate(p.startDate)||p.endDate&&(!validDate(p.endDate)||p.endDate<p.startDate))add(5,'planning.startDate','invalid_date','Kies een geldige startdatum en eventuele einddatum.');
 if(!p.weekdays.length||new Set(p.weekdays).size!==p.weekdays.length)add(5,'planning.weekdays','invalid_weekdays','Kies één of meer verschillende speeldagen.');
 if(!timePattern.test(p.startTime)||!timePattern.test(p.endTime)||p.endTime<=p.startTime)add(5,'planning.endTime','invalid_hours','Kies een eindtijd na de begintijd op dezelfde kalenderdag.');
 if(p.excludedDates.some(d=>!validDate(d)))add(5,'planning.excludedDates','invalid_date','Controleer de uitgesloten datums.');
 for(const b of p.breaks)if(!timePattern.test(b.startTime)||!timePattern.test(b.endTime)||b.endTime<=b.startTime||b.startTime<p.startTime||b.endTime>p.endTime)add(5,'planning.breaks','invalid_break','Een pauze valt binnen de gekozen speelavond.');
 try{new Intl.DateTimeFormat('nl',{timeZone:p.timezone}).format();}catch{add(5,'planning.timezone','invalid_timezone','Kies een geldige IANA-tijdzone.');}
 if(!config.boardIds.length||new Set(config.boardIds).size!==config.boardIds.length)add(4,'boardIds','boards_required','Kies minstens één verschillende, expliciet gekoppelde actieve baan.');
 let settings:SeasonSettings|null=null;
 try{settings=seasonSettings({...config.rules,startDate:validDate(p.startDate)?p.startDate:'2026-01-01',playTime:p.startTime,timezone:p.timezone,capacity:Math.max(2,entries.length),boardCount:Math.max(1,config.boardIds.length),boardIds:config.boardIds,allowMultipleTeams:true,returnLegs:p.returnLegs,roundGating:p.roundGating==='manual',scheduleMode:'fixed',playMode:'local',slotMinutes:Math.max(5,Math.floor(p.matchMinutes/(config.variant==='teams'?(config.rules.slotCount??4):1)))});const capability=seasonCapability(config.system==='knockout'?'cup':config.variant,settings);if(!capability.supported)add(3,'rules','unsupported_rules',capability.reason!);}catch(error){add(3,'rules','invalid_rules',error instanceof Error?error.message:'Controleer de spelregels.');}
 if(config.system==='knockout'&&p.returnLegs)add(5,'planning.returnLegs','knockout_return','Heen en terug is beschikbaar voor iedereen-tegen-iedereen; een bekervak kent één winnaar.');
 const regulation=[`${config.variant==='singles'?'Individueel':config.variant==='doubles'?'Vaste koppels':'Eigen teams'} · ${config.system==='round-robin'?'iedereen tegen iedereen':'knock-out'}`,`${p.returnLegs?'Heen en terug':'Enkele ontmoetingen'}; ${p.roundGating==='manual'?'leiding geeft iedere ronde vrij':'volgende ronde na definitieve noodzakelijke uitslagen'}`,`${settings?.startScore??501} · ${settings?.inRule??'single'} in · ${settings?.outRule??'double'} uit · ${settings?.legMode==='fixed'?'vaste':'best of'} ${settings?.legs??5} legs`,`${settings?.pointsWin??2} punten winst, ${settings?.pointsDraw??1} gelijk, ${settings?.pointsLoss??0} verlies`,`Rangschikking: ${(settings?.tiebreaks??['points','leg-difference','legs-for','head-to-head']).join(' → ')}; een onbesliste eindgroep houdt een gedeelde plaats.`,...(config.rules.notes?[config.rules.notes]:[])];
 const preview:CompetitionWizardPreview={draftId,revision,configurationHash:wizardConfigurationHash(config),canPublish:false,issues,warnings,fixtures:[],rounds:[],totalMatches:0,participantCount:entries.length,regulation};
 if(issues.length||!settings)return{preview,season:null};
 const divisionId=wizardUuid(`${draftId}:division`),s:SeasonState={id:draftId,revision:0,name:config.title,scope:'internal',clubId:null,ownerId:'',managerIds:[],status:'draft',format:config.system==='knockout'?'cup':config.variant,settings,rulesVersion:1,publishedAt:null,eventId:'',coreClubId:'',divisions:[{id:divisionId,name:config.season}],participants:config.variant==='singles'?roster.players.map(player=>({...player,divisionId,status:'active',available:true,checkedIn:false})):[],teams:config.variant==='singles'?[]:roster.teams.map(team=>({...team,clubId:'',divisionId,status:'active'})),rounds:[],fixtures:[],decisions:[],deductions:{},createdAt:new Date(0).toISOString()};
 if(config.system==='round-robin'){
  s.settings={...settings,startDate:'2026-01-01',playTime:'12:00',timezone:'UTC'};generateSeasonFixtures(s);s.settings=settings;s.fixtures.forEach((f,index)=>{f.id=wizardUuid(`${draftId}:fixture:${index}`);f.slots.forEach((slot,i)=>slot.id=wizardUuid(`${f.id}:slot:${i}`));});
 }else{
  const graph=knockout(roster.players.map(player=>player.id)),map=new Map(graph.map((f,i)=>[f.id,wizardUuid(`${draftId}:bracket:${i}`)]));for(const f of graph){f.id=map.get(f.id)!;for(const source of f.sources??[])if(source.fixtureId)source.fixtureId=map.get(source.fixtureId)!;}
  s.cup={fixtures:graph,seedOrder:roster.players.map(player=>player.id),drawSeed:draftId};refreshCup(s);for(const f of s.fixtures){f.id=wizardUuid(`${draftId}:fixture:${f.bracketFixtureId}`);f.slots[0].id=wizardUuid(`${f.id}:slot:0`);}
 }
 const graphRows=config.system==='knockout'?s.cup!.fixtures.filter(f=>f.status!=='bye').map(g=>({id:wizardUuid(`${draftId}:fixture:${g.id}`),round:g.round,homeId:g.players[0]??'',awayId:g.players[1]??'',bracketFixtureId:g.id})):s.fixtures;
 preview.totalMatches=graphRows.length;
 const maxRound=Math.max(...graphRows.map(f=>f.round));let cursor=p.startDate;
 const lastDate=p.endDate??new Date(Date.parse(cursor+'T12:00:00Z')+366*day).toISOString().slice(0,10);
 const nextDate=(from:string)=>new Date(Date.parse(from+'T12:00:00Z')+day).toISOString().slice(0,10);
 const findDate=()=>{while(cursor<=lastDate&&(!p.weekdays.includes(new Date(cursor+'T12:00:00Z').getUTCDay())||p.excludedDates.includes(cursor)))cursor=nextDate(cursor);return cursor<=lastDate;};
 for(let round=1;round<=maxRound;round++){
  if(!findDate()){add(5,'planning.endDate','insufficient_capacity','De gekozen speeldagen, tijden en banen bieden onvoldoende ruimte vóór de einddatum.');break;}
  let lane=0,at=minutes(p.startTime),first:string|undefined,last:string|undefined;
  const roundFixtures=graphRows.filter(f=>f.round===round);
  for(const f of roundFixtures){
   let iterations=0;for(;;){if(++iterations>750){add(5,'planning.endTime','insufficient_capacity','Een partij past niet binnen de gekozen speelavond, pauzes en duur.');break;}
    const pause=p.breaks.find(b=>at<minutes(b.endTime)&&at+p.matchMinutes>minutes(b.startTime));if(pause){at=minutes(pause.endTime);lane=0;continue;}
    if(at+p.matchMinutes<=minutes(p.endTime))break;cursor=nextDate(cursor);at=minutes(p.startTime);lane=0;if(!findDate()){add(5,'planning.endDate','insufficient_capacity','Het programma past niet binnen de gekozen einddatum.');break;}
   }
   if(issues.length)break;
   let localTime=clock(at);try{
    const from=competitionLocalInstant(cursor,localTime,p.timezone,p.offsets[`${cursor}T${localTime}`]);localTime=clock(at+p.matchMinutes);const to=competitionLocalInstant(cursor,localTime,p.timezone,p.offsets[`${cursor}T${localTime}`]);
    if(Date.parse(to.instant)-Date.parse(from.instant)<p.matchMinutes*60_000)throw new DomainError('invalid_duration','De offsetkeuze maakt deze partij korter dan de vastgelegde duur.');
    const home=entries.find(e=>e.id===f.homeId),away=entries.find(e=>e.id===f.awayId),participantIds=home&&away?[...home.playerIds,...away.playerIds]:all;
    const item:CompetitionWizardFixture={id:f.id,round,homeId:f.homeId,awayId:f.awayId,homeName:home?.name??'Winnaar voorgaand bekervak',awayName:away?.name??'Winnaar voorgaand bekervak',startsAt:from.instant,endsAt:to.instant,boardId:config.boardIds[lane],locationId:'',offset:from.offset,participantIds,...('bracketFixtureId'in f&&f.bracketFixtureId?{bracketFixtureId:f.bracketFixtureId}:{} )};preview.fixtures.push(item);first??=from.instant;last=to.instant;
    const actual=s.fixtures.find(row=>row.id===f.id);if(actual)Object.assign(actual,{startsAt:from.instant,endsAt:to.instant,windowStart:from.instant,windowEnd:to.instant,boardIds:[item.boardId]});
   }catch(error){add(5,`planning.offsets.${cursor}T${localTime}`,error instanceof DomainError?error.code:'invalid_local_time',`${cursor}T${localTime}: ${error instanceof Error?error.message:'Controleer het tijdstip.'}`);break;}
   if(++lane===config.boardIds.length){lane=0;at+=p.matchMinutes+p.changeMinutes;}
  }
  if(issues.length)break;
  if(first&&last){const present=new Set(roundFixtures.flatMap(f=>[f.homeId,f.awayId]));preview.rounds.push({number:round,startsAt:first,endsAt:last,released:round===1,byeIds:config.system==='round-robin'?entries.filter(e=>!present.has(e.id)).map(e=>e.id):[]});}
  cursor=nextDate(cursor);
 }
 s.rounds=preview.rounds.map(round=>({number:round.number,startsAt:round.startsAt,endsAt:round.endsAt,released:round.released}));preview.canPublish=issues.length===0;
 if(preview.fixtures.some(f=>Date.parse(f.endsAt)-Date.parse(f.startsAt)>p.matchMinutes*60_000))warnings.push({step:5,path:'planning.offsets',code:'dst_longer_duration',message:'Door de wintertijd duurt een gekozen tijdvak langer in werkelijke minuten. Controleer de expliciete offsets.'});
 return{preview,season:s};
}

/** Future cup slots receive the schedule frozen at publication when their players become known. */
export function applyPublishedWizardFixtureSchedule(s:SeasonState&{competitionWizard?:{fixtures:CompetitionWizardFixture[]}},f:SeasonFixture):void{
 const frozen=s.competitionWizard?.fixtures.find(row=>row.id===f.id||row.bracketFixtureId&&row.bracketFixtureId===f.bracketFixtureId);if(!frozen)return;
 f.id=frozen.id;f.slots.forEach((slot,index)=>{if(!slot.matchId)slot.id=wizardUuid(`${f.id}:slot:${index}`);});Object.assign(f,{startsAt:frozen.startsAt,endsAt:frozen.endsAt,windowStart:frozen.startsAt,windowEnd:frozen.endsAt,boardIds:[frozen.boardId]});
}
