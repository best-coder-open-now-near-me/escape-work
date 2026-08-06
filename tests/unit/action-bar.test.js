import test from 'node:test';
import assert from 'node:assert/strict';
import { createActionBar } from '../../src/action-bar.js';

test('arming a targeted action narrates the action, not its host property', () => {
  let armed = null;
  let pendingConfirm = null;
  const lines = [];
  const bar = createActionBar({
    get phase() { return 'player'; },
    get armed() { return armed; },
    get pendingConfirm() { return pendingConfirm; },
    active: { sheet: {}, usesLeft: {} },
    INSTANT_CONFIRM: new Set(),
    actionState: () => ({ affordable: true }),
    setArmed: (id) => { armed = id; },
    setPendingConfirm: (id) => { pendingConfirm = id; },
    hidePreview: () => {},
    log: (line) => lines.push(line),
    refresh: () => {},
  });

  bar.pressAction('attack');

  assert.equal(armed, 'attack');
  assert.deepEqual(lines, ['Passive-Aggressive Email armed. Click a target.']);
});
