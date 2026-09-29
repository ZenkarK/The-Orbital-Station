#!/usr/bin/env node
/* =============================================================
   Site-wide fallback social card (READ-02) — `npm run og`

   public/og.png is the og:image every page falls back to when it has no
   card of its own — src/pages/og/[...card].png.ts (via src/lib/og-card.ts)
   only covers transmissions, missions and orbits. Unlike those, this one
   isn't rendered at build time, so nothing kept it honest as the Orbital
   Model grew: it can only go stale by hand and come back to life by hand.
   This script renders it the same way (Satori lays out SVG, sharp
   rasterises), reading the orbit count and colours straight from
   site.config.ts, so growing or shrinking the Model and rerunning
   `npm run og` is all it takes. Deterministic — same config, same bytes.

   Writes public/og.png (committed); tests/site/social-cards.test.mjs
   checks it's current.
   ============================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import satori from 'satori';
import sharp from 'sharp';
import { fitTitleFontSize } from '../src/lib/og-title-fit.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_FILE = path.join(ROOT, 'public', 'og.png');

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const PAD_X = 72;
const PAD_Y = 56;
const ACCENT_H = 10;
const TITLE_BOX_WIDTH = CARD_WIDTH - PAD_X * 2;

const BG = '#23262d'; // --bg
const FG = '#e9e5da'; // --fg
const DIM = 'rgba(233, 229, 218, 0.68)'; // --dim

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * SITE and ORBITS, straight from site.config.ts. That file has no relative
 * imports of its own, so plain Node can load it directly (the same trick
 * scripts/obsidian/site.mjs's loadSiteConfig uses) — unlike src/lib/orbits.ts
 * or src/lib/visibility.ts, which this script can't import standalone
 * (their extensionless `from '../site.config'` only resolves inside
 * Astro/Vite). displayedOrbits' real filter lives in visibility.ts; this
 * mirrors it — a `hidden` orbit draws no slice and doesn't count here either.
 */
async function loadConfig() {
  const { SITE, ORBITS } = await import(pathToFileURL(path.join(ROOT, 'src/site.config.ts')).href);
  const displayed = ORBITS.filter((o) => o.visibility !== 'hidden');
  return { SITE, displayed };
}

/** Satori needs TTF/OTF/WOFF — not WOFF2 — so these come from @fontsource's plain
    .woff files, read straight from node_modules, same as src/lib/og-card.ts. */
function loadFonts() {
  const read = (rel) => fs.readFileSync(path.join(ROOT, 'node_modules', rel));
  return [
    { name: 'Archivo', data: read('@fontsource/archivo/files/archivo-latin-700-normal.woff'), weight: 700, style: 'normal' },
    { name: 'Space Mono', data: read('@fontsource/space-mono/files/space-mono-latin-700-normal.woff'), weight: 700, style: 'normal' },
    { name: 'Space Mono', data: read('@fontsource/space-mono/files/space-mono-latin-400-normal.woff'), weight: 400, style: 'normal' },
  ];
}

const el = (type, style, children) => ({ type, props: { style, children } });

function cardTree({ SITE, displayed }) {
  const countWord = NUMBER_WORDS[displayed.length] ?? String(displayed.length);
  const headline = `${capitalize(countWord)} orbits.`;
  const fontSize = fitTitleFontSize(headline, TITLE_BOX_WIDTH);
  return el(
    'div',
    { display: 'flex', flexDirection: 'column', width: CARD_WIDTH, height: CARD_HEIGHT, backgroundColor: BG, fontFamily: 'Space Mono' },
    [
      // One slice per displayed orbit, in its own colour: the count is drawn,
      // not just stated, so a stale slice count would be as visible as a stale word.
      el(
        'div',
        { display: 'flex', width: '100%', height: ACCENT_H },
        displayed.map((o) => el('div', { display: 'flex', flex: 1, height: ACCENT_H, backgroundColor: o.color })),
      ),
      el(
        'div',
        { display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between', padding: `${PAD_Y}px ${PAD_X}px` },
        [
          // Meta line.
          el('div', { display: 'flex', alignItems: 'center' }, [
            el('div', { display: 'flex', width: 14, height: 14, marginRight: 16, backgroundColor: FG }),
            el(
              'div',
              { display: 'flex', fontFamily: 'Space Mono', fontWeight: 700, fontSize: 22, letterSpacing: '0.12em', color: DIM },
              `ORBITAL STATION · ${countWord.toUpperCase()} ORBITS`,
            ),
          ]),
          // Headline — the site's own hero line (src/pages/index.astro), minus the
          // stroke-only "ghost" treatment satori's supported CSS subset can't render.
          el('div', { display: 'flex', flexDirection: 'column' }, [
            el(
              'div',
              { display: 'flex', fontFamily: 'Archivo', fontWeight: 700, fontSize, lineHeight: 1.1, letterSpacing: '-0.01em', color: FG },
              headline,
            ),
            el(
              'div',
              {
                display: 'flex',
                fontFamily: 'Archivo',
                fontWeight: 700,
                fontSize: Math.round(fontSize * 0.7),
                lineHeight: 1.1,
                letterSpacing: '-0.01em',
                color: DIM,
              },
              'One center of mass.',
            ),
          ]),
          // Foot: station name + author, same layout as src/lib/og-card.ts's cards.
          el(
            'div',
            { display: 'flex', alignItems: 'center', fontFamily: 'Space Mono', fontSize: 20, letterSpacing: '0.14em', color: DIM },
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
