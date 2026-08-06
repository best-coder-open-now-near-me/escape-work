// Where a summon may be posted, and how many arrive - pure logic, no
// PlayCanvas, no DOM, no closure.
//
// It exists because this rule was written twice with the copies already
// visibly out of step: `summonSpotProblem` in combat.js and `summonDropProblem`
// in main.js asked the same four questions in the same order, and main.js's
// version carried a comment explaining that it was "deliberately the same four
// questions combat's summonSpotProblem asks, less the AP and uses". A rule
// documented as a copy of another rule is a rule waiting to drift.
//
// One ladder now, with the two fight-only legs (AP, per-fight uses) simply
// absent out of combat: `ap` and `usesLeft` are omitted there, and the ladder
// skips what it was not given.
import { isLivingMember } from './member-rules.js';
import { BODY_RADIUS, clampToClearance } from './pathfinding.js';

// How far a summon can be posted from the summoner, in tiles.
export const summonRange = (a) => a.range ?? 5;

// How much of this summoner's headcount is still free. The cap is per-SUMMONER
// and outlives the fight it was spent in: a summon that walks out of one fight
// and into the next is still on the books, and the link back to whoever called
// them is what lets the cap see it (SUMMON_PLAN #7).
export const summonRoom = (a, liveCount) => Math.max(0, (a.cap ?? a.count) - liveCount);

// Count one explicit population against a summoner's cap. Map-side temps,
// fight-side AI units, player-side members and borrowed units use different
// record shapes, but ownership and liveness are the same two questions.
export function countLiveSummons(summoner, records) {
  return (records || []).filter((record) => {
    const owner = record?.summonedBy ?? record?.unit?.summonedBy;
    if (owner !== summoner) return false;
    if (record.sheet) return isLivingMember(record);
    return record.alive !== false && (record.hp == null || record.hp > 0);
  }).length;
}

// How many actually arrive: what the action posts, bounded by what the cap has
// left.
export const dropCount = (a, room) => Math.max(0, Math.min(a.count, room));

// Content says where a summon looks for its landing points; the system says
// what a physical character requires once it gets there. Keeping those two
// questions separate is deliberate. Every character summon must clear walls
// and other bodies (that is physics, not a content option), while an action may
// choose an aimed point or the summoner as its anchor and may opt into/out of
// hazard avoidance. The whole descriptor is carried to the spawn layer, so a
// future placement field can be added here without another positional argument
// or a type-specific branch in the caller.
export const SUMMON_ANCHORS = Object.freeze({ AIM: 'aim', SUMMONER: 'summoner' });

export function summonPlacement(spec = {}) {
  const declared = spec.placement || {};
  return {
    anchor: declared.anchor,
    avoidHazards: declared.avoidHazards !== false,
    searchRadius: declared.searchRadius ?? 4,
  };
}

export function summonAnchorPoint(spec, summoner, aim = null) {
  const { anchor } = summonPlacement(spec);
  if (anchor === SUMMON_ANCHORS.AIM) {
    return Number.isFinite(aim?.x) && Number.isFinite(aim?.z)
      ? { x: aim.x, z: aim.z }
      : null;
  }
  if (anchor === SUMMON_ANCHORS.SUMMONER) {
    return Number.isFinite(summoner?.x) && Number.isFinite(summoner?.z)
      ? { x: summoner.x, z: summoner.z }
      : null;
  }
  return null;
}

// Deterministic continuous body-clear rest points around an exact aimed point.
// Terrain remains tile/edge authored, so each sampled point is clamped away
// from solid faces and corner posts before body overlap is tested. The clicked
// point wins when it is legal; later arrivals spiral out in fixed rings.
export function summonLandingPoints(cx, cz, count, {
  isOpen,
  edgeOpen = null,
  pointOpen = () => true,
  bodies = [],
  radius = BODY_RADIUS,
  maxSearchRadius = 4,
} = {}) {
  if (!(count > 0) || typeof isOpen !== 'function') return [];
  const out = [];
  const occupied = bodies.map((body) => ({
    x: body.x,
    z: body.z,
    radius: body.radius ?? radius,
  }));
  const seen = new Set();
  const gap = 0.04;

  const consider = (rawX, rawZ) => {
    const tileX = Math.round(rawX);
    const tileZ = Math.round(rawZ);
    if (!isOpen(tileX, tileZ)) return;
    const [x, z] = clampToClearance(isOpen, edgeOpen, rawX, rawZ, radius);
    const key = `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
    if (seen.has(key) || !isOpen(Math.round(x), Math.round(z)) || !pointOpen(x, z)) return;
    if (occupied.some((body) => Math.hypot(body.x - x, body.z - z)
      < body.radius + radius + gap)) return;
    seen.add(key);
    out.push([x, z]);
    occupied.push({ x, z, radius });
  };

  consider(cx, cz);
  const ringStep = radius * 2 + 0.12;
  for (let ring = 1; out.length < count && ring * ringStep <= maxSearchRadius; ring++) {
    const r = ring * ringStep;
    const samples = Math.max(8, Math.ceil((Math.PI * 2 * r) / (radius * 1.25)));
    // Alternate the angular phase so successive rings do not form radial rows.
    const phase = ring % 2 ? 0 : Math.PI / samples;
    for (let i = 0; i < samples && out.length < count; i++) {
      const angle = phase + (i * Math.PI * 2) / samples;
      consider(cx + Math.cos(angle) * r, cz + Math.sin(angle) * r);
    }
  }
  return out;
}

// Why this spot is unusable, or null when it is good. Shared by the click, the
// hover rings and both sides of the in-fight/out-of-fight split, so what you
// see is the rule that runs (ARCHITECTURE.md on previewAction).
//
// `s` is the spot's state as plain values:
//   { dist, los, hasRoomToStand, room, ap?, actionAp?, usesLeft? }
//
// Order matters and is the design: the two things a FIGHT owns are asked
// first - you find out you cannot afford it before you find out where it would
// have gone - then distance, then line, then the ground, then the headcount.
export function summonSpotProblem(a, s = {}) {
  if (s.ap !== undefined && s.ap < (s.actionAp ?? a.ap)) return 'Not enough AP.';
  if (a.uses && s.usesLeft !== undefined && s.usesLeft <= 0) return 'No postings left this fight.';
  if (s.dist > summonRange(a)) return 'Too far - post it closer.';
  if (!s.los) return 'No clear line to that spot.';
  if (!s.hasRoomToStand) return 'No room for anyone to stand there.';
  // Out of combat this is the whole limit, so it gets a message about the
  // headcount rather than about the fight. In a fight the caller has already
  // been refused by `uses` above if it was going to be.
  if (s.room !== undefined && s.room <= 0) {
    return 'Your req is full - that is all the headcount you have.';
  }
  return null;
}
