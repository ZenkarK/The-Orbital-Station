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
    'The personal station of Zenkar — systems engineer in medical imaging, astrophysicist by training. Essays, build logs and field notes from twelve orbits.',
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
   THE ORBITS
   Order is ring order, innermost first: the foundations everything
   else rests on run closest to the center of mass; the outward-
   facing work runs farthest out. Reorder entries to move rings.

   `clock` is where each body currently sits on its orbit, read
   like a clock face: 12:00 is NEAR (what this season is actually
   for), 6:00 is FAR (coasting on maintenance energy). Update
   these whenever the season changes, then redeploy.

   `folders` are the Obsidian vault folders (and their subfolders)
   whose notes land in this orbit by default when published. The
   deepest match wins, so Finance/Ventures beats Finance.

   `visibility` is how much of an orbit the site shows:
     'public'     — everything filed there is listed (the usual case).
     'phase-only' — the body and its phase show on the orrery and the
                    orbit's page, but nothing filed there is built,
                    listed, searched, fed or mapped.
     'hidden'     — the orbit doesn't appear anywhere, and nothing
                    filed there is built.
   The publisher asks for a deliberate yes before sending a note to a
   phase-only or hidden orbit: the file still lands in the public repo.
   ------------------------------------------------------------- */
export const PHASE_LOGGED = '2026-09-26';

/**
 * How many orbits can honestly run NEAR at once. The Manual's rule is
 * "only one or two run close at a time"; past this ceiling the build
 * warns and the Bridge says so.
 */
export const NEAR_CAPACITY = 3;

/**
 * SENSITIVE FOLDERS — vault folders (and everything below them) that hold
 * private material by nature. Publishing a note from one needs a deliberate
 * yes: the box in the Transmit dialog, or --confirm-sensitive on the CLI.
 */
export const SENSITIVE_FOLDERS = ['Work', 'Finance', 'Health', 'Family and Friends'];

export const ORBITS = [
  {
    id: 'body',
    name: 'BODY',
    color: '#D45666',
    clock: '11:00',
    folders: ['Health'],
    visibility: 'phase-only',
    desc: 'The vessel everything else rides in — training, movement, sleep, and the maintenance that keeps the rest possible.',
  },
  {
    id: 'kin',
    name: 'KIN',
    color: '#EA91BC',
    clock: '12:15',
    folders: ['Family and Friends'],
    visibility: 'phase-only',
    desc: 'Family and friends — the relationships that never show up in a log but hold the whole system together.',
  },
  {
    id: 'mind',
    name: 'MIND',
    color: '#0F9293',
    clock: '3:20',
    folders: ['Philosophy'],
    visibility: 'public',
    desc: "Philosophy as practice — meaning, mortality, free will, and the questions that don't resolve but do clarify.",
  },
  {
    id: 'growth',
    name: 'GROWTH',
    color: '#7CA53D',
    clock: '10:30',
    folders: ['Personal Development', 'Productivity and Efficiency'],
    visibility: 'public',
    desc: 'Getting better on purpose — habits, focus, and the systems behind the systems.',
  },
  {
    id: 'language',
    name: 'LANGUAGE',
    color: '#B559A3',
    clock: '8:20',
    folders: ['Learning and Languages'],
    visibility: 'public',
    desc: 'Learning for its own sake — new languages, new grammars, new ways of carving up the world.',
  },
  {
    id: 'astro',
    name: 'ASTRO',
    color: '#9D8FD0',
    clock: '7:00',
    folders: ['Astrophysics'],
    visibility: 'public',
    desc: 'First love. Astrophysics, dark skies, and the long view that keeps the rest in scale.',
  },
  {
    id: 'craft',
    name: 'CRAFT',
    color: '#C97F5F',
    clock: '4:10',
    folders: ['Cooking', 'Photography'],
    visibility: 'public',
    desc: 'Hands and senses — cooking, photography, and the pursuits chosen purely for aliveness.',
  },
  {
    id: 'voyage',
    name: 'VOYAGE',
    color: '#37D2F2',
    clock: '1:30',
    folders: ['Travel'],
    visibility: 'public',
    desc: 'Travel and the bucket list — going somewhere unfamiliar to recalibrate what normal is.',
  },
  {
    id: 'words',
    name: 'WORDS',
    color: '#8FAE8B',
    clock: '11:50',
    folders: ['Writing'],
    visibility: 'public',
    desc: 'Transmissions, essays, and a science-fantasy series in the making. Thinking, made durable.',
  },
  {
    id: 'systems',
    name: 'SYSTEMS',
    color: '#4BACD9',
    clock: '12:40',
    folders: ['Work', 'Aerospace Engineering', 'Technology'],
    visibility: 'public',
    desc: 'Engineering as a way of seeing — architecture, instrumentation, and the discipline of making complex things reliable.',
  },
  {
    id: 'markets',
    name: 'MARKETS',
    color: '#C9A24B',
    clock: '2:30',
    folders: ['Finance'],
    visibility: 'public',
    desc: 'Capital as stored energy. Trading systems, long-horizon investing, and the honest study of risk.',
  },
  {
    id: 'venture',
    name: 'VENTURE',
    color: '#F96328',
    clock: '9:40',
    folders: ['Finance/Ventures'],
    visibility: 'public',
    desc: 'Things built to leave the pad — products, experiments, small deliberate bets.',
  },
] as const;

export type OrbitVisibility = 'public' | 'phase-only' | 'hidden';
// A typo in any orbit's `visibility` fails the type check here.
ORBITS satisfies readonly { visibility: OrbitVisibility }[];

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
