'use client';

import {useEffect,useRef,useState} from 'react';
import {CameraRecoveryError,nextCamera,replaceCamera,type CameraTarget} from '@/lib/media-camera';

type Configuration={actorId:string;peerId:string;isInitiator:boolean;relayConfigured:boolean;iceServers:RTCIceServer[]};
type Signal={id:number;actorId:string;type:string;payload:{callId?:string;sdp?:RTCSessionDescriptionInit;candidate?:RTCIceCandidateInit};createdAt:string};
class MediaRequestError extends Error {
  constructor(readonly status:number,message:string){super(message);this.name='MediaRequestError';}
}
async function request<T>(url:string,body?:unknown):Promise<T> {
  const response=await fetch(url,{cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const data=await response.json().catch(()=>({}));
  if (!response.ok) throw new MediaRequestError(response.status,data.error || 'Verbinding tijdelijk niet beschikbaar.');
  return data;
}

export function MediaRoom({matchId}:{matchId:string}) {
  const localVideo=useRef<HTMLVideoElement>(null),remoteVideo=useRef<HTMLVideoElement>(null);
  const stream=useRef<MediaStream|null>(null),peer=useRef<RTCPeerConnection|null>(null);
  const config=useRef<Configuration|null>(null),callId=useRef(''),cursor=useRef(0),poll=useRef<ReturnType<typeof setTimeout>|null>(null);
  const pendingIce=useRef<RTCIceCandidateInit[]>([]),running=useRef(false);
  const generation=useRef(0),cameraOperation=useRef(0),cameraBusy=useRef(false),connecting=useRef(false);
  const cameraAbort=useRef<AbortController|null>(null);
  const [preview,setPreview]=useState(false),[active,setActive]=useState(false),[video,setVideo]=useState(true),[audio,setAudio]=useState(true);
  const [status,setStatus]=useState('Test eerst je camera en microfoon. Je score blijft onafhankelijk van de video.'),[error,setError]=useState('');
  const [cameras,setCameras]=useState<MediaDeviceInfo[]>([]),[selectedCamera,setSelectedCamera]=useState(''),[switching,setSwitching]=useState(false),[opening,setOpening]=useState(false),[cameraNotice,setCameraNotice]=useState(''),[recovery,setRecovery]=useState<CameraTarget|null>(null);

  useEffect(()=>()=>{
    generation.current++;cameraOperation.current++;cameraBusy.current=false;
    cameraAbort.current?.abort();cameraAbort.current=null;
    running.current=false;
    if(poll.current)clearTimeout(poll.current);
    peer.current?.close();
    stream.current?.getTracks().forEach(track=>track.stop());
    peer.current=null;stream.current=null;
  },[matchId]);

  function releaseMedia(message:string) {
    generation.current++;cameraOperation.current++;cameraBusy.current=false;connecting.current=false;
    cameraAbort.current?.abort();cameraAbort.current=null;
    running.current=false;if(poll.current)clearTimeout(poll.current);poll.current=null;
    const connection=peer.current;peer.current=null;
    if(connection){connection.ontrack=null;connection.onicecandidate=null;connection.onconnectionstatechange=null;connection.close();}
    stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;
    if(localVideo.current)localVideo.current.srcObject=null;
    if(remoteVideo.current){(remoteVideo.current.srcObject as MediaStream|null)?.getTracks().forEach(track=>track.stop());remoteVideo.current.srcObject=null;}
    config.current=null;pendingIce.current=[];cursor.current=0;callId.current='';
    setActive(false);setPreview(false);setOpening(false);setSwitching(false);setRecovery(null);setCameraNotice('');setError('');setStatus(message);
  }
  function stopForAccessLoss(cause:unknown,version:number,connection?:RTCPeerConnection):boolean {
    if(!(cause instanceof MediaRequestError)||![401,403,404,410].includes(cause.status))return false;
    // An answer from an older call must never stop a replacement connection.
    if(generation.current===version&&(!connection||peer.current===connection))releaseMedia(cause.status===401?'Je sessie is verlopen. Camera en microfoon zijn gestopt. Log opnieuw in; je score blijft bewaard.':cause.status===403?'Je hebt geen toegang meer tot deze beeldverbinding. Camera en microfoon zijn gestopt; je score blijft bewaard.':'Deze beeldverbinding is niet meer beschikbaar. Camera en microfoon zijn gestopt; je score blijft bewaard.');
    return true;
  }

  async function discoverCameras(media:MediaStream) {
    try {const devices=await navigator.mediaDevices.enumerateDevices();if(stream.current===media){setCameras(devices.filter(device=>device.kind==='videoinput'));setSelectedCamera(media.getVideoTracks()[0]?.getSettings().deviceId||'');}}catch{/* Facing-mode switching remains available when enumeration is restricted. */}
  }
  async function switchCamera(target?:CameraTarget,releaseCurrent=false) {
    const media=stream.current,connection=peer.current,version=generation.current;
    if(!media||cameraBusy.current||connecting.current)return;
    const destination=target||nextCamera(media.getVideoTracks()[0]?.getSettings()||{},cameras);
    const operation=++cameraOperation.current;
    const controller=new AbortController();cameraAbort.current=controller;
    cameraBusy.current=true;setSwitching(true);setError('');setCameraNotice('');setRecovery(null);
    const isCurrent=()=>generation.current===version&&cameraOperation.current===operation&&stream.current===media&&peer.current===connection;
    try {
      await replaceCamera({localStream:media,connection,target:destination,getUserMedia:constraints=>navigator.mediaDevices.getUserMedia(constraints),isCurrent,releaseCurrent,signal:controller.signal});
      if(!isCurrent())return;
      if(localVideo.current)localVideo.current.srcObject=media;
      setVideo(Boolean(media.getVideoTracks()[0]?.enabled));setCameraNotice('Camera gewisseld. Je geluid en wedstrijd lopen door.');
      await discoverCameras(media);
    }catch(cause){
      if(!isCurrent())return;
      if(localVideo.current)localVideo.current.srcObject=media;
      if(cause instanceof CameraRecoveryError){setError(cause.message);setVideo(Boolean(media.getVideoTracks()[0]?.readyState==='live'&&media.getVideoTracks()[0]?.enabled));await discoverCameras(media);}
      else if(cause instanceof DOMException&&cause.name==='NotReadableError'){setError('Dit toestel kan niet twee camera’s tegelijk openen. Je huidige camera blijft actief.');setRecovery(destination);}
      else setError(cause instanceof DOMException&&cause.name==='NotAllowedError'?'Geen toestemming voor de andere camera. Je huidige camera blijft actief.':cause instanceof DOMException&&['NotFoundError','OverconstrainedError'].includes(cause.name)?'Geen andere camera beschikbaar. Je huidige camera blijft actief.':'De camera kon niet worden gewisseld. Je huidige camera blijft actief.');
    }finally{if(cameraOperation.current===operation){cameraAbort.current=null;cameraBusy.current=false;setSwitching(false);}}
  }

  async function signal(type:string,payload:Record<string,unknown>,version=generation.current) {
    if(!config.current||generation.current!==version)return;
    await request(`/api/platform/matches/${matchId}/signals`,{requestId:crypto.randomUUID(),targetId:config.current.peerId,type,payload:{...payload,callId:callId.current}});
  }
  async function startPreview() {
    setError('');
    if(stream.current)return stream.current;
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera en microfoon vereisen HTTPS en een ondersteunde browser.');
    const version=generation.current;setOpening(true);
    try {
      const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'user'}},audio:true});
      if(generation.current!==version){media.getTracks().forEach(track=>track.stop());throw new DOMException('Media operation cancelled','AbortError');}
      stream.current=media;
      if(localVideo.current)localVideo.current.srcObject=media;
      setPreview(true);setVideo(true);setAudio(true);setStatus('Je eigen beeld is zichtbaar. Start de verbinding wanneer jullie allebei klaar zijn.');
      void discoverCameras(media);
      return media;
    } catch {
      throw new Error('Geen toegang tot camera of microfoon. Controleer je browserrechten en probeer opnieuw.');
    }finally{if(generation.current===version)setOpening(false);}
  }
  async function acceptSignals(connection:RTCPeerConnection,initial:boolean,version:number) {
    const isCurrent=()=>generation.current===version&&running.current&&peer.current===connection;
    const data=await request<{signals:Signal[];cursor:number}>(`/api/platform/matches/${matchId}/signals?after=${cursor.current}`);
    if(!isCurrent())return;
    cursor.current=data.cursor;
    for(const item of data.signals){
      if(!isCurrent())return;
      if(item.actorId===config.current?.actorId || Date.parse(item.createdAt)<Date.now()-5*60*1000)continue;
      if(item.type==='offer' && !config.current?.isInitiator && item.payload.sdp && item.payload.callId){
        if(connection.signalingState!=='stable')continue;
        callId.current=item.payload.callId;
        await connection.setRemoteDescription(item.payload.sdp);
        if(!isCurrent())return;
        for(const candidate of pendingIce.current){await connection.addIceCandidate(candidate);if(!isCurrent())return;}
        pendingIce.current=[];
        const answer=await connection.createAnswer();if(!isCurrent())return;await connection.setLocalDescription(answer);if(!isCurrent())return;
        await signal('answer',{sdp:{type:answer.type,sdp:answer.sdp}},version);
      }else if(item.payload.callId===callId.current && item.type==='answer' && item.payload.sdp && connection.signalingState==='have-local-offer'){
        await connection.setRemoteDescription(item.payload.sdp);
        if(!isCurrent())return;
        for(const candidate of pendingIce.current){await connection.addIceCandidate(candidate);if(!isCurrent())return;}
        pendingIce.current=[];
      }else if(item.payload.callId===callId.current && item.type==='ice' && item.payload.candidate){
        if(connection.remoteDescription)await connection.addIceCandidate(item.payload.candidate);
        else pendingIce.current.push(item.payload.candidate);
      }else if(item.payload.callId===callId.current && ['leave','hangup'].includes(item.type)){
        setStatus('De andere speler heeft de beeldverbinding verlaten. Je kunt opnieuw verbinden.');
      }
    }
    if(isCurrent() && initial && config.current?.isInitiator){
      callId.current=crypto.randomUUID();
      const offer=await connection.createOffer();if(!isCurrent())return;await connection.setLocalDescription(offer);if(!isCurrent())return;
      await signal('offer',{sdp:{type:offer.type,sdp:offer.sdp}},version);
    }
  }
  async function connect() {
    if(cameraBusy.current||connecting.current)return;
    connecting.current=true;setOpening(true);const version=++generation.current;
    running.current=false;if(poll.current)clearTimeout(poll.current);poll.current=null;
    const previous=peer.current;peer.current=null;if(previous){previous.ontrack=null;previous.onicecandidate=null;previous.onconnectionstatechange=null;previous.close();}
    setError('');
    try {
      const media=await startPreview();
      const configuration=await request<Configuration>(`/api/media/${matchId}`);
      if(generation.current!==version)throw new DOMException('Media operation cancelled','AbortError');
      config.current=configuration;
      const connection=new RTCPeerConnection({iceServers:configuration.iceServers});peer.current=connection;
      const isCurrent=()=>generation.current===version&&running.current&&peer.current===connection;
      cursor.current=0;pendingIce.current=[];callId.current='';running.current=true;
      for(const track of media.getTracks())connection.addTrack(track,media);
      connection.ontrack=event=>{if(isCurrent()&&remoteVideo.current)remoteVideo.current.srcObject=event.streams[0] || new MediaStream([event.track]);};
      connection.onicecandidate=event=>{if(isCurrent()&&event.candidate)void signal('ice',{candidate:event.candidate.toJSON()},version).catch(cause=>{if(!stopForAccessLoss(cause,version,connection)&&isCurrent())setStatus('Netwerk onderbroken. Verbind opnieuw; de score blijft bewaard.');});};
      connection.onconnectionstatechange=()=>{
        if(!isCurrent())return;
        const state=connection.connectionState;
        setStatus(state==='connected'?'Beeld en geluid verbonden.':['failed','disconnected'].includes(state)?'Beeldverbinding onderbroken. Verbind opnieuw; de score blijft bewaard.':'Wachten op de andere speler…');
      };
      setActive(true);setStatus(config.current.relayConfigured?'Verbinding opzetten; de andere speler moet ook verbinden.':'Directe verbinding opzetten. Een relayserver is nog niet geconfigureerd.');
      await acceptSignals(connection,true,version);
      if(!isCurrent())return;
      const synchronize=async()=>{
        if(!isCurrent())return;
        try{await acceptSignals(connection,false,version);}catch(cause){if(!stopForAccessLoss(cause,version,connection)&&isCurrent())setStatus('Signaalverbinding onderbroken. Er wordt opnieuw gesynchroniseerd.');}
        if(isCurrent())poll.current=setTimeout(synchronize,1000);
      };
      poll.current=setTimeout(synchronize,500);
    }catch(cause){if(!stopForAccessLoss(cause,version)&&generation.current===version)setError(cause instanceof Error?cause.message:'Verbinding niet beschikbaar.');}finally{if(generation.current===version){connecting.current=false;setOpening(false);}}
  }
  async function stop() {
    const leaving=active?signal('leave',{}).catch(()=>undefined):Promise.resolve();
    releaseMedia('Camera en microfoon zijn gestopt.');
    await leaving;
  }
  function toggle(kind:'audio'|'video') {
    const tracks=kind==='video'?stream.current?.getVideoTracks():stream.current?.getAudioTracks();
    tracks?.forEach(track=>{track.enabled=!track.enabled;});
    if(kind==='video')setVideo(Boolean(tracks?.[0]?.enabled));else setAudio(Boolean(tracks?.[0]?.enabled));
  }
  return <section className="media-room" aria-label="Online camera en microfoon">
    <h2>Samen aan de oche</h2><p role="status">{status}</p>{error&&<p role="alert">{error}</p>}{cameraNotice&&<p role="status">{cameraNotice}</p>}
    <div className="media-grid"><figure><video ref={localVideo} muted autoPlay playsInline aria-label="Je eigen camerabeeld"/><figcaption>Jij · lokaal voorbeeld</figcaption></figure><figure><video ref={remoteVideo} autoPlay playsInline controls aria-label="Gedeeld beeld van de andere speler"/><figcaption>Andere speler</figcaption></figure></div>
    <div className="media-controls">
      {!preview&&<button disabled={opening} onClick={()=>void startPreview().catch(cause=>setError(cause.message))}>Camera en microfoon testen</button>}
      <button disabled={opening||switching} onClick={()=>void connect()}>{active?'Opnieuw verbinden':'Beeldverbinding starten'}</button>
      {preview&&<><button disabled={switching} onClick={()=>toggle('video')}>{video?'Camera uit':'Camera aan'}</button><button disabled={opening||switching} aria-busy={switching} onClick={()=>void switchCamera()}>{switching?'Camera wisselen…':'Camera wisselen'}</button>{cameras.length>2&&<label>Camera<select aria-label="Camera kiezen" disabled={opening||switching} value={selectedCamera} onChange={event=>void switchCamera({deviceId:event.target.value})}>{!selectedCamera&&<option value="">Huidige camera</option>}{cameras.map((camera,index)=><option key={camera.deviceId} value={camera.deviceId}>{camera.label||`Camera ${index+1}`}</option>)}</select></label>}<button onClick={()=>toggle('audio')}>{audio?'Microfoon uit':'Microfoon aan'}</button><button onClick={()=>void stop()}>Beeldverbinding verlaten</button></>}
    </div>
    {recovery&&<div className="notice"><p>Op dit toestel moet de huidige camera kort worden vrijgegeven. Je geluid blijft aan; als wisselen niet lukt, proberen we de vorige camera te herstellen.</p><button disabled={switching||opening} onClick={()=>void switchCamera(recovery,true)}>Camera omschakelen op dit toestel</button></div>}
  </section>;
}
