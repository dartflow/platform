"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type InstallEvent = Event & {prompt: () => Promise<void>; userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>};
type InstallState = {standalone: boolean | null; prompt: InstallEvent | null; clear: () => void};
const InstallContext = createContext<InstallState>({standalone: null, prompt: null, clear: () => {}});

/** Capture the browser-owned prompt once. No persisted "last board" or manifest mutation. */
export function PwaRuntime({children}: {children: ReactNode}) {
  const [standalone, setStandalone] = useState<boolean | null>(null);
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const appWindow = useRef(false);
  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone), (display-mode: minimal-ui)');
    const update = () => {
      // Browser fullscreen alone does not identify an installed app. Remember an
      // observed app window when that window temporarily enters DOM fullscreen.
      appWindow.current ||= media.matches || Boolean((navigator as Navigator & {standalone?: boolean}).standalone);
      setStandalone(appWindow.current);
    };
    const beforeInstall = (event: Event) => {event.preventDefault(); setPrompt(event as InstallEvent);};
    const installed = () => {setPrompt(null); update();};
    update();
    media.addEventListener('change', update);
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', installed);
    if ('serviceWorker' in navigator && window.isSecureContext) {
      void navigator.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'}).catch(() => {});
    }
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);
  return <InstallContext.Provider value={{standalone, prompt, clear: () => setPrompt(null)}}>{children}</InstallContext.Provider>;
}

export function InstallDartflow({kind = 'player', boardId, boardName}: {kind?: 'player' | 'board' | 'scoreboard'; boardId?: string; boardName?: string}) {
  const install = useContext(InstallContext);
  const [instructions, setInstructions] = useState(false);
  const [message, setMessage] = useState('');
  const [ios, setIos] = useState(false);
  useEffect(() => {setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);}, []);
  if (install.standalone !== false) return null;
  const label = kind === 'board' ? 'Installeer dit baanscherm' : kind === 'scoreboard' ? 'Installeer Oche Live' : 'Installeer DartFlow';
  const title = kind === 'board' ? `Oche Live · ${boardName || 'Baanscherm'}` : kind === 'scoreboard' ? 'Oche Live' : 'DartFlow Speler';
  const path = kind === 'board' && boardId ? `/baanscherm/${boardId}` : kind === 'scoreboard' ? '/scorebord' : '/speler';
  async function openInstall() {
    setMessage('');
    if (install.prompt) {
      try {await install.prompt.prompt(); await install.prompt.userChoice;}
      catch {setInstructions(true);}
      finally {install.clear();}
    } else setInstructions(true);
  }
  async function copyExactLink() {
    try {await navigator.clipboard.writeText(new URL(path, window.location.origin).href); setMessage('De vaste link is gekopieerd.');}
    catch {setMessage('Open de vaste link hieronder en gebruik het browsermenu.');}
  }
  return <div className={`pwa-install pwa-install-${kind}`}>
    <button type="button" className="pwa-install-button" onClick={() => void openInstall()} aria-label={label} title={label}><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/></svg><span>{label}</span></button>
    {instructions && <div className="pwa-install-backdrop" onClick={() => setInstructions(false)}><section className="pwa-install-dialog" role="dialog" aria-modal="true" aria-label={label} onClick={event => event.stopPropagation()}>
      <button className="pwa-install-close" type="button" aria-label="Installatie sluiten" onClick={() => setInstructions(false)}>×</button>
      <p className="eyebrow">Op je beginscherm</p><h2>{title}</h2>
      <p>{ios ? 'Open deze vaste link in Safari. Tik op Delen en daarna op Zet op beginscherm. Kies Open als webapp als die optie verschijnt.' : 'Open deze vaste link. Kies in het browsermenu App installeren of Toevoegen aan beginscherm. Een snelkoppeling naar deze exacte link werkt ook.'}</p>
      {kind === 'board' && <p>Voeg elke baan apart toe. Geef dit icoon de naam <strong>{title}</strong>. Start dit icoon opnieuw om steeds dezelfde baan te openen.</p>}
      <a className="pwa-exact-link" href={path}>{path}</a><button type="button" className="button ghost" onClick={() => void copyExactLink()}>Kopieer vaste link</button>
      {kind === 'board' && <p>Ondersteunt dit apparaat geen apart baanicoon? <a className="text-link" href={`/scorebord?baan=${encodeURIComponent(boardId || '')}`}>Open Oche Live</a> en koppel dit scherm daar eenmalig. Voor een tv-box zonder installatie gebruik je deze vaste link als kioskstartpagina.</p>}
      {message && <p role="status">{message}</p>}
    </section></div>}
  </div>;
}
