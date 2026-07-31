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

// ...and some verbs point at BOTH halves. A purge does not care whose statuses
// it is clearing - Reboot power-cycles a colleague, a coworker or you - so
// "which side does this aim at" stopped being a boolean. `aimsAtAlly` still
// answers "may this be pointed at a friend", `isFriendly` still answers "is
// this ONLY for friends", and the two differ exactly here: an any-target verb
// is offered on both sides and refused by neither.
export const aimsAtAnyone = (a) => !!a && !!a.purge && a.type !== 'buff';

// The purge verb itself (IT Support's primary). Its own type rather than an
// attack carrying a flag, because it is not a swing: it rolls to hit, deals
// nothing, and strips state from whoever it lands on - and a class whose
// identity is "the only one who can take a status OFF anybody" needs a verb to
// name. Keeping it typed `attack` also meant it competed to BE the class's
// basic swing (stats.actionBuckets), which IT does not have - it carries a
// letter opener for that.
export const isPurge = (a) => !!a && a.type === 'purge';

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

// --- toppling (POWERS_PLAN M6) -----------------------------------------------

export const isToppleable = (def) => !!def?.topple;

// Where a prop at (px, pz) lands when knocked over by somebody at (ax, az):
// the tile directly OPPOSITE the attacker. Returns null when the two are on
// the same tile (nothing to push away from).
//
// Direction is derived rather than aimed on purpose: it makes lining up the
// bookcase and the target the skill, and it needs no second targeting mode for
// one verb. It is also why toppling composes with the shove instead of
// competing with it - both push away from you.
export function toppleLanding(ax, az, px, pz) {
  const dx = Math.sign(px - ax);
  const dz = Math.sign(pz - az);
  if (!dx && !dz) return null;
  return [px + dx, pz + dz];
}

// --- destructible props & Pull Over (TACTICS_PLAN M8) ------------------------

// Can this prop be broken down by attacks? `hp` is the cover-grade marker
// (data/tiles.js): only the props whose job is to be hidden behind carry one.
export const isBreakable = (def) => Number.isFinite(def?.hp);

// Does this action aim at PROPS as well as bodies? The target-class gap
// TODO.md names: `isFriendly` says "only friends", `aimsAtAlly` says "may
// point at a friend", and this says "may point at the furniture" - a plain
// damage-rolling attack can break a barrier down, while controls, purges and
// everything payload-shaped still wants a body. Shove keeps its own prop path
// (the topple) and deliberately stays out of this predicate.
export const aimsAtProps = (a) =>
  !!a && a.type === 'attack' && Number.isFinite(a.min) && Number.isFinite(a.max);

export const isPull = (a) => !!a && a.type === 'pull';

// Where a pulled body lands: the free tile beside the PULLER on the FAR side
// from where the target was dug in - "the enemy ends up on the far side of the
// attacker from where they were tucked in at" (designer, 2026-07-31).
// Orthogonal neighbours only (the haul ends square on your side, not slung
// around a corner), never the puller's own tile and never the tile the target
// already holds.
//
// Two things were wrong with taking the NEAREST spot instead. The small one is
// feel: a haul that ends one tile from the barrier reads as a nudge, and the
// enemy is still in cover's shadow. The large one is that "beside the puller"
// was measured in tiles alone, so the nearest spot was routinely the one
// ACROSS the very partition the pull is supposed to cross - the target got
// dragged one tile sideways on their own side, having never come over.
// `stepOpen(fromX, fromZ, toX, toZ)` closes that: a landing you could not step
// to from where you stand is not on your side of anything.
//
// `open(x, z)` is the caller's walkable-and-unoccupied test; null when your
// side has no room, which is a refusal, not a fallback.
export function pullLanding(ax, az, tx, tz, open, stepOpen = () => true) {
  const spots = [[ax + 1, az], [ax - 1, az], [ax, az + 1], [ax, az - 1]]
    .sort((p, q) => Math.hypot(q[0] - tx, q[1] - tz) - Math.hypot(p[0] - tx, p[1] - tz));
  for (const [x, z] of spots) {
    if (x === tx && z === tz) continue;
    if (!stepOpen(ax, az, x, z)) continue;
    if (open(x, z)) return [x, z];
  }
  return null;
}

// --- stance (POWERS_PLAN M5) -------------------------------------------------

export const isStance = (a) => !!a && a.type === 'stance';
// How far an overwatch watches, in tiles.
export const watchRadiusOf = (a) => a.radius ?? 3;

// Would a watcher fire on this mover? The rule, with no scene in it.
//
// Overwatch is NOT an opportunity attack, and the difference is the whole
// verb: an opportunity attack punishes LEAVING your reach, overwatch punishes
// ENTERING the ground you are covering. So this asks about where the mover
// ended up, not about the leg they walked.
//
// The caller supplies `hasReaction` and `los` - the reaction budget and the
// sightline both live in combat - and this owns the geometry and the sides.
export function watchTriggers(a, t = {}) {
  const { dist = 0, los = true, hasReaction = true, sameSide = false, moverStanding = true } = t;
  if (!hasReaction || !moverStanding || sameSide) return false;
  if (dist > watchRadiusOf(a)) return false;
  return los;
}

// --- mobility (POWERS_PLAN M4) -----------------------------------------------

export const isMobility = (a) => !!a && a.type === 'mobility';

// How far a dash carries, in tile-lengths along the smoothed route. This is a
// DISTANCE, not an AP budget: the whole point of the verb is to reposition in
// a way the AP economy cannot buy, so pricing it in AP would make it a
// discount on walking rather than a different thing from walking.
export const dashDistanceOf = (a) => a.distance ?? 4;
// How far a swap reaches, in tiles.
export const mobilityRangeOf = (a) => a.range ?? 5;

// Which mobility modes point at a TEAMMATE rather than at the ground.
//
// One entry, and it is meant to stay short. This held a second mode, 'pull'
// ("draw an ally to an adjacent free tile"), promised by POWERS_PLAN decision
// 7 and never built - no action ever declared it. That is worse than dead
// data, because combat does not dispatch a mobility action on its `mode` at
// all: the CLICK decides (ground -> performDash, teammate -> performSwap). So
// a `mode: 'pull'` action would have passed every check here, been offered on
// allies, and then silently performed a SWAP - implemented-looking behaviour
// that was somebody else's verb. If an ally-pull is ever wanted, it needs a
// dispatch branch before it needs a name here.
//
// The name is also spoken for now: `type: 'pull'` is Pull Over (TACTICS_PLAN
// M8), which hauls an ENEMY over their cover - the opposite half of the board.
const ALLY_MODES = new Set(['swap']);

// Does this action aim at an ally? The one predicate every targeting decision
// asks - arming, the rings, the cursor, the click. A buff always does; a
// mobility action does when its mode moves somebody else. Keeping this
// separate from isFriendly (which means "is a buff") is what lets the two
// verbs share the friendly click path without sharing their payloads.
export const aimsAtAlly = (a) =>
  isFriendly(a) || aimsAtAnyone(a) || (isMobility(a) && ALLY_MODES.has(a.mode));

// Why this mobility action cannot be used right now, or null.
//
// `dist`/`los` describe the AIM: the ground for a dash, the teammate for a
// swap. A dash checks neither - where you may end up is a pathing question,
// and pathing needs the world.
export function mobilityProblem(a, t = {}) {
  const { dist = 0, los = true, ap = 0, usesLeft = null, allyHp = 1 } = t;
  if (ap < a.ap) return 'Not enough AP.';
  if (usesLeft !== null && usesLeft <= 0) return `No ${(a.label || 'uses').toLowerCase()} left this fight.`;
  if (!ALLY_MODES.has(a.mode)) return null;
  if (allyHp <= 0) return 'They are down - you cannot trade places with that.';
  if (dist > mobilityRangeOf(a)) return 'Too far - move closer.';
  if (!los) return 'No clear line to them.';
  return null;
}

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

// --- cones (POWERS_PLAN) -----------------------------------------------------

// The wedge a cone attack covers, aimed from `origin` toward (tx, tz), or null
// when there is no meaningful aim (the cursor is on top of the caster).
//
// Pure, and taking the origin as an argument, because BOTH sides of the game
// need it: combat draws and fires the wedge, and out of combat the same wedge
// has to be previewable before a fight exists. It used to be a closure over
// combat's `active`, which is why aiming a cone outside a fight drew nothing at
// all - the geometry was simply unreachable from there.
//
// The returned function is the tile/body test, carrying `origin` and `angle`
// so a caller can draw what it is about to resolve.
export function coneFrom(a, origin, tx, tz) {
  let dx = tx - origin.x;
  let dz = tz - origin.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.2) return null;
  dx /= len;
  dz /= len;
  const half = (a.cone.halfAngle * Math.PI) / 180;
  // `r` is the target's radius. A point test (r = 0) is right for carpeting
  // floor tiles but WRONG for bodies: it demanded the wedge swallow a target's
  // centre, so the ring only went green once the cone visibly covered the whole
  // marker. Passing the ring's radius widens the wedge by the angle the body
  // subtends, so the cone catches anything it clips.
  const test = (wx, wz, r = 0) => {
    const vx = wx - origin.x;
    const vz = wz - origin.z;
    const d = Math.hypot(vx, vz);
    if (d < 0.3 || d - r > a.cone.range) return false;
    const slack = r > 0 ? Math.asin(Math.min(1, r / Math.max(d, 1e-6))) : 0;
    return (vx * dx + vz * dz) / d >= Math.cos(Math.min(Math.PI, half + slack));
  };
  test.origin = origin;
  test.angle = Math.atan2(dz, dx);
  return test;
}

// The wedge's outline as [[x, z], ...] - the two edges and the arc between
// them, starting and ending at the origin. Shared so the in-combat preview and
// the out-of-combat one cannot draw different shapes for the same action.
export function conePolyline(a, test, segments = 14) {
  const half = (a.cone.halfAngle * Math.PI) / 180;
  const arc = [];
  for (let i = 0; i <= segments; i++) {
    const ang = test.angle - half + (2 * half * i) / segments;
    arc.push([
      test.origin.x + Math.cos(ang) * a.cone.range,
      test.origin.z + Math.sin(ang) * a.cone.range,
    ]);
  }
  const o = [test.origin.x, test.origin.z];
  return [o, ...arc, o];
}

// --- aiming (TACTICS_PLAN M7) --------------------------------------------------

// How far the armed verb can be AIMED, for the ground paint - the DOS2-style
// read of "this is the floor your shot owns right now". Returns { r, euclid }
// or null for verbs with no aim range to paint: melee and touch verbs walk you
// in (the reach ring is their affordance), a dash previews its own trail.
//
// Each branch reads the SAME *Of helper its problem-function reads, so the
// painted area and the refusal can never disagree about a default: a swap
// painted to mobilityRangeOf is exactly the swap mobilityProblem allows.
export function aimRangeOf(a) {
  if (!a) return null;
  if (a.cone) return { r: a.cone.range };
  if (isZone(a)) return { r: zoneRangeOf(a) };
  if (isMobility(a)) return a.mode === 'dash' ? null : { r: mobilityRangeOf(a) };
  if (aimsAtAlly(a)) return { r: buffRangeOf(a) };
  if (isControl(a)) return controlIsRanged(a) ? { r: a.range } : null;
  return a.range ? { r: a.range } : null;
}

// The tiles that aim can legally land on right now, as [x, z] pairs: within
// `range` of the aimer's BODY (a continuous point - the wash must agree with
// gates that measure from where the model actually stands) and passing
// `canSee(x, z)`. ONE distance rule since DEGRID D4: every targeted range is
// a true-distance circle, so the `euclid` flag is gone with the cheb branch
// it selected.
export function rangeTiles(cx, cz, range, canSee) {
  const out = [];
  const lim = Math.ceil(range) + 1;
  const bx = Math.round(cx);
  const bz = Math.round(cz);
  for (let z = bz - lim; z <= bz + lim; z++) {
    for (let x = bx - lim; x <= bx + lim; x++) {
      if (Math.hypot(x - cx, z - cz) > range + 1e-9) continue;
      if (!canSee(x, z)) continue;
      out.push([x, z]);
    }
  }
  return out;
}
