import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunSession } from '../../src/run-session.js';

test('a run session starts on the ground floor and outside combat', () => {
  const run = createRunSession();

  assert.equal(run.playerLayer, 0);
  assert.equal(run.inCombat, false);
  assert.equal(run.combat, null);
  assert.equal(run.gameOver, false);
  assert.equal(run.pendingAction, null);
});

test('clearing combat retires both lifecycle fields together', () => {
  const run = createRunSession();
  run.inCombat = true;
  run.combat = { active: true };

  run.clearCombat();

  assert.equal(run.inCombat, false);
  assert.equal(run.combat, null);
});

test('finishing a run cancels outstanding player intent', () => {
  const run = createRunSession();
  run.pendingAction = { x: 1, z: 2 };
  run.armedOoc = 'attack';

  run.finishRun();

  assert.equal(run.gameOver, true);
  assert.equal(run.pendingAction, null);
  assert.equal(run.armedOoc, null);
});
