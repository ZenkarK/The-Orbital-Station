/* LIVE-03 — public channels. Turns SITE.channels into the links the footer and
   the Observer show: blank channels are left out, and a malformed one stops the
   build rather than shipping a broken link. No imports on purpose: the Node test
   runner loads this file directly. */

export interface ChannelLink {
  key: string;
  label: string;
  url: string;
  /** rel="me": the profile is the author's own (Mastodon & co. verify it). */
  me: boolean;
}

const LABELS: Record<string, string> = {
  email: 'EMAIL',
  github: 'GITHUB',
  linkedin: 'LINKEDIN',
  mastodon: 'MASTODON',
  bluesky: 'BLUESKY',
  x: 'X',
};

/* A plain address only: no display name, and nothing that could smuggle a mailto: query (?, &). */
const EMAIL = /^[^\s@<>()[\]\\,;:"?&/#]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/** Filled channels, in SITE.channels order. Throws on a value that isn't a usable address. */
export function channelLinks(channels: Record<string, string>): ChannelLink[] {
  const links: ChannelLink[] = [];
  for (const [key, raw] of Object.entries(channels)) {
    const value = raw.trim();
    if (!value) continue;
    const label = LABELS[key] ?? key.toUpperCase();
    if (key === 'email') {
      if (!EMAIL.test(value)) throw new Error(`SITE.channels.email "${value}" isn't an email address.`);
      links.push({ key, label, url: `mailto:${value}`, me: false });
      continue;
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`SITE.channels.${key} "${value}" isn't a web address — it should start with https://`);
    }
    if (url.protocol !== 'https:') throw new Error(`SITE.channels.${key} "${value}" should start with https://`);
    links.push({ key, label, url: url.href, me: true });
  }
  return links;
}
