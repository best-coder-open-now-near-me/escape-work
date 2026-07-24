# Status Effect Framework Plan

A real status system — "apply X for N turns and the engine does the rest" —
instead of four hand-coded conditions. Today the game has exactly `surprised`
(an enemy flag combat special-cases in `beginTurn`), `gum` (a step counter on
the sheet with read sites in four modules), `bleed` (another step counter),
and the Deflect stance (`m.defended`, a per-turn boolean). Each one is bespoke
plumbing; there is no way to add a stun, a burn-over-time, a blind, or a fear
without writing new engine code. DOS2 and BG3 lean on statuses as their main
tactical currency — this plan builds the registry and runtime they hang off,
the way surfaces already work (`data/surfaces.js` + `surfaces-runtime.js`).

This document is the implementation plan: design decisions, module-by-module
changes, milestone order. No code yet. It follows the shape of
`PROGRESSION_PLAN.md` and honors the `ARCHITECTURE.md` rule: **content is
data, code is systems.** After this lands, a new status is a
`data/statuses.js` entry plus an `applies` reference from whatever inflicts
it — no combat.js changes.

**Sequencing note (the three combat plans):** land `HIT_PLAN.md` first — its
`hitChance(..., mods)` term is where this plan's `accMod`/`dodgeMod` effects
plug in, and its "riders don't fire on a miss" rule is written expecting
generalized `applies`. `EQUIPMENT_PLAN.md`'s on-hit procs then hang off this
plan's `applyStatus`. Order: HIT → STATUS → EQUIPMENT.

## Where we are today

- **Four conditions, four implementations.**
  - `surprised`: a raw flag on enemy units; `combat.js beginTurn` burns the
    turn and clears it; `performOn`'s purge special-cases waking them.
  - `gum`: `sheet.gum` (steps remaining) for members, `unit.gummed` (a
    *permanent* boolean!) for AI units. Read sites: `combat.js` (`stepCost`,
    the `footwork` gate, `aiAdvance`), `main.js onMemberStep`/`onSummonStep`
    (tick + wear-off), the follower speed math (`main.js:1707`), `ui.js`
    status chips, plus `GUM` constants in `data/surfaces.js`.
  - `bleed`: `sheet.bleed` steps, ticked in the same two step handlers.
  - Deflect stance: `m.defended`, set by `type: 'defend'` actions, reset in
    `beginTurn`, consumed in `aiAttack`.
- **Application is ad hoc.** An enemy attack says `applies: 'gum'` (one
  hard-coded string in `aiAttack`); a surface says `onEnter.applies: 'gum'`
  (hard-coded in the step handlers); nothing the *player* does applies
  anything.
- **The good news:** the resist/immunity hooks already exist and generalize
  cleanly — `statusResist(sheet)` (Composure shortens durations),
  `paperCutImmune` (bleed immunity), and purge ("wipes status effects") is
  *specified* as generic but implemented as two hand-coded lines.
- **The registry pattern is proven.** Surfaces are exactly this shape: a data
  registry of effect descriptors + one runtime that interprets a small
  effect vocabulary. Statuses copy it.

## What we're building

- **`data/statuses.js`** — the registry. Each entry: identity (name, icon,
  log lines), polarity (`harmful`), a **clock** (`turn` or `step`), a default
  duration, and an `effects` object drawn from a small engine-understood
  vocabulary (the talent-effects pattern).
- **A pure runtime** (`src/statuses.js`, pure logic, unit-tested): apply /
  refresh / tick / expire / query / aggregate, working identically on a
  member's sheet and an AI unit.
- **Generalized application**: `applies` on enemy attacks, surfaces, *and
  player actions* becomes one shape resolved by one code path — including
  resist (Composure shortens), immunities (talent-declared), and the
  hit-roll gate (a miss applies nothing, per HIT_PLAN).
- **The existing four reimplemented on the framework** — the proof of
  generality, done zero-behavior-change style.
- **New content that only this framework makes possible**, shipped to prove
  the seams: a stun, burning-as-a-status, a blind. Fear/charm ("mandatory
  fun") is designed here but deferred — it needs AI-control hooks the others
  don't.
- **UI that reads the registry**: the HUD chips, the initiative strip, and
  the focus banner all render statuses generically (icon + name + remaining).

## Design decisions (recommended, with alternatives considered)

| # | Decision | Choice | Why / alternatives |
|---|----------|--------|--------------------|
| 1 | Two clocks, not one | A status declares `clock: 'turn'` (ticks at its owner's combat turn start) **or** `clock: 'step'` (ticks per tile walked, like gum/bleed today) | Gum and bleed are *step*-lived and persist outside combat — that's established feel and save shape. Turn-lived statuses (stun, burn, deflect) only make sense inside combat. Forcing one clock would either break gum/bleed or make stuns tick weirdly outside fights. |
| 2 | Combat-scoped turn statuses | Turn-clock statuses are **cleared when combat ends**; step-clock statuses persist and keep ticking on the map | There are no "turns" outside combat, so a lingering stun would be dead state. Matches today: deflect/surprised are combat-scoped, gum/bleed persist. One rule, no timers outside fights. |
| 3 | Storage shape | `target.statuses = { [id]: { left } }` — an id-keyed map on the sheet (members/summons) and on the unit (AI); **no stacking, re-apply refreshes to max(remaining, new)** | Map beats array: O(1) `hasStatus`, no duplicate-entry bugs, trivially serialized. Stacking (DOS2 burning stacks) adds real balance surface for little payoff at this scale — deferred, the shape doesn't preclude it. |
| 4 | Effects are a declarative vocabulary | `effects: { dot, skipTurn, moveCostMult, speedMult, noFootwork, slipProof, incomingMult, accMod, dodgeMod }` — read by the systems that care, aggregated by one helper | Exactly the talent-effects pattern (`talentFxOf`, the `slipImmune`/`shockImmune` whitelist) — proven here, and it's what makes a new status pure data. The alternative (per-status handler functions in the registry) turns data into code and breaks the one rule. |
| 5 | One aggregation read | `statusFx(target)` merges the effects of all live statuses (sums numeric mods, multiplies mults, ORs booleans) | Read sites consult one merged view, never individual statuses — so combat's `stepCost` doesn't care whether the slow came from gum or a future "chilled". Mirrors how `talentFxOf` is consumed. |
| 6 | The existing four migrate onto it | `surprised`, `deflecting`, `gum`, `bleed` become registry entries; the old fields (`sheet.gum`, `sheet.bleed`, `m.defended`, `en.surprised`) are removed, read sites move to `hasStatus`/`statusFx` | The framework is only real if the incumbents run on it (surfaces earned trust the same way). Keeping legacy fields as a parallel path would mean every future system checks two places forever. The read-site audit is the milestone-3 risk, deliberately isolated. |
| 7 | Resist & immunity | Duration reduced by `statusResist(sheet)` when the def is `resistable`; immunity via a talent effect `statusImmune: ['bleed', ...]` (and `paperCutImmune` folds into it) | Both hooks exist; this just routes them through `applyStatus` so every source (attack, surface, proc) gets them for free instead of each site remembering. AI units have no Composure — they resist nothing in v1 (today's behavior). |
| 8 | Purge generalizes | `purge` wipes the target's `statuses` map — harmful and helpful alike (its documented contract) | Today it hand-clears two things; after M2 it's one line that automatically covers every future status. The reboot finally does what it says. |
| 9 | Fear/charm deferred | `mandatory-fun` (charmed: acts on the wrong side) and fear (forced flee) are **designed but not shipped** in the core plan | Both need the AI driver to take orders from a status (retarget, forced movement) — a genuinely new hook into `pickTarget`/`aiAdvance` and, for charmed *members*, AI driving a player body. Everything else in this plan is read-site work. Ship the framework, then land these as their own milestone with the design below. |
| 10 | Apply-chance | None in v1 — application is deterministic once the hit lands | DOS2 gates CC behind armor, BG3 behind saves; we gate it behind the **hit roll** (HIT_PLAN) + duration resist. A second RNG layer on top of hit% would double the whiff feel-bad with two attributes' worth of tuning surface. Revisit only if stun spam proves degenerate. |

## The registry

```js
// data/statuses.js — content only. Engine-understood effect keys:
//   dot            damage at each tick (turn or step, per the clock)
//   skipTurn       the owner's combat turn is spent recovering
//   moveCostMult   combat move AP multiplier      (gum: GUM.moveCost)
//   speedMult      walk-speed multiplier           (gum: GUM.slow)
//   noFootwork     footwork actions disabled       (gum)
//   slipProof      cannot slip                     (gum's upside)
//   incomingMult   incoming damage multiplier      (deflecting: 0.5)
//   accMod/dodgeMod flat hit-chance mods (HIT_PLAN's `mods` term)
export const STATUSES = {
  // --- the incumbents, now data -------------------------------------------
  surprised: { name: 'Surprised', icon: '❗', harmful: true, clock: 'turn',
    duration: 1, resistable: false, effects: { skipTurn: true },
    log: '{name} is still grabbing their lanyard.' },
  deflecting: { name: 'Deflecting', icon: '🛡️', harmful: false, clock: 'turn',
    duration: 1, resistable: false, effects: { incomingMult: 0.5 } },
  gum: { name: 'Gum on shoe', icon: '🍬', harmful: true, clock: 'step',
    duration: 20 /* GUM.steps */, resistable: true,
    effects: { moveCostMult: 1.5, speedMult: 0.6, noFootwork: true, slipProof: true } },
  bleed: { name: 'Bleeding', icon: '🩸', harmful: true, clock: 'step',
    duration: 2, resistable: false, effects: { dot: 1 } },
  // --- new content this plan ships ----------------------------------------
  stunned: { name: 'Mandatory Training', icon: '🪑', harmful: true, clock: 'turn',
    duration: 1, resistable: true, effects: { skipTurn: true },
    log: '{name} is pulled into mandatory training. Attendance will be taken.' },
  burning: { name: 'On Fire', icon: '🔥', harmful: true, clock: 'turn',
    duration: 2, resistable: false, effects: { dot: 2 },
    log: '{name} is on fire. This is not fine.' },
  blinded: { name: 'Toner Blast', icon: '🌫️', harmful: true, clock: 'turn',
    duration: 2, resistable: true, effects: { accMod: -0.3 },
    log: '{name} takes toner to the eyes.' },
};
```

`GUM`'s numbers migrate into the `gum` entry (the `data/surfaces.js` constant
shrinks to the surface-side bits or re-exports from the registry — one source
of truth either way).

## The runtime (`src/statuses.js`, pure)

```js
applyStatus(target, id, { duration }?, resist = 0)  // immunity + resist + refresh; returns applied?
hasStatus(target, id)
statusFx(target)               // the merged effects view (decision #5)
tickTurn(target)               // turn-clock statuses: dot fires, durations decrement, expiries return
tickStep(target)               // step-clock ditto (gum/bleed cadence)
clearStatuses(target, { harmfulOnly? } = {})        // purge / combat-end sweep
```

`target` is anything carrying a `statuses` map — a sheet or an AI unit. Damage
from `dot` is *returned* to the caller (`{ damage, expired }`) rather than
applied, so combat and the map step handlers keep owning HP mutation and FX
(the same split as `truncateByBudget` returning cost).

**Application vectors, one shape everywhere.** `applies` generalizes from the
current bare string to `'gum'` *or* `{ id, duration }`:
- enemy attacks (`data/enemies.js attacks[].applies`) — the existing gum flick
- surfaces (`data/surfaces.js onEnter.applies`) — the existing gum wad
- **player actions** (`data/actions.js`) — new: any attack may carry
  `applies`, resolved in `performOn` after the hit lands
- fire (`FIRE.onEnter`) gains `applies: 'burning'` — walking through flame
  now *keeps* burning you (the instant damage stays)
- shove into something solid: `applies: 'stunned'` on the wall-slam branch —
  the knockdown DOS2 shoves are for
- equipment procs (EQUIPMENT_PLAN, later) call the same `applyStatus`

## Architecture: where it lands

### Pure modules (unit-tested)

**`src/data/statuses.js`** — the registry above. Imports nothing.

**`src/statuses.js`** — the runtime above. Imports only the registry.

**`src/stats.js`** — `createSheetFrom` seeds `statuses: {}` and drops the
`bleed`/`gum` numeric fields; `statusResist` unchanged (now consumed inside
`applyStatus`); talent `statusImmune` honored (`paperCutImmune` mapped in).

### PlayCanvas / DOM modules

**`src/combat.js`** — the biggest customer, and it *shrinks*:
- `beginTurn`: replace the hand-coded surprised branch with a generic
  `tickTurn` + `skipTurn` check that works for any unit or member (stun and
  surprise become the same code path); apply `dot` damage with the usual
  popup/death handling; expire `deflecting` naturally instead of resetting
  `m.defended`.
- `type: 'defend'` actions call `applyStatus(sheet, 'deflecting')`.
- `aiAttack` / `performOn`: incoming damage reads `statusFx(target).incomingMult`;
  the gum flick becomes generic `applies` resolution; on-miss skips it
  (HIT_PLAN); `hitChance` mods read `accMod`/`dodgeMod` from both sides.
- `stepCost` / the `footwork` gate / `aiAdvance`'s gum & slip checks read
  `statusFx`/`hasStatus` — and AI gum stops being permanent (`unit.gummed`
  dies; units tick like everyone else).
- Combat end (`cleanup`): sweep turn-clock statuses from every combatant.

**`src/main.js`** — `onMemberStep`/`onSummonStep`: the gum/bleed tick blocks
collapse into `tickStep(sheet)` + returned-damage handling; surface `applies`
goes through `applyStatus`; the follower speed read (`main.js:1707`) and slip
checks read `statusFx`.

**`src/ui.js`** — the chips row (`ui.js:205`) renders from the registry
(icon + name + remaining) for *any* status; the enemy focus banner lists a
hostile's statuses; the initiative strip gets per-slot mini-icons.

**`src/god.js`** — a status panel section: apply/clear any registry status on
the selected member or enemy (`__god.applyStatus(target, id, duration)`).

**Debug surface** — `__game`/`__combat` expose a `statuses` snapshot per
member/enemy for the e2e suite.

### Persistence

Save **v4** (coordinate with EQUIPMENT_PLAN — whichever lands second takes
v5): sheets serialize `statuses` (step-clock entries only survive by decision
#2 anyway). Migration in `party.js normalizeSheet`: numeric `sheet.gum` /
`sheet.bleed` convert to map entries of the same remaining duration; missing
map seeds `{}`.

## Milestones (each a PR that keeps `npm test` + e2e green)

1. **Registry + runtime, inert.** ✅ Landed. `data/statuses.js` (the seven
   entries: the four incumbents + stun/burning/blinded) and `src/statuses.js`
   (`applyStatus`/`hasStatus`/`statusLeft`/`statusFx`/`tickTurn`/`tickStep`/
   `clearStatuses`/`statusList`). Full unit coverage: default-duration apply,
   refresh-to-max (no stacking), resist-with-floor, immunity (`statusImmune`
   list + `paperCutImmune` alias), the `statusFx` merge rules (OR booleans,
   multiply `*Mult`, sum other numerics), dot tick + expiry, turn/step clocks
   not cross-ticking, and the clock/harmful/purge sweeps. Nothing imports them
   yet - zero observable change. Unit 127→138.
2. **Turn-clock incumbents.** ✅ Landed. `surprised` (unit flag) and
   `deflecting` (the member `defended` boolean) now live in the status map:
   `beginTurn` ticks turn-clock statuses generically (a `skipTurn` status costs
   a unit its turn; every turn-clock duration decrements, so Deflect expires at
   the member's next turn instead of a hand-reset `defended = false`); the
   defend action calls `applyStatus(sheet, 'deflecting')`; `aiAttack` reads
   `statusFx(m.sheet).incomingMult` for the halving; the surprise accuracy bonus
   reads `hasStatus(en, 'surprised')`; purge (`reboot`, self and enemy) is now
   `clearStatuses`; `cleanup` sweeps turn-clock statuses from every combatant
   (step-clock persists). Added `removeStatus` to the runtime for the
   `__combat.defended` setter. The old `m.defended`/`en.surprised` fields are
   gone (a `src`-wide grep confirms only a comment remains). Unit 139/139; e2e
   green (hit/game/classes/party/summons, 18 tests) — same logs, same outcomes.
3. **Step-clock incumbents.** `gum` + `bleed` migrate; the read-site audit
   (grep `\.gum|\.bleed|gummed|defended` — the list in "Where we are today"
   is the checklist); save v4 migration; AI gum becomes duration-based
   (called out below). Chips UI reads the registry.
4. **New content.** `stunned` (wall-slam shove + a `regional-executive`
   attack `applies`), `burning` (fire tiles), `blinded` (a new printer-themed
   source — e.g. thrown `toner-cartridge` finally earning its slot as a
   throwable, or a printer-explosion rider); player-action `applies` support;
   focus-banner + initiative-strip UI; god panel section.
5. **Mind control (deferred design, own PR).** Fear ("Performance
   Improvement" — flee toward the nearest exit-ward tile for N turns) and
   charm (`mandatory-fun` — swaps `team` for targeting purposes). Needs:
   `pickTarget` honoring a charm flag, forced-move resolution in the AI
   driver, and members-under-AI control (the enemy driver running a member
   body — the machinery `acting` already almost is). Scope it when the
   framework has soaked.

## Testing

- **Unit** (`tests/unit/statuses.test.js`): refresh-not-stack; resistable
  durations shrink by resist but floor at 1; immunity blocks; `statusFx`
  merge rules (sum mods, multiply mults, OR booleans); tick returns dot
  damage and expiries; step vs turn clocks never cross-tick.
  `stats.test.js`: sheet seeding + `paperCutImmune → statusImmune` mapping.
  `party.test.js`: v3→v4 migration of numeric gum/bleed.
- **e2e**: Manager gum flick → chip shows with remaining steps → wears off by
  walking (exists today in spirit — re-point at `statuses`); pinned-hit stun
  via god → enemy's initiative turn logs the skip; reboot purge clears an
  applied status; fire walk applies burning and it ticks on the next turn.
- **Regression invariant:** milestones 2–3 change zero observable behavior —
  every existing gum/bleed/surprise/deflect spec passes with only its state
  reads re-pointed.

## Risks and open questions

- **The read-site audit is the whole risk** (same shape as PROGRESSION's
  maxHp write audit). `gum` especially: combat pricing, footwork, AI, two
  step handlers, follower speed, chips, god. Milestone 3 exists solely to do
  this sweep with the framework already trusted from M2. Grep list is in the
  decision-#6 row and "Where we are today".
- **AI gum changes behavior slightly.** Today an AI unit's gum is permanent
  (`unit.gummed` never clears); on the framework it wears off after the same
  steps a member's does. That's a (small, player-favoring… actually
  enemy-favoring) real change — flag it in the M3 PR, guard the *within-combat*
  behavior which is what the specs cover.
- **Burning + fire double-dips.** Fire tiles already deal instant `onEnter`
  damage; adding a 2-dmg dot on top makes fire much meaner. M4 should tune
  (e.g. drop FIRE.onEnter to 3, dot 2×2 turns) — the god panel makes this a
  live-tuning session, not a code loop.
- **Turn-clock statuses on out-of-combat sources.** A surface that applies
  `burning` outside combat has no turns to tick. Rule: out of combat,
  turn-clock applications are skipped (the instant damage already covers it).
  One `inCombat` check at the application site — but it must not be
  forgotten; unit-test the vector.
- **Stacking / multiple sources (open).** Refresh-to-max is v1. If two
  different slows should someday stack (`chilled` + gum), `statusFx`'s
  multiply-mults rule already composes *different* statuses — only
  same-status stacking is excluded. Likely fine forever.
- **Charmed members (open, M5).** A charmed *member* means the AI drives a
  player body for a turn — `acting` can hold a member today structurally, but
  the defeat/handoff rules (`livingParty`, `notifyMemberDown`) were never
  audited for it. That audit is why M5 is its own PR.
