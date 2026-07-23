// Unit tests for the fire/smoke state machine. The runtime is a pure state
// machine over a grid interface driven one turn at a time, so a stub grid and
// no-op hooks are all it needs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSurfaceRuntime } from '../../src/surfaces-runtime.js';

// A 1-row world described by two maps: surfaces and tile flags.
function stubGrid({ surfaces = {}, defs = {}, closedEdges = [] } = {}) {
  const closed = new Set(closedEdges.map(([x, z, nx, nz]) => `${x},${z}>${nx},${nz}`));
  return {
    surfaceAt: (x, z) => surfaces[x + ',' + z] || null,
    defAt: (x, z) => defs[x + ',' + z] || {},
    edgeOpen: (x, z, nx, nz) =>
      !closed.has(`${x},${z}>${nx},${nz}`) && !closed.has(`${nx},${nz}>${x},${z}`),
  };
}

const hooks = { addFlame: () => null, hideSurfaceVisual: () => {} };

test('fire spreads through adjacent flammable surfaces, then burns out', () => {
  const grid = stubGrid({ surfaces: { '0,0': 'paper', '1,0': 'paper', '2,0': 'water' } });
  const rt = createSurfaceRuntime({ grid, hooks, onExplosion: () => {} });
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
  const rt = createSurfaceRuntime({ grid, hooks, onExplosion: () => {} });
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
  const rt = createSurfaceRuntime({ grid, hooks, onExplosion: () => {} });
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
  const rt = createSurfaceRuntime({ grid, hooks, onExplosion: (x, z) => booms.push([x, z]) });
  rt.ignite(0, 0);
  rt.advanceTurn(); // spread arms the fuse
  rt.advanceTurn(); // fuse elapses
  for (let i = 0; i < 5; i++) rt.advanceTurn(); // and never re-arms
  assert.deepEqual(booms, [[1, 0]]);
});

test('non-flammable, non-ignitable cells refuse to light', () => {
  const grid = stubGrid({ surfaces: { '0,0': 'water' } });
  const rt = createSurfaceRuntime({ grid, hooks, onExplosion: () => {} });
  assert.equal(rt.ignite(0, 0), false);
  assert.equal(rt.burningCount, 0);
});

test('ignitable props relight after burning out; paper does not', () => {
  const grid = stubGrid({ defs: { '0,0': { ignitable: true } } });
  const rt = createSurfaceRuntime({ grid, hooks, onExplosion: () => {} });
  assert.equal(rt.ignite(0, 0), true);
  for (let i = 0; i < 6; i++) rt.advanceTurn(); // the can burns out but survives
  assert.equal(rt.burningCount, 0);
  assert.equal(rt.ignite(0, 0), true, 'the can takes a second lighting');
});
