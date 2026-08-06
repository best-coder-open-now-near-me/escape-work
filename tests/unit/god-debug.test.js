import test from 'node:test';
import assert from 'node:assert/strict';
import { createGodDebug } from '../../src/god-debug.js';

function fixture() {
  const calls = [];
  const member = { sheet: { hp: 0, inventory: [] } };
  const state = {
    sheet: member.sheet,
    player: { entity: {}, x: 1, z: 2 },
    party: { cash: 5, active: 0, members: [member] },
    inCombat: false,
    gameOver: false,
    combat: { steerMember: () => false, refresh: () => calls.push('combat-refresh') },
    app: { timeScale: 1 },
    runtime: { burningCount: 2, advanceTurn: () => calls.push('fire') },
    actions: { shove: { ap: 2 } },
    classes: {},
    enemyTypes: {},
    loot: {
      refreshPanel: (sheet) => calls.push(['loot-refresh', sheet]),
      dropAt: (...args) => calls.push(['drop', ...args]),
    },
    shopping: { emptyStock: (key) => calls.push(['empty', key]) },
    grid: { doors: new Map([['h:1,1', { open: false }]]) },
    doors: { setDoorOpen: (...args) => calls.push(['door', ...args]) },
    scene: {},
    enemies: [],
    npcs: [],
    CompanionActor: class {},
    EnemyActor: class {},
    picking: {},
    lift: 0,
    pendingGodPick: null,
    setPendingGodPick(callback) { this.pendingGodPick = callback; },
    switchLeader: (i) => calls.push(['switch', i]),
    helpUp: (m) => { m.sheet.hp = 1; calls.push(['help', m]); },
    canRecruit: () => false,
    recruitCompanion: () => {},
    spendClassPoint: () => true,
    grantTalent: () => true,
    canTakePart: () => true,
    engagedAround: () => [],
    engageRadius: 8,
    beginCombat: () => {},
    scaleEnemy: (value) => value,
    placeModel: () => {},
    dressUp: () => {},
    paintHud: (sheet) => calls.push(['hud', sheet]),
    shopKey: (x, z) => `${x},${z}`,
  };
  return { debug: createGodDebug(state), state, member, calls };
}

test('god-mode money and inventory writes go through their refresh seams', () => {
  const { debug, state, calls } = fixture();

  assert.equal(debug.setCash(-3), 0);
  assert.equal(state.party.cash, 0);
  debug.giveItem('coffee');

  assert.deepEqual(state.sheet.inventory, ['coffee']);
  assert.ok(calls.some((call) => Array.isArray(call) && call[0] === 'loot-refresh'));
  assert.ok(calls.some((call) => Array.isArray(call) && call[0] === 'hud'));
});

test('god-mode steering and revival preserve their runtime gates', () => {
  const { debug, state, member, calls } = fixture();

  assert.equal(debug.switchTo(0), true);
  assert.deepEqual(calls[0], ['switch', 0]);
  state.inCombat = true;
  assert.equal(debug.switchTo(0), false);

  debug.reviveMember(0);
  assert.equal(member.sheet.hp, 1);
  assert.ok(calls.includes('combat-refresh'));
});

test('god-mode action and placement hooks remain live', () => {
  const { debug, state, calls } = fixture();
  const callback = () => {};

  assert.equal(debug.actionAp('shove'), 2);
  assert.equal(debug.actionAp('missing'), null);
  assert.equal(debug.setDoor('h:1,1', true), true);
  assert.equal(debug.setDoor('h:9,9', true), false);
  debug.armPick(callback);
  debug.advanceFireTurn();

  assert.equal(state.pendingGodPick, callback);
  assert.equal(debug.picking, true);
  assert.deepEqual(calls.find((call) => Array.isArray(call) && call[0] === 'door'),
    ['door', 'h:1,1', true]);
  assert.ok(calls.includes('fire'));
});
