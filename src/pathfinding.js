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
export function findPath(isWalkable, sx, sz, tx, tz, extraCost = null, stepOpen = null) {
  if (!isWalkable(tx, tz)) return null;
  const key = (x, z) => x + ',' + z;
  const dist = new Map([[key(sx, sz), 0]]);
  const prev = new Map();
  const open = [[0, sx, sz]];
  while (open.length) {
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
function walkableCorridor(isWalkable, ax, az, bx, bz, edgeOpen) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  const ox = (-dz / len) * BODY_RADIUS;
  const oz = (dx / len) * BODY_RADIUS;
  return segmentClear(isWalkable, ax, az, bx, bz, edgeOpen)
    && segmentClear(isWalkable, ax + ox, az + oz, bx + ox, bz + oz, edgeOpen)
    && segmentClear(isWalkable, ax - ox, az - oz, bx - ox, bz - oz, edgeOpen);
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
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    if (isOpen(cx + dx, cz + dz)) continue;
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

// "String pulling": collapse a tile-by-tile path into the fewest straight
// runs with clear line of sight, so movement flows at any angle instead of
// stair-stepping tile centres.
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
  return out;
}
