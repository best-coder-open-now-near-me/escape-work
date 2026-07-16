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
levels/*.json        Hand-editable levels: tile legend, actor legend, ASCII map
src/
  data/              CONTENT registries (pure data)
    tiles.js           tile types: solidity, size, color, onEnter effects
    enemies.js         enemy types: stats, model, attack sets, flavor
    classes.js         player classes: base stats + action ids
    actions.js         combat actions: attack/defend/heal definitions
  grid.js            Level parsing + terrain queries          (pure logic)
  pathfinding.js     8-dir Dijkstra, corner-cut safe          (pure logic)
  stats.js           Character sheet, XP/levels, damage       (pure logic)
  actors.js          GridActor base -> PlayerActor, EnemyActor (PlayCanvas)
  scene.js           Engine boot, tile meshes, occlusion fade, model loading
  controls.js        Camera rig + mouse -> semantic input (click tile, menu)
  combat.js          Turn-based encounter runner, fully data-driven
  ui.js              All DOM: HUD, context menu, win/lose overlays
  main.js            Entry point: wires modules, owns game flow only
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
- **Actors**: extend `GridActor` for anything that lives on a tile and owns a
  model (it provides slide-to-tile movement and facing).
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
- **Weapons/items**: extend `data/actions.js`; equipping = swapping ids in
  `sheet.actions` (see `stats.js`).
- **New class**: entry in `data/classes.js`; a class picker would call
  `createSheet(classId)`.
- **New level**: another JSON in `levels/` + a loader/transition in `main.js`
  (currently hardwired to level1).
