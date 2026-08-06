// WHAT HAPPENS EVERY FRAME.
//
// The last big block of `startGame` (Q039): one `app.on('update')` callback,
// two hundred and forty lines long, driving every clock the game has - bodies
// walking, the storey climb, coworkers wandering, surfaces ageing, the
// out-of-combat turn clock, the HUD gates, the camera.
//
// It is a seam because ORDER is the whole content of a frame, and order was the
// one thing the block could not show while buried at the bottom of a
// three-thousand-line file. Three of the orderings here are load-bearing:
//
//   - the cutaway is judged BEFORE `playerLayer` flips at the top of a climb,
//     or the storey you are arriving on pops for one frame.
//   - the camera follows the entity's CONTINUOUS position, not `actor.x/z` -
//     the logical tile jumps a whole tile at a time and the camera stepped
//     along with the walk.
//   - a pan re-asks what the cursor is over, because the world slid under a
//     stationary mouse and the glow would otherwise stay pinned to what WAS
//     there.
//
// `playerLayer`, `climbAnim`, `partyBarKey` and `oocTurnClock` are the four
// bindings a frame writes, and all four go back through named setters - each
// one is read elsewhere in main.js, and a frame is not their owner.
export function createFrame(d) {
  return (dt) => {
    // Every party member walks and animates the same way. Logical tile effects
    // and exact feet travel are deliberately separate callbacks.
    if (d.party) {
      for (const m of d.party.members) {
        if (!m.actor) continue;
        m.actor.speed = d.memberSpeed(m);
        m.actor.update(
          dt,
          (x, z, done, changed) => d.onMemberStep(m, x, z, done, changed),
          (segment) => d.onMemberTravel(m, segment),
        );
      }
      if (d.sheet && !d.inCombat && !d.gameOver) d.updateFollowers(dt);
      d.sneakLayer.sweepTick(dt);
    } else {
      d.player.update(dt); // idling on the spawn tile behind the class picker
    }
    // Layered levels: ride the climb (the body's height follows its progress
    // up the flight), chain the next queued route leg when one lands, and
    // keep the cutaway honest about which storeys cover the leader.
    if (d.floors) {
      if (d.climbAnim && d.player.entity) {
        const pos = d.player.entity.getPosition();
        const travelled = Math.hypot(pos.x - d.climbAnim.sx, pos.z - d.climbAnim.sz);
        const k = Math.min(1, Math.max(0, (travelled - 0.5) / d.climbAnim.run));
        d.player.entity.setPosition(pos.x, d.climbAnim.y0 + (d.climbAnim.y1 - d.climbAnim.y0) * k, pos.z);
        // The rig climbs WITH the body: easing the focus height along the
        // flight is what kills the snap (and half the pop) at the landing.
        d.controls.setView({ focusY: d.climbAnim.y0 - d.lift + (d.climbAnim.y1 - d.climbAnim.y0) * k + 0.3 });
        if (!d.player.moving) {
          d.setPlayerLayer(d.climbAnim.toLayer);
          d.player.entity.setPosition(pos.x, d.climbAnim.y1, pos.z);
          d.controls.setView({ focusY: d.floors.baseY[d.playerLayer] + 0.3 });
          d.setClimbAnim(null);
        }
      }
      if (!d.climbAnim && d.legQueue.length && !d.player.moving && !d.inCombat) d.startNextLeg();
      // The covering test stands down mid-climb: the logical tile reaches the
      // landing before playerLayer flips, and judging "covered" off that
      // half-state is what popped the upper floor out and straight back in.
      if (!d.climbAnim) {
        d.scene.updateCutaway(d.playerLayer, (l) => {
          // In-bounds check first: typeAt reads 'wall' outside the map, and a
          // smaller upper storey must not count as covering the whole ground.
          const g = d.floors.layers[l];
          return d.player.x >= 0 && d.player.x < g.width && d.player.z >= 0 && d.player.z < g.height
            && g.typeAt(d.player.x, d.player.z) !== null;
        });
      }
    }
    const world = {
      paused: d.inCombat || d.gameOver,
      isWalkable: d.isWalkable,
      isHazard: d.enemyIsHazard, // wander avoidance uses the ENEMY hazard model
      blockedByParty: d.partyAt,
      occupied: (x, z, self) =>
        d.partyAt(x, z)
        || d.summonAt(x, z)
        || d.enemies.some((e) => e.alive && e !== self && e.x === x && e.z === z),
      // The CHANCE, not a pre-rolled verdict: actors.js runs the same
      // step-rules.slips predicate combat and the party do, so the tread that
      // saves a wanderer is checked by the same rule that saves you.
      slipChanceAt: d.slipChanceAt,
      stickGum: d.stickGum,
      onTravel: (unit, segment) => d.onEnemyTravel(unit, segment),
      // The same two the other side of the door already has: the tile's raw
      // facts, and what it bills a coworker. An amble runs the floor's rules
      // now [stated] (designer, 2026-08-03), and it runs them off the same
      // sheet and the same ENEMY damage model a coworker's combat walk uses -
      // what hurts a coworker has nothing to do with the player's shoes.
      floorAt: d.floorAt,
      surfDamage: (x, z) => d.rawSurfDamage(x, z),
      // A wander route never crosses hazards, other actors, or a party
      // member's tile; the enemy's own start tile counts as open. Returns it
      // smoothed.
      findWanderPath: (en, tx, tz) => {
        const open = (x, z) => (x === en.x && z === en.z
          ? d.grid.terrainOpen(x, z)
          : d.enemyClearOfHazards(x, z) && !d.partyAt(x, z));
        const p = d.findPath(open, en.x, en.z, tx, tz, null, d.grid.stepOpen);
        if (!p || p.length < 2) return null;
        // The wanderer rests at last amble's loose point, not its tile centre
        // - smooth from the BODY like every other feeder, or the first step of
        // each amble snaps back toward the centre (setPath's precondition).
        const pos = en.entity?.getPosition();
        if (pos) p[0] = [pos.x, pos.z];
        // amble to a loose spot in the tile, not its dead centre
        p[p.length - 1] = d.clampPoint(tx + (Math.random() - 0.5) * 0.7, tz + (Math.random() - 0.5) * 0.7);
        return d.smoothPath(
          d.routeOpen(open, p), p, d.grid.edgeOpen, d.enemyHazardSegmentCost,
        );
      },
    };
    let anyoneMoved = false;
    for (const en of d.enemies) {
      const beforeX = en.x;
      const beforeZ = en.z;
      en.update(dt, world);
      if (en.x !== beforeX || en.z !== beforeZ) anyoneMoved = true;
    }
    if (anyoneMoved) d.checkCombatTrigger(); // did someone just corner the player?
    // Temporary player-side allies use those same two streams.
    for (const s of d.summons) {
      s.actor.update(
        dt,
        (x, z, done, changed) => d.onTemporaryAllyStep(s, x, z, done, changed),
        (segment) => d.onTemporaryAllyTravel(s, segment),
      );
    }
    for (const npc of d.npcs) npc.update(dt); // idle in place, ease their facing
    // The bottom narrator box gets general narration only when nothing else
    // owns the bottom of the screen: not mid-fight (combat has its own log),
    // not mid-conversation (the dialogue panel is up), not pre-class-pick.
    // The narration box stays up in combat and in conversation now: examine
    // text and incidental narration used to vanish entirely during both, which
    // is what made every examine description look broken.
    d.ui.setNarrationGate(!!d.sheet && !d.gameOver);
    // Persistent hotbar: visible only when it can act; ammo counts refresh
    // when they change (the gate keeps DOM writes off the hot path). Armed
    // out-of-combat target rings redraw each frame, like combat's own.
    if (d.hotbarHost.hotbar) {
      // Visible whenever it can act - which now includes a fight. Hiding it in
      // combat was what forced combat.js to build a second bar, and cost the
      // fight the layout, the pager, the item slots and the number keys.
      // Whether it CAN act is this file's question; everything downstream of
      // the answer - visibility, the ammo count, the pocket contents - belongs
      // to the bar and now lives with it.
      // `show` is still needed HERE: the out-of-combat aim rings below are
      // main.js's, and they are gated on the same answer the bar is. It used
      // to be a local declared inside the block that moved out - deleting the
      // block took the declaration with it and left the reads behind, which
      // threw once per frame and killed the update loop, and a dead update
      // loop is an AI turn that never ends.
      const show = !!d.sheet && !d.gameOver && !d.modalOpen();
      d.hotbarHost.syncFrame(show);
      // What an armed slot rings depends on what it aims at: a coworker
      // (every attack and throw), a spot on the floor (a summon), the
      // hovered furniture/partition (shove - which ALSO rings coworkers,
      // they're targets too), or the hovered shield (take cover).
      // The crouch you are in draws whatever is armed - it is not an aim, it
      // is the state of the character. drawCoverAim is called EVERY frame and
      // gates itself on its own query, so its eased ring resets the moment
      // cover stops being the armed verb - gated at the call site, a disarm
      // would leave the ease pointing at wherever cover was last aimed.
      if (show && !d.inCombat) { d.hover.drawHeldCover(); d.hover.drawCoverAim(dt); }
      const explorationMode = d.armedOoc
        ? d.ACTIONS[d.armedOoc]?.exploration?.mode
        : null;
      if (!show || d.inCombat || (explorationMode !== 'cone' && explorationMode !== 'zone')) {
        d.hover.hideAimPaint();
      }
      if (show && !d.inCombat && d.armedOoc) {
        if (explorationMode === 'summon') d.hover.drawSummonDrop();
        else if (explorationMode === 'zone') d.hover.drawZoneAim();
        else if (explorationMode === 'cone') d.hover.drawConeAim();
        else if (explorationMode === 'cover') { /* drawn above, every frame */ }
        else if (explorationMode === 'shove') {
          d.hover.drawArmedTargets();
          d.hover.drawShoveAim();
        } else d.hover.drawArmedTargets();
      }
    }
    // Ctrl rings redraw each frame while held (immediate-mode lines last one
    // frame) - in and out of combat alike.
    if (d.hover.ctrlHeld && d.sheet && !d.gameOver) d.hover.drawCharacterRings();
    // Same deal for the out-of-combat reach ring: immediate-mode, so it has to
    // be reissued every frame it's meant to be visible.
    if (d.hover.glowHeld && d.sheet && !d.inCombat && !d.gameOver && !d.modalOpen()) d.hover.drawReachRing();
    // Party bar: redraw only when the roster state changes (names/HP/active,
    // plus per-member AP mid-fight); visible only once there's an actual
    // party to show.
    if (d.party) {
      const cp = d.inCombat && d.combat ? d.combat.party : null;
      const key = d.party.members
        .map((m, i) => `${m.sheet.name}:${m.sheet.hp}/${m.sheet.maxHp}${i === d.party.active ? '*' : ''}${cp ? ':' + cp[i].ap : ''}:${m.sheet.attrPoints || 0}/${m.sheet.classPoints || 0}p`)
        .join('|');
      if (key !== d.partyBarKey) { d.setPartyBarKey(key); d.partyBar.refresh(d.party, cp); }
      d.partyBar.setVisible(d.party.members.length > 1 && !d.gameOver);
      // The HUD level-up pip tracks the leader's banked points, out of combat.
      d.levelUpPip.refresh(!d.inCombat && !d.gameOver && !d.modalOpen() && d.sheet ? d.pending(d.sheet) : 0);
    }
    // Fire/smoke age in TURNS. In combat, combat.js advances one per round (via
    // the onRound callback in beginCombat). Out of combat there are no rounds, so
    // a real-time clock stands in - about one turn per OOC_TURN_SECONDS.
    if (!d.gameOver && !d.inCombat) {
      d.setOocTurnClock(d.oocTurnClock + dt);
      while (d.oocTurnClock >= d.OOC_TURN_SECONDS) {
        d.setOocTurnClock(d.oocTurnClock - d.OOC_TURN_SECONDS);
        d.runtime.advanceTurn();
        // ...and so are the statuses everyone is carrying. Same clock, same
        // `tickTurn`, same durations as a fight - see advanceStatusTurn.
        d.advanceStatusTurn();
        if (d.gameOver) break;
        d.ageSummons(); // temps you brought out of the last fight are on the clock
        // ...and so is the litter a power dropped. This clock stands in for
        // combat's rounds, so it has to spend everything a round spends (see
        // the onRound callback): without it, a Bulk Mail drift laid in the last
        // round of a fight froze mid-countdown the moment the fight ended -
        // permanently repainting the floor, permanently cutting anyone who
        // crossed it, and leaving a paper pile you could harvest forever.
        d.ageTempSurfaces();
      }
    }
    d.animateSurfaces(dt);
    // Live statuses wear their look: embers off a burning coworker, drips off
    // a bleeding one, motes circling whoever is stuck in mandatory training.
    // What each one emits is DATA (`fx` on the status, data/statuses.js); this
    // only reports who is carrying what. The tracker throttles itself, and
    // only asks for the roster on the frames it emits on.
    if (!d.gameOver) d.auras.sync(dt, d.collectStatusCarriers);
    // Impaired sight, off whoever you are STEERING - in a fight that's the
    // member whose turn it is (combat.actingSheet stays pointed at the last
    // party-side body even on the AI's turn, which is right: you are still
    // looking through their eyes while the coworkers move), out of one it's the
    // leader. A blinded companion you are not driving costs you their accuracy,
    // not your screen.
    const steeredSheet = d.inCombat && d.combat ? d.combat.actingSheet : d.sheet;
    const impair = !d.gameOver && steeredSheet ? d.statusFx(steeredSheet) : null;
    d.vision.set(impair?.aimSway || 0, impair?.sightBlots || 0);
    d.vision.update(dt);
    // A drifting aim goes stale the moment the mouse stops, so re-ask the world
    // what the crosshair is on. hover.js's rule is that the preview IS the
    // click, and the click is sampling a sway that never stops moving.
    if (d.vision.strength > 0) d.controls.refreshHover();
    // The loot overlay tracks the world while held (the camera keeps easing).
    if (d.loot.labelsVisible) {
      d.loot.repositionLabels((w) => {
        const s = d.worldToScreenCss(d.controls.cameraEntity, w.x, w.y, w.z);
        return s.behind ? null : s;
      });
    }
    // Keyboard camera pan (WASD/arrows), gated like the other game keys: it
    // detaches the rig from the follow target until something recenters it.
    // Opposed keys cancel per axis rather than fighting.
    if (d.panHeld.size && d.sheet && !d.gameOver && !d.modalOpen()) {
      const rx = (d.panHeld.has('right') ? 1 : 0) - (d.panHeld.has('left') ? 1 : 0);
      const uz = (d.panHeld.has('up') ? 1 : 0) - (d.panHeld.has('down') ? 1 : 0);
      if (rx || uz) {
        d.controls.pan(rx, uz, dt);
        // The world just slid under a stationary cursor - re-ask what the
        // hover is on, or the glow/banner stay pinned to what WAS there.
        d.controls.refreshHover();
      }
    }
    // Follow whoever you're STEERING, keeping them centred in frame. Track the
    // entity's CONTINUOUS position (actor.x/z is the logical tile, which jumps
    // a whole tile at a time and makes the camera step along with the walk).
    // The walls ghost for the same body, or you would be driving a character
    // the room keeps solid.
    // (`steeredSheet` above is this same question asked of the SHEET - vision
    // already read the acting body correctly; only the camera read `player`.)
    const steeredBody = d.steeredActor();
    const pp = steeredBody.entity ? steeredBody.entity.getPosition() : steeredBody;
    d.controls.follow({ x: pp.x, z: pp.z }, dt);
    d.updateWallFade(d.controls.cameraEntity, steeredBody.entity ? steeredBody.entity.getPosition() : null);
  };
}
