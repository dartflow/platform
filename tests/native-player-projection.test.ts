import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativePlayerTrainingProjection} from '../lib/native-player-projection';
import {newTraining,trainingAction} from '../lib/platform-domain';
import type {PlatformEntity} from '../lib/platform-types';

test('native training projection preserves accepted score fields and metadata without mutating stored snapshots',()=>{
 const id='00000000-0000-4000-8000-000000000099',owner='00000000-0000-4000-8000-000000000002';
 const state=trainingAction(newTraining(id,owner,{mode:'bot',startScore:501,botAverage:30}),{type:'training.score',score:112,darts:3});
 const source:PlatformEntity={id,kind:'training',name:'Dartbot',ownerId:owner,clubId:null,visibility:'private',revision:1,state,members:[],canManage:true};
 const before=structuredClone(source),projected=nativePlayerTrainingProjection(source);
 assert.equal(projected.state.undoCount,1);assert.equal('undo'in projected.state,false);assert.deepEqual(projected.state.game?.history,[]);
 const withoutHistory=({...game}:NonNullable<typeof state.game>)=>{game.history=[];return game;};
 assert.deepEqual(projected.state.game,withoutHistory(structuredClone(source.state.game!)));assert.deepEqual(projected.state.rounds,source.state.rounds);assert.deepEqual(source,before,'Projection must not strip server/receipt snapshots in place.');
 assert.equal(projected.revision,source.revision);assert.equal(projected.canManage,true);assert.equal(projected.state.game?.remaining[0],389);
});
test('native projection keeps non-game training state and leaves other entity kinds unchanged',()=>{
 const source:PlatformEntity={id:'id',kind:'training',name:'Dubbels',ownerId:'owner',clubId:null,visibility:'private',revision:2,state:{name:'Dubbels',mode:'around',rounds:[1,2]},members:[],canManage:true};
 assert.deepEqual(nativePlayerTrainingProjection(source).state,{...source.state,undoCount:0});
 const lobby:PlatformEntity={...source,kind:'lobby'};assert.equal(nativePlayerTrainingProjection(lobby),lobby);
});
