// Clean-room attachments (PRIV-04) — raster image scrubbers: JPEG, PNG, GIF, WebP, AVIF, TIFF.
// Every case runs end-to-end through scrub()/inspect() in scripts/obsidian/scrub/index.mjs, the same
// entry point the publisher uses, so a handler bug and a registration bug would both be caught here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { scrub, inspect, isText } from '../../scripts/obsidian/scrub/index.mjs';
import * as F from '../helpers/image-fixtures.mjs';

/** Decoded pixels, ignoring any EXIF orientation (raw() reads the buffer as stored either way). */
async function rawPixels(buf) {
  return sharp(buf).raw().toBuffer();
}

/** scrub()s buf, then checks it two ways: our own inspect() and an independent oracle, sharp's own
 *  metadata reader. Returns the scrub result so the caller can also check `removed`/`kind`. */
async function scrubAndVerifyClean(buf, name) {
  const res = await scrub(buf, { name });
  assert.equal(res.ok, true, res.reason);
  const left = await inspect(res.buffer, { name });
  assert.deepEqual(left.categories, [], `our own inspect() still finds: ${left.categories}`);
  const oracle = await sharp(res.buffer).metadata();
  assert.equal(!!oracle.iptc, false, 'oracle still finds IPTC');
  assert.equal(!!oracle.xmp, false, 'oracle still finds XMP');
  return { res, oracle };
}

describe('JPEG', () => {
  test('camera EXIF (author, device, software, GPS) is removed; Orientation 6 survives; pixels unchanged', async () => {
    const buf = await F.jpegWithExif({ orientation: 6 });
    const { res, oracle } = await scrubAndVerifyClean(buf, 'photo.jpg');
    assert.equal(res.kind, 'scrubbed');
    for (const label of ['location (GPS)', 'author and owner names', 'camera and device details', 'software and edit history']) {
      assert.ok(res.removed.includes(label), `expected "${label}" in ${JSON.stringify(res.removed)}`);
    }
    assert.equal(oracle.orientation, 6, 'orientation tag should survive as a fresh, minimal APP1');
    assert.deepEqual(await rawPixels(res.buffer), await rawPixels(buf));
  });

  test('an EXIF Orientation of 1 (the common case) writes back no APP1 at all', async () => {
    const buf = await F.jpegWithExif({ orientation: 1 });
    const res = await scrub(buf, { name: 'upright.jpg' });
    assert.equal(res.ok, true);
    const meta = await sharp(res.buffer).metadata();
    assert.equal(!!meta.exif, false);
  });

  test('COM, Photoshop/IPTC APP13, MPF-style APP2 and bytes after EOI are removed; pixels unchanged', async () => {
    const buf = await F.jpegWithLegacyMetadata();
    const { res } = await scrubAndVerifyClean(buf, 'legacy.jpg');
    assert.equal(res.kind, 'scrubbed');
    assert.ok(res.removed.includes('embedded titles, comments and descriptions')); // COM + APP13
    assert.ok(res.removed.includes('author and owner names')); // APP13 (IPTC)
    assert.ok(res.removed.includes('other embedded metadata')); // APP2 MPF
    assert.ok(res.removed.includes('data hidden after the end of the file')); // the fake trailer
    const clean = await F.plainJpeg();
    assert.deepEqual(await rawPixels(res.buffer), await rawPixels(clean));
  });

  test('a clean JPEG comes back reported as clean, not scrubbed', async () => {
    const buf = await F.plainJpeg();
    const res = await scrub(buf, { name: 'plain.jpg' });
    assert.equal(res.ok, true);
    assert.equal(res.kind, 'clean');
    assert.deepEqual(res.removed, []);
  });

  test('a truncated JPEG is blocked with a readable reason, not thrown or crashed', async () => {
    const buf = (await F.plainJpeg()).subarray(0, 40);
    const res = await scrub(buf, { name: 'broken.jpg' });
    assert.equal(res.ok, false);
    assert.match(res.reason, /broken\.jpg/);
  });

  test('a JFIF thumbnail (raw RGB pixels embedded in APP0) is dropped, not kept verbatim', async () => {
    const THUMB_PIXELS = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe]); // 2x1 fake "thumbnail" RGB pixels
    const seg = F.jfifSegmentWithThumbnail(2, 1, THUMB_PIXELS);
    const base = await F.plainJpeg();
    const buf = F.insertJpegSegments(base, seg);

    const res = await scrub(buf, { name: 'cropped.jpg' });
    assert.equal(res.ok, true, res.reason);
    assert.ok(res.removed.includes('embedded thumbnails and previews'), `expected a thumbnail category in ${JSON.stringify(res.removed)}`);
    assert.equal(res.buffer.includes(THUMB_PIXELS), false, 'the thumbnail pixel data survived scrubbing');

    const left = await inspect(res.buffer, { name: 'cropped.jpg' });
    assert.deepEqual(left.categories, []);
  });

  test('a standard-named ICC profile (APP2) is kept, not dropped', async () => {
    const seg = F.jpegIccSegment(F.buildIccProfile(F.STANDARD_ICC_NAME));
    const buf = F.insertJpegSegments(await F.plainJpeg(), seg);
    const res = await scrub(buf, { name: 'srgb.jpg' });
    assert.equal(res.ok, true, res.reason);
    assert.deepEqual(res.removed, []);
    assert.ok(res.buffer.includes(Buffer.from('ICC_PROFILE\0', 'latin1')));
  });

  test('an ICC profile (APP2) named after a device is kept, its text blanked rather than the profile dropped', async () => {
    const seg = F.jpegIccSegment(F.buildIccProfile("Karzen Ho's MacBook Pro Display"));
    const buf = F.insertJpegSegments(await F.plainJpeg(), seg);
    const res = await scrub(buf, { name: 'device-icc.jpg' });
    assert.equal(res.ok, true, res.reason);
    assert.ok(res.removed.includes('camera and device details'), `expected device category in ${JSON.stringify(res.removed)}`);
    assert.ok(res.buffer.includes(Buffer.from('ICC_PROFILE\0', 'latin1')), 'the profile should survive, neutralised, not be dropped');
    assert.equal(res.buffer.includes(Buffer.from('MacBook', 'latin1')), false, 'the device name survived scrubbing');
    const left = await inspect(res.buffer, { name: 'device-icc.jpg' });
    assert.deepEqual(left.categories, []);
  });

  test('a corrupt/unparsable ICC profile (APP2) blocks the whole file rather than being silently kept or dropped', async () => {
    const seg = F.jpegIccSegment(Buffer.from([0, 1, 2, 3]));
    const buf = F.insertJpegSegments(await F.plainJpeg(), seg);
    const res = await scrub(buf, { name: 'bad-icc.jpg' });
    assert.equal(res.ok, false);
    assert.match(res.reason, /bad-icc\.jpg/);
  });

  test('a JFIF APP0 with a zero-size thumbnail (the common case) is kept verbatim', async () => {
    const buf = await F.plainJpeg();
    const res = await scrub(buf, { name: 'plain.jpg' });
    assert.equal(res.ok, true);
    assert.deepEqual(res.removed, []);
  });
});

describe('PNG', () => {
  test('camera EXIF (author, device, software, GPS) is removed via the eXIf chunk; pixels unchanged', async () => {
    const buf = await F.pngWithExif();
    const { res } = await scrubAndVerifyClean(buf, 'photo.png');
    assert.equal(res.kind, 'scrubbed');
    for (const label of ['location (GPS)', 'author and owner names', 'camera and device details', 'software and edit history']) {
      assert.ok(res.removed.includes(label), `expected "${label}" in ${JSON.stringify(res.removed)}`);
    }
    assert.deepEqual(await rawPixels(res.buffer), await rawPixels(buf));
  });

  test('tEXt comment, tIME and bytes after IEND are removed; pixels unchanged', async () => {
    const buf = await F.pngWithLegacyMetadata();
    const { res } = await scrubAndVerifyClean(buf, 'legacy.png');
    assert.equal(res.kind, 'scrubbed');
    assert.ok(res.removed.includes('embedded titles, comments and descriptions')); // tEXt Comment
    assert.ok(res.removed.includes('capture and edit times')); // tIME
    assert.ok(res.removed.includes('data hidden after the end of the file'));
    const clean = await F.plainPng();
    assert.deepEqual(await rawPixels(res.buffer), await rawPixels(clean));
  });

  test('an iCCP chunk with a standard name and profile is kept, not dropped', async () => {
    const chunk = F.pngIccChunk(F.STANDARD_ICC_NAME, F.buildIccProfile(F.STANDARD_ICC_NAME));
    const buf = F.insertPngChunks(await F.plainPng(), chunk);
    const res = await scrub(buf, { name: 'srgb.png' });
    assert.equal(res.ok, true, res.reason);
    assert.deepEqual(res.removed, []);
    assert.ok(res.buffer.includes(Buffer.from('iCCP', 'latin1')));
  });

  test('an iCCP chunk whose cleartext profile-name field names a person/device is kept, renamed to a neutral placeholder', async () => {
    // The name field alone carries the leak here; the compressed profile body is standard.
    const chunk = F.pngIccChunk('sRGB Karzen', F.buildIccProfile(F.STANDARD_ICC_NAME));
    const buf = F.insertPngChunks(await F.plainPng(), chunk);
    const res = await scrub(buf, { name: 'named-icc.png' });
    assert.equal(res.ok, true, res.reason);
    assert.ok(res.removed.includes('camera and device details'), `expected device category in ${JSON.stringify(res.removed)}`);
    assert.ok(res.buffer.includes(Buffer.from('iCCP', 'latin1')), 'the profile should survive, neutralised, not be dropped');
    assert.equal(res.buffer.includes(Buffer.from('Karzen', 'latin1')), false, 'the profile name survived scrubbing');
    const left = await inspect(res.buffer, { name: 'named-icc.png' });
    assert.deepEqual(left.categories, []);
  });

  test('an iCCP chunk whose profile body names a device (standard name field) is kept, its text blanked', async () => {
    const chunk = F.pngIccChunk(F.STANDARD_ICC_NAME, F.buildIccProfile("Karzen Ho's MacBook Pro Display"));
    const buf = F.insertPngChunks(await F.plainPng(), chunk);
    const res = await scrub(buf, { name: 'named-icc2.png' });
    assert.equal(res.ok, true, res.reason);
    assert.ok(res.removed.includes('camera and device details'));
    assert.ok(res.buffer.includes(Buffer.from('iCCP', 'latin1')), 'the profile should survive, neutralised, not be dropped');
    assert.equal(res.buffer.includes(Buffer.from('MacBook', 'latin1')), false, 'the device name survived scrubbing');
  });

  test('a corrupt/unparsable iCCP profile blocks the whole file rather than being silently kept or dropped', async () => {
    const chunk = F.pngIccChunk(F.STANDARD_ICC_NAME, Buffer.from([0, 1, 2, 3]));
    const buf = F.insertPngChunks(await F.plainPng(), chunk);
    const res = await scrub(buf, { name: 'bad-icc.png' });
    assert.equal(res.ok, false);
    assert.match(res.reason, /bad-icc\.png/);
  });

  test('an unrecognised critical chunk blocks the file instead of silently dropping it', async () => {
    const base = await F.plainPng();
    const weird = F.pngChunk('zzZZ'.toUpperCase(), Buffer.from([1])); // uppercase first letter = critical
    const bad = F.insertPngChunks(base, weird);
    const res = await scrub(bad, { name: 'weird.png' });
    assert.equal(res.ok, false);
    assert.match(res.reason, /weird\.png/);
  });

  test('a truncated PNG is blocked with a readable reason', async () => {
    const buf = (await F.plainPng()).subarray(0, 20);
    const res = await scrub(buf, { name: 'broken.png' });
    assert.equal(res.ok, false);
    assert.match(res.reason, /broken\.png/);
  });
});

describe('GIF', () => {
  test('a comment extension and an XMP application extension are removed; pixels unchanged', async () => {
    const buf = await F.gifWithLegacyMetadata();
    const { res } = await scrubAndVerifyClean(buf, 'legacy.gif');
    assert.equal(res.kind, 'scrubbed');
    assert.ok(res.removed.includes('embedded titles, comments and descriptions')); // comment extension
    assert.ok(res.removed.includes('other embedded metadata')); // XMP DataXMP application extension
    const clean = await F.plainGif();
    assert.deepEqual(await rawPixels(res.buffer), await rawPixels(clean));
  });

  test('a NETSCAPE2.0 loop application extension is kept, not dropped', async () => {
    const buf = await F.gifWithLoopExtension();
    const res = await scrub(buf, { name: 'loop.gif' });
    assert.equal(res.ok, true);
    assert.equal(res.kind, 'clean');
    assert.deepEqual(res.removed, []);
    assert.ok(res.buffer.includes(Buffer.from('NETSCAPE2.0', 'latin1')), 'the loop extension should survive byte-for-byte');
  });

  test('an ICCRGBG1 extension carrying a standard ICC profile is kept, not dropped', async () => {
    const base = await F.plainGif();
    const iccExt = F.gifApplicationExtension('ICCRGBG1012', F.buildIccProfile(F.STANDARD_ICC_NAME));
    const buf = F.insertGifBlocks(base, iccExt);
    const res = await scrub(buf, { name: 'icc.gif' });
    assert.equal(res.ok, true, res.reason);
    assert.deepEqual(res.removed, []);
    assert.ok(res.buffer.includes(Buffer.from('ICCRGBG1', 'latin1')));
  });

  test('an ICCRGBG1 extension carrying a non-standard (device-named) ICC profile is kept, its text blanked', async () => {
    const base = await F.plainGif();
    const iccExt = F.gifApplicationExtension('ICCRGBG1012', F.buildIccProfile("Karzen Ho's MacBook Pro Display"));
    const buf = F.insertGifBlocks(base, iccExt);
    const res = await scrub(buf, { name: 'icc-device.gif' });
    assert.equal(res.ok, true, res.reason);
    assert.ok(res.removed.includes('camera and device details'), `expected device category in ${JSON.stringify(res.removed)}`);
    assert.ok(res.buffer.includes(Buffer.from('ICCRGBG1', 'latin1')), 'the ICC extension should survive, neutralised, not be dropped');
    assert.equal(res.buffer.includes(Buffer.from('MacBook', 'latin1')), false, 'the device name survived scrubbing');
    const left = await inspect(res.buffer, { name: 'icc-device.gif' });
    assert.deepEqual(left.categories, []);
  });

  test('an ICCRGBG1 extension whose payload is not a parsable ICC profile blocks the whole file (fail closed)', async () => {
    const base = await F.plainGif();
    const iccExt = F.gifApplicationExtension('ICCRGBG1012', Buffer.from([0, 1, 2, 3]));
    const buf = F.insertGifBlocks(base, iccExt);
    const res = await scrub(buf, { name: 'icc-garbage.gif' });
    assert.equal(res.ok, false, 'an unparsable ICC profile must block the file, not silently keep or drop it');
    assert.match(res.reason, /icc-garbage\.gif/);
  });

  test('a truncated GIF is blocked with a readable reason', async () => {
    const buf = (await F.plainGif()).subarray(0, 10);
    const res = await scrub(buf, { name: 'broken.gif' });
    assert.equal(res.ok, false);
    assert.match(res.reason, /broken\.gif/);
  });

  test('a Plain Text Extension is dropped, not kept as if it were display-affecting', async () => {
    const base = await F.plainGif();
    const buf = F.insertGifBlocks(base, F.gifPlainTextExtension('Property of Test Author, 123 Main St'));
    const res = await scrub(buf, { name: 'plaintext.gif' });
    assert.equal(res.ok, true, res.reason);
    assert.ok(res.removed.includes('embedded titles, comments and descriptions'), `expected text in ${JSON.stringify(res.removed)}`);
    assert.equal(res.buffer.includes(Buffer.from('Test Author', 'latin1')), false, 'plain-text extension text survived scrubbing');
    const left = await inspect(res.buffer, { name: 'plaintext.gif' });
    assert.deepEqual(left.categories, []);
    const clean = await F.plainGif();
    assert.deepEqual(await rawPixels(res.buffer), await rawPixels(clean));
  });
});

describe('WebP', () => {
  test('EXIF and XMP chunks are removed and the VP8X flag bits are cleared; pixels unchanged', async () => {
    const buf = await F.webpWithExifAndXmp();
    const { res } = await scrubAndVerifyClean(buf, 'photo.webp');
    assert.equal(res.kind, 'scrubbed');
    assert.ok(res.removed.includes('author and owner names')); // EXIF Artist
    assert.ok(res.removed.includes('other embedded metadata')); // XMP

    const flags = vp8xFlags(res.buffer);
    assert.ok(flags !== null, 'expected a VP8X chunk in the output');
    assert.equal(flags & 0x08, 0, 'EXIF flag bit should be cleared');
    assert.equal(flags & 0x04, 0, 'XMP flag bit should be cleared');

    const clean = await F.plainWebp();
    assert.deepEqual(await rawPixels(res.buffer), await rawPixels(clean));
  });

  test('hand-built EXIF/XMP chunks (no VP8X in the source) are removed too', async () => {
    const buf = await F.webpWithLegacyMetadata();
    const { res } = await scrubAndVerifyClean(buf, 'legacy.webp');
    assert.equal(res.kind, 'scrubbed');
    assert.ok(res.removed.includes('author and owner names'));
    assert.ok(res.removed.includes('other embedded metadata'));
  });

  test('an ICCP chunk with a standard profile is kept, not dropped', async () => {
    const base = await F.plainWebp();
    const buf = F.appendWebpChunks(base, F.riffChunk('ICCP', F.buildIccProfile(F.STANDARD_ICC_NAME)));
    const res = await scrub(buf, { name: 'srgb.webp' });
    assert.equal(res.ok, true, res.reason);
    assert.deepEqual(res.removed, []);
    assert.ok(res.buffer.includes(Buffer.from('ICCP', 'latin1')));
  });

  test('an ICCP chunk naming a device is kept, its text blanked rather than the profile dropped', async () => {
    const base = await F.plainWebp();
    const buf = F.appendWebpChunks(base, F.riffChunk('ICCP', F.buildIccProfile("Karzen Ho's MacBook Pro Display")));
    const res = await scrub(buf, { name: 'device-icc.webp' });
    assert.equal(res.ok, true, res.reason);
    assert.ok(res.removed.includes('camera and device details'), `expected device category in ${JSON.stringify(res.removed)}`);
    assert.ok(res.buffer.includes(Buffer.from('ICCP', 'latin1')), 'the profile should survive, neutralised, not be dropped');
    assert.equal(res.buffer.includes(Buffer.from('MacBook', 'latin1')), false, 'the device name survived scrubbing');
    const left = await inspect(res.buffer, { name: 'device-icc.webp' });
    assert.deepEqual(left.categories, []);
  });

  test('a corrupt/unparsable ICCP profile blocks the whole file rather than being silently kept or dropped', async () => {
    const base = await F.plainWebp();
    const buf = F.appendWebpChunks(base, F.riffChunk('ICCP', Buffer.from([0, 1, 2, 3])));
    const res = await scrub(buf, { name: 'bad-icc.webp' });
    assert.equal(res.ok, false);
    assert.match(res.reason, /bad-icc\.webp/);
  });

  test('a truncated WebP is blocked with a readable reason', async () => {
    const buf = (await F.plainWebp()).subarray(0, 16);
    const res = await scrub(buf, { name: 'broken.webp' });
    assert.equal(res.ok, false);
    assert.match(res.reason, /broken\.webp/);
  });
});

/** The flags byte (first byte of the 10-byte payload) of a WebP's VP8X chunk, or null if there isn't one. */
function vp8xFlags(buf) {
  let p = 12;
  while (p + 8 <= buf.length) {
    const fourCC = buf.toString('latin1', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (fourCC === 'VP8X') return buf[p + 8];
    p += 8 + size + (size % 2);
  }
  return null;
}

describe('ICC colour profile neutralisation (PRIV-04 regression: keep every profile, never drop one)', () => {
  /** Colour-managed pixels: proves neutralising a profile's text never changes how the image looks. */
  async function colourManagedPixels(buf) {
    return sharp(buf).toColourspace('srgb').raw().toBuffer();
  }

  const FORMATS = [
    { ext: 'jpg', build: (profile) => baseWithIcc(profile, 'jpeg') },
    { ext: 'png', build: (profile) => baseWithIcc(profile, 'png') },
    { ext: 'webp', build: (profile) => baseWithIcc(profile, 'webp') },
  ];

  function baseWithIcc(profile, method) {
    return sharp({ create: { width: F.WIDTH, height: F.HEIGHT, channels: 3, background: { r: 30, g: 90, b: 180 } } })
      .withIccProfile(profile)[method]()
      .toBuffer();
  }

  for (const { ext, build } of FORMATS) {
    for (const profile of ['srgb', 'p3']) {
      test(`${ext}: a real sharp-embedded "${profile}" profile survives scrub(), colour-managed pixels unchanged`, async () => {
        const buf = await build(profile);
        const before = await sharp(buf).metadata();
        assert.ok(before.icc, `fixture sanity check: ${ext}/${profile} should carry an ICC profile before scrubbing`);
        const res = await scrub(buf, { name: `t.${ext}` });
        assert.equal(res.ok, true, res.reason);
        const after = await sharp(res.buffer).metadata();
        assert.ok(after.icc, `the ${profile} profile should still be present after scrub()`);
        assert.deepEqual(await colourManagedPixels(res.buffer), await colourManagedPixels(buf), 'colour-managed pixels must be byte-identical');
      });
    }
  }

  test('a personal desc/cprt patched into a REAL (sharp-embedded) profile is gone after scrub, and the profile still parses', async () => {
    const buf = await sharp({ create: { width: F.WIDTH, height: F.HEIGHT, channels: 3, background: { r: 1, g: 1, b: 1 } } })
      .withIccProfile('srgb')
      .png()
      .toBuffer();
    const realProfile = (await sharp(buf).metadata()).icc;
    assert.ok(Buffer.isBuffer(realProfile) && realProfile.length > 0, 'fixture sanity check: sharp should hand back the raw ICC profile bytes');

    // Patch the real profile's 'desc' tag text in place with a personal-looking name — every
    // length/offset/count field is left alone, so the patch has to fit inside the space that's already
    // there (sharp/libvips writes this as a v4 multiLocalizedUnicodeType, 'mluc'), which may truncate it.
    const patched = Buffer.from(realProfile);
    const tagCount = patched.readUInt32BE(128);
    let patchedName;
    for (let i = 0; i < tagCount; i++) {
      const entry = 132 + i * 12;
      if (patched.toString('latin1', entry, entry + 4) !== 'desc') continue;
      const tagOffset = patched.readUInt32BE(entry + 4);
      if (patched.toString('latin1', tagOffset, tagOffset + 4) !== 'mluc') continue; // ICC v4 'mluc' tag type
      const recLen = patched.readUInt32BE(tagOffset + 4 + 16); // first record's text length, in bytes
      const recOff = patched.readUInt32BE(tagOffset + 4 + 20); // ...and its offset from the tag's own start
      const start = tagOffset + recOff;
      const name = "Karzen Ho's MacBook Pro Display".slice(0, Math.floor(recLen / 2));
      for (let c = 0; c < name.length; c++) patched.writeUInt16BE(name.charCodeAt(c), start + c * 2);
      patchedName = name;
      break;
    }
    assert.ok(patchedName, 'fixture sanity check: expected an mluc "desc" tag to patch in the real profile');
    const patchedNameUtf16 = Buffer.from(Array.from(patchedName, (c) => [0, c.charCodeAt(0)]).flat());
    assert.ok(patched.includes(patchedNameUtf16), 'fixture sanity check: the patch should actually be in there');

    const chunk = F.pngIccChunk('icc', patched);
    const dirty = F.insertPngChunks(await F.plainPng(), chunk);
    const res = await scrub(dirty, { name: 'patched.png' });
    assert.equal(res.ok, true, res.reason);
    assert.ok(res.removed.includes('camera and device details'));
    assert.equal(res.buffer.includes(patchedNameUtf16), false, 'the patched-in personal text survived scrubbing');
    const outMeta = await sharp(res.buffer).metadata();
    assert.ok(outMeta.icc, 'the profile should still parse (and still be there) after neutralising');
  });

  test('a multi-segment JPEG ICC profile (spread across several APP2 segments) round-trips through scrub()', async () => {
    const profile = F.buildIccProfile("Karzen Ho's MacBook Pro Display");
    const segments = F.jpegIccSegments(profile, 20); // force several small segments
    assert.ok(segments.length > 1, 'fixture sanity check: expected more than one APP2 segment');
    const buf = F.insertJpegSegments(await F.plainJpeg(), ...segments);

    const before = await sharp(buf).metadata();
    assert.ok(before.icc, 'fixture sanity check: sharp should reassemble the multi-segment profile before scrubbing');

    const res = await scrub(buf, { name: 'multi-icc.jpg' });
    assert.equal(res.ok, true, res.reason);
    assert.ok(res.removed.includes('camera and device details'));
    assert.equal(res.buffer.includes(Buffer.from('MacBook', 'latin1')), false, 'the device name survived scrubbing');
    // still split across the same number of APP2 ICC segments, each the same size as before
    const outSegSizes = [];
    let p = 2;
    while (p < res.buffer.length) {
      if (res.buffer[p] !== 0xff) break;
      const marker = res.buffer[p + 1];
      if (marker === 0xda) break;
      const len = res.buffer.readUInt16BE(p + 2);
      const payload = res.buffer.subarray(p + 4, p + 2 + len);
      if (marker === 0xe2 && payload.toString('latin1', 0, 12) === 'ICC_PROFILE\0') outSegSizes.push(payload.length - 14);
      p += 2 + len;
    }
    assert.deepEqual(outSegSizes, segments.map((s) => s.readUInt16BE(2) - 2 - 14), 'segment boundaries should be unchanged');

    const outMeta = await sharp(res.buffer).metadata();
    assert.ok(outMeta.icc, 'the reassembled, re-split profile should still parse');
    const left = await inspect(res.buffer, { name: 'multi-icc.jpg' });
    assert.deepEqual(left.categories, []);
  });

  test('mismatched sequence/count bytes across APP2 ICC segments block the file rather than guessing', async () => {
    const profile = F.buildIccProfile(F.STANDARD_ICC_NAME);
    const segments = F.jpegIccSegments(profile, 20);
    assert.ok(segments.length > 1);
    // Corrupt the last segment's declared count so it disagrees with the others.
    const corrupted = segments.map((s) => Buffer.from(s));
    // Flip the last segment's declared count byte: marker(2) + length(2) + 'ICC_PROFILE\0'(12) + seq(1) + count(1).
    const countByteOffset = 2 + 2 + 12 + 1;
    corrupted[corrupted.length - 1][countByteOffset] = 99;
    const buf = F.insertJpegSegments(await F.plainJpeg(), ...corrupted);
    const res = await scrub(buf, { name: 'mismatched-icc.jpg' });
    assert.equal(res.ok, false);
    assert.match(res.reason, /mismatched-icc\.jpg/);
  });
});

describe('text-extension bypass (isText must content-sniff, not just trust the extension)', () => {
  test('a real JPEG with EXIF renamed to .txt is not passed through as clean text', async () => {
    const buf = await F.jpegWithExif();
    assert.equal(isText('txt', buf), false, 'a JPEG\'s bytes must not be classified as text just because of a .txt extension');
    const res = await scrub(buf, { name: 'gps-photo.txt' });
    assert.equal(res.ok, false, 'a binary file misnamed with a text extension must be blocked, not silently copied through');
    assert.notEqual(res.kind, 'text');
  });

  test('the same bytes, correctly named .jpg, are still scrubbed normally (no regression)', async () => {
    const buf = await F.jpegWithExif();
    const res = await scrub(buf, { name: 'gps-photo.jpg' });
    assert.equal(res.ok, true, res.reason);
    assert.equal(res.kind, 'scrubbed');
  });

  test('a genuinely plain-text .txt file still passes through untouched', async () => {
    const buf = Buffer.from('Just some plain notes, nothing binary here.\n', 'utf8');
    assert.equal(isText('txt', buf), true);
    const res = await scrub(buf, { name: 'notes.txt' });
    assert.equal(res.ok, true);
    assert.equal(res.kind, 'text');
    assert.deepEqual(res.buffer, buf);
  });
});

describe('AVIF / TIFF (sharp re-encode)', () => {
  test('TIFF: XMP is dropped, Orientation is baked into the pixels losslessly', async () => {
    // This build of sharp/libvips doesn't embed a custom EXIF tag into a TIFF it writes (withExif() is a
    // no-op there for this format), so XMP stands in as the metadata this case proves gets removed.
    const buf = await sharp({ create: { width: F.WIDTH, height: F.HEIGHT, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .withXmp(F.FAKE_XMP)
      .withMetadata({ orientation: 6 })
      .tiff()
      .toBuffer();
    assert.ok((await sharp(buf).metadata()).xmp, 'fixture sanity check: XMP should be embedded before scrubbing');
    const { res } = await scrubAndVerifyClean(buf, 'scan.tiff');
    assert.ok(res.removed.length > 0);
    const outMeta = await sharp(res.buffer).metadata();
    assert.equal(!!outMeta.xmp, false);
    // sharp's .rotate() bakes the rotation in and resets orientation to 1 — the pixels, not the tag, now carry it.
    assert.equal(outMeta.orientation ?? 1, 1);
    const rotatedInput = await sharp(buf).rotate().raw().toBuffer();
    const output = await rawPixels(res.buffer);
    assert.deepEqual(output, rotatedInput, 'TIFF recompression is lossless once orientation is baked in');
  });

  test('a clean TIFF is still reported clean', async () => {
    const buf = await sharp({ create: { width: F.WIDTH, height: F.HEIGHT, channels: 3, background: { r: 10, g: 20, b: 30 } } }).tiff().toBuffer();
    const res = await scrub(buf, { name: 'plain.tiff' });
    assert.equal(res.ok, true);
    assert.equal(res.kind, 'clean');
  });

  test('AVIF: EXIF is dropped on re-encode (lossy by design)', async () => {
    const buf = await sharp({ create: { width: F.WIDTH, height: F.HEIGHT, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .withExif({ IFD0: { Artist: 'Test Author' } })
      .avif()
      .toBuffer();
    const { res } = await scrubAndVerifyClean(buf, 'photo.avif');
    assert.ok(res.removed.length > 0);
    const outMeta = await sharp(res.buffer).metadata();
    assert.equal(outMeta.format, 'heif'); // sharp reports AVIF as the heif container family
  });

  test('a truncated TIFF is blocked with a readable reason, not thrown or crashed', async () => {
    const res = await scrub(Buffer.from('not a real tiff file at all, just text'), { name: 'broken.tiff' });
    assert.equal(res.ok, false);
    assert.match(res.reason, /broken\.tiff/);
  });

  test('a truncated AVIF is blocked with a readable reason, not thrown or crashed', async () => {
    const res = await scrub(Buffer.from('not a real avif file at all, just text'), { name: 'broken.avif' });
    assert.equal(res.ok, false);
    assert.match(res.reason, /broken\.avif/);
  });
});
