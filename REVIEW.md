# Project Review — Escape Work

Date: 2026-07-28 · Baseline: `d5c96d5`, all 379 unit tests passing.

Method: eleven scoped review passes (per-subsystem bug hunts, data-registry integrity,
architecture/separation-of-concerns, test coverage, consistency/dead code), followed by an
independent adversarial verification pass over every bug and data claim — each claim was
re-traced through the actual code and only kept if the failure scenario holds. 33 bug/data
claims were checked: 29 confirmed, 2 plausible-but-runtime-dependent, 2 refuted (recorded
at the end so they aren't re-litigated later).

## Executive summary

The codebase has a genuinely good architecture on paper — "content is data, code is
systems", pure-logic modules with real unit suites, host-callback seams (`shopping.js`,
`looting.js`) — and the pure modules mostly live up to it. The problems concentrate in two
places:

1. **The two god closures.** `combat.js` (3,136 lines, one `startCombat` closure) and
   `main.js` (2,947 lines, one `startGame` closure) hold every combat rule, the enemy AI,
   the DOM combat panel, and five-plus separable subsystems as closure state. Nothing in
   them is unit-testable, and nearly every confirmed bug below — including the one
   critical — is a cross-cutting interaction between two responsibilities sharing closure
   variables inside them.

2. **Rule duplication across layers.** The gum/slip surface rules exist three times
   (main.js for party members, combat.js for AI units in combat, actors.js for wanderers)
   and have already drifted into a confirmed double-slow bug. The surface→impact-FX map,
   the `paperCutImmune` interpretation, and archetype resolution are each duplicated with
   drift either present or one data edit away.

The single most urgent fix is the critical soft-lock: clicking an enemy with a buff or
mobility action armed resolves it as a melee attack with NaN damage, leaving the enemy
permanently unkillable.

---

## Re-verification against main @ `e8e53de` (2026-07-28)

Main gained one feature since the review baseline: fired ranged weapons (PR #39 —
staple gun, spitball straw, and a `rangeOf()` seam in `stats.js` replacing the
`ammoCost`-as-range proxy). Ten files changed, ~550 lines. Unit suite is 385/385
green after merging.

**Every finding in this document is still present.** The feature touched the
region of the critical NaN bug but not the bug: `handleEnemyClick`'s new
`rangeOf(armed)` branch returns 0 for buff/mobility actions, so they still fall
through to the melee path — the fall-through now sits at `combat.js:2060`, the
NaN damage roll at `combat.js:1318`. Dash preview (`combat.js:722`), `moveStart`
leak, and all main.js/party.js/etc. findings are byte-identical or line-shifted
only. Line numbers elsewhere in this document refer to the `d5c96d5` baseline
and may be shifted a few dozen lines in `combat.js`.

New findings introduced by the fired-weapons feature:

- **`src/combat.js:1035` (medium-low, inconsistency) — ranged-weapon target
  rings contradict the click.** `drawTargets` rings an out-of-range/no-LOS
  enemy `PREVIEW_FAR` (red) for a ranged weapon, but the new walk-in path in
  `handleEnemyClick` (`combat.js:2020-2056`) *accepts* that click: it walks the
  member until the shot is on and fires. Melee's branch rings green precisely
  because "clicking a distant target walks you in" — ranged weapons got the
  walk-in behavior but not the ring update. Same preview≠click contract break
  as the summon-cap finding.
- **`tests/e2e/ranged.spec.js:100,119,165` (low, test-gap)** — three bare
  `waitForTimeout(700/900)` sleeps instead of state polls, the same convention
  breach flagged for `editor.spec.js` (and the same CI-flake mechanism).
- **Status of related old findings:** the `ammoCost`-as-range confusion is
  genuinely fixed by `rangeOf()` (good — one SOC drift removed). But the
  projectile/impact hardcoding finding *persists in a new shape*: flight choice
  is still id-keyed (`id === 'paper-airplane' ? 'plane' : …'shot'/'ball'`,
  `combat.js:1296-1299`), and every ranged hit — staples included — lands with
  the paper-shred impact (`hitFx(en, rangeOf(id) ? 'paper' : 'melee')`,
  `combat.js:1323`). The case for a data-side `projectile`/`impact` field on
  the action entry is now stronger, with three id-special-cases instead of two.

Two **latent rendering bugs** confirmed in current source (surfaced by
CHARACTER_PLAN.md analysis; harmless today only because every body is dressed
exactly once, and blocking for any feature that re-dresses a live entity):

- **`src/models.js:95`** — `applyCharacterProportions` adds the hip lift to the
  *current* local position (`tp.y + hipY * (legs - 1)`); a second application
  compounds and the body floats.
- **`src/actors.js:79`** (duplicated inline at **`src/main.js:550`**) —
  `applyTint` multiplies the *current* diffuse; re-tinting walks the body
  toward black. The duplicate in `previewClass` is its own SOC smell — two
  copies of "how to tint a body".

The prioritized fix list now lives in `TODO.md`, which folds in
`CHARACTER_PLAN.md` (in this repo since the creation rework).

**Both rendering bugs are fixed, and the SOC smell with them.** The inline
duplicate below was not folded in when it was first flagged - the creation work
added a SECOND copy instead, so "how to tint a body" briefly existed three
times. All three are now one `dressBody`, with the actor as an argument.

---

## 1. Confirmed bugs

Every finding in this section survived an adversarial re-trace of the code path.

### Critical

- **`src/combat.js:2003` — Enemy click with a buff/mobility action armed resolves as a
  melee attack with NaN damage; the fight soft-locks.**
  `handleEnemyClick` dispatches on cone/summon/zone/ranged-control/shove/ammoCost and
  falls through to the melee path for everything else — including armed `buff` and
  `mobility` actions (`onActionButton` arms both, and `main.js:1990` routes every
  enemy-body click here; the friendly-fire gate at `main.js:1984` only intercepts clicks
  on party/summon bodies). An HR member arming Performance Review and clicking an
  adjacent enemy runs `strike()` → `performOn()`: 2 AP spent, a rationed use consumed,
  then `dmg = rand(a.min, a.max) + …` with no `min`/`max` → `NaN`.
  `takeDamage(NaN)` sets `hp = Math.max(0, hp - NaN)` = `NaN` (`actors.js:390`), which is
  never `<= 0`, so the enemy can never die — by any later damage source — and victory
  (`!engaged.some(e => e.alive)`) is unreachable. The NaN persists outside combat too.
  One natural misclick irrecoverably soft-locks the fight. Fix: guard the melee
  fall-through on action type, and/or clamp `takeDamage` against non-finite amounts.

### High

- **`src/combat.js:722` — Dash route preview stores the wrong shape in `preview`,
  throwing every frame.** `showDashPreview` assigns `preview = points` (a bare `[x,z]`
  array) but `drawPreview` — called unconditionally each frame from `update()` at
  `combat.js:2869`, *before* the victory scan, pendingMelee resolution and AI beats —
  expects the `{ reach, tail }` object the movement path stores (`combat.js:843`).
  `preview.reach` is `undefined` → TypeError per frame while a Mail Room member hovers a
  valid Courier Route tile; the rest of combat's update is skipped until the hover
  changes. Secondary hazard on the same path: `handleHover` calls
  `showDashPreview(point, …)` with no null guard (`combat.js:819`), so an enemy-body
  hover whose ground ray misses throws on `point.x` (`combat.js:711`).

- **`src/combat.js:1557` — Stale `moveStart` records make dashes provoke opportunity
  attacks after any prior walk.** Mobility's no-provoke guarantee works by *not* calling
  `beginMove`, but `moveStart` entries are only ever `.set` (`combat.js:2636`, `2673`),
  never deleted when a walk completes. A member who walked on an earlier turn still has a
  record; a later Courier Route out of an enemy's reach fires `notifyStep` → finds the
  stale record → `provokedBy` runs, and the enemy (plus overwatch) gets a free swing —
  while the tooltip promises "Provokes no opportunity attacks" (`combat.js:2194`).
  Fix: clear the mover's `moveStart` entry when its deliberate move ends.

- **`src/main.js:592` — Dying or winning in an editor playtest deletes the player's real
  campaign save.** `loseGame()` calls `clearProgress()` unconditionally, and the exit
  handler's non-campaign branch does the same. Playtest mode (`STASH_KEY`) never wrote
  `PROGRESS_KEY`, but both endings still remove it — so a mid-campaign player who
  playtests a level they're building and loses (or reaches the playtest exit) silently
  erases their unrelated campaign run. Wipe-on-death semantics leak across modes.

### Medium

- **`src/actors.js:453` + `src/combat.js:232` — Out-of-combat gum resurrects the
  documented double-slow bug, permanently.** Three finders independently converged on
  this. `combat.js:225-233` derives AI unit speed as `baseSpeed × statusFx(u).speedMult`,
  with a comment explaining the in-place-multiply bug it replaced ("down to 0.36×").
  But the wander path still does exactly that: `actors.js:452-453` applies the gum
  *status* **and** multiplies `this.speed *= GUM.slow` in place. An enemy that wanders
  through gum before a fight enters combat at 0.6×; `syncUnitSpeed` snapshots that
  polluted value as `baseSpeed` and applies the status again → 0.36×. Worse, a purge
  (`clearStatuses` + `syncUnitSpeed`) restores only to the polluted baseSpeed, so the
  unit limps at 0.6× forever with no status explaining why.

- **`src/data/actions.js:83` — `paper-storm` lacks `leavesTurns`, so its drifts are
  permanent terrain.** Zones resolve via `world.leaveSurface(x, z, a.leaves,
  a.leavesTurns || 0)` (`combat.js:1638`) and `leaveSurface` only registers expiry when
  `turns > 0` (`main.js:1610`). Every Paper Storm permanently converts up to ~9 floor
  tiles into damaging, bleed-inflicting paper terrain — directly contradicting the stated
  invariant that surfaces a power drops during a fight are litter (`main.js:389-391`).

- **`src/hover.js:257` — `clear()` never resets `hoverTarget`, so Ctrl/Alt re-lights a
  target no longer under the cursor.** `clear()` resets kind/highlight/cursor/banner but
  leaves `hoverTarget`; `setCtrl`/`setAlt` re-run `applyGlow()`, which re-lights whatever
  it still holds. Hover an enemy, slide onto the hotbar or open a panel (both call
  `hover.clear()`), press Ctrl — the stale body re-lights across the screen and the reach
  ring draws for it.

- **`src/main.js:2649` — Floor-transition restore strips the active companion's `def`;
  Talk/shop verbs permanently lost.** On campaign restore the saved-active member is
  embodied as the bare `PlayerActor` (no `def`/`typeId`/`recruited`); only non-active
  members get a `CompanionActor` with their COMPANIONS def. Every talk affordance gates
  on `ref.def?.dialogue` (`main.js:1014`, `2120`), so if you were controlling a recruited
  companion (e.g. the mail-cart merchant) when you took the exit, their Talk/shop verbs
  are gone for the rest of the run.

- **`src/main.js:1328` — Level-up allocation screen reachable mid-combat.** The HUD pip
  is gated `!inCombat`, but the party-bar pip (`ui/hud.js:370`, visible in combat via
  `main.js:2558`) and the character-sheet button (`main.js:1357`; the sheet opens in
  combat) both call `openLevelUpFor`/`openLevelUps` ungated — a fullscreen overlay opens
  over a live fight while enemy turns keep advancing under it and stats change
  mid-initiative.

- **`src/party.js:83` — `normalizeSheet` never backfills `xp`/`xpNext`; a legacy save can
  never level again.** The function's stated contract is "no math ever meets undefined",
  and the legacy v1 shape it supports is fixtured in the repo's own tests *without*
  `xp`/`xpNext` (`tests/unit/party.test.js:128`). After loading such a save,
  `gainXp` yields `sheet.xp = NaN` and `while (NaN >= undefined)` never fires — the
  character silently never levels again, and the NaN persists through every save.
  (Verified by executing `parseProgress` + `gainXp`.)

- **`src/surfaces-runtime.js:36` — the `burned` set is never invalidated, so a fresh
  paper drift on a burnt cell is permanently inert.** `ageTempSurfaces` legitimately
  reverts a burnt temp drift's tile to floor and calls `loot.forgetPaper` ("a fresh drift
  here later is gatherable again"), but the runtime still holds the cell in `burned`:
  `surfaceAt` returns null and `flammable` false forever, so a re-laid drift has no
  effects, can't be gathered, and can never be ignited.

### Low

- **`src/combat.js:2122`** — Toppling a prop skips the solid-edge test that shoving a
  person requires: shove-a-person threads `world.stepOpen`, shove-a-prop checks bare
  distance, so a bookcase can be toppled through a closed partition onto whoever is
  behind it.
- **`src/combat.js:2306`** — `summonSpotProblem` (preview) never checks the live summon
  cap the click enforces, so the preview shows green and the click refuses with the wrong
  reason — breaking its own "same rule the click runs" contract.
- **`src/combat.js:1133`** — `notifyMemberDown` ends a dead active member's turn without
  re-binding `active` to a survivor (its two sibling paths do, with comments naming this
  exact failure); HUD and post-combat leader can point at the corpse.
- **`src/controls.js:129`** — No `mouseleave` handling: the pointer exiting the browser
  window across the canvas edge leaves the last hover live indefinitely (banner + combat
  glow). The module's own comment recounts fixing the identical symptom for the
  slide-onto-UI case.
- **`src/god.js:306`** — God-panel inventory chips capture slot indices at render time
  but `signature()` doesn't fingerprint the bag, so after the bag changes the ✕ button
  splices the wrong item.
- **`src/god.js:393`** — Enemy pin keys are array-index-based (`enemy-${i}`); splicing
  the enemies array (expired summon) shifts indices, so pins misreport and clicking one
  can delete another enemy's pin.
- **`src/main.js:918`** — `approachCache` is keyed only on (player tile, target tile,
  epoch); only `toggleDoor` bumps the epoch, so explosions, topples and blocker movement
  leave armed-attack rings/cursors contradicting what the click actually does.
- **`src/main.js:506`** — `spawnSummonUnits`' async `onReady` has no liveness guard: a
  summon dismissed before its `.glb` lands resurrects as a frozen ghost model with a live
  pick registration nothing owns. (The codebase already uses a token guard for exactly
  this pattern elsewhere.)
- **`src/main.js:1854`** — The floor-clear `localStorage.setItem` is unguarded (boot
  reads are try/caught); a quota/denied throw fires after `gameOver = true` and before
  `showFloorClear`, freezing the run with no overlay and no way forward.
- **`src/models.js:40`** — A failed `.glb` load only `console.warn`s; a solid prop tile
  keeps blocking movement/LOS with nothing drawn and nothing pickable — an invisible
  wall, despite every tile def carrying a fallback `color`.
- **`src/pathfinding.js:129`** — `clampToClearance`'s diagonal-corner repulsion checks
  solid *cells* only, ignoring edge walls, so standing bodies overlap partition ends by
  up to ~0.23 tile (verified numerically).
- **`src/scene.js:194`** — `refreshTile` unconditionally re-renders the floor box (which
  `buildLevel` already placed and nobody tracks); every topple leaks two coincident
  floor-box entities, unbounded over a session.
- **`src/statuses.js:113`** — On re-apply, `map[id]?.sev ?? 0` treats a missing `sev` as
  0 while every *read* site treats it as 1 (pinned by the test suite), so a resisted
  re-apply *weakens* a pre-severity status entry — the exact thing the adjacent comment
  forbids. Pre-severity entries are actively produced by party.js's v4 migration.
- **`src/tactics.js:88`** — `reachOpen`'s 0.1-step sampling merges two nearby boundary
  crossings into one "diagonal" transition and applies the permissive either-L rule, so
  swings cross a closed edge within ~0.1 tiles of a wall's end (verified repro).
- **`src/ui/hud.js:277`** — Hotbar slots hard-`disabled` at 0 count can't receive
  `contextmenu`, so a spent item slot is permanently un-reassignable (its tooltip still
  advertises right-click).
- **`src/ui/screens.js:215`** — Registry/content strings (class, action, perk, item,
  level names) are interpolated raw into `innerHTML` across screens.js, panels.js and
  hud.js; any content name containing `<`/`&` breaks the UI. Content is explicitly meant
  to be added freely as data.

### Plausible (runtime-dependent, not statically settled)

- **`src/scene.js:201`** — `refreshTile`/`buildLevel` async model callbacks have no
  staleness guard (the editor path has one): two quick topples on one tile, or a
  `setType` racing an in-flight load, can strand an unremovable model.
- **`src/scene.js:189`** — A conduction-changing `setType` (topple landing on a cable or
  pool neck) re-runs the grid flood fill but only re-renders the mutated cell, so
  neighbouring pool tiles keep pulsing the electrified material after
  `isElectrified` turns false.

---

## 2. Architecture and separation of concerns

### The two god closures

- **`src/combat.js` — one 3,087-line `startCombat` closure, ~80 inner functions, ~30
  shared mutable closure variables** (`active`, `armed`, `preview`, `pendingMelee`,
  `moveStart`, `facings`…). At least seven distinct responsibilities: the DOM combat
  panel/action bar/initiative strip (with inline affordability rules, contradicting the
  "a panel is a dumb VIEW" rule `ui/` obeys); targeting previews/rings/hover; all player
  verb resolvers; turn-engine wiring; summon lifecycle; the entire enemy AI; the
  per-frame driver. This structure is not just untestable — it is where the bugs above
  came from: the dash-preview crash is a verb resolver corrupting a renderer's state, and
  the dash-provoke bug is one verb bypassing another subsystem's bookkeeping, both via
  shared closure variables. Concrete seams (in rough order of value): the AI block
  already consumes only the injected `world`/fx/log; the verb resolvers and pure helpers
  (`coneTest`, `zoneCells`, `topplePlan`, slam damage, `opportunityStrike`) could follow
  the `powers.js`/`tactics.js` extraction precedent; the DOM layer consumes a read-only
  view of turn state.

- **`src/main.js` — one 2,858-line `startGame` closure.** Its own header claims it "only
  wires the pieces together", but it owns complete subsystems with clean seams, each
  already shaped like the existing `shopping.js`/`looting.js` host-callback pattern:
  summon lifecycle (~250 lines), hotbar layout/arming (~300 lines of pure view-model
  logic), dialogue + recruitment, per-tile step rules, door registry, follower AI, and
  the `window.__game`/`__god` debug surface (~240 lines).

- **`src/actors.js:412`** — `EnemyActor.update` embeds gameplay *decisions* (wander
  cadence, 45% idle roll, leash-bounded destination picking) and gameplay *rules* (the
  third copy of gum/slip) in the engine-actor layer. The wander brain already consumes an
  injected `world` object and touches no PlayCanvas API — it would extract cleanly to a
  pure module.

### Rule triplication (the highest-value SOC fix)

- **`main.js:1777` / `combat.js:2834` / `actors.js:446` — gum-stick and slip are
  implemented three times, in three layers, with three different speed plumbings** — and
  the copies have already drifted (the confirmed double-slow bug above). The main.js
  header above one copy literally says "the per-tile rules, written once".
  `main.js:1788` even special-cases gum out of its own generic surface path by id.
  One shared step-rule module consumed by all three actor populations would remove the
  whole bug class.

### "Content is data, code is systems" violations

Each of these breaks the documented data-only growth path — adding content requires
editing system code:

- **`main.js:715`** — item id `'matches'` hardcoded in `canIgnite`/`igniteAt`; a
  fire-source data field (matching the existing `hasLighter` talent effect) would fix it.
- **`combat.js:1288`** — projectile model keyed on `id === 'paper-airplane'`, impact
  burst on `a.ammoCost ? 'paper' : 'melee'`; actions carry no projectile/impact field
  even though statuses already model looks as data `fx` blocks.
- **`combat.js:412` + `main.js:2368`** — `hazardKind`/`surfaceImpactKind` are
  near-identical surface-id→impact-FX maps, duplicated and both hardcoded — under a
  comment claiming the design avoids exactly this. An `impact` field on the surface entry
  deletes both.
- **`statuses.js:64` + `main.js`** — `paperCutImmune` interpreted via two different
  hardcoded content ids ('bleed' in the pure module, 'paper' in main.js); the first
  non-paper bleed source silently diverges them. The code itself marks the branch
  "legacy" — migrate to `statusImmune: ['bleed']` in class data.
- **`scene.js:65`** — exit beacon keyed on tile id `'exit'` while the exit *mechanic*
  correctly keys on `onEnter.effect === 'exit'`; a second exit-style tile renders with no
  beacon.
- **`looting.js:59`, `looting.js:309`, `fx.js:634`** — paper-harvest keyed on surface id;
  Alt-overlay icons hardcoded per loot table/shop; footprint staining hardcodes
  `'water'`/`'coffee'`. All three belong as fields on the data entries.
- **`ui/panels.js:165` (+ `ui/hud.js`)** — the "dumb view" panels import rules modules
  and derive item verbs from raw registry fields (`def?.heal || def?.ammo` → Use);
  a new consumable kind renders an Examine button until UI code is edited.

### The cheat layer

- **`src/god.js:73`** — the full cheat panel (set cash, spawn enemies, teleport, pin
  hp/AP, timeScale) is unconditionally live in production: global hotkeys (Backquote /
  IntlBackslash / F8, with `preventDefault` claiming those keys always), `#god` hash
  auto-open, and localStorage persistence. No dev gate, no build flag. Related
  consistency gap: it writes `hp` raw with no clamp (its own `commit()` comment
  establishes the setter rule, but only `cash` got one) — a dead enemy can be "healed" to
  full HP at `alive=false`, states the game can't produce or handle (`god.js:398`).

---

## 3. Test gaps

- **`combat.js`: 3,136 lines of combat rules, zero unit tests, structurally
  untestable.** The only export is the closure factory; `const pc = window.pc` at module
  top breaks node import. Pure logic locked inside with no direct assertion anywhere:
  `coneTest` wedge clipping, `zoneCells`, `topplePlan`, slam damage, the SURPRISE_RADIUS
  rule, `opportunityStrike`, and the whole AI (`pickTarget`, `aiAdvance`, `aiAttack`).
  The e2e suite drives combat through the `forceHit`/`__combat.ap` backdoors, so an
  off-by-one in cone clipping or a flipped comparison in target selection would keep all
  379 tests green. Both the critical NaN bug and the dash-preview crash in §1 are in
  exactly this untested file.
- **`combat.js:23` — the rng seam is misleading.** `startCombat` accepts an injectable
  `rng`, but only hit rolls honour it: the module-level `rand` (all damage, AI attack
  choice) hardwires `Math.random`, initiative uses its own hardwired closure, and slip
  checks call `Math.random` directly. Even a seeded run is nondeterministic, foreclosing
  the harness-level combat tests that would close the gap above.
- **`actors.js` — cannot even be imported under node** (`window.pc` at module scope); the
  waypoint state machine, the tile-change detection that fires every `onTile` hook
  (exits, surface damage, step statuses), and shove slides have zero coverage.
- **`main.js` inlines untested critical decisions:** the downed-member stairwell revive
  (`Math.max(hp, 0)` clamp — no test exits a floor with a 0-HP companion), and the boot
  save-resolution cascade, where one shared try/catch means a corrupted editor stash
  silently skips a *valid* campaign save and boots floor 1.
- **`looting.js`** — never got the pure/runtime split its sibling economy code got
  (`shop.js` rules exhaustively unit-tested; `shopping.js` narrates). `createLooting` is
  fully dependency-injected — clearly built for fakes — but its import chain
  (`tile-renderer.js` → `window.pc`) kills node import, so consumable semantics, cash
  crediting and the one-shot container-roll contract are e2e-only.
- **`data/items.js:321`** — `rollLoot` hardwires `Math.random` (its twin `rollStock`
  takes an rng and has chance-semantics tests), and the "chance 1 entries guarantee
  rummaging is never pointless" invariant is asserted nowhere; `looting.spec.js` *depends*
  on the desk's guaranteed coffee. A data edit to 0.9 turns the unit-green suite into a
  1-in-10 e2e flake absorbed by `retries: 1`.
- **`tests/e2e/editor.spec.js:52`** — the regression test for a proven data-loss bug
  gates its export round-trip on a flat `waitForTimeout(500)` instead of the readiness
  poll the test directly above it uses; on a slow CI runner it serializes the previous
  level and flakes.
- **Engine-bound layer (~6,500 lines)** — fx, hover, controls, shading, scene, portraits,
  models, picking, tile-renderer, ui/*: honestly engine-bound, mostly an accepted trade.
  The actionable slice is `god.js` (715 lines whose verbs the e2e suite leans on as its
  backdoor — a broken god verb fails *other* specs, not its own) and `editor.js`
  (level canonicalization/serialization is registry logic, and it has already had a
  silent data-loss bug).

---

## 4. Inconsistencies, dead code, doc drift

### Conventions that invite bugs

- **`data/surfaces.js:87`** — movement drag is spelled three ways with *opposite*
  directions: surfaces use `slow` (lower = slower, AP × 1/slow), footwear uses `moveCost`
  (higher = slower), statuses carry both (`moveCostMult: 1.5`, `speedMult: 0.6` — and
  note 1/0.6 ≠ 1.5, so they're independently tuned). An author writing `moveCost: 0.5`
  after writing `slow: 0.5` gets a 2× speed *boost*.
- **`main.js:2899`** — two archetype-resolution sites use opposite registry precedence
  (`CLASSES[id] || ENEMY_TYPES[id]` for summons vs `ENEMY_TYPES[id] || CLASSES[id]` for
  god-spawn), and no lint enforces id-uniqueness between the registries.
- **`grid.js:89`** — unknown *tile* ids throw a named, located error; unknown *actor* ids
  silently become enemy spawns and crash two modules later as
  `Cannot read properties of undefined (reading 'level')` — worst for editor-playtest
  stashes, which bypass the levels lint.
- **`tactics.js:208`** — `isFlanked` never consults the edge test, so an ally behind a
  partition or closed door grants the +15% pincer bonus while `threatens()` for that same
  ally is false (verified at runtime), contradicting the module's own "a pincer means
  bodies" rule. `positionMods` has `edgeOpen` in scope and doesn't pass it.
- **`tactics.js:263`** — surprise escapes `POSITION_CAP`: the plan's formula caps
  flank+backstab+surprise together; the code caps only flank+backstab and adds surprise
  outside it — up to +0.50 total where the spec says +0.35. The code comments acknowledge
  it; the plan was never updated. Decide which is right and align the other.

### Dead code

- **`data/enemies.js:200`** — `regional-executive` is unreachable: no shipped level
  places `'X'` and level2 has no `next`. Five loot rows, three attacks, a stat block —
  dead by the repo's own lint standard, but no lint covers unplaced enemies.
- **`looting.js:127`** — `INV_CAP = Infinity` makes the overflow branch and two
  player-facing "pockets full" refusal paths unreachable; the only exercise is a unit
  test passing a literal 10 with a stale "// at INV_CAP" comment.
- **`main.js:1771`** — `applySurfaceOn`'s `sfx.ammo` branch is dead: no surface `onEnter`
  carries `ammo` (walk-up pickup was deliberately replaced by Alt-gather), yet it
  suggests surfaces can arm walkers.
- **`tile-renderer.js:21`** — the emissive exit material is applied to nothing (the exit
  def now carries a model), and the comment "the exit tile already glows a little" is
  stale; the editor shows no exit cue at all.
- **Exports with zero importers** — `stats.normalizeAttr`, `stats.nodeAvailable`
  (documented as shipped API in PROGRESSION_PLAN, while the level-up UI *re-derives* its
  rule by hand — a real divergence-in-waiting), `fx.FEET_Y`/`HEAD_Y`/`groundDecal`,
  `hover.HL`, `pathfinding.BODY_RADIUS`, `looting.INV_CAP`.
- **`data/tiles.js:213`** — `snack-machine` declares category `'furniture'`, unknown to
  the editor's palette order; it renders as a lone row at the end instead of sitting in
  `breakroom`.

### Doc drift

- **`ARCHITECTURE.md`** — the flagship doc is wrong on: combat AP ("1 AP per tile" —
  it's 0.5) and melee range ("needs adjacency" — reach is continuous Euclidean, never
  mentioned); the module map (omits `powers.js`, `portraits.js`,
  `data/actor-registries.js`; pure-module list omits `powers`; `actions.js` described as
  "attack/defend/heal" vs the nine-verb vocabulary); the layering claim ("data/* imports
  nothing, levels.js the one exception" — four data modules import, two importing
  *behavior*); and the editor warning (it still claims re-export drops NPCs/companions —
  that data-loss bug is fixed, and the warning steers authors toward hand-editing JSON,
  where the actor-typo crash lives).
- **`MOVEMENT_PLAN.md`** — header says "No code yet"; all five milestones shipped, and
  its present-tense facts (1 AP/tile, attacks cost 3, one shoe item) are each wrong.
- **`TACTICS_PLAN.md:103`** — asserts "neither shipped level places a single `#` cell";
  both do — this document's own milestone-3 log, 115 lines later, records adding them.
- **`data/companions.js:129`** — both companion kit comments name actions that no longer
  exist ('Return to Sender', 'firewall').

### Performance (minor)

- **`ui/hud.js:410`** — `levelUpPip.refresh` writes `textContent`/`style` every frame
  from the update loop while points are banked — the one HUD element skipping the
  change-gating its neighbours use.
- **`ui/readouts.js:124`** — `setFocusBanner` tears down and rebuilds its DOM on every
  hover call; while a vision-impairment status is active, `refreshHover()` runs the full
  pick+banner rebuild at 60 Hz with a motionless mouse.

---

## 5. Claims investigated and refuted

Recorded so future reviews don't re-raise them:

- *"Detained members can dash/swap free (rooted only enforced via moveBudget)"* — the
  gap in the code is real (`performDash`/`performSwap` never consult `rootedNow`), but
  today unreachable: the only rooted status is `detained` and every application path
  points player→enemy, and no enemy has dash/swap verbs. Worth a defensive guard if
  detained ever lands on party members, but not a live bug.
- *"Context-menu clamp hardcodes 190px, clipping wide menus"* — the hardcoded width is
  real, but the menu is `position: fixed` with `width: auto`, so CSS shrink-to-fit wraps
  labels instead of overflowing the viewport.

---

## 6. Suggested priorities

1. **Fix the critical soft-lock** (`combat.js:2003`): type-guard the melee fall-through
   and clamp `takeDamage` against non-finite damage — the clamp also converts any future
   NaN source from a soft-lock into a visible no-op.
2. **Fix the three save/progression data-loss bugs**: playtest wiping the campaign save
   (`main.js:592`), legacy saves never leveling (`party.js:83`), and the stripped
   companion def (`main.js:2649`). All three silently destroy player progress.
3. **Unify the per-tile step rules** (gum/slip) into one module consumed by all three
   actor populations — it removes a confirmed bug and the layer where the next one of
   this class would grow.
4. **Start carving `combat.js`** at the seams listed in §2, beginning with the enemy AI
   and the pure geometry helpers (`coneTest`, `zoneCells`, `topplePlan`) — extraction
   makes them unit-testable, and finishing the rng seam makes full resolution replayable
   under test.
5. **Add the cheap lints**: unknown actor ids in `grid.parseLevel` (named error like the
   tile path), loot-table guaranteed-drop invariant, CLASSES/ENEMY_TYPES id-uniqueness,
   unplaced-enemy detection.
6. **Sweep the docs** (ARCHITECTURE.md and MOVEMENT_PLAN.md first) — several are now
   actively misleading about shipped mechanics.
