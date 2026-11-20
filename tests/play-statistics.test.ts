import{test}from'node:test';
import assert from'node:assert/strict';
import{newPlayState,normalizePlayRules,scorePlayVisit}from'../lib/play-rules';
import{playScoreStatistics,playStatisticsRuleProfile,parsePlayStatisticsFilters}from'../lib/play-statistics';
const sides=[{id:'one',playerIds:['alice']},{id:'two',playerIds:['bob']}];
test('double-in statistics separate known actual darts from rule-counted darts and never infer attempts from hits',()=>{
 let game=newPlayState('double-in',sides,normalizePlayRules({mode:'x01',startScore:301}));game=scorePlayVisit(game,{dartHits:['S20','D16','T20']});const metrics=playScoreStatistics(game,'alice');assert.equal(metrics.points,92);assert.equal(metrics.darts,3);assert.equal(metrics.countingDarts,3);assert.equal(metrics.average,92);assert.equal(metrics.doubleAttempts,null);assert.equal(metrics.doublePercentage,null);assert.equal(playScoreStatistics(game,'bob').visits,0);
 let quick=newPlayState('quick',sides,normalizePlayRules({mode:'x01',startScore:501}));quick=scorePlayVisit(quick,{score:60});assert.equal(playScoreStatistics(quick,'alice').darts,null);assert.equal(playScoreStatistics(quick,'alice').countingDarts,3);
});
test('Cricket and Tactics count closing and scoring marks but exclude jointly closed target hits',()=>{
 for(const mode of['cricket','tactics']as const){const preset=mode==='tactics'?{preset:'tactics-3'}:{};let game=newPlayState(mode,sides,normalizePlayRules({mode,...preset}));for(const dartHits of[['T20'],['MISS'],['T20'],['T20'],['T20']])game=scorePlayVisit(game,{dartHits});const metrics=playScoreStatistics(game,'alice');assert.equal(metrics.successes,6);assert.equal(metrics.points,60);assert.equal(metrics.darts,3);assert.equal(metrics.marksPerRound,6);assert.equal(metrics.average,null);}
});
test('Bingo team statistics attribute only the actual thrower and ignore random card identity for comparisons',()=>{
 let game=newPlayState('card-a',[{id:'one',playerIds:['alice','partner']},{id:'two',playerIds:['bob','other']}],normalizePlayRules({mode:'bingo'}));if(game.progress.mode!=='bingo')throw Error('bingo');const card=game.progress.card;for(const dartHits of[[`D${card[0]}`],['MISS'],[`D${card[1]}`],['MISS'],[`D${card[2]}`]])game=scorePlayVisit(game,{dartHits});assert.equal(game.status,'finished');assert.equal(playScoreStatistics(game,'alice').successes,2);assert.equal(playScoreStatistics(game,'partner').successes,1);assert.equal(playScoreStatistics(game,'alice').darts,2);const other=newPlayState('card-b',game.sides,normalizePlayRules({mode:'bingo'}));assert.deepEqual(playStatisticsRuleProfile(game),playStatisticsRuleProfile(other));assert.equal(JSON.stringify(playStatisticsRuleProfile(game)).includes('cardCode'),false);
});
test('finish profiles keep help and attempt rules distinct; metrics use registered completions and explicit aims',()=>{
 let game=newPlayState('finish',[sides[0]],normalizePlayRules({mode:'finish',target:40,attemptCount:2,routeHelp:false}));game=scorePlayVisit(game,{dartHits:['D20'],intendedTargets:['D20']});game=scorePlayVisit(game,{dartHits:['T20'],intendedTargets:['D20']});assert.equal(game.status,'finished');const metrics=playScoreStatistics(game,'alice');assert.equal(metrics.successes,1);assert.equal(metrics.attempts,2);assert.equal(metrics.doubleAttempts,2);assert.equal(metrics.doubleHits,1);assert.equal(metrics.doublePercentage,50);assert.equal(metrics.points,40);assert.notDeepEqual(playStatisticsRuleProfile(game),playStatisticsRuleProfile({...game,rules:{...game.rules,routeHelp:true}as typeof game.rules}));
});
test('statistics filters validate real rules rather than silently changing an invalid requested scope',()=>{
 assert.deepEqual(parsePlayStatisticsFilters({mode:'x01',source:'practice',startScore:'301',inRule:'double',outRule:'double'}),{mode:'x01',source:'practice',startScore:301,inRule:'double',outRule:'double'});for(const value of[{startScore:302},{mode:'unknown'},{source:'official'},{inRule:'single or double'},{outRule:'any'}])assert.throws(()=>parsePlayStatisticsFilters(value),{code:'invalid_statistics_filter'});
});
