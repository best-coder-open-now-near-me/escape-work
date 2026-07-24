// Unit tests for level parsing, edge walls and conduction - pure logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel, parseWallRuns, compressWallRuns } from '../../src/grid.js';

const level = (map, extra = {}) => ({
  name: 'test-floor',
  tiles: {
    '#': 'wall', '.': 'floor', '>': 'exit', '~': 'water', '*': 'cable',
    '%': 'coffee-spill', 'p': 'paper', 'R': 'printer',
  },
  actors: { '@': 'player', 'M': 'manager' },
  map,
  ...extra,
});

test('parseWallRuns expands H and V runs and skips malformed specs', () => {
  const { h, v } = parseWallRuns(['H 2 3 3', 'V 5 1 2', 'V 7 7', 'H x y z', '']);
  assert.deepEqual([...h].sort(), ['2,3', '3,3', '4,3']);
  assert.deepEqual([...v].sort(), ['5,1', '5,2', '7,7']); // len defaults to 1
});

test('compressWallRuns round-trips through parseWallRuns', () => {
  const h = new Set(['1,1', '2,1', '3,1', '5,1', '2,4']);
  const v = new Set(['0,0', '0,1', '0,2', '3,7']);
  const specs = compressWallRuns(h, v);
  const back = parseWallRuns(specs);
  assert.deepEqual([...back.h].sort(), [...h].sort());
  assert.deepEqual([...back.v].sort(), [...v].sort());
});

test('parseLevel finds spawns and treats actor tiles as floor', () => {
  const g = parseLevel(level(['@.M', '...']));
  assert.deepEqual(g.playerSpawn, { x: 0, z: 0 });
  assert.deepEqual(g.enemySpawns, [{ type: 'manager', x: 2, z: 0 }]);
  assert.equal(g.typeAt(0, 0), 'floor');
  assert.equal(g.typeAt(2, 0), 'floor');
});

test('parseLevel sorts companions and enemies into their own spawn lists', () => {
  // 'N' is the it-intern COMPANION (data/companions.js), 'M' a manager enemy.
  const g = parseLevel({
    name: 't', tiles: { '.': 'floor' },
    actors: { '@': 'player', 'M': 'manager', 'N': 'it-intern' },
    map: ['@MN'],
  });
  assert.deepEqual(g.enemySpawns, [{ type: 'manager', x: 1, z: 0 }]);
  assert.deepEqual(g.companionSpawns, [{ type: 'it-intern', x: 2, z: 0 }]);
  assert.ok(!g.enemySpawns.some((s) => s.type === 'it-intern'), 'companion is not misfiled as an enemy');
});

test('sightOpen ignores plain partitions - throws sail over cubicle walls', () => {
  const g = parseLevel(level(['..'], { walls: ['V 1 0 1'] }));
  assert.equal(g.edgeOpen(0, 0, 1, 0), false); // the wall blocks movement
  assert.equal(g.sightOpen(0, 0, 1, 0), true); // but a throw clears the chest-high wall
});

test('setType can bring a conduction pool to life, not only kill it', () => {
  // cable, a dry floor gap, then water - the water is not yet powered.
  const g = parseLevel(level(['*.~']));
  assert.equal(g.isElectrified(2, 0), false);
  g.setType(1, 0, 'water'); // bridge the gap - now the whole pool touches the cable
  assert.equal(g.isElectrified(1, 0), true);
  assert.equal(g.isElectrified(2, 0), true);
});

test('out-of-bounds is wall, in-map void is impassable but distinct', () => {
  const g = parseLevel(level(['. .']));
  assert.equal(g.typeAt(-1, 0), 'wall');
  assert.equal(g.typeAt(1, 0), null); // the space is void
  assert.equal(g.terrainOpen(1, 0), false);
  assert.equal(g.defAt(1, 0).solid, true); // void renders/behaves as wall
});

test('parseLevel throws on unknown tile types and applies aliases', () => {
  assert.throws(() => parseLevel({
    name: 'bad', tiles: { '?': 'lava' }, actors: {}, map: ['?'],
  }));
  const g = parseLevel({
    name: 'old-save', tiles: { 'w': 'wet-floor' }, actors: {}, map: ['w'],
  });
  assert.equal(g.typeAt(0, 0), 'water'); // TYPE_ALIASES upgrade old exports
});

test('edge walls block single edges; diagonals must clear the corner', () => {
  const g = parseLevel(level(['..', '..'], { walls: ['V 1 0 1'] }));
  assert.equal(g.edgeOpen(0, 0, 1, 0), false);
  assert.equal(g.edgeOpen(0, 1, 1, 1), true);
  // Any diagonal across the walled corner is illegal too.
  assert.equal(g.stepOpen(0, 0, 1, 1), false);
  assert.equal(g.stepOpen(1, 0, 0, 1), false);
  assert.equal(g.stepOpen(0, 1, 1, 0), false);
});

test('a water pool touching a cable is electrified, all of it', () => {
  const g = parseLevel(level(['*~~', '..~']));
  assert.equal(g.isElectrified(1, 0), true);
  assert.equal(g.isElectrified(2, 0), true);
  assert.equal(g.isElectrified(2, 1), true); // pools are 4-connected
  assert.equal(g.isElectrified(0, 0), false); // the cable itself is not a pool
});

test('a partition dams the conduction pool', () => {
  const g = parseLevel(level(['*~~'], { walls: ['V 2 0 1'] }));
  assert.equal(g.isElectrified(1, 0), true);
  assert.equal(g.isElectrified(2, 0), false); // walled off from the live half
});

test('doors block edges while closed and open on demand', () => {
  const g = parseLevel(level(['..', '..'], { doors: ['V 1 0 1'] }));
  const key = 'v:1,0';
  assert.equal(g.doors.get(key).open, false); // doors start closed
  assert.equal(g.edgeOpen(0, 0, 1, 0), false);
  assert.equal(g.sightOpen(0, 0, 1, 0), false); // closed doors stop throws
  assert.equal(g.stepOpen(0, 0, 1, 1), false); // and diagonal corner cuts
  g.setDoorOpen(key, true);
  assert.equal(g.edgeOpen(0, 0, 1, 0), true);
  assert.equal(g.sightOpen(0, 0, 1, 0), true);
});

test('a door replaces any wall painted on the same edge', () => {
  const g = parseLevel(level(['..'], { walls: ['V 1 0 1'], doors: ['V 1 0 1'] }));
  assert.equal(g.doors.has('v:1,0'), true);
  assert.equal(g.vWalls.has('1,0'), false); // the wall yielded to the door
  g.setDoorOpen('v:1,0', true);
  assert.equal(g.edgeOpen(0, 0, 1, 0), true); // no phantom wall behind it
});

test('conduction ignores doors - water finds the gap underneath', () => {
  const g = parseLevel(level(['*~~'], { doors: ['V 2 0 1'] }));
  assert.equal(g.isElectrified(2, 0), true); // closed door, live pool anyway
});

test('setType recomputes conduction pools', () => {
  // Water conducts to the cable only THROUGH the middle cell; blow the
  // bridge away and the far water must go dead.
  const g = parseLevel(level(['*~~']));
  assert.equal(g.isElectrified(2, 0), true);
  g.setType(1, 0, 'floor');
  assert.equal(g.isElectrified(1, 0), false);
  assert.equal(g.isElectrified(2, 0), false);
});
