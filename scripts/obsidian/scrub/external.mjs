/* =============================================================
   External-tool fallback (PRIV-04): heic, heif, webm, ogv, ogg, opus, aac

   No format handler in this folder understands these containers, so
   cleaning leans on a tool already on the author's machine: ExifTool
   for HEIC/HEIF, ffmpeg for the audio/video formats. Both run against
   a temp copy (never the original) and are always given a timeout;
   the temp directory is removed in a `finally` whether the tool
   succeeds or not. When the tool isn't installed the file is blocked
   with a message that tells the author what to do instead — convert
   the file, or install the tool — never silently published as-is.

   `removed` is a snapshot of what the tool reported *before* it ran;
   the actual guarantee comes from index.mjs re-running inspect() on
   the tool's output afterwards and blocking anything still there.
   ============================================================= */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ScrubError } from './index.mjs';

const execFileP = promisify(execFile);
const TIMEOUT_MS = 30000;

const IMAGE_EXT = new Set(['heic', 'heif']);
const toolFor = (ext) => (IMAGE_EXT.has(ext) ? 'exiftool' : 'ffmpeg');

function missingToolMessage(ctx) {
  if (toolFor(ctx.ext) === 'exiftool') {
    return `"${ctx.name}" can't be checked for hidden metadata on this computer. Export it as a JPEG, or install ExifTool, then publish again.`;
  }
  return `"${ctx.name}" can't be checked for hidden metadata on this computer. Convert it to MP4 (video) or M4A/MP3 (audio), or install ffmpeg, then publish again.`;
}

function briefError(e) {
  const text = (e.stderr || e.message || '').toString().trim();
  return text.split(/\r?\n/).filter(Boolean).pop()?.slice(0, 200) ?? 'unknown error';
}

async function withTempCopy(buf, ext, fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'orbital-scrub-'));
  try {
    const inPath = path.join(dir, `in.${ext}`);
    await fsp.writeFile(inPath, buf);
    return await fn(dir, inPath);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** ExifTool tag name → category. Orientation is deliberately kept, so it's never classified. */
function classifyExiftoolTag(tag) {
  if (tag === 'Orientation') return null;
  if (/gps/i.test(tag)) return 'location';
  if (/^(make|model|lensmake|lensmodel|serialnumber|cameraid|lensid)/i.test(tag)) return 'device';
  if (/date|time/i.test(tag)) return 'time';
  if (/^(software|creatortool|producer|processingsoftware)/i.test(tag)) return 'software';
  if (/^(artist|author|creator|copyright|rights|ownername)/i.test(tag)) return 'author';
  if (/^(imagedescription|usercomment|title|subject|comment|description|keywords)/i.test(tag)) return 'text';
  if (/thumbnail|previewimage/i.test(tag)) return 'thumbnail';
  if (/^(xmp|iptc)/i.test(tag)) return 'other';
  return null; // e.g. File:FileType, ImageWidth/Height — not privacy-relevant
}

// With -G0, ExifTool files its own synthesized facts about the file ON DISK — name, directory, size,
// permissions, and (critically) the temp copy's filesystem mtime/atime/ctime — under the same "File"
// group as real embedded tags for some formats (e.g. JPEG's "File:Comment"). None of these describe the
// *file's own* history: they're about whatever host filesystem happens to be holding the temp copy
// withTempCopy() just wrote, and a fresh copy's mtime is always "now" — so without this exclusion,
// classifyExiftoolTag's date/time regex flags File:FileModifyDate et al. as leaked capture time on every
// single call, and a heic/heif file scrubbed via this path could never pass its own post-scrub inspect().
// Found the same way as the matroska muxer furniture in classifyFfmpegTag: cross-checking against a real
// ExifTool-stripped file and finding 'time' reported with no real date tag left to explain it.
const FILESYSTEM_TAGS = new Set(['SourceFile', 'FileName', 'Directory', 'FileSize', 'FileModifyDate', 'FileAccessDate', 'FileCreateDate', 'FileInodeChangeDate', 'FilePermissions', 'FileType', 'FileTypeExtension', 'MIMEType']);

async function analyzeExiftool(toolPath, inPath, ctx) {
  let stdout;
  try {
    ({ stdout } = await execFileP(toolPath, ['-j', '-G0', inPath], { timeout: TIMEOUT_MS, windowsHide: true }));
  } catch (e) {
    throw new ScrubError(`"${ctx.name}" couldn't be read by ExifTool (${briefError(e)}).`);
  }
  let data;
  try {
    data = JSON.parse(stdout)[0] ?? {};
  } catch {
    throw new ScrubError(`"${ctx.name}": ExifTool returned output the clean-room step couldn't read.`);
  }
  const cats = new Set();
  for (const key of Object.keys(data)) {
    const tag = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
    if (FILESYSTEM_TAGS.has(tag)) continue;
    const cat = classifyExiftoolTag(tag);
    if (cat) cats.add(cat);
  }
  return [...cats];
}

async function stripExiftool(toolPath, inPath, ctx) {
  try {
    await execFileP(toolPath, ['-all=', '-tagsfromfile', '@', '-Orientation', '-overwrite_original', inPath], {
      timeout: TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (e) {
    throw new ScrubError(`"${ctx.name}" couldn't be cleaned by ExifTool (${briefError(e)}).`);
  }
}

// libavformat's matroska muxer always writes its own bare "encoder" (WritingApp/MuxingApp) tag and a
// per-stream "DURATION" tag, whatever -map_metadata/-metadata says: verified by muxing a source with no
// metadata at all through `-c copy` and finding both still there. Neither carries anything from the
// original file — DURATION is the stream length ffmpeg itself just computed, and a bare "Lavf" with no
// version is what the muxer writes once real metadata is gone, not something copied from the source — so
// they're structural container furniture, the ffmpeg-tag equivalent of JPEG's Orientation, not metadata
// to flag. A real encoder string (e.g. "Lavf63.7.100", "HandBrake 1.6.1") still classifies as software.
const BARE_ENCODER = 'Lavf';
const MATROSKA_DURATION = /^\d{2}:\d{2}:\d{2}\.\d+$/;

/** ffmpeg tag key (+ value, for the two structural exceptions above) → category, or null when it's not metadata. */
function classifyFfmpegTag(tag, value = '') {
  const t = tag.toLowerCase();
  if (t === 'encoder' && value.trim() === BARE_ENCODER) return null;
  if (t === 'duration' && MATROSKA_DURATION.test(value.trim())) return null;
  if (t.includes('location') || t.includes('gps') || t.includes('iso6709')) return 'location';
  if (t.includes('make') || t.includes('model')) return 'device';
  if (t.includes('date') || t.includes('creation') || t === 'time') return 'time';
  if (t.includes('encoder') || t.includes('software') || t.includes('handler_name')) return 'software';
  if (t.includes('artist') || t.includes('author') || t.includes('composer')) return 'author';
  if (t.includes('title') || t.includes('comment') || t.includes('description')) return 'text';
  if (t.startsWith('xmp')) return 'other';
  return 'other';
}

/** ffmpeg has no metadata-dump mode with no output file; -i alone exits non-zero but still prints the input's metadata to stderr. */
async function analyzeFfmpeg(toolPath, inPath, ctx) {
  let stderr = '';
  try {
    await execFileP(toolPath, ['-hide_banner', '-i', inPath], { timeout: TIMEOUT_MS, windowsHide: true });
  } catch (e) {
    stderr = (e.stderr || '').toString();
  }
  if (!stderr) throw new ScrubError(`"${ctx.name}" couldn't be read by ffmpeg.`);
  const cats = new Set();
  let inMeta = false;
  for (const rawLine of stderr.split(/\r?\n/)) {
    if (/^\s*Metadata:\s*$/.test(rawLine)) { inMeta = true; continue; }
    if (!inMeta) continue;
    const m = /^\s{4,}([\w.-]+)\s*:\s*(.*)$/.exec(rawLine);
    if (!m) { inMeta = false; continue; }
    const cat = classifyFfmpegTag(m[1], m[2]);
    if (cat) cats.add(cat);
  }
  return [...cats];
}

async function stripFfmpeg(toolPath, inPath, outPath, ctx) {
  try {
    await execFileP(
      toolPath,
      ['-y', '-i', inPath, '-map', '0', '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy', '-fflags', '+bitexact', outPath],
      { timeout: TIMEOUT_MS, windowsHide: true },
    );
  } catch (e) {
    throw new ScrubError(`"${ctx.name}" couldn't be cleaned by ffmpeg (${briefError(e)}).`);
  }
}

function requireTool(ctx) {
  const tool = toolFor(ctx.ext);
  const toolPath = ctx.tools?.[tool];
  if (!toolPath) throw new ScrubError(missingToolMessage(ctx));
  return { tool, toolPath };
}

/**
 * @param {Buffer} buf
 * @param {{ name: string, ext: string, tools: { exiftool: string|null, ffmpeg: string|null } }} ctx
 * @returns {Promise<{ buffer: Buffer, removed: string[] }>}
 */
export async function scrub(buf, ctx) {
  const { tool, toolPath } = requireTool(ctx);
  return withTempCopy(buf, ctx.ext, async (dir, inPath) => {
    if (tool === 'exiftool') {
      const before = await analyzeExiftool(toolPath, inPath, ctx);
      await stripExiftool(toolPath, inPath, ctx);
      const buffer = await fsp.readFile(inPath);
      return { buffer, removed: before };
    }
    const before = await analyzeFfmpeg(toolPath, inPath, ctx);
    const outPath = path.join(dir, `out.${ctx.ext}`);
    await stripFfmpeg(toolPath, inPath, outPath, ctx);
    const buffer = await fsp.readFile(outPath);
    return { buffer, removed: before };
  });
}

/** Categories the installed tool currently reports. Throws ScrubError when no tool is installed, or the tool can't read the file. */
export async function inspect(buf, ctx) {
  const { tool, toolPath } = requireTool(ctx);
  return withTempCopy(buf, ctx.ext, (_dir, inPath) =>
    tool === 'exiftool' ? analyzeExiftool(toolPath, inPath, ctx) : analyzeFfmpeg(toolPath, inPath, ctx),
  );
}

// Re-exported so tests can decide which extensions route to which tool without duplicating the map,
// and exercise the tag classifiers (and what analyzeExiftool excludes before classifying) directly,
// without needing exiftool/ffmpeg installed.
export { toolFor, classifyExiftoolTag, classifyFfmpegTag, FILESYSTEM_TAGS };
