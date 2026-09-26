import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE, POST_KINDS } from '../site.config';
import { getPosts } from '../lib/content';
import { orbitById } from '../lib/orbits';
import { href } from '../lib/util';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function GET(context: APIContext) {
  const posts = (await getPosts()).filter((p) => !p.data.draft);
  const site = context.site!;
  const abs = (path: string) => new URL(href(path), site).href;

  return rss({
    title: `${SITE.name} — Transmissions`,
    description: SITE.description,
    site: abs('/'),
    trailingSlash: true,
    items: posts.map((post) => {
      const link = abs(`/transmissions/${post.id}/`);
      // Full text for .md posts; MDX posts fall back to the summary.
      const html = post.rendered?.html
        ?.replace(/(href|src)="\/(?!\/)/g, `$1="${new URL(href('/'), site).href}`)
        .trim();
      return {
        title: post.data.title,
        link,
        pubDate: post.data.date,
        description: post.data.summary,
        content: html
          ? `<p><em>${esc(post.data.summary)}</em></p>${html}<p><a href="${link}">Read on ${esc(SITE.name)} →</a></p>`
          : undefined,
        categories: [orbitById(post.data.orbit).name, POST_KINDS[post.data.kind], ...post.data.tags],
        author: SITE.author,
      };
    }),
    customData: `<language>${SITE.locale.toLowerCase()}</language><generator>Astro</generator>`,
  });
}
