"use client";

import {useState,type ReactNode} from "react";
import ScoreConsoleFrame,{ScoreConsoleHeader} from "./score-console-frame";
import "./score-console.css";

type ScoreConsoleProps={
  title:string;
  players:{id:string;name:string;remaining:number}[];
  active:number;
  score:string;
  onScore:(value:string)=>void;
  darts:number;
  onDarts:(value:number)=>void;
  doubleAttempts?:number|null;
  onDoubleAttempts?:(value:number|null)=>void;
  finish:boolean;
  doubleConfirmed:boolean;
  onDoubleConfirmed:(value:boolean)=>void;
  canScore:boolean;
  busy:boolean;
  disabled:boolean;
  offline:boolean;
  allowOffline?:boolean;
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
  const [optionsOpen,setOptionsOpen]=useState(false);
  const locked=props.disabled||!props.canScore||Boolean(props.offline&&!props.allowOffline);
  const invalid=props.score!==""&&Number(props.score)>180;
  const message=props.offline?(props.message|| (props.allowOffline?"Geen verbinding · beurten blijven op dit toestel bewaard.":"Geen verbinding · je stand blijft bewaard.")):props.message||(invalid?"Voer een worp van 0 tot en met 180 in.":!props.canScore?props.waiting||"Wacht op de beurt van je tegenstander.":props.checkout?`Finish: ${props.checkout}`:"Voer jouw worptotaal in.");
  return <ScoreConsoleFrame onBack={props.onBack} onEscape={()=>{if(!optionsOpen)return false;setOptionsOpen(false);return true;}}>
    <ScoreConsoleHeader title={props.title} offline={props.offline} onBack={props.onBack}>{props.chat}</ScoreConsoleHeader>
    <div className={`score-console-players ${props.players.length===1?"score-console-solo":""}`} aria-label="Actuele stand">{props.players.map((player,index)=><div key={player.id} className={index===props.active?"is-active":""} data-active={index===props.active}><span>{player.name}</span><strong className="console-remaining">{player.remaining}</strong><small>{index===props.active?"Aan de beurt":"Restscore"}</small></div>)}</div>
    {props.activity}
    <form className="score-console-form" onSubmit={event=>{event.preventDefault();if(!locked&&!invalid&&props.score!==""&&(!props.finish||props.doubleConfirmed))props.onSubmit();}}>
      <label className="score-console-entry"><span>Beurtotaal · {props.darts} {props.darts===1?'pijl':'pijlen'} · {props.players[props.active]?.name??'speler'}</span><input aria-label="Bezoekscore" value={props.score} inputMode="none" readOnly autoComplete="off" maxLength={3} placeholder="0" onKeyDown={event=>{if(locked)return;if(/^\d$/.test(event.key)){event.preventDefault();props.onScore((props.score+event.key).slice(0,3));}else if(event.key==='Backspace'){event.preventDefault();props.onScore(props.score.slice(0,-1));}else if(event.key==='Delete'){event.preventDefault();props.onScore('');}}} disabled={locked} /></label>
      {props.finish&&props.canScore&&<div className="score-console-finish"><label><input type="checkbox" checked={props.doubleConfirmed} onChange={event=>props.onDoubleConfirmed(event.target.checked)} disabled={locked} /> Laatste dart op dubbel</label><div className="score-console-dart-picks" role="group" aria-label="Darts voor finish">{[1,2,3].map(count=><button type="button" key={count} aria-pressed={props.doubleConfirmed&&props.darts===count} aria-label={`Finish in ${count} ${count===1?'dart':'darts'}`} disabled={locked} onClick={()=>{props.onDarts(count);props.onDoubleConfirmed(true);if(props.doubleAttempts!=null&&props.doubleAttempts>count)props.onDoubleAttempts?.(null);}}>{count}</button>)}</div></div>}
      {!props.finish&&<div className="visit-total-darts" role="group" aria-label="Gegooide pijlen"><span>Pijlen:</span>{[1,2,3].map(count=><button type="button" key={count} disabled={locked} aria-pressed={props.darts===count} aria-label={`${count} ${count===1?'pijl':'pijlen'}`} onClick={()=>{props.onDarts(count);if(props.doubleAttempts!=null&&props.doubleAttempts>count)props.onDoubleAttempts?.(null);}}>{count}</button>)}</div>}
      <div className="score-console-keypad" aria-label="Scoretoetsen">{["1","2","3","4","5","6","7","8","9","C","0","⌫"].map(key=><button key={key} type="button" disabled={locked} aria-label={key==="C"?"Gehele score wissen":key==="⌫"?"Laatste cijfer wissen":`Cijfer ${key}`} onClick={()=>props.onScore(key==="C"?"":key==="⌫"?props.score.slice(0,-1):(props.score+key).slice(0,3))}>{key}</button>)}</div>
      <p className={`score-console-message ${props.offline||props.message||invalid?"has-warning":""}`} role="status">{message}</p>
      <button className="score-console-confirm" type="submit" disabled={locked||invalid||props.score===""||(props.finish&&!props.doubleConfirmed)}>{props.busy?"Verzenden…":props.finish?"Finish bevestigen":"Bevestigen"}</button>
    </form>
    <footer className="score-console-footer"><span>{props.canScore?`${props.darts} darts`:"Gedeelde live stand"}</span><button type="button" onClick={()=>setOptionsOpen(value=>!value)} aria-label={optionsOpen?"Opties sluiten":"Darts & correctie"} aria-expanded={optionsOpen} aria-controls="score-console-options">{optionsOpen?"Opties sluiten":"Darts & correctie"}</button></footer>
    {optionsOpen&&<section className="score-console-options" id="score-console-options" aria-label="Wedstrijdopties"><header><strong>Darts & correctie</strong><button type="button" onClick={()=>setOptionsOpen(false)}>Sluiten</button></header><label className="field">Gegooide darts<select aria-label="Gegooide darts" value={props.darts} onChange={event=>{const count=Number(event.target.value);props.onDarts(count);if(props.doubleAttempts!=null&&props.doubleAttempts>count)props.onDoubleAttempts?.(null);}} disabled={locked}>{[1,2,3].map(count=><option key={count}>{count}</option>)}</select></label>{props.onDoubleAttempts&&(props.checkout||props.finish||props.doubleAttempts!=null)&&<label className="field">Darts op de uitgooidubbel<select aria-label="Darts op de uitgooidubbel" value={props.doubleAttempts??''} onChange={event=>props.onDoubleAttempts?.(event.target.value===''?null:Number(event.target.value))} disabled={locked}><option value="">Niet bijgehouden</option>{Array.from({length:props.darts+1},(_,count)=><option key={count} value={count} disabled={props.finish&&count===0}>{count}</option>)}</select><small>Inclusief de geraakte dubbel of bull bij een finish. Onbekend blijft onbekend.</small></label>}{props.options||<p>Je partij blijft bewaard wanneer je teruggaat.</p>}</section>}
  </ScoreConsoleFrame>;
}
