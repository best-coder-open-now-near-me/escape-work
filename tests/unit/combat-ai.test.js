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

test('the worst-off ally in range gets the heal; expiring temps do not', async () => {
  const { aiSupportPlan, lineWeights } = await import('../../src/combat-ai.js');
  const spec = { heal: [4, 7], range: 4 };
  const hurt = { x: 1, z: 0, hp: 5, maxHp: 20, ref: 'hurt' };
  const worse = { x: 2, z: 0, hp: 2, maxHp: 20, ref: 'worse' };
  const fine = { x: 0, z: 1, hp: 19, maxHp: 20, ref: 'fine' };
  const ghost = { x: 1, z: 1, hp: 1, maxHp: 20, expiring: true, ref: 'ghost' };
  const far = { x: 9, z: 9, hp: 1, maxHp: 20, ref: 'far' };
  assert.equal(aiSupportPlan(0, 0, spec, [hurt, worse, fine, ghost, far]).ally.ref, 'worse');
  // Nobody under the threshold in range: no plan, the ladder moves on.
  assert.equal(aiSupportPlan(0, 0, spec, [fine, far]), null);

  // The line weights: a status the target lacks doubles the line's chances;
  // one they already wear rolls flat.
  const pool = [{ min: 1, max: 2 }, { min: 1, max: 2, applies: 'blinded' }];
  assert.deepEqual(lineWeights(pool, () => false), [1, AI.STATUS_WEIGHT]);
  assert.deepEqual(lineWeights(pool, (id) => id === 'blinded'), [1, 1]);
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
