import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatSession } from '../../src/combat-session.js';

test('combat session starts ready for a player turn', () => {
  const member = { sheet: {} };
  const session = createCombatSession(member);

  assert.equal(session.activeMember, member);
  assert.equal(session.phase, 'player');
  assert.equal(session.acting, null);
  assert.equal(session.scrambleTurn, 0);
  assert.equal(session.running, true);
});

test('combat session owns scramble deals and terminal state', () => {
  const session = createCombatSession();
  session.phase = 'ai';
  session.acting = { unit: {}, ap: 3 };

  assert.equal(session.beginScrambleTurn(), 1);
  assert.equal(session.beginScrambleTurn(), 2);
  session.finish();

  assert.equal(session.phase, 'done');
  assert.equal(session.acting, null);
  assert.equal(session.running, false);
});
