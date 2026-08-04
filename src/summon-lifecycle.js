// A TEMP'S WHOLE STAY: posted, counted, dismissed.
//
// A slice off `startCombat` (Q037/Q042). The four questions a summon raises are
// answered in one place because they are one rule seen from four angles:
//
//   - `postableNow` - how many could turn up right now (the question half)
//   - `resolveSummon` - post them (the act half)
//   - `liveSummonsOf` - how many are already on this summoner's books
//   - `dismissSummon` / `expireSummon` - take one off the board
//
// The split between the first two is not tidiness, it is a shipped bug. The
// question used to be asked by CALLING the act: `resolveSummon` spawns, pushes
// into `engaged`, applies `surprised` and inserts initiative slots, and it was
// being used as a readiness predicate. That survived only while `summon` was
// the top arm of the AI ladder, so the beat that followed always paid for it.
// AI M6 inserted `support` above it and the spawn became free whenever triage
// won the turn - two employees, no AP, no cooldown (REVIEW.md 2026-08-02 §1.1).
// A plan-gathering call with side effects is a live hazard the moment a ladder
// can reorder, which is why the two halves have separate names here.
//
// Leaving the board has two endings and they are opposites. A summon is
// DESTROYED; a borrowed coworker is RETURNED - they share the lifetime clock
// (one clock, nothing to keep in step) and nothing else. And a dismissal is not
// a death: no topple, no corpse, no loot, no XP. The temp just leaves.
//
// One name to be careful with: the descriptor parameter is `spec` here, not
// `d`. In the closure it was `d`, which in a module is the deps bag - the
// shadow that has shipped twice and made every other `d.` on the line a
// dead-zone read.
export function createSummonLifecycle(d) {
  // How many bodies are on this summoner's books. The cap is per-SUMMONER and
  // outlives the fight, which is the whole point of counting rather than
  // tracking.
  function liveSummonsOf(summoner) {
    const enemySummons = d.world.liveEnemies().filter((e) => e.summonedBy === summoner).length;
    const playerSummons = d.members.filter((m) =>
      m.isSummon && m.sheet.hp > 0 && m.actor && m.summonedBy === summoner).length;
    // A BORROWED minion is still on its summoner's books. It is in neither
    // count above: `liveEnemies` drops charmed bodies (that is what puts them
    // on your side), and a charmed member is `isCharmed`, never `isSummon`.
    // Without this leg, charming an HR employee frees the slot that posted it
    // and HR reinforces over its own cap.
    const borrowed = d.members.filter((m) =>
      m.isCharmed && m.sheet.hp > 0 && m.unit?.summonedBy === summoner).length;
    return enemySummons + playerSummons + borrowed;
  }

  // A summon's assignment ran out (or the fight it was called for is over and
  // main.js is sweeping): take it off the board WITHOUT killing it. This is not
  // a death - no topple, no corpse, no loot, no XP - the temp just leaves.
  //   a member  -> drop its body; a null `actor` is exactly what slotAlive,
  //                livingMembers and the initiative strip already read as "not
  //                in this fight", so nothing else needs to know.
  //   an AI unit -> mark it not-alive so victory can be reached, and hand the
  //                body back to main.js to destroy.
  function dismissSummon(target) {
    if (target.sheet) {
      const body = target.actor;
      target.actor = null;
      d.world.dismissSummon(body);
      // The floor can't be held by someone who just walked out.
      if (d.active === target) d.makeActive(d.livingParty()[0] || d.members[0]);
      return;
    }
    target.alive = false;
    target.loot = [];
    d.world.dismissSummon(target);
  }

  // The lifetime clock ran out. Wired into the turn engine's `expire` hook.
  function expireSummon(s) {
    // A BORROWED coworker is RETURNED, not dismissed. They share the lifetime
    // clock with summons - one clock, nothing to keep in step - but the endings
    // are opposites: a summon is destroyed, a colleague walks away.
    if (s.member?.isCharmed) {
      d.log(`The session drops. ${s.member.sheet.name} is theirs again.`);
      d.releaseCharm(s.member);
      return;
    }
    // The house voice was already they/them here; now it ASKS the character
    // rather than assuming, which is the whole point of storing the field.
    const w = d.pronounsOf(s.member?.sheet);
    d.log(`${d.slotName(s)}'s assignment ends. ${d.capitalize(w.subject)} `
      + `${d.verb(w, 'gather')} ${w.possessive} things and ${d.verb(w, 'go', 'es')}.`);
    dismissSummon(s.member || s.unit);
    d.refresh();
  }

  // How many bodies this descriptor could post RIGHT NOW - the question half,
  // with no spawning in it.
  //
  // Named for what it answers - how many actually turn up - because
  // summon-rules exports a `summonRoom` that answers a different question
  // (how much headcount is free) and main.js imports that one. Two meanings
  // under one name across two files is how the restatement it replaced got
  // written in the first place; the cap math itself is the module's, composed
  // here rather than repeated.
  function postableNow(summoner, spec) {
    return d.dropCount(spec, d.capRoom(spec, liveSummonsOf(summoner)));
  }

  // Post the req: spawn up to the descriptor's `count` for `team` beside the
  // summoner, never past its live `cap`. Returns how many actually showed up.
  //   enemy team -> AI actors: join `engaged` (counted for victory, queued next
  //     round) and take a `{unit}` initiative slot, surprised so they don't act
  //     the turn they're posted.
  //   player team -> temporary MEMBERS you control: a real sheet + body, its own
  //     action bar and AP, a `{member}` initiative slot. Not in party.members
  //     (outside the cap, unsaved); combat owns them, despawned at fight's end.
  //   `at` is the player's chosen drop point ({x,z}); without one (enemy AI,
  //   the debug hook) they report beside the summoner as before.
  function resolveSummon(summoner, team, spec, at = null) {
    const n = postableNow(summoner, spec);
    if (n <= 0) return 0;
    const spawned = d.world.spawnSummon(spec.archetype, team, summoner, n, at) || [];
    for (const rec of spawned) {
      // The contract. `lifetimeTurns` is how many of its OWN turns the unit
      // serves before it files out (beginTurn spends them; main.js's world
      // clock spends them out of combat). Omit it and the summon is permanent,
      // which is the old behavior and still what a descriptor gets by default.
      const body = team === 'enemy' ? rec : rec.actor;
      body.summonTurns = spec.lifetimeTurns ?? null;
      if (team === 'enemy') {
        if (!d.engaged.includes(rec)) d.engaged.push(rec);
        d.applyStatus(rec, 'surprised');
        // Arriving is an event: the temp lands in a puff of onboarding.
        d.fx.impact(body.x, body.z, 'toner', { y: 0.5, scale: 0.55 });
        d.insertSlot(d.unitSlot(rec));
      } else {
        const m = d.asMember(rec, { isSummon: true, summonedBy: summoner });
        d.fx.impact(body.x, body.z, 'toner', { y: 0.5, scale: 0.55 });
        d.members.push(m);
        d.insertSlot(d.memberSlot(m)); // slots in by its own roll; acts when its turn comes
      }
    }
    return spawned.length;
  }

  return {
    liveSummonsOf, dismissSummon, expireSummon, postableNow, resolveSummon,
  };
}
