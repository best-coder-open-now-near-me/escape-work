# Movement Economy Plan

Make repositioning affordable without giving up the single-pool AP economy.
Today movement and actions compete for one budget at 1 AP per tile, which
means the positional layer `TACTICS_PLAN.md` just landed — flanking, cover,
backstab — costs a swing to use. This document records the implementation
plan: the design decisions, the module-by-module changes, and the milestone
order.

**Implementation status (2026-08-05): shipped.** All five milestones are in
the game. This file is the historical design/ratification record; current
module ownership and constants live in `ARCHITECTURE.md` and the source.

It follows the shape of the other plans, and honors the one rule from
`ARCHITECTURE.md`: **content is data, code is systems.** The movement rate is
a constant in one tunable block; the two talents are effect fields on
class-track nodes, read through the accessor talents already use; footwear's
contribution is an item stat like any other. The only new system is a second
budget that movement draws from first.

**Sequencing note:** this lands on top of `TACTICS_PLAN.md` and exists because
of it. Cover, flanking and backstab all ask the player to *go somewhere*, and
the current economy charges a full attack for the trip. Land tactics first
(done), then this.

## Where we are today

- **One pool, and movement is priced against it.** `combat.js` charges
  `stepCost` per unit distance out of the same `active.ap` that pays for
  attacks. `truncateByBudget(points, budget, stepCost)` (pathfinding.js) is the
  single place a route is billed, for the player (`walkActive`) and the AI
  (`aiAdvance`) alike.
- **The rate is 1 AP per tile.** `surfaceStepCost` returns `1 / slow` for a
  surface's `slow` multiplier, or 1 on clean floor. `stepCost` then multiplies
  by `statusFx(sheet).moveCostMult` — the seam gum already rides at 1.5.
- **A turn is two beats.** Attacks cost 3 AP against a 5–7 AP pool, so a
  character gets two actions, and *any* movement spends one of them.
- **Which makes the positional layer a bad trade.** Walking around a body to
  reach the rear arc is ~3 tiles = 3 AP = one attack, in exchange for
  backstab's +20% to-hit. Standing still and swinging twice is simply better.
  This is not a theory: the backstab e2e had to refill AP through
  `__combat.ap`, because after the walk the attack button was genuinely
  unaffordable and Playwright hung on a disabled button. The test was working
  around the economy.
- **Fractional AP already works.** Distance pricing means AP is tracked in
  tenths (`roundAp`) and the HUD already draws a half pip, so sub-1 costs need
  no new display work.
- **Footwear exists and is nearly empty.** `EQUIP_SLOTS` has had `shoes` since
  `EQUIPMENT_PLAN` M5, and exactly one item fills it (Warehouse Boots:
  `slipProof` + a little dodge).

## What we're building

1. **A cheaper rate.** Roughly two tiles per AP instead of one, so the *size*
   of the movement tax drops.
2. **The Pawn** — a talent granting a small per-turn budget that only movement
   may spend, drawn from before regular AP. This is what fixes the *shape*: a
   reposition stops competing with a swing.
3. **Frequent Flier** — a talent that never triggers opportunity attacks. The
   counterpart to the Pawn: one buys distance, the other buys the right to
   leave.
4. **Footwear as the variation lever.** Shoes carry a movement stat, giving
   that slot a job and putting character differences in gear rather than in an
   already-overloaded attribute.

## Design decisions (recommended, with alternatives considered)

**#1 — Keep ONE AP pool. Do not split movement into its own resource.**
The full MP/AP split (D&D 3.x/5e's economy — Solasta, Pathfinder turn-based,
Warhammer Chaos Gate, Owlcat's Rogue Trader, BG3) is the other mainstream
branch of the genre and would solve this outright.
**Rejected on identity:** this game is in the DOS2 branch, where every step is
priced and that pricing is the tension. A split converts the game to a
different tradition; the allowance below relieves the pressure without
changing what the game *is*. It is also perhaps a tenth of the work.

**#2 — Do NOT derive movement from Hustle.**
Hustle already drives max AP, dodge, and the initiative modifier. A fourth job
would make it the attribute you always take, which is the opposite of a build
choice. Movement efficiency lives in **gear**, not the attribute spread.

**#3 — The allowance is movement-only, and spent FIRST.**
A general "+1 AP per turn" would just be a bigger pool — more attacks, same
bad trade. Ring-fencing it to movement is the whole point: it buys
positioning and nothing else. Movement bills the allowance until it is dry,
then falls through to AP, so a long walk still costs real budget.

**#4 — The allowance is a TALENT, not a baseline.**
It is earned, the way The Pawn is in DOS2 — a class-track node you spend a
class point on, not something every character wakes up with. That makes
positional play a *build*: the character who invests can flank and backstab
routinely, and the one who doesn't still can, just at the full price.

This has a consequence worth stating plainly, because it decides what
milestone 1 is for: **talent-gating the allowance means the default character
still pays a swing to reposition.** So the rate change has to carry the
baseline on its own — it is not a warm-up for the talent, it is the part
everyone feels. The talent then takes a build from "can afford to reposition"
to "repositions every turn".

Mechanically it needs nothing new: class-track nodes already merge into
`sheet.talent.effects` (`effect: { talent: { … } }`), and combat already reads
that through `talentFxOf`. The Pawn is `{ freeMoveAp: 1 }` on a track node.

**#4b — Enemies read the same field.**
Because it rides `talentFxOf`, an enemy archetype can carry it too. Most
won't; giving it to one fast harasser type is a cheap way to make a specific
enemy feel different, and it keeps the rule symmetrical rather than a
player-only privilege.

**#5 — The allowance does NOT dodge opportunity attacks.**
Free-ish movement must not become free *escape*. Leaving a threatened tile
provokes exactly as it does now, whichever budget paid for the step. The two
systems are each other's counterweight: OAs are what stop a cheaper rate from
reviving kiting, and the allowance is what stops OAs from making melee a trap.

**#5b — Frequent Flier is the earned exception.**
A second talent, `noProvoke: true`: this character never triggers an
opportunity attack, from anyone, ever. It is deliberately the *only* way to
escape the rule in #5, which is what makes it worth a class point — and it
pairs with the Pawn as a movement family rather than duplicating it. The Pawn
buys you distance; Frequent Flier buys you the right to leave. Taking both is
a genuine skirmisher build; taking either alone is still useful.

Full immunity rather than a softer "your first disengage each turn is free"
because the softer version is invisible: the player cannot tell which of their
steps was the free one, and a rule you cannot see is a rule you cannot plan
around. Immunity is legible at a glance.

Mechanically it is a one-line gate in `combat.notifyStep`, which already owns
provoke resolution — before building the threat set, bail if the mover carries
the effect. It reads through the same `talentFxOf` accessor as everything
else, so an enemy archetype can carry it too.

**#6 — Footwear carries a COST MULTIPLIER, not a flat bonus.**
A `moveCost` stat on shoes multiplies into the existing `stepCost` product
beside gum's `moveCostMult`. Multiplying composes correctly with surfaces and
statuses (good boots partly offset a coffee spill); a flat "+2 tiles" would
not, and would need its own special case at every billing site.

**#7 — Surfaces get *relatively* harsher, and that is intended.**
Gum's 1.5× and a coffee spill's `slow` both bite harder against a smaller
base cost. Terrain mattering more is a feature of making movement cheaper —
otherwise the floor stops being a hazard worth respecting.

**#8 — Action costs are a SEPARATE milestone, deliberately last.**
Even at a quarter of today's rate you cannot reposition and still attack
twice, because two attacks *is* the whole pool. The real cause is granularity:
2–3 AP actions against a 5–7 AP pool gives a turn two beats. Dropping attacks
to 2 AP would give three. That is a bigger feel change than anything above and
touches every action, so it is milestone 4 — take it or leave it after
playing milestones 1–4.

## The data

A new block in `stats.js`, beside `HIT` and `PROGRESSION`:

```
MOVE = {
  COST_PER_TILE: 0.5,   // AP per tile on clean floor (was 1.0)
}
```

The allowance itself is content, not a constant: a talent effect
`freeMoveAp`, granted by a class-track node.

At `0.5` a walk around a body (~3 tiles) costs `1.5` AP instead of `3` — half
an attack rather than a whole one. That is the baseline every character gets,
and it is what makes backstab a defensible trade at all.

With the Pawn node taken (`freeMoveAp: 1`, so 2 free tiles), the same walk
costs `0.5` of real AP, and a Drone repositions behind a target *and* swings
twice. That is the build payoff.

Footwear gains one stat in `data/items.js`, in the existing `stats` vocabulary:

```
'warehouse-boots': { slot: 'shoes', stats: { slipProof: true, dodge: 0.05, moveCost: 0.85 } }
```

Numbers are first drafts, deferred to playtest like every other plan.

## The math

```
stepCost(x, z) = MOVE.COST_PER_TILE
               * surfaceSlow(x, z)          // 1 / surface.slow, as today
               * statusMoveMult(unit)       // gum 1.5, as today
               * gearMoveCost(unit)         // footwear, new

spend(d) = take from freeAp first, remainder from ap
```

## Architecture: where it lands

### Pure modules (unit-tested)

- **`src/stats.js`.** The `MOVE` block; `moveCost(sheet)` folding footwear's
  `moveCost` out of `equippedStats` the way `dmg`/`soak` already fold.
- **`src/pathfinding.js`.** `truncateByBudget` already takes a budget and a
  cost function and is the one place a route is priced. It grows a second
  budget: `truncateByBudget(points, { free, ap }, stepCost)` returning how much
  of each was spent. Every billing decision stays in this one pure function,
  which is what keeps the change small.

### PlayCanvas / DOM modules

- **`src/combat.js`.** `stepCost` gains the two new factors. Members and AI
  units carry `freeAp` alongside `ap`, refreshed in `beginTurn` (and for the
  AI in the `acting` state). `walkActive` and `aiAdvance` bill through the new
  `truncateByBudget` shape. The AP pip row grows a movement readout, and the
  hover cost tag distinguishes "free" steps from AP-spending ones — a player
  who cannot see the allowance will not plan around it.
- **`src/data/items.js`.** Footwear content: a `moveCost` on the boots, and
  one or two new shoes so the slot has a real choice in it.

### Persistence

None. `freeAp` is per-turn combat state, like `ap`. No `SAVE_VERSION` bump.

## Milestones (each a PR that keeps `npm test` + e2e green)

1. **The rate.** `MOVE.COST_PER_TILE` replaces the hard-coded 1, threaded
   through `stepCost` for player and AI. Everything else unchanged. Movement
   gets cheaper; the shape of a turn does not change yet. Unit tests pin the
   cost math including surfaces and gum.
2. **The Pawn.** A `freeMoveAp` talent effect, granted by a class-track node
   (the Mail Room's track is its obvious first home). `freeAp` on members and
   AI units, refreshed per turn from `talentFxOf`, spent before AP, movement
   only. `truncateByBudget` grows the two-budget shape. The HUD shows the
   allowance only for characters that have one, so it never advertises a
   resource a character does not own.
3. **Frequent Flier.** A `noProvoke` talent effect gating `notifyStep`. Small
   on its own — the work is the track node, the log line that tells the player
   why nothing swung at them, and the tests. Sequenced after the Pawn because
   it is only interesting once movement is worth doing.
   - *Where it lives:* mechanically it belongs on the mobile class (Mail
     Room), which is also where the Pawn wants to sit. The funnier reading is
     the **Middle Manager** — the one who is always at a conference and never
     in the building to be hit — and giving the slow tanky class an escape
     hatch is a better spread of power than piling both movement talents onto
     one track. Worth deciding before implementing.
4. **Footwear.** `moveCost` folds through `equippedStats`; boots get the stat;
   a second pair of shoes so the slot is a decision.
5. **Stretch — action granularity.** Re-price actions against the pool
   (attacks 3 → 2 AP) so a turn has three beats. Deliberately separable: play
   1–4 first and decide whether it is still needed.

## Testing

- **Unit:** `stepCost` composition (base × surface × status × gear); the
  two-budget spend order (allowance first, remainder from AP, never the
  reverse); a walk longer than both budgets truncates at the same point it
  does today; `moveCost` gear folding.
- **e2e:** at the new rate, reposition behind a foe and still afford an attack
  — the assertion the current backstab test has to fake with an AP refill,
  which should stop needing the fake. With the Pawn taken: reposition and
  afford TWO. The allowance cannot pay for an attack; gum still visibly taxes
  movement.
- **Regression:** the tactics specs stay green, in particular that
  opportunity attacks still fire on a step paid for out of the allowance.

## Risks and open questions

- **Cheaper movement revives kiting.** This is the risk the whole economy was
  guarding against. Opportunity attacks are the counterweight and they now
  exist — but if kiting still dominates in play, the lever to reach for is
  `TACTICS.REACTIONS_PER_ROUND` (more reactions) before re-raising the rate.
- **Frequent Flier is the one thing that can revive kiting.** Opportunity
  attacks are what license the cheaper rate, and this talent switches them off
  for one character. That is the point of a build, but it means the Frequent
  Flier is the build to watch first in playtest: if it dominates, the fix is
  the softer per-turn version from #5b, not deleting the talent.
- **The allowance could trivialise disengaging.** It still provokes, but a
  unit that can step out of reach for free every turn is a different fight.
  Watch whether melee enemies can ever hold contact against a Pawn build.
- **Is 1.0 the right grant?** Two tiles buys a flank or a step behind someone;
  it does not buy crossing a room. That is the intent, but it is the number
  most likely to be wrong.
- **Does the baseline rate alone do enough?** Since the allowance is now
  earned, milestone 1 is carrying the default experience by itself. If
  repositioning still feels unaffordable without the talent, the answer is to
  push `COST_PER_TILE` further down rather than to make the talent baseline —
  the talent should be a multiplier on a workable economy, not a fix for a
  broken one.
- **Fractional AP readability.** The pool already runs in tenths and the pips
  already draw halves, but "2.5 AP and 0.5 free" is more state than the corner
  readout shows today. If it reads badly, the fallback is integer movement
  points displayed separately — which is milestone 2 wearing a different hat.
- **Enemy pacing.** Cheaper movement means AI units close faster, which
  shortens the approach phase of a fight. May want `aiAdvance` to keep some
  distance discipline rather than always sprinting into contact.
