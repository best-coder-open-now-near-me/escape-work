// WHAT A CLICK IN A FIGHT MEANS.
//
// A slice off `startCombat` (Q037): the verb arms, the enemy-click dispatcher,
// the routes a click may walk first, and the tile-click resolver.
//
// The dispatcher is the point of the file. It was a 253-line ladder with nine
// inline arms, each re-implementing the AP check, the arming teardown and the
// victory check (Q036); it is the gates, the auto-arm, one `refuse` closure and
// one line per kind now, with the arms that are more than a line named below.
// Two of the epilogues are deliberately NOT the same, and the names say so:
// `finishVerb` checks victory because a strike happened, `closedTheDistance`
// does not because none did - it is the walk-only branch, where nothing can
// have died. That asymmetry reads like a missing check and is not one.
//
// `lastClickOutcome` is written on every path through here, and it is the only
// thing that lets the e2e suite tell "refused because X" apart from "the click
// did nothing" - which is why the refusals set it before they log.
import { hasSwingSpot as hasSwingSpotFor, posOf, swingPointAt as swingPointFrom, verbReaches as verbReachesAt } from './combat-geometry.js';
import { NEIGHBOR_DIRS } from './directions.js';
import { verbKind, verbSides } from './combat-targeting.js';
import { ACTIONS } from './data/actions.js';
import { routeToFiringPosition, trimToFirst, truncateByBudget } from './pathfinding.js';
import { aimsAtAlly, aimsAtProps, isMobility, isPull, isToppleable, isZone } from './powers.js';
import { REACH, rangeOf, roundAp } from './stats.js';
import { dist, inReach, shieldingFace } from './tactics.js';

export function createClickVerbs(d) {
  // The verb arms that are more than one line, one function each. Each takes
  // the resolved action and the caller's `refuse`, which carries the auto-arm
  // teardown - so a refusal inside an arm still puts down a swing the player
  // never raised.
  //
  // Every arm returns, and the dispatch returns immediately after calling one.
  // None falls through to the melee tail; that tail is reached only by NOT
  // matching a kind above it, which is what makes it the default rather than
  // another arm.

  // The verb landed, and something may have died of it.
  function finishVerb() {
    d.disarm();
    d.refresh();
    if (!d.hostilesRemain()) d.victory();
  }

  // The walk happened and the verb did not. No strike, so nothing can have
  // died and there is no victory to check - the asymmetry with finishVerb is
  // the point, not an omission. Saying so out loud is also the point: a silent
  // stand-down was half of the stuck-walk-up bug's confusion.
  function closedTheDistance() {
    d.disarm();
    d.log('You close the distance.');
    d.refresh();
  }

  function clickShove(en, a, refuse) {
    if (!d.canReach(d.active, en, REACH.SHOVE)) {
      // Out of reach - but the office between you might BE the shove: a
      // cubicle wall to bring down on them (designer, 2026-07-30)...
      if (d.performPartitionTopple(en.x, en.z)) return;
      // ...or furniture beside you whose fall lands exactly on them. One
      // gesture: click the coworker behind the cabinet, wear the cabinet.
      for (const [dx, dz] of NEIGHBOR_DIRS) {
        const plan = d.topplePlan(d.active, d.active.actor.x + dx, d.active.actor.z + dz);
        if (!plan || plan.lx !== en.x || plan.lz !== en.z) continue;
        if (d.active.ap < a.ap) { refuse('Not enough AP.'); return; }
        d.active.ap = roundAp(d.active.ap - a.ap);
        d.active.actor.lunge(plan.x, plan.z);
        d.faceTarget(d.active, plan.x, plan.z);
        d.log(d.topple(d.active, plan));
        finishVerb();
        return;
      }
      refuse('Too far to shove.');
      return;
    }
    if (d.active.ap < a.ap) { refuse('Not enough AP.'); return; }
    d.joinCombat(en); // shoving a bystander is also an opinion they'll return
    d.active.ap = roundAp(d.active.ap - a.ap);
    d.active.actor.lunge(posOf(en).x, posOf(en).z);
    d.faceTarget(d.active, en.x, en.z);
    d.log(d.displaceBody(en, Math.sign(en.x - d.active.actor.x), Math.sign(en.z - d.active.actor.z)).msg);
    finishVerb();
    return;
  }

  function clickPull(en, a, refuse) {
    const plan = d.pullPlanFor(en);
    if (!plan) { refuse(d.pullRefusal(en)); return; }
    if (d.active.ap < a.ap) { refuse('Not enough AP.'); return; }
    d.joinCombat(en);
    d.active.ap = roundAp(d.active.ap - a.ap);
    d.performPull(d.armed, en, plan);
    return;
  }

  function clickRanged(en, a, refuse, range) {
    const thrown = !!a.ammoCost; // a wad and a staple miss differently
    const far = d.bodyDist(d.active, en) > range;
    const blocked = !d.bodyLos(d.active, en);
    // What the shot would ACTUALLY do from here (TACTICS_PLAN M6): a crouch
    // behind furniture refuses it outright - free, like every other
    // refusal - and a human shield takes it instead. Shooting THROUGH one
    // of your own is a decision this game does not take for you, so a
    // member-shield also refuses rather than quietly rerouting the damage.
    const out = d.shotOutcome(d.active, en);
    if (out.blocked) {
      refuse(`No shot - ${en.def.name} is tucked in behind the ${d.crouchLabel(out.blocked)}. Find an angle.`);
      return;
    }
    if (out.redirected && out.target.sheet) {
      refuse(`No shot - you would hit ${d.nameOf(out.target)}.`);
      return;
    }
    // A THROW refuses where it stands, exactly as it always has: you armed it
    // deliberately, it is billed in paper, and spending your last sheet at the
    // end of a walk you did not ask for is worse than being told no.
    if (thrown) {
      if (far) { refuse('Too far to throw.'); return; }
      if (blocked) { refuse('No clear line to throw.'); return; }
      if (d.active.sheet.paper < d.ammoCostOf(d.armed)) { refuse('Out of paper.'); return; }
      if (d.active.ap < a.ap) { refuse('Not enough AP.'); return; }
      d.active.actor.faceToward(en.x, en.z);
      if (out.redirected) d.log(`${d.nameOf(out.target)} takes it instead. That is the job.`);
      d.strike(d.armed, out.target);
      return;
    }
    if (!far && !blocked) {
      if (d.active.ap < a.ap) { refuse('Not enough AP.'); return; }
      d.active.actor.faceToward(en.x, en.z);
      if (out.redirected) d.log(`${d.nameOf(out.target)} takes it instead. That is the job.`);
      d.strike(d.armed, out.target);
      return;
    }
    // A ranged WEAPON closes until it can fire, the same way the melee swing
    // closes until it can hit. Its basic attack is what a bare click on a
    // coworker uses (defaultAttack), so refusing here would break the most
    // obvious verb in the game for anyone holding one: click a coworker two
    // rooms away with a stapler and you walk over; with a staple gun you
    // would have stood still and read a refusal. It walks the same route, it
    // just stops the moment the shot is on rather than at their elbow.
    // Route to a FIRING position, not to their elbow. routeIntoRange already
    // ends at the nearest tile the shot is legal from, so there is no
    // walk-further-then-cut-back step: the route costs the steps it needs and
    // not one more, by construction.
    const route = routeIntoRange(en, range);
    if (!route || route.length < 2) { refuse('No way to get a shot at them.'); return; }
    const shotBudget = d.moveBudget(d.active) - a.ap;
    // Stop at the first point THIS weapon can fire from, not at the firing
    // tile's centre: routeIntoRange picks the nearest legal tile, but the
    // route often crosses into range a step before reaching it - and a
    // 6-tile straw that walks to a tile it could have fired at from six
    // tiles back is the "much closer than needed" complaint in its ranged
    // form.
    const shotWalk = walkActive(route, shotBudget, null,
      (px, pz) => verbReaches(d.armed, en, px, pz));
    // Same honest split as the melee walk-up: a degenerate route is not an
    // AP problem, and must not be narrated as one.
    if (!shotWalk) {
      refuse(shotBudget > 0.05 ? 'No better shot to walk to.' : 'Not enough AP to get in range.');
      return;
    }
    // Will we be able to fire when the walk finishes? The arrival check
    // (pendingMelee, in the update loop) is authoritative either way - this
    // only decides whether to promise the shot or report the walk. Same
    // predicate the trim above stopped on, so the two cannot disagree.
    if (shotWalk.done && verbReaches(d.armed, en, shotWalk.end[0], shotWalk.end[1])) {
      d.setPendingMelee({ en, action: d.armed }); // fire on arrival
    } else {
      closedTheDistance();
    }
    return;
  }

  function clickMelee(en, a, refuse) {
    // Everything above dispatched the verbs that DO resolve on a coworker.
    // Whatever is still here falls through to the melee walk-up, which ends in
    // `strike` - and `strike` sends anything that is not a control to
    // `performOn`, which opens with `rand(a.min, a.max)`. An action carrying no
    // dice (a buff, a heal, a dash) rolls NaN there, and NaN damage used to
    // make hp NaN: never `<= 0`, so the target could not die and the fight
    // could not end. `takeDamage` now refuses non-finite amounts, but arriving
    // there at all means a verb was pointed at the wrong half of the board -
    // say so instead of walking them into a swing they never defined.
    // Does this verb point at THIS half of the board? One question, asked of
    // the one owner (combat-targeting.verbSides), rather than inferred.
    //
    // It used to be inferred, from "does this verb carry a payload to deliver"
    // (`a.purge || a.applies || Number.isFinite(a.amount)`). That answers a
    // different question, and three friendly verbs answered it yes: Performance
    // Review and Onboarding carry `applies`, Triage carries `amount: 10`. So
    // arming any of them and clicking a coworker walked the member into melee,
    // spent the AP and the use, rolled to hit, and delivered the buff - or the
    // ten-point heal - to the ENEMY (REVIEW.md 2026-08-02 section 1.3). Human
    // Resources' entire base kit is two of them.
    //
    // A dice-less verb is still admitted when it aims here: Reboot strips
    // statuses and deals nothing, and `performOn` resolves that as a pure
    // effect. What is refused now is a verb aimed at the OTHER half, which is
    // what the old comment already said this gate was for.
    if (!verbSides(a, rangeOf(d.armed)).enemies) {
      refuse(`${a.label} is not aimed at them.`);
      return;
    }
    // melee: walk up if needed, then strike
    if (d.canReach(d.active, en)) {
      if (d.active.ap < a.ap) { refuse('Not enough AP to attack.'); return; }
      d.active.actor.faceToward(en.x, en.z);
      d.strike(d.armed, en);
      return;
    }
    // walk the cheapest route to a tile the swing is legal from
    const best = routeBeside(en);
    // Sealed off, or every stand point beside them is line-blocked (ringed in
    // partitions): either way there is no swing to walk to, and saying so
    // beats the AP message this used to wear.
    if (!best) { refuse('No way to get a swing at them.'); return; }
    // walk up to their body, not the centre of the neighbouring tile.
    // The budget is the SAME one an ordinary move spends - allowance first,
    // then real AP (`moveBudget`) - minus the swing this walk is for. Billing
    // the walk against bare `ap` ignored the free movement allowance entirely,
    // so a character wearing it stopped short of a target they could plainly
    // afford to reach and stood there instead of hitting anyone.
    const budget = d.moveBudget(d.active) - a.ap;
    const walk = walkActive(best.path, budget, best.point,
      (px, pz) => verbReaches(d.armed, en, px, pz));
    // A null walk has two honest readings, and only one is about AP: with
    // budget in hand it means the route degenerated to nothing (walkActive's
    // no-progress guard). Blaming AP for that was this bug's face: "Not
    // enough AP to reach them" at 5.9 of 6 AP.
    if (!walk) {
      refuse(budget > 0.05 ? 'Already as close as the route gets.' : 'Not enough AP to reach them.');
      return;
    }
    // The walk's endpoint is already a free point, so this asks the honest
    // question directly instead of rounding it back to a tile first: will we
    // be standing inside reach when the walk finishes? Same predicate the trim
    // stopped on and the arrival check re-runs, LINE TEST INCLUDED - promising
    // on distance alone let a partition cancel the strike this walk was for,
    // silently.
    if (walk.done && verbReaches(d.armed, en, walk.end[0], walk.end[1])) {
      d.setPendingMelee({ en, action: d.armed }); // strike on arrival
    } else {
      closedTheDistance();
    }
  }

  function handleEnemyClick(en) {
    if (d.phase !== 'player' || d.active.actor.moving || !en.alive) {
      // This return is SILENT by design - a click on an AI turn or mid-walk
      // is simply ignored - which also made it invisible in flake traces:
      // "the click did nothing and nothing said why". The breadcrumb names
      // the reason for the e2e suite without changing behavior.
      d.setLastClickOutcome(d.phase !== 'player' ? 'gate:phase'
        : (d.active.actor.moving ? 'gate:moving' : 'gate:dead'));
      return;
    }
    d.hidePreview();
    let autoArmed = false;
    if (!d.armed) {
      // Not enough AP for even the basic swing: say so once, rather than
      // silently walking them into the enemy's face.
      const id = d.defaultAttack();
      if (d.active.ap < ACTIONS[id].ap) { d.log('Not enough AP to attack.'); return; }
      d.setArmed(id);
      autoArmed = true;
      d.refresh(); // the bar lights the swing that is about to happen
    }
    // A refusal keeps a USER-armed action armed - aim survives a near-miss,
    // right-click lowers it. The default the click just auto-armed is not
    // aim: the player never raised it, so a refusal must put it back down.
    // Left dangling, it sat lit on the bar until a right-click, and anything
    // waiting for the swing to resolve (the e2e idle() helper) hung forever.
    const refuse = (msg) => {
      d.setLastClickOutcome(`refused:${msg}`);
      d.log(msg);
      if (autoArmed) { d.disarm(); d.refresh(); }
    };
    d.setLastClickOutcome('acted'); // overwritten by refuse(); the gate stamped its own
    const a = ACTIONS[d.armed];
    // WHICH verb this click is, from the same classifier the target rings
    // dispatch on (combat-targeting.verbKind). Two hand-written ladders of
    // `a.type` tests in slightly different orders is exactly how the rings came
    // to contradict the click; there is one ladder now, and the arms below are
    // what each branch DOES.
    const kind = verbKind(a, rangeOf(d.armed));
    // Take Cover clicked on a coworker: they are the shield ("any character
    // as cover" - crouching behind your enemy is legal, if bold).
    if (kind === 'cover') { d.performTakeCover(en.x, en.z); return; }
    if (kind === 'cone') { d.fireCone(posOf(en).x, posOf(en).z); return; }
    // Placing a summon on top of a coworker: the tile is taken, so they report
    // to the free ground ringing outward from it. Aiming at the enemy you want
    // them to swarm is a reasonable thing to click.
    if (kind === 'summon') { d.placeSummon(en.x, en.z); return; }
    // Aiming a zone at a coworker is a reasonable thing to click - you want it
    // under THEM - so it resolves on their tile rather than refusing. Their own
    // tile is excluded from the footprint (zoneCells), so what lands is the
    // ring around their feet.
    if (kind === 'zone') { d.performZone(d.armed, posOf(en).x, posOf(en).z); return; }
    // A RANGED control (a cone, or one carrying `range`) resolves from where
    // you stand. A touch-range one classifies as 'melee' and falls through to
    // the walk-up below rather than getting its own copy of it - and `strike`
    // is what makes the arrival resolve as a control instead of a swing.
    if (kind === 'control') { d.performControl(d.armed, en); return; }
    if (kind === 'shove') { clickShove(en, a, refuse); return; }
    if (kind === 'pull') { clickPull(en, a, refuse); return; }
    if (kind === 'ranged') { clickRanged(en, a, refuse, rangeOf(d.armed)); return; }
    clickMelee(en, a, refuse);
  }


  // THE verb's own reach, as one spec: a declared `range` (aimRangeOf - the
  // shapes powers.js owns) or a plain ranged attack's (stats.rangeOf, which is
  // where a throw's undeclared THROW_RANGE lives), and null for a touch verb
  // that walks into melee reach. The aim wash, the target rings and every
  // walk-up read it, so a power's range means one thing everywhere.
  // The reach vocabulary - all four now live in combat-geometry.js, bound
  // here to the world and to whoever is acting. `reachSpecOf`/`actRangeOf` need
  // neither, so they are re-exported straight through.
  const verbReaches = (id, en, px, pz) =>
    verbReachesAt(id, d.active, en, px, pz, d.world);
  const swingPointAt = (en, gx, gz) => swingPointFrom(d.active, en, gx, gz, d.world);
  const hasSwingSpot = (en) => hasSwingSpotFor(d.active, en, d.world);

  // The cheapest walkable route to a tile BESIDE `en` from which the swing
  // actually LANDS, plus the exact point to stop at: { path, point }, or null
  // when no adjacent tile offers a legal swing. Choosing by path length alone
  // used to send the walk to the nearest tile even when a partition blocked
  // every swing from it - the arrival check then cancelled the strike it had
  // promised, and every re-click regenerated the same dead-end point: a
  // zero-length walk, reported (falsely) as an AP shortage.
  function routeBeside(en) {
    let best = null;
    for (const [dx, dz] of NEIGHBOR_DIRS) {
      const gx = en.x + dx;
      const gz = en.z + dz;
      const point = swingPointAt(en, gx, gz);
      if (!point) continue;
      // Already STANDING on a legal goal tile - out of reach only because the
      // body rests on its far side - means the "route" is a shuffle inside
      // this tile; the approach point closes the last half-tile to their
      // body. findPath returns the one-tile path [[gx,gz]] here, and its
      // length of 1 used to win the shortest-path contest and then fail the
      // >= 2 check: the player CLOSEST to the target was the one told there
      // was no way to reach them.
      if (gx === d.active.actor.x && gz === d.active.actor.z) {
        return { path: [[gx, gz], [gx, gz]], point };
      }
      const p = d.world.findPath(d.active.actor.x, d.active.actor.z, gx, gz, d.active.actor);
      if (p && p.length >= 2 && (!best || p.length < best.path.length)) best = { path: p, point };
    }
    return best;
  }

  // The cheapest walkable route to a tile this weapon could FIRE from, or null
  // if none is reachable. The rule itself is pure and shared with the
  // out-of-combat twin (pathfinding.js) - only the world bindings differ.
  //
  // A target crouched behind furniture (TACTICS_PLAN M6) shrinks the set of
  // legal firing tiles to the angles its shield does not block - so the
  // walk-into-range a ranged weapon already does becomes a walk-into-FLANK
  // for free. A human shield does not shrink it: the shot resolves on the
  // shield from anywhere (performOn decides whether that is a shot you take).
  const routeIntoRange = (en, range) => {
    const s = d.crouchStateOf(en);
    const angleClear = (x, z) => {
      if (!s) return true;
      // A face held by a BODY does not shrink the set: the shot resolves on
      // that body from anywhere, and whether to take it is performOn's call.
      const face = shieldingFace(s.faces, x, z, en.x, en.z);
      if (!face) return true;
      return !!d.unitStandingAt(en.x + face[0], en.z + face[1]);
    };
    return routeToFiringPosition({
      tx: en.x,
      tz: en.z,
      range,
      fromX: d.active.actor.x,
      fromZ: d.active.actor.z,
      isWalkable: (x, z) => d.world.isWalkable(x, z),
      // Candidates are tiles (planning is legitimately tile-shaped), but the
      // filter must under-promise the CIRCLE the arrival check measures
      // (verbReaches, body to body): a corner tile inside the old cheb square
      // but outside the radius would be walked to and then refused.
      hasLos: (x, z, tx, tz) => dist(x, z, tx, tz) <= range
        && d.world.hasLos(x, z, tx, tz) && angleClear(x, z),
      findPath: (x, z) => d.world.findPath(d.active.actor.x, d.active.actor.z, x, z, d.active.actor),
    });
  };

  // Smooth a raw tile route and walk the ACTIVE member along it, charging by
  // DISTANCE (stepCost per tile-length) and stopping mid-segment - at any
  // free point - when `budget` runs out. Optionally swap the final waypoint
  // for a precise clicked point. Spends their AP. Returns { done, end } or
  // null if nothing was walkable.
  // `stopWhen` (optional) ends the walk at the first point along the SMOOTHED
  // route where it holds - a walk-up stops the moment its verb is live rather
  // than continuing to the tile beside the target. Trimming after smoothing is
  // what puts the stop point on the line actually being walked; trimming the
  // raw tile route would put it back on the grid.
  function walkActive(rawPath, budget, endPoint = null, stopWhen = null) {
    if (endPoint) rawPath = [...rawPath.slice(0, -1), endPoint];
    let s = d.world.smooth(rawPath, d.active.actor);
    if (stopWhen) s = trimToFirst(s, stopWhen) || s;
    const { points, cost, done } = truncateByBudget(s, Math.max(0, budget), d.stepCost);
    // Nothing to walk: no AP spent, the caller prints a refusal - and, now, no
    // cover lost. `breakCrouch` used to be the FIRST statement here, so a click
    // this function was going to refuse still stood the member up and took the
    // `covered` status off them, for free. The hover twin `previewWalk`
    // deliberately does not break the crouch, which made the same arithmetic
    // safe to look at and destructive to click (REVIEW.md 2026-08-02 sec 1.8).
    if (points.length < 2 || cost < 0.05) return null;
    // Moving is the one thing a crouch does not survive (TACTICS_PLAN M6,
    // designer default): the commitment ends the moment the walk begins, not
    // when it lands somewhere else. Which is here - beside `beginMove`, where
    // the comment above always claimed it was.
    d.breakCrouch(d.active);
    d.hidePreview();
    // Walking spends the AP a pending confirm was priced against, so the
    // confirm lapses here rather than committing later at a price this member
    // can no longer pay (which drove AP negative and broke refresh()).
    d.setPendingConfirm(null);
    d.beginMove(d.active); // a deliberate move - leaving reach can provoke
    d.active.actor.setPath(points);
    d.billMove(d.active, cost); // the movement allowance first, then real AP
    d.refresh();
    return { done, end: points[points.length - 1] };
  }

  function handleTileClick(tile, point = null) {
    d.setLastClickOutcome('tile'); // the click resolved to ground, not a coworker
    if (d.phase !== 'player' || d.active.actor.moving || !tile) return;
    if (d.armed) {
      const a = ACTIONS[d.armed];
      // Cones fire at wherever you click - ground included.
      if (a.cone && point) { d.fireCone(point.x, point.z); return; }
      // A summon rests around the exact clicked point; the movement tile is
      // derived only after the body-clear point has been chosen.
      if (a.type === 'summon') {
        d.placeSummon(point ? point.x : tile.x, point ? point.z : tile.z);
        return;
      }
      // A zone lands where you clicked - ground, and only ground.
      if (isZone(a)) {
        // The exact clicked point when the pick has one - the zone's disc is
        // centred where the player aimed (DEGRID M6).
        d.performZone(d.armed, point ? point.x : tile.x, point ? point.z : tile.z);
        return;
      }
      // An ally/any-side verb aimed at the ground resolves to whoever is
      // STANDING there - yourself included. Reboot declares `side: 'any'`, so
      // its self-cast follows this same billed, narrated path.
      if (aimsAtAlly(a)) {
        const m = d.allyAtPoint(point)
          || d.friendlies().find((f) => f.actor.x === tile.x && f.actor.z === tile.z);
        if (m) {
          if (isMobility(a)) d.performSwap(d.armed, m); else d.performBuff(d.armed, m);
          return;
        }
        d.log('Aim at a teammate - or at yourself.');
        return;
      }
      // A dash is aimed at the ground, like a walk - because that is what it
      // is, bought at a flat price and free of opportunity attacks.
      if (isMobility(a)) { d.performDash(d.armed, tile.x, tile.z, point); return; }
      // Take Cover aimed at the ground resolves on whatever the tile holds -
      // furniture or a body - and performTakeCover says why when it is
      // neither (TACTICS_PLAN M6).
      if (a.type === 'cover') { d.performTakeCover(tile.x, tile.z, point); return; }
      // Shove a PROP over (POWERS_PLAN M6). The same verb, aimed at furniture
      // instead of a person: walk up, put your shoulder into the bookcase, and
      // it lands on whoever is behind it. It costs the shove's own AP and
      // needs the shove's own reach, so nothing new has to be learned.
      if (a.type === 'shove') {
        const plan = d.topplePlan(d.active, tile.x, tile.z);
        if (plan) {
          if (d.active.ap < a.ap) { d.log('Not enough AP.'); return; }
          if (!inReach(posOf(d.active).x, posOf(d.active).z, tile.x, tile.z, REACH.SHOVE)) {
            d.log('Too far to shove.');
            return;
          }
          d.active.ap = roundAp(d.active.ap - a.ap);
          d.active.actor.lunge(tile.x, tile.z);
          d.faceTarget(d.active, tile.x, tile.z);
          d.log(d.topple(d.active, plan));
          d.disarm();
          d.refresh();
          if (!d.hostilesRemain()) d.victory();
          return;
        }
        // A toppleable prop with nothing behind it just rocks - say so, rather
        // than falling through to the generic "Invalid target", which reads as
        // "this prop is not the kind that falls" and is a different (wrong)
        // lesson.
        if (isToppleable(d.world.tileDefAt(tile.x, tile.z))) {
          d.log('It rocks, and settles. Nothing behind it to fall into.');
          return;
        }
        // A cubicle wall between you and the clicked tile: the shove knocks
        // the PARTITION over onto it (designer, 2026-07-30).
        if (d.performPartitionTopple(tile.x, tile.z)) return;
      }
      // Pull Over aimed at the ground resolves on whoever HOLDS the tile -
      // the same rule Take Cover reads, and for the same reason: its whole
      // target class is crouched bodies, and a crouched body is a squashed
      // pose that is easy to click past (TACTICS_PLAN M8).
      if (isPull(a)) {
        const en = d.world.liveEnemies().find((e) => e.x === tile.x && e.z === tile.z);
        if (en) { handleEnemyClick(en); return; }
        d.log('Aim at a coworker dug in behind cover.');
        return;
      }
      // An attack aimed at the furniture (TACTICS_PLAN M8): a breakable prop
      // on the tile, or a partition on its face toward you, takes the hit -
      // melee and ranged both, and "gone means gone" at zero.
      if (aimsAtProps(a)) {
        const plan = d.breakPlanAt(d.armed, tile.x, tile.z);
        if (plan?.refusal) { d.log(plan.refusal); return; }
        if (plan) { d.performBreak(d.armed, plan); return; }
      }
      // Aiming: a left click NEVER cancels. Missing the target used to lower
      // the action (and, with a cone out of AP, could strand you unable to do
      // either) - so say what went wrong and stay armed. Right-click cancels.
      d.log('Invalid target.');
      return;
    }
    if (!d.world.isWalkable(tile.x, tile.z)) return;
    d.setPendingMelee(null);
    d.setPendingCrouch(null);
    if (point && tile.x === d.active.actor.x && tile.z === d.active.actor.z && d.active.actor.entity) {
      // shuffling within the current tile is a move too
      const pos = d.active.actor.entity.getPosition();
      walkActive([[pos.x, pos.z], d.world.clampPoint(point.x, point.z)], d.moveBudget(d.active));
      return;
    }
    const p = d.world.findPath(d.active.actor.x, d.active.actor.z, tile.x, tile.z, d.active.actor);
    if (!p || p.length < 2) return;
    walkActive(p, d.moveBudget(d.active), point ? d.world.clampPoint(point.x, point.z) : null);
  }


  return {
    finishVerb,
    closedTheDistance,
    clickShove,
    clickPull,
    clickRanged,
    clickMelee,
    handleEnemyClick,
    verbReaches,
    swingPointAt,
    hasSwingSpot,
    routeBeside,
    routeIntoRange,
    walkActive,
    handleTileClick,
  };
}
