/* =============================================================
   Independent, real-tool verification of the PRIV-04 scrubbers
   (scripts/obsidian/scrub/*.mjs).

   Every other scrub-*.test.mjs file checks a handler against a
   synthetic, hand-built fixture and then asks the handler's own
   inspect() whether it's clean — useful, but it can't catch a bug
   that a real encoder/writer produces and our own inspect() also
   misses. This file instead:

     1. makes REAL files with a REAL exiftool/ffmpeg build (fake
        planted values only: "Test Author", GPS 0/0, ...),
     2. runs them through the actual scrubber, and
     3. checks the result with an INDEPENDENT oracle — a second,
        separate `exiftool -j -a -G1 -s -ee` (or `ffmpeg -i`) call on
        our own output, plus a real decode (`ffmpeg -f null -`) and,
        for lossless image formats, a pixel-identical check.

   Every test skips cleanly ({ skip: ... }) when the tool it needs
   isn't installed, so this file passes the same way whether the
   machine running it has neither tool, one, or both — CI's Ubuntu
   runner may have either. Nothing is ever written inside the repo or
   the real vault: fixtures live in a fresh os.tmpdir() directory
   removed after the run, and the tools themselves are resolved from
   PATH (findTools()), never bundled here.
   ============================================================= */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { scrub, inspect, findTools } from '../../scripts/obsidian/scrub/index.mjs';
import * as mp3mod from '../../scripts/obsidian/scrub/mp3.mjs';
import * as wavmod from '../../scripts/obsidian/scrub/wav.mjs';
import * as flacmod from '../../scripts/obsidian/scrub/flac.mjs';
import * as jpegmod from '../../scripts/obsidian/scrub/jpeg.mjs';
import * as pngmod from '../../scripts/obsidian/scrub/png.mjs';
import * as gifmod from '../../scripts/obsidian/scrub/gif.mjs';
import * as webpmod from '../../scripts/obsidian/scrub/webp.mjs';
import * as external from '../../scripts/obsidian/scrub/external.mjs';

const tools = findTools();
const skipNoFfmpeg = tools.ffmpeg ? false : 'ffmpeg is not installed on this machine';
const skipNoExiftool = tools.exiftool ? false : 'exiftool is not installed on this machine';

let dir;
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbital-scrub-tools-')); });
after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

const p = (name) => path.join(dir, name);
const write = (name, buf) => { fs.writeFileSync(p(name), buf); return p(name); };
const read = (name) => fs.readFileSync(p(name));
const run = (cmd, args) => execFileSync(cmd, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });

/** exiftool -j -a -G1 -s -ee <file>, parsed — the independent oracle for every image/PDF check below. */
function exiftoolOracle(name) {
  const out = execFileSync(tools.exiftool, ['-j', '-a', '-G1', '-s', '-ee', p(name)], { windowsHide: true, encoding: 'utf8' });
  return JSON.parse(out)[0];
}

/** Every fake value planted into a fixture in this file. None of these may appear anywhere in scrubbed output. */
const PLANTED = ['Test Author', 'Test Title', 'Test Comment', 'Test Make', 'Test Model', 'Test Software', 'Test Subject', 'Test Keyword'];

/** Per the task's oracle definition: no GPS group, no XMP/IPTC group, and none of PLANTED anywhere in the dump. */
function assertOracleClean(oracle, name) {
  const text = JSON.stringify(oracle);
  for (const value of PLANTED) assert.ok(!text.includes(value), `${name}: oracle still shows "${value}"`);
  for (const key of Object.keys(oracle)) {
    const group = key.includes(':') ? key.slice(0, key.indexOf(':')) : '';
    assert.ok(!/^GPS/.test(key.slice(key.indexOf(':') + 1) || key), `${name}: oracle still has a GPS key (${key})`);
    assert.ok(group !== 'IPTC' && !group.startsWith('XMP'), `${name}: oracle still has an ${group} key (${key})`);
  }
}

/** ffmpeg -v error -i <file> -f null - must print nothing: a clean decode of the whole stream. */
function assertDecodesCleanly(name) {
  const r = execFileSync(tools.ffmpeg, ['-v', 'error', '-i', p(name), '-f', 'null', '-'], { windowsHide: true, encoding: 'utf8' });
  assert.equal(r.trim(), '', `${name}: ffmpeg reported decode errors: ${r}`);
}

// ---------- images: ExifTool writes GPS/Artist/Make/Model/Software/DateTimeOriginal/XMP/IPTC ----------

describe('images cross-checked against real ExifTool-written files', () => {
  /** Makes a small base image with ffmpeg, writes the standard planted metadata into it with exiftool. */
  function makeTaggedImage(name) {
    run(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=teal:size=16x16', '-frames:v', '1', p(name)]);
    run(tools.exiftool, [
      '-overwrite_original', '-GPSLatitude=12.3456', '-GPSLatitudeRef=N', '-GPSLongitude=65.4321', '-GPSLongitudeRef=E',
      '-Artist=Test Author', '-Make=Test Make', '-Model=Test Model', '-Software=Test Software',
      '-DateTimeOriginal=2020:01:01 00:00:00', '-Title=Test Title', '-Comment=Test Comment',
      '-XMP-dc:Creator=Test Author', p(name),
    ]);
  }

  for (const ext of ['jpg', 'png', 'gif', 'webp']) {
    test(`${ext}: real ExifTool metadata is gone after scrub, per index.mjs and the exiftool oracle`, { skip: skipNoFfmpeg || skipNoExiftool }, async () => {
      const name = `photo.${ext}`;
      makeTaggedImage(name);
      const res = await scrub(read(name), { name });
      assert.equal(res.ok, true, res.reason);
      assert.equal(res.kind, 'scrubbed');
      write(`${name}.out`, res.buffer);
      const left = await inspect(res.buffer, { name });
      assert.deepEqual(left.categories, [], `our own inspect() still finds: ${left.categories}`);
      assertOracleClean(exiftoolOracle(`${name}.out`), name);
    });
  }

  test('tiff (via sharp): real ExifTool metadata is gone, and pixels are unchanged', { skip: skipNoFfmpeg || skipNoExiftool }, async () => {
    // rgb24 explicitly: ffmpeg's default lavfi->tiff pixel format is yuv420p, which would make the
    // pixel-identical check below compare across a colour-space conversion sharp performs on re-encode,
    // not a real content change — the format sharp's tiff branch is actually expected to preserve exactly.
    run(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=teal:size=16x16', '-pix_fmt', 'rgb24', '-frames:v', '1', p('photo.tiff')]);
    run(tools.exiftool, [
      '-overwrite_original', '-GPSLatitude=12.3456', '-GPSLatitudeRef=N', '-GPSLongitude=65.4321', '-GPSLongitudeRef=E',
      '-Artist=Test Author', '-Make=Test Make', '-Model=Test Model', '-Software=Test Software',
      '-DateTimeOriginal=2020:01:01 00:00:00', '-Title=Test Title', '-XMP-dc:Creator=Test Author', p('photo.tiff'),
    ]);
    const res = await scrub(read('photo.tiff'), { name: 'photo.tiff' });
    assert.equal(res.ok, true, res.reason);
    write('photo.tiff.out', res.buffer);
    assertOracleClean(exiftoolOracle('photo.tiff.out'), 'photo.tiff');
    run(tools.ffmpeg, ['-y', '-v', 'error', '-i', p('photo.tiff'), '-f', 'rawvideo', '-pix_fmt', 'rgb24', p('photo.tiff.raw')]);
    run(tools.ffmpeg, ['-y', '-v', 'error', '-i', p('photo.tiff.out'), '-f', 'rawvideo', '-pix_fmt', 'rgb24', p('photo.tiff.out.raw')]);
    assert.ok(read('photo.tiff.raw').equals(read('photo.tiff.out.raw')), 'tiff pixels changed after scrub');
  });

  test('jpeg/png/gif/webp pixels are unchanged (lossless formats decode identically)', { skip: skipNoFfmpeg || skipNoExiftool }, async () => {
    for (const ext of ['jpg', 'png', 'gif', 'webp']) {
      const name = `pix.${ext}`;
      makeTaggedImage(name);
      const mod = { jpg: jpegmod, png: pngmod, gif: gifmod, webp: webpmod }[ext];
      const { buffer } = await mod.scrub(read(name), { name, ext });
      write(`${name}.out`, buffer);
      run(tools.ffmpeg, ['-y', '-v', 'error', '-i', p(name), '-f', 'rawvideo', '-pix_fmt', 'rgb24', p(`${name}.raw`)]);
      run(tools.ffmpeg, ['-y', '-v', 'error', '-i', p(`${name}.out`), '-f', 'rawvideo', '-pix_fmt', 'rgb24', p(`${name}.out.raw`)]);
      assert.ok(read(`${name}.raw`).equals(read(`${name}.out.raw`)), `${ext}: pixels changed after scrub`);
    }
  });

  test('a Display P3 JPEG keeps a real colour profile after scrub, per an independent ExifTool read', { skip: skipNoExiftool }, async () => {
    const buf = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 40, g: 120, b: 200 } } })
      .withIccProfile('p3')
      .withExif({ IFD0: { Artist: 'Test Author', Software: 'Test Software' } })
      .jpeg()
      .toBuffer();
    write('p3.jpg', buf);
    const before = exiftoolOracle('p3.jpg');
    assert.ok(before['ICC_Profile:ProfileDescription'], 'fixture sanity check: exiftool should see a colour profile before scrubbing');

    const res = await scrub(buf, { name: 'p3.jpg' });
    assert.equal(res.ok, true, res.reason);
    write('p3.jpg.out', res.buffer);

    const oracle = exiftoolOracle('p3.jpg.out');
    assert.ok(oracle['ICC-header:ColorSpaceData'], 'exiftool should still report a colour profile after scrubbing');
    // blanked text is spaces (same byte length as before), not removed, so exiftool reports it as blank/whitespace
    assert.equal((oracle['ICC_Profile:ProfileDescription'] ?? '').trim(), '', 'the profile description should be blanked');
    assert.equal((oracle['ICC_Profile:ProfileCopyright'] ?? '').trim(), '', 'the profile copyright should be blanked');
    // colour management itself — the fields that actually decide how colour is rendered — is unchanged
    for (const key of ['ColorSpaceData', 'ProfileConnectionSpace', 'ProfileClass']) {
      assert.equal(oracle[`ICC-header:${key}`], before[`ICC-header:${key}`], `ICC-header:${key} changed after scrub`);
    }
    for (const key of ['MediaWhitePoint', 'ChromaticAdaptation', 'RedMatrixColumn', 'GreenMatrixColumn', 'BlueMatrixColumn', 'RedTRC', 'GreenTRC', 'BlueTRC']) {
      assert.equal(oracle[`ICC_Profile:${key}`], before[`ICC_Profile:${key}`], `ICC_Profile:${key} changed after scrub`);
    }
    assertOracleClean(oracle, 'p3.jpg');
  });
});

// ---------- PDF: ExifTool's classic trap — incremental updates leave the old metadata sitting in the file ----------

describe('pdf cross-checked against a real ExifTool incremental update', () => {
  test('a real ExifTool-written Author/Creator/XMP (appended, not replaced) is fully gone after scrub', { skip: skipNoExiftool }, async () => {
    // A minimal, real PDF — the repo's own test fixture, copied here rather than read from the real vault.
    const base = fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'vault', 'attachments', 'paper.pdf'));
    write('doc.pdf', base);
    const before = fs.statSync(p('doc.pdf')).size;
    run(tools.exiftool, [
      '-overwrite_original', '-Author=Test Author', '-XMP-dc:Creator=Test Author',
      '-Title=Test Title', '-Subject=Test Subject', '-Keywords=Test Keyword', p('doc.pdf'),
    ]);
    // Confirm the trap is actually set: exiftool's incremental update makes the file grow (it appends a
    // new revision; the old /Info and any prior objects are still sitting in the file, just unreferenced).
    assert.ok(fs.statSync(p('doc.pdf')).size > before, 'exiftool did not append an incremental update as expected');

    const res = await scrub(read('doc.pdf'), { name: 'doc.pdf' });
    assert.equal(res.ok, true, res.reason);
    write('doc.pdf.out', res.buffer);

    // The oracle check, plus: none of the planted values may survive ANYWHERE in the raw bytes — not just
    // in whatever the current /Info dictionary says, since the classic trap is the OLD revision surviving
    // unreferenced. Confirms garbageCollect() actually removes the orphaned objects, not just detaches them.
    assertOracleClean(exiftoolOracle('doc.pdf.out'), 'doc.pdf');
    const raw = read('doc.pdf.out').toString('latin1');
    for (const value of PLANTED) assert.ok(!raw.includes(value), `raw scrubbed PDF bytes still contain "${value}"`);
    // PDFVersion/PageCount aren't in PLANTED but the fingerprint of the writing tool used to plant them is
    // worth checking too, for the same reason: a leftover revision, not just a cleared current value.
    assert.ok(!raw.includes('pdf-lib'), 'raw scrubbed PDF bytes still contain the original Producer/Creator string');
  });
});

// ---------- video/audio containers: ffmpeg makes MP4/MOV/M4V/M4A with real -metadata + GPS-ish location ----------

describe('isobmff (mp4/mov/m4v/m4a) cross-checked against real ffmpeg-made files', () => {
  /** A real ffmpeg-muxed video with planted artist/title/comment/creation_time/location. */
  function makeTaggedVideo(name) {
    run(tools.ffmpeg, [
      '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=32x32:rate=5', '-f', 'lavfi', '-i', 'sine=duration=1',
      '-metadata', 'artist=Test Author', '-metadata', 'title=Test Title', '-metadata', 'comment=Test Comment',
      '-metadata', 'creation_time=2020-01-01T00:00:00Z', '-metadata', 'location=+00.0000+000.0000/',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p(name),
    ]);
  }

  for (const ext of ['mp4', 'mov', 'm4v']) {
    test(`${ext}: real ffmpeg metadata (incl. location, whichever box shape the muxer picks) is gone`, { skip: skipNoFfmpeg || skipNoExiftool }, async () => {
      const name = `clip.${ext}`;
      makeTaggedVideo(name);
      const res = await scrub(read(name), { name });
      assert.equal(res.ok, true, res.reason);
      assert.equal(res.kind, 'scrubbed');
      write(`${name}.out`, res.buffer);
      const left = await inspect(res.buffer, { name });
      assert.deepEqual(left.categories, [], `our own inspect() still finds: ${left.categories}`);
      assertOracleClean(exiftoolOracle(`${name}.out`), name);
      assertDecodesCleanly(`${name}.out`);
    });
  }

  test('m4a with real cover art (attached_pic): thumbnail and tags gone, audio still decodes', { skip: skipNoFfmpeg || skipNoExiftool }, async () => {
    run(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=16x16', '-frames:v', '1', p('cover.jpg')]);
    run(tools.ffmpeg, [
      '-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=1', '-i', p('cover.jpg'),
      '-metadata', 'artist=Test Author', '-metadata', 'title=Test Title', '-metadata', 'comment=Test Comment',
      '-map', '0:a', '-map', '1:v', '-c:a', 'aac', '-c:v', 'mjpeg', '-disposition:v:0', 'attached_pic', p('clip.m4a'),
    ]);
    const res = await scrub(read('clip.m4a'), { name: 'clip.m4a' });
    assert.equal(res.ok, true, res.reason);
    write('clip.m4a.out', res.buffer);
    const left = await inspect(res.buffer, { name: 'clip.m4a' });
    assert.deepEqual(left.categories, []);
    assertOracleClean(exiftoolOracle('clip.m4a.out'), 'clip.m4a');
    assertDecodesCleanly('clip.m4a.out');
  });
});

// ---------- audio: ffmpeg makes MP3/WAV/FLAC, including cover art where the format allows ----------

describe('mp3/wav/flac cross-checked against real ffmpeg-made files', () => {
  test('mp3 with ID3v2 tags + real cover art (APIC): all gone, audio still decodes', { skip: skipNoFfmpeg || skipNoExiftool }, async () => {
    run(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=16x16', '-frames:v', '1', p('cover.jpg')]);
    run(tools.ffmpeg, [
      '-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=1', '-i', p('cover.jpg'),
      '-metadata', 'artist=Test Author', '-metadata', 'title=Test Title',
      '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-c:v', 'mjpeg', '-id3v2_version', '3',
      '-write_id3v1', '1', '-disposition:v:0', 'attached_pic', p('song.mp3'),
    ]);
    const { buffer, removed } = await mp3mod.scrub(read('song.mp3'), { name: 'song.mp3' });
    assert.ok(removed.includes('author'));
    assert.ok(removed.includes('thumbnail'));
    write('song.mp3.out', buffer);
    const left = await mp3mod.inspect(buffer, { name: 'song.mp3' });
    assert.deepEqual(left, []);
    assertOracleClean(exiftoolOracle('song.mp3.out'), 'song.mp3');
    assertDecodesCleanly('song.mp3.out');
  });

  test('wav with LIST/INFO tags: all gone, audio still decodes', { skip: skipNoFfmpeg || skipNoExiftool }, async () => {
    run(tools.ffmpeg, [
      '-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=1',
      '-metadata', 'artist=Test Author', '-metadata', 'title=Test Title', '-metadata', 'comment=Test Comment',
      '-metadata', 'date=2020-01-01', '-c:a', 'pcm_s16le', p('song.wav'),
    ]);
    const { buffer, removed } = await wavmod.scrub(read('song.wav'), { name: 'song.wav' });
    assert.ok(removed.includes('author'));
    write('song.wav.out', buffer);
    const left = await wavmod.inspect(buffer, { name: 'song.wav' });
    assert.deepEqual(left, []);
    assertOracleClean(exiftoolOracle('song.wav.out'), 'song.wav');
    assertDecodesCleanly('song.wav.out');
  });

  test('flac with VORBIS_COMMENT tags + real cover art (PICTURE): all gone, audio still decodes', { skip: skipNoFfmpeg || skipNoExiftool }, async () => {
    run(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=16x16', '-frames:v', '1', p('cover.jpg')]);
    run(tools.ffmpeg, [
      '-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=1', '-i', p('cover.jpg'),
      '-metadata', 'artist=Test Author', '-metadata', 'title=Test Title', '-metadata', 'comment=Test Comment',
      '-metadata', 'date=2020-01-01', '-map', '0:a', '-map', '1:v', '-c:a', 'flac', '-c:v', 'mjpeg',
      '-disposition:v:0', 'attached_pic', p('song.flac'),
    ]);
    const { buffer, removed } = await flacmod.scrub(read('song.flac'), { name: 'song.flac' });
    assert.ok(removed.includes('author'));
    assert.ok(removed.includes('thumbnail'));
    write('song.flac.out', buffer);
    const left = await flacmod.inspect(buffer, { name: 'song.flac' });
    assert.deepEqual(left, []);
    assertOracleClean(exiftoolOracle('song.flac.out'), 'song.flac');
    assertDecodesCleanly('song.flac.out');
  });
});

// ---------- external.mjs: webm/ogv/ogg/opus via ffmpeg, heic via exiftool (documented limitation below) ----------

describe('external.mjs cross-checked against real ffmpeg-made files', () => {
  for (const [ext, kind, codecArgs] of [
    ['webm', 'av', ['-c:v', 'libvpx', '-c:a', 'libvorbis']],
    ['ogv', 'video', ['-c:v', 'libtheora']],
    ['ogg', 'audio', ['-c:a', 'libvorbis']],
    ['opus', 'audio', ['-c:a', 'libopus']],
  ]) {
    test(`${ext}: real ffmpeg metadata is gone via the external-tool path, including the matroska/ogg muxer's own furniture`, { skip: skipNoFfmpeg }, async () => {
      const name = `clip.${ext}`;
      const hasVideo = kind !== 'audio';
      const args = ['-y', '-v', 'error', '-f', 'lavfi'];
      if (kind === 'audio') args.push('-i', 'sine=duration=1');
      else if (kind === 'video') args.push('-i', 'testsrc=duration=1:size=32x32:rate=5');
      else args.push('-i', 'testsrc=duration=1:size=32x32:rate=5', '-f', 'lavfi', '-i', 'sine=duration=1');
      args.push(
        '-metadata', 'artist=Test Author', '-metadata', 'title=Test Title', '-metadata', 'comment=Test Comment',
        '-metadata', 'date=2020-01-01', '-metadata', 'creation_time=2020-01-01T00:00:00Z',
      );
      if (hasVideo) args.push('-metadata', 'location=+00.0000+000.0000/');
      args.push(...codecArgs, '-shortest', p(name));
      run(tools.ffmpeg, args);

      const ctx = { name, ext, tools };
      const before = await external.inspect(read(name), ctx);
      assert.ok(before.length > 0, `expected the un-scrubbed ${ext} to report some metadata categories`);
      const { buffer } = await external.scrub(read(name), ctx);
      write(`${name}.out`, buffer);
      // This is the actual safety net index.mjs relies on: inspect() re-run on the scrubbed output.
      const after = await external.inspect(buffer, ctx);
      assert.deepEqual(after, [], `external.mjs left categories behind after its own strip: ${after}`);
      assertDecodesCleanly(`${name}.out`);
      const raw = read(`${name}.out`).toString('latin1');
      for (const value of PLANTED) assert.ok(!raw.includes(value), `${name}: raw scrubbed bytes still contain "${value}"`);
    });
  }

  // No HEIC encoder is available on this machine (neither ffmpeg nor exiftool can *produce* a HEIC; exiftool
  // only edits existing ones), so the heic/heif path can't be driven end-to-end through external.scrub()
  // here: routing real JPEG bytes through it with ctx.ext forced to 'heic' makes ExifTool's write-time
  // file-type check refuse the temp file ("Not a valid HEIC (looks more like a JPEG)") — confirmed while
  // building this test, and left as the "issues" note for the orchestrator rather than worked around by
  // relaxing that check, since refusing a mismatched extension is itself reasonable fail-closed behaviour.
  // What IS verified here, against a real ExifTool-written file: (a) analyzeExiftool's `-j -G0` read path
  // and tag classification, called exactly as external.mjs calls it, with ctx.ext genuinely 'heic' (the
  // read side has no such type check, so this part **does** exercise the real heic/heif routing); and
  // (b) the exact strip command line stripExiftool() runs (`-all= -tagsfromfile @ -Orientation
  // -overwrite_original`), run directly against a matching-extension file. HEIC's metadata is the same
  // TIFF-structured EXIF block JPEG carries in its APP1 (ExifTool writes both through the same EXIF code
  // path), so this is a faithful proxy for the write side too.
  test('heic/heif: the exact exiftool command lines external.mjs runs, verified against a real file (no HEIC encoder available here)', { skip: skipNoFfmpeg || skipNoExiftool }, async () => {
    run(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=teal:size=16x16', '-frames:v', '1', p('stand-in.jpg')]);
    run(tools.exiftool, [
      '-overwrite_original', '-GPSLatitude=12.3456', '-GPSLatitudeRef=N', '-GPSLongitude=65.4321', '-GPSLongitudeRef=E',
      '-Artist=Test Author', '-Make=Test Make', '-Model=Test Model', '-Software=Test Software',
      '-DateTimeOriginal=2020:01:01 00:00:00', '-Orientation#=6', p('stand-in.jpg'),
    ]);

    // (a) the real analyze path, real ext='heic' routing, on a real file.
    const before = await external.inspect(read('stand-in.jpg'), { name: 'stand-in.heic', ext: 'heic', tools });
    for (const cat of ['location', 'author', 'device', 'software', 'time']) {
      assert.ok(before.includes(cat), `expected '${cat}' in ${JSON.stringify(before)}`);
    }

    // (b) the real strip command line, run directly (see comment above for why not through scrub()).
    run(tools.exiftool, ['-all=', '-tagsfromfile', '@', '-Orientation', '-overwrite_original', p('stand-in.jpg')]);
    const oracle = exiftoolOracle('stand-in.jpg');
    assertOracleClean(oracle, 'stand-in.jpg (heic strip command line)');
    assert.equal(oracle['IFD0:Orientation'], 'Rotate 90 CW', 'Orientation should survive (external.mjs explicitly keeps it)');

    // And the analyze path again confirms the post-strip file reports no categories, the same re-check
    // index.mjs performs after handler.scrub() returns.
    const after = await external.inspect(read('stand-in.jpg'), { name: 'stand-in.heic', ext: 'heic', tools });
    assert.deepEqual(after, []);
  });
});
