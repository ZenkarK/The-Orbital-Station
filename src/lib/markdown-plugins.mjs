/* =============================================================
   Sätteri (Markdown) plugins — Obsidian-compatible extras:
     · $inline$ and $$display$$ math, rendered to HTML at build time by KaTeX
     · > [!type] callouts, including foldable [!type]- / [!type]+ and nesting
   Used by astro.config.mjs for every .md/.mdx file in the site.
   ============================================================= */
import { defineMdastPlugin } from 'satteri';
import katex from 'katex';

/* ---------- math ---------- */

const renderTex = (tex, displayMode) =>
  katex.renderToString(tex, {
    displayMode,
    throwOnError: false, // a typo renders red in place instead of failing the build
    output: 'htmlAndMathml', // MathML keeps equations readable by screen readers
    strict: 'ignore',
  });

export const mathPlugin = defineMdastPlugin({
  name: 'station-math',
  inlineMath(node, ctx) {
    // Obsidian's rule: "$5 and $10" is not math — the content may not start or end with whitespace.
    if (!node.value.trim() || /^\s|\s$/.test(node.value)) {
      ctx.replaceNode(node, { type: 'text', value: `$${node.value}$` });
      return;
    }
    ctx.replaceNode(node, { type: 'html', value: renderTex(node.value, false) });
  },
  math(node, ctx) {
    ctx.replaceNode(node, { type: 'html', value: renderTex(node.value, true) });
  },
});

/* ---------- base path ---------- */

/**
 * Root-relative links in content ("/log/helios/", "/files/…") are written as if
 * the site lived at the domain root. When it's hosted in a sub-folder (a GitHub
 * Pages project site), prefix them with that folder so they keep working.
 */
export function createBasePathPlugin(base = '/') {
  const prefix = base.replace(/\/+$/, '');
  const fix = (url) => (prefix && /^\/(?!\/)/.test(url) && !url.startsWith(`${prefix}/`) ? prefix + url : url);
  return defineMdastPlugin({
    name: 'station-base-path',
    link(node, ctx) {
      const url = fix(node.url);
      if (url !== node.url) ctx.setProperty(node, 'url', url);
    },
    image(node, ctx) {
      const url = fix(node.url);
      if (url !== node.url) ctx.setProperty(node, 'url', url);
    },
    definition(node, ctx) {
      const url = fix(node.url);
      if (url !== node.url) ctx.setProperty(node, 'url', url);
    },
    html(node, ctx) {
      if (!prefix) return;
      const value = node.value.replace(/\b(href|src)=(["'])(\/(?!\/)[^"']*)\2/g, (_, attr, q, url) => `${attr}=${q}${fix(url)}${q}`);
      if (value !== node.value) ctx.setProperty(node, 'value', value);
    },
  });
}

/* ---------- callouts ---------- */

/** Obsidian's callout aliases → the canonical type used for styling. */
const CALLOUT_ALIASES = {
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
};

const MARKER = /^\[!([\w-]+)\]([+-]?)[ \t]*/;

/**
 * Split the callout's first paragraph at its first line break: everything
 * before it (minus the [!type] marker) is the title, everything after is body.
 */
function splitTitle(paragraphChildren) {
  const title = [];
  const rest = [];
  let inTitle = true;
  for (const child of paragraphChildren) {
    if (!inTitle) {
      rest.push(child);
      continue;
    }
    if (child.type === 'text' && child.value.includes('\n')) {
      const i = child.value.indexOf('\n');
      const before = child.value.slice(0, i);
      const after = child.value.slice(i + 1);
      if (before) title.push({ type: 'text', value: before });
      if (after) rest.push({ type: 'text', value: after });
      inTitle = false;
    } else if (child.type === 'break') {
      inTitle = false;
    } else {
      title.push(child);
    }
  }
  return { title, rest };
}

export const calloutPlugin = defineMdastPlugin({
  name: 'station-callouts',
  blockquote(node, ctx) {
    const first = node.children?.[0];
    if (!first || first.type !== 'paragraph') return;
    const lead = first.children?.[0];
    if (!lead || lead.type !== 'text') return;
    const m = MARKER.exec(lead.value);
    if (!m) return;

    const written = m[1].toLowerCase();
    const type = CALLOUT_ALIASES[written] ?? written;
    const fold = m[2];
    const children = [{ type: 'text', value: lead.value.slice(m[0].length) }, ...first.children.slice(1)].filter(
      (c) => !(c.type === 'text' && c.value === ''),
    );
    const { title, rest } = splitTitle(children);
    const titleNodes = title.length
      ? title
      : [{ type: 'text', value: written.charAt(0).toUpperCase() + written.slice(1) }];
    const body = [...(rest.length ? [{ type: 'paragraph', children: rest }] : []), ...node.children.slice(1)];

    ctx.replaceNode(node, {
      type: 'callout',
      data: {
        hName: fold ? 'details' : 'aside',
        hProperties: { className: ['callout'], dataCallout: type, ...(fold === '+' ? { open: true } : {}) },
      },
      children: [
        {
          type: 'calloutTitle',
          data: { hName: fold ? 'summary' : 'p', hProperties: { className: ['callout-title'] } },
          children: titleNodes,
        },
        ...(body.length
          ? [{ type: 'calloutBody', data: { hName: 'div', hProperties: { className: ['callout-body'] } }, children: body }]
          : []),
      ],
    });
  },
});
