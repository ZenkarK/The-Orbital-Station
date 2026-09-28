// @ts-check
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { satteri } from '@astrojs/markdown-satteri';
import { mathPlugin, calloutPlugin, createBasePathPlugin } from './src/lib/markdown-plugins.mjs';
import { nearCapacityIntegration } from './src/lib/near-capacity-integration.mjs';
import { buildLastmodIndex } from './src/lib/sitemap-lastmod.mjs';

/** LIVE-02: the custom domain, once public/CNAME exists (the owner commits it after buying one). */
function cnameHost() {
  const file = new URL('./public/CNAME', import.meta.url);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').trim() || null;
}

/*
 * SITE_URL  — the public origin, e.g. https://zenkar.dev. Used for canonical
 *             URLs, RSS and the sitemap. The GitHub Pages workflow sets it for
 *             you (switching to the custom domain automatically once one is set
 *             under Settings → Pages); Netlify, Vercel and Cloudflare Pages are
 *             detected below; public/CNAME (committed once a domain is bought —
 *             see README §1) is the next fallback, same as the publisher's
 *             siteUrlFor (scripts/obsidian/site.mjs).
 * BASE_PATH — only needed when the site lives in a sub-folder, e.g. a GitHub
 *             Pages project site at https://<user>.github.io/<repo>/. Empty (or
 *             '/') once a custom domain serves the site from its root.
 */
const env = process.env;
const cname = cnameHost();
const SITE_URL =
  env.SITE_URL ||
  (env.NETLIFY && env.URL) ||
  (env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
  env.CF_PAGES_URL ||
  (cname && `https://${cname}`) ||
  'http://localhost:4321';
const BASE_PATH = env.BASE_PATH || '/';
/* Drafts always show in `npm run dev`. Set SHOW_DRAFTS=true to include them in a build preview. */
const SHOW_DRAFTS = process.env.SHOW_DRAFTS === 'true';

/* LIVE-08 — src/redirects.json is { "/old/": "/new/" }, paths without the base (see
   scripts/obsidian/redirects.mjs, which the publisher uses to keep it up to date). Astro
   resolves a redirect's *source* against the base itself (like every other route), but a
   destination that isn't one of Astro's own static routes — every content page here, since
   they're all generated from a `[...slug]` route — is used as the Location header verbatim,
   with no base added. So the base is added here, once, for every destination. */
/** @param {string} basePath */
function loadRedirects(basePath) {
  const file = new URL('./src/redirects.json', import.meta.url);
  if (!fs.existsSync(file)) return {};
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const prefix = basePath === '/' ? '' : basePath.replace(/\/$/, '');
  return Object.fromEntries(Object.entries(raw).map(([from, to]) => [from, `${prefix}${to}`]));
}

/* GROW-03 — sitemap lastmod, computed once from the content files (see src/lib/sitemap-lastmod.mjs
   for the rules and why this can't just call getCollection() here). showDrafts mirrors this same
   build's SHOW_DRAFTS so a draft preview build's own lastmod agrees with what it actually renders. */
const lastmodIndex = buildLastmodIndex(fileURLToPath(new URL('./src', import.meta.url)), { showDrafts: SHOW_DRAFTS });

export default defineConfig({
  site: SITE_URL,
  base: BASE_PATH,
  trailingSlash: 'ignore',
  compressHTML: true,
  redirects: loadRedirects(BASE_PATH),
  integrations: [
    mdx(),
    sitemap({
      filter: (page) => !page.includes('/search/'),
      serialize(item) {
        const u = new URL(item.url);
        const baseNoSlash = BASE_PATH === '/' ? '' : BASE_PATH.replace(/\/$/, '');
        const p = baseNoSlash && u.pathname.startsWith(baseNoSlash) ? u.pathname.slice(baseNoSlash.length) || '/' : u.pathname;
        const lastmod = lastmodIndex.get(p);
        return lastmod ? { ...item, lastmod } : item;
      },
    }),
    nearCapacityIntegration(),
  ],
  markdown: {
    // Obsidian-compatible: $math$ / $$math$$ (KaTeX) and > [!note] callouts.
    processor: satteri({
      features: { math: true },
      mdastPlugins: [mathPlugin, calloutPlugin, createBasePathPlugin(BASE_PATH)],
    }),
    shikiConfig: {
      theme: 'css-variables',
      wrap: false,
    },
  },
  prefetch: {
    prefetchAll: false,
    defaultStrategy: 'hover',
  },
  vite: {
    define: {
      __SHOW_DRAFTS__: JSON.stringify(SHOW_DRAFTS),
    },
  },
});
