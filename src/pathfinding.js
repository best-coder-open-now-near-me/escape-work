// Grid pathfinding. Pure logic - no PlayCanvas, no DOM.
export const DIRS8 = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

// Shortest 8-directional path (Dijkstra: diagonals cost sqrt(2)). A diagonal
// step is only allowed when both adjacent orthogonal tiles are open, so actors
// never clip a wall corner. `isWalkable(x, z)` is supplied by the caller and
// may include dynamic blockers. `extraCost(x, z)` (optional) makes tiles
// expensive without blocking them - hazards get routed around unless they are
// the only (or a much shorter) way. `stepOpen(x, z, nx, nz)` (optional) vetoes
// individual steps - this is how edge walls (partitions between tiles) block
// movement without occupying a tile. Returns [[x, z], ...] including the start
// tile, or null when unreachable.
// A ceiling on how much floor one search may explore before giving up.
//
// The search is bounded in practice by the map's walls - `grid.defAt` returns
// the tall `wall` def out of bounds, so every shipped world is sealed and the
// frontier is finite. This is the guard for when that stops being true: an
// unbounded `isWalkable`, or a non-integer goal the frontier can never land on,
// makes the loop run until the tab dies. Verified: `findPath(() => true, 0, 0,
// NaN, 3)` never returns.
//
// Kept because the cost is an integer compare in a loop that already runs and
// the failure it replaces is a frozen browser, not a cosmetic one. The number
// is far above any real search - the largest shipped floor is well under a
// thousand tiles - so reaching it means something upstream is wrong, and a null
// ("no route") is the honest thing to hand back.
const MAX_EXPLORED = 200_000;

export function findPath(isWalkable, sx, sz, tx, tz, extraCost = null, stepOpen = null) {
  if (!isWalkable(tx, tz)) return null;
  const key = (x, z) => x + ',' + z;
  const dist = new Map([[key(sx, sz), 0]]);
  const prev = new Map();
  const open = [[0, sx, sz]];
  let explored = 0;
  while (open.length) {
    if (++explored > MAX_EXPLORED) return null;
    open.sort((a, b) => a[0] - b[0]); // tiny grids; a heap would be overkill
    const [d, x, z] = open.shift();
    if (x === tx && z === tz) break;
    if (d > dist.get(key(x, z))) continue; // stale queue entry
    for (const [dx, dz] of DIRS8) {
      const nx = x + dx;
      const nz = z + dz;
      if (!isWalkable(nx, nz)) continue;
      if (dx !== 0 && dz !== 0 && !(isWalkable(x + dx, z) && isWalkable(x, z + dz))) continue;
      if (stepOpen && !stepOpen(x, z, nx, nz)) continue;
      const nd = d + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1) + (extraCost ? extraCost(nx, nz) : 0);
      const k = key(nx, nz);
      if (nd < (dist.get(k) ?? Infinity)) {
        dist.set(k, nd);
        prev.set(k, [x, z]);
        open.push([nd, nx, nz]);
      }
    }
  }
  if (!dist.has(key(tx, tz))) return null;
  const out = [];
  let cur = [tx, tz];
  while (cur) {
    out.unshift(cur);
    cur = prev.get(key(cur[0], cur[1])) ?? null;
    if (cur && cur[0] === sx && cur[1] === sz) { out.unshift(cur); break; }
  }
  return out;
}

// Does a straight segment between two points (tile-centre coordinates) stay on
// walkable cells? Grid traversal (Amanatides & Woo): visit every cell the
// segment passes through; an exact corner crossing requires both adjacent
// cells open, so there is no squeezing between diagonal walls. `edgeOpen`
// (optional, 4-adjacent signature) additionally vetoes boundary crossings
// blocked by edge walls; a corner crossing needs all four surrounding edges.
export function segmentClear(isWalkable, ax, az, bx, bz, edgeOpen = null) {
  const x0 = ax + 0.5;
  const z0 = az + 0.5; // shift so cell boundaries sit on integers
  const x1 = bx + 0.5;
  const z1 = bz + 0.5;
  let cx = Math.floor(x0);
  let cz = Math.floor(z0);
  const ex = Math.floor(x1);
  const ez = Math.floor(z1);
  if (!isWalkable(cx, cz)) return false;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const stepX = dx > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? cx + 1 - x0 : x0 - cx) * tDeltaX : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? cz + 1 - z0 : z0 - cz) * tDeltaZ : Infinity;
  for (let guard = 0; guard < 512 && (cx !== ex || cz !== ez); guard++) {
    if (Math.abs(tMaxX - tMaxZ) < 1e-9) {
      if (!isWalkable(cx + stepX, cz) || !isWalkable(cx, cz + stepZ)) return false;
      if (edgeOpen && !(edgeOpen(cx, cz, cx + stepX, cz) && edgeOpen(cx, cz, cx, cz + stepZ)
        && edgeOpen(cx + stepX, cz, cx + stepX, cz + stepZ)
        && edgeOpen(cx, cz + stepZ, cx + stepX, cz + stepZ))) return false;
      cx += stepX;
      cz += stepZ;
      tMaxX += tDeltaX;
      tMaxZ += tDeltaZ;
    } else if (tMaxX < tMaxZ) {
      if (edgeOpen && !edgeOpen(cx, cz, cx + stepX, cz)) return false;
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      if (edgeOpen && !edgeOpen(cx, cz, cx, cz + stepZ)) return false;
      cz += stepZ;
      tMaxZ += tDeltaZ;
    }
    if (!isWalkable(cx, cz)) return false;
  }
  return true;
}

// A character has width: check the centreline plus two offset lines.
export const BODY_RADIUS = 0.3;

// The offset lines probe at a hair UNDER the body radius. clampToClearance
// parks bodies at exactly BODY_RADIUS from a blocked boundary, so a probe at
// exactly that radius lies ON the boundary - and segmentClear's floor resolves
// an exact boundary coordinate INTO the blocked cell. A body touching a wall
// is legal; the test must not treat touching as clipping, or every character
// who last stopped against a wall loses all smoothing on their next walk.
const PROBE_RADIUS = BODY_RADIUS - 0.02;

// Cells the body ALREADY legally overlaps while standing at (px, pz): every
// cell whose square comes within `r` of the point. At most four. The corridor
// forgives these for its probe lines - the game itself put the body there
// (approachPoint deliberately leans a stand point over the target's blocked
// tile), so clipping them at the span's ends is the stance, not a new
// violation. The CENTRELINE never gets this forgiveness: it is the travel
// path, and it must genuinely cross only open ground and open edges.
function overlappedCells(px, pz, r) {
  const out = new Set();
  for (let cx = Math.round(px - r); cx <= Math.round(px + r); cx++) {
    for (let cz = Math.round(pz - r); cz <= Math.round(pz + r); cz++) {
      const nx = Math.max(cx - 0.5, Math.min(cx + 0.5, px));
      const nz = Math.max(cz - 0.5, Math.min(cz + 0.5, pz));
      if (Math.hypot(nx - px, nz - pz) <= r) out.add(cx + ',' + cz);
    }
  }
  return out;
}

function walkableCorridor(isWalkable, ax, az, bx, bz, edgeOpen) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  const ox = (-dz / len) * PROBE_RADIUS;
  const oz = (dx / len) * PROBE_RADIUS;
  // The travel path itself: strict.
  if (!segmentClear(isWalkable, ax, az, bx, bz, edgeOpen)) return false;
  // The width probes: forgiven the cells (and edges wholly between such
  // cells) that the body legally overlaps at either endpoint.
  const exempt = overlappedCells(ax, az, BODY_RADIUS + 0.05);
  for (const c of overlappedCells(bx, bz, BODY_RADIUS + 0.05)) exempt.add(c);
  const open = (x, z) => isWalkable(x, z) || exempt.has(x + ',' + z);
  const eOpen = edgeOpen
    ? (x, z, nx, nz) => edgeOpen(x, z, nx, nz)
      || (exempt.has(x + ',' + z) && exempt.has(nx + ',' + nz))
    : null;
  return segmentClear(open, ax + ox, az + oz, bx + ox, bz + oz, eOpen)
    && segmentClear(open, ax - ox, az - oz, bx - ox, bz - oz, eOpen);
}

// Standing spots are free points, not tile centres - but a body must stay
// clear of solid cells and edge walls. Clamp a point within its cell away
// from every blocked boundary; solid diagonal neighbours repel from their
// corner too. Returns [x, z].
export function clampToClearance(isOpen, edgeOpen, px, pz, radius = BODY_RADIUS) {
  const cx = Math.round(px);
  const cz = Math.round(pz);
  const blocked = (nx, nz) => !isOpen(nx, nz) || (edgeOpen && !edgeOpen(cx, cz, nx, nz));
  let x = px;
  let z = pz;
  if (blocked(cx + 1, cz)) x = Math.min(x, cx + 0.5 - radius);
  if (blocked(cx - 1, cz)) x = Math.max(x, cx - 0.5 + radius);
  if (blocked(cx, cz + 1)) z = Math.min(z, cz + 0.5 - radius);
  if (blocked(cx, cz - 1)) z = Math.max(z, cz - 0.5 + radius);
  // The four corner posts. A post is solid when the DIAGONAL TILE is solid -
  // or when any wall segment terminates there, which is the case the tile test
  // alone cannot see.
  //
  // The two edges touching the body's own tile are already handled above: an
  // orthogonal clamp pushes it clear along that axis. The two on the FAR side
  // were not consulted at all, so a body standing in the tile beside a
  // partition's row could round its end post and clip straight through it -
  // measured at 0.25 of a tile with BODY_RADIUS 0.3, i.e. the body ending up
  // 0.05 from a post it must keep 0.3 from.
  const postSolid = (dx, dz) => !isOpen(cx + dx, cz + dz)
    || (edgeOpen && (!edgeOpen(cx + dx, cz, cx + dx, cz + dz)
      || !edgeOpen(cx, cz + dz, cx + dx, cz + dz)));
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    if (!postSolid(dx, dz)) continue;
    const kx = cx + dx * 0.5;
    const kz = cz + dz * 0.5;
    const vx = x - kx;
    const vz = z - kz;
    const d = Math.hypot(vx, vz);
    if (d >= radius) continue;
    if (d < 1e-6) { x = cx; z = cz; break; }
    x = kx + (vx / d) * radius;
    z = kz + (vz / d) * radius;
  }
  return [x, z];
}

// Where to actually STAND in a goal tile when approaching a target: at
// `reach` distance from the target's body along the approach line - walk up
// TO them, not to the middle of the neighbouring square. The point is kept
// inside the goal tile so the derived logical tile (and every tile-keyed
// adjacency check) is unaffected, then clamped clear of walls.
export function approachPoint(isOpen, edgeOpen, gx, gz, tx, tz, reach = 0.85) {
  const dx = gx - tx;
  const dz = gz - tz;
  const d = Math.hypot(dx, dz);
  let px = gx;
  let pz = gz;
  if (d > 1e-6) {
    px = Math.min(gx + 0.42, Math.max(gx - 0.42, tx + (dx / d) * reach));
    pz = Math.min(gz + 0.42, Math.max(gz - 0.42, tz + (dz / d) * reach));
  }
  return clampToClearance(isOpen, edgeOpen, px, pz);
}

// Cut a (smoothed) polyline at the FIRST point along it where `ok(x, z)` holds
// - the walk-up's "stop the moment the verb is live" rule. Returns that prefix,
// or null if the predicate never holds along the whole path.
//
// This is what keeps an approach from overshooting: routing to a tile BESIDE
// the target and walking the whole way there stops at a distance borrowed from
// the goal tile rather than from the verb being used - much closer than a long
// weapon (or a 6-tile straw) ever needed to be, and offset onto the
// target -> goal-tile line instead of the line actually being walked. Trimming
// the walked polyline answers both: the stop point is ON the player's own
// approach, at the first spot the verb reaches from.
//
// Sampled at the same resolution truncateByBudget uses, so the two agree about
// where a point on a segment is. Sampling only ever stops INSIDE the legal
// zone (the first sample past the boundary), never short of it.
export function trimToFirst(path, ok, slice = 0.25) {
  if (!path || path.length < 2) return null;
  const out = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-9) continue;
    const n = Math.max(1, Math.ceil(len / slice));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      const px = ax + (bx - ax) * t;
      const pz = az + (bz - az) * t;
      if (ok(px, pz)) {
        out.push([px, pz]);
        return out;
      }
    }
    out.push([bx, bz]);
  }
  return null;
}

// Walk a (smoothed) polyline charging `rate(x, z)` per unit of DISTANCE,
// sampled from the cell under each slice. Returns the affordable prefix -
// which may end mid-segment, so a move can stop at any point when the budget
// runs dry - plus the exact cost spent, whether the whole path was afforded,
// and the unaffordable remainder (for previews).
export function truncateByBudget(path, budget, rate) {
  const SLICE = 0.25; // sampling resolution along segments
  const out = [path[0]];
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-9) continue;
    const n = Math.max(1, Math.ceil(len / SLICE));
    const step = len / n;
    let t = 0;
    for (let s = 0; s < n; s++) {
      const mid = (t + step / 2) / len;
      const r = rate(Math.round(ax + (bx - ax) * mid), Math.round(az + (bz - az) * mid));
      const c = step * r;
      if (cost + c > budget + 1e-9) {
        const within = r > 0 ? Math.max(0, (budget - cost) / r) : step;
        const k = (t + within) / len;
        cost += within * r;
        const cut = [ax + (bx - ax) * k, az + (bz - az) * k];
        if (k > 1e-6) out.push(cut);
        return { points: out, cost, done: false, tail: [cut, ...path.slice(i)] };
      }
      cost += c;
      t += step;
    }
    out.push([bx, bz]);
  }
  return { points: out, cost, done: true, tail: null };
}

// The smoothing walkability for a just-planned route: the base rule, plus
// the cells the route itself steps on. The router prices hazard cells
// (extraCost) rather than blocking them, so a route legally crosses a spill
// when the detour costs more - and a smoother that treats those same cells
// as walls can never straighten across ground the route deliberately chose,
// which un-smooths every walk near a surface into tile-centre stair-steps.
// Cells the route AVOIDED stay exactly as blocked as `base` says: the union
// only ever opens ground the router already accepted, so a straight line
// still refuses to cut through the fire the Dijkstra paid to go around.
// Vertices are rounded, so the spliced body point exempts the mover's own
// tile - a walker standing IN a spill can smooth its way out.
export function routeOpen(base, path) {
  const chosen = new Set((path || []).map(([x, z]) => Math.round(x) + ',' + Math.round(z)));
  return (x, z) => base(x, z) || chosen.has(x + ',' + z);
}

// Would a body legally STAND at (px, pz)? clampToClearance is the rule that
// places every stand point; a point it would not move is a point the body may
// occupy. The tightening pass below uses this as its hard stop, so a moved
// bend can hug a corner down to exactly body radius and never into it.
function standsClear(isWalkable, edgeOpen, px, pz) {
  const [cx, cz] = clampToClearance(isWalkable, edgeOpen, px, pz);
  return Math.hypot(cx - px, cz - pz) < 1e-3;
}

// Pull each interior bend toward the straight line between its neighbours,
// as far as the body-radius corridor allows (DEGRID M7). String pulling can
// only DROP vertices, never move them - so every bend it keeps sits on a raw
// route vertex, a tile centre half a tile off the wall it turns around, and
// walks read as aiming at waypoints instead of hugging the corner. Sliding
// the bend toward its neighbours' chord shortens the path until the capsule
// touches the obstacle: the bend converges onto the corner at exact
// clearance, which is the shape a navmesh funnel would have produced.
//
// The corridor's endpoint forgiveness (walkableCorridor) is for stand points
// the game itself placed; a vertex this pass MOVES earns no such grace, so
// every candidate must also be a spot a body could legally stand
// (standsClear). A few rounds propagate the slack along the path.
const TIGHTEN_ROUNDS = 3;
function tightenPath(isWalkable, path, edgeOpen) {
  if (path.length <= 2) return path;
  const out = path.map((p) => [p[0], p[1]]);
  for (let r = 0; r < TIGHTEN_ROUNDS; r++) {
    let moved = false;
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1];
      const b = out[i];
      const c = out[i + 1];
      const mx = (a[0] + c[0]) / 2;
      const mz = (a[1] + c[1]) / 2;
      if (Math.hypot(mx - b[0], mz - b[1]) < 1e-3) continue;
      // Binary search along bend -> chord midpoint for the deepest legal pull.
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < 8; k++) {
        const t = (lo + hi) / 2;
        const px = b[0] + (mx - b[0]) * t;
        const pz = b[1] + (mz - b[1]) * t;
        if (standsClear(isWalkable, edgeOpen, px, pz)
          && walkableCorridor(isWalkable, a[0], a[1], px, pz, edgeOpen)
          && walkableCorridor(isWalkable, px, pz, c[0], c[1], edgeOpen)) lo = t;
        else hi = t;
      }
      if (lo > 1e-3) {
        b[0] += (mx - b[0]) * lo;
        b[1] += (mz - b[1]) * lo;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}

// Round each bend into a short validated arc (DEGRID M7), so the walk curves
// through corners instead of turning on a point. The arc is a quadratic
// bezier between two lead-in points on the legs; it bows AWAY from the
// obstacle the tightened bend hugs (the curve stays between the sharp corner
// and its chord), but every chord is still corridor-checked and the sharp
// bend kept whenever the room genuinely is that tight.
const BEND_RADIUS = 0.4;
const BEND_STEPS = 3;
function roundBends(isWalkable, path, edgeOpen) {
  if (path.length <= 2) return path;
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1];
    const b = path[i];
    const c = path[i + 1];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const d = Math.min(BEND_RADIUS, ab / 2, bc / 2);
    if (d < 0.05) { out.push(b); continue; }
    const p1 = [b[0] - ((b[0] - a[0]) / ab) * d, b[1] - ((b[1] - a[1]) / ab) * d];
    const p2 = [b[0] + ((c[0] - b[0]) / bc) * d, b[1] + ((c[1] - b[1]) / bc) * d];
    const arc = [p1];
    for (let s = 1; s < BEND_STEPS; s++) {
      const t = s / BEND_STEPS;
      const u = 1 - t;
      arc.push([
        u * u * p1[0] + 2 * u * t * b[0] + t * t * p2[0],
        u * u * p1[1] + 2 * u * t * b[1] + t * t * p2[1],
      ]);
    }
    arc.push(p2);
    // Every sample must be a spot a body may legally STAND - the tightened
    // bend earned its clearance through clampToClearance, and the curve
    // through it may not spend what the bend banked. Clamping (rather than
    // rejecting) keeps the curve when it merely grazes; the corridor checks
    // below still throw the whole arc away if clamping bent it into a wall.
    for (const p of arc) {
      const [qx, qz] = clampToClearance(isWalkable, edgeOpen, p[0], p[1]);
      p[0] = qx;
      p[1] = qz;
    }
    let ok = walkableCorridor(isWalkable, a[0], a[1], p1[0], p1[1], edgeOpen);
    for (let s = 1; ok && s < arc.length; s++) {
      ok = walkableCorridor(isWalkable, arc[s - 1][0], arc[s - 1][1], arc[s][0], arc[s][1], edgeOpen);
    }
    if (ok) out.push(...arc);
    else out.push(b); // too tight to round - the sharp turn is the truth
  }
  out.push(path[path.length - 1]);
  return out;
}

// "String pulling": collapse a tile-by-tile path into the fewest straight
// runs with clear line of sight - then pull the surviving bends onto the
// corners they round (tightenPath) and curve through them (roundBends), so
// movement flows at any angle, hugs walls at body radius, and never reads
// as aiming at waypoints.
export function smoothPath(isWalkable, path, edgeOpen = null) {
  if (!path || path.length <= 2) return path;
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1 && !walkableCorridor(isWalkable, path[i][0], path[i][1], path[j][0], path[j][1], edgeOpen)) j--;
    out.push(path[j]);
    i = j;
  }
  return roundBends(isWalkable, tightenPath(isWalkable, out, edgeOpen), edgeOpen);
}

// The cheapest route to a tile a RANGED attack could fire at (tx, tz) from, or
// null when no such tile is reachable.
//
// This is deliberately a different question from "route to a tile beside the
// target". A weapon with reach does not need the target's elbow, only a tile
// inside its range with a line to them - and asking the melee question refused
// shots that were plainly available: a coworker ringed by their own colleagues
// has no free neighbouring tile at all (walkability excludes occupied ones),
// and one standing the far side of a chest-high partition has neighbours that
// cannot be walked to, while a dozen firing positions sit a few steps away.
//
// Candidates are swept nearest-first and the loop stops as soon as no remaining
// one could win: a route covering Chebyshev distance h is at least h + 1 tiles
// long (a path includes its start tile), so once `h + 1` reaches the best
// length already found, the sorted remainder cannot beat it. That keeps a click
// to a couple of searches instead of the whole range box.
//
// Pure: every world question arrives as a callback, so this is the same
// function in and out of combat, and a test can drive it with a string map.
//   isWalkable(x, z)      - can a body stand there
//   hasLos(x, z, tx, tz)  - is the shot's line clear from there
//   findPath(x, z)        - route from the shooter to there, or null
export function routeToFiringPosition({ tx, tz, range, fromX, fromZ, isWalkable, hasLos, findPath }) {
  const cands = [];
  for (let dz = -range; dz <= range; dz++) {
    for (let dx = -range; dx <= range; dx++) {
      const ax = tx + dx;
      const az = tz + dz;
      if (!isWalkable(ax, az)) continue;
      if (!hasLos(ax, az, tx, tz)) continue;
      cands.push([ax, az, Math.max(Math.abs(ax - fromX), Math.abs(az - fromZ))]);
    }
  }
  cands.sort((p, q) => p[2] - q[2]);
  let best = null;
  for (const [ax, az, h] of cands) {
    if (best && h + 1 >= best.length) break;
    const p = findPath(ax, az);
    if (p && p.length >= 2 && (!best || p.length < best.length)) best = p;
  }
  return best;
}
