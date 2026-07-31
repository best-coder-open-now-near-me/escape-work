// The hotbar's view-model (src/hotbar-model.js). Pure module, plain sheets -
// no DOM, no bar, no fight.
//
// ARCHITECTURE.md's layering rule names this bar as the place a rule leaked:
// it carried its own ammo-cost copy without the talent discount and greyed out
// a legal throw. These assertions are what stops that recurring.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionIdsFor, itemCountsFor, combatOnlyReason, padLayout, layoutFor, assignInto,
  slotViewModel, combatSlotViewModel, throwablesFor,
} from '../../src/hotbar-model.js';
import { ACTIONS } from '../../src/data/actions.js';
import { ammoCostOf, createSheet, spendClassPoint, grantTalent } from '../../src/stats.js';

const ROW = 10;
const sheetOf = (over = {}) => ({
  name: 'Test', actions: ['attack'], inventory: [], paper: 10, attr: {}, ...over,
});

test('the bar lists the whole kit, not just the offensive slice', () => {
  // Whole classes used to be hidden from themselves: a power that only appeared
  // once a fight was running looked, for half the game, like it did not exist.
  const ids = actionIdsFor(sheetOf({ actions: ['attack', 'defend'] }));
  assert.ok(ids.includes('attack'));
  assert.ok(ids.includes('defend')); // a fight-only power still LISTS
  assert.ok(ids.includes('shove'));
  assert.ok(ids.includes('take-cover'));
});

test('a throwable the character cannot fold is not theirs to list', () => {
  const gated = Object.entries(ACTIONS).find(([, a]) => a.ammoCost && a.needsTalent);
  if (!gated) return; // no gated throwable in the registry today
  const [id, a] = gated;
  assert.ok(!actionIdsFor(sheetOf()).includes(id));
  assert.ok(actionIdsFor(sheetOf({ talent: { effects: { [a.needsTalent]: true } } })).includes(id));
});

test('an empty sheet lists nothing rather than throwing', () => {
  assert.deepEqual(actionIdsFor(null), []);
});

test('pockets count only what a PRESS would do something with', () => {
  const counts = itemCountsFor(sheetOf({
    inventory: ['cold-coffee', 'cold-coffee', 'stapler', 'paper-wad'],
  }));
  assert.equal(counts.get('cold-coffee'), 2); // heals
  assert.equal(counts.get('paper-wad'), 1); // ammo
  // Gear is not a hotbar press - equipping is a pockets-panel act with a stat
  // fold behind it.
  assert.equal(counts.get('stapler'), undefined);
});

test('the reactive pair is fight-only; the useful-out-here verbs are not', () => {
  assert.equal(combatOnlyReason('attack'), null);
  assert.equal(combatOnlyReason('shove'), null);
  assert.equal(combatOnlyReason('take-cover'), null); // designer, 2026-07-30
  // A purge is at its MOST useful out here - bleed runs on a step clock.
  const purge = Object.keys(ACTIONS).find((id) => ACTIONS[id].type === 'purge');
  if (purge) assert.equal(combatOnlyReason(purge), null);
  // A heal out here would be a free, refilling pool of HP - which is precisely
  // the thing the pockets exist to sell you.
  const heal = Object.keys(ACTIONS).find((id) => ACTIONS[id].type === 'heal');
  if (heal) assert.match(combatOnlyReason(heal), /pockets/);
});

test('the bar always has a spare slot, padded out to whole rows', () => {
  // The spare slot is the whole discoverability story: a bar with no free space
  // has nowhere to put the coffee, and a player who cannot see an empty slot
  // has no reason to right-click one.
  assert.equal(padLayout([], ROW).length, ROW);
  assert.equal(padLayout(new Array(3).fill({ kind: 'action', id: 'attack' }), ROW).length, ROW);
  // Fill the last row and the next one appears - which is how a second row of
  // items comes to exist at all.
  const full = new Array(ROW).fill({ kind: 'action', id: 'attack' });
  assert.equal(padLayout(full, ROW).length, ROW * 2);
  assert.equal(padLayout(full, ROW)[ROW], null);
});

test('a saved arrangement wins over the default, and an old save gets the default', () => {
  const own = [{ kind: 'item', id: 'coffee' }];
  assert.deepEqual(layoutFor(sheetOf({ hotbar: own }), ROW)[0], own[0]);
  // No such field (an older save): the canonical kit.
  const dflt = layoutFor(sheetOf(), ROW);
  assert.equal(dflt[0].kind, 'action');
});

test('assigning something already on the bar SWAPS the two slots', () => {
  // So the same power can never end up in two places.
  const layout = [{ kind: 'action', id: 'attack' }, { kind: 'action', id: 'shove' }, null];
  const out = assignInto(layout, 0, { kind: 'action', id: 'shove' });
  assert.deepEqual(out[0], { kind: 'action', id: 'shove' });
  assert.deepEqual(out[1], { kind: 'action', id: 'attack' });
});

test('clearing a slot leaves no trailing empties behind', () => {
  const layout = [{ kind: 'action', id: 'attack' }, { kind: 'action', id: 'shove' }];
  assert.deepEqual(assignInto(layout, 1, null), [{ kind: 'action', id: 'attack' }]);
});

test('assigning past the end grows the layout rather than dropping the entry', () => {
  const out = assignInto([], 3, { kind: 'action', id: 'attack' });
  assert.equal(out.length, 4);
  assert.deepEqual(out[3], { kind: 'action', id: 'attack' });
});

test('a slot carries THIS character\'s ammo cost, not the raw data one', () => {
  // The leak ARCHITECTURE.md names: the bar had its own copy without the talent
  // discount and greyed out a throw the targeting gate and combat both allowed.
  const throwId = Object.keys(ACTIONS).find((id) => ACTIONS[id].ammoCost && !ACTIONS[id].needsTalent);
  const s = sheetOf({ actions: ['attack', throwId] });
  const vm = slotViewModel({ kind: 'action', id: throwId }, s);
  assert.equal(vm.ammoCost, ammoCostOf(s, throwId));
});

test('a power the character no longer has still renders - greyed, with the reason', () => {
  // Rather than vanishing, which is the one thing a muscle-memory surface must
  // never do.
  const vm = slotViewModel({ kind: 'action', id: 'defend' }, sheetOf({ actions: ['attack'] }));
  assert.equal(vm.id, 'defend');
  assert.match(vm.unavailable, /not something you can do/);
});

test('an unknown id renders nothing at all', () => {
  assert.equal(slotViewModel({ kind: 'action', id: 'no-such-power' }, sheetOf()), null);
  assert.equal(slotViewModel({ kind: 'item', id: 'no-such-item' }, sheetOf()), null);
  assert.equal(slotViewModel(null, sheetOf()), null);
});

test('in a fight the numbers come from combat, and the slot keeps its shape', () => {
  const entry = { kind: 'action', id: 'attack' };
  const live = combatSlotViewModel(entry, {
    ammoCost: 2, uses: 1, live: 'armed', tip: 'a tip', affordable: true,
  }, 'Dana');
  assert.equal(live.ammoCost, 2);
  assert.equal(live.uses, 1);
  assert.equal(live.live, 'armed');
  assert.equal(live.unavailable, null);
  // Same fields either way - the point of the bar being one widget.
  const idle = slotViewModel(entry, sheetOf());
  for (const k of ['kind', 'id', 'label', 'icon', 'ap']) assert.equal(live[k], idle[k]);
});

test('a power the ACTING member does not have says so by name', () => {
  const vm = combatSlotViewModel({ kind: 'action', id: 'attack' }, null, 'Dana');
  assert.match(vm.unavailable, /Dana/);
});

test('an unaffordable-but-armed slot is not greyed', () => {
  // Arming spends nothing; the confirm click does. A slot that greys out the
  // moment you arm it takes the confirm away from you.
  const vm = combatSlotViewModel({ kind: 'action', id: 'attack' },
    { affordable: false, live: 'armed', reason: 'Not enough AP.' }, 'Dana');
  assert.equal(vm.unavailable, null);
  const cold = combatSlotViewModel({ kind: 'action', id: 'attack' },
    { affordable: false, live: null, reason: 'Not enough AP.' }, 'Dana');
  assert.match(cold.unavailable, /AP/);
});

// --- who has which throw (POWERS_PLAN M9) ------------------------------------
test('an ammo-priced attack everybody has, and one you have to learn', () => {
  // `ammoCost` says what a throw COSTS. Read as "who may make it" too - which
  // both bars did, in two separate copies of the same filter - it handed the
  // Drone's track grant to the entire roster the moment it was registered.
  const drone = createSheet('office-drone');
  const throws = throwablesFor(drone);
  assert.ok(throws.includes('paper-ball'), 'anyone can crumple a wad');
  assert.ok(!throws.includes('ream-throw'), 'a learned throw is not automatic');
  // ...and learning it puts it on the bar through sheet.actions, not through
  // the throwables list.
  drone.classPoints = 1;
  spendClassPoint(drone, 'drone-ream');
  assert.ok(!throwablesFor(drone).includes('ream-throw'));
  assert.ok(actionIdsFor(drone).includes('ream-throw'));
});

test('the airplane follows the talent, not the class', () => {
  // The sharpest single proof the axes came apart (TALENT_PLAN M1): a Security
  // guard who takes Origami Specialist can fold darts, which under the old
  // shape was a sentence that could not be written.
  const guard = createSheet('security');
  assert.ok(!throwablesFor(guard).includes('paper-airplane'));
  grantTalent(guard, 'origami-specialist');
  assert.ok(throwablesFor(guard).includes('paper-airplane'));
});
