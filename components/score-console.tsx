"use client";

import {useEffect,useRef,useState,type ReactNode} from "react";
import {createPortal} from "react-dom";
import "./score-console.css";

type ScoreConsoleProps={
  title:string;
  players:{id:string;name:string;remaining:number}[];
  active:number;
  score:string;
  onScore:(value:string)=>void;
  darts:number;
  onDarts:(value:number)=>void;
  finish:boolean;
  doubleConfirmed:boolean;
  onDoubleConfirmed:(value:boolean)=>void;
  canScore:boolean;
  busy:boolean;
  disabled:boolean;
  offline:boolean;
  message?:string;
  checkout?:string|null;
  waiting?:string;
  options?:ReactNode;
  chat?:ReactNode;
  activity?:ReactNode;
  onSubmit:()=>void;
  onBack:()=>void;
};

/** One controlled console: the caller retains its existing server revision and request ID. */
export default function ScoreConsole(props:ScoreConsoleProps){
  const [mounted,setMounted]=useState(false),[optionsOpen,setOptionsOpen]=useState(false);
  const dialog=useRef<HTMLDivElement>(null),back=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const shell=document.querySelector<HTMLElement>(".app-shell"),previousFocus=document.activeElement;
    const wasInert=shell?.inert;
    if(shell)shell.inert=true;
    document.body.classList.add("score-console-open");
    setMounted(true);
    return()=>{
      if(shell)shell.inert=wasInert??false;
      document.body.classList.remove("score-console-open");
      if(previousFocus instanceof HTMLElement)previousFocus.focus({preventScroll:true});
    };
  },[]);
  useEffect(()=>{if(mounted)back.current?.focus({preventScroll:true});},[mounted]);
  if(!mounted)return null;
  const locked=props.disabled||!props.canScore;
  const invalid=props.score!==""&&Number(props.score)>180;
  const message=props.offline?"Geen verbinding · je stand blijft bewaard.":props.message||(invalid?"Voer een worp van 0 tot en met 180 in.":!props.canScore?props.waiting||"Wacht op de beurt van je tegenstander.":props.checkout?`Finish: ${props.checkout}`:"Voer jouw worptotaal in.");
  return createPortal(<div className="score-console" role="dialog" aria-modal="true" aria-label="Schermvullende score-invoer" ref={dialog} onKeyDown={event=>{
    if(event.key==="Escape"){event.preventDefault();if(optionsOpen)setOptionsOpen(false);else props.onBack();}
    if(event.key==="Tab"){
      const targets=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')||[]).filter(element=>element.offsetParent!==null);
      const first=targets[0],last=targets.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  }}>
    <header className="score-console-header"><button ref={back} type="button" onClick={props.onBack} aria-label="Terug naar wedstrijd">‹ Terug</button><span>{props.title}</span>{props.chat}<span className={props.offline?"score-console-offline":"score-console-connected"}>{props.offline?"Offline":"Live"}</span></header>
    <div className={`score-console-players ${props.players.length===1?"score-console-solo":""}`} aria-label="Actuele stand">{props.players.map((player,index)=><div key={player.id} className={index===props.active?"is-active":""} data-active={index===props.active}><span>{player.name}</span><strong className="console-remaining">{player.remaining}</strong><small>{index===props.active?"Aan de beurt":"Restscore"}</small></div>)}</div>
    {props.activity}
    <form className="score-console-form" onSubmit={event=>{event.preventDefault();if(!locked&&!props.offline&&!invalid&&props.score!==""&&(!props.finish||props.doubleConfirmed))props.onSubmit();}}>
      <label className="score-console-entry"><span>Jouw worp</span><input aria-label="Bezoekscore" value={props.score} inputMode="none" readOnly autoComplete="off" maxLength={3} placeholder="0" onKeyDown={event=>{if(locked)return;if(/^\d$/.test(event.key)){event.preventDefault();props.onScore((props.score+event.key).slice(0,3));}else if(event.key==='Backspace'){event.preventDefault();props.onScore(props.score.slice(0,-1));}else if(event.key==='Delete'){event.preventDefault();props.onScore('');}}} disabled={locked} /></label>
      {props.finish&&props.canScore&&<div className="score-console-finish"><label><input type="checkbox" checked={props.doubleConfirmed} onChange={event=>props.onDoubleConfirmed(event.target.checked)} disabled={locked} /> Laatste dart op dubbel</label><label>Darts <select aria-label="Darts voor finish" value={props.darts} onChange={event=>props.onDarts(Number(event.target.value))} disabled={locked}>{[1,2,3].map(count=><option key={count}>{count}</option>)}</select></label></div>}
      <div className="score-console-keypad" aria-label="Scoretoetsen">{["1","2","3","4","5","6","7","8","9","C","0","⌫"].map(key=><button key={key} type="button" disabled={locked} aria-label={key==="C"?"Gehele score wissen":key==="⌫"?"Laatste cijfer wissen":`Cijfer ${key}`} onClick={()=>props.onScore(key==="C"?"":key==="⌫"?props.score.slice(0,-1):(props.score+key).slice(0,3))}>{key}</button>)}</div>
      <p className={`score-console-message ${props.offline||props.message||invalid?"has-warning":""}`} role="status">{message}</p>
      <button className="score-console-confirm" type="submit" disabled={locked||props.offline||invalid||props.score===""||(props.finish&&!props.doubleConfirmed)}>{props.busy?"Verzenden…":props.finish?"Finish bevestigen":"Bevestigen"}</button>
    </form>
    <footer className="score-console-footer"><span>{props.canScore?`${props.darts} darts`:"Gedeelde live stand"}</span><button type="button" onClick={()=>setOptionsOpen(value=>!value)} aria-expanded={optionsOpen} aria-controls="score-console-options">{optionsOpen?"Opties sluiten":"Darts & correctie"}</button></footer>
    {optionsOpen&&<section className="score-console-options" id="score-console-options" aria-label="Wedstrijdopties"><header><strong>Darts & correctie</strong><button type="button" onClick={()=>setOptionsOpen(false)}>Sluiten</button></header><label className="field">Gegooide darts<select aria-label="Gegooide darts" value={props.darts} onChange={event=>props.onDarts(Number(event.target.value))} disabled={locked}>{[1,2,3].map(count=><option key={count}>{count}</option>)}</select></label>{props.options||<p>Je partij blijft bewaard wanneer je teruggaat.</p>}</section>}
  </div>,document.body);
}
