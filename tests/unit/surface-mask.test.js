import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSurfaceField } from '../../src/surface-field.js';
import { fineCircleCells, fineConeCells } from '../../src/surface-mask.js';
import { coneFrom } from '../../src/powers.js';

const key = ([x, z]) => `${x},${z}`;

test('a fine disc follows its continuous centre instead of snapping to movement tiles', () => {
  const field = createSurfaceField({ width: 6, height: 6 });
  const left = fineCircleCells(field, 2.1, 2.25, 1.1);
  const right = fineCircleCells(field, 2.4, 2.25, 1.1);
  assert.ok(left.length > 0);
  assert.notDeepEqual(left.map(key), right.map(key), 'sub-tile aim motion changes the committed mask');
  assert.ok(right.some(([x]) => x === 3.25), 'the shifted disc reaches a fine cell before a tile centre would');
});

test('body carving uses physical footprints and leaves a real gap paintable', () => {
  const field = createSurfaceField({ width: 7, height: 5 });
  const bodies = [{ x: 2.1, z: 2 }, { x: 3.4, z: 2 }];
  const cells = fineCircleCells(field, 2.75, 2, 1.5, { excludeBodies: bodies });
  assert.ok(!cells.some(([x, z]) => Math.abs(x - 2.1) < 0.26 && Math.abs(z - 2) < 0.26));
  assert.ok(cells.some(([x, z]) => x === 2.75 && Math.abs(z - 2) === 0.25),
    'fine cells between two separate body footprints remain available');
});

test('the cone mask is the geometric wedge and exclusion policy is supplied by the verb', () => {
  const field = createSurfaceField({ width: 8, height: 7 });
  const action = { cone: { range: 4, halfAngle: 35 } };
  const testCone = coneFrom(action, { x: 1, z: 3 }, 5, 3);
  const all = fineConeCells(field, testCone, action.cone.range);
  assert.ok(all.some(([x, z]) => x > 4 && Math.abs(z - 3) < 0.3));
  assert.ok(!all.some(([x]) => x < 1), 'nothing behind the cone origin is included');

  const friend = { x: 3, z: 3 };
  const carved = fineConeCells(field, testCone, action.cone.range, { excludeBodies: [friend] });
  assert.ok(carved.length < all.length);
  assert.ok(all.some(([x, z]) => x === 2.75 && z === 2.75));
  assert.ok(!carved.some(([x, z]) => x === 2.75 && z === 2.75));
});

test('mask filters terrain, existing surfaces and sight at the same fine centres', () => {
  const field = createSurfaceField({ width: 4, height: 4 });
  const seen = [];
  const cells = fineCircleCells(field, 1.5, 1.5, 1.5, {
    origin: { x: 0, z: 0 },
    hasLos: (_ox, _oz, x, z) => { seen.push([x, z]); return x <= 1.5; },
    canInclude: (x, z) => z <= 2,
  });
  assert.ok(seen.length > cells.length);
  assert.ok(cells.every(([x, z]) => x <= 1.5 && z <= 2));
});
