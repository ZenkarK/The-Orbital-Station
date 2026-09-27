# Orbital Station

The personal site and blog of Zenkar: essays, build logs and field notes from six orbits.

Every post, project, library holding and trajectory is a plain text file in this repository. Astro turns them into a fast static website with no database, no server and no tracking. It's hosted free on GitHub Pages: **push to `main` and the site rebuilds itself in about a minute.**

You can write in two ways:

- **In Obsidian** — press the 📡 button on any note. It's converted, committed and pushed for you ([§2](#2-publishing-from-obsidian)).
- **In this repo** — Markdown files under `src/content/` ([§4](#4-writing-directly-in-the-repo)).

---

## 1. Going live (one-time setup)

The repository already exists locally with its history. To put it online:

1. **Create an empty repository on GitHub.** Go to <https://github.com/new>, name it (e.g. `orbital-station`) and choose **Public**. GitHub Pages is free for public repos. Don't add a README or .gitignore.
2. **Connect and push.** In a terminal in this folder:
   ```
   git remote add origin https://github.com/<you>/orbital-station.git
   git push -u origin main
   ```
   The first push opens a GitHub sign-in window (Git Credential Manager). After that, pushes, including the ones from Obsidian, just work.
3. **Turn on Pages.** On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The workflow in `.github/workflows/deploy.yml` then tests, builds and deploys every push to `main`. Watch it under the **Actions** tab. The run triggered by your first push probably failed because Pages wasn't on yet. Open **Actions → Deploy to GitHub Pages → Run workflow** once to deploy.

Your address is worked out automatically:

| Repository name | Site address |
| --- | --- |
| `<you>.github.io` | `https://<you>.github.io/` |
| anything else, e.g. `orbital-station` | `https://<you>.github.io/orbital-station/` |
| custom domain (Settings → Pages → Custom domain) | your domain — also enter it in the Obsidian plugin's *Site address* setting |

Prefer Netlify, Cloudflare Pages or Vercel? See [§7](#7-other-hosts).

---

## 2. Publishing from Obsidian

### Install the button (once)

```
npm run obsidian:install
```

This copies the **Orbital Station Publisher** plugin into your vault (`C:\Zenkar's Vault`, or pass a path: `npm run obsidian:install -- "D:\Other Vault"`). It points the plugin at this folder and at Node.js, and turns it on. Your other plugins and settings are left as they are. Then:

- If Obsidian was open, enable it once under **Settings → Community plugins** → *Orbital Station Publisher*.
- If Obsidian says community plugins are in **restricted mode**, turn restricted mode off on the same page.
- Run the command again whenever the plugin is updated, then reload Obsidian (<kbd>Ctrl</kbd>+<kbd>R</kbd>).

### Publish a note

1. Open the note and click the **satellite-dish icon** in the left ribbon. Alternatively, right-click the note → *Orbital Station: publish*, or use the command palette → *Publish current note*.
2. Check the dialog. It's pre-filled: page type (blog post or Flight Log project), title, web address, orbit, kind, date, summary, tags and mission. The grey box underneath is a dry run. It shows whether this creates, updates or moves a page, and **warns before anything else becomes public**: embedded notes, links that turn into plain text, missing images.
3. Press **Transmit** (or <kbd>Ctrl</kbd>+<kbd>Enter</kbd>).

The note is converted, committed, and pushed; a notice links to the page, which is live after GitHub finishes building (~1 minute). The status bar shows **◉ ON AIR** once the page is really online, and **○ OFFLINE** otherwise.

- **Update** a published note: edit it, then press the button again (or *Republish current note (skip the dialog)*). Unchanged notes are skipped. Edits to older posts get an "Updated" date; the original date is kept.
- **Change its address or type:** edit *Web address* or *Page type* in the dialog. The old page is removed in the same step. (Old links to it stop working.)
- **If a push fails** (offline, not signed in), the change is committed in the site folder and the notice says so. Press Transmit again later and it pushes the waiting change.
- **The publisher only pushes its own changes.** If you've committed other work in the site folder (say, a design tweak) that isn't on GitHub yet, it won't push that for you. Push it yourself when it's ready (`git push`), and the waiting page goes out with it.
- **Take it down:** command palette → *Unpublish current note*. The note's text stays as it is; only its `station-published`/`station-url` properties are cleared.
- **Check setup** (Settings → Orbital Station Publisher → *Run check*) confirms Node, git, the branch and the GitHub remote.

A page belongs to the note it was published from. Renaming or moving the note keeps the connection. A *copy* of a note can never replace, move or remove the original's page: pick a new web address for it. Pages you wrote by hand in the repo are never touched.

### What gets converted

| In your note | On the site |
| --- | --- |
| `$S = A/4G\hbar$`, `$$ … $$` | Rendered equations (KaTeX). Dollar amounts like `$5 and $10` stay text, as in Obsidian. |
| `> [!note] Title`, `> [!faq]-` | Styled callouts; `-` / `+` make them foldable. |
| `[[Other note]]`, `[[Note#Heading\|text]]` | A link, **if that note is published**; otherwise just the text. |
| `![[figure.png\|300]]`, `![](figure.png)` | The image, copied next to the post and optimized. |
| `![[paper.pdf]]`, `![[clip.mp3]]`, `![[run.mp4]]` | A download link / audio player / video player. |
| `![[Other note]]`, `![[Note#Section]]`, `![[Note#^block]]` | That content, included inline. |
| `==highlight==`, `^[inline footnote]` | Highlight, numbered footnote. |
| `# Title` as the first line | Dropped (the page shows the title). |
| `%% comments %%`, `<!-- comments -->`, `^block-ids`, lines of only `#tags` | **Removed.** |
| `dataview` / `tasks` / `query` blocks, `.canvas`, `.base`, Excalidraw drawings | Removed (they only work inside Obsidian). Export drawings as PNG/SVG to publish them. |

### Privacy: what goes public

- Only the note's text and its `station-*` properties are published. Your other properties (`tags`, `url`, `aliases`, …) never leave the vault. The public tags are only the ones you type into the dialog's *Tags* field.
- `%% comments %%` and `<!-- comments -->` are stripped, so they're the place for private asides.
- Links to unpublished notes become plain text, so private note names aren't linked.
- **Embeds are included in full.** `![[Private note]]` inside a published note publishes that content. The dialog's dry-run box names every embedded note **before** you transmit. A `#^block` embed includes only that block (for a list item, only that item).

### Note properties

The dialog writes these for you. Edit them by hand if you prefer:

```yaml
station: post                 # post | project
station-title: Relativistic jets, revisited      # default: the note's file name
station-slug: relativistic-jets                   # the web address (keep it stable)
station-orbit: astro          # systems | markets | craft | astro | venture | words
station-kind: field-note      # posts: essay | build-log | field-note
station-status: ACTIVE        # projects: PLANNED | ACTIVE | COMPLETE | SCRUBBED
station-date: 2026-09-26       # blank = keep the page's date (today for a new page)
station-summary: One or two sentences.
station-tags: [astrophysics, jets]   # public tags; your own `tags` are never used
station-project: helios       # file a post under a Flight Log mission
station-cover: "[[jet.png]]"  # optional hero image + social card
station-cover-alt: Sketch of a jet
station-published: 2026-09-26 # written back once the page is online
station-url: https://…        # written back once the page is online
```

Properties are only written back **after** a successful publish. A failed attempt leaves the note exactly as it was.

Projects also accept `station-started`, `station-ended`, `station-stack`, `station-repo` and `station-demo`.

### From the command line

The button runs the same script you can call directly:

```
npm run publish:note -- "C:\Zenkar's Vault\Astrophysics\Jets.md" --dry-run   # preview the converted page
npm run publish:note -- "C:\Zenkar's Vault\Astrophysics\Jets.md"             # publish, commit, push
npm run publish:note -- --help
```

Like the button, the command line records `station-slug`, `station-date` and (once online) `station-published`/`station-url` in the note, so the plugin recognizes pages published either way.

Pages published from Obsidian live in `src/content/posts/<slug>/` with a header saying so. Edit the note and republish rather than editing those files, because they're overwritten. The publisher refuses to overwrite a page you wrote by hand in the repo.

---

## 3. Running it locally

You need **Node.js 22.18 or newer**; this machine has Node 24 LTS in `%LOCALAPPDATA%\Programs\nodejs`. In a terminal opened in this folder:

| Command | What it does |
| --- | --- |
| `npm install` | Installs dependencies (first time only, or after pulling changes). |
| `npm run dev` | Live preview at <http://localhost:4321>. Pages reload as you save. **Drafts are shown.** |
| `npm run new -- …` | Scaffolds new content in the repo (see §4). |
| `npm run publish:note -- <note>` | Publishes an Obsidian note (see §2). |
| `npm run obsidian:install` | Installs/updates the Obsidian plugin. |
| `npm test` | Runs the publisher and Markdown test suite. |
| `npm run check` | Type-checks the site and validates every content file's frontmatter. |
| `npm run check:plugin` | Type-checks the Obsidian plugin against Obsidian's API. |
| `npm run build` | Builds the production site into `dist/`. **Drafts are left out.** |
| `npm run preview` | Serves the built `dist/` folder exactly as it will be deployed. |

To preview a production build *with* drafts: `SHOW_DRAFTS=true npm run build` (PowerShell: `$env:SHOW_DRAFTS='true'; npm run build`).

---

## 4. Writing directly in the repo

```
npm run new -- post "Calibrating a CT gantry" orbit=systems kind=build-log
```

That creates `src/content/posts/calibrating-a-ct-gantry.md` as a **draft**. Write in Markdown, check it in `npm run dev`, delete the `draft: true` line, then commit and push.

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

Headings (`##`, `###`), **bold**, *italics*, links, lists, task lists, quotes, tables, footnotes, images, and fenced code blocks with syntax highlighting (` ```python `). The same Obsidian extras work here too: `$math$` / `$$math$$` and `> [!note]` callouts. Write a literal dollar as `\$` when it could look like math. Code blocks get a language label and a **COPY** button. Posts with three or more `##`/`###` headings get a **Contents** sidebar.

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

Name a file `.mdx` instead of `.md` to use components inside a post. Plain `.md` is recommended, because those posts also go out in full over RSS.

---

## 5. The rest of the station

| Section | Where it lives | Add with |
| --- | --- | --- |
| **Flight Log** (projects) | `src/content/projects/<slug>.md` — or publish a note as a *Mission* from Obsidian | `npm run new -- project "Name" orbit=astro status=ACTIVE` |
| **Library** (books, papers, tools) | `src/content/library.yaml` — listed in file order | `npm run new -- library "Title" type=BOOK author="Name" orbit=systems shelf=READING` |
| **Trajectories** (goals) | `src/content/trajectories.yaml` — set `reached: true` when you arrive | `npm run new -- trajectory "Goal" orbit=craft horizon=NOW` |
| **Orrery / current phase** | `ORBITS[].clock` in `src/site.config.ts` | Edit by hand when the season changes |
| **Manual** | `src/pages/manual.astro` | Edit by hand |
| **Observer** (about) | `src/pages/observer.astro` | Edit by hand |

**Project frontmatter:** `title`, `summary`, `orbit`, `status` (`PLANNED | ACTIVE | COMPLETE | SCRUBBED`), and optionally `started`, `ended`, `order` (lower lists first), `stack: [..]`, `repo: https://…`, `demo: https://…`.

**Setting the orrery.** Each orbit's `clock` is where its body sits on a clock face: `12:00` is NEAR (what this season is for), `6:00` is FAR. Update the clocks and `PHASE_LOGGED`, then push. Visitors can drag the bodies around, but nothing they move is saved.

---

## 6. Make it yours before launch

Open `src/site.config.ts`:

1. **Channels.** Fill in `email`, `github`, `linkedin` and so on. Anything left empty is hidden, so no placeholder links ever go live.
2. **Name, description, latitude.** Check the `SITE` block.
3. **Social card.** `public/og.png` is the default link-preview image (1200×630). Posts with a cover use that instead.

---

## 7. Other hosts

Netlify, Cloudflare Pages and Vercel detect Astro automatically. Import the GitHub repository in their dashboard. If asked: build command `npm run build`, output directory `dist`, Node version from `.nvmrc` (24). The site URL is picked up from the host. With a custom domain, set the environment variable `SITE_URL=https://yourdomain.com`, and the same address in the Obsidian plugin's *Site address* setting.

---

## 8. What's in the box

- **Pages:** Bridge (home + interactive orrery), Transmissions (filterable by orbit and kind, with year archive, tags and prev/next), Flight Log with per-mission pages, Library (shelf filters), Trajectories, one page per orbit, Manual, Observer, Search, and a 404.
- **Reading:** light and dark themes, self-hosted fonts, KaTeX math, callouts, reading times, table of contents, copy buttons on code, print styles.
- **Discovery:** RSS at `/rss.xml` (full text), `sitemap-index.xml`, `robots.txt`, canonical URLs, Open Graph/Twitter cards, and `BlogPosting` structured data.
- **Search:** press <kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>K</kbd> anywhere. The index is built at deploy time (`/search.json`) with no third-party service.
- **Accessibility:** skip link, keyboard-operable orrery, visible focus, reduced-motion support, and WCAG AA text contrast in both themes.

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
├── lib/markdown-plugins.mjs ← math, callouts, base-path links
├── styles/global.css     ← the whole design system (tokens at the top)
└── scripts/search.ts
obsidian-plugin/          ← the Obsidian "Transmit" button (installed by npm run obsidian:install)
scripts/obsidian/         ← the publisher: convert.mjs, publish.mjs, install.mjs
scripts/new.mjs           ← `npm run new` scaffolder
tests/                    ← publisher + Markdown tests (npm test)
prototype/                ← the original single-file rev 4, kept for reference (not built)
```
