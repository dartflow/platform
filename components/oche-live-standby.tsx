"use client";

import {useState,type ReactNode} from 'react';
import type {ClubBoardScreenView} from '@/lib/types';

export function OcheFullscreen(){
  const [error,setError]=useState('');
  async function toggle(){
    setError('');
    try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else throw new Error('unsupported');}
    catch{setError('Volledig scherm is hier niet beschikbaar. Gebruik de zelfstandige app of de scherminstellingen van je apparaat.');}
  }
  return <><button type="button" className="oche-fullscreen" aria-label="Volledig scherm" title="Volledig scherm" onClick={()=>void toggle()}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/></svg></button>{error&&<p className="oche-control-error" role="status">{error}</p>}</>;
}

export default function OcheLiveStandby({data,error,stale,needsPairing,pairForm,qr,controls,overlay}:{data:ClubBoardScreenView|null;error:string;stale:boolean;needsPairing:boolean;pairForm:ReactNode;qr:ReactNode;controls:ReactNode;overlay:ReactNode}){
  const label=data?.board.clubName??'Oche Live';
  const status=data?.status;
  const display=data as (ClubBoardScreenView&{reservation?:{label:string;startsAt:string;endsAt:string;overrun:boolean};board:ClubBoardScreenView['board']&{locationKind?:'home'|'venue'}})|null;
  const reserved=Boolean(display?.reservation)&&status==='available';
  return <main className="oche-display club-board-idle" aria-label="Oche Live-baanscherm"><div className="oche-stage"><div className="oche-content">
    <header className="oche-top"><img className="oche-logo" src="/assets/dartflow-logo.svg" alt="DartFlow" width={1916} height={496}/><div className="oche-location"><span className="oche-location-mark" aria-hidden="true">{label.split(/\s+/).map(part=>part[0]).filter(Boolean).slice(0,3).join('').toUpperCase()}</span><span className="oche-location-label"><b>{label}</b><small>{display?.board.locationKind==='home'?'Thuisbaan':data?'Op locatie':'Baanscherm'}</small></span></div></header>
    <section className="oche-main">
      {!data?<div className="oche-headline"><span className={`oche-pill${stale?' oche-pill-offline':''}`}>{needsPairing?'Koppeling nodig':stale?'Offline':error?'Niet beschikbaar':'Verbinden'}</span><h1>{needsPairing?'Koppel dit baanscherm':error?'Scherm niet beschikbaar':'Oche Live openen…'}</h1><p>{needsPairing?'Vraag de wedstrijdleiding om een eenmalige koppelcode. Dit apparaat leest alleen de stand op deze baan.':error||'We halen de actuele stand van deze baan op.'}</p>{needsPairing&&pairForm}</div>:<>
        <div className="oche-headline club-board-idle-context"><span className={`oche-pill${stale?' oche-pill-offline':status==='available'?' oche-pill-live':''}`}>{stale?'Offline':status==='blocked'?'Buiten gebruik':status==='waiting'?'Wacht op spelers':reserved?'Gereserveerd':'Baan vrij'}</span><h1 className="oche-kicker" data-testid="oche-board-name">{data.board.name}</h1><h2>{status==='blocked'?<>Even pauze <em>aan dit bord.</em></>:status==='waiting'?<>Jouw tegenstander <em>staat klaar.</em></>:reserved?<>Baan <em>gereserveerd.</em></>:<>Scan en <em>speel.</em></>}</h2><p>{status==='blocked'?'Deze baan is tijdelijk geblokkeerd door de beheerder.':status==='waiting'?'De tweede speler scant dezelfde QR en sluit aan.':reserved?display?.reservation?.label:'Begin een oefenpartij, speel samen op locatie of nodig iemand online uit.'}</p></div>
        {qr}
      </>}
    </section>
    <footer className="oche-foot"><span>DartFlow · Oche Live</span><div className="oche-foot-actions"><a className="oche-back-link" href="/speler">Terug</a>{controls}<OcheFullscreen/></div></footer>
  </div>{overlay}</div></main>;
}
