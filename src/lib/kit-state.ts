/* Orbit Kit (PLAY-01) — state that lives only in the URL fragment.
   No imports on purpose: node:test loads this file directly, the same way
   tests/site/orrery-layout.test.mjs loads src/lib/orrery-layout.ts. That
   means the clock/proximity math below is a small, deliberate duplicate of
   orrery-layout.ts's `clockToDeg` / `proximity` / `isNearClock` rather than
   an import of them — see that file's own note on the same trade-off.

   The fragment is untrusted input: anything under `decodeState` treats it
   as hostile and never renders it as HTML (callers must use textContent /
   SVG text nodes, never innerHTML — this module only produces plain data). */

export const KIT_VERSION = 1;
export const FRAGMENT_PREFIX = 'k1.';

export const MIN_ORBITS = 1;
export const MAX_ORBITS = 12;
export const MAX_NAME_LEN = 24;
export const MAX_CONSTANTS = 5;
export const MAX_CONSTANT_LEN = 20;
export const MIN_CAPACITY = 1;
export const MAX_CAPACITY = 4;
export const DEFAULT_CAPACITY = 3;

export interface KitOrbit {
  name: string;
  /** "H:MM", H 1–12 — see `cleanClock`. */
  clock: string;
}

export interface KitState {
  version: 1;
  orbits: KitOrbit[];
  constants: string[];
  capacity: number;
}

export interface DecodeResult {
  state: KitState;
  /** False only when a fragment was present but unreadable (bad base64, bad
      JSON, wrong shape) — the caller should show a visible notice. */
  ok: boolean;
  /** True when there was no fragment at all — a fresh visit, not an error. */
  empty: boolean;
}

/* -------------------------------------------------------------
   CLOCK / NEAR MATH — duplicated from orrery-layout.ts (see header note).
   ------------------------------------------------------------- */
function clockToDeg(clock: string): number {
  const [h = 12, m = 0] = clock.split(':').map(Number);
  return ((h % 12) + m / 60) * 30 - 90;
}
const proximity = (deg: number): number => (1 - Math.sin((deg * Math.PI) / 180)) / 2;
const NEAR_THRESHOLD = 75;
function isNearClock(clock: string): boolean {
  return Math.round(proximity(clockToDeg(clock)) * 100) >= NEAR_THRESHOLD;
}
/** Exposed so the page can render the same 0–100 NEAR percentage without re-deriving it. */
export function clockProximityPct(clock: string): number {
  return Math.round(proximity(clockToDeg(clock)) * 100);
}

/* -------------------------------------------------------------
   SANITIZING — every value a visitor could have typed, or forged into a
   share link, is clamped into range rather than trusted.
   ------------------------------------------------------------- */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  // Strip C0/DEL control characters (including newlines) — labels are single-line.
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

/** Best-effort "H:MM" (H 1–12) from anything a visitor could type or forge
    into a link. Exported as `normalizeClock` for the page's live preview
    (e.g. while a clock field is mid-edit) to reuse the same rule. */
function cleanClock(value: unknown): string {
  const m = typeof value === 'string' ? /^\s*(\d{1,2}):(\d{1,2})\s*$/.exec(value) : null;
  if (!m) return '12:00';
  const rawH = Math.trunc(Number(m[1]));
  const rawM = Math.trunc(Number(m[2]));
  if (!Number.isFinite(rawH) || !Number.isFinite(rawM)) return '12:00';
  const h = ((rawH % 12) + 12) % 12 || 12; // 0 and 12 both mean 12 o'clock
  const min = Math.min(59, Math.max(0, rawM));
  return `${h}:${String(min).padStart(2, '0')}`;
}
export const normalizeClock = cleanClock;

function cleanCapacity(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CAPACITY;
  return Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, Math.round(n)));
}

function cleanOrbit(value: unknown, fallbackIndex: number): KitOrbit {
  const o = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const name = cleanText(o.name, MAX_NAME_LEN) || `ORBIT ${fallbackIndex + 1}`;
  return { name, clock: cleanClock(o.clock) };
}

/**
 * Validate and clamp a parsed fragment payload into a usable state, or
 * `null` when the shape is too broken to salvage (not an object, wrong
 * version, `orbits` not an array, or zero orbits survive cleaning) — the
 * caller falls back to `defaultState()` in that case.
 */
export function sanitizeState(parsed: unknown): KitState | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  if (p.version !== KIT_VERSION) return null;
  if (!Array.isArray(p.orbits)) return null;

  const orbits = p.orbits.slice(0, MAX_ORBITS).map((o, i) => cleanOrbit(o, i));
  if (orbits.length < MIN_ORBITS) return null;

  const constants = (Array.isArray(p.constants) ? p.constants : [])
    .map((c) => cleanText(c, MAX_CONSTANT_LEN))
    .filter(Boolean)
    .slice(0, MAX_CONSTANTS);

  return { version: KIT_VERSION, orbits, constants, capacity: cleanCapacity(p.capacity) };
}

/**
 * Build a state from arbitrary orbit/constant lists (a preset — "start from
 * this station" or a hand-built one) through the same clamping `decodeState`
 * applies to a forged link, so a preset can never smuggle in something the
 * fragment format wouldn't otherwise allow.
 */
export function buildState(
  orbits: readonly { name: string; clock: string }[],
  constants: readonly string[],
  capacity: number,
): KitState {
  return sanitizeState({ version: KIT_VERSION, orbits: [...orbits], constants: [...constants], capacity })!;
}

/** The safe fallback: a handful of generic placeholder orbits ("start blank"),
    also used whenever a share link can't be read at all. */
export function defaultState(): KitState {
  return {
    version: KIT_VERSION,
    orbits: [
      { name: 'ALPHA', clock: '12:00' },
      { name: 'BETA', clock: '3:00' },
      { name: 'GAMMA', clock: '6:00' },
      { name: 'DELTA', clock: '9:00' },
    ],
    constants: ['FOCUS', 'ENERGY', 'TIME'],
    capacity: DEFAULT_CAPACITY,
  };
}

/* -------------------------------------------------------------
   BASE64URL — btoa/atob work on binary strings, so UTF-8 bytes are shuttled
   through String.fromCharCode/charCodeAt rather than passed straight in;
   that's what lets non-ASCII names survive the round trip.
   ------------------------------------------------------------- */
function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array | null {
  try {
    const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=');
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** State → the fragment payload (without the leading `#`), e.g. `k1.eyJ2...`. */
export function encodeState(state: KitState): string {
  const clean = sanitizeState(state) ?? defaultState();
  const json = JSON.stringify(clean);
  return FRAGMENT_PREFIX + bytesToBase64Url(new TextEncoder().encode(json));
}

/** The fragment (with or without a leading `#`) → a usable state. Never throws. */
export function decodeState(fragment: string | null | undefined): DecodeResult {
  const raw = (fragment ?? '').replace(/^#/, '');
  if (!raw) return { state: defaultState(), ok: true, empty: true };
  if (!raw.startsWith(FRAGMENT_PREFIX)) return { state: defaultState(), ok: false, empty: false };

  const bytes = base64UrlToBytes(raw.slice(FRAGMENT_PREFIX.length));
  if (!bytes) return { state: defaultState(), ok: false, empty: false };

  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { state: defaultState(), ok: false, empty: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { state: defaultState(), ok: false, empty: false };
  }

  const state = sanitizeState(parsed);
  if (!state) return { state: defaultState(), ok: false, empty: false };
  return { state, ok: true, empty: false };
}

/* -------------------------------------------------------------
   LAMPS — pure, from the Manual's §5.0 failure modes.
   ------------------------------------------------------------- */
export interface Lamps {
  /** How many orbits are currently NEAR. */
  near: number;
  /** How many constants are currently set (non-empty). */
  constantsSet: number;
  capacity: number;
  /** One domain has dragged the others off their tracks. */
  collision: boolean;
  /** The center has lost mass: nothing is NEAR, or too few constants hold it. */
  drift: boolean;
}

export function lamps(state: KitState): Lamps {
  const near = state.orbits.filter((o) => isNearClock(o.clock)).length;
  const constantsSet = state.constants.filter((c) => c.trim().length > 0).length;
  return {
    near,
    constantsSet,
    capacity: state.capacity,
    collision: near > state.capacity,
    drift: near === 0 || constantsSet < 3,
  };
}
