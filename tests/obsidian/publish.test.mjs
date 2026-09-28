/* End-to-end: vault note → converted page → commit → push, against a throwaway
   copy of the site repo with a real (bare) git remote. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import jsYaml from 'js-yaml';
import sharp from 'sharp';
import { publish } from '../../scripts/obsidian/publish.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let tmp, repo, remote, vault;
const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const note = (rel) => path.join(vault, rel);
const run = (rel, extra = {}) => publish({ _: [note(rel)], vault, repo, json: true, ...extra });
const cli = (rel, extra = {}) => publish({ _: [note(rel)], vault, repo, ...extra }); // human mode: writes results back to the note
const page = (p) => fs.readFileSync(path.join(repo, 'src/content', p, 'index.md'), 'utf8');
const exists = (p) => fs.existsSync(path.join(repo, p));
const writeNote = (rel, text) => {
  fs.mkdirSync(path.dirname(note(rel)), { recursive: true });
  fs.writeFileSync(note(rel), text);
};
/** Parse page frontmatter the way Astro does (js-yaml, default schema). */
const astroFrontmatter = (text) => jsYaml.load(/^---\n([\s\S]*?)\n---/.exec(text)[1]);

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-test-'));
  repo = path.join(tmp, 'site');
  remote = path.join(tmp, 'remote.git');
  vault = path.join(tmp, "Zenkar's Vault"); // apostrophe + space, like the real one
  fs.cpSync(path.join(ROOT, 'tests', 'fixtures', 'vault'), vault, { recursive: true });

  fs.mkdirSync(path.join(repo, 'src', 'content', 'posts'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src', 'content', 'projects'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'src', 'site.config.ts'), path.join(repo, 'src', 'site.config.ts'));
  fs.copyFileSync(path.join(ROOT, 'src', 'content', 'projects', 'helios.md'), path.join(repo, 'src', 'content', 'projects', 'helios.md'));
  fs.writeFileSync(path.join(repo, 'src', 'content', 'posts', 'hand-written.md'), '---\ntitle: Hand written\n---\nMine.\n');
  fs.mkdirSync(path.join(repo, 'src', 'content', 'posts', 'mdx-post'));
  fs.writeFileSync(path.join(repo, 'src', 'content', 'posts', 'mdx-post', 'index.mdx'), '---\ntitle: MDX\n---\nHand-made.\n');
  fs.writeFileSync(path.join(repo, 'unrelated.txt'), 'untouched\n');

  g(tmp, 'init', '--bare', '-b', 'main', remote);
  g(repo, 'init', '-b', 'main');
  g(repo, 'config', 'user.name', 'Test');
  g(repo, 'config', 'user.email', 'test@example.com');
  g(repo, 'config', 'commit.gpgsign', 'false');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-m', 'init');
  g(repo, 'remote', 'add', 'origin', remote);
  g(repo, 'push', '-u', 'origin', 'main');
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('publishes a note: page written, committed, pushed, online', async () => {
  const res = await run('Astrophysics/Island Formula.md');
  assert.equal(res.ok, true);
  assert.equal(res.action, 'published');
  assert.equal(res.committed, true);
  assert.equal(res.pushed, true);
  assert.equal(res.online, true);
  const text = page('posts/island-formula');
  assert.match(text, /^---\n# Published from Obsidian/);
  assert.match(text, /# source-id: [0-9a-f]{12}/);
  assert.equal(astroFrontmatter(text).title, 'Island Formula');
  assert.equal(g(remote, 'log', '-1', '--format=%s'), 'Publish: Island Formula');
});

test('links between published notes resolve; assets are copied; private notes stay private', async () => {
  const res = await run('Astrophysics/Relativistic Jets.md', { 'site-url': 'zenkar.github.io/orbital-station' });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.url, 'https://zenkar.github.io/orbital-station/transmissions/relativistic-jets/');
  const text = page('posts/relativistic-jets');
  assert.match(text, /\[Island Formula\]\(\/transmissions\/island-formula\/\)/);
  assert.match(text, /\[the Page curve section\]\(\/transmissions\/island-formula\/#page-curve\)/);
  assert.doesNotMatch(text, /Secret|private aside|grant budget|This whole block/);
  assert.match(text, /my private notes/); // link text survives, link does not
  assert.match(text, /cover: \.\/jet-diagram\.png/);
  assert.ok(exists('src/content/posts/relativistic-jets/jet-diagram.png'));
  assert.ok(exists('public/files/posts/relativistic-jets/paper.pdf'));
  assert.doesNotMatch(text, /arxiv\.org\/abs\/astro-ph/); // unrelated note properties never leak
  assert.doesNotMatch(text, /private-org|\bphysics\b/); // nor the note's own tags
  assert.ok(res.embeds.length > 0 && res.warnings[0].startsWith('Included the full text'));
  const committed = g(repo, 'show', '--name-only', '--format=', 'HEAD').split('\n');
  assert.ok(committed.every((f) => f.includes('relativistic-jets')), committed.join(', '));
  assert.equal(fs.readFileSync(path.join(repo, 'unrelated.txt'), 'utf8'), 'untouched\n');
});

test('republishing an unchanged note does nothing and reports it online', async () => {
  const head = g(repo, 'rev-parse', 'HEAD');
  const res = await run('Astrophysics/Relativistic Jets.md');
  assert.equal(res.action, 'unchanged');
  assert.equal(res.committed, false);
  assert.equal(res.upToDate, true);
  assert.equal(res.online, true);
  assert.equal(g(repo, 'rev-parse', 'HEAD'), head);
});

test('a changed image counts as a change', async () => {
  // A changed *pixel*, not just a trailing byte: the clean-room step (PRIV-04) truncates
  // anything after IEND as "trailing" data, so appending a stray byte would scrub away to
  // nothing and look unchanged — the published copy is the scrubbed bytes, not the vault's.
  const png = note('attachments/jet diagram.png');
  const original = fs.readFileSync(png);
  const dest = path.join(repo, 'src/content/posts/relativistic-jets/jet-diagram.png');
  const before = fs.readFileSync(dest);
  const modified = await sharp(original).negate().png().toBuffer();
  fs.writeFileSync(png, modified);
  const res = await run('Astrophysics/Relativistic Jets.md');
  assert.equal(res.action, 'updated');
  assert.ok(!fs.readFileSync(dest).equals(before), 'the published image changed');
  fs.writeFileSync(png, original);
  await run('Astrophysics/Relativistic Jets.md');
});

test('the original date is kept on later publishes; edits stamp "updated"', async () => {
  const rel = 'Dated.md';
  writeNote(rel, '---\nstation: post\nstation-orbit: words\n---\nFirst version.\n');
  await run(rel, { date: '2026-01-15' });
  fs.appendFileSync(note(rel), '\nA new closing thought.\n');
  const res = await run(rel); // no date given this time
  assert.equal(res.action, 'updated');
  const fmOut = astroFrontmatter(page('posts/dated'));
  assert.equal(fmOut.date.toISOString().slice(0, 10), '2026-01-15');
  assert.ok(fmOut.updated, 'updated date stamped');
});

test('frontmatter is valid for the site: date-like titles, multi-line summaries, odd tags', async () => {
  writeNote('2026-09-26.md', '---\nstation: post\nstation-orbit: words\nstation-summary: |\n  First sentence.\n  Second: with a colon.\nstation-tags: [2026-01-01, "yes", "c#"]\n---\nA daily note.\n');
  const res = await run('2026-09-26.md', { 'no-commit': true });
  assert.equal(res.ok, true, res.error);
  const fmOut = astroFrontmatter(page('posts/2026-09-26'));
  assert.equal(fmOut.title, '2026-09-26'); // a string, not a Date
  assert.equal(fmOut.summary, 'First sentence. Second: with a colon.');
  assert.deepEqual(fmOut.tags, ['2026-01-01', 'yes', 'c#']);
  assert.ok(fmOut.date instanceof Date);
  fs.rmSync(path.join(repo, 'src/content/posts/2026-09-26'), { recursive: true });
});

test('values js-yaml would misread stay strings', async () => {
  writeNote('0o17.md', '---\nstation: post\nstation-orbit: words\nstation-summary: "null"\nstation-cover-alt: "1e3"\nstation-tags: ["0o17", "off", "~"]\n---\nOctal-looking.\n');
  await run('0o17.md', { 'no-commit': true });
  const fmOut = astroFrontmatter(page('posts/0o17'));
  assert.equal(fmOut.title, '0o17');
  assert.equal(fmOut.summary, 'null');
  assert.deepEqual(fmOut.tags, ['0o17', 'off', '~']);
  fs.rmSync(path.join(repo, 'src/content/posts/0o17'), { recursive: true });
});

test('a renamed note and a copy of it can\'t race for the page', async () => {
  writeNote('Racer.md', '---\nstation: post\nstation-orbit: words\n---\nOriginal.\n');
  await cli('Racer.md'); // records station-slug: racer in the note
  const text = fs.readFileSync(note('Racer.md'), 'utf8');
  fs.renameSync(note('Racer.md'), note('Racer (renamed).md'));
  writeNote('Racer copy.md', text.replace('Original.', 'A different draft.'));
  await assert.rejects(run('Racer copy.md'), /Several notes claim \/transmissions\/racer\//);
  await assert.rejects(run('Racer (renamed).md'), /Several notes claim/);
  assert.match(page('posts/racer'), /Original\./);
  fs.rmSync(note('Racer copy.md')); // resolve the ambiguity → the renamed note adopts its page
  const res = await run('Racer (renamed).md');
  assert.equal(res.ok, true);
});

test('refuses to overwrite hand-written pages (files, folders with index.mdx)', async () => {
  writeNote('Clash.md', '---\nstation: post\nstation-orbit: words\nstation-slug: hand-written\n---\nHi\n');
  await assert.rejects(run('Clash.md'), /hand-written page/);
  writeNote('Clash.md', '---\nstation: post\nstation-orbit: words\nstation-slug: mdx-post\n---\nHi\n');
  await assert.rejects(run('Clash.md'), /hand-written page/);
  assert.ok(exists('src/content/posts/mdx-post/index.mdx'));
});

test('a copied note (same station-* properties) can never take over or move the original\'s page', async () => {
  const original = fs.readFileSync(note('Astrophysics/Island Formula.md'), 'utf8');
  writeNote('Copy of Island Formula.md', original); // carries station-slug + station-published
  await assert.rejects(run('Copy of Island Formula.md'), /Another note is already published/);
  const moved = await run('Copy of Island Formula.md', { slug: 'island-copy', 'no-commit': true });
  assert.equal(moved.action, 'published'); // a new page of its own…
  assert.ok(exists('src/content/posts/island-formula/index.md')); // …and the original is untouched
  await assert.rejects(run('Copy of Island Formula.md', { unpublish: true, slug: 'island-formula' }).then((r) => {
    if (r.removed?.includes('/transmissions/island-formula/')) throw new Error('removed the original');
    throw new Error('ok');
  }), /ok/);
  assert.ok(exists('src/content/posts/island-formula/index.md'));
  fs.rmSync(note('Copy of Island Formula.md'));
});

test('a renamed or moved note keeps (adopts) its page', async () => {
  fs.mkdirSync(note('Archive'), { recursive: true });
  // CLI mode writes station-slug back, as the plugin does
  writeNote('Movable.md', '---\nstation: post\nstation-orbit: words\n---\nI will move.\n');
  await cli('Movable.md');
  fs.renameSync(note('Movable.md'), note('Archive/Movable (renamed).md'));
  const res = await run('Archive/Movable (renamed).md');
  assert.equal(res.ok, true, res.error);
  assert.equal(res.slug, 'movable');
  assert.ok(['updated', 'unchanged'].includes(res.action), res.action);
});

test('changing the address moves the page; changing the type removes the old page', async () => {
  writeNote('Shifty.md', '---\nstation: post\nstation-orbit: astro\n---\nShifting.\n');
  await run('Shifty.md');
  const moved = await run('Shifty.md', { slug: 'shifty-two' });
  assert.equal(moved.action, 'moved');
  assert.ok(!exists('src/content/posts/shifty'));
  assert.ok(exists('src/content/posts/shifty-two/index.md'));
  const asProject = await run('Shifty.md', { type: 'project', slug: 'shifty-two', status: 'ACTIVE' });
  assert.equal(asProject.path, '/log/shifty-two/');
  assert.ok(!exists('src/content/posts/shifty-two'));
  assert.ok(exists('src/content/projects/shifty-two/index.md'));
  const gone = await run('Shifty.md', { unpublish: true });
  assert.deepEqual(gone.removed, ['/log/shifty-two/']);
  assert.equal(g(repo, 'status', '--porcelain', '--', 'src', 'public'), '');
});

test('validates properties with clear messages', async () => {
  writeNote('Bad.md', '---\nstation: post\n---\nx\n');
  await assert.rejects(run('Bad.md'), /Choose an orbit/);
  writeNote('Bad.md', '---\nstation: post\nstation-orbit: pluto\n---\nx\n');
  await assert.rejects(run('Bad.md'), /Unknown orbit "pluto"/);
  writeNote('Bad.md', '---\nstation: post\nstation-orbit: words\nstation-date: someday\n---\nx\n');
  await assert.rejects(run('Bad.md'), /should be a date/);
  writeNote('Bad.md', '---\nstation: [unclosed\n---\nx\n');
  await assert.rejects(run('Bad.md'), /aren't valid YAML/);
  writeNote('Bad.md', '---\nstation: post\nstation-orbit: words\n---\nx\n');
  await assert.rejects(run('Bad.md', { 'site-url': 'not a url at all' }), /isn't a web address/);
});

test("without station-orbit, the note's vault folder picks the orbit; an explicit one still wins", async () => {
  // Health/ is a SENSITIVE_FOLDERS entry (and BODY is phase-only), so both publishes need the
  // guard's deliberate yes — that's PRIV-01/MODEL-07 territory, exercised in gates.test.mjs.
  writeNote('Health/Base Building.md', '---\nstation: post\n---\nZone 2, mostly.\n');
  const res = await run('Health/Base Building.md', { 'no-commit': true, 'confirm-sensitive': true });
  assert.equal(res.ok, true, res.error);
  assert.equal(astroFrontmatter(page('posts/base-building')).orbit, 'body');
  writeNote('Health/Chosen.md', '---\nstation: post\nstation-orbit: words\n---\nx\n');
  await run('Health/Chosen.md', { 'no-commit': true, 'confirm-sensitive': true });
  assert.equal(astroFrontmatter(page('posts/chosen')).orbit, 'words');
  for (const slug of ['base-building', 'chosen']) fs.rmSync(path.join(repo, 'src/content/posts', slug), { recursive: true });
});

test('hand-typed values are read case-insensitively', async () => {
  writeNote('Rover.md', '---\nstation: Project\nstation-orbit: Astro\nstation-status: active\n---\nA rover.\n');
  const res = await run('Rover.md', { 'no-commit': true });
  assert.equal(res.path, '/log/rover/');
  assert.match(page('projects/rover'), /status: ACTIVE/);
});

test('slugs cannot escape the content folder', async () => {
  writeNote('Escape.md', '---\nstation: post\nstation-orbit: words\nstation-slug: ../../../evil\n---\nx\n');
  const res = await run('Escape.md', { 'no-commit': true });
  assert.equal(res.slug, 'evil');
  assert.ok(exists('src/content/posts/evil/index.md'));
  fs.rmSync(path.join(repo, 'src/content/posts/evil'), { recursive: true });
});

test('projects publish to the Flight Log', async () => {
  writeNote(
    'Dark Sky Tracker.md',
    '---\nstation: project\nstation-orbit: astro\nstation-status: ACTIVE\nstation-stack: [Arduino, Python 3.12]\nstation-repo: https://github.com/x/tracker\nstation-demo: not a url\n---\n## Objective\n\nTrack the sky.\n',
  );
  const res = await run('Dark Sky Tracker.md');
  assert.equal(res.ok, true);
  const fmOut = astroFrontmatter(page('projects/dark-sky-tracker'));
  assert.deepEqual(fmOut.stack, ['Arduino', 'Python 3.12']);
  assert.equal(fmOut.repo, 'https://github.com/x/tracker');
  assert.equal(fmOut.demo, undefined);
  assert.ok(res.warnings.some((w) => w.includes('station-demo')));
});

test('the CLI records the result in the note; the note\'s other properties are preserved', async () => {
  writeNote('Recorded.md', '---\n# my comment\ntags: [journal]\nurl: https://arxiv.org/abs/1\nstation: post\nstation-orbit: words\n---\nBody.\n');
  const res = await cli('Recorded.md', { 'site-url': 'https://zenkar.dev' });
  assert.equal(res.online, true);
  const text = fs.readFileSync(note('Recorded.md'), 'utf8');
  assert.match(text, /# my comment/);
  assert.match(text, /url: https:\/\/arxiv\.org\/abs\/1/);
  assert.match(text, /station-slug: recorded/);
  assert.match(text, /station-published: \d{4}-\d{2}-\d{2}/);
  assert.match(text, /station-url: https:\/\/zenkar\.dev\/transmissions\/recorded\//);
  assert.match(text, /---\nBody\.\n$/);
});

test('a push that failed earlier is pushed on the next attempt', async () => {
  g(repo, 'remote', 'set-url', 'origin', path.join(tmp, 'missing.git'));
  writeNote('Retry.md', '---\nstation: post\nstation-orbit: words\n---\nRetry me.\n');
  const failed = await run('Retry.md');
  assert.equal(failed.committed, true);
  assert.equal(failed.pushed, false);
  assert.equal(failed.online, false);
  assert.match(failed.error, /Push failed/);
  g(repo, 'remote', 'set-url', 'origin', remote);
  const retry = await run('Retry.md');
  assert.equal(retry.action, 'unchanged');
  assert.equal(retry.pushed, true);
  assert.equal(retry.online, true);
  assert.equal(g(remote, 'log', '-1', '--format=%s'), 'Publish: Retry');
});

test('a rejected push with other uncommitted work refuses to rebase and leaves that work alone', async () => {
  const other = path.join(tmp, 'other');
  g(tmp, 'clone', remote, other);
  g(other, 'config', 'user.name', 'Other');
  g(other, 'config', 'user.email', 'o@example.com');
  fs.writeFileSync(path.join(other, 'unrelated.txt'), 'edited on GitHub\n');
  g(other, 'add', '-A');
  g(other, 'commit', '-m', 'web edit');
  g(other, 'push', 'origin', 'main');

  fs.writeFileSync(path.join(repo, 'unrelated.txt'), 'my local edit\n'); // uncommitted, same file
  fs.appendFileSync(note('Astrophysics/Island Formula.md'), '\nMore on islands.\n');
  const res = await run('Astrophysics/Island Formula.md');
  assert.equal(res.committed, true);
  assert.equal(res.pushed, false);
  assert.match(res.error, /uncommitted edits \(unrelated\.txt\)/);
  assert.equal(fs.readFileSync(path.join(repo, 'unrelated.txt'), 'utf8'), 'my local edit\n');
  assert.doesNotMatch(g(repo, 'status', '--porcelain'), /^UU/m);
  assert.equal(g(repo, 'stash', 'list'), '');

  g(repo, 'checkout', '--', 'unrelated.txt'); // discard the local edit → now it can sync
  const retry = await run('Astrophysics/Island Formula.md');
  assert.equal(retry.pushed, true, retry.error);
  assert.deepEqual(g(remote, 'log', '-2', '--format=%s').split('\n'), ['Update: Island Formula', 'web edit']);
  g(repo, 'pull', '--ff-only', 'origin', 'main');
});

test('your own unpushed commits are never pushed as a side effect', async () => {
  fs.writeFileSync(path.join(repo, 'unrelated.txt'), 'half-done redesign\n');
  g(repo, 'commit', '-am', 'WIP: half-done redesign');
  const remoteHead = g(remote, 'rev-parse', 'main');
  writeNote('Innocent.md', '---\nstation: post\nstation-orbit: words\n---\nJust a note.\n');
  const res = await run('Innocent.md');
  assert.equal(res.committed, true);
  assert.equal(res.pushed, false);
  assert.match(res.error, /other commits that aren't online yet \("WIP: half-done redesign"\)/);
  await assert.rejects(run('Private/Secret Note.md', { unpublish: true }), /Nothing from this note is published/);
  assert.equal(g(remote, 'rev-parse', 'main'), remoteHead);
  g(repo, 'push', 'origin', 'main'); // the user pushes their work when it's ready…
  const retry = await run('Innocent.md'); // …and the waiting page goes out with the next publish
  assert.equal(retry.online, true);
});

test('publishing from another branch commits but warns it will not go live', async () => {
  g(repo, 'checkout', '-b', 'drafts');
  writeNote('Branchy.md', '---\nstation: post\nstation-orbit: words\n---\nOn a branch.\n');
  const res = await run('Branchy.md');
  assert.equal(res.pushed, true);
  assert.equal(res.online, false);
  assert.ok(res.warnings.some((w) => w.includes('only deploys from main')));
  g(repo, 'checkout', 'main');
});

test('unpublish removes the page and pushes the removal', async () => {
  const res = await run('Astrophysics/Relativistic Jets.md', { unpublish: true });
  assert.equal(res.action, 'unpublished');
  assert.equal(res.pushed, true, JSON.stringify({ error: res.error, note: res.note, branch: res.branch }));
  assert.ok(!exists('src/content/posts/relativistic-jets'));
  assert.equal(g(remote, 'log', '-1', '--format=%s'), 'Unpublish: Relativistic Jets');
  await assert.rejects(run('Astrophysics/Relativistic Jets.md', { unpublish: true }), /Nothing from this note is published/);
});

test('without a remote, pages are committed locally with a hint', async () => {
  g(repo, 'remote', 'remove', 'origin');
  const res = await run('Astrophysics/Relativistic Jets.md');
  assert.equal(res.committed, true);
  assert.equal(res.pushed, false);
  assert.equal(res.remote, false);
  assert.match(res.note, /Going live/);
  g(repo, 'remote', 'add', 'origin', remote);
});

test('dry run changes nothing', async () => {
  const head = g(repo, 'rev-parse', 'HEAD');
  const res = await run('Notes/Snippets.md', { 'dry-run': true, orbit: 'words' });
  assert.equal(res.dryRun, true);
  assert.match(res.markdown, /## Useful result/);
  assert.ok(!exists('src/content/posts/snippets'));
  assert.equal(g(repo, 'rev-parse', 'HEAD'), head);
});

test('install.mjs keeps other plugins and settings, tolerates a BOM, refuses unreadable files', () => {
  const v = path.join(tmp, 'install-vault');
  fs.mkdirSync(path.join(v, '.obsidian', 'plugins', 'orbital-station-publisher'), { recursive: true });
  fs.writeFileSync(path.join(v, '.obsidian', 'community-plugins.json'), '﻿["dataview","templater-obsidian"]');
  fs.writeFileSync(path.join(v, '.obsidian', 'plugins', 'orbital-station-publisher', 'data.json'), '﻿{"push":false,"siteUrl":"https://zenkar.dev/"}');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'obsidian', 'install.mjs'), v], {
    encoding: 'utf8',
    env: { ...process.env, ORBITAL_OBSIDIAN_RUNNING: '0' }, // pinned: assertions below assume Obsidian is closed
  });
  const data = JSON.parse(fs.readFileSync(path.join(v, '.obsidian', 'plugins', 'orbital-station-publisher', 'data.json'), 'utf8'));
  assert.equal(data.push, false);
  assert.equal(data.siteUrl, 'https://zenkar.dev/');
  assert.equal(data.repoPath, ROOT);
  const list = JSON.parse(fs.readFileSync(path.join(v, '.obsidian', 'community-plugins.json'), 'utf8'));
  assert.ok(list.includes('dataview') && list.includes('templater-obsidian'));

  fs.writeFileSync(path.join(v, '.obsidian', 'community-plugins.json'), '{broken');
  assert.throws(() => execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'obsidian', 'install.mjs'), v], {
    stdio: 'pipe',
    env: { ...process.env, ORBITAL_OBSIDIAN_RUNNING: '0' },
  }));
  assert.equal(fs.readFileSync(path.join(v, '.obsidian', 'community-plugins.json'), 'utf8'), '{broken');
});

test('install.mjs leaves community-plugins.json untouched and tells you what to click when Obsidian is running', () => {
  const v = path.join(tmp, 'install-vault-running');
  fs.mkdirSync(path.join(v, '.obsidian', 'plugins', 'orbital-station-publisher'), { recursive: true });
  fs.writeFileSync(path.join(v, '.obsidian', 'community-plugins.json'), '["dataview"]');
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'obsidian', 'install.mjs'), v], {
    encoding: 'utf8',
    env: { ...process.env, ORBITAL_OBSIDIAN_RUNNING: '1' }, // pinned: assertions below assume Obsidian is open
  });
  const list = JSON.parse(fs.readFileSync(path.join(v, '.obsidian', 'community-plugins.json'), 'utf8'));
  assert.deepEqual(list, ['dataview']); // not enabled while Obsidian is running
  assert.match(out, /Settings.*Community plugins/s);
});
