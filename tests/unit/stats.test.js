// Unit tests for the character sheet - pure logic, no PlayCanvas, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSheet, gainXp, damageBonus, applyDamage,
  recomputeDerived, ensureAttributes, PROGRESSION, ATTR_KEYS,
} from '../../src/stats.js';
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

// --- attributes (milestone 1: the derived stat source) ----------------------

test('a fresh sheet carries the four office attributes from its class', () => {
  const s = createSheet('it-support');
  for (const k of ATTR_KEYS) assert.equal(typeof s.attr[k], 'number', `attr.${k}`);
  assert.deepEqual(s.attr, CLASSES['it-support'].attr);
});

test('derived maxHp/maxAp reproduce every playable class exactly', () => {
  for (const [id, cls] of Object.entries(CLASSES)) {
    if (cls.playable === false) continue; // applicant is AI-driven, never a sheet
    const s = createSheet(id);
    assert.equal(s.maxHp, cls.maxHp, `${id} maxHp`);
    assert.equal(s.maxAp, cls.ap, `${id} maxAp`);
    assert.equal(s.hp, cls.maxHp, `${id} starts at full`);
  }
});

test('raising Grit lifts maxHp by HP_PER_GRIT above the class floor', () => {
  const s = createSheet('office-drone');
  const before = s.maxHp;
  s.attr.grit += 1;
  recomputeDerived(s);
  assert.equal(s.maxHp, before + PROGRESSION.HP_PER_GRIT);
});

test('recomputeDerived clamps hp to a shrunken max, and growth never heals', () => {
  const s = createSheet('office-drone'); // 22/22, base grit 5
  s.hp = 10;
  s.attr.grit += 3; recomputeDerived(s); // grit 8 -> maxHp 28
  assert.equal(s.maxHp, 28);
  assert.equal(s.hp, 10);                // more max HP does not auto-heal
  s.hp = 26;                             // near the raised cap
  s.attr.grit -= 5; recomputeDerived(s); // grit 3 -> maxHp 18
  assert.equal(s.maxHp, 18);
  assert.equal(s.hp, 18);                // hp clamped down to the new cap
});

test('ensureAttributes backfills a pre-attribute sheet, preserving its stats', () => {
  const legacy = { classId: 'middle-manager', maxHp: 28, maxAp: 5, hp: 12 };
  ensureAttributes(legacy);
  assert.deepEqual(legacy.attr, CLASSES['middle-manager'].attr);
  assert.equal(legacy.maxHp, 28); // derivation reproduces the saved max
  assert.equal(legacy.maxAp, 5);
  assert.equal(legacy.hp, 12);    // current hp untouched
});
