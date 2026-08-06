import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDamageFormula, formatHitFormula, formatProcFormula } from '../../src/combat-formulas.js';

test('hit formula exposes the exact terms, clamp, draw, and outcome', () => {
  assert.equal(formatHitFormula({
    attacker: 'Pat', target: 'Manager', base: 0.85, accuracy: 0.1,
    dodge: 0.05, position: 0.15, clampLow: 0.35, clampHigh: 0.95,
    chance: 0.95, roll: 0.42, forced: null, hit: true,
  }), 'Hit · Pat → Manager: clamp(85% + accuracy 10% − dodge 5% + position 15%, 35%–95%) = 95%; roll 42% → HIT.');
});

test('hit and proc formulas distinguish debug pins from random draws', () => {
  assert.match(formatHitFormula({
    attacker: 'Pat', target: 'Manager', base: 0.85, clampLow: 0.35,
    clampHigh: 0.95, chance: 0.85, forced: false, hit: false,
  }), /debug pin miss → MISS/);
  assert.equal(formatProcFormula({
    attacker: 'Pat', target: 'Manager', label: 'Gum', chance: 0.25,
    forced: true, hit: true,
  }), 'Proc · Pat → Manager (Gum): 25%; debug pin proc → PROC.');
});

test('damage formula shows rolled range, nonzero additions, and resolver stages', () => {
  assert.equal(formatDamageFormula({
    attacker: 'Pat', target: 'Manager', action: 'Bulk Mail',
    roll: 4, min: 3, max: 6,
    additions: [{ label: 'damage bonus', value: 2 }, { label: 'paper talent', value: 1 }],
    stages: [
      { label: 'ambush', before: 7, after: 11 },
      { label: 'Composure soak 3', before: 11, after: 8 },
    ],
    result: 8,
  }), 'Damage · Pat → Manager (Bulk Mail): roll 4 (3–6) + damage bonus 2 + paper talent 1 = 7; ambush: 7 → 11; Composure soak 3: 11 → 8; total 8.');
});
