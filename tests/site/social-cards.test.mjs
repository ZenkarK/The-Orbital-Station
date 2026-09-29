import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { buildSiteCopy, ROOT } from '../helpers/site-build.mjs';
import { renderOg, OUT_FILE as OG_FILE } from '../../scripts/generate-og.mjs';

/* READ-02 — every transmission, mission and orbit page gets its own generated
   social card; everything else (and any orbit dropped from a card, in principle)
   falls back to the site's static public/og.png. One real build is shared by every
   test below (build cost dominates; the checks themselves are fast). */

const SITE_ORIGIN = 'https://example.test';
let site;
let CARD_PAGES; // { file, url, ogImage }[] for every built transmission/mission/orbit page
let OTHER_PAGES; // same shape, for a sample of pages that should fall back to og.png

before(() => {
  site = buildSiteCopy({ prefix: 'orbital-social-cards-' });
});

after(() => {
  site?.cleanup();
});

/** Pulls the og:image URL (and its dist-relative path) out of a built page's HTML. */
function readOgImage(distDir, htmlRelPath) {
  const html = fs.readFileSync(path.join(distDir, htmlRelPath), 'utf8');
  const m = html.match(/<meta property="og:image" content="([^"]+)"/);
  assert.ok(m, `${htmlRelPath} has no og:image meta tag`);
  const url = m[1];
  assert.ok(url.startsWith(SITE_ORIGIN), `${htmlRelPath}'s og:image (${url}) isn't under ${SITE_ORIGIN}`);
  return { url, distPath: url.slice(SITE_ORIGIN.length) };
}

function discoverPages() {
  const distDir = site.dist;
  const list = (rel) =>
    fs.existsSync(path.join(distDir, rel))
      ? fs
          .readdirSync(path.join(distDir, rel), { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => `${rel}/${e.name}/index.html`)
      : [];

  const cardFiles = [...list('transmissions'), ...list('log'), ...list('orbits')];
  CARD_PAGES = cardFiles.map((file) => ({ file, ...readOgImage(distDir, file) }));
  assert.ok(CARD_PAGES.length >= 3, 'expected at least one transmission, mission and orbit page to be built');

  const otherFiles = ['index.html', 'library/index.html', 'manual/index.html', 'observer/index.html', 'trajectories/index.html'].filter(
    (f) => fs.existsSync(path.join(distDir, f)),
  );
  OTHER_PAGES = otherFiles.map((file) => ({ file, ...readOgImage(distDir, file) }));
}

test('every transmission, mission and orbit page has its own og:image PNG, 1200×630 and ≤100 KB', async () => {
  discoverPages();
  for (const { file, distPath } of CARD_PAGES) {
    assert.match(distPath, /^\/og\/(transmissions|log|orbits)\/[^/]+\.png$/, `${file}'s og:image (${distPath}) isn't a per-page card`);
    const abs = path.join(site.dist, distPath);
    assert.ok(fs.existsSync(abs), `${file}'s og:image points at ${distPath}, which wasn't built`);
    const stat = fs.statSync(abs);
    assert.ok(stat.size <= 100 * 1024, `${distPath} is ${stat.size} bytes, over the 100 KB budget`);
    const meta = await sharp(abs).metadata();
    assert.equal(meta.format, 'png', `${distPath} isn't a PNG`);
    assert.equal(meta.width, 1200, `${distPath} width`);
    assert.equal(meta.height, 630, `${distPath} height`);
  }
});

test('pages without a generated card fall back to the site-wide og.png', () => {
  discoverPages();
  assert.ok(OTHER_PAGES.length > 0, 'expected at least one non-card page to check');
  for (const { file, distPath } of OTHER_PAGES) {
    assert.equal(distPath, '/og.png', `${file}'s og:image (${distPath}) should fall back to /og.png`);
  }
});

test('every card is unique to its page (no two pages sharing one card by accident)', () => {
  discoverPages();
  const urls = CARD_PAGES.map((p) => p.url);
  assert.equal(new Set(urls).size, urls.length, 'duplicate og:image URLs found across card pages');
});

test('public/og.png (the fallback) is a 1200×630 PNG at or under 100 KB', async () => {
  const ogPath = path.join(ROOT, 'public/og.png');
  const stat = fs.statSync(ogPath);
  assert.ok(stat.size <= 100 * 1024, `public/og.png is ${stat.size} bytes, over the 100 KB budget`);
  const meta = await sharp(ogPath).metadata();
  assert.equal(meta.format, 'png');
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
});

test('the committed public/og.png is current (rerun `npm run og` if not — it goes stale as ORBITS grows or shrinks)', async () => {
  // Compare decoded pixels, not file bytes: sharp's PNG encoder (zlib-ng) picks its
  // deflate path by CPU features, so the same picture can compress to a few bytes more
  // or less on another machine (the owner's PC vs a CI runner) without being stale.
  const decode = async (png) => {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  };
  const fresh = await decode(await renderOg());
  const committed = await decode(fs.readFileSync(OG_FILE));
  assert.deepEqual([committed.width, committed.height], [fresh.width, fresh.height], 'public/og.png has the wrong dimensions');
  assert.ok(fresh.data.equals(committed.data), 'public/og.png is stale — its orbit count/colours no longer match src/site.config.ts');
});

test('a hidden orbit gets no card, matching it having no orbit page at all', () => {
  const before = fs.readFileSync(path.join(ROOT, 'src/site.config.ts'), 'utf8');
  const needle = "folders: ['Cooking', 'Photography'],\n    visibility: 'public',";
  assert.ok(before.includes(needle), 'site.config.ts CRAFT block has moved — update this test fixture');

  const hidden = buildSiteCopy({
    prefix: 'orbital-social-cards-hidden-',
    edit: (tmp) => {
      const configPath = path.join(tmp, 'src/site.config.ts');
      const text = fs.readFileSync(configPath, 'utf8');
      fs.writeFileSync(configPath, text.replace(needle, "folders: ['Cooking', 'Photography'],\n    visibility: 'hidden',"));
    },
  });
  try {
    assert.ok(!fs.existsSync(path.join(hidden.dist, 'orbits/craft/index.html')), '/orbits/craft/ should not be built');
    assert.ok(!fs.existsSync(path.join(hidden.dist, 'og/orbits/craft.png')), 'a hidden orbit should have no card either');
  } finally {
    hidden.cleanup();
  }
});
