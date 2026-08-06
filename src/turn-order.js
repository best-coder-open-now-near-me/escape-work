// The turn engine. Pure logic - no PlayCanvas, no DOM, unit tested like
// initiative.js beside it.
//
// initiative.js answers "what is the order?"; this answers "whose turn is it,
// and what happens at the top of it?" - the traversal (advance, wrap into a
// fresh round, skip anyone who cannot act) plus the fixed sequence every turn
// opens with:
//
//   1. is the fight already over?          -> hand back 'over'
//   2. is this slot still on the board?    -> no: skip it
//   3. is it a temp whose contract lapsed? -> yes: expire it and skip
//      ...otherwise spend one of its turns HERE, at the top of its own turn,
//      which is what makes "six turns" mean six turns it actually got to act
//   4. tick its turn-clock statuses        -> a dot bites, durations decrement
//   5. was it incapacitated?               -> spend the turn on that
//   6. otherwise: it acts
//
// SHARED TURNS (INITIATIVE_PLAN): a turn's holder is a SPAN, not a slot. When
// the pointer lands on a slot the host says is `controlled`, the span extends
// forward over every consecutive controlled slot - BG3's rule: neighbours in
// the order share the turn, tied or not - and the sequence above runs once per
// slot as the span opens. The slots that survive it hold the floor together
// (`held`); the caller steers one at a time (`steer`), retires them one at a
// time (`finish`), and the turn ends when none remain. A host without a
// `controlled` hook gets spans of exactly one slot, which is the engine
// behaving exactly as it did before spans existed - the pre-span tests still
// bind because they run through this same code, not a preserved copy of it.
//
// Every combat-specific answer arrives through `host`, so the engine never
// touches a sheet, an actor, a panel or the app. Slots are OPAQUE: whatever the
// caller threads through rides along untouched (initiative.js's contract), and
// the engine asks the host about them rather than reading their shape. That is
// what lets a test drive the whole lifecycle with plain objects.
//
// The traversal is a LOOP, not recursion. Skipping is the common case - a
// corpse, an expired temp, the stunned - and each skip used to be a fresh
// recursive call into the turn opener; a fight where nobody can act would
// overflow the stack rather than say so. `begin()` returns 'stalled' instead
// (see STALL_LAPS).
import { buildInitiativeOrder, rollInitiative, insertionIndex } from './initiative.js';
import { statusFx, tickTurn } from './statuses.js';

// How many full passes through the order may go by without anyone taking a
// turn before the engine calls it stuck. Two is the smallest honest bound: a
// walk can legitimately cross one round boundary (finish the current lap, then
// start a fresh one) before finding a live slot.
const STALL_LAPS = 2;

// The host interface. Everything is called with the opaque slot.
//
//   alive(slot)          is this combatant still in the fight?
//   carrier(slot)        the thing its statuses live on (a sheet, or an AI unit)
//   outcome()            'win' | 'lose' | null - checked at every turn boundary
//   win() / lose()       end the fight; the engine stops touching the order
//   lifetimeLeft(slot)   turns a temp has left, or null if it isn't one
//   spendLifetime(slot)  burn one of them
//   expire(slot)         its contract lapsed: take it off the board
//   dot(slot, damage)    apply a turn-start dot; return 'fell' if it dropped
//                        the owner (the engine then moves on), 'stands' if not
//   skip(slot)           it cannot act. Return 'advance' to pass the turn
//                        immediately (a member recovers and play moves on), or
//                        'hold' to keep the turn on this slot while the host
//                        plays out a beat (an AI unit standing there dazed).
//   take(slot, held)     hand the span the turn - `slot` is the first held
//                        slot (the one steered), `held` every slot holding the
//                        floor. A host from before spans reads only the first
//                        argument and sees exactly the call it always saw.
//   roundStart()         a full pass completed: age cooldowns, refill reactions
//   turnStart()          optional, fires before every attempt including skips
//   afterTick(slot)      optional, fires after its statuses tick
//   beforeAdvance()      optional, fires when a turn is given up - under a
//                        span, once per finished slot: each member giving up
//                        THEIR turn is a turn given up
//   controlled(slot)     optional: is this slot player-driven? Consecutive
//                        controlled slots share a turn. No hook, no sharing.
//   steer(slot, held)    optional: the floor moved to `slot` within an open
//                        span - via `steer()` below or `finish` passing it
//                        on - so the host can re-key its bindings
export function createTurnOrder({ entries, rng = Math.random, host }) {
  let order = buildInitiativeOrder(entries, rng);
  let turnPtr = 0;

  // The open span. `spanSlots` is every slot the span covered as it opened -
  // held or skipped - and is what the pointer advances past when the turn
  // ends; `held` is the subset actually holding the floor; `done` the held
  // slots already retired; `steerIdx` which held slot the caller is driving.
  // All tracked by IDENTITY, never by index: `insert` can splice a joiner
  // into the middle of an open span (it does not join - INITIATIVE_PLAN #7 -
  // it acts when the pointer next reaches it), so an index recorded at open
  // time is stale by the time the span closes.
  let spanSlots = [];
  let held = [];
  let done = new Set();
  let steerIdx = 0;

  // Move the pointer past everything the span covered, wrapping into a fresh
  // round at the end of the pass. With no span recorded this is the plain
  // step-by-one the engine always had.
  function advancePastSpan() {
    let max = turnPtr;
    for (const s of spanSlots) {
      const i = order.indexOf(s); // -1 if `replace` swapped it out mid-turn
      if (i > max) max = i;
    }
    turnPtr = max + 1;
    spanSlots = []; held = []; done = new Set(); steerIdx = 0;
    if (turnPtr < order.length) return;
    turnPtr = 0;
    host.roundStart();
  }

  // The fixed sequence one slot's turn opens with. Returns 'ready' (it can
  // act), 'skip' (it cannot - dead, lapsed, felled by its own dot,
  // incapacitated), 'hold' (incapacitated but the host keeps the floor on it
  // for a beat), or 'over' (its dot decided the fight).
  function openSlot(slot) {
    if (!host.alive(slot)) return 'skip'; // a corpse or a downed slot

    // A temp serves a fixed number of ITS OWN turns; the contract lapses at the
    // top of the one it can no longer pay for.
    const left = host.lifetimeLeft(slot);
    if (left != null) {
      if (left <= 0) {
        host.expire(slot);
        return 'skip';
      }
      host.spendLifetime(slot);
    }

    // Incapacitation is read BEFORE the tick, because the tick is what expires
    // a one-turn stun or surprise: the status has to cost its owner THIS turn,
    // not lapse just in time for them to act.
    const carrier = host.carrier(slot);
    const skipped = !!statusFx(carrier).skipTurn;
    const { damage } = tickTurn(carrier);
    host.afterTick?.(slot);

    if (damage > 0 && host.dot(slot, damage) === 'fell') {
      // A dot can decide the fight - the last coworker burns down, or the last
      // member does. Settle that BEFORE anything else moves: a pointer walk
      // here would open a fresh round (aging the fire, refilling reactions,
      // calling the host's round hook) on a fight that is already over, and
      // under a span it would go on opening turns for the rest of a group in
      // a fight that ended on this very slot.
      const now = host.outcome();
      if (now === 'win') { host.win(); return 'over'; }
      if (now === 'lose') { host.lose(); return 'over'; }
      return 'skip';
    }
    if (skipped) return host.skip(slot) === 'hold' ? 'hold' : 'skip';
    return 'ready';
  }

  // One attempt at opening a turn. Returns 'taken' (somebody has the floor),
  // 'again' (nothing in this span could act - the pointer has already moved),
  // or 'over' (the fight ended on this boundary).
  function step() {
    // A fresh attempt owns the floor state. Clearing here rather than on the
    // 'over' paths means a fight that ends on a boundary can never leave a
    // stale span behind for `current` to report.
    spanSlots = []; held = []; done = new Set(); steerIdx = 0;

    host.turnStart?.();
    const settled = host.outcome();
    if (settled === 'win') { host.win(); return 'over'; }
    if (settled === 'lose') { host.lose(); return 'over'; }

    const slot = order[turnPtr];
    if (!slot) { advancePastSpan(); return 'again'; }

    // The span: this slot, and - if the host says it is player-controlled -
    // every consecutive controlled slot after it. The run never wraps past the
    // end of the order: a round boundary is a real boundary (roundStart ages
    // cooldowns and refills reactions between the laps), not a seam to share
    // a turn across.
    spanSlots = [slot];
    if (host.controlled?.(slot)) {
      for (let i = turnPtr + 1; i < order.length && host.controlled(order[i]); i++) {
        spanSlots.push(order[i]);
      }
    }

    for (const s of spanSlots) {
      const r = openSlot(s);
      if (r === 'over') return 'over';
      if (r === 'hold') {
        // An AI unit standing there dazed keeps the floor alone. Only ever a
        // span of one: 'hold' comes from uncontrolled slots, and uncontrolled
        // slots never share.
        held = [s];
        return 'taken';
      }
      if (r === 'ready') held.push(s);
    }
    if (!held.length) { advancePastSpan(); return 'again'; }
    host.take(held[0], [...held]);
    return 'taken';
  }

  // Open turns until one is actually taken (or the fight ends). Returns
  // 'taken' | 'over' | 'stalled'.
  function begin() {
    const bound = STALL_LAPS * Math.max(1, order.length) + STALL_LAPS;
    for (let i = 0; i < bound; i++) {
      const r = step();
      if (r !== 'again') return r;
    }
    return 'stalled';
  }

  // A held slot may stop being steerable mid-turn without being finished: it
  // fell to a dot or an off-turn hit, or `replace` swapped it out of the
  // order. Steering flows past it rather than resurrecting its turn.
  const steerable = (s) => !done.has(s) && host.alive(s) && order.includes(s);

  // Retire one held slot's turn. Steering passes to the next held slot still
  // standing; when none remain the span's turn is over and the next one
  // opens. Returns 'taken' | 'over' | 'stalled', like begin() - or null for a
  // slot that was not holding an open turn to give up.
  function finish(slot) {
    if (!held.includes(slot) || done.has(slot)) return null;
    done.add(slot);
    host.beforeAdvance?.(); // this member's turn is given up, whoever else still holds
    const next = held.find(steerable);
    if (next) {
      steerIdx = held.indexOf(next);
      host.steer?.(next, [...held]);
      return 'taken';
    }
    advancePastSpan();
    return begin();
  }

  return {
    // The live order and pointer, for the initiative strip and the debug
    // surface. The array is the engine's own - read it, don't splice it.
    get order() { return order; },
    // Where the floor is: the STEERED slot's own position while a span is
    // open, so the strip's marker follows the member being driven rather than
    // sitting at the span's start.
    get index() {
      const cur = held[steerIdx];
      const i = cur ? order.indexOf(cur) : -1;
      return i >= 0 ? i : turnPtr;
    },
    get current() { return held[steerIdx] || order[turnPtr] || null; },
    // The span's floor-holders, and who among them is already done - the
    // strip brackets the first and ticks the second.
    get held() { return [...held]; },
    isDone(slot) { return done.has(slot); },

    begin,

    // Give up the CURRENT slot's turn. Under a span that retires one member
    // and steers the next; with the whole span done (or none open) it opens
    // the next turn - which for a span of one is exactly the advance this
    // method always was.
    advance() {
      const cur = held[steerIdx];
      if (cur) return finish(cur);
      host.beforeAdvance?.();
      advancePastSpan();
      return begin();
    },

    finish,

    // Point the floor at another held slot. Refuses one that is not holding
    // the floor, already finished, or no longer standing - steering never
    // resurrects a turn.
    steer(slot) {
      if (!held.includes(slot) || !steerable(slot)) return false;
      steerIdx = held.indexOf(slot);
      host.steer?.(slot, [...held]);
      return true;
    },

    // Splice a fresh combatant (a pulled-in bystander, a summon) in by its own
    // roll, keeping whoever is acting current: an insertion at or before the
    // pointer carries the pointer with it, so the unit mid-turn does not
    // silently hand the floor to the new arrival. One that lands INSIDE an
    // open span does not join it (INITIATIVE_PLAN #7): the span's membership
    // froze when it opened, so the joiner is not in `held`, and the span-end
    // walk is by identity - the pointer steps past the joiner to the slot
    // after the span, and the joiner acts when the order comes around again.
    insert(slot) {
      slot.init = rollInitiative(slot.initMod, rng);
      const idx = insertionIndex(order, slot.init);
      order.splice(idx, 0, slot);
      if (idx <= turnPtr) turnPtr += 1;
      return slot;
    },

    // Swap a slot for a different one IN PLACE, keeping its initiative roll and
    // its position in the round. This is what changing SIDES needs, and it is
    // deliberately not remove-then-insert: `insert` rerolls initiative, so a
    // body that changed hands would also change when it acts, and the round
    // would visibly stutter around it. Here the same body keeps the same
    // moment - only whose it is changes.
    //
    // No pointer arithmetic, because the index does not move. That is the whole
    // reason this is the right primitive: removal has to reason about whether
    // the hole was before, at, or after the pointer, and every one of those
    // cases is a way to silently skip or repeat somebody's turn.
    //
    // A slot the open span is holding is NOT swapped into the span's own
    // books - membership froze when the span opened (INITIATIVE_PLAN #8), and
    // a body that changed sides mid-span has no claim on its floor time.
    // `steerable` notices the old ref is gone from the order and steering
    // flows past it.
    replace(match, next) {
      const i = order.findIndex(match);
      if (i < 0) return null;
      next.init = order[i].init; // the same moment in the round, new owner
      const old = order[i];
      order[i] = next;
      // The open span tracks by identity, and `old` no longer HAS one in the
      // order - `indexOf` would answer -1. When the swapped slot was the
      // span's last, that -1 dropped the span's high-water mark to some
      // earlier slot and `advancePastSpan` parked the pointer right back on
      // this index: the new owner took a turn in the same round it arrived,
      // inheriting the floor time its predecessor had already spent. The new
      // slot holds the same array position, so it is the honest stand-in for
      // what the span covered. Only `spanSlots` - the pointer's book - is
      // rewritten: `held`, `done` and steering are membership, which froze
      // when the span opened (INITIATIVE_PLAN #8), and a body that arrived
      // mid-span has no claim on the floor.
      const at = spanSlots.indexOf(old);
      if (at >= 0) spanSlots[at] = next;
      return next;
    },

    // An AMBUSH: `match` names the slot that caught everyone cold, and it leads
    // off. Moving it to the FRONT is the point - jumping the pointer to its
    // existing position instead would silently cost every slot ahead of it its
    // whole first round, since the pointer only ever walks forward and the
    // round only resets after the pass completes. Its roll is raised above the
    // field rather than left where it landed, so the array stays sorted by
    // init - which is what `insert` assumes when a joiner arrives later.
    lead(match) {
      const i = order.findIndex(match);
      if (i >= 0) {
        const [slot] = order.splice(i, 1);
        slot.init = Math.max(slot.init, ...order.map((e) => e.init)) + 1;
        order.unshift(slot);
      }
      turnPtr = 0;
      spanSlots = []; held = []; done = new Set(); steerIdx = 0;
      return i >= 0;
    },
  };
}
