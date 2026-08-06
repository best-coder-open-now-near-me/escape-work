// Distance-based movement consequences. Logical tiles still own occupancy,
// exits and office objects; this module owns what a moving pair of feet crosses
// between two continuous points.

export const EXPOSURE_DISTANCE = Object.freeze({
  BASE: 1,
  PER_COMPOSURE: 0.1,
});

// Initial tuning is deliberately linear and named. The design decision is
// ratified (Composure buys distance); the exact 0.1 world-unit slope is a
// reversible balance value, not hidden inside a movement callback.
export const exposureDistanceFromComposure = (composure = 0) =>
  EXPOSURE_DISTANCE.BASE
  + Math.max(0, Number.isFinite(composure) ? composure : 0) * EXPOSURE_DISTANCE.PER_COMPOSURE;

export const createTravelExposureState = () => ({
  stepDistance: 0,
  floorKey: undefined,
  surfaceDistance: 0,
});

const pointAlong = (span, distance) => {
  const k = span.distance > 0 ? distance / span.distance : 0;
  return {
    x: span.from.x + (span.to.x - span.from.x) * k,
    z: span.from.z + (span.to.z - span.from.z) * k,
  };
};

// `floorAt(x,z)` returns the dynamic fact sheet used by step-rules:
// { burning, electrified, surfaceId }. Events are ordered by distance along
// the segment; when clocks coincide, the step clock precedes the surface beat
// to preserve the historical consequence order.
export function advanceTravelExposure(state, segment, {
  traceSegment,
  floorAt,
  interval,
} = {}) {
  if (!state || !segment || typeof traceSegment !== 'function' || typeof floorAt !== 'function') return [];
  const threshold = Math.max(0.05, Number.isFinite(interval) ? interval : EXPOSURE_DISTANCE.BASE);
  const spans = traceSegment(segment.from.x, segment.from.z, segment.to.x, segment.to.z);
  const events = [];
  let travelled = 0;

  for (const span of spans) {
    const floor = floorAt(span.midpoint.x, span.midpoint.z) || {};
    const floorKey = floor.burning
      ? 'fire'
      : floor.electrified
        ? 'electrified'
        : floor.surfaceId || null;

    // A physical transition is immediate. Adjacent fine cells carrying the
    // same effective floor remain one continuous exposure; a real bare gap
    // resets it and makes re-entry immediate again.
    if (floorKey !== state.floorKey) {
      state.floorKey = floorKey;
      state.surfaceDistance = 0;
      if (floorKey) {
        events.push({ kind: 'surface', phase: 'entry', distance: travelled,
          point: { ...span.from }, floor });
      }
    }

    let remaining = span.distance;
    let withinSpan = 0;
    while (remaining > 1e-9) {
      const stepNeed = threshold - state.stepDistance;
      const surfaceNeed = floorKey ? threshold - state.surfaceDistance : Infinity;
      const advance = Math.min(remaining, stepNeed, surfaceNeed);
      state.stepDistance += advance;
      if (floorKey) state.surfaceDistance += advance;
      remaining -= advance;
      withinSpan += advance;
      const at = travelled + withinSpan;
      const point = pointAlong(span, withinSpan);
      if (state.stepDistance >= threshold - 1e-9) {
        state.stepDistance = 0;
        events.push({ kind: 'step', distance: at, point });
      }
      if (floorKey && state.surfaceDistance >= threshold - 1e-9) {
        state.surfaceDistance = 0;
        events.push({ kind: 'surface', phase: 'repeat', distance: at, point, floor });
      }
      if (advance <= 1e-9) break;
    }
    travelled += span.distance;
  }
  return events.sort((a, b) => a.distance - b.distance
    || (a.kind === 'step' ? -1 : 1));
}
