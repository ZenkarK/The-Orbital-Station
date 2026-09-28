/* Pure title-fitting math for the generated OG/social cards (READ-02). No imports on
   purpose, like orrery-layout.ts: the Node test runner loads this file directly, and
   the card renderer (src/lib/og-card.ts) imports it as an ordinary module.

   Satori (the SVG renderer used at build time, see og-card.ts) does the real text
   shaping and wrapping — this file only decides which font size to hand it. It steps
   down through a fixed list of sizes and returns the largest one whose *estimated*
   wrap still fits within TITLE_MAX_LINES lines. If even the smallest step doesn't
   fit, satori's own line-clamp CSS (WebkitLineClamp) ellipsizes whatever's left at
   render time — so a title too long to ever fit still renders cleanly instead of
   overflowing the card. */

/** Archivo Bold steps tried largest to smallest, in px, for a card's title. */
export const TITLE_FONT_STEPS: readonly number[] = [64, 56, 50, 44, 40, 36];

/** However long a title runs, it's clamped to this many lines (see og-card.ts). */
export const TITLE_MAX_LINES = 3;

/** Archivo Bold's average glyph advance width, as a fraction of its font size — rough
    on purpose: it only has to be close enough to pick a font size, since satori does
    the actual wrapping. (Real shaping varies letter to letter; this is a deliberately
    simple stand-in, not a substitute for it.) */
const AVG_CHAR_WIDTH_EM = 0.58;

/** How many lines `text` would wrap to at `fontSize`, inside a box `boxWidth` px wide. */
export function estimateLines(text: string, fontSize: number, boxWidth: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length || boxWidth <= 0) return 1;
  const charWidth = fontSize * AVG_CHAR_WIDTH_EM;
  let lines = 1;
  let lineWidth = 0;
  for (const word of words) {
    const wordWidth = word.length * charWidth;
    const withGap = lineWidth > 0 ? lineWidth + charWidth + wordWidth : wordWidth;
    if (lineWidth > 0 && withGap > boxWidth) {
      lines += 1;
      lineWidth = wordWidth;
    } else {
      lineWidth = withGap;
    }
  }
  return lines;
}

/**
 * The largest step from TITLE_FONT_STEPS whose estimated wrap fits `title` inside
 * TITLE_MAX_LINES lines at `boxWidth` px; the smallest step if none of them do.
 */
export function fitTitleFontSize(title: string, boxWidth: number): number {
  for (const size of TITLE_FONT_STEPS) {
    if (estimateLines(title, size, boxWidth) <= TITLE_MAX_LINES) return size;
  }
  return TITLE_FONT_STEPS[TITLE_FONT_STEPS.length - 1];
}
