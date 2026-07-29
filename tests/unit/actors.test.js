// The actor movement state machine (TODO Phase 6).
//
// This is pure arithmetic over a path - it just lived next to code that draws.
// `const pc = window.pc` at module scope meant the file could not be imported
// at all outside a browser, so none of it could be tested; the handle is
// resolved lazily now, and everything below runs with no engine present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridActor, EnemyActor } from '../../src/actors.js';
import { ENEMY_TYPES } from '../../src/data/enemies.js';

// takeDamage lives on EnemyActor - it is the side that dies. A real def, so the
// normalization the constructor does is the real one.
const foe = (hp = 5) => {
  const a = new EnemyActor(0, 0, 'manager', ENEMY_TYPES.manager);
  a.hp = hp;
  a.alive = true;
  return a;
};

test('a fresh actor is still, and knows its tile', () => {
  const a = new GridActor(3, 4);
  assert.equal(a.moving, false);
  assert.deepEqual([a.x, a.z], [3, 4]);
});

test('setPath starts a walk synchronously - which combat depends on', () => {
  // Load-bearing: combat clears stale `moveStart` records for anyone who is no
  // longer moving, on the strength of `setPath` making `moving` true before the
  // next frame. If it were deferred, a walk would be cleaned up mid-stride and
  // dashes would provoke opportunity attacks again.
  const a = new GridActor(0, 0);
  a.setPath([[0, 0], [1, 0], [2, 0]]);
  assert.equal(a.moving, true, 'moving the instant the path is set');
  assert.equal(a.pathIndex, 1, 'index 0 is where we already stand');
  a.clearPath();
  assert.equal(a.moving, false);
});

test('a slide counts as moving, so a shove cannot be interrupted as if idle', () => {
  const a = new GridActor(0, 0);
  a.pushTo(2, 0);
  assert.equal(a.moving, true, 'a glide is movement too');
  assert.deepEqual([a.x, a.z], [2, 0], 'the LOGICAL tile teleports; the body catches up');
});

// --- takeDamage: the Phase 0 soft-lock guard, finally covered ---------------
test('takeDamage reports death exactly at zero, and not before', () => {
  const a = foe(5);
  assert.equal(a.takeDamage(2), false);
  assert.equal(a.hp, 3);
  assert.equal(a.takeDamage(3), true, 'reaching zero is death');
  assert.equal(a.hp, 0, 'and hp floors rather than going negative');
});

test('takeDamage REFUSES a non-finite amount instead of poisoning hp', () => {
  // The soft-lock this guards: an action with no damage dice reaching a damage
  // roll produces NaN, and `Math.max(0, hp - NaN)` is NaN - which is never
  // `<= 0`, so the target could never die and a fight requiring it dead could
  // never end. A visible no-op is the correct degradation.
  for (const bad of [NaN, undefined, Infinity, -Infinity, 'lots']) {
    const a = foe(5);
    assert.equal(a.takeDamage(bad), false, `${String(bad)} must not report a kill`);
    assert.equal(a.hp, 5, `${String(bad)} must leave hp untouched`);
    assert.equal(Number.isFinite(a.hp), true, 'and hp stays a real number');
  }
});

test('zero damage is a real hit, not a non-finite one', () => {
  // The guard must reject junk without also swallowing a legitimate 0 - a fully
  // soaked hit still happens.
  const a = foe(5);
  assert.equal(a.takeDamage(0), false);
  assert.equal(a.hp, 5);
});
