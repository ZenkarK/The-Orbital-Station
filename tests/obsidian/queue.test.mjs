import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { setupTestRepo, ROOT } from '../helpers/publish-fixtures.mjs';
import { queueBase, readQueue, launchStatus, queueReport, BASE_FILE, LAUNCH } from '../../scripts/obsidian/queue.mjs';
import { loadSiteConfig } from '../../scripts/obsidian/site.mjs';

/* GROW-08 — the transmission queue and the launch count. Throwaway vault + repo only. */

const cfg = await loadSiteConfig(ROOT);
const queuedNote = (extra = '') => `---\nstation-queue: true\n${extra}---\n\nBody.\n`;
const post = (orbit, extra = '') => `---\ntitle: T\ndate: 2026-09-01\norbit: ${orbit}\n${extra}---\n\nBody.\n`;

test('the Base is valid YAML, keeps every sensitive folder out, and maps folders deepest-first', () => {
  const text = queueBase(cfg);
  assert.match(text, /^# Orbital Station — transmission queue/);
  const base = parseYaml(text);
  const [queueFilter, , sensitive] = base.filters.and;
  assert.equal(queueFilter, 'note["station-queue"] == true');
  assert.deepEqual(sensitive.not, cfg.SENSITIVE_FOLDERS.map((f) => `file.inFolder(${JSON.stringify(f)})`));
  const orbit = base.formulas.orbit;
  assert.ok(orbit.indexOf('file.inFolder("Finance/Ventures")') < orbit.indexOf('file.inFolder("Finance")'), 'deepest folder first');
  assert.match(orbit, /file\.inFolder\("Astrophysics"\), "ASTRO"/);
  assert.match(orbit, /file\.inFolder\("Health"\), "BODY \(phase-only\)"/);
  assert.deepEqual(base.views.map((v) => v.name), ['Queue', 'Sent']);
  assert.equal(base.views[0].groupBy.property, 'formula.orbit');
});

test('readQueue: target orbits, sent notes, and every note that cannot go out is flagged', () => {
  const r = setupTestRepo();
  try {
    r.writeNote('Astrophysics/Jets.md', queuedNote());
    r.writeNote('Astrophysics/Sent.md', queuedNote('station-published: 2026-09-20\n'));
    r.writeNote('Notes/Retargeted.md', queuedNote('station-orbit: words\nstation-title: A better title\n'));
    r.writeNote('Work/Roadmap.md', queuedNote());
    r.writeNote('Notes/Private-ish.md', queuedNote('station-orbit: kin\n'));
    r.writeNote('Notes/Unfiled.md', queuedNote());
    r.writeNote('Notes/NotQueued.md', '---\nstation-queue: false\n---\n\nBody.\n');
    r.writeNote('Notes/StringTrue.md', '---\nstation-queue: "true"\n---\n\nBody.\n');

    const { queued, problems } = readQueue(r.vault, cfg);
    const by = Object.fromEntries(queued.map((q) => [q.note, q]));
    assert.deepEqual(Object.keys(by).sort(), [
      'Astrophysics/Jets.md',
      'Astrophysics/Sent.md',
      'Notes/Private-ish.md',
      'Notes/Retargeted.md',
      'Notes/Unfiled.md',
      'Work/Roadmap.md',
    ]);
    assert.equal(by['Astrophysics/Jets.md'].orbit, 'astro');
    assert.deepEqual(by['Astrophysics/Jets.md'].problems, []);
    assert.equal(by['Astrophysics/Sent.md'].published, '2026-09-20');
    assert.equal(by['Notes/Retargeted.md'].orbit, 'words');
    assert.equal(by['Notes/Retargeted.md'].title, 'A better title');
    assert.equal(by['Work/Roadmap.md'].sensitive, 'Work');
    assert.match(by['Work/Roadmap.md'].problems[0], /sensitive folder "Work"/);
    assert.match(by['Notes/Private-ish.md'].problems[0], /KIN, which is phase-only/);
    assert.match(by['Notes/Unfiled.md'].problems[0], /no target orbit/);
    assert.equal(problems.length, 3);
  } finally {
    fs.rmSync(r.tmp, { recursive: true, force: true });
  }
});

test('launchStatus counts public, non-draft transmissions per orbit against 8 across 5', () => {
  const r = setupTestRepo();
  try {
    const dir = path.join(r.repo, 'src/content/posts');
    const orbits = ['astro', 'astro', 'words', 'mind', 'systems', 'growth', 'voyage', 'language'];
    orbits.forEach((o, i) => fs.writeFileSync(path.join(dir, `p${i}.md`), post(o)));
    fs.writeFileSync(path.join(dir, 'draft.md'), post('markets', 'draft: true\n'));
    fs.writeFileSync(path.join(dir, 'private.md'), post('body'));
    fs.writeFileSync(path.join(dir, '_template.md'), post('craft'));
    fs.mkdirSync(path.join(dir, 'folder-post'));
    fs.writeFileSync(path.join(dir, 'folder-post', 'index.md'), post('craft'));

    const s = launchStatus(r.repo, cfg);
    assert.equal(s.transmissions, 9);
    assert.equal(s.orbits, 8);
    assert.equal(s.perOrbit.astro, 2);
    assert.equal(s.perOrbit.body, undefined, 'phase-only orbits never count');
    assert.equal(s.perOrbit.markets, undefined, 'drafts never count');
    assert.equal(s.ready, true);
    assert.deepEqual(s.need, LAUNCH);

    fs.rmSync(path.join(dir, 'p7.md'));
    fs.rmSync(path.join(dir, 'folder-post'), { recursive: true });
    fs.rmSync(path.join(dir, 'p6.md'));
    assert.equal(launchStatus(r.repo, cfg).ready, false, '6 transmissions is short of 8');
  } finally {
    fs.rmSync(r.tmp, { recursive: true, force: true });
  }
});

test('queueReport projects the launch and writes the Base only when it is ours', async () => {
  const r = setupTestRepo();
  try {
    r.writeNote('Astrophysics/Jets.md', queuedNote());
    r.writeNote('Work/Roadmap.md', queuedNote());
    const report = await queueReport({ vault: r.vault, repo: r.repo, writeBase: true });
    assert.equal(report.launch.transmissions, 0);
    assert.deepEqual(report.launch.projected, { transmissions: 1, orbits: 1 }, 'the flagged Work note does not count');
    assert.deepEqual(report.base, { path: BASE_FILE, written: true });
    const file = path.join(r.vault, BASE_FILE);
    assert.equal(fs.readFileSync(file, 'utf8'), queueBase(cfg));

    assert.equal((await queueReport({ vault: r.vault, repo: r.repo, writeBase: true })).base.current, true);
    fs.writeFileSync(file, 'filters: my own\n');
    assert.equal((await queueReport({ vault: r.vault, repo: r.repo, writeBase: true })).base.written, false);
    assert.equal(fs.readFileSync(file, 'utf8'), 'filters: my own\n', "a hand-made Base is never overwritten");
  } finally {
    fs.rmSync(r.tmp, { recursive: true, force: true });
  }
});

test('the CLI and publish.mjs --queue report the same queue and exit 1 on a flagged note', () => {
  const r = setupTestRepo();
  try {
    r.writeNote('Astrophysics/Jets.md', queuedNote());
    const run = (script, args) =>
      execFileSync(process.execPath, [path.join(ROOT, 'scripts/obsidian', script), ...args, '--json'], { encoding: 'utf8' });
    const viaQueue = JSON.parse(run('queue.mjs', ['--vault', r.vault, '--repo', r.repo]));
    assert.equal(viaQueue.ok, true);
    assert.equal(viaQueue.queued.length, 1);
    assert.equal(fs.existsSync(path.join(r.vault, BASE_FILE)), false, 'the CLI writes the Base only with --write-base');

    const viaPublish = JSON.parse(run('publish.mjs', ['--queue', '--vault', r.vault, '--repo', r.repo]));
    assert.equal(viaPublish.ok, true);
    assert.deepEqual(viaPublish.queued, viaQueue.queued);
    assert.equal(viaPublish.base.written, true, 'the plugin command (publish.mjs --queue) keeps the Base current');

    r.writeNote('Health/Run.md', queuedNote());
    assert.throws(() => run('queue.mjs', ['--vault', r.vault, '--repo', r.repo]), (e) => e.status === 1 && /sensitive folder/.test(e.stdout));
  } finally {
    fs.rmSync(r.tmp, { recursive: true, force: true });
  }
});
