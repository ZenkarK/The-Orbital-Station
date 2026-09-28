/* =============================================================
   Fixture builders for the audio/video clean-room scrubbers
   (tests/obsidian/scrub-av.test.mjs). Every fixture is built at
   runtime from fake values (GPS 0°/0°, "Test Author", a made-up
   device/encoder name) — nothing here is ever read from a real file.
   ============================================================= */

// ---------- small byte helpers ----------
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; };
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n, 0); return b; };
const ascii = (s) => Buffer.from(s, 'latin1');

function box(type, payload) {
  const p = Buffer.isBuffer(payload) ? payload : Buffer.concat(payload);
  const buf = Buffer.alloc(8 + p.length);
  buf.writeUInt32BE(8 + p.length, 0);
  buf.write(type, 4, 4, 'latin1');
  p.copy(buf, 8);
  return buf;
}
function fullBox(type, version, flags, payload) {
  const head = Buffer.alloc(4);
  head[0] = version;
  head.writeUIntBE(flags & 0xffffff, 1, 3);
  return box(type, Buffer.concat([head, payload]));
}

// ---------- box-tree pieces that also track a named "hole" (a byte offset to patch later) ----------
const leaf = (buf, holes = []) => ({ buf, holes });
function wrap(type, children) {
  const payload = Buffer.concat(children.map((c) => c.buf));
  const buf = box(type, payload);
  const headerLen = buf.length - payload.length; // 8
  const holes = [];
  let cursor = headerLen;
  for (const c of children) {
    for (const h of c.holes) holes.push({ id: h.id, pos: cursor + h.pos });
    cursor += c.buf.length;
  }
  return { buf, holes };
}
function concatTop(pieces) {
  const buffer = Buffer.concat(pieces.map((p) => p.buf));
  const holes = [];
  let cursor = 0;
  for (const p of pieces) {
    for (const h of p.holes) holes.push({ id: h.id, pos: cursor + h.pos });
    cursor += p.buf.length;
  }
  return { buffer, holes };
}

// ---------- ISO-BMFF (mp4/m4v/mov/m4a) ----------

function ftypBox() {
  return leaf(box('ftyp', Buffer.concat([ascii('isom'), u32(512), ascii('isom'), ascii('mp42')])));
}

function mvhdBox({ creationTime = 3000000000 } = {}) {
  const body = Buffer.concat([
    u32(creationTime), u32(creationTime), u32(1000), u32(1000), // creation, modification, timescale, duration
    u32(0x00010000), u16(0x0100), Buffer.alloc(2), Buffer.alloc(8),
    u32(0x00010000), u32(0), u32(0),
    u32(0), u32(0x00010000), u32(0),
    u32(0), u32(0), u32(0x40000000),
    Buffer.alloc(24), u32(2),
  ]);
  return leaf(fullBox('mvhd', 0, 0, body));
}
function tkhdBox({ creationTime = 3000000000 } = {}) {
  const body = Buffer.concat([
    u32(creationTime), u32(creationTime), u32(1), u32(0), u32(1000),
    Buffer.alloc(8), u16(0), u16(0), u16(0x0100), u16(0),
    u32(0x00010000), u32(0), u32(0),
    u32(0), u32(0x00010000), u32(0),
    u32(0), u32(0), u32(0x40000000),
    u32(0), u32(0),
  ]);
  return leaf(fullBox('tkhd', 0, 0, body));
}
function mdhdBox({ creationTime = 3000000000 } = {}) {
  const body = Buffer.concat([u32(creationTime), u32(creationTime), u32(1000), u32(1000), u16(0x55c4), u16(0)]);
  return leaf(fullBox('mdhd', 0, 0, body));
}
function stcoLeaf() {
  const body = Buffer.concat([u32(1), u32(0)]); // entry_count=1, offset placeholder
  const buf = fullBox('stco', 0, 0, body);
  return leaf(buf, [{ id: 'stco', pos: buf.length - 4 }]);
}

/** Classic QuickTime "©xyz"-style text atom: 2-byte length + 2-byte language + UTF-8 text. */
function textAtom(type, text) {
  const t = Buffer.from(text, 'utf8');
  return box(type, Buffer.concat([u16(t.length), u16(0), t]));
}
function udtaBox() {
  const xyz = textAtom('©xyz', '+00.0000+000.0000/'); // fake GPS 0/0, ISO 6709
  const mak = textAtom('©mak', 'Test Device');
  return leaf(box('udta', Buffer.concat([xyz, mak])));
}

/** moov-level "meta": Apple's modern keys+ilst scheme, holding a fake ISO 6709 location. */
function keysMetaBox() {
  const hdlr = fullBox('hdlr', 0, 0, Buffer.concat([u32(0), ascii('mdta'), Buffer.alloc(12), Buffer.from([0])]));
  const keyName = Buffer.from('com.apple.quicktime.location.ISO6709', 'utf8');
  const keys = fullBox('keys', 0, 0, Buffer.concat([u32(1), u32(8 + keyName.length), ascii('mdta'), keyName]));
  const value = Buffer.from('+00.0000+000.0000/', 'utf8');
  const data = box('data', Buffer.concat([u32(1), u32(0), value]));
  const item = box(String.fromCharCode(0, 0, 0, 1), data); // item "1" references keys[0]
  const ilst = box('ilst', item);
  const metaBody = Buffer.concat([u32(0), hdlr, keys, ilst]); // meta is itself a FullBox
  return leaf(box('meta', metaBody));
}

/** Classic iTunes ilst (used for M4A): item type IS the tag FourCC, e.g. ©nam, covr. */
function classicMetaBox({ cover }) {
  const hdlr = fullBox('hdlr', 0, 0, Buffer.concat([u32(0), ascii('mdir'), ascii('appl'), Buffer.alloc(9)]));
  const item = (type, data, flags) => box(type, box('data', Buffer.concat([u32(flags), u32(0), data])));
  const nam = item('©nam', Buffer.from('Test Title', 'utf8'), 1);
  const art = item('©ART', Buffer.from('Test Author', 'utf8'), 1);
  const covr = item('covr', cover, 13); // 13 = JPEG
  const ilst = box('ilst', Buffer.concat([nam, art, covr]));
  const metaBody = Buffer.concat([u32(0), hdlr, ilst]);
  return leaf(box('meta', metaBody));
}

/**
 * A 3GPP/QuickTime "loci" (UserDataLocation) box, the shape a real ffmpeg
 * (`-metadata location=...`, muxing to .mp4) writes inside a classic
 * iTunes-style ilst: a FullBox holding a fake 0/0 GPS position, unlike
 * ©nam/©ART/covr it is NOT wrapped in a nested "data" atom.
 */
function lociItem() {
  const body = Buffer.concat([
    Buffer.alloc(4), // version/flags
    Buffer.alloc(2), // pad + ISO-639-2/T language, 0 = unset
    Buffer.from([0]), // empty name, NUL-terminated
    Buffer.from([0]), // role: 0 = shooting location
    u32(0), u32(0), u32(0), // longitude, latitude, altitude (all 0.0 fixed-point)
    ascii('earth'), Buffer.from([0]), // astronomical body, NUL-terminated
    Buffer.from([0]), // additional notes, NUL-terminated
  ]);
  return box('loci', body);
}

/** Like classicMetaBox, but with a "loci" location item alongside ©nam/©ART (no cover). */
function classicMetaBoxWithLoci() {
  const hdlr = fullBox('hdlr', 0, 0, Buffer.concat([u32(0), ascii('mdir'), ascii('appl'), Buffer.alloc(9)]));
  const item = (type, data, flags) => box(type, box('data', Buffer.concat([u32(flags), u32(0), data])));
  const nam = item('©nam', Buffer.from('Test Title', 'utf8'), 1);
  const art = item('©ART', Buffer.from('Test Author', 'utf8'), 1);
  const ilst = box('ilst', Buffer.concat([nam, art, lociItem()]));
  const metaBody = Buffer.concat([u32(0), hdlr, ilst]);
  return leaf(box('meta', metaBody));
}

const XMP_UUID_HEX = 'BE7ACFCB97A942E89C71999491E3AFAC';
function xmpUuidBox() {
  const uuidBytes = Buffer.from(XMP_UUID_HEX, 'hex');
  const xmp = Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>', 'utf8');
  return leaf(box('uuid', Buffer.concat([uuidBytes, xmp])));
}

export const MOV_MDAT_PAYLOAD = Buffer.from('FAKE-MEDIA-SAMPLE-BYTES-0123456789ABCDEF', 'latin1');

function mdatLeaf(payload, { largesize = false } = {}) {
  if (!largesize) {
    const buf = box('mdat', payload);
    return leaf(buf, [{ id: 'mdatPayload', pos: buf.length - payload.length }]);
  }
  const buf = Buffer.alloc(16 + payload.length);
  buf.writeUInt32BE(1, 0);
  buf.write('mdat', 4, 4, 'latin1');
  buf.writeBigUInt64BE(BigInt(16 + payload.length), 8);
  payload.copy(buf, 16);
  return leaf(buf, [{ id: 'mdatPayload', pos: 16 }]);
}

/**
 * A structurally valid MOV/MP4 carrying every kind of hidden metadata
 * isobmff.mjs is expected to strip: udta location/device, an Apple
 * "keys" location, a top-level XMP uuid, and non-zero mvhd/tkhd/mdhd
 * timestamps. stco points at MOV_MDAT_PAYLOAD's real offset.
 *
 * @param {{ order?: 'moov-first'|'mdat-first', largesize?: boolean }} [opts]
 */
export function buildMov({ order = 'moov-first', largesize = false } = {}) {
  const stco = stcoLeaf();
  const stbl = wrap('stbl', [stco]);
  const minf = wrap('minf', [stbl]);
  const mdia = wrap('mdia', [mdhdBox(), minf]);
  const trak = wrap('trak', [tkhdBox(), mdia, udtaBox()]);
  const moov = wrap('moov', [mvhdBox(), trak, udtaBox(), keysMetaBox()]);

  const ftyp = ftypBox();
  const uuid = xmpUuidBox();
  const mdat = mdatLeaf(MOV_MDAT_PAYLOAD, { largesize });

  const order_ = order === 'moov-first' ? [ftyp, moov, uuid, mdat] : [ftyp, uuid, mdat, moov];
  const { buffer, holes } = concatTop(order_);
  const stcoHole = holes.find((h) => h.id === 'stco').pos;
  const mdatHole = holes.find((h) => h.id === 'mdatPayload').pos;
  buffer.writeUInt32BE(mdatHole, stcoHole);
  return buffer;
}

export const M4A_COVER_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 0, 0, 0, 0xff, 0xd9]);

/** A structurally valid M4A with classic iTunes ilst tags (©nam/©ART) and an embedded cover (covr). */
export function buildM4a() {
  const stco = stcoLeaf();
  const stbl = wrap('stbl', [stco]);
  const minf = wrap('minf', [stbl]);
  const mdia = wrap('mdia', [mdhdBox(), minf]);
  const trak = wrap('trak', [tkhdBox(), mdia]);
  const moov = wrap('moov', [mvhdBox(), trak, classicMetaBox({ cover: M4A_COVER_BYTES })]);

  const ftyp = leaf(box('ftyp', Buffer.concat([ascii('M4A '), u32(0), ascii('M4A '), ascii('mp42'), ascii('isom')])));
  const mdat = mdatLeaf(MOV_MDAT_PAYLOAD);

  const { buffer, holes } = concatTop([ftyp, moov, mdat]);
  const stcoHole = holes.find((h) => h.id === 'stco').pos;
  const mdatHole = holes.find((h) => h.id === 'mdatPayload').pos;
  buffer.writeUInt32BE(mdatHole, stcoHole);
  return buffer;
}

/**
 * A structurally valid MP4 whose moov/udta/meta holds a classic iTunes ilst
 * with a "loci" location item — the shape a real `ffmpeg -metadata
 * location=... out.mp4` produces (see tests/obsidian/scrub-tools.test.mjs).
 */
export function buildMp4WithLoci() {
  const stco = stcoLeaf();
  const stbl = wrap('stbl', [stco]);
  const minf = wrap('minf', [stbl]);
  const mdia = wrap('mdia', [mdhdBox(), minf]);
  const trak = wrap('trak', [tkhdBox(), mdia]);
  const moov = wrap('moov', [mvhdBox(), trak, classicMetaBoxWithLoci()]);

  const ftyp = ftypBox();
  const mdat = mdatLeaf(MOV_MDAT_PAYLOAD);

  const { buffer, holes } = concatTop([ftyp, moov, mdat]);
  const stcoHole = holes.find((h) => h.id === 'stco').pos;
  const mdatHole = holes.find((h) => h.id === 'mdatPayload').pos;
  buffer.writeUInt32BE(mdatHole, stcoHole);
  return buffer;
}

// ---------- MP3 ----------

function syncsafe(n) {
  return Buffer.from([(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f]);
}
function plainSize(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}
function id3v2Frame(id, text, version) {
  const data = Buffer.concat([Buffer.from([0]), Buffer.from(text, 'latin1')]); // encoding 0 = ISO-8859-1
  const sizeField = version >= 4 ? syncsafe(data.length) : plainSize(data.length);
  return Buffer.concat([Buffer.from(id, 'latin1'), sizeField, Buffer.from([0, 0]), data]);
}
function buildId3v2(version, frames) {
  const body = Buffer.concat(frames);
  const header = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([version, 0]), Buffer.from([0]), syncsafe(body.length)]);
  return Buffer.concat([header, body]);
}
function mpegFrame() {
  // MPEG-1 Layer III frame sync + header bits, padded to a plausible frame length. Not a real decodable frame.
  return Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(96, 0xaa)]);
}
function id3v1Tag() {
  const buf = Buffer.alloc(128);
  buf.write('TAG', 0, 'latin1');
  buf.write('Test Title', 3, 30, 'latin1');
  buf.write('Test Author', 33, 30, 'latin1');
  return buf;
}
function apev2Tag() {
  const item = Buffer.concat([u32le(11), u32le(0), Buffer.from('Artist\0', 'latin1'), Buffer.from('Test Author', 'latin1')]);
  const footer = Buffer.alloc(32);
  footer.write('APETAGEX', 0, 'latin1');
  footer.writeUInt32LE(2000, 8);
  footer.writeUInt32LE(32 + item.length, 12);
  footer.writeUInt32LE(1, 16);
  footer.writeUInt32LE(0, 20);
  return Buffer.concat([item, footer]);
}

export const MP3_FRAME_COUNT = 6;
export const MP3_AUDIO_FRAME = mpegFrame();

/**
 * An MP3 with a leading ID3v2 tag (version 3 or 4), several audio
 * frames, then an APEv2 tag and an ID3v1 tag appended at the end.
 * @param {{ id3Version?: 3|4 }} [opts]
 */
export function buildMp3({ id3Version = 3 } = {}) {
  const id3v2 = buildId3v2(id3Version, [
    id3v2Frame('TPE1', 'Test Author', id3Version),
    id3v2Frame('TIT2', 'Test Title', id3Version),
    id3v2Frame('TDRC', '2020', id3Version),
    id3v2Frame('APIC', '\0image/jpeg\0\0\0FAKEJPEGBYTES', id3Version),
  ]);
  const audio = Buffer.concat(Array.from({ length: MP3_FRAME_COUNT }, () => MP3_AUDIO_FRAME));
  const tail = Buffer.concat([apev2Tag(), id3v1Tag()]);
  return Buffer.concat([id3v2, audio, tail]);
}

// ---------- WAV ----------

function riffChunk(id, data) {
  const header = Buffer.alloc(8);
  header.write(id, 0, 4, 'latin1');
  header.writeUInt32LE(data.length, 4);
  const pad = data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
  return Buffer.concat([header, data, pad]);
}

export const WAV_DATA_PAYLOAD = Buffer.from(Array.from({ length: 64 }, (_, i) => i % 256));

/** A structurally valid WAV with a LIST/INFO block (IART/ICRD) and a bext block, both dropped on scrub. */
export function buildWav() {
  const fmt = (() => {
    const b = Buffer.alloc(16);
    b.writeUInt16LE(1, 0); // PCM
    b.writeUInt16LE(1, 2); // mono
    b.writeUInt32LE(44100, 4);
    b.writeUInt32LE(88200, 8);
    b.writeUInt16LE(2, 12);
    b.writeUInt16LE(16, 14);
    return riffChunk('fmt ', b);
  })();
  const data = riffChunk('data', WAV_DATA_PAYLOAD);
  const iart = riffChunk('IART', Buffer.from('Test Author\0', 'latin1'));
  const icrd = riffChunk('ICRD', Buffer.from('2020-01-01\0', 'latin1'));
  const list = riffChunk('LIST', Buffer.concat([Buffer.from('INFO', 'latin1'), iart, icrd]));
  const bext = riffChunk('bext', Buffer.alloc(258));
  const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), fmt, list, bext, data]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** An RF64 stub (only the magic matters — the scrubber refuses it before reading further). */
export function buildRf64Stub() {
  const b = buildWav();
  const out = Buffer.from(b);
  out.write('RF64', 0, 'latin1');
  return out;
}

// ---------- FLAC ----------

function flacBlock(type, data, isLast) {
  const header = Buffer.alloc(4);
  header[0] = (isLast ? 0x80 : 0) | (type & 0x7f);
  header.writeUIntBE(data.length, 1, 3);
  return Buffer.concat([header, data]);
}

export const FLAC_AUDIO_FRAMES = Buffer.from(Array.from({ length: 48 }, (_, i) => (i * 7) % 256));

/** A structurally valid FLAC with a leading ID3v2 tag, a VORBIS_COMMENT and a PICTURE block, both dropped on scrub. */
export function buildFlac() {
  const streaminfo = Buffer.alloc(34);
  const vendor = Buffer.from('TestEncoder 1.0', 'utf8');
  const fields = [
    ['ARTIST', 'Test Author'],
    ['TITLE', 'Test Title'],
    ['DATE', '2020-01-01'],
  ].map(([k, v]) => Buffer.from(`${k}=${v}`, 'utf8'));
  const comment = Buffer.concat([
    u32le(vendor.length), vendor,
    u32le(fields.length),
    ...fields.flatMap((f) => [u32le(f.length), f]),
  ]);
  const mime = Buffer.from('image/jpeg', 'utf8');
  const picture = Buffer.concat([
    u32(3), u32(mime.length), mime, u32(0),
    u32(1), u32(1), u32(24), u32(0),
    u32(4), Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  ]);
  const blocks = [flacBlock(0, streaminfo, false), flacBlock(4, comment, false), flacBlock(6, picture, true)];
  const idTag = buildId3v2(3, [id3v2Frame('TIT2', 'Leading tag', 3)]);
  return Buffer.concat([idTag, Buffer.from('fLaC', 'latin1'), ...blocks, FLAC_AUDIO_FRAMES]);
}

// ---------- external-tool formats (byte stubs; only used for the tool-missing / routing paths) ----------

/** Enough of a HEIF/ISO-BMFF ftyp box to be recognised as a file; not a full valid HEIC. */
export function buildHeicStub() {
  return Buffer.concat([box('ftyp', Buffer.concat([ascii('heic'), u32(0), ascii('heic'), ascii('mif1')])), Buffer.from('FAKE-HEIC-BODY-BYTES')]);
}

/** EBML magic + filler; not a fully valid WebM, just enough to reach the external-tool routing. */
export function buildWebmStub() {
  return Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(28, 0)]);
}
