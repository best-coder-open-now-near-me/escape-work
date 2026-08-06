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
                       duration, the effects they carry, and the `fx` block
                       that says what they LOOK like (colour, landing burst,
                       live aura)
  grid.js            Level parsing, terrain + edge-wall queries (pure logic)
  floors.js          Layered levels: storeys as stacked flat maps, generated
                     stair runs, the active-storey grid facade, cross-storey
                     route planning (pure logic; EDITOR_PLAN spike)
  occlusion.js       Which walls stand between camera and character (pure logic)
  pathfinding.js     8-dir Dijkstra, string-pulling smoother, free-point
                     clamping, distance-budget truncation      (pure logic)
  statuses.js        The status runtime: apply/tick/clear over a carrier's
                     status map, both clocks, plus the SEVERITY a status
                     landed at - Composure shortens a resistable status
                     and blunts it, scaling every magnitude in the merged
                     effect view (never a boolean).
                     BOTH CLOCKS RUN IN AND OUT OF COMBAT. The step clock
                     ticks per tile walked, wherever you are; the turn clock
                     ticks at a combatant's turn start in a fight and on
                     main.js's world clock outside one - the same clock that
                     ages fire, smoke and summon assignments. Nothing is
                     swept when a fight ends, so a status means the same
                     thing on both sides of the door (STATUS_PLAN #2)
                                                               (pure logic)
  tactics.js         Positional to-hit modifiers: facing, flanking, cover
                     (TACTICS_PLAN.md). `shieldedFaces` is the one cover
                     primitive: WHICH faces of a tile something shields -
                     walls and partitions on the edges, props and BODIES on
                     the neighbouring cells - with `facesShieldFrom` asking
                     which of them points at an attacker. `hasCover` is those
                     two composed, so the M3 to-hit modifier and the M6 crouch
                     immunity read one rule and cannot drift  (pure logic)
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
  fx.js              Cosmetic FX: the pooled particle pump (impact bursts,
                     status auras, embers), ground decals (bloody footprints,
                     splats), projectiles, damage popups, and the
                     world -> CSS-pixel projection every DOM overlay uses
  controls.js        Camera rig + mouse -> semantic input (click tile, menu)
  picking.js         Screen pixel -> interactable ENTITY under it (ray vs the
                     registered doors/enemies/NPCs/props), not just the floor
  hover.js           What the cursor SAYS: the body glow + its Ctrl/Alt
                     gate, the cursor shape, the focus banner, and the
                     ground rings (armed targets, reach, characters).
                     One owner, so every affordance describes the same
                     verb; asks main.js for the world through `queries`
  vision.js          Impaired sight: while the character you STEER carries a
                     status with `aimSway`/`sightBlots` (blinded, confused),
                     the aim drifts off the mouse, three cursors sway over
                     the floor, and ink swims across the world. controls.js
                     bends the click and the hover through it; hover.js still
                     owns what the cursor says
  aim-paint.js       The aim wash (TACTICS_PLAN M7): pooled translucent
                     quads over every tile an armed verb can legally reach
                     RIGHT NOW - line of sight included, and never a tile
                     whose occupant the click would have to walk to;
                     combat.js decides the tiles
  combat.js          Tactical on-map combat: per-unit INITIATIVE order, AP
                     turns, movement, ranged/melee, AI-driven units - costs
                     from data. Owns the BODIES, the AP ledger, the FX and
                     the frame clock; the rules below are what it asks
  combat-session.js  Mutable encounter lifecycle: steered member, player/AI/
                     done phase, acting AI unit and scramble deal
  combat-intent.js   Mutually-exclusive next-click intent: aimed action or
                     instant confirmation; disarm also clears the aim view
  combat-formulas.js Pure diagnostic projections for the actual hit, damage
                     and proc inputs used by the combat resolvers
  combat-geometry.js Reach, the two range vocabularies (what a verb's WASH
                     covers vs what its CLICK acts from), the walk-up's
                     stand point, a zone's covered tiles     (pure logic)
  combat-plans.js    Where a verb LANDS: the plan half of every plan/perform
                     pair - topple, shove, break, pull, displace. A
                     plan returns the shape the perform half needs or the
                     reason it refuses, never both                (pure)
  combat-ai.js       What an AI unit DECIDES: who to fight, where to stand,
                     and `chooseBeat` - the ladder of beats a turn walks, in
                     the order that IS the design: support, summon, pull,
                     topple, shove, attack, entrench, shoot, advance, break,
                     crouch, pass. Each beat outranks what it strictly beats
                     (topple sits above shove because it is shove-plus;
                     entrench must precede shoot or a shooter never crouches
                     first). `beatStateFrom` assembles the ladder's input from
                     plain values, so the AP gating is testable; a `refused`
                     set masks a beat whose doing spent nothing, which is what
                     makes a turn always terminate.        (pure logic)
  combat-targeting.js What the target rings PROMISE, and `verbKind` - the
                     ONE classifier saying which branch a body-aimed verb
                     takes. The rings and the click both dispatch on it, so
                     they cannot pick different branches       (pure logic)
  step-rules.js      What the floor does to whoever stands on it: the
                     surface, the damage after talents, the wad, the slip,
                     the speed under a status. One module for members,
                     summons, AI units in a fight and wanderers out of one
                     (pure logic)
  summon-rules.js    Where a summon may be posted and how many arrive - one
                     ladder, with the two legs a FIGHT owns (AP, the ration)
                     supplied in combat and absent outside it  (pure logic)
  initiative.js      Combat turn order: d20 + speed roll, sort, joiner
                     insertion                                (pure logic)
  turn-order.js      The turn ENGINE over that order: advance, the round
                     wrap, skipping who can't act, a temp's contract,
                     the turn-start tick - and SHARED turns: consecutive
                     member slots hold the floor together, steered and
                     finished one at a time (INITIATIVE_PLAN). Drives a
                     host interface, so combat.js keeps only what needs
                     a panel or a body (see Layering)          (pure logic)
  shop.js            Merchant arithmetic: price, sell yield, the stock roll,
                     and the atomic buy/sell                  (pure logic)
  looting.js         Containers, bodies, loose items, pockets, Alt overlay
  doors.js           The one piece of terrain a fight can change: reaching a
                     handle, spending the AP, the Alt-overlay entry
  door-edges.js      The edge arithmetic under it - a door is an EDGE, so
                     every conversion between a key and the two tiles it
                     divides lives here                        (pure logic)
  dialogue.js        Talking to people and signing them on; `nodeOptions`
                     is the pure half (which options a node can offer)
  hotbar-model.js    The bar's VIEW-MODEL: what belongs on it, in what
                     order, in which slot, and what each slot says about
                     itself. ui/hud.js renders it             (pure logic)
  action-tooltip.js  One power description/number formatter shared by the
                     unlock list and both hotbar modes         (pure logic)
  shopping.js        The merchant runtime: per-instance stock, the shop panel,
                     the buy/sell verbs (ECONOMY_PLAN.md)
  ui.js              All DOM. The FRONT DOOR only - it re-exports ui/,
                     so every caller keeps `import * as ui from './ui.js'`
  ui/                grouped by what a thing IS on screen:
    chrome.js          shared palette + the bottom-left HUD rail
    readouts.js        retained, typed narrator/combat/formula/initiative log;
                       collapsed Advanced filters; focus banner + loot toast
    hud.js             profile card + status chips, tactical button,
                       the paged action hotbar, party bar, level-up pip
    menus.js           context menu, Alt loot labels (at the cursor)
    panels.js          pockets, character sheet, dialogue, shop
    screens.js         level-up, win/floor-clear/lose, the desk (six precut
                       characters + the blank card), game menu, playtest
                       badge (they take the frame)
    creation.js        the short form beside the chosen body: pronouns, two
                       points, and - for a custom character only - a name
                       and a body from the rigs nobody else wears
    combat.js          the combat readout: whose turn it is, the AP pips,
                       End Turn and the initiative strip. A dumb view like
                       the rest - combat.js hands it a decided picture
  god.js             God-mode tweak panel (` / F8): live-reflects the sheet,
                     enemies, combat + world; edit/pin values, pause, spawn
  editor-document.js Pure storey transforms and editor document invariants
  editor-session.js  Undo/redo, stroke checkpoints, dirty state + draft policy
  editor-view.js     Editor PlayCanvas entities, render caches + derived previews
  editor-shell.js    Editor structural DOM, accessibility + layout measurement
  editor.js          Editor composition, commands, export + playtest handoff
  run-session.js     Mutable cross-system run/floor coordination state
  main.js            Entry point: routes game vs #editor, composes game flow
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
  `turn-order`, `statuses`, `tactics`, `occlusion`, `shop`, `powers`,
  `combat-geometry`, `combat-plans`, `combat-ai`, `combat-targeting`,
  `step-rules`, `summon-rules`, `hotbar-model`, `action-tooltip`,
  `combat-formulas`, `door-edges`,
  `combat-session`, `combat-intent`, `run-session`, `editor-document` and
  `editor-session` are pure JS (no PlayCanvas, no DOM) - unit tested in
  isolation (tests/unit).
- **A rules module that needs the world takes a HOST, not the world.**
  `turn-order.js` is the pattern: it owns the turn walk and asks an injected
  host the questions only combat can answer (is this slot still standing, is
  the fight over, hand it the turn). The rules stay testable with plain objects
  - `tests/unit/turn-order.test.js` drives a whole fight's worth of turn
  boundaries with no sheet, no actor and no panel - while everything that needs
  a body or the DOM stays in `combat.js`. Reach for this shape when logic worth
  testing is trapped inside something that has to touch the engine.
- `scene`, `shading`, `tile-renderer`, `models`, `controls`, `picking`,
  `actors` and `editor-view` touch PlayCanvas; `ui` and `editor-shell` touch
  the DOM; `fx`, `combat`, `hover`, `looting` and the editor host touch both
  (combat draws its own previews/rings; hover writes the canvas cursor and
  draws rings; looting spawns dropped-item entities).
  `combat.js` no longer BUILDS a panel - the readout is `ui/combat.js` and the
  bar is main.js's hotbar - so what it still owns of the DOM is the movement
  cost tag and nothing else.
- **A panel is a dumb VIEW.** Everything in `ui/` takes a host-supplied
  view-model plus callbacks, renders it, and reports clicks - it never reads a
  rule. Where a rule leaked in it drifted: the hotbar carried its own ammo-cost
  copy without the talent discount and greyed out a legal throw, and the
  banked-points sum was re-derived on four surfaces. Both now arrive from
  `stats.js` (`ammoCostOf`, `pendingPoints`). New UI joins the file matching
  what it IS on screen, and asks for its numbers.
- **`hover.js` owns every affordance, so they cannot disagree.** The glow, the
  cursor, the focus banner and the ground rings all answer one question -
  "what am I pointing at, and what would a click do?" - and when they were
  four separate stretches of `main.js` they drifted apart repeatedly (a
  crosshair over a coworker the click would refuse; a banner naming a body the
  glow had dropped). None of them decides what a click MEANS - that stays
  `dispatchHit`. A new affordance goes here, against the same `queries`, and
  the rules it consults are passed IN (`armedTargetOk` is the click resolver's
  own test, not a second copy of it).
- **A rule read by two surfaces gets ONE owner, and both surfaces dispatch on
  it.** The rings and the click each grew their own ladder of `a.type` tests
  for "which verb is this?", in slightly different orders, and a ranged weapon
  fell out of one and not the other: an out-of-range coworker rang red while
  the click walked the member in and fired. `combat-targeting.verbKind` is that
  ladder now, and both read it. The same shape closed three other drifts - the
  per-tile step rules (three copies, one already compounding a slow), the
  summon spot rules (two, one of them documented as a copy of the other), and
  the pull's plan-vs-refusal (two hand-parallel walks down five legs). When you
  find yourself writing "the same questions X asks, less Y", that is the seam.
- Only `main.js` sees everything and composes game flow (what a click means,
  when combat starts, tile effects). `run-session.js` owns cross-system mutable
  run coordination: combat/game-over, active layer, climb/path state,
  out-of-combat intent and pending interactions. The `sheet`/`player` leader
  bindings and `party` roster stay in `main.js` because they connect the owners.
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
  chest height: combat throws sail OVER them - and over any solid CELL
  shorter than `SIGHT_BLOCK_HEIGHT` (data/tiles.js, TACTICS_PLAN M6a): a desk
  blocks bodies, not shots, and shields whoever stands behind it instead.
  `hasLos` is cell sight (`grid.sightOpenCell`) + edge sight
  (`grid.sightOpen`); `#` cell walls are `tall` and still stop throws.
- **Doors live on edges too** ("doors" runs in the level JSON; a door
  replaces any wall on its edge). Closed doors block movement AND sight
  (they go floor to frame); conduction ignores them - water finds the gap
  underneath, so pools stay static. Click the visible door panel or knob to
  walk up and toggle it; there is deliberately no ground/threshold "ghost"
  click area (`[stated]`, designer task text 2026-08-05: "directly on door
  only"). Picking tests the mesh-local bounds of each rendered instance,
  and cyan hover highlighting shows exactly when the door itself is targeted.
  State lives in `grid.doors`; visuals re-render via `scene.refreshDoor`.
  Enemies don't open doors. The editor has a door brush next to the partition
  brush.
- **Left-click is contextual (Divinity-style): the target picks the verb.**
  `picking.js` ray-tests the cursor against registered interactable holders
  (doors, living enemies, NPCs, rummageable props) and returns the nearest
  hit; `main.js`'s `dispatchHit` maps its `kind` to a verb - attack a
  coworker, talk to an NPC, open a door, rummage a prop - falling back to the
  ground tile (corpses, dropped items, then walk-here) when the ray misses.
  Door interaction is the direct per-instance geometry test described above,
  never a nearby-ground fallback. This makes a click on a TALL mesh land on
  the object and not the floor a tile behind it (the old ground-plane-only
  projection silently missed raised doors); it also drives the hover cursor
  and the BG3-style coloured outline (`shading.addHighlight`/`setHighlight`, one shell
  per interactable, coloured by kind). Register a holder as it's created;
  destroyed holders auto-unregister.
- **The camera** (`controls.js`): an orbit rig - yaw/pitch drag, wheel zoom -
  clamped to pitch 18-80 so you can't tumble into a useless near-horizon view.
  The **tactical view** (the HUD-rail button, or `T`) deliberately steps past
  that clamp to a dead-overhead 90: tile boundaries stop foreshortening, so a
  click lands exactly where it looks like it will. It banks the pitch/dist it
  replaced and restores them on the way out, and any manual pitch drag (or a
  raw `setView`) drops it, so the button's lit state never outlives the view.
  **WASD/arrows pan the view free** (BG3/DOS2's keys): a pan detaches the rig
  from its follow target, fenced to the floor's extent, until something
  recenters it - `Home`, a double-click on the bottom-left profile card, a
  party-bar card, or a combat-strip row. A recenter aimed at the body the rig
  FOLLOWS re-attaches the follow (`recenter()`); aimed at anyone else it
  glides to where they stand and stays detached (`panTo()`), because follow
  can't honestly attach to a body it doesn't track. Control changes re-attach
  too (a leader switch, a survivor stepping up, a fight starting) - the view
  belongs with whoever you're driving. main.js owns WHO (`focusCameraOn`);
  the rig only owns HOW.
  **The body the rig follows is `steeredActor()`** - the acting combatant in a
  fight, the leader out of one - and that is the ONE answer to "who is the
  player driving?". `player` answers a different question ("who leads the
  party"), and the two diverge the moment a shared turn hands you a teammate:
  `makeActive` never re-keys `player`, and `switchLeader` returns early in
  combat by design. While the follow loop read `player`, steering a companion
  drove a body the camera wasn't tracking, and `Home` DETACHED the rig instead
  of recentering it. The follow, the wall fade, `Home`, the profile card, the
  party-bar card and the initiative rows all read the one function now.
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
  **And they all share one answer to "who is the cursor on?"**
  (`combat.handleHover`): main.js hands in the body pick, combat falls back to
  a body near the ground point (`enemyAtPoint`, measured against continuous
  body positions - the tile is derived), and the crosshair, the readout, the
  reach ring and the click resolve from that single result, behind the click's
  own gate (your turn, standing still).
  **A target the click would WALK to previews the whole commitment first**
  (BG3's move-then-act; `showHitPreview` via `previewWalk`): the route the
  click will take, a ring on the stand point it stops at, and the odds plus
  the total AP - move and swing together - priced FROM that planned point
  (`attackMods` takes it as `plan`), because cover and flanking move with the
  attacker. **A walk-up stops the moment ITS OWN verb is live**, not at the
  target's elbow: `verbReaches` asks "could this power act from this point?"
  through `actRangeOf` - the CLICK's own branching (a ranged attack's
  `stats.rangeOf`, a ranged control's `range`, melee reach for everything
  walked into), deliberately NOT the aim wash's wider `aimRangeOf`, which
  covers verbs the click never walks in at all - and `pathfinding.trimToFirst`
  cuts the SMOOTHED route at the first point where it holds. Trimming after
  smoothing is what puts the stop point on the line actually walked; the fixed
  0.85 approach point it replaced stopped half a tile closer than any swing
  needed and sat offset on the target -> goal-tile line. One predicate serves
  the trim, the pre-walk promise and the arrival check, so the three cannot
  disagree. The walk only ever aims at a stand point the swing is
  LEGAL from (`routeBeside`/`swingPointAt`: reach distance plus the partition
  line test - the same `canReach` the strike runs on arrival), the melee
  target rings read that same rule (`hasSwingSpot`), **and the aim wash does
  not over-promise**: an ANY-target purge is washed at its FRIENDLY reach
  (Reboot reaches a colleague across the room) while its coworker half goes
  down the melee walk-in, so coworkers the click would walk to are left OUT of
  the wash rather than painted as castable ground. Every walk refusal
  names its true cause: a degenerate walk is "as close as the route gets",
  never "not enough AP", and an arrival that can't fire says so instead of
  standing down silently. Before this held together, the walk could aim at a
  line-blocked tile, regenerate the same dead-end point on every click, and
  narrate the loop as an AP shortage at nearly full AP. Each consumer used to compute its own -
  the cursor an ungated pick, the readout a gated tile-centre distance - so the
  crosshair could promise a swing while the readout blanked and a click walked.
  **Hold Ctrl or Alt to glow what you're hovering** (`shading.addHighlight`) -
  a Divinity-style aura of stacked back-face shells at growing push and falling
  opacity, drawn additively so it reads as light rather than paint. OUT of
  combat the glow is an INSPECT verb, gated behind the two keys that already
  mean "show me what's there" (Ctrl's ground rings, Alt's loot labels); lit on
  plain hover it fired on every door and desk the cursor crossed, and a light
  that is always on says nothing. IN combat it is ungated: the cursor there is
  only ever aiming, and combat's hover path hands the tracker characters and
  nothing else, so the glow can't spill onto scenery - making the player hold a
  key to see who they are about to swing at asked for the modifier in the one
  half of the game where the answer is always wanted. What the cursor is over is
  tracked ALWAYS (`hoverTarget`) and the gate only decides whether it's lit, so
  pressing the key lights what you are already pointing at instead of waiting
  for a fresh hover event. The focus banner stays ungated - it costs no
  attention; the crosshair follows the click gate above, because a crosshair
  on a turn where a click is ignored is a lie.
- **Examine is one function, and it names what it is looking at**
  (`main.examineTile` / `examineAt`). Every menu that offers Examine routes
  through it, so the same object reads the same way wherever you ask. Flavor is
  DATA: a tile type's `examine` in `data/tiles.js`, an enemy's or NPC's on its
  def; the helper only decides which applies, falling back to a line built from
  the def's `label`. Only a thing with no label at all is called a cubicle wall
  - that string used to be the catch-all for every solid tile, so chairs,
  sofas, fridges and bookshelves all introduced themselves as one.
  **Right-click opens the menu in combat too.** It stays the universal "back
  out" first (an armed action or a pending confirm lowers, and consumes the
  click); with nothing to cancel it opens an Examine-only menu, because Examine
  had no way in mid-fight at all. Only Examine: every other verb in the
  out-of-combat menu spends a turn, and those belong on the action bar where
  their AP cost is visible.
- **The narrator box counts repeats instead of swallowing them** (`ui.narrate`).
  A line identical to the one above it becomes `… (×2)` on the same row rather
  than a second row - but it is never dropped. It used to return early as "no
  stutter", so examining the same desk twice printed nothing the second time,
  which is exactly the case where the player is deliberately asking again and
  reads silence as a dead button.
- **The whole kit is available outside combat via the persistent hotbar.** The
  sheet's actions live on an always-on bar (`ui.createHotbar`, ids
  `#hotbar-act-<id>` so they never collide with combat's `#act-<id>`; number
  keys press the slots of the visible row). Arming an action and clicking a
  coworker opens combat with that move as the opening strike: `main.js`
  `engageWithAction` -> `beginCombat({opening})` -> `startCombat({opening})`,
  which reuses combat's own `handleEnemyClick` (melee walks up, a throw checks
  range/line/ammo); a summon posts where you click (`postSummonAt`, the same
  placement rule combat runs). Heal/defend are LISTED but inert out here -
  reactive actions with no meaning when nobody's swinging - and pressing one
  says so rather than doing nothing. The bar used to carry the offensive slice
  only, which hid a summoner's whole identity until a fight was already on.
- **Both action bars render one order** (`stats.orderedActionIds`): basic swing,
  shove, throws, class powers, what a talent or a spent class point granted,
  what is in hand. Provenance is re-derived from the registries, because a perk
  bakes its granted action into `sheet.actions` with no note of where it came
  from. Ordering by provenance is what keeps a button still as a kit grows.
- **The hotbar layout is the player's, and it lives on the sheet.**
  `sheet.hotbar` is `[{ kind: 'action'|'item', id } | null, ...]`, set by
  right-clicking a slot (`main.js` `openAssignMenu` -> `assignHotbarSlot`);
  absent means the default order above. Assigning something already on the bar
  SWAPS the two slots, so a power is never in two places. Slots hold consumables
  as well as powers (pressing one drinks it - `loot.useItemById`), rows are
  `HOTBAR_ROW_SLOTS` wide and page with the pager, `[`/`]` or the wheel, and the
  layout is padded with a spare empty slot so there is always somewhere to
  assign to - filling a row is what creates the next one. An assignment whose
  power or item is currently unreachable dims and says why rather than
  disappearing: a muscle-memory surface must not rearrange itself.
- **NPCs are talkable coworkers** (`data/npcs.js`): non-hostile actors
  (`NpcActor`) that stand on the map, block movement like any body, and open a
  small dialogue tree on left-click (`ui.createDialoguePanel`; the tree is
  `{ start, nodes: { text, options:[{label,next}] } }`, `next:null` ends it).
  They live in their own `npcs` array, never in `enemies`, so combat never
  touches them. (The editor has no NPC/companion BRUSH yet, but it no longer
  loses them: a load remaps through `actor-registries.js` and the export names
  every registry, so re-exporting a level keeps its coworkers - fixed
  2026-07-27, pinned by `tests/e2e/editor.spec.js`. They draw as markers on the
  canvas too, so a brush stroke can no longer erase one invisibly.)
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
  with per-member AP/deflect/uses; `combat-session.js` owns which member is
  currently steered. Who the enemies target is `combat-ai.pickTarget`, a
  scored choice, not a nearest-first
  rule (AI_PLAN M2) - an ENGAGEABLE member outranks any unreachable one
  whatever the score, and within that tier nearness, kill-securability,
  fragility and stickiness to last turn's target are blended by the def's own
  `focus`. At `focus: 0` the blend collapses back to the pre-M2 rule (nearest,
  bloodied tiebreak), which is why that reading survived here so long. Campaign saves
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
  combat, switching exists only within a SHARED turn (INITIATIVE_PLAN):
  consecutive member slots in the initiative order hold the floor together -
  BG3's rule, adjacency not equal rolls - and the party bar, Tab, a body
  click or the right-click "Steer" item move steering among the holders
  (`combat.steerMember` -> `makeActive`; never `switchLeader`, which re-keys
  the out-of-combat world). Members outside the open turn still wait for
  their own slot, and when the fight ends the out-of-combat bindings follow
  whoever had the floor (`syncLeaderBindings`). **End Turn** ends the STEERED
  member's turn - each holder presses their own; only when all have does
  initiative move on - and the next slot may be a teammate, a summon you're
  driving, or an enemy. Initiative rolls print to the chat log as a typed
  line ('initiative'), not on the strip. In-combat clicks check the pick ray for a coworker's
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
  `losClear`, `cash`, `shopOpen`, `shopStockAt`, `levelId`, …). `__combat` is mostly read-only (`phase`, `order`, `turn`,
  `party`, `summons`, `enemies`, `lastRoll`, `hoverHitChance`) but also
  carries deliberate LIVE setters god mode and the specs drive: `ap`,
  `defended`, `usesLeft` (edit in place, then `refresh()`), `applyStatus`,
  `summonAlly(archetypeId, n)`, and the determinism pins `forceHit` /
  `forceProc` (`true` always, `false` never, `null` rolls honestly), and
  `bout` - the sparring tally (rounds, AI damage landed, the chosen-beat
  histogram, reactions fired) that `?seed=` exists to make legible. A seeded
  fight DOES replay: damage rolls through `rand`/`randWith(rng, ...)` and
  initiative through `initRng`, both off the one injected stream, so a seed
  reproduces a whole fight rather than most of one. Keep all of it in sync
  when adding state. `window.__god` is the
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
  rig, build, attributes, kit, talent, track - and the class's `name`, so a
  coworker who does the job is called what the job is called unless they
  deliberately override it (the Security Guard does; the two companions do not,
  because neither is a named character). This is the "class as shared unit
  archetype" direction made real, and it exists because the copies drifted -
  reassigning the Mail Room's rig left the mail room companion wearing the old
  one while still calling himself mail room. An override means DEPARTING from the class;
  a lint fails the build if one merely repeats what the class already says.
  Registries export their raw kit tables (`COMPANION_KITS`, `ENEMY_KITS`) for
  it. A class-backed enemy inherits `maxHp` like everything else - the old
  `hp`-vs-`maxHp` double spelling (and the `drop: ['maxHp']` machinery it
  needed) is gone, because a mandatory override is invisible to the lint and
  the Guard sat at 20 against Security's 26 with nothing to say so. The one
  character with no class twin (the Executive) stays written out - The Manager
  looked like a second one until `middle-manager` turned out to have been in
  the registry all along, the same way `human-resources` had; don't invent a
  class just to inherit from one, and check before declaring there's no twin.
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
  `recomputeDerived`. AI-driven units (enemies, and enemy-side summons) are not
  sheets, but attributes are their source too: `unitCombat(def)` derives
  accuracy (Savvy), dodge (Hustle), damage bonus (Savvy), deflect and status
  resist (Composure), grit saves and initiative speed (Hustle) from `def.attr`
  through the SAME functions a sheet uses — everything is the same in enemies
  as allies; no stat gets a side-local substitute (designer, 2026-08-05). The
  storage differs, never the rules: a def's flat `accuracy`/`dodge`/`soak` are
  its gear-equivalent innate lines, stacked on top of the derivation the way a
  sheet stacks equipment. Only max HP/AP stay authored per def (enemies level
  on the placement curve, `scaleEnemy`, not by spending points). (A PLAYER-side
  summon is an actual member: it carries a real sheet — see **Summons** below.)
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
- **The FX layer** (`fx.js`) is one pooled particle pump, one recycling decal
  ring, and the DOM popups - all fire-and-forget, all reached through the `vfx`
  object main.js hands to combat and its own step handlers, so no system ever
  waits on a cosmetic. **A new impact kind is a data entry** (`IMPACTS`): a
  list of bursts (count/colour/speed/size/life, additive for light, lit for
  matter) that callers name by id - `fx.impact(x, z, 'zap')`. **A status's
  look is data too**: its `fx` block in `data/statuses.js` gives the colour,
  the shape of the burst when it LANDS (`rise` for buffs off the feet, `fall`
  for debuffs onto the head, `pop`), and the `aura` it wears while live
  (embers, orbiting motes, drips, haze) - fx.js is that block's runtime the
  same way statuses.js is the rules' runtime, and a status with no `fx` simply
  shows nothing. Cost is bounded by construction: particles reuse pooled
  entities behind a hard ceiling and fade by SHRINKING (so one material per
  colour serves every particle of it), decals recycle oldest-first past a
  fixed ring, and the aura tracker samples the roster at ~16Hz rather than
  per frame.
- **Blood stays on the floor.** A bleeding walker prints bloody footprints
  tile by tile (`fx.footstep`, called from `onMemberStep` and from combat's AI
  step hook), darkest on a paper drift - which is where most bleeding starts,
  since paper CUTS (data/surfaces.js). Wet and coffee-soaked soles print for a
  few tiles too, then dry out; fx.js owns that shoe state, keyed by the actor,
  so callers only report "entered this tile, standing in this". Splats land
  under kills, hits and bleed ticks.
- **The camera flinches** (`controls.shake`, driven through `vfx.shake`):
  explosions, deaths and slams nudge the rig's focus and let it settle. It is
  deliberately tiny and short (capped at 0.16 world units, ~a quarter second,
  a handful of screen pixels) and uses fixed frequencies rather than random
  jitter - anything that aims at a projected world point (the loot labels, the
  e2e helpers' `project`/`project3` clicks) still lands where it looked.
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
