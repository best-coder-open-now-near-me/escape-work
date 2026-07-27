// Unit tests for the combat turn order - pure logic, no PlayCanvas, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollInitiative, buildInitiativeOrder, insertionIndex, INIT_DIE } from '../../src/initiative.js';

// A deterministic RNG: replays a fixed sequence of [0,1) values, looping.
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test('rollInitiative is d20 + modifier', () => {
  assert.equal(rollInitiative(5, () => 0), 1 + 5); // floor(0*20)=0 -> die shows 1
  assert.equal(rollInitiative(5, () => 0.9999), INIT_DIE + 5); // die shows 20
  assert.equal(rollInitiative(0, () => 0.5), 1 + Math.floor(0.5 * INIT_DIE));
  assert.equal(rollInitiative(undefined, () => 0.5), 1 + Math.floor(0.5 * INIT_DIE)); // +0
});

test('buildInitiativeOrder sorts highest-init first and annotates init', () => {
  // rng feeds die rolls in call order: fast ally rolls high, slow enemy low.
  const rng = seqRng([0.95, 0]); // ally die 20, enemy die 1
  const order = buildInitiativeOrder([
    { id: 'ally', team: 'player', initMod: 4 },
    { id: 'enemy', team: 'enemy', initMod: 1 },
  ], rng);
  assert.equal(order[0].id, 'ally');
  assert.equal(order[0].init, INIT_DIE + 4); // 20 + 4
  assert.equal(order[1].id, 'enemy');
  assert.equal(order[1].init, 1 + 1); // die 1 + 1
});

test('ties break to the player side', () => {
  // Both roll the same die face and share a modifier, so totals tie. rng: two
  // die rolls (equal), then a tie-break coin flip that must NOT override team.
  const rng = seqRng([0.5, 0.5, 0.99]);
  const order = buildInitiativeOrder([
    { id: 'enemy', team: 'enemy', initMod: 3 },
    { id: 'you', team: 'player', initMod: 3 },
  ], rng);
  assert.equal(order[0].init, order[1].init); // genuinely tied
  assert.equal(order[0].id, 'you'); // player side wins the tie
});

test('buildInitiativeOrder returns a new array but the same entry refs', () => {
  const you = { id: 'you', team: 'player', initMod: 3 };
  const entries = [you];
  const order = buildInitiativeOrder(entries, () => 0.5);
  assert.notEqual(order, entries);
  assert.equal(order[0], you); // same reference, so threaded refs survive
  assert.ok(Number.isInteger(you.init));
});

test('insertionIndex slots a joiner after equal-init entries, before lower', () => {
  const order = [{ init: 22 }, { init: 18 }, { init: 18 }, { init: 9 }];
  assert.equal(insertionIndex(order, 25), 0); // faster than everyone -> front
  assert.equal(insertionIndex(order, 18), 3); // after the last equal-18 entry
  assert.equal(insertionIndex(order, 12), 3); // between 18s and 9
  assert.equal(insertionIndex(order, 1), 4); // slowest -> end
});

// The same-team tiebreak used to be `rng() - 0.5` INSIDE the comparator, which
// is not a consistent ordering: asked about the same pair twice it could answer
// differently, so the result fell out of the sort's pivot walk rather than out
// of chance. A shuffle key drawn once per entry is both an honest shuffle and a
// valid comparator - and, unlike the old form, it is checkable.
test('same-team ties break by a per-entry shuffle key, not a coin in the comparator', () => {
  // Three tied player-side entries. After the three die rolls, the next three
  // draws are the shuffle keys - handed out in entry order, so the entry with
  // the SMALLEST key must come first.
  const rng = seqRng([0.5, 0.5, 0.5, 0.9, 0.1, 0.5]);
  const order = buildInitiativeOrder([
    { id: 'a', team: 'player', initMod: 2 },
    { id: 'b', team: 'player', initMod: 2 },
    { id: 'c', team: 'player', initMod: 2 },
  ], rng);
  assert.deepEqual(order.map((e) => e.init), [order[0].init, order[0].init, order[0].init]);
  assert.deepEqual(order.map((e) => e.id), ['b', 'c', 'a']);
});

test('the tie shuffle asks the rng a bounded number of times', () => {
  // One draw per entry for the roll, one per entry for the shuffle key - and
  // nothing per COMPARISON, which is what made the old comparator's draw count
  // depend on the sort algorithm.
  let calls = 0;
  const rng = () => { calls += 1; return 0.5; };
  const entries = Array.from({ length: 6 }, (_, i) => ({ id: i, team: 'player', initMod: 1 }));
  buildInitiativeOrder(entries, rng);
  assert.equal(calls, entries.length * 2);
});

test('a tie shuffle still never outranks init or team', () => {
  // Whatever the keys say, a higher roll goes first and a tied player beats a
  // tied enemy - the shuffle is the LAST word, not the first.
  const rng = seqRng([0.95, 0.05, 0.5, 0.0, 0.99]);
  const order = buildInitiativeOrder([
    { id: 'fast', team: 'enemy', initMod: 0 },
    { id: 'slow', team: 'player', initMod: 0 },
  ], rng);
  assert.equal(order[0].id, 'fast'); // the roll wins outright
  assert.ok(order[0].init > order[1].init);
});
