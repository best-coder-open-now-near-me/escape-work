import test from 'node:test';
import assert from 'node:assert/strict';
import { isLivingMember, livingMemberAt } from '../../src/member-rules.js';

test('member liveness requires both positive sheet HP and a body', () => {
  assert.equal(isLivingMember({ sheet: { hp: 1 }, actor: {} }), true);
  assert.equal(isLivingMember({ sheet: { hp: 0 }, actor: {} }), false);
  assert.equal(isLivingMember({ sheet: { hp: 1 }, actor: null }), false);
  assert.equal(isLivingMember(null), false);
});

test('livingMemberAt returns the live body on a tile and honors exclusion', () => {
  const down = { sheet: { hp: 0 }, actor: { x: 2, z: 3 } };
  const live = { sheet: { hp: 4 }, actor: { x: 2, z: 3 } };
  assert.equal(livingMemberAt([down, live], 2, 3), live);
  assert.equal(livingMemberAt([live], 2, 3, live), null);
  assert.equal(livingMemberAt([live], 3, 2), null);
});
