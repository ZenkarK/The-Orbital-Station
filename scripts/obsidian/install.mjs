#!/usr/bin/env node
/* =============================================================
   Install (or update) the Orbital Station Publisher plugin in a vault.

     npm run obsidian:install                       # the only / last-opened vault
     npm run obsidian:install -- "C:\path\to\Vault"

   Copies obsidian-plugin/ into <vault>/.obsidian/plugins/, points the
   plugin at this repo and at the Node.js running this script, and turns
   it on (when Obsidian is closed — otherwise it tells you the one click).
   Safe to run again after pulling changes.

   Whether Obsidian is running is normally detected with tasklist/pgrep.
   Set ORBITAL_OBSIDIAN_RUNNING=1 or =0 to override that detection (used
   by tests, and useful if the process check is wrong on your machine).
   ============================================================= */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ID = 'orbital-station-publisher';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = path.join(repo, 'obsidian-plugin');

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

function obsidianConfigDir() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? '', 'obsidian');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'obsidian');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'obsidian');
}

function knownVaults() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(obsidianConfigDir(), 'obsidian.json'), 'utf8'));
    return Object.values(cfg.vaults ?? {}).sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  } catch {
    return [];
  }
}

function obsidianRunning() {
  if (process.env.ORBITAL_OBSIDIAN_RUNNING === '1') return true;
  if (process.env.ORBITAL_OBSIDIAN_RUNNING === '0') return false;
  try {
    if (process.platform === 'win32') {
      return /obsidian\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq Obsidian.exe', '/NH'], { encoding: 'utf8' }));
    }
    execFileSync('pgrep', ['-xi', 'obsidian'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/* ---------- which vault ---------- */
let vault = process.argv[2];
if (!vault) {
  const vaults = knownVaults();
  if (!vaults.length) fail('No Obsidian vault found. Run: npm run obsidian:install -- "C:\\path\\to\\Vault"');
  vault = vaults[0].path;
  if (vaults.length > 1) console.log(`  (Several vaults found — using the most recent: ${vault}. Pass a path to choose another.)`);
}
vault = path.resolve(vault);
if (!fs.existsSync(path.join(vault, '.obsidian'))) fail(`"${vault}" is not an Obsidian vault (no .obsidian folder).`);

/* ---------- copy the plugin ---------- */
const dest = path.join(vault, '.obsidian', 'plugins', ID);

/** Read a JSON file that may not exist yet; never silently replace one we can't read. */
function readJson(file, fallback, check = () => true) {
  if (!fs.existsSync(file)) return fallback;
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); // tolerate a byte-order mark
  } catch (e) {
    fail(`Couldn't read ${file} (${e.message}). Fix or delete it, then run this again — it was left untouched.`);
  }
  if (!check(value)) fail(`${file} doesn't look right (unexpected contents). Fix it, then run this again — it was left untouched.`);
  return value;
}

/* ---------- settings: this repo + this node (other settings are kept) ---------- */
const dataFile = path.join(dest, 'data.json');
const data = readJson(dataFile, {}, (v) => v && typeof v === 'object' && !Array.isArray(v));
const listFile = path.join(vault, '.obsidian', 'community-plugins.json');
const enabled = readJson(listFile, [], (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'));

fs.mkdirSync(dest, { recursive: true });
for (const f of ['manifest.json', 'main.js', 'styles.css']) fs.copyFileSync(path.join(source, f), path.join(dest, f));

data.repoPath = repo;
data.nodePath = process.execPath;
fs.writeFileSync(dataFile, `${JSON.stringify(data, null, 2)}\n`);

/* ---------- enable ---------- */
const running = obsidianRunning();
let how;
if (enabled.includes(ID)) how = running ? 'Already enabled — reload Obsidian (Ctrl/Cmd+R) to pick up the new version.' : 'Already enabled.';
else if (running) how = 'Obsidian is open: go to Settings → Community plugins and switch on "Orbital Station Publisher".';
else {
  fs.writeFileSync(listFile, `${JSON.stringify([...enabled, ID], null, 2)}\n`);
  how = 'Enabled — it loads the next time you open Obsidian.';
}

console.log(`
  ✓ Orbital Station Publisher installed
    vault:  ${vault}
    repo:   ${repo}
    node:   ${process.execPath}

    ${how}
    (If Obsidian says community plugins are restricted, turn that off in Settings → Community plugins.)

    Then open any note and press the satellite-dish icon in the left ribbon.
`);
