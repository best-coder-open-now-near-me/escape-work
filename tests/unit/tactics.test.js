// Tactical positioning (TACTICS_PLAN.md). Milestone 1 is the to-hit
// assembler: the one place the terms are summed, read by both the real roll
// and the hover preview. These tests pin the arithmetic that four hand-rolled
// copies in combat.js used to each own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toHitTerms } from '../../src/tactics.js';
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
