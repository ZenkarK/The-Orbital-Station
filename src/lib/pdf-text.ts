/* Text sanitising for the CV PDF (GROW-06). cv.pdf.ts draws with pdf-lib's
   standard Helvetica fonts rather than embedding one, so every string handed
   to drawText has to survive that font's built-in WinAnsi (Windows-1252)
   encoding — anything outside it makes pdf-lib throw at build time instead
   of failing quietly. No imports on purpose: tests/site/pdf-text.test.mjs
   loads this file directly, the same way tests/site/orrery-layout.test.mjs
   loads orrery-layout.ts. */

/** The block of WinAnsi code points (0x80–0x9F) that aren't a 1:1 copy of
    Latin-1 — typographic marks the station's own copy already leans on
    (em/en dash, curly quotes, ellipsis, bullet) plus a few others WinAnsi
    happens to define there. Everything else in that byte range is unused. */
const WIN_ANSI_SPECIALS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018,
  0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/** True for a code point pdf-lib's standard-font WinAnsi encoding draws unchanged:
    printable ASCII, the Latin-1 supplement (covers most Western accented letters —
    é, ü, ñ, ç, …), and the special block above. */
function isWinAnsi(codePoint: number): boolean {
  return (
    (codePoint >= 0x20 && codePoint <= 0x7e) || (codePoint >= 0xa0 && codePoint <= 0xff) || WIN_ANSI_SPECIALS.has(codePoint)
  );
}

/** ASCII stand-ins for a few Unicode characters this station's copy actually
    uses (arrow links, minus signs) that fall outside WinAnsi. Note: × (U+00D7,
    multiplication sign) is NOT listed here even though it might look like a
    candidate — it's already inside the Latin-1 supplement range isWinAnsi()
    passes through unchanged (and WinAnsi/cp1252 does define it at 0xD7), so
    toWinAnsi() never even consults this table for it. */
const FALLBACKS: Record<string, string> = {
  '→': '->', // → , as in "READ →"
  '←': '<-',
  '−': '-', // − minus sign (U+2212 — outside WinAnsi, unlike the hyphen-minus)
};

/**
 * Sanitises text for pdf-lib's standard Helvetica fonts. Known look-alikes get
 * an ASCII stand-in; anything else the font can't encode becomes '?' rather
 * than throwing while the CV is being built. Safe to call on already-clean
 * ASCII — it's a no-op.
 */
export function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of text) {
    const codePoint = ch.codePointAt(0)!;
    out += isWinAnsi(codePoint) ? ch : (FALLBACKS[ch] ?? '?');
  }
  return out;
}
