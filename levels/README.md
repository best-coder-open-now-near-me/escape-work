# levels/

One JSON file per floor. `src/grid.js` (`parseLevel`) is the authority on what
these mean; this file is the authoring recipe.

Most floors are painted in the in-repo editor (`#editor`, or the link on the
class picker) and exported. **Multi-storey floors are the exception: the editor
cannot author storeys yet (EDITOR_PLAN M4) and refuses to open a layered level
rather than flattening it.** Until it can, the recipe below is how you write one
by hand. `dev/spike-lobby.json` is the worked example.

## A flat level

```json
{
  "name": "Floor 1 — Cubicle Row",
  "depth": 1,
  "next": "level2",
  "tiles":  { ".": "floor", "#": "wall", ">": "exit" },
  "actors": { "@": "player", "M": "manager" },
  "map":    ["#####", "#@.M#", "#...>", "#####"],
  "walls":  ["H 1 2 3", "V 4 1 2"],
  "doors":  ["V 2 1"]
}
```

- **`map`** is one character per cell. A character means whatever this level's
  own legends say — `parseLevel` checks `actors` first, then `tiles`, and
  anything unrecognised is floor. A space is **void**: a hole, impassable and
  not drawn.
- **`tiles` / `actors`** are per-level legends. A registry's own `char`
  (`data/tiles.js`, `data/enemies.js`) is a *preferred* hint the editor takes
  when it is free, not a rule — the lint only requires that a character means
  one thing in one level and that a tile never borrows an actor's character.
- **`actors`** values are `"<id>"` or `"<id>@<tier>"`. The tier is how a floor
  asks for a tougher body: `"Z": "manager@2"` is a Manager at level 2. **This is
  the only way to make a floor harder** — enemies do not scale with `depth`
  (PROGRESSION_PLAN decisions 13–14). A tiered placement needs its own
  character, since the untiered one already means something else.
- **`depth`** is the floor's number. The lint checks it and the editor
  round-trips it; nothing at runtime derives a stat from it.
- **`next`** names the file the exit leads to; omit it for a terminal floor.
- **`walls` / `doors`** are edge runs — `"H x z len"` or `"V x z len"`, `len`
  optional and defaulting to 1. They sit *between* tiles, not on them. A door
  replaces a wall on the same edge.

A new file is not in the game until it is registered in `src/data/levels.js`
(the id is the filename). `npm test` fails until it is.

## A multi-storey level

Add a `"layers"` array: one entry per storey, **ground floor first**. Each entry
is authored exactly like a flat level — its own `map`, `walls`, `doors` — plus
an optional `height`. The legends (`tiles`, `actors`) stay level-wide, at the
top. A level with no `"layers"` is a single ground storey, so every flat file
above stays valid unchanged.

```json
{
  "name": "Spike — Atrium Lobby",
  "depth": 1,
  "tiles":  { ".": "floor", "i": "it-floor", "X": "stairway", "#": "wall" },
  "actors": { "@": "player" },
  "layers": [
    { "height": 2.6, "map": ["iiiii", "i@.Xi", "iiiii"] },
    {                "map": ["##   ", "##  #", "#####"] }
  ]
}
```

Four things decide whether it works:

1. **`height` is the rise ABOVE that storey**, not the storey's own ceiling
   (`src/floors.js`). Put the tall number on the *ground* storey to get a tall
   lobby. It defaults to `STOREY_H`.
2. **Void is airspace.** A space in an upper storey is open air over whatever is
   below — that is how you get an atrium. Draw the mezzanine as ordinary floor
   around the hole. Sight and shots pass through void; floor slabs block.
3. **Stairs are generated from a marker run.** Paint `stairway` cells on the
   *lower* storey; `floors.js` orients the flight, carves the opening above and
   emits the portal that pathfinding uses. The run's length is however many
   cells you paint — three reads well, one reads as a ladder.
4. **The validations are loud on purpose.** `floors.js` throws a named error if
   the space above a stair run is occupied, if a run has no open neighbour to
   climb from, or if a layer's map disagrees in size. A load-time error naming
   the level beats a silent head-bonk.

Actors above the ground storey are refused for now (`parseFloors`), as are doors
and interactable props on upper storeys — EDITOR_PLAN M1 owns those.

## Where levels are validated

`tests/unit/levels.test.js` lints every file in this directory (not `dev/`):
it parses, checks the player spawn and a reachable exit, checks every map
character is declared, checks run bounds, and checks `depth` and `next`.
`tests/unit/floors.test.js` separately parses `dev/spike-lobby.json` and
exercises the stair generation and cross-storey routing.
