/* =============================================================
   SVG clean-room scrub (PRIV-04)

   SVGs authored in Inkscape/Illustrator/Sketch carry the export tool's
   fingerprints: the absolute path the file was saved from
   (sodipodi:docname, inkscape:export-filename), Dublin Core author
   metadata in an embedded <metadata><rdf:RDF>...</rdf:RDF></metadata>
   block, comments, and sometimes a <script>. We run SVGO (v4) with an
   explicit, conservative plugin list — never preset-default, which also
   rewrites geometry, ids and colours and would change how the drawing
   renders. <title> and <desc> are kept on purpose: they're how a
   screen reader describes the image, not something we scrub.

   After SVGO runs we re-scan the *output* text for anything the
   whitelist can't have been expected to catch — an absolute path or
   file:// URI baked into an attribute value (href, xlink:href, src, a
   style url(), or the text of a kept <title>/<desc>) — and refuse the
   file rather than silently drop content that might be load-bearing.

   None of the above ever looks inside a `data:` URI, so a raster
   photo (with its own EXIF/GPS) can be smuggled straight through as
   an <image href="data:image/jpeg;base64,...">. Every data: URI this
   finds — base64-encoded, percent-encoded, or raw text — is decoded,
   its actual format is sniffed from its bytes (the declared MIME
   type is attacker-controlled and untrusted), and it's routed through
   that format's own scrub()/inspect() — recursively, up to
   MAX_EMBED_DEPTH deep, for a nested SVG — before being re-encoded
   (always as base64, regardless of how it first arrived) back into
   the attribute. An embed in an unsupported or unparsable format, or
   one that can't even be decoded, blocks the whole file, the same
   fail-closed posture as everywhere else in PRIV-04.
   ============================================================= */
import { optimize } from 'svgo';
import { ScrubError } from './index.mjs';
import { scrub as jpegScrub, inspect as jpegInspect } from './jpeg.mjs';
import { scrub as pngScrub, inspect as pngInspect } from './png.mjs';
import { scrub as gifScrub, inspect as gifInspect } from './gif.mjs';
import { scrub as webpScrub, inspect as webpInspect } from './webp.mjs';

/** Raster formats a data: URI can be sniffed as and dispatched to their own scrubber. */
const RASTER_HANDLERS = {
  jpg: { scrub: jpegScrub, inspect: jpegInspect },
  png: { scrub: pngScrub, inspect: pngInspect },
  gif: { scrub: gifScrub, inspect: gifInspect },
  webp: { scrub: webpScrub, inspect: webpInspect },
};

const MIME_FOR = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

// A base64 data: URI anywhere in the markup (in an attribute value or a style url()). The MIME type
// SVGO/browsers read from it is untrustworthy, so only the base64 payload is used — its real format is
// sniffed from its decoded bytes (sniffFormat()) before it's dispatched to a handler.
const DATA_URI_SOURCE = 'data:[a-zA-Z0-9.+-]*/[a-zA-Z0-9.+-]*(?:;charset=[^;,\\s"\']+)?;base64,([A-Za-z0-9+/=]+)';

// A non-base64 data: URI (percent-encoded, or raw/literal bytes) — must be inside a quoted attribute
// value, since unlike the base64 alphabet its payload has no self-terminating character class. Written
// as two alternatives (double-quoted / single-quoted) rather than one pattern with a backreferenced
// quote, so a *raw* embed — most often another whole XML document — can freely contain the other kind
// of quote character: a double-quoted outer attribute can hold a raw payload with single quotes in it,
// and vice versa. Exactly one of group 1 (double-quoted content) / group 2 (single-quoted content) is
// set. Anything already caught by DATA_URI_SOURCE above is skipped (checked in code, not the regex).
const DATA_URI_PLAIN_DQ = 'data:[a-zA-Z0-9.+-]*/[a-zA-Z0-9.+-]*(?:;charset=[^;,\\s"\']+)?,[^"]*';
const DATA_URI_PLAIN_SQ = "data:[a-zA-Z0-9.+-]*/[a-zA-Z0-9.+-]*(?:;charset=[^;,\\s\"']+)?,[^']*";
const DATA_URI_PLAIN_SOURCE = `"(${DATA_URI_PLAIN_DQ})"|'(${DATA_URI_PLAIN_SQ})'`;

// A nested SVG can itself embed a data: URI (Inkscape/Illustrator both produce this); cap the recursion
// so a pathological or malicious chain of nested SVGs fails closed instead of hanging or overflowing the stack.
const MAX_EMBED_DEPTH = 3;

/** The actual format of decoded bytes, by magic number/signature — never trust the data: URI's own MIME type. */
function sniffFormat(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length >= 6 && (bytes.toString('latin1', 0, 6) === 'GIF87a' || bytes.toString('latin1', 0, 6) === 'GIF89a')) return 'gif';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  const head = bytes.subarray(0, 512).toString('utf8').trimStart();
  if (/^(<\?xml|<svg)/i.test(head)) return 'svg';
  return null;
}

/** The only SVGO passes we run: strip hidden metadata, keep everything that affects rendering. */
const PLUGINS = [
  'removeXMLProcInst', // <?xml ...?>
  'removeDoctype', // <!DOCTYPE ...>
  'removeMetadata', // whole <metadata> element (RDF/Dublin Core/XMP)
  'removeEditorsNSData', // sodipodi:/inkscape:/illustrator:/sketch: elements and attributes
  'removeComments', // <!-- ... -->
  'removeScripts', // <script>, on* handlers, javascript: links
];

// Attributes an editor stamps with the absolute path the file was saved/exported from.
const EDITOR_PATH_ATTR = /\s(?:sodipodi:docname|inkscape:export-filename)\s*=\s*(["'])((?:(?!\1)[\s\S])*)\1/gi;
// Any other sodipodi:/inkscape: element or attribute — a tool fingerprint, not a path.
const EDITOR_OTHER = /\s(?:sodipodi|inkscape):[\w-]+\s*=|<\/?(?:sodipodi|inkscape):[\w-]+[\s>/]/i;
const METADATA_BLOCK = /<metadata\b[^>]*>[\s\S]*?<\/metadata>|<metadata\b[^>]*\/>/gi;
const AUTHOR_TAG = /<(?:[\w.-]+:)?(?:creator|rights|publisher)\b/i; // dc:creator, dc:rights, dc:publisher
const HAS_SCRIPT = /<script\b/i;
const ON_HANDLER = /\son[a-z]+\s*=/i;
const JS_LINK = /(?:href|xlink:href)\s*=\s*["']\s*javascript:/i;
const COMMENT = /<!--[\s\S]*?-->/g;
const GENERATOR_COMMENT = /generator|exported by|created with|inkscape\.org|illustrator|sketch|figma/i;
const XMP_PACKET = /<x:xmpmeta|<\?xpacket/i;
// file:// URIs and absolute local paths (Windows user profile, macOS/Linux home) in any attribute or text.
const LOCAL_PATH = /file:\/\/|[A-Za-z]:\\(?:Users|Documents and Settings)\\|\/Users\/[^/\s"'()]+\/|\/home\/[^/\s"'()]+\//i;

/** Scan raw SVG markup for each category of hidden metadata it currently carries. [] = clean. */
function findCategories(text) {
  const found = new Set();
  if ([...text.matchAll(EDITOR_PATH_ATTR)].length) found.add('path');
  if (EDITOR_OTHER.test(text)) found.add('software');
  for (const m of text.matchAll(METADATA_BLOCK)) {
    found.add('other');
    if (AUTHOR_TAG.test(m[0])) found.add('author');
  }
  if (HAS_SCRIPT.test(text) || ON_HANDLER.test(text) || JS_LINK.test(text)) found.add('other');
  for (const m of text.matchAll(COMMENT)) found.add(GENERATOR_COMMENT.test(m[0]) ? 'software' : 'text');
  if (XMP_PACKET.test(text)) found.add('other');
  if (LOCAL_PATH.test(text)) found.add('path');
  return found;
}

/**
 * Percent-decodes `s` into the raw bytes it names, treating each %XX as an independent byte (like the
 * long-deprecated global unescape(), NOT decodeURIComponent(), which insists every %XX run form valid
 * UTF-8 and throws on raw binary such as `%FF%D8...` — exactly the kind of payload this has to handle).
 * Any character that isn't a %XX escape is re-encoded as its own UTF-8 bytes. Never throws.
 */
function percentDecodeToBytes(s) {
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '%' && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const cp = s.codePointAt(i);
      for (const b of Buffer.from(String.fromCodePoint(cp), 'utf8')) bytes.push(b);
      if (cp > 0xffff) i++; // this codepoint was a surrogate pair: skip its second half too
    }
  }
  return Buffer.from(bytes);
}

/**
 * Cleans one already-decoded embed's bytes: sniffs its real format and routes it through that format's
 * own scrub() (recursing for a nested SVG, up to MAX_EMBED_DEPTH). Never throws — an unrecognised,
 * unparsable or too-deeply-nested embed comes back as `{ ok: false, blocked }` instead, since it's
 * always the caller (with the surrounding text) that has to turn that into a ScrubError.
 */
async function cleanEmbed(bytes, ctx, depth) {
  const fmt = sniffFormat(bytes);
  if (!fmt) return { ok: false, blocked: "has an embedded image (a data: URI) in a format the clean-room step doesn't recognise" };
  if (fmt === 'svg') {
    if (depth >= MAX_EMBED_DEPTH) return { ok: false, blocked: 'has embedded SVGs nested too deep to check safely' };
    try {
      const inner = await scrubCore(bytes, { name: `${ctx.name} (embedded svg)` }, depth + 1);
      return { ok: true, dataUri: `data:${MIME_FOR.svg};base64,${inner.buffer.toString('base64')}`, removed: inner.removed };
    } catch (e) {
      return { ok: false, blocked: `has an embedded SVG that ${e.message}` };
    }
  }
  try {
    const res = await RASTER_HANDLERS[fmt].scrub(bytes, { name: `${ctx.name} (embedded ${fmt})` });
    return { ok: true, dataUri: `data:${MIME_FOR[fmt]};base64,${res.buffer.toString('base64')}`, removed: res.removed };
  } catch (e) {
    return { ok: false, blocked: `has an embedded ${fmt} image that couldn't be cleaned (${e.message})` };
  }
}

/** inspect()'s equivalent of cleanEmbed(): what categories one already-decoded embed's bytes still
 *  carry. Never throws — an unrecognisable, unparsable or too-deeply-nested embed is itself 'other'. */
async function inspectEmbed(bytes, depth) {
  const fmt = sniffFormat(bytes);
  if (!fmt) return ['other'];
  if (fmt === 'svg') {
    if (depth >= MAX_EMBED_DEPTH) return ['other'];
    try {
      const innerText = bytes.toString('utf8');
      const cats = new Set(findCategories(innerText));
      for (const c of await inspectDataUris(innerText, depth + 1)) cats.add(c);
      return [...cats];
    } catch {
      return ['other'];
    }
  }
  try {
    return await RASTER_HANDLERS[fmt].inspect(bytes, { name: `embedded.${fmt}` });
  } catch {
    return ['other'];
  }
}

/**
 * Cleans every base64 data: URI found in `text`. Returns the rewritten text plus the raw category keys
 * removed from inside those embeds — or `blocked` (a human-readable reason) when an embed is in an
 * unsupported/unparsable format or nested too deep, in which case the whole file must be blocked.
 */
async function scrubDataUris(text, ctx, depth) {
  const removed = new Set();
  let blocked = null;
  let out = '';
  let last = 0;
  const re = new RegExp(DATA_URI_SOURCE, 'g');
  let m;
  while (!blocked && (m = re.exec(text))) {
    out += text.slice(last, m.index);
    last = re.lastIndex;
    let bytes;
    try {
      bytes = Buffer.from(m[1], 'base64');
    } catch {
      bytes = Buffer.alloc(0);
    }
    const cleaned = await cleanEmbed(bytes, ctx, depth);
    if (!cleaned.ok) {
      blocked = cleaned.blocked;
      break;
    }
    for (const c of cleaned.removed) removed.add(c);
    out += cleaned.dataUri;
  }
  if (!blocked) out += text.slice(last);
  return { text: out, removed: [...removed], blocked };
}

/**
 * Cleans every non-base64 (percent-encoded or raw) data: URI found in `text`, inside a quoted attribute
 * value. Same contract as scrubDataUris(). A URI whose payload declares `;base64,` is left untouched
 * here — scrubDataUris() above already found and replaced every one of those.
 */
async function scrubPlainDataUris(text, ctx, depth) {
  const removed = new Set();
  let blocked = null;
  let out = '';
  let last = 0;
  const re = new RegExp(DATA_URI_PLAIN_SOURCE, 'g');
  let m;
  while (!blocked && (m = re.exec(text))) {
    const full = m[0];
    const quote = m[1] !== undefined ? '"' : "'";
    const uri = m[1] !== undefined ? m[1] : m[2];
    if (/;base64,/i.test(uri)) continue; // already handled above; leave this one exactly as it is
    out += text.slice(last, m.index) + quote;
    last = m.index + full.length - 1; // the index of the closing quote itself, carried over by the next slice
    const bytes = percentDecodeToBytes(uri.slice(uri.indexOf(',') + 1));
    const cleaned = await cleanEmbed(bytes, ctx, depth);
    if (!cleaned.ok) {
      blocked = cleaned.blocked;
      break;
    }
    for (const c of cleaned.removed) removed.add(c);
    out += cleaned.dataUri;
  }
  if (!blocked) out += text.slice(last);
  return { text: out, removed: [...removed], blocked };
}

/** Categories still present in every data: URI (base64, percent-encoded or raw) found in `text`,
 *  checked recursively. Never throws. */
async function inspectDataUris(text, depth) {
  const cats = new Set();
  const re = new RegExp(DATA_URI_SOURCE, 'g');
  let m;
  while ((m = re.exec(text))) {
    let bytes;
    try {
      bytes = Buffer.from(m[1], 'base64');
    } catch {
      bytes = Buffer.alloc(0);
    }
    for (const c of await inspectEmbed(bytes, depth)) cats.add(c);
  }
  const plainRe = new RegExp(DATA_URI_PLAIN_SOURCE, 'g');
  let pm;
  while ((pm = plainRe.exec(text))) {
    const uri = pm[1] !== undefined ? pm[1] : pm[2];
    if (/;base64,/i.test(uri)) continue;
    const bytes = percentDecodeToBytes(uri.slice(uri.indexOf(',') + 1));
    for (const c of await inspectEmbed(bytes, depth)) cats.add(c);
  }
  return [...cats];
}

/** Clean one SVG. Throws ScrubError if it can't be parsed, still links to a local file afterwards, or
 *  has an embedded image PRIV-04 can't vouch for. */
export async function scrub(buf, ctx) {
  return scrubCore(buf, ctx, 0);
}

async function scrubCore(buf, ctx, depth) {
  const before = buf.toString('utf8');
  const removed = findCategories(before);

  const embeds = await scrubDataUris(before, ctx, depth);
  if (embeds.blocked) {
    throw new ScrubError(`"${ctx.name}" ${embeds.blocked}.`);
  }
  for (const c of embeds.removed) removed.add(c);

  const plainEmbeds = await scrubPlainDataUris(embeds.text, ctx, depth);
  if (plainEmbeds.blocked) {
    throw new ScrubError(`"${ctx.name}" ${plainEmbeds.blocked}.`);
  }
  for (const c of plainEmbeds.removed) removed.add(c);

  let result;
  try {
    result = optimize(plainEmbeds.text, { path: ctx.name, plugins: PLUGINS });
  } catch (e) {
    throw new ScrubError(`"${ctx.name}" isn't a valid SVG the clean-room step can parse (${e.message}).`);
  }

  if (LOCAL_PATH.test(result.data)) {
    throw new ScrubError(
      `"${ctx.name}" still links to a file on your computer after cleaning (a path or file:// URL in an ` +
        `href, style or title/desc). Replace the link with the embedded image or a relative path, then publish again.`,
    );
  }

  return { buffer: Buffer.from(result.data, 'utf8'), removed: [...removed] };
}

/** What metadata an SVG (scrubbed or not) still carries. [] means clean. */
export async function inspect(buf, ctx) {
  let text;
  try {
    text = buf.toString('utf8');
  } catch (e) {
    throw new ScrubError(`"${ctx.name}" isn't readable as text (${e.message}).`);
  }
  const found = findCategories(text);
  for (const c of await inspectDataUris(text, 0)) found.add(c);
  return [...found];
}
