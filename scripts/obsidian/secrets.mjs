/* =============================================================
   Secret scanning (PRIV-03)

   Looks for API keys, tokens, private keys and other credential-shaped
   strings in note text before it leaves the vault. Two gates use this
   module: the publisher (scanText/scanBuffer, wired in by the next
   agent) and the local CLI (scripts/scan-secrets.mjs, in this repo).

   Rules are high-signal provider formats (AWS, GitHub, Slack, Stripe,
   OpenAI, ...) plus one generic rule: a secret-ish keyword followed by
   an assignment and a long, high-entropy value. The notes this scans
   are LaTeX-heavy, full of wikilinks, URLs and code blocks, so every
   rule is written to need a real format match (or keyword + entropy),
   never a bare random-looking string.

   Nothing here ever prints or stores a whole secret. A Finding carries
   a redacted preview and a fingerprint (a hash prefix) instead, so a
   report or an allowlist entry never needs the real value.
   ============================================================= */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** @typedef {{file: string, line: number, column: number, rule: string, label: string, fingerprint: string, preview: string}} Finding */

// ---- helpers ------------------------------------------------------------

/** Offset (0-based) where each line starts. Works with CRLF: the \r stays
 * part of the preceding line, which is fine since no rule's value can
 * contain \r or \n. */
function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/** 1-based {line, column} for a 0-based offset, via binary search over lineStarts. */
function locate(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo] + 1 };
}

/** First 16 hex characters of sha256(value) — enough to dedupe/allowlist, not enough to help guess the secret. */
export function fingerprintOf(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

/** Redact a secret for display: at most the first 4 and last 2 characters, joined by "…". Never the whole value. */
export function redactPreview(value) {
  const n = value.length;
  if (n <= 1) return '…';
  const head = Math.min(4, Math.max(1, n - 2));
  const tail = Math.min(2, Math.max(0, n - head - 1));
  return value.slice(0, head) + '…' + (tail > 0 ? value.slice(n - tail) : '');
}

/** Shannon entropy in bits per character. */
function entropy(str) {
  const counts = new Map();
  for (const ch of str) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const n = str.length;
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / n;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Placeholder/example values the generic and context rules should never flag. */
function looksLikePlaceholder(value) {
  const v = value.trim().replace(/^['"`]|['"`]$/g, '');
  if (!v) return true;
  if (/^\$\{[^}]*\}$/.test(v)) return true; // ${VAR}
  if (/^process\.env\.[A-Za-z0-9_]+$/.test(v)) return true;
  if (/^os\.environ(?:\.get)?\(?\[?['"]?[A-Za-z0-9_]+['"]?\)?\]?$/i.test(v)) return true;
  if (/^getenv\(.*\)$/i.test(v)) return true;
  if (/^[<{].*[>}]$/.test(v)) return true; // <token>, {token}
  if (/^\.{3,}$/.test(v)) return true;
  if (/^(your|my|insert|enter|replace|change)[-_ ]?/i.test(v)) return true;
  if (/^(example|placeholder|dummy|sample|fake|test|changeme|redacted|none|null|undefined|todo|xxx+)[-_]?/i.test(v)) return true;
  // a run of one repeated character (aaaaaaaa, 0000000, xxxxxxxx) — entropy already
  // catches most of these, but a short run can still clear 3.5 bits/char by luck.
  if (/^(.)\1+$/.test(v)) return true;
  return false;
}

function genericValidate(secret) {
  return !looksLikePlaceholder(secret) && entropy(secret) >= 3.5;
}

/** The span (and value) a rule actually means by "the secret": the named
 * group called "secret" when the rule has one, else the whole match. */
function secretSpan(m) {
  if (m.groups && m.groups.secret !== undefined) {
    return { value: m.groups.secret, span: m.indices.groups.secret };
  }
  return { value: m[0], span: m.indices[0] };
}

// ---- rules ----------------------------------------------------------------
// Every pattern carries the 'd' (hasIndices) flag so a match reports exactly
// where its "secret" group sits in the text, not just where the whole rule
// matched (e.g. "Authorization: Bearer <token>" — only <token> is the secret).

const KEYWORD =
  '(?:api[_-]?key|apikey|secret(?:[_-]?key)?|access[_-]?key|client[_-]?secret|private[_-]?key|token|password|passwd|pwd|auth)';

export const RULES = [
  {
    id: 'aws-access-key-id',
    label: 'AWS access key ID',
    re: /\b(?<secret>(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16})\b/gd,
  },
  {
    id: 'aws-secret-key',
    label: 'AWS secret access key',
    re: /\baws_?(?:secret_?access_?key|secret_?key)\b\s*[:=]\s*["']?(?<secret>[A-Za-z0-9/+=]{40})["']?/gid,
  },
  {
    id: 'github-token',
    label: 'GitHub token',
    re: /\b(?<secret>gh[oprsu]_[A-Za-z0-9]{36,255})\b/gd,
  },
  {
    id: 'github-fine-grained-pat',
    label: 'GitHub fine-grained personal access token',
    re: /\b(?<secret>github_pat_[A-Za-z0-9_]{22,255})\b/gd,
  },
  {
    id: 'gitlab-pat',
    label: 'GitLab personal access token',
    re: /\b(?<secret>glpat-[A-Za-z0-9_-]{20})\b/gd,
  },
  {
    id: 'slack-token',
    label: 'Slack token',
    re: /\b(?<secret>xox[baprs]-[A-Za-z0-9-]{10,72})\b/gd,
  },
  {
    id: 'slack-webhook',
    label: 'Slack webhook URL',
    re: /\b(?<secret>https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9+/]{6,}\/[A-Za-z0-9+/]{6,}\/[A-Za-z0-9+/]{6,})\b/gd,
  },
  {
    id: 'stripe-live-key',
    label: 'Stripe live API key',
    re: /\b(?<secret>(?:sk|rk)_live_[A-Za-z0-9]{16,247})\b/gd,
  },
  {
    id: 'google-api-key',
    label: 'Google API key',
    re: /\b(?<secret>AIza[0-9A-Za-z_-]{35})\b/gd,
  },
  {
    id: 'google-oauth-client-secret',
    label: 'Google OAuth client secret',
    re: /\b(?<secret>GOCSPX-[A-Za-z0-9_-]{20,})\b/gd,
  },
  {
    id: 'anthropic-key',
    label: 'Anthropic API key',
    re: /\b(?<secret>sk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,})\b/gd,
  },
  {
    id: 'openai-key',
    label: 'OpenAI API key',
    re: /\b(?<secret>sk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,})\b/gd,
  },
  {
    id: 'huggingface-token',
    label: 'Hugging Face token',
    re: /\b(?<secret>hf_[A-Za-z0-9]{20,})\b/gd,
  },
  {
    id: 'npm-token',
    label: 'npm access token',
    re: /\b(?<secret>npm_[A-Za-z0-9]{36})\b/gd,
  },
  {
    id: 'pypi-token',
    label: 'PyPI API token',
    re: /\b(?<secret>pypi-[A-Za-z0-9_-]{50,})\b/gd,
  },
  {
    id: 'twilio-sid',
    label: 'Twilio account/API key SID',
    re: /\b(?<secret>(?:AC|SK)[a-fA-F0-9]{32})\b/gd,
  },
  {
    id: 'sendgrid-key',
    label: 'SendGrid API key',
    re: /\b(?<secret>SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})\b/gd,
  },
  {
    id: 'discord-webhook',
    label: 'Discord webhook URL',
    re: /\b(?<secret>https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+)/gd,
  },
  {
    id: 'discord-bot-token',
    label: 'Discord bot token',
    re: /\b(?<secret>[MNO][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,})\b/gd,
  },
  {
    id: 'telegram-bot-token',
    label: 'Telegram bot token',
    re: /\b(?<secret>\d{8,10}:[A-Za-z0-9_-]{35})\b/gd,
  },
  {
    id: 'azure-storage-key',
    label: 'Azure storage account key',
    re: /AccountKey=(?<secret>[A-Za-z0-9+/]{86}==)/gd,
  },
  {
    id: 'jwt',
    label: 'JSON Web Token',
    re: /\b(?<secret>eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,})\b/gd,
  },
  {
    id: 'private-key-block',
    label: 'PEM/OpenSSH/PGP private key block',
    re: /-----BEGIN (?:[A-Z0-9 ]*?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----(?<secret>[\s\S]*?)-----END (?:[A-Z0-9 ]*?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/gd,
  },
  {
    id: 'url-credentials',
    label: 'URL with embedded credentials',
    re: /\b(?<secret>[a-zA-Z][a-zA-Z0-9+.-]{1,15}:\/\/[^\s/:@]{1,100}:[^\s/@]{1,100}@[^\s/]{1,200})/gd,
    validate(secret) {
      const m = /:\/\/([^:@/]+):([^@/]+)@/.exec(secret);
      if (!m) return false;
      const [, user, pass] = m;
      if (looksLikePlaceholder(pass) || /^(user(name)?|pass(word)?|xxx+|changeme)$/i.test(pass)) return false;
      if (looksLikePlaceholder(user)) return false;
      return true;
    },
  },
  {
    id: 'bearer-token',
    label: 'bearer token in an Authorization header',
    re: /\bAuthorization\s*:\s*Bearer\s+(?<secret>[A-Za-z0-9._+/=-]{16,600})/gid,
    validate: genericValidate,
  },
  {
    id: 'generic-secret',
    label: 'credential (keyword followed by a long, high-entropy value)',
    re: new RegExp(
      String.raw`\b${KEYWORD}\b\s*[:=]\s*(?:"(?<secret>[^"\n]{16,200})"|'(?<secret>[^'\n]{16,200})'|` +
        '`(?<secret>[^`\\n]{16,200})`' +
        String.raw`|(?<secret>[A-Za-z0-9+/_.=-]{16,200}))`,
      'gid'
    ),
    validate: genericValidate,
  },
];

// ---- scanning ---------------------------------------------------------

/**
 * Scan text for secret-shaped strings.
 * @param {string} text
 * @param {{file?: string}} [opts]
 * @returns {Finding[]}
 */
export function scanText(text, opts = {}) {
  const file = opts.file ?? '(text)';
  const starts = lineStarts(text);
  const findings = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      if (m[0].length === 0) {
        rule.re.lastIndex++;
        continue;
      }
      const { value, span } = secretSpan(m);
      if (rule.validate && !rule.validate(value, m, text)) continue;
      const { line, column } = locate(starts, span[0]);
      findings.push({
        file,
        line,
        column,
        rule: rule.id,
        label: rule.label,
        fingerprint: fingerprintOf(value),
        preview: redactPreview(value),
      });
    }
  }
  findings.sort((a, b) => a.line - b.line || a.column - b.column);
  return findings;
}

/** True when buf looks like plain UTF-8 text: valid UTF-8 and no NUL bytes. NUL is technically
 * a valid UTF-8 code point, but real text doesn't contain one — a buffer with a NUL byte is
 * either UTF-16 (handled separately below) or genuinely binary, so it's excluded here rather
 * than let a lucky binary blob "successfully" decode as UTF-8 full of embedded NULs. */
function isUtf8Text(buf) {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** Reverse the byte order of every 16-bit code unit (UTF-16 BE → LE, for Buffer#toString). */
function swapBytePairs(buf) {
  const out = Buffer.from(buf);
  for (let i = 0; i + 1 < out.length; i += 2) {
    const tmp = out[i];
    out[i] = out[i + 1];
    out[i + 1] = tmp;
  }
  return out;
}

/** Heuristic UTF-16 detection for a buffer with no byte-order mark: ASCII-range text encoded
 * as UTF-16 has a NUL byte in every other position (the high byte, LE, or the low byte, BE). */
function guessUtf16Order(buf) {
  if (buf.length < 4 || buf.length % 2 !== 0) return null;
  const n = Math.min(buf.length, 8192);
  let zerosAtOdd = 0;
  let zerosAtEven = 0;
  for (let i = 0; i < n; i += 2) if (buf[i] === 0) zerosAtEven++;
  for (let i = 1; i < n; i += 2) if (buf[i] === 0) zerosAtOdd++;
  const half = n / 2;
  if (zerosAtOdd / half > 0.5) return 'le'; // high byte (odd offset) mostly 0
  if (zerosAtEven / half > 0.5) return 'be'; // high byte (even offset) mostly 0
  return null;
}

/**
 * Decode a buffer for scanning, so a text attachment that isn't plain UTF-8 (a .txt file saved
 * as UTF-16, e.g. via Windows Notepad's "Unicode" encoding) still gets scanned instead of
 * silently skipped:
 *   - valid UTF-8 (with no NUL bytes) decodes as UTF-8 — the common case;
 *   - a UTF-16 byte-order mark (LE or BE) decodes with the matching UTF-16 encoding;
 *   - no BOM, but the NUL-byte pattern says UTF-16 anyway, decodes with the guessed encoding.
 * Returns null when none of that applies — genuinely binary data (images, audio, PDFs, …)
 * stays unscanned, same as before.
 * @param {Buffer} buf
 * @returns {string | null}
 */
function decodeForScan(buf) {
  if (isUtf8Text(buf)) return buf.toString('utf8');
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return swapBytePairs(buf.subarray(2)).toString('utf16le');
  const order = guessUtf16Order(buf);
  if (order === 'le') return buf.toString('utf16le');
  if (order === 'be') return swapBytePairs(buf).toString('utf16le');
  return null;
}

/**
 * Scan a buffer, skipping anything that isn't classified as text (see decodeForScan).
 * @param {Buffer} buf
 * @param {{file?: string}} [opts]
 * @returns {Finding[]}
 */
export function scanBuffer(buf, opts = {}) {
  const text = decodeForScan(buf);
  if (text === null) return [];
  return scanText(text, opts);
}

// ---- allowlist ----------------------------------------------------------

/**
 * Read <repo>/.secrets-allow: one fingerprint per line, "#" comments and
 * blank lines allowed. A missing file is an empty allowlist.
 * @param {string} repo
 * @returns {Set<string>}
 */
export function loadAllowlist(repo) {
  const allow = new Set();
  let content;
  try {
    content = fs.readFileSync(path.join(repo, '.secrets-allow'), 'utf8');
  } catch {
    return allow;
  }
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line) allow.add(line.split(/\s+/)[0]);
  }
  return allow;
}

/** @param {Finding[]} findings @param {Set<string>} allow @returns {Finding[]} */
export function filterAllowed(findings, allow) {
  return findings.filter((f) => !allow.has(f.fingerprint));
}

/** A friendly, author-facing line for one finding. */
export function formatFinding(f) {
  return `Possible ${f.label} in "${f.file}" line ${f.line} (${f.preview}). If it isn't a secret, add ${f.fingerprint} to .secrets-allow in the site folder.`;
}
