// WHAT THE OUTSIDE CAN SEE OF A FIGHT.
//
// `window.__combat`, the other half of Q155 - the debug surface `startCombat`
// published from inside itself, beside main.js's `__game`/`__god` (now
// debug-handles.js). Same reason for being a seam, and the same reason it is
// safe to move: nothing INSIDE the fight reads this object. It exists so a spec
// or a console can ask the closure questions.
//
// It is not, however, the same shape as `__game`, and the difference is the
// interesting part. `__game` is a window; this one has HANDS. Five members
// write:
//
//   - `set ap` and `set defended` edit the acting member's sheet in place, and
//     both must `refresh()` after - the action bar prices itself off exactly
//     these two and would otherwise show the pre-edit numbers until something
//     else happened to repaint.
//   - `set forceHit` / `set forceProc` write closure BINDINGS, not properties,
//     so they go through named setters. This is the one place in the file where
//     the e2e suite reaches in and changes how the dice land.
//   - `applyStatus`, `crouch`, `endTurn` and `summonAlly` route through the
//     real verbs (`charmUnit`, `crouchHere`, `advanceTurn`, `resolveSummon`)
//     rather than imitating them, which is what keeps a spec that pins a state
//     a test of the game and not of the pin.
//
// One name in here is a trap the checker knows by heart: the `applyStatus`
// property KEY sits directly above a call to the `applyStatus` RULE, and the
// two are different things. The key stays; the call is `d.applyStatus`.
export function createCombatHandle(d) {
  return {
    get phase() { return d.phase; },
    // The AI's working state for the unit whose turn it is, or null on a
    // player turn. This exists for DIAGNOSIS: when a fight stops handing out
    // turns, the action bar just reads "disabled", and the three explanations -
    // the AI beat is waiting, the acting unit is stuck part-way through a walk
    // (the driver returns early while `moving`), or the turn engine stalled -
    // are indistinguishable from outside. `wait` and `moving` tell them apart.
    get acting() {
      if (!d.acting) return null;
      const u = d.acting.unit;
      return {
        name: u.def.name, ap: d.acting.ap,
        wait: Number(d.acting.wait?.toFixed?.(2) ?? d.acting.wait),
        moving: !!u.moving, alive: !!u.alive, x: u.x, z: u.z,
      };
    },
    get ap() { return d.active.ap; },
    // The sparring tally (AI_PLAN M1). dmgTaken is an hp-diff read over the
    // enemy side, not instrumentation - net damage worn so far, so enemy
    // healing (M6) will understate it; the passive-party protocol doesn't
    // care, and the instrumented half (dmgDealt) is the one bouts optimize.
    get bout() {
      return {
        ...d.bout,
        beats: { ...d.bout.beats },
        dmgTaken: d.engaged.reduce((s, e) => s + (e.maxHp - Math.max(0, e.hp)), 0),
      };
    },
    // Where the acting member's BODY is (continuous, not the rounded tile) -
    // what a test aims project3 at to click on themselves. The tile alone is
    // off by up to half a tile at this camera angle, which is exactly the
    // mis-click the body-pick-first rule exists to prevent.
    get actingAt() { const p = d.posOf(d.active); return { x: p.x, z: p.z }; },
    // Who is holding an overwatch, by name (POWERS_PLAN M5). A stance is a
    // commitment that pays off on somebody ELSE's turn, so a test that cannot
    // see it can only assert the swing and guess at the cause.
    get watching() {
      return [...d.watching.keys()].map((u) => (u.sheet ? u.sheet.name : u.def.name));
    },
    // Who is crouched, and behind which cell (TACTICS_PLAN M6) - the suite's
    // window into the take-cover commitment and its lazy breaks. Edge-mode
    // crouches (against a partition) carry `edges` and no cell.
    // Who is crouched, WHERE, and which faces are covering them. `x, z` is
    // the tile they stand on - the crouch IS a position now, so there is no
    // separate shield cell to report - and `faces` is the live list the next
    // shot resolves against, which is what a spec should assert on.
    get crouched() {
      return [...d.crouched.entries()].map(([u]) => {
        const s = d.crouchStateOf(u);
        return s && {
          name: d.nameOf(u), x: s.at.x, z: s.at.z,
          faces: s.faces.map(([ox, oz]) => `${ox},${oz}`),
          covers: d.coverNames(s.at.x, s.at.z, s.faces),
        };
      }).filter(Boolean);
    },
    // The movement allowance left this turn (MOVEMENT_PLAN M2). 0 for a
    // character without the talent.
    get freeAp() { return d.active.freeAp || 0; },
    set ap(v) { d.active.ap = Math.max(0, d.roundAp(Number(v) || 0)); d.refresh(); },
    get armed() { return d.armed; },
    // The instant awaiting its confirm click, or null - the other half of
    // "which slot is lit", which is what the one-live-slot rule asserts on.
    get pendingConfirm() { return d.pendingConfirm; },
    // The hovered door's midpoint, or null - the threshold ring's own gate,
    // so a spec can assert the ring exists only while the cursor is on it.
    get hoverDoor() { return d.aim.hoverDoor; },
    // The aim wash (TACTICS_PLAN M7): which aim is painted and how many tiles
    // it covers. A test that can't see the wash can only assert the click.
    get aimPaint() { return d.aimPaint.debug; },
    get enemies() {
      return d.engaged.map((e) => ({
        name: e.def.name, x: e.x, z: e.z, hp: e.hp, alive: e.alive, statuses: d.statusList(e),
      }));
    },
    get maxAp() { return d.active.sheet.maxAp; },
    get defended() { return d.hasStatus(d.active.sheet, 'deflecting'); },
    set defended(v) {
      if (v) d.applyStatus(d.active.sheet, 'deflecting');
      else d.removeStatus(d.active.sheet, 'deflecting');
      d.refresh();
    },
    // The hit-roll pin (HIT_PLAN.md): true = always hit, false = always miss,
    // null = roll honestly. The e2e suite sets it to make combat deterministic.
    get forceHit() { return d.forceHit; },
    set forceHit(v) { d.setForceHit(v == null ? null : !!v); },
    // The weapon on-hit proc pin (EQUIPMENT_PLAN #8): true = always proc,
    // false = never, null = roll. The e2e suite pins it deterministic.
    get forceProc() { return d.forceProc; },
    set forceProc(v) { d.setForceProc(v == null ? null : !!v); },
    // The most recent attack roll { chance, hit }, and the to-hit chance the
    // armed-hover preview is currently showing - both for the e2e suite to
    // assert the previewed odds match the math that actually rolls.
    get lastRoll() { return d.lastRoll; },
    get hoverHitChance() { return d.aim.hoverHitChance; },
    get lastClickOutcome() { return d.lastClickOutcome; },
    // Is the movement trail currently drawn? Aiming at a coworker must replace
    // it with the to-hit readout, not draw both.
    get movePreview() { return !!d.aim.preview; },
    get usesLeft() { return d.active.usesLeft; }, // live { actionId: count } - edit in place, then call refresh()
    get party() {
      return d.members.map((m) => ({
        name: m.sheet.name, hp: m.sheet.hp, ap: m.ap, active: m === d.active,
        statuses: d.statusList(m.sheet),
      }));
    },
    // Test/debug: apply a status to the active member (STATUS_PLAN e2e). Enemy
    // statuses arrive naturally (a shove stuns, a fire tile burns).
    // Debug/e2e pin: land `id` on the acting member. `resist` defaults to 0 -
    // an unresisted, full-severity application, so a test pinning a status gets
    // exactly what it asked for - and pass a number to exercise Composure's
    // blunting (statuses.js severity) without building a character for it.
    // Apply a status to the acting member, or - with `targetName` - to a named
    // coworker. The enemy-side target exists because statuses on THEM are half
    // the system and were unreachable from outside: a spec that wants a
    // coworker to hold still (to drop a bookcase on them, to measure cover)
    // could only get there by playing out the power that applies it, which
    // makes the spec a test of that power instead of the thing it is about.
    applyStatus: (id, duration, resist = 0, targetName = null) => {
      const target = targetName
        ? d.engaged.find((e) => e.alive && e.def.name === targetName)
        : d.active.sheet;
      if (!target) return false;
      const ok = d.applyStatus(target, id, { duration }, resist);
      // Charm routes through the real borrow, so a spec that pins it exercises
      // the same code the action does rather than a parallel imitation.
      if (ok && id === 'charmed' && target !== d.active.sheet) {
        d.charmUnit(target, duration ?? d.STATUSES.charmed.duration);
      }
      d.refresh();
      return ok;
    },
    // Crouch a named coworker where they stand. Same rationale as the status
    // pin above: the enemy-side crouch is half of Pull Over's testable surface
    // (TACTICS_PLAN M8), and the only natural route there is steering the AI
    // into its turtle beat - which would make a pull spec a test of AI pathing
    // instead of the verb. Routes through the real `crouchHere`, so the
    // commitment it plants is the one the pull actually reads - and it returns
    // false when that tile has no shielded face, rather than planting a crouch
    // the rules would refuse.
    crouch: (targetName) => {
      const u = d.engaged.find((e) => e.alive && e.def.name === targetName);
      if (!u || !d.crouchHere(u)) return false;
      d.refresh();
      return true;
    },
    // End the ACTING turn programmatically. The e2e suite needs this: driving
    // rounds by clicking End Turn costs a DOM round-trip and a settle per turn,
    // which under software GL is seconds each - a spec that has to advance
    // three rounds spends its whole budget on the clicking rather than on what
    // it is testing. Same call the button makes.
    endTurn: () => { d.advanceTurn(); d.refresh(); },
    // The initiative order, top to bottom, with whose turn it is - for the
    // tracker UI and the e2e suite.
    // `current` stays SINGLE under a shared turn - it is the steered slot -
    // while `held`/`done` say who else is holding the open turn and who has
    // already ended theirs. `init` stays here for the tests even though the
    // strip no longer prints it.
    get order() {
      const heldSet = new Set(d.turns.held);
      return d.turns.order.map((s, i) => ({
        name: d.slotName(s), team: s.team, init: s.init,
        member: !!s.member, current: i === d.turns.index, alive: d.slotAlive(s),
        held: heldSet.has(s), done: d.turns.isDone(s),
      }));
    },
    get turn() { return d.turns.current ? d.slotName(d.turns.current) : null; },
    get summons() {
      return d.members.filter((m) => m.isSummon && m.sheet.hp > 0 && m.actor)
        .map((m) => ({
          name: m.sheet.name, x: m.actor.x, z: m.actor.z, hp: m.sheet.hp,
          turnsLeft: m.actor.summonTurns,
        }));
    },
    // Test/debug: drop a player-team summon beside the active member, as the
    // HR class's Post the Role does. Bypasses caps - callers set the count -
    // and takes an optional lifetime so a test can watch one time out.
    summonAlly: (id, n = 1, lifetimeTurns = null) =>
      d.resolveSummon(d.active.actor, 'player', { archetype: id, count: n, cap: n, lifetimeTurns }),
    refresh: (...a) => d.refresh(...a),
  };
}
