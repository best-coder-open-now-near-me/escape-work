# Talent Plan (Talents as Their Own Axis)

A talent, today, is extra class stats with a name on them. It is declared
inside the class entry, it is fixed the moment you pick a class, and there is
exactly one. It cannot be anything *but* redundant with the class it lives in,
because nothing about it is a separate choice.

> "we need to remove any association a class has with a talent or any talent
> adjacent skills, theyre not entertwined"
> — designer, 2026-07-31 `[stated]`

This plan makes talents a **second, independent axis**: a shared registry
anybody can draw from, accumulated as you level, chosen rather than inherited.
It follows `POWERS_PLAN.md` and `PROGRESSION_PLAN.md` in shape, and honors the
`ARCHITECTURE.md` rule — **content is data, code is systems** — with one
deliberate exception, stated up front in decision 8.

**Supersedes:** `PROGRESSION_PLAN.md`'s account of the talent-choice system
(`:74`, "spend a class point to ... take a talent"). That version puts talents
*inside* the class track, which is the entanglement rather than the cure. The
class track survives, minus its talent nodes; see M2.

> **Status: M1 shipped.** Departures from the plan below:
> - **Nine entries, not ten.** Sharp Folds was cut on arrival - the
>   effect-duplication lint caught it granting `paperDamageBonus` alongside
>   Origami Specialist, and as a standalone pick it is that talent with a
>   smaller number. The "merge the thin ones upward" note under decision 11
>   predicted this; it just applied sooner than M4.
> - **Corner-Office Traction survived as `moveCost: 0.9`**, not `slipImmune` -
>   it could not keep the effect Warehouse Soles owns. It is the thinnest entry
>   in the file and is flagged in place as M4's problem.
> - **Smoker lost `grantsAction: 'cigarette'`** to POWERS_PLAN M9's heal audit,
>   leaving `hasLighter` - which was always its interesting half.
> - **`STARTING_TALENT_BY_CLASS` is the seed**, in `data/talents.js` rather
>   than on the class entries, so the lint forbidding a class talent cannot be
>   sidestepped by a `startTalent` field. It is marked for deletion by M2.
> - **`grantTalent(sheet, id)`** is the new seam in `stats.js`; `applyEffect`
>   itself needed no change, as predicted.

## Where we are today

- **Six named talents, one welded to each class.** `CLASSES[x].talent` is a
  `{ name, blurb, effects }` block. You do not choose it, you cannot change it,
  and no character can have a second one.

  | Class | Talent | Effects |
  |---|---|---|
  | Office Drone | Origami Specialist | `paperDamageBonus: 2`, `paperAmmoDiscount: 1`, `paperCutImmune`, `foldsAirplanes` |
  | Middle Manager | Smoker | `hasLighter: true`, `grantsAction: 'cigarette'` |
  | Mail Room | Warehouse Soles | `slipImmune: true` |
  | IT Support | ESD Steel-Toes | `shockImmune: true`, `grantsAction: 'kick'` |
  | Security | Incident Report | `surfaceDamageResist: 1` |
  | Human Resources | Open Door Policy | `{}` — **nothing at all** |

- **Four more talents hiding in the class tracks.** `effect: { talent: {...} }`
  nodes are talents without a title card: Sharp Folds (`paperDamageBonus: 1`),
  Corner-Office Traction (`slipImmune`), Frequent Flier (`noProvoke`), Always
  Moving (`freeMoveAp: 1`). The engine cannot tell these from the named ones —
  `applyEffect` merges both into the same `sheet.talent.effects` bag.

- **Which produces the tell.** `slipImmune` is the Mail Room's *entire* named
  talent, and it is also a one-point Middle Manager track node, and it is also
  on boots in `data/items.js`. **A Manager can buy the Mail Room's whole
  identity for one class point.** This is the same convergence `POWERS_PLAN`
  M2–M4 cleaned out of `grantsAction` — three classes granting `kick` — except
  it happened in the talent layer, where no lint looks.

- **The effect vocabulary is lopsided.** Eleven keys are honoured
  (`paperDamageBonus`, `paperAmmoDiscount`, `paperCutImmune`, `foldsAirplanes`,
  `slipImmune`, `shockImmune`, `hasLighter`, `noProvoke`, `freeMoveAp`,
  `surfaceDamageResist`, `grantsAction`). **Four of the eleven exist for one
  class's relationship with one surface.** All eleven have a live consumer —
  this is not dead data, it is data that grew where a class needed it.

- **One talent is empty.** Open Door Policy ships `effects: {}`. HR's talent
  does nothing, and has since it landed.

- **The good news.** The runtime already supports everything this plan needs.
  `applyEffect` (`stats.js:706`) merges a talent effect into
  `sheet.talent.effects` **accumulating numbers and replacing flags**, and
  falls back to the name `'Training'` when a sheet has no named talent. That
  function was written for track nodes and is, unmodified, a multi-talent
  merge. The hard part is already built.

## What we're building

- **`data/talents.js`** — a registry of talents nobody owns. `TALENTS[id] = {
  name, blurb, effects, requires?, tags? }`.
- **Talent points**, a third currency earned on level-up, spent on a **talent
  picker** open to the whole registry.
- **Classes stop declaring talents.** `CLASSES[x].talent` is deleted. So are
  the four `effect: { talent }` track nodes — they move into the registry.
- **A character accumulates several talents over a campaign**, and the merged
  effects bag is what the engine reads — exactly as it reads it today.
- **New effect kinds are in scope.** A talent may introduce a mechanic the
  eleven keys cannot express.

## Design decisions

| # | Decision | Status | Why / alternatives |
|---|----------|--------|--------------------|
| 1 | Talents are decoupled from classes entirely | `[stated]` | "we need to remove any association a class has with a talent or any talent adjacent skills, theyre not entertwined" (designer, 2026-07-31). |
| 2 | A character accumulates **several** talents, earned by level | `[ratified]` | Designer picked this over "one, picked at creation" (2026-07-31). It makes talents a build you assemble rather than a trait you are dealt, and it is the reading that most thoroughly severs the class tie — a talent you keep choosing cannot be a thing your class gave you. Costs a third currency and a spend screen; see decision 5 and risk 2. |
| 3 | The existing six are **freed, not retired** — anyone may take any | `[ratified]` | Designer picked this over rewriting them first and over replacing them wholesale (2026-07-31). A Security guard can be an Origami Specialist. Zero content lost, and the flavour survives; the balance objections (Open Door Policy is empty, Origami carries four effects) get handled as tuning in M4 rather than as a gate on shipping. |
| 4 | The four class-track talent nodes move to the registry | `[ratified]` | Designer picked this over leaving them (2026-07-31). "Never provoke" and "cannot slip" have nothing to do with a class's *verb*, which is what a track is for. Moving them is also the only thing that actually kills the `slipImmune` duplication — freeing the named talent alone would leave the Manager's node still buying it. |
| 5 | Talent points are their **own currency**, not class points | `[proposed]` | Spending class points on registry talents would re-couple the two axes through the wallet: every talent bought is a class power forgone, so the class still gates the talent. A separate currency is the only version where the two axes are genuinely independent. Alternative — talents cost class points — is cheaper and is what `PROGRESSION_PLAN` assumed; it is rejected for exactly the reason this plan exists. |
| 6 | Talents are gated by **prerequisites, never by class** | `[proposed]` | A talent may require an attribute threshold, another talent, or nothing. It may **not** require a `classId` — that would reintroduce the association through the back door, one entry at a time, and it is the failure mode this plan must lint against rather than trust itself about. |
| 7 | Talents stay **passive traits**, with `grantsAction` as the one exception | `[proposed]` | Two of the six already grant an action (`kick`, `cigarette`), so the exception is load-bearing and pre-existing. What talents should not become is a second action registry — if a talent's whole payload is a button, it is a power and belongs in `data/actions.js` behind a `needsTalent` gate, the way Paper Airplane already works. |
| 8 | New effect kinds are in scope | `[ratified]` | Designer chose this over "existing eleven keys only" (2026-07-31). It is the one place this plan knowingly departs from content-is-data: a new effect kind is engine work, so the talent list becomes a systems backlog and not purely a registry. Mitigated by decision 9. |
| 9 | Ship the registry on the existing vocabulary **first** | `[proposed]` | M1–M3 introduce no new effect kinds: the decoupling is provably pure data movement, and the suite can assert the merged effects bag is unchanged for an equivalent build. New kinds land in M5, afterwards, one at a time with their own tests. This is how decision 8 buys expressiveness without the first milestone becoming open-ended. |
| 11 | A talent is a **rare, defining pick — 2–3 a campaign** | `[ratified]` | "rare defining pick, like 2-3 a campaign" (designer, 2026-07-31), answering the open question this plan shipped with. Consequences run through the whole design and are spelled out below, because a 2–3 budget is a different system from a per-level drip, not a smaller one. |
| 10 | The merged `sheet.talent.effects` bag stays the read surface | `[proposed]` | Every consumer today — `talentFxOf`, the stepping and ignite checks, `combat.throwablesFor`, `stats.ammoCostOf` — reads the merged bag, not a talent list. Keeping that contract means **no read site changes**, and multiple talents work on day one. `sheet.talents` (the id list) is added alongside for the UI and for save integrity, not for the engine to consult. |

## The data

```js
// data/talents.js (NEW) - talents nobody owns.
//
// A talent is a NAME and an EFFECTS BAG. It is not attached to a class, it
// cannot require one (see the lint), and any character may hold several: the
// bags merge, numbers accumulating and flags replacing, exactly as
// stats.applyEffect already merges a track node's talent effect today.
export const TALENTS = {
  'origami-specialist': {
    name: 'Origami Specialist',
    blurb: 'Immune to paper cuts. Projectiles +2 damage; airplanes fold for 1 sheet.',
    effects: { paperDamageBonus: 2, paperAmmoDiscount: 1, paperCutImmune: true, foldsAirplanes: true },
  },
  'sharp-folds': {
    name: 'Sharp Folds',
    blurb: 'Crisper creases. Anything you throw bites a little deeper.',
    effects: { paperDamageBonus: 1 },   // was a Drone track node
  },
  'warehouse-soles': {
    name: 'Warehouse Soles',
    blurb: 'Eleven years of ignored wet-floor signs. You cannot slip. Ever.',
    effects: { slipImmune: true },      // ONE home for slipImmune now
  },
  'frequent-flier': {
    name: 'Frequent Flier',
    blurb: 'Always at a conference, never in the building to be hit.',
    effects: { noProvoke: true },       // was a Manager track node
  },
  // ...smoker, esd-steel-toes, incident-report, open-door-policy, always-moving
};
```

The six named talents and the four track nodes land as **ten registry entries**
with their effects unchanged. Nothing is re-tuned in the move: a migration that
also rebalances is a migration you cannot verify.

```js
// The sheet gains one field. The merged bag it already had is untouched.
sheet.talents = ['warehouse-soles', 'frequent-flier'];  // NEW: what you took
sheet.talent  = { name, blurb, effects };               // unchanged: the merge
sheet.talentPoints = 1;                                 // NEW: unspent
```

`sheet.talent` keeps its shape *on purpose*. It is what `talentFxOf` and eight
other read sites consult, and a character with three talents needs the same
merged answer a character with one gets today.

### What `sheet.talent.name` says once there are several

Today it names the one talent. With several, `applyEffect`'s existing fallback
already answers this: it writes `'Training'` when a sheet has no named talent
and keeps the first name otherwise. That is a placeholder, and it will read
badly on a sheet with four talents.

`[proposed]`: the **first** talent taken names the sheet, and the character
screen lists all of them. A character is "an Origami Specialist" the way they
are "IT Support" — one headline, a fuller record underneath. Alternative
(a generated summary, "Origami Specialist +3") was considered and rejected as
a label nobody would read.

## What "2–3 a campaign" does to the rest of the plan

Decision 11 is not a tuning number, it is the system's shape. Four things fall
out of it, and one of them contradicts something written above.

**A talent must be worth a third of your build.** Ten entries carried over
unchanged, and several of them are single-flag utilities — `slipImmune`,
`noProvoke`, `freeMoveAp: 1`. Those are fine as one node in a five-node track
you buy out. As **one of the three things that define a character for an entire
campaign**, "you cannot slip" is thin. At this budget every entry has to be a
*build*, not a modifier.

This changes M4 from a balance pass into a **content pass**, and moves the
pressure onto the wrong end: Origami Specialist carrying four effects stops
being the outlier that needs trimming and starts being the template everything
else should reach. `[proposed]` — the freed four (Sharp Folds, Corner-Office
Traction, Frequent Flier, Always Moving) should be **merged upward into fuller
talents rather than shipped as standalone picks**. Frequent Flier plus Always
Moving is a coherent "never in the building" talent; alone, each is a nudge.

**The registry wants to be small and sharp, not broad.** A 2–3 budget means a
player sees perhaps 15% of the list per campaign. Twenty thin entries would
mean most are never taken and none are memorable; **eight to twelve strong
ones** makes each pick a real fork and each playthrough visibly different. Ten
entries is coincidentally the right *size* — it is the *weight* that is off.

**Prerequisites get less useful, and opportunity cost gets more.** Decision 6
leaned on `requires` chains to stop convergence. Chains need depth to bite, and
there is no depth in a 2–3 budget — you would spend your whole allowance
climbing one. The real anti-convergence lever here is that **taking one talent
means never taking two others**, which is doing the work on its own. Keep
`requires` in the schema for attribute thresholds; stop expecting it to carry
balance. Risk 1 is downgraded accordingly.

**M1's seeding is now a real decision, not a no-op.** M1 seeds every character
with the talents their class used to grant, so behaviour is identical. Under
decision 11 that seed is **one of your two or three**, spent before you chose
anything. That is the right default (it preserves existing characters exactly),
but M2 has to decide whether the seeded talent is refundable when the picker
arrives, or whether a class's old talent is simply your first pick. `[proposed]`:
**refundable once**, at the moment the picker first opens, so no existing save
is quietly down a third of its build.

## The talent lint

`data/classes.js` opens with an essay on adjectives strapped onto our people —
a state asserted in data that no rule enforces, drifting silently. The class
talent is that failure at the top of every class entry, and the reason it went
unnoticed for so long is that **nothing checked it**. So this plan ships its
guard in the same milestone as its change, not after:

- No `CLASSES` entry carries a `talent` key. (Deletes the association.)
- No `TALENTS` entry has a `requires` naming a `classId`. (Stops it growing
  back one talent at a time — decision 6.)
- No `track` node carries an `effect.talent`. (Keeps tracks about class verbs.)
- No effect key appears in more than one talent **and** a track node. (The
  `slipImmune` case: one home per effect, or state why in the entry.)
- Every `TALENTS[x].effects` key is one the engine actually honours, checked
  against an exported whitelist. (Decision 8 opens the vocabulary; this is what
  stops a typo becoming a talent that silently does nothing — which is how
  Open Door Policy shipped empty.)

## Architecture: where it lands

- **`data/talents.js`** (NEW) — the registry. Content only.
- **`data/classes.js`** — six `talent` blocks deleted, four track nodes
  removed. Content only, and it is the whole of decision 1.
- **`src/stats.js`** — `applyEffect` needs **no change** (it already merges).
  New: `talentAvailable(sheet, id)` beside `nodeAvailable`, and
  `spendTalentPoint(sheet, id)` beside `spendClassPoint`, both mirroring the
  existing shapes. `createSheetFrom` drops the `block.talent?.effects
  ?.grantsAction` special case (`stats.js:215`) — a class no longer has a
  talent to read.
- **`src/party.js`** — `SAVE_VERSION` 8 → 9. A v8 character has a class talent
  baked into `sheet.talent.effects`; the migration seeds `sheet.talents` with
  the registry id matching their old class talent, so a saved Mail Room keeps
  Warehouse Soles **and it is now a talent they hold** rather than one their
  class implies. This is a migration that *defaults* state rather than
  inventing it, per the rule at `party.js:82`.
- **`src/ui/menus.js`** — the talent picker: the registry, what you hold, what
  you can afford, what a prerequisite blocks. Reuses the level-up screen's
  shape rather than adding a second one.
- **`src/ui/hud.js`** — the character screen lists talents held. Note the
  comment at `hud.js:14` distinguishes the class talent from temporary buffs;
  that distinction survives, the word "class" does not.
- **Nothing in `src/combat.js` or `src/main.js`.** Every talent read site
  consults the merged bag, which does not change shape. **If M1's diff touches
  combat, the seam is wrong** — the same stop-and-re-cut rule `POWERS_PLAN`
  risk 1 sets for `powers.js`.

## Milestones (each a PR that keeps `npm test` + e2e green)

1. **The registry, and the association deleted.** `data/talents.js` with all
   ten entries; `CLASSES` talent blocks and the four track nodes removed; the
   save migration; the lint. **No picker yet** — every character starts with
   the talents their class used to grant, seeded at creation, so behaviour is
   *identical* and the diff is provably a move. This is the milestone that does
   the thing the designer asked for; everything after it is the payoff.
2. **Talent points and the picker.** The third currency, `spendTalentPoint`,
   the screen. Now the seeded starting talents become a *choice* instead: a new
   character picks their first from the whole registry. `PROGRESSION_PLAN`'s
   class-track version of talent choice is deleted rather than left as a second
   answer.
3. **The character screen shows a build.** Talents held, what they do, what
   they cost. The first milestone where the second axis is visible to a player
   rather than true in the data.
4. **The content pass** (was: the tuning pass — decision 11 changed its job).
   Every entry gets weighed as *one of a character's three*, which means
   levelling entries **up** rather than trimming the big one: Open Door Policy
   gets a real effect (its blurb has promised a summon-scaling one since it
   landed, `PROGRESSION_PLAN:59` sketches it), and the thin freed nodes merge
   into fuller talents. Deliberately after the decoupling, not before:
   balancing a talent while it is still class property means balancing the
   class.
5. **New effect kinds** (decision 8), one at a time, each with its own tests.
   The backlog this opens is a feature; the sequencing is what keeps it from
   swallowing M1.

## Testing

- **Unit (`tests/unit/talents.test.js`, NEW)** — the lint assertions above; the
  merge (two talents with `paperDamageBonus` accumulate to 3, two with
  `slipImmune` stay `true`); prerequisites; that spending a point twice on the
  same talent is refused.
- **Unit (`tests/unit/stats.test.js`)** — the **equivalence** test that makes
  M1 verifiable: a sheet built from a class under the old shape and a sheet
  holding the freed talent produce an *identical* `sheet.talent.effects`. If
  this fails, the move re-tuned something.
- **Unit (`tests/unit/party.test.js`)** — a v8 save loads with `sheet.talents`
  populated and its merged effects unchanged; a v9 save round-trips.
- **E2E (`tests/e2e/progression.spec.js`)** — take a talent on a class that
  never had it (a Security guard picks up Origami Specialist), and confirm the
  Paper Airplane appears on their bar — the sharpest possible proof the axes
  are separate, since `foldsAirplanes` gates it through `needsTalent` and has
  been Drone-only since it shipped.

## Risks and open questions

1. **Any character can now take any talent, so builds converge on the best
   ones.** The old system's one virtue was that it forced variety by fiat.
   *Downgraded by decision 11*: at 2–3 picks a campaign, opportunity cost does
   most of this work by itself — taking one talent means never taking two
   others. Watch it from M2, but the lever is making the alternatives strong,
   not gating them.
2. **A third currency is a third thing to explain on the level-up screen.**
   Attribute points, class points, talent points. `PROGRESSION_PLAN` decision 2
   already committed to player-allocated everything, so this is more of the
   same rather than a new idea — but three pools on one screen is where it
   stops being legible. If it does, merging talent points *into* class points
   is the retreat, and it costs decision 5.
3. ~~**Open: how many talent points, and how often?**~~ **Answered** —
   decision 11, 2–3 a campaign. What it leaves open is narrower and belongs to
   `PROGRESSION_PLAN`: *which* levels grant one. Front-loading (levels 1/3/5)
   means the build is set before the floors that test it; back-loading means
   most of the campaign is played on the starting kit. Recommend **1 / mid /
   late** so every act changes the character once.
4. **Companions have talents too.** `data/companions.js` has one with
   `talent: null` ("too new for a talent — fresh eyes, no habits"), which is a
   deliberate characterisation that this plan turns into a mechanical state
   (no talents yet, points to spend). That reads *better*, but somebody should
   confirm the companions' starting talents rather than letting the migration
   pick.
5. **`POWERS_PLAN` M9 depends on one talent's payload.** Decision 20 there
   retires `cigarette` from the Smoker talent as part of the heal audit. If M9
   lands first, this plan's registry carries a Smoker with `hasLighter` alone;
   if this lands first, M9 edits `data/talents.js` instead of
   `data/classes.js`. Either order works — they must not be in flight at once.
