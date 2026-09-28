/* GROW-06 (Professional page + CV PDF) and GROW-07 (Now page).

   Two throwaway builds, shared across every test() below (see
   tests/obsidian/gates.test.mjs for the same before()/after() pattern):

     shipped — the repo exactly as committed: blank profile.yaml, empty
               NOW_NOTE, real ORBITS clocks. Proves the shipped defaults
               render nothing broken and no empty headings.
     filled  — profile.yaml replaced with canary data (including a
               reference to the real, public "orbital-station" Flight Log
               mission), NOW_NOTE set, plus canary transmissions: one in
               KIN (phase-only and NEAR at 12:15 — see src/site.config.ts)
               that must never appear, and four in SYSTEMS (public and
               NEAR) to prove /now/ caps each orbit at its latest three. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { PDFDocument } from 'pdf-lib';
import { buildSiteCopy } from '../helpers/site-build.mjs';
import { pdfContains, extractPdfText } from '../helpers/pdf-extract.mjs';
import { SITE, PHASE_LOGGED } from '../../src/site.config.ts';

const suffix = crypto.randomBytes(6).toString('hex');
const T = {
  headline: `canary-headline-${suffix}`,
  summary: `canary-summary-${suffix}`,
  roleTitle: `canary-role-title-${suffix}`,
  roleOrg: `canary-role-org-${suffix}`,
  roleSummary: `canary-role-summary-${suffix}`,
  area: `canary-area-${suffix}`,
  itemOne: `canary-item-one-${suffix}`,
  itemTwo: `canary-item-two-${suffix}`,
  workTitle: `canary-work-title-${suffix}`,
  workSummary: `canary-work-summary-${suffix}`,
  degree: `canary-degree-${suffix}`,
  institution: `canary-institution-${suffix}`,
  hiddenWork: `canary-hidden-work-${suffix}`, // selectedWork -> a phase-only-orbit mission; must never resolve
  now: `canary-now-note-${suffix}`,
  kin: `canary-kin-${suffix}`,
  sys1: `canary-sys-1-${suffix}`, // oldest of the four — must be pushed out of the "latest 3"
  sys2: `canary-sys-2-${suffix}`,
  sys3: `canary-sys-3-${suffix}`,
  sys4: `canary-sys-4-${suffix}`, // newest
};

const PROFILE_FIXTURE = `main:
  headline: ${T.headline}
  summary: ${T.summary}
  roles:
    - title: ${T.roleTitle}
      org: ${T.roleOrg}
      start: '2019'
      end: '2022'
      summary: ${T.roleSummary}
  expertise:
    - area: ${T.area}
      items: [${T.itemOne}, ${T.itemTwo}]
  selectedWork:
    - project: orbital-station
    - project: ${T.hiddenWork}
    - title: ${T.workTitle}
      summary: ${T.workSummary}
      link: https://example.test/canary-${suffix}
  education:
    - degree: ${T.degree}
      institution: ${T.institution}
      year: '2018'
`;

function postFrontmatter(token, orbit, date) {
  return `---\ntitle: ${token}\ndate: ${date}\nsummary: ${token} summary\norbit: ${orbit}\ntags: [${token}]\n---\n\n${token} body text.\n`;
}

function plantFixtures(tmp) {
  fs.writeFileSync(path.join(tmp, 'src/content/profile.yaml'), PROFILE_FIXTURE);

  const configPath = path.join(tmp, 'src/site.config.ts');
  const text = fs.readFileSync(configPath, 'utf8');
  const needle = "export const NOW_NOTE = '';";
  assert.ok(text.includes(needle), 'NOW_NOTE default has moved — update this test fixture');
  fs.writeFileSync(configPath, text.replace(needle, `export const NOW_NOTE = '${T.now}';`));

  // selectedWork's other canary entry (T.hiddenWork) points at this mission, filed
  // under KIN (phase-only) — getSelectedWork() must drop it via getProjects()'s
  // MODEL-07 filter the same way a hidden/phase-only Flight Log mission always is.
  const projDir = path.join(tmp, 'src/content/projects');
  fs.writeFileSync(
    path.join(projDir, `${T.hiddenWork}.md`),
    `---\ntitle: ${T.hiddenWork}\nsummary: ${T.hiddenWork} summary\norbit: kin\n---\n\n${T.hiddenWork} brief body.\n`,
  );

  const postsDir = path.join(tmp, 'src/content/posts');
  // KIN is phase-only and NEAR (clock 12:15) in the real site.config.ts — this must
  // never reach /now/ (or anywhere else; MODEL-07 already covers that in visibility.test.mjs).
  fs.writeFileSync(path.join(postsDir, `${T.kin}.md`), postFrontmatter(T.kin, 'kin', '2026-01-05'));
  // SYSTEMS is public and NEAR (clock 12:40) — four canaries, newest-first: sys4 > sys3 > sys2 > sys1.
  fs.writeFileSync(path.join(postsDir, `${T.sys1}.md`), postFrontmatter(T.sys1, 'systems', '2026-09-27'));
  fs.writeFileSync(path.join(postsDir, `${T.sys2}.md`), postFrontmatter(T.sys2, 'systems', '2026-09-28'));
  fs.writeFileSync(path.join(postsDir, `${T.sys3}.md`), postFrontmatter(T.sys3, 'systems', '2026-09-29'));
  fs.writeFileSync(path.join(postsDir, `${T.sys4}.md`), postFrontmatter(T.sys4, 'systems', '2026-09-30'));
}

let shipped;
let filled;

before(() => {
  shipped = buildSiteCopy({ prefix: 'orbital-shipped-' });
  filled = buildSiteCopy({ prefix: 'orbital-filled-', edit: plantFixtures });
});

after(() => {
  shipped.cleanup();
  filled.cleanup();
});

const read = (dist, rel) => fs.readFileSync(path.join(dist, rel), 'utf8');

/* ------------------------------------------------------------- /professional/ */

test('shipped profile.yaml: /professional/ shows the headline but no empty section headings', () => {
  const html = read(shipped.dist, 'professional/index.html');
  assert.match(html, /Service Record/);
  assert.match(html, /Systems engineer in medical imaging/); // src/content/profile.yaml's seeded headline
  assert.match(html, /DOWNLOAD CV/);
  for (const heading of ['ROLES', 'EXPERTISE', 'SELECTED WORK', 'EDUCATION']) {
    assert.doesNotMatch(html, new RegExp(`>${heading}<`), `${heading} should not render — the shipped profile has none`);
  }
});

test('the CV download link is a plain same-site link carrying data-event="cv-download"', () => {
  const html = read(shipped.dist, 'professional/index.html');
  const m = html.match(/<a[^>]*href="([^"]*cv\.pdf)"[^>]*>/);
  assert.ok(m, 'no link to cv.pdf found on /professional/');
  const tag = m[0];
  assert.match(tag, /data-event="cv-download"/);
  assert.doesNotMatch(tag, /target=/, 'the CV link must stay a plain same-site link, not open in a new tab');
});

test('filled profile.yaml: /professional/ renders every non-blank section, including a resolved Flight Log reference', () => {
  const html = read(filled.dist, 'professional/index.html');
  for (const token of [T.headline, T.summary, T.roleTitle, T.roleOrg, T.roleSummary, T.area, T.itemOne, T.itemTwo, T.workTitle, T.workSummary, T.degree, T.institution]) {
    assert.match(html, new RegExp(token), `expected canary token ${token} on /professional/`);
  }
  // selectedWork's `project: orbital-station` entry resolves to that public mission's real title.
  assert.match(html, /Orbital Station/);
  for (const heading of ['ROLES', 'EXPERTISE', 'SELECTED WORK', 'EDUCATION']) {
    assert.match(html, new RegExp(`>${heading}<`), `${heading} should render once its data is filled in`);
  }
});

test('filled profile.yaml: selectedWork pointing at a phase-only-orbit mission never reaches /professional/ or cv.pdf', () => {
  const html = read(filled.dist, 'professional/index.html');
  assert.doesNotMatch(html, new RegExp(T.hiddenWork), 'a phase-only Flight Log mission referenced from selectedWork must not render on /professional/');
  const pdfBytes = fs.readFileSync(path.join(filled.dist, 'cv.pdf'));
  assert.ok(!pdfContains(pdfBytes, T.hiddenWork), 'a phase-only Flight Log mission referenced from selectedWork must not appear in cv.pdf');
});

/* ------------------------------------------------------------------ cv.pdf */

test('cv.pdf exists, is a valid PDF, and contains the profile headline', async () => {
  const bytes = fs.readFileSync(path.join(shipped.dist, 'cv.pdf'));
  // updateMetadata:false — see tests/helpers/pdf-extract.mjs's header and cv.pdf.ts's:
  // PDFDocument.load() defaults updateMetadata:true, which would stamp pdf-lib's own
  // Producer/ModDate back in and defeat the very check this test is making.
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.ok(doc.getPageCount() >= 1);
  assert.ok(pdfContains(bytes, 'Systems engineer in medical imaging'), 'cv.pdf should contain the profile headline');
  assert.ok(pdfContains(bytes, SITE.author), 'cv.pdf should contain the author name');
});

test('cv.pdf metadata is deterministic and carries no tool fingerprint or personal machine detail', async () => {
  const bytes = fs.readFileSync(path.join(shipped.dist, 'cv.pdf'));
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });

  assert.equal(doc.getProducer(), 'Orbital Station');
  assert.equal(doc.getCreator(), 'Orbital Station');
  assert.equal(doc.getTitle(), `${SITE.author} — CV`);
  const stamped = new Date(`${PHASE_LOGGED}T00:00:00.000Z`).getTime();
  assert.equal(doc.getCreationDate()?.getTime(), stamped);
  assert.equal(doc.getModificationDate()?.getTime(), stamped);
  assert.equal(doc.getAuthor(), undefined);
  assert.equal(doc.getSubject(), undefined);
  assert.equal(doc.getKeywords(), undefined);

  const rawLower = bytes.toString('latin1').toLowerCase();
  const decodedLower = extractPdfText(bytes).toLowerCase();
  const username = os.userInfo().username.toLowerCase();
  for (const forbidden of ['pdf-lib', username, 'c:\\users', '/users/', 'c:/users']) {
    assert.ok(!rawLower.includes(forbidden), `cv.pdf bytes must not contain "${forbidden}"`);
    assert.ok(!decodedLower.includes(forbidden), `cv.pdf decoded text must not contain "${forbidden}"`);
  }
});

test('a second build produces byte-identical CreationDate/ModDate/Producer (same PHASE_LOGGED in, same metadata out)', async () => {
  const a = fs.readFileSync(path.join(shipped.dist, 'cv.pdf'));
  const b = fs.readFileSync(path.join(filled.dist, 'cv.pdf'));
  const [docA, docB] = await Promise.all([PDFDocument.load(a, { updateMetadata: false }), PDFDocument.load(b, { updateMetadata: false })]);
  assert.equal(docA.getCreationDate()?.getTime(), docB.getCreationDate()?.getTime());
  assert.equal(docA.getModificationDate()?.getTime(), docB.getModificationDate()?.getTime());
  assert.equal(docA.getProducer(), docB.getProducer());
});

test('filled profile.yaml: cv.pdf is generated from the same data as /professional/', async () => {
  const bytes = fs.readFileSync(path.join(filled.dist, 'cv.pdf'));
  assert.ok(pdfContains(bytes, T.headline));
  assert.ok(pdfContains(bytes, T.roleTitle));
  assert.ok(pdfContains(bytes, T.degree));
});

/* -------------------------------------------------------------------- /now/ */

test('shipped: /now/ lists exactly the NEAR displayed orbits, with last-updated = PHASE_LOGGED, and no note', () => {
  const html = read(shipped.dist, 'now/index.html');
  assert.match(html, /What's Near/);
  assert.match(html, new RegExp(PHASE_LOGGED.replaceAll('-', '\\.')));

  // Hand-computed from the real ORBITS clocks in site.config.ts (proximity =
  // (1 - sin(clockToDeg(clock))) / 2, NEAR_THRESHOLD = 75): NEAR = body, kin,
  // growth, voyage, words, systems; MID-ORBIT = mind, markets, venture; FAR =
  // language, astro, craft. This is the regression check for `near =
  // ranked.filter((r) => isNearClock(r.orbit.clock))` in now.astro ever being
  // weakened (e.g. to `near = ranked`) — every assertion below would still
  // pass without it, since only NEAR/FAR/MID-ORBIT membership tells them apart.
  const NEAR_IDS = ['kin', 'words', 'systems', 'body', 'growth', 'voyage'];
  const NOT_NEAR_IDS = ['mind', 'markets', 'venture', 'language', 'astro', 'craft'];
  const orbitSections = html.match(/class="panel now-orbit"/g) ?? [];
  assert.equal(orbitSections.length, NEAR_IDS.length, '.now-orbit section count should equal the NEAR orbit count, not every displayed orbit');
  for (const id of NEAR_IDS) assert.match(html, new RegExp(`id="now-${id}"`), `now-${id} should render as a .now-orbit card — ${id} is NEAR`);
  for (const id of NOT_NEAR_IDS) assert.doesNotMatch(html, new RegExp(`id="now-${id}"`), `now-${id} should NOT render as a .now-orbit card — ${id} is not NEAR`);

  // KIN is phase-only and NEAR by the real clock in site.config.ts — it gets a card,
  // but says its logs are private rather than listing anything (same copy as the orbit page).
  assert.match(html, /id="now-kin"/);
  assert.match(html, /THIS ORBIT'S LOGS ARE PRIVATE/);
  // The shipped NOW_NOTE is empty, so no note block should render at all
  // (the CSS class name itself is fine to see — it's in the page's own <style>).
  assert.doesNotMatch(html, /<p class="now-note">/);
});

test('shipped: /now/ lists the MID-ORBIT orbits compactly, separate from the NEAR list', () => {
  const html = read(shipped.dist, 'now/index.html');
  assert.match(html, /id="now-mid"/);
  assert.match(html, />MID-ORBIT</);
  const rows = html.match(/class="orbit-row"/g) ?? [];
  // mind, markets, venture — see the proximity computation above.
  assert.equal(rows.length, 3, 'exactly the three MID-ORBIT orbits should list as .orbit-row entries');
  for (const name of ['MIND', 'MARKETS', 'VENTURE']) {
    assert.match(html, new RegExp(`<b>${name}</b>`), `${name} should appear in the MID-ORBIT block`);
  }
});

test('filled: a canary transmission in KIN (phase-only, NEAR) never reaches /now/', () => {
  const html = read(filled.dist, 'now/index.html');
  assert.doesNotMatch(html, new RegExp(T.kin));
});

test('filled: SYSTEMS (public, NEAR) shows only its latest three transmissions, oldest excluded', () => {
  const html = read(filled.dist, 'now/index.html');
  assert.match(html, new RegExp(T.sys4));
  assert.match(html, new RegExp(T.sys3));
  assert.match(html, new RegExp(T.sys2));
  assert.doesNotMatch(html, new RegExp(T.sys1), 'the oldest of four canaries should be pushed out of the latest-3 cap');
});

test('filled: a non-empty NOW_NOTE renders; the shipped empty one does not', () => {
  const html = read(filled.dist, 'now/index.html');
  assert.match(html, new RegExp(T.now));
  assert.match(html, /now-note/);
});

test('/now/ is linked from the Observer page', () => {
  const html = read(shipped.dist, 'observer/index.html');
  assert.match(html, /href="\/now\/"/);
});

test('/professional/ is linked from the Observer page, and both new pages are in the footer', () => {
  const observer = read(shipped.dist, 'observer/index.html');
  assert.match(observer, /href="\/professional\/"/);
  const footer = read(shipped.dist, 'index.html'); // Footer renders on every page
  assert.match(footer, /href="\/professional\/"/);
  assert.match(footer, /href="\/now\/"/);
});
