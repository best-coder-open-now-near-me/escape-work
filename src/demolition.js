// PUTTING THE OFFICE OVER: toppling, dropping and breaking.
//
// A slice off `startCombat` (Q037). Furniture as a weapon - a cabinet shoved
// onto somebody, a partition brought down flat, a prop battered apart - plus the
// stun a landing inflicts.
//
// The rule that ties them together is the GRIT SAVE, and it is honoured
// identically in three places here because a body under falling furniture is
// one situation however the furniture got there. `forceHit` pins the save too
// (true = the drop fully lands), which is what lets the specs talk about it at
// all - and that pin now lives in hit-resolution.js, reached through `hits`.
//
// Toppling and breaking are the two ways the office STOPS being cover, so they
// belong next to each other: the crouch that was real last consult is not real
// after either, and the lazy re-validation in cover-crouch.js is what makes
// that true without anyone here remembering to announce it.
import { posOf } from './combat-geometry.js';
import { breakPlan } from './combat-plans.js';
import { ACTIONS } from './data/actions.js';
import { PARTITION_TOPPLE } from './data/tiles.js';
import { applyDamage, damageBonus, effectiveAttr, gritSaveChance, rangeOf, rollHit, roundAp, statusResist } from './stats.js';
import { applyStatus, blockedBy } from './statuses.js';

export function createDemolition(d) {
  // Put it over. `by` is whoever caused it (for the narration and the facing).
  function topple(by, plan) {
    const { def, x, z, lx, lz } = plan;
    const t = def.topple;
    // The prop leaves its tile and lands on the next one. setType is the same
    // call an exploding printer already makes, so the grid, the renderer and
    // pathfinding all re-read it exactly as they do for destruction.
    d.world.setType(x, z, 'floor');
    d.world.setType(lx, lz, t.becomes);
    d.fx.impact(lx, lz, 'slam', { y: 0.5 });
    d.fx.shake(0.11, 0.28); // a bookcase hitting the carpet is worth more than a punch
    let msg = `${def.label || 'It'} goes over.`;
    // Whoever is standing in the landing tile wears it - coworker, teammate or
    // you. A bookcase does not check your badge.
    msg += dropOnto(by, lx, lz, t.damage);
    return msg;
  }

  // Whatever just came down lands on (lx, lz): whoever stands there rolls the
  // Grit save (TACTICS_PLAN M6, designer: "a strength or whatever equivalent
  // check ... crushing damage and maybe pinned too"). Pass and they throw
  // themselves clear - no crush, no daze, no pin. Fail and they wear all of
  // it: the damage, the existing stun (anti-chain window intact), and PINNED
  // - rooted under the thing until they work free. Shared by the furniture
  // topple and the partition topple, so one save rule covers everything that
  // falls. `forceHit` pins the save too (true = the drop fully lands = the
  // save fails), so the specs stay deterministic. Returns the narration
  // fragment, leading space included, or '' for empty carpet.
  // Land a stun on anybody, and SAY what happened. One helper because the rule
  // was written twice inside `dropOnto` and the two halves had already drifted:
  // the coworker branch gated the burst on `applyStatus` and narrated the
  // refusal through `immunityLine`, the member branch did neither. So a member
  // stunned inside their own `training-credit` window got the burst played at
  // them and no explanation, while a coworker in the same window got the honest
  // line (REVIEW.md 2026-08-02 section 1.9). `aiPullMember` copied the member
  // half verbatim, so the newest beat inherited the defect.
  //
  // Members carry a resist; coworkers do not. That is the only real difference,
  // and it is the reason the two were written apart in the first place.
  function landStun(victim, line) {
    const target = victim.sheet || victim;
    const name = victim.sheet ? victim.sheet.name : victim.def.name;
    const resist = victim.sheet ? statusResist(victim.sheet) : 0;
    const blocked = blockedBy(target, 'stunned');
    if (applyStatus(target, 'stunned', {}, resist)) {
      d.statusFxAt(victim, 'stunned');
      return line;
    }
    return blocked ? ` ${d.immunityLine(blocked, name)}` : '';
  }

  function dropOnto(by, lx, lz, range) {
    const victimUnit = d.world.liveEnemies().find((e) => e.x === lx && e.z === lz);
    const victimMember = d.members.find((m) => m.sheet.hp > 0 && m.actor
      && m.actor.x === lx && m.actor.z === lz);
    const dmg = d.rand(range[0], range[1]);
    const saved = (grit) => (d.hits.forceHit !== null ? !d.hits.forceHit : rollHit(gritSaveChance(grit), d.rng));
    let msg = '';
    if (victimUnit) {
      if (saved(victimUnit.combat.grit)) { // via unitCombat - the def carries it as attr.grit
        victimUnit.flinch?.();
        return ` ${victimUnit.def.name} dives clear.`;
      }
      const died = victimUnit.takeDamage(dmg);
      d.hitFx(victimUnit, 'slam', by);
      if (died) d.deathFx(victimUnit);
      d.fx.damageText(lx, lz, `-${dmg}`, '#ffd76b', { big: died });
      msg += ` It lands on ${victimUnit.def.name}. -${dmg}.`;
      if (!died) {
        // `stunned`, not a new knocked-down: toppling inherits the anti-chain
        // immunity window rather than becoming a second way to lock somebody
        // out of a fight. Slam a guard into drywall and then drop a cabinet on
        // them and they get the same "they have had their daze" refusal, from
        // the same code. The pin is the failed save's own price and carries
        // no window - see `pinned` in data/statuses.js.
        msg += landStun(victimUnit, ' They go down under it.');
        if (applyStatus(victimUnit, 'pinned')) d.statusFxAt(victimUnit, 'pinned');
      } else {
        d.callbacks.onEnemyKilled(victimUnit);
      }
    } else if (victimMember) {
      if (saved(effectiveAttr(victimMember.sheet).grit)) {
        victimMember.actor.flinch();
        return ` ${victimMember.sheet.name} dives clear.`;
      }
      const dead = applyDamage(victimMember.sheet, dmg);
      d.hitFx(victimMember, 'slam', by);
      victimMember.actor.flinch();
      d.fx.damageText(lx, lz, `-${dmg}`, undefined, { big: dead });
      msg += ` It lands on ${victimMember.sheet.name}. -${dmg}.`;
      if (!dead) {
        msg += landStun(victimMember, ' They go down under it.');
        if (applyStatus(victimMember.sheet, 'pinned')) d.statusFxAt(victimMember, 'pinned');
      } else {
        d.notifyMemberDown();
      }
    }
    return msg;
  }

  // Put a shoulder into the cubicle wall itself (TACTICS_PLAN M6, designer
  // 2026-07-30): the shove verb aimed across an adjacent partition edge. The
  // panel comes off its feet and lands FLAT on the far tile - walkable, no
  // cover: a board, not a bookcase - and whoever stands there rolls the same
  // Grit save everything falling already demands. Doors never topple; they
  // are not in the wall sets (grid.wallEdgeBetween). Returns true when the
  // click was a partition shove (refusals included), false to fall through.
  function performPartitionTopple(tx, tz) {
    const a = ACTIONS.shove;
    const me = { x: d.active.actor.x, z: d.active.actor.z };
    if (Math.abs(tx - me.x) + Math.abs(tz - me.z) !== 1) return false; // square-on, arm's reach
    if (!d.world.wallEdgeBetween(me.x, me.z, tx, tz)) return false;
    if (!d.world.terrainOpen(tx, tz)) {
      d.log('The partition rocks against whatever is behind it, and stays up.');
      return true;
    }
    if (d.active.ap < a.ap) { d.log('Not enough AP.'); return true; }
    d.active.ap = roundAp(d.active.ap - a.ap);
    d.active.actor.lunge(tx, tz);
    d.faceTarget(d.active, tx, tz);
    d.world.toppleEdge(me.x, me.z, tx, tz);
    d.world.setType(tx, tz, PARTITION_TOPPLE.becomes);
    d.fx.impact(tx, tz, 'slam', { y: 0.3 });
    d.fx.shake(0.08, 0.2);
    d.log(`You put a shoulder into the partition. It goes over flat.${dropOnto(d.active, tx, tz, PARTITION_TOPPLE.damage)}`);
    d.disarm();
    d.refresh();
    if (!d.hostilesRemain()) d.victory();
    return true;
  }

  // --- breaking cover down (TACTICS_PLAN M8) --------------------------------
  // An attack aimed at the FURNITURE: melee and ranged both, per the designer
  // ("melee could gradually break down a barrier", clarified "melee and
  // ranged"). Only the cover-grade set carries an HP pool (data/tiles.js), and
  // at zero the object is REMOVED - not toppled, not substituted: "gone means
  // gone", because every other verb keeps the barrier in play. Objects do not
  // dodge `[proposed]`: the swing auto-hits, spends its full cost, and rolls
  // its normal damage - pricing is what keeps demolition from being free.

  // What the armed attack resolves on at (tx, tz): a breakable prop ON the
  // tile, or a partition edge - square-on for a swing (the topple's own aim),
  // or on the clicked tile's face TOWARD the shooter for a shot. Returns
  // { kind } to commit, { refusal } to explain, null to fall through. Melee
  // does not walk in for v1 `[proposed]` - the rings only promise reach.
  const breakPlanAt = (id, tx, tz) => breakPlan(id, d.active, tx, tz, d.world);

  // Put the hit in. One resolver for both shapes: spend, swing or shoot,
  // roll the dice into the pool, and either report the dent (the world
  // facade leans the mesh - the pool is hidden, the object wears it) or
  // watch the world facade delete the thing. The crouch behind it needs no
  // hook: refresh()'s revalidation finds the shield missing.
  // The break itself, with no opinion about who did it: where the blow lands,
  // what the thing is called, how much of it is left, and the hit you see.
  //
  // `performBreak` and `aiBreak` were two copies of this, identical down to the
  // label expression and the `big: left === 0` flag - and they had already
  // drifted in the way copies do: one of them went through the world facade for
  // the tile def and the other did not. What legitimately differs is only what
  // brackets it: the player's half bills AP, paper and a use, throws a
  // projectile when the verb has range, and checks victory; the AI's half picks
  // a random attack line and narrates in the third person. Neither of those is
  // the break.
  function breakDown(plan, dmg) {
    const prop = plan.kind === 'prop';
    const px = prop ? plan.tx : (plan.a[0] + plan.b[0]) / 2;
    const pz = prop ? plan.tz : (plan.a[1] + plan.b[1]) / 2;
    const label = prop
      ? (d.world.tileDefAt(plan.tx, plan.tz)?.label || 'furniture').toLowerCase()
      : 'partition';
    const left = prop
      ? d.world.damageProp(plan.tx, plan.tz, dmg)
      : d.world.damageEdge(plan.a[0], plan.a[1], plan.b[0], plan.b[1], dmg);
    d.fx.damageText(px, pz, `-${dmg}`, '#ffd76b', { big: left === 0 });
    d.fx.impact(px, pz, 'slam', { y: 0.4 });
    if (left === 0) d.fx.shake(0.09, 0.24);
    return { px, pz, label, left, gone: left === 0 };
  }

  function performBreak(id, plan) {
    const a = ACTIONS[id];
    if (d.active.ap < a.ap) { d.log('Not enough AP.'); return; }
    if (a.ammoCost && d.active.sheet.paper < d.ammoCostOf(id)) { d.log('Out of paper.'); return; }
    const prop = plan.kind === 'prop';
    const aimX = prop ? plan.tx : (plan.a[0] + plan.b[0]) / 2;
    const aimZ = prop ? plan.tz : (plan.a[1] + plan.b[1]) / 2;
    if (a.ammoCost) d.active.sheet.paper -= d.ammoCostOf(id);
    d.active.ap = roundAp(d.active.ap - a.ap);
    if (a.uses) d.active.usesLeft[id] -= 1;
    if (rangeOf(id)) {
      // The prop's break point is real geometry (a tile centre or an edge
      // midpoint); only the ORIGIN moves to the body.
      d.fx.projectile(posOf(d.active), { x: aimX, z: aimZ },
        a.ammoCost ? 'ball' : 'shot');
    } else {
      d.active.actor.lunge(aimX, aimZ);
    }
    d.faceTarget(d.active, aimX, aimZ);
    const dmg = d.rand(a.min, a.max) + damageBonus(d.active.sheet);
    const { label, left, gone } = breakDown(plan, dmg);
    if (gone) {
      d.log(prop
        ? `The ${label} comes apart. The office is short one piece of cover.`
        : 'The partition comes apart. Open plan, the hard way.');
    } else {
      d.log(`You lay into the ${label}. -${dmg}.${left <= dmg ? ' It is coming apart.' : ''}`);
    }
    d.disarm();
    d.refresh(); // any crouch behind it revalidates here
    if (!d.hostilesRemain()) d.victory();
  }

  // --- take cover (TACTICS_PLAN M6) -----------------------------------------

  // Whoever is standing on (x, z) - member, summon or coworker. The take-cover

  return {
    breakDown,
    topple,
    landStun,
    dropOnto,
    performPartitionTopple,
    breakPlanAt,
    performBreak,
  };
}
