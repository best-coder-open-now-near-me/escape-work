// The floor marks' geometry. This is the half of the drawing that is
// arithmetic - where a face bar's endpoints land, where a ring's points sit -
// and until ground-marks.js existed it lived twice inside two closures that no
// test could reach, in two different spellings of the same perpendicular.
import test from 'node:test';
import assert from 'node:assert';
import { faceBar, ringPoint, createGroundMarks } from '../../src/ground-marks.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('a face bar sits on its edge and runs along it, not across it', () => {
  // East face of the tile at the origin: the bar's midpoint is at x = 0.5, and
  // the bar runs north-south. If the perpendicular were taken the other way
  // the bar would stick OUT of the tile instead of lying along its edge.
  const [a, b] = faceBar(0, 0, 1, 0);
  assert.ok(near(a[0], 0.5) && near(b[0], 0.5), 'both ends sit on the east edge');
  assert.ok(near(a[1], -0.42) && near(b[1], 0.42), 'and run along it in z');

  // North face: the same claim with the axes swapped.
  const [c, d] = faceBar(0, 0, 0, 1);
  assert.ok(near(c[1], 0.5) && near(d[1], 0.5));
  assert.ok(near(c[0], -0.42) && near(d[0], 0.42));
});

test('a face bar is centred on the edge midpoint, wherever the tile is', () => {
  const [a, b] = faceBar(7, -3, -1, 0);
  assert.ok(near((a[0] + b[0]) / 2, 6.5), 'midpoint is half a tile west of centre');
  assert.ok(near((a[1] + b[1]) / 2, -3));
});

test('a face bar is shorter than the edge it marks', () => {
  // 0.84 of a 1.0 tile edge: deliberately short, so two adjacent covered faces
  // read as two bars rather than one continuous line.
  const [a, b] = faceBar(0, 0, 1, 0);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  assert.ok(len < 1, `bar (${len}) must not span the whole edge`);
});

test('ring points lie on the circle and close the loop', () => {
  for (const i of [0, 4, 9, 13, 18]) {
    const [x, z] = ringPoint(2, -5, 0.42, i);
    assert.ok(near(Math.hypot(x - 2, z + 5), 0.42), `point ${i} is on the circle`);
  }
  // Segment 0 and segment SEGS are the same point - that is what makes the
  // drawn line close rather than leaving a gap.
  const first = ringPoint(0, 0, 1, 0);
  const last = ringPoint(0, 0, 1, 18);
  assert.ok(near(first[0], last[0]) && near(first[1], last[1]));
});

test('the palette is one object shared by every caller', () => {
  // The point of the module: combat.js and hover.js get the SAME colours, so a
  // re-theme cannot land in one file and not the other. A fake pc is enough -
  // nothing here needs an engine.
  const Color = class { constructor(r, g, b) { Object.assign(this, { r, g, b }); } };
  const Vec3 = class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } };
  const drawn = [];
  const app = { drawLine: (a, b, c) => drawn.push([a, b, c]) };
  const m = createGroundMarks(app, { Color, Vec3 });

  assert.deepEqual([m.OK.r, m.OK.g, m.OK.b], [0.42, 0.78, 0.35]);
  assert.deepEqual([m.FAR.r, m.FAR.g, m.FAR.b], [0.85, 0.28, 0.24]);
  assert.deepEqual([m.COVER.r, m.COVER.g, m.COVER.b], [0.95, 0.8, 0.3]);
  assert.deepEqual([m.REACH.r, m.REACH.g, m.REACH.b], [0.55, 0.62, 0.78]);

  // And the drawing actually reaches the engine handle it was given.
  m.ring(0, 0, 1, m.OK);
  assert.equal(drawn.length, 18, 'a ring is 18 segments');
  drawn.length = 0;
  m.faces(0, 0, [[1, 0], [0, -1]], m.COVER);
  assert.equal(drawn.length, 2, 'one line per shielded face');
  assert.equal(drawn[0][2], m.COVER, 'drawn in the colour it was handed');
});

test('an empty or absent face list draws nothing', () => {
  const Vec3 = class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } };
  const drawn = [];
  const m = createGroundMarks({ drawLine: () => drawn.push(1) },
    { Color: class {}, Vec3 });
  m.faces(0, 0, null, null);
  m.faces(0, 0, [], null);
  assert.equal(drawn.length, 0);
});
