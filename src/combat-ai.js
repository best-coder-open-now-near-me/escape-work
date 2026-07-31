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

import { cheb, posOf, reachOfUnit, AROUND, ORTHO } from './combat-geometry.js';
import { inReach, dist, shieldedFaces, facesShieldFrom } from './tactics.js';
import { blocksSight } from './data/tiles.js';

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
export function standTilePath(ux, uz, tx, tz, { isWalkable, findEnemyPath }) {
  let best = null;
  for (const [dx, dz] of AROUND) {
    const gx = tx + dx;
    const gz = tz + dz;
    if (ux === gx && uz === gz) return [[gx, gz], [gx, gz]];
    if (!isWalkable(gx, gz)) continue;
    const p = findEnemyPath(ux, uz, gx, gz);
    if (p && p.length > 1 && (!best || p.length < best.length)) best = p;
  }
  return best;
}

// Nearest living member - but ENGAGEABLE first. Once a partition blocks a swing
// (TACTICS_PLAN M3), the closest member by distance can be one the unit can
// neither reach nor walk to: on the far side of a cubicle wall with the way
// round sealed. Targeting them means walking to the wall and swinging at
// nothing, every turn, forever. So a member the unit can actually fight
// outranks a nearer one it cannot, and distance only breaks ties within each
// group - with the WOUNDED one taking the tie after that.
//
// `candidates` is the living player side; `canEngage(m)` is the caller's
// (memoized) reach-or-route test.
export function pickTarget(ux, uz, candidates, canEngage) {
  let best = null;
  for (const m of candidates) {
    const d = cheb(ux, uz, m.actor.x, m.actor.z);
    const engageable = canEngage(m);
    const better = !best
      || (engageable && !best.engageable)
      || (engageable === best.engageable
        && (d < best.d || (d === best.d && m.sheet.hp < best.m.sheet.hp)));
    if (better) best = { m, d, engageable };
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
export function advanceRoute(unit, target, route, { approach, stepOpen }) {
  const pp = posOf(target);
  if (route) {
    const out = route.slice();
    const [gx, gz] = out[out.length - 1];
    out[out.length - 1] = approach(gx, gz, pp.x, pp.z);
    return out;
  }
  const b = unit.actor || unit;
  const t = target.actor || target;
  if (cheb(b.x, b.z, t.x, t.z) > 1) return null;
  const here = posOf(unit);
  const step = approach(b.x, b.z, pp.x, pp.z);
  if (dist(here.x, here.z, step[0], step[1]) < 0.05) return null; // as close as this tile allows
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
      if (d && (d.cover || (d.solid && !blocksSight(d)))) return true;
      return !!(bodyAt && bodyAt(x, z));
    },
  });
  return facesShieldFrom(faces, tx, tz, bx, bz);
}

// Which beat this unit takes this turn. `s` is everything the decision reads,
// as plain values:
//
//   { ap, moveBudget, inReach, hasAttack, attackAp, moveCost,
//     summon: { ap, ready } | null, toppleAp, canTopple, canCrouch, coverAp }
//
// The ORDER is the design, and it is the thing worth having a test for:
//
//   summon   - a summoner reinforces before it wades in. Posting the req is
//              the whole beat.
//   topple   - strictly better than a swing when it is available: it damages,
//              it stuns, and it leaves cover the party then has to walk
//              around. Priced at the shove's own AP, so both sides push for
//              the same.
//   attack   - the ordinary swing, when the target is in reach.
//   advance  - close the distance.
//   crouch   - a boxed-in unit that tucks in is a problem the player has to
//              flank; one that stands there is a target. Tried both when the
//              advance goes nowhere AND when there was never a move to make.
//   pass     - hand the turn on.
export function chooseBeat(s) {
  if (s.summon && s.summon.ready && s.ap >= s.summon.ap) return { beat: 'summon' };
  if (s.canTopple && s.ap >= s.toppleAp) return { beat: 'topple' };
  if (s.inReach && s.hasAttack && s.ap >= s.attackAp) return { beat: 'attack' };
  if (!s.inReach && s.moveBudget >= s.moveCost) return { beat: 'advance' };
  if (s.canCrouch && s.ap >= s.coverAp) return { beat: 'crouch' };
  return { beat: 'pass' };
}

// What the advance failing falls back to. Kept beside `chooseBeat` because it
// is the same ladder's tail: an advance that spends nothing has not taken a
// turn, so the unit gets the crouch it would have got had it never tried to
// move - and only then burns its AP so the turn can end.
//
// Burning the real AP and NOT the movement allowance is deliberate: the
// allowance cannot buy anything else, so leaving it is harmless.
export function afterFailedAdvance(s) {
  if (s.canCrouch && s.ap >= s.coverAp) return { beat: 'crouch' };
  return { beat: 'stall' };
}
