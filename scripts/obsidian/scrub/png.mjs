/* =============================================================
   PNG / APNG scrubber (PRIV-04)

   Walks the chunk stream and rebuilds the file from a whitelist of
   chunks that affect how the image looks or animates. Each kept
   chunk (including its CRC) is copied byte-for-byte, so nothing is
   recompressed and decoding is unaffected. Text chunks, the EXIF
   chunk, edit time, C2PA/digital-signature chunks and any other
   ancillary chunk are dropped; bytes after IEND are truncated. An
   unrecognised *critical* chunk (one this scrubber can't vouch for
   but also can't safely drop) blocks the file.

   iCCP (an embedded ICC profile) is handled separately from the rest
   of the whitelist: it's always kept — colour management must not
   change — but its decompressed profile's free-text tags are blanked
   in place (see icc.mjs) before being recompressed back into a fresh
   chunk, and its own cleartext profile-name field is replaced with a
   neutral placeholder, since both are routinely stamped with a
   device or computer name.
   ============================================================= */
import zlib from 'node:zlib';
import { ScrubError } from './index.mjs';
import { classifyExifTiff } from './jpeg.mjs';
import { neutralizeIccProfile, STANDARD_NAMES } from './icc.mjs';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Chunks copied verbatim: the image itself, animation (APNG) and the display-affecting ancillary chunks.
 *  iCCP is handled separately (see isStandardPngIcc), not kept unconditionally by being in this set. */
const KEEP = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND',
  'tRNS', 'cHRM', 'gAMA', 'sBIT', 'sRGB', 'cICP', 'mDCv', 'cLLi', 'bKGD', 'pHYs', 'hIST',
  'acTL', 'fcTL', 'fdAT',
]);

/** A fresh chunk: length + type + data + a real CRC32 over type+data. */
function buildChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Neutralises an iCCP chunk's data (cleartext profile name + NUL + compression method + deflated
 * profile) into a fresh chunk with the free text blanked and the name replaced with a neutral
 * placeholder, and reports whether the original name or profile text named anything non-standard.
 * @returns {{ chunk: Buffer, hadPersonalText: boolean }}
 */
function neutralizePngIcc(data, ctx) {
  const nul = data.indexOf(0);
  if (nul < 0 || nul > 79) throw fail(ctx.name, 'its iCCP chunk has a malformed profile-name field');
  if (data[nul + 1] !== 0) throw fail(ctx.name, 'its iCCP chunk uses an unsupported compression method');
  const originalName = data.toString('latin1', 0, nul).trim();
  let icc;
  try {
    icc = zlib.inflateSync(data.subarray(nul + 2));
  } catch (e) {
    throw fail(ctx.name, `its iCCP chunk's profile couldn't be decompressed (${e.message})`);
  }
  const { buffer: neutralized, hadPersonalText } = neutralizeIccProfile(icc, ctx);
  const nameWasStandard = STANDARD_NAMES.has(originalName.toLowerCase());
  const newData = Buffer.concat([Buffer.from('ICC profile', 'latin1'), Buffer.from([0, 0]), zlib.deflateSync(neutralized)]);
  return { chunk: buildChunk('iCCP', newData), hadPersonalText: hadPersonalText || !nameWasStandard };
}

const fail = (name, why) => new ScrubError(`"${name}" couldn't be read as a PNG (${why}).`);

/**
 * @param {Buffer} buf
 * @param {{ name: string }} ctx
 * @returns {Promise<{ buffer: Buffer, removed: string[] }>}
 */
export async function scrub(buf, ctx) {
  const kept = [SIGNATURE];
  const removed = [];
  let iendEnd;
  for (const chunk of walk(buf, ctx)) {
    if (chunk.type === 'IEND') { kept.push(chunk.full); iendEnd = chunk.end; break; }
    if (chunk.type === 'iCCP') {
      const { chunk: newChunk, hadPersonalText } = neutralizePngIcc(chunk.data, ctx);
      kept.push(newChunk);
      if (hadPersonalText) removed.push('device');
      continue;
    }
    if (KEEP.has(chunk.type)) { kept.push(chunk.full); continue; }
    removed.push(...classifyChunk(chunk));
  }
  if (iendEnd < buf.length) removed.push('trailing');
  return { buffer: Buffer.concat(kept), removed };
}

/** Categories still present: any dropped chunk type found, whether or not it's on the whitelist. */
export async function inspect(buf, ctx) {
  const cats = new Set();
  let iendEnd;
  for (const chunk of walk(buf, ctx)) {
    if (chunk.type === 'IEND') { iendEnd = chunk.end; break; }
    if (chunk.type === 'iCCP') {
      if (neutralizePngIcc(chunk.data, ctx).hadPersonalText) cats.add('device');
      continue;
    }
    if (KEEP.has(chunk.type)) continue;
    for (const c of classifyChunk(chunk)) cats.add(c);
  }
  if (iendEnd < buf.length) cats.add('trailing');
  return [...cats];
}

/** Yields { type, data, full, end } for each chunk in order. Throws ScrubError on a malformed stream or an unrecognised critical chunk. */
function* walk(buf, ctx) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw fail(ctx.name, 'missing PNG signature');
  let p = 8;
  let sawIend = false;
  while (p < buf.length) {
    if (p + 8 > buf.length) throw fail(ctx.name, 'truncated chunk header');
    const length = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw fail(ctx.name, `invalid chunk type at offset ${p}`);
    const end = p + 8 + length + 4;
    if (length < 0 || end > buf.length) throw fail(ctx.name, `"${type}" chunk runs past the end of the file`);
    const data = buf.subarray(p + 8, p + 8 + length);
    const full = buf.subarray(p, end);
    const critical = (type.charCodeAt(0) & 0x20) === 0;
    if (critical && !KEEP.has(type)) throw fail(ctx.name, `unrecognised critical chunk "${type}"`);
    yield { type, data, full, end };
    if (type === 'IEND') { sawIend = true; break; }
    p = end;
  }
  if (!sawIend) throw fail(ctx.name, 'missing IEND chunk');
}

/** A dropped chunk's categories. */
function classifyChunk(chunk) {
  switch (chunk.type) {
    case 'tEXt': case 'zTXt': case 'iTXt':
      return [classifyTextKeyword(keywordOf(chunk.data))];
    case 'eXIf':
      try { return classifyExifTiff(chunk.data).categories; } catch { return ['other']; }
    case 'tIME':
      return ['time'];
    case 'caBX': case 'dSIG':
      return ['other'];
    default:
      return ['other'];
  }
}

/** The null-terminated keyword at the start of a tEXt/zTXt/iTXt chunk's data (cleartext even when the rest is compressed). */
function keywordOf(data) {
  const nul = data.indexOf(0);
  return nul < 0 ? '' : data.toString('latin1', 0, nul);
}

function classifyTextKeyword(keyword) {
  switch (keyword) {
    case 'Author': return 'author';
    case 'Software': return 'software';
    case 'Creation Time': return 'time';
    case 'Title': case 'Description': case 'Comment': return 'text';
    default: return 'other'; // includes XML:com.adobe.xmp and anything unrecognised
  }
}
