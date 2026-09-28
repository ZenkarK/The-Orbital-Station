/* MODEL-07 — Orbit visibility levels.
   The one chokepoint that decides what an orbit's `visibility` means for the
   built site. Everything else (content.ts's filters, the orrery, the orbit
   pages, the Manual) reads these exports instead of deciding for itself.
   See PRD §10.2 item 6 and BACKLOG MODEL-07. */
import { ORBITS, type Orbit, type OrbitId, type OrbitVisibility } from '../site.config';

/**
 * An orbit's visibility as the full union. Compare through this, never `o.visibility`
 * directly: ORBITS is `as const`, so when no orbit is (say) hidden, TypeScript narrows the
 * field and rejects `=== 'hidden'` as a comparison that can never be true.
 */
export const visibilityOf = (o: Orbit): OrbitVisibility => o.visibility;

const byId = new Map(ORBITS.map((o) => [o.id as string, o]));

/**
 * Orbits that appear anywhere on the site at all, in ring order (innermost
 * first). A `hidden` orbit has no ring, no orbit page, no filter chip, no
 * legend entry and no Manual row — it's as if it doesn't exist. `phase-only`
 * orbits stay in this list: their body and phase still show.
 */
export const displayedOrbits: Orbit[] = ORBITS.filter((o) => visibilityOf(o) !== 'hidden');

/**
 * Whether content filed under this orbit is built as a page, listed, counted,
 * searched, fed, tagged or linked. Only `public` orbits qualify — `phase-only`
 * shows its body and phase but nothing filed there, and `hidden` shows nothing
 * at all. This is the single predicate every listing (getPosts, getProjects,
 * getLibrary, getTrajectories, search.json, rss.xml, sitemap) filters through.
 */
export function isListed(orbitId: string): boolean {
  const o = byId.get(orbitId);
  return !!o && visibilityOf(o) === 'public';
}

/** True once an id names an orbit whose ring, page and every other trace are suppressed. */
export function isOrbitHidden(orbitId: string): boolean {
  const o = byId.get(orbitId);
  return !!o && visibilityOf(o) === 'hidden';
}

export type { Orbit, OrbitId };
