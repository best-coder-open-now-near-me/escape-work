// WHO IS CROUCHING, and who can see them.
//
// A slice off `startGame` (Q039): entering and leaving a sneak, the cone
// geometry every watcher projects, the sweep that catches a body in one, and
// the lines that draw them.
//
// Unlike the cuts before it, this one OWNS its state. `sneak` and the sweep
// cadence were two more `let`s in a four-thousand-line closure that only this
// cluster ever wrote; nothing outside asked to set them, only to read the mode
// and to end a sneak. So they go in as module state behind a `sneak` getter and
// `endSneak`, and no setter is exported - the arming model in `ooc-verbs.js`
// needed named setters because its other half genuinely lives in the click
// handlers, and this one has no other half.
//
// Why not `stealth.js`: that module is the pure rule - given an eye, a body and
// a cone, is it seen. This is the layer that knows there IS a party, that
// enemies wander, and that being spotted starts a fight.
export function createSneakLayer(d) {
  let sneak = null; // null | { mode: 'solo' | 'group' }
  let sweepT = 0;

  const sneakingMembers = () => {
    if (!sneak || !d.party) return [];
    const lead = d.partyLeader(d.party);
    return d.party.members.filter((m) => m.actor?.entity && m.sheet.hp > 0
      && (sneak.mode === 'group' || m === lead));
  };
  const sneakSightOpts = () => ({
    // Forgettable Face (SNEAK M6): the steered sheet's talent narrows every
    // cone watching the party.
    halfAngle: Math.max(10,
      d.STEALTH.CONE_HALF_ANGLE - (d.sheet?.talent?.effects?.coneShrink || 0)),
    range: d.STEALTH.CONE_RANGE,
    sightClearLow: (x, z) => d.grid.sightOpenCellLow(x, z) && !d.runtime.isSmoke(x, z),
    edgeOpenLow: d.grid.sightOpenLow,
  });
  // The watcher's eyes: continuous body, facing = the VISUAL yaw. Unusual on
  // purpose - facing rules elsewhere refuse the eased tween (TACTICS #5), but
  // the cone is drawn from the model and D2 says the cone you can see is the
  // rule, so here the tween IS the truth the player reads.
  const watcherOf = (en) => {
    const p = en.entity.getPosition();
    const r = en.yaw * (Math.PI / 180);
    return { x: p.x, z: p.z, facing: { x: Math.sin(r), z: Math.cos(r) } };
  };
  const bodyOfMember = (m) => {
    const p = m.actor.entity.getPosition();
    return { x: p.x, z: p.z };
  };
  const anyWatcherSees = (body, opts = sneakSightOpts()) =>
    d.enemies.some((en) => en.alive && en.entity && d.seesBody(watcherOf(en), body, opts));

  function endSneak(line = null) {
    if (!sneak) return;
    sneak = null;
    for (const m of d.party?.members || []) {
      d.removeStatus(m.sheet, 'sneaking');
      // The pose belongs to the sneak unless a held crouch owns it.
      if (m.actor && !(m.sheet === d.sheet && d.oocCrouch)) m.actor.crouched = false;
    }
    if (line) d.ui.say(line);
  }
  function toggleSneak(mode) {
    if (!d.sheet || d.inCombat || d.gameOver || d.modalOpen()) return;
    if (sneak) { endSneak('You straighten up.'); return; }
    const lead = d.partyLeader(d.party);
    const would = d.party.members.filter((m) => m.actor?.entity && m.sheet.hp > 0
      && (mode === 'group' || m === lead));
    // D8 (DOS2-confirmed): no slipping into a sneak somebody is watching.
    if (would.some((m) => anyWatcherSees(bodyOfMember(m)))) {
      d.ui.say('Someone is watching. Break their line of sight first.');
      return;
    }
    sneak = { mode };
    for (const m of would) {
      d.applyStatus(m.sheet, 'sneaking');
      m.actor.crouched = true;
    }
    if (mode === 'solo') {
      for (const m of d.party.members) if (!would.includes(m)) m.actor?.clearPath();
    }
    d.ui.say(mode === 'group'
      ? 'The whole department goes quiet.'
      : `${lead.sheet.name} slips low. The others hold here.`);
  }

  // Group sneak's followers price watched ground like a hazard (SNEAK M5).
  // The cheap wedge test only (range + angle, no trace): a follower that
  // routes around ground that MIGHT see it beats one that path-lawyers the
  // desk line and clips a cone with its shoulder.
  const inAnyCone = (x, z) => {
    if (!sneak) return false;
    const opts = sneakSightOpts();
    const cosLim = Math.cos(opts.halfAngle * (Math.PI / 180));
    return d.enemies.some((en) => {
      if (!en.alive || !en.entity) return false;
      const w = watcherOf(en);
      const dx = x - w.x;
      const dz = z - w.z;
      const dd = Math.hypot(dx, dz);
      if (dd > opts.range) return false;
      if (dd < 1e-6) return true;
      return (dx * w.facing.x + dz * w.facing.z) / dd >= cosLim;
    });
  };

  // The sweep (M3): every body against every cone, on the follower cadence.
  // First seen body busts the sneak and starts the fight with the spotter as
  // primary - exactly the bump-into-them opener, minus the bumping.
  function sneakSweep() {
    const opts = sneakSightOpts();
    for (const en of d.enemies) {
      if (!en.alive || !en.entity) continue;
      const w = watcherOf(en);
      for (const m of sneakingMembers()) {
        if (!d.seesBody(w, bodyOfMember(m), opts)) continue;
        const who = m.sheet.name;
        endSneak(null);
        d.ui.say(`${en.def.name} spots ${who}!`);
        const engaged = d.enemies.filter((e) => e.alive
          && Math.max(Math.abs(e.x - m.actor.x), Math.abs(e.z - m.actor.z)) <= d.ENGAGE_RADIUS
          && d.canTakePart(m.actor, e));
        if (!engaged.includes(en)) engaged.push(en);
        d.beginCombat({ engaged, primary: en });
        return;
      }
    }
  }

  // The cones, drawn only while sneaking (both references confirmed) -
  // immediate-mode lines like every combat affordance, from coneBoundary's
  // rays, which run the SAME crouch-height trace the sweep does: a cone
  // visibly stops at the desk it cannot see over.
  const CONE_COLOR = () => new d.pc.Color(0.92, 0.28, 0.2, 0.55);
  function drawSneakCones() {
    const opts = sneakSightOpts();
    const y = 0.15;
    for (const en of d.enemies) {
      if (!en.alive || !en.entity) continue;
      const w = watcherOf(en);
      const pts = d.coneBoundary(w, opts);
      const eye = new d.pc.Vec3(w.x, y, w.z);
      let prev = eye;
      for (const [px, pz] of pts) {
        const v = new d.pc.Vec3(px, y, pz);
        d.app.drawLine(prev, v, CONE_COLOR());
        prev = v;
      }
      d.app.drawLine(prev, eye, CONE_COLOR());
      // A few interior rays so the wedge reads as a watched AREA, not an
      // outline that could pass for a wall.
      for (let i = 2; i < pts.length - 1; i += 4) {
        d.app.drawLine(eye, new d.pc.Vec3(pts[i][0], y, pts[i][1]), CONE_COLOR());
      }
    }
  }

  // The per-frame half, cadence included: the sweep runs on the follower
  // clock, and the cones are drawn AFTER it because the sweep may have just
  // ended the sneak. That ordering was a comment in the update loop and is
  // now the only thing this function does, which is where it belongs.
  function sweepTick(dt) {
    if (!sneak || d.inCombat || d.gameOver) return;
    sweepT -= dt;
    if (sweepT <= 0) {
      sweepT = 0.25;
      sneakSweep();
    }
    if (sneak) drawSneakCones();
  }

  return {
    get sneak() { return sneak; },
    sneakingMembers,
    sneakSightOpts,
    watcherOf,
    bodyOfMember,
    anyWatcherSees,
    endSneak,
    toggleSneak,
    inAnyCone,
    sneakSweep,
    drawSneakCones,
    sweepTick,
  };
}
