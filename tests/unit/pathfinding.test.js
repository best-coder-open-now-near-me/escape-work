// Unit tests for the pure pathfinding module. Grids are tiny ASCII pictures:
// '#' solid, '.' open. No PlayCanvas, no DOM - plain node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findPath, segmentClear, clampToClearance, approachPoint,
  truncateByBudget, smoothPath,
} from '../../src/pathfinding.js';

// Build isWalkable from rows of '.'/'#'; everything off-map is solid.
const walkableFrom = (rows) => (x, z) =>
  z >= 0 && z < rows.length && x >= 0 && x < rows[z].length && rows[z][x] === '.';

test('findPath walks a straight open row', () => {
  const w = walkableFrom(['....']);
  const p = findPath(w, 0, 0, 3, 0);
  assert.deepEqual(p, [[0, 0], [1, 0], [2, 0], [3, 0]]);
});

test('findPath returns null when the target is solid or unreachable', () => {
  const w = walkableFrom(['..#.']);
  assert.equal(findPath(w, 0, 0, 2, 0), null); // target solid
  assert.equal(findPath(w, 0, 0, 3, 0), null); // sealed off
});

test('findPath never cuts a solid corner diagonally', () => {
  // Diagonal from (0,0) to (1,1) must be forbidden when both orthogonal
  // neighbours are solid - the route has to go around.
  const w = walkableFrom([
    '.#.',
    '#..',
    '...',
  ]);
  assert.equal(findPath(w, 0, 0, 1, 1), null);
});

test('findPath respects stepOpen edge vetoes', () => {
  const w = walkableFrom(['..']);
  const wallBetween = (x, z, nx) => !(x === 0 && nx === 1) && !(x === 1 && nx === 0);
  assert.equal(findPath(w, 0, 0, 1, 0, null, wallBetween), null);
});

test('findPath routes around expensive tiles when a detour exists', () => {
  const w = walkableFrom([
    '...',
    '...',
  ]);
  const spicy = (x, z) => (x === 1 && z === 0 ? 10 : 0);
  const p = findPath(w, 0, 0, 2, 0, spicy);
  assert.ok(!p.some(([x, z]) => x === 1 && z === 0), 'path avoids the expensive cell');
});

test('segmentClear sees along an open row and stops at walls', () => {
  const w = walkableFrom(['...#.']);
  assert.equal(segmentClear(w, 0, 0, 2, 0), true);
  assert.equal(segmentClear(w, 0, 0, 4, 0), false);
});

test('segmentClear cannot squeeze through a diagonal corner', () => {
  const w = walkableFrom([
    '.#',
    '#.',
  ]);
  assert.equal(segmentClear(w, 0, 0, 1, 1), false);
});

test('segmentClear honours edgeOpen for boundary crossings', () => {
  const w = walkableFrom(['..']);
  const sealed = () => false;
  assert.equal(segmentClear(w, 0, 0, 1, 0, sealed), false);
});

test('clampToClearance pulls a point off a blocked boundary', () => {
  const w = walkableFrom(['.#']); // (1,0) solid, standing in (0,0)
  const [x] = clampToClearance(w, null, 0.49, 0);
  assert.ok(x <= 0.5 - 0.3 + 1e-9, `clamped away from the wall, got ${x}`);
});

test('approachPoint stays inside the goal tile', () => {
  const w = walkableFrom(['...']);
  const [px, pz] = approachPoint(w, null, 1, 0, 0, 0);
  assert.ok(Math.abs(px - 1) <= 0.42 + 1e-9 && Math.abs(pz - 0) <= 0.42 + 1e-9);
});

test('truncateByBudget affords a whole cheap path exactly', () => {
  const { points, cost, done, tail } = truncateByBudget([[0, 0], [3, 0]], 5, () => 1);
  assert.equal(done, true);
  assert.equal(tail, null);
  assert.ok(Math.abs(cost - 3) < 1e-6);
  assert.deepEqual(points[points.length - 1], [3, 0]);
});

test('truncateByBudget cuts mid-segment when the budget runs dry', () => {
  const { points, cost, done, tail } = truncateByBudget([[0, 0], [4, 0]], 2.5, () => 1);
  assert.equal(done, false);
  assert.ok(Math.abs(cost - 2.5) < 0.05, `spent ~2.5, got ${cost}`);
  const [ex] = points[points.length - 1];
  assert.ok(Math.abs(ex - 2.5) < 0.15, `stopped near x=2.5, got ${ex}`);
  assert.ok(tail && tail.length >= 2, 'tail returned for previews');
});

test('truncateByBudget charges double through expensive cells', () => {
  const rate = (x) => (x >= 2 ? 2 : 1);
  const { cost } = truncateByBudget([[0, 0], [4, 0]], 100, rate);
  // ~1.5 units at rate 1 (cells 0-1), ~2.5 units at rate 2 (cells 2-4).
  assert.ok(cost > 5 && cost < 7, `mixed-rate cost ~6.5ish, got ${cost}`);
});

test('smoothPath collapses a dog-leg with clear line of sight', () => {
  const w = walkableFrom([
    '...',
    '...',
    '...',
  ]);
  const s = smoothPath(w, [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]);
  assert.ok(s.length < 5, 'fewer waypoints than the raw path');
  assert.deepEqual(s[0], [0, 0]);
  assert.deepEqual(s[s.length - 1], [2, 2]);
});

test('smoothPath never straightens through a cell the route avoided', () => {
  // Route hugs the open top-right corridor around a solid centre column.
  const w = walkableFrom([
    '...',
    '.#.',
    '...',
  ]);
  const raw = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]];
  const s = smoothPath(w, raw);
  // A straight (0,0)->(2,2) shortcut would clip the solid centre.
  assert.ok(!(s.length === 2), 'must not shortcut through the blocked cell');
});
