// The status-effect runtime (STATUS_PLAN.md) - pure logic, no PlayCanvas, no
// DOM. One interpreter for the data/statuses.js registry, working identically
// on a party member's sheet and an AI unit: both just carry a `statuses` map.
//
// Storage: target.statuses = { [id]: { left } }, where `left` is the remaining
// ticks (turn clock) or steps (step clock) for that status. No stacking - a
// re-apply refreshes to max(remaining, new). Ticks RETURN their dot damage and
// expiries rather than applying HP loss, so combat and the map step handlers
// keep owning HP mutation and FX (the same split as truncateByBudget).
import { STATUSES } from './data/statuses.js';

// The anti-chain rule, borrowed from Shadowbane (SHADOWBANE_NOTES.md §3): a
// status that DENIES A TURN grants immunity to itself for three times the
// duration it actually applied. So a stun always buys its victim free turns
// afterwards, and no source - nor any combination of sources - can chain
// turn-denial into a lock.
//
// A turn-based game needs this more than the MMO it comes from. There, a
// stun-lock costs you seconds of control; here it costs you your whole turn,
// with nothing to do but watch it happen. Both sides are covered by the same
// rule: the player's rationed Detain plus an unlimited shove-stun could
// otherwise lock an enemy out of the fight just as thoroughly.
//
// Three, not two: at 2x a 1-turn stun leaves exactly one free turn, which a
// second stunner in the same fight erases. 3x leaves two.
export const IMMUNITY_WINDOW_MULT = 3;

// SEVERITY: the second thing Composure buys. `statusResist` already shortens a
// resistable status; it now also blunts one, so a composed character carries a
// weaker version of it for those fewer turns. Stored per-application (the
// resist at the moment it landed), because the alternative - recomputing it on
// every read - would let a mid-fight gear swap retroactively soften a status
// that is already on you.
//
// Every magnitude in the merged view scales with it (statusFx below): a blinded
// character with Composure sways less, loses less accuracy and sees less ink.
// BOOLEANS DO NOT. A turn cannot be half-skipped and an action bar cannot be
// half-shuffled, so those are duration's business alone - which is the honest
// division, and it keeps Composure from quietly becoming stun immunity.
export const SEVERITY_PER_RESIST = 0.12;
// ...and it never reaches zero. The same rule as the duration floor: resist
// makes a status survivable, never a no-op, or the counter-stat becomes an
// off switch and the whole status is uninteresting to build against.
export const SEVERITY_FLOOR = 0.4;

// How hard `id` lands on a target with this much resist, 0..1.
export function severityFor(id, resist = 0) {
  const def = STATUSES[id];
  if (!def?.resistable || !(resist > 0)) return 1;
  return Math.max(SEVERITY_FLOOR, 1 - resist * SEVERITY_PER_RESIST);
}

function mapOf(target) {
  if (!target.statuses) target.statuses = {};
  return target.statuses;
}

// A target is immune to `id` via a talent effect: an explicit `statusImmune`
// list, or the legacy `paperCutImmune` (bleed). AI units carry no talent, so
// they are immune to nothing - which matches today's behavior.
function isImmune(target, id) {
  const fx = target?.talent?.effects || {};
  if (Array.isArray(fx.statusImmune) && fx.statusImmune.includes(id)) return true;
  if (id === 'bleed' && fx.paperCutImmune) return true;
  return false;
}

export function hasStatus(target, id) {
  const e = target?.statuses?.[id];
  return !!(e && e.left > 0);
}

// The remaining ticks/steps of a status (0 when absent).
export function statusLeft(target, id) {
  return target?.statuses?.[id]?.left || 0;
}

// How hard it is landing on this target, 0..1 (1 when absent, and for anything
// applied before severity existed - saves carry these maps).
export function statusSeverity(target, id) {
  return target?.statuses?.[id]?.sev ?? 1;
}

// The live anti-chain window turning `id` away on this target, or null - the id
// of the blocking status, so a caller can name it. Exported because applyStatus
// can only answer with a boolean, and "nothing happened" is precisely the
// outcome a fairness rule must not leave unexplained: combat.js reads this to
// narrate the block. Call it BEFORE applyStatus, which grants the window itself
// on success.
export function blockedBy(target, id) {
  const window = STATUSES[id]?.immunity;
  return window && hasStatus(target, window) ? window : null;
}

// Apply (or refresh) a status. Immunity blocks it entirely - whether declared by
// a talent or standing as a live anti-chain window; a `resistable` status has
// its duration shortened by `resist` (floored at 1); a re-apply keeps whichever
// of the current/new duration is longer (no stacking). Returns whether the
// status is now present.
export function applyStatus(target, id, opts = {}, resist = 0) {
  const def = STATUSES[id];
  if (!def) return false;
  if (isImmune(target, id)) return false;
  if (blockedBy(target, id)) return false;
  let dur = opts.duration != null ? opts.duration : def.duration;
  if (def.resistable && resist > 0) dur = Math.max(1, dur - resist);
  // FINITE and positive. `dur <= 0` alone let two impossible durations through,
  // because neither comparison is true of them: NaN wrote `left: NaN`, which no
  // clock can decrement and no reader counts as present - and this still
  // returned true, so the caller narrated and billed for a status that was
  // never applied. Infinity wrote a status nothing can ever expire. A duration
  // that is not a number is a caller bug; refusing it is how it gets found.
  if (!Number.isFinite(dur) || dur <= 0) return false;
  const map = mapOf(target);
  const cur = map[id]?.left || 0;
  // A re-apply takes the WORSE of the two severities, for the same reason it
  // takes the longer of the two durations: refreshing a status must never be a
  // way to weaken one that is already biting.
  //
  // The floor distinguishes NO ENTRY from an entry with no `sev`, which a bare
  // `?? 0` could not:
  //   - nothing there yet -> 0, so a first application takes its own severity,
  //     resist included. This is what makes a resisted status land blunted.
  //   - an entry without `sev` -> 1, because that is what every OTHER reader
  //     assumes (statusSeverity, the tick, statusList). Reading it as 0 here
  //     made this the one site that disagreed, and it disagreed in the
  //     direction the rule above forbids: a resisted re-apply on a
  //     severity-less entry - one carried from a pre-severity save, or the
  //     immunity window written below - replaced an effective 1 with a smaller
  //     number, weakening a status by refreshing it.
  const prior = map[id] ? (map[id].sev ?? 1) : 0;
  const sev = Math.max(prior, severityFor(id, resist));
  map[id] = { left: Math.max(cur, dur), sev };
  // Grant the anti-chain window LAST, so it can never block the application
  // that created it, and size it off `dur` - the duration actually applied,
  // post-resist - rather than the def's. Composure shortening a stun therefore
  // shortens the shield that stun buys, which is the faithful reading of "three
  // times the length of the stun" and keeps Composure from being paid twice.
  //
  // Written straight into the map rather than recursed through applyStatus: the
  // window must not itself be resisted, blocked, or talent-immune.
  if (def.immunity && STATUSES[def.immunity]) {
    const open = map[def.immunity]?.left || 0;
    map[def.immunity] = { left: Math.max(open, dur * IMMUNITY_WINDOW_MULT) };
  }
  return true;
}

// The merged effect view of every live status on the target (STATUS_PLAN #5):
// booleans OR together, `*Mult` keys multiply, every other numeric key sums.
// Returns only the keys that are actually present, so readers default the rest
// (a mult reader uses `?? 1`, a mod reader `|| 0`) - the talentFxOf pattern.
export function statusFx(target) {
  const out = {};
  const map = target?.statuses;
  if (!map) return out;
  for (const id in map) {
    if (!(map[id].left > 0)) continue;
    // Severity scales every magnitude and no boolean (see SEVERITY_PER_RESIST):
    // flat mods shrink toward 0, multipliers ease back toward 1 - a gummed shoe
    // resisted at 0.5 severity costs 1.25x move AP rather than 1.5x.
    const sev = map[id].sev ?? 1;
    const fx = STATUSES[id]?.effects || {};
    for (const k in fx) {
      const v = fx[k];
      if (typeof v === 'boolean') out[k] = (out[k] || false) || v;
      else if (k.endsWith('Mult')) out[k] = (out[k] == null ? 1 : out[k]) * (1 + (v - 1) * sev);
      else out[k] = (out[k] || 0) + v * sev;
    }
  }
  return out;
}

// Advance every status on one clock by a tick: fire its dot, decrement, and
// expire it at zero. Returns the total dot damage dealt this tick and the ids
// that expired - the caller applies the HP loss and narrates. Turn-clock and
// step-clock statuses never tick each other.
function tick(target, clock) {
  const map = target?.statuses;
  const result = { damage: 0, expired: [] };
  if (!map) return result;
  for (const id in map) {
    const def = STATUSES[id];
    // A status id that has LEFT the registry is dropped on sight. It used to be
    // skipped, and skipped is immortal: no clock ticked it, and both sweep
    // options passed over it too (`harmfulOnly` reads `def.harmful`,
    // the combat-end sweep reads `def.clock` - an absent def fails both, and
    // both spare what they cannot classify). So a save written before a status
    // was renamed or retired carried it forever, with `hasStatus` still
    // answering yes. Deleting mid-`for...in` is safe, and this is the loop that
    // visits every id on every clock.
    if (!def) { delete map[id]; continue; }
    if (def.clock !== clock) continue;
    const entry = map[id];
    if (!(entry.left > 0)) continue;
    // Dots take severity too, so "Composure blunts it" means the same thing
    // everywhere - but rounded, and never below 1: a resisted burn should hurt
    // less, not tick for 0.8 HP and not stop hurting at all. (Nothing shipping
    // is both `resistable` and a dot; this is here so the first one that is
    // doesn't silently ignore the stat.)
    if (def.effects?.dot) {
      result.damage += Math.max(1, Math.round(def.effects.dot * (entry.sev ?? 1)));
    }
    entry.left -= 1;
    if (entry.left <= 0) { delete map[id]; result.expired.push(id); }
  }
  return result;
}
export const tickTurn = (target) => tick(target, 'turn');
export const tickStep = (target) => tick(target, 'step');

// Remove statuses. Purge (reboot) clears everything; the combat-end sweep
// passes `{ clock: 'turn' }` (step-clock statuses persist on the map);
// `{ harmfulOnly: true }` would spare buffs. Returns the ids removed.
export function clearStatuses(target, { harmfulOnly = false, clock = null } = {}) {
  const map = target?.statuses;
  const removed = [];
  if (!map) return removed;
  for (const id in map) {
    const def = STATUSES[id];
    // Same rule as the tick: an id the registry no longer knows is removed by
    // any sweep, not spared by every one of them. Both filters below ask the
    // def a question, and an absent def answered "not me" to both.
    if (def && harmfulOnly && !def.harmful) continue;
    if (def && clock && def.clock !== clock) continue;
    delete map[id];
    removed.push(id);
  }
  return removed;
}

// Remove a single status by id. Returns whether it was present.
export function removeStatus(target, id) {
  if (target?.statuses && target.statuses[id]) {
    delete target.statuses[id];
    return true;
  }
  return false;
}

// A UI/debug snapshot of the live statuses: id, display fields, and remaining.
export function statusList(target) {
  const map = target?.statuses;
  if (!map) return [];
  const out = [];
  for (const id in map) {
    if (!(map[id].left > 0)) continue;
    const def = STATUSES[id] || {};
    out.push({
      id, left: map[id].left, sev: map[id].sev ?? 1,
      name: def.name || id, icon: def.icon || '', harmful: !!def.harmful,
    });
  }
  return out;
}
