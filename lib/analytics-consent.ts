export const ANALYTICS_CONSENT_KEY = 'dartflow.analytics-consent.v1';
export const SOCIALHERO_SCRIPT = 'https://socialhero.dgwebservices.nl/api/pixel/script?site=sh_HAeYD7iQCpoinCRx1dqn9-QpiDSgAPA2';
export type AnalyticsChoice = 'granted' | 'denied';
const MAX_AGE = 180 * 24 * 60 * 60 * 1000;

export function readAnalyticsConsent(storage: Pick<Storage, 'getItem'>, now = Date.now(), withdrawnInTab = false): AnalyticsChoice | null {
  if (withdrawnInTab) return 'denied';
  try {
    const value = JSON.parse(storage.getItem(ANALYTICS_CONSENT_KEY) || 'null');
    if (!value || !['granted', 'denied'].includes(value.choice) || typeof value.at !== 'number' || !Number.isFinite(value.at) || value.at > now || now - value.at >= MAX_AGE) return null;
    return value.choice;
  } catch { return null; }
}

export function saveAnalyticsConsent(storage: Pick<Storage, 'setItem'> & Partial<Pick<Storage, 'removeItem'>>, choice: AnalyticsChoice, now = Date.now()): boolean {
  try { storage.setItem(ANALYTICS_CONSENT_KEY, JSON.stringify({choice, at: now})); return true; }
  catch {
    // A quota failure must not leave an earlier grant to be restored on reload.
    try { storage.removeItem?.(ANALYTICS_CONSENT_KEY); } catch { /* The UI reports that storage failed. */ }
    return false;
  }
}

export function browserBlocksAnalytics(browser: {doNotTrack?: string | null; globalPrivacyControl?: boolean}): boolean {
  return browser.doNotTrack === '1' || browser.globalPrivacyControl === true;
}

export function analyticsAllowedOnPath(path: string): boolean {
  return !/^\/(?:oche-live|koppel-scherm|baanscherm|scorebord|wedstrijd)(?:\/|$)/.test(path)
    && !/^\/blog\/beheer(?:\/|$)/.test(path)
    && path!=='/app/blog'
    && path!=='/app/schermen'
    && !/^\/app\/(?:match|training)(?:\/|$)/.test(path);
}

/** The flag must be set before the event, including when the vendor loads later. */
export function publishAnalyticsConsent(target: EventTarget & {socialheroConsent?: boolean}, granted: boolean): void {
  target.socialheroConsent = granted;
  target.dispatchEvent(new CustomEvent('socialhero:consent', {detail: granted}));
}
