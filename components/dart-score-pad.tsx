"use client";

import {useState,type ReactNode,type FormEvent} from "react";
import {dartValue} from "@/lib/x01-rules";

/** Exact, ordered hits only. Rules and acceptance remain with the caller. */
export default function DartScorePad({hits,disabled,available=3,ended=false,onAdd,onRemove,onSubmit,children,extraTargets,error,thrower,submitLabel="Beurt vastleggen"}:{hits:string[];disabled:boolean;available?:number;ended?:boolean;onAdd:(hit:string)=>void;onRemove:()=>void;onSubmit:(event:FormEvent)=>void;children?:ReactNode;extraTargets?:ReactNode;error?:string;thrower?:string;submitLabel?:string}){
  const [factor,setFactor]=useState("S");
  const locked=disabled||hits.length>=available||ended;
  return <form className="panel play-input dart-score-pad" onSubmit={onSubmit}>
    <div className="dart-pad-heading"><h2>Werkelijk geworpen pijlen</h2><div className="dart-pad-current"><span>{thrower?`${thrower} · `:""}{hits.length} / {available} pijlen</span><strong aria-label="Waargenomen totaal">{hits.reduce((sum,hit)=>sum+dartValue(hit),0)}</strong></div></div>
    <div className="play-darts" aria-label="Ingevoerde pijlen">{Array.from({length:available},(_,index)=><span key={index}>{hits[index]??"—"}</span>)}<button type="button" className="button" disabled={!hits.length||disabled} onClick={onRemove} aria-label="Laatste invoer verwijderen">⌫</button></div>
    <div className="dart-pad-segments" role="group" aria-label="Segment">{["S","D","T"].map(value=><button type="button" key={value} aria-pressed={factor===value} disabled={disabled} onClick={()=>setFactor(value)}>{value==="S"?"Enkel":value==="D"?"Dubbel":"Triple"}</button>)}</div>
    <div className="play-keypad" aria-label="Geraakt segment">{Array.from({length:20},(_,index)=>20-index).map(number=><button type="button" key={number} aria-label={`${factor}${number}`} disabled={locked} onClick={()=>onAdd(`${factor}${number}`)}>{number}</button>)}</div>
    <div className="dart-pad-special">{["MISS","SB","DB"].map(hit=><button type="button" key={hit} disabled={locked} onClick={()=>onAdd(hit)} aria-label={hit==="MISS"?"Mis":hit}>{hit==="MISS"?"Mis":hit==="SB"?"25":"Bull 50"}</button>)}</div>
    {error&&<p className="dart-pad-error" role="alert">{error}</p>}
    <button className="button gold dart-pad-submit" disabled={disabled||!hits.length}>{submitLabel}</button>
    {extraTargets&&<details className="dart-pad-advanced"><summary>Kaartnummers</summary><div className="play-keypad">{extraTargets}</div></details>}{children}
  </form>;
}
