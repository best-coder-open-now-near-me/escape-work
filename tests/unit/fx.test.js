import test from 'node:test';
import assert from 'node:assert/strict';
import { footprintDecalYaw } from '../../src/fx.js';

test('footprint texture toe is rotated onto the actor forward axis', () => {
  assert.equal(footprintDecalYaw(0), 180);
  assert.equal(footprintDecalYaw(90), 270);
  assert.equal(footprintDecalYaw(-90), 90);
});
