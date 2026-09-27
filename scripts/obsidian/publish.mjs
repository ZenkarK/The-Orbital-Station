#!/usr/bin/env node
/* =============================================================
   Publish an Obsidian note to Orbital Station.

     npm run publish:note -- "C:\Zenkar's Vault\Astrophysics\Jets.md"

   The Obsidian plugin runs this same script behind its "Transmit" button.
   A note is described by its `station-*` properties (the plugin's dialog
   fills them in; nothing else in the note's properties is ever read):

     station:          post | project          which kind of page
     station-title     page title              (default: the note's file name)
     station-orbit     systems | markets | craft | astro | venture | words   (required)
     station-kind      essay | build-log | field-note                     (posts)
     station-status    PLANNED | ACTIVE | COMPLETE | SCRUBBED            (projects)
     station-date      publication date        (default: kept from the page, else today)
     station-summary   one or two sentences    (default: the opening lines)
     station-tags      list of tags
     station-project   slug of a Flight Log mission to file a post under
     station-cover     image in the vault, e.g. "[[jet.png]]"
     station-cover-alt description of the cover image
     station-slug      the page's web address  (default: from the title)
     station-started / station-ended / station-stack / station-repo / station-demo   (projects)
     station-published, station-url            written back after a successful publish

   Each page remembers which note it came from (a hash of the note's path in
   the vault), so a note can only ever replace, move or remove its own page.

   Options
     --vault <dir>           vault root (default: nearest folder with .obsidian/)
     --repo <dir>            site repo (default: this repo)
     --type post|project, --title, --orbit, --kind, --status, --date,
     --summary, --tags a,b, --project, --slug     override the note's properties
     --site-url <url>        public address, for the returned page link
     --unpublish             take the note's page down
     --dry-run               report what would happen; change nothing
     --no-commit             write files but don't commit
     --no-push               commit but don't push
     --no-write-back         don't record station-* results in the note (the plugin does that itself)
     --force                 allow replacing a page not published from this note
     --json                  machine-readable result (used by the plugin; implies --no-write-back)
     --describe              print the site's orbits, kinds, missions and git status
   ============================================================= */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Document as YamlDocument, visit as yamlVisit, parseDocument } from 'yaml';
import jsYaml from 'js-yaml';
import { convertBody, extOf, IMAGE_EXT, NEVER_COPY } from './convert.mjs';
import { splitFrontmatter, findVaultRoot, readVaultSettings, indexVault, createResolver } from './vault.mjs';
import {
  loadSiteConfig,
  listProjects,
  isGitRepo,
  remoteUrl,
  currentBranch,
  commitAndPush,
  upstreamHasSource,
  siteUrlFor,
  normalizeSiteUrl,
  DEPLOY_BRANCH,
} from './site.mjs';

const DEFAULT_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MARKER = '# Published from Obsidian by the Orbital Station publisher.';
const EDIT_NOTE = '# Edit the note in your vault and publish again — changes made here are overwritten.';
const COLLECTIONS = { posts: 'transmissions', projects: 'log' };

export class UserError extends Error {}

/* ---------- args ---------- */
function parseArgs(argv) {
  const flags = new Set(['unpublish', 'dry-run', 'no-commit', 'no-push', 'no-write-back', 'force', 'json', 'describe', 'help']);
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split(/=(.*)/s);
      if (flags.has(k)) opts[k] = true;
      else opts[k] = inline ?? argv[++i] ?? '';
    } else opts._.push(a);
  }
  return opts;
}

/* ---------- small utils ---------- */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const slugify = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const asDate = (v, field) => {
  if (v == null || v === '') return null;
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (!m || Number.isNaN(Date.parse(m[1]))) throw new UserError(`"${field}" should be a date like 2026-09-26 (got "${s}").`);
  return m[1];
};
/** A YAML list, or a comma-separated string. */
const asList = (v) => {
  if (v == null || v === '') return [];
  const arr = Array.isArray(v) ? v : String(v).split(',');
  return [...new Set(arr.map((t) => oneLine(t).replace(/^#/, '')).filter(Boolean))];
};
const asUrl = (v, field, warnings) => {
  if (!v) return undefined;
  const s = String(v).trim();
  if (/^https?:\/\/\S+$/i.test(s)) return s;
  warnings.push(`"${field}" isn't a web address (https://…) — left out.`);
  return undefined;
};
const wikiTarget = (v) => String(v ?? '').trim().replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim();
const rmrf = (p) => fs.rmSync(p, { recursive: true, force: true });
export const sourceId = (notePath) => crypto.createHash('sha256').update(notePath.replaceAll('\\', '/').toLowerCase()).digest('hex').slice(0, 12);
const safeFrontmatter = (text) => {
  try {
    return splitFrontmatter(text).data;
  } catch {
    return {};
  }
};
const bodyOf = (text) => text.replace(/^---[\s\S]*?\n---[ \t]*\n/, '').trim();

/* ---------- pages already in the repo ---------- */

/** Every page the publisher wrote (a marked index.md), in both collections. */
function scanPages(repo) {
  const pages = [];
  for (const [collection, route] of Object.entries(COLLECTIONS)) {
    const dir = path.join(repo, 'src', 'content', collection);
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const file = path.join(dir, e.name, 'index.md');
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      const head = text.slice(0, 800);
      if (!head.includes(MARKER)) continue;
      const slug = e.name.toLowerCase();
      pages.push({
        collection,
        route,
        slug,
        dir: path.join(dir, e.name),
        filesDir: path.join(repo, 'public', 'files', collection, slug),
        text,
        source: /# source-id: ([0-9a-f]+)/.exec(head)?.[1] ?? null,
      });
    }
  }
  return pages;
}

/**
 * Is something hand-written sitting at this address? (A <slug>.md/.mdx file, or a
 * <slug>/ folder holding anything other than one publisher-marked index.md plus assets.)
 * Case-insensitive, because the site lower-cases page ids.
 */
function handWrittenAt(repo, collection, slug) {
  const dir = path.join(repo, 'src', 'content', collection);
  if (!fs.existsSync(dir)) return false;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const lower = e.name.toLowerCase();
    if (e.isFile() && (lower === `${slug}.md` || lower === `${slug}.mdx`)) return true;
    if (!e.isDirectory() || lower !== slug) continue;
    const inside = fs.readdirSync(path.join(dir, e.name), { withFileTypes: true });
    const index = inside.find((f) => f.isFile() && f.name === 'index.md');
    if (!index || !fs.readFileSync(path.join(dir, e.name, 'index.md'), 'utf8').slice(0, 800).includes(MARKER)) return true;
    if (inside.some((f) => f.isDirectory() || (f.name !== 'index.md' && /\.(md|mdx)$/i.test(f.name)))) return true;
  }
  return false;
}

/** Do the page's current files match the assets we're about to write? */
function sameAssets(page, assets) {
  if (!page) return false;
  const want = new Map([...assets.values()].map((a) => [path.resolve(a.dest), a.src]));
  const have = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name !== 'index.md' || d !== page.dir) have.push(path.resolve(p));
    }
  };
  walk(page.dir);
  walk(page.filesDir);
  if (have.length !== want.size || have.some((p) => !want.has(p))) return false;
  for (const [dest, src] of want) {
    const a = fs.readFileSync(src);
    const b = fs.readFileSync(dest);
    if (a.length !== b.length || !a.equals(b)) return false;
  }
  return true;
}

/* ---------- output ---------- */
function emitFrontmatter(id, fields) {
  const data = Object.fromEntries(
    Object.entries(fields).filter(([k, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length && k !== 'tags')),
  );
  // YAML 1.1 quotes anything a YAML-1.1 reader (Astro uses js-yaml) would mistake for a date,
  // boolean or number ("2026-09-26" as a title, "yes" as a tag); real date fields are then
  // written plainly. Lists are written inline: tags: [a, b].
  const doc = new YamlDocument(data, { version: '1.1' });
  yamlVisit(doc, {
    Seq: (_, node) => void (node.flow = true),
    // Belt and braces: quote any string Astro's own YAML reader (js-yaml) would read as something else ("0o17", "null", …).
    Scalar(_, node) {
      if (typeof node.value !== 'string') return;
      try {
        if (jsYaml.load(node.value) !== node.value) node.type = 'QUOTE_DOUBLE';
      } catch {
        node.type = 'QUOTE_DOUBLE';
      }
    },
  });
  const yaml = doc
    .toString({ lineWidth: 0, flowCollectionPadding: false })
    .replace(/^(date|updated|started|ended): "(\d{4}-\d{2}-\d{2})"$/gm, '$1: $2')
    .trimEnd();
  return ['---', MARKER, EDIT_NOTE, `# source-id: ${id}`, yaml, '---', ''].join('\n');
}

/** Record results in the note's own properties (CLI use; the plugin does this through Obsidian). */
function writeBack(noteAbs, set, remove = []) {
  const text = fs.readFileSync(noteAbs, 'utf8');
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const src = text.slice(bom.length);
  const m = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(\r?\n|$)/.exec(src);
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const doc = parseDocument(m?.[1] ?? '');
  if (doc.errors.length) return;
  if (!doc.contents) doc.contents = doc.createNode({});
  for (const [k, v] of Object.entries(set)) if (v !== undefined) doc.set(k, v);
  for (const k of remove) doc.delete(k);
  const yaml = doc.toString({ lineWidth: 0 }).trimEnd().replace(/\n/g, eol);
  const rest = m ? src.slice(m[0].length) : src;
  fs.writeFileSync(noteAbs, `${bom}---${eol}${yaml}${eol}---${eol}${rest}`);
}

/* ---------- describe ---------- */
async function describe(repo) {
  const cfg = await loadSiteConfig(repo);
  const repoOk = await isGitRepo(repo);
  const remote = repoOk ? await remoteUrl(repo) : null;
  return {
    ok: true,
    repo,
    node: process.version,
    git: repoOk,
    branch: repoOk ? await currentBranch(repo) : null,
    deployBranch: DEPLOY_BRANCH,
    remote,
    siteUrl: siteUrlFor(repo, remote),
    orbits: cfg.ORBITS.map((o) => ({ id: o.id, name: o.name })),
    kinds: Object.entries(cfg.POST_KINDS).map(([id, label]) => ({ id, label })),
    statuses: [...cfg.PROJECT_STATUSES],
    projects: listProjects(repo),
  };
}

/* ---------- publish ---------- */
export async function publish(opts) {
  const repo = path.resolve(opts.repo ?? DEFAULT_REPO);
  const noteArg = opts._[0] ?? opts.note;
  if (!noteArg) throw new UserError('Which note? Pass the path to a Markdown file in your vault.');
  const noteAbs = path.resolve(noteArg);
  if (!fs.existsSync(noteAbs) || !/\.md$/i.test(noteAbs)) throw new UserError(`Not a Markdown note: ${noteAbs}`);
  const foundVault = findVaultRoot(path.dirname(noteAbs));
  if (!opts.vault && !foundVault) throw new UserError('Could not find the vault (a folder containing .obsidian/). Pass --vault.');
  const vault = path.resolve(opts.vault ?? foundVault);
  const notePath = path.relative(vault, noteAbs).replaceAll('\\', '/');
  if (notePath.startsWith('..')) throw new UserError('The note is not inside the vault.');

  const cfg = await loadSiteConfig(repo);
  const warnings = [];
  let fm;
  let body;
  try {
    ({ data: fm, body } = splitFrontmatter(fs.readFileSync(noteAbs, 'utf8')));
  } catch (e) {
    throw new UserError(`The note's properties (frontmatter) aren't valid YAML: ${e.message.split('\n')[0]}`);
  }
  // CLI flags may override these note properties (and only these — `--repo` is the site folder, not `station-repo`).
  const OVERRIDABLE = new Set(['title', 'orbit', 'kind', 'status', 'date', 'summary', 'tags', 'project', 'slug']);
  const prop = (k) => (OVERRIDABLE.has(k) && opts[k] !== undefined ? opts[k] : fm[`station-${k}`]);

  const type = String(opts.type ?? fm.station ?? 'post').trim().toLowerCase();
  if (!['post', 'project'].includes(type)) throw new UserError(`"station" must be "post" or "project" (got "${type}").`);
  const collection = type === 'post' ? 'posts' : 'projects';
  const route = COLLECTIONS[collection];
  const title = oneLine(prop('title') || path.basename(noteAbs, path.extname(noteAbs)));
  const slug = slugify(prop('slug') || title);
  if (!slug) throw new UserError('The title has no letters or numbers to build a web address from — set one (station-slug).');

  let siteUrl;
  try {
    siteUrl = normalizeSiteUrl(opts['site-url'] || siteUrlFor(repo, await remoteUrl(repo).catch(() => null)));
  } catch {
    throw new UserError(`The site address "${opts['site-url']}" isn't a web address — it should look like https://example.com/`);
  }
  const pageUrl = siteUrl ? new URL(`${route}/${slug}/`, siteUrl).href : null;

  const pageDir = path.join(repo, 'src', 'content', collection, slug);
  const pageFile = path.join(pageDir, 'index.md');
  const filesDir = path.join(repo, 'public', 'files', collection, slug);
  const useGit = !opts['no-commit'] && (await isGitRepo(repo));
  if (useGit && (await currentBranch(repo)) === 'HEAD') {
    throw new UserError('The site folder is in "detached HEAD" state — check out main there first.');
  }

  /* --- ownership: a page belongs to the note whose path it was published from. A note may
         also take over a page whose original note no longer exists (it was renamed or moved),
         if the note's own station-slug points at it. Nothing else is ever replaced or removed. --- */
  const files = indexVault(vault);
  const id = sourceId(notePath);
  const liveIds = new Set(files.filter((f) => /\.md$/i.test(f)).map(sourceId));
  const claimed = fm['station-slug'] ? slugify(fm['station-slug']) : null;
  const pages = scanPages(repo);
  /** Notes in the vault whose station-slug names `slug` (read lazily, only when adoption is on the table). */
  let slugClaims = null;
  const claimants = (slug) => {
    if (!slugClaims) {
      slugClaims = new Map();
      for (const f of files) {
        if (!/\.md$/i.test(f)) continue;
        try {
          const s = splitFrontmatter(fs.readFileSync(path.join(vault, f), 'utf8')).data['station-slug'];
          if (!s) continue;
          const key = slugify(s);
          if (!slugClaims.has(key)) slugClaims.set(key, []);
          slugClaims.get(key).push(f);
        } catch {
          /* unreadable note — it can't claim anything */
        }
      }
    }
    return slugClaims.get(slug) ?? [];
  };
  // Adoption (the page's own note is gone — renamed or moved) needs a single, unambiguous claimant:
  // a renamed note and a copy of it both carry the same station-slug, and neither may win by racing.
  const orphanedAndClaimed = (p) => !!p.source && !liveIds.has(p.source) && claimed === p.slug;
  const isMine = (p) => p.source === id || (orphanedAndClaimed(p) && claimants(p.slug).every((f) => f === notePath));
  const mine = pages.filter(isMine);
  const atTarget = pages.find((p) => p.collection === collection && p.slug === slug);

  /* --- unpublish: remove every page that is this note's --- */
  if (opts.unpublish) {
    if (opts['dry-run']) return { ok: true, action: 'unpublish', dryRun: true, title, removes: mine.map((p) => `/${p.route}/${p.slug}/`) };
    if (!mine.length) {
      // Nothing left locally — but an earlier removal may still be waiting to be pushed:
      // only then (the page is still on GitHub) is there anything to push.
      if (useGit && !opts['no-push'] && (await upstreamHasSource(repo, id))) {
        const g = await commitAndPush(repo, [], `Unpublish: ${title}`, { push: true });
        return { ok: true, action: 'unpublished', title, removed: [], ...g, warnings };
      }
      throw new UserError('Nothing from this note is published.');
    }
    for (const p of mine) {
      rmrf(p.dir);
      rmrf(p.filesDir);
    }
    const g = useGit
      ? await commitAndPush(repo, mine.flatMap((p) => [p.dir, p.filesDir]), `Unpublish: ${title}`, { push: !opts['no-push'] })
      : { committed: false, pushed: false };
    const result = { ok: true, action: 'unpublished', title, removed: mine.map((p) => `/${p.route}/${p.slug}/`), ...g, warnings };
    if (!opts.json && !opts['no-write-back'] && (g.pushed || g.upToDate || !g.remote || opts['no-push'])) {
      writeBack(noteAbs, {}, ['station-published', 'station-url']);
    }
    return result;
  }

  if (!opts.force) {
    if (handWrittenAt(repo, collection, slug)) {
      throw new UserError(`There's already a hand-written page at /${route}/${slug}/ — choose a different web address.`);
    }
    if (atTarget && !isMine(atTarget)) {
      if (orphanedAndClaimed(atTarget)) {
        const names = claimants(slug).map((f) => `"${f.replace(/\.md$/i, '')}"`).join(', ');
        throw new UserError(
          `Several notes claim /${route}/${slug}/ (${names}) — change the web address (station-slug) of the one that shouldn't have it, then publish again.`,
        );
      }
      throw new UserError(`Another note is already published at /${route}/${slug}/ — choose a different web address.`);
    }
  }

  /* --- metadata --- */
  const prior = (atTarget && isMine(atTarget) ? atTarget : null) ?? mine.find((p) => p.collection === collection) ?? mine[0] ?? null;
  const priorFields = prior ? safeFrontmatter(prior.text) : {};
  const orbitIds = cfg.ORBITS.map((o) => o.id);
  const orbit = String(prop('orbit') ?? '').trim().toLowerCase();
  if (!orbitIds.includes(orbit)) {
    throw new UserError(orbit ? `Unknown orbit "${orbit}". Use one of: ${orbitIds.join(', ')}.` : `Choose an orbit: ${orbitIds.join(', ')}.`);
  }
  const summary = prop('summary') == null ? '' : oneLine(prop('summary'));
  const fields = { title };

  if (type === 'post') {
    const kinds = Object.keys(cfg.POST_KINDS);
    const kind = String(prop('kind') || 'essay').trim().toLowerCase();
    if (!kinds.includes(kind)) throw new UserError(`Unknown kind "${kind}". Use one of: ${kinds.join(', ')}.`);
    let project = prop('project') ? slugify(prop('project')) : undefined;
    if (project && !listProjects(repo).some((p) => p.id === project)) {
      warnings.push(`There's no Flight Log mission "${project}", so the post isn't filed under one.`);
      project = undefined;
    }
    Object.assign(fields, {
      date: asDate(prop('date'), 'station-date') ?? asDate(priorFields.date, 'date') ?? today(),
      updated: undefined,
      summary: summary || undefined,
      orbit,
      kind,
      tags: asList(prop('tags')),
      project,
    });
  } else {
    const status = String(prop('status') || 'PLANNED').trim().toUpperCase();
    if (!cfg.PROJECT_STATUSES.includes(status)) throw new UserError(`Unknown status "${status}". Use one of: ${cfg.PROJECT_STATUSES.join(', ')}.`);
    Object.assign(fields, {
      summary: summary || undefined,
      orbit,
      status,
      started: asDate(prop('started'), 'station-started') ?? undefined,
      ended: asDate(prop('ended'), 'station-ended') ?? undefined,
      order: prop('order') != null && prop('order') !== '' && !Number.isNaN(Number(prop('order'))) ? Number(prop('order')) : undefined,
      stack: asList(prop('stack')),
      repo: asUrl(prop('repo'), 'station-repo', warnings),
      demo: asUrl(prop('demo'), 'station-demo', warnings),
    });
  }

  /* --- body --- */
  const resolve = createResolver(files);
  const { strictLineBreaks } = readVaultSettings(vault);
  const assets = new Map(); // vault path → { src, dest, url }
  const used = new Set();
  const asset = (vaultPath, kind) => {
    const ext = extOf(vaultPath);
    if (NEVER_COPY.has(ext)) throw new UserError(`Refusing to publish "${vaultPath}" as a file.`); // last line of defence
    if (assets.has(vaultPath)) return assets.get(vaultPath).url;
    const base = slugify(path.basename(vaultPath, path.extname(vaultPath))) || 'file';
    const inPage = kind === 'image' && IMAGE_EXT.has(ext);
    let name = `${base}.${ext}`;
    for (let k = 2; used.has(`${inPage}:${name}`); k++) name = `${base}-${k}.${ext}`;
    used.add(`${inPage}:${name}`);
    const dest = inPage ? path.join(pageDir, name) : path.join(filesDir, name);
    const url = inPage ? `./${name}` : `/files/${collection}/${slug}/${name}`;
    assets.set(vaultPath, { src: path.join(vault, vaultPath), dest, url });
    return url;
  };
  const noteCache = new Map();
  const readNote = (p) => {
    if (!noteCache.has(p)) {
      try {
        noteCache.set(p, splitFrontmatter(fs.readFileSync(path.join(vault, p), 'utf8')));
      } catch {
        noteCache.set(p, { data: {}, body: '' });
      }
    }
    return noteCache.get(p);
  };
  /** Where another note is published: its own page, or (if it was renamed since) the page its station-slug claims. */
  const pageUrlOf = (p) => {
    if (p === notePath) return `/${route}/${slug}/`;
    const own = pages.filter((pg) => pg.source === sourceId(p));
    const s = readNote(p).data['station-slug'];
    const claimedPage = s ? pages.find((pg) => pg.slug === slugify(s) && pg.source && !liveIds.has(pg.source)) : null;
    const pg = own.find((x) => x.collection === 'posts') ?? own[0] ?? claimedPage;
    return pg ? `/${pg.route}/${pg.slug}/` : null;
  };

  const { markdown, embeds } = convertBody(body, {
    title,
    notePath,
    strictLineBreaks,
    resolve,
    readBody: (p) => readNote(p).body,
    pageUrl: pageUrlOf,
    asset,
    warnings,
  });

  if (type === 'post') {
    const cover = prop('cover');
    if (cover) {
      const hit = resolve(wikiTarget(cover), notePath);
      if (hit && IMAGE_EXT.has(extOf(hit.path))) {
        fields.cover = asset(hit.path, 'image');
        fields.coverAlt = prop('cover-alt') ? oneLine(prop('cover-alt')) : undefined;
        if (!fields.coverAlt) warnings.push('Add "station-cover-alt" to describe the cover image for screen readers.');
      } else warnings.push(`Cover image "${cover}" wasn't found in the vault — left out.`);
    }
  }
  if (!markdown.trim() && type === 'post') warnings.push('The note has no body text.');

  /* --- "updated": only when the words change on a later day --- */
  if (type === 'post' && prior) {
    const prevUpdated = asDate(priorFields.updated, 'updated') ?? undefined;
    const changed = bodyOf(prior.text) !== markdown.trim();
    fields.updated = changed && fields.date < today() ? today() : prevUpdated;
    if (fields.updated && fields.updated <= fields.date) fields.updated = undefined;
  }
  const output = `${emitFrontmatter(id, fields)}\n${markdown.trim()}\n`;
  const stale = mine.filter((p) => !(p.collection === collection && p.slug === slug));
  const unchanged = !!atTarget && isMine(atTarget) && atTarget.text === output && sameAssets(atTarget, assets);
  const action = unchanged ? 'unchanged' : atTarget ? 'updated' : stale.length ? 'moved' : 'published';

  const result = {
    ok: true,
    action,
    type,
    slug,
    collection,
    title,
    url: pageUrl,
    path: `/${route}/${slug}/`,
    fields: { ...fields },
    existing: mine.map((p) => `/${p.route}/${p.slug}/`),
    files: [pageFile, ...[...assets.values()].map((a) => a.dest)].map((f) => path.relative(repo, f).replaceAll('\\', '/')),
    embeds,
    warnings: [
      ...embeds.map((e) => `Included the full text of "${e}" (embedded) — it becomes public with this page.`),
      ...stale.map((p) => `Moves the page from /${p.route}/${p.slug}/ — the old address stops working.`),
      ...new Set(warnings),
    ],
  };
  if (opts['dry-run']) return { ...result, dryRun: true, markdown: output };

  /* --- write: stale pages go, the page folder is rebuilt from scratch --- */
  for (const p of stale) {
    rmrf(p.dir);
    rmrf(p.filesDir);
  }
  if (!unchanged) {
    rmrf(pageDir);
    rmrf(filesDir);
    fs.mkdirSync(pageDir, { recursive: true });
    for (const a of assets.values()) {
      fs.mkdirSync(path.dirname(a.dest), { recursive: true });
      fs.copyFileSync(a.src, a.dest);
    }
    fs.writeFileSync(pageFile, output);
  }

  let g = { committed: false, pushed: false };
  if (!useGit) g.note = opts['no-commit'] ? 'Files written; not committed.' : 'Not a git repository — files written only.';
  else {
    const verb = action === 'published' ? 'Publish' : action === 'moved' ? 'Move' : 'Update';
    g = await commitAndPush(repo, [pageDir, filesDir, ...stale.flatMap((p) => [p.dir, p.filesDir])], `${verb}: ${title}`, {
      push: !opts['no-push'],
    });
    if (g.branch && g.branch !== DEPLOY_BRANCH) result.warnings.push(`The site folder is on branch "${g.branch}" — the site only deploys from ${DEPLOY_BRANCH}.`);
  }
  const online = !!(g.remote && (g.pushed || g.upToDate) && g.branch === DEPLOY_BRANCH);
  const final = { ...result, ...g, online };

  if (!opts.json && !opts['no-write-back'] && (g.committed || action === 'unchanged')) {
    writeBack(
      noteAbs,
      {
        'station-slug': slug,
        ...(type === 'post' ? { 'station-date': fields.date } : {}),
        ...(online || opts['no-push'] ? { 'station-published': today(), ...(pageUrl ? { 'station-url': pageUrl } : {}) } : {}),
      },
      online && !pageUrl ? ['station-url'] : [],
    );
  }
  return final;
}

/* ---------- CLI ---------- */
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const out = (obj) => {
    if (opts.json) process.stdout.write(`${JSON.stringify(obj)}\n`);
    else if (!obj.ok) console.error(`\n  ✗ ${obj.error}\n`);
    else if (obj.markdown) {
      process.stdout.write(obj.markdown);
      for (const w of obj.warnings ?? []) console.error(`  · ${w}`);
    } else if (obj.orbits) console.log(JSON.stringify(obj, null, 2));
    else {
      console.log(`\n  ✓ ${obj.action.toUpperCase()}: ${obj.title}  →  ${obj.url ?? obj.path ?? (obj.removed ?? []).join(', ')}`);
      if (obj.note) console.log(`    ${obj.note}`);
      if (obj.error) console.log(`    ! ${obj.error}`);
      for (const w of obj.warnings ?? []) console.log(`    · ${w}`);
      console.log('');
    }
  };
  if (opts.help) {
    const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    console.log(src.split('=============================================================')[1]);
    return;
  }
  try {
    const repo = path.resolve(opts.repo ?? DEFAULT_REPO);
    out(opts.describe ? await describe(repo) : await publish(opts));
  } catch (e) {
    const missingDeps = /ERR_MODULE_NOT_FOUND|Cannot find (package|module)/.test(String(e?.code ?? '') + e?.message);
    out({
      ok: false,
      error:
        e instanceof UserError
          ? e.message
          : missingDeps
            ? 'Dependencies are missing — run "npm install" in the Orbital Station folder.'
            : `Unexpected error: ${e.message}`,
    });
    process.exitCode = 1;
  }
}

if (import.meta.main) main();
