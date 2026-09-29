# Orbital Station — CLAUDE.md

## What this is

Astro 7 static blog ("Orbital Station") plus an Obsidian plugin ("Orbital
Station Publisher" / "Transmit") that converts a vault note to a page,
commits and pushes it. Content lives in `src/content/`; the site config
(orbits, colours, visibility, sensitive folders) is `src/site.config.ts`.
Author-facing docs: `README.md`. Roadmap and requirement cards:
`docs/PRD.md` and `docs/BACKLOG.md` (M0 "Ignition" is `docs/PRD.md` §8.4).
`docs/` is local-only and git-ignored — the plan never goes into the public
repo, and nothing in the repo should link to it. Read `docs/PRD.md` Appendix C
(condensed at the end of this file) before any change.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Astro dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the last build (`astro preview`) |
| `npm run check` | `astro check` — type & content check |
| `npm run check:plugin` | Typechecks `obsidian-plugin/main.js` (JSDoc, strict) without the Obsidian app |
| `npm run new` | Scaffold a new post/project |
| `npm run publish:note -- <path>` | Run the publisher CLI directly (see `scripts/obsidian/publish.mjs` header for every flag) |
| `npm run obsidian:install` | Copy the plugin into a vault and point it at this repo — **never run this**, Obsidian is running; ask the owner |
| `npm test` | `node --test` over `tests/**/*.test.mjs` |
| `npm run scan:secrets` | PRIV-03: local secret scan (`scripts/scan-secrets.mjs`), same engine as the CLI's publish-time gate |
| `npm run scan:media` | PRIV-04: scan committed `public/` and `src/content/` binaries for leftover metadata; add `-- --fix` to scrub in place |
| `npm run queue -- --vault <dir>` | GROW-08: the transmission queue (`station-queue` notes) by target orbit + the launch count (8 across 5); `--write-base` writes `Transmission Queue.base`. Read-only on the vault otherwise — only ever against a throwaway vault in tests |
| `npm run fonts` | READ-07: regenerate the subset fonts (`src/assets/fonts/`, `src/styles/fonts.css`) from the Fontsource packages; rerun after upgrading one (`tests/site/fonts.test.mjs` fails when they drift) |

## Environment quirks (this machine, Windows 11)

- **Bash tool = Git Bash.** Start every call with
  `export PATH="$(cygpath "$LOCALAPPDATA")/Programs/nodejs:$PATH"` (portable Node isn't
  on Git Bash's default PATH). Set `export MSYS_NO_PATHCONV=1` before any command whose
  arguments start with `/` (Git Bash otherwise rewrites them as Windows paths).
- **PowerShell BOM pitfall.** `Out-File`/`Set-Content` default to UTF-8 **with BOM** (or the
  system codepage without `-Encoding utf8`), which breaks JSON parsers. Write JSON/config
  files with Node (`fs.writeFileSync`) or the `Write` tool, not PowerShell redirection.
- **Backslashes in Bash heredocs/paths.** Windows paths with backslashes inside a Bash
  heredoc or single-quoted string usually survive, but anything that needs escaping is
  safer written with the `Write` tool than assembled in a shell string.
- **Obsidian running is fine.** `ORBITAL_OBSIDIAN_RUNNING=1|0` overrides the
  tasklist/pgrep detection `scripts/obsidian/install.mjs` uses, and the install test
  (PLAT-01) exercises both states without a real Obsidian process — so a running Obsidian
  never blocks tests or CI. It's still real and not yours to close: never launch, close,
  or reload it, and never run `npm run obsidian:install` against `C:\Zenkar's Vault`.
- **Optional tools.** ExifTool and ffmpeg (PRIV-04) are optional; without them on `PATH`,
  HEIC/WebM/OGG/Opus/AAC attachments are blocked (fail-closed) and the tests that need a
  real tool are skipped (`tests/obsidian/scrub-av.test.mjs`, `scrub-tools.test.mjs`, etc. —
  `npm test` reports them as `skipped`, not failed). Put a portable ExifTool/ffmpeg on
  `PATH` only in a shell where you want those tests to actually run:
  `export PATH="<tools-dir>:$PATH"`. `ORBITAL_SCRUB_TOOLS=none` forces them off even if
  present, for a deterministic clean-room step in tests.

## Testing recipes

- **Never test the publisher against the real vault or the real site repo.** Every
  publisher test builds a throwaway vault + site repo + local bare remote under
  `os.tmpdir()` via `tests/helpers/publish-fixtures.mjs`'s `setupTestRepo()` — copies
  `tests/fixtures/vault/`, writes a scratch `site.config.ts`, `git init`s a repo, and
  pushes to a `git init --bare` remote next to it. Remove the whole `tmp` folder when
  done (`fs.rmSync(tmp, { recursive: true, force: true })`); nothing here touches
  `C:\Zenkar's Vault` or this repo's own git history.
- **Built-site tests** use `tests/helpers/site-build.mjs`: `buildSiteCopy({ edit, env })`
  copies the site to `os.tmpdir()` with its own Astro/Vite caches (so any number of builds,
  including your own `npm run build`, can run side by side), `serveDir(dist, base)` serves it
  like Pages (pass `BASE_PATH=/The-Orbital-Station/` to mirror the live sub-path), and
  `findChrome()` finds a browser for the puppeteer-core tests (analytics, Orbit Kit) — they
  skip without one and launch with `--no-sandbox` for Ubuntu CI.
- **Site leakage test** (`tests/site/visibility.test.mjs`, MODEL-07): builds a throwaway
  copy of the site with one orbit switched to `hidden`, plants canary content in a
  `phase-only` orbit and the newly-hidden one, builds it, and asserts none of that
  content — or its listings, feed entries, search index rows, or sitemap URLs — reaches
  `dist/`, while a public control canary does.
- **Gates** (`tests/obsidian/gates.test.mjs`): PRIV-01 sensitive-folder guard, MODEL-07
  non-public-orbit confirmation, PRIV-03 secret scanning, PRIV-04 clean-room attachments,
  and the size gate, all against the throwaway fixtures above.
- **Real-tool tests skip without tools.** `scrub-av.test.mjs`, `scrub-tools.test.mjs` and
  similar call `findTools()` and skip (not fail) when ExifTool/ffmpeg aren't found — put
  them on `PATH` first if you need to actually exercise that code.
- **Obsidian E2E recipe** (manual — plugin UI, not covered by CI): only when the owner's
  Obsidian is closed.
  1. Back up `%APPDATA%\obsidian\obsidian.json`.
  2. Edit a copy that points at a throwaway vault only (never `C:\Zenkar's Vault`).
  3. Launch Obsidian with `--remote-debugging-port=9222` against that vault.
  4. Drive it with `puppeteer-core` (`puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' })`)
     to open notes, click "Transmit", and read the dialog's DOM.
  5. Close Obsidian, restore the original `obsidian.json`, and diff its hash against the
     backup to confirm nothing else changed.

## Screenshot recipe (verified working)

Build and serve, then drive headless Chrome with `puppeteer-core` (the theme is
`data-theme` on `<html>`, seeded from `localStorage['theme']` — `'light'|'dark'`, default
`'dark'` — so it must be set with `page.evaluateOnNewDocument` *before* `page.goto`, not
after).

```
npm run build
npx astro preview --port 4321 &      # background it; kill when done

# one-off puppeteer-core install, OUTSIDE the repo:
cd <scratchpad>/pptr && npm init -y && npm install puppeteer-core
```

```js
// <scratchpad>/pptr/shoot.mjs
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument((theme) => localStorage.setItem('theme', theme), 'dark');
await page.goto('http://127.0.0.1:4321/', { waitUntil: 'networkidle0' });
await page.screenshot({ path: 'out.png' });
await browser.close();
```

Widths used for Appendix C: desktop 1440×1000, phone 390×844, each in both themes.
A plain `chrome.exe --headless --screenshot --window-size=W,H URL` works for a quick
single shot but can't set `localStorage` first, so it always renders the default theme.

## Privacy gates

| Gate | Lives in | Configure / override |
|---|---|---|
| Sensitive-folder guard (PRIV-01) | `SENSITIVE_FOLDERS` in `src/site.config.ts`; enforced in `scripts/obsidian/publish.mjs` (`guard`) | Edit the array. Publish needs `--confirm-sensitive` (CLI) or the dialog checkbox |
| Orbit visibility confirm (MODEL-07, publish half) | `visibility` per orbit in `src/site.config.ts`; same `guard` | Set an orbit's `visibility` to `'public'` \| `'phase-only'` \| `'hidden'`; non-public needs the same deliberate yes |
| Orbit visibility enforcement (MODEL-07, build half) | `src/lib/visibility.ts`, `src/lib/content.ts` (the only chokepoint allowed to call `getCollection`) | Same `visibility` field; a leakage test (`tests/site/visibility.test.mjs`) fails the build path if anything bypasses it |
| Secret scan at publish time (PRIV-03) | `scripts/obsidian/secrets.mjs`, wired into `publish.mjs`'s `secrets`/`blocked` result fields | `.secrets-allow` (repo root) — one fingerprint per line, printed by each finding |
| Secret scan, standalone (PRIV-03) | `scripts/scan-secrets.mjs` | `npm run scan:secrets [-- <paths>] [--json]`; same `.secrets-allow` |
| Secret scan, CI (PRIV-03) | `.github/workflows/ci.yml` `secrets` job, gitleaks 8.30.1 | `.gitleaks.toml` (repo root) for allowlist rules; scans full git history |
| Clean-room attachments (PRIV-04) | `scripts/obsidian/scrub/index.mjs`; `publish.mjs`'s `media`/`blocked` fields | `--allow-metadata` (CLI only) copies one attachment unscrubbed with a warning — never bypasses the secret scan. `ORBITAL_SCRUB_TOOLS=none` forces ExifTool/ffmpeg off |
| Media scan, standalone + CI (PRIV-04) | `scripts/scan-media.mjs`; `.github/workflows/ci.yml` `media` job | `npm run scan:media [-- --fix] [--json]` |
| NEAR capacity warning (MODEL-03) | `NEAR_CAPACITY` in `src/site.config.ts`; checked at build time | Change the constant; the build warns and the Bridge's caption states the count honestly when orbits over capacity run NEAR |
| Cookie-free analytics (LIVE-04) | `ANALYTICS.goatcounter` in `src/site.config.ts`; `src/lib/beacon.ts` + `src/components/Analytics.astro` | Blank = no script, no request. Sends path (no query/fragment), title, screen, external referrer only; never under DNT/GPC, webdriver or localhost |
| Launch queue (GROW-08) | `scripts/obsidian/queue.mjs` (also `publish.mjs --queue`, the plugin's "Open transmission queue") | Queued notes in `SENSITIVE_FOLDERS` or aimed at a non-public orbit are flagged (exit 1); the generated Base filters sensitive folders out |
| Redirects on move (LIVE-08) | `src/redirects.json`, maintained by `scripts/obsidian/redirects.mjs` | Never records a redirect toward a non-public orbit (it would reveal the slug) |

## Conventions

- Commit subjects `Publish:` / `Update:` / `Move:` / `Unpublish:` belong to the
  publisher alone — never use them for a manual commit. The publisher only ever pushes
  commits it made itself, and reusing its prefix would make that check unreliable.
- Name the requirement ID(s) a change implements in its commit message (e.g. `PLAT-07`).
- The owner approves before anything is pushed, published, or paid for (Appendix C item 8).
- Deploys only run from `main` (`.github/workflows/deploy.yml`); every other branch and PR
  gets `ci.yml` only.

## Review checklist (Appendix C, condensed — run on every change)

- [ ] **Scoped** — maps to requirement ID(s), named in the commit message; the BACKLOG
      card's acceptance criteria are checked off
- [ ] **Tested first** — behaviour changes have tests written first; `npm test`,
      `npm run check`, `npm run check:plugin` all pass
- [ ] **Built** — `npm run build` succeeds, no new warnings
- [ ] **Seen** — UI changes: screenshots at desktop + phone width, dark + light theme;
      interactive changes exercised in a real browser (keyboard, reduced motion)
- [ ] **Measured** — performance-sensitive changes report before/after transfer size or
      Lighthouse scores
- [ ] **Private** — no personal details, secrets, identifying metadata or unpublished
      vault content in code, content, tests or commit messages; publisher changes tested
      only against the throwaway vault/repo fixtures
- [ ] **Documented** — README, this file, and the relevant BACKLOG card updated when
      commands, configuration or behaviour change
- [ ] **Approved** — owner reviewed and said yes before anything is pushed, published,
      federated, or paid for
