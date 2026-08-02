# Project Review — Escape Work

## Full-project review — 2026-08-02

Baseline: `claude/ai-difficulty-upgrade-plan-ajzgyb` @ `a3954b5` (main + AI_PLAN
milestones 1–6). Measured on this branch before anything was written down:
**`npm test` 711/711 green, `npm run build` clean, e2e `smoke.spec.js` 6/6 green**
— including "a fight opens and the combat panel takes over", which is the one
smoke case that exercises the new AI end to end. The branch works. Everything
below is found *inside* a working game.

### Questions for the designer

Four, and only four — the rest of this document is engineering, not intent.
Each names the question it stands in for and what changes if the answer differs.

**Q1 — Does a FORCED landing honour a character's personal hazard immunities?**
The AI's new shove and pull bill a member raw surface damage through the *enemy*
hazard model (`world.enemySurfDamage` → `rawSurfDamage`), which consults no
talents. The same member walking onto the same tile under their own power goes
through `effectiveSurfDamage`, which honours `shockImmune` / `paperCutImmune` /
`surfaceDamageResist`. AI_PLAN M6 records this as a known approximation; it is
now live in two beats. My recommendation is **A**.

- **A (recommended): forced landings honour immunities.** One new facade entry
  (`memberSurfDamage(sheet, x, z)`) wired to `effectiveSurfDamage`, used by every
  forced-landing path. "The same tile means the same thing however you got there"
  is the rule the walking model already states.
- **B: forced landings deliberately bypass them** — being thrown onto a live
  cable is not the same as stepping onto it. Cheaper (zero code), but then the
  ESD Steel-Toes stop working at exactly the moment they are most wanted, and
  that needs saying in the item's own text.

What changes: under A, `EQUIPMENT`'s immunity effects become two-sided and the
shove finding below is a one-line fix. Under B, the shove findings stay as
written but three doc sites need correcting.

**Q2 — Should a coworker's step-clock statuses ever tick?**
`tickStep` has exactly two callers, both party-side (`main.js:2964`, `:3010`).
No enemy path ticks it — not the AI walk hook, not the wanderer. `combat.js:4489`
says so outright: "an AI unit's gum is for keeps". ARCHITECTURE.md says the
opposite: "the step clock ticks per tile walked, wherever you are". My
recommendation is **A**.

- **A (recommended): give the enemy walk the same tick the member walk has.**
  Makes the documented rule true, and makes `bleed` — the only other `clock: 'step'`
  status — usable on a coworker at all. Today a bleed applied to an enemy would
  deal zero damage forever, silently, because nothing will ever tick it.
- **B: enemy step statuses are deliberately fight-permanent.** Gum-for-keeps is
  characterful and costs nothing to keep. Then ARCHITECTURE's claim needs
  narrowing, and `bleed` must be documented as party-side-only before any power
  aims it at an enemy.

**Q3 — Which verbs are two-sided?**
`handleEnemyClick`'s melee fall-through admits any verb that "carries a payload"
(`a.purge || a.applies || Number.isFinite(a.amount)`). That predicate answers
"does this verb have something to deliver", not "does this verb point at this
half of the board" — so Performance Review, Onboarding and Triage all resolve on
a coworker (bug §1.3). The narrow fix is a side test, but the side test needs a
list, and TODO.md already settled that **`reboot` targets anything** — self, ally,
enemy, props. My recommendation is **A**.

- **A (recommended): a per-action `side` field** (`'enemy' | 'ally' | 'any'`),
  defaulting from `type`, read by the click, the rings and the hover alike.
  Content stays data; `reboot` declares `'any'` and keeps its settled behaviour.
- **B: hardcode the three HR verbs as ally-only in the click.** One line, and the
  next friendly verb re-opens the bug.

**Q4 — Is the AI's shove the same verb as the player's?**
`aiShoveMember` is a hand-written parallel of `displaceBody` and has already lost
two of its three slam consequences: the `stunned` status and the topple of a prop
the victim is slammed into. Its own comment claims parity. Decision #11's
symmetry is the standing doctrine, which points at **A**.

- **A (recommended): one resolver, both sides** — give `displaceBody` a
  member-shaped victim path and delete the copy.
- **B: the AI's shove is deliberately cheaper** (flat damage, no cascade — which
  is what AI_PLAN M4 tagged `[proposed]`). Then it should stop claiming parity in
  its comment, and the asymmetry belongs in TACTICS_PLAN as a decision.

### How this pass was run, and what "verified" means here

Fourteen reviewers swept the repo along fixed axes — the new AI code, `combat.js`,
`main.js`, pure geometry, statuses/surfaces, stats/party/powers, UI,
rendering/input, persistence/tools, data+levels, the test suite, duplication,
SOC/god-methods, docs-vs-code — each required to quote real code at real lines and
to check every claim against REVIEW.md and TODO.md before reporting it. **222
findings**: 171 new, **51 already recorded** here or in TODO.md.

Honest notes on the method, because the numbers mean less without them:

- **99 of the 222 findings carry a second reviewer's verdict** — one briefed to
  refute, not to agree. Result: 92 confirmed, 5 plausible-but-unproven,
  **2 refuted**. The remainder carry their finder's own trace.
- **The verification pass pruned the biggest claim in the pass.** It killed the
  only finding tagged *critical*: the charmed-coworker soft-lock is **not** a
  soft-lock (see §6). Its mechanism was right and its conclusion wrong — the
  failure mode a confirm-everything pass ships without noticing. **There are now
  no critical findings.**
- **Every finding named individually in §1 was additionally re-traced by hand**,
  independently of the fleet. Five were reproduced by *executing* code rather
  than reading it — §1.1, §1.2, §1.5, §1.7 and §1.12 — and are marked
  **[reproduced]**. That matters most for the items whose verify batch had not
  returned when this was written.
- **A 2% refutation rate is a weak signal, not a strong one.** It says the
  finders were careful; it does not prove the verifiers were adversarial enough.
  Treat a `[traced]` medium or low here as a lead worth checking, not a fact.
- **Three findings are recorded as unreachable-today** (§5.6–§5.8) rather than
  promoted to bugs. Each is a missing guard whose path is closed by something
  elsewhere, and each says what closes it. They are here because the guard is
  missing, not because the game is broken.
- 51 findings restate open items from the previous pass. They are listed in §6
  by name only, not re-argued.

---

### Executive summary

The architecture holds up where it was carved and frays where it was not. The AI
work is the clearest case in the repo of both halves at once: `combat-ai.js` and
`combat-plans.js` are pure, small, and genuinely well tested (23 new unit tests),
while **every `perform` half of every new beat landed inside `startCombat`'s
closure**, where nothing can reach it. Both bugs that shipped and were fixed on
this branch were in that layer, and neither landed with a regression test.

Three things concentrate the risk:

1. **A readiness check with a side effect.** `resolveSummon` *spawns*, and the
   new `support` beat now outranks the beat that pays for it — so HR fields two
   free reinforcements (§1.1). This is a regression introduced by M6, and it is
   the single most consequential finding in this pass.
2. **Verb classification is now spread across five hand-written `a.type`
   ladders.** `verbKind` was made the one owner and has two consumers; the
   others have already drifted, and one of them (`ringsAtBodies`) silently omits
   `pull` — so arming Pull Over draws no affordance at all (§1.7).
3. **Duplication is the dominant maintenance defect, not god methods.** 30 new
   duplication findings, of which the expensive ones are not stylistic: the AI's
   shove, pull and break are each a *second copy* of the player's resolver, and
   each has already lost a rule the original applies.

The god closures are still the reason most of this is invisible: `startCombat` is
5,065 lines / 176 inner functions / 21 shared mutable variables and **grew 493
lines on this branch**; `startGame` is 4,214 / 159 / 26.

---

### 1. New confirmed bugs

#### Critical / High

**1.1 `combat.js:4632` — HR's reinforcements spawn for free. [reproduced]**
`resolveSummon` is not a predicate: it calls `world.spawnSummon`, pushes the new
units into `engaged`, applies `surprised`, plays the toner burst and inserts
initiative slots (`combat.js:4031-4050`). It is called as one:

```js
const summonReady = !!sm && (unit.summonCd || 0) <= 0 && acting.ap >= sm.ap
  && resolveSummon(unit, 'enemy', sm) > 0;          // combat.js:4632
```

Asking whether HR *could* summon posts the employees. On main this was survivable
— `summon` was the top ladder arm, so the beat that followed always paid for it.
**AI M6 inserted `support` above `summon`** (`combat-ai.js:391-392`). Now, when HR
has a wounded colleague to patch: the two employees spawn, `chooseBeat` returns
`support`, the *heal* is billed, and `unit.summonCd` is never set. Two units, no
AP, no cooldown.

Fix: split the question from the act — a `canSummon(unit, sm)` twin that computes
`(d.cap ?? d.count) - liveSummonsOf(summoner) > 0` and nothing else.

**1.2 `stats.js:806` — equip/unequip is a free, unlimited heal. [reproduced]**
`equipItem` credits the max-HP delta to current HP (`creditNewHp`, `stats.js:693`);
`unequipItem` only *clamps* down. The wound is therefore repaid on every cycle.
Run against the shipped `okayest-mug` (trinket, `stats: { maxHp: 2 }`):

```
start 5/22 → cycle 1: 7/22 → cycle 2: 9/22 → cycle 3: 11/22 → … → cycle 6: 17/22
```

Out of combat, unlimited, on any character carrying the mug. Fix: make unequip the
inverse — capture `maxHpBefore` and debit the same delta, floored at 1.

**1.3 `combat.js:3369` — friendly verbs resolve on a coworker.**
The melee fall-through's guard asks the wrong question:

```js
const carries = a.purge || a.applies || Number.isFinite(a.amount);
```

Three friendly verbs qualify: `performance-review` (`applies: 'commended'`),
`onboarding` (`applies: 'onboarded'`, `amount: 3`) and `triage` (`amount: 10`).
Arm one, click an enemy body, and the click walks you into melee, spends the AP
*and* the use, rolls to hit, and delivers the buff — or the 10-point heal — to the
enemy. Human Resources' entire base kit is two of these. See **Q3**.

**1.4 `combat.js:4257` — your own charmed ally opportunity-attacks you.**
Commit `b224733` replaced `engaged` with `aiAllies()` in `aiAdvance` and
`aiSupportPlan`, but `threatsAgainst` still derives the threatening side from raw
`engaged` — which keeps a charmed coworker deliberately. Walk out of your own
charmed Guard's reach and he takes the free swing. The same one-line substitution
the other two sites got. (The `attackMods` pincer list at `combat.js:476` has the
identical defect: a charmed coworker completes the *enemy's* flank.)

**1.5 `combat.js:2591` — every enemy Grit save uses the fallback. [reproduced]**
Both AI-side Grit saves read `en.def.grit`. No registry entry defines it — the two
class-backed enemies carry it as `attr.grit`:

```
enemy manager        grit=undefined  attr=undefined
enemy executive      grit=undefined  attr=undefined
enemy hr             grit=undefined  attr={"grit":5,…}
enemy security-guard grit=undefined  attr={"grit":7,…}
```

So `gritSaveChance(2)` = 0.37 runs 100% of the time. The Security Guard's Grit 7
would be 0.67 — he fails the Pull Over save 63% of the time instead of 33%. The
data exists and is being read through the wrong path.

**1.6 `combat-ai.js:157` — a blocked shooter burns every turn.**
`firingTileRoutes` short-circuits to the degenerate self-route the moment the
shooter's own tile is in range with LOS — an *absolute* priority borrowed from the
melee field, where it is the pacing-bug fix. It does not transfer: a shot refused
for a reason that is not range or LOS (an object shield, or a colleague in the
redirect) leaves the Executive with no beat. `canShoot` is false, `advance`
returns the self-route and spends nothing, and the ladder falls to crouch/pass —
every turn, until something else moves. AI_PLAN M5 claims the shooter "repositions
by LOS/shield/keep-away and re-plans next turn"; the short-circuit means it cannot.

**1.7 `combat-targeting.js:89` — arming Pull Over draws no affordance at all. [reproduced]**
`drawTargets` gates every body-level ring on `ringsAtBodies(a)`, a hand-written
`a.type` ladder listing attack/shove/control/purge — **not `pull`**. `verbKind`,
the module's own declared "ONE answer to which branch this verb takes", *does*
have a `pull` arm, and so does `enemyRingOk`; neither is reachable, because
`drawTargets` returns first (`combat.js:1553`). No ring, no reach circle, no
promise — on the one verb whose whole geometry is "be on the far side". Two
live-looking branches are dead. This is exactly the drift TODO.md Phase 5 says to
watch for, and it has already happened.

**1.8 `combat.js:3514` — a refused click costs you your cover for free.**
`breakCrouch(active)` is the *first* statement in `walkActive`, which then returns
null — nothing walked, no AP spent, caller prints a refusal — whenever the
truncated route is degenerate. The hover twin `previewWalk` deliberately does not
break the crouch, so the same arithmetic is safe to look at and destructive to
click. Move the break below the `points.length < 2 || cost < 0.05` guard, next to
`beginMove`, which is what the comment above it already claims it does.

**1.9 `combat.js:2280` — the stun FX fires when the stun was blocked.**
`dropOnto` writes the rule twice. The enemy branch gates `statusFxAt` on
`applyStatus` returning true and narrates the refusal via `immunityLine`; the
member branch calls both unconditionally and never consults `blockedBy`. Inside a
`training-credit` window the second stun is refused, and the game plays the stun
burst and says nothing. `aiPullMember`, added on this branch, copied the member
half verbatim — so the new beat inherited the defect.

**1.10 `main.js:3063` — the crosshair promises a swing the click turns into a shuffle.**
The combat *click* resolves the acting actor's own tile before consulting
`picking.pick`; the combat *hover* consults the pick first and lets a body win
unconditionally. An adjacent coworker's tall mesh covers pixels whose ground point
rounds back onto your own tile, so the hover lights the crosshair, the red glow
and the to-hit readout — and the click walks you nowhere. Mirror the click's
precedence in the hover.

**1.11 `main.js:252` — setting a cloud save key destroys the run it points at.**
The save key is documented as "how a run follows its owner across machines", but
setting one never pulls. Local always wins, so the desk offers the *local*
Continue, the cloud row under the new identity is never read, and the next floor
clear upserts over it. Either order of operations loses the other machine's run.

**1.12 `editor.js:301` — char allocations leak across `loadLevel`. [reproduced]**
`tileByChar`/`charByType` are allocated once per session and never reset;
`tierChars` is rebuilt per load, and a tiered placement's char is reserved *after*
a tile type may already own it. Paint with the `ficus` brush (char `G`), then load
`level2` (which declares `"G": "manager@3"`), and the ficus brush paints a tier-3
Manager. The reservation at `editor.js:70-73` that exists to prevent exactly this
does nothing.

**1.13 `main.js:161` — `clearProgress()` is the last unguarded localStorage write.**
Every other touch in the codebase is wrapped; this one runs after `gameOver = true`
and before the lose screen, and again inside the Restart-run action. In a
storage-blocked browser (which boots fine, because the *boot* read is guarded) the
throw eats the lose screen and the restart escape with it.

**1.14 `floors.js:147` — sneaking on a layered level throws.**
`layeredGrid`'s forwarded `METHODS` list omits `sightOpenCellLow` and
`sightOpenLow`, which the sneak cone sweep calls. The facade test
(`floors.test.js:97`) exercises 3 of 21 forwarded members, so the omission is
unpinned — the same class of contract gap as the `occupied` bug this branch
already fixed once.

#### Medium — a representative selection

- **`combat.js:2645` `aiPullMember` drops the hazard-landing damage** `performPull`
  applies, so an AI pull into live water or fire costs the member nothing.
- **`pathfinding.js:394` `roundBends`' arc-rejection fallback emits a leg it has
  just proved illegal**, so a smoothed walk crosses a partition. The unit test
  (`pathfinding.test.js:283`) asserts only that the rounded *vertices* are legal,
  never the legs between them — which is the property the function actually breaks.
- **`main.js:1870` `switchLeader` never releases the out-of-combat crouch**, so
  `covered` is removed from the wrong sheet and the real croucher stays crouched
  forever; the same handoff also leaves `sneak` on the old leader, making them
  permanently undetectable *and* unable to trigger combat.
- **`main.js:2857` a surface's turn-clock status is still gated on `inCombat`** —
  fire only sets you alight in a fight. The gate outlived the reason for it: the
  world clock now ticks those statuses (this repo's own 2026-07-31 fix).
- **`combat.js:4473` AI units take a surface's damage but never its status** — an
  enemy walked through fire never burns.
- **`data/talents.js:146` `corner-office-traction` does literally nothing**; its
  only effect (`moveCost: 0.9`) is read by no code.
- **`main.js:1007` a printer explosion damages party members but never player-team
  summons** standing beside it.
- **`combat-geometry.js:150` `hasSwingSpot` scans only the 8 neighbours**, so a
  long-reach weapon (the Guard's 2.1) is told it has no melee option.
- **`floors.js:170` `planCrossLayerRoute` only moves monotonically** toward the
  destination storey, so a ground→mezzanine→ground route around a sealing wall is
  refused. *Reproduced on a synthetic two-storey fixture; downgraded to low
  because no shipped floor has the topology that needs it — `spike-lobby` is the
  only layered level and its storeys are not sealed this way.*
- **`dialogue.js:20` `nodeOptions` can filter a node to zero options**, and the
  dialogue panel has no other way out.
- **`tile-renderer.js:238,367` upper-storey paper and foliage render on the ground
  floor** — both drop the storey `baseY`; foliage also parents to `app.root`, so it
  never hides with its storey.
- **`picking.js:91` ignores storey visibility**, so a cutaway-hidden floor eats
  clicks aimed at the visible floor below it.
- **`actors.js:68` a character whose `.glb` fails to load teleports to the world
  origin** — the magenta fallback holder has no child, and `GridActor` drives
  `visual === entity`.
- **`creation.js:171` banks a point per spend while `spendAttrPoint` silently
  refuses unknown attribute names**, leaving free points on the sheet.
- **`editor.js:400` any resize button silently deletes every row/column past
  `MAX_SIZE`** on a level larger than 40.

### 2. Parallel and duplicate implementations

30 new findings. The costly ones are not stylistic — each is a second copy that
has *already* lost a rule:

| The rule | Copies | Drifted? |
|---|---|---|
| The shove resolver | `displaceBody` (`combat.js:2082`) vs `aiShoveMember` (`:2694`) | **yes** — AI copy lost the slam `stunned` and the prop topple |
| The pull resolver | `performPull` vs `aiPullMember` (`:2645`) | **yes** — AI copy lost hazard-landing damage |
| The break-down resolver | `performBreak` vs `aiBreak` (`:2736`) | not yet — identical down to the label expression |
| The partition shoulder | three sites (`combat.js:2296`, …) | one bypasses the world facade |
| "Route to a tile beside the target" | `routeBeside`, `bestApproachPath` (`main.js:1274`), `approachAndDo` (`:1140`) | **yes** — the third lacks both guards the others carry |
| The out-of-combat crouch | full parallel of combat's, refusal strings included (`main.js:2616`) | — |
| `topplePlan` | `combat-plans.js` vs `oocTopplePlanAt` (`main.js:2511`) | line for line |
| "Is a living member standing here?" | six sites inside `combat.js`, three shapes | — |
| "What counts as a cover cell" | four sites across three modules | — |
| "Does this shielded face point at the attacker?" | three implementations | REVIEW.md records it as having *one* owner |
| Walk speed | `memberSpeed` (`main.js:3758`) vs `step-rules.speedUnderStatus` | **yes** — main.js adds a surface term the other callers lack |
| `mulberry32`'s mixer | `main.js:152` **new on this branch** + `combat.js` | — |
| `cheb` | `tactics.js:52` + `combat-geometry.js:25`, byte-identical, a test in each suite | — |
| Neighbour offset arrays | seven declarations under five names | — |
| "Whose sheet am I steering?" | four spellings in `main.js` | the actor half has one named owner |

The `cheb` case is the tidiest illustration: `combat-geometry.js:19` *already
imports* from `tactics.js`, so one line could re-export instead of redefining.

### 3. Separation of concerns and god methods

Measured, not estimated:

| Site | Size | What it braids |
|---|---|---|
| `combat.js` `startCombat` | **5,065 lines**, 176 inner fns, 21 shared mutables (+493 this branch) | everything |
| `main.js` `startGame` | 4,214 lines, 159 inner fns, 26 mutables | everything |
| `combat.js` `drawTargets` | **321 lines** | 13 verb-specific drawing rules, a third verb ladder, mutable animation state |
| `combat.js` `update(dt)` | **278 lines** | 8 responsibilities incl. ~90 lines of AI plan-gathering |
| `combat.js` `handleEnemyClick` | 243 lines | 9 inline verb arms, each re-implementing the AP check and teardown |
| `editor.js` `startEditor` | 641 lines | + hardcodes the tile-category list in system code |
| `god.js` `buildPanel` | 595 lines | 23 inner fns; the e2e suite depends on its verbs |
| `grid.js` `parseLevel` | 276 lines | named for parsing, actually constructs a five-subsystem mutable world |
| `looting.js` `lootEntries` | 120 lines | five unrelated scans, three grid sweeps, an inline flood fill |

The concrete cost is stated best by the `update` finding: to assert "a summoner at
1 AP with a maxed roster falls through to the attack beat", a test must construct
`acting`, `bout`, `crouched`, `facings`, `watching`, `aiTargets`, `refused`, a live
PlayCanvas app **and** the whole world facade — because `beatState` is assembled
from 14 closure reads spread over 60 lines. There is no seam to call.

Other layer violations worth naming:

- **`combat.js:1828` `refresh()` — a repaint function owns the crouch rule's
  lifecycle.** A view call is load-bearing for a game rule.
- **`combat-plans.js:54` the pure modules take a parameter literally named
  `world`** that is combat's host facade — duck-typed, so a unit test structurally
  cannot check it. This is the footgun AI_PLAN recorded as #16 after it shipped a
  crash; the class is still open (see §4).
- **`floors.js:59` finds stair runs by the literal tile id `'stairway'`** although
  `tiles.js` declares a `stairs: true` flag for exactly that purpose — a "content
  is data" break in a pure module.
- **`looting.js:330` the Alt-overlay loot icon table is a hardcoded content list**
  in systems code, and it has already drifted: break-room containers get the
  generic box.

### 4. Test gaps

26 new findings. The pattern is consistent and worth stating plainly: **the tested
half is the half that was already easy to test.**

- **The AI's `perform` half has no coverage at any level.** `aiShoot`,
  `tryAiCrouch`, `aiSupport`, `aiPullMember`, `aiShoveMember`, `aiBreak`,
  `rangedLines`, `aiAllies`, the support ration and the refused-set lifecycle all
  live in `startCombat`'s closure. Re-introduce the `d8c6e6c` facade crash and
  **`npm test` stays 711/711 green**. Both bugs that shipped on this branch were in
  this layer; neither landed with a regression test.
- **The enemy ranged kit — M5's headline — has zero e2e coverage.** Of 44 arenas,
  42 place `manager` and one places `hr`. `executive` and `security-guard` appear
  in **no arena at all**. Break the enemy shot (delete the `hasLos` conjunct at
  `combat.js:4694`) and every suite stays green.
- **None of the six e2e specs AI_PLAN names for M1–M6 shipped**, while AI_PLAN's
  "As landed" section reports those milestones "as specified". `__combat.bout` —
  the regression tripwire milestone 1 exists to provide — is read by no test, and
  the `?seed=` lane that makes it reproducible is exercised by no test.
- **Several new AI unit tests pass for the wrong reason.** `AI.W_PATH`, the
  "baseline everything trades against", is pinned by no assertion — the three
  "cheap route wins" checks pass on fixture array order. `lineWeights` is compared
  against `AI.STATUS_WEIGHT` itself, so setting the knob to 1 disables M6's status
  weighting with the suite green. `pickTarget`'s kill and fragility terms mutually
  mask, so the M2 kill term can be deleted green. `scoreDestination`'s backstab
  and slip terms are never exercised at all.
- **One line locks 1,613 lines out of node.** `ui/chrome.js:90` registers a resize
  listener at module scope; `ui.js` is the barrel every UI consumer imports, so the
  throw cascades to all of `ui/` **and** to `doors.js`, `dialogue.js` and
  `shopping.js` — the three modules TODO.md Phase 5 holds up as successfully
  carved onto host-callback seams. A one-line `globalThis.window` stub makes all
  eight import cleanly, which is the proof the seam is real and merely unreachable.
- **No unit test, and no import from one:** `looting.js` (447), `dialogue.js`,
  `doors.js`, `shopping.js`, `hover.js`, `aim-paint.js`, `tile-renderer.js`,
  `picking.js`, `portraits.js`, `editor.js` (664), `god.js` (715), all of `src/ui/`.
- **`levels/dev/*.json` is registered, playable from the floor-select menu, and
  covered by none of the eight per-file level lints.**
- **`playwright.config.js:6`** raises the per-test budget to 120s but leaves
  `expect.timeout` at Playwright's 5s default, which 52 of 174 `expect.poll` sites
  rely on. **`:45`** reuses an existing server on 8173, so a stale local build is
  tested and never rebuilt.
- **The registry lint gained no checks for the two AI fields this branch added**
  (`focus`, the `support` descriptor), though the same file lints the equivalent
  shape for tile topple damage. Relatedly, `unitCombat` (`stats.js:380`) defaults
  every stat *but* `attackAp` — a def omitting it never attacks, never shoots and
  never advances (it is already in reach), and passes every turn forever. All four
  shipped defs declare it; nothing requires them to.

### 5. Inconsistencies, dead code, doc drift

- **5.1** `data/statuses.js:212` — `sneaking`'s `fx: { burst: 'none', aura: 'none' }`
  uses values `fx.js` does not know, so it falls through to the loudest burst:
  sneaking characters trail particles continuously.
- **5.2** `combat-plans.js:159` — an action's `range` is Euclidean when shooting a
  body and Chebyshev when breaking a prop.
- **5.3** `combat.js:631` — `guardStandingAt` has no side test, so an enemy holding
  Hold the Line shields a party member, and vice versa.
- **5.4** `data/enemies.js:117` — class-backed enemies inherit an `attr` block only
  the charm path reads, so charming a Manager and charming a Guard produce wildly
  different characters.
- **5.5** Two representations of "is this unit charmed" — `unit.charmed` (read by
  `liveEnemies`) and the `charmed` *status* (read by `aiAllies`). `charmUnit` sets
  only the flag; both callers happen to apply the status first. Convention, not
  construction — and it is the same footgun 5 the branch already fixed once.
- **5.6** *[unreachable today]* `pathfinding.js` `findPath` has no explored-node
  cap — verified to hang on an all-open predicate. Closed in practice by
  `grid.js:130`, which returns the wall def out of bounds, so every real world is
  sealed.
- **5.7** *[unreachable today]* `truncateByBudget` reads a NaN budget as unlimited
  and returns `{ points: [null] }` for an empty path. All six callers guard on both
  sides.
- **5.8** *[unreachable today]* `looting.js` — `sendItem` re-resolves the pocket
  index by identity ("it moved while the menu was open"); `useItem`, `equip` and
  `dropItem` splice the captured index. Closed by `invPanel.refresh` rebuilding the
  handlers after every mutation. The author found the hazard and fixed one of four.
- **Dead code:** `combat.js:3568` purge self-cast branch; `combat.js:3811`
  `commitInstant`'s heal arm and `INSTANT_CONFIRM`'s `'heal'` entry (no
  `type: 'heal'` action exists); `combat-geometry.js:176` `edgeShieldedTile`
  (encodes a cover rule the game no longer uses); `data/surfaces.js:87` `GUM` (an
  unimported second source of truth for the gum numbers); three of five `STEALTH`
  constants in `stats.js`; `ui/creation.js:277` imports `draftName` and never calls
  it; two `setVisible` methods in `ui/hud.js` with no callers anywhere;
  `data/items.js:373` two of five loot tables unreachable on the shipped campaign,
  and `night-thermos` unobtainable in the whole game.
- **Doc drift, AI_PLAN specifically:** it still opens "No code yet" while its own
  As-landed section reports six shipped milestones; its architecture section places
  `entrenchPlan`/`shootPlan`/`supportPlan` in `combat-plans.js`, where none of the
  three exists; its published `AI` tunables block and scored-choice signatures do
  not match the shipped ones; its `file:line` citations are stale throughout —
  **including the "Do not touch" list and the Brief that milestone 7's executor is
  told to follow**. Three `[ratified]` tags cite nothing, and the twelve-arm ladder
  order — the doc's declared centerpiece — carries no tag at all.
- **Doc drift, elsewhere:** ARCHITECTURE.md still documents the pre-branch
  targeting rule ("nearest living member, ties to the bloodied one") and describes
  `combat-ai.js` as the old six-beat ladder; `data/enemies.js:3` still says attack
  lines are "picked at random each enemy turn"; `enemies.js:7` documents
  `aggression` as fight-initiation behaviour when it is only a dot colour, with a
  documented `'green'` value nobody uses; POWERS_PLAN's "Open after M9" still says
  the support-enemy option is blocked by risk 7, which AI M6 shipped.

### 6. Already recorded — re-confirmed, not re-found

51 findings restate items already open in this document or TODO.md. They were
re-traced and still hold; they are not re-argued here.

**One correction to the record, which this pass owes TODO.md.** The
charmed-coworker-death case (TODO.md Phase 8, "Release on all three paths: lapse,
victory, and death mid-session" — still an open box) was re-reported here as a
critical soft-lock and **that is wrong**. The mechanism is real:
`unitStrikesMember` (`combat.js:4176`) sets only `m.toppled` and never touches
`unit.alive`, `slotAlive` makes the borrowed slot dead so `turn-order.js:117`
returns `'skip'` before the expire branch, and `releaseCharm` therefore never
fires — so `hostilesRemain()` stays true. But the fight is **not** unwinnable:
`picking.js` carries no alive/charmed filter, the death FX deliberately keeps the
body (`actors.js:234`, "The body STAYS"), and `handleEnemyClick`'s only gate is
`!en.alive` — which passes, because `unit.alive` was never cleared. The player
can walk up and re-kill it, and `victory()` fires normally. The real residual
defect is **medium**: a toppled corpse that is secretly a full-HP hostile, drawing
no target ring (because `drawTargets` reads `world.liveEnemies()`), with no
release-on-death path. Recorded this way so the next pass does not re-inflate it.

The other notable re-confirmations: unescaped player names reaching `innerHTML` on four
surfaces (now materially worse, because the save round-trips through a shared
cloud store); the two god closures; the `hazardKind`/`surfaceImpactKind` split
(this branch added a fifth call site); the four hand-written per-tile step
handlers; `portraits.js:77` holding a fourth copy of "tint a body" — the
compounding in-place multiply the other three were rewritten to remove.

### 7. Suggested priorities

1. **§1.1 the free summon** — a live regression from this branch, and cheap.
2. **§1.2 the equip/unequip heal** and **§1.3 friendly verbs on enemies** — both
   reachable by a player in ordinary play, both a handful of lines.
3. **§1.7 Pull Over's missing affordance** — and with it, delete `ringsAtBodies`
   so `verbKind` genuinely has one owner. Fixing the instance without collapsing
   the ladder leaves four more.
4. **A world-facade contract test.** Build the object `main.js` passes as `world`
   from a headless fake and assert every key the pure modules destructure exists
   and is callable. That is the class of both bugs this branch shipped, and
   §1.14's `floors.js` omission is a third instance waiting.
5. **Move `ui/chrome.js`'s listener behind a mount call** — one line that unlocks
   1,613 lines for unit testing, including the three modules the architecture
   already claims are testable.
6. **One arena with an Executive in it.** The branch's headline feature currently
   cannot regress visibly.
7. The duplication table in §2, worst-drifted first: the shove, then the pull,
   then the break.

---

## Consolidated re-verification — 2026-07-31

Baseline: `claude/combat-interaction-bugs-po78ob` merged up to `origin/main`
(`9373dd0`), 622 unit tests passing. Two earlier review passes were folded
together here and **every claim was re-traced through the code on this
branch** before it was kept. Findings that the branch has since fixed are
recorded as closed rather than deleted, so they are not re-found later.

### Questions for the designer — answered 2026-07-31

All four came back the same day they were asked. Recorded in the designer's
own terms, with what each one changed.

1. **The camera follows the acting character in a fight.** `[ratified]`
   (designer, 2026-07-31: "agreed"). **Done.** `main.js:steeredActor()` is
   the one answer to "who is the player driving?" — the acting combatant in
   a fight, the leader out of one — and the follow loop, the wall fade,
   `Home`, the profile card, the party-bar card and the initiative rows all
   read it. `player` keeps its old, narrower meaning ("who leads the
   party"). See "the camera detach" under *Closed*.

2. **Everything should work out of combat.** `[stated]` (designer,
   2026-07-31: "yes, i dont see any reason anything shouldnt ever work out
   of combat"). Broader than the question asked, and correct as a
   direction — but it lands on a real obstacle that is worth stating
   plainly, because it is not about the verbs. **Out of combat there are no
   meters.** AP, per-fight `uses`, and the turn clock are all combat-only
   state, so a verb armed out there costs nothing, is limited by nothing,
   and — if it applies a turn-clocked status — never expires. Concretely:
   `performance-review` and `onboarding` apply 3-turn buffs on the `turn`
   clock, and only `tickStep` runs outside a fight (`main.js:2093`), so an
   out-of-combat buff is **permanent** until a fight starts and burns it
   down. Pre-buffing before every fight becomes free, mandatory, and
   invisible. See "the metering question" below — it is the one thing still
   open on this, and it is a design question, not an engineering one.

3. **Withdrawn — the premise was wrong.** `[stated]` (designer,
   2026-07-31: "why would staples create paper? i find the questions whole
   premise confusing"). Fair: it came out of an earlier review pass, not
   from anything in the design, and it does not survive contact with the
   fiction. The `paper` surface is shredded TPS reports you gather once
   (`surfaces.js:74`); a fired staple has nothing to do with it. Dropped,
   and recorded here so it is not re-raised.

4. **`POWERS_PLAN.md` is not retro-tagged — it is a live document.**
   `[stated]` (designer, 2026-07-31: "thats a design doc im working on
   now"). The tagging finding is **withdrawn**: a doc being written now is
   not a doc that skipped the discipline, and going through it to stamp
   tags on decisions the designer is still forming would be exactly the
   presumption CLAUDE.md exists to prevent. Hands off until they say
   otherwise. (The other zero-tag docs in the list below stand as an
   observation, not a work item.)
   **God mode stays ungated.** `[stated]` (designer, 2026-07-31: "god mode
   can stay around"). `TODO.md`'s dev-flag box is closed as answered rather
   than done.

### The metering question — answered: one clock (A)

`[stated]` (designer, 2026-07-31): *"yes its A. that clock should've been
used from the beginning for tracking fire and player effects. whats ticking
player effects then? those should all be using the same thing in and out of
combat, its not something new going on here."*

**Done.** To answer the question inside it, because it is a fair one and the
answer is short: `tickTurn` had exactly **one** caller, `turn-order.js:135`,
which fires as each combatant's turn opens — so the turn clock only ever ran
inside a fight. `tickStep` is called from `main.js` on each tile entered, so
the step clock (gum, bleed) always ran on both sides. Two clocks, one of
which stopped at the door.

And the designer is right that this was never a new mechanism: the
out-of-combat world clock has been there all along (`OOC_TURN_SECONDS`,
`main.js:3149`) and already spends everything a combat round spends — fire,
smoke, summon assignments, the litter a power dropped. Statuses were the one
thing it did not spend. `advanceStatusTurn()` now spends them too, over the
roster, the temps and the coworkers on the floor, through the same `tickTurn`
with the same durations.

Two things fell out of it:

- **Combat's end-of-fight sweep is gone.** `cleanup()` used to clear every
  turn-clock status from every combatant on the grounds that "there are no
  turns on the map". There are now. That sweep was also doing real damage on
  its way out: walking out of a fight put out the fire you were carrying,
  cleared a stun mid-sentence, and handed back a Deflect you had spent.
- **`covered` is the one status that needed care**, and it always was the odd
  one: its duration is a leak bound, not a clock (`data/statuses.js:197`), and
  combat re-applies it on every consult while the crouch holds. `main.js` now
  does the same against `oocCrouch`, or the new clock would have timed a
  stationary character out of their own cover in four ticks — which the
  "a crouch taken before the fight rides into it" spec would have caught.

It also closes the metering worry that prompted the question. A 3-turn buff
is ~4.8 seconds of standing around out of combat, so pre-buffing is
self-limiting: you cannot walk across the floor wearing it. No `uses` ledger
needed for that. The remaining unmetered verb to watch is `paper-storm` — it
lays the `paper` surface, which is gatherable for ammo, so opening zones up
out of combat unmetered is the exact farm `surfaces.js:74` was written to
prevent. Mobility and `pull` are safe (you can already walk anywhere out
there; nothing crouches out there).

### The crouch became a position (2026-07-31)

Not a review finding — a design change made in-session, recorded here because
it supersedes what the earlier passes describe. `[stated]` throughout
(designer, 2026-07-31).

Take Cover used to ask you to name a SHIELD, then chose which side of it you
stood on. That made the side an output, which is why the aim emblem hopped
tile to tile and why "the other side of that person" was unsayable. It now
asks you to name the SPOT YOU WILL STAND, and whatever shields that tile's
faces covers you along them.

- Three crouch modes (cell / human shield / edge) collapse into the one edge
  mode always had. `tactics.shieldedFaces` is the single primitive; `hasCover`
  is it composed with `facesShieldFrom`, so the M3 to-hit modifier and the M6
  immunity can no longer drift apart.
- **Uncapped**: a corner covers two axes, an enclosed tile covers four, and
  such a body cannot be shot from anywhere. Accepted deliberately — the
  counters are melee, the topple, the break-down and Pull Over.
- **Cover behind a person works out of combat** now. It never did: the
  out-of-combat verb knew only tiles and partitions and refused a body with a
  rule nothing else in the game observed.
- **The covered faces are drawn** — while aiming and while the crouch holds,
  in a fight and out of one, off the same live list the shot resolves against.
  A held crouch used to show only an "In Cover" chip, so a corner told you
  nothing about which way was open.
- `combat-plans.coverSpot` is deleted with the rule it served.
- **The aim is continuous** (landed 2026-07-31, after the position rework):
  a marker rides the precise cursor point, the stand-tile ring eases toward
  the resolved tile instead of hopping, and the commit walks the body to the
  CLICKED point clamped to clearance — `walkActive`'s free endpoint in
  combat, `walkToExact`'s new one outside it — so the spot you chose is the
  spot you occupy. The rule still resolves on the tile's faces.

One shipped e2e changed meaning as a result, which is worth flagging rather
than burying: `cover.spec.js`'s flanking test used a Manager boxed in by four
cabinets. Immobile needs four solids, and four solids is now four covered
faces — so that arena cannot be flanked, by design. The spec now asserts what
the new rule does (every angle refused; break one face and exactly that shot
opens), and flanking a partially covered target is pinned in
`tests/unit/tactics.test.js`, where the geometry can be stated exactly.

### Confirmed, still open

- **Player-typed names go raw into `innerHTML`,** on four surfaces now, not
  one: the initiative strip (`ui/combat.js:48`), the HUD profile card
  (`ui/hud.js:96`), the party-bar slot (`ui/hud.js:426`) and the character
  sheet (`ui/panels.js:255`). `cleanName` (`creation.js:76`) only trims and
  slices to 24 chars, which is room enough for `<svg onload=…>`; a bare
  `<b>` corrupts the strip. `esc()` exists in exactly one file,
  `ui/screens.js:30` — it should move somewhere all of `ui/` can reach it.
- **Pan keys `preventDefault()` before any gate** (`main.js:2802`), so the
  arrows kill scrolling in every DOM panel; and `modalOpen()` is still only
  `dialogue || shopping` (`main.js:1260`), so WASD pans the world behind the
  level-up screen, the sheet, the pockets and the game menu.
- **Member slips still roll `Math.random()`** (`main.js:2171`) while AI slips
  roll off the seeded stream (`combat.js:3882`), so a seeded fight does not
  replay. One line. The recent slip work consolidated the *rule* into
  `step-rules.js` and stopped slip-proof characters drawing at all — it did
  not change where the member roll's randomness comes from.
- **God mode ships ungated** (`god.js:74`, `main.js:3585`): backquote/F8, and
  `localStorage` makes it stick across reloads. See question 4.
- **Intent-tagging holds in 4 plan docs out of 18** — `TACTICS_PLAN` (32
  tags), `CHARACTER_PLAN` (22), `INITIATIVE_PLAN` (15), `REFACTOR_PLAN` (4);
  zero in `PROGRESSION_PLAN`, `SUMMON_PLAN`, `STATUS_PLAN`, `PARTY_PLAN`,
  `MOVEMENT_PLAN`, `HIT_PLAN`, `EQUIPMENT_PLAN`, `ECONOMY_PLAN`. Recorded as
  an observation, not a work item: retro-tagging somebody else's docs is the
  presumption the rule exists to prevent. `POWERS_PLAN` is deliberately off
  this list — it is being written now (question 4).
- **Eight-plus `stats.js` exports are named by no test at all** — 12 by a
  strict count: `pendingPoints`, `effectiveAttr`, `createSheetFrom`,
  `normalizeAttr`, `trackNode`, `nodeAvailable`, `applyEffect`,
  `xpNextForLevel`, and the `PAPER`/`MOVE`/`ATTR`/`EQUIP` tables.
  `pendingPoints` is the function `ARCHITECTURE.md` credits with stopping a
  rule that had drifted across four surfaces.
- **`[quick]` in CI has the never-fires bug the header documents for
  `[e2e]`** (`ci.yml:83`, `:91`, `:95`, `:99`): it reads
  `github.event.head_commit.message`, which does not exist on
  `pull_request`. A branch push raises only `pull_request`, so `[quick]`
  never fires on a branch — exactly the failure the header carefully
  explains two jobs above. It does work on `main`.
- **79 `waitForTimeout` sleeps across 22 specs**, `helpers.js` included — up
  from the 73 and 78 the two earlier passes counted.
- **Two modules are still missing from the module map:** `portraits.js` and
  `powers.js`. `powers.js` is not a small omission — it owns the predicates
  (`isPull`, `aimsAtProps`, `pullLanding`) that three other modules dispatch
  on.

### Closed since the earlier passes

- **The camera detach is fixed** (question 1). The rig followed `player` —
  the *leader's* actor — every frame, `makeActive` never re-keyed that
  binding, and `switchLeader` returns early while `inCombat` by design. So
  in a multi-member fight `combat.actingActor !== player`, and
  `focusCameraOn` took the `panTo` branch: the key whose comment promised
  "whoever you're driving" **detached** the rig and froze it where that
  member stood, with nothing re-attaching until control changed hands.
  `steeredActor()` is the one owner now. The spec that missed it asserted
  against `playerPos` in a one-member fight, where the leader and the acting
  member are the same object — a true negative. It asserts against
  `steeredPos` now, and a new two-member leg steers a teammate mid-fight and
  checks the camera goes with them. That leg needs a SHARED turn, which is a
  dice outcome, so it skips when the roll does not produce one — a seeded
  initiative hook would make it deterministic and is worth doing.
- **The Phase 0 critical is fixed, better than `TODO.md:329` specified.**
  `combat-targeting.verbKind` dispatches before any melee fall-through, so
  an armed buff/mobility can no longer resolve as a strike, and
  `actors.js:430` clamps non-finite damage to a visible no-op. The TODO box
  is ticked.
- **The slip rule no longer exists three times.** `step-rules.js` is the one
  owner for members, summons, AI units and wanderers, with the
  sample-before-tick rule in it. (The seeded-stream half is still open,
  above.)
- **The god files shrank rather than grew.** `combat.js` 4,396 → 4,367 and
  `main.js` 3,802 → 3,586 since the second pass — the panel extraction
  (`ui/combat.js`), the AI beat ladder (`combat-ai.js`), the plan/perform
  split (`combat-plans.js`) and the four subsystems `main.js` handed off.
  Still 7,953 lines with no unit coverage; the extraction plan stands.
- **Registry integrity and economy arbitrage: still clean.** Both mechanical
  passes came back with zero dangling ids and nothing selling above its buy
  price. Worth re-running, not worth re-reading.

---

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
