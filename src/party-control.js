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
import { isLivingMember } from './member-rules.js';

export function createPartyControl(d) {
  // How fast this member's body actually walks.
  //
  // The status half is step-rules.speedUnderStatus, the same one actors.js and
  // combat.js use - it was written out here as a bare `speedMult` read, which
  // is a fourth copy of a one-line rule that is going to grow a second term
  // eventually. Quiet Shoes does not need its own arithmetic, only its own
  // ANSWER to "which effects apply": none, while its carrier is sneaking.
  //
  // The SURFACE term is deliberately only here, and that is not an oversight.
  // Out of combat a sticky floor is paid in wall-clock - you wade through the
  // spilled coffee. In a fight the same floor is paid in AP instead, through
  // `surfaceStepCost`, because a fight bills movement by distance and slowing
  // the animation would charge for it twice.
  function memberSpeed(m) {
    // Quiet Shoes (SNEAK M6): the sneak penalty vanishes for its carrier.
    // Coarse on purpose: while sneaking, the talent restores FULL status
    // speed - a gummed sneaker with these shoes also walks off the gum for
    // the duration, an accepted sliver for one line instead of un-merging
    // the status view.
    const effects = m.sheet.talent?.effects?.sneakSpeed && d.hasStatus(m.sheet, 'sneaking')
      ? {}
      : d.statusFx(m.sheet);
    let s = d.speedUnderStatus(d.BASE_SPEED, effects)
      * (d.SURFACES[d.runtime.surfaceAt(m.actor.x, m.actor.z)]?.slow || 1);
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

  // A hand up COSTS something now. It used to be free and unlimited - walk
  // over, click, they stand at 1 HP - which is the third automatic revive the
  // designer struck (TODO.md, 2026-08-02) and the one that would have made
  // striking the other two pointless. It spends an item carrying `revive`
  // (data/items.js) out of the helper's own pockets.
  const reviveIndex = (bag) => (bag || []).findIndex((id) => d.ITEMS[id]?.revive);
  function helpUp(m) {
    if (!m || m.sheet.hp > 0) return;
    // Whoever is doing the helping pays for it: in a fight that is the acting
    // member, out of one it is the leader - the same rule a consumable follows.
    const helper = (d.inCombat && d.combat ? d.combat.actingSheet : d.sheet);
    const i = reviveIndex(helper?.inventory);
    if (i === -1) {
      d.ui.say(`${m.sheet.name} is not getting up on encouragement alone. You need a first-aid kit.`);
      return;
    }
    const id = helper.inventory[i];
    const def = d.ITEMS[id];
    helper.inventory.splice(i, 1);
    m.sheet.hp = Math.min(m.sheet.maxHp, def.revive);
    if (m.actor) m.actor.fx = null;
    d.ui.say(`${def.useLog} ${m.sheet.name} is back on their feet at ${m.sheet.hp} HP.`);
    d.ui.updateStatsHud(d.sheet);
    d.refreshHotbarSlots();
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
    const i = d.party.members.findIndex(isLivingMember);
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
    reviveIndex,
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
