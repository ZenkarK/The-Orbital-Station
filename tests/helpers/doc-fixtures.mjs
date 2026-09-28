/* =============================================================
   Fixture builders for the SVG/PDF clean-room scrub tests (PRIV-04)

   Every value here is fake: "Test Author", C:\Users\Test\... paths,
   0/0 coordinates. Nothing is read from, or written into, a real
   vault. Secret-like strings are never spelled out as one literal —
   these fixtures don't need that (paths and names aren't secrets),
   but see tests/obsidian/secrets.test.mjs for that convention.
   ============================================================= */
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

const N = (s) => PDFName.of(s);

/** The shape every "content must survive" fixture shares, so before/after can be compared. */
export const SHAPE_VIEWBOX = '0 0 100 100';
export const SHAPE_MARKUP =
  '<rect x="10" y="10" width="35" height="35" fill="#3366cc"/>' +
  '<circle cx="70" cy="70" r="20" fill="#cc3366"/>';

/**
 * An SVG carrying one instance of every category PRIV-04's SVG scrubber must
 * remove: an editor-stamped absolute path (sodipodi:docname,
 * inkscape:export-filename), Dublin Core author metadata, a generator
 * comment, a plain comment, and a script with an inline event handler. No
 * file:// link, so this one is expected to scrub cleanly.
 */
export function dirtySvg() {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
    '<!-- exported by a test fixture -->\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
    'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" ' +
    'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" ' +
    `viewBox="${SHAPE_VIEWBOX}" ` +
    'sodipodi:docname="C:\\Users\\Test\\drawing.svg" ' +
    'inkscape:export-filename="C:\\Users\\Test\\drawing.png">\n' +
    '  <title>A test drawing</title>\n' +
    '  <desc>Kept for accessibility</desc>\n' +
    '  <!-- just a plain remark, not a tool fingerprint -->\n' +
    '  <metadata>\n' +
    '    <rdf:RDF>\n' +
    '      <rdf:Description>\n' +
    '        <dc:creator><rdf:Bag><rdf:li>Test Author</rdf:li></rdf:Bag></dc:creator>\n' +
    '      </rdf:Description>\n' +
    '    </rdf:RDF>\n' +
    '  </metadata>\n' +
    "  <script>alert('hi')</script>\n" +
    `  ${SHAPE_MARKUP}\n` +
    '  <rect x="0" y="0" width="1" height="1" fill="none" onload="alert(1)"/>\n' +
    '</svg>\n'
  );
}

/** Same drawing, no hidden metadata at all — used to prove the scrubbed output renders the same. */
export function plainSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${SHAPE_VIEWBOX}">${SHAPE_MARKUP}</svg>`;
}

/** An SVG with a raster image embedded as a base64 data: URI. `mime` is only what the markup
 *  *declares* — svg.mjs must sniff the real format from the bytes themselves, so a test can pass a
 *  deliberately mismatched mime here to prove the declared type isn't trusted. */
export function svgWithEmbeddedImage(mime, bytes) {
  const b64 = Buffer.from(bytes).toString('base64');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${SHAPE_VIEWBOX}">` +
    `${SHAPE_MARKUP}` +
    `<image xlink:href="data:${mime};base64,${b64}" x="0" y="0" width="10" height="10"/>` +
    '</svg>'
  );
}

/** An SVG embedding another SVG (as SVGO/Inkscape produce for a nested vector asset) via a data: URI. */
export function svgWithEmbeddedSvg(innerSvgText) {
  const b64 = Buffer.from(innerSvgText, 'utf8').toString('base64');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${SHAPE_VIEWBOX}">` +
    `${SHAPE_MARKUP}` +
    `<image xlink:href="data:image/svg+xml;base64,${b64}" x="0" y="0" width="10" height="10"/>` +
    '</svg>'
  );
}

/** Same idea as svgWithEmbeddedImage(), but percent-encoded rather than base64 — every byte written out
 *  as its own %XX escape, so it also proves raw/binary bytes (not just text) survive the round trip. */
export function svgWithPercentEncodedImage(mime, bytes) {
  let pct = '';
  for (const b of bytes) pct += '%' + b.toString(16).padStart(2, '0');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${SHAPE_VIEWBOX}">` +
    `${SHAPE_MARKUP}` +
    `<image xlink:href="data:${mime},${pct}" x="0" y="0" width="10" height="10"/>` +
    '</svg>'
  );
}

/** An SVG embedding another SVG as a RAW (neither base64 nor percent-encoded) data: URI — the outer
 *  attribute is single-quoted so the inner SVG's own double-quoted attributes don't collide with it. */
export function svgWithRawEmbeddedSvg(innerSvgText) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${SHAPE_VIEWBOX}">` +
    `${SHAPE_MARKUP}` +
    `<image xlink:href='data:image/svg+xml,${innerSvgText}' x="0" y="0" width="10" height="10"/>` +
    '</svg>'
  );
}

/** Otherwise-clean SVG that still links to a file on the author's computer — must be blocked. */
export function svgWithFileLink() {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${SHAPE_VIEWBOX}">` +
    `${SHAPE_MARKUP}` +
    '<image xlink:href="file:///C:/Users/Test/pic.png" x="0" y="0" width="10" height="10"/>' +
    '</svg>'
  );
}

/** Malformed XML — must be blocked with a reason, not throw something other than ScrubError. */
export function corruptSvg() {
  return '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="10" height="10">';
}

// ---- PDF fixtures --------------------------------------------------------

/**
 * Build a PDFDocument with one page of real content plus Info fields, a
 * catalog XMP metadata stream, a /PieceInfo entry, and an orphaned old
 * /Info object left over from a simulated earlier revision (registered in
 * the context but never linked from the trailer's /Root — exactly what an
 * incremental update leaves behind). Callers add attachments / annotations
 * before saving.
 */
async function buildBasePdf() {
  const doc = await PDFDocument.create();
  doc.setAuthor('Test Author');
  doc.setCreator('Test Creator App');
  doc.setProducer('Test Producer App');
  doc.setTitle('Test Title');
  doc.setSubject('Test Subject');
  doc.setKeywords(['test', 'fixture']);

  const page = doc.addPage([100, 100]);
  page.drawRectangle({ x: 10, y: 10, width: 35, height: 35, color: { red: 0.2, green: 0.4, blue: 0.8, type: 'RGB' } });

  const { context } = doc;

  // Catalog XMP metadata stream (Word/Acrobat also store author/tool history here).
  const xmp =
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<dc:creator><rdf:Seq><rdf:li>Test Author</rdf:li></rdf:Seq></dc:creator>' +
    '</rdf:Description></rdf:RDF></x:xmpmeta>' +
    '<?xpacket end="w"?>';
  const xmpStream = context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' });
  const xmpRef = context.register(xmpStream);
  doc.catalog.set(N('Metadata'), xmpRef);

  // /PieceInfo: application-private data (e.g. an editor's own undo history).
  const pieceInfo = context.obj({ FakeApp: context.obj({ Private: PDFString.of('opaque') }) });
  doc.catalog.set(N('PieceInfo'), context.register(pieceInfo));

  // Orphaned Info object from a simulated earlier revision: registered, but
  // unreachable from /Root, so only garbage collection can catch it.
  const orphanInfo = context.obj({ Author: PDFString.of('Old Ghost Author') });
  context.register(orphanInfo);

  return { doc, context, page };
}

/** Info + XMP + PieceInfo + orphan, no attachment, no local-file link — must scrub cleanly. */
export async function dirtyPdf() {
  const { doc } = await buildBasePdf();
  return doc.save();
}

/** Same as dirtyPdf(), plus a Link annotation whose action opens a file on the author's computer. */
export async function pdfWithFileLink() {
  const { doc, context, page } = await buildBasePdf();
  const annot = context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [0, 0, 10, 10],
    A: { S: 'URI', URI: PDFString.of('file:///C:/Users/Test/notes.pdf') },
  });
  page.node.addAnnot(context.register(annot));
  return doc.save();
}

/** Same as dirtyPdf(), plus a Text ("sticky note") annotation carrying its own author, comment body
 *  and modified date — none of which the document's own /Info dictionary says anything about. */
export async function pdfWithAnnotationComment() {
  const { doc, context, page } = await buildBasePdf();
  const annot = context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [0, 0, 10, 10],
    T: PDFString.of('Test Reviewer'),
    Contents: PDFString.of('Call me at 555-0100, my SSN is 078-05-1120'),
    M: PDFString.of('D:20240101000000'),
  });
  page.node.addAnnot(context.register(annot));
  return doc.save();
}

/** Same as dirtyPdf(), plus a fillable text field whose entered value is a reader's own typed text. */
export async function pdfWithFormFieldValue() {
  const { doc, context, page } = await buildBasePdf();
  const field = context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    Rect: [0, 0, 10, 10],
    FT: 'Tx',
    T: PDFString.of('Name'),
    V: PDFString.of('Test Filled-In Value'),
  });
  const fieldRef = context.register(field);
  page.node.addAnnot(fieldRef);
  const acroForm = context.obj({ Fields: [fieldRef] });
  doc.catalog.set(N('AcroForm'), context.register(acroForm));
  return doc.save();
}

/** Same as dirtyPdf(), plus an embedded/attached file — pdf-lib can't verify it's clean, so it must block. */
export async function pdfWithEmbeddedFile() {
  const { doc } = await buildBasePdf();
  await doc.attach(Buffer.from('hello from a test fixture'), 'note.txt', { mimeType: 'text/plain' });
  return doc.save();
}

/**
 * A syntactically valid PDF whose trailer carries an /Encrypt entry, the
 * same signal pdf-lib itself uses to raise EncryptedPDFError. Building a
 * genuinely password-protected PDF is out of scope for pdf-lib (it can't
 * write one); this is enough to exercise the "encrypted → blocked" path.
 */
export async function encryptedPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([50, 50]);
  const { context } = doc;
  const fakeEncrypt = context.obj({ Filter: 'Standard', V: 1, R: 2, O: PDFString.of('o'), U: PDFString.of('u'), P: -44 });
  context.trailerInfo.Encrypt = context.register(fakeEncrypt);
  return doc.save({ useObjectStreams: false });
}

/** Truncated garbage — not a PDF at all. Must be blocked with a reason, not crash. */
export function corruptPdf() {
  return Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog', 'utf8');
}

/** A PDF with no /Info dictionary at all — what a real scrub should produce. inspect() must not flag it. */
export async function cleanPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([50, 50]);
  doc.context.trailerInfo.Info = undefined;
  return doc.save({ useObjectStreams: false });
}
