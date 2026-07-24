# To-Hit / Defense Plan

A real chance to miss — and a reason to build for not being hit. Today every
attack in the game auto-lands: `combat.js performOn` is
`rand(a.min, a.max) + damageBonus(...)` and `aiAttack` is `rand(atk.min,
atk.max)` minus the Composure soak. There is no accuracy, no dodge, no miss —
the only defense is flat mitigation (Composure's soak) and the Deflect stance's
halving. Both BG3 (d20 + modifiers vs AC) and DOS2 (hit% vs dodge%) are built
on an attack roll; this is the single biggest structural gap between this
combat and theirs. This document is the implementation plan: the design
decisions, the module-by-module changes, and the milestone order. No code yet.

It follows the same shape as `PROGRESSION_PLAN.md`, and honors the one rule
from `ARCHITECTURE.md`: **content is data, code is systems.** Hit chances
derive from the attributes that already exist; the constants live in one
tunable block; per-action and per-enemy flavor (miss lines, innate
accuracy/dodge) are data entries. The roll itself is the only new system.

**Sequencing note (the three combat plans):** this plan is the foundation of
the trio — `STATUS_PLAN.md` wants `accMod`/`dodgeMod` status effects and
`EQUIPMENT_PLAN.md` wants accuracy/dodge gear, both of which are meaningless
until a hit roll exists. Land this first, then statuses, then equipment.

## Where we are today

- **Player attacks auto-hit.** `combat.js performOn` (single target),
  `fireCone` (per target in the wedge), and the thrown-weapon path all roll
  damage straight away. Range, line of sight, AP, and ammo are the only gates.
- **Enemy attacks auto-hit.** `aiAttack` rolls damage, applies the Composure
  soak (`deflect(sheet)`, min 1) and the Deflect-stance halving
  (`m.defended`), and lands it. A fight's variance is purely the damage dice.
- **The pieces to build on already exist.** The four attributes are the stat
  source (`stats.js`, PROGRESSION_PLAN M1–M2); `unitCombat(def)` is the
  archetype seam every AI unit reads stats through; `initiative.js` already
  rolls d20 + mod with an **injectable rng** — the pattern the hit roll should
  copy for testability.
- **Two attributes are single-purpose on defense/offense.** Hustle drives
  maxAp + initiative, Savvy drives damage. Neither has a defensive/accuracy
  role — the hit model gives each a second job and completes the symmetry
  (Grit: HP + surface resist; Composure: soak + status resist).

## What we're building

- **A percentage hit model (DOS2-style), not d20-vs-AC (BG3-style).**
  `hitChance = BASE_HIT + accuracy(attacker) − dodge(defender)`, clamped.
  One roll per attack; a miss spends the AP (and the paper) and does nothing.
- **Two new derived stats**, computed the same way every other derived number
  is: **accuracy** from Savvy, **dodge** from Hustle. Pure helpers in
  `stats.js` beside `damageBonus`/`deflect`.
- **Enemies participate symmetrically.** ENEMY_TYPES entries may carry innate
  `accuracy`/`dodge` (percentage points, default 0); `unitCombat` passes them
  through and `scaleEnemy` grows them gently with level.
- **Misses are content.** Every action/enemy attack may carry a `missLog`
  ("Your passive-aggressive email goes to junk.") — pure data, with one
  generic fallback. A floating "MISS" popup via the existing `fx.damageText`.
- **Hit% is visible before you commit** — DOS2's most load-bearing UI. While
  an attack is armed, hovering a ringed target shows the computed chance in
  the existing cost tag.
- **Deterministic when it must be**: an injectable rng (the initiative
  pattern) plus a god-panel pin (force hit / force miss) that the e2e suite
  uses so existing specs stay reliable.

Flat damage reduction stays exactly where it is: Composure's soak and the
Deflect stance both apply **after a hit connects**. Dodge is avoidance,
soak is armor — two distinct layers, like DOS2's dodge vs armor. (Armor
*items* adding to soak are `EQUIPMENT_PLAN.md`.)

## Design decisions (recommended, with alternatives considered)

| # | Decision | Choice | Why / alternatives |
|---|----------|--------|--------------------|
| 1 | Roll model | **Percentage hit vs dodge (DOS2)**, not d20 + mods vs AC (BG3) | Attacks here are few (2–3 AP each from a 5–7 AP pool) and damage dice are small, so hit rates must be high and finely tunable — percentages tune in 5% steps and display honestly ("85%"). A d20-vs-AC model quantizes to 5% anyway but drags in AC/proficiency vocabulary the game doesn't have. The d20 already in `initiative.js` stays — initiative is a contest, attacks are a chance. |
| 2 | Attribute mapping | **Accuracy ← Savvy, dodge ← Hustle** | Completes the two-jobs-per-attribute symmetry (see above) and reads naturally: Savvy "knows exactly where it'll hurt", Hustle is fast on its feet. Alternatives: accuracy from Hustle (but then Hustle triple-dips: AP + initiative + accuracy) or a new fifth stat (rejected — PROGRESSION decision #1 deliberately capped the set at four). Savvy double-dipping (damage + accuracy) is the acceptable cost; the constants keep the accuracy term small. |
| 3 | Base rate & clamp | `BASE_HIT = 0.85`, clamp to `[0.35, 0.95]` | High base = DOS2-at-level-parity feel; misses sting but don't dominate. The 0.95 cap keeps a universal 1-in-20 whiff (BG3's nat 1); the 0.35 floor keeps a stacked dodge build from being unhittable. All three are constants in one tunable `HIT` block — the god panel can pin them. |
| 4 | What a miss costs | **AP and ammo are spent; nothing else happens** | Genre-standard and the whole point of the gamble. On-hit riders (gum flicks, purge, future status procs) don't fire on a miss. A cone rolls **per target** but its `leaves` surface still carpets — the envelopes go somewhere. |
| 5 | Shove | **Auto-hits in v1** | Shove is positioning tech, not damage tech (DOS2's teleports don't miss). A Hustle-vs-Hustle contest is a clean later add; noted in open questions. |
| 6 | Surprise interplay | Attacking a `surprised` unit grants **+15% accuracy** (`SURPRISE_ACC_BONUS`) | Rewards the ambush opening (`main.js engageWithAction`) with better odds, not a free auto-hit — auto-hit would make the opener strictly correct every fight. |
| 7 | Determinism | **Injectable rng + a god pin** (`__god.forceHit: true/false/null`) | The pure roll (`rollHit`) takes an rng like `buildInitiativeOrder` does; combat reads the pin first. The e2e suite pins hits on for damage-assertion specs (they currently assume auto-hit) and pins misses on for the new miss specs. No sleep-until-lucky tests. |
| 8 | Crits | **Stretch, out of scope for the core plan** | The roll site is written so a second threshold (roll ≤ critChance → ×1.5) bolts on without reshaping anything. Keeps this plan to one new mechanic. |
| 9 | Regression posture | Milestone 1 lands the machinery with **hit chance clamped to 1.0** — zero behavior change, unit-guarded | The same boring-foundation-first invariant that kept PROGRESSION M1 green. Milestone 2 flips the constants live together with the UI and the e2e pins. |

## The model

All constants are starting proposals in one new tunable block in `stats.js`
(sibling to `PROGRESSION`):

```js
export const HIT = {
  BASE: 0.85,            // hit chance before any modifiers
  ACC_PER_SAVVY: 3,      // every N Savvy = one accuracy step
  DODGE_PER_HUSTLE: 3,   // every N Hustle = one dodge step
  STEP: 0.05,            // one step = ±5% hit chance
  CLAMP_LO: 0.35,
  CLAMP_HI: 0.95,
  SURPRISE_ACC_BONUS: 0.15, // vs surprised targets
};
```

New pure helpers (unit-tested, no PlayCanvas/DOM):

```js
accuracy(sheet)  = floor(savvy  / ACC_PER_SAVVY)   · STEP   // sheets
dodge(sheet)     = floor(hustle / DODGE_PER_HUSTLE) · STEP
// AI units aren't sheets: unitCombat(def) passes through def.accuracy /
// def.dodge (percentage fractions, default 0) — the same seam every other
// unit stat rides.
hitChance(acc, dge, mods = 0) = clamp(BASE + acc − dge + mods, CLAMP_LO, CLAMP_HI)
rollHit(chance, rng = Math.random) → boolean
```

At launch attributes sit at 3–8, so `floor(attr/3)·5%` gives ±5–10% swings
around the 85% base — noticeable, buildable, not dominant. Every 3 points
into Savvy or Hustle buys a visible 5%.

**Who resolves against whom:**

| Attack path (combat.js) | Attacker acc | Defender dodge |
|---|---|---|
| `performOn` (melee + thrown) | `accuracy(active.sheet)` | `unitCombat(en.def).dodge` |
| `fireCone` (per target) | same | per-target |
| `aiAttack` | `unitCombat(unit.def).accuracy` | `dodge(m.sheet)` |
| shove | — auto (decision #5) | — |

On a hit, resolution is exactly today's: damage roll → Composure soak →
Deflect halving → `applyDamage`/`takeDamage`. On a miss: AP/ammo spent, "MISS"
popup, miss log line, no rider effects, no flinch.

## Architecture: where it lands

### Pure modules (unit-tested)

**`src/stats.js`** — the `HIT` block; `accuracy(sheet)`, `dodge(sheet)`,
`hitChance(...)`, `rollHit(chance, rng)`; `unitCombat(def)` gains
`accuracy: def.accuracy || 0, dodge: def.dodge || 0`; `scaleEnemy` optionally
grows both with level (proposal: `+STEP per 3 levels above native`, capped —
tune in the balance milestone).

**`src/data/enemies.js` / `data/classes.js` (AI-combat fields)** — optional
`accuracy`/`dodge` on entries. Proposal: the base three stay 0/0; `executive`
+5% acc; `senior-manager` +5% acc; `regional-executive` +10% acc, +5% dodge;
the `applicant` stays 0/0 (flimsy is the design). Pure data, tune freely.

**`src/data/actions.js`** — optional `missLog` per action ("It goes straight
to junk."). Enemy `attacks` entries likewise. One generic fallback line lives
with the roll site.

### PlayCanvas / DOM modules

**`src/combat.js`** — the one real change site:
- A single helper `resolveHit(accFrac, dodgeFrac, mods)` wrapping pin → rng →
  `rollHit`, called from `performOn`, `fireCone` (inside the per-target loop),
  and `aiAttack`. On miss: spend costs, `fx.damageText(x, z, 'MISS', ...)`,
  log the `missLog` or fallback, skip damage + riders (`applies`, `purge`),
  skip the target `flinch`.
- `startCombat` accepts an optional `rng` (defaults `Math.random`) alongside
  the existing `initRng` pattern.
- Hit% preview: while `armed`, `handleHover` currently early-returns — extend
  it to detect a live enemy near the hover point (the same `cheb` proximity
  the rings use) and show `NN% to hit` in the existing `costTag`. Rings stay
  the range/validity signal; the tag is the odds signal.

**`src/ui.js`** — nothing structural; the cost tag is combat-owned. (The
focus banner gaining "dodgy"-type descriptors is polish, not required.)

**`src/god.js`** — a Combat pin: `__god.forceHit = true | false | null`;
the `HIT` constants join the pinnable set so a tester can slam BASE to 1.0
or 0.0 live.

**Debug surface** — `__combat` exposes `lastRoll` (`{ chance, hit }`) for the
e2e suite to assert the preview matches the resolution math.

### Persistence

None. Accuracy/dodge are derived, never stored; no save-version bump.

## Milestones (each a PR that keeps `npm test` + e2e green)

1. **The machinery, inert.** `HIT` block + the four pure helpers + `unitCombat`
   pass-through, `startCombat({ rng })`, and the `resolveHit` call sites wired
   in `performOn`/`fireCone`/`aiAttack` — **with `BASE: 1.0, CLAMP_LO: 1.0`**
   so every roll still hits. Unit tests pin the math (chance formula, clamps,
   rng edge cases); a unit guard asserts the shipped constants make
   `hitChance` ≡ 1 this milestone. Zero observable change.
2. **Turn it on.** Constants go live (0.85 base); miss handling (popup, logs,
   no riders); `missLog` lines authored for the shipped actions + enemy
   attacks; the god pin; e2e specs that assert damage set `forceHit = true`,
   plus new specs: a pinned miss deals 0 and still spends AP/ammo; a pinned
   miss does not apply gum.
3. **The odds on screen.** Hover hit% in the cost tag; `SURPRISE_ACC_BONUS`;
   `__combat.lastRoll`; e2e asserts the previewed chance equals the pure
   `hitChance` for the same pair.
4. **Balance + enemy identity.** Innate acc/dodge on the variant enemies,
   `scaleEnemy` growth, a numbers pass on damage (see risk #1). Stretch items
   live here or later: crits, the shove contest, dodge-vs-cone rules.

## Testing

- **Unit** (`tests/unit/stats.test.js`): formula and clamp math; step
  boundaries (savvy 2→3 adds exactly one step); `rollHit` respects the
  injected rng (rng at chance−ε hits, at chance+ε misses); `unitCombat`
  defaults; `scaleEnemy` never scales acc/dodge past the clamp's reach;
  the M1 constants-are-inert guard.
- **e2e** (`tests/e2e/`): pinned-hit damage specs unchanged in outcome;
  pinned-miss spec (AP/ammo spent, HP untouched, MISS popup text in the log);
  hover-preview spec via `__combat.lastRoll`/cost tag.
- **Regression invariant:** after milestone 1 every existing spec passes
  byte-identical — the roll exists but cannot fail.

## Risks and open questions

- **A global ~15% whiff rate is a real balance change.** Both sides get it,
  so fights mostly get *longer*, not harder — but heal/AP economies were
  tuned for auto-hit. Milestone 4 owns a damage/HP pass; until then expect
  slightly grindier fights (same accepted posture as PROGRESSION's "swingy
  until M4").
- **Savvy double-dips (damage + accuracy).** Watched, not feared: accuracy is
  clamp-capped at +10% over base while damage keeps scaling, so the marginal
  Savvy point decays. If it still dominates, `ACC_PER_SAVVY: 4` is a
  one-number fix.
- **e2e flake surface.** Every spec that swings must pin. The audit is
  mechanical (grep specs for attack clicks), but a missed one is a coin-flip
  test — do the sweep in milestone 2, not lazily.
- **Shove contest (open).** Auto-hit shove + wall slam + hazard dunk is
  strong. If it becomes the dominant verb once attacks can miss, add the
  Hustle-vs-Hustle contest early.
- **Cone dodge feel (open).** Dodging a room-wide fan of envelopes reads
  slightly silly; an alternative is cones can't be dodged but keep the
  accuracy roll. Ship symmetric (dodge applies), revisit on feel.
- **Status/equipment seams (deliberate).** `hitChance(..., mods)` takes a flat
  modifier term precisely so `STATUS_PLAN.md`'s `accMod`/`dodgeMod` and
  `EQUIPMENT_PLAN.md`'s accuracy/dodge gear plug in without touching the
  formula again.
