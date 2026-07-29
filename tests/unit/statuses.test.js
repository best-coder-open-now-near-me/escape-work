// Unit tests for the status-effect runtime - pure logic, no PlayCanvas, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUSES } from '../../src/data/statuses.js';
import {
  applyStatus, hasStatus, statusLeft, statusFx,
  tickTurn, tickStep, clearStatuses, removeStatus, statusList,
  blockedBy, IMMUNITY_WINDOW_MULT,
  severityFor, statusSeverity, SEVERITY_PER_RESIST, SEVERITY_FLOOR,
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

// --- the anti-chain window (SHADOWBANE_NOTES.md §3) --------------------------

test('a stun grants a window of IMMUNITY_WINDOW_MULT x the duration it applied', () => {
  const t = {};
  assert.equal(applyStatus(t, 'stunned'), true); // duration 1
  assert.equal(statusLeft(t, 'stunned'), 1);
  assert.equal(statusLeft(t, 'training-credit'), 1 * IMMUNITY_WINDOW_MULT);
  // The window sizes off the duration ACTUALLY applied, not the def's default.
  const long = {};
  applyStatus(long, 'stunned', { duration: 2 });
  assert.equal(statusLeft(long, 'training-credit'), 2 * IMMUNITY_WINDOW_MULT);
});

test('the window blocks a second stun, and blockedBy names it', () => {
  const t = {};
  applyStatus(t, 'stunned');
  assert.equal(blockedBy(t, 'stunned'), 'training-credit');
  assert.equal(applyStatus(t, 'stunned'), false); // no stun-lock
  assert.equal(statusLeft(t, 'stunned'), 1);      // not even refreshed
  assert.equal(blockedBy(t, 'gum'), null);        // gum declares no window
  assert.equal(applyStatus(t, 'gum'), true);      // ...so it still lands
});

test('the window outlives the stun, leaving free turns behind it', () => {
  const t = {};
  applyStatus(t, 'stunned'); // stun 1, window 3
  tickTurn(t);               // the turn the stun costs
  assert.equal(hasStatus(t, 'stunned'), false);
  assert.equal(statusLeft(t, 'training-credit'), 2); // two free turns owed
  assert.equal(applyStatus(t, 'stunned'), false);
  tickTurn(t); tickTurn(t);
  assert.equal(hasStatus(t, 'training-credit'), false); // window shut...
  assert.equal(applyStatus(t, 'stunned'), true);        // ...and stuns land again
});

test('resisting a stun shortens the window it buys - Composure is not paid twice', () => {
  const stoic = {};
  applyStatus(stoic, 'stunned', { duration: 3 }, 2); // resisted 3 -> 1
  assert.equal(statusLeft(stoic, 'stunned'), 1);
  assert.equal(statusLeft(stoic, 'training-credit'), 1 * IMMUNITY_WINDOW_MULT);
});

test('the window is a status like any other: charted, spared by a debuff sweep, purged', () => {
  const t = {};
  applyStatus(t, 'stunned');
  const chip = statusList(t).find((s) => s.id === 'training-credit');
  assert.deepEqual(chip, {
    id: 'training-credit', left: 3, sev: 1, name: 'Training Credit', icon: '✅', harmful: false,
  });
  clearStatuses(t, { harmfulOnly: true });          // the stun goes, the credit stays
  assert.equal(hasStatus(t, 'stunned'), false);
  assert.equal(hasStatus(t, 'training-credit'), true);
  clearStatuses(t);                                  // a full purge takes it too
  assert.equal(hasStatus(t, 'training-credit'), false);
  assert.equal(applyStatus(t, 'stunned'), true);      // so a reboot re-opens the target
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

test('removeStatus drops one status and reports whether it was there', () => {
  const t = {};
  applyStatus(t, 'gum'); applyStatus(t, 'bleed');
  assert.equal(removeStatus(t, 'gum'), true);
  assert.equal(hasStatus(t, 'gum'), false);
  assert.equal(hasStatus(t, 'bleed'), true); // the other survives
  assert.equal(removeStatus(t, 'gum'), false); // already gone
});

test('statusList snapshots id, display fields, and remaining', () => {
  const t = {};
  applyStatus(t, 'gum');
  const list = statusList(t);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], { id: 'gum', left: 20, sev: 1, name: 'Gum on shoe', icon: '🍬', harmful: true });
});

// --- severity: the second thing Composure buys -------------------------------

test('resist blunts a resistable status as well as shortening it', () => {
  const t = {};
  applyStatus(t, 'blinded', {}, 3);
  assert.equal(statusLeft(t, 'blinded'), 1); // 2 - 3, floored at 1
  assert.equal(statusSeverity(t, 'blinded'), 1 - 3 * SEVERITY_PER_RESIST);
  // ...and every magnitude comes through the merged view scaled by it.
  const fx = statusFx(t);
  assert.ok(Math.abs(fx.accMod - -0.3 * statusSeverity(t, 'blinded')) < 1e-9);
  assert.ok(Math.abs(fx.aimSway - 1 * statusSeverity(t, 'blinded')) < 1e-9);
});

test('an unresisted status lands at full severity', () => {
  const t = {};
  applyStatus(t, 'blinded');
  assert.equal(statusSeverity(t, 'blinded'), 1);
  assert.equal(statusFx(t).accMod, -0.3);
});

test('a non-resistable status ignores resist entirely', () => {
  const t = {};
  applyStatus(t, 'bleed', {}, 5); // bleed is resistable: false
  assert.equal(statusLeft(t, 'bleed'), 2);
  assert.equal(statusSeverity(t, 'bleed'), 1);
  assert.equal(severityFor('bleed', 5), 1);
});

test('severity floors out - resist blunts a status, it never switches it off', () => {
  assert.equal(severityFor('blinded', 999), SEVERITY_FLOOR);
  const t = {};
  applyStatus(t, 'blinded', {}, 999);
  assert.equal(statusSeverity(t, 'blinded'), SEVERITY_FLOOR);
  assert.ok(statusFx(t).accMod < 0); // still bites
});

test('booleans never scale - a resisted stun still costs the whole turn', () => {
  const t = {};
  applyStatus(t, 'stunned', {}, 4);
  assert.equal(statusFx(t).skipTurn, true);
  assert.ok(statusSeverity(t, 'stunned') < 1); // blunted on paper...
  assert.equal(statusLeft(t, 'stunned'), 1); // ...and shortened, which is the real defence
});

test('multipliers ease back toward 1, not toward 0', () => {
  const t = {};
  applyStatus(t, 'gum', {}, 4); // severity 1 - 4*0.12 = 0.52
  const sev = statusSeverity(t, 'gum');
  const fx = statusFx(t);
  assert.ok(Math.abs(fx.moveCostMult - (1 + 0.5 * sev)) < 1e-9); // 1.5 -> 1.26
  assert.ok(Math.abs(fx.speedMult - (1 - 0.4 * sev)) < 1e-9);    // 0.6 -> 0.79
  assert.ok(fx.moveCostMult < 1.5 && fx.moveCostMult > 1);
  assert.ok(fx.speedMult > 0.6 && fx.speedMult < 1);
});

test('a re-apply keeps the WORSE severity, as it keeps the longer duration', () => {
  const t = {};
  applyStatus(t, 'blinded', {}, 4);          // blunted
  const blunted = statusSeverity(t, 'blinded');
  applyStatus(t, 'blinded');                 // ...then a clean hit lands
  assert.equal(statusSeverity(t, 'blinded'), 1);
  applyStatus(t, 'blinded', {}, 4);          // a resisted re-apply cannot soften it back
  assert.equal(statusSeverity(t, 'blinded'), 1);
  assert.ok(blunted < 1);
});

test('a dot scales with severity, rounded and never below 1', () => {
  const t = { statuses: { burning: { left: 2, sev: 0.4 } } };
  assert.equal(tickTurn(t).damage, 1); // round(2 * 0.4) = 1
  const floored = { statuses: { bleed: { left: 2, sev: 0.4 } } };
  assert.equal(tickStep(floored).damage, 1); // round(1 * 0.4) = 0 -> floored at 1
});

test('a status map written before severity existed reads as full strength', () => {
  const legacy = { statuses: { blinded: { left: 2 } } }; // no `sev` - an old save
  assert.equal(statusSeverity(legacy, 'blinded'), 1);
  assert.equal(statusFx(legacy).accMod, -0.3);
});

