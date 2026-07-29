# Character Creation — Damage Report and Rework Plan

This document replaces the plan of the same name that shipped its code but never
shipped itself. `CHARACTER_PLAN.md` is cited by twenty sites across `src/`,
`tests/`, `TODO.md` and `REVIEW.md`; until now it existed only on the unmerged
branch `claude/custom-character-creation-3ga2ni`. Every citation pointed at
nothing, which is how a document full of untagged guesses became the project's
account of what the designer wanted.

---

## Questions for the designer

**Q1 — The five invented enemies. Burn them, or are they the opposition and
therefore exempt?**

Five characters in `data/enemies.js` are not one of our people and never claim
to be: they carry their own name, their own rig and their own stat block, with
no `classId` at all.

| Entry | Name | Rig | On a map? |
|---|---|---|---|
| `manager` | The Manager | `manager.glb` | level1, level2 |
| `executive` | The Executive | `executive.glb` | level2 |
| `hr` | HR Representative | `hrrep.glb` | level1, level2 |
| `senior-manager` | Senior Manager | `seniormanager.glb` | level2 |
| `regional-executive` | Regional Executive | `regional.glb` | never placed |

- **A — They are inventions; fold them into our people.** Each becomes a
  class-backed entry the way `security-guard` already is (`classId: 'security'`,
  told apart by `look.build` alone). The Manager and Senior Manager become
  Middle Managers; HR Representative becomes Human Resources. The Executive and
  Regional Executive have no class to fold into and would need one, or would
  need to go. **This frees five rigs**, which is the only way the custom
  character gets a wardrobe bigger than one body.
- **B — Enemies are THEM, not us; leave them.** "Our people" means the party
  side, and the antagonists are supposed to be a separate cast. Costs nothing,
  but the custom character then has exactly one body available (`intern.glb`,
  once Q-adjacent fix M1 lands) and the wardrobe is a list of one.
- **C — Split it: the two bosses stay, the three middle ones fold.** The
  Manager and The Executive are the floor-enders and carry the progression;
  Senior Manager, HR Representative and Regional Executive are just variations
  of people we already have. Frees three rigs.

**I'd pick C**, because it draws the line where your objection actually falls:
"Senior Manager" and "HR Representative" are variations of Middle Manager and
Human Resources, which is the thing you said you never want to see. A boss with
a name and a floor to end is a different kind of object. But this is your call
and the whole enemy roster hangs on it — **nothing in M1 below touches enemies
until you answer.**

**Q2 — The Applicant.** `classes.js` carries a seventh entry, `applicant`
(`playable: false`), used as the summon archetype for HR's Post the Role. It
wears the Office Drone's rig washed out pale, and it is deliberately anonymous —
a swarm, not a person. Is an anonymous summon "our people" (fine as-is), or is
it another invented persona (in which case summons need to be something else
entirely, and HR's primary verb needs rethinking)? **Recommend: fine as-is** —
it is explicitly nobody, which is the opposite failure from the intern.

**Q3 — Pronouns.** You listed name, colour, height, heft and backgrounds for
removal and did not mention the pronoun chips. They are one row of three, the
narration already consumes them (`combat.js` speaks the party in third person),
and they are not a variation on a character. **Recommend: keep on both paths**
— tagged `[proposed]`, trivially reversible if you want them gone too.

---

## What happened

The failure is the one `CLAUDE.md` exists to prevent, and it ran the full
distance.

The original plan opened its decisions table with the header **"Design
decisions (recommended, with alternatives considered)"** and listed eighteen
rows. Not one is attributed to you. Every one is the document's own guess, and
the table's own framing says so — "recommended" is the word for a proposal.
Under the house rule those eighteen rows are `[proposed]`, every one of them.

They were then built. Six milestone commits (`7575b31`, `cddb28e`, `ee81835`,
`6f69e1f`, `afc0661`, and the merges around them) shipped the guesses as
features, and the guesses became the code's account of itself: `creation.js:3`
now states as fact that "today you do not create a character, you pick one" —
framing selection as the problem to be solved, which was the plan's premise,
not yours. `TODO.md` promoted the same table into a worklist. `REVIEW.md` cites
it. The e2e helper `pickClass` was edited so that every one of the suite's
boots clicks through the creation screen. At no point did anybody ask.

The specific presumption you objected to first — **that picking a character
means entering customization** — is decision #1 in that table, justified on the
grounds that "the carousel is already the best-looking thing in the game." That
is an aesthetic observation about a screen, used to settle a question about what
the game's front door *is*.

---

## The complete cast

Every character-shaped thing in the codebase, and whether it is one of our
people.

### Our people — the six precut characters

| Class | id | Rig | Also worn by |
|---|---|---|---|
| Office Drone | `office-drone` | `worker.glb` | the Applicant summon |
| Middle Manager | `middle-manager` | `veteran.glb` | — |
| Mail Room | `mail-room` | `hr.glb` | the mail room companion |
| IT Support | `it-support` | `itsupport.glb` | — |
| Human Resources | `human-resources` | `midmanager.glb` | — |
| Security | `security` | `security.glb` | the Security Guard enemy |

Note the rig column. **The file named for a role is mostly worn by somebody
else**: `veteran.glb` is the Middle Manager, `hr.glb` is the Mail Room,
`midmanager.glb` is Human Resources — while `manager.glb` and `hrrep.glb` sit
on enemies. `classes.js:5` documents this scramble and defends it ("read the
entry, never the filename"). It is a standing tax on every conversation about
who wears what, including this one.

### Characters who ARE one of our people

| Entry | File | Class | Verdict |
|---|---|---|---|
| `security-guard` "Security Guard" | `enemies.js:120` | `security` | **Correct.** Inherits the rig, departs only by `look.build.torso`. This is the pattern. |
| `mail-veteran` | `companions.js:135` | `mail-room` | Inherits correctly, told apart by `torso: 1.38` — but the **id says "veteran"**, and the comments build a character out of it ("eleven years"). |
| `it-intern` | `companions.js:43` | `it-support` | **Broken.** Inherits the class, then **overrides the rig** to `intern.glb` (`:52`) and adds `look: { build: { legs: 1.7, head: 0.68 } }`. The build alone already does the "visibly junior" job — exactly as `mail-veteran`'s torso does. The rig override is redundant, and it is the sole thing reserving `intern.glb`. Track nodes are named `intern-fast-learner`, `intern-nerves`. |

### Characters who are NOT our people

The five in Q1 above, plus:

| Entry | File | What it is |
|---|---|---|
| `applicant` | `classes.js:308` | Summon archetype, `playable: false`, deliberately anonymous. See Q2. |

### Invented personas that are not characters but read as them

- **`data/looks.js` RIGS — twelve wardrobe personas.** "Standard Issue",
  "Fresh", "Weathered", "Pressed", "Business Casual", "Escalated",
  "Managerial", "Utility", "Uniformed", "Compliant", "Visiting", "Upstairs",
  each with a blurb writing a small person ("Still owns a lanyard from
  orientation", "Has outlasted four reorgs and one fire"). These are the
  "variations" by another name: twelve half-characters offered as clothing.
- **`data/backgrounds.js` — eight personas.** Reorg Survivor, Union Adjacent,
  Night Shift, Temp To Perm, Former Smoker, Mailroom Alum, Wellness Committee,
  Expensed It. Cut entirely per your instruction.
- **Dead persona still in comments.** "Nervous IT Intern" survives as prose in
  `classes.js:34` and `companions.js:46`, explaining a character the game
  retired.

### Clean

`data/npcs.js` exports `{}` — empty. `data/shops.js` holds two objects (Snack
Machine, The Mail Cart), not people.

---

## Confirmed defects

Each verified against source, not inferred.

**D1 — Escape commits the character instead of backing out.**
`ui/creation.js:406` comments "Escape backs out to the desk, the way right-click
backs out of an aimed action." It does not. The handler calls `onSkip()`, and
`main.js:637` binds `onSkip` to `beginRun(...)` — so Escape *starts the run*
with defaults. The one gesture that universally means cancel is wired to commit.

**D2 — There is no way back to the desk at all.** `showBadgeStep`'s BACK button
moves pane 2 → pane 1 only (`ui/creation.js:339`). Once hired, the class is
final; changing your mind means reloading the page.

**D3 — The build sliders misreport the body, and the first drag snaps it.**
Default proportions are `legs: 1.9, torso: 1.3` (`models.js:107`). The slider
ranges are `legs 1.55–2.05` and `torso 1.00–1.40` (`looks.js:53`), and
`paintBuild` falls back to the range **midpoint** when the draft has no value
(`ui/creation.js:250`) — 1.80 and 1.20. So:

| Class | Height slider | Heft slider |
|---|---|---|
| Office Drone | shows 1.80, body is 1.90 | shows 1.20, body is 1.30 |
| IT Support | shows 1.80, body is 1.90 | shows 1.20, body is 1.30 |
| Human Resources | shows 1.80, body is 1.90 | shows 1.20, body is 1.30 |
| Middle Manager | correct (1.68) | shows 1.20, body is 1.30 |
| Mail Room | correct (2.00) | shows 1.20, body is 1.30 |
| Security | correct (1.98) | correct (1.18) |

Four of six classes have at least one slider lying about the body standing in
front of you, and touching it jumps the model. This is the most likely thing
you saw as "character model conflicts". Moot once the sliders are deleted, but
it is worth recording that it shipped.

**D4 — The wardrobe offers twelve bodies, every one of which belongs to
somebody.** All twelve rigs are spoken for: six by playable classes, five by
enemies, one by the IT companion. Choosing "Upstairs" makes you The Executive.
Choosing "Fresh" makes you the intern who later joins your party. Choosing
"Uniformed" makes you the Security Guard you fight.

**D5 — The self-assessment asks for two points and explains nothing.** The
level-up screen carries labels and blurbs for the same four attributes
(`screens.js:63-68`: "Grit — Toughness, raises max HP"). Creation prints the
bare lowercase keys (`ui/creation.js:298`). The one screen where a player has
never seen these words is the one that describes them least.

**D6 — Minor: `draft.className` is set out of band.** `main.js:632` assigns it
after `createDraft` returns; the pure module never sets it, but
`ui/creation.js:392` reads it. A draft built by `createDraft` alone has no
`className`.

---

## Decisions

Tagged per `CLAUDE.md`. Everything inherited from the old plan is demoted to
`[proposed]` unless you have since spoken to it.

| # | Decision | Status | Source |
|---|---|---|---|
| 1 | The front door is a **choice between precut characters and a custom one**, not a funnel into customization | `[stated]` | "much like dos and bg3, there are precut characters you can adjust and a custom character you can make" |
| 2 | **The six classes ARE the precut characters.** No authored people layered on top | `[ratified]` | answered directly, this session |
| 3 | **Height and Heft sliders: removed** | `[stated]` | "remove height and heft" |
| 4 | **Colour palette: removed** | `[stated]` | "remove color" |
| 5 | **Backgrounds: removed entirely**, registry and all | `[stated]` | "remove 'so why are you still here?'" |
| 6 | **Renaming removed from the precut path**; the custom character types a name | `[ratified]` | "remove renaming" + answered this session |
| 7 | **Two creation attribute points stay, on both paths** | `[ratified]` | answered directly, this session |
| 8 | **The custom character is limited to rigs not reserved by a starting class** | `[stated]` | "limit the custom character creation part to the models that havent been reserved for other starting classes" |
| 9 | **No variations on our people.** No "veteran", no "intern", no "nervous". Every character is one of our people, as that person | `[stated]` | "there are only the precut fucking characters… i never want to see anything but our people as our people" |
| 10 | The custom character picks a **class for its kit**, a name, and a body — differing from that class's precut character by name and body only | `[proposed]` | the only coherent reading of #1 + #8; if a custom character should instead have no class, the whole kit/talent/action pipeline needs a second source and M3 changes shape |
| 11 | Pronouns stay on both paths | `[proposed]` | see Q3 |
| 12 | The rig↔role scramble gets un-tangled | `[proposed]` | not asked for; see M4. Skippable, but it is the root of D4 |

### On the reference games

Checked rather than recalled, per the house rule — and the two games differ in
exactly the place this plan turns on.

- **DOS2**: origin characters can be adjusted substantially — class,
  attributes, abilities, talents and appearance are all editable; name, race,
  gender and story tags are locked.
  ([Origins](https://divinityoriginalsin2.wiki.fextralife.com/Origins),
  [Character Creation](https://divinityoriginalsin2.wiki.fextralife.com/Character+Creation))
- **BG3**: origin characters are **not** adjustable at all — race, subrace,
  class, subclass, background and appearance are all locked. The sole exception
  is the Dark Urge. A separate "Custom" origin is where full freedom lives.
  ([Origins](https://bg3.wiki/wiki/Origins),
  [Character creation](https://bg3.wiki/wiki/Character_creation))

Your phrasing — "precut characters you can adjust" — matches DOS2, not BG3.
What both agree on, and what this plan takes from them, is that **Custom is its
own entry on the roster**, sitting alongside the precut ones rather than being a
stage everybody walks through. That is the structural fix.

---

## The plan

### M0 — Land this document
Commit `CHARACTER_PLAN.md` so the twenty dangling citations resolve. No code.

### M1 — The cast becomes our people
Blocked on **Q1** for enemies. The companion half is not blocked:

- `it-intern` → drop `model: 'intern'`; he inherits `itsupport.glb` and stays
  visibly junior on `look.build` alone, exactly like the mail room companion.
  Rename the entry and its track nodes off "intern".
- `mail-veteran` → rename the entry off "veteran".
- Delete the "Nervous IT Intern" prose from `classes.js:34` and
  `companions.js:46`.
- Level legends (`levels/level1.json`, `levels/level2.json`) reference these ids
  and get updated with them.
- Enemies: held for your answer.

### M2 — Strip the customization screen
- Delete `data/backgrounds.js`; drop `BACKGROUNDS` from `creation.js`,
  `ui/creation.js` and the `stats.js` import path.
- Delete `TINTS` and `BUILD_RANGE` from `data/looks.js`, and the swatch row and
  both sliders from `ui/creation.js`. The tint *pipeline* stays — `dressUp` and
  the Applicant's wash-out still use it; only the player-facing palette goes.
- Delete the name input from the precut path (`cleanName`/`NAME_MAX` survive for
  the custom path).
- `RIGS` loses its twelve invented persona names; what survives is an id list.
- Pane 2 collapses to the self-assessment alone, with the level-up screen's own
  labels and blurbs (fixes **D5**).

### M3 — Two front doors
The résumé desk gains a seventh card: **MAKE YOUR OWN**.

- **Precut** → hire → two points → play. Named for the job. Body is the class
  rig, locked. Nothing else to set.
- **Custom** → name, class (for the kit), body from the freed rigs, two points.

### M4 — Back actually goes back
Escape and BACK return to the desk instead of committing (**D1**, **D2**).
Optionally un-tangle the rig↔role scramble here (decision #12), which is what
makes the freed rigs land on sensibly-named files.

### M5 — Sweep
Save version bump for the dropped fields (additive-drop: an old save carrying a
`background` or a `look.tint` reads clean rather than breaking). Delete the
orphaned unit tests. Update `TODO.md` Phase 4 and the `REVIEW.md` references.

---

## Blast radius

- **Unit tests**: `tests/unit/creation.test.js` — the tint block (`:200-268`),
  the `BUILD_RANGE` block, the backgrounds block (`:278+`), the name block. Most
  of the file.
- **E2E**: `tests/e2e/creation.spec.js` is rewritten wholesale. `helpers.js`
  `pickClass` drops its `#creation-skip` click. `game.spec.js:38` likewise. The
  other ~24 specs boot via `#class=<id>` and never touch the picker — they stay
  untouched, which is the one thing the old plan got structurally right.
- **Saves**: `party.js` `SAVE_VERSION` is 7 and cites this document. Dropped
  fields need a read-and-ignore, not a migration that invents state.
- **Docs**: `TODO.md` Phase 4 (six milestones, all describing the removed
  design), `REVIEW.md:77` and `:89`.
