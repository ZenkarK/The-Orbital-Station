/* =============================================================
   ICC colour-profile neutraliser, shared by every format that can
   carry an embedded ICC profile (PRIV-04)

   JPEG's APP2 ICC_PROFILE segment(s), PNG's iCCP chunk, WebP's ICCP
   chunk and GIF's ICCRGBG1 application extension all carry a real
   ICC profile — and a profile's own tag table carries free-text
   fields (ProfileDescriptionTag 'desc', CopyrightTag 'cprt', the
   device manufacturer/model description tags 'dmnd'/'dmdd', and any
   other tag typed as a v4 'mluc', v2 'text' or v4.4 'dict') that real
   colour-management tools routinely stamp with a device or computer
   name (macOS's ColorSync display profiles are the classic case: a
   profile literally named "<owner>'s MacBook Pro Display").

   An earlier version of this module tried to solve that by only
   vouching for a profile whose text matched a short allowlist of
   generic names, and had every caller DROP everything else. That
   dropped essentially every real-world profile — including sharp's
   own bundled sRGB/Display-P3 profiles and every profile shipped in
   Windows' own colour directory — silently shifting the colours of
   any wide-gamut photo it touched. Dropping colour management is not
   an acceptable way to remove a name.

   neutralizeIccProfile() instead KEEPS every profile that parses,
   and blanks the free text inside it in place: every length, offset
   and count field is left exactly as it was, curves/matrices/LUTs/
   every non-text tag is untouched byte-for-byte, and the profile's
   creation date/time and computed ID (neither of which affects how
   colour is managed, both of which can fingerprint when/where a
   profile was made) are zeroed in the header. A profile whose tag
   table or a text tag's own internal structure doesn't parse throws
   (ScrubError), the same fail-closed posture as the rest of PRIV-04
   — but nothing is ever silently kept-with-secrets or dropped.

   STANDARD_NAMES is kept only so callers can decide whether the text
   that got blanked was worth mentioning in the "removed" report (an
   ordinary sRGB/P3/Adobe RGB photo shouldn't tell its author "camera
   and device details were removed" every single time) — it is never
   used to decide what survives.
   ============================================================= */
import { ScrubError } from './index.mjs';

/** Standard, generic profile names/descriptions and copyright strings, matched case-insensitively
 *  and in full (not a substring) — used only to decide whether blanked text is worth reporting.
 *  Also used to check a PNG iCCP chunk's own cleartext profile-name field (png.mjs). */
export const STANDARD_NAMES = new Set([
  'srgb iec61966-2.1',
  'srgb',
  'srgb built-in',
  'gimp built-in srgb',
  'c srgb profile',
  'icc profile', // the generic placeholder name several PNG encoders write for any embedded profile, and the one we rewrite it to
  'icc', // sharp/libvips's own even terser iCCP profile-name field
  'display p3',
  'apple display p3',
  'sp3c', // sharp/libvips's own terse Display P3 description
  'adobe rgb (1998)',
  'prophoto rgb',
  'dci(p3) rgb',
  'generic rgb profile',
  'generic gray gamma 2.2 profile',
  'dot gain 20%',
  'color lcd',
  'public domain',
  'cc0', // the Creative Commons Zero mark sharp/libvips's own bundled profiles ship as their copyright
  'copyright (c) 1998 hewlett-packard company',
  'copyright 2007 apple inc., all rights reserved.',
  'no copyright, use freely',
]);

/** Back-compat alias: earlier code imported this name. */
export const ALLOWED_NAMES = STANDARD_NAMES;

/** UTF-16BE code units, stopping at the first NUL. */
function utf16beText(buf) {
  let s = '';
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const code = buf.readUInt16BE(i);
    if (code === 0) break;
    s += String.fromCharCode(code);
  }
  return s;
}

/** Blanks every non-NUL byte in [start, end) to an ASCII space, leaving NUL bytes (terminators/padding)
 *  exactly where they were — the length of the text field never changes. */
function blankAsciiKeepNuls(buf, start, end) {
  for (let i = start; i < end; i++) if (buf[i] !== 0) buf[i] = 0x20;
}

/** Same idea for UTF-16BE: every non-zero code unit becomes U+0020, every U+0000 stays U+0000. */
function blankUtf16KeepNuls(buf, start, end) {
  for (let i = start; i + 1 < end; i += 2) {
    if (buf.readUInt16BE(i) !== 0) buf.writeUInt16BE(0x0020, i);
  }
}

/**
 * ICC v2 textDescriptionType ('desc'): reserved(4) + ASCII count(4) + NUL-terminated ASCII text,
 * then an optional Unicode language code(4) + Unicode count(4, in UTF-16 code units) + UTF-16 text,
 * then an optional Macintosh ScriptCode block (code(2) + count(1) + a fixed 67-byte buffer).
 * Every count/offset field is read, never written; only the text bytes themselves are blanked.
 */
function neutralizeDesc(buf, offset, size, fail) {
  if (size < 12) throw fail(`a "desc" tag is too short to hold its ASCII count field`);
  const tagEnd = offset + size;
  const asciiCount = buf.readUInt32BE(offset + 8);
  const asciiStart = offset + 12;
  const asciiEnd = asciiStart + asciiCount;
  if (asciiCount < 0 || asciiEnd > tagEnd) throw fail(`a "desc" tag's ASCII count runs past the end of the tag`);
  const asciiText = buf.toString('latin1', asciiStart, asciiEnd).replace(/\0+$/, '').trim();
  blankAsciiKeepNuls(buf, asciiStart, asciiEnd);

  let hadText = asciiText.length > 0;
  let text = asciiText;
  let p = asciiEnd;

  if (p + 8 <= tagEnd) {
    const ucCount = buf.readUInt32BE(p + 4);
    const ucStart = p + 8;
    const ucEnd = ucStart + ucCount * 2;
    if (ucCount < 0 || ucEnd > tagEnd) throw fail(`a "desc" tag's Unicode count runs past the end of the tag`);
    const ucText = utf16beText(buf.subarray(ucStart, ucEnd)).trim();
    blankUtf16KeepNuls(buf, ucStart, ucEnd);
    if (ucText) { hadText = true; text = text || ucText; }
    p = ucEnd;
  }

  if (p + 3 <= tagEnd) {
    // Macintosh ScriptCode block: code(2) + count(1, left untouched — it's a count field) + a fixed
    // 67-byte buffer. Approximated as Latin-1 (close enough to MacRoman to tell "blank" from "not");
    // read BEFORE blanking so re-running this on an already-neutralised tag reports no text found.
    const macStart = p + 3;
    const macEnd = Math.min(macStart + 67, tagEnd);
    const macText = buf.toString('latin1', macStart, macEnd).replace(/\0+$/, '').trim();
    blankAsciiKeepNuls(buf, macStart, macEnd);
    if (macText) { hadText = true; text = text || macText; }
  }

  return { hadText, text };
}

/**
 * ICC v4 multiLocalizedUnicodeType ('mluc'): reserved(4) + record count(4) + record size(4), then that
 * many fixed-size records of language(2) + region(2) + this record's text length in bytes(4) + this
 * record's text offset from the start of the tag(4). The text itself is UTF-16BE, not necessarily
 * NUL-terminated, sitting wherever its record says (usually, but not always, right after the table).
 */
function neutralizeMluc(buf, offset, size, fail) {
  if (size < 16) throw fail(`an "mluc" tag is too short to hold its record-table header`);
  const tagEnd = offset + size;
  const count = buf.readUInt32BE(offset + 8);
  const recSize = buf.readUInt32BE(offset + 12);
  if (count < 0 || recSize < 12) throw fail(`an "mluc" tag has an implausible record count or size`);
  const tableEnd = offset + 16 + count * recSize;
  if (tableEnd > tagEnd) throw fail(`an "mluc" tag's record table runs past the end of the tag`);

  let hadText = false;
  let text = '';
  for (let i = 0; i < count; i++) {
    const e = offset + 16 + i * recSize;
    const recLen = buf.readUInt32BE(e + 4);
    const recOff = buf.readUInt32BE(e + 8);
    const start = offset + recOff;
    const end = start + recLen;
    if (recOff < 0 || recLen < 0 || start < offset || end > tagEnd) {
      throw fail(`an "mluc" tag record points outside the tag`);
    }
    const t = utf16beText(buf.subarray(start, end)).trim();
    blankUtf16KeepNuls(buf, start, end);
    if (t) { hadText = true; text = text || t; }
  }
  return { hadText, text };
}

/** ICC v2 textType ('text'): reserved(4) then plain (7-bit ASCII) NUL-terminated text to the end of the tag. */
function neutralizeTextTag(buf, offset, size) {
  const start = offset + 8;
  const end = offset + size;
  const text = buf.toString('latin1', start, end).replace(/\0+$/, '').trim();
  blankAsciiKeepNuls(buf, start, end);
  return { hadText: text.length > 0, text };
}

/**
 * ICC.2 (v4.4+) metadata dictionary type ('dict'): reserved(4) + entry count(4) + entry size(4, 24 or
 * 32), then that many entries of name-offset(4)/name-size(4)/value-offset(4)/value-size(4) — and, for
 * the 32-byte entry shape, a further display-name and display-value offset/size pair. Every string this
 * points at is UTF-16BE and is blanked; the offsets/sizes/counts themselves are never touched.
 */
function neutralizeDict(buf, offset, size, fail) {
  if (size < 16) throw fail(`a "dict" tag is too short to hold its entry-table header`);
  const tagEnd = offset + size;
  const count = buf.readUInt32BE(offset + 8);
  const entrySize = buf.readUInt32BE(offset + 12);
  if (entrySize !== 24 && entrySize !== 32) throw fail(`a "dict" tag has an unsupported entry size (${entrySize})`);
  const tableStart = offset + 16;
  const tableEnd = tableStart + count * entrySize;
  if (count < 0 || tableEnd > tagEnd) throw fail(`a "dict" tag's entry table runs past the end of the tag`);

  let hadText = false;
  let text = '';
  const blank = (relOffset, relSize) => {
    if (relSize === 0) return '';
    const start = offset + relOffset;
    const end = start + relSize;
    if (relOffset < 0 || relSize < 0 || start < offset || end > tagEnd) {
      throw fail(`a "dict" tag string points outside the tag`);
    }
    const t = utf16beText(buf.subarray(start, end)).trim();
    blankUtf16KeepNuls(buf, start, end);
    return t;
  };

  for (let i = 0; i < count; i++) {
    const e = tableStart + i * entrySize;
    const t1 = blank(buf.readUInt32BE(e), buf.readUInt32BE(e + 4));
    const t2 = blank(buf.readUInt32BE(e + 8), buf.readUInt32BE(e + 12));
    if (t1 || t2) { hadText = true; text = text || t1 || t2; }
    if (entrySize === 32) {
      const t3 = blank(buf.readUInt32BE(e + 16), buf.readUInt32BE(e + 20));
      const t4 = blank(buf.readUInt32BE(e + 24), buf.readUInt32BE(e + 28));
      if (t3 || t4) { hadText = true; text = text || t3 || t4; }
    }
  }
  return { hadText, text };
}

/**
 * Keeps `rawBuf` as a valid ICC profile but blanks every text-carrying tag's content in place —
 * regardless of the tag's own signature, by looking at each tag's own type — and zeroes the header's
 * creation date/time (bytes 24-35) and profile ID (bytes 84-99; all-zero validly means "not computed").
 * No length, offset or count field is ever changed, and every non-text tag (curves, matrices, LUTs,
 * XYZ values, ...) is left byte-for-byte untouched, so colour management is unaffected.
 *
 * @param {Buffer} rawBuf
 * @param {{ name: string }} ctx
 * @returns {{ buffer: Buffer, hadPersonalText: boolean }} a fresh buffer (the input is never mutated);
 *   hadPersonalText is true only when some blanked text did NOT match STANDARD_NAMES — for reporting.
 * @throws {ScrubError} when the profile's header, tag table, or a text tag's own structure doesn't parse.
 */
export function neutralizeIccProfile(rawBuf, ctx) {
  const fail = (why) => new ScrubError(`"${ctx.name}" has an embedded ICC colour profile that couldn't be read (${why}).`);
  if (!Buffer.isBuffer(rawBuf) || rawBuf.length < 132) throw fail('too short to hold a profile header and tag table');
  const buf = Buffer.from(rawBuf); // work on a private copy; the caller's buffer is never mutated
  const tagCount = buf.readUInt32BE(128);
  if (tagCount < 0 || tagCount > 1000) throw fail(`an implausible tag count (${tagCount})`);
  const tableEnd = 132 + tagCount * 12;
  if (tableEnd > buf.length) throw fail('its tag table runs past the end of the profile');

  let personal = false;
  const done = new Set(); // tag data offsets already neutralised — some ICC profiles share one tag's
                           // data between several table entries (e.g. rTRC/gTRC/bTRC all pointing at
                           // one curve); re-blanking the same bytes is harmless but wasted work.
  for (let i = 0; i < tagCount; i++) {
    const entry = 132 + i * 12;
    const sig = buf.toString('latin1', entry, entry + 4);
    const tagOffset = buf.readUInt32BE(entry + 4);
    const tagSize = buf.readUInt32BE(entry + 8);
    if (tagOffset < 0 || tagSize < 4 || tagOffset + tagSize > buf.length) {
      throw fail(`its "${sig}" tag has an offset or size out of range`);
    }
    if (done.has(tagOffset)) continue;
    const type = buf.toString('latin1', tagOffset, tagOffset + 4);
    let result = null;
    if (type === 'desc') result = neutralizeDesc(buf, tagOffset, tagSize, fail);
    else if (type === 'mluc') result = neutralizeMluc(buf, tagOffset, tagSize, fail);
    else if (type === 'text' && tagSize > 8) result = neutralizeTextTag(buf, tagOffset, tagSize);
    else if (type === 'dict') result = neutralizeDict(buf, tagOffset, tagSize, fail);
    if (result) {
      done.add(tagOffset);
      if (result.hadText && !STANDARD_NAMES.has(result.text.toLowerCase())) personal = true;
    }
  }

  buf.fill(0, 24, 36); // profile creation date/time
  buf.fill(0, 84, 100); // profile ID (MD5); all-zero is the defined "not computed" value

  return { buffer: buf, hadPersonalText: personal };
}
