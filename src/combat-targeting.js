// What the target rings PROMISE - pure logic, no PlayCanvas, no DOM.
//
// A green ring means "the click lands this verb on them right now". That is a
// rule, and it has to be the same rule the click itself runs, or the rings lie:
// REVIEW.md records exactly that failure - a ranged weapon rang an
// out-of-range enemy red while the click happily walked the member in and
// fired. Every enemy also used to ring green on bare swing-AP, partition-sealed
// ones included, which is the same lie with the colours swapped.
//
// The verdict lived inside `drawTargets`, a 300-line function that decided AND
// drew in the same breath. Here it is the decision alone: combat.js gathers the
// leaf facts (it owns the bodies and the world) and this module owns which
// facts a given verb actually consults, and in what order. drawTargets keeps
// the drawing.

import { isControl, controlIsRanged, isPull, isPurge, isZone, aimsAtProps, isBreakable } from './powers.js';
import { ORTHO } from './combat-geometry.js';

// WHICH branch a verb aimed at a body takes. One classifier, read by the rings
// and by the click, so the two cannot pick different branches for the same
// verb - which is precisely how the rings came to contradict the click
// (REVIEW.md): each had its own hand-written ladder of `a.type` tests, in a
// slightly different order, and a ranged weapon fell out of one of them.
//
// `range` is stats.rangeOf(id) - a throw's undeclared THROW_RANGE lives there,
// so it cannot be read off the action alone.
//
// A touch-range control deliberately classifies as 'melee': Detain refusing
// "too far" would make it the one arm's-length action in the game that will not
// approach, and the arrival resolves it as a control rather than a swing.
export function verbKind(a, range = 0) {
  if (!a) return 'none';
  if (a.type === 'cover') return 'cover';
  if (a.cone) return 'cone';
  if (a.type === 'summon') return 'summon';
  if (isZone(a)) return 'zone';
  if (isControl(a) && controlIsRanged(a)) return 'control';
  if (a.type === 'shove') return 'shove';
  if (isPull(a)) return 'pull';
  if (range) return 'ranged';
  return 'melee';
}

// Is the ring for `en` green? `q` is the leaf facts, all already answered:
//
//   { ap, actionAp, ammoOk, range, shoveReach, pullOk, controlRefused,
//     dist, los, shotBlocked, shotRedirectedToAlly, meleeReachable }
//
// Five branches, one per shape of verb, and picking the branch is the whole
// job: a shove asks about arm's length, a pull asks about the barrier, a
// thrown control asks the control's own gate, a shot asks range-line-ammo, and
// everything else asks whether a swing can land - from here OR from a legal
// stand point beside them.
export function enemyRingOk(a, q) {
  const affordable = q.ap >= (q.actionAp ?? a.ap);
  const kind = verbKind(a, q.range);
  if (kind === 'shove') return q.shoveReach && affordable;
  // Green is the pull's whole promise: crouched, their shield between you, in
  // reach over it, room on your side (TACTICS_PLAN M8).
  if (kind === 'pull') return q.pullOk && affordable;
  // A thrown control needs the range and the line, same as a throw. A
  // touch-range one falls to the melee case below: clicking a distant target
  // walks you in, so every reachable body rings green.
  if (kind === 'control') return !q.controlRefused;
  if (kind === 'ranged') {
    // Ranged: distance, a clear line, AP - and ammo only if this particular
    // shot bills for it (the throws do; a staple gun fires for free). A
    // crouched target with no angle rings red (TACTICS_PLAN M6) - and so does
    // one whose human shield is YOURS, because that click refuses.
    return q.dist <= q.range && q.los
      && !q.shotBlocked && !q.shotRedirectedToAlly
      && q.ammoOk && affordable;
  }
  // Melee (and the touch verbs that walk in): green is the promise the click
  // keeps - a swing can actually land on them, from here or from some legal
  // stand point beside them (the same rule routeBeside walks to).
  //
  // Distance is deliberately NOT tested: a partial approach is the click's
  // honest outcome ("close the distance"), and the hover preview prices the
  // walk exactly. Path existence stays the click's own test - a Dijkstra fan
  // per enemy per frame is too hot for rings.
  return affordable && q.meleeReachable;
}

// Which verbs ring anything at a BODY at all. Everything else (a zone, a
// summon, a cover aim, a buff) rings ground or friends and is handled by its
// own branch before this one is reached.
export function ringsAtBodies(a) {
  return a.type === 'attack' || a.type === 'shove' || isControl(a) || isPurge(a);
}

// The prop tiles a shove would ring: the eight neighbours, each with the plan
// that says whether it can actually go over and where it would land.
//
// Props are targets, and nothing ever said so. A shove that puts a filing
// cabinet on somebody is strictly the better move where it is available - it
// damages, it stuns, and it leaves cover the other side has to walk around - so
// the affordance for it should not be "the player happened to try it".
export function toppleRings(bx, bz, { isToppleableAt, planAt }) {
  const out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      const px = bx + dx;
      const pz = bz + dz;
      if (!isToppleableAt(px, pz)) continue;
      out.push({ x: px, z: pz, plan: planAt(px, pz) });
    }
  }
  return out;
}

// The partition faces a shove would ring - the office's own walls
// (TACTICS_PLAN M6). An adjacent partition rings the tile it would fall ONTO.
export function partitionRings(bx, bz, { wallEdgeBetween, terrainOpen }) {
  const out = [];
  for (const [dx, dz] of ORTHO) {
    const px = bx + dx;
    const pz = bz + dz;
    if (!wallEdgeBetween(bx, bz, px, pz)) continue;
    out.push({ x: px, z: pz, clear: terrainOpen(px, pz) });
  }
  return out;
}

// The breakable cover an ARMED attack rings (TACTICS_PLAN M8) - the same
// promise the shove's prop rings make: green means the click lands the hit. A
// melee swing rings its neighbourhood, a ranged attack everything it could hit.
//
// A DISTANT partition stays un-rung - the shove's own partial-affordance
// precedent `[proposed]` - though the ranged click still resolves; the adjacent
// ones ring like the shove's do.
export function breakRings(a, bx, bz, range, { tileDefAt, planAt, edgeHpBetween }) {
  if (!aimsAtProps(a)) return { props: [], edges: [] };
  const lim = range || 1;
  const props = [];
  for (let dx = -lim; dx <= lim; dx++) {
    for (let dz = -lim; dz <= lim; dz++) {
      if (!dx && !dz) continue;
      const px = bx + dx;
      const pz = bz + dz;
      if (!isBreakable(tileDefAt(px, pz))) continue;
      const plan = planAt(px, pz);
      props.push({ x: px, z: pz, landable: !!plan && !plan.refusal });
    }
  }
  const edges = [];
  for (const [dx, dz] of ORTHO) {
    const px = bx + dx;
    const pz = bz + dz;
    if (edgeHpBetween(bx, bz, px, pz) === null) continue;
    edges.push({ x: px, z: pz });
  }
  return { props, edges };
}
