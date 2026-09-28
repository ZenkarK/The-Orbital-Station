import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateLines, fitTitleFontSize, TITLE_FONT_STEPS } from '../../src/lib/og-title-fit.ts';

/* READ-02 — the pure step-down function behind the generated cards' title sizing.
   The renderer (src/lib/og-card.ts) hands satori whatever size this returns and lets
   satori's own line-clamp ellipsize anything that still overflows; these tests only
   cover the size-picking math, not real font shaping. */

const BOX = 1056; // 1200px card minus the card's left+right padding

test('a short title gets the largest step', () => {
  assert.equal(fitTitleFontSize('Six Orbits, One Center of Mass', BOX), TITLE_FONT_STEPS[0]);
});

test('an empty title is treated as one line and gets the largest step', () => {
  assert.equal(fitTitleFontSize('', BOX), TITLE_FONT_STEPS[0]);
  assert.equal(estimateLines('', 48, BOX), 1);
});

test('a very long title falls back to the smallest step', () => {
  const longTitle =
    'A Structured Learning Path Into Philosophy, Focused on Existential Questions About Meaning, Mortality and Free Will in Everyday Life';
  assert.equal(fitTitleFontSize(longTitle, BOX), TITLE_FONT_STEPS[TITLE_FONT_STEPS.length - 1]);
});

test('fitTitleFontSize always returns one of the configured steps', () => {
  const titles = ['', 'X', 'A reasonably long but not absurd headline about orbits and stations'];
  for (const title of titles) assert.ok(TITLE_FONT_STEPS.includes(fitTitleFontSize(title, BOX)));
});

test('shrinking the font size never increases the estimated line count', () => {
  const title = 'The Year the Benchmarks Ran Out — An AI Essay About Limits';
  const sizes = [...TITLE_FONT_STEPS].sort((a, b) => b - a);
  let prev = Infinity;
  for (const size of sizes) {
    const lines = estimateLines(title, size, BOX);
    assert.ok(lines <= prev, 'estimateLines should be monotonic non-increasing as font size shrinks');
    prev = lines;
  }
});

test('a narrower box wraps to at least as many lines as a wider one', () => {
  const title = 'Six Orbits, One Center of Mass: Notes on Building a Personal Station';
  const wide = estimateLines(title, 48, 1200);
  const narrow = estimateLines(title, 48, 400);
  assert.ok(narrow >= wide);
});

test('a single very long word still returns a finite, sane line count', () => {
  const lines = estimateLines('Supercalifragilisticexpialidocious'.repeat(4), 48, BOX);
  assert.ok(Number.isFinite(lines) && lines >= 1);
});
