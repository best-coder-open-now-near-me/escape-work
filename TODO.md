# TODO — Escape Work

The combined worklist: every open finding from `REVIEW.md` (verified still
present against main @ `e8e53de`) plus the character-creation feature from
`CHARACTER_PLAN.md` (branch `claude/custom-character-creation-3ga2ni`,
milestones M1–M6). Items reference REVIEW.md by `file:line` for full detail;
line numbers are the review baseline and may be shifted slightly in
`combat.js`.

## Phase 0 — Critical fix + data-loss fixes

- [ ] **Fix the combat soft-lock** (`combat.js:2060`): guard `handleEnemyClick`'s
      melee fall-through so armed buff/mobility actions never resolve as
      strikes; clamp `takeDamage` against non-finite amounts (`actors.js:390`)
      so any future NaN source degrades to a visible no-op, not a soft-lock.
- [ ] **Editor playtest must not wipe the campaign save** (`main.js:592`):
      gate `clearProgress()` on campaign mode in both `loseGame()` and the
      exit handler's non-campaign branch.
- [ ] **Backfill `xp`/`xpNext` in `normalizeSheet`** (`party.js:83`) so legacy
      saves can level again. *Do together with CHARACTER_PLAN M3's save v7
      bump — same function, one migration test pass.*
- [ ] **Preserve the active companion's `def` across floor transitions**
      (`main.js:2649`): embody the saved-active member from its registry def,
      not the bare `PlayerActor`.
- [ ] **Fix the closed-door combat deadlock** — verified reproducible in
      shipped `level1.json`. Combat triggers *through* a closed door
      (`adjacentEnemyToParty`, `main.js:1501`, is pure Chebyshev with no edge
      test) and the `engaged` set is chosen by Chebyshev radius alone
      (`main.js:1690`, no reachability or LOS test), so an enemy sealed behind
      a closed door joins a fight it can never take part in. Because doors
      can't be opened in combat and closed doors block sight, that enemy is
      unreachable by every verb; victory requires it dead and there is no
      flee, so the fight never ends. Fix needs two of: an edge test on the
      trigger, a reachability/LOS filter on `engaged`, and openable doors
      (below).

## Phase 1 — High bugs

- [ ] Dash preview stores the wrong shape in `preview`, throwing every frame in
      `update()` (`combat.js:722`); also null-guard `showDashPreview(point,…)`
      (`combat.js:819`).
- [ ] Clear `moveStart` when a deliberate walk ends so dashes stop provoking
      opportunity attacks after any prior walk (`combat.js:1557`).
- [ ] **Enemy AI paces between two tiles instead of attacking**
      (`standTilePath`, `combat.js:96`). It can never select the tile the unit
      is already standing on: `findEnemyPath` to the unit's own tile returns
      null (`findPath` rejects a goal that fails `isWalkable`, and main.js's
      `isWalkable` folds in `enemyAt`), and the `p.length > 1` filter would
      drop the length-1 self-path anyway — so line 101's explicit
      `!(unit.x === tx && unit.z === tz)` exemption is dead. Any unit that is
      adjacent but not in reach is therefore always sent to a *different*
      adjacent tile, and the same logic sends it back next turn. Verified
      oscillating (3,2)→(3,3)→(3,2)… forever. The player-side twin
      `routeBeside` (`combat.js:2094`) already fixes exactly this and carries a
      comment describing the same symptom — port that special case.
- [ ] **Ranged walk-in asks a melee question** (`combat.js:2020-2056`): the
      ranged-weapon path routes via `routeBeside(en)` (a tile *beside* the
      enemy) when the requirement is any tile within `range` with line of
      sight, so it refuses "No way to get a shot at them" while reachable
      firing positions exist. Verified two ways: over a full-height partition
      (5 legal firing tiles, nearest 3 steps) and — with no walls at all — an
      enemy ringed by its own allies (33 legal firing tiles, nearest 3 steps),
      since `isWalkable` excludes enemy tiles. Same wrong question out of
      combat (`oocTargetOk`/`bestApproachPath`, `main.js:943`/`:799`) — but
      keep an unreachability guard there, since `main.js:1698` deliberately
      refuses openers that would start a fight nobody can close.

## Phase 2 — Medium bugs

- [ ] Gum double-slow: remove the in-place `this.speed *= GUM.slow` from the
      wander path (`actors.js:453`) — the status already carries the slow.
      *Best done as part of the step-rule unification in Phase 5.*
- [ ] `paper-storm` needs `leavesTurns` (`data/actions.js:83`) — its drifts are
      currently permanent terrain.
- [ ] `hover.clear()` must reset `hoverTarget` so Ctrl/Alt can't re-light a
      stale body (`hover.js:257`).
- [ ] Gate the party-bar level-up pip and character-sheet Level Up button on
      `!inCombat` (`main.js:1328`, `ui/hud.js:370`).
- [ ] Invalidate `surfaces-runtime`'s `burned` set when a burnt cell is
      repainted, so re-laid drifts work (`surfaces-runtime.js:36`).
- [ ] Ranged-weapon target rings must match the click's new walk-in behavior
      (`combat.js:1035` vs `2020-2056`) — ring green when a walk-in shot is
      affordable, as melee does. *(New in `e8e53de`.)*
- [ ] **Let doors be used in combat.** Blocked at four independent layers:
      `toggleDoor` early-returns on `inCombat` (`main.js:850`, no comment
      explaining it); the in-combat click path never reaches `dispatchHit`,
      the only route to `approachDoor` (`main.js:1972+`); the Alt overlay that
      carries door entries is gated `!inCombat` (`main.js:2289`) and hidden at
      combat start (`main.js:1523`); and the in-combat right-click menu offers
      only Examine (`main.js:2105`). Net effect: closed doors are the game's
      only true line-of-sight blocker and the player can neither open nor close
      one during the half of the game that is about positioning — while
      `examineAt` still cheerfully describes the door they cannot touch.
- [ ] **Ring non-enemy combat targets.** `drawTargets` (`combat.js:919-1050`)
      rings only zone cells, summon spots, allies, live enemies and the caster
      — never doors, and never **props**, even though props are valid combat
      targets (topple via `handleTileClick` → `topplePlan`, `combat.js:2185`).
      In-combat `onHover` also only inspects `hit?.kind === 'enemy'`
      (`main.js:2050`), so a door or prop under the cursor gets no glow, no
      focus banner and no cursor change. Pairs with restoring some form of the
      Alt overlay in combat.

## Phase 3 — Low bugs (batchable by file)

- [ ] `combat.js`: topple-through-wall (`:2122`), summon preview ignores live
      cap (`:2306`), `notifyMemberDown` leaves `active` on the corpse (`:1133`).
- [ ] `main.js`: `approachCache` staleness (`:918`), summon `onReady` liveness
      guard (`:506`), unguarded floor-clear `localStorage.setItem` (`:1854`).
- [ ] `god.js`: inventory-chip signature ignores the bag (`:306`), index-based
      enemy pin ids (`:393`), raw hp writes / full-heal on corpses (`:398`).
- [ ] UI: window-leave never ends hover (`controls.js:129`), disabled hotbar
      slots un-reassignable at 0 count (`ui/hud.js:277`), escape content
      strings before `innerHTML` interpolation (`ui/screens.js:215` et al.).
- [ ] Rendering: fallback marker for failed `.glb` loads (`models.js:40`),
      `refreshTile` floor-box leak (`scene.js:194`), async model staleness
      guard + stale electrified-pool visuals (`scene.js:201`, `:189`).
- [ ] Pure logic: edge-wall-aware corner repulsion (`pathfinding.js:129`),
      `reachOpen` sampling near wall ends (`tactics.js:88`), `sev ?? 0` vs
      `?? 1` on re-apply (`statuses.js:113`).

## Phase 4 — Character creation (CHARACTER_PLAN.md, M1–M6)

Feature plan lives on `claude/custom-character-creation-3ga2ni`. Each milestone
is its own PR that keeps unit + e2e green.

- [ ] **M1 — Sheet-owned look, zero behavior change.** `lookOf(sheet)` exported
      from `stats.js`; delete `main.js`'s `sheetLook` closure and repoint its
      call sites; promote `bakeNodeEffect` → `applyEffect`. *Also pays down the
      REVIEW.md SOC debt of look-resolution being trapped in the `startGame`
      closure.*
- [ ] **M2 — Idempotent dressing.** Fix the two latent compounding bugs:
      hip-lift baseline (`models.js:95`) and tint-from-pristine-diffuse
      (`actors.js:79`), folding `previewClass`'s inline duplicate
      (`main.js:550`) into the shared path. Unit test: dress one stub entity
      ten times ≡ once. *Blocking for any UI that re-dresses a live body.*
- [ ] **M3 — Flow host + identity + save v7.** `creation.js` (pure) +
      `ui/creation.js` (dumb view), name + pronouns, `#class=` express lane
      skips creation, `#creation-skip` accepts defaults. Save v7 additive.
      Suite cost: two edits (`helpers.js pickClass`, `game.spec.js:33`).
      *Bundle the Phase 0 `xp`/`xpNext` backfill into the same
      `normalizeSheet` change.*
- [ ] **M4 — Appearance.** `data/looks.js` (RIGS ×12, TINTS ×8, BUILD_RANGE),
      rig row + swatches + two dials mutating the live preview entity,
      `previewLook`, `normalizeSheet` validate-or-fall-back for `rig`,
      lints 1–4. Budget: one extra `.glb` load in one spec.
- [ ] **M5 — Backgrounds + self-assessment.** `data/backgrounds.js` (eight
      zero-sum swaps), step 3, two points through `spendAttrPoint`, background
      gear into empty slots only, lints 5–8 (zero-sum `attrBonus`, known
      effect shapes, known talent keys, gear slot match).
- [ ] **M6 — Polish.** Read-back sentence, `New Character` in the game menu,
      pronouns read by narration lines.

## Phase 5 — Architecture / SOC

- [ ] **Unify the per-tile step rules** (gum/slip) into one module consumed by
      main.js members, combat.js AI units, and actors.js wanderers
      (`main.js:1777` / `combat.js:2834` / `actors.js:446`) — closes the
      Phase 2 gum bug's whole class.
- [ ] **Carve `combat.js`** at the documented seams, highest value first:
      enemy AI (already world-injected), pure geometry helpers (`coneTest`,
      `zoneCells`, `topplePlan`, slam damage, `opportunityStrike`), then verb
      resolvers, DOM panel, previews. Follow the `powers.js`/`tactics.js`
      precedent.
- [ ] **Carve `main.js`**: summons, hotbar view-model, dialogue/recruitment,
      step rules (above), debug surface — each on the `shopping.js`
      host-callback pattern. *M1/M3 of the creation plan start this.*
- [ ] Extract `EnemyActor`'s wander brain to a pure module (`actors.js:412`).
- [ ] **Collapse the two action bars into one.** The combat bar and the
      persistent hotbar are parallel implementations of the same widget,
      swapped by mode (`main.js:2538` hides `#hotbar` while `inCombat`, and
      `combat.js:1092 buildActionBar` builds its own). Duplicated: two builders
      with different id conventions (`#act-<id>` vs
      `#hotbar-act-<id>`/`#hotbar-item-<id>`, so e2e must know both); two
      affordability rule sites (combat's `refresh()` computes
      `active.ap >= a.ap && (!a.uses || …) && (!a.ammoCost || …)` inline,
      main.js's `slotVm` computes its own); two tooltip builders (`actionTip`
      vs the hotbar's); two arming states (`armed` vs `armedOoc`) with two
      ring-drawing paths; and two ordering rules (`actionIdsOf`/`scrambled` vs
      `layoutOf`/`defaultLayout`). The player-facing cost is the asymmetry: the
      hotbar's arranged layout, pager rows, item slots, right-click reassign
      and number-key shortcuts all vanish in combat — keys `1-9` are gated
      `!inCombat` (`main.js:2294`), so a fight has no keyboard shortcuts at
      all. `ui.js`'s own header names the seam: "combat.js and the editor
      import the palette too — they build their own DOM but must not look like
      a different game." *(Items being unusable in combat is deliberate —
      `looting.js:200` — so a unified bar should still grey item slots, not
      drop them.)*
- [ ] Port `routeBeside`'s "already standing on the goal tile" special case to
      the AI's `standTilePath` — the same fix written twice, once. *(Same code
      as the Phase 1 pacing bug; listed here as the duplication it is.)*
- [ ] *Checked, genuinely not duplication — leave alone:* `initiative.js` vs
      `turn-order.js` (the latter imports the former; "what is the order?" vs
      "whose turn is it?"), `shop.js` vs `shopping.js` (the pure/runtime split
      `looting.js` is supposed to copy), and `ui.js` vs `ui/` (a re-export
      barrel).
- [ ] **Content-is-data fixes**: `matches` → item `ignites` field
      (`main.js:715`); projectile/impact → action data fields
      (`combat.js:1296`, `:1323` — three id-special-cases since `e8e53de`);
      surface `impact` field to delete `hazardKind`/`surfaceImpactKind`
      (`combat.js:412`/`main.js:2368`); `paperCutImmune` →
      `statusImmune: ['bleed']` (`statuses.js:64`); exit beacon keyed on
      `onEnter.effect` (`scene.js:65`); harvest/icon/footprint fields on data
      entries (`looting.js:59`, `:309`, `fx.js:634`); item verbs from data,
      not `heal||ammo` sniffing in panels (`ui/panels.js:165`).
- [ ] Gate `god.js` behind a dev flag (hash/query/localStorage opt-in that
      does not ship claimed hotkeys) (`god.js:73`).
- [ ] Edge-aware `isFlanked` (`tactics.js:208`); decide surprise-vs-POSITION_CAP
      spec question and align code or TACTICS_PLAN (`tactics.js:263`).

## Phase 6 — Test infrastructure

- [ ] Finish combat's rng seam: route `rand`, `initRng`, and slip checks
      through the injected rng (`combat.js:23`), then add a seeded full
      roll→damage→status resolution test.
- [ ] Give `rollLoot` an rng parameter and port `shop.test.js`'s chance tests;
      lint the guaranteed-drop invariant (`data/items.js:321`).
- [ ] Named-error validation for unknown actor ids in `grid.parseLevel`
      (`grid.js:89`) + CLASSES/ENEMY_TYPES id-uniqueness lint
      (`main.js:2899`) + unplaced-enemy lint (`data/enemies.js:200`).
- [ ] Hoist the `window.pc` module-scope reads in `actors.js` (and the
      `tile-renderer` import chain under `looting.js`) behind injection seams
      so their pure logic imports under `node --test`; then unit-test the
      movement state machine and looting rules.
- [ ] Replace bare sleeps with state polls: `editor.spec.js:52`,
      `ranged.spec.js:100,119,165`.
- [ ] Missing coverage: stairwell revive of a downed companion; corrupted-stash
      boot falling back past a valid campaign save (`main.js:1852`, `:63-78`).

## Phase 7 — Docs & dead code

- [ ] ARCHITECTURE.md: AP cost, melee reach, module map (+`powers`,
      `portraits`, `actor-registries`), data-layer import exceptions, stale
      editor warning.
- [ ] MOVEMENT_PLAN.md ("No code yet" — all five milestones shipped),
      TACTICS_PLAN.md `#`-cells claim, `data/companions.js` kit comments.
- [ ] Remove dead code: `regional-executive` (or place it), `INV_CAP` Infinity
      branches, `applySurfaceOn`'s `sfx.ammo` branch, exit glow material,
      unused exports (`stats.normalizeAttr`/`nodeAvailable` — or make the
      level-up UI consume `nodeAvailable` instead of re-deriving it,
      `fx.FEET_Y`/`HEAD_Y`/`groundDecal`, `hover.HL`, `pathfinding.BODY_RADIUS`,
      `looting.INV_CAP`), `snack-machine` category.
