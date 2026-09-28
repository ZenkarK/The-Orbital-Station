import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KIT_VERSION,
  FRAGMENT_PREFIX,
  MAX_ORBITS,
  MAX_NAME_LEN,
  MAX_CONSTANTS,
  MAX_CONSTANT_LEN,
  defaultState,
  sanitizeState,
  buildState,
  encodeState,
  decodeState,
  clockProximityPct,
  lamps,
} from '../../src/lib/kit-state.ts';
import { clockToDeg, proximity, isNearClock, NEAR_THRESHOLD } from '../../src/lib/orrery-layout.ts';

/* PLAY-01. The fragment is the only place this tool's state ever lives, so
   the encode/decode round trip and the hostile-input clamping matter more
   than almost anything else in this feature — see BACKLOG PLAY-01. */

/* ---------------------------------------------------------------------
   Round trip (acceptance criterion 1): 12 orbits, non-ASCII names.
   --------------------------------------------------------------------- */

test('round-trips 12 orbits with non-ASCII names through the fragment', () => {
  const names = [
    '軌道一', 'Ωμέγα', 'Ñandú', 'Café★', 'Строка', 'Örbit',
    'مدار', '中文名字', 'Emoji 🚀', 'Zürich', 'Naïve', 'Q&A "quote"',
  ];
  assert.equal(names.length, 12);
  const state = buildState(
    names.map((name, i) => ({ name, clock: `${(i % 12) + 1}:${String((i * 7) % 60).padStart(2, '0')}` })),
    ['CURIOSITY', 'DISCOVERY'],
    2,
  );
  assert.equal(state.orbits.length, 12);

  const fragment = encodeState(state);
  assert.ok(fragment.startsWith(FRAGMENT_PREFIX), 'fragment carries the version prefix');
  // Base64url only: safe to drop straight into a URL fragment untouched.
  assert.match(fragment.slice(FRAGMENT_PREFIX.length), /^[A-Za-z0-9_-]+$/);

  const { state: decoded, ok, empty } = decodeState(fragment);
  assert.equal(ok, true);
  assert.equal(empty, false);
  assert.deepEqual(decoded, state);
  assert.deepEqual(decoded.orbits.map((o) => o.name), names);
});

test('round-trips through a "#"-prefixed fragment the same way', () => {
  const state = buildState([{ name: 'ALPHA', clock: '12:00' }], ['ONE'], 1);
  const fragment = encodeState(state);
  assert.deepEqual(decodeState(`#${fragment}`).state, state);
  assert.deepEqual(decodeState(fragment).state, state);
});

/* ---------------------------------------------------------------------
   Empty / missing fragment — a fresh visit, not an error.
   --------------------------------------------------------------------- */

test('no fragment falls back to the default state without an error notice', () => {
  for (const input of [null, undefined, '', '#']) {
    const r = decodeState(input);
    assert.equal(r.ok, true);
    assert.equal(r.empty, true);
    assert.deepEqual(r.state, defaultState());
  }
});

/* ---------------------------------------------------------------------
   Hostile input (acceptance criterion 2 depends on this never throwing).
   --------------------------------------------------------------------- */

test('garbage fragments fall back to the default state with a visible-notice flag', () => {
  const garbageFragments = [
    'not-even-prefixed',
    'k1.',
    'k1.not-valid-base64!!!',
    `k1.${Buffer.from('not json', 'utf8').toString('base64url')}`,
    `k1.${Buffer.from(JSON.stringify({ version: 99, orbits: [] }), 'utf8').toString('base64url')}`,
    `k1.${Buffer.from(JSON.stringify([1, 2, 3]), 'utf8').toString('base64url')}`,
    `k1.${Buffer.from(JSON.stringify({ version: 1, orbits: 'nope' }), 'utf8').toString('base64url')}`,
    `k1.${Buffer.from(JSON.stringify({ version: 1, orbits: [] }), 'utf8').toString('base64url')}`,
  ];
  for (const fragment of garbageFragments) {
    const r = decodeState(fragment);
    assert.equal(r.ok, false, `expected ${fragment} to be rejected`);
    assert.equal(r.empty, false);
    assert.deepEqual(r.state, defaultState());
  }
});

test('a script-injection name survives as inert text, never crashes decoding', () => {
  const hostile = '<img src=x onerror=alert(1)>'; // 29 chars — longer than MAX_NAME_LEN on purpose
  const state = { version: KIT_VERSION, orbits: [{ name: hostile, clock: '12:00' }], constants: [], capacity: 3 };
  const fragment = encodeState(state);
  const { state: decoded } = decodeState(fragment);
  // sanitizeState only strips control characters and clamps length — it is
  // the renderer's job (textContent / SVG text nodes) to keep this inert.
  // The tags themselves are untouched (just length-clamped): proof that no
  // HTML-aware escaping/stripping happens here, because none should.
  assert.equal(decoded.orbits[0].name, hostile.slice(0, MAX_NAME_LEN));
  assert.ok(decoded.orbits[0].name.includes('<img src=x'));
});

/* ---------------------------------------------------------------------
   Clamping (validate-and-clamp, not reject-on-sight).
   --------------------------------------------------------------------- */

test('more than 12 orbits are clamped to 12, not rejected', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ name: `O${i}`, clock: '12:00' }));
  const state = sanitizeState({ version: 1, orbits: many, constants: [], capacity: 3 });
  assert.equal(state.orbits.length, MAX_ORBITS);
  assert.deepEqual(
    state.orbits.map((o) => o.name),
    many.slice(0, MAX_ORBITS).map((o) => o.name),
  );
});

test('names are trimmed, control characters stripped, and clamped to 24 characters', () => {
  const state = sanitizeState({
    version: 1,
    orbits: [{ name: `  \u0000\u0007spaced out${'x'.repeat(40)}\u007f  `, clock: '12:00' }],
    constants: [],
    capacity: 3,
  });
  const name = state.orbits[0].name;
  assert.ok(name.length <= MAX_NAME_LEN);
  assert.doesNotMatch(name, /[\u0000-\u001f\u007f]/);
  assert.equal(name, `spaced out${'x'.repeat(40)}`.slice(0, MAX_NAME_LEN));
});

test('an empty or unnamed orbit gets a generic fallback name instead of vanishing', () => {
  const state = sanitizeState({ version: 1, orbits: [{ name: '   ', clock: '12:00' }, {}], constants: [], capacity: 3 });
  assert.equal(state.orbits.length, 2);
  for (const o of state.orbits) assert.ok(o.name.length > 0);
});

test('clocks normalise to "H:MM" and clamp out-of-range hours/minutes', () => {
  const cases = [
    ['12:00', '12:00'],
    ['0:00', '12:00'],
    ['9:5', '9:05'],
    ['25:99', '1:59'],
    ['not-a-clock', '12:00'],
    [42, '12:00'],
  ];
  for (const [input, expected] of cases) {
    const state = sanitizeState({ version: 1, orbits: [{ name: 'A', clock: input }], constants: [], capacity: 3 });
    assert.equal(state.orbits[0].clock, expected, `clock ${JSON.stringify(input)}`);
  }
});

test('constants clamp to 5 entries of at most 20 characters, blanks dropped', () => {
  const long = 'two'.repeat(10);
  const state = sanitizeState({
    version: 1,
    orbits: [{ name: 'A', clock: '12:00' }],
    constants: ['one', '', '  ', long, 'three', 'four', 'five', 'six'],
    capacity: 3,
  });
  assert.ok(state.constants.length <= MAX_CONSTANTS);
  for (const c of state.constants) assert.ok(c.length <= MAX_CONSTANT_LEN && c.length > 0);
  assert.deepEqual(state.constants, ['one', long, 'three', 'four', 'five'].map((c) => c.slice(0, MAX_CONSTANT_LEN)));
});

test('capacity clamps to an integer between 1 and 4', () => {
  const at = (capacity) => sanitizeState({ version: 1, orbits: [{ name: 'A', clock: '12:00' }], constants: [], capacity }).capacity;
  assert.equal(at(0), 1);
  assert.equal(at(-5), 1);
  assert.equal(at(4), 4);
  assert.equal(at(99), 4);
  assert.equal(at(2.6), 3);
  assert.equal(at('not a number'), 3);
  assert.equal(at(undefined), 3);
});

test('zero surviving orbits is unsalvageable, not clamped to a 1-orbit state', () => {
  assert.equal(sanitizeState({ version: 1, orbits: [], constants: [], capacity: 3 }), null);
});

/* ---------------------------------------------------------------------
   Lamps — Manual §5.0's two failure modes, pure and unit-testable.
   --------------------------------------------------------------------- */

test('COLLISION RISK lights when more orbits are NEAR than capacity allows', () => {
  const state = buildState(
    [
      { name: 'A', clock: '12:00' },
      { name: 'B', clock: '12:10' },
      { name: 'C', clock: '6:00' },
    ],
    ['ONE', 'TWO', 'THREE'],
    1,
  );
  const l = lamps(state);
  assert.equal(l.near, 2);
  assert.equal(l.collision, true);
});

test('COLLISION RISK stays dark at or under capacity', () => {
  const state = buildState([{ name: 'A', clock: '12:00' }, { name: 'B', clock: '6:00' }], ['ONE', 'TWO', 'THREE'], 1);
  assert.equal(lamps(state).collision, false);
});

test('DRIFT lights when nothing is NEAR', () => {
  const state = buildState([{ name: 'A', clock: '6:00' }], ['ONE', 'TWO', 'THREE'], 3);
  assert.equal(lamps(state).near, 0);
  assert.equal(lamps(state).drift, true);
});

test('DRIFT lights when fewer than 3 constants are set, even with a NEAR orbit', () => {
  const state = buildState([{ name: 'A', clock: '12:00' }], ['ONE'], 3);
  assert.equal(lamps(state).drift, true);
});

test('DRIFT stays dark with a NEAR orbit and 3+ constants', () => {
  const state = buildState([{ name: 'A', clock: '12:00' }], ['ONE', 'TWO', 'THREE'], 3);
  assert.equal(lamps(state).drift, false);
});

test('the default state itself never starts with a lit lamp', () => {
  const l = lamps(defaultState());
  assert.equal(l.collision, false);
  assert.equal(l.drift, false);
});

/* ---------------------------------------------------------------------
   Cross-check against orrery-layout.ts (see this file's header note on the
   deliberate duplication) — the same guard tests/site/phase-capacity.test.mjs
   already keeps for src/lib/orbits.ts's copy of the same math, so this
   module's copy can't silently drift from the rest of the site's NEAR rule.
   --------------------------------------------------------------------- */

test("sanity: kit-state's clock/NEAR math matches orrery-layout.ts for a spread of clocks", () => {
  const clocks = [
    '12:00', '1:00', '2:30', '3:00', '4:15', '5:45', '6:00', '7:20',
    '8:40', '9:00', '10:10', '11:50', '12:30', '9:37', '12:05',
  ];
  for (const clock of clocks) {
    const viaOrrery = Math.round(proximity(clockToDeg(clock)) * 100);
    assert.equal(clockProximityPct(clock), viaOrrery, `clockProximityPct(${clock}) should match orrery-layout`);
  }
  for (const clock of clocks) {
    const state = buildState([{ name: 'A', clock }], ['ONE', 'TWO', 'THREE'], 4);
    assert.equal(
      lamps(state).near === 1,
      isNearClock(clock),
      `kit-state's NEAR call for ${clock} should agree with orrery-layout's isNearClock`,
    );
  }
  assert.equal(NEAR_THRESHOLD, 75, "orrery-layout's NEAR_THRESHOLD should still be 75, matching kit-state's own private copy");
});
