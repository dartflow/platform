import {createHash, randomUUID} from 'node:crypto';
import blossom from 'edmonds-blossom';
import {DomainError} from './domain';
import type {Fixture,FixtureSource,PlatformState} from './platform-types';

export const TOURNAMENT_ALGORITHM_VERSION='dartflow-tournament-v1';
export const EXTENDED_TOURNAMENT_FORMATS=['swiss','double-elimination-reset','double-elimination-single'] as const;
const terminal=(fixture:Fixture)=>['confirmed','bye','void'].includes(fixture.status);
function validatePlayers(players:string[]):void {
  if(players.length<2||players.length>128||new Set(players).size!==players.length||players.some(player=>!player))throw new DomainError('invalid_players','Kies twee tot 128 unieke spelers.');
}
/** Uniform Fisher–Yates, replayable from the frozen input and published draw seed. */
export function drawTournamentPlayers(players:string[],seed:string):string[] {
  validatePlayers(players);
  if(typeof seed!=='string'||!seed.length||seed.length>128)throw new DomainError('invalid_seed','De loting vereist een geldige vaste lotingswaarde.');
  let counter=0;
  const random=()=>createHash('sha256').update(`${TOURNAMENT_ALGORITHM_VERSION}:${seed}:${counter++}`).digest().readUInt32BE(0);
  const result=[...players];
  for(let index=result.length-1;index>0;index--){const bound=index+1,limit=Math.floor(0x1_0000_0000/bound)*bound;let value=random();while(value>=limit)value=random();const target=value%bound;[result[index],result[target]]=[result[target],result[index]];}
  return result;
}
function seededSlots(size:number):number[]{let seeds=[1,2];while(seeds.length<size){const capacity=seeds.length*2;seeds=seeds.flatMap(seed=>[seed,capacity+1-seed]);}return seeds;}
const source=(fixture:Fixture,outcome:'winner'|'loser'='winner'):FixtureSource=>({fixtureId:fixture.id,outcome});
function fixture(phase:Fixture['phase'],round:number,sources?:FixtureSource[],players:(string|null)[]=[null,null]):Fixture{return {id:randomUUID(),phase,round,players,status:'scheduled',...(sources?{sources}:{})};}

/** Fixed winners/losers graph, including empty slots; no invented loss from a bye. */
export function doubleEliminationFixtures(players:string[],reset=true):Fixture[] {
  validatePlayers(players);
  let size=2;while(size<players.length)size*=2;
  const slots=seededSlots(size).map(seed=>players[seed-1]??null),all:Fixture[]=[],winners:Fixture[][]=[];
  for(let count=size/2,round=1;count>=1;count/=2,round++){
    const previous=winners.at(-1),current:Fixture[]=[];
    for(let index=0;index<count;index++){const next=previous?fixture('winners',round,previous.slice(index*2,index*2+2).map(f=>source(f))):fixture('winners',round,undefined,slots.slice(index*2,index*2+2));current.push(next);all.push(next);}
    winners.push(current);
  }
  let loserFinalist:FixtureSource;
  if(size===2)loserFinalist=source(winners[0][0],'loser');
  else {
    let survivors:FixtureSource[]=[];let round=1;
    for(let index=0;index<winners[0].length;index+=2){const next=fixture('losers',round,winners[0].slice(index,index+2).map(f=>source(f,'loser')));all.push(next);survivors.push(source(next));}
    for(let index=1;index<winners.length;index++){
      const incoming=[...winners[index]].reverse().map(f=>source(f,'loser'));round++;
      survivors=survivors.map((survivor,slot)=>{const next=fixture('losers',round,[survivor,incoming[slot]]);all.push(next);return source(next);});
      if(index<winners.length-1){round++;const compressed:FixtureSource[]=[];for(let slot=0;slot<survivors.length;slot+=2){const next=fixture('losers',round,survivors.slice(slot,slot+2));all.push(next);compressed.push(source(next));}survivors=compressed;}
    }
    loserFinalist=survivors[0];
  }
  const final=fixture('final',1,[source(winners.at(-1)![0]),loserFinalist]);all.push(final);
  if(reset)all.push({...fixture('reset',2),resetOf:final.id});
  advanceTournamentFixtures(all);
  return all;
}
function losingPlayer(fixture:Fixture):string|null {
  return fixture.status==='confirmed'&&fixture.winnerId&&fixture.players.filter(Boolean).length===2?fixture.players.find(player=>player!==fixture.winnerId)??null:null;
}
/** Resolve in topological passes because old and new snapshots may use different array orders. */
export function advanceTournamentFixtures(fixtures:Fixture[]):void {
  for(let pass=0;pass<=fixtures.length;pass++){
    let changed=false;
    for(const target of fixtures){
      if(target.matchId||target.status==='confirmed')continue;
      let ready=true,next:(string|null)[]|undefined;
      if(target.resetOf){
        const final=fixtures.find(item=>item.id===target.resetOf);
        if(!final||!terminal(final))continue;
        if(final.status==='confirmed'&&final.winnerId===final.players[1]&&final.players.every(Boolean))next=[...final.players];
        else {if(target.status!=='void'){target.status='void';target.players=[null,null];target.winnerId=null;changed=true;}continue;}
      }else if(target.sources?.length&&target.sources.every(item=>item.fixtureId)){
        next=target.sources.map(input=>{const parent=fixtures.find(item=>item.id===input.fixtureId);if(!parent||!terminal(parent)||parent.status==='confirmed'&&!parent.winnerId&&parent.players.every(Boolean)){ready=false;return null;}if(parent.winnerId&&!parent.players.includes(parent.winnerId))throw new DomainError('invalid_bracket','Een bronwinnaar hoort niet bij de betreffende partij.',409);return input.outcome==='loser'?(input.playedOnly&&(!parent.started||parent.administrative)?null:losingPlayer(parent)):parent.winnerId??null;});
      }else if(target.phase==='winners'&&!target.sources)next=[...target.players];
      if(!ready||!next)continue;
      if(next[0]&&next[0]===next[1])throw new DomainError('invalid_bracket','Een speler kan niet tegen zichzelf worden geplaatst.',409);
      const actual=next.filter((player):player is string=>Boolean(player)),status=actual.length<2?'bye':'scheduled';
      if(JSON.stringify(next)!==JSON.stringify(target.players)||status!==target.status){target.players=next;target.status=status;target.winnerId=status==='bye'?actual[0]??null:undefined;changed=true;}
    }
    if(!changed)return;
  }
  throw new DomainError('invalid_bracket','De bracketverwijzingen kunnen niet worden opgelost.',409);
}

export type SwissStanding={id:string;seed:number;position:number;shared:boolean;played:number;won:number;drawn:number;points:number;buchholz:number;legsFor:number;legsAgainst:number;byes:number;opponents:string[]};
/** A bye is two table points and no invented legs, opponent or played match. */
export function swissStandings(fixtures:Fixture[],players:string[]):SwissStanding[] {
  const rows=players.map((id,seed)=>({id,seed,position:0,shared:false,played:0,won:0,drawn:0,points:0,buchholz:0,legsFor:0,legsAgainst:0,byes:0,opponents:[] as string[]}));
  for(const item of fixtures.filter(item=>item.phase==='swiss')){
    if(item.status==='bye'){const player=rows.find(row=>row.id===item.winnerId);if(player){player.points+=2;player.byes++;}continue;}
    if(item.status!=='confirmed'&&item.started!==true)continue;
    const real=item.administrative!==true&&(item.started===true||Array.isArray(item.score));
    item.players.forEach((id,index)=>{const row=rows.find(row=>row.id===id),other=item.players[1-index];if(!row||!other)return;if(real)row.opponents.push(other);if(item.status!=='confirmed')return;row.played+=+real;if(item.winnerId===id){row.points+=2;row.won++;}else if(item.winnerId===null){row.points++;row.drawn++;}if(real){row.legsFor+=item.score?.[index]??0;row.legsAgainst+=item.score?.[1-index]??0;}});
  }
  for(const row of rows)row.buchholz=row.opponents.reduce((sum,id)=>sum+(rows.find(other=>other.id===id)?.points??0),0);
  const sporting=(a:SwissStanding,b:SwissStanding)=>b.points-a.points||b.buchholz-a.buchholz||(b.legsFor-b.legsAgainst)-(a.legsFor-a.legsAgainst)||b.legsFor-a.legsFor;
  rows.sort((a,b)=>sporting(a,b)||a.seed-b.seed);
  rows.forEach((row,index)=>{row.shared=index>0&&sporting(rows[index-1],row)===0;row.position=row.shared?rows[index-1].position:index+1;if(row.shared)rows[index-1].shared=true;});
  return rows;
}
export function swissRoundLimit(playerCount:number,requested?:number):number {
  const maximum=playerCount%2?playerCount:playerCount-1;
  const rounds=requested??Math.min(maximum,Math.ceil(Math.log2(playerCount)));
  if(!Number.isInteger(rounds)||rounds<1||rounds>maximum)throw new DomainError('invalid_rounds',`Kies één tot ${maximum} Zwitserse ronden.`);
  return rounds;
}
/** Match all vertices. Integer bounds keep all three sporting objectives exact below 2^53. */
function minimumMatching(vertices:number[],cost:(a:number,b:number)=>number):[number,number][] {
  if(!vertices.length)return [];
  const edges:[number,number,number][]=[],costs:number[]=[];
  for(let a=0;a<vertices.length;a++)for(let b=a+1;b<vertices.length;b++){const value=cost(vertices[a],vertices[b]);if(!Number.isSafeInteger(value)||value<0)throw new DomainError('invalid_pairing','De koppelgewichten overschrijden de exacte rekenruimte.',409);edges.push([a,b,value]);costs.push(value);}
  const maximum=Math.max(...costs)+1,matched=blossom(edges.map(([a,b,value])=>[a,b,maximum-value]),true),pairs:[number,number][]=[];
  if(matched.length!==vertices.length||matched.some((other,index)=>!Number.isInteger(other)||other<0||other===index||matched[other]!==index))throw new DomainError('pairing_failed','Geen volledige geldige koppeling gevonden.',409);
  for(let index=0;index<matched.length;index++)if(index<matched[index])pairs.push([vertices[index],vertices[matched[index]]]);
  return pairs;
}
/** Exact weighted blossom; a second bounded sequence fixes the final seed-lexicographic tie. */
export function swissRoundFixtures(players:string[],previous:Fixture[],round:number):Fixture[] {
  validatePlayers(players);
  if(!Number.isInteger(round)||round<1||round>(players.length%2?players.length:players.length-1))throw new DomainError('invalid_rounds','Ongeldige Zwitserse ronde.');
  const prior=previous.filter(item=>item.phase==='swiss');
  if(prior.some(item=>item.round>=round)||round>1&&(!prior.length||Math.max(...prior.map(item=>item.round))!==round-1||prior.some(item=>!terminal(item))))throw new DomainError('round_incomplete','Rond eerst alle partijen van de vorige ronde definitief af.',409);
  for(let number=1;number<round;number++){
    const batch=prior.filter(item=>item.round===number),assigned=batch.flatMap(item=>item.players.filter((id):id is string=>id!==null));
    if(assigned.length!==players.length||new Set(assigned).size!==players.length||assigned.some(id=>!players.includes(id))||batch.some(item=>item.players.length!==2||item.status==='void'||item.status==='bye'&&item.players.filter(Boolean).length!==1||item.status!=='bye'&&item.players.some(id=>id===null)))throw new DomainError('invalid_pairing_history','De vorige ronde bevat geen volledige, unieke spelersindeling.',409);
  }
  const ranking=swissStandings(prior,players),bye=players.length%2?[...ranking].sort((a,b)=>a.byes-b.byes||ranking.indexOf(b)-ranking.indexOf(a))[0]:null;
  const active=players.map((_,index)=>index).filter(index=>players[index]!==bye?.id),rankById=new Map(ranking.map(row=>[row.id,row]));
  const groups=new Map<number,SwissStanding[]>();for(const row of ranking.filter(row=>row.id!==bye?.id)){const group=groups.get(row.points)??[];group.push(row);groups.set(row.points,group);}
  const meetings=(a:number,b:number)=>prior.filter(item=>item.players.includes(players[a])&&item.players.includes(players[b])).length;
  const distance=(a:number,b:number)=>{const x=rankById.get(players[a])!,y=rankById.get(players[b])!;if(x.points!==y.points)return 0;const group=groups.get(x.points)!;return Math.abs(Math.abs(group.indexOf(x)-group.indexOf(y))-Math.ceil(group.length/2));};
  const pairs=active.length/2,distanceBound=pairs*players.length+1,pointsBound=pairs*Math.max(0,...ranking.map(row=>row.points))+1;
  const cost=(a:number,b:number)=>meetings(a,b)*pointsBound*distanceBound+Math.abs(rankById.get(players[a])!.points-rankById.get(players[b])!.points)*distanceBound+distance(a,b);
  // The smallest remaining seed is always the next first element in a sorted pair list.
  // Only its own edge receives the final tie term; n+1 dominates every possible term.
  const chosen:[number,number][]=[];let remaining=[...active];
  while(remaining.length){const first=remaining[0],solution=minimumMatching(remaining,(a,b)=>cost(a,b)*(players.length+1)+(a===first?b:b===first?a:0)),pair=solution.find(([a,b])=>a===first||b===first)!;chosen.push(pair[0]===first?pair:[pair[1],pair[0]]);remaining=remaining.filter(index=>!pair.includes(index));}
  const repeated=chosen.reduce((sum,[a,b])=>sum+meetings(a,b),0);
  const result=chosen.map(([a,b])=>({...fixture('swiss',round,undefined,[players[a],players[b]]),...(meetings(a,b)>0?{pairingNotice:`Herhaling noodzakelijk: elke volledige indeling vereist eerdere ontmoetingen. Deze ronde bevat ${repeated} eerdere ontmoeting${repeated===1?'':'en'}.`}:{})}));
  if(bye)result.push({...fixture('swiss',round,undefined,[bye.id,null]),status:'bye',winnerId:bye.id,pairingNotice:'Twee tabelpunten zonder wedstrijd, legs of rating: minste eerdere byes en daarbinnen de laagst gerangschikte speler.'});
  return result;
}
/** Explicit manager transition; frozen round count and seed order survive retries/reconnects. */
export function nextSwissRound(state:PlatformState):Fixture[] {
  if(state.format!=='swiss'||!state.tournamentRules?.seedOrder.length)throw new DomainError('invalid_format','Deze actie vereist een vastgelegde Zwitserse loting.',409);
  const fixtures=state.fixtures??[],round=Math.max(0,...fixtures.map(item=>item.round))+1,players=state.tournamentRules.seedOrder,limit=swissRoundLimit(players.length,state.tournamentRules.swissRounds??state.swissRounds);
  if(round>limit)throw new DomainError('tournament_finished','Alle gepubliceerde Zwitserse ronden zijn gespeeld.',409);
  const added=swissRoundFixtures(players,fixtures,round);state.fixtures=[...fixtures,...added];return added;
}

export function tournamentOutcome(fixtures:Fixture[],format:string,players:string[],swissRounds?:number):{completed:boolean;championId:string|null;placings:{playerId:string;position:number}[];standings?:SwissStanding[]} {
  if(format==='swiss'){
    const ranking=swissStandings(fixtures,players),complete=fixtures.length>0&&Math.max(...fixtures.map(item=>item.round))===swissRoundLimit(players.length,swissRounds)&&fixtures.every(terminal);
    return {completed:complete,championId:complete&&ranking[0]&&!ranking[0].shared?ranking[0].id:null,placings:complete?ranking.map(row=>({playerId:row.id,position:row.position})):[],standings:ranking};
  }
  const final=fixtures.find(item=>item.phase==='final'),reset=fixtures.find(item=>item.phase==='reset');
  if(!final)return {completed:false,championId:null,placings:[]};
  const decisive=reset&&reset.status!=='void'?reset:final;
  if(decisive.status!=='confirmed'||!decisive.winnerId)return {completed:false,championId:null,placings:[]};
  const placings=[{playerId:decisive.winnerId,position:1}],runner=losingPlayer(decisive);if(runner)placings.push({playerId:runner,position:2});
  const eliminated=new Map<number,string[]>();for(const item of fixtures.filter(item=>item.phase==='losers'&&item.status==='confirmed')){const id=losingPlayer(item);if(!id||placings.some(row=>row.playerId===id))continue;const group=eliminated.get(item.round)??[];if(!group.includes(id))group.push(id);eliminated.set(item.round,group);}
  let position=placings.length+1;for(const [,ids] of [...eliminated].sort(([a],[b])=>b-a)){for(const id of ids)placings.push({playerId:id,position});position+=ids.length;}
  return {completed:true,championId:decisive.winnerId,placings};
}

/** One read model for directory, participant overview and public cast. KO has places, no table points. */
export function tournamentTable(fixtures:Fixture[],format:string,players:string[],swissRounds?:number):{id:string;position:number;shared:boolean;played:number;won:number;drawn:number;points:number|null;legsFor:number;legsAgainst:number;buchholz?:number;byes?:number}[]|null {
  if(!EXTENDED_TOURNAMENT_FORMATS.includes(format as typeof EXTENDED_TOURNAMENT_FORMATS[number]))return null;
  const outcome=tournamentOutcome(fixtures,format,players,swissRounds);
  if(outcome.standings)return outcome.standings;
  return outcome.placings.map(placing=>{
    const played=fixtures.filter(item=>item.status==='confirmed'&&item.administrative!==true&&(item.started===true||Array.isArray(item.score))&&item.players.includes(placing.playerId));
    return {id:placing.playerId,position:placing.position,shared:outcome.placings.some(other=>other.playerId!==placing.playerId&&other.position===placing.position),played:played.length,won:played.filter(item=>item.winnerId===placing.playerId).length,drawn:played.filter(item=>item.winnerId===null).length,points:null,legsFor:played.reduce((sum,item)=>sum+(item.score?.[item.players.indexOf(placing.playerId)]??0),0),legsAgainst:played.reduce((sum,item)=>sum+(item.score?.[1-item.players.indexOf(placing.playerId)]??0),0)};
  });
}
