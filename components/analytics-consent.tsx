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
  const [fromFooter, setFromFooter] = useState(false);
  const [message, setMessage] = useState('');
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLElement>(null);
  const withdrawal = useRef(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    function refresh() {
      let saved: AnalyticsChoice | null = withdrawal.current ? 'denied' : null;
      try { saved = readAnalyticsConsent(window.localStorage, Date.now(), withdrawal.current); } catch { /* Storage may be disabled. */ }
      const privacy = browserBlocksAnalytics(navigator as Navigator & {globalPrivacyControl?: boolean});
      publishAnalyticsConsent(window, saved === 'granted' && !privacy && allowedPath);
      setChoice(saved); setBlocked(privacy); setReady(true);
      if (!initialized.current || saved === null) setOpen(saved === null);
      initialized.current = true;
    }
    refresh();
    if (!allowedPath) {setOpen(false); setFromFooter(false);}
    const storage = (event: StorageEvent) => {if (event.key === ANALYTICS_CONSENT_KEY || event.key === null) refresh();};
    const focus = () => refresh();
    const visibility = () => {if (document.visibilityState === 'visible') refresh();};
    const preferences = (event: MouseEvent) => {
      if (!allowedPath || !(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>('button[data-open-dartflow-privacy]');
      if (!button) return;
      event.preventDefault(); returnFocus.current = button;
      setFromFooter(true); setOpen(true);
      requestAnimationFrame(() => panel.current?.focus({preventScroll: true}));
    };
    window.addEventListener('storage', storage);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('click', preferences);
    return () => {
      publishAnalyticsConsent(window, false);
      window.removeEventListener('storage', storage);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('click', preferences);
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
    if (saved) {setFromFooter(false); requestAnimationFrame(() => returnFocus.current?.focus({preventScroll: true}));}
  }

  function close() {
    setOpen(false); setFromFooter(false);
    requestAnimationFrame(() => returnFocus.current?.focus({preventScroll: true}));
  }

  if (!enabled || !ready || !allowedPath) return null;
  return <>
    {choice === 'granted' && !blocked && <Script id="socialhero-pixel" async src={SOCIALHERO_SCRIPT} strategy="afterInteractive" />}
    {open && <div className={fromFooter ? 'dartflow-privacy-settings' : 'analytics-consent'} data-app={path.startsWith('/app')}>
      <section ref={panel} tabIndex={-1} className="dartflow-privacy-panel" role="region" aria-labelledby="dartflow-privacy-title" onKeyDown={event => {if (event.key === 'Escape' && (choice !== null || fromFooter)) close();}}>
        {(choice !== null || fromFooter) && <button type="button" className="dartflow-privacy-close" aria-label="Privacyvoorkeuren sluiten" onClick={close}>×</button>}
        <h2 id="dartflow-privacy-title">Jouw privacy</h2>
        <p>Met jouw toestemming gebruikt DartFlow SocialHero om paginabezoeken en klikken te meten. Spelen en inloggen werken ook zonder analytics.</p>
        <p>Je keuze geldt voor deze browser. Je kunt deze altijd wijzigen via Privacyvoorkeuren.</p>
        <p>{blocked ? 'Je browser vraagt om niet te worden gevolgd. Analytics blijven uit.' : choice === 'granted' ? 'Analytics zijn toegestaan.' : 'Analytics staan uit.'}</p>
        <div className="analytics-consent-actions">
          <button type="button" className="dartflow-privacy-choice" onClick={() => choose('denied')}>Analytics weigeren</button>
          <button type="button" className="dartflow-privacy-choice" disabled={blocked} onClick={() => choose('granted')}>Analytics accepteren</button>
        </div>
        {message && <p role="status">{message}</p>}
      </section>
    </div>}
  </>;
}
