import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerSideStepper } from '../../src/player-side-step.js';

function harness({ tileEffect = null, tickDown = false, surfaceDown = false } = {}) {
  const events = [];
  const step = createPlayerSideStepper({
    tileEffectAt: () => tileEffect,
    notifyStep: () => events.push('notify'),
    applyDamage: () => { events.push('tile-damage'); return false; },
    statusFx: () => { events.push('status'); return {}; },
    tickStepOn: () => { events.push('tick'); return tickDown; },
    applySurfaceOn: () => { events.push('surface'); return surfaceDown; },
    maybeSlip: () => events.push('slip'),
    leaveFootprint: () => events.push('footprint'),
    syncHudFor: () => events.push('hud'),
    gameOver: false,
    vfx: {
      impact: () => events.push('impact'),
      damageText: () => events.push('damage-text'),
    },
  });
  const body = { sheet: {}, actor: { flinch: () => events.push('flinch') } };
  return { step, body, events };
}

test('all player-side bodies receive the same ordered tile and floor effects', () => {
  const member = harness({ tileEffect: { effect: 'damage', amount: 2, message: 'Ouch.' } });
  const temp = harness({ tileEffect: { effect: 'damage', amount: 2, message: 'Ouch.' } });

  member.step(member.body, 4, 7, { say: () => member.events.push('say') });
  temp.step(temp.body, 4, 7, { say: () => temp.events.push('say') });

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

  assert.equal(h.step(h.body, 2, 3, { onDown: (reason) => reasons.push(reason) }), false);
  assert.deepEqual(reasons, ['Death by a thousand paper cuts. Well - several.']);
  assert.deepEqual(h.events, ['notify', 'status', 'tick']);
});
