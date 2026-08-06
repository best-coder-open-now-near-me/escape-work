# Tactical Positioning Plan

Make *where you stand* matter. Today the hit roll is a two-body problem —
attacker accuracy vs defender dodge — and the eight tiles around a combatant
are worth exactly as much as the eight tiles across the room. Leaving melee is
free, so kiting is strictly dominant and melee enemies are toothless.
Partitions block bodies but grant no combat advantage. Facing is decoration.
This document records the implementation plan for four positional systems —
opportunity attacks, cover, flanking, backstab — the design decisions, the
module-by-module changes, and the milestone order.

**Implementation status (2026-08-05): shipped.** The positional systems and
later Take Cover milestones are live. This file is the historical
design/ratification record; current behavior lives in the source and
`ARCHITECTURE.md`.

## Questions for the designer (M6 Take Cover)

All five answered. Q1 (height-threshold LOS) and Q3 (any character as a
shield) on 2026-07-29; Q2, Q4 and Q5 ratified as the recommended defaults on
2026-07-30 ("go with your defaults"): attacking does NOT break the crouch
(moving does), enemies take cover in v1, and a human shield takes the
redirected hit rather than negating it. The answers live in the M6 milestone
entry with their tags flipped.

Small defaults picked during implementation, tagged `[proposed]` in M6 and
reversible cheaply if play disagrees: area attacks (cones, zones) and ranged
CONTROLS ignore the crouch; a failed Grit save deals the damage AND keeps the
existing stun alongside the new pin; and shooting a target whose human shield
is one of YOUR OWN refuses rather than rerouting damage into your teammate.

**M8 (destructible cover + Pull Over)** raised its questions live in-session
on 2026-07-30 and every one is answered — the milestone entry carries the
tags. Nothing is waiting on the designer; the `[proposed]` items there are
implementation defaults, each cheap to reverse if play disagrees.

The playtest question is answered too — **partition toppling** `[ratified]`
(2026-07-30, "your defaults seem fine" + the fallen-shape refinement): one
edge segment per shove, falling away from the shover, same Grit
save/damage/pin as furniture. On what a fall LEAVES, the designer set the
rule by height: "i prefer in most cases just having an object on its side vs
a walkable messy space", flat things excepted ("yeah walkable with flat
objects like cubicle wall seems good"). So the chunky fallen twins became
SOLID low objects — reversing POWERS_PLAN's walkable-twin rule, which the
M6a sight change had already hollowed out (a sealed pocket is a shooting
gallery now, not a stalemate) — while the coat rack and the partition panel
stay flat and walkable. See M6's landed notes.

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

## Revision — reach is a DISTANCE, and weapons own it

The milestones below all shipped on one assumption: **melee reach is
`cheb(logical tile) <= 1`.** That assumption is wrong for this engine, and it was
the reason positioning felt loose. **This revision is landed** — all five of its
milestones, see the list below; the sections after it stand as the record of what
the tile-adjacency version shipped.

### The mismatch

`GridActor` is explicit about what a unit's coordinates are: `this.x` is the
*"logical tile — **tracked from** the continuous position"*, and `this.path`
holds *"waypoints — free points, not just centres"*. Bodies live at continuous
positions; the tile is derived. Reach is then tested on the derived value.

That gap is large and unbounded in the wrong direction:

- A **deliberate** approach parks a unit 0.85 tile-units from the target's body
  (`pathfinding.approachPoint`, `reach = 0.85`, clamped to ±0.42 of the tile
  centre). Tight, and exactly right.
- But nothing guarantees a unit arrives that way. `truncateByBudget` *"may end
  mid-segment, so a move can stop at any point when the budget runs dry"*;
  shoves glide via `slideTo`; path endpoints are free points. A unit can rest
  anywhere inside its tile.
- Two units in diagonally adjacent tiles, each near the far corner, are
  `hypot(2, 2)` ≈ **2.83 tile-units** apart — and still `cheb == 1`, still a
  legal swing.

So effective melee reach varies between roughly 0 and 2.83, a **3× swing**,
decided by where somebody's AP happened to run out. That is the "I'm nowhere
near them and still hitting" symptom, and it is a rule defect rather than a
rendering artifact.

**The engine already chose continuous everywhere else.** `truncateByBudget`
charges movement per *unit of distance*, so a diagonal step costs
`1.41 × MOVE.COST_PER_TILE` — while a diagonal attack counts as plain
adjacency. Movement already pays true distance; reach is the one system still
refusing to measure it.

### Genre correction (the premise this plan inherited)

Worth recording, because the surrounding docs cite DOS2 and BG throughout:
**neither is tile-based.** DOS2 has free positioning with movement in metres and
weapon-dependent melee radii; its grid exists for **surfaces** (fire, water,
blood spreading cell to cell). BG3 is a continuous navmesh with 5e ranges in
metres and opportunity attacks on leaving a *radius*. The original BG games are
real-time-with-pause with circular radii.

The grid-based tactical lineage with edge cover is **XCOM** — which is, in fact,
exactly the cover model milestone 3 shipped (boolean, edge-tested, which side of
the defender's tile the attacker is on, applied at most once).

So the codebase currently mixes three lineages: continuous movement (DOS2/BG3),
edge cover (XCOM), and Chebyshev reach (roguelike / grid tactics). The first and
third are the pair that contradict; the cover layer is fine as it stands.

### The second defect: nothing blocks a swing

Not one reach site consults `world.stepOpen`. Combined with the rest of the
blocking model, a partition does **nothing** against melee:

| | vs ranged | vs melee |
| --- | --- | --- |
| Blocks movement | yes (`stepOpen`) | yes |
| Blocks line of sight | **no** — `grid.sightOpen` tests *doors only*, by design (throws sail over chest-high cubicles) | n/a |
| Blocks the attack | no | **no** |
| Grants cover | yes, `COVER_DODGE` | **no** — `positionMods` gates cover to `!melee` |

Each cell is defensible alone; together they mean a cubicle wall costs a melee
attacker nothing, not even a step around it. You can also swing through the
building's exterior wall.

And there is no fallback: **neither shipped level places a single `#` cell.**
`TILE_TYPES.wall` exists (`solid: true`, height 0.6), but `level1.json` (24×18,
334 floor cells) and `level2.json` (28×20, 454 floor cells) contain zero of
them. Every wall in the game, perimeter included, is an **edge run** in the
`walls` array (`'H 0 0 24'`, `'V 6 0 5'`, …). `#` appears only in the e2e
specs' inline maps. Solid *props* block melee incidentally, by consuming a tile
so opposite faces are distance 2 — but a diagonal around the corner is still
distance 1, so you can swing around a desk.

### What replaces it

**Melee reach is Euclidean distance between continuous positions, against a
per-weapon reach, with no solid edge in between.**

```
inReach(a, b, r) = dist(a.pos, b.pos) <= r  AND  reachOpen(a, b)
r = REACH.DEFAULT + equippedStats(sheet).reach     // sheets
r = def.reach ?? REACH.DEFAULT                     // AI units, via unitCombat
```

### Design decisions (recommended, with alternatives considered)

| # | Decision | Why, and what lost |
| --- | --- | --- |
| R1 | **`REACH.DEFAULT = 1.5`** tile-units for bare hands and ordinary desk weapons | Chosen off the geometry, not taste: orthogonal centre-to-centre is 1.0 and diagonal is 1.41, so *every attack that looks adjacent stays legal*, while the pathological 2.0–2.83 far-corner cases stop working. **1.0 loses** — it forbids diagonal attacks, which would read as a bug. **2.0 loses** — it readmits most of the pathology. |
| R2 | **Reach is an upgrade axis only; the default is the floor** | A weapon shorter than 1.41 cannot hit a diagonally adjacent target, which reads as broken no matter how well it's justified in flavour. So the letter opener's shortness is expressed through `dmg`/`acc` (as it already is), and `reach` in `stats` is additive-positive. **Rejected:** signed reach with short weapons at 1.2 — thematically nice, unshippable in a grid the player reads as squares. |
| R3 | **Reach uses its own edge test, not `stepOpen`** | `stepOpen`'s diagonal rule demands all four edges around the crossed corner so nobody slips past a partition's end. Correct for *bodies*; wrong for *arms* — reaching diagonally past the end of a cubicle wall is a legitimate swing. Reach uses the orthogonal-face shape `hasCover` already uses. |
| R4 | **Shove keeps its own range, and it is not weapon reach** | A shove is arms-length regardless of what you're holding; a broom does not let you shove someone from two tiles away. `SHOVE_REACH` as its own constant (start at `DEFAULT`), so a reach weapon doesn't silently become a telekinesis upgrade. |
| R5 | **Partially superseded by DEGRID D11.** Engagement/surprise remain grid-authored areas; summon placement and printer body damage are continuous. | The 2026-08-06 playtest showed the two visible exceptions did not read correctly: summons refused real gaps and the square blast disagreed with bodies walking continuously. Summons now search body-clear points around their declared anchor; printer damage intersects body circles. `[ratified]` (designer, 2026-08-06). |
| R6 | **Throw range stays out of scope** | `THROW_RANGE = 5` is Chebyshev too and has the same class of defect, but proportionally tiny (5 vs a 5.66 worst case) and it costs a duplicated constant in `main.js` to touch. Noted, deferred. |

### The hard part: opportunity attacks

`threatens` / `provokedBy` are deliberately tile-granular. `provokedBy` diffs
threat **sets** between the tile left and the tile entered, and the comment says
why: it's what keeps a unit circling a foe from provoking, and what stops a
diagonal shuffle from double-firing.

Going continuous means threat becomes a **radius crossing**: a unit provokes
when its path leaves the threatener's reach circle. Two notes:

- **The circling case gets simpler, not harder.** The set-diff was an
  approximation of "are you still in reach"; a radius *is* "are you still in
  reach". Circling stays inside the circle and provokes nothing, for a reason
  rather than by construction.
- **Granularity is the real cost.** Reactions currently resolve on tile-change
  events (`onTile` with `changed`), but a radius exit happens mid-tile, so the
  opportunity attack fires late — sometimes a whole tile late. The fix is to
  sample the crossing on the same 0.25 slice `truncateByBudget` already walks,
  which means the reaction check moves off the tile hook. That is the one piece
  of genuinely new machinery in this revision.

### Where it lands

**Pure (unit-tested):**

- `src/tactics.js` — `inReach(ax, az, bx, bz, r, edgeOpen)` and `reachOpen`;
  `threatens` grows a reach argument; `provokedBy` is reformulated as a radius
  crossing. `positionMods`'s `melee` flag reads `inReach` instead of `cheb <= 1`.
- `src/stats.js` — a `REACH` block (`DEFAULT`, `SHOVE_REACH`); `reachOf(sheet)`
  alongside `damageBonus`/`deflect`; `reach` summed in `equippedStats`;
  `unitCombat` passes `def.reach` through.
- `src/data/items.js` — `reach` joins the documented `stats` vocabulary.

**Impure:**

- `src/combat.js` — seven sites move onto `inReach`: `:548` (action
  availability), `:897` (shove → `SHOVE_REACH`), `:960` / `:978` (walk-and-swing),
  `:1653` (opportunity attack), `:1697` / `:1702` (AI swing).
- `src/main.js` — three: `:1449` (out-of-combat shove), `:1450` (out-of-combat
  reachability), `:2256` (the `reachable` debug flag). Deliberately unchanged:
  `:557` (printer blast), `:629` / `:1597` (interaction proximity), `:1224`
  (engagement detection) — areas and interactions, per R5.
- `src/ui.js` — target rings and the hover readout are drawn per tile; a radius
  needs its own affordance or the player can't see reach. Without this, a reach
  weapon is invisible.

**Persistence:** none. `reach` derives from equipment like every other number.

### Milestones (each a PR that keeps `npm test` + e2e green)

1. **Reach as data, inert.** ✅ Landed. The `REACH` block (`DEFAULT` 1.5,
   `SHOVE` its own constant), `reachOf`, `equippedStats.reach`, `unitCombat`
   passing `def.reach` through with `??` so an explicit 0 survives,
   `dist`/`reachOpen`/`inReach` in `tactics.js`, the items vocabulary comment.
   Nothing called `inReach` — zero observable change, full unit coverage first,
   the same way M1 landed the `mods` seam. Unit 217→229.
2. **Melee reach goes continuous.** ✅ Landed. Ten sites onto `inReach`, **edge
   test off**, so the only change was distance. `combat.js` grew `reachOfUnit` /
   `posOf` / `withinReach` / `canReach` beside `statusesOf`/`accuracyOf`/
   `dodgeOf`, which is where the member-vs-unit difference already lived. The
   walk-up endpoint check *improved* rather than ported: `walk.end` is already a
   free point, so it asks whether we will be standing in reach instead of
   rounding back to a tile first.
   - **A stall this milestone introduced, fixed in it.** `aiAdvance` only ever
     considered OTHER stand-tiles (its own tile pathed at length 1 and was
     skipped) — fine when a tile was atomically in-or-out of reach. With reach a
     distance, one tile holds both in-range and out-of-range positions, so a
     unit hemmed into the single adjacent tile of a corridor could never close
     the last 0.7 units: the turn burned, every turn, and the fight never
     resolved. It now closes the gap in place when the tile is already right and
     only the sub-tile position is wrong.
3. **Walls block swings.** ✅ Landed. `canReach` passes `world.stepOpen`.
   `standTilePath` extracted from `aiAdvance` and **shared with `pickTarget`**,
   so the target picker and the mover can never disagree about who is
   engageable; `pickTarget` now prefers an ENGAGEABLE member over a merely
   nearer one, and the in-place shuffle checks that closing the gap would
   actually earn a swing (a wall is not a distance problem).
   - **The risk was real, and it was not the one the plan named.** The AI held
     up fine; what broke was that `pickTarget` is called *eagerly* during
     `startCombat` (the surprise sweep), so `const canReach` sat in its temporal
     dead zone and threw `ReferenceError` mid-setup — starting a fight whose
     combat panel never got built. The reach accessors are hoisted `function`
     declarations now, so call order stops mattering. Caught by smoke, not by
     units: the failure needed a real `startCombat`.
   - Both levels gained a `#` legend entry and two structural pillars each
     (level 1 at (9,7) and (8,14); level 2 at (19,14) and (11,16), one beside
     the senior manager). Until now neither shipped level placed a single wall
     CELL. Pillars are the conservative form — isolated, open on every side, so
     nothing is sealed and pathfinding walks around one tile.
4. **Opportunity attacks go continuous.** ✅ Landed. `threatens` is now `inReach`,
   so a unit cannot zone ground it would be unable to hit, and threat stops at
   walls. Each threat carries its own reach, which is what lets a long weapon
   zone a wider ring.
   - **`provokedBy` kept its shape**, which is the plan's guess confirmed: the
     threat-set diff was an *approximation* of "are you still in reach" while
     reach was a tile ring, and against a radius it is that question exactly.
     Circling still provokes nothing, now for a reason rather than by
     construction.
   - **The granularity cost stands, and was not paid down.** `moveStart` records
     the continuous position beside the tile, so a leg is measured between real
     positions — but the hook still fires on *tile* changes, so a reaction can
     land up to a tile after the radius was truly crossed. Bounded, and far
     cheaper than the per-slice sampling this plan proposed. Revisit only if it
     reads badly in play.
   - Two traps closed: `provokedBy` defaults a missing `reach` to
     `REACH.DEFAULT` (comparing against `undefined` is false both ways, so an
     unstated reach would have threatened *everywhere* and therefore provoked
     *nowhere*), and `isFlanked`'s "in its face" check says `cheb <= 1` outright
     instead of borrowing `threatens` — it always meant tile adjacency, and
     leaving it would have made a pincer depend on the ally's weapon.
5. **Reach content + the UI affordance.** ✅ Landed. `reach-grabber` (the
   Reach Extender, `stats: { reach: 0.7, acc: -0.05 }`, its own
   `grabber-swipe`, 0.15 in the `trash` table) is the first weapon whose point
   is *where* it hits from: 2.2 clears a full orthogonal tile, paid for with no
   damage bonus and worse accuracy. The Security Guard gets `reach: 2.1` — the
   maglite was already in his attack lines — so the player meets reach as a
   threat before finding it as an upgrade.
   - **The affordance is a circle, not tiles.** Reach is a radius; highlighting
     whole tiles would draw a plus-with-corners that lies about the shape.
     `drawTargets` rings the active member at their own reach, on the actor's
     continuous position. Without it a long weapon is an invisible statistic.
   - **It is a HOVER affordance, not an ambient one.** The circle answers "can I
     hit *them* from here?", so it is drawn only while a coworker is under the
     cursor - in combat whenever `handleHover`'s last point resolves to an
     enemy, out of combat behind the same Ctrl/Alt inspect modifier that lights
     the hover aura (`drawOocReachRing`). Painted into every frame of your turn
     it was a circle that followed you around, which is wallpaper, not
     information.
   - **Difficulty note:** every other enemy defaults to `REACH.DEFAULT`, so the
     bestiary's effective reach is slightly SHORTER than under the tile rule.
     Intended, but it is a quiet across-the-board easing, and the guard's 2.1 is
     the only thing pushing back.

### Test impact

`tests/unit/tactics.test.js` is 37 tests, and the reach group is rewritten
rather than extended: *"cheb treats a diagonal as one step"*, *"a unit threatens
its eight neighbours and nothing further"*, and the four `provokedBy` cases all
encode tile adjacency as the rule. The `positionMods` melee/ranged exclusivity
tests (*"cover is ranged-only"*, *"flanking is melee-only"*, *"cover and
flanking cannot both apply"*) keep their assertions but change how `melee` is
established. `stats.test.js` gains reach-from-equipment and `unitCombat`
passthrough cases. `tests/e2e/tactics.spec.js`'s three provoke tests are the
regression gate for milestone 4 — they should pass unchanged, since they test
behaviour rather than mechanism.

### Risks and open questions

- **AI stalling (M3)** is the one that can break a build, not just a feel.
- **A radius on a square grid needs a UI answer.** Highlighting reachable tiles
  under a 1.5 radius produces a plus-shape-with-corners that will look arbitrary
  until it's drawn deliberately.
- **Is 1.5 right after playtest?** It's derived to preserve current-looking
  attacks, which is the conservative choice. A tighter 1.2 would make positioning
  matter more and break diagonal-from-centre attacks; that's a deliberate
  design change, not a tuning nudge, and wants its own decision.
- **Enemy `reach` defaults mean the bestiary is unchanged** at `DEFAULT` — so
  every current enemy gets *slightly shorter* effective reach than today. That
  is the point, but it is a stealth difficulty reduction across every fight.

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
mods = surprise                           // awareness bonus, outside position cap
     − cover(attacker, defender)          // ranged only, defender-favouring
     + min(POSITION_CAP, flank + backstab)
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
6. **Take Cover (active crouch, M6).** ✅ Landed — the Gears-of-War turn
   (designer, 2026-07-29; open questions ratified as the recommended defaults
   2026-07-30, "go with your defaults"). The decisions, each tagged with what
   the designer actually said:
   - `[stated]` A first-class action: aim it at a solid object — or at a
     character, "use me as a shield" tanking included — and crouch behind it.
     Line of sight gates the aim (`hasLos(you, object)`), "as line of sight
     driven as possible." No cooldown and no need to leave cover first: you
     can hop cover-to-cover.

     **Superseded on the AIM, 2026-07-31 `[stated]`.** You aim at the SPOT YOU
     WILL STAND, not at a shield, and whatever shields the faces of that tile
     covers you along those faces — partitions, props and people alike. The
     designer's words: *"the take cover target emblem moves in discrete tile
     sized steps, makes it impossible to use as i cant pick a side of the
     person, its just wherever the thing happens to land in relation to the
     targeted shield object... what we need is something that is continuous
     and smooth for starters, and 2 it should like find the objects within its
     target area range, whatever is there is the side of the object(s) we are
     covered by."*

     Naming a shield made the SIDE you ended up on an output (`coverSpot`
     picked the nearest free neighbour), which is why the emblem hopped and
     why "the other side of Dave" was unsayable. Aiming at the ground answers
     it by construction. It also collapses the three crouch modes — cell,
     human shield, edge — into the one edge mode always had: a crouch is a
     POSITION, and `tactics.shieldedFaces` names what covers it.

     The CONTINUOUS half is landed too. The aim draws three layers — a small
     marker at the precise cursor point, the stand-tile ring eased toward the
     resolved tile (~70ms, fps-independent) instead of hopping to it, and the
     shielded faces snapped to the tile's edges, because that is where edges
     are — and the commit walks you to the CLICKED point, clamped to body
     clearance, rather than teleport-parking on the tile centre. Bodies rest
     at free points everywhere else in this engine (movement, walk-ups,
     dashes); the crouch was the last deliberate destination that quantised.
     The rule still resolves on the tile's faces — a face is tile geometry —
     which is the honest split: continuous CHOICE, discrete RULE. Same three
     layers in and out of combat, off the same queries the click commits.

     Two things fell out. Cover is now UNCAPPED `[stated]` (designer: *"if the
     environment allows it thats a design issue more than anything, plus we
     have the counters like grabbing someone over, destroying and toppling
     barriers"*) — a corner covers two axes, a fully enclosed tile covers all
     four, and such a body genuinely cannot be shot from anywhere; the counters
     are melee, the topple, the break-down and Pull Over. And taking cover
     behind a PERSON now works out of combat, which it never did: the
     out-of-combat verb knew only tiles and partitions and refused a body with
     a rule nothing else observed (*"it wont let me take cover on a person out
     of combat but i can in combat"*). People move, and when they do the crouch
     breaks — which is what `crouchStateOf` has always done.
   - `[stated]` It grants IMMUNITY to ranged attacks — not a modifier — but
     only from the directions the object shields. Flanking still works.
   - `[stated]` Cost: the path distance to the object + 1 AP.
   - `[stated]` Works on all solid objects, with UI color-coding for safe
     cover vs topplable furniture; take-cover rings draw only on the hovered
     object ("there would just be rings everywhere if not"). **Revised
     2026-07-31:** the ring is on the hovered STAND SPOT rather than a shield,
     and the faces that would cover you are drawn as bars along that tile's
     edges — still one hover, still no rings everywhere. The same bars stay up
     while the crouch HOLDS, in a fight and out of one, which answers the
     complaint that a held crouch showed only an "In Cover" chip: *"if im
     taking cover in a corner i have no indication currently of which
     partition is my actual cover"*.
   - `[ratified]` Any character can be crouched behind, no stance required
     ("using any character as cover is the right shape id like for now",
     2026-07-29). The existing `hold-the-line` guard stance "wasnt ever a
     requested feature" — slated to be absorbed by this mechanic rather than
     kept as a parallel system. Not removed yet; that is its own change.
   - `[ratified]` Tracked as a STATUS on the crouching unit ("id think yes a
     status just in case", answering the implementation question directly).
   - `[stated]` Shoving an object onto someone: they roll a save against
     crushing damage and a possible pin. The stat is Grit — the designer said
     "strength or whatever equivalent check", and Grit is the game's tank
     attribute. Note the game already topples props onto shove targets
     (POWERS_PLAN M6); what is NEW here is the save and the pin.
   - `[ratified]` Attacking does not break the crouch; moving does — the
     Gears rule (2026-07-30, "go with your defaults"). `[ratified]` Enemies
     use it in v1 (same). `[ratified]` A human shield takes the blocked hit
     rather than negating it (same).

   Why this and not more passive cover: it differentiates melee (walks around
   low cover freely, swings unimpeded by it) from ranged (must break
   entrenchment), and it gives toppling a second job — furniture becomes
   MOVEABLE cover both sides can work with.

   **As landed (2026-07-30):**
   - The verb: `take-cover` (universal, beside `shove`), `ap: 1` — the "+1";
     the walk to the shield bills as ordinary movement, and the crouch
     resolves on arrival (`pendingCrouch`, the pendingMelee pattern), so a
     walk cut short downs the crouch with it. The crouch SPOT is the nearest
     visible open 4-neighbour of the shield — orthogonal because the shield
     must sit on a FACE (`tactics.crouchShields`; a diagonal cell shields
     nothing).
   - The rule: combat's `crouched` map + the `covered` status chip
     (watching/guarding pattern: the chip is visibility, the map is the
     rule). Validity is LAZY — every consult re-checks that the croucher
     hasn't moved and the shield still stands (a solid/`cover` def, or a
     live body on the cell), so topples, shoves, swaps and deaths all break
     it without bespoke hooks. `shotOutcome()` is the one seam: a
     single-target ranged attack is untouched, REFUSED (object shield), or
     REDIRECTED into the human shield; every attack path, the target rings,
     the hover readout and `routeIntoRange` (which now walks a shooter to a
     FLANKING angle, not merely into range) read it.
   - The AI: with nobody in reach and nowhere useful to walk, a unit crouches
     behind an adjacent low solid or fallen prop that actually stands between
     it and its target — no shielding neighbour, no crouch.
   - The shove save: furniture coming down on a body now rolls a Grit save
     (`stats.gritSaveChance`; `forceHit` pins it for the specs — true means
     the drop fully lands). Pass: they dive clear, nothing lands. Fail: the
     damage, the existing stun (anti-chain window intact), and `pinned` —
     detained's root semantics, under furniture.
   - `[proposed]` defaults picked in implementation (see Questions section):
     cones/zones and ranged controls ignore the crouch (area is the flush);
     member-shields refuse your own shots rather than rerouting them; the
     failed save keeps the stun alongside the pin.
   - Honest scope notes: no shipped enemy has a ranged attack, so the
     PLAYER-side crouch is future-proofing today — the immediate gameplay is
     enemies turtling against your throws, and human-shield redirects fire
     player-side only until enemies crouch behind bodies. **Superseded
     2026-08-01 (AI_PLAN M5):** the Executive shoots now — the player-side
     crouch, human shields and Pull Over are live gameplay, and the AI's
     shot runs this milestone's own `shotOutcome` gauntlet from the other
     side. `hold-the-line`
     still exists unabsorbed. The "safe cover vs topplable" colour split is
     partial: the hovered shield rings yellow, but yellow does not yet
     distinguish topplable from fixed. Combat-only verb: out of a fight the
     bar says so.
   - **First-playtest fixes (2026-07-30):** (1) the hotbar now rebuilds the
     moment a fight starts and ends, so combat-only verbs light up on their
     own — the bar used to keep its out-of-combat state until the next press,
     which read as "take cover never becomes active." (2) EDGE MODE: cubicle
     walls are edges, not cells, and the verb now speaks them — aim at a tile
     with a partition (or closed door) on a face, crouch ON it, and which
     shots are blocked is the M3 edge test (`tactics.hasCover`) read live,
     upgraded from −20% to immunity while the crouch holds. The AI crouches
     in place against a partition that already blocks its target's line.
   - **Out of combat too (2026-07-30, `[stated]` "taking cover and shoving
     should be available out of combat as well"):** both verbs work with no
     fight on. An OOC crouch (furniture and partitions only - people move;
     the character shield is a combat commitment `[proposed]`) stores on the
     leader and RIDES INTO the fight: beginCombat hands it to startCombat's
     `preCrouch`, so the fight opens with the leader already tucked in -
     the point of taking cover early. It breaks on any deliberate walk or
     leader change. An OOC shove topples furniture and partitions as pure
     terrain edits; with a coworker standing where it lands, the topple IS
     the opener - the fight starts and combat resolves the fall with its
     own save and pin (engageWithAction's shove gate accepts
     partition-between and furniture-onto-them aims, and combat's enemy
     click grew the matching one-gesture fallbacks: click the coworker
     behind the cabinet, they wear the cabinet).
   - **Second-playtest polish (2026-07-30, `[stated]`):** (1) the
     out-of-combat aims read like combat's now - a hovered shove target
     rings with a smaller ring AND a line showing WHERE the fall lands
     (`hover.drawShoveAim`, fed by main's own click rules so the preview
     and the topple cannot disagree), a hovered take-cover shield rings in
     the cover yellow (`drawCoverAim`), and the shove ring on a coworker
     keeps the click's whole promise (oocTargetOk grew the
     partition-between / furniture-onto-them arms the resolver accepts).
     Combat's shove rings gained the same landing read. (2) The crouch is
     VISIBLE: a held squash pose on the actor ("shift torso down onto the
     legs") - eased in and out, composed with flinches and lunges so
     attacking from cover still animates, cleared wherever the crouch
     breaks, including a sweep at combat teardown that also fixes the
     'covered' chip outliving a fight (it only ticks on the combat turn
     clock). (3) Merged the designer's shared-turns branch
     (claude/initiative-tie-handling-sjfaoh) under all of it.
   - **Partition toppling + solid twins (2026-07-30, ratified):** the shove
     verb aimed across an adjacent partition edge — at the coworker behind
     it, or the bare tile — brings the PANEL down: `grid.removeEdgeBetween`
     retires the edge (conduction pools merge live; the dam broke),
     `scene.removeEdgeWall` retires the mesh, and `partition-fallen` lies
     flat on the far tile — walkable, no cover, a board. Whoever stands
     there rolls the same Grit save everything falling rolls (`dropOnto`,
     the resolution shared with furniture). Doors never topple: they are
     not in the wall sets, by construction. And per the fallen-shape rule,
     the chunky fallen twins are SOLID now — an object on its side that
     blocks bodies, is shot over, and grants cover through the M6a height
     rule alone (their special `cover` flag retired with the walkability);
     a body it lands on stands IN the cell until the pin lifts, and walks
     out because pathfinding never tests a walk's starting tile. The AI
     does not yet topple partitions (furniture only) — a follow-up.
     **Done 2026-08-01 (AI_PLAN M4):** the AI topples partitions onto
     members through the same machinery.

7. **Shots sail over low furniture (M6a).** ✅ Landed.
   `[ratified]` "height threshold as you suggest" (designer, 2026-07-29).
   Before: EVERY solid cell blocked sight at any height — a 0.18-high
   microwave stopped a throw as absolutely as a wall, while the chest-high
   edge partitions (0.6–0.72) never blocked sight at all, and "crouch behind
   the desk" would have granted an immunity the desk already gave for free.
   The rule now: `blocksSight(def)` = solid AND (`tall` or `height >=
   SIGHT_BLOCK_HEIGHT` (0.75)), in data/tiles.js beside the data it reads.
   `grid.sightOpenCell` carries it; `hasLos` (throws, zones, every aimed
   verb) and `canTakePart` (who is in the fight) both trace it. A low solid
   that no longer blocks the shot instead GRANTS the passive cover
   (`COVER_DODGE`, −20%) through the same coverCell predicate the fallen
   twins and the guard stance use — one threshold decides both, so a prop
   can never block a shot AND grant cover against it. `wall` ('#') and
   `paneling` carry `tall: true`: they are structure drawn short so the
   camera can see over them, and the e2e contract says a cell wall is "solid
   all the way up." Symmetric by construction — enemies also shoot over
   desks now, and bystanders behind low furniture can join a fight.

8. **The aim wash (M7).** ✅ Landed (in combat; out-of-combat parity is a
   follow-up). `[stated]` The designer asked for DOS2-style ground feedback
   while aiming: "an outline on the ground of where your effective range is
   with los factored in," then sharpened to "a color painted over the area
   thats within range like is done in dos2," for ALL aimed powers and all
   their target types. Looked up (2026-07-29): DOS2 actually greys the
   out-of-range ground and draws an aim line that reports "Path is
   Interrupted" — it does not shadow the range region by sight. The designer's
   version is stronger and is what shipped: while a verb is armed, the exact
   fine-cell region where aim can legally land — range AND line of sight — is
   painted as one translucent merged mesh (`aim-paint.js` +
   `surface-mask.js`; `powers.aimRangeOf` supplies the same range defaults the
   problem functions read). Blockers visibly
   bite shadows out of the wash, which is the whole lesson. Colors
   `[stated]`: "green red blue yellow should cover everything" — mapping
   `[proposed]`: green = a click that works now, red = a visible but refused
   target (both pre-existing), blue = the wash, yellow reserved for the
   hovered take-cover object (M6).

9. **Destructible cover + Pull Over (M8).** The finish-out of the cover game
   (designer, 2026-07-30): barriers break down under attack, and a crouched
   target can be hauled bodily over their own cover. The decisions, each
   tagged with what the designer actually said:
   - `[stated]` Objects are destructible by attacks — "melee and ranged"
     both, per the designer's own clarification: "adds more dynamic to the
     coverage approaches as then melee could gradually break down a barrier."
   - `[stated]` Destruction REMOVES the object — "gone means gone." The
     designer's rationale, verbatim: "it needs to be B because anything else
     like shove or pull keeps the barrier, whereas destruction shouldnt." So
     the three cover-denial verbs have distinct battlefield signatures:
     shove/topple RELOCATES the barrier (solid debris stays in play), pull
     KEEPS it standing and moves the person, destruction DELETES it. A
     destroyed prop's tile reverts to floor; a destroyed partition loses the
     edge entirely, no fallen plank ("gone means gone", answering the
     follow-up directly).
   - `[ratified]` HP on the cover-grade set only (2026-07-30, recommended
     default accepted): partitions, the five toppleable props, and their
     fallen twins. Loot desks, the snack machine, the printer and the rest
     of the office stay indestructible for now.
   - `[ratified]` A hidden HP pool with a damaged visual tell — no staged
     art (same). Numbers are first drafts, deferred to playtest as always.
   - `[stated]` Pull Over is UNIVERSAL — "i may have answered one wrong. i
     want everyone to have that move", sharpened into the standing rule:
     "so all cover related moves are universal." (This supersedes the
     recommended power-grant; the hotbar row grows to ten.)
   - `[ratified]` The pulled target rolls the SAME Grit save as everything
     else that gets manhandled (2026-07-30, recommended default): pass and
     they are hauled over but land on their feet; fail and they wear the
     crush damage, the existing stun, and the pin — `dropOnto`'s exact
     price, arrived at from the other side of the barrier.
   - `[proposed]` implementation defaults, each cheap to reverse: objects
     do not dodge — an attack aimed at a prop auto-hits, spends its full
     cost, and deals its rolled damage (rolling to miss a bookcase reads as
     a bug, and pricing the swing keeps "break it down" from being free);
     fallen twins are also breakable, so topple-then-destroy prices full
     tile denial at two actions; Pull Over requires an actual crouched
     target — it is cover-denial, not a generic yank — and lands them on
     the free tile beside the puller nearest the barrier they came over
     (**superseded** — `[stated]` designer, 2026-07-31: the landing is the
     free tile beside the puller on the FAR side from where they were tucked
     in, so the puller ends up between them and the barrier. "nearest" also
     shipped a bug: measured in tiles alone it could pick the tile across the
     partition, dragging the target one tile on their own side);
     the AI neither breaks barriers nor pulls in v1 (deferred with AI
     partition toppling); partitions ring their break affordance only when
     adjacent (the shove's own partial-affordance precedent) though the
     ranged click resolves at any legal range — and, `[stated]` (designer,
     2026-07-31), only while the attack is deliberately ARMED. The break
     rings shipped ungated: the basic attack satisfies `aimsAtProps`, so
     every partition you stood beside rang green for the whole fight.

   **As landed (2026-07-30):**
   - The pools: `hp` on the cover-grade tile defs and `PARTITION_HP` for
     edges (data/tiles.js); damage accumulates in grid.js side maps (defs
     are static shared objects), persists ACROSS fights — "gradually break
     down a barrier" is allowed to span them — and dies with the thing it
     described: `setType` resets a cell's pool (a topple's fallen twin
     starts fresh), `removeEdgeBetween` retires an edge's.
   - The verb: an armed damage-rolling attack (`powers.aimsAtProps` — the
     first cut of TODO's target-class concept) aimed at a breakable prop's
     tile, or at a partition square-on (melee, the topple's own aim) / on
     the clicked tile's face toward the shooter (ranged). `performBreak`
     spends the full cost, rolls the dice into the pool, and the world
     facade pairs rule and mesh exactly as setType/toppleEdge do: a
     surviving object LEANS a few degrees (`scene.markPropDamaged` — the
     pool is hidden, so the object wears the damage), a spent one is
     removed. Crouches behind it break with no bespoke hook — refresh()'s
     lazy revalidation was built for exactly this.
   - Pull Over: universal `pull` entry (`crush: [2,4]`), granted beside
     shove/take-cover on both bars; the hotbar row grew to TEN with '0' as
     the tenth key (revising the row-of-nine note in hud.js — the designer's
     "everyone has that move" outranks it; ten is the genuine key ceiling).
     `pullPlanFor` demands a live crouch with the shield between the bodies
     (`crouchShields` for a cell, the M3 edge test for edge mode), reach
     `REACH.PULL` (2.5), and a landing from `powers.pullLanding`; the haul
     is `pushTo` (forced movement — no provoke, no step hooks), the save is
     the shared Grit roll (forceHit pins it), a fail wears crush + the
     existing stun + `pinned`, and a hazard landing bills like a shove's.
     A pull aimed at the ground resolves on whoever holds the tile — a
     crouched body is a squashed pose, easy to click past. A HUMAN shield is
     not pullable `[proposed]`: you do not haul somebody over a colleague —
     that is a shove's problem, and the refusal says so.
   - Honest scope notes: combat-only for v1 — OOC break/pull parity is a
     follow-up if wanted `[proposed]` (an armed OOC attack still refuses
     props); no walk-in for prop attacks (melee rings only promise reach);
     the `pinned` chip's log line still says "under it", which reads odd on
     a pull; enemies neither break nor pull yet — **superseded 2026-08-01
     (AI_PLAN M4): they do both now, at the player's own prices.**

Milestones 1 and 2 are independent and may be swapped; 3–5 all depend on 1.
M6 depends on 1, 2 and 5 (opportunity attacks and facing already exist for
it to lean on) plus M6a and M7 above; its immunity slots into `positionMods`
where the passive cover already lives. M8 depends on M6 (it reads the crouch
map and the Grit save) and on M6a (the height rule is what makes a broken
low barrier's absence legible to the shot).

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
- **M6a/M7 (2026-07-29):** unit — `blocksSight`/`sightOpenCell`
  (grid.test.js), `aimRangeOf` (powers.test.js), and fine aim masks
  (surface-mask.test.js); suite coverage grows with the registry.
  e2e — a throw sails over a desk where it used to read "no clear line"
  (throwing.spec), a desk on the defender's near face costs exactly
  `COVER_DODGE` with the tag reading "in cover" (tactics.spec, the partition
  test's twin), and arming a throw paints the wash / disarming clears it
  (throwing.spec, via the `__combat.aimPaint` debug handle). The throwing,
  tactics and topple specs re-ran green locally alongside the new tests.

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
