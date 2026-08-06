// Unit tests for the fire/smoke state machine. The runtime is a pure state
// machine over a grid interface driven one turn at a time, so a stub grid and
// no-op hooks are all it needs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSurfaceRuntime } from '../../src/surfaces-runtime.js';
import { parseLevel } from '../../src/grid.js';

// A 1-row world described by two maps: surfaces and tile flags.
function stubGrid({ surfaces = {}, defs = {}, closedEdges = [] } = {}) {
  const closed = new Set(closedEdges.map(([x, z, nx, nz]) => `${x},${z}>${nx},${nz}`));
  // Live, because fire CONSUMES its fuel: the runtime reports a burnt drift
  // through spendFuel and the world is expected to clear the tile. A frozen
  // map would let these tests pass against a grid still holding paper the
  // runtime believed it had burnt - which is the exact desync being fixed.
  const live = { ...surfaces };
  return {
    surfaceAt: (x, z) => live[x + ',' + z] || null,
    setType: (x, z, type) => {
      if (type === 'floor') delete live[x + ',' + z];
      else live[x + ',' + z] = type;
    },
    defAt: (x, z) => defs[x + ',' + z] || {},
    edgeOpen: (x, z, nx, nz) =>
      !closed.has(`${x},${z}>${nx},${nz}`) && !closed.has(`${nx},${nz}>${x},${z}`),
  };
}

// Bound to a grid, because spending fuel is a real mutation of the world - the
// same wiring main.js uses, where it also drops the visual and the harvest mark.
const hooksFor = (grid) => ({ addFlame: () => null, spendFuel: (x, z) => grid.setType(x, z, 'floor') });

test('fire spreads through adjacent flammable surfaces, then burns out', () => {
  const grid = stubGrid({ surfaces: { '0,0': 'paper', '1,0': 'paper', '2,0': 'water' } });
  const rt = createSurfaceRuntime({ grid, hooks: hooksFor(grid), onExplosion: () => {} });
  assert.equal(rt.ignite(0, 0), true);
  assert.equal(rt.surfaceAt(0, 0), 'fire');
  rt.advanceTurn(); // spread
  assert.equal(rt.isBurning(1, 0), true, 'neighbouring paper caught');
  assert.equal(rt.isBurning(2, 0), false, 'water does not burn');
  for (let i = 0; i < 8; i++) rt.advanceTurn(); // burn everything out and clear the smoke
  assert.equal(rt.burningCount, 0);
  assert.equal(rt.smokingCount, 0);
  assert.equal(rt.surfaceAt(0, 0), null, 'burnt paper is gone');
});

test('paper burns 3 turns, then smokes 2 with a 1-turn overlap', () => {
  const grid = stubGrid({ surfaces: { '0,0': 'paper' } });
  const rt = createSurfaceRuntime({ grid, hooks: hooksFor(grid), onExplosion: () => {} });
  rt.ignite(0, 0);
  assert.equal(rt.isBurning(0, 0), true); // turn 1: fire
  assert.equal(rt.isSmoke(0, 0), false);
  rt.advanceTurn();
  assert.equal(rt.isBurning(0, 0), true); // turn 2: fire
  assert.equal(rt.isSmoke(0, 0), false);
  rt.advanceTurn();
  assert.equal(rt.isBurning(0, 0), true, 'still burning on its last turn'); // turn 3
  assert.equal(rt.isSmoke(0, 0), true, 'smoke overlaps the last fire turn');
  rt.advanceTurn();
  assert.equal(rt.isBurning(0, 0), false, 'fire done after 3 turns'); // turn 4
  assert.equal(rt.isSmoke(0, 0), true, 'smoke lingers');
  rt.advanceTurn();
  assert.equal(rt.isSmoke(0, 0), false, 'smoke gone after 2 turns'); // cleared
});

test('partitions stop fire from spreading across the edge', () => {
  const grid = stubGrid({
    surfaces: { '0,0': 'paper', '1,0': 'paper' },
    closedEdges: [[0, 0, 1, 0]],
  });
  const rt = createSurfaceRuntime({ grid, hooks: hooksFor(grid), onExplosion: () => {} });
  rt.ignite(0, 0);
  rt.advanceTurn();
  assert.equal(rt.isBurning(1, 0), false);
});

test('fire reaching an explosive prop detonates it exactly once', () => {
  const booms = [];
  const grid = stubGrid({
    surfaces: { '0,0': 'paper' },
    defs: { '1,0': { explosive: true } },
  });
  const rt = createSurfaceRuntime({ grid, hooks: hooksFor(grid), onExplosion: (x, z) => booms.push([x, z]) });
  rt.ignite(0, 0);
  rt.advanceTurn(); // spread arms the fuse
  rt.advanceTurn(); // fuse elapses
  for (let i = 0; i < 5; i++) rt.advanceTurn(); // and never re-arms
  assert.deepEqual(booms, [[1, 0]]);
});

// The fuse is a TELEGRAPH: the turn between "the fire reached the printer" and
// "the printer goes off" is the turn you get to walk away. A fuse armed by this
// turn's spread must not also be ticked by this turn's fuse step, or
// PRINTER_FUSE_TURNS = 1 silently behaves as a zero-turn fuse and the blast
// lands on whoever was standing there with no warning at all.
test('an armed fuse does not detonate on the same turn the fire reached it', () => {
  const booms = [];
  const grid = stubGrid({
    surfaces: { '0,0': 'paper' },
    defs: { '1,0': { explosive: true } },
  });
  const rt = createSurfaceRuntime({ grid, hooks: hooksFor(grid), onExplosion: (x, z) => booms.push([x, z]) });
  rt.ignite(0, 0);
  rt.advanceTurn(); // the fire spreads to the prop and ARMS the fuse
  assert.deepEqual(booms, [], 'the turn the fuse is lit is a warning, not the boom');
  rt.advanceTurn(); // now it elapses
  assert.deepEqual(booms, [[1, 0]], 'and detonates on the very next turn');
});

test('an explosion ignites adjacent flammable surfaces', () => {
  // (0,0) paper to start the fire, an explosive prop at (1,0), fresh paper at
  // (2,0) beside the prop. The blast should light that paper.
  const grid = stubGrid({
    surfaces: { '0,0': 'paper', '2,0': 'paper' },
    defs: { '1,0': { explosive: true } },
  });
  const rt = createSurfaceRuntime({ grid, hooks: hooksFor(grid), onExplosion: () => {} });
  rt.ignite(0, 0);
  rt.advanceTurn(); // spread from (0,0) arms the fuse at (1,0)
  rt.advanceTurn(); // fuse elapses -> boom -> ignites the (2,0) paper
  assert.equal(rt.isBurning(2, 0), true, 'the blast lit the neighbouring paper');
});

test('non-flammable, non-ignitable cells refuse to light', () => {
  const grid = stubGrid({ surfaces: { '0,0': 'water' } });
  const rt = createSurfaceRuntime({ grid, hooks: hooksFor(grid), onExplosion: () => {} });
  assert.equal(rt.ignite(0, 0), false);
  assert.equal(rt.burningCount, 0);
});

test('ignitable props relight after burning out; paper does not', () => {
  const grid = stubGrid({ defs: { '0,0': { ignitable: true } } });
  const rt = createSurfaceRuntime({ grid, hooks: hooksFor(grid), onExplosion: () => {} });
  assert.equal(rt.ignite(0, 0), true);
  for (let i = 0; i < 6; i++) rt.advanceTurn(); // the can burns out but survives
  assert.equal(rt.burningCount, 0);
  assert.equal(rt.ignite(0, 0), true, 'the can takes a second lighting');
});

// A blast lights its flammable neighbours - but "partitions stop fire" is the
// module's own rule, enforced on ordinary spread AND on arming a fuse. Ignition
// by explosion used to be the one path that skipped the edge test, so a printer
// standing against a partition lit the drift on the FAR side of a wall the fire
// could never have crossed on its own.
test('an explosion lights its flammable neighbours, but not through a wall', () => {
  const grid = stubGrid({
    surfaces: { '0,0': 'paper', '1,0': 'paper', '2,0': 'paper', '1,1': 'paper' },
    defs: { '1,0': { explosive: true } },
    closedEdges: [[1, 0, 1, 1]], // a partition between the printer and the drift below it
  });
  const rt = createSurfaceRuntime({ grid, hooks: hooksFor(grid), onExplosion: () => {} });
  rt.ignite(0, 0);
  rt.advanceTurn(); // spread reaches the printer and arms its fuse
  rt.advanceTurn(); // the fuse elapses: the blast ignites what it can see
  assert.equal(rt.isBurning(2, 0), true, 'the drift on the open side catches');
  assert.equal(rt.isBurning(1, 1), false, 'the sealed partition holds');
});

test('a sealed neighbour still cannot catch on later turns', () => {
  // The blast is not merely delayed by the wall - ordinary spread respects the
  // same edge, so the far side stays cold for good.
  const grid = stubGrid({
    surfaces: { '0,0': 'paper', '1,0': 'paper', '1,1': 'paper' },
    defs: { '1,0': { explosive: true } },
    closedEdges: [[1, 0, 1, 1]],
  });
  const rt = createSurfaceRuntime({ grid, hooks: hooksFor(grid), onExplosion: () => {} });
  rt.ignite(0, 0);
  for (let i = 0; i < 8; i++) rt.advanceTurn();
  assert.equal(rt.isBurning(1, 1), false);
  assert.equal(rt.surfaceAt(1, 1), 'paper', 'the drift behind the wall is untouched');
});

// The desync this replaced (TODO Phase 2): ignite dropped the paper VISUAL but
// never told the grid, and kept a private `burned` set to mask the difference.
// So a tile could look bare while every grid reader still saw a drift on it -
// nothing could be laid there again, it could never burn again, and any repaint
// would redraw paper over ash. Fuel is now spent at its source instead.
test('burnt paper leaves the grid, so the tile is genuinely bare', () => {
  const grid = stubGrid({ surfaces: { '0,0': 'paper' } });
  const rt = createSurfaceRuntime({ grid, hooks: hooksFor(grid), onExplosion: () => {} });
  rt.ignite(0, 0);
  // Spent the instant it catches - the paper IS the fuel, which is why the
  // visual has always been dropped here too.
  assert.equal(grid.surfaceAt(0, 0), null, 'the grid stops holding a drift at ignition');
  assert.equal(rt.surfaceAt(0, 0), 'fire', 'while it is still burning');
  for (let i = 0; i < 8; i++) rt.advanceTurn();
  assert.equal(rt.surfaceAt(0, 0), null, 'and nothing once it is out');
  assert.equal(grid.surfaceAt(0, 0), null, 'grid and runtime agree');
});

test('a FRESH drift on a burnt tile burns again', () => {
  // This was the `burned`-never-invalidated bug: the set outlived the fire, so
  // a tile that had ever burnt was permanently inert. Nothing to invalidate now
  // - bare floor simply is not flammable, and new paper simply is.
  const grid = stubGrid({ surfaces: { '0,0': 'paper' } });
  const rt = createSurfaceRuntime({ grid, hooks: hooksFor(grid), onExplosion: () => {} });
  rt.ignite(0, 0);
  for (let i = 0; i < 8; i++) rt.advanceTurn();
  assert.equal(rt.ignite(0, 0), false, 'bare floor will not light');

  grid.setType(0, 0, 'paper'); // somebody empties the recycling here
  assert.equal(rt.ignite(0, 0), true, 'the new drift catches like any other');
});

const finePaperGrid = (walls = []) => parseLevel({
  name: 'fine-fire',
  tiles: { p: 'paper' },
  actors: {},
  map: ['pp'],
  walls,
});

const fineHooks = (grid) => ({
  addFlame: () => null,
  spendFuel: (x, z) => grid.surfaceField.clearAt(x, z),
});

test('fine fire consumes and spreads one physical surface cell at a time', () => {
  const grid = finePaperGrid();
  const rt = createSurfaceRuntime({ grid, hooks: fineHooks(grid), onExplosion: () => {} });
  assert.equal(rt.ignite(-0.25, -0.25), true);
  assert.equal(grid.surfaceAt(-0.25, -0.25), null, 'only the lit fuel cell is consumed');
  assert.equal(grid.surfaceAt(0.25, -0.25), 'paper', 'paper beside it remains until spread');
  rt.advanceTurn();
  assert.equal(rt.isBurning(0.25, -0.25), true, 'the fine neighbour catches next');
  assert.equal(rt.isBurning(0.75, -0.25), false, 'fire has not skipped a fine-cell beat');
  rt.advanceTurn();
  assert.equal(rt.isBurning(0.75, -0.25), true, 'then it crosses the movement-tile seam');
});

test('a partition dams fine-cell fire at the movement-tile seam', () => {
  const grid = finePaperGrid(['V 1 0 1']);
  const rt = createSurfaceRuntime({ grid, hooks: fineHooks(grid), onExplosion: () => {} });
  rt.ignite(-0.25, -0.25);
  for (let i = 0; i < 8; i++) rt.advanceTurn();
  assert.equal(rt.isBurning(0.75, -0.25), false);
  assert.equal(grid.surfaceAt(0.75, -0.25), 'paper', 'fuel beyond the partition remains');
});
