/* GROW-03 — JSON-LD builders shared by every page that needs structured data. Keeping the
   schema.org shapes in one place means posts, projects, orbit pages, the Observer and the
   Bridge all agree on the same fields instead of hand-rolling their own — and a later
   /professional/ page can reuse personLd() rather than copying it. Base.astro renders
   whatever these return through its `jsonLd` prop (see src/layouts/Base.astro). */
import { SITE } from '../site.config';
import { href } from './util';

type JsonLd = Record<string, unknown>;

const abs = (path: string, site: URL): string => new URL(href(path), site).href;

/**
 * The Person behind the station. `sameAs` only lists the channels actually filled in
 * (site.config.ts leaves the rest blank), minus email and the RSS link, which aren't
 * profile URLs. Reused on the Bridge, the Observer, and later /professional/.
 */
export function personLd(site: URL, opts: { description?: string; jobTitle?: string } = {}): JsonLd {
  const sameAs = Object.entries(SITE.channels)
    .filter(([key, value]) => key !== 'email' && value)
    .map(([, value]) => value);
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: SITE.author,
    url: abs('/observer/', site),
    ...(opts.jobTitle ? { jobTitle: opts.jobTitle } : {}),
    ...(opts.description ? { description: opts.description } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

export interface BlogPostingInput {
  title: string;
  summary: string;
  date: Date;
  updated?: Date;
  /** Root-relative page path, e.g. `/transmissions/relativistic-jets/`. */
  path: string;
  tags: string[];
}

/**
 * A post as schema.org BlogPosting. `image` is deliberately left out — Base.astro fills it
 * in from whatever `image` prop the page already passed it (falling back to og.png), so
 * there's exactly one place that decides the social-card image.
 */
export function blogPostingLd(post: BlogPostingInput, site: URL): JsonLd {
  const url = abs(post.path, site);
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.summary,
    datePublished: post.date.toISOString(),
    dateModified: (post.updated ?? post.date).toISOString(),
    author: { '@type': 'Person', name: SITE.author, url: abs('/observer/', site) },
    publisher: { '@type': 'Person', name: SITE.author },
    mainEntityOfPage: url,
    keywords: post.tags.join(', '),
  };
}

export interface Crumb {
  name: string;
  /** Root-relative path, e.g. `/transmissions/`. */
  path: string;
}

/** A schema.org BreadcrumbList from Home down to the current page. */
export function breadcrumbLd(crumbs: Crumb[], site: URL): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: abs(c.path, site),
    })),
  };
}
