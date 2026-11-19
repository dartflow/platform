'use client';
import {useEffect,useState} from 'react';
import type {CoreScoreQueue} from '@/lib/core-offline';
import {useCoreScoreQueue} from './use-core-score-queue';
import PlayWorkspace from './play-workspace';
import DartVisitInput from './dart-visit-input';
import CricketCard from './cricket-card';
import TacticsCard from './tactics-card';
import {PlayHelp} from './manual-workspace';
import {dartValue} from '@/lib/x01-rules';
import type {MatchView} from '@/lib/types';
export default function OfflineScoreShell(){
 const [source,setSource]=useState<CoreScoreQueue|null>(null),[choices,setChoices]=useState<CoreScoreQueue[]>([]),[ready,setReady]=useState(false);
 useEffect(()=>{const id=location.pathname.match(/^\/wedstrijd\/([a-f0-9-]{36})$/)?.[1];if(id){try{
  const read=(key:string)=>{try{const r=JSON.parse(localStorage.getItem(key)??'null')as CoreScoreQueue|null;return r?.version===1&&r.matchId===id&&r.base?.id===id&&Array.isArray(r.commands)&&key===`dartflow-core-queue-v1:${r.actorId}:${id}`?r:null;}catch{return null;}};
  // The optional index can be missing or stale after a failed shortcut write.
  // Never infer which account owns a phone when several exact records exist.
  const found:CoreScoreQueue[]=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith('dartflow-core-queue-v1:')||!key.endsWith(`:${id}`))continue;const value=read(key);if(value)found.push(value);}
  if(found.length===1)setSource(found[0]);else setChoices(found);
 }catch{/* No private server HTML or account session is restored from the shell. */}}setReady(true);},[]);
 if(!ready)return <p role="status">Bewaarde partij openen…</p>;
 if(source)return <CoreOfflineResume source={source}/>;
 if(choices.length)return <main className="play-workspace"><h1>Kies je bewaarde scorekaart</h1><p>Op dit toestel staan meerdere schrijvers bij deze partij. Kies jouw eigen invoer.</p>{choices.map(record=><button className="button" key={record.actorId} onClick={()=>setSource(record)}>{record.base.players.find(p=>p.id===record.actorId)?.name??record.base.sideParticipants?.flat().find(p=>p.id===record.actorId)?.name??'Schrijver'} · {record.commands.length} bewaarde acties</button>)}</main>;
 return <PlayWorkspace/>;
}
function CoreOfflineResume({source}:{source:CoreScoreQueue}){const [canonical,setCanonical]=useState<MatchView|null>(source.base),[error,setError]=useState(''),queue=useCoreScoreQueue(source.matchId,source.actorId,canonical,setCanonical),match=queue.projection;useEffect(()=>{const refresh=async()=>{try{const response=await fetch(`/api/matches/${source.matchId}`,{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok)return;setCanonical(await response.json());}catch{/* Last accepted state stays on the writing device. */}};void refresh();const timer=setInterval(()=>void refresh(),4000);return()=>clearInterval(timer);},[source.matchId]);if(!match)return <p>Deze partij is niet meer beschikbaar op dit toestel.</p>;return <main className="play-workspace"><a href="/app/play">DartFlow · Spelen</a><h1>Partij hervatten</h1><p role="status">{match.offlineConflict?.status==='open'?'Controle nodig':queue.pendingCount?`Wacht op verbinding (${queue.pendingCount})`:'Laatst geaccepteerde stand'}</p><div className="play-sides">{match.players.map((p,i)=><article key={p.id} className={match.turn===i?'play-turn':''}><h2>{p.name}</h2><strong className="play-big">{match.remaining[i]}</strong><p>{match.legs[i]} legs · {match.sets[i]} sets</p></article>)}</div>{match.cricket&&<CricketCard cricket={match.cricket} names={match.players.map(p=>p.name)}/>} {match.tactics&&<TacticsCard tactics={match.tactics} names={match.players.map(p=>p.name)} turn={match.turn}/>}<p>Aan de beurt: {match.players[match.turn]?.name} · {match.settings.startScore} · {match.settings.inRule??'single'} in · {match.settings.outRule??'double'} uit</p>{(error||queue.error)&&<p role="alert">{error||queue.error}</p>}<DartVisitInput disabled={!match.permissions.canScore||Boolean(match.offlineConflict?.status==='open')} onSubmit={hits=>{try{queue.enqueue({type:'score',score:hits.reduce((n,hit)=>n+dartValue(hit),0),darts:hits.length,dartHits:hits});setError('');}catch(e){setError((e as Error).message);}}}/><button className="button" onClick={()=>void queue.flush()}>Bewaarde beurten synchroniseren</button><a className="button" href={`/wedstrijd/${match.id}`}>Volledige partij openen zodra de verbinding terug is</a><PlayHelp articleId="hervatten-offline"/><PlayHelp articleId={match.settings.discipline==='tactics'?'tactics':match.settings.discipline==='cricket'?'cricket':'x01'}/></main>;}
