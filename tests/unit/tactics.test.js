// Tactical positioning (TACTICS_PLAN.md). Milestone 1 is the to-hit
// assembler: the one place the terms are summed, read by both the real roll
// and the hover preview. These tests pin the arithmetic that four hand-rolled
// copies in combat.js used to each own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toHitTerms, cheb, threatens, provokedBy } from '../../src/tactics.js';
import { HIT, hitChance } from '../../src/stats.js';

test('an empty pair is all zeroes - no accidental baseline', () => {
  assert.deepEqual(toHitTerms(), { acc: 0, dodge: 0, mods: 0 });
  assert.deepEqual(toHitTerms({}), { acc: 0, dodge: 0, mods: 0 });
});

test('accuracy and dodge pass through to their own terms, unmixed', () => {
  const t = toHitTerms({ accuracy: 0.2, dodge: 0.15 });
  assert.equal(t.acc, 0.2);
  assert.equal(t.dodge, 0.15);
  assert.equal(t.mods, 0); // nothing positional yet (milestones 3-5)
});

test('a surprised defender hands the attacker exactly SURPRISE_ACC_BONUS', () => {
  const calm = toHitTerms({ accuracy: 0.1 });
  const caught = toHitTerms({ accuracy: 0.1, surprised: true });
  assert.equal(caught.acc - calm.acc, HIT.SURPRISE_ACC_BONUS);
  assert.equal(caught.dodge, calm.dodge); // surprise is an accuracy term, not a dodge one
});

test('status accMod lands on the attacker, dodgeMod on the defender', () => {
  // A blinded attacker (negative accMod) aims worse; it must never be
  // mistaken for the defender being harder to hit - they clamp differently.
  const t = toHitTerms({ accuracy: 0.2, dodge: 0.1, accMod: -0.3, dodgeMod: 0.05 });
  assert.ok(Math.abs(t.acc - (0.2 - 0.3)) < 1e-9);
  assert.ok(Math.abs(t.dodge - (0.1 + 0.05)) < 1e-9);
});

test('every term composes in one pass', () => {
  const t = toHitTerms({
    accuracy: 0.10, dodge: 0.05, surprised: true, accMod: -0.02, dodgeMod: 0.03, positional: 0.2,
  });
  assert.ok(Math.abs(t.acc - (0.10 + HIT.SURPRISE_ACC_BONUS - 0.02)) < 1e-9);
  assert.ok(Math.abs(t.dodge - (0.05 + 0.03)) < 1e-9);
  assert.equal(t.mods, 0.2);
});

test('the positional term passes through untouched, both signs', () => {
  // Cover is negative (defender-favouring), flank/backstab positive. The
  // assembler must not clamp or reinterpret either - hitChance owns clamping.
  assert.equal(toHitTerms({ positional: -0.2 }).mods, -0.2);
  assert.equal(toHitTerms({ positional: 0.35 }).mods, 0.35);
});

test('the terms feed hitChance in the shape it consumes', () => {
  // The contract this milestone exists to guarantee: one assembler, and its
  // output drops straight into the roll AND the preview with no reshaping.
  const t = toHitTerms({ accuracy: 0.1, dodge: 0.05, surprised: true });
  const chance = hitChance(t.acc, t.dodge, t.mods);
  assert.equal(chance, hitChance(0.1 + HIT.SURPRISE_ACC_BONUS, 0.05, 0));
  assert.ok(chance > 0 && chance <= HIT.CLAMP_HI);
});

test('a defender-favouring positional term can only lower the chance', () => {
  const open = toHitTerms({ accuracy: 0.1, dodge: 0.05 });
  const covered = toHitTerms({ accuracy: 0.1, dodge: 0.05, positional: -0.2 });
  assert.ok(hitChance(covered.acc, covered.dodge, covered.mods)
    <= hitChance(open.acc, open.dodge, open.mods));
});

// --- threat & opportunity attacks (TACTICS_PLAN M2) -------------------------

test('cheb treats a diagonal as one step, like the rest of the grid', () => {
  assert.equal(cheb(0, 0, 0, 0), 0);
  assert.equal(cheb(0, 0, 1, 1), 1);  // diagonal is adjacent
  assert.equal(cheb(0, 0, 2, 0), 2);
  assert.equal(cheb(3, 3, 1, 2), 2);  // max of the two axes, not the sum
});

test('a unit threatens its eight neighbours and nothing further', () => {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      assert.equal(threatens(5, 5, 5 + dx, 5 + dz), true, `${dx},${dz} is threatened`);
    }
  }
  assert.equal(threatens(5, 5, 7, 5), false); // two tiles out is free
  assert.equal(threatens(5, 5, 5, 7), false);
  assert.equal(threatens(5, 5, 7, 7), false);
});

test('stepping out of reach provokes; approaching does not', () => {
  const foe = [{ x: 5, z: 5 }];
  assert.equal(provokedBy(foe, 5, 6, 5, 8).length, 1); // adjacent -> away: provokes
  assert.equal(provokedBy(foe, 5, 8, 5, 6).length, 0); // away -> adjacent: closing is free
});

test('circling a foe provokes nothing - the threat set never lapses', () => {
  // Both tiles are adjacent to the foe, so it never stops threatening. This is
  // the case raw adjacency-diffing gets wrong.
  const foe = [{ x: 5, z: 5 }];
  assert.deepEqual(provokedBy(foe, 4, 5, 4, 4), []); // orthogonal -> diagonal, still in reach
  assert.deepEqual(provokedBy(foe, 4, 4, 5, 4), []); // diagonal -> orthogonal
  assert.deepEqual(provokedBy(foe, 5, 5, 5, 5), []); // standing still is not leaving
});

test('only the threats actually escaped fire, not every nearby foe', () => {
  const a = { x: 5, z: 5, tag: 'left-behind' };
  const b = { x: 8, z: 5, tag: 'still-adjacent' };
  // Move from between them to a tile that only b still reaches.
  const provoked = provokedBy([a, b], 6, 5, 7, 5);
  assert.equal(provoked.length, 1);
  assert.equal(provoked[0].tag, 'left-behind'); // b never lost reach, so it gets nothing
});

test('escaping several threats at once provokes each of them', () => {
  const swarm = [{ x: 4, z: 5 }, { x: 5, z: 4 }, { x: 6, z: 5 }];
  assert.equal(provokedBy(swarm, 5, 5, 5, 9).length, 3); // walking out of a surround
});

test('provokedBy tolerates an empty or missing threat list', () => {
  assert.deepEqual(provokedBy([], 1, 1, 5, 5), []);
  assert.deepEqual(provokedBy(undefined, 1, 1, 5, 5), []);
});
