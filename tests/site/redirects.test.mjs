/* LIVE-08 — src/redirects.json → Astro static redirects.
   A planted redirects.json, built with a BASE_PATH, must produce a meta-refresh page (GitHub
   Pages serves no real HTTP redirects) whose refresh target and canonical link both carry the
   base path, and the page must not leak into places nothing points it — see also
   tests/obsidian/redirects.test.mjs (the map bookkeeping) and gates.test.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSiteCopy } from '../helpers/site-build.mjs';

const BASE = '/redirect-base/';

let site;
test.before(() => {
  site = buildSiteCopy({
    prefix: 'orbital-redirects-',
    env: { BASE_PATH: BASE },
    edit: (tmp) => {
      fs.writeFileSync(
        path.join(tmp, 'src/redirects.json'),
        JSON.stringify(
          {
            '/transmissions/moved-away/': '/observer/',
            '/log/gone-mission/': '/log/',
          },
          null,
          2,
        ),
      );
    },
  });
});
test.after(() => site?.cleanup());

test('a moved page becomes a meta-refresh page to the based destination, with a based canonical', () => {
  const file = path.join(site.dist, 'transmissions/moved-away/index.html');
  assert.ok(fs.existsSync(file), 'redirect source page should be built');
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /<meta http-equiv="refresh" content="0;url=\/redirect-base\/observer\/"/, 'refresh target must carry the base path');
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.test\/redirect-base\/observer\/"/, 'canonical must be the based, absolute destination');
  assert.match(html, /<meta name="robots" content="noindex"/, 'a redirect stub should not be indexed itself');
});

test('a second redirect in the same map also resolves correctly', () => {
  const html = fs.readFileSync(path.join(site.dist, 'log/gone-mission/index.html'), 'utf8');
  assert.match(html, /<meta http-equiv="refresh" content="0;url=\/redirect-base\/log\/"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.test\/redirect-base\/log\/"/);
});

test('with no redirects.json planted, the default build has no stray redirect stubs', () => {
  const plain = buildSiteCopy({ prefix: 'orbital-redirects-none-', env: { BASE_PATH: BASE } });
  try {
    assert.ok(!fs.existsSync(path.join(plain.dist, 'transmissions/moved-away/index.html')));
  } finally {
    plain.cleanup();
  }
});
