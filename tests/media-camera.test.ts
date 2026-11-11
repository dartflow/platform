import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraRecoveryError,nextCamera,replaceCamera} from '../lib/media-camera';

class Track {
  enabled=true;
  readyState:'live'|'ended'='live';
  stops=0;
  constructor(readonly id:string,readonly kind:string,readonly settings:MediaTrackSettings={}){}
  stop(){this.stops++;this.readyState='ended';}
  getSettings(){return this.settings;}
}
class Stream {
  constructor(readonly tracks:Track[]){}
  getTracks(){return [...this.tracks];}
  getVideoTracks(){return this.tracks.filter(track=>track.kind==='video');}
  removeTrack(track:Track){this.tracks.splice(this.tracks.indexOf(track),1);}
  addTrack(track:Track){this.tracks.push(track);}
}
const asStream=(stream:Stream)=>stream as unknown as MediaStream;
const asTrack=(track:Track)=>track as unknown as MediaStreamTrack;
function fixture(){
  const old=new Track('front','video',{deviceId:'front',facingMode:'user',width:640,height:360,frameRate:30}),audio=new Track('audio','audio');
  const local=new Stream([old,audio]);
  return {old,audio,local};
}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}

test('camera replacement waits for a frame and sender acceptance before stopping the old track, preserving audio and mute',async()=>{
  const {old,audio,local}=fixture();old.enabled=false;audio.enabled=false;
  const replacement=new Track('rear','video'),extra=new Track('unexpected-audio','audio');
  const candidate=new Stream([replacement,extra]);
  const ready=deferred(),readyCalled=deferred(),accepted=deferred(),senderCalled=deferred();
  const sender={track:asTrack(old),async replaceTrack(track:MediaStreamTrack){senderCalled.resolve();await accepted.promise;this.track=track;}};
  let constraints:MediaStreamConstraints|undefined;
  const task=replaceCamera({localStream:asStream(local),connection:{connectionState:'connected',getSenders:()=>[sender]} as unknown as RTCPeerConnection,target:{deviceId:'rear'},getUserMedia:async value=>{constraints=value;return asStream(candidate);},isCurrent:()=>true,waitUntilReady:async()=>{readyCalled.resolve();await ready.promise;}});
  await readyCalled.promise;assert.equal(old.readyState,'live');assert.equal(sender.track,old);assert.equal(replacement.enabled,false);
  ready.resolve();await senderCalled.promise;assert.equal(old.readyState,'live');
  accepted.resolve();assert.equal(await task,replacement);
  assert.equal(old.stops,1);assert.equal(replacement.readyState,'live');assert.equal(extra.stops,1);
  assert.deepEqual(local.getTracks(),[audio,replacement]);assert.equal(audio.readyState,'live');assert.equal(audio.enabled,false);assert.equal(audio.stops,0);
  assert.equal(constraints?.audio,false);assert.deepEqual((constraints?.video as MediaTrackConstraints).deviceId,{exact:'rear'});
});

test('permission/device denial and rejected sender replacement retain the original camera',async()=>{
  for(const name of ['NotAllowedError','NotFoundError','OverconstrainedError','InvalidModificationError']){
    const {old,audio,local}=fixture(),replacement=new Track('rear','video');
    const sender={track:asTrack(old),async replaceTrack(){throw new DOMException('Fixture rejection',name);}};
    await assert.rejects(replaceCamera({localStream:asStream(local),connection:{connectionState:'connected',getSenders:()=>[sender]} as unknown as RTCPeerConnection,target:{facingMode:'environment'},getUserMedia:async()=>{if(name!=='InvalidModificationError')throw new DOMException('Fixture denial',name);return asStream(new Stream([replacement]));},isCurrent:()=>true,waitUntilReady:async()=>{}}),{name});
    assert.equal(old.readyState,'live');assert.equal(old.stops,0);assert.equal(audio.stops,0);assert.deepEqual(local.getTracks(),[old,audio]);
    if(name==='InvalidModificationError')assert.equal(replacement.readyState,'ended');
  }
});

test('a camera obtained after leaving is immediately stopped and never installed',async()=>{
  const {old,audio,local}=fixture(),replacement=new Track('rear','video'),release=deferred(),requested=deferred();
  let current=true;
  const task=replaceCamera({localStream:asStream(local),connection:null,target:{deviceId:'rear'},getUserMedia:async()=>{requested.resolve();await release.promise;return asStream(new Stream([replacement]));},isCurrent:()=>current,waitUntilReady:async()=>{}});
  await requested.promise;current=false;old.stop();release.resolve();
  await assert.rejects(task,{name:'AbortError'});assert.equal(replacement.readyState,'ended');assert.deepEqual(local.getTracks(),[old,audio]);
});

test('explicit single-camera fallback restores the previous device when the target still fails',async()=>{
  const {old,audio,local}=fixture(),restored=new Track('front-restored','video');
  const requested:string[]=[];
  const sender={track:asTrack(old),async replaceTrack(track:MediaStreamTrack){this.track=track;}};
  await assert.rejects(replaceCamera({localStream:asStream(local),connection:{connectionState:'connected',getSenders:()=>[sender]} as unknown as RTCPeerConnection,target:{deviceId:'rear'},getUserMedia:async constraints=>{assert.equal(constraints.audio,false);const id=((constraints.video as MediaTrackConstraints).deviceId as ConstrainDOMStringParameters).exact as string;requested.push(id);assert.equal(old.readyState,'ended');if(id==='rear')throw new DOMException('Busy fixture device','NotReadableError');return asStream(new Stream([restored]));},isCurrent:()=>true,waitUntilReady:async()=>{},releaseCurrent:true}),error=>error instanceof CameraRecoveryError&&error.restored);
  assert.deepEqual(requested,['rear','front']);assert.equal(sender.track,restored);assert.equal(restored.readyState,'live');assert.equal(audio.stops,0);assert.deepEqual(local.getTracks(),[audio,restored]);
});

test('leaving while the new camera waits for its first frame stops pending capture immediately',async()=>{
  const {old,audio,local}=fixture(),replacement=new Track('rear','video'),ready=deferred(),entered=deferred(),controller=new AbortController();
  const task=replaceCamera({localStream:asStream(local),connection:null,target:{deviceId:'rear'},getUserMedia:async()=>asStream(new Stream([replacement])),isCurrent:()=>true,signal:controller.signal,waitUntilReady:async()=>{entered.resolve();await ready.promise;}});
  await entered.promise;controller.abort();assert.equal(replacement.readyState,'ended');assert.equal(old.readyState,'live');assert.equal(audio.stops,0);
  ready.resolve();await assert.rejects(task,{name:'AbortError'});assert.deepEqual(local.getTracks(),[old,audio]);
});

test('a browser that ends the old camera while opening a new device gets its original camera restored',async()=>{
  const {old,audio,local}=fixture(),restored=new Track('front-restored','video');let requests=0;
  await assert.rejects(replaceCamera({localStream:asStream(local),connection:null,target:{deviceId:'rear'},getUserMedia:async constraints=>{assert.equal(constraints.audio,false);if(requests++===0){old.stop();throw new DOMException('Device changed by browser','NotReadableError');}assert.deepEqual((constraints.video as MediaTrackConstraints).deviceId,{exact:'front'});return asStream(new Stream([restored]));},isCurrent:()=>true,waitUntilReady:async()=>{}}),error=>error instanceof CameraRecoveryError&&error.restored);
  assert.deepEqual(local.getTracks(),[audio,restored]);assert.equal(audio.stops,0);assert.equal(restored.readyState,'live');
});

test('phone fallback requests the opposite facing mode when device enumeration is restricted',()=>{
  assert.deepEqual(nextCamera({facingMode:'user'},[]),{facingMode:'environment'});
  assert.deepEqual(nextCamera({facingMode:'environment'},[]),{facingMode:'user'});
  assert.deepEqual(nextCamera({deviceId:'front'},[{deviceId:'front',kind:'videoinput'},{deviceId:'rear',kind:'videoinput'},{deviceId:'mic',kind:'audioinput'}]),{deviceId:'rear'});
});
