import test from 'node:test';
import assert from 'node:assert/strict';
import { createGodPanelState } from '../../src/god-panel-state.js';

test('god panel state owns shell, placement, and row lifecycle', () => {
  const state = createGodPanelState();
  assert.equal(state.open, false);
  assert.equal(state.activeTab, 'player');

  state.setOpen(true);
  state.selectTab('spawn');
  state.setShowInternals(true);
  state.beginPlacement('drop');
  assert.equal(state.open, true);
  assert.equal(state.activeTab, 'spawn');
  assert.equal(state.showInternals, true);
  assert.deepEqual(state.placement, { kind: 'drop' });

  const calls = [];
  const focused = {};
  state.trackRow(focused, () => calls.push('focused'));
  state.trackRow({}, () => calls.push('other'));
  state.syncRows(focused);
  assert.deepEqual(calls, ['other']);
  state.resetRows();
  state.syncRows(null);
  assert.deepEqual(calls, ['other']);

  state.clearPlacement();
  assert.equal(state.placement, null);
});

test('god panel signature follows structure, pins, and placement', () => {
  const state = createGodPanelState();
  const api = {
    party: { active: 1, members: [{ sheet: { hp: 3 } }, { sheet: { hp: 0 } }] },
    player: {}, enemies: [{}, {}], combat: {}, doors: [{}],
  };

  assert.equal(state.signature(api, 'hp'), 'player|hp|false|true|ad1|2|true|1|0|');
  state.pins.set('sheet.hp', {});
  state.beginPlacement('teleport');
  assert.equal(state.signature(api, 'hp'), 'player|hp|false|true|ad1|2|true|1|1|teleport');
});
