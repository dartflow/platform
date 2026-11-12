import {test} from 'node:test';
import assert from 'node:assert/strict';
import {celebrationForEvent,createOcheVisuals,OCHE_CUE_DURATION,type OcheScoreEvent,type OcheCueSnapshot} from '../lib/oche-visual';
const event=(revision:number,score=180,other:Partial<OcheScoreEvent>={}):OcheScoreEvent=>({id:`event-${revision}`,revision,kind:'score',score,checkout:false,bust:false,playerIndex:0,...other});
const snapshot=(revision:number,events:OcheScoreEvent[],sessionKey='session-a'):OcheCueSnapshot=>({sessionKey,scoreEvents:events,match:{revision,players:[{name:'Robin'}]}});
test('Oche celebrates only accepted maximums and high checkouts',()=>{
 assert.equal(celebrationForEvent(event(1,180))?.label,'Maximum');assert.equal(celebrationForEvent(event(1,100,{checkout:true}))?.label,'Hoge finish');
 for(const item of [event(1,99,{checkout:true}),event(1,100),event(1,180,{bust:true}),event(1,180,{kind:'undo'}),event(1,179),event(1,NaN)])assert.equal(celebrationForEvent(item),null);
});
test('first load is a baseline; a repeated confirmed event celebrates once for 1800ms',()=>{
 let now=0;const tracker=createOcheVisuals(()=>now);const first=event(1),next=event(2);
 assert.equal(tracker.observe(snapshot(1,[first]),true),null);const cue=tracker.observe(snapshot(2,[first,next]),true);assert.equal(cue?.id,next.id);assert.equal(cue?.player,'Robin');
 now=400;assert.equal(tracker.observe(snapshot(2,[first,next]),true)?.startedAt,0);now=OCHE_CUE_DURATION;assert.equal(tracker.tick(),null);assert.equal(tracker.observe(snapshot(2,[first,next]),true),null);
});
test('multiple qualifying server actions between polls are queued without loss or duplicate playback',()=>{
 let now=0;const tracker=createOcheVisuals(()=>now);tracker.observe(snapshot(0,[]),true);
 const maximum=event(1),finish=event(2,121,{checkout:true});assert.equal(tracker.observe(snapshot(2,[maximum,finish]),true)?.id,maximum.id);
 now=1800;assert.equal(tracker.tick()?.id,finish.id);assert.equal(tracker.observe(snapshot(3,[maximum,finish]),true)?.id,finish.id);now=3600;assert.equal(tracker.tick(),null);assert.equal(tracker.observe(snapshot(4,[maximum,finish]),true),null);
});
test('offline/reconnect never replay historical celebrations and a newly started live game remains observable',()=>{
 let now=0;const tracker=createOcheVisuals(()=>now);tracker.observe(snapshot(0,[]),true);assert.ok(tracker.observe(snapshot(1,[event(1)]),true));
 assert.equal(tracker.observe(snapshot(1,[event(1)]),false),null);assert.equal(tracker.observe(snapshot(3,[event(1),event(2),event(3)]),true),null);
 assert.equal(tracker.observe(snapshot(4,[event(4)],'new-game'),true)?.id,'event-4');assert.equal(tracker.observe(snapshot(5,[event(4),event(5)],'new-game'),true)?.id,'event-4');now=1800;assert.equal(tracker.tick()?.id,'event-5');
});
test('a continuously watched idle board celebrates a new game first maximum even when both arrive between polls',()=>{
 const tracker=createOcheVisuals(()=>0);tracker.observe({sessionKey:'idle-board',match:null,scoreEvents:[]},true);assert.equal(tracker.observe(snapshot(1,[event(1)],'brand-new-game'),true)?.label,'Maximum');
});
test('undo cancels current and queued moments and never revives an earlier maximum',()=>{
 let now=0;const tracker=createOcheVisuals(()=>now);tracker.observe(snapshot(0,[]),true);tracker.observe(snapshot(2,[event(1),event(2)]),true);
 const undo=event(3,0,{kind:'undo'});assert.equal(tracker.observe(snapshot(3,[event(1),event(2),undo]),true),null);now=5000;assert.equal(tracker.tick(),null);
 const replay=event(4,180,{id:'new-confirmed-score'});assert.equal(tracker.observe(snapshot(4,[event(1),event(2),undo,replay]),true)?.id,replay.id);
});
test('a score followed by undo within the same polling batch produces no cue',()=>{
 const tracker=createOcheVisuals(()=>0);tracker.observe(snapshot(0,[]),true);assert.equal(tracker.observe(snapshot(2,[event(1),event(2,0,{kind:'undo'})]),true),null);
});
test('a final accepted solo checkout can celebrate after the physical board is released',()=>{
 const tracker=createOcheVisuals(()=>0);tracker.observe(snapshot(3,[]),true);const finish=event(4,121,{checkout:true,playerName:'Sam'});
 const cue=tracker.observe({sessionKey:'session-a',match:null,scoreEvents:[finish]},true);assert.equal(cue?.label,'Hoge finish');assert.equal(cue?.player,'Sam');
 assert.equal(tracker.observe({sessionKey:'session-a',match:null,scoreEvents:[finish]},true)?.id,finish.id);
});
test('missing metadata and regressing revisions fail closed and rebaseline',()=>{
 const tracker=createOcheVisuals(()=>0);assert.equal(tracker.observe({match:{revision:1,players:[]}},true),null);tracker.observe(snapshot(5,[]),true);assert.equal(tracker.observe(snapshot(1,[event(1)]),true),null);assert.equal(tracker.observe(snapshot(2,[event(1),event(2)]),true)?.id,'event-2');
});
