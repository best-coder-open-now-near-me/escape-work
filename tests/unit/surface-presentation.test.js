import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel } from '../../src/grid.js';
import { surfaceUnderlayTypeAt } from '../../src/scene.js';
import { computeCarpetZones, surfaceVisualGroups } from '../../src/tile-renderer.js';

const level = {
  name: 'Surface presentation',
  tiles: { k: 'break-floor', g: 'gum', p: 'paper' },
  actors: {},
  map: ['kkk', 'kgk', 'kpk'],
};

test('authored surfaces inherit the coloured carpet surrounding their underlay', () => {
  const grid = parseLevel(level);
  assert.equal(grid.typeAt(1, 1), 'floor', 'surface remains absent from terrain truth');
  assert.equal(grid.typeAt(1, 2), 'floor', 'paper remains absent from terrain truth');

  const carpet = computeCarpetZones(
    (x, z) => surfaceUnderlayTypeAt(grid, x, z), grid.width, grid.height,
  );
  assert.equal(carpet.get('1,1'), 'break-floor');
  assert.equal(carpet.get('1,2'), 'break-floor');
});

test('surface visual grouping is data driven: one gum source, per-cell paper', () => {
  const grid = parseLevel(level);
  const entries = grid.surfaceField.entries();
  const gum = surfaceVisualGroups(entries.filter((cell) => cell.surfaceId === 'gum'));
  const paper = surfaceVisualGroups(entries.filter((cell) => cell.surfaceId === 'paper'));

  assert.equal(gum.length, 1);
  assert.equal(gum[0].cells.length, 4);
  assert.equal(paper.length, 4);
  assert.ok(paper.every((group) => group.cells.length === 1));
});

test('one source-grouped gum wad is consumed as one source, not four hidden quarters', () => {
  const grid = parseLevel(level);
  const gum = grid.surfaceField.recordAt(1, 1);
  assert.equal(gum.surfaceId, 'gum');
  assert.equal(grid.surfaceField.clearSource(gum.sourceKey), true);
  assert.equal(grid.surfaceAt(1, 1), null);
  assert.ok(!grid.surfaceField.entries().some((cell) => cell.sourceKey === gum.sourceKey));
  assert.equal(grid.surfaceAt(1, 2), 'paper', 'another surface source is untouched');
});
