// Seeded attack resolution through the production hit and player-strike
// modules. This deliberately does not reproduce either module's arithmetic:
// one RNG drives the real roll, inclusive damage die, and status rider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHitResolution } from '../../src/hit-resolution.js';
import { createPlayerStrike } from '../../src/player-strike.js';
import {
  ammoCostOf, createSheet, rollInt,
} from '../../src/stats.js';
import { hasStatus } from '../../src/statuses.js';
import { posOf } from '../../src/combat-geometry.js';

const seeded = (values) => {
  let draws = 0;
  const rng = () => values[draws++ % values.length];
  rng.draws = () => draws;
  return rng;
};

function attackRig(values) {
  const rng = seeded(values);
  const sheet = createSheet('office-drone');
  sheet.paper = 10;
  const active = {
    sheet,
    actor: { x: 0, z: 0, lunge: () => {} },
    ap: sheet.maxAp,
    usesLeft: {},
  };
  const target = {
    x: 1, z: 0, hp: 20, maxHp: 20, statuses: {},
    def: { name: 'Test Coworker' },
    combat: { dodge: 0, deflect: 0, statusResist: 0 },
    takeDamage(amount) {
      this.hp = Math.max(0, this.hp - amount);
      return this.hp <= 0;
    },
  };
  const events = [];
  const fx = {
    projectile: () => events.push('projectile'),
    impact: () => events.push('impact'),
    status: () => events.push('status'),
    damageText: () => events.push('damage-text'),
    shake: () => events.push('shake'),
  };
  const world = {
    stepOpen: () => true,
    hasLos: () => true,
    tileDefAt: () => null,
    surfaceIdAt: () => null,
    isBurning: () => false,
    isElectrified: () => false,
  };
  const hit = createHitResolution({
    world,
    members: [active],
    fx,
    rng,
    get active() { return active; },
    facings: new Map(),
    aiAllies: () => [],
    standing: () => true,
    posOf,
    guardStandingAt: () => false,
  });
  const logs = [];
  const strike = createPlayerStrike({
    active,
    fx,
    rollAgainst: hit.rollAgainst,
    rand: (lo, hi) => rollInt(rng, lo, hi),
    resolveProc: hit.resolveProc,
    hitFx: hit.hitFx,
    statusFxAt: hit.statusFxAt,
    deathFx: hit.deathFx,
    ammoCostOf: (id) => ammoCostOf(sheet, id),
    joinCombat: () => {},
    faceTarget: () => {},
    talentFxOf: () => ({}),
    ambushDmg: (damage) => damage,
    appliesLine: () => 'The rider lands.',
    immunityLine: () => 'Immune.',
    syncUnitSpeed: () => {},
    callbacks: { onEnemyKilled: () => events.push('killed') },
    log: (line) => logs.push(line),
    disarm: () => events.push('disarm'),
    refresh: () => events.push('refresh'),
    hostilesRemain: () => true,
    victory: () => events.push('victory'),
  });
  return { rng, sheet, active, target, events, logs, strike };
}

test('one seed drives the real hit, damage, and status-rider chain', () => {
  const r = attackRig([0, 0.4]);
  r.strike.performOn('paper-airplane', r.target);

  assert.equal(r.rng.draws(), 2, 'one hit draw and one damage draw');
  assert.equal(r.target.hp, 14);
  assert.equal(hasStatus(r.target, 'blinded'), true);
  assert.equal(r.sheet.paper, 9);
  assert.equal(r.active.ap, r.sheet.maxAp - 2);
  assert.deepEqual(r.events, ['projectile', 'impact', 'damage-text', 'status', 'disarm', 'refresh']);
  assert.match(r.logs[0], /6 damage!.*rider lands/i);
});

test('a seeded miss spends the action but never draws damage or applies its rider', () => {
  const r = attackRig([0.999, 0]);
  r.strike.performOn('paper-airplane', r.target);

  assert.equal(r.rng.draws(), 1, 'a miss must not consume the damage draw');
  assert.equal(r.target.hp, 20);
  assert.equal(hasStatus(r.target, 'blinded'), false);
  assert.equal(r.sheet.paper, 9);
  assert.equal(r.active.ap, r.sheet.maxAp - 2);
  assert.deepEqual(r.events, ['projectile', 'impact', 'damage-text', 'disarm', 'refresh']);
  assert.match(r.logs[0], /miss|augers/i);
});
