// @ts-check
'use strict';
/* =============================================================
   Orbital Station Publisher — an Obsidian plugin (no build step).

   The button: ribbon icon · command palette · right-click on a note.
   It opens a pre-filled dialog, checks what would be published (a dry
   run), then runs the site's publisher (scripts/obsidian/publish.mjs)
   with the dialog's values. Only after the publisher succeeds are the
   answers saved on the note as `station-*` properties.

   Source lives in the Orbital Station repo (obsidian-plugin/);
   `npm run obsidian:install` copies it into the vault.
   ============================================================= */
const { Plugin, PluginSettingTab, Setting, Modal, Notice, TFile, MarkdownView, FileSystemAdapter } = require('obsidian');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * @typedef {{ repoPath: string, nodePath: string, siteUrl: string, defaultOrbit: string, push: boolean }} Settings
 * @typedef {{ id: string, name: string, folders?: string[] }} OrbitInfo
 * @typedef {{ id: string, name: string, folders?: string[], visibility?: 'public'|'phase-only'|'hidden' }} OrbitDescribeInfo
 * @typedef {{ ok: boolean, error?: string, node?: string, git?: boolean, branch?: string|null, deployBranch?: string,
 *   remote?: string|null, siteUrl?: string|null, orbits?: OrbitDescribeInfo[], kinds?: {id: string, label: string}[],
 *   statuses?: string[], projects?: {id: string, title: string}[], sensitiveFolders?: string[] }} SiteInfo
 * @typedef {{ confirm: boolean, confirmed: boolean, reasons: string[] }} Guard
 * @typedef {{ file: string, line: number, column: number, rule: string, label: string, fingerprint: string, preview: string }} SecretFinding
 * @typedef {{ file: string, dest?: string, kind: 'clean'|'scrubbed'|'text'|'unscrubbed'|'blocked', removed: string[], reason?: string }} MediaEntry
 * @typedef {{ ok: boolean, error?: string, action?: string, title?: string, slug?: string, url?: string|null,
 *   path?: string, fields?: Record<string, any>, existing?: string[], removed?: string[], embeds?: string[],
 *   committed?: boolean, pushed?: boolean, upToDate?: boolean, remote?: boolean, branch?: string|null,
 *   online?: boolean, note?: string, warnings?: string[], dryRun?: boolean,
 *   guard?: Guard, secrets?: SecretFinding[], media?: MediaEntry[], blocked?: string[] }} PublishResult
 * @typedef {{ type: string, title: string, slug: string, orbit: string, kind: string, status: string,
 *   date: string, summary: string, tags: string[], project: string }} Values
 * @typedef {{ note: string, title: string, orbit: string|null, public: boolean, sensitive: string|null,
 *   published: string|null, problems: string[] }} QueuedNote
 * @typedef {{ transmissions: number, orbits: number, ready: boolean, need: { transmissions: number, orbits: number },
 *   projected: { transmissions: number, orbits: number } }} LaunchStatus
 * @typedef {{ ok: boolean, error?: string, queued?: QueuedNote[], problems?: string[], launch?: LaunchStatus,
 *   base?: { path: string, written: boolean, current?: boolean } }} QueueResult
 */

/** @type {Settings} */
const DEFAULTS = { repoPath: '', nodePath: '', siteUrl: '', defaultOrbit: 'words', push: true };
const ICON = 'satellite-dish';
const DEPLOY_BRANCH = 'main';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Same rules as the site's publisher, so the preview matches the real URL. */
const slugify = (/** @type {unknown} */ s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
/** The orbit whose `folders` hold this vault path (deepest folder wins) — same rules as the publisher. */
const orbitForNote = (/** @type {string} */ notePath, /** @type {OrbitInfo[]} */ orbits) => {
  const dir = notePath.toLowerCase(); // Obsidian paths always use "/"
  /** @type {string | null} */ let best = null;
  let depth = 0;
  for (const o of orbits) {
    for (const folder of o.folders ?? []) {
      const f = folder.replace(/^\/+|\/+$/g, '').toLowerCase();
      if (f && dir.startsWith(`${f}/`) && f.length > depth) (best = o.id), (depth = f.length);
    }
  }
  return best;
};
/** Tags: a YAML list, or a comma-separated string (same as the publisher). */
const asList = (/** @type {unknown} */ v) =>
  v == null || v === ''
    ? []
    : [
        ...new Set(
          (Array.isArray(v) ? v : String(v).split(','))
            .map((t) => String(t).replace(/\s+/g, ' ').trim().replace(/^#/, ''))
            .filter(Boolean),
        ),
      ];
const asDateString = (/** @type {unknown} */ v) => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? ''));
  return m ? m[1] : '';
};
/** Paths pasted from Explorer ("Copy as path") come wrapped in quotes. */
const cleanPath = (/** @type {string} */ v) => v.trim().replace(/^["']|["']$/g, '').trim();
/** "zenkar.dev" → "https://zenkar.dev/"; null when it isn't a web address. */
const normalizeSiteUrl = (/** @type {string} */ v) => {
  let s = cleanPath(v);
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
    return u.href.endsWith('/') ? u.href : `${u.href}/`;
  } catch {
    return null;
  }
};

/* ---------- the M0 gates, as pure text/logic (no DOM, no Obsidian) ----------
   PRIV-01 sensitive-area guard · MODEL-07 orbit-visibility confirmation ·
   PRIV-03 secrets · PRIV-04 clean-room attachments. Kept pure so the dialog's
   own rendering logic can be unit-tested without a real Obsidian window. */
const basename = (/** @type {unknown} */ p) => String(p ?? '').split(/[\\/]/).pop() || String(p ?? '');

/** Everything that would stop a real publish — secrets already formatted, unscrubbable
 *  or oversized attachments. Every line is ready to show as-is (redacted preview only). */
const blockedLines = (/** @type {PublishResult | null | undefined} */ res) => (Array.isArray(res?.blocked) ? res.blocked : []);

/** The sensitive-folder / non-public-orbit reasons a publish needs a deliberate yes for. Empty when none. */
const guardReasons = (/** @type {PublishResult | null | undefined} */ res) => (res?.guard?.confirm ? (res.guard.reasons ?? []) : []);

/** A stable key for "these are the same reasons" — used to decide whether the confirmation box should reset. */
const reasonsKey = (/** @type {Guard | undefined} */ guard) => JSON.stringify(guard?.confirm ? (guard.reasons ?? []) : []);

/**
 * The checkbox never survives a dry run whose guard reasons changed (e.g. the orbit
 * switched to a phase-only one) — it is never remembered otherwise.
 * @param {string | null} prevKey
 * @param {Guard | undefined} guard
 * @param {boolean} currentlyTicked
 * @returns {{ key: string, ticked: boolean }}
 */
const nextConfirmState = (prevKey, guard, currentlyTicked) => {
  const key = reasonsKey(guard);
  return { key, ticked: key === prevKey ? currentlyTicked : false };
};

/** One "Clean room" line per copied attachment: which categories were removed, or that none were. */
const cleanRoomLine = (/** @type {MediaEntry} */ m) => {
  const name = basename(m.file);
  if (m.kind === 'unscrubbed') return `${name} — passed through unscrubbed (no clean-room tool available)${m.reason ? `: ${m.reason}` : ''}`;
  if (m.kind === 'blocked') return `${name} — blocked${m.reason ? `: ${m.reason}` : ''}`;
  return m.removed?.length ? `${name} — removed ${m.removed.join(', ')}` : `${name} — no hidden metadata`;
};
const cleanRoomLines = (/** @type {MediaEntry[] | null | undefined} */ media) => (Array.isArray(media) ? media.map(cleanRoomLine) : []);

/** GROW-08: the "Open transmission queue" Notice — the launch count, then anything that can't go out. */
const queueSummary = (/** @type {QueueResult} */ res) => {
  const l = res.launch;
  if (!l) return '';
  const lines = [
    `Launch: ${l.transmissions}/${l.need.transmissions} transmissions across ${l.orbits}/${l.need.orbits} public orbits${l.ready ? ' — ready' : ''}.`,
    `${(res.queued ?? []).filter((q) => !q.published).length} queued; with the queue sent: ${l.projected.transmissions} across ${l.projected.orbits}.`,
    ...(res.problems ?? []).map((p) => `✗ ${p}`),
  ];
  if (res.base && !res.base.written && !res.base.current) lines.push(`"${res.base.path}" wasn't made by the publisher, so it was left as it is.`);
  return lines.join('\n');
};

/** Transmit is only ever allowed once nothing is blocked and any needed yes has been given. */
const canTransmit = (/** @type {PublishResult | null | undefined} */ res, /** @type {boolean} */ confirmed) => {
  if (!res || res.ok === false) return false;
  if (blockedLines(res).length) return false;
  if (res.guard?.confirm && !confirmed) return false;
  return true;
};

/** The publisher's own CLI args (argsFor), as a pure function so tests don't need a live plugin instance. */
const buildPublishArgs = (/** @type {Values} */ v, /** @type {{ siteUrl?: string, confirmSensitive?: boolean }} */ { siteUrl, confirmSensitive } = {}) => {
  const args = ['--type', v.type, '--title', v.title, '--slug', v.slug || slugify(v.title), '--orbit', v.orbit, '--summary', v.summary.trim()];
  if (v.type === 'post') {
    args.push('--kind', v.kind, '--tags', v.tags.join(','), '--project', v.project);
    if (v.date) args.push('--date', v.date);
  } else args.push('--status', v.status);
  if (siteUrl) args.push('--site-url', siteUrl);
  if (confirmSensitive) args.push('--confirm-sensitive');
  return args;
};

class OrbitalStationPublisher extends Plugin {
  /** @type {Settings} */ settings = { ...DEFAULTS };
  busy = false;
  /** @type {{ at: number, info: SiteInfo } | null} */ infoCache = null;
  /** @type {HTMLElement | null} */ statusEl = null;

  async onload() {
    await this.loadSettings();

    this.addRibbonIcon(ICON, 'Transmit to Orbital Station', () => {
      const file = this.activeNote();
      if (file) this.openDialog(file);
      else new Notice('Open a note first, then press the transmit button.');
    });

    this.addCommand({
      id: 'publish-note',
      name: 'Publish current note…',
      icon: ICON,
      checkCallback: (checking) => this.onActive(checking, (f) => this.openDialog(f)),
    });
    this.addCommand({
      id: 'republish-note',
      name: 'Republish current note (skip the dialog)',
      icon: ICON,
      checkCallback: (checking) => this.onActive(checking, (f) => this.republish(f), (f) => this.hasPage(f)),
    });
    this.addCommand({
      id: 'unpublish-note',
      name: 'Unpublish current note',
      checkCallback: (checking) => this.onActive(checking, (f) => this.confirmUnpublish(f), (f) => this.hasPage(f)),
    });
    this.addCommand({
      id: 'open-transmission-queue',
      name: 'Open transmission queue',
      callback: () => this.openQueue(),
    });
    this.addCommand({
      id: 'open-published-page',
      name: 'Open published page in browser',
      checkCallback: (checking) =>
        this.onActive(checking, (f) => this.openPage(f), (f) => !!this.fm(f)['station-url']),
    });

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== 'md') return;
        menu.addItem((item) =>
          item
            .setTitle(this.hasPage(file) ? 'Orbital Station: update page' : 'Orbital Station: publish')
            .setIcon(ICON)
            .onClick(() => this.openDialog(file)),
        );
      }),
    );

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass('oss-status');
    this.registerDomEvent(this.statusEl, 'click', () => {
      const f = this.activeNote();
      if (f && this.fm(f)['station-published'] && this.fm(f)['station-url']) this.openPage(f);
      else if (f) this.openDialog(f);
    });
    this.registerEvent(this.app.workspace.on('file-open', () => this.updateStatus()));
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (file === this.app.workspace.getActiveFile()) this.updateStatus();
      }),
    );
    this.app.workspace.onLayoutReady(() => this.updateStatus());

    this.addSettingTab(new StationSettingTab(this.app, this));
  }

  /* ---------- helpers ---------- */

  activeNote() {
    const f = this.app.workspace.getActiveFile();
    return f && f.extension === 'md' ? f : null;
  }

  /**
   * @param {boolean} checking
   * @param {(f: TFile) => unknown} run
   * @param {(f: TFile) => boolean} [when]
   */
  onActive(checking, run, when) {
    const f = this.activeNote();
    const ok = !!f && (!when || when(f));
    if (!checking && ok && f) run(f);
    return ok;
  }

  /** @param {TFile} file @returns {Record<string, any>} */
  fm(file) {
    return this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
  }

  /** The note has (or had, pending a push) a page on the site. @param {TFile} file */
  hasPage(file) {
    const fm = this.fm(file);
    return !!(fm['station-published'] || fm['station-slug']);
  }

  vaultRoot() {
    const a = this.app.vault.adapter;
    return a instanceof FileSystemAdapter ? a.getBasePath() : null;
  }

  nodePath() {
    const candidates = [
      cleanPath(this.settings.nodePath || ''),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs', 'node.exe'),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'nodejs', 'node.exe'),
      '/opt/homebrew/bin/node',
      '/usr/local/bin/node',
      '/usr/bin/node',
    ].filter(Boolean);
    return /** @type {string} */ (candidates.find((c) => c && fs.existsSync(c)) ?? 'node');
  }

  /** GROW-08: refresh "Transmission Queue.base" at the vault root, open it, and say how close launch is. */
  async openQueue() {
    const root = this.vaultRoot();
    if (!root) return void new Notice('This vault is not on the local file system.');
    /** @type {QueueResult} */
    const res = await this.runScript(['--queue', '--vault', root]);
    if (!res.ok || !res.base) return void new Notice(`✗ ${res.error ?? 'The queue could not be read.'}`, 10000);
    new Notice(queueSummary(res), res.problems?.length ? 15000 : 8000);
    await this.app.workspace.openLinkText(res.base.path, '', true);
  }

  /** @param {TFile} file */
  openPage(file) {
    const url = this.fm(file)['station-url'];
    if (url) window.open(String(url));
  }

  updateStatus() {
    const el = this.statusEl;
    if (!el) return;
    const f = this.activeNote();
    const fm = f ? this.fm(f) : {};
    el.empty();
    el.removeClass('is-live');
    if (!f || !fm.station) {
      el.hide();
      return;
    }
    el.show();
    if (fm['station-published']) {
      el.addClass('is-live');
      el.setText(`◉ ON AIR · ${asDateString(fm['station-published'])}`);
      el.setAttr('aria-label', fm['station-url'] ? 'Open the published page' : 'Published');
    } else {
      el.setText('○ OFFLINE');
      el.setAttr('aria-label', 'Not online — publish this note to Orbital Station');
    }
  }

  /* ---------- the publisher script ---------- */

  /**
   * @param {string[]} args
   * @returns {Promise<any>}
   */
  runScript(args) {
    const repo = cleanPath(this.settings.repoPath || '');
    const script = repo ? path.join(repo, 'scripts', 'obsidian', 'publish.mjs') : '';
    if (!script || !fs.existsSync(script)) {
      return Promise.resolve({
        ok: false,
        error: repo
          ? `No Orbital Station folder at "${repo}". Check Settings → Orbital Station Publisher.`
          : 'The Orbital Station folder isn\'t set. Set it in Settings → Orbital Station Publisher.',
      });
    }
    const node = this.nodePath();
    return new Promise((resolve) => {
      execFile(
        node,
        [script, ...args, '--json'],
        { cwd: repo, windowsHide: true, timeout: 180000, maxBuffer: 32 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const last = String(stdout).trim().split(/\r?\n/).filter(Boolean).pop();
          if (last) {
            try {
              return resolve(JSON.parse(last));
            } catch {
              /* fall through */
            }
          }
          const e = /** @type {any} */ (err);
          if (e && e.code === 'ENOENT') {
            return resolve({ ok: false, error: `Node.js wasn't found ("${node}"). Set its path in the plugin settings.` });
          }
          if (e && e.killed) return resolve({ ok: false, error: 'The publisher took too long and was stopped. Try again.' });
          if (/ERR_MODULE_NOT_FOUND|Cannot find (package|module)/.test(String(stderr))) {
            return resolve({ ok: false, error: 'Dependencies are missing — run "npm install" in the Orbital Station folder.' });
          }
          resolve({ ok: false, error: String(stderr || e?.message || 'The publisher gave no answer.').trim().slice(0, 600) });
        },
      );
    });
  }

  /** @param {boolean} [fresh] @returns {Promise<SiteInfo>} */
  async siteInfo(fresh = false) {
    if (!fresh && this.infoCache && Date.now() - this.infoCache.at < 60_000) return this.infoCache.info;
    const info = await this.runScript(['--describe']);
    if (info.ok) this.infoCache = { at: Date.now(), info };
    return info;
  }

  /* ---------- values ---------- */

  /** What the note says — normalised the same way the publisher reads it. @param {TFile} file @returns {Values} */
  valuesFromNote(file) {
    const fm = this.fm(file);
    const title = String(fm['station-title'] ?? file.basename).replace(/\s+/g, ' ').trim();
    return {
      type: String(fm.station ?? '').trim().toLowerCase() === 'project' ? 'project' : 'post',
      title,
      slug: slugify(fm['station-slug'] ?? title),
      orbit: String(fm['station-orbit'] ?? this.settings.defaultOrbit).trim().toLowerCase(),
      kind: String(fm['station-kind'] ?? 'essay').trim().toLowerCase(),
      status: String(fm['station-status'] ?? 'ACTIVE').trim().toUpperCase(),
      date: asDateString(fm['station-date']),
      summary: String(fm['station-summary'] ?? ''),
      tags: asList(fm['station-tags']), // never the note's own (private) tags
      project: slugify(fm['station-project'] ?? ''),
    };
  }

  /** @param {Values} v @param {{ confirmSensitive?: boolean }} [opts] @returns {string[]} */
  argsFor(v, opts) {
    return buildPublishArgs(v, { siteUrl: this.settings.siteUrl, confirmSensitive: opts?.confirmSensitive });
  }

  /** @param {TFile} file */
  async openDialog(file) {
    new TransmitModal(this, file).open();
  }

  /** Make sure what's on disk matches the editor before the publisher reads it. @param {TFile} file */
  async flush(file) {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file === file) await view.save();
    }
  }

  /** @param {TFile} file @param {Values} v @returns {Promise<PublishResult>} */
  async preflight(file, v) {
    const root = this.vaultRoot();
    if (!root) return { ok: false, error: 'This vault is not on the local file system.' };
    await this.flush(file);
    return this.runScript([path.join(root, file.path), '--vault', root, ...this.argsFor(v), '--dry-run']);
  }

  /** "Republish, skip the dialog" — but never skips a gate: a dry run runs first, and
   *  anything needing a deliberate yes or anything blocked opens the dialog instead.
   *  @param {TFile} file */
  async republish(file) {
    const v = this.valuesFromNote(file);
    const dry = await this.preflight(file, v);
    if (!dry.ok) {
      new Notice(`✗ Not transmitted — ${dry.error}`, 15000);
      return;
    }
    const blocked = blockedLines(dry);
    const reasons = guardReasons(dry);
    if (blocked.length || reasons.length) {
      const why = blocked.length ? blocked[0] : reasons[0];
      new Notice(`Opening the dialog — ${why}`, 12000);
      this.openDialog(file);
      return;
    }
    await this.publish(file, v);
  }

  /* ---------- publish / unpublish ---------- */

  /** Did the page actually reach the live site? @param {PublishResult} res */
  isOnline(res) {
    if (!this.settings.push) return true; // you push yourself; trust the commit
    return !!(res.remote && (res.pushed || res.upToDate) && res.branch === DEPLOY_BRANCH);
  }

  /**
   * @param {TFile} file
   * @param {Values} v
   * @param {{ confirmSensitive?: boolean }} [opts]
   * @returns {Promise<PublishResult>}
   */
  async publish(file, v, opts) {
    if (this.busy) {
      new Notice('A transmission is already under way…');
      return { ok: false, error: 'busy' };
    }
    const root = this.vaultRoot();
    if (!root) return { ok: false, error: 'This vault is not on the local file system.' };
    this.busy = true;
    const progress = new Notice(`Transmitting “${v.title}”…`, 0);
    try {
      await this.flush(file);
      const args = [path.join(root, file.path), '--vault', root, ...this.argsFor(v, opts)];
      if (!this.settings.push) args.push('--no-push');
      /** @type {PublishResult} */
      const res = await this.runScript(args);
      progress.hide();
      if (!res.ok) {
        new Notice(`✗ Not transmitted — ${res.error}`, 15000);
        return res; // the note is left exactly as it was
      }

      const online = this.isOnline(res);
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        /** @param {string} k @param {unknown} val */
        const set = (k, val) => {
          if (val === undefined || val === '' || (Array.isArray(val) && !val.length)) delete fm[k];
          else fm[k] = val;
        };
        fm.station = v.type;
        set('station-title', v.title !== file.basename ? v.title : undefined);
        set('station-orbit', v.orbit);
        set('station-slug', res.slug ?? v.slug);
        set('station-summary', v.summary.trim());
        if (v.type === 'post') {
          set('station-kind', v.kind);
          set('station-date', res.fields?.date ?? v.date);
          set('station-tags', v.tags);
          set('station-project', v.project);
          delete fm['station-status'];
        } else {
          set('station-status', v.status);
          for (const k of ['station-kind', 'station-date', 'station-project', 'station-tags']) delete fm[k];
        }
        if (online) {
          fm['station-published'] = today();
          set('station-url', res.url ?? undefined);
        }
      });
      this.report(res, online);
      return res;
    } catch (e) {
      progress.hide();
      new Notice(`✗ Not transmitted — ${/** @type {Error} */ (e).message}`, 15000);
      return { ok: false, error: /** @type {Error} */ (e).message };
    } finally {
      progress.hide();
      this.busy = false;
      this.updateStatus();
    }
  }

  /** @param {PublishResult} res @param {boolean} online */
  report(res, online) {
    const frag = document.createDocumentFragment();
    const head = frag.createEl('div', { cls: 'oss-notice-head' });
    const line = (/** @type {string} */ text, /** @type {string} */ cls = 'oss-notice-line') =>
      frag.createEl('div', { cls, text });
    const verb = res.action === 'unchanged' ? 'Already online' : res.action === 'published' ? 'Transmitted' : 'Updated';

    if (online) {
      head.setText(`✓ ${verb}: “${res.title}”`);
      if (res.pushed) line(res.note ?? 'Pushed — live in about a minute.');
      else if (!this.settings.push) line('Committed. Push is off — push the site folder to put it online.');
    } else if (res.error) {
      head.setText(`⚠ “${res.title}” is saved in the site folder, but not online yet`);
      line(res.error, 'oss-notice-line mod-warning');
      line('Fix that, then press Transmit again — it will push the waiting change.');
    } else if (!res.remote) {
      head.setText(`✓ Committed “${res.title}” locally`);
      line(res.note ?? 'Connect a GitHub remote to put it online (README §1).');
    } else {
      head.setText(`⚠ “${res.title}” is committed, but not live`);
      line(`The site folder is on branch "${res.branch}" — the site only deploys from ${DEPLOY_BRANCH}.`, 'oss-notice-line mod-warning');
    }
    if (online && res.url) {
      const a = frag.createEl('a', { text: res.url, href: res.url, cls: 'oss-notice-link' });
      a.addEventListener('click', (e) => {
        e.preventDefault();
        window.open(String(res.url));
      });
    }
    const warns = res.warnings ?? [];
    for (const w of warns.slice(0, 6)) line(`· ${w}`, 'oss-notice-line mod-muted');
    if (warns.length > 6) line(`· …and ${warns.length - 6} more (shown in the developer console)`, 'oss-notice-line mod-muted');
    if (warns.length) console.info('[Orbital Station] publish warnings:', warns);
    new Notice(frag, online && !warns.length ? 8000 : 20000);
  }

  /** @param {TFile} file */
  confirmUnpublish(file) {
    new ConfirmModal(this.app, {
      title: 'Take this page offline?',
      body: `“${this.fm(file)['station-title'] ?? file.basename}” will be removed from Orbital Station. The note's text stays as it is; only its station-published and station-url properties are cleared.`,
      cta: 'Unpublish',
      onConfirm: () => this.unpublish(file),
    }).open();
  }

  /** @param {TFile} file */
  async unpublish(file) {
    const root = this.vaultRoot();
    if (!root) return;
    if (this.busy) {
      new Notice('A transmission is already under way…');
      return;
    }
    this.busy = true;
    const progress = new Notice('Taking the page offline…', 0);
    try {
      await this.flush(file);
      const args = [path.join(root, file.path), '--vault', root, '--unpublish'];
      if (!this.settings.push) args.push('--no-push');
      /** @type {PublishResult} */
      const res = await this.runScript(args);
      progress.hide();
      if (!res.ok) {
        new Notice(`✗ Couldn't unpublish — ${res.error}`, 15000);
        return;
      }
      if (this.isOnline(res) || !res.remote) {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          delete fm['station-published'];
          delete fm['station-url'];
        });
        new Notice(`✓ “${res.title}” is offline.`, 8000);
      } else {
        new Notice(
          `⚠ “${res.title}” was removed in the site folder, but it is still online: ${res.error ?? `the site folder is on branch "${res.branch}"`}. Fix that and run Unpublish again.`,
          20000,
        );
      }
    } finally {
      progress.hide();
      this.busy = false;
      this.updateStatus();
    }
  }

  /* ---------- settings ---------- */

  async loadSettings() {
    /** @type {Partial<Settings> | null} */
    let data = null;
    try {
      data = await this.loadData();
    } catch {
      /* e.g. a byte-order mark added by a Windows editor — read it by hand below */
    }
    if (!data && this.manifest.dir) {
      const file = `${this.manifest.dir}/data.json`;
      try {
        if (await this.app.vault.adapter.exists(file)) {
          data = JSON.parse((await this.app.vault.adapter.read(file)).replace(/^\uFEFF/, ''));
        }
      } catch {
        /* unreadable settings → defaults; the settings tab lets you fix them */
      }
    }
    this.settings = Object.assign({}, DEFAULTS, data ?? {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.infoCache = null;
  }
}

/* =============================================================
   The transmit dialog
   ============================================================= */
class TransmitModal extends Modal {
  /** @param {OrbitalStationPublisher} plugin @param {TFile} file */
  constructor(plugin, file) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.values = plugin.valuesFromNote(file);
    this.hasPage = plugin.hasPage(file);
    this.slugTouched = this.hasPage || !!plugin.fm(file)['station-slug'];
    /** @type {SiteInfo | null} */ this.info = null;
    this.sending = false;
    this.checkSeq = 0;
    /** @type {ReturnType<typeof setTimeout> | null} */ this.checkTimer = null;
    /** @type {HTMLElement | null} */ this.previewEl = null;
    /** @type {HTMLElement | null} */ this.errorEl = null;
    /** @type {HTMLElement | null} */ this.checkEl = null;
    /** @type {HTMLElement | null} */ this.blockedEl = null;
    /** @type {HTMLElement | null} */ this.guardEl = null;
    /** @type {HTMLElement | null} */ this.cleanRoomEl = null;
    /** @type {HTMLInputElement | null} */ this.dateInput = null;
    /** @type {import('obsidian').ButtonComponent | null} */ this.sendBtn = null;
    /** @type {PublishResult | null} last dry run — drives whether Transmit is enabled */
    this.lastCheck = null;
    // The sensitive-content checkbox: never remembered, and reset whenever the guard's
    // reasons change (e.g. the orbit was switched to a phase-only one).
    this.confirmSensitive = false;
    /** @type {string | null} */ this.guardKey = null;
  }

  async onOpen() {
    this.modalEl.addClass('oss-modal');
    this.setTitle(this.hasPage ? 'Update on Orbital Station' : 'Transmit to Orbital Station');
    this.contentEl.createEl('p', { cls: 'oss-muted', text: 'Contacting the station…' });
    this.info = await this.plugin.siteInfo();
    if (!this.info.ok) {
      this.contentEl.empty();
      this.contentEl.createEl('p', { cls: 'oss-error', text: this.info.error ?? 'The publisher could not start.' });
      new Setting(this.contentEl).addButton((b) =>
        b.setButtonText('Open settings').onClick(() => {
          this.close();
          const setting = /** @type {any} */ (this.app).setting;
          setting?.open?.();
          setting?.openTabById?.('orbital-station-publisher');
        }),
      );
      return;
    }
    const v = this.values;
    // A note that never chose an orbit starts in the one its vault folder belongs to.
    if (!String(this.plugin.fm(this.file)['station-orbit'] ?? '').trim()) v.orbit = orbitForNote(this.file.path, this.info.orbits ?? []) ?? v.orbit;
    if (!this.info.orbits?.some((o) => o.id === v.orbit)) v.orbit = this.info.orbits?.[0]?.id ?? v.orbit;
    this.scope.register(['Mod'], 'Enter', () => {
      this.submit();
      return false;
    });
    this.renderForm();
    this.scheduleCheck(0);
  }

  renderForm() {
    const { contentEl } = this;
    const info = /** @type {SiteInfo} */ (this.info);
    const v = this.values;
    contentEl.empty();
    const changed = () => {
      this.updatePreview();
      this.scheduleCheck();
    };

    new Setting(contentEl)
      .setName('Page type')
      .addDropdown((d) =>
        d
          .addOptions({ post: 'Transmission — a blog post', project: 'Mission — a Flight Log project' })
          .setValue(v.type)
          .onChange((val) => {
            v.type = val;
            this.renderForm();
            this.scheduleCheck();
          }),
      );

    /** @type {import('obsidian').TextComponent | undefined} */
    let slugInput;
    new Setting(contentEl).setName('Title').addText((t) =>
      t.setValue(v.title).onChange((val) => {
        v.title = val;
        if (!this.slugTouched) {
          v.slug = slugify(val);
          slugInput?.setValue(v.slug);
        }
        changed();
      }),
    );

    const slugSetting = new Setting(contentEl).setName('Web address').addText((t) => {
      slugInput = t;
      t.setValue(v.slug).onChange((val) => {
        this.slugTouched = true;
        v.slug = val;
        changed();
      });
    });
    this.previewEl = slugSetting.descEl;
    this.previewEl.addClass('oss-url');
    this.updatePreview();

    new Setting(contentEl)
      .setName('Orbit')
      .setDesc("Which domain this belongs to. New notes start in their folder's orbit.")
      .addDropdown((d) => {
        for (const o of info.orbits ?? []) d.addOption(o.id, o.name);
        d.setValue(v.orbit).onChange((val) => {
          v.orbit = val;
          changed();
        });
      });

    if (v.type === 'post') {
      new Setting(contentEl).setName('Kind').addDropdown((d) => {
        for (const k of info.kinds ?? []) d.addOption(k.id, k.label);
        d.setValue(v.kind).onChange((val) => (v.kind = val));
      });
      new Setting(contentEl)
        .setName('Date')
        .setDesc('Publication date, YYYY-MM-DD. Blank = keep the page\'s date (or today for a new page).')
        .addText((t) => {
          this.dateInput = t.inputEl;
          t.setPlaceholder('automatic')
            .setValue(v.date)
            .onChange((val) => (v.date = val.trim()));
        });
    } else {
      new Setting(contentEl).setName('Status').addDropdown((d) => {
        for (const s of info.statuses ?? []) d.addOption(s, s);
        d.setValue(v.status).onChange((val) => (v.status = val));
      });
    }

    new Setting(contentEl)
      .setName('Summary')
      .setDesc('One or two sentences for lists, search and link previews. Blank = the opening lines.')
      .addTextArea((t) => {
        t.setValue(v.summary).onChange((val) => (v.summary = val));
        t.inputEl.rows = 3;
      });

    if (v.type === 'post') {
      new Setting(contentEl)
        .setName('Tags')
        .setDesc('Separated by commas. Each becomes a public tag page.')
        .addText((t) =>
          t
            .setPlaceholder('astrophysics, jets')
            .setValue(v.tags.join(', '))
            .onChange((val) => {
              v.tags = asList(val);
            }),
        );
      new Setting(contentEl)
        .setName('Mission')
        .setDesc('File this under a Flight Log project (optional).')
        .addDropdown((d) => {
          d.addOption('', '— none —');
          for (const p of info.projects ?? []) d.addOption(p.id, p.title);
          if (v.project && !info.projects?.some((p) => p.id === v.project)) v.project = '';
          d.setValue(v.project).onChange((val) => {
            v.project = val;
            changed();
          });
        });
    }

    // Pinned to the bottom of the dialog, however small the window: what will go public
    // (a dry run of the publisher, refreshed as you edit), where it goes, errors, buttons.
    const actions = contentEl.createDiv({ cls: 'oss-actions' });
    this.checkEl = actions.createDiv({ cls: 'oss-check' });
    this.checkEl.createEl('p', { cls: 'oss-muted', text: 'Checking what will be published…' });
    this.blockedEl = actions.createDiv({ cls: 'oss-blocked' });
    this.blockedEl.hide();
    this.guardEl = actions.createDiv({ cls: 'oss-guard' });
    this.guardEl.hide();
    this.cleanRoomEl = actions.createDiv({ cls: 'oss-clean-room' });
    this.cleanRoomEl.hide();
    const deploy = info.deployBranch ?? DEPLOY_BRANCH;
    let where;
    if (!this.plugin.settings.push) where = 'Push is off — commits stay in the site folder until you push.';
    else if (!info.remote) where = 'No GitHub remote yet — the page is committed locally until you connect one (README §1).';
    else if (info.branch && info.branch !== deploy) where = `The site folder is on branch "${info.branch}" — only ${deploy} goes live.`;
    else where = info.siteUrl ? `Pushes to GitHub → ${info.siteUrl}` : 'Pushes to GitHub.';
    actions.createEl('p', { cls: 'oss-muted oss-git', text: where });
    this.errorEl = actions.createEl('p', { cls: 'oss-error' });

    new Setting(actions)
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((b) => {
        this.sendBtn = b;
        b.setCta()
          .setButtonText(this.hasPage ? 'Update page' : 'Transmit')
          .onClick(() => this.submit());
      });
    this.updateSendState();
  }

  siteBase() {
    return normalizeSiteUrl(this.plugin.settings.siteUrl) || this.info?.siteUrl || '/';
  }

  updatePreview() {
    if (!this.previewEl) return;
    const route = this.values.type === 'project' ? 'log' : 'transmissions';
    const slug = slugify(this.values.slug || this.values.title) || '…';
    this.previewEl.setText(`${this.siteBase().replace(/\/?$/, '/')}${route}/${slug}/`);
  }

  /** Re-run the dry run shortly after the last change. @param {number} [delay] */
  scheduleCheck(delay = 700) {
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => this.runCheck(), delay);
  }

  async runCheck() {
    const el = this.checkEl;
    if (!el || this.sending) return;
    const seq = ++this.checkSeq;
    const v = { ...this.values, slug: slugify(this.values.slug || this.values.title) };
    if (!v.slug) return;
    const res = await this.plugin.preflight(this.file, v);
    if (seq !== this.checkSeq || !this.checkEl) return;
    this.lastCheck = res;
    el.empty();
    if (!res.ok) {
      el.createEl('p', { cls: 'oss-check-problem', text: `✗ ${res.error}` });
      this.renderBlocked(null);
      this.renderGuard(undefined);
      this.renderCleanRoom(null);
      this.updateSendState();
      return;
    }
    // The dry run knows whether a page exists (e.g. published from the command line, or unpublished since).
    const exists = !!res.existing?.length;
    if (exists !== this.hasPage) {
      this.hasPage = exists;
      this.setTitle(exists ? 'Update on Orbital Station' : 'Transmit to Orbital Station');
      if (!this.sending) this.sendBtn?.setButtonText(exists ? 'Update page' : 'Transmit');
    }
    if (this.dateInput && !this.values.date && res.fields?.date) this.dateInput.placeholder = `automatic — ${res.fields.date}`;
    const summary =
      res.action === 'unchanged'
        ? 'No changes since the last publish.'
        : res.action === 'published'
          ? `A new page at ${res.path}.`
          : res.action === 'moved'
            ? `Moves the page to ${res.path}.`
            : `Updates ${res.path}.`;
    el.createEl('p', { cls: 'oss-check-head', text: summary });
    if (res.embeds?.length) {
      el.createEl('p', {
        cls: 'oss-check-embed',
        text: `⚠ Includes the full text of: ${res.embeds.map((e) => `“${e}”`).join(', ')} — make sure that's meant to be public.`,
      });
    }
    const rest = (res.warnings ?? []).filter((w) => !w.startsWith('Included the full text'));
    if (rest.length) {
      const ul = el.createEl('ul', { cls: 'oss-check-list' });
      for (const w of rest) ul.createEl('li', { text: w });
    }
    this.renderBlocked(res);
    this.renderGuard(res.guard);
    this.renderCleanRoom(res.media);
    this.updateSendState();
  }

  /** PRIV-03 secrets + PRIV-04 unscrubbable/oversized attachments — a fix is needed, not a yes.
   *  @param {PublishResult | null} res */
  renderBlocked(res) {
    const el = this.blockedEl;
    if (!el) return;
    el.empty();
    const lines = blockedLines(res);
    if (!lines.length) {
      el.hide();
      return;
    }
    el.show();
    el.createEl('p', { cls: 'oss-blocked-head', text: '⛔ Blocked — this can\'t be transmitted yet:' });
    const ul = el.createEl('ul', { cls: 'oss-blocked-list' });
    for (const line of lines) ul.createEl('li', { text: line });
  }

  /** PRIV-01 sensitive-area guard + MODEL-07 orbit visibility — a deliberate yes, never remembered.
   *  @param {Guard | undefined} guard */
  renderGuard(guard) {
    const el = this.guardEl;
    if (!el) return;
    const { key, ticked } = nextConfirmState(this.guardKey, guard, this.confirmSensitive);
    this.guardKey = key;
    this.confirmSensitive = ticked;
    el.empty();
    const reasons = guard?.confirm ? (guard.reasons ?? []) : [];
    if (!reasons.length) {
      el.hide();
      return;
    }
    el.show();
    el.createEl('p', { cls: 'oss-guard-head', text: '⚠ This needs a deliberate yes first:' });
    const ul = el.createEl('ul', { cls: 'oss-guard-list' });
    for (const r of reasons) ul.createEl('li', { text: r });
    new Setting(el).setClass('oss-guard-toggle').setName("Publish from a sensitive area — it becomes public in the site's repository").addToggle((t) =>
      t.setValue(this.confirmSensitive).onChange((val) => {
        this.confirmSensitive = val;
        this.updateSendState();
      }),
    );
  }

  /** PRIV-04 — one quiet line per copied attachment. @param {MediaEntry[] | null | undefined} media */
  renderCleanRoom(media) {
    const el = this.cleanRoomEl;
    if (!el) return;
    el.empty();
    const lines = cleanRoomLines(media);
    if (!lines.length) {
      el.hide();
      return;
    }
    el.show();
    el.createEl('p', { cls: 'oss-clean-room-head', text: 'Clean room' });
    const ul = el.createEl('ul', { cls: 'oss-clean-room-list' });
    (media ?? []).forEach((m, i) => {
      const li = ul.createEl('li', { text: lines[i] });
      if (m.kind === 'unscrubbed' || m.kind === 'blocked') li.addClass('mod-warning');
    });
  }

  /** Transmit is disabled until nothing is blocked and any needed yes has been ticked. */
  updateSendState() {
    this.sendBtn?.setDisabled(!canTransmit(this.lastCheck, this.confirmSensitive));
  }

  validateForm() {
    const v = this.values;
    v.title = v.title.replace(/\s+/g, ' ').trim();
    v.slug = slugify(v.slug || v.title);
    if (!v.title) return 'Give it a title.';
    if (!v.slug) return 'The web address needs at least one letter or number.';
    if (v.type === 'post' && v.date && !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return 'Date should look like 2026-09-26 (or leave it blank).';
    return null;
  }

  async submit() {
    if (this.sending) return;
    const problem = this.validateForm();
    if (problem) {
      this.errorEl?.setText(problem);
      return;
    }
    if (!canTransmit(this.lastCheck, this.confirmSensitive)) return; // belt and braces — the button should already be disabled
    this.errorEl?.setText('');
    this.sending = true;
    this.checkSeq++; // ignore any dry run still in flight
    this.sendBtn?.setDisabled(true).setButtonText('Transmitting…');
    const res = await this.plugin.publish(this.file, { ...this.values }, { confirmSensitive: this.confirmSensitive });
    this.sending = false;
    if (res.ok) this.close();
    else {
      this.sendBtn?.setButtonText(this.hasPage ? 'Update page' : 'Transmit');
      this.updateSendState();
      if (res.error && res.error !== 'busy') this.errorEl?.setText(res.error);
    }
  }

  onClose() {
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkSeq++;
    this.checkEl = null;
    this.contentEl.empty();
  }
}

class ConfirmModal extends Modal {
  /**
   * @param {import('obsidian').App} app
   * @param {{ title: string, body: string, cta: string, onConfirm: () => void }} opts
   */
  constructor(app, opts) {
    super(app);
    this.opts = opts;
  }
  onOpen() {
    this.setTitle(this.opts.title);
    this.contentEl.createEl('p', { text: this.opts.body });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((b) => {
        // setDestructive() arrived in Obsidian 1.13; older versions use setWarning().
        const btn = /** @type {any} */ (b);
        if (typeof btn.setDestructive === 'function') btn.setDestructive().setCta();
        else btn.setWarning();
        b.setButtonText(this.opts.cta).onClick(() => {
          this.close();
          this.opts.onConfirm();
        });
      });
  }
  onClose() {
    this.contentEl.empty();
  }
}

/* =============================================================
   Settings
   ============================================================= */
class StationSettingTab extends PluginSettingTab {
  /** @param {import('obsidian').App} app @param {OrbitalStationPublisher} plugin */
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Orbital Station folder')
      .setDesc('The site repository on this computer (the folder with package.json).')
      .addText((t) =>
        t
          .setPlaceholder('C:\\Users\\you\\…\\The Orbital Station')
          .setValue(s.repoPath)
          .onChange(async (v) => {
            s.repoPath = cleanPath(v);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Node.js')
      .setDesc(`Path to node. Leave blank to auto-detect (currently: ${this.plugin.nodePath()}).`)
      .addText((t) =>
        t.setValue(s.nodePath).onChange(async (v) => {
          s.nodePath = cleanPath(v);
          await this.plugin.saveSettings();
        }),
      );

    const defaultSiteDesc = 'Only needed with a custom domain — otherwise it is worked out from the GitHub remote.';
    const site = new Setting(containerEl).setName('Site address').setDesc(defaultSiteDesc);
    site.addText((t) =>
      t
        .setPlaceholder('https://yourdomain.com/')
        .setValue(s.siteUrl)
        .onChange(async (v) => {
          const url = normalizeSiteUrl(v);
          if (url === null) {
            site.setDesc('✗ That isn\'t a web address — it should look like https://yourdomain.com/ (not saved).');
            return;
          }
          site.setDesc(url ? `Pages will link to ${url}` : defaultSiteDesc);
          s.siteUrl = url;
          await this.plugin.saveSettings();
        }),
    );

    new Setting(containerEl)
      .setName('Default orbit')
      .setDesc("Pre-selected for new notes outside every orbit's folders (folders are set in the site's site.config.ts).")
      .addDropdown((d) => {
        d.addOption(s.defaultOrbit, s.defaultOrbit.toUpperCase());
        d.setValue(s.defaultOrbit).onChange(async (v) => {
          s.defaultOrbit = v;
          await this.plugin.saveSettings();
        });
        // Offer the site's own orbits once the publisher answers.
        this.plugin.siteInfo().then((info) => {
          if (!info.orbits?.length) return;
          d.selectEl.empty();
          for (const o of info.orbits) d.addOption(o.id, o.name);
          if (!info.orbits.some((o) => o.id === s.defaultOrbit)) d.addOption(s.defaultOrbit, s.defaultOrbit.toUpperCase());
          d.setValue(s.defaultOrbit);
        });
      });

    new Setting(containerEl)
      .setName('Push to GitHub after publishing')
      .setDesc('Off = commit locally only, and push yourself later.')
      .addToggle((t) =>
        t.setValue(s.push).onChange(async (v) => {
          s.push = v;
          await this.plugin.saveSettings();
        }),
      );

    const check = new Setting(containerEl).setName('Check setup').setDesc('Runs the publisher once to confirm everything is connected.');
    check.addButton((b) =>
      b.setButtonText('Run check').onClick(async () => {
        b.setDisabled(true);
        check.setDesc('Checking…');
        const info = await this.plugin.siteInfo(true);
        b.setDisabled(false);
        if (!info.ok) {
          check.setDesc(`✗ ${info.error}`);
          return;
        }
        const deploy = info.deployBranch ?? DEPLOY_BRANCH;
        check.setDesc(
          [
            `✓ Node ${info.node}`,
            info.git ? `git branch ${info.branch}${info.branch && info.branch !== deploy ? ` (⚠ only ${deploy} goes live)` : ''}` : '✗ not a git repository',
            info.remote ? `remote ${info.remote}` : 'no GitHub remote yet (commits stay local)',
            info.siteUrl ? `site ${info.siteUrl}` : null,
            `${info.projects?.length ?? 0} missions`,
          ]
            .filter(Boolean)
            .join(' · '),
        );
      }),
    );
  }
}

// The M0-gate rendering/logic helpers above are pure (no Obsidian, no DOM), so tests can
// exercise them directly without a real Obsidian window. module.exports stays the plugin
// class itself — this is attached as a property, not a second export.
OrbitalStationPublisher.gateHelpers = {
  blockedLines,
  guardReasons,
  reasonsKey,
  nextConfirmState,
  cleanRoomLine,
  cleanRoomLines,
  canTransmit,
  buildPublishArgs,
  queueSummary,
};
OrbitalStationPublisher.TransmitModal = TransmitModal;

module.exports = OrbitalStationPublisher;
