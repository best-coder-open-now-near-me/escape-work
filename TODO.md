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
- [ ] **Power-laid paper is never harvestable** *(decided)*. Ammo comes from
      the world, not from a power — a paper-laying action must never be an
      AP→ammo converter. Expiry does **not** achieve this on its own:
      `harvestPaperPatch` only refuses `isInCombat()`, and the litter clock
      ticks one turn per `OOC_TURN_SECONDS = 1.6` (`main.js:164`), so Bulk
      Mail's `leavesTurns: 4` drift laid late in a fight is still on the floor
      for ~6.4s *after* the fight ends — exactly when harvesting becomes legal
      — and one click takes the whole connected patch at +1 sheet/tile. Paper
      Storm is the unbounded version (see below). Fix reuses machinery that
      already exists: `paperHarvestable` is
      `surfaceAt === 'paper' && !harvestedPaper.has(key)` (`looting.js:58`), so
      have `leaveSurface` mark each paper tile it paints straight into
      `harvestedPaper` — "already picked clean" at birth. Composes correctly
      with `forgetPaper`, which clears the mark when the tile reverts to bare
      floor, so a *world* drift laid there later is gatherable again. This is
      the invariant `main.js:389` and `main.js:2581` were both reaching for
      ("nor leave a renewable ammo pile behind it"), and it is load-bearing for
      any paper-upgrade system — upgrading only adds a step unless the raw
      supply is bounded by the world.
- [ ] **`reboot` ("Turn It Off And On Again") should only strip statuses**
      *(decided)* — it currently deals 4–7 damage when aimed at a coworker.
      Self-cast is already correct: `combat.js:2168` is a dedicated branch that
      spends AP, calls `clearStatuses`, and rolls no damage. The enemy cast
      falls through to `strike` → `performOn`, which rolls
      `rand(a.min, a.max)` (`combat.js:1318`) and purges only afterward
      (`:1328`). The registry authorises it — `type: 'attack'`, `min: 4`,
      `max: 7` — and the entry contradicts itself: `desc` describes the *self*
      cast ("Turn **yourself** off and on again"), `log` describes an *enemy*
      cast ("You power-cycle **their** whole workflow").
      **⚠ There is no safe data-only fix.** Deleting `min`/`max` while it stays
      `type: 'attack'` walks straight into the Phase 0 critical bug:
      `rand(undefined, undefined)` is `NaN` → `takeDamage(NaN)` → the target's
      hp becomes `NaN`, never `<= 0`, so it is permanently unkillable and the
      fight soft-locks. Do the Phase 0 guard first.
      Recommended shape: make `performOn` skip the damage roll and its FX
      entirely when an action declares no dice — "an attack with no `min`/`max`
      is a pure effect" — then `reboot` becomes a data change (drop the dice,
      fix `desc`/`log` to agree). That same rule also removes the damage half
      of the buff/mobility NaN bug, so the two fixes converge.
- [ ] **`reboot` must also target teammates** *(decided)* — cleansing an ally's
      bleed with it is currently impossible. Cause: ally targeting hangs off
      one binary predicate, `isFriendly = a.type === 'buff'` (`powers.js:71`),
      which feeds `aimsAtAlly` (`:174`), which is what makes main.js route a
      click on a teammate's body into `handleAllyClick` (`main.js:1984`). An
      `attack` never qualifies, so a click on a teammate with Reboot armed does
      nothing. **A verb that aims at either half of the board has no shape in
      the model** — that predicate, not the reboot entry, is the thing to
      change (e.g. a third state: friendly / hostile / any). Ships naturally
      with the pure-purge change above: once Reboot rolls no damage, there is
      no reason it cannot point at an ally.
      Note for triage: this is *not* currently a dead end for players —
      `remote-restart` (`type: 'buff'`, `purge: true`, `range: 5`, `uses: 2`)
      is in the same base IT Support kit and does cleanse allies today;
      verified `allyProblemFor` passes a real `statusCount` and `emptyPayload`
      admits a purge whenever the target carries statuses. So decide whether
      Reboot-targets-anyone makes `remote-restart` redundant, or whether the
      two stay split as touch-range vs remote (`range: 5`, rationed).
- [ ] **Retire `remote-restart`** *(decided — but it cannot be a straight
      delete).* Blocker: `tests/unit/levels.test.js:134-142` lints that a
      class's `primary` verb must appear in its kit ("a class whose primary is
      a verb it cannot perform is a promise on the résumé card and nowhere
      else"). IT Support declares `primary: 'buff'` and `remote-restart` is its
      **only** `buff` — `reboot` is `attack`, `energy-drink` is `heal` — so
      deleting it turns the unit suite red. Sequence it with the reboot rework
      instead: once Reboot is a pure any-target purge, IT's `primary` becomes
      whatever type that verb ends up as, and `remote-restart` drops out with
      the lint still green. Removal also touches `data/classes.js:211-214` (kit
      + the comment describing the two-verb split), two e2e tests
      (`powers.spec.js:42` is entirely about it; `:68` merely *uses* it to
      prove a general rule and can repoint at HR's `performance-review`, the
      other base-kit buff), and `POWERS_PLAN.md:155,378`. Note it was never
      invisible — it renders fine, it is just IT Support's kit only.
- [ ] *Idea, not scheduled:* "remote in and power-cycle a coworker" reads as a
      **charm/dominate** power, not a cleanse — closer to DOS2's Charmed or
      BG3's Dominate Person. Worth considering as IT's identity verb if
      `remote-restart` comes back in some form. Scope honestly: a charm needs
      the AI to treat a charmed unit as party-side for a duration, which
      `pickTarget`/`livingMembers` do not currently model — it is a real
      system, not a data entry.
- [ ] `paper-storm` needs `leavesTurns` (`data/actions.js:83`) — still a
      separate bug after the harvest rule above, because permanent drifts are a
      *terrain* problem in their own right (every cast repaints ~9 floor tiles
      with damage + bleed, forever). With no `leavesTurns`,
      `leaveSurface(…, a.leavesTurns || 0)` passes 0 and `main.js:1610` only
      registers a tile with the ager `if (turns > 0)`, so these drifts never
      enter `tempSurfaces` and both expiry clocks skip them entirely. Related
      dead constant: `PAPER_CAP = Infinity` (`stats.js:12`), like `INV_CAP` —
      wants a real number if paper becomes a real economy.
- [ ] `hover.clear()` must reset `hoverTarget` so Ctrl/Alt can't re-light a
      stale body (`hover.js:257`).
- [ ] Gate the party-bar level-up pip and character-sheet Level Up button on
      `!inCombat` (`main.js:1328`, `ui/hud.js:370`).
- [ ] **Burnt paper leaves the grid permanently wrong — visual gone, surface
      still recorded.** Root cause: `ignite` calls `hooks.hideSurfaceVisual`
      (`surfaces-runtime.js:60`) but never updates the grid, so `runtime`'s
      `burned` set only *masks* a `grid.typeAt` that still says `'paper'`
      forever. Verified through a full burn: fresh `paper`/`paper`/shown →
      ignited `paper`/`fire`/**hidden** → burnt out **`paper`**/`null`/hidden.
      Two sources of truth for "is there paper here", diverging for good.
      Consequences on a tile that looks bare: `canTakeSurface`
      (`typeAt === 'floor'`) is false forever, so no cone or zone can ever lay
      a surface there again; `flammable` reads the same stale base, so it can
      never burn again (this is the `burned`-never-invalidated bug, same root);
      and `scene.refreshTile` re-renders from `grid.typeAt`, so a nearby topple
      or explosion **redraws the paper visual on ash**. Temp drifts self-heal
      by luck — `ageTempSurfaces` later forces `setType(x, z, 'floor')` — so
      this bites *world-placed* drifts, which nothing ever cleans up. Fix: when
      fire consumes paper, set the tile to `'floor'` and drop the cell from
      `burned`, exactly as `stickGum` already does for a spent wad
      (`main.js:323` — `grid.setType(…, 'floor')` *and* `hideSurfaceVisual`
      together). One truth, and the re-laid-drift bug goes with it.
- [ ] Ranged-weapon target rings must match the click's new walk-in behavior
      (`combat.js:1035` vs `2020-2056`) — ring green when a walk-in shot is
      affordable, as melee does. *(New in `e8e53de`.)*
- [ ] **Let consumables be used in combat** — confirmed intended; the current
      refusal is a bug, not a design choice. `useItem` refuses outright while
      `isInCombat()` (`looting.js:200`) and every path routes through it (the
      pockets panel's `onUse`, and `useItemById` behind a hotbar press), which
      disables the entire consumable economy in the only place it matters: all
      eight items are heals (`half-sandwich` 3, `cold-coffee` 2, `energy-drink`
      4, `candy-bar` 3, `vending-crisps` 2, `stale-danish` 4, `mystery-flavor`
      6), and healing exists to survive fights. Note the gate carries no
      comment, unlike its two neighbours which state their reasons — `dropItem`
      ("a dropped stapler would silently change your damage bonus") and the
      equip gate — so it reads as copied alongside them rather than decided.
      Work: drop the `isInCombat()` line from `useItem`, give the use an AP
      cost (recommend reusing the shove's 2 AP for a first pass — everything
      else in a turn is billed, and a free full heal every round would be the
      strongest verb in the game), and surface item slots on the combat action
      bar so the hotbar's consumables are pressable in a fight. Leave
      `dropItem` and equipping gated — those two have stated reasons.
      Independently wrong today: the pockets panel opens in combat (`I` is
      gated only on `sheet && !gameOver`, `main.js:2292`) and renders a live
      **Use** button with no combat gate (`ui/panels.js:165`), so the UI offers
      an action the rules refuse.
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

- [ ] **Out of combat, only two verb shapes can be aimed at all.** `armedOoc`
      is consulted in exactly two places: `attackOrConfront` (`main.js:999`),
      which fires only when `a.type === 'attack' || a.type === 'shove'` and
      only at an enemy *body*, and the ground-click branch (`:2021`), which
      intercepts only `type === 'summon'`. Everything else silently falls
      through to walk/switch. Consequences the player sees:
      - **Cones draw nothing and can't be aimed** (Bulk Mail). The wedge
        preview lives in combat's `drawTargets` (`combat.js:975`) and only runs
        while a fight is live; out of combat nothing draws it. Aiming one at
        the floor — the natural way to aim a cone — hits the ground branch,
        which only handles summons, so **you just walk there**. Clicking an
        enemy body does work (it opens combat with the cone as the opening).
        Related: `oocTargetOk` prices a cone as *melee*, because `rangeOf` only
        reads a top-level `range` and a cone's lives at `cone.range`.
      - **Zones can't be placed** (Paper Storm) — same ground-click gap.
      - **Friendly powers can't be aimed at a teammate.** `dispatchHit`'s party
        branch (`main.js:1005`) runs help-up / talk / `switchLeader` with no
        `armedOoc` awareness at all, so a click on a teammate with a buff armed
        just switches to them. Combat has the equivalent gate
        (`combat?.armedIsFriendly`, `main.js:1984`); exploration never got one.
        This is why an ally's bleed can't be cleansed out of combat — and bleed
        is a *step*-clock status, so out of combat is exactly when you'd want
        to.
      Fix is one shape: give the out-of-combat click the same verb dispatch
      combat already has, rather than the two hard-coded special cases. Folds
      naturally into the two-action-bar unification (Phase 5).

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
- [ ] **Party bar shows raw float AP ("0.7999…").** Two independent defects.
      (1) Three AP spend sites subtract raw while ~12 others use `roundAp`:
      `combat.js:1305` (in `performOn` — every basic attack, throw and ranged
      shot), `:1997` and `:2170`. With `ap` at 2.8 after a partial move,
      `2.8 - 2` is `0.7999999999999998` in float64 and gets **stored**, so the
      value itself is wrong, not just its rendering. (2) The party bar has no
      formatter: `ui/hud.js:346` interpolates `combatInfo[i]?.ap` raw, while
      combat.js already has `fmtAp` (`:438`,
      `String(roundAp(v)).replace(/\.0$/, '')`) built for exactly this. Fix
      both — round at the three spend sites so the stored number is clean, and
      route the party bar through `fmtAp` so no future raw write can leak
      through a display again.
- [ ] **Portraits render the back of the head** (`portraits.js:136`).
      `faceToward` is `atan2(dx, dz)` (`actors.js:85`), so **yaw 0 faces +Z**,
      and the portrait camera sits at `(0, y + 0.05, +DIST)` — already on the
      model's front. `rotY: 180` then spins it to face −Z, directly away; the
      comment says "face the camera" but the value does the opposite. Should be
      `rotY: 0` (the picker's `rotY: 45` for the diagonal game camera is
      consistent with +Z-forward-at-0). Worth checking all twelve rigs after
      the fix — `fd67296` swapped several character types onto different Kenney
      source files, so confirm they share one baked orientation rather than
      assuming.
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
      a different game." Pairs with the Phase 2 consumables fix: the unified
      bar is where combat's item slots land.
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

> **The docs are not authoritative.** ARCHITECTURE.md and the `*_PLAN.md` files
> describe what someone believed at the time, and several are provably drifted
> (see below). Do not read design *intent* out of them or cite them to justify
> current behavior — ask. They are a rewrite target, not a source of truth.

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

## Phase 8 — Charm / Dominate (new feature)

IT Support's identity verb, replacing the retired `remote-restart`: take a
coworker off the board by making them yours for a few turns. DOS2's Charmed /
BG3's Dominate Person, office-flavoured ("remote in and power-cycle them").

**The load-bearing obstacle: there is no allegiance concept.** Sides are
inferred from object *shape* — `sameSide = !!watcher.sheet === !!mover.sheet`
(`combat.js:2768`). Party members and summons carry a `sheet`; enemies carry a
`def` and don't. Nothing is mutable, so nothing can change sides. Every item
below follows from fixing that one thing first.

- [ ] **`sideOf(unit)` — one explicit allegiance predicate.** Replace the
      `!!x.sheet` shape test with a real side, defaulting to today's answer so
      the change is behaviour-neutral before charm exists. This is the seam the
      whole feature hangs off, and it is worth landing on its own.
- [ ] **`charmed` status** in `data/statuses.js`: turn clock, duration, `fx`
      block (aura colour + landing burst), and a `resist` interaction with
      Composure like every other resistable status. Content, not code.
- [ ] **Victory must stop counting charmed units as hostile.** `!engaged.some(
      (e) => e.alive)` appears at **7 sites** (`combat.js:519, 1358, 1723,
      1928, 2003, 2198, 2942`). A charmed enemy is still `alive`, so a fight
      whose last hostile is charmed can never end — the same soft-lock shape as
      the closed-door deadlock. Collapse all seven into one `hostilesRemain()`
      helper *first*, then teach that one function about charm.
- [ ] **`pickTarget` must invert for a charmed unit** (`combat.js:140`) — it
      iterates `livingMembers()` unconditionally. A charmed unit needs to pick
      from its former side, which also means `canEngage`'s memo key
      (`combat.js:125`) has to include allegiance or it will cache pre-charm
      answers.
- [ ] **Unit-vs-unit attacks.** `aiAttack` → `unitStrikesMember(unit, target.
      member, atk)` (`combat.js:2566, 2577`) assumes attacker-has-def and
      defender-has-sheet. A charmed unit swinging at an enemy is
      unit-vs-unit, which that path cannot express. Precedent exists:
      `opportunityStrike` (`combat.js:2801`) already resolves both directions
      and is the shape to generalise toward.
- [ ] **Reaction sides**: `watchTriggers`' `sameSide` (`powers.js:149`) and
      `provokedBy` both need the new predicate, or a charmed ally will provoke
      your own overwatch and vice versa.
- [ ] **Targeting + UI**: `enemyAtPoint`/`allyAtPoint`, `friendlies()`
      (`combat.js:1739`), the ring colours in `drawTargets`, the hover focus
      banner, and the initiative strip all read sides. A charmed unit must
      *look* like yours or every affordance lies about what a click will do.
- [ ] **Expiry**: reverting mid-fight, and specifically expiry landing during
      the charmed unit's own turn (the turn engine is mid-slot). Also decide
      whether damage from your side breaks it early, as DOS2's Charmed does.
- [ ] **Edges to pin with tests**: charm the last living hostile (fight ends?
      or waits for expiry?); charm a unit that is itself a summon; charm
      interacting with `engaged` and the summon cap; charm on a unit holding
      overwatch.
