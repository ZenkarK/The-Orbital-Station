/* =============================================================
   MP3 scrubber (PRIV-04)

   Everything that isn't the MPEG audio stream itself is a tag glued
   onto the front or back of the file, so cleaning means finding the
   run of tags at each end and cutting them off: ID3v2 at the start
   (several stacked tags, a footer-flagged tag, or both), then ID3v2
   appended at the end via its "3DI" footer, ID3v1 "TAG" (last 128
   bytes), enhanced "TAG+" (227 bytes, sits just before ID3v1), APEv2
   ("APETAGEX"), and Lyrics3v2 ("LYRICS200"). The remaining audio
   bytes are copied verbatim, and the result always starts at a real
   MPEG frame sync — any junk left between the last tag and the first
   frame is dropped too and counted as "other".

   Frame classification is best-effort (id3v2 frame ids only tell us
   the category, never the value) and never throws: a tag whose frame
   table doesn't parse cleanly is still dropped, just under 'other'.
   ============================================================= */
import { ScrubError } from './index.mjs';

const fail = (name, why) => new ScrubError(`"${name}" couldn't be read as an MP3 (${why}).`);

const syncsafe = (buf, off) => ((buf[off] & 0x7f) << 21) | ((buf[off + 1] & 0x7f) << 14) | ((buf[off + 2] & 0x7f) << 7) | (buf[off + 3] & 0x7f);

const ID3V2_FRAME_CATEGORY = {
  TPE1: 'author', TPE2: 'author', TCOM: 'author', TEXT: 'author',
  APIC: 'thumbnail',
  TDRC: 'time', TYER: 'time', TDAT: 'time',
  TENC: 'software', TSSE: 'software',
  COMM: 'text', TIT2: 'text', USLT: 'text',
};
// ID3v2.2's short, 3-character frame ids for the same handful of fields.
const ID3V22_FRAME_CATEGORY = {
  TP1: 'author', TP2: 'author', TCM: 'author', TXT: 'author',
  PIC: 'thumbnail',
  TYE: 'time', TDA: 'time',
  TSS: 'software',
  COM: 'text', TT2: 'text', ULT: 'text',
};

/** Best-effort frame-table scan of one ID3v2 tag's body. Never throws; an unparsable table just yields no extra detail. */
function classifyId3v2Frames(buf, bodyStart, bodyEnd, majorVersion) {
  const cats = new Set();
  try {
    let p = bodyStart;
    if (majorVersion === 2) {
      while (p + 6 <= bodyEnd) {
        const id = buf.toString('latin1', p, p + 3);
        if (id === '\0\0\0') break;
        const size = (buf[p + 3] << 16) | (buf[p + 4] << 8) | buf[p + 5];
        p += 6;
        if (size < 0 || p + size > bodyEnd) break;
        cats.add(ID3V22_FRAME_CATEGORY[id] ?? 'other');
        p += size;
      }
    } else {
      while (p + 10 <= bodyEnd) {
        const id = buf.toString('latin1', p, p + 4);
        if (id === '\0\0\0\0') break;
        const size = majorVersion >= 4 ? syncsafe(buf, p + 4) : buf.readUInt32BE(p + 4);
        p += 10;
        if (size < 0 || p + size > bodyEnd) break;
        cats.add(ID3V2_FRAME_CATEGORY[id] ?? 'other');
        p += size;
      }
    }
  } catch {
    cats.add('other');
  }
  return cats;
}

/** Consume every ID3v2 tag stacked at the start of the file. Returns the offset of the first byte after them. */
function stripLeadingTags(buf, found, ctx) {
  let p = 0;
  while (p + 10 <= buf.length && buf.toString('latin1', p, p + 3) === 'ID3') {
    const majorVersion = buf[p + 3];
    const flags = buf[p + 5];
    const size = syncsafe(buf, p + 6);
    const hasFooter = (flags & 0x10) !== 0;
    const total = 10 + size + (hasFooter ? 10 : 0);
    if (p + total > buf.length) throw fail(ctx.name, 'an ID3v2 tag runs past the end of the file');
    for (const c of classifyId3v2Frames(buf, p + 10, p + 10 + size, majorVersion)) found.add(c);
    p += total;
  }
  return p;
}

/** Consume every recognised tag stacked at the end of the file, working inward. Returns the offset just past the audio. */
function stripTrailingTags(buf, found, _ctx, limit) {
  let end = buf.length;
  let changed = true;
  while (changed) {
    changed = false;

    if (end - limit >= 15 && buf.toString('latin1', end - 9, end) === 'LYRICS200') {
      const sizeStr = buf.toString('latin1', end - 15, end - 9);
      if (/^\d{6}$/.test(sizeStr)) {
        const size = Number(sizeStr);
        const tagStart = end - 15 - size;
        if (tagStart >= limit && buf.toString('latin1', tagStart, tagStart + 11) === 'LYRICSBEGIN') {
          found.add('text');
          end = tagStart;
          changed = true;
          continue;
        }
      }
    }

    if (end - limit >= 32 && buf.toString('latin1', end - 32, end - 24) === 'APETAGEX') {
      const footer = buf.subarray(end - 32, end);
      const tagSize = footer.readUInt32LE(12);
      const hasHeader = (footer.readUInt32LE(20) & 0x80000000) !== 0;
      const tagStart = end - tagSize - (hasHeader ? 32 : 0);
      if (tagStart >= limit && tagSize >= 32) {
        found.add('other');
        end = tagStart;
        changed = true;
        continue;
      }
    }

    // ID3v2 appended at the end, marked by a "3DI" footer duplicating its header.
    if (end - limit >= 10 && buf.toString('latin1', end - 10, end - 7) === '3DI') {
      const majorVersion = buf[end - 7];
      const size = syncsafe(buf, end - 4);
      const tagStart = end - 10 - size - 10;
      if (tagStart >= limit && buf.toString('latin1', tagStart, tagStart + 3) === 'ID3') {
        for (const c of classifyId3v2Frames(buf, tagStart + 10, tagStart + 10 + size, majorVersion)) found.add(c);
        end = tagStart;
        changed = true;
        continue;
      }
    }

    if (end - limit >= 128 && buf.toString('latin1', end - 128, end - 125) === 'TAG') {
      found.add('text');
      found.add('author');
      end -= 128;
      changed = true;
      continue;
    }

    if (end - limit >= 227 && buf.toString('latin1', end - 227, end - 223) === 'TAG+') {
      found.add('text');
      end -= 227;
      changed = true;
      continue;
    }
  }
  return end;
}

function findFrameSync(buf, from, to) {
  for (let i = from; i + 1 < to; i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) return i;
  }
  return -1;
}

/** Locate the tag-free audio span and every category the stripped tags carried. Shared by scrub() and inspect(). */
function analyze(buf, ctx) {
  const found = new Set();
  const start = stripLeadingTags(buf, found, ctx);
  const end = stripTrailingTags(buf, found, ctx, start);
  if (start >= end) throw fail(ctx.name, 'no audio data is left once its tags are removed');
  const syncPos = findFrameSync(buf, start, end);
  if (syncPos < 0) throw fail(ctx.name, "doesn't start with a recognisable MPEG frame once its tags are removed");
  if (syncPos > start) found.add('other');
  return { syncPos, end, found };
}

/**
 * @param {Buffer} buf
 * @param {{ name: string }} ctx
 * @returns {Promise<{ buffer: Buffer, removed: string[] }>}
 */
export async function scrub(buf, ctx) {
  const { syncPos, end, found } = analyze(buf, ctx);
  return { buffer: Buffer.from(buf.subarray(syncPos, end)), removed: [...found] };
}

/** Categories still present in the file's tags. [] means clean. */
export async function inspect(buf, ctx) {
  const { found } = analyze(buf, ctx);
  return [...found];
}
