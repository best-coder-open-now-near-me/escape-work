import test from 'node:test';
import assert from 'node:assert/strict';
import { coverNameAt, coverNames } from '../../src/cover-names.js';

const body = { name: 'Dana' };
const world = {
  bodyAt: (x, z) => (x === 1 && z === 0 ? body : null),
  nameOf: (value) => value.name,
  tileDefAt: (x, z) => (x === 0 && z === 1
    ? { cover: true, label: 'Filing Cabinet' }
    : null),
};

test('cover naming uses the same body, prop, and partition vocabulary', () => {
  assert.equal(coverNameAt(1, 0, world), 'Dana');
  assert.equal(coverNameAt(0, 1, world), 'filing cabinet');
  assert.equal(coverNameAt(-1, 0, world), 'partition');
});

test('cover naming deduplicates faces and formats a readable list', () => {
  assert.equal(coverNames(0, 0, [], world), 'cover');
  assert.equal(coverNames(0, 0, [[1, 0], [1, 0]], world), 'Dana');
  assert.equal(coverNames(0, 0, [[1, 0], [0, 1], [-1, 0]], world),
    'Dana, the filing cabinet and the partition');
});
