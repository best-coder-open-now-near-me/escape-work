import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAimGeometry } from '../../src/aim-paint.js';
import { createSurfaceField } from '../../src/surface-field.js';
import { fineCircleCells } from '../../src/surface-mask.js';

test('a circular aim wash clips cell squares and feathering to its true radius', () => {
  const field = createSurfaceField({ width: 7, height: 7 });
  const circle = { kind: 'circle', x: 3.2, z: 3.1, radius: 1.5 };
  const cells = fineCircleCells(field, circle.x, circle.z, circle.radius);
  const geo = buildAimGeometry(cells, field.quantum, circle);

  assert.ok(geo.indices.length > 0);
  const points = [];
  for (let i = 0; i < geo.positions.length; i += 3) {
    const x = geo.positions[i];
    const z = geo.positions[i + 2];
    points.push([x, z]);
    assert.ok(Math.hypot(x - circle.x, z - circle.z) <= circle.radius + 1e-6,
      `aim vertex ${x},${z} escaped the circle`);
  }
  assert.ok(points.some(([x, z]) =>
    Math.abs((x + 0.5) / field.quantum - Math.round((x + 0.5) / field.quantum)) > 1e-4
    || Math.abs((z + 0.5) / field.quantum - Math.round((z + 0.5) / field.quantum)) > 1e-4),
  'the outer edge contains continuous circle intersections, not only cell-square corners');
});

test('a cone aim wash uses the same continuous polygon clip seam', () => {
  const cells = [];
  for (let z = -1.25; z <= 1.25; z += 0.5) {
    for (let x = 0.25; x <= 2.25; x += 0.5) cells.push([x, z]);
  }
  const triangle = [[0, 0], [2, -1], [2, 1], [0, 0]];
  const geo = buildAimGeometry(cells, 0.5, { kind: 'polygon', points: triangle });

  assert.ok(geo.indices.length > 0);
  for (let i = 0; i < geo.positions.length; i += 3) {
    const x = geo.positions[i];
    const z = geo.positions[i + 2];
    assert.ok(x >= -1e-6 && x <= 2 + 1e-6);
    assert.ok(Math.abs(z) <= x / 2 + 1e-6, `cone vertex ${x},${z} escaped the wedge`);
  }
});
