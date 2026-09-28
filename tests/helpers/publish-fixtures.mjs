/* =============================================================
   Shared scaffolding for publisher tests: a throwaway vault + site
   repo + bare remote, wired the same way tests/obsidian/publish.test.mjs
   sets one up. Used by publish.test.mjs and tests/obsidian/gates.test.mjs
   so the two files stay in sync without copy-pasting the setup.

   Never touches the real vault ("C:\Zenkar's Vault") or the real site
   repo — everything happens under a fresh os.tmpdir() folder that the
   caller removes with fs.rmSync(tmp, { recursive: true, force: true }).
   ============================================================= */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const VAULT_FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'vault');

/** Run git without a shell, trimmed. */
export const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/**
 * Build a fresh { tmp, repo, remote, vault } — a copy of the vault fixture, a site repo with
 * src/site.config.ts (the real one, or `siteConfig` text/buffer in its place), a Flight Log
 * mission (helios.md) so listProjects() has something, and a bare "origin" remote already
 * pushed to. Returns note()/writeNote() helpers scoped to the new vault.
 * @param {{ vaultFixture?: string, siteConfig?: string|Buffer }} [opts]
 */
export function setupTestRepo({ vaultFixture = VAULT_FIXTURE, siteConfig } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-gate-'));
  const repo = path.join(tmp, 'site');
  const remote = path.join(tmp, 'remote.git');
  const vault = path.join(tmp, "Zenkar's Vault"); // apostrophe + space, like the real one
  fs.cpSync(vaultFixture, vault, { recursive: true });

  fs.mkdirSync(path.join(repo, 'src', 'content', 'posts'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src', 'content', 'projects'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'site.config.ts'), siteConfig ?? fs.readFileSync(path.join(ROOT, 'src', 'site.config.ts')));
  fs.copyFileSync(path.join(ROOT, 'src', 'content', 'projects', 'helios.md'), path.join(repo, 'src', 'content', 'projects', 'helios.md'));

  g(tmp, 'init', '--bare', '-b', 'main', remote);
  g(repo, 'init', '-b', 'main');
  g(repo, 'config', 'user.name', 'Test');
  g(repo, 'config', 'user.email', 'test@example.com');
  g(repo, 'config', 'commit.gpgsign', 'false');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-m', 'init');
  g(repo, 'remote', 'add', 'origin', remote);
  g(repo, 'push', '-u', 'origin', 'main');

  const note = (rel) => path.join(vault, rel);
  const writeNote = (rel, text) => {
    fs.mkdirSync(path.dirname(note(rel)), { recursive: true });
    fs.writeFileSync(note(rel), text);
  };
  const page = (p) => fs.readFileSync(path.join(repo, 'src/content', p, 'index.md'), 'utf8');
  const exists = (p) => fs.existsSync(path.join(repo, p));

  return { tmp, repo, remote, vault, note, writeNote, page, exists };
}

/** Change one orbit's `visibility` in a copy of the real site.config.ts's text — for tests that
 *  need a `hidden` orbit without hand-maintaining a whole second config. Matches the orbit's own
 *  `visibility` field (the first one after its `id: '<id>',`), never another orbit's. */
export function withOrbitVisibility(orbitId, visibility, configText = fs.readFileSync(path.join(ROOT, 'src', 'site.config.ts'), 'utf8')) {
  const re = new RegExp(`(id: '${orbitId}',[\\s\\S]*?visibility: )'[a-z-]+'`);
  if (!re.test(configText)) throw new Error(`No orbit "${orbitId}" found in site.config.ts to patch.`);
  return configText.replace(re, `$1'${visibility}'`);
}
