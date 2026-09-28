/* MODEL-03 — the counting helper behind the build warning and the Bridge
   caption: which orbits are running NEAR (proximity >= 75%), out of a given
   list. Imports orrery-layout.ts directly (it has no extensionless imports,
   so Node's type-stripping can resolve it) rather than src/lib/orbits.ts,
   which imports '../site.config' without an extension. See BACKLOG MODEL-03
   and PRD §13 Q2. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockToDeg, proximity, clockProximityPct, isNearClock, nearOrbits, NEAR_THRESHOLD } from '../../src/lib/orrery-layout.ts';
import { ORBITS, NEAR_CAPACITY } from '../../src/site.config.ts';

test('NEAR_THRESHOLD is 75%, matching phaseLabel in src/lib/orbits.ts', () => {
  assert.equal(NEAR_THRESHOLD, 75);
});

test('clockProximityPct: 12:00 is 100% (NEAR), 6:00 is 0% (FAR), 9:00/3:00 sit at 50%', () => {
  assert.equal(clockProximityPct('12:00'), 100);
  assert.equal(clockProximityPct('6:00'), 0);
  assert.equal(clockProximityPct('9:00'), 50);
  assert.equal(clockProximityPct('3:00'), 50);
});

test('isNearClock follows the 75% line', () => {
  assert.equal(isNearClock('12:00'), true); // 100%
  assert.equal(isNearClock('12:30'), true); // ~98% — NEAR
  assert.equal(isNearClock('6:00'), false); // 0%
  assert.equal(isNearClock('9:00'), false); // 50%, MID-ORBIT not NEAR
});

test('nearOrbits filters a list of {clock} objects down to the NEAR ones, by name', () => {
  const fixture = [
    { name: 'A', clock: '12:00' }, // 100% — NEAR
    { name: 'B', clock: '12:15' }, // ~99% — NEAR
    { name: 'C', clock: '9:00' }, // 50% — not NEAR
    { name: 'D', clock: '6:00' }, // 0% — not NEAR
    { name: 'E', clock: '11:00' }, // ~93% — NEAR
  ];
  assert.deepEqual(
    nearOrbits(fixture).map((o) => o.name),
    ['A', 'B', 'E'],
  );
});

test('nearOrbits counts every orbit passed to it, hidden included — callers decide the list', () => {
  // A hidden orbit still has a real clock reading; it's up to the caller
  // (the build warning passes every orbit, the Bridge passes only the
  // displayed ones) to decide whether hidden orbits are in scope.
  const fixture = [
    { name: 'Shown', clock: '12:00', visibility: 'public' },
    { name: 'Hidden', clock: '12:10', visibility: 'hidden' },
  ];
  assert.deepEqual(
    nearOrbits(fixture).map((o) => o.name),
    ['Shown', 'Hidden'],
  );
});

test('NEAR_CAPACITY is a positive integer read from site.config.ts, not hard-coded elsewhere', () => {
  assert.equal(typeof NEAR_CAPACITY, 'number');
  assert.ok(Number.isInteger(NEAR_CAPACITY) && NEAR_CAPACITY > 0);
});

test('sanity: proximity(clockToDeg(...)) matches clockProximityPct for every real orbit clock', () => {
  for (const o of ORBITS) {
    const viaParts = Math.round(proximity(clockToDeg(o.clock)) * 100);
    assert.equal(clockProximityPct(o.clock), viaParts, `${o.name} (${o.clock})`);
  }
});
