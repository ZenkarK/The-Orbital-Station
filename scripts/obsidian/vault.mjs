/* Vault helpers: frontmatter, a file index, and Obsidian-style link resolution. */
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const posix = path.posix;

/** Split "---\nyaml\n---\nbody" → { data, body }. Throws on invalid YAML. */
export function splitFrontmatter(text) {
  const src = text.replace(/^\uFEFF/, '');
  const m = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { data: {}, body: src };
  let data = {};
  if (m[1]?.trim()) {
    data = parseYaml(m[1]);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) data = {};
  }
  return { data, body: src.slice(m[0].length) };
}

/** Walk up from `start` to the folder holding `.obsidian/`. */
export function findVaultRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.obsidian'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** Vault settings that change how notes render. */
export function readVaultSettings(root) {
  try {
    const app = JSON.parse(fs.readFileSync(path.join(root, '.obsidian', 'app.json'), 'utf8'));
    return { strictLineBreaks: app.strictLineBreaks === true };
  } catch {
    return { strictLineBreaks: false }; // Obsidian's default
  }
}

/** Every file in the vault as a vault-relative POSIX path (dot-folders skipped). */
export function indexVault(root) {
  const files = [];
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.isFile()) files.push(r);
    }
  };
  walk(root, '');
  return files;
}

/**
 * Resolve a link the way Obsidian does: exact vault path, then relative to the
 * linking note, then by file name anywhere — preferring the linking note's
 * folder, then the shortest path. Case-insensitive. ".md" is optional.
 */
export function createResolver(files) {
  const byPath = new Map();
  const byName = new Map();
  for (const f of files) {
    const lower = f.toLowerCase();
    byPath.set(lower, f);
    const name = lower.split('/').pop();
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(f);
  }
  const pick = (candidates, from) => {
    if (!candidates?.length) return null;
    const dir = posix.dirname(from).toLowerCase();
    return [...candidates].sort(
      (a, b) =>
        Number(posix.dirname(b).toLowerCase() === dir) - Number(posix.dirname(a).toLowerCase() === dir) ||
        a.length - b.length ||
        a.localeCompare(b),
    )[0];
  };

  return function resolve(link, from = '') {
    let l = String(link ?? '')
      .replace(/\\/g, '/')
      .trim()
      .replace(/^\/+/, '');
    if (!l) return null;
    const variants = (p) => [p, `${p}.md`];

    if (l.startsWith('./') || l.startsWith('../')) {
      const joined = posix.normalize(posix.join(posix.dirname(from), l));
      if (joined.startsWith('..')) return null; // never outside the vault
      l = joined;
    }
    for (const v of variants(l)) {
      const hit = byPath.get(v.toLowerCase());
      if (hit) return { path: hit };
    }
    const rel = posix.normalize(posix.join(posix.dirname(from), l));
    if (!rel.startsWith('..')) {
      for (const v of variants(rel)) {
        const hit = byPath.get(v.toLowerCase());
        if (hit) return { path: hit };
      }
    }
    for (const v of variants(l)) {
      const lower = v.toLowerCase();
      const name = lower.split('/').pop();
      const candidates = (byName.get(name) ?? []).filter((f) => !lower.includes('/') || f.toLowerCase().endsWith(`/${lower}`) || f.toLowerCase() === lower);
      const hit = pick(candidates, from);
      if (hit) return { path: hit };
    }
    return null;
  };
}
