/* =============================================================
   PDF clean-room scrub (PRIV-04)

   pdf-lib (last release Nov 2021, ~278 open issues — maintenance is
   stalled, so this file leans on its low-level `context` API rather
   than anything newer) can set and clear the trailer's /Info
   dictionary, but "the original metadata is never actually removed"
   from a naive edit: incremental updates leave the old /Info and any
   /Metadata (XMP) objects sitting in the file, unreferenced but still
   readable by anyone who opens it in a hex editor. So instead of
   editing values in place, we:
     1. detach every /Info, /Metadata and /PieceInfo reference we can
        find, anywhere in the document (not just the catalog — pages,
        XObjects and fonts can each carry their own /Metadata), and
        every annotation's own /T (author), /Contents/RC (comment
        text) and /M (modified date) — a sticky note or reply carries
        its own name and text, entirely separate from the document's
        /Info — plus any AcroForm field's entered /V value, and
     2. garbage-collect: keep only the objects still reachable from
        the trailer's /Root and drop everything else from the
        context's object table (there is no built-in API for this;
        `context.indirectObjects`/`context.delete` are pdf-lib
        internals, reached into on purpose here).
   `save({ useObjectStreams: false })` then writes every surviving
   object as a plain, inspectable indirect object instead of packing
   them into compressed object streams.

   Encrypted PDFs and ones with an embedded/attached file are refused
   outright: pdf-lib can't check either for hidden content.
   ============================================================= */
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFStream,
  PDFRef,
  PDFString,
  PDFHexString,
} from 'pdf-lib';
import { ScrubError } from './index.mjs';

const N = (s) => PDFName.of(s);

// Standard /Info dictionary keys, grouped by the category they leak.
const INFO_CATEGORY = {
  Author: 'author',
  Creator: 'software',
  Producer: 'software',
  CreationDate: 'time',
  ModDate: 'time',
  Title: 'text',
  Subject: 'text',
  Keywords: 'text',
};

// file:// URIs and absolute local paths (Windows user profile, macOS/Linux home) in any string.
const LOCAL_PATH = /file:\/\/|[A-Za-z]:\\(?:Users|Documents and Settings)\\|\/Users\/[^/\s)]+\/|\/home\/[^/\s)]+\//i;

/** True if the document has an attached file pdf-lib can't verify is clean. */
function hasEmbeddedFiles(doc) {
  const names = doc.catalog.lookupMaybe(N('Names'), PDFDict);
  if (names?.has(N('EmbeddedFiles'))) return true;
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookupMaybe(i, PDFDict);
      if (annot?.get(N('Subtype')) === N('FileAttachment')) return true;
    }
  }
  return false;
}

/**
 * Walk every object reachable from the trailer's /Root exactly once.
 * `onContainer(dict)` runs on each dict (including a stream's dict) before
 * its children are queued, so it can delete keys to prune what gets walked
 * (and, later, garbage-collected). `onString(value)` runs on every string.
 */
function walk(context, { onContainer, onString }) {
  const seen = new Set();
  const stack = [context.trailerInfo.Root];
  while (stack.length) {
    const val = stack.pop();
    if (val instanceof PDFRef) {
      if (seen.has(val)) continue;
      seen.add(val);
      stack.push(context.lookup(val));
    } else if (val instanceof PDFStream) {
      onContainer?.(val.dict);
      stack.push(val.dict);
    } else if (val instanceof PDFDict) {
      onContainer?.(val);
      for (const v of val.values()) stack.push(v);
    } else if (val instanceof PDFArray) {
      for (const v of val.asArray()) stack.push(v);
    } else if (val instanceof PDFString || val instanceof PDFHexString) {
      onString?.(val.decodeText());
    }
  }
  return seen;
}

/** Delete every indirect object not reachable from /Root (drops orphaned /Info, /Metadata, ... from earlier revisions). */
function garbageCollect(context) {
  const reachable = walk(context, {});
  for (const ref of [...context.indirectObjects.keys()]) {
    if (!reachable.has(ref)) context.delete(ref);
  }
}

async function load(buf, ctx) {
  // ignoreEncryption: true so we can inspect doc.isEncrypted ourselves — pdf-lib's own
  // EncryptedPDFError can't be caught with `instanceof` here (this build's tslib ES5
  // Error-subclassing leaves e.constructor === Error, not EncryptedPDFError).
  let doc;
  try {
    doc = await PDFDocument.load(buf, { updateMetadata: false, ignoreEncryption: true });
  } catch (e) {
    throw new ScrubError(`"${ctx.name}" isn't a PDF the clean-room step can read (${e.message}).`);
  }
  if (doc.isEncrypted) {
    throw new ScrubError(`"${ctx.name}" is password-protected. Remove the password and publish an unlocked copy.`);
  }
  return doc;
}

/** Clean one PDF. Throws ScrubError if it's encrypted, has an attachment, or still leaks a local path. */
export async function scrub(buf, ctx) {
  const doc = await load(buf, ctx);
  const { context } = doc;

  if (hasEmbeddedFiles(doc)) {
    throw new ScrubError(
      `"${ctx.name}" has an embedded or attached file, which the clean-room step can't check for hidden ` +
        `metadata. Remove the attachment (or publish it separately) and export again.`,
    );
  }

  const removed = new Set();

  // /Info: read what it holds, then drop the whole thing rather than clearing fields one by one —
  // clearing a value with pdf-lib still leaves the old object sitting in the file until GC runs.
  const info = context.lookup(context.trailerInfo.Info);
  if (info instanceof PDFDict) {
    for (const key of info.keys()) removed.add(INFO_CATEGORY[key.asString().slice(1)] ?? 'other');
  }
  context.trailerInfo.Info = undefined;

  let leakedPath = false;
  walk(context, {
    onContainer(dict) {
      if (dict.has(N('Metadata'))) {
        dict.delete(N('Metadata'));
        removed.add('other');
      }
      if (dict.has(N('PieceInfo'))) {
        dict.delete(N('PieceInfo'));
        removed.add('software');
      }
      // Every annotation dictionary (Subtype + the required Rect) — a sticky note, a tracked-change-style
      // comment, a reply — can carry its own author name, comment body and edit time, none of which the
      // document's own /Info dictionary says anything about.
      if (dict.has(N('Subtype')) && dict.has(N('Rect'))) {
        if (dict.has(N('T'))) { dict.delete(N('T')); removed.add('author'); } // the annotation's author
        if (dict.has(N('Contents'))) { dict.delete(N('Contents')); removed.add('text'); } // the comment body
        if (dict.has(N('RC'))) { dict.delete(N('RC')); removed.add('text'); } // rich-text comment body
        if (dict.has(N('M'))) { dict.delete(N('M')); removed.add('time'); } // last-modified date
        if (dict.has(N('IRT'))) dict.delete(N('IRT')); // reference to the annotation this replies to
      }
      // A fillable form field's entered value — whatever the reader typed — is content, not furniture.
      if (dict.has(N('FT')) && dict.has(N('V'))) {
        dict.delete(N('V'));
        removed.add('other');
      }
    },
    onString(text) {
      if (LOCAL_PATH.test(text)) leakedPath = true;
    },
  });

  if (leakedPath) {
    throw new ScrubError(
      `"${ctx.name}" still has a link to a file on your computer (a file:// URL or absolute path in a ` +
        `string, URI, Launch or "go to remote document" action). Remove that link and publish again.`,
    );
  }

  garbageCollect(context);

  const bytes = await doc.save({ useObjectStreams: false });
  return { buffer: Buffer.from(bytes), removed: [...removed] };
}

/** What metadata a PDF still carries. [] means clean. Reloads with pdf-lib, same as scrub()'s own re-check. */
export async function inspect(buf, ctx) {
  const doc = await load(buf, ctx);
  const { context } = doc;

  if (hasEmbeddedFiles(doc)) {
    throw new ScrubError(`"${ctx.name}" has an embedded or attached file, which can't be checked for hidden metadata.`);
  }

  const found = new Set();
  const info = context.lookup(context.trailerInfo.Info);
  if (info instanceof PDFDict) {
    for (const key of info.keys()) found.add(INFO_CATEGORY[key.asString().slice(1)] ?? 'other');
  }
  walk(context, {
    onContainer(dict) {
      if (dict.has(N('Metadata'))) found.add('other');
      if (dict.has(N('PieceInfo'))) found.add('software');
      if (dict.has(N('Subtype')) && dict.has(N('Rect'))) {
        if (dict.has(N('T'))) found.add('author');
        if (dict.has(N('Contents'))) found.add('text');
        if (dict.has(N('RC'))) found.add('text');
        if (dict.has(N('M'))) found.add('time');
      }
      if (dict.has(N('FT')) && dict.has(N('V'))) found.add('other');
    },
    onString(text) {
      if (LOCAL_PATH.test(text)) found.add('path');
    },
  });
  return [...found];
}
