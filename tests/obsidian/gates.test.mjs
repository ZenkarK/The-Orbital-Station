/* =============================================================
   M0 "Ignition" gates, wired into the publisher:
     PRIV-01  sensitive-area guard
     MODEL-07 confirmation for non-public orbits (publisher half)
     PRIV-03  secret scanning (publisher gate)
     PRIV-04  clean-room attachments (publisher gate)
   plus the size gate (§10.2 / PRIV-04's "GitHub itself would reject it").

   Against a throwaway vault + site repo + bare remote (never the real
   vault or the real site repo) — see tests/helpers/publish-fixtures.mjs.
   Planted "secrets" here are fake values built at runtime by
   concatenation; none of them are real credentials.
   ============================================================= */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { publish, sizeCheck, MAX_ATTACHMENT_BYTES, WARN_ATTACHMENT_BYTES } from '../../scripts/obsidian/publish.mjs';
import { fingerprintOf } from '../../scripts/obsidian/secrets.mjs';
import { sensitiveFolderFor, orbitForNote } from '../../scripts/obsidian/site.mjs';
import { inspect as scrubInspect } from '../../scripts/obsidian/scrub/index.mjs';
import { setupTestRepo, withOrbitVisibility, ROOT, g } from '../helpers/publish-fixtures.mjs';
import { jpegWithExif } from '../helpers/image-fixtures.mjs';
import { buildHeicStub } from '../helpers/av-fixtures.mjs';

const PUBLISH_MJS = path.join(ROOT, 'scripts', 'obsidian', 'publish.mjs');

let main; // shared repo for most of these tests
let hidden; // a repo whose site.config.ts has one orbit patched to `hidden`, for that one test

before(() => {
  main = setupTestRepo();
  hidden = setupTestRepo({ siteConfig: withOrbitVisibility('growth', 'hidden') });
});

after(() => {
  fs.rmSync(main.tmp, { recursive: true, force: true });
  fs.rmSync(hidden.tmp, { recursive: true, force: true });
});

const run = (rel, extra = {}) => publish({ _: [main.note(rel)], vault: main.vault, repo: main.repo, json: true, ...extra });
const runHidden = (rel, extra = {}) => publish({ _: [hidden.note(rel)], vault: hidden.vault, repo: hidden.repo, json: true, ...extra });

/* ---------------------------------------------------------------- secrets (PRIV-03) */

test('a planted secret blocks a real publish, naming the note and the line; nothing is written or committed', async () => {
  const key = `AKIA${'Q'.repeat(16)}`; // matches the AWS-access-key-id rule; built here, never a real key
  main.writeNote('Notes/Keyed.md', `---\nstation: post\nstation-orbit: words\n---\nIntro line.\n\nAWS key: ${key}\n`);
  const head = g(main.repo, 'rev-parse', 'HEAD');

  await assert.rejects(run('Notes/Keyed.md'), (err) => {
    assert.match(err.message, /Notes\/Keyed\.md/);
    assert.match(err.message, /line 7/);
    return true;
  });
  assert.equal(g(main.repo, 'rev-parse', 'HEAD'), head);
  assert.ok(!main.exists('src/content/posts/keyed'));
});

test('dry run lists the planted secret in both secrets and blocked, and writes nothing', async () => {
  const res = await run('Notes/Keyed.md', { 'dry-run': true });
  assert.equal(res.dryRun, true);
  const found = res.secrets.find((f) => f.rule === 'aws-access-key-id');
  assert.ok(found, JSON.stringify(res.secrets));
  assert.equal(found.file, 'Notes/Keyed.md');
  assert.equal(found.line, 7);
  assert.ok(!found.preview.includes('QQQQQQQQQQQQQQQQ')); // redacted, never the real value
  assert.ok(res.blocked.some((b) => b.includes('Notes/Keyed.md') && b.includes('line 7')));
  assert.ok(!main.exists('src/content/posts/keyed'));
});

test('an allow-listed fingerprint lets the same note publish', async () => {
  const key = `AKIA${'Q'.repeat(16)}`;
  const allow = path.join(main.repo, '.secrets-allow');
  fs.writeFileSync(allow, `${fingerprintOf(key)} # test-only key, not real\n`);
  try {
    const res = await run('Notes/Keyed.md');
    assert.equal(res.ok, true, res.error);
    assert.deepEqual(res.secrets, []);
    assert.deepEqual(res.blocked, []);
  } finally {
    fs.rmSync(allow);
    await run('Notes/Keyed.md', { unpublish: true }); // leave the repo clean for later tests
  }
});

test('a secret only inside a %% comment %% is stripped by the converter, so it never blocks', async () => {
  const key = `AKIA${'W'.repeat(16)}`;
  main.writeNote('Notes/CommentedSecret.md', `---\nstation: post\nstation-orbit: words\n---\nVisible text.\n\n%%\nAWS key: ${key}\n%%\n`);
  const res = await run('Notes/CommentedSecret.md', { 'dry-run': true });
  assert.deepEqual(res.secrets, []);
  assert.deepEqual(res.blocked, []);
});

test('a secret inside an embedded note is blocked and named against that note, not the page', async () => {
  const key = `AKIA${'E'.repeat(16)}`;
  main.writeNote('Notes/HasSecret.md', `Shared reference text.\n\nAWS key: ${key}\n`);
  main.writeNote('Notes/EmbedsSecret.md', '---\nstation: post\nstation-orbit: words\n---\nPublic intro.\n\n![[HasSecret]]\n');
  await assert.rejects(run('Notes/EmbedsSecret.md'), (err) => {
    assert.match(err.message, /Notes\/HasSecret\.md/);
    assert.match(err.message, /line 3/);
    return true;
  });
  assert.ok(!main.exists('src/content/posts/embedssecret'));
});

test('a secret inside a copied .txt attachment is blocked', async () => {
  const key = `AKIA${'T'.repeat(16)}`;
  main.writeNote('Notes/secret.txt', `token ${key}\n`);
  main.writeNote('Notes/EmbedsTxtSecret.md', '---\nstation: post\nstation-orbit: words\n---\nHas an attachment.\n\n![[secret.txt]]\n');
  await assert.rejects(run('Notes/EmbedsTxtSecret.md'), (err) => {
    assert.match(err.message, /secret\.txt/);
    return true;
  });
  const res = await run('Notes/EmbedsTxtSecret.md', { 'dry-run': true });
  assert.ok(res.secrets.some((f) => f.file === 'Notes/secret.txt'));
});

test('a secret inside a .txt attachment saved as UTF-16 (e.g. Windows Notepad "Unicode") is never silently published, even with --allow-metadata', async () => {
  const key = `AKIA${'U'.repeat(16)}`; // fake, built at runtime, matches the aws-access-key-id rule
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`token ${key}\n`, 'utf16le')]);
  fs.mkdirSync(path.dirname(main.note('Notes/secret16.txt')), { recursive: true });
  fs.writeFileSync(main.note('Notes/secret16.txt'), utf16);
  main.writeNote('Notes/EmbedsTxt16Secret.md', '---\nstation: post\nstation-orbit: words\n---\nHas a UTF-16 attachment.\n\n![[secret16.txt]]\n');

  // by default the clean-room step can't verify a non-UTF-8 ".txt" as text, so it's blocked outright
  await assert.rejects(run('Notes/EmbedsTxt16Secret.md'), (err) => {
    assert.match(err.message, /secret16\.txt/);
    return true;
  });
  assert.ok(!main.exists('src/content/posts/embedstxt16secret'));

  // --allow-metadata forces the raw bytes through the clean-room step ("unscrubbed") — the
  // secret scanner must still catch the planted secret in them, not let it ship unnoticed
  const dry = await run('Notes/EmbedsTxt16Secret.md', { 'dry-run': true, 'allow-metadata': true });
  assert.ok(dry.secrets.some((f) => f.file === 'Notes/secret16.txt'), JSON.stringify(dry.secrets));
  await assert.rejects(run('Notes/EmbedsTxt16Secret.md', { 'allow-metadata': true }), (err) => {
    assert.match(err.message, /secret16\.txt/);
    return true;
  });
  assert.ok(!main.exists('src/content/posts/embedstxt16secret'));
});

/* ---------------------------------------------------------------- sensitive-folder matching robustness */

test('sensitiveFolderFor and orbitForNote match a folder even with a trailing space on either side', () => {
  // Windows lets a folder end in a space (a sync client, a mobile Obsidian client, or a stray
  // keystroke while renaming can all produce one) — fs.readdirSync, which the publisher itself
  // uses to walk the vault, hands it back exactly as-is.
  assert.equal(sensitiveFolderFor('Health /Diary.md', ['Health']), 'Health');
  assert.equal(orbitForNote('Health /Diary.md', [{ id: 'body', folders: ['Health'] }]), 'body');
  // and the other way around: a trailing space in the configured name itself
  assert.equal(sensitiveFolderFor('Health/Diary.md', ['Health ']), 'Health ');
  assert.equal(orbitForNote('Health/Diary.md', [{ id: 'body', folders: ['Health '] }]), 'body');
  // a folder that merely starts with the same letters is still correctly rejected
  assert.equal(sensitiveFolderFor('Healthcare /Billing.md', ['Health']), null);
});

test('a note in a sensitive folder with a trailing space still needs a deliberate yes (PRIV-01 is not fooled by stray whitespace)', async () => {
  fs.mkdirSync(path.dirname(main.note('Health /Diary.md')), { recursive: true });
  fs.writeFileSync(main.note('Health /Diary.md'), '---\nstation: post\n---\nPrivate health diary entry: my cholesterol is 240.\n');
  // confirm the trailing-space folder really exists on disk as its own, distinct entry
  assert.ok(fs.readdirSync(main.vault).includes('Health '), fs.readdirSync(main.vault).join(', '));

  await assert.rejects(run('Health /Diary.md'), /sensitive "Health" folder/);
  assert.ok(!main.exists('src/content/posts/diary'));
  const res = await run('Health /Diary.md', { 'confirm-sensitive': true });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.guard.confirm, true);
  assert.equal(res.guard.confirmed, true);
  await run('Health /Diary.md', { unpublish: true }); // leave the repo clean for later tests
});

/* ---------------------------------------------------------------- sensitive-area guard (PRIV-01) + orbit visibility (MODEL-07) */

test('a note in a sensitive folder needs a deliberate yes; --confirm-sensitive gives it', async () => {
  await assert.rejects(run('Work/Confidential.md'), /sensitive "Work" folder/);
  assert.ok(!main.exists('src/content/posts/confidential'));
  const res = await run('Work/Confidential.md', { 'confirm-sensitive': true });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.guard.confirm, true);
  assert.equal(res.guard.confirmed, true);
});

test('dry run reports the guard (confirm + reasons) without needing confirmation itself', async () => {
  const res = await run('Work/Confidential.md', { 'dry-run': true });
  assert.equal(res.dryRun, true);
  assert.equal(res.guard.confirm, true);
  assert.equal(res.guard.confirmed, false);
  assert.ok(res.guard.reasons.some((r) => r.includes('Work')));
});

test('a public note embedding a note from a sensitive folder needs a yes', async () => {
  const res = await run('Astrophysics/Embeds Vitals.md', { 'dry-run': true });
  assert.equal(res.guard.confirm, true);
  assert.ok(res.guard.reasons.some((r) => r.includes('Health') && r.includes('Vitals')));
});

test('an attachment copied from a sensitive folder needs a yes', async () => {
  fs.mkdirSync(path.dirname(main.note('Finance/statement.png')), { recursive: true });
  fs.copyFileSync(main.note('attachments/jet diagram.png'), main.note('Finance/statement.png'));
  main.writeNote('Notes/EmbedsFinance.md', '---\nstation: post\nstation-orbit: words\n---\nHas a chart.\n\n![[statement.png]]\n');
  const res = await run('Notes/EmbedsFinance.md', { 'dry-run': true });
  assert.equal(res.guard.confirm, true);
  assert.ok(res.guard.reasons.some((r) => r.includes('Finance')));
});

test('publishing into a phase-only orbit needs a yes', async () => {
  const res = await run('Astrophysics/Body Orbit.md', { 'dry-run': true });
  assert.equal(res.guard.confirm, true);
  assert.ok(res.guard.reasons.some((r) => r.includes('BODY is phase-only')));
});

test('publishing into a hidden orbit needs a yes', async () => {
  hidden.writeNote('Astrophysics/Hidden Target.md', '---\nstation: post\nstation-orbit: growth\n---\nAiming at a hidden orbit.\n');
  const res = await runHidden('Astrophysics/Hidden Target.md', { 'dry-run': true });
  assert.equal(res.guard.confirm, true);
  assert.ok(res.guard.reasons.some((r) => r.includes('GROWTH is hidden')));
});

test('unpublishing a sensitive note never needs confirmation', async () => {
  const res = await run('Work/Confidential.md', { unpublish: true });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.action, 'unpublished');
});

/* ---------------------------------------------------------------- clean-room attachments (PRIV-04) */

test('a JPEG with planted GPS/author publishes with the metadata gone (categories only, never values, in the dry-run report)', async () => {
  fs.writeFileSync(main.note('Astrophysics/photo.jpg'), await jpegWithExif());
  main.writeNote('Astrophysics/HasPhoto.md', '---\nstation: post\nstation-orbit: astro\n---\nA photo.\n\n![[photo.jpg]]\n');

  const dry = await run('Astrophysics/HasPhoto.md', { 'dry-run': true });
  const entry = dry.media.find((m) => m.file.endsWith('photo.jpg'));
  assert.ok(entry, JSON.stringify(dry.media));
  assert.equal(entry.kind, 'scrubbed');
  assert.ok(entry.removed.some((r) => /location|GPS/i.test(r)));
  assert.ok(entry.removed.some((r) => /author/i.test(r)));
  for (const r of entry.removed) assert.doesNotMatch(r, /Test Author|TestMake|TestModel|0\/1/); // labels, never the planted values
  assert.deepEqual(dry.blocked, []);

  const res = await run('Astrophysics/HasPhoto.md');
  assert.equal(res.ok, true, res.error);
  const destBuf = fs.readFileSync(path.join(main.repo, 'src/content/posts/hasphoto/photo.jpg'));

  const inspected = await scrubInspect(destBuf, { name: 'photo.jpg' });
  assert.equal(inspected.ok, true);
  assert.deepEqual(inspected.categories, []);

  // sharp keeps Orientation on purpose (jpeg.mjs never classifies it — a real camera photo
  // would look sideways without it), so a little EXIF can remain; GPS/author/device may not.
  // inspect() above is the authoritative "nothing privacy-relevant is left" check; this is a
  // second, independent one: a from-scratch decode of the published bytes has no GPS IFD data,
  // and the EXIF blob that's left is orientation-sized, not the original's GPS+author+device one.
  const meta = await sharp(destBuf).metadata();
  const original = await sharp(await jpegWithExif()).metadata();
  assert.ok(!meta.exif || meta.exif.length < original.exif.length / 4, `exif shrank from ${original.exif.length} to ${meta.exif?.length ?? 0} bytes`);
});

test('republishing the same photo again reports "unchanged"', async () => {
  const res = await run('Astrophysics/HasPhoto.md');
  assert.equal(res.action, 'unchanged');
  assert.equal(res.committed, false);
});

test('an unknown binary type is blocked; --allow-metadata copies it through unchanged, with a warning', async () => {
  const bytes = crypto.randomBytes(32);
  fs.writeFileSync(main.note('Notes/mystery.xyz'), bytes);
  main.writeNote('Notes/EmbedsMystery.md', '---\nstation: post\nstation-orbit: words\n---\nAn unknown file.\n\n![[mystery.xyz]]\n');

  await assert.rejects(run('Notes/EmbedsMystery.md'), /mystery\.xyz/);
  assert.ok(!main.exists('src/content/posts/embedsmystery'));

  const res = await run('Notes/EmbedsMystery.md', { 'allow-metadata': true });
  assert.equal(res.ok, true, res.error);
  assert.ok(res.warnings.some((w) => w.includes('mystery.xyz') && w.includes('--allow-metadata')));
  const media = res.media.find((m) => m.file.endsWith('mystery.xyz'));
  assert.equal(media.kind, 'unscrubbed');
  const destRel = res.files.find((f) => f.endsWith('mystery.xyz'));
  assert.ok(fs.readFileSync(path.join(main.repo, destRel)).equals(bytes));
});

test('a HEIC file is blocked when no external tool is available (ORBITAL_SCRUB_TOOLS=none)', async () => {
  const prior = process.env.ORBITAL_SCRUB_TOOLS;
  process.env.ORBITAL_SCRUB_TOOLS = 'none';
  try {
    fs.writeFileSync(main.note('Notes/photo.heic'), buildHeicStub());
    main.writeNote('Notes/EmbedsHeic.md', '---\nstation: post\nstation-orbit: words\n---\nA HEIC photo.\n\n![[photo.heic]]\n');
    const dry = await run('Notes/EmbedsHeic.md', { 'dry-run': true });
    assert.ok(dry.blocked.some((b) => b.includes('photo.heic')));
    await assert.rejects(run('Notes/EmbedsHeic.md'), /photo\.heic/);
  } finally {
    if (prior === undefined) delete process.env.ORBITAL_SCRUB_TOOLS;
    else process.env.ORBITAL_SCRUB_TOOLS = prior;
  }
});

/* ---------------------------------------------------------------- size gate */

test('sizeCheck blocks at the GitHub limit and warns below it — no huge fixture files needed', () => {
  assert.ok(sizeCheck('x.mp4', MAX_ATTACHMENT_BYTES).blocked);
  assert.ok(sizeCheck('x.mp4', MAX_ATTACHMENT_BYTES + 1).blocked);
  assert.equal(sizeCheck('x.mp4', MAX_ATTACHMENT_BYTES - 1).blocked, undefined);
  assert.ok(sizeCheck('x.mp4', WARN_ATTACHMENT_BYTES).warning);
  assert.equal(sizeCheck('x.mp4', WARN_ATTACHMENT_BYTES - 1).warning, undefined);
  assert.deepEqual(sizeCheck('x.mp4', 1024), {});
});

/* ---------------------------------------------------------------- --describe */

test('--describe reports SENSITIVE_FOLDERS and each orbit\'s visibility', () => {
  const r = spawnSync(process.execPath, [PUBLISH_MJS, '--describe', '--json', '--repo', main.repo], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const desc = JSON.parse(r.stdout);
  assert.deepEqual(desc.sensitiveFolders, ['Work', 'Finance', 'Health', 'Family and Friends']);
  assert.equal(desc.orbits.find((o) => o.id === 'body').visibility, 'phase-only');
  assert.equal(desc.orbits.find((o) => o.id === 'astro').visibility, 'public');
});

/* ---------------------------------------------------------------- human (non --json) CLI output */

test('the CLI (human mode) prints the guard reasons and a "Clean room" line per attachment on a dry run', () => {
  const r = spawnSync(process.execPath, [PUBLISH_MJS, main.note('Astrophysics/HasPhoto.md'), '--vault', main.vault, '--repo', main.repo, '--dry-run'], {
    encoding: 'utf8',
  });
  const out = `${r.stdout}\n${r.stderr}`;
  assert.match(out, /Clean room: "Astrophysics[\\/]photo\.jpg"/);
});

test('the CLI (human mode) prints the guard reasons for a sensitive folder on a dry run', () => {
  const r = spawnSync(process.execPath, [PUBLISH_MJS, main.note('Work/Confidential.md'), '--vault', main.vault, '--repo', main.repo, '--dry-run'], {
    encoding: 'utf8',
  });
  const out = `${r.stdout}\n${r.stderr}`;
  assert.match(out, /sensitive "Work" folder/);
});
