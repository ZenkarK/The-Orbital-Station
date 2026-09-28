/* MODEL-03 — Phase capacity build warning.
   A tiny Astro integration: at astro:build:start, warn if more orbits are
   running NEAR (proximity >= 75%, src/lib/orrery-layout.ts) than the
   station's stated capacity (NEAR_CAPACITY, src/site.config.ts). Counts
   every orbit, hidden included — a hidden orbit's clock still runs, it just
   doesn't show anywhere on the built site. See BACKLOG MODEL-03 and PRD §13 Q2. */
import { ORBITS, NEAR_CAPACITY } from '../site.config';
import { nearOrbits } from './orrery-layout';

export function nearCapacityIntegration() {
  return {
    name: 'near-capacity-warning',
    hooks: {
      'astro:build:start': ({ logger }) => {
        const near = nearOrbits(ORBITS);
        if (near.length <= NEAR_CAPACITY) return;
        const names = near.map((o) => o.name).join(', ');
        logger.warn(
          `${near.length} orbits are running NEAR (${names}) — over the Manual's capacity of ` +
            `${NEAR_CAPACITY}. Move some to MID-ORBIT at the next phase log (src/site.config.ts).`,
        );
      },
    },
  };
}
