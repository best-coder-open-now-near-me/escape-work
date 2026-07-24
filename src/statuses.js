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

// Apply (or refresh) a status. Immunity blocks it entirely; a `resistable`
// status has its duration shortened by `resist` (floored at 1); a re-apply
// keeps whichever of the current/new duration is longer (no stacking). Returns
// whether the status is now present.
export function applyStatus(target, id, opts = {}, resist = 0) {
  const def = STATUSES[id];
  if (!def) return false;
  if (isImmune(target, id)) return false;
  let dur = opts.duration != null ? opts.duration : def.duration;
  if (def.resistable && resist > 0) dur = Math.max(1, dur - resist);
  if (dur <= 0) return false;
  const map = mapOf(target);
  const cur = map[id]?.left || 0;
  map[id] = { left: Math.max(cur, dur) };
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
    const fx = STATUSES[id]?.effects || {};
    for (const k in fx) {
      const v = fx[k];
      if (typeof v === 'boolean') out[k] = (out[k] || false) || v;
      else if (k.endsWith('Mult')) out[k] = (out[k] == null ? 1 : out[k]) * v;
      else out[k] = (out[k] || 0) + v;
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
    if (!def || def.clock !== clock) continue;
    const entry = map[id];
    if (!(entry.left > 0)) continue;
    if (def.effects?.dot) result.damage += def.effects.dot;
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
    if (harmfulOnly && !def?.harmful) continue;
    if (clock && def?.clock !== clock) continue;
    delete map[id];
    removed.push(id);
  }
  return removed;
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
      id, left: map[id].left,
      name: def.name || id, icon: def.icon || '', harmful: !!def.harmful,
    });
  }
  return out;
}
