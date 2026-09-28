/* LIVE-04 — cookie-free visit counts.
   Decides whether a visit may be counted and builds the one request that counts
   it, in GoatCounter's documented /count format (https://www.goatcounter.com/help/pixel).
   No imports on purpose: the Node test runner loads this file directly, and the
   browser half (src/components/Analytics.astro) stays a few hundred bytes. */

export interface Visitor {
  /** navigator.doNotTrack (or window.doNotTrack in older browsers). */
  dnt: string | null | undefined;
  /** navigator.globalPrivacyControl. */
  gpc: boolean | undefined;
  /** navigator.webdriver — automated browsers are never counted. */
  webdriver: boolean | undefined;
  hostname: string;
  protocol: string;
}

const LOCAL = /^(localhost|127(\.\d+){3}|\[::1\]|0\.0\.0\.0)?$/;

/** Whether this visit may be counted: never with DNT or GPC on, never locally or by a robot. */
export function shouldCount(v: Visitor): boolean {
  if (v.dnt === '1' || v.dnt === 'yes' || v.gpc === true || v.webdriver === true) return false;
  return /^https?:$/.test(v.protocol) && !LOCAL.test(v.hostname);
}

export interface Hit {
  /** The page's path (query and fragment are dropped), or the event's name. */
  path: string;
  title: string;
  /** document.referrer — sent only when it's another site, and only its origin + path. */
  referrer?: string;
  /** This site's host, to tell internal navigation from a real referrer. */
  host?: string;
  /** [width, height, devicePixelRatio]. */
  screen?: [number, number, number];
  event?: boolean;
  /** Cache buster; random by default. */
  rnd?: string;
}

function externalReferrer(referrer: string | undefined, host: string | undefined): string | null {
  if (!referrer) return null;
  try {
    const u = new URL(referrer);
    if (!/^https?:$/.test(u.protocol) || u.host === host) return null;
    return u.origin + u.pathname;
  } catch {
    return null;
  }
}

/** The count request for one page view or event. */
export function hitUrl(endpoint: string, hit: Hit): string {
  const q = new URLSearchParams();
  q.set('p', hit.event ? hit.path : hit.path.replace(/[?#].*$/, ''));
  q.set('t', hit.title);
  const r = externalReferrer(hit.referrer, hit.host);
  if (r) q.set('r', r);
  if (hit.screen) q.set('s', hit.screen.join(','));
  if (hit.event) q.set('e', 'true');
  q.set('rnd', hit.rnd ?? Math.random().toString(36).slice(2, 8));
  return `${endpoint}?${q}`;
}

/** "ASTRO · Jets — Orbital Station": the orbit name makes one orbit filterable in the dashboard. */
export function orbitTitle(title: string, orbitName: string | null | undefined): string {
  return orbitName ? `${orbitName} · ${title}` : title;
}
