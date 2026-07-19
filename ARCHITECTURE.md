# Architecture

Escape Work is a code-first PlayCanvas CRPG. The whole game lives in this repo:
esbuild bundles `src/`, the PlayCanvas engine ships as its prebuilt UMD build,
and CI deploys `build/web/` to itch.io (`.github/workflows/deploy.yml`).

## The one rule

**Content is data, code is systems.** Adding an enemy, tile, hazard, class, or
combat action means adding an entry to a registry in `src/data/` and (for map
content) a character in a level's legend. Engine and game-flow code should not
need to change.

## Module map

```
levels/*.json        Hand-editable levels: tile legend, actor legend, ASCII map,
                     edge-wall runs ("H x z len" / "V x z len")
src/
  data/              CONTENT registries (pure data)
    tiles.js           tile types: solidity, size, color, onEnter effects
    surfaces.js        surface layer (water/coffee/cable): effects, slow,
                       conduction pools + electrification interactions
    enemies.js         enemy types: stats, model, attack sets, flavor
    classes.js         player classes: base stats + action ids
    actions.js         combat actions: attack/defend/heal definitions
  grid.js            Level parsing, terrain + edge-wall queries (pure logic)
  pathfinding.js     8-dir Dijkstra, corner-cut + edge-wall safe (pure logic)
  stats.js           Character sheet, XP/levels, damage       (pure logic)
  actors.js          GridActor base -> PlayerActor, EnemyActor; procedural
                     animation layer (walk bob, lunge, flinch, death topple)
  scene.js           Engine boot, tile meshes, occlusion fade, model loading,
                     combat FX (thrown projectiles + trails, damage popups)
  controls.js        Camera rig + mouse -> semantic input (click tile, menu)
  combat.js          Tactical on-map combat: AP turns, movement, multi-enemy,
                     ranged/melee, enemy AI phase - all costs from data
  ui.js              All DOM: HUD, context menu, win/lose overlays
  editor.js          In-browser level editor (paint/erase, export, playtest)
  main.js            Entry point: routes game vs #editor, owns game flow
  index.html         Shell; loads engine + bundle
build.mjs            esbuild bundle + static copies -> build/web/
assets/              .glb models + shared textures (CC0, see CREDITS.md)
```

## Layering

- `data/*` imports nothing.
- `grid`, `pathfinding`, `stats` are pure JS (no PlayCanvas, no DOM) - unit
  testable in isolation.
- `scene`, `controls`, `actors` touch PlayCanvas; `ui`, `combat` touch the DOM.
- Only `main.js` sees everything. It owns game state (`inCombat`, `gameOver`)
  and game flow (what a click means, when combat starts, tile effects).

## Conventions

- **Tile effects**: `TILE_TYPES[x].onEnter` — `{ effect: 'exit' }` fires only on
  deliberate arrival (end of a path); `{ effect: 'damage', ... }` fires on every
  step. New effect kinds are added in `main.js`'s `onPlayerStep`.
- **Walkability** is layered: `grid.terrainOpen` (static terrain) + living
  enemies (dynamic) = `isWalkable` in `main.js`. Pass `isWalkable` into
  `findPath`; never re-implement it.
- **Walls live between tiles.** Rooms and cubicles are edge walls ("walls" in
  the level JSON; `grid.hWalls`/`vWalls`), so a wall costs no floor space.
  `grid.edgeOpen(x,z,nx,nz)` answers one boundary; `grid.stepOpen` answers a
  full (possibly diagonal) step. Pathfinding, path smoothing, wander AI,
  shoves, conduction pools and fire spread all consult them. Partitions are
  chest height: combat throws sail OVER them (`hasLos` stays terrain-only),
  and `#` cell walls still exist for solid blocks that also stop throws.
- **Actors**: extend `GridActor` for anything that lives on a tile and owns a
  model (it provides slide-to-tile movement and facing). The holder entity
  carries position/facing; the model child inside carries animation. The
  character .glbs ship fully rigged with 32 clips - `placeModel(...,
  {animated: true})` wires them into an anim component and actors resolve a
  clip state each frame (die > gesture > attack-melee > walk/sprint > idle;
  `die` leaves the corpse where it fell). `flinch()` (squash + per-instance
  red flash) layers on top; a procedural bob remains as the fallback for
  clip-less models. Animation never fights movement.
- **Combat actions**: an action's id doubles as its DOM id (`#act-<id>`), which
  the test suite relies on. Weapons/items later = modifying a sheet's action
  list or the entries it points to.
- **Debug/test surface**: `window.__game` exposes read-only state; headless
  Playwright tests drive real mouse input against it. Keep it in sync when
  adding state.

## Growth paths (where things plug in)

- **New enemy**: entry in `data/enemies.js` + character in a level's `actors`
  legend + a .glb in `assets/characters/`.
- **New hazard/tile**: entry in `data/tiles.js` + character in `tiles` legend.
- **New surface** (the Divinity layer): entry in `data/surfaces.js` + a tile
  type carrying it. Surfaces slow, damage, bleed, arm you, editorialize - and
  interact: `conducts` surfaces pool via flood fill (grid.js) and a pool
  touching a `powers` surface is electrified; `flammable` surfaces burn.
  Characters path around expensive surfaces (per-surface `pathCost`);
  smoothing never cuts through damaging cells.
- **Fire** (`surfaces-runtime.js`): the dynamic layer. Ignitable props (trash
  cans, via right-click; the Smoker talent can light any flammable surface)
  start fires that spread through flammables, burn out, and detonate
  `explosive` props (printers) - explosions damage the player, kill adjacent
  enemies for XP, and destroy the prop (grid.setType).
- **Talents**: per-class in `data/classes.js` (shown on the resume cards).
  Effects the code understands: paperDamageBonus, paperAmmoDiscount,
  paperCutImmune, shockImmune, surfaceDamageResist, hasLighter, grantsAction.
- **Thrown weapons**: actions with `ammoCost` (paper balls/airplanes) join the
  combat bar automatically; ammo (sheet.paper) is picked up from paper spills.
  Throws render as arcing projectiles with fading trails (`throwProjectile` in
  scene.js); all damage/heals show floating popups (`spawnDamageText`). The
  FX layer is purely cosmetic - gameplay resolves instantly.
- **Combat** is tactical and on-map: each action in `data/actions.js` carries
  an `ap` cost; classes/enemies have per-turn AP budgets. Moving costs 1 AP a
  tile (2 through sticky surfaces), melee needs adjacency (clicking a distant
  enemy walks you in), throws need range 5 + line of sight. Enemies within
  5 tiles join the fight, have persistent map HP (EnemyActor.hp), take
  surface damage, and act in a sequenced AI phase. Everyone can Shove (2 AP):
  push an adjacent enemy one tile away - into a wall for a slam, or into
  whatever surface is waiting for them. Walking OUT of melee reach provokes
  an attack of opportunity - a free basic strike, one reaction per combatant
  per round (surprised enemies get none; shoves are forced movement and never
  provoke). Fire keeps burning during combat; printer explosions still
  resolve (combat prunes the dead).
- **New furniture/prop**: a tile entry with `model` (a .glb under `assets/`) and
  `solid: true` - it blocks movement and renders as the model in both game and
  editor. Props are level data, never hardcoded set dressing.
- **New floor**: another JSON in `levels/` registered in `data/levels.js`; set
  the previous floor's `next` to its id. Exits mid-campaign show FLOOR CLEAR
  and carry the character sheet to the next floor (progress persists in
  localStorage); the last floor's exit wins the run.
- **Weapons/items**: extend `data/actions.js`; equipping = swapping ids in
  `sheet.actions` (see `stats.js`).
- **New class**: entry in `data/classes.js` (stats, model, action ids) - the
  boot-time class picker (`ui.showClassPicker`) renders cards straight from the
  registry, so new classes appear automatically.
- **New level**: paint it in the built-in editor (link on the class picker, or
  `#editor`) and Export the JSON into `levels/`; playtest instantly via the
  localStorage stash. Registries drive the editor palette, so new tile/enemy
  types are paintable automatically (each registry entry carries its canonical
  map `char`). The `partition` brush paints the tile EDGE nearest the click
  (right-click erases it); exports collapse edges into compact
  `"H/V x z len"` runs via `compressWallRuns`.
