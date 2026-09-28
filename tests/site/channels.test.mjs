import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { channelLinks } from '../../src/lib/channels.ts';
import { buildSiteCopy } from '../helpers/site-build.mjs';

/* LIVE-03 — public channels: only filled ones show, malformed ones stop the build. */

const blank = { email: '', github: '', linkedin: '', mastodon: '', bluesky: '', x: '' };

test('blank channels are never shown', () => {
  assert.deepEqual(channelLinks(blank), []);
  assert.deepEqual(channelLinks({ ...blank, github: '   ' }), []);
});

test('filled channels become links, in config order, profiles marked rel=me', () => {
  const links = channelLinks({ ...blank, email: 'station@example.com', mastodon: 'https://example.social/@op', github: 'https://github.com/op' });
  assert.deepEqual(
    links.map((l) => [l.label, l.url, l.me]),
    [
      ['EMAIL', 'mailto:station@example.com', false],
      ['GITHUB', 'https://github.com/op', true],
      ['MASTODON', 'https://example.social/@op', true],
    ],
  );
});

test('a malformed channel stops the build instead of shipping a broken link', () => {
  assert.throws(() => channelLinks({ ...blank, email: 'not-an-address' }), /email/);
  assert.throws(() => channelLinks({ ...blank, email: 'a@b.com?cc=x@y.com' }), /email/);
  assert.throws(() => channelLinks({ ...blank, github: 'github.com/op' }), /https:\/\//);
  assert.throws(() => channelLinks({ ...blank, bluesky: 'http://bsky.app/profile/op' }), /https:\/\//);
  assert.throws(() => channelLinks({ ...blank, x: 'javascript:alert(1)' }), /https:\/\//);
});

test('channels render in the footer and on the Observer page, blank ones nowhere', { timeout: 300000 }, () => {
  const site = buildSiteCopy({
    prefix: 'orbital-channels-',
    edit: (tmp) => {
      const file = path.join(tmp, 'src/site.config.ts');
      const text = fs.readFileSync(file, 'utf8');
      const out = text
        .replace(/(\n    email: )'[^']*'/, "$1'station@example.com'")
        .replace(/(\n    mastodon: )'[^']*'/, "$1'https://example.social/@op'")
        .replace(/(\n    github: )'[^']*'/, "$1''")
        .replace(/(\n    linkedin: )'[^']*'/, "$1''");
      assert.notEqual(out, text, 'SITE.channels has moved — update this test');
      fs.writeFileSync(file, out);
    },
  });
  try {
    for (const page of ['index.html', 'observer/index.html']) {
      const html = fs.readFileSync(path.join(site.dist, page), 'utf8');
      const block = [...html.matchAll(/<div class="channels">([\s\S]*?)<\/div>/g)].map((m) => m[1]).join('\n');
      assert.match(block, /href="mailto:station@example\.com"/, page);
      assert.match(block, /href="https:\/\/example\.social\/@op" rel="me noopener"/, page);
      assert.doesNotMatch(block, />GITHUB</, page);
      assert.doesNotMatch(block, />LINKEDIN</, page);
    }
    // The Observer shows the channels panel as well as the footer.
    const observer = fs.readFileSync(path.join(site.dist, 'observer/index.html'), 'utf8');
    assert.equal(observer.match(/<div class="channels">/g)?.length, 2);
  } finally {
    site.cleanup();
  }
});
