import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanText, scanBuffer, loadAllowlist, filterAllowed, formatFinding, fingerprintOf, redactPreview } from '../../scripts/obsidian/secrets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'scripts', 'scan-secrets.mjs');

// Fake values are built at runtime, never spelled out as literal strings,
// so nothing that looks like a real key sits in this file's source.
const j = (...parts) => parts.join('');
/** n characters cycling through a fixed alphabet — high entropy, exact length control. */
const chars = (n, alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') =>
  Array.from({ length: n }, (_, i) => alphabet[i % alphabet.length]).join('');
const upper = (n) => chars(n, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
const hex = (n) => chars(n, '0123456789abcdef');

// ---- one true positive per rule -----------------------------------------

const cases = [
  { id: 'aws-access-key-id', line: () => j('key = "', 'AKIA', upper(16), '"') },
  { id: 'aws-secret-key', line: () => j('aws_secret_access_key = "', chars(40, chars(64, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/')), '"') },
  { id: 'github-token', line: () => j('token: ', 'ghp_', chars(36)) },
  { id: 'github-fine-grained-pat', line: () => j('token: ', 'github_pat_', chars(22)) },
  { id: 'gitlab-pat', line: () => j('token: ', 'glpat-', chars(20)) },
  { id: 'slack-token', line: () => j('token: ', 'xoxb-', chars(20)) },
  { id: 'slack-webhook', line: () => j('webhook: https://hooks.slack.com/services/', chars(9), '/', chars(9), '/', chars(24)) },
  { id: 'stripe-live-key', line: () => j('key: ', 'sk_live_', chars(24)) },
  { id: 'google-api-key', line: () => j('key: ', 'AIza', chars(35)) },
  { id: 'google-oauth-client-secret', line: () => j('secret: ', 'GOCSPX-', chars(28)) },
  { id: 'anthropic-key', line: () => j('key: ', 'sk-ant-api03-', chars(32)) },
  { id: 'openai-key', line: () => j('key: ', 'sk-proj-', chars(32)) },
  { id: 'huggingface-token', line: () => j('token: ', 'hf_', chars(30)) },
  { id: 'npm-token', line: () => j('token: ', 'npm_', chars(36)) },
  { id: 'pypi-token', line: () => j('token: ', 'pypi-', chars(60)) },
  { id: 'twilio-sid', line: () => j('sid: ', 'AC', hex(32)) },
  { id: 'sendgrid-key', line: () => j('key: ', 'SG.', chars(22), '.', chars(43)) },
  { id: 'discord-webhook', line: () => j('hook: https://discord.com/api/webhooks/', '123456789012345678', '/', chars(68)) },
  { id: 'discord-bot-token', line: () => j('token: ', 'M', chars(24), '.', chars(6), '.', chars(27)) },
  { id: 'telegram-bot-token', line: () => j('token: ', '123456789', ':', chars(35)) },
  { id: 'azure-storage-key', line: () => j('conn: DefaultEndpointsProtocol=https;AccountKey=', chars(86, chars(64, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/')), '==') },
  { id: 'jwt', line: () => j('jwt: ', 'eyJ', chars(20), '.', chars(20), '.', chars(20)) },
  { id: 'url-credentials', line: () => j('db: postgres://dbuser:', chars(16), '@db.example.com:5432/app') },
  { id: 'bearer-token', line: () => j('Authorization: Bearer ', chars(40)) },
  { id: 'generic-secret', line: () => j('api_key = "', chars(32), '"') },
];

for (const { id, line } of cases) {
  test(`scanText finds a planted ${id}`, () => {
    const findings = scanText(line(), { file: 'Notes/Setup.md' });
    assert.ok(findings.some((f) => f.rule === id), `expected a ${id} finding, got: ${JSON.stringify(findings.map((f) => f.rule))}`);
  });
}

test('planted PEM private key block is found', () => {
  const text = ['-----BEGIN RSA PRIVATE KEY-----', chars(64), chars(64), '-----END RSA PRIVATE KEY-----'].join('\n');
  const findings = scanText(text, { file: 'Notes/Keys.md' });
  assert.ok(findings.some((f) => f.rule === 'private-key-block'));
});

// ---- false positives ------------------------------------------------------

test('LaTeX, wikilinks, URLs, code hashes and placeholders are not flagged', () => {
  const notFlagged = [
    'The metric is $g_{\\mu\\nu} = \\eta_{\\mu\\nu} + h_{\\mu\\nu}$ near flat space.',
    '\\begin{equation}\\label{eq:friedmann}\\dot a^2 = \\frac{8\\pi G}{3}\\rho a^2\\end{equation}',
    'See [[Relativistic Jets]] and [[Astrophysics/Island Formula|the island formula]].',
    'Paper: https://arxiv.org/abs/2301.12345 and https://doi.org/10.1000/xyz123',
    'Draft: https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123456/edit',
    'Video: https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    `commit ${hex(40)}`,
    '```js\nconst token = process.env.GITHUB_TOKEN;\n```',
    'api_key = "your-api-key-here"',
    'password: "xxxxxxxxxxxxxxxx"',
    'token = "<your-token>"',
    'secret: ${SECRET_VALUE}',
    'password = os.environ["DB_PASSWORD"]',
    'auth_token = "aaaaaaaaaaaaaaaaaaaa"',
    'client_secret: "changeme"',
  ].join('\n');
  const findings = scanText(notFlagged, { file: 'Notes/Physics.md' });
  assert.deepEqual(findings, []);
});

// ---- line/column accuracy --------------------------------------------------

test('line and column are correct, including a match on the very first line', () => {
  const secret = j('AKIA', upper(16));
  const text = `key = "${secret}"`;
  const [f] = scanText(text, { file: 'a.md' });
  assert.equal(f.line, 1);
  assert.equal(f.column, text.indexOf(secret) + 1);
});

test('line and column are correct on the last line, and with CRLF line endings', () => {
  const secret = j('AKIA', upper(16));
  const text = ['line one', 'line two', `key = "${secret}"`].join('\r\n');
  const [f] = scanText(text, { file: 'a.md' });
  assert.equal(f.line, 3);
  const lastLine = `key = "${secret}"`;
  assert.equal(f.column, lastLine.indexOf(secret) + 1);
});

// ---- preview redaction ------------------------------------------------------

test('preview never contains the whole value, for values of many lengths', () => {
  for (const n of [1, 2, 3, 4, 6, 7, 16, 40, 88]) {
    const value = chars(n);
    const preview = redactPreview(value);
    assert.notEqual(preview, value);
    assert.ok(preview.includes('…'));
    assert.ok(preview.length < value.length + 1);
  }
});

test('fingerprint is 16 hex characters and stable for the same value', () => {
  const value = j('AKIA', upper(16));
  const fp = fingerprintOf(value);
  assert.match(fp, /^[0-9a-f]{16}$/);
  assert.equal(fp, fingerprintOf(value));
  assert.notEqual(fp, fingerprintOf(value + 'x'));
});

// ---- allowlist --------------------------------------------------------------

test('loadAllowlist reads fingerprints, skips comments and blanks; filterAllowed drops them', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-secrets-'));
  try {
    fs.writeFileSync(
      path.join(tmp, '.secrets-allow'),
      ['# example ids, not secrets', '', 'aaaaaaaaaaaaaaaa  # arXiv id look-alike', '# bbbbbbbbbbbbbbbb (commented out, still excluded)'].join('\n')
    );
    const allow = loadAllowlist(tmp);
    assert.ok(allow.has('aaaaaaaaaaaaaaaa'));
    assert.equal(allow.size, 1);

    const findings = [
      { file: 'a.md', line: 1, column: 1, rule: 'x', label: 'x', fingerprint: 'aaaaaaaaaaaaaaaa', preview: 'a…a' },
      { file: 'a.md', line: 2, column: 1, rule: 'x', label: 'x', fingerprint: 'cccccccccccccccc', preview: 'c…c' },
    ];
    const kept = filterAllowed(findings, allow);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].fingerprint, 'cccccccccccccccc');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadAllowlist returns an empty set when the file is missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-secrets-'));
  try {
    assert.equal(loadAllowlist(tmp).size, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- formatFinding ------------------------------------------------------

test('formatFinding names the file, line, redacted preview and fingerprint', () => {
  const f = { file: 'Notes/Setup.md', line: 12, column: 5, rule: 'aws-access-key-id', label: 'AWS access key ID', fingerprint: '3f9a0c1a2b3c4d5e', preview: 'AKIA…LE' };
  const msg = formatFinding(f);
  assert.match(msg, /^Possible AWS access key ID in "Notes\/Setup\.md" line 12 \(AKIA…LE\)\./);
  assert.match(msg, /3f9a0c1a2b3c4d5e/);
  assert.match(msg, /\.secrets-allow/);
});

// ---- scanBuffer -------------------------------------------------------------

test('scanBuffer scans valid UTF-8 text and finds a planted secret', () => {
  const secret = j('AKIA', upper(16));
  const buf = Buffer.from(`key = "${secret}"`, 'utf8');
  const findings = scanBuffer(buf, { file: 'a.md' });
  assert.ok(findings.some((f) => f.rule === 'aws-access-key-id'));
});

test('scanBuffer returns [] for binary data (NUL byte)', () => {
  const buf = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
  assert.deepEqual(scanBuffer(buf, { file: 'a.png' }), []);
});

test('scanBuffer returns [] for invalid UTF-8 in a file whose extension isn\'t a known text type', () => {
  const buf = Buffer.from([0xff, 0xfe, 0xfd, 0xfc, 0x80, 0x81]);
  assert.deepEqual(scanBuffer(buf, { file: 'a.bin' }), []);
});

test('scanBuffer returns [] for a binary format (JPEG bytes), even if it happens to decode as text-ish', () => {
  const jpegLike = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  assert.deepEqual(scanBuffer(jpegLike, { file: 'photo.jpg' }), []);
});

// ---- scanBuffer on non-UTF-8 text (a .txt file saved in a different encoding) ------------

test('scanBuffer finds a planted secret in a UTF-16LE .txt file with a byte-order mark', () => {
  const secret = j('AKIA', upper(16));
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`key = "${secret}"`, 'utf16le')]);
  const findings = scanBuffer(utf16, { file: 'notes.txt' });
  assert.ok(findings.some((f) => f.rule === 'aws-access-key-id'), `expected a finding, got: ${JSON.stringify(findings)}`);
});

test('scanBuffer finds a planted secret in a UTF-16BE .txt file with a byte-order mark', () => {
  const secret = j('AKIA', upper(16));
  const le = Buffer.from(`key = "${secret}"`, 'utf16le');
  const be = Buffer.alloc(le.length);
  for (let i = 0; i + 1 < le.length; i += 2) {
    be[i] = le[i + 1];
    be[i + 1] = le[i];
  }
  const utf16be = Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
  const findings = scanBuffer(utf16be, { file: 'notes.txt' });
  assert.ok(findings.some((f) => f.rule === 'aws-access-key-id'), `expected a finding, got: ${JSON.stringify(findings)}`);
});

test('scanBuffer finds a planted secret in a UTF-16LE .txt file with no byte-order mark', () => {
  const secret = j('AKIA', upper(16));
  const utf16 = Buffer.from(`key = "${secret}"`, 'utf16le');
  const findings = scanBuffer(utf16, { file: 'notes.txt' });
  assert.ok(findings.some((f) => f.rule === 'aws-access-key-id'), `expected a finding, got: ${JSON.stringify(findings)}`);
});

test('scanBuffer still finds a planted secret in a plain UTF-8 .txt file (no regression)', () => {
  const secret = j('AKIA', upper(16));
  const findings = scanBuffer(Buffer.from(`key = "${secret}"`, 'utf8'), { file: 'notes.txt' });
  assert.ok(findings.some((f) => f.rule === 'aws-access-key-id'));
});

// ---- CLI ----------------------------------------------------------------

test('CLI exits 0 on a clean file and 1 with a planted secret, honouring .secrets-allow', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-secrets-cli-'));
  try {
    fs.writeFileSync(path.join(tmp, '.secrets-allow'), '# nothing yet\n');
    const clean = path.join(tmp, 'clean.md');
    fs.writeFileSync(clean, 'Just some notes about $E = mc^2$.\n');
    const res1 = spawnCli(['--json', clean], tmp);
    assert.equal(res1.status, 0);
    assert.deepEqual(JSON.parse(res1.stdout), []);

    const secret = j('AKIA', upper(16));
    const dirty = path.join(tmp, 'dirty.md');
    fs.writeFileSync(dirty, `key = "${secret}"\n`);
    const res2 = spawnCli(['--json', dirty], tmp);
    assert.equal(res2.status, 1);
    const found = JSON.parse(res2.stdout);
    assert.equal(found.length, 1);
    assert.equal(found[0].rule, 'aws-access-key-id');

    // human output names the file and offers the allowlist fix
    const res3 = spawnCli([dirty], tmp);
    assert.equal(res3.status, 1);
    assert.match(res3.stdout, /Possible AWS access key ID/);
    assert.match(res3.stdout, /\.secrets-allow/);

    // allowlisting the fingerprint clears it
    fs.appendFileSync(path.join(tmp, '.secrets-allow'), `${found[0].fingerprint}\n`);
    const res4 = spawnCli(['--json', dirty], tmp);
    assert.equal(res4.status, 0);
    assert.deepEqual(JSON.parse(res4.stdout), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/** Run the CLI with `cwd` as its "repo" (it reads cwd/.secrets-allow), against explicit absolute paths. */
function spawnCli(args, cwd) {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
    return { status: 0, stdout };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '' };
  }
}
