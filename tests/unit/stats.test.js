// Unit tests for the character sheet - pure logic, no PlayCanvas, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSheet, gainXp, damageBonus, applyDamage,
  recomputeDerived, ensureAttributes, spendAttrPoint, deflect,
  spendClassPoint, classTrack, scaleEnemy, effectiveLevel, statusResist,
  accuracy, dodge, hitChance, rollHit, unitCombat,
  equipItem, unequipItem, equippedStats, equippedAction, weaponProc, moveCostOf,
  PROGRESSION, ATTR_KEYS, ENEMY_SCALING, HIT, EQUIP_SLOTS,
} from '../../src/stats.js';
import { CLASSES } from '../../src/data/classes.js';
import { ENEMY_TYPES } from '../../src/data/enemies.js';
import { ITEMS } from '../../src/data/items.js';
import { ACTIONS } from '../../src/data/actions.js';

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

test('damageBonus counts the equipped weapon, not a bagful of staplers', () => {
  const s = createSheet('office-drone');
  s.attr.savvy = 0; recomputeDerived(s); // isolate the item/flat logic from Savvy
  s.inventory = ['stapler', 'red-stapler', 'stapler'];
  assert.equal(damageBonus(s), 0); // carried staplers no longer count - only in hand
  assert.equal(equipItem(s, 1), true); // equip the red stapler
  assert.equal(s.equipped.weapon, 'red-stapler');
  assert.equal(damageBonus(s), 2); // now its dmg counts
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
  s.equipped.weapon = null; recomputeDerived(s); // set aside IT's starting letter-opener to isolate Savvy
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

test('statusResist scales with Composure (shorter applied statuses)', () => {
  const s = createSheet('office-drone');
  s.attr.composure = 0;
  assert.equal(statusResist(s), 0);
  s.attr.composure = PROGRESSION.COMP_PER_DEFLECT * 3;
  assert.equal(statusResist(s), 3);
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

// --- enemy tiers + floor curve (milestone 4) --------------------------------

test('scaleEnemy returns the def unchanged at its native level', () => {
  const m = ENEMY_TYPES.manager; // level 1
  assert.equal(scaleEnemy(m, 1), m); // same reference - byte-identical
  assert.equal(scaleEnemy(m, m.level), m);
});

test('scaleEnemy grows hp, xp, and damage with level, leaving the base def intact', () => {
  const m = ENEMY_TYPES.manager; // level 1, hp 14, xp 8
  const s = scaleEnemy(m, 3);
  assert.equal(s.level, 3);
  assert.ok(s.hp > m.hp, 'hp grows');
  assert.ok(s.xp > m.xp, 'xp grows');
  assert.ok(s.attacks[0].max >= m.attacks[0].max, 'damage grows');
  assert.equal(m.hp, 14); // the registry entry is not mutated
  assert.equal(s.maxHp, undefined); // enemies carry `hp`, not `maxHp`
});

test('effectiveLevel never drops below the native tier', () => {
  const senior = ENEMY_TYPES['senior-manager']; // level 3
  assert.equal(effectiveLevel(senior, 2), 3); // shallow floor keeps its tier
  assert.equal(effectiveLevel(senior, 5), 5); // deep floor scales up
  assert.equal(effectiveLevel(ENEMY_TYPES.manager, 4), 4);
});

test('scaleEnemy grows AP once the gap reaches AP_PER levels', () => {
  const m = ENEMY_TYPES.manager; // level 1, ap 5
  const s = scaleEnemy(m, m.level + ENEMY_SCALING.AP_PER); // exactly one AP step
  assert.equal(s.ap, m.ap + 1, 'one AP step at AP_PER levels above native');
  assert.equal(m.ap, 5); // base def untouched
});

test('variant enemies carry innate accuracy/dodge through unitCombat', () => {
  const x = unitCombat(ENEMY_TYPES['regional-executive']);
  assert.ok(x.accuracy > 0, 'regional exec is accurate');
  assert.ok(x.dodge > 0, 'regional exec is evasive');
  assert.equal(unitCombat(ENEMY_TYPES.manager).accuracy, 0); // the base tier stays plain
  assert.equal(unitCombat(ENEMY_TYPES.manager).dodge, 0);
});

test('scaleEnemy nudges accuracy up on deep floors, capped', () => {
  const m = ENEMY_TYPES.manager; // native level 1, accuracy 0
  const near = scaleEnemy(m, m.level + ENEMY_SCALING.ACC_PER - 1); // one short of a step
  assert.equal(near.accuracy, 0);
  const one = scaleEnemy(m, m.level + ENEMY_SCALING.ACC_PER); // exactly one step
  assert.ok(Math.abs(one.accuracy - HIT.STEP) < 1e-9);
  const far = scaleEnemy(m, m.level + ENEMY_SCALING.ACC_PER * 20); // way past the cap
  assert.ok(Math.abs(far.accuracy - ENEMY_SCALING.ACC_STEP_CAP * HIT.STEP) < 1e-9);
  assert.equal(m.accuracy ?? 0, 0); // the base def is not mutated
});

test('scaleEnemy adds the depth nudge on top of innate accuracy', () => {
  const x = ENEMY_TYPES['regional-executive']; // native 4, innate accuracy 0.10
  const scaled = scaleEnemy(x, x.level + ENEMY_SCALING.ACC_PER); // +1 step
  assert.ok(Math.abs(scaled.accuracy - (x.accuracy + HIT.STEP)) < 1e-9);
  assert.ok(Math.abs(scaled.dodge - x.dodge) < 1e-9); // dodge is identity, unscaled
});

test('scaleEnemy scales the maxHp field for a class-backed AI unit', () => {
  // The applicant class spells max HP `maxHp` (not `hp`); scaleEnemy must scale
  // that field and never invent a phantom `hp` (stats.js unitCombat prefers maxHp).
  const s = scaleEnemy(CLASSES.applicant, 3);
  assert.ok(s.maxHp > CLASSES.applicant.maxHp, 'maxHp grows');
  assert.equal(s.hp, undefined, 'no phantom hp field appears');
  assert.equal(s.level, 3);
});

// --- investing in max HP credits the fresh capacity (spend-only) -------------

test('spending into Grit credits the new HP delta, preserving the wound', () => {
  const s = createSheet('office-drone'); // 22/22
  s.hp = 10;
  s.attrPoints = 1;
  assert.equal(spendAttrPoint(s, 'grit'), true);
  assert.equal(s.maxHp, 22 + PROGRESSION.HP_PER_GRIT);
  assert.equal(s.hp, 10 + PROGRESSION.HP_PER_GRIT); // delta credited, not a full heal
});

test('a Grit class-track node also credits the HP delta', () => {
  const s = createSheet('office-drone');
  s.hp = 10;
  s.classPoints = 1;
  assert.equal(spendClassPoint(s, 'drone-thick-skin'), true); // +1 Grit
  assert.equal(s.hp, 10 + PROGRESSION.HP_PER_GRIT);
});

test('spending a non-HP attribute leaves current HP untouched', () => {
  const s = createSheet('office-drone');
  s.hp = 10;
  s.attrPoints = 1;
  assert.equal(spendAttrPoint(s, 'savvy'), true); // no maxHp change
  assert.equal(s.hp, 10);
});

// --- the to-hit / defense model (HIT_PLAN.md milestone 1) --------------------

test('accuracy derives from Savvy in STEP-sized increments', () => {
  const s = createSheet('office-drone');
  s.attr.savvy = 0;
  assert.equal(accuracy(s), 0);
  s.attr.savvy = HIT.ACC_PER_SAVVY;         // exactly one step
  assert.equal(accuracy(s), HIT.STEP);
  s.attr.savvy = HIT.ACC_PER_SAVVY * 2 + 1; // two steps; the remainder is dropped
  assert.equal(accuracy(s), Math.floor(s.attr.savvy / HIT.ACC_PER_SAVVY) * HIT.STEP);
});

test('dodge derives from Hustle in STEP-sized increments', () => {
  const s = createSheet('office-drone');
  s.attr.hustle = 0;
  assert.equal(dodge(s), 0);
  s.attr.hustle = HIT.DODGE_PER_HUSTLE;
  assert.equal(dodge(s), HIT.STEP);
});

test('accuracy/dodge tolerate a sheet with no attributes', () => {
  assert.equal(accuracy({}), 0);
  assert.equal(dodge({}), 0);
});

test('hitChance is BASE with no edge, and shifts by accuracy and dodge', () => {
  assert.equal(hitChance(0, 0), HIT.BASE);
  assert.ok(Math.abs(hitChance(HIT.STEP, 0) - (HIT.BASE + HIT.STEP)) < 1e-9);
  assert.ok(Math.abs(hitChance(0, HIT.STEP) - (HIT.BASE - HIT.STEP)) < 1e-9);
  assert.ok(Math.abs(hitChance(HIT.STEP, HIT.STEP) - HIT.BASE) < 1e-9); // acc & dodge cancel
});

test('hitChance engages both clamp bounds', () => {
  // A big accuracy edge clamps down to CLAMP_HI; a big dodge edge clamps up to
  // CLAMP_LO - the universal-whiff cap and the never-unhittable floor.
  assert.equal(hitChance(0.5, 0), HIT.CLAMP_HI);
  assert.equal(hitChance(0, 0.9), HIT.CLAMP_LO);
});

test('the live HIT constants keep a universal miss and a hit floor', () => {
  assert.ok(HIT.BASE < 1);           // even an unbuffed swing can miss
  assert.ok(HIT.CLAMP_HI < 1);       // a 1-in-20 whiff always remains
  assert.ok(HIT.CLAMP_LO > 0);       // a stacked dodge is never unhittable
  assert.ok(HIT.CLAMP_LO < HIT.CLAMP_HI);
});

test('rollHit lands when the rng falls under the chance', () => {
  assert.equal(rollHit(0.5, () => 0.49), true);  // just under -> hit
  assert.equal(rollHit(0.5, () => 0.5), false);  // exactly at -> miss
  assert.equal(rollHit(0.5, () => 0.51), false); // just over -> miss
  assert.equal(rollHit(1, () => 0.999), true);   // a certain hit never whiffs
  assert.equal(rollHit(0, () => 0), false);      // an impossible hit never lands
});

test('unitCombat passes innate accuracy/dodge through, defaulting to 0', () => {
  const bare = unitCombat({ name: 'x', hp: 5, ap: 4 });
  assert.equal(bare.accuracy, 0);
  assert.equal(bare.dodge, 0);
  const sharp = unitCombat({ name: 'y', hp: 5, ap: 4, accuracy: 0.1, dodge: 0.05 });
  assert.equal(sharp.accuracy, 0.1);
  assert.equal(sharp.dodge, 0.05);
});

// --- equipment (EQUIPMENT_PLAN.md milestone 1) ------------------------------

test('a fresh sheet seeds all four slots, filling only its class startGear', () => {
  const s = createSheet('office-drone'); // the Drone ships a stress-ball trinket
  assert.deepEqual(s.equipped, { weapon: null, outfit: null, trinket: 'stress-ball', shoes: null });
  assert.deepEqual(equippedStats(s).attrBonus, { composure: 1 }); // the trinket folds through
  assert.equal(equippedStats(s).dmg, 0); // a trinket, no weapon damage
});

test('equipItem validates the slot and swaps the incumbent back to the bag', () => {
  const s = createSheet('office-drone');
  s.inventory = ['stapler', 'red-stapler'];
  assert.equal(equipItem(s, 0), true);        // equip the plain stapler
  assert.equal(s.equipped.weapon, 'stapler');
  assert.ok(!s.inventory.includes('stapler')); // left the bag
  // equipping into the same slot returns the old occupant to the bag
  const i = s.inventory.indexOf('red-stapler');
  assert.equal(equipItem(s, i), true);
  assert.equal(s.equipped.weapon, 'red-stapler');
  assert.ok(s.inventory.includes('stapler')); // the plain stapler came back
  assert.equal(equippedStats(s).dmg, 2);
});

test('equipItem refuses a non-equippable item', () => {
  const s = createSheet('office-drone');
  s.inventory = ['cold-coffee']; // a consumable, no slot
  assert.equal(equipItem(s, 0), false);
  assert.equal(s.equipped.weapon, null);
  assert.ok(s.inventory.includes('cold-coffee')); // untouched
});

test('unequipItem returns gear to the bag, and refuses when the bag is full', () => {
  const s = createSheet('office-drone');
  s.inventory = ['red-stapler'];
  equipItem(s, 0);
  assert.equal(s.inventory.length, 0);
  assert.equal(unequipItem(s, 'weapon', 10), true);
  assert.equal(s.equipped.weapon, null);
  assert.ok(s.inventory.includes('red-stapler'));
  // a full bag politely refuses - the gear never vanishes
  equipItem(s, s.inventory.indexOf('red-stapler'));
  s.inventory = new Array(10).fill('paper-wad'); // at INV_CAP
  assert.equal(unequipItem(s, 'weapon', 10), false);
  assert.equal(s.equipped.weapon, 'red-stapler'); // still equipped
});

test('equipping a dmg-only weapon leaves maxHp and deflect untouched', () => {
  const s = createSheet('office-drone');
  const hp0 = s.maxHp, def0 = deflect(s);
  s.inventory = ['red-stapler'];
  equipItem(s, 0);
  assert.equal(s.maxHp, hp0);      // a stapler is pure damage
  assert.equal(deflect(s), def0);
  assert.equal(damageBonus(s) - (Math.floor((s.attr.savvy) / PROGRESSION.DMG_PER_SAVVY)), 2);
});

test('EQUIP_SLOTS is the four-slot set', () => {
  assert.deepEqual(EQUIP_SLOTS, ['weapon', 'outfit', 'trinket', 'shoes']);
});

test('equippedAction is bare-hands punch unarmed, the weapon swing in hand', () => {
  const s = createSheet('office-drone');
  assert.equal(equippedAction(s), 'punch'); // everyone always has a basic attack
  s.inventory = ['red-stapler'];
  equipItem(s, 0);
  assert.equal(equippedAction(s), 'staple-jab'); // the equipped weapon's swing
  unequipItem(s, 'weapon', 10);
  assert.equal(equippedAction(s), 'punch'); // back to bare hands
});

// --- equipment content + the richer stat folds (EQUIPMENT_PLAN M4) -----------

test('an outfit soak stacks on Composure deflect', () => {
  const s = createSheet('office-drone');
  const d0 = deflect(s);
  s.inventory = ['company-fleece']; // soak 1
  equipItem(s, 0);
  assert.equal(deflect(s), d0 + 1);
});

test('a maxHp trinket lifts the cap and credits the fresh HP', () => {
  const s = createSheet('office-drone'); // at full HP
  const hp0 = s.maxHp;
  s.inventory = ['okayest-mug']; // maxHp 2
  equipItem(s, 0);
  assert.equal(s.maxHp, hp0 + 2);
  assert.equal(s.hp, hp0 + 2); // was full, the +2 arrives undamaged
});

test('a weapon acc stat lifts accuracy', () => {
  const s = createSheet('office-drone');
  const a0 = accuracy(s);
  s.inventory = ['letter-opener']; // acc 0.05
  equipItem(s, 0);
  assert.ok(Math.abs(accuracy(s) - (a0 + 0.05)) < 1e-9);
});

test('gear attrBonus flows through every attribute derivation', () => {
  // A Hustle trinket lifts dodge (drone hustle 5 -> 6 crosses a dodge step).
  const s = createSheet('office-drone');
  const dodge0 = dodge(s);
  s.inventory = ['laminated-lanyard']; // +1 hustle
  equipItem(s, 0);
  assert.ok(dodge(s) > dodge0);
  // A Composure outfit lifts deflect once it crosses a threshold.
  const c = createSheet('office-drone');
  c.equipped.trinket = null; // set aside the Drone's starting stress-ball (+1 composure) to isolate the threshold
  c.attr.composure = 2 * PROGRESSION.COMP_PER_DEFLECT - 1; // deflect floor = 1
  recomputeDerived(c);
  const def0 = deflect(c);
  c.inventory = ['interview-blazer']; // +2 composure -> crosses to floor 2
  equipItem(c, 0);
  assert.ok(deflect(c) > def0);
});

test('every equippable item declares a valid slot, stat vocabulary, and weapon swing', () => {
  const STAT_KEYS = new Set(['dmg', 'soak', 'maxHp', 'maxAp', 'acc', 'dodge', 'slipProof', 'moveCost', 'attrBonus']);
  for (const [id, def] of Object.entries(ITEMS)) {
    if (!def.slot && !def.stats) continue; // not gear
    assert.ok(EQUIP_SLOTS.includes(def.slot), `${id} has a valid slot`);
    for (const k of Object.keys(def.stats || {})) assert.ok(STAT_KEYS.has(k), `${id} stat key ${k}`);
    for (const k of Object.keys(def.stats?.attrBonus || {})) assert.ok(ATTR_KEYS.includes(k), `${id} attrBonus ${k}`);
    if (def.slot === 'weapon') assert.ok(ACTIONS[def.attack], `${id} weapon swing ${def.attack} exists`);
  }
});

test('every playable class walks in wearing its startGear, curve-neutral', () => {
  for (const [id, cls] of Object.entries(CLASSES)) {
    if (cls.playable === false) continue; // applicant is AI-driven, never a picked sheet
    assert.ok(cls.startGear, `${id} furnishes a starting slot`); // a new character is never naked
    const s = createSheet(id);
    for (const [slot, itemId] of Object.entries(cls.startGear)) {
      assert.ok(ITEMS[itemId], `${id} startGear item ${itemId} exists`);
      assert.equal(ITEMS[itemId].slot, slot, `${id} startGear ${itemId} fits ${slot}`);
      assert.equal(s.equipped[slot], itemId, `${id} starts with ${itemId} in ${slot}`);
    }
    // Curve-neutral: the signature piece never bends the headline HP/AP - those
    // stay exactly the class's declared numbers (only Grit/Hustle move them).
    assert.equal(s.maxHp, cls.maxHp, `${id} startGear leaves maxHp on curve`);
    assert.equal(s.maxAp, cls.ap, `${id} startGear leaves maxAp on curve`);
    assert.equal(s.hp, cls.maxHp, `${id} still starts at full`);
  }
});

// --- procs + the shoes slot (EQUIPMENT_PLAN M5) -----------------------------

test('footwear slipProof folds into equippedStats', () => {
  const s = createSheet('office-drone');
  assert.equal(equippedStats(s).slipProof, false);
  s.inventory = ['warehouse-boots'];
  equipItem(s, 0);
  assert.equal(s.equipped.shoes, 'warehouse-boots'); // its own slot
  assert.equal(equippedStats(s).slipProof, true);
  assert.ok(equippedStats(s).dodge >= 0.05); // and a touch of dodge
});

test('weaponProc reads the equipped weapon on-hit proc, null otherwise', () => {
  const s = createSheet('office-drone');
  assert.equal(weaponProc(s), null); // bare-handed, no proc
  s.inventory = ['stapler'];
  equipItem(s, 0);
  assert.equal(weaponProc(s), null); // a plain stapler has no proc
  s.inventory = ['red-stapler'];
  equipItem(s, 0);
  assert.equal(weaponProc(s).applies, 'gum'); // THE red stapler flings gum
  assert.ok(weaponProc(s).chance > 0);
});

// --- footwear movement efficiency (MOVEMENT_PLAN M4) ------------------------

test('footwear moveCost multiplies, and bare feet are neutral', () => {
  const s = createSheet('office-drone');
  s.equipped.shoes = null;
  assert.equal(moveCostOf(s), 1); // no shoes = no modifier, not zero cost
  s.inventory = ['running-shoes'];
  equipItem(s, 0);
  assert.equal(s.equipped.shoes, 'running-shoes');
  assert.ok(moveCostOf(s) < 1, 'runners are faster than bare feet');
});

test('the boots trade speed for traction', () => {
  // The choice the slot exists to pose: sure-footed but heavier, or quick but
  // at the mercy of a wet floor.
  const boots = createSheet('office-drone');
  boots.inventory = ['warehouse-boots'];
  equipItem(boots, 0);
  const runners = createSheet('office-drone');
  runners.inventory = ['running-shoes'];
  equipItem(runners, 0);
  assert.ok(moveCostOf(boots) > moveCostOf(runners), 'boots cost more per tile');
  assert.equal(equippedStats(boots).slipProof, true);
  assert.equal(equippedStats(runners).slipProof, false); // speed buys no grip
});
