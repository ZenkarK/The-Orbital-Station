import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSiteCopy, serveDir, findChrome } from '../helpers/site-build.mjs';

/* On a phone the header nav scrolls sideways under a fade. Tabbing through it must keep
   every focused link fully on screen and out from under the fade (WCAG 2.4.11, focus not
   obscured) — nine links since M1 added PROFESSIONAL and NOW. */

const BASE = '/The-Orbital-Station/';

test('keyboard focus in the phone nav is never off screen or faded', { timeout: 300000 }, async (t) => {
  const chrome = findChrome();
  if (!chrome) {
    t.skip('no Chrome/Chromium found');
    return;
  }
  const { default: puppeteer } = await import('puppeteer-core');
  const site = buildSiteCopy({ prefix: 'orbital-navfocus-', env: { BASE_PATH: BASE } });
  const server = await serveDir(site.dist, BASE);
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  try {
    for (const width of [320, 390]) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 800 });
      await page.goto(server.url('/'), { waitUntil: 'networkidle0' });
      const seen = [];
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press('Tab');
        const f = await page.evaluate(() => {
          const a = document.activeElement;
          const nav = a?.closest('nav.nav');
          if (!nav) return null;
          const r = a.getBoundingClientRect();
          return { text: a.textContent.trim(), left: r.left, right: r.right, mask: getComputedStyle(nav).maskImage };
        });
        if (!f) continue;
        seen.push(f.text);
        assert.ok(f.left >= 0 && f.right <= width + 0.5, `${width}px: ${f.text} is focused at ${f.left}–${f.right}, off screen`);
        assert.equal(f.mask, 'none', `${width}px: ${f.text} is focused under the fade`);
      }
      assert.ok(seen.includes('NOW') && seen.includes('PROFESSIONAL'), `${width}px: tabbing reached ${seen.join(', ')}`);
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
    site.cleanup();
  }
});
