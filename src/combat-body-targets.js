// The body/object half of combat aiming: cone outlines, reach, topple/break
// affordances, enemy verdict rings, and the purge self-ring. The aim view owns
// hover and cursor state; this pass is a stateless reader of that owner.
export function createBodyTargets(d) {
  const { OK, FAR, REACH: REACH_RING } = d.marks;
  const drawRing = d.marks.ring;
  const TARGET_R = d.ask.TARGET_R;

  function draw(a, id) {
    if (a.cone) {
      const test = d.aimPoint && d.ask.coneTest(a, d.aimPoint.x, d.aimPoint.z);
      if (test) {
        const y = 0.14;
        const line = d.ask.conePolyline(a, test);
        for (let i = 1; i < line.length; i++) {
          d.app.drawLine(new d.pc.Vec3(line[i - 1][0], y, line[i - 1][1]),
            new d.pc.Vec3(line[i][0], y, line[i][1]), OK);
        }
      }
      for (const enemy of d.world.liveEnemies()) {
        if (!enemy.entity) continue;
        const pos = enemy.entity.getPosition();
        const hit = test && test(pos.x, pos.z, TARGET_R)
          && d.ask.bodyLos(d.view.active, enemy);
        drawRing(pos.x, pos.z, TARGET_R, hit && d.view.active.ap >= a.ap ? OK : FAR);
      }
      return;
    }

    // A touch verb's reach is a circle on the acting body, only while a foe is
    // actually hovered. Ranged attacks use their per-enemy verdicts instead.
    if (d.hoverFoe?.alive && !d.ask.rangeOf(id)) {
      const me = d.ask.posOf(d.view.active);
      const radius = a.type === 'shove'
        ? d.REACH.SHOVE
        : d.ask.isPull(a) ? d.REACH.PULL : d.ask.reachOfUnit(d.view.active);
      drawRing(me.x, me.z, radius, REACH_RING);
    }

    if (a.type === 'shove') {
      const body = d.ask.bodyOf(d.view.active);
      const affordable = d.view.active.ap >= a.ap;
      for (const { x, z, plan } of d.ask.toppleRings(body.x, body.z, {
        isToppleableAt: (px, pz) => d.ask.isToppleable(d.world.tileDefAt(px, pz)),
        planAt: (px, pz) => d.ask.topplePlan(d.view.active, px, pz),
        reaches: (px, pz) => d.ask.toppleReaches(px, pz),
      })) {
        const canDrop = !!plan && affordable;
        drawRing(x, z, 0.42, canDrop ? OK : FAR);
        if (plan) {
          drawRing(plan.lx, plan.lz, 0.28, canDrop ? OK : FAR);
          d.app.drawLine(new d.pc.Vec3(x, 0.14, z),
            new d.pc.Vec3(plan.lx, 0.14, plan.lz), canDrop ? OK : FAR);
        }
      }
      for (const { x, z, clear } of d.ask.partitionRings(body.x, body.z, d.world)) {
        drawRing(x, z, 0.42, clear && affordable ? OK : FAR);
      }
    }

    // Breakable props and partitions appear only for a deliberately armed
    // attack; bare-click enemy rings remain available without one.
    if (d.view.armed) {
      const body = d.ask.bodyOf(d.view.active);
      const paid = (!a.ammoCost || d.view.active.sheet.paper >= d.ask.ammoCostOf(id))
        && d.view.active.ap >= a.ap;
      const { props, edges } = d.ask.breakRings(a, body.x, body.z, d.ask.rangeOf(id), {
        tileDefAt: d.world.tileDefAt,
        planAt: (px, pz) => d.ask.breakPlanAt(id, px, pz),
        edgeHpBetween: d.world.edgeHpBetween,
      });
      for (const { x, z, landable } of props) {
        drawRing(x, z, 0.42, landable && paid ? OK : FAR);
      }
      for (const { x, z } of edges) drawRing(x, z, 0.42, paid ? OK : FAR);
    }

    const range = d.ask.rangeOf(id);
    for (const enemy of d.world.liveEnemies()) {
      if (!enemy.entity) continue;
      // One lazy shot outcome per enemy. It can revalidate a crouch, so the
      // ladder must not call it on a branch that does not need it.
      let shot = null;
      const outcome = () => (shot ??= d.ask.shotOutcome(d.view.active, enemy));
      const ok = d.ask.enemyRingOk(a, {
        ap: d.view.active.ap,
        ammoOk: !a.ammoCost || d.view.active.sheet.paper >= d.ask.ammoCostOf(id),
        range,
        dist: d.ask.bodyDist(d.view.active, enemy),
        los: d.ask.bodyLos(d.view.active, enemy),
        get shoveReach() { return d.ask.canReach(d.view.active, enemy, d.REACH.SHOVE); },
        get pullOk() { return !!d.ask.pullPlanFor(enemy); },
        get controlRefused() {
          return d.ask.controlProblem(a, {
            dist: d.ask.bodyDist(d.view.active, enemy),
            los: d.ask.bodyLos(d.view.active, enemy),
            ap: d.view.active.ap,
            usesLeft: a.uses ? d.view.active.usesLeft[id] ?? 0 : null,
            alive: enemy.alive,
          });
        },
        get shotBlocked() { return !!outcome().blocked; },
        get shotRedirectedToAlly() {
          const result = outcome();
          return !!result.redirected && !!result.target?.sheet;
        },
        get meleeReachable() {
          return d.ask.canReach(d.view.active, enemy) || d.ask.hasSwingSpot(enemy);
        },
      });
      const pos = enemy.entity.getPosition();
      drawRing(pos.x, pos.z, TARGET_R, ok ? OK : FAR);
    }

    if (a.purge && d.view.active.actor.entity) {
      const pos = d.view.active.actor.entity.getPosition();
      drawRing(pos.x, pos.z, 0.5, d.view.active.ap >= a.ap ? OK : FAR);
    }
  }

  return { draw };
}
