import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ringRadius, placeLabels } from '../../src/lib/orrery-layout.ts';

/* A 640×640 orrery centred at (320, 320): 10px-tall labels, 7px bodies, 4px gap. */
const O = { cx: 320, cy: 320, size: 640, h: 10, bodyR: 7, gap: 4 };

/* Geometry derived here, independently of the module under test. */
const labelBox = (p, w, h = O.h) => ({ x0: p.x - w / 2, y0: p.y - h / 2, x1: p.x + w / 2, y1: p.y + h / 2 });
const bodyBox = (b) => ({ x0: b.x - O.bodyR, y0: b.y - O.bodyR, x1: b.x + O.bodyR, y1: b.y + O.bodyR });
const hits = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function assertLegible(bodies, placed, size = O.size) {
  const byId = Object.fromEntries(placed.map((p) => [p.id, p]));
  const boxes = bodies.map((b) => ({ id: b.id, box: labelBox(byId[b.id], b.w) }));
  for (const { id, box } of boxes) {
    assert.ok(box.x0 >= 0 && box.y0 >= 0 && box.x1 <= size && box.y1 <= size, `${id} label leaves the canvas`);
    for (const b of bodies) assert.ok(!hits(box, bodyBox(b)), `${id} label covers the ${b.id} body`);
    for (const o of boxes) if (o.id !== id) assert.ok(!hits(box, o.box), `${id} and ${o.id} labels overlap`);
  }
}

test('rings spread evenly from the inner to the outer radius', () => {
  assert.equal(ringRadius(0, 3, 60, 260), 60);
  assert.equal(ringRadius(1, 3, 60, 260), 160);
  assert.equal(ringRadius(2, 3, 60, 260), 260);
});

test('a single orbit sits on the inner ring instead of NaN', () => {
  assert.equal(ringRadius(0, 1, 60, 260), 60);
});

test('a lone label sits just outside its body, on the side away from the center', () => {
  // 12 o'clock: straight up by bodyR + gap + half the label height.
  assert.deepEqual(placeLabels([{ id: 'a', x: 320, y: 100, w: 40 }], O), [{ id: 'a', x: 320, y: 84 }]);
  // 3 o'clock: straight right by bodyR + gap + half the label width.
  assert.deepEqual(placeLabels([{ id: 'a', x: 500, y: 320, w: 40 }], O), [{ id: 'a', x: 531, y: 320 }]);
});

test('a label that would cover the body on the next ring moves somewhere legible', () => {
  const bodies = [
    { id: 'inner', x: 320, y: 100, w: 40 },
    { id: 'outer', x: 320, y: 81, w: 40 },
  ];
  const placed = placeLabels(bodies, O);
  assert.notDeepEqual(placed.find((p) => p.id === 'inner'), { id: 'inner', x: 320, y: 84 });
  assert.deepEqual(placed.find((p) => p.id === 'outer'), { id: 'outer', x: 320, y: 65 });
  assertLegible(bodies, placed);
});

test('earlier bodies keep their spot when two labels compete for it', () => {
  const a = { id: 'a', x: 320, y: 100, w: 60 };
  const b = { id: 'b', x: 345, y: 103, w: 60 };
  const [aAlone] = placeLabels([a], O);
  const [bAlone] = placeLabels([b], O);
  assert.ok(hits(labelBox(aAlone, a.w), labelBox(bAlone, b.w)), 'fixture: the preferred spots must collide');

  const ab = placeLabels([a, b], O);
  assert.deepEqual(ab.find((p) => p.id === 'a'), aAlone);
  assertLegible([a, b], ab);

  const ba = placeLabels([b, a], O);
  assert.deepEqual(ba.find((p) => p.id === 'b'), bAlone);
  assertLegible([a, b], ba);
});

test('labels on the outer ring stay inside the canvas', () => {
  const bodies = [{ id: 'edge', x: 592, y: 320, w: 60 }];
  assertLegible(bodies, placeLabels(bodies, O));
});

test('twelve bodies lined up at 12 o\'clock all get readable labels', () => {
  const bodies = Array.from({ length: 12 }, (_, i) => ({ id: `o${i}`, x: 320, y: 320 - ringRadius(i, 12, 64, 272), w: 58 }));
  assertLegible(bodies, placeLabels(bodies, { ...O, h: 10.5 }));
});

test('a body sitting on the center still gets a label (no NaN)', () => {
  const [p] = placeLabels([{ id: 'c', x: 320, y: 320, w: 40 }], O);
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});
