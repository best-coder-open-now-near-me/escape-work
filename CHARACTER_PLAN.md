# Character Creation — Damage Report and Rework Plan

This document replaces the plan of the same name that shipped its code but never
shipped itself. `CHARACTER_PLAN.md` is cited by twenty sites across `src/`,
`tests/`, `TODO.md` and `REVIEW.md`; until now it existed only on the unmerged
branch `claude/custom-character-creation-3ga2ni`. Every citation pointed at
nothing, which is how a document full of untagged guesses became the project's
account of what the designer wanted.

---

## Questions for the designer

**Q1 — the enemy roster — is answered.** "Enemies is fine for the most part
unless theyre trying to imitate something." The test is therefore **imitation
and parallel implementation**, not whether an entry has a `classId`. Applied
below in "Parallel implementations"; the verdicts land in decisions #13–#15.

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

### Characters with no class twin

Standalone entries in `data/enemies.js` — own name, own rig, own stat block, no
`classId`. Under the answered rule these are fine **if they are their own
archetype** and a problem **if they imitate**. Verdicts in the next section.

| Entry | Name | Rig | On a map? |
|---|---|---|---|
| `manager` | The Manager | `manager.glb` | level1, level2 |
| `executive` | The Executive | `executive.glb` | level2 |
| `hr` | HR Representative | `hrrep.glb` | level1, level2 |
| `senior-manager` | Senior Manager | `seniormanager.glb` | level2 |
| `regional-executive` | Regional Executive | `regional.glb` | **never placed** |

Plus:

| Entry | File | What it is |
|---|---|---|
| `applicant` | `classes.js:308` | Summon archetype, `playable: false`, deliberately anonymous. See Q2. |

---

## Parallel implementations

The thing you are actually tired of. Four found, ranked by what they cost.

### P1 — Two ways to make a tougher enemy, and they disagree

`enemies.js:167` opens a section headed **"seniority variants"** and describes
itself plainly: *"Tougher relatives of the base coworkers: new data entries
reusing existing rigs, with a higher native `level`."*

The engine already does this. `stats.scaleEnemy` (`stats.js:271`) scales HP, AP,
XP, every attack's min/max and accuracy by the gap between an enemy's native
tier and the floor's depth, and `effectiveLevel` (`stats.js:299`) picks the
level. A tougher Manager on a deeper floor is a thing that happens for free.

So there are two mechanisms, and they produce different characters:

| | HP | XP | Attack lines |
|---|---|---|---|
| Manager, auto-scaled to level 3 | 18 | 10 | 5 |
| **Senior Manager** (hand-written, level 3) | **22** | **15** | 4 |
| Executive, auto-scaled to level 4 | 23 | 13 | 4 |
| **Regional Executive** (hand-written, level 4) | **30** | **22** | 3 |

The XP column is the one that bites. A Senior Manager pays **50% more XP** than
the identical enemy scaled to the identical level, and a Regional Executive
**69% more**. Which entry a level places therefore silently changes the
progression curve, and nothing anywhere says which number is the intended one.
This is the "breaks everything down the road" case, already loaded.

Both entries are also, by the file's own account, base coworkers with an
adjective on the front — "Senior Manager: *Same energy, more direct reports*",
"Regional Executive" to "The Executive". That is the imitation test, failed in
the examine text.

**The one snippet already exists**, and it is exactly one line deep:

```js
scaleEnemy(base, effectiveLevel(base, floorDepth))   // main.js:148, main.js:3314
```

Every enemy on every floor goes through it. A variant entry does not *use* a
different snippet — it **bypasses this one**, because `effectiveLevel` is
`max(def.level, depth)`: a Senior Manager with native level 3 standing on floor
2 computes `d === 0`, `scaleEnemy` returns the def untouched, and the
hand-written numbers ship verbatim. Whether a Manager gets curve numbers or
hand numbers depends on which character a level author typed in the legend.

**But deleting the variants outright would lose a real capability**, and the
first draft of this plan missed that. A level's `actors` legend maps a character
to a bare type id (`"G": "senior-manager"`), and the only level knob is the
floor-wide `depth`. So today there is no way to say "a tougher manager *here*"
except by authoring an entry — which is precisely why these exist.

**Recommend instead: make the variant a level, not an entry.** Let a placement
name one — `"G": "manager@3"`, or the object form — so a Senior Manager becomes
`manager` at level 3, produced by the one snippet, with no second stat block
able to drift from the first. Then delete both entries. That keeps the
capability, removes the parallel path, and makes the XP disagreement
structurally impossible rather than merely fixed once.

Consequence to own: `level2.json`'s `G` becomes `manager@3`, which is *not*
today's Senior Manager — the curve gives 18 HP and 10 XP where the hand-written
one gives 22 and 15. That floor gets slightly easier and pays less. Pick the
curve or re-tune the curve; what should not survive is two answers. Regional
Executive is on no map at all and costs nothing either way. **This frees
`seniormanager.glb` and `regional.glb`** — which, with `intern.glb` from the
companion fix, gives the custom character a real wardrobe of three without
inventing anybody.

### P1b — The IT companion's track is a renamed copy, and the lint can't see it

A lint for exactly this already exists (`tests/unit/levels.test.js:70`): for any
kit with a `classId`, every field that merely repeats what the class says fails
the test. Its own comment names the intern as the case it was written for.

It catches **verbatim** restatement. It does not catch a restatement that has
been renamed, and that is where the intern went. Computed against the class:

| Entry | Track | Rig | Actions |
|---|---|---|---|
| `mail-veteran` | inherited | inherited | inherited |
| `security-guard` | inherited | inherited | inherited |
| **`it-intern`** | **overridden, 2 nodes vs the class's 4** | **overridden** | inherited |

Both clean entries depart from their class on `look.build` alone. The intern
does three things none of the others do:

1. **`intern-fast-learner` is `it-root` with a new name.** Identical effect —
   `{ attrBonus: { savvy: 1 } }` — different id, different label. The lint
   compares `kit.track` against `base.track` as whole arrays; two arrays of
   different length are trivially unequal, so it passes. Node effects are never
   compared.
2. **The override silently deletes three real class nodes**: `it-ergonomic`
   (+1 grit), `it-percussive` (grants Percussive Maintenance) and `it-remote`
   (grants Remote Session). An IT person who joins your party can therefore
   never learn two of IT Support's own actions. Nobody decided that. It fell
   out of overriding a four-node track wholesale in order to carry two.
3. **`intern-nerves` — "Steady Nerves"** — is the last living piece of the
   retired "Nervous IT Intern". The persona was deleted from the display name
   and survives as a progression node.

So, to answer it directly: of the three characters who ARE one of our people,
**two are clean and one is an unnecessary dupe on every axis it touches** — a
renamed class node, a redundant rig override, and three inherited nodes lost as
collateral. The fix is deletion, not rewriting: drop `track` and `model`, keep
`look.build` and the softer stat line, and he is an IT person who is earlier on.

The lint should also grow the node-effect check, or the next renamed copy
passes too.

### P2 — Three copies of "dress a body"

`dressUp` (`main.js:459`) is the shared path: proportions, then materials, then
tint. It is used by enemies, NPCs, the party and companions. Alongside it:

- `previewClass` (`main.js:573-575`) does the same three calls inline.
- `previewDraft` (`main.js:591-593`) does the same three calls inline again,
  reading a draft instead of a class.

`REVIEW.md` flagged the first duplicate and `TODO.md`'s Phase 4 **M2 promised to
fold it in**: *"folding `previewClass`'s inline duplicate (`main.js:550`) into
the shared path."* That never happened — and the creation work then added a
third copy. The debt the plan was written to pay went **up**.

### P3 — Two summon vocabularies

One implementation (`combat.js resolveSummon`), two incompatible spec shapes for
it. The HR class action (`actions.js:554`) carries `{count, cap, uses, range,
lifetimeTurns, ap}`; the HR enemy (`enemies.js:109`) carries `{count, cap,
cooldownRounds, ap, lifetimeTurns}` — no `range`, and `uses` swapped for
`cooldownRounds`. Same archetype, same resolver, two ways to describe how often
you may do it. Milder than P1 because the resolver is shared; worth one
vocabulary rather than two.

### P4 — HR exists twice, and the file says it doesn't

`enemies.js:18` states the rule and the roster in one breath: *"Everyone else
here has no class twin — The Manager, the Executive **and the rest** are their
own archetypes — so they stay written out."*

`the rest` includes `hr`. The class registry contains `human-resources`. The
comment is false about its own file.

This is not a loose thematic overlap. It is the same character implemented
twice, and the *defining verb* is the duplicated part:

| | Class `human-resources` | Enemy `hr` |
|---|---|---|
| Name | Human Resources | HR Representative |
| Rig | `midmanager.glb` | `hrrep.glb` |
| AP | 6 | 6 |
| `classId` | — | **none** |
| Summons applicants | yes, via `actions` | yes, via a `summon` block |

`classes.js:44` defines `primary` as *"the ONE verb a class is for"*, and
Human Resources declares `primary: 'summon'` — "it staffs the fight". The HR
enemy's one distinguishing power is a summon block. Two entries, one verb, two
implementations, no shared ancestor.

And the two summon specs disagree about the same archetype:

| | archetype | count | cap | rate limit | lifetime | AP |
|---|---|---|---|---|---|---|
| Class action | `applicant` | 1 | 3 | `uses: 2` | 6 | 4 |
| Enemy block | `applicant` | 2 | 2 | `cooldownRounds: 2` | 5 | 3 |

Same resolver (`combat.js resolveSummon`), two vocabularies for "how often may
you" — which is **P3** above, and this is where it came from.

`security-guard` is the same situation handled correctly: `classId: 'security'`,
rig inherited, told apart by `look.build.torso` alone.

**Recommend: fold `hr` the same way** — and take the rig with it, because that
unwinds the scramble in a cascade:

| Rig | Today | After |
|---|---|---|
| `hrrep.glb` | HR Rep enemy | **Human Resources** class + the enemy, `security`-style |
| `midmanager.glb` | Human Resources class | **Middle Manager** class |
| `veteran.glb` | Middle Manager class | **free** |

Each class lands on the file named for it, and `veteran.glb` joins the free
pool. With `intern.glb`, `seniormanager.glb` and `regional.glb` that is **four
bodies** for the custom character, none of them invented and none of them
somebody else's.

One lie survives: Mail Room stays on `hr.glb`, because the Kenney swap deleted
`mailroom.glb` and there is no file for that job. That one needs art or needs
accepting.

`manager` and `executive` pass. "The Manager" is not the Middle Manager class —
that class is about `primary: 'control'` and is a different character — and
nobody plays an Executive. They are their own archetypes, which is what the
file's header rule protects: *"Don't invent a class just to inherit from it."*
The rule is right. It was just applied to five entries and checked on none.

### Also: the worklist is lying

`TODO.md`'s Phase 4 lists M1–M6 as six unchecked boxes. Five of them shipped —
`sheetLook` is gone, `creation.js` exists, `looks.js` exists, backgrounds
shipped, pronouns shipped. The worklist says none of it is done.

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
| 13 | **Enemies are fine unless they imitate.** Having no `classId` is not the fault; being a variation of somebody we already have is | `[stated]` | "enemies is fine for the most part unless theyre trying to imitate something" |
| 14 | **No parallel implementations.** A second hand-written way to do a thing the engine already does is the defect, whatever it is dressed as | `[stated]` | "i just dont want to deal with any more parallel imps. im so tired of this repeated code i didnt even want" |
| 15 | **A placement may name a level** (`"G": "manager@3"`); Senior Manager and Regional Executive are then deleted | `[proposed]` | follows from #13 + #14. Deleting them without the legend change would lose per-placement difficulty, which is the capability they were written for |
| 15b | The IT companion drops its `track` and `model` overrides and keeps only `look.build` + its softer stat line | `[proposed]` | follows from #14; it restores two class actions he currently cannot learn |
| 15c | The override lint grows a node-effect comparison | `[proposed]` | it passed a renamed copy of `it-root`; it will pass the next one |
| 16 | HR Representative folds into the Human Resources class, `security-guard`-style, **and the class takes `hrrep.glb` with it** — cascading Middle Manager onto `midmanager.glb` and freeing `veteran.glb` | `[proposed]` | follows from #13. Not the weak case it was first written as: the duplicated part is the class's own `primary: 'summon'` verb, and `enemies.js:18` asserts this entry has no class twin while `human-resources` sits in the registry |
| 17 | The Manager and The Executive stay as their own archetypes | `[proposed]` | they imitate nobody; `enemies.js:20` already says "Don't invent a class just to inherit from it" |

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

### M1 — The cast becomes our people, and the imitations go
- `it-intern` → drop `model: 'intern'` **and the whole `track` override**
  (**P1b**). He inherits `itsupport.glb` and IT Support's four real nodes, and
  stays visibly junior on `look.build` and his softer stat line alone — exactly
  like the mail room companion. Rename the entry off "intern".
- `mail-veteran` → rename the entry off "veteran".
- Delete the "Nervous IT Intern" prose from `classes.js:34` and
  `companions.js:46`.
- Teach the legend to name a level, then delete `senior-manager` and
  `regional-executive` (**P1**, decision #15) and the "seniority variants"
  section header that licenses writing more of them.
- Grow the override lint to compare track-node effects (**#15c**), so the fix
  cannot silently regress.
- Fold `hr` into the Human Resources class (**P4**, decision #16).
- Level legends (`levels/level1.json`, `levels/level2.json`) reference these ids
  and get updated with them — `G` on level2 becomes `M`.
- Frees `intern.glb`, `seniormanager.glb`, `regional.glb`: the custom
  character's wardrobe, with nobody invented to fill it.

### M1b — Kill the duplicate dressing
Fold `previewClass` and `previewDraft` into `dressUp` (**P2**) — the fold
`TODO.md` M2 promised and never did. Do it before M2 touches the preview, or
the strip work edits two copies of the same three lines for the third time.

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
Un-tangle the rig↔role scramble here (decision #12 and the #16 cascade), which
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
