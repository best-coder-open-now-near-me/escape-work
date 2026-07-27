// The verb rules that do not need the world (POWERS_PLAN.md) - pure logic, no
// PlayCanvas, no DOM. combat.js owns bodies, panels, FX and the AP ledger;
// this module owns the questions a rule can answer with numbers, so they can
// be unit tested with plain objects (the turn-order.js split, applied to the
// action verbs).
//
// The engine's action `type` vocabulary was, for a long time, five verbs -
// attack / defend / heal / shove / summon - and every class was therefore
// assembled from the same three of them. Six playable classes read as one
// character with six vocabularies (POWERS_PLAN "Where we are today"). The new
// verbs land here first: a verb whose rules live in combat.js's 2,000-line
// closure is a verb nothing can test.

// --- buff (POWERS_PLAN M1) ---------------------------------------------------

// How far a friendly action reaches, in tiles (Chebyshev - the same metric the
// throw range uses). A `range` on the action overrides it.
export const BUFF_RANGE = 5;
export const buffRangeOf = (a) => a.range ?? BUFF_RANGE;

// Does this buff actually DO anything to a target in this state? A buff that
// lands with no effect still spends the AP and a use, so the refusal has to
// come before the commit - and it has to name which of the three payloads
// (heal / cleanse / status) came up empty, because "nothing happened" on a
// rationed 2-AP action reads as a bug.
//
// `a` is the action def; `t` is the target's state as plain numbers:
//   { hp, maxHp, statusCount }
function emptyPayload(a, t) {
  const heals = a.amount > 0 && t.hp < t.maxHp;
  const cleanses = a.purge && t.statusCount > 0;
  const applies = !!a.applies;
  if (heals || cleanses || applies) return null;
  if (a.purge && !a.amount) return 'Nothing to clear - they are running clean.';
  if (a.amount && !a.purge) return 'Already at full health. Savor it.';
  return 'That would do nothing for them.';
}

// Why this ally cannot take the buff right now, or null when they can.
//
// Deliberately takes primitives rather than actors: `dist` is already measured
// (Chebyshev tiles), `los` already traced. combat.js knows how to ask the
// world those two questions; the RULE about what they mean belongs here, where
// a test can drive every branch without a scene.
export function buffProblem(a, t = {}) {
  const { dist = 0, los = true, hp = 0, maxHp = 0, statusCount = 0, ap = 0, usesLeft = null } = t;
  if (ap < a.ap) return 'Not enough AP.';
  if (usesLeft !== null && usesLeft <= 0) return `No ${(a.label || 'uses').toLowerCase()} left this fight.`;
  // The downed are a REVIVE problem, not a buff problem. Commending someone
  // who is face down on the carpet is the kind of thing this game would say,
  // but the status would tick away on a body that cannot use it.
  if (hp <= 0) return 'They are down - a buff will not pick them up.';
  if (dist > buffRangeOf(a)) return 'Too far - move closer.';
  if (!los) return 'No clear line to them.';
  return emptyPayload(a, { hp, maxHp, statusCount });
}

// What a buff DOES, given a target's state. Returns the plan; the caller
// mutates. Splitting the arithmetic out is what lets the "did anything
// happen?" question above and the commit below agree by construction.
export function buffOutcome(a, t = {}) {
  const { hp = 0, maxHp = 0 } = t;
  const healed = a.amount ? Math.min(maxHp, hp + a.amount) - hp : 0;
  return { healed, purges: !!a.purge, applies: a.applies || null };
}

// Is this action aimed at a FRIEND? One predicate, so the arming path, the
// ring preview, the cursor and the click cannot disagree about which half of
// the board a verb points at - the drift that made the crosshair promise a
// swing the click refused (ARCHITECTURE, hover.js note).
export const isFriendly = (a) => !!a && a.type === 'buff';

// --- control (POWERS_PLAN M2) ------------------------------------------------

// A control action carries no damage roll, so it needs its own reach rule. It
// is a REACH action (arm's length, like a shove) unless it declares a `range`,
// which makes it a thrown one - Detain is something you do to somebody you can
// touch; All Hands is something you send.
export const controlIsRanged = (a) => a.range != null || !!a.cone;

// Why this control cannot be thrown at that target right now, or null.
//
// Note what is NOT here: the hit roll. Control rolls to hit like any attack
// (POWERS_PLAN #4 - a guaranteed stun at 2 AP is the degenerate case), and
// that roll belongs to combat's `resolveHit` against its injectable rng. This
// answers only the questions that are true before any dice.
export function controlProblem(a, t = {}) {
  const { dist = 0, los = true, inReach = true, ap = 0, usesLeft = null, alive = true } = t;
  if (ap < a.ap) return 'Not enough AP.';
  if (usesLeft !== null && usesLeft <= 0) return `No ${(a.label || 'uses').toLowerCase()} left this fight.`;
  if (!alive) return 'They are already down.';
  if (controlIsRanged(a)) {
    if (a.range != null && dist > a.range) return 'Too far.';
    if (!los) return 'No clear line to them.';
  } else if (!inReach) {
    // Melee control walks you in, exactly as a melee swing does - the refusal
    // is the caller's to skip. Returning a problem here would make Detain the
    // one arm's-length action in the game that refuses instead of approaching.
    return null;
  }
  return null;
}

// Everything a landed control does, as a plan. Kept beside buffOutcome so the
// two verbs' payload shapes stay legible against each other.
export function controlOutcome(a) {
  return { applies: a.applies || null, displace: a.displace || 0 };
}

// Is this action a control? Used by the same one-predicate rule as isFriendly.
export const isControl = (a) => !!a && a.type === 'control';

// --- zone (POWERS_PLAN M3) ---------------------------------------------------

export const isZone = (a) => !!a && a.type === 'zone';
export const zoneRangeOf = (a) => a.range ?? 5;
export const zoneRadiusOf = (a) => a.radius ?? 1;

// The tiles a zone covers, as [x, z] pairs. A DISC measured on tile centres,
// not the square the loop bounds suggest: a square blast would carpet the
// diagonal corners a player can plainly see are further away than the tiles
// the ring excludes, and the preview draws this exact list.
export function zoneTiles(cx, cz, radius) {
  const out = [];
  const r = Math.max(0, radius);
  const lim = Math.ceil(r);
  for (let z = cz - lim; z <= cz + lim; z++) {
    for (let x = cx - lim; x <= cx + lim; x++) {
      if (Math.hypot(x - cx, z - cz) <= r + 1e-9) out.push([x, z]);
    }
  }
  return out;
}

// Why this zone cannot be placed there, or null. Placement legality per TILE
// (is it plain floor? is somebody standing on it?) stays with the caller -
// that needs the grid - but the spend rules and the aim rules live here.
export function zoneProblem(a, t = {}) {
  const { dist = 0, los = true, ap = 0, usesLeft = null } = t;
  if (ap < a.ap) return 'Not enough AP.';
  if (usesLeft !== null && usesLeft <= 0) return `No ${(a.label || 'uses').toLowerCase()} left this fight.`;
  if (dist > zoneRangeOf(a)) return 'Too far to reach with it.';
  if (!los) return 'No clear line to there.';
  return null;
}
