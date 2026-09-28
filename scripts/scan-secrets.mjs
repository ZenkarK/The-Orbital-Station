#!/usr/bin/env node
/* =============================================================
   Local secret scan (PRIV-03)

     npm run scan:secrets [-- <paths...>] [--json]

   With no paths, scans every file git tracks or would add
   (`git ls-files -co --exclude-standard`), skipping node_modules,
   dist and package-lock.json. Binaries are skipped automatically —
   scanBuffer only scans what scrub/index.mjs's isText() classifies as
   text (by extension for known text formats, content-sniffed
   otherwise), decoded as UTF-8, UTF-16 or Latin-1 as the bytes call
   for. Findings already in .secrets-allow (by fingerprint) are left out.

   Prints one friendly line per finding and exits 1 if any remain,
   0 otherwise. --json prints the raw Finding[] instead.

   "Repo" is the current directory (like git itself) — an npm script
   always runs from the package root, and this also keeps the tests
   below pointed at a throwaway .secrets-allow, never this repo's own.
   ============================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scanBuffer, loadAllowlist, filterAllowed, formatFinding } from './obsidian/secrets.mjs';

const REPO = process.cwd();

const SKIP_DIR_NAMES = new Set(['node_modules', 'dist']);
const SKIP_FILE_NAMES = new Set(['package-lock.json']);

function isSkipped(relPath) {
  const parts = relPath.replace(/\\/g, '/').split('/');
  if (SKIP_FILE_NAMES.has(parts[parts.length - 1])) return true;
  return parts.some((p) => SKIP_DIR_NAMES.has(p));
}

function defaultFiles() {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const given = args.filter((a) => a !== '--json');
  const usingDefault = given.length === 0;
  const files = usingDefault ? defaultFiles() : given;

  const allow = loadAllowlist(REPO);
  const findings = [];
  for (const rel of files) {
    if (isSkipped(rel)) continue;
    const abs = path.isAbsolute(rel) ? rel : path.resolve(REPO, rel);
    let buf;
    try {
      buf = fs.readFileSync(abs);
    } catch {
      continue; // missing, or a directory — nothing to scan
    }
    findings.push(...scanBuffer(buf, { file: rel }));
  }
  const kept = filterAllowed(findings, allow);

  if (json) {
    console.log(JSON.stringify(kept, null, 2));
  } else {
    for (const f of kept) console.log(formatFinding(f));
    if (kept.length) {
      console.log(`\n${kept.length} possible secret${kept.length === 1 ? '' : 's'} found.`);
    }
  }
  process.exitCode = kept.length ? 1 : 0;
}

main();
