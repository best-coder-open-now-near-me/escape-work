# Refactor Plan — Breaking up the god files

Status: **the seven landings are done.** Baseline `488e769`; the work sits on
`claude/god-files-refactoring-yajg2s`.

This doc was written as a survey and a plan. It now doubles as the record of
what actually landed, where the plan was wrong, and what is deliberately left.

---

## Questions for the designer

These were asked before the work started and answered by the instruction to do
all of it. They are kept because the *answers* are load-bearing — anyone
reading this later needs to know which choices were made deliberately and which
were defaults.

**Q1. Dedicated sweep, or opportunistic?** — **Dedicated sweep** `[stated]`
(designer, "do it all completely, all phases"). Seven landings in order, each
behaviour-preserving, each green before the next.

**Q2. Behaviour-preserving carve, or carve-and-fix?** — **Pure carve**
`[proposed]`, and honoured: no rule changed except where two copies of a rule
disagreed and unifying them had to pick a winner. Those are named below.

**Q3. What is "done"?** — **The testability bar**, not a line count
`[proposed]`. Every combat rule is now callable from a unit test with plain
objects. See "What actually changed" for what that cost in lines, which is
less than projected and is the right answer anyway.

**Q4. Does combat's DOM move into `ui/` now?** — **Yes** `[proposed]`, landed
as M6. This was flagged as the one landing a player could feel; the e2e suite
covers it and the ids are unchanged.

---

## What was wrong

Both files were a single function-scope closure. `startCombat` was ~4,650 lines
of one; `startGame` ~3,700. Every rule inside read shared mutable locals
(`active`, `members`, `armed`, `phase`, `inCombat`, `sheet`, `enemies`)
directly. Three consequences:

1. **Nothing in either file was unit-testable.** 18 unit suites covered the
   pure modules; **zero** covered a combat rule.
2. **Cross-responsibility bugs.** `REVIEW.md` found that nearly every confirmed
   combat bug was two responsibilities sharing a closure variable.
3. **Duplication across the two closures.** Neither exported anything, so the
   same rule got written twice or three times.

The `// --- … ---` banners were honest and the sections barely interleaved,
which is what made the carve tractable: it followed lines the author had
already drawn.

---

## What landed

| | Module | Lines | Suite |
|---|---|---|---|
| M1 | `combat-geometry.js` | 178 | 15 |
| M2 | `step-rules.js` | 113 | 12 |
| M3 | `combat-plans.js` | 200 | 22 |
| M4 | `combat-ai.js` | 169 | 21 |
| M5 | `doors.js` + `door-edges.js`, `hotbar-model.js`, `dialogue.js`, `summon-rules.js` | 504 | 34 |
| M6 | `ui/combat.js` | 155 | — (e2e) |
| M7 | `combat-targeting.js` | 155 | 21 |

**494 unit tests → 619.** 125 new assertions, every one of them previously
unwritable.

### The rule duplications this closed

Four, each of which the code had already confessed to in a comment:

- **The per-tile step rules**, written three times (main.js for members and
  summons, combat.js for AI units, actors.js for wanderers). They had already
  drifted: the gum slow was SCALED in place on one side and DERIVED from a
  captured base on the other, so a wanderer gummed before a fight wore the slow
  twice. `step-rules.js` owns the decisions; the callers keep what genuinely
  differs (the narration is the player's voice, and a temp is not the player).
- **The summon spot rules**, written twice, with main.js's copy carrying a
  comment saying it was "deliberately the same four questions combat's
  `summonSpotProblem` asks, less the AP and uses". One ladder now, with the two
  fight-only legs simply absent outside a fight.
- **The pull's plan and its refusal**, two hand-parallel walks down the same
  five legs kept in step by a comment. One walk that returns either outcome —
  and a test asserting across every leg that exactly one comes back.
- **The verb classifier.** The target rings and the click each had their own
  ladder of `a.type` tests, in slightly different orders. This is not an
  analogy for the bug `REVIEW.md` records, it *is* that bug: a ranged weapon
  fell out of one ladder and not the other, so an out-of-range coworker rang
  red while the click walked the member in and fired. `verbKind` is the one
  ladder; both dispatch on it.

### Where the plan was wrong

- **M3 was going to merge into `powers.js`.** It didn't. `powers.js` is
  deliberately dependency-free — it answers what a verb refuses from plain
  numbers — and the plan halves need the world's *shape* (edges, walkability,
  cover). They sit one layer up in `combat-plans.js`, with the same
  no-world-object discipline.
- **Doors needed splitting in two.** `doors.js` narrates through `ui.js`, and a
  module that touches `window` at load cannot be imported by a node test. The
  edge arithmetic lives in `door-edges.js`.
- **The line-count projection was wrong.** `combat.js` went 4,702 → ~4,340 and
  `main.js` 3,839 → ~3,590, not the ~1,300/~2,000 projected. Two reasons, and
  neither is a shortfall: this codebase is ~37% comment by line and the
  reasoning travels with the rule it explains rather than being deleted, and a
  carve leaves *binding* code behind where it removes *rule* code. The bar that
  mattered (Q3) is met: every combat rule is now callable with plain objects.
- **M7 turned out to be about the click, not the previews.** After M1 and M3
  the preview block had lost most of its rule content, exactly as predicted —
  but the valuable thing left in it was the per-enemy verdict ladder and its
  disagreement with `handleEnemyClick`. That is where the effort went.

### One bug found and fixed in passing

M6 moved `createCombatReadout` into `ui/` and called it as `ui.createCombatReadout`
without `ui` being imported in `combat.js` — the unit suite could not see it
(nothing loads `combat.js`) and esbuild bundles it happily. Caught by reading
the imports; would have thrown on the first fight. It is the clearest argument
in this whole sweep for the e2e suite being the safety net for M6/M7, which is
what the original risk section said.

---

## What is deliberately left

- **The input block** in `main.js` (~585 lines) and the follower/step driver
  (~300). Both are coherent and neither is duplicated; they are size without
  tangle.
- **The debug surface** (`window.__combat`, `window.__game`) in both closures.
  On the TODO list as its own item.
- **`fx.js` (850), `god.js` (715), `editor.js` (613).** Large but coherent —
  one responsibility each, no shared-closure problem. Not god files.
- **The ~30 open combat bugs in `TODO.md`/`REVIEW.md`.** Untouched by design
  (Q2). Several are now reachable from a unit test for the first time; the
  targeting and AI suites are where their regressions belong.

## Risks that remain

- **The e2e suite is a smoke suite, not a behavioural spec.** It can pass a
  carve that changes a refusal reason. Worth adding verb-level e2e coverage
  before the *next* structural change, not after.
- **M2 could not be behaviour-preserving** — the three step-rule copies
  disagreed, so unifying picked a winner. `main.js`'s version won (it is the
  one the player experiences most). If a wanderer or an AI unit now feels
  different underfoot, that is where to look.
- **`verbKind` is a new single point of failure**, in the good sense: a new
  verb adds an arm there and both surfaces get it. Adding an `a.type` test to
  the rings or the click alone is how the drift it fixed started.
