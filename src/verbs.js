// THE REST OF THE VERBS: repositioning, ground effects, control, support, and
// the cone.
//
// A slice off `startCombat` (Q037) and the largest single one taken from this
// file. Each of these is a `perform<Verb>` - the half that SPENDS: AP off the
// pool, a body moved, a status applied, the bar disarmed, victory re-checked.
// The plan halves already live in combat-plans.js and powers.js; what is here
// is everything that has a consequence.
//
// They travel together because they share one shape and one bug surface. Every
// one ends the same way - `disarm()`, `refresh()`, and a victory check if it
// could have killed - and every one records `lastClickOutcome`, which is the
// only thing that lets the e2e suite tell "refused because X" apart from
// "nothing happened".
//
// One decision worth keeping in view, because it reads like an oversight: dash
// and swap are FREE of opportunity attacks on purpose. The threat code
// punishes a mover it holds a `moveStart` record for, which is the same seam a
// shove glide already uses ("forced movement never provokes", TACTICS_PLAN #9)
// - so granted movement joins forced movement rather than growing a second
// exemption the threat code would have to learn about.
import { TARGET_R, playerSideAt, posOf, zoneCellsFor } from './combat-geometry.js';
import { verb } from './creation.js';
import { ACTIONS } from './data/actions.js';
import { STATUSES } from './data/statuses.js';
import { MISS_COLOR } from './hit-resolution.js';
import { truncateByBudget } from './pathfinding.js';
import { aimsAtAlly, buffOutcome, buffProblem, controlIsRanged, controlOutcome, controlProblem, dashDistanceOf, isControl, isMobility, mobilityProblem, zoneProblem } from './powers.js';
import { damageBonus, roundAp, soakHit } from './stats.js';
import { applyStatus, blockedBy, clearStatuses, statusList } from './statuses.js';
import { dist, inReach } from './tactics.js';
import { livingMemberAt } from './member-rules.js';

export function createVerbs(d) {
  // Repositioning that the AP economy cannot buy. A dash carries you a fixed
  // DISTANCE for a flat cost; a swap trades places with a teammate across the
  // room. Both are free of opportunity attacks, and that is the point: until
  // now the only answer to the threat ring was the Manager's `noProvoke`
  // talent, which is a passive nobody chooses in the moment. This is the
  // counterplay as a decision.
  //
  // NOT provoking is achieved by NOT calling beginMove: `notifyStep` only
  // punishes a mover it has a `moveStart` record for, which is the same seam a
  // shove glide already uses ("forced movement never provokes", TACTICS_PLAN
  // #9). Granted movement joins forced movement rather than growing a second
  // exemption the threat code would have to learn.
  function performDash(id, tx, tz, point) {
    const a = ACTIONS[id];
    const problem = mobilityProblem(a, {
      ap: d.active.ap,
      usesLeft: a.uses ? d.active.usesLeft[id] ?? 0 : null,
    });
    if (problem) { d.setLastClickOutcome(`refused:${problem}`); d.log(problem); return; }
    const raw = (tx === d.active.actor.x && tz === d.active.actor.z)
      ? null
      : d.world.findPath(d.active.actor.x, d.active.actor.z, tx, tz, d.active.actor);
    if (!raw || raw.length < 2) { d.log('No route there.'); return; }
    const end = point ? d.world.clampPoint(point.x, point.z) : null;
    const smoothed = d.world.smooth(end ? [...raw.slice(0, -1), end] : raw, d.active.actor);
    // Truncated by DISTANCE, at a flat cost per tile-length, so the terrain's
    // `slow` does not tax a dash the way it taxes a walk. A dash that got
    // shorter through coffee would be a walk with extra steps.
    const { points, done } = truncateByBudget(smoothed, dashDistanceOf(a), () => 1);
    if (points.length < 2) { d.log('Nowhere to go.'); return; }
    d.active.ap = roundAp(d.active.ap - a.ap);
    if (a.uses) d.active.usesLeft[id] -= 1;
    d.hidePreview();
    d.active.actor.setPath(points); // deliberately WITHOUT beginMove - see above
    d.log(done ? a.log : `${a.log} You run out of corridor.`);
    d.disarm();
    d.refresh();
  }

  // Trade places with a teammate. Both bodies move, neither provokes, and the
  // swap is legal even when the two tiles could not be walked between - it is
  // a courier's trick, not a route.
  function performSwap(id, m) {
    const a = ACTIONS[id];
    const problem = mobilityProblem(a, {
      dist: d.bodyDist(d.active, m),
      los: d.bodyLos(d.active, m),
      ap: d.active.ap,
      usesLeft: a.uses ? d.active.usesLeft[id] ?? 0 : null,
      allyHp: m.sheet.hp,
    });
    if (problem) { d.setLastClickOutcome(`refused:${problem}`); d.log(problem); return; }
    if (m === d.active) { d.log('You are already there.'); return; }
    const mine = { x: d.active.actor.x, z: d.active.actor.z };
    const theirs = { x: m.actor.x, z: m.actor.z };
    // Trade PLACES, not tile centres: each body takes the other's actual
    // rest point, so the free-point stances both had survive the trick.
    const myRest = posOf(d.active);
    const theirRest = posOf(m);
    d.active.ap = roundAp(d.active.ap - a.ap);
    if (a.uses) d.active.usesLeft[id] -= 1;
    // pushTo is the existing "move a body without it counting as a walk" call
    // (the shove's glide). Using it here means the swap cannot provoke and
    // cannot trigger a per-tile hazard hook mid-flight.
    // Both bodies changed tiles, so neither crouch survives - the swap is
    // exactly the "pull the wounded out of cover" verb (TACTICS_PLAN M6);
    // refresh()'s revalidation would catch it, but breaking here logs it in
    // the same beat as the trade instead of a surprise line later.
    d.breakCrouch(d.active);
    d.breakCrouch(m);
    d.active.actor.pushTo(theirs.x, theirs.z, theirRest.x, theirRest.z);
    m.actor.pushTo(mine.x, mine.z, myRest.x, myRest.z);
    d.log(`${a.log} You and ${m.sheet.name} trade places.`);
    d.disarm();
    d.refresh();
  }

  // --- the zone verb (POWERS_PLAN M3) --------------------------------------
  // `leaves` used to be welded to the cone attack, so the only way to put
  // paper on the floor was to also swing at somebody. Freed into its own verb,
  // placing a surface becomes a PLAN - fuel you lay before you light it,
  // caltrops across the doorway they have to come through - and it hands the
  // fire/conduction simulation a player-driven source instead of only the
  // hazards the level author painted.
  //
  // Which tiles a zone may actually take, given the grid: plain floor only
  // (leaveSurface's own rule), never under a living body. Shared by the click
  // and the preview so the tiles you saw are the tiles you get.
  // The zone's covered tiles - the geometry in combat-geometry.js, the
  // occupancy question answered here because only combat knows who is standing
  // where.
  // Sighted from the aimer's BODY - the same origin the aim range measures
  // from, so a cell the wash paints is a cell the drop covers.
  const zoneCells = (a, tx, tz) => zoneCellsFor(a, posOf(d.active), tx, tz, {
    canTakeSurface: d.world.canTakeSurface,
    hasLos: d.world.hasLos,
    occupied: (x, z) => !!livingMemberAt(d.members, x, z)
      || d.world.liveEnemies().some((e) => e.x === x && e.z === z),
  });

  function performZone(id, tx, tz) {
    const a = ACTIONS[id];
    const problem = zoneProblem(a, {
      dist: d.distToTile(d.active, tx, tz),
      los: d.losToTile(d.active, tx, tz),
      ap: d.active.ap,
      usesLeft: a.uses ? d.active.usesLeft[id] ?? 0 : null,
    });
    if (problem) { d.setLastClickOutcome(`refused:${problem}`); d.log(problem); return; }
    const cells = zoneCells(a, tx, tz);
    d.active.ap = roundAp(d.active.ap - a.ap);
    if (a.uses) d.active.usesLeft[id] -= 1;
    d.faceTarget(d.active, tx, tz);
    d.active.actor.lunge(tx, tz);
    let laid = 0;
    for (const [x, z] of cells) {
      if (d.world.leaveSurface(x, z, a.leaves, a.leavesTurns || 0)) laid += 1;
    }
    // Saying how much of it landed matters more here than on any other verb:
    // the tiles a zone can take are whatever happens to be plain floor, so the
    // same click over carpet and over a cubicle row spends the same AP for
    // very different results, and silence would read as a dud.
    d.log(laid ? `${a.log} ${laid} tile${laid > 1 ? 's' : ''} covered.` : `${a.log} Nothing here will take it.`);
    d.disarm();
    d.refresh();
  }

  // --- the control verb (POWERS_PLAN M2) -----------------------------------
  // Control deals NO damage. That is the design rule, not an omission: a power
  // that stuns AND hits is two powers, and the AP economy (2 AP against a 5-7
  // pool) cannot price both. It still rolls to hit, because a guaranteed stun
  // at 2 AP is the degenerate case - and because HIT_PLAN's "a miss spends the
  // cost and does nothing else" is what keeps the anti-chain window from being
  // the only counterplay control has.
  function performControl(id, en) {
    const a = ACTIONS[id];
    const ranged = controlIsRanged(a);
    const problem = controlProblem(a, {
      dist: d.bodyDist(d.active, en),
      los: d.bodyLos(d.active, en),
      inReach: d.canReach(d.active, en),
      ap: d.active.ap,
      usesLeft: a.uses ? d.active.usesLeft[id] ?? 0 : null,
      alive: en.alive,
    });
    if (problem) { d.setLastClickOutcome(`refused:${problem}`); d.log(problem); return; }
    d.joinCombat(en);
    // Spend first, as every other action does: a miss burns the AP and the use
    // (HIT_PLAN #4).
    d.active.ap = roundAp(d.active.ap - a.ap);
    if (a.uses) d.active.usesLeft[id] -= 1;
    if (ranged) {
      d.fx.projectile(posOf(d.active), posOf(en), 'ball');
    } else {
      d.active.actor.lunge(posOf(en).x, posOf(en).z);
    }
    d.faceTarget(d.active, en.x, en.z);
    if (!d.rollAgainst(d.active, en)) {
      d.hitFx(en, 'whiff');
      d.fx.damageText(en.x, en.z, 'MISS', MISS_COLOR);
      d.log(a.missLog || `${a.log} It does not take.`);
      d.disarm();
      d.refresh();
      return;
    }
    const plan = controlOutcome(a);
    let line = a.log || `${a.label}.`;
    // The status first, THEN the displacement: a control that both roots and
    // pushes should root them where they LAND, and the reverse order would
    // also let a lethal slam swallow the status silently.
    if (plan.applies) {
      const blocked = blockedBy(en, plan.applies);
      // Their Composure resist, same as a member's against an enemy apply
      // (combat.js) - this used to hardcode 0, one of the sites that quietly
      // asserted coworkers had no Composure.
      if (applyStatus(en, plan.applies, {}, en.combat.statusResist)) {
        d.statusFxAt(en, plan.applies);
        line += ` ${d.appliesLine(a, en.def.name)}`;
        // `charmed` is the one status that changes which SIDE somebody is on
        // rather than anything about them, so the roster and turn-order move
        // happens here rather than in an `effects` block the status system
        // would have to learn a whole new kind of.
        if (plan.applies === 'charmed') d.charmUnit(en, STATUSES.charmed.duration);
      } else if (blocked) line += ` ${d.immunityLine(blocked, en.def.name)}`;
    }
    if (plan.displace) {
      const dx = Math.sign(en.x - d.active.actor.x) * plan.displace;
      const dz = Math.sign(en.z - d.active.actor.z) * plan.displace;
      const res = d.displaceBody(en, dx, dz, { verb: 'send', slamDmg: 0 });
      if (res.msg) line += ` ${res.msg}`;
    }
    d.log(line);
    d.disarm();
    d.refresh();
    if (!d.hostilesRemain()) d.victory();
  }

  // What a landed melee action DOES on arrival. The walk-up path and the
  // already-in-reach path both route through here, so a control that walked
  // you in resolves as a control and not as a swing - the one dispatch a new
  // touch-range verb has to join, instead of a branch in each of the three
  // places that finish an approach.
  const strike = (id, en) => (isControl(ACTIONS[id]) ? performControl(id, en) : d.performOn(id, en));

  // --- the friendly verb (POWERS_PLAN M1) ----------------------------------
  // Everyone a buff may be aimed at: living party members AND your summons,
  // yourself included. A summon is a member with a sheet, so healing or
  // commending one is free of special cases - which is the payoff for
  // SUMMON_PLAN having made player-side summons real members rather than a
  // parallel kind of thing.
  const friendlies = () => d.livingMembers();

  // The ally whose BODY is nearest this ground point, or null. The friendly
  // twin of enemyAtPoint, measured against continuous positions for the same
  // reason: the logical tile is rounded, and at this camera angle a tall mesh
  // reads a tile off.
  function allyAtPoint(point) {
    if (!point) return null;
    let best = null;
    for (const m of friendlies()) {
      const p = posOf(m);
      const gap = Math.hypot(p.x - point.x, p.z - point.z);
      if (gap < 0.7 && (!best || gap < best.d)) best = { m, d: gap };
    }
    return best?.m || null;
  }

  // Why an ally-aimed action cannot land on this teammate, or null. ONE
  // dispatch for the two verbs that point at friends, so the rings, the cursor
  // and the click ask the same question of both - three call sites each
  // consulting its own verb's rule is exactly how the crosshair and the
  // readout came to disagree once already.
  const allyProblemFor = (id, m) => {
    const a = ACTIONS[id];
    const common = {
      ...buffReach(m),
      ap: d.active.ap,
      usesLeft: a.uses ? d.active.usesLeft[id] ?? 0 : null,
    };
    if (isMobility(a)) return mobilityProblem(a, { ...common, allyHp: m.sheet.hp });
    return buffProblem(a, {
      ...common,
      hp: m.sheet.hp,
      maxHp: m.sheet.maxHp,
      statusCount: statusList(m.sheet).length,
    });
  };

  // Distance and line to an ally, in the units buffProblem expects.
  const buffReach = (m) => ({
    dist: d.bodyDist(d.active, m),
    // Aiming at yourself never needs a line to yourself - and hasLos on your
    // own tile is a degenerate trace that has no reason to be asked.
    los: m === d.active || d.bodyLos(d.active, m),
  });

  // Commit a buff on an ally. No hit roll: you do not miss a colleague you are
  // trying to help, and gating a support action behind the same whiff that
  // gates a swing would make the support class the one that fails at its job
  // (HIT_PLAN gates DAMAGE, which this deals none of).
  function performBuff(id, m) {
    const a = ACTIONS[id];
    const problem = buffProblem(a, {
      ...buffReach(m),
      hp: m.sheet.hp,
      maxHp: m.sheet.maxHp,
      statusCount: statusList(m.sheet).length,
      ap: d.active.ap,
      usesLeft: a.uses ? d.active.usesLeft[id] ?? 0 : null,
    });
    if (problem) { d.setLastClickOutcome(`refused:${problem}`); d.log(problem); return; }
    const plan = buffOutcome(a, { hp: m.sheet.hp, maxHp: m.sheet.maxHp });
    d.active.ap = roundAp(d.active.ap - a.ap);
    if (a.uses) d.active.usesLeft[id] -= 1;
    if (m !== d.active) d.faceTarget(d.active, m.actor.x, m.actor.z);
    const who = m === d.active ? 'yourself' : m.sheet.name;
    let line = `${a.log || a.label + '.'}`;
    if (plan.purges) {
      clearStatuses(m.sheet);
      line += m === d.active
        ? ' Everything you were carrying clears.'
        : ` Everything ${m.sheet.name} was carrying clears.`;
    }
    if (plan.healed > 0) {
      m.sheet.hp += plan.healed;
      d.hitFx(m, 'heal');
      d.fx.damageText(m.actor.x, m.actor.z, `+${plan.healed}`, '#8adf76');
      line += ` +${plan.healed} HP.`;
    }
    // A buff is never resisted - `commended`/`onboarded` are resistable:false,
    // so the resist argument would be inert anyway, but passing the target's
    // own Composure would be actively wrong: it would make helping a composed
    // teammate WORSE than helping a rattled one.
    if (plan.applies && applyStatus(m.sheet, plan.applies)) {
      d.statusFxAt(m, plan.applies);
      line += ` ${d.appliesLine(a, who)}`;
    }
    d.log(line);
    d.disarm();
    d.refresh();
  }

  // A click on a friendly body while a buff is armed. Mirrors
  // handleEnemyClick's gate exactly - your turn, standing still - so the two
  // halves of the board refuse for the same reasons.
  function handleAllyClick(m) {
    if (d.phase !== 'player' || d.active.actor.moving || !m?.actor || m.sheet.hp <= 0) {
      d.setLastClickOutcome(d.phase !== 'player' ? 'gate:phase'
        : (d.active.actor.moving ? 'gate:moving' : 'gate:dead'));
      return;
    }
    if (!d.armed || !aimsAtAlly(ACTIONS[d.armed])) return false;
    d.hidePreview();
    d.setLastClickOutcome('acted');
    if (isMobility(ACTIONS[d.armed])) performSwap(d.armed, m);
    else performBuff(d.armed, m);
    return true;
  }

  // Fire an armed cone attack toward (tx, tz): per-target damage rolls for
  // every enemy in the wedge with line of sight, then the wedge's plain floor
  // is carpeted with the action's `leaves` surface.
  function fireCone(tx, tz) {
    const a = ACTIONS[d.armed];
    if (d.active.ap < a.ap) { d.log('Not enough AP.'); return; }
    const test = d.coneTest(a, tx, tz);
    if (!test) { d.log('Aim somewhere.'); return; }
    // A rationed cone (All Hands) spends its use here. fireCone never
    // decremented one because the only cone that existed was unlimited - which
    // is exactly the bug Detain already had on the single-target path: a
    // counter that never moves while the tooltip goes on promising uses left.
    if (a.uses) {
      if (d.active.usesLeft[d.armed] <= 0) { d.log(`No ${a.label.toLowerCase()} left this fight.`); return; }
      d.active.usesLeft[d.armed] -= 1;
    }
    d.active.ap = roundAp(d.active.ap - a.ap);
    d.active.actor.lunge(tx, tz);
    d.faceTarget(d.active, tx, tz); // the cone points where you aimed it
    if (a.leaves === 'paper') d.fx.paperFan?.(test.origin, test.angle, a.cone);
    let hits = 0;
    for (const en of d.world.liveEnemies()) {
      // Same body-radius test the ring previewed - what you saw is what lands.
      const bp = en.entity ? en.entity.getPosition() : { x: en.x, z: en.z };
      if (!test(bp.x, bp.z, TARGET_R)) continue;
      if (!d.bodyLos(d.active, en)) continue;
      d.joinCombat(en); // a bystander caught in the mail joins the fight
      // Roll per target. A dodged envelope flies but doesn't land; the wedge's
      // `leaves` surface still carpets below (HIT_PLAN #4). A surprised target
      // is easier to catch.
      if (!d.rollAgainst(d.active, en)) {
        d.hitFx(en, 'whiff');
        d.fx.damageText(en.x, en.z, 'MISS', MISS_COLOR);
        continue;
      }
      // A CONTROL cone (All Hands) lands its status on everyone it catches and
      // rolls no damage - the verb's rule holds whether it is aimed at one
      // coworker or a wedge of them. Sharing fireCone rather than forking it is
      // what keeps the wedge geometry, the LOS test and the per-target roll
      // identical between the two.
      if (isControl(a)) {
        const blocked = blockedBy(en, a.applies);
        if (a.applies && applyStatus(en, a.applies, {}, en.combat.statusResist)) {
          d.statusFxAt(en, a.applies);
          hits += 1;
        } else if (blocked) {
          d.log(d.immunityLine(blocked, en.def.name));
        }
        continue;
      }
      const rolled = d.rand(a.min, a.max);
      const bonus = damageBonus(d.active.sheet);
      const beforeAmbush = rolled + bonus;
      const afterAmbush = d.ambushDmg(beforeAmbush);
      const dmg = soakHit(afterAmbush, en.combat.deflect);
      d.reportDamage?.({
        attacker: d.active.sheet.name,
        target: en.def.name,
        action: a.label,
        roll: rolled,
        min: a.min,
        max: a.max,
        additions: [{ label: 'damage bonus', value: bonus }],
        stages: [
          { label: 'ambush', before: beforeAmbush, after: afterAmbush },
          { label: `Composure soak ${en.combat.deflect || 0}`, before: afterAmbush, after: dmg },
        ],
        result: dmg,
      });
      const died = en.takeDamage(dmg);
      d.hitFx(en, 'paper', d.active);
      if (died) d.deathFx(en);
      d.fx.damageText(en.x, en.z, `-${dmg}`, '#ffd76b', { big: died });
      hits += 1;
      if (died) d.callbacks.onEnemyKilled(en);
    }
    if (a.leaves) {
      const R = Math.ceil(a.cone.range);
      for (let z = Math.floor(test.origin.z) - R; z <= Math.ceil(test.origin.z) + R; z++) {
        for (let x = Math.floor(test.origin.x) - R; x <= Math.ceil(test.origin.x) + R; x++) {
          if (!test(x, z)) continue;
          // No carpeting a tile anybody on the player side is standing on.
          if (playerSideAt(d.members, x, z)) continue;
          if (!d.losToTile(d.active, x, z)) continue;
          d.world.leaveSurface(x, z, a.leaves, a.leavesTurns || 0);
        }
      }
    }
    d.log(isControl(a)
      ? (hits
        ? `${a.log} ${hits} caught.`
        : `${a.log} Nobody in the room is having it.`)
      : (hits
        ? `${a.log} ${hits} hit${hits > 1 ? 's' : ''}. The paperwork settles everywhere.`
        : `${a.log} No casualties. Plenty of litter.`));
    d.disarm();
    d.refresh();
    if (!d.hostilesRemain()) d.victory();
  }

  // Clicking a coworker with nothing armed is an attack - the basic swing from
  // whatever is in your hand (stats.equippedAction; bare hands fall back to
  // 'punch'). The old behavior was a nag ("choose an action first"), which made
  // the most obvious verb in the game the one thing a click could NOT do. Arming
  // a power still overrides it; that's what arming is for.

  return {
    performDash,
    performSwap,
    zoneCells,
    performZone,
    performControl,
    strike,
    friendlies,
    allyAtPoint,
    allyProblemFor,
    buffReach,
    performBuff,
    handleAllyClick,
    fireCone,
  };
}
