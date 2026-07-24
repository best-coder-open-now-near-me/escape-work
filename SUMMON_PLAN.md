# Summon System Plan

A power for HR characters to summon **applicants** — disposable combatants who
fight on the summoner's side. Baldur's Gate / Divinity style: a temporary
minion, not a recruit. This document is the implementation plan: the design
decisions, the module-by-module changes, and the milestone order. No code yet.

Built on top of the party system (see `PARTY_PLAN.md`), which already ships the
hard half of a friendly-combat layer: per-member AP, downed/revive, party-wipe
defeat, and enemies targeting the nearest living party member. Summoning adds
the *other* half — a generic **faction** so both sides can field AI units.

## Direction: the class as the shared unit archetype

A steer that shapes this plan: **a class is becoming the shared identity for
every unit** — the character you pick, the companions you recruit, and a lot of
the enemies too will each *be* a class. Today that's only half-true (`CLASSES`
backs the player; `COMPANIONS` and `ENEMY_TYPES` carry their own class-shaped
stat blocks), but the trajectory is convergence on one archetype registry.

This plan is designed to move *with* that trajectory, not against it:

- The playable **Human Resources** summoner is a class (`data/classes.js`).
- The **applicant** is also a class — a deliberately weak, **non-playable** one.
- The summon descriptor references a **class/archetype id**, so "summon 2
  applicants" is "spawn 2 units of the `applicant` archetype," identical
  machinery whoever casts it.

What this plan does **not** do: migrate the existing `ENEMY_TYPES` and
`COMPANIONS` entries onto classes. That's the broader effort the steer
describes; this plan only adds the archetype fields the class shape needs so
that migration is later a data exercise, and proves them out on the one new
fully-class-based unit (the applicant). Existing enemies and companions keep
working untouched.

## What we're building

- **A generic faction layer.** Every AI combatant carries a `team`:
  `'enemy'` (today's coworkers) or `'player'` (your side). Targeting
  generalizes from "the enemy hunts the party" to "an AI unit hunts the
  nearest living combatant on the opposite team." This is the one new *system*;
  everything else is content and wiring on top of it.
- **The class shape learns to back AI units.** A class gains optional
  AI-combat fields (`attacks`, `attackAp`, `xp`, `loot`) and a `playable` flag.
  Player classes ignore the AI fields (you drive them through the action bar);
  AI-driven class units ignore the `actions` kit. One shape, two ways to drive
  it — the on-ramp to class-based enemies.
- **Applicants as data.** The `applicant` class — low HP, one flailing attack,
  no loot, ~no XP, `playable: false` so it never shows in the picker. Summoned
  onto either team from the same definition.
- **Enemy HR summons applicants against you** (ships first). During its turn
  the HR Representative can spend AP to call in 1–2 applicants, capped and on a
  cooldown, who join the fight as ordinary enemies.
- **Player HR summons applicants for you** (the symmetric payoff). A new
  `type: 'summon'` combat action, owned by the playable **Human Resources**
  class, spawns applicants on your team who act on their own AI step.
- **Summons are disposable.** They are not party members: not controllable,
  not counted against `PARTY_CAP`, no downed/revive courtesy, and they vanish
  when the fight ends. They never touch the campaign save.

## Design decisions (recommended, with alternatives considered)

| # | Decision | Recommendation | Why / alternatives |
|---|----------|----------------|--------------------|
| 1 | Summon vs. party member | A summon is a **temporary AI unit**, never a party member — uncontrolled, outside `PARTY_CAP`, gone at combat end | Keeps the party a curated roster of 3 (PARTY_PLAN decision #1). Making summons temp members was considered: it blows the cap, hands you manual control of throwaways, and needs downed/revive/portrait UI for units meant to be spent. Rejected. |
| 2 | Faction model | A `team` field (`'player'`/`'enemy'`) on AI units; targeting picks the **nearest living hostile** (opposite team), ties to lowest HP | Mirrors the party's existing `pickTarget` rule (PARTY_PLAN #8), just generalized to a team. A full threat table is overkill at this scale. |
| 3 | Turn structure | Keep the two-phase spine and insert an **allies** step: `player → allies → enemies → player`. Both AI phases run the *same* driver, parameterized by team | Enemy-team summons need no new phase — they're already in the enemy queue. Only player-team summons need somewhere to act; a thin ally phase reusing the enemy driver is far less risk than a DOS2 initiative queue. |
| 4 | Where the applicant lives | A **non-playable class** in `data/classes.js` (`playable: false`), carrying the new AI-combat fields; the summon descriptor references its class id | Matches the steer — units are classes. A dedicated `data/summons.js` registry was the earlier draft; it's fewer moving parts today but a parallel unit registry the convergence would later have to absorb. Reusing an `ENEMY_TYPES.applicant` entry was also considered — but the applicant should serve *both* teams from one definition, and an enemy-only registry entry both mis-files it and leaks a combat-only unit into the level palette/linter/editor. The class registry is where shared archetypes are headed. |
| 5 | Class shape change | Add AI-combat fields (`attacks`, `attackAp`, `xp`, `loot`) and `playable` to the class shape, **additively**; the picker filters `playable !== false`; the combat AI reads these fields only for AI-driven class units | Non-breaking: every existing player class omits them and behaves exactly as today. The applicant is the first (and for now only) class that sets them, so the surface is tiny and testable before any enemy migrates. |
| 6 | Anti-farm: XP & loot | Applicants drop **no loot** and grant **0 XP** (or a token 1) when killed | An enemy HR that summons on a cooldown is an infinite spawner; paying XP/loot per kill turns every HR fight into a grind. Killing the *summoner* is the win condition, not the minions. |
| 7 | Summon caps | Per-summoner **live cap** (e.g. 2) + **cooldown** in rounds (e.g. 2), both data on the summon descriptor | Without a cap an enemy HR out-summons your DPS and the fight never ends; without a cooldown a player HR trivializes everything turn one. Both are tunable content, not code. |
| 8 | Lifespan | **Combat-scoped**: summons live until killed or the fight ends. Player-team summons are removed on victory/defeat; enemy-team summons simply must all die for victory | Simplest coherent rule. A timed N-round expiry (BG-style) was considered — nice flavor, more bookkeeping and UI; deferred to polish. Summons are never serialized, so they can't leak across floors. |
| 9 | Summon death | Summons **die outright** (topple + prune) — no downed/revive. A player-team summon falling is **never** a game-over | The downed courtesy exists to protect characters you've invested in (PARTY_PLAN #7). A summon is spent on purpose; defeat stays "party wipe only." |
| 10 | Spawn placement | BFS the nearest free, walkable, unoccupied tiles around the summoner; face them outward. Too few free tiles → summon fewer, with a flavor line | Reuses `isWalkable` + the occupancy checks already in `main.js`. Never spawn onto a wall, hazard-locked pocket, or another body. |
| 11 | Occupancy & pathing | Player-team summons **block enemies** (join the `partyAt`/`blockedByParty` set) and are **pass-through for the party** — exactly the companion rule. Enemy-team summons live in `enemies[]`, so they block and are targetable for free | Keeps followers/summons from jamming doorways (PARTY_PLAN follower rule) while still forming a real front line against enemies. |
| 12 | Which HR gets it | **Enemy side**: the existing `ENEMY_TYPES.hr`. **Player side**: a new **playable Human Resources class** (`hr.glb` already ships) owning a `summon-applicants` action | Resolved per the steer — HR is a class. The action is just an id, so if a recruitable HR *companion* ever wants the same power, it's a one-line data add. |

## Architecture: where it lands

The new concept at the center is **team**. Today combat has two hard-coded
sides: `party.members` (you) and `engaged` (them). We name that split and make
the AI code read the team it hunts rather than assuming "the party."

An **AI unit** is anything that takes an automated combat turn: an
`EnemyActor` today, plus summoned actors. Each gains:

- `team` — `'enemy'` or `'player'`.
- `summonedBy` — the actor that called it (null for hand-placed enemies), so a
  summoner's live-minion count is a filter and cleanup is a sweep.
- `summoned` — a marker that says "no loot, no XP, no save, remove at combat
  end."

Party members are conceptually `team: 'player'` but keep their own richer
representation (`party.members`, per-member turn records) — the faction layer
treats "player-team combatants" as `[...party members, ...player summons]`
wherever an enemy needs a target.

A second thread runs through the plan: an **archetype accessor**. The combat AI
today reads `en.def.attacks` / `en.def.ap` / `en.def.attackAp` from an
`ENEMY_TYPES` entry. Summoned units carry a **class** as their def instead. A
tiny accessor (`unitCombat(def)` returning `{ attacks, ap, attackAp, xp, loot }`)
lets the AI read either an `ENEMY_TYPES` def or a class archetype without
caring which registry it came from — the seam the broader class convergence
will widen later.

### New files

None. The applicant is a class in `data/classes.js`; the summon system lives in
`combat.js`/`main.js`. (The earlier draft's `data/summons.js` is dropped per
decision #4.)

### Changed files, in dependency order

**`src/data/classes.js`** — two things:
- The class shape gains optional `playable` (default true) and the AI-combat
  fields `attacks`, `attackAp`, `xp`, `loot`. Existing classes set none of
  them and are byte-for-byte unchanged in behavior.
- Two new entries: **`human-resources`** (playable; `model: 'hr'`; a
  summon-forward `actions` list — `summon-applicants` + a defend + a heal; a
  talent, e.g. *Open Door Policy*) and **`applicant`** (`playable: false`;
  `model: 'worker'` until a résumé-waving temp .glb lands; low `maxHp`, small
  `ap`/`attackAp`, one weak `attacks` roll — "waves a résumé", "asks about the
  culture" — `xp: 0`, `loot: []`).

**`src/ui.js`** — `showClassPicker` filters to `CLASSES` where
`playable !== false`, so `applicant` never appears as a choice while
`human-resources` does. (Also the small in-combat summon readouts, below.)

**`src/actors.js`** — `EnemyActor` (and any summoned actor built from it) gains
`team`, `summonedBy`, `summoned`, defaulting to today's behavior
(`team: 'enemy'`, not summoned) so every existing enemy is unchanged. Death for
a summoned unit skips `rollLoot` (decision #6). Reusing `EnemyActor` with these
three fields is enough — its HP/`takeDamage`/`die`/attack-anim machinery is
exactly what an applicant needs on either team, and it reads combat stats
through `unitCombat(def)` so a class-backed def works as well as an
`ENEMY_TYPES` one.

**`src/combat.js`** — the core of the work, in two parts:

*Generic AI driver (refactor, no behavior change on its own).*
- `pickTarget(en)` → `nearestHostile(unit)`: ranges over the units on the
  opposite team. For an enemy that's `[...livingMembers(), ...livingAllies()]`;
  for a player-team summon it's `world.liveEnemies()`. Same nearest-Chebyshev,
  lowest-HP-tiebreak rule.
- `enemyAttack`/`enemyAdvance` → `aiAttack`/`aiAdvance`, taking `(unit, target)`
  and reading the unit's combat stats via `unitCombat(unit.def)`.
- The enemy phase's `update()` state machine becomes team-agnostic: it drains a
  `queue` of AI units and, per unit, moves toward / attacks its
  `nearestHostile`. With one member and no summons this is byte-for-byte
  today's enemy turn.

*Ally phase + summon resolution (additive).*
- Phase machine: `player → allies → enemies → player`. `startAlliesPhase()`
  queues living player-team summons and runs them through the same driver
  against the enemy team; empty queue hands off to `startEnemyPhase()`. With
  zero player summons the ally phase is instant and invisible — existing e2e
  stays green.
- A `summons` array holds player-team AI units (enemy-team summons go straight
  into the shared `enemies`/`engaged` lists and need no new container).
- `resolveSummon({ summoner, team, descriptor })`: rolls placement tiles
  (decision #10) via a `world.spawnSummon` hook, builds each actor from the
  referenced class archetype, tags `team/summonedBy/summoned`, and files it
  into the right list. Enforces the live cap + cooldown (decision #7).
- Enemy AI, before its move/attack decision: if `unit.def.summon` exists, is
  off cooldown, and the unit is under its live cap, spend the summon's AP and
  `resolveSummon` onto team `'enemy'`. HR thus reinforces itself mid-fight.
- New action `type: 'summon'` in `onActionButton`: spend AP, `resolveSummon`
  onto team `'player'`, respect `uses`/cooldown. It's the fifth action type
  (alongside attack/shove/defend/heal); the action bar already renders any id,
  so only the click handler is new.
- Targeting UI unchanged: the player still rings `world.liveEnemies()` (enemy
  team only), so you can't accidentally target your own applicants; enemy-team
  summons are in `enemies[]`, so they ring automatically.
- Combat strip lists your summons under the party block and enemy summons under
  the enemy block (both fall out of the existing `.map`s once the lists feed
  them).
- Victory/defeat: victory = no living `engaged` enemies (their summons
  included, since those *are* enemies). Defeat stays party-wipe-only — a downed
  player summon is skipped, never a loss. On `cleanup()`, despawn every
  `summoned` actor still standing (decision #8).

**`src/main.js`** — wiring, mostly mechanical:
- `unitCombat(def)` helper (or import it if it lands in a data module) so the
  update loop / spawn path treat class-backed and `ENEMY_TYPES`-backed units
  uniformly.
- `world.spawnSummon(archetypeId, team, near)`: the runtime spawn path, cloned
  from the god-mode `spawnEnemy` helper (`new …Actor` → push to the right list
  → `placeModel(app, 'assets/characters/<model>.glb', …, onReady: attach)`).
  Player-team units go into a `summons` list the update loop walks; enemy-team
  units go into `enemies` so all the existing enemy plumbing (rendering,
  pruning, `liveEnemies`) applies.
- Occupancy: extend `partyAt`/`blockedByParty` (used by enemy wander + combat
  routing) to also count living player-team summon tiles, so enemies treat your
  applicants as bodies to path around and stop short of (decision #11).
- `liveEnemies` already returns `enemies.filter(alive)` — enemy summons ride
  along for free. Player summons are deliberately excluded.
- Update loop: step player-team summon actors each frame like party members do
  (they animate, walk their combat paths, and — since they're on the floor —
  feel surfaces via an `onMemberStep`-style hook; a summon that walks into fire
  can burn, same as a follower).
- `awardKill` reads `dead.def.xp`; an applicant's `xp: 0` makes it a no-op, so
  no special-casing (decision #6). Belt-and-suspenders: also gate on
  `!dead.summoned`.
- Debug surface: `__game.summons` (read-only), `__combat` exposes the summon
  lists; `__god` gains `summon(team, archetypeId, x, z)` for manual testing.

**`src/data/enemies.js`** — `hr` gains a `summon` descriptor:
`{ archetype: 'applicant', count: 2, cap: 2, cooldownRounds: 2, ap: 3, log:
'HR posts the role internally. Two applicants materialize.' }`. Data only; the
AI in combat.js reads it. No other enemy gets one yet.

**`src/data/actions.js`** — new `summon-applicants`:
`{ type: 'summon', ap: 4, archetype: 'applicant', count: 2, cap: 3, uses: 2,
label: 'Post the Role', log: 'You open a req. Applicants flood in.' }`.

**Levels** — none needed. Applicants exist only mid-combat; nothing is placed
in level JSON, so no legend/editor/linter changes.

### Persistence

None. Summons are combat-scoped (decision #8) and never enter
`serializeProgress` (party.js). The save format stays v2. (The `human-resources`
class persists like any class — it's the summoner that's saved, never the
applicants.)

## Milestones (each one a PR that keeps `npm test` + e2e green)

1. **Faction layer + the archetype seam + enemy HR summon.** ✅ Landed. The
   `playable` flag + AI-combat fields on the class shape; the `applicant`
   non-playable class + picker filter; the `unitCombat` accessor;
   `team`/`summonedBy`/`summoned` on actors; `world.spawnSummon` + a
   `freeTilesNear` placement helper; `resolveSummon` (team-parameterized); the
   HR `summon` descriptor and the enemy-AI trigger (off cooldown, under a live
   cap, affordable → posts the req, else fights). Fighting HR now means
   fighting the temps it posts — capped at 2, cooling down 2 rounds, worth no
   XP or loot. Covered by `tests/unit/summons.test.js` + a `summons.spec.js`
   e2e. **Deviation:** the `pickTarget → nearestHostile` / `enemy* → ai*`
   rename is deferred to milestone 2 — it's a behavioral no-op until
   player-team summons exist as enemy targets, so doing it here would be churn
   on the enemy turn for no gain. The faction substrate (team tags,
   team-parameterized summon path) is all in place. **No new phase, no
   player-facing action yet.**
2. **Player-team ally phase.** ✅ Landed. The `player → allies → enemies` phase
   machine (invisible with no summons, so ordinary fights are unchanged); the
   `summons` (player) list + per-frame stepping + despawn-on-combat-end; the
   `pickTarget → hostilesFor`/`enemyAttack → aiAttack`/`enemyAdvance →
   aiAdvance` generalization so enemies range over party **+** player summons
   and summons range over enemies; player summons block enemy pathing
   (`summonAt` in `findEnemyPath`/`freeTilesNear`/`occupied`) yet stay
   pass-through for the party; friendly Ctrl rings; a non-selectable `summon`
   pick kind. Driven in tests by a `__combat.summonAlly()` debug hook, since no
   player action exists yet. Ally units fight for you and vanish on victory;
   their death is never a loss. This PR absorbs the AI-driver refactor
   milestone 1 deferred.
3. **The HR summon power.** ✅ Landed. `type: 'summon'` handling in combat.js's
   `onActionButton` (instant, like heal/defend - spends AP, respects `uses`,
   files onto team `'player'` via resolveSummon); the `summon-applicants`
   action (**Post the Role**: 2 applicants, live cap 3, 2 uses/fight); the
   **Human Resources** playable class (`hr.glb`, `summon-applicants` + defend +
   heal, *Open Door Policy* talent). The picker filter from milestone 1 shows
   HR automatically. Pick HR, enter a fight, post the role, watch applicants
   report for duty. Covered by a `summons.spec.js` e2e; the carousel e2e gains
   HR to its lineup. The headline player-facing payoff.
4. **Balance, content & polish.** ✅ Landed (the non-playtest slice). Side-neutral
   applicant attack lines (they fight on either team); `ARCHITECTURE.md`
   documents the summon system (growth path, the `playable`/AI-fields class
   note, and the `__game`/`__combat` debug surface); `__god.spawnEnemy` resolves
   class archetypes and registers picking, plus a `__god.summonAlly` console
   twin of Post the Role for tuning. **Deferred to real playtest** (needs hands
   on the game, not code): final caps/cooldowns/HP/XP numbers and HR's summon
   cadence, any floor rebalance for HR's new staying power, timed-expiry summons,
   and a dedicated applicant `.glb`. The shipped defaults (enemy cap 2 /
   cooldown 2; player cap 3 / 2 uses; applicant 5 HP, 0 XP) are a sane starting
   point, all in data.

## Testing

- **Unit** (`tests/unit/summons.test.js`): the applicant archetype resolves to
  a valid combat stat block via `unitCombat`; `nearestHostile` target
  selection across mixed teams and ties; live-cap + cooldown gating; the
  placement helper picks free, walkable, unoccupied tiles and degrades
  gracefully when crowded; a summoned unit yields no loot and 0 XP. Plus a
  class-registry lint: `playable: false` classes are excluded from the picker,
  and any class with a `summon`/AI role carries the fields `unitCombat` needs.
- **e2e** (`tests/e2e/summons.spec.js`):
  - *Enemy side*: engage HR, advance rounds, assert the engaged-enemy count
    rises by the summon (capped), and that clearing all enemies — summoner and
    minions — still wins; killing minions alone does not.
  - *Player side*: pick the HR class, summon in combat → a player-team unit
    appears, takes its ally-phase turn against the nearest enemy, and is gone
    after victory; its death mid-fight does not end the game.
- **Regression invariant**: with no summons in play, the ally phase is a no-op
  and the AI driver is behavior-identical to today's enemy turn; every existing
  player class is unchanged by the class-shape additions. Every existing spec
  passes unchanged after milestone 1 — the same contract PARTY_PLAN milestone 1
  held.

## Risks and open questions

- **The faction refactor touches the enemy turn's hot path** (`pickTarget`,
  `enemyAttack`, `enemyAdvance`, the `update()` state machine). Milestone 1
  absorbs it as a rename-and-generalize with the existing enemy e2e as the
  guard, so milestones 2–3 are additive rather than surgical — the same tactic
  PARTY_PLAN used for its milestone 1.
- **Runaway spawners.** An uncapped or cheap enemy summon can make a fight
  unwinnable or a grind; a cheap player summon trivializes everything. The
  cap + cooldown + zero-XP + low-HP knobs (decisions #6, #7) are the whole
  defense and all live in data — milestone 4 owns tuning them against real
  floors.
- **Board crowding on small floors.** Floors are ~24×18 with narrow cubicle
  rows; two summoners could fill a room with bodies and gridlock pathing.
  Placement BFS (decision #10) plus pass-through party collision (decision #11)
  should cover it; caps keep the population bounded; budget playtest time.
- **Ally-phase pacing.** The enemy driver paces turns with per-unit animation
  waits; a swarm of applicants could make "their turn / your allies' turn"
  drag. Mitigation: shorter waits for `summoned` units, and the live cap bounds
  the count. Watch the feel in milestone 2.
- **Open — the class shape is becoming a superset.** A player class wants an
  `actions` kit; an AI archetype wants `attacks`/`attackAp`. A class that must
  be *both* (a future recruitable-or-enemy Manager) carries both, and which set
  is read depends on how the unit is driven in a given fight. This plan only
  needs the AI fields on one non-playable class, so the superset stays small —
  but the broader class convergence the steer describes will have to settle the
  full shape. Flagged, not solved here.
- **Open — reconciling `COMPANIONS` with class-backed identity.** The party
  system deliberately gave companions their own registry rather than sharing
  `CLASSES` (PARTY_PLAN #4). The steer ("all recruitable people will have one
  of the classes") points the other way. Not this plan's job, but the
  archetype fields added here are the substrate a later "companions reference a
  class" pass would build on.
- **Open — talent interactions.** Should an HR talent scale summons (more
  applicants, tougher applicants), and should applicants themselves ever carry
  a talent (e.g. slip-immune)? Deferred to milestone 4; the summon descriptor
  is the natural place to hang a `talent`/`countBonus` later.
