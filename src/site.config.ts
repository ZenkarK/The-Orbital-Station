/* =============================================================
   ORBITAL STATION — station configuration
   Everything about *who* runs the site lives here. Content
   (posts, projects, library, trajectories) lives in src/content.
   ============================================================= */

export const SITE = {
  name: 'Orbital Station',
  author: 'Zenkar',
  /** Shown in <title> and social cards. */
  title: 'Orbital Station — Zenkar',
  description:
    'The personal station of Zenkar — systems engineer in medical imaging, astrophysicist by training. Essays, build logs and field notes from six orbits.',
  /** Little document code in the header. Bump the revision when you redesign. */
  docId: 'ZK-26-R5',
  latitude: '43°N',
  locale: 'en-US',
  /** The values at the center of mass (Bridge + Manual). */
  constants: ['CURIOSITY', 'DISCOVERY', 'FREEDOM', 'DISCIPLINE', 'GROWTH'],

  /*
   * CHANNELS — fill these in. Empty values are simply not shown,
   * so nothing broken ever reaches visitors.
   *   email:    'you@domain.com'
   *   github:   'https://github.com/<you>'
   *   linkedin: 'https://www.linkedin.com/in/<you>'
   *   mastodon: 'https://<instance>/@<you>'
   *   bluesky:  'https://bsky.app/profile/<you>'
   *   x:        'https://x.com/<you>'
   */
  channels: {
    email: '',
    github: '',
    linkedin: '',
    mastodon: '',
    bluesky: '',
    x: '',
  },
} as const;

/* -------------------------------------------------------------
   THE SIX ORBITS
   `clock` is where each body currently sits on its orbit, read
   like a clock face: 12:00 is NEAR (what this season is actually
   for), 6:00 is FAR (coasting on maintenance energy). Update
   these whenever the season changes, then redeploy.
   ------------------------------------------------------------- */
export const PHASE_LOGGED = '2026-09-26';

export const ORBITS = [
  {
    id: 'systems',
    name: 'SYSTEMS',
    color: '#7FA6C9',
    r: 95,
    clock: '12:40',
    desc: 'Engineering as a way of seeing — architecture, instrumentation, and the discipline of making complex things reliable.',
  },
  {
    id: 'markets',
    name: 'MARKETS',
    color: '#C9A24B',
    r: 130,
    clock: '2:30',
    desc: 'Capital as stored energy. Trading systems, long-horizon investing, and the honest study of risk.',
  },
  {
    id: 'craft',
    name: 'CRAFT',
    color: '#C97F5F',
    r: 165,
    clock: '4:10',
    desc: 'Hands and senses — cooking, photography, and the pursuits chosen purely for aliveness.',
  },
  {
    id: 'astro',
    name: 'ASTRO',
    color: '#9D8FD0',
    r: 200,
    clock: '7:00',
    desc: 'First love. Astrophysics, dark skies, and the long view that keeps the rest in scale.',
  },
  {
    id: 'venture',
    name: 'VENTURE',
    color: '#D97A45',
    r: 235,
    clock: '9:40',
    desc: 'Things built to leave the pad — products, experiments, small deliberate bets.',
  },
  {
    id: 'words',
    name: 'WORDS',
    color: '#8FAE8B',
    r: 270,
    clock: '11:50',
    desc: 'Transmissions and essays. Thinking, made durable.',
  },
] as const;

export type Orbit = (typeof ORBITS)[number];
export type OrbitId = Orbit['id'];
export const ORBIT_IDS = ORBITS.map((o) => o.id) as [OrbitId, ...OrbitId[]];

/* -------------------------------------------------------------
   VOCABULARY — the controlled lists used by content frontmatter.
   ------------------------------------------------------------- */
export const POST_KINDS = {
  essay: 'ESSAY',
  'build-log': 'BUILD LOG',
  'field-note': 'FIELD NOTE',
} as const;
export type PostKind = keyof typeof POST_KINDS;

export const PROJECT_STATUSES = ['PLANNED', 'ACTIVE', 'COMPLETE', 'SCRUBBED'] as const;
export const LIBRARY_TYPES = ['BOOK', 'PAPER', 'ESSAY', 'TOOL', 'FILM', 'COURSE', 'OTHER'] as const;
export const LIBRARY_SHELVES = ['READING', 'QUEUE', 'ABSORBED', 'REFERENCE'] as const;
export const HORIZONS = ['NOW', 'THIS YEAR', 'SOMEDAY'] as const;
