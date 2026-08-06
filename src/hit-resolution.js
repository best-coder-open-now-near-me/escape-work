// DOES IT LAND, AND WHAT DOES THAT LOOK LIKE.
//
// A slice off `startCombat` (Q037), and the first from this file chosen on STATE
// OWNERSHIP rather than on adapter-thinness: `forceHit`, `forceProc` and
// `lastRoll` are three of the closure's mutable variables, and this cluster is
// the only thing that writes them. They are locals in here now, reached from
// outside through the accessors below - which is what the debug surface
// (`window.__combat.forceHit`) was already doing through a getter/setter pair.
//
// The pins are the reason the e2e suite can talk about combat at all: `forceHit`
// true forces every roll to hit, false forces a miss, null rolls honestly, and
// `lastRoll` records what the last roll actually decided. A tester slams hit
// rates live with the same affordance the god panel gives other state.
//
// `stepCost` sits here rather than with movement because it is priced off the
// SAME two questions this file answers - what the floor is, and what the mover
// is wearing - and splitting it from `surfaceStepCost` would put one
// multiplication in a different file from the other two.
import { toHitTerms, positionMods, inReach, dist, shieldedFaces, shieldingFace } from './tactics.js';
import { accuracy, dodge, hitChance, moveCostOf, HIT, MOVE } from './stats.js';
import { formatHitFormula, formatProcFormula } from './combat-formulas.js';
import { statusFx, hasStatus } from './statuses.js';
import { SURFACES } from './data/surfaces.js';
import { blocksSight, shieldsCell } from './data/tiles.js';
import { impactKindFor } from './step-rules.js';
import { canReach as canReachAt, reachOfUnit, withinReach } from './combat-geometry.js';

// The colour a miss is written in. Exported because the five other places that
// print one live in combat.js, and a shared constant is better shared than
// re-typed.
export const MISS_COLOR = '#b8c0d0';

export function createHitResolution(d) {
  // A debug/test pin (exposed as window.__combat.forceHit): true forces every
  // roll to hit, false forces a miss, null (the default) rolls honestly. It
  // lets the e2e suite make combat deterministic and a tester slam hit rates
  // live - the same "pin a value" affordance the god panel gives other state.
  let forceHit = null;
  let forceProc = null; // pin for the weapon on-hit proc roll (debug/e2e)
  let lastRoll = null; // { chance, hit } of the most recent attack roll (debug/e2e)
  // One attack roll (HIT_PLAN.md): base + attacker accuracy - defender dodge +
  // mods, rolled against combat's injectable `rng` (unless pinned above). The
  // computed chance and outcome are stashed on `lastRoll` for the debug surface.
  const resolveHit = (accFrac, dodgeFrac, mods = 0, meta = null) => {
    const chance = hitChance(accFrac, dodgeFrac, mods);
    // Capture the exact draw instead of asking rollHit to hide it. This is the
    // same comparison and consumes the same single RNG value; it merely lets
    // the dialogue show the number the resolver actually judged.
    const draw = forceHit === null ? d.rng() : null;
    const hit = forceHit !== null ? forceHit : draw < chance;
    lastRoll = { chance, hit, roll: draw, forced: forceHit };
    if (meta && d.formula) {
      d.formula(formatHitFormula({
        attacker: meta.attacker,
        target: meta.target,
        base: HIT.BASE,
        accuracy: accFrac,
        dodge: dodgeFrac,
        position: mods,
        clampLow: HIT.CLAMP_LO,
        clampHigh: HIT.CLAMP_HI,
        chance,
        roll: draw,
        forced: forceHit,
        hit,
      }));
    }
    return hit;
  };
  // A combatant here is either a party-side MEMBER ({ sheet, actor, ap }) or
  // an AI UNIT (an actor carrying `def`). These three accessors are the only
  // place that difference matters, which lets the roll math below stay
  // uniform - and lets an enemy and a member be attacker or defender
  // interchangeably. Statuses live on a member's sheet, but on a unit itself.
  const statusesOf = (u) => u.sheet || u;
  const accuracyOf = (u) => (u.sheet ? accuracy(u.sheet) : (u.combat?.accuracy || 0));
  const dodgeOf = (u) => (u.sheet ? dodge(u.sheet) : (u.combat?.dodge || 0));
  // Reach joins them - but as hoisted FUNCTION declarations, not the const
  // arrows the three above use. pickTarget is called eagerly during
  // startCombat (the surprise sweep, well before this point in the body), and
  // it now needs canReach: a const here would sit in its temporal dead zone
  // and throw ReferenceError mid-setup, starting a fight whose panel never
  // gets built. Functions hoist, so call order stops mattering.

  // Reach, position and the melee predicate all live in combat-geometry.js
  // now; this binds the world's edge test so every call site keeps asking the
  // one-argument question it always asked. Still a hoisted `function` for the
  // reason above - the surprise sweep reaches it before this line runs.
  function canReach(attacker, defender, r = null) {
    return canReachAt(attacker, defender, r, d.world.stepOpen);
  }

  // The to-hit terms for one attacker/defender pair (TACTICS_PLAN #1). THE
  // single place the terms are assembled: every roll site and the hover
  // preview read it, so the percentage the player sees is always the
  // arithmetic the roll actually uses. `positional` (cover/flank/backstab)
  // plugs in here in later milestones and reaches all four sites at once.
  // `plan` (optional) is a continuous point the attacker WOULD act from - the
  // walk-in preview's planned stand point. The odds it shows must be priced
  // from where the swing will actually happen: cover, flank and the
  // melee/ranged split all move with the attacker, and a percentage computed
  // from the tile being LEFT is a lie about the attack being promised.
  // Targeted ranges and sight measure body to body (DEGRID D4/D6): a range is
  // a true-distance circle from where the model actually stands, and a line
  // is traced between the stances - not between the tile centres their
  // positions round to. Authored grid objects remain tile targets; zones and
  // summons retain their exact ground aim points.
  const bodyDist = (u, v) => {
    const a = d.posOf(u);
    const b = d.posOf(v);
    return dist(a.x, a.z, b.x, b.z);
  };
  const bodyLos = (u, v) => {
    const a = d.posOf(u);
    const b = d.posOf(v);
    return d.world.hasLos(a.x, a.z, b.x, b.z);
  };
  const distToTile = (u, tx, tz) => {
    const a = d.posOf(u);
    return dist(a.x, a.z, tx, tz);
  };
  const losToTile = (u, tx, tz) => {
    const a = d.posOf(u);
    return d.world.hasLos(a.x, a.z, tx, tz);
  };
  const attackMods = (attacker, defender, plan = null) => {
    // Position is a per-PAIR term - it depends on where the other one stands,
    // so it is computed at roll time and never cached on a unit.
    //
    // The BODIES, not their rounded tiles (DEGRID M4): cover, flank and
    // backstab used to flip when a body drifted across a tile's invisible
    // midline; the octants now bucket the real angle between the stances
    // (tactics.dirOctant), so they flip where the model visibly changes
    // sides. The cover faces still belong to the defender's tile - the
    // furniture is genuinely grid-shaped (positionMods rounds internally).
    const A = plan ? { x: plan.x, z: plan.z } : d.posOf(attacker);
    const D = d.posOf(defender);
    const dp = plan ? d.posOf(defender) : null;
    // The attacker's own side, minus itself: a pincer needs a second body -
    // each carrying its own reach, because "in its face" is now the same
    // reach test every other melee rule reads.
    // Same rule as `threatsAgainst`: an attacker's own side is the LIVE side,
    // so a charmed coworker completes the player's pincer rather than the
    // enemy's - it is swinging for the player this turn.
    const allies = (attacker.sheet ? d.members : d.aiAllies())
      .filter((u) => u !== attacker && d.standing(u))
      .map((u) => ({ x: d.posOf(u).x, z: d.posOf(u).z, reach: reachOfUnit(u) }));
    const pos = positionMods(A.x, A.z, D.x, D.z, {
      // The melee/ranged SPLIT reads reach without the line test so turning
      // walls on (M3) can't silently change who gets cover.
      melee: plan
        ? inReach(plan.x, plan.z, dp.x, dp.z, reachOfUnit(attacker))
        : withinReach(attacker, defender),
      edgeOpen: d.world.stepOpen,
      // A toppled prop shields the tile behind it (POWERS_PLAN M7). Note this
      // rides the same `!melee` gate as every other cover: a fallen cabinet
      // spoils SHOTS, not swings, and a melee attacker walks around it. That
      // is deliberate - it makes toppling a specific counter to throwers
      // rather than a universal answer.
      // ...and so does a teammate holding a GUARD stance, because a body
      // planted on the face between you and the shooter is doing exactly what
      // a toppled cabinet does (POWERS_PLAN M5's deferred `guard` mode). This
      // is why the cell predicate was the right shape: "does the thing
      // standing here shield the defender?" answers both without a second
      // mechanism, and it inherits the ranged-only rule and the
      // at-most-once-per-attack rule for free.
      // ...and since TACTICS_PLAN M6a, so does any STANDING solid a shot can
      // pass over: the same height rule that lets the shot sail over a desk
      // (grid.sightOpenCell) says the desk shields whoever crouches behind it.
      // One threshold decides both, so a prop can never block the shot AND
      // grant cover for it.
      coverCell: (x, z) => {
        const def = d.world.tileDefAt(x, z);
        return shieldsCell(def)
          || d.guardStandingAt(x, z, defender);
      },
      allies,
      facing: d.facings.get(defender) || null,
    });
    return {
      ...toHitTerms({
        accuracy: accuracyOf(attacker),
        dodge: dodgeOf(defender),
        surprised: hasStatus(statusesOf(defender), 'surprised'),
        accMod: statusFx(statusesOf(attacker)).accMod || 0,
        dodgeMod: statusFx(statusesOf(defender)).dodgeMod || 0,
        positional: pos.positional,
      }),
      covered: pos.covered, // for the hover tag's reason string
      flanked: pos.flanked,
      behind: pos.behind,
    };
  };
  // (There was a `chanceFor` helper here that claimed to be "what the hover tag
  // reads". Nothing called it - the tag needs the whole term set, not just the
  // number, so it goes through `attackMods` directly like the roll does. A dead
  // helper describing itself as the live one is a trap: the next edit to it
  // would have changed nothing and looked like it changed the preview.)
  // Roll that attack (honors the forceHit pin, records lastRoll).
  const rollAgainst = (attacker, defender) => {
    const t = attackMods(attacker, defender);
    const displayName = (unit) => d.nameOf?.(unit) || unit?.sheet?.name || unit?.def?.name || 'Unknown';
    return resolveHit(t.acc, t.dodge, t.mods, {
      attacker: displayName(attacker),
      target: displayName(defender),
    });
  };
  // A weapon's on-hit proc chance, honoring the debug pin.
  const resolveProc = (chance, meta = {}) => {
    const draw = forceProc === null ? d.rng() : null;
    const hit = forceProc !== null ? forceProc : draw < chance;
    if (d.formula) {
      d.formula(formatProcFormula({
        attacker: meta.attacker || 'Unknown',
        target: meta.target || 'Unknown',
        label: meta.label || 'on-hit effect',
        chance,
        roll: draw,
        forced: forceProc,
        hit,
      }));
    }
    return hit;
  };

  // --- the FX vocabulary ------------------------------------------------------
  // Combat's cosmetics all route through these four, so a swing that lands in
  // three different code paths (a turn attack, an opportunity swing, a cone)
  // looks the same in all of them. Every one of them is fire-and-forget - the
  // fight has already resolved by the time a particle exists (fx.js).
  //
  // Hits land on the BODY, not the tile centre: posOf is the continuous
  // position everything else in this file measures against, and a spark
  // pluming from a tile centre while the model stands half a tile away reads
  // as a miss that dealt damage.
  const hitFx = (target, kind = 'melee', from = null) => {
    const p = d.posOf(target);
    let dir = null;
    if (from) {
      const a = d.posOf(from);
      const dx = p.x - a.x;
      const dz = p.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      dir = { x: dx / len, z: dz / len }; // debris flies away from the attacker
    }
    d.fx.impact(p.x, p.z, kind, { dir });
  };
  // A status landing is worth seeing on the body it landed on - buffs bloom
  // upward off the feet, debuffs fall onto the head (data/statuses.js `fx`).
  const statusFxAt = (carrier, id) => {
    const p = d.posOf(carrier);
    d.fx.status(p.x, p.z, id);
  };
  // Somebody hits the carpet: debris, blood, and the smallest jolt the camera
  // is willing to give a death.
  const deathFx = (target) => {
    const p = d.posOf(target);
    d.fx.impact(p.x, p.z, 'death', { y: 0.7 });
    d.fx.shake(0.07, 0.22);
  };
  // What the floor of a tile throws when it hurts somebody standing on it.
  // One rule, shared with main.js (step-rules.impactKindFor). This copy used to
  // check electrification BEFORE fire - the opposite of main.js's stated
  // precedence - so a burning puddle threw sparks in a fight and flame outside
  // one. It also asked `surfaceIdAt === 'fire'` where main.js asks the runtime
  // whether the tile is burning, which are not the same question.
  const hazardKind = (x, z) => impactKindFor({
    burning: d.world.isBurning(x, z),
    electrified: !!(d.world.isElectrified && d.world.isElectrified(x, z)),
    surface: d.world.surfaceIdAt(x, z),
  }, SURFACES);
  // Movement cost per unit distance, derived from the surface's `slow`
  // multiplier (0.5 => twice the AP) - one number in data drives both walk
  // speed and AP pricing, for everyone. Gum on a shoe surcharges every step;
  // a member's gum lives on their sheet, an AI unit's on the actor (see
  // aiAdvance).
  // AP per tile: the base rate, then the surface's own drag. A `slow` surface
  // multiplies the cost (coffee at slow 0.5 costs double), so terrain bites
  // proportionally harder now that the base is cheaper - which is the point,
  // per MOVEMENT_PLAN #7.
  const surfaceStepCost = (x, z) => {
    const slow = SURFACES[d.world.surfaceIdAt(x, z)]?.slow;
    return MOVE.COST_PER_TILE * (slow ? 1 / slow : 1);
  };
  const stepCost = (x, z) => surfaceStepCost(x, z)
    * (statusFx(d.active.sheet).moveCostMult ?? 1)
    * moveCostOf(d.active.sheet); // footwear (MOVEMENT_PLAN M4)

  return {
    resolveHit,
    statusesOf,
    accuracyOf,
    dodgeOf,
    canReach,
    bodyDist,
    bodyLos,
    distToTile,
    losToTile,
    attackMods,
    rollAgainst,
    resolveProc,
    hitFx,
    statusFxAt,
    deathFx,
    hazardKind,
    surfaceStepCost,
    stepCost,
    get forceHit() { return forceHit; },
    setForceHit: (v) => { forceHit = v == null ? null : !!v; },
    get forceProc() { return forceProc; },
    setForceProc: (v) => { forceProc = v == null ? null : !!v; },
    get lastRoll() { return lastRoll; },
  };
}
