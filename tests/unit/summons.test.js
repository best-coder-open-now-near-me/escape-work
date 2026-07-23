// Summon system - the data invariants and the archetype seam. The behavioral
// pieces (enemy-AI trigger, spawn placement, cap/cooldown in flight) touch
// PlayCanvas/DOM and are exercised by the e2e suite; here we lock the pure
// substrate the summon feature stands on (SUMMON_PLAN.md milestone 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitCombat } from '../../src/stats.js';
import { CLASSES } from '../../src/data/classes.js';
import { ENEMY_TYPES } from '../../src/data/enemies.js';

// Resolve a summon descriptor's archetype id the way world.spawnSummon does.
const archetypeOf = (id) => CLASSES[id] || ENEMY_TYPES[id];

test('unitCombat normalizes an ENEMY_TYPES def (max HP spelled `hp`)', () => {
  const c = unitCombat(ENEMY_TYPES.hr);
  assert.equal(c.maxHp, ENEMY_TYPES.hr.hp); // enemies spell it `hp`
  assert.equal(c.attackAp, ENEMY_TYPES.hr.attackAp);
  assert.ok(Array.isArray(c.attacks) && c.attacks.length > 0);
  assert.equal(c.xp, ENEMY_TYPES.hr.xp);
});

test('unitCombat normalizes a class archetype (max HP spelled `maxHp`)', () => {
  const c = unitCombat(CLASSES.applicant);
  assert.equal(c.maxHp, CLASSES.applicant.maxHp); // classes spell it `maxHp`
  assert.ok(Number.isFinite(c.maxHp));
  assert.ok(Array.isArray(c.attacks) && c.attacks.length > 0);
  assert.equal(typeof c.attackAp, 'number');
});

test('unitCombat defaults xp/loot for a player class with no AI fields', () => {
  const c = unitCombat(CLASSES['office-drone']);
  assert.equal(c.xp, 0); // player classes never award XP as a kill
  assert.deepEqual(c.loot, []);
});

test('the applicant is a non-playable AI archetype', () => {
  const a = CLASSES.applicant;
  assert.equal(a.playable, false); // kept out of the class picker
  assert.deepEqual(a.actions, []); // AI-driven: swings from `attacks`, no bar
  assert.ok(a.attacks.length > 0 && typeof a.attackAp === 'number');
});

test('applicants are anti-farm: no XP, no loot', () => {
  const c = unitCombat(CLASSES.applicant);
  assert.equal(c.xp, 0);
  assert.deepEqual(c.loot, []);
});

test('every playable class is a real career (has a name, model, actions)', () => {
  for (const [id, cls] of Object.entries(CLASSES)) {
    if (cls.playable === false) continue;
    assert.ok(cls.name && cls.model, `${id} has a name and model`);
    assert.ok(Array.isArray(cls.actions) && cls.actions.length > 0,
      `${id} brings at least one action to the picker`);
  }
});

test('applicant is the only non-playable class today', () => {
  const hidden = Object.keys(CLASSES).filter((id) => CLASSES[id].playable === false);
  assert.deepEqual(hidden, ['applicant']);
});

// Every summon descriptor in the enemy registry must reference an archetype
// that actually resolves and can fight, with a sane cap/cooldown/cost. Catches
// a typo'd archetype id or a nonsensical cap before it ships (SUMMON_PLAN #7).
test('enemy summon descriptors reference a valid, combat-ready archetype', () => {
  for (const [id, def] of Object.entries(ENEMY_TYPES)) {
    if (!def.summon) continue;
    const s = def.summon;
    const arch = archetypeOf(s.archetype);
    assert.ok(arch, `${id}.summon.archetype "${s.archetype}" resolves`);
    const c = unitCombat(arch);
    assert.ok(c.attacks.length > 0, `${id}'s summon can actually fight`);
    assert.ok(Number.isFinite(c.maxHp) && c.maxHp > 0, `${id}'s summon has HP`);
    assert.ok(s.count >= 1, `${id}.summon.count >= 1`);
    assert.ok((s.cap ?? s.count) >= s.count, `${id}.summon.cap >= count`);
    assert.ok((s.cooldownRounds ?? 0) >= 0, `${id}.summon.cooldownRounds >= 0`);
    assert.ok(s.ap > 0, `${id}.summon.ap costs something`);
  }
});

test('HR is a summoner; its applicants are worth no XP (spawner, not farm)', () => {
  assert.ok(ENEMY_TYPES.hr.summon, 'HR has a summon power');
  assert.equal(unitCombat(archetypeOf(ENEMY_TYPES.hr.summon.archetype)).xp, 0);
});
