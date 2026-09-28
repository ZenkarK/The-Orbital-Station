/* LIVE-08 — src/redirects.json bookkeeping: old path → new path, paths without the base
   (astro.config.mjs adds it when it loads the file into Astro's `redirects`). publish.mjs
   calls these when a page moves or is unpublished; kept separate so both it and the tests
   can exercise the map logic without a whole publish() call. */
import fs from 'node:fs';
import path from 'node:path';

const REL = path.join('src', 'redirects.json');

export const redirectsPath = (repo) => path.join(repo, REL);

/** The redirect map (old path → new path) from src/redirects.json, or {} if missing/invalid. */
export function loadRedirects(repo) {
  const file = redirectsPath(repo);
  if (!fs.existsSync(file)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? { ...data } : {};
  } catch {
    return {};
  }
}

/** Writes the map back sorted by key (a readable diff), or removes the file once it's empty. */
export function saveRedirects(repo, map) {
  const file = redirectsPath(repo);
  const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) {
    if (fs.existsSync(file)) fs.rmSync(file);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`);
}

/**
 * Records that a page moved from `oldPath` to `newPath` (mutates `map` in place):
 *   - collapses any existing chain that pointed at `oldPath` so it points at `newPath`
 *     directly instead (A→oldPath→newPath becomes A→newPath) — dropping the entry rather
 *     than keeping a self-redirect when that rewrite would send `newPath` to itself;
 *   - adds oldPath → newPath;
 *   - drops any stale redirect *from* newPath (a page lives there now — see clearFrom).
 * A no-op when oldPath === newPath.
 */
export function recordMove(map, oldPath, newPath) {
  if (!oldPath || !newPath || oldPath === newPath) return;
  for (const [k, v] of Object.entries(map)) {
    if (v !== oldPath) continue;
    if (k === newPath) delete map[k];
    else map[k] = newPath;
  }
  map[oldPath] = newPath;
  clearFrom(map, newPath);
}

/** A page now lives at `path` — drop any stale redirect *from* it (no self or shadowed redirects). */
export function clearFrom(map, path) {
  delete map[path];
}

/** A page at `path` was removed — drop any redirect that pointed at it (nowhere left to send visitors). */
export function clearTo(map, path) {
  for (const [k, v] of Object.entries(map)) if (v === path) delete map[k];
}

/** How many keys were added/removed between two redirect maps, for a publish result. */
export function diffCounts(before, after) {
  const beforeKeys = new Set(Object.keys(before));
  const afterKeys = new Set(Object.keys(after));
  let added = 0;
  let removed = 0;
  for (const k of afterKeys) if (!beforeKeys.has(k)) added++;
  for (const k of beforeKeys) if (!afterKeys.has(k)) removed++;
  return { added, removed };
}
