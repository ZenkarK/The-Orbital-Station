#!/usr/bin/env node
/* =============================================================
   Site-wide fallback social card (READ-02) — `npm run og`

   public/og.png is the og:image every page falls back to when it has no
   card of its own — src/pages/og/[...card].png.ts (via src/lib/og-card.ts)
   only covers transmissions, missions and orbits. Unlike those, this one
   isn't rendered at build time, so nothing kept it honest as the Orbital
   Model grew: it can only go stale by hand and come back to life by hand.
   This script renders it the same way (Satori lays out SVG, sharp
   rasterises), reading the orbit count, colours and clock positions
   straight from site.config.ts, so growing or shrinking the Model and
   rerunning `npm run og` is all it takes. Deterministic — same config,
   same pixels (the PNG's own bytes can still vary a little by machine, since
   the encoder's deflate path depends on the CPU, so the test compares decoded
   pixels rather than the file).

   Layout mirrors the site's own hand-made card, not just its data: a dark
   ground with an inset framed panel (thin border, corner brackets, a hard
   drop shadow, in the same language as the station's other chrome — see
   Header.astro's who/doc line and .btn.primary's solid-accent chip); a
   header row with the author, the station name and a LIVE chip; a huge
   two-part hero — the orbit count solid, "One center / of mass." as
   outline-only glyphs (WebkitTextStroke, the same trick as .hero-title
   .ghost in global.css); a mono-caps footer built from POST_KINDS, so it
   can't say something the site doesn't actually publish; and an orrery on
   the right — concentric dotted rings (one per displayed orbit, its own
   colour, reusing clockToDeg/ringRadius from src/lib/orrery-layout.ts) with
   a crosshair centre and one body per orbit at its live clock position.

   Writes public/og.png (committed); tests/site/social-cards.test.mjs
   checks it's current.
   ============================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import satori from 'satori';
import sharp from 'sharp';
import { estimateLines } from '../src/lib/og-title-fit.ts';
import { clockToDeg, ringRadius } from '../src/lib/orrery-layout.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_FILE = path.join(ROOT, 'public', 'og.png');

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const BEZEL = 26; // dark margin between the card edge and the framed panel
const PANEL_PAD_X = 48;
const PANEL_PAD_Y = 32;
const CORNER_SIZE = 22;
const CORNER_THICK = 2;
const CORNER_INSET = 12;
const HERO_WIDTH = 610;
const ORRERY_SIZE = 400;
const RING_INNER = 26;
const RING_OUTER = 172;
const BODY_R = 7;

const BG = '#23262d'; // --bg
const FG = '#e9e5da'; // --fg
const DIM = 'rgba(233, 229, 218, 0.68)'; // --dim
const LINE = 'rgba(233, 229, 218, 0.16)'; // --line
const BORDER = 'rgba(233, 229, 218, 0.55)';
const SHADOW = 'rgba(0, 0, 0, 0.75)';
const ACCENT = '#dfa340'; // --accent

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * SITE, ORBITS and POST_KINDS, straight from site.config.ts. That file has no
 * relative imports of its own, so plain Node can load it directly (the same
 * trick scripts/obsidian/site.mjs's loadSiteConfig uses) — unlike
 * src/lib/orbits.ts or src/lib/visibility.ts, which this script can't import
 * standalone (their extensionless `from '../site.config'` only resolves
 * inside Astro/Vite). displayedOrbits' real filter lives in visibility.ts;
 * this mirrors it — a `hidden` orbit draws no ring/body and doesn't count in
 * the hero's number either. Order is preserved (ring order, innermost first —
 * see site.config.ts's own comment on ORBITS).
 */
async function loadConfig() {
  const { SITE, ORBITS, POST_KINDS } = await import(pathToFileURL(path.join(ROOT, 'src/site.config.ts')).href);
  const displayed = ORBITS.filter((o) => o.visibility !== 'hidden');
  return { SITE, displayed, POST_KINDS };
}

/** Satori needs TTF/OTF/WOFF — not WOFF2 — so these come from @fontsource's plain
    .woff files, read straight from node_modules, same as src/lib/og-card.ts.
    Archivo's static build has no width axis (unlike the variable font the site
    itself uses for its wide-set display headline), so the hero borrows weight
    instead: 900 reads heavy and wide enough without it. */
function loadFonts() {
  const read = (rel) => fs.readFileSync(path.join(ROOT, 'node_modules', rel));
  return [
    { name: 'Archivo', data: read('@fontsource/archivo/files/archivo-latin-900-normal.woff'), weight: 900, style: 'normal' },
    { name: 'Archivo', data: read('@fontsource/archivo/files/archivo-latin-800-normal.woff'), weight: 800, style: 'normal' },
    { name: 'Space Mono', data: read('@fontsource/space-mono/files/space-mono-latin-700-normal.woff'), weight: 700, style: 'normal' },
  ];
}

const el = (type, style, children) => ({ type, props: { style, children } });
/** A bare SVG element (circle/line/…) — attributes go straight in props, no `style` wrapper. */
const svgEl = (type, attrs, children) => ({ type, props: { ...attrs, children } });

/** Largest font size (from `steps`) whose estimated single-line width still fits
    `boxWidth`; the smallest step if none do. Archivo 900 runs a little wider than
    the 700-weight estimate estimateLines was tuned for, so this checks against a
    slightly narrower box as a safety margin. */
function fitOneLine(text, boxWidth, steps) {
  const safeWidth = boxWidth * 0.92;
  for (const size of steps) {
    if (estimateLines(text, size, safeWidth) <= 1) return size;
  }
  return steps[steps.length - 1];
}

const HERO_STEPS = [104, 96, 88, 80, 72, 64, 56, 48];

/** The orrery: one dotted ring per displayed orbit (its own colour, low opacity,
    dashed — the same language as .orrery .track in global.css), a crosshair
    centre, and one solid body per orbit at its live clock position. Ring order
    matches ORBITS (innermost first); 12:00 is NEAR, reusing the exact geometry
    (clockToDeg/ringRadius) the real site's orreries use. */
function orrerySvg(displayed) {
  const c = ORRERY_SIZE / 2;
  const count = displayed.length;
  const rings = displayed.map((o, i) =>
    svgEl('circle', {
      cx: c,
      cy: c,
      r: ringRadius(i, count, RING_INNER, RING_OUTER),
      stroke: o.color,
      strokeOpacity: 0.4,
      strokeDasharray: '2 5',
      strokeWidth: 1,
      fill: 'none',
    }),
  );
  const crosshair = [
    svgEl('line', { x1: c - 9, y1: c, x2: c + 9, y2: c, stroke: FG, strokeWidth: 1.5 }),
    svgEl('line', { x1: c, y1: c - 9, x2: c, y2: c + 9, stroke: FG, strokeWidth: 1.5 }),
    svgEl('circle', { cx: c, cy: c, r: 3.5, fill: 'none', stroke: FG, strokeWidth: 1.5 }),
  ];
  const bodies = displayed.map((o, i) => {
    const r = ringRadius(i, count, RING_INNER, RING_OUTER);
    const rad = (clockToDeg(o.clock) * Math.PI) / 180;
    return svgEl('circle', {
      cx: Math.round((c + Math.cos(rad) * r) * 100) / 100,
      cy: Math.round((c + Math.sin(rad) * r) * 100) / 100,
      r: BODY_R,
      fill: o.color,
      stroke: BG,
      strokeWidth: 2,
    });
  });
  return svgEl('svg', { width: ORRERY_SIZE, height: ORRERY_SIZE, viewBox: `0 0 ${ORRERY_SIZE} ${ORRERY_SIZE}` }, [
    ...rings,
    ...crosshair,
    ...bodies,
  ]);
}

function cardTree({ SITE, displayed, POST_KINDS }) {
  const countWord = NUMBER_WORDS[displayed.length] ?? String(displayed.length);
  const headline = `${capitalize(countWord)} orbits.`.toUpperCase();
  const heroSize = fitOneLine(headline, HERO_WIDTH, HERO_STEPS);
  const ghostStyle = {
    display: 'flex',
    fontFamily: 'Archivo',
    fontWeight: 900,
    fontSize: heroSize,
    lineHeight: 1,
    letterSpacing: '-0.008em',
    // Hollow, outline-only glyphs — satori drops the glyph path entirely for a
    // literal `color: 'transparent'` fill, so this matches the panel's own
    // background instead (same visual result as global.css's `.ghost`, which
    // relies on a real browser's `color: transparent`).
    color: BG,
    WebkitTextStrokeWidth: 2.5,
    WebkitTextStrokeColor: FG,
  };
  const footerText = Object.values(POST_KINDS).join(' · ');

  return el(
    'div',
    { display: 'flex', flexDirection: 'column', width: CARD_WIDTH, height: CARD_HEIGHT, backgroundColor: BG, padding: BEZEL, fontFamily: 'Space Mono' },
    [
      el(
        'div',
        {
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          width: '100%',
          position: 'relative',
          border: `1.5px solid ${BORDER}`,
          boxShadow: `12px 12px 0px ${SHADOW}`,
          padding: `${PANEL_PAD_Y}px ${PANEL_PAD_X}px`,
        },
        [
          // Corner brackets — top-left and bottom-right only, like the original card's frame.
          el('div', { display: 'flex', position: 'absolute', top: CORNER_INSET, left: CORNER_INSET, width: CORNER_SIZE, height: CORNER_SIZE, borderTop: `${CORNER_THICK}px solid ${FG}`, borderLeft: `${CORNER_THICK}px solid ${FG}` }),
          el('div', { display: 'flex', position: 'absolute', bottom: CORNER_INSET, right: CORNER_INSET, width: CORNER_SIZE, height: CORNER_SIZE, borderBottom: `${CORNER_THICK}px solid ${FG}`, borderRight: `${CORNER_THICK}px solid ${FG}` }),

          // Header: author + station name (same pairing as Header.astro's who/doc line), a LIVE chip.
          el('div', { display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }, [
            el('div', { display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 14 }, [
              el('div', { display: 'flex', fontFamily: 'Archivo', fontWeight: 800, fontSize: 27, letterSpacing: '0.01em', color: FG }, SITE.author.toUpperCase()),
              el('div', { display: 'flex', fontFamily: 'Space Mono', fontWeight: 700, fontSize: 16, letterSpacing: '0.16em', color: DIM }, SITE.name.toUpperCase()),
            ]),
            el('div', { display: 'flex', backgroundColor: ACCENT, color: BG, fontFamily: 'Space Mono', fontWeight: 700, fontSize: 13, letterSpacing: '0.16em', padding: '8px 16px' }, 'LIVE'),
          ]),

          // Rule.
          el('div', { display: 'flex', width: '100%', height: 2, backgroundColor: LINE, marginTop: 18 }),

          // Hero (left) + orrery (right).
          el('div', { display: 'flex', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%', flex: 1, marginTop: 22 }, [
            el('div', { display: 'flex', flexDirection: 'column', justifyContent: 'center', width: HERO_WIDTH }, [
              el('div', { display: 'flex', fontFamily: 'Archivo', fontWeight: 900, fontSize: heroSize, lineHeight: 1, letterSpacing: '-0.008em', color: FG }, headline),
              el('div', { display: 'flex', flexDirection: 'column', marginTop: Math.round(heroSize * 0.15) }, [
                el('div', ghostStyle, 'ONE CENTER'),
                el('div', { ...ghostStyle, marginTop: Math.round(heroSize * 0.08) }, 'OF MASS.'),
              ]),
            ]),
            el('div', { display: 'flex', width: ORRERY_SIZE, height: ORRERY_SIZE, flexShrink: 0 }, [orrerySvg(displayed)]),
          ]),

          // Footer: mono-caps post kinds, with the same small square marker as the original card.
          el('div', { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }, [
            el('div', { display: 'flex', width: 11, height: 11, backgroundColor: ACCENT }),
            el('div', { display: 'flex', fontFamily: 'Space Mono', fontWeight: 700, fontSize: 16, letterSpacing: '0.18em', color: DIM }, footerText),
          ]),
        ],
      ),
    ],
  );
}

/** Renders the card to a palette-quantised PNG buffer — 1200×630, well under 100 KB. */
export async function renderOg() {
  const config = await loadConfig();
  const svg = await satori(cardTree(config), { width: CARD_WIDTH, height: CARD_HEIGHT, fonts: loadFonts() });
  return sharp(Buffer.from(svg)).png({ palette: true, compressionLevel: 9, effort: 10 }).toBuffer();
}

async function main() {
  const buf = await renderOg();
  fs.writeFileSync(OUT_FILE, buf);
  console.log(`Wrote public/og.png (${buf.length} bytes).`);
}

if (import.meta.main) main();
