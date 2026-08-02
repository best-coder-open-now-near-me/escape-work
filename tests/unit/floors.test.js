// Layered levels (src/floors.js): storey parsing, stair-run generation and
// its validation errors, the grid facade, and cross-storey route planning.
// The spike level ships through here too - dev levels live outside the
// campaign lint (levels.test.js reads levels/*.json, not levels/dev/), so
// this is where a broken hand edit to it gets caught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFloors, layeredGrid, planCrossLayerRoute, STOREY_H } from '../../src/floors.js';
import { parseLevel } from '../../src/grid.js';
import spikeLobby from '../../levels/dev/spike-lobby.json' with { type: 'json' };

// Ground: a 4x4 room with a 2-cell stair run at (3,1)-(3,2), entry (3,3).
// Upper: floor along the north (z0) and west, air over the stairwell, void
// where the run's lower end would otherwise read as a second landing.
const fixture = (over = {}) => ({
  name: 'fixture',
  tiles: { '.': 'floor', '#': 'wall', 'X': 'stairway' },
  actors: { '@': 'player', 'M': 'manager' },
  layers: [
    { map: ['....', '...X', '...X', '@...'] },
    { map: ['....', '.. ', '.. ', '..  '] },
  ],
  ...over,
});

test('parseFloors finds the run, its entry, landing and direction', () => {
  const f = parseFloors(fixture());
  assert.equal(f.layers.length, 2);
  assert.deepEqual(f.baseY, [0, STOREY_H]);
  assert.equal(f.stairs.length, 1);
  const s = f.stairs[0];
  assert.equal(s.layer, 0);
  assert.equal(s.upper, 1);
  assert.deepEqual(s.entry, { x: 3, z: 3 });
  assert.deepEqual(s.top, { x: 3, z: 0 });
  assert.deepEqual(s.dir, { dx: 0, dz: -1 });
  // cells ordered from the entry side up the flight
  assert.deepEqual(s.cells, [{ x: 3, z: 2 }, { x: 3, z: 1 }]);
  assert.equal(f.stairAt(0, 3, 2), s);
  assert.equal(f.stairAt(1, 3, 2), null);
});

test('a layer height setting moves every storey above it', () => {
  const f = parseFloors(fixture({
    layers: [
      { height: 2.6, map: ['....', '...X', '...X', '@...'] },
      { map: ['....', '.. ', '.. ', '..  '] },
    ],
  }));
  assert.deepEqual(f.baseY, [0, 2.6]);
});

test('a stair cell without open air above it is a named error', () => {
  assert.throws(() => parseFloors(fixture({
    layers: [
      { map: ['....', '...X', '...X', '@...'] },
      { map: ['....', '....', '.. ', '..  '] }, // floor over (3,1)
    ],
  })), /open air above every stair cell/);
});

test('a run with landings at both ends is ambiguous, not guessed', () => {
  assert.throws(() => parseFloors(fixture({
    layers: [
      { map: ['....', '...X', '...X', '@...'] },
      { map: ['....', '.. ', '.. ', '....'] }, // (3,3) open above too
    ],
  })), /exactly one end open/);
});

test('a run with no walkable entry on its own storey is an error', () => {
  assert.throws(() => parseFloors(fixture({
    layers: [
      { map: ['....', '...X', '...X', '@..#'] }, // entry (3,3) is wall
      { map: ['....', '.. ', '.. ', '..  '] },
    ],
  })), /no walkable entry/);
});

test('stairs on the top storey are refused', () => {
  assert.throws(() => parseFloors(fixture({
    layers: [
      { map: ['....', '....', '....', '@...'] },
      { map: ['...X', '.. ', '.. ', '..  '] },
    ],
  })), /top storey/);
});

test('actors above the ground storey are refused for now', () => {
  assert.throws(() => parseFloors(fixture({
    layers: [
      { map: ['....', '...X', '...X', '@...'] },
      { map: ['M...', '.. ', '.. ', '..  '] },
    ],
  })), /actors on storey 1/);
});

test('the grid facade answers from the active storey', () => {
  const f = parseFloors(fixture());
  let active = 0;
  const g = layeredGrid(f, { name: 'fixture' }, () => active);
  assert.equal(g.typeAt(3, 1), 'stairway');
  assert.equal(g.terrainOpen(0, 0), true);
  active = 1;
  assert.equal(g.typeAt(3, 1), null); // the stairwell opening is air up here
  assert.equal(g.terrainOpen(3, 3), false);
  assert.deepEqual(g.playerSpawn, { x: 0, z: 3 }); // spawns stay ground-storey
});

test('planCrossLayerRoute chains walk, climb, walk', () => {
  const f = parseFloors(fixture());
  const walkableOn = (l) => (x, z) => f.layers[l].terrainOpen(x, z);
  const route = planCrossLayerRoute(f,
    { x: 0, z: 3, layer: 0 }, { x: 0, z: 0, layer: 1 }, walkableOn);
  assert.ok(route);
  const kinds = route.legs.map((l) => l.kind);
  assert.deepEqual(kinds, ['walk', 'climb', 'walk']);
  const [up, climb, across] = route.legs;
  assert.equal(up.layer, 0);
  assert.deepEqual(up.path[up.path.length - 1], [3, 3]); // ends at the entry
  assert.deepEqual(climb.from, { x: 3, z: 3, layer: 0 });
  assert.deepEqual(climb.to, { x: 3, z: 0, layer: 1 });
  assert.equal(climb.run, 2);
  assert.equal(across.layer, 1);
  assert.deepEqual(across.path[across.path.length - 1], [0, 0]);
});

test('descending reverses the climb', () => {
  const f = parseFloors(fixture());
  const walkableOn = (l) => (x, z) => f.layers[l].terrainOpen(x, z);
  const route = planCrossLayerRoute(f,
    { x: 0, z: 0, layer: 1 }, { x: 0, z: 3, layer: 0 }, walkableOn);
  assert.ok(route);
  const climb = route.legs.find((l) => l.kind === 'climb');
  assert.deepEqual(climb.from, { x: 3, z: 0, layer: 1 });
  assert.deepEqual(climb.to, { x: 3, z: 3, layer: 0 });
});

test('same-storey routes stay a single walk leg', () => {
  const f = parseFloors(fixture());
  const walkableOn = (l) => (x, z) => f.layers[l].terrainOpen(x, z);
  const route = planCrossLayerRoute(f,
    { x: 0, z: 3, layer: 0 }, { x: 0, z: 0, layer: 0 }, walkableOn);
  assert.equal(route.legs.length, 1);
  assert.equal(route.legs[0].kind, 'walk');
});

test('an unreachable stair entry refuses the whole route', () => {
  const f = parseFloors(fixture());
  const walkableOn = (l) => (x, z) =>
    f.layers[l].terrainOpen(x, z) && !(l === 0 && x === 3 && z === 3); // entry blocked
  const route = planCrossLayerRoute(f,
    { x: 0, z: 3, layer: 0 }, { x: 0, z: 0, layer: 1 }, walkableOn);
  assert.equal(route, null);
});

// --- the shipped spike level -------------------------------------------------
test('spike-lobby parses: one 3-cell flight, atrium-height ground storey', () => {
  const f = parseFloors(spikeLobby);
  assert.equal(f.layers.length, 2);
  assert.deepEqual(f.baseY, [0, 2.6]);
  assert.equal(f.stairs.length, 1);
  const s = f.stairs[0];
  assert.equal(s.cells.length, 3);
  assert.deepEqual(s.entry, { x: 17, z: 10 });
  assert.deepEqual(s.top, { x: 17, z: 6 });
});

test('spike-lobby: the mezzanine is reachable from the spawn', () => {
  const f = parseFloors(spikeLobby);
  const walkableOn = (l) => (x, z) => f.layers[l].terrainOpen(x, z);
  const spawn = f.layers[0].playerSpawn;
  const route = planCrossLayerRoute(f,
    { x: spawn.x, z: spawn.z, layer: 0 }, { x: 10, z: 2, layer: 1 }, walkableOn);
  assert.ok(route, 'a route from the spawn up to the mezzanine exists');
  assert.ok(route.legs.some((l) => l.kind === 'climb'));
});

test('spike-lobby: the under-balcony offices are walkable ground', () => {
  const f = parseFloors(spikeLobby);
  // (6,2) sits under the mezzanine's north band - the walk-under case the
  // layer model exists to deliver.
  assert.equal(f.layers[0].terrainOpen(6, 2), true);
  assert.equal(f.layers[1].typeAt(6, 2), 'floor');
});

// --- the facade contract ------------------------------------------------------

test('the layered facade forwards EVERY function a real grid exposes', () => {
  // The contract test the two shipped facade bugs both needed. `layeredGrid`
  // hand-lists the methods it forwards, and the list had silently fallen behind
  // grid.js: `sightOpenCellLow` and `sightOpenLow` were missing, so the sneak
  // cone sweep threw a TypeError on any layered level (REVIEW.md 2026-08-02
  // section 1.14). Deriving the expectation from a real grid means the next
  // method added to grid.js fails here instead of in a playtest.
  const flat = parseLevel({
    name: 'flat', tiles: { '.': 'floor', '#': 'wall' }, actors: { '@': 'player' },
    map: ['#####', '#.@.#', '#####'],
  });
  const g = layeredGrid(parseFloors(fixture()), { name: 'fixture' }, () => 0);
  const fns = Object.keys(flat).filter((k) => typeof flat[k] === 'function');
  const missing = fns.filter((k) => typeof g[k] !== 'function');
  assert.deepEqual(missing, [],
    `layeredGrid does not forward: ${missing.join(', ')} - add them to METHODS in floors.js`);
});

test('the forwarded methods actually reach the active storey', () => {
  // Forwarding the NAME is not the contract; forwarding the CALL is. A facade
  // that defined every key as undefined would pass the test above.
  const g = layeredGrid(parseFloors(fixture()), { name: 'fixture' }, () => 0);
  assert.equal(typeof g.typeAt(0, 0), 'string');
  // The two that were missing, called for real - this is the sneak sweep's path.
  assert.equal(typeof g.sightOpenCellLow(0, 0), 'boolean');
  assert.equal(typeof g.sightOpenLow(0, 0, 1, 0), 'boolean');
});
