// Shared continuous geometry for descriptor-declared areas. Content owns the
// shape and its tuning; systems supply the bodies and decide what the hit does.
// This is intentionally small: adding another shape means teaching this one
// seam, not reproducing a distance test in every action/prop resolver.
import { BODY_RADIUS } from './pathfinding.js';

export function bodyPoint(record) {
  const body = record?.actor || record?.unit || record;
  if (!body) return null;
  const point = body.entity?.getPosition?.() || body.spawnPoint || body;
  return Number.isFinite(point?.x) && Number.isFinite(point?.z)
    ? { x: point.x, z: point.z }
    : null;
}

export function areaIntersectsBody(area, centre, record, fallbackRadius = BODY_RADIUS) {
  if (area?.shape !== 'circle' || !Number.isFinite(area.radius)) return false;
  const point = bodyPoint(record);
  if (!point || !Number.isFinite(centre?.x) || !Number.isFinite(centre?.z)) return false;
  const body = record?.actor || record?.unit || record;
  const radius = Number.isFinite(body?.bodyRadius) ? body.bodyRadius : fallbackRadius;
  return Math.hypot(point.x - centre.x, point.z - centre.z) <= area.radius + radius;
}
