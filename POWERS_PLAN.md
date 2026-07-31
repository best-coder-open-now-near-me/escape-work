# Powers Plan (The Verb Vocabulary, Class Identity & Toppling)

Six playable classes, and five of them are the same character. Every kit in
`data/classes.js` is `attack + defend + heal` with different words on the
buttons — only Human Resources departs from it, and only because `summon`
happened to get built for it. This is not a content problem that more entries
would fix: the combat runner understands exactly **five action types**
(`attack`, `defend`, `heal`, `shove`, `summon`), so a class can only be
assembled from three verbs. You cannot spread powers across verbs the engine
does not have.

This plan grows the verb vocabulary, gives each class one thing it is *for*,
and adds the physical-interaction verb the shove has been implying since it
landed: **tall things fall on people, and stay down as cover.**

This document is the implementation plan: design decisions, module-by-module
changes, milestone order. No code yet. It follows the shape of
`STATUS_PLAN.md` and `TACTICS_PLAN.md`, and honors the `ARCHITECTURE.md` rule:
**content is data, code is systems.** The whole point is to spend systems
budget *once* on the verbs, so that afterwards a new power is a
`data/actions.js` entry again.

**Sequencing note:** this plan depends on `STATUS_PLAN.md` having landed (it
has). `applyStatus`/`statusFx`/`clearStatuses` are the substrate for the
`buff` and `control` verbs below — without them each new power would be
bespoke plumbing, which is the exact hole statuses were built to close.

## Where we are today

- **Six classes, one shape.** The kits, as shipped:

  | Class | Slot 1 | Slot 2 | Slot 3 |
  |---|---|---|---|
  | Office Drone | `attack` | `defend` | `heal` |
  | Middle Manager | `attack` | `defend` | `heal` |
  | Mail Room | `attack` (cone) | `defend` | `heal` |
  | IT Support | `attack` (purge) | `defend` | `heal` |
  | Security | `attack` | `defend` | `heal` |
  | Human Resources | **`summon`** | `defend` | `heal` |

  Every class heals itself for a rationed number of uses per fight. Every
  class halves one incoming hit. Five of six open with a damage roll. The
  taglines promise six jobs; the action bar delivers one.

- **The verb vocabulary is the ceiling.** `combat.js` dispatches on
  `a.type` in a handful of places (`performOn`, `handleGroundClick`,
  `armAction`, the preview ring code) and knows `attack`, `defend`, `heal`,
  `shove`, `summon`. Everything that makes an action feel different today is a
  *modifier bolted onto `attack`*: `purge`, `cone`, `footwork`, `ammoCost`,
  `needsTalent`, `leaves`. That list is the tell — six modifiers on one verb
  is a vocabulary asking to be split.

- **The ability tracks are duplicated too.** `grantsAction` is the mechanism
  for a class learning something new, and it is spent almost entirely on the
  same two things: Office Drone, Mail Room and Security each grant **`kick`**;
  IT Support grants **`cigarette`**, which is the Middle Manager's talent
  action. Human Resources grants no action at all. Four of six classes unlock
  an ability another class already has, so levelling up converges the roster
  instead of separating it.

- **Statuses exist and nothing player-facing applies them.** `statuses.js` is
  a complete runtime — severity, resist, the Shadowbane anti-chain immunity
  window, a merged `statusFx` view — and the only things that reach it are
  enemy attacks, surfaces, and the shove's wall-slam stun. **No player action
  applies a status to an enemy on purpose, and nothing in the game applies one
  to a friend at all.** The most expensive system in the codebase is being
  driven by the environment.

- **The good news.** Every hook the new verbs need is already built and
  load-bearing: `applyStatus(target, id, opts, resist)` handles resist,
  immunity and severity; `statusFx` is the one merged read; `tactics.js` owns
  cover and the reaction budget (`REACTIONS_PER_ROUND: 1`, currently spent
  only on opportunity attacks); `grid.setType` already mutates the world at
  runtime for exploding printers; and `pushTo` already glides a body without
  provoking. This plan is mostly *routing*, not invention.

## What we're building

- **Five new action types**, each unlocking a role the roster cannot express:
  `buff`, `control`, `zone`, `mobility`, `stance`.
- **One identity per class** — a re-cut of all six kits so that what a class
  *does* differs, not just what its buttons are called.
- **`grantsAction` stops converging the roster**: every track node grants a
  class-unique ability instead of a third copy of `kick`.
- **Toppling**: tall freestanding props can be knocked over by a shove, a
  kick, or an explosion — dealing damage to whatever is behind them, and
  leaving a **fallen prop that acts as cover**. The physical verb that makes
  the office a place you fight *with*, not just in.
- **The verbs the enemy AI can use too**, so control and toppling are things
  that happen *to* you, not just abilities you own.

## Design decisions (recommended, with alternatives considered)

| # | Decision | Choice | Why / alternatives |
|---|----------|--------|--------------------|
| 1 | Grow the type vocabulary, don't add modifiers | Five new `type`s, not five new flags on `attack` | `attack` already carries six modifiers, and each one forced a branch into `performOn`, the ring preview, and the hover readout. A type is dispatched once; a modifier is checked everywhere. The current design is the alternative, and it is what produced the sameness. |
| 2 | `buff` is its own verb, not `heal` with a status | `type: 'buff'`, targets an **ally** (or self), applies a status; may also heal | Overloading `heal` would mean every heal site checks for a status rider, and the targeting is genuinely different — `heal` today is self-only and instant, a buff needs friendly target picking. This is the single biggest gap: nothing in a *party* game currently makes your teammates better. |
| 3 | `control` deals no damage | A control action applies a status and/or displaces; damage is `attack`'s job | Keeps the balance surface honest — a power that stuns *and* hits is two powers, and the AP economy (2 AP, ~3 beats a turn) cannot price both. DOS2 splits the same way. It also means `control` can skip the damage roll entirely and read as a clean "did it land?". |
| 4 | Control still rolls to hit | `control` goes through `resolveHit` like any attack | A guaranteed stun at 2 AP is the degenerate case, and `HIT_PLAN`'s rule is already "a miss spends the AP and does nothing else". Free CC would also make the anti-chain immunity window the only counterplay, which is a floor, not a defense. |
| 5 | Turn-denial keeps the anti-chain rule | Every new `skipTurn`-carrying status inherits `IMMUNITY_WINDOW_MULT` for free | It is enforced in `applyStatus`, not at call sites, so new control powers cannot reintroduce stun-lock. This is the payoff for having built it in the status layer instead of in the shove. |
| 6 | `zone` promotes `leaves` to a verb | `type: 'zone'` places a surface at an aimed point, no attack required | `leaves` exists but is welded to the cone attack, so the only way to put paper on the floor is to also swing at someone. Freeing it makes surface placement a *plan* rather than a side effect, and it feeds the fire/conduction simulation that is already the most Divinity-like thing we have. |
| 7 | `mobility` is a verb, not a movement discount | `type: 'mobility'` — dash, swap with an ally, pull an ally | Talents already discount movement (`freeMoveAp`, `moveCost`). A mobility *action* is different: it repositions in a way the AP economy cannot buy, and it gives the opportunity-attack system the counterplay it lacks (today only the Manager's `noProvoke` answers it, as a passive). |
| 8 | `stance` spends the reaction budget | `type: 'stance'` sets a persistent posture that consumes the unit's reaction to interrupt | `REACTIONS_PER_ROUND` is built, refilled every round by the turn engine, and spent by exactly one thing. Overwatch is nearly free given that plumbing, and it is the one power shape that makes *not moving* a decision. |
| 9 | Toppling is a tile property, not a new entity | `topple: {...}` on a `TILE_TYPES` entry; the runtime mutates the grid via `setType` | Props are already tiles, already destructible (printers), already re-rendered on mutation. An entity layer for furniture would be a parallel implementation of the grid, and the explosion path proves the tile route works. |
| 10 | A fallen prop is a **runtime-only tile type** | New `runtimeOnly: true` flag; such tiles are exempt from the char-uniqueness lint and hidden from the editor palette | **This is forced by a hard constraint**: `data/tiles.js` documents that 92 of 94 printable characters are spoken for, and `tests/unit/levels.test.js:192` lints every tile for a unique one. A `-fallen` twin per toppleable prop would need six chars that do not exist. `runtimeOnly` costs zero chars because nobody paints these — they only ever arrive through `setType`. It also opens the door for future rubble/scorch tiles under the same rule. |
| 11 | Fallen props are cover, not walls | `solid: false`, knee height, a `debris` **surface** for the clamber cost, and cover via a new cell predicate in `tactics.js` | "Barrier" in a tactics game should mean *changes the maths*, not *blocks the lane* — a hard wall you can spawn would break pathing guarantees and let a player seal a doorway. Cover is already understood by the to-hit readout, so a toppled cabinet is legible the moment it lands. Note this makes it **ranged-only** cover (`tactics.js:241`), which is a feature: melee can walk around it. |
| 12 | Toppling direction is away from the attacker | The prop falls into the tile opposite the shove vector | Matches the shove's existing "into something solid" intuition, makes positioning the skill (line up the bookcase and the target), and needs no new input. Aimed toppling ("drop it *there*") was considered and rejected as a second targeting mode for one verb. |
| 13 | Enemies get the new verbs | AI units may carry `control`, `zone`, `stance` actions and may topple | A verb only the player owns is a power fantasy, not a system. The Manager already flicks gum; control on the enemy side is the same idea with the framework behind it. `buff`/`mobility` for AI is deferred to keep the AI diff small (see risks). |
| 14 | No new attribute | The new verbs derive from the existing four | Grit/Hustle/Savvy/Composure already cover the space (control lands on Savvy, buffs on Composure, mobility on Hustle). A fifth attribute would re-tune every class, every enemy, and `recomputeDerived`, for no expressive gain. |

## The data: the new type vocabulary

```js
// data/actions.js — the types the combat runner understands, after this plan.
//
// EXISTING
//   attack   - rolls min..max (+ damageBonus), needs reach or range + LOS
//   defend   - halves the next incoming hit until your next turn
//   heal     - restores `amount` HP to yourself, `uses` per fight
//   shove    - displaces an adjacent body one tile
//   summon   - conjures `count` allies of `archetype` on your side
//
// NEW
//   buff     - target an ALLY (or yourself): apply `applies` (a status id),
//              optionally `amount` HP. Needs `range` + LOS; `uses` per fight.
//              The friendly-target twin of an attack.
//   control  - target an ENEMY: apply `applies`, and/or `displace` them.
//              NO damage roll - control is not a swing. Rolls to hit.
//   zone     - aim at a POINT: paint `leaves` (a tile type carrying a surface)
//              over `radius` tiles of plain floor. No target needed.
//   mobility - move yourself: `dash` (extra distance this turn, no provoke),
//              `swap` (trade places with an ally), or `pull` (draw an ally
//              to an adjacent free tile). Never provokes.
//   stance   - a persistent posture held until your next turn. `watch`
//              spends your REACTION to strike the first enemy who moves
//              within `radius`; `guard` extends cover to adjacent allies.
```

Modifiers stay as they are (`purge`, `cone`, `footwork`, `ammoCost`,
`needsTalent`, `uses`, `leaves`), with two changes: `leaves` is now read by
`zone` as well as by a cone attack, and **`purge` becomes legal on `buff`** —
which is what finally lets IT Support reboot a *teammate* instead of only an
enemy or themselves.

### The re-cut kits

Each class gets a **primary verb it owns** and keeps enough of the old shape
to stay recognisable. The rule: no two classes share a primary.

| Class | Primary verb | Kit | What it is now for |
|---|---|---|---|
| **Office Drone** | `attack` (generalist) | `attack`, `defend`, `coffee` | Unchanged, deliberately. Something must be the baseline the others read against. |
| **Middle Manager** | `control` | `delegate`*, `own-calendar`, `espresso` | Removes enemy turns. `delegate` becomes a real control: the target's next turn is spent on the Manager's errand. Meetings root. |
| **Mail Room** | `mobility` | `mail-cone`, `courier-route`*, `snack-cart` | Crosses the floor. Dash without provoking, swap with a pinned ally, deliver a hazard at range. |
| **IT Support** | `purge` | `reboot`, `energy-drink` | Anti-status specialist. `reboot` is ONE verb pointed at the whole board - a coworker, a colleague, or yourself - and deals no damage. It shipped as two actions (`reboot` + `remote-restart`) only because targeting was a boolean; `aimsAtAnyone` retired the duplicate. |
| **Human Resources** | `buff` (empower) | `summon-applicants`, `performance-review`*, `coffee` | Makes the party better. Already summons; now also buffs — the support class that supports. |
| **Security** | `stance` | `detain`*, `stand-post`*, `night-thermos` | Locks the floor down. `detain` becomes a root (`control`), `stand-post` becomes real overwatch that spends the reaction. |

`*` = changes type or is new.

Note what this does to `defend`: only the Drone still carries a plain one.
Firewall, Return to Sender, Own Calendar and Stand Post were four copies of
`type: 'defend'` with different flavour text — three of them become the
class's actual identity, and the fourth stays as the baseline. **This is the
copy-that-drifted problem in its purest form**: four entries, one behaviour,
six classes that felt identical because of it.

### Track nodes stop granting `kick`

Every `grantsAction` node grants something only that class can have. `kick`
stays as the talent-granted action it already is for IT and as a shared
fallback, but it leaves the tracks:

| Class | Node grants (was → is) |
|---|---|
| Office Drone | `kick` → `paper-storm` (a `zone`: carpet your own tile's surroundings in paper) |
| Mail Room | `kick` → `courier-swap` (a `mobility`: trade places with any ally in line of sight) |
| Security | `kick` → `lockdown` (a `stance`: allies adjacent to you gain cover) |
| IT Support | `cigarette` → `percussive-maintenance` (a `control`: daze a target — `stunned`, and so anti-chain limited) |
| Middle Manager | *(talents only)* → `all-hands` (a `control`: root every enemy in a cone) |
| Human Resources | *(nothing)* → `onboarding` (a `buff`: temporary HP to an ally) |

## Toppling: the office falls on people

The shove already says "you shove them into something solid" and stuns them.
Toppling is the other half of that sentence: **the something solid comes down
too.**

### The data

```js
// data/tiles.js - a toppleable prop declares how it goes over. `cabinet` is
// the existing entry (char 'B', height 0.5, model 'furniture/cabinet'); only
// the `topple` block is new.
cabinet: {
  char: 'B', solid: true, height: 0.5, model: 'furniture/cabinet',
  scale: 0.5, label: 'Filing Cabinet',
  topple: {
    damage: [3, 6],       // rolled against whoever is in the landing tile
    applies: 'stunned',   // the EXISTING status the shove's wall-slam uses
    becomes: 'cabinet-fallen',  // a runtimeOnly tile (below)
  },
},
// The fallen twin: never painted, never exported, costs no character.
'cabinet-fallen': {
  runtimeOnly: true,     // exempt from the char lint + hidden in the editor
  solid: false,
  height: 0.3,           // knee height: it spoils a shot, it isn't a wall
  cover: true,           // read by tactics.js (see the cover note below)
  surface: 'debris',     // clambering cost + pathfinding avoidance, for free
  model: 'furniture/cabinet',
  scale: 0.5,
  modelRot: [0, 0, 90],  // on its side
  label: 'Toppled Filing Cabinet',
  examine: 'Eleven years of performance reviews, face down on the carpet.',
},
```

```js
// data/surfaces.js - one new entry, and the fallen twins all point at it.
debris: {
  slow: 0.6,        // clambering over costs roughly what coffee does
  pathCost: 2,      // characters route around it unless it's worth crossing
  style: 'debris',  // tile-renderer.js
  color: [0.42, 0.36, 0.30],
  examine: 'Somebody is going to have to file an incident report about this.',
},
```

**Movement cost is the surface layer's job, not the tile's** — `TILE_TYPES`
has no `moveCost` field, and inventing one would be a second implementation of
something `slow`/`pathCost` already do (and that pathfinding, the AI's route
costing and the walk-speed math already consult). Pointing the fallen twin at
a surface gets all of that for nothing.

Toppleable at launch — tall, freestanding, and already registered in
`data/tiles.js`: `cabinet`, `bookcase` / `bookcase-wide`, `coat-rack`, and
`snack-machine`. Desks and tables deliberately do **not** topple: they are the
cover you already have, and making the most-painted prop in the game mutable
would rewrite every floor's tactical read on contact.

### The rules

1. **What topples it.** A `shove` aimed at the prop; a `control` carrying
   `displace`; an explosion in an adjacent tile (the printer path already
   calls `setType`); and a body shoved *into* it — the wall-slam case now
   checks whether the "something solid" is toppleable.
2. **Where it goes.** Into the tile directly opposite the attacker. If that
   tile is blocked by terrain, the prop just rocks and stays up (no free
   destruction against a wall).
3. **What it hits.** Any character in the landing tile takes `damage` and the
   `stunned` status. Enemies *and* party members — a bookcase does not check
   your badge. **Reusing `stunned` rather than inventing a `knocked-down`** is
   deliberate: it is already what the shove's wall-slam applies
   (`combat.js:1284`), so toppling inherits the anti-chain immunity window for
   free and cannot become a second, parallel way to lock someone out of a
   fight. A player who slams a guard into drywall and then drops a cabinet on
   them gets the same "they've had their daze" refusal, from the same code.
4. **What it leaves.** The origin tile becomes `floor`; the landing tile
   becomes the `becomes` twin: chest-high cover, extra move cost, not solid,
   does not block sight. Fires, water and conduction pools flow across it per
   the existing surface rules — a `flammable: true` prop that falls into a
   burning tile is exactly the chain reaction the fire runtime was built for.
5. **The AI uses it.** `pickTarget` gains one cheap consideration: if a
   toppleable prop sits between the unit and a party member, shoving it is
   scored like an attack. This is what keeps toppling from being a trick the
   player does *to* a static world.

### Why cover and not a wall

> **Superseded in part (TACTICS_PLAN M6, designer 2026-07-30).** The chunky
> fallen twins are SOLID now — "an object on its side, not a walkable mess" —
> because the M6a sight rule dissolved this section's stalemate argument: a
> low solid no longer blocks sight, so a sealed pocket can still be thrown
> at and a fight can still resolve. The flat twins (coat rack, partition
> panel) keep the walkable shape below. The reasoning below stands as the
> record of why the walkable rule was right for the world it shipped into.

A player who can spawn impassable terrain can seal a doorway and break every
guarantee pathfinding makes (including the enemy's ability to reach them at
all, which turns a fight into a stalemate the game cannot resolve). Cover
changes the to-hit maths, is already surfaced in the hover readout, and is
legible the instant it lands. The barrier you want is a *tactical* barrier.

**But cover today is EDGE-based, and a fallen prop is a CELL.** `hasCover(ax,
az, dx, dz, edgeOpen)` (`tactics.js:168`) asks whether a solid *edge* sits on
the face of the defender's tile pointing at the attacker — combat threads
`world.stepOpen` in. A toppled cabinet occupies a cell, so it grants nothing
under the current signature. Two ways to close that, and the tempting one is
wrong:

- **Rejected:** make the fallen twin `solid: true` so `stepOpen` reports it and
  cover works untouched. That is the wall we just refused, arrived at
  sideways.
- **Chosen:** add an optional `coverCell(x, z)` predicate alongside
  `edgeOpen`, checked on the same one-or-two neighbouring cells the existing
  code already walks. It is a signature change to a pure, unit-tested function
  — the smallest honest version of the feature, and it keeps the "at most once
  per attack" boolean rule intact (an edge and a cell on the same face still
  grant one cover, not two).

**And cover is deliberately RANGED-only** (`const covered = !melee &&
hasCover(...)`, `tactics.js:241`). So a toppled prop spoils *shots*, not
swings. That is worth keeping rather than special-casing: it makes toppling a
specific counter to throwers and to the ranged AI, while a melee attacker can
still walk around it — which is exactly the honest reading of a cabinet lying
on the carpet, and it stops "topple everything" from being a universal answer.

## Architecture: where it lands

- **`data/actions.js`** — the five new types documented in the header comment
  (that header is the spec other people read); the re-cut kits' new entries.
  Content only.
- **`data/classes.js`** — six kits re-pointed, six track nodes re-granted.
  Content only.
- **`data/tiles.js`** — `topple` descriptors and the `runtimeOnly` fallen
  twins. Content only.
- **`data/surfaces.js`** — one `debris` entry the fallen twins point at.
  Content only.
- **`src/powers.js`** (NEW, pure) — the verb rules that do not need the world:
  what a `control` applies given a hit and a resist, what a `mobility` costs
  and where it may land, whether a `stance` may fire its reaction this round,
  and the topple resolution (given an attacker tile, a prop tile and a grid
  interface, return the landing tile + what happens there). **Takes a host,
  not the world** — the `turn-order.js` pattern — so all of it is unit
  testable with plain objects.
- **`src/combat.js`** — dispatch the five new types in `performOn` /
  `handleGroundClick` / `armAction`; extend the ring preview to friendly
  targets (`buff`, `mobility` swap) and to aimed points (`zone`); spend the
  reaction budget for `stance`. This is the bulk of the engine diff, and it is
  routing, not new rules.
- **`src/tactics.js`** — `hasCover` gains an optional `coverCell(x, z)`
  predicate beside `edgeOpen`, so a cell carrying `cover: true` counts the way
  a solid edge does. Signature change to a pure function with existing tests;
  `combat.js` threads the predicate the same way it already threads
  `world.stepOpen`.
- **`src/grid.js`** — `setType` already exists; add the `runtimeOnly`
  awareness so the editor's export never emits one, and so a level that
  somehow contains one fails the lint loudly rather than silently.
- **`src/tile-renderer.js`** — honor `modelRot` so a fallen prop lies down,
  and draw the `debris` surface style.
- **`src/fx.js`** — one new impact kind (`topple`: dust + a heavy thud
  shake via `vfx.shake`). Data entry in `IMPACTS`.
- **`src/ui/hud.js`** — the hotbar and combat bar need to show friendly-target
  and point-target actions differently from attacks. The panel stays a dumb
  view: it receives the target *mode* from combat, it does not infer it.
- **`tests/unit/levels.test.js`** — the char-uniqueness lint skips
  `runtimeOnly` tiles, and gains a new assertion that a `topple.becomes` names
  a tile that exists.

Everything else — statuses, the anti-chain window, resist, severity, cover,
the reaction budget, `setType`, `pushTo` — is consumed as-is.

## Status: all eight milestones shipped

Where the implementation departed from this document, and why:

- **Both stance modes landed** — `watch` in M5, `guard` in M7. `guard` was
  deferred out of M5 because it looked like it needed a third mechanism; it
  did not. Once cover became a CELL question ("does the thing standing here
  shield the defender?"), a teammate holding the line answers it exactly as a
  fallen cabinet does, so it joined the same predicate.
- **`control` ships `applies` and `displace`**, as planned — and the shove's
  displacement was lifted into a shared `displaceBody` to make that possible
  without a second copy of the occupancy check, wall-slam and surface damage.
- **Two `defend` entries survive** (Deflect Blame, Decline the Invite), not
  one. Three of the five became class identities and `firewall` was deleted
  outright; these two stay because the Manager's primary is rationed and
  because the problem was never a duplicated data row — it was five classes
  with no other idea. See the note in `data/actions.js`.
- **`primary` is now a real field** on every playable class, linted unique and
  linted to appear in the kit. The six are: attack (Drone), control (Manager),
  mobility (Mail Room), **purge** (IT), summon (HR), stance (Security). This
  line read "buff (IT)" until M9's audit; `purge` became its own type rather
  than an `attack` carrying a flag, and IT's primary went with it.
- **Not shipped**: explosions as a topple trigger, and non-shove attacks
  toppling props. Both need a topple path reachable outside combat (or an
  attack that can target a tile), which is a larger change than the verb work
  and did not block anything else. The shove path — direct, and via a body
  slammed into a prop — covers the case the feature was asked for.
- **New debug surface**, used by the specs and documented with the rest:
  `__combat.actingAt`, `__combat.watching`, `__combat.applyStatus(..., targetName)`,
  `__game.walkable`, `__game.debugPlaceEnemy`.

## M9: the heal audit and the summoner swap

M8 audited primaries and found six distinct ones. It did not audit the rest of
the kit, and underneath the primaries every class still carries the same third
button.

### The finding

> "so yeah theyre all pretty cookie cutter, all have a heal for one, doesnt
> seem to be much uniqueness to them. im not sure i even want more than a class
> or 2 that can [heal]" — designer, 2026-07-31 `[stated]`

| Class | Heal | Amount | Uses | Per fight |
|---|---|---|---|---|
| Office Drone | Coffee Break | 6 | 3 | 18 |
| Middle Manager | Executive Espresso | 8 | 2 | 16 |
| Mail Room | Snack Cart Raid | 5 | 3 | 15 |
| IT Support | Energy Drink | 4 | 4 | 16 |
| Security | Night Thermos | 5 | 3 | 15 |
| Human Resources | Coffee Break | 6 | 3 | 18 |
| *(Manager, talent)* | *Smoke Break* | *3* | *2* | *+6* |

Six classes, six drinkable objects, all 2 AP, all self-only, all instant, none
of them touching another system. **This is the `defend` problem exactly**, one
layer down: the header comment in `data/actions.js` already tells the story of
five `type: 'defend'` entries being cut to two, and the same pass was never run
on `heal`. It is arguably worse here — `defend` at least carried a decision
("is the next hit worth pre-paying for?"), whereas a heal on a rationed counter
is a button you press when the number is low.

The near-identical totals (15–18) are the tell. This is not a tuning axis the
classes differ along; it is a ritual every kit performs.

### Decisions

| # | Decision | Status | Notes |
|---|----------|--------|-------|
| 15 | Healing is not a universal class power | `[stated]` | "im not sure i even want more than a class or 2 that can" (designer, 2026-07-31). |
| 16 | HR becomes the class healing belongs to | `[ratified]` | "hr only healer for now" (designer, 2026-07-31). Follows from 17: with `summon` gone, HR's remaining kit is already two `type: 'buff'` entries. It is mechanically the support class today and has been since M1; the `summon` tag was the outlier, not the buffs. |
| 17 | The Middle Manager becomes the summoner | `[ratified]` | "yeah manager as summoner works" (designer, 2026-07-31), answering a proposal that HR was overloaded carrying both. |
| 18 | HR is the **only** healer — every other class loses its heal | `[ratified]` | "hr only healer for now" (designer, 2026-07-31), overruling a proposal that IT keep one on the strength of its 17 max HP. Note the **"for now"**: this is the sharp version, taken deliberately to see how it plays. If a second healer comes back, IT is where the argument was. |
| 19 | HR's heal may target anyone on your side, including HR | `[ratified]` | "hr heal is for anyone" (designer, 2026-07-31), overruling a proposed others-only restriction. Ships as a `buff` with `amount`, which the verb already supports (`buffOutcome` computes `healed`, and `data/actions.js` already documents buff as "at an ALLY ... or at yourself"), so this costs no new plumbing — it is strictly *less* work than the restriction was. |
| 21 | The Manager stops being *about* control | `[ratified]` | "manager stops being about control" (designer, 2026-07-31). He keeps `delegate` as flavour and moves to `primary: 'summon'`. Control was the most crowded verb in the game — Security carries `detain` + `lockdown`, IT carries `percussive-maintenance` + `remote-session` — so it loses a headline, not a home. See risk 11 for what this does to the lint's reading. |
| 20 | The Manager's Smoker talent stops granting a heal | `[proposed]` | `cigarette` is a seventh heal hiding in a talent, and 18 leaves it as the only heal outside HR — which is the ritual surviving in the one place the class lint would not look. The talent's genuinely unique half is `hasLighter: true`, which currently has no action attached to it — see below. |

### Why the Manager, and not Security or IT

The Manager's existing verb is literally `delegate`: "make it someone else's
problem." The class fantasy is a man who does no work because other people do
work for him. Control and summon are not two identities here — they are the
same one, pointed in two directions: **he spends other people's turns.**
`delegate` takes a turn away from an enemy; a summon adds turns to your side.

He also has the room. His third slot is `own-calendar`, one of the two
surviving `defend` entries and the least interesting thing in his kit.

Considered and not taken:
- **Security ("call for backup")** — cleanest metaphor, worst fit. It would
  make the tankiest class also the one that outnumbers you, and it fights the
  stance identity: overwatch and hold-the-line are about *one body holding a
  lane*, and adding bodies dilutes exactly what makes him good.
- **IT Support (automation, not people)** — the most mechanically *distinct*
  summon available: not applicants but immobile things, a script or a bot that
  holds a lane and ticks. `remote-session` is already "borrow somebody's body,"
  which is summon-adjacent. Rejected for now because IT is already carrying a
  purge and two controls, and because the 17 HP class is the one least able to
  protect what it summons. **Worth revisiting** if the Manager's temps end up
  feeling like reskinned applicants — a turret is a different power, and this
  is where it would live.

### The re-cut kits

Changes only; the Drone, the Mail Room and Security keep their primaries.

| Class | Primary | Kit after M9 | Change |
|---|---|---|---|
| **Office Drone** | `attack` | `attack`, `defend`, **—** | Loses `coffee`. Still the baseline, now a baseline with two buttons; a third wants finding (see risks). |
| **Middle Manager** | **`summon`** | `delegate`, **`escalate`**, **—** | Loses `own-calendar` and `espresso`. Gains a summon. Keeps `delegate` as flavour, not as identity — decision 21. |
| **Mail Room** | `mobility` | `mail-cone`, `courier-route`, **—** | Loses `snack-cart`. |
| **IT Support** | `purge` | `reboot`, **—** | Loses `energy-drink`. Still has `kick` from the ESD Steel-Toes talent and the two richest track grants in the game (`percussive-maintenance`, `remote-session`) — see risk 10. |
| **Human Resources** | **`heal`**† | `performance-review`, `onboarding`, **`triage`** | Loses `summon-applicants` and `coffee`. Gains the game's only heal, aimed at anyone on your side including itself. |
| **Security** | `stance` | `detain`, `stand-post`, **—** | Loses `night-thermos`. |

† The primary's *name* is open — `heal` describes the verb but reads thin for a
class whose whole kit points at other people. `support` or `mend` may be the
better label. `[proposed]`; it is a string in one lint and costs nothing to
change later.

New entries this milestone wants:

- **`escalate`** (Manager, `summon`) — post the work upward and a direct report
  arrives to do it. Reuses the `applicant` archetype at first; a
  `direct-report` archetype that arrives already rooted (holds ground, does not
  chase — which is what a direct report does) is the obvious follow-up and a
  pure `data/classes.js` addition under the shared-archetype rule.
- **`triage`** (HR, `buff` with `amount`) — the only heal in the game, aimed at
  anyone on your side, HR included. Numbers deliberately unset here: with five
  classes living on consumables it is the single dial the whole HP economy
  turns on, and that is a play question, not a spreadsheet one. Starting point:
  bigger than the drinks it replaces (they were 4–8) and rationed harder, so it
  reads as *treatment* rather than as a round of coffees.
- **A replacement for `cigarette`** (Manager talent) — the Smoker talent's
  `hasLighter: true` is the interesting half and has no button. An action that
  *ignites* a flammable surface at range would hand the fire runtime a second
  player-driven input alongside `paper-storm`, and it is a `zone`-shaped verb
  that already exists.

### What carries the HP economy afterwards

Five classes with no heal at all is the point, not an oversight: HP stops being
a per-fight resource that resets and becomes a **floor-level** one.

The obvious follow-on question — "can the item economy carry that?" — is
answered `[stated]`, and answered by *not needing an answer yet*:

> "the game is laughably easy right now so no concern there"
> — designer, 2026-07-31

So M9 does **not** ship a compensating loot-table pass. Removing ~16 HP a fight
from five of six classes is a difficulty change made on purpose, into a game
with difficulty headroom to spend. `data/items.js` consumables and `shops.js`
stock remain the lever if it overshoots; they are deliberately not pulled
pre-emptively, because tuning a supply against a shortage nobody has felt yet
is how you end up back where you started with more moving parts.

The party consequence is the good half of the same coin: **"we have no HR"
becomes a genuine tactical state**, which gives `PARTY_PLAN`'s recruitment
decisions weight they do not currently have. Worth watching that it does not
tip into *mandatory* — a support class you must recruit is a tax, not a choice
— and the tell will be whether a no-HR party can still clear a floor.

### Testing

- **Unit (`tests/unit/levels.test.js`)** — extend the primary lint: assert that
  at most **one** playable class carries an action of `type: 'heal'` (or a
  `buff` with `amount`), so the ritual cannot creep back one PR at a time. This
  is the guard that makes M9 stick; without it, the next class added gets a
  drink because every other class has one. The number is decision 18's "for
  now" written down where a change to it has to be deliberate — raising the
  lint to two is how a second healer gets ratified, not a thing that happens
  by accident in a class PR.
- **Unit (`tests/unit/powers.test.js`)** — `buffOutcome` already computes
  `healed` against `maxHp`; pin that an ally-targeted `triage` refuses a
  full-health target through `emptyPayload` rather than spending the use.
- **E2E (`tests/e2e/classes.spec.js`)** — the Manager's bar shows a summon and
  no heal; HR's heal lands on a *teammate's* HP bar when aimed at one, and on
  its own when aimed at itself.
- **Manual** — floor one as IT Support with no HR in the party, at level 1 and
  again with the track bought out. The frailest body with nothing to top it up
  is where decision 18's "for now" gets tested, and playing it at both ends of
  the growth curve is what separates "this class is under-powered" from "floor
  one is short of class points" — which have different fixes. If it is
  miserable, the answer is the item economy, `PROGRESSION_PLAN`'s point pacing,
  or a second healer, in that order. Not the energy drink back.

### Risks

9. ~~**This is a nerf to five of six classes and the loot tables must absorb
   it.**~~ **Closed** — "the game is laughably easy right now so no concern
   there" (designer, 2026-07-31). The difficulty swing is the intent, not the
   hazard. Left in the record because it is the risk this milestone *looks*
   like it has, and the next reader will re-derive it otherwise.
10. **A level-1 kit is two powers wide.** Not a roster problem — count the
    whole growth path and M9 leaves the classes level:

    | Class | Level 1 | Track grants | Grown |
    |---|---|---|---|
    | Office Drone | `attack`, `defend` | `paper-storm` | 3 |
    | Middle Manager | `delegate`, `escalate` | `all-hands` | 3 |
    | Mail Room | `mail-cone`, `courier-route` | `courier-swap` | 3 |
    | IT Support | `reboot`, `kick` (talent) | `percussive-maintenance`, `remote-session` | 4 |
    | Human Resources | `performance-review`, `triage` | `onboarding` | 3 |
    | Security | `detain`, `stand-post` | `hold-the-line`, `lockdown` | 4 |

    Plus the universal bar everyone always has (the weapon swing, `shove`,
    `take-cover`, the paper throws). 3/3/3/3/4/4 grown is as even as the
    roster has been, and IT — the class this risk previously called thinnest —
    has the *most* track actions in the game.

    So the residue is a **pacing** note about floor one, not a class-design
    one: every kit is two wide before any class points are spent, where it used
    to be three. "Your kit fills out as you level" is what a progression system
    is for, and `PROGRESSION_PLAN` owns when the first point lands. The only
    thing worth watching is the Office Drone, whose two are `attack` +
    `defend` — the two most generic verbs in the game, and `defend` is the one
    this plan calls the least interesting survivor of the M8 sweep. A baseline
    class should be plain on purpose; it should not be the one kit made
    entirely of the leftovers. If that reads badly on floor one the answer is
    to make the Drone's *track* land earlier or hit harder, not to give the
    coffee back.
11. **`primary: 'control'` ends up owned by nobody** (decision 21). The lint
    checks uniqueness, not coverage, so nothing breaks — but "one verb per
    class" quietly becomes "one verb per class, and one spare." Worth deciding
    whether coverage was ever the goal, or whether the lint was only ever
    guarding against two classes being *about* the same thing.
12. **`espresso`, `snack-cart`, `night-thermos`, `energy-drink` and `coffee`
    become orphans.** Do not delete them: they are exactly the shape
    `data/items.js` consumables want, and moving a heal from a class action to
    a lootable object is the substance of this milestone rather than a side
    effect of it. (`energy-drink` is the fiddly one — there is *already* an
    item by that id in `data/items.js`, and `data/actions.js` documents the
    collision as deliberate and harmless because the two registries never share
    a lookup. Retiring the action means checking that the survivor is the item.)

## Milestones (each a PR that keeps `npm test` + e2e green)

1. **`buff`, and the first friendly target.** The verb, friendly target
   picking, the ring preview, and the any-target `reboot` for IT Support. The
   smallest new verb that proves the targeting seam, and it immediately fixes
   the "nothing makes your teammates better" hole. Ships with
   `onboarding` for HR so the verb has two consumers from day one.
2. **`control`, and the Manager and Security re-cut.** `delegate` and
   `detain` change type; `percussive-maintenance` and `all-hands` land on the
   tracks. Verifies the anti-chain window holds when the *player* is the one
   applying turn denial — the case it was written for and has never faced.
3. **`zone`, and `leaves` set free.** `paper-storm`; the Mail Room's cone
   keeps its own `leaves` unchanged. Proves surfaces can be placed as a plan,
   and hands the fire runtime a player-driven fuel source.
4. **`mobility`.** `courier-route` and `courier-swap`; the Mail Room becomes
   the class that crosses the floor. Interacts with opportunity attacks, so it
   ships with the tactics tests that pin "forced and granted movement never
   provokes".
5. **`stance` and the reaction budget's second customer.** `stand-post` as
   real overwatch, `lockdown` for cover. Highest risk of the five (it is the
   only verb that fires *between* turns), deliberately last of the verbs.
6. **Toppling, part 1: props go over.** `topple` descriptors, `runtimeOnly`
   tiles, the lint change, the renderer's `modelRot`, damage + knockdown in
   the landing tile. Player-triggered only (shove, kick, explosion).
7. **Toppling, part 2: cover and the AI.** Fallen props count as cover in
   `tactics.js`; the AI scores a topple like an attack. Split from M6 because
   an AI that topples before the cover maths is tuned is an AI that hurts you
   for reasons you cannot read.
8. **The kit sweep.** Retire the duplicate `defend` entries, audit every class
   for a unique primary, and lint that no two playable classes share one.
9. **The heal audit and the summoner swap.** M8's sweep audited primaries and
   stopped there; this one audits the rest of the kit. Summoning moves to the
   Middle Manager, and healing consolidates onto Human Resources as the only
   class that has any. Ships with the lint that keeps the third-button ritual
   from growing back. Full section above.

## Testing

- **Unit (`tests/unit/powers.test.js`, new)** — the topple geometry (landing
  tile given attacker/prop/grid, blocked-behind rocks in place), control
  application against the immunity window, mobility landing legality, and the
  stance's once-per-round reaction spend. All plain objects, no engine.
- **Unit (`tests/unit/levels.test.js`)** — `runtimeOnly` tiles are skipped by
  the char lint and *rejected* if they appear in a shipped level's map; every
  `topple.becomes` resolves; no two playable classes share a primary verb.
- **Unit (`tests/unit/statuses.test.js`)** — extend: a player-applied
  `skipTurn` control respects `IMMUNITY_WINDOW_MULT` exactly as a shove does.
- **E2E (`tests/e2e/powers.spec.js`, new)** — arm a `buff` and click an ally
  (status lands on the *teammate*, not the caster); arm a `control` and
  confirm no damage popup; arm a `zone` and confirm the floor changed;
  overwatch fires once and only once in a round.
- **E2E (`tests/e2e/topple.spec.js`, new)** — shove a bookcase onto an enemy:
  damage lands, the enemy is knocked down, the origin tile is walkable, and a
  **ranged** attacker's `hoverHitChance` across the landing tile drops (cover
  is ranged-only, so a melee assertion here would correctly fail and read as a
  bug). Drive it through `__combat.forceHit = true` for determinism.
- **Manual** — the thing the tests cannot check: whether six classes now
  *feel* like six jobs. Play one floor as each.

## Risks and open questions

1. **`combat.js` is 2,277 lines and this adds five dispatch paths to it.**
   The mitigation is `src/powers.js` taking a host, the way `turn-order.js`
   was lifted out of the same file — the rules go in the pure module and
   combat keeps only what needs a panel or a body. If M1's diff to combat.js
   is not small, the seam is wrong; stop and re-cut it before M2.
2. **`stance` fires between turns.** It is the only verb that resolves outside
   its owner's turn, which is exactly where the opportunity-attack bugs lived
   (a reaction landing mid-player-turn, `combat.js:1796`). It is last for that
   reason, and it reuses the same reaction accounting rather than adding a
   second budget.
3. **Control could be strictly better than damage.** A stun that costs the
   same 2 AP as a swing and removes a whole enemy turn is worth far more than
   4-7 damage. Watch it in M2: if control dominates, the lever is `uses` (make
   it rationed) before it is duration, because the anti-chain window already
   handles the stacking case and duration is what makes CC *feel* like CC.
4. **Toppling could trivialise chokepoints** — a player who topples a bookcase
   into a doorway gets cover in the one tile every enemy must cross. That is
   arguably good tactics, but it needs a floor-shaped answer: level 2's open
   plan should not have a single-tile approach with a prop beside it. A lint
   for "toppleable prop adjacent to a one-tile choke" is possible if it bites.
5. **The AI topple heuristic runs in `pickTarget`, which runs per frame**
   (there is already a memoisation there for exactly this reason —
   `dd82f6c`). The topple consideration must ride that same memo or it will
   cost frames.
6. **`runtimeOnly` is a new class of tile and the editor must never see one.**
   The failure mode is silent: a fallen cabinet gets exported into a level
   JSON, and thereafter the level has a tile with no character. The lint
   assertion in M6 is the guard, and it should fail loudly on the *level*, not
   just on the registry.
7. **Deferred: `buff` and `mobility` for the AI.** Enemies get control, zones
   and stances; a healing, teleporting enemy is a much larger AI diff
   (target selection for friendlies, retreat logic) and belongs with the
   faction work `SUMMON_PLAN.md` gestures at.
8. **Open: does `buff` need friendly-fire discipline?** A `zone` aimed badly
   already burns your own party — that is the Divinity contract and it is
   good. But a *cone* control that roots your own teammates may just read as a
   bug. Recommend: control cones check allegiance, zones do not. Revisit if
   the asymmetry reads as inconsistent.
