import {randomUUID} from 'node:crypto';
import {DomainError} from './domain';
import {advanceFixtures,knockout} from './platform-domain';
import {drawTournamentPlayers} from './tournament-formats';
import blossom from 'edmonds-blossom';
import type {SeasonFixture,SeasonState,LadderChallenge} from './seasons-types';

const day=86_400_000;
export const isTeamSeason=(s:Pick<SeasonState,'format'>)=>s.format==='teams'||s.format==='doubles';
export const seasonSlotCount=(s:Pick<SeasonState,'format'|'settings'>)=>s.format==='teams'?s.settings.slotCount:1;
export const slotPeople=(slot:SeasonFixture['slots'][number])=>slot.sidePlayerIds?.flat()??slot.players.filter((id):id is string=>Boolean(id));
/** Once revealed, each side has stable participant identities for every component. */
export function revealSeasonLineups(s:SeasonState,f:SeasonFixture,includeCalled:string[]=[]):void{
 if(!f.lineups.home?.submittedAt||!f.lineups.away?.submittedAt)return;
 const count=s.format==='doubles'?2:4;
 const selections=s.format==='doubles'?[[0,1]]:s.settings.slotCount===7?[[0],[1],[2],[3],[0,1],[2,3],[0,1,2,3]]:[[0],[1],[2],[3]];
 for(const [index,selection]of selections.entries()){
  const slot=f.slots[index];if(slot.matchId&&!includeCalled.includes(slot.matchId))continue;
  const a=selection.map(i=>f.lineups.home!.players[i]),b=selection.map(i=>f.lineups.away!.players[i]);
  slot.players=[a[0]??null,b[0]??null];slot.kind=selection.length===1?'single':selection.length===2?'double':'team';
  slot.sidePlayerIds=[a.filter((id):id is string=>Boolean(id)),b.filter((id):id is string=>Boolean(id))];
  if(a.length!==selection.length||b.length!==selection.length||a.some(id=>!id)||b.some(id=>!id)){
   if(s.format==='doubles'||s.settings.slotCount===7||count!==4)throw new DomainError('lineup_incomplete','Deze vorm vereist een volledige opstelling.');
   slot.administrative={winner:a[0]?0:b[0]?1:null,reason:'Ontbrekende speler volgens gepubliceerd vier-singlesreglement'};slot.status='administrative';
  }else{delete slot.administrative;slot.status='scheduled';}
 }
}
export function seasonWindow(s:SeasonState,round:number,start?:string,end?:string):{windowStart:string;windowEnd:string}{
 const first=Date.parse(s.settings.startDate+'T00:00:00Z');
 // Dynamic fixtures are playable immediately after the published start date.
 const from=start??new Date(Math.max(first,Date.now())).toISOString(),to=end??new Date(Date.parse(from)+s.settings.windowDays*day).toISOString();
 if(!s.rounds.some(r=>r.number===round))s.rounds.push({number:round,startsAt:from,endsAt:to,released:!s.settings.roundGating});
 return {windowStart:from,windowEnd:to};
}
function singleFixture(s:SeasonState,homeId:string,awayId:string,round:number,window?:{windowStart:string;windowEnd:string}):SeasonFixture{
 return {id:randomUUID(),round,divisionId:s.participants.find(p=>p.id===homeId)?.divisionId??s.divisions[0].id,homeId,awayId,status:'scheduled',...(window??seasonWindow(s,round)),boardIds:[],slots:[{id:randomUUID(),index:0,players:[homeId,awayId],kind:'single',starter:0,status:'scheduled'}],lineups:{},confirmations:[],checkIns:[]};
}
export function refreshLadder(s:SeasonState,now=Date.now()):void{
 if(!s.ladder)return;
 for(const c of s.ladder.challenges){if(c.status==='pending'&&now>=Date.parse(c.answerBy)){c.status='expired';c.reason='Antwoordtermijn verlopen; wedstrijdleiding moet opvolgen.';}if(c.status==='accepted'&&c.playBy)c.overdue=now>=Date.parse(c.playBy);}
 const order=[...s.ladder.initialOrder];
 for(const c of [...s.ladder.challenges].filter(c=>c.fixtureId).sort((a,b)=>{const fa=s.fixtures.find(f=>f.id===a.fixtureId),fb=s.fixtures.find(f=>f.id===b.fixtureId);return (a.resolvedAt??fa?.confirmedAt??'9999').localeCompare(b.resolvedAt??fb?.confirmedAt??'9999')||a.id.localeCompare(b.id);})){const f=s.fixtures.find(f=>f.id===c.fixtureId);if(!f)continue;
  if(f.status!=='confirmed'||!f.slots[0]?.winnerId){if(c.status==='completed'){c.status='accepted';delete c.winnerId;}continue;}
  c.resolvedAt??=f.confirmedAt??new Date(now).toISOString();c.status='completed';c.winnerId=f.slots[0].winnerId;c.overdue=false;
  const own=order.indexOf(c.challengerId),other=order.indexOf(c.defenderId);
  if(c.winnerId===c.challengerId&&own>other&&other>=0){order.splice(own,1);order.splice(other,0,c.challengerId);}
 }
 s.ladder.order=order;
}
export function createLadderChallenge(s:SeasonState,actor:string,target:string,now=Date.now()):LadderChallenge{
 refreshLadder(s,now);if(s.format!=='ladder'||!s.ladder||!s.publishedAt||!['planned','active'].includes(s.status))throw new DomainError('ladder_closed','De ladder is nog niet gepubliceerd of gesloten.',409);
 const a=s.ladder.order.indexOf(actor),b=s.ladder.order.indexOf(target);
 if(a<0||b<0||a<=b||a-b>s.settings.ladderDistance)throw new DomainError('challenge_distance',`Daag maximaal ${s.settings.ladderDistance} plaatsen hoger uit.`,409);
 if([actor,target].some(id=>!s.participants.some(p=>p.id===id&&p.status==='active'&&p.available)))throw new DomainError('player_unavailable','Beide deelnemers moeten actief en beschikbaar zijn.',409);
 if(s.ladder.challenges.some(c=>['pending','accepted'].includes(c.status)&&[c.challengerId,c.defenderId].some(id=>[actor,target].includes(id))))throw new DomainError('challenge_open','Een speler heeft al een open uitdaging.',409);
 const c:LadderChallenge={id:randomUUID(),challengerId:actor,defenderId:target,status:'pending',createdAt:new Date(now).toISOString(),answerBy:new Date(now+s.settings.ladderAnswerHours*3_600_000).toISOString()};s.ladder.challenges.push(c);return c;
}
export function answerLadderChallenge(s:SeasonState,actor:string,id:string,accept:boolean,now=Date.now()):void{
 refreshLadder(s,now);const c=s.ladder?.challenges.find(c=>c.id===id);if(!c||c.defenderId!==actor)throw new DomainError('forbidden','Alleen de uitgedaagde speler kan antwoorden.',403);if(c.status!=='pending')throw new DomainError('challenge_closed','Deze uitdaging is al beantwoord of verlopen.',409);
 if(!accept){c.status='declined';c.reason='Uitdaging geweigerd; wedstrijdleiding moet opvolgen.';return;}
 c.status='accepted';c.playBy=new Date(now+s.settings.ladderPlayDays*day).toISOString();const round=s.rounds.length+1,window=seasonWindow(s,round,new Date(now).toISOString(),c.playBy),f=singleFixture(s,c.challengerId,c.defenderId,round,window);s.fixtures.push(f);c.fixtureId=f.id;
}
export function generateCup(s:SeasonState):void{
 if(s.format==='champions'&&!s.checkInClosedAt)throw new DomainError('check_in_open','Sluit eerst de gecontroleerde Champions-check-in.',409);
 const ids=s.participants.filter(p=>p.status==='active'&&(s.format!=='champions'||p.checkedIn)).map(p=>p.id);
 const seed=randomUUID(),seedOrder=drawTournamentPlayers(ids,seed);s.cup={fixtures:knockout(seedOrder),seedOrder,drawSeed:seed};
 for(let round=1;round<=Math.max(...s.cup.fixtures.map(f=>f.round));round++)seasonWindow(s,round);
 refreshCup(s);
}
/** The bracket and official fixture refer to one result identity; byes never become played scores. */
export function refreshCup(s:SeasonState):void{
 if(!s.cup)return;
 for(const f of s.fixtures){const graph=s.cup.fixtures.find(g=>g.id===f.bracketFixtureId);if(!graph)continue;const slot=f.slots[0];if(['confirmed','administrative'].includes(f.status)){const winner=f.administrative?f.administrative.score[0]===f.administrative.score[1]?null:f.administrative.score[0]>f.administrative.score[1]?f.homeId:f.awayId:slot?.winnerId??null;if(!winner)throw new DomainError('cup_draw','Een bekervak vereist een winnaar.',409);graph.status='confirmed';graph.winnerId=winner;graph.score=slot?.score;graph.matchId=slot?.matchId;graph.administrative=Boolean(f.administrative||slot?.administrative);}else{graph.status=slot?.matchId?'live':'scheduled';delete graph.winnerId;delete graph.score;}}
 advanceFixtures(s.cup.fixtures);
 for(const f of s.fixtures){const g=s.cup.fixtures.find(g=>g.id===f.bracketFixtureId);if(g&&g.players.some(id=>!id)&&!f.slots.some(slot=>slot.matchId)){f.status='canceled';f.slots[0].players=[null,null];}}
 for(const graph of s.cup.fixtures.filter(g=>g.status!=='bye'&&g.players.every(Boolean))){let f=s.fixtures.find(f=>f.bracketFixtureId===graph.id);if(f){if(!f.slots.some(slot=>slot.matchId)&&f.status!=='administrative'&&f.status!=='confirmed'){if(f.status==='canceled')f.status='scheduled';f.homeId=graph.players[0]!;f.awayId=graph.players[1]!;f.slots[0].players=[f.homeId,f.awayId];}continue;}f=singleFixture(s,graph.players[0]!,graph.players[1]!,graph.round);f.bracketFixtureId=graph.id;s.fixtures.push(f);}
}
export function assertCupCorrection(s:SeasonState,f:SeasonFixture):void{
 if(!s.cup||!f.bracketFixtureId)return;const affected=new Set([f.bracketFixtureId]);for(const graph of s.cup.fixtures)if(graph.sources?.some(source=>source.fixtureId&&affected.has(source.fixtureId)))affected.add(graph.id);
 if(s.fixtures.some(other=>other.id!==f.id&&other.bracketFixtureId&&affected.has(other.bracketFixtureId)&&other.slots.some(slot=>slot.matchId)))throw new DomainError('dependent_match_started','Een vervolgpartij is gestart. Handel eerst die afhankelijke uitslag af.',409);
}
export function cupPlacings(s:SeasonState):Map<string,number>{
 const result=new Map<string,number>();if(!s.cup)return result;const last=Math.max(...s.cup.fixtures.map(g=>g.round)),final=s.cup.fixtures.find(g=>g.round===last);if(final?.status!=='confirmed'||!final.winnerId)return result;
 result.set(final.winnerId,1);for(const g of s.cup.fixtures.filter(g=>g.status==='confirmed'&&g.winnerId))for(const id of g.players)if(id&&id!==g.winnerId)result.set(id,g.round===last?2:2**(last-g.round)+1);return result;
}
/** Instuif uses currently present entrants, most played first for a bye, then globally fewest rematches. */
export function pairDropInRound(s:SeasonState):void{
 if(s.format!=='drop-in'||!s.publishedAt||!['planned','active'].includes(s.status))throw new DomainError('drop_in_closed','Publiceer eerst de instuif.',409);
 if(s.fixtures.some(f=>!['confirmed','administrative','canceled'].includes(f.status)))throw new DomainError('round_pending','Rond de open partijen af vóór een nieuwe instuifronde.',409);
 const played=(id:string)=>s.fixtures.filter(f=>f.status==='confirmed'&&[f.homeId,f.awayId].includes(id)).length;
 let ids=s.participants.filter(p=>p.status==='active'&&p.checkedIn&&p.available).map(p=>p.id).sort((a,b)=>played(b)-played(a)||a.localeCompare(b));
 if(ids.length<2)throw new DomainError('insufficient_entries','Er zijn minimaal twee aanwezige spelers nodig.',409);
 const round=s.rounds.length+1;if(ids.length%2){const priorByes=new Map<string,number>();for(const d of s.decisions.filter(d=>d.action==='season.drop-in-bye')){const id=d.reason;priorByes.set(id,(priorByes.get(id)??0)+1);}const bye=[...ids].sort((a,b)=>(priorByes.get(a)??0)-(priorByes.get(b)??0)||played(b)-played(a)||a.localeCompare(b))[0];ids=ids.filter(id=>id!==bye);s.decisions.push({id:randomUUID(),actorId:s.ownerId,at:new Date().toISOString(),action:'season.drop-in-bye',reason:bye});}
 const edges:[number,number,number][]=[];for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++){const repeats=s.fixtures.filter(f=>f.status!=='canceled'&&[f.homeId,f.awayId].includes(ids[a])&&[f.homeId,f.awayId].includes(ids[b])).length;edges.push([a,b,1_000_000-repeats*1000-Math.abs(played(ids[a])-played(ids[b]))]);}
 const pairs=blossom(edges,true);for(let a=0;a<ids.length;a++){const b=pairs[a];if(b<=a)continue;const f=singleFixture(s,ids[a],ids[b],round);if(s.fixtures.some(g=>[g.homeId,g.awayId].includes(ids[a])&&[g.homeId,g.awayId].includes(ids[b])))f.pairingNotice='Herhaling binnen de aanwezige instuifgroep; eerdere ontmoetingen zijn meegewogen.';s.fixtures.push(f);}
}
