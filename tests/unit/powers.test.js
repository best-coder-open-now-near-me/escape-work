// The verb rules (src/powers.js, POWERS_PLAN.md). Pure module, plain objects -
// no scene, no panel, no actors. Everything here is a rule combat.js consults
// rather than re-derives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buffProblem, buffOutcome, buffRangeOf, isFriendly, BUFF_RANGE, controlProblem, controlOutcome, controlIsRanged, isControl, isZone, zoneProblem, zoneTiles, zoneRadiusOf, zoneRangeOf, isMobility, aimsAtAlly, mobilityProblem, mobilityRangeOf, dashDistanceOf, isStance, watchRadiusOf, watchTriggers, isToppleable, toppleLanding, aimsAtAnyone, coneFrom, conePolyline, aimRangeOf, rangeTiles, isBreakable, aimsAtProps, isPull, pullLanding } from '../../src/powers.js';
import { TILE_TYPES, blocksSight } from '../../src/data/tiles.js';
import { ACTIONS } from '../../src/data/actions.js';
import { STATUSES } from '../../src/data/statuses.js';

// A healthy ally, in range, with a clear line and the AP to pay.
const ok = (over = {}) => ({
  dist: 1, los: true, hp: 5, maxHp: 20, statusCount: 0, ap: 10, usesLeft: 2, ...over,
});
const HEAL = { type: 'buff', ap: 2, label: 'Test Heal', amount: 4 };
const CLEANSE = { type: 'buff', ap: 2, label: 'Test Cleanse', purge: true };
const STATUS = { type: 'buff', ap: 2, label: 'Test Status', applies: 'commended' };

test('buffRangeOf defaults, and an action may override it', () => {
  assert.equal(buffRangeOf({}), BUFF_RANGE);
  assert.equal(buffRangeOf({ range: 2 }), 2);
});

test('isFriendly is true only for the buff verb', () => {
  assert.equal(isFriendly({ type: 'buff' }), true);
  assert.equal(isFriendly({ type: 'attack' }), false);
  assert.equal(isFriendly({ type: 'heal' }), false); // self-only, not friendly-TARGETED
  assert.equal(isFriendly(null), false);
});

test('a legal buff has no problem', () => {
  assert.equal(buffProblem(HEAL, ok()), null);
  assert.equal(buffProblem(STATUS, ok()), null);
  assert.equal(buffProblem(CLEANSE, ok({ statusCount: 1 })), null);
});

test('AP and uses are checked before anything else', () => {
  assert.match(buffProblem(HEAL, ok({ ap: 1 })), /AP/);
  assert.match(buffProblem(HEAL, ok({ usesLeft: 0 })), /left this fight/);
  // usesLeft null means "not a rationed action" - it must not read as zero.
  assert.equal(buffProblem(HEAL, ok({ usesLeft: null })), null);
});

test('range uses the action override, not just the default', () => {
  assert.equal(buffProblem(HEAL, ok({ dist: BUFF_RANGE })), null);
  assert.match(buffProblem(HEAL, ok({ dist: BUFF_RANGE + 1 })), /Too far/);
  assert.match(buffProblem({ ...HEAL, range: 1 }, ok({ dist: 2 })), /Too far/);
});

test('line of sight is required', () => {
  assert.match(buffProblem(HEAL, ok({ los: false })), /No clear line/);
});

test('the downed are a revive problem, not a buff problem', () => {
  assert.match(buffProblem(HEAL, ok({ hp: 0 })), /down/);
  // ...and that beats the range/line complaints, so the message names the
  // reason the player can actually act on.
  assert.match(buffProblem(HEAL, ok({ hp: 0, dist: 99, los: false })), /down/);
});

test('a buff that would do nothing is refused BEFORE it spends the AP', () => {
  // A pure heal on a full-health ally.
  assert.match(buffProblem(HEAL, ok({ hp: 20, maxHp: 20 })), /full health/);
  // A pure cleanse on someone carrying nothing.
  assert.match(buffProblem(CLEANSE, ok({ statusCount: 0 })), /Nothing to clear/);
});

test('a buff with a status payload always has something to do', () => {
  // Even at full HP and running clean: re-applying refreshes the duration,
  // which is a legitimate thing to spend a turn on.
  assert.equal(buffProblem(STATUS, ok({ hp: 20, maxHp: 20, statusCount: 0 })), null);
});

test('a mixed buff is legal if ANY of its payloads would land', () => {
  const mixed = { ...HEAL, purge: true };
  // Full HP but carrying a status: the cleanse still does something.
  assert.equal(buffProblem(mixed, ok({ hp: 20, maxHp: 20, statusCount: 2 })), null);
  // Hurt but running clean: the heal still does something.
  assert.equal(buffProblem(mixed, ok({ hp: 5, maxHp: 20, statusCount: 0 })), null);
  // Neither: refused.
  assert.ok(buffProblem(mixed, ok({ hp: 20, maxHp: 20, statusCount: 0 })));
});

test('buffOutcome clamps the heal to maxHp', () => {
  assert.equal(buffOutcome(HEAL, { hp: 18, maxHp: 20 }).healed, 2);
  assert.equal(buffOutcome(HEAL, { hp: 5, maxHp: 20 }).healed, 4);
  assert.equal(buffOutcome(HEAL, { hp: 20, maxHp: 20 }).healed, 0);
  assert.equal(buffOutcome(STATUS, { hp: 5, maxHp: 20 }).healed, 0);
});

test('buffOutcome reports the non-numeric payloads', () => {
  assert.equal(buffOutcome(CLEANSE, { hp: 5, maxHp: 20 }).purges, true);
  assert.equal(buffOutcome(HEAL, { hp: 5, maxHp: 20 }).purges, false);
  assert.equal(buffOutcome(STATUS, { hp: 5, maxHp: 20 }).applies, 'commended');
  assert.equal(buffOutcome(HEAL, { hp: 5, maxHp: 20 }).applies, null);
});

// --- control (POWERS_PLAN M2) -----------------------------------------------

const TOUCH = { type: 'control', ap: 2, label: 'Test Touch', applies: 'stunned' };
const THROWN = { type: 'control', ap: 2, label: 'Test Thrown', applies: 'detained', range: 5 };
const CONE = { type: 'control', ap: 3, label: 'Test Cone', applies: 'detained', cone: { range: 4, halfAngle: 40 } };
const target = (over = {}) => ({ dist: 1, los: true, inReach: true, ap: 10, usesLeft: 2, alive: true, ...over });

test('isControl and controlIsRanged classify the shapes', () => {
  assert.equal(isControl(TOUCH), true);
  assert.equal(isControl({ type: 'attack' }), false);
  assert.equal(controlIsRanged(TOUCH), false); // touch range
  assert.equal(controlIsRanged(THROWN), true); // carries a range
  assert.equal(controlIsRanged(CONE), true); // a wedge is thrown too
});

test('a legal control has no problem', () => {
  assert.equal(controlProblem(TOUCH, target()), null);
  assert.equal(controlProblem(THROWN, target()), null);
});

test('AP, uses and a live target gate a control', () => {
  assert.match(controlProblem(TOUCH, target({ ap: 1 })), /AP/);
  assert.match(controlProblem(TOUCH, target({ usesLeft: 0 })), /left this fight/);
  assert.match(controlProblem(TOUCH, target({ alive: false })), /already down/);
});

test('a THROWN control needs the range and the line', () => {
  assert.equal(controlProblem(THROWN, target({ dist: 5 })), null);
  assert.match(controlProblem(THROWN, target({ dist: 6 })), /Too far/);
  assert.match(controlProblem(THROWN, target({ los: false })), /No clear line/);
});

test('a TOUCH control out of reach is not a refusal - the click walks you in', () => {
  // The melee swing already behaves this way; a control that refused instead
  // would be the one arm's-length action in the game that will not approach.
  assert.equal(controlProblem(TOUCH, target({ inReach: false })), null);
  // ...and being far away does not invoke the thrown range check either.
  assert.equal(controlProblem(TOUCH, target({ inReach: false, dist: 9, los: false })), null);
});

test('controlOutcome reports the payload', () => {
  assert.equal(controlOutcome(TOUCH).applies, 'stunned');
  assert.equal(controlOutcome(TOUCH).displace, 0);
  assert.equal(controlOutcome({ ...TOUCH, displace: 1 }).displace, 1);
});

test('every shipped control deals NO damage and carries a payload', () => {
  for (const [id, a] of Object.entries(ACTIONS)) {
    if (a.type !== 'control') continue;
    // The design rule (POWERS_PLAN #3): a power that stuns AND hits is two
    // powers, and the AP economy cannot price both. A `min`/`max` on a control
    // would be silently ignored by performControl, which is worse than wrong.
    assert.equal(a.min, undefined, `${id} rolls no damage`);
    assert.equal(a.max, undefined, `${id} rolls no damage`);
    assert.ok(a.applies || a.displace, `${id} carries a payload`);
    if (a.applies) assert.ok(STATUSES[a.applies], `${id} applies a real status (${a.applies})`);
  }
});

test('turn-denying controls reuse `stunned`, so they inherit the anti-chain window', () => {
  // The rule that keeps control from becoming a second, parallel way to lock
  // someone out of a fight: anything that DENIES A TURN must be the status the
  // window already guards, not a new one that skips it.
  for (const [id, a] of Object.entries(ACTIONS)) {
    if (a.type !== 'control' || !a.applies) continue;
    const def = STATUSES[a.applies];
    if (!def?.effects?.skipTurn) continue;
    assert.equal(a.applies, 'stunned', `${id} denies a turn, so it must apply 'stunned'`);
    assert.ok(def.immunity, "'stunned' carries an anti-chain window");
  }
});

test('a root is not a stun', () => {
  const detained = STATUSES.detained;
  assert.ok(detained, 'detained exists');
  assert.equal(detained.effects.rooted, true);
  // A root costs you the ground, not the turn - if it ever also skipped the
  // turn it would need the anti-chain window, and the test above would say so.
  assert.notEqual(detained.effects.skipTurn, true);
});

// --- zone (POWERS_PLAN M3) --------------------------------------------------

const ZONE = { type: 'zone', ap: 2, label: 'Test Zone', leaves: 'paper', radius: 1.5, range: 5, uses: 2 };

test('isZone, and the zone defaults', () => {
  assert.equal(isZone(ZONE), true);
  assert.equal(isZone({ type: 'attack' }), false);
  assert.equal(zoneRadiusOf({}), 1);
  assert.equal(zoneRangeOf({}), 5);
  assert.equal(zoneRadiusOf(ZONE), 1.5);
});

test('zoneTiles is a DISC, not the bounding square', () => {
  // radius 1: the centre and its four orthogonal neighbours. The diagonals sit
  // at 1.41, outside it - a square footprint would carpet corners the player
  // can plainly see are further away than tiles the ring leaves out.
  const r1 = zoneTiles(0, 0, 1);
  assert.equal(r1.length, 5);
  assert.ok(r1.some(([x, z]) => x === 0 && z === 0));
  assert.ok(r1.some(([x, z]) => x === 1 && z === 0));
  assert.ok(!r1.some(([x, z]) => x === 1 && z === 1), 'the diagonal is outside radius 1');
  // radius 1.5 reaches the diagonals (1.41) but not two tiles out.
  const r15 = zoneTiles(0, 0, 1.5);
  assert.ok(r15.some(([x, z]) => x === 1 && z === 1));
  assert.ok(!r15.some(([x, z]) => x === 2 && z === 0));
  assert.equal(r15.length, 9);
});

test('zoneTiles is centred where you aimed it', () => {
  const cells = zoneTiles(4, 7, 1);
  assert.ok(cells.some(([x, z]) => x === 4 && z === 7));
  assert.ok(cells.every(([x, z]) => Math.hypot(x - 4, z - 7) <= 1 + 1e-9));
});

test('a zone is gated by AP, uses, range and line', () => {
  const t = (over = {}) => ({ dist: 1, los: true, ap: 10, usesLeft: 2, ...over });
  assert.equal(zoneProblem(ZONE, t()), null);
  assert.match(zoneProblem(ZONE, t({ ap: 1 })), /AP/);
  assert.match(zoneProblem(ZONE, t({ usesLeft: 0 })), /left this fight/);
  assert.equal(zoneProblem(ZONE, t({ dist: 5 })), null);
  assert.match(zoneProblem(ZONE, t({ dist: 6 })), /Too far/);
  assert.match(zoneProblem(ZONE, t({ los: false })), /No clear line/);
});

test('every shipped zone paints a real surface tile', () => {
  for (const [id, a] of Object.entries(ACTIONS)) {
    if (a.type !== 'zone') continue;
    assert.ok(a.leaves, `${id} names what it leaves`);
    assert.ok(TILE_TYPES[a.leaves], `${id} leaves a real tile (${a.leaves})`);
    // A zone that painted a plain tile would spend a turn changing the floor's
    // colour. The point of the verb is the SURFACE layer underneath.
    assert.ok(TILE_TYPES[a.leaves].surface, `${id} leaves a tile carrying a surface`);
  }
});

// --- mobility (POWERS_PLAN M4) ----------------------------------------------

const DASH = { type: 'mobility', mode: 'dash', ap: 2, label: 'Test Dash', distance: 5 };
const SWAP = { type: 'mobility', mode: 'swap', ap: 2, label: 'Test Swap', range: 6, uses: 2 };

test('isMobility, and the mobility defaults', () => {
  assert.equal(isMobility(DASH), true);
  assert.equal(isMobility({ type: 'attack' }), false);
  assert.equal(dashDistanceOf(DASH), 5);
  assert.equal(dashDistanceOf({}), 4);
  assert.equal(mobilityRangeOf(SWAP), 6);
  assert.equal(mobilityRangeOf({}), 5);
});

test('aimsAtAlly covers buffs and the ally-moving modes, not a dash', () => {
  assert.equal(aimsAtAlly(HEAL), true); // a buff always points at a friend
  assert.equal(aimsAtAlly(SWAP), true); // swap moves a teammate
  assert.equal(aimsAtAlly(DASH), false); // a dash points at the floor
  assert.equal(aimsAtAlly({ type: 'attack' }), false);
});

test('a dash is gated by AP and uses ONLY - where it lands is pathing', () => {
  assert.equal(mobilityProblem(DASH, { ap: 10 }), null);
  assert.match(mobilityProblem(DASH, { ap: 1 }), /AP/);
  assert.match(mobilityProblem({ ...DASH, uses: 1 }, { ap: 10, usesLeft: 0 }), /left this fight/);
  // A dash never consults range or line: it is a route, and routes are the
  // world's business. Handing it a hopeless aim must not refuse it here.
  assert.equal(mobilityProblem(DASH, { ap: 10, dist: 99, los: false }), null);
});

test('a swap needs a living teammate, in range, in sight', () => {
  const t = (over = {}) => ({ dist: 1, los: true, ap: 10, usesLeft: 2, allyHp: 5, ...over });
  assert.equal(mobilityProblem(SWAP, t()), null);
  assert.equal(mobilityProblem(SWAP, t({ dist: 6 })), null);
  assert.match(mobilityProblem(SWAP, t({ dist: 7 })), /Too far/);
  assert.match(mobilityProblem(SWAP, t({ los: false })), /No clear line/);
  assert.match(mobilityProblem(SWAP, t({ allyHp: 0 })), /down/);
});

test('every shipped mobility action declares a mode the runtime knows', () => {
  for (const [id, a] of Object.entries(ACTIONS)) {
    if (a.type !== 'mobility') continue;
    assert.ok(['dash', 'swap'].includes(a.mode), `${id} has a known mode (got "${a.mode}")`);
    // A mode the dispatch does not recognise would arm, aim, and then do
    // nothing - the silent class of failure this lint exists to catch.
    if (a.mode === 'dash') assert.ok(dashDistanceOf(a) > 0, `${id} carries a distance`);
  }
});

// --- stance (POWERS_PLAN M5) ------------------------------------------------

const WATCH = { type: 'stance', mode: 'watch', ap: 2, label: 'Test Watch', radius: 4 };
const mover = (over = {}) => ({
  dist: 2, los: true, hasReaction: true, sameSide: false, moverStanding: true, ...over,
});

test('isStance, and the watch radius default', () => {
  assert.equal(isStance(WATCH), true);
  assert.equal(isStance({ type: 'defend' }), false);
  assert.equal(watchRadiusOf(WATCH), 4);
  assert.equal(watchRadiusOf({}), 3);
});

test('overwatch fires on a hostile mover inside the radius, in sight', () => {
  assert.equal(watchTriggers(WATCH, mover()), true);
  assert.equal(watchTriggers(WATCH, mover({ dist: 4 })), true); // the edge counts
  assert.equal(watchTriggers(WATCH, mover({ dist: 5 })), false);
  assert.equal(watchTriggers(WATCH, mover({ los: false })), false);
});

test('overwatch never fires on your own side', () => {
  // Otherwise a guard covering a doorway would shoot the teammate who walked
  // through it - and the party moves through its own watcher's radius
  // constantly.
  assert.equal(watchTriggers(WATCH, mover({ sameSide: true })), false);
});

test('overwatch needs the reaction it shares with opportunity attacks', () => {
  // The shared budget is what stops a watcher from getting two free swings on
  // one mover in a round: an opportunity attack that already fired leaves no
  // reaction for the stance, and vice versa.
  assert.equal(watchTriggers(WATCH, mover({ hasReaction: false })), false);
});

test('overwatch does not fire on a mover already down', () => {
  assert.equal(watchTriggers(WATCH, mover({ moverStanding: false })), false);
});

test('every shipped stance declares a mode the runtime knows', () => {
  for (const [id, a] of Object.entries(ACTIONS)) {
    if (a.type !== 'stance') continue;
    // 'watch' spends the reaction on somebody crossing the line; 'guard' pays
    // out as cover on the holder's own tile. They share the held-posture
    // bookkeeping and the lapse rule, and nothing else - a third mode string
    // would arm, sit there, and never do anything.
    assert.ok(['watch', 'guard'].includes(a.mode), `${id} has a known mode (got "${a.mode}")`);
    if (a.mode === 'watch') assert.ok(watchRadiusOf(a) > 0, `${id} watches some ground`);
  }
});

test('both stance chips are visible state, not rules', () => {
  for (const id of ['watching', 'guarding']) {
    const def = STATUSES[id];
    assert.ok(def, `${id} exists`);
    assert.equal(def.harmful, false);
    assert.deepEqual(def.effects, {}, `${id} carries no effects - the rule lives in combat`);
  }
});

test('the overwatch status is visible state, not a rule', () => {
  const def = STATUSES.watching;
  assert.ok(def, 'watching exists');
  assert.equal(def.harmful, false);
  // The rule lives in combat's reaction budget and a sightline, neither of
  // which the effect vocabulary can express. If this ever grows effects, the
  // stance has quietly become two implementations.
  assert.deepEqual(def.effects, {});
});

// --- toppling (POWERS_PLAN M6) ----------------------------------------------

test('isToppleable reads the descriptor', () => {
  assert.equal(isToppleable(TILE_TYPES.cabinet), true);
  assert.equal(isToppleable(TILE_TYPES.floor), false);
  assert.equal(isToppleable(undefined), false);
  // A desk deliberately does NOT topple: it is the cover the levels are
  // already built around, and making the most-painted prop in the game mutable
  // would rewrite every floor's tactical read on contact.
  assert.equal(isToppleable(TILE_TYPES.desk), false);
});

test('a prop falls directly AWAY from whoever pushed it', () => {
  // attacker west of the prop -> it lands east
  assert.deepEqual(toppleLanding(1, 5, 2, 5), [3, 5]);
  // attacker east -> it lands west
  assert.deepEqual(toppleLanding(3, 5, 2, 5), [1, 5]);
  // attacker north -> it lands south
  assert.deepEqual(toppleLanding(4, 1, 4, 2), [4, 3]);
  // diagonals carry both components
  assert.deepEqual(toppleLanding(0, 0, 1, 1), [2, 2]);
});

test('a prop you are standing on has nowhere to fall', () => {
  assert.equal(toppleLanding(2, 2, 2, 2), null);
});

test('the landing is one tile, however far away the pusher is', () => {
  // Direction is a SIGN, not a vector: shoving from across the room (which
  // nothing can do today, but the AI's scoring will ask about) must not
  // launch the bookcase five tiles.
  assert.deepEqual(toppleLanding(0, 5, 6, 5), [7, 5]);
});

test('every fallen twin still shields, whichever shape it fell into', () => {
  // Revised with TACTICS_PLAN M6 (designer, 2026-07-30): a chunky twin is an
  // object on its side - SOLID, low, shot over, granting cover through the
  // M6a height rule - while a flat one (the coat rack) stays walkable debris
  // with the explicit `cover` flag the height rule cannot derive for a
  // non-solid. Either way, the tile a topple leaves must shield whoever
  // stands behind it, and must never block sight: the sealed-pocket
  // stalemate the old non-solid rule guarded against stays impossible
  // because everything fallen can be thrown over.
  for (const [id, def] of Object.entries(TILE_TYPES)) {
    if (!def.topple) continue;
    const twin = TILE_TYPES[def.topple.becomes];
    assert.ok(twin, `${id} topples into a real tile`);
    assert.equal(twin.runtimeOnly, true, `${def.topple.becomes} costs no map character`);
    assert.equal(blocksSight(twin), false, `${def.topple.becomes} is shot over`);
    const shields = twin.cover === true || twin.solid === true;
    assert.equal(shields, true, `${def.topple.becomes} shields whoever crouches behind it`);
    if (!twin.solid) {
      assert.equal(twin.surface, 'debris',
        `${def.topple.becomes} is walkable, so it carries the clamber cost as a surface`);
    }
  }
});

// --- the shipped content honors the verb ------------------------------------

test('every shipped buff action is well formed', () => {
  for (const [id, a] of Object.entries(ACTIONS)) {
    if (a.type !== 'buff') continue;
    assert.ok(a.label, `${id} has a label`);
    assert.ok(a.ap > 0, `${id} costs AP`);
    // A buff with no payload at all is a button that spends a turn to do
    // nothing - the failure buffProblem can only report at runtime.
    assert.ok(a.amount || a.purge || a.applies, `${id} carries a payload`);
    if (a.applies) assert.ok(STATUSES[a.applies], `${id} applies a real status (${a.applies})`);
  }
});

test('the statuses buffs apply are helpful and unresistable', () => {
  for (const id of ['commended', 'onboarded']) {
    const def = STATUSES[id];
    assert.ok(def, `${id} exists`);
    assert.equal(def.harmful, false, `${id} is a buff`);
    // Composure must not blunt a favour: resisting help would make the most
    // composed member of the party the hardest one to support.
    assert.equal(def.resistable, false, `${id} is not resistable`);
  }
});

// --- any-target verbs (TODO Phase 2) ---------------------------------------
// Reboot power-cycles anyone: yourself, a colleague, or a coworker. "Which side
// does this verb point at" therefore stopped being a boolean, and the two
// predicates had to come apart - isFriendly means "friends ONLY", aimsAtAlly
// means "MAY be pointed at a friend".
test('a purge that is not a buff aims at anyone, and at allies too', () => {
  const reboot = ACTIONS.reboot;
  assert.equal(aimsAtAnyone(reboot), true, 'reboot points at both halves');
  assert.equal(aimsAtAlly(reboot), true, 'so a click on a colleague must reach it');
  assert.equal(isFriendly(reboot), false, 'but it is not a friends-only verb');
});

test('a buff is still friends-only, and an ordinary attack is neither', () => {
  const buff = ACTIONS['performance-review'];
  assert.equal(isFriendly(buff), true);
  assert.equal(aimsAtAlly(buff), true);
  assert.equal(aimsAtAnyone(buff), false, 'a buff must never be offered on a coworker');

  const swing = ACTIONS.attack;
  assert.equal(aimsAtAlly(swing), false);
  assert.equal(aimsAtAnyone(swing), false);
});

test('reboot carries no damage dice - it is a pure effect', () => {
  // performOn reads the ABSENCE of min/max as "resolve this as an effect".
  // It used to carry 4-7 damage, contradicting its own description, and
  // deleting the dice without that rule would have rolled NaN.
  assert.equal(ACTIONS.reboot.min, undefined);
  assert.equal(ACTIONS.reboot.max, undefined);
  assert.equal(ACTIONS.reboot.purge, true);
});

// --- cone geometry (TODO Phase 5) ------------------------------------------
// Extracted from a closure inside combat.js, which is why aiming a cone OUT of
// combat drew nothing at all: the geometry was unreachable from there. Pure and
// origin-taking now, so both previews draw the same shape - and so it can be
// tested without a scene at all, which it never could before.
const WEDGE = { cone: { range: 4, halfAngle: 35 } };
const CASTER = { x: 0, z: 0 };

test('coneFrom covers what is in front and not what is behind', () => {
  const test = coneFrom(WEDGE, CASTER, 1, 0); // aimed along +x
  assert.ok(test, 'a real aim produces a wedge');
  assert.equal(test(3, 0), true, 'straight ahead, in range');
  assert.equal(test(-3, 0), false, 'directly behind');
  assert.equal(test(9, 0), false, 'ahead but past the range');
  // Just inside and just outside the half-angle, at a distance where the
  // arithmetic is unambiguous.
  const rad = (deg) => (deg * Math.PI) / 180;
  assert.equal(test(3 * Math.cos(rad(30)), 3 * Math.sin(rad(30))), true, 'inside 35 degrees');
  assert.equal(test(3 * Math.cos(rad(50)), 3 * Math.sin(rad(50))), false, 'outside 35 degrees');
});

test('a body RADIUS widens the wedge, so a clipped target counts', () => {
  const test = coneFrom(WEDGE, CASTER, 1, 0);
  const rad = (deg) => (deg * Math.PI) / 180;
  const [x, z] = [3 * Math.cos(rad(40)), 3 * Math.sin(rad(40))];
  assert.equal(test(x, z), false, 'its centre is outside the wedge...');
  assert.equal(test(x, z, 0.9), true, '...but the body it stands in is clipped');
});

test('coneFrom refuses an aim on top of the caster', () => {
  // No meaningful direction - and the old code returned null here for exactly
  // this reason, so the wedge never pointed somewhere arbitrary.
  assert.equal(coneFrom(WEDGE, CASTER, 0.05, 0.05), null);
});

test('conePolyline closes the wedge back to its origin', () => {
  const test = coneFrom(WEDGE, CASTER, 1, 0);
  const line = conePolyline(WEDGE, test);
  assert.deepEqual(line[0], [CASTER.x, CASTER.z], 'starts at the caster');
  assert.deepEqual(line[line.length - 1], [CASTER.x, CASTER.z], 'and returns there');
  // Every arc point sits on the range circle - the outline is the wedge, not
  // an approximation of it.
  for (const [x, z] of line.slice(1, -1)) {
    assert.ok(Math.abs(Math.hypot(x, z) - WEDGE.cone.range) < 1e-9);
  }
});


// --- aiming (TACTICS_PLAN M7) --------------------------------------------------

test('aimRangeOf mirrors each verb\'s own range rule', () => {
  assert.equal(aimRangeOf(null), null);
  assert.equal(aimRangeOf({ type: 'attack', ap: 1 }), null); // melee: the reach ring is the affordance
  assert.deepEqual(aimRangeOf({ type: 'attack', range: 5 }), { r: 5 });
  assert.deepEqual(aimRangeOf({ type: 'attack', cone: { range: 4, halfAngle: 30 } }),
    { r: 4, euclid: true });
  assert.deepEqual(aimRangeOf({ type: 'zone' }), { r: zoneRangeOf({ type: 'zone' }) });
  assert.equal(aimRangeOf({ type: 'mobility', mode: 'dash', distance: 5 }), null); // trail previews a dash
  assert.deepEqual(aimRangeOf({ type: 'mobility', mode: 'swap', range: 6 }), { r: 6 });
  assert.deepEqual(aimRangeOf({ type: 'buff' }), { r: BUFF_RANGE }); // the buff default, not a guess
  assert.deepEqual(aimRangeOf({ type: 'control', range: 5 }), { r: 5 });
  assert.equal(aimRangeOf({ type: 'control' }), null); // touch control walks you in
});

test('rangeTiles paints the Chebyshev square, minus what canSee refuses', () => {
  const all = rangeTiles(0, 0, 2, () => true);
  assert.equal(all.length, 25); // 5x5, origin included - the ground under your feet is yours
  const seen = rangeTiles(0, 0, 2, (x) => x >= 0);
  assert.equal(seen.length, 15);
  assert.ok(seen.every(([x]) => x >= 0), 'a refused tile never paints');
});

test('rangeTiles euclid trims the corners a true radius cannot reach', () => {
  const disc = rangeTiles(0, 0, 2, () => true, true);
  assert.equal(disc.length, 13); // r=2 disc on tile centres
  assert.ok(disc.some(([x, z]) => x === 2 && z === 0));
  assert.ok(!disc.some(([x, z]) => x === 2 && z === 2), 'hypot(2,2) is out of a cone\'s range');
});

// --- destructible cover & Pull Over (TACTICS_PLAN M8) -------------------------

test('isBreakable marks exactly the cover-grade set', () => {
  const withHp = Object.entries(TILE_TYPES).filter(([, d]) => Number.isFinite(d.hp)).map(([id]) => id);
  // The set the designer ratified: partitions (their pool lives in
  // PARTITION_HP, not here), the five toppleable props, and their fallen
  // twins - the flat partition board excepted (walkable, nothing to deny).
  assert.deepEqual(withHp.sort(), [
    'bookcase', 'bookcase-fallen', 'bookcase-wide', 'bookcase-wide-fallen',
    'bookshelf', 'bookshelf-fallen', 'cabinet', 'cabinet-fallen',
    'coat-rack', 'coat-rack-fallen',
  ]);
  for (const id of withHp) assert.ok(isBreakable(TILE_TYPES[id]));
  assert.ok(!isBreakable(TILE_TYPES.desk), 'a loot desk is not cover-grade');
  assert.ok(!isBreakable(TILE_TYPES.wall));
  assert.ok(!isBreakable(null));
  // Everything a topple produces that still blocks or covers is breakable
  // too - full tile denial is topple-then-destroy, two actions' effort.
  for (const [, d] of Object.entries(TILE_TYPES)) {
    if (!d.topple) continue;
    assert.ok(Number.isFinite(TILE_TYPES[d.topple.becomes].hp) || d.topple.becomes === 'partition-fallen');
  }
});

test('aimsAtProps admits only the damage-rolling attack', () => {
  assert.ok(aimsAtProps(ACTIONS.attack));
  assert.ok(aimsAtProps(ACTIONS.punch));
  assert.ok(!aimsAtProps(ACTIONS.shove), 'shove keeps its own prop path (the topple)');
  assert.ok(!aimsAtProps(ACTIONS['take-cover']));
  assert.ok(!aimsAtProps(ACTIONS.pull));
  assert.ok(!aimsAtProps({ type: 'attack' }), 'no dice, no demolition');
  assert.ok(!aimsAtProps(null));
});

test('pull is universal data: type, crush range, and a real icon', () => {
  const a = ACTIONS.pull;
  assert.ok(isPull(a));
  assert.equal(a.type, 'pull');
  assert.ok(Array.isArray(a.crush) && a.crush.length === 2 && a.crush[0] <= a.crush[1]);
  assert.ok(a.icon && a.icon !== '❔');
});

test('pullLanding lands them beside the puller, nearest where they came from', () => {
  // Puller at (2,0), target crouched at (0,0) behind a shield on (1,0):
  // the shield tile is not open, so the haul dumps them on the puller's
  // flank nearest the barrier - never the puller's own tile.
  const open = (x, z) => !(x === 1 && z === 0) && !(x === 2 && z === 0);
  const spot = pullLanding(2, 0, 0, 0, open);
  assert.ok(spot, 'a free flank exists');
  assert.ok(!(spot[0] === 2 && spot[1] === 0), 'never onto the puller');
  assert.ok(!(spot[0] === 0 && spot[1] === 0), 'never back where they were');
  assert.equal(Math.abs(spot[0] - 2) + Math.abs(spot[1] - 0), 1, 'orthogonal beside the puller');
});

test('pullLanding refuses when your side has no room', () => {
  assert.equal(pullLanding(2, 0, 0, 0, () => false), null);
});

test('pullLanding never returns the tile the target already holds', () => {
  // Edge crouch: target at (0,0), puller adjacent at (1,0) across the edge.
  // (0,0) is "open" by the caller's test (the target is leaving it), but the
  // landing must still not be it - that would be a pull to nowhere.
  const spot = pullLanding(1, 0, 0, 0, () => true);
  assert.ok(spot);
  assert.ok(!(spot[0] === 0 && spot[1] === 0));
});
