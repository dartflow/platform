"use client";

import { useEffect, useState, type FormEvent } from "react";
import {InstallDartflow} from "./pwa-install";
import type { ClubBoardScreenView } from "@/lib/types";
import SprintDisplay from "./sprint-display";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const scanInstruction = "Scan om te registreren of aan te melden en mee te spelen";

/** The QR always identifies the physical board, never a session or writer grant. */
export function ClubBoardQr({ boardId, label = "Registreren, aanmelden en spelen" }: { boardId: string; label?: string }) {
  const path = `/baan/${encodeURIComponent(boardId)}`;
  const [image, setImage] = useState("");
  useEffect(() => {
    let cancelled = false;
    const target = new URL(path, window.location.origin).href;
    void import("qrcode").then(module => module.toDataURL(target, {
      width: 320, margin: 3, errorCorrectionLevel: "M",
      color: { dark: "#111917", light: "#ffffff" },
    })).then(value => { if (!cancelled) setImage(value); }).catch(() => {});
    return () => { cancelled = true; };
  }, [path]);
  return <div className="qr-block club-board-qr">
    <a href={path} aria-label={label} title={scanInstruction}>
      {image ? <img className="qr-image" src={image} width={160} height={160} alt={`QR-code: ${scanInstruction}`} /> : <span className="qr-placeholder" aria-label="QR-code laden">QR</span>}
    </a>
    <div><strong>{label}</strong><p>{scanInstruction}.</p><a className="text-link" href={path}>Open deze baan ↗</a></div>
  </div>;
}

function ScreenWakeLock() {
  const [active, setActive] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [supported, setSupported] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const nav = navigator as Navigator & {wakeLock?: {request: (type: 'screen') => Promise<WakeLockSentinel>}};
    setSupported(Boolean(nav.wakeLock));
    if (!nav.wakeLock || !enabled) return;
    let stopped = false;
    let sentinel: WakeLockSentinel | null = null;
    const acquire = async () => {
      if (stopped || document.visibilityState !== 'visible' || sentinel && !sentinel.released) return;
      try {
        const next = await nav.wakeLock!.request('screen');
        if (stopped) {await next.release(); return;}
        sentinel = next; setActive(true);
        next.addEventListener('release', () => {if (!stopped) setActive(false);});
      } catch {if (!stopped) setActive(false);}
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    window.addEventListener('focus', acquire);
    return () => {stopped = true; void sentinel?.release(); document.removeEventListener('visibilitychange', acquire); window.removeEventListener('focus', acquire); setActive(false);};
  }, [enabled, attempt]);
  if (!supported) return null;
  return <button className="screen-wake-button" type="button" data-active={active} aria-pressed={active} onClick={() => {if (active) setEnabled(false); else {setEnabled(true); setAttempt(value => value + 1);}}}>{active ? 'Scherm blijft wakker ✓' : enabled ? 'Wakker houden opnieuw proberen' : 'Scherm wakker houden'}</button>;
}

export default function ClubBoardScreen({ boardId, installKind = 'board' }: { boardId: string; installKind?: 'board' | 'scoreboard' }) {
  const [data, setData] = useState<ClubBoardScreenView | null>(null);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [needsPairing, setNeedsPairing] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [pairBusy, setPairBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let stopped = false;
    let busy = false;
    let request: AbortController | null = null;
    setData(null); setError(''); setNeedsPairing(false); setStale(false);
    const refresh = async () => {
      if (busy || stopped) return;
      if (!uuid.test(boardId)) {setError('Deze schermlink hoort niet bij een bestaande baan.'); return;}
      busy = true;
      request = new AbortController();
      const timeout = window.setTimeout(() => request?.abort(), 8000);
      try {
        const response = await fetch(`/api/board-screens/${encodeURIComponent(boardId)}`, {cache: 'no-store', signal: request.signal});
        const body = await response.json();
        if (!response.ok) {
          if (!stopped && [401, 403, 404, 410].includes(response.status)) {
            // Reachable revocation/deletion must remove the last private stand immediately.
            setData(null); setNeedsPairing(response.status === 403); setStale(false);
            setError(typeof body.error === 'string' ? body.error : 'Dit baanscherm is niet beschikbaar.');
            return;
          }
          throw new Error(typeof body.error === 'string' ? body.error : 'Dit baanscherm is niet beschikbaar.');
        }
        if (!stopped) {setData(body); setError(''); setStale(false); setNeedsPairing(false);}
      } catch (cause) {
        if (!stopped) {setStale(true); setError(cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'Verbinding onderbroken.');}
      } finally {clearTimeout(timeout); busy = false;}
    };
    const offline = () => {if (!stopped) {setStale(true); setError('Verbinding onderbroken.'); request?.abort();}};
    const visible = () => {if (document.visibilityState === 'visible') void refresh();};
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    window.addEventListener('online', refresh); window.addEventListener('offline', offline); document.addEventListener('visibilitychange', visible);
    return () => {stopped = true; request?.abort(); clearInterval(timer); window.removeEventListener('online', refresh); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', visible);};
  }, [boardId, generation]);
  const boardName = data?.board.name;
  useEffect(() => {
    if (!boardName || installKind !== 'board') return;
    const title = `DartFlow · ${boardName}`;
    document.title = title;
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', title);
  }, [boardName, installKind]);
  async function pair(event: FormEvent) {
    event.preventDefault(); setPairBusy(true); setError('');
    try {
      const response = await fetch(`/api/board-screens/${encodeURIComponent(boardId)}/pair`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code: pairCode})});
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Koppelen is niet gelukt.');
      setPairCode(''); setGeneration(value => value + 1);
    } catch (cause) {setError(cause instanceof Error ? cause.message : 'Koppelen is niet gelukt.');}
    finally {setPairBusy(false);}
  }
  const tools = <div className="board-screen-tools">{(data || needsPairing || installKind === 'scoreboard') && <InstallDartflow kind={installKind} boardId={boardId} boardName={data?.board.name} />}<ScreenWakeLock /></div>;
  const offline = stale && data ? <div className="board-screen-offline" role="status">Offline · Laatst ontvangen stand. De actuele baan wordt na herstel opnieuw opgehaald.</div> : null;
  if (data?.snapshot.match) return <div className="club-board-screen club-board-screen-live">{tools}{offline}
    <SprintDisplay snapshot={data.snapshot} stale={stale} qr={<ClubBoardQr boardId={data.board.id} />} scanInstruction={scanInstruction} />
  </div>;
  return <main className="club-board-screen club-board-idle">{tools}{offline}
    <div className="club-board-idle-frame">
      <header><img src="/assets/dartflow-logo.svg" alt="DartFlow" /><span className="connection" data-state={stale ? 'stale' : 'live'}>{stale ? 'Verbinding onderbroken' : data ? 'Live verbonden' : needsPairing ? 'Koppeling nodig' : error ? 'Niet beschikbaar' : 'Verbinden…'}</span></header>
      {!data ? <section className="club-board-idle-content"><img className="club-board-illustration" src="/assets/dartboard.svg" alt="" /><h1>{needsPairing ? 'Koppel dit baanscherm' : error ? 'Scherm niet beschikbaar' : 'Baan openen…'}</h1><p>{needsPairing ? 'Vraag de wedstrijdleiding om een eenmalige koppelcode. Dit apparaat krijgt alleen toegang tot de stand op deze baan.' : error || 'De actuele baan ophalen.'}</p>{needsPairing && <form className="board-pair-form" onSubmit={event => void pair(event)}><label htmlFor="screen-pair-code">Koppelcode van de wedstrijdleiding</label><input id="screen-pair-code" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={30} value={pairCode} onChange={event => setPairCode(event.target.value)} required placeholder="XXXX XXXX XXXX" /><button className="button gold" type="submit" disabled={pairBusy}>{pairBusy ? 'Koppelen…' : 'Dit baanscherm koppelen'}</button>{error && <p className="notice error" role="alert">{error}</p>}</form>}</section> : <>
        <section className="club-board-idle-context"><p className="eyebrow">{data.board.clubName}</p><h1>{data.board.name}</h1><span className="badge">{data.status === 'blocked' ? 'Tijdelijk buiten gebruik' : data.status === 'waiting' ? 'Een speler wacht' : 'Klaar om te spelen'}</span></section>
        <section className="club-board-idle-content"><img className="club-board-illustration" src="/assets/dartboard.svg" alt="" /><h2>{data.status === 'blocked' ? 'Even pauze aan dit bord.' : data.status === 'waiting' ? 'Jouw tegenstander staat klaar.' : 'De baan is van jullie.'}</h2><p>{data.status === 'blocked' ? 'Deze baan is tijdelijk geblokkeerd door de vereniging.' : data.status === 'waiting' ? 'Scan dezelfde QR om met je eigen account mee te spelen.' : 'Solo trainen, samen aan het bord of met een tegenstander op afstand.'}</p></section>
        <section className="club-board-idle-scan"><h2>{scanInstruction}</h2><ClubBoardQr boardId={data.board.id} />{data.board.access === 'club' && <p>Spelen is voor leden van deze vereniging.</p>}</section>
      </>}
      <footer>Alleen-lezen baanscherm · Scores voer je in op je telefoon.{stale && data && <span> De laatste stand blijft zichtbaar; de verbinding wordt hersteld.</span>}</footer>
    </div>
  </main>;
}
