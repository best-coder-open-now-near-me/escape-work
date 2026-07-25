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
    items.js           items + container loot tables (heal/ammo/cash/value/flavor)
    shops.js           merchant registry: greeting, markup, buys, stock list
    npcs.js            non-hostile actors you TALK to: name, model, dialogue tree
    companions.js      recruitable coworkers: an NPC-shaped presence plus a
                       class-shaped stat block; dialogue options can carry
                       effect: { recruit } to sign them onto the party
    levels.js          the floor registry: id -> level JSON + display name
    statuses.js        status registry: name/icon, clock (turn vs step),
                       duration, and the effects they carry
  grid.js            Level parsing, terrain + edge-wall queries (pure logic)
  occlusion.js       Which walls stand between camera and character (pure logic)
  pathfinding.js     8-dir Dijkstra, string-pulling smoother, free-point
                     clamping, distance-budget truncation      (pure logic)
  statuses.js        The status runtime: apply/tick/clear over a carrier's
                     status map, both clocks                   (pure logic)
  tactics.js         Positional to-hit modifiers: facing, flanking, cover
                     (TACTICS_PLAN.md)                         (pure logic)
  surfaces-runtime.js Fire/smoke/fuse state machine, advanced one turn at a
                     time over a grid interface                (pure logic)
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
  shop.js            Merchant arithmetic: price, sell yield, the stock roll,
                     and the atomic buy/sell                  (pure logic)
  looting.js         Containers, bodies, loose items, pockets, Alt overlay
  shopping.js        The merchant runtime: per-instance stock, the shop panel,
                     the buy/sell verbs (ECONOMY_PLAN.md)
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

- `data/*` imports nothing (`data/levels.js` is the one exception - it imports
  the level JSON files, which are themselves data).
- `grid`, `pathfinding`, `stats`, `party`, `surfaces-runtime`, `initiative`,
  `statuses`, `tactics`, `occlusion`, `shop` are pure JS (no PlayCanvas, no DOM) - unit
  tested in isolation (tests/unit).
- `scene`, `shading`, `tile-renderer`, `models`, `controls`, `picking`,
  `actors` touch PlayCanvas; `ui` touches the DOM; `fx`, `combat` and
  `looting` touch both (combat draws its own previews/rings and builds its own
  panel; looting spawns dropped-item entities).
- Only `main.js` sees everything. It owns game state (`inCombat`, `gameOver`)
  and game flow (what a click means, when combat starts, tile effects).
- Enemy AI decisions (pathing costs, wander avoidance) use a talent-free
  hazard model - the player's talents discount only the player's own costs,
  never what enemies fear.

## Conventions

- **Tile effects**: `TILE_TYPES[x].onEnter` — `{ effect: 'exit' }` fires only on
  deliberate arrival (end of a path); `{ effect: 'damage', ... }` fires on every
  step. New effect kinds are added in `main.js`'s `onMemberStep`.
- **Walkability** is layered: `grid.terrainOpen` (static terrain) + living
  enemies + NPCs (dynamic) = `isWalkable` in `main.js`. Pass `isWalkable` into
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
- **The camera** (`controls.js`): an orbit rig - yaw/pitch drag, wheel zoom -
  clamped to pitch 18-80 so you can't tumble into a useless near-horizon view.
  The **tactical view** (the HUD-rail button, or `T`) deliberately steps past
  that clamp to a dead-overhead 90: tile boundaries stop foreshortening, so a
  click lands exactly where it looks like it will. It banks the pitch/dist it
  replaced and restores them on the way out, and any manual pitch drag (or a
  raw `setView`) drops it, so the button's lit state never outlives the view.
- **Walls between you and the camera are ghosted**, and the test for "between"
  is 3D (`occlusion.js`, unit tested). It walks the sightline from the camera to
  the character's FEET and ghosts a wall only where that segment is still below
  the wall's top - so it respects both ends (nothing past the camera, nothing
  behind the character) and the fact that these walls are SHORT (0.6-0.72). At a
  steep pitch the sightline clears a partition within half a tile and almost
  nothing ghosts; at a shallow one the same partition covers several tiles. The
  flat "is it that way?" test this replaced had neither bound and ghosted most
  of the room. Each wall entry carries a `top` for it (`scene.js`).
  **In combat, clicking a coworker with nothing armed is an attack** - it arms
  the basic swing from whatever is in your hand (`stats.equippedAction`, bare
  hands fall back to `punch`) and resolves it, walk-up included. Arming a power
  first still wins; the default only fills the empty case, which used to be a
  refusal ("choose an action first") on the most obvious verb in the game. It is
  refused only when even the basic swing is unaffordable.
  **Every aiming affordance reads that same fallback** (`combat.previewAction`):
  the target rings, the hover to-hit readout, and the crosshair cursor all
  describe the swing a click would actually make, so the default attack is
  visible before it is used - shipping it without them made a working feature
  look absent, because nothing on screen said a click would land.
  **Hold Ctrl or Alt to glow what you're hovering** (`shading.addHighlight`) -
  a Divinity-style aura of stacked back-face shells at growing push and falling
  opacity, drawn additively so it reads as light rather than paint. The glow is
  an INSPECT verb, gated behind the two keys that already mean "show me what's
  there" (Ctrl's ground rings, Alt's loot labels); lit on plain hover it fired
  on every door and desk the cursor crossed, and a light that is always on says
  nothing. What the cursor is over is tracked ALWAYS (`hoverTarget`) and the
  modifier only decides whether it's lit, so pressing the key lights what you
  are already pointing at instead of waiting for a fresh hover event. The
  cursor and the focus banner stay ungated - they cost no attention.
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
  are at `party.SAVE_VERSION` (`{ version, levelId, party: [sheets], active }`
  - v3 added attributes, v4 statuses, v5 equipment); old single-sheet
  saves migrate on load (`party.parseProgress`), and recruited companions
  respawn beside the leader on the next floor. `parseProgress` reads the save
  by SHAPE but consults its `version` for one-time migrations: anything that
  INVENTS state (the v5 best-weapon auto-equip) must be version-gated, or it
  re-fires on every load and overrides deliberate player choices. **Recruitment**: companions
  (data/companions.js) stand among the NPCs until a dialogue option carrying
  `effect: { recruit: true }` signs them on - the same actor converts in
  place (picking kind `party`, sheet minted at the leader's level).
  **Following**: out of combat, followers path to a free tile beside the
  leader on a small repath cadence - costed by their OWN talents, pass-through
  for the rest of the party, never parking on a tile that hurts them.
  **Switching**: OUT of combat, clicking a party-bar portrait
  (`ui.createPartyBar`, `#party-slot-<i>`), pressing Tab, or clicking a
  member's body switches who you control - re-keying the `sheet`/`player`
  bindings (camera, hotbar, HUD, pockets, menu verbs, follower set). IN
  combat there is no switching: proper per-unit initiative means you control
  each member only when their own turn comes up (`beginTurn` -> `makeActive`),
  and when the fight ends the out-of-combat bindings follow whoever had the
  floor (`syncLeaderBindings`). **End Turn** ends the acting member's turn and
  initiative moves on - the next slot may be a teammate, a summon you're
  driving, or an enemy. In-combat clicks check the pick ray for a coworker's
  BODY first (the rings mark bodies, and the ground tile behind a tall mesh is
  a mis-walk); ground clicks stay tile-based for movement, and a member's
  combat route treats allies AND summons as blockers so a move never ends
  stacked on one. **Hold Ctrl** to draw a ground ring at
  every character's TRUE position (party teal, hostiles red, NPCs green, the
  downed gold) - tall meshes read a tile off at this camera angle - and to
  get the hover body-highlight + focus banner inside combat too. **Downed**:
  a member at 0 HP topples and sits out; the run only ends on a party WIPE.
  If the member you're controlling falls, a survivor steps up on the spot -
  in combat via `combat.notifyMemberDown`/the enemy-attack handoff, outside
  it via `forceLeader`. The downed are back at 1 HP after a victory, a
  stairwell, or a walk-up hand up (the leader's actor registers in picking
  as kind `party` so a downed ex-leader is clickable; clicks on your own
  healthy body fall through to the ground). EVERY death funnels through
  `downOrLose` - tile damage, bleed, surfaces, and printer blasts alike - so
  no single way to die can end a run the party could have survived.
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
  `window.__editor` are the test surface; the e2e tests assert against
  them and click through their `project()` / `project3()` helpers (CSS
  pixels - `project3` aims at a world point at any height, for tall meshes).
  `__game` is read-only state (beyond `npcs`, `party`, `summons`, `armed`,
  `hoverKind`, `cursor`, `dialogueOpen`, it exposes the world queries the
  specs need: `doors`, `looseItems`, `burning`, `smoking`, `surfaceAt`,
  `losClear`, `cash`, `shopOpen`, `shopStockAt`, …). `__combat` is mostly read-only (`phase`, `order`, `turn`,
  `party`, `summons`, `enemies`, `lastRoll`, `hoverHitChance`) but also
  carries deliberate LIVE setters god mode and the specs drive: `ap`,
  `defended`, `usesLeft` (edit in place, then `refresh()`), `applyStatus`,
  `summonAlly(archetypeId, n)`, and the determinism pins `forceHit` /
  `forceProc` (`true` always, `false` never, `null` rolls honestly). NOTE
  those pins cover the hit and proc rolls only - damage and initiative still
  roll on `Math.random`, so a fight is never fully deterministic. Keep all of
  it in sync when adding state. `window.__god` is the
  exception: it hands out LIVE references and mutators for the god-mode panel
  (god.js) to edit runtime state in place - including the party
  (`__god.party`, `switchTo`, `reviveMember`, `recruit`; the panel's Player
  tab shows one live sheet card per member). It ships in the release but the
  panel stays hidden until a tester toggles it (` / F8, remembered in
  localStorage or via `#god`).

## Growth paths (where things plug in)

- **A character that IS a class inherits it - never copies it.** A companion or
  an enemy who does one of the playable jobs writes `classId: '<class>'` plus
  ONLY what makes them them, and `fromClass` (data/classes.js) merges the rest:
  rig, build, attributes, kit, talent, track. The Mail Room Veteran and the
  Security Guard both work this way. This is the "class as shared unit
  archetype" direction made real, and it exists because the copies drifted -
  reassigning the Mail Room's rig left the veteran wearing the old one while
  still calling himself mail room. An override means DEPARTING from the class;
  a lint fails the build if one merely repeats what the class already says.
  Registries export their raw kit tables (`COMPANION_KITS`, `ENEMY_KITS`) for
  it. Enemies drop the inherited `maxHp` - they spell it `hp`, and `unitCombat`
  prefers `maxHp`, so keeping it would silently outrank their own. Characters
  with no class twin (The Manager, the Executive) stay written out; don't invent
  a class just to inherit from one.
- **New enemy**: entry in `data/enemies.js` + character in a level's `actors`
  legend + a .glb in `assets/characters/`. If it's a playable job, give it a
  `classId` instead of restating the class.
- **New NPC (talkable)**: entry in `data/npcs.js` (name, model, dialogue tree)
  + character in a level's `actors` legend. It stands, blocks movement, and
  talks on left-click; it never fights. Reuses a character `.glb`.
- **New companion (recruitable)**: entry in `data/companions.js` - a `classId`
  naming the class they are, the NPC fields (char, name, examine), a dialogue
  option with `effect: { recruit: true }`, and only the stats where they depart
  from the class (companions run softer lines than the player's). Give them a
  character in a level's `actors` legend; everything else (recruit conversion,
  following, the party bar slot, per-member stepping, the save) is systems.
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
  explosions still resolve (combat prunes the dead). Attacks roll TO HIT
  (HIT_PLAN.md): a DOS2-style `hitChance = BASE + accuracy(attacker) -
  dodge(defender)` (accuracy from Savvy, dodge from Hustle, derived in
  `stats.js`; enemies carry innate `accuracy`/`dodge` through `unitCombat`),
  clamped so a whiff and a hit are always possible. A miss spends the AP/ammo
  and does nothing else - no damage, no on-hit rider. Shove auto-hits
  (positioning, not damage). `combat.js resolveHit` owns the roll against an
  injectable `rng`, pinnable via `__combat.forceHit` for deterministic tests.
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
    pass-through for the party, and rings friendly on Ctrl. A summon falling is
    never a game-over (`livingParty` gates defeat - a party WIPE of real members
    only).
  **Summons are timed, not combat-scoped.** Each descriptor carries
  `lifetimeTurns`: how many of the unit's OWN turns it serves before the
  assignment lapses and it walks off the board. `beginTurn` spends one at the top
  of each of its turns; out of combat main.js's world clock (`ageSummons`, one
  per fire/smoke turn) spends them instead. Winning a fight no longer evaporates
  them - a summon with turns left stays on the floor, follows the fight it was
  called for out the door, and is handed back into the NEXT one through
  `startCombat({ allies })`. Expiry is not death: `dismissSummon` takes the body
  off the board with no topple, no corpse, no loot and no XP (a summon that was
  actually KILLED is swept at `cleanup()` - there is nothing to loot either way).
  Losing, aborting and a floor change still clear them outright.
  Caps + cooldowns are data too: the HR enemy's `summon` (data/enemies.js) and
  the HR class's Post the Role (`summon-applicants`, data/actions.js).
  **A player summon is TARGETED**: it arms like an attack, and you click the
  spot where they should report - within the action's `range` (data), with a
  clear line to it. They fill the clicked tile first, then the free ground
  ringing outward from it (`world.summonSpots`/`freeTilesNear(…, minR: 0)`);
  the armed hover rings exactly those tiles, so the preview is the rule. An
  enemy `summon` descriptor carries no `range` and drops its reinforcements
  beside the summoner as before. `world.spawnSummon` (main.js) places them;
  `resolveSummon` (combat.js) enforces the live cap and files each onto the
  right side.
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
  nearby; clicking a label or the object walks you into reach and loots. A
  label names a TILE, not an item - a pile lists its contents in one chip
  rather than stacking chips at one screen point - and it floats clear of and
  translucent over what it names, going solid on hover.
  **I** (or the bag button) opens the pockets: use (heal/ammo), examine, or
  drop - drops become loose floor items the overlay sees. The bag lives on the
  **HUD rail** (`ui.js`), the row of buttons queued off the bottom-left profile
  card's live right edge - bag, then the tactical camera. The card's width moves
  with the character's name, so `layoutHudRail` re-seats the whole row on every
  stats repaint and resize; `registerHudButton` adds a slot, `railHooks` lets a
  panel (the pockets) ride the same pass. Effects the code
  understands: `heal`, `ammo`, `bonusDmg` (passive while carried, best item
  counts - see `damageBonus` in stats.js). `sheet.inventory` persists across
  floors with the campaign save.
- **Money & merchants** (ECONOMY_PLAN.md): **Petty Cash** (💵) is a single
  integer on the PARTY, not a sheet (`party.cash`, `party.addCash`) - one purse
  the whole roster spends from, so buying never depends on who you're
  controlling. It persists at the top level of the campaign save (**v6**); an
  older save simply reads 0, because the purse is new state rather than
  migrated state. Cash ARRIVES as ordinary loot: an item with a `cash` field is
  auto-banked by `looting.receiveItems` and never reaches the bag, which is why
  a fiver rides the loot tables, corpse drops, loose floor items and the Alt
  overlay with no second roll shape anywhere. Every item states what it is
  worth (`value`); greed lives on the MERCHANT (`markup` selling to you,
  `sellRate` buying from you), so a machine and a person can disagree about a
  candy bar. **A merchant is data in two shapes on one system**: a tile type
  with `shop: '<id>'` is a machine (the snack machine, map char `$`) and an
  NPC/companion with the same field is a person, reached by a dialogue option
  carrying `effect: { shop: true }` - the same seam `effect: { recruit: true }`
  uses. Machines carry `buys: false` (a sink); people buy your junk (a sink and
  a source), which is what finally makes the flavor items worth carrying.
  Stock is rolled ONCE per instance and decrements, exactly like container
  loot, so a machine can sell out. `shop.js` owns the arithmetic and the
  atomicity rule - cash, stock and bag move together or not at all, every
  refusal before the first mutation. Shopping is gated out of combat like every
  other pockets verb (`modalOpen()` in main.js covers the dialogue and shop
  panels together).
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
