import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldCount, hitUrl, orbitTitle } from '../../src/lib/beacon.ts';

/* LIVE-04 — the decision to count a visit, and what a count carries. The browser
   half (src/components/Analytics.astro) only reads navigator/location and hands
   them to these two functions. */

const ENDPOINT = 'https://station.goatcounter.com/count';
const visitor = { dnt: null, gpc: false, webdriver: false, hostname: 'zenkark.github.io', protocol: 'https:' };

test('an ordinary visit is counted', () => {
  assert.equal(shouldCount(visitor), true);
});

test('Do Not Track and Global Privacy Control are honoured', () => {
  assert.equal(shouldCount({ ...visitor, dnt: '1' }), false);
  assert.equal(shouldCount({ ...visitor, dnt: 'yes' }), false); // old Firefox spelling
  assert.equal(shouldCount({ ...visitor, gpc: true }), false);
  assert.equal(shouldCount({ ...visitor, dnt: '0' }), true);
});

test('automation, local previews and saved copies are never counted', () => {
  assert.equal(shouldCount({ ...visitor, webdriver: true }), false);
  for (const hostname of ['localhost', '127.0.0.1', '[::1]', '']) assert.equal(shouldCount({ ...visitor, hostname }), false, hostname);
  assert.equal(shouldCount({ ...visitor, protocol: 'file:' }), false);
});

test('a hit carries the path, title, screen and an external referrer — nothing else', () => {
  const u = new URL(
    hitUrl(ENDPOINT, {
      path: '/The-Orbital-Station/transmissions/jets/',
      title: 'Jets — Orbital Station',
      referrer: 'https://news.example.com/item?id=42&user=someone#frag',
      host: 'zenkark.github.io',
      screen: [390, 844, 3],
      rnd: 'x1',
    }),
  );
  assert.equal(u.origin + u.pathname, ENDPOINT);
  assert.equal(u.searchParams.get('p'), '/The-Orbital-Station/transmissions/jets/');
  assert.equal(u.searchParams.get('t'), 'Jets — Orbital Station');
  // The referrer keeps where the visitor came from, but not its query or fragment.
  assert.equal(u.searchParams.get('r'), 'https://news.example.com/item');
  assert.equal(u.searchParams.get('s'), '390,844,3');
  assert.equal(u.searchParams.get('rnd'), 'x1');
  assert.equal(u.searchParams.has('e'), false);
  assert.deepEqual([...u.searchParams.keys()].sort(), ['p', 'r', 'rnd', 's', 't']);
});

test('the path never carries a query string or fragment', () => {
  const u = new URL(hitUrl(ENDPOINT, { path: '/manual/kit/?x=1#k1.eyJ9', title: 'Kit', rnd: 'r' }));
  assert.equal(u.searchParams.get('p'), '/manual/kit/');
});

test('internal navigation sends no referrer', () => {
  for (const referrer of ['https://zenkark.github.io/The-Orbital-Station/', '', 'not a url']) {
    const u = new URL(hitUrl(ENDPOINT, { path: '/', title: 'Bridge', referrer, host: 'zenkark.github.io', rnd: 'r' }));
    assert.equal(u.searchParams.has('r'), false, referrer);
  }
});

test('events are flagged and named by their event', () => {
  const u = new URL(hitUrl(ENDPOINT, { path: 'cv-download', title: 'Download the CV', event: true, rnd: 'r' }));
  assert.equal(u.searchParams.get('p'), 'cv-download');
  assert.equal(u.searchParams.get('e'), 'true');
});

test('pages in an orbit prefix their title with the orbit name', () => {
  assert.equal(orbitTitle('Jets — Orbital Station', 'ASTRO'), 'ASTRO · Jets — Orbital Station');
  assert.equal(orbitTitle('Orbital Station — Zenkar', ''), 'Orbital Station — Zenkar');
  assert.equal(orbitTitle('Orbital Station — Zenkar', null), 'Orbital Station — Zenkar');
});
