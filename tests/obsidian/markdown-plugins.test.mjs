import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml } from 'satteri';
import { mathPlugin, calloutPlugin, createBasePathPlugin } from '../../src/lib/markdown-plugins.mjs';

const html = (src, base = '/') =>
  markdownToHtml(src, { features: { math: true }, mdastPlugins: [mathPlugin, calloutPlugin, createBasePathPlugin(base)] }).html;

test('inline and display math render with KaTeX', () => {
  const out = html('Entropy $S = A/4G$ and\n\n$$\n\\frac{a}{b}\n$$');
  assert.match(out, /<span class="katex">/);
  assert.match(out, /katex-display/);
  assert.match(out, /<math/); // MathML for screen readers
});

test('"$5 and $10" is not math', () => {
  const out = html('It costs $5 and $10 here.');
  assert.doesNotMatch(out, /katex/);
  assert.match(out, /\$5 and \$10/);
});

test('bad TeX renders in place instead of failing the build', () => {
  assert.match(html('Oops $\\frac{a$ here'), /katex-error|katex/);
});

test('callouts: title with formatting, body, default title, aliases', () => {
  const out = html('> [!warning] Mind the **gap**\n> Body *here*.\n>\n> Second.');
  assert.match(out, /<aside class="callout" data-callout="warning">/);
  assert.match(out, /<p class="callout-title">Mind the <strong>gap<\/strong><\/p>/);
  assert.match(out, /<div class="callout-body"><p>Body <em>here<\/em>.<\/p><p>Second.<\/p><\/div>/);
  assert.match(html('> [!tip]\n> x'), /<p class="callout-title">Tip<\/p>/);
  assert.match(html('> [!faq] Q\n> A'), /data-callout="question"/);
});

test('foldable and nested callouts', () => {
  assert.match(html('> [!note]- Closed\n> hidden'), /<details class="callout" data-callout="note"><summary class="callout-title">Closed<\/summary>/);
  assert.match(html('> [!note]+ Open\n> shown'), /<details class="callout" data-callout="note" open(="")?>/);
  const nested = html('> [!example] Outer\n> > [!quote] Inner\n> > text');
  assert.equal((nested.match(/class="callout"/g) ?? []).length, 2);
});

test('ordinary blockquotes stay blockquotes', () => {
  assert.match(html('> Just a quote.'), /<blockquote>/);
});

test('base path: root-relative links, images and raw HTML get the prefix', () => {
  const out = html('[log](/log/helios/) [ext](https://x.com/a) [rel](./a) ![i](/og.png)\n\n<audio src="/files/a.mp3"></audio>', '/orbital-station');
  assert.match(out, /href="\/orbital-station\/log\/helios\/"/);
  assert.match(out, /href="https:\/\/x.com\/a"/);
  assert.match(out, /href=".\/a"/);
  assert.match(out, /src="\/orbital-station\/og.png"/);
  assert.match(out, /src="\/orbital-station\/files\/a.mp3"/);
  assert.match(html('[log](/log/)', '/'), /href="\/log\/"/);
});
