"use client";

import Script from 'next/script';
import {usePathname} from 'next/navigation';
import {useEffect, useRef, useState} from 'react';
import {ANALYTICS_CONSENT_KEY, SOCIALHERO_SCRIPT, analyticsAllowedOnPath, browserBlocksAnalytics, publishAnalyticsConsent, readAnalyticsConsent, saveAnalyticsConsent, type AnalyticsChoice} from '@/lib/analytics-consent';

export default function AnalyticsConsent({enabled}: {enabled: boolean}) {
  const path = usePathname();
  const allowedPath = analyticsAllowedOnPath(path);
  const [ready, setReady] = useState(false);
  const [choice, setChoice] = useState<AnalyticsChoice | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const withdrawal = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    function refresh(initial = false) {
      let saved: AnalyticsChoice | null = withdrawal.current ? 'denied' : null;
      try { saved = readAnalyticsConsent(window.localStorage, Date.now(), withdrawal.current); } catch { /* Storage may be disabled. */ }
      const privacy = browserBlocksAnalytics(navigator as Navigator & {globalPrivacyControl?: boolean});
      publishAnalyticsConsent(window, saved === 'granted' && !privacy && allowedPath);
      setChoice(saved); setBlocked(privacy); setReady(true);
      if (initial || saved === null) setOpen(saved === null);
    }
    refresh(true);
    const storage = (event: StorageEvent) => {if (event.key === ANALYTICS_CONSENT_KEY || event.key === null) refresh(true);};
    const focus = () => refresh();
    const visibility = () => {if (document.visibilityState === 'visible') refresh();};
    window.addEventListener('storage', storage);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      publishAnalyticsConsent(window, false);
      window.removeEventListener('storage', storage);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [enabled, allowedPath]);

  function choose(next: AnalyticsChoice) {
    const privacy = browserBlocksAnalytics(navigator as Navigator & {globalPrivacyControl?: boolean});
    // Apply withdrawal immediately, even when preference storage is unavailable.
    publishAnalyticsConsent(window, next === 'granted' && !privacy && allowedPath);
    let saved = false;
    try { saved = saveAnalyticsConsent(window.localStorage, next); } catch { /* The current callback still applies. */ }
    withdrawal.current = next === 'denied' && !saved;
    setChoice(next); setBlocked(privacy); setOpen(!saved);
    setMessage(saved ? '' : 'Je keuze geldt nu voor dit tabblad. Je browser kon deze niet bewaren. Probeer opnieuw om je keuze te onthouden.');
    if (saved) requestAnimationFrame(() => toggle.current?.focus());
  }

  if (!enabled || !ready || !allowedPath) return null;
  return <>
    {choice === 'granted' && !blocked && <Script id="socialhero-pixel" async src={SOCIALHERO_SCRIPT} strategy="afterInteractive" />}
    <div className="analytics-consent" data-app={path.startsWith('/app')}>
      {open ? <section ref={panel} tabIndex={-1} className="analytics-consent-panel" role="region" aria-labelledby="analytics-consent-title" onKeyDown={event => {if (event.key === 'Escape' && choice !== null) {setOpen(false); requestAnimationFrame(() => toggle.current?.focus());}}}>
        {choice !== null && <button type="button" className="analytics-consent-close" aria-label="Privacyvoorkeuren sluiten" onClick={() => {setOpen(false); requestAnimationFrame(() => toggle.current?.focus());}}>×</button>}
        <h2 id="analytics-consent-title">Jouw privacy</h2>
        <p>Met jouw toestemming gebruikt DartFlow SocialHero om paginabezoeken en klikken te meten. Spelen en inloggen werken ook zonder analytics.</p>
        <p>Je keuze geldt voor deze browser. Je kunt deze altijd wijzigen via Privacyvoorkeuren.</p>
        <p>{blocked ? 'Je browser vraagt om niet te worden gevolgd. Analytics blijven uit.' : choice === 'granted' ? 'Analytics zijn toegestaan.' : 'Analytics staan uit.'}</p>
        <div className="analytics-consent-actions">
          <button type="button" className="analytics-consent-choice" onClick={() => choose('denied')}>Analytics weigeren</button>
          <button type="button" className="analytics-consent-choice" disabled={blocked} onClick={() => choose('granted')}>Analytics accepteren</button>
        </div>
        {message && <p role="status">{message}</p>}
      </section> : <button ref={toggle} type="button" className="analytics-consent-toggle" onClick={() => {setOpen(true); requestAnimationFrame(() => panel.current?.focus());}}>Privacyvoorkeuren</button>}
    </div>
  </>;
}
