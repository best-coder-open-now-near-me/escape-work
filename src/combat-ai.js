// What an AI unit DECIDES - pure logic, no PlayCanvas, no DOM, no closure.
// Who to fight, where to stand, and which beat to take this turn. combat.js
// keeps the doing: the bodies, the AP ledger, the FX, the log lines.
//
// The beat priority is the reason this module is worth its own file. It was
// written as a ladder of `if` arms inside the per-frame driver, each arm
// deciding AND executing in the same breath - so "does a boxed-in unit crouch
// or burn its turn?" could only be answered by watching a fight. `chooseBeat`
// is that ladder with the executing taken out: it returns the NAME of the beat
// and what the beat needs, and combat.js does it.
//
// The world arrives as small query callbacks, as everywhere else in the carve.

import { posOf, reachOfUnit } from './combat-geometry.js';
import {
  cheb, inReach, dist, shieldedFaces, facesShieldFrom, isFlanked, isBackstab, provokedBy,
} from './tactics.js';
import { shieldsCell } from './data/tiles.js';
import { NEIGHBOR_DIRS } from './directions.js';

// The AI's tunables, one block (AI_PLAN A7): every magnitude a difficulty
// pass - or someday a selector - would turn lives here, beside the rules
// that read it. Numbers are first drafts, deferred to playtest like every
// constants block before it.
export const AI = {
  // --- target scoring (AI_PLAN M2) ---
  FOCUS_DEFAULT: 0.5, // a def without `focus`: half-disciplined
  W_NEAR: 1.0, // proximity term
  W_KILL: 2.0, // kill-securability term (scaled by focus)
  W_FRAIL: 1.0, // fragility term (scaled by focus)
  STICKINESS: 0.25, // bonus to the CURRENT target - anti-flip-flop hysteresis
  // --- destination scoring (AI_PLAN M3) ---
  W_PATH: 1.0, // per tile-unit of route cost - the baseline everything trades against
  FLANK_VALUE: 1.5, // arriving in a pincer position
  BACKSTAB_VALUE: 1.0, // arriving in the target's rear arc
  OA_COST: 2.0, // per opportunity attack the route would eat
  HAZARD_COST: 1.5, // per damaging surface tile entered
  SLIP_COST: 1.0, // per unit of slip chance crossed (expected turn loss)
  // --- the ranged kit (AI_PLAN M5) ---
  KEEP_AWAY: 2.5, // a shooter wants at least this distance from the nearest threat
  CROWD_COST: 0.75, // per tile-unit the firing tile sits inside KEEP_AWAY
  SHIELD_VALUE: 1.0, // a firing tile with a shieldable face toward the target (entrench potential)
  RANGE_SLACK: 0.5, // stand this far inside max range, so drift can't break the shot
  // --- attack lines and support (AI_PLAN M6) ---
  STATUS_WEIGHT: 2, // an `applies` line the target doesn't wear is this much likelier
  HEAL_AT: 0.5, // heal an ally under this HP fraction
};

// Score ties are decided by the tie-break chain, not float luck.
const EPS = 1e-9;

// The attack-line weights (AI_PLAN M6): a line whose status the target is
// not already wearing is worth more - the guard blinds the shooter on
// purpose, sometimes - at a MILD weight, so statuses season the picks
// rather than becoming a lock loop. `wearing(id)` is the caller's status
// test. The draw itself stays the caller's (it is resolution, so it rolls
// through the fight's seeded rng); this is only the shape of the die.
export function lineWeights(pool, wearing) {
  return pool.map((a) => (a.applies && !wearing(a.applies) ? AI.STATUS_WEIGHT : 1));
}

// Who a support unit patches this turn (AI_PLAN M6): the worst-off ally
// under the heal threshold, within the descriptor's range - self included,
// mirroring the player's triage ("hr heal is for anyone", POWERS_PLAN 19).
// `canSupport` lets combat provide the player's exact continuous distance and
// line-of-sight gate; the tile-distance fallback keeps this pure rule callable
// with plain test fixtures. Allies arrive as { x, z, hp, maxHp, expiring, ref };
// a temp about to despawn is skipped (healing a body that vanishes next round
// reads as AI stupidity, not mercy).
export function aiSupportPlan(bx, bz, spec, allies, { healAt = AI.HEAL_AT, canSupport = null } = {}) {
  if (!spec) return null;
  let best = null;
  for (const a of allies) {
    if (a.expiring) continue;
    if (!(a.maxHp > 0)) continue;
    const frac = a.hp / a.maxHp;
    if (frac >= healAt) continue;
    if (canSupport ? !canSupport(a) : dist(bx, bz, a.x, a.z) > (spec.range ?? Infinity)) continue;
    if (!best || frac < best.frac) best = { ally: a, frac };
  }
  return best;
}

// The route to a tile the unit could stand on and swing from: the shortest path
// to any of the target's eight neighbours, or null if none is reachable. Shared
// by pickTarget and the advance so the two can never disagree about who is
// engageable - if the target picker says yes, the mover must find a route.
//
// The degenerate self-path is load-bearing, not a shortcut. Already STANDING on
// a tile this unit could swing from means the cheapest route is no route.
// `findEnemyPath` cannot express that - it rejects a goal failing `isWalkable`,
// and the unit's own tile fails it because the unit is standing on it - so the
// self-path came back null, the search fell through to a DIFFERENT adjacent
// tile, and the unit walked there. Next turn the same logic walked it back.
// That is the pacing bug: a coworker adjacent but a shade out of reach
// shuffling between two tiles forever instead of ever attacking. Returning the
// degenerate path hands the advance its in-place shuffle branch, which closes
// the last sub-tile gap. The same special case `routeBeside` carries on the
// player side, for the same reason.
// `canSwingFrom(gx, gz)` is the caller's "would a swing from this tile actually
// land" test - the AI's half of `combat-geometry.swingPointAt`, which the player
// side has always asked. Optional only so the pure tests can drive the shape
// without a world; combat.js always supplies it.
//
// Without it these helpers accepted ANY walkable neighbour with a route, and
// `canEngage` is built on this - so the hard engageability TIER, which exists
// precisely so a unit never "walks to the wall and swings at nothing, every
// turn, forever", was decided by a test blind to that exact case. A member in a
// dead-end bay sealed by a partition read as engageable (REVIEW.md 2026-08-02
// section 1.16).
export function standTilePath(ux, uz, tx, tz, { isWalkable, findEnemyPath, canSwingFrom = null }) {
  const swingable = (gx, gz) => !canSwingFrom || canSwingFrom(gx, gz);
  let best = null;
  for (const [dx, dz] of NEIGHBOR_DIRS) {
    const gx = tx + dx;
    const gz = tz + dz;
    if (ux === gx && uz === gz) {
      if (swingable(gx, gz)) return [[gx, gz], [gx, gz]];
      continue; // standing beside them but unable to swing is not engagement
    }
    if (!isWalkable(gx, gz)) continue;
    if (!swingable(gx, gz)) continue;
    const p = findEnemyPath(ux, uz, gx, gz);
    if (p && p.length > 1 && (!best || p.length < best.length)) best = p;
  }
  return best;
}

// Every swing-stand route, not just the shortest (AI_PLAN M3): the
// destination score needs the whole field of candidates before it can trade
// path cost against a flanking arrival. Same contract as standTilePath
// otherwise - and the degenerate self-path keeps its ABSOLUTE priority:
// already standing on a swing tile is not a choice to score, it is the
// pacing bug's fix, so it returns alone, a field of one.
export function standTileRoutes(ux, uz, tx, tz, { isWalkable, findEnemyPath, canSwingFrom = null }) {
  const swingable = (gx, gz) => !canSwingFrom || canSwingFrom(gx, gz);
  for (const [dx, dz] of NEIGHBOR_DIRS) {
    if (ux === tx + dx && uz === tz + dz && swingable(ux, uz)) return [[[ux, uz], [ux, uz]]];
  }
  const out = [];
  for (const [dx, dz] of NEIGHBOR_DIRS) {
    const gx = tx + dx;
    const gz = tz + dz;
    if (!isWalkable(gx, gz)) continue;
    if (!swingable(gx, gz)) continue;
    const p = findEnemyPath(ux, uz, gx, gz);
    if (p && p.length > 1) out.push(p);
  }
  return out;
}

// The ranged kit's candidate destinations (AI_PLAN M5): tiles within the
// line's range of the target WITH a line of sight - the right question, where
// the melee field asks for swing tiles. Capped to the nearest few by cheb
// BEFORE routing, so the A* fan stays bounded by the same budget the melee
// fan pays (the engageMemo lesson: routing is the expensive half). The
// self-tile short-circuit mirrors the swing field's: already standing on a
// firing tile is the answer, not a candidate.
//
// SINGLE-STOREY, like every body-to-body rule in the game (AI_PLAN's
// multi-storey section): the scan, the range and the `hasLos` call all
// measure in the storey plane, which is exactly right while floors.js
// refuses actors above the ground storey. When bodies go vertical this is
// the first helper to hear about it - a balcony shooter needs 3D sight and
// storey-qualified tiles, and the gate belongs here rather than scattered
// across the callers.
export function firingTileRoutes(ux, uz, tx, tz, range,
  { isWalkable, findEnemyPath, hasLos, shotClearAt = null }, cap = 12) {
  const reach = range - AI.RANGE_SLACK;
  const R = Math.ceil(reach);
  const cands = [];
  let here = null;
  for (let dx = -R; dx <= R; dx++) {
    for (let dz = -R; dz <= R; dz++) {
      const gx = tx + dx;
      const gz = tz + dz;
      if (dist(gx, gz, tx, tz) > reach) continue;
      const own = gx === ux && gz === uz;
      if (!isWalkable(gx, gz) && !own) continue;
      if (!hasLos(gx, gz, tx, tz)) continue;
      // Range and a sightline are not the whole question: a shot can still be
      // refused by something the line test does not model - an object shield,
      // or a colleague standing in the redirect. A tile that cannot actually
      // FIRE is not a firing tile.
      const clear = !shotClearAt || shotClearAt(gx, gz);
      if (own) { here = clear; continue; }
      cands.push([gx, gz, cheb(ux, uz, gx, gz), clear]);
    }
  }
  // Standing where the shot works is the answer, not a candidate - the melee
  // field's self-path priority, and for the same anti-shuffle reason. But ONLY
  // when the shot works: this used to return the moment the unit's own tile had
  // range and a line, so a shooter whose shot was refused for any other reason
  // had no candidates at all, could not reposition, and burned every turn
  // standing still (REVIEW.md 2026-08-02 section 1.6).
  if (here === true) return [[[ux, uz], [ux, uz]]];
  // Never walk to a tile that cannot fire while one that can is on the table.
  const firing = cands.filter((c) => c[3]);
  const field = firing.length ? firing : cands;
  field.sort((a, b) => a[2] - b[2]);
  const out = [];
  for (const [gx, gz] of field.slice(0, cap)) {
    const p = findEnemyPath(ux, uz, gx, gz);
    if (p && p.length > 1) out.push(p);
  }
  return out;
}

// Which of those routes to actually walk (AI_PLAN M3). The old rule was
// "shortest"; the score keeps path cost as the baseline and trades it
// against what the ARRIVAL buys and what the WALK costs beyond AP:
//
//   + a pincer arrival (isFlanked with the roles reversed)
//   + an arrival in the target's rear arc (isBackstab)
//   - each opportunity attack the route would eat (provokedBy, leg by leg -
//     the same radius-crossing rule the walk will actually be charged by)
//   - each hazard tile entered, and slip chance crossed
//
// Positions are judged at the APPROACH POINT the mover will stand on, not
// the tile centre: dirOctant flips sectors near tile midlines, and a flank
// scored at the centre can evaporate at the real arrival spot.
//
// Weights, not vetoes - eating one free swing to reach the kill can be
// right, and the tuning block owns the exchange rates. Deterministic: ties
// fall to route order, which follows NEIGHBOR_DIRS' fixed order.
export function scoreDestination(routes, q = {}) {
  const {
    target, approach = null, allies = [], facing = null, threats = [],
    edgeOpen = null, surfDamageAt = null, slipChanceAt = null,
    shieldFaceAt = null, nearestThreatDist = null,
  } = q;
  let best = null;
  for (const r of routes) {
    let cost = 0;
    for (let k = 1; k < r.length; k++) {
      cost += dist(r[k - 1][0], r[k - 1][1], r[k][0], r[k][1]);
    }
    const [gx, gz] = r[r.length - 1];
    const [ax, az] = approach && target ? approach(gx, gz, target.x, target.z) : [gx, gz];
    const flanked = target ? isFlanked(ax, az, target.x, target.z, allies, edgeOpen) : false;
    const behind = target ? isBackstab(ax, az, target.x, target.z, facing) : false;
    let oas = 0;
    const provoked = new Set();
    for (let k = 1; k < r.length; k++) {
      for (const t of provokedBy(threats, r[k - 1][0], r[k - 1][1], r[k][0], r[k][1], edgeOpen)) {
        if (!provoked.has(t)) { provoked.add(t); oas += 1; }
      }
    }
    let hazard = 0;
    if (surfDamageAt || slipChanceAt) {
      const entered = new Set([`${Math.round(r[0][0])},${Math.round(r[0][1])}`]);
      for (let k = 1; k < r.length; k++) {
        const cx = Math.round(r[k][0]);
        const cz = Math.round(r[k][1]);
        const key = `${cx},${cz}`;
        if (entered.has(key)) continue;
        entered.add(key);
        if (surfDamageAt && surfDamageAt(cx, cz) > 0) hazard += AI.HAZARD_COST;
        if (slipChanceAt) hazard += AI.SLIP_COST * slipChanceAt(cx, cz);
      }
    }
    // The ranged kit's two extra terms (AI_PLAN M5): a destination whose tile
    // has a shieldable face toward the target is a future entrenchment, and
    // one inside KEEP_AWAY of a threat invites the melee response.
    const shielded = shieldFaceAt ? shieldFaceAt(gx, gz) : false;
    const crowded = nearestThreatDist
      ? Math.max(0, AI.KEEP_AWAY - nearestThreatDist(ax, az)) : 0;
    const score = -AI.W_PATH * cost
      + (flanked ? AI.FLANK_VALUE : 0)
      + (behind ? AI.BACKSTAB_VALUE : 0)
      - AI.OA_COST * oas
      - hazard
      + (shielded ? AI.SHIELD_VALUE : 0)
      - AI.CROWD_COST * crowded;
    if (!best || score > best.score + EPS) best = { route: r, score };
  }
  return best ? best.route : null;
}

// Which member to fight - ENGAGEABLE first, always. Once a partition blocks
// a swing (TACTICS_PLAN M3), the closest member by distance can be one the
// unit can neither reach nor walk to: on the far side of a cubicle wall with
// the way round sealed. Targeting them means walking to the wall and swinging
// at nothing, every turn, forever. So engageability stays a hard TIER - a
// member the unit can actually fight outranks any it cannot, whatever the
// scores say.
//
// Within a tier the choice is a score (AI_PLAN M2), not a distance:
//
//   near  - proximity, the old rule's whole opinion
//   kill  - can we actually FINISH them soon (fewest expected swings)
//   frail - how far someone already got with them
//
// `focus` (the def's discipline knob, 0..1) scales the two hunter terms, so
// a Manager at 0.2 mostly harasses whoever is closest while an Executive at
// 0.9 picks the kill and works it. STICKINESS is hysteresis: the current
// target keeps a small edge, so a scatterbrained flip-flop between two
// near-equal marks costs more than it wins. At focus 0 the formula IS the
// old rule - nearest, with the tie-break chain below giving the wounded the
// tie - which is what the old tests now pin by name.
//
// `candidates` is the living player side; `canEngage(m)` is the caller's
// (memoized) reach-or-route test; `expSwings(m)` is the caller's estimate of
// swings-to-down (combat owns the attack lines); `current` is the unit's
// standing mark, if any. Scores are deterministic - no rng anywhere in a
// choice - and full ties fall to candidate order, so a seeded fight replays.
export function pickTarget(ux, uz, candidates, canEngage, opts = {}) {
  const { focus = AI.FOCUS_DEFAULT, current = null, expSwings = null } = opts;
  let best = null;
  for (const m of candidates) {
    const engageable = canEngage(m);
    const near = 1 / (1 + cheb(ux, uz, m.actor.x, m.actor.z));
    const kill = expSwings ? 1 / Math.max(1, expSwings(m)) : 0;
    const frail = m.sheet.maxHp > 0 ? 1 - m.sheet.hp / m.sheet.maxHp : 0;
    const score = AI.W_NEAR * near
      + focus * (AI.W_KILL * kill + AI.W_FRAIL * frail)
      + (current && m === current ? AI.STICKINESS : 0);
    const better = !best
      || (engageable && !best.engageable)
      || (engageable === best.engageable
        && (score > best.score + EPS
          || (Math.abs(score - best.score) <= EPS && m.sheet.hp < best.m.sheet.hp)));
    if (better) best = { m, score, engageable };
  }
  return best ? { actor: best.m.actor, member: best.m } : null;
}

// Where the advance should actually walk, given the best stand-tile route.
// Returns the route to smooth, or null when there is nothing worth spending on.
//
// Two shapes. With a route, the last point is pulled in to reach of the
// target's BODY rather than the middle of the adjacent tile (the point stays
// inside that tile, so adjacency still holds). With no route, the unit may
// still be on the right tile and merely in the wrong PART of it: now that reach
// is a distance, one tile can hold both a spot inside reach and a spot outside
// it, so the last of the gap gets closed in place. Without that, an AI hemmed
// into the single adjacent tile of a corridor can never get in range, ends
// every turn having done nothing, and the fight never resolves.
//
// The in-place shuffle is refused unless it would actually earn a swing: a
// partition between the two bodies is not a distance problem, so closing the
// gap cannot solve it, and spending AP to end up equally unable to swing is the
// same stall wearing a different hat.
export function advanceRoute(unit, target, route, { approach, stepOpen, bodyClear }) {
  const pp = posOf(target);
  if (route) {
    const out = route.slice();
    const [gx, gz] = out[out.length - 1];
    const point = approach(gx, gz, pp.x, pp.z);
    if (!bodyClear(point[0], point[1], unit)) return null;
    out[out.length - 1] = point;
    return out;
  }
  const b = unit.actor || unit;
  const t = target.actor || target;
  if (cheb(b.x, b.z, t.x, t.z) > 1) return null;
  const here = posOf(unit);
  const step = approach(b.x, b.z, pp.x, pp.z);
  if (dist(here.x, here.z, step[0], step[1]) < 0.05) return null; // as close as this tile allows
  if (!bodyClear(step[0], step[1], unit)) return null;
  if (!inReach(step[0], step[1], pp.x, pp.z, reachOfUnit(unit), stepOpen)) return null;
  return [[here.x, here.z], step];
}

// The AI's turtle beat: with nobody in reach and nowhere useful to walk, a
// unit tucks in WHERE IT STANDS - if the faces of its own tile actually shield
// it from its target. Crouching with the desk behind you is worse than
// standing there looking available, so an unshielded angle means no crouch.
// Symmetric by decision #11; ratified for v1 (designer, 2026-07-30).
//
// It used to hunt for a shield CELL to commit to and fell back to the tile's
// partitions. There is no hunt now, because the crouch is a position: ask
// whether this position is covered from the target and take the beat or don't.
// True when crouching here would shield it.
export function aiCrouchCovered(bx, bz, tx, tz, { tileDefAt, stepOpen, bodyAt = null }) {
  const faces = shieldedFaces(bx, bz, {
    edgeOpen: stepOpen,
    coverCell: (x, z) => {
      const d = tileDefAt(x, z);
      // Low solids and fallen furniture only: behind a TALL solid nothing can
      // shoot you anyway, so the beat would read as the AI hiding from air.
      if (shieldsCell(d)) return true;
      return !!(bodyAt && bodyAt(x, z));
    },
  });
  return facesShieldFrom(faces, tx, tz, bx, bz);
}

// The ladder's INPUT, assembled from plain values. combat.js gathers the leaf
// facts - it owns the bodies, the AP ledger and the plans - and this turns them
// into the one object `chooseBeat` reads.
//
// It is here rather than inline in the frame driver because the assembly has
// rules of its own, and they were invisible: every beat is gated on affording
// it, and a plan is not even GATHERED when the unit cannot pay for the beat it
// would feed. That "ask only if you could act on the answer" rule is the reason
// a plan-gathering call with a side effect is dangerous - the free-summon bug
// (REVIEW.md 2026-08-02 section 1.1) was exactly that - and until now there was
// no seam at which to assert any of it.
//
// `costs` is the price of each beat; `plans` are the already-gathered plans
// (null when unaffordable or unavailable). Nothing here calls the world.
export function beatStateFrom({
  ap = 0, moveBudget = 0, moveCost = 0,
  inReach = false, hasAttack = false, attackAp = 0,
  costs = {}, summon = null, support = null, plans = {},
  shootable = false, alreadyCrouched = false,
}) {
  const afford = (c) => Number.isFinite(c) && ap >= c;
  return {
    ap,
    moveBudget,
    moveCost,
    inReach,
    hasAttack,
    attackAp,
    support: support ? { ap: support.ap, ready: !!support.ready } : null,
    summon: summon ? { ap: summon.ap, ready: !!summon.ready } : null,
    toppleAp: costs.topple,
    canTopple: !!plans.topple && afford(costs.topple),
    pullAp: costs.pull,
    canPull: !!plans.pull && afford(costs.pull),
    shoveAp: costs.shove,
    canShove: !!plans.shove && afford(costs.shove),
    breakAp: costs.break,
    canBreak: !!plans.break && afford(costs.break),
    // The crouch's geometry is world-shaped, so this is the optimistic answer
    // and the host overwrites it with the real one (combat.js asks
    // aiCrouchCovered). Anything downstream of `canCrouch` - `canEntrench`
    // below - is optimistic in the same way and overwritten by the same host.
    canCrouch: true,
    coverAp: costs.cover,
    canShoot: !!shootable,
    // Crouch-then-shoot is only worth a beat when a shot exists and the unit is
    // not already tucked in - and the ladder prices it at BOTH halves.
    canEntrench: !!shootable && !alreadyCrouched,
  };
}

// Which beat this unit takes this turn. `s` is everything the decision reads,
// as plain values:
//
//   { ap, moveBudget, moveCost, inReach, hasAttack, attackAp,
//     support: { ap, ready } | null, summon: { ap, ready } | null,
//     canPull, pullAp, canTopple, toppleAp, canShove, shoveAp,
//     canEntrench, canShoot, canBreak, breakAp, canCrouch, coverAp }
//
// The ORDER is the design (AI_PLAN's state machine), and it is the thing
// worth having a test for. One ladder, fixed order; a beat a unit's kit
// cannot take simply never gates on:
//
//   support  - triage outranks reinforcements: a body about to drop is worth
//              more than a fresh temp.
//   summon   - a summoner reinforces before it wades in. Posting the req is
//              the whole beat.
//   pull     - a member crouched with their shield between you: strictly
//              better than walking around it. Breaks the crouch, rolls the
//              Grit price, relocates them into your midst.
//   topple   - strictly better than a swing when it is available: it damages,
//              it stuns, and it leaves cover the party then has to walk
//              around. Priced at the shove's own AP, so both sides push for
//              the same. Partition edges aim it too, since M4.
//   shove    - only exists when the plan says strictly better: a slam or a
//              hazard landing (or the ranged kit's disengage). Below topple -
//              topple is shove-plus - above the plain swing.
//   attack   - the ordinary swing, when the target is in reach.
//   entrench - the ranged kit's crouch-then-shoot, when it can afford BOTH.
//              Must precede shoot or it never fires.
//   shoot    - the "in range but not in reach" arm.
//   advance  - close the distance (the destination rule is the kit's).
//   break    - only when sealed: batter the barrier that IS the route.
//   crouch   - a boxed-in unit that tucks in is a problem the player has to
//              flank; one that stands there is a target.
//   pass     - hand the turn on.
//
// `refused` is the generalized failure tail (AI_PLAN M4): an arm whose DOING
// spent nothing marks itself here for the rest of the turn and the ladder
// re-runs with it masked. Each beat can fail at most once, the ladder is
// finite, so a turn always terminates - the invariant both shipped stall
// bugs violated from outside the ladder.
const NO_REFUSALS = new Set();
export function chooseBeat(s, refused = NO_REFUSALS) {
  const ok = (b) => !refused.has(b);
  if (ok('support') && s.support && s.support.ready && s.ap >= s.support.ap) return { beat: 'support' };
  if (ok('summon') && s.summon && s.summon.ready && s.ap >= s.summon.ap) return { beat: 'summon' };
  if (ok('pull') && s.canPull && s.ap >= s.pullAp) return { beat: 'pull' };
  if (ok('topple') && s.canTopple && s.ap >= s.toppleAp) return { beat: 'topple' };
  if (ok('shove') && s.canShove && s.ap >= s.shoveAp) return { beat: 'shove' };
  if (ok('attack') && s.inReach && s.hasAttack && s.ap >= s.attackAp) return { beat: 'attack' };
  if (ok('entrench') && s.canEntrench && s.ap >= s.coverAp + s.attackAp) return { beat: 'entrench' };
  if (ok('shoot') && s.canShoot && s.ap >= s.attackAp) return { beat: 'shoot' };
  if (ok('advance') && !s.inReach && s.moveBudget >= s.moveCost) return { beat: 'advance' };
  if (ok('break') && s.canBreak && s.ap >= s.breakAp) return { beat: 'break' };
  if (ok('crouch') && s.canCrouch && s.ap >= s.coverAp) return { beat: 'crouch' };
  return { beat: 'pass' };
}

// --- taking the beat (AI_PLAN M1, the ACT half) -------------------------------
// `chooseBeat` decides; this does. It used to live inside `startCombat`'s
// closure, reading `acting`, `crouched` and eleven doers off it, which is why
// the whole perform half of the AI had no test at any level (Q005) - two AI
// bugs shipped in exactly this layer and neither could land with a regression
// test. Nothing about the dispatch is world-shaped: every arm bills AP, calls
// one doer, and sets a wait that outlasts its animation. So the doers arrive as
// an argument and the rules stay here, where a test can drive all eleven arms
// with counters instead of a browser.
//
// `turn` is the acting unit's turn state ({ ap, wait }) - mutated in place,
// because that IS the shared state the frame loop reads next tick.
//
// Three arms - `entrench`, `advance`, `crouch` - can come back having done
// NOTHING, and they must not end the turn: they add themselves to `refused` so
// the next ladder run skips them and picks something lower down. That loop is
// what makes a shieldless entrench land as a plain shot, and it is the reason
// the pass beat is the tail of THIS function rather than its caller's - every
// arm above it returns, and moving the tail out turns each of those returns
// into a fall-through into the pass.
export function takeBeat(beat, { turn, plans, unit, target, refused, doers, round = (v) => v }) {
  const {
    sup, supPlan, sm, shootable,
    tp, toppleAp, pullp, pullAp, shovep, shoveAp, brk, breakAp,
  } = plans;
  const bill = (n) => { turn.ap = round(turn.ap - n); };
  if (beat === 'support') {
    unit.supportCd = sup.cooldownRounds || 0;
    unit.supportUsed = (unit.supportUsed || 0) + 1;
    bill(sup.ap);
    doers.support(unit, supPlan, sup);
    turn.wait = 0.6;
    return;
  }
  if (beat === 'summon') {
    unit.summonCd = sm.cooldownRounds || 0;
    bill(sm.ap);
    doers.summon(unit, target, sm);
    turn.wait = 0.6;
    doers.refresh();
    return;
  }
  if (beat === 'topple') {
    bill(toppleAp);
    doers.topple(unit, tp);
    turn.wait = 0.85;
    doers.refresh();
    return;
  }
  if (beat === 'pull') {
    bill(pullAp);
    doers.pull(unit, pullp);
    turn.wait = 0.85;
    return;
  }
  if (beat === 'shove') {
    bill(shoveAp);
    doers.shove(unit, shovep);
    doers.refresh();
    turn.wait = 0.6;
    return;
  }
  if (beat === 'break') {
    bill(breakAp);
    // Through a local, not `turn.wait = doers.break(...)`: an assignment
    // resolves its target's base object BEFORE the right-hand side runs, so the
    // direct form would write the wait to whatever `turn` was when the
    // statement started. Nothing in here replaces it today - but this is the
    // one arm whose wait depends on what the doer did.
    const wait = doers.break(unit, brk);
    turn.wait = wait;
    doers.refresh();
    return;
  }
  if (beat === 'attack') {
    doers.attack(unit, target);
    bill(unit.combat.attackAp);
    turn.wait = 0.85; // outlast the swing animation so hits read one at a time
    return;
  }
  if (beat === 'entrench') {
    // The same turtle test the crouch beat runs - a shieldless spot refuses and
    // the ladder falls through to the plain shot. The crouch doer bills the
    // cover AP itself, which is why this arm does not.
    // Entrench is TWO beats and this arm is only the first: crouching flips
    // canCrouch and canEntrench false while canShoot stays true, so the shot
    // arrives on a later ladder run. chooseBeat reserved the AP for both halves
    // up front. An arm that "finishes the job" by crouching and shooting in one
    // call takes two actions in one frame and eats the 0.5s settle that makes
    // the tuck-in readable.
    if (doers.crouch(unit, target)) { turn.wait = 0.5; return; }
    refused.add('entrench');
    return; // nothing animated - fall to the shot immediately
  }
  if (beat === 'shoot') {
    doers.shoot(unit, target, shootable);
    bill(unit.combat.attackAp);
    turn.wait = 0.85;
    return;
  }
  if (beat === 'advance') {
    const spent = doers.advance(unit, target);
    if (spent > 0) { doers.billMove(spent); turn.wait = 0.15; return; }
    // The advance went nowhere: refuse the beat for the rest of the turn and
    // let the ladder re-run - the crouch this used to special-case now arrives
    // by ladder order (AI_PLAN M4's generalized tail).
    refused.add('advance');
    return; // no animation happened - re-decide on the next frame, not later
  }
  if (beat === 'crouch') {
    if (doers.crouch(unit, target)) { turn.wait = 0.5; return; }
    refused.add('crouch');
    return; // nothing animated - fall through immediately
  }
  doers.pass(); // out of AP, or everything refused
}

// --- gathering the beat's plans (AI_PLAN M1, the DECIDE half) -----------------
// The other half of the same seam. `beatStateFrom` has been pure for a while,
// but the step BEFORE it - which plans get gathered at all, and the three flags
// derived after - lived in the closure with everything else, so the AP
// pre-gates and the shot rule could only be exercised by watching a fight.
//
// Every world question arrives as a callback on `ask`. The unit and its target
// are opaque: nothing here reads a body's position except through `ask`, which
// is what lets a test drive it with plain objects.
//
// Order matters in two places and is preserved from the closure version:
//   - `postableNow` is an ASK, not a doer - it reports how many the summoner
//     could still post. The summon BEAT is what actually spends.
//   - `canShoot` is filled in AFTER `beatStateFrom`, because whether a shot
//     exists depends on `inReach`, which the assembly is what computes.
export function aiBeatPlansFrom(unit, target, ask, costs) {
  // A summoner reinforces before it wades in: off cooldown, able to afford the
  // post, and under its live cap (a maxed-out HR just fights).
  const sm = ask.summonSpec(unit);
  const summonReady = !!sm && (unit.summonCd || 0) <= 0 && ask.ap >= sm.ap
    && ask.postableNow(unit, sm) > 0;
  // Triage before reinforcement (AI_PLAN M6): rationed by uses, paced by
  // cooldown, aimed at the worst-off colleague in range - self included.
  const sup = ask.supportSpec(unit);
  const supReady = !!sup && (unit.supportCd || 0) <= 0
    && (unit.supportUsed || 0) < (sup.uses ?? Infinity) && ask.ap >= sup.ap;
  const supPlan = supReady ? ask.supportPlan(unit, sup) : null;
  // Furniture onto somebody, or failing that a partition onto somebody - one
  // beat, two aims. Each plan is gathered only if its price is already covered:
  // planning is not free, and a plan the unit cannot afford is a plan the
  // ladder will refuse anyway.
  const tp = ask.ap >= costs.topple ? (ask.topplePlan(unit) || ask.edgeTopplePlan(unit)) : null;
  const pullp = ask.ap >= costs.pull ? ask.pullPlan(unit) : null;
  const shovep = ask.ap >= costs.shove ? ask.shovePlan(unit) : null;
  // Sealed means NOBODY is engageable - while any route exists, walking it
  // beats demolition, so the break plan is not even gathered. A shut door is
  // priced at the door's own AP; battering carries the unit's swing price.
  const sealed = !ask.canEngage(unit, target);
  const brk = sealed && ask.ap > 0 ? ask.breakPlan(unit, target) : null;
  const breakAp = brk?.kind === 'door' ? brk.ap : unit.combat.attackAp;
  // Battering needs something to swing; opening a door needs only a hand. The
  // PLAN is withheld rather than a flag overwritten - `canBreak` is
  // beatStateFrom's to derive, like every other arm's.
  const canBreak = !!brk && (brk.kind === 'door' || unit.combat.attacks.length > 0);
  const beatState = beatStateFrom({
    ap: ask.ap,
    moveBudget: ask.moveBudget,
    moveCost: costs.move,
    inReach: ask.inReach(unit, target),
    hasAttack: unit.combat.attacks.length > 0,
    attackAp: unit.combat.attackAp,
    support: sup ? { ap: sup.ap, ready: !!supPlan } : null,
    summon: sm ? { ap: sm.ap, ready: summonReady } : null,
    costs: {
      topple: costs.topple, pull: costs.pull, shove: costs.shove,
      break: breakAp, cover: costs.cover,
    },
    plans: { topple: tp, pull: pullp, shove: shovep, break: canBreak ? brk : null },
    alreadyCrouched: ask.crouched(unit),
  });
  // The ranged kit (AI_PLAN M5): a line the unit could fire RIGHT NOW.
  const shootable = (!beatState.inReach && beatState.hasAttack)
    ? ask.shootable(unit, target) : null;
  beatState.canShoot = !!shootable;
  // The crouch's own geometry, asked ONCE and shared by the two arms that
  // depend on it. Gating them on `true` and letting the doer refuse worked, but
  // it spent a DECIDE iteration discovering what a predicate could have said -
  // and it logged the beat in the tally, which makes the histogram (M1's
  // regression tripwire) claim crouches that never happened.
  beatState.canCrouch = !ask.crouched(unit) && !beatState.inReach
    && ask.covered(unit, target);
  // Entrench (crouch-then-shoot): a shot in hand AND cover to take. Attacking
  // does not break the crouch [ratified], which is what makes this a beat
  // rather than a way to waste a turn.
  beatState.canEntrench = !!shootable && beatState.canCrouch;
  return {
    beatState, sup, supPlan, sm, shootable,
    tp, toppleAp: costs.topple, pullp, pullAp: costs.pull,
    shovep, shoveAp: costs.shove, brk, breakAp,
  };
}
