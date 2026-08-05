// The combat questions that are ARITHMETIC - pure logic, no PlayCanvas, no
// DOM, no closure. "How far does this verb reach?", "can this attacker touch
// that defender?", "which tile does a walk-up stop on?" are all answerable
// from positions and data, and they were answerable all along; they were
// simply written inside `startCombat`'s closure, where nothing could call them
// twice and no test could call them at all.
//
// The split follows `powers.js`: that module owns the verb RULES (what a buff
// refuses, how far a zone reaches), this one owns the SPATIAL rules the verbs
// and the previews share. combat.js keeps the bodies, the AP ledger and the
// FX; it calls in here for every "where" and "how far".
//
// Callers pass the world in as small callbacks (`stepOpen`, `hasLos`,
// `isWalkable`, `approach`) rather than a world object, so a unit test drives
// these with three arrow functions and a plain `{ x, z }`.

import { ACTIONS } from './data/actions.js';
import { reachOf, rangeOf, REACH } from './stats.js';
import { inReach, dist } from './tactics.js';
import { aimRangeOf, isControl, controlIsRanged, zoneTiles, zoneRadiusOf } from './powers.js';

// Chebyshev tile distance - THE metric this game measures range in (a diagonal
// step costs what an orthogonal one does), as distinct from `tactics.dist`,
// which is the continuous Euclidean distance reach measures against.
export const cheb = (ax, az, bx, bz) => Math.max(Math.abs(ax - bx), Math.abs(az - bz));

// Radius of a target's ring marker. Cone tests use it so a body counts when
// the wedge CLIPS it, matching what the ring shows.
export const TARGET_R = 0.5;

// Engaged from beyond this = loses the first turn.
export const SURPRISE_RADIUS = 2;

// The eight neighbours, and the four that sit on a FACE. Cover is a
// face-relationship (a shield on a diagonal shields nothing), which is why the
// crouch scans ORTHO while a swing scans AROUND.
export const AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
export const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// A member's reach comes from their weapon, an AI unit's from its def (like
// attackAp). REACH.DEFAULT is the floor for both.
export function reachOfUnit(u) {
  return u.sheet ? reachOf(u.sheet) : (u.combat?.reach ?? REACH.DEFAULT);
}

// The CONTINUOUS position reach measures against. `actor.x/.z` are only
// Math.round of this, which is why the old tile test let two units at opposite
// far corners of diagonally adjacent tiles (2.83 apart) trade swings while a
// deliberate walk-up stops at 0.85 (TACTICS_PLAN revision). Falls back to the
// logical tile for a unit with no body in the scene yet - which is also what
// makes this callable from a test with a bare `{ x, z }`.
export function posOf(u) {
  const a = u.actor || u;
  if (a.entity) {
    const p = a.entity.getPosition();
    return { x: p.x, z: p.z };
  }
  return { x: a.x, z: a.z };
}

// Is the defender within the attacker's reach DISTANCE? Ignores anything solid
// in between on purpose: this is the melee/ranged split positionMods needs, and
// whether a cubicle wall spoils a shot is a question about proximity, not about
// whether the swing is legal.
export function withinReach(attacker, defender, r = null) {
  const a = posOf(attacker);
  const d = posOf(defender);
  return inReach(a.x, a.z, d.x, d.z, r ?? reachOfUnit(attacker));
}

// Can the attacker actually TOUCH the defender - reach distance, and nothing
// solid in the way? THE melee predicate: swings, shoves and opportunity attacks
// all read it, so reach means one thing everywhere. `r` overrides the
// attacker's own reach, which the shove needs - a shove is arms-length whatever
// you happen to be holding.
//
// The line test is what makes a partition terrain rather than decoration:
// before it, cover was ranged-only AND melee ignored edges, so a cubicle wall
// cost a melee attacker nothing - not even a step around it.
export function canReach(attacker, defender, r, stepOpen) {
  const a = posOf(attacker);
  const d = posOf(defender);
  return inReach(a.x, a.z, d.x, d.z, r ?? reachOfUnit(attacker), stepOpen);
}

// How far the verb's aim WASH reaches: the widest legal aim, covering verbs the
// click never walks in for.
export function reachSpecOf(id) {
  const a = ACTIONS[id];
  if (!a) return null;
  return aimRangeOf(a) || (a.type === 'attack' && rangeOf(id) ? { r: rangeOf(id) } : null);
}

// How far the verb ACTS from, exactly as handleEnemyClick resolves it: a ranged
// attack's firing range (stats.rangeOf, where a throw's undeclared THROW_RANGE
// lives), a ranged control's declared range, and 0 for everything the click
// walks into melee reach for.
//
// Deliberately the CLICK's branching rather than the aim wash's (reachSpecOf),
// which is a wider question - a purge's wash reaches further than the purge's
// own click does. A walk-up that stopped at the WASH's distance would stop
// where its verb cannot act.
export function actRangeOf(id) {
  const a = ACTIONS[id];
  if (!a) return 0;
  if (isControl(a)) return controlIsRanged(a) ? (a.range ?? 0) : 0;
  return rangeOf(id);
}

// Could `id` be used on `en` from the point (px, pz)? THE question a walk-up
// stops on, asked with the armed power's OWN range rather than a distance
// borrowed from another verb: a 6-tile straw stops six tiles out, a swing walks
// to arm's length, and each stops the moment IT is live.
export function verbReaches(id, attacker, en, px, pz, { hasLos, stepOpen }) {
  const r = actRangeOf(id);
  const ep = posOf(en);
  if (r) {
    // A declared range is a true-distance CIRCLE measured body to body, and
    // it always needs a line - from the stand point itself, not its rounded
    // tile (DEGRID D4/D6: 'circles for targeted', designer 2026-07-31). The
    // old cheb-square-from-the-rounded-tile pair flipped legality at tile
    // boundaries and judged the shot from a centre the walker never reached.
    return dist(px, pz, ep.x, ep.z) <= r && hasLos(px, pz, ep.x, ep.z);
  }
  return inReach(px, pz, ep.x, ep.z, reachOfUnit(attacker), stepOpen);
}

// The point a walk into (gx, gz) would stop at - IF a swing on `en` from there
// is LEGAL: reach distance and a clear line, the very rule the strike runs on
// arrival (canReach). Null when that tile can't deliver the swing. This is what
// keeps the walk-up's promise: choosing a stand point by any weaker test sends
// the walk somewhere the arrival check then vetoes.
//
// It is the FURTHEST the walk can go, not where it stops: the route is trimmed
// to the first point the verb reaches from (trimToFirst), so this only has to
// prove the goal tile is worth walking to at all.
export function swingPointAt(attacker, en, gx, gz, { isWalkable, approach, stepOpen }) {
  const b = attacker.actor || attacker;
  const own = gx === b.x && gz === b.z;
  if (!own && !isWalkable(gx, gz)) return null;
  const ep = posOf(en);
  const p = approach(gx, gz, ep.x, ep.z);
  return inReach(p[0], p[1], ep.x, ep.z, reachOfUnit(attacker), stepOpen) ? p : null;
}

// Does ANY tile beside them offer a legal swing? The cheap read the target
// rings use - pure geometry, no pathfinding, so it can run per frame. A route
// to the spot is the click's own (more expensive) test.
export function hasSwingSpot(attacker, en, { isWalkable, approach, stepOpen }) {
  const world = { isWalkable, approach, stepOpen };
  // Out to the attacker's REACH, not the eight neighbours. A long handle
  // (the reach-grabber puts a swing at 2.2 tile-units) can hit from a tile
  // further out, and scanning only AROUND told it there was no melee option
  // whenever the ring was full - a coworker boxed in by their own colleagues,
  // or one the far side of a partition whose neighbours cannot be walked to.
  // That is the same mistake `routeToFiringPosition` was written to fix for
  // shots, and it made a long weapon strictly worse than a short one in the
  // one situation it exists for. Default reach rounds to 2, which still walks
  // the eight neighbours plus a ring that `swingPointAt` rejects on distance -
  // per-frame work stays proportional to the reach that earned it.
  const r = Math.ceil(reachOfUnit(attacker));
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (!dx && !dz) continue;
      if (swingPointAt(attacker, en, en.x + dx, en.z + dz, world)) return true;
    }
  }
  return false;
}

// Which tiles a zone verb aimed at (tx, tz) would actually cover: in the
// radius, able to take a surface, in line of sight from the aimer, and nobody
// standing on them. Nobody gets a surface dropped on their feet - not a
// coworker, not a teammate, not you. The cone already refused to carpet a
// member's tile; this extends the same courtesy to everyone, because a zone is
// aimed deliberately and "I did not mean to stand in that" is the cone's
// problem, not this verb's.
//
// The rings, the cursor's count and the click all call this, so they cannot
// disagree about which tiles will take it.
export function zoneCellsFor(a, origin, tx, tz, { canTakeSurface, hasLos, occupied }) {
  const out = [];
  for (const [x, z] of zoneTiles(tx, tz, zoneRadiusOf(a))) {
    if (!canTakeSurface(x, z)) continue;
    if (!hasLos(origin.x, origin.z, x, z)) continue;
    if (occupied(x, z)) continue;
    out.push([x, z]);
  }
  return out;
}

// A walkable tile with a partition (or closed door) on any face - the other
// thing this office calls cover, and a legal take-cover aim.
export function edgeShieldedTile(tx, tz, { isWalkable, stepOpen }) {
  return isWalkable(tx, tz)
    && ORTHO.some(([dx, dz]) => !stepOpen(tx, tz, tx + dx, tz + dz));
}

// Who joins this fight: every living coworker within `radius` of the body the
// fight opens around, who can actually take part in it.
//
// The second half is not a refinement, it is what stops a fight from being
// unwinnable. Chebyshev distance alone pulls in somebody sealed behind a closed
// door - and doors cannot be opened in combat and closed doors block sight, so
// that coworker can never be reached, shot or seen while victory still requires
// them down. `canTakePart` is the caller's side test, because only combat knows
// which bodies are on which side.
//
// `primary` is the one the fight is ABOUT - the coworker you clicked, the one
// who spotted you - and it joins whether or not it made the radius, because a
// thrown opener reaches further than the auto-engage does. Three of the four
// call sites had written that line out themselves; it belongs with the filter
// that makes it necessary.
export function engagedAround(enemies, origin, radius, canTakePart, primary = null) {
  const engaged = enemies.filter((e) => e.alive
    && Math.max(Math.abs(e.x - origin.x), Math.abs(e.z - origin.z)) <= radius
    && canTakePart(origin, e));
  if (primary && !engaged.includes(primary)) engaged.push(primary);
  return engaged;
}
