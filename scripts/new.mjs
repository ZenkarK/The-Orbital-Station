#!/usr/bin/env node
/* =============================================================
   npm run new -- <type> "Title" [options]

   Types
     post        a transmission      → src/content/posts/<slug>.md
     project     a Flight Log entry  → src/content/projects/<slug>.md
     library     a library holding   → appended to src/content/library.yaml
     trajectory  a vision-board card → appended to src/content/trajectories.yaml

   Options (either --key value or key=value)
     orbit=systems|markets|craft|astro|venture|words
     kind=essay|build-log|field-note        (post)
     project=<project-slug>                 (post — files it under a mission)
     tags=a,b,c                             (post)
     folder                                 (post — creates <slug>/index.md for images)
     status=PLANNED|ACTIVE|COMPLETE|SCRUBBED (project)
     type=BOOK|PAPER|ESSAY|TOOL|FILM|COURSE|OTHER, author=…, shelf=…, link=… (library)
     horizon="NOW"|"THIS YEAR"|"SOMEDAY"    (trajectory)

   Examples
     npm run new -- post "Calibrating a CT gantry" orbit=systems kind=build-log
     npm run new -- project "Dark-sky tracker" orbit=astro status=PLANNED
     npm run new -- library "Thinking in Systems" type=BOOK author="Donella Meadows" orbit=systems
   ============================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = await import(new URL('../src/site.config.ts', import.meta.url).href).catch(() => null);
if (!cfg) fail('Could not read src/site.config.ts — this script needs Node 22.18 or newer.');

const ORBIT_IDS = cfg.ORBITS.map((o) => o.id);
const KINDS = Object.keys(cfg.POST_KINDS);

/* ---------- args ---------- */
const [type, title, ...rest] = process.argv.slice(2);
const opts = {};
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) opts[key] = true;
    else (opts[key] = next), i++;
  } else if (a.includes('=')) {
    const [k, ...v] = a.split('=');
    opts[k] = v.join('=');
  } else if (a === 'folder') opts.folder = true;
}

const TYPES = ['post', 'project', 'library', 'trajectory'];
if (!TYPES.includes(type) || !title) {
  console.log(`
  Usage:  npm run new -- <${TYPES.join('|')}> "Title" [key=value …]

  e.g.    npm run new -- post "What I learned wiring Helios" orbit=markets kind=build-log project=helios
          npm run new -- project "Dark-sky tracker" orbit=astro
          npm run new -- library "Thinking in Systems" author="Donella Meadows" orbit=systems
          npm run new -- trajectory "Run a marathon" orbit=craft horizon="THIS YEAR"
`);
  process.exit(type ? 1 : 0);
}

/* ---------- helpers ---------- */
function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}
const slugify = (s) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const q = (s) => JSON.stringify(String(s)); // safe YAML scalar
const pick = (name, value, allowed, fallback) => {
  const v = value ?? fallback;
  if (!allowed.includes(v)) fail(`${name} must be one of: ${allowed.join(', ')} (got "${v}")`);
  return v;
};
const rel = (p) => path.relative(root, p).replaceAll('\\', '/');

const slug = slugify(title);
if (!slug) fail('That title has no letters or numbers to make a URL from.');
const orbit = pick('orbit', opts.orbit, ORBIT_IDS, type === 'post' ? 'words' : 'systems');

/* ---------- post ---------- */
if (type === 'post') {
  const kind = pick('kind', opts.kind, KINDS, 'essay');
  const dir = path.join(root, 'src/content/posts');
  const file = opts.folder ? path.join(dir, slug, 'index.md') : path.join(dir, `${slug}.md`);
  if (fs.existsSync(file) || fs.existsSync(path.join(dir, slug, 'index.md')) || fs.existsSync(path.join(dir, `${slug}.md`)))
    fail(`A post called "${slug}" already exists.`);
  if (opts.project && !fs.existsSync(path.join(root, 'src/content/projects', `${opts.project}.md`)))
    fail(`No project "${opts.project}" in src/content/projects.`);
  const tags = opts.tags ? String(opts.tags).split(',').map((t) => t.trim()).filter(Boolean) : [];
  const fm = [
    '---',
    `title: ${q(title)}`,
    `date: ${today()}`,
    `summary: ""  # one or two sentences for lists, search, RSS and link previews (blank = opening lines)`,
    `orbit: ${orbit}`,
    `kind: ${kind}`,
    `tags: [${tags.map(q).join(', ')}]`,
    opts.project ? `project: ${opts.project}` : `# project: helios  # optional — files this under a Flight Log mission`,
    `draft: true  # delete this line (or set false) to publish`,
    '---',
    '',
    'Start writing here. Markdown works: **bold**, *italics*, [links](https://example.com), lists, `code`, and',
    'fenced code blocks with a language for highlighting.',
    '',
    '## A section heading',
    '',
    'Posts with three or more section headings get a Contents panel automatically.',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, fm);
  console.log(`
  ✓ Created ${rel(file)}

    It's a DRAFT: visible at http://localhost:4321/transmissions/${slug}/ while "npm run dev" runs,
    left out of the live site until you remove "draft: true".
`);
}

/* ---------- project ---------- */
if (type === 'project') {
  const status = pick('status', opts.status, cfg.PROJECT_STATUSES, 'PLANNED');
  const file = path.join(root, 'src/content/projects', `${slug}.md`);
  if (fs.existsSync(file)) fail(`A project called "${slug}" already exists.`);
  const fm = [
    '---',
    `title: ${q(title)}`,
    `summary: ""  # one line for the Flight Log (blank = opening lines of the brief)`,
    `orbit: ${orbit}`,
    `status: ${status}`,
    `started: ${today()}`,
    `# ended: 2026-12-31`,
    `order: 100  # lower numbers list first`,
    `stack: []   # e.g. [Python, PostgreSQL]`,
    `# repo: https://github.com/you/${slug}`,
    `# demo: https://…`,
    '---',
    '',
    '## Objective',
    '',
    'What this mission is for, in a sentence or two.',
    '',
    '## Flight plan',
    '',
    '1. First milestone',
    '2. Second milestone',
    '',
  ].join('\n');
  fs.writeFileSync(file, fm);
  console.log(`
  ✓ Created ${rel(file)} — live at /log/${slug}/

    Link build logs to it by adding  project: ${slug}  to a post's frontmatter.
`);
}

/* ---------- YAML-backed collections ---------- */
function appendYaml(fileRel, id, lines) {
  const file = path.join(root, fileRel);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (new RegExp(`^- id: ${id}\\s*$`, 'm').test(text)) fail(`An entry with id "${id}" already exists in ${fileRel}.`);
  const block = ['', `- id: ${id}`, ...lines.filter(Boolean).map((l) => `  ${l}`), ''].join('\n');
  fs.writeFileSync(file, text.replace(/\s*$/, '\n') + block);
  console.log(`\n  ✓ Added "${title}" to ${fileRel}\n`);
}

if (type === 'library') {
  const libType = pick('type', opts.type?.toUpperCase(), cfg.LIBRARY_TYPES, 'BOOK');
  const shelf = pick('shelf', opts.shelf?.toUpperCase(), cfg.LIBRARY_SHELVES, 'QUEUE');
  if (opts.link && !/^https?:\/\//.test(opts.link)) fail('link must start with http:// or https://');
  appendYaml('src/content/library.yaml', slug, [
    `type: ${libType}`,
    `title: ${q(title)}`,
    opts.author && `author: ${q(opts.author)}`,
    `orbit: ${orbit}`,
    `shelf: ${shelf}`,
    opts.link && `link: ${opts.link}`,
    `note: ${q(opts.note ?? '')}`,
    `added: ${today()}`,
  ]);
}

if (type === 'trajectory') {
  const horizon = pick('horizon', opts.horizon?.toUpperCase(), cfg.HORIZONS, 'THIS YEAR');
  appendYaml('src/content/trajectories.yaml', slug, [
    `title: ${q(title)}`,
    `orbit: ${orbit}`,
    `horizon: ${horizon}`,
    `note: ${q(opts.note ?? '')}`,
  ]);
}
