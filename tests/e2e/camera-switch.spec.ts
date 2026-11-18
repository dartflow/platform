import {openMatchDetails} from './helpers/score-console';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { MatchView } from '../../lib/types';

test.use({ actionTimeout: 10000, launchOptions: {
  ...(process.env.DARTFLOW_BROWSER_PATH ? { executablePath: process.env.DARTFLOW_BROWSER_PATH } : {}),
  args: ['--autoplay-policy=no-user-gesture-required'],
} });
const origin='http://localhost:3000';
type Probe={connections:RTCPeerConnection[];tracks:MediaStreamTrack[];requests:MediaStreamConstraints[];failNext:string|null};
declare global { interface Window { cameraProbe: Probe } }

async function syntheticCameras(context:BrowserContext,frontColor:string) {
  await context.addInitScript(({frontColor})=>{
    const probe:Probe={connections:[],tracks:[],requests:[],failNext:null};
    window.cameraProbe=probe;
    const NativePeer=window.RTCPeerConnection;
    window.RTCPeerConnection=class extends NativePeer {constructor(configuration?:RTCConfiguration){super(configuration);probe.connections.push(this);}};
    const ids=['front','rear','extra'];
    Object.defineProperty(navigator.mediaDevices,'enumerateDevices',{value:async()=>ids.map((id,index)=>({deviceId:id,groupId:'synthetic-camera-fixture',kind:'videoinput',label:['Front fixture','Rear fixture','Extra fixture'][index],toJSON(){return {};}}))});
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async(constraints:MediaStreamConstraints)=>{
      probe.requests.push(constraints);
      if(probe.failNext){const name=probe.failNext;probe.failNext=null;throw new DOMException('Synthetic camera failure',name);}
      const video=typeof constraints.video==='object'?constraints.video:{};
      const exact=typeof video.deviceId==='object'&&!Array.isArray(video.deviceId)?video.deviceId.exact:null;
      const facing=typeof video.facingMode==='object'&&!Array.isArray(video.facingMode)?video.facingMode.exact:null;
      const id=typeof exact==='string'?exact:facing==='environment'?'rear':'front';
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
      const painter=canvas.getContext('2d')!;let frame=0;
      const draw=()=>{painter.fillStyle=id==='rear'?'rgb(20,20,230)':id==='extra'?'rgb(230,220,20)':frontColor;painter.fillRect(0,0,320,240);painter.fillStyle=frame++%2?'white':'black';painter.fillRect(0,0,12,12);};draw();
      const timer=setInterval(draw,50),media=canvas.captureStream(20),track=media.getVideoTracks()[0],settings=track.getSettings.bind(track),stop=track.stop.bind(track);
      Object.defineProperty(track,'getSettings',{value:()=>({...settings(),deviceId:id,facingMode:id==='front'?'user':'environment'})});
      track.stop=()=>{clearInterval(timer);stop();};probe.tracks.push(track);
      if(constraints.audio){const audio=new AudioContext();const oscillator=audio.createOscillator(),gain=audio.createGain(),output=audio.createMediaStreamDestination();oscillator.frequency.value=440;gain.gain.value=.15;oscillator.connect(gain).connect(output);oscillator.start();await audio.resume();const microphone=output.stream.getAudioTracks()[0],stopAudio=microphone.stop.bind(microphone);microphone.stop=()=>{stopAudio();oscillator.stop();void audio.close();};media.addTrack(microphone);probe.tracks.push(microphone);}
      return media;
    }});
  },{frontColor});
}
async function login(page:Page,name:string){await page.goto('/inloggen?next=/app');await page.getByRole('button',{name:new RegExp(name)}).click();await expect(page).toHaveURL('/app');}
async function command(context:BrowserContext,action:Record<string,unknown>){
  const overview=await(await context.request.get('/api/platform')).json();
  const entity=overview.lobbies.find((item:{id:string})=>item.id===action.id);
  const response=await context.request.post('/api/platform/actions',{headers:{Origin:origin},data:{requestId:randomUUID(),...(entity?{expectedRevision:entity.revision}:{}),action}});
  expect(response.status(),await response.text()).toBe(200);return response.json();
}
async function matchAction(context:BrowserContext,id:string,action:Record<string,unknown>):Promise<MatchView>{const state:MatchView=await(await context.request.get(`/api/matches/${id}`)).json();const response=await context.request.post(`/api/matches/${id}/actions`,{headers:{Origin:origin},data:{requestId:randomUUID(),matchId:id,expectedRevision:state.revision,action}});expect(response.status(),await response.text()).toBe(200);return response.json();}
async function pixel(page:Page){return page.getByLabel('Gedeeld beeld van de andere speler',{exact:true}).evaluate((video:HTMLVideoElement)=>{if(video.videoWidth===0)return[];const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;canvas.getContext('2d')!.drawImage(video,video.videoWidth/2,video.videoHeight/2,2,2,0,0,2,2);return [...canvas.getContext('2d')!.getImageData(0,0,1,1).data].slice(0,3);});}
async function audioReceived(page:Page){return page.evaluate(async()=>{const report=await window.cameraProbe.connections[0].getStats();let bytes=0,energy=0;report.forEach(item=>{if(item.type==='inbound-rtp'&&item.kind==='audio'){bytes+=item.bytesReceived||0;energy+=item.totalAudioEnergy||0;}});return {bytes,energy};});}
async function finishFixture(first:BrowserContext,second:BrowserContext,id:string){
  let state:MatchView=await(await first.request.get(`/api/matches/${id}`)).json();
  if(['called','ready'].includes(state.status)){
    if(!state.accepted[0])state=await matchAction(first,id,{type:'accept'});
    if(!state.accepted[1])state=await matchAction(second,id,{type:'accept'});
    state=await matchAction(first,id,{type:'start'});
  }
  for(let turn=0;state.status==='live'&&turn<8;turn++){const remaining=state.remaining[0];state=await matchAction(state.turn===0?first:second,id,{type:'score',score:state.turn===0?remaining>170?Math.min(180,remaining-40):remaining:0,...(state.turn===0&&remaining<=170?{doubleConfirmed:true}:{})});}
  if(state.status==='result'){
    if(!state.confirmations[0])state=await matchAction(first,id,{type:'confirm'});
    if(!state.confirmations[1])state=await matchAction(second,id,{type:'confirm'});
  }
  expect(state.status).toBe('confirmed');
}

test('camera switching changes actual remote frames without replacing audio, peer connection, or match state',async({browser,baseURL})=>{
  test.setTimeout(120000);
  if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Camera fixture requires the local application.');
  const first=await browser.newContext({viewport:{width:390,height:844}}),second=await browser.newContext();
  let ownedMatchId:string|undefined;
  try{
    if(!(await(await first.request.get('/api/session')).json()).local)throw Error('Local fixture authentication is required.');
    await syntheticCameras(first,'rgb(230,20,20)');await syntheticCameras(second,'rgb(20,230,20)');
    const a=await first.newPage(),b=await second.newPage();await login(a,'Michael de Groot');await login(b,'Raymond van Dijk');
    const lobby=await command(first,{type:'lobby.create',name:`Camera fixture ${randomUUID().slice(0,8)}`,setup:'remote',startScore:301,bestOfLegs:1});
    await command(second,{type:'lobby.join',id:lobby.id,code:lobby.code});await command(first,{type:'lobby.ready',id:lobby.id});await command(second,{type:'lobby.ready',id:lobby.id});
    const started=await command(first,{type:'lobby.start',id:lobby.id}),matchId=started.matchId;
    ownedMatchId=matchId;
    expect(matchId).toMatch(/^[a-f0-9-]{36}$/);
    await matchAction(first,matchId,{type:'accept'});await matchAction(second,matchId,{type:'accept'});const initial=await matchAction(first,matchId,{type:'start'});
    for(const page of[a,b]){await page.goto(`/wedstrijd/${matchId}`);await openMatchDetails(page);await page.getByRole('button',{name:'Camera en microfoon testen',exact:true}).click();await expect(page.getByRole('button',{name:'Camera wisselen',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Beeldverbinding starten',exact:true}).click();}
    for(const page of[a,b])await expect(page.getByText('Beeld en geluid verbonden.',{exact:true})).toBeVisible({timeout:20000});
    await expect.poll(async()=>{const rgb=await pixel(b);return rgb[0]>180&&rgb[1]<70&&rgb[2]<70;}).toBe(true);
    const originalAudio=await a.getByLabel('Je eigen camerabeeld',{exact:true}).evaluate((video:HTMLVideoElement)=>(video.srcObject as MediaStream).getAudioTracks()[0].id);
    const beforeAudio=await audioReceived(b);
    await a.getByRole('button',{name:'Camera wisselen',exact:true}).click();
    await expect.poll(async()=>{const rgb=await pixel(b);return rgb[2]>180&&rgb[0]<70&&rgb[1]<70;}).toBe(true);
    await expect.poll(async()=>{const now=await audioReceived(b);return now.bytes>beforeAudio.bytes&&now.energy>beforeAudio.energy;}).toBe(true);
    await expect(a.getByLabel('Camera kiezen',{exact:true})).toHaveValue('rear');
    expect(await a.getByLabel('Je eigen camerabeeld',{exact:true}).evaluate((video:HTMLVideoElement)=>(video.srcObject as MediaStream).getAudioTracks()[0].id)).toBe(originalAudio);
    for(const page of[a,b])expect(await page.evaluate(()=>window.cameraProbe.connections.length)).toBe(1);
    let state:MatchView=await(await first.request.get(`/api/matches/${matchId}`)).json();expect(state.revision).toBe(initial.revision);expect(state.remaining).toEqual([301,301]);expect(state.visits).toHaveLength(0);

    for(const failure of['NotAllowedError','NotFoundError']){
      const oldTrack=await a.getByLabel('Je eigen camerabeeld',{exact:true}).evaluate((video:HTMLVideoElement)=>(video.srcObject as MediaStream).getVideoTracks()[0].id);
      await a.evaluate(failure=>{window.cameraProbe.failNext=failure;},failure);
      await a.getByRole('button',{name:'Camera wisselen',exact:true}).click();
      await expect(a.getByRole('alert').filter({hasText:/Je huidige camera blijft actief/})).toBeVisible();
      expect(await a.getByLabel('Je eigen camerabeeld',{exact:true}).evaluate((video:HTMLVideoElement)=>(video.srcObject as MediaStream).getVideoTracks()[0].id)).toBe(oldTrack);
      await expect.poll(async()=>{const rgb=await pixel(b);return rgb[2]>180&&rgb[0]<70;}).toBe(true);
    }
    await a.getByRole('button',{name:'Camera uit',exact:true}).click();await a.getByRole('button',{name:'Microfoon uit',exact:true}).click();
    await a.getByLabel('Camera kiezen',{exact:true}).selectOption('front');
    await expect(a.getByLabel('Camera kiezen',{exact:true})).toHaveValue('front');
    expect(await a.getByLabel('Je eigen camerabeeld',{exact:true}).evaluate((video:HTMLVideoElement)=>{const stream=video.srcObject as MediaStream;return stream.getVideoTracks()[0].enabled||stream.getAudioTracks()[0].enabled;})).toBe(false);
    await a.getByRole('button',{name:'Camera aan',exact:true}).click();
    await expect.poll(async()=>{const rgb=await pixel(b);return rgb[0]>180&&rgb[2]<70;}).toBe(true);
    expect(await a.evaluate(()=>window.cameraProbe.requests.slice(1).every(item=>item.audio===false))).toBe(true);
    state=await matchAction(first,matchId,{type:'score',score:100});expect(state.remaining[0]).toBe(201);
    await expect(b.locator('.remaining').first()).toHaveText('201');
    for(const page of[a,b]){await page.getByRole('button',{name:'Beeldverbinding verlaten',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.cameraProbe.tracks.every(track=>track.readyState==='ended'))).toBe(true);}
    await finishFixture(first,second,matchId);ownedMatchId=undefined;
  }finally{
    if(ownedMatchId)await finishFixture(first,second,ownedMatchId).catch(()=>console.warn('Camera fixture cleanup did not complete.'));
    await Promise.allSettled([first.close(),second.close()]);
  }
});

test('revoked media access stops both peers and tracks without stopping scoring; transient failures retain the call',async({browser,baseURL})=>{
  test.setTimeout(120000);
  if(!baseURL||!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname))throw Error('Media access fixture requires the local application.');
  const first=await browser.newContext({viewport:{width:390,height:844}}),second=await browser.newContext();
  let ownedMatchId:string|undefined,blockedPlayerId:string|undefined;
  try{
    if(!(await(await first.request.get('/api/session')).json()).local)throw Error('Local fixture authentication is required.');
    await syntheticCameras(first,'rgb(230,20,20)');await syntheticCameras(second,'rgb(20,230,20)');
    const a=await first.newPage(),b=await second.newPage();await login(a,'Michael de Groot');await login(b,'Raymond van Dijk');
    const lobby=await command(first,{type:'lobby.create',name:`Media access fixture ${randomUUID().slice(0,8)}`,setup:'remote',startScore:301,bestOfLegs:1});
    await command(second,{type:'lobby.join',id:lobby.id,code:lobby.code});await command(first,{type:'lobby.ready',id:lobby.id});await command(second,{type:'lobby.ready',id:lobby.id});
    const started=await command(first,{type:'lobby.start',id:lobby.id}),matchId=started.matchId as string;ownedMatchId=matchId;
    await matchAction(first,matchId,{type:'accept'});await matchAction(second,matchId,{type:'accept'});const initial=await matchAction(first,matchId,{type:'start'});
    for(const page of[a,b]){await page.goto(`/wedstrijd/${matchId}`);await openMatchDetails(page);}

    let mediaStatus:number|null=null;
    await a.route(`**/api/media/${matchId}`,route=>mediaStatus===null?route.continue():route.fulfill({status:mediaStatus,contentType:'text/plain',body:'Media access unavailable'}));
    // Even an error page without JSON must retain its HTTP status and release preview devices.
    for(const status of[401,404,410]){
      mediaStatus=status;await a.getByRole('button',{name:'Camera en microfoon testen',exact:true}).click();
      await expect(a.getByRole('button',{name:'Camera wisselen',exact:true})).toBeEnabled();
      await a.getByRole('button',{name:'Beeldverbinding starten',exact:true}).click();
      await expect(a.getByRole('status').filter({hasText:status===401?'Je sessie is verlopen.':'Deze beeldverbinding is niet meer beschikbaar.'})).toBeVisible();
      expect(await a.evaluate(()=>window.cameraProbe.tracks.every(track=>track.readyState==='ended'))).toBe(true);
      expect(await a.getByLabel('Je eigen camerabeeld',{exact:true}).evaluate((video:HTMLVideoElement)=>video.srcObject===null)).toBe(true);
      expect(await a.evaluate(()=>window.cameraProbe.connections.length)).toBe(0);
    }
    mediaStatus=null;
    for(const page of[a,b]){await page.getByRole('button',{name:'Camera en microfoon testen',exact:true}).click();await expect(page.getByRole('button',{name:'Camera wisselen',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Beeldverbinding starten',exact:true}).click();}
    for(const page of[a,b])await expect(page.getByText('Beeld en geluid verbonden.',{exact:true})).toBeVisible({timeout:20000});
    await expect.poll(async()=>{const rgb=await pixel(b);return rgb[0]>180&&rgb[1]<70&&rgb[2]<70;}).toBe(true);

    const originalTracks=await a.evaluate(()=>window.cameraProbe.tracks.filter(track=>track.readyState==='live').map(track=>track.id));
    const failures=[500,429],statuses:number[]=[],polls=[0,0];
    for(const [index,page] of[a,b].entries())await page.route(`**/api/platform/matches/${matchId}/signals?after=*`,async route=>{
      polls[index]++;
      if(index===0&&failures.length){const status=failures.shift()!;statuses.push(status);return route.fulfill({status,json:{error:'Temporary synthetic signal failure'}});}
      const response=await route.fetch();if(index===0)statuses.push(response.status());await route.fulfill({response});
    });
    await expect.poll(()=>statuses).toEqual(expect.arrayContaining([500,429,200]));
    expect(await a.evaluate(()=>window.cameraProbe.tracks.filter(track=>track.readyState==='live').map(track=>track.id))).toEqual(originalTracks);
    expect(await a.evaluate(()=>window.cameraProbe.connections.at(-1)?.connectionState)).toBe('connected');
    await expect.poll(async()=>{const rgb=await pixel(b);return rgb[0]>180&&rgb[1]<70&&rgb[2]<70;}).toBe(true);

    blockedPlayerId=initial.players[1].id;await command(first,{type:'friend.block',userId:blockedPlayerId});
    for(const page of[a,b]){
      await expect(page.getByRole('status').filter({hasText:'Je hebt geen toegang meer tot deze beeldverbinding.'})).toBeVisible();
      expect(await page.evaluate(()=>window.cameraProbe.connections.every(connection=>connection.connectionState==='closed')&&window.cameraProbe.tracks.every(track=>track.readyState==='ended'))).toBe(true);
      for(const label of['Je eigen camerabeeld','Gedeeld beeld van de andere speler'])expect(await page.getByLabel(label,{exact:true}).evaluate((video:HTMLVideoElement)=>video.srcObject===null)).toBe(true);
      await expect(page.getByRole('button',{name:'Camera wisselen',exact:true})).toHaveCount(0);
    }
    const stoppedPolls=[...polls];await a.waitForTimeout(2200);expect(polls).toEqual(stoppedPolls);
    const before:MatchView=await(await first.request.get(`/api/matches/${matchId}`)).json();expect(before.revision).toBe(initial.revision);expect(before.remaining).toEqual([301,301]);
    const scored=await matchAction(first,matchId,{type:'score',score:100});expect(scored.remaining[0]).toBe(201);
    await expect(b.locator('.remaining').first()).toHaveText('201');
    await command(first,{type:'friend.unblock',userId:blockedPlayerId});blockedPlayerId=undefined;
    await finishFixture(first,second,matchId);ownedMatchId=undefined;
  }finally{
    if(blockedPlayerId)await command(first,{type:'friend.unblock',userId:blockedPlayerId}).catch(()=>console.warn('Media fixture block cleanup did not complete.'));
    if(ownedMatchId)await finishFixture(first,second,ownedMatchId).catch(()=>console.warn('Media fixture match cleanup did not complete.'));
    await Promise.allSettled([first.close(),second.close()]);
  }
});
