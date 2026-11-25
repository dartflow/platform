"use client";

import {useCallback,useEffect,useRef,useState} from 'react';
import type {OcheDisplaySnapshot,OcheEvents,OchePairing,OchePairingStatus} from '@/lib/oche-device-types';
import {OCHE_POLL_MS} from '@/lib/oche-device-types';
import {formattedOcheUserCode,OcheClientError,ocheDeviceRequest,withOcheInstallationLock,withOcheProfileLock} from '@/lib/oche-device-client';
import OcheLayoutWizard,{ocheDpad} from './oche-layout-wizard';
import OcheDevicePanel,{OchePanelBoundary,OcheDeviceWayfinding} from './oche-device-panel';
import {OcheFullscreen} from './oche-live-standby';
import {OCHE_LAYOUT_KEY,OCHE_LAYOUT_LATER_KEY,OCHE_LAYOUT_PROPOSAL_KEY,hasActiveOcheMatch,ocheLayoutName,ochePanelEventGap,readOcheLayout,saveOcheLayout} from '@/lib/oche-layout';
import type {OcheLayout} from '@/lib/oche-device-types';
import {OcheScreenThemeProvider} from './oche-screen-theme';
import {OcheBrand} from './oche-brand';
import './oche-device.css';

function browserLayout(){try{return readOcheLayout(window.localStorage);}catch{return null;}}
const startKey='dartflow-oche-start-operation',nonceKey='dartflow-oche-redeem-nonce',refreshNonceKey='dartflow-oche-refresh-nonce';
function publicNonce(key:string){try{const existing=localStorage.getItem(key);if(existing&&/^[a-f0-9-]{36}$/.test(existing))return existing;const nonce=crypto.randomUUID();localStorage.setItem(key,nonce);return nonce;}catch{return crypto.randomUUID();}}
function useDeviceWakeLock(active:boolean){useEffect(()=>{if(!active)return;let stopped=false,sentinel:WakeLockSentinel|null=null;const acquire=async()=>{if(stopped||document.visibilityState!=='visible'||!navigator.wakeLock||sentinel&&!sentinel.released)return;try{const next=await navigator.wakeLock.request('screen');if(stopped)void next.release();else sentinel=next;}catch{/* Some TV browsers manage their own ambient policy. */}};void acquire();document.addEventListener('visibilitychange',acquire);return()=>{stopped=true;void sentinel?.release();document.removeEventListener('visibilitychange',acquire);};},[active]);}

export default function OcheDeviceDisplay(){
 const [snapshot,setSnapshot]=useState<OcheDisplaySnapshot|null>(null),[pairing,setPairing]=useState<OchePairing|null>(null),[qr,setQr]=useState(''),[offline,setOffline]=useState(false),[state,setState]=useState<'loading'|'pending'|'expired'|'revoked'|'display'|'setup'>('loading'),[error,setError]=useState(''),[clock,setClock]=useState({server:0,received:0}),[now,setNow]=useState(0),[starting,setStarting]=useState(false);
 const [wizard,setWizard]=useState<'initial'|'legacy'|'settings'|null>(null),[layoutError,setLayoutError]=useState(''),[layoutBusy,setLayoutBusy]=useState(false),[menu,setMenu]=useState(false),[proposal,setProposal]=useState<OchePairing|null>(null),[proposalQr,setProposalQr]=useState(''),[generation,setGeneration]=useState(0),[panelGeneration,setPanelGeneration]=useState<Record<string,number>>({});
 const proposalRevision=useRef<number|null>(null),wizardShown=useRef(false),menuRoot=useRef<HTMLDivElement>(null);
 const current=useRef<OcheDisplaySnapshot|null>(null),pair=useRef<OchePairing|null>(null),refreshRef=useRef<()=>void>(()=>{}),startRef=useRef<()=>Promise<void>>(async()=>{}),startAttempt=useRef<string|null>(null),refreshAttempt=useRef<string|null>(null);
 useDeviceWakeLock(Boolean(pairing&&(now||clock.server)<Date.parse(pairing.expiresAt))||Boolean(proposal&&(now||clock.server)<Date.parse(proposal.expiresAt))||Boolean(snapshot&&hasActiveOcheMatch(snapshot)));
 useEffect(()=>{current.current=snapshot;},[snapshot]);
 useEffect(()=>{pair.current=pairing;},[pairing]);
 useEffect(()=>{if(!clock.server)return;const tick=()=>setNow(clock.server+Date.now()-clock.received);tick();const timer=window.setInterval(tick,250);return()=>clearInterval(timer);},[clock]);
 useEffect(()=>{if(!pairing){setQr('');return;}let stopped=false;void import('qrcode').then(module=>module.toDataURL(pairing.verificationUrl,{width:640,margin:4,errorCorrectionLevel:'M',color:{dark:'#101511',light:'#ffffff'}})).then(image=>{if(!stopped)setQr(image);}).catch(()=>{});return()=>{stopped=true;};},[pairing]);
 useEffect(()=>{
  let stopped=false,busy=false,booting=true,nextPollAt=0,request:AbortController|null=null,baseline=true,mode:'initial'|'pending'|'display'|'terminal'='initial';
  const clearPrivate=()=>{setWizard(null);setMenu(false);setProposal(null);setProposalQr('');current.current=null;pair.current=null;setSnapshot(null);setPairing(null);setQr('');};
  const accept=(next:OcheDisplaySnapshot,reset=false)=>{if(stopped)return;if(reset||baseline){setGeneration(value=>value+1);baseline=false;}else{for(const panel of next.panels??[]){const previous=current.current?.panels?.find(item=>item.position===panel.position);if(previous?.sourceId===panel.sourceId&&ochePanelEventGap(previous?.snapshot,panel.snapshot))setPanelGeneration(value=>({...value,[panel.position]:(value[panel.position]??0)+1}));}}current.current=next;setSnapshot(next);pair.current=null;setPairing(null);setState('display');setError('');setOffline(false);mode='display';};
  const loadSnapshot=async(signal:AbortSignal)=>{
   try{return await ocheDeviceRequest<OcheDisplaySnapshot>('snapshot?panels=1',undefined,signal);}catch(cause){if(!(cause instanceof OcheClientError)||cause.status!==401)throw cause;return withOcheProfileLock('refresh',async()=>{try{return await ocheDeviceRequest<OcheDisplaySnapshot>('snapshot?panels=1',undefined,signal);}catch(latest){if(!(latest instanceof OcheClientError)||latest.status!==401)throw latest;}refreshAttempt.current??=publicNonce(refreshNonceKey);await ocheDeviceRequest('refresh',{nonce:refreshAttempt.current},signal);refreshAttempt.current=null;try{localStorage.removeItem(refreshNonceKey);}catch{}return await ocheDeviceRequest<OcheDisplaySnapshot>('snapshot?panels=1',undefined,signal);});}
  };
  const start=async()=>{if(stopped||busy||Date.now()<nextPollAt)return;const layout=browserLayout();if(!layout){mode='terminal';setState('setup');setWizard('initial');return;}busy=true;setStarting(true);setError('');request=new AbortController();const timeout=setTimeout(()=>request?.abort(),4000);try{if(!startAttempt.current){let operation:{requestId:string;layoutProposal:OcheLayout}|null=null;try{operation=JSON.parse(localStorage.getItem(startKey)??'null') as {requestId:string;layoutProposal:OcheLayout}|null;}catch{}startAttempt.current=operation&&JSON.stringify(operation.layoutProposal)===JSON.stringify(layout)?operation.requestId:crypto.randomUUID();localStorage.setItem(startKey,JSON.stringify({requestId:startAttempt.current,layoutProposal:layout}));}const next=await ocheDeviceRequest<OchePairing>('start',{platform:'browser',requestId:startAttempt.current,layoutProposal:layout},request.signal);if(stopped)return;startAttempt.current=null;try{localStorage.removeItem(startKey);localStorage.removeItem(nonceKey);}catch{}clearPrivate();pair.current=next;setPairing(next);setClock({server:next.serverNow,received:Date.now()});setState('pending');setOffline(false);mode='pending';}catch(cause){if(!stopped){setState('expired');if(cause instanceof OcheClientError&&cause.retryAfter)nextPollAt=Date.now()+cause.retryAfter*1000;setError(cause instanceof OcheClientError?cause.message:'Geen verbinding. Controleer het netwerk en probeer opnieuw.');setOffline(!(cause instanceof OcheClientError));}}finally{clearTimeout(timeout);busy=false;if(!stopped)setStarting(false);}};
  startRef.current=start;
  const refresh=async()=>{if(stopped||busy||Date.now()<nextPollAt||document.visibilityState==='hidden'||mode==='terminal')return;busy=true;request=new AbortController();const timeout=setTimeout(()=>request?.abort(),2500);
   try{
    if(mode==='display'&&current.current){const events=await ocheDeviceRequest<OcheEvents>(`events?panels=1&after=${encodeURIComponent(current.current.eventId)}`,undefined,request.signal);accept(events.snapshot,events.reset&&!events.snapshot.panels);return;}
    if(mode==='initial'){
     try{accept(await loadSnapshot(request.signal));return;}catch(cause){if(!(cause instanceof OcheClientError)||![401,403,404,410].includes(cause.status))throw cause;if(cause.status===410){clearPrivate();setState('revoked');setError(cause.message);setOffline(false);mode='terminal';return;}}
    }
    let status:OchePairingStatus;
    try{status=await ocheDeviceRequest<OchePairingStatus>('status',undefined,request.signal);}catch(cause){if(cause instanceof OcheClientError&&cause.status===401){if(mode==='pending'){clearPrivate();setState('expired');setOffline(false);mode='terminal';return;}busy=false;clearTimeout(timeout);await start();return;}throw cause;}
    if(stopped)return;setClock({server:status.serverNow,received:Date.now()});setOffline(false);setError('');
    if(status.state==='pending'){if(!browserLayout()){mode='terminal';setState('setup');setWizard('initial');return;}if(status.pairing){pair.current=status.pairing;setPairing(status.pairing);}setState('pending');mode='pending';}
    else if(status.state==='approved'||status.state==='redeemed'){await ocheDeviceRequest('redeem',{nonce:publicNonce(nonceKey)},request.signal);accept(await loadSnapshot(request.signal));}
    else{clearPrivate();setState(status.state==='expired'?'expired':'revoked');mode='terminal';}
   }catch(cause){if(stopped)return;if(cause instanceof OcheClientError&&[401,403,404,410].includes(cause.status)){
     let denial=cause;
     if(mode==='display'&&cause.status===401){if(cause.code==='device_assignment_changed'){current.current=null;setSnapshot(null);setGeneration(value=>value+1);baseline=true;mode='initial';}try{accept(await loadSnapshot(request!.signal));return;}catch(refreshCause){if(!(refreshCause instanceof OcheClientError)||![401,403,404,410].includes(refreshCause.status)){if(refreshCause instanceof OcheClientError&&refreshCause.retryAfter)nextPollAt=Date.now()+refreshCause.retryAfter*1000;setOffline(true);setError(refreshCause instanceof OcheClientError?refreshCause.message:'Offline · Laatst ontvangen stand.');return;}denial=refreshCause;}}
     clearPrivate();setOffline(false);setState('revoked');setError(denial.message);mode='terminal';
    }else{if(cause instanceof OcheClientError&&cause.retryAfter)nextPollAt=Date.now()+cause.retryAfter*1000;setOffline(true);setError(cause instanceof OcheClientError?cause.message:'Offline · De actuele stand wordt na herstel opgehaald.');}
   }finally{clearTimeout(timeout);busy=false;}
  };
  refreshRef.current=()=>{if(mode==='terminal')return;void refresh();};
  const online=()=>{baseline=true;if(!booting)void refresh();},offlineEvent=()=>{baseline=true;setOffline(true);setError('Offline · De actuele stand wordt na herstel opgehaald.');request?.abort();},visible=()=>{if(!booting&&document.visibilityState==='visible'){baseline=true;void refresh();}};
  const storageChanged=(event:StorageEvent)=>{if(event.key===OCHE_LAYOUT_KEY&&mode==='terminal'&&!current.current&&!pair.current){mode='initial';setWizard(null);setState('loading');void withOcheInstallationLock(refresh);}};window.addEventListener('storage',storageChanged);
  void withOcheInstallationLock(refresh).finally(()=>{booting=false;});const timer=window.setInterval(()=>{if(!booting)void refresh();},OCHE_POLL_MS);window.addEventListener('online',online);window.addEventListener('offline',offlineEvent);window.addEventListener('focus',online);document.addEventListener('visibilitychange',visible);
  return()=>{stopped=true;request?.abort();clearInterval(timer);window.removeEventListener('storage',storageChanged);window.removeEventListener('online',online);window.removeEventListener('offline',offlineEvent);window.removeEventListener('focus',online);document.removeEventListener('visibilitychange',visible);};
 },[]);
 const refresh=useCallback(()=>refreshRef.current(),[]);
 const paintNow=now||clock.server;
 const expired=state==='expired'||Boolean(pairing&&paintNow>=Date.parse(pairing.expiresAt));
 const seconds=pairing?Math.max(0,Math.ceil((Date.parse(pairing.expiresAt)-paintNow)/1000)):0;
 let pairingAddress='DartFlow → Schermen → Koppel scherm';
 try{const target=new URL(pairing?.verificationUrl??'');if(['https:','http:'].includes(target.protocol)&&target.host)pairingAddress=`${target.host}/koppel-scherm`;}catch{/* The account menu remains a safe fallback. */}
 useEffect(()=>{
  if(!snapshot||wizardShown.current||snapshot.layout||hasActiveOcheMatch(snapshot))return;
  try{if(localStorage.getItem(OCHE_LAYOUT_LATER_KEY)||browserLayout())return;}catch{}
  wizardShown.current=true;setWizard('legacy');
 },[snapshot]);
 useEffect(()=>{if(proposal&&snapshot&&snapshot.configurationRevision!==proposalRevision.current){setProposal(null);setProposalQr('');proposalRevision.current=null;}},[snapshot,proposal]);
 useEffect(()=>{if(!proposal){setProposalQr('');return;}let stopped=false;void import('qrcode').then(module=>module.toDataURL(proposal.verificationUrl,{width:640,margin:4,errorCorrectionLevel:'M'})).then(value=>{if(!stopped)setProposalQr(value);}).catch(()=>{});return()=>{stopped=true;};},[proposal]);
 useEffect(()=>{if(!menu)return;menuRoot.current?.querySelector<HTMLElement>('button')?.focus();const timer=setTimeout(()=>setMenu(false),30000);return()=>clearTimeout(timer);},[menu]);
 function closeWizard(){try{localStorage.setItem(OCHE_LAYOUT_LATER_KEY,'1');}catch{}setWizard(null);setLayoutError('');}
 async function saveLayout(layout:OcheLayout){
  if(layoutBusy)return;setLayoutBusy(true);setLayoutError('');
  try{
   saveOcheLayout(localStorage,layout);
   if(current.current){
    if(current.current.configurationRevision===undefined){setLayoutError('Deze server ondersteunt schermindeling nog niet. Het huidige scorebord blijft beschikbaar. Werk eerst de webbackend bij.');return;}
    let operation:{layout:OcheLayout;requestId:string}|null=null;
    try{operation=JSON.parse(localStorage.getItem(OCHE_LAYOUT_PROPOSAL_KEY)??'null') as {layout:OcheLayout;requestId:string}|null;}catch{}
    if(!operation||JSON.stringify(operation.layout)!==JSON.stringify(layout)){operation={layout,requestId:crypto.randomUUID()};localStorage.setItem(OCHE_LAYOUT_PROPOSAL_KEY,JSON.stringify(operation));}
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),4000);let next:OchePairing;try{next=await ocheDeviceRequest<OchePairing>('layout-proposal',operation,controller.signal);}finally{clearTimeout(timeout);}
    proposalRevision.current=current.current.configurationRevision??null;setClock({server:next.serverNow,received:Date.now()});setProposal(next);setProposalQr('');localStorage.removeItem(OCHE_LAYOUT_PROPOSAL_KEY);
   }else{await withOcheInstallationLock(startRef.current);}
   setWizard(null);wizardShown.current=true;
  }catch(cause){setLayoutError(cause instanceof Error?cause.message:'De schermindeling kon niet worden opgeslagen. Probeer opnieuw.');}
  finally{setLayoutBusy(false);}
 }
 const effective=snapshot?.layout??(snapshot&&snapshot.layout===undefined?(()=>{try{const saved=browserLayout();return saved?{...saved,scoreboards:1 as const}:null;}catch{return null;}})():null);
 const layout=effective?.scoreboards===2?'dual':effective?.orientation??'adaptive';
 const primary=snapshot?.panels?.find(panel=>panel.position==='left');
 const panels=layout==='dual'?(['left','right'] as const).map(position=>snapshot?.panels?.find(panel=>panel.position===position)??{position,sourceId:null,status:'unassigned' as const,snapshot:null}):null;
 const controls=<div className="oche-device-tools" inert={Boolean(wizard||proposal||menu)}><button type="button" aria-label="Schermmenu" aria-expanded={menu} onClick={()=>setMenu(value=>!value)}>•••</button><OcheFullscreen/></div>;
 const theme=snapshot?.theme??snapshot?.display?.snapshot.theme??snapshot?.panels?.find(panel=>panel.snapshot?.display)?.snapshot?.display?.snapshot.theme;
 return <OcheScreenThemeProvider theme={state==='display'?theme:undefined} serverNow={snapshot?.serverNow??0}><div className="oche-device-display" data-device-state={state} data-layout={layout}>
  {offline&&snapshot&&<div className="oche-device-offline" role="status">Offline · Laatst ontvangen stand. Na herstel halen we de actuele baan op.</div>}
  {state==='display'&&snapshot?<div className="oche-device-surface" inert={Boolean(wizard||proposal||menu)}>{panels?<div className="oche-device-panels">{panels.map(panel=><section className="oche-device-panel" data-position={panel.position} key={panel.position} aria-describedby={`oche-lane-${panel.position}`} aria-label={panel.position==='left'?'Baan links':'Baan rechts'}><OchePanelBoundary key={`${generation}:${panelGeneration[panel.position]??0}:${snapshot.device.grantVersion}:${panel.sourceId}:${panel.snapshot?.display?.snapshot.sessionKey??panel.snapshot?.display?.snapshot.match?.id??''}`}><OcheDevicePanel snapshot={panel.snapshot} status={panel.status} offline={offline} compact refresh={refresh}/></OchePanelBoundary></section>)}<OcheDeviceWayfinding panels={panels} offline={offline}/></div>:<OchePanelBoundary key={`${generation}:${snapshot.device.grantVersion}:${snapshot.board?.id}:${snapshot.display?.snapshot.sessionKey??snapshot.display?.snapshot.match?.id??''}`}><OcheDevicePanel snapshot={primary?.snapshot??snapshot} status={primary?.status} offline={offline} refresh={refresh}/></OchePanelBoundary>}</div>:state!=='setup'?<main className="oche-device-pending"><OcheBrand className="oche-device-logo"/><div className="oche-device-pairing-copy"><p className="eyebrow">Oche Live</p><h1>{state==='loading'?'Scherm openen…':state==='revoked'?'Scherm ontkoppeld':expired?'Koppelcode verlopen':'Koppel dit scherm'}</h1><p>{state==='revoked'?'Dit scherm heeft geen toegang meer. Vraag de eigenaar om een nieuwe koppeling.':expired?'De code is niet meer geldig. Maak een nieuwe code en bevestig die met je eigen account.':state==='loading'?'We herstellen de bestaande schermsessie.':`Scan de QR met je telefoon of open ${pairingAddress} en vul de code in.`}</p>{pairing&&!expired&&<><strong className="oche-device-code" aria-label={`Koppelcode ${formattedOcheUserCode(pairing.code)}`}>{formattedOcheUserCode(pairing.code)}</strong><p className="oche-device-validity">Geldig voor <span>{Math.floor(seconds/60).toString().padStart(2,'0')}:{(seconds%60).toString().padStart(2,'0')}</span></p><a className="oche-device-pairing-link" href={pairing.verificationUrl}>Open de bevestigingspagina</a></>}{error&&<p className="oche-device-message" role="status">{error}</p>}<button className="button gold" onClick={()=>void startRef.current()} disabled={starting}>{starting?'Code maken…':pairing&&!expired?'Nieuwe code':state==='loading'?'Opnieuw proberen':'Nieuwe koppelcode'}</button></div>{pairing&&!expired&&<figure className="oche-device-pairing-qr">{qr?<img src={qr} alt="QR-code om dit scherm met je eigen account te koppelen" width={320} height={320}/>:<span role="status">QR laden…</span>}<figcaption>Scan om dit scherm te koppelen.<br/>Dit is geen speel-QR.</figcaption></figure>}<footer><span>Powered by DartFlow</span></footer></main>:null}
  {controls}
  {menu&&<div ref={menuRoot} className="oche-device-menu" role="dialog" aria-label="Schermmenu" onKeyDown={event=>ocheDpad(event,()=>setMenu(false))}><h2>Oche Live</h2><p>{ocheLayoutName(snapshot?.layout)}</p>{snapshot&&snapshot.configurationRevision===undefined&&<p>Twee scoreborden zijn beschikbaar na een update van de webbackend. Dit scherm volgt nu één scorebord.</p>}<button type="button" onClick={()=>{setMenu(false);setLayoutError('');setWizard(snapshot?'settings':'initial');}}>Schermindeling wijzigen</button><a href="/app/schermen">DartFlow → Schermen</a><p>Score-invoer en Doorspelen via je telefoon.</p><button type="button" onClick={()=>setMenu(false)}>Terug</button></div>}
  {proposal&&<section className="oche-layout-confirm" role="dialog" aria-modal="true" aria-label="Schermindeling bevestigen" onKeyDown={event=>ocheDpad(event,()=>setProposal(null))}><h1>Bevestig op je telefoon</h1><p>De huidige indeling blijft actief tot een bevoegde beheerder het voorstel bevestigt.</p><strong className="oche-device-code">{formattedOcheUserCode(proposal.code)}</strong>{proposalQr&&<img src={proposalQr} width={320} height={320} alt="QR-code om de schermindeling te bevestigen"/>}<p>{paintNow>=Date.parse(proposal.expiresAt)?'Dit voorstel is verlopen. Open Schermindeling wijzigen om het opnieuw te proberen.':'Open DartFlow → Schermen of scan de QR en bevestig de banen.'}</p><button type="button" className="button" onClick={()=>setProposal(null)}>Terug naar scorebord</button></section>}
  {wizard&&<OcheLayoutWizard key={wizard} initial={snapshot?.layout??browserLayout()} allowDual={snapshot?.scope!=='home'} canDefer={wizard!=='initial'} busy={layoutBusy} error={layoutError} onClose={closeWizard} onSave={layout=>void saveLayout(layout)}/>}
 </div></OcheScreenThemeProvider>;
}
