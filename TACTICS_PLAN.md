# Tactical Positioning Plan

Make *where you stand* matter. Today the hit roll is a two-body problem —
attacker accuracy vs defender dodge — and the eight tiles around a combatant
are worth exactly as much as the eight tiles across the room. Leaving melee is
free, so kiting is strictly dominant and melee enemies are toothless.
Partitions block bodies but grant no combat advantage. Facing is decoration.
This document is the implementation plan for four positional systems —
opportunity attacks, cover, flanking, backstab — the design decisions, the
module-by-module changes, and the milestone order. No code yet.

It follows the shape of `PROGRESSION_PLAN.md` / `HIT_PLAN.md`, and honors the
one rule from `ARCHITECTURE.md`: **content is data, code is systems.** The
positional rules are pure geometry over coordinates the engine already tracks;
their magnitudes live in one tunable constants block; nothing here needs a new
content registry.

**Sequencing note (the combat plans):** this is the fourth, and it lands on
top of the three that shipped. It needs `HIT_PLAN.md`'s roll (there is nothing
to modify without one), reuses `STATUS_PLAN.md`'s registry for the
unaware-unit rule, and reuses `EQUIPMENT_PLAN.md`'s basic weapon swing as the
opportunity attack itself. All three are landed, so this plan has no unmet
dependencies. Order: HIT → STATUS → EQUIPMENT → **TACTICS**.

**The load-bearing discovery:** `HIT_PLAN` already built the extension point
all of this rides on. `hitChance(acc, dge, mods)` takes a third term, and
**nothing in the game passes it** — every call site leaves it at 0. Three of
these four features are that parameter finally earning its keep. The fourth
(opportunity attacks) is the only genuinely new mechanism in the plan.

## Where we are today

- **`mods` is plumbed and unused.** `stats.hitChance(acc, dge, mods = 0)` is
  pure, unit-tested, and clamped. `combat.resolveHit(accFrac, dodgeFrac, mods
  = 0)` forwards it. No caller has ever supplied a non-zero value.
- **Four roll sites assemble accuracy by hand.** The hover preview
  (`handleHover`, ~L233), the melee/single-target swing (`performOn`, ~L555),
  the cone (`fireCone`, ~L614), and the enemy's swing (`aiAttack`, ~L991) each
  independently sum `accuracy(sheet) + surprise + statusFx().accMod` and
  `dodge + statusFx().dodgeMod`. **The hover preview and the real roll are
  separate arithmetic** — the on-screen "72% to hit" is a *reimplementation*
  of the roll, not a read of it. Any term added to one and not the other makes
  the UI lie.
- **Leaving melee is free.** `walkActive` smooths a route, charges the whole
  cost up front via `truncateByBudget`, calls `actor.setPath(points)`, and
  returns. The actor then walks it across many frames. Nothing watches
  adjacency; nothing can interrupt.
- **Movement is continuous, not hop-by-hop.** Paths are smoothed any-angle
  waypoint lists at a continuous position; the logical tile is *derived* from
  that position. Per-tile reactions already have a home: `GridActor.update(dt,
  onTile)` fires `onTile(x, z, pathDone, changed)` on each tile entered, which
  `main.js` routes to `onMemberStep` / `onSummonStep` (and `EnemyActor` walks
  its own).
- **Partitions are edges, and they already mean "something solid."**
  `grid.js` stores them as `hWalls`/`vWalls` edge sets. `stepOpen(x,z,nx,nz)`
  is false across a partition (and a wall, and a closed door), and **combat
  already reads it that way** — the shove's wall-slam is `!world.isWalkable(tx,
  tz) || !world.stepOpen(en.x, en.z, tx, tz)`, commented "A partition between
  the tiles counts as 'something solid' too." `stepOpen` is already threaded
  into the `world` façade combat receives.
- **Partitions deliberately do *not* block sight.** `sightOpen` tests doors
  only — throws sail over chest-high cubicle walls by design. So a partition
  is currently a pure movement obstacle with zero tactical upside, which is
  exactly the gap cover fills: it shouldn't stop the throw, it should spoil it.
- **Facing is cosmetic.** `faceToward(tx, tz)` sets `targetYaw`; `easeYaw`
  eases `yaw` toward it at `TURN_RATE` every frame. There is no logical facing
  anywhere — the only "direction" a unit has is a visual angle that is
  usually mid-interpolation.
- **Everyone has a basic melee swing.** Since `EQUIPMENT_PLAN` M3,
  `equippedAction(sheet)` always returns an action id (the weapon's, or
  `punch`). Every member can therefore *threaten* a tile without new content.

## What we're building

1. **Opportunity attacks.** Leaving a tile threatened by a living, aware
   enemy provokes one free swing from it. Melee stops being a suggestion.
2. **Cover.** A solid edge (partition, wall, closed door) between a defender
   and a *ranged* attacker cuts the attacker's hit chance. Partitions become a
   tactical object instead of a throw-wall.
3. **Flanking.** A defender sandwiched between two hostiles is easier to hit.
4. **Backstab.** Attacking a defender from behind its logical facing is easier
   still.

Cover, flanking, and backstab are *the same feature* wearing three hats: each
is a term in `mods`. Opportunity attacks are the only new mechanism.

## Design decisions (recommended, with alternatives considered)

**#1 — One `attackMods()` assembler; the hover preview reads it too.**
A single pure-ish helper returns the full `{acc, dodge, mods}` triple for an
(attacker, defender) pair, and all four sites call it. The hover preview
becomes a *read of the same math the roll uses*, permanently.
*Alternative:* add the new terms at each site. **Rejected** — four hand-rolled
sums that must stay in lockstep is how the displayed percentage starts lying.
This refactor is worth doing even if we shipped none of the four features.

**#2 — Cover reuses `world.stepOpen`; no new geometry, no new plumbing.**
A solid edge between the defender and the attacker's direction of approach is
cover. `stepOpen` already answers exactly that question and is already on the
`world` façade.
*Alternative:* export `wallEdgeOpen` from `grid.js` for a partition-only test
(a partition could be derived as `!edgeOpen && sightOpen`). **Rejected as
unnecessary** — and treating walls and closed doors as cover too is *correct*,
not a compromise. Peeking around a doorframe should work.

**#3 — Cover applies to ranged attacks only.**
A cubicle wall between you and a thrown stapler matters; it does nothing when
someone is already swinging at you from the adjacent tile. Melee (Chebyshev
distance 1) ignores cover. This also neatly prevents cover from blunting the
opportunity attacks of milestone 2.

**#4 — All positional terms are per-*pair*, computed at roll time.**
Cover is not a property of the defender (it depends on where the shot comes
from); flanking is not a property of the attacker. They live in `attackMods
(attacker, defender)` and nowhere else — never cached on a unit, never
persisted.

**#5 — Facing is logical, derived from actions — never the visual yaw.**
A new transient `facing` (a unit vector / octant) is set at two well-defined
moments: when a unit **attacks** (it faces its target) and when a unit
**finishes a move** (it faces its heading). Backstab reads only that.
*Alternative:* read the eased `yaw` off the actor. **Rejected** — it is
frame-rate dependent, usually mid-interpolation, tied to PlayCanvas, and
untestable. A damage-affecting rule cannot hang off a cosmetic tween.

**#6 — None of this touches persistence.** Facing, threat, and reaction
budgets are all *in-fight* state on the combat unit, and combat is never saved
mid-fight (`party.js` serializes sheets between levels). **No `SAVE_VERSION`
bump, no migration.** This is the cheapest kind of feature the codebase
supports, and worth stating plainly so nobody reaches for the save format.

**#7 — Flanking is a true pincer (opposite sides), not a headcount.**
The defender is flanked when another hostile stands on the *opposite* side —
the direction from defender to ally is the negation of the direction from
defender to attacker. It matches the mental model ("sandwiched", "cornered")
and it's legible on screen.
*Alternative:* "2+ hostiles adjacent." **Rejected** — cheaper, but it makes a
crowd of enemies bunched on one flank read as a pincer, and it rewards
clumping over positioning, which is the opposite of the point.

**#8 — One reaction per unit per round, and an opportunity attack does NOT
stop the walk.** The mover takes the hit and keeps going (D&D's rule).
*Alternative:* halt movement on a provoked hit. **Rejected on mechanics** —
`walkActive` deducts the *entire* path cost up front, so halting means
computing the unwalked remainder and refunding it mid-stride. That is a real
change to the movement engine for a marginal rule.

**#9 — Forced movement never provokes.** A shove (`pushTo`/`slideTo`) is not
the target's choice, so it draws no opportunity attack. **This is what makes
shove the safe way to break contact** — the shove-into-hazard combo gains a
second job as the disengage tool, with no new action and no new content.

**#10 — Unaware units don't get reactions.** `surprised` and `stunned` units
never take opportunity attacks. Reuses `STATUS_PLAN`'s registry, and gives
surprise a third job (it already grants the attacker accuracy and burns the
victim's turn).

**#11 — Everything is symmetric.** Enemies flank, take cover, backstab, and
punish disengages. That is the entire point: it is what gives melee enemies
teeth.

**#12 — Positional bonuses are capped in aggregate.** Surprise + flank +
backstab must not become a guaranteed hit. One `POSITION_CAP` bounds the sum
of the positive positional terms before `hitChance`'s own `CLAMP_HI` applies.

## The data

One extension to the existing `HIT` constants block in `stats.js` — the same
place `BASE`, `STEP`, `CLAMP_LO/HI` and `SURPRISE_ACC_BONUS` already live:

```
COVER_DODGE:        0.20  // a solid edge between you and a ranged attacker
FLANK_ACC_BONUS:    0.15  // a pincer: hostiles on exactly opposite sides
BACKSTAB_ACC_BONUS: 0.20  // struck from behind its facing
POSITION_CAP:       0.35  // ceiling on the summed positive positional terms
```

*As landed:* the four hit-chance magnitudes live in `stats.HIT` beside `BASE`
and the clamps. The reaction economy is not a to-hit number, so it lives with
the rule that owns it — `tactics.TACTICS.REACTIONS_PER_ROUND` (= 1).

One deviation from the sketch above: **surprise is not inside the cap.** It
rides the accuracy term in `toHitTerms` (where `HIT_PLAN` put it), and folding
it in would have churned the seam M1 had just proved behavior-neutral.
`hitChance`'s `CLAMP_HI` still bounds the total, so nothing becomes a
guaranteed hit.

Numbers are first drafts, deliberately deferred to playtest like the other
three plans. No new items, actions, statuses, or enemies are required — an
opportunity attack reuses the attacker's existing basic swing
(`equippedAction` for members, a random `def.attacks` entry for enemies) at
**zero AP**.

## The math

```
mods = − cover(attacker, defender)        // ranged only, defender-favouring
     + min(POSITION_CAP, flank + backstab + surprise)
chance = clamp(BASE + accuracy(attacker) − dodge(defender) + mods)
```

Cover is subtracted *outside* the cap: a positive-term ceiling must not let a
stack of bonuses erase the defender's cover.

## Architecture: where it lands

### Pure modules (unit-tested)

- **`src/tactics.js` (new).** The whole geometry layer as pure functions over
  plain coordinates, with edge-tests passed in as callbacks so nothing imports
  PlayCanvas or the grid:
  - `dirBetween(ax, az, bx, bz)` → normalized octant vector
  - `hasCover(ax, az, dx, dz, stepOpen)` → solid edge shielding the defender
  - `isFlanked(attacker, defender, allies)` → the opposite-sides pincer test
  - `isBackstab(attacker, defender)` → attacker outside the defender's facing arc
  - `positionMods(...)` → the assembled, capped `mods` number
  - `threatens(unit, x, z)` / `provokes(from, to, threats)` → the OA predicates
- **`src/stats.js`.** The `HIT` block gains the constants above. `hitChance`
  is unchanged — it already accepts `mods`.

### PlayCanvas / DOM modules

- **`src/combat.js`.** The bulk of the work, all of it consolidation:
  - `attackMods(attacker, defender, { ranged })` — the single assembler; the
    four roll sites collapse into it.
  - A per-unit transient `facing`, written in `performOn`/`aiAttack` (face the
    target) and on path completion (face the heading).
  - A per-unit `reactions` counter, refilled on the round wrap that already
    fires `callbacks.onRound`.
  - `notifyStep(unit, x, z)` — combat remembers each unit's previous tile,
    diffs the threat set, and resolves any provoked swings.
- **`src/main.js`.** Routes the existing per-tile hooks into `notifyStep`
  (`onMemberStep`, `onSummonStep`, and the enemy walk). **No new `world`
  methods** — `stepOpen` is already there.
- **`src/ui.js`.** The hover tag grows a reason string ("72% — in cover",
  "90% — flanked") so the player can *see* why a number moved. Without this,
  positional modifiers are invisible and read as randomness.

### Persistence

None. See decision #6.

## Milestones (each a PR that keeps `npm test` + e2e green)

1. **The mods seam, behavior-preserved.** ✅ Landed. `src/tactics.js` owns
   `toHitTerms()`, the one place the terms are summed; combat grew
   `attackMods` / `chanceFor` / `rollAgainst`, and all four sites collapsed
   into them. Three accessors (`statusesOf`/`accuracyOf`/`dodgeOf`) absorb the
   member-vs-unit shape difference, so the AI's swing runs the *same*
   assembler with the roles reversed — which is what makes the later terms
   symmetric for free. **Zero gameplay change**, verified by the full 14-spec
   e2e suite (48 passed) plus 8 new unit tests. The AI path picked up a
   surprise term it lacked, which is inert: `surprised` is only ever applied
   to enemies and *enemy-team* summons, never to a member sheet.
2. **Opportunity attacks.** ✅ Landed. `combat.notifyStep(ref, x, z)` is the
   seam; main.js reports member/summon steps from the per-tile hooks it
   already owned, and combat calls it for enemies from the `onTile` hook
   `aiAdvance` already installed — no new movement engine. One reaction per
   unit per round (cleared in `newRound`), unaware units don't react, and the
   walk is never interrupted. **Forced movement is exempt by construction, not
   by a special case:** `pushTo` sets the logical tile and glides the body,
   and `GridActor.update` early-returns on `slideTo`, so a shove never fires
   the hook at all — shove is the safe disengage, as designed (#9). Also split
   `unitStrikesMember` out of `aiAttack` so a reaction lands by identical
   rules (soak, Deflect, applied status, downed/handoff/party-wipe) rather
   than reimplementing them; rng call order unchanged.
   - **Gotcha worth remembering:** combat wraps `party.members` into *new*
     objects, so main.js's member is not combat's member. Step reports resolve
     through the shared `actor` (`combatantFor`) — keying the bookkeeping on
     the member object would have silently no-op'd for the player.
3. **Cover.** ✅ Landed. `tactics.hasCover` + `positionMods`, wired into
   `attackMods` — one edit, and because M1 consolidated the seam it reached
   the hover preview, the melee swing, the cone and the AI's swing at once.
   Ranged-only (`cheb > 1`), boolean so a corner nook can't stack, and it
   reuses `world.stepOpen` exactly as the shove's wall-slam does, so walls and
   closed doors grant cover too. The hover tag now says "— in cover", because
   a modifier the player can't see reads as randomness.
4. **Flanking.** ✅ Landed. `tactics.isFlanked` — a true pincer (an ally on the
   *exactly* opposite side), melee-only, symmetric for both sides. Cover and
   flanking end up cleanly complementary: cover is ranged-only, flanking
   melee-only, so no single attack can claim both. `positionMods` grew an
   options object (`{ edgeOpen, allies, facing }`) here.
5. **Backstab.** ✅ Landed. A transient logical `facing` per combatant, written
   at exactly two moments — when a unit **attacks** (it faces its target) and
   when it **moves** (it faces its heading) — plus `tactics.isBackstab`, a
   negative-dot-product rear-arc test. Range-agnostic (shooting someone in the
   back counts), so it can coexist with the defender's cover; the shared
   `POSITION_CAP` and `hitChance`'s `CLAMP_HI` keep the stack honest. A unit
   that has never acted has no facing and cannot be backstabbed — the honest
   resolution of the open question, and one that can't be gamed.

Milestones 1 and 2 are independent and may be swapped; 3–5 all depend on 1.

### Verification as landed

- **Unit:** 193 passing, of which ~40 are `tests/unit/tactics.test.js` —
  assembler arithmetic, threat/provoke set-diffing, cover geometry (orthogonal,
  diagonal, far-side, corner, missing-edge-test), the pincer (including the
  "crowd on one flank is not a sandwich" case), and every backstab arc
  boundary.
- **e2e:** `tests/e2e/tactics.spec.js` — an opportunity attack fires on
  disengage, *circling* fires nothing, a shove fires nothing, a partition
  costs a ranged attacker exactly `COVER_DODGE` (with the tag reading "in
  cover"), and stepping across a foe that has committed its facing reads
  "from behind".
- **Regression:** the full 14-spec suite passed unchanged after M1 (48/48) and
  again after M5.
- **Not covered by e2e:** flanking. Getting a party member positioned exactly
  opposite a foe needs a multi-step recruit dialogue and companions follow the
  leader rather than taking orders, so a browser test would be flaky for
  little gain — the geometry has direct unit coverage and rides the same
  `attackMods` wiring cover already proves in-browser.

## Testing

- **Unit (`tests/unit/tactics.test.js`, new).** Cover geometry (orthogonal and
  diagonal approaches; a partition on the *far* side grants nothing; walls and
  closed doors count); the pincer test (opposite sides yes, same side no,
  diagonal pincers); backstab arcs at each octant boundary; `positionMods`
  capping; `provokes` (adjacent→adjacent doesn't fire, adjacent→away does).
- **Unit (`tests/unit/stats.test.js`).** The new `HIT` constants are
  well-formed and `POSITION_CAP` bounds the sum.
- **e2e.** Walk out of an adjacent Manager's reach with `forceHit` pinned and
  watch HP drop (and *not* drop when shoved out — decision #9); hover a foe
  across a partition and read a lower percentage than in the open; flank with a
  companion and read a higher one.
- **Regression invariant.** After milestone 1 every existing spec passes
  unchanged.

## Risks and open questions

- **The hover preview is a second implementation.** It is the single most
  likely source of "the game lied to me" bugs, and it is why milestone 1 leads.
- **Continuous movement and tile-granular reactions.** A fast unit rounding a
  corner can leave and re-enter a threatened tile within a few frames. The
  one-reaction-per-round budget bounds the damage, but the provoke test must
  compare *threat sets*, not raw adjacency, or a diagonal slide past a foe can
  double-fire.
- **Player-side opportunity attacks look like bugs.** Your character swings
  without being told to. It needs an unmistakable log line and probably the
  existing lunge fx, or players will file it as a glitch.
- **Corner-camping cover.** A unit tucked into a partition corner could claim
  cover from most angles. Cover is capped at one application per attack;
  whether corner tiles are *too* strong is a playtest question.
- **Backstab against a stationary defender.** A unit that has neither moved nor
  attacked has a stale facing. Options: face the nearest hostile on turn start,
  or treat "never acted" as facing-agnostic (no backstab). Leaning toward the
  latter — it's honest and it can't be gamed.
- **Numbers.** As with all three prior plans, the constants are first drafts;
  the cross-cutting balance pass is deferred to playtest.
