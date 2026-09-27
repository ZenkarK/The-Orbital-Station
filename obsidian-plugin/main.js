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
 * @typedef {{ id: string, name: string }} OrbitInfo
 * @typedef {{ ok: boolean, error?: string, node?: string, git?: boolean, branch?: string|null, deployBranch?: string,
 *   remote?: string|null, siteUrl?: string|null, orbits?: OrbitInfo[], kinds?: {id: string, label: string}[],
 *   statuses?: string[], projects?: {id: string, title: string}[] }} SiteInfo
 * @typedef {{ ok: boolean, error?: string, action?: string, title?: string, slug?: string, url?: string|null,
 *   path?: string, fields?: Record<string, any>, existing?: string[], removed?: string[], embeds?: string[],
 *   committed?: boolean, pushed?: boolean, upToDate?: boolean, remote?: boolean, branch?: string|null,
 *   online?: boolean, note?: string, warnings?: string[], dryRun?: boolean }} PublishResult
 * @typedef {{ type: string, title: string, slug: string, orbit: string, kind: string, status: string,
 *   date: string, summary: string, tags: string[], project: string }} Values
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
      checkCallback: (checking) =>
        this.onActive(checking, (f) => this.publish(f, this.valuesFromNote(f)), (f) => this.hasPage(f)),
    });
    this.addCommand({
      id: 'unpublish-note',
      name: 'Unpublish current note',
      checkCallback: (checking) => this.onActive(checking, (f) => this.confirmUnpublish(f), (f) => this.hasPage(f)),
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

  /** @param {Values} v @returns {string[]} */
  argsFor(v) {
    const args = ['--type', v.type, '--title', v.title, '--slug', v.slug || slugify(v.title), '--orbit', v.orbit, '--summary', v.summary.trim()];
    if (v.type === 'post') {
      args.push('--kind', v.kind, '--tags', v.tags.join(','), '--project', v.project);
      if (v.date) args.push('--date', v.date);
    } else args.push('--status', v.status);
    if (this.settings.siteUrl) args.push('--site-url', this.settings.siteUrl);
    return args;
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

  /* ---------- publish / unpublish ---------- */

  /** Did the page actually reach the live site? @param {PublishResult} res */
  isOnline(res) {
    if (!this.settings.push) return true; // you push yourself; trust the commit
    return !!(res.remote && (res.pushed || res.upToDate) && res.branch === DEPLOY_BRANCH);
  }

  /**
   * @param {TFile} file
   * @param {Values} v
   * @returns {Promise<PublishResult>}
   */
  async publish(file, v) {
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
      const args = [path.join(root, file.path), '--vault', root, ...this.argsFor(v)];
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
    /** @type {HTMLInputElement | null} */ this.dateInput = null;
    /** @type {import('obsidian').ButtonComponent | null} */ this.sendBtn = null;
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
      .setDesc('Which of the six domains this belongs to.')
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
    el.empty();
    if (!res.ok) {
      el.createEl('p', { cls: 'oss-check-problem', text: `✗ ${res.error}` });
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
    this.errorEl?.setText('');
    this.sending = true;
    this.checkSeq++; // ignore any dry run still in flight
    this.sendBtn?.setDisabled(true).setButtonText('Transmitting…');
    const res = await this.plugin.publish(this.file, { ...this.values });
    this.sending = false;
    if (res.ok) this.close();
    else {
      this.sendBtn?.setDisabled(false).setButtonText(this.hasPage ? 'Update page' : 'Transmit');
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
      .setDesc('Pre-selected in the dialog for notes that have never been published.')
      .addDropdown((d) => {
        for (const id of ['systems', 'markets', 'craft', 'astro', 'venture', 'words']) d.addOption(id, id.toUpperCase());
        d.setValue(s.defaultOrbit).onChange(async (v) => {
          s.defaultOrbit = v;
          await this.plugin.saveSettings();
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

module.exports = OrbitalStationPublisher;
