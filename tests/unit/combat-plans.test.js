// The plan half of every verb (src/combat-plans.js). Pure module, plain
// objects - no bodies, no AP, no FX. Each of these was a `<verb>PlanAt`
// function inside startCombat's closure, reachable only by booting a fight.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  topplePlan, aiTopplePlan, breakPlan, pullPlan, coverSpot, displacePlan,
} from '../../src/combat-plans.js';
import { REACH } from '../../src/stats.js';

const at = (x, z, extra = {}) => ({ x, z, ...extra });
const unit = (x, z) => at(x, z, { combat: { reach: REACH.DEFAULT } });

// A bookcase at (2,0), nothing else. Everything open unless a test says so.
const BOOKCASE = { label: 'bookcase', solid: true, topple: { becomes: 'debris', damage: [2, 4] } };
const CABINET = { label: 'filing cabinet', cover: true, hp: 6 };
const world = (over = {}) => ({
  tileDefAt: (x, z) => (x === 2 && z === 0 ? BOOKCASE : { label: 'floor' }),
  terrainOpen: () => true,
  stepOpen: () => true,
  isWalkable: () => true,
  hasLos: () => true,
  edgeHpBetween: () => null,
  ...over,
});

// --- toppling ---------------------------------------------------------------

test('a topple pushes AWAY from the toppler, onto the far tile', () => {
  const plan = topplePlan(1, 0, 2, 0, world());
  assert.deepEqual(plan.lx, 3);
  assert.equal(plan.lz, 0);
  assert.equal(plan.def, BOOKCASE);
});

test('nothing toppleable there means no plan', () => {
  assert.equal(topplePlan(0, 0, 1, 0, world()), null);
});

test('a prop pinned by geometry stays up - no free demolition against a wall', () => {
  // Nothing behind it to fall into: it rocks and settles. This is what stops
  // toppling from being a way to demolish a corridor.
  assert.equal(topplePlan(1, 0, 2, 0, world({ terrainOpen: () => false })), null);
  // A partition on the landing face is the same story.
  assert.equal(topplePlan(1, 0, 2, 0, world({ stepOpen: () => false })), null);
});

test('standing ON the prop gives no direction, so no plan', () => {
  assert.equal(topplePlan(2, 0, 2, 0, world()), null);
});

test('the AI topples only when somebody it wants to hit is in the landing tile', () => {
  // From (1,0) the bookcase at (2,0) lands on (3,0).
  assert.ok(aiTopplePlan(1, 0, world(), (x, z) => x === 3 && z === 0));
  // The office falls on coworkers, not on empty carpet.
  assert.equal(aiTopplePlan(1, 0, world(), () => false), null);
});

// --- breaking cover down ----------------------------------------------------

const breakWorld = (over = {}) => world({
  tileDefAt: (x, z) => (x === 2 && z === 0 ? CABINET : { label: 'floor' }),
  ...over,
});

test('a swing at a breakable prop in reach commits', () => {
  const plan = breakPlan('attack', unit(1, 0), 2, 0, breakWorld());
  assert.deepEqual(plan, { kind: 'prop', tx: 2, tz: 0 });
});

test('a swing out of reach refuses in the melee\'s own words', () => {
  const plan = breakPlan('attack', unit(0, 0), 2, 0, breakWorld());
  assert.match(plan.refusal, /swing/);
});

test('a shot refuses on distance and on the line, separately', () => {
  const far = breakPlan('paper-ball', unit(0, 0), 20, 0, breakWorld({
    tileDefAt: (x, z) => (x === 20 && z === 0 ? CABINET : { label: 'floor' }),
  }));
  assert.match(far.refusal, /Too far/);
  const blind = breakPlan('paper-ball', unit(0, 0), 2, 0, breakWorld({ hasLos: () => false }));
  assert.match(blind.refusal, /clear line/);
});

test('a verb that does not aim at props falls through rather than refusing', () => {
  // null, not a refusal: the click must go on to try the next thing.
  assert.equal(breakPlan('shove', unit(1, 0), 2, 0, breakWorld()), null);
});

test('a swing takes a partition square-on and never diagonally', () => {
  const w = breakWorld({
    tileDefAt: () => ({ label: 'floor' }),
    edgeHpBetween: () => 4,
  });
  assert.deepEqual(breakPlan('attack', unit(1, 0), 2, 0, w), { kind: 'edge', a: [1, 0], b: [2, 0] });
  // Diagonal is not square-on - the topple's own aim, and this shares it.
  assert.equal(breakPlan('attack', unit(1, 0), 2, 1, w), null);
});

// --- Pull Over --------------------------------------------------------------

const crouchCell = { x: 1, z: 0 }; // shield cell between (0,0) and (2,0)
const pullWorld = (over = {}) => ({ stepOpen: () => true, open: () => true, name: 'The Guard', ...over });

test('a pull over a cover cell finds a landing on your side', () => {
  const r = pullPlan(unit(0, 0), at(2, 0), crouchCell, pullWorld());
  assert.ok(r.landing);
  assert.equal(r.refusal, undefined);
  assert.equal(r.crouch, crouchCell);
});

test('every refusal is the leg that failed, in order', () => {
  // Not dug in at all.
  assert.match(pullPlan(unit(0, 0), at(2, 0), null, pullWorld()).refusal, /not dug in/);
  // Dug in behind a PERSON: that is a shove, not a pull.
  assert.match(
    pullPlan(unit(0, 0), at(2, 0), { ...crouchCell, shield: {} }, pullWorld()).refusal,
    /shove, not a pull/,
  );
  // Their cover is not between you.
  assert.match(
    pullPlan(unit(0, 0), at(2, 0), { x: 5, z: 5 }, pullWorld()).refusal,
    /not between you/,
  );
  // Properly shielded (the cell sits on their face, between the two of you) but
  // well out of arm's reach across it.
  assert.match(
    pullPlan(unit(0, 0), at(6, 0), { x: 5, z: 0 }, pullWorld()).refusal,
    /Too far/,
  );
  // Nowhere on your side to put them.
  assert.match(
    pullPlan(unit(0, 0), at(2, 0), crouchCell, pullWorld({ open: () => false })).refusal,
    /No room/,
  );
});

test('the plan and its refusal are the same walk - never both, never neither', () => {
  // The regression this function exists to make impossible: pullPlanFor and
  // pullRefusal used to be two hand-parallel lists of the same five legs, kept
  // in step by a comment. A click could be refused by one and allowed by the
  // other.
  const cases = [
    [null, pullWorld()],
    [{ ...crouchCell, shield: {} }, pullWorld()],
    [{ x: 5, z: 5 }, pullWorld()],
    [{ x: 5, z: 0 }, pullWorld()],
    [crouchCell, pullWorld({ open: () => false })],
    [crouchCell, pullWorld()],
  ];
  for (const [crouch, w] of cases) {
    const r = pullPlan(unit(0, 0), at(2, 0), crouch, w);
    assert.equal(!!r.landing, !r.refusal, `plan and refusal disagreed for ${JSON.stringify(crouch)}`);
  }
});

test('the target\'s name reaches the first refusal', () => {
  assert.match(pullPlan(unit(0, 0), at(2, 0), null, pullWorld()).refusal, /The Guard/);
});

// --- take cover -------------------------------------------------------------

const coverWorld = (over = {}) => ({
  isWalkable: () => true,
  hasLos: () => true,
  findPath: (sx, sz, gx, gz) => [[sx, sz], [gx, gz]],
  occupantAt: () => null,
  ...over,
});

test('cell cover tucks you in beside the shield, on a face', () => {
  const spot = coverSpot(unit(0, 0), 3, 0, false, coverWorld());
  assert.equal(Math.abs(spot.sx - 3) + Math.abs(spot.sz - 0), 1); // orthogonal
  assert.ok(spot.path);
});

test('already standing on the spot means no walk at all', () => {
  // The zero-length-route case: the character CLOSEST to the cover must not be
  // the one told there is no way in.
  const spot = coverSpot(unit(2, 0), 3, 0, false, coverWorld());
  assert.deepEqual([spot.sx, spot.sz], [2, 0]);
  assert.equal(spot.path, null);
});

test('edge cover puts you ON the tile, and needs a line to it', () => {
  const spot = coverSpot(unit(0, 0), 3, 0, true, coverWorld());
  assert.deepEqual([spot.sx, spot.sz], [3, 0]);
  assert.ok(spot.path);
  assert.match(coverSpot(unit(0, 0), 3, 0, true, coverWorld({ hasLos: () => false })).refusal, /way in/);
});

test('occupied and unreachable neighbours are not spots', () => {
  assert.match(
    coverSpot(unit(0, 0), 3, 0, false, coverWorld({ occupantAt: () => ({}) })).refusal,
    /way in/,
  );
  assert.match(
    coverSpot(unit(0, 0), 3, 0, false, coverWorld({ findPath: () => null })).refusal,
    /way in/,
  );
});

test('the shortest route beside the shield wins', () => {
  const spot = coverSpot(unit(0, 0), 3, 0, false, coverWorld({
    // (2,0) is a long way round; (3,1) is next door.
    findPath: (sx, sz, gx, gz) => (gx === 3 && gz === 1
      ? [[sx, sz], [gx, gz]]
      : [[sx, sz], [1, 1], [2, 1], [gx, gz]]),
  }));
  assert.deepEqual([spot.sx, spot.sz], [3, 1]);
});

// --- displacement -----------------------------------------------------------

const pushWorld = (over = {}) => ({
  isWalkable: () => true, stepOpen: () => true, occupied: () => false, ...over,
});

test('a clear tile behind them is a step back, not a slam', () => {
  assert.deepEqual(displacePlan(1, 1, 1, 0, pushWorld()), { tx: 2, tz: 1, blocked: false });
});

test('a wall, a partition and a BODY all count as something solid', () => {
  assert.equal(displacePlan(1, 1, 1, 0, pushWorld({ isWalkable: () => false })).blocked, true);
  assert.equal(displacePlan(1, 1, 1, 0, pushWorld({ stepOpen: () => false })).blocked, true);
  // The one isWalkable misses: without it a shove glides a coworker onto a
  // teammate's tile and leaves two combatants permanently stacked.
  assert.equal(displacePlan(1, 1, 1, 0, pushWorld({ occupied: () => true })).blocked, true);
});

test('a push with no direction is not a push', () => {
  assert.equal(displacePlan(1, 1, 0, 0, pushWorld()), null);
});
