"use client";

import {Component,type ReactNode} from 'react';
import type {OcheDisplaySnapshot,OcheDisplayPanel} from '@/lib/oche-device-types';
import SprintDisplay from './sprint-display';
import OchePlayDisplay from './oche-play-display';
import {coreTacticsPlay} from '@/lib/oche-play-projection';
import OcheLiveStandby from './oche-live-standby';
import OcheCelebration,{useOcheCelebration} from './oche-celebration';
import BoardActivityNotice from './board-activity-notice';
import {ClubBoardQr} from './club-board-screen';
import {OcheBrand} from './oche-brand';

export class OchePanelBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return{failed:true};}
 render(){return this.state.failed?<div className="oche-panel-empty" role="status"><h2>Deze baan wordt opnieuw gesynchroniseerd</h2><p>De andere baan blijft beschikbaar. Probeer het scherm opnieuw te openen.</p></div>:this.props.children;}
}

function panelScan(snapshot:OcheDisplaySnapshot|null,status:string,offline:boolean){const display=snapshot?.display;return Boolean(!offline&&status==='ready'&&snapshot?.board&&display&&(display.board.publicScan??display.board.access==='all')&&display.board.playUrl&&['standby','waiting'].includes(snapshot.state));}
function panelLabel(snapshot:OcheDisplaySnapshot|null,status:string,offline:boolean){return offline?'Offline':status==='error'?'Synchroniseren':status==='unavailable'?'Niet beschikbaar':snapshot?.state==='warning'?'Doorspelen?':snapshot?.state==='live'?'Live':snapshot?.state==='result'?'Uitslag':snapshot?.state==='standby'?'Baan vrij':snapshot?.state==='reserved'?'Gereserveerd':snapshot?.state==='closed'?'Gesloten':snapshot?.state==='blocked'?'Buiten gebruik':snapshot?.state==='waiting'?'Wacht op spelers':'Geen baan';}

export function OcheDeviceWayfinding({panels,offline}:{panels:OcheDisplayPanel[];offline:boolean}){
 const theme=panels.find(panel=>panel.snapshot?.display)?.snapshot?.display?.snapshot.theme?.id??'dartflow';
 return <aside className="oche-device-wayfinding" data-theme={theme} aria-label="Banen op dit scherm"><header><OcheBrand theme={theme}/><span>OCHE LIVE</span></header><div className="oche-wayfinder-lanes">{panels.map(panel=>{const snapshot=panel.snapshot,scan=panelScan(snapshot,panel.status,offline),name=snapshot?.board?.name??(panel.position==='left'?'Baan links':'Baan rechts');return <section id={`oche-lane-${panel.position}`} className="oche-wayfinder-card" data-position={panel.position} data-scan={scan} key={`${panel.position}:${panel.sourceId}:${snapshot?.device.grantVersion}`} aria-label={panel.position==='left'?'Baan links informatie':'Baan rechts informatie'}><div className="oche-wayfinder-copy"><span className="oche-wayfinder-direction" aria-hidden="true">{panel.position==='left'?'←':'→'}</span><h2 title={name}>{name}</h2><span className="oche-wayfinder-status" data-state={offline?'offline':snapshot?.state??panel.status}>{panelLabel(snapshot,panel.status,offline)}</span></div><div className="oche-wayfinder-qr">{scan?<figure><ClubBoardQr key={snapshot!.board!.id} boardId={snapshot!.board!.id} variant="oche" automatic/><figcaption>Scan en speel</figcaption></figure>:<span className="oche-wayfinder-target" aria-hidden="true"><i/><i/><i/></span>}</div></section>;})}</div><footer>Score-invoer via je telefoon</footer></aside>;
}

export default function OcheDevicePanel({snapshot,status='ready',offline,compact=false,refresh}:{snapshot:OcheDisplaySnapshot|null;status?:string;offline:boolean;compact?:boolean;refresh:()=>void}){
 const display=snapshot?.display,play=display?.snapshot.play??(display?coreTacticsPlay(display.snapshot,snapshot?.serverNow??0):undefined),homeWaiting=snapshot?.scope==='home'&&!display?.snapshot.match&&!play;
 const cue=useOcheCelebration(display?.snapshot,Boolean(display)&&!offline&&status==='ready');
 const activity=display?.snapshot.boardActivity?{...display.snapshot.boardActivity,canExtend:false}:undefined;
 const overlay=<OcheCelebration cue={cue}/>;
 const activityOverlay=<BoardActivityNotice activity={activity} display offline={offline} onRefresh={refresh}/>;
 const scan=panelScan(snapshot,status,offline);
 const qr=scan?<figure className="oche-qr"><ClubBoardQr key={snapshot!.board!.id} boardId={snapshot!.board!.id} variant="oche" automatic/><figcaption>Scan en speel</figcaption></figure>:null;
 return <div className="oche-device-panel-content" data-theme={display?.snapshot.theme?.id??'dartflow'} data-panel-status={status}>
  {status!=='ready'||!display||homeWaiting?<main className="oche-panel-empty" role="status"><OcheBrand theme={display?.snapshot.theme?.id}/><h2>{status==='unavailable'?'Baan niet beschikbaar':status==='error'?'Baan opnieuw synchroniseren':homeWaiting&&display?'De partij staat klaar':snapshot?.scope==='home'?'Klaar voor jouw wedstrijd':compact?'Nog geen baan toegewezen':'Wacht op een baan'}</h2><p>{status==='unavailable'?'Vraag een bevoegde beheerder om een andere baan te kiezen.':status==='error'?'De actuele stand van deze baan wordt opnieuw opgehaald.':snapshot?.scope==='home'?'Kies of start je eigen wedstrijd of oefensessie op je telefoon.':'De locatiebeheerder kan onder DartFlow → Schermen een baan toewijzen.'}</p></main>:play?<OchePlayDisplay play={play} boardName={display.board.name} eventName={display.snapshot.event.name} stale={offline} theme={display.snapshot.theme?.id} qr={compact?null:qr} compact={compact} automatic/>:display.snapshot.match?<SprintDisplay snapshot={display.snapshot} stale={offline} qr={null} compact={compact} automatic overlay={overlay} activityOverlay={activityOverlay}/>:<OcheLiveStandby data={display} error="" stale={offline} needsPairing={false} pairForm={null} qr={compact?null:qr} controls={null} overlay={overlay} activityOverlay={activityOverlay} automatic/>}
 </div>;
}
