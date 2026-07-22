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
                     edge-wall + door runs ("H x z len" / "V x z len")
src/
  data/              CONTENT registries (pure data)
    tiles.js           tile types: solidity, size, color, onEnter effects
    surfaces.js        surface layer (water/coffee/cable): effects, slow,
                       conduction pools + electrification interactions
    enemies.js         enemy types: stats, model, attack sets, loot, flavor
    classes.js         player classes: base stats + action ids
    actions.js         combat actions: attack/defend/heal definitions
    items.js           items + container loot tables (heal/ammo/bonusDmg/flavor)
  grid.js            Level parsing, terrain + edge-wall queries (pure logic)
  pathfinding.js     8-dir Dijkstra, string-pulling smoother, free-point
                     clamping, distance-budget truncation      (pure logic)
  stats.js           Character sheet, XP/levels, damage       (pure logic)
  actors.js          GridActor base -> PlayerActor, EnemyActor; smoothed
                     any-angle waypoint movement for everyone; procedural
                     animation layer (walk bob, lunge, flinch, death topple)
  scene.js           Engine boot + lighting; buildLevel assembles the scene
  shading.js         The look: toon bands, ink outlines, materials, post FX
  tile-renderer.js   Shared game/editor tile renderer (pools, props, edge
                     walls) + carpet-zone inference
  models.js          .glb loading, anim graph wiring, character proportions
  fx.js              Cosmetic combat FX (projectiles, damage popups) and the
                     world -> CSS-pixel projection every DOM overlay uses
  controls.js        Camera rig + mouse -> semantic input (click tile, menu)
  combat.js          Tactical on-map combat: AP turns, movement, multi-enemy,
                     ranged/melee, enemy AI phase - all costs from data
  looting.js         Containers, bodies, loose items, pockets, Alt overlay
  ui.js              All DOM: HUD, context menu, overlays, shared chrome
  editor.js          In-browser level editor (paint/erase, export, playtest)
  main.js            Entry point: routes game vs #editor, owns game flow
  index.html         Shell; loads engine + bundle
build.mjs            esbuild bundle + static copies -> build/web/
tests/unit/          node --test suite for the pure modules + level linting
tests/e2e/           Playwright smoke tests driving the real game headless
assets/              .glb models + shared textures (CC0, see CREDITS.md)
```

## Layering

- `data/*` imports nothing.
- `grid`, `pathfinding`, `stats`, `surfaces-runtime` are pure JS (no
  PlayCanvas, no DOM) - unit tested in isolation (tests/unit).
- `scene`, `shading`, `tile-renderer`, `models`, `controls`, `actors` touch
  PlayCanvas; `ui`, `combat`, `looting` touch the DOM; `fx` touches both
  (world-tracking popups).
- Only `main.js` sees everything. It owns game state (`inCombat`, `gameOver`)
  and game flow (what a click means, when combat starts, tile effects).
- Enemy AI decisions (pathing costs, wander avoidance) use a talent-free
  hazard model - the player's talents discount only the player's own costs,
  never what enemies fear.

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
  chest height: combat throws sail OVER them (`hasLos` is terrain +
  `grid.sightOpen`), and `#` cell walls still exist for solid blocks that
  also stop throws.
- **Doors live on edges too** ("doors" runs in the level JSON; a door
  replaces any wall on its edge). Closed doors block movement AND sight
  (they go floor to frame); conduction ignores them - water finds the gap
  underneath, so pools stay static. Click a door (or its Alt label) to walk
  up and toggle it; state lives in `grid.doors`, visuals re-render via
  `scene.refreshDoor`. Enemies don't open doors. The editor has a door
  brush next to the partition brush.
- **Movement is free-form, the grid is the data model.** Actors stand at
  continuous points (a click walks you to the exact spot, clamped clear of
  walls by `clampToClearance`); routes come from grid Dijkstra and are
  string-pulled by `smoothPath` into any-angle runs. The logical tile is
  DERIVED from the continuous position (rounded) and drives everything
  tile-keyed: surfaces, hazards, adjacency, LOS, combat triggers.
- **Actors**: extend `GridActor` for anything that lives on the grid and owns
  a model (it provides smoothed waypoint-path movement, shove glides via
  `pushTo`, and facing). The holder entity
  carries position/facing; the model child inside carries procedural animation
  (distance-driven walk bob, `lunge()`, `flinch()` with a per-instance red
  flash, death topple) - so animation can never fight movement.
- **Combat actions**: an action's id doubles as its DOM id (`#act-<id>`), which
  the test suite relies on. Weapons/items later = modifying a sheet's action
  list or the entries it points to.
- **Tests**: `npm test` runs the unit suite (node --test, tests/unit/) over
  the pure modules and lints the shipped levels against the registries.
  `npm run test:e2e` runs Playwright smoke tests (tests/e2e/) that build the
  game and drive it with real mouse input in headless Chromium; CI
  (.github/workflows/ci.yml) gates every PR on both. Set CHROMIUM_PATH to a
  local Chromium to skip Playwright's browser download.
- **Debug/test surface**: `window.__game` / `window.__combat` /
  `window.__editor` expose read-only state; the e2e tests assert against
  them and click through their `project()` helpers (CSS pixels). Keep them
  in sync when adding state.

## Growth paths (where things plug in)

- **New enemy**: entry in `data/enemies.js` + character in a level's `actors`
  legend + a .glb in `assets/characters/`.
- **New hazard/tile**: entry in `data/tiles.js` + character in `tiles` legend.
- **New surface** (the Divinity layer): entry in `data/surfaces.js` + a tile
  type carrying it. Surfaces slow, damage, bleed, arm you, trip you
  (`slippery`: wet floors end a walk mid-stride), stick to you (gum wads are
  one-shot mines: `onEnter.applies: 'gum'` slows the victim, disables
  `footwork` actions, but grants slip-proof traction until it wears off -
  Managers can also flick gum at you in combat), editorialize - and
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
  paperCutImmune, shockImmune, slipImmune, surfaceDamageResist, hasLighter,
  grantsAction.
- **Thrown weapons**: actions with `ammoCost` (paper balls/airplanes) join the
  combat bar automatically; ammo (sheet.paper) is picked up from paper spills.
  Throws render as arcing projectiles with fading trails (`throwProjectile` in
  fx.js); all damage/heals show floating popups (`spawnDamageText`). The
  FX layer is purely cosmetic - gameplay resolves instantly.
- **Combat** is tactical and on-map: each action in `data/actions.js` carries
  an `ap` cost; classes/enemies have per-turn AP budgets, and each enemy
  type's swing cost is its `attackAp` (data/enemies.js). Movement is priced
  by DISTANCE for both sides - 1 AP per tile-length along the smoothed
  route, scaled by a surface's `slow` (coffee at 0.5 costs double), stopping
  at any point when the budget runs out (`truncateByBudget`); hovering the
  floor previews the route and cost. Melee needs adjacency (clicking a
  distant enemy walks you in), throws need range 5 + line of sight. Enemies
  within 4 tiles join the fight (those beyond 2 are surprised and lose their
  first turn); attacking a bystander outside that radius pulls them in,
  surprised. Enemies have persistent map HP (EnemyActor.hp), take surface
  damage, and act in a sequenced AI phase. The player can Shove (2 AP): push
  an adjacent enemy one tile away - into a wall for a slam, or into whatever
  surface is waiting for them. Fire keeps burning during combat; printer
  explosions still resolve (combat prunes the dead).
- **New furniture/prop**: a tile entry with `model` (a .glb under `assets/`) and
  `solid: true` - it blocks movement and renders as the model in both game and
  editor. Props are level data, never hardcoded set dressing.
- **New floor**: another JSON in `levels/` registered in `data/levels.js`; set
  the previous floor's `next` to its id. Exits mid-campaign show FLOOR CLEAR
  and carry the character sheet to the next floor (progress persists in
  localStorage); the last floor's exit wins the run.
- **Items/looting**: `data/items.js` holds ITEMS and LOOT_TABLES. A tile type
  with `loot: '<table>'` (+ `label`) is rummageable - trash cans, printers,
  desks; enemies with a `loot` list leave lootable bodies (corpses persist).
  Hold **Alt** for BG3-style clickable labels over everything lootable
  nearby; clicking a label or the object walks you into reach and loots.
  **I** (or the bag button) opens the pockets: use (heal/ammo), examine, or
  drop - drops become loose floor items the overlay sees. Effects the code
  understands: `heal`, `ammo`, `bonusDmg` (passive while carried, best item
  counts - see `damageBonus` in stats.js). `sheet.inventory` persists across
  floors with the campaign save.
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
