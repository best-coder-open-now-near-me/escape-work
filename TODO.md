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

## Phase 1 — High bugs

- [ ] Dash preview stores the wrong shape in `preview`, throwing every frame in
      `update()` (`combat.js:722`); also null-guard `showDashPreview(point,…)`
      (`combat.js:819`).
- [ ] Clear `moveStart` when a deliberate walk ends so dashes stop provoking
      opportunity attacks after any prior walk (`combat.js:1557`).

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
