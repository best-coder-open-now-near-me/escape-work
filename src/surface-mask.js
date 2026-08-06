// Pure fine-cell geometry for ground effects and their previews. Movement
// tiles own terrain and routes; this module asks the SurfaceField for the
// smaller pieces of floor a shape actually covers. Returning world-space cell
// centres keeps the result usable by both the PlayCanvas aim mesh and the
// runtime surface writer without either one re-rasterising the shape.
import { BODY_RADIUS } from './pathfinding.js';

const EPSILON = 1e-9;

function bodyOverlapsCell(body, x, z, size, fallbackRadius) {
  const radius = body.radius ?? fallbackRadius;
  const half = size / 2;
  const dx = Math.max(Math.abs(body.x - x) - half, 0);
  const dz = Math.max(Math.abs(body.z - z) - half, 0);
  return dx * dx + dz * dz < radius * radius - EPSILON;
}

// Walk only the fine-cell rectangle a bounded shape could touch. `contains`
// judges cell CENTRES; body carving is stronger and uses circle-vs-cell-square
// overlap so paper cannot visibly/damagingly sit beneath somebody's feet.
export function fineCellsInBounds(field, bounds, contains, {
  canInclude = () => true,
  hasLos = null,
  origin = null,
  excludeBodies = [],
  bodyRadius = BODY_RADIUS,
} = {}) {
  const q = field.quantum;
  const min = field.pointToCell(
    Math.max(-0.5, bounds.minX),
    Math.max(-0.5, bounds.minZ),
  );
  // The field's far edge is exclusive. Pull the probe inward so a shape that
  // reaches the map boundary still visits the final fine cell.
  const max = field.pointToCell(
    Math.min(field.width - 0.5 - EPSILON, bounds.maxX),
    Math.min(field.height - 0.5 - EPSILON, bounds.maxZ),
  );
  if (!min || !max) return [];

  const out = [];
  for (let iz = min.iz; iz <= max.iz; iz++) {
    for (let ix = min.ix; ix <= max.ix; ix++) {
      const centre = field.cellCenter(ix, iz);
      if (!centre || !contains(centre.x, centre.z)) continue;
      if (!canInclude(centre.x, centre.z, ix, iz)) continue;
      if (hasLos && origin && !hasLos(origin.x, origin.z, centre.x, centre.z)) continue;
      if (excludeBodies.some((body) => bodyOverlapsCell(body, centre.x, centre.z, q, bodyRadius))) continue;
      out.push([centre.x, centre.z]);
    }
  }
  return out;
}

export function fineCircleCells(field, cx, cz, radius, options = {}) {
  return fineCellsInBounds(field, {
    minX: cx - radius,
    minZ: cz - radius,
    maxX: cx + radius,
    maxZ: cz + radius,
  }, (x, z) => Math.hypot(x - cx, z - cz) <= radius + EPSILON, options);
}

export function fineConeCells(field, test, range, options = {}) {
  if (!test) return [];
  const { x, z } = test.origin;
  return fineCellsInBounds(field, {
    minX: x - range,
    minZ: z - range,
    maxX: x + range,
    maxZ: z + range,
  }, (px, pz) => test(px, pz), options);
}
