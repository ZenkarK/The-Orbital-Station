/* A minimal PDF text reader for tests — pdf-lib can build and load PDFs but
   has no text-extraction API of its own, and cv.pdf.ts draws with a standard
   (non-embedded) font, whose text always comes out as hex-encoded WinAnsi
   character codes inside a Flate-compressed content stream (verified against
   pdf-lib's own source: StandardFontEmbedder.encodeText always returns a
   PDFHexString, and PDFContentStream always compresses unless told not to —
   there's no public option to turn that off on PDFPage.drawText). So: find
   every `stream…endstream` block (content streams and, when useObjectStreams
   is on, the compressed object streams holding the Info dict), inflate each,
   pull out every `<hex>` string literal, and decode it back to characters.
   Decoded fragments are joined with a single space, because pdf-lib emits
   one Tj per wrapped line and a line break was always a space in the source
   text — so callers should compare against whitespace-normalized text. */
import zlib from 'node:zlib';

/** All `<...>` hex-string literals inside every stream in `buf`, decoded and
    space-joined. Covers content-stream text and (incidentally) metadata
    strings too — harmless for a substring search, since real content only
    ever needs to be found, not the whole document reconstructed exactly. */
export function extractPdfText(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const chunks = [];
  let pos = 0;
  while (true) {
    const streamIdx = bytes.indexOf('stream', pos);
    if (streamIdx === -1) break;
    let dataStart = streamIdx + 'stream'.length;
    if (bytes[dataStart] === 0x0d) dataStart++;
    if (bytes[dataStart] === 0x0a) dataStart++;
    const endIdx = bytes.indexOf('endstream', dataStart);
    if (endIdx === -1) break;
    let dataEnd = endIdx;
    while (dataEnd > dataStart && (bytes[dataEnd - 1] === 0x0a || bytes[dataEnd - 1] === 0x0d)) dataEnd--;
    const raw = bytes.subarray(dataStart, dataEnd);
    try {
      chunks.push(zlib.inflateSync(raw).toString('latin1'));
    } catch {
      // Not a Flate stream (or not one at all) — skip it, nothing else in
      // this document is worth reading as text.
    }
    pos = endIdx + 'endstream'.length;
  }
  const content = chunks.join('\n');
  const hexStrings = [...content.matchAll(/<([0-9A-Fa-f\s]+)>/g)];
  return hexStrings.map((m) => Buffer.from(m[1].replace(/\s+/g, ''), 'hex').toString('latin1')).join(' ');
}

/** Case-sensitive, whitespace-insensitive substring check against extracted PDF text. */
export function pdfContains(buf, text) {
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  return norm(extractPdfText(buf)).includes(norm(text));
}
