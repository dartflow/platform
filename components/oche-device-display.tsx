"use client";

import {useCallback,useEffect,useRef,useState} from 'react';
import type {OcheDisplaySnapshot,OcheEvents,OchePairing,OchePairingStatus} from '@/lib/oche-device-types';
import {OCHE_POLL_MS} from '@/lib/oche-device-types';
import {formattedOcheUserCode,OcheClientError,ocheDeviceRequest,withOcheInstallationLock,withOcheProfileLock} from '@/lib/oche-device-client';
import SprintDisplay from './sprint-display';
import OchePlayDisplay from './oche-play-display';
import {coreTacticsPlay} from '@/lib/oche-play-projection';
import OcheLiveStandby,{OcheFullscreen} from './oche-live-standby';
import BoardActivityNotice from './board-activity-notice';
import OcheCelebration,{useOcheCelebration} from './oche-celebration';
import {ClubBoardQr} from './club-board-screen';
import './oche-device.css';

const nonceKey='dartflow-oche-redeem-nonce',refreshNonceKey='dartflow-oche-refresh-nonce';
function publicNonce(key:string){try{const existing=localStorage.getItem(key);if(existing&&/^[a-f0-9-]{36}$/.test(existing))return existing;const nonce=crypto.randomUUID();localStorage.setItem(key,nonce);return nonce;}catch{return crypto.randomUUID();}}
function useDeviceWakeLock(){useEffect(()=>{let stopped=false,sentinel:WakeLockSentinel|null=null;const acquire=async()=>{if(stopped||document.visibilityState!=='visible'||!navigator.wakeLock||sentinel&&!sentinel.released)return;try{const next=await navigator.wakeLock.request('screen');if(stopped)void next.release();else sentinel=next;}catch{/* Some TV browsers manage their own ambient policy. */}};void acquire();document.addEventListener('visibilitychange',acquire);return()=>{stopped=true;void sentinel?.release();document.removeEventListener('visibilitychange',acquire);};},[]);}

export default function OcheDeviceDisplay(){
 const [snapshot,setSnapshot]=useState<OcheDisplaySnapshot|null>(null),[pairing,setPairing]=useState<OchePairing|null>(null),[qr,setQr]=useState(''),[offline,setOffline]=useState(false),[state,setState]=useState<'loading'|'pending'|'expired'|'revoked'|'display'>('loading'),[error,setError]=useState(''),[clock,setClock]=useState({server:0,received:0}),[now,setNow]=useState(0),[starting,setStarting]=useState(false);
 const current=useRef<OcheDisplaySnapshot|null>(null),pair=useRef<OchePairing|null>(null),refreshRef=useRef<()=>void>(()=>{}),startRef=useRef<()=>Promise<void>>(async()=>{}),startAttempt=useRef<string|null>(null),refreshAttempt=useRef<string|null>(null);
 useDeviceWakeLock();
 useEffect(()=>{current.current=snapshot;},[snapshot]);
 useEffect(()=>{pair.current=pairing;},[pairing]);
 useEffect(()=>{if(!clock.server)return;const tick=()=>setNow(clock.server+Date.now()-clock.received);tick();const timer=window.setInterval(tick,250);return()=>clearInterval(timer);},[clock]);
 useEffect(()=>{if(!pairing){setQr('');return;}let stopped=false;void import('qrcode').then(module=>module.toDataURL(pairing.verificationUrl,{width:640,margin:4,errorCorrectionLevel:'M',color:{dark:'#101511',light:'#ffffff'}})).then(image=>{if(!stopped)setQr(image);}).catch(()=>{});return()=>{stopped=true;};},[pairing]);
 useEffect(()=>{
  let stopped=false,busy=false,booting=true,nextPollAt=0,request:AbortController|null=null,mode:'initial'|'pending'|'display'|'terminal'='initial';
  const clearPrivate=()=>{current.current=null;pair.current=null;setSnapshot(null);setPairing(null);setQr('');};
  const accept=(next:OcheDisplaySnapshot)=>{if(stopped)return;current.current=next;setSnapshot(next);pair.current=null;setPairing(null);setState('display');setError('');setOffline(false);mode='display';};
  const loadSnapshot=async(signal:AbortSignal)=>{
   try{return await ocheDeviceRequest<OcheDisplaySnapshot>('snapshot',undefined,signal);}catch(cause){if(!(cause instanceof OcheClientError)||cause.status!==401)throw cause;return withOcheProfileLock('refresh',async()=>{try{return await ocheDeviceRequest<OcheDisplaySnapshot>('snapshot',undefined,signal);}catch(latest){if(!(latest instanceof OcheClientError)||latest.status!==401)throw latest;}refreshAttempt.current??=publicNonce(refreshNonceKey);await ocheDeviceRequest('refresh',{nonce:refreshAttempt.current},signal);refreshAttempt.current=null;try{localStorage.removeItem(refreshNonceKey);}catch{}return await ocheDeviceRequest<OcheDisplaySnapshot>('snapshot',undefined,signal);});}
  };
  const start=async()=>{if(stopped||busy||Date.now()<nextPollAt)return;busy=true;setStarting(true);setError('');request=new AbortController();const timeout=setTimeout(()=>request?.abort(),4000);try{startAttempt.current??=crypto.randomUUID();const next=await ocheDeviceRequest<OchePairing>('start',{platform:'browser',requestId:startAttempt.current},request.signal);if(stopped)return;startAttempt.current=null;try{localStorage.removeItem(nonceKey);}catch{}clearPrivate();pair.current=next;setPairing(next);setClock({server:next.serverNow,received:Date.now()});setState('pending');setOffline(false);mode='pending';}catch(cause){if(!stopped){if(cause instanceof OcheClientError&&cause.retryAfter)nextPollAt=Date.now()+cause.retryAfter*1000;setError(cause instanceof OcheClientError?cause.message:'Geen verbinding. Controleer het netwerk en probeer opnieuw.');setOffline(!(cause instanceof OcheClientError));}}finally{clearTimeout(timeout);busy=false;if(!stopped)setStarting(false);}};
  startRef.current=start;
  const refresh=async()=>{if(stopped||busy||Date.now()<nextPollAt||document.visibilityState==='hidden'||mode==='terminal')return;busy=true;request=new AbortController();const timeout=setTimeout(()=>request?.abort(),2500);
   try{
    if(mode==='display'&&current.current){const events=await ocheDeviceRequest<OcheEvents>(`events?after=${encodeURIComponent(current.current.eventId)}`,undefined,request.signal);accept(events.snapshot);return;}
    if(mode==='initial'){
     try{accept(await loadSnapshot(request.signal));return;}catch(cause){if(!(cause instanceof OcheClientError)||![401,403,404,410].includes(cause.status))throw cause;if(cause.status===410){clearPrivate();setState('revoked');setError(cause.message);setOffline(false);mode='terminal';return;}}
    }
    let status:OchePairingStatus;
    try{status=await ocheDeviceRequest<OchePairingStatus>('status',undefined,request.signal);}catch(cause){if(cause instanceof OcheClientError&&cause.status===401){if(mode==='pending'){clearPrivate();setState('expired');setOffline(false);mode='terminal';return;}busy=false;clearTimeout(timeout);await start();return;}throw cause;}
    if(stopped)return;setClock({server:status.serverNow,received:Date.now()});setOffline(false);setError('');
    if(status.state==='pending'){if(status.pairing){pair.current=status.pairing;setPairing(status.pairing);}setState('pending');mode='pending';}
    else if(status.state==='approved'||status.state==='redeemed'){await ocheDeviceRequest('redeem',{nonce:publicNonce(nonceKey)},request.signal);accept(await loadSnapshot(request.signal));}
    else{clearPrivate();setState(status.state==='expired'?'expired':'revoked');mode='terminal';}
   }catch(cause){if(stopped)return;if(cause instanceof OcheClientError&&[401,403,404,410].includes(cause.status)){
     let denial=cause;
     if(mode==='display'&&cause.status===401){try{accept(await loadSnapshot(request!.signal));return;}catch(refreshCause){if(!(refreshCause instanceof OcheClientError)||![401,403,404,410].includes(refreshCause.status)){if(refreshCause instanceof OcheClientError&&refreshCause.retryAfter)nextPollAt=Date.now()+refreshCause.retryAfter*1000;setOffline(true);setError(refreshCause instanceof OcheClientError?refreshCause.message:'Offline · Laatst ontvangen stand.');return;}denial=refreshCause;}}
     clearPrivate();setOffline(false);setState('revoked');setError(denial.message);mode='terminal';
    }else{if(cause instanceof OcheClientError&&cause.retryAfter)nextPollAt=Date.now()+cause.retryAfter*1000;setOffline(true);setError(cause instanceof OcheClientError?cause.message:'Offline · De actuele stand wordt na herstel opgehaald.');}
   }finally{clearTimeout(timeout);busy=false;}
  };
  refreshRef.current=()=>{if(mode==='terminal')return;void refresh();};
  const online=()=>{if(!booting)void refresh();},offlineEvent=()=>{setOffline(true);setError('Offline · De actuele stand wordt na herstel opgehaald.');request?.abort();},visible=()=>{if(!booting&&document.visibilityState==='visible')void refresh();};
  void withOcheInstallationLock(refresh).finally(()=>{booting=false;});const timer=window.setInterval(()=>{if(!booting)void refresh();},OCHE_POLL_MS);window.addEventListener('online',online);window.addEventListener('offline',offlineEvent);window.addEventListener('focus',online);document.addEventListener('visibilitychange',visible);
  return()=>{stopped=true;request?.abort();clearInterval(timer);window.removeEventListener('online',online);window.removeEventListener('offline',offlineEvent);window.removeEventListener('focus',online);document.removeEventListener('visibilitychange',visible);};
 },[]);
 const refresh=useCallback(()=>refreshRef.current(),[]);
 const paintNow=now||clock.server;
 const expired=state==='expired'||Boolean(pairing&&paintNow>=Date.parse(pairing.expiresAt));
 const seconds=pairing?Math.max(0,Math.ceil((Date.parse(pairing.expiresAt)-paintNow)/1000)):0;
 let pairingAddress='DartFlow → Schermen → Koppel scherm';
 try{const target=new URL(pairing?.verificationUrl??'');if(['https:','http:'].includes(target.protocol)&&target.host)pairingAddress=`${target.host}/koppel-scherm`;}catch{/* The account menu remains a safe fallback. */}
 const display=snapshot?.display;
 const play=display?.snapshot.play??(display?coreTacticsPlay(display.snapshot,snapshot?.serverNow??0):undefined);
 const homeWaiting=Boolean(snapshot?.scope==='home'&&display&&!display.snapshot.match&&!play);
 const cue=useOcheCelebration(display?.snapshot,Boolean(display)&&!offline);
 const overlay=<OcheCelebration cue={cue}/>;
 const controls=<a className="oche-device-manage-link" href="/app/schermen" aria-label="Schermen beheren">Schermen</a>;
 // Even a compromised or older response cannot turn a generic display into a score/extension interface.
 const activity=display?.snapshot.boardActivity?{...display.snapshot.boardActivity,canExtend:false}:undefined;
 return <div className="oche-device-display" data-device-state={state} data-layout="adaptive">
  {offline&&snapshot&&<div className="oche-device-offline" role="status">Offline · Laatst ontvangen stand. Na herstel halen we de actuele baan op.</div>}
  {state==='display'&&snapshot?(display&&!homeWaiting?<>{play?<OchePlayDisplay play={play} boardName={display.board.name} eventName={display.snapshot.event.name} stale={offline} theme={display.snapshot.theme?.id} qr={snapshot.board?<ClubBoardQr boardId={snapshot.board.id}/>:null} controls={controls}/>:display.snapshot.match?<SprintDisplay snapshot={display.snapshot} stale={offline} qr={snapshot.board?<ClubBoardQr boardId={snapshot.board.id}/>:null} scanInstruction="Score-invoer en Doorspelen via je telefoon" overlay={overlay} activityOverlay={<BoardActivityNotice activity={activity} display offline={offline} onRefresh={refresh}/>} controls={controls}/>:<OcheLiveStandby data={display} error="" stale={offline} needsPairing={false} pairForm={null} qr={snapshot.board?<figure className="oche-qr"><ClubBoardQr boardId={snapshot.board.id} variant="oche"/><figcaption>Open deze baan met je telefoon</figcaption></figure>:null} controls={controls} overlay={overlay} activityOverlay={<BoardActivityNotice activity={activity} display offline={offline} onRefresh={refresh}/>}/>}</>:<main className="oche-device-pending oche-device-unassigned"><img className="oche-device-logo" src="/assets/dartflow-logo.svg" alt="DartFlow"/><p className="eyebrow">Oche Live · {snapshot.device.name}</p><h1>{homeWaiting?'De partij staat klaar':snapshot.scope==='home'?'Klaar voor jouw wedstrijd':'Wacht op een baan'}</h1><p>{homeWaiting?'Start je gekozen partij op je telefoon. Dit scherm volgt daarna automatisch de actuele stand.':snapshot.scope==='home'?'Kies in Schermen de eigen wedstrijd of oefensessie die je hier wilt volgen.':'De locatiebeheerder kan een bestaande baan aan dit scherm toewijzen.'}</p>{offline&&<p role="status">Geen verbinding. De toewijzing wordt na herstel vernieuwd.</p>}<footer>{controls}<OcheFullscreen/></footer></main>):<main className="oche-device-pending"><img className="oche-device-logo" src="/assets/dartflow-logo.svg" alt="DartFlow"/><div className="oche-device-pairing-copy"><p className="eyebrow">Oche Live</p><h1>{state==='loading'?'Scherm openen…':state==='revoked'?'Scherm ontkoppeld':expired?'Koppelcode verlopen':'Koppel dit scherm'}</h1><p>{state==='revoked'?'Dit scherm heeft geen toegang meer. Vraag de eigenaar om een nieuwe koppeling.':expired?'De code is niet meer geldig. Maak een nieuwe code en bevestig die met je eigen account.':state==='loading'?'We herstellen de bestaande schermsessie.':`Scan de QR met je telefoon of open ${pairingAddress} en vul de code in.`}</p>{pairing&&!expired&&<><strong className="oche-device-code" aria-label={`Koppelcode ${formattedOcheUserCode(pairing.code)}`}>{formattedOcheUserCode(pairing.code)}</strong><p className="oche-device-validity">Geldig voor <span aria-hidden="true">{Math.floor(seconds/60).toString().padStart(2,'0')}:{(seconds%60).toString().padStart(2,'0')}</span><span className="visually-hidden">{Math.ceil(seconds/60)} minuten</span></p><a className="oche-device-pairing-link" href={pairing.verificationUrl}>Open de bevestigingspagina</a></>}{error&&<p className="oche-device-message" role="status">{error}</p>}<button className="button gold" onClick={()=>void startRef.current()} disabled={starting}>{starting?'Code maken…':pairing&&!expired?'Nieuwe code':state==='loading'?'Opnieuw proberen':'Nieuwe koppelcode'}</button></div>{pairing&&!expired&&<figure className="oche-device-pairing-qr">{qr?<img src={qr} alt="QR-code om dit scherm met je eigen account te koppelen" width={320} height={320}/>:<span role="status">QR laden…</span>}<figcaption>Scan om dit scherm te koppelen.<br/>Dit is geen speel-QR.</figcaption></figure>}<footer><span>Powered by DartFlow</span><OcheFullscreen/></footer></main>}
 </div>;
}
