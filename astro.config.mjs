// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { satteri } from '@astrojs/markdown-satteri';
import { mathPlugin, calloutPlugin, createBasePathPlugin } from './src/lib/markdown-plugins.mjs';
import { nearCapacityIntegration } from './src/lib/near-capacity-integration.mjs';

/*
 * SITE_URL  — the public origin, e.g. https://zenkar.dev. Used for canonical
 *             URLs, RSS and the sitemap. The GitHub Pages workflow sets it for
 *             you; Netlify, Vercel and Cloudflare Pages are detected below. Set
 *             it explicitly (env var or here) once you have a custom domain.
 * BASE_PATH — only needed when the site lives in a sub-folder, e.g. a GitHub
 *             Pages project site at https://<user>.github.io/<repo>/.
 */
const env = process.env;
const SITE_URL =
  env.SITE_URL ||
  (env.NETLIFY && env.URL) ||
  (env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
  env.CF_PAGES_URL ||
  'http://localhost:4321';
const BASE_PATH = env.BASE_PATH || '/';
/* Drafts always show in `npm run dev`. Set SHOW_DRAFTS=true to include them in a build preview. */
const SHOW_DRAFTS = process.env.SHOW_DRAFTS === 'true';

export default defineConfig({
  site: SITE_URL,
  base: BASE_PATH,
  trailingSlash: 'ignore',
  compressHTML: true,
  integrations: [
    mdx(),
    sitemap({
      filter: (page) => !page.includes('/search/'),
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
