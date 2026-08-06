import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnemyTraveler } from '../../src/enemy-travel.js';

function harness({ slip = false, stepDamage = 0, surfaceDamage = 0 } = {}) {
  const events = [];
  const travel = createEnemyTraveler({
    createTravelExposureState: () => ({}),
    advanceTravelExposure: () => [
      { kind: 'step', distance: 1, point: { x: 1, z: 0 } },
      { kind: 'surface', phase: 'repeat', distance: 1, point: { x: 1, z: 0 },
        floor: { surfaceId: 'paper' } },
    ],
    traceSegment: () => [],
    floorAt: () => ({ surfaceId: 'paper' }),
    exposureInterval: () => 1,
    statusFx: () => ({ slipProof: false }),
    tickStep: () => ({ damage: stepDamage, expired: [] }),
    syncSpeed: () => events.push('speed'),
    surfaceEffect: () => ({ applies: 'bleed' }),
    applyStatus: (_unit, id) => { events.push(`status:${id}`); return true; },
    surfDamage: () => surfaceDamage,
    hasStatus: () => false,
    stickGum: () => false,
    slips: () => slip,
    slipChanceAt: () => 1,
    roll: () => 0,
    onDamage: (_unit, amount, _point, info) => events.push(`${info.kind}:${amount}`),
    onStatus: (_unit, id) => events.push(`show:${id}`),
    onSlip: () => events.push('slip'),
    onFootprint: () => events.push('footprint'),
  });
  const unit = {
    alive: true,
    takeDamage: () => false,
    clearPath: () => events.push('stop'),
    flinch: () => events.push('flinch'),
  };
  return { travel, unit, events };
}

test('AI travel shares the step-before-surface order and one footprint beat', () => {
  const h = harness({ stepDamage: 1, surfaceDamage: 2 });
  assert.equal(h.travel(h.unit, { from: { x: 0, z: 0 }, to: { x: 1, z: 0 } }), true);
  assert.deepEqual(h.events, [
    'step:1', 'status:bleed', 'show:bleed', 'surface:2', 'footprint',
  ]);
});

test('an AI slip stops the physical walk immediately', () => {
  const h = harness({ slip: true });
  assert.equal(h.travel(h.unit, { from: { x: 0, z: 0 }, to: { x: 1, z: 0 } }), false);
  assert.deepEqual(h.events.slice(-3), ['stop', 'flinch', 'slip']);
});
