"use client";

import {useEffect,useRef,useState} from 'react';
import {createOcheVisuals,OCHE_CUE_DURATION,type OcheCue,type OcheCueSnapshot} from '@/lib/oche-visual';

export function useOcheCelebration(snapshot:OcheCueSnapshot|null|undefined,connected:boolean){
  const tracker=useRef(createOcheVisuals());
  const [cue,setCue]=useState<OcheCue|null>(null);
  useEffect(()=>{setCue(tracker.current.observe(snapshot,connected));},[snapshot,connected]);
  useEffect(()=>{
    if(!cue)return;
    const timer=setTimeout(()=>setCue(tracker.current.tick()),Math.max(0,OCHE_CUE_DURATION-(Date.now()-cue.startedAt)));
    return()=>clearTimeout(timer);
  },[cue]);
  return cue;
}
export default function OcheCelebration({cue}:{cue:OcheCue|null}){
  if(!cue)return null;
  return <aside key={cue.id} className={`oche-celebration oche-celebration--${cue.kind}`} role="status" aria-label={`${cue.label}: ${cue.score}`} data-event-id={cue.id}><span>{cue.label}</span><strong>{cue.score}</strong>{cue.player&&<small>{cue.player}</small>}</aside>;
}
