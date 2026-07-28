// Unit tests for the pure pathfinding module. Grids are tiny ASCII pictures:
// '#' solid, '.' open. No PlayCanvas, no DOM - plain node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPath, segmentClear, clampToClearance, approachPoint, truncateByBudget, smoothPath, routeToFiringPosition } from '../../src/pathfinding.js';

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

test('approachPoint stands at reach from an adjacent target', () => {
  // Goal tile (1,0), target at (0,0): the stand point is pulled to `reach` from
  // the target, not left at the goal centre. (The degenerate d<=0 branch would
  // return the centre and fail this.)
  const w = walkableFrom(['..']);
  const [px, pz] = approachPoint(w, null, 1, 0, 0, 0, 0.85);
  assert.ok(Math.abs(Math.hypot(px, pz) - 0.85) < 1e-6, `reach distance, got ${Math.hypot(px, pz)}`);
  assert.ok(Math.abs(px - 1) <= 0.42 + 1e-9, 'still inside the goal tile');
});

test('clampToClearance repels a point from a solid diagonal corner', () => {
  // (2,2) solid, all orthogonals of the standing cell (1,1) open: only the
  // diagonal-corner repulsion can push the point clear.
  const w = walkableFrom(['...', '...', '..#']);
  const [x, z] = clampToClearance(w, null, 1.45, 1.45); // near the (1.5,1.5) corner
  const corner = Math.hypot(x - 1.5, z - 1.5);
  assert.ok(corner >= 0.3 - 1e-9, `pushed to body radius off the corner, got ${corner}`);
});

test('smoothPath leaves null and 2-point paths untouched', () => {
  const open = () => true;
  assert.equal(smoothPath(open, null), null);
  assert.deepEqual(smoothPath(open, [[0, 0], [2, 2]]), [[0, 0], [2, 2]]);
});

test('smoothPath will not straighten a run across a closed edge wall', () => {
  const w = walkableFrom(['...', '...', '...']);
  // A partition on every x=1<->x=2 boundary: cells are open, the edge is not.
  const edgeOpen = (x, z, nx) => !((x === 1 && nx === 2) || (x === 2 && nx === 1));
  const raw = [[0, 0], [1, 0], [1, 2], [2, 2]];
  const s = smoothPath(w, raw, edgeOpen);
  // The straight (0,0)->(2,2) shortcut crosses the walled edge, so it can't
  // collapse to two points.
  assert.ok(s.length >= 3, 'edge wall blocks the diagonal shortcut');
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

// --- routeToFiringPosition (TODO Phase 1) ----------------------------------
// The ranged walk-in used to ask the MELEE question - "route me to a tile
// beside them" - which refused shots that were plainly available.

// Build the world callbacks from a string map. '#' is wall, '.' floor, 'o' an
// occupied tile (walkable terrain, but nobody can stand there - the rule that
// makes a ringed target have no free neighbour at all).
const world = (rows) => {
  const at = (x, z) => (rows[z]?.[x] ?? '#');
  const isWalkable = (x, z) => at(x, z) === '.' || at(x, z) === 'S';
  // Sight crosses anything that is not a wall - so an occupied tile does not
  // block the line, exactly like the game's partitions-vs-bodies split.
  const sightClear = (x, z) => at(x, z) !== '#';
  const hasLos = (x, z, tx, tz) => segmentClear(sightClear, x, z, tx, tz);
  return {
    isWalkable,
    hasLos,
    from: (fx, fz) => ({
      fromX: fx,
      fromZ: fz,
      isWalkable,
      hasLos,
      findPath: (x, z) => findPath(isWalkable, fx, fz, x, z),
    }),
  };
};

test('routeToFiringPosition finds a shot at a target ringed by its own allies', () => {
  // The target (T at 5,3) is boxed in by occupied tiles: NO free neighbour
  // exists, so a melee-style "tile beside them" search returns null - which is
  // what produced "No way to get a shot at them" with the shot wide open.
  const w = world([
    '##########',
    '#........#',
    '#...ooo..#',
    '#...oTo..#',
    '#...ooo..#',
    '#........#',
    '##########',
  ]);
  // No free tile adjacent to the target, confirming the melee question fails.
  const neighbours = [[4,2],[5,2],[6,2],[4,3],[6,3],[4,4],[5,4],[6,4]];
  assert.equal(neighbours.some(([x, z]) => w.isWalkable(x, z)), false);

  const route = routeToFiringPosition({ tx: 5, tz: 3, range: 4, ...w.from(1, 1) });
  assert.ok(route, 'a firing position must be reachable');
  const [ex, ez] = route[route.length - 1];
  assert.ok(Math.max(Math.abs(ex - 5), Math.abs(ez - 3)) <= 4, 'route ends inside range');
  assert.equal(w.hasLos(ex, ez, 5, 3), true, 'route ends with a clear line');
});

test('routeToFiringPosition stops at the NEAREST firing tile, not the target', () => {
  const w = world([
    '##########',
    '#S.......#',
    '#........#',
    '#.......T#',
    '##########',
  ]);
  const route = routeToFiringPosition({ tx: 8, tz: 3, range: 3, ...w.from(1, 1) });
  assert.ok(route);
  const [ex, ez] = route[route.length - 1];
  // Inside range...
  assert.ok(Math.max(Math.abs(ex - 8), Math.abs(ez - 3)) <= 3);
  // ...and it did NOT walk all the way to the target's elbow. Anything at
  // Chebyshev 1 would mean it kept closing after the shot was already on.
  assert.ok(Math.max(Math.abs(ex - 8), Math.abs(ez - 3)) > 1,
    `stopped at (${ex},${ez}) - should not have closed to melee range`);
});

test('routeToFiringPosition returns null when the target is sealed off', () => {
  // Walled into a closet with no line out: no firing position exists, so the
  // caller still refuses - the fix must not open unwinnable fights.
  const w = world([
    '##########',
    '#S.......#',
    '#..#####.#',
    '#..#T..#.#',
    '#..#####.#',
    '##########',
  ]);
  assert.equal(routeToFiringPosition({ tx: 4, tz: 3, range: 4, ...w.from(1, 1) }), null);
});
