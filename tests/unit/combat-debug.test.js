import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatDebug } from '../../src/combat-debug.js';

function fixture() {
  const active = {
    ap: 3,
    freeAp: 1,
    usesLeft: { coffee: 2 },
    actor: { x: 1, z: 2 },
    sheet: { name: 'Pat', hp: 8, maxHp: 10, maxAp: 5 },
  };
  const enemy = {
    def: { name: 'Manager' },
    x: 4,
    z: 5,
    hp: 6,
    maxHp: 9,
    alive: true,
  };
  const ai = {
    def: { name: 'Guard' },
    x: 7,
    z: 8,
    alive: true,
    moving: true,
  };
  const slot = { team: 'player', init: 14, member: active };
  const calls = [];
  const state = {
    phase: 'player',
    acting: { unit: ai, ap: 2, wait: 1.236 },
    active,
    bout: { rounds: 2, beats: { attack: 3 } },
    engaged: [enemy],
    watching: new Map([[active, 'watch']]),
    crouched: new Map(),
    intent: { armed: 'attack', pendingConfirm: null },
    aim: { hoverDoor: null, hoverHitChance: 0.65, preview: { reach: [] } },
    aimPaint: { debug: { key: 'attack:1,2', count: 4 } },
    hits: {
      forceHit: null,
      forceProc: null,
      lastRoll: { chance: 0.65, hit: true },
      setForceHit(v) { this.forceHit = v; },
      setForceProc(v) { this.forceProc = v; },
    },
    lastClickOutcome: 'acted',
    members: [active],
    turns: {
      held: [slot],
      order: [slot],
      index: 0,
      current: slot,
      isDone: () => false,
    },
    statuses: { charmed: { duration: 3 } },
    roundAp: (v) => Math.round(v * 10) / 10,
    refresh: () => calls.push('refresh'),
    posOf: (m) => m.actor,
    crouchStateOf: () => null,
    nameOf: (u) => u.sheet?.name || u.def.name,
    coverNames: () => [],
    statusList: (carrier) => carrier.statuses ? [...carrier.statuses] : [],
    hasStatus: (carrier, id) => carrier.statuses?.includes(id) || false,
    applyStatus: (carrier, id, options, resist) => {
      carrier.statuses = [...(carrier.statuses || []), id];
      calls.push(['status', carrier, id, options, resist]);
      return true;
    },
    removeStatus: (carrier, id) => {
      carrier.statuses = (carrier.statuses || []).filter((x) => x !== id);
      calls.push(['remove', carrier, id]);
    },
    charmUnit: (...args) => calls.push(['charm', ...args]),
    crouchHere: () => true,
    advanceTurn: () => calls.push('advance'),
    slotName: (s) => s.member.sheet.name,
    slotAlive: () => true,
    resolveSummon: (...args) => { calls.push(['summon', ...args]); return 2; },
  };
  return { debug: createCombatDebug(state), state, active, enemy, calls };
}

test('combat diagnostics project live state as snapshots', () => {
  const { debug, state, enemy } = fixture();

  assert.deepEqual(debug.acting, {
    name: 'Guard', ap: 2, wait: 1.24, moving: true, alive: true, x: 7, z: 8,
  });
  assert.deepEqual(debug.bout, { rounds: 2, beats: { attack: 3 }, dmgTaken: 3 });
  assert.deepEqual(debug.enemies, [{
    name: 'Manager', x: 4, z: 5, hp: 6, alive: true, statuses: [],
  }]);

  debug.bout.beats.attack = 99;
  debug.enemies[0].hp = 0;
  assert.equal(state.bout.beats.attack, 3);
  assert.equal(enemy.hp, 6);
});

test('combat diagnostic setters keep the runtime mutation doors narrow', () => {
  const { debug, active, enemy, calls } = fixture();

  debug.ap = -4;
  assert.equal(active.ap, 0);
  debug.forceHit = true;
  debug.forceProc = false;
  assert.equal(debug.forceHit, true);
  assert.equal(debug.forceProc, false);

  assert.equal(debug.applyStatus('charmed', 5, 2, 'Manager'), true);
  assert.ok(enemy.statuses.includes('charmed'));
  assert.ok(calls.some((c) => Array.isArray(c) && c[0] === 'charm'
    && c[1] === enemy && c[2] === 5));
  assert.ok(calls.filter((c) => c === 'refresh').length >= 2);
});

test('initiative and summon helpers preserve the public debug contract', () => {
  const { debug, active, calls } = fixture();

  assert.deepEqual(debug.order, [{
    name: 'Pat', team: 'player', init: 14, member: true,
    current: true, alive: true, held: true, done: false,
  }]);
  assert.equal(debug.turn, 'Pat');
  assert.equal(debug.summonAlly('employee', 2, 4), 2);
  assert.ok(calls.some((c) => Array.isArray(c) && c[0] === 'summon'
    && c[1] === active.actor && c[2] === 'player'
    && c[3].archetype === 'employee' && c[3].lifetimeTurns === 4));
});
