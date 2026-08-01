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
2. **Surface look: is the per-tile chunkiness gone after M6's presentation
   pass, or do surfaces need a finer grid?** M6 keeps surfaces stored per
   movement tile and makes only the *rendering* organic. If spills still read
   as squares afterward, the follow-up is a 2x2 surface subgrid (quantum 0.5,
   DOS2's ratio) that only surfaces see. Do not build it speculatively.
   `[proposed]`
3. **Overwatch: does the watch circle go Euclidean with everything else?**
   It is a reaction range, so "circles for targeted" (D4) says yes, and M5
   also moves its trigger to the same continuous metric opportunity attacks
   already use. Implemented per this recommendation - flagged because it
   changes when overwatch fires; the revert is one gate. `[proposed]`
4. **The aim wash's look.** M6 jitters the wash's per-tile chips (nudge,
   turn, size - deterministic per cell) so its edge stops tracing the grid;
   the old dead-square look's stated rationale ("the seams are the grid the
   aim thinks in") went stale when M5 made the aim think in circles from the
   body. Needs eyes; the alternative is a merged soft-edged region
   (pool-style marching squares), a bigger renderer change. `[proposed]`

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
| D4 | Targeted verb ranges become true-distance circles, measured body-to-body: throws, straws, zone/summon/buff/swap/control aim ranges, walk-up stop points. Area/engagement footprints stay Chebyshev/ring-shaped: ENGAGE_RADIUS, SURPRISE_RADIUS, summon drop rings, AI adjacency (TACTICS_PLAN R5 upheld; R6's deferral superseded). Zone *footprints* were already Euclid discs (powers.js zoneTiles). | `[stated]` (designer, 2026-07-31: "yes do circles for targeted") |
| D5 | Tile-keyed effect storage stays; the PRESENTATION goes organic. Verified: DOS2 stores surfaces as integer cell sets on its 0.5m AI grid (ositools Surface.h: `SurfaceCell { i16vec2 Position }`; docs.larian.game AI grid) under a blobby rendered skin - the benchmark organic look is this architecture. | `[stated]` (designer, 2026-07-31: "you just dont get the organic look that way no matter what" - resolved by the looked-up evidence into: change the skin, keep the data) |
| D6 | LOS is measured body-to-body; BLOCKERS stay grid-shaped (door edges, smoke cells, tall solids - world objects the grid legitimately models). `segmentClear` already takes continuous coordinates; the work is the ~30 call sites. | `[ratified]` (proposed in review, approved in the designer's blanket "complete all of the work weve identified", 2026-07-31) |
| D7 | Smoothing straightens across hazard cells the route CHOSE, never ones it avoided (`routeOpen`). | `[proposed]` - implemented per recommendation; question 1 above |
| D8 | Surfaces subgrid 2x2 only if chunkiness survives M6. | `[proposed]` - question 2 above |
| D9 | Facing stays the LOGICAL sign-vector combat writes at act/move time, never the model's eased visual yaw - a damage rule cannot hang off a cosmetic tween (TACTICS_PLAN #5). Unchanged by M4. | `[stated]` (standing decision, reaffirmed in review) |

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
- **Play**: questions 1 and 2 are playtest questions; no spec can answer
  "does it read right".

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
