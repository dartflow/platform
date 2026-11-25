import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bingoCardFromCode,createBingoCard,finishAdvice,finishRoutes,legSourceEligibility,markLegSourceStatus,newPlayState,normalizePlayRules,playDoubleAccuracy,restartPlayAttempt,scorePlayVisit,undoPlayVisit} from '../lib/play-rules';
import type {PlayLegSource,PlaySide,PlayState} from '../lib/play-types';

const solo:PlaySide[]=[{id:'a',playerIds:['alice']}],pair:PlaySide[]=[...solo,{id:'b',playerIds:['bob']}];
const game=(rules:Record<string,unknown>,sides=solo)=>newPlayState('session',sides,normalizePlayRules(rules));
const hit=(state:PlayState,...dartHits:string[])=>scorePlayVisit(state,{dartHits});
const progress=<M extends PlayState['progress']['mode']>(state:PlayState,mode:M)=>{assert.equal(state.progress.mode,mode);return state.progress as Extract<PlayState['progress'],{mode:M}>;};

test('versioned defaults pin 301 double-in, 501/701 open-in and the two distinct Tactics presets',()=>{
 for(const startScore of [301,501,701])assert.deepEqual(normalizePlayRules({mode:'x01',startScore}),{version:1,mode:'x01',startScore,inRule:startScore===301?'double':'single',outRule:'double',bestOfLegs:1,bestOfSets:1});
 assert.equal(normalizePlayRules({mode:'tactics'}).mode,'tactics');
 const five=normalizePlayRules({mode:'tactics'}),three=normalizePlayRules({mode:'tactics',preset:'tactics-3'});
 assert.equal(five.mode==='tactics'&&five.requiredMarks,5);assert.equal(five.mode==='tactics'&&five.tieRule,'replay');
 assert.equal(three.mode==='tactics'&&three.requiredMarks,3);assert.equal(three.mode==='tactics'&&three.tieRule,'first-closed');
 assert.throws(()=>normalizePlayRules({mode:'tactics',version:2}),{code:'unsupported_rule_version'});
 assert.throws(()=>normalizePlayRules({mode:'unknown'}),{code:'invalid_rules'});
});
test('301 exact S20/D16/T20 opening, effective points, quick total after opening, and undo restore opening',()=>{
 const initial=game({mode:'x01',startScore:301}),opened=hit(initial,'S20','D16','T20');
 assert.deepEqual(progress(opened,'x01').remaining,[209]);assert.deepEqual(progress(opened,'x01').opened,[true]);assert.equal(opened.visits[0].score,92);assert.equal(opened.visits[0].observedScore,112);
 assert.deepEqual(progress(initial,'x01').opened,[false]);assert.deepEqual(undoPlayVisit(opened),initial);
 const quick=scorePlayVisit(opened,{score:60});assert.deepEqual(progress(quick,'x01').remaining,[149]);assert.equal(quick.visits.at(-1)?.actualDarts,null);
 assert.throws(()=>scorePlayVisit(initial,{score:60}),{code:'dart_detail_required'});
});
test('X01 real ending dart, bust, impossible totals, explicit checkout darts and undo of finished leg',()=>{
 let state=game({mode:'x01',startScore:301,inRule:'single'});
 state=scorePlayVisit(state,{score:180});state=scorePlayVisit(state,{score:81});assert.deepEqual(progress(state,'x01').remaining,[40]);
 assert.throws(()=>scorePlayVisit(state,{score:179}),{code:'invalid_total'});
 assert.throws(()=>scorePlayVisit(state,{score:40,doubleConfirmed:true}),{code:'checkout_darts_required'});
 assert.throws(()=>scorePlayVisit(state,{score:40,darts:1}),{code:'checkout_confirmation_required'});
 const bust=hit(state,'S20','S20');assert.deepEqual(progress(bust,'x01').remaining,[40]);assert.equal(bust.visits.at(-1)?.bust,true);assert.equal(bust.visits.at(-1)?.actualDarts,2);assert.equal(bust.visits.at(-1)?.countingDarts,3);
 const won=hit(state,'D20');assert.equal(won.status,'finished');assert.equal(won.visits.at(-1)?.actualDarts,1);assert.deepEqual(undoPlayVisit(won),state);
 const bull=game({mode:'x01',startScore:301});assert.deepEqual(progress(hit(bull,'SB','DB','S1'),'x01').remaining,[250]);
});
test('series retain per-leg opening reset, set counts and accepted undo across a leg boundary',()=>{
 let state=game({mode:'x01',startScore:301,inRule:'single',bestOfLegs:3,bestOfSets:3});
 for(let leg=0;leg<4;leg++){state=hit(state,'T20','T20','T20');state=hit(state,'T20','T11','D14');}
 assert.equal(state.status,'finished');assert.deepEqual(state.sets,[2]);assert.equal(state.attempts.length,4);
 const undone=undoPlayVisit(state);assert.equal(undone.status,'live');assert.deepEqual(progress(undone,'x01').remaining,[121]);
});
test('Cricket and Tactics preserve overshoot within one dart and stop counting a globally closed target',()=>{
 let cricket=game({mode:'cricket'},pair);cricket=hit(cricket,'D20');cricket=hit(cricket,'MISS');cricket=hit(cricket,'T20');
 assert.equal(progress(cricket,'cricket').marks[0][0],3);assert.equal(progress(cricket,'cricket').points[0],40);assert.equal(cricket.visits.at(-1)?.actualDarts,1);
 cricket=hit(cricket,'T20');cricket=hit(cricket,'T20');assert.equal(progress(cricket,'cricket').points[0],40);
 let tactics=game({mode:'tactics'},pair);tactics=hit(tactics,'D20','D20');tactics=hit(tactics,'MISS');tactics=hit(tactics,'T20');
 assert.equal(progress(tactics,'tactics').marks[0][0],5);assert.equal(progress(tactics,'tactics').points[0],40);assert.deepEqual(undoPlayVisit(tactics).progress,progress(hit(game({mode:'tactics'},pair),'D20','D20'),'tactics'));
});
test('Tactics 5 tied complete field requires a recorded replay without awarding a leg',()=>{
 let state=game({mode:'tactics'},pair);
 for(let n=20;n>=10;n--){state=hit(state,'T'+n,'D'+n);state=hit(state,'T'+n,'D'+n);}
 state=hit(state,'DB','DB','SB');assert.equal(state.status,'live');state=hit(state,'DB','DB','SB');
 assert.equal(state.status,'replay-required');assert.deepEqual(state.legs,[0,0]);assert.deepEqual(state.sets,[0,0]);assert.equal(state.result,null);
 assert.throws(()=>hit(state,'MISS'),{code:'not_live'});
 const restarted=restartPlayAttempt(state);assert.equal(restarted.status,'live');assert.equal(restarted.turn,1);assert.equal(restarted.attempts[0].status,'replayed');assert.equal(restarted.attempts[0].winnerSideId,null);assert.equal(restarted.attempt,2);
 assert.deepEqual(undoPlayVisit(restarted),state);assert.throws(()=>restartPlayAttempt(restarted),{code:'replay_unavailable'});
});
test('Tactics 3 and no-points Tactics 5 use first valid closure instead of a replay',()=>{
 for(const rules of [{mode:'tactics',preset:'tactics-3'},{mode:'tactics',points:false}]){
  let state=game(rules);const required=progress(state,'tactics').requiredMarks;
  for(let n=20;n>=10;n--)state=required===3?hit(state,'T'+n):hit(state,'T'+n,'D'+n);
  state=required===3?hit(state,'DB','SB'):hit(state,'DB','DB','SB');assert.equal(state.status,'finished');assert.equal(state.attempts[0].status,'won');
 }
});
test('Around the Clock advances three distinct targets in one visit and a triple never skips targets',()=>{
 const state=hit(game({mode:'around'}),'T1','S2','D3');assert.equal(progress(state,'around').targetIndex[0],3);assert.equal(progress(state,'around').targets[3],4);assert.equal(progress(state,'around').darts[0],3);
 assert.equal(progress(hit(game({mode:'around'}),'T1'),'around').targetIndex[0],1);
 assert.equal(progress(hit(game({mode:'around',segment:'single'}),'D1'),'around').targetIndex[0],0);
 const multi=hit(game({mode:'around',hitsPerTarget:2}),'S1','D1','S2');assert.equal(progress(multi,'around').targetIndex[0],1);assert.equal(progress(multi,'around').targetHits[0],1);
 assert.deepEqual(undoPlayVisit(state),game({mode:'around'}));
});
test('Around numeric segment and bull requirements are independent, descending order and no-bull work',()=>{
 let state=game({mode:'around',segment:'triple',bull:'inner'});for(let n=1;n<=20;n++)state=hit(state,'T'+n);
 state=hit(state,'SB');assert.equal(state.status,'live');assert.equal(progress(state,'around').targetIndex[0],20);
 state=hit(state,'DB');assert.equal(state.status,'finished');assert.equal(progress(state,'around').darts[0],22);
 const descending=game({mode:'around',order:'descending',bull:'off'});assert.deepEqual(progress(descending,'around').targets,Array.from({length:20},(_,i)=>20-i));
 assert.throws(()=>hit(state,'DB'),{code:'not_live'});
});
test('Bingo card codes preserve nine unique doubles and positions across independent games',()=>{
 const card=createBingoCard('same-source');assert.equal(new Set(card.card).size,9);assert.deepEqual(bingoCardFromCode(card.cardCode),card.card);
 const first=game({mode:'bingo',cardCode:card.cardCode},pair),second=newPlayState('other-session',solo,normalizePlayRules({mode:'bingo',cardCode:card.cardCode}));
 assert.deepEqual(progress(first,'bingo').card,progress(second,'bingo').card);assert.deepEqual(progress(first,'bingo').filled,Array.from({length:2},()=>Array(9).fill(false)));
 assert.throws(()=>bingoCardFromCode('DFB1-'+Array(9).fill('01').join('')),{code:'invalid_card'});
});
test('Bingo ignores repeated doubles, singles and triples, alternates complete team turns and stops at line',()=>{
 const teams=[{id:'a',playerIds:['alice','alex']},{id:'b',playerIds:['bob','bea']}];let state=game({mode:'bingo'},teams);const card=progress(state,'bingo').card;
 state=hit(state,'D'+card[0],'D'+card[0],'S'+card[1]);assert.equal(progress(state,'bingo').filled[0].filter(Boolean).length,1);assert.equal(state.currentThrowerId,'bob');
 state=hit(state,'MISS');assert.equal(state.currentThrowerId,'alex');state=hit(state,'D'+card[1]);state=hit(state,'MISS');assert.equal(state.currentThrowerId,'alice');
 assert.throws(()=>hit(state,'D'+card[2],'MISS'),{code:'darts_after_finish'});
 state=hit(state,'D'+card[2]);assert.equal(state.status,'finished');assert.deepEqual(progress(state,'bingo').winningPattern,[0,1,2]);assert.equal(progress(state,'bingo').darts[0],5);
 assert.equal(undoPlayVisit(state).status,'live');
});
test('Bingo supports four separate sides and full-card solo completion',()=>{
 const sides=Array.from({length:4},(_,i)=>({id:'s'+i,playerIds:['p'+i]}));let state=game({mode:'bingo'},sides);
 for(let i=0;i<4;i++){assert.equal(state.turn,i);state=hit(state,'MISS');}assert.equal(state.turn,0);
 state=game({mode:'bingo',win:'full-card'});for(const target of progress(state,'bingo').card)state=hit(state,'D'+target);assert.equal(state.status,'finished');assert.equal(progress(state,'bingo').winningPattern?.length,9);
});
test('finish training uses five independent attempts and only observed intended doubles',()=>{
 let state=game({mode:'finish',target:40});for(let i=0;i<5;i++)state=scorePlayVisit(state,{dartHits:['D20'],intendedTargets:['D20']});
 assert.equal(state.status,'finished');const p=progress(state,'finish');assert.equal(p.completed.length,5);assert.ok(p.completed.every(a=>a.success&&a.darts===1&&a.doubleAttempts===1));
 assert.equal(undoPlayVisit(state).status,'live');
 const unknown=hit(game({mode:'finish',target:40}),'D20');assert.equal(progress(unknown,'finish').completed[0].doubleAttempts,null);
});
test('finish partial darts, bust resets original target, next attempt restarts and budget cannot underflow',()=>{
 let state=scorePlayVisit(game({mode:'finish',target:68}),{dartHits:['S20'],intendedTargets:['T20']});assert.equal(progress(state,'finish').remaining,48);assert.equal(progress(state,'finish').dartsLeft,2);
 assert.throws(()=>hit(state,'MISS','MISS','MISS'),{code:'darts_exhausted'});
 state=scorePlayVisit(state,{dartHits:['T20'],intendedTargets:['D16']});const p=progress(state,'finish');assert.equal(p.completed[0].bust,true);assert.equal(p.completed[0].darts,2);assert.equal(p.completed[0].remaining,68);assert.equal(p.completed[0].doubleAttempts,1);assert.equal(p.remaining,68);assert.equal(p.dartsLeft,3);assert.equal(p.attemptNumber,2);
 assert.ok(finishRoutes(68,3,'double').length>1);assert.ok(finishRoutes(32,1,'double').some(route=>route.join()==='D16'));assert.deepEqual(finishRoutes(1,3,'double'),[]);assert.deepEqual(finishRoutes(1,1,'straight',1),[['S1']]);
});
function source(known=true):PlayLegSource{return {matchId:'historical',version:'result-v1',playerId:'source-player',startScore:301,inRule:'single',outRule:'double',valid:true,visits:[{score:180,remainingBefore:301,remainingAfter:121,bust:false,checkout:false,actualDarts:3},{score:121,remainingBefore:121,remainingAfter:0,bust:false,checkout:true,...(known?{actualDarts:3}:{})}]};}
test('leg eligibility rejects broken or unknown opening data and never infers checkout darts from total',()=>{
 assert.deepEqual(legSourceEligibility(source()),{eligible:true,reason:null,comparison:'darts',reliableDarts:6});assert.equal(legSourceEligibility(source(false)).comparison,'visits');
 assert.equal(legSourceEligibility({...source(),inRule:'double'}).eligible,false);
 assert.equal(legSourceEligibility({...source(),visits:[{...source().visits[0],remainingAfter:122},source().visits[1]]}).eligible,false);
 assert.equal(legSourceEligibility({...source(),valid:false}).eligible,false);
 assert.throws(()=>normalizePlayRules({mode:'leg-challenge',source:source(false),comparison:'darts'}),{code:'unreliable_dart_count'});
});
test('leg challenge freezes source, reveals only after accepted own visits and equal-dart finish draws',()=>{
 const original=source(),initial=game({mode:'leg-challenge',source:original});original.visits[0].score=0;
 assert.equal(progress(initial,'leg-challenge').revealedSourceVisits,0);let state=hit(initial,'T20','T20','T20');assert.equal(progress(state,'leg-challenge').revealedSourceVisits,1);assert.equal(progress(state,'leg-challenge').sourceRemaining,121);
 state=hit(state,'T20','T11','D14');assert.equal(state.result?.kind,'draw');assert.equal(progress(state,'leg-challenge').ownDarts,6);assert.equal(state.rules.mode==='leg-challenge'&&state.rules.source.visits[0].score,180);
 const notice=markLegSourceStatus(initial,{version:'result-v2',valid:false});assert.equal(progress(notice,'leg-challenge').sourceChanged,true);assert.equal(progress(notice,'leg-challenge').sourceInvalidated,true);assert.equal(notice.rules.mode==='leg-challenge'&&notice.rules.source.version,'result-v1');
});
test('leg challenge unknown checkout count compares equal finish visits as draw and stops on a definitive loss',()=>{
 let state=game({mode:'leg-challenge',source:source(false)});assert.equal(state.rules.mode==='leg-challenge'&&state.rules.comparison,'visits');state=scorePlayVisit(state,{score:180});state=scorePlayVisit(state,{score:121,darts:3,doubleConfirmed:true});assert.equal(state.result?.kind,'draw');
 let loss=game({mode:'leg-challenge',source:source()});loss=hit(loss,'MISS','MISS','MISS');loss=hit(loss,'MISS','MISS','MISS');assert.equal(loss.result?.kind,'loss');assert.throws(()=>hit(loss,'T20'),{code:'not_live'});
});
test('finish advice selects one genuine recurring finish, deduplicates sources and excludes unaccepted or old rows',()=>{
 const now=Date.parse('2026-11-19T12:00:00Z'),row={score:0,remainingBefore:68,remainingAfter:68,bust:false,checkout:false};
 const records=[{id:'a',completedAt:'2026-11-18T12:00:00Z',accepted:true,outRule:'double' as const,visits:[row,row,row,row]},{id:'a',completedAt:'2026-11-18T12:00:00Z',accepted:true,outRule:'double' as const,visits:[row]},{id:'old',completedAt:'2026-10-01T00:00:00Z',accepted:true,outRule:'double' as const,visits:[row]},{id:'no',completedAt:'2026-11-18T12:00:00Z',accepted:false,outRule:'double' as const,visits:[row]}];
 const advice=finishAdvice(records,now);assert.equal(advice?.target,68);assert.equal(advice?.frequency,4);assert.equal(advice?.sourceVisitCount,4);assert.match(advice!.explanation,/4 geaccepteerde beurten/);assert.equal(finishAdvice([],now),null);
});
test('challenge dart limit permits the final equal dart and refuses an extra dart beyond the comparison',()=>{
 let state=game({mode:'leg-challenge',source:source()});state=hit(state,'MISS','MISS','MISS');state=hit(state,'MISS','MISS');assert.equal(state.status,'live');assert.equal(progress(state,'leg-challenge').sourceVisitCount,2);
 assert.throws(()=>hit(state,'MISS','MISS'),{code:'darts_exhausted'});state=hit(state,'MISS');assert.equal(state.result?.kind,'loss');assert.equal(progress(state,'leg-challenge').ownDarts,6);
 assert.equal(state.rules.mode==='leg-challenge'&&state.rules.source.visitCount,2);assert.equal(state.rules.mode==='leg-challenge'&&state.rules.source.totalDarts,6);
});
test('double accuracy needs explicit per-dart intent and does not mistake another double for the intended one',()=>{
 let state=game({mode:'finish',target:68});state=scorePlayVisit(state,{dartHits:['D16','D18'],intendedTargets:['D16','D20']});
 assert.deepEqual(playDoubleAccuracy(state),{attempts:2,hits:1,percentage:50});assert.deepEqual(playDoubleAccuracy(hit(game({mode:'finish',target:40}),'D20')),{attempts:null,hits:null,percentage:null});
 assert.throws(()=>scorePlayVisit(game({mode:'finish',target:40}),{dartHits:['D20'],intendedTargets:['D20'],doubleAttempts:0}),{code:'invalid_attempts'});
 assert.throws(()=>scorePlayVisit(game({mode:'x01'}),{dartHits:['T20'],darts:3}),{code:'invalid_darts'});
});
test('source eligibility rejects contradictory exact counts and impossible aggregate turns',()=>{
 const contradictory=source();contradictory.visits[0].dartHits=['T20','T20','T20'];contradictory.visits[0].actualDarts=2;assert.equal(legSourceEligibility(contradictory).eligible,false);
 const impossible=source();impossible.visits[0]={...impossible.visits[0],score:179,remainingAfter:122};impossible.visits[1]={...impossible.visits[1],score:122,remainingBefore:122};assert.equal(legSourceEligibility(impossible).eligible,false);
});
test('accepted visits and challenge sources whitelist client fields before public projection',()=>{
 const injected={...source(),privateToken:'hidden-source',visits:source().visits.map(v=>({...v,actorEmail:'hidden-actor'}))};
 const initial=game({mode:'leg-challenge',source:injected});assert.equal(JSON.stringify(initial).includes('hidden-'),false);
 const scored=scorePlayVisit(initial,{dartHits:['T20','T20','T20'],privateToken:'hidden-command',actorId:'hidden-id'} as Parameters<typeof scorePlayVisit>[1]);assert.equal(JSON.stringify(scored).includes('hidden-'),false);
 assert.throws(()=>scorePlayVisit(game({mode:'bingo'}),{dartHits:['D20'],score:1}),{code:'invalid_total'});
 assert.throws(()=>scorePlayVisit(game({mode:'around'}),{intendedTargets:['D1']}),{code:'invalid_target'});
 assert.throws(()=>scorePlayVisit(game({mode:'x01'}),{score:60,bust:'true'} as unknown as Parameters<typeof scorePlayVisit>[1]),{code:'invalid_visit'});
 assert.equal(legSourceEligibility({...source(),valid:'true'}).eligible,false);
});
test('masked challenge state projects own visits and the exact result without exposing the next historical visit',()=>{
 for(const known of [true,false]){
  let canonical=game({mode:'leg-challenge',source:source(known)}),masked=structuredClone(canonical);
  assert.equal(masked.rules.mode,'leg-challenge');if(masked.rules.mode!=='leg-challenge')throw Error('challenge');masked.rules.source.visits=[];
  const first=known?{dartHits:['T20','T20','T20']}:{score:180};canonical=scorePlayVisit(canonical,first);masked=scorePlayVisit(masked,first);
  assert.equal(masked.status,'live');assert.equal(progress(masked,'leg-challenge').sourceVisitCount,2);assert.equal(progress(masked,'leg-challenge').revealedSourceVisits,0);assert.equal(progress(masked,'leg-challenge').sourceRemaining,301);assert.deepEqual(masked.rules.mode==='leg-challenge'&&masked.rules.source.visits,[]);
  // A subsequent accepted server snapshot reveals just the first source visit.
  if(masked.rules.mode!=='leg-challenge')throw Error('challenge');masked.rules.source.visits=[structuredClone(source(known).visits[0])];progress(masked,'leg-challenge').sourceRemaining=121;progress(masked,'leg-challenge').revealedSourceVisits=1;
  const last=known?{dartHits:['T20','T11','D14']}:{score:121,darts:3,doubleConfirmed:true};canonical=scorePlayVisit(canonical,last);masked=scorePlayVisit(masked,last);
  assert.equal(masked.status,'finished');assert.deepEqual(masked.result,canonical.result);assert.equal(masked.result?.kind,'draw');assert.equal(progress(masked,'leg-challenge').revealedSourceVisits,1);assert.equal(progress(masked,'leg-challenge').sourceRemaining,121);assert.equal(masked.rules.mode==='leg-challenge'&&masked.rules.source.visits.length,1);
 }
});

test('a recorded bust cannot claim credited points or contradict explicitly recorded darts',()=>{
 const invalid=source();invalid.visits=[{score:180,remainingBefore:301,remainingAfter:301,bust:true,checkout:false,actualDarts:3},...invalid.visits];assert.equal(legSourceEligibility(invalid).eligible,false);
 assert.throws(()=>scorePlayVisit(game({mode:'x01'}),{dartHits:['S20'],bust:true}),{code:'invalid_visit'});
});
