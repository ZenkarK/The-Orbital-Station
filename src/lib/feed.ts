/* GROW-02 — one place decides what a post looks like as a feed entry, so the site-wide
   RSS (rss.xml.ts), the per-orbit RSS (orbits/[orbit]/rss.xml.ts) and the JSON Feed
   (feed.json.ts) never disagree with each other. */
import { SITE, POST_KINDS } from '../site.config';
import type { Post } from './content';
import { orbitById } from './orbits';
import { href } from './util';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface FeedItem {
  id: string;
  url: string;
  title: string;
  summary: string;
  /** Full-text HTML for a .md post; undefined for MDX (falls back to the summary). */
  contentHtml?: string;
  datePublished: Date;
  dateModified: Date;
  tags: string[];
  author: string;
}

/** A post as a feed item, with every internal link/asset made absolute against `site`. */
export function postFeedItem(post: Post, site: URL): FeedItem {
  const url = new URL(href(`/transmissions/${post.id}/`), site).href;
  // Root-relative links already carry the base path, so they only need the origin.
  const html = post.rendered?.html?.replace(/(href|src)="\/(?!\/)/g, `$1="${site.origin}/`).trim();
  return {
    id: url,
    url,
    title: post.data.title,
    summary: post.data.summary,
    contentHtml: html
      ? `<p><em>${esc(post.data.summary)}</em></p>${html}<p><a href="${url}">Read on ${esc(SITE.name)} →</a></p>`
      : undefined,
    datePublished: post.data.date,
    dateModified: post.data.updated ?? post.data.date,
    tags: [orbitById(post.data.orbit).name, POST_KINDS[post.data.kind], ...post.data.tags],
    author: SITE.author,
  };
}

/** An RSS `<item>`, in the shape @astrojs/rss expects. */
export function toRssItem(item: FeedItem) {
  return {
    title: item.title,
    link: item.url,
    pubDate: item.datePublished,
    description: item.summary,
    content: item.contentHtml,
    categories: item.tags,
    author: item.author,
  };
}

/** A JSON Feed 1.1 item (https://jsonfeed.org/version/1.1). */
export function toJsonFeedItem(item: FeedItem) {
  return {
    id: item.id,
    url: item.url,
    title: item.title,
    ...(item.contentHtml ? { content_html: item.contentHtml } : { summary: item.summary }),
    date_published: item.datePublished.toISOString(),
    date_modified: item.dateModified.toISOString(),
    tags: item.tags,
    authors: [{ name: item.author }],
  };
}

/** A whole JSON Feed 1.1 document for a list of posts. */
export function jsonFeedDocument(opts: {
  title: string;
  homePageUrl: string;
  feedUrl: string;
  description?: string;
  items: FeedItem[];
}) {
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: opts.title,
    home_page_url: opts.homePageUrl,
    feed_url: opts.feedUrl,
    ...(opts.description ? { description: opts.description } : {}),
    items: opts.items.map(toJsonFeedItem),
  };
}
