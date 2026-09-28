/* =============================================================
   ISO-BMFF scrubber (PRIV-04): mp4, m4v, mov, m4a

   Box sizes and offsets are never touched — stco/co64 chunk offsets
   inside moov point straight into mdat, so this file is scrubbed in
   place rather than rebuilt: a metadata box we drop keeps its exact
   byte length, just with its type renamed to "free" and its payload
   zero-filled, and a timestamp field is zeroed in place inside its
   fixed-size box. The file is never resized, so nothing downstream
   of any change ever needs to move.

   Stripped wholesale, wherever they occur (moov, any trak, or top
   level): udta (©xyz/©day/©mak/©mod/©too/©ART/covr/Xtra/...), meta
   (Apple "keys" + ilst metadata, and iTunes ilst in m4a), and any
   uuid box (XMP, PROF, vendor extensions) or top-level "XMP_" box.
   creation_time/modification_time are zeroed in mvhd/tkhd/mdhd
   (version 0 and 1 both). mdat is never parsed, only skipped over
   by its declared size.

   Classification of what a stripped box held is best-effort (it
   only affects the human-readable "removed" list, never whether the
   file is safe): a mix of matching known box types and scanning the
   stripped bytes for telltale substrings, since Apple's modern
   metadata scheme names its fields as free-text strings rather than
   fixed box types.
   ============================================================= */
import { ScrubError } from './index.mjs';

const fail = (name, why) => new ScrubError(`"${name}" couldn't be read as ${why}`);

/** Boxes whose children we recurse into looking for udta/meta/uuid/time boxes. */
const CONTAINER_TYPES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex', 'moof', 'traf']);
/** Full boxes with a creation_time/modification_time pair right after version+flags. */
const TIME_BOXES = new Set(['mvhd', 'tkhd', 'mdhd']);
/** Boxes dropped wholesale wherever they're found. */
const STRIP_TYPES = new Set(['udta', 'meta', 'uuid', 'XMP_']);

/**
 * Read one box header at `p` (within the enclosing range `start..end`).
 * Handles size==1 (64-bit largesize follows the type) and size==0
 * (box runs to the end of its enclosing range).
 */
function readHeader(buf, p, end, ctx) {
  if (p + 8 > end) throw fail(ctx.name, `an ISO-BMFF file (truncated box header at offset ${p})`);
  let size = buf.readUInt32BE(p);
  const type = buf.toString('latin1', p + 4, p + 8);
  let headerLen = 8;
  if (size === 1) {
    if (p + 16 > end) throw fail(ctx.name, `an ISO-BMFF file (truncated 64-bit size at offset ${p})`);
    const big = buf.readBigUInt64BE(p + 8);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw fail(ctx.name, `an ISO-BMFF file (box "${type}" is implausibly large)`);
    size = Number(big);
    headerLen = 16;
  } else if (size === 0) {
    size = end - p;
  }
  if (size < headerLen || p + size > end) throw fail(ctx.name, `an ISO-BMFF file ("${type}" box runs past the end of the file)`);
  return { type, start: p, headerLen, end: p + size };
}

/** Rewrite a box's type to "free" and zero its payload, without touching its size field(s). */
function neutralize(buf, box) {
  buf.write('free', box.start + 4, 4, 'latin1');
  buf.fill(0, box.start + box.headerLen, box.end);
}

/** Zero creation_time/modification_time in an mvhd/tkhd/mdhd box (v0 32-bit or v1 64-bit). Returns true if anything changed. */
function zeroTimes(buf, box, ctx) {
  const p = box.start + box.headerLen;
  if (p + 4 > box.end) throw fail(ctx.name, `an ISO-BMFF file ("${box.type}" is too short for its version/flags)`);
  const version = buf[p];
  const width = version === 1 ? 8 : version === 0 ? 4 : null;
  if (width === null) throw fail(ctx.name, `an ISO-BMFF file (unsupported "${box.type}" version ${version})`);
  const fieldsEnd = p + 4 + width * 2;
  if (fieldsEnd > box.end) throw fail(ctx.name, `an ISO-BMFF file ("${box.type}" is too short for its timestamps)`);
  let changed = false;
  for (let i = p + 4; i < fieldsEnd; i++) {
    if (buf[i] !== 0) changed = true;
  }
  if (changed) buf.fill(0, p + 4, fieldsEnd);
  return changed;
}

/** Whether an mvhd/tkhd/mdhd box still carries a non-zero creation_time/modification_time. */
function hasNonZeroTimes(buf, box, ctx) {
  const p = box.start + box.headerLen;
  if (p + 4 > box.end) throw fail(ctx.name, `an ISO-BMFF file ("${box.type}" is too short for its version/flags)`);
  const version = buf[p];
  const width = version === 1 ? 8 : version === 0 ? 4 : null;
  if (width === null) throw fail(ctx.name, `an ISO-BMFF file (unsupported "${box.type}" version ${version})`);
  const fieldsEnd = p + 4 + width * 2;
  if (fieldsEnd > box.end) throw fail(ctx.name, `an ISO-BMFF file ("${box.type}" is too short for its timestamps)`);
  for (let i = p + 4; i < fieldsEnd; i++) if (buf[i] !== 0) return true;
  return false;
}

/** ©-tag / iTunes key FourCC (or Apple "keys" string) → category. */
function classifyKey(key) {
  switch (key) {
    case '©xyz': case 'loci': return 'location'; // loci: 3GPP/iTunes location box, e.g. what ffmpeg's -metadata location writes into an mp4's ilst
    case '©mak': case '©mod': return 'device';
    case '©day': return 'time';
    case '©too': case '©swr': return 'software';
    case '©ART': case '©aut': case 'aART': return 'author';
    case '©nam': case '©cmt': case '©des': case '©gen': return 'text';
    case 'covr': return 'thumbnail';
    default: return 'other';
  }
}

/** Substring hints in the "com.apple.quicktime.*" key names the modern Apple metadata scheme spells out as text. */
function classifyTextRun(s) {
  const k = s.toLowerCase();
  if (k.includes('location') || k.includes('iso6709')) return 'location';
  if (k.includes('make') || k.includes('model')) return 'device';
  if (k.includes('creationdate')) return 'time';
  if (k.includes('software') || k.includes('encoder')) return 'software';
  if (k.includes('author') || k.includes('artist')) return 'author';
  if (k.includes('title') || k.includes('comment') || k.includes('description')) return 'text';
  return null;
}

/**
 * Lenient, non-throwing box walk used only to classify what a udta/meta
 * payload holds. Some "meta" boxes are FullBoxes (4-byte version/flags
 * before their children) and some (older QuickTime) aren't; rather than
 * decide, a run that doesn't look like a box header is skipped a word at
 * a time until one does.
 */
function* safeIterAtoms(payload, depth = 0) {
  if (depth > 4) return;
  let p = 0;
  while (p + 8 <= payload.length) {
    let size = payload.readUInt32BE(p);
    const type = payload.toString('latin1', p + 4, p + 8);
    let headerLen = 8;
    if (size === 1) {
      if (p + 16 > payload.length) { p += 4; continue; }
      size = Number(payload.readBigUInt64BE(p + 8));
      headerLen = 16;
    }
    // size===0 ("extends to end of file") is a real top-level convention, but inside a udta/meta
    // payload it's almost always a FullBox's all-zero version+flags field, not a real box header —
    // treat it as unrecognised here and resync, the same as any other bad-looking header.
    if (size < headerLen || size === 0 || p + size > payload.length) { p += 4; continue; }
    yield { type, size };
    if (type === 'ilst' || type === 'udta' || type === 'meta') {
      yield* safeIterAtoms(payload.subarray(p + headerLen, p + size), depth + 1);
    }
    p += size;
  }
}

/** What a udta/meta/uuid/XMP_ box's payload holds, best-effort. Never throws. */
function classifyStripped(type, payload) {
  const cats = new Set();
  if (type === 'uuid') {
    scanText(payload.subarray(Math.min(16, payload.length)), cats);
    if (cats.size === 0) cats.add('other');
    return [...cats];
  }
  if (type === 'XMP_') return ['other'];
  for (const atom of safeIterAtoms(payload)) {
    if (atom.type !== 'ilst' && atom.type !== 'udta' && atom.type !== 'meta' && atom.type !== 'hdlr' && atom.type !== 'keys' && atom.type !== 'data') {
      cats.add(classifyKey(atom.type));
    }
  }
  scanText(payload, cats);
  if (cats.size === 0) cats.add('other');
  return [...cats];
}

function scanText(buf, cats) {
  const s = buf.toString('latin1');
  const re = /[ -~]{4,}/g;
  let m;
  while ((m = re.exec(s))) {
    const cat = classifyTextRun(m[0]);
    if (cat) cats.add(cat);
  }
}

/** Structural walk: throws ScrubError on anything malformed; strips/zeroes in place when `mutate`. */
function walk(buf, start, end, ctx, categories, mutate) {
  let p = start;
  while (p < end) {
    const box = readHeader(buf, p, end, ctx);
    const { type } = box;
    if (type === 'mdat') { p = box.end; continue; } // never parsed
    if (STRIP_TYPES.has(type)) {
      const payload = buf.subarray(box.start + box.headerLen, box.end);
      for (const c of classifyStripped(type, payload)) categories.add(c);
      if (mutate) neutralize(buf, box);
      p = box.end;
      continue;
    }
    if (TIME_BOXES.has(type)) {
      const changed = mutate ? zeroTimes(buf, box, ctx) : hasNonZeroTimes(buf, box, ctx);
      if (changed) categories.add('time');
      p = box.end;
      continue;
    }
    if (CONTAINER_TYPES.has(type)) {
      walk(buf, box.start + box.headerLen, box.end, ctx, categories, mutate);
      p = box.end;
      continue;
    }
    p = box.end; // ftyp, free, wide, iods, stsd, stts, ... left untouched
  }
}

/**
 * @param {Buffer} buf
 * @param {{ name: string }} ctx
 * @returns {Promise<{ buffer: Buffer, removed: string[] }>}
 */
export async function scrub(buf, ctx) {
  if (buf.length < 8) throw fail(ctx.name, 'an ISO-BMFF file (too small)');
  const out = Buffer.from(buf);
  const removed = new Set();
  walk(out, 0, out.length, ctx, removed, true);
  return { buffer: out, removed: [...removed] };
}

/** Categories still present: any surviving udta/meta/uuid/XMP_ box, or a non-zero creation/modification time. */
export async function inspect(buf, ctx) {
  if (buf.length < 8) throw fail(ctx.name, 'an ISO-BMFF file (too small)');
  const found = new Set();
  walk(buf, 0, buf.length, ctx, found, false);
  return [...found];
}
