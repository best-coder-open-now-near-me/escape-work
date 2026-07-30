// The hotbar's VIEW-MODEL - pure logic, no DOM, no closure. What belongs on
// the bar, in what order, in which slot, and what each slot should say about
// itself. `ui/hud.js` renders it and reports clicks; main.js wires the two
// together and owns the arming.
//
// It is here rather than in main.js because it is the one part of the bar that
// is genuinely rules: which powers a character HAS, whether a slot can act
// right now, and what happens to the other slot when you reassign one. All of
// it was closure-bound, which is how the bar came to carry its own ammo-cost
// copy without the talent discount and grey out a legal throw.
//
// The bar is one widget in and out of a fight, and that stays true here: a slot
// in combat gets its numbers from combat.js (whose rules they are - the acting
// member's AP, uses and paper), and out of one it gets them from this module.
// Same slot, same fields, two rule-owners.

import { ACTIONS } from './data/actions.js';
import { ITEMS } from './data/items.js';
import { orderedActionIds, equippedAction, ammoCostOf } from './stats.js';

// Everything the character can DO, in canonical order.
//
// The bar used to be the OFFENSIVE slice only - attacks, shove, throws - on the
// theory that with no fight on, the only thing worth aiming at is a coworker.
// That quietly hid whole classes from themselves: HR's Post the Role never
// appeared until a fight was already running, so the power you picked the class
// for was invisible for half the game and looked like it didn't exist.
//
// The ORDER is stats.orderedActionIds - the same one combat's bar renders, so
// the kit reads the same in and out of a fight. A throwable the character can't
// fold (needsTalent) is not theirs to list.
export function actionIdsFor(s) {
  if (!s) return [];
  const throwables = Object.keys(ACTIONS).filter((id) => {
    const a = ACTIONS[id];
    return a.ammoCost && (!a.needsTalent || !!(s.talent?.effects || {})[a.needsTalent]);
  });
  return orderedActionIds(s, [
    ...s.actions, equippedAction(s), 'shove', 'take-cover', 'pull', ...throwables,
  ]);
}

// Consumables in the pockets, deduped, with how many are in there. These are
// the ITEMS a slot can carry: something with a `heal` or an `ammo` on it does
// something when pressed. Gear is deliberately not here - equipping is a
// pockets-panel act with a stat fold behind it, not a hotbar press.
export function itemCountsFor(s) {
  const counts = new Map();
  for (const id of s?.inventory || []) {
    const it = ITEMS[id];
    if (!it || !(it.heal || it.ammo)) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

// Why this action can't be used with no fight on, or null when it can be.
// Attacks, shoves and throws OPEN a fight; a summon posts on the spot. What's
// left is the reactive pair, and both need a fight to mean anything: Deflect
// Blame halves an incoming hit nobody is throwing, and a heal out here would be
// a free, per-fight-refilling pool of HP - which is precisely the thing the
// pockets exist to sell you.
//
// A purge is at its MOST useful out here: bleed runs on a step clock, so
// between fights is exactly when you want it gone. Take Cover works out here
// too (designer, 2026-07-30): crouch before anyone has noticed you, and the
// crouch rides into the fight.
export function combatOnlyReason(id) {
  const a = ACTIONS[id];
  const t = a?.type;
  if (!a || t === 'attack' || t === 'shove' || t === 'summon' || t === 'purge' || t === 'cover') {
    return null;
  }
  if (t === 'heal') return `${a.label} is for a fight - out here, heal from your pockets.`;
  return `${a.label} only means something once someone is swinging at you.`;
}

// The layout the BAR shows: what the character has, plus at least one empty
// slot, padded out to whole rows. The spare slot is the whole discoverability
// story - a bar with no free space has nowhere to put the coffee, and a player
// who can't see an empty slot has no reason to right-click one. It is also what
// grows the bar: fill the last row and the next one appears, pager and all.
export function padLayout(entries, rowSlots) {
  const rows = Math.max(1, Math.ceil((entries.length + 1) / rowSlots));
  const out = [...entries];
  while (out.length < rows * rowSlots) out.push(null);
  return out;
}

// The default is the whole kit in canonical order; `sheet.hotbar` is the
// player's own arrangement once they've moved something, and it lives on the
// SHEET so it survives a leader switch, a save and a floor - each character
// keeps their own bar. An older save has no such field and gets the default.
//
// A layout entry is { kind: 'action'|'item', id }, or null for a slot left
// empty on purpose. Assignments are kept even when what they name is
// unreachable right now (a stapler stowed, a coffee drunk): the slot dims and
// says why instead of the bar rearranging itself under the player's hands,
// which is the one thing a muscle-memory surface must never do.
export function layoutFor(s, rowSlots) {
  const own = s?.hotbar?.length ? s.hotbar : actionIdsFor(s).map((id) => ({ kind: 'action', id }));
  return padLayout(own, rowSlots);
}

// The layout after assigning `entry` to slot `i`. Assigning something already
// on the bar SWAPS the two slots - that is how the bar gets rearranged, and it
// means the same power can never end up in two places. Trailing empties are
// trimmed so the stored layout does not grow forever.
export function assignInto(layout, i, entry) {
  const out = [...layout];
  while (out.length <= i) out.push(null);
  if (entry) {
    const at = out.findIndex((s) => s && s.kind === entry.kind && s.id === entry.id);
    if (at >= 0) out[at] = out[i] || null;
  }
  out[i] = entry;
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

// A slot's view-model, out of combat. An assignment whose power the character
// no longer has (a weapon swing from a weapon now in the bag) still renders -
// as itself, greyed, with the reason - rather than vanishing.
//
// The ammo cost handed to the bar is THIS character's (the Origami Specialist
// throws an airplane for one sheet, not two) - the same number the targeting
// gate and combat itself charge. The bar used to be given the raw data cost and
// grey out throws the other two would allow.
export function slotViewModel(entry, s) {
  if (!entry) return null;
  if (entry.kind === 'item') {
    const def = ITEMS[entry.id];
    if (!def) return null;
    return {
      kind: 'item', id: entry.id, label: def.name, icon: def.icon,
      count: itemCountsFor(s).get(entry.id) || 0,
    };
  }
  const a = ACTIONS[entry.id];
  if (!a) return null;
  const available = actionIdsFor(s).includes(entry.id);
  return {
    kind: 'action',
    id: entry.id,
    label: a.label,
    icon: a.icon, // the face it wears on the bar (data/actions.js)
    ap: a.ap,
    ammoCost: ammoCostOf(s, entry.id),
    unavailable: available
      ? combatOnlyReason(entry.id)
      : `${a.label} is not something you can do right now.`,
  };
}

// The same slot, IN a fight. The rules belong to combat.js there: what the
// ACTING member can afford, out of their own kit, with their own uses and
// paper. `state` is combat's `actionState(id)`, or null when the acting member
// has no such power.
export function combatSlotViewModel(entry, state, actingName) {
  if (!entry || entry.kind === 'item') return null;
  const a = ACTIONS[entry.id];
  if (!a) return null;
  return {
    kind: 'action',
    id: entry.id,
    label: a.label,
    icon: a.icon,
    ap: a.ap,
    ammoCost: state?.ammoCost || 0,
    uses: state?.uses ?? null,
    // Armed (aiming) or awaiting its confirm click - the bar rings them
    // differently, as combat's own bar used to.
    live: state?.live || null,
    tip: state?.tip || null,
    unavailable: !state
      ? `${a.label} is not something ${actingName} can do.`
      : (state.affordable || state.live) ? null : state.reason,
  };
}
