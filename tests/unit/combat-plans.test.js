// The plan half of every verb (src/combat-plans.js). Pure module, plain
// objects - no bodies, no AP, no FX. Each of these was a `<verb>PlanAt`
// function inside startCombat's closure, reachable only by booting a fight.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  topplePlan, aiTopplePlan, breakPlan, pullPlan, displacePlan,
  aiShovePlan, aiEdgeTopplePlan, aiPullPlan, aiBreakPlan,
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
  const plan = breakPlan('punch', unit(1, 0), 2, 0, breakWorld());
  assert.deepEqual(plan, { kind: 'prop', tx: 2, tz: 0 });
});

test('a swing out of reach refuses in the melee\'s own words', () => {
  const plan = breakPlan('punch', unit(0, 0), 2, 0, breakWorld());
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
  assert.deepEqual(breakPlan('punch', unit(1, 0), 2, 0, w), { kind: 'edge', a: [1, 0], b: [2, 0] });
  // Diagonal is not square-on - the topple's own aim, and this shares it.
  assert.equal(breakPlan('punch', unit(1, 0), 2, 1, w), null);
});

// --- Pull Over --------------------------------------------------------------

// The crouch is a POSITION with shielded FACES: the target at (2,0) is covered
// on its west face, which is the one pointing at a puller standing at (0,0).
const crouchCell = { at: { x: 2, z: 0 }, faces: [[-1, 0]] };
const pullWorld = (over = {}) => ({ stepOpen: () => true, open: () => true, name: 'The Guard', ...over });

test('a pull over a shielded face finds a landing on your side', () => {
  const r = pullPlan(unit(0, 0), at(2, 0), crouchCell, pullWorld());
  assert.ok(r.landing);
  assert.equal(r.refusal, undefined);
  assert.equal(r.crouch, crouchCell);
});

test('every refusal is the leg that failed, in order', () => {
  // Not dug in at all.
  assert.match(pullPlan(unit(0, 0), at(2, 0), null, pullWorld()).refusal, /not dug in/);
  // Dug in behind a PERSON on the face in the way: that is a shove, not a pull.
  assert.match(
    pullPlan(unit(0, 0), at(2, 0), crouchCell, pullWorld({ bodyAt: () => true })).refusal,
    /shove, not a pull/,
  );
  // Their cover is not between you - covered, but on the far face.
  assert.match(
    pullPlan(unit(0, 0), at(2, 0), { at: { x: 2, z: 0 }, faces: [[1, 0]] }, pullWorld()).refusal,
    /not between you/,
  );
  // Properly shielded (the face points your way) but well out of arm's reach.
  assert.match(
    pullPlan(unit(0, 0), at(6, 0), { at: { x: 6, z: 0 }, faces: [[-1, 0]] }, pullWorld()).refusal,
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

// --- the AI's cover-denial plans (AI_PLAN M4) --------------------------------

test('a shove that merely moves somebody is refused; a slam is taken', () => {
  const victimAt = (x, z) => (x === 1 && z === 0 ? { name: 'v' } : null);
  const openWorld = { isWalkable: () => true, stepOpen: () => true, occupied: () => false };
  // Open floor behind them: nothing strictly better about it - no plan.
  assert.equal(aiShovePlan(0, 0, openWorld, victimAt), null);
  // A wall behind them is the slam.
  const walled = { ...openWorld, isWalkable: (x) => x < 2 };
  const slam = aiShovePlan(0, 0, walled, victimAt);
  assert.ok(slam && slam.blocked);
  assert.equal(slam.victim.name, 'v');
});

test('a hazard landing is worth a shove; disengage widens the gate', () => {
  const victimAt = (x, z) => (x === 1 && z === 0 ? { name: 'v' } : null);
  const openWorld = { isWalkable: () => true, stepOpen: () => true, occupied: () => false };
  const wet = aiShovePlan(0, 0, openWorld, victimAt, {
    hazardAt: (x, z) => x === 2 && z === 0,
  });
  assert.ok(wet && !wet.blocked);
  // The ranged kit's carve-out: breaking contact is itself the value.
  const step = aiShovePlan(0, 0, openWorld, victimAt, { disengage: true });
  assert.ok(step && !step.blocked);
});

test('the partition topple wants an edge, an open far tile, and a victim', () => {
  const w = {
    wallEdgeBetween: (x, z, nx, nz) => nx === 1 && nz === 0,
    terrainOpen: () => true,
  };
  const hit = aiEdgeTopplePlan(0, 0, w, (x, z) => x === 1 && z === 0);
  assert.deepEqual(hit, { edge: true, tx: 1, tz: 0 });
  // Empty carpet behind the panel: nothing to gain, no plan.
  assert.equal(aiEdgeTopplePlan(0, 0, w, () => false), null);
  // A victim does not make an occupied/non-terrain landing legal.
  assert.equal(aiEdgeTopplePlan(0, 0, { ...w, terrainOpen: () => false }, () => true), null);
});

test('aiPullPlan hauls the first crouched victim the pull rules accept', () => {
  const puller = { x: 0, z: 0 };
  const victim = { sheet: { name: 'v' }, actor: { x: 2, z: 0 } };
  const crouch = { at: { x: 2, z: 0 }, faces: [[-1, 0]] }; // shield toward the puller
  const w = { stepOpen: () => true, open: () => true, bodyAt: () => false };
  const plan = aiPullPlan(puller, [victim], () => crouch, w);
  assert.ok(plan && plan.landing);
  assert.equal(plan.victim, victim);
  // No crouch, no pull - it is cover-denial, not a generic yank.
  assert.equal(aiPullPlan(puller, [victim], () => null, w), null);
  // Shield on the wrong side: pullPlan refuses and the wrapper passes it up.
  const wrong = { at: { x: 2, z: 0 }, faces: [[1, 0]] };
  assert.equal(aiPullPlan(puller, [victim], () => wrong, w), null);
});

test('a shut door beats battering, and only toward the target', () => {
  const flat = { tileDefAt: () => ({ label: 'floor' }), edgeHpBetween: () => null };
  // Closed door on the way to a target at (5,0): open it - a door carries no
  // HP pool at all, so without this arm the unit would stand there forever.
  const toward = aiBreakPlan(0, 0, 5, 0, {
    ...flat,
    doorsBeside: () => [{ key: 'h:1:0', ap: 1, open: false, to: [1, 0] }],
  });
  assert.deepEqual(toward, { kind: 'door', key: 'h:1:0', ap: 1, tx: 1, tz: 0 });
  // A door leading AWAY is not a way through.
  assert.equal(aiBreakPlan(0, 0, 5, 0, {
    ...flat,
    doorsBeside: () => [{ key: 'h:-1:0', ap: 1, open: false, to: [-1, 0] }],
  }), null);
  // An already-open door is not a plan either - the route is the answer.
  assert.equal(aiBreakPlan(0, 0, 5, 0, {
    ...flat,
    doorsBeside: () => [{ key: 'h:1:0', ap: 1, open: true, to: [1, 0] }],
  }), null);
});

test('a sealed unit finds the barrier on the way toward its target', () => {
  const cabinetAt = (x, z) => (x === 1 && z === 0 ? CABINET : { label: 'floor' });
  const prop = aiBreakPlan(0, 0, 5, 0, { tileDefAt: cabinetAt, edgeHpBetween: () => null });
  assert.deepEqual(prop, { kind: 'prop', tx: 1, tz: 0 });
  const edge = aiBreakPlan(0, 0, 5, 0, {
    tileDefAt: () => ({ label: 'floor' }),
    edgeHpBetween: (x, z, nx, nz) => (nx === 1 ? 12 : null),
  });
  assert.deepEqual(edge, { kind: 'edge', a: [0, 0], b: [1, 0] });
  // Nothing breakable on the faces toward them: no plan, the crouch is next.
  assert.equal(aiBreakPlan(0, 0, 5, 0, {
    tileDefAt: () => ({ label: 'floor' }), edgeHpBetween: () => null,
  }), null);
});
