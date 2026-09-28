/* GROW-03 — sitemap `lastmod`, computed straight from the content files rather than
   Astro's content collections (astro.config.mjs runs before the site is built, so
   `astro:content` isn't reachable from here). Read once per build by astro.config.mjs's
   @astrojs/sitemap `serialize` hook.

   Rules: a post's lastmod is `updated ?? date`; a project's is `ended ?? started` (projects
   have no `date`/`updated` field — see src/content.config.ts). A list page (the Bridge,
   Transmissions, the Flight Log, an orbit page) gets the newest lastmod among the items it
   shows. Everything else is left alone — no lastmod, same as before this existed. Non-public-
   orbit content is always skipped: it never becomes a page, so it must never make a list
   page's lastmod look newer than what visitors can actually see. Draft content is skipped
   too, UNLESS this build has drafts turned on (`showDrafts`, mirroring src/lib/content.ts's
   own SHOW_DRAFTS gate) — a draft preview build renders drafts as real pages, and this index
   must agree with that or a preview build's own lastmod would understate its own content. */
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { isListed } from './visibility';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

function frontmatterOf(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = FRONTMATTER.exec(text);
  if (!m) return {};
  try {
    return parseYaml(m[1]) ?? {};
  } catch {
    return {};
  }
}

/* Mirrors content.config.ts's stripIndex loader id: a post/project's own folder or file
   name, extension and any trailing /index dropped, lowercased. */
function idFor(base, file) {
  return path
    .relative(base, file)
    .replace(/\\/g, '/')
    .replace(/\.(md|mdx)$/i, '')
    .replace(/\/index$/i, '')
    .toLowerCase();
}

function collectFiles(dir) {
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith('_')) continue;
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(md|mdx)$/i.test(entry.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.valueOf()) ? null : d;
}

/**
 * @param {string} srcDir
 * @param {{ showDrafts?: boolean }} [opts] showDrafts: true when this build renders drafts
 *   as real pages (SHOW_DRAFTS=true), so they must count here too.
 * @returns {Map<string, string>} root-relative pathname (no base) → ISO lastmod string.
 */
export function buildLastmodIndex(srcDir, { showDrafts = false } = {}) {
  const index = new Map();
  const bump = (p, d) => {
    if (!d) return;
    const prev = index.get(p);
    if (!prev || d > new Date(prev)) index.set(p, d.toISOString());
  };
  let newestPost = null;
  let newestProject = null;
  const newestByOrbit = new Map();
  const bumpOrbit = (orbit, d) => {
    if (!d) return;
    const prev = newestByOrbit.get(orbit);
    if (!prev || d > prev) newestByOrbit.set(orbit, d);
  };

  const postsDir = path.join(srcDir, 'content', 'posts');
  for (const file of collectFiles(postsDir)) {
    const data = frontmatterOf(file);
    if ((data.draft && !showDrafts) || !data.orbit || !isListed(data.orbit)) continue;
    const d = toDate(data.updated) ?? toDate(data.date);
    if (!d) continue;
    bump(`/transmissions/${idFor(postsDir, file)}/`, d);
    bumpOrbit(data.orbit, d);
    if (!newestPost || d > newestPost) newestPost = d;
  }

  const projectsDir = path.join(srcDir, 'content', 'projects');
  for (const file of collectFiles(projectsDir)) {
    const data = frontmatterOf(file);
    if ((data.draft && !showDrafts) || !data.orbit || !isListed(data.orbit)) continue;
    const d = toDate(data.ended) ?? toDate(data.started);
    if (!d) continue; // no date field at all — "others omitted"
    bump(`/log/${idFor(projectsDir, file)}/`, d);
    bumpOrbit(data.orbit, d);
    if (!newestProject || d > newestProject) newestProject = d;
  }

  bump('/', newestPost);
  bump('/transmissions/', newestPost);
  bump('/log/', newestProject);
  for (const [orbit, d] of newestByOrbit) bump(`/orbits/${orbit}/`, d);

  return index;
}
