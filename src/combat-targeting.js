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

import {
  isControl, controlIsRanged, isPull, isPurge, isZone, aimsAtProps, isBreakable,
  isStance, isMobility, aimsAtAlly, aimsAtAnyone,
} from './powers.js';
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
  // A stance is never armed (it is an instant self-cast behind a confirm
  // click), but it has a name here so that "no arm matched, call it melee"
  // can never quietly hand one a target ring.
  if (isStance(a)) return 'stance';
  // Mobility splits by who it points at: a swap reaches for a teammate, a dash
  // reaches for the floor. Both used to fall through to 'melee', which was
  // harmless only because `ringsAtBodies` refused them on a different test.
  if (isMobility(a)) return aimsAtAlly(a) ? 'ally' : 'mobility';
  // The friend-facing verbs - buffs, and the ally-mode mobility above. A PURGE
  // is deliberately excluded: it aims at both halves of the board (Reboot
  // power-cycles a colleague, a coworker or you), so it keeps its body-facing
  // kind and `sides()` below is what says it also rings friends.
  if (aimsAtAlly(a) && !aimsAtAnyone(a)) return 'ally';
  if (isControl(a) && controlIsRanged(a)) return 'control';
  if (a.type === 'shove') return 'shove';
  if (isPull(a)) return 'pull';
  if (range) return 'ranged';
  return 'melee';
}

// The kinds that put a ring on a BODY. Everything else rings ground, friends,
// or nothing, and has its own branch before the body pass is reached.
const BODY_KINDS = new Set(['cone', 'control', 'shove', 'pull', 'ranged', 'melee']);

// Which SIDES a verb points at. One verb can point at both - that is what the
// purge is - so this is a pair of booleans rather than a second kind.
//
// It exists because "does this verb point at this half of the board" was being
// answered by proxy at every call site: by `a.type` ladders in the rings, by
// "does it carry a payload" at the click, by `aimsAtAlly` in the hover. Those
// answers disagreed, which is how an HR buff came to resolve on a coworker
// (REVIEW.md 2026-08-02 §1.3). Ask here instead.
// `side` on the action entry is the DATA override, ratified as Q3-A (designer,
// 2026-08-02): `'enemy' | 'ally' | 'any'`, defaulting from `type` when absent.
// Content that points somewhere its type does not imply says so in the registry
// rather than earning a special case in systems code - the one rule
// (ARCHITECTURE.md). Reboot is the case that needs it: TODO.md settled that it
// targets anything, and no `type` can express "both".
const SIDES = { enemy: [false, true], ally: [true, false], any: [true, true] };

export function verbSides(a, range = 0) {
  const kind = verbKind(a, range);
  const declared = a && SIDES[a.side];
  return {
    kind,
    allies: declared ? declared[0] : (kind === 'ally' || aimsAtAlly(a)),
    enemies: declared ? declared[1] : BODY_KINDS.has(kind),
    ground: kind === 'zone' || kind === 'summon' || kind === 'cover' || kind === 'mobility',
  };
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
//
// This was a SECOND hand-written `a.type` ladder - `attack || shove ||
// isControl || isPurge` - and it silently omitted `pull`. Because `drawTargets`
// gates the whole body pass on it, arming Pull Over drew no ring, no reach
// circle and no affordance of any kind, while `verbKind` and `enemyRingOk`
// both carried live `pull` arms that could never be reached (REVIEW.md
// 2026-08-02 §1.7). It is now derived from `verbKind`, so a new body-facing
// verb cannot be added to one classifier and forgotten in the other.
export function ringsAtBodies(a, range = 0) {
  return BODY_KINDS.has(verbKind(a, range));
}

// The prop tiles a shove would ring: the eight neighbours, each with the plan
// that says whether it can actually go over and where it would land.
//
// Props are targets, and nothing ever said so. A shove that puts a filing
// cabinet on somebody is strictly the better move where it is available - it
// damages, it stuns, and it leaves cover the other side has to walk around - so
// the affordance for it should not be "the player happened to try it".
export function toppleRings(bx, bz, { isToppleableAt, planAt, reaches = null }) {
  const out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      const px = bx + dx;
      const pz = bz + dz;
      if (!isToppleableAt(px, pz)) continue;
      // TILE adjacency finds the candidates; the CLICK then measures reach from
      // the body's continuous position, and since DEGRID a body rests wherever
      // its walk left it. A diagonal prop one tile away can be further than
      // REACH.SHOVE in a straight line - so the ring drew green and the click
      // answered "Too far to shove". `reaches` is the click's own test, handed
      // in, so a ring can only promise what the click will do.
      const plan = reaches && !reaches(px, pz) ? null : planAt(px, pz);
      out.push({ x: px, z: pz, plan });
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
