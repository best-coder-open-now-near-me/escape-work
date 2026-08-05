// Where a verb LANDS - the plan half of every plan/perform pair in combat.js.
// Pure logic: no PlayCanvas, no DOM, no closure, no AP spent and no body moved.
// A plan answers "can this happen right now, and where", and returns either the
// shape the perform half needs or the reason it refuses.
//
// This is the seam combat.js already drew and never enforced: nearly every verb
// there was written as `<verb>PlanAt(...)` / `perform<Verb>(...)`, with the
// first half doing arithmetic over positions and data and the second half
// moving bodies and spending AP. The pairs stayed in one closure, so the
// arithmetic could not be tested and - worse - the plan and its REFUSAL drifted
// apart: `pullPlanFor` and `pullRefusal` were two hand-parallel walks down the
// same five legs, and keeping them in step was a comment asking politely.
// `pullPlan` below is one walk that returns either outcome, so they cannot
// disagree by construction.
//
// Why not powers.js: that module is deliberately dependency-free - it answers
// what a verb refuses from plain numbers. These need the world's SHAPE (edges,
// walkability, cover) and so import tactics/stats/geometry. Same "no world
// object" discipline, one layer up: callers pass small query callbacks.

import { ACTIONS } from './data/actions.js';
import { rangeOf, REACH } from './stats.js';
import { inReach, dist, dirOctant } from './tactics.js';
import { isToppleable, toppleLanding, isBreakable, aimsAtProps, pullLanding } from './powers.js';
import { cheb, posOf, reachOfUnit, ORTHO, AROUND } from './combat-geometry.js';

// --- toppling (POWERS_PLAN M6) -----------------------------------------------

// Whether the prop at (px, pz) can be knocked over by a body at (bx, bz) right
// now, and where it would land. Null when it cannot. Shared by the click, the
// hover affordance and the AI, so all three agree.
//
// Nothing behind it to fall into means it rocks and settles: no free
// destruction against a wall - a prop pinned by geometry stays up, which is
// also what stops toppling from being a way to demolish a corridor.
export function topplePlan(bx, bz, px, pz, { tileDefAt, terrainOpen, stepOpen }) {
  const def = tileDefAt(px, pz);
  if (!isToppleable(def)) return null;
  const landing = toppleLanding(bx, bz, px, pz);
  if (!landing) return null;
  const [lx, lz] = landing;
  if (!terrainOpen(lx, lz)) return null;
  if (!stepOpen(px, pz, lx, lz)) return null;
  return { def, x: px, z: pz, lx, lz };
}

// The AI's version of the same question: is there a prop next to me that would
// land on somebody I am trying to hit? Scored like an attack and taken like one
// (POWERS_PLAN M7). Without this, toppling is a trick the player does to a
// static world - the office falls on coworkers and never on you.
//
// `victimAt(x, z)` is the caller's "is one of THEM standing here" test; only
// combat knows which side a body is on.
export function aiTopplePlan(bx, bz, { tileDefAt, terrainOpen, stepOpen }, victimAt) {
  const world = { tileDefAt, terrainOpen, stepOpen };
  for (const [dx, dz] of AROUND) {
    const plan = topplePlan(bx, bz, bx + dx, bz + dz, world);
    if (plan && victimAt(plan.lx, plan.lz)) return plan;
  }
  return null;
}

// --- the AI's cover-denial plans (AI_PLAN M4) --------------------------------

// Is there a shove WORTH taking - one that slams an adjacent victim into
// something solid, or lands them in a hazard? A shove that merely moves
// somebody is refused: it spends real AP to improve nothing, and the ladder
// sits shove above the swing precisely because the plan only exists when it
// is strictly better. `disengage` widens the gate for a unit that WANTS the
// gap (the ranged kit, AI_PLAN A4's carve-out): any legal step-back
// qualifies, because breaking contact is itself the value - the game's own
// "shove is the safe disengage" doctrine (TACTICS_PLAN #9), read from the
// other side.
//
// Adjacent-only, like the topple's own aim; `victimAt` is the caller's side
// test, `hazardAt` its "would landing there hurt" test.
export function aiShovePlan(bx, bz, { isWalkable, stepOpen, occupied }, victimAt,
  { hazardAt = null, disengage = false, reaches = null } = {}) {
  const world = { isWalkable, stepOpen, occupied };
  for (const [dx, dz] of AROUND) {
    const vx = bx + dx;
    const vz = bz + dz;
    const victim = victimAt(vx, vz);
    if (!victim) continue;
    // The PLAYER's shove gate, applied to the AI's (`canReach` at REACH.SHOVE)
    // [ratified] (designer, 2026-08-05: "a for both q096 and q097"). Tile
    // adjacency alone let a coworker shove from a diagonal the player could not
    // and straight across a partition edge, because `AROUND` asks only "is that
    // tile next to mine" while the player's gate measures body to body and
    // honours the corner rule. Doctrine #9 - forced movement never provokes,
    // so shove is the safe disengage - is a rule about the VERB; it should not
    // reach further in one pair of hands than the other.
    if (reaches && !reaches(victim)) continue;
    const plan = displacePlan(vx, vz, dx, dz, world);
    if (!plan) continue;
    // The victim goes to `hazardAt` because the caller's test is about THIS
    // body: what a landing costs depends on whose talents are in the boots.
    if (plan.blocked || disengage || (hazardAt && hazardAt(plan.tx, plan.tz, victim))) {
      return { victim, dx, dz, ...plan };
    }
  }
  return null;
}

// The partition this unit could put a shoulder into WITH somebody behind it
// - TACTICS_PLAN M6's partition topple, whose AI half was left as "a
// follow-up" in that plan's landed notes. Square-on like the player's aim;
// the panel falls AWAY from the shover, so the victim test is the far tile.
export function aiEdgeTopplePlan(bx, bz, { wallEdgeBetween, terrainOpen }, victimAt) {
  for (const [dx, dz] of ORTHO) {
    const tx = bx + dx;
    const tz = bz + dz;
    if (!wallEdgeBetween(bx, bz, tx, tz)) continue;
    if (!terrainOpen(tx, tz)) continue;
    if (!victimAt(tx, tz)) continue;
    return { edge: true, tx, tz };
  }
  return null;
}

// Which crouched victim a pull could haul (TACTICS_PLAN M8's verb, the AI
// half). The rules are pullPlan's own - shield between the bodies,
// REACH.PULL, landing room - this wrapper only walks the candidates.
// `crouchOf(v)` returns the victim's live crouch AS THE PULLER SEES IT
// (faces computed with the puller's own body not counted: standing beside
// somebody is how you reach over their barrier, not a barrier of your own).
// The two defaults are repeated VERBATIM from pullPlan's own destructure, and
// that is the one line here where a slip would change behaviour: combat supplies
// `bodyAt` and omits `name`, so getting either default wrong silently rewrites
// a refusal or a reachability test rather than throwing.
export function aiPullPlan(unit, candidates, crouchOf,
  { stepOpen, open, name = 'They', bodyAt = null }) {
  const world = { stepOpen, open, name, bodyAt };
  for (const v of candidates) {
    const crouch = crouchOf(v);
    if (!crouch) continue;
    const plan = pullPlan(unit, v, crouch, world);
    if (plan && !plan.refusal) return { victim: v, ...plan };
  }
  return null;
}

// What a SEALED unit batters (AI_PLAN A10): the adjacent breakable prop or
// partition edge on the way toward where it wants to go. Only consulted when
// no target is engageable at all - while a route exists, walking beats
// demolition. v1 is deliberately adjacent-only, on the one or two faces the
// target's octant names; pathing THROUGH breakables by pool HP is the
// refinement AI_PLAN names and defers.
export function aiBreakPlan(bx, bz, tx, tz, { tileDefAt, edgeHpBetween, doorsBeside = null }) {
  // A shut door FIRST: it is not breakable at all (doors are deliberately not
  // in the wall sets, so they carry no HP pool), it is the cheapest thing in
  // reach, and it is the actual passage. Without this arm a unit sealed by a
  // door somebody closed on it farms crouches forever while the fight cannot
  // end - the piñata case A10 names. Take the shut door that most reduces the
  // distance to the target; one that leads away is not a way through.
  if (doorsBeside) {
    let best = null;
    for (const d of doorsBeside(bx, bz)) {
      if (d.open) continue;
      const [fx, fz] = d.to;
      const gain = cheb(bx, bz, tx, tz) - cheb(fx, fz, tx, tz);
      if (gain <= 0) continue;
      if (!best || gain > best.gain) best = { d, gain };
    }
    if (best) {
      return { kind: 'door', key: best.d.key, ap: best.d.ap, tx: best.d.to[0], tz: best.d.to[1] };
    }
  }
  const { x: sx, z: sz } = dirOctant(tx, tz, bx, bz); // from the unit toward the target
  const cands = [];
  if (sx) cands.push([bx + sx, bz]);
  if (sz) cands.push([bx, bz + sz]);
  for (const [nx, nz] of cands) {
    if (isBreakable(tileDefAt(nx, nz))) return { kind: 'prop', tx: nx, tz: nz };
    if (edgeHpBetween(bx, bz, nx, nz) !== null) return { kind: 'edge', a: [bx, bz], b: [nx, nz] };
  }
  return null;
}

// --- breaking cover down (TACTICS_PLAN M8) -----------------------------------

// What the armed attack resolves on at (tx, tz): a breakable prop ON the tile,
// or a partition edge - square-on for a swing (the topple's own aim), or on the
// clicked tile's face TOWARD the shooter for a shot. Returns { kind } to
// commit, { refusal } to explain, null to fall through. Melee does not walk in
// for v1 `[proposed]` - the rings only promise reach.
export function breakPlan(id, attacker, tx, tz, { tileDefAt, edgeHpBetween, hasLos, stepOpen }) {
  const a = ACTIONS[id];
  if (!aimsAtProps(a)) return null;
  const me = posOf(attacker);
  const b = attacker.actor || attacker;
  const ax = b.x;
  const az = b.z;
  const range = rangeOf(id);

  if (isBreakable(tileDefAt(tx, tz))) {
    if (range) {
      // EUCLIDEAN, from the body, exactly as the same weapon's range is
      // measured at a coworker (`bodyDist` at the click, DEGRID D4: a range is
      // a true-distance circle from where the model actually stands)
      // [ratified] (designer, 2026-08-05: "a for both q096 and q097").
      //
      // This measured Chebyshev off the rounded TILE, so one `range: 4` weapon
      // meant two different distances depending on what you aimed it at: a
      // body at (3,3) is 4.24 away and refused, a prop on the same tile is
      // Chebyshev 3 and allowed. The corners of the square were reachable for
      // props and not for people.
      if (dist(me.x, me.z, tx, tz) > range) return { refusal: 'Too far.' };
      if (!hasLos(ax, az, tx, tz)) return { refusal: 'No clear line to it.' };
    } else if (!inReach(me.x, me.z, tx, tz, reachOfUnit(attacker), stepOpen)) {
      return { refusal: 'Too far to swing at it.' };
    }
    return { kind: 'prop', tx, tz };
  }

  if (!range) {
    // Square-on and at arm's reach, exactly as the partition shove aims.
    if (Math.abs(tx - ax) + Math.abs(tz - az) === 1 && edgeHpBetween(ax, az, tx, tz) !== null) {
      return { kind: 'edge', a: [ax, az], b: [tx, tz] };
    }
    return null;
  }
  // A shot takes the panel on the clicked tile's near face - the edge a
  // sightline from here would cross first. Partitions never block sight (M6a),
  // so the line test is about smoke and doors, not the target. The near face
  // is picked from the shooter's BODY (dirOctant), so a shooter who drifted
  // half a tile does not shoot at the panel their rounded tile faces.
  const { x: sx, z: sz } = dirOctant(me.x, me.z, tx, tz);
  for (const [nx, nz] of [[tx + sx, tz], [tx, tz + sz]]) {
    if (nx === tx && nz === tz) continue;
    if (edgeHpBetween(tx, tz, nx, nz) === null) continue;
    if (cheb(ax, az, tx, tz) > range) return { refusal: 'Too far.' };
    if (!hasLos(ax, az, tx, tz)) return { refusal: 'No clear line to it.' };
    return { kind: 'edge', a: [tx, tz], b: [nx, nz] };
  }
  return null;
}

// --- Pull Over (TACTICS_PLAN M8) ---------------------------------------------

// Can the pull haul this target right now, and where do they land? ONE walk
// down the legs, returning `{ landing }` on success or `{ refusal }` with the
// reason the leg that failed gives. The click's explanation and the plan are
// now the same computation rather than two lists kept in step by hand.
//
// `crouch` is the target's crouch state (null if they are not dug in), whose
// `faces` are the shielded faces of the tile they are dug in on; `open(x, z)`
// is the caller's walkable-and-unoccupied test; `bodyAt(x, z)` says whether a
// character is standing on a cell.
export function pullPlan(puller, target, crouch, { stepOpen, open, name = 'They', bodyAt = null }) {
  if (!crouch) {
    return { refusal: `${name} is not dug in behind anything - nothing to pull them over.` };
  }
  const A = puller.actor || puller;
  const D = target.actor || target;
  // Their shield must stand BETWEEN you: the verb is a reach OVER cover, which
  // is also what keeps it from being a generic drag - from their open side you
  // have swings and shoves already. One test now that the crouch is a
  // position: is a shielded face pointing your way? Direction between the
  // BODIES (dirOctant), like every other octant since DEGRID M4 - the puller
  // just walked up to a free point, not to their tile centre.
  const ab = posOf(puller);
  const db = posOf(target);
  const { x: sx, z: sz } = dirOctant(ab.x, ab.z, db.x, db.z);
  const face = (crouch.faces || []).find(([ox, oz]) =>
    (sx !== 0 && ox === sx && oz === 0) || (sz !== 0 && oz === sz && ox === 0));
  if (!face) return { refusal: 'Their cover is not between you - get to its far side first.' };
  // A HUMAN shield is not a barrier: you do not haul somebody over a colleague,
  // you deal with the colleague. Asked of the face that is actually in the
  // way, so a crouch covered by both a person and a wall is pullable over the
  // wall and refused over the person, which is the honest reading of each.
  if (bodyAt && bodyAt(D.x + face[0], D.z + face[1])) {
    return { refusal: 'Their cover is a person - that is a shove, not a pull.' };
  }

  const me = posOf(puller);
  const dp = posOf(target);
  if (dist(me.x, me.z, dp.x, dp.z) > REACH.PULL) return { refusal: 'Too far to reach over.' };

  const landing = pullLanding(A.x, A.z, D.x, D.z, open, stepOpen);
  if (!landing) return { refusal: 'No room on your side to land them.' };
  return { landing, crouch };
}

// --- take cover (TACTICS_PLAN M6) --------------------------------------------
//
// `coverSpot` lived here: given a shield, it chose which of that shield's free
// neighbours you would stand on. It is gone with the rule it served. The
// crouch is a POSITION now (designer, 2026-07-31) - you aim at the tile you
// want to stand on, and combat asks `shieldedFaces` whether anything covers
// it - so there is no side left for a helper to pick on your behalf. That
// choosing-for-you was the bug: it made the emblem hop between an object's
// neighbours and left you unable to say which side of a person you wanted.

// --- displacement, shared (POWERS_PLAN M2) -----------------------------------

// Where a push along (dx, dz) puts a body, and whether anything stops it.
// Returns { tx, tz, blocked }. `blocked` is what splits the shove's two
// stories: a clear tile behind them is a step back, a solid one is the slam.
//
// A partition between the tiles counts as "something solid" too - and so does a
// body. `isWalkable` only excludes enemies and NPCs, so without the caller's
// occupancy test a shove could glide a coworker onto a teammate's (or a
// summon's) tile and leave two combatants permanently stacked.
export function displacePlan(bx, bz, dx, dz, { isWalkable, stepOpen, occupied }) {
  if (!dx && !dz) return null;
  const tx = bx + dx;
  const tz = bz + dz;
  const blocked = occupied(tx, tz) || !isWalkable(tx, tz) || !stepOpen(bx, bz, tx, tz);
  return { tx, tz, blocked };
}
