/* Orrery geometry shared by the build (the static SVG) and the browser (dragging).
   No imports on purpose: the Node test runner loads this file directly. */

export const RING_INNER = 64;
export const RING_OUTER = 272;

/** Radius of ring `index` (0 = innermost) when `count` rings share the canvas. */
export function ringRadius(index: number, count: number, inner = RING_INNER, outer = RING_OUTER): number {
  return count > 1 ? inner + ((outer - inner) * index) / (count - 1) : inner;
}

/* -------------------------------------------------------------
   PHASE / PROXIMITY (MODEL-03)
   The clock-to-NEAR math lives here rather than in src/lib/orbits.ts so it
   stays import-free: Node's type-stripping can't resolve orbits.ts's
   extensionless `from '../site.config'`, but astro.config.mjs (and its own
   test) can load this file directly, the same way the test above does.
   ------------------------------------------------------------- */

/** "12:40" → SVG angle in degrees (0° = 3 o'clock, -90° = 12 o'clock). */
export function clockToDeg(clock: string): number {
  const [h = 12, m = 0] = clock.split(':').map(Number);
  return ((h % 12) + m / 60) * 30 - 90;
}

/** 12 o'clock = 1 (NEAR), 6 o'clock = 0 (FAR). */
export const proximity = (deg: number): number => (1 - Math.sin((deg * Math.PI) / 180)) / 2;

/** A clock position as the 0–100 NEAR percentage shown across the site. */
export function clockProximityPct(clock: string): number {
  return Math.round(proximity(clockToDeg(clock)) * 100);
}

/** 75% or higher reads as NEAR (see `phaseLabel` in src/lib/orbits.ts). */
export const NEAR_THRESHOLD = 75;

/** Whether a clock position currently counts as running NEAR. */
export function isNearClock(clock: string): boolean {
  return clockProximityPct(clock) >= NEAR_THRESHOLD;
}

/**
 * Which of the given orbits (any objects with a `clock`) are running NEAR
 * right now. Callers decide which orbits to pass in — the build warning
 * counts every orbit including hidden ones, the Bridge counts only the
 * displayed ones.
 */
export function nearOrbits<T extends { clock: string }>(orbits: readonly T[]): T[] {
  return orbits.filter((o) => isNearClock(o.clock));
}

export interface LabelBody {
  id: string;
  /** Body center. */
  x: number;
  y: number;
  /** Label width. */
  w: number;
}
export interface LabelPlacement {
  id: string;
  /** Label center (draw it with text-anchor="middle"). */
  x: number;
  y: number;
}
export interface LabelLayout {
  /** Orrery center and canvas size. */
  cx: number;
  cy: number;
  size: number;
  /** Label height (the font size) and body radius. */
  h: number;
  bodyR: number;
  /** Space between a body and its label. */
  gap: number;
}

type Box = { x0: number; y0: number; x1: number; y1: number };

const PAD = 2; // breathing room kept around each new label
const CENTER_MARK = 12;
const area = (b: Box) => (b.x1 - b.x0) * (b.y1 - b.y0);
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const round = (v: number) => Math.round(v * 100) / 100;

/**
 * Greedy label placement. Bodies are served in the order given — put the ones that
 * matter most first. Each takes the first spot around it that covers no body, no
 * earlier label and nothing outside the canvas: outside, then diagonally outside,
 * beside it along its ring, inside, then further out. If every spot is blocked,
 * the least-covered one wins.
 */
export function placeLabels(bodies: LabelBody[], o: LabelLayout): LabelPlacement[] {
  const obstacles: Box[] = bodies.map((b) => ({ x0: b.x - o.bodyR, y0: b.y - o.bodyR, x1: b.x + o.bodyR, y1: b.y + o.bodyR }));
  obstacles.push({ x0: o.cx - CENTER_MARK, y0: o.cy - CENTER_MARK, x1: o.cx + CENTER_MARK, y1: o.cy + CENTER_MARK });
  const canvas: Box = { x0: 0, y0: 0, x1: o.size, y1: o.size };

  return bodies.map((b) => {
    const len = Math.hypot(b.x - o.cx, b.y - o.cy);
    const [ux, uy] = len ? [(b.x - o.cx) / len, (b.y - o.cy) / len] : [0, -1];
    const [tx, ty] = [-uy, ux];
    const candidates: [number, number, number][] = [
      [ux, uy, 0],
      [ux + tx, uy + ty, 0],
      [ux - tx, uy - ty, 0],
      [tx, ty, 0],
      [-tx, -ty, 0],
      [-ux, -uy, 0],
      [ux, uy, o.h * 1.5],
    ];

    let best: { x: number; y: number; box: Box; cost: number } | null = null;
    for (const [dx, dy, extra] of candidates) {
      const n = Math.hypot(dx, dy);
      const [vx, vy] = [dx / n, dy / n];
      // Push the label out until its nearest edge clears the body by `gap`.
      const dist = o.bodyR + o.gap + extra + (Math.abs(vx) * b.w) / 2 + (Math.abs(vy) * o.h) / 2;
      const x = round(b.x + vx * dist);
      const y = round(b.y + vy * dist);
      const box = { x0: x - b.w / 2, y0: y - o.h / 2, x1: x + b.w / 2, y1: y + o.h / 2 };
      const padded = { x0: box.x0 - PAD, y0: box.y0 - PAD, x1: box.x1 + PAD, y1: box.y1 + PAD };
      const cost =
        obstacles.reduce((s, ob) => s + overlap(padded, ob), 0) + area(box) - overlap(box, canvas);
      if (!best || cost < best.cost) best = { x, y, box, cost };
      if (cost === 0) break;
    }
    obstacles.push(best!.box);
    return { id: b.id, x: best!.x, y: best!.y };
  });
}
