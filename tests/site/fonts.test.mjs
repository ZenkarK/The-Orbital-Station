import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildFonts, OUT_DIR, CSS_FILE } from '../../scripts/subset-fonts.mjs';

/* READ-07 — the committed font subsets are exactly what `npm run fonts` makes from the
   installed Fontsource packages, and every weight/width the stylesheets ask for is
   inside the axes the subsets keep (400–800, 100–110%). */

const STYLES = path.resolve(import.meta.dirname, '../../src');

test('committed font subsets and fonts.css are current (rerun `npm run fonts` if not)', { timeout: 120000 }, async () => {
  const { files, css } = await buildFonts();
  assert.equal(fs.readFileSync(CSS_FILE, 'utf8'), css, 'src/styles/fonts.css is stale');
  const committed = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.woff2')).sort();
  assert.deepEqual(committed, [...files.keys()].sort(), 'src/assets/fonts has missing or extra subsets');
  for (const [name, buf] of files) assert.ok(fs.readFileSync(path.join(OUT_DIR, name)).equals(buf), `${name} is stale`);
});

test('every font-weight and font-stretch in the stylesheets is inside the subset axes', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(css|astro)$/.test(e.name) && p !== CSS_FILE) {
        const text = fs.readFileSync(p, 'utf8');
        for (const [, w] of text.matchAll(/font-weight:\s*(\d+)/g)) if (+w < 400 || +w > 800) offenders.push(`${e.name}: font-weight ${w}`);
        for (const [, s] of text.matchAll(/font-stretch:\s*(\d+(?:\.\d+)?)%/g)) if (+s < 100 || +s > 110) offenders.push(`${e.name}: font-stretch ${s}%`);
        for (const [kw] of text.matchAll(/font-weight:\s*(lighter|100|200|300|900)\b/g)) offenders.push(`${e.name}: ${kw}`);
      }
    }
  };
  walk(STYLES);
  assert.deepEqual(offenders, [], 'outside the subset axes — widen AXES in scripts/subset-fonts.mjs and rerun `npm run fonts`');
});
