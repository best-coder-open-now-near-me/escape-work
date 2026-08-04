// Unit tests for level parsing, edge walls and conduction - pure logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel, parseWallRuns, compressWallRuns } from '../../src/grid.js';
import { TILE_TYPES, blocksSight, SIGHT_BLOCK_HEIGHT, PARTITION_HP } from '../../src/data/tiles.js';

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
  // 'N' is the it-support COMPANION (data/companions.js), 'M' a manager enemy.
  const g = parseLevel({
    name: 't', tiles: { '.': 'floor' },
    actors: { '@': 'player', 'M': 'manager', 'N': 'it-support' },
    map: ['@MN'],
  });
  assert.deepEqual(g.enemySpawns, [{ type: 'manager', x: 1, z: 0 }]);
  assert.deepEqual(g.companionSpawns, [{ type: 'it-support', x: 2, z: 0 }]);
  assert.ok(!g.enemySpawns.some((s) => s.type === 'it-support'), 'companion is not misfiled as an enemy');
});

test('sightOpen ignores plain partitions - throws sail over cubicle walls', () => {
  const g = parseLevel(level(['..'], { walls: ['V 1 0 1'] }));
  assert.equal(g.edgeOpen(0, 0, 1, 0), false); // the wall blocks movement
  assert.equal(g.sightOpen(0, 0, 1, 0), true); // but a throw clears the chest-high wall
});

test('blocksSight is a height rule, with tall as the structural override (M6a)', () => {
  assert.ok(TILE_TYPES.desk.height < SIGHT_BLOCK_HEIGHT);
  assert.equal(blocksSight(TILE_TYPES.desk), false);            // shot over
  assert.equal(blocksSight(TILE_TYPES['snack-machine']), true); // head-high
  assert.equal(blocksSight(TILE_TYPES.wall), true);             // drawn 0.6, but it is the building
  assert.equal(blocksSight(TILE_TYPES.paneling), true);         // structure, same family
  assert.equal(blocksSight(TILE_TYPES['cabinet-fallen']), false); // solid on its side, but LOW
  assert.equal(blocksSight(null), false);
});

test('the big plants conceal a crouch without blocking a shot (SNEAK)', () => {
  // The whole concealment claim, pinned on the data rather than on prose:
  // a plant you can duck behind is a SOLID under the sight height - shot
  // over like a desk, opaque to the crouch-height trace a sneaking body is
  // read at. Break either half and sneaking silently changes.
  for (const id of ['ficus', 'palm', 'potted-plant']) {
    const def = TILE_TYPES[id];
    assert.equal(def.solid, true, `${id} must be solid to conceal`);
    assert.ok(def.height < SIGHT_BLOCK_HEIGHT, `${id} must stay shootable-over`);
    assert.equal(blocksSight(def), false, `${id} must not block a standing line`);
  }
  // ...and the knee-high sprigs conceal nobody, which is the same rule
  // refusing to lie: they are not solid, so a crouch-height line crosses them.
  for (const id of ['plant-small', 'plant-tiny']) {
    assert.ok(!TILE_TYPES[id].solid, `${id} is too small to hide behind`);
  }
});

test('sightOpenCell: short solids are shot over, tall ones and the void are not', () => {
  const g = parseLevel({
    name: 't',
    tiles: { '.': 'floor', 'D': 'desk', 'S': 'snack-machine', '#': 'wall' },
    actors: {},
    map: ['.D.S#'],
  });
  assert.equal(g.terrainOpen(1, 0), false);   // the desk still blocks bodies
  assert.equal(g.sightOpenCell(1, 0), true);  // but not shots
  assert.equal(g.sightOpenCell(0, 0), true);  // floor is floor
  assert.equal(g.sightOpenCell(3, 0), false); // the snack machine blocks both
  assert.equal(g.sightOpenCell(4, 0), false); // the '#' wall is tall by fiat
  assert.equal(g.sightOpenCell(0, -1), false); // out of bounds resolves to wall
});

test('removeEdgeBetween topples a partition out of the world (TACTICS_PLAN M6)', () => {
  const g = parseLevel(level(['..'], { walls: ['V 1 0 1'] }));
  assert.ok(g.wallEdgeBetween(0, 0, 1, 0), 'the partition is there to ask about');
  assert.equal(g.edgeOpen(0, 0, 1, 0), false);
  const e = g.removeEdgeBetween(0, 0, 1, 0);
  assert.deepEqual(e, { o: 'v', k: '1,0' }, 'reports what fell, for the renderer');
  assert.equal(g.edgeOpen(0, 0, 1, 0), true, 'bodies walk through where it stood');
  assert.equal(g.removeEdgeBetween(0, 0, 1, 0), null, 'a second shove finds nothing');
});

test('doors are not toppleable - they never enter the wall sets', () => {
  const g = parseLevel(level(['..'], { doors: ['V 1 0 1'] }));
  assert.equal(g.wallEdgeBetween(0, 0, 1, 0), null, 'a doored edge is not a wall edge');
  assert.equal(g.removeEdgeBetween(0, 0, 1, 0), null);
});

test('toppling a partition breaks the dam - conduction pools merge live', () => {
  // Cable, then water, with a partition damming the pair from a second pool.
  const g = parseLevel(level(['*~~'], { walls: ['V 2 0 1'] }));
  assert.equal(g.isElectrified(1, 0), true, 'the near pool is live');
  assert.equal(g.isElectrified(2, 0), false, 'the far pool sits behind the dam');
  g.removeEdgeBetween(1, 0, 2, 0);
  assert.equal(g.isElectrified(2, 0), true, 'the dam broke and the pools merged');
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

// The combat trigger leans on this pairing (TODO Phase 0, the door deadlock):
// Chebyshev adjacency is NOT sufficient to start a fight, because a sealed
// doorway is adjacent and uncrossable at the same time. Before the fix the
// trigger tested distance alone, so a coworker behind a closed door joined a
// fight they could never act in - and victory needs every engaged coworker
// down, so the fight could not end. Both halves of the fix read these two
// predicates, so both are pinned here.
test('a closed door leaves an adjacent pair uncrossable AND blind', () => {
  const g = parseLevel(level(['..', '..'], { doors: ['V 1 0 1'] }));
  // Two walkable tiles either side of the door...
  assert.equal(g.terrainOpen(0, 0), true);
  assert.equal(g.terrainOpen(1, 0), true);
  // ...that Chebyshev happily calls adjacent...
  assert.equal(Math.max(Math.abs(0 - 1), Math.abs(0 - 0)) <= 1, true);
  // ...but which nothing can cross (the new trigger test)...
  assert.equal(g.stepOpen(0, 0, 1, 0), false);
  // ...and which cannot see each other (the new engaged-set filter).
  assert.equal(g.sightOpen(0, 0, 1, 0), false);

  // Opening it restores both, so the fix cannot wall off a legitimate fight.
  g.setDoorOpen('v:1,0', true);
  assert.equal(g.stepOpen(0, 0, 1, 0), true);
  assert.equal(g.sightOpen(0, 0, 1, 0), true);
});

// An unknown actor char used to fall through to `enemySpawns` unchecked, so a
// typo in a legend produced a spawn for a type that does not exist - surfacing
// much later as an empty tile, or as a crash deep in actor construction with
// nothing pointing back at the level file (TODO Phase 6).
test('parseLevel names an unknown actor rather than spawning a ghost', () => {
  assert.throws(
    () => parseLevel(level(['@X'], { actors: { '@': 'player', X: 'not-a-real-type' } })),
    /unknown actor "not-a-real-type" for char "X"/,
    'the error has to name the id AND the char, or it does not help');
});

test('parseLevel still accepts every real kind of actor', () => {
  const g = parseLevel(level(['@M'], { actors: { '@': 'player', M: 'manager' } }));
  assert.deepEqual(g.playerSpawn, { x: 0, z: 0 });
  assert.equal(g.enemySpawns.length, 1);
  assert.equal(g.enemySpawns[0].type, 'manager');
});

// --- destructible cover bookkeeping (TACTICS_PLAN M8) -------------------------
// Damage lives in the grid's side maps: hidden pool, "gone means gone" is the
// caller's move, and a pool dies with the thing it described.

test('damageProp runs a pool down and only for props that carry one', () => {
  const g = parseLevel({
    name: 't', tiles: { '.': 'floor', B: 'cabinet', '#': 'wall' },
    actors: { '@': 'player' }, map: ['@B#'],
  });
  const full = TILE_TYPES.cabinet.hp;
  assert.equal(g.propHpAt(1, 0), full);
  assert.equal(g.propHpAt(2, 0), null, 'a wall has no pool');
  assert.equal(g.damageProp(2, 0, 5), null, 'no pool, no damage recorded');
  assert.equal(g.damageProp(1, 0, 4), full - 4);
  assert.equal(g.propHpAt(1, 0), full - 4, 'the dent persists');
  assert.equal(g.damageProp(1, 0, full), 0, 'clamped at zero');
});

test('setType resets a pool - the fallen twin starts fresh', () => {
  const g = parseLevel({
    name: 't', tiles: { '.': 'floor', B: 'cabinet' },
    actors: { '@': 'player' }, map: ['@B.'],
  });
  g.damageProp(1, 0, 6);
  g.setType(1, 0, 'cabinet-fallen'); // a topple, mid-demolition
  assert.equal(g.propHpAt(1, 0), TILE_TYPES['cabinet-fallen'].hp,
    'the pool belonged to what STOOD here');
});

test('edge pools: partitions dent, and the pool dies with the edge', () => {
  const g = parseLevel({
    name: 't', tiles: { '.': 'floor' }, actors: { '@': 'player' },
    map: ['@..', '...'], walls: ['V 1 0 1'],
  });
  assert.equal(g.edgeHpBetween(0, 0, 1, 0), PARTITION_HP);
  assert.equal(g.edgeHpBetween(0, 1, 1, 1), null, 'no wall, no pool');
  assert.equal(g.damageEdge(0, 0, 1, 0, 3), PARTITION_HP - 3);
  assert.equal(g.edgeHpBetween(0, 0, 1, 0), PARTITION_HP - 3);
  // Retire the edge (the topple or the final hit) - and the record with it,
  // so a wall painted here by a future level edit starts whole.
  const e = g.removeEdgeBetween(0, 0, 1, 0);
  assert.ok(e);
  assert.equal(g.edgeHpBetween(0, 0, 1, 0), null);
});

// --- per-placement rotation (EDITOR_INVENTORY IQ4, designer 2026-08-02) ------
// `rotY` was a property of the tile TYPE, so every desk on every floor faced the
// same way. An optional `props` sibling array carries per-CELL overrides.
test('a props entry rotates one placement without touching the type', () => {
  const g = parseLevel({
    name: 'rot',
    tiles: { '.': 'floor', D: 'desk' },
    actors: { '@': 'player' },
    map: ['@.D.', '..D.'],
    props: [{ x: 2, z: 0, rotY: 90 }],
  });
  assert.equal(g.rotAt(2, 0), 90, 'the placement with an entry uses it');
  assert.equal(g.rotAt(2, 1), TILE_TYPES.desk.rotY || 0,
    'the placement without one falls back to the type');
});

test('rotation quantises to the four orientations and drops no-ops', () => {
  const g = parseLevel({
    name: 'rot',
    tiles: { '.': 'floor', D: 'desk' },
    actors: { '@': 'player' },
    map: ['@DDD'],
    props: [{ x: 1, z: 0, rotY: 91 }, { x: 2, z: 0, rotY: -90 }, { x: 3, z: 0, rotY: 360 }],
  });
  assert.equal(g.rotAt(1, 0), 90, '91 rounds to 90');
  assert.equal(g.rotAt(2, 0), 270, 'negatives wrap into range');
  assert.equal(g.rotAt(3, 0), TILE_TYPES.desk.rotY || 0, '360 is no rotation at all');
});

test('a level with no props array behaves exactly as before', () => {
  const g = parseLevel({
    name: 'rot',
    tiles: { '.': 'floor', D: 'desk' },
    actors: { '@': 'player' },
    map: ['@.D.'],
  });
  assert.equal(g.rotAt(2, 0), TILE_TYPES.desk.rotY || 0);
  assert.deepEqual(g.props, []);
});
