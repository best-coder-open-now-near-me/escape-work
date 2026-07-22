// Unit tests for the character sheet - pure logic, no PlayCanvas, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSheet, gainXp, damageBonus, applyDamage } from '../../src/stats.js';
import { CLASSES } from '../../src/data/classes.js';

test('createSheet copies class stats and starts clean', () => {
  const s = createSheet('office-drone');
  assert.equal(s.hp, CLASSES['office-drone'].maxHp);
  assert.equal(s.level, 1);
  assert.equal(s.paper, 0);
  assert.deepEqual(s.inventory, []);
});

test('createSheet throws on an unknown class', () => {
  assert.throws(() => createSheet('goose'));
});

test('talent-granted actions land on the sheet', () => {
  const s = createSheet('middle-manager'); // Smoker grants the cigarette
  assert.ok(s.actions.includes('cigarette'));
  // ...and the granted action is appended, not replacing class actions.
  for (const id of CLASSES['middle-manager'].actions) assert.ok(s.actions.includes(id));
});

test('gainXp promotes once, fully heals, and grows the next bar', () => {
  const s = createSheet('office-drone');
  s.hp = 1;
  const before = s.xpNext;
  const promoted = gainXp(s, before);
  assert.equal(promoted, true);
  assert.equal(s.level, 2);
  assert.equal(s.hp, s.maxHp);
  assert.equal(s.bonusDmg, 1);
  assert.equal(s.xpNext, Math.round(before * 1.5));
});

test('gainXp chains multiple promotions from one windfall', () => {
  const s = createSheet('office-drone');
  gainXp(s, 10 + 15); // level 2 at 10, level 3 at a further 15
  assert.equal(s.level, 3);
  assert.equal(s.xp, 0);
});

test('damageBonus counts only the single best carried item', () => {
  const s = createSheet('office-drone');
  s.inventory = ['stapler', 'red-stapler', 'stapler'];
  assert.equal(damageBonus(s), 2); // red stapler wins; they do not stack
  s.bonusDmg = 3;
  assert.equal(damageBonus(s), 5);
});

test('applyDamage clamps at zero and reports death', () => {
  const s = createSheet('office-drone');
  assert.equal(applyDamage(s, 5), false);
  assert.equal(applyDamage(s, 999), true);
  assert.equal(s.hp, 0);
});
