import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import puppeteer from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';
import { buildSiteCopy, serveDir, findChrome } from '../helpers/site-build.mjs';
import { buildState, encodeState } from '../../src/lib/kit-state.ts';

/* PLAY-01 — Orbit Kit browser end-to-end. Builds one throwaway copy of the
   site (BASE_PATH set, like the live GitHub Pages deploy) and drives the
   kit with real Chrome. Skips outright when no Chrome/Chromium is on this
   machine (see findChrome in tests/helpers/site-build.mjs), same as any
   other browser test here.

   The central acceptance criterion (2): nothing the visitor builds — a
   unique-token orbit name, a non-ASCII name, a dragged/nudged clock — may
   ever appear in a request this page makes, or in anything the static
   server actually received. Browsers never put a URL fragment on the wire
   (confirmed empirically: a static server's own request log never carries
   one), so requests are checked with the fragment stripped — that isolates
   "did this leak over the network" from "what page is the browser showing",
   which legitimately does carry the fragment in its address bar and in
   Puppeteer's own request-URL bookkeeping for the navigation itself. */

const BASE = '/The-Orbital-Station/';
const chromePath = findChrome();
const skip = chromePath ? false : 'no Chrome/Chromium found on this machine';

/** @type {{ tmp: string; dist: string; cleanup: () => void } | undefined} */
let site;
/** @type {Awaited<ReturnType<typeof serveDir>> | undefined} */
let server;
/** @type {import('puppeteer-core').Browser | undefined} */
let browser;

before(
  async () => {
    if (skip) return;
    site = buildSiteCopy({ prefix: 'orbital-kit-e2e-', env: { BASE_PATH: BASE } });
    server = await serveDir(site.dist, BASE);
    browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
  },
  { timeout: 300000 },
);

after(async () => {
  await browser?.close();
  await server?.close();
  site?.cleanup();
});

async function newPage() {
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept()); // "start over?" confirm — never actually triggered when unTouched, but a safety net
  return page;
}

async function gotoKit(page, hash = '') {
  await page.goto(server.url('/manual/kit/') + hash, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-kit-ui]:not([hidden])', { timeout: 15000 });
}

async function setValue(page, selector, value) {
  await page.$eval(
    selector,
    (el, v) => {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    value,
  );
}

const getShareUrl = (page) => page.$eval('[data-share-url]', (el) => el.value);
const stripFragment = (u) => u.split('#')[0];

/** Puppeteer's own `ElementHandle.focus()` refuses anything but an
    HTMLElement, so the SVG bodies (SVGElement, though natively focusable
    via their own tabindex) need a plain in-page `.focus()` call instead. */
async function focusEl(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!(el instanceof Element) || typeof el.focus !== 'function') throw new Error(`not focusable: ${sel}`);
    el.focus();
  }, selector);
}

test(
  'renaming orbits (one with a non-ASCII name, one with a unique token), nudging a body, and exporting JSON never puts the model on the wire',
  { skip, timeout: 60000 },
  async () => {
    const page = await newPage();
    const pageRequests = [];
    const pending = [];
    page.on('request', (req) => {
      const postData = req.hasPostData() ? req.fetchPostData() : Promise.resolve(null);
      pending.push(
        postData.then((data) => {
          pageRequests.push({ url: req.url(), method: req.method(), postData: data ?? null });
        }),
      );
    });
    try {
      await gotoKit(page);
      await page.click('[data-preset="blank"]');
      await page.waitForSelector('.kit-orbit-row');

      const token = `kit-e2e-token-${crypto.randomBytes(6).toString('hex')}`;
      const nonAscii = '軌道・カフェ★Ω 目標';

      await setValue(page, '.kit-orbit-row:nth-child(1) .kit-name', token);
      await page.click('[data-add-orbit]');
      await setValue(page, '.kit-orbit-row:last-child .kit-name', nonAscii);

      // Nudge the first body — the fuller keyboard path is its own test below.
      const firstId = await page.$eval('[data-kit-svg] [data-body]', (el) => el.dataset.body);
      await focusEl(page, `[data-body="${firstId}"]`);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      await page.click('[data-export="json"]');
      await new Promise((r) => setTimeout(r, 300));
      await Promise.all(pending);

      const shareUrl = await getShareUrl(page);
      assert.match(shareUrl, /#k1\./, 'the share field should hold a versioned fragment');
      assert.ok(shareUrl.startsWith(server.url('/manual/kit/')), 'the share link should point back at this page');

      for (const r of pageRequests) {
        const bare = stripFragment(r.url);
        assert.ok(!bare.includes(token), `a request leaked the orbit name token: ${r.url}`);
        assert.ok(!bare.includes('k1.'), `a request leaked the fragment prefix: ${r.url}`);
        assert.ok(!bare.includes(encodeURIComponent(nonAscii)), `a request leaked the non-ASCII name: ${r.url}`);
        assert.ok(!(r.postData ?? '').includes(token), 'a POST body leaked the orbit name token');
      }
      for (const seen of server.requests) {
        assert.ok(!seen.includes(token), `the server saw the orbit name token in ${seen}`);
        assert.ok(!seen.includes('k1.'), `the server saw the fragment prefix in ${seen}`);
      }
    } finally {
      await page.close();
    }
  },
);

test('reloading from the share URL restores the exact layout', { skip, timeout: 30000 }, async () => {
  const page = await newPage();
  try {
    await gotoKit(page);
    await page.click('[data-preset="blank"]');
    await page.waitForSelector('.kit-orbit-row');

    const uniqueName = `restore-check-${crypto.randomBytes(4).toString('hex')}`;
    await setValue(page, '.kit-orbit-row:nth-child(1) .kit-name', uniqueName);
    await setValue(page, '.kit-orbit-row:nth-child(1) .kit-clock', '9:15');
    await page.$eval('.kit-orbit-row:nth-child(1) .kit-clock', (el) => el.dispatchEvent(new Event('change', { bubbles: true })));
    await page.click('[data-add-const]');
    await setValue(page, '.kit-const-row:last-child .kit-const-input', 'RESTORED');

    const shareUrl = await getShareUrl(page);
    assert.match(shareUrl, /#k1\./);

    const page2 = await newPage();
    try {
      await page2.goto(shareUrl, { waitUntil: 'networkidle0' });
      await page2.waitForSelector('.kit-orbit-row', { timeout: 15000 });
      const restoredName = await page2.$eval('.kit-orbit-row:nth-child(1) .kit-name', (el) => el.value);
      const restoredClock = await page2.$eval('.kit-orbit-row:nth-child(1) .kit-clock', (el) => el.value);
      const restoredConst = await page2.$eval('.kit-const-row:last-child .kit-const-input', (el) => el.value);
      assert.equal(restoredName, uniqueName);
      assert.equal(restoredClock, '9:15');
      assert.equal(restoredConst, 'RESTORED');
    } finally {
      await page2.close();
    }
  } finally {
    await page.close();
  }
});

test('the kit keeps rendering and working offline once its service worker has cached it', { skip, timeout: 40000 }, async () => {
  const page = await newPage();
  try {
    await gotoKit(page);
    // "Blank" (not "station", which is already at the 12-orbit cap) so there's
    // room left to prove "add an orbit" still works below.
    await page.click('[data-preset="blank"]');
    await page.waitForSelector('.kit-orbit-row');

    // clients.claim() means the very first load can be controlled once activation finishes.
    await page
      .waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 15000 })
      .catch(() => {});
    // Give the page's postMessage → cache.put round trip a moment to land.
    await page
      .waitForFunction(
        async () => {
          if (!('caches' in window)) return false;
          for (const key of await caches.keys()) {
            const cache = await caches.open(key);
            if ((await cache.keys()).length > 0) return true;
          }
          return false;
        },
        { timeout: 15000, polling: 250 },
      )
      .catch(() => {});

    await page.setOfflineMode(true);
    try {
      await page.reload({ waitUntil: 'networkidle0', timeout: 15000 });
      await page.waitForSelector('[data-kit-ui]:not([hidden])', { timeout: 10000 });
      const rowCount = await page.$$eval('.kit-orbit-row', (els) => els.length);
      assert.ok(rowCount > 0, 'the kit should still render its orbit rows while offline');

      // And it should still work, not just render: add an orbit, purely client-side.
      const before = rowCount;
      await page.click('[data-add-orbit]');
      const after = await page.$$eval('.kit-orbit-row', (els) => els.length);
      assert.equal(after, before + 1, 'adding an orbit should still work offline');
    } finally {
      await page.setOfflineMode(false);
    }
  } finally {
    await page.close();
  }
});

test('the main controls are reachable and operable by keyboard alone', { skip, timeout: 30000 }, async () => {
  const page = await newPage();
  try {
    await gotoKit(page);
    await page.click('[data-preset="blank"]');
    await page.waitForSelector('.kit-orbit-row');

    // Focus a body directly (as Tab would land on it) and nudge it with the arrow keys.
    const firstId = await page.$eval('[data-kit-svg] [data-body]', (el) => el.dataset.body);
    await focusEl(page, `[data-body="${firstId}"]`);
    const before = await page.$eval(`[data-body="${firstId}"]`, (el) => el.getAttribute('aria-valuetext'));
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const after = await page.$eval(`[data-body="${firstId}"]`, (el) => el.getAttribute('aria-valuetext'));
    assert.notEqual(before, after, 'arrow keys on a focused body should change its phase');

    // Activate "add orbit" by keyboard alone.
    const countBefore = await page.$$eval('.kit-orbit-row', (els) => els.length);
    await page.focus('[data-add-orbit]');
    await page.keyboard.press('Enter');
    await page.waitForFunction((n) => document.querySelectorAll('.kit-orbit-row').length > n, {}, countBefore);

    // Type into the capacity field and commit with Tab.
    await page.focus('[data-capacity]');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.type('2');
    await page.keyboard.press('Tab');
    assert.equal(await page.$eval('[data-capacity]', (el) => el.value), '2');

    // Activate "copy link" by keyboard alone — succeeds either via the Clipboard
    // API or its select-text fallback, either way the note is set.
    await page.focus('[data-copy-link]');
    await page.keyboard.press('Enter');
    await page
      .waitForFunction(() => (document.querySelector('[data-copy-note]')?.textContent ?? '').length > 0, { timeout: 5000 })
      .catch(() => {});
    const note = await page.$eval('[data-copy-note]', (el) => el.textContent);
    assert.ok(note && note.length > 0, 'the copy-link button should give keyboard feedback');
  } finally {
    await page.close();
  }
});

test(
  "printing the worksheet with the site's own station preset (12 orbits) fits on one page",
  { skip, timeout: 30000 },
  async () => {
    const page = await newPage();
    try {
      await gotoKit(page);
      await page.click('[data-preset="station"]');
      await page.waitForSelector('.kit-orbit-row');
      await page.evaluate(() => document.querySelector('[data-print]').click());
      // The print sheet is built into [data-print-sheet] synchronously on click
      // (it only ever becomes visually visible under @media print — its `hidden`
      // DOM attribute is never removed), so wait for its content instead.
      await page.waitForSelector('[data-print-sheet] .kit-print-table');
      await page.emulateMediaType('print');
      const pdfBytes = await page.pdf({ format: 'A4', printBackground: true });
      const doc = await PDFDocument.load(pdfBytes);
      assert.equal(
        doc.getPageCount(),
        1,
        "the printable worksheet should fit the site's own 12-orbit station preset on a single page",
      );

      // The orrery's ring "tracks" (and the center crosshair) are outlines —
      // `fill: none` — in the live SVG. If print media forces `fill` to black
      // across the board, the outermost (largest, last-painted) ring becomes a
      // solid black disc that covers every ring, body and label beneath it,
      // leaving an unreadable blob instead of an orrery.
      const trackFill = await page.$eval('[data-print-sheet] .track', (el) => getComputedStyle(el).fill);
      assert.notEqual(trackFill, 'rgb(0, 0, 0)', 'an orrery ring should stay unfilled (outline only) when printed, not become a solid black disc');
    } finally {
      await page.close();
    }
  },
);

test(
  'label widths are measured correctly on the very first render, not only after an interaction',
  { skip, timeout: 30000 },
  async () => {
    const page = await newPage();
    try {
      // Instrument the SVG text-measurement API the label-placement code relies
      // on: any call that reports a 0-width result for a non-empty label is a
      // sign it ran while the SVG's ancestor was still `hidden` (display:none),
      // which is exactly the state every visitor's very first render — and every
      // share-link reload — starts from, before any interaction re-runs layout.
      await page.evaluateOnNewDocument(() => {
        window.__zeroWidthLabels = [];
        const orig = SVGTextContentElement.prototype.getComputedTextLength;
        SVGTextContentElement.prototype.getComputedTextLength = function () {
          const result = orig.call(this);
          if (result === 0 && (this.textContent ?? '').trim().length > 0) {
            window.__zeroWidthLabels.push(this.textContent);
          }
          return result;
        };
      });
      const fragment = encodeState(
        buildState(
          [
            { name: 'ALPHA LONG NAME ONE', clock: '12:00' },
            { name: 'BRAVO LONGER NAME TWO', clock: '3:00' },
            { name: 'CHARLIE THREE YYYYY', clock: '6:00' },
            { name: 'DELTA FOUR ZZZZZZZZ', clock: '9:00' },
          ],
          ['ONE', 'TWO', 'THREE'],
          3,
        ),
      );
      await gotoKit(page, `#${fragment}`);
      const zeroWidthLabels = await page.evaluate(() => window.__zeroWidthLabels);
      assert.deepEqual(
        zeroWidthLabels,
        [],
        'every label should be measured with its real rendered width on the very first render (a share-link reload), not while its container is still hidden',
      );
    } finally {
      await page.close();
    }
  },
);

test('each orbit body slider has an accessible name', { skip, timeout: 20000 }, async () => {
  const page = await newPage();
  try {
    await gotoKit(page);
    const label = await page.$eval('[data-kit-svg] [data-body]', (el) => el.getAttribute('aria-label'));
    assert.ok(label && label.trim().length > 0, 'the orbit body slider should carry a non-empty aria-label, like the Bridge orrery does');
  } finally {
    await page.close();
  }
});

test(
  "renaming an orbit refreshes its clock input's and remove button's aria-labels",
  { skip, timeout: 20000 },
  async () => {
    const page = await newPage();
    try {
      await gotoKit(page);
      await page.click('[data-preset="blank"]');
      await page.waitForSelector('.kit-orbit-row');
      await setValue(page, '.kit-orbit-row:nth-child(1) .kit-name', 'HEALTH');
      const clockLabel = await page.$eval('.kit-orbit-row:nth-child(1) .kit-clock', (el) => el.getAttribute('aria-label'));
      const removeLabel = await page.$eval('.kit-orbit-row:nth-child(1) .kit-remove', (el) => el.getAttribute('aria-label'));
      assert.match(clockLabel ?? '', /^HEALTH\b/, "the clock input's aria-label should reflect the renamed orbit");
      assert.equal(removeLabel, 'Remove HEALTH');
    } finally {
      await page.close();
    }
  },
);
