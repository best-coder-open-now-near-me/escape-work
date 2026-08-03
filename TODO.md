# TODO — Escape Work

**THE QUEUE below owns every review finding.** If a finding from a code review
is not ticked there, it is not done — no other section of this file, and no
paragraph in REVIEW.md, overrides that. This rule exists because it was broken:
the 2026-08-02 pass found 54 of its 227 findings already on the books from
earlier passes, some twice over, because they had been recorded as prose in
several places at once and each place assumed another had handled it.

The `## Phase N` sections further down are the ORIGINAL worklist and are kept
for the work that did not come from a review — chiefly the character-creation
feature from `CHARACTER_PLAN.md`. Where a Phase item and a queue item are the
same thing, the queue is authoritative; the Phase entry is history.

## The 20 remaining HIGH findings — superseded

Folded into THE QUEUE below, which covers all 227 standing findings rather than
only the 24 high ones. Splitting the highs into their own list was how the other
203 went back to being prose - the exact failure the queue exists to stop.

## THE QUEUE — every standing finding, 2026-08-02 review

One list, one place, checkboxes. It exists because the findings that keep being
skipped are the ones that live in prose: this pass found that **54 of its 227
findings were already on the books** here or in REVIEW.md from earlier passes,
some of them twice over. A paragraph is not a queue. Anything below that is
still unticked has not been done, whatever any narrative section elsewhere in
this file says.

How to read it:

- `[x]` closed, with what closed it. Kept rather than deleted, so it is not
  re-found by the next sweep and re-counted as new.
- **`(carried)`** was already on the books BEFORE 2026-08-02. These are the
  repeat offenders, and they are sorted to the TOP of each severity band for
  exactly that reason — if a sweep is ever cut short, cut it from the bottom.
- Findings the pass could not fully prove are marked in REVIEW.md as
  `plausible`: reproduced as a code fact, never driven to the symptom. Treat
  those as leads. Of eight refutations in this pass, six were right about the
  code and wrong about the consequence.

**227 standing** — 24 high / 105 medium / 98 low. **31 ticked.**


### HIGH

- [x] **Q001** `src/floors.js:147` [bug] **(carried)** layeredGrid's forwarded METHODS list omits sightOpenCellLow/sightOpenLow — reproduced as a TypeError<br>      ↳ DONE — forwarded, plus a derived contract test
- [x] **Q002** `src/ui/hud.js:96` [bug] **(carried)** Player-typed names still go raw into `innerHTML` on four surfaces — and the save now round-trips through a shared cloud store<br>      ↳ DONE — esc() moved to chrome.js; 4 sites
- [ ] **Q003** `src/combat.js:4530` [god-method] **(carried)** `combat.js update(dt)` is a 278-line per-frame god method holding eight unrelated responsibilities — the AI turn loop cannot be tested without a browser
- [x] **Q004** `src/combat.js:2713` [soc] **(carried)** `aiShoveMember` bills a party member RAW surface damage via the enemy hazard model, silently voiding the talent immunities that main.js applies to the same tile<br>      ↳ DONE — world.memberSurfDamage (Q1-A)
- [ ] **Q005** `tests/unit/combat-ai.test.js:1` [test-gap] **(carried)** Every AI *perform* half added by this branch lives in combat.js and has no test at any level - both AI bugs that shipped on this branch were in exactly that layer, and neither landed with a regression test
- [x] **Q006** `src/combat-ai.js:157` [bug] A shooter already standing on a legal firing tile can never reposition or close, so a blocked shot burns its whole turn — every turn<br>      ↳ DONE — self-tile is a candidate, not a short-circuit
- [x] **Q007** `src/combat-ai.js:97` [bug] standTilePath/standTileRoutes never test that a swing from the chosen tile is legal, so the AI's "engageable" tier admits members it provably cannot hit<br>      ↳ DONE — canSwingFrom threaded through
- [x] **Q008** `src/combat-targeting.js:89` [bug] `ringsAtBodies` is a second verb classifier that omits `pull` — arming Pull Over draws no rings or reach circle at all, and two live-looking branches are dead<br>      ↳ DONE — derived from verbKind; the pull rings again
- [x] **Q009** `src/combat.js:4633` [bug] HR's reinforcements spawn for free: `resolveSummon` is called as a readiness predicate, and the new `support` arm now outranks the beat that pays for it<br>      ↳ DONE — summonRoom asks; the summon beat acts
- [x] **Q010** `src/combat.js:3369` [bug] An armed HR buff resolves on a coworker: clicking an enemy body with Performance Review armed spends the use and buffs the enemy<br>      ↳ DONE — the click asks verbSides(a, range).enemies
- [x] **Q011** `src/combat.js:4257` [bug] `threatsAgainst` still reads `engaged` as "the enemy side", so your own charmed ally opportunity-attacks you<br>      ↳ DONE — reads aiAllies(), not raw engaged
- [x] **Q012** `src/combat.js:3514` [bug] `walkActive` breaks the crouch before it decides the walk is degenerate, so a refused click costs you your cover for free<br>      ↳ DONE — breakCrouch moved beside beginMove
- [x] **Q013** `src/combat.js:2591` [bug] Enemy Grit saves read `def.grit`, a field no registry entry defines — every enemy saves at the `?? 2` fallback<br>      ↳ DONE — grit passes through unitCombat from attr.grit
- [x] **Q014** `src/combat.js:2280` [bug] The stun FX fires on a party member even when the anti-chain immunity window blocked the stun — the member victim branch is a hand-mirrored copy of the enemy branch that dropped its gate<br>      ↳ DONE — one landStun helper; three copies gone
- [x] **Q015** `src/editor.js:301` [bug] Editor char allocations leak across loadLevel, so after loading level2 the ficus brush silently paints a tier-3 Manager<br>      ↳ DONE — char slate reset at loadLevel
- [ ] **Q016** `src/main.js:3063` [bug] In combat the crosshair/glow promise a swing that the click turns into an in-place shuffle, because the pick ray hits an adjacent body over your own tile
- [ ] **Q017** `src/main.js:252` [bug] Setting a cloud save key on a browser that already has a local save destroys the cloud run that key points at
- [x] **Q018** `src/main.js:161` [bug] clearProgress() is the one unguarded localStorage write left; a throw eats the lose screen and the Restart-run escape<br>      ↳ DONE — wrapped; remote.clear stays outside the try
- [x] **Q019** `src/main.js:2018` [bug] Sneaking survives the floor transition as a ghost status, and the next floor can never start a fight with you<br>      ↳ DONE — held-mode statuses stripped on serialize
- [x] **Q020** `src/stats.js:806` [bug] Equip/unequip cycling a maxHp trinket ratchets HP back to full — a free, unlimited heal<br>      ↳ DONE — debitLostHp, floored at 1
- [x] **Q021** `src/combat.js:2694` [duplication] aiShoveMember is a second shove resolver that has already dropped the wall-slam stun and the slam-into-a-prop topple<br>      ↳ DONE — merged into displaceBody behind victimView (Q4-A)
- [x] **Q022** `src/combat.js:1384` [god-method] `combat.js drawTargets()` is a 321-line renderer holding thirteen verb-specific drawing rules, a third verb-dispatch ladder, and mutable animation state<br>      ↳ **PARTLY DONE — 321 → 195 lines.** Seven pieces named: drawAimWash (50), drawCoverRings (29), drawZoneRings (17), drawSummonRings (10), drawAllyRings (9), drawHoveredDoor (7), drawHeldCrouch (4). The third verb-dispatch ladder was already collapsed onto verbSides. **Still open, and deliberately:** the BODY pass - cone polyline, reach ring, shove/topple/partition/break rings, the per-enemy loop - which genuinely shares hoverFoe, coverEase and the enemy iteration and wants a real look rather than another mechanical cut. Re-queued as Q901.
- [x] **Q023** `src/ui/chrome.js:90` [test-gap] One module-scope `window.addEventListener` in ui/chrome.js locks 1,613 lines — the whole `ui/` layer plus the three host-callback modules the architecture holds up as exemplary — out of node unit testing<br>      ↳ DONE — bound on first use; 11 modules unlocked
- [ ] **Q024** `tests/e2e/helpers.js:92` [test-gap] No e2e arena or spec ever fights an Executive or a Security Guard - so the enemy ranged kit, M5's headline feature, has zero end-to-end coverage

### MEDIUM

- [ ] **Q901** `src/combat.js` [god-method] **(new 2026-08-02, the remainder of Q022)**
  `drawTargets`'s BODY pass, ~195 lines: the cone polyline, the melee reach ring,
  the shove/topple/partition/break rings and the per-enemy ring loop. Unlike the
  ground arms these are NOT independent - they share `hoverFoe`, `coverEase` and
  the enemy iteration, so splitting them means deciding what owns that state, not
  just moving braces. Worth noting what the ground-arm extraction nearly cost: the
  ally arm had no `return` and FELL THROUGH on purpose, which is what gives the
  purge rings on both halves; a mechanical cut turns that into `return true`
  silently. Expect at least one more of those in here.
- [ ] **Q900** `src/main.js` [soc] **(new 2026-08-02, from the fix work itself)**
  The combat world facade is repeatedly NARROWER than main.js's own helpers, and
  the contract test (Q009) cannot see it. That test checks every key the pure
  modules destructure EXISTS; it cannot check that combat is asking the same
  question main.js would. Four instances found while fixing other things:
  `occupied` (absent - the crash this branch shipped), `memberSurfDamage`
  (absent, so forced landings billed the enemy model and voided talent
  immunities), `room` (absent, so the summon cap leg was skipped in a fight),
  and `isBurning` (absent, so combat asked `surfaceIdAt === 'fire'` - a
  different question - and the FX precedence drifted). All four are now closed,
  but the PATTERN is open: the facade grows by whatever the last bug needed.
  Worth one pass that walks main.js's own query helpers and asks, for each,
  whether combat can reach the same answer.

- [x] **Q025** `src/pathfinding.js:394` [bug] **(carried)** roundBends' arc-rejection fallback emits an unvalidated leg — reproduced: a smoothed walk crosses a partition<br>      ↳ **NOT REPRODUCIBLE — closed as refuted, with the method.** The reasoning is sound in the abstract (`p1` lies on `a->b`, so a failed `a->p1` check condemns `a->b`, and the fallback pushed `b` regardless) but the case does not arise. Instrumented `roundBends` over 200k random 7x7 maps WITH partition edges in play: **18,974 arc rejections, 0** where the straight leg `a->b` was also illegal. Without edges the branch never fires at all. A guard was written, measured to change no outcome, and reverted rather than left as complexity in a hot path. What DID land is the test gap underneath it (Q0xx): `pathfinding.test.js` asserted only that rounded-bend VERTICES sit on open floor, never the legs between them — three tests now sample the segments.
- [x] **Q026** `/home/user/escape-work/ARCHITECTURE.md:114` [doc-drift] **(carried)** ARCHITECTURE.md's module map describes `combat-ai.js` as the old six-beat ladder; the shipped ladder has twelve arms<br>      ↳ DONE — ARCHITECTURE.md now lists all twelve arms and names beatStateFrom
- [x] **Q027** `/home/user/escape-work/ARCHITECTURE.md:518` [doc-drift] **(carried)** ARCHITECTURE.md's debug-surface note claims damage and initiative roll `Math.random` and that a fight is never fully deterministic, and omits the new `bout` getter<br>      ↳ DONE — ARCHITECTURE.md now says a seeded fight DOES replay, and documents `bout`
- [x] **Q028** `/home/user/escape-work/TODO.md:823` [doc-drift] **(carried)** TODO.md Phase 8 is still headed "BLOCKED" with four checkboxes whose fixes are live in the code<br>      ↳ DONE — Phase 8 re-headed SHIPPED; five of six legs ticked, the death path left open
- [x] **Q029** `/home/user/escape-work/TODO.md:363` [doc-drift] **(carried)** TODO.md's P1 "Enemy AI paces between two tiles" points at `combat.js:96` and calls the self-path exemption dead code, but the fix lives and is tested in `combat-ai.js`<br>      ↳ DONE — the P1 entry is ticked and corrected - the exemption is live and tested
- [x] **Q030** `src/combat.js:574` [duplication] **(carried)** `hazardKind`/`surfaceImpactKind` are still two hardcoded surface-id→FX maps in two layers, and this branch added a fifth call site to one of them<br>      ↳ DONE — step-rules.impactKindFor; the burst comes from the registry; isBurning on the facade
- [x] **Q031** `src/hotbar-model.js:35` [duplication] **(carried)** The universal-action list `['shove','take-cover','pull']` is written out verbatim in three places<br>      ↳ DONE — UNIVERSAL_ACTIONS in hotbar-model.js; both bars read it
- [ ] **Q032** `src/main.js:2716` [duplication] **(carried)** Four hand-written per-tile step handlers across three layers, under a main.js section header that claims the rules are "written once"
- [x] **Q033** `src/portraits.js:77` [duplication] **(carried)** portraits.js holds a fourth copy of "tint a body" — the compounding in-place multiply the other three were rewritten to remove<br>      ↳ DONE — portraits routes through cloneMaterials + tintMaterials
- [x] **Q034** `src/tactics.js:259` [duplication] **(carried)** "Does this shielded face point at the attacker?" is implemented three times, and REVIEW.md records it as having one owner<br>      ↳ DONE — tactics.shieldingFace; facesShieldFrom derives from it; 4 tests
- [ ] **Q035** `src/combat.js:4530` [god-method] **(carried)** `update()` is a 278-line god frame-driver braiding six responsibilities, and it grew with the AI work
- [ ] **Q036** `src/combat.js:3176` [god-method] **(carried)** `handleEnemyClick` is a 243-line dispatcher with nine inline verb arms, each re-implementing the same AP check, arming teardown and victory check
- [ ] **Q037** `src/combat.js:76` [god-method] **(carried)** The two god closures measured: `startCombat` is 5,065 lines / 176 inner functions / 21 shared mutable variables, `startGame` 4,214 / 159 / 26 — and combat.js grew 493 lines on this branch
- [ ] **Q038** `src/looting.js:292` [god-method] **(carried)** `looting.js lootEntries` is a 120-line function running five unrelated scans, three full grid sweeps and an inline flood fill — in a module kept out of node by a single renderer import
- [ ] **Q039** `src/main.js:304` [god-method] **(carried)** `startGame` has grown to a 4,214-line closure with 88 inner functions and 141 closure variables
- [x] **Q040** `src/combat.js:3536` [inconsistency] **(carried)** `verbKind` has only two consumers while five more hand-written `a.type` ladders are live — the exact drift TODO.md Phase 5 says to watch for<br>      ↳ DONE — attackOrConfront asks verbSides; three of five ladders now collapsed
- [ ] **Q041** `src/combat-plans.js:54` [soc] **(carried)** Pure plan modules take a parameter literally named `world` that is combat's host facade, so the contract is duck-typed and unit tests structurally cannot check it
- [ ] **Q042** `src/combat.js:76` [soc] **(carried)** `startCombat` is one 5,140-line closure - up ~440 lines on this branch - with `armed` mutated at 31 sites across eight subsystems
- [ ] **Q043** `src/editor.js:516` [soc] **(carried)** `editor.js startEditor` is a 641-line god closure, and it hardcodes the tile-category list in system code — adding a category means editing the editor
- [x] **Q044** `src/tile-renderer.js:12` [test-gap] **(carried)** Four modules still read `const pc = window.pc` at module scope, the pattern already fixed in actors.js/models.js/shading.js<br>      ↳ DONE — all ten deferred; 67 of 68 modules now import under node, gated by a test
- [ ] **Q045** `src/actors.js:68` [bug] A character whose .glb fails to load teleports to the world origin, because the magenta fallback holder has no child and `GridActor` drives `visual === entity`
- [ ] **Q046** `src/combat-geometry.js:150` [bug] hasSwingSpot scans only the 8 neighbours, so a long-reach weapon is told it has no melee option
- [ ] **Q047** `src/combat.js:2184` [bug] The ratified disengage shove was never wired up — `aiShovePlan`'s `disengage` flag has no production caller
- [ ] **Q048** `src/combat.js:4389` [bug] The Executive's ranged line fires as an opportunity attack — footgun 9's context-aware picker was applied in `aiAttack` only
- [x] **Q049** `src/combat.js:4632` [bug] The AI's summon readiness check SPAWNS, so HR fields two free reinforcements whenever the triage beat outranks it<br>      ↳ DONE — summonRoom asks; the summon beat acts
- [x] **Q050** `src/combat.js:476` [bug] `attackMods` builds the attacker's pincer list from `engaged`, so a charmed coworker helps the enemy flank you<br>      ↳ DONE — pincer list reads aiAllies()
- [x] **Q051** `src/combat.js:2279` [bug] A member's topple/crush stun plays its landing FX even when the anti-chain window refused it, and says nothing — the enemy branch twelve lines above does it correctly<br>      ↳ DONE — one landStun helper; three copies gone
- [ ] **Q052** `src/combat.js:4424` [bug] `ranged` is computed after the melee fallback, so a shooter with no firing tile gets the ranged shield term applied to melee swing tiles — and it steers it onto a tile it cannot swing from
- [ ] **Q053** `src/data/statuses.js:212` [bug] The `sneaking` status's `fx: { burst: 'none', aura: 'none', rate: 0 }` uses values fx.js does not know — sneaking characters trail particles continuously
- [ ] **Q054** `src/data/talents.js:146` [bug] The `corner-office-traction` talent's only effect (`moveCost: 0.9`) is read by nothing — the talent does literally nothing
- [x] **Q055** `src/dialogue.js:20` [bug] `nodeOptions` can filter a dialogue node down to zero options, and the dialogue panel has no other way out<br>      ↳ DONE — Leave applied after the filters
- [ ] **Q056** `src/editor.js:82` [bug] The editor's char pool is one character short of the paintable registry; the 87th distinct tile type silently paints floor
- [x] **Q057** `src/floors.js:147` [bug] layeredGrid's METHODS list drops sightOpenCellLow and sightOpenLow, so sneaking on a layered level throws<br>      ↳ DONE — forwarded, plus a derived contract test
- [ ] **Q058** `src/floors.js:71` [bug] A single-cell stair run is assumed to run along z, so an east-west one-cell flight is refused with a misleading error
- [ ] **Q059** `src/floors.js:170` [bug] planCrossLayerRoute only moves monotonically toward the destination storey, so an up-and-back-down route is refused
- [ ] **Q060** `src/main.js:1870` [bug] switchLeader never releases the out-of-combat crouch, so `oocCrouch` and the `covered` chip end up on the wrong members
- [ ] **Q061** `src/main.js:1870` [bug] switchLeader leaves the sneak on the old leader, making them permanently undetectable AND unable to trigger combat
- [ ] **Q062** `src/main.js:1741` [bug] The `confused` reorg desyncs the hotbar: pressing a slot uses the shuffled layout, right-clicking it uses the unshuffled one
- [ ] **Q063** `src/main.js:210` [bug] Picking "Start a fresh run" at the floor desk and then dying deletes the saved campaign the desk was still offering
- [ ] **Q064** `src/main.js:1007` [bug] A printer explosion damages party members but never touches player-team summons standing beside it
- [ ] **Q065** `src/main.js:1254` [bug] Layered walks splice the body's real position AFTER smoothing, so the first run is never corridor-checked
- [ ] **Q066** `src/main.js:1870` [bug] switchLeader() is the one leader handoff that never clears the out-of-combat crouch, so 'covered' is removed from the wrong sheet and the real croucher stays crouched forever
- [ ] **Q067** `src/main.js:274` [bug] The cloud "Continue the run" button swallows its write failure and never validates the row, so it can reload forever without ever booting the run
- [ ] **Q068** `src/main.js:1865` [bug] Class points outlive the class track, so the fullscreen LEVEL UP modal reopens after every victory for the rest of the run
- [ ] **Q069** `src/pathfinding.js:394` [bug] roundBends' arc-rejection fallback emits a leg it has just proved illegal, so a smoothed walk crosses a partition
- [ ] **Q070** `src/picking.js:91` [bug] `picking.pick` ignores storey visibility, so a cutaway-hidden floor eats clicks aimed at the visible floor below it
- [ ] **Q071** `src/scene.js:253` [bug] `refreshTile` and `buildLevel` silently drop every renderMarker result that is not wall/surface/prop, so toppled partitions and foliage are untrackable and stack
- [ ] **Q072** `src/tile-renderer.js:238` [bug] `addPaper` shadows the storey `baseY`, so a paper drift on an upper storey renders on the ground floor
- [ ] **Q073** `src/tile-renderer.js:367` [bug] `addFoliage` drops the storey `baseY` and parents to `app.root`, so upper-storey plants render at ground level and never hide with their storey
- [ ] **Q074** `src/turn-order.js:99` [bug] turn-order's span-end walk lands the pointer ON a slot `replace` swapped out, when the swapped slot was the span's last
- [ ] **Q075** `src/combat.js:2184` [dead-code] The ratified ranged-kit disengage shove is implemented and unit-tested but never wired — no caller passes `disengage`
- [ ] **Q076** `src/data/items.js:373` [dead-code] Two of five loot tables are unreachable on the shipped campaign, and `night-thermos` is unobtainable in the whole game
- [ ] **Q077** `/home/user/escape-work/ARCHITECTURE.md:444` [doc-drift] ARCHITECTURE.md still documents the pre-branch enemy targeting rule ("nearest living member, ties to the bloodied one")
- [ ] **Q078** `/home/user/escape-work/src/main.js:141` [doc-drift] The `?seed=` comment added by AI M1 asserts an initiative-rng gap the code does not have, and credits the seed with slips it does not cover
- [ ] **Q079** `src/data/enemies.js:7` [doc-drift] `aggression` is documented as fight-initiation behaviour but is only a dot colour; the documented `'green'` value is used by nobody
- [ ] **Q080** `src/combat.js:2699` [duplication] `aiShoveMember` re-states the shove's slam damage as a bare literal `2`, 617 lines from the `slamDmg = 2` default it claims to match
- [x] **Q081** `src/combat.js:2645` [duplication] aiPullMember drops the hazard-landing damage performPull applies, so an AI pull into live water or fire costs the member nothing<br>      ↳ DONE — billed through memberSurfDamage
- [ ] **Q082** `src/combat.js:4696` [duplication] The AI's shoot gate hand-rolls range and asks line-of-sight of rounded tiles, bypassing combat.js's own bodyDist/bodyLos and combat-geometry.verbReaches
- [ ] **Q083** `src/combat.js:505` [duplication] "What counts as a cover cell" is written four times across three modules
- [ ] **Q084** `src/combat.js:2296` [duplication] "Put a shoulder into the partition" is resolved in three places, one of which does not go through the world facade
- [ ] **Q085** `src/combat.js:2736` [duplication] performBreak and aiBreak are two copies of the break-down resolver, identical down to the label expression
- [x] **Q086** `src/hover.js:242` [duplication] hover.js and combat.js each carry their own copy of the ring/face drawing primitives, the affordance palette and the cover-aim easing<br>      ↳ DONE — ground-marks.js, shared with hover.js
- [ ] **Q087** `src/main.js:1140` [duplication] `approachAndDo` re-implements `bestApproachPath` line for line
- [ ] **Q088** `src/main.js:2115` [duplication] The "who joins this fight" filter is written out three times
- [ ] **Q089** `src/main.js:2511` [duplication] main.js reimplements combat-plans.topplePlan line for line as oocTopplePlanAt
- [ ] **Q090** `src/main.js:3758` [duplication] main.js's memberSpeed re-derives walk speed instead of using step-rules.speedUnderStatus, and adds a surface term the other two callers do not have
- [ ] **Q091** `src/main.js:2616` [duplication] The out-of-combat crouch is a full parallel implementation of combat's, refusal strings included
- [ ] **Q092** `src/ui/screens.js:87` [duplication] The level-up screen re-derives the banked-points sum that `pendingPoints` owns — a fifth surface, on the screen where points are spent
- [ ] **Q093** `src/god.js:109` [god-method] `god.js buildPanel` is a 595-line god closure with 23 inner functions and six shared mutable variables, and the e2e suite depends on its verbs
- [ ] **Q094** `/home/user/escape-work/src/combat.js:2184` [inconsistency] AI_PLAN A4's ratified "a RANGED unit may shove to disengage" carve-out is never wired: the only production caller omits `disengage`
- [ ] **Q095** `src/combat-ai.js:75` [inconsistency] HR's triage heal has no line-of-sight test and measures tiles, where the player's identical verb requires a clear line and body distance
- [ ] **Q096** `src/combat-plans.js:76` [inconsistency] The AI's shove reaches further than the player's and works straight through a partition
- [ ] **Q097** `src/combat-plans.js:159` [inconsistency] An action's `range` is measured Euclidean when shooting a body but Chebyshev when breaking a prop
- [x] **Q098** `src/combat.js:476` [inconsistency] A charmed coworker still completes the AI's flanking bonus in `attackMods`, contradicting the branch's own `aiAllies` fix<br>      ↳ DONE — pincer list reads aiAllies()
- [ ] **Q099** `src/combat.js:3217` [inconsistency] Take Cover clicked on any body always refuses, contradicting its own tooltip, its arm message and the click branch's comment
- [ ] **Q100** `src/combat.js:3592` [inconsistency] Topple rings promise a diagonal prop the tile click then refuses, because the ring measures tile adjacency and the click measures body distance
- [ ] **Q101** `src/combat.js:2038` [inconsistency] A purge aimed at a coworker with no statuses bills 2 AP and narrates success; the same verb aimed at a colleague refuses for free
- [ ] **Q102** `src/combat.js:4473` [inconsistency] AI units take a surface's damage but never its status: an enemy walked through fire never burns, and one crossing a paper drift never bleeds
- [ ] **Q103** `src/data/enemies.js:117` [inconsistency] Class-backed enemies inherit an `attr` block that only the charm path reads, so charming a Manager and charming a Guard produce wildly different characters
- [ ] **Q104** `src/data/talents.js:157` [inconsistency] `statusImmune` is honoured by the status runtime but missing from `TALENT_EFFECT_KEYS`, so the lint rejects the migration the review already recommends
- [ ] **Q105** `src/main.js:2857` [inconsistency] `applySurfaceOn` still refuses to apply turn-clock statuses out of combat, though the world clock now ticks them
- [ ] **Q106** `src/main.js:2857` [inconsistency] A surface's turn-clock status is still gated on `inCombat`, so fire only sets you alight in a fight — the gate outlived the reason for it
- [ ] **Q107** `src/party.js:50` [inconsistency] A member downed mid-fight earns no XP for the rest of that fight, contradicting the design's own "nobody lags"
- [x] **Q108** `src/statuses.js:182` [inconsistency] The step clock has no caller for AI units or wandering coworkers, so a gum wad is permanent on them — ARCHITECTURE.md's "the step clock ticks per tile walked, wherever you are" is false for half the actors<br>      ↳ DONE — the AI walk hook ticks it (Q2-A)
- [ ] **Q109** `src/floors.js:59` [soc] floors.js identifies stairs by the literal tile id 'stairway' although the tile def already carries a `stairs: true` flag
- [ ] **Q110** `src/floors.js:59` [soc] `floors.js` finds stair runs by hardcoded tile id `'stairway'` while `tiles.js` declares a `stairs: true` flag for exactly that purpose
- [ ] **Q111** `src/hover.js:202` [soc] Out of combat, an armed verb leaves every non-enemy target with no affordance at all — while the click still performs it
- [ ] **Q112** `src/ui/hud.js:319` [soc] The hotbar computes the ammo-affordability rule itself, never surfaces the reason, and does not disable the slot its own header says is disabled
- [ ] **Q113** `/home/user/escape-work/AI_PLAN.md:1018` [test-gap] AI_PLAN's "As landed" claims M2-M6 shipped "as specified" while every e2e spec those milestones name is absent
- [ ] **Q114** `AI_PLAN.md:1013` [test-gap] None of the six e2e specs AI_PLAN names for M1-M6 shipped, and the combat.js half of every new beat has zero coverage — while the doc records the milestones "as specified"
- [ ] **Q115** `playwright.config.js:6` [test-gap] playwright.config.js raises the per-test budget to 120 s but leaves expect.timeout at Playwright's 5 s default, which 52 of the 174 expect.poll sites rely on
- [x] **Q116** `src/ui/chrome.js:90` [test-gap] `ui/chrome.js` touches `window` at module scope, so every module importing `ui.js` — including `dialogue.js` and its exported pure rule — cannot be imported under node<br>      ↳ DONE — bound on first use; 11 modules unlocked
- [ ] **Q117** `tests/e2e/helpers.js:92` [test-gap] __combat.bout - the AI regression tripwire milestone 1 exists to provide - is read by no test, and the ?seed= lane that makes it reproducible is exercised by no test
- [ ] **Q118** `tests/e2e/summons.spec.js:45` [test-gap] The HR summon-cap assertion passes vacuously: it sleeps 1500 ms and asserts <= 2 without ever establishing that HR got another turn
- [ ] **Q119** `tests/unit/combat-ai.test.js:21` [test-gap] firingTileRoutes' self-tile walkability exemption is unasserted, because the test's fake world declares the unit's own tile walkable and the real one never does
- [ ] **Q120** `tests/unit/combat-ai.test.js:139` [test-gap] AI.W_PATH - "the baseline everything trades against" - is pinned by no assertion; the three "the cheap route wins" checks pass on fixture array order
- [ ] **Q121** `tests/unit/combat-ai.test.js:429` [test-gap] The lineWeights assertion compares the result against AI.STATUS_WEIGHT itself, so setting the knob to 1 disables the M6 status weighting with the suite still green
- [ ] **Q122** `tests/unit/combat-ai.test.js:123` [test-gap] scoreDestination's backstab term and slip term are never exercised - no test passes `facing` or `slipChanceAt`, so both weights can be zeroed with the suite green
- [ ] **Q123** `tests/unit/combat-ai.test.js:79` [test-gap] pickTarget's kill-securability and fragility terms mutually mask - neither is individually pinned, so the M2 kill term can be deleted with every test green
- [ ] **Q124** `tests/unit/combat-ai.test.js:239` [test-gap] The advanceRoute "not adjacent means nothing to spend on" test is tautological - its `approach` stub ignores the target, so the adjacency guard is never reached
- [ ] **Q125** `tests/unit/combat-plans.test.js:211` [test-gap] Five more branches of the new AI code survive mutation: the hazard and OA de-dup Sets, the firing-fan's nearest-first sort, aiEdgeTopplePlan's terrainOpen leg, and two aiSupportPlan guards
- [ ] **Q126** `tests/unit/levels.test.js:201` [test-gap] No lint requires `leavesTurns` alongside `leaves`, so the permanent-terrain bug can recur silently
- [ ] **Q127** `tests/unit/levels.test.js:435` [test-gap] The levels lint checks a tiered placement's char against the level's own tiles legend but not against the tile registry's canonical chars
- [ ] **Q128** `tests/unit/levels.test.js:25` [test-gap] `levels/dev/*.json` is registered, playable from the floor-select menu, and covered by none of the eight per-file level lints
- [x] **Q129** `tests/unit/pathfinding.test.js:283` [test-gap] Test asserts only that rounded-bend VERTICES are legal, never the legs between them - which is the property roundBends actually breaks<br>      ↳ DONE — three tests sample every LEG of a smoothed walk, not just its vertices

### LOW

- [x] **Q130** `src/combat.js:3834` [bug] **(carried)** `summonSpotProblem` never passes `room`, so the summon preview ignores the live cap and the click reports the wrong reason<br>      ↳ DONE — combat passes the live cap into the shared rule, as main.js always did
- [x] **Q131** `src/combat.js:1808` [bug] **(carried)** `notifyMemberDown` advances the turn without re-binding `active`, so the HUD reflects a corpse through the enemies' turns<br>      ↳ DONE — active rebinds to somebody standing before advanceTurn
- [x] **Q132** `src/pathfinding.js:166` [bug] **(carried)** clampToClearance's diagonal-corner repulsion is still edge-blind: bodies overlap partition end posts by ~0.23 tile<br>      ↳ DONE — the corner test consults the two FAR edges at each post; overlap 0.25 tile → 0.000, measured both ways
- [x] **Q133** `src/pathfinding.js:16` [bug] **(carried)** findPath has no explored-node cap and hangs on an unbounded or non-integer target<br>      ↳ DONE — MAX_EXPLORED cap; hang becomes a null. Unreachable via the shipped grid - kept because the cost is an integer compare and the failure it replaces is a frozen tab
- [x] **Q134** `src/stats.js:823` [bug] **(carried)** `stats.applyDamage` has no non-finite guard, while its actor-side twin `EnemyActor.takeDamage` does<br>      ↳ DONE — the same non-finite guard EnemyActor.takeDamage carries
- [x] **Q135** `src/statuses.js:113` [bug] **(carried)** `applyStatus` reads a missing `sev` as 0 while every other site reads it as 1, so a resisted re-apply weakens a pre-severity entry<br>      ↳ DONE — no-entry vs entry-without-sev distinguished; 3 tests
- [ ] **Q136** `src/looting.js:124` [dead-code] **(carried)** INV_CAP = Infinity leaves the overflow and "pockets full" branches in looting.js unreachable
- [ ] **Q137** `/home/user/escape-work/AI_PLAN.md:458` [doc-drift] **(carried)** AI_PLAN's state machine and footgun 8 both say the stall backstop burns real AP; the shipped backstop burns nothing
- [ ] **Q138** `/home/user/escape-work/AI_PLAN.md:9` [doc-drift] **(carried)** AI_PLAN.md still opens with "No code yet" while its own As-landed section reports six shipped milestones
- [ ] **Q139** `/home/user/escape-work/ARCHITECTURE.md:110` [doc-drift] **(carried)** ARCHITECTURE.md's `combat-plans.js` entry lists "take cover" as one of its plans; the take-cover plan was deleted
- [ ] **Q140** `/home/user/escape-work/REVIEW.md:187` [doc-drift] **(carried)** REVIEW.md says two modules are missing from the module map; seven are
- [ ] **Q141** `/home/user/escape-work/STATUS_PLAN.md:85` [doc-drift] **(carried)** STATUS_PLAN decision 9 still calls charm "designed but not shipped"
- [ ] **Q142** `src/data/companions.js:144` [doc-drift] **(carried)** The mail-room companion comment still names two actions that do not exist ('Return to Sender', 'the snack cart')
- [ ] **Q143** `src/main.js:142` [doc-drift] **(carried)** The new `?seed=` comment states a falsehood about the code, and the real determinism gap (the stream is never reset per fight) is recorded nowhere
- [ ] **Q144** `src/main.js:141` [doc-drift] **(carried)** This branch shipped a comment claiming the initiative rng is still unseeded and that member slips ride the seed - both are wrong, and the shipped code says the opposite two files over
- [ ] **Q145** `src/main.js:141` [doc-drift] **(carried)** The new seed comment names initiative as the reason a seeded fight does not replay, but initiative already rolls off the injected rng
- [ ] **Q146** `src/main.js:141` [doc-drift] **(carried)** The ?seed= comment names a rng gap that combat.js closed — initiative does roll off the injected stream
- [ ] **Q147** `src/combat.js:574` [duplication] **(carried)** combat.js's hazardKind and main.js's surfaceImpactKind order fire and electrification oppositely, and both disagree with step-rules.surfaceEffect's stated precedence
- [ ] **Q148** `src/main.js:1541` [duplication] **(carried)** attackOrConfront carries a hand-written a.type ladder that verbKind was made the single owner of
- [ ] **Q149** `src/ui/hud.js:390` [duplication] **(carried)** `fmtAp` now exists twice — the party-bar fix added a second copy instead of consuming the existing one
- [ ] **Q150** `src/combat.js:5066` [inconsistency] **(carried)** `spendAp` subtracts raw - a fourth site of the float-AP bug the other three were fixed for
- [ ] **Q151** `src/ui/hud.js:482` [perf] **(carried)** `levelUpPip.refresh` writes `textContent` and `style` every frame while points are banked
- [ ] **Q152** `src/ui/readouts.js:128` [perf] **(carried)** `setFocusBanner` tears down and rebuilds its DOM on every hover call
- [ ] **Q153** `src/combat.js:1990` [soc] **(carried)** Content ids still special-cased in systems code: projectile model, impact kind, and the surface-to-FX map
- [ ] **Q154** `src/combat.js:3834` [soc] **(carried)** Combat's summon ladder never supplies `room`, so the shared rule's headcount leg is skipped in a fight — and resolveSummon re-derives the cap math the module owns
- [ ] **Q155** `src/combat.js:4829` [soc] **(carried)** The `window.__combat` / `__game` / `__god` debug surfaces are ~420 lines living inside the two god closures, and `__game.classes` hands out the live registry
- [ ] **Q156** `tests/e2e/camera.spec.js:195` [test-gap] **(carried)** camera.spec.js still skips its steered-camera leg on a dice roll, although this branch shipped the seeded-initiative lever the review asked for
- [ ] **Q157** `tests/e2e/hit.spec.js:44` [test-gap] **(carried)** Six e2e sleeps wait for "camera settle" while helpers.js exports stableProject, which polls that exact condition
- [ ] **Q158** `tests/unit/actors.test.js:1` [test-gap] **(carried)** GridActor.update - the waypoint stepping and onTile tile-change detection that drives exits, surface damage and the AI's own notifyStep - has no test, though it runs headless with a six-method stub
- [ ] **Q159** `src/combat.js:1785` [bug] `makeActive` writes an out-of-range `party.active` while a charmed coworker holds the floor
- [ ] **Q160** `src/combat.js:631` [bug] `guardStandingAt` has no side test, so an enemy holding Hold the Line shields a party member and vice versa
- [ ] **Q161** `src/combat.js:341` [bug] billMove rounds the free-AP deduction, so a 0.05-cost move never depletes the freeMoveAp allowance
- [ ] **Q162** `src/creation.js:171` [bug] createCharacter banks a point per spend but spendAttrPoint silently refuses unknown attribute names, leaving free points on the sheet
- [ ] **Q163** `src/editor.js:595` [bug] The editor's localStorage writes are unguarded, so in a storage-blocked browser "Exit editor" cannot exit
- [ ] **Q164** `src/editor.js:400` [bug] Any editor resize button silently deletes every row/column past MAX_SIZE on a level larger than 40
- [ ] **Q165** `src/main.js:1473` [bug] `examineTile` calls any tile with a body standing on it "a cubicle wall"
- [ ] **Q166** `src/shading.js:294` [bug] `makeSpriteMaterial` has no failed-texture fallback, so a missing foliage PNG renders as a solid tinted rectangle
- [ ] **Q167** `src/statuses.js:163` [bug] A status id that leaves the registry is immortal on an existing save: never ticked, never expired, invisible to both sweep options
- [ ] **Q168** `src/statuses.js:107` [bug] `applyStatus` returns true for a non-finite duration and leaves an entry no clock can ever reach
- [ ] **Q169** `src/combat-geometry.js:176` [dead-code] edgeShieldedTile is dead and encodes a cover rule the game no longer uses
- [ ] **Q170** `src/combat.js:3568` [dead-code] The purge self-cast branch in `handleTileClick` is unreachable dead code
- [ ] **Q171** `src/combat.js:3811` [dead-code] `commitInstant`'s heal arm and `INSTANT_CONFIRM`'s 'heal' entry are dead - no `type: 'heal'` action exists
- [ ] **Q172** `src/data/actions.js:13` [dead-code] `type: 'heal'` is dead in three code sites and still documented as a live verb in the action registry header
- [ ] **Q173** `src/data/surfaces.js:87` [dead-code] `GUM` in data/surfaces.js is now an unimported export whose numbers are hand-mirrored into the `gum` status
- [ ] **Q174** `src/data/surfaces.js:87` [dead-code] `GUM` is exported from data/surfaces.js and read by nothing — a dead second source of truth for the gum numbers
- [ ] **Q175** `src/stats.js:129` [dead-code] Three of the five `STEALTH` constants in stats.js are read by nothing; the real values live in data/statuses.js and data/talents.js
- [ ] **Q176** `src/statuses.js:184` [dead-code] `clearStatuses`'s `clock` and `harmfulOnly` options have no production caller, and the doc above them describes a combat-end sweep that no longer exists
- [ ] **Q177** `src/ui/creation.js:277` [dead-code] `ui/creation.js` imports `draftName` and never calls it — the summary re-derives the display name by hand
- [ ] **Q178** `src/ui/hud.js:486` [dead-code] `createTacticalButton().setVisible` and `createLevelUpPip().setVisible` have no callers anywhere
- [ ] **Q179** `.github/workflows/ci.yml:83` [doc-drift] CI's `[quick]` lever is inert on every branch, the exact defect the same file documents as forced-fixed for `[e2e]`
- [ ] **Q180** `/home/user/escape-work/AI_PLAN.md:629` [doc-drift] AI_PLAN's architecture section places `entrenchPlan`, `shootPlan` and `supportPlan` in `combat-plans.js`; none of the three exists there
- [ ] **Q181** `/home/user/escape-work/AI_PLAN.md:136` [doc-drift] AI_PLAN's file:line citations are stale throughout, including the "Do not touch" list and the Brief that milestone 7's executor is told to follow
- [ ] **Q182** `/home/user/escape-work/AI_PLAN.md:202` [doc-drift] Three `[ratified]` tags in AI_PLAN cite nothing, and the twelve-arm ladder order — the doc's declared centerpiece — carries no tag at all
- [ ] **Q183** `/home/user/escape-work/AI_PLAN.md:483` [doc-drift] AI_PLAN's published `AI` tunables block and scored-choice signatures do not match the shipped ones
- [ ] **Q184** `/home/user/escape-work/POWERS_PLAN.md:735` [doc-drift] POWERS_PLAN's "Open after M9: the enemy HR Representative" still says the support-enemy option is blocked by risk 7; AI_PLAN M6 shipped it
- [ ] **Q185** `/home/user/escape-work/src/data/enemies.js:3` [doc-drift] `data/enemies.js`'s header still says attack lines are "picked at random each enemy turn"
- [ ] **Q186** `TODO.md:733` [doc-drift] TODO.md's open "Collapse the two action bars" item describes code that no longer exists, and contradicts the DONE item above it
- [ ] **Q187** `src/combat.js:4343` [doc-drift] `bout.oaCount` counts both sides' opportunity attacks, not "enemies' own provokes" as M3's acceptance reads it
- [ ] **Q188** `src/data/actions.js:13` [doc-drift] data/actions.js documents a `heal` action type nothing uses and omits four types that exist; three dead `heal` branches remain in code
- [ ] **Q189** `src/data/statuses.js:193` [doc-drift] The take-cover status's doc block is stranded above `sneaking`, so `covered` is undocumented and `sneaking` wears two comments
- [ ] **Q190** `src/main.js:1514` [doc-drift] `oocFriendlyOn`'s header promises it spends the action's `uses`; the body spends nothing
- [ ] **Q191** `src/shop.js:17` [doc-drift] shop.js names `matches` and `half-sandwich` as the items worth nothing; both carry a `value` and one is stocked by a merchant
- [ ] **Q192** `src/stats.js:423` [doc-drift] `weaponProc`'s doc comment sits above `moveCostOf`, so both functions are misdocumented
- [ ] **Q193** `src/ui/hud.js:32` [doc-drift] The HUD status chip drops the remaining count its own comment and data/statuses.js both promise
- [ ] **Q194** `src/ui/hud.js:490` [doc-drift] Two doc comments left stranded by the `ui/` split describe functions that live in other files
- [ ] **Q195** `src/ui/panels.js:344` [doc-drift] The shop view's documented shape omits `id`, the field the sell button's own guard depends on
- [ ] **Q196** `src/combat-geometry.js:25` [duplication] `cheb` is defined twice, in tactics.js and combat-geometry.js, both exported
- [ ] **Q197** `src/combat-geometry.js:25` [duplication] cheb is defined and exported twice, from tactics.js and combat-geometry.js, with its own test in each suite
- [ ] **Q198** `src/combat-geometry.js:37` [duplication] The four/eight-neighbour offset arrays are declared in seven places under five names
- [x] **Q199** `src/combat.js:2699` [duplication] `aiShoveMember` duplicates `displaceBody`'s slam literal and silently drops the stun the player's identical slam applies<br>      ↳ DONE — merged into displaceBody behind victimView (Q4-A)
- [ ] **Q200** `src/combat.js:761` [duplication] combat.js re-implements tactics.facesShieldFrom as a private shieldingFaceFrom
- [ ] **Q201** `src/combat.js:2421` [duplication] "Name the thing covering you" exists three times, twice inside combat.js, with different formatting
- [ ] **Q202** `src/combat.js:2171` [duplication] "Is a living member standing here?" is written six times inside combat.js in three shapes
- [ ] **Q203** `src/main.js:3487` [duplication] `ORTHO4` is declared and then re-inlined as a literal 977 lines later
- [ ] **Q204** `src/main.js:152` [duplication] mulberry32's mixer is now implemented twice — a new copy in main.js beside the existing one in combat.js
- [ ] **Q205** `src/main.js:667` [duplication] "Whose sheet am I steering?" is written four ways in main.js, while the actor half has a single named owner
- [ ] **Q206** `src/main.js:2472` [duplication] The "who joins this fight" filter is written three times in main.js, one of them commented as a copy
- [ ] **Q207** `src/main.js:2495` [duplication] The cone's "don't carpet a teammate" guard is spelled two ways, and the out-of-combat one misses summons
- [ ] **Q208** `src/main.js:1940` [duplication] liveSummonsOf exists in two modules counting two different populations
- [ ] **Q209** `src/stealth.js:13` [duplication] `stealth.facingFromYaw` has no production importer, and main.js re-implements it inline in the one place that needs it
- [ ] **Q210** `src/ui/screens.js:64` [duplication] The four attributes' labels and blurbs are written out three times across `ui/`, and only one copy derives its key list from `ATTR_KEYS`
- [ ] **Q211** `src/combat.js:4444` [inconsistency] The destination scorer asks aiCrouchCovered without the bodyAt test the crouch beat supplies, so it scores tiles by a narrower cover rule than the one it will find on arrival
- [ ] **Q212** `src/data/statuses.js:212` [inconsistency] `fx.burst: 'none'` is not in the runtime's vocabulary — it falls through to the loudest burst ('pop')
- [ ] **Q213** `src/god.js:104` [inconsistency] God-mode pins write raw, bypassing the setter the edit path deliberately routes through
- [ ] **Q214** `src/hotbar-model.js:89` [inconsistency] `combatOnlyReason` gives a factually wrong refusal for six verb types and returns "usable" for an unknown action id
- [ ] **Q215** `src/main.js:2629` [inconsistency] Out-of-combat Take Cover accepts a tile a summon occupies; combat refuses the same tile
- [ ] **Q216** `src/main.js:3486` [inconsistency] The shove aim ring promises a partition topple the click silently refuses
- [ ] **Q217** `src/stats.js:517` [inconsistency] `take-cover` and `pull` land in the class-powers bucket, unlike the third universal verb `shove`
- [ ] **Q218** `src/ui/hud.js:430` [inconsistency] The party-bar HP bar neither clamps nor divide-guards its width, while the profile card two hundred lines above does both
- [ ] **Q219** `src/grid.js:159` [other] doorKeyBetween and wallEdgeOpen silently answer a diagonal pair with an x-axis edge instead of refusing it
- [ ] **Q220** `src/looting.js:330` [soc] The Alt-overlay loot icon table is a hardcoded content list in systems code, and it has already drifted — break-room containers get the generic box
- [ ] **Q221** `src/scene.js:172` [soc] `updateWallFade` restores un-ghosted walls to the hardcoded `tileMats.wall`, not the material the tile was drawn with
- [ ] **Q222** `playwright.config.js:45` [test-gap] Playwright reuses an existing server on port 8173, so a locally-running stale build is tested and never rebuilt
- [x] **Q223** `tests/unit/combat-ai.test.js:1` [test-gap] src/dialogue.js exports nodeOptions as a deliberately pure rule and has no unit test, because a top-level `import * as ui` makes the module unimportable under node<br>      ↳ DONE — dialogue.test.js, 6 tests
- [x] **Q224** `tests/unit/floors.test.js:97` [test-gap] floors.test.js's facade test exercises 3 of 21 forwarded members, so the missing methods are unpinned<br>      ↳ DONE — the contract test derives the set from a real grid
- [ ] **Q225** `tests/unit/hit.test.js:48` [test-gap] hit.test.js - the seeded roll->damage->status test - contains an assertion that cannot fail, a self-comparison, and a hand-copy of combat.js's private damage formula
- [ ] **Q226** `tests/unit/levels.test.js:192` [test-gap] The orphaned-action lint counts any `ammoCost` action as reachable, ignoring `universal: false`
- [ ] **Q227** `tests/unit/levels.test.js:207` [test-gap] The registry lint gained no checks for the two AI fields this branch added to enemies.js - `focus` and the `support` descriptor - although the same file lints the equivalent shape for tile topple damage

---

### Fix notes for the high findings

The detail behind the HIGH entries above - what breaks and the shape of the
fix. Deliberately NOT checkboxes: it was a second worklist for a while, which
is how a queue turns back into prose. Tick things in THE QUEUE; read the
reasoning here. Numbering is the old tier order, not the Qnnn ids.

### Tier 1 — player-visible, and small

The whole tier is a day's work and every item is reachable in ordinary play.

- **1. HR's reinforcements spawn for free.** `combat.js:4633`.
  `resolveSummon` *spawns* — it calls `world.spawnSummon`, pushes into
  `engaged`, inserts initiative slots — and it is called as a readiness
  predicate. Survivable until AI M6 put `support` above `summon` in the ladder;
  now, whenever HR has a wounded colleague, the two employees spawn, the *heal*
  is billed, and `summonCd` is never set. **A regression this branch
  introduced.** Fix: a `canSummon(unit, sm)` twin that computes
  `(d.cap ?? d.count) - liveSummonsOf(summoner) > 0` and nothing else; the
  spawning call stays inside the `beat === 'summon'` arm.

- **2. Equip/unequip is a free unlimited heal.** `stats.js:806`.
  `equipItem` credits the max-HP delta (`creditNewHp`); `unequipItem` only
  clamps. Reproduced end to end with the shipped `okayest-mug`: 5/22 → 17/22 in
  six cycles, out of combat, repeatable to full. Fix: make unequip the inverse —
  capture `maxHpBefore` and debit the same delta, floored at 1.

- **3. Sneaking survives a floor transition and makes the next floor
  uncontestable.** `main.js:2018` `[critic]`. `sneak` is closure state that dies
  with the level; the `sneaking` *status* is serialized into the campaign save.
  The next floor boots with `sneak === null` and the leader still wearing it —
  `endSneak` early-returns on `!sneak`, so nothing can clear it, and it
  suppresses fight triggers. Fix: strip held-mode statuses on serialize, the way
  `normalizeSheet` already drops a retired `rig`/`look`.

- **4. A refused click costs you your cover for free.** `combat.js:3514`.
  `breakCrouch(active)` is the *first* statement in `walkActive`, which then
  returns null on a degenerate route — nothing walked, no AP spent, a refusal
  printed, and the crouch gone. The hover twin `previewWalk` deliberately does
  not break it, so the same arithmetic is safe to look at and destructive to
  click. Fix: move the break below the `points.length < 2 || cost < 0.05` guard,
  next to `beginMove` — which is what the comment above it already claims.

- **5. Every enemy Grit save uses the fallback.** `combat.js:2591`. Both
  AI-side saves read `en.def.grit`; no registry entry defines it, and the two
  class-backed enemies carry it as `attr.grit` (Guard 7, HR 5). So
  `gritSaveChance(2)` = 0.37 runs 100% of the time — the Guard fails a Pull Over
  save 63% of the time instead of 33%. The data exists and is read through the
  wrong path. Fix: a `grit` passthrough in `stats.unitCombat` beside
  `accuracy`/`dodge`/`reach`.

- **6. Your own charmed ally opportunity-attacks you.** `combat.js:4257`.
  `threatsAgainst` still derives the threatening side from raw `engaged`, which
  keeps a charmed coworker deliberately. The same one-line `aiAllies()`
  substitution `aiAdvance` and `aiSupportPlan` already got. **Same fix applies at
  `combat.js:476`**, where `attackMods` builds the attacker's pincer list from
  `engaged` — so a charmed coworker completes the *enemy's* flank.

- **7. The stun FX fires when the stun was blocked.** `combat.js:2280`.
  `dropOnto` writes the rule twice; the enemy branch gates `statusFxAt` on
  `applyStatus` and narrates the refusal, the member branch does neither. Inside
  a `training-credit` window the second stun is refused and the game plays the
  burst anyway, silently. Fix: one `landStun(victim, source)` helper, called from
  `dropOnto`'s two branches and `aiPullMember`. *(The `displaceBody` copy of this
  was fixed by the Q4-A merge; these three sites were not.)*

### Tier 2 — structural unlocks

Each buys back a whole class of future finding. Do these before the god-method
work, not after.

- **8. One line locks 1,613 lines out of node.** `ui/chrome.js:90` registers
  a resize listener at module scope. `ui.js` is the barrel every UI consumer
  imports, so the throw cascades to all of `ui/` **and** to `doors.js`,
  `dialogue.js` and `shopping.js` — the three modules TODO.md Phase 5 holds up
  as successfully carved onto host-callback seams. A one-line `globalThis.window`
  stub makes all eight import cleanly, which is the proof the seam is real and
  merely unreachable. Fix: move the registration inside a `mountChrome()` behind
  a bound flag, exactly as `actionDock()` already defers its `createElement`.

- **9. A world-facade contract test.** `combat-plans.js:54`. The pure modules
  take a parameter literally named `world` that is combat's host facade —
  duck-typed, so a unit test structurally cannot check it. This is the class of
  **both** bugs this branch shipped (`aiShovePlan` handed a facade with no
  `occupied`), and item 10 below is a third instance. Fix: build the object
  `main.js` passes as `world` from a headless fake and assert every key the pure
  modules destructure exists and is callable.

- **10. Sneaking on a layered level throws.** `floors.js:147` `[critic]`.
  `layeredGrid`'s forwarded `METHODS` list omits `sightOpenCellLow` and
  `sightOpenLow`, which the sneak cone sweep calls — reproduced as a live
  `TypeError`. The facade test (`floors.test.js:97`) exercises 3 of 21 forwarded
  members, so the omission was unpinned. Fix with item 9, or at minimum assert
  the full forwarded set.

- **11. The enemy ranged kit has zero e2e coverage.** `tests/e2e/helpers.js:92`.
  Of 44 arenas, 42 place `manager` and one places `hr`. `executive` — the game's
  only ranged enemy, the whole point of AI M5 — and `security-guard` appear in
  **no arena at all**. Break the enemy shot (delete the `hasLos` conjunct at
  `combat.js:4694`) and every suite stays green. Fix: one bespoke arena with
  `E: 'executive'`, and the entrenched-shooter bout AI_PLAN.md:943 already
  specifies.

- **12. The AI's `perform` half has no test at any level.**
  `tests/unit/combat-ai.test.js:1`. The branch split the AI into a pure decide
  half (well tested) and a doing half that stayed inside `startCombat`'s closure:
  `aiShoot`, `tryAiCrouch`, `aiSupport`, `aiPullMember`, `aiBreak`,
  `rangedLines`, `aiAllies`, the support ration, the refused-set lifecycle.
  Re-introduce the `d8c6e6c` facade crash and `npm test` stays green. Largely
  bought by items 9 and 17.

### Tier 3 — the anti-stall pair

These two are one defect from two directions. Fixing either alone leaves the
fight stallable, so treat them as a single unit of work.

- **13. The engageability tier admits members the unit cannot hit.**
  `combat-ai.js:97` `[critic]`. `standTilePath`/`standTileRoutes` accept any
  walkable neighbour with a route and never ask whether a swing *from that
  neighbour* is legal (`inReach` + `stepOpen`). The player-side twin
  `combat-geometry.swingPointAt` does ask. `combat.js:256` builds `canEngage`
  from `standTilePath`, so the hard tier that exists precisely so a unit never
  "walks to the wall and swings at nothing, every turn, forever" is computed by
  a test blind to that case. Reproduced on a dead-end bay sealed by a partition.

- **14. A blocked shooter burns every turn.** `combat-ai.js:157`.
  `firingTileRoutes` short-circuits to the degenerate self-route the moment the
  shooter's own tile is in range with LOS — an *absolute* priority borrowed from
  the melee field, where it is the pacing-bug fix. It does not transfer: a shot
  refused for a reason that is not range or LOS (an object shield, a colleague in
  the redirect) leaves the Executive with no beat at all. AI_PLAN M5 claims the
  shooter "repositions by LOS/shield/keep-away"; the short-circuit means it
  cannot. Fix: make the self-tile a scored *candidate*, not a short-circuit, and
  add a shot-blocked term to the firing-tile score.

### Tier 4 — the god methods, now unblocked

`verbSides` (2026-08-02) was the prerequisite for both. The ~40 closure
dependencies the view block carries were mostly the verb-query surface; with one
owner, the carve is tractable.

- **15. `drawTargets` is a 321-line renderer.** `combat.js:1384`. Thirteen
  verb-specific drawing rules and mutable animation state in one function. Its
  third verb-dispatch ladder is already collapsed onto `verbSides`; what remains
  is the split into one small `draw<Kind>Rings(...)` per arm, and moving
  `coverEase` into the frame driver where the other per-frame state lives.

- **16. `update(dt)` is a 278-line per-frame god method.** `combat.js:4530`.
  Eight unrelated responsibilities, including ~90 lines of AI plan-gathering.
  To assert "a summoner at 1 AP with a maxed roster falls through to the attack
  beat" a test must construct `acting`, `bout`, `crouched`, `facings`,
  `watching`, `aiTargets`, `refused`, a live PlayCanvas app *and* the whole world
  facade. Fix: `gatherBeatState(unit, target)` as a pure function over injected
  leaf queries (this is item 17), leaving `update` as the frame pump.

- **17. `gatherBeatState` extraction.** The ~60 lines inside `update` that
  assemble `beatState` from 14 closure reads. Independent of 15 and 16 and worth
  doing first of the three — it is what makes the AI ladder testable, which is
  where both bugs this branch shipped actually lived.

### Tier 5 — real, but not on the critical path

- **18. Setting a cloud save key destroys the run it points at.**
  `main.js:252`. The key is documented as "how a run follows its owner across
  machines", but setting one never pulls; local always wins, and the next floor
  clear upserts over the cloud row. Either order of operations loses the other
  machine's run. Fix: pull under the NEW identity before deciding what to boot,
  and offer both saves as an explicit choice.

- **19. Editor char allocations leak across `loadLevel`.** `editor.js:301`.
  `tileByChar`/`charByType` are allocated once per session and never reset, while
  `tierChars` is rebuilt per load and its reservation happens *after* a tile type
  may already own the char. Paint with `ficus` (char `G`), load `level2` (which
  declares `"G": "manager@3"`), and the brushes collide. Fix: reset both maps at
  the top of `loadLevel`, re-seeding `floor` first.

- **20. `clearProgress()` is the last unguarded localStorage write.**
  `main.js:161`. Every other touch in the codebase is wrapped; this one runs
  after `gameOver = true` and before the lose screen, and again in the Restart-run
  action. In a storage-blocked browser the throw eats the lose screen and the
  restart escape with it. Fix: try/catch, with `remote.clear()` outside it.

**Also high, and already tracked before this pass:** unescaped player names
reaching `innerHTML` on four surfaces (`ui/hud.js:96`) — materially worse now
that the save round-trips through a shared cloud store; and the in-combat
crosshair promising a swing the click turns into an in-place shuffle
(`main.js:3063`), because the hover consults `picking.pick` first while the click
resolves the acting actor's own tile first.

### Closed 2026-08-02

- ~~The armed HR buff resolving on a coworker~~ — Q3-A: the click asks
  `verbSides(a, range).enemies` instead of "does it carry a payload".
- ~~Pull Over drawing no rings~~ — `ringsAtBodies` is derived from `verbKind`.
- ~~`aiShoveMember` billing raw surface damage to a member~~ — Q1-A:
  `world.memberSurfDamage`.
- ~~`aiShoveMember` as a second shove resolver~~ — Q4-A: merged into
  `displaceBody` behind a `victimView` adapter.

---
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

- [x] ~~**Fix the combat soft-lock**~~ — done, and by a better route than this
      entry specified. `combat-targeting.verbKind` is now the ONE classifier
      both the rings and the click dispatch on, so an armed buff/mobility can
      no longer reach the melee fall-through at all (rather than being guarded
      out of it at one call site); `actors.js:430` clamps a non-finite
      `takeDamage` to a visible no-op.
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
- [x] **Enemy AI paces between two tiles instead of attacking** — **FIXED, and
      this entry was stale.** It cited `combat.js:96` and called the self-tile
      exemption dead code. `standTilePath` moved to `combat-ai.js:97` when the
      AI was carved out, the exemption is very much alive - it returns the
      degenerate self-path `[[gx,gz],[gx,gz]]`, which is what hands the advance
      its in-place shuffle branch - and `combat-ai.js` carries the pacing bug's
      account in its own header. It is unit-tested (`combat-ai.test.js`, the
      anti-stall block), which is why "port the `routeBeside` special case" was
      already done by the time anyone read this.
      **What IS still true nearby**, and is queued separately: the self-path
      keeps absolute priority, and until 2026-08-02 it did so without asking
      whether a swing from that tile could legally land - so the tier admitted
      members the unit provably could not hit. That is now `canSwingFrom`.
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

- [x] **DONE.** Per-tile step rules unified in `step-rules.js` — the floor
      arrives as a fact sheet (`{ burning, electrified, surfaceId }`) and the
      slip roll arrives as an argument, so combat runs it through its seeded
      rng. main.js, combat.js and actors.js all call it; the wander facade
      hands out the CHANCE now, not a pre-rolled verdict.
- [x] **DONE.** `combat.js` carved at the documented seams:
      `combat-geometry.js` (reach, the two range vocabularies, stand points,
      zone cells), `combat-plans.js` (the plan half of every plan/perform
      pair), `combat-ai.js` (target choice, routing, and `chooseBeat` — the
      turn's ladder of beats, lifted out of the frame driver),
      `combat-targeting.js` (what the rings promise, plus `verbKind`),
      `ui/combat.js` (the readout, as a dumb view).
      **Watch for:** `verbKind` is now the ONE answer to "which branch does
      this verb take". A new verb adds an arm there, and the rings and the
      click both get it; adding an `a.type` test to either one alone is how
      the drift it fixed started.
- [x] **DONE.** `main.js` carved: `doors.js` + `door-edges.js`,
      `hotbar-model.js`, `dialogue.js`, `summon-rules.js` — each on the
      `shopping.js` host-callback pattern, each with its rules split out pure.
      Still in the closure and still worth a look later: the input block
      (~585 lines) and the follower/step driver.
- [ ] **Carve the debug surface** (`window.__combat`, `window.__game`) out of
      both closures — the last of the original main.js carve list.
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
- [x] **DONE, and it was already done in the code** — `standTilePath` had
      grown its own copy of the special case. Both now live in
      `combat-ai.standTilePath` with the reasoning attached, and a unit test
      pins the degenerate self-path that stops adjacent units shuffling
      between two tiles forever.
- [ ] *Checked, genuinely not duplication — leave alone:* `initiative.js` vs
      `turn-order.js` (the latter imports the former; "what is the order?" vs
      "whose turn is it?"), `shop.js` vs `shopping.js` (the pure/runtime split
      `looting.js` is supposed to copy), and `ui.js` vs `ui/` (a re-export
      barrel).
- [ ] **Content-is-data fixes**: `matches` → item `ignites` field
      (`main.js:715`); projectile/impact → action data fields
      (`combat.js:1296`, `:1323` — three id-special-cases since `e8e53de`);
      surface `impact` field to delete `hazardKind`/`surfaceImpactKind`
      (`combat.js`/`main.js` — both now read `step-rules.js`, so this is one
      field on the surface def away); `paperCutImmune` →
      `statusImmune: ['bleed']` (`statuses.js:64`); exit beacon keyed on
      `onEnter.effect` (`scene.js:65`); harvest/icon/footprint fields on data
      entries (`looting.js:59`, `:309`, `fx.js:634`); item verbs from data,
      not `heal||ammo` sniffing in panels (`ui/panels.js:165`).
- [x] ~~Gate `god.js` behind a dev flag~~ — **not doing it.** `[stated]`
      (designer, 2026-07-31): "god mode can stay around". It ships on the
      itch.io build, opens on backquote/F8, and persists across reloads.
      Closed as answered, not as done.
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

## Phase 8 — Charm / Dominate — SHIPPED (one leg still open)

**This section was stale and is corrected here.** It was headed BLOCKED with six
unticked boxes long after charm shipped - `turns.replace` (`turn-order.js:311`)
is the slot re-teaming the blocker below says does not exist, and five of the six
legs are live in the code. Left in place rather than rewritten, because the
account of what was learned is still worth reading; the boxes now say what is
actually true.

The account below describes the FIRST attempt, which was backed out. What was
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
- [x] `turn-order.js` grows slot removal, or slot re-teaming — moving a slot
      between `player` and `enemy` while preserving its initiative roll, so a
      borrowed unit acts once per round on its own roll, on your side.
      **DONE** — `turns.replace` (`turn-order.js:311`), swapping the slot in
      place so the same body acts at the same moment; only whose it is changes.
- [x] `expireSummon` splits: a summon is DESTROYED at the end of its lifetime,
      a borrowed coworker is RETURNED. **DONE** — `releaseCharm`
      (`combat.js:170`), called from the lapse (`:4015`) and the fight's end
      (`:1972`). They share a clock and must not share an
      ending. (Sharing `summonTurns` is otherwise right — one clock, nothing to
      keep in step.)
- [x] An enemy def is not a class block: it carries `attacks` (inline damage
      rolls the AI reads) where a sheet needs `actions` (ids the bar renders).
      A borrowed body was given the universal verbs (`punch`, `shove`), which is
      defensible — you are driving somebody you do not know — but it is a design
      decision that should be made deliberately rather than inherited from a
      shape mismatch. **DONE, and made deliberately** — `charmUnit` synthesises
      `actions: ['punch', 'shove']` with the reasoning written at the site.
- [x] `livingParty` must exclude the borrowed, or a wiped party stays "alive"
      while you drive somebody else's body. **DONE** — `!m.isSummon &&
      !m.isCharmed`.
- [ ] Release on all three paths: lapse, victory, and **death mid-session**.
      Two of three are live (`combat.js:4015`, `:1972`); the DEATH path is the
      one still missing, and it is the residual defect behind the finding this
      review first mis-filed as a critical soft-lock. It is not a soft-lock -
      the body stays clickable and re-killable and `victory()` fires normally -
      but a toppled corpse that is secretly a full-HP hostile, drawing no target
      ring, is a real medium. See THE QUEUE.
- [ ] Edges to pin: charm the last living hostile; charm a unit that is itself
      a summon; charm a unit holding overwatch; save/load mid-charm.
