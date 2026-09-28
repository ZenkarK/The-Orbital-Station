/* =============================================================
   WebP scrubber (PRIV-04)

   Walks the RIFF chunk list and rebuilds the file from a whitelist:
   the image bitstream (VP8 /VP8L), the extended-features header
   (VP8X), alpha and animation chunks, and an embedded ICC profile —
   always kept (colour management must not change) but with its
   free-text tags blanked in place (see icc.mjs), since a display or
   editor's colour profile is often stamped with the device or
   computer name. EXIF and XMP chunks are dropped (EXIF classified
   the same way as JPEG/PNG, by walking its TIFF IFDs); any other
   chunk is dropped as unrecognised. When an EXIF or XMP chunk is
   dropped, the matching flag bit in a kept VP8X header is cleared,
   so a reader doesn't go looking for metadata that's no longer
   there (the ICC flag is left set: the profile is still there).
   Bytes beyond the RIFF size the file declares for itself are
   trailing data and are cut, along with each chunk's own padding
   byte carried over as-is.
   ============================================================= */
import { ScrubError } from './index.mjs';
import { classifyExifTiff } from './jpeg.mjs';
import { neutralizeIccProfile } from './icc.mjs';

/** Chunk FourCCs copied verbatim, content permitting: the bitstream, extended header, alpha and
 *  animation. ICCP is handled separately below (see neutralizeIccProfile), always kept but neutralised. */
const KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF']);

// VP8X flags byte (first byte of its 10-byte payload): Rsv Rsv ICC Alpha Exif XMP Anim Rsv.
const FLAG_EXIF = 0x08;
const FLAG_XMP = 0x04;

/** One RIFF chunk: fourCC + little-endian length + data + a padding byte if the data length is odd. */
function buildRiffChunk(fourCC, data) {
  const header = Buffer.alloc(8);
  header.write(fourCC, 0, 'latin1');
  header.writeUInt32LE(data.length, 4);
  const pad = data.length % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0);
  return Buffer.concat([header, data, pad]);
}

const fail = (name, why) => new ScrubError(`"${name}" couldn't be read as a WebP (${why}).`);

/**
 * @param {Buffer} buf
 * @param {{ name: string }} ctx
 * @returns {Promise<{ buffer: Buffer, removed: string[] }>}
 */
export async function scrub(buf, ctx) {
  const { chunks, containerEnd } = parse(buf, ctx);
  const removed = [];
  let droppedExif = false;
  let droppedXmp = false;
  const keptChunks = [];
  let vp8xIndex = -1;

  for (const c of chunks) {
    if (c.fourCC === 'ICCP') {
      const { buffer: neutralized, hadPersonalText } = neutralizeIccProfile(c.data, ctx);
      keptChunks.push(buildRiffChunk('ICCP', neutralized));
      if (hadPersonalText) removed.push('device');
      continue;
    }
    if (KEEP.has(c.fourCC)) {
      if (c.fourCC === 'VP8X') vp8xIndex = keptChunks.length;
      keptChunks.push(Buffer.from(c.full)); // copy: the VP8X flags byte may be patched below
      continue;
    }
    removed.push(...classify(c));
    if (c.fourCC === 'EXIF') droppedExif = true;
    if (c.fourCC === 'XMP ') droppedXmp = true;
  }

  if (vp8xIndex >= 0 && (droppedExif || droppedXmp)) {
    const vp8x = keptChunks[vp8xIndex];
    if (vp8x.length > 8) {
      if (droppedExif) vp8x[8] &= ~FLAG_EXIF;
      if (droppedXmp) vp8x[8] &= ~FLAG_XMP;
    }
  }
  if (containerEnd < buf.length) removed.push('trailing');

  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...keptChunks]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length, 4);
  return { buffer: Buffer.concat([header, body]), removed };
}

/** Categories still present: any dropped chunk found, whether or not it's on the whitelist. */
export async function inspect(buf, ctx) {
  const { chunks, containerEnd } = parse(buf, ctx);
  const cats = new Set();
  for (const c of chunks) {
    if (c.fourCC === 'ICCP') { if (neutralizeIccProfile(c.data, ctx).hadPersonalText) cats.add('device'); continue; }
    if (KEEP.has(c.fourCC)) continue;
    for (const cat of classify(c)) cats.add(cat);
  }
  if (containerEnd < buf.length) cats.add('trailing');
  return [...cats];
}

/** A dropped chunk's categories. */
function classify(c) {
  if (c.fourCC === 'EXIF') {
    // The container spec has the chunk hold raw TIFF, but real encoders (including sharp/libwebp)
    // commonly write it with the same "Exif\0\0" prefix JPEG uses. Strip it if present.
    const tiff = c.data.toString('latin1', 0, 6) === 'Exif\0\0' ? c.data.subarray(6) : c.data;
    try { return classifyExifTiff(tiff).categories; } catch { return ['other']; }
  }
  if (c.fourCC === 'XMP ') return ['other'];
  return ['other'];
}

/** Parses the RIFF/WEBP framing. Returns the chunk list and the offset the file's own size field declares as its end. */
function parse(buf, ctx) {
  if (buf.length < 12) throw fail(ctx.name, 'too short to hold a RIFF/WEBP header');
  if (buf.toString('latin1', 0, 4) !== 'RIFF') throw fail(ctx.name, 'missing RIFF header');
  if (buf.toString('latin1', 8, 12) !== 'WEBP') throw fail(ctx.name, 'missing WEBP signature');
  const declaredSize = buf.readUInt32LE(4);
  const containerEnd = 8 + declaredSize;
  if (containerEnd < 12) throw fail(ctx.name, 'RIFF size too small to hold the WEBP signature');
  if (containerEnd > buf.length) throw fail(ctx.name, 'RIFF size runs past the end of the file');

  const chunks = [];
  let p = 12;
  while (p < containerEnd) {
    if (p + 8 > containerEnd) throw fail(ctx.name, 'truncated chunk header');
    const fourCC = buf.toString('latin1', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    const dataStart = p + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > containerEnd) throw fail(ctx.name, `"${fourCC}" chunk runs past the end of the file`);
    const hasPad = size % 2 === 1 && dataEnd < containerEnd; // the format pads odd-sized chunks to keep the next one aligned
    const chunkEnd = dataEnd + (hasPad ? 1 : 0);
    chunks.push({ fourCC, data: buf.subarray(dataStart, dataEnd), full: buf.subarray(p, chunkEnd) });
    p = chunkEnd;
  }
  return { chunks, containerEnd };
}
