/** Prefix an internal path with the configured base (needed for sub-folder hosting). */
export function href(path = '/'): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}` || '/';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Station date format — 2026.07.20 (UTC, so builds are timezone-stable). */
export const stationDate = (d: Date): string =>
  `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;

/** Long form for humans — 20 July 2026. */
export const longDate = (d: Date): string =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

export const two = (n: number): string => String(n).padStart(2, '0');

/** Words ÷ 230 wpm, minimum one minute. Code blocks count too — they take time to read. */
export function readingMinutes(body = ''): number {
  const text = body
    .replace(/^---[\s\S]*?---/, '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]/g, ' ');
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

/** First real paragraph of a Markdown body, as plain text, trimmed to ~`max` characters. */
export function excerpt(body = '', max = 180): string {
  const para =
    body
      .replace(/```[\s\S]*?```/g, '')
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .find((b) => b && !/^(#|>|!\[|[-*+] |\d+\. |\||<|import |export )/.test(b)) ?? '';
  const text = para
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
