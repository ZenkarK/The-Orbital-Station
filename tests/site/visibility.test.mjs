import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

/* MODEL-07 leakage test. Builds a throwaway copy of the site with one public
   orbit switched to `hidden`, plants canary content in `phase-only` (BODY) and
   the newly-hidden orbit, and asserts none of it survives into dist — while a
   public control canary does. See BACKLOG MODEL-07 and PRD §10.2 item 6. */

const ROOT = path.resolve(import.meta.dirname, '../..');
const SRC = path.join(ROOT, 'src');

/* ---------------------------------------------------------------------
   Guard: content.ts is the only chokepoint allowed to read the raw
   collections. Anything else that called getCollection( directly would
   bypass the visibility filter.
   --------------------------------------------------------------------- */
test('no file in src/ calls getCollection( except lib/content.ts', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(astro|ts|mjs|js)$/.test(entry.name)) continue;
      const rel = path.relative(SRC, p).replace(/\\/g, '/');
      if (rel === 'lib/content.ts') continue;
      const text = fs.readFileSync(p, 'utf8');
      if (text.includes('getCollection(')) offenders.push(rel);
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, [], `getCollection( used outside lib/content.ts: ${offenders.join(', ')}`);
});

/* ---------------------------------------------------------------------
   Full-build leakage test.
   --------------------------------------------------------------------- */

const suffix = crypto.randomBytes(6).toString('hex');
/* One token string per canary, used verbatim as title, slug/filename,
   tag/stack entry, summary/note and body — so any one of those surfacing
   in dist is a leak. */
const T = {
  bodyPost: `canary-bodypost-${suffix}`,
  hiddenPost: `canary-hiddenpost-${suffix}`,
  bodyProject: `canary-bodyproject-${suffix}`,
  hiddenProject: `canary-hiddenproject-${suffix}`,
  bodyLib: `canary-bodylib-${suffix}`,
  hiddenLib: `canary-hiddenlib-${suffix}`,
  bodyTraj: `canary-bodytraj-${suffix}`,
  hiddenTraj: `canary-hiddentraj-${suffix}`,
  publicControl: `canary-publiccontrol-${suffix}`,
  refPost: `canary-refpost-${suffix}`,
  draftProject: `canary-draftproject-${suffix}`,
  draftRefPost: `canary-draftrefpost-${suffix}`,
};
/* Tokens that must never appear anywhere in dist. */
const FORBIDDEN = [
  T.bodyPost,
  T.hiddenPost,
  T.bodyProject,
  T.hiddenProject,
  T.bodyLib,
  T.hiddenLib,
  T.bodyTraj,
  T.hiddenTraj,
  T.draftProject,
];
const DIST_EXT = /\.(html|xml|json|js|txt)$/;

function postFrontmatter(token, orbit, extra = '') {
  return `---\ntitle: ${token} title\ndate: 2026-01-05\nsummary: ${token} summary\norbit: ${orbit}\ntags: [${token}]\n${extra}---\n\n${token} body text.\n`;
}
function projectFrontmatter(token, orbit, extra = '') {
  return `---\ntitle: ${token} title\nsummary: ${token} summary\norbit: ${orbit}\nstack: [${token}]\n${extra}---\n\n${token} brief body.\n`;
}
function libraryEntry(token, orbit) {
  return `- id: ${token}\n  type: BOOK\n  title: ${token} title\n  author: ${token} author\n  orbit: ${orbit}\n  shelf: QUEUE\n  note: ${token} note\n`;
}
function trajectoryEntry(token, orbit) {
  return `- id: ${token}\n  title: ${token} title\n  orbit: ${orbit}\n  horizon: NOW\n  note: ${token} note\n`;
}

function plantCanaries(tmp) {
  const postsDir = path.join(tmp, 'src/content/posts');
  const projDir = path.join(tmp, 'src/content/projects');
  fs.writeFileSync(path.join(postsDir, `${T.bodyPost}.md`), postFrontmatter(T.bodyPost, 'body'));
  fs.writeFileSync(path.join(postsDir, `${T.hiddenPost}.md`), postFrontmatter(T.hiddenPost, 'craft'));
  fs.writeFileSync(path.join(postsDir, `${T.publicControl}.md`), postFrontmatter(T.publicControl, 'astro'));
  fs.writeFileSync(
    path.join(postsDir, `${T.refPost}.md`),
    postFrontmatter(T.refPost, 'astro', `project: ${T.bodyProject}\n`),
  );
  fs.writeFileSync(path.join(projDir, `${T.bodyProject}.md`), projectFrontmatter(T.bodyProject, 'body'));
  fs.writeFileSync(path.join(projDir, `${T.hiddenProject}.md`), projectFrontmatter(T.hiddenProject, 'craft'));
  /* A draft project in an otherwise-public orbit: draft status alone must hide it,
     even from a public post that files itself under it. See PRIV-01/MODEL-07 review
     finding — draft was only ever re-checked via the project's own /log/ page, never
     from a post's "FILED UNDER MISSION" block. */
  fs.writeFileSync(path.join(projDir, `${T.draftProject}.md`), projectFrontmatter(T.draftProject, 'astro', 'draft: true\n'));
  fs.writeFileSync(
    path.join(postsDir, `${T.draftRefPost}.md`),
    postFrontmatter(T.draftRefPost, 'astro', `project: ${T.draftProject}\n`),
  );

  const libPath = path.join(tmp, 'src/content/library.yaml');
  fs.appendFileSync(libPath, `\n${libraryEntry(T.bodyLib, 'body')}\n${libraryEntry(T.hiddenLib, 'craft')}`);

  const trajPath = path.join(tmp, 'src/content/trajectories.yaml');
  fs.appendFileSync(trajPath, `\n${trajectoryEntry(T.bodyTraj, 'body')}\n${trajectoryEntry(T.hiddenTraj, 'craft')}`);
}

/** CRAFT is public in the real config; the copy flips it to `hidden` for this test. */
function hideCraftOrbit(tmp) {
  const configPath = path.join(tmp, 'src/site.config.ts');
  const text = fs.readFileSync(configPath, 'utf8');
  const needle = "folders: ['Cooking', 'Photography'],\n    visibility: 'public',";
  assert.ok(text.includes(needle), 'site.config.ts CRAFT block has moved — update the test fixture');
  fs.writeFileSync(configPath, text.replace(needle, "folders: ['Cooking', 'Photography'],\n    visibility: 'hidden',"));
}

/** Gives the copy its own Astro/Vite caches so it never touches node_modules/.astro or .vite,
    which the symlinked node_modules shares with every other build in this working tree. */
function isolateCaches(tmp) {
  const configPath = path.join(tmp, 'astro.config.mjs');
  const text = fs.readFileSync(configPath, 'utf8');
  const astroCache = JSON.stringify(path.join(tmp, '.astro-cache').replace(/\\/g, '/'));
  const viteCache = JSON.stringify(path.join(tmp, '.vite-cache').replace(/\\/g, '/'));
  let out = text.replace('export default defineConfig({\n  site: SITE_URL,', `export default defineConfig({\n  cacheDir: ${astroCache},\n  site: SITE_URL,`);
  assert.notEqual(out, text, 'astro.config.mjs top level has moved — update the test fixture');
  const before = out;
  out = out.replace('vite: {\n    define: {', `vite: {\n    cacheDir: ${viteCache},\n    define: {`);
  assert.notEqual(out, before, 'astro.config.mjs vite block has moved — update the test fixture');
  fs.writeFileSync(configPath, out);
}

function copySite(tmp) {
  fs.mkdirSync(tmp, { recursive: true });
  fs.cpSync(path.join(ROOT, 'src'), path.join(tmp, 'src'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'public'), path.join(tmp, 'public'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'astro.config.mjs'), path.join(tmp, 'astro.config.mjs'));
  fs.cpSync(path.join(ROOT, 'tsconfig.json'), path.join(tmp, 'tsconfig.json'));
  fs.cpSync(path.join(ROOT, 'package.json'), path.join(tmp, 'package.json'));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), process.platform === 'win32' ? 'junction' : undefined);
}

function scanDist(distDir) {
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      if (!DIST_EXT.test(entry.name)) continue;
      const text = fs.readFileSync(p, 'utf8');
      for (const token of FORBIDDEN) if (text.includes(token)) hits.push({ file: path.relative(distDir, p), token });
    }
  };
  walk(distDir);
  return hits;
}

test('orbit visibility: hidden and phase-only content never reaches dist', { timeout: 300000 }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbital-visibility-'));
  try {
    copySite(tmp);
    hideCraftOrbit(tmp);
    isolateCaches(tmp);
    plantCanaries(tmp);

    execFileSync(process.execPath, [path.join(tmp, 'node_modules/astro/bin/astro.mjs'), 'build'], {
      cwd: tmp,
      stdio: 'pipe',
      timeout: 280000,
      env: { ...process.env, SITE_URL: 'https://example.test' },
    });

    const distDir = path.join(tmp, 'dist');
    const hits = scanDist(distDir);
    assert.deepEqual(hits, [], `leaked canary tokens found in dist: ${JSON.stringify(hits)}`);

    // The hidden orbit (CRAFT) has no page at all.
    assert.ok(!fs.existsSync(path.join(distDir, 'orbits/craft/index.html')), '/orbits/craft/ should not be built');
    // The phase-only orbit (BODY) still has its page, showing phase only.
    const bodyPage = path.join(distDir, 'orbits/body/index.html');
    assert.ok(fs.existsSync(bodyPage), '/orbits/body/ should still be built');
    const bodyHtml = fs.readFileSync(bodyPage, 'utf8');
    assert.match(bodyHtml, /PRIVATE/, "BODY's orbit page should say its logs are private");

    // A public control canary, in an ordinary public orbit, does appear.
    const controlPage = path.join(distDir, 'transmissions', T.publicControl, 'index.html');
    assert.ok(fs.existsSync(controlPage), 'the public control post should be built');
    assert.match(fs.readFileSync(controlPage, 'utf8'), new RegExp(T.publicControl), 'the public control canary should appear on its own page');

    // A public post filed under a phase-only mission must not reveal it.
    const refPage = path.join(distDir, 'transmissions', T.refPost, 'index.html');
    assert.ok(fs.existsSync(refPage), 'the referencing public post should be built');
    const refHtml = fs.readFileSync(refPage, 'utf8');
    assert.doesNotMatch(refHtml, new RegExp(T.bodyProject), "the referencing post must not reveal the phase-only mission's title");
    assert.doesNotMatch(refHtml, /FILED UNDER MISSION/, 'the referencing post must not show a mission link at all');

    // A public post filed under a draft mission (in an otherwise-public orbit) must not reveal it.
    const draftRefPage = path.join(distDir, 'transmissions', T.draftRefPost, 'index.html');
    assert.ok(fs.existsSync(draftRefPage), 'the post referencing a draft mission should still be built');
    const draftRefHtml = fs.readFileSync(draftRefPage, 'utf8');
    assert.doesNotMatch(draftRefHtml, new RegExp(T.draftProject), "the referencing post must not reveal the draft mission's title");
    assert.doesNotMatch(draftRefHtml, /FILED UNDER MISSION/, 'the referencing post must not show a mission link to a draft mission');
    // And the draft mission itself must have no page at all (it's unpublished, not just unlisted).
    assert.ok(!fs.existsSync(path.join(distDir, 'log', T.draftProject, 'index.html')), 'the draft mission should not be built as a page');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
