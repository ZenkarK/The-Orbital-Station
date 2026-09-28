/* =============================================================
   AVIF / TIFF scrubber (PRIV-04)

   These two formats aren't hand-parsed like the others: sharp (an
   existing dependency) re-encodes the pixels instead, which drops
   every metadata block by default (no keepMetadata()/keepExif()/
   withMetadata() call is made). .rotate() runs first so an EXIF
   Orientation tag is baked into the pixels rather than lost, and a
   photo doesn't come back sideways. TIFF is written back with LZW
   compression, which is lossless. AVIF is deliberately re-encoded
   lossy: sharp does have a lossless AVIF mode, but it produces much
   larger files for a much slower encode, which doesn't fit a vault
   attachment pipeline — a high, fixed quality keeps the visible
   difference small while still stripping metadata.
   ============================================================= */
import sharp from 'sharp';
import { ScrubError } from './index.mjs';

const AVIF_QUALITY = 90;

const fail = (name, why) => new ScrubError(`"${name}" couldn't be re-encoded (${why}).`);

/**
 * @param {Buffer} buf
 * @param {{ name: string, ext: string }} ctx
 * @returns {Promise<{ buffer: Buffer, removed: string[] }>}
 */
export async function scrub(buf, ctx) {
  const removed = await categoriesPresent(buf, ctx);
  try {
    const img = sharp(buf).rotate();
    const buffer = ctx.ext === 'avif'
      ? await img.avif({ quality: AVIF_QUALITY }).toBuffer()
      : await img.tiff({ compression: 'lzw' }).toBuffer();
    return { buffer, removed };
  } catch (e) {
    throw fail(ctx.name, e.message);
  }
}

/** What metadata sharp reports as still present. [] means clean; an ICC profile alone doesn't count. */
export async function inspect(buf, ctx) {
  return categoriesPresent(buf, ctx);
}

/** sharp's parsed view of a file's metadata, translated into our category keys. */
async function categoriesPresent(buf, ctx) {
  let meta;
  try {
    meta = await sharp(buf).metadata();
  } catch (e) {
    throw fail(ctx.name, e.message);
  }
  const cats = new Set();
  if (meta.exif) cats.add('other');
  if (meta.iptc) cats.add('author');
  if (meta.xmp) cats.add('other');
  return [...cats];
}
