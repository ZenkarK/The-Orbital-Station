/* Site-repo helpers: config, projects, git, and the public URL. */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { splitFrontmatter } from './vault.mjs';

/** The branch GitHub Pages deploys from (.github/workflows/deploy.yml). */
export const DEPLOY_BRANCH = 'main';

export async function loadSiteConfig(repo) {
  const file = path.join(repo, 'src', 'site.config.ts');
  if (!fs.existsSync(file)) throw new Error(`No src/site.config.ts in ${repo} — is "repo" the Orbital Station folder?`);
  return import(pathToFileURL(file).href);
}

/**
 * Segment-normalized form of a vault path or a configured folder name, for matching:
 * forward slashes, each path segment trimmed of stray whitespace, lowercased. The trim
 * matters because Windows folder names can end in a space (a sync client, a mobile
 * Obsidian client, or a stray keystroke while renaming can all produce one) and
 * fs.readdirSync — the same API the publisher itself walks the vault with — hands it
 * back exactly as-is, so "Health" and "Health " are the same folder for our purposes
 * even though a plain string compare would treat them as unrelated.
 */
function normalizePath(value) {
  return String(value)
    .replaceAll('\\', '/')
    .split('/')
    .map((seg) => seg.trim())
    .join('/')
    .toLowerCase();
}

/**
 * The orbit a vault note belongs to by where it lives: the orbit whose `folders`
 * holds the note's deepest enclosing folder (whole folder names, any letter case,
 * stray leading/trailing whitespace on a segment ignored), or null when no orbit
 * claims it.
 */
export function orbitForNote(notePath, orbits) {
  const dir = normalizePath(notePath);
  let best = null;
  let depth = 0;
  for (const o of orbits) {
    for (const folder of o.folders ?? []) {
      const f = normalizePath(folder).replace(/^\/+|\/+$/g, '');
      if (f && dir.startsWith(`${f}/`) && f.length > depth) (best = o.id), (depth = f.length);
    }
  }
  return best;
}

/**
 * The sensitive folder (from site.config.ts SENSITIVE_FOLDERS) a vault path lives
 * inside — the whole folder, subfolders included, matched case-insensitively and with
 * stray leading/trailing whitespace on a segment ignored — or null when nothing there
 * claims it. Returns the folder name as written in SENSITIVE_FOLDERS (original case),
 * for author-facing messages.
 */
export function sensitiveFolderFor(notePath, folders) {
  const p = normalizePath(notePath);
  for (const folder of folders ?? []) {
    const f = normalizePath(folder).replace(/^\/+|\/+$/g, '');
    if (f && p.startsWith(`${f}/`)) return folder;
  }
  return null;
}

/** Flight Log missions available to file posts under. */
export function listProjects(repo) {
  const dir = path.join(repo, 'src', 'content', 'projects');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_')) continue;
    let file = null;
    let id = null;
    if (e.isFile() && /\.mdx?$/i.test(e.name)) {
      file = path.join(dir, e.name);
      id = e.name.replace(/\.mdx?$/i, '').toLowerCase();
    } else if (e.isDirectory()) {
      const idx = ['index.md', 'index.mdx'].map((f) => path.join(dir, e.name, f)).find((f) => fs.existsSync(f));
      if (idx) (file = idx), (id = e.name.toLowerCase());
    }
    if (!file) continue;
    try {
      const { data } = splitFrontmatter(fs.readFileSync(file, 'utf8'));
      out.push({ id, title: String(data.title ?? id) });
    } catch {
      out.push({ id, title: id });
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/* ---------- git ---------- */

/** Run git without a shell (arguments are never interpreted), never prompting on a terminal. */
export function git(repo, args, { allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd: repo,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'auto' },
      },
      (err, stdout, stderr) => {
        const res = { code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) };
        if (err && err.code === 'ENOENT') return reject(new Error('Git is not installed or not on PATH.'));
        if (err && !allowFail) {
          const e = new Error(`git ${args[0]} failed: ${(res.stderr || res.stdout).trim() || err.message}`);
          e.result = res;
          return reject(e);
        }
        resolve(res);
      },
    );
  });
}

export async function isGitRepo(repo) {
  const r = await git(repo, ['rev-parse', '--is-inside-work-tree'], { allowFail: true }).catch(() => null);
  return !!r && r.code === 0 && r.stdout.trim() === 'true';
}

export async function remoteUrl(repo) {
  const r = await git(repo, ['remote', 'get-url', 'origin'], { allowFail: true }).catch(() => null);
  return r && r.code === 0 ? r.stdout.trim() : null;
}

export async function currentBranch(repo) {
  const r = await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true }).catch(() => null);
  return r && r.code === 0 ? r.stdout.trim() : null; // "HEAD" when detached
}

const list = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);

/** Subjects of the commits publish.mjs makes. */
export const PUBLISHER_COMMIT = /^(Publish|Update|Move|Unpublish): /;

/** Does the branch on GitHub still contain a page published from the note with this source id? */
export async function upstreamHasSource(repo, id) {
  const upstream = await git(repo, ['rev-parse', '--verify', '--quiet', '@{u}'], { allowFail: true });
  if (upstream.code !== 0) return false;
  const found = await git(repo, ['grep', '-l', '-F', `# source-id: ${id}`, '@{u}', '--', 'src/content'], { allowFail: true });
  return found.code === 0 && !!found.stdout.trim();
}

/**
 * Stage and commit exactly `paths` (other work in the repo is left alone),
 * then push — also pushing earlier publishes that never made it online.
 * Push problems are reported, not thrown, because the commit itself succeeded.
 *
 * Result: { committed, commit?, pushed, upToDate?, remote, branch, note?, error? }
 * "Online" means: remote && (pushed || upToDate) && branch === DEPLOY_BRANCH.
 */
export async function commitAndPush(repo, paths, message, { push = true } = {}) {
  const branch = await currentBranch(repo);
  const remote = await remoteUrl(repo);
  const base = { branch, remote: !!remote };

  const rels = [];
  for (const p of paths) {
    const rel = path.relative(repo, p).replaceAll('\\', '/');
    if (!rel || rel.startsWith('..')) continue;
    const tracked = (await git(repo, ['ls-files', '--', rel], { allowFail: true })).stdout.trim();
    if (fs.existsSync(p) || tracked) rels.push(rel);
  }
  let committed = false;
  let commit;
  if (rels.length) {
    await git(repo, ['add', '-A', '--', ...rels]);
    const diff = await git(repo, ['diff', '--cached', '--quiet', '--', ...rels], { allowFail: true });
    if (diff.code !== 0) {
      await git(repo, ['commit', '-m', message, '--', ...rels]);
      commit = (await git(repo, ['rev-parse', '--short', 'HEAD'])).stdout.trim();
      committed = true;
    }
  }
  const done = { ...base, committed, ...(commit ? { commit } : {}) };

  if (!push) return { ...done, pushed: false, note: committed ? 'Committed locally (push is off).' : 'No changes to commit.' };
  if (!remote) {
    return {
      ...done,
      pushed: false,
      note: `${committed ? 'Committed locally' : 'Nothing new to commit'}. Connect a GitHub remote to put it online (README §1 "Going live").`,
    };
  }

  const upstream = await git(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { allowFail: true });
  if (upstream.code === 0) {
    const ahead = Number((await git(repo, ['rev-list', '--count', '@{u}..HEAD'], { allowFail: true })).stdout.trim() || '0');
    if (!ahead) {
      return { ...done, pushed: false, upToDate: true, note: committed ? 'Committed.' : 'No changes since the last publish — already online.' };
    }
    // A push sends every waiting commit. Only send the publisher's own: work you committed
    // yourself (a half-done redesign, say) must never go live as a side effect of a note.
    const waiting = list((await git(repo, ['log', '--format=%s', '@{u}..HEAD'])).stdout);
    const foreign = waiting.filter((s) => !PUBLISHER_COMMIT.test(s));
    if (foreign.length) {
      return {
        ...done,
        pushed: false,
        error: `The site folder has other commits that aren't online yet ("${foreign[0]}"${foreign.length > 1 ? ` and ${foreign.length - 1} more` : ''}). Push them yourself when they're ready, then publish again — the publisher only pushes its own changes.`,
      };
    }
  }
  const pushArgs = upstream.code === 0 ? ['push'] : ['push', '-u', 'origin', branch];

  let res = await git(repo, pushArgs, { allowFail: true });
  if (res.code !== 0 && /non-fast-forward|fetch first|rejected/i.test(res.stderr)) {
    // Someone (another machine, the GitHub web editor) pushed first. Replaying on top is only
    // safe when the repo holds no other uncommitted work — never stash or rebase over it.
    // porcelain lines are "XY path" — the leading status columns may be spaces, so don't trim them
    const dirty = (await git(repo, ['status', '--porcelain', '--untracked-files=no'])).stdout
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => l.slice(3));
    if (dirty.length) {
      return {
        ...done,
        pushed: false,
        error: `GitHub has newer changes, and the site folder has uncommitted edits (${dirty.join(', ')}). Commit or discard them, then publish again.`,
      };
    }
    const pull = await git(repo, ['pull', '--rebase', 'origin', branch], { allowFail: true });
    if (pull.code !== 0) {
      const conflicts = list((await git(repo, ['diff', '--name-only', '--diff-filter=U'], { allowFail: true })).stdout);
      await git(repo, ['rebase', '--abort'], { allowFail: true });
      return {
        ...done,
        pushed: false,
        error: conflicts.length
          ? `GitHub has changes that conflict with this publish (${conflicts.join(', ')}). In the site folder run "git pull", resolve the conflict, then publish again.`
          : `Couldn't sync with GitHub: ${(pull.stderr || pull.stdout).trim().split('\n').pop()}`,
      };
    }
    res = await git(repo, pushArgs, { allowFail: true });
  }
  if (res.code !== 0) return { ...done, pushed: false, error: `Push failed: ${(res.stderr || res.stdout).trim()}` };
  return {
    ...done,
    pushed: true,
    note:
      branch === DEPLOY_BRANCH
        ? 'Pushed — the site rebuilds in about a minute.'
        : `Pushed to branch "${branch}" — the site only deploys from ${DEPLOY_BRANCH}.`,
  };
}

/* ---------- public URL ---------- */

/** Normalise a user-entered site address; throws on anything that isn't a web address. */
export function normalizeSiteUrl(value) {
  if (!value) return null;
  let s = String(value).trim().replace(/^["']|["']$/g, '');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s); // throws TypeError on garbage
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) throw new TypeError('not a web address');
  return u.href.endsWith('/') ? u.href : `${u.href}/`;
}

/**
 * Best guess at where the site lives: a CNAME file, else the GitHub Pages
 * address implied by the "origin" remote. The Obsidian plugin lets you override it.
 */
export function siteUrlFor(repo, remote) {
  const cname = path.join(repo, 'public', 'CNAME');
  if (fs.existsSync(cname)) {
    const host = fs.readFileSync(cname, 'utf8').trim();
    if (host) return `https://${host}/`;
  }
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(remote ?? '');
  if (!m) return null;
  const [, user, repoName] = m;
  const u = user.toLowerCase();
  return repoName.toLowerCase() === `${u}.github.io` ? `https://${u}.github.io/` : `https://${u}.github.io/${repoName}/`;
}
