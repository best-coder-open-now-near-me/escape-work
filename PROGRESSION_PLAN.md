# Character Progression Plan

Levels that mean something — for the party *and* the coworkers trying to keep
them at their desks. Baldur's Gate / Divinity-style build agency, wearing an
office lanyard. This document is the implementation plan: the design decisions,
the module-by-module changes, and the milestone order. No code yet.

It follows the same shape as `PARTY_PLAN.md`, and honors the one rule from
`ARCHITECTURE.md`: **content is data, code is systems.** Every attribute curve,
class-track node, and enemy tier is a data entry the engine reads — the level-up
screen, the derivation math, and the enemy scaler are the only new *systems*.

## Where we are today

- **A level-up is one line of code and almost no payoff.** `stats.js gainXp`
  grows `xpNext ×1.5`, adds `+1 bonusDmg`, and full-heals. That's it — no
  attributes, no HP/AP growth, no new abilities, no choice.
- **XP already fans out to the whole party** (`party.js gainXpAll`) and
  companions join at the leader's level (`createCompanionSheet`). That
  plumbing stays; we're changing what a level *gives*, not who earns it.
- **Classes are fixed stat blocks** (`data/classes.js`: `maxHp`, `ap`,
  `bonusDmg`, `actions`, one `talent`). The code already anticipates "a future
  talent-choice system" (see the IT Support comment) — this plan is that system.
- **Enemies don't progress at all.** `data/enemies.js` entries are static and
  hand-placed by legend char; `new EnemyActor(x, z, type, ENEMY_TYPES[type])`
  reads `def.hp` straight through. A floor-1 Manager and a floor-9 Manager are
  identical.

## What we're building

- **Four office attributes** — Grit, Hustle, Savvy, Composure — that live on the
  character sheet and are the *single source of truth* for combat numbers. HP,
  AP, damage, and deflect are **derived** from them (mirroring how the logical
  tile is derived from a continuous position), never hand-set.
- **Two point currencies earned on level-up**, both player-allocated:
  - **Attribute points** — raise the four attributes.
  - **Class points** — spend on a per-class **ability track**: unlock a new
    combat action, upgrade one you own, or take a talent. This is the
    talent-choice system the code has been reserving space for.
- **A level-up screen** where you spend them — banked during combat, resolved at
  the next safe moment (BG3 "level up at camp" feel), openable any time points
  are pending.
- **Enemy progression**: every enemy gains a **level**; named **seniority
  variants** (Senior Manager, Regional Executive…) are new data entries, and a
  **floor-indexed curve** scales any enemy with depth so encounters keep pace
  with a leveling party. XP paid scales with enemy level.
- **Persistence**: attributes, unspent points, and chosen track nodes ride the
  campaign save (v3), with v1/v2 saves migrating cleanly.

Companions progress too — they level in lockstep (shared XP) and grow, but to
avoid babysitting three build screens they **auto-allocate** on a per-companion
weighting by default; manual party-wide allocation is a later milestone.

## Design decisions (recommended, with alternatives considered)

| # | Decision | Choice | Why / alternatives |
|---|----------|--------|--------------------|
| 1 | Attribute set | **Office-themed 4-stat**: Grit, Hustle, Savvy, Composure | Fits the satire and stays small enough to balance across 4 classes + companions + enemies and to fit the god panel. A classic STR/DEX/CON/INT/WIS/CHA spread was considered — familiar and deeper, but off-theme and 6 axes to tune. A derived-only, no-raw-attribute model was rejected: it wouldn't deliver a real "attribute point system." |
| 2 | Level-up agency | **Player allocates both** attribute points and class points | Full CRPG build agency, which is the point of the request. Auto-attributes-choose-talents and fully-automatic were the leaner alternatives; both were passed over for the leader, but auto-allocation is reused for *companions* (see #7) to cap the UI burden. |
| 3 | Enemy progression | **Tiered variants + floor curve** | Named seniority variants are pure `data/enemies.js` content (content-is-data); the floor curve keeps even the base three relevant at depth. Floor-scaling-only was simpler but every floor fights the same three faces; elite modifiers are attractive and **kept as a stretch item** (#12), orthogonal to depth. |
| 4 | Attributes are the source, numbers are derived | Store the four attributes (+ a small per-class residual base); compute `maxHp`, `maxAp`, `damageBonus`, deflect from them via `recomputeDerived(sheet)` | Keeps `combat.js`/`ui.js` readers of `sheet.maxHp`/`sheet.maxAp` working unchanged — only *writers* of attributes call recompute. A pure-getter model was cleaner in theory but would touch every reader and complicate the save. `hp` still mutates in combat and clamps to the recomputed `maxHp`. |
| 5 | Regression-preserving calibration | Milestone 1 picks per-class base attributes **and** a residual `base:{hp,ap}` so every class's level-1 derived `maxHp`/`maxAp` **exactly equals today's constants** | The residual guarantees any target value is reachable (`maxHp = base.hp + grit·HP_PER_GRIT`), so the boring foundational refactor changes zero observable numbers — the same invariant that kept `PARTY_PLAN.md` milestone 1 green. |
| 6 | Point cadence | **2 attribute points / level**; **1 class point every 2 levels** (levels 2, 4, 6…). All cadence numbers live in one tunable `PROGRESSION` block | Starting proposal, balance-owned. Round numbers, easy to reason about, easy to pin in the god panel. |
| 7 | Companion allocation | Companions **auto-allocate** via a per-companion `attrWeights` and a fixed track preference; the leader allocates manually | Everyone levels together (shared XP), so three manual screens per kill would be misery. Per-member *manual* allocation (page through the roster, BG3-style) lands in the polish milestone for players who want it. |
| 8 | When you spend | Points **bank** on the sheet the instant you level; the allocation screen is deferred to a safe moment (combat end, floor transition) and openable any time points are pending | Opening a modal mid-swing breaks tactical flow. Banking + a HUD "Level Up!" pip matches BG3's rest-to-level rhythm and sidesteps a combat/modal interleave bug surface. Level-ups still **full-heal on the spot** — that moment stays. |
| 9 | No respec (v1) | Allocation is one-way; no rebuild screen yet | Ships the core loop faster. A "Visit HR to refile your paperwork" respec is an obvious, on-theme later add; noted in open questions. |
| 10 | Enemy level source | `effectiveLevel = max(entry.level, floorDepth)`; `scaleEnemy(def, effectiveLevel)` derives hp/attacks/ap/xp at spawn | `max` means a low variant placed deep still scales up, while a high-tier variant on a shallow floor keeps its tier — no double-inflation. Variants exist mainly for **fiction, new attacks, and loot**; the curve owns the **numbers**. |
| 11 | Floor depth is data | Each level gets an explicit `depth` (floor number) in its JSON / `data/levels.js` | Deriving depth by walking the `next` chain is fragile and editor-hostile; an explicit field is one integer and lints cleanly. |
| 12 | Elite modifiers | **Stretch / out of scope for the core plan**, but the enemy scaler is designed so a `modifiers:[]` layer can bolt on later without reshaping it | Keeps this plan focused on levels + tiers; leaves a clean seam. |

## The two currencies

Earned on level-up, spent on the level-up screen, banked until spent.

```
LEVEL UP → Lv 4                     (full heal fires immediately)
  +2 attribute points
      Grit ▸  Hustle ▸  Savvy ▸  Composure ▸
  Class point available (every 2nd level)
      ○ Upgrade Bulk Mail (+1 dmg)   ○ Unlock Steel-Toe Kick   ○ +1 Grit talent
```

- **Attribute points** (`sheet.attrPoints`): 1:1 into one of the four
  attributes. `spendAttrPoint(sheet, attr)` validates and calls
  `recomputeDerived`.
- **Class points** (`sheet.classPoints`): spent on the class **track** (below).
  `spendClassPoint(sheet, nodeId)` checks cost + prerequisites, records the node
  in `sheet.perks`, applies its effect, recomputes.

## The four attributes

Each attribute drives concrete, existing combat machinery — nothing cosmetic.
Constants are starting proposals in the tunable `PROGRESSION` block.

| Attribute | Fiction | Derives | Formula (proposal) |
|-----------|---------|---------|--------------------|
| **Grit** | Absorbs punishment; ignores the wet-floor sign | `maxHp`; surface-tick resistance | `maxHp = base.hp + grit·HP_PER_GRIT` (`HP_PER_GRIT=2`); surface damage reduced by `floor(grit/6)`, min tick 1 |
| **Hustle** | Moves fast, does more per turn | `maxAp` (⇒ move budget, since move is 1 AP/tile) | `maxAp = base.ap + floor(hustle/HUSTLE_PER_AP)` (`HUSTLE_PER_AP=4`) — AP is precious, so it steps, not ramps |
| **Savvy** | Knows exactly where it'll hurt | attack `damageBonus` | `+ floor(savvy/DMG_PER_SAVVY)` (`DMG_PER_SAVVY=3`), layered onto item bonus in `damageBonus()` |
| **Composure** | Unflappable; the memo bounces off | deflect (flat mitigation) + status-duration resist | incoming − `floor(composure/COMP_PER_DEFLECT)` (`=4`, min 1 dmg); applied gum/bleed duration − `floor(composure/4)` |

Per-class **base attribute spreads** preserve today's feel — Middle Manager
leans Grit/Composure (tanky), Mail Room leans Hustle (mobile), IT Support leans
Savvy with low Grit (glass cannon), Office Drone is even. Milestone 1 solves the
exact integers so level-1 derived stats match the current `maxHp`/`ap` table.

## The character sheet: new fields

`createSheetFrom` (stats.js) gains, sourced from the class/companion block:

```js
attr:        { grit, hustle, savvy, composure },  // the four, seeded per class
attrPoints:  0,     // unspent attribute points
classPoints: 0,     // unspent class points
perks:       [],    // chosen track node ids (applied on load via recompute)
actionMods:  {},    // per-action numeric overrides from upgrade nodes
                    //   e.g. { 'mail-cone': { min: +1, max: +1 } }
```

`maxHp`, `maxAp`, and `bonusDmg` remain on the sheet but become **recomputed
outputs** of `recomputeDerived(sheet)` (class base residual + attributes +
perks), called after: sheet creation, any point spend, and save load. `hp`
clamps to the new `maxHp`. `damageBonus(sheet)` extends its existing sum with
the Savvy term. Deflect/status-resist are new pure helpers read by combat.

## The class ability track (class points feed this)

Each class in `data/classes.js` gains a `track`: a small list/graph of nodes.

```js
track: [
  { id: 'bulk-mail-1', name: 'Heavier Envelopes', cost: 1,
    effect: { upgradeAction: { id: 'mail-cone', patch: { min: 1, max: 1 } } } },
  { id: 'soles-1', name: 'Warehouse Soles', cost: 1, requires: ['bulk-mail-1'],
    effect: { talent: { slipImmune: true } } },
  { id: 'kick', name: 'Steel-Toe Kick', cost: 1,
    effect: { grantsAction: 'kick' } },
  { id: 'grit-1', name: 'Thick Skin', cost: 1, effect: { attrBonus: { grit: 1 } } },
]
```

Node `effect` kinds — reusing the existing talent whitelist plus two new
system-understood kinds:

- `grantsAction: '<id>'` — **already understood** (Smoker's cigarette). Unlocks a
  combat action; it appears on the hotbar automatically.
- `talent: { <effect>: … }` — bumps the existing whitelist
  (`slipImmune`, `shockImmune`, `paperDamageBonus`, …). No new engine code.
- `attrBonus: { <attr>: n }` — flat attribute bump applied by `recomputeDerived`.
- `upgradeAction: { id, patch }` — **new**: writes into `sheet.actionMods`;
  `combat.js` reads the mod when resolving that action's `min`/`max`/`ap`/`uses`.
  One small, well-contained system addition.

Companions carry a shorter track (or none — they're interns and clerks, per
`data/companions.js`); their class points auto-spend down a preference list.

## Enemy progression

Enemies are not characters with sheets, so they get a **curve**, not points —
but the curve is expressed as "level → derived stats," mirroring the player
model so the mental model is one thing.

**`data/enemies.js`** — each entry gains a native `level` (its tier). New
**seniority variants** are ordinary entries, reusing models the way `executive`
already reuses the `midmanager` rig:

```
manager           level 1   14hp   8xp     (the base tier)
senior-manager    level 3   ~22hp  ~14xp   new entry, reuses 'manager' model, harder attacks
regional-exec      level 5   ~34hp  ~22xp   new entry, new attack lines + better loot
```

**The scaler** (new pure function, `src/progression.js` or folded into
`stats.js`, unit-tested):

```js
scaleEnemy(def, level) →
  hp:      round(def.hp   · (1 + HP_GROWTH·(level - def.level)))     // HP_GROWTH ≈ 0.15
  attacks: min/max each + floor((level - def.level)/2)
  ap:      def.ap + floor((level - def.level)/3)
  xp:      round(def.xp   · (1 + XP_GROWTH·(level - def.level)))     // reward scales with level
```

**Spawn wiring** (main.js): `effectiveLevel = max(def.level, level.depth)`, then
`new EnemyActor(x, z, type, scaleEnemy(def, effectiveLevel))`. So a Manager on
floor 3 is level 3 and beefier; a Senior Manager placed on floor 2 keeps its
tier. The enemy's level surfaces in `examine` / the focus banner subtitle.

**Levels** get an explicit `depth` field; variant chars are placed in the legend
like any enemy. The floor curve means we don't have to re-author every enemy per
floor — placing the base `M` on a deep floor already scales.

## Architecture: where it lands

### New / changed pure modules (unit-tested, no PlayCanvas/DOM)

**`src/stats.js`** — the heart of the change:
- `createSheetFrom` seeds `attr`, `attrPoints`, `classPoints`, `perks`,
  `actionMods` from the block; calls `recomputeDerived`.
- `recomputeDerived(sheet)` — sets `maxHp`/`maxAp`/`bonusDmg` from base residual
  + attributes + perk `attrBonus`; clamps `hp ≤ maxHp`.
- `gainXp` — on level: `attrPoints += ATTR_PER_LEVEL`; `classPoints += 1` on the
  cadence; full-heal; **stop the automatic `bonusDmg += 1`** (that value now
  comes from Savvy). Returns richer promotion info (new level, points granted).
- `spendAttrPoint(sheet, attr)`, `spendClassPoint(sheet, nodeId)` — validate,
  apply, recompute.
- `damageBonus(sheet)` — existing sum `+ floor(savvy/DMG_PER_SAVVY)`.
- New helpers: `deflect(sheet)`, `statusResist(sheet)`.
- One exported `PROGRESSION` constants block (all the tunables above).

**`src/progression.js`** (new, or a section of stats.js) — `scaleEnemy(def,
level)` and the enemy curve constants. Pure and lint/unit friendly.

**`src/party.js`** — `createCompanionSheet` already levels via `gainXp`; now it
also **auto-allocates** the banked points (`autoAllocate(sheet, weights)`) so
recruits never sit on unspent points. Save bumps to **v3** (below);
`normalizeSheet` backfills `attr`/points/`perks`/`actionMods` for v1/v2 sheets
(default attributes from class base, then `recomputeDerived`).

### PlayCanvas / DOM modules

**`src/main.js`**
- `awardKill`: still `gainXpAll`; on promotion, bank points, toast "Promotion —
  Level N, 2 points to spend," and set the HUD pip. Auto-open the allocation
  screen at combat end and on floor transition when points are pending.
- Enemy spawn: pass `scaleEnemy(ENEMY_TYPES[type], max(def.level, depth))`.
  `spawnEnemy` (god/debug path) takes an optional level.
- Floor `depth` read from the level data.

**`src/combat.js`** — mostly unchanged, because the numbers it reads
(`sheet.maxAp`, `damageBonus`) are already derived onto the sheet. Two touches:
apply `sheet.actionMods` when resolving an action's `min/max/ap/uses`, and fold
`deflect(sheet)`/`statusResist` into the incoming-damage and status-apply paths.

**`src/ui.js`**
- `updateStatsHud` gains the four attributes (compact) and a "Level Up!" pip when
  points are pending.
- **`showLevelUpScreen(sheet, { onDone })`** — the allocation UI: four attribute
  steppers spending `attrPoints`, and the available `track` nodes spending
  `classPoints`, with prereqs greyed. Reuses class-picker/dialogue chrome. Stable
  DOM ids for e2e (`#lvlup-attr-<name>`, `#lvlup-node-<id>`, `#lvlup-done`).
- Optional **character sheet** panel (press **C**) to inspect attributes, derived
  values, and taken perks — read-only in v1 (no respec).

**`src/god.js`** — Player tab shows attributes/points/perks with live edit
(extend the `readOnly` set so identity fields stay locked but `attr`/points are
editable); `__god` gains `setAttr`, `grantAttrPoint`, `grantClassPoint`,
`learnNode`. Enemy tab shows/sets enemy `level` and re-scales live.

**Debug surface** — `__game` exposes `progression`-relevant reads used by e2e
(a member's `attr`, `attrPoints`, `classPoints`, derived `maxHp`; an enemy's
`level`). Keep in sync per the ARCHITECTURE convention.

### Persistence

Save **v3**: sheets now serialize `attr`, `attrPoints`, `classPoints`, `perks`,
`actionMods` (the derived `maxHp`/`maxAp`/`bonusDmg` are recomputed on load, not
trusted from disk). Migration in `party.js`:
- **v2** (`{version:2, party:[…], active}`) and **v1** (`{levelId, sheet}`):
  `normalizeSheet` seeds default attributes from the sheet's class base, zero
  points/perks, then `recomputeDerived`. A migrated character keeps its current
  level and item inventory; it simply starts with the class-baseline build (no
  retroactive points — noted in open questions). Bump `SAVE_VERSION = 3`.

## Milestones (each a PR that keeps `npm test` + e2e green)

1. **Attributes as the stat source — zero behavior change.** Add `attr` +
   `recomputeDerived`; express every class's current `maxHp`/`ap` as base
   attribute spreads + a residual so level-1 derived values **exactly match
   today**. `gainXp` still does its current `+1 dmg`. Save v3 + migration.
   Regression invariant: the game plays identically; every existing test proves
   it. Deliberately boring, and most of the risk — the `PARTY_PLAN.md`
   milestone-1 pattern.
2. **Attribute points + the level-up screen.** `gainXp` grants `ATTR_PER_LEVEL`
   instead of auto damage; Savvy now drives damage, Grit HP, Hustle AP,
   Composure deflect. `showLevelUpScreen` (attribute half), banking + HUD pip,
   deferred open at combat end / floor transition. Companions auto-allocate.
3. **Class points + the ability track.** `track` data on all four classes;
   `actionMods`/`upgradeAction` in combat; `grantsAction`/`talent`/`attrBonus`
   nodes; the class-point half of the level-up screen; perks persisted and
   re-applied on load.
4. **Enemy tiers + floor curve.** `level` on every enemy, `scaleEnemy`, the
   `depth` field on levels, seniority variant entries (Senior Manager, Regional
   Executive), scaled XP, level in examine/banner. Place variants on floor 2 and
   rebalance floors 1–2 for the now-stronger party.
5. **Polish + party-wide builds.** Per-member manual allocation (page the roster
   in the level-up screen), the character-sheet inspect panel (**C**), god-panel
   progression editing, an on-theme respec if it earns its keep, and a content
   pass (a deeper floor to show the curve off). Elite modifiers (#12) can ride
   here or wait.

## Testing

- **Unit** (`tests/unit/`):
  - `stats.test.js` — attribute→derived math; `recomputeDerived` clamps `hp`;
    `gainXp` grants points (not raw damage) on the right cadence; spend
    validation (bad attr, insufficient points, unmet prereq); `damageBonus`
    includes Savvy; deflect/status-resist helpers.
  - `progression.test.js` — `scaleEnemy` monotonicity (hp/xp grow with level),
    `effectiveLevel = max(level, depth)`, base-tier identity at native level.
  - `party.test.js` — save **v1→v3** and **v2→v3** migration; companion
    `autoAllocate` spends all banked points.
  - `levels.test.js` — lint gains: `depth` present and integer; any legend char
    resolving into a variant enemy is a valid `ENEMY_TYPES` id.
- **e2e** (`tests/e2e/`):
  - Kill an enemy → HUD shows the Level-Up pip → open the screen → spend a point
    into Grit → `maxHp` (via `__game`) increases and the HUD reflects it.
  - Spend a class point that `grantsAction` → the new action appears on the
    hotbar (`#hotbar-act-<id>`).
  - A Manager spawned on a deeper floor has more HP than the floor-1 Manager
    (assert on `__game` enemy state / focus banner).
- **Regression invariant**: every existing spec passes **unchanged after
  milestone 1** — attributes are just today's numbers, expressed differently.

## Risks and open questions

- **The derived-vs-stored seam (decision #4) is the whole refactor's safety.**
  If any code sets `sheet.maxHp`/`sheet.maxAp` directly (rather than through
  attributes), it will silently drift on the next recompute. Milestone 1 must
  audit every write site (grep `maxHp =`/`maxAp =`) and route them through
  `recomputeDerived`. This is the milestone-1 risk, deliberately front-loaded.
- **Mid-combat level-ups.** Banking + deferred allocation (decision #8) avoids a
  modal-in-combat interleave, but the "auto-open at combat end" hook has to fire
  exactly once and after the victory heal/downed-revive settle. Sequence it in
  `main.js`'s post-combat block, not inside `combat.js`.
- **Balance inversion, again.** A party that now *builds* plus enemies that now
  *scale* multiply each other. Milestones 2–3 will feel swingy until milestone 4
  owns the enemy curve and floor rebalance — acceptable, same posture as
  `PARTY_PLAN.md`'s "two bodies make fights easy until milestone 5."
- **Retroactive points on migration (open).** Migrated saves start at the class
  baseline build with no back-paid points for levels already earned. Simplest
  and safe; the alternative (replay `ATTR_PER_LEVEL·(level−1)` points into the
  bank on load) is a one-liner if playtesting wants it. Leaning: back-pay into
  the bank so existing campaigns get a real level-up screen. **Confirm.**
- **Respec (open).** No rebuild in v1 (decision #9). An on-theme "refile with HR"
  respec is milestone 5 or later — worth it only if early builds prove trap-ridden.
- **Editor drops unknown actors.** Same documented limitation NPCs/companions
  already hit: re-exporting a level in the editor normalizes unknown actor chars
  to floor, so hand-placed variant enemies would be lost on re-export. Out of
  scope here; flagged so level authors don't round-trip variant floors through
  the editor until it's fixed.
