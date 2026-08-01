// What an AI unit decides (src/combat-ai.js). Pure module, plain objects - no
// bodies, no AP ledger, no frame clock.
//
// The beat ladder is the point. It used to be a stack of `if` arms inside the
// per-frame driver, each one deciding AND executing in the same breath, so
// "does a boxed-in unit crouch or burn its turn?" could only be answered by
// watching a fight go by.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  standTilePath, pickTarget, advanceRoute, aiCrouchCovered, chooseBeat, afterFailedAdvance,
  AI, standTileRoutes, scoreDestination,
} from '../../src/combat-ai.js';
import { REACH } from '../../src/stats.js';

const member = (x, z, hp = 10, maxHp = 10) => ({ sheet: { hp, maxHp }, actor: { x, z } });
const unit = (x, z) => ({ x, z, combat: { reach: REACH.DEFAULT } });

// --- standing and routing ----------------------------------------------------

const routeWorld = (over = {}) => ({
  isWalkable: () => true,
  findEnemyPath: (sx, sz, gx, gz) => [[sx, sz], [gx, gz]],
  ...over,
});

test('the stand-tile route goes to a neighbour of the target', () => {
  const p = standTilePath(0, 0, 5, 5, routeWorld());
  const [gx, gz] = p[p.length - 1];
  assert.equal(Math.max(Math.abs(gx - 5), Math.abs(gz - 5)), 1);
});

test('already standing on a swing tile returns the degenerate self-path', () => {
  // THE pacing bug, in one assertion. findEnemyPath cannot express "no route
  // needed" - it rejects a goal failing isWalkable, and the unit's own tile
  // fails it because the unit is standing there - so the search used to fall
  // through to a DIFFERENT adjacent tile and walk there, then walk back next
  // turn, forever, instead of ever attacking.
  assert.deepEqual(standTilePath(4, 5, 5, 5, routeWorld()), [[4, 5], [4, 5]]);
});

test('no walkable neighbour and no route means nowhere to stand', () => {
  assert.equal(standTilePath(0, 0, 5, 5, routeWorld({ isWalkable: () => false })), null);
  assert.equal(standTilePath(0, 0, 5, 5, routeWorld({ findEnemyPath: () => null })), null);
});

test('the shortest route to a swing tile wins', () => {
  const p = standTilePath(0, 0, 5, 5, routeWorld({
    findEnemyPath: (sx, sz, gx, gz) => (gx === 4 && gz === 4
      ? [[sx, sz], [gx, gz]]
      : [[sx, sz], [1, 1], [2, 2], [gx, gz]]),
  }));
  assert.deepEqual(p[p.length - 1], [4, 4]);
});

// --- target selection --------------------------------------------------------

test('an engageable member outranks a nearer one behind a wall', () => {
  // Targeting somebody you can neither reach nor walk to means walking to the
  // wall and swinging at nothing, every turn, forever.
  const near = member(1, 0);
  const far = member(6, 0);
  const t = pickTarget(0, 0, [near, far], (m) => m === far);
  assert.equal(t.member, far);
});

test('focus 0 is the old rule: nearest, wounded tiebreak (AI_PLAN M2)', () => {
  const a = member(3, 0, 10);
  const b = member(1, 0, 10);
  assert.equal(pickTarget(0, 0, [a, b], () => true, { focus: 0 }).member, b);

  // Equal distance, one of them already hurt: the wounded one takes the tie -
  // the shipped rule this scoring replaced, preserved at the knob's floor.
  const hale = member(2, 0, 10);
  const hurt = member(0, 2, 3);
  assert.equal(pickTarget(0, 0, [hale, hurt], () => true, { focus: 0 }).member, hurt);
});

test('at focus 1 a finishable target outranks a nearer hale one', () => {
  const near = member(1, 0, 20, 20); // adjacent, untouched
  const far = member(3, 0, 3, 20); // three swings away, one swing from down
  const expSwings = (m) => Math.ceil(m.sheet.hp / 3);
  const t = pickTarget(0, 0, [near, far], () => true, { focus: 1, expSwings });
  assert.equal(t.member, far);
});

test('stickiness holds the current target against a marginally nearer one', () => {
  const mark = member(2, 0, 10);
  const closer = member(1, 0, 10);
  // With no standing mark, proximity wins...
  assert.equal(pickTarget(0, 0, [mark, closer], () => true, { focus: 0 }).member, closer);
  // ...but the mark's hysteresis outweighs the one-tile difference, so the
  // unit does not flip-flop between near-equal members every turn.
  assert.equal(
    pickTarget(0, 0, [mark, closer], () => true, { focus: 0, current: mark }).member,
    mark,
  );
  assert.ok(AI.STICKINESS > 0); // the test above is vacuous if the knob hits 0
});

test('full ties fall to candidate order, so a seeded fight replays', () => {
  const first = member(2, 0, 10);
  const second = member(0, 2, 10);
  assert.equal(pickTarget(0, 0, [first, second], () => true).member, first);
});

test('engageability is a tier no score can buy past', () => {
  // A one-swing kill on the far side of a sealed wall still loses to a
  // reachable full-health member: walking to the wall and swinging at
  // nothing is the stall the M3 lesson exists to prevent.
  const sealed = member(1, 0, 1, 20);
  const open = member(4, 0, 20, 20);
  const t = pickTarget(0, 0, [sealed, open], (m) => m === open, {
    focus: 1, expSwings: (m) => Math.ceil(m.sheet.hp / 3),
  });
  assert.equal(t.member, open);
});

test('no candidates means no target - which is how a party wipe reads', () => {
  assert.equal(pickTarget(0, 0, [], () => true), null);
});

// --- destination scoring (AI_PLAN M3) ---------------------------------------

test('standTileRoutes returns the whole field - and the self-path alone', () => {
  assert.equal(standTileRoutes(0, 0, 5, 5, routeWorld()).length, 8);
  // Already on a swing tile: not a field to score, THE answer - the pacing
  // bug's fix keeps absolute priority over any scored alternative.
  assert.deepEqual(standTileRoutes(4, 5, 5, 5, routeWorld()), [[[4, 5], [4, 5]]]);
});

test('a flanking arrival outranks a shorter route', () => {
  const target = { x: 5, z: 5 };
  const shortest = [[5, 7], [5, 6]]; // cost 1, arrives south - no pincer
  const flank = [[5, 7], [4, 6]]; // cost 1.41, arrives SW - opposite the NE ally
  const allies = [{ x: 6, z: 4, reach: 1.5 }];
  assert.equal(scoreDestination([shortest, flank], { target, allies }), flank);
  // Without the ally there is nothing to buy: the cheap route wins.
  assert.equal(scoreDestination([shortest, flank], { target }), shortest);
});

test('a route that eats an opportunity attack loses to an equal-cost detour', () => {
  const threats = [{ x: 0, z: 2, reach: 1.5 }];
  const through = [[0, 0], [0, 1], [3, 1]]; // enters the watcher's reach, then leaves
  const around = [[0, 0], [2, 0], [4, 0]]; // same total cost, never inside
  assert.equal(scoreDestination([through, around], { threats }), around);
});

test('a route through a hazard loses to a dry detour worth less than its weight', () => {
  const surfDamageAt = (x, z) => (x === 1 && z === 0 ? 3 : 0);
  const wet = [[0, 0], [1, 0], [2, 0]]; // cost 2, through the spill
  const dry = [[0, 0], [1, 1], [2, 0]]; // cost 2.83, around it
  assert.equal(scoreDestination([wet, dry], { surfDamageAt }), dry);
  // No spill, no detour: the cheap route wins again.
  assert.equal(scoreDestination([wet, dry], {}), wet);
});

test('positions are judged at the approach point, not the tile centre', () => {
  const target = { x: 5, z: 5 };
  const allies = [{ x: 6, z: 5, reach: 1.5 }];
  const diag = [[3, 3], [4, 4]]; // tile centre reads diagonal - no pincer with an east ally
  const south = [[3, 3], [3, 4]]; // cheaper, first in the field
  // Without the approach point, nothing flanks and cheap wins...
  assert.equal(scoreDestination([south, diag], { target, allies }), south);
  // ...but the real arrival spot drifts toward the target's west face, the
  // octant goes cardinal, and the east ally is suddenly dead opposite.
  const approach = (gx, gz) => (gx === 4 && gz === 4 ? [4.6, 4.9] : [gx, gz]);
  assert.equal(scoreDestination([south, diag], { target, allies, approach }), diag);
});

// --- the advance -------------------------------------------------------------

const moveWorld = (over = {}) => ({
  approach: (gx, gz) => [gx, gz],
  stepOpen: () => true,
  ...over,
});

test('with a route, the last point is pulled in to the target\'s body', () => {
  const out = advanceRoute(unit(0, 0), member(5, 5), [[0, 0], [4, 5]], moveWorld({
    approach: () => [4.4, 5.1],
  }));
  assert.deepEqual(out[out.length - 1], [4.4, 5.1]);
  assert.deepEqual(out[0], [0, 0]);
});

test('with no route, an adjacent unit shuffles inside its own tile', () => {
  // One tile can hold both a spot inside reach and a spot outside it now that
  // reach is a distance. Without this an AI hemmed into the single adjacent
  // tile of a corridor can never get in range and the fight never resolves.
  const out = advanceRoute(unit(4, 5), member(5, 5), null, moveWorld({
    approach: () => [4.4, 5],
  }));
  assert.ok(out);
  assert.deepEqual(out[out.length - 1], [4.4, 5]);
});

test('no route and not adjacent means there is nothing to spend on', () => {
  assert.equal(advanceRoute(unit(0, 0), member(5, 5), null, moveWorld()), null);
});

test('the in-place shuffle is refused when it would not earn a swing', () => {
  // Already as close as this tile allows: nothing to buy.
  assert.equal(
    advanceRoute(unit(4, 5), member(5, 5), null, moveWorld({ approach: () => [4, 5] })),
    null,
  );
  // A partition between the bodies is not a distance problem, so closing the
  // gap cannot solve it - spending AP to end up equally unable to swing is the
  // same stall wearing a different hat.
  assert.equal(
    advanceRoute(unit(4, 5), member(5, 5), null, moveWorld({
      approach: () => [4.4, 5], stepOpen: () => false,
    })),
    null,
  );
});

// --- the turtle beat ---------------------------------------------------------

const LOW_SOLID = { solid: true, height: 0.6 };
const TALL_SOLID = { solid: true, blocksSight: true };

test('a unit tucks in where a low solid stands between it and its target', () => {
  // Target at (0,5), unit at (0,3), shield at (0,4): on the face, in the way.
  assert.equal(aiCrouchCovered(0, 3, 0, 5, {
    tileDefAt: (x, z) => (x === 0 && z === 4 ? LOW_SOLID : null),
    stepOpen: () => true,
  }), true);
});

test('crouching with the desk BEHIND you is worse than standing there', () => {
  // The shield is behind the unit, not between it and the target.
  assert.equal(aiCrouchCovered(0, 3, 0, 5, {
    tileDefAt: (x, z) => (x === 0 && z === 2 ? LOW_SOLID : null),
    stepOpen: () => true,
  }), false);
});

test('a TALL solid is not cover - nothing could shoot you anyway', () => {
  // The beat would read as the AI hiding from air.
  assert.equal(aiCrouchCovered(0, 3, 0, 5, {
    tileDefAt: (x, z) => (x === 0 && z === 4 ? TALL_SOLID : null),
    stepOpen: () => true,
  }), false);
});

test('with no furniture, the tile\'s own partitions count', () => {
  assert.equal(aiCrouchCovered(0, 3, 0, 5, {
    tileDefAt: () => null,
    stepOpen: () => false, // an edge already blocks the line
  }), true);
});

test('a BODY on the face is cover like anything else', () => {
  // The unified rule: a person shields a face the way a cabinet does, which is
  // what makes "take cover behind a teammate" the same verb as every other.
  assert.equal(aiCrouchCovered(0, 3, 0, 5, {
    tileDefAt: () => null,
    stepOpen: () => true,
    bodyAt: (x, z) => x === 0 && z === 4,
  }), true);
  // ...and on the wrong face it is not.
  assert.equal(aiCrouchCovered(0, 3, 0, 5, {
    tileDefAt: () => null,
    stepOpen: () => true,
    bodyAt: (x, z) => x === 0 && z === 2,
  }), false);
});

// --- the beat ladder ---------------------------------------------------------

// A unit with every option live and the AP for all of them.
const rich = (over = {}) => ({
  ap: 10, moveBudget: 10, moveCost: 1, inReach: true, hasAttack: true, attackAp: 2,
  summon: null, toppleAp: 2, canTopple: false, canCrouch: true, coverAp: 1, ...over,
});

test('the summoner reinforces before it wades in', () => {
  assert.equal(chooseBeat(rich({ summon: { ap: 3, ready: true } })).beat, 'summon');
  // Not off cooldown / nobody left to post: it just fights.
  assert.equal(chooseBeat(rich({ summon: { ap: 3, ready: false } })).beat, 'attack');
  // Ready but unaffordable is the same as not ready.
  assert.equal(chooseBeat(rich({ ap: 2, summon: { ap: 3, ready: true } })).beat, 'attack');
});

test('the topple outranks the swing - it damages, stuns, and leaves cover', () => {
  assert.equal(chooseBeat(rich({ canTopple: true })).beat, 'topple');
  assert.equal(chooseBeat(rich({ canTopple: true, ap: 1 })).beat, 'crouch'); // cannot afford it
});

test('in reach with a swing and the AP is an attack', () => {
  assert.equal(chooseBeat(rich()).beat, 'attack');
  // A unit with no attacks at all does not stand there swinging nothing.
  assert.notEqual(chooseBeat(rich({ hasAttack: false })).beat, 'attack');
  assert.notEqual(chooseBeat(rich({ ap: 1 })).beat, 'attack');
});

test('out of reach with a budget is an advance, and never while in reach', () => {
  assert.equal(chooseBeat(rich({ inReach: false })).beat, 'advance');
  // In reach but unable to swing: it does NOT walk away to try again.
  assert.notEqual(chooseBeat(rich({ hasAttack: false })).beat, 'advance');
});

test('a boxed-in unit crouches rather than standing there as a target', () => {
  assert.equal(chooseBeat(rich({ inReach: false, moveBudget: 0 })).beat, 'crouch');
  assert.equal(chooseBeat(rich({ inReach: false, moveBudget: 0, canCrouch: false })).beat, 'pass');
  assert.equal(chooseBeat(rich({ inReach: false, moveBudget: 0, ap: 0 })).beat, 'pass');
});

test('an advance that spends nothing gets the crouch it would have had', () => {
  assert.equal(afterFailedAdvance(rich()).beat, 'crouch');
  assert.equal(afterFailedAdvance(rich({ canCrouch: false })).beat, 'stall');
  assert.equal(afterFailedAdvance(rich({ ap: 0 })).beat, 'stall');
});
