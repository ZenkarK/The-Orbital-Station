/* GROW-06 — the CV PDF, generated at build time from the same profile data as
   /professional/ (src/content/profile.yaml, via lib/content.ts). Built with
   pdf-lib's standard (non-embedded) Helvetica fonts rather than a custom
   embedded font — no extra font files to ship, at the cost of needing
   lib/pdf-text.ts's WinAnsi sanitising, since that encoding can't represent
   every Unicode character.

   Deterministic, and clean of anything that would fingerprint this machine
   or this tool: CreationDate/ModDate are stamped from PHASE_LOGGED (not
   `new Date()`), Producer/Creator are "Orbital Station", and Author/Subject/
   Keywords are never set. `PDFDocument.create({ updateMetadata: false })`
   is required for this — otherwise pdf-lib stamps its own name into
   `Producer` and the real wall-clock time into `CreationDate`. */
import type { APIContext } from 'astro';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { SITE, PHASE_LOGGED } from '../site.config';
import { getProfile, getSelectedWork } from '../lib/content';
import { toWinAnsi } from '../lib/pdf-text';

/* The narrower of A4's width and Letter's height, on each axis — so the page
   fits inside *either* paper size at 100% scale, whichever the owner prints
   on. (A4 is 595.28×841.89pt, Letter 612×792pt.) */
const PAGE_W = 595.28;
const PAGE_H = 792;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = rgb(0.12, 0.12, 0.12);
const DIM = rgb(0.42, 0.42, 0.42);
const RULE = rgb(0.78, 0.78, 0.78);

interface DrawOptions {
  font?: PDFFont;
  size?: number;
  color?: ReturnType<typeof rgb>;
  gap?: number;
}

export async function GET(_context: APIContext) {
  const profile = await getProfile();
  const selectedWork = await getSelectedWork();

  const doc = await PDFDocument.create({ updateMetadata: false });
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };

  /** Starts a new page if `needed` more points of height won't fit above the bottom margin. */
  const ensure = (needed: number) => {
    if (y - needed < MARGIN) newPage();
  };

  /** Greedy word wrap at `font`/`size` within `maxWidth`. Sanitises to WinAnsi first —
      a standard font can only draw what that encoding represents (see lib/pdf-text.ts). */
  const wrap = (text: string, font: PDFFont, size: number, maxWidth: number): string[] => {
    const words = toWinAnsi(text).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const attempt = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(attempt, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = attempt;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  const draw = (text: string, opts: DrawOptions = {}) => {
    const { font = regular, size = 10, color = INK, gap = 4 } = opts;
    for (const line of wrap(text, font, size, CONTENT_W)) {
      ensure(size + gap);
      page.drawText(line, { x: MARGIN, y: y - size, size, font, color });
      y -= size + gap;
    }
  };

  const rule = () => {
    ensure(14);
    y -= 4;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1, color: RULE });
    y -= 12;
  };

  const heading = (text: string) => {
    ensure(30);
    y -= 8;
    draw(text.toUpperCase(), { font: bold, size: 10.5, color: DIM, gap: 8 });
  };

  /* ---------- header ---------- */
  draw(`${SITE.author} — CV`, { font: bold, size: 21, gap: 8 });
  if (profile.headline) draw(profile.headline, { size: 11.5, color: DIM, gap: 10 });

  const contact = [SITE.channels.email, SITE.channels.github, SITE.channels.linkedin, SITE.channels.bluesky, SITE.channels.mastodon, SITE.channels.x]
    .filter(Boolean)
    .join('   ·   ');
  if (contact) draw(contact, { size: 9, color: DIM, gap: 12 });

  rule();

  /* ---------- summary ---------- */
  if (profile.summary) {
    draw(profile.summary, { size: 10.5, gap: 14 });
  }

  /* ---------- roles ---------- */
  if (profile.roles.length > 0) {
    heading('Roles');
    for (const r of profile.roles) {
      const span = [r.org, [r.start, r.end].filter(Boolean).join('–')].filter(Boolean).join(' · ');
      draw(r.title, { font: bold, size: 11, gap: 2 });
      if (span) draw(span, { size: 9, color: DIM, gap: 4 });
      draw(r.summary || '', { size: 10, gap: r.summary ? 12 : 2 });
    }
  }

  /* ---------- expertise ---------- */
  const expertise = profile.expertise.filter((e) => e.items.length > 0);
  if (expertise.length > 0) {
    heading('Expertise');
    for (const e of expertise) draw(`${e.area}: ${e.items.join(', ')}`, { size: 10, gap: 8 });
  }

  /* ---------- selected work ---------- */
  if (selectedWork.length > 0) {
    heading('Selected work');
    for (const w of selectedWork) {
      draw(w.title, { font: bold, size: 11, gap: 2 });
      draw(w.summary || '', { size: 10, gap: w.summary ? 12 : 2 });
    }
  }

  /* ---------- education ---------- */
  if (profile.education.length > 0) {
    heading('Education');
    for (const ed of profile.education) draw([ed.degree, ed.institution, ed.year].filter(Boolean).join(' · '), { size: 10, gap: 8 });
  }

  /* ---------- deterministic, fingerprint-free metadata ---------- */
  doc.setTitle(`${SITE.author} — CV`);
  doc.setProducer('Orbital Station');
  doc.setCreator('Orbital Station');
  const stamped = new Date(`${PHASE_LOGGED}T00:00:00.000Z`);
  doc.setCreationDate(stamped);
  doc.setModificationDate(stamped);

  const bytes = await doc.save();
  const filename = `${SITE.author.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'cv'}-cv.pdf`;

  // Buffer, not the raw Uint8Array pdf-lib returns — TS's DOM lib and Node's Uint8Array
  // typings disagree on BodyInit's generic here; Buffer is unambiguously accepted.
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
    },
  });
}
