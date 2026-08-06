import test from 'node:test';
import assert from 'node:assert/strict';
import { areaIntersectsBody, bodyPoint } from '../../src/area-geometry.js';
import { TILE_TYPES } from '../../src/data/tiles.js';

const BLAST = TILE_TYPES.printer.explosive;

test('the printer declares its complete explosion policy in data', () => {
  assert.deepEqual(BLAST, {
    fuseTurns: 1,
    area: { shape: 'circle', radius: 1.25 },
    damage: { player: 8, enemy: 'lethal' },
    ignitesSurfaces: true,
  });
});

test('a circle hits by physical body intersection, including its continuous rim', () => {
  const centre = { x: 0, z: 0 };
  assert.equal(areaIntersectsBody(BLAST.area, centre, { x: 1.55, z: 0 }), true);
  assert.equal(areaIntersectsBody(BLAST.area, centre, { x: 1.551, z: 0 }), false);
  // Outside the old one-tile square on z, but the character's body still cuts
  // the circular blast. This is exactly the continuous edge case the square
  // test could not represent.
  assert.equal(areaIntersectsBody(BLAST.area, centre, { x: 1, z: 1.18 }), true);
});

test('body geometry reads the rendered rest point rather than the logical tile', () => {
  const record = {
    actor: {
      x: 9,
      z: 9,
      entity: { getPosition: () => ({ x: 1.4, y: 0, z: 0 }) },
    },
  };
  assert.deepEqual(bodyPoint(record), { x: 1.4, z: 0 });
  assert.equal(areaIntersectsBody(BLAST.area, { x: 0, z: 0 }, record), true);
});

test('unknown area shapes and missing body points refuse instead of guessing', () => {
  assert.equal(areaIntersectsBody({ shape: 'square', radius: 2 }, { x: 0, z: 0 }, { x: 0, z: 0 }), false);
  assert.equal(areaIntersectsBody(BLAST.area, { x: 0, z: 0 }, {}), false);
});
