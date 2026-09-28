/* LIVE-02 — with no SITE_URL env, astro.config.mjs falls back to `https://<host in
   public/CNAME>` (ahead of the localhost default, behind SITE_URL/Netlify/Vercel/Cloudflare
   Pages) — so canonical URLs, RSS, the JSON Feed and the sitemap all move to the custom
   domain the moment the owner commits public/CNAME, with no other config change. No CNAME
   is committed to this repo yet (see docs/M1-SPECS common.md); this only proves the code path. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSiteCopy } from '../helpers/site-build.mjs';

let site;
test.before(() => {
  site = buildSiteCopy({
    prefix: 'orbital-cname-',
    env: { SITE_URL: '' }, // clears buildSiteCopy's own default so CNAME gets a chance
    edit: (tmp) => {
      fs.writeFileSync(path.join(tmp, 'public/CNAME'), 'orbital.example\n');
    },
  });
});
test.after(() => site?.cleanup());

test('canonical URLs use the CNAME host', () => {
  const html = fs.readFileSync(path.join(site.dist, 'index.html'), 'utf8');
  assert.match(html, /<link rel="canonical" href="https:\/\/orbital\.example\/"/);
  assert.match(html, /<meta property="og:url" content="https:\/\/orbital\.example\/"/);
});

test('the site-wide RSS feed and JSON Feed use the CNAME host', () => {
  const rss = fs.readFileSync(path.join(site.dist, 'rss.xml'), 'utf8');
  assert.match(rss, /<link>https:\/\/orbital\.example\/<\/link>/);
  const feed = JSON.parse(fs.readFileSync(path.join(site.dist, 'feed.json'), 'utf8'));
  assert.equal(feed.home_page_url, 'https://orbital.example/');
  assert.equal(feed.feed_url, 'https://orbital.example/feed.json');
});

test('the sitemap uses the CNAME host', () => {
  const xml = fs.readFileSync(path.join(site.dist, 'sitemap-0.xml'), 'utf8');
  assert.match(xml, /<loc>https:\/\/orbital\.example\//);
  assert.doesNotMatch(xml, /example\.test|localhost/);
});
