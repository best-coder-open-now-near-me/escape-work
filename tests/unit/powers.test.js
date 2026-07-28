// The verb rules (src/powers.js, POWERS_PLAN.md). Pure module, plain objects -
// no scene, no panel, no actors. Everything here is a rule combat.js consults
// rather than re-derives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buffProblem, buffOutcome, buffRangeOf, isFriendly, BUFF_RANGE, controlProblem, controlOutcome, controlIsRanged, isControl, isZone, zoneProblem, zoneTiles, zoneRadiusOf, zoneRangeOf, isMobility, aimsAtAlly, mobilityProblem, mobilityRangeOf, dashDistanceOf, isStance, watchRadiusOf, watchTriggers, isToppleable, toppleLanding, aimsAtAnyone } from '../../src/powers.js';
import { TILE_TYPES } from '../../src/data/tiles.js';
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

test('every toppleable prop names a fallen twin that is cover, not a wall', () => {
  for (const [id, def] of Object.entries(TILE_TYPES)) {
    if (!def.topple) continue;
    const twin = TILE_TYPES[def.topple.becomes];
    assert.ok(twin, `${id} topples into a real tile`);
    // The barrier is a TACTICAL barrier. A solid twin would let a shove spawn
    // impassable terrain, seal a doorway, and strand a fight the enemy can no
    // longer reach - the wall the design explicitly refused.
    assert.notEqual(twin.solid, true, `${def.topple.becomes} is not solid`);
    assert.equal(twin.cover, true, `${def.topple.becomes} grants cover`);
    assert.equal(twin.runtimeOnly, true, `${def.topple.becomes} costs no map character`);
    assert.equal(twin.surface, 'debris', `${def.topple.becomes} carries the clamber cost as a surface`);
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
