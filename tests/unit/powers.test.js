// The verb rules (src/powers.js, POWERS_PLAN.md). Pure module, plain objects -
// no scene, no panel, no actors. Everything here is a rule combat.js consults
// rather than re-derives.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buffProblem, buffOutcome, buffRangeOf, isFriendly, BUFF_RANGE,
  controlProblem, controlOutcome, controlIsRanged, isControl,
} from '../../src/powers.js';
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
