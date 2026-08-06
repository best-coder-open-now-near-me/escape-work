import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatIntent } from '../../src/combat-intent.js';

function fixture() {
  const cleared = [];
  const lines = [];
  const intent = createCombatIntent({
    actions: {
      attack: { label: 'Stapler Swing' },
      defend: { label: 'Deflect Blame' },
    },
    clearAim: () => cleared.push(true),
    log: (line) => lines.push(line),
  });
  return { intent, cleared, lines };
}

test('aimed and confirming actions are mutually exclusive', () => {
  const { intent } = fixture();

  intent.confirm('defend');
  assert.equal(intent.pendingConfirm, 'defend');
  assert.equal(intent.armed, null);

  intent.arm('attack');
  assert.equal(intent.armed, 'attack');
  assert.equal(intent.pendingConfirm, null);

  intent.confirm('defend');
  assert.equal(intent.armed, null);
  assert.equal(intent.pendingConfirm, 'defend');
});

test('disarm clears the whole click intent and its aim view', () => {
  const { intent, cleared } = fixture();
  intent.arm('attack');

  intent.disarm();

  assert.equal(intent.armed, null);
  assert.equal(intent.pendingConfirm, null);
  assert.equal(cleared.length, 1);
});

test('cancel narrates a visible intent but a quiet cancel does not', () => {
  const { intent, cleared, lines } = fixture();
  intent.arm('attack');
  assert.equal(intent.cancel(), true);
  assert.deepEqual(lines, ['You lower the stapler swing.']);

  intent.confirm('defend');
  assert.equal(intent.cancel(true), true);
  assert.deepEqual(lines, ['You lower the stapler swing.']);
  assert.equal(intent.cancel(), false);
  assert.equal(cleared.length, 3);
});
