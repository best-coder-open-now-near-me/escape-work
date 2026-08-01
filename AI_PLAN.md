# Enemy AI Difficulty Plan

Make the enemies play the game we already built. The ask `[stated]` (task,
2026-08-01): *"make a plan to upgrade our ai's difficulty"* — into a game the
designer has already sized up: *"the game is laughably easy right now"*
(designer, 2026-07-31, recorded in `POWERS_PLAN.md` M9). This document is the
implementation plan: what the AI decides today, where its game is smaller than
the player's, the milestone order for closing that gap, and the design
decisions with their tags. No code yet.

The thesis, up front: **the AI's difficulty problem is decision quality, not
numbers.** The numbers already have an owner — `stats.scaleEnemy` grows HP,
damage, AP and accuracy by floor depth (`stats.js:323`), and every plan defers
magnitudes to playtest. What no system owns is that the AI plays six beats
(`combat-ai.js:149`) against a player holding the whole verb set: it never
shoots, never shoves a body, never breaks or topples a partition, never pulls,
never heals, never picks a target for a reason beyond "nearest", and walks the
shortest route through fire it could walk around. Every one of those verbs is
already built, priced, and tested from the player's side. Most of the work
below is wiring beats into a ladder that already exists, against plan
functions (`combat-plans.js`) that were deliberately built shared so "the
click, the hover and the AI" agree.

## Questions for the designer

Per `CLAUDE.md`: autonomous session, so nothing blocked on these — every
answer below is guessed and tagged `[proposed]` in the decisions table, and
the plan says what changes if the real answer differs. They are ordered by how
much of the plan's shape they move.

**Q1 — Ranged enemies: arm one now?** No shipped enemy has a ranged attack,
so the entire defensive half of the cover game — your crouch, human shields,
pull-over as a counter — is player-side future-proofing with zero live value
(`TACTICS_PLAN.md` M6 scope notes). My recommendation is **A**.

- **A (recommended): arm an existing enemy** — one ranged entry in
  `data/enemies.js` `attacks` plus the shoot/reposition beats (milestone 5).
  Cost is one data entry and one milestone; it switches on a whole shipped
  system and is the single highest-leverage difficulty change available.
- **B: a new ranged enemy type.** Same activation plus a new face; costs
  content, a model, and a placement pass on the levels.
- **C: stay all-melee.** The crouch keeps zero player-side value and cover
  stays a one-way game; milestone 5 drops out of the plan and difficulty
  leans entirely on melee smarts.

**Q2 — Target selection: how mean?** Today: nearest engageable member,
wounded as a tiebreak (`combat-ai.js:57`). My recommendation is **B**.

- **A: full focus fire** — always the finishable or frailest target, switch
  the moment a better kill appears. Deadliest and cheapest to build; reads as
  bullying, and every enemy plays identically.
- **B (recommended): one scoring rule, per-enemy discipline in data** — the
  Executive focus-fires, the Manager harasses whoever is nearest, Security
  stays on the target he has. One field per enemy def; fights gain archetype
  personality; slightly more to tune.
- **C: keep nearest-engageable.** Zero work; the positioning and verb
  milestones still land, but enemies keep spreading damage at random.

**Q3 — The deferred cover-denial verbs: all four now?** AI partition
toppling, break-down, and Pull Over were explicitly deferred `[proposed]` in
`TACTICS_PLAN.md` M8 ("the AI neither breaks barriers nor pulls in v1");
shove-at-bodies was never an AI beat at all. The plan halves are already
shared pure functions (`combat-plans.js`), so these are wiring, not systems.
My recommendation is **A**.

- **A (recommended): all four beats in one milestone (milestone 4).** The
  cover economy becomes two-sided — enemies uproot your crouch the way you
  uproot theirs, which is what decision #11's symmetry has meant all along.
  Cost: four beats to order and tune instead of one.
- **B: Pull Over only.** The scariest and most legible one (a Manager hauling
  you over your own desk); cheaper, but break/topple stay one-way and the
  symmetry claim stays half-true.
- **C: keep them deferred.** Crouching stays strictly better for the player
  than for enemies; milestone 4 drops out.

**Q4 — Should the enemy side get support behavior?** Enemy HR still summons
(`data/enemies.js:134`), but the class she inherits from now owns the game's
only heal (`POWERS_PLAN.md` decisions 16–18) and her AI never uses it. There
is a real tension to weigh: M9 cut healing from five classes *because it was
a ritual* — an enemy heal-sponge could reintroduce that tedium from the other
side. My recommendation is **A**, with the ration doing the work.

- **A (recommended): HR heals a wounded ally she can reach, rationed like
  the player's triage, and stands behind her summons.** Creates the classic
  "deal with the healer first" objective — target priority becomes a
  decision, which is what the whole tactics stack exists to reward. Fights
  get somewhat longer.
- **B: summoner positioning only, no enemy heal.** Cheaper, and keeps M9's
  "healing is scarce" direction perfectly clean on both sides.
- **C: neither.** HR stays a summon timer with legs; milestone 6 shrinks to
  attack selection.

**Q5 — A difficulty selector, or one tuned game?** Nothing in the repo has a
difficulty setting today. My recommendation is **A**.

- **A (recommended): no selector in v1.** One game, tuned harder; every new
  AI magnitude lives in one tunable block so a selector later is a multiplier
  away, exactly how `HIT`/`TACTICS` constants work now. (The reference games
  agree — their modes are mostly stat-and-loadout packages over one shared
  brain; see the looked-up section.)
- **B: a numbers-only selector now** — e.g. a difficulty offset feeding
  `effectiveLevel` (`stats.js:366`), which the engine would take today.
  Cheap mechanically, but commits UI, save-format and triple-balance surface
  before the single game is even hard.
- **C: behavior modes** (docile AI on easy, full ladder on hard). Most
  expensive, and a permanent tax: every future beat needs a per-mode answer.

## What "difficulty" means here (scope)

Two levers are deliberately **not** this plan's:

- **Numbers.** `scaleEnemy` owns the curve (`stats.js:323`); the seniority
  variants and per-placement levels are `CHARACTER_PLAN.md`'s open business
  (its decision #15); elite modifiers are `PROGRESSION_PLAN.md`'s stretch
  seam (its decision #12). This plan adds no stat inflation — if the smarter
  AI overshoots or undershoots, the dials are already there and playtest owns
  them, as every prior plan agreed.
- **Encounter content.** More bodies per floor, nastier placements, new enemy
  types beyond Q1's one ranged loadout — that is level authoring, now with
  its own editor (`EDITOR_PLAN.md`). A smarter brain makes every future
  encounter better; a bigger roster with today's brain stays laughably easy.

What is in scope: **the decisions.** Target choice, stand-tile choice, verb
choice, and the beats the AI has never had — using systems that already
exist, at the prices the player already pays.

## Where the AI is today

The audit, so the gap is on the record. The brain is
`src/combat-ai.js` (168 lines, pure, fully unit-tested —
`tests/unit/combat-ai.test.js` pins the ladder order, the targeting rule, the
stand-tile routing and the crouch test); the doing is `combat.js`'s AI arm
(`combat.js:4297-4381`).

**What it has:**

| Behavior | Where | Note |
| --- | --- | --- |
| Beat ladder: summon → topple → attack → advance → crouch → pass | `combat-ai.js:149` | The order IS the design; each beat outranks what it strictly beats |
| Summoner reinforces before wading in (HR) | `combat.js:4324` | Cooldown-paced, capped (`data/enemies.js:134`) |
| Topples furniture onto members | `combat-plans.js:54` | Same plan and price as the player's shove-topple — "both sides push for the same" |
| Nearest engageable target, wounded tiebreak | `combat-ai.js:57` | Engageable outranks near (the M3 anti-stall fix) |
| Random attack line from `def.attacks` | `data/enemies.js:3` | Statuses (gum, confused, blinded, stunned) land by luck, not intent |
| Crouches when boxed in and actually shielded | `combat.js:2445` | Enemies take cover in v1 `[ratified]` (2026-07-30) |
| Takes and suffers opportunity attacks | `combat.js:4159-4164` | Symmetric by construction (M1's shared assembler) |
| Flank/backstab/cover apply to its swings | `TACTICS_PLAN.md` M1 | Passively — it benefits if it happens to stand right |
| Pays surface taxes, slips, catches gum | `combat.js:4152-4206` | The floor treats both sides alike |
| Scales by floor depth | `stats.js:323` | HP/damage/AP/accuracy curve, native tier respected |

**What it never does, though the system is shipped and priced:**

| Missing | The system it ignores | Status in the record |
| --- | --- | --- |
| Shoot | The whole ranged stack: range, LOS, ammo, cover, crouch redirects | "no shipped enemy has a ranged attack" (`TACTICS_PLAN.md` M6) |
| Shove a body | `displacePlan` (`combat-plans.js:177`), hazards, wall-slam, shove-as-disengage | Never an AI beat |
| Topple a partition | `toppleEdge` / partition M8 machinery | "The AI does not yet topple partitions (furniture only) — a follow-up" (`TACTICS_PLAN.md` M6) |
| Break cover down | `breakPlan` (`combat-plans.js:69`) — already shared with the AI in mind | Deferred `[proposed]` (M8) |
| Pull Over | `pullPlan` (`combat-plans.js:122`) — likewise shared | Deferred `[proposed]` (M8) |
| Heal or buff | The action system entirely — enemy defs carry inline `attacks`, not `actions` (`TODO.md:852`) | Enemy HR's class now owns triage (`POWERS_PLAN.md` 16–18) and her AI can't reach it |
| Choose targets for a reason | `positionMods`, HP, kill math — all queryable | Nearest + wounded tiebreak only |
| Choose stand tiles for a reason | `isFlanked` / `isBackstab` / `provokedBy` / `surfaceStepCost` — all pure, all exported | `standTilePath` returns the shortest route, full stop |
| Avoid hazards | `slipChanceAt`, `enemySurfDamage` | It logs the damage it walks through (`combat.js:4167`) |
| Crouch proactively | Attacking does not break the crouch `[ratified]` — an entrenched shooter is legal | Crouch is a last resort today (`combat-ai.js:105`) |

Also on the record and **out of this plan's scope**: hunting a hidden player
needs last-known-position AI, deferred to sneak v2 `[stated]` (designer,
2026-08-01, `SNEAK_PLAN.md` D1); the one-unit-at-a-time driver stays
`[stated]` ("one at a time is fine for ai right now", designer, 2026-07-30,
`INITIATIVE_PLAN.md` #3); charm already handles side-swapping without AI
changes (the charmed unit is player-controlled, BG3's Dominate shape, not
DOS2's AI-driven Charmed — `TODO.md:22`).

## What the reference games actually do (looked up)

Per `CLAUDE.md`, these are looked up, not recalled — researched 2026-08-01.
One honesty note in the `SHADOWBANE_NOTES.md` manner: this session's network
egress blocked the canonical hosts (bg3.wiki, docs.larian.game, larian.com),
so the claims below were assembled from search excerpts quoting those pages,
cross-checked across independent outlets. They are marked **reported**, not
verified-at-source; the canonical pages to re-read from a normal network are
noted in each sub-section.

### BG3 (reported; canonical: bg3.wiki/wiki/Difficulty, docs.larian.game/Combat_AI)

- **The modes are stat-and-loadout packages over one shared brain.**
  Explorer cuts enemy max HP ~30% and buffs the party; Balanced is the
  baseline ruleset; Tactician adds ~+30% enemy HP (bosses ~+50%), roughly +2
  to enemy attack rolls/DCs/saves, and gives some enemies extra abilities
  (prologue examples: Intellect Devourers gain a ranged attack, Commander
  Zhalk attacks twice).
- **Larian's own difficulty split is "base layer + local layer"** (senior
  combat designer Matt Holland, Panel from Hell, July 2023): a global base
  layer — "the basics like just increasing HP or making it easier to hit
  you" — plus a hand-authored local layer: "We've gone through every single
  combat in our game and we've added little bits of spice." Tactician should
  "feel like you're going up against a DM that's trying to push you to your
  limits."
- **The combat AI itself is score-based action evaluation** (Larian's
  modding docs): the AI enumerates candidate actions — a walk-to-position
  plus a skill on targets — scores each, and executes the top scorer;
  per-character *archetypes* are weight sets that skew the scoring. One
  brain, data-tuned per enemy.
- **The famous Tactician behaviors are community observation, not doctrine.**
  "Focus-fires casters", "finishes downed characters" — widely reported by
  players and guides, never published by Larian as a behavior list. The
  officially confirmed Tactician deltas are stats, loadouts, and encounter
  spice.
- **Honour Mode's combat addition is Legendary Actions**: boss-specific
  off-turn actions on triggers, from a limited per-round pool — e.g. Ansur
  answering an attack with a 12d6 breath, Cazador summoning bats when hit —
  plus "over 30 tweaks to boss fights" on top of Tactician's stats.

### DOS2 (part verified at engine level; canonical: docs.larian.game/Combat_AI)

Here the research got below the wikis: the DOS2 Script Extender
(`Norbyte/ositools` on GitHub) mirrors the engine's reverse-engineered
structures, so several claims are **verified against engine source**, not
just reporting.

- **The AI is a utility scorer** — it simulates each available skill on
  each target and executes the top-scoring action (reported,
  docs.larian.game/Combat_AI). Verified in the engine structs: per-action
  scores track damage, healing, control (CC) value, buff value, physical
  vs magic armor damage *separately*, plus a PositionScore and
  MovementScore; the pipeline even has explicit steps for scoring
  *saving AP* and future value (`AiScoreImpl`, `AiActionStep` in
  ositools' `AiHelpers.h` / `Enumerations.inl`).
- **Personality is archetype weight files** — verified: a base array of
  float modifiers with per-archetype overrides (`AiModifiers`);
  shipped archetypes reported as base/melee/ranged/healer/mage/rogue/…
- **Difficulty is data, on one shared brain.** Verified engine
  mechanisms: every NPC skill carries per-difficulty enable flags
  (`SkillAIParams`: CasualExplorer / Classic / TacticianHardcore /
  HonorHardcore) and spawns carry `HardcoreOnly`/`NotHardcore` — extra
  skills and extra bodies on Tactician are data toggles, not another AI.
  The stat side is reported: Tactician ≈ +50% enemy vitality/damage and
  large armor bonuses (exact figures conflict across sources); Honour =
  Tactician plus one save slot.
- **Focus-fire is real but observed, not documented**: community
  consensus is the AI hammers the lowest-armor target (mages pick the
  weakest magic armor); the Definitive Edition explicitly re-tuned
  targeting (reported). And in the successor engine this became a
  literal difficulty dial — BG3's `TACTICIAN/base.txt` archetype
  override (verified as file content, via a mirror) *reduces the penalty
  for attacking already-engaged targets* ("less prone to disregard
  targets that are already attacked"), boosts killing blows
  (`MULTIPLIER_KILL_ENEMY 1.50`) and raises CC aggression.
- **Believability is a designed bias, not an accident** — the base
  archetype weights carry comments like "Damaging allies looks pretty
  stupid" and "We generally want AI damaging, not healing" (verified as
  file content). Larian tunes the AI *away* from raw optimality toward
  legible behavior.
- **The counter-tactic method**: for DOS1:EE's Tactician, Larian asked
  QA what tactics they used to abuse each fight and watched playthroughs,
  then authored encounters against those strategies (reported, Larian's
  own preview post). DOS2 kept the pattern — late-game encounters
  counter teleport cheese by design (reported, Game Developer deep-dive).
- DOS2 systems designer Nick Pechenin, on why CC is deterministic there:
  "Fights are basically performances, and you want some kind of plot in
  them" — predictability so players can plan (reported).

### What this buys the plan

Four lessons, each reflected in a decision above:

1. **The smart brain is the baseline; difficulty modes are data on top.**
   Both games run one scoring AI everywhere; modes are stat packages,
   loadout/spawn toggles, and (in BG3) a handful of weight nudges on the
   same brain. That is A7's argument: build the one good brain, keep
   magnitudes in a block, and a selector later is packaging, not surgery.
2. **Per-enemy personality is data over a shared evaluator** — Larian's
   archetypes are literally weight files. A8 is the same shape at our
   scale: `focus` and friends on the def, one brain in `combat-ai.js`.
3. **Meanness is a dial, and Larian ships it turned down by default** —
   the believability bias, and focus-fire as a Tactician-only weight.
   That supports Q2-B (scored targeting behind a knob) over hard-wired
   maximum meanness, and A9's fairness stance: legible beats optimal.
4. **The endgame difficulty lever is authored, not emergent** — BG3's
   "local layer" and Legendary Actions, DOS2's counter-tactic
   encounters, are hand-placed per fight. That is the lever this plan
   deliberately leaves to level authoring and a possible future boss
   plan (an off-turn "Legendary Action" for a CEO fight is on-theme and
   cheap to imagine, expensive to build — noted, not proposed).

## Design decisions (recommended, with alternatives considered)

| # | Decision | Status | Notes |
| --- | --- | --- | --- |
| A1 | **Difficulty comes from decisions, not numbers.** This plan changes zero stat magnitudes; `scaleEnemy` and playtest keep the dials | `[proposed]` | Stands in for: "is 'upgrade difficulty' about brains or stats?" If the real answer is stats, this plan collapses to a tuning pass on `ENEMY_SCALING` and the questions above are moot |
| A2 | **The ladder stays; scoring lives inside beats.** `chooseBeat` keeps its fixed, tested priority order; intelligence goes into *which target*, *which tile*, *which verb instance* — each a pure scored choice behind the beat | `[proposed]` | The alternative — a DOS2-style utility scorer ranking all actions — is the genre's endgame but trades away the one thing the ladder has proven: every beat is unit-testable and every fight is explainable. Revisit if the ladder's arm count stops being legible |
| A3 | **Target scoring with a per-def `focus` knob** (Q2-B): score = engageability, then a weighted blend of proximity, kill-securability (fewest expected swings to down), and fragility; `focus` in the enemy def picks the blend | `[proposed]` | Q2. If the answer is A, the knob collapses to one shared weight set; if C, milestone 2 shrinks to keeping the current rule under the new seam |
| A4 | **The AI gets all four cover-denial verbs at player prices** (Q3-A): shove-at-bodies (slam/hazard only — never a free step-back), partition topple, break-down when sealed off, Pull Over on a crouched member | `[proposed]` | Q3. Supersedes M8's deferral the way that deferral said it would be. Decision #11 (`TACTICS_PLAN.md`) is the standing doctrine; the shared plan functions make each beat mostly wiring |
| A5 | **One existing enemy gets a ranged loadout** (Q1-A), and the AI gets shoot / reposition-for-LOS / crouch-and-shoot beats | `[proposed]` | Q1. If B, same beats land against a new def; if C, milestone 5 drops and the crouch redirect stack stays dormant |
| A6 | **Enemy HR heals, rationed; summoners keep distance** (Q4-A) | `[proposed]` | Q4. The ration (uses-per-fight, like the player's triage) is what keeps this from being the heal-ritual M9 just killed |
| A7 | **No difficulty selector in v1**; every new magnitude lives in one `AI` tunables block | `[proposed]` | Q5. The block is what makes any later selector cheap — one multiplier, not a scavenger hunt |
| A8 | **Per-enemy personality is data; the brain is systems.** New per-def vocabulary (`focus`, a ranged attack entry, support flags) is documented in `data/enemies.js` like `aggression` and `reach` already are; `combat-ai.js` owns every rule that reads it | `[proposed]` | The `ARCHITECTURE.md` rule applied to AI. `aggression` (green/yellow/red) is the precedent: disposition already lives on the def |
| A9 | **The AI never cheats.** Same AP prices (the topple precedent: "both sides push for the same", `combat-ai.js:141`), same rolls (M1's shared assembler), same information (it reacts to what combat shows it) | `[proposed]` | Difficulty that comes from fairness reads as the enemy being good; difficulty from cheating reads as the game being unfair. Every reference lesson supports it |
| A10 | **Sealed-off enemies break through instead of turtling** — when no route to any target exists, a unit with a breakable barrier on the way batters it (`breakPlan`) rather than crouching forever | `[proposed]` | Also the honest fix for the class of fights the closed-door deadlock belonged to: an unreachable enemy is now a *delayed* enemy, not a stalemate |

## Architecture: where it lands

Same carve as everything since the extraction: **decisions in
`combat-ai.js` (pure, unit-tested), plans in `combat-plans.js` (already
there), doing in `combat.js`, vocabulary in `data/enemies.js`.**

### Pure modules

- **`src/combat-ai.js`** — grows three scored choices and the new ladder
  arms:
  - `scoreTarget(unit, candidates, world)` — replaces `pickTarget`'s
    hand-rolled comparison with the A3 blend; `focus` weights passed in.
    `pickTarget` stays as the name; the tie-break chain becomes a score.
  - `scoreStandTile(unit, target, tiles, world)` — path cost, minus flank /
    backstab position value at arrival (`positionMods` with roles reversed),
    minus opportunity attacks the route would eat (`provokedBy` along it),
    minus hazard and slip exposure (`surfaceStepCost`, `slipChanceAt`).
    `standTilePath` keeps its contract (a route) but chooses by score, not
    length alone.
  - `chooseBeat` grows arms in ladder order: `support` (above `summon` —
    same reinforce-before-wading logic), `pull`, `shove`, `break`,
    `shoot`, `reposition` (the ranged advance), with the existing arms
    keeping their tested positions. Each arm's availability is a plan
    result passed in, exactly as `summon`/`topple` already work — the
    ladder never computes world state.
  - One `AI` tunables block: scoring weights, shove-worthiness threshold,
    heal-at-fraction, ranged keep-away distance. The A7 block.
- **`src/combat-plans.js`** — mostly already done, which is the point:
  `breakPlan`, `pullPlan`, `displacePlan`, `topplePlan` are shared today.
  Adds `aiShovePlan` (which adjacent victim + direction yields a slam or a
  hazard landing — the "strictly better than a swing" test the topple beat
  already models) and `aiPullPlan` / `aiBreakPlan` wrappers that answer
  "is one worth taking this turn" over the eight neighbours, the same
  shape `aiTopplePlan` has.
- **`src/data/enemies.js`** — vocabulary only: `focus` (A3), a ranged
  attack entry (`range`, and `ammo`-less by default — a stapler fires
  free like the player's), `support` on HR (heal numbers + ration),
  documented in the header like `aggression`/`reach`/`summon` are.

### Impure

- **`src/combat.js`** — the doing arms for each new beat (spend, log, FX,
  wait), the plan-gathering before `chooseBeat` (exactly as
  `summonReady`/`aiTopplePlan` are gathered today, `combat.js:4324`), and
  the AI's ranged swing running the same `shotOutcome` gauntlet the
  player's does — redirects into human shields included, which is the
  moment that shipped rule finally faces the player.
- **`src/ui.js` / log lines** — every new beat needs a legible log line and
  its existing FX. An AI that pulls you over your desk without a clear log
  line is a bug report, not a difficulty feature (the OA lesson,
  `TACTICS_PLAN.md` risks).

### Persistence

None. Every new field is static def vocabulary; all decision state is
in-fight transient, and combat is never saved mid-fight (the `TACTICS_PLAN`
#6 precedent, unchanged).

## Milestones (each a PR that keeps `npm test` + e2e green)

1. **The measuring stick.** A seeded scripted bout — the dev spike level,
   fixed party, `rng` seeded (it already reproduces slips) — with a
   per-side damage/rounds tally on the `__combat` test handle. Cheap: one
   spec and a counter. Every later milestone quotes its before/after
   numbers in the PR, so "harder" is a measurement, not a vibe.
   `[proposed]` — if it turns out flaky or slow it demotes to a manual
   god-mode readout without blocking anything.
2. **Target scoring (A3).** `scoreTarget` + `focus` vocabulary + the
   per-def values for the shipped four. Unit tests pin the blend ("a
   finishable target outranks a nearer hale one", "a low-focus enemy
   stays on proximity"); the e2e tactics spec gains one bout asserting
   focus-fire actually concentrates damage. The current wounded-tiebreak
   test is *rewritten* to the new rule, deliberately — it encodes the old
   design.
3. **Stand-tile scoring (A2's second half).** `scoreStandTile` wired into
   the advance: flank-seeking, OA-avoiding, hazard-avoiding approach.
   Unit tests per term; the existing "engageable outranks near" and
   anti-stall tests must pass unchanged — scoring refines the choice
   among tiles the old rule already admitted, it never re-admits a
   stall.
4. **The cover-denial beats (A4, Q3).** Shove-at-bodies (slam and hazard
   landings only), partition topple, break-when-sealed (A10), Pull Over —
   in the ladder between `summon` and `attack`, each behind its plan, each
   at the player's price. The M8 deferral notes in `TACTICS_PLAN.md` get
   their follow-up citation. e2e: a member crouched against a partition
   gets pulled over it; a sealed corridor gets battered through.
5. **The ranged enemy (A5, Q1).** The loadout on the chosen def, the
   `shoot` beat (range + LOS + the full `shotOutcome` gauntlet), the
   `reposition` advance (walk to the best-scored tile *with a firing
   line* — the player-side ranged walk-in already asks the right
   question), and crouch-and-shoot (crouch survives attacking
   `[ratified]`, so an entrenched shooter is the fight the cover game was
   built for). This is the milestone that makes the player's own crouch,
   human shields and Pull Over matter.
6. **Support AI (A6, Q4).** HR heals her wounded (rationed), stands behind
   her summons; summon timing stays her opening beat. Attack selection
   stops being uniform-random everywhere: prefer an `applies` line the
   target doesn't already wear, at a mild weight — enough that the guard
   blinds the shooter on purpose sometimes, not so much that statuses
   become a lock loop.
7. **The tuning pass.** One block of weights, the milestone-1 bout numbers
   before/after per change, and the cross-cutting balance look every plan
   defers to playtest. If a difficulty selector is ever ratified (Q5),
   this block is where it plugs in.

Order rationale: 2–4 sharpen the game the AI already plays (melee), 5–6
widen it, 7 tunes it. 1 exists so 2–7 can prove they did anything. Milestones
2, 3 and 4 are independent of 5 and 6 and could land in any order; 5 wants 3
first (a shooter that can't pick tiles shoots from bad ones).

## Testing

- **Unit (`tests/unit/combat-ai.test.js`)** — the pattern is set: every
  scored choice and every new ladder arm gets the same treatment the
  current six beats have. The ladder-order tests extend; the targeting
  tests are rewritten to the new rule (deliberate, noted in milestone 2).
- **Unit (`tests/unit/combat-plans.test.js`)** — `aiShovePlan`'s
  "strictly better" gate (a shove that just moves someone is refused; a
  slam or hazard landing is taken), the pull/break wrappers' refusals.
- **e2e** — one bout per beat, staged like the tactics/topple specs stage
  theirs (dev level, `forceHit`, seeded rng): focus-fire concentrates,
  the flank-seeking approach arrives on the far side, a crouched member
  gets pulled, a sealed enemy breaks through, the shooter crouches and
  keeps shooting, HR heals and the log says so.
- **Regression invariant** — the anti-stall suite is sacred: the pacing
  bug (`combat-ai.js:23-33`) and the boxed-in corridor case have tests
  because they each once broke the game; no scoring change may trade a
  worse decision for a stall. `afterFailedAdvance`'s tail keeps its
  contract.

## Risks and open questions

- **Smart enemies expose player-side gaps.** The moment enemies shoot,
  every player-side cover affordance gets audited by the enemy: the
  known ranged walk-in bug (`TODO.md` Phase 1, "ranged walk-in asks a
  melee question") becomes symmetric if the AI reuses the same helper —
  fix it before or with M5, not after.
- **Focus fire and fun.** Kill-securing AI downs the frail member first,
  every fight, and that member's player watches from the bench. The
  `focus` knob and the discipline spread are the mitigation; the bout
  numbers say if it's enough. If it still reads as bullying, the lever
  is the knob, not the rule.
- **More beats, slower enemy turns.** Every beat adds plan-gathering per
  AI turn (the summon/topple pattern). All of it is bounded neighbour
  arithmetic; the budget is "no visible pause on a 6-enemy floor", and
  milestone 1's harness can time it.
- **The ladder's legibility ceiling.** A dozen arms is near the edge
  of "the order is the design" staying readable. If a future beat needs
  context the ladder can't express (multi-turn intent, retreat-and-heal
  arcs), that is the A2 revisit — a scorer — and it should be its own
  plan.
- **Enemy heals vs the M9 direction.** If rationed healing still drags
  fights, Q4-B (positioning only) is the fallback and costs nothing to
  swap to — the beat is data-gated per def.
- **Numbers.** As with every prior plan, first-draft constants deferred
  to playtest; the difference here is milestone 1 makes the playtest
  legible.
