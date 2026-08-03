// The paper-drift flood fill, which is the one part of the Alt loot overlay
// that is an algorithm rather than a wiring diagram.
//
// The rest of looting.js is a closure that builds DOM panels the moment it is
// constructed, so it is unreachable from node - `paperPatches` was lifted to
// module scope precisely so this file could exist. What it must get right: one
// patch per contiguous drift and not one per tile, the near window bounding the
// fill and not just the seed, diagonals NOT joining two drifts, and a centre
// that is the patch's own average rather than the seed tile.
import test from 'node:test';
import assert from 'node:assert';
import { paperPatches } from '../../src/looting.js';

// A tiny grid painted from rows of characters: '.' is bare floor, 'p' is a
// live paper drift. Rows are z, columns are x - the same way the e2e arenas
// spell their maps.
function paint(rows) {
  const grid = { width: rows[0].length, height: rows.length };
  const harvestable = (x, z) => rows[z]?.[x] === 'p';
  return { grid, harvestable };
}
const ALL = () => true;

test('a single drift tile is one patch, centred on itself', () => {
  const { grid, harvestable } = paint([
    '...',
    '.p.',
    '...',
  ]);
  const patches = paperPatches(grid, ALL, harvestable);
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].tiles, [[1, 1]]);
  assert.deepEqual([patches[0].cx, patches[0].cz], [1, 1]);
});

test('contiguous tiles are ONE patch, not one patch each', () => {
  const { grid, harvestable } = paint([
    '....',
    '.pp.',
    '.pp.',
    '....',
  ]);
  const patches = paperPatches(grid, ALL, harvestable);
  assert.equal(patches.length, 1, 'four touching tiles are one drift');
  assert.equal(patches[0].tiles.length, 4);
  // Every tile exactly once - a fill that re-seeds from an already-visited tile
  // would double-count and inflate the "Loose paper xN" label.
  const keys = patches[0].tiles.map(([x, z]) => `${x},${z}`);
  assert.equal(new Set(keys).size, 4);
  assert.deepEqual([patches[0].cx, patches[0].cz], [1.5, 1.5]);
});

test('two separated drifts are two patches', () => {
  const { grid, harvestable } = paint([
    'p.p',
    '...',
    'p.p',
  ]);
  assert.equal(paperPatches(grid, ALL, harvestable).length, 4);
});

test('diagonal neighbours do not join - the fill is 4-connected', () => {
  const { grid, harvestable } = paint([
    'p.',
    '.p',
  ]);
  const patches = paperPatches(grid, ALL, harvestable);
  assert.equal(patches.length, 2, 'a corner touch is not contiguous');
});

test('the near window bounds the FILL, not just the seed', () => {
  // A drift running the whole row, with the window covering only x <= 2. The
  // patch is the part you can actually see, and the label counts that part -
  // a fill that ignored the window inside the loop would report five.
  const { grid, harvestable } = paint(['ppppp']);
  const inWindow = (x) => x <= 2;
  const patches = paperPatches(grid, inWindow, harvestable);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].tiles.length, 3);
  assert.deepEqual(patches[0].tiles.map(([x]) => x).sort(), [0, 1, 2]);
});

test('an L-shaped drift is one patch and its centre is the average of its tiles', () => {
  const { grid, harvestable } = paint([
    'p..',
    'p..',
    'ppp',
  ]);
  const patches = paperPatches(grid, ALL, harvestable);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].tiles.length, 5);
  // x: 0,0,0,1,2 -> 0.6   z: 0,1,2,2,2 -> 1.4. The centre is NOT the seed tile
  // (0,0), and it is NOT the bounding-box middle (1,1) either.
  assert.equal(patches[0].cx, 0.6);
  assert.equal(patches[0].cz, 1.4);
});

test('nothing harvestable is no patches', () => {
  const { grid, harvestable } = paint(['...', '...']);
  assert.deepEqual(paperPatches(grid, ALL, harvestable), []);
});

test('a spent tile splits a drift the way a harvested one does', () => {
  // `harvestable` is false for a drift already picked clean, so gathering the
  // middle of a run leaves two labels rather than one that re-offers the lot.
  const { grid, harvestable } = paint(['pp.pp']);
  assert.equal(paperPatches(grid, ALL, harvestable).length, 2);
});
