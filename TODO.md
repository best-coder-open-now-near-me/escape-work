# TODO — Escape Work

The combined worklist: every open finding from `REVIEW.md` (verified still
present against main @ `e8e53de`) plus the character-creation feature from
`CHARACTER_PLAN.md`, which now lives in this repo rather than on an unmerged
branch. Items reference REVIEW.md by `file:line` for full detail;
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

## E2e status in this environment (measured, with the method stated)

This environment's software GL is far slower than the CI the suite was tuned
for, and the dominant failure mode is the 120s per-test budget expiring rather
than anything misbehaving.

**The baseline is the headline: `e8e53de` fails 21 of 102 before any work on
this branch.** A full pass takes ~1.5-2h.

| run | failed | passed |
|---|---|---|
| baseline `e8e53de` | 21 | 81 |
| this branch | 28 | 78 |

**That table is contaminated and should not be quoted.** Both suites were run
CONCURRENTLY on one machine to save wall-clock, which is a mistake when the
thing being measured is timing: each took 2.0h instead of ~1.5h, and contention
manufactured failures on both sides.

Re-running the nine suspect spec files SOLO is the valid experiment: **31
passed, 6 failed**. So of twelve apparent regressions, six were pure contention
artifacts - `charm.spec`, `editor`, `equipment` ×2, `statuses`, `tactics`,
`throwing` all pass with nothing competing.

Of the six that survive, three are provably pre-existing (they appear in the
baseline's own failure list, one under its old name: `Mail Room: Bulk Mail`,
`Reboot self-cast` née `Remote Restart self-cast`, and the IT Support kit spec).

**The three suspects were investigated. They split three ways:**

- **`exit.spec.js:130` - not a regression, a stale test. FIXED.** It boots a
  PLAYTEST stash, seeds a campaign save, and asserted that winning wipes it -
  which is exactly the data-loss bug Phase 0 fixed. A level launched from the
  editor is standalone, and finishing one is not finishing a campaign run. The
  assertion is inverted now, with the reasoning in the test.
- **`classes.spec.js:108` (Security: Detain) - was a real regression. FIXED,
  by reverting its cause.** Bisected to the `enterCombat` fast path added in
  Phase 6. Detain is TOUCH-range, so it needs a walk-up; engaging by clicking
  walks the player adjacent, while `startFightNow` opened the fight from
  wherever they stood - leaving Detain permanently out of reach inside the
  spec's retry loop. Confirmed by disabling the fast path alone (46s, no
  timeout) and then by the full revert.
- **`powers.spec.js:123` (Stand Post) - same cause, also FIXED.** It was called
  flaky here on the evidence available at the time; it was not. The fast path
  was destabilising it as well, and it passes consistently once reverted.
- **The fast path is reverted and its hook removed.** It never delivered what
  it was for - the HR/IT timeouts were unchanged by it, because it only helps
  when somebody is already in range at boot - and it changed the geometry specs
  are written against. A note in `helpers.js` records this so it is not tried
  again. Walking is slow, but it is what the specs mean.

- [ ] The suite needs a longer per-test budget in environments like this one,
      or the timeouts will keep being mistaken for regressions. `test.slow()`
      per spec is the stopgap; a config-level budget keyed off an env var is the
      real fix.

### The red on main, fixed (2026-07-28)

Main's `Full E2E suite` job had been failing since the powers work landed, so
`deploy.yml` - which chains off the CI run on main - had been skipping. Three
failures, all in `powers.spec.js`, all the SAME failure:

    Test timeout of 120000ms exceeded.
       at helpers.js:258   <- settleOnPlayerTurn, inside enterCombat

Not flakes. Those specs boot IT Support and HR, the two classes with no attack
of their own, so entering a fight means WALKING a coworker down across the
shipped `level1` rather than opening on one. Under software GL that does not
fit in 120s: Performance Review measures at 3.1m end to end.

- **FIXED** with one file-level `test.slow()` in `powers.spec.js`. That is the
  right lever rather than a blunt `setTimeout`, because `engageBudgetMs()`
  derives the engage loop's budget as a FRACTION of `test.info().timeout` - so
  tripling the test budget gives the retry loop proportionally more room
  instead of more wall clock around a loop that already gave up. Stand Post's
  own `test.setTimeout(300_000)` came out with it: against a 360s file default
  it would have quietly CUT the budget it was written to raise.

- [ ] **Better fix, not taken yet: put these three on a bespoke arena.**
      `summons.spec.js` is the model - it boots small purpose-built arenas via
      `bootStash` ("straight to battle", open room) instead of walking the real
      office, which is why its HR tests are cheap and reliable. Doing the same
      to `powers.spec.js` would remove this whole failure class rather than
      paying for it, and cut ~7m off the suite. Left alone for now because the
      last change to `enterCombat`'s geometry broke Detain.

**A second defect, found trying to VERIFY that fix before it reached main.**
The workflow header advertised "put `[e2e]` in the commit message" to run the
suite on a branch. It could never fire: `push` is scoped to main, so a branch
push raises no event at all, and the only event a branch does raise -
`pull_request` - has no `github.event.head_commit`. The failure is silent: not
a skipped job, NO job. **FIXED** - the branch opt-in is the PR TITLE now, a
field that exists on the event a branch actually fires. Commit-message form
stays for main, where `head_commit` is real.

**A third, found by running the full suite locally where nothing caps the
failure count** - and this one is NOT on main's list, because main still has
the old reboot. This branch introduces it:

- **`classes.spec.js:8` (IT Support kit) - stale premise. FIXED.** It self-casts
  reboot on a freshly-booted character and asserts the AP was spent. Reboot is
  a pure purge now, and a purge aimed at a clean sheet is refused BEFORE the
  commit rather than billed for nothing (`powers.js` `emptyPayload`). Every
  click was a correct refusal - "Nothing to clear - they are running clean."
  (×4) - and the retry loop waited out 300s for AP that was never going to
  move. The test hands the verb real work first now, and asserts the status is
  actually gone, which its name always claimed and its assertions never checked.

**Coverage gap worth naming:** CI's `maxFailures: 3` aborted main's run with
**42 tests never executed on a real runner**. Fixing the three known failures
is not the same as knowing main goes green.

**Gap closed.** Run 30385657545 (branch, `c523ad3`) is the first time the whole
suite executed on a real runner: **101 passed, 1 failed, 4 flaky, 1.3h**. The
one failure is the `#hotbar-act-defend` assertion above, fixed in `57bf876`
which that run predates. The three original timeouts are gone - `powers.spec`
passes on CI hardware with the arena and no extended budget.

*(The suite is **106** tests - the table above already says so for this branch,
78 + 28. The "102" recorded here earlier is the **baseline** `e8e53de` count,
from before this branch added four; quoting the baseline's size for a branch run
is what made these totals stop adding up. Playwright also counts `flaky` as its
own bucket, so on CI `passed + failed` never totals the suite by itself.)*

*It is **109** now — `combat-bar.spec.js` added three (one bar in a fight, a
snack for 2 AP, a door for 1 AP). Verified locally at **17/17** on every spec
those changes touch: `combat-bar`, `throwing`, `movement`, `topple`, `hotbar`
and `classes`.*

*One warning for whoever runs this next, because it cost real time here:
**a contended box does not fail honestly.** `classes.spec` failed twice with
`enterCombat` timeouts and looked like a regression; the same tests pass in
1.4–1.7m on a quiet machine. The tell was elsewhere in the same runs — tests
taking 2.4m that take 55s idle, and the web server dying mid-run and turning
five specs into sub-second `ERR_CONNECTION_REFUSED` failures. Before believing
an `enterCombat` timeout here, check what the passing tests alongside it cost.*

**Main is green, and it ships again.** Run 30410302575 (`1d69e5a`, main):
**104 passed, 0 failed, 2 flaky, 1.3h**. Deploy run 30414380016 fired 8s behind
it and pushed to itch.io - the first successful deploy since run 115 on
2026-07-27, because `deploy.yml` chains off CI's conclusion and main's E2E had
been red since the powers work landed. Every merge in between was built and
then silently declined to ship.

- [x] **The four flakes from that run are FIXED** (`346eafc`, `44c4c28`) - all
      four passed clean on 30410302575:
      - `statuses.spec.js:156` a weapon on-hit proc - the red stapler flings gum
      - `tactics.spec.js:33` walking out of an enemy reach provokes a free swing
      - `tactics.spec.js:118` a partition gives the defender cover
      - `throwing.spec.js:89` a solid wall refuses the throw

- [ ] **Two DIFFERENT tests were flaky on 30410302575**, and `retries: 1` is
      what turned them green. Both causes are diagnosed and fixed here, but
      neither is *confirmed* gone - one green run has never been proof about a
      stochastic failure:
      - `party.spec.js:93` timed out (120s) waiting for the wounded member to
        drop. `pickTarget` (`combat.js:256`) attacks the NEAREST engageable
        member and lets HP break a tie only at EQUAL distance - so pinning slot
        0 to 1 HP and then waiting on slot 0 waits on where the two members
        happen to be standing. With the Intern closer, the Manager swings at
        the Intern forever. Fixed by wounding whoever the Manager is actually
        coming for, and by asserting the rule the test is named for (a member
        goes down, the fight continues) rather than a particular slot index.
      - `topple.spec.js:25` never entered combat - 7 engage attempts over 184s.
        `enterCombat` clicks the enemy at chest height, and this map exists to
        stand a TALL cabinet directly between player and Manager, so the engage
        click lands on the cabinet mesh. Fixed by engaging on ADJACENCY, which
        is what actually opens a fight (`checkCombatTrigger`, main.js), via a
        tile click that resolves by tile and so cannot be occluded.

      Both are geometry-and-timing shaped like the four before them, but
      neither shares the `onCanvas` cause guessed at above - and that guess is
      worth retiring. `topple` is 3D occlusion: the cabinet is ON the canvas
      and ON screen, so no screen-space guard can see the problem. `party` is
      not a click at all - it is an AI targeting rule the test never controlled.

- [ ] **The suite is 1.3h on CI.** The arena idiom is what brought `powers.spec`
      from 10.5m to 3.2m; the same treatment on the other `bootAndPick` specs is
      the obvious lever if that hour starts to hurt.

## Status

**All eight phases are done and pushed.** Unit tests: 455 passing, up from 385
at the branch point. Build clean.

**...but that line was wrong three times, and here is how.** It was true of the
work each phase COMMITTED and false of its section. Three items recorded on
28 Jul between 05:36 and 05:43 — doors in combat (`e0ae451`), the two action
bars (`aa504a7`) and consumables in combat (`0a4d78d`) — were appended to
sections whose phases then closed **without them**, 1.5 to 4.2 hours later, and
the phases were reported complete anyway. They were not lost over weeks; they
were skipped in the same session that wrote them down.

Three things let that happen, all fixed or flagged now:

- **The tracker was per-PHASE, not per-item.** "Phase 2" was one checkbox over
  a section that grew to ~10 entries; its commit did four and the phase ticked.
- **These boxes were never ticked.** 61 `[ ]` against 8 `[x]`, while this header
  claimed completion — so a delivered item and an unbuilt one looked identical,
  and the prose won. From here an item is done when its box is `[x]` **and it
  names what shipped**, as the three above now do.
- **Nothing tested any of them.** No spec opened a door in a fight or drank
  anything in one, so the whole CI/deploy effort could go green and say nothing.
  `combat-bar.spec.js` exists for exactly that reason.

### Audit of the unchecked boxes, against the source (29 Jul)

Every claim below was checked by reading the code, not by remembering. The
headline: the prose was broadly right — most of Phases 0–4 really did ship —
but **four real items were hiding among the unticked boxes**, and would have
gone on hiding.

**Verified DONE** (evidence in parentheses):

| Item | Evidence |
|---|---|
| P0 combat soft-lock | `handleEnemyClick` guards phase/moving/alive (`combat.js:2098`) |
| P0 playtest stash vs campaign save | separate try/catch per source (`main.js:71-93`) |
| P0 `xp`/`xpNext` backfill | v6 migration (`party.js:146-157`) |
| P0 companion `def` across floors | `companionId` + `COMPANIONS[…]` (`party.js:104`) |
| P0 closed-door deadlock | `canTakePart` LOS rule (`main.js:1002`) |
| P1 dash preview shape | documented `{ reach, tail }` (`combat.js:742`) |
| P1 `moveStart` cleared | `moveStart.delete(u)` (`combat.js:3156`) |
| P1 enemy AI pacing | `standTilePath` carries the `routeBeside` case (`combat.js:197`) |
| P2 gum double-slow | no `speed *=` anywhere in `src/` |
| P2 `reboot` purge-only, any target | `type: 'purge'` (`data/actions.js:187`) |
| P2 `remote-restart` retired | only a historical comment survives |
| P2 `paper-storm` `leavesTurns` | `6`, with the rationale (`data/actions.js:95`) |
| P2 friendly verbs reach teammates OOC | `aimsAtAlly` gate (`main.js:1181`) |
| P3 window-leave ends hover | `pointerleave` listener (`controls.js:91`) |
| P3 party-bar float AP | `fmtAp` (`ui/hud.js:351`) |
| P3 portraits face the lens | `rotY: 0` + why (`portraits.js:136`) |
| P3 corner repulsion is edge-aware | `pathfinding.js:55-58` |
| P4 creation | shipped, then reworked - see Phase 4 |

**Found genuinely open by this audit — and now FIXED:**

- [x] **`hover.clear()` never reset `hoverTarget`** (`hover.js`). `clear()` nulled
      `hoverKind` but left `hoverTarget` set, and `applyGlow()` re-lights from it
      the moment Ctrl/Alt goes down — so a body behind a panel, or one left over
      from before a fight, came back glowing. Clearing the *highlight* was never
      enough, because the next modifier press just drew it again. `clear()` now
      forgets what was under the cursor, not merely that something was.
- [x] **Floor-clear save write was unguarded** (`main.js`). Wrapped in try/catch
      like every other write (`god.js:66`). localStorage throws in private mode
      and on a full quota, and this one runs *mid floor transition* — a bare
      throw took the stairwell heal and the floor-clear screen with it, turning
      "your save did not persist" into "the game stopped".
- [x] **A failed `.glb` now leaves a marker** (`models.js`). `asset.ready` never
      fires on an error, so the prop was absent, `onReady` never ran, and the
      only trace was a console warning nobody reads mid-playtest — a missing
      asset was indistinguishable from a level that never placed the prop. Now
      a magenta box stands in, and the callback contract holds: whatever was
      going to happen to the model happens to the marker. The listener is
      per-call with a `settled` guard, so a placement can never draw both, and
      the editor's constant repainting cannot pile handlers on a shared asset.
- [x] **`drawTargets` rings props and doors** (`combat.js`). Props: the eight
      neighbours, through `topplePlan` — the same rule the click and the AI run,
      so a green ring is the same promise it is anywhere else. A shove that puts
      a cabinet on somebody is strictly the better move where it is available,
      and the affordance for it used to be "the player happened to try it".
      Doors: rung at the EDGE midpoint, before anything else and regardless of
      what is armed, because a door has no bar slot — gating it behind
      `previewAction` would hide the only affordance for the only terrain a
      fight can change. The AP cost rides along on the new `world.doorsBeside`
      seam rather than being re-declared in `combat.js`: one number, owned by
      the rule that charges it.

*Not re-verified:* the ranged walk-in ring item (P2) and the `god.js` trio (P3)
were not reached in this pass. They stay unchecked and unclaimed.

The five bugs reported from play - AI pacing, the burnt-paper desync, party-bar
float AP, backwards portraits, and the out-of-combat cone - were each fixed at
the root rather than the symptom.

**Charm shipped.** It was blocked on `turn-order` having no way to change a
slot's side (`insert` had no inverse); that is now `turns.replace`, which swaps
a slot in place keeping its initiative roll and its position in the round.
Charming the last hostile deliberately does NOT win the fight - counting a
borrowed coworker as gone made charm a 3 AP win button, strictly better than
killing anyone, and therefore the correct play every time.

**Two bugs were found while closing test gaps, not by looking for them:**

- A corrupt playtest stash silently discarded a valid campaign save. One
  try/catch covered both sources, so the stash throwing meant the save was never
  read - scratch space written by a tool could cost somebody their run.
- The `regional-executive` enemy type is placed on no floor and summoned by
  nothing. Authored ahead of its floor, so exempted by name rather than deleted.

**Two things were deliberately NOT built, each recorded where it belongs:**

- A `New Character` menu item. Declined on PLACEMENT:
  `showGameMenu` is persistent, so anything in it is offered mid-fight - the
  wrong moment to hand somebody a button that discards their character.
- `Restart run` keeping your character. Needs run state to separate from
  character state first; today the sheet lives inside the campaign save.

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
      saves can level again. *Same function as the save v8 drop — one
      migration test pass.*
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
      furniture instead of a person"). Since TACTICS_PLAN M8 there are two
      working precedents: `shove` (the topple) and the damage-rolling attack
      (`powers.aimsAtProps` + `breakPlanAt`, which is the first cut of the
      target-class idea — a predicate saying "may point at the furniture").
      So "reboot targets props" means the click path must consult the
      prop layer as well as the two body layers, which both precedents show
      the shape of. Decide what a purge even DOES to a prop before building
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
- [x] **DONE.** `useItem` no longer refuses on `isInCombat()`; a consumable
      costs **2 AP** out of the acting member's pool (`combat.spendAp`), the
      full-HP refusal is checked BEFORE the AP so a refused snack is a free one,
      and `getSheet` now resolves to the ACTING member in a fight - initiative
      decides who acts, so the snack comes out of their pockets and heals their
      sheet. Item slots on the combat bar came free with the bar unification
      below. The pockets panel's live Use button needed no change: the
      complaint was that the UI offered what the rules refused, and the rules
      were the wrong half. Covered by `combat-bar.spec.js`.
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
- [x] **DONE.** `toggleDoor` works in a fight for **1 AP** - cheaper than a
      verb, because the walk to reach it is already billed as movement and this
      is the handle, not the journey. The rule is adjacency, not auto-walk
      (`atDoor`): movement in a fight belongs to combat and is priced per tile,
      so there is no `approachAndDo` to lean on. The in-combat right-click menu
      offers the door with its cost on the label, which honours that menu's own
      stated rule (turn-spending verbs must show their AP) rather than breaking
      it - doors have no bar slot because they are terrain, not kit. Alt still
      lights the overlay in a fight, since that is how you SEE a door. New
      `__game.doorOpen(key)` seam: doors sit on EDGES, so `tileAt` could never
      answer it. Covered by `combat-bar.spec.js`.
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

## Phase 4 — Character creation (CHARACTER_PLAN.md)

**Done, and then undone and redone.** The six milestones this section used to
list were built (five of them; M6's menu item was declined) and this worklist
never checked a single box — it described the work as pending while the code
shipped. Worse, the design those milestones implemented was never asked for:
the plan they came from opened its decisions table with "recommended", meaning
every row was a proposal, and all eighteen were built as though settled.

What shipped was a single funnel — every start walked into a customization
screen offering a typed name, a colour palette, two build sliders, an eight-
entry background axis and a wardrobe of all twelve rigs, including the bosses'.
`CHARACTER_PLAN.md` now lives in this repo and records both the damage and the
rework. The rework is complete:

- [x] **The cast is our people.** The IT companion's rig and track overrides
      are gone (the track override was silently costing him two of IT Support's
      own actions); both companions are keyed by the class they are; the two
      hand-written "seniority variants" are deleted in favour of a placement
      naming its tier (`"G": "manager@3"`) through the one scaling curve; the
      HR enemy names the class it always was.
- [x] **Rigs match their files.** Human Resources onto `hrrep.glb`, Middle
      Manager onto `midmanager.glb` — finishing a policy the repo set the day
      `mailroom.glb` became `security.glb` and then dropped. Four rigs came free
      and became the custom wardrobe.
- [x] **One way to dress a body.** `previewClass` and `previewDraft` folded
      into `dressBody`, which is what M2 below promised and never did.
- [x] **Two front doors.** Six precut characters played as written, plus a
      blank card that makes one. Save v8 drops the creation look/background
      fields rather than migrating them.
- [x] **Back goes back.** Escape used to commit the character it claimed to
      cancel.

Still open, and genuinely optional:

- [ ] **A body that reads as mail room.** The Mail Room class wears `hr.glb`
      because the rig named for that job was deliberately given to Security for
      reading as a uniform, and no file is left for it. Needs art, not a
      rename — it is the one remaining place a filename lies.

- **Declined, still:** a `New Character` menu item. Making a new character
  belongs at the START, and `showGameMenu` is a persistent ☰ available all
  through a run - so anything placed in it is offered mid-fight, which is the
  wrong moment to hand somebody a button that discards the character they are
  playing. If it ever ships it belongs on the boot screen, alongside the desk.

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
- [x] **DONE.** One bar. `combat.js` no longer builds anything - it supplies
      the rules (`actionState` for affordability and the refusal reason,
      `actionTip` for the tooltip, `scrambleEntries` for the reorg status,
      `pressAction` for the press) and `main.js` owns the DOM, as it already
      did out of combat. `#act-<id>` is gone; `#hotbar-act-<id>` names a power
      in a fight or out of one. `armedOoc` and `armed` stay as two variables
      but one arming state reaches the bar. In a fight you now get the saved
      layout, the pager, item slots, right-click reassign and keys `1-9`.
      **Watch for:** the bar signals usability by `aria-disabled`, never the
      `disabled` property (a disabled button dispatches no events, so the slot
      you most want to reassign would be the one you cannot) - `toBeEnabled()`
      passes instantly against it, so `clickAction` waits on the attribute.
      Covered by `combat-bar.spec.js`.
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
