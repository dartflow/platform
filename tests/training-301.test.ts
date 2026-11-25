import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {freshX01InRule} from '../lib/x01-defaults';
import {generateBotDartHits} from '../lib/training-bot';
import {newTraining, trainingAction} from '../lib/platform-domain';
import {newGame, scoreGame} from '../lib/domain';
import {dartValue, evaluateX01Visit} from '../lib/x01-rules';

test('fresh X01 selections default explicitly, while persisted or legacy 301 without an opening rule stays single', () => {
  assert.deepEqual([301,501,701].map(freshX01InRule), ['double','single','single']);
  const old = newTraining(randomUUID(), randomUUID(), {mode:'solo', startScore:301});
  assert.equal(old.game!.inRule, undefined);
  assert.equal(trainingAction(old, {type:'training.score',score:60,darts:3}).game!.remaining[0],241);
  const explicitSingle = newTraining(randomUUID(), randomUUID(), {mode:'solo',startScore:301,inRule:'single'});
  assert.equal(trainingAction(explicitSingle,{type:'training.score',score:60,darts:3}).game!.remaining[0],241);
  const fresh = newTraining(randomUUID(), randomUUID(), {mode:'solo',startScore:301,inRule:freshX01InRule(301)});
  assert.equal(trainingAction(fresh,{type:'training.score',score:112,darts:3,dartHits:['S20','D16','T20']}).game!.remaining[0],209);
});

test('double-in bot darts use sequential opening and legal checkout, and whole exchanges undo together', () => {
  let state = newTraining(randomUUID(), randomUUID(), {mode:'bot',startScore:301,inRule:'double',botAverage:50});
  const initial=structuredClone(state.game);
  state=trainingAction(state,{type:'training.score',score:112,darts:3,dartHits:['S20','D16','T20']});
  assert.equal(state.game!.turn,0);assert.equal(state.game!.visits.length,2);
  assert.equal(state.game!.remaining[0],209);assert.equal(state.game!.visits[0].score,92);
  const bot=state.game!.visits[1],result=evaluateX01Visit({remaining:301,opened:false,hits:bot.dartHits!});
  assert.equal(bot.playerIndex,1);assert.ok(bot.dartHits?.length);
  assert.equal(bot.remainingAfter,result.remaining);assert.equal(bot.score,result.points);assert.equal(bot.openedAfter,result.opened);
  state=trainingAction(state,{type:'training.undo'});assert.deepEqual(state.game,initial);
  const game=newGame(randomUUID(),['human','Dartbot'],{startScore:301,inRule:'double',bestOfLegs:1,bestOfSets:1});
  game.turn=1;
  const opening=generateBotDartHits(game,50,()=>0);
  assert.ok(opening[0].startsWith('D'));assert.equal(evaluateX01Visit({remaining:301,opened:false,hits:opening}).opened,true);
  game.remaining[1]=40;game.opened![1]=true;
  const finish=generateBotDartHits(game,50,()=>0);assert.deepEqual(finish,['D20']);
  const completed=scoreGame(game,finish.reduce((sum,hit)=>sum+dartValue(hit),0),finish.length,false,undefined,finish);
  assert.equal(completed.winner,'Dartbot');assert.equal(completed.visits[0].checkout,true);assert.equal(completed.visits[0].darts,1);
});
