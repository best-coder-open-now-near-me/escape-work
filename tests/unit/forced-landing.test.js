import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSurfaceLanding } from '../../src/forced-landing.js';
import { travelExposureStateFor } from '../../src/travel-exposure.js';

test('forced landing samples the exact rest point, applies riders, and seeds contact', () => {
  const events = [];
  const ref = {};
  const target = {};
  const v = {
    member: false,
    ref,
    body: ref,
    statusTarget: target,
    hazardAt: (x, z) => { events.push(`hazard:${x},${z}`); return 1; },
    hurt: (amount) => { events.push(`hurt:${amount}`); return false; },
    onDeath: () => events.push('death'),
    dmgColor: '#fff',
  };
  const result = resolveSurfaceLanding(v, 1.22, 2.31, {
    floorAt: (x, z) => { events.push(`floor:${x},${z}`); return { surfaceId: 'paper' }; },
    stickGum: () => false,
    applyStatus: (_t, id) => { events.push(`status:${id}`); return true; },
    statusFxAt: () => {},
    syncUnitSpeed: () => {},
    onDamage: (amount) => events.push(`bill:${amount}`),
    impact: (x, z) => events.push(`impact:${x},${z}`),
    damageText: () => events.push('text'),
  });
  assert.deepEqual(result, { died: false, damage: 1, label: 'paper' });
  assert.deepEqual(events, [
    'floor:1.22,2.31', 'hazard:1.22,2.31', 'status:bleed',
    'hurt:1', 'bill:1', 'impact:1.22,2.31', 'text',
  ]);
  assert.equal(travelExposureStateFor(ref).floorKey, 'paper');
});

test('gum landing spends the wad and synchronizes an AI unit speed once', () => {
  const events = [];
  const ref = {};
  resolveSurfaceLanding({
    member: false,
    ref,
    body: ref,
    statusTarget: ref,
    hazardAt: () => 0,
    hurt: () => false,
    onDeath: () => {},
  }, 0.2, 0.4, {
    floorAt: () => ({ surfaceId: 'gum' }),
    stickGum: () => { events.push('spend'); return true; },
    applyStatus: (_t, id) => { events.push(`status:${id}`); return true; },
    statusFxAt: () => events.push('fx'),
    syncUnitSpeed: () => events.push('speed'),
    impact: () => {},
    damageText: () => {},
  });
  assert.deepEqual(events, ['spend', 'status:gum', 'fx', 'speed']);
});
