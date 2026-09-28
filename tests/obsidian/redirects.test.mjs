/* LIVE-08 — unit tests for the redirect-map bookkeeping publish.mjs relies on: chain
   collapsing, self-redirect avoidance, and the added/removed counts it reports. The
   end-to-end version of these (through a real publish()) lives in publish.test.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRedirects, saveRedirects, recordMove, clearFrom, clearTo, diffCounts } from '../../scripts/obsidian/redirects.mjs';

test('recordMove adds a fresh redirect', () => {
  const map = {};
  recordMove(map, '/a/', '/b/');
  assert.deepEqual(map, { '/a/': '/b/' });
});

test('recordMove is a no-op when the address does not actually change', () => {
  const map = { '/a/': '/b/' };
  recordMove(map, '/x/', '/x/');
  assert.deepEqual(map, { '/a/': '/b/' });
});

test('a chain A→B→C collapses to A→C, B→C', () => {
  const map = {};
  recordMove(map, '/a/', '/b/');
  recordMove(map, '/b/', '/c/');
  assert.deepEqual(map, { '/a/': '/c/', '/b/': '/c/' });
});

test('moving back around the loop (C→A) leaves no self-redirect', () => {
  const map = {};
  recordMove(map, '/a/', '/b/');
  recordMove(map, '/b/', '/c/');
  recordMove(map, '/c/', '/a/');
  assert.equal(map['/a/'], undefined, 'no entry may point at the address that now hosts the page');
  assert.deepEqual(map, { '/b/': '/a/', '/c/': '/a/' });
});

test('clearFrom drops a stale redirect once a page lives at that address', () => {
  const map = { '/a/': '/b/', '/c/': '/d/' };
  clearFrom(map, '/a/');
  assert.deepEqual(map, { '/c/': '/d/' });
});

test('clearTo drops every redirect that pointed at a removed page', () => {
  const map = { '/a/': '/z/', '/b/': '/z/', '/c/': '/y/' };
  clearTo(map, '/z/');
  assert.deepEqual(map, { '/c/': '/y/' });
});

test('diffCounts reports added/removed keys, not value-only changes', () => {
  assert.deepEqual(diffCounts({}, { '/a/': '/b/' }), { added: 1, removed: 0 });
  assert.deepEqual(diffCounts({ '/a/': '/b/' }, {}), { added: 0, removed: 1 });
  // /a/'s value changes but the key survives — not counted either way.
  assert.deepEqual(diffCounts({ '/a/': '/b/' }, { '/a/': '/c/' }), { added: 0, removed: 0 });
});

test('saveRedirects writes sorted JSON and removes the file once the map is empty', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-redirects-'));
  try {
    saveRedirects(tmp, { '/b/': '/z/', '/a/': '/y/' });
    const file = path.join(tmp, 'src', 'redirects.json');
    assert.equal(fs.readFileSync(file, 'utf8'), '{\n  "/a/": "/y/",\n  "/b/": "/z/"\n}\n');
    assert.deepEqual(loadRedirects(tmp), { '/a/': '/y/', '/b/': '/z/' });

    saveRedirects(tmp, {});
    assert.ok(!fs.existsSync(file));
    assert.deepEqual(loadRedirects(tmp), {});
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadRedirects tolerates a missing or corrupt file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-redirects-'));
  try {
    assert.deepEqual(loadRedirects(tmp), {});
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'redirects.json'), '{not json');
    assert.deepEqual(loadRedirects(tmp), {});
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
