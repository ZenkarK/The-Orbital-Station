import { ORBITS, type Orbit, type OrbitId } from '../site.config';
import { ringRadius } from './orrery-layout';

export const orbitById = (id: string): Orbit => ORBITS.find((o) => o.id === id) ?? ORBITS[0];

/** Ring radius on the 640-unit orrery: first orbit in ORBITS is the innermost ring. */
export const orbitRadius = (o: Orbit): number => ringRadius(ORBITS.findIndex((x) => x.id === o.id), ORBITS.length);

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
/** How many orbits there are, in words ("twelve") — so copy never goes stale when one is added. */
export const orbitCountWord = NUMBER_WORDS[ORBITS.length] ?? String(ORBITS.length);
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "12:40" → SVG angle in degrees (0° = 3 o'clock, -90° = 12 o'clock). */
export function clockToDeg(clock: string): number {
  const [h = 12, m = 0] = clock.split(':').map(Number);
  return ((h % 12) + m / 60) * 30 - 90;
}

/** 12 o'clock = 1 (NEAR), 6 o'clock = 0 (FAR). */
export const proximity = (deg: number): number => (1 - Math.sin((deg * Math.PI) / 180)) / 2;

export const orbitProximity = (o: Orbit): number => proximity(clockToDeg(o.clock));

/** Orbits sorted nearest-first, with their proximity as a 0–100 integer. */
export function rankedOrbits() {
  return ORBITS.map((o) => ({ orbit: o, pct: Math.round(orbitProximity(o) * 100) })).sort(
    (a, b) => b.pct - a.pct,
  );
}

export function phaseLabel(pct: number): string {
  if (pct >= 75) return 'NEAR';
  if (pct >= 40) return 'MID-ORBIT';
  return 'FAR';
}

export type { Orbit, OrbitId };
