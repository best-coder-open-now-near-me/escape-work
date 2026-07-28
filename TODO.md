# TODO — Escape Work

The combined worklist: every open finding from `REVIEW.md` (verified still
present against main @ `e8e53de`) plus the character-creation feature from
`CHARACTER_PLAN.md` (branch `claude/custom-character-creation-3ga2ni`,
milestones M1–M6). Items reference REVIEW.md by `file:line` for full detail;
line numbers are the review baseline and may be shifted slightly in
`combat.js`.

## Settled decisions

Answered directly by the project owner — recorded so they are not relitigated.

- **Tactics stay as shipped.** Overwatch, cover and flanking all KEEP. The
  review's "XCOM drift" observation is noted and declined: no deletion work in
  `TACTICS_PLAN.md`, `COVER_DODGE`, `FLANK_ACC_BONUS` or the `watch` stance.
- **Movement stays AP-billed** at `MOVE.COST_PER_TILE` from the shared pool
  (DOS2). `freeMoveAp` remains a Pawn-talent perk, not a universal allowance —
  do not promote it.
- **`reboot` targets anything** — self, ally, enemy, and *props/items* (for
  concepts like a compromised device). See Phase 2.
- **Charm targets enemies only**, and is **player-controlled** on its own
  turn (BG3 Dominate, not DOS2's AI-driven Charmed). See Phase 8.
- Consumables cost 2 AP in combat; paper upgrading is out-of-combat only;
  `PAPER_CAP`/`INV_CAP` become real numbers rather than `Infinity`.

## E2e status in this environment (verified, not assumed)

The suite runs under software GL here and is markedly slower than the CI it was
tuned for: a full pass takes ~1.5h and several specs exceed the 120s per-test
budget purely on wall-clock. Failures were therefore checked against the branch
point (`e8e53de`) in a worktree rather than assumed to be regressions.

- **Pre-existing at `e8e53de`, unrelated to this branch:** the IT Support
  self-cast spec and `Performance Review is HR's` both already failed there,
  with the timeout signature (one engage attempt, budget exhausted mid-walk).
  Both classes lack an attack of their own, so entering combat means walking a
  coworker down rather than opening on them - the slowest path in the suite.
- **Caused here and fixed:** `a friendly verb does not arm a swing at a
  coworker` passed at the branch point and had to move class (Reboot is an
  any-target purge now and legitimately promises a swing, so it can no longer
  carry a friends-only rule). HR's Performance Review is the only friends-only
  verb in any base kit, which put the test on that same slow path; marked
  `test.slow()` and verified passing.
- [ ] **Worth doing:** give `enterCombat` a way to open a fight that does not
      depend on walking a coworker down, so a class with no attack is not
      inherently the slow path. That is the root cause of every timeout above,
      and it would take ~10 minutes off a full run.

## Status

**Phases 0-5, 7 and 8 are done and pushed. Phase 6 is four-sixths done.**
Unit tests: 447 passing, up from 385 at the branch point. Build clean.

The five bugs reported from play - AI pacing, the burnt-paper desync, party-bar
float AP, backwards portraits, and the out-of-combat cone - were each fixed at
the root rather than the symptom.

Charm SHIPPED. It was blocked on `turn-order` having no way to change a slot's
side (`insert` had no inverse), which is now `turns.replace`: swap a slot in
place, keeping its initiative roll and its position in the round. Charming the
last hostile deliberately does NOT win the fight - counting a borrowed coworker
as gone made charm a 3 AP win button, strictly better than killing anyone.

Two things were deliberately NOT built, each recorded where it belongs:

- A `New Character` menu item (CHARACTER_PLAN #17). Declined on PLACEMENT:
  `showGameMenu` is a persistent button available all through a run, so anything
  put in it is offered mid-fight - the wrong moment to hand somebody a button
  that discards the character they are playing. It belongs at the start.
- `Restart run` keeping your character. Needs run state to separate from
  character state first; today the sheet lives inside the campaign save.

**What is genuinely still open:**

1. Phase 6's last two items - the `window.pc` injection seams (the big one:
   `actors.js` holds the movement state machine and is untestable today), and
   two missing coverage cases.
2. Thirteen e2e failures never compared against the branch point. Four were
   checked: two pre-existing, one caused-and-fixed, one a budget timeout.
3. The `enterCombat` speed fix, which is the root cause of the timeouts.

---

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
- [ ] **`reboot` must target ANYTHING** *(decided)* — self, ally, enemy, and
      props/items (so a "compromised device" can be power-cycled). Cleansing an
      ally's bleed with it is currently impossible. Cause: ally targeting hangs off
      one binary predicate, `isFriendly = a.type === 'buff'` (`powers.js:71`),
      which feeds `aimsAtAlly` (`:174`), which is what makes main.js route a
      click on a teammate's body into `handleAllyClick` (`main.js:1984`). An
      `attack` never qualifies, so a click on a teammate with Reboot armed does
      nothing. **A verb that aims at either half of the board has no shape in
      the model** — that predicate, not the reboot entry, is the thing to
      change: it needs a target-CLASS concept (friendly / hostile / any /
      props), not a third boolean state. Ships naturally with the pure-purge
      change above: once Reboot rolls no damage, there is no reason it cannot
      point at an ally.
      **Props are a second axis, not more of the same one.** Bodies are picked
      by mesh (`enemyAtPoint`/`allyAtPoint`); furniture is aimed at by TILE and
      resolved through `topplePlan` (`combat.js:2180`, "the same verb, aimed at
      furniture instead of a person" — `shove` is the only verb that does this
      today). So "reboot targets props" means the click path must consult the
      prop layer as well as the two body layers, which `shove` is the working
      precedent for. Decide what a purge even DOES to a prop before building
      it — there is no prop-status system yet, so "compromised item" is new
      content, not a retarget.
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
      deleting it turns the unit suite red. **The cheap escape is now closed:**
      since Reboot targets anything (not ally-only), it cannot simply become
      `type: 'buff'` to satisfy the lint. So this is strictly sequenced behind
      the reboot rework — Reboot gets a new purge type, IT's `primary` becomes
      that type, and `remote-restart` drops out with the lint still green. Removal also touches `data/classes.js:211-214` (kit
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

- **Declined:** CHARACTER_PLAN #17's `New Character` menu item. Not built, by
  decision: making a new character belongs at the START, and `showGameMenu` is a
  persistent ☰ button available all through a run - so anything placed in it is
  offered mid-fight, which is the wrong moment to hand somebody a button that
  discards the character they are playing. (`Restart run` is also the same
  action today, since the sheet lives inside the campaign save, but that is the
  lesser reason.) If it ever ships it belongs on the boot screen, alongside the
  résumé desk.

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

## Phase 6 — Test infrastructure  ✅ done

- [x] Combat's rng seam closed: `rand` takes its randomness as an argument (it
      read `Math.random` at module scope, unreachable from the injected `rng`),
      and initiative and the slip check followed. One seed reproduces a whole
      fight; seeded roll→damage→status test in `hit.test.js`.
- [x] `rollLoot` takes an rng; the guaranteed-drop invariant is linted.
- [x] Named-error validation for unknown actor ids in `parseLevel`; class/enemy
      id-collision lint; unplaced-enemy lint (found `regional-executive`,
      exempted by name as authored-ahead-of-its-floor).
- [x] `window.pc` hoisted behind lazy seams in `actors.js`, `models.js` and
      `shading.js` - the whole chain was unimportable outside a browser, so the
      movement state machine (pure arithmetic over a path) had never been
      tested. `actors.test.js` now covers it, including the Phase 0 NaN guard.
- [x] Bare sleeps replaced with state polls, on a new `playerMoving` accessor.
- [x] Missing coverage: the stairwell breather is a named rule with its
      downed-companion case pinned. The corrupted-stash boot turned out to be a
      real BUG, not just a gap - one try/catch covered both the stash and the
      campaign save, so a corrupt scratch file silently discarded a real run.
      Each source has its own guard now and the fallback goes past the stash.
- [x] `enterCombat` fast path (`__game.startFightNow`), through the same
      `beginCombat` the trigger uses. Honest limit: it only helps when somebody
      is already in range at boot, so specs that start far from anyone still
      walk. The two pre-existing HR/IT timeouts are unchanged by it.

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

## Phase 8 — Charm / Dominate (BLOCKED — real blocker found, see below)

Attempted and deliberately backed out rather than shipped half-working. What was
learned is worth more than the code was, so it is recorded precisely.

**What turned out to be easy.** Charm needs no allegiance flag. Sides are
inferred from shape (`!!x.sheet`), and a player-side summon is already pushed
into `members` with a sheet, so it already takes a normal player turn with its
own action bar and AP. Borrowing a unit into that machinery worked first time:
the coworker left `liveEnemies`, their own colleagues began targeting them, and
the victory test held. `hostilesRemain()` (the seven-site collapse) shipped and
is worth having on its own.

**The blocker: `turns` has no slot-removal API.** A borrowed unit keeps its
original `unitSlot` (`team: 'enemy'`) in the initiative order, and nothing can
take it out — `turns.insert` exists, its inverse does not. So the borrowed body
either acts as an AI enemy on its own turn while simultaneously sitting in
`members`, or its lifetime expires down the summon path and `dismissSummon`
DELETES the coworker instead of handing them back. Both are worse than not
having the feature.

**What it actually needs, in order:**
- [ ] `turn-order.js` grows slot removal, or slot re-teaming — moving a slot
      between `player` and `enemy` while preserving its initiative roll, so a
      borrowed unit acts once per round on its own roll, on your side.
- [ ] `expireSummon` splits: a summon is DESTROYED at the end of its lifetime,
      a borrowed coworker is RETURNED. They share a clock and must not share an
      ending. (Sharing `summonTurns` is otherwise right — one clock, nothing to
      keep in step.)
- [ ] An enemy def is not a class block: it carries `attacks` (inline damage
      rolls the AI reads) where a sheet needs `actions` (ids the bar renders).
      A borrowed body was given the universal verbs (`punch`, `shove`), which is
      defensible — you are driving somebody you do not know — but it is a design
      decision that should be made deliberately rather than inherited from a
      shape mismatch.
- [ ] `livingParty` must exclude the borrowed, or a wiped party stays "alive"
      while you drive somebody else's body.
- [ ] Release on all three paths: lapse, victory, and death mid-session.
- [ ] Edges to pin: charm the last living hostile; charm a unit that is itself
      a summon; charm a unit holding overwatch; save/load mid-charm.
