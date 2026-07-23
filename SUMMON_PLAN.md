# Summon System Plan

A power for HR characters to summon **applicants** — disposable combatants who
fight on the summoner's side. Baldur's Gate / Divinity style: a temporary
minion, not a recruit. This document is the implementation plan: the design
decisions, the module-by-module changes, and the milestone order. No code yet.

Built on top of the party system (see `PARTY_PLAN.md`), which already ships the
hard half of a friendly-combat layer: per-member AP, downed/revive, party-wipe
defeat, and enemies targeting the nearest living party member. Summoning adds
the *other* half — a generic **faction** so both sides can field AI units.

## What we're building

- **A generic faction layer.** Every AI combatant carries a `team`:
  `'enemy'` (today's coworkers) or `'player'` (your side). Targeting
  generalizes from "the enemy hunts the party" to "an AI unit hunts the
  nearest living combatant on the opposite team." This is the one new *system*;
  everything else is content and wiring on top of it.
- **Summonable units as data.** An `applicant` is a registry entry — weak
  stat line, a flailing attack, no loot, ~no XP — faction-neutral, so the same
  definition serves an enemy HR's minion and a player HR's ally. Per the one
  rule: content is data, code is systems.
- **Enemy HR summons applicants against you** (ships first). During its turn
  the HR Representative can spend AP to call in 1–2 applicants, capped and on a
  cooldown, who join the fight as ordinary enemies.
- **Player HR summons applicants for you** (the symmetric payoff). A new
  `type: 'summon'` combat action, owned by a playable **Human Resources**
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
| 4 | Applicant identity | New `data/summons.js` `SUMMON_UNITS` registry (`name, model, maxHp, ap, attackAp, attacks, xp, loot`), faction-neutral | Follows the companions-vs-classes split (PARTY_PLAN #4): a summon-only unit doesn't belong in `ENEMY_TYPES` (which is hand-placed, level-linted, editor-paintable) any more than a companion belonged in `CLASSES`. Alternative — reuse an `ENEMY_TYPES.applicant` entry for both sides — is fewer files but leaks a combat-only unit into the level palette and linter. Rejected. |
| 5 | Anti-farm: XP & loot | Applicants drop **no loot** and grant **0 XP** (or a token 1) when killed | An enemy HR that summons on a cooldown is an infinite spawner; paying XP/loot per kill turns every HR fight into a grind. Killing the *summoner* is the win condition, not the minions. |
| 6 | Summon caps | Per-summoner **live cap** (e.g. 2) + **cooldown** in rounds (e.g. 2), both data on the summon descriptor | Without a cap an enemy HR out-summons your DPS and the fight never ends; without a cooldown a player HR trivializes everything turn one. Both are tunable content, not code. |
| 7 | Lifespan | **Combat-scoped**: summons live until killed or the fight ends. Player-team summons are removed on victory/defeat; enemy-team summons simply must all die for victory | Simplest coherent rule. A timed N-round expiry (BG-style) was considered — nice flavor, more bookkeeping and UI; deferred to polish. Summons are never serialized, so they can't leak across floors. |
| 8 | Summon death | Summons **die outright** (topple + prune) — no downed/revive. A player-team summon falling is **never** a game-over | The downed courtesy exists to protect characters you've invested in (PARTY_PLAN #7). A summon is spent on purpose; defeat stays "party wipe only." |
| 9 | Spawn placement | BFS the nearest free, walkable, unoccupied tiles around the summoner; face them outward. Too few free tiles → summon fewer, with a flavor line | Reuses `isWalkable` + the occupancy checks already in `main.js`. Never spawn onto a wall, hazard-locked pocket, or another body. |
| 10 | Occupancy & pathing | Player-team summons **block enemies** (join the `partyAt`/`blockedByParty` set) and are **pass-through for the party** — exactly the companion rule. Enemy-team summons live in `enemies[]`, so they block and are targetable for free | Keeps followers/summons from jamming doorways (PARTY_PLAN follower rule) while still forming a real front line against enemies. |
| 11 | Which HR gets it | **Enemy side**: the existing `ENEMY_TYPES.hr`. **Player side**: a new playable **Human Resources** class (`hr.glb` already ships) owning a `summon-applicants` action | The user's pick — "usable by enemies now and a future HR player class." The action is just an id, so a future HR *companion* can carry the same power with a one-line data add. |

## Architecture: where it lands

The new concept at the center is **team**. Today combat has two hard-coded
sides: `party.members` (you) and `engaged` (them). We name that split and make
the AI code read the team it hunts rather than assuming "the party."

Concretely, an **AI unit** is anything that takes an automated combat turn: an
`EnemyActor` today, plus summoned actors. Each gains:

- `team` — `'enemy'` or `'player'`.
- `summonedBy` — the actor that called it (null for hand-placed enemies), so a
  summoner's live-minion count is a filter, and cleanup is a sweep.
- `summoned` — a marker that says "no loot, no XP, no save, remove at combat
  end."

Party members are conceptually `team: 'player'` but keep their own richer
representation (`party.members`, per-member turn records) — the faction layer
treats "player-team combatants" as `[...party members, ...player summons]`
wherever an enemy needs a target.

### New files

- **`src/data/summons.js`** — `SUMMON_UNITS` registry. First (only) entry:
  `applicant` — `name: 'Applicant'`, `model: 'worker'` (reuse the office-worker
  rig; a résumé-waving temp .glb can land later), low `maxHp`, one weak
  `attacks` roll ("waves a résumé", "asks about the culture"), `xp: 0`,
  `loot: []`. Pure data, imports nothing — same contract as every other
  `data/*`.

### Changed files, in dependency order

**`src/actors.js`** — `EnemyActor` (and any summoned actor built from it) gains
`team`, `summonedBy`, `summoned`, defaulting to today's behavior
(`team: 'enemy'`, not summoned) so every existing enemy is unchanged. Death for
a summoned unit skips `rollLoot` (decision #5). Optionally a lightweight
`SummonActor` subclass, but reusing `EnemyActor` with the three fields is
enough — its HP/`takeDamage`/`die`/attack-anim machinery is exactly what an
applicant needs on either team.

**`src/combat.js`** — the core of the work, in two parts:

*Generic AI driver (refactor, no behavior change on its own).*
- `pickTarget(en)` → `nearestHostile(unit)`: ranges over the units on the
  opposite team. For an enemy that's `[...livingMembers(), ...livingAllies()]`;
  for a player-team summon it's `world.liveEnemies()`. Same nearest-Chebyshev,
  lowest-HP-tiebreak rule.
- `enemyAttack`/`enemyAdvance` → `aiAttack`/`aiAdvance`, taking `(unit, target)`
  and reading the unit's own `def` — already parameterized enough; mostly a
  rename plus using the unit's team for the target pool.
- The enemy phase's `update()` state machine becomes team-agnostic: it drains a
  `queue` of AI units and, per unit, moves toward / attacks its
  `nearestHostile`. With one member and no summons this is byte-for-byte
  today's enemy turn.

*Ally phase + summon resolution (additive).*
- Phase machine: `player → allies → enemies → player`. `startAlliesPhase()`
  queues living player-team summons and runs them through the same driver
  against the enemy team; when the queue empties it hands off to
  `startEnemyPhase()`. With zero player summons the ally phase is instant and
  invisible — existing e2e stays green.
- A `summons` array holds player-team AI units (enemy-team summons go straight
  into the shared `enemies`/`engaged` lists and need no new container).
- `resolveSummon({ summoner, team, descriptor })`: rolls placement tiles
  (decision #9) via a `world.spawnSummon` hook, builds each actor, tags
  `team/summonedBy/summoned`, and files it into the right list. Enforces the
  live cap + cooldown (decision #6).
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
  `summoned` actor still standing (decision #7).

**`src/main.js`** — wiring, mostly mechanical:
- `world.spawnSummon(def, team, near)`: the runtime spawn path, cloned from the
  god-mode `spawnEnemy` helper (`new …Actor` → push to the right list →
  `placeModel(app, 'assets/characters/<model>.glb', …, onReady: attach)`).
  Player-team units go into a `summons` list the update loop walks; enemy-team
  units go into `enemies` so all the existing enemy plumbing (rendering,
  pruning, `liveEnemies`) applies.
- Occupancy: extend `partyAt`/`blockedByParty` (used by enemy wander + combat
  routing) to also count living player-team summon tiles, so enemies treat your
  applicants as bodies to path around and stop short of (decision #10).
- `liveEnemies` already returns `enemies.filter(alive)` — enemy summons ride
  along for free. Player summons are deliberately excluded.
- Update loop: step player-team summon actors each frame like party members do
  (they animate, walk their combat paths, and — since they're on the floor —
  feel surfaces via an `onMemberStep`-style hook; a summon that walks into fire
  can burn, same as a follower).
- `awardKill` already reads `dead.def.xp`; an applicant's `xp: 0` makes it a
  no-op, so no special-casing (decision #5). Belt-and-suspenders: also gate on
  `!dead.summoned`.
- Debug surface: `__game.summons` (read-only), `__combat` exposes the summon
  lists; `__god` gains `summon(team, unitId, x, z)` for manual testing.

**`src/data/enemies.js`** — `hr` gains a `summon` descriptor:
`{ unit: 'applicant', count: 2, cap: 2, cooldownRounds: 2, ap: 3, log: 'HR
posts the role internally. Two applicants materialize.' }`. Data only; the AI
in combat.js reads it. No other enemy gets one yet.

**`src/data/actions.js`** — new `summon-applicants`:
`{ type: 'summon', ap: 4, unit: 'applicant', count: 2, cap: 3, uses: 2,
label: 'Post the Role', log: 'You open a req. Applicants flood in.' }`.

**`src/data/classes.js`** — new **Human Resources** class: `model: 'hr'`
(already in `assets/characters/`), a summon-forward action list
(`summon-applicants` + a defend + a heal), and a talent (e.g. *Open Door
Policy* — a small buff to summon count or applicant HP, or purely flavor for
v1). The boot-time class picker renders new classes automatically.

**`src/ui.js`** — the party bar and combat strip already enumerate lists; they
gain a compact summon readout (name · HP) grouped under the owning side. No new
controls — summons aren't selectable.

**Levels** — none needed. Applicants exist only mid-combat; nothing is placed
in level JSON, so no legend/editor/linter changes.

### Persistence

None. Summons are combat-scoped (decision #7) and never enter
`serializeProgress` (party.js). A save written mid-fight — which the game
doesn't do anyway — would simply omit them. The save format stays v2.

## Milestones (each one a PR that keeps `npm test` + e2e green)

1. **Faction layer + enemy HR summon.** `data/summons.js`; `team`/`summonedBy`/
   `summoned` on actors; the `pickTarget → nearestHostile` and
   `enemy* → ai*` refactor (proven behavior-identical by the existing enemy
   e2e); `world.spawnSummon`; `resolveSummon`; the HR `summon` descriptor and
   the enemy-AI trigger. After this PR, fighting HR means fighting the temps it
   posts — capped, cooling down, worth no XP. **No new phase, no player-facing
   action yet** — the smallest slice that delivers a real feature and forces
   the faction refactor to be honest.
2. **Player-team ally phase.** The `player → allies → enemies` phase machine;
   the `summons` (player) list + per-frame stepping; enemy `nearestHostile`
   ranging over party + player summons; player summons blocking enemy pathing;
   despawn-on-combat-end. Driven in tests by a `__god.summon('player', …)`
   handle, since no player action exists yet. Ally units fight for you; their
   death is never a loss.
3. **The HR summon power.** `type: 'summon'` action handling in combat.js; the
   `summon-applicants` action; the **Human Resources** player class. Pick HR,
   enter a fight, post the role, watch applicants swarm the Manager. The
   headline player-facing payoff.
4. **Balance, content & polish.** Tune caps/cooldowns/HP/XP and HR's summon
   cadence; rebalance any floor that HR now over-defends; flavor lines for
   applicant attacks and summon events; `__god`/`__combat`/`__game` debug
   surfaces finalized; timed-expiry and a dedicated applicant `.glb` noted as
   future work.

## Testing

- **Unit** (`tests/unit/summons.test.js`): applicant unit shape; `nearestHostile`
  target selection across mixed teams and ties; live-cap + cooldown gating;
  placement helper picks free, walkable, unoccupied tiles and degrades
  gracefully when crowded; a summoned unit yields no loot and 0 XP.
- **e2e** (`tests/e2e/summons.spec.js`):
  - *Enemy side*: engage HR, advance rounds, assert the engaged-enemy count
    rises by the summon (capped), and that clearing all enemies — summoner and
    minions — still wins; killing minions alone does not.
  - *Player side*: as the HR class, summon in combat → a player-team unit
    appears, takes its ally-phase turn against the nearest enemy, and is gone
    after victory; its death mid-fight does not end the game.
- **Regression invariant**: with no summons in play, the ally phase is a no-op
  and the AI driver is behavior-identical to today's enemy turn — every
  existing spec passes unchanged after milestone 1. This is the milestone-1
  contract, exactly as PARTY_PLAN milestone 1 was.

## Risks and open questions

- **The faction refactor touches the enemy turn's hot path** (`pickTarget`,
  `enemyAttack`, `enemyAdvance`, the `update()` state machine). Milestone 1
  absorbs it as a rename-and-generalize with the existing enemy e2e as the
  guard, so milestones 2–3 are additive rather than surgical — the same tactic
  PARTY_PLAN used for its milestone 1.
- **Runaway spawners.** An uncapped or cheap enemy summon can make a fight
  unwinnable or a grind; a cheap player summon trivializes everything. The
  cap + cooldown + zero-XP + low-HP knobs (decisions #5, #6) are the whole
  defense and all live in data — milestone 4 owns tuning them against real
  floors.
- **Board crowding on small floors.** Floors are ~24×18 with narrow cubicle
  rows; two summoners could fill a room with bodies and gridlock pathing.
  Placement BFS (decision #9) plus pass-through party collision (decision #10)
  should cover it; caps keep the population bounded; budget playtest time.
- **Ally-phase pacing.** The enemy driver paces turns with per-unit animation
  waits; a swarm of applicants could make "their turn / your allies' turn"
  drag. Mitigation: shorter waits for `summoned` units, and the live cap bounds
  the count. Watch the feel in milestone 2.
- **Resolved — where the applicant unit lives.** A dedicated `data/summons.js`,
  not an `ENEMY_TYPES` entry, so a combat-only unit never leaks into the level
  palette, the map linter, or the editor (decision #4). Mirrors companions vs.
  classes.
- **Resolved — a summon is not a recruit.** Temporary, uncontrolled, capless of
  the party, save-invisible (decision #1). The party system owns durable
  allies; the summon system owns disposable ones. Keeping them separate is what
  keeps both simple.
- **Open — talent interactions.** Should an HR talent scale summons (more
  applicants, tougher applicants), and should applicants themselves ever carry
  a talent (e.g. slip-immune)? Deferred to milestone 4; the descriptor is the
  natural place to hang a `talent`/`countBonus` later.
