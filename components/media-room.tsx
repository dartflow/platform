'use client';

import {useEffect,useRef,useState} from 'react';

type Configuration={actorId:string;peerId:string;isInitiator:boolean;relayConfigured:boolean;iceServers:RTCIceServer[]};
type Signal={id:number;actorId:string;type:string;payload:{callId?:string;sdp?:RTCSessionDescriptionInit;candidate?:RTCIceCandidateInit};createdAt:string};
async function request<T>(url:string,body?:unknown):Promise<T> {
  const response=await fetch(url,{cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const data=await response.json();
  if (!response.ok) throw new Error(data.error || 'Verbinding tijdelijk niet beschikbaar.');
  return data;
}

export function MediaRoom({matchId}:{matchId:string}) {
  const localVideo=useRef<HTMLVideoElement>(null),remoteVideo=useRef<HTMLVideoElement>(null);
  const stream=useRef<MediaStream|null>(null),peer=useRef<RTCPeerConnection|null>(null);
  const config=useRef<Configuration|null>(null),callId=useRef(''),cursor=useRef(0),poll=useRef<ReturnType<typeof setTimeout>|null>(null);
  const pendingIce=useRef<RTCIceCandidateInit[]>([]),running=useRef(false);
  const [preview,setPreview]=useState(false),[active,setActive]=useState(false),[video,setVideo]=useState(true),[audio,setAudio]=useState(true);
  const [status,setStatus]=useState('Test eerst je camera en microfoon. Je score blijft onafhankelijk van de video.'),[error,setError]=useState('');

  useEffect(()=>()=>{
    running.current=false;
    if(poll.current)clearTimeout(poll.current);
    peer.current?.close();
    stream.current?.getTracks().forEach(track=>track.stop());
  },[matchId]);

  async function signal(type:string,payload:Record<string,unknown>) {
    if(!config.current)return;
    await request(`/api/platform/matches/${matchId}/signals`,{requestId:crypto.randomUUID(),targetId:config.current.peerId,type,payload:{...payload,callId:callId.current}});
  }
  async function startPreview() {
    setError('');
    if(stream.current)return stream.current;
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera en microfoon vereisen HTTPS en een ondersteunde browser.');
    try {
      const media=await navigator.mediaDevices.getUserMedia({video:true,audio:true});
      stream.current=media;
      if(localVideo.current)localVideo.current.srcObject=media;
      setPreview(true);setVideo(true);setAudio(true);setStatus('Je eigen beeld is zichtbaar. Start de verbinding wanneer jullie allebei klaar zijn.');
      return media;
    } catch {
      throw new Error('Geen toegang tot camera of microfoon. Controleer je browserrechten en probeer opnieuw.');
    }
  }
  async function acceptSignals(connection:RTCPeerConnection,initial:boolean) {
    const data=await request<{signals:Signal[];cursor:number}>(`/api/platform/matches/${matchId}/signals?after=${cursor.current}`);
    cursor.current=data.cursor;
    for(const item of data.signals){
      if(item.actorId===config.current?.actorId || Date.parse(item.createdAt)<Date.now()-5*60*1000)continue;
      if(item.type==='offer' && !config.current?.isInitiator && item.payload.sdp && item.payload.callId){
        if(connection.signalingState!=='stable')continue;
        callId.current=item.payload.callId;
        await connection.setRemoteDescription(item.payload.sdp);
        for(const candidate of pendingIce.current)await connection.addIceCandidate(candidate);
        pendingIce.current=[];
        const answer=await connection.createAnswer();await connection.setLocalDescription(answer);
        await signal('answer',{sdp:{type:answer.type,sdp:answer.sdp}});
      }else if(item.payload.callId===callId.current && item.type==='answer' && item.payload.sdp && connection.signalingState==='have-local-offer'){
        await connection.setRemoteDescription(item.payload.sdp);
        for(const candidate of pendingIce.current)await connection.addIceCandidate(candidate);
        pendingIce.current=[];
      }else if(item.payload.callId===callId.current && item.type==='ice' && item.payload.candidate){
        if(connection.remoteDescription)await connection.addIceCandidate(item.payload.candidate);
        else pendingIce.current.push(item.payload.candidate);
      }else if(item.payload.callId===callId.current && ['leave','hangup'].includes(item.type)){
        setStatus('De andere speler heeft de beeldverbinding verlaten. Je kunt opnieuw verbinden.');
      }
    }
    if(initial && config.current?.isInitiator){
      callId.current=crypto.randomUUID();
      const offer=await connection.createOffer();await connection.setLocalDescription(offer);
      await signal('offer',{sdp:{type:offer.type,sdp:offer.sdp}});
    }
  }
  async function connect() {
    setError('');
    try {
      const media=await startPreview();
      config.current=await request<Configuration>(`/api/media/${matchId}`);
      peer.current?.close();
      const connection=new RTCPeerConnection({iceServers:config.current.iceServers});peer.current=connection;
      cursor.current=0;pendingIce.current=[];callId.current='';running.current=true;
      for(const track of media.getTracks())connection.addTrack(track,media);
      connection.ontrack=event=>{if(remoteVideo.current)remoteVideo.current.srcObject=event.streams[0] || new MediaStream([event.track]);};
      connection.onicecandidate=event=>{if(event.candidate)void signal('ice',{candidate:event.candidate.toJSON()}).catch(()=>setStatus('Netwerk onderbroken. Verbind opnieuw; de score blijft bewaard.'));};
      connection.onconnectionstatechange=()=>{
        const state=connection.connectionState;
        setStatus(state==='connected'?'Beeld en geluid verbonden.':['failed','disconnected'].includes(state)?'Beeldverbinding onderbroken. Verbind opnieuw; de score blijft bewaard.':'Wachten op de andere speler…');
      };
      setActive(true);setStatus(config.current.relayConfigured?'Verbinding opzetten; de andere speler moet ook verbinden.':'Directe verbinding opzetten. Een relayserver is nog niet geconfigureerd.');
      await acceptSignals(connection,true);
      const synchronize=async()=>{
        if(!running.current || peer.current!==connection)return;
        try{await acceptSignals(connection,false);}catch{setStatus('Signaalverbinding onderbroken. Er wordt opnieuw gesynchroniseerd.');}
        if(running.current)poll.current=setTimeout(synchronize,1000);
      };
      poll.current=setTimeout(synchronize,500);
    }catch(cause){setError(cause instanceof Error?cause.message:'Verbinding niet beschikbaar.');}
  }
  async function stop() {
    if(active)await signal('leave',{}).catch(()=>undefined);
    running.current=false;if(poll.current)clearTimeout(poll.current);
    peer.current?.close();peer.current=null;stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;
    if(localVideo.current)localVideo.current.srcObject=null;if(remoteVideo.current)remoteVideo.current.srcObject=null;
    setActive(false);setPreview(false);setStatus('Camera en microfoon zijn gestopt.');
  }
  function toggle(kind:'audio'|'video') {
    const tracks=kind==='video'?stream.current?.getVideoTracks():stream.current?.getAudioTracks();
    tracks?.forEach(track=>{track.enabled=!track.enabled;});
    if(kind==='video')setVideo(Boolean(tracks?.[0]?.enabled));else setAudio(Boolean(tracks?.[0]?.enabled));
  }
  return <section className="media-room" aria-label="Online camera en microfoon">
    <h2>Samen aan de oche</h2><p role="status">{status}</p>{error&&<p role="alert">{error}</p>}
    <div className="media-grid"><figure><video ref={localVideo} muted autoPlay playsInline aria-label="Je eigen camerabeeld"/><figcaption>Jij · lokaal voorbeeld</figcaption></figure><figure><video ref={remoteVideo} autoPlay playsInline controls aria-label="Gedeeld beeld van de andere speler"/><figcaption>Andere speler</figcaption></figure></div>
    <div className="media-controls">
      {!preview&&<button onClick={()=>void startPreview().catch(cause=>setError(cause.message))}>Camera en microfoon testen</button>}
      <button onClick={()=>void connect()}>{active?'Opnieuw verbinden':'Beeldverbinding starten'}</button>
      {preview&&<><button onClick={()=>toggle('video')}>{video?'Camera uit':'Camera aan'}</button><button onClick={()=>toggle('audio')}>{audio?'Microfoon uit':'Microfoon aan'}</button><button onClick={()=>void stop()}>Beeldverbinding verlaten</button></>}
    </div>
  </section>;
}
