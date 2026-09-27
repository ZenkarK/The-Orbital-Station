import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orbitForNote } from '../../scripts/obsidian/site.mjs';

const ORBITS = [
  { id: 'body', folders: ['Health'] },
  { id: 'markets', folders: ['Finance'] },
  { id: 'venture', folders: ['Finance/Ventures'] },
  { id: 'systems', folders: ['Work', 'Aerospace Engineering'] },
  { id: 'words' }, // no folders: never picked automatically
];

test("a note's vault folder picks its orbit", () => {
  assert.equal(orbitForNote('Health/Base Building.md', ORBITS), 'body');
  assert.equal(orbitForNote('Aerospace Engineering/Nozzles/Bell.md', ORBITS), 'systems');
});

test('the most specific folder wins', () => {
  assert.equal(orbitForNote('Finance/Ventures/DocForge.md', ORBITS), 'venture');
  assert.equal(orbitForNote('Finance/10-Year Plan.md', ORBITS), 'markets');
});

test('folders match whole names, in any letter case', () => {
  assert.equal(orbitForNote('health/Sleep.md', ORBITS), 'body');
  assert.equal(orbitForNote('Healthcare/Billing.md', ORBITS), null);
  assert.equal(orbitForNote('Health.md', ORBITS), null);
});

test('notes outside every mapped folder get no orbit', () => {
  assert.equal(orbitForNote('Scratch.md', ORBITS), null);
  assert.equal(orbitForNote('Travel/Japan.md', ORBITS), null);
});

test('Windows-style paths work too', () => {
  assert.equal(orbitForNote('Finance\\Ventures\\DocForge.md', ORBITS), 'venture');
});
