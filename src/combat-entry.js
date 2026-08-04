// HOW A FIGHT STARTS.
//
// A slice off `startGame` (Q039): the proximity test that notices one, the
// wiring that opens one, and the trigger the walk loop polls.
//
// They belong together because the same question is answered three times and
// must be answered identically each time - CAN these two take part in a fight?
// `adjacentEnemyToParty` asks it to decide a fight begins; `checkCombatTrigger`
// asks it again to decide who joins. Chebyshev distance alone used to answer the
// first and something else the second, which started fights through a sealed
// doorway that then could not END: doors cannot be opened in combat, closed
// doors block sight, so the coworker on the far side could never be reached,
// shot or seen while victory still required them down. Both now call
// `canTakePart`, which is why it arrives as one dependency and not two rules.
//
// The other decision worth seeing whole is the sneak handoff. A fight begun
// while sneaking judges surprise by SIGHT (SNEAK M4/D6), so who saw the
// initiator is captured BEFORE the sneak is cleared - the order matters, and it
// is one line apart in the same function.
export function createCombatEntry(d) {
  function adjacentEnemyToParty() {
    for (const m of d.party?.members || []) {
      if (!m.actor?.entity || m.sheet.hp <= 0) continue;
      // A sneaking body starts fights by being SEEN (the sweep), not by
      // proximity - standing unseen at somebody's shoulder is the whole
      // assassin fantasy (SNEAK_PLAN D1).
      if (d.hasStatus(m.sheet, 'sneaking')) continue;
      const en = d.enemies.find((e) =>
        e.alive && Math.abs(m.actor.x - e.x) <= 1 && Math.abs(m.actor.z - e.z) <= 1
        // Adjacency THROUGH a sealed doorway is not adjacency. Chebyshev alone
        // started fights across one - and because doors cannot be opened in
        // combat and closed doors block sight, the coworker on the far side
        // could then never be reached, shot or seen, while victory still
        // required them dead. The fight could not end.
        //
        // The test is the SAME one that picks the engaged set, deliberately:
        // "can these two take part in a fight together" should have one answer,
        // and using movement's stepOpen here asked a different question. That
        // rule needs all four edges around a diagonal corner open, which is
        // right for walking a body through and wrong for two people swinging at
        // each other past the end of a partition - so it refused fights that
        // plainly should have started.
        && d.canTakePart(m.actor, e));
      if (en) return { en, member: m };
    }
    return null;
  }

  // Start (or refuse to start) a fight. `engaged` is everyone joining now,
  // `primary` the coworker who triggered it (drives the flavor line + facing),
  // `opening` an optional { actionId, target } fired as the first move when the
  // fight is kicked off from the persistent hotbar.
  // --- sneaking (SNEAK_PLAN M2/M3) -------------------------------------------
  // A held MODE, not a verb: 'solo' sneaks the steered leader and parks the
  // followers where they stand; 'group' sneaks everyone (D4 - the pair BG3
  // ships). Detection is the deterministic cone (stealth.seesBody); spotted
  // means the fight starts (D3). THE RENDERED CONE IS THE RULE: the sweep and
  // the drawing read the same predicate with the same options.

  function beginCombat({ engaged, primary, opening = null }) {
    if (!d.sheet || d.inCombat || d.gameOver || !d.player.entity) return;
    // A fight begun while sneaking judges surprise by SIGHT (SNEAK M4/D6):
    // capture who saw the initiator BEFORE the sneak state is cleared.
    let sneakOpened = null;
    if (d.sneakLayer.sneak) {
      const opts = d.sneakSightOpts();
      const p = d.player.entity.getPosition();
      sneakOpened = {
        saw: new Set(d.enemies.filter((en) => en.alive && en.entity
          && d.seesBody(d.watcherOf(en), { x: p.x, z: p.z }, opts))),
      };
    }
    // However the fight found you, the sneak is over (M3) - quietly: the
    // opener's own line says what happened.
    d.endSneak(null);
    for (const m of d.party.members) m.actor?.clearPath(); // followers freeze too
    for (const e of d.enemies) e.clearPath(); // freeze any in-flight wander
    d.setPendingAction(null);
    d.setArmedOoc(null);
    d.hotbarHost.hotbar?.setArmed(null);
    d.dialogue.close();
    d.shopping.close(); // the machine can wait; it is not going anywhere
    d.inCombat = true;
    d.controls.recenter(); // a fight starts AT the party - a panned-away view returns
    d.ui.hideMenu();
    d.loot.hideLabels(); // no browsing the shelves mid-fight
    d.hover.clear();
    // Everyone close enough joins the brawl (those further than 2 tiles are
    // surprised and lose their first turn - see combat.js). Bystanders
    // outside the radius join later if attacked (combat.js joinCombat).
    d.player.faceToward(primary.x, primary.z);
    primary.faceToward(d.player.x, d.player.z);
    const live = engaged.filter((e) => e.alive).length;
    d.ui.say(live > 1
      ? `${primary.def.name} has noticed you. So have ${live - 1} other${live > 2 ? 's' : ''}.`
      : `${primary.def.name} has noticed you.`);
    const controller = d.startCombat({
      app: d.app,
      party: d.party,
      engaged,
      opening,
      sneakOpened,
      rng: d.combatRng,
      // A crouch taken before the fight rides into it (TACTICS_PLAN M6 OOC):
      // combat owns it from here - the status chip is already on the sheet.
      preCrouch: (() => { const c = d.oocCrouch; d.setOocCrouch(null); return c; })(),
      // Summons that outlived the last fight walk into this one - they're still
      // on the floor with turns left on the clock, so they fight.
      allies: d.summons.filter((s) => s.sheet.hp > 0),
      // The floor this fight is fought on (combat-world.js). The MUTABLE
      // bindings go in as getters, not values: a fight outlives a leader
      // switch, and a facade holding the sheet somebody had when combat opened
      // would answer every question about the wrong character.
      world: d.createCombatWorld({
        get sheet() { return d.sheet; },
        get player() { return d.player; },
        get combat() { return d.combat; },
        get party() { return d.party; },
        get enemies() { return d.enemies; },
        get summons() { return d.summons; },
        grid: d.grid,
        runtime: d.runtime,
        scene: d.scene,
        doors: d.doors,
        isWalkable: d.isWalkable,
        partyAt: d.partyAt,
        summonAt: d.summonAt,
        clampPoint: d.clampPoint,
        approachTo: d.approachTo,
        floorAt: d.floorAt,
        slipChanceAt: d.slipChanceAt,
        stickGum: d.stickGum,
        segmentClear: d.segmentClear,
        sightClear: d.sightClear,
        smoothPath: d.smoothPath,
        smoothFromBody: d.smoothFromBody,
        routeOpen: d.routeOpen,
        freeTilesNear: d.freeTilesNear,
        hazardCostFor: d.hazardCostFor,
        enemyHazardCost: d.enemyHazardCost,
        enemyClearOfHazards: d.enemyClearOfHazards,
        rawSurfDamage: d.rawSurfDamage,
        effectiveSurfDamage: d.effectiveSurfDamage,
        leaveSurfaceAt: d.leaveSurfaceAt,
        onSummonStep: d.onSummonStep,
        spawnSummonUnits: d.spawnSummonUnits,
        // Both of these are ALSO facade keys, which is exactly why they need
        // naming here: inside the object literal `findPath(...)` no longer
        // resolves to main.js's function, it resolves to nothing.
        findPath: d.findPath,
        dismissSummon: d.dismissSummon,
      }),
      fx: d.vfx,
      callbacks: {
        say: d.ui.say,
        // Double-click on an initiative row: put the camera on that body.
        // main.js owns the rig, so combat only names WHO.
        focusCamera: d.focusCameraOn,
        // Combat passes the acting member's sheet (initiative controls who you
        // drive); default to the leader for any callless use.
        updateHud: (s = d.sheet) => d.paintHud(s || d.sheet),
        // Repaint the shared bar. combat.js calls this wherever it used to
        // rebuild its own: control changing hands, and every refresh() that
        // moves AP, uses, paper or the armed slot.
        refreshBar: () => { if (d.hotbarHost.hotbar && d.sheet) d.buildHotbar(); },
        // One combat round = one fire/smoke turn (combat.js calls this as it
        // hands the turn back to the player).
        onRound: () => { d.runtime.advanceTurn(); d.ageTempSurfaces(); },
        onEnemyKilled: d.awardKill,
        onWin: () => {
          d.inCombat = false;
          d.combat = null;
          // Summons stay. They used to blink out the instant the last coworker
          // fell, which made a two-turn-old employee feel like a prop; now the
          // assignment (`lifetimeTurns`) is what ends them, whether that runs
          // out mid-fight, between fights, or in the next one. combat.js has
          // already swept any that were killed.
          d.syncLeaderBindings(); // control stays with whoever had the floor
          // A breather after every victory, so back-to-back fights aren't a
          // death spiral - wounds still carry over, just less brutally. The
          // whole party catches its breath, and the downed come to at 1 HP.
          for (const m of d.party.members) {
            if (m.sheet.hp > 0) m.sheet.hp = Math.min(m.sheet.maxHp, m.sheet.hp + d.VICTORY_HEAL);
            else {
              m.sheet.hp = 1;
              if (m.actor) m.actor.fx = null;
              d.ui.toast(`${m.sheet.name} comes to.`);
            }
          }
          d.ui.say(`The floor is yours. You catch your breath. (+${d.VICTORY_HEAL} HP)`);
          d.paintHud(d.sheet);
          d.refreshHotbarSlots(); // the combat-only verbs dim again with the fight over
          d.openLevelUps(); // spend the fight's promotions now that it's safe
        },
        onLose: () => {
          d.inCombat = false;
          d.combat = null;
          d.despawnSummons();
          d.loseGame('The office wins this round. Darkness falls between the cubicles.');
        },
      },
    });
    // A hotbar opener can kill the last coworker before startCombat even
    // returns - onWin/onLose already tore the fight down and nulled `combat`,
    // so binding the returned controller here would resurrect a dead one (and
    // a later abort would run its cleanup a second time).
    if (d.inCombat) d.combat = controller;
    // Rebuild the bar NOW that combat's rules own it: the combat-only verbs
    // (Take Cover, Deflect, the heals) light up the moment a fight starts,
    // not at whatever next press happened to rebuild the slots - which is
    // exactly how it used to read: "disabled until I pushed something".
    d.refreshHotbarSlots();
  }

  // Proximity trigger: a coworker adjacent to any party member starts the
  // fight (walk into range, or get cornered). Everyone within the engage
  // radius of the cornered member joins.
  function checkCombatTrigger() {
    if (!d.sheet || d.inCombat || d.gameOver || !d.player.entity) return;
    const hit = adjacentEnemyToParty();
    if (!hit) return;
    const { en, member } = hit;
    const engaged = d.enemies.filter((e) =>
      e.alive && Math.max(Math.abs(e.x - member.actor.x), Math.abs(e.z - member.actor.z)) <= d.ENGAGE_RADIUS
      // ...and who can actually take part. Somebody inside the radius but
      // sealed off joins a fight they can never act in, and victory needs
      // every engaged coworker down - so the fight would never end.
      && d.canTakePart(member.actor, e));
    beginCombat({ engaged, primary: en });
  }

  return { adjacentEnemyToParty, beginCombat, checkCombatTrigger };
}
