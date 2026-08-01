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

Asked in-session on 2026-08-01; unanswered, so the plan proceeds on the
recommended defaults below, tagged `[proposed]`. These three set the plan's
shape — answers may resize milestones M1–M5.

**Q1 — What does "multifloor in a single level" mean mechanically?** The
stated scene is "a lobby with a lot of height, multifloor in what is really a
single 'floor' level."

- **A. Elevation terrain (recommended).** Every tile gets an elevation step;
  stairs connect heights; a mezzanine can ring a tall open lobby and overlook
  it. One hard constraint: *no walking under a walkable tile* — the space
  beneath the mezzanine is solid (offices you can't enter, reception backdrop,
  void). Medium cost: format, movement rules, renderer, picking, editor brush.
- **B. True stacked layers.** Full overlap — walk beneath the balcony. Delivers
  everything but touches every spatial system (grid keys, pathfinding nodes,
  LOS, camera, occlusion, editor layer UI); roughly 3–4× option A, the largest
  single feature this project would have taken on.
- **C. Cosmetic height only.** Tall ceilings and balcony scenery you can't
  reach. Cheap, but the lobby *plays* flat — no multifloor gameplay.

I'd pick A: it delivers the overlook, the sniper balcony, and the grand-lobby
feel at a cost the codebase can absorb, and the format below is designed so a
later catwalk/overlap extension (M5) adds walk-under without a rewrite. If the
answer is "I need to walk under the balcony on day one," M5 moves before M2
and the estimates grow.

**Q2 — Do different heights change combat math, or only geometry?**

- **A. LOS + reach only (recommended).** Height decides what you can see and
  shoot (no firing through the mezzanine slab; melee can't swing across a
  ledge) but grants no stat bonus. Consistent with the settled "tactics stay
  as shipped" record (TODO.md); bonuses can layer on later without rework.
- **B. DOS2-style damage bonus.** High ground boosts damage, low ground
  penalizes. Verified: DOS2's Huntsman ability adds +5% high-ground damage per
  point ([Fextralife wiki](https://divinityoriginsin2.wiki.fextralife.com/Huntsman));
  the *base* high/low-ground percentage is commonly reported around ±20% but I
  could not verify it in this session — treat that number as reported, not
  fact.
- **C. BG3-style to-hit nudge.** Release-version BG3 grants +2 to attack rolls
  from ≥2.5m above the target and −2 from below ([Game8](https://game8.co/games/Baldurs-Gate-III/archives/419653),
  [Escapist](https://www.escapistmagazine.com/how-high-ground-vs-low-ground-positioning-works-in-baldurs-gate-3/)) —
  this would slot into the existing to-hit `mods` stack beside facing, flank
  and cover, so the UI story already exists.
- **D. No cross-height combat.** Separate arenas per height. Cheapest, and
  almost certainly wrong for exactly the balcony scene this exists for.

I'd pick A for v1 and leave C as the obvious later layer if play wants a
positioning carrot: it's one modifier in `tactics.js` and the hit-breakdown UI
already itemizes modifiers.

**Q3 — Which quality-of-life gaps must ship this round?** The gap list itself
is confirmed — "yes youre seeing the gaps i do" `[stated]` (2026-08-01) — but
not which gaps are v1. Candidates: undo/redo, region copy/paste stamps,
NPC/companion/tiered-enemy brushes, save-directly-to-`levels/`. Recommended:
all four (they're each small-to-medium and M0 is independent of the height
work), cutting stamps first if the round needs to shrink.

## Decisions

| # | Decision | Status | Source / notes |
|---|---|---|---|
| 1 | The in-repo editor is the authoring tool; no external editor or importer | `[stated]` | designer, 2026-08-01: "i dont mind using ours if its easiest" after the PlayCanvas/Tiled comparison |
| 2 | Levels stay grid + legend + ASCII + edge runs; no freeform geometry | `[stated]` | designer, 2026-08-01: "we dont need full flexibility… no organic curves" |
| 3 | Verticality is required: tall single-level spaces with multifloor play | `[stated]` | designer, 2026-08-01: "a lobby with a lot of height, multifloor in what is really a single 'floor' level" |
| 4 | Verticality model: elevation terrain (per-tile height steps, no walk-under) | `[proposed]` | Q1; stands in for "how much of a real second storey do you need?" — if walk-under is required, M5 is promoted |
| 5 | Format: optional `"elev"` digit grid parallel to `"map"`; omitted ⇒ flat | `[proposed]` | every shipped level stays valid unchanged; see format section |
| 6 | Stairs are a tile type in `data/tiles.js`, not a new mechanism | `[proposed]` | content is data (ARCHITECTURE.md); the editor gets them as a brush for free |
| 7 | Movement: free step at Δelev 0; stairs bridge ±1; no hop/fall/jump in v1 | `[proposed]` | cheap reversible default; DOS2-style jumps are a later verb |
| 8 | Cross-height combat is LOS + reach only; no high/low-ground stat modifier | `[proposed]` | Q2; keeps the `[stated]` "tactics stay as shipped" record intact (TODO.md) |
| 9 | Editor QoL for v1: undo/redo, region stamps, actor brushes, save-to-disk | `[proposed]` | Q3; gap list itself confirmed by designer 2026-08-01 |
| 10 | Save-to-disk = dev-server endpoint writing `levels/<id>.json` + regenerated registry | `[proposed]` | dev-mode only; see M0. Cheap default, easily swapped for export-and-paste |

## The elevation model (decision 4, in detail)

**Format.** A level may carry an `"elev"` block: an array of strings, one row
per map row, one digit `0`–`9` per cell. Short rows and a missing block read
as `0`. Example fragment — a mezzanine (elev 2) ringing a ground-floor lobby,
joined by stairs (`/`):

```json
"map":  [ "..........",
          ".DDDD..../",
          ".........." ],
"elev": [ "2222222220",
          "2000000000",
          "2222222220" ]
```

One elevation step is `ELEV_UNIT` world units (tunable constant, first guess
0.75 — the existing `SIGHT_BLOCK_HEIGHT`, so one step already means "you can't
shoot over it from below"). A "lot of height" lobby is two or three steps, not
nine; digits 0–9 are headroom, not a target.

**Grid queries (`grid.js`).** `parseLevel` gains `elevAt(x, z)` (void and
out-of-bounds report 0). The existing rules compose with it rather than fork:

- `stepOpen` additionally requires the elevation rule of decision 7; diagonal
  steps require Δelev 0 on all four cells around the corner (same shape as the
  existing partition-corner rule).
- Sight: a blocker's effective top becomes `elev·ELEV_UNIT + def.height`, and
  a sightline's own height rides its endpoints' elevations. The M6a rule
  ("a desk is shot over, a snack machine is not") keeps working per-storey,
  and a mezzanine lip blocks sight from below exactly like a wall of its
  height would.
- Conduction: pools never join across Δelev ≠ 0 (spills don't flow uphill, and
  modelling downhill flow is out of scope — spills are static, as today).
- Edge walls/doors on an edge between different elevations sit on the higher
  cell's floor (a balcony railing is a partition on the mezzanine's edge).

**Pathfinding, actors, combat.** Dijkstra inherits legality from `stepOpen`,
so it needs no new theory — stairs are just the only edges where Δelev ≠ 0 is
passable, and AI naturally routes through them. Actors' world `y` becomes
`elevAt·ELEV_UNIT`, interpolated along stair traversal; `fx.js`'s `project3`
already projects arbitrary heights, so popups/overlays follow. Melee reach
adds a vertical term (no punching across a ledge); `aim-paint` and the AI's
firing-position search inherit correctness from the shared LOS/step queries —
that shared-primitives shape is the same one `tactics.js` uses so game and
editor cannot drift.

**Camera, occlusion, picking — the risky third.** `controls.js` currently
intersects clicks with the y=0 ground plane, and `occlusion.js` fades walls
between camera and character. Both need elevation awareness: click resolution
must pick the *highest* walkable surface under the cursor (front-most to the
camera), and mezzanine slabs + riser faces join the occluder set so the
character never vanishes behind their own balcony. This is the least
mechanical part of the work and gets its own milestone (M2) rather than
riding along.

## Milestones

Each lands green (unit + e2e) before the next starts. M0 is independent of
everything and can ship while Q1/Q2 are still open; M1 is safe under any Q1
answer (the format is shared); M2+ assume decision 4's model.

- **M0 — Editor quality of life** (`src/editor.js`, `serve.mjs`, `build.mjs`,
  `src/data/actor-registries.js`). Undo/redo (snapshot history of rows + edge
  sets; trivial at ≤40×40). Region select / copy / stamp for the
  repeated-cubicle workflow. Brushes for NPCs, companions and tiered enemies
  (closing the round-trip gap the load path already preserves). A metadata
  strip (name, `depth`, `next`). Save-to-disk: a dev-only `POST /api/level`
  in `serve.mjs` writing `levels/<id>.json`, with the registry regenerated
  from the directory so `src/data/levels.js` can't drift `[proposed]` —
  export-and-paste stays as the fallback path.
- **M1 — Elevation as data** (`levels/*.json` schema, `grid.js`,
  `pathfinding.js`, unit tests). Parse `elev`, expose `elevAt`, extend
  `stepOpen`/sight/conduction per the model above. Flat levels bit-identical
  in behavior; the level lint learns the new block.
- **M2 — Elevation rendered** (`tile-renderer.js`, `scene.js`, `occlusion.js`,
  `controls.js`, `picking.js`, `hover.js`, `actors.js`). Floor slabs at
  height, riser faces, stair ramps, elevated edge walls; occlusion and
  elevation-aware picking; actors walk stairs with `y` interpolation.
- **M3 — Combat across height** (`combat.js`, `tactics.js`, `aim-paint.js`).
  LOS with effective heights, vertical melee-reach gate, aim wash and AI
  firing positions correct on mezzanines. High/low-ground modifiers only if
  Q2 ratifies them — the hook (`hitChance` mods) already exists.
- **M4 — Editor authors elevation** (`src/editor.js`). Raise/lower brush,
  stairs brush, riser preview, digit overlay toggle, full load→edit→export
  round-trip and playtest at height.
- **M5 — Walk-under (gated on Q1).** Catwalk tiles carrying two walkable
  surfaces — a bounded second layer for balconies that overhang, without
  full stacked-layer generality. Not scheduled unless the designer wants it.

## Risks and open questions (engineering)

- `combat.js` is ~4.6k lines and geometry assumptions run through it; M3's
  blast radius is the main schedule risk. Mitigation: M1's queries are pure
  and unit-tested before combat touches them.
- The e2e suite clicks precise screen points via projection helpers; elevated
  test levels must use the same helpers or they'll be brittle. Flat levels'
  geometry is untouched, so the existing 100+ specs should not notice.
- Elevation-aware picking (highest-surface-wins vs camera ray) has real edge
  cases at riser faces and balcony lips; budget for it in M2, not as M4
  polish.
- Save-to-disk writes into the repo from a browser button; it stays behind
  the dev server only (`serve.mjs`), never the itch.io build.
