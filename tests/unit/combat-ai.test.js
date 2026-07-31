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
} from '../../src/combat-ai.js';
import { REACH } from '../../src/stats.js';

const member = (x, z, hp = 10) => ({ sheet: { hp }, actor: { x, z } });
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

test('within a group, distance decides and the wounded break the tie', () => {
  const a = member(3, 0, 10);
  const b = member(1, 0, 10);
  assert.equal(pickTarget(0, 0, [a, b], () => true).member, b);

  const hale = member(2, 0, 10);
  const hurt = member(0, 2, 3);
  assert.equal(pickTarget(0, 0, [hale, hurt], () => true).member, hurt);
});

test('no candidates means no target - which is how a party wipe reads', () => {
  assert.equal(pickTarget(0, 0, [], () => true), null);
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
