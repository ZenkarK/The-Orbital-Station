/* READ-13 — every orbit colour distinct from every other, and from its ring
   neighbours by more still. sRGB -> OKLab is done right here, with no
   dependency, so the test stays honest about what it's checking. See
   BACKLOG READ-13. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ORBITS } from '../../src/site.config.ts';

/* ---------- sRGB -> OKLab (Björn Ottosson's reference formulas) ---------- */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function rgbToOklab([r, g, b]) {
  const [lr, lg, lb] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const [l_, m_, s_] = [Math.cbrt(l), Math.cbrt(m), Math.cbrt(s)];
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}
/** Euclidean distance in OKLab, scaled by 100 (the card's units). */
function deltaE(hexA, hexB) {
  const [L1, a1, b1] = rgbToOklab(hexToRgb(hexA));
  const [L2, a2, b2] = rgbToOklab(hexToRgb(hexB));
  return Math.sqrt((L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2) * 100;
}

test('every pair of orbit colours is distinct (ΔE >= 9, OKLab ×100)', () => {
  const failures = [];
  for (let i = 0; i < ORBITS.length; i++) {
    for (let j = i + 1; j < ORBITS.length; j++) {
      const de = deltaE(ORBITS[i].color, ORBITS[j].color);
      if (de < 9) failures.push(`${ORBITS[i].name} vs ${ORBITS[j].name}: ΔE ${de.toFixed(2)} < 9`);
    }
  }
  assert.deepEqual(failures, []);
});

test('ring neighbours (adjacent in ORBITS order) are more distinct still (ΔE >= 12)', () => {
  const failures = [];
  for (let i = 0; i < ORBITS.length - 1; i++) {
    const a = ORBITS[i];
    const b = ORBITS[i + 1];
    const de = deltaE(a.color, b.color);
    if (de < 12) failures.push(`${a.name} vs ${b.name}: ΔE ${de.toFixed(2)} < 12`);
  }
  assert.deepEqual(failures, []);
});
