"use client";

import {useEffect,useRef,useState} from 'react';
import type {BoardActivityView} from '@/lib/board-activity-types';
import './board-activity-notice.css';

/** The server owns T and the deadline; this clock only paints the shared countdown. */
export default function BoardActivityNotice({activity,display=false,boardId,offline=false,onRefresh}:{activity?:BoardActivityView;display?:boolean;boardId?:string;offline?:boolean;onRefresh?:()=>void|Promise<void>}){
 const [now,setNow]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [accepted,setAccepted]=useState<BoardActivityView|null>(null);
 const refresh=useRef(onRefresh);refresh.current=onRefresh;
 const clock=useRef({server:0,received:0}),attempt=useRef<{epoch:string;requestId:string}|null>(null);
 // An in-flight poll may finish after the extension while still holding the old snapshot.
 const current=accepted&&(!activity||(accepted.sessionId===activity.sessionId&&['active','warning'].includes(activity.phase)&&accepted.activityAt>activity.activityAt))?accepted:activity;
 useEffect(()=>{if(!current)return;clock.current={server:current.serverNow,received:Date.now()};setNow(current.serverNow);const tick=()=>setNow(clock.current.server+Date.now()-clock.current.received);const timer=setInterval(tick,250);document.addEventListener('visibilitychange',tick);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick);};},[current]);
 const terminal=Boolean(current&&['released','interrupted'].includes(current.phase));
 const warning=Boolean(current&&!['released','interrupted','completed'].includes(current.phase)&&now>=current.warningAt);
 const ended=terminal||Boolean(warning&&current&&now>=current.deadlineAt);
 const refreshKey=ended?`${current?.sessionId}:${current?.warningEpoch}`:'';
 useEffect(()=>{if(refreshKey)void refresh.current?.();},[refreshKey]);
 if(!current||(!warning&&!terminal))return null;
 const remaining=Math.max(0,Math.ceil((current.deadlineAt-now)/1000));
 const seconds=`${Math.floor(remaining/60).toString().padStart(2,'0')}:${(remaining%60).toString().padStart(2,'0')}`;
 const extensions=Math.max(0,current.maxExtensions-current.extensionsUsed);
 async function extend(){
  if(busy||!current||offline||ended||!current.canExtend)return;
  if(attempt.current?.epoch!==current.warningEpoch)attempt.current={epoch:current.warningEpoch,requestId:crypto.randomUUID()};
  setBusy(true);setError('');
  try{const response=await fetch(display?`/api/board-screens/${boardId}/continue`:'/api/board-activity/continue',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({sessionId:current.sessionId,warningEpoch:current.warningEpoch,requestId:attempt.current!.requestId})});const body=await response.json();if(!response.ok)throw new Error(body.error||'Doorspelen is niet gelukt.');setAccepted(body.activity);attempt.current=null;await onRefresh?.();}
  catch(cause){setError(cause instanceof Error?cause.message:'Verbinding onderbroken. Probeer opnieuw.');void onRefresh?.();}
  finally{setBusy(false);}
 }
 return <section className={`board-activity-notice ${display?'board-activity-display':'board-activity-phone'}`} aria-label="Baanactiviteit" data-session-id={current.sessionId} data-deadline={current.deadlineAt}>
  <span className="visually-hidden" role="status" key={`${current.sessionId}:${current.warningEpoch}:${ended}`}>{ended?'De baansessie is afgelopen.':`Er is twee minuten niet gescoord. De baan wordt over één minuut vrijgegeven. ${extensions} verlengingen beschikbaar.`}</span>
  {display&&<span className="board-activity-clock" aria-hidden="true">◷</span>}
  <h2>{ended?current.kind==='official'?'Partij onderbroken':'Baan vrijgegeven':<>Spelen jullie <em>nog door?</em></>}</h2>
  <strong className="board-activity-time" aria-hidden="true">{seconds}</strong>
  {display&&!ended&&<div className="board-activity-progress" aria-hidden="true"><span style={{transform:`scaleX(${Math.min(1,remaining/60)})`}}/></div>}
  {display&&<p>{ended?current.kind==='official'?'De wedstrijdleiding kan deze partij hervatten.':'Scan de baan opnieuw om te spelen.':'De baan wordt vrijgegeven als de aftelling afloopt.'}</p>}
  {!ended&&(current.canExtend?<button type="button" className="board-activity-continue" disabled={busy||offline||!extensions} onClick={()=>void extend()}>{busy?'Bezig…':'Doorspelen'} <span aria-hidden="true">→</span></button>:<p className="board-activity-hint">{display?'Tik op Doorspelen op je telefoon':extensions?'Baanstatus wordt bijgewerkt…':'Geen verlengingen meer. Een score houdt de baan actief.'}</p>)}
  {!ended&&<small>Verlengingen over <b>{extensions}</b></small>}
  {error&&<p className="board-activity-error" role="alert">{error}</p>}
 </section>;
}
