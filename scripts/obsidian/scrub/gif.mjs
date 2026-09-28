/* =============================================================
   GIF scrubber (PRIV-04)

   Walks the block stream (header, logical screen descriptor and its
   colour table, then extensions and image blocks up to the trailer)
   and rebuilds the file keeping only blocks that affect how the
   image looks or animates: the screen descriptor and colour tables,
   image descriptors with their LZW data, graphic control extensions,
   and the two application extensions that carry a loop count
   (NETSCAPE2.0, ANIMEXTS1.0) or an embedded ICC profile (ICCRGBG1).
   Comment extensions, Plain Text extensions (real decoders never
   render this block — only the image data and GCE-driven timing
   ever show — so its free-text sub-blocks are dropped the same way
   a comment is) and every other application extension (including an
   XMP "DataXMP" block) are dropped. Bytes after the 0x3B trailer are
   truncated.

   An ICCRGBG1 extension's sub-blocks are the raw ICC profile itself;
   it's always kept (colour management must not change) but its
   free-text tags are blanked in place (see icc.mjs), reassembled from
   and re-split back into the same sub-block boundaries, the same way
   jpeg.mjs/png.mjs/webp.mjs neutralise their own embedded profiles.
   ============================================================= */
import { ScrubError } from './index.mjs';
import { neutralizeIccProfile } from './icc.mjs';

const TRAILER = 0x3b;
const EXTENSION = 0x21;
const IMAGE_DESCRIPTOR = 0x2c;
const LABEL_GRAPHIC_CONTROL = 0xf9;
const LABEL_COMMENT = 0xfe;
const LABEL_PLAIN_TEXT = 0x01;
const LABEL_APPLICATION = 0xff;

/** Application-extension identifier+auth-code strings that carry display-affecting data, not metadata. */
const KEEP_APP = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0']);

const fail = (name, why) => new ScrubError(`"${name}" couldn't be read as a GIF (${why}).`);

/**
 * @param {Buffer} buf
 * @param {{ name: string }} ctx
 * @returns {Promise<{ buffer: Buffer, removed: string[] }>}
 */
export async function scrub(buf, ctx) {
  const kept = [];
  const removed = [];
  let trailerEnd;
  for (const block of walk(buf, ctx)) {
    if (block.kind === 'trailer') { kept.push(block.full); trailerEnd = block.end; break; }
    // A block can be both kept AND report a category now (a neutralised-but-kept ICC profile), so these
    // are no longer mutually exclusive branches: push whatever categories it reports either way.
    removed.push(...block.categories);
    if (block.keep) kept.push(block.full);
  }
  if (trailerEnd < buf.length) removed.push('trailing');
  return { buffer: Buffer.concat(kept), removed };
}

/** Categories still present: any dropped block found, or any category a kept block itself reports
 *  (a kept-but-neutralised ICC profile that still named something non-standard). */
export async function inspect(buf, ctx) {
  const cats = new Set();
  let trailerEnd;
  for (const block of walk(buf, ctx)) {
    if (block.kind === 'trailer') { trailerEnd = block.end; break; }
    for (const c of block.categories) cats.add(c);
  }
  if (trailerEnd < buf.length) cats.add('trailing');
  return [...cats];
}

/** Yields { kind, keep, categories, full, end? } for each top-level block. Throws ScrubError on a malformed stream. */
function* walk(buf, ctx) {
  if (buf.length < 13) throw fail(ctx.name, 'too short to hold a header and logical screen descriptor');
  const sig = buf.toString('latin1', 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw fail(ctx.name, 'missing GIF signature');

  const packed = buf[10];
  const gctSize = (packed & 0x80) ? 3 * 2 ** ((packed & 0x07) + 1) : 0;
  let p = 13 + gctSize;
  if (p > buf.length) throw fail(ctx.name, 'global colour table runs past the end of the file');
  yield { kind: 'header', keep: true, categories: [], full: buf.subarray(0, p) };

  while (p < buf.length) {
    const introducer = buf[p];

    if (introducer === TRAILER) {
      yield { kind: 'trailer', keep: true, categories: [], full: buf.subarray(p, p + 1), end: p + 1 };
      return;
    }

    if (introducer === IMAGE_DESCRIPTOR) {
      if (p + 10 > buf.length) throw fail(ctx.name, 'truncated image descriptor');
      const idPacked = buf[p + 9];
      const lctSize = (idPacked & 0x80) ? 3 * 2 ** ((idPacked & 0x07) + 1) : 0;
      const dataStart = p + 10 + lctSize;
      if (dataStart >= buf.length) throw fail(ctx.name, 'truncated image data');
      const q = subBlocksEnd(buf, dataStart + 1, ctx); // +1 skips the LZW minimum code size byte
      yield { kind: 'image', keep: true, categories: [], full: buf.subarray(p, q) };
      p = q;
      continue;
    }

    if (introducer === EXTENSION) {
      if (p + 2 > buf.length) throw fail(ctx.name, 'truncated extension introducer');
      const label = buf[p + 1];

      if (label === LABEL_GRAPHIC_CONTROL) {
        if (p + 3 > buf.length) throw fail(ctx.name, 'truncated extension block size');
        const blockSize = buf[p + 2];
        if (p + 3 + blockSize > buf.length) throw fail(ctx.name, 'extension data runs past the end of the file');
        const q = subBlocksEnd(buf, p + 3 + blockSize, ctx);
        yield { kind: 'gce', keep: true, categories: [], full: buf.subarray(p, q) };
        p = q;
        continue;
      }

      if (label === LABEL_PLAIN_TEXT) {
        // Real decoders don't render this — only the image data (and GCE-driven timing) ever shows —
        // so its free-length text sub-blocks are a comment in disguise, not display-affecting data.
        if (p + 3 > buf.length) throw fail(ctx.name, 'truncated extension block size');
        const blockSize = buf[p + 2];
        if (p + 3 + blockSize > buf.length) throw fail(ctx.name, 'extension data runs past the end of the file');
        const q = subBlocksEnd(buf, p + 3 + blockSize, ctx);
        yield { kind: 'plaintext', keep: false, categories: ['text'], full: buf.subarray(p, q) };
        p = q;
        continue;
      }

      if (label === LABEL_COMMENT) {
        const q = subBlocksEnd(buf, p + 2, ctx);
        yield { kind: 'comment', keep: false, categories: ['text'], full: buf.subarray(p, q) };
        p = q;
        continue;
      }

      if (label === LABEL_APPLICATION) {
        if (p + 3 > buf.length) throw fail(ctx.name, 'truncated application extension block size');
        const blockSize = buf[p + 2];
        if (p + 3 + blockSize > buf.length) throw fail(ctx.name, 'application extension data runs past the end of the file');
        const idAuth = buf.toString('latin1', p + 3, p + 3 + blockSize);

        if (idAuth.startsWith('ICCRGBG1')) {
          // This extension's sub-blocks are a raw ICC profile: reassemble them, blank its free text in
          // place, then re-split the result back into the exact same sub-block boundaries.
          const sub = readSubBlocksDetailed(buf, p + 3 + blockSize, ctx);
          const { buffer: neutralized, hadPersonalText } = neutralizeIccProfile(sub.data, ctx);
          const full = Buffer.concat([buf.subarray(p, p + 3 + blockSize), buildSubBlocks(neutralized, sub.sizes)]);
          yield { kind: 'app', keep: true, categories: hadPersonalText ? ['device'] : [], full };
          p = sub.end;
          continue;
        }

        const keep = KEEP_APP.has(idAuth);
        const categories = keep ? [] : ['other'];
        const q = subBlocksEnd(buf, p + 3 + blockSize, ctx);
        yield { kind: 'app', keep, categories, full: buf.subarray(p, q) };
        p = q;
        continue;
      }

      throw fail(ctx.name, `unrecognised extension label 0x${label.toString(16).padStart(2, '0')}`);
    }

    throw fail(ctx.name, `unrecognised block introducer 0x${introducer.toString(16).padStart(2, '0')} at offset ${p}`);
  }
  throw fail(ctx.name, 'missing trailer');
}

/** From a sub-block sequence's first size byte, returns the offset just past its 0x00 terminator. */
function subBlocksEnd(buf, offset, ctx) {
  let p = offset;
  for (;;) {
    if (p >= buf.length) throw fail(ctx.name, 'truncated sub-block sequence');
    const size = buf[p];
    p += 1 + size;
    if (p > buf.length) throw fail(ctx.name, 'sub-block runs past the end of the file');
    if (size === 0) return p;
  }
}

/** Same as subBlocksEnd(), but also concatenates and returns every sub-block's data plus the exact
 *  sequence of sub-block sizes — used only where the content itself matters (an ICCRGBG1 extension's
 *  sub-blocks are a raw ICC profile we need to reassemble and later re-split), since the much more
 *  common case (an image's LZW data) only needs the end offset. Returns { data, sizes, end }. */
function readSubBlocksDetailed(buf, offset, ctx) {
  let p = offset;
  const parts = [];
  const sizes = [];
  for (;;) {
    if (p >= buf.length) throw fail(ctx.name, 'truncated sub-block sequence');
    const size = buf[p];
    if (p + 1 + size > buf.length) throw fail(ctx.name, 'sub-block runs past the end of the file');
    if (size > 0) { parts.push(buf.subarray(p + 1, p + 1 + size)); sizes.push(size); }
    p += 1 + size;
    if (size === 0) return { data: Buffer.concat(parts), sizes, end: p };
  }
}

/** The inverse of readSubBlocksDetailed(): re-chunks `data` into sub-blocks of exactly `sizes`
 *  (the original boundaries), terminated by the usual 0x00 sub-block. */
function buildSubBlocks(data, sizes) {
  const parts = [];
  let cursor = 0;
  for (const size of sizes) {
    parts.push(Buffer.from([size]), data.subarray(cursor, cursor + size));
    cursor += size;
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}
