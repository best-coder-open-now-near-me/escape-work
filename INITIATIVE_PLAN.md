# Shared Initiative Plan

Today a tie in the initiative roll is *broken*, silently and completely: two
tied allies act one after the other in a random order and never know they tied.
This plan replaces that with **shared turns** — an unbroken run of your side in
the turn order holds the floor together, you steer between them freely, and each
one ends its own turn. Baldur's Gate 3's model. This document is the
implementation plan: the decisions, the module-by-module changes, and the
milestone order. No code yet.

It sits on top of per-unit initiative (`initiative.js` + `turn-order.js`), which
already ships the hard half: one interleaved order for every combatant, a pure
turn engine over it, and — crucially — **per-member AP** (`m.ap`, `m.freeAp`,
refilled in `takeTurn`). Several members holding the floor at once already have
independent budgets. What's missing is a pointer that can name more than one
slot, and the ability to change who you're steering mid-turn.

## Questions for the designer

None open. All three questions this plan raised have been answered and now live
in the decisions table wearing `[ratified]` — the group cap (#6), the mid-group
joiner (#7), and what the strip shows (#10).

## Where we are today

`initiative.js` rolls **d20 + speed** once per combatant — `hustle` via
`effectiveAttr` for a member, `combat.ap` for an enemy — then sorts into a
strict total order:

1. `init` descending
2. **your side wins a tie** (`teamRank`)
3. a per-entry shuffle key drawn once, so same-team ties aren't input-order
   biased (`initiative.js:43`)

A tie is therefore fully resolved before the engine ever sees it. `turn-order.js`
walks that order with a single integer (`turnPtr`); `current` is exactly one
slot; `combat.js:takeTurn` (`combat.js:3100`) points one `active` member at the
HUD, the hotbar and the click handlers.

And the feature's other half is deliberately switched off:

- `ARCHITECTURE.md:338` — "IN combat there is no switching: proper per-unit
  initiative means you control each member only when their own turn comes up"
- `main.js:1665` — `switchLeader` returns early on `inCombat`, which is the
  single choke point behind the party-bar portrait (`main.js:1598`), Tab
  (`main.js:2878`), a click on a member's body (`main.js:1238`), the right-click
  menu (`main.js:2687`) and the debug `switchTo` (`main.js:3500`).

## What BG3 actually does (looked up, not recalled)

The trigger is **adjacency in the turn order, not an equal roll**. Per bg3.wiki:
"If two or more player-controlled characters are next to each other in the
initiative order, their initiative is shared. These characters can act in any
order and can even blend their turns together." Gamer Guides is explicit that
"characters don't need the same Initiative Score to share a turn."

Two facts that shaped this plan:

- **BG3 rolls d4 + DEX, not d20.** That is why exact ties are common enough
  there for a tie-only rule to be visible. We roll d20 against a 3–8 modifier.
  Simulating our own formula on real values (member hustle 5/3/8/6 vs coworker
  ap 5/5/6): a tied *ally pair* occurs in ~24% of 4v3 fights and ~4.5% of 2v2s;
  an *adjacent* ally run occurs in ~97% and ~49%. Tie-only grouping would build
  the whole machine for something most fights never show.
- **Each character's turn is ended explicitly.** Ending one hands control to
  the next un-acted character in the same slot; the group's turn ends when all
  of them are done `[stated]` (designer, 2026-07-30: "you have to end every
  single players turn explicitly in bg3"). An earlier draft of this plan claimed
  BG3 ends the whole group on one press — that came from Early Access-era forum
  threads, and the same forums carry the feature request asking for exactly the
  per-character behaviour the designer describes in the shipped game. The
  request was evidently granted; I could not find the patch note.

Marked as **reported, not verified**: bg3.wiki and the Larian forums both 403
the fetcher in this environment, so the following come from search snippets
only — the "close proximity" requirement, the 10-creature group cap, and the
absence of any group-wide end-turn button. Sources: [bg3.wiki
Initiative](https://bg3.wiki/wiki/Initiative), [Gamer Guides — Surprise, Rounds
and Initiative
Explained](https://www.gamerguides.com/baldurs-gate-3/guide/gameplay/getting-started/surprise-rounds-and-initiative-explained),
[Larian forums — Skipping shared
turns](https://forums.larian.com/ubbthreads.php?ubb=showflat&Number=747065),
[Fextralife — Initiative](https://baldursgate3.wiki.fextralife.com/Initiative).

## What we're building

- **A span pointer.** `turn-order.js` stops tracking one index and tracks a
  *run* of slots. A run of length 1 must behave byte-for-byte like today — that
  is the safety property the whole plan rests on.
- **Grouping on adjacency.** When a turn opens, the engine extends the run
  forward across consecutive slots on the same **player-controlled** side. Every
  slot in the run gets the full turn-open sequence (lifetime spend, status tick,
  dot, incapacitation check) as the group opens.
- **Steering.** You control one member of the group at a time and switch freely
  between the ones that haven't finished — via the party bar, Tab, or clicking
  their body. Switching re-keys the HUD/hotbar/click handlers exactly as
  `makeActive` already does.
- **Per-character End Turn.** Ends that member only and passes steering to the
  next un-acted member of the group. The group's turn ends — and initiative
  moves on — when every held member is done or unable to act.
- **A strip that shows it.** The initiative tracker brackets the group, marks
  who you're steering, and greys the ones already finished — and loses the
  rolled number it prints on every row today, which was only ever debug output
  in a player-facing panel.

Not in this plan: enemy-side grouping. The AI stays one unit at a time.

## Design decisions

| # | Decision | Status | Why / alternatives |
|---|----------|--------|--------------------|
| 1 | **Trigger: an unbroken run of player-controlled slots in the order shares a turn** — tied or not | `[stated]` (designer, 2026-07-30: "yeah i like adjacency, makes sense") | Matches BG3's real rule and fires in ~97% of 4v3 fights vs ~24% for tie-only. Same engine work either way. Tie-only was the original ask; our d20 (vs BG3's d4) makes exact ties too rare to justify the machinery. |
| 2 | **Each member ends its own turn**; ending one passes steering to the next un-acted member; the group's turn ends when all are done | `[stated]` (designer, 2026-07-30: "allies that are tied can be controlled at the same time until their 'end turn' buttons are both pressed", and that BG3 requires ending each explicitly) | No accidental skips — the failure mode Early-Access BG3 was criticised for. The auto-pass keeps the common case at one click per member with no portrait-hunting. |
| 3 | **Enemies do not group** — the AI drives one unit at a time | `[stated]` (designer, 2026-07-30: "one at a time is fine for ai right now") | The AI driver is a single `acting` state machine with animation waits (`combat.js:3712`); running several units' beats at once is the expensive half and buys the player only a faster enemy round. Decisions #1 and #4 leave the seam open. |
| 4 | **Grouping lives in `turn-order.js`**, as a span pointer + a `steer`/`finish` API; `combat.js` stays the host that answers about bodies and panels | `[proposed]` | Where the turn walk already lives, and pure — `ARCHITECTURE.md:130` names `turn-order.js` as the pattern for this. Computing the group in `combat.js` was considered: the engine owns `turnPtr`, the ticks and the lifetime spend, so grouping outside it means two things believing they own the pointer. |
| 5 | **No group-wide "end the rest" button** in v1 | `[proposed]` | It's the exact mechanism behind BG3's accidental-skip complaints, and decision #2's auto-pass already makes the fast path fast. Trivially addable later if a 4-wide group feels clicky. |
| 6 | **No cap on group size**, and no proximity requirement | `[ratified]` (designer, 2026-07-30: "no cap is fine") | BG3 reportedly gates on physical proximity and caps at 10; both are unverified, and a distance rule can silently split a group mid-turn as people move, which is unreadable on screen. Our party caps at 3, so the uncapped case only bites in summon-heavy fights, where the whole player side acting at once is the honest consequence of adjacency — see the risk below. Capping at 3, or breaking a group at a summon boundary, remain the fallbacks if it plays badly. |
| 7 | **A mid-fight joiner never joins an already-open group** — it acts from the next round | `[ratified]` (designer, 2026-07-30: "dont let mid-group summons act for now") | `turns.insert` can splice a fresh summon inside the live run. Letting it act immediately turns a 3-AP summon into a fresh 5-AP body this turn. The "for now" is noted: this is the conservative half of a balance question, not a permanent rule. |
| 8 | **The group is computed when the turn opens and frozen for its duration** | `[proposed]` | `turns.replace` changes a slot's *team* mid-round (a charmed coworker becomes a member, `TODO.md:820`). Recomputing live would grow or split the group under the player's hands mid-turn; freezing means a charm landing during your shared turn takes effect next round. |
| 9 | **In-combat steering does NOT go through `switchLeader`** | `[proposed]` | `switchLeader` re-keys the *out-of-combat* bindings (`sheet`, `player`, follower set, "You take point as…"). Combat already has the correct primitive in `makeActive`. The four entry points get routed to a new `combat.steer(member)` instead of having their `inCombat` guard loosened. |
| 10 | **The strip brackets the group**, marks the steered member and greys the finished — and **drops the rolled number from every row**, grouped or not | `[ratified]` (designer, 2026-07-30: "why would we even have numbers? itll be nothing but noise to the player") | The number reads as debug output left in: the ORDER already says who acts when, and a raw `(17)` teaches nothing about why. This plan had proposed keeping it to justify a group of unequal rolls — the bracket does that job without a number to interpret. Nothing testable depends on it: `party.spec.js:108` asserts `init` off the debug API (`__combat.order`), not the DOM, so the roll stays available for tests and the debug surface while leaving the player's view. Deletes the `(${s.init})` span at `combat.js:1567`. |
| 11 | **A member who can't act is finished individually**, not by ending the group's turn | `[proposed]` | `skipTurnFor` currently returns `'advance'` for a member (`combat.js:3119`), which under grouping would hand the whole group's turn away because one member is stunned. |
| 12 | **If the steered member drops, steering passes to another un-acted member** of the group; the group's turn continues | `[proposed]` | `notifyMemberDown` (`combat.js:1487`) currently ends the acting turn outright. Losing one member to a dot shouldn't cost the other two their turn. |

## Architecture: where it lands

### `src/turn-order.js` (pure, unit-tested)

The pointer becomes a span. `turnPtr` stays the *start* of the run; a new
`groupEnd` (or a held-set) names the rest. New surface:

- `current` → the slot you are steering. Keeps today's meaning for a group of 1.
- `held` → the slots holding the floor, in order.
- `steer(slot)` → change which held slot is current; refuses one that is
  finished or not held.
- `finish(slot)` → mark it done; auto-steer to the next un-acted held slot;
  when none remain, advance past the whole run and open the next turn.

`step()` grows a group-open loop: extend the run forward while the next slot is
player-controlled, then run the existing per-slot sequence **for each slot in
the run** — `lifetimeLeft`/`spendLifetime`, the `statusFx`/`tickTurn` pair,
`afterTick`, then `dot`. The ordering constraints already encoded there hold
per-slot and must not be re-ordered: incapacitation is read *before* the tick
(`turn-order.js:98`), and a dot that decides the fight settles win/lose
*before* the pointer moves (`turn-order.js:103`) — with a group, that check now
also has to run before the *group* is opened any further, or a party wipe
mid-group opens turns for corpses.

`STALL_LAPS`, `roundStart` on wrap, `insert`'s pointer arithmetic
(`idx <= turnPtr`), `replace`'s deliberate no-arithmetic, and `lead`'s
move-to-front all need re-reading against a span. `lead` is the easy one: the
ambusher takes the top roll alone, so its group is itself and the party groups
behind it naturally.

### `src/combat.js`

- `takeTurn` (`:3100`) opens *every* held member: full AP and movement
  allowance each, `phase = 'player'`, steer the first.
- A new `steer(member)` wraps `makeActive` (`:1471`) — which already clears
  `armed`/`pendingConfirm`/`pendingMelee`, re-points `party.active` and calls
  `refreshBar`. Dropping your aim on a steer switch is correct and worth a
  comment.
- `endBtn.onclick` (`:3087`) calls `turns.finish(currentSlot)` instead of
  `advance()`; the label becomes `End Turn — <name>` when the group is >1.
- `refresh` (`:1538` onward) reads the steered member for the AP pips and the
  turn title, and the held set for the strip and the button's enabled state.
- `skipTurnFor` (`:3119`) and `notifyMemberDown` (`:1487`) per decisions #11
  and #12.
- The debug/e2e surface (`:3913`) exposes `current` per slot plus new `held` /
  `finished` flags.

### `src/main.js`

Route the four switch entry points — party-bar portrait (`:1598`), Tab
(`:2878`), member body click (`:1238`), right-click menu (`:2687`) — to
`combat.steer(member)` when `inCombat`, falling through to `switchLeader` when
not. `switchLeader`'s own `inCombat` guard (`:1665`) stays exactly as it is.

### `ARCHITECTURE.md`

The **Switching** paragraph (`:334`–`:341`) is now wrong in its second half and
must be rewritten: switching inside a fight is allowed, but only among the
members currently holding a shared turn.

## Milestones (each a PR that keeps `npm test` + e2e green)

1. **The span pointer.** `turn-order.js` + `turn-order.test.js` only: a group of
   1 provably behaves as today, a run of player slots opens together, per-slot
   ticks and lifetime spends fire once each, `finish` auto-steers then advances.
   No UI, no `combat.js` change — grouping is off until combat asks for it.
2. **Combat holds a group.** `takeTurn` opens all held members, `endBtn` calls
   `finish`, `refresh` reads the steered member. Playable but steer-less: you
   act in the engine's order, and End Turn walks the group.
3. **Steering.** `combat.steer` + the four `main.js` entry points. This is the
   milestone that makes the feature feel like BG3.
4. **The strip.** Bracket, steered marker, finished rows greyed, and the rolled
   number gone from every row (decision #10):

   ```
   INITIATIVE
   ┌ SHARED TURN ─────────────
   │ ▸ Dana      · 14/18       <- steering
   │   Marcus    · 12/12   ✓   <- already ended its turn
   │   Priya     ·  9/15
   └──────────────────────────
       Manager   · 20/20
       Coworker  ·  8/14
   ```
5. **The edges.** Decisions #7, #8, #11, #12 — joiner into an open group, frozen
   membership across a charm, a stunned member inside a group, the steered
   member dropping. Each gets a test.

## Test impact

- `tests/unit/initiative.test.js` — **unchanged**. Grouping is not in the sort;
  the tie rules (player side first, then the shuffle key) still produce the
  strict order the group is read *off*. This is worth stating in the PR: the
  existing tie tests keep passing because nothing about ties changed.
- `tests/unit/turn-order.test.js` — the 27 existing tests are the regression
  net for "a group of 1 behaves as today," and gain the group cases from
  milestone 1.
- e2e: `summons.spec.js:75` does `order.find((s) => s.current)`, which silently
  takes the first of several once `current` can be multi-true. `helpers.js:384`
  `endTurnUntilPlayer` and the round-counting specs (`statuses.spec.js`,
  `tactics.spec.js`) change how many `endTurn()` calls a round takes — a shared
  turn needs one per held member. `party.spec.js:93` asserts the interleave
  directly and will need the group read.
- `portraits.spec.js:86` (a face per combatant) should survive the strip
  rework; worth checking rather than assuming.

## Risks and open questions

- **The group-open loop is where the bugs will be.** Four things happen per slot
  as a group opens (lifetime, tick, `afterTick`, dot), any of which can kill its
  owner or end the fight. Today those are guarded by a single-slot flow with
  comments explaining exactly why each order matters; a loop over slots has to
  preserve every one of those reasons, not just the code.
- **Initiative stops mattering in summon fights.** Decision #6 takes the no-cap
  route, so a summoner's fight puts the whole player side in one group and plays
  as side-vs-side. Accepted deliberately; watch a Human Resources fight before
  calling this shipped, and reach for the #6 fallbacks if it reads as a bug.
- **Stances still lapse correctly, probably.** `watching`/`guarding` expire in
  `afterTick` because "until your next turn" is a *position*, not a duration
  (the comment in the host block). Per-slot ticks preserve that, but a stance
  taken during a shared turn by a member whose next turn is the *same* shared
  slot deserves an explicit test.
- **Reactions** are refilled on `roundStart` and cleared per round
  (`TACTICS_PLAN` M2); grouping doesn't change round boundaries, so this should
  be untouched — confirm, don't assume.
- **`combat.js` is 4,000 lines** and `REVIEW.md:274` already flags it as at
  least seven responsibilities sharing one closure. This plan adds group state
  to it. Nothing here requires the split, but it makes the case louder.
