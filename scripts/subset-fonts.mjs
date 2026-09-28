#!/usr/bin/env node
/* =============================================================
   Font subsets (READ-07) — `npm run fonts`

   The station's two typefaces come from Fontsource, whose files carry
   every weight and the full width axis (Archivo: 100–900, 62–125%).
   The site uses 400–800 and 100–110%, and almost every page is plain
   ASCII plus a little punctuation. This script cuts each face down to
   those axes (HarfBuzz instancing, via subset-font) and splits Latin
   into a "core" file every page needs and a "letters" file (accented
   Latin-1) that the browser only fetches when a page uses one — the
   same unicode-range trick Fontsource uses for latin-ext and
   vietnamese, which are kept too, so nothing loses coverage.

   Writes src/assets/fonts/*.woff2 and src/styles/fonts.css (both
   committed; tests/site/fonts.test.mjs checks they're current). Rerun
   after upgrading a @fontsource package or changing AXES/WEIGHTS below.
   ============================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = path.join(ROOT, 'src', 'assets', 'fonts');
export const CSS_FILE = path.join(ROOT, 'src', 'styles', 'fonts.css');

/** Archivo axes the stylesheet actually uses (font-weight 400–800, font-stretch 100–110%). */
const AXES = { wght: { min: 400, max: 800 }, wdth: { min: 100, max: 110 } };

/** [first, last] code point ranges. */
const LATIN_CORE = [[0x20, 0x7e], [0xa0, 0xbf], [0xd7, 0xd7], [0xf7, 0xf7], [0x2c6, 0x2c6], [0x2da, 0x2da], [0x2dc, 0x2dc],
  [0x2000, 0x206f], [0x20ac, 0x20ac], [0x2122, 0x2122], [0x2191, 0x2191], [0x2193, 0x2193], [0x2212, 0x2212], [0x2215, 0x2215],
  [0xfeff, 0xfeff], [0xfffd, 0xfffd]];
const LATIN_LETTERS = [[0xc0, 0xd6], [0xd8, 0xf6], [0xf8, 0xff], [0x131, 0x131], [0x152, 0x153], [0x2bb, 0x2bc], [0x304, 0x304],
  [0x308, 0x308], [0x329, 0x329]];
/* Fontsource's own latin-ext and vietnamese ranges, unchanged. */
const LATIN_EXT = [[0x100, 0x2ba], [0x2bd, 0x2c5], [0x2c7, 0x2cc], [0x2ce, 0x2d7], [0x2dd, 0x2ff], [0x304, 0x304], [0x308, 0x308],
  [0x329, 0x329], [0x1d00, 0x1dbf], [0x1e00, 0x1e9f], [0x1ef2, 0x1eff], [0x2020, 0x2020], [0x20a0, 0x20ab], [0x20ad, 0x20c0],
  [0x2113, 0x2113], [0x2c60, 0x2c7f], [0xa720, 0xa7ff]];
const VIETNAMESE = [[0x102, 0x103], [0x110, 0x111], [0x128, 0x129], [0x168, 0x169], [0x1a0, 0x1a1], [0x1af, 0x1b0], [0x300, 0x301],
  [0x303, 0x304], [0x308, 0x309], [0x323, 0x323], [0x329, 0x329], [0x1ea0, 0x1ef9], [0x20ab, 0x20ab]];

/** Subset name → [Fontsource subset file, ranges]. Core and letters both come from the latin file. */
const SUBSETS = {
  core: ['latin', LATIN_CORE],
  letters: ['latin', LATIN_LETTERS],
  ext: ['latin-ext', LATIN_EXT],
  vi: ['vietnamese', VIETNAMESE],
};

const FACES = [
  { family: 'Archivo Variable', style: 'normal', weight: '400 800', stretch: '100% 110%', id: 'archivo', pkg: '@fontsource-variable/archivo', file: (s) => `archivo-${s}-wdth-normal.woff2`, axes: AXES },
  { family: 'Archivo Variable', style: 'italic', weight: '400 800', stretch: '100% 110%', id: 'archivo-italic', pkg: '@fontsource-variable/archivo', file: (s) => `archivo-${s}-wdth-italic.woff2`, axes: AXES },
  { family: 'Space Mono', style: 'normal', weight: '400', id: 'space-mono-400', pkg: '@fontsource/space-mono', file: (s) => `space-mono-${s}-400-normal.woff2` },
  { family: 'Space Mono', style: 'normal', weight: '700', id: 'space-mono-700', pkg: '@fontsource/space-mono', file: (s) => `space-mono-${s}-700-normal.woff2` },
  { family: 'Space Mono', style: 'italic', weight: '400', id: 'space-mono-400-italic', pkg: '@fontsource/space-mono', file: (s) => `space-mono-${s}-400-italic.woff2` },
];

const text = (ranges) => ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCodePoint(a + i))).join('');
const hex = (n) => n.toString(16).toUpperCase().padStart(4, '0');
const unicodeRange = (ranges) => ranges.map(([a, b]) => (a === b ? `U+${hex(a)}` : `U+${hex(a)}-${hex(b)}`)).join(',');

/** Every subset file and the stylesheet, in memory: { files: Map<name, Buffer>, css }. */
export async function buildFonts() {
  const files = new Map();
  const faces = [];
  for (const face of FACES) {
    const dir = path.join(ROOT, 'node_modules', face.pkg, 'files');
    for (const [subset, [source, ranges]] of Object.entries(SUBSETS)) {
      const src = fs.readFileSync(path.join(dir, face.file(source)));
      const out = await subsetFont(src, text(ranges), { targetFormat: 'woff2', ...(face.axes ? { variationAxes: face.axes } : {}) });
      const name = `${face.id}-${subset}.woff2`;
      files.set(name, Buffer.from(out));
      faces.push(
        [
          `/* ${face.id} ${subset} */`,
          '@font-face {',
          `  font-family: '${face.family}';`,
          `  font-style: ${face.style};`,
          '  font-display: swap;',
          `  font-weight: ${face.weight};`,
          ...(face.stretch ? [`  font-stretch: ${face.stretch};`] : []),
          `  src: url('../assets/fonts/${name}') format('${face.axes ? 'woff2-variations' : 'woff2'}');`,
          `  unicode-range: ${unicodeRange(ranges)};`,
          '}',
        ].join('\n'),
      );
    }
  }
  const css = [
    '/* Generated by scripts/subset-fonts.mjs (npm run fonts) — do not edit by hand.',
    '   Archivo and Space Mono, SIL Open Font License 1.1 (src/assets/fonts/OFL-*.txt). */',
    '',
    faces.join('\n\n'),
    '',
  ].join('\n');
  return { files, css };
}

async function main() {
  const { files, css } = await buildFonts();
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, buf] of files) fs.writeFileSync(path.join(OUT_DIR, name), buf);
  for (const [id, pkg] of [['archivo', '@fontsource-variable/archivo'], ['space-mono', '@fontsource/space-mono']]) {
    fs.copyFileSync(path.join(ROOT, 'node_modules', pkg, 'LICENSE'), path.join(OUT_DIR, `OFL-${id}.txt`));
  }
  fs.writeFileSync(CSS_FILE, css);
  const total = [...files.values()].reduce((s, b) => s + b.length, 0);
  console.log(`Wrote ${files.size} subsets (${(total / 1024).toFixed(0)} KB) to src/assets/fonts and src/styles/fonts.css`);
}

if (import.meta.main) main();
