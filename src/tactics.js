// Tactical positioning: the rules that make WHERE a unit stands matter
// (TACTICS_PLAN.md). Pure - no PlayCanvas, no DOM, no grid, no combat. Every
// function here takes already-resolved numbers or plain coordinates, so the
// rules unit-test without standing up a fight.
//
// Milestone 1 lands only the assembler. Before it, FOUR sites in combat.js
// (the hover preview, the melee swing, the cone, and the AI's swing) each
// summed the to-hit terms by hand - which meant the percentage on screen was
// a reimplementation of the roll rather than a read of it, and any term added
// to one and not the others would make the UI lie. Now there is one place.
//
// `positional` is the seam the later milestones fill in (cover, flanking,
// backstab). It is 0 everywhere today, so this milestone changes no number.
import { HIT } from './stats.js';

// The to-hit terms for one attacker/defender pair, in the shape
// stats.hitChance consumes: { acc, dodge, mods }.
//
//   accuracy   attacker's accuracy - attributes and gear already folded in
//   dodge      defender's dodge, likewise
//   surprised  defender hasn't registered the fight yet (HIT_PLAN #6)
//   accMod     attacker's status accuracy modifier (a blinded attacker aims worse)
//   dodgeMod   defender's status dodge modifier
//   positional cover / flanking / backstab (TACTICS_PLAN milestones 3-5)
export function toHitTerms({
  accuracy = 0,
  dodge = 0,
  surprised = false,
  accMod = 0,
  dodgeMod = 0,
  positional = 0,
} = {}) {
  return {
    acc: accuracy + (surprised ? HIT.SURPRISE_ACC_BONUS : 0) + accMod,
    dodge: dodge + dodgeMod,
    mods: positional,
  };
}

// --- threat & opportunity attacks (TACTICS_PLAN M2) -------------------------

// Tunables the positional rules own. Hit-chance magnitudes live in stats.HIT
// with the rest of the roll; this is the reaction economy, which isn't a
// to-hit number.
export const TACTICS = {
  REACTIONS_PER_ROUND: 1, // free swings a unit may take between its own turns
};

// Chebyshev distance: a diagonal costs the same as an orthogonal, which is how
// the grid treats adjacency everywhere else (movement, shove range, melee).
export const cheb = (ax, az, bx, bz) => Math.max(Math.abs(ax - bx), Math.abs(az - bz));

// A unit threatens the eight tiles around it. Everyone can threaten: since
// EQUIPMENT_PLAN M3 every combatant has a basic melee swing (its weapon's, or
// a punch), so this needs no per-unit capability check.
export const threatens = (tx, tz, x, z) => cheb(tx, tz, x, z) <= 1;

// Which of `threats` a step from (fx, fz) to (tx, tz) provokes: those that
// threatened the tile being LEFT and no longer threaten the tile being
// ENTERED. Comparing threat SETS rather than raw adjacency is what keeps a
// unit circling a foe - sliding from one threatened tile to another - from
// provoking, and stops a diagonal shuffle past someone from double-firing
// (TACTICS_PLAN, "continuous movement and tile-granular reactions").
//
// Pure: `threats` is any list of things carrying x/z, and eligibility (alive,
// aware, still holding a reaction) is the caller's filter, not this rule's.
export function provokedBy(threats, fx, fz, tx, tz) {
  if (fx === tx && fz === tz) return []; // standing still is not leaving
  return (threats || []).filter((t) =>
    threatens(t.x, t.z, fx, fz) && !threatens(t.x, t.z, tx, tz));
}

// --- cover (TACTICS_PLAN M3) ------------------------------------------------

// Is the defender at (dx, dz) shielded from an attacker at (ax, az)?
//
// Partitions in this game are EDGES between tiles, not cells (grid.js), and
// they deliberately don't block sight - throws sail right over a chest-high
// cubicle wall (grid.sightOpen tests doors only). So a partition was pure
// movement obstacle with no tactical upside. Cover is the upside: it doesn't
// stop the shot, it spoils it.
//
// The test is which SIDE of the defender's own tile the attacker is on: take
// the direction from defender toward attacker and ask whether a solid edge
// sits on the one or two faces pointing that way. `edgeOpen(x, z, nx, nz)`
// is passed in (combat threads world.stepOpen, already on its façade and
// already meaning "something solid" - the shove's wall-slam reads it the same
// way), which is why walls and closed doors grant cover too. Peeking around a
// doorframe should work.
//
// Deliberately boolean: cover applies at most once per attack, so tucking
// into a partition corner can't stack two edges into double cover.
export function hasCover(ax, az, dx, dz, edgeOpen) {
  if (typeof edgeOpen !== 'function') return false;
  const sx = Math.sign(ax - dx);
  const sz = Math.sign(az - dz);
  // Each axis is checked as its own orthogonal face. A diagonal attacker is
  // blocked by either face - going around one corner is enough.
  if (sx !== 0 && !edgeOpen(dx, dz, dx + sx, dz)) return true;
  if (sz !== 0 && !edgeOpen(dx, dz, dx, dz + sz)) return true;
  return false;
}

// --- flanking (TACTICS_PLAN M4) ---------------------------------------------

// Is the defender at (dx, dz) caught in a pincer - the attacker on one side
// and one of the attacker's allies on the EXACTLY opposite side?
//
// Strict opposition rather than a headcount (TACTICS_PLAN #7): a crowd bunched
// on one flank is not a sandwich, and rewarding "stand next to each other"
// would reward clumping, which is the opposite of the point. `allies` is any
// list carrying x/z - the attacker's own side, attacker excluded.
export function isFlanked(ax, az, dx, dz, allies) {
  const sx = Math.sign(ax - dx);
  const sz = Math.sign(az - dz);
  if (sx === 0 && sz === 0) return false; // attacker standing on the defender
  return (allies || []).some((a) =>
    threatens(a.x, a.z, dx, dz)            // must be in its face, not lobbing from afar
    && Math.sign(a.x - dx) === -sx
    && Math.sign(a.z - dz) === -sz);
}

// --- backstab (TACTICS_PLAN M5) ---------------------------------------------

// Is the attacker behind the defender's facing?
//
// `facing` is the defender's LOGICAL heading - a sign-vector {x, z} combat
// writes at two well-defined moments (when the unit attacks, and when it
// moves). Never the actor's visual yaw: that is an eased tween, usually
// mid-interpolation and frame-rate dependent, and a damage-affecting rule
// cannot hang off a cosmetic value (TACTICS_PLAN #5).
//
// A unit that has never acted has NO facing and is never backstabbed. That is
// deliberate: a stale or invented heading would hand out a free bonus for
// standing in the right spot at the start of a fight.
export function isBackstab(ax, az, dx, dz, facing) {
  if (!facing) return false;
  const fx = Math.sign(facing.x || 0);
  const fz = Math.sign(facing.z || 0);
  if (fx === 0 && fz === 0) return false;
  const sx = Math.sign(ax - dx);
  const sz = Math.sign(az - dz);
  if (sx === 0 && sz === 0) return false; // standing on them - no angle at all
  return (sx * fx + sz * fz) < 0; // negative dot: the attacker is in the rear arc
}

// The signed positional term for one attack, and the flags the UI explains it
// with. Cover is DEFENDER-favouring (negative); flanking and backstab are
// attacker-favouring (positive) and share one cap.
//
// The two are deliberately complementary: cover is RANGED-only (a cubicle wall
// is no help once someone is swinging at you from the next tile) and flanking
// is MELEE-only (a pincer means bodies, not angles). Surprise is not capped
// here - it rides the accuracy term in toHitTerms - but hitChance's CLAMP_HI
// still bounds everything, so nothing becomes a guaranteed hit.
export function positionMods(ax, az, dx, dz, opts = {}) {
  const { edgeOpen = null, allies = [], facing = null } = opts;
  const melee = cheb(ax, az, dx, dz) <= 1;
  const covered = !melee && hasCover(ax, az, dx, dz, edgeOpen);
  const flanked = melee && isFlanked(ax, az, dx, dz, allies);
  // Backstab is range-agnostic: shooting someone in the back counts, which is
  // also why it can coexist with the defender's cover - the cap and
  // hitChance's CLAMP_HI keep the stack honest.
  const behind = isBackstab(ax, az, dx, dz, facing);
  const positive = Math.min(
    HIT.POSITION_CAP,
    (flanked ? HIT.FLANK_ACC_BONUS : 0) + (behind ? HIT.BACKSTAB_ACC_BONUS : 0),
  );
  return {
    positional: positive - (covered ? HIT.COVER_DODGE : 0),
    covered,
    flanked,
    behind,
  };
}
