// Unit tests for the status-effect runtime - pure logic, no PlayCanvas, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStatus, hasStatus, statusLeft, statusFx,
  tickTurn, tickStep, clearStatuses, statusList,
} from '../../src/statuses.js';

test('applyStatus applies a status at its default duration', () => {
  const t = {};
  assert.equal(applyStatus(t, 'gum'), true);
  assert.equal(hasStatus(t, 'gum'), true);
  assert.equal(statusLeft(t, 'gum'), 20); // gum's default
});

test('an unknown status id applies nothing', () => {
  const t = {};
  assert.equal(applyStatus(t, 'nope'), false);
  assert.equal(hasStatus(t, 'nope'), false);
});

test('re-applying refreshes to the longer duration - it never stacks', () => {
  const t = {};
  applyStatus(t, 'gum');            // 20
  tickStep(t);                      // 19
  applyStatus(t, 'gum', { duration: 5 });  // max(19, 5) = 19
  assert.equal(statusLeft(t, 'gum'), 19);
  applyStatus(t, 'gum', { duration: 25 }); // max(19, 25) = 25
  assert.equal(statusLeft(t, 'gum'), 25);
});

test('a resistable status is shortened by resist, floored at 1', () => {
  const a = {};
  applyStatus(a, 'gum', {}, 3);            // 20 - 3 = 17
  assert.equal(statusLeft(a, 'gum'), 17);
  const b = {};
  applyStatus(b, 'gum', { duration: 2 }, 5); // 2 - 5 -> floor 1
  assert.equal(statusLeft(b, 'gum'), 1);
  const c = {};
  applyStatus(c, 'bleed', {}, 5);          // bleed isn't resistable - resist ignored
  assert.equal(statusLeft(c, 'bleed'), 2);
});

test('immunity blocks application (statusImmune list and the paperCutImmune alias)', () => {
  const bleedImmune = { talent: { effects: { paperCutImmune: true } } };
  assert.equal(applyStatus(bleedImmune, 'bleed'), false);
  assert.equal(hasStatus(bleedImmune, 'bleed'), false);
  const listImmune = { talent: { effects: { statusImmune: ['stunned'] } } };
  assert.equal(applyStatus(listImmune, 'stunned'), false);
  assert.equal(applyStatus(listImmune, 'gum'), true); // not on the list - applies
});

test('statusFx merges: booleans OR, *Mult keys multiply, other numerics sum', () => {
  const empty = {};
  assert.deepEqual(statusFx(empty), {}); // nothing present
  const t = {};
  applyStatus(t, 'gum'); // moveCostMult 1.5, speedMult 0.6, noFootwork, slipProof
  let fx = statusFx(t);
  assert.equal(fx.moveCostMult, 1.5); // the multiply path (1 * 1.5)
  assert.equal(fx.speedMult, 0.6);
  assert.equal(fx.noFootwork, true);  // the OR path
  assert.equal(fx.slipProof, true);
  applyStatus(t, 'deflecting');       // a second status adds a distinct key
  assert.equal(statusFx(t).incomingMult, 0.5);
  const dotter = {};
  applyStatus(dotter, 'bleed');   // dot 1
  applyStatus(dotter, 'burning'); // dot 2
  assert.equal(statusFx(dotter).dot, 3); // the sum path
});

test('tickTurn fires dot, decrements, and expires at zero', () => {
  const t = {};
  applyStatus(t, 'burning'); // turn clock, duration 2, dot 2
  let r = tickTurn(t);
  assert.equal(r.damage, 2);
  assert.deepEqual(r.expired, []);
  assert.equal(statusLeft(t, 'burning'), 1);
  r = tickTurn(t);
  assert.equal(r.damage, 2);
  assert.deepEqual(r.expired, ['burning']);
  assert.equal(hasStatus(t, 'burning'), false);
});

test('a skipTurn status expires without dealing damage', () => {
  const t = {};
  applyStatus(t, 'surprised'); // turn clock, duration 1, skipTurn
  const r = tickTurn(t);
  assert.equal(r.damage, 0);
  assert.deepEqual(r.expired, ['surprised']);
});

test('turn-clock and step-clock statuses never tick each other', () => {
  const t = {};
  applyStatus(t, 'gum');     // step clock
  applyStatus(t, 'burning'); // turn clock
  tickTurn(t);
  assert.equal(statusLeft(t, 'gum'), 20);    // untouched by a turn tick
  assert.equal(statusLeft(t, 'burning'), 1);
  tickStep(t);
  assert.equal(statusLeft(t, 'gum'), 19);     // now the step tick moves gum
  assert.equal(statusLeft(t, 'burning'), 1);  // ...and leaves burning alone
});

test('clearStatuses: clock sweep, harmful-only, and full purge', () => {
  const sweep = {};
  applyStatus(sweep, 'gum'); applyStatus(sweep, 'deflecting'); applyStatus(sweep, 'burning');
  clearStatuses(sweep, { clock: 'turn' });          // the combat-end sweep
  assert.equal(hasStatus(sweep, 'gum'), true);       // step-clock persists
  assert.equal(hasStatus(sweep, 'deflecting'), false);
  assert.equal(hasStatus(sweep, 'burning'), false);

  const debuffs = {};
  applyStatus(debuffs, 'gum'); applyStatus(debuffs, 'deflecting');
  clearStatuses(debuffs, { harmfulOnly: true });
  assert.equal(hasStatus(debuffs, 'gum'), false);       // harmful cleared
  assert.equal(hasStatus(debuffs, 'deflecting'), true); // the buff is spared

  const purge = {};
  applyStatus(purge, 'gum'); applyStatus(purge, 'bleed'); applyStatus(purge, 'deflecting');
  const removed = clearStatuses(purge);              // purge wipes everything
  assert.equal(removed.length, 3);
  assert.deepEqual(statusList(purge), []);
});

test('statusList snapshots id, display fields, and remaining', () => {
  const t = {};
  applyStatus(t, 'gum');
  const list = statusList(t);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], { id: 'gum', left: 20, name: 'Gum on shoe', icon: '🍬', harmful: true });
});
