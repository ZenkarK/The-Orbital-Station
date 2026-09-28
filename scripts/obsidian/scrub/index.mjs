/* =============================================================
   Clean-room attachments (PRIV-04)

   Every file the publisher copies out of the vault passes through
   scrub() first. Known formats are rewritten without their hidden
   metadata (location, names, device details, capture times, edit
   history, file paths, thumbnails, data trailing the real file) and
   the result is checked again; anything that can't be shown to be
   clean is blocked. Text files pass through untouched — the secret
   scan covers them.

   Handler modules (one per format family, registered below) export:
     scrub(buf, ctx)   → Promise<{ buffer, removed: CategoryKey[] }>
                         throws ScrubError when the file can't be parsed
                         or cleaned (the file is then blocked)
     inspect(buf, ctx) → Promise<CategoryKey[]>   what is still in there;
                         [] means clean
   ctx = { ext, name, tools: { exiftool, ffmpeg } } — tools are paths to
   the optional external programs, or null when not installed.
   ============================================================= */
import { spawnSync } from 'node:child_process';

/** What can hide in a file, in the words the dry run shows. Never the values themselves. */
export const CATEGORIES = {
  location: 'location (GPS)',
  author: 'author and owner names',
  device: 'camera and device details',
  time: 'capture and edit times',
  software: 'software and edit history',
  text: 'embedded titles, comments and descriptions',
  path: 'file paths from your computer',
  thumbnail: 'embedded thumbnails and previews',
  trailing: 'data hidden after the end of the file',
  other: 'other embedded metadata',
};

/** Thrown by handlers when a file can't be parsed or cleaned. The message is shown to the author. */
export class ScrubError extends Error {}

const jpeg = () => import('./jpeg.mjs');
const png = () => import('./png.mjs');
const isobmff = () => import('./isobmff.mjs');
const reencode = () => import('./sharp.mjs');
const external = () => import('./external.mjs');

/** extension → handler module, loaded on first use. */
const HANDLERS = {
  jpg: jpeg,
  jpeg: jpeg,
  png: png,
  apng: png,
  gif: () => import('./gif.mjs'),
  webp: () => import('./webp.mjs'),
  svg: () => import('./svg.mjs'),
  pdf: () => import('./pdf.mjs'),
  avif: reencode,
  tif: reencode,
  tiff: reencode,
  mp4: isobmff,
  m4v: isobmff,
  mov: isobmff,
  m4a: isobmff,
  mp3: () => import('./mp3.mjs'),
  wav: () => import('./wav.mjs'),
  flac: () => import('./flac.mjs'),
  // No built-in scrubber: cleaned by exiftool / ffmpeg when installed, blocked otherwise.
  heic: external,
  heif: external,
  webm: external,
  ogv: external,
  ogg: external,
  opus: external,
  aac: external,
};

/** Plain-text formats: nothing hidden beyond what the secret scan reads. */
const TEXT_EXT = new Set([
  'txt', 'csv', 'tsv', 'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'log', 'tex', 'bib',
  'js', 'mjs', 'cjs', 'ts', 'py', 'r', 'jl', 'm', 'c', 'h', 'cpp', 'hpp', 'rs', 'go', 'java', 'sh', 'ps1', 'sql', 'css', 'html', 'htm',
]);

export const handledExtensions = () => Object.keys(HANDLERS);
/** A text-family extension only earns the 'text' pass-through when the bytes actually look like text —
 *  otherwise a binary renamed to, say, .txt would skip scrubbing (and the CI media scan) entirely. */
export const isText = (ext, buf) => (TEXT_EXT.has(ext) || !HANDLERS[ext]) && looksLikeText(buf);

/** Valid UTF-8 with no NUL bytes in the first 64 KB. */
function looksLikeText(buf) {
  const head = buf.subarray(0, 65536);
  if (head.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head.length < buf.length ? trimPartialUtf8(head) : head);
    return true;
  } catch {
    return false;
  }
}
/** Drop a multi-byte character cut in half at the end of a slice. */
function trimPartialUtf8(b) {
  let i = b.length - 1;
  let n = 0;
  while (i >= 0 && n < 4 && (b[i] & 0xc0) === 0x80) i--, n++;
  if (i < 0) return b;
  const lead = b[i];
  const need = lead >= 0xf0 ? 3 : lead >= 0xe0 ? 2 : lead >= 0xc0 ? 1 : 0;
  return need > n ? b.subarray(0, i) : b;
}

let toolCache;
/** Paths of the optional external scrubbers, or null when not installed. */
export function findTools() {
  if (toolCache) return toolCache;
  const probe = (cmd, args) => {
    const r = spawnSync(cmd, args, { windowsHide: true, timeout: 10000, encoding: 'utf8' });
    return !r.error && r.status === 0 ? cmd : null;
  };
  toolCache = { exiftool: probe('exiftool', ['-ver']), ffmpeg: probe('ffmpeg', ['-version']) };
  return toolCache;
}

/**
 * Tell-tale metadata that must never survive in any binary, whatever its format:
 * XMP packets, ISO 6709 locations (QuickTime, XMP), Apple location keys and home-folder paths.
 */
const RESIDUE = [
  ['other', /<x:xmpmeta|<\?xpacket|http:\/\/ns\.adobe\.com\/xap\//],
  ['location', /[+-]\d{2}\.\d{3,}[+-]\d{3}\.\d{3,}|com\.apple\.quicktime\.location/],
  ['path', /[A-Za-z]:\\(?:Users|Documents and Settings)\\|\/Users\/[^/\s]+\/|\/home\/[^/\s]+\//],
];
export function residue(buf, ext) {
  const s = buf.toString('latin1');
  // SVG path data ("M-12.3456-123.4567") looks like an ISO 6709 location; its XMP and paths still count.
  return RESIDUE.filter(([k, re]) => !(ext === 'svg' && k === 'location') && re.test(s)).map(([k]) => k);
}

const labels = (keys) => [...new Set(keys)].map((k) => CATEGORIES[k] ?? CATEGORIES.other);
/** A file's extension, lowercased, from either kind of path separator — the one place this is defined;
 *  scan-media.mjs imports it rather than keeping its own copy. */
export const extOf = (name) => (/\.([^./\\]+)$/.exec(String(name))?.[1] ?? '').toLowerCase();

/**
 * Clean one file for publishing.
 *   → { ok: true, buffer, kind: 'scrubbed' | 'clean' | 'text', removed: string[] }   (removed = category labels)
 *   → { ok: false, reason }                                                            (blocked)
 * With allowMetadata, a file that would be blocked is passed through unchanged:
 *   → { ok: true, buffer: <original>, kind: 'unscrubbed', removed: [], reason }
 * Never throws for bad input.
 */
export async function scrub(buf, { name, ext = extOf(name), allowMetadata = false, tools = findTools() } = {}) {
  ext = String(ext).toLowerCase().replace(/^\./, '');
  const blocked = (reason) =>
    allowMetadata ? { ok: true, buffer: buf, kind: 'unscrubbed', removed: [], reason } : { ok: false, reason };
  if (isText(ext, buf)) return { ok: true, buffer: buf, kind: 'text', removed: [] };
  const load = HANDLERS[ext];
  if (!load) {
    return blocked(`"${name}" is a .${ext || '(no extension)'} file, which the clean-room step can't check for hidden metadata.`);
  }
  const ctx = { ext, name, tools };
  try {
    const handler = await load();
    const { buffer, removed } = await handler.scrub(buf, ctx);
    const left = [...(await handler.inspect(buffer, ctx)), ...residue(buffer, ext)];
    if (left.length) return blocked(`"${name}" still carries ${labels(left).join(', ')} after cleaning.`);
    return { ok: true, buffer, kind: removed.length ? 'scrubbed' : 'clean', removed: labels(removed) };
  } catch (e) {
    if (e instanceof ScrubError) return blocked(e.message);
    return blocked(`"${name}" couldn't be read as a .${ext} file (${e.message}).`);
  }
}

/**
 * What metadata a file carries right now, without changing it (used by the CI media scan).
 *   → { ok: true, kind, categories: string[] }   categories = labels; [] means clean
 *   → { ok: false, reason }                      unsupported type or unreadable
 */
export async function inspect(buf, { name, ext = extOf(name), tools = findTools() } = {}) {
  ext = String(ext).toLowerCase().replace(/^\./, '');
  if (isText(ext, buf)) return { ok: true, kind: 'text', categories: [] };
  const load = HANDLERS[ext];
  if (!load) return { ok: false, reason: `unsupported binary type .${ext || '(none)'}` };
  try {
    const handler = await load();
    const found = [...(await handler.inspect(buf, { ext, name, tools })), ...residue(buf, ext)];
    return { ok: true, kind: 'binary', categories: labels(found) };
  } catch (e) {
    return { ok: false, reason: e instanceof ScrubError ? e.message : `unreadable: ${e.message}` };
  }
}
