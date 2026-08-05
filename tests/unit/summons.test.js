// Summon system - the data invariants and the archetype seam. The behavioral
// pieces (enemy-AI trigger, spawn placement, cap/cooldown in flight) touch
// PlayCanvas/DOM and are exercised by the e2e suite; here we lock the pure
// substrate the summon feature stands on (SUMMON_PLAN.md milestone 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitCombat } from '../../src/stats.js';
import { CLASSES } from '../../src/data/classes.js';
import { ENEMY_TYPES } from '../../src/data/enemies.js';
import { ACTIONS, arrivalLine, summonSpec } from '../../src/data/actions.js';

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
  const c = unitCombat(CLASSES.employee);
  assert.equal(c.maxHp, CLASSES.employee.maxHp); // classes spell it `maxHp`
  assert.ok(Number.isFinite(c.maxHp));
  assert.ok(Array.isArray(c.attacks) && c.attacks.length > 0);
  assert.equal(typeof c.attackAp, 'number');
});

// Every enemy has health, whichever way it got one. The class-backed pair used
// to reach this bar only because both happened to override `hp`: max HP was
// dropped from the inherited class unconditionally, so deleting an `hp` line -
// the exact thing "an override is for DEPARTING from the class" asks for - left
// the enemy with neither field and unitCombat resolving `undefined`. The
// Manager naming `middle-manager` was the first entry to actually try it.
test('every enemy resolves a max HP, inherited or stated', () => {
  for (const [id, def] of Object.entries(ENEMY_TYPES)) {
    const c = unitCombat(def);
    assert.ok(Number.isFinite(c.maxHp) && c.maxHp > 0, `${id} has a real max HP`);
  }
});

test('a class-backed enemy with no `hp` line inherits the class health', () => {
  const m = ENEMY_TYPES.manager;
  assert.equal(m.classId, 'middle-manager');
  assert.equal(m.hp, undefined, 'states no health of its own');
  assert.equal(unitCombat(m).maxHp, CLASSES['middle-manager'].maxHp);
});

test('a class-backed enemy that DOES state `hp` still outranks the class', () => {
  // The reason the drop exists at all: the two registries spell max HP
  // differently and unitCombat prefers `maxHp`, so an inherited one would win.
  const g = ENEMY_TYPES['security-guard'];
  assert.ok(g.hp != null && g.hp !== CLASSES.security.maxHp, 'a real departure');
  assert.equal(unitCombat(g).maxHp, g.hp);
});

test('unitCombat defaults xp/loot for a player class with no AI fields', () => {
  const c = unitCombat(CLASSES['office-drone']);
  assert.equal(c.xp, 0); // player classes never award XP as a kill
  assert.deepEqual(c.loot, []);
});

test('the employee is a non-playable archetype with BOTH kits', () => {
  const a = CLASSES.employee;
  assert.equal(a.playable, false); // kept out of the class picker
  // The superset a shared archetype needs: `actions` for a player-controlled
  // summon's action bar, `attacks`/`attackAp` for its AI-summon twin.
  assert.ok(a.actions.length > 0, 'has a player-facing action bar');
  assert.ok(a.attacks.length > 0 && typeof a.attackAp === 'number', 'has an AI attack set');
});

test('employees are anti-farm: no XP, no loot', () => {
  const c = unitCombat(CLASSES.employee);
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

test('employee is the only non-playable class today', () => {
  const hidden = Object.keys(CLASSES).filter((id) => CLASSES[id].playable === false);
  assert.deepEqual(hidden, ['employee']);
});

// Every summon descriptor in the enemy registry must reference an archetype
// that actually resolves and can fight, with a sane cap/cooldown/cost. Catches
// a typo'd archetype id or a nonsensical cap before it ships (SUMMON_PLAN #7).
test('enemy summon descriptors reference a valid, combat-ready archetype', () => {
  for (const [id, def] of Object.entries(ENEMY_TYPES)) {
    if (!def.summon) continue;
    // Through summonSpec, the same merge combat.js reads: a descriptor may
    // inherit the contract from the ACTION it is the AI-side twin of.
    const s = summonSpec(def.summon);
    const arch = archetypeOf(s.archetype);
    assert.ok(arch, `${id}.summon.archetype "${s.archetype}" resolves`);
    const c = unitCombat(arch);
    assert.ok(c.attacks.length > 0, `${id}'s summon can actually fight`);
    assert.ok(Number.isFinite(c.maxHp) && c.maxHp > 0, `${id}'s summon has HP`);
    assert.ok(s.count >= 1, `${id}.summon.count >= 1`);
    assert.ok((s.cap ?? s.count) >= s.count, `${id}.summon.cap >= count`);
    assert.ok((s.cooldownRounds ?? 0) >= 0, `${id}.summon.cooldownRounds >= 0`);
    assert.ok(s.ap > 0, `${id}.summon.ap costs something`);
    assert.ok(s.lifetimeTurns > 0, `${id}.summon.lifetimeTurns is a real budget`);
  }
});

// Every summon carries a turn budget. Without one a summoner on a cooldown is
// an infinite spawner - and now that summons outlive the fight that made them,
// an unbounded one would follow you across the floor forever.
test('every summon descriptor spends a bounded number of turns', () => {
  const descriptors = [
    ...Object.entries(ENEMY_TYPES).filter(([, d]) => d.summon).map(([id, d]) => [`ENEMY_TYPES.${id}`, summonSpec(d.summon)]),
    ...Object.entries(ACTIONS).filter(([, a]) => a.type === 'summon').map(([id, a]) => [`ACTIONS.${id}`, a]),
  ];
  assert.ok(descriptors.length >= 2, 'both sides of the ledger are covered');
  for (const [where, d] of descriptors) {
    assert.ok(Number.isInteger(d.lifetimeTurns) && d.lifetimeTurns > 0,
      `${where}.lifetimeTurns is a positive whole number of turns`);
    // A budget long enough to outlast any plausible fight is the same as no
    // budget at all - the point is that temps leave.
    assert.ok(d.lifetimeTurns <= 20, `${where}.lifetimeTurns is a real limit, not a formality`);
  }
});

test('HR is a summoner; its employees are worth no XP (spawner, not farm)', () => {
  assert.ok(ENEMY_TYPES.hr.summon, 'HR has a summon power');
  assert.equal(unitCombat(archetypeOf(summonSpec(ENEMY_TYPES.hr.summon).archetype)).xp, 0);
});

// Every summon ACTION (the player-facing power) must reference a real,
// combat-ready archetype with a sane cost/cap - the same guard as the enemy
// descriptors, on the other side of the ledger.
test('summon actions reference a valid, combat-ready archetype', () => {
  const summonActions = Object.entries(ACTIONS).filter(([, a]) => a.type === 'summon');
  assert.ok(summonActions.length >= 1, 'at least one summon action exists');
  for (const [id, a] of summonActions) {
    const arch = archetypeOf(a.archetype);
    assert.ok(arch, `${id}.archetype "${a.archetype}" resolves`);
    assert.ok(unitCombat(arch).attacks.length > 0, `${id}'s summon can fight`);
    assert.ok(a.count >= 1, `${id}.count >= 1`);
    assert.ok((a.cap ?? a.count) >= a.count, `${id}.cap >= count`);
    assert.ok(a.ap > 0, `${id}.ap costs something`);
    assert.ok(a.lifetimeTurns > 0, `${id}.lifetimeTurns is a real budget`);
  }
});

// A posting announces PEOPLE arriving, and it is announced from one place -
// the in-combat post and the out-of-combat one both call this, so the same
// event can't read two ways. "1 reports for duty" was the number-where-a-person
// -should-be that made a single-employee post look like a spreadsheet row.
test('a posting announces its arrivals in whole people', () => {
  assert.match(arrivalLine(1), /^One employee reports/);
  assert.equal(arrivalLine(3), '3 employees report for duty.');
  // Whatever the count, the line never says "1 employees" or "One report".
  for (const n of [1, 2, 5]) {
    assert.ok(!/\b1 employees\b/.test(arrivalLine(n)), `${n} reads as people`);
  }
});

// Post the Role hires ONE per click today, and the placement path is the only
// thing that decides how many a click can carry - so raising `count` (a talent,
// a second-tier req) stays a data change. What the cap must never do is sit
// BELOW the count, which would make a legal post partly unfillable.
test('a summon action never posts more than its cap allows', () => {
  for (const [id, a] of Object.entries(ACTIONS)) {
    if (a.type !== 'summon') continue;
    assert.ok(Number.isInteger(a.count) && a.count >= 1, `${id}.count is a whole hire`);
    assert.ok((a.cap ?? a.count) >= a.count, `${id}.cap can hold a full post`);
  }
  assert.equal(ACTIONS['escalate'].count, 1); // one employee per post
});

test('the Middle Manager is the playable summoner class', () => {
  // It was HR until POWERS_PLAN M9. Control and summon are the same fantasy
  // pointed two ways - he spends other people's turns - and HR's remaining kit
  // was already ally-facing, so the summon went to the class whose existing
  // verb is "make it someone else's problem".
  const mgr = CLASSES['middle-manager'];
  assert.ok(mgr, 'the Manager class exists');
  assert.notEqual(mgr.playable, false); // shows in the picker
  assert.ok(mgr.actions.includes('escalate'), 'the Manager carries Escalate');
  assert.equal(ACTIONS['escalate'].type, 'summon');
  assert.equal(mgr.primary, 'summon');
  // ...and HR is out of the summoning business entirely.
  assert.ok(!CLASSES['human-resources'].actions.includes('escalate'));
});
