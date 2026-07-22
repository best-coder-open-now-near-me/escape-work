// Unit tests for the fire state machine. The runtime is a pure state machine
// over a grid interface, so a stub grid and no-op hooks are all it needs.
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
  rt.tick(1); // past the spread delay
  assert.equal(rt.isBurning(1, 0), true, 'neighbouring paper caught');
  assert.equal(rt.isBurning(2, 0), false, 'water does not burn');
  rt.tick(10); // past burn time for everything
  assert.equal(rt.burningCount, 0);
  assert.equal(rt.surfaceAt(0, 0), null, 'burnt paper is gone');
});

test('partitions stop fire from spreading across the edge', () => {
  const grid = stubGrid({
    surfaces: { '0,0': 'paper', '1,0': 'paper' },
    closedEdges: [[0, 0, 1, 0]],
  });
  const rt = createSurfaceRuntime({ grid, hooks, onExplosion: () => {} });
  rt.ignite(0, 0);
  rt.tick(1);
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
  rt.tick(1); // spread arms the fuse
  rt.tick(1); // fuse elapses
  rt.tick(5); // and never re-arms
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
  rt.tick(20); // the can burns out but survives
  assert.equal(rt.burningCount, 0);
  assert.equal(rt.ignite(0, 0), true, 'the can takes a second lighting');
});
