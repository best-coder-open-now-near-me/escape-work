// WALKING THE LEADER: the route, the smoothing, and the storeys.
//
// A slice off `startGame` (Q039). Every deliberate walk out of combat starts in
// here - a click on the floor, a walk-up to something you meant to use, a
// firing position, a stair climb - and they all share one shape: ask
// pathfinding for a grid route, then replace the last waypoint with the place
// the body may actually stand, then smooth it against the ground the route
// already agreed to cross.
//
// That last clause is the rule worth keeping together. `smoothFromBody` splices
// the body's REAL position into the head of the path before smoothing, because
// since DEGRID a walk starts wherever the previous one left the body - not at a
// tile centre - and a smoother handed a start it never checked will happily cut
// the corner the route paid to go around.
//
// `pendingAction`, `lastPath` and `climbAnim` go back through named setters:
// their other halves are the arrival check in `onMemberStep` and the climb
// rider in the update loop, so this owns none of them. `legQueue` is passed by
// reference - it is a queue two sides push and shift, and wrapping an array in
// setters would say less than the array does.
export function createWalking(d) {
  function smoothFromBody(p, actor = d.player, extraClear = null) {
    const pos = actor.entity?.getPosition();
    if (pos) p = [[pos.x, pos.z], ...p.slice(1)];
    const base = extraClear
      ? (x, z) => d.isWalkable(x, z) && extraClear(x, z)
      : d.clearOfHazards;
    return d.smoothPath(d.routeOpen(base, p), p, d.grid.edgeOpen);
  }
  // Where the body may actually stand: the exact clicked point, pulled in
  // from walls/partitions so the model never clips them.
  const clampPoint = (x, z) => d.clampToClearance(d.grid.terrainOpen, d.grid.edgeOpen, x, z);
  // Walk-up landing spot: at reach of the target's body inside goal tile
  // (gx, gz), instead of the tile's dead centre.
  const approachTo = (gx, gz, tx, tz) => d.approachPoint(d.grid.terrainOpen, d.grid.edgeOpen, gx, gz, tx, tz);

  function walkToExact(x, z, run, end = null) {
    if (!d.sheet || d.inCombat || d.gameOver || d.climbAnim) return false;
    d.clearOocCrouch();
    if (d.player.x === x && d.player.z === z) { run(); return true; }
    const p = d.findPath(d.isWalkable, d.player.x, d.player.z, x, z, d.hazardCost, d.grid.stepOpen);
    if (!p || p.length < 2) return false;
    d.setPendingAction({ x, z, run, exact: true });
    if (end) p[p.length - 1] = end;
    const s = smoothFromBody(p);
    d.player.setPath(s);
    d.setLastPath(s);
    return true;
  }

  // Walk within reach of (x, z), then run the interaction.
  function approachAndDo(x, z, run) {
    if (!d.sheet || d.inCombat || d.gameOver || d.climbAnim) return;
    d.clearOocCrouch();
    // Rummaging, talking, shopping, looting: seeing to it ends the sneak
    // (SNEAK_PLAN D10). Doors stay exempt - they go through their own path,
    // and a sneak that ends at every door is no sneak in an office.
    const act = () => {
      if (d.sneakLayer.sneak) d.endSneak('No staying quiet through this.');
      run();
    };
    if (Math.abs(d.player.x - x) <= 1 && Math.abs(d.player.z - z) <= 1) {
      act();
      return;
    }
    let best = null;
    for (const [dx, dz] of d.DIRS8) {
      const ax = x + dx;
      const az = z + dz;
      if (!d.isWalkable(ax, az)) continue;
      const p = d.findPath(d.isWalkable, d.player.x, d.player.z, ax, az, d.hazardCost, d.grid.stepOpen);
      if (p && (!best || p.length < best.length)) best = p;
    }
    if (!best || best.length < 2) return;
    d.setPendingAction({ x, z, run: act });
    const [gx, gz] = best[best.length - 1];
    best[best.length - 1] = approachTo(gx, gz, x, z);
    const s = smoothFromBody(best);
    d.player.setPath(s);
    d.setLastPath(s);
  }

  // Walk to the exact clicked point (BG3-style free movement), not the tile
  // centre: route on the d.grid, then swap the final waypoint for the clamped
  // click point. A click inside the current tile just shuffles over.
  function moveTo(tile, point = null) {
    if (!tile || !d.sheet || d.inCombat || d.gameOver || d.climbAnim || !d.isWalkable(tile.x, tile.z)) return;
    d.clearOocCrouch(); // a deliberate walk is the one thing a crouch never survives
    d.setPendingAction(null);
    if (point && tile.x === d.player.x && tile.z === d.player.z && d.player.entity) {
      const pos = d.player.entity.getPosition();
      const s = [[pos.x, pos.z], clampPoint(point.x, point.z)];
      d.player.setPath(s);
      d.setLastPath(s);
      return;
    }
    const p = d.findPath(d.isWalkable, d.player.x, d.player.z, tile.x, tile.z, d.hazardCost, d.grid.stepOpen);
    if (p && p.length > 1) {
      if (point) p[p.length - 1] = clampPoint(point.x, point.z);
      // Smoothed: straight any-angle runs wherever line of sight is clear.
      const s = smoothFromBody(p);
      d.player.setPath(s);
      d.setLastPath(s);
    }
  }

  // --- layered-storey walking (EDITOR_PLAN feasibility spike) ---------------
  // Click resolution against the visible storeys, cross-storey routing, and
  // the scripted stair climb. All of it is inert on flat levels.
  const walkableOn = (l) => (x, z) =>
    d.floors.layers[l].terrainOpen(x, z)
    // Bodies live on the ground storey only for now (parseFloors refuses
    // actors above it), so a mezzanine tile can't be blocked by a coworker
    // standing UNDER it.
    && (l !== 0 || (!d.enemyAt(x, z) && !d.npcAt(x, z)));
  // Screen point -> the topmost VISIBLE storey with real floor under the
  // pixel. Scanning top-down is what makes "you click what you see" true:
  // a cutaway-hidden storey never eats a click aimed at the floor below it,
  // and open air over the atrium falls through to the lobby floor.
  function layeredPick(sx, sy) {
    const cam = d.controls.cameraEntity.camera;
    const near = new d.pc.Vec3();
    const far = new d.pc.Vec3();
    cam.screenToWorld(sx, sy, cam.nearClip, near);
    cam.screenToWorld(sx, sy, cam.farClip, far);
    const dir = far.sub(near);
    if (Math.abs(dir.y) < 1e-6) return null;
    for (let l = d.floors.layers.length - 1; l >= 0; l--) {
      if (!d.scene.layerVisible(l)) continue;
      const t = (d.floors.baseY[l] - near.y) / dir.y;
      if (t < 0) continue;
      const px = near.x + dir.x * t;
      const pz = near.z + dir.z * t;
      const tx = Math.round(px);
      const tz = Math.round(pz);
      const g = d.floors.layers[l];
      if (tx < 0 || tx >= g.width || tz < 0 || tz >= g.height) continue;
      if (g.typeAt(tx, tz) === null) continue; // open air - the storey below owns this pixel
      return { tile: { x: tx, z: tz }, point: { x: px, z: pz }, layer: l, stair: d.floors.stairAt(l, tx, tz) };
    }
    return null;
  }
  // Send the leader to a tile on another storey: within-storey walks chained
  // through stair climbs, planned as one route so the click either commits
  // to a whole path or honestly refuses.
  function walkToLayer(tile, point, layer) {
    if (!d.sheet || d.inCombat || d.gameOver || d.climbAnim) return;
    d.clearOocCrouch(); // also clears any queued legs
    d.setPendingAction(null);
    const route = d.planCrossLayerRoute(d.floors,
      { x: d.player.x, z: d.player.z, layer: d.playerLayer },
      { x: tile.x, z: tile.z, layer },
      walkableOn,
      // Surface-hazard avoidance is the leader's cost model on their own
      // storey; other storeys route on distance alone for now.
      (l) => (l === d.playerLayer ? d.hazardCost : null));
    if (!route) { d.ui.say('No way to get there from here.'); return; }
    const last = route.legs[route.legs.length - 1];
    if (point && last.kind === 'walk' && last.path.length > 1) {
      const g = d.floors.layers[last.layer];
      last.path[last.path.length - 1] = d.clampToClearance(g.terrainOpen, g.edgeOpen, point.x, point.z);
    }
    d.legQueue.push(...route.legs);
    startNextLeg();
  }
  // A click on a stair run means "take the stairs": up from its own storey,
  // back down from the one above.
  function routeViaStair(stair) {
    if (d.playerLayer === stair.upper) walkToLayer({ x: stair.entry.x, z: stair.entry.z }, null, stair.layer);
    else walkToLayer({ x: stair.top.x, z: stair.top.z }, null, stair.upper);
  }
  function startNextLeg() {
    const leg = d.legQueue.shift();
    if (!leg) return;
    if (leg.kind === 'walk') {
      if (leg.path.length < 2) { startNextLeg(); return; }
      const g = d.floors.layers[leg.layer];
      // The body's REAL position goes in BEFORE the smoother, not after. A
      // walk starts wherever the last one left the body - a clamped point
      // off the tile centre - and splicing that in afterwards handed the
      // first run a start the corridor checks never saw, so the opening leg
      // could clip the wall the smoother had carefully cleared from the
      // centre. Feeding it in first makes the first run the one that gets
      // checked.
      const path = leg.path.map((p) => [p[0], p[1]]);
      const pos = d.player.entity?.getPosition();
      if (pos) path[0] = [pos.x, pos.z];
      const smoothed = d.smoothPath(walkableOn(leg.layer), path, g.edgeOpen);
      d.player.setPath(smoothed);
      d.setLastPath(smoothed);
    } else {
      // The scripted climb: walk the straight line entry -> landing while the
      // update loop rides the body's height up the flight. The flat first
      // half-tile is the approach to the bottom step; the last is the landing.
      d.setClimbAnim({
        sx: leg.from.x, sz: leg.from.z, run: leg.run, toLayer: leg.to.layer,
        y0: d.floors.baseY[leg.from.layer] + d.lift, y1: d.floors.baseY[leg.to.layer] + d.lift,
      });
      // Both storeys stay visible for the whole ride - the cutaway stands
      // down until the landing (see the update loop).
      d.scene.holdForClimb(leg.from.layer, leg.to.layer);
      d.player.setPath([[leg.from.x, leg.from.z], [leg.to.x, leg.to.z]]);
    }
  }

  // Cheapest walk-up route to any open tile beside (x, z), or null when the
  // target can't be reached at all (sealed behind walls or a closed door).
  function bestApproachPath(x, z) {
    let best = null;
    for (const [dx, dz] of d.DIRS8) {
      const ax = x + dx;
      const az = z + dz;
      if (!d.isWalkable(ax, az)) continue;
      const p = d.findPath(d.isWalkable, d.player.x, d.player.z, ax, az, d.hazardCost, d.grid.stepOpen);
      if (p && (!best || p.length < best.length)) best = p;
    }
    return best;
  }

  // The ranged twin of bestApproachPath: cheapest walk-up route to any tile a
  // weapon with `range` could FIRE at (x, z) from. The rule is pure and shared
  // with combat's routeIntoRange (pathfinding.js); only the bindings differ.
  function bestFiringPath(x, z, range) {
    return d.routeToFiringPosition({
      tx: x,
      tz: z,
      range,
      fromX: Math.round(d.player.x),
      fromZ: Math.round(d.player.z),
      isWalkable: d.isWalkable,
      // Under-promise the CIRCLE the arrival re-check measures (DEGRID D4):
      // a corner tile inside the old cheb square but outside the radius would
      // be walked to and then refused.
      hasLos: (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz) <= range
        && d.hasLos({ x: ax, z: az }, { x: bx, z: bz }),
      findPath: (ax, az) => d.findPath(d.isWalkable, d.player.x, d.player.z, ax, az, d.hazardCost, d.grid.stepOpen),
    });
  }

  return {
    smoothFromBody,
    clampPoint,
    approachTo,
    walkToExact,
    approachAndDo,
    moveTo,
    walkableOn,
    layeredPick,
    walkToLayer,
    routeViaStair,
    startNextLeg,
    bestApproachPath,
    bestFiringPath,
  };
}
