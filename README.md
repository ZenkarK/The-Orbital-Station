# Orbital Station

The personal site and blog of Zenkar: essays, build logs and field notes from six orbits.

Every post, project, library holding and trajectory is a plain text file in this repository. Astro turns them into a fast static website with no database, no server and no tracking. You can host it for free on GitHub Pages, Netlify, Cloudflare Pages or Vercel.

```
npm install        # once
npm run dev        # live preview at http://localhost:4321 (drafts included)
npm run new -- post "My next transmission"
npm run build      # production build → dist/
```

---

## 1. Running it locally

You need **Node.js 22.18 or newer**; this machine has Node 24 LTS in `%LOCALAPPDATA%\Programs\nodejs`. In a terminal opened in this folder:

| Command | What it does |
| --- | --- |
| `npm install` | Installs dependencies (first time only, or after pulling changes). |
| `npm run dev` | Starts the live preview at <http://localhost:4321>. Pages reload as you save. **Drafts are shown.** |
| `npm run new -- …` | Scaffolds new content (see below). |
| `npm run check` | Type-checks the code and validates every content file's frontmatter. |
| `npm run build` | Builds the production site into `dist/`. **Drafts are left out.** |
| `npm run preview` | Serves the built `dist/` folder locally, exactly as it will be deployed. |

To preview a production build *with* drafts, run `SHOW_DRAFTS=true npm run build` (PowerShell: `$env:SHOW_DRAFTS='true'; npm run build`).

---

## 2. Writing a transmission (blog post)

```
npm run new -- post "Calibrating a CT gantry" orbit=systems kind=build-log
```

That creates `src/content/posts/calibrating-a-ct-gantry.md` as a **draft**. Write in Markdown, check it in `npm run dev`, then delete the `draft: true` line to publish it.

### Frontmatter

```yaml
---
title: Calibrating a CT gantry          # required
date: 2026-10-03                        # required — publication date
updated: 2026-10-10                     # optional — shows "UPDATED" at the end
summary: One or two sentences.          # optional — lists, search, RSS, link previews
                                        #   (blank = the first paragraph is used)
orbit: systems                          # systems | markets | craft | astro | venture | words
kind: build-log                         # essay | build-log | field-note   (default: essay)
tags: [ct, calibration]                 # optional — each gets a /tags/<tag>/ page
project: helios                         # optional — files the post under a Flight Log mission
cover: ./cover.jpg                      # optional — hero image + social card (folder posts)
coverAlt: The gantry at 2 a.m.          # describe the cover for screen readers
draft: true                             # remove to publish
---
```

### Kinds: what to write where

- **Essay** — considered writing: ideas, arguments, reflections.
- **Build log** — progress on a project. Add `project: <slug>` and it appears on that mission's page.
- **Field note** — short things you learned: a technique, a fix, a reading note, a surprising result.

### Markdown you can use

Headings (`##`, `###`), **bold**, *italics*, links, lists, task lists, quotes, tables, footnotes, images, and fenced code blocks with syntax highlighting (` ```python `). Code blocks get a language label and a **COPY** button automatically. Posts with three or more `##`/`###` headings get a **Contents** sidebar.

The draft post **Markdown field guide** (`src/content/posts/markdown-field-guide/`) demonstrates every element. It never publishes, so keep it as a cheat sheet.

### Images

Make the post a folder and keep images beside it:

```
npm run new -- post "Night sky log" orbit=astro folder
```

```
src/content/posts/night-sky-log/
├── index.md
└── m31.jpg        →  ![The Andromeda galaxy](./m31.jpg)
```

Astro resizes and optimizes the images at build time. Always write alt text.

### MDX

Name a file `.mdx` instead of `.md` to use components inside a post. Plain `.md` is recommended: those posts also go out in full over RSS.

---

## 3. The rest of the station

| Section | Where it lives | Add with |
| --- | --- | --- |
| **Flight Log** (projects) | `src/content/projects/<slug>.md` — frontmatter + a mission brief in Markdown | `npm run new -- project "Name" orbit=astro status=ACTIVE` |
| **Library** (books, papers, tools) | `src/content/library.yaml` — listed in file order | `npm run new -- library "Title" type=BOOK author="Name" orbit=systems shelf=READING` |
| **Trajectories** (goals) | `src/content/trajectories.yaml` — set `reached: true` when you arrive | `npm run new -- trajectory "Goal" orbit=craft horizon=NOW` |
| **Orrery / current phase** | `ORBITS[].clock` in `src/site.config.ts` | Edit by hand when the season changes |
| **Manual** | `src/pages/manual.astro` | Edit by hand |
| **Observer** (about) | `src/pages/observer.astro` | Edit by hand |

**Project frontmatter:** `title`, `summary`, `orbit`, `status` (`PLANNED | ACTIVE | COMPLETE | SCRUBBED`), and optionally `started`, `ended`, `order` (lower lists first), `stack: [..]`, `repo: https://…`, `demo: https://…`.

**Setting the orrery.** Each orbit's `clock` is where its body sits on a clock face: `12:00` is NEAR (what this season is for), `6:00` is FAR. Update the clocks and `PHASE_LOGGED`, then redeploy. The Bridge, Manual, orbit pages and Observer all follow. Visitors can drag the bodies around, but nothing they move is saved.

---

## 4. Make it yours before launch

Open `src/site.config.ts`:

1. **Channels.** Fill in `email`, `github`, `linkedin` and so on. Anything left empty is hidden, so no placeholder links ever go live.
2. **Name, description, latitude.** Check the `SITE` block.
3. **Social card.** `public/og.png` is the default link-preview image (1200×630). Replace it if you like. Posts with a `cover` use that image instead.

---

## 5. Publishing

The site builds to plain static files, so any static host works. Pick one:

### Option A — GitHub Pages (workflow included)

1. Create a GitHub repository and push this folder to its `main` branch:
   ```
   git init
   git add .
   git commit -m "Orbital Station rev 5"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` checks, builds and deploys on every push to `main`. The URL and sub-folder are detected automatically:
   - repo named `<you>.github.io` → `https://<you>.github.io/`
   - any other repo name → `https://<you>.github.io/<repo>/`
   - custom domain (Settings → Pages → Custom domain) → your domain

### Option B — Netlify, Cloudflare Pages or Vercel

Import the repository in their dashboard. They detect Astro automatically. If asked:

- Build command: `npm run build`
- Output directory: `dist`
- Node version: read from `.nvmrc` (24)

The site URL is picked up from the host automatically. Once you attach a custom domain, set an environment variable `SITE_URL=https://yourdomain.com` so canonical links, RSS and the sitemap use it.

### After launch

Publishing a post is: write it, remove `draft: true`, commit, push. The site rebuilds in about a minute.

---

## 6. What's in the box

- **Pages:** Bridge (home + interactive orrery), Transmissions (filterable by orbit and kind, with year archive, tags and prev/next), Flight Log with per-mission pages, Library (shelf filters), Trajectories, one page per orbit, Manual, Observer, Search, and a 404.
- **Reading:** light and dark themes (remembered per visitor), self-hosted fonts, reading times, table of contents, copy buttons on code, print styles.
- **Discovery:** RSS at `/rss.xml` (full text), `sitemap-index.xml`, `robots.txt`, canonical URLs, Open Graph/Twitter cards, and `BlogPosting` structured data.
- **Search:** press <kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>K</kbd> anywhere. The index is built at deploy time (`/search.json`) with no third-party service.
- **Accessibility:** skip link, keyboard-operable orrery (focus a body, use the arrow keys), visible focus, reduced-motion support, and WCAG AA text contrast in both themes.

```
src/
├── site.config.ts        ← identity, channels, orbits, vocabularies
├── content.config.ts     ← content schemas (what frontmatter is allowed)
├── content/
│   ├── posts/            ← transmissions (.md / .mdx, or folders with index.md)
│   ├── projects/         ← Flight Log missions
│   ├── library.yaml
│   └── trajectories.yaml
├── pages/                ← one file per route
├── components/           ← Orrery, Header, Footer, SearchDialog, …
├── layouts/Base.astro    ← <head>, SEO, header/footer shell
├── styles/global.css     ← the whole design system (tokens at the top)
└── scripts/search.ts
scripts/new.mjs           ← `npm run new` scaffolder
prototype/                ← the original single-file rev 4, kept for reference (not built)
```
