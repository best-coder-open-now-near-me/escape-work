// Unit tests for the impaired-sight math (src/vision.js) - the two pure
// functions the blind overlay is built on. No DOM here: createVisionLayer owns
// all of that, and none of it runs at import time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swayAt, ghostsAt, SWAY_PX, GHOST_PX } from '../../src/vision.js';

test('a clear-eyed character has no sway at all', () => {
  for (const t of [0, 1.3, 17.9]) {
    assert.deepEqual(swayAt(t, 0), { dx: 0, dy: 0 });
  }
});

test('the sway is bounded by SWAY_PX, scaled by strength', () => {
  for (let t = 0; t < 60; t += 0.05) {
    const full = swayAt(t, 1);
    assert.ok(Math.abs(full.dx) <= SWAY_PX + 1e-9, `dx ${full.dx} at t=${t}`);
    assert.ok(Math.abs(full.dy) <= SWAY_PX + 1e-9, `dy ${full.dy} at t=${t}`);
    const half = swayAt(t, 0.5);
    assert.ok(Math.abs(half.dx) <= Math.abs(full.dx) + 1e-9);
  }
});

test('strength is clamped, so a stacked pair of statuses cannot fling the aim', () => {
  const t = 4.2;
  assert.deepEqual(swayAt(t, 3), swayAt(t, 1));
  assert.deepEqual(swayAt(t, -2), { dx: 0, dy: 0 });
});

// The whole point of a sum of sines rather than Math.random: the drift is a
// swim the player can read and lead, and two runs of a test see the same one.
test('the sway is deterministic in time, and actually moves', () => {
  assert.deepEqual(swayAt(3.5, 1), swayAt(3.5, 1));
  const a = swayAt(0, 1);
  const b = swayAt(0.9, 1);
  assert.ok(Math.hypot(a.dx - b.dx, a.dy - b.dy) > 1);
});

// ...and it does not repeat on any short loop - two incommensurable frequencies
// per axis, so a player never learns "it comes back here every four seconds".
test('the sway does not close a short loop', () => {
  for (const period of [1, 2, 3, 4, 5, 6]) {
    const a = swayAt(11.3, 1);
    const b = swayAt(11.3 + period, 1);
    assert.ok(Math.hypot(a.dx - b.dx, a.dy - b.dy) > 0.5, `repeats at ${period}s`);
  }
});

test('the ghosts sit either side of the true aim, within GHOST_PX', () => {
  for (let t = 0; t < 30; t += 0.07) {
    const [a, b] = ghostsAt(t, 1);
    assert.ok(Math.hypot(a.dx, a.dy) <= GHOST_PX + 1e-9);
    assert.ok(Math.hypot(b.dx, b.dy) <= GHOST_PX + 1e-9);
    // Opposite each other: the pair reads as double vision around one point,
    // not as two extra cursors wandering off on their own.
    assert.ok(Math.abs(a.dx + b.dx) < 1e-9);
    assert.ok(Math.abs(a.dy + b.dy) < 1e-9);
  }
});

test('the ghosts never converge onto the true reticle', () => {
  for (let t = 0; t < 30; t += 0.05) {
    const [a] = ghostsAt(t, 1);
    // Below a few pixels the three would read as one cursor with a colour
    // fringe - a rendering glitch, not a symptom.
    assert.ok(Math.hypot(a.dx, a.dy) > 4, `converged at t=${t}`);
  }
});

test('ghosts scale with strength and vanish with it', () => {
  const [full] = ghostsAt(2.2, 1);
  const [half] = ghostsAt(2.2, 0.5);
  assert.ok(Math.hypot(half.dx, half.dy) < Math.hypot(full.dx, full.dy));
  for (const g of ghostsAt(2.2, 0)) assert.equal(Math.hypot(g.dx, g.dy), 0);
});
