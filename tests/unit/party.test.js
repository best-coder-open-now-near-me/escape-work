// Unit tests for the party roster - pure logic, no PlayCanvas, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createParty, leader, addMember, livingMembers, gainXpAll, createCompanionSheet,
  serializeProgress, parseProgress, PARTY_CAP, SAVE_VERSION,
} from '../../src/party.js';
import { createSheet, spendClassPoint, damageBonus, PROGRESSION } from '../../src/stats.js';
import { COMPANIONS } from '../../src/data/companions.js';

test('createParty starts with the leader as its only member', () => {
  const sheet = createSheet('office-drone');
  const party = createParty(sheet, 'actor-ref');
  assert.equal(party.members.length, 1);
  assert.equal(party.active, 0);
  assert.equal(leader(party).sheet, sheet);
  assert.equal(leader(party).actor, 'actor-ref');
});

test('addMember appends until the cap, then refuses', () => {
  const party = createParty(createSheet('office-drone'));
  for (let i = 1; i < PARTY_CAP; i++) {
    assert.ok(addMember(party, createSheet('it-support')));
  }
  assert.equal(party.members.length, PARTY_CAP);
  assert.equal(addMember(party, createSheet('mail-room')), null);
  assert.equal(party.members.length, PARTY_CAP);
});

test('gainXpAll pays every living member in full and reports promotions', () => {
  const party = createParty(createSheet('office-drone'));
  const buddy = addMember(party, createSheet('it-support'));
  const down = addMember(party, createSheet('mail-room'));
  down.sheet.hp = 0; // downed members earn nothing
  const promoted = gainXpAll(party, 10); // level 2 lands at 10 xp
  assert.equal(leader(party).sheet.level, 2);
  assert.equal(buddy.sheet.level, 2);
  assert.equal(down.sheet.level, 1);
  assert.deepEqual(promoted, [leader(party), buddy]);
});

test('livingMembers filters the downed', () => {
  const party = createParty(createSheet('office-drone'));
  const buddy = addMember(party, createSheet('it-support'));
  buddy.sheet.hp = 0;
  assert.deepEqual(livingMembers(party), [leader(party)]);
});

test('serializeProgress writes the v2 shape and parseProgress round-trips it', () => {
  const party = createParty(createSheet('office-drone'));
  addMember(party, createSheet('it-support'));
  const saved = serializeProgress(party, 'level2');
  assert.equal(saved.version, SAVE_VERSION);
  assert.equal(saved.levelId, 'level2');
  assert.equal(saved.party.length, 2);
  assert.equal(saved.active, 0);
  const parsed = parseProgress(JSON.parse(JSON.stringify(saved)));
  assert.equal(parsed.levelId, 'level2');
  assert.equal(parsed.sheets.length, 2);
  assert.equal(parsed.active, 0);
  assert.equal(parsed.sheets[0].className, 'Office Drone');
});

test('parseProgress migrates a legacy single-sheet save and backfills fields', () => {
  // A pre-party save: bare sheet, missing everything pockets/gum-era added.
  const legacy = { levelId: 'level2', sheet: { classId: 'office-drone', className: 'Office Drone', hp: 9, maxHp: 22, level: 2 } };
  const parsed = parseProgress(legacy);
  assert.equal(parsed.sheets.length, 1);
  assert.equal(parsed.active, 0);
  const s = parsed.sheets[0];
  assert.equal(s.hp, 9);
  assert.deepEqual(s.inventory, []);
  assert.equal(s.paper, 0);
  assert.deepEqual(s.statuses, {}); // v4: gum/bleed live in the status map now
  assert.equal(s.gum, undefined);   // the old numeric fields are gone
  assert.equal(s.bleed, undefined);
  assert.equal(s.name, 'Office Drone'); // name backfills from the class
  for (const k of ['grit', 'hustle', 'savvy', 'composure']) {
    assert.equal(typeof s.attr[k], 'number', `attr.${k} backfilled`);
  }
  assert.equal(s.maxHp, 22); // derivation preserves the saved max HP
});

test('v3->v4 migration moves in-flight gum/bleed counters into the status map', () => {
  const v3 = {
    version: 3, levelId: 'level2', active: 0,
    party: [{ classId: 'office-drone', className: 'Office Drone', hp: 20, maxHp: 22, level: 1, gum: 12, bleed: 2 }],
  };
  const s = parseProgress(v3).sheets[0];
  assert.equal(s.gum, undefined);   // the numeric fields are gone
  assert.equal(s.bleed, undefined);
  assert.equal(s.statuses.gum.left, 12); // carried across as status entries
  assert.equal(s.statuses.bleed.left, 2);
});

test('v4->v5 migration auto-equips the best carried weapon, preserving its damage', () => {
  const v4 = {
    version: 4, levelId: 'level2', active: 0,
    party: [{
      classId: 'office-drone', className: 'Office Drone', hp: 22, maxHp: 22, level: 1,
      inventory: ['stapler', 'red-stapler', 'cold-coffee'],
    }],
  };
  const s = parseProgress(v4).sheets[0];
  assert.equal(s.equipped.weapon, 'red-stapler');  // the best weapon auto-equips
  assert.ok(!s.inventory.includes('red-stapler')); // moved out of the bag
  assert.ok(s.inventory.includes('stapler'));      // the lesser one stays loose (does nothing)
  assert.ok(s.inventory.includes('cold-coffee'));  // non-weapons untouched
  // damage preserved: office-drone's Savvy 5 gives +1, the equipped red stapler
  // +2 - exactly what the old best-in-bag rule (Savvy +1, best bonusDmg +2) gave.
  assert.equal(damageBonus(s), 3);
});

test('a non-zero active leader survives the save round-trip', () => {
  const party = createParty(createSheet('office-drone'));
  addMember(party, createSheet('it-support'));
  party.active = 1; // controlling the second member when we save
  const saved = JSON.parse(JSON.stringify(serializeProgress(party, 'level2')));
  assert.equal(saved.active, 1);
  const parsed = parseProgress(saved);
  assert.equal(parsed.active, 1); // not silently reset to the leader
  assert.equal(parsed.sheets.length, 2);
});

test('parseProgress clamps a bad active index to the leader', () => {
  const party = createParty(createSheet('office-drone'));
  const saved = serializeProgress(party, 'level1');
  saved.active = 7;
  assert.equal(parseProgress(saved).active, 0);
  saved.active = -1;
  assert.equal(parseProgress(saved).active, 0);
});

test('createCompanionSheet joins at the given level, fully rested, points banked', () => {
  const def = COMPANIONS['it-intern'];
  const s = createCompanionSheet(def, 'it-intern', 3);
  assert.equal(s.companionId, 'it-intern');
  assert.equal(s.name, def.name);
  assert.equal(s.level, 3);
  assert.equal(s.bonusDmg, def.bonusDmg); // no auto-damage; growth is via points
  // Two promotions (1->2->3) bank their points; nothing auto-allocates, so the
  // recruit arrives with a lit level-up pip for the player to spend.
  assert.equal(s.attrPoints, 2 * PROGRESSION.ATTR_PER_LEVEL);
  assert.equal(s.classPoints, 2 * PROGRESSION.CP_PER_LEVEL);
  assert.equal(s.hp, s.maxHp);
  assert.equal(s.classId, undefined); // a companion is not a picked class
});

test('every companion recruit option leads to a real node', () => {
  for (const [id, def] of Object.entries(COMPANIONS)) {
    for (const tree of [def.dialogue, def.recruitedDialogue]) {
      if (!tree) continue;
      assert.ok(tree.nodes[tree.start], `${id}: start node exists`);
      for (const node of Object.values(tree.nodes)) {
        for (const o of node.options || []) {
          if (o.next !== null) assert.ok(tree.nodes[o.next], `${id}: option "${o.label}" leads somewhere`);
        }
      }
    }
    assert.ok(def.actions.length, `${id} brings combat actions`);
  }
});

test('class-track perks persist through a save without double-applying', () => {
  const party = createParty(createSheet('office-drone'));
  const s = leader(party).sheet;
  s.classPoints = 1;
  spendClassPoint(s, 'drone-thick-skin'); // +1 Grit, baked into attr
  const grit = s.attr.grit, hp = s.maxHp;
  const saved = JSON.parse(JSON.stringify(serializeProgress(party, 'level1')));
  const loaded = parseProgress(saved).sheets[0];
  assert.deepEqual(loaded.perks, ['drone-thick-skin']);
  assert.equal(loaded.attr.grit, grit); // effect is NOT re-applied on load
  assert.equal(loaded.maxHp, hp);
});

test('parseProgress rejects records in no known format', () => {
  assert.equal(parseProgress(null), null);
  assert.equal(parseProgress('nope'), null);
  assert.equal(parseProgress({}), null);
  assert.equal(parseProgress({ levelId: 'level1', party: [] }), null);
});
