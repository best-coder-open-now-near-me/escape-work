import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, mulberry32Uint } from '../../src/rng.js';

test('mulberry32 streams replay from the same seed and diverge from another', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const c = mulberry32(43);
  const first = [a(), a(), a()];
  assert.deepEqual([b(), b(), b()], first);
  assert.notDeepEqual([c(), c(), c()], first);
  assert.ok(first.every((value) => value >= 0 && value < 1));
});

test('the float and uint streams are the same mixer at different scales', () => {
  const asFloat = mulberry32(7);
  const asUint = mulberry32Uint(7);
  for (let i = 0; i < 5; i++) assert.equal(asFloat(), asUint() / 4294967296);
});
