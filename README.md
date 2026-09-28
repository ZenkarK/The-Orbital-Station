# Orbital Station

The personal site and blog of Zenkar: essays, build logs and field notes from twelve orbits.

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

Every push and pull request also runs `.github/workflows/ci.yml`: type/content checks, the
test suite, a build, a full-history secret scan (gitleaks), and a scan of every committed
image/audio/video file for leftover metadata. `deploy.yml` only builds and publishes once
those checks are green. A pull request shows all of this as status checks before you merge.

Your address is worked out automatically:

| Repository name | Site address |
| --- | --- |
| `<you>.github.io` | `https://<you>.github.io/` |
| anything else, e.g. `orbital-station` | `https://<you>.github.io/orbital-station/` |
| custom domain (Settings → Pages → Custom domain) | your domain — also enter it in the Obsidian plugin's *Site address* setting |

**Buying a custom domain later?** Set it under **Settings → Pages → Custom domain** (GitHub
handles the DNS check and HTTPS certificate), then commit a `public/CNAME` file in this repo
containing just the domain, e.g. `zenkar.dev`. `deploy.yml` already switches its origin and
base path to it automatically (`configure-pages`'s output), and `public/CNAME` is the same
fallback the build (`astro.config.mjs`) and the publisher (`siteUrlFor`) use everywhere else —
GitHub Pages, another host, or `npm run build` on your machine — so canonical URLs, RSS, the
JSON Feed and the sitemap all move to the new domain with no other change. Update the
Obsidian plugin's *Site address* setting to match.

Prefer Netlify, Cloudflare Pages or Vercel? See [§7](#7-other-hosts).

---

## 2. Publishing from Obsidian

### Install the button (once)

```
npm run obsidian:install
```

Run it from Windows PowerShell or Command Prompt, not WSL — Obsidian runs on Windows and can't use WSL's Node.js or `/mnt/c/…` paths, so the script refuses to run there. This copies the **Orbital Station Publisher** plugin into your vault (`C:\Zenkar's Vault`, or pass a path: `npm run obsidian:install -- "D:\Other Vault"`). It points the plugin at this folder and at Node.js, and turns it on. Your other plugins and settings are left as they are. Then:

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

### The gates, before anything goes public

Every dry run shows what a real publish would do, and a real publish stops for anything
below before it writes, commits or pushes a thing.

- **Sensitive folders.** A note (or an embedded note, or a copied attachment) filed under
  `Work`, `Finance`, `Health` or `Family and Friends` needs a deliberate yes: the dialog
  shows a checkbox naming why, and you have to tick it. From the command line, pass
  `--confirm-sensitive`. Change the list in `src/site.config.ts` → `SENSITIVE_FOLDERS`.
- **Orbit visibility.** Each orbit is `public` (the usual case), `phase-only` (its body and
  phase show on the Bridge and its own page, but nothing filed there is listed anywhere),
  or `hidden` (the orbit doesn't appear at all). BODY and KIN start `phase-only`, since
  they're the innermost, most personal orbits. Publishing into a non-public orbit needs the
  same deliberate yes as a sensitive folder. Change an orbit's `visibility` in
  `src/site.config.ts` → `ORBITS`.
- **Secret scanning.** Every publish scans the converted page and any copied attachments
  for things that look like API keys, tokens, private keys or other high-entropy secrets,
  and blocks the publish if it finds one — naming the file and line, never the value. If
  something is flagged that genuinely isn't a secret, the message tells you the fingerprint
  to add to `.secrets-allow` in the repo root. Run the same scan over everything already in
  the repo any time with `npm run scan:secrets`.
- **Clean-room attachments.** Every image, PDF, audio and video file is stripped of hidden
  metadata (GPS, author names, embedded paths) before it leaves the vault. A file type with
  no scrubber available is blocked by default; `--allow-metadata` (command line only) copies
  it through unscrubbed, with a warning, and never bypasses the secret scan. Photo GPS and
  document authorship scrub best with **ExifTool** and video/audio with **ffmpeg** on your
  `PATH` — without them, some formats (HEIC, WebM, OGG, Opus, AAC) are blocked rather than
  published unscrubbed. `npm run scan:media` re-checks everything already committed
  under `public/` and `src/content/`, and `-- --fix` cleans what it can in place.
- **NEAR capacity.** The Manual's rule is that only a few orbits honestly run NEAR (close,
  hot, this season) at once. `NEAR_CAPACITY` in `src/site.config.ts` sets that ceiling; the
  build warns when more orbits than that sit NEAR, and the Bridge's telemetry caption says
  so plainly ("N NEAR · CAPACITY C — over capacity") rather than pretending everything is fine.

### Note properties

The dialog writes these for you. Edit them by hand if you prefer:

```yaml
station: post                 # post | project
station-title: Relativistic jets, revisited      # default: the note's file name
station-slug: relativistic-jets                   # the web address (keep it stable)
station-orbit: astro          # any orbit id; blank = the orbit that claims the note's vault folder
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
npm run publish:note -- "C:\Zenkar's Vault\Work\Notes.md" --confirm-sensitive # the dialog's checkbox, from the CLI
npm run publish:note -- --help
```

`--confirm-sensitive` is the CLI equivalent of the dialog's sensitive-area checkbox
(needed for a sensitive folder or a non-public orbit). `--allow-metadata` copies an
attachment the clean-room step would otherwise block, unchanged, with a warning — it
never bypasses the secret scan. See "The gates, before anything goes public" above.

Like the button, the command line records `station-slug`, `station-date` and (once online) `station-published`/`station-url` in the note, so the plugin recognizes pages published either way.

### The launch queue

Line notes up before you send them: give a note the checkbox property `station-queue` (and
`station-orbit` if its folder's orbit isn't the one you want). Then, in Obsidian, run
**Orbital Station: Open transmission queue** from the command palette. It writes (and keeps
current) `Transmission Queue.base` at the vault root, a live table of queued notes grouped by
target orbit, and tells you how close launch is: at least 8 transmissions across at least 5
public orbits. Notes in sensitive folders never appear in the Base; a queued one, or one aimed
at a phase-only or hidden orbit, is flagged. The same report from a terminal:

```
npm run queue -- --vault "C:Zenkar's Vault"                # the queue + launch count; exits 1 if a note is flagged
npm run queue -- --vault "C:Zenkar's Vault" --write-base   # also write the Base
```

A `Transmission Queue.base` you made yourself (without the publisher's header) is never overwritten.

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
orbit: systems                          # body | kin | mind | growth | language | astro | craft | voyage | words | systems | markets | venture
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

### Social cards

Every transmission, mission and orbit page gets its own link-preview image (1200×630,
`/og/transmissions/<slug>.png`, `/og/log/<slug>.png`, `/og/orbits/<id>.png`), generated
automatically at build time — a post's own `cover` still only shows in the article
itself, not in link previews, so every share looks consistent. A page with no card of
its own (search, the home page, a hidden orbit, …) falls back to `public/og.png`.

To change how a card looks, edit `src/lib/og-card.ts` (the layout: dark ground, the
orbit's colour as the one strong accent, the mono meta line, the Archivo title, the
station's name and author at the foot — built with [Satori](https://github.com/vercel/satori)
and rasterized with `sharp`). How far a long title steps its size down before it's
ellipsized lives separately in `src/lib/og-title-fit.ts`, unit-tested in
`tests/site/og-title-fit.test.mjs`. Regenerate `public/og.png` by hand if you redesign
it — keep it at 1200×630 and well under 100 KB (`sharp(...).png({ palette: true,
compressionLevel: 9, effort: 10 })` got the current one from 157 KB down to ~70 KB with
no visible loss).

---

## 5. The rest of the station

| Section | Where it lives | Add with |
| --- | --- | --- |
| **Flight Log** (projects) | `src/content/projects/<slug>.md` — or publish a note as a *Mission* from Obsidian | `npm run new -- project "Name" orbit=astro status=ACTIVE` |
| **Library** (books, papers, tools) | `src/content/library.yaml` — listed in file order | `npm run new -- library "Title" type=BOOK author="Name" orbit=systems shelf=READING` |
| **Trajectories** (goals) | `src/content/trajectories.yaml` — set `reached: true` when you arrive | `npm run new -- trajectory "Goal" orbit=craft horizon=NOW` |
| **Orbits** (names, colors, ring order, vault folders) | `ORBITS` in `src/site.config.ts` | Edit by hand — first entry is the innermost ring |
| **Orrery / current phase** | `ORBITS[].clock` in `src/site.config.ts` | Edit by hand when the season changes |
| **Manual** | `src/pages/manual.astro` | Edit by hand |
| **Orbit Kit** (`/manual/kit/`) — a blank Orbital Model visitors build themselves | `src/pages/manual/kit.astro`, `src/lib/kit-state.ts` | Edit by hand — see below |
| **Observer** (about) | `src/pages/observer.astro` | Edit by hand |
| **Professional** (roles, expertise, selected work, education) + CV PDF | `src/content/profile.yaml` — a blank section just doesn't render | Edit by hand — see the comment header in that file |
| **Now** (what's near this season) | Generated from `ORBITS[].clock`; the note is `NOW_NOTE` in `src/site.config.ts` | Edit `NOW_NOTE` by hand — blank means no note shows |

**Project frontmatter:** `title`, `summary`, `orbit`, `status` (`PLANNED | ACTIVE | COMPLETE | SCRUBBED`), and optionally `started`, `ended`, `order` (lower lists first), `stack: [..]`, `repo: https://…`, `demo: https://…`.

**Setting the orrery.** Each orbit's `clock` is where its body sits on a clock face: `12:00` is NEAR (what this season is for), `6:00` is FAR. Update the clocks and `PHASE_LOGGED`, then push. Visitors can drag the bodies around, but nothing they move is saved.

**Orbits and your vault.** The twelve orbits mirror the areas of the Obsidian vault. Each orbit's `folders` lists the vault folders it claims (`Health` → BODY, `Finance/Ventures` → VENTURE; the deepest folder wins), so a note published without a `station-orbit` lands in its folder's orbit. Order in `ORBITS` is ring order: the innermost ring is the most foundational. Adding or reordering an orbit needs no other change — rings, labels and page copy all follow the config.

**The Orbit Kit** (`/manual/kit/`) lets a visitor build their own Orbital Model — rename up to twelve orbits, drag them NEAR or FAR, pick up to five governing constants, and get a share link, a printable worksheet, and SVG/PNG/JSON exports. It needs no changes here: the whole layout is encoded into that page's own URL fragment (never sent to any server, never stored), and a small service worker scoped to `/manual/kit/` lets it keep working offline once visited.

---

## 6. Make it yours before launch

Open `src/site.config.ts`:

1. **Channels.** Fill in `email`, `github`, `linkedin` and so on. Anything left empty is hidden, so no placeholder links ever go live. Use a dedicated public alias for `email`, not your personal inbox. Profile links must start with `https://`, and a malformed value stops the build rather than shipping a broken link. Profiles get `rel="me"`, so Mastodon can verify them.
2. **Name, description, latitude.** Check the `SITE` block.
3. **Analytics (optional).** `ANALYTICS.goatcounter` switches on cookie-free visit counts: create a free site at [goatcounter.com](https://www.goatcounter.com) and paste its count address (`https://<code>.goatcounter.com/count`). Blank means no script and no request at all. The site's own ~1 KB script sends only the page path, title, screen size and an external referrer; visitors with Do Not Track or Global Privacy Control on are never counted, and nothing is counted from `localhost`. Titles of pages in an orbit start with its name (`ASTRO · …`): turn on *match title* in the dashboard filter and type the orbit's name to see one orbit. Links with a `data-event` attribute (the CV download) count their clicks as events. The footer and the Observer page say which mode is on.
4. **Social card.** `public/og.png` is the fallback link-preview image (1200×630) for pages without a generated card of their own; transmissions, missions and orbits get theirs automatically (see [Social cards](#social-cards)).

---

## 7. Other hosts

Netlify, Cloudflare Pages and Vercel detect Astro automatically. Import the GitHub repository in their dashboard. If asked: build command `npm run build`, output directory `dist`, Node version from `.nvmrc` (24). The site URL is picked up from the host. With a custom domain, set the environment variable `SITE_URL=https://yourdomain.com` (or commit `public/CNAME`, same as the GitHub Pages path above), and the same address in the Obsidian plugin's *Site address* setting.

---

## 8. What's in the box

- **Pages:** Bridge (home + interactive orrery), Transmissions (filterable by orbit and kind, with year archive, tags and prev/next), Flight Log with per-mission pages, Library (shelf filters), Trajectories, one page per orbit, Manual (with the build-your-own Orbit Kit), Observer, Professional (roles, expertise, selected work, education, plus a `/cv.pdf` generated from the same data), Now (what's near this season), Search, and a 404.
- **Reading:** light and dark themes, self-hosted fonts, KaTeX math, callouts, reading times, table of contents, copy buttons on code, print styles.
- **Discovery:** RSS at `/rss.xml` (full text) plus one per orbit (`/orbits/<id>/rss.xml`, public orbits only) and a JSON Feed at `/feed.json`, `sitemap-index.xml` (with `lastmod`), `robots.txt`, canonical URLs, a generated Open Graph/Twitter share image per transmission, mission and orbit (see [Social cards](#social-cards) above), and `Person`/`BlogPosting`/`BreadcrumbList` structured data. A moved or removed page redirects from its old address (`src/redirects.json`, kept up to date by the publisher).
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
│   ├── trajectories.yaml
│   └── profile.yaml      ← roles, expertise, selected work, education (/professional/, /cv.pdf)
├── pages/                ← one file per route
├── components/           ← Orrery, Header, Footer, SearchDialog, …
├── layouts/Base.astro    ← <head>, SEO, header/footer shell (feeds, JSON-LD, OG/Twitter)
├── lib/markdown-plugins.mjs ← math, callouts, base-path links
├── lib/feed.ts           ← shared RSS/JSON Feed item builder
├── lib/structured-data.ts ← shared JSON-LD builders (Person, BlogPosting, BreadcrumbList)
├── lib/sitemap-lastmod.mjs ← sitemap `lastmod` index, read by astro.config.mjs
├── redirects.json         ← old path → new path, kept up to date by the publisher
├── styles/global.css     ← the whole design system (tokens at the top)
└── scripts/search.ts
obsidian-plugin/          ← the Obsidian "Transmit" button (installed by npm run obsidian:install)
scripts/obsidian/         ← the publisher: convert.mjs, publish.mjs, install.mjs, redirects.mjs
scripts/new.mjs           ← `npm run new` scaffolder
tests/                    ← publisher + Markdown tests (npm test)
prototype/                ← the original single-file rev 4, kept for reference (not built)
```
