/* =============================================================
   FLAC scrubber (PRIV-04)

   A leading ID3v2 tag (some non-compliant encoders prepend one) is
   stripped first. After the "fLaC" marker, metadata blocks are kept
   only if they're STREAMINFO or SEEKTABLE — both copied verbatim,
   lossless by construction. VORBIS_COMMENT is dropped (classified
   field by field: ARTIST/PERFORMER → author, DATE → time, ENCODER
   and the vendor string → software, TITLE/COMMENT/DESCRIPTION →
   text), PICTURE is dropped as a thumbnail, and APPLICATION/CUESHEET/
   anything else is dropped as other. The audio frame stream after
   the last metadata block is copied byte-for-byte, and the
   last-metadata-block flag is set on whichever kept block ends up
   last (STREAMINFO is always first and always kept, so there's
   always at least one).
   ============================================================= */
import { ScrubError } from './index.mjs';

const fail = (name, why) => new ScrubError(`"${name}" couldn't be read as a FLAC file (${why}).`);

const syncsafe = (buf, off) => ((buf[off] & 0x7f) << 21) | ((buf[off + 1] & 0x7f) << 14) | ((buf[off + 2] & 0x7f) << 7) | (buf[off + 3] & 0x7f);

const STREAMINFO = 0;
const SEEKTABLE = 3;
const VORBIS_COMMENT = 4;
const PICTURE = 6;

/** Best-effort field-by-field read of a VORBIS_COMMENT block. Never throws; a malformed block just yields 'other'. */
function classifyVorbisComment(data) {
  const cats = new Set(['software']); // the vendor string is always present, and is itself software info
  try {
    let p = 0;
    const vendorLen = data.readUInt32LE(p);
    p += 4 + vendorLen;
    const count = data.readUInt32LE(p);
    p += 4;
    for (let i = 0; i < count; i++) {
      const len = data.readUInt32LE(p);
      p += 4;
      const field = data.toString('utf8', p, p + len);
      p += len;
      const name = (field.includes('=') ? field.slice(0, field.indexOf('=')) : field).toUpperCase();
      if (name === 'ARTIST' || name === 'PERFORMER') cats.add('author');
      else if (name === 'DATE') cats.add('time');
      else if (name === 'ENCODER') cats.add('software');
      else if (name === 'TITLE' || name === 'COMMENT' || name === 'DESCRIPTION') cats.add('text');
      else cats.add('other');
    }
  } catch {
    cats.add('other');
  }
  return [...cats];
}

function stripLeadingId3(buf, ctx) {
  let p = 0;
  while (p + 10 <= buf.length && buf.toString('latin1', p, p + 3) === 'ID3') {
    const flags = buf[p + 5];
    const size = syncsafe(buf, p + 6);
    const total = 10 + size + ((flags & 0x10) !== 0 ? 10 : 0);
    if (p + total > buf.length) throw fail(ctx.name, 'a leading ID3v2 tag runs past the end of the file');
    p += total;
  }
  return p;
}

/** Walk metadata blocks after "fLaC". Throws ScrubError on a malformed stream. */
function readBlocks(buf, start, ctx) {
  const blocks = [];
  let p = start;
  let sawLast = false;
  while (p + 4 <= buf.length) {
    const header = buf[p];
    const isLast = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const len = buf.readUIntBE(p + 1, 3);
    const dataStart = p + 4;
    const dataEnd = dataStart + len;
    if (dataEnd > buf.length) throw fail(ctx.name, 'a metadata block runs past the end of the file');
    blocks.push({ type, data: buf.subarray(dataStart, dataEnd) });
    p = dataEnd;
    if (isLast) { sawLast = true; break; }
  }
  if (!sawLast) throw fail(ctx.name, 'no block is marked as the last metadata block');
  return { blocks, audioStart: p };
}

/** Locate "fLaC" and its metadata blocks. Shared by scrub() and inspect(). */
function analyze(buf, ctx) {
  const start = stripLeadingId3(buf, ctx);
  if (buf.toString('latin1', start, start + 4) !== 'fLaC') throw fail(ctx.name, 'missing the "fLaC" marker');
  const { blocks, audioStart } = readBlocks(buf, start + 4, ctx);
  if (!blocks.length || blocks[0].type !== STREAMINFO) throw fail(ctx.name, 'missing its STREAMINFO block');
  return { blocks, audioStart };
}

function classifyBlock(block, cats) {
  if (block.type === STREAMINFO || block.type === SEEKTABLE) return;
  if (block.type === VORBIS_COMMENT) { for (const c of classifyVorbisComment(block.data)) cats.add(c); return; }
  if (block.type === PICTURE) { cats.add('thumbnail'); return; }
  cats.add('other');
}

/**
 * @param {Buffer} buf
 * @param {{ name: string }} ctx
 * @returns {Promise<{ buffer: Buffer, removed: string[] }>}
 */
export async function scrub(buf, ctx) {
  const { blocks, audioStart } = analyze(buf, ctx);
  const removed = new Set();
  const kept = [];
  for (const b of blocks) {
    if (b.type === STREAMINFO || b.type === SEEKTABLE) { kept.push(b); continue; }
    classifyBlock(b, removed);
  }
  const parts = [Buffer.from('fLaC', 'latin1')];
  kept.forEach((b, i) => {
    const header = Buffer.alloc(4);
    header[0] = (i === kept.length - 1 ? 0x80 : 0) | (b.type & 0x7f);
    header.writeUIntBE(b.data.length, 1, 3);
    parts.push(header, b.data);
  });
  parts.push(buf.subarray(audioStart));
  return { buffer: Buffer.concat(parts), removed: [...removed] };
}

/** Categories still present in its metadata blocks. [] means clean. */
export async function inspect(buf, ctx) {
  const { blocks } = analyze(buf, ctx);
  const found = new Set();
  for (const b of blocks) classifyBlock(b, found);
  return [...found];
}
