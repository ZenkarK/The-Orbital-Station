/* =============================================================
   The Transmit dialog's side of the M0 "Ignition" gates:
     PRIV-01  sensitive-area guard
     MODEL-07 orbit-visibility confirmation
     PRIV-03  secrets (blocked)
     PRIV-04  clean-room attachments

   obsidian-plugin/main.js is a CommonJS Obsidian plugin (no build step,
   `require('obsidian')`). We load it under a stub "obsidian" module —
   just enough of the real API's shape for the plugin's module-level
   `class X extends Y` declarations and the instance methods under test —
   never the real Obsidian app, and never against a real vault.
   ============================================================= */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN_JS = path.join(ROOT, 'obsidian-plugin', 'main.js');

/** A do-nothing element, enough like Obsidian's HTMLElement extensions for code that never
 *  actually renders in these tests (we call plugin/instance methods directly, not onOpen). */
function fakeEl() {
  const el = {
    addClass() {},
    removeClass() {},
    empty() {},
    show() {},
    hide() {},
    setText() {},
    setAttr() {},
    createEl: () => fakeEl(),
    createDiv: () => fakeEl(),
  };
  return el;
}

/** Like fakeEl(), but actually records what gets rendered into it (tag/cls/text, and
 *  children created via createEl/createDiv), so a test can assert on the rendered DOM
 *  shape without a real Obsidian window. */
function recordingEl() {
  const el = {
    hidden: false,
    text: undefined,
    children: [],
    addClass() {},
    removeClass() {},
    empty() {
      el.children = [];
    },
    show() {
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
    setText(t) {
      el.text = t;
    },
    setAttr() {},
    createEl(tag, opts = {}) {
      const child = recordingEl();
      child.tag = tag;
      child.cls = opts.cls;
      child.text = opts.text;
      el.children.push(child);
      return child;
    },
    createDiv(opts) {
      return el.createEl('div', opts);
    },
  };
  return el;
}

/** Every li's text under every ul.oss-check-list rendered into `el` (recordingEl() only). */
function checkListLines(el) {
  return el.children.filter((c) => c.tag === 'ul' && c.cls === 'oss-check-list').flatMap((ul) => ul.children.map((li) => li.text));
}

class FakeNotice {
  constructor(message, timeout) {
    this.message = message;
    this.timeout = timeout;
    FakeNotice.calls.push(this);
  }
  hide() {}
}
FakeNotice.calls = [];

class FakePlugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
  }
  addRibbonIcon() {
    return fakeEl();
  }
  addCommand() {}
  addSettingTab() {}
  registerEvent() {}
  registerDomEvent() {}
  addStatusBarItem() {
    return fakeEl();
  }
  loadData() {
    return Promise.resolve(null);
  }
  saveData() {
    return Promise.resolve();
  }
}

class FakePluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }
}

class FakeSetting {
  constructor(containerEl) {
    this.containerEl = containerEl;
    this.settingEl = fakeEl();
    this.descEl = fakeEl();
  }
  setName() {
    return this;
  }
  setDesc() {
    return this;
  }
  setClass() {
    return this;
  }
  setHeading() {
    return this;
  }
  addDropdown(cb) {
    cb({ addOption() { return this; }, addOptions() { return this; }, setValue() { return this; }, onChange() { return this; }, selectEl: fakeEl() });
    return this;
  }
  addText(cb) {
    cb({ setValue() { return this; }, setPlaceholder() { return this; }, onChange() { return this; }, inputEl: fakeEl() });
    return this;
  }
  addTextArea(cb) {
    cb({ setValue() { return this; }, onChange() { return this; }, inputEl: fakeEl() });
    return this;
  }
  addToggle(cb) {
    cb({ setValue() { return this; }, onChange() { return this; } });
    return this;
  }
  addButton(cb) {
    cb({ setButtonText() { return this; }, setCta() { return this; }, setDisabled() { return this; }, onClick() { return this; } });
    return this;
  }
}

class FakeModal {
  constructor(app) {
    this.app = app;
    this.contentEl = fakeEl();
    this.modalEl = fakeEl();
    this.scope = { register() {} };
  }
  setTitle() {}
  open() {}
  close() {}
}

class FakeTFile {
  constructor(path_, basename, extension = 'md') {
    this.path = path_;
    this.basename = basename;
    this.extension = extension;
  }
}

class FakeMarkdownView {}
class FakeFileSystemAdapter {
  getBasePath() {
    return '';
  }
}

const FAKE_OBSIDIAN = {
  Plugin: FakePlugin,
  PluginSettingTab: FakePluginSettingTab,
  Setting: FakeSetting,
  Modal: FakeModal,
  Notice: FakeNotice,
  TFile: FakeTFile,
  MarkdownView: FakeMarkdownView,
  FileSystemAdapter: FakeFileSystemAdapter,
};

let Plugin; // the plugin class main.js exports, loaded under the stub above
let restoreLoad;

before(() => {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'obsidian') return FAKE_OBSIDIAN;
    return originalLoad.call(this, request, parent, isMain);
  };
  restoreLoad = () => {
    Module._load = originalLoad;
  };
  // The repo's package.json says "type": "module", which would make Node's normal
  // require()/import resolution treat obsidian-plugin/main.js as ESM (it isn't — it's the
  // CommonJS module Obsidian itself loads, unaffected by this repo's own package.json since
  // the vault copy sits outside it). Compiling it by hand as a `.cjs`-named Module sidesteps
  // that extension-based detection without touching main.js.
  const code = fs.readFileSync(MAIN_JS, 'utf8');
  const fakeFilename = MAIN_JS.replace(/\.js$/, '.cjs');
  const mod = new Module(fakeFilename, null);
  mod.filename = fakeFilename;
  mod.paths = Module._nodeModulePaths(path.dirname(MAIN_JS));
  mod._compile(code, fakeFilename);
  Plugin = mod.exports;
});

after(() => {
  restoreLoad();
});

const helpers = () => Plugin.gateHelpers;

/* ---------------------------------------------------------------- blocked / guard / clean-room text */

test('blockedLines passes through the publisher\'s already-redacted blocked lines, and nothing beyond', () => {
  const line = 'Possible AWS access key in "Notes/Keyed.md" line 7 (AKIA••••••••••••QQQQ). If it isn\'t a secret, add abc123 to .secrets-allow in the site folder.';
  assert.deepEqual(helpers().blockedLines({ ok: true, blocked: [line] }), [line]);
  assert.deepEqual(helpers().blockedLines({ ok: true, blocked: [] }), []);
  assert.deepEqual(helpers().blockedLines(null), []);
  assert.deepEqual(helpers().blockedLines(undefined), []);
  assert.deepEqual(helpers().blockedLines({ ok: true }), []);
});

test('guardReasons surfaces reasons only when guard.confirm is true', () => {
  const reasons = ['The note is in the sensitive "Work" folder.'];
  assert.deepEqual(helpers().guardReasons({ ok: true, guard: { confirm: true, confirmed: false, reasons } }), reasons);
  // confirm: false must never leak reasons, even if some were computed and left on the object.
  assert.deepEqual(helpers().guardReasons({ ok: true, guard: { confirm: false, confirmed: false, reasons: ['stale'] } }), []);
  assert.deepEqual(helpers().guardReasons(null), []);
});

test('cleanRoomLines: one friendly line per attachment, matching the removed categories, or "no hidden metadata"', () => {
  const media = [
    { file: 'Astrophysics/photo.jpg', dest: 'public/files/posts/jets/photo.jpg', kind: 'scrubbed', removed: ['location (GPS)', 'camera and device details'] },
    { file: 'Astrophysics/diagram.svg', dest: 'public/files/posts/jets/diagram.svg', kind: 'clean', removed: [] },
    { file: 'Astrophysics/notes.txt', dest: 'public/files/posts/jets/notes.txt', kind: 'text', removed: [] },
  ];
  assert.deepEqual(helpers().cleanRoomLines(media), [
    'photo.jpg — removed location (GPS), camera and device details',
    'diagram.svg — no hidden metadata',
    'notes.txt — no hidden metadata',
  ]);
  assert.deepEqual(helpers().cleanRoomLines([]), []);
  assert.deepEqual(helpers().cleanRoomLines(null), []);
});

test('cleanRoomLines flags a file passed through unscrubbed, without printing its metadata values', () => {
  const media = [{ file: 'Attachments/weird.bin', kind: 'unscrubbed', removed: [], reason: 'no clean-room tool for ".bin"' }];
  const [line] = helpers().cleanRoomLines(media);
  assert.match(line, /weird\.bin/);
  assert.match(line, /unscrubbed/);
  assert.match(line, /no clean-room tool for "\.bin"/);
});

/* ---------------------------------------------------------------- canTransmit */

test('canTransmit: blocked, blocked wins even with an empty guard', () => {
  assert.equal(helpers().canTransmit({ ok: true, blocked: ['x'], guard: { confirm: false, confirmed: false, reasons: [] } }, false), false);
  assert.equal(helpers().canTransmit({ ok: true, blocked: ['x'], guard: { confirm: true, confirmed: true, reasons: ['r'] } }, true), false);
});

test('canTransmit: no guard and nothing blocked → allowed', () => {
  assert.equal(helpers().canTransmit({ ok: true, blocked: [], guard: { confirm: false, confirmed: false, reasons: [] } }, false), true);
});

test('canTransmit: guard.confirm true → allowed only once ticked', () => {
  const res = { ok: true, blocked: [], guard: { confirm: true, confirmed: false, reasons: ['KIN is phase-only: …'] } };
  assert.equal(helpers().canTransmit(res, false), false);
  assert.equal(helpers().canTransmit(res, true), true);
});

test('canTransmit: no dry-run result yet, or a failed one → not allowed', () => {
  assert.equal(helpers().canTransmit(null, false), false);
  assert.equal(helpers().canTransmit({ ok: false, error: 'boom' }, true), false);
});

/* ---------------------------------------------------------------- the confirmation checkbox reset */

test('nextConfirmState keeps the tick when the guard reasons are unchanged', () => {
  const guard = { confirm: true, confirmed: false, reasons: ['The note is in the sensitive "Work" folder.'] };
  const first = helpers().nextConfirmState(null, guard, false);
  assert.equal(first.ticked, false); // never remembered — starts unticked
  const second = helpers().nextConfirmState(first.key, guard, true); // same reasons, now ticked
  assert.equal(second.ticked, true);
  assert.equal(second.key, first.key);
});

test('nextConfirmState resets the tick when the reasons change (e.g. switching to a phase-only orbit)', () => {
  const guardA = { confirm: true, confirmed: false, reasons: ['The note is in the sensitive "Work" folder.'] };
  const guardB = { confirm: true, confirmed: false, reasons: ['KIN is phase-only: the site won\'t list this page, but the file becomes public in the site\'s repository.'] };
  const ticked = helpers().nextConfirmState(null, guardA, false);
  assert.equal(helpers().nextConfirmState(ticked.key, guardA, true).ticked, true); // sanity: same reasons stays ticked
  const afterSwitch = helpers().nextConfirmState(ticked.key, guardB, true); // different reasons, was ticked
  assert.equal(afterSwitch.ticked, false);
});

test('nextConfirmState resets the tick once the guard clears entirely', () => {
  const guard = { confirm: true, confirmed: false, reasons: ['The note is in the sensitive "Work" folder.'] };
  const ticked = helpers().nextConfirmState(null, guard, true);
  const cleared = helpers().nextConfirmState(ticked.key, { confirm: false, confirmed: false, reasons: [] }, true);
  assert.equal(cleared.ticked, false);
});

/* ---------------------------------------------------------------- publish args */

test('buildPublishArgs includes --confirm-sensitive only when ticked', () => {
  const v = { type: 'post', title: 'Jets', slug: 'jets', orbit: 'astro', kind: 'essay', status: 'ACTIVE', date: '', summary: 'S', tags: [], project: '' };
  const untouched = helpers().buildPublishArgs(v, {});
  assert.ok(!untouched.includes('--confirm-sensitive'));
  const ticked = helpers().buildPublishArgs(v, { confirmSensitive: true });
  assert.ok(ticked.includes('--confirm-sensitive'));
  const declined = helpers().buildPublishArgs(v, { confirmSensitive: false });
  assert.ok(!declined.includes('--confirm-sensitive'));
});

test('the plugin instance\'s argsFor delegates to buildPublishArgs, carrying the site URL', () => {
  const plugin = new Plugin({}, {});
  plugin.settings.siteUrl = 'https://example.com/';
  const v = { type: 'project', title: 'Voyage', slug: 'voyage', orbit: 'voyage', kind: 'essay', status: 'ACTIVE', date: '', summary: '', tags: [], project: '' };
  const args = plugin.argsFor(v, { confirmSensitive: true });
  assert.ok(args.includes('--confirm-sensitive'));
  assert.ok(args.includes('--site-url'));
  assert.ok(args.includes('https://example.com/'));
  assert.ok(!plugin.argsFor(v, {}).includes('--confirm-sensitive'));
});

/* ---------------------------------------------------------------- "Republish (skip dialog)" */

test('republish: a clean dry run (no guard, nothing blocked) publishes directly, without opening the dialog', async () => {
  const plugin = new Plugin({}, {});
  const file = new FakeTFile('Notes/Jets.md', 'Jets');
  plugin.valuesFromNote = () => ({ type: 'post', title: 'Jets', slug: 'jets', orbit: 'astro', kind: 'essay', status: 'ACTIVE', date: '', summary: '', tags: [], project: '' });
  plugin.preflight = async () => ({ ok: true, dryRun: true, guard: { confirm: false, confirmed: false, reasons: [] }, blocked: [] });
  let dialogOpened = false;
  let published = null;
  plugin.openDialog = () => {
    dialogOpened = true;
  };
  plugin.publish = async (f, v) => {
    published = { f, v };
    return { ok: true, action: 'updated' };
  };
  await plugin.republish(file);
  assert.equal(dialogOpened, false);
  assert.ok(published);
  assert.equal(published.v.title, 'Jets');
});

test('republish: guard.confirm true opens the dialog instead of publishing, with a Notice explaining why', async () => {
  const plugin = new Plugin({}, {});
  const file = new FakeTFile('Health/Vitals.md', 'Vitals');
  plugin.valuesFromNote = () => ({ type: 'post', title: 'Vitals', slug: 'vitals', orbit: 'kin', kind: 'essay', status: 'ACTIVE', date: '', summary: '', tags: [], project: '' });
  plugin.preflight = async () => ({
    ok: true,
    dryRun: true,
    guard: { confirm: true, confirmed: false, reasons: ['The note is in the sensitive "Health" folder.'] },
    blocked: [],
  });
  let dialogOpened = false;
  plugin.openDialog = () => {
    dialogOpened = true;
  };
  plugin.publish = async () => {
    throw new Error('must not publish while the guard needs a yes');
  };
  FakeNotice.calls.length = 0;
  await plugin.republish(file);
  assert.equal(dialogOpened, true);
  assert.equal(FakeNotice.calls.length, 1);
  assert.match(FakeNotice.calls[0].message, /Health/);
});

test('republish: a blocked secret opens the dialog instead of publishing, with a Notice explaining why', async () => {
  const plugin = new Plugin({}, {});
  const file = new FakeTFile('Notes/Keyed.md', 'Keyed');
  plugin.valuesFromNote = () => ({ type: 'post', title: 'Keyed', slug: 'keyed', orbit: 'astro', kind: 'essay', status: 'ACTIVE', date: '', summary: '', tags: [], project: '' });
  const blockedLine = 'Possible AWS access key in "Notes/Keyed.md" line 7 (AKIA••••). If it isn\'t a secret, add abc123 to .secrets-allow in the site folder.';
  plugin.preflight = async () => ({
    ok: true,
    dryRun: true,
    guard: { confirm: false, confirmed: false, reasons: [] },
    blocked: [blockedLine],
  });
  let dialogOpened = false;
  plugin.openDialog = () => {
    dialogOpened = true;
  };
  plugin.publish = async () => {
    throw new Error('must not publish while something is blocked');
  };
  FakeNotice.calls.length = 0;
  await plugin.republish(file);
  assert.equal(dialogOpened, true);
  assert.equal(FakeNotice.calls.length, 1);
  assert.match(FakeNotice.calls[0].message, /AWS access key/);
});

test('republish: a failed dry run shows a Notice and never opens the dialog or publishes', async () => {
  const plugin = new Plugin({}, {});
  const file = new FakeTFile('Notes/Broken.md', 'Broken');
  plugin.valuesFromNote = () => ({ type: 'post', title: 'Broken', slug: 'broken', orbit: 'astro', kind: 'essay', status: 'ACTIVE', date: '', summary: '', tags: [], project: '' });
  plugin.preflight = async () => ({ ok: false, error: 'The note\'s properties (frontmatter) aren\'t valid YAML: bad indentation.' });
  let dialogOpened = false;
  let published = false;
  plugin.openDialog = () => {
    dialogOpened = true;
  };
  plugin.publish = async () => {
    published = true;
    return { ok: true };
  };
  FakeNotice.calls.length = 0;
  await plugin.republish(file);
  assert.equal(dialogOpened, false);
  assert.equal(published, false);
  assert.equal(FakeNotice.calls.length, 1);
  assert.match(FakeNotice.calls[0].message, /YAML/);
});

/* ---------------------------------------------------------------- LIVE-08: the reworded move/redirect warning in the dialog */

/** A TransmitModal wired up enough to call runCheck() directly (no real onOpen/renderForm —
 *  same "call instance methods directly" approach the rest of this file uses). */
function transmitModalFor(plugin, file) {
  // Real valuesFromNote()/hasPage()/fm() all read this.app.metadataCache, which the plugin's
  // real `app` (an empty stub — no real Obsidian window in these tests) doesn't have. Override
  // them as own properties (the same pattern the tests above use), same as if the note carried
  // no station-* properties yet, but with a non-empty slug so runCheck() doesn't bail out early.
  plugin.valuesFromNote = () => ({
    type: 'post',
    title: file.basename,
    slug: file.basename.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    orbit: 'astro',
    kind: 'essay',
    status: 'ACTIVE',
    date: '',
    summary: '',
    tags: [],
    project: '',
  });
  plugin.hasPage = () => false;
  plugin.fm = () => ({});
  const modal = new Plugin.TransmitModal(plugin, file);
  modal.checkEl = recordingEl();
  modal.blockedEl = recordingEl();
  modal.guardEl = recordingEl();
  modal.cleanRoomEl = recordingEl();
  return modal;
}

test("the Transmit dialog's check list shows the reworded warning when a move's destination orbit is public (\"now redirects here\")", async () => {
  const file = new FakeTFile('Astrophysics/Jets.md', 'Jets');
  const plugin = new Plugin({}, {});
  plugin.preflight = async () => ({
    ok: true,
    dryRun: true,
    action: 'moved',
    path: '/transmissions/jets/',
    redirects: { added: 1, removed: 0 },
    guard: { confirm: false, confirmed: false, reasons: [] },
    blocked: [],
    warnings: ['Moves the page from /transmissions/old-jets/ — the old address now redirects here.'],
  });
  const modal = transmitModalFor(plugin, file);
  await modal.runCheck();
  assert.deepEqual(checkListLines(modal.checkEl), ['Moves the page from /transmissions/old-jets/ — the old address now redirects here.']);
});

test("the Transmit dialog's check list shows the reworded warning when a move's destination orbit is not public (\"stops working\")", async () => {
  const file = new FakeTFile('Astrophysics/Jets.md', 'Jets');
  const plugin = new Plugin({}, {});
  plugin.preflight = async () => ({
    ok: true,
    dryRun: true,
    action: 'moved',
    path: '/transmissions/jets/',
    redirects: { added: 0, removed: 0 },
    guard: { confirm: false, confirmed: false, reasons: [] },
    blocked: [],
    warnings: ['Moves the page from /transmissions/old-jets/ — the old address stops working.'],
  });
  const modal = transmitModalFor(plugin, file);
  await modal.runCheck();
  assert.deepEqual(checkListLines(modal.checkEl), ['Moves the page from /transmissions/old-jets/ — the old address stops working.']);
});

/* ---------------------------------------------------------------- "Open transmission queue" (GROW-08) */

const queueResult = (over = {}) => ({
  ok: true,
  queued: [
    { note: 'Astrophysics/Jets.md', title: 'Jets', orbit: 'astro', public: true, sensitive: null, published: null, problems: [] },
    { note: 'Astrophysics/Old.md', title: 'Old', orbit: 'astro', public: true, sensitive: null, published: '2026-09-01', problems: [] },
  ],
  problems: [],
  launch: { transmissions: 3, orbits: 2, ready: false, need: { transmissions: 8, orbits: 5 }, projected: { transmissions: 4, orbits: 2 } },
  base: { path: 'Transmission Queue.base', written: true },
  ...over,
});

test('queueSummary states the launch count, the queue, and every flagged note', () => {
  const text = helpers().queueSummary(queueResult({ problems: ['"Work/Plan.md" is in the sensitive folder "Work" — take it out of the queue.'] }));
  assert.match(text, /^Launch: 3\/8 transmissions across 2\/5 public orbits\./);
  assert.match(text, /1 queued; with the queue sent: 4 across 2\./);
  assert.match(text, /✗ "Work\/Plan\.md" is in the sensitive folder "Work"/);
  assert.doesNotMatch(helpers().queueSummary(queueResult()), /✗/);
  assert.match(helpers().queueSummary(queueResult({ base: { path: 'Transmission Queue.base', written: false } })), /wasn't made by the publisher/);
});

test('openQueue runs the publisher with --queue for this vault, then opens the Base', async () => {
  let opened = null;
  const plugin = new Plugin({ workspace: { openLinkText: async (p) => (opened = p) } }, {});
  plugin.vaultRoot = () => 'C:/vault';
  let args = null;
  plugin.runScript = async (a) => ((args = a), queueResult());
  FakeNotice.calls = [];
  await plugin.openQueue();
  assert.deepEqual(args, ['--queue', '--vault', 'C:/vault']);
  assert.equal(opened, 'Transmission Queue.base');
  assert.match(FakeNotice.calls.at(-1).message, /^Launch: 3\/8/);
});

test('openQueue shows the error and opens nothing when the publisher fails', async () => {
  let opened = false;
  const plugin = new Plugin({ workspace: { openLinkText: async () => (opened = true) } }, {});
  plugin.vaultRoot = () => 'C:/vault';
  plugin.runScript = async () => ({ ok: false, error: 'Which vault? Pass --vault.' });
  FakeNotice.calls = [];
  await plugin.openQueue();
  assert.equal(opened, false);
  assert.match(FakeNotice.calls.at(-1).message, /✗ Which vault/);
});
