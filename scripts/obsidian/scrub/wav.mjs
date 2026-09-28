/* =============================================================
   WAV (RIFF/WAVE) scrubber (PRIV-04)

   Rebuilt from a whitelist of the three chunks that affect playback
   ("fmt ", "fact", "data", each copied byte-for-byte) — every other
   chunk is dropped: LIST/INFO (classified field by field: IART →
   author, ICRD → time, ISFT → software, INAM/ICMT → text), id3/ID3,
   bext (Broadcast Wave), iXML, _PMX (XMP), and anything else. The
   RIFF size field and each chunk's pad byte are recomputed for the
   result rather than copied, so a malformed pad byte in the input
   can't carry through.

   RF64 (the 64-bit size extension for >4 GB WAV files) isn't
   supported: pdf-lib-style "rewrite what we understand" isn't safe
   there without also rewriting the ds64 chunk, so it's refused.
   ============================================================= */
import { ScrubError } from './index.mjs';

const fail = (name, why) => new ScrubError(`"${name}" couldn't be read as a WAV file (${why}).`);

const KEEP = new Set(['fmt ', 'fact', 'data']);

/** Walk RIFF chunks after the 12-byte RIFF/WAVE header. Throws ScrubError on a truncated chunk. */
function readChunks(buf, ctx) {
  const chunks = [];
  let p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.toString('latin1', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    const dataStart = p + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > buf.length) throw fail(ctx.name, `the "${id.trim()}" chunk runs past the end of the file`);
    chunks.push({ id, data: buf.subarray(dataStart, dataEnd) });
    p = dataEnd + (size % 2);
  }
  return chunks;
}

/** LIST chunk payload → categories. Only the INFO flavour is understood field by field; any other is 'other'. */
function classifyList(data) {
  const cats = new Set();
  if (data.toString('latin1', 0, 4) !== 'INFO') return ['other'];
  let p = 4;
  while (p + 8 <= data.length) {
    const id = data.toString('latin1', p, p + 4);
    const size = data.readUInt32LE(p + 4);
    const end = p + 8 + size;
    if (end > data.length) break; // lenient: classification only, never blocks the file
    switch (id) {
      case 'IART': cats.add('author'); break;
      case 'ICRD': cats.add('time'); break;
      case 'ISFT': cats.add('software'); break;
      case 'INAM': case 'ICMT': cats.add('text'); break;
      default: cats.add('other');
    }
    p = end + (size % 2);
  }
  if (cats.size === 0) cats.add('other');
  return [...cats];
}

function checkHeader(buf, ctx, verb) {
  if (buf.length < 12) throw fail(ctx.name, 'the file is too small to hold a RIFF header');
  const magic = buf.toString('latin1', 0, 4);
  if (magic === 'RF64') {
    throw new ScrubError(
      `"${ctx.name}" is an RF64 WAV file, which the clean-room step ${verb}. Convert it to a standard WAV/RIFF file and publish again.`,
    );
  }
  if (magic !== 'RIFF') throw fail(ctx.name, 'missing the RIFF header');
  if (buf.toString('latin1', 8, 12) !== 'WAVE') throw fail(ctx.name, 'missing the WAVE header');
}

/**
 * @param {Buffer} buf
 * @param {{ name: string }} ctx
 * @returns {Promise<{ buffer: Buffer, removed: string[] }>}
 */
export async function scrub(buf, ctx) {
  checkHeader(buf, ctx, "can't rewrite");
  const chunks = readChunks(buf, ctx);
  const removed = new Set();
  const kept = [];
  let sawFmt = false;
  let sawData = false;
  for (const c of chunks) {
    if (KEEP.has(c.id)) {
      kept.push(c);
      if (c.id === 'fmt ') sawFmt = true;
      if (c.id === 'data') sawData = true;
      continue;
    }
    if (c.id === 'LIST') { for (const cat of classifyList(c.data)) removed.add(cat); continue; }
    removed.add('other');
  }
  if (!sawFmt || !sawData) throw fail(ctx.name, 'missing its "fmt " or "data" chunk');

  const parts = [Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WAVE', 'latin1')];
  for (const c of kept) {
    const header = Buffer.alloc(8);
    header.write(c.id, 0, 4, 'latin1');
    header.writeUInt32LE(c.data.length, 4);
    parts.push(header, c.data);
    if (c.data.length % 2) parts.push(Buffer.from([0]));
  }
  const buffer = Buffer.concat(parts);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  return { buffer, removed: [...removed] };
}

/** Categories still present. [] means clean. */
export async function inspect(buf, ctx) {
  checkHeader(buf, ctx, "can't check for hidden metadata");
  const chunks = readChunks(buf, ctx);
  const found = new Set();
  for (const c of chunks) {
    if (KEEP.has(c.id)) continue;
    if (c.id === 'LIST') { for (const cat of classifyList(c.data)) found.add(cat); continue; }
    found.add('other');
  }
  return [...found];
}
