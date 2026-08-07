// The actor movement state machine (TODO Phase 6).
//
// This is pure arithmetic over a path - it just lived next to code that draws.
// `const pc = window.pc` at module scope meant the file could not be imported
// at all outside a browser, so none of it could be tested; the handle is
// resolved lazily now, and everything below runs with no engine present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridActor, EnemyActor } from '../../src/actors.js';
import { applyStatus, statusList, tickStep } from '../../src/statuses.js';
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

test('procedural animation composes onto a model imported below 1x and rotated upright', () => {
  // The original character rigs imported at 1x, so replacing the visual
  // node's scale with (1,1,1) every frame looked harmless. Licensed GLBs carry
  // their unit conversion on that node; erasing it turns the actor into a
  // kaiju the instant gameplay starts, while the unattached picker preview
  // remains correctly sized.
  const a = new GridActor(0, 0);
  a.visualScale = { x: 0.01, y: 0.02, z: 0.03 };
  a.visualEuler = { x: 90, y: 10, z: -5 };
  let applied = null;
  let appliedEuler = null;
  a.visual = {
    setLocalPosition: () => {},
    setLocalEulerAngles: (x, y, z) => { appliedEuler = [x, y, z]; },
    setLocalScale: (x, y, z) => { applied = [x, y, z]; },
  };

  a.updateAnim(0, 0);
  assert.deepEqual(applied, [0.01, 0.02, 0.03], 'idle preserves the imported scale exactly');
  assert.deepEqual(appliedEuler, [90, 10, -5], 'idle preserves the imported upright orientation');

  a.fx = { kind: 'flinch', t: 0 };
  a.updateAnim(0.1, 0);
  assert.ok(applied[0] > 0.01, 'the flinch widens relative to the imported X scale');
  assert.ok(applied[1] < 0.02, 'the flinch squashes relative to the imported Y scale');
  assert.ok(applied[2] > 0.03, 'the flinch widens relative to the imported Z scale');

  a.fx = { kind: 'death', t: 0 };
  a.updateAnim(0.5, 0);
  assert.ok(appliedEuler[0] < 90, 'death pitches away from the imported standing orientation');
  assert.deepEqual(appliedEuler.slice(1), [10, -5], 'procedural pitch preserves the other imported axes');
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

// --- update(dt): the waypoint walk and the tile tracker -----------------------
//
// The part of actors.js that everything downstream leans on and nothing tested:
// exits, surface damage and the AI's own notifyStep all hang off `onTile`, and
// a straight run crosses tiles WITHOUT stopping on them, so the logical tile is
// re-derived from the entity's position every frame rather than from the path.
//
// It runs headless with a six-method stub. There is no anim component and no
// leg nodes, so setClip and the leg settle no-op and the lazy `pc` handle is
// never resolved - which is the whole reason this file can exist.
function stubBody(a, x, z) {
  const p = { x, y: 0, z };
  a.entity = {
    getPosition: () => p,
    setPosition: (nx, ny, nz) => { p.x = nx; p.y = ny; p.z = nz; },
    setEulerAngles: () => {},
  };
  a.visual = { setLocalPosition: () => {}, setLocalEulerAngles: () => {}, setLocalScale: () => {} };
  return p;
}

// Pump frames until the walk ends, with a bail so a regression that never
// finishes fails as a failed assertion rather than as a hung suite.
function walkOut(a, dt, onTile, maxFrames = 200) {
  for (let i = 0; i < maxFrames && a.moving; i++) a.update(dt, onTile);
  assert.equal(a.moving, false, 'the walk finished within the frame budget');
}

test('onTile fires once per tile entered, and once more on arrival', () => {
  const a = new GridActor(0, 0, { speed: 2 });
  stubBody(a, 0, 0);
  const calls = [];
  a.setPath([[0, 0], [1, 0], [2, 0], [3, 0]]);
  walkOut(a, 0.25, (x, z, done, changed) => calls.push([x, z, done, changed]));
  // The last entry is the contract: arrival re-fires with `changed` FALSE, so
  // per-tile effects are not re-applied to a tile the walk already entered
  // while arrival-only logic (the exit) still gets its call.
  assert.deepEqual(calls, [
    [1, 0, false, true],
    [2, 0, false, true],
    [3, 0, false, true],
    [3, 0, true, false],
  ]);
  assert.deepEqual([a.x, a.z], [3, 0]);
});

test('onTravel reports exact continuous segments and never reports shove glides', () => {
  const a = new GridActor(0, 0, { speed: 4 });
  stubBody(a, 0, 0);
  const segments = [];
  a.setPath([[0, 0], [0.5, 0], [0.5, 1]]);
  a.update(0.5, null, (segment) => segments.push(segment));
  assert.equal(segments.length, 2, 'the bend remains two physical segments');
  assert.ok(Math.abs(segments.reduce((sum, segment) => sum + segment.distance, 0) - 1.5) < 1e-9);
  assert.deepEqual(segments.at(-1).to, { x: 0.5, z: 1 });
  assert.equal(segments.at(-1).pathDone, true);

  const shoveSegments = [];
  a.pushTo(1, 1);
  a.update(1, null, (segment) => shoveSegments.push(segment));
  assert.deepEqual(shoveSegments, [], 'forced movement resolves only its landing');
});

test('a bend consumes the whole frame budget - speed is constant through corners', () => {
  // Two units of budget over a two-unit dog-leg. A driver that stopped at the
  // waypoint and resumed next frame would land at (1,0) and still be moving,
  // which is the hop-pause-hop the smoothing exists to prevent.
  const a = new GridActor(0, 0, { speed: 4 });
  const pos = stubBody(a, 0, 0);
  a.setPath([[0, 0], [1, 0], [1, 1]]);
  a.update(0.5);
  assert.deepEqual([pos.x, pos.z], [1, 1]);
  assert.deepEqual([a.x, a.z], [1, 1]);
  assert.equal(a.moving, false);
});

test('a sub-tile walk still reports arrival', () => {
  // The de-grid case: the walk stops short of the next tile centre, so
  // Math.round never crosses a boundary and `changed` is false the whole way.
  // Only the `finished` leg fires - without it a trimmed walk-up would arrive
  // and nothing downstream would hear about it.
  const a = new GridActor(0, 0, { speed: 1 });
  stubBody(a, 0, 0);
  const calls = [];
  a.setPath([[0, 0], [0.3, 0]]);
  walkOut(a, 0.1, (x, z, done, changed) => calls.push([x, z, done, changed]));
  assert.deepEqual(calls, [[0, 0, true, false]]);
});

// --- the amble obeys the floor (Q906) -----------------------------------------
//
// A wandering coworker used to run two of the thirteen per-tile rules - gum and
// slipping - so the floor was something only the player's side could feel. These
// pin the four that arrived with "yes all fixes" (designer, 2026-08-03): the
// step clock, the surface damage, the status a surface applies, and the bleed a
// paper drift leaves.
//
// Driving a wander needs Math.random pinned, because the amble is deliberately
// irregular: a 45% chance of just standing around, then a random tile inside the
// leash. 0.9 clears the stand-around roll and picks a tile off the spawn.
function forceWander(a, world, dt = 0.1) {
  const real = Math.random;
  Math.random = () => 0.9;
  try {
    a.wanderTimer = 0;
    a.update(dt, world);
  } finally {
    Math.random = real;
  }
}

// A floor that is one thing everywhere, which is all these need: `sfx` is the
// surface's own onEnter record, `damage` what it bills a coworker.
function floorWorld({ sfx = null, damage = 0, slip = 0, gum = false } = {}) {
  const touched = new WeakSet();
  return {
    paused: false,
    isWalkable: () => true,
    isHazard: () => false, // wander ROUTING avoids hazards; this is about walking one
    blockedByParty: () => false,
    occupied: () => false,
    slipChanceAt: () => slip,
    stickGum: () => gum,
    floorAt: () => ({ surfaceId: 'test' }),
    surfDamage: () => damage,
    // EnemyActor delegates exact feet segments to the world's shared resolver;
    // enemy-travel.test.js pins that resolver's ordering in isolation. Here we
    // pin the actor/world seam without recreating the whole floor subsystem.
    onTravel: (unit, segment) => {
      if (!touched.has(unit)) {
        touched.add(unit);
        if (damage > 0) unit.takeDamage(damage);
      }
      if (segment.pathDone) tickStep(unit);
      return unit.alive;
    },
    findWanderPath: (en) => [[en.x, en.z], [en.x + 1, en.z]],
  };
}

// surfaceEffect reads the real SURFACES table, so these tests drive the rules
// through a world whose floorAt names a surface the table does not carry - the
// `applies`/`bleed` riders are asserted in enemy-travel.test.js.
function ambleOut(a, world, dt = 0.25, maxFrames = 400) {
  for (let i = 0; i < maxFrames && a.moving; i++) a.update(dt, world);
  assert.equal(a.moving, false, 'the amble finished within the frame budget');
}

test('an ambling coworker takes surface damage from the tile it enters', () => {
  const a = foe(20);
  stubBody(a, 0, 0);
  const world = floorWorld({ damage: 4 });
  forceWander(a, world);
  assert.ok(a.moving, 'the amble started');
  ambleOut(a, world);
  assert.equal(a.hp, 16, 'the floor billed the coworker, on the enemy damage model');
});

test('an ambling coworker runs the step clock, so a wad is not for keeps', () => {
  const a = foe(20);
  stubBody(a, 0, 0);
  applyStatus(a, 'gum');
  const before = statusList(a).find((s) => s.id === 'gum')?.left;
  assert.ok(before > 0, 'gum arrives with a step budget');
  const world = floorWorld();
  forceWander(a, world);
  ambleOut(a, world);
  const after = statusList(a).find((s) => s.id === 'gum')?.left;
  assert.ok(after === undefined || after < before,
    `the wad ticked down on the amble (${before} -> ${after})`);
});
