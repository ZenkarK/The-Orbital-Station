import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSiteCopy } from '../helpers/site-build.mjs';

/* READ-07 — KaTeX's stylesheet (and the fonts it pulls in) load only on pages that
   render math, and still work under the Pages base path when they do. */

const BASE = '/The-Orbital-Station/';
const post = (slug, body) => `---\ntitle: ${slug}\ndate: 2026-01-05\nsummary: Probe.\norbit: astro\n---\n\n${body}\n`;

/* KaTeX's own stylesheet declares its fonts (global.css only styles .katex boxes, which is harmless). */
const KATEX_CSS = /font-family:\s*KaTeX_/;

/** Every stylesheet a built page links, as [href, css text]. */
function stylesheets(dist, html) {
  return [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(([, href]) => {
    assert.ok(href.startsWith(`${BASE}_astro/`), `stylesheet outside the base path: ${href}`);
    return [href, fs.readFileSync(path.join(dist, href.slice(BASE.length)), 'utf8')];
  });
}

test('KaTeX CSS is linked on math pages only, with every font it names in dist', { timeout: 300000 }, () => {
  const site = buildSiteCopy({
    prefix: 'orbital-katex-',
    env: { BASE_PATH: BASE },
    edit: (tmp) => {
      const dir = path.join(tmp, 'src/content/posts');
      fs.writeFileSync(path.join(dir, 'katex-probe-math.md'), post('katex-probe-math', 'Energy: $E = mc^2$, and a block:\n\n$$\\int_0^1 x\\,dx$$'));
      fs.writeFileSync(path.join(dir, 'katex-probe-plain.md'), post('katex-probe-plain', 'No math here — a price of 5 dollars.'));
    },
  });
  try {
    const page = (p) => fs.readFileSync(path.join(site.dist, p, 'index.html'), 'utf8');

    const math = stylesheets(site.dist, page('transmissions/katex-probe-math'));
    const katex = math.find(([, css]) => KATEX_CSS.test(css));
    assert.ok(katex, 'a page with math links the KaTeX stylesheet');
    const fonts = [...katex[1].matchAll(/url\(([^)]+\.woff2)\)/g)].map(([, u]) => u);
    assert.ok(fonts.length > 10, 'the KaTeX stylesheet names its fonts');
    for (const u of fonts) {
      assert.ok(u.startsWith(`${BASE}_astro/`), `font outside the base path: ${u}`);
      assert.ok(fs.existsSync(path.join(site.dist, u.slice(BASE.length))), `missing font ${u}`);
    }

    for (const p of ['transmissions/katex-probe-plain', '', 'manual']) {
      for (const [href, css] of stylesheets(site.dist, page(p))) {
        assert.doesNotMatch(css, KATEX_CSS, `${p || 'the Bridge'} pulls KaTeX CSS in via ${href}`);
      }
    }
  } finally {
    site.cleanup();
  }
});
