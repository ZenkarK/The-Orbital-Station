/* READ-02 — build-time social card generator.

   Renders a 1200×630 PNG per transmission, mission and orbit: Satori (MPL-2.0) lays
   an element tree out to SVG using the station's own fonts, then sharp rasterises and
   palette-quantises it, so every card stays small (well under the 100 KB budget) and
   looks like the rest of the site — dark ground, an orbit's colour as its one strong
   accent, a mono caps meta line, an Archivo title. No grain: that's fine as page
   texture but it's pure noise to a PNG encoder, and it only bloats the file.
   Deterministic — same input, same bytes, every build.

   Card *content* always comes through the same getters/exports the pages themselves
   use (getPosts()/getProjects() in src/lib/content.ts, displayedOrbits in
   src/lib/visibility.ts) — wired in src/pages/og/[...card].png.ts — so a card can
   never show anything its own page wouldn't (MODEL-07). An orbit card only ever
   draws on its orbit's config-level name/colour/description and phase, which the
   orbit page shows regardless of visibility — never a count or a title of anything
   filed there. */
import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import sharp from 'sharp';
import { SITE, POST_KINDS } from '../site.config';
import type { Post, Project } from './content';
import { orbitById, phaseLabel, orbitProximity, type Orbit } from './orbits';
import { stationDate } from './util';
import { fitTitleFontSize, TITLE_MAX_LINES } from './og-title-fit';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
const PAD_X = 72;
const PAD_Y = 56;
const ACCENT_H = 10;
const TITLE_BOX_WIDTH = CARD_WIDTH - PAD_X * 2;

const BG = '#23262d'; // --bg
const FG = '#e9e5da'; // --fg
const DIM = 'rgba(233, 229, 218, 0.68)'; // --dim

export interface CardData {
  /** Mono caps meta line, e.g. "TRANSMISSION · ESSAY · ORBIT ASTRO · 2026.09.20". */
  meta: string;
  /** Big Archivo headline. */
  title: string;
  /** Orbit colour — the card's one strong accent. */
  color: string;
}

/** A transmission's card: kind + orbit + date, reusing the same labels the page shows. */
export function transmissionCard(post: Post): CardData {
  const { title, date, kind, orbit } = post.data;
  const o = orbitById(orbit);
  return {
    meta: `TRANSMISSION · ${POST_KINDS[kind]} · ORBIT ${o.name} · ${stationDate(date)}`,
    title,
    color: o.color,
  };
}

/** A mission's card: status + orbit + launch date, when there is one. */
export function missionCard(project: Project): CardData {
  const { title, status, orbit, started } = project.data;
  const o = orbitById(orbit);
  const dateBit = started ? ` · ${stationDate(started)}` : '';
  return {
    meta: `MISSION · ${status} · ORBIT ${o.name}${dateBit}`,
    title,
    color: o.color,
  };
}

/** An orbit's card: name, colour and phase only — the same things a phase-only
    orbit's own page shows, never a count or a title of what's filed there. */
export function orbitCard(o: Orbit): CardData {
  const pct = Math.round(orbitProximity(o) * 100);
  return {
    meta: `ORBIT · ${o.name} · ${pct}% ${phaseLabel(pct)}`,
    title: o.desc,
    color: o.color,
  };
}

/* ---------------------------------------------------------------------
   Rendering. Fonts are read from disk once per build (`npm run build` and each
   throwaway test build both invoke this module fresh) and reused for every card.
   --------------------------------------------------------------------- */

interface SatoriFont {
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: 'normal';
}

let fontsCache: SatoriFont[] | null = null;

/** Satori needs TTF/OTF/WOFF — not WOFF2 — so these come from @fontsource's plain
    .woff files, read straight from node_modules rather than imported as assets. */
function loadFonts(): SatoriFont[] {
  if (fontsCache) return fontsCache;
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'node_modules', rel));
  fontsCache = [
    { name: 'Archivo', data: read('@fontsource/archivo/files/archivo-latin-700-normal.woff'), weight: 700, style: 'normal' },
    { name: 'Archivo', data: read('@fontsource/archivo/files/archivo-latin-400-normal.woff'), weight: 400, style: 'normal' },
    { name: 'Space Mono', data: read('@fontsource/space-mono/files/space-mono-latin-700-normal.woff'), weight: 700, style: 'normal' },
    { name: 'Space Mono', data: read('@fontsource/space-mono/files/space-mono-latin-400-normal.woff'), weight: 400, style: 'normal' },
  ];
  return fontsCache;
}

type Style = Record<string, string | number>;
/** Plain `{ type, props }` element objects — satori's "use without JSX" form, so this
    module has no React/JSX dependency. */
const el = (type: string, style: Style, children?: unknown) => ({ type, props: { style, children } });

function cardTree(data: CardData) {
  const fontSize = fitTitleFontSize(data.title, TITLE_BOX_WIDTH);
  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      backgroundColor: BG,
      fontFamily: 'Space Mono',
    },
    [
      // The orbit's colour, as a strong accent along the top edge.
      el('div', { display: 'flex', width: '100%', height: ACCENT_H, backgroundColor: data.color }),
      el(
        'div',
        {
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          justifyContent: 'space-between',
          padding: `${PAD_Y}px ${PAD_X}px`,
        },
        [
          // Meta line.
          el('div', { display: 'flex', alignItems: 'center' }, [
            el('div', { display: 'flex', width: 14, height: 14, marginRight: 16, backgroundColor: data.color }),
            el(
              'div',
              {
                display: 'flex',
                fontFamily: 'Space Mono',
                fontWeight: 700,
                fontSize: 22,
                letterSpacing: '0.12em',
                color: DIM,
              },
              data.meta,
            ),
          ]),
          // Title — stepped down by fitTitleFontSize, then satori's own line-clamp
          // ellipsizes anything that still overflows TITLE_MAX_LINES.
          el(
            'div',
            {
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: TITLE_MAX_LINES,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              width: '100%',
              fontFamily: 'Archivo',
              fontWeight: 700,
              fontSize,
              lineHeight: 1.1,
              letterSpacing: '-0.01em',
              color: FG,
            },
            data.title,
          ),
          // Foot: station name + author.
          el(
            'div',
            {
              display: 'flex',
              alignItems: 'center',
              fontFamily: 'Space Mono',
              fontSize: 20,
              letterSpacing: '0.14em',
              color: DIM,
            },
            [
              el('div', { display: 'flex', fontWeight: 700, color: FG, marginRight: 10 }, SITE.name.toUpperCase()),
              el('div', { display: 'flex' }, `— ${SITE.author.toUpperCase()}`),
            ],
          ),
        ],
      ),
    ],
  );
}

/** Renders one card to a palette-quantised PNG buffer — 1200×630, well under 100 KB. */
export async function renderCard(data: CardData): Promise<Buffer> {
  const svg = await satori(cardTree(data), { width: CARD_WIDTH, height: CARD_HEIGHT, fonts: loadFonts() });
  return sharp(Buffer.from(svg)).png({ palette: true, compressionLevel: 9, effort: 10 }).toBuffer();
}
