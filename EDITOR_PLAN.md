# Level Editor Expansion Plan

Grow the in-repo level editor (`src/editor.js`) and the level format it speaks
so the designer can author floors without hand-editing JSON — and so a single
"floor" can hold real vertical space: a tall lobby with a mezzanine overlooking
it. The editor stays ours: the designer weighed the official PlayCanvas Editor
and external grid tools (Tiled/LDtk) and chose the in-repo one `[stated]`
("i dont mind using ours if its easiest", 2026-08-01). The grid stays too:
"we dont need full flexibility, we dont have organic curves to construct or
anything like that" `[stated]` (2026-08-01). No code yet — this is the plan.

## Questions for the designer

Asked in-session on 2026-08-01. **Q1 is answered in direction**: the designer
proposed the layer-stack model this plan is now built around (see Q1's entry —
one explicit go still flips it to ratified). Q2 and Q3 remain open and the
plan proceeds on the recommended defaults, tagged `[proposed]`.

**Q1 — What does "multifloor in a single level" mean mechanically?** The
stated scene is "a lobby with a lot of height, multifloor in what is really a
single 'floor' level."

*Answered in direction by the designer (2026-08-01):* "construct them as full
floors with one layer/height setting and a procedurally generated staircase
tile/space on each layer? most of the editor difficulties would be resolved
at least, but i know combat/los especially would still have its issues to
deal with." The plan adopts this — see "The layer model" below — and the
designer's cost instinct held up under scrutiny: each layer is authored and
parsed as an ordinary flat map, so the editor grows a layer switcher rather
than an elevation UI, and the existing per-map rules (walls, doors,
conduction, within-floor movement) run per layer unchanged. Walk-under —
standing beneath the mezzanine — comes free, which the original per-tile
elevation recommendation structurally could not do. The honest remaining
cost is exactly where the designer pointed: cross-layer LOS and the camera
(M2/M3). One trade to confirm with the go: layers are **full storeys** — no
half-height daises, loading-dock steps, or ramps; if a sub-storey space ever
matters, that is a new question, not a silent extension. Status: model
`[proposed]` awaiting the explicit go; the quote above is the source it
ratifies against.

**Q2 — Do different heights change combat math, or only geometry?**

- **A. LOS + reach only (recommended).** Height decides what you can see and
  shoot (no firing through the mezzanine slab; melee never crosses layers)
  but grants no stat bonus. Consistent with the settled "tactics stay as
  shipped" record (TODO.md); bonuses can layer on later without rework.
- **B. DOS2-style damage bonus.** High ground boosts damage, low ground
  penalizes. Verified: DOS2's Huntsman ability adds +5% high-ground damage per
  point ([Fextralife wiki](https://divinityoriginalsin2.wiki.fextralife.com/Huntsman));
  the *base* high/low-ground percentage is commonly reported around ±20% but I
  could not verify it in this session — treat that number as reported, not
  fact.
- **C. BG3-style to-hit nudge.** Release-version BG3 grants +2 to attack rolls
  from ≥2.5m above the target and −2 from below ([Game8](https://game8.co/games/Baldurs-Gate-III/archives/419653),
  [Escapist](https://www.escapistmagazine.com/how-high-ground-vs-low-ground-positioning-works-in-baldurs-gate-3/)) —
  with full-storey layers, "any layer above" clears that bar, so the rule
  degenerates to a clean "+2 from the floor above / −2 from below" that slots
  into the existing to-hit `mods` stack beside facing, flank and cover.
- **D. No cross-layer combat.** Separate arenas per floor. Cheapest, and
  almost certainly wrong for exactly the balcony scene this exists for.

I'd pick A for v1 and leave C as the obvious later layer if play wants a
positioning carrot: it's one modifier in `tactics.js` and the hit-breakdown UI
already itemizes modifiers.

**Q3 — Which quality-of-life gaps must ship this round?** The gap list itself
is confirmed — "yes youre seeing the gaps i do" `[stated]` (2026-08-01) — but
not which gaps are v1. Candidates: undo/redo, region copy/paste stamps,
NPC/companion/tiered-enemy brushes, save-directly-to-`levels/`. Recommended:
all four (they're each small-to-medium and M0 is independent of the layer
work), cutting stamps first if the round needs to shrink.

## Decisions

| # | Decision | Status | Source / notes |
|---|---|---|---|
| 1 | The in-repo editor is the authoring tool; no external editor or importer | `[stated]` | designer, 2026-08-01: "i dont mind using ours if its easiest" after the PlayCanvas/Tiled comparison |
| 2 | Levels stay grid + legend + ASCII + edge runs; no freeform geometry | `[stated]` | designer, 2026-08-01: "we dont need full flexibility… no organic curves" |
| 3 | Verticality is required: tall single-level spaces with multifloor play | `[stated]` | designer, 2026-08-01: "a lobby with a lot of height, multifloor in what is really a single 'floor' level" |
| 4 | Verticality model: stacked full-storey layers, each authored as an ordinary flat map, with one height setting per layer | `[proposed]` | designer-proposed, 2026-08-01: "full floors with one layer/height setting"; flips to ratified on the explicit go (Q1) |
| 5 | Format: optional `"layers"` array, one entry per floor, bottom-up; a level without it is a single ground layer | `[proposed]` | every shipped level stays valid unchanged; see format section |
| 6 | Stairs: one marker tile on the lower layer; the staircase — ramp geometry, the carved opening above, the connection — is generated | `[proposed]` | designer-proposed, 2026-08-01: "a procedurally generated staircase tile/space on each layer" |
| 7 | Movement: within a layer as today; between layers only via stair portals; no hop/fall/jump in v1 | `[proposed]` | cheap reversible default; shoving someone off the balcony is a tempting later verb, not v1 |
| 8 | Cross-layer combat is LOS + reach only; no high/low-ground stat modifier | `[proposed]` | Q2; keeps the `[stated]` "tactics stay as shipped" record intact (TODO.md) |
| 9 | Editor QoL for v1: undo/redo, region stamps, actor brushes, save-to-disk | `[proposed]` | Q3; gap list itself confirmed by designer 2026-08-01 |
| 10 | Save-to-disk = dev-server endpoint writing `levels/<id>.json` + regenerated registry | `[proposed]` | dev-mode only; see M0. Cheap default, easily swapped for export-and-paste |
| 11 | Camera: cutaway — layers above the active character's floor are hidden, with markers for off-layer combatants | `[proposed]` | the genre-standard answer (X-COM, BG3); the readability risk lives here, see Risks |

## The layer model (decisions 4–7, in detail)

**Format.** A level may carry `"layers"`: an ordered array, ground floor
first. Each layer is authored exactly like a level is today — its own ASCII
`map`, its own `walls` and `doors` runs — plus an optional `height` in world
units ("one layer/height setting", per the designer) defaulting to a
`STOREY_H` constant. The tall lobby is the ground layer given extra height.
Legends (`tiles`, `actors`) are shared level-wide. A level with no `"layers"`
block is a single ground layer, so both shipped floors and every editor
export stay valid unchanged.

**Void is airspace.** The format already has a hole character: space. In an
upper layer, void cells are open air over whatever is below — the "lot of
height" lobby is authored by leaving layer 1 empty above it, with the
mezzanine ring drawn as ordinary floor around the void. Sight and shots pass
through void; floor slabs block. The airspace the designer described is
expressible with zero new syntax.

**Parsing.** `parseLevel` runs once per layer, unchanged in its internals —
walls, doors, conduction pools, prop damage, and within-floor movement are
all per-layer concerns and keep their current code and tests. The game
currently builds exactly one grid (`main.js:119`) and threads it through
combat/tactics/scene; that becomes one grid per layer behind a thin router:
actors carry a `layer` index, within-layer queries go to that layer's grid,
and only the genuinely cross-layer questions (sight, targeting, stair
traversal) know more than one floor exists.

**Stairs.** The designer authors a single stair marker tile on the *lower*
layer. Generation does the rest: carve the stairwell opening in the layer
above (a load-time validation error if that space is occupied — never a
silent head-bonk), orient the run from the open neighbours on both floors,
emit the ramp geometry and the portal edge that pathfinding uses. Default
footprint: two tiles of run per storey `[proposed]` — a single-tile storey
climb reads as a ladder. Dijkstra needs no new theory: per-layer graphs
joined by portal edges, and AI routes through stairs for free.

**Combat and LOS.** Within a layer, every shipped rule applies verbatim.
Across layers, one new primitive carries the load: a 3D sightline sampled
against upper-layer floor slabs (block), void (open), and each layer's
blockers under the existing chest-high rule ("a desk is shot over, a snack
machine is not"). Aim-paint, the AI's firing-position search, and throw
targeting all consume that primitive, so game and editor cannot drift. Melee
never crosses layers. High/low-ground modifiers only if Q2 ratifies them.

**Camera, picking, rendering.** Each layer renders as today, offset to its
base height, plus underside slabs so the mezzanine reads as a ceiling from
below. With true overlap, fading individual occluders can't save you —
standing under the balcony puts a whole floor between camera and character —
so the camera cuts away: layers above the active character's floor hide
(decision 11), off-layer combatants get edge markers, and clicks resolve
against the active layer with an explicit flip when selecting a unit on
another floor.

## Milestones

Each lands green (unit + e2e) before the next starts. M0 is independent of
everything and can ship while the Q1 go and Q2/Q3 are pending.

- **M0 — Editor quality of life** (`src/editor.js`, `serve.mjs`, `build.mjs`).
  Undo/redo (snapshot history of rows + edge sets; trivial at ≤40×40). Region
  select / copy / stamp for the repeated-cubicle workflow. Brushes for NPCs,
  companions and tiered enemies (closing the round-trip gap the load path
  already preserves). A metadata strip (name, `depth`, `next`). Save-to-disk:
  a dev-only `POST /api/level` in `serve.mjs` writing `levels/<id>.json`,
  with the registry regenerated from the directory so `src/data/levels.js`
  can't drift `[proposed]` — export-and-paste stays as the fallback path.
- **M1 — Layers as data** (`levels/*.json` schema, `grid.js`,
  `pathfinding.js`, unit tests). The `layers` block, per-layer parse, the
  grid router, stair generation + validation, portal-edge pathfinding.
  Single-layer levels bit-identical in behavior; the level lint learns the
  new block.
- **M2 — Layers rendered** (`tile-renderer.js`, `scene.js`, `occlusion.js`,
  `controls.js`, `picking.js`, `actors.js`). Stacked rendering with underside
  slabs, generated stair geometry, the cutaway camera, layer-aware picking,
  actors traversing stairs with height interpolation. Prototype the cutaway
  *first* — it is the plan's biggest unknown.
- **M3 — Combat across layers** (`combat.js`, `tactics.js`, `aim-paint.js`).
  The cross-layer sightline primitive and everything that consumes it: aim
  wash on two floors, AI routing to stairs and picking targets it can
  actually see. High/low-ground modifiers only if Q2 ratifies them — the
  hook (`hitChance` mods) already exists.
- **M4 — Editor authors layers** (`src/editor.js`). Layer switcher tabs,
  add/remove layer, per-layer height field, stair marker brush with live
  validation, and an onion-skin ghost of the layer below while painting an
  upper floor. Deliberately small — the point of the layer model is that
  painting a floor IS the editor's existing job.

## Risks and open questions (engineering)

- `combat.js` is ~4.6k lines and geometry assumptions run through it; M3's
  blast radius is the main schedule risk. Mitigation: the sightline primitive
  is pure and unit-tested in M1/M2 before combat consumes it.
- The cutaway camera is the design risk the layer model buys its simplicity
  with: a fight split across floors must stay readable while the upper floor
  is hidden. Prototype early in M2; if markers aren't enough, a ghosted
  see-through mode is the fallback.
- The cross-layer sightline is the correctness hot spot (balcony lips, shots
  grazing the slab edge, void boundaries). Property-style unit tests over
  hand-built two-layer fixtures before any renderer work consumes it.
- The e2e suite clicks precise screen points via projection helpers; layered
  test levels must use the same helpers or they'll be brittle. Single-layer
  levels' geometry is untouched, so the existing 100+ specs should not
  notice.
- Save-to-disk writes into the repo from a browser button; it stays behind
  the dev server only (`serve.mjs`), never the itch.io build.
