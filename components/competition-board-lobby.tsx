"use client";

import {useCallback,useEffect,useRef,useState} from 'react';
import type {CompetitionBoardContext,CompetitionBoardLobby} from '@/lib/competition-board-lobby-types';

export default function CompetitionBoardLobbyPanel({boardId,actorId,onChanged}:{boardId:string;actorId:string;onChanged:()=>unknown}){
 const [data,setData]=useState<CompetitionBoardContext|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[dismissed,setDismissed]=useState(false),[username,setUsername]=useState(''),[pin,setPin]=useState('');
 const generation=useRef(0);
 const refresh=useCallback(async()=>{const current=++generation.current;try{const response=await fetch(`/api/boards/${encodeURIComponent(boardId)}/competition`,{cache:'no-store'});const body=await response.json();if(!response.ok)throw new Error(body.error??'De competitieplanning is tijdelijk niet bereikbaar.');if(current===generation.current)setData(body);}catch(cause){if(current===generation.current)setError(cause instanceof Error?cause.message:'De competitieplanning is tijdelijk niet bereikbaar.');}},[boardId]);
 useEffect(()=>{const pending=generation;void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},2500);return()=>{pending.current++;clearInterval(timer);};},[refresh]);
 async function send(action:Record<string,unknown>,privatePin=false){
  if(busy)return;setBusy(true);setError('');
  try{const response=await fetch(`/api/competition-lobbies/${privatePin?'player-pin':'actions'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),...(privatePin?action:{action})})});const body=await response.json();if(!response.ok)throw new Error(body.error??'De wedstrijdlobby is gewijzigd. Vernieuw en probeer opnieuw.');setPin('');if(body.url){window.location.assign(body.url);return;}if(body.lobby)setData(value=>({boardId,candidates:value?.candidates??[],lobby:body.lobby}));await refresh();void onChanged();}catch(cause){setError(cause instanceof Error?cause.message:'De wedstrijdlobby kon niet worden bijgewerkt.');setPin('');await refresh();}finally{setBusy(false);}
 }
 const lobby=data?.lobby;
 if(!data)return error?<section className="notice error" role="status">{error}<button type="button" className="button ghost small" onClick={()=>void refresh()}>Planning opnieuw controleren</button></section>:null;
 if(!lobby&&!data.candidates.length)return null;
 if(dismissed&&!lobby)return <button type="button" className="button ghost" onClick={()=>setDismissed(false)}>Mijn competitieplanning op deze baan tonen</button>;
 return <section className="panel competition-board-lobby" aria-label="Competitiewedstrijd via baan-QR">
  <p className="eyebrow">OFFICIËLE COMPETITIE · DEZELFDE GEPLANDE PARTIJ</p>
  <h2>{lobby?'Wedstrijdlobby':'Competitiewedstrijd starten?'}</h2>
  {error&&<p className="notice error" role="alert">{error}</p>}
  {lobby?<>
   <p><strong>{lobby.seasonName}</strong> · Ronde {lobby.round} · {lobby.boardName}</p>
   <p>{rules(lobby)}. De oorspronkelijke wedstrijd en de vooraf vastgelegde rankingbestemmingen blijven gekoppeld.</p>
   <ul>{lobby.players.map(player=><li key={player.id}><strong>{player.name}</strong>{player.username&&<span> · @{player.username}</span>}<span> · {player.confirmed?'Deelname bevestigd':'Moet nog zelf aansluiten'}</span></li>)}</ul>
   <p><strong>Schrijver: {lobby.writerName}.</strong> {lobby.writerDeviceLabel}. Na het klaarzetten voert dit account de score in. Een pincode wisselt de ingelogde account niet.</p>
   {lobby.status==='started'?<a className="button gold" href={lobby.matchUrl}>Oorspronkelijke partij hervatten ↗</a>:['expired','canceled'].includes(lobby.status)?<p className="notice">Deze tijdelijke lobby is gesloten. De geplande partij blijft in het programma staan. Scan opnieuw om de actuele situatie te openen.</p>:<>
    <p className="muted-copy">Tijdelijke baanreservering tot {new Date(lobby.expiresAt).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}. Beide geplande spelers moeten binnen deze lobby bevestigen.</p>
    {lobby.canConfirm&&<button type="button" className="button gold" disabled={busy} onClick={()=>void send({type:'confirm',lobbyId:lobby.id})}>Mijn eigen deelname bevestigen</button>}
    {lobby.writerId===actorId&&lobby.players.some(player=>player.id!==actorId&&!player.confirmed)&&<>
     <p>De geplande tegenstander scant dezelfde baan-QR met het eigen aangemelde account. Of laat die op dit gedeelde toestel de eigen gebruikersnaam en zescijferige spelerspincode invullen.</p>
     <form onSubmit={event=>{event.preventDefault();void send({lobbyId:lobby.id,username,pin},true);}}><fieldset disabled={busy}><legend>Geplande tegenstander op dit toestel bevestigen</legend><label className="field">Gebruikersnaam tegenstander<input value={username} onChange={event=>setUsername(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={81} required/></label><label className="field">Eigen spelerspincode tegenstander<input type="password" value={pin} onChange={event=>setPin(event.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" minLength={6} maxLength={6} required/></label><button type="submit" className="button gold" disabled={busy||pin.length!==6||!username}>Geplande tegenstander bevestigen</button></fieldset></form>
     <small>Heeft de tegenstander nog geen spelerspincode? Die kan zich op het eigen toestel aanmelden of in het eigen profiel een pincode instellen.</small>
    </>}
    {lobby.canStart?<button type="button" className="button gold full" disabled={busy} onClick={()=>void send({type:'prepare',lobbyId:lobby.id})}>Beide spelers bevestigd · Open officiële partij</button>:<p>De eerste speler opent de officiële partij zodra beide geplande deelnemers zijn bevestigd. Daarna volgen de gekozen startprocedure en de bestaande startbevestigingen.</p>}
    {lobby.canCancel&&<button type="button" className="button ghost" disabled={busy} onClick={()=>void send({type:'cancel',lobbyId:lobby.id})}>Lobby sluiten en baan vrijgeven</button>}
   </>}
  </>:<>
   <p>{data.candidates.length===1?'Je hebt een geplande partij bij deze vereniging.':'Kies de juiste geplande partij. Alleen je eigen toegankelijke planning staat hieronder.'}</p>
   {data.candidates.map(candidate=><article key={candidate.slotId} className="notice"><h3>{candidate.seasonName} · Ronde {candidate.round}</h3><p>Tegen <strong>{candidate.opponent.name}</strong>{candidate.opponent.username&&` (@${candidate.opponent.username})`} · {candidate.boardName}</p><p>{candidate.startsAt?new Date(candidate.startsAt).toLocaleString('nl-NL'):`Speelvenster ${new Date(candidate.windowStart).toLocaleString('nl-NL')} – ${new Date(candidate.windowEnd).toLocaleString('nl-NL')}`}</p><p>{candidate.settings.startScore} · {candidate.settings.discipline==='cricket'?'Cricket':'X01'} · {candidate.settings.bestOfLegs} legs</p>{candidate.blockedReason&&<p>{candidate.blockedReason}</p>}{candidate.resumeUrl?<a className="button gold" href={candidate.resumeUrl}>Bestaande partij hervatten ↗</a>:<button type="button" className="button gold" disabled={busy||!candidate.canOpen} onClick={()=>void send({type:'open',boardId,seasonId:candidate.seasonId,fixtureId:candidate.fixtureId,slotId:candidate.slotId})}>Ja, competitiewedstrijd starten</button>}<a className="button ghost small" href={`/app/competities/${candidate.seasonId}?fixture=${candidate.fixtureId}`}>Planning en startvoorwaarden ↗</a></article>)}
   <button type="button" className="button ghost" onClick={()=>setDismissed(true)}>Terug naar vrijspel op deze baan</button>
  </>}
  <p><a href="/help?q=competitie%20QR">Hulp bij competitiewedstrijd via QR ↗</a></p>
 </section>;
}
function rules(lobby:CompetitionBoardLobby){return`${lobby.settings.discipline==='cricket'?'Cricket':'X01'} ${lobby.settings.startScore} · ${lobby.settings.bestOfLegs} legs · ${lobby.settings.bestOfSets??1} set(s)`;}
