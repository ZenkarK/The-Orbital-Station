/* =============================================================
   Obsidian note body → Orbital Station Markdown.

   Pure apart from rendering heading anchors through the site's own Markdown
   pipeline: every file-system question goes through the `env` callbacks, so
   this module can be unit-tested with a fake vault. What it handles:

     · %% comments %% and <!-- comments -->       → removed (they're private);
                                                    a line holding only a comment
                                                    disappears entirely
     · [[wikilinks]], [[note#heading|alias]]      → links to published pages (with
                                                    the anchors the site generates),
                                                    plain text otherwise
     · ![[image.png|alt|300]], ![](path)          → images copied beside the post
     · ![[audio/video/pdf/…]]                     → copied to /files/, embedded/linked
     · ![[Other note]] / #heading / #^block       → transcluded inline (and reported)
     · ==highlights==                             → <mark>
     · ^[inline footnotes]                        → regular footnotes
     · ^block-ids, tag-only lines                 → removed
     · $math$ / $$math$$                          → kept; stray $ escaped the way
                                                    Obsidian reads them ($5 and $10);
                                                    display math always on its own lines
     · a leading "# Title" H1                     → dropped (the page shows the title)
     · Dataview / Tasks / query code blocks       → removed (they only run in Obsidian)
     · soft line breaks                           → hard breaks when the vault
                                                    has strictLineBreaks off
   Callouts (> [!note]) pass through untouched — the site renders them natively.
   Code (fenced, indented and inline) is never modified. Raw notes, canvases and
   bases are never copied as files.
   ============================================================= */
import GithubSlugger from 'github-slugger';
import { markdownToHtml } from 'satteri';
import { satteriHeadingIdsPlugin } from '@astrojs/markdown-satteri';
import { mathPlugin } from '../../src/lib/markdown-plugins.mjs';

/** Formats the site's image pipeline accepts (astro/assets VALID_INPUT_FORMATS). */
export const IMAGE_EXT = new Set(['png', 'apng', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'tiff']);
export const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'opus']);
export const VIDEO_EXT = new Set(['mp4', 'webm', 'ogv', 'mov', 'm4v']);
/** Vault files that are never shipped as downloads: raw notes, canvases, bases. */
export const NEVER_COPY = new Set(['md', 'canvas', 'base']);
const PLUGIN_BLOCKS = new Set(['dataview', 'dataviewjs', 'tasks', 'query', 'button', 'tracker', 'chart', 'meta-bind', 'excalidraw']);
const MAX_EMBED_DEPTH = 3;

const OPEN = '';
const CLOSE = '';
const TOKEN = /(\d+)/g;
const TOKEN_ONLY = /^(\d+)$/;

export const extOf = (p) => {
  const base = p.split('/').pop() ?? '';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
};
/** File name without its extension — for resolved vault paths, which always have one. */
const stem = (p) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '');
const noteName = (p) => (p.split('/').pop() ?? p).replace(/\.md$/i, '');
const humanize = (p) => stem(p).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Escape brackets and lone backslashes for link text — but keep existing escapes like "\$". */
const escLinkText = (s) => s.replace(/\\(?![!-/:-@[-`{-~])|[[\]]/g, '\\$&');
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normTitle = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const isDrawing = (path, body) => /\.excalidraw\.md$/i.test(path) || /^# Excalidraw Data$/m.test(body);

/* ---------------------------------------------------------------
   Heading anchors — computed by the site's own pipeline, so links
   to "#Heading" land on exactly the id the page will have.
   --------------------------------------------------------------- */
const anchorCache = new Map();
export function siteHeadingId(text) {
  const key = text.replace(/\s+/g, ' ').trim();
  if (!anchorCache.has(key)) {
    let id = null;
    try {
      const { html } = markdownToHtml(`## ${key}`, {
        features: { gfm: true, smartPunctuation: true, math: true },
        mdastPlugins: [mathPlugin],
        hastPlugins: [satteriHeadingIdsPlugin()],
      });
      const m = /<h2 id="([^"]*)"/.exec(html);
      if (m) id = m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    } catch {
      /* fall back below */
    }
    anchorCache.set(key, id ?? new GithubSlugger().slug(key));
  }
  return anchorCache.get(key);
}

/* ---------------------------------------------------------------
   1. Protect code and math, drop comments — one left-to-right scan.
   --------------------------------------------------------------- */

const FENCE_OPEN = /^([ \t]*(?:>[ \t]?)*[ \t]*)(`{3,}|~{3,})([^\n]*)$/;
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/;
const lineEndAt = (s, i) => {
  const e = s.indexOf('\n', i);
  return e === -1 ? s.length : e;
};

/** Obsidian's inline-math rule: `$x$`, no space just inside either `$`, closing `$` not before a digit. */
function inlineMathEnd(src, i) {
  const after = src[i + 1];
  if (after === undefined || /\s/.test(after)) return -1;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === '\n' && /^\n[ \t]*(\n|$)/.test(src.slice(j, j + 40))) return -1; // no math across a blank line
    if (c === '$') {
      if (/\s/.test(src[j - 1]) || /\d/.test(src[j + 1] ?? '')) return -1;
      return j;
    }
  }
  return -1;
}

/** Split a line into its blockquote depth, the indentation after the quote markers, and the rest. */
function lineShape(line) {
  const q = /^(?:[ \t]*>[ \t]?)*/.exec(line)[0];
  const rest = line.slice(q.length);
  const indent = /^[ \t]*/.exec(rest)[0].length;
  return { quotes: (q.match(/>/g) ?? []).length, indent, body: rest.slice(indent) };
}
const FOOTNOTE_DEF = /^[ \t]*\[\^[^\]\n]+\]:/;

export function protect(src) {
  const stash = [];
  const put = (entry) => `${OPEN}${stash.push(entry) - 1}${CLOSE}`;
  let out = '';
  let i = 0;
  let lineStart = true;
  let prevBlank = true; // the previous source line was blank (or this is the first line)
  let inContainer = false; // inside a list item or footnote, where indented lines are continuations, not code
  const n = src.length;
  /** Track list/footnote containers line by line (CommonMark: indented and lazy lines stay inside). */
  const noteLine = (line) => {
    if (!line.trim()) {
      prevBlank = true;
      return;
    }
    if (LIST_ITEM.test(line) || FOOTNOTE_DEF.test(line)) inContainer = true;
    else if (/^[ \t]/.test(line) || (!prevBlank && inContainer)) {
      /* indented continuation or lazy continuation — still inside */
    } else inContainer = false;
    prevBlank = false;
  };

  /** Skip a comment ending at `end`; a line that held nothing but the comment vanishes. */
  const skipComment = (end) => {
    const lineSoFar = out.slice(out.lastIndexOf('\n') + 1);
    i = end;
    const atEol = i >= n || src[i] === '\n';
    if (atEol && /^[ \t>]*$/.test(lineSoFar)) {
      out = out.slice(0, out.length - lineSoFar.length);
      if (src[i] === '\n') i++;
      else if (out.endsWith('\n')) out = out.slice(0, -1);
      lineStart = true;
      return;
    }
    if (atEol) out = out.replace(/[ \t]+$/, ''); // no stray spaces (or an accidental <br>) left behind
  };

  while (i < n) {
    if (lineStart) {
      const eol = lineEndAt(src, i);
      const line = src.slice(i, eol);

      const m = FENCE_OPEN.exec(line);
      if (m && !(m[2][0] === '`' && m[3].includes('`'))) {
        // The closing fence must sit in the same container (same blockquote depth) and be indented
        // at most 3 more than the opening; a line that leaves the blockquote ends the block too.
        const mark = m[2];
        const open = lineShape(line);
        const closeRun = new RegExp(`^\\${mark[0]}{${mark.length},}[ \\t]*$`);
        let j = eol + 1;
        let end = n;
        while (j < n) {
          const le = lineEndAt(src, j);
          const shape = lineShape(src.slice(j, le));
          if (open.quotes > 0 && shape.quotes < open.quotes) {
            end = j - 1; // the blockquote ended, and the code block with it
            break;
          }
          if (shape.quotes === open.quotes && shape.indent <= open.indent + 3 && closeRun.test(shape.body)) {
            end = le;
            break;
          }
          if (le >= n) break;
          j = le + 1;
        }
        out += put({ kind: 'fence', lang: m[3].trim().split(/\s+/)[0].toLowerCase(), text: src.slice(i, end) });
        noteLine(line);
        i = end;
        lineStart = false;
        continue;
      }

      // CommonMark indented code: after a blank line, indented 4+, outside any list or footnote.
      if (prevBlank && !inContainer && /^(?: {4}|\t)/.test(line) && line.trim()) {
        let j = i;
        let end = eol;
        while (j < n) {
          const le = lineEndAt(src, j);
          const l = src.slice(j, le);
          if (l.trim() && !/^(?: {4}|\t)/.test(l)) break;
          if (l.trim()) end = le;
          if (le >= n) break;
          j = le + 1;
        }
        out += put({ kind: 'code', text: src.slice(i, end) });
        prevBlank = false;
        i = end;
        lineStart = false;
        continue;
      }
      noteLine(line);
    }

    const c = src[i];
    if (c === '\n') {
      out += c;
      i++;
      lineStart = true;
      continue;
    }
    lineStart = false;

    if (c === '\\' && src[i + 1] !== '\n') {
      out += src.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === '`') {
      let k = 1;
      while (src[i + k] === '`') k++;
      const run = '`'.repeat(k);
      let j = i + k;
      let found = -1;
      while ((j = src.indexOf(run, j)) !== -1) {
        if (src[j + k] !== '`') {
          found = j;
          break;
        }
        while (src[j] === '`') j++;
      }
      if (found === -1 || /\n[ \t]*\n/.test(src.slice(i, found))) {
        out += run;
        i += k;
        continue;
      }
      out += put({ kind: 'code', text: src.slice(i, found + k) });
      i = found + k;
      continue;
    }
    if (c === '%' && src[i + 1] === '%') {
      const end = src.indexOf('%%', i + 2);
      skipComment(end === -1 ? n : end + 2); // an unclosed %% hides the rest of the note, as in Obsidian
      continue;
    }
    if (c === '<' && src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      skipComment(end === -1 ? n : end + 3);
      continue;
    }
    if (c === '$') {
      if (src[i + 1] === '$') {
        const end = src.indexOf('$$', i + 2);
        if (end !== -1) {
          out += put({ kind: 'math', display: true, text: src.slice(i, end + 2) });
          i = end + 2;
        } else {
          out += '\\$\\$';
          i += 2;
        }
        continue;
      }
      const end = inlineMathEnd(src, i);
      if (end !== -1) {
        // The site's parser ends inline math at "\$" — spell an escaped dollar as {\char36} instead.
        out += put({ kind: 'math', display: false, text: `$${src.slice(i + 1, end).replace(/\\\$/g, '{\\char36}')}$` });
        i = end + 1;
      } else {
        out += '\\$'; // a literal dollar in Obsidian — keep it literal on the site too
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return { text: out, stash };
}

/** Put protected pieces back exactly as they were. */
export function restoreRaw(text, stash) {
  for (let pass = 0; pass < 5 && text.includes(OPEN); pass++) text = text.replace(TOKEN, (_, n) => stash[Number(n)].text);
  return text;
}

function restore(text, stash, warnings) {
  for (let pass = 0; pass < 5 && text.includes(OPEN); pass++) {
    text = text.replace(TOKEN, (_, n) => {
      const e = stash[Number(n)];
      if (e.kind === 'fence' && PLUGIN_BLOCKS.has(e.lang)) {
        warnings.push(`Removed a \`${e.lang}\` block — it only renders inside Obsidian.`);
        return '';
      }
      if (e.kind === 'fence' && e.lang === 'mermaid') warnings.push('Mermaid diagrams are shown as code on the site.');
      return e.text;
    });
  }
  return text;
}

const isBlockToken = (stash, line) => {
  const m = TOKEN_ONLY.exec(line.replace(/^[ \t]*(?:>[ \t]?)*/, '').trim());
  if (!m) return false;
  const e = stash[Number(m[1])];
  return e.kind === 'fence' || e.kind === 'raw' || (e.kind === 'code' && !e.text.startsWith('`')) || (e.kind === 'math' && e.display);
};

/**
 * A multi-line `$$` block must sit on its own lines as `$$` / tex / `$$` — sharing a line
 * with text (`So $$` … `$$ follows`) makes the site's parser swallow the rest of the page.
 * A one-line `$$x$$` alone on its line becomes the same block form (display, as in Obsidian).
 * One-line `$$x$$` inside text, tables or list items is safe and is left alone.
 */
function isolateDisplayMath(lines, stash) {
  const out = [];
  for (const line of lines) {
    if (!line.includes(OPEN)) {
      out.push(line);
      continue;
    }
    const prefix = /^[ \t]*(?:>[ \t]?)*/.exec(line)[0];
    const edge = prefix.trimEnd();
    const content = line.slice(prefix.length);
    const alone = TOKEN_ONLY.test(content.trim());
    const parts = content.split(/(\d+)/);
    let buf = '';
    let emitted = false;
    for (const part of parts) {
      const m = TOKEN_ONLY.exec(part);
      const e = m && stash[Number(m[1])];
      if (!e || e.kind !== 'math' || !e.display || (!e.text.includes('\n') && !alone)) {
        buf += part;
        continue;
      }
      if (buf.trim()) out.push(prefix + buf.trimEnd(), edge);
      else if (emitted) out.push(edge);
      buf = '';
      const inner = e.text
        .slice(2, -2)
        .split('\n')
        .map((l) => (edge && l.startsWith(edge) ? l.slice(edge.length).replace(/^[ \t]?/, '') : l).trimEnd())
        .join('\n')
        .trim();
      e.text = [`$$`, ...inner.split('\n'), `$$`].map((l, k) => (k === 0 ? l : `${prefix}${l}`.trimEnd() || edge)).join('\n');
      out.push(`${prefix}${m[0]}`);
      emitted = true;
    }
    if (emitted) {
      if (buf.trim()) out.push(edge, prefix + buf.trim());
    } else out.push(line);
  }
  return out;
}

/* ---------------------------------------------------------------
   2. Section / block extraction for transclusion (structure-aware:
      code, math and comments are opaque while searching).
   --------------------------------------------------------------- */

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t#]*$/;

export function extractSection(body, sub) {
  if (!sub) return body;
  const { text, stash } = protect(body.replace(/\r\n?/g, '\n'));
  const lines = text.split('\n');
  let picked = null;

  if (sub.startsWith('^')) {
    const id = escRe(sub.slice(1));
    const own = lines.findIndex((l) => new RegExp(`(^|\\s)\\^${id}[ \\t]*$`).test(l));
    if (own === -1) return null;
    if (/^[ \t]*(?:>[ \t]?)*\^/.test(lines[own])) {
      // id on its own line → the block just above it (a whole list, table, quote or code block)
      let s = own - 1;
      while (s >= 0 && !lines[s].trim()) s--;
      if (s < 0) return null;
      let b = s;
      while (b > 0 && lines[b - 1].trim() && !HEADING.test(lines[b - 1])) b--;
      picked = lines.slice(b, s + 1);
    } else if (LIST_ITEM.test(lines[own])) {
      // a list item → just that item and whatever is nested under it
      const indent = /^[ \t]*/.exec(lines[own])[0].length;
      let e = own + 1;
      while (e < lines.length && lines[e].trim() && /^[ \t]*/.exec(lines[e])[0].length > indent) e++;
      picked = lines.slice(own, e).map((l) => l.slice(Math.min(indent, /^[ \t]*/.exec(l)[0].length)));
    } else {
      let b = own;
      while (b > 0 && lines[b - 1].trim() && !HEADING.test(lines[b - 1]) && !LIST_ITEM.test(lines[b - 1])) b--;
      picked = lines.slice(b, own + 1);
    }
  } else {
    const want = normTitle(sub.split('#').filter(Boolean).pop() ?? '');
    let start = -1;
    let level = 0;
    let end = lines.length;
    for (let k = 0; k < lines.length; k++) {
      const h = HEADING.exec(lines[k]);
      if (!h) continue;
      if (start === -1) {
        if (normTitle(restoreRaw(h[2], stash)) === want) {
          start = k;
          level = h[1].length;
        }
      } else if (h[1].length <= level) {
        end = k;
        break;
      }
    }
    if (start === -1) return null;
    picked = lines.slice(start, end);
  }
  return restoreRaw(picked.join('\n').replace(/[ \t]+\^[A-Za-z0-9-]+[ \t]*$/gm, ''), stash);
}

/** The heading text in `body` matching an Obsidian link subpath (or null). */
function findHeading(body, sub) {
  const want = normTitle(sub.split('#').filter(Boolean).pop() ?? '');
  const { text, stash } = protect(body.replace(/\r\n?/g, '\n'));
  for (const line of text.split('\n')) {
    const h = HEADING.exec(line);
    if (h && normTitle(restoreRaw(h[2], stash)) === want) return restoreRaw(h[2], stash);
  }
  return null;
}

/* ---------------------------------------------------------------
   3. The conversion.
   --------------------------------------------------------------- */

/**
 * @param {string} body  note body with frontmatter already removed
 * @param {object} env
 * @param {string} env.title          page title (to drop a duplicate "# Title")
 * @param {string} env.notePath       vault-relative path of the note being converted
 * @param {boolean} [env.strictLineBreaks=true]
 * @param {(link: string, from: string) => ({path: string} | null)} env.resolve
 * @param {(path: string) => string} env.readBody   body (no frontmatter) of a vault note
 * @param {(path: string) => (string | null)} env.pageUrl   site URL of a published note, or null
 * @param {(path: string, kind: 'image'|'file') => string} env.asset  copy a vault file, return its URL
 * @param {string[]} [env.warnings]
 * @returns {{ markdown: string, warnings: string[], embeds: string[] }}
 */
export function convertBody(body, env) {
  const warnings = env.warnings ?? [];
  const embeds = [];
  const markdown = convertInner(
    body,
    { ...env, warnings, embeds, depth: 0, seen: new Set([env.notePath]), counter: { footnotes: 0 } },
    true,
  );
  return { markdown, warnings: [...new Set(warnings)], embeds: [...new Set(embeds)] };
}

function convertInner(body, env, topLevel) {
  const { warnings } = env;
  const { text: protectedText, stash } = protect(body.replace(/\r\n?/g, '\n'));
  const put = (text) => `${OPEN}${stash.push({ kind: 'raw', text }) - 1}${CLOSE}`;
  let lines = protectedText.split('\n');

  /* --- block ids, tag-only lines --- */
  lines = lines
    .filter((l) => !/^[ \t]*(?:>[ \t]?)*\^[A-Za-z0-9-]+[ \t]*$/.test(l))
    .filter((l) => !/^[ \t]*(?:#[\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*[ \t]*)+$/u.test(l))
    .map((l) => l.replace(/[ \t]+\^[A-Za-z0-9-]+[ \t]*$/, ''));

  /* --- headings: drop "# Title", then keep a single h1 on the page --- */
  if (topLevel) {
    const first = lines.findIndex((l) => l.trim());
    const h1 = first !== -1 && /^#[ \t]+(.*?)[ \t#]*$/.exec(lines[first]);
    if (h1 && normTitle(restoreRaw(h1[1], stash)) === normTitle(env.title)) {
      lines.splice(first, 1);
      while (lines[first] !== undefined && !lines[first].trim()) lines.splice(first, 1);
    }
  }
  if (lines.some((l) => /^#[ \t]/.test(l))) lines = lines.map((l) => l.replace(/^(#{1,5})(?=[ \t])/, '$1#'));

  /* --- display math always on its own lines --- */
  lines = isolateDisplayMath(lines, stash);

  let text = lines.join('\n');

  /* --- ^[inline footnotes] (bracket-aware; their text goes through the link passes below) --- */
  const footnotes = [];
  text = extractInlineFootnotes(text, (note) => {
    const label = `note-${++env.counter.footnotes}`;
    footnotes.push([label, note]);
    return `[^${label}]`;
  });
  if (footnotes.length) text += `\n\n${footnotes.map(([label, note]) => `[^${label}]: ${note}`).join('\n')}`;

  /* --- Markdown links & images to local files (note targets become wikilinks) --- */
  text = text.replace(
    // label: escapes and one level of [nested] brackets (but not a [[wikilink]]);
    // destination: <angle form> or balanced parentheses, e.g. Lecture%20(2024).md
    /(!?)\[(?!\[)((?:\\.|\[[^\]\n]*\]|[^\]\n\\[])*)\]\(\s*(<[^>\n]+>|(?:[^()\s]|\([^()\s]*\))+)((?:\s+(?:"[^"\n]*"|'[^'\n]*'))?)\s*\)/g,
    (whole, bang, label, rawDest, titlePart) => {
      if (!bang && /^[ xX]$/.test(label)) return whole; // "- [ ] (later)" is a task, not a link
      let dest = rawDest.startsWith('<') ? rawDest.slice(1, -1) : rawDest;
      if (/^obsidian:/i.test(dest)) return bang ? '' : label;
      if (/^[a-z][a-z0-9+.-]*:/i.test(dest) || dest.startsWith('/') || dest.startsWith('//')) {
        return bang ? whole.replace(/\|\s*\d+(x\d+)?(?=\])/, '') : whole; // strip Obsidian "|300" sizes
      }
      if (dest.startsWith('#')) {
        if (bang) return whole;
        return `[${label}](#${anchorIn(env.notePath, safeDecode(dest.slice(1)), env)})`;
      }
      let sub = '';
      const hash = dest.indexOf('#');
      if (hash !== -1) {
        sub = safeDecode(dest.slice(hash + 1));
        dest = dest.slice(0, hash);
      }
      const target = safeDecode(dest);
      const hit = env.resolve(target, env.notePath);
      if (!hit) {
        if (bang) {
          warnings.push(`Image "${target}" wasn't found in the vault — left out.`);
          return '';
        }
        warnings.push(`Link target "${target}" wasn't found in the vault — became plain text.`);
        return label;
      }
      const ext = extOf(hit.path);
      if (ext === 'md') {
        const ref = hit.path.replace(/\.md$/i, '') + (sub ? `#${sub}` : '');
        if (bang) return `![[${ref}]]`; // handled by the transclusion / embed passes below
        if (!/[[\]|]/.test(label)) return `[[${ref}|${label}]]`;
        return noteLink(hit.path, sub, label, env);
      }
      if (NEVER_COPY.has(ext)) return notShipped(hit.path, bang ? '' : label, env);
      if (bang) {
        const alt = label.replace(/\|\s*\d+(x\d+)?\s*$/, '').trim() || humanize(hit.path);
        return mediaFor(hit.path, alt, env, titlePart);
      }
      return `[${label}](${env.asset(hit.path, 'file')})`;
    },
  );

  /* --- note transclusion: an embed alone on its line --- */
  text = text
    .split('\n')
    .map((line) => {
      const m = /^([ \t]*(?:>[ \t]?)*)!\[\[([^\]\n]+)\]\][ \t]*$/.exec(line);
      if (!m) return line;
      const [prefix, inner] = [m[1], m[2]];
      const { target, sub } = parseTarget(inner);
      const hit = target ? env.resolve(target, env.notePath) : { path: env.notePath };
      if (!hit) {
        warnings.push(`Embedded "${target}" wasn't found in the vault — left out.`);
        return prefix.trimEnd();
      }
      if (extOf(hit.path) !== 'md') return line; // an attachment → the inline pass below
      const noteBody = env.readBody(hit.path);
      if (isDrawing(hit.path, noteBody)) {
        warnings.push(`"${noteName(hit.path)}" is an Excalidraw drawing — export it as PNG/SVG to publish it.`);
        return prefix.trimEnd();
      }
      if (env.seen.has(hit.path) && !sub) {
        warnings.push(`Skipped a circular embed of "${noteName(hit.path)}".`);
        return prefix.trimEnd();
      }
      if (env.depth >= MAX_EMBED_DEPTH) {
        warnings.push(`Embeds nested deeper than ${MAX_EMBED_DEPTH} levels were turned into links.`);
        return `${prefix}${linkFor(inner, env)}`;
      }
      const section = extractSection(noteBody, sub);
      if (section == null) {
        warnings.push(`Couldn't find "${sub}" inside "${noteName(hit.path)}" — embed left out.`);
        return prefix.trimEnd();
      }
      if (hit.path !== env.notePath) env.embeds.push(noteName(hit.path) + (sub ? `#${sub}` : ''));
      const converted = convertInner(
        section,
        { ...env, notePath: hit.path, title: '', depth: env.depth + 1, seen: new Set([...env.seen, hit.path]) },
        false,
      );
      const block = converted
        .split('\n')
        .map((l) => (prefix ? `${prefix}${l}`.replace(/[ \t]+$/, '') || prefix.trimEnd() : l))
        .join('\n');
      const edge = prefix.trimEnd(); // blank separator lines, keeping any "> " callout nesting
      return `${edge}\n${put(block)}\n${edge}`;
    })
    .join('\n');

  /* --- wikilinks & inline embeds --- */
  text = text.replace(/(!?)\[\[([^\]\n]+?)\]\]/g, (_, bang, inner) => {
    if (!bang) return linkFor(inner, env);
    const { target, alias } = parseTarget(inner);
    const hit = target ? env.resolve(target, env.notePath) : null;
    if (target && !hit) {
      warnings.push(`Embedded "${target}" wasn't found in the vault — left out.`);
      return '';
    }
    if (!hit || extOf(hit.path) === 'md') {
      if (hit) env.warnings.push(`An inline embed of "${noteName(hit.path)}" became a link.`);
      return linkFor(inner, env); // a note embedded mid-sentence → a link
    }
    if (NEVER_COPY.has(extOf(hit.path))) return notShipped(hit.path, '', env);
    const alt = (alias ?? '')
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s && !/^\d+(x\d+)?$/.test(s))
      .join(' ');
    return mediaFor(hit.path, alt || humanize(hit.path), env, '');
  });

  /* --- ==highlights== (never a setext "=====" underline) --- */
  text = text.replace(/==(?=[^\s=])([^\n]*?[^\s=])==/g, '<mark>$1</mark>');

  /* --- last line of defence: a Markdown image pointing at a local file that wasn't copied
         beside the page would fail the whole site build, so it never leaves this function --- */
  text = text.replace(/!\[((?:\\.|[^\]\n\\])*)\]\(\s*(<[^>\n]+>|(?:[^()\s]|\([^()\s]*\))+)[^)\n]*\)/g, (whole, _alt, rawDest) => {
    const dest = rawDest.replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|\.\/[^/]+$)/i.test(dest)) return whole;
    warnings.push(`Image "${safeDecode(dest)}" couldn't be published — left out.`);
    return '';
  });

  /* --- soft line breaks → hard, when the vault renders them that way --- */
  if (env.strictLineBreaks === false) text = hardenLineBreaks(text, stash);

  text = restore(text, stash, warnings);
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/* --- helpers ------------------------------------------------------ */

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Replace every ^[…] (nested brackets allowed) with the callback's result. */
function extractInlineFootnotes(text, onNote) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '^' && text[i + 1] === '[' && text[i - 1] !== '\\') {
      let depth = 0;
      let j = i + 1;
      let close = -1;
      for (; j < text.length; j++) {
        const c = text[j];
        if (c === '\\') {
          j++;
          continue;
        }
        if (c === '\n' && /^\n[ \t]*\n/.test(text.slice(j, j + 40))) break;
        if (c === '[') depth++;
        else if (c === ']' && --depth === 0) {
          close = j;
          break;
        }
      }
      if (close !== -1) {
        out += onNote(text.slice(i + 2, close).replace(/\s*\n\s*/g, ' '));
        i = close + 1;
        continue;
      }
    }
    out += text[i++];
  }
  return out;
}

/** "folder/Note#Head|Alias" (with "\|" allowed for tables) → parts. */
export function parseTarget(inner) {
  const bar = inner.search(/\\?\|/);
  let target = bar === -1 ? inner : inner.slice(0, bar);
  const alias = bar === -1 ? undefined : inner.slice(bar).replace(/^\\?\|/, '');
  let sub = '';
  const hash = target.indexOf('#');
  if (hash !== -1) {
    sub = target.slice(hash + 1).trim();
    target = target.slice(0, hash);
  }
  return { target: target.trim(), sub, alias: alias?.trim() };
}

/** The site anchor for a heading of note `path`, using the heading as the site will render it. */
function anchorIn(path, sub, env) {
  const heading = findHeading(env.readBody(path) ?? '', sub);
  return siteHeadingId(heading ?? sub.split('#').filter(Boolean).pop() ?? sub);
}

function noteLink(path, sub, text, env) {
  const url = env.pageUrl(path);
  if (!url) {
    env.warnings.push(`"${noteName(path)}" isn't published, so links to it became plain text.`);
    return text;
  }
  const anchor = sub && !sub.startsWith('^') ? `#${anchorIn(path, sub, env)}` : '';
  return `[${text}](${url}${anchor})`;
}

function notShipped(path, text, env) {
  env.warnings.push(`"${path.split('/').pop()}" is an Obsidian ${extOf(path)} file — it isn't published.`);
  return text;
}

function linkFor(inner, env) {
  const { target, sub, alias } = parseTarget(inner);
  const fallback = alias || (target ? noteName(target) + (sub && !sub.startsWith('^') ? ` › ${sub.replace(/^#/, '')}` : '') : sub);
  const text = escLinkText(fallback);
  if (!target) {
    if (!sub || sub.startsWith('^')) return text;
    return `[${text}](#${anchorIn(env.notePath, sub, env)})`;
  }
  const hit = env.resolve(target, env.notePath);
  if (!hit) {
    env.warnings.push(`Link to "${target}" didn't match any note — became plain text.`);
    return text;
  }
  const ext = extOf(hit.path);
  if (NEVER_COPY.has(ext) && ext !== 'md') return notShipped(hit.path, text, env);
  if (ext !== 'md') return `[${text}](${env.asset(hit.path, 'file')})`;
  if (hit.path === env.notePath && sub) return `[${text}](#${anchorIn(env.notePath, sub, env)})`;
  return noteLink(hit.path, sub, text, env);
}

function mediaFor(path, alt, env, titlePart) {
  const ext = extOf(path);
  if (IMAGE_EXT.has(ext)) return `![${escLinkText(alt)}](${env.asset(path, 'image')}${titlePart ?? ''})`;
  const url = env.asset(path, 'file');
  if (AUDIO_EXT.has(ext)) return `<audio controls preload="metadata" src="${escAttr(url)}"></audio>`;
  if (VIDEO_EXT.has(ext)) return `<video controls preload="metadata" src="${escAttr(url)}"></video>`;
  return `[${escLinkText(alt || stem(path))}](${url})`;
}

const stripQuote = (l) => l.replace(/^[ \t]*(?:>[ \t]?)*/, '');

/** Obsidian with "strict line breaks" off shows single newlines as breaks; Markdown needs two spaces. */
function hardenLineBreaks(text, stash) {
  const lines = text.split('\n');
  const startsBlock = (l) =>
    /^(?:[-*+][ \t]|\d+[.)][ \t]|#{1,6}[ \t]|\||[-*_=]{3,}[ \t]*$|\[!)/.test(stripQuote(l).trimStart());
  for (let k = 0; k < lines.length - 1; k++) {
    const cur = lines[k];
    const next = lines[k + 1];
    if (!stripQuote(cur).trim() || !stripQuote(next).trim()) continue;
    if (isBlockToken(stash, cur) || isBlockToken(stash, next)) continue;
    if (/^(?:#{1,6}[ \t]|\|)/.test(stripQuote(cur).trimStart()) || startsBlock(next)) continue;
    if (!/(?: {2}|\\)$/.test(cur)) lines[k] = `${cur}  `;
  }
  return lines.join('\n');
}
