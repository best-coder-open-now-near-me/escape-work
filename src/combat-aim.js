import { createBodyTargets } from './combat-body-targets.js';
import { fineCircleCells } from './surface-mask.js';

// The AIM VIEW: everything the ground says about a verb you are pointing but
// have not committed - the wash, the target rings, the walk preview, the eased
// cover marker - plus the small pile of state that only those drawers touch.
//
// This is a slice off `startCombat`, which is a 5,500-line closure holding 108
// functions and 21 shared mutable variables (Q037/Q042). The slice is chosen
// rather than convenient: five of those variables - `preview`, `previewDt`,
// `coverEase`, `paintEpoch` and, apart from a disarm, `aimPoint` -
// were written by NOTHING outside this cluster. They were shared only in the
// sense of living in the same scope as everything else. Here they are private,
// and combat.js reaches them through five named methods instead of by writing
// to a variable from anywhere in five thousand lines.
//
// What arrives as `ask` is the world and the rules: where the bodies are, what
// the floor is made of, whether a spot is a legal crouch. What arrives as
// `view` is the turn - phase, the armed verb, the acting unit - because those
// three ARE still combat's, written by the turn engine and the click handlers.
// They come in as getters rather than values so a frame always draws against
// the live turn and never a stale copy.
export function createAimView({ app, pc, marks, aimPaint, actions, world, costTag, REACH, view, ask }) {
  const { OK, FAR, COVER, REACH: REACH_RING, ring: drawRing, faces: drawFaces } = marks;
  // The target ring's radius is geometry, not palette - it comes from
  // combat-geometry with the rest of the reach maths.
  const { TARGET_R } = ask;

  // `paintEpoch` names the world the wash was computed against - combat bumps
  // it, so anything that reshapes sight mid-turn (a door opened, smoke landing)
  // repaints on its next frame without this module knowing why.
  let paintEpoch = 0;
  let preview = null; // { reach: [[x,z],...], tail: [[x,z],...] | null }
  let previewDt = 0;
  let aimPoint = null; // hover point while a cone, zone or summon is armed
  let coverEase = null; // the cover ring's eased position, not its target
  // The enemy the cursor is on as of the last hover event - the body pick when
  // main.js has one, else the ground-point fallback (enemyAtPoint). This is the
  // ONE answer to "am I aiming at someone?": the crosshair cursor, the to-hit
  // readout and the reach ring all read it, because computing it per consumer
  // is what let the crosshair promise a swing the readout denied. Tracked even
  // on gated frames (mid-move, AI turn) so the reach ring keeps drawing while a
  // walk finishes.
  let hoverFoe = null;
  let hoverHitChance = null; // to-hit chance shown for the enemy under an armed cursor

  // Real functions, not just methods on the returned object: the drawers and
  // the hover below call these directly, and a bare `setPreview(...)` cannot
  // reach a property of an object literal that does not exist yet. The API at
  // the bottom re-exports them so combat.js writes through the same doors.
  const setPreview = (p) => { preview = p; };
  const setAimPoint = (p) => { aimPoint = p; };
  // Dropping the aim drops the eased marker with it, or the next crouch preview
  // starts from wherever the last one happened to stop.
  const clearAim = () => { aimPoint = null; coverEase = null; };
  const clearCoverEase = () => { coverEase = null; };
  const bodyTargets = createBodyTargets({
    app,
    pc,
    marks,
    world,
    REACH,
    view,
    ask,
    get aimPoint() { return aimPoint; },
    get hoverFoe() { return hoverFoe; },
  });

  // The ground wash while a ranged verb is armed: one merged fine-cell region
  // for generic range, or the exact committed surface mask for a cone/zone.
  function drawAimWash() {
    // Unconditional, and first: the wash must also KNOW to vanish when the turn
    // ends, the verb is disarmed, or the aimer is mid-walk (a wash painted from
    // a tile you are leaving is a promise about ground you no longer own). The
    // key makes the repaint free while nothing changes.
    // `reachSpec` is the ONE answer to "how far does this verb reach": the
    // shapes powers.js owns plus a plain ranged ATTACK's. The wash, the target
    // rings and every walk-up read it, so the three cannot disagree.
    const armed = view.armed;
    const active = view.active;
    if (view.phase !== 'player' || !armed || active.actor.moving) {
      aimPaint.hide();
      return;
    }
    const action = actions[armed];
    const surfaceField = world.surfaceField();
    const quantum = surfaceField.quantum;
    // Surface verbs paint the shape that will be committed, not a separate
    // circular range wash. The outline/body rings remain immediate-mode on top.
    if (action.cone) {
      const test = aimPoint && ask.coneTest(action, aimPoint.x, aimPoint.z);
      if (!test) { aimPaint.hide(); return; }
      aimPaint.show(`cone:${armed}:${aimPoint.x},${aimPoint.z}:${paintEpoch}`,
        () => ask.coneCells(action, test), quantum,
        { kind: 'polygon', points: ask.conePolyline(action, test) });
      return;
    }
    if (ask.isZone(action)) {
      if (!aimPoint) { aimPaint.hide(); return; }
      aimPaint.show(`zone:${armed}:${aimPoint.x},${aimPoint.z}:${paintEpoch}`,
        () => ask.zoneCells(action, aimPoint.x, aimPoint.z), quantum,
        { kind: 'circle', x: aimPoint.x, z: aimPoint.z, radius: action.radius ?? 1 });
      return;
    }
    const spec = ask.reachSpec(armed);
    if (!spec) { aimPaint.hide(); return; }
    const ax = active.actor.x;
    const az = active.actor.z;
    // An ANY-target verb (a purge - Reboot) has TWO reaches, and the wash is
    // sized by the wider one: a colleague can be rebooted from across the room
    // (the friendly click resolves at buff range), while a coworker goes down
    // the melee walk-in and has to be walked up to. Painting the friendly
    // radius over a coworker promises a cast that would actually be a walk, so
    // those tiles drop out of the wash - it covers the ground an aim LANDS on
    // right now, and the coworker's own ring (which already reads the walk-in
    // rule) says the rest.
    //
    // Scoped to `aimsAtAnyone` deliberately: every other verb's wash radius IS
    // its act range, so the test would be a no-op - and a cone, whose range
    // lives in `cone` rather than where actRangeOf looks, would have holes
    // punched in a wash that is perfectly honest.
    const twoReaches = ask.aimsAtAnyone(actions[armed]);
    const body = ask.posOf(active);
    const walkOnly = (x, z) => {
      if (!twoReaches) return false;
      const en = world.liveEnemies().find((e) => {
        const p = ask.posOf(e);
        return Math.hypot(p.x - x, p.z - z) <= TARGET_R;
      });
      return !!en && !ask.verbReaches(armed, en, body.x, body.z);
    };
    // Painted, ranged and sighted from the BODY (DEGRID D4/D6): the wash must
    // promise exactly what the gates measure, and they measure from where the
    // model stands. The key still uses the tile - a sub-tile shuffle should not
    // repaint the world.
    aimPaint.show(`${armed}:${ax},${az}:${paintEpoch}`, () => fineCircleCells(
      surfaceField, body.x, body.z, spec.r, {
        canInclude: (x, z) => world.terrainOpen(Math.round(x), Math.round(z))
          && world.hasLos(body.x, body.z, x, z) && !walkOnly(x, z),
      },
    ), quantum, { kind: 'circle', x: body.x, z: body.z, radius: spec.r });
  }

  // The walk a click would take, and the ring where it would stop.
  function drawPreview(dt = 0) {
    previewDt = dt;
    if (!preview) return;
    const y = 0.14; // above the floor top (0.1) and surface decals (0.12)
    const seg = (pts, color) => {
      for (let i = 1; i < pts.length; i++) {
        app.drawLine(new pc.Vec3(pts[i - 1][0], y, pts[i - 1][1]),
          new pc.Vec3(pts[i][0], y, pts[i][1]), color);
      }
    };
    seg(preview.reach, OK);
    if (preview.tail) seg(preview.tail, FAR);
    const [ex, ez] = preview.reach[preview.reach.length - 1];
    drawRing(ex, ez, 0.32, OK, y);
  }

  // The crouch you are ALREADY in, off the live face list the shot resolves
  // against - so a wall that comes down goes dark on the next frame rather than
  // lying until somebody shoots.
  function drawHeldCrouch() {
    const s = ask.crouchStateOf(view.active);
    if (s) drawFaces(s.at.x, s.at.z, s.faces, COVER);
  }

  function drawZoneRings(a, id) {
    if (!view.armed || !aimPoint) return undefined;
    // The exact aim point - the rings must show the same disc the click lays
    // (DEGRID M6).
    const tx = aimPoint.x;
    const tz = aimPoint.z;
    const active = view.active;
    const problem = ask.zoneProblem(a, {
      dist: ask.distToTile(active, tx, tz),
      los: ask.losToTile(active, tx, tz),
      ap: active.ap,
      usesLeft: a.uses ? active.usesLeft[id] ?? 0 : null,
    });
    if (problem) { drawRing(tx, tz, 0.42, FAR); return undefined; }
    // One boundary names the true disc. The merged fill carries its clipped
    // terrain and body holes; storage cells never receive individual rings.
    drawRing(tx, tz, a.radius ?? 1, OK);
    return true;
  }

  function drawSummonRings(a) {
    if (!view.armed || !aimPoint) return undefined;
    const tx = aimPoint.x;
    const tz = aimPoint.z;
    const spots = ask.summonSpotProblem(a, tx, tz) ? [] : world.summonSpots(a, tx, tz, a.count);
    if (!spots.length) { drawRing(tx, tz, 0.42, FAR); return undefined; }
    for (const [sx, sz] of spots) drawRing(sx, sz, 0.42, OK);
    return true;
  }

  function drawCoverRings() {
    if (!view.armed || !aimPoint) { coverEase = null; return undefined; }
    const tx = Math.round(aimPoint.x);
    const tz = Math.round(aimPoint.z);
    const ok = !ask.coverSpotProblem(tx, tz);
    const color = ok ? COVER : FAR;
    // Three layers, from the cursor down to the rule (designer, 2026-07-31:
    // "something that is continuous and smooth for starters" - the emblem used
    // to hop in discrete tile-sized steps):
    //  - a small marker at the CLAMPED stand point - continuous, and exactly
    //    where the walk will park you: the raw cursor point can sit inside a
    //    wall's clearance band, and a marker there would promise a spot the
    //    body cannot occupy;
    //  - the stand-tile ring, EASED toward the resolved tile rather than
    //    teleporting to it, so sweeping the cursor reads as one motion;
    //  - the shielded faces, snapped to the tile's edges - they are tile
    //    geometry, and drawing them anywhere between two tiles would show cover
    //    on edges that do not exist.
    const [mx, mz] = world.clampPoint(aimPoint.x, aimPoint.z);
    drawRing(mx, mz, 0.12, color);
    if (!coverEase) coverEase = { x: aimPoint.x, z: aimPoint.z };
    const k = 1 - Math.exp(-(previewDt || 0) * 14); // ~70ms settle, fps-independent
    coverEase.x += (tx - coverEase.x) * k;
    coverEase.z += (tz - coverEase.z) * k;
    drawRing(coverEase.x, coverEase.z, 0.42, color);
    if (ok) drawFaces(tx, tz, ask.crouchFacesAt(tx, tz), COVER);
    return true;
  }

  function drawAllyRings(a, id, sides) {
    if (!view.armed) return true; // never auto-armed - only while deliberately aiming
    for (const m of ask.friendlies()) {
      if (!m.actor?.entity) continue;
      const pos = m.actor.entity.getPosition();
      drawRing(pos.x, pos.z, TARGET_R, ask.allyProblemFor(id, m) ? FAR : OK);
    }
    return !sides.enemies;
  }

  function hidePreview() {
    setPreview(null);
    hoverHitChance = null;
    costTag.style.display = 'none';
  }

  function showHitPreview(en, sx, sy) {
    hoverHitChance = null;
    // The readout REPLACES the movement trail. Clearing it here rather than at
    // the call sites is what makes that true: `preview` is redrawn every frame,
    // so a trail left over from the last patch of floor the cursor crossed kept
    // hanging off the character while they were plainly aiming at someone.
    // (previewWalk re-fills it when a walk is genuinely part of the click.)
    setPreview(null);
    const id = ask.previewAction();
    const a = actions[id];
    // A control rolls to hit like a swing does, so it earns the same readout -
    // an odds display that vanished the moment you armed Detain would make the
    // one power you most want to know the odds of the one that hides them.
    if (!a || (a.type !== 'attack' && !ask.isControl(a) && !ask.isPurge(a)) || a.cone || !en) {
      costTag.style.display = 'none';
      return;
    }
    const place = (text) => {
      costTag.textContent = text;
      costTag.style.left = `${sx + 14}px`;
      costTag.style.top = `${sy + 14}px`;
      costTag.style.display = 'block';
    };
    // A crouched target reshapes the readout before any odds exist
    // (TACTICS_PLAN M6): no angle means NO number - a percentage over an
    // unhittable target is a lie - and a human shield shows the odds against
    // the body that would actually take it.
    let target = en;
    let shieldNote = '';
    let plan = null; // planned stand point while the click includes a walk
    let planCost = 0; // what that walk takes out of this turn's budget
    const range = ask.rangeOf(id);
    if (range) {
      const so = ask.shotOutcome(view.active, en);
      if (so.blocked || (so.redirected && so.target.sheet)) {
        place(so.blocked
          ? `No shot - in cover behind the ${ask.crouchLabel(so.blocked)}`
          : `No shot - you would hit ${ask.nameOf(so.target)}`);
        return;
      }
      if (so.redirected) {
        target = so.target;
        shieldNote = ` vs ${ask.nameOf(so.target)} (human shield)`;
      }
      const far = ask.bodyDist(view.active, en) > range;
      const noLine = !ask.bodyLos(view.active, en);
      if (far || noLine) {
        // A throw refuses where it stands (the click's own rule) - say so
        // instead of quoting odds for a throw that will not happen.
        if (a.ammoCost) { place(far ? 'Too far to throw.' : 'No clear line to throw.'); return; }
        const stop = (px, pz) => ask.verbReaches(id, en, px, pz);
        const route = ask.routeIntoRange(en, range);
        const w = route && route.length >= 2 ? ask.previewWalk(route, null, a, stop) : null;
        if (!w) { place('No way to get a shot at them.'); return; }
        if (!w.done || !stop(w.end[0], w.end[1])) {
          place('Out of range this turn - a click closes the distance.');
          return; // the trail stays up: green as far as the budget carries
        }
        plan = { x: w.end[0], z: w.end[1] };
        planCost = w.cost;
      }
    } else if (!(ask.isControl(a) && ask.controlIsRanged(a)) && !ask.canReach(view.active, en)) {
      // The melee walk-in (swings, touch controls, a purge): preview the same
      // route the click will take, to the same legal stand point.
      const stop = (px, pz) => ask.verbReaches(id, en, px, pz);
      const best = ask.routeBeside(en);
      if (!best) { place('No way to get a swing at them.'); return; }
      const w = ask.previewWalk(best.path, best.point, a, stop);
      if (!w) { place('Already as close as the route gets.'); return; }
      if (!w.done || !stop(w.end[0], w.end[1])) {
        place('Out of reach this turn - a click closes the distance.');
        return;
      }
      plan = { x: w.end[0], z: w.end[1] };
      planCost = w.cost;
    }
    // The same terms the swing will roll - not a second copy of the math. The
    // reason string matters: a positional modifier the player can't see reads
    // as randomness (TACTICS_PLAN, ui.js note).
    const t = ask.attackMods(view.active, target, plan);
    hoverHitChance = ask.hitChance(t.acc, t.dodge, t.mods);
    const why = t.covered ? ' - in cover'
      : (t.behind ? ' - from behind' : (t.flanked ? ' - flanked' : ''));
    let text = `${Math.round(hoverHitChance * 100)}% to hit${why}${shieldNote}`;
    // Price the whole click while a walk is part of it: what the move takes
    // out of real AP (the allowance is spent first, exactly as billMove
    // spends it) plus the swing itself.
    if (plan && planCost > 0.02) {
      const free = Math.min(view.active.freeAp || 0, planCost);
      const total = ask.roundAp(ask.roundAp(planCost - free) + a.ap);
      text += ` · ${ask.fmtAp(total)} AP after the walk`;
    }
    place(text);
  }

  function showDashPreview(point, sx, sy) {
    setPreview(null);
    const a = actions[view.armed];
    // handleHover admits a ground point of null (a pick can land on a body
    // whose ground ray misses the world entirely - a chest pixel beside a
    // wall), and a dash is aimed at the FLOOR, so there is nothing to price.
    if (!point) { hidePreview(); return; }
    const tx = Math.round(point.x);
    const tz = Math.round(point.z);
    const problem = ask.mobilityProblem(a, {
      ap: view.active.ap,
      usesLeft: a.uses ? view.active.usesLeft[view.armed] ?? 0 : null,
    });
    if (!problem && world.isWalkable(tx, tz)) {
      const raw = world.findPath(view.active.actor.x, view.active.actor.z, tx, tz, view.active.actor);
      if (raw && raw.length >= 2) {
        const s = world.smooth([...raw.slice(0, -1), world.clampPoint(point.x, point.z)], view.active.actor);
        const { points, done } = ask.truncateByBudget(s, ask.dashDistanceOf(a), () => 1);
        // The trail IS the affordance for a move - but it has to be stored in
        // the shape drawPreview reads (`{ reach, tail }`, declared where
        // `preview` is). A bare array left `preview.reach` undefined, and
        // drawPreview walks it every frame: `pts.length` on undefined threw
        // once per frame for as long as a dash was armed over a legal route.
        // A dash has no `tail` - it stops where the budget stops, and the
        // "as far as it reaches" wording on the cost tag already says so.
        setPreview({ reach: points, tail: null });
        costTag.textContent = done
          ? `${a.label} · ${a.ap} AP · no opportunity attacks`
          : `${a.label} · ${a.ap} AP · as far as it reaches`;
        costTag.style.left = `${sx + 14}px`;
        costTag.style.top = `${sy + 14}px`;
        costTag.style.display = 'block';
        return;
      }
    }
    costTag.textContent = problem || 'No route there.';
    costTag.style.left = `${sx + 14}px`;
    costTag.style.top = `${sy + 14}px`;
    costTag.style.display = 'block';
  }

  function showAllyPreview(point, sx, sy) {
    setPreview(null); // aiming replaces the movement trail, same as a swing
    const a = actions[view.armed];
    const m = ask.allyAtPoint(point);
    if (!m) { hidePreview(); return; }
    const problem = ask.allyProblemFor(view.armed, m);
    const who = m === view.active ? 'yourself' : m.sheet.name;
    costTag.textContent = problem || `${a.label} on ${who} · ${a.ap} AP`;
    costTag.style.left = `${sx + 14}px`;
    costTag.style.top = `${sy + 14}px`;
    costTag.style.display = 'block';
  }

  function showSummonPreview(point, sx, sy) {
    setPreview(null); // the drop zone replaces the trail, same as the hit readout
    const a = actions[view.armed];
    const tx = point.x;
    const tz = point.z;
    const problem = ask.summonSpotProblem(a, tx, tz);
    const room = problem ? 0 : world.summonSpots(a, tx, tz, a.count).length;
    costTag.textContent = problem
      || `Post ${room} employee${room === 1 ? '' : 's'} here · ${a.ap} AP`;
    costTag.style.left = `${sx + 14}px`;
    costTag.style.top = `${sy + 14}px`;
    costTag.style.display = 'block';
  }

  function showZonePreview(point, sx, sy) {
    setPreview(null);
    const a = actions[view.armed];
    // The zone lands where you POINT (DEGRID M6): the disc of covered cells
    // is centred on the exact aim point, so the preview prices that point,
    // not the tile it rounds to.
    const tx = point.x;
    const tz = point.z;
    const problem = ask.zoneProblem(a, {
      dist: ask.distToTile(view.active, tx, tz),
      los: ask.losToTile(view.active, tx, tz),
      ap: view.active.ap,
      usesLeft: a.uses ? view.active.usesLeft[view.armed] ?? 0 : null,
    });
    costTag.textContent = problem || `Cover the highlighted floor · ${a.ap} AP`;
    costTag.style.left = `${sx + 14}px`;
    costTag.style.top = `${sy + 14}px`;
    costTag.style.display = 'block';
  }

  function handleHover(point, sx, sy, picked = null, onOwnTile = false) {
    // While aiming, target rings replace the movement trail entirely. Cone
    // attacks and summon placement additionally track the cursor - the wedge
    // (or the drop zone) follows it.
    // A zone tracks the cursor the way a cone and a summon placement do - the
    // footprint follows the aim, because where it lands IS the decision.
    if (view.armed && (actions[view.armed].cone || actions[view.armed].type === 'summon'
      || actions[view.armed].type === 'cover' || ask.isZone(actions[view.armed]))) setAimPoint(point);
    // Who is the cursor on? The body pick wins - it sees what the pixel shows.
    // The ground point is only a fallback for rays that miss the mesh, and a
    // pick can land on a body whose ground ray misses the world entirely (a
    // chest pixel next to a wall), so the pick must not require a point.
    hoverFoe = onOwnTile
      ? null
      : (picked?.alive ? picked : null) || (point ? ask.enemyAtPoint(point) : null);
    if (view.phase !== 'player' || view.active.actor.moving || (!point && !hoverFoe)) { hidePreview(); return null; }
    // Armed: the movement trail yields to the to-hit readout over a target.
    if (view.armed) {
      if (actions[view.armed].type === 'summon') {
        if (point) showSummonPreview(point, sx, sy); else hidePreview();
        return hoverFoe;
      }
      if (ask.isZone(actions[view.armed])) {
        if (point) showZonePreview(point, sx, sy); else hidePreview();
        // A zone is aimed at the GROUND, so it must not claim a foe - the
        // crosshair would promise a swing the click does not make.
        return null;
      }
      // A buff points the other way, so it must NOT return a foe: main.js
      // keys the crosshair off this return value, and a crosshair over a
      // coworker while Performance Review is armed promises a swing the click
      // would refuse - the exact class of lie the one-hover-answer rule
      // exists to prevent (ARCHITECTURE, hover.js).
      // An ANY-target verb belongs to whichever half the cursor is on: over a
      // coworker it must promise the swing the click will make, over a
      // colleague the friendly cast. Only a friends-ONLY verb returns null
      // unconditionally - that is the lie-prevention rule, not a ban on verbs
      // that legitimately point both ways.
      if (ask.aimsAtAlly(actions[view.armed]) && !(ask.aimsAtAnyone(actions[view.armed]) && hoverFoe)) {
        showAllyPreview(point, sx, sy);
        return null;
      }
      // A dash is aimed at the FLOOR, so it keeps the movement trail rather
      // than a target readout - what the player needs to see is where they
      // would end up, which is the one preview the game already draws well.
      if (ask.isMobility(actions[view.armed])) { showDashPreview(point, sx, sy); return null; }
      showHitPreview(hoverFoe, sx, sy);
      return hoverFoe;
    }
    // Nothing armed, but a coworker under the cursor is still a target - the
    // click swings by default, so preview the odds rather than falling through
    // to a movement route (their tile isn't walkable, so that showed nothing at
    // all, which read as "a click here does nothing").
    if (hoverFoe) { showHitPreview(hoverFoe, sx, sy); return hoverFoe; }
    const tx = Math.round(point.x);
    const tz = Math.round(point.z);
    if (!world.isWalkable(tx, tz)) { hidePreview(); return; } // enemies/walls: no route preview
    let raw;
    if (tx === view.active.actor.x && tz === view.active.actor.z) {
      const pos = view.active.actor.entity?.getPosition();
      if (!pos) { hidePreview(); return; }
      raw = [[pos.x, pos.z], world.clampPoint(point.x, point.z)];
    } else {
      const p = world.findPath(view.active.actor.x, view.active.actor.z, tx, tz, view.active.actor);
      if (!p || p.length < 2) { hidePreview(); return; }
      raw = [...p.slice(0, -1), world.clampPoint(point.x, point.z)];
    }
    const s = world.smooth(raw, view.active.actor);
    const { points, cost, done, tail } = ask.truncateByBudget(s, ask.moveBudget(view.active), ask.stepCost);
    setPreview({ reach: points, tail });
    // Show what it actually costs YOU: the allowance is spent first, so a short
    // reposition can read as free even though the route has a distance cost.
    const free = Math.min(view.active.freeAp || 0, cost);
    const apPart = ask.roundAp(cost - free);
    const label = free > 0
      ? (apPart > 0 ? `${ask.fmtAp(apPart)} AP + ${ask.fmtAp(free)} move` : `${ask.fmtAp(free)} move (free)`)
      : `${ask.fmtAp(cost)} AP`;
    costTag.textContent = done ? label : `${label} - out of reach`;
    costTag.style.left = `${sx + 14}px`;
    costTag.style.top = `${sy + 14}px`;
    costTag.style.display = 'block';
  }

  function drawTargets() {
    drawAimWash();
    if (view.phase !== 'player') return;
    drawHeldCrouch();
    // Not gated on `armed`: with nothing armed a click still swings (the basic
    // attack), and a swing you can't see coming is worse than no swing at all -
    // the rings are how you know which coworker a click would hit and whether
    // you can afford it. previewAction() is that same fallback, so what's drawn
    // is always what would happen.
    const id = ask.previewAction();
    const a = id ? actions[id] : null;
    // A stale ease position would make the next cover arm GLIDE in from
    // wherever the last one stopped. Clear ONLY that easing state here. This
    // used to call clearAim(), erasing the live cone/zone cursor point one line
    // before their drawers read it; combat therefore showed a circular wash
    // but never the wedge or exact zone footprint that OOC aiming did.
    if (a?.type !== 'cover') clearCoverEase();
    if (!id) return;
    // ONE classifier for the whole pass (combat-targeting.verbSides). This
    // ladder used to be hand-written here in a different order from
    // `verbKind`'s, which is how `pull` came to be missing from the body gate
    // while `enemyRingOk` carried a live pull arm nothing could reach.
    const sides = ask.verbSides(a, ask.rangeOf(id));
    // A zone draws the fine mask it would actually cover - the same list the
    // click paints (zoneCells). Red on the aim point alone when placement is
    // refused.
    if (sides.kind === 'zone' && drawZoneRings(a, id)) return;
    // A summon rings the continuous rest points its employees would actually
    // take (green), or the exact aim alone in red when it is unusable - so
    // "where do they go?" is answered before the AP is spent.
    if (sides.kind === 'summon' && drawSummonRings(a, id)) return;
    // Take Cover rings the SPOT YOU WOULD STAND, in the cover yellow, and
    // draws the faces that would shield it. Ringing the shield instead was
    // the old aim's own confusion made visible: it told you which object you
    // had named while the side you would end up on - the thing that decides
    // which shots you are safe from - was chosen for you and never shown.
    // Now the ring is where you go and the bars are what covers you, so a
    // corner reads as a corner and you can see the open angle you are leaving.
    if (sides.kind === 'cover' && drawCoverRings(a, id)) return;
    // A buff rings the FRIENDLY side instead: green on every ally it could
    // land on right now, red on the ones out of range, out of line, or who
    // would get nothing from it. Same rule the click runs (buffProblem), so a
    // green ring is a promise.
    if (sides.allies && drawAllyRings(a, id, sides)) return;
    if (!sides.enemies) return;
    bodyTargets.draw(a, id);
  }

  return {
    // The two the frame loop drives, and the one main.js drives.
    drawTargets, drawPreview, handleHover, hidePreview,
    get hoverFoe() { return hoverFoe; },
    get hoverHitChance() { return hoverHitChance; },
    // The five ways in. `preview` and `aimPoint` are the only two pieces of
    // this state anything else writes, which is why they are the only two with
    // setters; the rest is nobody's business outside these drawers.
    get preview() { return preview; },
    setPreview,
    get aimPoint() { return aimPoint; },
    setAimPoint,
    // Combat clears the readout when a turn or a verb ends.
    setHoverFoe(en) { hoverFoe = en; },
    // A repaint the wash cannot predict: sight changed under it.
    bumpEpoch() { paintEpoch += 1; },
    clearAim,
  };
}
