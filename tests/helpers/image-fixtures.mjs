/* =============================================================
   Raster image fixtures for the clean-room scrubber tests (PRIV-04)

   Every fixture is a real, decodable image: a small picture built
   with sharp, then — where a test needs metadata the scrubbers must
   remove — either sharp's own withExif()/withXmp() (for the EXIF/XMP
   cases a real camera or editor would produce) or a raw segment/chunk
   spliced in by hand (for the format quirks a real file also carries:
   comments, IPTC blocks, MPF, bytes after the real end, and so on).
   Splicing after encoding keeps the underlying pixel data untouched,
   so "decoded pixels identical" assertions stay meaningful.

   All values here are fake: "Test Author" / "TestSoft" / 0°,0° GPS.
   ============================================================= */
import sharp from 'sharp';
import zlib from 'node:zlib';

export const WIDTH = 6;
export const HEIGHT = 5;

/** A fresh sharp pipeline over a small solid-colour RGBA image. Call once per encode. */
export function baseImage() {
  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: { r: 20, g: 60, b: 120, alpha: 0.6 } } });
}

/** Fake EXIF fields shared by every format that can carry real EXIF: an author, a device, and — in
 *  IFD3, libvips's naming for the GPS IFD — a fake 0°,0° location. */
export const FAKE_EXIF = {
  IFD0: { Artist: 'Test Author', Software: 'TestSoft', Make: 'TestMake', Model: 'TestModel' },
  IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '0/1 0/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '0/1 0/1 0/1' },
};
export const FAKE_XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>';

// ---------------------------------------------------------------- JPEG

/** A JPEG with Orientation 6 plus author/device/GPS EXIF, all written by sharp. */
export function jpegWithExif({ orientation = 6 } = {}) {
  return baseImage()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .withExif(FAKE_EXIF)
    .withMetadata({ orientation })
    .jpeg()
    .toBuffer();
}

/** A plain JPEG with no metadata, for the fixtures below to splice hand-built segments into. */
export function plainJpeg() {
  return baseImage().flatten({ background: { r: 255, g: 255, b: 255 } }).jpeg().toBuffer();
}

/** One raw JPEG segment: FF + marker + big-endian length + payload. */
export function jpegSegment(marker, payload) {
  const seg = Buffer.alloc(4 + payload.length);
  seg[0] = 0xff;
  seg[1] = marker;
  seg.writeUInt16BE(payload.length + 2, 2);
  payload.copy(seg, 4);
  return seg;
}

/** Splices raw segments in right after SOI — a position any decoder must tolerate skippable markers at. */
export function insertJpegSegments(buf, ...segments) {
  return Buffer.concat([buf.subarray(0, 2), ...segments, buf.subarray(2)]);
}

/** A hand-built APP2 ICC_PROFILE segment (single chunk: sequence 1 of 1) carrying `profileBytes`. */
export function jpegIccSegment(profileBytes) {
  return jpegSegment(0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.from([1, 1]), profileBytes]));
}

/** `profileBytes` split across several APP2 ICC_PROFILE segments (sequence/count bytes set correctly),
 *  each carrying at most `chunkSize` bytes of the profile — for exercising multi-segment reassembly. */
export function jpegIccSegments(profileBytes, chunkSize) {
  const chunks = [];
  for (let i = 0; i < profileBytes.length; i += chunkSize) chunks.push(profileBytes.subarray(i, i + chunkSize));
  const count = chunks.length;
  return chunks.map((chunk, i) =>
    jpegSegment(0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.from([i + 1, count]), chunk])),
  );
}

/** A hand-built JFIF APP0 segment (version 1.1, no density units) carrying an embedded raw-RGB thumbnail
 *  of the given size — the kind some editors regenerate from the pre-crop/pre-edit original. */
export function jfifSegmentWithThumbnail(thumbWidth, thumbHeight, thumbPixels) {
  const header = Buffer.alloc(14);
  header.write('JFIF\0', 0, 'latin1');
  header[5] = 1; // major version
  header[6] = 1; // minor version
  header[7] = 0; // units: no units, aspect ratio only
  header.writeUInt16BE(1, 8); // Xdensity
  header.writeUInt16BE(1, 10); // Ydensity
  header[12] = thumbWidth;
  header[13] = thumbHeight;
  return jpegSegment(0xe0, Buffer.concat([header, thumbPixels]));
}

/** A JPEG carrying a COM comment, a Photoshop/IPTC-style APP13, an MPF-style APP2, and trailing bytes after EOI. */
export async function jpegWithLegacyMetadata() {
  const base = await plainJpeg();
  const com = jpegSegment(0xfe, Buffer.from('a planted test comment', 'latin1'));
  const app13 = jpegSegment(0xed, Buffer.from('Photoshop 3.0\0fake IPTC payload', 'latin1'));
  const app2mpf = jpegSegment(0xe2, Buffer.from('MPF\0fake secondary-image index', 'latin1'));
  const withSegments = insertJpegSegments(base, com, app13, app2mpf);
  return Buffer.concat([withSegments, Buffer.from('faketrailerdatathatstandsinforamp4motionphoto', 'latin1')]);
}

// ---------------------------------------------------------------- PNG

/** A PNG with author/software EXIF, written by sharp as an eXIf chunk. */
export function pngWithExif() {
  return baseImage().png().withExif(FAKE_EXIF).withMetadata().toBuffer();
}

/** A plain PNG with no ancillary metadata, for splicing hand-built chunks into. */
export function plainPng() {
  return baseImage().png().toBuffer();
}

/** One PNG chunk: length + type + data + a real CRC32, so a strict decoder still accepts the file. */
export function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** An iCCP chunk: cleartext profile name + NUL + compression method (0) + zlib-deflated profile bytes. */
export function pngIccChunk(name, profileBytes) {
  const nameBuf = Buffer.from(name, 'latin1');
  return pngChunk('iCCP', Buffer.concat([nameBuf, Buffer.from([0, 0]), zlib.deflateSync(profileBytes)]));
}

/** Splices chunks in right after IHDR (always the first chunk after the signature). */
export function insertPngChunks(buf, ...chunks) {
  const ihdrLen = buf.readUInt32BE(8);
  const ihdrEnd = 8 + 8 + ihdrLen + 4;
  return Buffer.concat([buf.subarray(0, ihdrEnd), ...chunks, buf.subarray(ihdrEnd)]);
}

/** A PNG carrying a tEXt comment, an eXIf chunk (hand-built, no camera involved), a tIME chunk and trailing bytes. */
export async function pngWithLegacyMetadata() {
  const base = await plainPng();
  const text = pngChunk('tEXt', Buffer.concat([Buffer.from('Comment\0'), Buffer.from('a planted test comment')]));
  const time = pngChunk('tIME', Buffer.from([0x07, 0xe8, 1, 1, 0, 0, 0])); // 2024-01-01 00:00:00, fake
  const withChunks = insertPngChunks(base, text, time);
  return Buffer.concat([withChunks, Buffer.from('TRAILERBYTES', 'latin1')]);
}

// ---------------------------------------------------------------- GIF

/** A plain GIF with no extensions beyond the graphic control block sharp always writes. */
export function plainGif() {
  return baseImage().gif().toBuffer();
}

/** GIF sub-blocks: payload split into <=255-byte pieces, each size-prefixed, terminated by a 0 byte. */
export function gifSubBlocks(payload) {
  const parts = [];
  let i = 0;
  while (i < payload.length) {
    const n = Math.min(255, payload.length - i);
    parts.push(Buffer.from([n]), payload.subarray(i, i + n));
    i += n;
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

export function gifCommentExtension(text) {
  return Buffer.concat([Buffer.from([0x21, 0xfe]), gifSubBlocks(Buffer.from(text, 'latin1'))]);
}

/** A Plain Text Extension: the fixed 12-byte grid/cell/colour header (zeroed — this fixture only
 *  needs a structurally valid block, not a rendered one), then the text as sub-blocks. */
export function gifPlainTextExtension(text) {
  return Buffer.concat([Buffer.from([0x21, 0x01, 12]), Buffer.alloc(12), gifSubBlocks(Buffer.from(text, 'latin1'))]);
}

/** idAuth is the 11-byte (8 id + 3 auth) application identifier, e.g. 'NETSCAPE2.0' or 'XMP DataXMP'. */
export function gifApplicationExtension(idAuth, payload) {
  const id = Buffer.from(idAuth, 'latin1');
  return Buffer.concat([Buffer.from([0x21, 0xff, id.length]), id, gifSubBlocks(payload)]);
}

/** Where in a GIF buffer the header + logical screen descriptor + global colour table end. */
export function gifHeaderEnd(buf) {
  const packed = buf[10];
  const gctSize = (packed & 0x80) ? 3 * 2 ** ((packed & 0x07) + 1) : 0;
  return 13 + gctSize;
}

export function insertGifBlocks(buf, ...blocks) {
  const at = gifHeaderEnd(buf);
  return Buffer.concat([buf.subarray(0, at), ...blocks, buf.subarray(at)]);
}

/** A GIF carrying a comment extension and an Adobe-style XMP application extension. */
export async function gifWithLegacyMetadata() {
  const base = await plainGif();
  const comment = gifCommentExtension('a planted test comment');
  const xmp = gifApplicationExtension('XMP DataXMP', Buffer.from(FAKE_XMP, 'latin1'));
  return insertGifBlocks(base, comment, xmp);
}

/** A GIF carrying a NETSCAPE2.0 loop application extension, which the scrubber must keep. */
export async function gifWithLoopExtension() {
  const base = await plainGif();
  const netscape = gifApplicationExtension('NETSCAPE2.0', Buffer.from([1, 0, 0]));
  return insertGifBlocks(base, netscape);
}

// ---------------------------------------------------------------- WebP

/** A lossless WebP with author EXIF and XMP, written by sharp (VP8X + VP8L + EXIF + XMP  chunks). */
export function webpWithExifAndXmp() {
  return baseImage().webp({ lossless: true }).withExif({ IFD0: { Artist: 'Test Author' } }).withXmp(FAKE_XMP).toBuffer();
}

/** A plain lossless WebP with no VP8X/EXIF/XMP, for splicing hand-built chunks into. */
export function plainWebp() {
  return baseImage().webp({ lossless: true }).toBuffer();
}

/** One RIFF chunk: fourCC + little-endian length + data + a padding byte if the data length is odd. */
export function riffChunk(fourCC, data) {
  const header = Buffer.alloc(8);
  header.write(fourCC, 0, 'latin1');
  header.writeUInt32LE(data.length, 4);
  const pad = data.length % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0);
  return Buffer.concat([header, data, pad]);
}

/** Appends chunks after the last existing one and fixes up the RIFF size field. */
export function appendWebpChunks(buf, ...chunks) {
  const body = Buffer.concat([buf.subarray(12), ...chunks]);
  const out = Buffer.concat([buf.subarray(0, 8), buf.subarray(8, 12), body]);
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}

/** A WebP carrying hand-built EXIF and XMP chunks, without going through sharp's own metadata writer. */
export async function webpWithLegacyMetadata() {
  const base = await plainWebp();
  const exifData = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tinyTiffWithArtist()]);
  const exif = riffChunk('EXIF', exifData);
  const xmp = riffChunk('XMP ', Buffer.from(FAKE_XMP, 'latin1'));
  return appendWebpChunks(base, exif, xmp);
}

// ---------------------------------------------------------------- ICC profiles

/** A profile name every ICC-carrying format's scrubber must recognise as standard and keep. */
export const STANDARD_ICC_NAME = 'sRGB IEC61966-2.1';

/**
 * A minimal but structurally real ICC profile: a 128-byte header (left zeroed — this fixture only
 * needs to satisfy the tag-table parser, not describe a real colour space), one tag table entry, and
 * one 'desc' tag (the ICC v2 textDescriptionType: reserved + ASCII count + NUL-terminated ASCII text)
 * holding `name`. Used to prove a standard name is kept and a device/personal name is caught.
 */
export function buildIccProfile(name) {
  const header = Buffer.alloc(128);
  const textBytes = Buffer.from(`${name}\0`, 'latin1');
  const tagData = Buffer.concat([
    Buffer.from('desc', 'latin1'),
    Buffer.alloc(4), // reserved
    (() => { const b = Buffer.alloc(4); b.writeUInt32BE(textBytes.length, 0); return b; })(),
    textBytes,
  ]);
  const tagOffset = header.length + 4 + 12; // header + tag-count field + one 12-byte tag table entry
  const entry = Buffer.concat([
    Buffer.from('desc', 'latin1'),
    (() => { const b = Buffer.alloc(4); b.writeUInt32BE(tagOffset, 0); return b; })(),
    (() => { const b = Buffer.alloc(4); b.writeUInt32BE(tagData.length, 0); return b; })(),
  ]);
  const tagCount = Buffer.alloc(4);
  tagCount.writeUInt32BE(1, 0);
  return Buffer.concat([header, tagCount, entry, tagData]);
}

/** A minimal little-endian TIFF/EXIF blob: IFD0 with one Artist (ASCII) tag. Used to hand-build EXIF chunks. */
function tinyTiffWithArtist() {
  const ARTIST_TAG = 0x013b;
  const value = Buffer.from('Test Author\0', 'latin1'); // ASCII, NUL-terminated, length 12 (> 4, so it's stored out-of-line)
  const ifdOffset = 8;
  const valueOffset = ifdOffset + 2 + 12 + 4; // header(8) + count(2) + one 12-byte entry + next-IFD offset(4)
  const buf = Buffer.alloc(valueOffset + value.length);
  buf.write('II', 0, 'latin1');
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(ifdOffset, 4);
  buf.writeUInt16LE(1, ifdOffset); // one entry
  const entry = ifdOffset + 2;
  buf.writeUInt16LE(ARTIST_TAG, entry);
  buf.writeUInt16LE(2, entry + 2); // type ASCII
  buf.writeUInt32LE(value.length, entry + 4);
  buf.writeUInt32LE(valueOffset, entry + 8);
  buf.writeUInt32LE(0, entry + 12); // no IFD1
  value.copy(buf, valueOffset);
  return buf;
}
