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
import { HIT, REACH } from './stats.js';

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

// Chebyshev distance: a diagonal costs the same as an orthogonal. Still the
// right model for AREAS - which cells a blast or a summon placement covers -
// but no longer how reach is measured (see inReach below).
export const cheb = (ax, az, bx, bz) => Math.max(Math.abs(ax - bx), Math.abs(az - bz));

// --- reach (TACTICS_PLAN "Revision - reach is a DISTANCE") -------------------

// True distance between two continuous positions. Reach measures in this, not
// in tiles: bodies live at continuous positions and the logical tile is only
// Math.round of one, so a tile test can be off by up to 2.83 units.
export const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

const SWEEP = 0.1; // segment sampling step for reachOpen, in tile-units

// Is the straight line from (ax, az) to (bx, bz) free of solid edges? An arm
// travels in a straight line, so this walks the segment and demands an open
// edge at every tile boundary it crosses.
//
// Deliberately NOT `stepOpen`. That test's diagonal rule requires all four
// edges around the crossed corner so a BODY cannot slip past a partition's end
// - correct for movement, wrong for arms: reaching diagonally around the end of
// a cubicle wall is a legitimate swing. Here a diagonal crossing (both axes
// changing in one sample) passes if EITHER L-path around the corner is open,
// which is the same permissiveness hasCover uses.
//
// Inert without an edge test (returns true), so a caller that hasn't wired one
// gets pure distance rather than an exception - the shape hasCover uses.
export function reachOpen(ax, az, bx, bz, edgeOpen) {
  if (typeof edgeOpen !== 'function') return true;
  const d = dist(ax, az, bx, bz);
  if (d < 1e-9) return true;
  const steps = Math.ceil(d / SWEEP);
  let cx = Math.round(ax);
  let cz = Math.round(az);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const nx = Math.round(ax + (bx - ax) * t);
    const nz = Math.round(az + (bz - az) * t);
    if (nx === cx && nz === cz) continue;
    if (nx !== cx && nz !== cz) {
      // Corner crossing: either way around is a legal swing.
      const viaX = edgeOpen(cx, cz, nx, cz) && edgeOpen(nx, cz, nx, nz);
      const viaZ = edgeOpen(cx, cz, cx, nz) && edgeOpen(cx, nz, nx, nz);
      if (!viaX && !viaZ) return false;
    } else if (!edgeOpen(cx, cz, nx, nz)) {
      return false;
    }
    cx = nx;
    cz = nz;
  }
  return true;
}

// Can something at (ax, az) with reach `r` touch (bx, bz)? Distance within
// reach AND nothing solid in the way. The one predicate every melee site reads
// - swings, shoves, opportunity attacks, and the melee/ranged split in
// positionMods - so reach means one thing everywhere.
export function inReach(ax, az, bx, bz, r, edgeOpen = null) {
  if (dist(ax, az, bx, bz) > r) return false;
  return reachOpen(ax, az, bx, bz, edgeOpen);
}

// A unit threatens wherever it could swing: the same reach test an actual
// attack uses. Everyone can threaten - since EQUIPMENT_PLAN M3 every combatant
// has a basic melee swing (its weapon's, or a punch) - so this needs no
// per-unit capability check, only a reach.
//
// Threat used to be the eight surrounding TILES. Reading it off `inReach`
// instead is what makes an opportunity attack agree with the swing it becomes:
// a unit can no longer threaten a spot it would be unable to hit, and a long
// weapon zones the ground its own reach covers rather than a fixed ring.
export const threatens = (tx, tz, x, z, reach, edgeOpen = null) =>
  inReach(tx, tz, x, z, reach, edgeOpen);

// Which of `threats` a move from (fx, fz) to (tx, tz) provokes: those whose
// reach covered the point being LEFT and no longer covers the point being
// ENTERED. Comparing threat SETS rather than raw proximity is what keeps a unit
// circling a foe - sliding around inside its reach - from provoking, and stops
// a shuffle past someone from double-firing.
//
// The set-diff was an APPROXIMATION of "are you still in reach" while reach was
// a tile ring; now that reach is a radius it is that question exactly, so the
// circling case holds for a reason rather than by construction.
//
// Pure: `threats` is any list of things carrying x/z plus their own `reach`
// (they differ - a long weapon zones further), and eligibility (alive, aware,
// still holding a reaction) is the caller's filter, not this rule's.
export function provokedBy(threats, fx, fz, tx, tz, edgeOpen = null) {
  if (dist(fx, fz, tx, tz) < 1e-9) return []; // standing still is not leaving
  return (threats || []).filter((t) => {
    // A threat that forgot to state its reach would otherwise compare against
    // `undefined`, and every NaN comparison is false - so it would threaten
    // EVERYWHERE and therefore provoke nowhere. Silent, and exactly backwards.
    const r = t.reach ?? REACH.DEFAULT;
    return threatens(t.x, t.z, fx, fz, r, edgeOpen)
      && !threatens(t.x, t.z, tx, tz, r, edgeOpen);
  });
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
// `coverCell(x, z)` (POWERS_PLAN M7) reports a CELL that shields - a toppled
// bookcase lying on the carpet. Cover was edge-only because every cover in the
// game was an edge; a fallen prop occupies a cell, so the same two faces get
// asked a second question.
//
// The tempting alternative was to mark fallen props `solid: true` so stepOpen
// reported them and this needed no change - but that is exactly the
// impassable-terrain-on-demand the design refused (seal a doorway, strand the
// fight). An extra predicate is the smaller and more honest cost.
//
// The "at most once per attack" rule survives: an edge AND a cell on the same
// face still grant one cover, because this returns on the first hit.
export function hasCover(ax, az, dx, dz, edgeOpen, coverCell = null) {
  const edges = typeof edgeOpen === 'function';
  const cells = typeof coverCell === 'function';
  if (!edges && !cells) return false;
  const sx = Math.sign(ax - dx);
  const sz = Math.sign(az - dz);
  // Each axis is checked as its own orthogonal face. A diagonal attacker is
  // blocked by either face - going around one corner is enough.
  if (sx !== 0 && edges && !edgeOpen(dx, dz, dx + sx, dz)) return true;
  if (sz !== 0 && edges && !edgeOpen(dx, dz, dx, dz + sz)) return true;
  if (sx !== 0 && cells && coverCell(dx + sx, dz)) return true;
  if (sz !== 0 && cells && coverCell(dx, dz + sz)) return true;
  return false;
}

// --- take cover (TACTICS_PLAN M6) ---------------------------------------------

// Does a crouch behind the shield CELL (sx, sz) protect the defender at
// (dx, dz) from a shot fired from (ax, az)?
//
// The same octant question hasCover asks of a face, asked of the ONE cell the
// defender committed to: the shield must sit on an orthogonal face of the
// defender's tile pointing attackward. Deliberately not "any adjacent cover"
// - crouching is a commitment to one object, and which sides that object
// covers is what makes flanking the counter (designer: "only the direction
// it blocks, flanking still works").
//
// Like hasCover's diagonal rule, a diagonal attacker is shielded if the cell
// sits on EITHER of the two faces pointing their way - the shot has to clear
// the object's corner no matter which axis it favours.
export function crouchShields(ax, az, dx, dz, sx, sz) {
  const ox = Math.sign(ax - dx);
  const oz = Math.sign(az - dz);
  if (ox === 0 && oz === 0) return false; // standing on them - no angle at all
  return (ox !== 0 && sx === dx + ox && sz === dz)
    || (oz !== 0 && sx === dx && sz === dz + oz);
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
    cheb(a.x, a.z, dx, dz) <= 1            // must be in its face, not lobbing from afar
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
//
// `ax/az/dx/dz` are TILE coordinates: a cover face and an exactly-opposite
// pincer are genuinely grid-shaped, and octant signs are the honest way to ask
// them. Only `melee` moved to real distance - the caller decides it, because
// only the caller knows the attacker's reach (TACTICS_PLAN revision). It
// defaults to the old tile rule so a caller that hasn't been updated behaves
// exactly as before.
export function positionMods(ax, az, dx, dz, opts = {}) {
  const { edgeOpen = null, allies = [], facing = null, coverCell = null } = opts;
  const melee = opts.melee ?? (cheb(ax, az, dx, dz) <= 1);
  const covered = !melee && hasCover(ax, az, dx, dz, edgeOpen, coverCell);
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
