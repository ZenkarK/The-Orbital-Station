import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSiteCopy, serveDir, findChrome, listFiles } from '../helpers/site-build.mjs';

/* LIVE-04 — cookie-free analytics. Off (the shipped default): no script, no request.
   On: one small deferred script, a count per page view carrying only path, title,
   screen and an external referrer, and nothing at all under DNT or GPC. */

const BASE = '/The-Orbital-Station/';
const ENDPOINT = 'https://beacon.example.test/count';
const PROBE = 'analytics-probe';

/** Sets ANALYTICS.goatcounter in the copy's site.config.ts. */
function setEndpoint(tmp, value) {
  const file = path.join(tmp, 'src/site.config.ts');
  const text = fs.readFileSync(file, 'utf8');
  const re = /(export const ANALYTICS = \{\s*goatcounter: )'[^']*'/;
  assert.match(text, re, 'ANALYTICS block has moved — update this test');
  const out = text.replace(re, `$1'${value}'`);
  fs.writeFileSync(file, out);
}

function plantProbe(tmp) {
  fs.writeFileSync(
    path.join(tmp, 'src/content/posts', `${PROBE}.md`),
    `---\ntitle: Analytics probe\ndate: 2026-01-05\nsummary: Probe.\norbit: astro\n---\n\nProbe body.\n\n<a href="#done" data-event="probe-event">Probe event</a>\n`,
  );
}

const htmlFiles = (dist) => listFiles(dist).filter((f) => f.endsWith('.html'));

test('analytics off: no beacon, no script, and the footer still says no tracking', { timeout: 300000 }, () => {
  const site = buildSiteCopy({ prefix: 'orbital-analytics-off-', edit: (tmp) => setEndpoint(tmp, '') });
  try {
    for (const f of listFiles(site.dist).filter((f) => /\.(html|js)$/.test(f))) {
      const text = fs.readFileSync(path.join(site.dist, f), 'utf8');
      assert.doesNotMatch(text, /station:beacon|goatcounter/i, f);
    }
    assert.match(fs.readFileSync(path.join(site.dist, 'index.html'), 'utf8'), /NO TRACKING, NO ADS/);
  } finally {
    site.cleanup();
  }
});

test('analytics on: counts page views and events, honours DNT/GPC, sets no cookies', { timeout: 300000 }, async (t) => {
  const site = buildSiteCopy({
    prefix: 'orbital-analytics-on-',
    env: { BASE_PATH: BASE },
    edit: (tmp) => {
      setEndpoint(tmp, ENDPOINT);
      plantProbe(tmp);
    },
  });
  try {
    // Every page carries the beacon; the script is small and deferred (Astro inlines it as a module).
    for (const f of htmlFiles(site.dist)) {
      if (f === '404.html') continue;
      const html = fs.readFileSync(path.join(site.dist, f), 'utf8');
      assert.match(html, new RegExp(`<meta name="station:beacon" content="${ENDPOINT}"`), f);
    }
    const home = fs.readFileSync(path.join(site.dist, 'index.html'), 'utf8');
    assert.match(home, /COOKIE-FREE VISIT COUNTS/);
    const beaconScript = [...home.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].find(([, , js]) =>
      js.includes('meta[name="station:beacon"]'),
    );
    assert.ok(beaconScript, 'the beacon script should be inlined on the page');
    const [, attrs, body] = beaconScript;
    assert.match(attrs, /type="module"/, 'the beacon must load deferred (as a module)');
    assert.ok(Buffer.byteLength(body) <= 5 * 1024, `beacon script is ${Buffer.byteLength(body)} bytes (limit 5 KB)`);

    const chrome = findChrome();
    if (!chrome) {
      t.skip('no Chrome/Chromium found — browser half not exercised');
      return;
    }
    const { default: puppeteer } = await import('puppeteer-core');
    const server = await serveDir(site.dist, BASE);
    const port = new URL(server.origin).port;
    // A real-looking host: the beacon never counts localhost or 127.0.0.1.
    const browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      args: ['--host-resolver-rules=MAP station.test 127.0.0.1', '--no-sandbox'],
    });
    const origin = `http://station.test:${port}`;
    const visit = async (url, before) => {
      const page = await browser.newPage();
      const hits = [];
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.url().startsWith(ENDPOINT)) {
          hits.push(new URL(req.url()));
          req.respond({ status: 204, body: '' });
        } else req.continue();
      });
      await page.evaluateOnNewDocument(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
      if (before) await page.evaluateOnNewDocument(before);
      await page.goto(url, { waitUntil: 'networkidle0' });
      return { page, hits };
    };
    try {
      const post = `${origin}${BASE}transmissions/${PROBE}/`;
      const { page, hits } = await visit(`${post}?utm_source=x#section`);
      await page.waitForFunction(() => true);
      assert.equal(hits.length, 1, 'one count per page view');
      const hit = hits[0];
      assert.equal(hit.searchParams.get('p'), `${BASE}transmissions/${PROBE}/`, 'path only — no query, no fragment');
      assert.match(hit.searchParams.get('t'), /Analytics probe/);
      assert.equal(hit.searchParams.has('r'), false, 'no referrer on a direct visit');
      assert.deepEqual(await page.cookies(), [], 'no cookies');
      assert.equal(await page.evaluate(() => document.cookie), '');

      await page.click('[data-event="probe-event"]');
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(hits.length, 2, 'the click counts as an event');
      assert.equal(hits[1].searchParams.get('p'), 'probe-event');
      assert.equal(hits[1].searchParams.get('e'), 'true');
      await page.close();

      const dnt = await visit(post, () => Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1' }));
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(dnt.hits.length, 0, 'Do Not Track: nothing sent');
      await dnt.page.close();

      const gpc = await visit(post, () => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(gpc.hits.length, 0, 'Global Privacy Control: nothing sent');
      await gpc.page.close();
    } finally {
      await browser.close();
      await server.close();
    }
  } finally {
    site.cleanup();
  }
});
