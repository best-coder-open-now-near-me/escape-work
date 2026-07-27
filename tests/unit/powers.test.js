// The verb rules (src/powers.js, POWERS_PLAN.md). Pure module, plain objects -
// no scene, no panel, no actors. Everything here is a rule combat.js consults
// rather than re-derives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buffProblem, buffOutcome, buffRangeOf, isFriendly, BUFF_RANGE } from '../../src/powers.js';
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
