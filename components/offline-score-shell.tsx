'use client';
import {useEffect,useState} from 'react';
import type {CoreScoreQueue} from '@/lib/core-offline';
import {useCoreScoreQueue} from './use-core-score-queue';
import PlayWorkspace from './play-workspace';
import DartVisitInput from './dart-visit-input';
import DartScoreConsole from './dart-score-console';
import VisitTotalInput from './visit-total-input';
import {useScoreInputPreferences} from '@/lib/score-input-preferences';
import {ScoreInputControl} from './score-input-settings';
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
function CoreOfflineResume({source}:{source:CoreScoreQueue}){
 const scorePreferences=useScoreInputPreferences(source.actorId);
 const [canonical,setCanonical]=useState<MatchView|null>(source.base),[error,setError]=useState(''),[consoleOpen,setConsoleOpen]=useState(true),queue=useCoreScoreQueue(source.matchId,source.actorId,canonical,setCanonical),match=queue.projection;
 useEffect(()=>{const refresh=async()=>{try{const response=await fetch(`/api/matches/${source.matchId}`,{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok)return;setCanonical(await response.json());}catch{/* Last accepted state stays on the writing device. */}};void refresh();const timer=setInterval(()=>void refresh(),4000);return()=>clearInterval(timer);},[source.matchId]);
 if(!match)return <p>Deze partij is niet meer beschikbaar op dit toestel.</p>;
 const active=consoleOpen&&match.status==='live'&&match.offlineConflict?.status!=='open';
 const totalAllowed=match.settings.discipline!=='cricket'&&match.settings.discipline!=='tactics'&&match.settings.inRule!=='double'&&(!match.settings.outRule||match.settings.outRule==='double'),total=totalAllowed&&scorePreferences.modes.x01==='total',preferenceGame=match.settings.discipline==='cricket'?'cricket':match.settings.discipline==='tactics'?'tactics':'x01';
 const scoreboard=<div className="score-console-players" aria-label="Actuele stand">{match.players.map((player,index)=><div key={player.id} className={match.turn===index?'is-active':''}><span>{match.sideNames?.[index]??player.name}</span><strong className="console-remaining">{match.cricket?.points[index]??match.tactics?.points[index]??match.remaining[index]}</strong><small>{match.turn===index?'Aan de beurt':match.cricket||match.tactics?'Punten':'Restscore'}</small></div>)}</div>;
 const options=<><ScoreInputControl actorId={source.actorId} game={preferenceGame} totalAllowed={totalAllowed} reason="Deze spelregels vereisen de werkelijk geworpen pijlen; je voorkeur blijft bewaard."/>{match.cricket&&<CricketCard cricket={match.cricket} names={match.players.map(player=>player.name)}/>} {match.tactics&&<TacticsCard tactics={match.tactics} names={match.players.map(player=>player.name)} turn={match.turn}/>}<button className="button" onClick={()=>void queue.flush()}>Bewaarde beurten synchroniseren</button><a className="button" href={`/wedstrijd/${match.id}`}>Volledige partij openen zodra de verbinding terug is</a><PlayHelp articleId="hervatten-offline"/><PlayHelp articleId={match.settings.discipline==='tactics'?'tactics':match.settings.discipline==='cricket'?'cricket':'x01'}/></>;
 return <main className="play-workspace"><a href="/app/play">DartFlow · Spelen</a><h1>Partij hervatten</h1><p role="status">{match.offlineConflict?.status==='open'?'Controle nodig':queue.pendingCount?`Wacht op verbinding (${queue.pendingCount})`:'Laatst geaccepteerde stand'}</p>{!active&&scoreboard}<p>Aan de beurt: {match.currentThrower?.name??match.players[match.turn]?.name} · {match.settings.startScore} · {match.settings.inRule??'single'} in · {match.settings.outRule??'double'} uit</p>{!active&&<button className="button gold" onClick={()=>setConsoleOpen(true)}>Scoreweergave openen</button>}<DartScoreConsole title="Partij hervatten" open={active} onBack={()=>setConsoleOpen(false)} offline={true} scoreboard={scoreboard} message={(!totalAllowed?'Deze spelregels vereisen werkelijke pijlen. ':'')+(error||queue.error||(queue.pendingCount?`Wacht op verbinding (${queue.pendingCount}) · beurten op dit toestel bewaard`:'Laatst geaccepteerde stand'))} options={options}><div className="score-input-mode" hidden={!total} inert={!total}><VisitTotalInput disabled={!match.permissions.canScore||match.status!=='live'||Boolean(match.offlineConflict?.status==='open')} remaining={match.remaining[match.turn]} resetKey={`${match.revision}:${queue.pendingCount}`} onSubmit={input=>{try{queue.enqueue({type:'score',...input});setError('');return true;}catch(e){setError((e as Error).message);return false;}}}/></div><div className="score-input-mode" hidden={total} inert={total}><DartVisitInput disabled={!match.permissions.canScore||match.status!=='live'||Boolean(match.offlineConflict?.status==='open')} thrower={match.currentThrower?.name??match.players[match.turn]?.name} resetKey={`${match.revision}:${queue.pendingCount}`} onSubmit={hits=>{try{queue.enqueue({type:'score',score:hits.reduce((sum,hit)=>sum+dartValue(hit),0),darts:hits.length,dartHits:hits});setError('');return true;}catch(e){setError((e as Error).message);return false;}}}/></div></DartScoreConsole>{!active&&options}</main>;
}
