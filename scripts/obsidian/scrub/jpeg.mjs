/* =============================================================
   JPEG scrubber (PRIV-04)

   Walks the marker structure of a JPEG and rebuilds it from a
   whitelist: SOI, the JFIF/ICC/Adobe APPn segments that affect how
   the image looks, the compression tables, the scan data (copied
   byte-for-byte, so decoding is unaffected), and EOI. Everything
   else — EXIF, IPTC/Photoshop, XMP, comments, unrecognised APPn
   segments, and any bytes after the image's real end (secondary
   MPF images, phone trailers, appended video) — is dropped.

   An embedded ICC profile (one or more APP2 ICC_PROFILE segments,
   reassembled by their sequence/count bytes when there's more than
   one) is always kept — colour management must not change — but its
   free-text tags are blanked in place (see icc.mjs) before being
   re-split back into the same segment boundaries, since a display or
   editor's colour profile is often stamped with the device or
   computer's name.

   If the original had an EXIF Orientation other than 1, a fresh
   minimal APP1 holding only that one tag is written back in, so a
   photo taken sideways still displays upright.

   A JFIF APP0's own thumbnail (a full raw-RGB preview some editors
   regenerate from the pre-crop/pre-edit original) is never assumed
   safe just because the segment is kept: its Xthumbnail/Ythumbnail
   fields are checked and, if set, the thumbnail pixels are dropped
   and the fields zeroed rather than the whole segment kept verbatim.

   Also exports classifyExifTiff(), reused by png.mjs for the eXIf
   chunk (same TIFF structure, no "Exif\0\0" prefix).
   ============================================================= */
import { ScrubError } from './index.mjs';
import { neutralizeIccProfile } from './icc.mjs';

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP13 = 0xed;
const APP14 = 0xee;
const COM = 0xfe;

/** Segment markers kept verbatim: quant/Huffman tables, restart interval, arithmetic conditioning, start-of-frame. */
const KEEP_VERBATIM = new Set([
  0xdb /* DQT */, 0xc4 /* DHT */, 0xdd /* DRI */, 0xcc /* DAC */,
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf /* SOFn */,
]);

const fail = (name, why) => new ScrubError(`"${name}" couldn't be read as a JPEG (${why}).`);

/**
 * Rebuild a JPEG from `buf` with every marker not on the whitelist removed.
 * @param {Buffer} buf
 * @param {{ name: string }} ctx
 * @returns {Promise<{ buffer: Buffer, removed: string[] }>}
 */
export async function scrub(buf, ctx) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== SOI) throw fail(ctx.name, 'missing start-of-image marker');
  const removed = [];
  const kept = [Buffer.from([0xff, SOI])];
  const iccSegments = []; // { pos: index into `kept`, seq, count, chunk } — patched in after the main walk
  let orientation;
  let i = 2;
  let sawEoi = false;

  while (i < buf.length) {
    if (buf[i] !== 0xff) throw fail(ctx.name, `stray byte where a marker was expected at offset ${i}`);
    i++;
    while (buf[i] === 0xff) i++; // fill bytes before the real marker code
    if (i >= buf.length) throw fail(ctx.name, 'truncated marker');
    const marker = buf[i];
    i++;

    if (marker === EOI) {
      kept.push(Buffer.from([0xff, EOI]));
      sawEoi = true;
      break;
    }
    if (marker >= 0xd0 && marker <= 0xd7) continue; // stray restart marker outside a scan: harmless, no payload

    if (i + 2 > buf.length) throw fail(ctx.name, 'truncated segment length');
    const len = buf.readUInt16BE(i);
    if (len < 2 || i + len > buf.length) throw fail(ctx.name, 'segment runs past the end of the file');
    const headerStart = i - 2; // the FF marker byte
    const segFull = buf.subarray(headerStart, i + len); // FF marker + length + payload
    const payload = buf.subarray(i + 2, i + len);
    i += len;

    if (marker === SOS) {
      let j = i;
      while (j < buf.length) {
        if (buf[j] === 0xff) {
          const nb = buf[j + 1];
          if (nb === 0x00 || (nb >= 0xd0 && nb <= 0xd7)) { j += 2; continue; } // stuffing or restart marker: part of the scan
          break; // real marker: end of this scan's entropy data
        }
        j++;
      }
      if (j >= buf.length) throw fail(ctx.name, 'truncated scan data');
      kept.push(buf.subarray(headerStart, j)); // SOS header + entropy-coded data, copied verbatim
      i = j;
      continue;
    }

    if (KEEP_VERBATIM.has(marker)) { kept.push(segFull); continue; }

    if (marker === APP0) {
      if (payload.toString('latin1', 0, 5) === 'JFIF\0') {
        if (jfifHasThumbnail(payload)) {
          kept.push(buildSegment(APP0, thumbnailFreeJfif(payload)));
          removed.push('thumbnail');
        } else {
          kept.push(segFull);
        }
      } else removed.push(payload.toString('latin1', 0, 4) === 'JFXX' ? 'thumbnail' : 'other');
      continue;
    }
    if (marker === APP2) {
      if (payload.toString('latin1', 0, 12) === 'ICC_PROFILE\0') {
        iccSegments.push({ pos: kept.length, seq: payload[12], count: payload[13], chunk: payload.subarray(14) });
        kept.push(null); // placeholder: patched with the neutralised segment once every chunk is in
      } else {
        removed.push('other'); // MPF, FlashPix, or any other non-ICC APP2 payload
      }
      continue;
    }
    if (marker === APP14) {
      if (payload.toString('latin1', 0, 5) === 'Adobe') kept.push(segFull);
      else removed.push('other');
      continue;
    }
    if (marker === APP1) {
      const cats = classifyApp1(payload);
      if (cats.orientation !== undefined) orientation = cats.orientation;
      removed.push(...cats.categories);
      continue;
    }
    if (marker === APP13) { removed.push('text', 'author'); continue; } // Photoshop resources / IPTC
    if (marker >= 0xe0 && marker <= 0xef) { removed.push('other'); continue; } // any other APPn
    if (marker === COM) { removed.push('text'); continue; }

    throw fail(ctx.name, `unrecognised marker 0xFF${marker.toString(16).padStart(2, '0').toUpperCase()}`);
  }
  if (!sawEoi) throw fail(ctx.name, 'missing end-of-image marker');
  if (i < buf.length) removed.push('trailing'); // MPF secondary images, phone trailers, appended video, …

  if (iccSegments.length) {
    const hadPersonalText = reassembleAndNeutralizeIcc(iccSegments, ctx, (pos, segment) => { kept[pos] = segment; });
    if (hadPersonalText) removed.push('device');
  }

  if (orientation !== undefined && orientation !== 1) {
    kept.splice(1, 0, buildOrientationApp1(orientation)); // right after SOI
  }

  return { buffer: Buffer.concat(kept), removed };
}

/** Categories still present: any non-whitelisted marker, or unbaked EXIF/GPS/thumbnail data. */
export async function inspect(buf, ctx) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== SOI) throw fail(ctx.name, 'missing start-of-image marker');
  const cats = new Set();
  const iccSegments = [];
  let i = 2;
  let sawEoi = false;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw fail(ctx.name, `stray byte where a marker was expected at offset ${i}`);
    i++;
    while (buf[i] === 0xff) i++;
    if (i >= buf.length) throw fail(ctx.name, 'truncated marker');
    const marker = buf[i];
    i++;
    if (marker === EOI) { sawEoi = true; break; }
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (i + 2 > buf.length) throw fail(ctx.name, 'truncated segment length');
    const len = buf.readUInt16BE(i);
    if (len < 2 || i + len > buf.length) throw fail(ctx.name, 'segment runs past the end of the file');
    const payload = buf.subarray(i + 2, i + len);
    i += len;
    if (marker === SOS) {
      let j = i;
      while (j < buf.length && !(buf[j] === 0xff && buf[j + 1] !== 0x00 && !(buf[j + 1] >= 0xd0 && buf[j + 1] <= 0xd7))) j++;
      i = j;
      continue;
    }
    if (KEEP_VERBATIM.has(marker)) continue;
    if (marker === APP0) {
      if (payload.toString('latin1', 0, 5) === 'JFIF\0') { if (jfifHasThumbnail(payload)) cats.add('thumbnail'); }
      else cats.add(payload.toString('latin1', 0, 4) === 'JFXX' ? 'thumbnail' : 'other');
      continue;
    }
    if (marker === APP2) {
      if (payload.toString('latin1', 0, 12) === 'ICC_PROFILE\0') {
        iccSegments.push({ seq: payload[12], count: payload[13], chunk: payload.subarray(14) });
      } else cats.add('other');
      continue;
    }
    if (marker === APP14) { if (payload.toString('latin1', 0, 5) !== 'Adobe') cats.add('other'); continue; }
    if (marker === APP1) { for (const c of classifyApp1(payload).categories) cats.add(c); continue; }
    if (marker === APP13) { cats.add('text'); cats.add('author'); continue; }
    if (marker >= 0xe0 && marker <= 0xef) { cats.add('other'); continue; }
    if (marker === COM) { cats.add('text'); continue; }
    return [...cats, 'other']; // unrecognised marker: can't vouch for it
  }
  if (!sawEoi) throw fail(ctx.name, 'missing end-of-image marker');
  if (iccSegments.length && reassembleAndNeutralizeIcc(iccSegments, ctx)) cats.add('device');
  return [...cats];
}

/**
 * Reassembles one or more APP2 ICC_PROFILE segments (by their sequence/count bytes) into the full
 * profile, neutralises its free text (see icc.mjs), and — when `onSegment` is given — re-splits the
 * result back into the exact same chunk boundaries, calling `onSegment(pos, newSegmentBuffer)` for
 * each original segment. Returns whether any blanked text wasn't a standard, generic profile name.
 * @param {{ pos?: number, seq: number, count: number, chunk: Buffer }[]} segments
 * @param {{ name: string }} ctx
 * @param {(pos: number, segment: Buffer) => void} [onSegment]
 * @returns {boolean} hadPersonalText
 */
function reassembleAndNeutralizeIcc(segments, ctx, onSegment) {
  const counts = new Set(segments.map((s) => s.count));
  if (counts.size !== 1) throw fail(ctx.name, 'its ICC profile segments disagree on their total segment count');
  const [count] = counts;
  if (count !== segments.length) throw fail(ctx.name, "its ICC profile is missing one or more of its segments");
  const bySeq = [...segments].sort((a, b) => a.seq - b.seq);
  for (let k = 0; k < count; k++) {
    if (bySeq[k].seq !== k + 1) throw fail(ctx.name, 'its ICC profile segments have inconsistent sequence numbers');
  }

  const fullProfile = Buffer.concat(bySeq.map((s) => s.chunk));
  const { buffer: neutralized, hadPersonalText } = neutralizeIccProfile(fullProfile, ctx);

  if (onSegment) {
    const offsetBySeq = new Map();
    let cursor = 0;
    for (const s of bySeq) { offsetBySeq.set(s.seq, cursor); cursor += s.chunk.length; }
    for (const s of segments) {
      const start = offsetBySeq.get(s.seq);
      const newChunk = neutralized.subarray(start, start + s.chunk.length);
      const header = Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.from([s.seq, s.count])]);
      onSegment(s.pos, buildSegment(APP2, Buffer.concat([header, newChunk])));
    }
  }
  return hadPersonalText;
}

/** APP1 payload → { categories, orientation }. EXIF is classified by IFD; XMP is reported as 'other'. */
function classifyApp1(payload) {
  if (payload.toString('latin1', 0, 6) === 'Exif\0\0') {
    try {
      const { categories, orientation } = classifyExifTiff(payload.subarray(6));
      return { categories, orientation };
    } catch {
      return { categories: ['other'], orientation: undefined }; // unparsable EXIF: fail closed, still dropped
    }
  }
  return { categories: ['other'], orientation: undefined }; // XMP (main or extended) or unrecognised APP1
}

const IFD_ORIENTATION = 0x0112;
const IFD_EXIF_POINTER = 0x8769;
const IFD_GPS_POINTER = 0x8825;

/**
 * Classify the tags in a TIFF-structured EXIF blob (the bytes after JPEG's
 * "Exif\0\0" prefix, or a PNG eXIf chunk's data verbatim).
 * @param {Buffer} view
 * @returns {{ categories: string[], orientation: number|undefined }}
 */
export function classifyExifTiff(view) {
  if (view.length < 8) throw new Error('TIFF header too short');
  const bo = view.toString('latin1', 0, 2);
  let little;
  if (bo === 'II') little = true;
  else if (bo === 'MM') little = false;
  else throw new Error('bad TIFF byte-order mark');
  const magic = little ? view.readUInt16LE(2) : view.readUInt16BE(2);
  if (magic !== 42) throw new Error('bad TIFF magic number');

  const categories = new Set();
  let orientation;
  const seen = new Set();

  const u16 = (o) => (little ? view.readUInt16LE(o) : view.readUInt16BE(o));
  const u32 = (o) => (little ? view.readUInt32LE(o) : view.readUInt32BE(o));
  const entryValue = (valueOff, type) => (type === 3 ? u16(valueOff) : type === 4 ? u32(valueOff) : undefined);

  function visit(offset, kind) {
    if (!offset || offset < 0 || offset + 2 > view.length) throw new Error('IFD offset out of range');
    if (seen.has(offset)) throw new Error('circular IFD offset');
    seen.add(offset);
    const count = u16(offset);
    let p = offset + 2;
    for (let k = 0; k < count; k++, p += 12) {
      if (p + 12 > view.length) throw new Error('IFD entry runs past the end of the block');
      const tag = u16(p);
      const type = u16(p + 2);
      if (kind === 'gps') { categories.add('location'); continue; }
      if (kind === 'ifd0' && tag === IFD_EXIF_POINTER) { visit(entryValue(p + 8, 4), 'exif'); continue; }
      if (kind === 'ifd0' && tag === IFD_GPS_POINTER) { visit(entryValue(p + 8, 4), 'gps'); continue; }
      if (kind === 'ifd0' && tag === IFD_ORIENTATION) { orientation = entryValue(p + 8, type); continue; }
      const cat = classifyExifTag(tag);
      if (cat) categories.add(cat);
    }
    if (p + 4 <= view.length && u32(p)) categories.add('thumbnail'); // IFD1 (only chained from IFD0)
  }
  visit(u32(4), 'ifd0');
  return { categories: [...categories], orientation };
}

/** EXIF/TIFF tag id → CATEGORIES key, or undefined for tags with no privacy meaning (resolution, format flags, …). */
function classifyExifTag(tag) {
  switch (tag) {
    case 0x013b: // Artist
    case 0x8298: // Copyright
    case 0xa430: // CameraOwnerName
      return 'author';
    case 0x010f: // Make
    case 0x0110: // Model
    case 0xa431: // BodySerialNumber
    case 0xa432: // LensSpecification
    case 0xa433: // LensMake
    case 0xa434: // LensModel
    case 0xa435: // LensSerialNumber
      return 'device';
    case 0x0132: // DateTime
    case 0x9003: case 0x9004: // DateTimeOriginal / DateTimeDigitized
    case 0x9010: case 0x9011: case 0x9012: // OffsetTime, OffsetTimeOriginal, OffsetTimeDigitized
    case 0x9290: case 0x9291: case 0x9292: // SubSecTime, SubSecTimeOriginal, SubSecTimeDigitized
      return 'time';
    case 0x0131: // Software
    case 0x013c: // HostComputer
    case 0x000b: // ProcessingSoftware
      return 'software';
    case 0x010e: // ImageDescription
    case 0x9286: // UserComment
      return 'text';
    default:
      if (tag >= 0x9c9b && tag <= 0x9c9f) return 'text'; // XPTitle/XPComment/XPAuthor/XPKeywords/XPSubject
      return 'other';
  }
}

/** FF + marker + big-endian length + payload — a fresh segment built from scratch. */
function buildSegment(marker, payload) {
  const seg = Buffer.alloc(4 + payload.length);
  seg[0] = 0xff;
  seg[1] = marker;
  seg.writeUInt16BE(payload.length + 2, 2);
  payload.copy(seg, 4);
  return seg;
}

/** A fresh, minimal APP1 EXIF segment holding only IFD0 Orientation. */
function buildOrientationApp1(orientation) {
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4); // IFD0 at offset 8
  tiff.writeUInt16LE(1, 8); // one entry
  tiff.writeUInt16LE(IFD_ORIENTATION, 10);
  tiff.writeUInt16LE(3, 12); // SHORT
  tiff.writeUInt32LE(1, 14); // count
  tiff.writeUInt16LE(orientation, 18); // value, in the first 2 bytes of the 4-byte field
  tiff.writeUInt16LE(0, 20);
  tiff.writeUInt32LE(0, 22); // no IFD1
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  return buildSegment(APP1, payload);
}

/**
 * A JFIF APP0's fixed 14-byte header is identifier(5) + version(2) + units(1) +
 * Xdensity(2) + Ydensity(2) + Xthumbnail(1) + Ythumbnail(1); a non-zero
 * Xthumbnail/Ythumbnail is followed by that many pixels of raw RGB thumbnail
 * data — a full, separately-generated preview image (some editors regenerate
 * it from the pre-crop/pre-edit original) that a decoder never needs to show
 * the picture, but which we must not silently keep.
 */
function jfifHasThumbnail(payload) {
  return payload.length >= 14 && (payload[12] !== 0 || payload[13] !== 0);
}

/** The same JFIF APP0 payload with its thumbnail fields zeroed and any thumbnail pixel data dropped. */
function thumbnailFreeJfif(payload) {
  const header = Buffer.from(payload.subarray(0, 14));
  header[12] = 0;
  header[13] = 0;
  return header;
}
