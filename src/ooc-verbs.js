// The OUT-OF-COMBAT verbs: what shove, take cover, a friendly cast and a
// summon posting do when there is no fight on, plus arming them and the walk
// that opens a fight with one already aimed.
//
// A slice off `startGame` (Q039). Unlike the earlier ones this cluster does
// WRITE shared state - `armedOoc`, `oocCrouch`, `pendingAction` and `lastPath`
// are all touched here and elsewhere - so those arrive as named setters rather
// than getters. That is the honest shape of it: these verbs are not a pure
// subsystem, they are the out-of-combat half of an arming model whose other
// half lives in the click handlers. Naming the writes is the point; a setter
// call is greppable in a way that `armedOoc = id` from anywhere in four
// thousand lines is not.
export function createOocVerbs(d) {
  function oocCoverProblem(x, z) {
    const here = d.player.x === x && d.player.z === z;
    if (!here && (!d.isWalkable(x, z) || d.enemyAt(x, z) || d.npcAt(x, z) || d.partyAt(x, z))) {
      return 'No room to tuck in there.';
    }
    if (!d.oocCoverFaces(x, z).length) return 'Nothing there to hide behind.';
    return null;
  }

  function oocTopplePlanAt(px, pz) {
    const def = d.grid.defAt(px, pz);
    if (!d.isToppleable(def)) return null;
    const landing = d.toppleLanding(d.player.x, d.player.z, px, pz);
    if (!landing) return null;
    const [lx, lz] = landing;
    if (!d.grid.terrainOpen(lx, lz) || !d.grid.stepOpen(px, pz, lx, lz)) return null;
    return { def, x: px, z: pz, lx, lz };
  }

  function oocCoverNames(x, z) {
    const seen = [];
    for (const [ox, oz] of d.oocCoverFaces(x, z)) {
      const cx = x + ox;
      const cz = z + oz;
      const body = d.enemyAt(cx, cz) || d.npcAt(cx, cz) || d.memberBodyAt(cx, cz);
      if (body) {
        const name = body.sheet?.name || body.def?.name || 'them';
        if (!seen.includes(name)) seen.push(name);
        continue;
      }
      // `def`, not `d` - the deps bag owns that name in this module now, and
      // the original's one-letter local would have shadowed it.
      const def = d.grid.defAt(cx, cz);
      const label = def && (def.cover || def.solid)
        ? `the ${(def.label || 'cover').toLowerCase()}` : 'the partition';
      if (!seen.includes(label)) seen.push(label);
    }
    if (!seen.length) return 'cover';
    if (seen.length === 1) return seen[0];
    return `${seen.slice(0, -1).join(', ')} and ${seen[seen.length - 1]}`;
  }

  function oocFriendlyOn(id, m) {
    const a = d.ACTIONS[id];
    const carrying = d.statusList(m.sheet).length;
    if (!a.purge) { d.ui.say(`${a.label} is for a fight.`); return; }
    if (!carrying) {
      d.ui.say(`${m.sheet.name} is running clean. Nothing to clear.`);
      return;
    }
    d.approachAndDo(m.actor.x, m.actor.z, () => {
      m.sheet.statuses = {};
      d.setArmedOoc(null);
      d.hotbarHost.hotbar?.setArmed(null);
      d.ui.say(`You power-cycle ${m.sheet.name}. Everything they were carrying clears.`);
      d.paintHud(d.sheet); // the leader's card, for a self-cast
      d.setPartyBarKey(''); // and the roster bar re-renders next frame
    });
  }

  function postSummonAt(id, tx, tz) {
    const a = d.ACTIONS[id];
    const problem = d.summonDropProblem(a, tx, tz);
    if (problem) { d.ui.say(problem); return; }
    const spawned = d.spawnSummonUnits(
      a.archetype, 'player', d.player, d.dropCount(a, d.roomFor(a)), { x: tx, z: tz },
    );
    if (!spawned.length) { d.ui.say('No room - nobody can find a free desk there.'); return; }
    for (const rec of spawned) {
      rec.actor.summonTurns = a.lifetimeTurns ?? null;
      d.vfx.impact(rec.actor.x, rec.actor.z, 'toner', { y: 0.5, scale: 0.55 });
    }
    d.player.faceToward(tx, tz); // you gesture at where you posted them
    d.ui.say(`${a.log} ${d.arrivalLine(spawned.length)}`);
    // One click, one post: the slot disarms so a stray second click walks you
    // somewhere instead of quietly filling the floor with temps.
    d.setArmedOoc(null);
    d.hotbarHost.hotbar?.setArmed(null);
  }

  function toggleOocArm(id) {
    if (!d.sheet || d.inCombat || d.gameOver || d.modalOpen() || !d.ACTIONS[id]) return;
    // A slot a fight owns still ARMS nothing, but it says why. Listed-but-inert
    // was the old behavior of every non-attack (they weren't listed at all),
    // and a button that does nothing at all is indistinguishable from a bug.
    const blocked = d.combatOnlyReason(id);
    if (blocked) { d.ui.say(blocked); return; }
    // ONE live slot at a time, out of a fight exactly as in one (designer,
    // 2026-07-31): pressing a different slot lowers the armed one and does
    // nothing else - arming the new one takes a second, deliberate press.
    // (A combat-only slot above still only explains itself: it could never
    // arm, so it does not count as reaching for another power.)
    if (d.armedOoc && d.armedOoc !== id) {
      d.setArmedOoc(null);
      d.hotbarHost.hotbar?.setArmed(null);
      d.ui.say('You stand down.');
      return;
    }
    d.setArmedOoc(d.armedOoc === id ? null : id);
    d.hotbarHost.hotbar?.setArmed(d.armedOoc);
    if (!d.armedOoc) { d.ui.say('You stand down.'); return; }
    const a = d.ACTIONS[d.armedOoc];
    // What the armed slot is waiting for. A summon aims at the FLOOR, so
    // "click a coworker" would be aiming instructions for the wrong thing -
    // and a cone needs no coworker at all, so its hint must not demand one.
    d.ui.say(a.type === 'summon'
      ? `${a.label} ready — click a spot within ${d.summonRange(a)} tiles to post it.`
      : a.cone
        ? `${a.label} ready — point it and click to fire.`
        : `${a.label} ready — click a coworker to start it.`);
  }

  function engageWithAction(en, actionId, point = null) {
    if (!d.sheet || d.inCombat || d.gameOver || !en?.alive) return;
    // Pre-flight the opener before any fight begins: an armed misclick on a
    // coworker nobody can actually reach (sealed behind walls and closed
    // doors) or throw at would otherwise open an unwinnable stalemate -
    // combat would start, and neither side could ever close the distance.
    const a = d.ACTIONS[actionId];
    if (d.rangeOf(actionId)) {
      if (!d.oocTargetOk(actionId, en)) {
        d.ui.say(a.ammoCost ? 'No line for that throw from here.' : 'No shot at them from here.');
        return;
      }
    } else if (a.cone) {
      // A cone fires from where you STAND, and its gate IS the wedge - the
      // same coneFrom the preview drew and the resolution will run, aimed at
      // the CLICK point when one came through (the armed ground click) and at
      // the target's body otherwise. The old gate here was a third geometry
      // (cheb square + tile-to-tile line) that could refuse a body the
      // preview's wedge plainly clipped (DEGRID M5).
      const lb = d.leadBody();
      const eb = d.enemyBody(en);
      const test = d.coneFrom(a, lb, point ? point.x : eb.x, point ? point.z : eb.z);
      if (!test || !(test(eb.x, eb.z, 0.5) && d.hasLos(lb, eb))) {
        d.ui.say(`They are not in the way of that ${a.label.toLowerCase()}.`);
        return;
      }
    } else if (a.type === 'shove') {
      // The ring's own test (oocTargetOk): arm's reach, or the office
      // standing in for your arms - a partition between you, or adjacent
      // furniture whose fall lands exactly on them. One test, so the ring
      // and this refusal cannot drift apart.
      if (!d.oocTargetOk(actionId, en)) {
        d.ui.say('Too far to shove. Walk your feelings over first.');
        return;
      }
    } else if (!d.playerReaches(en) && !d.bestApproachPath(en.x, en.z)) {
      d.ui.say('No way to reach them from here.');
      return;
    }
    const engaged = d.enemies.filter((e) =>
      e.alive && Math.max(Math.abs(e.x - d.player.x), Math.abs(e.z - d.player.z)) <= d.ENGAGE_RADIUS
      && d.canTakePart(d.player, e)); // same rule as checkCombatTrigger - see there
    if (!engaged.includes(en)) engaged.push(en);
    // The aimed point rides into the fight: the opener must fire the wedge
    // the player SAW, not one re-aimed at the target's tile centre.
    d.beginCombat({ engaged, primary: en, opening: { actionId, target: en, point } });
  }

  function oocTakeCoverAt(tile, point = null) {
    const problem = oocCoverProblem(tile.x, tile.z);
    if (problem) { d.ui.say(problem); return; }
    const commit = () => {
      // Re-ask on ARRIVAL: a coworker who wandered off during the walk is a
      // crouch that never happens, not one that lands on empty carpet.
      if (oocCoverProblem(tile.x, tile.z)) { d.ui.say('The moment passes - no cover taken.'); return; }
      d.setOocCrouch({ at: { x: tile.x, z: tile.z } });
      d.applyStatus(d.sheet, 'covered');
      d.player.crouched = true; // the held pose (actors.js): torso down onto the legs
      d.paintHud(d.sheet);
      d.ui.say(`You tuck in behind ${oocCoverNames(tile.x, tile.z)}.`);
      d.setArmedOoc(null);
      d.hotbarHost.hotbar?.setArmed(null);
    };
    if (d.player.x === tile.x && d.player.z === tile.z) {
      // Your own tile: a click on a meaningfully different POINT within it is
      // a sub-tile shuffle to fine-tune the tuck - the marker promised the
      // point, not the tile. The arrival hook fires on path-finished even
      // without a tile change (actors.js: `changed || finished`), so the
      // exact-tile pendingAction resolves like any other walk-then-crouch.
      const end = point ? d.clampPoint(point.x, point.z) : null;
      const pp = d.player.entity ? d.player.entity.getPosition() : d.player;
      if (end && Math.hypot(end[0] - pp.x, end[1] - pp.z) > 0.1) {
        d.clearOocCrouch();
        d.setPendingAction({ x: tile.x, z: tile.z, run: commit, exact: true });
        const s = [[pp.x, pp.z], end];
        d.player.setPath(s);
        d.setLastPath(s);
        return;
      }
      commit();
      return;
    }
    // Finish on the POINT you clicked, clamped to clearance - tucked where
    // you chose, not teleport-parked on the tile centre (designer,
    // 2026-07-31: "continuous and smooth"). Combat's crouch walk does the
    // same through walkActive's endpoint.
    if (!d.walkToExact(tile.x, tile.z, commit,
      point ? d.clampPoint(point.x, point.z) : null)) d.ui.say('No way in there.');
  }

  function oocShoveAt(tile) {
    const def = d.grid.defAt(tile.x, tile.z);
    if (d.isToppleable(def)) {
      d.approachAndDo(tile.x, tile.z, () => {
        const plan = oocTopplePlanAt(tile.x, tile.z);
        if (!plan) { d.ui.say('It rocks, and settles. Nothing behind it to fall into.'); return; }
        const en = d.enemyAt(plan.lx, plan.lz);
        if (en?.alive) { engageWithAction(en, 'shove'); return; }
        if (d.npcAt(plan.lx, plan.lz) || d.partyAt(plan.lx, plan.lz)) {
          d.ui.say('Somebody is standing there. Not like this.');
          return;
        }
        d.grid.setType(plan.x, plan.z, 'floor');
        d.scene.refreshTile?.(plan.x, plan.z);
        d.grid.setType(plan.lx, plan.lz, plan.def.topple.becomes);
        d.scene.refreshTile?.(plan.lx, plan.lz);
        d.vfx.impact(plan.lx, plan.lz, 'slam', { y: 0.5 });
        d.vfx.shake(0.11, 0.28);
        d.ui.say(`${plan.def.label || 'It'} goes over.`);
        d.setArmedOoc(null);
        d.hotbarHost.hotbar?.setArmed(null);
      });
      return true;
    }
    // A partition: the clicked tile is the side it falls ONTO - walk to the
    // tile across the edge and put a shoulder into it.
    if (d.grid.terrainOpen(tile.x, tile.z)) {
      let side = null;
      for (const [dx, dz] of d.ORTHO4) {
        const sx = tile.x + dx;
        const sz = tile.z + dz;
        if (!d.grid.wallEdgeBetween(sx, sz, tile.x, tile.z)) continue;
        if (sx === d.player.x && sz === d.player.z) { side = { x: sx, z: sz, here: true }; break; }
        if (!d.isWalkable(sx, sz)) continue;
        const p = d.findPath(d.isWalkable, d.player.x, d.player.z, sx, sz, d.hazardCost, d.grid.stepOpen);
        if (p && p.length >= 2 && (!side || p.length < side.len)) side = { x: sx, z: sz, len: p.length };
      }
      if (!side) return false; // no partition faces that tile - not a shove aim
      const resolve = () => {
        // Re-verify on arrival - the world had a whole walk to change.
        if (!d.grid.wallEdgeBetween(d.player.x, d.player.z, tile.x, tile.z)) {
          d.ui.say('The wall is not where you left it.');
          return;
        }
        const en = d.enemyAt(tile.x, tile.z);
        if (en?.alive) { engageWithAction(en, 'shove'); return; }
        if (d.npcAt(tile.x, tile.z) || d.partyAt(tile.x, tile.z)) {
          d.ui.say('Somebody is standing there. Not like this.');
          return;
        }
        const e = d.grid.removeEdgeBetween(d.player.x, d.player.z, tile.x, tile.z);
        if (!e) return;
        d.scene.removeEdgeWall?.(e.o, e.k);
        d.grid.setType(tile.x, tile.z, d.PARTITION_TOPPLE.becomes);
        d.scene.refreshTile?.(tile.x, tile.z);
        d.vfx.impact(tile.x, tile.z, 'slam', { y: 0.3 });
        d.vfx.shake(0.08, 0.2);
        d.ui.say('You put a shoulder into the partition. It goes over flat.');
        d.setArmedOoc(null);
        d.hotbarHost.hotbar?.setArmed(null);
      };
      if (side.here) resolve();
      else if (!d.walkToExact(side.x, side.z, resolve)) { d.ui.say('No way to get at that wall.'); }
      return true;
    }
    return false;
  }

  return {
    oocCoverProblem,
    oocTopplePlanAt,
    oocCoverNames,
    oocFriendlyOn,
    postSummonAt,
    toggleOocArm,
    engageWithAction,
    oocTakeCoverAt,
    oocShoveAt,
  };
}
