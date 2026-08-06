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
import { handoffItem, paperPatches, paperLabel } from '../../src/looting.js';
import { createSheet, inventoryCapOf } from '../../src/stats.js';

// A tiny grid painted from rows of characters: '.' is bare floor, 'p' is a
// live paper drift. Rows are z, columns are x - the same way the e2e arenas
// spell their maps.
function paint(rows) {
  const grid = { width: rows[0].length, height: rows.length };
  const harvestable = (x, z) => rows[z]?.[x] === 'p';
  return { grid, harvestable };
}
const ALL = () => true;

test('a party hand-off obeys recipient capacity and is atomic', () => {
  const sender = createSheet('office-drone');
  const recipient = createSheet('it-support');
  sender.inventory = ['cold-coffee'];
  recipient.inventory = new Array(inventoryCapOf(recipient)).fill('paper-wad');

  assert.equal(handoffItem(sender, recipient, 'cold-coffee'), 'full');
  assert.deepEqual(sender.inventory, ['cold-coffee'], 'a refused item stays with its sender');
  assert.equal(recipient.inventory.includes('cold-coffee'), false);

  recipient.inventory.pop();
  assert.equal(handoffItem(sender, recipient, 'cold-coffee'), 'sent');
  assert.deepEqual(sender.inventory, []);
  assert.equal(recipient.inventory.at(-1), 'cold-coffee');
  assert.equal(handoffItem(sender, recipient, 'cold-coffee'), 'missing');
});

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

// --- the label the patches turn into (Q903) ---------------------------------
// The fill underneath had eight tests and the label had none, which left the
// interesting arm unpinned: the chip floats at the patch CENTRE, but the click
// walks to the nearest patch TILE. A centre is an average, so on any patch that
// is not a filled rectangle it can be a tile nobody can stand on - and walking
// to it would be a click that refuses, or worse, silently goes somewhere else.

test('the chip floats at the centre and the walk goes to the nearest tile', () => {
  const patch = { tiles: [[1, 1], [2, 1], [3, 1]], cx: 2, cz: 1 };
  const label = paperLabel(patch, { x: 5, z: 1 });
  assert.deepEqual(label.world, { x: 2, y: 0.85, z: 1 }, 'the chip sits on the centre');
  assert.deepEqual(label.target, [3, 1], 'the walk goes to the near end, not the centre');
});

test('the walk target follows the walker, the chip does not', () => {
  const patch = { tiles: [[1, 1], [2, 1], [3, 1]], cx: 2, cz: 1 };
  const fromLeft = paperLabel(patch, { x: -4, z: 1 });
  const fromRight = paperLabel(patch, { x: 9, z: 1 });
  assert.deepEqual(fromLeft.target, [1, 1]);
  assert.deepEqual(fromRight.target, [3, 1]);
  assert.deepEqual(fromLeft.world, fromRight.world, 'the chip is a property of the patch, not the viewer');
});

test('a horseshoe centre is not a patch tile, and the walk still lands on paper', () => {
  // The case the finding names. A U of paper: the centroid falls in the mouth,
  // which is bare floor - so a click that walked to the CHIP would walk to a
  // tile with no paper on it and harvest nothing.
  const tiles = [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [2, 0]];
  const cx = tiles.reduce((t, [x]) => t + x, 0) / tiles.length;
  const cz = tiles.reduce((t, [, z]) => t + z, 0) / tiles.length;
  const label = paperLabel({ tiles, cx, cz }, { x: 1, z: -3 });
  const onPaper = tiles.some(([x, z]) => x === label.target[0] && z === label.target[1]);
  assert.ok(onPaper, `the walk target ${JSON.stringify(label.target)} is not a paper tile`);
  const centreIsPaper = tiles.some(([x, z]) => x === Math.round(cx) && z === Math.round(cz));
  assert.equal(centreIsPaper, false,
    'this fixture is meant to have a centre OFF the patch - if that stops being true, the test stops testing anything');
});

test('one tile is named in the singular, more than one carries the count', () => {
  assert.equal(paperLabel({ tiles: [[0, 0]], cx: 0, cz: 0 }, { x: 0, z: 0 }).text, 'Loose paper');
  assert.equal(paperLabel({ tiles: [[0, 0], [1, 0]], cx: 0.5, cz: 0 }, { x: 0, z: 0 }).text, 'Loose paper \u00d72');
});
