// CI media scan (PRIV-04) — scripts/scan-media.mjs, run behind `npm run scan:media`.
// Exercises the CLI as a subprocess, the same way it runs in CI, against runtime-built
// fixtures and a throwaway git repo (never this repo's own history or files).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import * as F from '../helpers/image-fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'scripts', 'scan-media.mjs');

/** Runs the CLI with `cwd` as its "repo". Never throws — status/stdout come back either way. */
function spawnCli(args, cwd) {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
    return { status: 0, stdout };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '' };
  }
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('a JPEG with GPS EXIF fails the scan, naming the file and "location (GPS)"', async () => {
  const tmp = mkTmp('oss-media-jpeg-');
  try {
    const file = path.join(tmp, 'photo.jpg');
    fs.writeFileSync(file, await F.jpegWithExif());
    const res = spawnCli([file], tmp);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /photo\.jpg/);
    assert.match(res.stdout, /location \(GPS\)/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a clean PNG passes with exit 0', async () => {
  const tmp = mkTmp('oss-media-png-');
  try {
    const file = path.join(tmp, 'plain.png');
    fs.writeFileSync(file, await F.plainPng());
    const res = spawnCli([file], tmp);
    assert.equal(res.status, 0);
    assert.doesNotMatch(res.stdout, /plain\.png:/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('an unknown binary type fails with its reason, not a crash', async () => {
  const tmp = mkTmp('oss-media-unknown-');
  try {
    const file = path.join(tmp, 'mystery.bin');
    fs.writeFileSync(file, Buffer.from([0, 1, 2, 3, 0xff, 0xfe, 0, 1, 2, 3]));
    const res = spawnCli([file], tmp);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /mystery\.bin/);
    assert.match(res.stdout, /unsupported/i);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a JPEG with GPS EXIF renamed to .txt still fails the scan (extension alone must not grant a text pass)', async () => {
  const tmp = mkTmp('oss-media-fake-text-');
  try {
    const file = path.join(tmp, 'gps-photo.txt');
    fs.writeFileSync(file, await F.jpegWithExif());
    const res = spawnCli([file], tmp);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /gps-photo\.txt/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('plain text files are ignored entirely', () => {
  const tmp = mkTmp('oss-media-text-');
  try {
    const file = path.join(tmp, 'notes.txt');
    fs.writeFileSync(file, 'Just some plain notes.\n');
    const res = spawnCli([file], tmp);
    assert.equal(res.status, 0);
    assert.doesNotMatch(res.stdout, /notes\.txt/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('fonts and .ico are skipped, not failed', () => {
  const tmp = mkTmp('oss-media-fonts-');
  try {
    const files = ['a.woff', 'a.woff2', 'a.ttf', 'a.otf', 'a.ico'].map((name) => {
      const p = path.join(tmp, name);
      fs.writeFileSync(p, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
      return p;
    });
    const res = spawnCli(['--json', ...files], tmp);
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.equal(out.problems.length, 0);
    assert.equal(out.skipped.length, 5);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('--fix cleans the JPEG in place and a re-scan then exits 0', async () => {
  const tmp = mkTmp('oss-media-fix-');
  try {
    const file = path.join(tmp, 'photo.jpg');
    const dirty = await F.jpegWithExif();
    fs.writeFileSync(file, dirty);

    const fixRes = spawnCli(['--fix', file], tmp);
    assert.equal(fixRes.status, 0);
    assert.match(fixRes.stdout, /fixed: /);

    const cleaned = fs.readFileSync(file);
    assert.notDeepEqual(cleaned, dirty, 'file on disk should have been rewritten');
    // Invisible: decoded pixels are unchanged.
    const before = await sharp(dirty).raw().toBuffer();
    const after = await sharp(cleaned).raw().toBuffer();
    assert.deepEqual(after, before);

    const rescan = spawnCli([file], tmp);
    assert.equal(rescan.status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('default mode (no paths given) scans what git tracks under public/ and src/content/', async () => {
  const tmp = mkTmp('oss-media-repo-');
  try {
    execFileSync('git', ['init', '-q'], { cwd: tmp });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: tmp });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmp });

    fs.mkdirSync(path.join(tmp, 'public'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src', 'content'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'untracked-dir'), { recursive: true });

    // Tracked and clean: should not appear.
    fs.writeFileSync(path.join(tmp, 'public', 'clean.png'), await F.plainPng());
    // Tracked and dirty: should be flagged.
    fs.writeFileSync(path.join(tmp, 'src', 'content', 'dirty.jpg'), await F.jpegWithExif());
    // Outside the scanned dirs: dirty, but should be left alone.
    fs.writeFileSync(path.join(tmp, 'untracked-dir', 'other.jpg'), await F.jpegWithExif());

    execFileSync('git', ['add', 'public', 'src'], { cwd: tmp });

    const res = spawnCli(['--json'], tmp);
    assert.equal(res.status, 1);
    const out = JSON.parse(res.stdout);
    const flagged = out.problems.map((p) => p.file.replace(/\\/g, '/'));
    assert.deepEqual(flagged, ['src/content/dirty.jpg']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
