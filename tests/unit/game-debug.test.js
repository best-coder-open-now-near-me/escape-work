import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameDebug } from '../../src/game-debug.js';

test('the class registry is exposed as data, never as the live balance registry', () => {
  const classes = {
    security: {
      maxHp: 12,
      attr: { grit: 3 },
      actions: ['shove'],
    },
  };
  const debug = createGameDebug({ classes });

  const first = debug.classes;
  first.security.maxHp = 999;
  first.security.attr.grit = 999;
  first.security.actions.push('free-win');

  assert.deepEqual(classes.security, { maxHp: 12, attr: { grit: 3 }, actions: ['shove'] });
  assert.deepEqual(debug.classes.security, { maxHp: 12, attr: { grit: 3 }, actions: ['shove'] });
  assert.notEqual(first, debug.classes);
});

test('inventory and party projections cannot mutate their live arrays', () => {
  const sheet = { inventory: ['coffee'] };
  const member = {
    sheet: {
      name: 'Pat', hp: 8, maxHp: 10, level: 2,
      attrPoints: 1, classPoints: 2, perks: ['steady'],
    },
    actor: { x: 3, z: 4 },
  };
  const party = { active: 0, cash: 7, members: [member] };
  const debug = createGameDebug({ sheet, party });

  const inventory = debug.inventory;
  const projected = debug.party;
  inventory.push('snack');
  projected[0].perks.push('mutated');

  assert.deepEqual(sheet.inventory, ['coffee']);
  assert.deepEqual(member.sheet.perks, ['steady']);
  assert.equal(debug.cash, 7);
  assert.deepEqual(debug.party[0], {
    name: 'Pat', hp: 8, maxHp: 10, level: 2, attrPoints: 1,
    classPoints: 2, perks: ['steady'], x: 3, z: 4, active: true,
  });
});

test('enemy placement uses the live actor but enemy reads stay snapshots', () => {
  const calls = [];
  const enemy = {
    alive: true,
    def: { name: 'Manager', level: 2 },
    x: 5, z: 6, hp: 7, maxHp: 9, moving: false,
    clearPath: () => calls.push('clear'),
    pushTo: (x, z) => calls.push(['push', x, z]),
  };
  const debug = createGameDebug({
    enemies: [enemy],
    playerReaches: () => true,
    bestApproachPath: () => null,
  });

  assert.equal(debug.debugPlaceEnemy('Manager', 2, 3), true);
  assert.deepEqual(calls, ['clear', ['push', 2, 3]]);
  const view = debug.enemies;
  view[0].hp = 0;
  assert.equal(enemy.hp, 7);
  assert.equal(view[0].reachable, true);
});
