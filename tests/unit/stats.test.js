// Unit tests for the character sheet - pure logic, no PlayCanvas, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPANIONS } from '../../src/data/companions.js';
import {
  createSheet, grantTalent, gainXp, damageBonus, applyDamage, recomputeDerived, ensureAttributes, spendAttrPoint, deflect, spendClassPoint, classTrack, spendablePoints, pendingPoints, scaleEnemy, statusResist, accuracy, dodge, hitChance, rollHit, unitCombat, equipItem, unequipItem, equippedStats, equippedAction, weaponProc, moveCostOf, reachOf, rangeOf, ammoCostOf, orderedActionIds, PROGRESSION, ATTR_KEYS, ENEMY_SCALING, HIT, EQUIP_SLOTS, REACH, THROW_RANGE, lookOf, gritSaveChance, SAVE,
} from '../../src/stats.js';
import * as stats from '../../src/stats.js';
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
  // A talent is no longer class property (TALENT_PLAN M1) - IT Support is
  // SEEDED with ESD Steel-Toes rather than owning it, and the Steel-Toe Kick
  // arrives through the registry.
  const s = createSheet('it-support');
  assert.ok(s.actions.includes('kick'));
  // ...and the granted action is appended, not replacing class actions.
  for (const id of CLASSES['it-support'].actions) assert.ok(s.actions.includes(id));
});

test('a talent is held by the character, not by the class', () => {
  // The whole point of the axis coming apart: nothing in data/classes.js may
  // name a talent, and any character may hold any entry in the registry.
  for (const def of Object.values(CLASSES)) assert.equal(def.talent, undefined);
  const guard = createSheet('security');
  assert.deepEqual(guard.talents, ['incident-report']);
  assert.equal(guard.talent.effects.foldsAirplanes, undefined);
  // A Security guard can be an Origami Specialist. Under the old shape that
  // sentence could not be written at all.
  grantTalent(guard, 'origami-specialist');
  assert.deepEqual(guard.talents, ['incident-report', 'origami-specialist']);
  assert.equal(guard.talent.effects.foldsAirplanes, true);
  assert.equal(guard.talent.effects.surfaceDamageResist, 1); // and keeps the first
  // The headline stays the first taken; the record underneath carries both.
  assert.equal(guard.talent.name, 'Incident Report');
});

test('talent effects merge - numbers accumulate, flags replace', () => {
  const s = createSheet('office-drone'); // Origami Specialist: paperDamageBonus 2
  assert.equal(s.talent.effects.paperDamageBonus, 2);
  grantTalent(s, 'always-moving');
  assert.equal(s.talent.effects.freeMoveAp, 1);
  assert.equal(s.talent.effects.paperDamageBonus, 2); // the first is untouched
  assert.equal(grantTalent(s, 'always-moving'), false); // idempotent, not a second helping
  assert.deepEqual(s.talents, ['origami-specialist', 'always-moving']);
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
    if (cls.playable === false) continue; // employee is AI-driven, never a sheet
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
  // The Drone's grant used to be `kick` - which the Mail Room and Security
  // handed out too, so three classes unlocked one action and levelling up
  // converged the roster (POWERS_PLAN M3). Paper Storm took its place, and
  // POWERS_PLAN M9 moved Paper Storm into the base kit (the Drone was
  // otherwise left holding the two most generic verbs in the game), so the
  // track now grants Throw the Ream.
  const s = createSheet('office-drone');
  s.classPoints = 2;
  assert.ok(s.actions.includes('paper-storm'), 'the zone ships in the kit now');
  assert.ok(!s.actions.includes('ream-throw'));
  assert.equal(spendClassPoint(s, 'drone-ream'), true);
  assert.ok(s.actions.includes('ream-throw'));
});

test('an ammo-priced attack is not automatically everybody\'s', () => {
  // `ammoCost` says what a throw COSTS, not who may make it. Read as both, it
  // handed every ammo-priced attack to the whole roster the moment it entered
  // the registry - which made the Drone's track grant universal and the class
  // point that buys it worthless. Throw the Ream opts out; the paper throws,
  // which really are everybody's, do not.
  assert.equal(ACTIONS['ream-throw'].universal, false);
  assert.equal(ACTIONS['paper-ball'].universal, undefined);
  assert.equal(ACTIONS['paper-airplane'].universal, undefined);
  // ...and it is genuinely learned: a fresh Drone does not have it.
  const s = createSheet('office-drone');
  assert.ok(!s.actions.includes('ream-throw'));
  s.classPoints = 1;
  spendClassPoint(s, 'drone-ream');
  assert.ok(s.actions.includes('ream-throw'));
});

test('the freed talents reproduce the effects the classes used to bake', () => {
  // The test that makes TALENT_PLAN M1 a MOVE rather than a rebalance. These
  // are the exact bags data/classes.js carried before the extraction; if this
  // drifts, the migration re-tuned something on the way past.
  const was = {
    'office-drone': { paperDamageBonus: 2, paperAmmoDiscount: 1, paperCutImmune: true, foldsAirplanes: true },
    'mail-room': { slipImmune: true },
    'it-support': { shockImmune: true, grantsAction: 'kick' },
    security: { surfaceDamageResist: 1 },
    'human-resources': {},
  };
  for (const [classId, effects] of Object.entries(was)) {
    assert.deepEqual(createSheet(classId).talent.effects, effects, classId);
  }
  // The Manager is the one deliberate departure, and it is POWERS_PLAN M9's
  // doing rather than this plan's: Smoker granted `cigarette`, a seventh
  // self-heal hiding in a talent, which went with the other five.
  assert.deepEqual(createSheet('middle-manager').talent.effects, { hasLighter: true });
});

test('no class track grants a talent effect any more', () => {
  // Sharp Folds, Corner-Office Traction, Frequent Flier and Always Moving were
  // talents wearing a track node's clothes (TALENT_PLAN decision 4). A track
  // is for a class's VERB; "cannot slip" is not one.
  for (const def of Object.values(CLASSES)) {
    for (const node of def.track || []) {
      assert.equal(node.effect?.talent, undefined, `${node.id} grants a talent effect`);
    }
  }
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

// spendablePoints is the narrower reading of pendingPoints: what can be spent
// NOW. It exists because class points accrue per level while a track is
// finite, so a bought-out member kept re-opening the level-up modal with
// nothing to buy (Q068). These pin the divergence, which is the whole point of
// having two numbers.
test('spendablePoints ignores class points a bought-out track cannot take', () => {
  const s = createSheet('office-drone');
  s.attrPoints = 0;
  s.classPoints = 3;
  s.perks = classTrack(s).map((n) => n.id); // every node taken
  assert.equal(pendingPoints(s), 3); // still banked, still shown on the sheet
  assert.equal(spendablePoints(s), 0); // but nothing to interrupt the player for
});

test('spendablePoints counts class points while a node is still open', () => {
  const s = createSheet('office-drone');
  s.attrPoints = 0;
  s.classPoints = 3;
  s.perks = [];
  assert.equal(spendablePoints(s), 3);
});

test('spendablePoints always counts attribute points', () => {
  const s = createSheet('office-drone');
  s.attrPoints = 2;
  s.classPoints = 1;
  s.perks = classTrack(s).map((n) => n.id);
  assert.equal(spendablePoints(s), 2); // the attr half survives a dead track
});

// --- enemy tiers + floor curve (milestone 4) --------------------------------

test('scaleEnemy returns the def unchanged at its native level', () => {
  const m = ENEMY_TYPES.manager; // level 1
  assert.equal(scaleEnemy(m, 1), m); // same reference - byte-identical
  assert.equal(scaleEnemy(m, m.level), m);
});

// The Executive, because this case is specifically about the `hp` SPELLING and
// he is the last bespoke enemy left carrying it - the Manager used to be the
// example here and became class-backed, which spells max HP `maxHp`. Both
// spellings are covered: this test owns `hp`, the one below owns `maxHp`.
test('scaleEnemy grows hp, xp, and damage with level, leaving the base def intact', () => {
  const m = ENEMY_TYPES.executive; // level 2, hp 18, xp 10
  const s = scaleEnemy(m, 4);
  assert.equal(s.level, 4);
  assert.ok(s.hp > m.hp, 'hp grows');
  assert.ok(s.xp > m.xp, 'xp grows');
  assert.ok(s.attacks[0].max >= m.attacks[0].max, 'damage grows');
  assert.equal(m.hp, 18); // the registry entry is not mutated
  assert.equal(s.maxHp, undefined); // a bespoke enemy carries `hp`, not `maxHp`
});

// The other spelling, on the same curve. A class-backed enemy inherits `maxHp`
// and carries no `hp` at all, so a scaling rule that only knew one field name
// would leave the Manager's health flat at every tier a floor asked for.
test('scaleEnemy grows the max HP of a class-backed enemy too', () => {
  const m = ENEMY_TYPES.manager; // classId middle-manager: maxHp, no hp
  assert.equal(m.hp, undefined, 'a class-backed enemy spells it `maxHp`');
  const s = scaleEnemy(m, 3);
  assert.ok(s.maxHp > m.maxHp, 'max HP grows');
  assert.equal(s.hp, undefined, 'and no second HP field is invented');
});

// The floor curve is gone (PROGRESSION_PLAN.md decisions 13-14, designer
// 2026-08-02: enemies do not autoscale with depth). `effectiveLevel` went with
// it, so what used to be asserted here is now asserted by its absence: an
// enemy's level comes from its placement, and nothing derives one from a floor.
test('nothing derives an enemy level from floor depth any more', () => {
  assert.equal(typeof stats.effectiveLevel, 'undefined',
    'effectiveLevel is retired - a floor number must not imply a tier');
});

// A placement may name its own tier (`"G": "manager@3"`), which is how a floor
// asks for a tougher body without a second registry entry existing to BE the
// tougher one. Two hand-written "seniority variants" used to do that job and
// disagreed with this curve - the hand-written Senior Manager paid 50% more XP
// than a Manager scaled to the same level - so which one a floor got depended
// on which id somebody typed. There is one curve now; a level picks a point.
test('a tiered placement reproduces the curve, not a second stat block', () => {
  const m = ENEMY_TYPES.manager; // native 1
  const at3 = scaleEnemy(m, 3);
  assert.equal(at3.level, 3);
  assert.ok(at3.maxHp > m.maxHp, 'tougher than the base tier');
  assert.ok(at3.xp > m.xp, 'and worth more');
  // Asking for the tier directly is now the ONLY way to ask for it.
  assert.deepEqual(at3, scaleEnemy(m, 3));
});

test('scaleEnemy grows AP once the gap reaches AP_PER levels', () => {
  const m = ENEMY_TYPES.manager; // level 1, ap 5
  const s = scaleEnemy(m, m.level + ENEMY_SCALING.AP_PER); // exactly one AP step
  assert.equal(s.ap, m.ap + 1, 'one AP step at AP_PER levels above native');
  assert.equal(m.ap, 5); // base def untouched
});

test('innate accuracy/dodge survive unitCombat', () => {
  // Two enemies, because the two dials are authored on different people: the
  // Executive aims better, the Security Guard is harder to pin down.
  assert.ok(unitCombat(ENEMY_TYPES.executive).accuracy > 0, 'the Executive is accurate');
  assert.ok(unitCombat(ENEMY_TYPES['security-guard']).dodge > 0, 'the guard is evasive');
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
  const x = ENEMY_TYPES.executive; // native 2, innate accuracy 0.05
  const scaled = scaleEnemy(x, x.level + ENEMY_SCALING.ACC_PER); // +1 step
  assert.ok(Math.abs(scaled.accuracy - (x.accuracy + HIT.STEP)) < 1e-9);
  // Dodge is identity, unscaled - checked on the one who has any.
  const g = ENEMY_TYPES['security-guard'];
  assert.ok(Math.abs(scaleEnemy(g, g.level + ENEMY_SCALING.ACC_PER).dodge - g.dodge) < 1e-9);
});

test('scaleEnemy scales the maxHp field for a class-backed AI unit', () => {
  // The employee class spells max HP `maxHp` (not `hp`); scaleEnemy must scale
  // that field and never invent a phantom `hp` (stats.js unitCombat prefers maxHp).
  const s = scaleEnemy(CLASSES.employee, 3);
  assert.ok(s.maxHp > CLASSES.employee.maxHp, 'maxHp grows');
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
  const STAT_KEYS = new Set(['dmg', 'soak', 'maxHp', 'maxAp', 'acc', 'dodge', 'reach', 'slipProof', 'moveCost', 'attrBonus']);
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
    if (cls.playable === false) continue; // employee is AI-driven, never a picked sheet
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

// --- reach (TACTICS_PLAN revision, M1) --------------------------------------

test('a character with no weapon still has REACH.DEFAULT', () => {
  // The floor, not a midpoint: bare hands can reach a diagonally adjacent
  // target, because anything under 1.41 could not and would read as broken.
  const bare = createSheet('office-drone');
  bare.equipped = Object.fromEntries(EQUIP_SLOTS.map((s) => [s, null]));
  assert.equal(reachOf(bare), REACH.DEFAULT);
  assert.equal(equippedStats(bare).reach, 0);
  assert.ok(REACH.DEFAULT > Math.SQRT2, 'the floor must clear a diagonal');
});

test('reach on gear is an upgrade axis - never negative, and rare', () => {
  // Below the floor a weapon could not hit a diagonal neighbour and would read
  // as broken, so no item may shorten reach. And the ordinary desk kit stays at
  // the floor: only a deliberately long thing extends it.
  const long = [];
  for (const [id, def] of Object.entries(ITEMS)) {
    const r = def.stats?.reach ?? 0;
    assert.ok(r >= 0, `${id} must not shorten reach`);
    if (r > 0) long.push(id);
  }
  assert.deepEqual(long, ['reach-grabber']);
});

test('the Reach Extender actually extends reach, through the equip fold', () => {
  const s = createSheet('office-drone');
  const bare = reachOf(s);
  s.inventory = ['reach-grabber'];
  assert.equal(equipItem(s, 0), true);
  assert.equal(equippedStats(s).reach, 0.7);
  assert.equal(reachOf(s), bare + 0.7);
  // Long enough to clear a full orthogonal tile, which is the legible promise:
  // you can swing from one tile further out in a straight line.
  assert.ok(reachOf(s) > 2.0);
  // ...and it pays for it. No damage bonus, and worse accuracy than bare hands.
  assert.equal(equippedStats(s).dmg, 0);
  assert.ok(accuracy(s) < accuracy(createSheet('office-drone')) + 1e-9);
  assert.equal(equippedAction(s), 'grabber-swipe');
});

test('unequipping a long weapon returns reach to the floor', () => {
  const s = createSheet('office-drone');
  s.inventory = ['reach-grabber'];
  equipItem(s, 0);
  assert.ok(reachOf(s) > REACH.DEFAULT);
  assert.equal(unequipItem(s, 'weapon'), true);
  assert.equal(reachOf(s), REACH.DEFAULT);
});

test('an AI unit reads reach off its def, defaulting to the floor', () => {
  assert.equal(unitCombat({ name: 'Coworker', hp: 5 }).reach, REACH.DEFAULT);
  assert.equal(unitCombat({ name: 'Custodian', hp: 5, reach: 2.2 }).reach, 2.2);
  // Zero is a real answer, not a missing one - `??` not `||`.
  assert.equal(unitCombat({ name: 'Ghost', hp: 1, reach: 0 }).reach, 0);
});

test('the bestiary sits at the floor except the one that states otherwise', () => {
  const long = [];
  for (const [id, def] of Object.entries(ENEMY_TYPES)) {
    const r = unitCombat(def).reach;
    assert.ok(r >= REACH.DEFAULT, `${id} must not be under the floor`);
    if (r > REACH.DEFAULT) long.push(id);
  }
  assert.deepEqual(long, ['security-guard']); // the maglite, already in his lines
  assert.ok(unitCombat(ENEMY_TYPES['security-guard']).reach > 2.0); // clears a tile
});

test('a scaled enemy keeps its stated reach - depth grows stats, not arms', () => {
  const deep = scaleEnemy(ENEMY_TYPES['security-guard'], 7);
  assert.equal(unitCombat(deep).reach, unitCombat(ENEMY_TYPES['security-guard']).reach);
});

// --- thrown-weapon ammo cost ---------------------------------------------------
// One rule, three readers: combat's affordability gate, main.js's out-of-combat
// targeting gate, and the hotbar's enabled/disabled paint. They each carried a
// copy, and the hotbar's copy left out the discount - so a Drone with one sheet
// of paper watched a legal throw grey out.
const withDiscount = (n) => ({ talent: { effects: { paperAmmoDiscount: n } } });

test('ammoCostOf is 0 for anything that is not thrown', () => {
  assert.equal(ammoCostOf(createSheet('office-drone'), 'punch'), 0);
  assert.equal(ammoCostOf(createSheet('office-drone'), 'shove'), 0);
  assert.equal(ammoCostOf(createSheet('office-drone'), 'no-such-action'), 0);
});

test('ammoCostOf is the data cost without the talent', () => {
  const plain = createSheet('security');
  for (const [id, a] of Object.entries(ACTIONS)) {
    if (!a.ammoCost) continue;
    assert.equal(ammoCostOf(plain, id), a.ammoCost, `${id} costs what it says`);
  }
});

test('the discount shaves a sheet off a multi-sheet throw, never below one', () => {
  const airplane = Object.entries(ACTIONS).find(([, a]) => a.ammoCost > 1);
  assert.ok(airplane, 'a throw costing more than one sheet exists to discount');
  const [id, a] = airplane;
  assert.equal(ammoCostOf(withDiscount(1), id), a.ammoCost - 1);
  assert.equal(ammoCostOf(withDiscount(99), id), 1, 'a throw is never free');
});

test('the discount cannot make a one-sheet throw free', () => {
  // The floor is the POINT: ammo that costs nothing is not ammo. A single-sheet
  // throw is already at the floor, so the talent leaves it alone entirely.
  for (const [id, a] of Object.entries(ACTIONS)) {
    if (a.ammoCost !== 1) continue;
    assert.equal(ammoCostOf(withDiscount(1), id), 1, `${id} still costs a sheet`);
  }
});

test('ammoCostOf survives a missing sheet', () => {
  // The hotbar paints before a class is picked, and asked about a throw then.
  const [id, a] = Object.entries(ACTIONS).find(([, x]) => x.ammoCost > 1);
  assert.equal(ammoCostOf(null, id), a.ammoCost);
  assert.equal(ammoCostOf({}, id), a.ammoCost);
});

// --- ranged weapons ------------------------------------------------------------
// `rangeOf` is the split that let a weapon be ranged without being ammo: five
// call sites across combat.js and main.js used to read `ammoCost` to mean
// "fired from over there", which is only true while every ranged attack in the
// game is a paper throw.

test('rangeOf is 0 for a swing, the declared range for a shot', () => {
  assert.equal(rangeOf('punch'), 0);
  assert.equal(rangeOf('staple-jab'), 0);
  assert.equal(rangeOf('staple-gun-fire'), ACTIONS['staple-gun-fire'].range);
  assert.equal(rangeOf('spitball-shot'), ACTIONS['spitball-shot'].range);
});

test('rangeOf leaves the paper throws exactly where they were', () => {
  // No `range` declared: an ammo throw still carries THROW_RANGE, so the split
  // is invisible to the two throwables that predate it.
  for (const [id, a] of Object.entries(ACTIONS)) {
    if (!a.ammoCost || a.range !== undefined) continue;
    assert.equal(rangeOf(id), THROW_RANGE, `${id} still throws ${THROW_RANGE}`);
  }
});

test('rangeOf ignores every range that is not a firing range', () => {
  // `range` is a shared word: a summon's is how far employees may report, a
  // zone's how far it can be dropped, a control's and a buff's their own reach.
  // Each resolves through its own gate in powers.js. Read as a firing range,
  // Post the Role would look like a gun and a touch control would stop walking
  // you in - so this asserts across the whole registry, not one example.
  const others = Object.entries(ACTIONS).filter(([, a]) => a.type !== 'attack' && a.range);
  assert.ok(others.length, 'some non-attack verb carries a range to be ignored');
  for (const [id] of others) assert.equal(rangeOf(id), 0, `${id} is not fired`);
  assert.equal(rangeOf('no-such-action'), 0);
  assert.equal(rangeOf(undefined), 0);
});

test('a ranged weapon grants a ranged attack, and it costs no ammo', () => {
  const s = createSheet('office-drone');
  s.inventory = ['staple-gun'];
  equipItem(s, 0);
  const shot = equippedAction(s);
  assert.equal(shot, 'staple-gun-fire');
  assert.ok(rangeOf(shot) > 0, 'the weapon swing is fired, not swung');
  // The whole point of the no-ammo rule: a weapon you have to feed is a weapon
  // you stop carrying. Ammo stays on the specialty shots.
  assert.equal(ammoCostOf(s, shot), 0);
  assert.equal(ACTIONS[shot].ammoCost, undefined);
});

test('range is paid for in damage, and only in damage', () => {
  // The balance rule for ranged weapons: no ammo, no AP surcharge, no
  // adjacency penalty - they simply hit for less than the melee weapon of the
  // same tier. If a ranged weapon ever out-rolls the stapler, the reason to
  // ever walk up to anyone is gone.
  const jab = ACTIONS['staple-jab'];
  for (const [itemId, it] of Object.entries(ITEMS)) {
    if (it.slot !== 'weapon' || !rangeOf(it.attack)) continue;
    const shot = ACTIONS[it.attack];
    assert.equal(shot.ap, jab.ap, `${itemId} costs the same AP as a swing`);
    assert.ok(shot.max < jab.max, `${itemId} rolls under the stapler`);
    assert.equal(it.stats?.dmg || 0, 0, `${itemId} adds no damage on top`);
  }
});

test('the longest range in the game is the weakest hit in it', () => {
  const shots = Object.values(ITEMS)
    .filter((it) => it.slot === 'weapon' && rangeOf(it.attack))
    .map((it) => it.attack);
  assert.ok(shots.length >= 2, 'more than one ranged weapon to compare');
  const furthest = shots.reduce((a, b) => (rangeOf(b) > rangeOf(a) ? b : a));
  for (const id of shots) {
    if (id === furthest) continue;
    assert.ok(ACTIONS[furthest].max <= ACTIONS[id].max,
      'reach and punch pull against each other');
  }
});

// --- action order --------------------------------------------------------------
// One order for both bars (the hotbar and combat's action row), by where a power
// came from: basic swing, shove, throws, class powers, what a talent granted,
// what is in hand. Before this they rendered in list order, which put the basic
// swing wherever the class happened to list it and MOVED buttons the moment a
// perk pushed a new action onto the sheet.
const barIds = (sheet, extra = []) => orderedActionIds(
  sheet, [...sheet.actions, equippedAction(sheet), 'shove', ...extra],
);

test('the basic attack leads, then shove, then the throws', () => {
  const s = createSheet('office-drone');
  const ids = barIds(s, ['paper-ball', 'paper-airplane']);
  assert.equal(ids[0], 'attack'); // the Drone's own swing, not its first listed action
  assert.equal(ids[1], 'shove');
  assert.equal(ids[2], 'paper-ball');
  assert.equal(ids[3], 'paper-airplane');
  // Class utilities follow the things you throw, and the bare-handed swing is
  // last - it is what your EQUIPMENT brings, and it brings the least.
  assert.deepEqual(ids.slice(4), ['defend', 'paper-storm', 'punch']);
});

test('a class with no swing of its own leads with the one in its hands', () => {
  // HR patches people up; it does not punch anybody as a class power. The gear
  // swing is therefore its basic attack, and it goes first rather than last.
  const hr = createSheet('human-resources');
  const ids = barIds(hr, ['paper-ball']);
  assert.equal(ids[0], 'punch');
  assert.equal(ids[1], 'shove');
  assert.ok(ids.indexOf('triage') > ids.indexOf('paper-ball'));
});

test('a talent power and a perk power sit after the class list, gear last', () => {
  const s = createSheet('office-drone');
  s.classPoints = 9;
  spendClassPoint(s, 'drone-thick-skin');
  spendClassPoint(s, 'drone-ream'); // grants 'ream-throw'
  equipItem(s, s.inventory.push('stapler') - 1); // brings its own swing
  const ids = barIds(s, ['paper-ball']);
  assert.ok(ids.indexOf('ream-throw') > ids.indexOf('paper-storm'), 'a learned power follows the class kit');
  assert.equal(ids[ids.length - 1], 'staple-jab', 'the weapon swing is last');
});

test('the order is stable as a kit grows - buttons do not shuffle', () => {
  // The point of ordering by provenance: learning something appends, it does not
  // reshuffle what the player has already memorized.
  const before = barIds(createSheet('office-drone'), ['paper-ball']);
  const after = (() => {
    const s = createSheet('office-drone');
    s.classPoints = 9;
    spendClassPoint(s, 'drone-thick-skin');
    spendClassPoint(s, 'drone-ream');
    spendClassPoint(s, 'drone-paper-storm');
    return barIds(s, ['paper-ball']);
  })();
  assert.deepEqual(after.filter((id) => before.includes(id)), before);
});

test('the same id twice is one button, and an unknown id is none', () => {
  const s = createSheet('office-drone');
  const ids = orderedActionIds(s, ['attack', 'attack', 'shove', 'no-such-action']);
  assert.deepEqual(ids, ['attack', 'shove']);
});

test('THROW_RANGE is a shared constant, not a per-module copy', () => {
  assert.ok(Number.isInteger(THROW_RANGE) && THROW_RANGE > 0);
});

// --- unitCombat: the AI archetype seam ----------------------------------------
// This is no longer decorative. An AI unit can be backed by an ENEMY_TYPES entry
// OR by a CLASS - an enemy-side summon resolves its archetype from CLASSES
// first - and the two registries disagree: a class spells max HP `maxHp` where
// an enemy spells it `hp`, and states no accuracy, dodge or reach at all.
// Normalizing once is what lets every consumer stop re-implementing those
// defaults (combat.js had three such copies).

test('unitCombat reads max HP from either registry spelling', () => {
  assert.equal(unitCombat({ hp: 9 }).maxHp, 9); // enemy registry
  assert.equal(unitCombat({ maxHp: 12 }).maxHp, 12); // class registry
  assert.equal(unitCombat({ maxHp: 12, hp: 9 }).maxHp, 12, 'maxHp outranks hp');
});

test('unitCombat defaults the stats a class never states', () => {
  const u = unitCombat({ name: 'Temp', maxHp: 5 });
  assert.equal(u.accuracy, 0);
  assert.equal(u.dodge, 0);
  assert.equal(u.reach, REACH.DEFAULT);
  assert.equal(u.xp, 0);
  assert.deepEqual(u.loot, []);
  assert.deepEqual(u.attacks, [], 'an absent attack set is a LIST, never undefined');
});

test('unitCombat keeps a stated reach of zero rather than defaulting it', () => {
  // `?? REACH.DEFAULT`, not `|| REACH.DEFAULT`: 0 is a real answer.
  assert.equal(unitCombat({ hp: 1, reach: 0 }).reach, 0);
});

test('every playable class survives unitCombat without an undefined stat', () => {
  // A class can back an AI unit (ARCHITECTURE.md's on-ramp to class-based
  // enemies). The attack picker indexes `attacks` and the AI beat compares
  // `attackAp`, so neither may come back undefined-shaped.
  for (const [id, def] of Object.entries(CLASSES)) {
    const u = unitCombat(def);
    assert.ok(Array.isArray(u.attacks), `${id}: attacks must be an array`);
    assert.equal(typeof u.maxHp, 'number', `${id}: maxHp`);
    assert.equal(typeof u.accuracy, 'number', `${id}: accuracy`);
    assert.equal(typeof u.dodge, 'number', `${id}: dodge`);
    assert.equal(typeof u.reach, 'number', `${id}: reach`);
    assert.ok(Array.isArray(u.loot), `${id}: loot`);
  }
});

test('every enemy survives unitCombat with a usable attack set', () => {
  for (const [id, def] of Object.entries(ENEMY_TYPES)) {
    const u = unitCombat(def);
    assert.ok(u.attacks.length > 0, `${id}: a hostile needs something to swing`);
    assert.equal(typeof u.attackAp, 'number', `${id}: attackAp`);
    assert.equal(typeof u.ap, 'number', `${id}: ap`);
  }
});

// --- lookOf (CHARACTER_PLAN M1) --------------------------------------------
// Appearance resolution moved out of a closure inside main.js's startGame,
// where nothing else - portraits.js included - could ask the question. The
// sheet wins so a character who has CHOSEN a look keeps it; everyone who has
// not falls through to exactly the old answer.
test('lookOf prefers the sheet own look over the class entry', () => {
  const sheet = createSheet('office-drone');
  const classLook = lookOf(sheet);
  assert.deepEqual(classLook, CLASSES['office-drone'].look ?? null,
    'with no sheet look, the class entry answers - today behaviour');

  sheet.look = { tint: [0.1, 0.2, 0.3], build: { legs: 1.8 } };
  assert.deepEqual(lookOf(sheet), { tint: [0.1, 0.2, 0.3], build: { legs: 1.8 } },
    'a chosen look wins');
});

test('lookOf falls through to the companion entry, then to null', () => {
  const withCompanion = { companionId: Object.keys(COMPANIONS)[0] };
  assert.deepEqual(lookOf(withCompanion), COMPANIONS[withCompanion.companionId].look ?? null);
  assert.equal(lookOf({}), null, 'a sheet belonging to nothing has no look');
  assert.equal(lookOf(null), null, 'and neither does nothing at all');
});

// --- no automatic healing (designer 2026-08-02) ------------------------------
// This block used to pin the stairwell breather, including the `Math.max(hp, 0)`
// that carried a DOWNED companion to the landing. Both are struck, so what is
// pinned now is their absence and the object that replaced them: a downed
// character is only revived by something carrying `revive`.
test('the stairwell breather is gone, along with its hidden revive', () => {
  assert.equal(typeof stats.stairwellHeal, 'undefined',
    'nothing tops a sheet up just for changing floors');
});

test('the revive economy exists and is an item, not a rule', () => {
  const reviving = Object.entries(ITEMS).filter(([, d]) => d.revive > 0);
  assert.ok(reviving.length > 0, 'at least one item can bring somebody back up');
  for (const [id, def] of reviving) {
    assert.ok(def.value > 0, `${id} is worth something, so it can be stocked and sold`);
    assert.ok(!def.heal, `${id} revives rather than doubling as a heal - one job`);
  }
});

test('gritSaveChance scales with Grit and respects its cap (TACTICS_PLAN M6)', () => {
  assert.equal(gritSaveChance(0), SAVE.BASE);
  assert.equal(gritSaveChance(null), SAVE.BASE); // enemies without a grit stat
  assert.ok(gritSaveChance(3) > gritSaveChance(1), 'Grit buys escape odds');
  assert.equal(gritSaveChance(99), SAVE.CAP, 'nobody shrugs off a bookcase reliably');
});

test('applyDamage refuses a non-finite amount, like its actor-side twin', () => {
  // NaN hp is never <= 0, so a member who takes it can never go down and
  // anything waiting on that waits forever. EnemyActor.takeDamage has guarded
  // this for a while; the party half did not, which is the asymmetry.
  const sheet = { hp: 10, maxHp: 10 };
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, 'three']) {
    assert.equal(applyDamage(sheet, bad), false, `${bad} should be a no-op`);
    assert.equal(sheet.hp, 10, `${bad} must not move hp`);
  }
  // A real number still works, and still reports the drop.
  assert.equal(applyDamage(sheet, 4), false);
  assert.equal(sheet.hp, 6);
  assert.equal(applyDamage(sheet, 99), true, 'and an overkill still reports down');
  assert.equal(sheet.hp, 0, 'clamped, never negative');
});
