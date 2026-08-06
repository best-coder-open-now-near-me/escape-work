// Unit tests for the pure pathfinding module. Grids are tiny ASCII pictures:
// '#' solid, '.' open. No PlayCanvas, no DOM - plain node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPath, segmentClear, clampToClearance, approachPoint, truncateByBudget, smoothPath, routeOpen, routeToFiringPosition, trimToFirst, BODY_RADIUS,
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

test('truncateByBudget prices the continuous point rather than a rounded tile', () => {
  const seen = [];
  truncateByBudget([[0.1, 0], [0.3, 0]], 10, (x) => { seen.push(x); return 1; });
  assert.ok(seen.some((x) => x > 0.1 && x < 0.3));
  assert.ok(seen.every((x) => !Number.isInteger(x)), `sampled exact feet: ${seen}`);
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

test('smoothPath refuses a shortcut with more fine-surface penalty than its route', () => {
  const w = walkableFrom(['...', '...', '...']);
  const raw = [[0, 1], [0, 0], [1, 0], [2, 0], [2, 1]];
  const penalty = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az);
    let cost = 0;
    const n = Math.max(1, Math.ceil(len / 0.05));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (Math.hypot(x - 1, z - 1) < 0.35) cost += len / n;
    }
    return cost;
  };
  const s = smoothPath(w, raw, null, penalty);
  let cost = 0;
  for (let i = 1; i < s.length; i++) cost += penalty(...s[i - 1], ...s[i]);
  assert.ok(cost < 1e-8, `smoothed route stays out of the fine hazard: ${JSON.stringify(s)}`);
});

// --- smoothing from where the body ACTUALLY stands ---------------------------
// The signature jut: walk-ups park the body within BODY_RADIUS of the target's
// blocked tile (approachPoint) or exactly touching a wall (clampToClearance).
// The corridor test must not refuse every span from such a start, or smoothPath
// degrades to raw tile centres and the next click darts to one of them.

test('smoothing from a stand point beside a blocked tile still straightens', () => {
  // The verified jut trace: an NPC occupies (5,8); approachPoint parked the
  // body at ~(4.399, 7.399) - 0.14 from the blocked tile's corner, inside
  // BODY_RADIUS. Clicking toward (8,3) put a probe line's start inside (5,8),
  // so every span from the body failed and the walk visited the raw route's
  // (5,6) tile centre first - the on-screen dart. One straight run now.
  const blocked = (x, z) => x === 5 && z === 8;
  const w = (x, z) => x >= 0 && x <= 9 && z >= 0 && z <= 9 && !blocked(x, z);
  const body = [4.399, 7.399];
  const raw = [body, [5, 6], [6, 5], [7, 4], [8, 3]];
  const s = smoothPath(w, raw);
  assert.equal(s.length, 2, `one straight run, got ${JSON.stringify(s)}`);
  assert.deepEqual(s[0], body);
  assert.deepEqual(s[1], [8, 3]);
});

test('smoothing along a wall the body touches still straightens', () => {
  // Both endpoints clamped against the wall row (clampToClearance leaves the
  // body EXACTLY BODY_RADIUS from the boundary: z = 0.2 against walls at z=1),
  // so the travel is dead parallel and a probe line at the full radius lies ON
  // the boundary - which segmentClear resolves INTO the wall. The old
  // exact-radius probe therefore refused every span and kept a tile-centre
  // elbow; the walk must now be one straight run.
  const w = walkableFrom([
    '......',
    '######',
  ]);
  const raw = [[0.5, 0.2], [1, 0], [2, 0], [3, 0], [4, 0], [4.8, 0.2]];
  const s = smoothPath(w, raw);
  assert.equal(s.length, 2, `one straight run along the wall, got ${JSON.stringify(s)}`);
});

test('endpoint forgiveness does not open a straightening through a partition', () => {
  // A partition on the x=1<->x=2 boundary right beside the stand point. The
  // route goes around its end; the shortcut across it must STILL be refused -
  // the centreline gets no endpoint forgiveness.
  const w = walkableFrom([
    '...',
    '...',
    '...',
  ]);
  const edgeOpen = (x, z, nx, nz) =>
    !((z === 0 || nz === 0) && ((x === 1 && nx === 2) || (x === 2 && nx === 1)));
  const raw = [[1.3, 0], [1, 1], [2, 1], [2, 0]];
  const s = smoothPath(w, raw, edgeOpen);
  assert.ok(s.length >= 3, `must keep the detour around the partition, got ${JSON.stringify(s)}`);
});

test('smoothing from a body leaning over the target tile refuses a run THROUGH it', () => {
  // Forgiving the stand point's overlap must not license a straight run whose
  // centreline crosses the blocked tile itself.
  const blocked = (x, z) => x === 5 && z === 8;
  const w = (x, z) => x >= 0 && x <= 9 && z >= 0 && z <= 9 && !blocked(x, z);
  const body = [4.399, 7.399];
  // Destination diagonally PAST the NPC: the direct line crosses (5,8).
  const raw = [body, [4, 8], [5, 9], [6, 9]];
  const s = smoothPath(w, raw);
  const crosses = s.length === 2;
  assert.ok(!crosses, 'must not straighten through the occupied tile');
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

// --- bends hug corners and walk as curves (DEGRID M7) ------------------------
// String pulling can only DROP vertices, so every bend it kept sat on a raw
// route vertex - a tile centre half a tile off the wall it turned around
// (designer, 2026-07-31: "doesnt hug walls, seems to still be focused on
// them as waypoints"). The tighten pass slides each bend onto the corner at
// body clearance; the rounding pass curves through it.

const pathLen = (p) => {
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return d;
};

test('a bend around a solid cell is pulled onto its corner, at clearance', () => {
  // Solid (1,1); the route goes (0,0) -> (2,0) -> (2,2) around it. The kept
  // bend used to BE the tile centre (2,0); it must now hug the block.
  const w = (x, z) => x >= 0 && x <= 4 && z >= 0 && z <= 4 && !(x === 1 && z === 1);
  const s = smoothPath(w, [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]);
  // Strictly shorter than the corner-at-tile-centre path (length 4)...
  assert.ok(pathLen(s) < 3.9, `hugging shortens the walk, got ${pathLen(s)}`);
  // ...some interior point came close to the block (it hugs, not orbits)...
  const near = s.slice(1, -1).some(([x, z]) => Math.hypot(x - 1, z - 1) < 1.35);
  assert.ok(near, `no vertex hugs the block: ${JSON.stringify(s)}`);
  // ...and nothing clips: every vertex is a spot a body may legally stand.
  for (const [x, z] of s.slice(1, -1)) {
    const [cx, cz] = clampToClearance(w, null, x, z);
    assert.ok(Math.hypot(cx - x, cz - z) < 1e-3, `vertex (${x},${z}) clips the block`);
  }
});

test('a rounded bend is a curve, not a point turn', () => {
  const w = (x, z) => x >= 0 && x <= 4 && z >= 0 && z <= 4 && !(x === 1 && z === 1);
  const s = smoothPath(w, [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]);
  // More than one interior vertex: the single sharp elbow became arc samples.
  assert.ok(s.length > 3, `expected arc samples, got ${JSON.stringify(s)}`);
});

test('a corridor too tight to round keeps its sharp, legal turn', () => {
  // A one-wide L of open floor through walls: no room to swing the bend.
  const rows = [
    '#.##',
    '#.##',
    '#...',
    '####',
  ];
  const w = walkableFrom(rows);
  const s = smoothPath(w, [[1, 0], [1, 1], [1, 2], [2, 2], [3, 2]]);
  // Every vertex still on open floor - the rounding never bought a shortcut
  // through the wall corner.
  for (const [x, z] of s) {
    assert.ok(w(Math.round(x), Math.round(z)), `vertex (${x},${z}) left the corridor`);
  }
  assert.deepEqual(s[s.length - 1], [3, 2]);
});

// --- routeOpen: the smoother believes the route it was handed ----------------
// The router SURCHARGES hazards (extraCost), so a route legally crosses one;
// a smoother that treats those cells as walls can never straighten across
// ground the route chose - stair-steps around every spill. routeOpen unions
// the route's own cells into the smoothing walkability; avoided cells stay
// blocked.

test('routeOpen lets smoothing straighten across a surface the route crossed', () => {
  // Paper on (2,0) and (3,0); no detour exists on a 1-row map, so the route
  // crosses. The hazard-averse base refuses those cells; the smoothed walk
  // must still collapse to one straight run because the ROUTE chose them.
  const hazard = (x, z) => z === 0 && (x === 2 || x === 3);
  const w = walkableFrom(['......']);
  const base = (x, z) => w(x, z) && !hazard(x, z);
  const raw = [[0.3, 0.1], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]];
  const jagged = smoothPath(base, raw);
  assert.ok(jagged.length > 2, 'sanity: the bare base refuses to straighten');
  const s = smoothPath(routeOpen(base, raw), raw);
  assert.equal(s.length, 2, `one straight run across the chosen cells, got ${JSON.stringify(s)}`);
});

test('routeOpen never opens a hazard cell the route avoided', () => {
  // Fire at (1,1); the route detours around it through z=0. The diagonal-ish
  // shortcut through the fire must STILL be refused.
  const hazard = (x, z) => x === 1 && z === 1;
  const w = walkableFrom(['...', '...', '...']);
  const base = (x, z) => w(x, z) && !hazard(x, z);
  const raw = [[0, 2], [0, 1], [1, 0], [2, 1], [2, 2]];
  const s = smoothPath(routeOpen(base, raw), raw);
  for (let i = 1; i < s.length; i++) {
    const [ax, az] = s[i - 1];
    const [bx, bz] = s[i];
    // sample the run: no point of it may sit in the avoided fire cell
    for (let t = 0; t <= 1; t += 0.05) {
      const cx = Math.round(ax + (bx - ax) * t);
      const cz = Math.round(az + (bz - az) * t);
      assert.ok(!hazard(cx, cz), `run ${i} passes through the avoided fire at t=${t}`);
    }
  }
});

test('routeOpen exempts the mover\'s own start tile via the spliced body point', () => {
  // The body stands IN a spill (truncation stopped there). The base refuses
  // the start cell, which used to fail every corridor from vertex 0; the
  // spliced body point's rounded tile is a route cell, so smoothing works.
  const hazard = (x, z) => x === 0 && z === 0;
  const w = walkableFrom(['....']);
  const base = (x, z) => w(x, z) && !hazard(x, z);
  const raw = [[0.2, 0.1], [1, 0], [2, 0], [3, 0]];
  const s = smoothPath(routeOpen(base, raw), raw);
  assert.equal(s.length, 2, `smooths out of the spill, got ${JSON.stringify(s)}`);
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

// --- trimToFirst: a walk-up stops the moment its verb is live ----------------
// The rule that keeps an approach from overshooting. Combat binds `ok` to the
// ARMED power's own range (combat.js verbReaches), so these cover the shape
// rather than any one verb's number.

test('trimToFirst cuts the walk at the first point the verb reaches from', () => {
  // Walking west along z=0 toward a target at the origin, stopping at 1.5.
  const path = [[5, 0], [0.2, 0]];
  const out = trimToFirst(path, (x, z) => Math.hypot(x, z) <= 1.5);
  assert.ok(out);
  const [ex, ez] = out[out.length - 1];
  const d = Math.hypot(ex, ez);
  // Inside the legal zone...
  assert.ok(d <= 1.5, `stopped at ${d}, outside reach`);
  // ...and not one sample deeper than it had to go: the walk must not keep
  // closing after the verb is already live (the "much closer than needed"
  // report). One sampling slice (0.25) is the whole tolerance.
  assert.ok(d > 1.5 - 0.25 - 1e-9, `overshot to ${d} - kept closing past reach`);
  assert.equal(ez, 0); // stayed ON the line it was walking, not offset from it
});

test('trimToFirst keeps the earlier waypoints of a bent route', () => {
  // A dog-leg: north, then west. The verb only comes live on the second leg,
  // so the corner has to survive into the trimmed path or the walker would
  // cut through whatever the bend was avoiding.
  const path = [[4, 4], [4, 0], [0, 0]];
  const out = trimToFirst(path, (x, z) => Math.hypot(x, z) <= 1.5);
  assert.ok(out);
  assert.deepEqual(out[0], [4, 4]);
  assert.deepEqual(out[1], [4, 0]);
  assert.ok(Math.hypot(...out[out.length - 1]) <= 1.5);
});

test('trimToFirst returns null when the verb never comes live', () => {
  // No point on this route is within reach - the caller falls back to walking
  // the whole thing (and its own arrival check refuses the strike).
  assert.equal(trimToFirst([[9, 9], [6, 6]], (x, z) => Math.hypot(x, z) <= 1.5), null);
});

test('trimToFirst stops immediately when the verb is already live', () => {
  // Already in range at the very first sample: the trimmed walk is a step, not
  // a march to the target's elbow.
  const out = trimToFirst([[1.4, 0], [0.2, 0]], (x, z) => Math.hypot(x, z) <= 1.5);
  assert.ok(out);
  assert.ok(out.length <= 2);
  assert.ok(Math.hypot(...out[out.length - 1]) <= 1.5);
});

test('trimToFirst honors a long range - a straw does not walk to the elbow', () => {
  // The same route, trimmed for a 6-tile weapon: it stops six tiles out, where
  // a melee reach would have kept walking. The power's own range IS the aim.
  const path = [[9, 0], [0.2, 0]];
  const far = trimToFirst(path, (x) => x <= 6);
  const near = trimToFirst(path, (x) => x <= 1.5);
  assert.ok(far[far.length - 1][0] > near[near.length - 1][0] + 4);
});

// --- the LEGS, not just the vertices ------------------------------------------
// The corner test above walks the output's VERTICES and asserts each sits on
// open floor. That is not the property the smoother has to hold: a walk is the
// segments BETWEEN the points, and roundBends' rejection path could emit a leg
// it had already proved illegal (`p1` lies on a->b, so a failed a->p1 check
// condemns a->b, and the fallback pushed `b` regardless). Every vertex was
// legal; the line between two of them crossed a partition.

// Sample a segment densely and assert every sample is somewhere a body may be.
const legClear = (walk, w, steps = 24) => {
  for (let i = 1; i < walk.length; i++) {
    const [ax, az] = walk[i - 1];
    const [bx, bz] = walk[i];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (!w(Math.round(x), Math.round(z))) {
        return `leg ${i} (${ax},${az})->(${bx},${bz}) passes through (${Math.round(x)},${Math.round(z)})`;
      }
    }
  }
  return null;
};

test('every LEG of a smoothed walk stays inside the corridor, not just the vertices', () => {
  // The same L-corridor the vertex test uses, walked as segments.
  const w = (x, z) => (x === 1 && z >= 0 && z <= 2) || (z === 2 && x >= 1 && x <= 3);
  const s = smoothPath(w, [[1, 0], [1, 1], [1, 2], [2, 2], [3, 2]]);
  assert.equal(legClear(s, w), null);
});

test('a chain of tight bends never emits a leg through a wall', () => {
  // A zig-zag: consecutive bends, so each arc moves the point the NEXT leg
  // leaves from - which is the case that could strand the walk off the
  // validated polyline. Every leg must still be clear.
  const open = new Set(['1,1', '2,1', '2,2', '3,2', '3,3', '4,3']);
  const w = (x, z) => open.has(`${x},${z}`);
  const s = smoothPath(w, [[1, 1], [2, 1], [2, 2], [3, 2], [3, 3], [4, 3]]);
  assert.equal(legClear(s, w), null);
  assert.deepEqual(s[0], [1, 1]);
  assert.deepEqual(s[s.length - 1], [4, 3]);
});

test('a corridor one tile wide is walked without leaving it', () => {
  // The narrowest case: nothing to round into, so every bend must fall back to
  // the sharp turn rather than a curve that clips the wall.
  const w = (x, z) => (z === 1 && x >= 0 && x <= 3) || (x === 3 && z >= 1 && z <= 4);
  const s = smoothPath(w, [[0, 1], [1, 1], [2, 1], [3, 1], [3, 2], [3, 3], [3, 4]]);
  assert.equal(legClear(s, w), null);
});

// The concrete case the leg tests above kept missing, found by sweeping random
// 8x8 rooms: `legClear` samples TILE CENTRES, and a leg can clip a wall while
// every sample still rounds onto open floor. Asking `segmentClear` - the same
// primitive `walkableCorridor` uses for the travel line - is the real question.
// Here two bends in a row round, so the second bend's `a` is the first arc's
// exit point; its `a -> p1` check fails, and the old fallback pushed the sharp
// corner anyway, sending the walk from (3.80,4.47) to (4.73,5.81) straight
// through the solid cell at (4,5).
test('a rejected arc never falls back onto the leg it just proved illegal', () => {
  const w = walkableFrom([
    '...###..',
    '...##...',
    '#...#.#.',
    '#...###.',
    '.#...#.#',
    '#..#.#..',
    '........',
    '...#....',
  ]);
  const raw = findPath(w, 0, 0, 7, 7);
  const s = smoothPath(w, raw);
  for (let i = 1; i < s.length; i++) {
    assert.ok(segmentClear(w, s[i - 1][0], s[i - 1][1], s[i][0], s[i][1]),
      `leg ${i} (${s[i - 1]}) -> (${s[i]}) leaves the open floor`);
  }
});

test('a search on an unbounded world gives up instead of hanging', () => {
  // Not reachable through the shipped grid - `defAt` returns the wall def out
  // of bounds, so every real world is sealed. This is the guard for when that
  // stops being true, and for a goal the frontier can never land on. Without
  // the cap this call never returns.
  assert.equal(findPath(() => true, 0, 0, NaN, 3), null);
});

test('the cap never fires on a search a real map could produce', () => {
  // A wide-open 60x60 room is far larger than any shipped floor, and must still
  // route normally - a cap that trips on real geometry would be worse than none.
  const w = (x, z) => x >= 0 && x < 60 && z >= 0 && z < 60;
  const p = findPath(w, 0, 0, 59, 59);
  assert.ok(p && p.length > 1, 'a big open room still routes');
  assert.deepEqual(p[p.length - 1], [59, 59]);
});

test('a body keeps clear of a partition END POST, not just the wall', () => {
  // The corner repulsion tested the diagonal TILE and nothing else, so it could
  // not see a wall segment that terminates at the post. A body in the tile
  // beside the partition's row rounded the end and clipped through it - 0.25 of
  // a tile of overlap at BODY_RADIUS 0.3, i.e. 0.05 from a post it must keep
  // 0.3 from.
  const isOpen = () => true;                      // every TILE is open...
  // ...but one partition sits between (0,0) and (1,0), ending at post (0.5,0.5).
  const edgeOpen = (x, z, nx, nz) => !(Math.round(z) === 0 && Math.round(nz) === 0
    && Math.min(Math.round(x), Math.round(nx)) === 0
    && Math.max(Math.round(x), Math.round(nx)) === 1);
  for (let i = 0; i <= 20; i++) {
    const pz = 0.10 + (i / 20) * 0.60;
    const [x, z] = clampToClearance(isOpen, edgeOpen, 0.45, pz);
    const d = Math.hypot(x - 0.5, z - 0.5);
    assert.ok(d >= BODY_RADIUS - 1e-9,
      `body at (${x.toFixed(3)},${z.toFixed(3)}) is ${d.toFixed(3)} from the end post`);
  }
});

test('open ground is not repelled by posts that carry no wall', () => {
  // The other half: a corner with nothing at it must leave the point alone, or
  // the fix would shove bodies around in empty rooms.
  const [x, z] = clampToClearance(() => true, () => true, 0.45, 0.45);
  assert.equal(x, 0.45);
  assert.equal(z, 0.45);
});
