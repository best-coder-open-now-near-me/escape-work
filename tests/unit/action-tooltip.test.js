import test from 'node:test';
import assert from 'node:assert/strict';
import { actionTooltip } from '../../src/action-tooltip.js';
import { ACTIONS } from '../../src/data/actions.js';
import { createSheet, ammoCostOf } from '../../src/stats.js';

test('the shared tooltip leads with the action registry description', () => {
  const tip = actionTooltip('all-hands');
  assert.match(tip, /^All-Hands - 3 AP/);
  assert.ok(tip.includes(ACTIONS['all-hands'].desc));
  assert.match(tip, /1 use per fight/);
  assert.match(tip, /Applies Detained/);
});

test('live character context adds the same values the hotbar resolves with', () => {
  const sheet = createSheet('office-drone');
  sheet.paper = 7;
  const cost = ammoCostOf(sheet, 'paper-ball');
  const tip = actionTooltip('paper-ball', {
    sheet,
    ammoCost: cost,
    ammoRemaining: sheet.paper,
  });
  assert.ok(tip.includes(ACTIONS['paper-ball'].desc));
  assert.match(tip, new RegExp(`Costs ${cost} paper \\(you have 7\\)`));
  assert.match(tip, /Damage \d+-\d+(?: \+\d+)?/);
});

test('unknown action ids produce no misleading tooltip', () => {
  assert.equal(actionTooltip('not-an-action'), '');
});
