/* LIVE-02 — siteUrlFor: the publisher's best guess at where the site lives, so its
   `station-url` write-back and dry-run/JSON output match the real domain once one exists.
   A public/CNAME file wins over the GitHub Pages address implied by the git remote; with
   neither, there's nowhere to guess and it returns null. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { siteUrlFor } from '../../scripts/obsidian/site.mjs';

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-siteurl-'));
  fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
  return dir;
}

test('public/CNAME wins over the git remote', () => {
  const repo = tmpRepo();
  try {
    fs.writeFileSync(path.join(repo, 'public', 'CNAME'), 'zenkar.dev\n');
    assert.equal(siteUrlFor(repo, 'git@github.com:zenkar/orbital-station.git'), 'https://zenkar.dev/');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('with no CNAME, a github.io repo remote resolves to the project-site address', () => {
  const repo = tmpRepo();
  try {
    assert.equal(siteUrlFor(repo, 'https://github.com/zenkar/The-Orbital-Station.git'), 'https://zenkar.github.io/The-Orbital-Station/');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('with no CNAME, a <user>.github.io remote resolves to the root address (no repo segment)', () => {
  const repo = tmpRepo();
  try {
    assert.equal(siteUrlFor(repo, 'git@github.com:zenkar/zenkar.github.io.git'), 'https://zenkar.github.io/');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a blank CNAME file is ignored, falling back to the remote', () => {
  const repo = tmpRepo();
  try {
    fs.writeFileSync(path.join(repo, 'public', 'CNAME'), '   \n');
    assert.equal(siteUrlFor(repo, 'https://github.com/zenkar/The-Orbital-Station.git'), 'https://zenkar.github.io/The-Orbital-Station/');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('no CNAME and a non-GitHub (or missing) remote resolves to null', () => {
  const repo = tmpRepo();
  try {
    assert.equal(siteUrlFor(repo, null), null);
    assert.equal(siteUrlFor(repo, 'https://gitlab.com/zenkar/orbital-station.git'), null);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
