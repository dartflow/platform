import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildOcheScorecard, ocheScorecardScroll, ochePlayerInitials, type OcheScorecardMatch} from '../lib/oche-scorecard';
import type {Visit} from '../lib/types';
const visit = (playerIndex:number, score:number, remainingBefore:number, remainingAfter=remainingBefore-score, leg=1, bust=false):Visit => ({player:`p${playerIndex}`,playerIndex,score,darts:3,remainingBefore,remainingAfter,leg,bust,checkout:remainingAfter===0});
const match = (visits:Visit[] = [], changes:Partial<OcheScorecardMatch> = {}):OcheScorecardMatch => ({id:'match-a',revision:0,status:'live',players:[{id:'p0',name:'Danny'},{id:'p1',name:'Rick'}],remaining:[148,188],legs:[0,0],sets:[0,0],turn:0,visits,settings:{startScore:501,bestOfLegs:3,bestOfSets:1},legNumber:1,setNumber:1,...changes});

test('scorecard pairs each player first throw in the first row and mirrors the two independent columns',()=>{
 const visits=[visit(0,85,501),visit(1,45,501),visit(0,100,416),visit(1,100,456)];
 const card=buildOcheScorecard(match(visits));
 assert.equal(card.rows.length,5);assert.deepEqual(card.rows[0].cells.map(cell=>[cell.visit?.score,cell.visit?.remainingAfter]),[[85,416],[45,456]]);
 assert.deepEqual(card.rows[1].cells.map(cell=>[cell.visit?.score,cell.visit?.remainingAfter]),[[100,316],[100,356]]);
 assert.ok(card.rows.slice(2).every(row=>row.cells.every(cell=>cell.visit===null)));
 assert.equal(card.rows[0].cells[0].latest,false);assert.equal(card.rows[1].cells[0].latest,true);assert.equal(card.rows[1].cells[1].latest,true);
});

test('canonical current-leg visits and start score exclude equally numbered legs in previous sets',()=>{
 const old=visit(0,180,501),current=visit(1,60,301);
 const card=buildOcheScorecard(match([old,current],{setNumber:2,currentLegVisits:[current],currentLegStartScore:301}),'source');
 assert.equal(card.startScore,301);assert.equal(card.visitCount,1);assert.equal(card.rows[0].cells[0].visit,null);assert.equal(card.rows[0].cells[1].visit?.remainingAfter,241);assert.equal(card.legKey,'source:2:1');
});

test('the accepted 60 from 148 becomes 88 in the same left row while the right rest remains 188',()=>{
 const before=buildOcheScorecard(match([visit(0,50,198),visit(1,48,236)]));
 const after=buildOcheScorecard(match([visit(0,50,198),visit(1,48,236),visit(0,60,148)],{revision:1,remaining:[88,188],turn:1}));
 assert.equal(before.rows[0].cells[0].visit?.remainingAfter,148);assert.equal(after.rows[1].cells[0].visit?.score,60);assert.equal(after.rows[1].cells[0].visit?.remainingAfter,88);
 assert.equal(after.rows[0].cells[1].visit?.remainingAfter,188);assert.equal(after.rows[1].cells[1].visit,null);assert.equal(ocheScorecardScroll(before,after),'reveal');
});

test('bust remains an accepted throw with the unchanged remaining score and solo has one pair',()=>{
 const card=buildOcheScorecard(match([visit(0,180,60,60,1,true)],{players:[{id:'p0',name:'Solo'}],remaining:[60],legs:[0],sets:[0]}));
 assert.equal(card.columns.length,1);assert.equal(card.rows[0].cells.length,1);assert.equal(card.rows[0].cells[0].visit?.bust,true);assert.equal(card.rows[0].cells[0].visit?.remainingAfter,60);assert.equal(card.visitCount,1);
});

test('more than five turns add data rows without inventing the other player cells',()=>{
 const visits=Array.from({length:8},()=>visit(0,0,501));
 const card=buildOcheScorecard(match(visits));assert.equal(card.rows.length,8);assert.equal(card.filledRows,8);assert.ok(card.rows.every(row=>row.cells[1].visit===null));assert.equal(card.rows[7].cells[0].latest,true);
});

test('identical polls, non-scoring revisions, undo and offline recovery preserve manual scroll position',()=>{
 const visits=[visit(0,60,501)];const before=buildOcheScorecard(match(visits));
 assert.equal(ocheScorecardScroll(before,buildOcheScorecard(match(visits,{revision:10}))),'keep');
 assert.equal(ocheScorecardScroll(before,buildOcheScorecard(match([],{revision:11}))),'keep');
 assert.equal(ocheScorecardScroll(before,buildOcheScorecard(match([...visits,visit(1,60,501)],{revision:12})),false),'keep');
 const undone=buildOcheScorecard(match(visits,{revision:13}),undefined,[{id:'undo-13',revision:13,kind:'undo'}]);assert.equal(ocheScorecardScroll(before,undone),'keep');
});

test('a fresh accepted score after an undo can reveal its replacement row even with an unchanged visit count',()=>{
 const before=buildOcheScorecard(match([visit(0,60,501)],{revision:1}),undefined,[{id:'score-1',revision:1,kind:'score',score:60}]);
 const next=buildOcheScorecard(match([visit(0,100,501)],{revision:3}),undefined,[{id:'undo-2',revision:2,kind:'undo'},{id:'score-3',revision:3,kind:'score',score:100}]);
 assert.equal(ocheScorecardScroll(before,next),'reveal');assert.equal(ocheScorecardScroll(next,next),'keep');
});

test('new leg, new set and new match reset the card identity and show a fresh canonical start row',()=>{
 const before=buildOcheScorecard(match([visit(0,180,501)]),'session-a');
 for(const next of [buildOcheScorecard(match([],{legNumber:2,currentLegVisits:[]}),'session-a'),buildOcheScorecard(match([],{setNumber:2,currentLegVisits:[]}),'session-a'),buildOcheScorecard(match([]),'session-b')]){assert.notEqual(next.legKey,before.legKey);assert.equal(ocheScorecardScroll(before,next),'reset');assert.equal(next.startScore,501);assert.equal(next.visitCount,0);assert.equal(next.rows.length,5);}
});

test('display initials use two username letters or two name initials without changing the saved name',()=>{
 assert.equal(ochePlayerInitials('Danny'),'DA');assert.equal(ochePlayerInitials('Rick'),'RI');assert.equal(ochePlayerInitials('  Danny Goldenbelt  '),'DG');assert.equal(ochePlayerInitials('Éva'),'ÉV');assert.equal(ochePlayerInitials('Q'),'Q');
});
