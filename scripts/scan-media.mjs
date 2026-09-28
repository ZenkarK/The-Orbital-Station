#!/usr/bin/env node
/* =============================================================
   CI media scan (PRIV-04)

     npm run scan:media [-- <paths…>] [--json] [--fix]

   With no paths, scans every file git tracks under public/ and
   src/content/ (`git ls-files -- public src/content`). Plain text
   passes through untouched; every other file — including every
   .svg, which can look like text but isn't treated as one here —
   goes through the same inspect() the publisher's clean-room step
   (scripts/obsidian/scrub) uses.

   Fonts (woff, woff2, ttf, otf) and .ico are skipped outright: they
   aren't personal-metadata carriers in this station, and inspect()
   has no handler for them. Any other unreadable or unhandled binary
   counts as a problem, same as one that still carries metadata.

   Prints one line per problem file (path + categories, or the
   unsupported/unreadable reason) and a final summary line. Exits 1
   if any file is left with metadata, unsupported, or unreadable —
   0 otherwise. --json prints the findings as data instead.

   --fix rewrites problem files in place with scrub(), keeping only
   the ones that come back clean; anything scrub() can't clean stays
   a problem and the run still exits 1.

   "Repo" is the current directory, like git itself — an npm script
   always runs from the package root, and this also keeps the tests
   below pointed at a throwaway git repo, never this one.
   ============================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scrub, inspect, isText, extOf } from './obsidian/scrub/index.mjs';

const REPO = process.cwd();
const DEFAULT_DIRS = ['public', 'src/content'];

/** Extensions with no built-in handler that are deliberately not treated as problems:
 *  web fonts and the favicon container carry no personal metadata worth scanning for here. */
const SKIPPED = {
  woff: 'a web font, not a personal-metadata carrier',
  woff2: 'a web font, not a personal-metadata carrier',
  ttf: 'a web font, not a personal-metadata carrier',
  otf: 'a web font, not a personal-metadata carrier',
  ico: 'an icon container, not a personal-metadata carrier',
};

function defaultFiles() {
  const out = execFileSync('git', ['ls-files', '--', ...DEFAULT_DIRS], { cwd: REPO, encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

async function scanFile(rel) {
  const abs = path.isAbsolute(rel) ? rel : path.resolve(REPO, rel);
  let buf;
  try {
    buf = fs.readFileSync(abs);
  } catch {
    return null; // missing, or a directory — nothing to scan
  }
  const ext = extOf(rel);
  if (isText(ext, buf)) return null;
  if (ext in SKIPPED) return { file: rel, skipped: SKIPPED[ext] };

  const res = await inspect(buf, { name: rel });
  if (!res.ok) return { file: rel, problem: true, reason: res.reason };
  if (res.categories.length) return { file: rel, problem: true, categories: res.categories };
  return null;
}

async function fixFile(rel) {
  const abs = path.isAbsolute(rel) ? rel : path.resolve(REPO, rel);
  const buf = fs.readFileSync(abs);
  const res = await scrub(buf, { name: rel });
  if (res.ok && (res.kind === 'scrubbed' || res.kind === 'clean')) {
    fs.writeFileSync(abs, res.buffer);
    return true;
  }
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const fix = args.includes('--fix');
  const given = args.filter((a) => a !== '--json' && a !== '--fix');
  const usingDefault = given.length === 0;
  const files = usingDefault ? defaultFiles() : given;

  const results = (await Promise.all(files.map(scanFile))).filter(Boolean);
  const skipped = results.filter((r) => r.skipped);
  let problems = results.filter((r) => r.problem);

  const fixed = [];
  if (fix && problems.length) {
    const stillBroken = [];
    for (const p of problems) {
      if (await fixFile(p.file)) fixed.push(p.file);
      else stillBroken.push(p);
    }
    problems = stillBroken;
  }

  if (json) {
    console.log(JSON.stringify({ problems, skipped, fixed }, null, 2));
  } else {
    for (const s of skipped) console.log(`${s.file}: skipped (${s.skipped})`);
    for (const p of problems) {
      console.log(p.categories ? `${p.file}: ${p.categories.join(', ')}` : `${p.file}: ${p.reason}`);
    }
    for (const f of fixed) console.log(`fixed: ${f}`);
    const n = problems.length;
    console.log(`\n${n} file${n === 1 ? '' : 's'} carrying hidden metadata or unreadable.`);
  }
  process.exitCode = problems.length ? 1 : 0;
}

main();
