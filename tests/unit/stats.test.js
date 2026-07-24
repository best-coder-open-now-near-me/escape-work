// Unit tests for the character sheet - pure logic, no PlayCanvas, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSheet, gainXp, damageBonus, applyDamage,
  recomputeDerived, ensureAttributes, spendAttrPoint, deflect,
  spendClassPoint, classTrack,
  PROGRESSION, ATTR_KEYS,
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
  assert.equal(s.bonusDmg, 0); // damage no longer rises automatically (M2)
  assert.equal(s.attrPoints, PROGRESSION.ATTR_PER_LEVEL); // one of each type per level
  assert.equal(s.classPoints, PROGRESSION.CP_PER_LEVEL);
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
  s.attr.savvy = 0; // isolate the item/flat logic from the Savvy term
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

// --- attribute points (milestone 2: spending, and the derived combat effects)

test('gainXp banks attribute points instead of raising damage', () => {
  const s = createSheet('office-drone');
  const dmg0 = s.bonusDmg;
  gainXp(s, s.xpNext); // one promotion
  assert.equal(s.level, 2);
  assert.equal(s.bonusDmg, dmg0); // no automatic damage bump
  assert.equal(s.attrPoints, PROGRESSION.ATTR_PER_LEVEL);
  assert.equal(s.classPoints, PROGRESSION.CP_PER_LEVEL); // one of each, every level
});

test('spendAttrPoint raises the attribute, re-derives, and drains the pool', () => {
  const s = createSheet('office-drone');
  s.attrPoints = 1;
  const hp0 = s.maxHp, grit0 = s.attr.grit;
  assert.equal(spendAttrPoint(s, 'grit'), true);
  assert.equal(s.attr.grit, grit0 + 1);
  assert.equal(s.maxHp, hp0 + PROGRESSION.HP_PER_GRIT); // derived stat followed
  assert.equal(s.attrPoints, 0);
});

test('spendAttrPoint refuses an empty pool or an unknown attribute', () => {
  const s = createSheet('office-drone');
  s.attrPoints = 1;
  assert.equal(spendAttrPoint(s, 'charisma'), false); // not one of the four
  assert.equal(s.attrPoints, 1);
  assert.equal(spendAttrPoint(s, 'grit'), true);
  assert.equal(spendAttrPoint(s, 'grit'), false); // pool now empty
});

test('damageBonus includes the Savvy term', () => {
  const s = createSheet('it-support'); // savvy 8
  assert.equal(damageBonus(s), Math.floor(8 / PROGRESSION.DMG_PER_SAVVY));
  s.attr.savvy = 0;
  assert.equal(damageBonus(s), 0);
});

test('deflect scales with Composure, zero when there is none', () => {
  const s = createSheet('office-drone');
  s.attr.composure = 0;
  assert.equal(deflect(s), 0);
  s.attr.composure = PROGRESSION.COMP_PER_DEFLECT * 2;
  assert.equal(deflect(s), 2);
});

// --- class points + the ability track (milestone 3) -------------------------

test('spendClassPoint on an attrBonus node raises the attribute and derives', () => {
  const s = createSheet('office-drone');
  s.classPoints = 1;
  const grit0 = s.attr.grit, hp0 = s.maxHp;
  assert.equal(spendClassPoint(s, 'drone-thick-skin'), true); // +1 Grit
  assert.equal(s.attr.grit, grit0 + 1);
  assert.equal(s.maxHp, hp0 + PROGRESSION.HP_PER_GRIT); // derived followed
  assert.equal(s.classPoints, 0);
  assert.ok(s.perks.includes('drone-thick-skin'));
});

test('spendClassPoint grants an action onto the sheet (respecting prereqs)', () => {
  const s = createSheet('office-drone');
  s.classPoints = 2;
  assert.ok(!s.actions.includes('kick'));
  assert.equal(spendClassPoint(s, 'drone-seminar'), false); // prereq not met yet
  assert.equal(spendClassPoint(s, 'drone-thick-skin'), true);
  assert.equal(spendClassPoint(s, 'drone-seminar'), true); // now unlocks the kick
  assert.ok(s.actions.includes('kick'));
});

test('spendClassPoint merges a numeric talent effect', () => {
  const s = createSheet('office-drone'); // Origami Specialist: paperDamageBonus 2
  s.classPoints = 1;
  const before = s.talent.effects.paperDamageBonus || 0;
  assert.equal(spendClassPoint(s, 'drone-sharp-folds'), true); // +1
  assert.equal(s.talent.effects.paperDamageBonus, before + 1);
});

test('spendClassPoint refuses unknown nodes, empty pool, and double-takes', () => {
  const s = createSheet('office-drone');
  s.classPoints = 1;
  assert.equal(spendClassPoint(s, 'nope'), false);
  assert.equal(spendClassPoint(s, 'drone-thick-skin'), true);
  assert.equal(spendClassPoint(s, 'drone-thick-skin'), false); // already taken
  s.classPoints = 0;
  assert.equal(spendClassPoint(s, 'drone-sharp-folds'), false); // no points
});

test('classTrack returns the sheet class own nodes', () => {
  const ids = classTrack(createSheet('middle-manager')).map((n) => n.id);
  assert.ok(ids.includes('mgr-stonewall'));
  assert.ok(!ids.includes('drone-thick-skin'));
});
