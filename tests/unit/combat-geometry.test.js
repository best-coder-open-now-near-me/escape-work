// The spatial rules combat runs on (src/combat-geometry.js). Pure module,
// plain objects - no scene, no bodies, no closure. Before the carve every
// assertion in this file was unreachable: reach, the walk-up's stand point and
// the zone's covered tiles all lived inside `startCombat`, so the only way to
// exercise them was to boot a fight in a headless browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cheb, AROUND, ORTHO, reachOfUnit, posOf, withinReach, canReach,
  reachSpecOf, actRangeOf, verbReaches, swingPointAt, hasSwingSpot,
  zoneCellsFor, edgeShieldedTile, TARGET_R, SURPRISE_RADIUS,
} from '../../src/combat-geometry.js';
import { REACH, THROW_RANGE } from '../../src/stats.js';
import { ACTIONS } from '../../src/data/actions.js';

// A body is just a tile. An AI unit carries `combat`; a member carries `sheet`.
const at = (x, z, extra = {}) => ({ x, z, ...extra });
const unit = (x, z, reach) => at(x, z, { combat: { reach } });

// An open world: everything walkable, every edge open, every line clear, and
// the approach point is the goal tile itself.
const open = {
  isWalkable: () => true,
  stepOpen: () => true,
  hasLos: () => true,
  approach: (gx, gz) => [gx, gz],
};
// A world with one wall: the edge between (1,0) and (2,0) is solid.
const walled = {
  ...open,
  stepOpen: (ax, az, bx, bz) =>
    !((ax === 1 && az === 0 && bx === 2 && bz === 0) || (ax === 2 && az === 0 && bx === 1 && bz === 0)),
};

test('cheb is the tile metric: a diagonal costs what an orthogonal does', () => {
  assert.equal(cheb(0, 0, 3, 0), 3);
  assert.equal(cheb(0, 0, 3, 3), 3);
  assert.equal(cheb(0, 0, -2, 1), 2);
});

test('the neighbour sets are the eight and the four faces', () => {
  assert.equal(AROUND.length, 8);
  assert.equal(ORTHO.length, 4);
  // Cover is a face relationship, so no diagonal may sneak into ORTHO.
  assert.ok(ORTHO.every(([dx, dz]) => Math.abs(dx) + Math.abs(dz) === 1));
});

test('reachOfUnit reads a unit\'s def and falls back to the floor', () => {
  assert.equal(reachOfUnit(unit(0, 0, 3)), 3);
  assert.equal(reachOfUnit(at(0, 0)), REACH.DEFAULT);
  assert.equal(reachOfUnit(at(0, 0, { combat: {} })), REACH.DEFAULT);
});

test('posOf prefers the continuous body, and falls back to the tile', () => {
  // A body in the scene: the entity's position is the truth, because the tile
  // is only Math.round of it.
  const withBody = { actor: { x: 2, z: 2, entity: { getPosition: () => ({ x: 2.4, z: 1.6 }) } } };
  assert.deepEqual(posOf(withBody), { x: 2.4, z: 1.6 });
  // No body yet (a unit mid-spawn, or a test): the logical tile stands in.
  assert.deepEqual(posOf(at(3, 4)), { x: 3, z: 4 });
  assert.deepEqual(posOf({ actor: at(5, 6) }), { x: 5, z: 6 });
});

test('withinReach measures distance and ignores what stands between', () => {
  const a = unit(0, 0, REACH.DEFAULT);
  assert.equal(withinReach(a, at(1, 0)), true);
  assert.equal(withinReach(a, at(1, 1)), true); // 1.41 < 1.5
  assert.equal(withinReach(a, at(2, 0)), false);
  // An explicit r overrides the attacker's own - what the shove needs.
  assert.equal(withinReach(a, at(2, 0), 2.5), true);
});

test('canReach adds the edge test - a partition is terrain, not decoration', () => {
  const a = unit(1, 0, REACH.DEFAULT);
  assert.equal(canReach(a, at(2, 0), null, open.stepOpen), true);
  assert.equal(canReach(a, at(2, 0), null, walled.stepOpen), false);
  // Distance still governs: no edge in the world makes an out-of-reach swing legal.
  assert.equal(canReach(unit(0, 0, REACH.DEFAULT), at(3, 0), null, open.stepOpen), false);
});

test('actRangeOf is the CLICK\'s range: 0 means the click walks you in', () => {
  // A thrown attack with no declared range carries THROW_RANGE (stats.js).
  assert.equal(actRangeOf('paper-ball'), THROW_RANGE);
  // A plain swing has none - the click walks into melee reach for it.
  assert.equal(actRangeOf('attack'), 0);
  assert.equal(actRangeOf('nonsense-id'), 0);
});

test('reachSpecOf is the WASH\'s range, and it is the wider question', () => {
  // Every ranged attack washes as far as it fires.
  assert.equal(reachSpecOf('paper-ball').r, THROW_RANGE);
  // A verb the click never fires at range still has no wash spec.
  assert.equal(reachSpecOf('nonsense-id'), null);
});

test('verbReaches asks the armed verb\'s OWN range, not a borrowed one', () => {
  const me = unit(0, 0, REACH.DEFAULT);
  const en = at(4, 0);
  // A throw is live from four tiles out...
  assert.equal(verbReaches('paper-ball', me, en, 0, 0, open), true);
  // ...but not without a line.
  assert.equal(verbReaches('paper-ball', me, en, 0, 0, { ...open, hasLos: () => false }), false);
  // A swing is not - it has no declared range, so it is measured by reach.
  assert.equal(verbReaches('attack', me, en, 0, 0, open), false);
  assert.equal(verbReaches('attack', me, en, 3, 0, open), true);
});

test('verbReaches measures a circle from the unrounded stand point (DEGRID D4/D6)', () => {
  const me = unit(0, 0, REACH.DEFAULT);
  const en = at(5, 0);
  // THROW_RANGE is 5. From (0.4, 0) the true distance is 4.6 - live; the old
  // rule rounded to tile (0,0) first, so legality flipped only at the tile
  // boundary instead of exactly at the range circle.
  assert.equal(verbReaches('paper-ball', me, en, 0.4, 0, open), true);
  assert.equal(verbReaches('paper-ball', me, en, -0.2, 0, open), false);
  // A diagonal at the old cheb square's corner is OUT of the circle: cheb
  // said (5,5) was range 5 from the origin; hypot says 7.07.
  const corner = at(5, 5);
  assert.equal(verbReaches('paper-ball', me, corner, 0, 0, open), false);
});

test('swingPointAt returns a stand point only when the swing would be LEGAL', () => {
  const me = unit(0, 0, REACH.DEFAULT);
  const en = at(3, 0);
  // Beside them: the swing lands, so the walk has somewhere to go.
  assert.deepEqual(swingPointAt(me, en, 2, 0, open), [2, 0]);
  // Two tiles off: nothing to promise.
  assert.equal(swingPointAt(me, en, 1, 0, open), null);
  // A tile you cannot stand on is not a stand point - unless it is your own.
  assert.equal(swingPointAt(me, en, 2, 0, { ...open, isWalkable: () => false }), null);
  const standing = unit(2, 0, REACH.DEFAULT);
  assert.deepEqual(swingPointAt(standing, en, 2, 0, { ...open, isWalkable: () => false }), [2, 0]);
});

test('swingPointAt refuses a stand point a partition would veto', () => {
  // The classic regression: reach distance says yes, the edge says no. Picking
  // the spot by distance alone sent the walk somewhere the arrival check then
  // cancelled - a promised strike that never happened.
  const me = unit(0, 0, REACH.DEFAULT);
  assert.equal(swingPointAt(me, at(2, 0), 1, 0, walled), null);
  assert.deepEqual(swingPointAt(me, at(2, 0), 2, 1, walled), [2, 1]);
});

test('hasSwingSpot is true when any of the eight neighbours works', () => {
  const me = unit(0, 0, REACH.DEFAULT);
  assert.equal(hasSwingSpot(me, at(5, 5), open), true);
  // Nowhere to stand at all: no spot, so the rings promise nothing.
  assert.equal(hasSwingSpot(me, at(5, 5), { ...open, isWalkable: () => false }), false);
});

test('a long handle finds a swing spot the eight neighbours do not offer', () => {
  // The coworker is boxed in: every one of their eight neighbours is occupied
  // or blocked, so the only place to stand is a tile further out. A default
  // reach genuinely has no melee option here - but the reach-grabber's 2.2
  // does, and scanning AROUND alone said no to both, making the long weapon
  // strictly worse than the short one in the case it exists for.
  const en = at(5, 5);
  const ringed = {
    ...open,
    isWalkable: (x, z) => Math.max(Math.abs(x - 5), Math.abs(z - 5)) !== 1,
  };
  assert.equal(hasSwingSpot(unit(0, 0, REACH.DEFAULT), en, ringed), false);
  assert.equal(hasSwingSpot(unit(0, 0, REACH.DEFAULT + 0.7), en, ringed), true);
});

test('zoneCellsFor drops tiles that are unseen, unusable, or occupied', () => {
  const a = { radius: 1 };
  const origin = { x: 0, z: 0 };
  const all = zoneCellsFor(a, origin, 3, 3, {
    canTakeSurface: () => true, hasLos: () => true, occupied: () => false,
  });
  assert.ok(all.length > 1);
  assert.ok(all.some(([x, z]) => x === 3 && z === 3));

  // Nobody gets a surface dropped on their feet - coworker, teammate or you.
  const spared = zoneCellsFor(a, origin, 3, 3, {
    canTakeSurface: () => true, hasLos: () => true, occupied: (x, z) => x === 3 && z === 3,
  });
  assert.equal(spared.length, all.length - 1);
  assert.ok(!spared.some(([x, z]) => x === 3 && z === 3));

  // No line, no tile: the rings, the cursor count and the click agree.
  assert.deepEqual(zoneCellsFor(a, origin, 3, 3, {
    canTakeSurface: () => true, hasLos: () => false, occupied: () => false,
  }), []);
  // A tile that cannot hold a surface is out whatever the geometry says.
  assert.deepEqual(zoneCellsFor(a, origin, 3, 3, {
    canTakeSurface: () => false, hasLos: () => true, occupied: () => false,
  }), []);
});

test('edgeShieldedTile is a walkable tile with a partition on some face', () => {
  assert.equal(edgeShieldedTile(1, 0, open), false); // open plan: nothing to tuck against
  assert.equal(edgeShieldedTile(1, 0, walled), true); // the (1,0)-(2,0) edge
  // Somewhere you cannot stand is never a legal take-cover aim.
  assert.equal(edgeShieldedTile(1, 0, { ...walled, isWalkable: () => false }), false);
});

test('the shared constants keep the numbers they are documented with', () => {
  assert.equal(TARGET_R, 0.5); // the ring the cone must CLIP to catch a body
  assert.equal(SURPRISE_RADIUS, 2);
  assert.ok(ACTIONS.attack); // the ids these tests lean on are real
  assert.ok(ACTIONS['paper-ball']);
});
