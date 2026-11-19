"use client";

import {useEffect,useState,type CSSProperties,type ReactNode} from 'react';
import {OcheBrand} from './oche-brand';
import {ocheStandbyFrame} from '@/lib/oche-standby';
import type {ClubBoardScreenView} from '@/lib/types';
import {OcheHeadToHead,OcheMatchRecap} from './oche-statistics';

export function OcheFullscreen(){
  const [error,setError]=useState('');
  async function toggle(){
    setError('');
    try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else throw new Error('unsupported');}
    catch{setError('Volledig scherm is hier niet beschikbaar. Gebruik de zelfstandige app of de scherminstellingen van je apparaat.');}
  }
  return <><button type="button" className="oche-fullscreen" aria-label="Volledig scherm" title="Volledig scherm" onClick={()=>void toggle()}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/></svg></button>{error&&<p className="oche-control-error" role="status">{error}</p>}</>;
}

type StandbyProps = {data:ClubBoardScreenView|null;error:string;stale:boolean;needsPairing:boolean;pairForm:ReactNode;qr:ReactNode;controls:ReactNode;overlay:ReactNode;activityOverlay?:ReactNode;carouselEligible?:boolean};

function OcheStandbyCarousel({data,stale,qr,controls,overlay,activityOverlay}:{data:ClubBoardScreenView;stale:boolean;qr:ReactNode;controls:ReactNode;overlay:ReactNode;activityOverlay?:ReactNode}){
  const [frame,setFrame]=useState(()=>ocheStandbyFrame(0));
  useEffect(()=>{
    const startedAt=performance.now();let handle=0,lastBucket=-1;
    const tick=()=>{
      const elapsed=performance.now()-startedAt,bucket=Math.floor(elapsed/50);
      if(bucket!==lastBucket){lastBucket=bucket;setFrame(ocheStandbyFrame(elapsed));}
      if(document.visibilityState==='visible')handle=requestAnimationFrame(tick);
    };
    const visibility=()=>{cancelAnimationFrame(handle);if(document.visibilityState==='visible')tick();};
    tick();document.addEventListener('visibilitychange',visibility);
    return()=>{cancelAnimationFrame(handle);document.removeEventListener('visibilitychange',visibility);};
  },[]);
  const steps=['Scan de QR-code.','Maak een (oefen)wedstrijd aan.','Laat spelers de QR-code scannen om mee te doen of speel op afstand tegen een andere speler.','Start de wedstrijd.'];
  return <main className="oche-display oche-display--carousel club-board-idle" data-theme={data.snapshot.theme?.id??'dartflow'} aria-label="Oche Live-baanscherm"><div className="oche-stage" data-standby-slide={frame.index+1} style={{'--oche-progress':frame.progress,'--oche-slide':frame.index} as CSSProperties}><div className="oche-carousel-atmosphere" aria-hidden="true"><i/><i/><i/></div><div className="oche-content">
    <header className="oche-top"><OcheBrand className="oche-logo" kind="logo" key={data?.snapshot.theme?.id} theme={data?.snapshot.theme?.id} visible={frame.index===1}/><span className="sprint-board-badge" title={data.board.name}>{data.board.name}</span></header>
    <div className="oche-carousel-slides">
      <section className="oche-slide oche-slide--brand" data-active={frame.index===0} aria-hidden={frame.index!==0} inert={frame.index!==0} aria-label="DartFlow"><div className="oche-brand-lockup"><OcheBrand className="oche-brand-icon" kind="icon" key={data?.snapshot.theme?.id} theme={data?.snapshot.theme?.id}/><OcheBrand className="oche-brand-wordmark" kind="wordmark" key={data?.snapshot.theme?.id} theme={data?.snapshot.theme?.id}/></div></section>
      <section className="oche-slide oche-slide--qr" data-active={frame.index===1} aria-hidden={frame.index!==1} inert={frame.index!==1} aria-label="Scan en speel"><div className="oche-headline club-board-idle-context"><span className={`oche-pill ${stale?'oche-pill-offline':'oche-pill-live'}`}>{stale?'Offline':'Baan vrij'}</span><h1 className="oche-kicker" data-testid="oche-board-name">{data.board.name}</h1><h2>Scan en <em>speel.</em></h2><p>Begin een oefenpartij, speel samen op locatie of nodig iemand online uit.</p></div>{qr}</section>
      <section className="oche-slide oche-slide--steps" data-active={frame.index===2} aria-hidden={frame.index!==2} inert={frame.index!==2} aria-label="Zo speel je"><OcheBrand className="oche-steps-logo" kind="logo" key={data?.snapshot.theme?.id} theme={data?.snapshot.theme?.id}/>{qr}<h2>Zo <em>speel je.</em></h2><ol>{steps.map((step,index)=><li key={step}><b aria-hidden="true">{index+1}</b><span>{step}</span></li>)}</ol></section>
    </div>
    {data?.snapshot.pendingCall&&<aside className="oche-precall" aria-label="Vooroproep"><b>{data.snapshot.pendingCall.label}</b><span>{data.snapshot.pendingCall.players.join(' · ')}</span></aside>}<footer className="oche-foot"><div className="oche-carousel-progress" aria-hidden="true"><span/></div><span>Powered by DartFlow</span><div className="oche-foot-actions"><span className="oche-slide-counter" aria-label={`Stand-byslide ${frame.index+1} van 3`}>{String(frame.index+1).padStart(2,'0')} / 03</span>{controls}<OcheFullscreen/></div></footer>
  </div>{overlay}{activityOverlay}{data.status==='available'&&<OcheMatchRecap statistics={data.snapshot.statistics}/>}</div></main>;
}

export default function OcheLiveStandby({data,error,stale,needsPairing,pairForm,qr,controls,overlay,activityOverlay,carouselEligible}:StandbyProps){
  const label=data?.board.clubName??'Oche Live';
  const status=data?.status;
  const display=data as (ClubBoardScreenView&{reservation?:{label:string;startsAt:string;endsAt:string;overrun:boolean};board:ClubBoardScreenView['board']&{locationKind?:'home'|'venue'}})|null;
  const reserved=status==='reserved'||Boolean(display?.reservation)&&status==='available';
  const eligible=carouselEligible??Boolean(data&&status==='available'&&!display?.reservation&&(data.board.publicScan??data.board.access==='all'));
  if(data&&eligible&&!needsPairing)return <OcheStandbyCarousel key={data.board.id} data={data} stale={stale} qr={qr} controls={controls} overlay={overlay} activityOverlay={activityOverlay}/>;
  return <main className="oche-display club-board-idle" data-theme={data?.snapshot.theme?.id??'dartflow'} aria-label="Oche Live-baanscherm"><div className="oche-stage"><div className="oche-content">
    <header className="oche-top"><OcheBrand className="oche-logo" kind="logo" key={data?.snapshot.theme?.id} theme={data?.snapshot.theme?.id}/><div className="oche-location"><span className="oche-location-mark" aria-hidden="true">{label.split(/\s+/).map(part=>part[0]).filter(Boolean).slice(0,3).join('').toUpperCase()}</span><span className="oche-location-label"><b>{label}</b><small>{display?.board.locationKind==='home'?'Thuisbaan':data?'Op locatie':'Baanscherm'}</small></span></div></header>
    <section className="oche-main">
      {!data?<div className="oche-headline"><span className={`oche-pill${stale?' oche-pill-offline':''}`}>{needsPairing?'Koppeling nodig':stale?'Offline':error?'Niet beschikbaar':'Verbinden'}</span><h1>{needsPairing?'Koppel dit baanscherm':error?'Scherm niet beschikbaar':'Oche Live openen…'}</h1><p>{needsPairing?'Vraag de wedstrijdleiding om een eenmalige koppelcode. Dit apparaat leest alleen de stand op deze baan.':error||'We halen de actuele stand van deze baan op.'}</p>{needsPairing&&pairForm}</div>:<>
        <div className="oche-headline club-board-idle-context"><span className={`oche-pill${stale?' oche-pill-offline':status==='available'?' oche-pill-live':''}`}>{stale?'Offline':status==='closed'?'Gesloten':status==='blocked'?'Buiten gebruik':status==='waiting'?'Wacht op spelers':reserved?'Gereserveerd':'Baan vrij'}</span><h1 className="oche-kicker" data-testid="oche-board-name">{data.board.name}</h1><h2>{status==='closed'?<>Baan <em>gesloten.</em></>:status==='blocked'?<>Even pauze <em>aan dit bord.</em></>:status==='waiting'?<>Jouw tegenstander <em>staat klaar.</em></>:reserved?<>Baan <em>gereserveerd.</em></>:<>Scan en <em>speel.</em></>}</h2><p>{status==='closed'?'Deze baan is gesloten voor nieuwe wedstrijden.':status==='blocked'?'Deze baan is tijdelijk geblokkeerd door de beheerder.':status==='waiting'?'De tweede speler scant dezelfde QR en sluit aan.':reserved?display?.reservation?.label:'Begin een oefenpartij, speel samen op locatie of nodig iemand online uit.'}</p></div>
        {qr}
        {status==='waiting'&&<OcheHeadToHead statistics={data.snapshot.statistics}/>}
      </>}
    </section>
    {data?.snapshot.pendingCall&&<aside className="oche-precall" aria-label="Vooroproep"><b>{data.snapshot.pendingCall.label}</b><span>{data.snapshot.pendingCall.players.join(' · ')}</span></aside>}<footer className="oche-foot"><span>Powered by DartFlow</span><div className="oche-foot-actions"><a className="oche-back-link" href="/speler">Terug</a>{controls}<OcheFullscreen/></div></footer>
  </div>{overlay}{activityOverlay}{status==='available'&&<OcheMatchRecap statistics={data?.snapshot.statistics}/>}</div></main>;
}
