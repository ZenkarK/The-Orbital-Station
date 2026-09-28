/* GROW-02 — JSON Feed 1.1 (https://jsonfeed.org/version/1.1) of every transmission, the
   JSON counterpart to rss.xml.ts. Shares its item-building with rss.xml.ts and the
   per-orbit feeds through src/lib/feed.ts. */
import type { APIContext } from 'astro';
import { SITE } from '../site.config';
import { getPosts } from '../lib/content';
import { postFeedItem, jsonFeedDocument } from '../lib/feed';
import { href } from '../lib/util';

export async function GET(context: APIContext) {
  const posts = (await getPosts()).filter((p) => !p.data.draft);
  const site = context.site!;
  const doc = jsonFeedDocument({
    title: `${SITE.name} — Transmissions`,
    homePageUrl: new URL(href('/'), site).href,
    feedUrl: new URL(href('/feed.json'), site).href,
    description: SITE.description,
    items: posts.map((post) => postFeedItem(post, site)),
  });
  return new Response(JSON.stringify(doc, null, 2), {
    headers: { 'Content-Type': 'application/feed+json; charset=utf-8' },
  });
}
