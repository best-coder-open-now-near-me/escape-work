// THE TEMP DESK, in a fight: who is on whose books, how a req is posted, and
// how a temp leaves without dying.
//
// A slice off `startCombat` (Q037). Two rules live here and nowhere else, and
// both are easy to break from the outside:
//
//   - the live cap is per-SUMMONER and outlives the fight. The explicit fight
//     population includes AI units and member records, including borrowed
//     units, then summon-rules owns the shared liveness/ownership predicate.
//   - dismissal is NOT death. No topple, no corpse, no loot, no XP - the temp
//     just leaves. A member drops its body (a null `actor` is already what
//     `slotAlive`, `livingMembers` and the initiative strip read as "not in
//     this fight"); an AI unit is marked not-alive so victory can be reached.
//
// `postableNow` is the question half of `resolveSummon`, split out because the
// act was being called as a predicate - it spawns, pushes into `engaged` and
// takes initiative slots, none of which a "can I?" should do.
//
// Both functions took a parameter named `d`, which is the deps bag's name here;
// they take `spec` now. That shadow is a documented trap in
// tools/check-extractions.mjs and it was in the code before this cut.
export function createSummonDesk(d) {
  const roomFor = (summoner, spec) => d.capRoom(spec, d.countLiveSummons(
    summoner, [...d.world.liveEnemies(), ...d.members],
  ));
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
  // How many bodies this descriptor could post RIGHT NOW - the question half,
  // with no spawning in it.
  //
  // It exists because `resolveSummon` was being called as a readiness predicate
  // while it is in fact the act: it spawns, pushes into `engaged`, applies
  // `surprised` and inserts initiative slots. That was survivable only while
  // `summon` was the top arm of the AI ladder, so the beat that followed always
  // paid for it. AI M6 inserted `support` above it, and the spawn became free
  // whenever triage won the turn - two employees, no AP, no cooldown
  // (REVIEW.md 2026-08-02 section 1.1). A plan-gathering call with side effects
  // is a live hazard the moment a ladder can reorder.
  //
  // Named for what it answers - how many actually turn up - because
  // summon-rules exports a `summonRoom` that answers a different question
  // (how much headcount is free) and main.js imports that one. Two meanings
  // under one name across two files is how the restatement below got written
  // in the first place; the cap math itself is the module's, composed here
  // rather than repeated.
  function postableNow(summoner, spec) {
    return d.dropCount(spec, roomFor(summoner, spec));
  }

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

  return { roomFor, dismissSummon, postableNow, resolveSummon };
}
