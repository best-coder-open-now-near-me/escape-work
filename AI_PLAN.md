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

**All five answered** `[ratified]` (designer, 2026-08-01: "all of the
recommended answers are good") — every recommendation below is now the
decision: Q1-A (arm an existing enemy), Q2-B (scored targeting with the
per-def `focus` knob), Q3-A (all four cover-denial beats), Q4-A (HR heals,
rationed), Q5-A (no difficulty selector in v1). The tags are flipped in the
decisions table; the questions stay below as the record of the options and
consequences that were weighed. They are ordered by how much of the plan's
shape they move.

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

## Brief for the implementing agent

This plan will be executed by someone who was not in the room. The rules
of engagement, so the doc is enough:

- **Read first:** `CLAUDE.md` (the process — tags are load-bearing),
  `ARCHITECTURE.md` (the carve), `src/combat-ai.js` end to end (168
  lines — it is the module this plan grows), the AI arm of `combat.js`
  (`:4297-4381`), and `tests/unit/combat-ai.test.js` (the contract you
  are extending).
- **The tags bind you.** The five headline questions are answered — A3,
  A4, A5, A6, A7 are `[ratified]` (designer, 2026-08-01) and are the
  design, not suggestions. What remains `[proposed]` (A1, A2, A8, A9,
  A10, the tunable values, the log flavor, which enemy carries the
  ranged entry) are implementation defaults: implement them as written,
  keep them cheap to reverse, and flip tags in this doc as any further
  designer verdicts arrive (the ratification loop).
- **Three invariants outrank any milestone's feature:** termination
  (every DECIDE spends, refuses, or ends — the two shipped stall bugs
  were both violations), purity (`combat-ai.js` and `combat-plans.js`
  take values and callbacks, never the world object, never PlayCanvas),
  and symmetry (every beat at the player's price through the shared
  resolution paths — reuse `unitStrikesMember`/`dropOnto`/`pushTo`,
  never reimplement a roll).
- **Do not touch:** the driver's guard order (`combat.js:4297`), the
  degenerate self-path (`combat-ai.js:34`), the engageability tier in
  targeting, `provokedBy`'s set-diff shape, or the one-unit-at-a-time
  driver (`[stated]`, `INITIATIVE_PLAN.md` #3). Where a milestone
  *deliberately* rewrites a test (the wounded tiebreak), it says so;
  everything else in the existing suite is a regression gate.
- **Each milestone is one PR** that keeps `npm test` and the e2e suite
  green, quotes the milestone-1 bout numbers in its description, and
  updates this doc's milestone entry with an "as landed" note — the
  house pattern in `TACTICS_PLAN.md`.

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
| A3 | **Target scoring with a per-def `focus` knob** (Q2-B): score = engageability, then a weighted blend of proximity, kill-securability (fewest expected swings to down), and fragility; `focus` in the enemy def picks the blend | `[ratified]` | Q2 answered B (designer, 2026-08-01, "all of the recommended answers are good") |
| A4 | **The AI gets all four cover-denial verbs at player prices** (Q3-A): shove-at-bodies (for a melee unit: slam/hazard landings only — never a free step-back), partition topple, break-down when sealed off, Pull Over on a crouched member. One carve-out: a RANGED unit may shove to disengage — the game's own doctrine that shove is the safe way to break contact (`TACTICS_PLAN.md` #9) applied from the other side | `[ratified]` | Q3 answered A (designer, 2026-08-01). Supersedes M8's deferral the way that deferral said it would be; decision #11 (`TACTICS_PLAN.md`) is the standing doctrine |
| A5 | **One existing enemy gets a ranged loadout** (Q1-A), and the AI gets shoot / reposition-for-LOS / crouch-and-shoot beats | `[ratified]` | Q1 answered A (designer, 2026-08-01). WHICH enemy carries it stays `[proposed]` (the Executive, per the data section) — flavor is the designer's whenever they want it |
| A6 | **Enemy HR heals, rationed; summoners keep distance** (Q4-A) | `[ratified]` | Q4 answered A (designer, 2026-08-01). The ration (uses-per-fight, like the player's triage) is what keeps this from being the heal-ritual M9 just killed |
| A7 | **No difficulty selector in v1**; every new magnitude lives in one `AI` tunables block | `[ratified]` | Q5 answered A (designer, 2026-08-01). The block is what makes any later selector cheap — one multiplier, not a scavenger hunt |
| A8 | **Per-enemy personality is data; the brain is systems.** New per-def vocabulary (`focus`, a ranged attack entry, support flags) is documented in `data/enemies.js` like `aggression` and `reach` already are; `combat-ai.js` owns every rule that reads it | `[proposed]` | The `ARCHITECTURE.md` rule applied to AI. `aggression` (green/yellow/red) is the precedent: disposition already lives on the def |
| A9 | **The AI never cheats.** Same AP prices (the topple precedent: "both sides push for the same", `combat-ai.js:141`), same rolls (M1's shared assembler), same information (it reacts to what combat shows it) | `[proposed]` | Difficulty that comes from fairness reads as the enemy being good; difficulty from cheating reads as the game being unfair. Every reference lesson supports it |
| A10 | **Sealed-off enemies break through instead of turtling** — when no route to any target exists, a unit with a breakable barrier on the way batters it (`breakPlan`), and a unit sealed by a CLOSED DOOR opens it at the player's own door price rather than farming crouches forever | `[proposed]` | Also the honest fix for the class of fights the closed-door deadlock belonged to: an unreachable enemy is now a *delayed* enemy, not a stalemate. Doors have no break pool (they are not in the wall sets, by construction), so without the open arm, closing a door on an enemy mid-fight turns it into a piñata |

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
  - `chooseBeat` grows arms in the ladder order the state-machine section
    below fixes: `support`, `pull`, `shove`, `entrench`, `shoot`, `break`
    — and `advance` stays ONE arm whose *destination rule* is kit-shaped
    (melee: a swing tile; ranged: a firing tile), so the ladder does not
    fork per kit. Each arm's availability is a plan result passed in,
    exactly as `summon`/`topple` already work — the ladder never computes
    world state.
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

## The turn state machine

The design centerpiece, specified so a milestone can implement against it.
Today's machine survives intact — this section *extends* it and names the
invariants that keep it terminating.

### Driver states (per frame, `phase === 'ai'`)

The per-frame guards run in this order, and the order is load-bearing
(today's driver already has all of them — `combat.js:4297`):

| State | Guard | What happens |
| --- | --- | --- |
| WAITING | `acting.wait > 0` | tick down; nothing else — the wait is what makes beats read one at a time |
| DEAD | `!unit.alive` | end turn (`advanceTurn`) |
| WALKING | `unit.moving` | let the path play out; `onTile` hooks fire OAs, surface damage, gum, slips mid-walk |
| SLIPPED | `unit.slipped` | clear the flag, end the WHOLE turn (spent getting up) |
| NO TARGET | `pickTarget → null` | `defeat()` — no living player side |
| DECIDE | otherwise | gather plans → `chooseBeat` → execute one arm → set `wait` → next frame re-enters DECIDE |

A turn ends by exactly one of: the `pass` beat, DEAD, SLIPPED, or the
stall backstop (below). Everything else loops through DECIDE.

### The ladder, extended

One ladder, fixed order; a beat a unit's kit can't take simply never
gates on (a melee unit never has a firing solution, a def without
`support` never has a heal). Any one unit's *live* ladder stays at eight
or fewer arms.

| # | Beat | Gates on | Spends | Why it sits here |
| --- | --- | --- | --- | --- |
| 1 | `support` | `def.support`, an ally under the heal threshold, ration left | support AP | Triage outranks reinforcements: a body about to drop is worth more than a fresh temp. Same reinforce-before-wading logic as summon |
| 2 | `summon` | as today | summon AP | Unchanged, tested position |
| 3 | `pull` | a member crouched with their shield between us, `REACH.PULL`, landing exists | pull AP | Strictly better than walking around their cover: breaks the crouch, rolls the Grit price, relocates them into our midst |
| 4 | `topple` | furniture **or partition edge** with a victim under the fall | shove AP | Unchanged position, widened aim — damages, stuns, leaves cover |
| 5 | `shove` | melee kit: landing is a slam or hazard; ranged kit: also the plain step-back when adjacent to a threat | shove AP | Below topple (topple is shove-plus), above attack only when the plan says strictly better |
| 6 | `attack` | in reach, has a melee line | attack AP | Unchanged position; the line pick becomes context-aware (melee lines in reach, status value weighted) |
| 7 | `entrench` | ranged kit, in range + LOS, not crouched, a shielding face HERE, AP for crouch AND a shot | cover AP | Crouch-then-shoot in one turn — attacking doesn't break the crouch `[ratified]`, so this is the Gears fight the cover game was built for. Must precede `shoot` or it never fires |
| 8 | `shoot` | ranged kit, in range + LOS, `shotOutcome` clear | attack AP | The "in range but not in reach" arm; in melee reach, `attack` (above) already won — no point-blank ambiguity |
| 9 | `advance` | a destination exists and budget covers a step | move budget | ONE arm; the destination rule is the kit's: melee walks the scored swing tile, ranged walks the scored firing tile |
| 10 | `break` | no route to ANY target; a breakable barrier (or closed door — the open arm) on the would-be route | attack AP / door AP | Only when sealed: barrier-battering as a substitute for the advance that cannot exist (A10) |
| 11 | `crouch` | as today (boxed in, actually shielded) | cover AP | The turtle stays the last resort for melee kits |
| 12 | `pass` | — | — | Hand the turn on |

### The failure tail, generalized

`afterFailedAdvance` exists because one beat (advance) can *choose*
successfully and then *spend nothing* (the world refuses the route). With
six more doing-arms, that special case becomes the rule:

- **Every arm's DOING reports what it spent.** An arm that spent nothing
  adds itself to a per-turn `refused` set and DECIDE re-runs with that
  set masked off. `afterFailedAdvance` becomes the first instance of the
  general tail rather than a bespoke sibling.
- **Termination invariant** (the thing the unit tests pin): every DECIDE
  iteration either (a) strictly decreases AP or move budget, (b) grows
  the `refused` set, or (c) ends the turn. All three are monotone and
  bounded, so no fight can hang — which is the property the pacing bug
  and the corridor stall each violated once, from outside the ladder.
- **The stall backstop stays**: when everything is refused or
  unaffordable and the crouch fails, burn the real AP (never the
  movement allowance — it buys nothing) and end the turn, exactly as
  today (`combat.js:4375`).

### Timing and interrupts

- Every arm sets `acting.wait` to outlast its FX (the attack's 0.85, the
  topple's 0.85, the crouch's 0.5 are the calibration points). An arm
  that forgets its wait executes twice in adjacent frames — visually a
  pileup, and it skews the rng stream the seeded bouts depend on.
- Mid-walk events keep their current homes: OAs, surface damage, gum and
  slips all live in the `onTile` hook the advance installs — the new
  destination rules change *where* the walk goes, never what happens
  along it.
- Cooldowns and rations (`support` alongside `summonCd`) tick where the
  summon cooldown already ticks — the round wrap. A cooldown ticked
  anywhere else never recovers for surprised units.
- `pickTarget` re-runs every DECIDE, so a target dying mid-turn, a charm
  swapping a slot's side, or a door opening re-resolves within the same
  turn without special cases — the plan-then-do gap inside one frame is
  the only staleness window, and it is zero frames wide.

## The data

Everything tunable in one block, everything per-enemy on the def. Numbers
are first drafts, deferred to playtest like every prior plan's — the block
existing is the decision; the values are dials.

### The `AI` tunables block (`src/combat-ai.js`, beside the rules that read it)

```js
export const AI = {
  // --- target scoring (milestone 2) ---
  FOCUS_DEFAULT: 0.5, // a def without `focus`: half-disciplined
  W_NEAR: 1.0,        // proximity term
  W_KILL: 2.0,        // kill-securability term (scaled by focus)
  W_FRAIL: 1.0,       // fragility term (scaled by focus)
  STICKINESS: 0.25,   // bonus to the CURRENT target - anti-flip-flop hysteresis
  // --- destination scoring (milestone 3) ---
  W_PATH: 1.0,        // per tile-unit of route cost - the baseline everything trades against
  FLANK_VALUE: 1.5,   // arriving in a pincer position
  BACKSTAB_VALUE: 1.0,// arriving in the target's rear arc
  OA_COST: 2.0,       // per opportunity attack the route would eat
  HAZARD_COST: 1.5,   // per damaging surface tile entered
  SLIP_COST: 1.0,     // per slippery tile entered (expected turn loss)
  // --- ranged (milestone 5) ---
  KEEP_AWAY: 2.5,     // a shooter wants at least this distance from the nearest threat
  CROWD_COST: 0.75,   // per tile-unit the firing tile sits inside KEEP_AWAY
  SHIELD_VALUE: 1.0,  // a firing tile with a shieldable face toward the target (entrench potential)
  // --- attack lines (milestones 5-6) ---
  STATUS_WEIGHT: 2,   // an `applies` line the target doesn't wear is this much likelier
  // --- support (milestone 6) ---
  HEAL_AT: 0.5,       // heal an ally under this HP fraction
};
```

### `data/enemies.js` vocabulary (documented in the header, like `aggression` and `reach`)

- **`focus`** (0..1, default `AI.FOCUS_DEFAULT`) — targeting discipline.
  First-draft values `[proposed]`: Manager 0.2 (harasses whoever is
  closest — pettiness, not strategy), Executive 0.9 (picks the kill and
  works it), Security Guard 0.5 (steady; `STICKINESS` does his character
  work), HR 0.4.
- **A ranged attack entry** — an `attacks` element with `range` (and the
  usual min/max/log/missLog/applies). `range` present = ranged line: only
  fired out of reach, gated on LOS and a clear `shotOutcome`, bills
  `attackAp` like any line. Q1's candidate `[proposed]`: the Executive,
  one entry, `range: 5` (the throw-range precedent), e.g. *"The Executive
  sets a hard deadline from across the room."* Flavor is the designer's
  call; the mechanics are not affected by whose entry it is.
- **`support`** on a def — the summon-descriptor pattern exactly
  (`data/enemies.js:134` is the template): numbers on the def, paced by
  the same clocks. `[proposed]` for HR:
  `support: { heal: [4, 7], uses: 2, ap: 2, range: 4, log: 'HR approves
  emergency self-care.' }`. `uses` is the ration (M9's lesson written
  into the enemy side); `range` is aim distance — v1 support does NOT
  walk to heal (the summoner already stands amid her temps; a healer
  that repositions to heal is a v2 behavior, noted in risks).
- **Plumbing note:** these are read off `unit.def` at plan-gathering
  time, exactly as `summon` and `aggression` already are — they do NOT
  route through `unitCombat` (see footgun 1 for which fields do).

## The scored choices, specified

Signatures and formulas the executor can implement against. All pure, all
in `combat-ai.js`, world facts arriving as values or callbacks — the
module's existing discipline. Scores are deterministic (no rng);
tie-breaks are candidate order.

### Target (replaces `pickTarget`'s comparison; keeps its name and shape)

```
pickTarget(ux, uz, candidates, canEngage, opts = {})
  // opts: { focus = AI.FOCUS_DEFAULT, current = null, expSwings = null }
```

Engageability stays a hard TIER, never a weight — the M3 anti-stall lesson:
an engageable member always outranks an unengageable one. Within a tier:

```
near  = 1 / (1 + cheb(u, m))
kill  = 1 / expSwings(m)          // ceil(m.sheet.hp / mean damage of our lines); soak ignored v1
frail = 1 - m.sheet.hp / m.sheet.maxHp
score = AI.W_NEAR * near
      + focus * (AI.W_KILL * kill + AI.W_FRAIL * frail)
      + (m === current ? AI.STICKINESS : 0)
```

`current` is the unit's target from its previous beat this fight (a
transient on the unit, like `summonCd`). The old wounded-tiebreak behavior
is the `frail` term at `focus = 0.5`; the old rule entirely is `focus = 0`.

### Destination (inside the `advance` beat; kit picks the candidate set)

```
scoreDestination(unit, target, routes, q)
  // q: { threats, allies, facingOf, surfDamageAt, slipChanceAt, shieldFaceAt, nearestThreatDist }
```

- **Melee candidates:** the ≤8 swing-tile routes `standTilePath` already
  runs — no new pathfinding, and the degenerate self-path keeps its
  absolute priority (footgun 7).
- **Ranged candidates:** tiles within `range` with LOS to the target —
  reuse the aim geometry (`powers.aimRangeOf`/`rangeTiles`) with roles
  reversed, cap to the nearest ~12 by `cheb` BEFORE routing so the A*
  fan stays bounded by the same budget the melee fan already pays.

```
score = - AI.W_PATH * routeCost
        + AI.FLANK_VALUE    * (arriving yields isFlanked(unit@dest, target, allies))
        + AI.BACKSTAB_VALUE * (isBackstab(unit@dest, target, facingOf(target)))
        - AI.OA_COST        * provokedBy(threats, legs of route).length
        - Σ entered tiles: AI.HAZARD_COST·(surfDamageAt > 0) + AI.SLIP_COST·slipChanceAt
        + ranged only: AI.SHIELD_VALUE * shieldFaceAt(dest, toward target)
        - ranged only: AI.CROWD_COST * max(0, AI.KEEP_AWAY - nearestThreatDist(dest))
```

Score at the APPROACH POINT the mover will actually stand on (`approach`),
not the tile centre — `dirOctant` flips sectors near tile midlines, and a
flank scored at the centre can evaporate at the real arrival spot.

### Attack line (milestone 5 makes it context-aware; 6 adds status weight)

```
pool   = in reach ? lines without `range`
       : lines with range ≥ dist AND LOS AND shotOutcome clear
weight = 1 + (a.applies && !hasStatus(target, a.applies) ? AI.STATUS_WEIGHT - 1 : 0)
pick   = weighted draw through `rng`   // resolution, so rng is correct here; seeded runs stay reproducible
```

### The new plans (`combat-plans.js`, beside `aiTopplePlan`)

- `aiShovePlan(bx, bz, world, victimAt, { hazardAt, disengage })` — for
  each `AROUND` victim, push directly away from the shover
  (`displacePlan` with the octant through the victim). Accept when the
  plan is a SLAM (`blocked`) or the landing is a hazard
  (`hazardAt(tx, tz)`); with `disengage` (ranged kit, threat adjacent),
  also accept the plain step-back. Returns `{ victim, plan }` or null.
- `aiPullPlan(unit, members, crouchOf, world)` — members within
  `REACH.PULL` holding a live crouch whose shielded face lies between
  the bodies; delegates to `pullPlan` with the puller excluded from the
  cover faces (the `pullCrouchOf` precedent, `combat.js:2477`). First
  qualifying member wins (they are rare).
- `aiBreakPlan(unit, world, towardTarget)` — gated on "no member is
  engageable at all". Adjacent breakable prop, partition edge
  (`edgeHpBetween`), or closed door on the face toward the nearest
  member (`dirOctant`). Returns what to batter or which door to open.
  v1 is deliberately adjacent-only; cost-aware pathfinding THROUGH
  breakables (route cost += panel HP) is the v2 refinement, noted so
  nobody builds it by accident.
- `entrenchPlan` — ranged kit: in range + LOS + not crouched +
  `aiCrouchCovered` HERE + AP ≥ coverAp + attackAp.
- `shootPlan` — dist ≤ range, LOS, `shotOutcome` clear (passed in as a
  leaf fact — combat owns bodies), a ranged line affordable.
- `supportPlan(unit, allies, spec)` — allies (self included, the triage
  mirror) with `hp/maxHp < AI.HEAL_AT`, within `spec.range`, skipping
  summons with ≤1 lifetime turn left; ration and cooldown live on the
  unit like `summonCd`. Lowest HP fraction wins.

## The doing arms, specified

Each arm in `combat.js`, following the summon/topple template: spend →
perform (REUSING the shared resolution — footgun 6) → log → FX → wait.
Log lines below are `[proposed]` flavor; the mechanics columns are the
spec. All prices are the player's own (A9).

| Beat | Spends | Performs via | Log shape | Wait |
| --- | --- | --- | --- | --- |
| `support` | `support.ap` | clamp-add to unit hp; `fx.damageText` green | "HR approves emergency self-care. +5." | 0.6 |
| `pull` | `ACTIONS.pull.ap` | the pull core: `pushTo` + shared Grit save (`dropOnto`'s price from the far side) — extract the player click's perform half so both sides share it | "The Manager hauls you over your own desk." | 0.85 |
| `shove` | `ACTIONS.shove.ap` | the shove perform (slam damage / hazard billing already shared) | "The Executive walks you back into the copier." | 0.6 |
| `topple` (partition aim) | `ACTIONS.shove.ap` | `toppleEdge` + `dropOnto` | existing topple line, partition flavor | 0.85 |
| `break` / door-open | `attackAp` / door AP | `performBreak`'s core vs the pool; the door via `world.doorsBeside`'s own price | "Security has a key. Of course he does." | 0.85 / 0.5 |
| `entrench` | `ACTIONS['take-cover'].ap` | `crouchHere` (the AI crouch already calls it) | existing crouch line | 0.5 |
| `shoot` | `attackAp` | a ranged twin of `unitStrikesMember`: same assembler, same statuses, plus `shotOutcome` resolution (redirects included) | the def's ranged line | 0.85 |

## Multi-storey maps

The layered levels (`floors.js`, the atrium spike; verticality is required
`[stated]`, designer 2026-08-01, `EDITOR_PLAN.md` #3) intersect this plan,
and the honest current state bounds the scope: **actors above the ground
storey are not supported yet** — `parseLevel` throws a named error for
them (`floors.js:31-38`), so every fight today happens on one storey and
nothing in milestones 1–7 changes that. What this section owns is making
sure the AI work doesn't make the vertical future HARDER, and naming what
that future needs from it.

**The trap to not build in: every body-to-body rule is 2D.** `dist`,
`cheb`, the octants, reach, threats, pincers, rear arcs, SURPRISE_RADIUS —
all measure in the storey plane. The day two bodies stand on different
storeys at the same (x, z), an unguarded rule reads them as distance zero:
in reach through a ceiling, flanked through a floor, backstabbed from a
balcony. The rule when bodies go vertical: **same-storey gates on every
body-to-body geometry test**, with cross-storey interaction arriving verb
by verb (a thrown stapler over the balcony rail is a feature; a punch
through the mezzanine is a bug). Until then, the single-storey assumption
is documented where it lives rather than scattered: route points are
`[x, z]` pairs and tile keys are `"x,z"` strings (`scoreDestination`'s
entered-set, the engage memo's key) — when routes gain a storey
coordinate, those keys grow it too, in one place each.

**What each milestone owes the layers:**

- *Targeting (M2):* `canEngage` inherits whatever router combat threads,
  so a cross-storey member is engageable exactly when a stair-chained
  route exists — correct by construction once `findEnemyPath` chains
  storeys the way the player's planner already does (`floors.js`). The
  `near` term is the one that lies vertically (cheb 0 through a ceiling);
  when actors go vertical it should read route cost, not plane distance.
- *Destinations (M3):* stair runs are chokepoints and hazard walks are
  per-storey; the scoring walk needs layer-qualified tile keys and
  nothing else — the terms themselves (cost, OA, hazard) are already
  route-shaped, and a chained route is still a route.
- *Cover-denial (M4):* partitions, props and doors are per-storey objects
  already; `aiBreakPlan`'s "sealed" gate must ask the chained router, not
  the flat one, or a stairs-only approach reads as sealed.
- *Ranged (M5):* v1 is same-storey by scope — cross-storey LOS is real
  3D sight geometry (the M6a height rule has no vertical axis) and it
  belongs to the layers feature, not this plan. Named here so the
  balcony-shooter fight — the atrium's obvious payoff, and the reason
  the ranged beats should take a `sameStorey` gate from day one — is a
  planned arrival, not an accident.
- *Height advantage:* the reference games monetize high ground (range
  and damage in DOS2 — reported); this game has NO height-advantage rule
  and this plan deliberately adds none `[proposed]` — that is a design
  question for the layers work, flagged for the designer there, not a
  default to sneak in through the AI.

## Implementation notes — footguns

The traps, from reading the code paths each milestone lands on. Each is
cheap to dodge on the way in and expensive to debug after.

1. **`unitCombat` is a whitelist, and it eats new fields silently.** It
   copies exactly `{name, model, maxHp, ap, attackAp, attacks, xp, loot,
   accuracy, dodge, reach}` (`stats.js:374`). The RIGHT path for the new
   behavior fields is the one `summon` and `aggression` already use:
   read them off `unit.def` at plan-gathering time (`combat.js:4324`
   reads `unit.def.summon`), which works for registry enemies and
   class-backed units alike because both end up with a full merged def.
   Route a field through `unit.combat` ONLY if it is a combat stat —
   and then it must be added to the whitelist with `??`, not `||`, or
   `focus: 0` (deliberately undisciplined) silently becomes the default;
   `reach` already had to learn this exact lesson. Per-attack fields
   (`range` on an attack entry) ride free — `attacks` passes through
   whole.
2. **`pickTarget` runs EAGERLY during `startCombat`** — the surprise
   sweep calls it before any turn exists (`combat.js:263`). Scoring must
   not read turn state (`acting`, waits, budgets), and every accessor it
   touches must be a hoisted `function` declaration — `const` in a
   temporal dead zone already broke a fight mid-setup once
   (`TACTICS_PLAN.md` M3's landed note).
3. **The `engageMemo` is keyed on tiles and cleared per turn**
   (`combat.js:231`) — it may cache *engageability* only. HP,
   crouch state and statuses change mid-turn; bake any of them into that
   memo and the AI aims at a fight that already moved on. Score fresh
   every DECIDE; memoize only the route existence the memo already owns.
   And add no new per-frame Dijkstras: `scoreStandTile` annotates the
   ≤8 routes `standTilePath` already runs — the memo exists because that
   fan once pushed CI past its timeouts.
4. **Combat's members are not main's members.** Combat wraps
   `party.members` into new objects; bookkeeping keyed on the member
   object silently no-ops (the M2 gotcha, `TACTICS_PLAN.md`). Every new
   map keys on the combat-side wrapper or resolves through the shared
   `actor`, like `crouched` and `combatantFor` already do.
5. **Side is live state, not registry.** Charm swaps a slot's side in
   place (`turns.replace`), and summons carry their own team. The
   pull/shove/topple victim tests must take the caller's side predicate
   (the `victimAt` pattern `aiTopplePlan` already uses,
   `combat-plans.js:54`) — an AI unit consulting the enemy registry will
   eventually pull its own charmed colleague over a desk.
6. **Scoring is rng-free; resolution is rng-shared.** All dice go
   through `rng` (the last direct `Math.random` was deliberately
   evicted, `combat.js:4191`) so seeded bouts reproduce; and the scored
   *choices* use stable tie-breaks (candidate order), never a coin flip,
   or unit tests and bout numbers wobble across runs. New beats reuse
   `dropOnto` / `unitStrikesMember` for resolution rather than
   reimplementing — that is also what keeps `forceHit` working in specs,
   and it is the OA lesson ("lands by identical rules") applied forward.
7. **The self-path is sacred.** `standTilePath`'s degenerate self-path
   (`combat-ai.js:34`) is the fix for the shipped
   oscillate-forever pacing bug. Destination scoring must never send a
   unit that can already swing somewhere "better": the ladder guarantees
   it (in reach → `attack` outranks `advance`), but only while scoring
   stays INSIDE the advance beat — score destinations, never whether to
   prefer moving over swinging. Flank-seeking is for the approach, not a
   reason to leave reach.
8. **Two currencies, never crossed.** Advances bill the move budget
   (`billMove`); every other beat bills real AP (`roundAp`); the stall
   burns AP and deliberately strands the allowance (`combat-ai.js:163`).
   A beat that bills both, or a refusal that burns the allowance,
   quietly rewrites the AP economy.
9. **`attacks` stops being uniform-random the day one entry carries
   `range`.** The picker becomes context-aware in the same PR that adds
   the entry (milestone 5, not 6): melee lines in reach, the ranged line
   at distance. Otherwise the random picker fires point-blank "shots"
   (cover is ranged-only — adjacent shots would wake that math) and
   swings at people across the room.
10. **The AI must read `shotOutcome` in the PLAN, not discover it in the
    DOING.** REFUSED (object shield) and REDIRECTED (human shield) are
    the crouch game's whole point; a shoot beat that checks after
    spending wastes turns into immunity. And the redirect needs its
    symmetric ruling: an enemy shot that would redirect into another
    ENEMY refuses, mirroring the player's own-team refusal `[proposed]`
    in M6 — without it, milestone 5 ships friendly fire.
11. **Kiting is priced, not free.** A ranged unit stepping out of a
    member's reach provokes (deliberate move, `notifyStep`); the firing-
    tile score subtracts the OAs the route eats — as a weight, not a
    veto, because eating one swing to reach a kill can be right. The
    free escape is the disengage shove (A4's carve-out): forced movement
    never provokes, by construction (#9).
12. **`entrench` precedes `shoot` or it never happens.** Both gate on
    the same range/LOS facts; if shoot sits higher, a shooter with AP
    for both always just shoots. The gate "AP for the crouch AND a
    shot" is what keeps entrench from turtling a unit that could have
    fired this turn.
13. **Break pools persist; bouts must reset.** Barrier damage lives in
    grid side maps across fights ("gradually break down a barrier" spans
    them, `TACTICS_PLAN.md` M8). An AI that batters partitions
    permanently edits the floor — intended in play, but milestone 1's
    bouts must reload the level between runs or bout N+1 measures a
    different arena.
14. **Heals aim at units, not sheets, and not at expiring temps.** Enemy
    hp/maxHp live on the unit; the support plan skips summons near their
    `lifetimeTurns` end (healing a body that despawns next round reads
    as AI stupidity) and re-validates the ally still stands at DOING
    time.
15. **The single-storey assumption lives in the tile keys.** Route points
    are `[x, z]` and dedup keys are `"x,z"` — fine while `floors.js`
    refuses actors above the ground storey (a named error), wrong the day
    it stops. Any new map keyed by tile coordinates gets its key built in
    ONE helper, not inline, so the storey coordinate lands in one edit;
    and any new body-to-body test goes through the existing geometry
    helpers (never a raw `dist`/`cheb` inline), so the same-storey gate
    can land once, in `tactics.js`, when bodies go vertical.
16. **A pure module's world argument is a CONTRACT, and unit tests cannot
    check it.** This one shipped and cost twelve e2e specs: `aiShovePlan`
    reaches `displacePlan`, which asks `occupied(x, z)` — a test the
    `world` facade does not carry (combat's own shove builds it inline).
    Passing the bare facade threw a TypeError on every DECIDE with a
    member adjacent, freezing the enemy turn mid-frame with its AP
    unspent. The unit tests passed throughout, because they hand-build a
    world that HAS the test — which is the whole lesson: a pure module
    documents what it needs, the caller must actually supply it, and only
    a real fight proves the two met. When wiring a new plan into
    `combat.js`, read the pure function's destructure list and check
    every key against what the facade really exposes. The tell in play is
    unmistakable and worth memorizing: `phase: 'ai'`, `moving: false`,
    `wait` gone negative, AP unspent — that is a THROW inside the driver,
    never a stall in the ladder.
17. **The believability floor is a feature.** Larian tunes its scorer
    away from raw optimality toward legible play — the base archetype
    file's own comments say "Damaging allies looks pretty stupid"
    (verified as file content; see the reference section). When a scored
    choice ties, prefer the one whose log line explains itself — the
    aggression dots, the log, and the FX are the difficulty the player
    actually perceives, and this game's own OA lesson applies: a rule
    the player can't read gets filed as a bug.

## Milestones (each a PR that keeps `npm test` + e2e green)

Each milestone below carries its scope, the files it touches, its named
tests, and its acceptance line — written for an executor who has this doc
and the codebase, nothing else.

1. **The measuring stick.**
   - *Scope:* a seeded scripted bout with a per-side tally, so every later
     PR quotes before/after numbers instead of vibes.
   - *The protocol:* a dev level (reuse `levels/dev/spike-lobby.json` or a
     purpose-built `sparring.json` sibling); a fixed party via god mode; a
     `?seed=` dev query param `main.js` reads and threads into the fight's
     `rng` `[proposed]` (the rng is already injectable — seeded runs
     reproduce slips); the PASSIVE-PARTY bout (the party ends every turn
     via the god handle) as the primary metric — it measures pure AI
     damage output per round with zero player-skill noise. Reload the
     level between bouts (footgun 13 — break pools persist).
   - *The tally:* a `bout` getter on `window.__combat`: `{ rounds,
     dmgDealt, dmgTaken, beats: {attack: n, advance: n, …}, oaCount }`.
     The beats histogram is the regression tripwire — a change that
     zeroes `attack` broke gating, whatever the damage numbers say.
   - *Files:* `main.js` (seed param), `combat.js` (tally, ~20 lines),
     one e2e spec, possibly one dev level JSON.
   - *Acceptance:* two runs with the same seed produce identical
     tallies; the PR records the baseline numbers for level 1 and 2.
     `[proposed]` — if e2e bouts prove flaky, the tally stays and the
     spec demotes to a manual god-mode readout without blocking 2–7.
2. **Target scoring (A3).**
   - *Scope:* the `pickTarget` blend from "The scored choices", `focus`
     vocabulary + the four per-def values, the `current`-target
     transient, `AI` block entries.
   - *Files:* `combat-ai.js` (the rule + `AI`), `combat.js` (pass
     `focus`/`current`/`expSwings` leaf facts), `data/enemies.js`
     (fields + header doc).
   - *Unit tests (combat-ai.test.js):* "an engageable member outranks a
     nearer one behind a wall" (unchanged, the tier survives); "a
     finishable target outranks a nearer hale one at focus 1"; "focus 0
     is the old rule: nearest, wounded tiebreak"; "stickiness holds the
     current target against a marginally better score"; "tie-break is
     stable order". The current wounded-tiebreak test is REWRITTEN (it
     encodes the old design — deliberate, per `CLAUDE.md` the shipped
     game embodied it, and this plan supersedes it).
   - *e2e:* one bout asserting concentration — with two members at equal
     distance, the Executive's damage lands on one of them ≥80% by
     round 3 (seeded, forceHit).
   - *Acceptance:* milestone-1 tally shows dmgDealt flat or up, spread
     (dmg split across members) down.
3. **Destination scoring (A2's second half).**
   - *Scope:* `scoreDestination` over the existing swing-tile routes:
     flank-seeking, OA-avoiding, hazard-avoiding approach. Melee only
     (the ranged candidate set arrives in 5).
   - *Files:* `combat-ai.js`; `combat.js` threads the leaf facts
     (threats with reach, allies, `facingOf`, surface queries — all
     exist on or near the `world` facade).
   - *Unit tests:* one per term — "a flanking arrival outranks a shorter
     route at equal cost"; "a route through fire loses to a dry detour
     worth ≤ its weight"; "a route eating an OA loses unless it buys a
     kill-adjacent arrival"; "the degenerate self-path always wins"
     (the sacred pacing-bug case, restated against scoring); "scores
     are computed at the approach point, not the tile centre" (regression
     for the octant-flip trap).
   - *e2e:* the flank bout — a second enemy positioned opposite; the
     advancing enemy arrives on the far side and the hit log reads the
     pincer bonus.
   - *Acceptance:* anti-stall suite untouched and green; tally shows
     oaCount (enemies' own provokes) down.
4. **The cover-denial beats (A4, Q3) + the refused-set tail.**
   - *Scope:* `aiShovePlan` / `aiPullPlan` / `aiBreakPlan` (+ door-open),
     partition aim added to the topple beat, the four doing arms, and
     the generalized failure tail (this is the first milestone with
     enough arms to need it — `afterFailedAdvance` becomes its first
     instance).
   - *Files:* `combat-plans.js` (plans), `combat-ai.js` (ladder arms +
     refused set), `combat.js` (doing arms, plan gathering), log lines.
   - *Unit tests (combat-plans.test.js):* "a shove that only moves
     someone is refused; a slam is taken; a hazard landing is taken";
     "the disengage variant accepts a step-back only for the ranged
     kit"; "aiPullPlan excludes the puller's own body from the cover
     faces"; "aiBreakPlan gates on nobody-engageable and refuses when a
     route exists". *(combat-ai.test.js):* the ladder-order tests extend
     to twelve arms; the termination test enumerates the refused-set
     lattice.
   - *e2e:* a member crouched behind a partition gets pulled over it
     (log + position assert); a party sealed behind a battered partition
     watches it come down within N rounds; an enemy sealed by a closed
     door opens it and joins.
   - *Acceptance:* `TACTICS_PLAN.md` M8's deferral notes get a
     follow-up citation pointing here; tally: dmgDealt up in
     cover-heavy layouts.
5. **The ranged enemy (A5, Q1).**
   - *Scope:* the ranged attack entry on the chosen def, the
     context-aware line picker (HERE, not 6 — footgun 9), `shootPlan` /
     `entrenchPlan` and their arms, the ranged candidate set for
     `advance`, the enemy-side `shotOutcome` reading with the symmetric
     redirect refusal (footgun 10).
   - *Files:* `data/enemies.js`, `combat-plans.js`, `combat-ai.js`,
     `combat.js` (the ranged strike twin of `unitStrikesMember`).
   - *Pre-req:* fix the ranged walk-in bug (`TODO.md` Phase 1) first or
     with this — the AI reuses the corrected question ("any tile within
     range with LOS"), not the melee-shaped one.
   - *Unit tests:* "in reach, the melee line pool wins; at distance,
     only ranged lines with LOS qualify"; "a refused shotOutcome removes
     the line from the pool"; "entrench precedes shoot and gates on
     affording both"; "the firing-tile score prefers a shielded face and
     respects KEEP_AWAY".
   - *e2e:* the entrenched-shooter bout — the armed enemy crouches
     behind a desk and shoots over it two rounds running (crouch
     survives attacking, `[ratified]`); the player pulls him over it —
     the counter the system promised.
   - *Acceptance:* the player-side crouch is observably worth taking
     (bout with a crouched vs standing passive party shows the damage
     gap).
6. **Support AI (A6, Q4).**
   - *Scope:* `supportPlan` + the arm, HR's `support` descriptor, the
     status weight on the line picker, summoner spacing (her destination
     score gains a stand-behind-the-temps term — reuse `KEEP_AWAY` with
     her summons as the screen).
   - *Unit tests:* "an ally under HEAL_AT within range is healed;
     lowest fraction first"; "an expiring summon is not worth a heal";
     "the ration exhausts and the arm stops gating on"; "an `applies`
     line the target already wears loses its extra weight".
   - *e2e:* the healer bout — HR tops up a wounded Manager and the log
     says so; killing HR first ends the topping-up (the objective the
     beat exists to create).
   - *Acceptance:* fights against HR groups run longer in the tally;
     Q4's fallback (B) is one def field away if they DRAG.
7. **The tuning pass.** — **OPEN, and deliberately so.**
   - *Scope:* no new systems. The `AI` block swept against milestone-1
     bouts on both shipped levels; per-def `focus`/support values
     against fight feel; the PR records every dial moved and its
     before/after tally. If a difficulty selector is ever ratified (Q5),
     this block is where it plugs in — and the reference section's
     per-difficulty loadout mechanism (`SkillAIParams` flags) is the
     shape to copy for "this attack entry only above depth N", which
     the legend's per-placement levels (`CHARACTER_PLAN.md` #15) could
     express with no new machinery.
   - *The browser gates are no longer outstanding.* Two god levers landed
     and all three AI beats are now pinned in a browser — see the
     verification note above.
   - *Why it did not land with 1–6:* this milestone's input is somebody
     playing the game. Every constant in the `AI` block is a first draft
     by the same standard the four prior combat plans set — "numbers are
     first drafts, deferred to playtest" — and inventing a tuning pass
     without a played fight would be exactly the guess-wearing-a-
     decision's-clothes this repo's process exists to prevent. The dials
     are all in one block, the tally is on `__combat.bout`, and the six
     shipped milestones are what makes the pass measurable. **It wants a
     playtest, not a PR.**

Order rationale: 2–4 sharpen the game the AI already plays (melee), 5–6
widen it, 7 tunes it. 1 exists so 2–7 can prove they did anything. Milestones
2, 3 and 4 are independent of 5 and 6 and could land in any order; 5 wants 3
first (a shooter that can't pick tiles shoots from bad ones).

### As landed (2026-08-01/02, milestones 1–6 in one pass)

All six implementation milestones shipped on this branch, one commit each.
**Verification:** unit 688 → 712 green throughout; e2e 44 green across the
combat surface after the facade fix below — smoke (6), tactics/cover/
topple/summons (22, the positional and cover-denial systems the new beats
lean on), charm/statuses/hit/ranged (13, the side-swap, the status
weighting, the roll, the shot), and the three new AI gates. **Milestone 7
is open by design** — it wants a playtest, not a PR.

**The bug the first e2e run caught, and what it taught.** Milestones 1–6
all passed unit tests and the smoke suite, and twelve specs across four
files still timed out identically: `phase: 'ai'`, `moving: false`, `wait`
negative, AP unspent. That signature is a THROW inside the per-frame
driver, not a stall in the ladder — `aiShovePlan` was handed the bare
`world` facade, which carries no `occupied` test, so `displacePlan` threw
on every DECIDE with a member standing adjacent. Recorded as footgun 16,
because the class of mistake outlives this instance: a pure module's world
argument is a contract that only a real fight can prove was met.

**The gates, and the two levers that made them possible.** All three new
beat families are pinned in a browser (`tests/e2e/ai.spec.js`): the
Executive shoots from across the room rather than closing, a crouched
member is hauled over their own cover, and a coworker sealed by a shut
door works the handle. Each reads `__combat.bout.beats`, the histogram M1
built for exactly this.

Two `god.js` levers unblocked them, and the reason each is needed is worth
recording because it is a property of the game, not of the tests:

- **`__god.fight()`** opens combat *where the bodies stand*, through the
  same `beginCombat` entry and the same engaged set (ENGAGE_RADIUS +
  `canTakePart`) the real trigger uses — only the walk-in is skipped. A
  walk-in ends wherever adjacency happens to fire, which destroys any
  staged geometry before the fight begins. Deliberately NOT wired into the
  `enterCombat` helper: that was tried once as `startFightNow` and reverted
  because opening from where the player stands changes the geometry
  existing specs assume.
- **`__god.setDoor(key, open)`** makes the terrain edit with no walk, no
  click and no AP. Shutting a door mid-fight is the only way a unit can BE
  sealed by one, and the player doing it needs an exact-tile click that a
  frame's drift turns back into an ordinary step.

**A correction to this document's own record:** an earlier draft (and a
comment written during M1) claimed initiative rolled off its own hardwired
closure, so seeded runs could not pin turn order. That was stale —
REVIEW.md's "the rng seam is misleading" finding had already been closed.
Initiative rolls through `initRng` off the injected stream like every other
roll, so `?seed=` reproduces a whole fight, turn order included. The gates
use it, and `bootStash` now takes a `seed` option. What a seed does *not*
pin is where the bodies are when a fight opens; that is what `fight()` is
for, and conflating the two is what sent the first attempt at these gates
chasing the wrong fix.

**A second real bug the e2e work caught.** The AI's Pull Over wiring passed
`bodyAt` without excluding the puller's own body — the player's wiring
excludes both puller and victim (`u !== active`, `u !== en`) and mine did
not. A face shielded by a PARTITION can still have somebody standing on the
neighbouring cell, and in a corridor that somebody is whoever walked up to
reach over it, so the plan refused with "their cover is a person" for
exactly the haul-over-a-wall the verb exists for. Fixed; footgun 16's lesson
generalizes — the pure rule was right, the caller's contract was not.

Deviations and honest notes, recorded here per the house pattern:

- **M1:** `?seed=` landed on the `?level` dev-lane pattern; the tally
  (`__combat.bout`) counts rounds, AI damage landed (instrumented at the one
  member-strike sink, so OAs and shots ride along), the chosen-beat
  histogram, and reactions fired. The initiative-closure rng gap (REVIEW.md)
  is documented AT the seed param rather than fixed - per-side totals are
  order-noise-tolerant by design. The scripted-bout e2e spec did not ship;
  the tally is read manually or by any later spec.
- **M2:** as specified. The wounded-tiebreak behavior survives EXACTLY at
  `focus: 0` and as the tie-break chain, both pinned by name in the tests.
- **M3:** as specified, plus the footgun-15 note made real: hazard walks
  read route waypoints, which findEnemyPath emits per-tile - synthetic
  routes in tests must do the same.
- **M4:** the refused-set tail subsumed `afterFailedAdvance` entirely (the
  function is gone, its behavior arrives by ladder re-run - the failed
  advance still crouches, now for a reason). The stall backstop became
  `pass` → `advanceTurn`, which ends the turn without the old AP burn.
  **The door-open arm is deferred with a named reason:** door keys never
  cross the world facade (`doors.js` owns them main-side; combat sees only
  midpoints via `doorsBeside`), so the arm needs a facade seam main.js must
  grow first. The piñata case A10 names remains open until then - the
  break beat covers the partition half. The AI shove does not chain a
  prop-topple the way the player's `displaceBody` can `[proposed]` - the
  slam is flat damage, no cascade, cheap to add later.
- **M5:** as specified. **Cost worth knowing:** the firing field scans a
  `(2R+1)²` box around the target with a `hasLos` trace per tile — 121
  traces at range 5 — before routing the nearest 12. It runs once per
  advance beat (not per frame: the driver returns early while a unit is
  `moving`), and the A* fan stays capped at the melee field's budget,
  which was the expensive half the engageMemo was built for. If a deep
  floor of shooters ever reads as a pause, the scan is where to look
  first, and the cheap fix is a smaller `cap` plus a coarser candidate
  ring rather than a memo (the answer changes as bodies move).
  The known approximation: a blocked `shotOutcome`
  (object shield) does not steer the firing-tile search toward a flanking
  angle - the shooter repositions by LOS/shield/keep-away and re-plans next
  turn. The player-side ranged walk-in bug (`TODO.md` Phase 1) was NOT
  imported: the AI asks its own right question (`firingTileRoutes`); the
  player-side fix stays open, player-side.
- **M6:** as specified, plus the summoner-spacing term generalized into a
  `backline` bias (ranged OR support/summoner kits) - a weight over an
  already-admitted destination field, so it biases WHICH swing tile, never
  whether to advance. Known approximation, recorded in the shove perform
  too: a member forced onto a hazard is billed the shared surface number -
  personal hazard immunities (talent-shaped, main.js's walking model) are
  not consulted on forced landings. The charm case was caught and FIXED
  rather than noted: `engaged` keeps a charmed coworker (deliberately —
  charming the last enemy must not win the fight), but for the duration
  they fight for the player, so both AI ally-shaped questions — who
  completes my pincer, who do I patch up — go through an `aiAllies()`
  side test instead. Without it an enemy heals the colleague currently
  swinging at it, which is footgun 5 in the flesh.

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
  worse decision for a stall. The termination invariant gets its own
  unit test: for any beat state, a DECIDE step spends, refuses, or ends
  — exhaustively over the refused-set lattice, which is small enough to
  enumerate.

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
