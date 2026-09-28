#!/usr/bin/env node
/* =============================================================
   The transmission queue (GROW-08) — what's lined up to publish.

     npm run queue -- --vault "C:\path\to\vault"

   Queue a note by giving it the checkbox property `station-queue`.
   Its target orbit is its `station-orbit`, else its folder's orbit
   (site.config.ts → ORBITS[].folders). This prints the queue by
   orbit and the launch count — at least 8 transmissions across at
   least 5 public orbits — and flags every queued note that can't
   go out as-is: one in a sensitive folder (those never belong in
   the queue), or one aimed at an orbit that isn't public.

   Options
     --vault <dir>     the vault (required unless run from inside it)
     --repo <dir>      site repo (default: this repo)
     --write-base      also write "Transmission Queue.base" at the vault
                       root: a live Obsidian Base of the queue, grouped by
                       target orbit, that never lists sensitive folders.
                       A Base without this script's header is left alone.
     --json            machine-readable result

   Reads the vault; writes nothing to it except the Base, and only when
   asked. Exits 1 when a queued note is flagged. The Obsidian plugin's
   "Open transmission queue" command runs the same code (publish.mjs --queue).
   ============================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import { splitFrontmatter, findVaultRoot, indexVault } from './vault.mjs';
import { loadSiteConfig, orbitForNote, sensitiveFolderFor } from './site.mjs';

const DEFAULT_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The launch bar (PRD M1 exit criteria, GROW-08). */
export const LAUNCH = { transmissions: 8, orbits: 5 };
export const BASE_FILE = 'Transmission Queue.base';
const BASE_HEADER = '# Orbital Station — transmission queue (GROW-08).';

const visibilityOf = (o) => o?.visibility ?? 'public';

/** Orbit label for the Base: its name, plus its visibility when it isn't public. */
const orbitLabel = (o) => (visibilityOf(o) === 'public' ? o.name : `${o.name} (${visibilityOf(o)})`);

/**
 * The Obsidian Base (YAML) listing every queued note by target orbit. Sensitive folders
 * are filtered out of it entirely; the target orbit mirrors orbitForNote (deepest folder
 * wins) unless the note sets station-orbit.
 */
export function queueBase(cfg) {
  const byDepth = cfg.ORBITS.flatMap((o) => (o.folders ?? []).map((folder) => ({ folder, o }))).sort(
    (a, b) => b.folder.split('/').length - a.folder.split('/').length || b.folder.length - a.folder.length,
  );
  const q = (s) => JSON.stringify(s);
  const byFolder = byDepth.reduceRight((rest, { folder, o }) => `if(file.inFolder(${q(folder)}), ${q(orbitLabel(o))}, ${rest})`, q('—'));
  const byProperty = cfg.ORBITS.reduceRight(
    (rest, o) => `if(note["station-orbit"] == ${q(o.id)}, ${q(orbitLabel(o))}, ${rest})`,
    'note["station-orbit"]',
  );
  const base = {
    filters: {
      and: [
        'note["station-queue"] == true',
        'file.ext == "md"',
        ...(cfg.SENSITIVE_FOLDERS?.length ? [{ not: cfg.SENSITIVE_FOLDERS.map((f) => `file.inFolder(${q(f)})`) }] : []),
      ],
    },
    formulas: {
      orbit: `if(note["station-orbit"], ${byProperty}, ${byFolder})`,
      state: 'if(note["station-published"], "SENT", "QUEUED")',
    },
    properties: {
      'formula.orbit': { displayName: 'Target orbit' },
      'formula.state': { displayName: 'State' },
      station: { displayName: 'Type' },
      'station-kind': { displayName: 'Kind' },
      'station-published': { displayName: 'Sent' },
    },
    views: [
      {
        type: 'table',
        name: 'Queue',
        filters: 'formula.state == "QUEUED"',
        groupBy: { property: 'formula.orbit', direction: 'ASC' },
        order: ['file.name', 'formula.orbit', 'station', 'station-kind', 'file.mtime'],
      },
      {
        type: 'table',
        name: 'Sent',
        filters: 'formula.state == "SENT"',
        order: ['file.name', 'formula.orbit', 'station-published', 'station-url'],
      },
    ],
  };
  return [
    BASE_HEADER,
    '# Written by the Orbital Station publisher and rewritten whenever the queue is opened',
    '# from Obsidian ("Open transmission queue") — edits here are overwritten.',
    '# Queue a note with the checkbox property station-queue. Notes in sensitive folders',
    '# (site.config.ts SENSITIVE_FOLDERS) never appear here.',
    stringifyYaml(base, { lineWidth: 0 }),
  ].join('\n');
}

/**
 * Every queued note: { note, title, orbit, public, sensitive, published, problems[] }.
 * `problems` says why a note can't go out as queued; `problems` on the result lists them all.
 */
export function readQueue(vault, cfg) {
  const orbits = new Map(cfg.ORBITS.map((o) => [o.id, o]));
  const queued = [];
  for (const note of indexVault(vault)) {
    if (!/\.md$/i.test(note)) continue;
    let data;
    try {
      ({ data } = splitFrontmatter(fs.readFileSync(path.join(vault, note), 'utf8')));
    } catch {
      continue; // unreadable or invalid frontmatter — it isn't queued in any way we can trust
    }
    if (data['station-queue'] !== true) continue;
    const orbitId = String(data['station-orbit'] || orbitForNote(note, cfg.ORBITS) || '').trim().toLowerCase() || null;
    const o = orbitId ? orbits.get(orbitId) : null;
    const sensitive = sensitiveFolderFor(note, cfg.SENSITIVE_FOLDERS);
    const problems = [];
    if (sensitive) problems.push(`"${note}" is in the sensitive folder "${sensitive}" — take it out of the queue.`);
    if (!orbitId) problems.push(`"${note}" has no target orbit — set station-orbit.`);
    else if (!o) problems.push(`"${note}" names an unknown orbit "${orbitId}".`);
    else if (visibilityOf(o) !== 'public') problems.push(`"${note}" targets ${o.name}, which is ${visibilityOf(o)} — nothing filed there is listed.`);
    queued.push({
      note,
      title: String(data['station-title'] || path.posix.basename(note, path.extname(note))),
      orbit: o ? o.id : orbitId,
      public: visibilityOf(o) === 'public' && !!o,
      sensitive,
      published: data['station-published'] ? String(data['station-published']) : null,
      problems,
    });
  }
  queued.sort((a, b) => String(a.orbit).localeCompare(String(b.orbit)) || a.note.localeCompare(b.note));
  return { queued, problems: queued.flatMap((q) => q.problems) };
}

/** Transmissions already in the site (not drafts, in public orbits), counted per orbit. */
export function launchStatus(repo, cfg) {
  const orbits = new Map(cfg.ORBITS.map((o) => [o.id, o]));
  const dir = path.join(repo, 'src', 'content', 'posts');
  const perOrbit = {};
  let transmissions = 0;
  const walk = (d) => {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      if (e.name.startsWith('_')) continue; // the collection ignores these (src/content.config.ts)
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.mdx?$/i.test(e.name)) {
        let data;
        try {
          ({ data } = splitFrontmatter(fs.readFileSync(p, 'utf8')));
        } catch {
          continue;
        }
        if (data.draft === true || visibilityOf(orbits.get(data.orbit)) !== 'public' || !orbits.has(data.orbit)) continue;
        transmissions++;
        perOrbit[data.orbit] = (perOrbit[data.orbit] ?? 0) + 1;
      }
    }
  };
  walk(dir);
  const orbitCount = Object.keys(perOrbit).length;
  return {
    transmissions,
    orbits: orbitCount,
    perOrbit,
    need: LAUNCH,
    ready: transmissions >= LAUNCH.transmissions && orbitCount >= LAUNCH.orbits,
  };
}

/**
 * Writes the Base at the vault root. Returns { path, written } — `written` is false when a
 * Base the owner made by hand (no header from this script) already sits there.
 */
export function writeQueueBase(vault, cfg) {
  const file = path.join(vault, BASE_FILE);
  const text = queueBase(cfg);
  if (fs.existsSync(file)) {
    const current = fs.readFileSync(file, 'utf8');
    if (!current.startsWith(BASE_HEADER)) return { path: BASE_FILE, written: false };
    if (current === text) return { path: BASE_FILE, written: false, current: true };
  }
  fs.writeFileSync(file, text);
  return { path: BASE_FILE, written: true };
}

/** The whole report: the queue, the launch count, and (optionally) the Base. */
export async function queueReport({ vault, repo = DEFAULT_REPO, writeBase = false }) {
  const cfg = await loadSiteConfig(repo);
  const { queued, problems } = readQueue(vault, cfg);
  const launch = launchStatus(repo, cfg);
  // What launch would look like once every clean, unsent queued note goes out.
  const pending = queued.filter((q) => !q.published && !q.problems.length);
  const projectedOrbits = new Set([...Object.keys(launch.perOrbit), ...pending.map((q) => q.orbit)]);
  return {
    ok: true,
    queued,
    problems,
    launch: { ...launch, projected: { transmissions: launch.transmissions + pending.length, orbits: projectedOrbits.size } },
    ...(writeBase ? { base: writeQueueBase(vault, cfg) } : {}),
  };
}

/* ---------- CLI ---------- */
async function main() {
  const argv = process.argv.slice(2);
  const opt = (k) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const json = argv.includes('--json');
  try {
    const vault = opt('vault') ? path.resolve(opt('vault')) : findVaultRoot(process.cwd());
    if (!vault || !fs.existsSync(vault)) throw new Error('Which vault? Pass --vault <folder>.');
    const report = await queueReport({ vault, repo: path.resolve(opt('repo') ?? DEFAULT_REPO), writeBase: argv.includes('--write-base') });
    if (json) process.stdout.write(`${JSON.stringify(report)}\n`);
    else {
      const { launch } = report;
      console.log(`\n  LAUNCH  ${launch.transmissions}/${launch.need.transmissions} transmissions across ${launch.orbits}/${launch.need.orbits} public orbits${launch.ready ? '  ✓ ready' : ''}`);
      console.log(`          with the queue sent: ${launch.projected.transmissions} across ${launch.projected.orbits}\n`);
      let last = null;
      for (const q of report.queued) {
        if (q.orbit !== last) console.log(`  ${String(q.orbit ?? 'NO ORBIT').toUpperCase()}`), (last = q.orbit);
        console.log(`    ${q.published ? 'SENT  ' : q.problems.length ? '✗     ' : 'QUEUED'}  ${q.title}  (${q.note})`);
      }
      if (!report.queued.length) console.log('  Nothing queued yet — give a note the checkbox property station-queue.');
      for (const p of report.problems) console.error(`  ✗ ${p}`);
      if (report.base) console.log(`\n  Base: ${report.base.path} ${report.base.written ? '(written)' : report.base.current ? '(up to date)' : '(left alone — not written by this script)'}`);
      console.log('');
    }
    if (report.problems.length) process.exitCode = 1;
  } catch (e) {
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: e.message })}\n`);
    else console.error(`\n  ✗ ${e.message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) main();
