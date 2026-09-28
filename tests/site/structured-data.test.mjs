/* GROW-03 — JSON-LD structured data.
   One real build, then: every ld+json block on the Bridge, the Observer, a post, a project
   and an orbit page parses and carries schema.org's required/recommended properties for its
   @type; a post title containing "</script>" can't break out of the script tag. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSiteCopy, listFiles } from '../helpers/site-build.mjs';

/** Every <script type="application/ld+json"> block on a page, parsed. */
function ldBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

function assertPerson(ld, { requireJobTitle = false } = {}) {
  assert.equal(ld['@context'], 'https://schema.org');
  assert.equal(ld['@type'], 'Person');
  // schema.org/Google required: name. Recommended: url, description, sameAs.
  assert.equal(typeof ld.name, 'string');
  assert.ok(ld.name.length > 0, 'Person.name required');
  assert.equal(typeof ld.url, 'string');
  assert.match(ld.url, /^https?:\/\//, 'Person.url should be absolute');
  if (requireJobTitle) assert.equal(typeof ld.jobTitle, 'string');
  if (ld.sameAs) {
    assert.ok(Array.isArray(ld.sameAs));
    for (const u of ld.sameAs) assert.match(u, /^https?:\/\//);
  }
}

function assertBlogPosting(ld) {
  assert.equal(ld['@context'], 'https://schema.org');
  assert.equal(ld['@type'], 'BlogPosting');
  // Google's required-for-rich-results set for BlogPosting/Article.
  assert.equal(typeof ld.headline, 'string');
  assert.ok(ld.headline.length > 0, 'headline required');
  assert.equal(typeof ld.image, 'string', 'image required');
  assert.match(ld.image, /^https?:\/\//);
  assert.equal(typeof ld.datePublished, 'string');
  assert.ok(!Number.isNaN(Date.parse(ld.datePublished)), 'datePublished must parse');
  // Recommended.
  assert.equal(typeof ld.dateModified, 'string');
  assert.ok(!Number.isNaN(Date.parse(ld.dateModified)), 'dateModified must parse');
  assert.equal(ld.author?.['@type'], 'Person');
  assert.equal(typeof ld.author?.name, 'string');
  assert.match(ld.author?.url ?? '', /^https?:\/\//);
  assert.equal(typeof ld.publisher?.name, 'string');
  assert.equal(typeof ld.mainEntityOfPage, 'string');
  assert.match(ld.mainEntityOfPage, /^https?:\/\//);
  assert.equal(typeof ld.description, 'string');
}

function assertBreadcrumbList(ld, expectedLastUrl) {
  assert.equal(ld['@context'], 'https://schema.org');
  assert.equal(ld['@type'], 'BreadcrumbList');
  assert.ok(Array.isArray(ld.itemListElement) && ld.itemListElement.length >= 2);
  ld.itemListElement.forEach((item, i) => {
    assert.equal(item['@type'], 'ListItem');
    assert.equal(item.position, i + 1, 'position must be 1-based and sequential');
    assert.equal(typeof item.name, 'string');
    assert.ok(item.name.length > 0);
    assert.match(item.item, /^https?:\/\//, 'ListItem.item must be an absolute URL');
  });
  assert.equal(ld.itemListElement[0].name, 'Home');
  assert.equal(ld.itemListElement.at(-1).item, expectedLastUrl);
}

let site;
test.before(() => {
  site = buildSiteCopy({
    prefix: 'orbital-jsonld-',
    edit: (tmp) => {
      fs.writeFileSync(
        path.join(tmp, 'src/content/posts', 'xss-jsonld-canary.md'),
        [
          '---',
          'title: "Breaking out </script><script>alert(1)</script>"',
          'date: 2026-02-01',
          'summary: canary for the ld+json escape test',
          'orbit: mind',
          'tags: []',
          '---',
          '',
          'Body.',
          '',
        ].join('\n'),
      );
    },
  });
});
test.after(() => site?.cleanup());

test('the Bridge carries a valid Person JSON-LD', () => {
  const html = fs.readFileSync(path.join(site.dist, 'index.html'), 'utf8');
  const blocks = ldBlocks(html);
  const person = blocks.find((b) => b['@type'] === 'Person');
  assert.ok(person, 'expected a Person block on the Bridge');
  assertPerson(person);
});

test('the Observer carries a valid Person JSON-LD with a jobTitle', () => {
  const html = fs.readFileSync(path.join(site.dist, 'observer/index.html'), 'utf8');
  const blocks = ldBlocks(html);
  const person = blocks.find((b) => b['@type'] === 'Person');
  assert.ok(person, 'expected a Person block on the Observer');
  assertPerson(person, { requireJobTitle: true });
});

test('a post carries a valid BlogPosting and a BreadcrumbList ending at its own URL', () => {
  const file = path.join(site.dist, 'transmissions/relativistic-jets-revisited/index.html');
  assert.ok(fs.existsSync(file), 'fixture post missing — pick another real post if this one moved');
  const html = fs.readFileSync(file, 'utf8');
  const blocks = ldBlocks(html);
  const post = blocks.find((b) => b['@type'] === 'BlogPosting');
  assert.ok(post, 'expected a BlogPosting block');
  assertBlogPosting(post);

  const crumbs = blocks.find((b) => b['@type'] === 'BreadcrumbList');
  assert.ok(crumbs, 'expected a BreadcrumbList block');
  assertBreadcrumbList(crumbs, 'https://example.test/transmissions/relativistic-jets-revisited/');
});

test('a project (Flight Log) page carries a BreadcrumbList ending at its own URL', () => {
  const dirs = fs.readdirSync(path.join(site.dist, 'log')).filter((d) => fs.statSync(path.join(site.dist, 'log', d)).isDirectory());
  assert.ok(dirs.length > 0, 'expected at least one project page');
  const html = fs.readFileSync(path.join(site.dist, 'log', dirs[0], 'index.html'), 'utf8');
  const crumbs = ldBlocks(html).find((b) => b['@type'] === 'BreadcrumbList');
  assert.ok(crumbs, 'expected a BreadcrumbList block on a project page');
  assertBreadcrumbList(crumbs, `https://example.test/log/${dirs[0]}/`);
});

test('an orbit page carries a BreadcrumbList ending at its own URL', () => {
  const html = fs.readFileSync(path.join(site.dist, 'orbits/mind/index.html'), 'utf8');
  const crumbs = ldBlocks(html).find((b) => b['@type'] === 'BreadcrumbList');
  assert.ok(crumbs, 'expected a BreadcrumbList block on an orbit page');
  assertBreadcrumbList(crumbs, 'https://example.test/orbits/mind/');
});

test('a title containing "</script>" cannot break out of the ld+json script tag', () => {
  const html = fs.readFileSync(path.join(site.dist, 'transmissions/xss-jsonld-canary/index.html'), 'utf8');
  // If the `<` in the title weren't escaped, the raw "</script>" sitting mid-headline would
  // end the JSON-LD script tag early: the regex below (which a browser's own tokenizer mimics
  // for a <script> element) would then only capture the truncated prefix up to that point,
  // and either fail to parse as JSON or parse into a headline missing the rest of the title.
  // Scoped to the two ld+json blocks this page renders (BlogPosting, BreadcrumbList) — a
  // broader whole-page substring check would false-positive on the page's own <meta
  // property="og:title" content="..."> tag, where an unescaped "<" is valid HTML (attribute
  // values aren't parsed as markup) and poses no script-injection risk.
  const scriptTags = [...html.matchAll(/<script type="application\/ld\+json">/g)];
  assert.equal(scriptTags.length, 2, 'expected exactly one ld+json tag per BlogPosting + BreadcrumbList — extra tags mean the title split the block');
  const blocks = ldBlocks(html);
  assert.equal(blocks.length, 2);
  const post = blocks.find((b) => b['@type'] === 'BlogPosting');
  assert.ok(post, 'the ld+json block must still parse as valid JSON once extracted');
  assert.equal(post.headline, 'Breaking out </script><script>alert(1)</script>', 'the title must round-trip intact, not get truncated at the injected </script>');
});

test('every ld+json block on every built page is valid JSON (no other page is broken by this feature)', () => {
  const htmlFiles = listFiles(site.dist).filter((f) => f.endsWith('.html'));
  const broken = [];
  for (const f of htmlFiles) {
    const html = fs.readFileSync(path.join(site.dist, f), 'utf8');
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try {
        JSON.parse(m[1]);
      } catch {
        broken.push(f);
      }
    }
  }
  assert.deepEqual(broken, []);
});
