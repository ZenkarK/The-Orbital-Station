/* GROW-03 — sitemap lastmod (src/lib/sitemap-lastmod.mjs, wired into astro.config.mjs's
   @astrojs/sitemap `serialize`). One real build with canary posts/projects planted at
   far-future dates (so they're unambiguously "the newest" regardless of real content),
   covering: updated ?? date / ended ?? started, list pages picking up the newest item, and
   draft + non-public-orbit content never being allowed to bump a list page's lastmod. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSiteCopy } from '../helpers/site-build.mjs';

function post(front, body = 'Body.') {
  return `---\n${front}\n---\n\n${body}\n`;
}

/** { loc → lastmod|undefined } from the built sitemap. */
function sitemapEntries(dist) {
  const xml = fs.readFileSync(path.join(dist, 'sitemap-0.xml'), 'utf8');
  const map = new Map();
  for (const m of xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)) {
    map.set(m[1], m[2]);
  }
  return map;
}

let site;
let entries;
test.before(() => {
  site = buildSiteCopy({
    prefix: 'orbital-lastmod-',
    edit: (tmp) => {
      const postsDir = path.join(tmp, 'src/content/posts');
      const projDir = path.join(tmp, 'src/content/projects');

      // Plain post: lastmod falls back to `date` (no `updated`).
      fs.writeFileSync(
        path.join(postsDir, 'lastmod-p1.md'),
        post('title: Lastmod P1\ndate: 2031-01-01\nsummary: p1\norbit: mind\ntags: []'),
      );
      // Updated post: lastmod is `updated`, not `date`, and it's the orbit's/site's newest.
      fs.writeFileSync(
        path.join(postsDir, 'lastmod-p2.md'),
        post('title: Lastmod P2\ndate: 2031-02-01\nupdated: 2031-03-01\nsummary: p2\norbit: mind\ntags: []'),
      );
      // Draft, dated even later: must never win the "newest" comparison anywhere.
      fs.writeFileSync(
        path.join(postsDir, 'lastmod-draft.md'),
        post('title: Lastmod Draft\ndate: 2032-01-01\nsummary: draft\norbit: mind\ntags: []\ndraft: true'),
      );
      // Phase-only orbit (BODY), dated even later still: never built, must never win either.
      fs.writeFileSync(
        path.join(postsDir, 'lastmod-phaseonly.md'),
        post('title: Lastmod Phase-only\ndate: 2033-01-01\nsummary: hidden\norbit: body\ntags: []'),
      );

      // Project with `ended` and `started`: ended wins.
      fs.writeFileSync(
        path.join(projDir, 'lastmod-proj.md'),
        post(
          'title: Lastmod Project\nsummary: proj\norbit: growth\nstarted: 2030-01-01\nended: 2031-04-01\norder: 1',
          'Brief.',
        ),
      );
      // Draft project, dated later: must not bump /log/.
      fs.writeFileSync(
        path.join(projDir, 'lastmod-draft-proj.md'),
        post('title: Lastmod Draft Project\nsummary: draft proj\norbit: growth\nended: 2034-01-01\norder: 2\ndraft: true'),
      );
    },
  });
  entries = sitemapEntries(site.dist);
});
test.after(() => site?.cleanup());

test('a post with no `updated` uses `date`', () => {
  assert.equal(entries.get('https://example.test/transmissions/lastmod-p1/'), '2031-01-01T00:00:00.000Z');
});

test('a post with `updated` uses `updated`, not `date`', () => {
  assert.equal(entries.get('https://example.test/transmissions/lastmod-p2/'), '2031-03-01T00:00:00.000Z');
});

test('a project uses `ended` over `started`', () => {
  assert.equal(entries.get('https://example.test/log/lastmod-proj/'), '2031-04-01T00:00:00.000Z');
});

test("MIND orbit's lastmod is the newest of its own (non-draft, listed) posts", () => {
  assert.equal(entries.get('https://example.test/orbits/mind/'), '2031-03-01T00:00:00.000Z');
});

test('the Transmissions list and the Bridge pick up the newest post overall — but never a draft or a phase-only-orbit one', () => {
  assert.equal(entries.get('https://example.test/transmissions/'), '2031-03-01T00:00:00.000Z');
  assert.equal(entries.get('https://example.test/'), '2031-03-01T00:00:00.000Z');
});

test('the Flight Log list picks up the newest project — but never a draft one', () => {
  assert.equal(entries.get('https://example.test/log/'), '2031-04-01T00:00:00.000Z');
});

test('a phase-only orbit (BODY) still has no lastmod at all — it has no listed posts', () => {
  assert.equal(entries.get('https://example.test/orbits/body/'), undefined);
});

test('pages with no rule (library, manual, tags, …) are left without a lastmod, same as before', () => {
  assert.equal(entries.get('https://example.test/library/'), undefined);
  assert.equal(entries.get('https://example.test/manual/'), undefined);
});

/* A SHOW_DRAFTS=true build (README's "draft preview build") makes drafts real pages
   (src/lib/content.ts's own `visible` gate), so the sitemap must stop treating them as
   invisible too — otherwise a preview build's own list-page lastmod understates the
   newest content a visitor to *that* build can actually see. */
let draftSite;
let draftEntries;
test.before(() => {
  draftSite = buildSiteCopy({
    prefix: 'orbital-lastmod-drafts-',
    env: { SHOW_DRAFTS: 'true' },
    edit: (tmp) => {
      const postsDir = path.join(tmp, 'src/content/posts');
      fs.writeFileSync(
        path.join(postsDir, 'lastmod-draft-shown.md'),
        post('title: Lastmod Draft Shown\ndate: 2035-01-01\nsummary: shown draft\norbit: mind\ntags: []\ndraft: true'),
      );
    },
  });
  draftEntries = sitemapEntries(draftSite.dist);
});
test.after(() => draftSite?.cleanup());

test('SHOW_DRAFTS=true: a built draft page gets its own lastmod, not `undefined`', () => {
  assert.equal(draftEntries.get('https://example.test/transmissions/lastmod-draft-shown/'), '2035-01-01T00:00:00.000Z');
});

test('SHOW_DRAFTS=true: a built draft can now be the newest item for its orbit and the site-wide lists', () => {
  assert.equal(draftEntries.get('https://example.test/orbits/mind/'), '2035-01-01T00:00:00.000Z');
  assert.equal(draftEntries.get('https://example.test/transmissions/'), '2035-01-01T00:00:00.000Z');
  assert.equal(draftEntries.get('https://example.test/'), '2035-01-01T00:00:00.000Z');
});
