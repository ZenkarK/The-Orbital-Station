/* GROW-02 — one feed per *public* orbit. A phase-only/hidden orbit's posts are already
   dropped by src/lib/content.ts (isListed), so there's nothing to feed and no page here
   for it — getStaticPaths only ever names a public orbit. */
import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { ORBITS, SITE } from '../../../site.config';
import { getPosts } from '../../../lib/content';
import { orbitById } from '../../../lib/orbits';
import { isListed } from '../../../lib/visibility';
import { postFeedItem, toRssItem } from '../../../lib/feed';
import { href } from '../../../lib/util';

export function getStaticPaths() {
  return ORBITS.filter((o) => isListed(o.id)).map((o) => ({ params: { orbit: o.id } }));
}

export async function GET(context: APIContext) {
  const { orbit } = context.params as { orbit: string };
  const o = orbitById(orbit);
  const posts = (await getPosts()).filter((p) => !p.data.draft && p.data.orbit === orbit);
  const site = context.site!;
  return rss({
    title: `${SITE.name} — ${o.name}`,
    description: o.desc,
    site: new URL(href('/'), site).href,
    trailingSlash: true,
    items: posts.map((post) => toRssItem(postFeedItem(post, site))),
    customData: `<language>${SITE.locale.toLowerCase()}</language><generator>Astro</generator>`,
  });
}
