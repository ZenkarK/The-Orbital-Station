import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml } from 'satteri';
import { convertBody, protect, extractSection, parseTarget, siteHeadingId } from '../../scripts/obsidian/convert.mjs';
import { mathPlugin, calloutPlugin } from '../../src/lib/markdown-plugins.mjs';

/** Render converted Markdown the way the site does. */
const site = (markdown) =>
  markdownToHtml(markdown, { features: { gfm: true, smartPunctuation: true, math: true }, mdastPlugins: [mathPlugin, calloutPlugin] }).html;

/** A fake vault: path → body. Notes listed in `published` get a page URL. */
function env(notes = {}, extra = {}) {
  const files = Object.keys(notes);
  const published = extra.published ?? {};
  return {
    title: extra.title ?? 'Test Note',
    notePath: extra.notePath ?? 'Test Note.md',
    strictLineBreaks: extra.strictLineBreaks ?? true,
    resolve: (link) => {
      const l = link.toLowerCase();
      const hit = files.find((f) => f.toLowerCase() === l || f.toLowerCase() === `${l}.md` || f.toLowerCase().split('/').pop() === l || f.toLowerCase().split('/').pop() === `${l}.md`);
      return hit ? { path: hit } : null;
    },
    readBody: (p) => notes[p] ?? '',
    pageUrl: (p) => published[p] ?? null,
    asset: (p, kind) => (kind === 'image' ? `./${p.split('/').pop().replace(/ /g, '-')}` : `/files/posts/test/${p.split('/').pop()}`),
  };
}
const md = (body, e = env()) => convertBody(body, e).markdown;

test('comments are removed: inline, block, and unclosed', () => {
  assert.equal(md('Keep %%drop%% this.'), 'Keep  this.');
  assert.equal(md('A\n\n%%\nsecret\n[[Link]]\n%%\n\nB'), 'A\n\nB');
  assert.equal(md('Visible\n\n%% never closed\nhidden forever'), 'Visible');
  assert.equal(md('Line ends with a comment %%x%%\nnext'), 'Line ends with a comment\nnext');
});

test('HTML comments are private too', () => {
  assert.equal(md('A <!-- secret --> B'), 'A  B');
  assert.equal(md('A\n<!--\nmulti\nline\n-->\nB'), 'A\nB');
  assert.equal(md('Code `<!-- kept -->` stays'), 'Code `<!-- kept -->` stays');
});

test('a line holding only a comment disappears (tables and lists stay intact)', () => {
  assert.equal(md('| a | b |\n| - | - |\n| 1 | 2 |\n%% | 3 | 4 | %%\n| 5 | 6 |'), '| a | b |\n| - | - |\n| 1 | 2 |\n| 5 | 6 |');
  assert.equal(md('- one\n%% - two %%\n- three'), '- one\n- three');
  assert.equal(md('> [!note]\n> kept\n> %% hidden %%\n> also kept'), '> [!note]\n> kept\n> also kept');
});

test('code is never touched', () => {
  const src = '```js\nconst a = "[[x]] ==y== $z$ %%c%%";\n```\n\n~~~\n$$ not math $$\n~~~\n\nUse `[[a]]` and ``b ` ==c==`` inline.';
  assert.equal(md(src), src);
});

test('indented code blocks are protected, list continuations are not code', () => {
  const src = 'Para:\n\n    arr = [[1, 2]]\n    fmt = "%d%%"\n    cost = $5\n\nAfter [[x]].';
  assert.equal(md(src), 'Para:\n\n    arr = [[1, 2]]\n    fmt = "%d%%"\n    cost = $5\n\nAfter x.');
  assert.equal(md('- item\n\n    continued ==here=='), '- item\n\n    continued <mark>here</mark>');
});

test('a fence inside a code example does not end the example (no comment leak after it)', () => {
  const quoted = 'How to:\n\n```markdown\n> [!example] Code\n> ```py\n> print("hi")\n> ```\n```\n\nAfter. %%private: ask Bob%% See [[Island]].';
  assert.equal(md(quoted), 'How to:\n\n```markdown\n> [!example] Code\n> ```py\n> print("hi")\n> ```\n```\n\nAfter.  See Island.');
  const indented = '```markdown\n1. Install:\n\n    ```bash\n    npm i\n    ```\n```\n\nAfter. %%secret%% ==hi==';
  assert.equal(md(indented), '```markdown\n1. Install:\n\n    ```bash\n    npm i\n    ```\n```\n\nAfter.  <mark>hi</mark>');
});

test('a fence inside a callout ends when the callout does', () => {
  assert.equal(md('> [!note]\n> ```py\n> x = 1\n\nOutside %%secret%% text.'), '> [!note]\n> ```py\n> x = 1\n\nOutside  text.');
});

test('indented lines inside footnotes and lists are text, not code (comments still removed)', () => {
  assert.equal(md('Claim.[^1]\n\n[^1]: First para.\n\n    Second para %%private note%% here.'), 'Claim.[^1]\n\n[^1]: First para.\n\n    Second para  here.');
  assert.equal(md('- item\nlazy line\n\n    continuation %%secret%% here'), '- item\nlazy line\n\n    continuation  here');
});

test('code fences inside callouts are protected', () => {
  const src = '> [!example] Code\n> ```py\n> x = "$5 [[y]]"\n> ```';
  assert.equal(md(src), src);
});

test('math follows Obsidian rules; stray dollars are escaped', () => {
  assert.equal(md('Energy $E = mc^2$ here.'), 'Energy $E = mc^2$ here.');
  assert.equal(md('It costs $5 and $10.'), 'It costs \\$5 and \\$10.');
  assert.equal(md('Not math: $ x $.'), 'Not math: \\$ x \\$.');
  assert.equal(md('Already \\$5 escaped.'), 'Already \\$5 escaped.');
  assert.equal(md('$$\n\\int_0^1 x\\,dx\n$$'), '$$\n\\int_0^1 x\\,dx\n$$');
  assert.equal(md('A $x$5 and $y$.'), 'A \\$x\\$5 and $y$.');
  assert.equal(md('[[Link]] in $\\text{[[math]]}$'), 'Link in $\\text{[[math]]}$');
});

test('one-line $$ in text, tables and lists is left alone; alone on its line it becomes a display block', () => {
  assert.equal(md('Inline $$a+b$$ display.'), 'Inline $$a+b$$ display.');
  assert.equal(md('| a | b |\n| - | - |\n| $$x$$ | y |'), '| a | b |\n| - | - |\n| $$x$$ | y |');
  assert.equal(md('- item $$x^2$$ more\n- next'), '- item $$x^2$$ more\n- next');
  assert.equal(md('Text\n\n$$E = mc^2$$\n\nmore'), 'Text\n\n$$\nE = mc^2\n$$\n\nmore');
  assert.match(site(md('| a | b |\n| - | - |\n| $$x$$ | y |\n| z | w |')), /<td>z<\/td>/);
});

test('multi-line display math is always put on its own lines (it can\'t swallow the page)', () => {
  assert.equal(md('So $$\nx^2\n$$ follows.\n\n## Next'), 'So\n\n$$\nx^2\n$$\n\nfollows.\n\n## Next');
  assert.equal(md('> [!note] Eq\n> $$ E = mc^2 $$'), '> [!note] Eq\n> $$\n> E = mc^2\n> $$');
  assert.equal(md('Text $$\nx\n$$ tail'), 'Text\n\n$$\nx\n$$\n\ntail');
  const html = site(md('So $$\nx^2\n$$ follows.\n\n## Next'));
  assert.match(html, /<h2[^>]*>Next<\/h2>/);
  assert.doesNotMatch(html, /katex-error/);
});

test('an escaped dollar inside inline math renders on the site', () => {
  const out = md('Price $\\$5 \\times 10^6$ here.');
  assert.equal(out, 'Price ${\\char36}5 \\times 10^6$ here.');
  assert.doesNotMatch(site(out), /katex-error/);
});

test('wikilinks: published → link, unpublished → text, headings and aliases', () => {
  const e = env({ 'A/Island.md': 'x', 'B/Secret.md': 'y' }, { published: { 'A/Island.md': '/transmissions/island/' } });
  const out = convertBody(
    'See [[Island]], [[Island#Page Curve|the curve]], [[Secret|my notes]], [[Nope]], [[#Local Heading]], [[Island#^blk]].',
    e,
  );
  assert.equal(
    out.markdown,
    'See [Island](/transmissions/island/), [the curve](/transmissions/island/#page-curve), my notes, Nope, [Local Heading](#local-heading), [Island](/transmissions/island/).',
  );
  assert.ok(out.warnings.some((w) => w.includes('"Secret" isn\'t published')));
  assert.ok(out.warnings.some((w) => w.includes('"Nope"')));
});

test('wikilinks in tables use an escaped pipe', () => {
  const e = env({ 'Island.md': 'x' }, { published: { 'Island.md': '/transmissions/island/' } });
  assert.equal(md('| a | [[Island\\|the island]] |', e), '| a | [the island](/transmissions/island/) |');
});

test('link text with brackets is escaped; escaped dollars are not doubled', () => {
  const e = env({ 'Island.md': 'x' }, { published: { 'Island.md': '/transmissions/island/' } });
  assert.equal(md('[[Island|see [1]]]', e).startsWith('[see \\[1'), true);
  assert.equal(md('[[Island|the $5k grant]]', e), '[the \\$5k grant](/transmissions/island/)');
  assert.match(site(md('[[Island|the $5k grant]]', e)), />the \$5k grant</);
});

test('heading anchors match the ids the site generates', () => {
  const body = '## E_k and σ_8\n\n## Bound on $\\Gamma$ values\n\n## Before -- after';
  const e = env({ 'Island.md': body }, { published: { 'Island.md': '/transmissions/island/' } });
  const out = md('[[Island#E_k and σ_8]] [[Island#Bound on $\\Gamma$ values]] [[Island#Before -- after]]', e);
  const ids = [...site(body).matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  for (const id of ids) assert.ok(out.includes(`#${id})`), `${id} missing from ${out}`);
  assert.equal(siteHeadingId('The `__init__` method'), 'the-__init__-method');
});

test('images: wikilink embeds with alt and size, markdown images, missing files', () => {
  const e = env({ 'img/jet plot.png': '', 'docs/paper.pdf': '', 'a/clip.mp3': '', 'v/run.mp4': '' });
  assert.equal(md('![[jet plot.png|300]]', e), '![jet plot](./jet-plot.png)');
  assert.equal(md('![[jet plot.png|The jet|640x480]]', e), '![The jet](./jet-plot.png)');
  assert.equal(md('![Plot|200](img/jet%20plot.png)', e), '![Plot](./jet-plot.png)');
  assert.equal(md('![[paper.pdf]]', e), '[paper](/files/posts/test/paper.pdf)');
  assert.equal(md('![[clip.mp3]]', e), '<audio controls preload="metadata" src="/files/posts/test/clip.mp3"></audio>');
  assert.equal(md('![[run.mp4]]', e), '<video controls preload="metadata" src="/files/posts/test/run.mp4"></video>');
  const missing = convertBody('Before ![[ghost.png]] after', e);
  assert.equal(missing.markdown, 'Before  after');
  assert.ok(missing.warnings.some((w) => w.includes('ghost.png')));
  // a missing Markdown image must not stay behind as a relative path (it would break the site build)
  const missingMd = convertBody('Figure:\n\n![plot](figures/missing.png)', e);
  assert.equal(missingMd.markdown, 'Figure:');
  assert.ok(missingMd.warnings.some((w) => w.includes('figures/missing.png')));
});

test('notes are never shipped as files — dotted names, Markdown embeds, canvases, drawings', () => {
  const notes = {
    'Lectures/Lecture 4.1 - Maxwell.md': '---\nx: 1\n---\nIntro %%secret%%\n\n## Result\n\nGauss.',
    'Notes/Snippets.md': 'Snippet text.',
    'Board.canvas': '{"nodes":[{"text":"private card"}]}',
    'Drawing 2026-09-26 10.12.33.excalidraw.md': '# Excalidraw Data\n\n## Text Elements\nprivate label',
  };
  const e = { ...env(notes), readBody: (p) => notes[p].replace(/^---[\s\S]*?---\n/, '') };
  const calls = [];
  const spy = { ...e, asset: (p, k) => (calls.push(p), e.asset(p, k)) };
  const out = convertBody(
    '![[Lecture 4.1 - Maxwell#Result]]\n\n![](Notes/Snippets.md)\n\nSee [[Board.canvas]].\n\n![[Drawing 2026-09-26 10.12.33.excalidraw]]',
    spy,
  );
  assert.deepEqual(calls, []);
  assert.equal(out.markdown, '## Result\n\nGauss.\n\nSnippet text.\n\nSee Board.canvas.');
  assert.ok(out.warnings.some((w) => w.includes('canvas')));
  assert.ok(out.warnings.some((w) => w.includes('Excalidraw')));
  assert.deepEqual(out.embeds, ['Lecture 4.1 - Maxwell#Result', 'Snippets']);
});

test('link destinations may contain parentheses; labels may contain escaped brackets', () => {
  const e = env({ 'Lecture (2024).md': 'x', 'img/plot (1).png': '' }, { published: { 'Lecture (2024).md': '/transmissions/lecture-2024/' } });
  assert.equal(md('See [the lecture](Lecture%20(2024).md) and ![plot](img/plot%20(1).png) end.', e), 'See [the lecture](/transmissions/lecture-2024/) and ![plot](./plot-(1).png) end.');
  assert.equal(md('See [a \\] b](Lecture%20(2024).md).', e), 'See [a \\] b](/transmissions/lecture-2024/).');
  assert.equal(md('[wiki](https://en.wikipedia.org/wiki/Jet_(astronomy))', e), '[wiki](https://en.wikipedia.org/wiki/Jet_(astronomy))');
});

test('external links and images are untouched (sizes stripped), obsidian:// links become text', () => {
  assert.equal(md('[site](https://example.com) ![x|300](https://e.com/a.png)'), '[site](https://example.com) ![x](https://e.com/a.png)');
  assert.equal(md('[open](obsidian://open?vault=V&file=N)'), 'open');
});

test('task list items are not mistaken for links', () => {
  assert.equal(md('- [ ] (later) read\n- [x] (done) wrote'), '- [ ] (later) read\n- [x] (done) wrote');
});

test('note transclusion: whole note, section, block, in callouts, cycles', () => {
  const notes = {
    'Snip.md': '# Snip\n\n## Result\n\nGamma is $10$.\n\n### Detail\n\nMore.\n\n## Other\n\nQuote me. ^b1\n\nNot me.',
    'Loop.md': 'Loop start\n\n![[Loop]]',
  };
  const e = env(notes);
  assert.equal(md('![[Snip#Result]]', e), '## Result\n\nGamma is $10$.\n\n### Detail\n\nMore.');
  assert.equal(md('> [!note] Embedded\n> ![[Snip#^b1]]', e), '> [!note] Embedded\n>\n> Quote me.\n>');
  const loop = convertBody('![[Loop]]', { ...e, notePath: 'Main.md' });
  assert.equal(loop.markdown, 'Loop start');
  assert.ok(loop.warnings.some((w) => w.includes('circular')));
  assert.equal(md('Text ![[Snip]] inline.', e), 'Text Snip inline.');
});

test('block references embed only their block (list item, code block)', () => {
  const notes = {
    'List.md': '- first private item\n- second private item\n- third item ^li3\n  - nested under third\n- fourth',
    'Code.md': '```python\ndef f():\n    return 1\n\nprint(f())\n```\n^code1\n\nAfter.',
  };
  const e = env(notes);
  assert.equal(md('![[List#^li3]]', e), '- third item\n  - nested under third');
  assert.equal(md('Intro.\n\n![[Code#^code1]]\n\n## Conclusion\n\nDone.', e), 'Intro.\n\n```python\ndef f():\n    return 1\n\nprint(f())\n```\n\n## Conclusion\n\nDone.');
});

test('section embeds ignore "#" lines inside code and comments', () => {
  const notes = {
    'Deriv.md': '## Derivation\n\n```python\n# step size\nh = 0.1\n```\n\n%%\n## Old section\n%%\n\nStill derivation.\n\n## Next\n\nNope.',
  };
  assert.equal(md('![[Deriv#Derivation]]', env(notes)), '## Derivation\n\n```python\n# step size\nh = 0.1\n```\n\nStill derivation.');
});

test('headings: duplicate title H1 is dropped, other H1s are demoted', () => {
  assert.equal(md('# Test Note\n\nBody\n\n## Sub', env()), 'Body\n\n## Sub');
  assert.equal(md('# Chapter One\n\nText\n\n## Part', env()), '## Chapter One\n\nText\n\n### Part');
});

test('inline footnotes may contain links and brackets', () => {
  const e = env({ 'Island.md': 'x' }, { published: { 'Island.md': '/transmissions/island/' } });
  assert.equal(
    md('Claim.^[See [the paper](https://arxiv.org/abs/1) and [[Island]] [1979].] Next.', e),
    'Claim.[^note-1] Next.\n\n[^note-1]: See [the paper](https://arxiv.org/abs/1) and [Island](/transmissions/island/) [1979].',
  );
});

test('setext underlines are not highlights', () => {
  assert.equal(md('Title\n=======\n\ntext'), 'Title\n=======\n\ntext');
});

test('highlights, inline footnotes, block ids, tag-only lines', () => {
  assert.equal(md('A ==key idea== here.'), 'A <mark>key idea</mark> here.');
  assert.equal(md('One.^[First.] Two.^[Second.]'), 'One.[^note-1] Two.[^note-2]\n\n[^note-1]: First.\n[^note-2]: Second.');
  assert.equal(md('Para. ^abc-123\n\n^standalone\n\nNext'), 'Para.\n\nNext');
  assert.equal(md('Text\n\n#physics #to-review\n\n# Heading stays'), 'Text\n\n## Heading stays');
  assert.equal(md('Issue #42 stays and C# too'), 'Issue #42 stays and C# too');
});

test('plugin-only code blocks are removed with a warning; mermaid is kept', () => {
  const out = convertBody('A\n\n```dataview\nLIST\n```\n\n```mermaid\ngraph TD\n```\n\nB', env());
  assert.equal(out.markdown, 'A\n\n```mermaid\ngraph TD\n```\n\nB');
  assert.ok(out.warnings.some((w) => w.includes('dataview')));
  assert.ok(out.warnings.some((w) => w.includes('Mermaid')));
});

test('soft line breaks become hard breaks only when strictLineBreaks is off', () => {
  assert.equal(md('line one\nline two', env({}, { strictLineBreaks: true })), 'line one\nline two');
  assert.equal(md('line one\nline two', env({}, { strictLineBreaks: false })), 'line one  \nline two');
  assert.equal(md('- a\n- b', env({}, { strictLineBreaks: false })), '- a\n- b');
  assert.equal(md('# H\ntext', env({}, { strictLineBreaks: false, title: 'x' })), '## H\ntext');
  assert.equal(md('The energy is\n$E = mc^2$\nwhere', env({}, { strictLineBreaks: false })), 'The energy is  \n$E = mc^2$  \nwhere');
  assert.equal(md('run\n`npm test`\nthen', env({}, { strictLineBreaks: false })), 'run  \n`npm test`  \nthen');
});

test('CRLF input is normalised', () => {
  assert.equal(md('a\r\n\r\nb'), 'a\n\nb');
});

test('helpers', () => {
  assert.deepEqual(parseTarget('Folder/Note#Head|Alias'), { target: 'Folder/Note', sub: 'Head', alias: 'Alias' });
  assert.deepEqual(parseTarget('Note\\|x'), { target: 'Note', sub: '', alias: 'x' });
  assert.equal(siteHeadingId('The **big** Idea'), 'the-big-idea');
  assert.equal(extractSection('## A\nx\n## B\ny', 'B'), '## B\ny');
  assert.equal(extractSection('text', 'Missing'), null);
  assert.equal(protect('`a` $b$').stash.length, 2);
});
