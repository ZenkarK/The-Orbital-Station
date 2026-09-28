/* GROW-02 — per-orbit RSS + site-wide JSON Feed.
   One real build (BASE_PATH set, two canary posts in different public orbits), then:
     - every feed (site-wide rss.xml, feed.json, and two orbit rss.xml files) is well-formed
       (rss.xml) or valid JSON (feed.json), and every URL in them is absolute and carries the
       base path;
     - feed.json has every JSON Feed 1.1 required field, on the document and on each item;
     - phase-only orbits (BODY, KIN) get no orbits/<id>/rss.xml at all;
     - an orbit's feed carries only that orbit's own items. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildSiteCopy, listFiles } from '../helpers/site-build.mjs';
import { assertWellFormedXml } from '../helpers/xml.mjs';

const suffix = crypto.randomBytes(6).toString('hex');
const T = {
  mind: `canary-feedmind-${suffix}`,
  astro: `canary-feedastro-${suffix}`,
  mdx: `canary-feedmdx-${suffix}`,
};
const BASE = '/sub-station/';

function post(token, orbit) {
  return `---\ntitle: ${token} title\ndate: 2026-02-01\nsummary: ${token} summary\norbit: ${orbit}\ntags: [${token}]\n---\n\n${token} body text.\n`;
}

let site;
test.before(() => {
  site = buildSiteCopy({
    prefix: 'orbital-feeds-',
    env: { BASE_PATH: BASE },
    edit: (tmp) => {
      const postsDir = path.join(tmp, 'src/content/posts');
      fs.writeFileSync(path.join(postsDir, `${T.mind}.md`), post(T.mind, 'mind'));
      fs.writeFileSync(path.join(postsDir, `${T.astro}.md`), post(T.astro, 'astro'));
      // GROW-02: an .mdx post — feed.ts's own comment says `rendered.html` is undefined for
      // MDX, so its feed item should fall back to `summary` instead of full-text HTML.
      fs.writeFileSync(path.join(postsDir, `${T.mdx}.mdx`), post(T.mdx, 'growth'));
    },
  });
});
test.after(() => site?.cleanup());

test('phase-only orbits (BODY, KIN) have no rss.xml at all', () => {
  const files = listFiles(site.dist).filter((f) => /^orbits\/.+\/rss\.xml$/.test(f));
  assert.ok(files.length > 0, 'expected at least one orbit feed to exist');
  assert.ok(!files.includes('orbits/body/rss.xml'), 'BODY is phase-only — no feed');
  assert.ok(!files.includes('orbits/kin/rss.xml'), 'KIN is phase-only — no feed');
  assert.ok(files.includes('orbits/mind/rss.xml'), 'MIND is public — should have a feed');
  assert.ok(files.includes('orbits/astro/rss.xml'), 'ASTRO is public — should have a feed');
});

test('site-wide rss.xml is well-formed and every URL carries the base path', () => {
  const xml = fs.readFileSync(path.join(site.dist, 'rss.xml'), 'utf8');
  assertWellFormedXml(xml, 'rss.xml');
  assert.match(xml, /<link>https:\/\/example\.test\/sub-station\/<\/link>/);
  for (const m of xml.matchAll(/<link>([^<]+)<\/link>/g)) {
    assert.match(m[1], /^https:\/\/example\.test\/sub-station\//, `link not absolute+based: ${m[1]}`);
  }
  for (const m of xml.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)) {
    assert.match(m[1], /^https:\/\/example\.test\/sub-station\//, `guid not absolute+based: ${m[1]}`);
  }
  assert.match(xml, new RegExp(T.mind));
  assert.match(xml, new RegExp(T.astro));
});

test('site-wide rss.xml links to the JSON Feed and vice versa is consistent with feed.json', () => {
  const xml = fs.readFileSync(path.join(site.dist, 'rss.xml'), 'utf8');
  assertWellFormedXml(xml, 'rss.xml');
});

test('every orbit rss.xml is well-formed with absolute, based URLs', () => {
  const orbitFeeds = listFiles(site.dist).filter((f) => /^orbits\/.+\/rss\.xml$/.test(f));
  for (const f of orbitFeeds) {
    const xml = fs.readFileSync(path.join(site.dist, f), 'utf8');
    assertWellFormedXml(xml, f);
    for (const m of xml.matchAll(/<link>([^<]+)<\/link>/g)) {
      assert.match(m[1], /^https:\/\/example\.test\/sub-station\//, `${f}: link not absolute+based: ${m[1]}`);
    }
  }
});

test("an orbit's feed carries only that orbit's own items", () => {
  const mindXml = fs.readFileSync(path.join(site.dist, 'orbits/mind/rss.xml'), 'utf8');
  assert.match(mindXml, new RegExp(T.mind), 'MIND feed should include its own canary');
  assert.doesNotMatch(mindXml, new RegExp(T.astro), "MIND feed must not include ASTRO's canary");

  const astroXml = fs.readFileSync(path.join(site.dist, 'orbits/astro/rss.xml'), 'utf8');
  assert.match(astroXml, new RegExp(T.astro), 'ASTRO feed should include its own canary');
  assert.doesNotMatch(astroXml, new RegExp(T.mind), "ASTRO feed must not include MIND's canary");
});

test('feed.json is valid JSON Feed 1.1: document + item required fields, absolute+based URLs', () => {
  const raw = fs.readFileSync(path.join(site.dist, 'feed.json'), 'utf8');
  const doc = JSON.parse(raw);

  assert.equal(doc.version, 'https://jsonfeed.org/version/1.1');
  assert.equal(typeof doc.title, 'string');
  assert.ok(doc.title.length > 0);
  assert.equal(typeof doc.home_page_url, 'string');
  assert.equal(typeof doc.feed_url, 'string');
  assert.match(doc.home_page_url, /^https:\/\/example\.test\/sub-station\//);
  assert.match(doc.feed_url, /^https:\/\/example\.test\/sub-station\/feed\.json$/);
  assert.ok(Array.isArray(doc.items) && doc.items.length > 0);

  for (const item of doc.items) {
    assert.equal(typeof item.id, 'string', 'item.id required');
    assert.equal(typeof item.url, 'string', 'item.url required');
    assert.equal(typeof item.title, 'string', 'item.title required');
    assert.match(item.id, /^https:\/\/example\.test\/sub-station\//);
    assert.match(item.url, /^https:\/\/example\.test\/sub-station\//);
    assert.ok(item.content_html || item.summary, 'item needs content_html or summary');
    assert.equal(typeof item.date_published, 'string');
    assert.ok(!Number.isNaN(Date.parse(item.date_published)), 'date_published must parse');
    assert.equal(typeof item.date_modified, 'string');
    assert.ok(!Number.isNaN(Date.parse(item.date_modified)), 'date_modified must parse');
    assert.ok(Array.isArray(item.tags));
    assert.ok(Array.isArray(item.authors) && item.authors.length > 0 && typeof item.authors[0].name === 'string');
  }

  const ids = doc.items.map((i) => i.id);
  assert.ok(ids.some((id) => id.includes(T.mind)));
  assert.ok(ids.some((id) => id.includes(T.astro)));
  assert.ok(ids.some((id) => id.includes(T.mdx)));
});

test('an .mdx post has no rendered HTML, so its feed item falls back to `summary` (feed.ts\'s documented MDX branch)', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(site.dist, 'feed.json'), 'utf8'));
  const item = doc.items.find((i) => i.id.includes(T.mdx));
  assert.ok(item, 'expected the .mdx canary to have a feed.json item');
  assert.equal(item.content_html, undefined, '.mdx post should have no content_html — falls back to summary');
  assert.equal(item.summary, `${T.mdx} summary`);

  const xml = fs.readFileSync(path.join(site.dist, 'rss.xml'), 'utf8');
  assertWellFormedXml(xml, 'rss.xml');
  assert.match(xml, new RegExp(`<description>${T.mdx} summary</description>`), 'rss item should carry the plain summary');
});

test('feeds are linked in <head> on the Bridge and on an orbit page', () => {
  const home = fs.readFileSync(path.join(site.dist, 'index.html'), 'utf8');
  assert.match(home, /<link rel="alternate" type="application\/rss\+xml"[^>]*href="\/sub-station\/rss\.xml"/);
  assert.match(home, /<link rel="alternate" type="application\/feed\+json"[^>]*href="\/sub-station\/feed\.json"/);

  const mindPage = fs.readFileSync(path.join(site.dist, 'orbits/mind/index.html'), 'utf8');
  assert.match(
    mindPage,
    /<link rel="alternate" type="application\/rss\+xml"[^>]*href="\/sub-station\/orbits\/mind\/rss\.xml"/,
    "MIND's page should link its own feed as an extra alternate",
  );
  // And visibly, not just in <head>.
  assert.match(mindPage, /href="\/sub-station\/orbits\/mind\/rss\.xml"[^>]*>ORBIT RSS/);

  const bodyPage = fs.readFileSync(path.join(site.dist, 'orbits/body/index.html'), 'utf8');
  assert.doesNotMatch(bodyPage, /orbits\/body\/rss\.xml/, 'phase-only BODY must not link a feed that does not exist');
});
