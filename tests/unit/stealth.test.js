// The sneak sight rule (SNEAK_PLAN M1): the wedge, the crouch-height trace,
// and the derived facing - pure, driven with arrow functions and plain
// coordinates like every geometry table in this suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seesBody, coneBoundary, deriveFacing } from '../../src/stealth.js';

const openFloor = () => true;
const opts = (over = {}) => ({ sightClearLow: openFloor, ...over });

test('the wedge: seen inside the facing arc, unseen behind', () => {
  const w = { x: 5, z: 5, facing: { x: 0, z: 1 } }; // looking down +z
  assert.equal(seesBody(w, { x: 5, z: 8 }, opts()), true, 'dead ahead');
  assert.equal(seesBody(w, { x: 7, z: 7 }, opts()), true, '45 degrees is the boundary, inclusive');
  assert.equal(seesBody(w, { x: 8, z: 5 }, opts()), false, '90 degrees off is outside');
  assert.equal(seesBody(w, { x: 5, z: 2 }, opts()), false, 'directly behind');
});

test('the range is a circle, body to body', () => {
  const w = { x: 0, z: 0, facing: { x: 0, z: 1 } };
  assert.equal(seesBody(w, { x: 0, z: 6 }, opts()), true, 'at the rim');
  assert.equal(seesBody(w, { x: 0, z: 6.2 }, opts()), false, 'past the rim');
  // The circle, not a square: 5,4 ahead-right is hypot 6.4, out - even
  // though a 6-tile cheb square would have said in.
  assert.equal(seesBody(w, { x: 4.5, z: 4.5 }, opts()), false);
});

test('a shrunken cone sees less - the talent lever', () => {
  const w = { x: 5, z: 5, facing: { x: 0, z: 1 } };
  const body = { x: 6.8, z: 6.8 }; // ~45 degrees off
  assert.equal(seesBody(w, body, opts()), true);
  assert.equal(seesBody(w, body, opts({ halfAngle: 30 })), false);
});

test('crouch-height blockers hide the body; open floor does not', () => {
  const w = { x: 0, z: 0, facing: { x: 0, z: 1 } };
  const desk = (x, z) => !(x === 0 && z === 2); // a desk between them
  assert.equal(seesBody(w, { x: 0, z: 4 }, opts({ sightClearLow: desk })), false,
    'the desk a shot sails over still hides a sneak');
  assert.equal(seesBody(w, { x: 2, z: 4 }, opts({ sightClearLow: desk })), true,
    'a line that misses the desk still sees');
});

test('a partition edge blocks the crouch-height line', () => {
  const w = { x: 0, z: 0, facing: { x: 0, z: 1 } };
  // A partition two tiles downrange, on the (0,2)<->(0,3) boundary: it
  // blocks the straight-ahead line and nothing else.
  const partition = (x, z, nx, nz) => !(x === 0 && z === 2 && nx === 0 && nz === 3)
    && !(x === 0 && z === 3 && nx === 0 && nz === 2);
  assert.equal(seesBody(w, { x: 0, z: 4 }, opts({ edgeOpenLow: partition })), false,
    'straight ahead, through the partition');
  assert.equal(seesBody(w, { x: 2, z: 2 }, opts({ edgeOpenLow: partition })), true,
    'a line that never crosses it still sees');
});

test('standing inside the watcher is never sneaking', () => {
  const w = { x: 3, z: 3, facing: { x: 0, z: 1 } };
  assert.equal(seesBody(w, { x: 3, z: 3 }, opts()), true);
});

test('deriveFacing looks down the longest open run', () => {
  // Open corridor to the east, wall everywhere else.
  const isOpen = (x, z) => z === 0 && x >= 0 && x <= 6;
  assert.deepEqual(deriveFacing(isOpen, 0, 0), { x: 1, z: 0 });
  // Boxed in on all sides: the default gaze, deterministically.
  assert.deepEqual(deriveFacing(() => false, 0, 0), { x: 0, z: 1 });
});

test('coneBoundary stops each ray where the sight rule does', () => {
  const w = { x: 0, z: 0, facing: { x: 0, z: 1 } };
  // A desk row across z=2: every forward ray must stop short of z=2.5-ish,
  // while the wedge's outermost rays (aimed 45 degrees off) run further.
  const desks = (x, z) => z !== 2;
  const pts = coneBoundary(w, { sightClearLow: desks, rays: 9 });
  assert.equal(pts.length, 9);
  const mid = pts[4]; // dead-ahead ray
  assert.ok(mid[1] < 2.6, `the forward ray stops at the desk row, got z=${mid[1]}`);
  // And an open cone reaches the rim.
  const openPts = coneBoundary(w, { sightClearLow: openFloor, rays: 9 });
  assert.ok(Math.abs(openPts[4][1] - 6) < 1e-6, 'open ray reaches full range');
});
