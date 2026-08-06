// Sneaking's sight rule (SNEAK_PLAN M1). Pure logic - no PlayCanvas, no DOM:
// every world question arrives as a callback, so the game, the rendered cone
// and the unit table all run the ONE predicate. THE RENDERED CONE IS THE RULE
// - main.js must draw from seesBody's terms, never a second geometry.
import { segmentClear } from './pathfinding.js';
import { STEALTH } from './stats.js';

const DEG = Math.PI / 180;

// The direction with the longest run of open floor - a coworker who has
// never moved looks down their corridor, not into the wall behind their
// desk (SNEAK_PLAN D7: levels store no facing, so v1 derives one).
// Cardinals only: a cone is a gaze, and a gaze down an aisle reads; ties
// break in scan order, deterministically.
export function deriveFacing(isOpen, x, z, max = 8) {
  let best = { x: 0, z: 1 };
  let bestRun = -1;
  for (const [fx, fz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
    let run = 0;
    for (let i = 1; i <= max; i++) {
      if (!isOpen(x + fx * i, z + fz * i)) break;
      run += 1;
    }
    if (run > bestRun) {
      bestRun = run;
      best = { x: fx, z: fz };
    }
  }
  return best;
}

// Does this watcher SEE that sneaking body? Three terms, all deterministic
// (SNEAK_PLAN D2 - the cone you can see is the rule, no dice):
//   1. range   - a true-distance circle, body to body (DEGRID D4)
//   2. angle   - within halfAngle of the watcher's facing
//   3. line    - a CROUCH-height sight trace: `sightClearLow` blocks the
//                cells standing sight ignores (desks, cover-grade props)
//                and `edgeOpenLow` blocks partitions and closed doors -
//                a sneaking body is crouch-height, so the furniture that
//                shields a crouch also hides a sneak.
// watcher: { x, z, facing: {x, z} }, body: { x, z } - continuous positions.
export function seesBody(watcher, body, {
  halfAngle = STEALTH.CONE_HALF_ANGLE,
  range = STEALTH.CONE_RANGE,
  sightClearLow,
  edgeOpenLow = null,
} = {}) {
  const dx = body.x - watcher.x;
  const dz = body.z - watcher.z;
  const d = Math.hypot(dx, dz);
  if (d > range) return false;
  if (d < 1e-6) return true; // standing inside them is not sneaking
  const f = watcher.facing || { x: 0, z: 1 };
  const fl = Math.hypot(f.x, f.z) || 1;
  const cos = (dx * f.x + dz * f.z) / (d * fl);
  if (cos < Math.cos(halfAngle * DEG) - 1e-9) return false;
  return segmentClear(sightClearLow, watcher.x, watcher.z, body.x, body.z, edgeOpenLow);
}

// The cone's visible boundary, for the renderer: rays fanned across the
// wedge, each cut where the crouch-height trace stops (the cone visibly
// ends at the desk it cannot see over). Returns [[x, z], ...] boundary
// points from one wedge edge to the other; the watcher's position closes
// the fan. Sampled by bisection along each ray - the same trace seesBody
// runs, so the drawn shape and the rule cannot disagree.
export function coneBoundary(watcher, {
  halfAngle = STEALTH.CONE_HALF_ANGLE,
  range = STEALTH.CONE_RANGE,
  sightClearLow,
  edgeOpenLow = null,
  rays = 13,
} = {}) {
  const f = watcher.facing || { x: 0, z: 1 };
  const base = Math.atan2(f.x, f.z);
  const out = [];
  for (let i = 0; i < rays; i++) {
    const a = base + (-halfAngle + (2 * halfAngle * i) / (rays - 1)) * DEG;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const clearAt = (t) => segmentClear(
      sightClearLow, watcher.x, watcher.z,
      watcher.x + dx * t, watcher.z + dz * t, edgeOpenLow);
    let t = range;
    if (!clearAt(t)) {
      let lo = 0;
      let hi = range;
      for (let k = 0; k < 10; k++) {
        const m = (lo + hi) / 2;
        if (clearAt(m)) lo = m; else hi = m;
      }
      t = lo;
    }
    out.push([watcher.x + dx * t, watcher.z + dz * t]);
  }
  return out;
}
