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
    npcs.js            non-hostile actors you TALK to: name, model, dialogue tree
    companions.js      recruitable coworkers: an NPC-shaped presence plus a
                       class-shaped stat block; dialogue options can carry
                       effect: { recruit } to sign them onto the party
  grid.js            Level parsing, terrain + edge-wall queries (pure logic)
  pathfinding.js     8-dir Dijkstra, string-pulling smoother, free-point
                     clamping, distance-budget truncation      (pure logic)
  stats.js           Character sheet, XP/levels, damage       (pure logic)
  party.js           The roster: members (sheet + actor), the active
                     leader, XP fan-out, campaign-save format + the
                     legacy-save migration                    (pure logic)
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
  picking.js         Screen pixel -> interactable ENTITY under it (ray vs the
                     registered doors/enemies/NPCs/props), not just the floor
  combat.js          Tactical on-map combat: per-unit INITIATIVE order, AP
                     turns, movement, ranged/melee, AI-driven units - costs
                     from data
  initiative.js      Combat turn order: d20 + speed roll, sort, joiner
                     insertion                                (pure logic)
  looting.js         Containers, bodies, loose items, pockets, Alt overlay
  ui.js              All DOM: HUD, context menu, overlays, shared chrome
  god.js             God-mode tweak panel (` / F8): live-reflects the sheet,
                     enemies, combat + world; edit/pin values, pause, spawn
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
- `grid`, `pathfinding`, `stats`, `party`, `surfaces-runtime` are pure JS (no
  PlayCanvas, no DOM) - unit tested in isolation (tests/unit).
- `scene`, `shading`, `tile-renderer`, `models`, `controls`, `picking`,
  `actors` touch PlayCanvas; `ui`, `combat`, `looting` touch the DOM; `fx`
  touches both (world-tracking popups).
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
- **Left-click is contextual (Divinity-style): the target picks the verb.**
  `picking.js` ray-tests the cursor against registered interactable holders
  (doors, living enemies, NPCs, rummageable props) and returns the nearest
  hit; `main.js`'s `dispatchHit` maps its `kind` to a verb - attack a
  coworker, talk to an NPC, open a door, rummage a prop - falling back to the
  ground tile (`doorNearPoint`, corpses, dropped items, then walk-here) when
  the ray misses. This is what makes a click on a TALL mesh land on the object
  and not the floor a tile behind it (the old ground-plane-only projection
  silently missed raised doors); it also drives the hover cursor and the
  BG3-style coloured outline (`shading.addHighlight`/`setHighlight`, one shell
  per interactable, coloured by kind). Register a holder as it's created;
  destroyed holders auto-unregister.
- **Attacks are available outside combat via the persistent hotbar.** The
  offensive slice of the sheet's actions (attacks, shove, throws) lives on an
  always-on bar (`ui.createHotbar`, ids `#hotbar-act-<id>` so they never
  collide with combat's `#act-<id>`; number keys 1-9 arm slots). Arming an
  action and clicking a coworker opens combat with that move as the opening
  strike: `main.js` `engageWithAction` -> `beginCombat({opening})` ->
  `startCombat({opening})`, which reuses combat's own `handleEnemyClick`
  (melee walks up, a throw checks range/line/ammo). Heal/defend stay
  combat-only - reactive actions with no meaning when nobody's swinging.
- **NPCs are talkable coworkers** (`data/npcs.js`): non-hostile actors
  (`NpcActor`) that stand on the map, block movement like any body, and open a
  small dialogue tree on left-click (`ui.createDialoguePanel`; the tree is
  `{ start, nodes: { text, options:[{label,next}] } }`, `next:null` ends it).
  They live in their own `npcs` array, never in `enemies`, so combat never
  touches them. (The editor doesn't paint NPCs yet - it normalises unknown
  actor chars to floor, so re-exporting a level in the editor drops them.)
- **Movement is free-form, the grid is the data model.** Actors stand at
  continuous points (a click walks you to the exact spot, clamped clear of
  walls by `clampToClearance`); routes come from grid Dijkstra and are
  string-pulled by `smoothPath` into any-angle runs. The logical tile is
  DERIVED from the continuous position (rounded) and drives everything
  tile-keyed: surfaces, hazards, adjacency, LOS, combat triggers.
- **The party** (`party.js`): the roster of player-controlled characters -
  ordered members of `{ sheet, actor }`, with `members[active]` the LEADER
  the player controls. `main.js` keeps `sheet`/`player` as the leader's live
  bindings; everything a member does with their feet (surfaces, slips, gum,
  ammo pickup) runs against THAT member's own sheet via `onMemberStep`. The
  exit and walk-up interactions stay leader-only. Combat fields every member
  with per-member AP/deflect/uses (`combat.js` `members`, `active`); enemies
  target the nearest living member, ties to the bloodied one. Campaign saves
  are v2 (`{ version, levelId, party: [sheets], active }`); old single-sheet
  saves migrate on load (`party.parseProgress`), and recruited companions
  respawn beside the leader on the next floor. **Recruitment**: companions
  (data/companions.js) stand among the NPCs until a dialogue option carrying
  `effect: { recruit: true }` signs them on - the same actor converts in
  place (picking kind `party`, sheet minted at the leader's level).
  **Following**: out of combat, followers path to a free tile beside the
  leader on a small repath cadence - costed by their OWN talents, pass-through
  for the rest of the party, never parking on a tile that hurts them.
  **Switching**: clicking a party-bar portrait (`ui.createPartyBar`,
  `#party-slot-<i>`), pressing Tab, or clicking a member's body switches who
  you control - out of combat that re-keys the `sheet`/`player` bindings
  (camera, hotbar, HUD, pockets, menu verbs, follower set); in combat it
  moves combat's `active` pointer (their action bar, their AP - switching is
  free and reversible, DOS-style), and when the fight ends the out-of-combat
  bindings follow whoever had the floor (`syncLeaderBindings`). **End Turn
  queues**: it ends the ACTIVE member's turn and auto-advances to the next
  member who hasn't ended (the button reads "Next Member" until the last
  hand-off gives the round to the enemies); manual switching back to a
  passed member still works - `done` gates only the auto-advance. In-combat
  clicks check the pick ray for BODIES first (a teammate's body switches, a
  coworker's body targets - the rings mark bodies, and the ground tile
  behind a tall mesh is a mis-walk); ground clicks stay tile-based for
  movement, and a member's combat route treats allies as blockers so a move
  never ends stacked on a teammate. **Hold Ctrl** to draw a ground ring at
  every character's TRUE position (party teal, hostiles red, NPCs green, the
  downed gold) - tall meshes read a tile off at this camera angle - and to
  get the hover body-highlight + focus banner inside combat too. **Downed**:
  a member at 0 HP topples and sits out; the run only ends on a party WIPE.
  If the member you're controlling falls, a survivor steps up on the spot -
  in combat via `combat.notifyMemberDown`/the enemy-attack handoff, outside
  it via `forceLeader`. The downed are back at 1 HP after a victory, a
  stairwell, or a walk-up hand up (the leader's actor registers in picking
  as kind `party` so a downed ex-leader is clickable; clicks on your own
  healthy body fall through to the ground).
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
  them and click through their `project()` / `project3()` helpers (CSS
  pixels - `project3` aims at a world point at any height, for tall meshes).
  `__game` also exposes `npcs`, `party`, `summons`, `armed` (hotbar),
  `hoverKind`, `cursor`, and `dialogueOpen`; `__combat` exposes `summons` and a
  `summonAlly(archetypeId, n)` test hook. Keep them in sync when adding state. `window.__god` is the
  exception: it hands out LIVE references and mutators for the god-mode panel
  (god.js) to edit runtime state in place - including the party
  (`__god.party`, `switchTo`, `reviveMember`, `recruit`; the panel's Player
  tab shows one live sheet card per member). It ships in the release but the
  panel stays hidden until a tester toggles it (` / F8, remembered in
  localStorage or via `#god`).

## Growth paths (where things plug in)

- **New enemy**: entry in `data/enemies.js` + character in a level's `actors`
  legend + a .glb in `assets/characters/`.
- **New NPC (talkable)**: entry in `data/npcs.js` (name, model, dialogue tree)
  + character in a level's `actors` legend. It stands, blocks movement, and
  talks on left-click; it never fights. Reuses a character `.glb`.
- **New companion (recruitable)**: entry in `data/companions.js` - the NPC
  fields plus a class-shaped stat block (maxHp, ap, actions, talent) and a
  dialogue option with `effect: { recruit: true }`. Give it a character in a
  level's `actors` legend; everything else (recruit conversion, following,
  the party bar slot, per-member stepping, the save) is systems.
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
- **Attributes** (`stats.js`, see PROGRESSION_PLAN.md): a sheet's four office
  attributes — Grit, Hustle, Savvy, Composure (`sheet.attr`, seeded per class in
  `data/classes.js`) — are the SOURCE its combat numbers derive from.
  `maxHp`/`maxAp` are recomputed from `attr` + an innate `base` floor by
  `recomputeDerived(sheet)`; **never assign `sheet.maxHp`/`sheet.maxAp` directly**
  (they'd drift on the next recompute). Any code that changes an attribute calls
  `recomputeDerived`. AI-driven units (enemies, and enemy-side summons) are NOT
  sheets — they read stats through `unitCombat(def)` and scale on the enemy
  curve, not attributes. (A PLAYER-side summon is the exception: it's a
  controllable temporary member with a real sheet — see **Summons** below.)
- **Talents**: per-class in `data/classes.js` (shown on the resume cards).
  Effects the code understands: paperDamageBonus, paperAmmoDiscount,
  paperCutImmune, shockImmune, slipImmune, surfaceDamageResist, hasLighter,
  grantsAction.
- **Class ability track** (`data/classes.js`/`companions.js` `track`, spent with
  class points): a list of `{ id, name, cost, requires?, effect }` nodes. A new
  node is a data entry — its `effect` reuses known shapes (`attrBonus`,
  `talent`, `grantsAction`), and `spendClassPoint` (stats.js) **bakes** it into
  the sheet's `attr`/`actions`/`talent.effects` in place, so every existing read
  site honors it with no systems change. `sheet.perks` records what's taken (the
  baked state persists; nothing is re-applied on load). Node ids are globally
  unique.
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
- **Summons** (SUMMON_PLAN.md): a combat action `type: 'summon'`, or an enemy's
  `summon` descriptor, conjures temporary combatants on the summoner's side. The
  `archetype` id resolves from CLASSES (or ENEMY_TYPES); the `applicant` class is
  the first (weak, `playable: false`, worth no XP or loot, so a summoner is a
  spawner not a farm). The two sides differ by who drives them:
  - **Enemy-side summons are AI.** They join `enemies`, take a `{unit}`
    initiative slot, and reuse every enemy system (the combat AI targets the
    nearest member via `unitCombat`/`def.attacks`).
  - **Player-side summons are YOURS to control** — Divinity/BG style. Each is a
    temporary MEMBER: a real `createSheetFrom(applicant)` sheet (HP/AP/actions)
    on a `CompanionActor` body, appended to combat's `members` with a `{member}`
    initiative slot, so `beginTurn` hands YOU control on its turn (its own action
    bar - Résumé Slap - and AP). It's NOT in `party.members` (outside the cap,
    unsaved, so `party.active` never points at it - combat exposes
    `actingActor`); it lives in main.js's `summons` list as `{ sheet, actor }`,
    stepped like a member (`onSummonStep` for surfaces), blocks enemies but is
    pass-through for the party, rings friendly on Ctrl, and is despawned when the
    fight ends. A summon falling is never a game-over (`livingParty` gates
    defeat - a party WIPE of real members only).
  Caps + cooldowns are data: the HR enemy's `summon` (data/enemies.js) and the
  HR class's Post the Role (`summon-applicants`, data/actions.js).
  `world.spawnSummon` + `freeTilesNear` (main.js) place them; `resolveSummon`
  (combat.js) enforces the live cap and files each onto the right side.
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
  registry, so new classes appear automatically. `playable: false` hides a
  class from the picker (it's a summon/AI archetype, not a career); optional
  AI-combat fields (attacks, attackAp, xp, loot) let a class back an AI-driven
  unit, read via `stats.js` `unitCombat` - the on-ramp to class-based enemies.
- **New level**: paint it in the built-in editor (link on the class picker, or
  `#editor`) and Export the JSON into `levels/`; playtest instantly via the
  localStorage stash. Registries drive the editor palette, so new tile/enemy
  types are paintable automatically (each registry entry carries its canonical
  map `char`). The `partition` brush paints the tile EDGE nearest the click
  (right-click erases it); exports collapse edges into compact
  `"H/V x z len"` runs via `compressWallRuns`.
