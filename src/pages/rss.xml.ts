import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE } from '../site.config';
import { getPosts } from '../lib/content';
import { postFeedItem, toRssItem } from '../lib/feed';
import { href } from '../lib/util';

export async function GET(context: APIContext) {
  const posts = (await getPosts()).filter((p) => !p.data.draft);
  const site = context.site!;
  return rss({
    title: `${SITE.name} — Transmissions`,
    description: SITE.description,
    site: new URL(href('/'), site).href,
    trailingSlash: true,
    items: posts.map((post) => toRssItem(postFeedItem(post, site))),
    customData: `<language>${SITE.locale.toLowerCase()}</language><generator>Astro</generator>`,
  });
}
