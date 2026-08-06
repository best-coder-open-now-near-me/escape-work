import test from 'node:test';
import assert from 'node:assert/strict';
import { createGodTargets } from '../../src/god-targets.js';

function fixture() {
  const calls = [];
  const active = { sheet: { name: 'Pat', hp: 8 }, actor: { x: 1, z: 2 } };
  const down = { sheet: { name: 'Sam', hp: 0 }, actor: { x: 2, z: 3 } };
  const enemy = { def: { name: 'Manager' }, x: 4, z: 5, hp: 3, maxHp: 9, alive: true };
  const combat = { usesLeft: { coffee: 1 }, refresh: () => calls.push('refresh') };
  const api = {
    party: { active: 0, cash: 7, members: [active, down] },
    playerActor: { entity: {}, x: 1, z: 2 },
    enemies: [enemy],
    combat,
    setCash: (n) => calls.push(['cash', n]),
    switchTo: (i) => calls.push(['switch', i]),
    reviveMember: (i) => calls.push(['revive', i]),
  };
  const targets = createGodTargets(api, {
    render: () => calls.push('render'),
    armPlace: (...args) => calls.push(['place', ...args]),
    rigInternals: new Set(['yaw']),
  });
  return { targets, api, active, down, enemy, combat, calls };
}

test('player target models keep active scope, invariants, and actions', () => {
  const { targets, calls } = fixture();
  const cards = targets.playerTargets();

  assert.equal(cards[0].scope, 'purse');
  assert.equal(cards[1].scope, 'sheet');
  assert.equal(cards[1].special, 'inventory');
  assert.ok(cards[1].readOnly.has('maxHp'));
  assert.match(cards[2].title, /†$/);
  cards[2].actions[0].run();
  cards.at(-1).actions[0].run();

  assert.deepEqual(calls, [
    ['revive', 1], 'render',
    ['place', 'teleport', null, 'Click a tile to teleport the player'],
  ]);
});

test('enemy pins resolve by identity and actions hit the live enemy', () => {
  const { targets, api, enemy, calls } = fixture();
  const card = targets.enemyTargets()[0];
  assert.equal(card.getObj(), enemy);
  api.enemies.splice(0, 1);
  assert.equal(card.getObj(), null);
  enemy.hp = 1;
  card.actions[0].run();
  assert.equal(enemy.hp, 9);
  assert.deepEqual(calls, ['refresh', 'render']);
});

test('combat targets expose the controller and its ration editor', () => {
  const { targets, api, combat } = fixture();
  assert.equal(targets.combatTargets()[0].obj, combat);
  assert.equal(targets.combatTargets()[1].usesEditor, combat);
  api.combat = null;
  assert.equal(targets.combatTargets()[0].note, 'No fight in progress.');
});
