/* A small, strict-enough well-formedness check for the XML this project generates (RSS
   feeds, the sitemap) — not a general-purpose parser, and not meant to validate arbitrary
   XML. Declarations, comments and CDATA sections are treated as opaque; everything else is
   scanned as alternating tags and text, checking that every tag closes, closes in the right
   order, and that no bare "&" sits in text outside a recognized entity. */
export function assertWellFormedXml(xml, label = 'xml') {
  let s = xml
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');

  const stack = [];
  let rootClosed = false;
  const tagRe = /<(\/?)([a-zA-Z_][\w.:-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = tagRe.exec(s))) {
    const [, closing, name, , selfClose, text] = m;
    if (text !== undefined) {
      if (rootClosed && text.trim()) {
        throw new Error(`${label}: content after the root element closed: ${JSON.stringify(text.slice(0, 40))}`);
      }
      if (/&(?!(amp|lt|gt|apos|quot|#\d+|#x[0-9a-fA-F]+);)/.test(text)) {
        throw new Error(`${label}: unescaped "&" in text: ${JSON.stringify(text.slice(0, 60))}`);
      }
      continue;
    }
    if (rootClosed) throw new Error(`${label}: content after the root element closed: <${closing ? '/' : ''}${name}>`);
    if (closing) {
      const top = stack.pop();
      if (top !== name) throw new Error(`${label}: expected </${top ?? '(nothing open)'}>, got </${name}>`);
    } else if (!selfClose) {
      stack.push(name);
    }
    if (!stack.length) rootClosed = true;
  }
  if (!rootClosed && !stack.length) throw new Error(`${label}: no root element found`);
  if (stack.length) throw new Error(`${label}: unclosed tag(s): ${stack.join(', ')}`);
}
