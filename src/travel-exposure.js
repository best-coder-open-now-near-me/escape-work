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

// One carrier keeps one distance history even when its controller changes
// (wander -> combat AI -> charm). Keeping this store in the clock module also
// lets a forced landing seed contact without resetting distance already walked.
const carrierStates = new WeakMap();
export function travelExposureStateFor(carrier) {
  let state = carrierStates.get(carrier);
  if (!state) {
    state = createTravelExposureState();
    carrierStates.set(carrier, state);
  }
  return state;
}

export const surfaceExposureKey = (floor = {}) => (floor.burning
  ? 'fire'
  : floor.electrified
    ? 'electrified'
    : floor.surfaceId || null);

// A teleport/glide applies its entry effect separately. Seed that landed
// contact so the first ordinary walking frame does not apply entry a second
// time; preserve the step clock because forced movement travelled no steps.
export function seedTravelExposureAtLanding(carrier, floor) {
  const state = travelExposureStateFor(carrier);
  state.floorKey = surfaceExposureKey(floor);
  state.surfaceDistance = 0;
  return state;
}

export const resetTravelExposure = (carrier) => carrierStates.delete(carrier);

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
    const floorKey = surfaceExposureKey(floor);

    // A physical transition is immediate. Adjacent fine cells carrying the
    // same effective floor remain one continuous exposure; a real bare gap
    // resets it and makes re-entry immediate again.
    if (floorKey !== state.floorKey) {
      state.floorKey = floorKey;
      state.surfaceDistance = 0;
      if (floorKey) {
        // `span.from` is the exact fine-cell boundary. With half-open cells it
        // belongs to one side only, so entering from the opposite direction
        // and re-reading consequences at that coordinate saw the BARE cell
        // being left. Nudge the consequence point an imperceptible distance
        // into the span whose midpoint supplied `floor`; entry remains
        // immediate, but both travel directions now resolve the entered cell.
        const entryPoint = pointAlong(span, Math.min(span.distance, 1e-6));
        events.push({ kind: 'surface', phase: 'entry', distance: travelled,
          point: entryPoint, floor });
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
