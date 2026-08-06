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
  standTilePath, pickTarget, advanceRoute, aiCrouchCovered, chooseBeat,
  AI, standTileRoutes, scoreDestination, firingTileRoutes, beatStateFrom,
  takeBeat, aiBeatPlansFrom, aiSupportPlan, lineWeights,
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

test('path cost is the baseline even when the cheaper route is listed second', () => {
  const expensive = [[0, 0], [0, 2], [3, 2]];
  const cheap = [[0, 0], [2, 0]];
  assert.equal(scoreDestination([expensive, cheap]), cheap);
});

test('backstab and slip risk each move an otherwise tied destination', () => {
  const target = { x: 5, z: 5 };
  const front = [[5, 7], [6, 5]];
  const back = [[5, 7], [4, 5]];
  assert.equal(scoreDestination([front, back], {
    target, facing: { x: 1, z: 0 },
  }), back);

  const slippery = [[0, 0], [1, 0], [2, 0]];
  const dry = [[0, 0], [1, 1], [2, 0]];
  assert.equal(scoreDestination([slippery, dry], {
    slipChanceAt: (x, z) => (x === 1 && z === 0 ? 1 : 0),
  }), dry);
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

// --- the ranged kit (AI_PLAN M5) --------------------------------------------

test('firing tiles want range AND a line of sight, and the fan is capped', () => {
  const w = routeWorld({ hasLos: () => true });
  const routes = firingTileRoutes(0, 0, 4, 0, 3, w);
  assert.ok(routes.length > 0 && routes.length <= 12);
  for (const r of routes) {
    const [gx, gz] = r[r.length - 1];
    assert.ok(Math.hypot(gx - 4, gz - 0) <= 3 - AI.RANGE_SLACK + 1e-9);
  }
  // No line anywhere means no firing field - the caller falls back to the
  // melee swing field rather than standing still.
  assert.equal(firingTileRoutes(0, 0, 4, 0, 3, routeWorld({ hasLos: () => false })).length, 0);
  // Already standing on a firing tile: the answer, not a candidate.
  assert.deepEqual(firingTileRoutes(3, 0, 4, 0, 3, w), [[[3, 0], [3, 0]]]);
});

test('the entrenched shot: crouch first, but only when both are affordable', () => {
  assert.equal(chooseBeat(rich({ inReach: false, canShoot: true, canEntrench: true })).beat, 'entrench');
  // coverAp 1 + attackAp 2 = 3 > 2 AP: the crouch would cost the shot - just shoot.
  assert.equal(chooseBeat(rich({ inReach: false, canShoot: true, canEntrench: true, ap: 2 })).beat, 'shoot');
  assert.equal(chooseBeat(rich({ inReach: false, canShoot: true })).beat, 'shoot');
  // In reach the swing wins outright - no point-blank ambiguity.
  assert.equal(chooseBeat(rich({ canShoot: true })).beat, 'attack');
  // And a standing shot outranks closing the distance.
  assert.equal(chooseBeat(rich({ inReach: false, canShoot: true, moveBudget: 10 })).beat, 'shoot');
});

test('a shooter prefers a shielded firing tile and keeps its distance', () => {
  const open = [[0, 0], [2, 0]];
  const desk = [[0, 0], [2, 1]]; // slightly dearer, but crouchable
  const shieldFaceAt = (x, z) => x === 2 && z === 1;
  assert.equal(scoreDestination([open, desk], { shieldFaceAt }), desk);
  // A tile inside the party's reach invites the melee answer: with a threat
  // at (2.5, 0), the equal-cost tile away from it wins.
  const near = [[0, 0], [2, 0]];
  const far = [[0, 0], [0, 2]];
  const nearestThreatDist = (ax, az) => Math.hypot(ax - 2.5, az - 0);
  assert.equal(scoreDestination([near, far], { nearestThreatDist }), far);
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
  let approached = 0;
  const out = advanceRoute(unit(0, 0), member(5, 5), null, moveWorld({
    approach: () => { approached += 1; return [4.4, 5]; },
  }));
  assert.equal(out, null);
  assert.equal(approached, 0, 'a non-adjacent target never reaches the shuffle fallback');
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
  support: null, summon: null,
  pullAp: 2, canPull: false, toppleAp: 2, canTopple: false, shoveAp: 2, canShove: false,
  canEntrench: false, canShoot: false, breakAp: 2, canBreak: false,
  canCrouch: true, coverAp: 1, ...over,
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

// --- the cover-denial arms and the refused tail (AI_PLAN M4) -----------------

test('the pull outranks everything but reinforcement', () => {
  assert.equal(chooseBeat(rich({ canPull: true, canTopple: true, canShove: true })).beat, 'pull');
  assert.equal(chooseBeat(rich({ canPull: true, summon: { ap: 3, ready: true } })).beat, 'summon');
  assert.equal(chooseBeat(rich({ canPull: true, ap: 1 })).beat, 'crouch'); // cannot afford it
});

test('the shove sits between the topple and the swing', () => {
  // The plan only EXISTS when strictly better (a slam or a hazard landing),
  // so the arm outranking the plain attack is safe by construction.
  assert.equal(chooseBeat(rich({ canShove: true })).beat, 'shove');
  assert.equal(chooseBeat(rich({ canShove: true, canTopple: true })).beat, 'topple');
});

test('break fires only when there is no walk to make', () => {
  // With a move budget the advance still wins - walking beats demolition.
  assert.equal(chooseBeat(rich({ inReach: false, canBreak: true })).beat, 'advance');
  assert.equal(chooseBeat(rich({ inReach: false, moveBudget: 0, canBreak: true })).beat, 'break');
});

test('a refused advance falls through the ladder to the crouch', () => {
  const s = rich({ inReach: false });
  assert.equal(chooseBeat(s).beat, 'advance');
  assert.equal(chooseBeat(s, new Set(['advance'])).beat, 'crouch');
  assert.equal(chooseBeat(s, new Set(['advance', 'crouch'])).beat, 'pass');
});

test('the turn terminates: every DECIDE spends, refuses, or ends', () => {
  // Exhaustive walk of the refused-set lattice for a unit with everything
  // live: keep refusing whatever the ladder offers and it must reach `pass`
  // within one refusal per arm - the invariant both shipped stall bugs
  // violated from outside the ladder.
  const everything = rich({
    inReach: false, canPull: true, canTopple: true, canShove: true, canBreak: true,
    canEntrench: true, canShoot: true,
    support: { ap: 2, ready: true }, summon: { ap: 3, ready: true },
  });
  const refused = new Set();
  let steps = 0;
  for (;;) {
    const { beat } = chooseBeat(everything, refused);
    steps += 1;
    assert.ok(steps <= 12, 'the ladder must exhaust within one refusal per arm');
    if (beat === 'pass') break;
    assert.ok(!refused.has(beat), 'a refused arm must never be offered again');
    refused.add(beat);
  }
});

// --- support and the line weights (AI_PLAN M6) -------------------------------

test('triage outranks reinforcement, and rations like everything else', () => {
  const both = rich({ support: { ap: 2, ready: true }, summon: { ap: 3, ready: true } });
  assert.equal(chooseBeat(both).beat, 'support');
  assert.equal(chooseBeat(rich({ support: { ap: 2, ready: false }, summon: { ap: 3, ready: true } })).beat, 'summon');
  assert.equal(chooseBeat(rich({ ap: 1, support: { ap: 2, ready: true } })).beat, 'crouch');
});

test('the worst-off ally in range gets the heal; expiring temps do not', () => {
  const spec = { heal: [4, 7], range: 4 };
  const hurt = { x: 1, z: 0, hp: 5, maxHp: 20, ref: 'hurt' };
  const worse = { x: 2, z: 0, hp: 2, maxHp: 20, ref: 'worse' };
  const fine = { x: 0, z: 1, hp: 19, maxHp: 20, ref: 'fine' };
  const ghost = { x: 1, z: 1, hp: 1, maxHp: 20, expiring: true, ref: 'ghost' };
  const far = { x: 9, z: 9, hp: 1, maxHp: 20, ref: 'far' };
  assert.equal(aiSupportPlan(0, 0, spec, [hurt, worse, fine, ghost, far]).ally.ref, 'worse');
  // Nobody under the threshold in range: no plan, the ladder moves on.
  assert.equal(aiSupportPlan(0, 0, spec, [fine, far]), null);
  // Combat supplies its body-distance and line-of-sight gate, so a more badly
  // hurt ally behind a partition cannot be triaged through it.
  assert.equal(aiSupportPlan(0, 0, spec, [hurt, worse], {
    canSupport: (a) => a.ref !== 'worse',
  }).ally.ref, 'hurt');
  assert.equal(aiSupportPlan(0, 0, spec, [worse], {
    canSupport: () => false,
  }), null);

  // The line weights: a status the target lacks doubles the line's chances;
  // one they already wear rolls flat.
  const pool = [{ min: 1, max: 2 }, { min: 1, max: 2, applies: 'blinded' }];
  assert.deepEqual(lineWeights(pool, () => false), [1, 2]);
  assert.deepEqual(lineWeights(pool, (id) => id === 'blinded'), [1, 1]);
});

test('target selection prices kill-securability and fragility independently', () => {
  const slow = member(2, 0, 8, 8);
  const quick = member(0, 2, 8, 8);
  assert.equal(pickTarget(0, 0, [slow, quick], () => true, {
    focus: 1, expSwings: (m) => (m === quick ? 1 : 4),
  }).member, quick);

  const hale = member(2, 0, 5, 5);
  const frail = member(0, 2, 5, 20);
  assert.equal(pickTarget(0, 0, [hale, frail], () => true, {
    focus: 1, expSwings: () => 2,
  }).member, frail);
});

test('support refuses absent specs, invalid bodies, threshold ties, and blocked lines', () => {
  const wounded = { x: 1, z: 0, hp: 1, maxHp: 10, ref: 'wounded' };
  assert.equal(aiSupportPlan(0, 0, null, [wounded]), null);
  assert.equal(aiSupportPlan(0, 0, { heal: [2, 3], range: 4 }, [
    { ...wounded, maxHp: 0 },
  ]), null);
  assert.equal(aiSupportPlan(0, 0, { heal: [2, 3], range: 4 }, [
    { ...wounded, hp: 5 },
  ]), null);
  assert.equal(aiSupportPlan(0, 0, { heal: [2, 3], range: 4 }, [wounded], {
    canSupport: () => false,
  }), null);
});

// --- the anti-stall contract (REVIEW.md 2026-08-02 sections 1.6 / 1.16) -------

test('a stand tile the unit cannot swing from is not an engagement', () => {
  // The tier that exists so a unit never "walks to the wall and swings at
  // nothing, every turn, forever" was computed by a test blind to exactly that:
  // any walkable neighbour with a route counted, whether or not a swing from it
  // could land. A member in a dead-end bay sealed by a partition read as
  // engageable, so the AI would target them and shuffle at the wall.
  const world = {
    isWalkable: () => true,
    findEnemyPath: (sx, sz, gx, gz) => [[sx, sz], [gx, gz]],
  };
  // Nothing can swing at them from anywhere: no route should come back.
  assert.equal(standTilePath(0, 0, 5, 5, { ...world, canSwingFrom: () => false }), null);
  // One legal swing tile: that is the one we get.
  const only = standTilePath(0, 0, 5, 5,
    { ...world, canSwingFrom: (gx, gz) => gx === 4 && gz === 5 });
  assert.deepEqual(only[only.length - 1], [4, 5]);
});

test('standing beside them but unable to swing is not engagement either', () => {
  // The degenerate self-path is the pacing-bug fix and keeps absolute priority -
  // but only when a swing from where you stand would actually land.
  const world = { isWalkable: () => true, findEnemyPath: () => null };
  assert.equal(standTilePath(4, 5, 5, 5, { ...world, canSwingFrom: () => false }), null);
  assert.deepEqual(standTilePath(4, 5, 5, 5, { ...world, canSwingFrom: () => true }),
    [[4, 5], [4, 5]]);
});

test('a shooter whose shot is blocked from here does not stand still', () => {
  // The mirror defect. firingTileRoutes returned the moment the unit's own tile
  // had range and a line - so a shot refused for any OTHER reason (an object
  // shield, a colleague in the redirect) left the shooter with no candidates,
  // unable to reposition, burning every turn where it stood.
  const world = {
    isWalkable: () => true,
    hasLos: () => true,
    findEnemyPath: (sx, sz, gx, gz) => [[sx, sz], [gx, gz]],
    // The shot works from anywhere EXCEPT where the shooter currently is.
    shotClearAt: (gx, gz) => !(gx === 3 && gz === 0),
  };
  const routes = firingTileRoutes(3, 0, 0, 0, 5, world);
  assert.ok(routes.length > 0, 'a blocked shooter must be offered somewhere to go');
  assert.ok(!routes.some((r) => r.length === 2 && r[0][0] === 3 && r[0][1] === 0
    && r[1][0] === 3 && r[1][1] === 0), 'and not the tile it is stuck on');
});

test('a shooter whose shot IS clear from here stays put', () => {
  // The other half: the self-tile keeps its priority when it works, or the
  // shooter would wander instead of firing.
  const world = {
    isWalkable: () => true,
    hasLos: () => true,
    findEnemyPath: (sx, sz, gx, gz) => [[sx, sz], [gx, gz]],
    shotClearAt: () => true,
  };
  assert.deepEqual(firingTileRoutes(3, 0, 0, 0, 5, world), [[[3, 0], [3, 0]]]);
});

test('a firing field never offers a tile that cannot fire while one can', () => {
  const world = {
    isWalkable: () => true,
    hasLos: () => true,
    findEnemyPath: (sx, sz, gx, gz) => [[sx, sz], [gx, gz]],
    shotClearAt: (gx, gz) => gx === 2 && gz === 0,
  };
  const routes = firingTileRoutes(5, 5, 0, 0, 4, world);
  for (const r of routes) {
    const [gx, gz] = r[r.length - 1];
    assert.ok(gx === 2 && gz === 0, `offered a tile that cannot fire: ${gx},${gz}`);
  }
});

// --- the ladder's input, assembled (REVIEW.md 2026-08-02 item 17) -------------

test('a beat a unit cannot afford is not offered, however good the plan', () => {
  // The gating rule, which used to be spelled out inline in the frame driver
  // where nothing could reach it.
  const s = beatStateFrom({
    ap: 1,
    costs: { topple: 2, pull: 2, shove: 2, break: 3, cover: 1 },
    plans: { topple: {}, pull: {}, shove: {}, break: {} },
  });
  assert.equal(s.canTopple, false);
  assert.equal(s.canPull, false);
  assert.equal(s.canShove, false);
  assert.equal(s.canBreak, false);
  // ...and the ladder agrees. It falls to the crouch, which this unit CAN
  // afford at 1 AP - a boxed-in unit that tucks in is a problem the player has
  // to flank, and it outranks passing precisely because it is not nothing.
  assert.equal(chooseBeat({ ...s, inReach: false, moveBudget: 0, moveCost: 1 }).beat, 'crouch');
  // Take the crouch away too and there is genuinely nothing left.
  assert.equal(chooseBeat({ ...s, inReach: false, moveBudget: 0, moveCost: 1, coverAp: 9 }).beat,
    'pass');
});

test('an affordable beat with no plan is still not offered', () => {
  const s = beatStateFrom({
    ap: 99,
    costs: { topple: 2, pull: 2, shove: 2, break: 3, cover: 1 },
    plans: {},
  });
  assert.equal(s.canTopple, false);
  assert.equal(s.canShove, false);
});

test('affordable AND planned is what makes a beat available', () => {
  const s = beatStateFrom({
    ap: 99,
    costs: { topple: 2, pull: 2, shove: 2, break: 3, cover: 1 },
    plans: { topple: { x: 1 }, shove: { victim: {} } },
  });
  assert.equal(s.canTopple, true);
  assert.equal(s.canShove, true);
  assert.equal(s.canPull, false, 'no pull plan was gathered');
  assert.equal(chooseBeat(s).beat, 'topple', 'and topple outranks shove');
});

test('entrench needs a shot AND a unit not already tucked in', () => {
  const base = { ap: 99, costs: { cover: 1 }, plans: {} };
  assert.equal(beatStateFrom({ ...base, shootable: true }).canEntrench, true);
  assert.equal(beatStateFrom({ ...base, shootable: true, alreadyCrouched: true }).canEntrench,
    false, 'already in cover - crouching again buys nothing');
  assert.equal(beatStateFrom({ ...base, shootable: false }).canEntrench,
    false, 'nothing to entrench FOR');
});

test('support and summon carry their own readiness, not just their price', () => {
  const s = beatStateFrom({
    ap: 99, costs: {}, plans: {},
    support: { ap: 2, ready: false },
    summon: { ap: 3, ready: true },
  });
  assert.deepEqual(s.support, { ap: 2, ready: false });
  assert.deepEqual(s.summon, { ap: 3, ready: true });
  assert.equal(chooseBeat(s).beat, 'summon', 'triage is not ready; the summon is');
});

// --- taking the beat: the PERFORM half ---------------------------------------
// Q005's finding was that this layer had no test at ANY level - not a unit
// test, not an e2e - while two AI bugs had shipped in it. It was unreachable:
// the dispatch lived inside `startCombat`'s closure. It takes its doers as an
// argument now, so every arm can be driven with counters.
//
// A rig that records what each arm did. `doers.crouch` answers whether the
// tuck-in succeeded, which is the one doer whose RETURN steers the dispatch,
// and `doers.break` returns the wait it earned.
const beatRig = (over = {}) => {
  const log = [];
  const doer = (name, ret) => (...args) => { log.push({ name, args }); return ret; };
  const turn = { ap: 10, wait: 0 };
  const refused = new Set();
  const unit = {
    x: 0, z: 0, combat: { attackAp: 2, attacks: ['punch'], reach: REACH.DEFAULT },
  };
  const plans = {
    sup: { ap: 2, cooldownRounds: 3 }, supPlan: { ref: 'colleague' },
    sm: { ap: 3, cooldownRounds: 2 }, shootable: { line: 'staple' },
    tp: { topple: 'cabinet' }, toppleAp: 1,
    pullp: { pull: 'over' }, pullAp: 2,
    shovep: { shove: 'off' }, shoveAp: 1,
    brk: { kind: 'door' }, breakAp: 1,
  };
  const doers = {
    support: doer('support'), summon: doer('summon'), topple: doer('topple'),
    pull: doer('pull'), shove: doer('shove'), break: doer('break', 0.7),
    attack: doer('attack'), shoot: doer('shoot'),
    crouch: doer('crouch', true), advance: doer('advance', 1.5),
    billMove: doer('billMove'), refresh: doer('refresh'), pass: doer('pass'),
    ...over,
  };
  const take = (beat) => takeBeat(beat, {
    turn, plans, unit, target: { id: 'target' }, refused, doers,
    round: (v) => Math.round(v * 10) / 10,
  });
  return { take, log, turn, refused, unit, names: () => log.map((e) => e.name) };
};

test('the support beat rations itself: cooldown, a use, and the AP', () => {
  const r = beatRig();
  r.take('support');
  assert.deepEqual(r.names(), ['support']);
  assert.equal(r.turn.ap, 8, 'billed the triage price');
  assert.equal(r.unit.supportCd, 3, 'and put itself on cooldown');
  assert.equal(r.unit.supportUsed, 1, 'and spent one of its rationed uses');
  assert.equal(r.turn.wait, 0.6);
});

test('the summon beat bills, posts, and repaints', () => {
  const r = beatRig();
  r.take('summon');
  assert.deepEqual(r.names(), ['summon', 'refresh']);
  assert.equal(r.turn.ap, 7);
  assert.equal(r.unit.summonCd, 2);
});

test('the topple and shove beats each bill their own price', () => {
  const t = beatRig();
  t.take('topple');
  assert.deepEqual(t.names(), ['topple', 'refresh']);
  assert.equal(t.turn.ap, 9);
  assert.equal(t.turn.wait, 0.85, 'long enough to outlast the prop going over');

  const s = beatRig();
  s.take('shove');
  assert.deepEqual(s.names(), ['shove', 'refresh']);
  assert.equal(s.turn.ap, 9);
});

test('the break beat takes its wait from what the doer actually did', () => {
  // Opening a door and battering one down are not the same length of pause,
  // and this is the only arm whose wait is the doer's answer.
  const r = beatRig();
  r.take('break');
  assert.equal(r.turn.wait, 0.7);
  assert.equal(r.turn.ap, 9);
});

test('the attack and shoot beats both bill the unit\'s own swing price', () => {
  const a = beatRig();
  a.take('attack');
  assert.deepEqual(a.names(), ['attack']);
  assert.equal(a.turn.ap, 8);

  const s = beatRig();
  s.take('shoot');
  assert.deepEqual(s.log[0], { name: 'shoot', args: [s.unit, { id: 'target' }, { line: 'staple' }] },
    'the line it found is handed to the shot, not re-derived');
  assert.equal(s.turn.ap, 8);
});

test('entrench crouches and bills NOTHING here - the crouch bills itself', () => {
  const r = beatRig();
  r.take('entrench');
  assert.deepEqual(r.names(), ['crouch']);
  assert.equal(r.turn.ap, 10, 'the cover AP is the doer\'s to charge');
  assert.equal(r.turn.wait, 0.5, 'a settle long enough to read the tuck-in');
  assert.equal(r.refused.has('entrench'), false);
});

test('a shieldless entrench refuses itself so the ladder falls to the plain shot', () => {
  // The loop that makes entrench two beats rather than a wasted turn. Nothing
  // animated, so it must not set a wait either - the next frame re-decides.
  const r = beatRig({ crouch: () => false });
  r.take('entrench');
  assert.equal(r.refused.has('entrench'), true);
  assert.equal(r.turn.wait, 0, 'no animation, no pause');
  assert.equal(r.turn.ap, 10);
});

test('an advance that moves bills the distance; one that cannot refuses itself', () => {
  const moved = beatRig();
  moved.take('advance');
  assert.deepEqual(moved.names(), ['advance', 'billMove']);
  assert.equal(moved.log[1].args[0], 1.5, 'billed what the walk actually spent');
  assert.equal(moved.refused.has('advance'), false);

  const stuck = beatRig({ advance: () => 0 });
  stuck.take('advance');
  assert.deepEqual(stuck.names(), [], 'the walk spent nothing, so nothing is billed');
  assert.equal(stuck.refused.has('advance'), true);
  assert.equal(stuck.turn.wait, 0);
});

test('a crouch that finds no shield refuses itself rather than ending the turn', () => {
  const r = beatRig({ crouch: () => false });
  r.take('crouch');
  assert.equal(r.refused.has('crouch'), true);
  assert.equal(r.names().includes('pass'), false, 'refusing is not passing');
});

test('the pass beat is the tail, and only the tail, that ends the turn', () => {
  // Every arm above returns. If one ever stops returning it falls through to
  // here, which is a unit silently ending its turn mid-beat - so the other ten
  // arms are checked for it too.
  const r = beatRig();
  r.take('pass');
  assert.deepEqual(r.names(), ['pass']);
  for (const beat of ['support', 'summon', 'topple', 'pull', 'shove', 'break',
    'attack', 'entrench', 'shoot', 'advance', 'crouch']) {
    const one = beatRig();
    one.take(beat);
    assert.equal(one.names().includes('pass'), false, `${beat} fell through to the pass`);
  }
});

// --- gathering the plans: the DECIDE half ------------------------------------
// `beatStateFrom` has been testable for a while; the step BEFORE it - which
// plans get gathered at what price, and the three flags derived after - was
// closure-bound with everything else.
const COSTS = { topple: 1, pull: 2, shove: 1, cover: 1, move: 0.2 };
const askRig = (over = {}) => ({
  ap: 10,
  moveBudget: 4,
  summonSpec: () => null,
  postableNow: () => 0,
  supportSpec: () => null,
  supportPlan: () => null,
  topplePlan: () => null,
  edgeTopplePlan: () => null,
  pullPlan: () => null,
  shovePlan: () => null,
  breakPlan: () => null,
  canEngage: () => true,
  inReach: () => false,
  crouched: () => false,
  shootable: () => null,
  covered: () => false,
  ...over,
});
const gunner = (over = {}) => ({
  x: 0, z: 0, combat: { attackAp: 2, attacks: ['staple'], reach: REACH.DEFAULT }, def: {}, ...over,
});
const gather = (ask, unit = gunner()) => aiBeatPlansFrom(unit, { id: 'them' }, ask, COSTS);

test('a plan the unit cannot afford is never even gathered', () => {
  // Planning is not free, and a plan it cannot pay for is one the ladder
  // refuses anyway. The pull costs 2 and the shove 1, so at 1 AP exactly one
  // of them is worth asking about.
  const asked = [];
  const ask = askRig({
    ap: 1,
    pullPlan: () => { asked.push('pull'); return { p: 1 }; },
    shovePlan: () => { asked.push('shove'); return { s: 1 }; },
    topplePlan: () => { asked.push('topple'); return { t: 1 }; },
  });
  const out = gather(ask);
  assert.deepEqual(asked.sort(), ['shove', 'topple'], 'the pull is out of budget');
  assert.equal(out.pullp, null);
});

test('a partition is the topple beat\'s fallback, not a separate beat', () => {
  const furniture = gather(askRig({ topplePlan: () => ({ what: 'cabinet' }) }));
  assert.deepEqual(furniture.tp, { what: 'cabinet' });
  const edge = gather(askRig({
    topplePlan: () => null,
    edgeTopplePlan: () => ({ what: 'partition' }),
  }));
  assert.deepEqual(edge.tp, { what: 'partition' }, 'no furniture, so the wall goes over');
});

test('demolition is only planned when nobody can be reached at all', () => {
  // While any route exists, walking it beats knocking a hole in the office.
  let asked = 0;
  const open = gather(askRig({ canEngage: () => true, breakPlan: () => { asked++; return {}; } }));
  assert.equal(asked, 0, 'somebody is engageable - do not even ask');
  assert.equal(open.brk, null);
  const sealed = gather(askRig({ canEngage: () => false, breakPlan: () => ({ kind: 'door', ap: 1 }) }));
  assert.equal(sealed.brk.kind, 'door');
  assert.equal(sealed.breakAp, 1, 'a door is priced at the door\'s own AP');
});

test('battering needs something to swing with; a door handle does not', () => {
  const bare = gunner({ combat: { attackAp: 2, attacks: [], reach: REACH.DEFAULT } });
  const ask = askRig({ canEngage: () => false, breakPlan: () => ({ kind: 'prop' }) });
  const out = aiBeatPlansFrom(bare, { id: 'them' }, ask, COSTS);
  assert.equal(out.brk.kind, 'prop', 'the plan is still reported...');
  assert.equal(out.beatState.canBreak, false, '...but empty hands cannot batter with it');
  // The same empty hands CAN work a handle.
  const door = askRig({ canEngage: () => false, breakPlan: () => ({ kind: 'door', ap: 1 }) });
  assert.equal(aiBeatPlansFrom(bare, { id: 'them' }, door, COSTS).beatState.canBreak, true);
});

test('a shot is only looked for when the unit is out of reach and armed', () => {
  let asked = 0;
  const shot = () => { asked++; return { line: 'staple' }; };
  assert.equal(gather(askRig({ inReach: () => true, shootable: shot })).beatState.canShoot, false);
  assert.equal(asked, 0, 'in melee, the swing is the answer - do not price a shot');
  asked = 0;
  const bare = gunner({ combat: { attackAp: 2, attacks: [], reach: REACH.DEFAULT } });
  aiBeatPlansFrom(bare, { id: 'them' }, askRig({ shootable: shot }), COSTS);
  assert.equal(asked, 0, 'nothing to fire');
  assert.equal(gather(askRig({ shootable: shot })).beatState.canShoot, true);
});

test('entrench needs BOTH halves: a shot in hand and cover to take', () => {
  const both = gather(askRig({ shootable: () => ({ line: 'staple' }), covered: () => true }));
  assert.equal(both.beatState.canEntrench, true);
  const noCover = gather(askRig({ shootable: () => ({ line: 'staple' }), covered: () => false }));
  assert.equal(noCover.beatState.canEntrench, false, 'nothing here shields us');
  assert.equal(noCover.beatState.canShoot, true, 'but the plain shot survives');
  const noShot = gather(askRig({ covered: () => true }));
  assert.equal(noShot.beatState.canEntrench, false, 'cover with nothing to fire is just a crouch');
  assert.equal(noShot.beatState.canCrouch, true);
});

test('a unit already tucked in does not crouch again, and one in melee never does', () => {
  assert.equal(gather(askRig({ covered: () => true, crouched: () => true })).beatState.canCrouch,
    false, 'already behind it');
  assert.equal(gather(askRig({ covered: () => true, inReach: () => true })).beatState.canCrouch,
    false, 'a swing beats cover');
});

test('triage is rationed by uses and paced by cooldown, both read off the unit', () => {
  const sup = { ap: 2, uses: 2, cooldownRounds: 3 };
  const ask = askRig({ supportSpec: () => sup, supportPlan: () => ({ ref: 'colleague' }) });
  assert.equal(gather(ask).beatState.support.ready, true);
  assert.equal(gather(ask, gunner({ supportCd: 1 })).beatState.support.ready, false, 'still cooling');
  assert.equal(gather(ask, gunner({ supportUsed: 2 })).beatState.support.ready, false, 'out of uses');
  // No colleague worth healing: the spec is ready, the PLAN is not.
  const nobody = askRig({ supportSpec: () => sup, supportPlan: () => null });
  assert.equal(gather(nobody).beatState.support.ready, false);
});

test('a maxed-out summoner just fights', () => {
  const sm = { ap: 3, cooldownRounds: 2 };
  const room = askRig({ summonSpec: () => sm, postableNow: () => 2 });
  assert.equal(gather(room).beatState.summon.ready, true);
  const full = askRig({ summonSpec: () => sm, postableNow: () => 0 });
  assert.equal(gather(full).beatState.summon.ready, false, 'nobody left to post');
});
