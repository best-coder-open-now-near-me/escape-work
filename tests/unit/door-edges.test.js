// The door edge arithmetic (src/door-edges.js). Pure half only - no grid, no scene,
// no fight. A door is an EDGE, not a tile, and every conversion between an edge
// key and the two tiles it divides used to be written inline at whichever of
// main.js's five call sites needed it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { doorSides, doorMidpoint, doorKeyNear, atDoor, COMBAT_DOOR_AP } from '../../src/door-edges.js';

test('an h edge divides the tile above from the tile it names', () => {
  assert.deepEqual(doorSides('h:4,7'), [[4, 6], [4, 7]]);
});

test('a v edge divides the tile left from the tile it names', () => {
  assert.deepEqual(doorSides('v:4,7'), [[3, 7], [4, 7]]);
});

test('the door lives half a tile off the tile its key names', () => {
  // 'h:x,z' runs along the top of (x, z), so it sits at z - 0.5. Getting this
  // wrong puts the Alt-overlay label and combat's ring on the wrong side of the
  // doorway.
  assert.deepEqual(doorMidpoint('h:4,7'), { x: 4, z: 6.5 });
  assert.deepEqual(doorMidpoint('v:4,7'), { x: 3.5, z: 7 });
});

test('the midpoint is always on one of the two tiles the key divides', () => {
  for (const key of ['h:0,0', 'h:3,9', 'v:0,0', 'v:9,3']) {
    const mid = doorMidpoint(key);
    const sides = doorSides(key);
    const between = sides.some(([x, z]) => Math.abs(mid.x - x) <= 0.5 && Math.abs(mid.z - z) <= 0.5);
    assert.ok(between, `${key} midpoint is not between its own sides`);
  }
});

test('a point near an edge names it; a point mid-tile names nothing', () => {
  // The band is deliberately wide - you aim at a doorway, not at a line.
  assert.equal(doorKeyNear({ x: 4.45, z: 7 }), 'v:5,7');
  assert.equal(doorKeyNear({ x: 3.55, z: 7 }), 'v:4,7');
  assert.equal(doorKeyNear({ x: 4, z: 7.45 }), 'h:4,8');
  assert.equal(doorKeyNear({ x: 4, z: 6.55 }), 'h:4,7');
  // Dead centre of a tile is not near any edge.
  assert.equal(doorKeyNear({ x: 4, z: 7 }), null);
  assert.equal(doorKeyNear(null), null);
});

test('the nearer axis wins when a point sits by a corner', () => {
  // Otherwise a diagonal click by a corner could claim the door on the far face.
  assert.equal(doorKeyNear({ x: 4.45, z: 7.2 })[0], 'v');
  assert.equal(doorKeyNear({ x: 4.2, z: 7.45 })[0], 'h');
});

test('the key a point names is one the two tiles actually divide', () => {
  // The round-trip that keeps a click and its walk-to on the same door.
  const key = doorKeyNear({ x: 4.45, z: 7 });
  assert.ok(doorSides(key).some(([x, z]) => x === 4 && z === 7));
});

test('you work a door you are STANDING beside - either side of it', () => {
  // In a fight there is no walking-to-it: movement belongs to combat and is
  // priced by the tile, so the rule is the tactical one.
  assert.equal(atDoor('v:4,7', { x: 3, z: 7 }), true);
  assert.equal(atDoor('v:4,7', { x: 4, z: 7 }), true);
  assert.equal(atDoor('v:4,7', { x: 5, z: 7 }), false);
  assert.equal(atDoor('v:4,7', { x: 4, z: 8 }), false); // diagonal is not beside
  assert.equal(atDoor('v:4,7', null), false);
});

test('the handle is cheaper than a verb - the walk was already billed', () => {
  assert.equal(COMBAT_DOOR_AP, 1);
});
