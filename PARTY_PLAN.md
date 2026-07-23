# Party System Plan

Companions who join you, follow you, and fight beside you — Baldur's Gate /
Divinity style. This document is the implementation plan: the design decisions,
the module-by-module changes, and the milestone order. No code yet.

## What we're building

- **Recruitable companions**: talkable coworkers (the existing NPC layer) who
  can join the party through a dialogue choice. Each companion is a data entry —
  stats, model, actions, talent — per the one rule: content is data, code is
  systems.
- **Out of combat**: you control the leader; companions follow in loose
  formation. One party, one camera, one click-to-move.
- **In combat**: every party member is a full combatant with their own AP pool
  and action bar. One shared "party phase": you switch freely between members,
  spend their AP in any order, then End Turn hands the round to the enemies —
  the Divinity Original Sin round shape, minus per-character initiative.
- **Party UI**: a portrait bar showing each member's HP/status, used to switch
  the active member in combat.
- **Persistence**: the whole party carries across floors with the campaign
  save, like the sheet does today.

## Design decisions (recommended, with alternatives considered)

| # | Decision | Recommendation | Why / alternatives |
|---|----------|----------------|--------------------|
| 1 | Party size | Cap at 3 total (you + 2) for now; architecture supports N | Floors are ~24×18 with 2–4 enemies; a party of 4+ trivializes fights until encounters are rebalanced. Raise the cap later alongside bigger floors. |
| 2 | Turn structure | One shared party phase, per-member AP, free switching; End Turn ends the whole side | Keeps combat.js's two-phase spine (`player`/`enemies`) intact — a full initiative queue (DOS2-style) would be a rewrite of the phase machine for little gain at this scale. |
| 3 | Recruitment | Dialogue option with an `effect: { recruit: '<id>' }` — the NPC converts to a party member in place | Reuses the existing NPC + dialogue plumbing; no new interaction verb needed. |
| 4 | Companion identity | New `data/companions.js` registry; entries carry a class-like stat block (maxHp, ap, actions, talent) plus the NPC-side fields (dialogue, examine) | BG-style: a companion IS a fixed class. Sharing the CLASSES registry was considered but companions want weaker stat lines and their own dialogue/recruit metadata — a merged registry muddies both. |
| 5 | XP | Every living member gets full XP from every kill; companions join at the leader's level | No split-XP bookkeeping, nobody lags. Matches BG3's shared-level feel. |
| 6 | Inventory | Shared party pockets (one `inventory`, on the party, not per sheet); physical statuses (paper ammo, gum, bleed) stay per-sheet | Per-character inventory means an inventory-owner picker on every pickup — UI weight with no gameplay payoff at this scale. Paper ammo is debatable; keeping it per-sheet preserves "who's carrying the stack" as a tactical fact and matches how gum/bleed already work. |
| 7 | Death | 0 HP = **downed**, not dead: death-topple anim, out of the fight, not lootable. Party wipe (everyone down) = game over. Survivors' victory ends the fight and downed members get up on 1 HP. Out of combat, walk up to a downed companion to help them up (1 HP) | Permadeath punishes experimenting with hazards (this game's whole identity). "Demoralized, not deceased" also fits the office fiction. |
| 8 | Enemy targeting | Nearest living party member (Chebyshev), ties broken by lowest HP | Simple, readable, and creates real tank/squishy positioning decisions. Threat tables are overkill. |
| 9 | Hazards & surfaces | Followers trigger surfaces/hazards per tile entered, same as the leader (slips, gum, paper pickup, damage — all per-sheet) | It's the Divinity layer; exempting companions would make them ghosts. Slight added risk of "companion walks through fire" annoyance — mitigated because followers path with the same hazard-avoiding cost model. |
| 10 | Floor exit | Leader reaching the exit ends the floor; the party is gathered automatically into the stairwell (they all spawn together next floor) | Requiring everyone to reach the exit adds shepherding busywork; BG3 does gather-on-transition too. |
| 11 | Leader switching out of combat | Not in v1. The character you picked at boot is the leader; portraits are informational out of combat | Cuts scope: hotbar, talents-affecting-movement (slip immunity, lighter), and camera all key off the leader. Revisit once the party core is stable. |

## Architecture: where it lands

New concept at the center: **the party** — an ordered array of members, each
`{ sheet, actor }`. `party[0]` is the leader. Today's `sheet` + `player` become
`party[0].sheet` + `party[0].actor`; a one-member party must behave exactly as
the game does today (that invariant is what keeps every existing test green
through the refactor).

### New files

- `src/data/companions.js` — COMPANIONS registry: `id, char, name, model,
  examine, maxHp, ap, bonusDmg, actions, talent, dialogue`. The dialogue tree
  gains an optional per-option `effect` field (see below). First entry: the
  Nervous IT Intern, promoted from `data/npcs.js`.
- `src/party.js` — pure logic (unit-testable, no PlayCanvas/DOM): party
  creation, `createCompanionSheet(id, level)` (leans on stats.js), add/remove
  member, downed/revive rules, XP fan-out, save serialization + migration of
  the old single-sheet shape.
- `ui.createPartyBar` in `src/ui.js` — portraits with HP bars, active-member
  highlight, downed marker. Clicking a portrait switches the active member in
  combat (and later, the leader out of combat).

### Changed files, in dependency order

**`src/stats.js`** — `createSheet` grows an optional stat-block source so
companions reuse the same sheet shape (add a `name` field so HUD/combat lines
can say who). `gainXp`/`applyDamage`/`damageBonus` already take a sheet and
need no changes.

**`src/actors.js`** — `CompanionActor extends GridActor`: follower movement
(path to a formation slot near the leader, repath when the leader's tile
changes or on arrival), the wander-style "stop short instead of overlapping"
guard, and a `downed` state that reuses the death-topple/corpse animation
without the loot semantics. `NpcActor` stays for never-recruitable NPCs.

**`src/grid.js`** — spawn parsing learns companions: a legend char resolving
into COMPANIONS produces a `companionSpawns` entry (they stand on the map as
NPCs until recruited, so this mostly routes them into the same npc-like spawn
path with their registry attached).

**`src/main.js`** — the big one, but mostly mechanical:

- `sheet`/`player` references become leader accessors; a `party` array owns
  the members. `isWalkable` blocks on any party member's tile for enemies —
  but party members are pass-through **for each other's pathing** (BG3-style),
  so followers never traffic-jam in a doorway.
- `onPlayerStep` generalizes to `onMemberStep(member, …)`: surfaces, slips,
  gum, bleed, paper pickup all run against that member's sheet. Exit and
  pending walk-up interactions stay leader-only. `checkCombatTrigger` fires on
  any member's adjacency to an enemy.
- Recruitment: `renderDialogueNode` learns option `effect`s. `recruit` swaps
  the `NpcActor` for a `CompanionActor` in place (same entity, re-registered
  in picking as kind `party`), creates the companion sheet at the leader's
  level, and refreshes the party bar.
- Enemy AI world hooks (`playerTile`, `occupied`, wander avoidance) generalize
  to nearest-member queries.
- Explosions/hazards damage any member in range, with the downed rule instead
  of instant game over (game over only on party wipe).
- Victory/stairwell heals apply to every member; the campaign save writes the
  party (see persistence below).

**`src/combat.js`** — second big one:

- `startCombat({ party, … })` instead of `({ sheet, player, … })`. Per-member
  turn state: `ap`, `defended`, `armed`, `usesLeft`, `pendingMelee` move into a
  per-member record; an `active` pointer picks whose action bar, movement
  preview, cone origin, and purge-self-target are live. Switching: party-bar
  portrait click, Tab to cycle, or clicking a member's model (new `party`
  picking kind).
- Action bar rebuilds when the active member changes (different sheets bring
  different actions). DOM ids stay `#act-<id>` for the active member so the
  test surface is stable.
- Enemy phase: `enemyAttack`/`enemyAdvance` take a target member (decision
  rule #8); surprise distance measured from the nearest member.
- Downed handling: member hits 0 → downed, skipped by everything, enemies
  retarget; all down → defeat; victory revives at 1 HP.
- The combat strip lists the whole party, then enemies.

**`src/picking.js` / hover-highlight in main.js** — new `party` kind: teal-ish
highlight, pointer cursor; out of combat, clicking a companion opens their
dialogue (companions keep talking after they join — post-recruit tree).

**`src/god.js` / debug handles** — `__game` gains `get party()`; `stats`
stays the leader's sheet (test compatibility). `__god` gains
`recruit(id)`, `party` live refs, per-member heal/damage.

**`src/ui.js`** — party bar (above); `updateStatsHud` shows the leader (the
bar covers the rest); dialogue panel unchanged apart from effect-carrying
options.

**Levels** — companions are placed via the actors legend like NPCs. `N`
(it-intern) on floor 1 becomes the first recruit. Note: the editor already
drops unknown actor chars on re-export (documented limitation for NPCs); same
caveat applies, fix not in this plan's scope.

### Persistence

Progress save v2: `{ version: 2, levelId, party: [sheet, …] }`. Loading the
old `{ levelId, sheet }` shape wraps it into a one-member party (migration
lives in `party.js`, unit tested). All members spawn adjacent to the player
spawn on the next floor. Recruitment state needs no separate flag — a
companion in the save's party array simply doesn't spawn as an NPC when the
level's legend places them (spawn-time check against the party roster).

## Milestones (each one a PR that keeps `npm test` + e2e green)

1. **Party foundation refactor (no behavior change).** Introduce `party.js`
   and the `party` array; thread it through `main.js` and `combat.js` as a
   one-member party; generalize `onPlayerStep` → `onMemberStep` and the enemy
   world hooks. Save format v2 + migration. The game plays identically;
   existing tests prove it. This PR is deliberately boring and is most of the
   risk.
2. **Recruitment + following.** `data/companions.js`, dialogue `effect`s,
   NpcActor→CompanionActor conversion, follower movement, hazards-per-member,
   party pass-through pathing, party bar (display only), picking kind. After
   this PR you can recruit the intern and walk the floor as a duo — but combat
   still only fields the leader.
3. **Party combat.** Per-member combat state + active-member switching, enemy
   targeting, downed/revive, party wipe, strip/UI. The core payoff PR.
4. **Persistence + polish.** Party across floors, help-up interaction out of
   combat, god-mode/debug surface, XP fan-out, victory/stairwell heals for
   all, examine/dialogue for recruited companions.
5. **Content + balance.** A second companion on floor 2 (a Mail Room veteran
   fits the fiction and the unused `mail-cone` action set), encounter
   rebalance (more/beefier enemies per floor to meet the bigger party), flavor
   lines. New e2e specs land with each milestone, not just here.

## Testing

- **Unit** (`tests/unit/`): `party.test.js` — companion sheet creation, XP
  fan-out, downed/revive rules, save v1→v2 migration; levels lint gains a
  check that legend chars resolving into COMPANIONS are valid.
- **e2e** (`tests/e2e/party.spec.js`): recruit via dialogue → party size 2 and
  the follower actually follows (tile distance bound after a long walk);
  combat: switch active member, both spend AP, enemy attacks the nearest
  member; downed member revives on victory at 1 HP; floor exit carries the
  party (reload, both present); old save loads as a one-member party.
- **Regression invariant**: every existing spec must pass unchanged after
  milestone 1 — a one-member party is today's game.

## Risks and open questions

- **`combat.js`'s single-player assumptions are pervasive** (movement preview,
  cone origin, purge self-target, walk-up melee, the opening-strike path from
  the hotbar). Milestone 1 deliberately absorbs this as a pure refactor so
  milestone 3 is additive rather than surgical.
- **Follower pathing feel** — doorway congestion and hazard shepherding are
  where BG-likes feel janky. Pass-through party collision + the existing
  stop-short guard should cover it; budget playtest time here.
- **Balance inversion** — two bodies with today's encounter sizes makes fights
  easy. Acceptable during milestones 2–4; milestone 5 owns the rebalance.
- **Open: does the armed-hotbar opening strike stay leader-only?** Plan says
  yes for v1 (the hotbar is the leader's), with combat switching available the
  moment the fight starts.
- **Companion talents that act on the world** (a Smoker companion's lighter).
  Resolved: since a talent isn't a passable object, the long-term model is
  spell-like — a targeted ability owned by the character. It rides the
  existing arm-then-target hotbar pattern: arm Flick the Lighter, click a
  flammable target, and the ability's OWNER walks up and performs it, whoever
  in the party that is. That needs companion walk-up movement, which
  milestone 2 builds anyway; the ability lands in milestone 4/5. Until then
  (v1): talents apply only to their owner's own stepping/combat, and the
  right-click ignite menu stays leader-gated. The menu option survives as a
  shortcut that dispatches the same ability. (Alternative considered: demote
  the lighter to a carried item in shared pockets, making "can the party
  ignite this?" an inventory query — cheaper, but it hollows out the Smoker's
  "a lighter, always" identity. Rejected.) Purely passive talents
  (slipImmune, shockImmune) never had this problem — they already apply
  per-owner.
