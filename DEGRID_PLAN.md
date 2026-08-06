# De-grid Plan

Kill every way the grid still shows through what the player watches - the
movement juts, the tile-centre darts, the washes and shots judged from tiles
the bodies aren't standing on - while keeping the grid as the data model,
which is the architecture's stated doctrine (ARCHITECTURE.md "Movement is
free-form, the grid is the data model") and, verified below, also how DOS2
itself is built.

This plan came out of a scrap-or-fix review (designer, 2026-07-31: "i feel it
may be best to scrap a lot of it fully than to comb through fighting bugs").
The review's verdict, accepted by the designer: **fix, don't scrap** - the
tile-based architecture the scrap instinct aimed at no longer exists; what
remains is one bug family at the seams between correct layers. The designer
then ratified the whole fix program ("write up the plan doc and you can
complete all of the work weve identified").

## Questions for the designer

1. **Does straightening across a chosen spill read right?** M2 makes a walk
   run straight across a surface the router deliberately crossed (it still
   detours around ones it can avoid). The alternative feel is visible
   tile-by-tile skirting at every spill edge - the pre-M2 behavior. Play it;
   if the straight run reads as "ignoring the hazard", the revert is one
   predicate swap. Recommendation: keep the straight run - the AP surcharge
   already tells the story. `[proposed]`
2. **Overwatch: does the watch circle go Euclidean with everything else?**
   It is a reaction range, so "circles for targeted" (D4) says yes, and M5
   also moves its trigger to the same continuous metric opportunity attacks
   already use. Implemented per this recommendation - flagged because it
   changes when overwatch fires; the revert is one gate. `[proposed]`

The two former playtest questions are answered. Surface chunkiness survived
M6 in both presentation and rules: TPS Form Storm refused visibly open gaps,
bare-looking ground inside a paper tile still dealt damage, and a path tracing
the visible edge was billed as though it crossed the drift. The square-chip
aim wash also read as "squares with circles in them" rather than one aiming
shape. Both answers are recorded as D8 and D10 below. `[ratified]` (designer,
2026-08-06, this task)

## What the review established (evidence, 2026-07-31)

Six subsystem reviews plus adversarial verification, re-verified against this
branch (`bulk-mail-combat-fix` line). The architecture is sound end to end:
Dijkstra route -> string-pull -> free-point polyline -> continuous follower
with a derived, never-snapped logical tile; exactly one LOS trace
(`segmentClear`); one to-hit assembler; one reach vocabulary. The defects are
seam disagreements:

- **The signature jut** (confirmed with numeric traces): `smoothPath`'s
  corridor probes at exactly `BODY_RADIUS`, while `clampToClearance` and
  `approachPoint` legally park bodies at or inside that distance from blocked
  cells - so after any walk-up, every span from the body fails, `smoothPath`
  degrades to raw tile-centre vertices planned from the *rounded* tile, and
  the next walk darts to one of them. Fixed in M1.
- **Router/smoother hazard split**: the router *prices* surfaces
  (`hazardCost`), the smoother treated them as *walls* - so walks near spills
  stair-stepped. Worse on the enemy side: the smoother did not block party
  tiles the router detoured around, so an enemy's straightened walk could cut
  through a member's tile. Fixed in M2.
- **Tile-centre destinations by construction**: follower formation spots,
  wander smoothing origins, forced-move (shove/pull/swap) landings, and the
  facing/projectile FX all use tile ints while bodies rest at free points.
  M2/M3.
- **Threshold rules fed rounded inputs**: cover/flank/backstab octants and
  every `hasLos` call measure tile-centre-to-tile-centre, so state flips at
  invisible tile midlines and shot legality is judged from a tile the body
  may be half a tile away from. M4/M5.
- **The cone runs three geometries for one click** (wash: tile origin; gate:
  cheb + tile LOS; resolution: body origin re-aimed at the target's tile
  centre - and OOC, a fourth: `fireOocCone`). M5.

## Design decisions

| # | Decision | Status |
|---|----------|--------|
| D1 | Fix, don't scrap. No rewrite of movement/LOS/objects. | `[stated]` (designer, 2026-07-31, accepting the review verdict: "you can complete all of the work weve identified") |
| D2 | Cover stays, as this game's own design - not BG3's (which has no cover system at all: bg3.wiki 5e-changes, verified 2026-07-31). Face cover, uncapped shielded faces, pincers, backstab all keep. | `[stated]` (designer, 2026-07-31: "were not making a clone, trying to do our own thing weith the cover") |
| D3 | Octant thresholds keep; their INPUTS go continuous. The 8-sector bucketing is a necessary threshold on direction; the bug is measuring it between tile centres. Direction is quantized around the defender's *body*, sector boundaries at the 22.5-degree lines. Cover *sources* (faces, cells) stay tile-shaped - the furniture genuinely is. | `[stated]` (designer, 2026-07-31: "octant cover seems like a necessary threshhold to enforce, not really tiled if the initial point isnt tile centered") |
| D4 | Targeted verb ranges are true-distance circles, measured body-to-body: throws, straws, zone/summon/buff/swap/control aim ranges, walk-up stop points. Engagement membership, surprise, AI adjacency, cover and physical office objects remain tile/edge authored. The former carve-out for summon drop rings and printer blasts is superseded by D11: those two player-visible areas go continuous too. | `[stated]` (designer, 2026-07-31: "yes do circles for targeted"), revised `[ratified]` (designer, 2026-08-06: agreed to continuous summon/printer areas) |
| D5 | Effect storage stays cell-keyed, but surfaces get their OWN finer integer field rather than borrowing movement cells. The field is the rule and the skin: placement, rendering, contact, path cost, fire, conduction, ignition, expiry and harvesting all read it. The movement grid remains the terrain/object model. | `[stated]` foundation (designer, 2026-07-31: "you just dont get the organic look that way"), resolution revised `[ratified]` after the 2026-08-06 playtest showed that an organic skin over whole-tile rules still lies |
| D6 | LOS is measured body-to-body; BLOCKERS stay grid-shaped (door edges, smoke cells, tall solids - world objects the grid legitimately models). `segmentClear` already takes continuous coordinates; the work is the ~30 call sites. | `[ratified]` (proposed in review, approved in the designer's blanket "complete all of the work weve identified", 2026-07-31) |
| D7 | Smoothing straightens across hazard cells the route CHOSE, never ones it avoided (`routeOpen`). | `[proposed]` - implemented per recommendation; question 1 above |
| D8 | Surface chunkiness survived M6; build an authoritative fine surface field. Resolution is an engineering constant (begin at quantum 0.5, do not bake 2x2 assumptions into consumers). Existing authored surface tiles seed the field; runtime surface state never keeps a second truth in `grid.typeAt`. | `[ratified]` (designer, 2026-08-06: agreed the audit "will incorporate the entirety of the issues") |
| D9 | Facing stays the LOGICAL sign-vector combat writes at act/move time, never the model's eased visual yaw - a damage rule cannot hang off a cosmetic tween (TACTICS_PLAN #5). Unchanged by M4. | `[stated]` (standing decision, reaffirmed in review) |
| D10 | Replace the generic square-chip aim wash with one merged, soft-edged, LOS-clipped region for every ranged/ground aim. Body target rings remain because they communicate a different fact. Zone and cone footprints draw their exact committed mask/shape, never one ring per storage cell. | `[ratified]` (designer, 2026-08-06: "agree") |
| D11 | Post the Role lands at continuous body-clear points around the clicked point, and printer damage uses a true circular body-intersection test. This supersedes TACTICS_PLAN R5 only for these two visible mechanics; engagement/surprise and grid-authored objects keep their existing rules. | `[ratified]` (designer, 2026-08-06: "agree") |
| D12 | A movement `step` is world distance, not a tile or surface-cell boundary. Step-clock statuses and repeated surface exposure accumulate distance; entering a surface applies its entry beat immediately, then continued exposure retriggers at a world-distance interval scaled by Composure. Higher Composure therefore lets a character cover more ground before the next movement-triggered exposure; it does not suppress the initial entry beat. Placement excludes physical body footprints, while contact samples the feet. Fine resolution must not multiply damage, slips, status clocks, fire speed or loot. | `[ratified]` (designer, 2026-08-06: "shouldnt really matter if tiles or not that way" and "composure seems like the appropriate stat") |

## Milestones (each keeps `npm test` green)

**M1 - The corridor believes where the body stands.** `pathfinding.js`:
probe lines at a hair under `BODY_RADIUS` (touching a wall is legal, and the
exact-radius probe resolved onto the boundary and INTO the wall); the two
probe lines (never the centreline) forgive cells the body already legally
overlaps at the span's endpoints. `actors.js`: `setPath` documents its
path[0]-is-the-body precondition and refuses degenerate paths. Regression
tests pin the two verified traces: the walk-up elbow dart and the
wall-touching un-smoothing.

**M2 - One smoothing rule, derived from the route.** `routeOpen(base, path)`
in pathfinding.js unions the route's own cells into the smoothing
walkability (D7) - which also exempts the mover's start tile via the spliced
body point. The four predicate variants now each mirror THEIR router:
party-side combat smoothing blocks the teammates/summons `world.findPath`
blocked and fears the walker's own hazards (not the leader's); enemy-side
blocks the party/summon tiles `findEnemyPath` routed around (closing the
straighten-through-a-member hole); followers aim at jittered free formation
points instead of the grid ring around the leader; wanderers smooth from
their bodies instead of snapping back to tile centres each amble.

**M3 - Forced moves and aim land on bodies.** Shove/pull/swap landings
(`pushTo` callers) stop re-centring bodies onto exact tile centres - each
landing takes a `clampPoint`-style loose point while keeping the logical
tile the plan chose. `fx.projectile` origins/targets, `lunge` and
`faceTarget` read `posOf` bodies (hitFx already does). The take-cover
endpoint is already continuous on this branch (commit 648fe5b) - remaining
edge: a truncated (`!done`) own-tile cover shuffle commits the crouch while
the body is still gliding (combat.js:2330-2337).

**M4 - Octant inputs go continuous.** A direction-sector helper in
tactics.js quantizes the attacker->defender vector into the 8 octants around
the defender's BODY (raw `Math.sign` on continuous deltas would make every
attack read diagonal). Fed continuous positions at: `attackMods` (attacker,
defender, allies), `facesShieldFrom`, `shieldingFaceFrom` (shot block /
redirect), `aiCrouchCovered`, `pullPlan`'s face pick, `breakPlan`'s near-face
pick. Face *derivations* (`shieldedFaces` and friends) stay on tiles - D3.
The flank ally gate (`cheb <= 1`, tactics.js:273) becomes the same reach
test everything else migrated to. Dead `crouchShields` and its imports are
removed. `setFacing` keeps quantizing to the logical sign-vector (D9), fed
from continuous deltas.

**M5 - LOS body-to-body, circles for targeted.** Every gameplay `hasLos`
site passes continuous bodies (attacker AND target); blockers unchanged
(D6). `verbReaches` stops rounding the stand point and measures its range as
true distance, which fixes the walk-up stop point and the arrival promise in
one stroke (`trimToFirst` already samples continuously). Targeted ranges go
Euclid per the D4 inventory: attack/throw far-gates, zone/summon/buff/swap/
control aim ranges, `oocTargetOk`, breakPlan's ranged gates, the enemy-ring
ladder, and the aim wash flips with its gate (`rangeTiles` euclid for every
targeted verb, not just cones). The cone collapses to ONE geometry - body
origin, aimed point kept, the wedge itself as the only gate - in combat, in
`fireOocCone`, and in the `engageWithAction` opener (which currently re-aims
at the target's tile centre and gates on cheb + tile LOS while the preview
wedge is Euclid from a tile origin). Overwatch triggers on the same
continuous metric opportunity attacks use (question 3). Engagement and
`canTakePart` stay tile-based - who is IN the fight is an area question (D4).

**M7 - Bends hug corners and walk as curves.** Playtest feedback on M1-M6
(designer, 2026-07-31: "the rigidity of the paths is still aparent and
doesnt hug walls, seems to still be focused on them as waypoints"): string
pulling can only DROP vertices, so every bend it keeps sits on a raw route
vertex - a tile centre, half a tile off the wall it turns around. Grid
RESOLUTION is not the lever (a finer grid quantizes the same error smaller,
at multiplied route cost - ruled out; the 2x2 idea in question 2 was only
ever about surface visuals): the fix is making the bend continuous.
`tightenPath` slides each interior bend toward its neighbours' chord until
the body-radius corridor and the stand-clearance rule stop it - the bend
converges onto the obstacle corner at exactly body radius, the shape a
navmesh funnel produces - and `roundBends` replaces the point turn with a
short validated arc (samples clamped to legal standing room; a corridor too
tight to round keeps its sharp, legal turn). Both live inside `smoothPath`,
so every feeder - clicks, walk-ups, dashes, AI advances, followers,
wanderers - inherits them.

**M6 - The organic skin.** Ground-aimed verbs aim at the exact point: the
zone's covered cells derive from a disc at the clicked POINT (cells whose
centres fall inside - storage untouched); preview, rings and click all read
that same disc. Surface decals turned out to already be organic on this
branch line - liquids render as shared metaball pools with marching-squares
edges and per-cell hash wobble, paper/cable/gum as scatter styles, carpet
with hash tints - so the remaining grid-tracing layer was the aim wash,
whose chips now carry deterministic per-cell jitter (question 4). Storage,
conduction, spread, electrification: untouched (D5).

**M8 - The surface field is the rule.** The M6 playtest proved that a blobby
skin over movement-tile rules is still a tiled mechanic. Introduce one
integer-keyed fine surface field and normalize authored surface tiles into it
at level load. Every surface consumer reads the field: render mask, TPS Form
Storm and Bulk Mail placement, foot contact, distance clocks, travel/AP cost,
path smoothing, forced landings, fire/smoke, conduction, ignition, temporary
expiry and paper harvesting. Surface mutations produce one change set that
invalidates visuals, aim and routes together. `grid.typeAt` owns terrain and
objects only; it must never remain a parallel surface ledger.

Normal travel reports continuous segments. A surface contact tracker applies
the entry beat at bare-to-surface crossing and accumulates world distance for
repeat exposure and step-clock statuses, with Composure scaling the repeat
distance but never negating entry contact (D12); forced slides explicitly
resolve only their landing. Route straightening compares the integrated
surface cost of a shortcut with the path it replaces instead of opening an
entire chosen movement tile. TPS Form Storm carves every living body
footprint; Bulk Mail retains its intentional policy of carving the player side
while paper may settle beneath enemies. The same pure mask builder feeds
preview and commit.

The aim wash becomes a merged LOS-clipped mesh (D10). Summon placement searches
deterministic continuous body-clear points around its exact aim; the printer
blast uses a named world radius against body circles (D11). Surface resolution
never defines tuning: damage cadence, movement rates, spread speed, expiry and
harvest yield stay expressed in world distance/area/turns.

## Testing

- **Unit** (with each milestone): corridor endpoint-forgiveness scenarios,
  the two verified jut traces, `routeOpen` chosen-vs-avoided, sector
  quantization boundaries (a body drifting across a tile midline must NOT
  flip cover; one visibly rounding a corner must), euclid range gates at the
  rim, verbReaches from an unrounded stand point.
- **e2e**: a movement spec that samples the leader's position per frame
  during a post-interaction walk and bounds lateral deviation from the
  click line - the assertion that would have caught the jut; the existing
  tactics/cover/cone specs stay green through M4/M5.
- **Play**: straightening across a deliberately chosen spill remains a playtest
  question. Surface chunkiness and the square-chip wash were answered in the
  2026-08-06 playtest and promoted to D8/D10.

## Risks and open questions (engineering)

- **billMove's invariant is positional.** Callers reserve a verb's AP by
  subtracting from the COMBINED budget and rely on billMove draining the
  allowance first. Nothing here may reorder that (M2/M3 do not touch
  billing; noted so M5's walk-up changes don't either).
- **performDash is a fourth copy of the walk pipeline** and inherits every
  smoothing change through `world.smooth`; its flat `() => 1` rate is its
  own rule, untouched.
- **AI plan-vs-resolution agreement (M5).** The AI plans on tiles
  (standTilePath, routeIntoRange candidates - legitimately tile-shaped);
  arrival and trim must use the same unrounded `verbReaches` the strike
  uses, or walks stop where the shot then refuses.
- **The clamp-rounds-home invariant.** The continuous cover aim (648fe5b)
  relies on "a clamped point always rounds back to its own tile"
  (clampToClearance keeps points inside their cell). M1's corridor changes
  do not touch clampToClearance; anything that later does must re-prove it.
- **REFACTOR_PLAN.md:147's window**: the step-rules unification was not
  behavior-preserving; if a movement oddity survives this plan, that is the
  named suspect.
