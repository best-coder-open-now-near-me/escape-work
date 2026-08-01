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
export function aiTopplePlan(bx, bz, world, victimAt) {
  for (const [dx, dz] of AROUND) {
    const plan = topplePlan(bx, bz, bx + dx, bz + dz, world);
    if (plan && victimAt(plan.lx, plan.lz)) return plan;
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
      if (cheb(ax, az, tx, tz) > range) return { refusal: 'Too far.' };
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
