# Character Creation Plan

You currently do not create a character. You pick one. Six résumés slide past on
a desk, you press HIRE, and `createSheet(classId)` mints a character in which
every single field — name, body, colour, proportions, attributes, kit, talent,
starting gear — is a copy of the class. Two players who both hire the Mail Room
get byte-identical characters wearing the same rig, called the same thing.

This document is the implementation plan for making the front door a
**creation** instead of a selection: the class stays the job you picked, and
everything the class currently also decides *about the person doing that job*
becomes yours. No code yet.

## Where we are today

`onClassPicked` (`src/main.js:576`) is three lines of consequence:

```js
sheet = createSheet(classId);
party = createParty(sheet, player);
spawnPlayerModel();
```

Everything downstream of it resolves back through the class registry:

- **Name.** `createSheetFrom` sets `name: block.name` (`src/stats.js:190`), and
  for a picked class `block.name` *is* the class label — so `sheet.name` and
  `sheet.className` are the same string. Combat narrates you in the third
  person off `sheet.name` (`src/combat.js:2821`: "Mail Room catches the Manager
  off guard"), which reads like a job posting hitting somebody.
- **Body.** `sheet.model` is `CLASSES[classId].model`, and `normalizeSheet`
  (`src/party.js`) deliberately **re-derives it from the class on every load**,
  overwriting whatever was saved.
- **Look.** `sheetLook(sh)` (`src/main.js:387`) resolves appearance back
  through `CLASSES[sh.classId]?.look`. Only four of the six playable classes
  carry a `look` at all, and not one of them carries a `tint` — the sole tinted
  entry in the whole player-facing registry is the summoned Applicant
  (`src/data/classes.js:309`). The tint channel exists, is wired end to end
  (`dressUp` → `applyTint` → the portrait cache key), and is unused.
- **Numbers.** `attr` is the class's spread, and `base` is solved by
  `baseFrom` so the level-1 derived `maxHp`/`maxAp` reproduce the class's
  headline exactly (`src/stats.js:128`).
- **Rigs.** `assets/characters/` ships **twelve** `.glb` files. Six are worn by
  playable classes (`worker`, `veteran`, `hr`, `itsupport`, `midmanager`,
  `security`); the other six (`intern`, `manager`, `seniormanager`, `hrrep`,
  `regional`, `executive`) exist and are spoken for only by enemies and
  companions. Half the wardrobe is already paid for.

So the raw material is almost entirely present. What is missing is a screen that
lets you touch any of it, and one architectural fact standing in the way: **a
character's appearance is owned by its class, not by its sheet.**

## What we're building

- **A three-step onboarding flow** at boot, in the game's own register: you
  pick the job off the résumé desk (today's carousel, unchanged), then get
  photographed for a badge, then explain yourself in an exit interview. Skip it
  and you get exactly today's character.
- **Identity**: a name you type and pronouns you pick, both player-owned state,
  both read by systems that already narrate you by name.
- **Appearance**: choose your rig from the twelve that ship, tint it from a
  curated palette, and set two build dials — all of it moved off the class and
  onto the sheet, which is a refactor companions, summons and enemies get for
  free.
- **A two-point self-assessment**: spend two attribute points at creation
  through the *same* `spendAttrPoint` the level-up screen uses. No second point
  economy, no new math, and spending nothing reproduces today's numbers to the
  byte.
- **Backgrounds** (`data/backgrounds.js`): a mechanical axis orthogonal to
  class, composed entirely from effect shapes the engine already bakes
  (`attrBonus` / `talent` / `grantsAction`), so the whole axis is content.
- **Persistence**: save v7, additive — an existing save loads with no creation
  fields and behaves exactly as it does today.

## Design decisions (recommended, with alternatives considered)

| # | Decision | Recommendation | Why / alternatives |
|---|----------|----------------|--------------------|
| 1 | Flow shape | **Three steps: THE JOB (today's carousel, unchanged) → THE BADGE PHOTO (identity + appearance) → THE EXIT INTERVIEW (background + two points)**, driven by one `createCreationFlow` host that swaps step content inside a single overlay | The carousel is already the best-looking thing in the game and already renders a live 3D candidate on the spawn tile — steps 2 and 3 reuse that body rather than building a second preview. Three separate overlays were rejected: each teardown/rebuild costs a `.glb` reload (see #14). A single mega-form was rejected too — it buries the class pick, which is still the decision that matters most. |
| 2 | Skippability | **`#class=<id>` skips creation entirely** (today's express lane, byte-for-byte), plus a `Skip the paperwork` link on step 2 that accepts every default | `preselectedClass()` (`src/main.js:571`) exists precisely because browsing the carousel costs ~30s per slide under CI's software GL. Twenty-four of the twenty-five e2e specs reach the game through `bootAndPick` or `bootStash`, and **both navigate to `#class=<id>`** (`tests/e2e/helpers.js:55`, `:93`); the twenty-fifth is `editor.spec.js`, which boots `#editor` and never reaches the picker branch. Making that hash mean "hire with defaults" keeps essentially the whole suite untouched — see "What this breaks in the existing suite" for the two places it does not. |
| 3 | A name you type | **`sheet.name` becomes player-owned**, defaulting to the class label; `sheet.className` stays the job and remains what every rule reads | This looks like it contradicts PARTY_PLAN's "companions are not named characters" revision. It does not. That revision removed *authored* names from *data entries*, for two stated reasons: they were a second copy of `className` free to drift, and they asserted a state ("Nervous", "Veteran") the game never advances. Neither applies here. A typed name is not a copy of anything — it is the one string the game has no other source for — and it asserts nothing the rules must later honour. The revision's rule governs content the game writes; you are not content. |
| 4 | Pronouns | **Three options, they/them default**, stored as `sheet.pronouns` | Combat already narrates the party in the third person (`src/combat.js:2821`) and one line already says "**They** gather their things and go" (`src/combat.js:2452`) — the house voice is they/them today. A field makes that a choice instead of an accident. Rejected: inferring from the name (guesses wrong on a real person, which the neutral default never does) and a free-text field (nothing can consume arbitrary strings correctly). |
| 5 | Where `look` lives | **The sheet owns it.** `lookOf(sheet)` in `stats.js` returns `sheet.look` ?? the class's ?? the companion's; `sheetLook` in `main.js:387` is deleted and its callers point at the export | This is the load-bearing change and it pays down debt beyond creation: today the resolution rule lives in one closure inside `startGame`, so nothing outside `main.js` can ask what a character looks like — including `portraits.js`, which is handed the answer rather than asking for it. Moving it to the pure module makes it unit-testable, gives companions a per-character look for free, and is the seam a future companion-customization feature plugs into. |
| 6 | Rig choice | **Twelve rigs, all of them, chosen as `sheet.rig`**; `normalizeSheet` **validates** it against a `RIGS` registry instead of overwriting it | `normalizeSheet` currently re-derives `sheet.model` from the class every load, with a comment arguing model is "presentation derived from identity, not player state". That reasoning is sound and survives intact: its two goals are that art changes reach old saves and that a save can never name a `.glb` that no longer exists. Both hold if the re-derive becomes *validate-or-fall-back* — an unknown `rig` is dropped and the class model takes over. What it stops doing is overwriting a deliberate choice. |
| 7 | Tint | **A curated palette of eight swatches in `data/looks.js`**, stored as the resolved `[r,g,b]` triple on `sheet.look.tint` | A free RGB picker produces neon-green employees and a screenshot that reads as a bug. Eight swatches are office-plausible (the greys, the beiges, one regrettable teal), they lint, and they keep the portrait cache key (`model\|tint\|build`, `src/portraits.js`) to a bounded set. Storing the resolved triple rather than the swatch id means `lookOf` needs no registry lookup and old saves cannot break when the palette is re-tuned. |
| 8 | Build | **Two dials — Height and Heft — mapped onto `legs` and `torso`**, clamped to the ranges the shipped entries already use | `models.js` documents hard cautions: height belongs in `legs`, `1.9` was checked against the walk cycle, and `torso` must stay modest because a big Y stretch visibly distorts arms mid-clip. Exposing `legs`/`torso`/`head`/`arms` raw invites the player straight past those. Two named dials over checked ranges (`legs` 1.55–2.05, `torso` 1.0–1.4 — the span the shipped classes, companions and enemies already occupy) gives real silhouette variety with no new art and no new risk. `head`/`arms` stay authored-only. |
| 9 | Point-buy | **Two points, banked onto `attrPoints` and spent through `spendAttrPoint`** — literally the level-up function | Zero new math, zero second economy, and the level-up screen's stepper UI is reusable as-is. The alternative — a bespoke creation-time allocator writing `attr` directly — would have to re-derive `base`, and that is exactly the trap in #10. |
| 10 | The base invariant | **Build the sheet from the unmodified class first, then spend** | `baseFrom(maxHp, maxAp, attr)` solves the residual so that level-1 derived stats reproduce the class's headline numbers. Feeding a *modified* `attr` into `createSheetFrom` would re-solve `base` against the same headline `maxHp`/`ap` and **silently cancel every point you spent**. Creating from the pristine class and then spending through `spendAttrPoint` makes the invariant hold by construction: spend nothing, get today's character exactly. |
| 11 | The background axis | **`data/backgrounds.js`: eight "why are you still here" entries**, each an `effect` using only shapes `bakeNodeEffect` already understands | The class track proved the pattern — a node's effect is baked into `attr`/`actions`/`talent.effects` at spend time and every existing read site honours it with no systems change (`src/stats.js:646`). A background is that same object arriving at creation instead of at level 3. It makes the axis pure content, which is the one rule. |
| 12 | Backgrounds are swaps, not bonuses | **A background's `attrBonus` must sum to zero** — +1 somewhere, −1 somewhere else — and it is lint-enforced | `startGear` was introduced under an explicit curve-neutrality rule ("none of these touch maxHp/maxAp, so each class's headline HP/AP stay exact", `src/data/classes.js:24`). Eight free stat bonuses at creation would blow through that on day one and make one background correct. A swap is a real choice with a real cost and needs no rebalance. |
| 13 | Background gear | A background may name **one** `gear: { slot: itemId }`, applied **only to a slot the class left empty** | The class's `startGear` is its signature piece — the Drone's stress ball is characterization, not a stat. A background silently replacing it would delete the more specific statement. Filling an empty slot adds; overwriting a full one subtracts. |
| 14 | Preview cost | **One `.glb` load per rig change, and nothing else re-loads.** Tint and build mutate the live entity in place; no portrait renders during creation | This is the binding constraint, not a nicety: helpers.js measures carousel slides at "tens of seconds EACH" under CI's software GL, and `settleCamera` exists because eight wheel events cost ~45s of an ~85s test. A creation screen that reloads the rig per slider tick would be unshippable in CI and unpleasant in a browser. Mutating in place requires the two idempotency fixes in "Two rendering bugs" below — which is why they are M2, before any UI. |
| 15 | Portraits | **Creation renders zero portraits.** The badge photo *is* the live 3D body; the real portrait renders once at `spawnPlayerModel`, exactly as today | `portraits.js` caches on `model\|tint\|build`, so a custom look already gets its own correct entry — no collision, no change needed. But each render is a 128px readback behind a serialized queue; driving it from a slider would queue one per tick. The live body is already on screen and already correct. |
| 16 | Persistence | **Save v7, purely additive.** Absent fields default in `normalizeSheet`; no migration *invents* state | Follows the rule party.js states outright: v6's purse "is NEW state rather than migrated state, so an older save simply reads 0 — no invents-state-on-every-load hazard of the kind the v5 auto-equip needed a version gate for." Every creation field is new state. None needs a version gate. |
| 17 | Starting over | **`New Character` joins the game menu**, clearing progress and reloading | `showGameMenu` (`src/ui/screens.js:327`) already takes an items array, and `clearProgress()` already exists (`src/main.js:80`). Once creation is a real investment, "I want a different one" needs an answer that is not `localStorage.clear()` in the console. |
| 18 | What v1 refuses | **No respec, no faces/hair, no companion customization, no per-class creation variants, no name validation beyond a length clamp** | Faces and hair are art this repo does not have — the Kenney minis are one baked texture (`assets/characters/Textures/colormap.png`) and a seven-bone skeleton with no facial rig. The rest are all real features that get *easier* once `look` is sheet-owned, which is the argument for shipping the seam and not the sprawl. |

## The three steps

### Step 1 — THE JOB

Today's carousel, unchanged: `showClassPicker(CLASSES, ACTIONS, onPick, onEditor, onPreview)`.
The only edits are the hire button's label (`START AS MAIL ROOM` → `NEXT: PAPERWORK`)
and where its callback goes — into the flow host instead of straight into
`onClassPicked`. The element id stays `#pick-<classId>`, so `pickClass` in
`tests/e2e/helpers.js` keeps working with one added click at the end.

### Step 2 — THE BADGE PHOTO

The candidate you were just browsing stays exactly where they are, on the spawn
tile, on the turntable, under the same dollied-in camera. The résumé card is
replaced in place by a badge-shaped form:

- **Name.** A text input, prefilled with the class label. 24 characters, trimmed.
- **Pronouns.** Three chips: `she/her`, `he/him`, `they/them` (default).
- **Rig.** A row of twelve thumbnails — *names*, not renders, because rendering
  twelve rigs is the exact cost this design refuses. Clicking one reloads the
  preview body (the one place a `.glb` load is legitimate).
- **Tint.** Eight swatches. Applied to the live body instantly.
- **Height / Heft.** Two range sliders. Applied to the live body instantly.

The turntable keeps spinning through all of it, which is the whole point: every
control on this screen changes something you are already looking at.

### Step 3 — THE EXIT INTERVIEW

The badge is replaced by a single question — *So why are you still here?* — over
eight background cards, and beneath them a **SELF-ASSESSMENT** block: two points,
four attributes, the level-up screen's stepper rows. The confirm button reads
`SIGN THE PAPERWORK`.

Below the button, one generated sentence reading the character back:

> **Dana**, they/them, Mail Room. Reorg Survivor. Hustles more than most, and
> minds it less.

Rejected the temptation to make this a fourth step. A summary you cannot act on
is a dead click, and it belongs under the button that commits it.

## The character sheet: new fields

```js
name: 'Dana',              // EXISTS - stops being a copy of className
pronouns: 'they',          // NEW  'she' | 'he' | 'they'      default 'they'
rig: 'intern',             // NEW  a RIGS key                 absent = class model
look: {                    // NEW  sheet-owned appearance     absent = class look
  tint: [0.82, 0.86, 0.95],
  build: { legs: 1.78, torso: 1.12 },
},
background: 'reorg-survivor', // NEW  a BACKGROUNDS key       absent = none
```

`model` is unchanged in meaning and remains derived — `normalizeSheet` still
owns it, it just consults `rig` before the class. `className`, `attr`, `base`
and every other field are untouched. A background's effects are **baked** at
creation into `attr` / `actions` / `talent.effects`, exactly as a track node is,
so `background` is a record of what happened and is never re-applied on load.

## Architecture: where it lands

### New files

- **`src/data/looks.js`** — `RIGS` (the twelve `.glb` basenames with display
  names and a one-line description each) and `TINTS` (the eight swatches) and
  `BUILD_RANGE` (the two dials' clamps). Pure data, imports nothing, per the
  layering rule.
- **`src/data/backgrounds.js`** — `BACKGROUNDS`: the eight entries, each with an
  `effect` in the engine's existing vocabulary.
- **`src/creation.js`** — pure logic, no PlayCanvas, no DOM, unit-tested in
  isolation. Owns the draft model and the one function that turns a draft into
  a sheet.
- **`src/ui/creation.js`** — the DOM for steps 2 and 3, joining `ui/` as "what
  TAKES OVER the frame" alongside `screens.js`, re-exported through `ui.js`.
- **`tests/unit/creation.test.js`**, **`tests/e2e/creation.spec.js`**.

### Changed files, in dependency order

**`src/stats.js`** — three exports, no behavior change to any existing one.

```js
// Resolve a character's appearance: the sheet's own look wins, then the class's,
// then the companion's. Was a closure inside main.js's startGame, which meant
// nothing outside it - including portraits.js - could ask the question.
export function lookOf(sheet)                      // -> { tint?, build? } | null

// Bake an effect into a sheet in place. This is bakeNodeEffect, promoted from
// private to exported so creation (backgrounds) and progression (track nodes)
// spend one vocabulary instead of two. Contract is unchanged and unchanged for
// its existing caller: it does NOT recompute - that is the caller's job, because
// spendClassPoint needs to sample maxHp before and after to credit new capacity.
export function applyEffect(sheet, effect = {})    // -> void

// The attribute points a fresh character allocates at creation.
export const CREATION_POINTS = 2;
```

`spendClassPoint` loses its call to the private `bakeNodeEffect` and calls
`applyEffect` instead. Nothing else in the file moves.

**`src/data/classes.js`** — no code change. `PICKER_ONLY` gains no entries:
`look` stays on the class as the **default** a created character starts from and
may keep. The header comment gains a paragraph noting that `look` is now a
default rather than the last word.

**`src/creation.js`** — the new pure module.

```js
// A draft is what the creation screens edit; a sheet is what the game runs on.
// Keeping them separate is what lets every step be revisited without half-
// applying anything to a live character.
export function createDraft(classId)               // -> draft, class defaults filled in
export function setRig(draft, rigId)               // -> draft (validated against RIGS)
export function setTint(draft, tint)               // -> draft (validated against TINTS)
export function setBuild(draft, { legs, torso })   // -> draft (clamped to BUILD_RANGE)
export function setIdentity(draft, { name, pronouns })
export function setBackground(draft, bgId)
export function describeDraft(draft)               // -> the read-back sentence
export function draftValid(draft)                  // -> boolean

// Draft -> sheet. The ONE ordering that matters, and the reason this is a
// function and not four lines at a call site:
//   1. createSheet(classId)          - pristine, so baseFrom solves against the
//                                      class's own headline maxHp/ap
//   2. identity + look + rig onto the sheet
//   3. applyEffect(sheet, background.effect) + background gear into empty slots
//   4. attrPoints += CREATION_POINTS, then spendAttrPoint per allocation
//   5. recomputeDerived, then hp = maxHp
// Steps 1 and 4 are the invariant: spend nothing and this returns exactly what
// createSheet(classId) returns today.
export function createCharacter(draft)             // -> sheet
```

**`src/models.js`** — `applyCharacterProportions` becomes idempotent (see below).
Signature unchanged.

**`src/actors.js`** — `attach`'s `mats` entries gain a pristine `diffuse`
alongside the `emissive` they already clone; `applyTint` sets from that baseline
instead of multiplying the current value (see below). Signatures unchanged.

**`src/portraits.js`** — no change. `keyOf(model, look)` already keys on
`model|tint|build`, so a custom look is already a distinct cache entry.

**`src/party.js`** — `SAVE_VERSION` 6 → 7. `normalizeSheet` gains the defaults
and swaps the model re-derive for a validate-or-fall-back:

```js
sheet.pronouns ??= 'they';
sheet.background ??= null;
// A chosen rig is player state and survives the load - but it is still
// VALIDATED, never trusted: the reasons the model was re-derived unconditionally
// (art changes must reach old saves; a save must never name a .glb that is gone)
// both hold when an unknown rig simply falls back to the class's model.
if (sheet.rig && !RIGS[sheet.rig]) sheet.rig = null;
sheet.model = sheet.rig || block?.model || sheet.model;
```

`sheet.look` needs no line at all — absent is the correct value, and `lookOf`
falls through to the class.

**`src/ui/creation.js`** — the view, dumb per the `ui/` rule: a host-supplied
view-model in, rendered DOM out, clicks reported back. It reads no rules; the
read-back sentence arrives from `describeDraft`, the clamps from `BUILD_RANGE`,
the point count from `CREATION_POINTS`.

```js
export function showCreation(draft, { onRig, onTint, onBuild, onIdentity,
                                      onBackground, onSpend, onBack, onDone, onSkip })
```

The DOM contract, since e2e depends on it and `screens.js` already treats its
ids as an interface (`#pick-<id>`, `#resume-card`, `#lvlup-node-<id>`):

| id | what |
|---|---|
| `#creation-badge` | step 2's root — the badge form |
| `#creation-interview` | step 3's root |
| `#creation-name` | the name `<input>` |
| `#creation-pronoun-<she\|he\|they>` | the three chips |
| `#creation-rig-<rigId>` | one per `RIGS` key |
| `#creation-tint-<tintId>` | one per `TINTS` entry |
| `#creation-build-<legs\|torso>` | the two range inputs |
| `#creation-bg-<backgroundId>` | one per `BACKGROUNDS` key |
| `#creation-attr-<attr>` | the four steppers (mirrors `#lvlup-attr-<attr>`) |
| `#creation-back` / `#creation-next` | step navigation |
| `#creation-confirm` | SIGN THE PAPERWORK — commits |
| `#creation-skip` | accept every default and start immediately |

The overlay sits at **z-index 40**, the same layer `showClassPicker` and the
win/lose screens use (`src/ui/screens.js:12`, `:180`) — it is the same kind of
thing, it replaces the picker in the frame, and nothing else is on screen. It
hides `#hud` on entry and restores it on teardown, exactly as the picker's
`cleanup()` already does.

**`src/ui.js`** — one re-export line added to the `screens.js` block.

**`src/main.js`** — the smallest change in the plan, which is the point.

- `sheetLook` (defined `src/main.js:387`) is deleted; its three call sites —
  the ally-summon spawn (`:507`), `spawnPlayerModel` (`:524`) and the companion
  restore on a campaign load (`:2683`) — import `lookOf` from `stats.js`
  instead. Note the enemy and NPC spawns (`:448`, `:455`) already read
  `def.look` off the registry directly and are untouched; they are the reason
  `lookOf` takes a *sheet* and the registry path stays where it is.
- `previewClass(classId)` grows a second form, `previewLook(look)`, that applies
  build and tint to the **existing** preview entity without reloading it. The
  inline material-cloning block inside `previewClass` (`src/main.js:544`) is
  replaced by a call into the same baseline-aware tint path `actors.js` uses, so
  the picker and the floor stop keeping two copies of "how to tint a body".
- `onClassPicked(classId)` (`src/main.js:576`) becomes `onCharacterCreated(sheet)`; the branch that
  builds the sheet moves into `createCharacter`. The `#class=` express lane calls
  `onCharacterCreated(createSheet(id))` — the identical object today's code
  produces.
- The boot branch gains the flow host between the picker and the game.

## The new registries

### `src/data/looks.js`

```js
// The wardrobe: which rigs a player may wear, and the dials they may turn.
//
// Every .glb in assets/characters/ is here, including the six that only enemies
// and companions wear today - a rig is a body, not a role, and the class header
// already says to read the entry rather than the filename. Wearing the intern's
// rig does not make you an intern; it makes you someone who looks like that.
//
// TINTS is a CURATED palette, not a colour picker, for two reasons: a free RGB
// wheel produces neon employees that read as a rendering bug, and the portrait
// cache keys on the tint triple (portraits.js keyOf), so an unbounded space is
// an unbounded cache.
export const RIGS = {
  worker:       { name: 'Standard Issue',  blurb: 'The one they hand you.' },
  intern:       { name: 'Fresh',           blurb: 'Still owns a lanyard from orientation.' },
  veteran:      { name: 'Weathered',       blurb: 'Has outlasted four reorgs and one fire.' },
  hr:           { name: 'Pressed',         blurb: 'Ironed. Deliberately.' },
  midmanager:   { name: 'Business Casual', blurb: 'The quarter-zip is load-bearing.' },
  seniormanager:{ name: 'Escalated',       blurb: 'Dresses like the next role up.' },
  manager:      { name: 'Managerial',      blurb: 'Owns a blazer for the office.' },
  itsupport:    { name: 'Utility',         blurb: 'Pockets for things nobody else carries.' },
  security:     { name: 'Uniformed',       blurb: 'Comes with a radio you cannot use.' },
  hrrep:        { name: 'Compliant',       blurb: 'Nothing about it violates the handbook.' },
  regional:     { name: 'Visiting',        blurb: 'Flew in. Will fly out. Judged everything.' },
  executive:    { name: 'Upstairs',        blurb: 'You should not have this. Enjoy it.' },
};

// Multiplied against the rig's baked diffuse (actors.js applyTint), so every
// swatch is a value <= 1 - these darken and shift, they never brighten. Named
// for what an office actually contains.
export const TINTS = [
  { id: 'as-issued',  name: 'As Issued',   rgb: [1.00, 1.00, 1.00] },
  { id: 'charcoal',   name: 'Charcoal',    rgb: [0.62, 0.63, 0.68] },
  { id: 'navy',       name: 'Navy',        rgb: [0.58, 0.66, 0.86] },
  { id: 'oatmeal',    name: 'Oatmeal',     rgb: [0.94, 0.90, 0.80] },
  { id: 'sage',       name: 'Sage',        rgb: [0.76, 0.86, 0.74] },
  { id: 'rust',       name: 'Rust',        rgb: [0.88, 0.70, 0.58] },
  { id: 'plum',       name: 'Plum',        rgb: [0.78, 0.68, 0.82] },
  { id: 'teal',       name: 'Regrettable Teal', rgb: [0.62, 0.86, 0.86] },
];

// The two dials, and why they are two. models.js documents the cautions in
// full: height belongs in `legs` (arms and head hang off the torso and a big
// torso Y stretch runs along an arm's length once a clip rotates it down), and
// 1.9 legs was the value checked against the walk cycle in-game. These ranges
// are the span the SHIPPED entries already occupy - 1.68 to 2.05 on legs across
// classes/companions/enemies, 1.18 to 1.38 on torso - widened only to include
// the un-nudged default. `head` and `arms` stay authored-only: they are
// counter-scales that cancel the torso stretch, not silhouette dials.
export const BUILD_RANGE = {
  legs:  { min: 1.55, max: 2.05, step: 0.01, label: 'Height' },
  torso: { min: 1.00, max: 1.40, step: 0.01, label: 'Heft' },
};
```

### `src/data/backgrounds.js`

```js
// Why you are still here: the axis that is not your job.
//
// A background is the class track's node shape arriving at creation instead of
// at level 3 - same `effect` vocabulary, same bake-at-spend semantics (stats.js
// applyEffect), so the whole registry is content and no system knows it exists.
//
// `attrBonus` MUST sum to zero. A background is a SWAP - you are better at one
// thing because you were worse at another - not a bonus. Eight free stat lifts
// at creation would blow through the curve-neutrality rule startGear was
// introduced under (data/classes.js), and would make exactly one background
// correct. There is a lint.
//
// `gear` fills ONE equipment slot, and only a slot the class left empty. The
// class's own startGear is its signature piece; a background quietly replacing
// it would delete the more specific statement about who you are.
export const BACKGROUNDS = {
  'reorg-survivor': {
    name: 'Reorg Survivor',
    blurb: 'Four restructures. Same desk. Different logo on the mug each time.',
    line: 'Hustles more than most, and minds it less.',
    effect: { attrBonus: { hustle: 1, composure: -1 } },
  },
  'union-adjacent': {
    name: 'Union Adjacent',
    blurb: 'Never joined. Read the whole thing twice.',
    line: 'Hard to rattle, slower to swing.',
    effect: { attrBonus: { composure: 1, savvy: -1 } },
  },
  'night-shift': {
    name: 'Night Shift',
    blurb: 'Knows which lights are on a timer.',
    line: 'Tough, and unhurried about it.',
    effect: { attrBonus: { grit: 1, hustle: -1 } },
  },
  'temp-to-perm': {
    name: 'Temp To Perm',
    blurb: 'The perm part is still pending. It has been six years.',
    line: 'Quick on their feet. Thin-skinned about it.',
    effect: { attrBonus: { hustle: 1, grit: -1 } },
  },
  'former-smoker': {
    name: 'Former Smoker',
    blurb: 'Quit. Kept the lighter. You never know.',
    line: 'Still carries fire.',
    effect: { attrBonus: { savvy: 1, grit: -1 }, talent: { hasLighter: true } },
  },
  'mailroom-alum': {
    name: 'Mailroom Alum',
    blurb: 'Started downstairs. Everyone forgets that but you.',
    line: 'Folds a sharper airplane than the job requires.',
    effect: { attrBonus: { savvy: 1, composure: -1 }, talent: { paperDamageBonus: 1 } },
  },
  'wellness-committee': {
    name: 'Wellness Committee',
    blurb: 'Volunteered. Once. It is a life sentence.',
    line: 'Sturdy shoes, softer edges.',
    effect: { attrBonus: { grit: 1, savvy: -1 } },
    gear: { shoes: 'warehouse-boots' },
  },
  'expensed-it': {
    name: 'Expensed It',
    blurb: 'Filed it under "supplies". Nobody checked.',
    line: 'Came in with something they should not have.',
    effect: { attrBonus: { composure: 1, hustle: -1 } },
    gear: { trinket: 'stress-ball' },
  },
};
```

> Both `gear` ids resolve today: `warehouse-boots` (`src/data/items.js:194`,
> `slot: 'shoes'`) and `stress-ball` (`src/data/items.js:178`, `slot: 'trinket'`)
> — and note the second is also the Office Drone's own `startGear`, which is
> exactly the collision decision #13 exists to resolve: an Expensed It Drone
> keeps the class's stress ball and the background adds nothing, while any other
> class gets one.

## Two rendering bugs this feature has to fix first

Both are latent today because nothing ever dresses the same body twice. A build
slider and a tint swatch do exactly that, forty times a second. Neither is
speculative — both are visible in the current source.

**1. `applyCharacterProportions` accumulates its hip lift.** `src/models.js`:

```js
const tp = top.getLocalPosition();
top.setLocalPosition(tp.x, tp.y + hipY * (legs - 1), tp.z);
```

It reads the *current* local position and adds to it. Called once, correct.
Called again on the same entity, the character floats — and by the tenth slider
tick they are at the ceiling. The bone scales above it are `setLocalScale`, which
is absolute and therefore already idempotent; only the lift compounds. Fix:
capture the pristine Y on first application and always set from that baseline.
`GridActor.attach` reads that lift into `visualLift` and composes its bob and
lunge onto it, so this must be fixed *before* attach, not after — which it is,
since `dressUp` calls proportions first and comments on exactly that ordering.

**2. Tint multiplies the current diffuse.** `src/actors.js`:

```js
mat.diffuse.set(mat.diffuse.r * rgb[0], mat.diffuse.g * rgb[1], mat.diffuse.b * rgb[2]);
```

The same compounding: re-tinting an already-tinted material multiplies again,
so clicking through the swatches walks the body toward black instead of between
colours. `attach` already clones each material and stores `{ mat, emissive }` —
the emissive is kept precisely so damage flashes can return to a known baseline.
The fix is to keep the diffuse the same way and set from it. The identical bug
exists a second time in `previewClass`'s inline material loop
(`src/main.js:544`), which is its own argument for the two collapsing into one
path.

Neither fix changes any current behavior — every existing call site dresses each
body exactly once — which is what makes them a clean, independently shippable
milestone before any UI exists.

## What this breaks in the existing suite

The `#class=` express lane (#2) is what keeps this list to two entries instead of
twenty-five. Both are in the code whose *subject* is the picker, which is the
right place for the cost to land.

**1. `tests/e2e/helpers.js` — `pickClass`.** It clicks `#pick-<classId>` and
returns, on the assumption that the click starts the game. It now needs the two
confirm clicks that follow. This is the helper's whole purpose — it is already
documented as "the SLOW path... kept for the one spec whose subject is the
carousel itself" — so absorbing the flow here is exactly where it belongs:

```js
export async function pickClass(page, classId) {
  await expect(page.locator('#resume-card')).toBeVisible();
  for (let i = 0; i < 8; i++) {
    if (await page.locator(`#pick-${classId}`).count()) break;
    await page.click('#carousel-next');
  }
  await page.click(`#pick-${classId}`);
  await page.click('#creation-skip');   // accept every default - the sheet this
                                        // helper's callers expect is the class's
}
```

**2. `tests/e2e/game.spec.js:33` — "the class carousel browses every resume and
hires one".** It clicks `#pick-office-drone` and asserts `#stats` reads
`HP 22/22` on the next line. Under the flow that click advances to step 2, where
no sheet exists yet and `#stats` is still hidden — so the assertion fails on a
correct implementation. It takes the same `#creation-skip` click between the two
lines. Worth noting that this spec, not `classes.spec.js`, is the one that walks
the carousel; `classes.spec.js` boots through `bootAndPick`/`bootStash` like
everything else and is untouched.

**Not broken, though they look it.** Three specs call a bare `page.goto('/')`
with no hash — `economy.spec.js:134`, `party.spec.js:186`, and the carousel test
above. The first two are safe for a reason worth stating, because it is the
invariant the flow has to preserve: both have written a campaign save to
`localStorage` first, and a save takes the `restoredProgress` branch of
`startGame`, which never shows the picker at all. Creation intercepts exactly one
branch — no stash, no save, no `#class=` — and that branch is reached by one
test. `party.spec.js:186` also boots bare *before* writing its save, but asserts
nothing until after the reload, so the creation overlay it briefly renders is
ignored and then thrown away.

## Lints

New blocks in `tests/unit/levels.test.js`, beside the ones already there. The
file already imports `existsSync` and already asserts that every registry's
`model` names a real `.glb` (`tests/unit/levels.test.js:302`), so the rig lint is
an extension of a lint that exists rather than a new idea.

1. **Every `RIGS` key names a shipped `.glb`** — `assets/characters/<key>.glb`
   exists.
2. **Every playable class's `model` is a `RIGS` key** — otherwise a class ships
   a body creation cannot offer, and the two registries drift.
3. **Every `TINTS` rgb is three finite numbers in `[0, 1]`** — the multiply is
   against a baked diffuse, so a value above 1 blows out to white on some
   materials and not others.
4. **Every `BUILD_RANGE` span contains the `PROPORTIONS` default** — a dial whose
   range excludes the un-nudged value cannot express "leave it alone", and
   `legs` must stay at or under 2.05, the largest value any shipped entry uses.
5. **Every background's `attrBonus` sums to zero**, and every key is in
   `ATTR_KEYS`.
6. **Every background's `effect` uses only known shapes** — `attrBonus`,
   `talent`, `grantsAction` — and any `grantsAction` resolves in `ACTIONS`, the
   same assertion the class-track lint already makes
   (`tests/unit/levels.test.js:37`).
7. **Every background `talent` key is one the engine reads** — checked against
   the list ARCHITECTURE.md enumerates (`paperDamageBonus`, `paperAmmoDiscount`,
   `paperCutImmune`, `shockImmune`, `slipImmune`, `surfaceDamageResist`,
   `hasLighter`, `grantsAction`). This is the exact bug class the existing
   status-reference lint was written for: a typo that type-checks and silently
   never fires.
8. **Every background `gear` id is in `ITEMS`, and the item's own `slot`
   matches the key it is filed under.**

## Persistence

`SAVE_VERSION` 6 → 7. Every new field is new state, so nothing needs a version
gate — the shape party.js already documents:

- `pronouns` absent → `'they'`.
- `rig` absent → the class model, i.e. today's behavior exactly.
- `rig` present but unknown to `RIGS` → dropped, falls back to the class model.
  This is the rule that lets a rig be retired without stranding a save.
- `look` absent → `lookOf` falls through to the class's look, i.e. today's
  behavior exactly.
- `background` absent → `null`. Its effects were baked at creation and are
  already in `attr` / `actions` / `talent.effects`; the id is a record, never a
  re-application, which is the same decision `perks` made.
- `name` needs no line — `sheet.name ??= sheet.className` is already there and
  is already the correct default.

A v6 save therefore loads into a character indistinguishable from the one it
saved. That is the invariant the migration test asserts.

## Milestones (each a PR that keeps `npm test` + e2e green)

1. **Sheet-owned look — zero behavior change.** `lookOf(sheet)` exported from
   `stats.js`; `sheetLook` deleted from `main.js` and its four call sites
   repointed; `applyEffect` promoted out of `bakeNodeEffect` with
   `spendClassPoint` calling it. No UI, no new fields, no data. *Ships when*
   every existing unit and e2e test is green untouched and a unit test proves
   `lookOf` prefers a sheet's own look over its class's. *Test:*
   `stats.test.js` gains the three-way resolution cases.
2. **Idempotent dressing.** The hip-lift baseline in `models.js`, the pristine
   diffuse in `actors.js`, and `previewClass`'s inline tint block folded into
   the shared path. Still no UI. *Ships when* a unit test dresses one fake
   entity ten times and asserts the lift and the diffuse are identical to
   dressing it once. *Test:* `creation.test.js` (the module exists from here on
   even though the flow does not).
3. **The flow host + identity.** `creation.js` with `createDraft`/
   `createCharacter`, `ui/creation.js` with step 2's name and pronoun controls
   only, the boot branch, the `Skip the paperwork` link, save v7. Appearance and
   background controls are not built yet. This is also the milestone that pays
   the suite cost: `pickClass` and `game.spec.js:33` each gain their
   `#creation-skip` click (see "What this breaks"), and they are the only two
   edits the existing suite needs for the whole feature. *Ships when* you can
   type a name, boot with it, take a swing, and read your own name in the combat
   log — and `#class=office-drone` still produces a byte-identical sheet.
   *Test:* `creation.spec.js` in one boot; `party.test.js` gains the v6→v7 case.
4. **Appearance.** `data/looks.js`, the rig row, the tint swatches, the two
   build dials, `previewLook`, lints 1–4, the `normalizeSheet` validate-or-fall-back.
   *Ships when* a character created with a non-class rig and a tint spawns
   wearing both, survives a floor transition still wearing both, and the e2e
   spec has caused exactly one extra `.glb` load. *Test:* `creation.spec.js`
   grows the rig-and-tint case.
5. **Backgrounds + the self-assessment.** `data/backgrounds.js`, step 3, the two
   points through `spendAttrPoint`, background gear into empty slots, lints 5–8.
   *Ships when* a background's `attrBonus` is visible on the character sheet
   panel and a zero-allocation character's `maxHp`/`maxAp` still equal the
   class's headline numbers exactly. *Test:* `creation.test.js` asserts the
   invariant class by class.
6. **Polish.** The read-back sentence, `New Character` in the game menu, and the
   pronoun read in whatever narration lines want it. *Ships when* the flow reads
   as one bit end to end.

## Testing

**`tests/unit/creation.test.js`** — pure, no PlayCanvas, no DOM:

1. `createCharacter` on a draft with no allocations, no background, no look
   returns a sheet deep-equal to `createSheet(classId)` — asserted for **all six
   playable classes**. This is the whole invariant in one test.
2. Two allocations land as two attribute points and the derived `maxHp`/`maxAp`
   match what `spendAttrPoint` alone would produce.
3. A background's `attrBonus` swap leaves the sum of `attr` unchanged.
4. A background's `gear` fills an empty slot and does **not** displace a class's
   `startGear`.
5. `setBuild` clamps out-of-range input to `BUILD_RANGE` rather than trusting it.
6. `setRig` rejects an id not in `RIGS`, leaving the draft on the class model.
7. Dressing a stub entity ten times produces the same lift and diffuse as once
   (the M2 regression).
8. `describeDraft` names the character, pronouns, class and background.

**`tests/unit/stats.test.js`** — `lookOf` prefers sheet, then class, then
companion, then null; `applyEffect` bakes each shape; `spendClassPoint` is
unchanged through the refactor.

**`tests/unit/party.test.js`** — a v6 save loads with the creation defaults and
is otherwise identical; an unknown `rig` is dropped rather than stranding the
sheet on a missing `.glb`; a known `rig` **survives** the load that used to
overwrite it.

**`tests/unit/levels.test.js`** — the eight lints.

**`tests/e2e/creation.spec.js`** — deliberately **one boot, one extra `.glb`
load, zero portrait renders**, because that budget is the design constraint from
decision #14 and a test that ignores it proves nothing about CI:

1. Boot with no hash. Assert `#resume-card` is visible (step 1 is unchanged).
2. Click `#pick-office-drone`. Assert `#creation-badge` appears and
   `#resume-card` is gone.
3. Fill `#creation-name`, click `#creation-pronoun-they`.
4. Click **one** rig chip (`#creation-rig-intern`) — the single load this spec
   pays for — and one tint swatch. Assert the preview entity survived (no
   teardown).
5. Advance to step 3, pick `#creation-bg-night-shift`, spend both points on
   `#creation-attr-grit`.
6. Click `#creation-confirm`. Assert `window.__game.stats.name` is the typed
   name, `.model` is `intern`, `.attr.grit` is the class's grit + 2 + 1, and
   `.background` is `night-shift`.
7. Assert the express lane is intact: a second page with `#class=office-drone`
   never renders `#creation-badge`.

`window.__game` gains `get creationStep()` (null once the game is running) so
the spec can wait on a state rather than a timeout — the same affordance
`get inCombat` and `get levelId` already provide.

**The render budget, counted.** Today's carousel loads one `.glb` when the
picker opens. Creation adds: one load per rig change (the spec makes one) and
zero otherwise — tint and build mutate the live entity, which is what M2 exists
to make safe. Portraits are unchanged: `spawnPlayerModel` renders one at
confirm, exactly as it does today, and the cache key already distinguishes a
custom look. Net cost of the entire feature to the e2e suite: **one additional
`.glb` load, in one spec.** Every other spec still boots through `#class=` and
never sees the flow.

## Risks and what v1 does not build

**Risks.**

- **The `normalizeSheet` model re-derive is load-bearing and I am changing it.**
  Its comment is right about why it exists, and decision #6 keeps both of its
  goals — but this is the one change in the plan that can strand a save on a
  missing asset if the validation is wrong. It gets its own unit test and lint 1
  guards the other end.
- **`applyEffect` gains a second caller.** It is currently private and its
  contract (does not recompute; caller samples `maxHp` around it) is implicit.
  Exporting it makes that contract public and easy to get wrong. M1 writes it
  into the doc comment.
- **Eight backgrounds is eight balance surfaces** on top of six classes. The
  swap rule (#12) is what keeps that from being a rebalance — it is also the
  thing most likely to get quietly violated by a future entry, which is why it
  is lint 5 and not a comment.
- **Twelve rigs on the badge step is a lot of chips** for a screen that must not
  render any of them. If the row reads badly as text, the fallback is grouping
  them under the three silhouette families rather than rendering thumbnails.

**Not in v1.**

- **Respec.** One-way at creation, as at level-up. PROGRESSION_PLAN already
  notes "Visit HR to refile your paperwork" as the on-theme later add; creation
  should join that screen when it exists rather than inventing a second one.
- **Faces, hair, skin tone as separate axes.** The Kenney minis are one baked
  texture and a seven-bone skeleton with no facial rig. This is an art problem,
  not a code problem, and no amount of plumbing produces a face.
- **Companion customization.** M1 is what makes it possible — once `look` is
  sheet-owned, a companion's appearance is editable by construction — but the UI
  and the "when would you even do this" question are their own feature.
- **Per-class creation variants** (the Mail Room getting a step the Drone does
  not). Six creation flows is six things to test and the joke does not scale.
- **Name validation beyond a trim and a length clamp.** A profanity filter on a
  single-player game about hating your job would be funnier as a bug.
