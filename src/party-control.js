// WHO IS THE LEADER, and where everybody else walks.
//
// A slice off `startGame` (Q039): switching control, the emergency handoff when
// the controlled member drops, re-keying the bindings after a fight, the
// follower gait, recruiting a bystander, and going down or being helped up.
//
// They belong together because they all answer one question - which body is
// `player`/`sheet` pointing at, and what do the others do about it - and they
// are the last cluster in this file that writes those two. Both arrive as
// setters for that reason: a leader switch is a thing that HAPPENS, and it
// should look like one at the call site.
export function createPartyControl(d) {
  function memberSpeed(m) {
    let s = d.BASE_SPEED
      * (d.SURFACES[d.runtime.surfaceAt(m.actor.x, m.actor.z)]?.slow || 1)
      // Quiet Shoes (SNEAK M6): the sneak penalty vanishes for its carrier.
      // Coarse on purpose: while sneaking, the talent restores FULL status
      // speed - a gummed sneaker with these shoes also walks off the gum for
      // the duration, an accepted sliver for one line instead of un-merging
      // the status view.
      * (m.sheet.talent?.effects?.sneakSpeed && d.hasStatus(m.sheet, 'sneaking')
        ? 1 : (d.statusFx(m.sheet).speedMult ?? 1));
    const lead = d.partyLeader(d.party);
    if (m !== lead && lead.actor
      && Math.max(Math.abs(m.actor.x - lead.actor.x), Math.abs(m.actor.z - lead.actor.z)) > d.FOLLOW_NEAR + 1) {
      s *= d.CATCH_UP;
    }
    return s;
  }

  function downCompanion(m) {
    m.actor?.clearPath();
    if (m.actor) m.actor.fx = { kind: 'death', t: 0 };
    d.ui.say(`${m.sheet.name} goes down. Breathing, but done for now.`);
  }

  function helpUp(m) {
    if (!m || m.sheet.hp > 0) return;
    m.sheet.hp = 1;
    if (m.actor) m.actor.fx = null;
    d.ui.say(`You haul ${m.sheet.name} upright. They pretend that was a stretch.`);
  }

  function recruitCompanion(npc) {
    if (!d.canRecruit(npc)) return;
    const idx = d.npcs.indexOf(npc);
    if (idx >= 0) d.npcs.splice(idx, 1);
    npc.recruited = true;
    const member = d.addMember(d.party, d.createCompanionSheet(npc.def, npc.typeId, d.sheet.level), npc);
    if (!member) return;
    if (npc.entity) {
      d.picking.unregister(npc.entity);
      d.picking.register(npc.entity, 'party', npc);
    }
    d.sayRecruited(npc.def.name);
  }

  function forceLeader() {
    const i = d.party.members.findIndex((m) => m.sheet.hp > 0 && m.actor);
    if (i < 0 || i === d.party.active) return;
    const m = d.party.members[i];
    d.clearOocCrouch(true); // the crouch belongs to the sheet that took it
    d.party.active = i;
    d.setSheet(m.sheet);
    d.setPlayer(m.actor);
    d.controls.recenter(); // the survivor stepping up is who the view should find
    d.setPendingAction(null);
    d.setArmedOoc(null);
    d.buildHotbar();
    d.paintHud(d.sheet);
    d.loot.refreshPanel(d.sheet);
    d.ui.say(`${m.sheet.name} takes over.`);
  }

  function switchLeader(i) {
    if (!d.party || d.inCombat || d.gameOver || d.modalOpen()) return;
    const m = d.party.members[i];
    if (!m?.actor || m === d.partyLeader(d.party) || m.sheet.hp <= 0) return;
    // Both calls go BEFORE the rebind, like the two sibling handoffs at
    // forceLeader and syncLeaderBindings - `clearOocCrouch` reads the module's
    // `sheet`/`player`, so after the rebind it strips 'covered' off the
    // INCOMING leader and leaves the real croucher crouched forever, which is
    // precisely the leak (Q060/Q066). `quiet` because a handoff CONSUMES the
    // crouch rather than abandoning it, and the "You take point" line below is
    // already the sentence for this moment.
    d.clearOocCrouch(true); // the crouch belongs to the sheet that took it
    // A SOLO sneak names the leader, and the naming is derived live
    // (`sneakingMembers` filters on the current leader) while the chip was
    // stamped at toggle time - so a portrait click used to silently swap who
    // the sneak meant, leaving the outgoing scout wearing the chip, skipped by
    // the fight trigger and absent from the spot sweep: un-triggerable and
    // un-spottable until something else ended the mode (Q061). Ended rather
    // than handed over, because re-stamping `sneaking` onto the incoming
    // leader would slip somebody into a sneak while they are being watched,
    // which is the one thing D8 refuses. Group mode names everybody, so it
    // survives the handoff untouched.
    if (d.sneak?.mode === 'solo') d.endSneak('You break off. The scout straightens up.');
    d.player.clearPath();
    d.setPendingAction(null);
    d.setArmedOoc(null);
    d.party.active = i;
    d.setSheet(m.sheet);
    d.setPlayer(m.actor);
    d.controls.recenter(); // control moved - a panned-away view follows it back
    d.buildHotbar(); // their attacks, their ammo count
    d.paintHud(d.sheet);
    d.loot.refreshPanel(d.sheet);
    d.charSheet.refresh(d.charSheetVm(d.sheet)); // an open sheet follows control
    d.ui.say(`You take point as ${m.sheet.name}.`);
  }

  function syncLeaderBindings() {
    if (!d.party) return;
    const lead = d.partyLeader(d.party);
    if (d.sheet === lead.sheet || !lead.actor) return;
    d.clearOocCrouch(true);
    d.setSheet(lead.sheet);
    d.setPlayer(lead.actor);
    d.controls.recenter(); // control settled on them - a panned-away view follows
    d.setPendingAction(null);
    d.setArmedOoc(null);
    d.buildHotbar();
    d.paintHud(d.sheet);
    d.loot.refreshPanel(d.sheet);
  }

  function updateFollowers(dt) {
    const lead = d.partyLeader(d.party);
    if (!lead.actor?.entity) return;
    // Solo sneak parks the party where it stands (SNEAK_PLAN D4): the
    // scout slips ahead alone and the others hold this spot.
    if (d.sneak?.mode === 'solo') return;
    // Where everybody on your side already IS, or is already walking to. The
    // parking spots below are picked with `isWalkable`, which is deliberately
    // pass-through for the party (so a follower can route THROUGH a teammate) -
    // but routing through one and parking on one are different questions, and
    // asking the movement predicate got the second one wrong. A follower
    // already standing beside the leader has no reason to repath, so it never
    // reached the old claim set at all, and the next follower cheerfully
    // picked the tile it was standing on.
    const claimed = new Set();
    const claim = (a) => {
      if (!a) return;
      claimed.add(Math.round(a.x) + ',' + Math.round(a.z));
      const dest = a.path?.[a.path.length - 1];
      if (dest) claimed.add(Math.round(dest[0]) + ',' + Math.round(dest[1]));
    };
    for (const m of d.party.members) if (m.sheet.hp > 0) claim(m.actor);
    for (const s of d.summons) if (s.sheet.hp > 0) claim(s.actor);
    for (const m of d.party.members) {
      if (m === lead || !m.actor?.entity || m.sheet.hp <= 0) continue;
      m.followT = (m.followT ?? 0) - dt;
      if (m.followT > 0) continue;
      m.followT = 0.25;
      const dist = Math.max(Math.abs(m.actor.x - lead.actor.x), Math.abs(m.actor.z - lead.actor.z));
      if (dist <= d.FOLLOW_NEAR) continue; // near enough - let any walk finish
      // Through the party, around everything else - which is exactly
      // isWalkable. Spelling it out again here meant a change to what blocks
      // movement would silently miss the followers (never re-implement it).
      const open = d.isWalkable;
      let spot = null;
      for (const [dx, dz] of d.DIRS8) {
        const sx = lead.actor.x + dx;
        const sz = lead.actor.z + dz;
        if (!open(sx, sz) || claimed.has(sx + ',' + sz)) continue;
        if (d.effectiveSurfDamage(sx, sz, m.sheet) > 0) continue; // no parking in fire
        if (d.inAnyCone(sx, sz)) continue; // and no parking in a watch (SNEAK M5)
        if (!spot || Math.hypot(sx - m.actor.x, sz - m.actor.z) < Math.hypot(spot[0] - m.actor.x, spot[1] - m.actor.z)) {
          spot = [sx, sz];
        }
      }
      if (!spot) continue;
      claimed.add(spot[0] + ',' + spot[1]);
      const p = d.findPath(open, m.actor.x, m.actor.z, spot[0], spot[1],
        (x, z) => d.hazardCostFor(m.sheet)(x, z) + (d.inAnyCone(x, z) ? 6 : 0), d.grid.stepOpen);
      if (!p || p.length < 2) continue;
      // A loose spot in the formation tile, not its dead centre - the party
      // used to park on a perfect grid ring around the leader (the one body
      // cluster on screen that still LOOKED tiled) while wanderers already
      // ambled to scattered points. Same jitter as theirs.
      p[p.length - 1] = d.clampPoint(
        spot[0] + (Math.random() - 0.5) * 0.7,
        spot[1] + (Math.random() - 0.5) * 0.7);
      const pos = m.actor.entity.getPosition();
      const spliced = [[pos.x, pos.z], ...p.slice(1)];
      // Watched cells are walls to the smoother while sneaking, exactly the
      // hazard rule: never straighten across a cone the route detoured
      // around (the route's own cells stay open through routeOpen).
      const base = (x, z) => open(x, z) && d.effectiveSurfDamage(x, z, m.sheet) <= 0
        && !d.inAnyCone(x, z);
      const s = d.smoothPath(d.routeOpen(base, spliced), spliced, d.grid.edgeOpen);
      m.actor.setPath(s);
    }
  }

  return {
    memberSpeed,
    downCompanion,
    helpUp,
    recruitCompanion,
    forceLeader,
    switchLeader,
    syncLeaderBindings,
    updateFollowers,
  };
}
