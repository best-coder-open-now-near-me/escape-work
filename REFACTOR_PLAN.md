# Refactor Plan — Breaking up the god files

Baseline: `claude/barrier-cover-attack-mechanics-02vjuo` @ `488e769`.

This doc is a *carve plan* for `src/combat.js` (4,702 lines) and `src/main.js`
(3,839 lines). It does not propose new mechanics. Where it must choose a target
shape, the choice is tagged per CLAUDE.md.

---

## Questions for the designer

**Q1. Is this a dedicated sweep, or carved opportunistically as features land?**

- **A (recommended) — dedicated sweep, feature-frozen on these two files.**
  Six or seven landings, each behaviour-preserving, each green on the existing
  suite before the next starts. Cost: combat feature work waits ~the length of
  the sweep, and any in-flight branch touching `combat.js` will conflict hard.
  Benefit: the carve actually finishes. The last three attempts recorded in
  `TODO.md` ("Carve `combat.js` at the documented seams") did not, because
  nothing forced the order.
- **B — opportunistic.** Each new combat feature carves out the seam it touches
  first. No freeze, no conflicts. But the closure keeps growing at the edges
  while the middle gets carved, and the two big undifferentiated regions
  (`drawTargets`, the input block) are exactly the ones no feature touches
  head-on — they'd never come out.

I'd pick A because the value here is *unit-testability of the combat rules*, and
that only arrives when a whole seam is out, not when half of one is.
`[proposed]` — the whole ordering below assumes A. Under B, sections M1/M2/M6
are still individually worth doing and the rest lapses.

**Q2. Behaviour-preserving carve, or carve-and-fix?**

`TODO.md` and `REVIEW.md` list ~30 open combat bugs, several of which
(`REVIEW.md` §1) exist *because* two responsibilities share closure state. A
carve will walk straight past them.

- **A (recommended) — pure carve; each landing provably changes nothing.**
  Bugs get filed against the new module and fixed after, with a unit test that
  could not have been written before. Slower to visible payoff; much easier to
  review and to bisect if something breaks in a fight.
- **B — fix as you go.** Fewer total passes over the same code. But a diff that
  moves 800 lines *and* changes three rules is not reviewable, and if combat
  feels different afterwards nobody can say which half did it.

Recommendation A. `[proposed]` — if B, the ordering stays but each landing grows
a "fixes" section and needs playtesting, not just a green suite.

**Q3. What is "done"? A line-count target, or a testability bar?**

- **A (recommended) — the bar is behavioural: every combat *rule* (does this hit,
  what does it cost, where can it reach, what does the AI pick) is callable from
  a unit test with plain objects. `combat.js` keeps only what needs a body, a
  panel, or the frame clock.** By that bar `combat.js` lands around 1,200–1,500
  lines and stops shrinking, which is fine.
- **B — a number ("nothing over 1,000 lines").** Easy to check, but it rewards
  splitting a file in half at an arbitrary line, which is how you get
  `combat-a.js` / `combat-b.js` importing each other.

Recommendation A; it's the bar `turn-order.js` already meets. `[proposed]`

**Q4. Does the combat DOM panel move into `ui/` now, or stay?**

`ARCHITECTURE.md` says a panel is a dumb VIEW and lives in `ui/`. `combat.js`
still builds its own previews, rings and dock chrome, and `TODO.md` has a
separate open item to collapse the two action bars into one. Moving combat's DOM
into `ui/` and unifying the bars are the *same* work, done once or twice.

- **A (recommended) — fold the bar-unification item into this sweep (M6).** One
  pass over that code, and the sweep ends with combat obeying the stated layering
  rule. Costs the most player-visible risk of any landing here.
- **B — leave the DOM alone; carve rules only.** Lower risk, and the sweep stays
  purely internal. `combat.js` keeps ~400 lines of DOM and the layering rule
  stays violated, with the bar item still open.

Recommendation A, but this is the one I'd most want a verdict on before starting
— it's the only landing a player could feel. `[proposed]`

---

## What is actually wrong

Both files are a single function-scope closure. `startCombat` (`combat.js:59`) is
~4,650 lines of one closure; `startGame` (`main.js:106`) is ~3,700. Every rule
inside them reads shared mutable locals (`active`, `members`, `armed`, `phase`,
`inCombat`, `sheet`, `enemies`, …) directly. Three consequences, in order of cost:

1. **Nothing in either file is unit-testable.** 18 unit suites cover the pure
   modules; zero cover a combat rule. The rules that *have* been pulled out —
   `tactics.js`, `powers.js`, `turn-order.js`, `initiative.js` — each got a real
   suite the day they landed. That is the whole argument.
2. **Cross-responsibility bugs.** `REVIEW.md` finds that nearly every confirmed
   combat bug is two responsibilities sharing a closure variable. The critical
   NaN soft-lock is the arming state and the click resolver disagreeing about
   what `armed` means.
3. **Duplication across the two closures.** Because neither exports anything, the
   same rule gets written twice: per-tile step rules three times
   (`main.js:2351`+, `combat.js:4033`, `actors.js`), reach/range tests twice,
   the surface→FX map twice, affordability twice.

### The seams that already exist

Both files are *sectioned* — the `// --- … ---` banners are honest, and the
sections mostly don't interleave. That's what makes this tractable: the carve
follows lines the author already drew.

`combat.js`, by banner:

| Lines | Section | ~size | Shape |
|---|---|---|---|
| 59–290 | setup, charm, join | 230 | closure state + world |
| 291–509 | movement allowance | 220 | **mostly pure** |
| 510–611 | FX vocabulary | 100 | needs `fx` |
| 612–696 | take-cover crouch | 85 | **mostly pure** |
| 697–805 | initiative order | 110 | already delegates |
| 806–869 | UI | 65 | DOM |
| 870–1857 | previews, rings, `drawTargets`, panel refresh | **990** | mixed — the worst block |
| 1858–1963 | `performOn` (every basic attack) | 105 | world |
| 1964–2758 | verb resolvers: displace, topple, break, cover, pull, dash, zone, control | **795** | plan/perform pairs |
| 2759–3641 | friendly verb, click handlers, tile click, action-bar rules | **880** | mixed |
| 3642–3803 | summon placement + turn-engine host | 160 | host iface |
| 3804–3966 | summons | 165 | world |
| 3967–4255 | opportunity attacks, `aiAdvance` | 290 | **AI, world-injected** |
| 4256–4702 | per-frame `update`, returned interface | 445 | frame clock |

Two blocks dominate: the preview/targeting block (990 lines, of which
`drawTargets` alone is 315) and the verb resolvers (795).

The verb resolvers have a *repeated internal shape* that nobody has named yet:
almost every one is a `<verb>PlanAt(...)` / `perform<Verb>(...)` pair —
`topplePlan`/`topple`, `breakPlanAt`/`performBreak`, `pullPlanFor`/`performPull`,
`crouchAt`/`performTakeCover`. The plan half is arithmetic over positions and
data; the perform half moves bodies and spends AP. That is the carve line, and
it's already drawn — it just hasn't been enforced.

`main.js` splits more cleanly, because its subsystems barely talk:

| Lines | Section | ~size |
|---|---|---|
| 195–570 | tuning, shops, summon roster, tile queries, hazard costs | 375 |
| 572–990 | game flow: desk, run start, lose, leader, explosion, ignite, walking | 420 |
| 991–1084 | doors | 95 |
| 1085–1256 | targeting/LOS/examine helpers | 170 |
| 1257–1397 | click dispatch + dialogue/recruitment | 140 |
| 1398–1670 | hotbar view-model, layout, assign menu | 275 |
| 1672–1860 | level-up allocation, leader switching, out-of-combat posting | 190 |
| 1861–2330 | `beginCombat`, combat triggers, out-of-combat topple/shove/cover | 470 |
| 2333–2553 | per-tile step rules | 220 |
| 2554–3140 | input: mouse, keys, Alt overlay | **585** |
| 3146–3445 | status carriers, footprints, follower movement | 300 |
| 3446–3839 | boot | 395 |

---

## The carve

Seven landings. Each is independently shippable, behaviour-preserving, and green
on `npm test` + the e2e suite before the next begins. Ordered by
value-per-unit-of-risk, not by file order.

### M1 — `combat-geometry.js` (pure) — *lowest risk, do first*

Pull the arithmetic that never touches a body: `cheb`, `reachOfUnit`,
`withinReach`/`canReach` (`combat.js:386–430`), `coneTest` (`:1283`),
`zoneCells` (`:2637`), `reachSpecOf`/`actRangeOf`/`verbReaches` (`:3216–3262`),
`swingPointAt` (`:3263`), slam-damage arithmetic, and the movement-allowance
math from the 291–509 block that doesn't move an actor.

Everything here takes `{x, z}` and data and returns numbers. It also kills the
first duplication: `main.js:1096 playerReaches` and `main.js:1113 canTakePart`
are the same questions asked out of combat.

~250 lines out of `combat.js`, ~40 out of `main.js`, one new unit suite.
No behaviour risk — these are referentially transparent.

### M2 — `step-rules.js` (pure) — *closes a whole bug class*

The Phase 5 TODO item, and the highest bug-value carve in the plan. One module
owning "what happens when a character enters this tile": surface effect, gum,
slip, hazard cost. Consumed by `main.js:2351–2553` (party members),
`combat.js:4033 notifyStep` (AI units) and `actors.js` (wanderers).

The three copies have already drifted into a confirmed double-slow bug
(`REVIEW.md`). Note this is the one landing where "behaviour-preserving" is
ill-defined — the three copies *disagree*, so unifying them necessarily picks a
winner. Pick the `main.js` version (it's the one the player experiences most) and
say so in the commit; file the differences the other two lose.

~220 lines out of `main.js`, ~85 out of `combat.js`, ~35 out of `actors.js`.

### M3 — `combat-verbs.js` (pure) — *the biggest rules win*

Split every `plan`/`perform` pair at its existing seam. The `plan` halves move
out: `topplePlan`, `aiTopplePlan`, `breakPlanAt`, `pullPlanFor`, `pullRefusal`,
`crouchAt`/`crouchAtEdges`, `dropOnto`'s target selection, `displaceBody`'s
destination + slam arithmetic, `summonSpotProblem`/`summonDropSpots`.

The `perform` halves stay in `combat.js` and shrink to: call the planner, refuse
with its reason, then move bodies and spend AP.

This is where `powers.js` was heading and stopped. Merge the new module into
`powers.js` rather than adding a sibling — `powers.js`'s own header says the
verb rules land there first, and two files both named "the verb rules that don't
need the world" is the duplication this sweep exists to remove. `[proposed]`

~350–400 lines out of `combat.js`. Meaningful test payoff: refusal reasons,
displacement destinations and topple targeting are all currently untestable and
all appear in the open bug list.

### M4 — `combat-ai.js` — *already world-injected*

`aiAdvance` (`:4162`), `pickTarget` (`:258`), `canEngage` (`:242`),
`standTilePath` (`:199`), `tryAiCrouch` (`:2416`), `aiAttack` (`:3877`),
`opportunityStrike` (`:4117`). These already read the world through a small set
of queries; they take a host, in the `turn-order.js` shape, rather than becoming
pure.

Do this *after* M1 and M3, because the AI is the largest consumer of both.

~290 lines out. Also the natural home for the `routeBeside`-vs-`standTilePath`
duplicate fix that `TODO.md` lists separately.

### M5 — `main.js` subsystems on the `shopping.js` pattern

Four independent extractions, in this order (each is small and none blocks the
others):

1. **`summons-runtime.js`** — `main.js:280–315`, `:539`, `:1789–1832`, plus the
   summon block in `combat.js:3804–3966`. The one subsystem genuinely split
   across both god files today.
2. **`hotbar.js`** (view-model only) — `main.js:1398–1670`. Feeds `ui/hud.js`,
   which already wants a view-model. Prerequisite for M6.
3. **`dialogue.js`** — `main.js:1317–1397` plus `recruitCompanion`.
4. **`doors.js`** — `main.js:991–1084`. Small, self-contained, no dependencies.

~700 lines out of `main.js`.

### M6 — the combat panel into `ui/`, and one action bar *(gated on Q4)*

Move combat's DOM out of `combat.js` — the 806–869 UI block, the refresh/panel
paths in 1611–1857, and the dock chrome — into `ui/`, and collapse the combat bar
into the persistent hotbar as `TODO.md` describes. `combat.js` is left supplying
`actionState`, `actionTip`, `scrambleEntries`, `pressAction`; `ui/hud.js` renders.

Depends on M5.2. Highest player-visible risk in the sweep, and the only landing
that needs real playtesting rather than a green suite. ~400 lines.

### M7 — previews and targeting

The last of the 990-line block: `drawTargets` (315 lines alone), the five
`show*Preview` functions, `handleHover`, `drawPreview`, `drawRing`.

Left for last deliberately. After M1 (geometry) and M3 (plans) this block loses
most of its rule content and becomes what it should be — a *renderer* over
answers computed elsewhere. Carving it first would mean moving the rules twice.
`aim-paint.js` and `hover.js` are the precedent for where the remainder goes;
some of `drawTargets` may simply *become* `hover.js` ring code, since
`ARCHITECTURE.md` already says `hover.js` owns every affordance and combat
drawing its own rings is the standing exception.

Expect a real judgement call here about how much survives. ~300–400 lines.

---

## Order, and what it costs

M1 → M2 → M3 → M4 → M5 → M6 → M7. M1/M2/M5 are near-zero risk. M3/M4 need the
e2e suite. M6/M7 need someone to play a fight.

Projected end state: `combat.js` ~1,300 lines (bodies, panels, the frame clock,
the returned interface), `main.js` ~2,000 (game state and flow — it is *supposed*
to see everything), plus ~6 new modules carrying ~1,800 lines of now-testable
rules and 4–6 new unit suites.

## Risks and open questions

- **Merge conflicts.** Any branch touching `combat.js` during the sweep conflicts
  badly. This is the real cost of Q1-A and the reason to sequence rather than
  parallelise.
- **The e2e suite is the only safety net for M3/M4/M6.** It is a smoke suite, not
  a behavioural spec. A carve that changes a refusal reason or a targeting edge
  case can pass it. Worth adding e2e coverage for the specific verbs *before*
  carving them, not after.
- **M2 cannot be behaviour-preserving** (the three copies disagree) — flagged
  above; it needs a verdict on which copy wins if the `main.js` default is wrong.
- **M7's boundary is genuinely unclear** until M1/M3 land. Estimated, not
  designed. Re-plan it once the rules are out.
- Not addressed here: `fx.js` (850), `god.js` (715), `editor.js` (613). All are
  large but *coherent* — one responsibility each, no shared-closure problem. They
  are not god files and this sweep should leave them alone.
