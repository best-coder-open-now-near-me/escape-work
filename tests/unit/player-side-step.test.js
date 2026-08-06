import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bodyAwareLine,
  createPlayerSideStepper,
  createPlayerSideTraveler,
} from '../../src/player-side-step.js';
import { createFloorEffects } from '../../src/floor-effects.js';

function harness({ tileEffect = null, tickDown = false, surfaceDown = false } = {}) {
  const events = [];
  const step = createPlayerSideStepper({
    tileEffectAt: () => tileEffect,
    notifyStep: () => events.push('notify'),
    applyDamage: () => { events.push('tile-damage'); return false; },
    syncHudFor: () => events.push('hud'),
    gameOver: false,
    vfx: {
      impact: () => events.push('impact'),
      damageText: () => events.push('damage-text'),
    },
  });
  const travel = createPlayerSideTraveler({
    travelExposureStateFor: () => ({}),
    resetTravelExposure: () => {},
    advanceTravelExposure: () => [
      { kind: 'step', distance: 1, point: { x: 4.25, z: 7 } },
      { kind: 'surface', phase: 'repeat', distance: 1, point: { x: 4.25, z: 7 } },
    ],
    traceSegment: () => [],
    floorAt: () => ({}),
    exposureInterval: () => 1,
    statusFx: () => { events.push('status'); return {}; },
    tickStepOn: () => { events.push('tick'); return tickDown; },
    applySurfaceOn: () => { events.push('surface'); return surfaceDown; },
    maybeSlip: () => { events.push('slip'); return false; },
    leaveFootprint: () => events.push('footprint'),
    gameOver: false,
  });
  const body = { sheet: {}, actor: { flinch: () => events.push('flinch') } };
  return { step, travel, body, events };
}

test('all player-side bodies receive the same ordered tile and feet effects', () => {
  const member = harness({ tileEffect: { effect: 'damage', amount: 2, message: 'Ouch.' } });
  const temp = harness({ tileEffect: { effect: 'damage', amount: 2, message: 'Ouch.' } });

  member.step(member.body, 4, 7, { say: () => member.events.push('say') });
  member.travel(member.body, { from: { x: 3, z: 7 }, to: { x: 4.25, z: 7 } });
  temp.step(temp.body, 4, 7, { say: () => temp.events.push('say') });
  temp.travel(temp.body, { from: { x: 3, z: 7 }, to: { x: 4.25, z: 7 } });

  assert.deepEqual(member.events, [
    'notify', 'tile-damage', 'flinch', 'impact', 'damage-text', 'say', 'hud',
    'status', 'tick', 'surface', 'slip', 'footprint',
  ]);
  assert.deepEqual(temp.events, member.events);
});

test('exit permission is lifecycle policy, not a separate step path', () => {
  const allowed = harness({ tileEffect: { effect: 'exit' } });
  let exits = 0;
  assert.equal(allowed.step(allowed.body, 1, 1, {
    pathDone: true,
    canExit: true,
    onExit: () => { exits += 1; },
  }), false);
  assert.equal(exits, 1);
  assert.deepEqual(allowed.events, []);

  const denied = harness({ tileEffect: { effect: 'exit' } });
  assert.equal(denied.step(denied.body, 1, 1, {
    pathDone: true,
    changed: false,
    canExit: false,
  }), true);
  assert.deepEqual(denied.events, []);
});

test('the caller owns the downed-body consequence and later effects stop', () => {
  const h = harness({ tickDown: true });
  const reasons = [];

  assert.equal(h.travel(h.body, { from: { x: 1, z: 3 }, to: { x: 2, z: 3 } },
    { onDown: (reason) => reasons.push(reason) }), false);
  assert.deepEqual(reasons, ['Death by a thousand paper cuts. Well - several.']);
  assert.deepEqual(h.events, ['status', 'tick']);
});

test('a temporary ally receives its named floor narration', () => {
  const h = harness({
    tileEffect: {
      effect: 'damage', amount: 2,
      message: 'You step on the cable. -2 HP.',
      namedMessage: '{name} steps on the cable. -2 HP.',
    },
  });
  const lines = [];
  h.step(h.body, 2, 3, { speaker: 'Employee', say: (line) => lines.push(line) });
  assert.deepEqual(lines, ['Employee steps on the cable. -2 HP.']);
});

test('speaker names are inserted literally, including replacement metacharacters', () => {
  assert.equal(bodyAwareLine('R&D $&', 'You slip.', '{name} slips.'), 'R&D $& slips.');
});

test('the real surface coordinator preserves the temporary ally voice', () => {
  const surface = {
    amount: 2,
    message: 'You step on a frayed power cable. -2 HP.',
    namedMessage: '{name} steps on a frayed power cable. -2 HP.',
  };
  const floor = createFloorEffects({
    surfEffect: () => surface,
    effectiveSurfDamage: () => 2,
    applyDamage: () => false,
    impactKindFor: () => 'zap',
    runtime: { isBurning: () => false, surfaceAt: () => 'cable' },
    grid: { isElectrified: () => false },
    vfx: { impact: () => {}, damageText: () => {} },
    syncHudFor: () => {},
  });
  const travel = createPlayerSideTraveler({
    travelExposureStateFor: () => ({}),
    resetTravelExposure: () => {},
    advanceTravelExposure: () => [
      { kind: 'surface', phase: 'entry', distance: 0, point: { x: 1, z: 1 } },
    ],
    traceSegment: () => [],
    floorAt: () => ({}),
    exposureInterval: () => 1,
    statusFx: () => ({}),
    tickStepOn: () => false,
    applySurfaceOn: floor.applySurfaceOn,
    maybeSlip: () => false,
    leaveFootprint: () => {},
    gameOver: false,
  });
  const lines = [];
  travel({ sheet: {}, actor: { flinch: () => {} } },
    { from: { x: 0, z: 1 }, to: { x: 1, z: 1 } }, {
    speaker: 'Employee', say: (line) => lines.push(line),
  });
  assert.deepEqual(lines, ['Employee steps on a frayed power cable. -2 HP.']);
});

test('a combat slip forwards the temporary ally name to the fight log', () => {
  const names = [];
  const floor = createFloorEffects({
    gameOver: false,
    slips: () => true,
    slipChanceAt: () => 1,
    statusFx: () => ({}),
    equippedStats: () => ({}),
    inCombat: true,
    combat: { notifySlip: (name) => names.push(name) },
    vfx: { impact: () => {}, damageText: () => {} },
  });
  floor.maybeSlip({}, { clearPath: () => {}, flinch: () => {} }, 1, 1, false,
    () => {}, 'Employee');
  assert.deepEqual(names, ['Employee']);
});
