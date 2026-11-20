import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newPlayState,normalizePlayRules,scorePlayVisit,undoPlayVisit} from '../lib/play-rules';
import {playX01Snapshot,coreTacticsPlay} from '../lib/oche-play-projection';
import {buildOcheScorecard} from '../lib/oche-scorecard';
import {matchView,newGame,validateSettings} from '../lib/domain';
import type {PlayState} from '../lib/play-types';
import type {PublicPlaySession} from '../lib/play-session-types';
import type {MatchState,PublicSnapshot} from '../lib/types';
function publicPlay(state:PlayState):PublicPlaySession{const {undo:_,...game}=state;void _;return{id:'public',sessionKey:'opaque-stable',version:1,revision:state.visits.length+1,status:state.status==='finished'?'completed':'active',mode:state.mode,rules:state.rules,game,participants:[{id:'a',name:'Robin'}],writerName:'Robin',serverNow:100000,activityAt:100000,warningAt:220000,deadlineAt:280000,extensionsUsed:0,maxExtensions:2};}
test('new X01 projects accepted effective/opening scores into the existing mirrored scorecard and preserves undo',()=>{
 const original=newPlayState('public-session',[{id:'side-a',playerIds:['a']}],normalizePlayRules({mode:'x01',startScore:301})),scored=scorePlayVisit(original,{dartHits:['S20','D16','T20']});
 const snapshot=playX01Snapshot(publicPlay(scored),'Baan 1','Vrijspel','onzetrots')!;assert.equal(snapshot.match!.remaining[0],209);assert.equal(snapshot.match!.settings.inRule,'double');assert.equal(snapshot.match!.visits[0].score,92);assert.equal(snapshot.match!.visits[0].observedScore,112);assert.equal(snapshot.match!.visits[0].bust,false);assert.equal(snapshot.theme!.id,'onzetrots');
 const card=buildOcheScorecard(snapshot.match!,snapshot.sessionKey);assert.equal(card.startScores[0],301);assert.equal(card.columns[0][0].remainingAfter,209);
 const undone=playX01Snapshot(publicPlay(undoPlayVisit(scored)),'Baan 1')!;assert.equal(undone.match!.remaining[0],301);assert.equal(buildOcheScorecard(undone.match!,undone.sessionKey).visitCount,0);assert.equal(undone.sessionKey,snapshot.sessionKey);assert.equal(snapshot.boardActivity!.canExtend,false);
});
test('new X01 scorecard shows only the canonical current set and leg after series rollover',()=>{
 let state=newPlayState('series',[{id:'side-a',playerIds:['a']}],normalizePlayRules({mode:'x01',startScore:301,inRule:'single',bestOfLegs:1,bestOfSets:3}));state=scorePlayVisit(state,{dartHits:['T20','T20','T20']});state=scorePlayVisit(state,{dartHits:['T20','T11','D14']});const snapshot=playX01Snapshot(publicPlay(state),'Baan 1')!;assert.equal(snapshot.match!.setNumber,2);assert.equal(snapshot.match!.legNumber,2);assert.equal(snapshot.match!.currentLegVisits!.length,0);assert.deepEqual(snapshot.match!.remaining,[301]);assert.deepEqual(snapshot.match!.sets,[1]);assert.equal(snapshot.match!.visits.length,2);
 assert.equal(playX01Snapshot({...publicPlay(state),version:2 as 1},'Baan'),undefined);
});
test('canonical Tactics is adapted as twelve targets with its fixed preset and replay evidence',()=>{
 const settings=validateSettings({discipline:'tactics',tacticsPreset:'tactics-3'}),state:MatchState={id:'canonical',clubId:'club',eventId:'event',boardId:null,revision:1,status:'live',players:[{id:'a',name:'Robin'},{id:'b',name:'Sam'}],writerId:'a',settings,accepted:[true,true],confirmations:[false,false],resultRevision:null,game:newGame('canonical',['a','b'],settings),previousSets:[],winnerId:null,resultPublished:false,dispute:null},view=matchView(state,'a',false),snapshot:PublicSnapshot={board:{id:'board',name:'Baan'},event:{name:'Toernooi'},match:view};
 const play=coreTacticsPlay(snapshot,100000)!;assert.equal(play.rules.mode,'tactics');assert.equal(play.game.progress.mode,'tactics');if(play.game.progress.mode!=='tactics')throw Error('targets');assert.deepEqual(play.game.progress.targets,[20,19,18,17,16,15,14,13,12,11,10,25]);assert.equal(play.game.progress.requiredMarks,3);assert.equal(play.game.currentThrowerId,'a');
});
