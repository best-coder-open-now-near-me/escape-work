// Combat turn order. Pure logic - no PlayCanvas, no DOM.
//
// Proper per-unit initiative (BG3 / Divinity style): every combatant - party
// members, player-team summons, enemies - rolls d20 + a speed modifier once at
// combat start, and acts in that fixed descending order for the whole fight.
// There is no side-phase; a member's turn and an enemy's turn interleave by
// roll.
//
// The modifier is a unit's SPEED: for a party member it is their `hustle`
// attribute (the point-investable stat that also drives AP - invest in hustle
// and you act earlier AND do more per turn, coherently); for an enemy it is
// their `ap` budget (enemies have no attributes, and AP is their quickness).
// combat.js reads the right source and passes it in as `initMod`. The d20
// dominates the small (~3..8) modifier, so order is mostly luck with a
// deliberate speed lean - the d20 + modifier shape it echoes. A missing
// modifier is treated as +0.
//
// An entry is opaque: whatever refs the caller threads through (a party
// member, an actor) ride along untouched. Only `team` ('player' | 'enemy') and
// `initMod` are read; `init` (the rolled total) is written.

export const INIT_DIE = 20;

// Roll d20 + modifier. `rng` returns a float in [0, 1).
export function rollInitiative(initMod, rng) {
  return 1 + Math.floor(rng() * INIT_DIE) + (initMod || 0);
}

// Roll every entry and return a NEW array in turn order: highest init first,
// ties to the player side (your side wins a coin-flip tie), then a random
// shuffle so same-team ties aren't input-order-biased. Each returned entry is
// the same object reference with `.init` set, so callers keep their refs.
export function buildInitiativeOrder(entries, rng) {
  for (const e of entries) e.init = rollInitiative(e.initMod, rng);
  const teamRank = (e) => (e.team === 'player' ? 0 : 1);
  // The same-team tiebreak is a SHUFFLE KEY drawn once per entry, not a coin
  // flipped inside the comparator. `rng() - 0.5` as a comparator is not a
  // consistent ordering - it answers differently every time the sort asks about
  // the same pair - so the result depended on the sort's internal pivot walk
  // rather than on chance, which is the opposite of the input-order fairness it
  // was written for. One draw per entry, compared like any other field, is an
  // honest shuffle and a valid comparator.
  const shuffleKey = new Map(entries.map((e) => [e, rng()]));
  return [...entries].sort((a, b) =>
    b.init - a.init
    || teamRank(a) - teamRank(b)
    || shuffleKey.get(a) - shuffleKey.get(b));
}

// Where a mid-fight joiner (a pulled-in bystander, a fresh summon) slots into
// an existing order: by its rolled init, after any equal-init entry already
// present (so it doesn't jump the current unit on a tie). Returns the index to
// splice at.
export function insertionIndex(order, init) {
  let i = 0;
  while (i < order.length && order[i].init >= init) i += 1;
  return i;
}
