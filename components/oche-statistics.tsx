"use client";

import {useEffect,useState} from 'react';
import type {OcheHistoricalStatistics} from '@/lib/player-statistics-types';

const decimal=(value:number)=>value.toFixed(1).replace('.',',');

export function OcheHeadToHead({statistics}:{statistics?:OcheHistoricalStatistics}){
  const head=statistics?.headToHead;
  if(!head)return null;
  const names=head.names;
  const [a=0,b=0]=head.wins,leader=a>b?names[0]:b>a?names[1]:null;
  return <aside className="oche-head-to-head" aria-label="Onderlinge balans"><strong>{leader?`${leader} leidt ${Math.max(a,b)}–${Math.min(a,b)}`:`Onderling gelijk · ${a}–${b}`}</strong><span>Vorige partij {head.previousLegs.join('–')}{head.drawn?` · ${head.drawn} gelijk`:''}</span></aside>;
}

/** Receives only the server's filtered recap; a new assignment unmounts it immediately. */
export function OcheMatchRecap({statistics}:{statistics?:OcheHistoricalStatistics}){
  const recap=statistics?.recap,expiresAt=recap?.expiresAt,[visible,setVisible]=useState(false);
  useEffect(()=>{
    const expires=expiresAt?new Date(expiresAt).getTime():0,left=expires-Date.now();
    setVisible(left>0);
    if(left<=0)return;
    const timer=window.setTimeout(()=>setVisible(false),Math.min(left,2147483647));return()=>clearTimeout(timer);
  },[expiresAt]);
  if(!recap||!visible)return null;
  return <section className="oche-match-recap" aria-label="Wedstrijd terugblik" role="status"><div className="oche-recap-heading"><span>Wedstrijd afgerond</span><h2>Goed <em>gespeeld.</em></h2></div><div className="oche-recap-players">{recap.players.map((player,index)=><article key={index}><h3>{player.name}</h3><strong className="oche-recap-result">{player.legs} <small>legs{player.sets>0?` · ${player.sets} sets`:''}</small></strong><p>{player.average==null?'AVG niet gemeten':`${decimal(player.average)} AVG`} · Hoogste finish {player.highestFinish||'–'}</p>{player.averageDifference!=null&&<p className="oche-recap-comparison">{decimal(Math.abs(player.averageDifference))} {player.averageDifference>=0?'boven':'onder'} je laatste 50</p>}{player.personalRecord&&<span className="oche-personal-record">Persoonlijk record</span>}</article>)}</div></section>;
}
