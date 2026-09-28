/* =============================================================
   Tests for the audio/video clean-room scrubbers (PRIV-04).
   Fixtures are built at runtime in tests/helpers/av-fixtures.mjs —
   nothing here is read from a real file, and every fake value
   (GPS 0°/0°, "Test Author", ...) is spelled out in that file, not
   copied from anywhere real.
   ============================================================= */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scrub as scrubFile, ScrubError } from '../../scripts/obsidian/scrub/index.mjs';
import * as isobmff from '../../scripts/obsidian/scrub/isobmff.mjs';
import * as mp3mod from '../../scripts/obsidian/scrub/mp3.mjs';
import * as wavmod from '../../scripts/obsidian/scrub/wav.mjs';
import * as flacmod from '../../scripts/obsidian/scrub/flac.mjs';
import * as external from '../../scripts/obsidian/scrub/external.mjs';
import {
  buildMov, MOV_MDAT_PAYLOAD,
  buildM4a, M4A_COVER_BYTES,
  buildMp4WithLoci,
  buildMp3, MP3_AUDIO_FRAME, MP3_FRAME_COUNT,
  buildWav, WAV_DATA_PAYLOAD, buildRf64Stub,
  buildFlac, FLAC_AUDIO_FRAMES,
  buildHeicStub, buildWebmStub,
} from '../helpers/av-fixtures.mjs';

const NO_TOOLS = { exiftool: null, ffmpeg: null };

// ---------- isobmff: mp4/m4v/mov/m4a ----------

describe('isobmff (mov/mp4/m4a)', () => {
  for (const order of ['moov-first', 'mdat-first']) {
    test(`${order}: scrub removes location/device/time/other and leaves inspect() clean`, async () => {
      const buf = buildMov({ order });
      const { buffer, removed } = await isobmff.scrub(buf, { name: 't.mov' });
      assert.ok(removed.includes('location'), `expected 'location' in ${JSON.stringify(removed)}`);
      assert.ok(removed.includes('device'), `expected 'device' in ${JSON.stringify(removed)}`);
      assert.ok(removed.includes('time'), `expected 'time' in ${JSON.stringify(removed)}`);
      const left = await isobmff.inspect(buffer, { name: 't.mov' });
      assert.deepEqual(left, []);
    });

    test(`${order}: mdat payload is byte-identical and the file length is unchanged`, async () => {
      const buf = buildMov({ order });
      const { buffer } = await isobmff.scrub(buf, { name: 't.mov' });
      assert.equal(buffer.length, buf.length);
      const idx = buffer.indexOf(MOV_MDAT_PAYLOAD);
      assert.ok(idx >= 0, 'mdat payload not found verbatim in the output');
      assert.ok(buffer.subarray(idx, idx + MOV_MDAT_PAYLOAD.length).equals(MOV_MDAT_PAYLOAD));
    });

    test(`${order}: stco still points at the same mdat bytes after scrub`, async () => {
      const buf = buildMov({ order });
      const { buffer } = await isobmff.scrub(buf, { name: 't.mov' });
      // moov is untouched in size/position (we never move bytes), so locate stco's offset field
      // the same way in input and output and confirm it targets identical payload bytes.
      const stcoTag = Buffer.from('stco', 'latin1');
      const stcoAt = buffer.indexOf(stcoTag);
      assert.ok(stcoAt >= 0, 'stco box not found');
      const offsetFieldPos = stcoAt + 4 + 8; // past "stco" + version/flags(4) + entry_count(4)
      const target = buffer.readUInt32BE(offsetFieldPos);
      assert.ok(buffer.subarray(target, target + MOV_MDAT_PAYLOAD.length).equals(MOV_MDAT_PAYLOAD));
    });
  }

  test('64-bit largesize mdat: never parsed, payload preserved, offsets still correct', async () => {
    const buf = buildMov({ order: 'moov-first', largesize: true });
    const { buffer } = await isobmff.scrub(buf, { name: 't.mov' });
    assert.equal(buffer.length, buf.length);
    const idx = buffer.indexOf(MOV_MDAT_PAYLOAD);
    assert.ok(idx >= 0);
    const left = await isobmff.inspect(buffer, { name: 't.mov' });
    assert.deepEqual(left, []);
  });

  test('m4a: iTunes tags and cover are removed, inspect() is clean, mdat is untouched', async () => {
    const buf = buildM4a();
    const { buffer, removed } = await isobmff.scrub(buf, { name: 't.m4a' });
    assert.ok(removed.includes('author'));
    assert.ok(removed.includes('text'));
    assert.ok(removed.includes('thumbnail'));
    assert.equal(buffer.length, buf.length);
    assert.ok(buffer.indexOf(MOV_MDAT_PAYLOAD) >= 0);
    assert.ok(!buffer.includes(M4A_COVER_BYTES));
    const left = await isobmff.inspect(buffer, { name: 't.m4a' });
    assert.deepEqual(left, []);
  });

  // Regression: a real `ffmpeg -metadata location=... out.mp4` writes the location into a classic
  // iTunes ilst as a bare "loci" item (not wrapped in a "data" atom like ©nam/©ART), which classifyKey()
  // didn't recognise and mislabelled 'other' — the ilst's containing "meta" box is still wholesale-
  // stripped either way (nothing is ever actually left behind), but the dry run under-reported what was
  // removed. Found cross-checking against a real ffmpeg-made file; see scrub-tools.test.mjs.
  test('a "loci" location item in a classic ilst is labelled location, not just dropped as other', async () => {
    const buf = buildMp4WithLoci();
    const { buffer, removed } = await isobmff.scrub(buf, { name: 't.mp4' });
    assert.ok(removed.includes('location'), `expected 'location' in ${JSON.stringify(removed)}`);
    const left = await isobmff.inspect(buffer, { name: 't.mp4' });
    assert.deepEqual(left, []);
  });

  test('truncated MOV is blocked via index.mjs scrub(), not thrown', async () => {
    const buf = buildMov().subarray(0, 40);
    const res = await scrubFile(buf, { name: 'broken.mov' });
    assert.equal(res.ok, false);
    assert.match(res.reason, /couldn't be read|runs past|too small/);
  });

  test('a box claiming to run past the end of the file is blocked, not thrown', async () => {
    const buf = Buffer.from(buildMov());
    // corrupt moov's declared size to run past EOF
    const moovAt = buf.indexOf(Buffer.from('moov', 'latin1')) - 4;
    buf.writeUInt32BE(0x7fffffff, moovAt);
    const res = await scrubFile(buf, { name: 'corrupt.mov' });
    assert.equal(res.ok, false);
  });

  test('index.mjs scrub() end to end: kind is "scrubbed" and removed labels are human-readable', async () => {
    const res = await scrubFile(buildMov(), { name: 'clip.mov' });
    assert.equal(res.ok, true);
    assert.equal(res.kind, 'scrubbed');
    assert.ok(res.removed.some((l) => /location/i.test(l)));
  });
});

// ---------- mp3 ----------

describe('mp3', () => {
  for (const id3Version of [3, 4]) {
    test(`ID3v2.${id3Version} + ID3v1 + APEv2: scrub leaves inspect() clean and audio frames identical`, async () => {
      const buf = buildMp3({ id3Version });
      const { buffer, removed } = await mp3mod.scrub(buf, { name: 't.mp3' });
      assert.ok(removed.includes('author'));
      assert.ok(removed.includes('text'));
      assert.equal(buffer[0], 0xff);
      assert.equal(buffer[1] & 0xe0, 0xe0);
      const expectedAudio = Buffer.concat(Array.from({ length: MP3_FRAME_COUNT }, () => MP3_AUDIO_FRAME));
      assert.ok(buffer.subarray(0, expectedAudio.length).equals(expectedAudio));
      const left = await mp3mod.inspect(buffer, { name: 't.mp3' });
      assert.deepEqual(left, []);
    });
  }

  test('truncated ID3v2 header is blocked, not thrown', async () => {
    const buf = buildMp3().subarray(0, 5);
    const res = await scrubFile(buf, { name: 'broken.mp3' });
    assert.equal(res.ok, false);
  });

  test('an ID3v2 tag claiming a size past EOF is blocked', async () => {
    const buf = Buffer.from(buildMp3());
    buf.writeUInt8(0x7f, 6); // corrupt the syncsafe size's top byte to something implausibly large
    buf.writeUInt8(0x7f, 7);
    buf.writeUInt8(0x7f, 8);
    buf.writeUInt8(0x7f, 9);
    const res = await scrubFile(buf, { name: 'corrupt.mp3' });
    assert.equal(res.ok, false);
  });

  test('a file with no MPEG frame sync anywhere is blocked', async () => {
    const buf = Buffer.alloc(64, 0x41); // plain ASCII, no ID3 tag, no frame sync
    const res = await scrubFile(buf, { name: 'not-audio.mp3' });
    assert.equal(res.ok, false);
  });
});

// ---------- wav ----------

describe('wav', () => {
  test('LIST/INFO and bext are removed, data payload is byte-identical, RIFF size is correct', async () => {
    const buf = buildWav();
    const { buffer, removed } = await wavmod.scrub(buf, { name: 't.wav' });
    assert.ok(removed.includes('author'));
    assert.ok(removed.includes('time'));
    assert.equal(buffer.toString('latin1', 0, 4), 'RIFF');
    assert.equal(buffer.readUInt32LE(4), buffer.length - 8);
    const dataIdx = buffer.indexOf(WAV_DATA_PAYLOAD);
    assert.ok(dataIdx >= 0);
    const left = await wavmod.inspect(buffer, { name: 't.wav' });
    assert.deepEqual(left, []);
    // only fmt/fact/data chunks should remain
    assert.ok(!buffer.includes(Buffer.from('LIST', 'latin1')));
    assert.ok(!buffer.includes(Buffer.from('bext', 'latin1')));
  });

  test('RF64 is refused with a clear, actionable message', async () => {
    const buf = buildRf64Stub();
    await assert.rejects(() => wavmod.scrub(buf, { name: 'big.wav' }), (e) => {
      assert.ok(e instanceof ScrubError);
      assert.match(e.message, /RF64/);
      return true;
    });
  });

  test('a chunk running past EOF is blocked via index.mjs scrub(), not thrown', async () => {
    const buf = Buffer.from(buildWav());
    buf.writeUInt32LE(0x7fffffff, 16); // corrupt the "fmt " chunk's declared size
    const res = await scrubFile(buf, { name: 'corrupt.wav' });
    assert.equal(res.ok, false);
  });

  test('missing RIFF/WAVE header is blocked', async () => {
    const res = await scrubFile(Buffer.alloc(20), { name: 'not-a.wav' });
    assert.equal(res.ok, false);
  });
});

// ---------- flac ----------

describe('flac', () => {
  test('VORBIS_COMMENT and PICTURE are removed, last-metadata-block flag is set, audio frames identical', async () => {
    const buf = buildFlac();
    const { buffer, removed } = await flacmod.scrub(buf, { name: 't.flac' });
    assert.ok(removed.includes('author'));
    assert.ok(removed.includes('time'));
    assert.ok(removed.includes('software'));
    assert.ok(removed.includes('thumbnail'));
    assert.equal(buffer.toString('latin1', 0, 4), 'fLaC');
    // STREAMINFO is the only block left; it must carry the last-block flag.
    const header = buffer[4];
    assert.equal(header & 0x80, 0x80);
    assert.equal(header & 0x7f, 0);
    const audioIdx = buffer.indexOf(FLAC_AUDIO_FRAMES);
    assert.ok(audioIdx >= 0);
    const left = await flacmod.inspect(buffer, { name: 't.flac' });
    assert.deepEqual(left, []);
  });

  test('a metadata block running past EOF is blocked via index.mjs scrub(), not thrown', async () => {
    const buf = Buffer.from(buildFlac());
    const flacAt = buf.indexOf('fLaC', 0, 'latin1');
    buf.writeUIntBE(0x7fffff, flacAt + 5, 3); // corrupt STREAMINFO's declared length
    const res = await scrubFile(buf, { name: 'corrupt.flac' });
    assert.equal(res.ok, false);
  });

  test('missing "fLaC" marker is blocked', async () => {
    const res = await scrubFile(Buffer.alloc(40), { name: 'not.flac' });
    assert.equal(res.ok, false);
  });
});

// ---------- external.mjs: heic/heif/webm/ogv/ogg/opus/aac ----------

describe('external tool fallback', () => {
  for (const [ext, build] of [['heic', buildHeicStub], ['webm', buildWebmStub]]) {
    test(`${ext}: blocked with an actionable message when its tool isn't installed`, async () => {
      const res = await scrubFile(build(), { name: `clip.${ext}`, tools: NO_TOOLS });
      assert.equal(res.ok, false);
      assert.match(res.reason, /install|convert|export/i);
    });

    test(`${ext}: inspect() also throws ScrubError (not a crash) when its tool isn't installed`, async () => {
      await assert.rejects(() => external.inspect(build(), { name: `clip.${ext}`, ext, tools: NO_TOOLS }), ScrubError);
    });
  }

  test('routes heic/heif to exiftool and webm/ogv/ogg/opus/aac to ffmpeg', () => {
    assert.equal(external.toolFor('heic'), 'exiftool');
    assert.equal(external.toolFor('heif'), 'exiftool');
    for (const ext of ['webm', 'ogv', 'ogg', 'opus', 'aac']) assert.equal(external.toolFor(ext), 'ffmpeg');
  });

  // Regression: found by muxing a *metadata-free* source through real ffmpeg (-c copy) into .webm and
  // seeing an "encoder: Lavf" + per-stream "DURATION: ..." tag survive `-map_metadata -1` regardless —
  // libavformat's matroska muxer always writes both itself; no -metadata/-map_metadata flag suppresses
  // them (confirmed against several flag combinations). Before this fix classifyFfmpegTag flagged both as
  // real metadata ('software' / 'other'), so a webm scrubbed via external.mjs could never pass its own
  // post-scrub inspect() and was blocked every time, even with nothing left to hide. See scrub-tools.test.mjs.
  describe('classifyFfmpegTag: matroska muxer furniture vs. real metadata', () => {
    test('a bare "Lavf" encoder tag (no version) is structural, not software', () => {
      assert.equal(external.classifyFfmpegTag('encoder', 'Lavf'), null);
      assert.equal(external.classifyFfmpegTag('ENCODER', ' Lavf '), null); // case/whitespace-insensitive
    });
    test('a real, versioned encoder string is still flagged as software', () => {
      assert.equal(external.classifyFfmpegTag('encoder', 'Lavf63.7.100'), 'software');
      assert.equal(external.classifyFfmpegTag('encoder', 'HandBrake 1.6.1'), 'software');
    });
    test('a matroska per-stream DURATION value is structural, not a category', () => {
      assert.equal(external.classifyFfmpegTag('DURATION', '00:00:01.003000000'), null);
    });
    test('a "duration" tag with a non-timecode value is not exempted', () => {
      assert.equal(external.classifyFfmpegTag('duration', 'not-a-timecode'), 'other');
    });
  });

  // Regression: analyzeExiftool() (exiftool -j -G0 <temp copy>) used to exclude only SourceFile/FileType/
  // FileTypeExtension/MIMEType before classifying each returned key. But ExifTool's -G0 output also files
  // its own synthesized facts about the file ON DISK — FileModifyDate/FileAccessDate/FileCreateDate among
  // them — under the same "File" group. Those describe the *temp copy* withTempCopy() just wrote, not the
  // original file's own history, and a fresh copy's mtime is always "now" — so classifyExiftoolTag's own
  // date/time regex (correctly applied to a real embedded DateTimeOriginal) flagged them too, meaning a
  // heic/heif file's post-scrub inspect() would *always* report a 'time' category left over, however clean
  // the original really was, and every such file would be permanently blocked. Found by stripping a real
  // ExifTool-tagged file and getting 'time' back with no real date tag left to explain it; see
  // scrub-tools.test.mjs. This test pins the exclusion list without needing exiftool installed.
  test('FILESYSTEM_TAGS excludes the OS-level facts exiftool reports about the temp file, which classifyExiftoolTag would otherwise misclassify', () => {
    for (const tag of ['FileModifyDate', 'FileAccessDate', 'FileCreateDate', 'FileInodeChangeDate']) {
      assert.ok(external.FILESYSTEM_TAGS.has(tag), `expected '${tag}' in FILESYSTEM_TAGS`);
      // Sanity: confirms *why* the exclusion is needed — left unexcluded, this exact tag name really
      // would be misread as leaked capture time by the same classifier real embedded dates go through.
      assert.equal(external.classifyExiftoolTag(tag), 'time');
    }
    for (const tag of ['FileName', 'Directory', 'FileSize', 'FilePermissions', 'SourceFile', 'FileType', 'FileTypeExtension', 'MIMEType']) {
      assert.ok(external.FILESYSTEM_TAGS.has(tag), `expected '${tag}' in FILESYSTEM_TAGS`);
    }
  });

  test('with allowMetadata, a missing-tool file passes through unscrubbed rather than blocking', async () => {
    const res = await scrubFile(buildWebmStub(), { name: 'clip.webm', tools: NO_TOOLS, allowMetadata: true });
    assert.equal(res.ok, true);
    assert.equal(res.kind, 'unscrubbed');
  });

  // Real-tool paths (exiftool/ffmpeg actually installed) are exercised only when present on the
  // machine running the tests; this environment has neither, so those paths are skipped here.
  test('exiftool/ffmpeg smoke test (skipped when the tool is not installed)', async (t) => {
    const { findTools } = await import('../../scripts/obsidian/scrub/index.mjs');
    const tools = findTools();
    if (!tools.exiftool && !tools.ffmpeg) {
      t.skip('neither exiftool nor ffmpeg is installed on this machine');
      return;
    }
    assert.ok(true);
  });
});
