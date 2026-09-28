import { ORBITS, NEAR_CAPACITY, type Orbit, type OrbitId } from '../site.config';
import { ringRadius, clockToDeg, proximity, nearOrbits } from './orrery-layout';
import { displayedOrbits } from './visibility';

export const orbitById = (id: string): Orbit => ORBITS.find((o) => o.id === id) ?? ORBITS[0];

/** Ring radius on the 640-unit orrery, over the *displayed* orbits only: a hidden
    orbit has no ring, and the remaining rings are recomputed to fill the space. */
export const orbitRadius = (o: Orbit): number =>
  ringRadius(displayedOrbits.findIndex((x) => x.id === o.id), displayedOrbits.length);

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
/** How many orbits are shown, in words ("twelve") — a hidden orbit doesn't count. */
export const orbitCountWord = NUMBER_WORDS[displayedOrbits.length] ?? String(displayedOrbits.length);
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* clockToDeg and proximity (the clock-to-NEAR math) live in orrery-layout.ts,
   an import-free module astro.config.mjs and its test can load directly.
   Re-exported here so every existing caller keeps importing from '../lib/orbits'. */
export { clockToDeg, proximity };

export const orbitProximity = (o: Orbit): number => proximity(clockToDeg(o.clock));

/** Displayed orbits sorted nearest-first, with their proximity as a 0–100 integer. */
export function rankedOrbits() {
  return displayedOrbits.map((o) => ({ orbit: o, pct: Math.round(orbitProximity(o) * 100) })).sort(
    (a, b) => b.pct - a.pct,
  );
}

export function phaseLabel(pct: number): string {
  if (pct >= 75) return 'NEAR';
  if (pct >= 40) return 'MID-ORBIT';
  return 'FAR';
}

/**
 * MODEL-03 — the Manual's "only one or two run close at a time", checked.
 * How many *displayed* orbits (hidden ones don't show, so they don't count
 * here — the astro.config.mjs build warning counts every orbit instead) are
 * currently running NEAR, against the station's stated ceiling.
 */
export function nearCapacityStatus(): { near: number; capacity: number; over: boolean } {
  const near = nearOrbits(displayedOrbits).length;
  return { near, capacity: NEAR_CAPACITY, over: near > NEAR_CAPACITY };
}

export type { Orbit, OrbitId };
