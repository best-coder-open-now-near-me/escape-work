// What the target rings promise (src/combat-targeting.js). Pure module, plain
// facts - no bodies, no rings drawn.
//
// A green ring means "the click lands this verb on them right now", and
// REVIEW.md records what happens when that stops being the same rule the click
// runs: a ranged weapon rang an out-of-range enemy red while the click walked
// the member in and fired. These assertions pin which facts each shape of verb
// consults, which is where that lie starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enemyRingOk, ringsAtBodies, verbKind, toppleRings, partitionRings, breakRings,
} from '../../src/combat-targeting.js';

// `min`/`max` are what make an attack a thing that can break furniture down
// (powers.aimsAtProps) - a damage roll, not a payload.
const SWING = { type: 'attack', ap: 2, min: 1, max: 3 };
const THROW = { type: 'attack', ap: 2, ammoCost: 1, min: 1, max: 3 };
const SHOVE = { type: 'shove', ap: 2 };
const PULL = { type: 'pull', ap: 2 };
const TOUCH_CONTROL = { type: 'control', ap: 2 };
const THROWN_CONTROL = { type: 'control', ap: 2, range: 5 };

// Every leaf fact answered yes. Individual tests turn one off at a time, which
// is the point: the ladder must consult exactly the ones its branch needs.
const yes = (over = {}) => ({
  ap: 10, ammoOk: true, range: 0, dist: 1, los: true,
  shoveReach: true, pullOk: true, controlRefused: null,
  shotBlocked: false, shotRedirectedToAlly: false, meleeReachable: true,
  ...over,
});

test('a shove asks about arm\'s length and nothing else', () => {
  assert.equal(enemyRingOk(SHOVE, yes()), true);
  assert.equal(enemyRingOk(SHOVE, yes({ shoveReach: false })), false);
  assert.equal(enemyRingOk(SHOVE, yes({ ap: 1 })), false);
  // Not its questions: a shove is arms-length whatever you are holding.
  assert.equal(enemyRingOk(SHOVE, yes({ dist: 99, los: false, meleeReachable: false })), true);
});

test('a pull asks about the barrier', () => {
  assert.equal(enemyRingOk(PULL, yes()), true);
  assert.equal(enemyRingOk(PULL, yes({ pullOk: false })), false);
  assert.equal(enemyRingOk(PULL, yes({ ap: 1 })), false);
});

test('a thrown control asks its own gate, which already prices the AP', () => {
  assert.equal(enemyRingOk(THROWN_CONTROL, yes()), true);
  assert.equal(enemyRingOk(THROWN_CONTROL, yes({ controlRefused: 'Too far.' })), false);
});

test('a TOUCH control falls to the melee case - the click walks you in', () => {
  // So every reachable body rings green, rather than only the adjacent ones.
  assert.equal(enemyRingOk(TOUCH_CONTROL, yes({ dist: 99, meleeReachable: true })), true);
  assert.equal(enemyRingOk(TOUCH_CONTROL, yes({ meleeReachable: false })), false);
});

test('a shot asks range, line, ammo and AP', () => {
  const shot = yes({ range: 5 });
  assert.equal(enemyRingOk(THROW, shot), true);
  assert.equal(enemyRingOk(THROW, { ...shot, dist: 6 }), false);
  assert.equal(enemyRingOk(THROW, { ...shot, los: false }), false);
  assert.equal(enemyRingOk(THROW, { ...shot, ammoOk: false }), false);
  assert.equal(enemyRingOk(THROW, { ...shot, ap: 1 }), false);
  // The far edge of range is still in range.
  assert.equal(enemyRingOk(THROW, { ...shot, dist: 5 }), true);
});

test('a crouched target with no angle rings red, and so does one behind YOUR body', () => {
  const shot = yes({ range: 5 });
  assert.equal(enemyRingOk(THROW, { ...shot, shotBlocked: true }), false);
  // A shot redirected onto a teammate refuses at the click, so it must not
  // promise green here.
  assert.equal(enemyRingOk(THROW, { ...shot, shotRedirectedToAlly: true }), false);
});

test('a swing rings green from a legal stand point, not just from here', () => {
  assert.equal(enemyRingOk(SWING, yes()), true);
  // Every enemy used to ring green on bare swing-AP, partition-sealed ones
  // included - the exact green that paired with a refusal.
  assert.equal(enemyRingOk(SWING, yes({ meleeReachable: false })), false);
  assert.equal(enemyRingOk(SWING, yes({ ap: 1 })), false);
});

test('a swing does NOT test distance - a partial approach is an honest outcome', () => {
  // The walk-up closes the gap and the hover preview prices it; ringing red on
  // distance would refuse a click that works.
  assert.equal(enemyRingOk(SWING, yes({ dist: 99 })), true);
});

test('an action may override the AP it is priced at', () => {
  assert.equal(enemyRingOk(SWING, yes({ ap: 3, actionAp: 4 })), false);
  assert.equal(enemyRingOk(SWING, yes({ ap: 3, actionAp: 3 })), true);
});

test('only the body-aimed verbs ring at bodies', () => {
  assert.equal(ringsAtBodies(SWING), true);
  assert.equal(ringsAtBodies(SHOVE), true);
  assert.equal(ringsAtBodies(TOUCH_CONTROL), true);
  assert.equal(ringsAtBodies({ type: 'purge', ap: 2 }), true);
  // These ring ground or friends, through their own branch.
  assert.equal(ringsAtBodies({ type: 'zone', ap: 2 }), false);
  assert.equal(ringsAtBodies({ type: 'summon', ap: 2 }), false);
  assert.equal(ringsAtBodies({ type: 'cover', ap: 2 }), false);
  assert.equal(ringsAtBodies({ type: 'buff', ap: 2 }), false);
});

// --- the ground rings --------------------------------------------------------

test('a shove scans its eight neighbours for props, never its own tile', () => {
  const rings = toppleRings(5, 5, {
    isToppleableAt: () => true,
    planAt: (x, z) => ({ lx: x + 1, lz: z }),
  });
  assert.equal(rings.length, 8);
  assert.ok(!rings.some((r) => r.x === 5 && r.z === 5));
  assert.ok(rings.every((r) => r.plan));
});

test('a prop that cannot go over still rings - red, with no landing tile', () => {
  // It is a target you can see is refused, not a target that vanishes.
  const rings = toppleRings(5, 5, { isToppleableAt: () => true, planAt: () => null });
  assert.equal(rings.length, 8);
  assert.ok(rings.every((r) => r.plan === null));
});

test('partitions ring on FACES only, and carry whether the landing is clear', () => {
  const rings = partitionRings(5, 5, {
    wallEdgeBetween: (ax, az, bx) => bx === 6,
    terrainOpen: () => false,
  });
  assert.deepEqual(rings, [{ x: 6, z: 5, clear: false }]);
});

test('a verb that does not aim at props rings none of them', () => {
  const world = { tileDefAt: () => ({ hp: 5 }), planAt: () => ({ kind: 'prop' }), edgeHpBetween: () => 4 };
  const { props, edges } = breakRings(SHOVE, 5, 5, 0, world);
  assert.deepEqual(props, []);
  assert.deepEqual(edges, []);
});

test('a melee break rings its neighbourhood; a ranged one rings its whole reach', () => {
  const world = { tileDefAt: () => ({ hp: 5 }), planAt: () => ({ kind: 'prop' }), edgeHpBetween: () => null };
  assert.equal(breakRings(SWING, 5, 5, 0, world).props.length, 8); // 3x3 less the centre
  assert.equal(breakRings(THROW, 5, 5, 2, world).props.length, 24); // 5x5 less the centre
});

test('a refused break plan rings, but not as a promise', () => {
  const world = {
    tileDefAt: () => ({ hp: 5 }),
    planAt: () => ({ refusal: 'Too far.' }),
    edgeHpBetween: () => null,
  };
  const { props } = breakRings(SWING, 5, 5, 0, world);
  assert.ok(props.length > 0);
  assert.ok(props.every((p) => !p.landable));
});

test('a distant partition stays un-rung; the adjacent ones ring', () => {
  const world = {
    tileDefAt: () => ({}),
    planAt: () => null,
    edgeHpBetween: (ax, az, bx, bz) => (Math.abs(bx - ax) + Math.abs(bz - az) === 1 ? 4 : null),
  };
  const { edges } = breakRings(THROW, 5, 5, 4, world);
  assert.equal(edges.length, 4); // the four faces, whatever the range
});

// --- the shared classifier ---------------------------------------------------

test('verbKind names the branch, and the rings and the click read the same one', () => {
  // Two hand-written ladders of `a.type` tests in slightly different orders is
  // how the rings came to contradict the click (REVIEW.md). One ladder now.
  assert.equal(verbKind(SWING), 'melee');
  assert.equal(verbKind(SWING, 5), 'ranged'); // the range comes from stats.rangeOf
  assert.equal(verbKind(THROW, 5), 'ranged');
  assert.equal(verbKind(SHOVE), 'shove');
  assert.equal(verbKind(PULL), 'pull');
  assert.equal(verbKind(THROWN_CONTROL, 0), 'control');
  assert.equal(verbKind({ type: 'cover', ap: 1 }), 'cover');
  assert.equal(verbKind({ type: 'attack', ap: 2, cone: { arc: 60 } }), 'cone');
  assert.equal(verbKind({ type: 'summon', ap: 2 }), 'summon');
  assert.equal(verbKind({ type: 'zone', ap: 2 }), 'zone');
  assert.equal(verbKind(null), 'none');
});

test('a TOUCH control classifies as melee, so the click walks you in', () => {
  // Detain refusing "too far" would make it the one arm's-length action in the
  // game that will not approach.
  assert.equal(verbKind(TOUCH_CONTROL, 0), 'melee');
});

test('a cone outranks its range - its reach lives in `cone`, not in rangeOf', () => {
  assert.equal(verbKind({ type: 'attack', ap: 2, cone: { arc: 60 } }, 5), 'cone');
});

test('the shove keeps its own branch even holding a ranged weapon', () => {
  // A shove is anatomy, not equipment: it must not become a thrown verb
  // because the character happens to be carrying a staple gun.
  assert.equal(verbKind(SHOVE, 6), 'shove');
});
