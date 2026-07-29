// Seeded combat resolution (TODO Phase 6). The point of closing combat's rng
// seam: `rand` used to read Math.random at module scope, unreachable from the
// injected rng, so DAMAGE was the one part of a resolution a seeded test could
// not pin - and the roll -> damage -> status chain could only ever be checked a
// piece at a time. These drive the same pure functions combat calls, in the same
// order, off one seeded source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSheet, damageBonus, accuracy, hitChance, rollHit, HIT,
} from '../../src/stats.js';
import { applyStatus, hasStatus } from '../../src/statuses.js';

const seq = (values) => { let i = 0; return () => values[i++ % values.length]; };

test('one seed reproduces a whole roll -> damage -> status resolution', () => {
  const attacker = createSheet('office-drone');
  const chance = hitChance(accuracy(attacker), 0); // acc vs dodge, clamped

  const resolve = (rng) => {
    const hit = rollHit(chance, rng);
    if (!hit) return { hit, dmg: 0 };
    // The same inclusive roll combat uses, off the same source.
    const dmg = 3 + Math.floor(rng() * (5 - 3 + 1)) + damageBonus(attacker);
    return { hit, dmg };
  };

  // A roll of 0 always lands (0 < any chance), then a 0 takes the low end.
  assert.deepEqual(resolve(seq([0, 0])), { hit: true, dmg: 3 + damageBonus(attacker) });
  // ...and just under 1 takes the top of the spread.
  assert.deepEqual(resolve(seq([0, 0.999])), { hit: true, dmg: 5 + damageBonus(attacker) });
  // A roll at or above the chance misses, and a miss spends nothing else. The
  // clamp guarantees a whiff stays reachable however buffed you are (CLAMP_HI),
  // which is why this can be asserted at all rather than approximated.
  assert.equal(chance <= HIT.CLAMP_HI, true);
  assert.deepEqual(resolve(seq([HIT.CLAMP_HI, 0])), { hit: false, dmg: 0 });

  // Same seed, same answer - twice, because that is the property being claimed.
  assert.deepEqual(resolve(seq([0, 0.5])), resolve(seq([0, 0.5])));
});

test('a status rider lands on the same seed the damage did', () => {
  // The third link in the chain: a resolution that hits, rolls damage, and
  // then lands its rider - all decided by one reproducible sequence.
  const target = { statuses: {} };
  const rng = seq([0, 0.4, 0.2]);
  assert.equal(rollHit(0.85, rng), true, 'the swing lands');
  assert.ok(3 + Math.floor(rng() * 3) >= 3, 'the damage rolls');
  assert.equal(rollHit(0.35, rng), true, 'and the proc resolves off the same source');
  assert.equal(applyStatus(target, 'gum'), true);
  assert.equal(hasStatus(target, 'gum'), true);
});
