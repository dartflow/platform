import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advanceFixtures,tournamentFixtures} from '../lib/platform-domain';
import {drawTournamentPlayers,doubleEliminationFixtures,swissRoundFixtures,swissStandings,swissRoundLimit,nextSwissRound,tournamentOutcome,tournamentTable} from '../lib/tournament-formats';
import type {Fixture,PlatformState} from '../lib/platform-types';

const players=(count:number)=>Array.from({length:count},(_,index)=>`p${String(index+1).padStart(3,'0')}`);
function finish(item:Fixture,side=0):void {assert.ok(item.players.every(Boolean));item.status='confirmed';item.winnerId=item.players[side];item.score=side===0?[3,1]:[1,3];item.started=true;}
function playDouble(count:number,reset:boolean,loserWinsFinal:boolean):{fixtures:Fixture[];losses:Map<string,number>} {
  const fixtures=doubleEliminationFixtures(players(count),reset),losses=new Map<string,number>();
  for(let guard=0;guard<1000;guard++){
    advanceFixtures(fixtures);
    const next=fixtures.find(item=>item.status==='scheduled'&&item.players.every(Boolean));
    if(!next)break;
    const side=next.phase==='final'&&loserWinsFinal?1:0;
    const loser=next.players[1-side]!;losses.set(loser,(losses.get(loser)??0)+1);finish(next,side);
  }
  advanceFixtures(fixtures);return {fixtures,losses};
}

test('double elimination completes 2 through 33 and large 64 65 127 128 fields with the proper losses',()=>{
  for(const count of [...Array.from({length:32},(_,index)=>index+2),64,65,127,128])for(const reset of [true,false])for(const loserWinsFinal of [true,false]){
    const {fixtures,losses}=playDouble(count,reset,loserWinsFinal),outcome=tournamentOutcome(fixtures,reset?'double-elimination-reset':'double-elimination-single',players(count));
    assert.equal(outcome.completed,true,`complete ${count}/${reset}/${loserWinsFinal}`);
    assert.equal(new Set(outcome.placings.map(row=>row.playerId)).size,count);
    assert.ok(outcome.placings.every(row=>players(count).includes(row.playerId)));
    assert.equal(outcome.placings[0].position,1);assert.equal(outcome.placings[1].position,2);
    const runner=outcome.placings[1].playerId;
    for(const player of players(count)){
      const expected=player===outcome.championId?(loserWinsFinal?1:0):!reset&&player===runner&&loserWinsFinal?1:2;
      assert.equal(losses.get(player)??0,expected,`losses ${count}/${reset}/${loserWinsFinal}/${player}`);
    }
    const second=fixtures.find(item=>item.phase==='reset');
    if(reset)assert.equal(second?.status,loserWinsFinal?'confirmed':'void');
    else assert.equal(second,undefined);
    assert.ok(fixtures.every(item=>item.status==='confirmed'||item.status==='bye'||item.status==='void'));
  }
});

test('loser injections reverse each winners round and empty slots never produce a loser',()=>{
  const fixtures=doubleEliminationFixtures(players(8)),w2=fixtures.filter(item=>item.phase==='winners'&&item.round===2),l2=fixtures.filter(item=>item.phase==='losers'&&item.round===2);
  assert.deepEqual(l2.map(item=>item.sources?.[1]),[...w2].reverse().map(item=>({fixtureId:item.id,outcome:'loser'})));
  const partial=doubleEliminationFixtures(players(5));
  assert.equal(partial.filter(item=>item.phase==='winners'&&item.status==='bye').length,3);
  for(const bye of partial.filter(item=>item.status==='bye'))assert.equal(bye.score,undefined);
  const reverse=structuredClone(partial).reverse();advanceFixtures(reverse);
  assert.deepEqual(reverse.map(item=>[item.id,item.players,item.status]).sort(),partial.map(item=>[item.id,item.players,item.status]).sort());
});

test('active downstream match is never changed by source propagation',()=>{
  const fixtures=doubleEliminationFixtures(players(4));
  for(const item of fixtures.filter(item=>item.phase==='winners'&&item.round===1))finish(item);
  advanceFixtures(fixtures);const next=fixtures.find(item=>item.phase==='winners'&&item.round===2)!;
  next.matchId='active';const before=structuredClone(next);
  fixtures[0].winnerId=fixtures[0].players[1];advanceFixtures(fixtures);
  assert.deepEqual(next,before);
});
test('a drawn source blocks dependent bracket slots instead of manufacturing a bye winner',()=>{
  const fixtures=doubleEliminationFixtures(players(4)),opening=fixtures.filter(item=>item.phase==='winners'&&item.round===1);
  finish(opening[0]);finish(opening[1]);opening[0].winnerId=null;advanceFixtures(fixtures);
  const dependent=fixtures.find(item=>item.phase==='winners'&&item.round===2)!;
  assert.equal(dependent.status,'scheduled');assert.deepEqual(dependent.players,[null,null]);
  opening[0].winnerId='unrelated-player';assert.throws(()=>advanceFixtures(fixtures),{code:'invalid_bracket'});
});

test('seeded shuffle is stable, input preserving and refuses duplicate entrants',()=>{
  const original=players(19),copy=[...original];
  assert.deepEqual(drawTournamentPlayers(original,'fixed-a'),drawTournamentPlayers(copy,'fixed-a'));
  assert.notDeepEqual(drawTournamentPlayers(original,'fixed-a'),drawTournamentPlayers(copy,'fixed-b'));
  assert.deepEqual(original,copy);assert.equal(new Set(drawTournamentPlayers(original,'fixed-a')).size,19);
  assert.throws(()=>drawTournamentPlayers(['p1','p1'],'fixed'),{code:'invalid_players'});
});

test('nineteen entrants play five complete Swiss rounds with fair byes and no avoidable rematch',()=>{
  const entrants=players(19);let history:Fixture[]=[];
  for(let round=1;round<=5;round++){
    const next=swissRoundFixtures(entrants,history,round),real=next.filter(item=>item.status!=='bye'),bye=next.find(item=>item.status==='bye')!;
    assert.equal(real.length,9);assert.equal(next.length,10);
    assert.equal(new Set(next.flatMap(item=>item.players.filter(Boolean))).size,19);
    assert.equal(bye.score,undefined);
    const previous=swissStandings(history,entrants);assert.equal(previous.find(row=>row.id===bye.winnerId)!.byes,0);
    for(const item of real){assert.ok(!history.some(old=>old.players.includes(item.players[0])&&old.players.includes(item.players[1])));finish(item,(round+entrants.indexOf(item.players[0]!))%2);}
    history=[...history,...next];
  }
  const ranking=swissStandings(history,entrants);
  assert.equal(ranking.reduce((sum,row)=>sum+row.byes,0),5);
  assert.equal(ranking.reduce((sum,row)=>sum+row.played,0),90);
  assert.equal(ranking.reduce((sum,row)=>sum+row.points,0),100);
  assert.equal(tournamentOutcome(history,'swiss',entrants,5).completed,true);
});

function pairings(ids:string[]):string[][][] {
  if(!ids.length)return [[]];const [first,...rest]=ids;return rest.flatMap((other,index)=>pairings(rest.filter((_,i)=>i!==index)).map(tail=>[[first,other],...tail]));
}
function objective(candidate:string[][],previous:Fixture[],entrants:string[]):number[] {
  const ranking=swissStandings(previous,entrants),groups=new Map<number,string[]>();for(const row of ranking){const group=groups.get(row.points)??[];group.push(row.id);groups.set(row.points,group);}
  let repeated=0,points=0,distance=0;
  for(const [a,b] of candidate){repeated+=previous.filter(item=>item.players.includes(a)&&item.players.includes(b)).length;const x=ranking.find(row=>row.id===a)!,y=ranking.find(row=>row.id===b)!;points+=Math.abs(x.points-y.points);if(x.points===y.points){const group=groups.get(x.points)!;distance+=Math.abs(Math.abs(group.indexOf(a)-group.indexOf(b))-Math.ceil(group.length/2));}}
  return [repeated,points,distance,...candidate.map(pair=>pair.map(id=>entrants.indexOf(id)).sort((a,b)=>a-b)).sort(([a],[b])=>a-b).flat()];
}
const compare=(a:number[],b:number[])=>{for(let index=0;index<a.length;index++)if(a[index]!==b[index])return a[index]-b[index];return 0;};
test('weighted Swiss matching equals exhaustive lexicographic optimum including the final seed pair list',()=>{
  const entrants=players(8),history:Fixture[]=[];
  for(let round=1;round<=5;round++){
    const actual=swissRoundFixtures(entrants,history,round),expected=pairings(entrants).map(pairs=>objective(pairs,history,entrants)).sort(compare)[0];
    assert.deepEqual(objective(actual.map(item=>item.players as string[]),history,entrants),expected);
    for(const [index,item] of actual.entries())finish(item,(index+round)%2);history.push(...actual);
  }
});

test('unavoidable rematches are explicit, and a bye never has a fictitious opponent or legs',()=>{
  const entrants=players(3),history:Fixture[]=[];
  for(let round=1;round<=3;round++){const next=swissRoundFixtures(entrants,history,round);for(const item of next)if(item.status!=='bye')finish(item);history.push(...next);}
  assert.ok(swissStandings(history,entrants).every(row=>row.byes===1));
  assert.throws(()=>swissRoundFixtures(entrants,history,4),{code:'invalid_rounds'});
  const four=players(4),prior=swissRoundFixtures(four,[],1);for(const item of prior)finish(item);const second=swissRoundFixtures(four,prior,2);for(const item of second)finish(item);const third=swissRoundFixtures(four,[...prior,...second],3);
  assert.ok(third.every(item=>!item.pairingNotice));
  // Three complete cross-group rounds leave two odd triangles as the unused graph.
  // A perfect matching must therefore repeat exactly one cross-group encounter.
  const six=players(6),cross:Fixture[]=[];
  for(let round=1;round<=3;round++)for(let index=0;index<3;index++){
    const item:Fixture={id:`cross-${round}-${index}`,phase:'swiss',round,status:'scheduled',players:[six[index],six[3+(index+round-1)%3]]};finish(item);cross.push(item);
  }
  const forced=swissRoundFixtures(six,cross,4),repeats=forced.filter(item=>cross.some(old=>old.players.includes(item.players[0])&&old.players.includes(item.players[1])));
  assert.equal(repeats.length,1);assert.match(repeats[0].pairingNotice!,/Herhaling noodzakelijk/);
  const best=pairings(six).map(pairs=>objective(pairs,cross,six)).sort(compare)[0];
  assert.deepEqual(objective(forced.map(item=>item.players as string[]),cross,six),best);
});

test('round gate rejects active or duplicate round and next round enforces the frozen published count',()=>{
  const entrants=players(6),first=swissRoundFixtures(entrants,[],1);
  assert.throws(()=>swissRoundFixtures(entrants,first,2),{code:'round_incomplete'});
  first.forEach(item=>finish(item));assert.throws(()=>swissRoundFixtures(entrants,first,1),{code:'round_incomplete'});
  const state:PlatformState={name:'Swiss',format:'swiss',fixtures:first,tournamentRules:{algorithmVersion:'dartflow-tournament-v1',drawSeed:'fixed',seedOrder:entrants,swissRounds:2}};
  const added=nextSwissRound(state);assert.equal(added.length,3);added.forEach(item=>finish(item));
  assert.throws(()=>nextSwissRound(state),{code:'tournament_finished'});
  assert.throws(()=>nextSwissRound({...state,format:'double-elimination-reset'}),{code:'invalid_format'});
  const broken=structuredClone(first);broken[1].players[0]=broken[0].players[0];
  assert.throws(()=>swissRoundFixtures(entrants,broken,2),{code:'invalid_pairing_history'});
});

test('Swiss published round limits and all 128 entrants use a complete polynomial matching',()=>{
  assert.equal(swissRoundLimit(19),5);assert.equal(swissRoundLimit(4),2);assert.equal(swissRoundLimit(3,3),3);
  assert.throws(()=>swissRoundLimit(4,4),{code:'invalid_rounds'});
  const entrants=players(128),next=swissRoundFixtures(entrants,[],1);
  assert.equal(next.length,64);assert.equal(new Set(next.flatMap(item=>item.players)).size,128);
  assert.equal(tournamentFixtures(players(5),'double-elimination-single').some(item=>item.phase==='reset'),false);
  assert.equal(tournamentFixtures(players(19),'swiss',2,{swissRounds:5}).length,10);
});

test('Swiss administrative result awards only table points and tied leaders retain shared sporting rank',()=>{
  const entrants=players(4),next=swissRoundFixtures(entrants,[],1);next.forEach(item=>finish(item));next[0].administrative=true;
  const rows=swissStandings(next,entrants),winner=rows.find(row=>row.id===next[0].winnerId)!;
  assert.equal(winner.points,2);assert.equal(winner.played,0);assert.equal(winner.legsFor,0);assert.deepEqual(winner.opponents,[]);
  const drawn=swissRoundFixtures(entrants,[],1);for(const item of drawn){finish(item);item.winnerId=null;item.score=[2,2];}
  const outcome=tournamentOutcome(drawn,'swiss',entrants,1);assert.equal(outcome.completed,true);assert.equal(outcome.championId,null);assert.ok(outcome.placings.every(row=>row.position===1));
});
test('every projection retains Swiss table points and DE final places without invented league points',()=>{
 const entrants=players(5),first=swissRoundFixtures(entrants,[],1);for(const item of first)if(item.status!=='bye')finish(item);
 const table=tournamentTable(first,'swiss',entrants,2)!;
 assert.deepEqual(table,swissStandings(first,entrants));assert.equal(table.find(row=>row.id===first.find(item=>item.status==='bye')!.winnerId)!.points,2);
 const {fixtures}=playDouble(5,true,true),elimination=tournamentTable(fixtures,'double-elimination-reset',entrants)!;
 assert.equal(elimination.length,5);assert.equal(elimination[0].position,1);assert.equal(elimination[1].position,2);assert.ok(elimination.every(row=>row.points===null));
 assert.equal(tournamentTable([], 'knockout',entrants),null);
});
