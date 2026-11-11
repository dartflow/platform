"use client";

import { useEffect, useState, type FormEvent } from 'react';
import { BOARD_ID_PATTERN, SCOREBOARD_BINDING_KEY } from '@/lib/pwa';
import ClubBoardScreen from './club-board-screen';
import { InstallDartflow } from './pwa-install';

export function boardIdFromInput(value: string, origin: string): string | null {
  const input = value.trim();
  if (BOARD_ID_PATTERN.test(input)) return input.toLowerCase();
  try {
    const url = new URL(input, origin);
    const match = /^\/(?:baanscherm|baan)\/([^/]+)\/?$/.exec(url.pathname);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash || !match || !BOARD_ID_PATTERN.test(match[1])) return null;
    return match[1].toLowerCase();
  } catch {return null;}
}

/** The fallback app binds only after an explicit action; visiting another screen cannot redirect it. */
export default function ScoreboardLauncher() {
  const [ready, setReady] = useState(false);
  const [boardId, setBoardId] = useState('');
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SCOREBOARD_BINDING_KEY);
      if (stored && BOARD_ID_PATTERN.test(stored)) setBoardId(stored.toLowerCase());
    } catch {setError('Dit apparaat bewaart de koppeling niet. Sta lokale opslag toe of gebruik de vaste baanlink als kioskstartpagina.');}
    const suggested = new URLSearchParams(window.location.search).get('baan');
    if (suggested && BOARD_ID_PATTERN.test(suggested)) setInput(suggested.toLowerCase());
    setReady(true);
  }, []);
  async function bind(event: FormEvent) {
    event.preventDefault();
    const id = boardIdFromInput(input, window.location.origin);
    if (!id) {setError('Plak de vaste baanlink of het baan-ID van de wedstrijdleiding.'); return;}
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/board-screens/${id}`, {cache: 'no-store'});
      if (!response.ok && response.status !== 403) throw new Error(response.status === 404 ? 'Deze baan bestaat niet. Controleer de vaste link.' : 'De baan kan nu niet worden gecontroleerd. Probeer opnieuw met verbinding.');
      // A private board can be selected first and paired on its own screen afterwards.
      localStorage.setItem(SCOREBOARD_BINDING_KEY, id);
      setBoardId(id); setEditing(false);
      window.history.replaceState(null, '', '/scorebord');
    } catch (cause) {setError(cause instanceof Error ? cause.message : 'Koppelen is niet gelukt.');}
    finally {setBusy(false);}
  }
  if (!ready) return <div className="app-loading"><p>Het vaste baanscherm openen…</p></div>;
  if (boardId && !editing) return <>
    <ClubBoardScreen boardId={boardId} installKind="scoreboard" />
    <details className="scoreboard-fixed-controls"><summary>Vaste baan</summary><div><p>Dit icoon blijft gekoppeld aan baan-ID {boardId}. Het openen van een ander baanscherm wijzigt deze koppeling niet.</p><button className="button ghost" type="button" onClick={() => {setInput(boardId); setEditing(true);}}>Andere baan koppelen</button></div></details>
  </>;
  return <main className="scoreboard-setup"><section className="scoreboard-setup-content">
    <img src="/assets/dartflow-logo.svg" alt="DartFlow" /><p className="eyebrow">Een scherm, één vaste baan</p><h1>DartFlow Scorebord</h1>
    <p>Koppel deze app eenmalig aan een fysieke baan. Iedere volgende start toont dezelfde Sprint-weergave. Voor een afgeschermde baan heb je ook de eenmalige koppelcode van de wedstrijdleiding nodig.</p>
    <form className="scoreboard-setup-form" onSubmit={event => void bind(event)}><label htmlFor="scoreboard-board">Vaste baanlink of baan-ID</label><input id="scoreboard-board" value={input} onChange={event => setInput(event.target.value)} autoCapitalize="off" autoCorrect="off" required placeholder="https://…/baanscherm/…" /><button type="submit" className="button gold" disabled={busy}>{busy ? 'Baan controleren…' : 'Dit scherm aan deze baan koppelen'}</button></form>
    {error && <p className="notice error" role="alert">{error}</p>}{boardId && <button className="button ghost" type="button" onClick={() => setEditing(false)}>Terug naar de vaste baan</button>}
    <InstallDartflow kind="scoreboard" /><p>Geen appinstallatie mogelijk? Stel <strong>/scorebord</strong> of de vaste baanlink in als startpagina van de kioskbrowser. Bewaar de browsergegevens om de koppeling te behouden.</p>
  </section></main>;
}
