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
//   take(slot)           hand it the turn - the host wires up control
//   roundStart()         a full pass completed: age cooldowns, refill reactions
//   turnStart()          optional, fires before every attempt including skips
//   afterTick(slot)      optional, fires after its statuses tick
//   beforeAdvance()      optional, fires when a turn is given up
export function createTurnOrder({ entries, rng = Math.random, host }) {
  let order = buildInitiativeOrder(entries, rng);
  let turnPtr = 0;

  // Move the pointer on, wrapping into a fresh round at the end of the pass.
  function toNext() {
    turnPtr += 1;
    if (turnPtr < order.length) return;
    turnPtr = 0;
    host.roundStart();
  }

  // One attempt at opening a turn. Returns 'taken' (somebody has the floor),
  // 'again' (this slot could not act - the pointer has already moved), or
  // 'over' (the fight ended on this boundary).
  function step() {
    host.turnStart?.();
    const done = host.outcome();
    if (done === 'win') { host.win(); return 'over'; }
    if (done === 'lose') { host.lose(); return 'over'; }

    const slot = order[turnPtr];
    if (!slot) { toNext(); return 'again'; }
    if (!host.alive(slot)) { toNext(); return 'again'; } // a corpse or a downed slot

    // A temp serves a fixed number of ITS OWN turns; the contract lapses at the
    // top of the one it can no longer pay for.
    const left = host.lifetimeLeft(slot);
    if (left != null) {
      if (left <= 0) {
        host.expire(slot);
        toNext();
        return 'again';
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
      // member does. Settle that BEFORE the pointer moves: a wrap here would
      // open a fresh round (aging the fire, refilling reactions, calling the
      // host's round hook) on a fight that is already over.
      const now = host.outcome();
      if (now === 'win') { host.win(); return 'over'; }
      if (now === 'lose') { host.lose(); return 'over'; }
      toNext();
      return 'again';
    }
    if (skipped) {
      if (host.skip(slot) === 'hold') return 'taken';
      toNext();
      return 'again';
    }
    host.take(slot);
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

  return {
    // The live order and pointer, for the initiative strip and the debug
    // surface. The array is the engine's own - read it, don't splice it.
    get order() { return order; },
    get index() { return turnPtr; },
    get current() { return order[turnPtr] || null; },

    begin,

    // Give up the current turn and open the next one.
    advance() {
      host.beforeAdvance?.();
      toNext();
      return begin();
    },

    // Splice a fresh combatant (a pulled-in bystander, a summon) in by its own
    // roll, keeping whoever is acting current: an insertion at or before the
    // pointer carries the pointer with it, so the unit mid-turn does not
    // silently hand the floor to the new arrival.
    insert(slot) {
      slot.init = rollInitiative(slot.initMod, rng);
      const idx = insertionIndex(order, slot.init);
      order.splice(idx, 0, slot);
      if (idx <= turnPtr) turnPtr += 1;
      return slot;
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
      return i >= 0;
    },
  };
}
