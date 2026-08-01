# Sneak Plan

Sneaking: the party moves unseen through the office, slips past coworkers it
would rather not meet, and opens the fights it does want on its own terms.
This is the implementation plan - the design decisions (the shape ones were
put to the designer and answered, 2026-08-01), the module-by-module changes,
and the milestone order. No code yet.

It honors the one rule (ARCHITECTURE.md): **content is data, code is
systems.** The cone is a tunable block, the sneak state is a status registry
entry, the talents are effects bags on track nodes, and the sight rule is one
pure predicate the game and the tests share.

## Questions for the designer

None blocking - the four shape questions were asked and answered up front
(recorded as D1-D4 below). The smaller calls are tagged `[proposed]` in the
table with cheap defaults; the ones most likely to want a playtest verdict:

1. **The numbers.** Cone: 90 degrees wide, 6 tiles deep. Sneak speed: x0.7
   (DOS2's reported -30%). Ambush damage talent: +40% on the opening strike
   (DOS2 Guerrilla's confirmed number). All first drafts. `[proposed]`
2. **Stationary coworkers need a facing** and the levels don't store one -
   v1 derives it (face the nearest open run of floor). If a cone points
   somewhere silly, the fix is editor-authored facing, deferred. `[proposed]`
3. **No noise model in v1**: movement behind concealment is silent however
   fast it is. If sprinting past a desk reads wrong in play, footstep noise
   radius is the v2 hook. `[proposed]`

## Where we are today

- **There is no enemy perception.** Fights start on adjacency alone
  (main.js `checkCombatTrigger` / `adjacentEnemyToParty`: cheb <= 1 plus the
  `canTakePart` sight-through-doors rule). Nobody ever *sees* anybody -
  you bump into them. Sneak's real job is to introduce detection.
- **The payoff machinery already exists and is data.** The `surprised`
  status (skipTurn, statuses.js) with `SURPRISE_RADIUS` as its distance
  proxy at combat start; the ambush opener (`beginCombat`'s `opening` -
  the initiator takes the lead slot and fires the armed verb); backstab
  facing arcs; `ENGAGE_RADIUS = 4` pulling bystanders in.
- **Concealment geometry already exists.** The height threshold that lets
  shots sail over desks (`grid.sightOpenCell` / `blocksSight`) and grants
  crouch cover behind them; the crouch pose itself (actors.js `crouched`,
  in and out of combat); partitions as edges that block movement but not
  standing sight.
- **Cone geometry already exists** (powers.js `coneFrom` / `conePolyline`,
  pure wedge tests used by Bulk Mail) and enemies carry a combat `facings`
  sign-vector; out of combat wanderers have a heading and NPCs a yaw.
- **Statuses and talents are registries** (statuses.js with per-status fx;
  talents.js as name + effects bag with a known-effects whitelist).

## The inspirations, looked up (2026-08-01)

Per house rules these were researched, not recalled; the proxy blocked
direct wiki fetches, so claims rest on search-snippet attribution to the
named pages - marked confirmed/reported accordingly.

- **DOS2 Sneaking**: a free out-of-combat toggle; you cannot ENTER sneak
  inside someone's sight (confirmed - Fextralife/GameFAQs); NPCs project
  red facing cones shown while sneaking (~90 degrees, shrinking with the
  Sneaking civil ability - reported); entering a cone cancels sneak and the
  NPC engages (confirmed); sneaking costs ~30% move speed at rank 0
  (reported); Guerrilla grants +40% attack damage from sneak (confirmed);
  in-combat sneak costs a punitive 4 AP (confirmed) - which this plan
  defers entirely (D1).
- **BG3 Hide**: red sight cones on the ground; checks happen only INSIDE a
  cone (confirmed - bg3.wiki); attacking always ends Hiding (confirmed);
  initiating combat from Hidden applies the Surprised condition - lose the
  first round - to unaware enemies (confirmed), which is functionally the
  `surprised` status this game already ships; group-hide toggles the whole
  party with per-body checks (confirmed).

## Design decisions

| # | Decision | Status |
|---|----------|--------|
| D1 | v1 proves **ambush + slip past**. One detection model serves both: combat starts on DETECTION instead of adjacency-while-sneaking, so slipping past is what not-being-detected already is, and opening a fight unseen fires the existing ambush machinery. In-combat re-hide is deferred (DOS2 prices it at 4 AP and it needs last-known-position AI - v2). | `[stated]` (designer, 2026-08-01) |
| D2 | Detection is **facing cones + crouch height**, deterministic - no dice. Each coworker projects a wedge from their facing; a sneaking body is crouch-height, so desks (cover-grade cells) and chest-high partitions (edges) block sight TO it, reusing the shot-over-desks threshold. Walls, closed doors and smoke block as they do for standing sight. BG3-style contested checks were explicitly declined - the cone you can see is the rule. | `[stated]` (designer, 2026-08-01) |
| D3 | **Spotted means the fight starts instantly** - spotter as primary, plus everyone in ENGAGE_RADIUS, exactly like bumping into them today; no warning beat, no suspicion meter (both offered, declined). DOS2-confirmed shape. | `[stated]` (designer, 2026-08-01) |
| D4 | **Both modes, matching the references**: sneak toggles for the steered character alone (followers hold position where they stand) OR for the whole party at once via a group toggle - BG3 ships exactly this pair (per-character hide plus a group-hide button, confirmed) and DOS2 sneaks per character too. In group mode every body is tested against every cone and any one spotted busts the group; in solo mode only the sneaker is tested, and the parked party joins any fight that opens from wherever it was left. Group mode's weak link is follower pathing, so M5 makes followers skirt cones. | `[stated]` (designer, 2026-08-01: "bg3 and dos both have individual or group sneak, in bg3 theres a group sneak toggle button"; the group half first chosen in the shape Q&A the same day) |
| D5 | Sneaking is slower: member speed x0.7 while sneaking (DOS2's reported -30%), restored by a talent (D9). The pose is the crouch pose. | `[proposed]` |
| D6 | The ambush payoff is the existing machinery, extended one notch: a fight opened from sneak gives the initiator the lead slot (already built) and starts **every enemy with no line to the initiator** surprised - replacing the SURPRISE_RADIUS distance proxy for sneak-opened fights only. Normal fights keep the radius rule untouched. | `[proposed]` |
| D7 | Cone data: `STEALTH = { CONE_HALF_ANGLE: 45, CONE_RANGE: 6 }` in a tunable block; a wanderer's facing is its heading, a stationary coworker faces the nearest open run of floor; cones render red only while the party sneaks (both games confirmed). | `[proposed]` |
| D8 | You cannot ENTER sneak while any coworker currently sees you (DOS2-confirmed rule). Prevents the free mid-chase vanish. | `[proposed]` |
| D9 | Talents (registry entries, class-track nodes): **Quiet Shoes** - no sneak speed penalty; **Disgruntled** (Guerrilla-alike) - +40% damage on the opening strike of a fight you start from sneak; **Forgettable Face** - all cones 15 degrees narrower against your party. Numbers first drafts. | `[proposed]` |
| D10 | Attacking, rummaging, talking, or toggling a door ends sneak the moment the fight/interaction resolves - except doors, which may be opened WHILE sneaking (an office is doors; sneak that ends at every door is no sneak). No noise model attaches to it in v1. | `[proposed]` |
| D11 | Out of scope for v1: pickpocketing/theft (DOS2 gates it on sneak + Thievery - a whole economy question), in-combat hide, hearing/noise, XP compensation for slipped fights (the exit pays; watch for under-leveling, a DOS2-reported risk of avoidance play). | `[proposed]` |

## Architecture: where it lands

### Pure modules (unit-tested)

- **`src/stealth.js`** (new): the sight rule.
  `seesBody(watcher, body, { halfAngle, range, sightClearLow, edgeOpenLow })`
  - the wedge test (angle from the watcher's facing, true-distance range
  per DEGRID D4) plus a crouch-height line trace: `segmentClear` with a
  cell predicate that ALSO blocks cover-grade cells and an edge predicate
  that ALSO blocks partitions. Continuous bodies in, one boolean out.
  Facing derivation for stationary units lives here too.
- **`src/grid.js`**: the crouch-height sight predicates, beside their
  standing twins: `sightOpenCellLow` (tall solids AND cover-grade cells
  block) and `sightOpenLow` (closed doors AND partition edges block).
  Data already carries everything these read.
- **`src/data/statuses.js`**: a `sneaking` entry - icon, no clock (held
  until broken), `effects: { speedMult: 0.7 }`, fx block for the low
  posture tint. The crouch pose rides the actor's existing `crouched`.
- **`src/data/talents.js` + `stats.js`**: the three talent effects
  (`sneakSpeed`, `ambushDamage`, `coneShrink`) added to the known-effects
  list; `STEALTH` tunables in stats.js beside HIT and MOVE.

### PlayCanvas / DOM modules

- **`src/main.js`**: the toggle (key C + a hotbar affordance), the
  group-sneak state on the party, the detection sweep (throttled like the
  follower cadence: every 0.25s test each living member body against each
  live enemy cone; first hit -> `beginCombat` with the spotter as primary
  and sneak cleared), D8's enter-gate, and D10's sneak-breaking hooks in
  the interaction funnel. Followers keep following while sneaking (D4)
  with M5's cone-aware routing.
- **Cone rendering**: a pooled translucent wedge per live enemy, drawn only
  while sneaking - `conePolyline` for the outline, aim-paint's pooled-quad
  pattern for the fill, clipped by the crouch-height sight trace so a cone
  visibly stops at the desk it cannot see over. THE RENDERED CONE IS THE
  RULE - it must be drawn from the same `seesBody` predicate the sweep
  runs, or the affordance lies.
- **`src/combat.js`**: D6's one notch - `startCombat` already takes
  `opening`; a `sneakOpened` flag swaps the SURPRISE_RADIUS loop for the
  had-no-line-to-the-initiator rule; the Disgruntled bonus rides the
  opening strike the way talent effects already reach `attackMods`.
- **`src/hover.js` / HUD**: the seen/unseen eye - one readout while
  sneaking, keyed off the same predicate (one owner, per hover.js's rule).

### Persistence

`sneaking` is transient (never saved mid-sneak; a save drops the toggle,
like a crouch). No SAVE_VERSION bump.

## Milestones (each a PR that keeps `npm test` + e2e green)

1. **The sight rule.** `stealth.js` + the grid's crouch-height predicates,
   pure, with the unit table: in/out of the wedge at the boundary angles,
   desk blocks crouch sight but not standing sight, partition blocks,
   closed door blocks, wall blocks, smoke blocks, range is a circle.
2. **The toggles and the cones.** Both sneak grips (C sneaks the steered
   character and parks the followers; the group toggle sneaks everyone),
   crouch pose + speed, D8's enter-gate, cone rendering clipped by the
   sight rule. No detection consequences yet - you can walk through a cone
   and nothing happens, which is exactly what the e2e for this milestone
   pins (and why it lands before M3: the affordance must be inspectable
   before it has teeth).
3. **Detection opens the fight.** The sweep; spotted -> beginCombat with
   spotter primary + ENGAGE_RADIUS; sneak cleared for the party; D10's
   sneak-breakers. e2e: walk into a cone -> fight with that spotter; skirt
   behind the desk row -> no fight; rummage in someone's face -> fight.
4. **The ambush pays.** Sneak-opened fights: initiator leads (existing),
   unseeing enemies start surprised (D6), Disgruntled bonus on the opening
   strike. e2e: open from behind -> everyone surprised, opener crits the
   economy the talent promises; open in their face -> only the distance
   rule's surprise, as today.
5. **Followers skirt cones.** Follower and wander routing price cone cells
   (findPath's extraCost, exactly the hazard pattern), and formation spots
   inside a cone are refused - the group stops blundering through the
   watch. e2e: leader skirts a cone, followers detour around it.
6. **Talents and polish.** The three registry talents wired through their
   accessors; log lines; editor note for facing. The planned seen/unseen
   eye readout was CUT in implementation: under D3, "seen" and "the fight
   has already started" are the same instant, so the readout can only ever
   say "hidden" - the cones are the affordance, and the sneaking status
   chip on the sheet is the mode indicator. Revisit only if v2's warning
   beat (declined for v1) ever lands.

## Testing

- **Unit**: the seesBody table (angles at the sector boundary, each
  blocker class, the circle rim); facing derivation; talent effect math.
- **e2e**: M2's inert cones; M3's spot/skirt/bust triple; M4's surprise
  count and lead slot; M5's follower detour. The group-bust case: park a
  follower in a cone, leader safely hidden -> the fight still starts.
- **Play**: the numbers (question 1), stationary facings (question 2),
  silence (question 3).

## Risks and open questions

- **Group sneak's weak link is follower pathing** - accepted knowingly in
  D4. M5 mitigates with cone-cost routing; a tight corridor watched from
  both ends may be impassable for four bodies where one could slip it -
  and solo mode (D4's other half) is the built-in answer for exactly that
  corridor: park the party, slip it alone.
- **Invented facings** (D7): a stationary coworker's cone is derived, and
  a silly one (facing a wall) is a level-feel bug the editor can't fix
  yet. Cheap to hand-patch per level if it grates before editor support.
- **Detection cadence**: 0.25s sweep matches the follower cadence; a body
  sprinting through a cone tip between sweeps is technically possible -
  if it's exploitable, sample the crossed segment like trimToFirst does.
- **The exit pays, avoidance doesn't**: slipping every fight starves XP
  (DOS2-reported risk). Watch it in play; the lever is exit/objective XP,
  not per-fight compensation.
- **Cones during a fight**: v1 draws cones only out of combat. A fight
  running while OTHER coworkers wander unaware (charm, multi-group floors)
  leaves those cones live but undrawn - harmless (detection just starts
  nothing new while a fight runs), but decide before v2's in-combat hide.
