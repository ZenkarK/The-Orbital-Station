/* =============================================================
   Clean-room attachments (PRIV-04) — SVG and PDF scrubbers

   Exercises scripts/obsidian/scrub/svg.mjs and pdf.mjs directly, and
   end-to-end through index.mjs (which re-runs inspect() on a
   handler's own output plus a raw-byte residue scan — any leftover
   blocks the file). Every fixture is built at runtime from fake
   values only; see tests/helpers/doc-fixtures.mjs.
   ============================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PDFDocument, PDFArray, PDFStream } from 'pdf-lib';
import { scrub as svgScrub, inspect as svgInspect } from '../../scripts/obsidian/scrub/svg.mjs';
import { scrub as pdfScrub, inspect as pdfInspect } from '../../scripts/obsidian/scrub/pdf.mjs';
import { inspect as jpegInspect } from '../../scripts/obsidian/scrub/jpeg.mjs';
import { scrub as indexScrub, inspect as indexInspect, ScrubError } from '../../scripts/obsidian/scrub/index.mjs';
import * as fx from '../helpers/doc-fixtures.mjs';
import * as imgFx from '../helpers/image-fixtures.mjs';

// ---- SVG ------------------------------------------------------------------

test('svg scrub() removes every planted category and leaves nothing behind', async () => {
  const res = await svgScrub(Buffer.from(fx.dirtySvg(), 'utf8'), { name: 'drawing.svg' });
  assert.deepEqual([...res.removed].sort(), ['author', 'other', 'path', 'software', 'text'].sort());
  const left = await svgInspect(res.buffer, { name: 'drawing.svg' });
  assert.deepEqual(left, []);
});

test('svg scrub() output has no editor fingerprints, metadata, script or comments (independent check)', async () => {
  const res = await svgScrub(Buffer.from(fx.dirtySvg(), 'utf8'), { name: 'drawing.svg' });
  const text = res.buffer.toString('utf8');
  assert.ok(!/sodipodi|inkscape/i.test(text), 'editor namespace fingerprint survived');
  assert.ok(!/<metadata/i.test(text), 'metadata block survived');
  assert.ok(!/Test Author/.test(text), 'author name survived');
  assert.ok(!/<script/i.test(text), 'script element survived');
  assert.ok(!/\son\w+\s*=/i.test(text), 'event handler attribute survived');
  assert.ok(!/<!--/.test(text), 'comment survived');
  assert.ok(!/C:\\Users\\Test/.test(text), 'absolute path survived');
});

test('svg scrub() keeps title/desc for accessibility', async () => {
  const res = await svgScrub(Buffer.from(fx.dirtySvg(), 'utf8'), { name: 'drawing.svg' });
  const text = res.buffer.toString('utf8');
  assert.ok(/<title>A test drawing<\/title>/.test(text));
  assert.ok(/<desc>Kept for accessibility<\/desc>/.test(text));
});

test('svg scrub() does not change how the drawing renders (pixel-for-pixel)', async () => {
  const before = fx.dirtySvg();
  const res = await svgScrub(Buffer.from(before, 'utf8'), { name: 'drawing.svg' });
  const rasterBefore = await sharp(Buffer.from(before)).resize(64, 64).ensureAlpha().raw().toBuffer();
  const rasterAfter = await sharp(res.buffer).resize(64, 64).ensureAlpha().raw().toBuffer();
  assert.equal(Buffer.compare(rasterBefore, rasterAfter), 0);
});

test('svg with a file:// link is blocked, not silently stripped', async () => {
  await assert.rejects(
    () => svgScrub(Buffer.from(fx.svgWithFileLink(), 'utf8'), { name: 'link.svg' }),
    (e) => e instanceof ScrubError && /file on your computer/.test(e.message) && e.message.includes('link.svg'),
  );
});

test('corrupt svg is blocked with a reason, not a crash', async () => {
  await assert.rejects(
    () => svgScrub(Buffer.from(fx.corruptSvg(), 'utf8'), { name: 'bad.svg' }),
    (e) => e instanceof ScrubError && e.message.includes('bad.svg'),
  );
});

test('svg inspect() on a plain, already-clean svg reports nothing', async () => {
  const left = await svgInspect(Buffer.from(fx.plainSvg(), 'utf8'), { name: 'plain.svg' });
  assert.deepEqual(left, []);
});

test('svg inspect() on the dirty fixture (before scrubbing) reports categories present', async () => {
  const found = await svgInspect(Buffer.from(fx.dirtySvg(), 'utf8'), { name: 'drawing.svg' });
  assert.deepEqual([...found].sort(), ['author', 'other', 'path', 'software', 'text'].sort());
});

// ---- SVG: embedded raster images (data: URIs) ------------------------------

/** Pulls the base64 payload out of the first data: URI in an SVG's markup and decodes it. */
function firstEmbeddedBytes(svgText) {
  const m = /data:[^;,"']*;base64,([A-Za-z0-9+/=]+)/.exec(svgText);
  assert.ok(m, 'expected a data: URI in the SVG output');
  return Buffer.from(m[1], 'base64');
}

test('svg scrub() cleans a real, GPS-tagged JPEG embedded as a data: URI', async () => {
  const jpeg = await imgFx.jpegWithExif();
  const before = await sharp(jpeg).metadata();
  assert.ok(before.exif, 'fixture sanity check: the embedded JPEG should carry EXIF before scrubbing');

  const svg = fx.svgWithEmbeddedImage('image/jpeg', jpeg);
  const res = await svgScrub(Buffer.from(svg, 'utf8'), { name: 'photo.svg' });
  assert.ok(res.removed.length > 0, 'expected categories removed from the embedded image');

  const cleanedJpeg = firstEmbeddedBytes(res.buffer.toString('utf8'));
  assert.equal(cleanedJpeg.includes(Buffer.from('Test Author', 'latin1')), false, 'author name survived in the embedded image');
  const left = await jpegInspect(cleanedJpeg, { name: 'embedded.jpg' });
  assert.deepEqual(left, []);

  const left2 = await svgInspect(res.buffer, { name: 'photo.svg' });
  assert.deepEqual(left2, []);
});

test('svg scrub() sniffs the embedded image\'s real format instead of trusting a mismatched declared mime', async () => {
  const jpeg = await imgFx.jpegWithExif(); // real JPEG bytes, declared (falsely) as image/png below
  const svg = fx.svgWithEmbeddedImage('image/png', jpeg);
  const res = await svgScrub(Buffer.from(svg, 'utf8'), { name: 'mislabeled.svg' });
  assert.ok(res.removed.length > 0);
  const cleanedJpeg = firstEmbeddedBytes(res.buffer.toString('utf8'));
  assert.equal(cleanedJpeg.includes(Buffer.from('Test Author', 'latin1')), false);
  // the sniffed-and-cleaned format is written back with its real (jpeg) mime, not the false one
  assert.match(res.buffer.toString('utf8'), /data:image\/jpeg;base64,/);
});

test('svg scrub() keeps an embedded image with nothing to remove, unchanged', async () => {
  const jpeg = await imgFx.plainJpeg();
  const svg = fx.svgWithEmbeddedImage('image/jpeg', jpeg);
  const res = await svgScrub(Buffer.from(svg, 'utf8'), { name: 'plain-embed.svg' });
  const cleanedJpeg = firstEmbeddedBytes(res.buffer.toString('utf8'));
  assert.deepEqual(cleanedJpeg, jpeg);
});

test('svg with an embedded image in an unsupported/unparsable format is blocked, not silently passed through', async () => {
  const garbage = Buffer.from('not a real image, just some bytes pretending to be one');
  const svg = fx.svgWithEmbeddedImage('image/jpeg', garbage);
  await assert.rejects(
    () => svgScrub(Buffer.from(svg, 'utf8'), { name: 'bad-embed.svg' }),
    (e) => e instanceof ScrubError && e.message.includes('bad-embed.svg'),
  );
});

// ---- SVG: non-base64 data: URIs (percent-encoded and raw) -----------------

test('svg scrub() cleans a percent-encoded (non-base64) embedded JPEG data: URI', async () => {
  const jpeg = await imgFx.jpegWithExif();
  const before = await sharp(jpeg).metadata();
  assert.ok(before.exif, 'fixture sanity check: the embedded JPEG should carry EXIF before scrubbing');

  const svg = fx.svgWithPercentEncodedImage('image/jpeg', jpeg);
  const res = await svgScrub(Buffer.from(svg, 'utf8'), { name: 'percent.svg' });
  assert.ok(res.removed.length > 0, 'expected categories removed from the embedded image');

  const cleanedJpeg = firstEmbeddedBytes(res.buffer.toString('utf8'));
  assert.equal(cleanedJpeg.includes(Buffer.from('Test Author', 'latin1')), false, 'author name survived in the embedded image');
  const left = await jpegInspect(cleanedJpeg, { name: 'embedded.jpg' });
  assert.deepEqual(left, []);
  // re-encoded as base64 on the way back out, regardless of how it first arrived
  assert.match(res.buffer.toString('utf8'), /data:image\/jpeg;base64,/);

  const left2 = await svgInspect(res.buffer, { name: 'percent.svg' });
  assert.deepEqual(left2, []);
});

test('svg scrub() cleans a raw (unencoded) embedded SVG data: URI', async () => {
  const inner = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5"><rect width="5" height="5" fill="red"/><!-- exported by Test Author --></svg>';
  const svg = fx.svgWithRawEmbeddedSvg(inner);
  const res = await svgScrub(Buffer.from(svg, 'utf8'), { name: 'raw.svg' });
  assert.ok(res.removed.length > 0, 'expected the planted generator comment to be reported as removed');

  const text = res.buffer.toString('utf8');
  assert.ok(!/Test Author/.test(text), 'the raw embed\'s comment survived scrubbing');
  assert.match(text, /data:image\/svg\+xml;base64,/, 're-encoded as base64 on the way back out');

  const left = await svgInspect(res.buffer, { name: 'raw.svg' });
  assert.deepEqual(left, []);
});

test('svg inspect() reports categories for both a percent-encoded and a raw unscrubbed embed', async () => {
  const jpeg = await imgFx.jpegWithExif();
  const percentSvg = fx.svgWithPercentEncodedImage('image/jpeg', jpeg);
  const foundPercent = await svgInspect(Buffer.from(percentSvg, 'utf8'), { name: 'percent.svg' });
  assert.ok(foundPercent.length > 0, 'expected the unscrubbed percent-encoded embed\'s metadata to be reported');

  const inner = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5"><rect width="5" height="5" fill="red"/><!-- exported by Test Author --></svg>';
  const rawSvg = fx.svgWithRawEmbeddedSvg(inner);
  const foundRaw = await svgInspect(Buffer.from(rawSvg, 'utf8'), { name: 'raw.svg' });
  assert.ok(foundRaw.length > 0, 'expected the unscrubbed raw embed\'s generator comment to be reported');
});

test('svg with a non-base64 embedded image in an unrecognisable format is blocked, not silently passed through', async () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
    '<image href="data:application/octet-stream,%00%01%02%03" x="0" y="0" width="10" height="10"/>' +
    '</svg>';
  await assert.rejects(
    () => svgScrub(Buffer.from(svg, 'utf8'), { name: 'bad-plain-embed.svg' }),
    (e) => e instanceof ScrubError && e.message.includes('bad-plain-embed.svg'),
  );
});

test('svg with a nested SVG embed is recursed into, and its own dirty metadata is removed', async () => {
  const inner = fx.dirtySvg().replace('C:\\Users\\Test\\drawing.svg', 'C:\\Users\\Test\\other.svg').replace('C:\\Users\\Test\\drawing.png', 'C:\\Users\\Test\\other.png');
  const outer = fx.svgWithEmbeddedSvg(inner);
  const res = await svgScrub(Buffer.from(outer, 'utf8'), { name: 'nested.svg' });
  assert.ok(res.removed.length > 0);
  const innerCleaned = firstEmbeddedBytes(res.buffer.toString('utf8')).toString('utf8');
  assert.ok(!/Test Author/.test(innerCleaned), 'nested svg author name survived');
  assert.ok(!/sodipodi|inkscape/i.test(innerCleaned), 'nested svg editor fingerprint survived');
  const left = await svgInspect(res.buffer, { name: 'nested.svg' });
  assert.deepEqual(left, []);
});

test('svg with a nested SVG that still links to a local file is blocked, not silently passed through', async () => {
  const outer = fx.svgWithEmbeddedSvg(fx.svgWithFileLink());
  await assert.rejects(
    () => svgScrub(Buffer.from(outer, 'utf8'), { name: 'nested-link.svg' }),
    (e) => e instanceof ScrubError && e.message.includes('nested-link.svg'),
  );
});

test('svg inspect() reports categories for an unscrubbed embedded image without throwing', async () => {
  const jpeg = await imgFx.jpegWithExif();
  const svg = fx.svgWithEmbeddedImage('image/jpeg', jpeg);
  const found = await svgInspect(Buffer.from(svg, 'utf8'), { name: 'photo.svg' });
  assert.ok(found.length > 0, 'expected the unscrubbed embedded JPEG\'s metadata to be reported');
});

// ---- PDF --------------------------------------------------------------

/** Raw (possibly still-encoded) content-stream bytes for every page, in order. */
function pageContentBytes(doc) {
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    if (contents instanceof PDFStream) return Buffer.from(contents.getContents());
    if (contents instanceof PDFArray) {
      return Buffer.concat(
        contents.asArray().map((ref) => Buffer.from(doc.context.lookup(ref, PDFStream).getContents())),
      );
    }
    throw new Error('unexpected /Contents shape in test fixture');
  });
}

test('pdf scrub() removes every planted category and leaves nothing behind', async () => {
  const bytes = await fx.dirtyPdf();
  const res = await pdfScrub(Buffer.from(bytes), { name: 'dirty.pdf' });
  assert.deepEqual([...res.removed].sort(), ['author', 'other', 'software', 'text', 'time'].sort());
  const left = await pdfInspect(res.buffer, { name: 'dirty.pdf' });
  assert.deepEqual(left, []);
});

test('pdf scrub() output has no author/XMP/local-path strings left (independent check)', async () => {
  const bytes = await fx.dirtyPdf();
  const res = await pdfScrub(Buffer.from(bytes), { name: 'dirty.pdf' });

  // independent check #1: grep the raw saved bytes
  const raw = res.buffer.toString('latin1');
  assert.ok(!raw.includes('/Author'), '/Author key survived in raw bytes');
  assert.ok(!raw.includes('<x:xmpmeta'), 'XMP packet survived in raw bytes');
  assert.ok(!raw.includes('file://'), 'a file:// link survived in raw bytes');
  assert.ok(!raw.includes('Test Author'), 'author name survived in raw bytes');
  assert.ok(!raw.includes('Old Ghost Author'), 'orphaned old Info object survived garbage collection');

  // independent check #2: reload with a fresh pdf-lib document
  const reloaded = await PDFDocument.load(res.buffer, { updateMetadata: false });
  assert.equal(reloaded.getAuthor(), undefined);
  assert.equal(reloaded.getProducer(), undefined);
  assert.equal(reloaded.getTitle(), undefined);
});

test('pdf scrub() keeps the page count and page content streams unchanged', async () => {
  const bytes = await fx.dirtyPdf();
  const before = await PDFDocument.load(bytes, { updateMetadata: false });
  const res = await pdfScrub(Buffer.from(bytes), { name: 'dirty.pdf' });
  const after = await PDFDocument.load(res.buffer, { updateMetadata: false });

  assert.equal(after.getPageCount(), before.getPageCount());
  const beforeStreams = pageContentBytes(before);
  const afterStreams = pageContentBytes(after);
  assert.equal(afterStreams.length, beforeStreams.length);
  for (let i = 0; i < beforeStreams.length; i++) {
    assert.equal(Buffer.compare(beforeStreams[i], afterStreams[i]), 0, `page ${i} content stream changed`);
  }
});

test('pdf with a file:// link annotation is blocked, not silently stripped', async () => {
  const bytes = await fx.pdfWithFileLink();
  await assert.rejects(
    () => pdfScrub(Buffer.from(bytes), { name: 'link.pdf' }),
    (e) => e instanceof ScrubError && /file on your computer/.test(e.message) && e.message.includes('link.pdf'),
  );
});

test('pdf annotation author/comment/mod-date are removed and leave nothing behind', async () => {
  const bytes = await fx.pdfWithAnnotationComment();
  const res = await pdfScrub(Buffer.from(bytes), { name: 'comment.pdf' });
  assert.ok(res.removed.includes('author'), `expected 'author' in ${JSON.stringify(res.removed)}`);
  assert.ok(res.removed.includes('text'), `expected 'text' in ${JSON.stringify(res.removed)}`);
  assert.ok(res.removed.includes('time'), `expected 'time' in ${JSON.stringify(res.removed)}`);
  const left = await pdfInspect(res.buffer, { name: 'comment.pdf' });
  assert.deepEqual(left, []);

  const raw = res.buffer.toString('latin1');
  assert.ok(!raw.includes('Test Reviewer'), 'annotation author name survived in raw bytes');
  assert.ok(!raw.includes('555-0100'), 'annotation comment text survived in raw bytes');
  assert.ok(!raw.includes('078-05-1120'), 'annotation comment text survived in raw bytes');
});

test('pdf form field value is removed and leaves nothing behind', async () => {
  const bytes = await fx.pdfWithFormFieldValue();
  const res = await pdfScrub(Buffer.from(bytes), { name: 'form.pdf' });
  assert.ok(res.removed.includes('other'), `expected 'other' in ${JSON.stringify(res.removed)}`);
  const left = await pdfInspect(res.buffer, { name: 'form.pdf' });
  assert.deepEqual(left, []);
  const raw = res.buffer.toString('latin1');
  assert.ok(!raw.includes('Test Filled-In Value'), 'form field value survived in raw bytes');
});

test('pdf with an embedded/attached file is blocked (pdf-lib cannot verify it)', async () => {
  const bytes = await fx.pdfWithEmbeddedFile();
  await assert.rejects(
    () => pdfScrub(Buffer.from(bytes), { name: 'attach.pdf' }),
    (e) => e instanceof ScrubError && /embedded or attached file/.test(e.message) && e.message.includes('attach.pdf'),
  );
});

test('encrypted pdf is blocked with a password-protected message', async () => {
  const bytes = await fx.encryptedPdf();
  await assert.rejects(
    () => pdfScrub(Buffer.from(bytes), { name: 'enc.pdf' }),
    (e) => e instanceof ScrubError && /password-protected/.test(e.message) && e.message.includes('enc.pdf'),
  );
});

test('corrupt pdf is blocked with a reason, not a crash', async () => {
  await assert.rejects(
    () => pdfScrub(fx.corruptPdf(), { name: 'bad.pdf' }),
    (e) => e instanceof ScrubError && e.message.includes('bad.pdf'),
  );
});

test('pdf inspect() does not flag a pdf that is already clean', async () => {
  const bytes = await fx.cleanPdf();
  const left = await pdfInspect(Buffer.from(bytes), { name: 'clean.pdf' });
  assert.deepEqual(left, []);
});

test('pdf inspect() on the dirty fixture (before scrubbing) reports categories present', async () => {
  const bytes = await fx.dirtyPdf();
  const found = await pdfInspect(Buffer.from(bytes), { name: 'dirty.pdf' });
  assert.deepEqual([...found].sort(), ['author', 'other', 'software', 'text', 'time'].sort());
});

test('pdf inspect() on an unscrubbed annotation comment reports author/text/time', async () => {
  const bytes = await fx.pdfWithAnnotationComment();
  const found = await pdfInspect(Buffer.from(bytes), { name: 'comment.pdf' });
  for (const cat of ['author', 'text', 'time']) {
    assert.ok(found.includes(cat), `expected '${cat}' in ${JSON.stringify(found)}`);
  }
});

// ---- end-to-end through index.mjs -----------------------------------------

test('end-to-end: index.mjs scrub() cleans a dirty svg and its own inspect() re-check passes', async () => {
  const res = await indexScrub(Buffer.from(fx.dirtySvg(), 'utf8'), { name: 'drawing.svg' });
  assert.equal(res.ok, true);
  assert.equal(res.kind, 'scrubbed');
  assert.ok(res.removed.length > 0);
  const insp = await indexInspect(res.buffer, { name: 'drawing.svg' });
  assert.deepEqual(insp, { ok: true, kind: 'binary', categories: [] });
});

test('end-to-end: index.mjs scrub() cleans a dirty pdf and its own inspect() re-check passes', async () => {
  const bytes = await fx.dirtyPdf();
  const res = await indexScrub(Buffer.from(bytes), { name: 'dirty.pdf' });
  assert.equal(res.ok, true);
  assert.equal(res.kind, 'scrubbed');
  assert.ok(res.removed.length > 0);
  const insp = await indexInspect(res.buffer, { name: 'dirty.pdf' });
  assert.deepEqual(insp, { ok: true, kind: 'binary', categories: [] });
});

test('end-to-end: index.mjs scrub() blocks a local-file-linked svg with a reason', async () => {
  const res = await indexScrub(Buffer.from(fx.svgWithFileLink(), 'utf8'), { name: 'link.svg' });
  assert.equal(res.ok, false);
  assert.ok(/file on your computer/.test(res.reason));
});

test('end-to-end: index.mjs scrub() blocks an encrypted pdf with a reason', async () => {
  const bytes = await fx.encryptedPdf();
  const res = await indexScrub(Buffer.from(bytes), { name: 'enc.pdf' });
  assert.equal(res.ok, false);
  assert.ok(/password-protected/.test(res.reason));
});

test('end-to-end: allowMetadata passes a blocked svg through unscrubbed rather than failing', async () => {
  const res = await indexScrub(Buffer.from(fx.svgWithFileLink(), 'utf8'), { name: 'link.svg', allowMetadata: true });
  assert.equal(res.ok, true);
  assert.equal(res.kind, 'unscrubbed');
  assert.ok(res.reason);
});
