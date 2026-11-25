import test from 'node:test';
import assert from 'node:assert/strict';
import {readOcheLayout,saveOcheLayout,validOcheLayout,OCHE_LAYOUT_KEY,hasActiveOcheMatch,ochePanelEventGap} from '../lib/oche-layout';
import {newPlayState,normalizePlayRules} from '../lib/play-rules';
import type {PublicPlaySession} from '../lib/play-session-types';
import type {OcheDisplaySnapshot} from '../lib/oche-device-types';
import {readFileSync} from 'node:fs';

test('installation selection survives roundtrip, rejects corrupt and impossible orientation/count combinations',()=>{
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
 assert.equal(readOcheLayout(storage),null);
 saveOcheLayout(storage,{orientation:'landscape',scoreboards:2});assert.deepEqual(readOcheLayout(storage),{orientation:'landscape',scoreboards:2});
 for(const value of [{orientation:'portrait',scoreboards:2},{orientation:'adaptive',scoreboards:1},{orientation:'landscape',scoreboards:3},null,[],{orientation:'portrait',scoreboards:'1'}])assert.equal(validOcheLayout(value),false);
 values.set(OCHE_LAYOUT_KEY,'broken');assert.equal(readOcheLayout(storage),null);
 assert.throws(()=>saveOcheLayout({...storage,setItem:()=>{throw Error('Storage full');}},{orientation:'portrait',scoreboards:1}),/Storage full/);
 assert.throws(()=>saveOcheLayout({...storage,setItem:()=>{}},{orientation:'portrait',scoreboards:1}),/opgeslagen/);
});
test('a retained event gap baselines its own pane without treating ordinary score updates as a gap',()=>{
 const snapshot=JSON.parse(readFileSync('contracts/fixtures/oche-display-v1-panels/both-live.json','utf8')) as OcheDisplaySnapshot;
 const before=snapshot.panels![0].snapshot!,after=structuredClone(before);
 after.display!.snapshot.scoreEvents=Array.from({length:64},(_,index)=>({id:`event-${index}`,kind:'score',score:180,revision:100+index}));
 assert.equal(ochePanelEventGap(before,after),true);
 assert.equal(ochePanelEventGap(snapshot.panels![1].snapshot,snapshot.panels![1].snapshot),false);
 after.display!.snapshot.scoreEvents=[{id:'new',kind:'score',score:180,revision:before.display!.snapshot.match!.revision+1}];assert.equal(ochePanelEventGap(before,after),false);
});
test('legacy setup waits until all lanes are safe, including paused or waiting matches',()=>{
 const snapshot=JSON.parse(readFileSync('contracts/fixtures/oche-display-v1-panels/both-live.json','utf8')) as OcheDisplaySnapshot;
 assert.equal(hasActiveOcheMatch(snapshot),true);
 for(const panel of snapshot.panels!)panel.snapshot!.display!.snapshot.match!.status='result';
 assert.equal(hasActiveOcheMatch(snapshot),false);
 snapshot.panels![1].snapshot!.display!.snapshot.match!.status='live';snapshot.panels![1].snapshot!.display!.snapshot.match!.paused=true;
 assert.equal(hasActiveOcheMatch(snapshot),true);
});

test('legacy setup waits for active Play forms without a canonical match and becomes safe after completion',()=>{
 const snapshot=JSON.parse(readFileSync('contracts/fixtures/oche-display-v1-panels/both-live.json','utf8')) as OcheDisplaySnapshot;
 for(const panel of snapshot.panels!)panel.snapshot!.display!.snapshot.match=null;
 const {undo,...game}=newPlayState('active-play',[{id:'side-a',playerIds:['a']}],normalizePlayRules({mode:'around'}));void undo;
 const play:PublicPlaySession={id:'play',sessionKey:'public-play',version:1,revision:1,status:'active',mode:game.mode,rules:game.rules,game,participants:[{id:'a',name:'Robin'}],writerName:'Robin',serverNow:100000,activityAt:100000,warningAt:220000,deadlineAt:280000,extensionsUsed:0,maxExtensions:2};
 snapshot.panels![1].snapshot!.display!.snapshot.play=play;
 assert.equal(hasActiveOcheMatch(snapshot),true);
 play.status='completed';play.game.status='finished';assert.equal(hasActiveOcheMatch(snapshot),false);
});
