import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSurfaceField } from '../../src/surface-field.js';
import {
  advanceTravelExposure,
  createTravelExposureState,
  exposureDistanceFromComposure,
  seedTravelExposureAtLanding,
  travelExposureStateFor,
} from '../../src/travel-exposure.js';

const floorAt = (field) => (x, z) => ({ surfaceId: field.surfaceAt(x, z) });

test('surface entry is immediate, repeats use distance, and a bare gap resets contact', () => {
  const field = createSurfaceField({ width: 3, height: 1 });
  field.setCell(1, 1, 'paper');
  field.setCell(3, 1, 'paper'); // one bare fine cell between the two
  const state = createTravelExposureState();
  const events = advanceTravelExposure(state, {
    from: { x: -0.4, z: 0.25 }, to: { x: 1.4, z: 0.25 },
  }, { traceSegment: field.traceSegment, floorAt: floorAt(field), interval: 1 });
  const surface = events.filter((event) => event.kind === 'surface');
  assert.deepEqual(surface.map((event) => event.phase), ['entry', 'entry']);
  assert.ok(surface[0].point.x < 0.01);
  assert.ok(surface[1].point.x > 0.49);
});

test('surface entry points land inside the entered cell in either direction', () => {
  const field = createSurfaceField({ width: 3, height: 1 });
  field.setCell(1, 1, 'paper'); // x 0..0.5 at this row
  const events = advanceTravelExposure(createTravelExposureState(), {
    // Enter from the right. The exact x=0.5 boundary belongs to the bare cell
    // on that side, which used to make a coordinate re-read miss this entry.
    from: { x: 0.8, z: 0.25 }, to: { x: -0.2, z: 0.25 },
  }, { traceSegment: field.traceSegment, floorAt: floorAt(field), interval: 99 });
  const entry = events.find((event) => event.kind === 'surface');
  assert.ok(entry, 'crossing into paper emits an entry');
  assert.equal(field.surfaceAt(entry.point.x, entry.point.z), 'paper',
    'the consequence point is just inside the entered surface, not on its bare boundary');
});

test('continuous surface cells do not retrigger entry at their seam', () => {
  const field = createSurfaceField({ width: 2, height: 1 });
  field.fillTile(0, 0, 'paper');
  const events = advanceTravelExposure(createTravelExposureState(), {
    from: { x: -0.4, z: 0.25 }, to: { x: 0.4, z: 0.25 },
  }, { traceSegment: field.traceSegment, floorAt: floorAt(field), interval: 0.5 });
  assert.deepEqual(events.filter((event) => event.kind === 'surface').map((event) => event.phase),
    ['entry', 'repeat']);
});

test('Composure increases both movement clock intervals in world distance', () => {
  assert.equal(exposureDistanceFromComposure(0), 1);
  assert.equal(exposureDistanceFromComposure(5), 1.5);
  assert.equal(exposureDistanceFromComposure(10), 2);
});

test('distance state carries across frame-sized segments', () => {
  const field = createSurfaceField({ width: 3, height: 1 });
  const state = createTravelExposureState();
  const opts = { traceSegment: field.traceSegment, floorAt: floorAt(field), interval: 1 };
  const first = advanceTravelExposure(state, {
    from: { x: -0.4, z: 0 }, to: { x: 0.2, z: 0 },
  }, opts);
  const second = advanceTravelExposure(state, {
    from: { x: 0.2, z: 0 }, to: { x: 0.7, z: 0 },
  }, opts);
  assert.equal(first.filter((event) => event.kind === 'step').length, 0);
  assert.equal(second.filter((event) => event.kind === 'step').length, 1);
});

test('forced landing seeds contact without erasing distance already walked', () => {
  const carrier = {};
  const state = travelExposureStateFor(carrier);
  state.stepDistance = 0.7;
  seedTravelExposureAtLanding(carrier, { surfaceId: 'paper' });
  assert.equal(state.stepDistance, 0.7);
  assert.equal(state.floorKey, 'paper');
  assert.equal(state.surfaceDistance, 0);
});
