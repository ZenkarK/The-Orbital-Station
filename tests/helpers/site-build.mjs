/* Shared helpers for tests that need a real build of the site.

     const site = buildSiteCopy({ edit: (tmp) => { ...plant fixtures... }, env: { BASE_PATH: '/sub/' } });
     try { ...read site.dist... } finally { site.cleanup(); }

   The copy lives under os.tmpdir() with its own Astro/Vite caches, so any
   number of these builds (and the working tree's own `npm run build`) can
   run side by side. `serveDir` is a tiny static server for browser tests. */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const ROOT = path.resolve(import.meta.dirname, '../..');

/** Copies what a build needs into `tmp`; node_modules is linked, not copied. */
export function copySite(tmp) {
  fs.mkdirSync(tmp, { recursive: true });
  fs.cpSync(path.join(ROOT, 'src'), path.join(tmp, 'src'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'public'), path.join(tmp, 'public'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'astro.config.mjs'), path.join(tmp, 'astro.config.mjs'));
  fs.cpSync(path.join(ROOT, 'tsconfig.json'), path.join(tmp, 'tsconfig.json'));
  fs.cpSync(path.join(ROOT, 'package.json'), path.join(tmp, 'package.json'));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), process.platform === 'win32' ? 'junction' : undefined);
}

/** Gives the copy its own Astro/Vite caches so it never touches node_modules/.astro or .vite,
    which the linked node_modules shares with every other build in this working tree. */
export function isolateCaches(tmp) {
  const configPath = path.join(tmp, 'astro.config.mjs');
  const text = fs.readFileSync(configPath, 'utf8');
  const astroCache = JSON.stringify(path.join(tmp, '.astro-cache').replace(/\\/g, '/'));
  const viteCache = JSON.stringify(path.join(tmp, '.vite-cache').replace(/\\/g, '/'));
  let out = text.replace(/export default defineConfig\(\{\n/, (m) => `${m}  cacheDir: ${astroCache},\n`);
  if (out === text) throw new Error('astro.config.mjs has no `export default defineConfig({` — update tests/helpers/site-build.mjs');
  const before = out;
  out = out.replace(/\n  vite: \{\n/, (m) => `${m}    cacheDir: ${viteCache},\n`);
  if (out === before) throw new Error('astro.config.mjs has no top-level `vite: {` block — update tests/helpers/site-build.mjs');
  fs.writeFileSync(configPath, out);
}

/**
 * Builds a throwaway copy of the site. `edit(tmp)` runs after the copy and before the
 * build (plant content, flip config). `env` is merged over process.env; SITE_URL defaults
 * to https://example.test. Returns { tmp, dist, cleanup }.
 */
export function buildSiteCopy({ edit, env = {}, prefix = 'orbital-site-', timeout = 280000 } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  try {
    copySite(tmp);
    isolateCaches(tmp);
    edit?.(tmp);
    execFileSync(process.execPath, [path.join(tmp, 'node_modules/astro/bin/astro.mjs'), 'build'], {
      cwd: tmp,
      stdio: 'pipe',
      timeout,
      env: { ...process.env, SITE_URL: 'https://example.test', ...env },
    });
  } catch (e) {
    cleanup();
    if (e.stderr?.length || e.stdout?.length) e.message += `\n${e.stdout ?? ''}\n${e.stderr ?? ''}`;
    throw e;
  }
  return { tmp, dist: path.join(tmp, 'dist'), cleanup };
}

/** Every file under `dir`, as forward-slash paths relative to it. */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else out.push(path.relative(dir, p).replace(/\\/g, '/'));
    }
  };
  walk(dir);
  return out;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Serves `dir` at `base` (e.g. '/' or '/The-Orbital-Station/') on a free localhost port,
 * the way GitHub Pages would: directories serve index.html, misses serve 404.html with a 404.
 * Resolves to { origin, url(path), requests: string[], close() } — `requests` logs every
 * request path + query the server saw (fragments never reach a server).
 */
export function serveDir(dir, base = '/') {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const u = new URL(req.url, 'http://localhost');
    let p = decodeURIComponent(u.pathname);
    if (!p.startsWith(base)) {
      res.writeHead(404).end();
      return;
    }
    p = p.slice(base.length - 1);
    let file = path.join(dir, p);
    if (!file.startsWith(dir)) {
      res.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    let status = 200;
    if (!fs.existsSync(file)) {
      status = 404;
      file = path.join(dir, '404.html');
    }
    res.writeHead(status, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      resolve({
        origin,
        url: (p = '/') => origin + base.replace(/\/$/, '') + (p.startsWith('/') ? p : `/${p}`),
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/** Path to a Chrome/Chromium for browser tests, or null (tests should then skip). */
export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}
