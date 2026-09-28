/* GROW-06 — the CV PDF draws with pdf-lib's standard (non-embedded) Helvetica,
   whose WinAnsi encoding can't represent every Unicode character. toWinAnsi
   sanitises text before it reaches drawText, so a name or summary with an
   unusual character fails soft ('?') instead of throwing the whole build.
   Imports pdf-text.ts directly (it has no extensionless imports, so Node's
   type-stripping can resolve it) — see tests/site/orrery-layout.test.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toWinAnsi } from '../../src/lib/pdf-text.ts';

test('plain ASCII passes through unchanged', () => {
  assert.equal(toWinAnsi('Systems Engineer, 2019-2023.'), 'Systems Engineer, 2019-2023.');
  assert.equal(toWinAnsi(''), '');
});

test('Latin-1 accented letters (WinAnsi 0xA0-0xFF) pass through unchanged', () => {
  assert.equal(toWinAnsi('Edwin Lefèvre'), 'Edwin Lefèvre');
  assert.equal(toWinAnsi('café, naïve, Zürich, São Paulo'), 'café, naïve, Zürich, São Paulo');
});

test('WinAnsi special-block typography (curly quotes, dashes, ellipsis, bullet) passes through unchanged', () => {
  assert.equal(toWinAnsi('em—dash, en–dash, “quoted”, ‘single’, ellipsis…, a bullet •'), 'em—dash, en–dash, “quoted”, ‘single’, ellipsis…, a bullet •');
});

test('a right arrow — used across the site’s own copy — becomes an ASCII stand-in', () => {
  assert.equal(toWinAnsi('READ →'), 'READ ->');
  assert.equal(toWinAnsi('← BACK'), '<- BACK');
});

test('characters with no WinAnsi representation at all become a safe placeholder, not a throw', () => {
  assert.equal(toWinAnsi('😀'), '?');
  assert.equal(toWinAnsi('日本語'), '???');
  assert.equal(toWinAnsi('Zenkar 😀 日本語'), 'Zenkar ? ???');
});

test('mixed real-world CV text sanitises character-by-character, keeping everything encodable', () => {
  const input = 'Café Résumé → Système; 日';
  assert.equal(toWinAnsi(input), 'Café Résumé -> Système; ?');
});
