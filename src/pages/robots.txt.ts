import type { APIContext } from 'astro';
import { href } from '../lib/util';

export function GET({ site }: APIContext) {
  const sitemap = new URL(href('/sitemap-index.xml'), site).href;
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
