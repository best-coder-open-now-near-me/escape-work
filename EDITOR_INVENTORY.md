# Level Editor — Needs Inventory

A full accounting of what the level editor (`src/editor.js`) cannot do, what it
does badly, and what it does that quietly destroys work — plus the UI/UX changes
that would fix each. This is an **inventory**, not a build order: it names the
needs and sizes them, and the sequencing at the end is a proposal awaiting a
verdict.

Relationship to `EDITOR_PLAN.md`: that doc owns the *verticality* program (the
layer model, the spike, milestones M0–M4) and is the load-bearing record for the
editor's `[stated]`/`[ratified]` decisions. This doc is the gap list those
milestones draw from. Where the two overlap, EDITOR_PLAN wins on status and this
doc adds evidence. Nothing here re-tags anything there.

Every claim below carries a `file:line`. Claims were produced by a code audit and
then independently checked by a second pass that tried to refute them; 98 were
checked, 66 confirmed as written, 31 corrected, 1 withdrawn. The corrected
versions are what appear here.

---

## Questions for the designer

Six questions, each with options, the consequence of each, and a recommendation
first. All six change the *shape* of the work, not just its order. Everything in
the inventory below that depends on an answer is tagged `[proposed]` and names
the question it stands in for.

They are numbered **IQ1–IQ6** — an earlier draft numbered them Q1–Q6, which
collided with `EDITOR_PLAN.md`'s own Q1–Q3 and cost the designer an answer to
the wrong question. The two docs' numbering is deliberately disjoint now.

**Status, 2026-08-02:** IQ1, IQ3, IQ4 and IQ5 are `[ratified]`. IQ6 is partly
answered — the designer's pipeline is now `[stated]` ("outputting to json and
uploading to the git") and one premise was corrected, leaving a single narrow
question (where the editor is run). IQ2 is still open: it was misread as
EDITOR_PLAN's Q2, which is now closed on its own terms — see that doc, and the
designer's "we need layers and such" has moved its recommendation to option D.

---

**IQ1 — What is the editor for this round: a safe painter, or an instrument that
shows you the fight?** — **ANSWERED: A**, `[ratified]` (designer, 2026-08-02:
"painter"). The inventory splits cleanly into two products with very different
costs.

- **A. Safety and closure (recommended).** Undo, autosave, live validation,
  actor brushes, the allocator reset, a metadata strip, save-to-disk.
  *Consequence:* the tool stops losing work and stops emitting files that fail
  CI. You still cannot see an encounter before playing it. This is roughly the
  gap list you already confirmed, plus three cheap correctness fixes, and all of
  it is independent of the layer work.
- **B. Sight.** Watch cones, cover, engagement clusters, the surprise band,
  depth-scaled enemy readouts, fire/explosion chains, floor budget.
  *Consequence:* changes how a floor is *designed* rather than how safely it is
  *edited* — but every overlay needs hover plumbing the editor does not have and
  a translucent draw layer it does not have, and each will be redrawn when
  storeys arrive.
- **C. Both.** *Consequence:* honest scope is a milestone, not a round; nothing
  lands soon.

I recommend A, and sequencing B *after* layer authoring — a cone or a cover tick
drawn per storey is a different drawing problem than one drawn flat.

*Consequence of the answer:* section I (Seeing the fight) is out of this round
entirely and sequences after M4. The proposed sequence at the end of this doc
becomes the plan for the round.

**IQ2 — Verticality is `[stated]` and the editor cannot author it. What happens
between now and M4?** — **STILL OPEN.** This is the question that got misread:
the answer given on 2026-08-02 quoted `EDITOR_PLAN.md`'s Q2 (whether height
changes combat math) and approved its option A, which is now `[ratified]`
there as decision 8. That is a different question and it does not settle this
one. Re-asked below unchanged.

- **A. Refuse and document (recommended).** Make opening a layered level refuse
  with a message — today it flattens the level and Export deletes the upper
  storeys (`src/main.js:271-273`) — and write the hand-authoring recipe down so
  you can build a second vertical space by hand now. *Consequence:* no more
  destroyed spikes; verticality stays a hand-JSON job for the moment.
- **B. Pull M4 forward**, ahead of the QoL round. *Consequence:* you can paint
  storeys sooner; undo, actor brushes and validation slip — and you would be
  painting layers in a tool with no undo.
- **C. Accept the status quo.** *Consequence:* `spike-lobby` is one accidental
  `?level=spike-lobby#editor` + Export away from silently becoming a flat room.

- **D. Guard, then jump the queue (added 2026-08-02).** Round 1 (the XS
  data-loss fixes, including the refusal guard) plus Round 2 (undo/autosave),
  then M4 layer authoring — deferring rounds 3–6. *Consequence:* you can paint
  storeys within two short rounds instead of after five, and you are not doing
  it in a tool that can lose an hour's work. The palette, validation, actor
  brushes and the editing vocabulary all wait.

**Designer signal, 2026-08-02: "we need layers and such."** That is not yet an
answer to this question — it restates the `[stated]` requirement rather than
choosing what happens in the gap — but it points away from A-alone, which parks
verticality indefinitely. Per CLAUDE.md a `[proposed]` recommendation bends to
the designer's visible direction: **the recommendation is now D**, which gets
layers authored soon without painting them in a tool that has no undo. A remains
correct as the *first step* of D — the refusal guard is in Round 1 either way.

Two brushes (void, and an un-hidden `stairway`) are XS each and are M4
prerequisites either way.

**IQ3 — Who owns a map character: the level, or the registry?** — **ANSWERED:
A**, `[ratified]` by explicit deferral (designer, 2026-08-02: "i dont know the
difference, ill defer to your judgement"). Recorded as ratified rather than
proposed because the deferral was explicit, but flagged: the designer did not
evaluate the trade, so if the lost property in A — being able to read any map by
eye across files, because `#` always means wall — turns out to matter in
practice, this is the first decision to re-open. The editor
allocates characters per level; the shipped-level lint demands the registry's
canonical character. They disagree, and an export can land on the wrong side.

- **A. The level (recommended).** Relax `tests/unit/levels.test.js:413-419` to
  what `parseLevel` actually needs — unique within the level, not an actor's,
  naming a real type. *Consequence:* editor exports always ship; hand-authored
  files stay valid; you lose the comfort of reading a map by eye across files.
- **B. The registry.** Keep the lint, make the editor refuse to allocate a pool
  character and name the type it cannot place. *Consequence:* legends stay
  globally readable; `stairway` becomes unpaintable and the ~86-character pool
  becomes a hard registry ceiling again — the exact thing
  `src/data/tiles.js:67-82` celebrates having removed.
- **C. Status quo.** *Consequence:* an export containing a stairway, or a
  tier-character collision, produces a red CI on a file the author cannot fix
  without hand-editing the legend.

The editor's design, the format and `grid.js` all already say per-level. Only
the lint disagrees.

**IQ4 — Does a placement get to carry properties, or is one character per cell
the whole truth?** — **ANSWERED: A, at four orientations**, `[ratified]`
(designer, 2026-08-02: "4 different rotation can be set"). Read as: rotation is
a thing the author *sets* on a placement — which is A, not B, where you would
instead paint a different tile type — and it is quantised to 90° steps rather
than free. B was in any case barely available: four rotations of ten props costs
40 of ~86 characters and the pool is already saturated (A5).

*Consequence the designer should know:* the ASCII map stops being the complete
picture of a level. A reader of the JSON will see `D` and have to look at a
`props` array to learn which way that desk faces. That is the price of A and it
is not reversible cheaply once levels use it.

This is an office game whose content is furniture, and every
desk in it faces the same way: `rotY` is a property of the tile *type*
(`src/data/tiles.js`), not the placement.

- **A. An optional props array** — `"props": [{x, z, rotY}]` beside the map,
  read as per-cell overrides. *Consequence:* desks can face each other and the
  editor gets an R key; one new optional field, every existing level valid
  unchanged; the ASCII map stops being the complete picture.
- **B. Rotated variants as registry entries** (`desk-north`, `desk-east`, …).
  *Consequence:* data-only, no format change; four rotations of ten props costs
  40 of a level's ~86 characters and 40 more palette buttons — and the pool is
  already saturated (see A5).
- **C. Stay as is** and make the limit visible — outline a prop's real mesh
  footprint on hover so the overhang/collision mismatch is at least honest.
  *Consequence:* cheapest; the boardroom table and the reception desk stay
  unauthorable, and the furniture keeps facing one way.

I recommended C now and A if furniture needs to face different ways; the
designer went straight to A. Note that A answers *rotation* only — H4 (a prop
that spans more than one cell, the boardroom table) is a separate limit that A
does not lift, and C's hover-outline is still the cheapest honest fix for it.
Decision 2 (`[stated]`,
"we dont need full flexibility, we dont have organic curves to construct or
anything like that") settles that the *grid* stays; it says nothing about one
character per cell, so this is genuinely open. The same answer decides whether
an actor can stand on a carpet tile (H2).

**IQ5 — What should Playtest boot with?** — **ANSWERED: B**, `[ratified]`
(designer, 2026-08-02: "i also have no idea what depth refers to but level 1 is
fine"). Taken as B rather than A because B *is* A with one screen removed — it
changes nothing about what you playtest with, it just stops asking you to make
the character every time. XS.

Recorded honestly: the answer was given without knowing what `depth` does, and
"level 1 is fine" is true *today* only because both shipped floors are depth 1
and 2. `scaleEnemy` (`stats.js:338-361`) gives an enemy +15% max HP per level
above its native tier, +1 damage per attack per 2 levels, +1 AP per 3, and up to
+2 accuracy steps. On a depth-6 floor a Manager has roughly 75% more HP and +3
damage. Testing that with a fresh level-1 solo character measures nothing. So
**C is not rejected, it is deferred** — re-open it the first time a floor deeper
than about 3 gets built.

- **A. As today.** *Consequence:* zero work; "is this fight fair" is
  unanswerable in the tool, because `depth` scales every enemy
  (`src/main.js:332-337`) against a party the tool cannot field.
- **B. Remember the last playtest character (recommended now).** Stash a class
  and re-enter through the existing `#class=` express lane
  (`src/main.js:4163`). *Consequence:* one screen removed from every iteration;
  the party is still solo and level 1. Roughly XS.
- **C. A configurable test party** — class, level, party size, cash, set in the
  editor bar. *Consequence:* encounters become testable as designed; costs a
  small sidecar stash and a hook after `beginRun`.

I'd take B now and C when balance work starts.

**IQ6 — Does save-to-disk ship, and in which form?** (EDITOR_PLAN decision 10 is
`[proposed]`.) Today getting a level into the game is Copy → paste into
`levels/` → hand-edit `src/data/levels.js` → rebuild.

**Partially answered 2026-08-02, and one premise corrected.** The designer's
workflow is now on the record `[stated]`: "were just outputting to json and
uploading to the git" — the export → file → commit loop *is* the intended
pipeline, not a stopgap. That settles what save-to-disk has to serve.

The premise to correct: *"we dont have the backend infra i dnt think."* Option A
needs no backend and nothing hosted. `serve.mjs` is the local dev server already
run by `npm run serve` on the designer's own machine; the endpoint would write
into their own working copy, and `build.mjs` never bundles it, so nothing about
it reaches itch.io or any server. **But the instinct behind the doubt points at
a real question, which is D below and is the one still open.**

- **A. Dev-server endpoint** — `POST /api/level` in `serve.mjs` writing
  `levels/<id>.json` plus a regenerated registry. *Consequence:* the paste and
  the hand-registration both disappear and the registry cannot drift from the
  directory. No hosting, no service, dev-only. **Only works if the editor is
  being run from a local `npm run serve`** — see D.
- **B. Editable paste-back.** Make the export textarea writable with a "Load
  this JSON" button. *Consequence:* ~10 lines, no server change; it lets a level
  come back *into* the editor, which today is impossible except through the
  single-slot playtest stash. It does not remove the paste step.
- **C. Neither.** *Consequence:* every iteration on an exported level costs the
  full four-step round trip.
- **D. Download button (new, and now the recommendation).** A "Download
  `<id>.json`" button beside Export: a `Blob` plus an `<a download>`, which is
  pure browser API — no server, no backend, works identically in the local build
  and the deployed preview. *Consequence:* the file lands in Downloads ready to
  move into `levels/` and commit, which is exactly the stated workflow, and the
  Copy-and-paste-into-an-editor step disappears. Roughly XS.

**On Supabase** (designer, 2026-08-02: "if we can use the supabase" / "oh yeah
we have supabase now"). It exists and works — `src/remote-store.js`,
`REMOTE_STORE.md`, chosen by the designer on 2026-08-01. It is the right tool
for one editor problem and the wrong tool for this one, and the two are worth
keeping apart:

- **It cannot serve this question.** The stated workflow is JSON → git, and
  Supabase cannot put a file in git. More decisively, `src/data/levels.js:8-12`
  imports every level as a *static ESM import resolved at build time*
  (`import level1 from '../../levels/level1.json' with { type: 'json' }`). A
  level sitting in a Postgres row is not a level in the campaign, and cannot
  become one without a code change and a rebuild — which is the exact step
  save-to-disk exists to remove. Routing the git pipeline through a database
  makes it longer, not shorter.
- **It is exactly the answer to K4** — level *sharing*, the gap where a player
  paints a floor and the tool's only advice ("paste into `levels/`") is
  meaningless to them. That is a real feature and Supabase is the natural
  mechanism. It is a different feature from IQ6, with its own cost: the store is
  deliberately one `saves` table behind two RPCs with no direct anon access
  (`REMOTE_STORE.md:47-61`), scoped to what the designer asked for — "i wanted
  the base minimum" (2026-08-01). Levels mean a second table and new RPCs.

So: Supabase is now a live option for K4, and K4 should be re-asked on its own
terms rather than folded in here. It does not change the recommendation below.

**Recommendation: D, plus B.** Together they are under twenty lines, need no
infrastructure of any kind, and close both directions of the loop — a level out
as a file, and a file back in. A stays worth doing *only* if the answer to D's
question is "locally", and even then it is an optimisation of a loop D already
makes cheap.

**The question that is actually still open: where do you run the editor?**
If it is `npm run serve` on your machine, A is available and would remove the
`src/data/levels.js` hand-edit too. If you paint levels in the deployed preview
build in a browser tab, A is genuinely unavailable to you and D is the whole
answer. One word settles it.

Flag on B: decision 1 is `[stated]` — no external editor or importer ("i dont
mind using ours if its easiest"). That reads as being about Tiled/LDtk rather
than about pasting our own JSON back into our own tool, but it is worth
confirming rather than assuming.

---

## What the editor already gets right

The findings below are deltas against a real baseline. Four things should
survive any redesign untouched:

1. **Rendering parity is structural, not incidental.** The editor builds with
   `createTileRenderer` — the same module the game's `buildLevel` uses
   (`src/editor.js:96`), so props, pools, edge walls, doors and glowing exits
   cannot drift between tool and game.
2. **Live rule previews most editors don't have.** Conduction is recomputed from
   the real `parseLevel`/`isElectrified` on every paint, re-rendering only the
   cells whose state flipped (`src/editor.js:111-126`, `:259-269`); carpet
   inheritance under props runs the game's own `computeCarpetZones` the same way
   (`:271-283`). Paint a cable next to water and the pool lights up exactly as
   the game will.
3. **The async model-load staleness guard**, including the deliberate
   *non*-clearing of `cellVersion` in `renderAll` (`src/editor.js:285-293`), is
   subtle and correct. Leave it alone.
4. **Per-level character allocation** (`src/editor.js:45-89`, `:438-467`) is a
   real design win: legends name only the types a level uses, a registry `char`
   is a preferred hint so hand-authored levels round-trip cleanly, actor
   characters are reserved so the two legends cannot collide, and `runtimeOnly`
   tiles are excluded. The ceiling in A5 is a bound that has been crossed, not a
   flawed design.

Also worth stating plainly: the palette is generated from the registries
(`src/editor.js:519-561`), so a new prop is paintable with no editor change at
all. That property is why the palette grew to 94 buttons, and it is worth more
than the crowding costs.

---

## A. Silent data loss, and exports that cannot ship

The most expensive class: the tool destroys work or emits a broken file, and
says nothing.

| ID | Today | Cost | Fix | Size |
|---|---|---|---|---|
| **A1** | No undo or redo anywhere. `paint` writes `rows[z][x]` in place (`editor.js:380`), `paintEdge` mutates the four edge Sets in place (`:217-227`), `resize` pops rows and columns (`:405-408`). No history stack exists; `grep` for keydown in `editor.js` returns nothing, so there is not even a listener to hang one on. | The default brush is `wall` (`:361`) and left-*drag* keeps painting (`controls.js:131-133`). One stray press-and-move across a finished room replaces a swath of floor with cubicle wall, unrecoverably. `−col`/`−row` delete a whole column on one click. | Snapshot history: `{rows, hWalls, vWalls, hDoors, vDoors, width, height}` pushed at the start of each gesture, capped ~50. At ≤40×40 a full snapshot is cheaper than a diff format. Group a drag into one entry via `onAnyLeftPress`, which `controls.js:19,109` already exposes and the editor ignores. Bind Ctrl+Z / Ctrl+Shift+Z. | M |
| **A2** | All state is a closure local in `startEditor` (`editor.js:26-43`). The only persistence is the Playtest button writing `toJson()` to one localStorage slot (`:596`). No autosave. | Close the tab, crash, or hit Reset and the session is gone. A reload silently restores the last *playtest* snapshot instead — which may be an hour old. | Debounced autosave to a separate `escape-work.editor.draft` key after every mutation; prefer it over `levelData` on boot with a toast and a Discard button. Keep the playtest stash as the separate hand-off slot it is. | S |
| **A3** | `Reset` and `Exit editor` each wipe the stash and reload on one unconfirmed click, styled identically to `Export` beside them (`editor.js:595-609`). Separately, the in-game menu's `menu-restart` (`main.js:4078-4085`) calls `clearProgress()` **ungated** — deleting the campaign save *and* its Supabase row (`main.js:139-142`) *and* the stashed level. Its two sibling sites are both gated (`main.js:894`, `:2919`). | Three buttons discard unsaved work with no confirmation; one of them also destroys a campaign run the author was not editing. TODO.md:335 records this bug as two sites; the third was missed. | Gate `menu-restart` on `!playtesting` and split its label while playtesting ("Restart this level"). Confirm Reset/Exit, style them as a secondary group, and add a `beforeunload` guard keyed off a dirty flag. | S |
| **A4** | `reservedChars`, `tileByChar` and `charByType` are created once per `startEditor` (`editor.js:73-75`) and never cleared; `charOfType` returns a cached allocation without re-testing reservations (`:76-86`). `loadLevel` adds newly-loaded tier characters to `reservedChars` (`:323`) but removes nothing. | Two symptoms, one root cause. (a) A level's export depends on which levels you opened first in that browser session. (b) `ficus` prefers `'G'` (`data/tiles.js:541`) and `levels/level2.json:37` uses `'G'` for `manager@3` — so a painted plant can export as an enemy spawn. | Rebuild the three maps at the top of `loadLevel` and re-seed `charOfType('floor')` before the tier scan. One fix closes both, and removes one of the two triggers of A6. | XS |
| **A5** | 87 paintable tile types against exactly **86** usable pool characters (measured: pool is codes 33–126 less `\`, less `' '`, less `'@'`, less the 6 actor characters). On exhaustion `charOfType` returns the floor character and the comment promises `// pool exhausted: paint floor, say so below` (`editor.js:82`) — nothing says so, anywhere. | The 87th distinct type in one level silently paints floor, and `toJson`'s `used` set never learns the type existed, so the export contains floor too. The bound is crossed *today*, not hypothetically. | Refuse the paint and `toast()` the type name rather than substituting floor. Correct the two comment blocks (`editor.js:57-59`, `data/tiles.js:78-81`) to the measured number and add a unit test asserting paintable types ≤ pool size. | S |
| **A6** | `stairway` (`data/tiles.js:170-180`) is the **only** non-`runtimeOnly` tile type with no preferred `char`, so it gets a brush in the `basics` row and exports under a pool character — which `tests/unit/levels.test.js:417` rejects (`TILE_TYPES[type].char === ch` against `undefined`). In a flat level it is also an invisible wall: the editor draws a slab, the game draws nothing. | A live brush produces a level CI refuses and a playtest the author cannot see. | Hide it from the palette until M4 (same mechanism as `runtimeOnly`, `editor.js:521`), then re-enable with live run validation mirroring `floors.js:52-127`. Whether the lint or the allocator yields is **IQ3**. | XS |
| **A7** | `main.js:271-273` flattens a layered level to its ground storey before handing it to `startEditor`; `editor.js` has no layer state and `toJson` never emits `layers`. Reachable via `?level=spike-lobby#editor`. | Opening the spike lobby and exporting it deletes the mezzanine, the stairs and the ground storey's `height`. Silently. | An XS refusal guard now (see **IQ2A**); real authoring is M4. | XS |
| **A8** | `resize` shrinks from the right and bottom only, popping rows and columns (`editor.js:400-422`) and filtering edge runs. Nothing checks what was in them. | `−col` can delete the player spawn, an enemy, or a companion with no warning — and with no undo (A1). | Warn when a trim would remove an actor or the spawn; make the trimmed content restorable via A1. | XS |
| **A9** | `loadLevel`'s `canonical` ends `TILE_TYPES[type] ? charOfType(type) : charOfType('floor')` (`editor.js:336-338`). An unrecognised tile id becomes floor, silently, and the export writes floor. | A renamed type with no `TYPE_ALIASES` entry, or a level from a branch, loses content on load — structurally the same failure the actor path was already fixed for. | Count substitutions during `loadLevel` and report them once: "3 cells used an unknown tile type ('server-rack') and were set to floor". Same for the `actorChar(actor) ?? charOfType('floor')` fallback one line above. | XS |
| **A10** | `computeElectrifiedSet` runs the real `parseLevel` on every paint and swallows every throw (`editor.js:115-126`), including the named errors `grid.js:103-115` raises for unknown tile types and bad actor legend values. | The parser is already telling the editor the level is broken, on every stroke, and the editor drops the message. | Keep the try/catch — mid-edit states genuinely can be unparsable — but capture the message and surface it in the status strip, clearing on the next successful parse. This is the same hook B1 needs. | XS |
| **A11** | `isActor` is computed from `enemyByChar`, built from `ENEMY_TYPES` only (`editor.js:90-91`, `:162`). A companion (`'N'`, `'V'`) or a tiered character (`'G'`) renders as bare floor. | Open `level1` and the IT companion is a blank tile. Drag a carpet brush over that room and he is gone — no marker vanished, no warning, and the lint will not object because a floor without companions is valid. | Build `enemyByChar` from `actorLegend()` so every placed actor gets a marker. Pairs with H1. | XS |

---

## B. The editor validates nothing

Every rule below already exists as a passing test. None of it runs in the tool
that produces the file.

| ID | Today | Cost | Fix | Size |
|---|---|---|---|---|
| **B1** | The editor enforces two lint rules *by construction* — declared characters (the per-level allocator) and run bounds (`edgeInRange`, the resize filter) — and none of the three **playability** rules: a spawn exists, an exit exists, the exit is reachable (`tests/unit/levels.test.js:371-411`). | You can Export and Playtest a floor that cannot be finished. You find out after pasting into `levels/` and running CI, or after playing it. | Extract the three checks into a shared `src/level-lint.js` consumed by both `tests/unit/levels.test.js` and the editor; run it debounced and show a status chip (green/amber/red) with the failing rule named. Requires K7. | M |
| **B2** | Doors can be painted on the map boundary or between two solid cells. They render, they list, and nothing flags them. | A door to nowhere reads as a route on the map and is not one. | Part of the B1 chip: flag edges whose two sides are not both enterable. | S |
| **B3** | Restored companions take the first walkable unoccupied DIRS8 neighbour of the spawn, falling back to the spawn tile itself (`main.js:4134-4139`); `PARTY_CAP = 3` (`party.js:14`). Nothing checks the spawn has two free neighbours. | A spawn in a tight corner stacks the party until the leader walks far enough to force a repath — a failure mode `main.js:4129-4133` documents in its own comment. | Part of the B1 chip: require ≥2 walkable neighbours at the spawn. | S |
| **B4** | The `next` chain is a string per file. `FIRST_LEVEL` is imported by the lint and never asserted. Nothing catches a cycle, an orphan, a terminal floor that should not be terminal, or a `depth` that contradicts the chain. | A bad `FIRST_LEVEL` silently disables campaign saves entirely. A floor can be authored and registered and still be unreachable from floor 1. | Add a campaign-chain block to `tests/unit/levels.test.js`: walk `next` from `FIRST_LEVEL`, assert no cycle, exactly one terminal floor, every non-dev level reachable, `depth` non-decreasing. Strictness is worth a designer nod. | S |
| **B5** | `tests/unit/levels.test.js:25` reads `levels/` non-recursively, so `levels/dev/` skips the exit, canonical-legend, declared-chars, run-bounds, `next` and `depth` checks. *(Correction to an earlier draft of this item: the dev level is **not** unvalidated — `tests/unit/floors.test.js:157-183` parses the real `spike-lobby.json` and exercises every stair validation including a spawn→mezzanine route.)* | The exemption is what lets `spike-lobby` legally declare `"X": "stairway"` against a type with no registry char — i.e. the exemption is currently load-bearing for A6. | Decide with **IQ3**. If the lint relaxes, `levels/dev/` can come inside it. | S |

---

## C. Feedback and readout

The editor is close to silent. This is the cluster that most changes how the
tool *feels* per unit of work.

| ID | Today | Cost | Fix | Size |
|---|---|---|---|---|
| **C1** | The boot instruction line is invisible. `editor.js:645` is the only `say()` in the file; `say` writes `#subtitle` (`ui/readouts.js:9-13`); `index.html:29` sets `#subtitle { display: none; }`; and the narrator's opacity gate reads `narrationOk`, whose only setter is called from `main.js:3933` — inside `startGame`, which editor mode never enters. | The one sentence explaining that the partition brush paints *edges* and that right-click erases is never shown to anyone. | Swap it for `ui.toast` (`ui/readouts.js:177`), which is ungated and already in the house style, and give the editor a persistent status strip. | XS |
| **C2** | `createControls` is called with only the three click/drag callbacks (`editor.js:427-435`). `onHover`/`onHoverLeave` exist (`controls.js:19`, dispatched `:133-148`) and are not passed. | Nothing previews what a click will do. Worst for the partition brush, which picks an edge from the sub-tile fraction of the ground point (`nearestEdge`, `editor.js:198-207`) — a decision the author cannot see until after the wall exists. | Pass `onHover` and maintain one reusable ghost entity: a translucent box for tile brushes, a translucent `renderEdgeWall`/`renderDoor` at `nearestEdge(g)` for edges. ~30 lines, reusing the renderer. Prerequisite for every overlay in section I. | S |
| **C3** | The armed brush is signalled by a 1px border colour on one of 94 buttons (`editor.js:498-502`), inside a container capped at `42vh` with `overflowY: auto` (`:479`) — so the selected button is frequently scrolled out of sight. | You cannot tell what you are about to paint without hunting. | A fixed brush readout that never scrolls: name, swatch, and the map character it will write. Keep the border as a secondary cue and add `aria-pressed` (the game's tactical button already does, `ui/hud.js:134`). | XS |
| **C4** | The tooltip reports the map character and nothing else (`editor.js:543-545`). The registry it reads carries `solid`, `tall`, `height`, `onEnter`, `loot`, `examine`, `surface`, `topple`, `hp`, `shop`, `carpet`, `model`. Partition, door, player-start and the four enemy brushes get no `title` at all. | Nothing in the editor says what a tile *does*. Whether a prop blocks a shot is invisible (see I7). | Build the tooltip from the def: label, then badges — blocker / sight-blocker / cover / surface:*id* / rummageable / breakable / topples / merchant / exit — plus `examine`. Same data, one function, no new content. | S |
| **C5** | `index.html:39-42` ships the game HUD unconditionally; `#stats` never gets filled in editor mode, leaving an empty bordered pill bottom-left. | A visual artifact where the editor's own status strip should live. | Hide `#hud` in `startEditor` and reclaim the corner for the strip C1/C3/C2/B1 all want. One element serves all four. | XS |
| **C6** | `enemyPalette` holds three colours indexed modulo its length (`editor.js:107-109`). `ENEMY_TYPES` order is `manager, executive, hr, security-guard` — so **Manager and Security Guard are the same red**, unlabelled boxes. | Two enemies with different stats, AP, loot and `attackAp` are indistinguishable on the map you are balancing. It degrades further as the registry grows. | Derive the colour from the id (hashed hue, or an editor colour on the def) and render the enemy's character on the marker via the sprite technique `tile-renderer.js` already has. Assert distinctness in a unit test. | XS |
| **C7** | No grid lines, no rulers, no boundary frame, no hover highlight. `renderFloor` deliberately draws continuous carpet with ±0.018 tint variation so surfaces "read as continuous carpet instead of a grid of tiles" (`tile-renderer.js:28-29,36-40`) — correct for the game, wrong for the tool. | Counting cells is done by eye against a surface engineered to hide cell boundaries. | An editor-only toggleable overlay: cell-boundary lines, tick labels every 5 cells, a frame at the map extent. Keep it in `editor.js` so the game's look is untouched; default it on. | S |

---

## D. The palette and the command surface

| ID | Today | Cost | Fix | Size |
|---|---|---|---|---|
| **D1** | 94 buttons — 87 tile types + 4 enemies + partition, door, player start — as text-only labels across 10 category rows, with no search, no filter, no recently-used, no favourites, no icons. Ten types have no `label` and render their raw id (`meeting-floor`, `coffee-spill`). | Finding a brush is a linear scan of a scrolling list. This is the single most-repeated action in the tool. | In value order: (1) a filter input that hides non-matching buttons per keystroke, ~15 lines; (2) a pinned row of the last 6–8 brushes used, maintained in `selectBrush`; (3) a colour swatch per button from `TILE_TYPES[id].color`, which every tile already has. | S |
| **D2** | Everything is appended to one element. In DOM order: partition, door, ten full-width category rows, player start, four enemies, then the size controls, the level loader, Playtest, Export, Reset, Exit — all inside the `42vh` scroll box (`editor.js:470-610`). | The six commands you use most are the last children of the list you scroll through most. | Split into two elements: a fixed never-scrolling command row (loader, size, Playtest, Export, Reset, Exit, brush readout) and a scrolling palette above it. This also fixes C3 and gives A3 somewhere to put visual separation. | S |
| **D3** | `snack-machine` carries `category: 'furniture'` (`data/tiles.js:268`), which is absent from `CATEGORY_ORDER` (`editor.js:516-517`) — so it sorts last (`-1 + 1 || 99`) as a one-button row labelled FURNITURE. | A stray category row for a single common prop, below everything. | Either add `furniture` to `CATEGORY_ORDER` or move the entry into `breakroom`. One line. | XS |
| **D4** | The bar is capped at `maxHeight: 42vh` (`editor.js:479`) and cannot be collapsed. | On a laptop the palette owns nearly half the vertical viewport, permanently, over the map it sits on. | A collapse/expand chevron dropping it to the command row, with the state remembered. | XS |
| **D5** | Playtest, Export, Reset and Exit all go through the same `btn()` helper with identical chrome (`editor.js:481-490`). | Two safe actions and two destructive ones look the same and sit adjacent. | Covered by A3 and D2. | — |

---

## E. The editing vocabulary

The whole vocabulary is one cell, or one edge, at a time.

| ID | Today | Cost | Fix | Size |
|---|---|---|---|---|
| **E1** | No region selection, no copy, no paste, no stamp. The three callbacks each resolve to one `paint(tile)` or one `paintEdge(...)`. | The repeated-cubicle workflow — the archetypal office-level job — is done cell by cell, every time. | Marquee select → capture a rectangle of characters and edge runs → paint that block repeatedly. See S2 for the reference interaction. **Note:** this needs `createControls` extended — a mouseup callback does *not* exist (`controls.js:117-120` consumes `EVENT_MOUSEUP` internally) and no modifier state is plumbed. `main.js:3007` also consumes `createControls`, so the signature change touches both. | L |
| **E2** | No rectangle, line or flood fill. | Walling a room is one click per cell. | Shift-drag rectangle, shift-click line, and a bucket fill reusing the flood fill this codebase already has for conduction pools. Blocked on the same `createControls` extension as E1. | S |
| **E3** | No eyedropper: nothing reads the map to set the brush. | Reusing a type already on the map means hunting the 94-button palette for it. | Alt-click sets `brush` from the cell under the cursor. XS once modifiers are plumbed. | XS |
| **E4** | `onLeftDragTile` forwards one tile per mousemove (`controls.js:131-133`) with no interpolation. | A fast drag leaves gaps in the painted line. | Keep the last painted tile and walk the integer line to the current one. A few lines. | XS |
| **E5** | Right-click erases whatever the *brush* is about, not what is under the cursor (`editor.js:433-434`): with a tile brush, right-clicking a partition erases the cell and leaves the partition. There is no right-drag — only `leftHeld` gates dragging. | Erasing requires first selecting the right brush to erase with. | Make erase target-driven: if `nearestEdge(g)` carries a wall or door, erase that; otherwise erase the cell. Add `rightHeld` + `onRightDragTile` mirroring the left pair. Note this competes with E6 for the same button. | S |
| **E6** | No brush can paint void: `charForBrush` can only return `'@'`, an enemy character, or a tile character, and `' '` is reserved (`editor.js:63-73`). Right-click erase paints floor; resize fills with floor. The load path *preserves* void (`:325`) and even manufactures it as ragged-row padding (`:342`). | Void is a first-class cell — it is the airspace the layer model is built on, and `spike-lobby` layer 1 already ships 90 void cells. You can destroy it and never restore it. Non-rectangular floor plans are hand-authoring only. | A void brush. The plumbing all works already: `parseLevel` handles `' '` (`grid.js:82-84`), `renderCell` early-returns on it (`:161`), `effectiveTypeAt` maps it to null (`:134`), `toJson` needs no legend entry, and the game skips null cells (`scene.js:61-62`). | XS |
| **E7** | `levelName`, `levelNext` and `levelDepth` are declared, assigned once in `loadLevel`, re-emitted in `toJson` — and touched by no UI (six lines total in the file). | The editor never boots blank, so every export **inherits** the base level's identity: its name, its `depth`, and its campaign link. A new floor 3 exports as "Floor 1 — Cubicle Row" pointing at level2. | A metadata strip in the command row: name, depth, next (a select over `LEVELS`). Named in EDITOR_PLAN M0. | S |
| **E8** | No blank level, no delete, no rename, no templates. `Reset` reloads the *boot* level rather than clearing the canvas — and because the reload falls through `main.js`'s cascade to campaign progress, Reset with a saved run on Floor 2 drops you into the editor on Floor 2. | There is no "new floor" action in a level editor. | A "New" action taking a size and a fill type; templates can wait for a designer view on which ones (**IQ1**). | S |
| **E9** | Grid grows and shrinks from the right and bottom only (`editor.js:400-422`). | You cannot add a corridor to the north or west without repainting the map. | Anchor-aware resize: shift `rows` and re-key the four edge Sets when growing from top/left. The edge re-keying is the real work. | M |

---

## F. Keyboard, camera and view

| ID | Today | Cost | Fix | Size |
|---|---|---|---|---|
| **F1** | `src/editor.js` registers **zero** keyboard handlers — no `addEventListener`, no `app.keyboard`. `createApp` builds a `pc.Keyboard` (`scene.js:14`) the editor never uses. The game's own key ladder (`main.js:3582-3646`) and god mode's seven handlers all live inside `startGame`, which editor mode never enters. | Every action requires a mouse round trip to a button. No Ctrl+Z, no Escape to close the export modal, no brush hotkeys, no tool letters. | A single `window` keydown handler in `startEditor`. Cheapest ergonomics win available; prerequisite for A1's Ctrl+Z, E2/E3's modifiers, and F3's `T`. | S |
| **F2** | The camera orbits and zooms around one point chosen at boot (`editor.js:430`) and never updated. **And the obvious fix is inert as written:** `controls.pan()` only mutates `baseX`/`baseZ` (`controls.js:240-241`) and `recenter()` only clears flags (`:247-250`); the only code that moves the rig is `follow()` (`:272`), and `controls.follow` is called from exactly one place in the repo — `main.js:4060`, inside `startGame`'s update loop. The editor's only per-frame hook is `renderer.animate` (`editor.js:97`). | On a large map you orbit around a fixed centre and cannot bring an edge into view. | Add a per-frame `controls.follow(...)` call in `startEditor` *first*, then WASD/arrow pan, `Home` to recenter, and a fit-to-map. Without the follow call, pan and Home change nothing on screen. | S |
| **F3** | `controls.setTactical`/`toggleTactical`/`tactical` exist (`controls.js:292-339`) and step the pitch to dead overhead (`:47-53`). The game exposes it twice — a HUD rail button with `aria-pressed` (`ui/hud.js:122-141`) and the `T` key. `editor.js` never references any of them. | Overhead is where tile boundaries stop being ambiguous — `controls.js`'s own comment says so — and it is missing from the one place precise clicking matters most. | A toggle in the command row plus `T`, painting its lit state from `controls.tactical` the way `ui/hud.js:127-135` does. | XS |
| **F4** | Focus is `(map[0].length - 1) / 2, (map.length - 1) / 2` at boot (`editor.js:430`), never recomputed on resize or load. | Grow the map 20 columns and the camera still orbits the old centre. | Recompute focus in `loadLevel` and `resize`. Depends on F2's follow call. | XS |

---

## G. Accessibility

The dimension nobody had examined. Both items are `[proposed]` — no designer
signal exists on either.

| ID | Today | Cost | Fix | Size |
|---|---|---|---|---|
| **G1** | Mouse-only and specifically **middle**-and-**right**-button-only: orbit is middle-drag (`controls.js:105-106`), erase is right-click (`editor.js:433-434`), zoom is the wheel. `controls.js` has no touch handling at all, and `index.html:9` sets `touch-action: none` so the browser's own gestures are suppressed too. With F1 there is no keyboard fallback for anything. | A trackpad without a middle button cannot orbit. A tablet cannot edit. There is no partial path — the whole vocabulary is mouse-on-canvas. | `Alt`+left-drag or `Space`+drag as a second orbit binding; the keyboard pan from F2; the palette collapse from D4. | M |
| **G2** | Measured against the house style the editor imports its own chrome from (`ui/chrome.js:7-14`, whose header says the editor "must not look like a different game"): brush selection is colour-only with no `aria-pressed` (the game's toggle sets it, `ui/hud.js:134`); buttons are `7px 10px` at 12px ≈ 30px tall against the game's explicit `44px` hotbar slots (`ui/hud.js:240-241`); the bar sets no `userSelect`, so drag-painting selects label text; the level `<select>` has no `aria-label` and `cursor: auto`. | The editor is the least accessible surface in the project, and it diverges from a house standard the project already meets elsewhere. | A mechanical pass over `btn()` and `selectBrush`: `aria-pressed`, ≥40px targets, `userSelect: 'none'`, an `aria-label` on the select, and a required `title` argument to `btn()` so no control ships without one. | S |

---

## H. Authorability — what the format expresses that the editor cannot

| ID | Today | Cost | Fix | Size |
|---|---|---|---|---|
| **H1** | The editor paints two of the format's four actor kinds. Player (`editor.js:552-556`) and enemies (`:557-561`) have brushes; **companions** (`it-support` `'N'`, `mail-room` `'V'`) do not, and there is no way to emit an `<id>@<level>` tiered reference. `charForBrush` structurally cannot return one (`:362-366`). *(The `NPCS` registry is currently empty (`data/npcs.js:16`), so the NPC half of this gap has no content behind it today.)* | A second recruitable coworker, or a tougher Manager on a shallow floor, means hand-editing JSON — the exact thing the editor exists to remove. Combines with A11: they are invisible *and* unpaintable. | Drive the brush loop and `enemyByChar` from `ACTOR_REGISTRIES`/`actorLegend()` rather than `ENEMY_TYPES`. Add a small tier stepper beside the actor brushes emitting `id@n`. Named in EDITOR_PLAN M0; the gap list is designer-confirmed. **Promoted to load-bearing 2026-08-02:** with the floor curve struck (`PROGRESSION_PLAN.md` decision 13), an explicit per-placement tier is the *only* way to make a floor harder — so this brush is no longer a convenience, it is the difficulty-authoring tool. | M |
| **H2** | `parseLevel` resolves an actor cell to `'floor'` (`grid.js:117`), and `computeCarpetZones` refuses to let plain floor inherit (`tile-renderer.js:682`). The editor mirrors this exactly. | An enemy standing in the meeting room punches a grey hole in the carpet — visible in `levels/level2.json` today. | Format question, not a paint question — see **IQ4**. Cheapest no-format-change option: let cells `parseLevel` marked as actor-occupied inherit carpet like any other cell. | M |
| **H3** | `rotY` is a property of the tile *type*, not the placement. | Every desk, sofa and cabinet on every floor faces the same direction. Cubicle bays cannot face each other; a reception desk cannot face the door. The escape hatch — a `desk-east` type — is a code change *and* costs a scarce map character (A5). | **IQ4.** | M |
| **H4** | Every prop occupies exactly one tile; a model's overhang blocks nothing. | The two set pieces an office CRPG most wants — a boardroom table and a reception counter — cannot be authored honestly. Repeating a tile gives N desks, each with its own loot roll. | **IQ4.** Cheapest honest option: outline a model's real bounding box on hover so the mismatch is visible. | M |
| **H5** | A level's id is the key in `LEVELS` (`data/levels.js:14`), derived from the filename by the lint (`tests/unit/levels.test.js:467-469`). The JSON carries no id, and the export modal never mentions the registration step. | Pasting an export into `levels/` as instructed fails `npm test` at exactly one assert, with no hint in the tool that a second step exists. | Say so in the export modal at minimum; **IQ6A** removes the step entirely. | S |

---

## I. Seeing the fight

Everything here is `[proposed]` and rides on **IQ1**. No designer has asked for
any of it. All of it depends on C2's hover plumbing and a translucent draw layer
the editor does not have — and all of it will be redrawn when storeys arrive,
which is why I'd sequence it after M4.

| ID | The placement fact that is invisible | Evidence |
|---|---|---|
| **I1** | Connected regions — orphaned rooms, sealed enemies, unreachable loot. | The lint's reachability walk exists (`tests/unit/levels.test.js:398-411`) and never runs in the editor. |
| **I2** | Enemy watch cones — the whole basis of whether a stealth route exists. | Derived from level geometry; never drawn. SNEAK's cones are 2D today, which M3 must also address. |
| **I3** | Cover: which tiles are covered from which direction. | `coverCell` (`combat.js:466-469`) derives it from edges plus cover-grade cells. |
| **I4** | How many coworkers join one fight, and which lose their first turn. | `canTakePart` (`main.js:1358-1359`) and the surprise band are pure placement consequences. |
| **I5** | ~~What `depth` does to the enemies actually placed.~~ **MOOT as of 2026-08-02** — the designer struck the floor curve ("things shouldnt autoscale thats absurd… thats just lazy", `PROGRESSION_PLAN.md` decision 13). An enemy spawns at its placed tier, so there is no derived number to preview. What replaces it is smaller and better: show each placed enemy's **tier**, which is authored, not computed. Folds into C6's marker labelling. |
| **I6** | Fire spread and printer detonation chains. | Conduction *is* previewed live; fire is not — the asymmetry is the tell. Fire spreads to 4-neighbours through open edges, igniting `flammable` surfaces and arming `explosive` props (`surfaces-runtime.js:88-96`, `:123-141`). Reuse the conduction shape exactly. |
| **I7** | Whether a prop stops a thrown attack. | One threshold: `blocksSight(def) = solid && (tall \|\| (height ?? 1) >= 0.75)` (`data/tiles.js:97-99`). `bookcase` is 0.85 and blocks; `bookcase-low` is 0.4 and does not. Both are grey boxes in the paint view. Cheapest fix by far is C4's badge line. |
| **I8** | Enemies drift up to 2 tiles from where they are painted, so the placed position is not the position that matters. | — |
| **I9** | The floor's ammo, cash, XP and merchant budget. | A thrower can be authored dry. `ammoCostOf` (`stats.js:594-598`) gates arming; paper arrives from three sources (`main.js:2818`, `looting.js:189-191`, `:230`). The editor has every input and totals none of it. |

---

## J. The playtest loop

| ID | Today | Cost | Fix | Size |
|---|---|---|---|---|
| **J1** | Playtest boots the résumé desk and requires creating a character. | The fast loop has a character-creation screen welded into it, and a depth-4 floor is always tested by a fresh level-1 solo character — so "is this fight fair" is unanswerable in the tool. | **IQ5.** | S |
| **J2** | The stash has no expiry and sits at the top of the boot cascade (`main.js:97-112`); `main.js:274` means the floor-select desk — and the Continue button on it — never renders while a stash exists. | Playtest a half-built floor on Monday, open the game Tuesday, and you get the half-built floor with your run intact but invisible behind it. The only documented way out (`menu-restart`) wipes the save (A3). | Give the playtest badge (`ui/screens.js:469-481`) a second action, "Leave playtest", removing only `STASH_KEY`. A few lines, and it closes the trap without touching boot priority. | XS |
| **J3** | `playtesting` means three different things, so picking Floor 2 from the desk shows a "PLAYTEST — back to editor" badge. | A mode indicator that lies. | Split the flag. | XS |
| **J4** | Nothing can unset `playtesting` for a stashed level, so the exit path always takes the standalone arm regardless of `next` (`editor.js:595-599`, `main.js:103-112`). | Depth carry-over and the next-floor transition can never be tested from the editor. | Depends on **IQ5C**. | M |
| **J5** | The stash is a raw `toJson()` string — no id, no version, no metadata. A JSON-parseable but structurally invalid stash bricks the game *and* the editor with no in-app recovery. | Recovery means opening devtools and clearing localStorage by hand. | Stamp the stash with a version and a write time; refuse and clear a stash that fails a shape check, with a toast. | S |

---

## K. The pipeline

| ID | Today | Cost | Fix | Size |
|---|---|---|---|---|
| **K1** | No save-to-disk. `serve.mjs` is GET-only; `build.mjs` has no dev/prod split. Getting a level in is Copy → paste into `levels/` → hand-edit `data/levels.js` → rebuild. | Four manual steps between painting and playing, two of which can silently fail (H5). | **IQ6.** | M |
| **K2** | No import: the export textarea is `readonly` (`editor.js:627`). | The only way back into the editor is the single-slot playtest stash. | **IQ6B** — ~10 lines. | XS |
| **K3** | A load→export round trip is **semantically lossless** (verified by re-running the real `loadLevel`+`toJson` in node against both shipped files: map, walls, depth, next, every spawn and the tiered placement compare equal) but produces a whole-file diff from four sources: top-level key order, the actor legend growing to the whole registry, `"H 8 5"` re-spelling to `"H 8 5 1"`, and legend key order. `editor.js:456-457` and `:55-56` both claim otherwise. | A two-tile tweak reviews as a rewritten file. | Emit only the actor legend entries the map uses; match the source's key order. **Do not** "fix" the run spelling — the hand-authored files are internally inconsistent (level1's `walls` has explicit `1`s, its `doors` omits them), so normalising would break a currently-clean round trip. Note `JSON.stringify` hoists integer-like keys (`'9'` in level1), so no insertion order fully reproduces a hand-authored legend. Correct the two comments either way. | S |
| **K4** | No sharing path. The export modal's advice ("paste into `levels/`") is repo-shaped, but the editor ships to itch.io players. | A player who paints a floor cannot do anything with it. | **Now has a mechanism:** Supabase (`src/remote-store.js`) — designer-raised 2026-08-02. Cost is a second table plus RPCs against a store deliberately scoped to "the base minimum", and a `?level=` load path for rows. Worth its own question before it is worth code: **is the editor meant to be a player-facing feature at all, or a designer tool that happens to ship?** That answer, not the infrastructure, is what gates this. | L |
| **K5** | The editor's two e2e specs do not run on a pull request. | The regression test guarding companion round-trip is outside the gate that would catch a regression. | Add them to the PR job. | XS |
| **K6** | Every editor control except two brushes and the level dropdown is untested — including the Playtest button. | Any fix in this document ships covered by two specs that test carpet parity and companion survival. | Follows K7. | S |
| **K7** | `src/editor.js` cannot be imported outside a browser: `const pc = window.pc;` at module scope (`editor.js:19`). Verified — `node -e "import('./src/editor.js')"` throws `ReferenceError: window is not defined`. So the char allocator, the canonicaliser and the exporter have zero unit tests. | `ARCHITECTURE.md:193-200` states the house remedy for exactly this ("A rules module that needs the world takes a HOST, not the world"), and the editor is the one significant module ignoring it. The three allocator bugs in section A were all found by *transcribing* the logic into a scratch file to run it. | Extract the pure half into `src/level-doc.js` — rows, edge sets, legend allocation, `load`/`paint`/`resize`/`toJson`, no PlayCanvas. `editor.js` keeps rendering, input and DOM. This is also the prerequisite for the shared `src/level-lint.js` B1 needs, since that must run in node *and* the browser. Note `REFACTOR_PLAN.md:135` lists `editor.js` among files that are "large but coherent… Not god files" and so excludes it from the carve — on *cohesion* grounds, which this finding does not dispute. The case here is testability, which that entry does not consider. Worth re-opening explicitly rather than silently overriding. | M |
| **K8** | The shipped levels are hardcoded fixtures for ~20 e2e specs, and nothing says so. | Moving a desk in level1's break room turns the suite red in specs whose names have nothing to do with levels. The tool the docs point at for editing levels points at the files the suite measures itself against. | Give the e2e suite its own fixture floor under `levels/dev/` (already lint-exempt by location) reached via the `?level=` express lane, and migrate the coordinate-hardcoding specs onto it. | M |
| **K9** | 221 `.glb` files ship; the registries reference 79 distinct model paths. | The itch.io build carries several MB of art nothing points at. | A build-time reachability sweep over `TILE_TYPES`/`LOOKS`/class models, copying only what is referenced. | S |

---

## L. Campaign scale

| ID | Today | Cost | Fix | Size |
|---|---|---|---|---|
| **L1** | The only way to see what a floor looks like is to load it — and the `<select>` (`editor.js:589-592`) replaces your work with no prompt. No index, no thumbnails, no side-by-side. | Two of the three campaign-authoring workflows are blocked: "find the floor with the break room I liked" and "copy that cubicle bay from floor 2 into floor 4". The second is the region-stamp gap you confirmed — and a stamp is useless without a way to see the source. | Guard the select with a dirty-confirm (immediate, XS). Then render a thumbnail per registered level at boot — the editor already owns a renderer and a camera. | S |
| **L2** | Nothing authors or validates the campaign as a graph. | See B4. | See B4. | — |

---

## M. Verticality

The one `[stated]` design requirement the editor does not serve, and the one
with no workaround.

| ID | Today | Cost | Fix | Size |
|---|---|---|---|---|
| **M1** | Layered levels can only be produced by hand-writing JSON. A7 is the destructive half; this is the constructive half and it is larger. | You stated you need tall multi-storey spaces; the spike proved the runtime supports them; there is currently no way for you to make a second one. | EDITOR_PLAN M4: layer tabs, add/remove, per-layer height, a stair marker brush with live validation, and an onion-skin of the layer below. **IQ2** decides when. | L |
| **M2** | The layer format is documented only inside `EDITOR_PLAN.md`'s prose. | Hand-authoring is the only path and the recipe is not written down as a recipe. Also undocumented: `height` on layer *i* is the rise **above** storey *i* (`floors.js:26-31`), not that storey's own ceiling. | A `levels/README.md`: the `layers` array, per-layer `height`, void-as-airspace, the stairway marker run, and the loud validations in `floors.js`. Cheap, and unblocks **IQ2A** today. | S |
| **M3** | See A6 — `stairway` is paintable and should not be until layers are. | — | Hide it now, re-enable in M4. | XS |

---

## N. Content creation beyond placement

| ID | Today | Cost | Fix | Size |
|---|---|---|---|---|
| **N1** | The editor consumes `TILE_TYPES` but cannot create one. A new prop means a Blender conversion (`tools/fbx-to-glb.py`), a hand-measured scale, and a `height` number that silently decides whether the game shoots over it (I7). | "Content is data" holds for *placing* a prop and breaks for *creating* one. The real growth path — "the kit has a filing cabinet I want" — routes through Python, Blender and a hand calculation against an invisible 0.75 threshold. | Have `--report` print, beside each model's dimensions, the `height` it implies and whether that lands above or below `SIGHT_BLOCK_HEIGHT`. The script already computes real-world size. | M |
| **N2** | No README in the repo, no in-editor help, and the entry point is a 12px grey link on the class picker — a screen that is no longer the first thing you see, since the floor-select desk landed in front of it. | Onboarding a designer who has never opened the editor: they cannot find it, and if they find it they are told nothing — not that the partition brush works on edges, not that right-click's meaning changes with the brush. | Add the editor to the floor-select desk as a footer item; a `?` button opening a short static help panel. Pairs with C1. | S |

---

## O. Performance and debt

| ID | Today | Cost | Fix | Size |
|---|---|---|---|---|
| **O1** | Every **changed** cell re-serialises and re-parses the whole level and re-runs both global passes (`editor.js:384-386`, `:115-126`). Repaints of unchanged cells short-circuit (`:372`, `:220`), so drag events over already-painted cells are free. | Fine today at ≤40×40, but it means any multi-cell tool — fill, line, stamp, undo replay — is quadratic before it is written. | Batch: let a multi-cell operation mutate rows, then run the conduction/carpet refresh once at the end. Do this *before* E1/E2, not after. | S |
| **O2** | `resize` calls `renderAll` (`editor.js:421`), destroying and recreating every entity and re-instantiating each `.glb` prop. Growing to 40×40 takes ~30 clicks, each a full teardown of a map that is getting larger. | The advertised ceiling is a size nobody has ever opened the editor at. | Make `resize` incremental — it already knows which rows and columns changed. And measure the ceiling before defending it: build a 40×40 furnished floor and see. | S |
| **O3** | `ARCHITECTURE.md:429-430` still warns that the editor drops NPCs and companions on re-export. That was fixed on 2026-07-27 (`editor.js:329-335`, `:450-453`) with a regression test (`editor.spec.js:44-79`). | The stale warning steers authors *back* to hand-editing JSON — the opposite of what the tool is for. Half the sentence is still true: there is still no companion *brush* (H1). | Rewrite the sentence. Already listed in TODO.md:813 as "stale editor warning". | XS |

---

## Decisions

Only what this document itself decides. Everything load-bearing about the editor
lives in `EDITOR_PLAN.md`'s table and is inherited, not restated.

| # | Decision | Status | Source / notes |
|---|---|---|---|
| 1 | The in-repo editor is the authoring tool; the format stays grid + legend + ASCII + edge runs | `[stated]` | Inherited from EDITOR_PLAN decisions 1–2 (designer, 2026-08-01) |
| 2 | Verticality is required; the layer-stack model with generated stairs is the answer | `[stated]` / `[ratified]` | Inherited from EDITOR_PLAN decisions 3, 4, 6 |
| 3 | The QoL gap list — undo/redo, region stamps, actor brushes, save-to-disk — is real | `[stated]` | designer, 2026-08-01: "yes youre seeing the gaps i do". Confirms the *list*, not the scope; EDITOR_PLAN decision 9 (which of them is v1) remains `[proposed]` |
| 4 | This document is an inventory, not a build order; its groupings carry no priority | `[proposed]` | The sequence below is a proposal against **IQ1** |
| 5 | Findings that are design questions are surfaced as questions, not decided here | `[proposed]` | Per CLAUDE.md. Applies to IQ1–IQ6 and to every item in section I |
| 6 | Where a finding contradicts a comment in the code, the measured behaviour is recorded and the comment is treated as the defect | `[proposed]` | A5, K3, O3 — three comments currently describe behaviour the code does not have |
| 7 | This round is the painter, not the instrument: safety, closure and correctness; no encounter-preview overlays | `[ratified]` | IQ1, designer 2026-08-02: "painter". Section I sequences after M4 |
| 8 | A map character belongs to the level; the shipped-level lint relaxes to match `parseLevel` | `[ratified]` | IQ3, designer 2026-08-02: "i dont know the difference, ill defer to your judgement" — ratified by explicit deferral, with the caveat recorded at IQ3 |
| 9 | A placement can carry a rotation: an optional `props` sibling array, quantised to four orientations | `[ratified]` | IQ4, designer 2026-08-02: "4 different rotation can be set". Lifts H3 only — H4 (multi-cell props) is untouched |
| 13 | Playtest remembers the last class and skips the résumé desk; a configurable test party is deferred, not rejected | `[ratified]` | IQ5, designer 2026-08-02: "level 1 is fine" — given without knowing what `depth` does, so re-open when a floor deeper than ~3 is built |
| 10 | Cross-layer combat is LOS + reach only, no high/low-ground modifier | `[ratified]` | Inherited from EDITOR_PLAN decision 8, closed 2026-08-02. Recorded here only because it was answered in this doc's thread |
| 11 | The authoring pipeline is export → JSON file → git; the editor's job is to produce that file, not to host levels | `[stated]` | designer, 2026-08-02: "were just outputting to json and uploading to the git". Rules Supabase out of IQ6 — `src/data/levels.js:8-12` resolves levels as build-time static imports, so a database row cannot be a campaign floor |
| 14 | Enemies do not autoscale with floor depth; difficulty is authored per placement | `[stated]` | designer, 2026-08-02: "things shouldnt autoscale thats absurd… by floor i mean. thats just lazy". Recorded in full at `PROGRESSION_PLAN.md` decisions 13–14. Promotes H1 (tier brushes) to load-bearing and makes I5 moot |
| 12 | Supabase is a live option for level *sharing* (K4), which is a separate question from save-to-disk | `[proposed]` | designer-raised 2026-08-02 ("if we can use the supabase"). Gated on whether the editor is a player-facing feature at all — see K4 |

## The sequence for this round — `[ratified]` in shape by IQ1, `[proposed]` in order

Not a milestone plan; a reading of what is cheap, what unblocks what, and what
is dangerous to leave. **IQ1 answered A ("painter"), so this is the round.** The
ordering within it is still a proposal.

**Round 1 — stop the bleeding (all XS, no design questions).** A4 (allocator
reset — one fix, two bugs), A6/M3 (hide `stairway`), A7 (refuse layered levels),
A11 (actor markers), C1 (visible status line), C5 (kill the empty pill), C6
(enemy colours), D3 (orphan category), A3's `menu-restart` gate, O3 (the stale
doc line). A day's work; four of them are silent-data-loss bugs.

**Round 2 — make it safe to work in for an hour.** A1 (undo) + A2 (autosave) +
A3 (guards). These are the pair that decides whether the tool is trustworthy.

**Round 3 — make it tell you things.** F1 (a keyboard handler at all) then C2
(hover + ghost), C3 (brush readout), C4 (semantic tooltips), D2 (split the bar),
D1 (palette filter + recents). C2 is the prerequisite for all of section I, so
it earns its place twice.

**Round 4 — close the loop.** K7 (the testable seam) → B1 (shared lint + status
chip) → **IQ6**'s answer (save-to-disk or paste-back) → E7 (metadata strip) → H1
(actor brushes). K7 first because B1 needs to run in both node and the browser.

**Round 5 — the editing vocabulary.** O1 (batch the repaint) *before* E1/E2/E3,
then the `createControls` extension, then rect/line/fill/eyedropper/stamp.

**Round 6 — placement rotation (new, from IQ4).** The optional `props: [{x, z,
rotY}]` array: `parseLevel` reads it as per-cell overrides, `tile-renderer`
applies `rotY` at placement rather than from the type, the editor gets an R key
cycling four orientations on the cell under the cursor, and `toJson` emits it.
Sized M. Needs the F1 keyboard handler from Round 3, so it cannot lead. Worth
one deliberate decision while building it: whether a rotated prop's *collision*
rotates with its mesh, or stays the axis-aligned cell it is today — the honest
answer is the cell, and the hover-outline from H4 is how the author sees the
difference.

**Folded into the rounds above by the 2026-08-02 answers.** IQ3's lint
relaxation (`tests/unit/levels.test.js:413-419` → unique-within-level, not an
actor's, names a real type) belongs in Round 1: it is a few lines, it removes
A6's CI failure, and it lets `levels/dev/` come inside the campaign lint (B5).
Note it does *not* make `stairway` safe to paint — that is the invisible-wall
half, which still waits for M4.

Section I sequences after M4, per **IQ1**. Sections G, K8, K9, N are independent
and can slot anywhere.

## Risks and open questions (engineering)

- **`createControls` has two consumers.** E1/E2/E3 and G1 all need modifier
  state and a mouseup hook that `controls.js` does not expose
  (`:117-120` consumes `EVENT_MOUSEUP` internally). `main.js:3007` consumes the
  same factory, so the signature change touches the game's input path. Do it
  once, deliberately, rather than three times.
- **The status strip is four features wearing one hat.** C1, C3, B1 and A10 all
  want the same corner. Build the strip once, first, or build it four times.
- **K7 vs `REFACTOR_PLAN.md:135`**, which excludes `editor.js` from the carve as
  "large but coherent". That judgement is about cohesion and is fair; it does not
  weigh the fact that the module cannot be imported outside a browser at all, so
  none of its pure logic can be unit tested. Re-open it on those grounds
  explicitly rather than quietly overriding it.
- **A5 has no slack, and IQ3's answer does not create any.** 87 paintable types
  against 86 characters. Relaxing the lint (IQ3 = A) fixes *which* character an
  export may use; it does not add characters. The 87th distinct type in one level
  still has nowhere to go. Add the unit test that fails when the bound is crossed,
  and treat the real fix — the pool is per level, so the ceiling is only reached
  by a level using 87 distinct types — as a separate question if a floor ever
  approaches it.
- **K3's diff noise cannot be fully fixed.** `JSON.stringify` hoists
  integer-like keys, so no insertion order reproduces a hand-authored legend
  containing `'9'`. Get it close and correct the comments; don't chase byte
  equality.
- **Every overlay in section I gets redrawn at M4.** A cone or a cover tick
  drawn per storey is a different drawing problem than one drawn flat. This is
  the single strongest argument for IQ1A, which is the answer given.
- **The 40×40 ceiling is unmeasured.** O2's cost is verified structurally, not
  observed. Before defending or lowering the ceiling, build a furnished 40×40
  floor and look at it.

## Sources

Reference-editor claims were looked up rather than recalled, per CLAUDE.md.
Patterns worth stealing, with where they were checked:

- **Tiled** — stamp brush (capture a rectangle, then paint it repeatedly),
  tool-letter shortcuts, custom properties, `.world` files for a map-of-maps:
  [editing-tile-layers](https://github.com/mapeditor/tiled/blob/master/docs/manual/editing-tile-layers.rst),
  [keyboard-shortcuts](https://github.com/mapeditor/tiled/blob/master/docs/manual/keyboard-shortcuts.rst),
  [custom-properties](https://github.com/mapeditor/tiled/blob/master/docs/manual/custom-properties.rst),
  [worlds](https://github.com/mapeditor/tiled/blob/master/docs/manual/worlds.rst).
  The stamp is the direct answer to the repeated-cubicle workflow (E1); `.world`
  is the shape of L2.
- **LDtk** — per-instance entity fields (which map exactly onto tiered
  placements like `manager@3`, H1), level fields (E7), and the world view (L1):
  [entities](https://ldtk.io/docs/general/editor-components/entities/).
- **Divinity Engine 2 / BG3 Toolkit** — the reference games' own editors, for
  what an encounter-authoring surface exposes (spawns, triggers,
  playtest-from-here, J1/J4): [docs.larian.game](https://docs.larian.game/).
  Note these assume a scene graph and an asset database this project does not
  have; only the *workflow* ideas transfer, not the tooling.
- **Godot TileMap** — bucket fill, line and rectangle modifiers on the same
  click handler (E2):
  [using_tilemaps](https://github.com/godotengine/godot-docs/blob/master/tutorials/2d/using_tilemaps.rst).

## Method, coverage and provenance

Seven parallel audits (the editor implementation; format coverage; the runtime
systems that consume level data; the pipeline; the existing decision record; a
UI/UX critique; comparable editors), then an adversarial verification pass over
every code claim, then a completeness critic that found nine dimensions the
first seven had missed — campaign scale, the playtest loop as a loop, testing,
accessibility, art authoring, performance at the ceiling, encounter budget, the
constructive half of verticality, and onboarding. 138 raw findings, deduplicated
to the ~75 above.

Four claims were checked by *running* code rather than reading it — the
allocator, `loadLevel`'s canonicaliser and `toJson` were transcribed into
throwaway node scripts and run against the real registries and both shipped
levels. That is where A4's cross-load contamination, A5's exact 87-vs-86 bound
and K3's four diff sources come from.

**Not verified:** nothing was checked in a running browser (no display in this
environment), so O1's felt cost, O2's frame budget, the palette's real on-screen
height, and whether the camera at its distance clamp can frame a 40×40 map are
all reasoned from code rather than observed. They are marked as such above.

**Provenance warning, worth stating once.** Every designer quote this document
inherits exists only as a transcription inside a plan doc or a commit message
written by an earlier session. There is no primary source in the repo or on
GitHub — PRs #2, #10 and #50 carry zero comments and the repository has zero
issues. The one designer action with an independent record is the merge of
PR #50 on 2026-08-01. The quotes are very likely faithful, but they are
second-hand and cannot be re-verified. Treat `[stated]` tags here as inherited
from EDITOR_PLAN, not as independently sourced.
