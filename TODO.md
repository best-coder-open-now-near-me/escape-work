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

## Questions for the designer

Both questions raised on 2026-08-03 are ANSWERED (designer, 2026-08-03) and
both are closed out below. Nothing here is waiting on anyone.

**1. Two saves, one desk: which run wins? (Q017) — ANSWERED: option A.**

`[ratified]` — designer, 2026-08-03: *"the recommended option A is fine for
persistence"*. Offer both, let the player pick. Implemented and ticked in the
queue: the cloud pull always runs, the cloud offer carries its own button id
(`level-continue-cloud`), and each run's sub-label names its floor and its age
so two Continues can be told apart. Nothing is destroyed by showing them; the
cloud offer says in its own sub-label that taking it replaces this browser's
run, because banking it is what overwrites the local save and that is now the
player's explicit choice rather than a silent one.

**2. The Executive now shoves you off and shoots. (Q047) — ACKNOWLEDGED.**

`[ratified]` — designer, 2026-08-03: *"acknowledged on the other executive
point as well"*. A4's ratified carve-out ("a RANGED unit may shove to
disengage") was implemented, unit-tested, described in the ladder's own
comment, and never wired; it is wired now, so an Executive in contact pushes
off and fires rather than trading punches in the scrum. Doctrine #11 working
as written. Left as shipped. If it ever reads as slippery rather than smart
that is a re-open of A4, not a bug, and the one-line gate is easy to remove.

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

**228 entries** — 24 high / 106 medium / 98 low. **131 ticked, 97 open**
(high **24/24 — the band is clear**, medium 56/106, low 51/98).

**Zero `[bug]` findings are open.** All 13 that remained were closed on
2026-08-03; what is left is 22 test-gap and 76 cleanup (duplication,
inconsistency, doc-drift, soc / dead-code / god-method / design). Nothing on
this list is currently known to misbehave in the played game.

**Every HIGH finding is closed, and no `[bug]` is open at any severity.** What
remains is 21 test-gap and 76 cleanup, all medium or low.

*A caution for whoever reads that as "the review is nearly done": the count is
of FINDINGS, not of work. The three biggest things on the list — `startCombat`
and `startGame` (Q037/Q042/Q039) and the `drawTargets` body pass (Q901) — are
one line each here and are each larger than most of the rows above them.*

*Counted from the boxes rather than carried forward, 2026-08-03. This line had
said "227 standing … 31 ticked" for several passes while the boxes below said
115 — the queue's own tally had become the prose it exists to replace. It is
228 not 227 because Q003's second clause was re-queued as Q902. Recount before
quoting it: `grep -c '^- \[x\] \*\*Q' TODO.md`.*


### HIGH

- [x] **Q001** `src/floors.js:147` [bug] **(carried)** layeredGrid's forwarded METHODS list omits sightOpenCellLow/sightOpenLow — reproduced as a TypeError<br>      ↳ DONE — forwarded, plus a derived contract test
- [x] **Q002** `src/ui/hud.js:96` [bug] **(carried)** Player-typed names still go raw into `innerHTML` on four surfaces — and the save now round-trips through a shared cloud store<br>      ↳ DONE — esc() moved to chrome.js; 4 sites
- [x] **Q003** `src/combat.js:4530` [god-method] **(carried)** `combat.js update(dt)` is a 278-line per-frame god method holding eight unrelated responsibilities — the AI turn loop cannot be tested without a browser<br>      ↳ **PARTLY DONE — 328 → 40 lines.** (278 was the count when the finding was written; it had grown since.) Nine pieces named: `retireStaleMoveStarts` (6), `finishWalkUpStrike` (33), `finishWalkUpCrouch` (17), `aiBeatPlans` (115, the gather), `takeBeat` (83, the act, pass beat included), and the four beat doers that were inline in the ladder and now sit with their five siblings - `aiSummon`, `aiTopple`, `aiShove`, `aiOpenOrBreak`. The head reads gather → decide → act. **Still open, and it is the second clause, not the first:** every piece is still inside the `startCombat` closure, so none of it is reachable from node. That is not more cutting - it is the world facade, Q041. Re-queued as Q902.
- [x] **Q004** `src/combat.js:2713` [soc] **(carried)** `aiShoveMember` bills a party member RAW surface damage via the enemy hazard model, silently voiding the talent immunities that main.js applies to the same tile<br>      ↳ DONE — world.memberSurfDamage (Q1-A)
- [x] **Q005** `tests/unit/combat-ai.test.js:1` [test-gap] **(carried)** Every AI *perform* half added by this branch lives in combat.js and has no test at any level - both AI bugs that shipped on this branch were in exactly that layer, and neither landed with a regression test<br>      ↳ **Measured 2026-08-03, while splitting `update(dt)`** - the halves are named now, which is the part a test needs, but they are still closure-bound (Q902). The gap is not uniform, and this is the work list: **no coverage at any level** for the `support` arm (no arena ever wounds HR or a colleague below the heal threshold, so `aiSupportPlan` returns null and the arm is never reached), both `topple` arms (every 'puts a shoulder into' assertion in the suite is the PLAYER's), `shove` (same - the three shove specs are all player-side), and `entrench` (it needs the Executive, who appears in exactly one arena in the whole suite, a bare two-row corridor with no shielded face). **Strong** on `summon`, `pull`, `break`-the-door, `attack`, `shoot` and `crouch`; **incidental only** on `break`-by-battering (cover.spec.js's boxed Manager batters a filing cabinet on his way to the assertion, which is not the same as a test that would notice if he stopped). The player half is the same shape: the walk-up strike and walk-up crouch ARRIVALS are strongly covered, and not one of their five refusal branches is - including 'Not enough AP left', which is also the branch most likely to be quietly wrong, since the walk reserves the action's AP up front. And the `moveStart` prune has no test at any level: the two verbs it exists for, the courier dash and swap, appear in no spec at all.<br>      ↳ **CLOSED 2026-08-03 for the layer the finding names.** The perform
      halves are reachable now (Q902) and all eleven beat arms have a unit test
      driving them with counters: the four the measurement found with **no
      coverage at any level** — `support`, both `topple` arms, `shove` and
      `entrench` — plus the refusal loop that was the actual shape of both
      shipped AI bugs (`entrench`, `advance` and `crouch` come back having done
      nothing, add themselves to `refused`, and must NOT end the turn). One
      test walks all eleven arms asserting none falls through to the pass beat,
      which is the invariant a mechanical edit would break silently. The decide
      half is covered too: the AP pre-gates, the topple's partition fallback,
      demolition only when sealed, battering needing hands a door does not, and
      entrench needing both halves.
      **What is left is NOT this finding**: the doers' interiors (does
      `aiTopple` put the right prop on the right victim) still need a body and
      a scene, so they stay e2e's job — and the arena gaps the measurement
      named (nothing wounds HR below the heal threshold; the Executive appears
      in one bare corridor) are real, filed as Q024's neighbours, and unchanged
      by this pass.
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
- [x] **Q016** `src/main.js:3063` [bug] In combat the crosshair/glow promise a swing that the click turns into an in-place shuffle, because the pick ray hits an adjacent body over your own tile<br>      ↳ **DONE — the hover learned the click's own-tile rule.** Verified: the click resolver puts the acting body's OWN tile first (a self-cast or a shuffle must not be stolen by an adjacent tall mesh), and `onHover` had no such rule at all — so on those pixels the crosshair, the glow, the target ring and the to-hit readout all promised a swing the click would never make. The gate goes where `hoverFoe` lives (`combat.handleHover`'s new `onOwnTile` arg) rather than only at the cursor, or main.js would have swapped one lie for a quieter one. `handleHover` still runs with the real point — a cone, a zone and a summon drop aim off it, and the shuffle's own move preview is priced there. `targeting` 7/7, `hit` 3/3.
- [x] **Q017** `src/main.js:252` [bug] Setting a cloud save key on a browser that already has a local save destroys the cloud run that key points at<br>      ↳ **DONE — option A, ratified by the designer (2026-08-03: "the recommended option A is fine for persistence").** The mechanism was confirmed first: the desk suppressed the cloud lookup whenever a local save existed (`if (!restoredProgress && remote.enabled)`), so the phrase's run was never read, and the first floor this browser cleared pushed over it — or a death deleted it outright, silently inverting `REMOTE_STORE.md`'s promise. Now the pull always runs and the two offers stand side by side: the local Continue stays on top (it is the run you are in the middle of), the cloud one takes its own id `level-continue-cloud` so neither test nor player can confuse them, and both sub-labels carry floor plus age. Ages come from a new `savedAt` on the save (`serializeProgress`, carried through `parseProgress`) and, for the cloud row, its own `updated_at`, which beats anything inside the blob; a save written before the field simply shows no age. With Q063 and Q067 already fixed, the desk now has no way left to lose a run without being asked. `party` 4/4, `economy` unchanged (both drive `#level-continue`, whose id did not move).
- [x] **Q018** `src/main.js:161` [bug] clearProgress() is the one unguarded localStorage write left; a throw eats the lose screen and the Restart-run escape<br>      ↳ DONE — wrapped; remote.clear stays outside the try
- [x] **Q019** `src/main.js:2018` [bug] Sneaking survives the floor transition as a ghost status, and the next floor can never start a fight with you<br>      ↳ DONE — held-mode statuses stripped on serialize
- [x] **Q020** `src/stats.js:806` [bug] Equip/unequip cycling a maxHp trinket ratchets HP back to full — a free, unlimited heal<br>      ↳ DONE — debitLostHp, floored at 1
- [x] **Q021** `src/combat.js:2694` [duplication] aiShoveMember is a second shove resolver that has already dropped the wall-slam stun and the slam-into-a-prop topple<br>      ↳ DONE — merged into displaceBody behind victimView (Q4-A)
- [x] **Q022** `src/combat.js:1384` [god-method] `combat.js drawTargets()` is a 321-line renderer holding thirteen verb-specific drawing rules, a third verb-dispatch ladder, and mutable animation state<br>      ↳ **PARTLY DONE — 321 → 195 lines.** Seven pieces named: drawAimWash (50), drawCoverRings (29), drawZoneRings (17), drawSummonRings (10), drawAllyRings (9), drawHoveredDoor (7), drawHeldCrouch (4). The third verb-dispatch ladder was already collapsed onto verbSides. **Still open, and deliberately:** the BODY pass - cone polyline, reach ring, shove/topple/partition/break rings, the per-enemy loop - which genuinely shares hoverFoe, coverEase and the enemy iteration and wants a real look rather than another mechanical cut. Re-queued as Q901.
- [x] **Q023** `src/ui/chrome.js:90` [test-gap] One module-scope `window.addEventListener` in ui/chrome.js locks 1,613 lines — the whole `ui/` layer plus the three host-callback modules the architecture holds up as exemplary — out of node unit testing<br>      ↳ DONE — bound on first use; 11 modules unlocked
- [x] **Q024** `tests/e2e/helpers.js:92` [test-gap] No e2e arena or spec ever fights an Executive or a Security Guard - so the enemy ranged kit, M5's headline feature, has zero end-to-end coverage<br>      ↳ **DONE — and the finding was HALF STALE by the time it was reached, which is recorded rather than quietly fixed.** The Executive *is* fought: `ai.spec.js`'s Range Hall pins that he shoots from across the room instead of closing, so "the enemy ranged kit has zero end-to-end coverage" had stopped being true. What genuinely had nothing was the **Security Guard** — every `'security'` in the suite is the PLAYER's class, and the one arena named for him fights a Manager. New spec `tests/e2e/enemy-kit.spec.js`, 3 tests, all green:
      - **Escort Hall** — the guard strikes from two tiles off and never has to close. His reach (2.1) clears a full orthogonal tile; bare hands (1.5) do not. The second assertion is the one that makes it about reach rather than about a coworker walking up.
      - **Triage Room** — HR heals a wounded colleague (`support`, one of the four arms Q005 measured with **no coverage at any level**).
      - **Deadline Office** — the Executive tucks in behind a cabinet and then fires (`entrench`, another of the four). Range Hall could never reach this arm: a bare two-row corridor has no shielded face, so `canCrouch` is false every frame.

      **Worth carrying forward, because it cost a run and would cost the next one too:** `aiAllies()` is the ENGAGED list, so a colleague standing outside `ENGAGE_RADIUS` is not somebody HR can triage — he is not in the fight at all. The first Triage Room put the Manager six tiles out; HR spent every turn posting employees instead, which reads exactly like a broken support arm and is really a broken arena. The test now asserts the initiative order contains both coworkers BEFORE it asserts anything about the AI.

### MEDIUM

- [x] **Q907** `src/combat.js:140` [bug] **(new 2026-08-03, from the Q900 audit)**
  **A charmed coworker is the one body on the floor the floor cannot touch**,
  and three separately-confirmed findings turned out to be this same root.

  `charmUnit` borrows an EnemyActor and makes it a player-driven member, but
  combat's `members` is a COPY of the roster (`party.members.map(asMember)`), so
  the borrowed body never reaches main.js's `party.members` or `summons`. Which
  means: `onMemberStep` does not cover it, `onSummonStep` does not cover it, and
  combat sets `unit.onTile` only in `aiAdvance` - which a player-driven body
  never runs. Drive a borrowed coworker through fire, live water, a cable or a
  paper drift and they take no damage, catch no `burning`, gain no `bleed`, pick
  up no gum, never slip, never tick the step clock and leave no footprints.
  `notifyStep` is on the same two hooks, so they provoke no opportunity attacks
  either.

  The two other confirmations are the same body seen from elsewhere: main.js's
  `findPath`/`smooth` resolve the walker via `party.members.find(...) ||
  summons.find(...)` and fall back to the LEADER's sheet, so a borrowed body is
  routed and its corridor cut with the leader's talents - a shock-immune leader
  walks it straight through live water. And `liveSummonsOf` has no leg for a
  borrowed minion, so it falls off its summoner's books.

  **DONE.** All three, and the seam was the one recorded above: the actor's own
  `onTile`, which `GridActor.update` fires BEFORE EnemyActor.update's
  `world.paused` return - the only hook that reaches a body main.js drives
  through its enemy loop while a fight is on.

  The steps route to main.js's `onSummonStep`, not to a fourth copy of the
  rules. A borrowed body is exactly a summon's case: player-side, and silent,
  because the surface lines are written in the player's voice and somebody you
  are driving is not you. It gets the step clock, surface damage through its own
  sheet, the applied status, bleed, gum, slips, footprints and `notifyStep` -
  and combat hands over its OWN carrier so notifyStep can resolve it, which a
  fresh literal could not. `releaseCharm` hands the seam back, or aiAdvance
  would be assigning over it the moment they return to their side.

  The routing half: `findPath` and `smooth` ask the fight who is walking
  (`actingActor`/`actingSheet`) before falling back to the leader's sheet. The
  smoother's own comment already said it "fears the WALKER's hazards, not the
  leader's" - it just had no way to find this walker. Both sites changed
  together, because a smoother fearing different hazards than its router
  straightens through the tile the route detoured around.

  And `liveSummonsOf` grew its third leg: a borrowed minion is in neither
  existing count - `liveEnemies` drops charmed bodies, and a charmed member is
  `isCharmed`, never `isSummon` - so charming an HR employee used to free the
  slot that posted it and let HR reinforce over its own cap.

  The recorded trap was respected: no `sheet` was hung on the unit.



- [ ] **Q901** `src/combat.js` [god-method] **(new 2026-08-02, the remainder of Q022)**<br>      ↳ **MOVED, and the warning in this entry was worth its weight.** `drawTargets`'s body pass now lives in `combat-aim.js` with the rest of the aim view rather than in the closure. The entry predicted "expect at least one more of those in here" about fall-through arms; what actually bit was different and worse - three runtime errors that all BUILT CLEAN and only failed in a browser: setters that were object-literal methods (so moved code called undefined names and the frame loop died, stalling every AI turn), `findPath` being both a facade key and an outer function, and `[...party.members]` hiding from the rewrite because the spread's dots read as property access. **The body pass is not yet SPLIT** - it moved intact. Splitting it is still open, and still wants a real look rather than another mechanical cut.
  `drawTargets`'s BODY pass, ~195 lines: the cone polyline, the melee reach ring,
  the shove/topple/partition/break rings and the per-enemy ring loop. Unlike the
  ground arms these are NOT independent - they share `hoverFoe`, `coverEase` and
  the enemy iteration, so splitting them means deciding what owns that state, not
  just moving braces. Worth noting what the ground-arm extraction nearly cost: the
  ally arm had no `return` and FELL THROUGH on purpose, which is what gives the
  purge rings on both halves; a mechanical cut turns that into `return true`
  silently. Expect at least one more of those in here.
- [x] **Q902** `src/combat.js` [test-gap] **(new 2026-08-03, the remainder of Q003/Q035)**
  **DONE 2026-08-03 — the seam exists, and both halves of the AI turn crossed it.**
  The finding was right that cutting further would not help: the loop needed a
  place where the world arrives as an argument. It has one now.

  - **The ACT half** is `combat-ai.takeBeat`. Nothing about the dispatch was
    world-shaped — every arm bills AP, calls one doer, sets a wait — so the
    eleven doers arrive as an argument and the rules moved out. combat.js keeps
    a 30-line adapter naming its closure verbs, and `acting` is passed as
    `turn` because that IS the state the frame loop reads next tick.
  - **The DECIDE half** is `combat-ai.aiBeatPlansFrom`. `beatStateFrom` was
    already pure; what was still closure-bound was the step BEFORE it — which
    plans get gathered at what price — and the three flags derived after
    (`canShoot`, `canCrouch`, `canEntrench`). Every world question is a
    callback on one `ask` bag.

  What did NOT move, on purpose: the doers themselves (`aiTopple`, `aiShove`,
  `aiSummon`, `aiOpenOrBreak`, `tryAiCrouch`, `aiAdvance`) genuinely touch
  bodies, the scene and the AP ledger. Their DISPATCH is tested; they are
  Q037/Q042's problem, not this one.

  `combat.js` 5,699 → 5,589. Verified `ai` 3/3, `summons` 5/5, `cover` 7/7,
  `ranged` 4/4, `demolition` 3/3.

- [x] **Q903** `src/looting.js` [test-gap] **(new 2026-08-03, from the Q038 split)**
  Four of the Alt overlay's five scans are driven end to end - `looseEntries` and
  the container half of `propEntries` by looting.spec.js's rummage/drop/pickup
  test, the shop half by economy.spec.js's cleaned-out machine, `bodyEntries` by
  the fallen-coworker test. `paperEntries` is the fifth and nothing drives it.
  The fill underneath it now has eight unit tests, but the LABEL those patches
  turn into does not: the centre the chip floats at, and the nearest-patch-tile
  the click walks to rather than that centre, which is the interesting one -
  a centroid can easily be a tile nobody can stand on. Found while splitting
  lootEntries, not by a failure; the arm may well be right.
<br>      ↳ **DONE — `paperLabel` at module scope, four tests.** The arm the entry called "the interesting one" is pinned: the chip floats at the patch CENTRE, the click walks to the nearest patch TILE, and those are deliberately different points. The test that matters is a horseshoe of paper whose centroid lands in the mouth on bare floor - a click that walked to the chip would harvest nothing - and it asserts its own fixture still has a centre OFF the patch, so it cannot quietly stop testing anything. Red-first: routing the walk to the centre fails 3 of the 4. The finding guessed "the arm may well be right", and it was; what was missing was anything that would notice if it stopped being.
- [ ] **Q904** `src/stats.js` [design] **(new 2026-08-03, from the Q136 answer)**
  The carry cap is a stat **[stated]** (designer, 2026-08-03) and the seam now
  carries a variable one, but two things are open and the second is not a
  number, it is a rule.

  **Which stat, and what the numbers are.** `inventoryCapOf` returns Infinity
  and is the one place to change. Grit is the obvious reading of "how much can
  you carry" against the four office attributes, but nothing has said so, so it
  is not written in.

  **Nothing reconciles a bag that is already OVER the cap.** Every guard today
  is on the way IN - picking up, unequipping - because with an infinite cap
  there was no other direction to guard. A cap that can FALL has several: a
  leader switch to somebody with less of the stat, a lost point, a debuff,
  unequipping whatever was raising it. The options are real design forks, not
  implementation detail: refuse the thing that would lower the cap; allow the
  bag over cap and block additions until it drains; or spill the excess to the
  floor. The third is what the old overflow arm did, and the note that removed
  the finite cap called exactly that "friction without a decision attached -
  you never chose WHAT to leave behind, the tenth item just fell out". Worth
  deciding before a finite cap ships rather than after.

- [x] **Q905** `tests/e2e/cover.spec.js:21` [test-gap] **(new 2026-08-03, from the throwing.spec fix)**
  Two more copies of the unpinned `clickManager` - cover.spec.js:21 (four call
  sites) and an inline twin in demolition.spec.js - project a coworker's body
  and click it with nothing waiting for the camera and nothing checking the
  pick landed. throwing.spec.js had the same helper and it failed two runs in
  three the moment hover frames got cheaper.
  These pass today, and the reason is worth writing down because it is not
  robustness: cover.spec.js's TURTLE_BOX Manager is walled in by filing
  cabinets so he cannot wander, and demolition's already checks `onScreen`.
  The other cover arenas (`#@M....#`) are open rooms where he CAN amble, and
  the failure mode there is the one throwing.spec taught: the click lands on
  vacated floor and the test reports something else entirely - nothing
  happening, or a fight opening - with no symptom naming the click.
  The proven gate is in throwing.spec.js now: settle on the PLAYER, then poll
  `__game.hoverKind` until the game's own pick says `enemy`, and only then
  click. Worth lifting into helpers.js as one shared `clickBody` rather than a
  fourth copy - but note the gates alone did NOT fix throwing.spec, sealing the
  arena did, so check each arena's coworker can be where the test needs him
  before trusting a gate to hold.
  **A fourth sighting, and it makes this a pattern rather than three
  incidents.** tactics.spec.js's backstab test computes a stand-tile from the
  foe's position and then walks to it; its own header says "The Manager wanders
  before the fight". It failed once inside a full-file run on 2026-08-03 and
  then passed 3/3 solo and 8/8 in a re-run, which is exactly the signature -
  the amble is the variable, and the suite's timing decides whether it moved
  between the read and the use. The others: throwing.spec.js (fixed by sealing
  the arena), classes.spec.js:151 (whose comment records the same thing as
  "Invalid target." six times over, and which now settles on the PLAYER for
  it), and cover/demolition's unpinned clickManagers below. The shared fix is
  one rule - derive the aim AFTER the last await, or pin the body so it cannot
  move - and it is worth doing once across the suite rather than per failure.

  While in there: `SEALED_ARENA` names two DIFFERENT fixtures, in
  ranged.spec.js and throwing.spec.js. The ranged one is genuinely walled on
  all sides, which is why it never flaked; the throwing one had a back door
  until today. Same name, opposite properties, and the name is what made the
  throwing one look sealed to every reader who checked.

<br>      ↳ **DONE — one owner, not three fixed copies.** `clickEnemyBody` in helpers.js, used by cover (4 sites), demolition (2 inline twins) and throwing, which had the only pinned version and gave it up to be the shared one. It settles the camera, re-projects the LIVE body each attempt (a coworker takes turns and moves), and polls the game's OWN pick - `hoverKind` - until it says `enemy` before clicking. The `y` parameter is why demolition's crouch case still works: a crouched body is a squashed pose and wants a lower aim than a standing one. cover 7/7, demolition 3/3, throwing 8/8.
- [x] **Q906** `src/main.js:2899` [design] **(new 2026-08-03, from the Q032 map)**
  All four **[stated]** (designer, 2026-08-03: "yes all fixes", and on the
  first of them separately: "yes they should catch fire opf course"). Closed
  the same day it was opened.

  **Fire burns everyone.** An AI unit walking through flame now catches, and
  the machinery was already there - units carried `burning` with a turn-start
  dot, an out-of-combat tick and an ember aura built, and nothing was using it.

  **And it burns you outside a fight.** The `inCombat` gate is gone. It existed
  because the status "needs combat's turns to tick"; `advanceStatusTurn` made
  that false on 2026-07-31, so the gate outlived its reason by three days.

  **Wanderers obey the floor** - step clock, surface damage on the ENEMY model,
  the applied status and the bleed. Silently, because the surface lines are
  written in the player's voice, which is the same reason `onSummonStep` passes
  a no-op `say`. Two node tests pin the damage and the step clock, each checked
  against a mutant.

  **`bleed` reaches coworkers**, applied before the damage so a body that goes
  down on a drift went down bleeding - which is what the death FX reads.

  **The structural half, and it is the part worth keeping:** all four wanted a
  different fact about a tile, and the cheap path was four new facade methods -
  exactly the pattern Q900 warns about. Both facades hand over `floorAt`, the
  raw fact sheet, and every layer derives with step-rules' own pure
  `surfaceEffect`. One sheet, one rule, three consumers. That is the shape Q900
  should be closed in.

  11 e2e green across fire, surfaces and statuses - notably NONE of them pinned
  the old behaviour, so nothing had to be weakened to let the fixes through.
- [x] **Q900** `src/main.js` [soc] **(new 2026-08-02, from the fix work itself)**
  The pass this entry asked for is DONE: 46 of main.js's query helpers walked,
  each asked whether combat can reach the same answer, with every claimed
  divergence independently re-checked. 29 fine, 9 latent, 4 bugs, 4 cosmetic;
  8 divergences confirmed and 7 dismissed on the second read, which is the
  ratio that makes the surviving ones worth acting on.

  **The four this entry already listed were the tip.** What the pass found is
  that the facade is not uniformly narrow - it is narrow in one specific place
  every time: wherever combat is handed a pre-chewed ANSWER instead of the
  facts, and main.js asks the question a different way. Every confirmed
  divergence is that shape.

  **Fixed here.** (1) A forced landing skipped the surface's RIDERS: shoved into
  fire you took the 4 and never caught; shoved onto a drift you were cut without
  bleeding - while walking onto either tile did both. The facade's own
  `memberSurfDamage` comment states the rule that was broken ("the same tile
  means the same thing however you got there"); Q1-A made the number honour it
  and left these behind. (2) The AI's shove gate asked the talent-free model and
  a slip that never rolls, while the resolver bills `memberSurfDamage` through
  the victim's own talents - so a member in ESD Steel-Toes was shoved on a plan
  priced at 6 that bills 0, and plain water admitted a shove whose whole effect
  was a one-tile reposition. The ladder ranks shove ABOVE the swing, so both
  traded the unit's best beat for nothing.

  **Still open, and they share one root: Q907.**

  The remedy this pass argues for is the one `floorAt` already demonstrates -
  hand over the facts, derive with a pure rule - and it is now the test for any
  new facade key: if the key is an answer rather than a fact, main.js will
  eventually ask it differently.
- [x] **Q032** `src/main.js:2716` [duplication] **(carried)** Four hand-written per-tile step handlers across three layers, under a main.js section header that claims the rules are "written once"<br>      ↳ **MEASURED 2026-08-03, and it is not the finding it was written as.** Four callbacks of shape `(x,z,done,changed)` exist, in three files - `onMemberStep` (main.js:2949), `onSummonStep` (main.js:3046), the AI walk closure (combat.js:4730) and the wanderer amble (actors.js:503) - but they are not four hand-written copies. The first two are thin wrappers over ONE shared body (`tickStepOn`, `applySurfaceOn`, `maybeSlip`, `leaveFootprint`, two callers each), and the DECISIONS under all of them already live once in step-rules.js. What is duplicated is ORCHESTRATION - which rules fire, in what order, with what FX, log voice and rng - and that exists twice, not four times: main.js's player side and combat.js's enemy side, with the wanderer a two-rule stub of the latter. **The 'written once' header is true as scoped, not false:** it says "a body ON YOUR SIDE", and within that scope nothing is copied. Misleading by omission, since a reader takes "once" to mean once in the game. **Of ~13 per-tile rules, exactly ONE (gum pickup) is implemented by all four.** <br>      ↳ **FIXED here:** the enemy step clock read `slipProof` AFTER ticking, so the tile a gum wad wore off on could take a coworker's footing AND their whole turn, while the identical tile keeps a member upright - the drift main.js's `maybeSlip` comment documents as fixed, reintroduced on the other side of the door. Now snapshotted before the tick, as the member side does. Plus three comments that had gone false: actors.js and step-rules.js both still asserted "a coworker's gum is for keeps" (combat ticks it down now), and main.js's `inCombat` gate cited a reason `advanceStatusTurn` retired on 2026-07-31. <br>      ↳ **The rest went to Q906 as design calls, and Q906 is CLOSED** - all four ratified and shipped the same day ("yes all fixes"), so nothing of this entry is outstanding. Enemies never catch fire; your own leader never catches fire out of combat; wanderers take no surface damage and run no step clock; `bleed` has exactly one application site in the repo and it is player-side, which makes the enemy step clock's damage branch unreachable today.
- [x] **Q033** `src/portraits.js:77` [duplication] **(carried)** portraits.js holds a fourth copy of "tint a body" — the compounding in-place multiply the other three were rewritten to remove<br>      ↳ DONE — portraits routes through cloneMaterials + tintMaterials
- [x] **Q034** `src/tactics.js:259` [duplication] **(carried)** "Does this shielded face point at the attacker?" is implemented three times, and REVIEW.md records it as having one owner<br>      ↳ DONE — tactics.shieldingFace; facesShieldFrom derives from it; 4 tests
- [x] **Q035** `src/combat.js:4530` [god-method] **(carried)** `update()` is a 278-line god frame-driver braiding six responsibilities, and it grew with the AI work<br>      ↳ **PARTLY DONE** — the same function as Q003 and closed by the same split; see there. The braiding is what came apart: the frame's own bookkeeping, the player half's two walk-up finishers, and the AI half's gather/decide/act are now four separate reads.
- [x] **Q036** `src/combat.js:3176` [god-method] **(carried)** `handleEnemyClick` is a 243-line dispatcher with nine inline verb arms, each re-implementing the same AP check, arming teardown and victory check<br>      ↳ **DONE — 253 → 62 lines**, six pieces named: `clickShove` (30), `clickPull` (9), `clickRanged` (77), `clickMelee` (72), plus the two epilogues the arms were repeating - `finishVerb` and `closedTheDistance`. The head is now the gates, the auto-arm, the `refuse` closure and one line per kind. **The finding's own count was wrong and it is worth recording which way.** It says nine arms each re-implementing the AP check, the arming teardown and the victory check. Measured: five copies of the one-line AP guard, two of the victory epilogue, two of the walk-only one. The five one-line arms (cover, cone, summon, zone, control) re-implement nothing - they delegate and return. And the AP guard stays a legible one-liner rather than becoming a helper, because `if (!afford(a, refuse)) return;` costs what `if (active.ap < a.ap) { refuse('Not enough AP.'); return; }` costs and buys only indirection. **What the finding missed:** two `disarm()` sites deliberately DON'T check victory - they are the walk-only branch, where no strike happened so nothing can have died. That asymmetry now has a name (`closedTheDistance` vs `finishVerb`) and a comment saying it is deliberate, which is the part a future reader would otherwise 'fix'.
- [ ] **Q037** `src/combat.js:76` [god-method] **(carried)** The two god closures measured: `startCombat` is 5,065 lines / 176 inner functions / 21 shared mutable variables, `startGame` 4,214 / 159 / 26 — and combat.js grew 493 lines on this branch<br>      ↳ **CUT, not closed — 2026-08-03, and the numbers are the point.** `startCombat` 5,506 → 4,965 lines, 108 → 92 inner functions, **21 → 13 shared mutable variables**; `startGame` 4,407 → 4,133, 87 → 83, **26 → 22**. Files: `combat.js` 5,590 → 5,050, `main.js` 4,802 → 4,531. Four modules came out, all node-importable: `combat-aim.js`, `combat-world.js`, `hotbar-host.js`, and the AI turn's two halves in `combat-ai.js`.
      **The method, because it is the transferable part:** don't cut by size, cut by STATE OWNERSHIP. Measure which shared variables a cluster writes and which are written by anything else; a cluster whose variables nobody outside touches is already a module living in the wrong scope, and moving it is mechanical. The aim view owned 8 of the 21; the hotbar host owned 4 of the 26. That is why both moved in one pass each with no design argument to have.
      **Later the same day, one more slice:** `floor-effects.js` - what the floor does to a body (the per-step surface effects, the slip roll, the out-of-combat turn clock). `startGame` 4,133 → 4,074 lines, 83 → 80 functions.

      **A sixth slice was attempted and REVERTED, and the reason is worth more than the lines would have been.** `combat-strikes.js` (`unitStrikesMember`, `opportunityStrike`, `displaceBody`, `dropOnto`, `landStun`) looked like the best remaining cut: 282 lines, writes NONE of the closure's shared turn state, and the moved text was provably identical to the original modulo the `d.` prefix. It still broke nine e2e tests, in three rounds:
      - `fx`, `callbacks`, `appliesLine`, `immunityLine` were never wired - the dep scan looked for identifiers followed by `.` or `(`, and these appear as bare reads.
      - Then `active`, `phase`, `forceHit`, `ACTIONS`, `MISS_COLOR`, `rng` - missed the same way, and `active` is the one that mattered: `displaceBody` defaults `by = active`.
      - With all sixteen wired the shove STILL failed, and by then the failing path was the click resolver rather than anything that had moved.

      **The lesson is about the size of the BAG, not the size of the cut.** The five clean extractions had 10-37 deps that were mostly world callbacks. This one reached into the live turn state from four directions, and each miss cost a 10-30 minute e2e round to find. A cluster that WRITES no shared state can still READ so much of it that moving it is not a lift - and reads are exactly what the "writes nothing shared" test does not measure. **Measure reads as well as writes before committing to a cut**, and treat a bag that needs `active`/`phase` as a redesign rather than a move.

      **Still open, and this is the honest remainder:** 13 and 22 variables are still shared, and the ones that are left are the hard ones - `phase`, `armed`, `acting`, `active` in combat; `sheet`, `player`, `party`, `inCombat` in main. Those are genuinely global to a fight and a run, and the next cut has to decide what OWNS them rather than where they live. That is a design question, not a mechanical one.
- [x] **Q038** `src/looting.js:292` [god-method] **(carried)** `looting.js lootEntries` is a 120-line function running five unrelated scans, three full grid sweeps and an inline flood fill — in a module kept out of node by a single renderer import<br>      ↳ **DONE — 120 → 12 lines**, and the last clause was already stale. Five scans, five names: `looseEntries`, `propEntries`, `bodyEntries`, `paperEntries`, and the host's own `extraEntries`; `lootEntries` is now the concatenation, in the order the labels were built in before they were named (the overlay renders in list order and nothing has said which way it should be, so the order is preserved rather than tidied). **The three grid sweeps are two.** Containers and machines ask the same tile the same question and now share one pass - two lists, one sweep, so the container-before-machine order survives. The third is the flood fill's own, and it stays: folding it in would cost the extraction below for one pass over a window that is at most 21x21. That is a trade, not a leftover. **The flood fill is now pure and tested** - `paperPatches(grid, inWindow, harvestable)` at module scope, 8 unit tests, each verified against a mutant: 8-connecting the fill, taking the seed tile as the patch centre, and gating the window on the seed only are all caught by exactly the test that claims to cover them. **On the stale clause:** looting.js has imported under node since 52741dc; what keeps the rest of it out is that `createLooting` builds DOM panels the moment it is constructed. That is why the fill went to module scope rather than staying an inner function - same reason, same seam, as Q902.
- [ ] **Q039** `src/main.js:304` [god-method] **(carried)** `startGame` has grown to a 4,214-line closure with 88 inner functions and 141 closure variables<br>      ↳ **CUT — see Q037 for the method and the numbers.** `startGame` 4,407 → 4,133 lines, 87 → 83 inner functions, 26 → 22 shared variables. Two pieces left it: the 199-line world facade `beginCombat` built inline (now `combat-world.js`, which is also Q041's other half) and the hotbar's DOM binding (`hotbar-host.js`), which held four variables exactly one function wrote.
- [x] **Q040** `src/combat.js:3536` [inconsistency] **(carried)** `verbKind` has only two consumers while five more hand-written `a.type` ladders are live — the exact drift TODO.md Phase 5 says to watch for<br>      ↳ DONE — attackOrConfront asks verbSides; three of five ladders now collapsed
- [x] **Q041** `src/combat-plans.js:54` [soc] **(carried)** Pure plan modules take a parameter literally named `world` that is combat's host facade, so the contract is duck-typed and unit tests structurally cannot check it<br>      ↳ **THE PROVIDER SIDE IS REACHABLE NOW (2026-08-03).** `world-contract.test.js` pins what the pure rules NEED off the bag and says in its own header that it deliberately cannot check the other side - "main.js is the entry point and importable.test.js excludes it on purpose, so the provider side cannot be reached from node". The facade was a 199-line literal inside `beginCombat`; it is `combat-world.js` now, a plain function returning a plain object, so a test can build one and ask whether it still carries the keys the rules read. **The test itself is not written yet** - that is what is left of this finding.<br>      ↳ **DONE — `world-provider.test.js`.** The consumer half pinned what each rule NEEDS off the bag and said in its header that the provider side "cannot be reached from node". It can now: `combat-world.js` is a plain function returning a plain object. The new tests deliberately do NOT restate the key lists - two lists that must agree is the drift this finding is about - they drive the REAL facade through the REAL rules, so a key dropped from the provider fails the same way it would in a fight. Red-first checked: deleting `stepOpen` fails 3, `tileDefAt` or `approach` fails 2.
- [ ] **Q042** `src/combat.js:76` [soc] **(carried)** `startCombat` is one 5,140-line closure - up ~440 lines on this branch - with `armed` mutated at 31 sites across eight subsystems
- [x] **Q043** `src/editor.js:516` [soc] **(carried)** `editor.js startEditor` is a 641-line god closure, and it hardcodes the tile-category list in system code — adding a category means editing the editor<br>      ↳ **PARTLY DONE** — the tile-category ORDER is now content (`TILE_CATEGORIES` in data/tiles.js), lint both directions, and the live drift it was hiding is fixed: `snack-machine` declares `furniture`, which the editor's list never named, so its brush sorted silently to the end of the palette. **Still open:** `startEditor` is a 641-line closure - the size half of this entry.
- [x] **Q044** `src/tile-renderer.js:12` [test-gap] **(carried)** Four modules still read `const pc = window.pc` at module scope, the pattern already fixed in actors.js/models.js/shading.js<br>      ↳ DONE — all ten deferred; 67 of 68 modules now import under node, gated by a test
- [x] **Q045** `src/actors.js:68` [bug] A character whose .glb fails to load teleports to the world origin, because the magenta fallback holder has no child and `GridActor` drives `visual === entity`<br>      ↳ DONE — and the fix belongs in `models.js`, not actors.js where the finding is filed: `placeModel`'s SUCCESS path establishes "the holder is the body, `children[0]` is the visual", and `placeFallback` was the one branch that broke the contract. Made the box a child. The symptom is worse than "renders at the origin": the logical tile follows the body, so its per-tile effects fire at (0,0), and a walk issued to it never arrives because `moving` never clears — in a fight, a turn waiting on that arrival hangs.

- [x] **Q046** `src/combat-geometry.js:150` [bug] hasSwingSpot scans only the 8 neighbours, so a long-reach weapon is told it has no melee option<br>      ↳ **DONE, with a red-first test.** Confirmed: `hasSwingSpot` scanned `AROUND` - the eight neighbours - while `swingPointAt` measures against the attacker's actual reach. A boxed-in coworker (ringed by their own colleagues, or the far side of a partition whose neighbours cannot be walked to) has no legal adjacent tile, so the rings said "no melee option" to the reach-grabber's 2.2 tile-units as readily as to bare hands - making the long weapon strictly worse than the short one in the one case it exists for. It scans out to `ceil(reachOfUnit)` now, so per-frame work stays proportional to the reach that earned it. `melee-reach` 3/3, `tactics` 8/8.
- [x] **Q047** `src/combat.js:2184` [bug] The ratified disengage shove was never wired up — `aiShovePlan`'s `disengage` flag has no production caller<br>      ↳ **DONE. Q047, Q075 and Q094 are ONE finding filed three times** — the same code fact framed as [bug], [dead-code] and [inconsistency] — and they close together. Wired off `rangedLines(unit)`, the predicate `aiAdvance` and `aiBeatPlans` already mean by "the ranged kit". <br>      ↳ **A design consequence the designer should see, because it is the first time anyone can:** shove sits ABOVE attack in the ladder, so an Executive in contact now pushes off and shoots instead of standing in the scrum trading punches. That is exactly doctrine #11 (kiting is priced; the disengage shove is the one escape that does not provoke) and the reason for giving an enemy a rifle at all — but it is a visible change in how that fight feels, and A4's ratification predates anyone watching it happen. If it reads as the shooter being slippery rather than smart, that is a re-open of A4, not a bug.
- [x] **Q048** `src/combat.js:4389` [bug] The Executive's ranged line fires as an opportunity attack — footgun 9's context-aware picker was applied in `aiAttack` only<br>      ↳ DONE — one `swingPool` owner for "what a swing AT CONTACT RANGE may draw from", used by `aiAttack` and by `opportunityStrike`, which had its own uniform draw over every line the def owns. **Smaller than the headline reads, and worth recording as such:** the reaction overrides the line's own log text and fires no projectile, so the tell was never absurd flavour — it was 1 reaction in 5 from the Executive billing the rifle's damage band at arm's length, and the `confused`/`gum` riders drawn flat. The reaction's draw stays UNWEIGHTED on purpose: its own comment calls it a reflex rather than a committed swing, so putting it through `pickLine`'s status weighting is a separate question.
- [x] **Q049** `src/combat.js:4632` [bug] The AI's summon readiness check SPAWNS, so HR fields two free reinforcements whenever the triage beat outranks it<br>      ↳ DONE — summonRoom asks; the summon beat acts
- [x] **Q050** `src/combat.js:476` [bug] `attackMods` builds the attacker's pincer list from `engaged`, so a charmed coworker helps the enemy flank you<br>      ↳ DONE — pincer list reads aiAllies()
- [x] **Q051** `src/combat.js:2279` [bug] A member's topple/crush stun plays its landing FX even when the anti-chain window refused it, and says nothing — the enemy branch twelve lines above does it correctly<br>      ↳ DONE — one landStun helper; three copies gone
- [x] **Q052** `src/combat.js:4424` [bug] `ranged` is computed after the melee fallback, so a shooter with no firing tile gets the ranged shield term applied to melee swing tiles — and it steers it onto a tile it cannot swing from<br>      ↳ **DONE — first clause true, second clause FALSE.** True: read below the fallback, `ranged` meant "owns a ranged line and has SOME field", which is also true of a shooter walking a melee swing field, so the entrench-potential bonus and the keep-away term were applied on a turn the unit was going to punch from. Set where the field is actually chosen now. False: it cannot steer onto a tile it cannot swing from — the fallback field is swing-tiles-only by construction (`swingFieldFor`), so what survives is a mis-WEIGHTED choice among legal tiles, not an illegal one. Recorded because the second clause is the scarier half and it is not real.
- [x] **Q053** `src/data/statuses.js:212` [bug] The `sneaking` status's `fx: { burst: 'none', aura: 'none', rate: 0 }` uses values fx.js does not know — sneaking characters trail particles continuously<br>      ↳ **DONE — all three values misfire, and each in the loudest direction.** `'none'` is a truthy string so the aura loop did not skip it; `rate: 0` is falsy so it fell to the DEFAULT 0.25s cadence rather than never; the aura switch fused `case 'shield': default:` so it wore the shield's glowing motes; and `statusBurst`'s 'pop' arm was a bare `else`, so the toggle fired the loudest of the three bursts. Fixed in **fx.js**, which owns the vocabulary, not in the data — `'none'` is the only out-of-vocabulary value in the whole registry and it appears exactly twice, both here. That also closes the bug class: a typo'd aura used to silently wear the shield look. Same finding as Q212.
- [x] **Q054** `src/data/talents.js:146` [bug] The `corner-office-traction` talent's only effect (`moveCost: 0.9`) is read by nothing — the talent does literally nothing<br>      ↳ DONE — `moveCostOf` read equipment only, though `moveCost` sits on TALENT_EFFECT_KEYS with the comment "stats.js: multiplies the AP a tile costs" and this is that site. Composed with the footwear multiplier rather than summed, which is how boots and a spill already combine. **Landed ahead of the dud rather than behind it:** no player can take this talent today (the picker is TALENT_PLAN M2 and nothing seeds it), so it would have gone player-visible the moment the picker shipped.
- [x] **Q055** `src/dialogue.js:20` [bug] `nodeOptions` can filter a dialogue node down to zero options, and the dialogue panel has no other way out<br>      ↳ DONE — Leave applied after the filters
- [x] **Q056** `src/editor.js:82` [bug] The editor's char pool is one character short of the paintable registry; the 87th distinct tile type silently paints floor<br>      ↳ DONE, exactly as counted: 86 allocatable characters (93 printable ASCII, less `'@'` and the six actor characters) for 87 paintable types. Pool extended with printable Latin-1 for headroom, not just the one; exhaustion now SAYS so, naming the type — the code carried a comment promising it would "say so below" and nothing did. **The durable half: `CHAR_POOL` moved to module scope and is exported, so the ceiling is a node lint** rather than something a level author discovers by clicking a brush that does nothing. Checked against an ASCII-only mutant, which the lint catches with the finding's own numbers.
- [x] **Q057** `src/floors.js:147` [bug] layeredGrid's METHODS list drops sightOpenCellLow and sightOpenLow, so sneaking on a layered level throws<br>      ↳ DONE — forwarded, plus a derived contract test
- [x] **Q058** `src/floors.js:71` [bug] A single-cell stair run is assumed to run along z, so an east-west one-cell flight is refused with a misleading error<br>      ↳ DONE — and there is a worse sub-case than the finding's: where the upper storey happens to have floor at exactly one z-neighbour, the flight PARSES and builds a staircase to a landing the author never drew. A lone cell's axis is not a property of the cells at all — it is decided by where the landing is, which is `resolveRun`'s question — so it is asked both ways: one answer wins, two is a named ambiguity (this module's house style is to name the authoring error, not guess), none rethrows the north-south failure, honest now because both really were tried. Three tests; two fail against the old code.
- [x] **Q059** `src/floors.js:170` [bug] planCrossLayerRoute only moves monotonically toward the destination storey, so an up-and-back-down route is refused<br>      ↳ **DONE, and it was TWO refusals, not one.** The monotonic filter was the finding: only flights heading toward `to.layer` were considered, so up-and-back-down was unreachable. Fixing it exposed the second half - the destination storey was an early `return`, so a goal on YOUR OWN floor that the walk cannot reach (two wings joined only by the floor above) was refused without the stair search ever running. It is a candidate now, and the cheaper of direct-vs-detour wins. The cycle guard counts FLIGHTS, not storeys: my first attempt guarded storeys and forbade exactly the return trip the fix is for - caught by the test, which is why it is there. Three tests: the split floor routes up and over, a plain walk still beats the detour, and a sealed goal still refuses without looping.
- [x] **Q060** `src/main.js:1870` [bug] switchLeader never releases the out-of-combat crouch, so `oocCrouch` and the `covered` chip end up on the wrong members<br>      ↳ DONE — same finding as Q066, one line, closed once. `switchLeader` is the only one of the three leader handoffs that never calls `clearOocCrouch`; `forceLeader` and `syncLeaderBindings` both do. **Placement is the entire fix:** it goes BEFORE the rebind, where the siblings put it, because `clearOocCrouch` reads the module's `sheet`/`player` — called after, it strips 'covered' off the INCOMING leader while the real croucher keeps chip and pose forever, since no path ever resets a NON-leader's crouch.
- [x] **Q061** `src/main.js:1870` [bug] switchLeader leaves the sneak on the old leader, making them permanently undetectable AND unable to trigger combat<br>      ↳ **DONE — and this is NOT a third framing of Q060/Q066.** Same function, different state, different owner, different fix. A SOLO sneak names the leader, but membership is derived LIVE (`sneakingMembers` filters on the current leader) while the chip was stamped at toggle time — so a portrait click silently swapped who the sneak meant. Ended via `endSneak` rather than handed over: re-stamping `sneaking` onto the incoming leader would slip somebody into a sneak while they are being watched, which is the one thing D8 refuses. Group mode names everybody and needs nothing. The finding overstates "permanently" — any `endSneak` clears it — but under-states the rest: the outgoing scout is also absent from the SPOT SWEEP, not just the fight trigger.
- [x] **Q062** `src/main.js:1741` [bug] The `confused` reorg desyncs the hotbar: pressing a slot uses the shuffled layout, right-clicking it uses the unshuffled one<br>      ↳ **DONE.** Confirmed: `pressHotbarSlot` read `barLayout()` (scrambled by the reorg) and `openAssignMenu` read `layoutOf(barSheet())` (not), so while confused, right-clicking the slot you just pressed edited a different one. `combat.scrambleOrder(n)` exposes the permutation itself and main.js's `trueSlot` maps a bar position back to the layout slot; the menu reads the DRAWN order for everything it shows (so a "on 2·3" hint sends you where you can see it) and only the write goes through the mapping. `hotbar` 4/4.
- [x] **Q063** `src/main.js:210` [bug] Picking "Start a fresh run" at the floor desk and then dying deletes the saved campaign the desk was still offering<br>      ↳ DONE — the fresh-run pick nulls `restoredProgress` in memory but leaves `playtesting` FALSE (it IS a campaign run), so death ran the same `if (!playtesting) clearProgress()` as a real campaign death and took the save the desk was offering two clicks earlier, cloud copy included. A run may now retire the campaign save only if it OWNS it: restored from it, or having written it by clearing a floor. The explicit 'Restart run' verb stays unconditional — that one is the player's own choice, and the whole point of the flag is to separate the two.
- [x] **Q064** `src/main.js:1007` [bug] A printer explosion damages party members but never touches player-team summons standing beside it<br>      ↳ **DONE.** Confirmed: `spawnSummonUnits` files a player-team summon into `summons` and nothing else, so it is in neither of the two lists `handleExplosion` walks (`enemies`, `party.members`) — a blast that flattened the whole party left the conjured coworker beside it untouched. Shrapnel reaches them now. One that runs out of HP is DISMISSED, not downed: no body, no loot, and nothing for `downOrLose` to weigh, because a summon is not somebody the run can be lost with. `summons` 5/5.
- [x] **Q065** `src/main.js:1254` [bug] Layered walks splice the body's real position AFTER smoothing, so the first run is never corridor-checked<br>      ↳ **DONE — the real position goes in BEFORE the smoother.** Confirmed at `startNextLeg`: `smoothPath` ran over the tile-centre path and only then was `smoothed[0]` overwritten with `player.entity.getPosition()`. A walk starts wherever the last one left the body — a clamped point off centre — so the opening leg got a start the corridor checks never saw and could clip the wall the smoother had carefully cleared from the centre. Feeding it in first makes the first run the one that gets checked. `degrid` 1/1, `movement` 4/4.
- [x] **Q066** `src/main.js:1870` [bug] switchLeader() is the one leader handoff that never clears the out-of-combat crouch, so 'covered' is removed from the wrong sheet and the real croucher stays crouched forever<br>      ↳ DONE — duplicate of Q060, and its sharper wording is the accurate one: both halves of "removed from the wrong sheet" and "the real croucher stays crouched forever" check out exactly.
- [x] **Q067** `src/main.js:274` [bug] The cloud "Continue the run" button swallows its write failure and never validates the row, so it can reload forever without ever booting the run<br>      ↳ DONE — both doors into the same loop. The offer is now gated on boot's OWN check (`parseProgress` + `LEVELS[levelId]`), which is stricter than the `row?.data` test it had, so a row this build cannot read is never offered rather than offered and bounced. And the reload moved inside the try, so a browser that can read but not write says so and stays put. One consequence worth knowing: a player whose only copy is an unreadable row now sees nothing rather than a button that does nothing.
- [x] **Q068** `src/main.js:1865` [bug] Class points outlive the class track, so the fullscreen LEVEL UP modal reopens after every victory for the rest of the run<br>      ↳ DONE — new `stats.spendablePoints` beside the pool it narrows, three tests pinning where it diverges from `pendingPoints`. `nodeAvailable` already accounts for taken / prereq-locked / unaffordable, so a track merely GATED stops nagging and resumes the moment a node opens. **`pendingPoints` deliberately unchanged on all THREE display surfaces** — the character sheet, the party bar and the HUD level-up pip still show the banked total, because the points are real and hiding them would be a different lie. The new rule answers only "is it worth INTERRUPTING the player", which is the fullscreen modal and nothing else. <br>      ↳ **One judgement call worth flagging rather than burying:** the finding's own consequence names the glowing pip as part of the symptom, and I left it glowing. A pip is an invitation you can ignore; a fullscreen modal after every fight is not. If the designer would rather the pip also went quiet once a track is bought out, it is the same one-word swap at `main.js` 1911/4156 — but that hides banked points on the surface whose whole job is to advertise them, so it is a call, not a cleanup.
- [x] **Q069** `src/pathfinding.js:394` [bug] roundBends' arc-rejection fallback emits a leg it has just proved illegal, so a smoothed walk crosses a partition<br>      ↳ **DONE, and REPRODUCED first.** The mechanism is exact: `p1` lies ON the segment a→b, so a failed `a → p1` check condemns a→b — and the fallback pushed `b` anyway. It only bites when the PREVIOUS bend rounded and left `a` on that arc's exit point. The existing leg tests missed it because `legClear` samples TILE CENTRES; a sweep of 1522 random 8×8 rooms asking `segmentClear` instead found one, and that map is now a test (pre-fix red, post-fix green), with the same sweep clean at 0/1522 after. The fallback checks a→b now and steps back onto `path[i - 1]` when even that is blocked — a barely-visible kink at one bend, and the honest route.
- [x] **Q070** `src/picking.js:91` [bug] `picking.pick` ignores storey visibility, so a cutaway-hidden floor eats clicks aimed at the visible floor below it<br>      ↳ **DONE.** Confirmed: the cutaway hides a storey by disabling its root entity, but a disabled entity's mesh instances keep their world AABBs, so the ray went on hitting doors and props on a storey the player cannot see — and the door they clicked THROUGH never got the click. `layeredPick` already scans top-down through visible storeys for exactly this reason; the body picker knows the rule now too. Walks the parent chain rather than reading `entity.enabled`, which is the LOCAL flag — the item's own stays true while the storey root is what got switched off. `targeting` 7/7 (which is where door-mesh picking lives).
- [x] **Q071** `src/scene.js:253` [bug] `refreshTile` and `buildLevel` silently drop every renderMarker result that is not wall/surface/prop, so toppled partitions and foliage are untrackable and stack<br>      ↳ **DONE.** `renderMarker` returns six kinds; both filers kept three. The two dropped ones are real: `marker` (the toppled partition's floor slab, every `onFloor` remnant) and the FOLIAGE a model prop wears. Forgotten means `removePropVisual` cannot reach them, so `refreshTile` drew the new mesh on top of the old and a toppled plant kept its leaves. Tracked in an `extraVisuals` map keyed to a LIST, because one tile can own several (a model's holder is filed in `propVisuals`, its leaves here). `topple` 2/2, `sneak` 7/7.
- [x] **Q072** `src/tile-renderer.js:238` [bug] `addPaper` shadows the storey `baseY`, so a paper drift on an upper storey renders on the ground floor<br>      ↳ **DONE — the local is `rise` now.** Plain shadowing: `const baseY = hash01(...)` inside `addPaper` hid the storey lift the factory takes, so its `setPosition(x, surfaceTop + baseY, z)` added a per-tile jitter of at most 0.014 where every sibling adds the storey's height. Both terms are added now.
- [x] **Q073** `src/tile-renderer.js:367` [bug] `addFoliage` drops the storey `baseY` and parents to `app.root`, so upper-storey plants render at ground level and never hide with their storey<br>      ↳ **DONE.** Both halves confirmed and both fixed: it used `floorDef.height / 2` with no `baseY`, and `app.root.addChild` instead of `parent`. The second is the worse one — the cutaway toggles the storey root, and a plant that is not under it can never hide with its floor. `sneak` 7/7, including the row of plants that conceals a sneak.
- [x] **Q074** `src/turn-order.js:99` [bug] turn-order's span-end walk lands the pointer ON a slot `replace` swapped out, when the swapped slot was the span's last<br>      ↳ **DONE, with a red-first regression test.** `replace` keeps the index and drops the identity (`order[i] = next`), and the span books slots BY identity — so `indexOf` answered -1, the span's high-water mark fell back to an earlier slot, and `advancePastSpan` parked the pointer right back on this index. The new owner took a turn in the same round it arrived, on floor time its predecessor had already spent. Charming the trailing member of a shared turn is the shape that reaches it. `replace` now substitutes into `spanSlots` only — `held`, `done` and steering are membership, which froze when the span opened (INITIATIVE_PLAN #8).
- [x] **Q075** `src/combat.js:2184` [dead-code] The ratified ranged-kit disengage shove is implemented and unit-tested but never wired — no caller passes `disengage`<br>      ↳ DONE — same finding as Q047, closed by the same one-line wiring. **The [dead-code] framing invited the opposite remedy and it would have been wrong:** pruning the unreached branch would have deleted a [ratified] decision (AI_PLAN A4). Dead code that implements a ratified decision is a MISSING CALLER, never a deletion.
- [ ] **Q076** `src/data/items.js:373` [dead-code] Two of five loot tables are unreachable on the shipped campaign, and `night-thermos` is unobtainable in the whole game
- [x] **Q077** `/home/user/escape-work/ARCHITECTURE.md:444` [doc-drift] ARCHITECTURE.md still documents the pre-branch enemy targeting rule ("nearest living member, ties to the bloodied one")<br>      ↳ DONE — and worth recording WHY it survived so long: the sentence is exactly `pickTarget` at `focus: 0`, so it was true of the shipped game and merely no longer the rule. The entry now names the engageable tier and the four blended terms.
- [ ] **Q078** `/home/user/escape-work/src/main.js:141` [doc-drift] The `?seed=` comment added by AI M1 asserts an initiative-rng gap the code does not have, and credits the seed with slips it does not cover
- [x] **Q079** `src/data/enemies.js:7` [doc-drift] `aggression` is documented as fight-initiation behaviour but is only a dot colour; the documented `'green'` value is used by nobody<br>      ↳ DONE — both halves confirmed against the code: `aggression` is read at exactly one site (`hover.js` AGGRO) and by nothing else, and no entry in the file carries `'green'`. The header says DISPLAY SIGNAL now, names `checkCombatTrigger` as what actually starts fights, and says out loud that the dot table falls back to red — so adding 'green' back is a hover.js change, not a data one.
- [x] **Q080** `src/combat.js:2699` [duplication] `aiShoveMember` re-states the shove's slam damage as a bare literal `2`, 617 lines from the `slamDmg = 2` default it claims to match<br>      ↳ **DONE — already fixed, verified not assumed.** `aiShoveMember` no longer exists: it was folded into `displaceBody` in an earlier pass, and the comment there records why (the copy had already lost the stun and the prop topple). `slamDmg = 2` is the sole owner; searched for a second literal and there is none.
- [x] **Q081** `src/combat.js:2645` [duplication] aiPullMember drops the hazard-landing damage performPull applies, so an AI pull into live water or fire costs the member nothing<br>      ↳ DONE — billed through memberSurfDamage
- [x] **Q082** `src/combat.js:4696` [duplication] The AI's shoot gate hand-rolls range and asks line-of-sight of rounded tiles, bypassing combat.js's own bodyDist/bodyLos and combat-geometry.verbReaches<br>      ↳ **DONE — and it was a behaviour fix, not a tidy-up.** The gate hand-rolled the distance and then asked line of sight of ROUNDED TILES. Since DEGRID a body rests wherever its walk left it, so the AI could refuse a shot the player is allowed from the same spot, or take one the resolver then re-measured and blocked. It asks `bodyDist`/`bodyLos` now - the same two the player's ranged gate asks. ai 3/3 in file context, including the Executive.
- [x] **Q083** `src/combat.js:505` [duplication] "What counts as a cover cell" is written four times across three modules<br>      ↳ **DONE — `data/tiles.shieldsCell`, next to `blocksSight`.** Five copies, not four: the crouch predicate, the shot resolver, the AI's, and the out-of-combat crouch. One threshold decides both halves (a prop a shot passes over is one you can crouch behind), so the rule lives with the defs. **A fifth-and-a-half was left alone deliberately:** `level-preview.js` counts any solid, so the editor shows `#` walls as cover where the game does not. Switching it broke their test, which encodes walls-count-as-cover - that is a design question, not a copy to collapse. See the question below.
- [x] **Q084** `src/combat.js:2296` [duplication] "Put a shoulder into the partition" is resolved in three places, one of which does not go through the world facade<br>      ↳ **DONE — `world-edits.js`.** The duplicated thing was the PAIRING: a tile's type lives in the grid and its look in the scene, so changing one without the other leaves a partition you can walk through but still see. Written out three times. The out-of-combat copy is the one the finding meant by "does not go through the world facade" - out there is no facade, so the pairing moved somewhere both sides can reach and combat's facade now delegates to it.
- [x] **Q085** `src/combat.js:2736` [duplication] performBreak and aiBreak are two copies of the break-down resolver, identical down to the label expression<br>      ↳ **DONE — one `breakDown`, two callers.** They had already drifted: one went through the world facade for the tile def and the other did not. What legitimately differs is only the bracketing - the player's half bills AP, paper and a use, throws a projectile when the verb has range and checks victory; the AI's picks a random attack line and narrates in the third person. Neither of those is the break.
- [x] **Q086** `src/hover.js:242` [duplication] hover.js and combat.js each carry their own copy of the ring/face drawing primitives, the affordance palette and the cover-aim easing<br>      ↳ DONE — ground-marks.js, shared with hover.js
- [x] **Q087** `src/main.js:1140` [duplication] `approachAndDo` re-implements `bestApproachPath` line for line<br>      ↳ **DONE.** `approachAndDo` called `bestApproachPath` instead of restating its loop. Both landed in `walking.js` in the same pass, which is what made the copy impossible to keep.
- [x] **Q088** `src/main.js:2115` [duplication] The "who joins this fight" filter is written out three times<br>      ↳ **DONE — `combat-geometry.engagedAround`.** Four copies, not three (the sneak sweep is the fourth). It also absorbs the `if (!engaged.includes(primary)) engaged.push(primary)` line that three of the four had written out, because that line only exists BECAUSE of the radius filter it follows.
- [x] **Q089** `src/main.js:2511` [duplication] main.js reimplements combat-plans.topplePlan line for line as oocTopplePlanAt<br>      ↳ **DONE.** `oocTopplePlanAt` was `combat-plans.topplePlan` rewritten against `grid` instead of a facade. One function now: no AP and no turn out here, but a cabinet falls the way a cabinet falls.
- [x] **Q090** `src/main.js:3758` [duplication] main.js's memberSpeed re-derives walk speed instead of using step-rules.speedUnderStatus, and adds a surface term the other two callers do not have<br>      ↳ **DONE, and half of it was not a bug.** The `speedMult` re-derivation was a fourth copy of a one-line rule and now calls `step-rules.speedUnderStatus`; Quiet Shoes needed its own ANSWER (`{}` while sneaking), not its own arithmetic. **The surface term stays, deliberately:** out of combat a sticky floor is paid in wall-clock, in a fight it is paid in AP through `surfaceStepCost` - slowing the animation as well would charge for it twice. Documented in place so the next reader does not "fix" it.
- [ ] **Q091** `src/main.js:2616` [duplication] The out-of-combat crouch is a full parallel implementation of combat's, refusal strings included<br>      ↳ **PARTLY DONE — the refusal ladder is shared, the rest is not.** Both sides call `tactics.crouchProblem` now, so the two refusal strings and their ORDER have one home: a spot cannot refuse "nothing to hide behind" on the map and quietly become a legal crouch the moment initiative rolls. What legitimately differs comes in as two answers (`roomFree`, `faces`) rather than two implementations. **Still parallel:** the cover predicate either side (`oocCoverCell` vs `coverCellFor` - same def rule since Q083, different body test) and the perform half. Left open rather than closed, because the remainder is a real design question about whether the map should own a crouch at all.
- [x] **Q092** `src/ui/screens.js:87` [duplication] The level-up screen re-derives the banked-points sum that `pendingPoints` owns — a fifth surface, on the screen where points are spent<br>      ↳ **DONE.** The level-up screen called `pendingPoints` instead of re-deriving `ap + cp` - the fifth surface for that sum, and the one place where getting it wrong is visible while the player is spending. It still reads `ap` and `cp` separately, because the two rows are labelled separately; only the total is shared.
- [ ] **Q093** `src/god.js:109` [god-method] `god.js buildPanel` is a 595-line god closure with 23 inner functions and six shared mutable variables, and the e2e suite depends on its verbs
- [x] **Q094** `/home/user/escape-work/src/combat.js:2184` [inconsistency] AI_PLAN A4's ratified "a RANGED unit may shove to disengage" carve-out is never wired: the only production caller omits `disengage`<br>      ↳ DONE — same finding as Q047. The doc side checks out verbatim: AI_PLAN A4 carries `[ratified]` with provenance ("Q3 answered A", designer 2026-08-01) and doctrine #11 leans on the carve-out by name. The state this closes is the worst of the three available: ratified, documented in two places INCLUDING the ladder's own comment, and absent from the game.
- [ ] **Q095** `src/combat-ai.js:75` [inconsistency] HR's triage heal has no line-of-sight test and measures tiles, where the player's identical verb requires a clear line and body distance
- [x] **Q096** `src/combat-plans.js:76` [inconsistency] The AI's shove reaches further than the player's and works straight through a partition<br>      ↳ **DONE — [ratified]** (designer, 2026-08-05: "a for both q096 and q097, not sure why wed want it any other way"). `aiShovePlan` takes the player's own gate (`canReach` at REACH.SHOVE) instead of bare tile adjacency. `AROUND` asks only "is that tile next to mine", so a coworker could shove from a diagonal the player could not, and straight across a partition edge the corner rule refuses. Doctrine #9 - forced movement never provokes, so shove is the safe disengage - is a rule about the VERB, and should not reach further in one pair of hands than the other.
- [x] **Q097** `src/combat-plans.js:159` [inconsistency] An action's `range` is measured Euclidean when shooting a body but Chebyshev when breaking a prop<br>      ↳ **DONE — [ratified]** (same answer). A prop's range is measured EUCLIDEAN from the body now, exactly as the same weapon's range is measured at a coworker (`bodyDist`, DEGRID D4: a range is a true-distance circle from where the model stands). It measured Chebyshev off the rounded tile, so one `range: 4` weapon meant two distances depending on the target: a body at (3,3) is 4.24 and refused, a prop on that tile is Chebyshev 3 and allowed - the corners of the square were reachable for props and not for people.
- [x] **Q098** `src/combat.js:476` [inconsistency] A charmed coworker still completes the AI's flanking bonus in `attackMods`, contradicting the branch's own `aiAllies` fix<br>      ↳ DONE — pincer list reads aiAllies()
- [x] **Q099** `src/combat.js:3217` [inconsistency] Take Cover clicked on any body always refuses, contradicting its own tooltip, its arm message and the click branch's comment<br>      ↳ **DONE — `coverSpotFor`.** The click passed the BODY's own tile as the crouch spot, and a body's tile is occupied by definition, so `coverSpotProblem` refused every one with "No room to tuck in there". Three things promised otherwise: the tooltip ("aim at furniture, a tile against a partition, or a TEAMMATE"), the description ("or someone brave"), and the click branch's own comment ("crouching behind your enemy is legal, if bold"). Aiming at a body now resolves to the legal tile beside them nearest you - which is what "you walk over and tuck in" already described. It lives in `performTakeCover`, so the enemy click, the ally click and any future caller all get it.
- [x] **Q100** `src/combat.js:3592` [inconsistency] Topple rings promise a diagonal prop the tile click then refuses, because the ring measures tile adjacency and the click measures body distance<br>      ↳ **DONE.** The ring found candidates by TILE adjacency and the click then measured `inReach` from the body's CONTINUOUS position - since DEGRID a body rests wherever its walk left it, so a tile-adjacent diagonal prop can be beyond REACH.SHOVE. Ring green, click "Too far to shove". `toppleRings` takes the click's own reach test now, so a ring can only promise what the click will do.
- [x] **Q101** `src/combat.js:2038` [inconsistency] A purge aimed at a coworker with no statuses bills 2 AP and narrates success; the same verb aimed at a colleague refuses for free<br>      ↳ **DONE.** A dice-less purge with nothing to clear refuses for free, the way its friendly twin always has (`powers.emptyPayload`). The player was told Reboot worked, watched nothing change, and was down 2 AP. Only the dice-less case - a verb that also swings has a swing to pay for whether or not the purge finds anything.
- [x] **Q102** `src/combat.js:4473` [inconsistency] AI units take a surface's damage but never its status: an enemy walked through fire never burns, and one crossing a paper drift never bleeds<br>      ↳ **DONE — mostly already fixed; one site survived.** The wanderer (actors.js) and the AI's advance (combat-advance.js) both apply `applies` and `bleed` already. `dropOnto`'s hazard landing did not: a body DROPPED into fire took the damage and never caught, while the identical body SHOVED into it did both, because the shove's glide had been fixed and the drop had not. Same pair, same order, at the third site.
- [x] **Q103** `src/data/enemies.js:117` [inconsistency] Class-backed enemies inherit an `attr` block that only the charm path reads, so charming a Manager and charming a Guard produce wildly different characters<br>      ↳ **DONE — [stated]** (designer, 2026-08-05: "everything should be the same in enemies as allies... we arent going to invent parallel implementations"). Resolved wider than filed, because the premise was wrong twice over: the example ("the Guard") was already class-backed, and `attr` was not charm-only — `unitCombat` read `attr.grit` for manhandle saves. The real finding was every OTHER attribute sitting unread on the enemy side while members derived stats from theirs. Now `unitCombat` derives accuracy (Savvy), dodge (Hustle), damage bonus (Savvy), deflect and status resist (Composure) through the same functions a sheet uses; every enemy has an `attr` block to derive FROM (the Manager inherits `middle-manager`'s — a class twin found the same way HR's was; the Executive's is authored, replacing his innate accuracy line); and the `hp`-vs-`maxHp` double spelling is gone, so class-backed enemies inherit the class's health and the lint sees any departure. Charm now builds the same character the fight was already using.
- [x] **Q104** `src/data/talents.js:157` [inconsistency] `statusImmune` is honoured by the status runtime but missing from `TALENT_EFFECT_KEYS`, so the lint rejects the migration the review already recommends<br>      ↳ DONE — one line. No runtime change and no live symptom (no TALENTS entry uses the key yet); what it unblocks is the recommended migration of `paperCutImmune: true` to `statusImmune: ['bleed']`, which the lint refused with the message "nothing reads it" — false, `statuses.js isImmune` reads it and `statuses.test.js` pins it. The comment carries the caveat for whoever does that migration: `applyEffect` REPLACES non-numeric values, so two grantors would clobber rather than union.
- [x] **Q105** `src/main.js:2857` [inconsistency] `applySurfaceOn` still refuses to apply turn-clock statuses out of combat, though the world clock now ticks them<br>      ↳ **DONE — already fixed, verified not assumed.** The `inCombat` gate is gone from `applySurfaceOn`; the comment in floor-effects.js records the removal and the reason ('the gate outlived its reason by three days'). The only `inCombat` left in that file is the slip notification, which is legitimately combat-only.
- [x] **Q106** `src/main.js:2857` [inconsistency] A surface's turn-clock status is still gated on `inCombat`, so fire only sets you alight in a fight — the gate outlived the reason for it<br>      ↳ **DONE — same fix as Q105.** Fire sets you alight wherever you are, and the out-of-combat world clock ticks it down.
- [ ] **Q107** `src/party.js:50` [inconsistency] A member downed mid-fight earns no XP for the rest of that fight, contradicting the design's own "nobody lags"
- [x] **Q108** `src/statuses.js:182` [inconsistency] The step clock has no caller for AI units or wandering coworkers, so a gum wad is permanent on them — ARCHITECTURE.md's "the step clock ticks per tile walked, wherever you are" is false for half the actors<br>      ↳ DONE — the AI walk hook ticks it (Q2-A)
- [x] **Q109** `src/floors.js:59` [soc] floors.js identifies stairs by the literal tile id 'stairway' although the tile def already carries a `stairs: true` flag<br>      ↳ DONE — same finding as Q110, closed once. Reads `defAt(x, z).stairs`, the flag `scene.js:77` already uses. No symptom today because `stairway` is the only tile carrying it; the cost was two owners of "what is a staircase", so a second stair tile added as pure data would have RENDERED as a flight while having no run, no entry and no landing.
- [x] **Q110** `src/floors.js:59` [soc] `floors.js` finds stair runs by hardcoded tile id `'stairway'` while `tiles.js` declares a `stairs: true` flag for exactly that purpose<br>      ↳ DONE — duplicate of Q109, same one-line change.
- [ ] **Q111** `src/hover.js:202` [soc] Out of combat, an armed verb leaves every non-enemy target with no affordance at all — while the click still performs it
- [ ] **Q112** `src/ui/hud.js:319` [soc] The hotbar computes the ammo-affordability rule itself, never surfaces the reason, and does not disable the slot its own header says is disabled
- [ ] **Q113** `/home/user/escape-work/AI_PLAN.md:1018` [test-gap] AI_PLAN's "As landed" claims M2-M6 shipped "as specified" while every e2e spec those milestones name is absent
- [ ] **Q114** `AI_PLAN.md:1013` [test-gap] None of the six e2e specs AI_PLAN names for M1-M6 shipped, and the combat.js half of every new beat has zero coverage — while the doc records the milestones "as specified"
- [ ] **Q115** `playwright.config.js:6` [test-gap] playwright.config.js raises the per-test budget to 120 s but leaves expect.timeout at Playwright's 5 s default, which 52 of the 174 expect.poll sites rely on<br>      ↳ **CAUGHT IN THE ACT 2026-08-03, still open.** `cover.spec.js:177` failed inside a test carrying its own `test.setTimeout(300_000)` — and gave up after **5s**, because a bare `expect(...).toHaveAttribute(...)` never sees the test budget at all. Solo, the same assertion passes and the test takes 48.8s. So this finding does not just cost wall-clock, it manufactures failures that read as regressions in exactly the specs the config comment already blames for false alarms. Fix is `expect: { timeout: ... }` in the config, ideally derived from the same env var the per-test budget wants.
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
- [x] **Q136** `src/looting.js:124` [dead-code] **(carried)** INV_CAP = Infinity leaves the overflow and "pockets full" branches in looting.js unreachable<br>      ↳ **CLOSED BY A DESIGN ANSWER, and not the one this entry asked for.** The finding called the arms dead code; the recommendation put to the designer was to delete them and commit to uncapped pockets. Both lose. **[stated]** (designer, 2026-08-03): "we'll make inventory limit based on a stat, so it needs a variable cap". So the arms are not dead code - they are the guard sites a finite cap will run through, and the thing actually wrong with them was that the cap was a module CONSTANT. It is now `stats.inventoryCapOf(sheet)`, asked per call: the limit rides the character, and the character the pockets panel is showing changes under it. `createInventoryPanel` took the cap once at construction and printed it in the header forever - that was the one place a variable cap could not have reached, and it takes `capOf` now and asks per refresh. `inventoryCapOf` answers Infinity until the stat is picked, so today's behaviour is unchanged. Which stat and what numbers are the designer's, and are not guessed here: Q904.
- [x] **Q137** `/home/user/escape-work/AI_PLAN.md:458` [doc-drift] **(carried)** AI_PLAN's state machine and footgun 8 both say the stall backstop burns real AP; the shipped backstop burns nothing<br>      ↳ **DONE** — both sites. The plan said the stall backstop burns real AP; the shipped `pass` beat bills nothing and simply ends the turn, which already strands whatever AP and allowance are left. Footgun 8 reworded to match, and its stale `combat-ai.js:163` pointer dropped.
- [x] **Q138** `/home/user/escape-work/AI_PLAN.md:9` [doc-drift] **(carried)** AI_PLAN.md still opens with "No code yet" while its own As-landed section reports six shipped milestones<br>      ↳ **DONE** — "No code yet" replaced with what actually shipped: milestones 1-6 on 2026-08-01/02, milestone 7 open by design, pointing at the doc's own **As landed** section.
- [x] **Q139** `/home/user/escape-work/ARCHITECTURE.md:110` [doc-drift] **(carried)** ARCHITECTURE.md's `combat-plans.js` entry lists "take cover" as one of its plans; the take-cover plan was deleted<br>      ↳ **DONE** — and the list was short as well as wrong: `take cover` is a tombstone in combat-plans.js, and `shove` is a shipped plan the map never named. Now `topple, shove, break, pull, displace`.
- [x] **Q140** `/home/user/escape-work/REVIEW.md:187` [doc-drift] **(carried)** REVIEW.md says two modules are missing from the module map; seven are<br>      ↳ **DONE** — and it was worse than "seven": eight modules are missing (`powers`, `portraits`, `stealth`, `ground-marks`, `remote-store`, `data/actor-registries`, `data/looks`, `data/talents`), and a ninth reads as present only because the map's one `creation.js` entry is the unrelated `ui/creation.js`. REVIEW.md's own downstream parenthetical updated so the doc stops contradicting itself.
- [x] **Q141** `/home/user/escape-work/STATUS_PLAN.md:85` [doc-drift] **(carried)** STATUS_PLAN decision 9 still calls charm "designed but not shipped"<br>      ↳ **DONE** — decision 9 marked superseded rather than edited in place: charm SHIPPED, as `remote-session` on the IT track, and fear did not. Worth the words it got, because it shipped by a route the row said was needed and wasn't - combat BORROWS the unit (`charmUnit` + `turns.replace`) so the PLAYER drives it, and `pickTarget`/`aiAdvance` were never touched. The BG3/DOS2 framing carried over from the queue is marked as memory, not a checked fact.
- [x] **Q142** `src/data/companions.js:144` [doc-drift] **(carried)** The mail-room companion comment still names two actions that do not exist ('Return to Sender', 'the snack cart')<br>      ↳ **DONE** — one line: the mail-room kit is Bulk Mail and Courier Route. 'Return to Sender' and 'the snack cart' never existed; Hand-Off is a track grant, already covered by the sentence's "the mail room's own progression".
- [x] **Q143** `src/main.js:142` [doc-drift] **(carried)** The new `?seed=` comment states a falsehood about the code, and the real determinism gap (the stream is never reset per fight) is recorded nowhere<br>      ↳ **DONE, with the gap it names now recorded** — the comment claimed the seed reaches EVERY in-fight roll. It does not: a MEMBER's slip (`maybeSlip`) and a body's loot table (`actors.js` die() → rollLoot) both read Math.random directly. And the determinism gap Q143 says is recorded nowhere is now written at the seam: one stream, built at boot, never reset per fight, so a seed pins the FIRST fight of a run and later ones only replay if everything before them did.
- [x] **Q144** `src/main.js:141` [doc-drift] **(carried)** This branch shipped a comment claiming the initiative rng is still unseeded and that member slips ride the seed - both are wrong, and the shipped code says the opposite two files over<br>      ↳ **DONE** — same rewrite. "slips, loot" became "a UNIT's slip", with the member slip and the loot roll named as the two that escape. REVIEW.md's still-open member-slip finding had both its line numbers rot (`main.js:2171` → 2933, `combat.js:3882` → 4762); refreshed so it still points at code.
- [x] **Q145** `src/main.js:141` [doc-drift] **(carried)** The new seed comment names initiative as the reason a seeded fight does not replay, but initiative already rolls off the injected rng<br>      ↳ **ALREADY CLOSED, verified twice** — the objected-to text was replaced before this pass; initiative rolls off the injected stream (`initRng`), and the current comment says so. Confirmed by an independent re-read rather than taken on one reviewer's word, because closing a live finding is the expensive mistake here.
- [x] **Q146** `src/main.js:141` [doc-drift] **(carried)** The ?seed= comment names a rng gap that combat.js closed — initiative does roll off the injected stream<br>      ↳ **DUPLICATE of Q145**, and closed on the same evidence - the same claim about the same comment in different words. Two of the four `main.js:141` entries were one finding wearing two hats.
- [x] **Q147** `src/combat.js:574` [duplication] **(carried)** combat.js's hazardKind and main.js's surfaceImpactKind order fire and electrification oppositely, and both disagree with step-rules.surfaceEffect's stated precedence<br>      ↳ **ALREADY CLOSED, verified** — both `hazardKind` and `surfaceImpactKind` are now one-line delegations to `step-rules.impactKindFor`, so the fire/electrification order is stated once and the three-way disagreement is gone.
- [x] **Q148** `src/main.js:1541` [duplication] **(carried)** attackOrConfront carries a hand-written a.type ladder that verbKind was made the single owner of<br>      ↳ **ALREADY CLOSED, verified** — `attackOrConfront`'s hand-written `a.type` ladder is gone; it reads the one gate `verbKind` owns.
- [x] **Q149** `src/ui/hud.js:390` [duplication] **(carried)** `fmtAp` now exists twice — the party-bar fix added a second copy instead of consuming the existing one<br>      ↳ **DONE** — and neither copy could have consumed the other: `roundAp` was a closure-local inside `startCombat`, so hud.js had nothing to import and pinned itself to combat's shape BY COMMENT. Both now come from stats.js, which owns the AP rate the rounding exists for.
- [x] **Q150** `src/combat.js:5066` [inconsistency] **(carried)** `spendAp` subtracts raw - a fourth site of the float-AP bug the other three were fixed for<br>      ↳ **DONE** — one line, and the finding's consequence was overstated in a way worth recording: both callers pass whole numbers and every AP reader already defends itself, so nothing was visibly broken. It was the last raw `.ap` write in the file, and "the one that does it differently" is how the other three got written.
- [x] **Q151** `src/ui/hud.js:482` [perf] **(carried)** `levelUpPip.refresh` writes `textContent` and `style` every frame while points are banked<br>      ↳ **DONE** — memoized on the painted count. `setVisible(false)` hides the pip behind the memo's back, so it clears the memo too; without that the next refresh with an unchanged count would early-out and leave the pip hidden with points banked.
- [x] **Q152** `src/ui/readouts.js:128` [perf] **(carried)** `setFocusBanner` tears down and rebuilds its DOM on every hover call<br>      ↳ **DONE** — keyed on the banner's contents, and `sub` is in the key because it carries live HP, so a banner following a target taking damage still updates. The null branch clears the key: it hides the element without touching its children, so a memo that survived the clear would leave a re-hovered target named but invisible. Not a hover-rate problem - main.js re-runs the hover resolve every frame while vision fades or a WASD pan is held.
- [x] **Q153** `src/combat.js:1990` [soc] **(carried)** Content ids still special-cased in systems code: projectile model, impact kind, and the surface-to-FX map<br>      ↳ **DONE** — `paper-airplane` was matched by id in systems code to pick its projectile model. The action carries `flight: 'plane'` now and combat reads `a.flight || (a.ammoCost ? 'ball' : 'shot')`. Checked identical for all five ranged actions. The other clauses were already closed: `impactKindFor` owns the impact kind, and the surface FX map is data.
- [x] **Q154** `src/combat.js:3834` [soc] **(carried)** Combat's summon ladder never supplies `room`, so the shared rule's headcount leg is skipped in a fight — and resolveSummon re-derives the cap math the module owns<br>      ↳ **DONE** — and the name collision that caused it is gone too. combat.js had a local `summonRoom` meaning "how many actually arrive" while summon-rules exports a `summonRoom` meaning "how much headcount is free" - two meanings, one name, and main.js imports the module's. The local is now `postableNow` and composes the module's two rules (`dropCount(d, capRoom(...))`) instead of restating the arithmetic; the preview's `room:` field asks the module's own question directly.
- [ ] **Q155** `src/combat.js:4829` [soc] **(carried)** The `window.__combat` / `__game` / `__god` debug surfaces are ~420 lines living inside the two god closures, and `__game.classes` hands out the live registry
- [x] **Q156** `tests/e2e/camera.spec.js:195` [test-gap] **(carried)** camera.spec.js still skips its steered-camera leg on a dice roll, although this branch shipped the seeded-initiative lever the review asked for<br>      ↳ **DONE** — `seed: 4` pins the roll and the `test.skip` is an assert. The seed was MEASURED rather than derived: a throwaway probe read `__combat.order` across six seeds, and 4 rolls the Office Drone 24, IT Support 13 and the Manager 10, which puts both party slots first and consecutive. Seeds 2 and 6 also steer; 1, 3 and 5 give no shared turn at all - so the skip was not a rare event, and this leg had been reporting GREEN while proving nothing on roughly half its runs, with nothing anywhere recording how often it actually ran. The header now states the measured rolls instead of describing a dice outcome. 4/4 green.
- [x] **Q157** `tests/e2e/hit.spec.js:44` [test-gap] **(carried)** Six e2e sleeps wait for "camera settle" while helpers.js exports stableProject, which polls that exact condition<br>      ↳ **DONE for the four game-context sites; the two EDITOR ones stay, and that is the finding being half right.** `stableProject` polls `__game.project`; the editor camera is `__editor.project`, so converting those wants a second helper rather than this one. hit.spec.js and game.spec.js collapse a sleep AND a manual projection into the one call, which also moves the settle to immediately before the projection - it had been sitting at the top of a loop with an AP poll and an arming click between it and the click. classes.spec.js's Detain loop settles on the PLAYER: a settle aimed at the TARGET can be satisfied by the target coming to rest somewhere new, which is not the question, and is a mistake made for real earlier the same day on throwing.spec.js. 12 green across hit, game and classes.
- [x] **Q158** `tests/unit/actors.test.js:1` [test-gap] **(carried)** GridActor.update - the waypoint stepping and onTile tile-change detection that drives exits, surface damage and the AI's own notifyStep - has no test, though it runs headless with a six-method stub<br>      ↳ **DONE** — three cases, and the finding was right that the six-method stub is all it takes: no anim component and no leg nodes, so `setClip` and the leg settle no-op and the lazy `pc` handle is never resolved. They pin the two things everything downstream leans on: `onTile` fires once per tile ENTERED and once more on arrival with `changed` FALSE (so the exit gets its call without surface damage being re-applied to a tile already crossed), and a bend consumes the whole frame's budget rather than stopping at the waypoint. A third covers the de-grid case where the walk stops short of a tile centre, so `Math.round` never crosses a boundary and only the arrival leg fires. Each verified against a mutant: forcing `changed` true, dropping the `|| finished` leg, and stopping at each waypoint are all caught, each by the test that claims it.
- [x] **Q159** `src/combat.js:1785` [bug] `makeActive` writes an out-of-range `party.active` while a charmed coworker holds the floor<br>      ↳ **DONE.** Confirmed: a charmed coworker is `isCharmed`, never `isSummon`, and is appended to `members` after the real roster - so `makeActive` wrote an index past the end of `party.members`, and everything keyed off `party.members[party.active]` read undefined until a real member's turn came round. Guarded on the roster's own RANGE rather than a growing list of exceptions, so the next kind of borrowed body cannot reintroduce it. `charm` 1/1.
- [x] **Q160** `src/combat.js:631` [bug] `guardStandingAt` has no side test, so an enemy holding Hold the Line shields a party member and vice versa<br>      ↳ **DONE.** Confirmed: `guardStandingAt` asked only "is somebody holding a guard stance on this tile", so an enemy holding the line was cover for the party member they were holding it against, and the party's own guard did the coworkers the same favour. It takes the DEFENDER now and reads sides live (`aiAllies`), the same rule the pincer test uses - so a charmed coworker shields the player this turn. `tactics` 8/8.
- [x] **Q161** `src/combat.js:341` [bug] billMove rounds the free-AP deduction, so a 0.05-cost move never depletes the freeMoveAp allowance<br>      ↳ **DONE.** Confirmed as a rounding ratchet: the allowance's running total went through `roundAp` (tenths), so a step costing 0.05 took 0.05 off 1.0 and rounded 0.95 straight back to 1.0 - unlimited free movement in 0.05 doses. The allowance keeps its exact remainder now and only the AP tag rounds it (`fmtAp`); float dust below 1e-9 snaps to zero. Real AP still rounds, which is the currency the player reads and errs toward charging.
- [x] **Q162** `src/creation.js:171` [bug] createCharacter banks a point per spend but spendAttrPoint silently refuses unknown attribute names, leaving free points on the sheet<br>      ↳ **DONE, with a red-first test.** Confirmed: the points are banked before the spends run, and `spendAttrPoint` refuses an attribute name it does not know - leaving the point banked. So a malformed draft did not hand out free attributes (which the banking-first order was written to prevent) but did hand out free POINTS, spendable on anything at the next level-up. A refused spend takes its point back now.
- [x] **Q163** `src/editor.js:595` [bug] The editor's localStorage writes are unguarded, so in a storage-blocked browser "Exit editor" cannot exit<br>      ↳ **DONE.** Confirmed - these were the last unguarded `localStorage` touches in the codebase. The worst is Exit: the `removeItem` throw ate the two lines that actually LEAVE, so in a storage-blocked browser the one button whose job is to get you out of the editor could not, with no error and nothing to try next. Reset and Exit swallow it; Playtest is the one case worth reporting, because without the stash there is nothing to boot - it says so and stays put rather than reloading into the shipped level as though it had worked. `editor` 2/2.
- [x] **Q164** `src/editor.js:400` [bug] Any editor resize button silently deletes every row/column past MAX_SIZE on a level larger than 40<br>      ↳ **DONE.** Confirmed: `resize` clamped BOTH axes to `MAX_SIZE` unconditionally, and the editor happily loads a level bigger than that - so on a 60x60, pressing any resize button, including one for the other axis, silently deleted every row and column past 40 before it grew anything. The clamp binds only in the direction asked for: growth still stops at MAX_SIZE, shrinking still stops at MIN_SIZE, and an axis with no delta is not touched at all. `editor` 2/2.
- [x] **Q165** `src/main.js:1473` [bug] `examineTile` calls any tile with a body standing on it "a cubicle wall"<br>      ↳ **DONE.** Confirmed, and the cause is one word: `examineTile` gated on `isWalkable`, which also refuses a tile somebody is STANDING on. So examining the floor under a coworker fell through the entire solid ladder and came out at the last-resort "A cubicle wall. It has seen things." - on plain carpet. It asks `grid.terrainOpen` now. What is underfoot does not change because somebody is on it.
- [x] **Q166** `src/shading.js:294` [bug] `makeSpriteMaterial` has no failed-texture fallback, so a missing foliage PNG renders as a solid tinted rectangle<br>      ↳ **DONE.** Confirmed: the card's alpha comes ENTIRELY from the opacity map, so a texture that fails to load leaves the material at a uniform opacity of 1 and the plane renders as a solid tinted rectangle - a missing bush PNG becoming a flat green slab across the office, which reads as a broken level rather than a missing file. The error handler makes it invisible now; the console warning is still how you find out.
- [x] **Q167** `src/statuses.js:163` [bug] A status id that leaves the registry is immortal on an existing save: never ticked, never expired, invisible to both sweep options<br>      ↳ **DONE, with a red-first test.** Confirmed and worse than "never ticked": the tick skipped an unknown id, and BOTH sweep options passed over it too - `harmfulOnly` reads `def.harmful`, the combat-end sweep reads `def.clock`, and an absent def fails both, so each spared what it could not classify. The one id no sweep could classify was the one id no sweep would take, and `hasStatus` went on answering yes forever. Dropped on sight by the tick and by any sweep.
- [x] **Q168** `src/statuses.js:107` [bug] `applyStatus` returns true for a non-finite duration and leaves an entry no clock can ever reach<br>      ↳ **DONE, with a red-first test.** Confirmed: `dur <= 0` is false of NaN, so a NaN duration wrote `left: NaN` - an entry no clock can decrement and no reader counts as present - and `applyStatus` still returned true, so the caller narrated and billed for a status that was never applied. Infinity got in the same way and could never expire. The gate is `Number.isFinite` and positive now.
- [ ] **Q169** `src/combat-geometry.js:176` [dead-code] edgeShieldedTile is dead and encodes a cover rule the game no longer uses
- [ ] **Q170** `src/combat.js:3568` [dead-code] The purge self-cast branch in `handleTileClick` is unreachable dead code
- [ ] **Q171** `src/combat.js:3811` [dead-code] `commitInstant`'s heal arm and `INSTANT_CONFIRM`'s 'heal' entry are dead - no `type: 'heal'` action exists
- [ ] **Q172** `src/data/actions.js:13` [dead-code] `type: 'heal'` is dead in three code sites and still documented as a live verb in the action registry header
- [x] **Q173** `src/data/surfaces.js:87` [dead-code] `GUM` in data/surfaces.js is now an unimported export whose numbers are hand-mirrored into the `gum` status<br>      ↳ DONE — same finding as Q174, closed once. Deleted, not reconciled: the `gum` surface only names the status in `onEnter.applies`, so data/statuses.js already owns the duration and both multipliers. The two comments that pointed AT the dead export (data/statuses.js, data/enemies.js) now point at the live one — they were the thing keeping it looking authoritative.
- [x] **Q174** `src/data/surfaces.js:87` [dead-code] `GUM` is exported from data/surfaces.js and read by nothing — a dead second source of truth for the gum numbers<br>      ↳ DONE — duplicate of Q173, closed by the same deletion.
- [x] **Q175** `src/stats.js:129` [dead-code] Three of the five `STEALTH` constants in stats.js are read by nothing; the real values live in data/statuses.js and data/talents.js<br>      ↳ DONE — exact as written: `SPEED_MULT`, `AMBUSH_DMG` and `CONE_SHRINK` had no reader, and each matched its live twin to the digit (`sneaking.effects.speedMult` 0.7; `ambushDamage` 0.4; `coneShrink` 15) — a second source of truth that would only have been noticed by tuning one of them and watching nothing happen. The two survivors stay on purpose and the block now says why: a cone is GEOMETRY, which stealth.js asks for as a system; the other three are CONTENT, and content lives in `data/`.
- [ ] **Q176** `src/statuses.js:184` [dead-code] `clearStatuses`'s `clock` and `harmfulOnly` options have no production caller, and the doc above them describes a combat-end sweep that no longer exists
- [x] **Q177** `src/ui/creation.js:277` [dead-code] `ui/creation.js` imports `draftName` and never calls it — the summary re-derives the display name by hand<br>      ↳ **DONE, and it was not merely a stray import — the two answers DISAGREE.** `draftName` runs `cleanName`, which collapses internal whitespace and falls back to the job when the field is blank; the hand-rolled `(draft.name || '').trim()` does neither. So an empty name box previewed ", they/them, Intern." while the character actually created was named Intern — a preview lying about its own outcome, on the screen whose only job is to show you what you are about to get. The summary calls `draftName(draft)` now, which is what the import was always for.
- [x] **Q178** `src/ui/hud.js:486` [dead-code] `createTacticalButton().setVisible` and `createLevelUpPip().setVisible` have no callers anywhere<br>      ↳ DONE — both verified dead (the two live `setVisible` calls in main.js are the hotbar's and the party bar's) and both deleted. Checked the trap first, because "dead code" and "a call somebody forgot to make" look identical: the pip is genuinely hidden today, by main.js folding `!modalOpen()` into the COUNT it passes to `refresh()`, which drives the memo instead of going behind it — so the deleted arm was the second of two ways to hide one pip, and the worse one.
- [ ] **Q179** `.github/workflows/ci.yml:83` [doc-drift] CI's `[quick]` lever is inert on every branch, the exact defect the same file documents as forced-fixed for `[e2e]`
- [ ] **Q180** `/home/user/escape-work/AI_PLAN.md:629` [doc-drift] AI_PLAN's architecture section places `entrenchPlan`, `shootPlan` and `supportPlan` in `combat-plans.js`; none of the three exists there
- [ ] **Q181** `/home/user/escape-work/AI_PLAN.md:136` [doc-drift] AI_PLAN's file:line citations are stale throughout, including the "Do not touch" list and the Brief that milestone 7's executor is told to follow
- [ ] **Q182** `/home/user/escape-work/AI_PLAN.md:202` [doc-drift] Three `[ratified]` tags in AI_PLAN cite nothing, and the twelve-arm ladder order — the doc's declared centerpiece — carries no tag at all
- [ ] **Q183** `/home/user/escape-work/AI_PLAN.md:483` [doc-drift] AI_PLAN's published `AI` tunables block and scored-choice signatures do not match the shipped ones
- [ ] **Q184** `/home/user/escape-work/POWERS_PLAN.md:735` [doc-drift] POWERS_PLAN's "Open after M9: the enemy HR Representative" still says the support-enemy option is blocked by risk 7; AI_PLAN M6 shipped it
- [x] **Q185** `/home/user/escape-work/src/data/enemies.js:3` [doc-drift] `data/enemies.js`'s header still says attack lines are "picked at random each enemy turn"<br>      ↳ DONE — three errors in one clause, not one: it is per SWING not per turn, the draw is WEIGHTED (`pickLine` over `combat-ai.lineWeights`, STATUS_WEIGHT for a line whose status the target is not wearing), and it predates M5's pool split so it implied one flat pool where there are two that are never drawn from together.
- [ ] **Q186** `TODO.md:733` [doc-drift] TODO.md's open "Collapse the two action bars" item describes code that no longer exists, and contradicts the DONE item above it
- [x] **Q187** `src/combat.js:4343` [doc-drift] `bout.oaCount` counts both sides' opportunity attacks, not "enemies' own provokes" as M3's acceptance reads it<br>      ↳ **DONE, and fixed as CODE rather than as doc.** The finding is filed doc-drift, but the counter exists to serve one acceptance criterion — M3's "oaCount (enemies' own provokes) down" — and counting both sides makes it unfit for that: mixed, it can RISE while the AI gets strictly better, because a player's mistakes land in the AI's score. Gated on `aiAllies()`, the owner Q011 established for side, so a charmed coworker counts as yours. Overwatch stays outside the count deliberately (a held stance that fires is not a provoke, and no routing choice avoids it) and that is now written down. Free to correct now precisely because Q117 is true — nothing reads the tally yet.
- [ ] **Q188** `src/data/actions.js:13` [doc-drift] data/actions.js documents a `heal` action type nothing uses and omits four types that exist; three dead `heal` branches remain in code
- [x] **Q189** `src/data/statuses.js:193` [doc-drift] The take-cover status's doc block is stranded above `sneaking`, so `covered` is undocumented and `sneaking` wears two comments<br>      ↳ DONE — the crouch block moved down to sit on `covered`, where it was describing all along, and `sneaking` keeps only its own. Fixed while in the file for Q175; the two entries were adjacent in more than the queue.
- [ ] **Q190** `src/main.js:1514` [doc-drift] `oocFriendlyOn`'s header promises it spends the action's `uses`; the body spends nothing
- [ ] **Q191** `src/shop.js:17` [doc-drift] shop.js names `matches` and `half-sandwich` as the items worth nothing; both carry a `value` and one is stocked by a merchant
- [x] **Q192** `src/stats.js:423` [doc-drift] `weaponProc`'s doc comment sits above `moveCostOf`, so both functions are misdocumented<br>      ↳ DONE — fixed while in the file for Q054, which is the finding that made it matter: the stranded block is part of why `moveCostOf` looked complete.
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
- [x] **Q211** `src/combat.js:4444` [inconsistency] The destination scorer asks aiCrouchCovered without the bodyAt test the crouch beat supplies, so it scores tiles by a narrower cover rule than the one it will find on arrival<br>      ↳ **DONE.** The scorer omitted `bodyAt`, grading tiles by props alone while the crouch beat it walks there to take counts standing bodies too - so a unit walked past cover it was about to be offered, and a destination scorer that grades by a narrower rule than the one it will meet is choosing on the wrong map. Same predicate both sides now.
- [x] **Q212** `src/data/statuses.js:212` [inconsistency] `fx.burst: 'none'` is not in the runtime's vocabulary — it falls through to the loudest burst ('pop')<br>      ↳ DONE — the burst half of Q053, closed by the same change: `statusBurst`'s 'pop' arm was a bare `else`, so it is now `else if (mode === 'pop')` and an unknown mode shows nothing. The harmful/harmless default still covers OMITTING the key, which is the case that should keep working.
- [x] **Q213** `src/god.js:104` [inconsistency] God-mode pins write raw, bypassing the setter the edit path deliberately routes through<br>      ↳ **DONE.** The pin carries the field's setter and the per-frame hold writes through it, exactly as the edit box does. It wrote raw, so a field whose setter enforces an invariant - the purse clamps to a whole number at or above zero - had that invariant honoured when you typed the value and bypassed sixty times a second afterwards. Pinning was the one way to hold a value the setter exists to refuse.
- [x] **Q214** `src/hotbar-model.js:89` [inconsistency] `combatOnlyReason` gives a factually wrong refusal for six verb types and returns "usable" for an unknown action id<br>      ↳ **DONE — both halves.** An unknown id returned `null`, the same answer a live attack gets, so a slot holding a stale id drew ENABLED; it refuses now. And the single catch-all sentence is replaced by a reason per type, because a refusal that is factually wrong teaches the player something untrue: a dash was refused as though it were an overwatch stance, when the real reason is that out here there is no AP to buy distance with and you can just walk. Two unit tests, one of which asserts every refusal NAMES the verb it refuses.
- [x] **Q215** `src/main.js:2629` [inconsistency] Out-of-combat Take Cover accepts a tile a summon occupies; combat refuses the same tile<br>      ↳ **DONE.** The out-of-combat occupancy test listed enemies, NPCs and party by hand and left off SUMMONS, where combat asks `unitStandingAt` which includes them. A temp you had just posted was the one body you could crouch on top of - and the moment a fight started the same tile refused.
- [x] **Q216** `src/main.js:3486` [inconsistency] The shove aim ring promises a partition topple the click silently refuses<br>      ↳ **DONE — `oocShoveSide`.** The ring asked "does any wall edge touch this tile"; the click asks "is there a partition edge whose far side I can stand on". A partition backing onto solid wall lit the ring, and the click refused by returning `false`, which says nothing at all. Both call the same function now.
- [ ] **Q217** `src/stats.js:517` [inconsistency] `take-cover` and `pull` land in the class-powers bucket, unlike the third universal verb `shove`
- [x] **Q218** `src/ui/hud.js:430` [inconsistency] The party-bar HP bar neither clamps nor divide-guards its width, while the profile card two hundred lines above does both<br>      ↳ **DONE — one `hpFracOf`.** The party bar neither clamped nor divide-guarded while the profile card two hundred lines above did both. The divide-guard is the half that mattered: `maxHp` of 0 (a half-built or wiped sheet, for one frame) produced `NaN%`, and a browser handed `NaN%` silently keeps the previous width - so the bar FREEZES at its last value rather than looking broken.
- [x] **Q219** `src/grid.js:159` [other] doorKeyBetween and wallEdgeOpen silently answer a diagonal pair with an x-axis edge instead of refusing it<br>      ↳ **DONE, with a test.** `doorKeyBetween(0,0,1,1)` returned `'v:1,0'` - a real edge, between two cells that share none, because the first `nx > x` test won and the diagonal fell through it. Both lookups refuse a diagonal now (`null`, and `false` for the open test), which is what "these cells share no edge" means.
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
## Questions for the designer

- **Does the editor's cover preview mean the same thing the game does?** They
  currently disagree, and both readings are defensible.

  The game's rule (TACTICS_PLAN M6a) is one threshold for two questions: a solid
  short enough to shoot OVER is a solid you can crouch behind, and a `#` wall is
  neither - a shot cannot pass it at all, so "cover" against it is moot. The
  editor's `coverMap` counts any solid, walls included, and `level-preview.test`
  pins that.

  So a room whose only shelter is its outer walls previews as sheltered and
  plays as open ground.

  - **A — the preview matches the game** (one rule, `shieldsCell`): an author
    sees the cover the fight will actually grant. Costs a red test to update,
    and rooms that look bare in the preview really are bare.
  - **B — leave it** (the preview means "how enclosed is this tile"): a wall IS
    shelter in the ordinary sense, and the preview is about placement, not about
    the shot resolver.
  - I would pick **A**, because the preview's stated purpose is "derivable from
    the same rules the game uses" - but B is a coherent thing to mean and it is
    your call, so nothing was changed.

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
- **No automatic healing.** Two rules struck 2026-08-02 `[stated]`: enemies do
  not autoscale with floor depth ("things shouldnt autoscale thats absurd… by
  floor i mean. thats just lazy" — see `PROGRESSION_PLAN.md` decisions 13–14),
  and the party is not healed between floors ("i also never asked for auto
  healing between floors"). Both were **presumptions, not asks** — the floor
  curve was a plan doc's own recommendation, and `STAIRWELL_HEAL`
  (`main.js:384`) never appears in any plan doc's decision table at all. Its
  entire justification is a code comment.
  - **All three automatic revives are struck, and they had to go together.**
    `STAIRWELL_HEAL` (between floors) and `VICTORY_HEAL` (after every won fight)
    both healed the standing AND stood the fallen back up. So did `helpUp`, the
    free walk-over hand up — the one this entry originally missed, and the one
    that would have made striking the other two cosmetic.
  - **The hidden revive.** `stairwellHeal` was `min(maxHp, max(hp, 0) + amount)`,
    and that `max(hp, 0)` was quietly the only thing standing a downed character
    back up. Deleting the heal deleted the revival, which is why the replacement
    had to land in the same change rather than after it.
  - **H1 answered: option C** `[stated]` (designer, 2026-08-02: "c"). Downed
    characters stay downed — across a victory, across a floor transition — and
    are revived only by an item carrying `revive` (`data/items.js`), spent
    through `helpUp` out of the helper's own pockets. The first one is the
    Expired First-Aid Kit: 4 HP, one use, uncommon in break rooms, occasionally
    filed in cabinets, and reliably stocked by the mail-room cart so a run can
    BUY the thing it depends on.
  - **H2 resolved with it.** `VICTORY_HEAL` went too. It was flagged as a
    separate question, but option C answers it: "revivable only by an item or a
    power" cannot coexist with a rule that revives everyone for free after every
    fight. Healing is now entirely item-driven, so
    `ECONOMY_PLAN.md:466`'s per-floor heal budget is the number to watch first
    in playtest.
  - **The wipe guard needed no work.** `downOrLose` (`main.js`) already ends the
    run when nothing is left standing; option C just makes that reachable in one
    more way, which is the intent.

## E2e status in this environment (measured, with the method stated)

### The 2026-08-03 queue pass: 71 tests, one non-reproducing failure

Method, stated because the last pass's headline number was ruined by not
stating it: **one Playwright run at a time, never two, and no rebuild while a
run is in flight.** Every run below is the whole machine.

| run | specs | result |
|---|---|---|
| Q907 verification | charm, summons, surfaces | **9 / 9** |
| batch 1 | smoke, party, portraits, sneak, ooc-cone, progression | **27 / 27** |
| batch 2 | ai, tactics, cover, degrid, creation, editor, camera | **28 / 29** |
| cover.spec SOLO | cover | **7 / 7** — the batch-2 failure does not reproduce |

The one failure was `cover.spec.js:171` "take cover walks you in behind the
desk", and it is worth recording WHERE it failed: line 177, the very first
assertion, **before** `enterCombat` — and it gave up after 5s inside a test
whose own budget is 300s. That is not the test's budget at all, it is
Playwright's `expect` default, which is exactly **Q115**, still open. Solo the
same assertion passes and the test runs 48.8s. So this is evidence FOR Q115
rather than a regression, and the next person to see a 5s timeout in a 120s
test should suspect the same thing before bisecting.

**One caveat on the Q907 run, stated rather than buried:** a `npm run build`
landed between its tests 7 and 9, so those two ran against a slightly newer
bundle. The only behavioural delta in that rebuild was `bout.oaCount`'s side
gate, which no test reads (Q117), so the verification stands - but it should
not have happened, and it is why "no rebuild while a run is in flight" is now
written into the method above rather than assumed.



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
- [x] **Editor playtest must not wipe the campaign save.** Done in
      `loseGame()` and the exit handler, and the THIRD site this entry missed -
      the game menu's `menu-restart`, which was ungated and also removed the
      stash, so "Restart run" during a playtest deleted the campaign save, its
      cloud row, and the level being edited. All three gate on `playtesting`
      now, and the menu item reads "Restart this level" while playtesting.
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
- [x] ~~**Ranged walk-in asks a melee question**~~ — DONE. Both sides route to
      a firing position through the shared pure rule `routeToFiringPosition`
      (`pathfinding.js:440`): combat via `routeIntoRange` (`combat.js`), out of
      combat via `bestFiringPath` (`main.js:1289`), each cached and each
      under-promising the circle the arrival check measures. Verified
      2026-08-02 while wiring the AI's own firing-tile search (AI_PLAN M5),
      which asks the same question from the other side. Original entry:
      **Ranged walk-in asks a melee question** (`combat.js:2020-2056`): the
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
