// WHAT THE AI ACTUALLY DOES WITH A BEAT.
//
// A slice off `startCombat` (Q037): once `aiBeatPlans` has chosen, these are the
// verbs that spend it. Every one is reached only from an AI turn, never from the
// startCombat sweep - which matters in this file, where wiring something the
// sweep can reach too late throws before the first fight.
//
// Two rules here have each been a bug already, and both are about ONE OWNER:
//
//   - `swingPool` is the single answer to "what may a swing at contact range
//     draw from" (Q048, footgun 9). The reaction swing used to keep its own
//     copy that was just `attacks`, so an opportunity attack could fire the
//     Executive's RIFLE line. Melee in reach, falling back to the whole list
//     only for a def that owns no melee at all - and every contact swing needs
//     that rule, not just `aiAttack`.
//   - `pickLine` rolls the FIGHT's rng, not a fresh one, so a seeded bout
//     replays. The weights themselves are combat-ai's - pure and tested; what
//     lives here is only the draw.
import { PARTITION_TOPPLE } from './data/tiles.js';

export function createAiVerbs(d) {
  // The attack pools, split the day one entry grew `range` (AI_PLAN M5,
  // footgun 9): melee lines swing in reach, the ranged line fires at
  // distance. In reach the melee pool wins outright; a def with ONLY ranged
  // lines falls back to point-blank fire rather than standing there.
  const meleeLines = (unit) => unit.combat.attacks.filter((a) => !a.range);
  const rangedLines = (unit) => unit.combat.attacks.filter((a) => a.range);
  // What a swing AT CONTACT RANGE may draw from - one owner, because the
  // reaction swing had its own copy that was just `attacks` and so could fire
  // the Executive's rifle line as an opportunity attack (Q048). Footgun 9's
  // rule is "melee in reach, fall back to the whole list only for a def that
  // owns no melee at all", and every contact swing needs it, not just aiAttack.
  const swingPool = (unit) => {
    const melee = meleeLines(unit);
    return melee.length ? melee : unit.combat.attacks;
  };

  // A weighted draw over the pool (AI_PLAN M6): a line whose status the
  // target is not already wearing rolls at STATUS_WEIGHT, so the guard
  // blinds the shooter on purpose sometimes. The weights are combat-ai's
  // (pure, tested); the draw rolls the fight's own rng, so seeded bouts
  // replay.
  function pickLine(pool, target) {
    const w = d.lineWeights(pool, (id) => d.hasStatus(d.statusesOf(target), id));
    let total = 0;
    for (const x of w) total += x;
    let roll = d.rng() * total;
    for (let i = 0; i < pool.length; i++) {
      roll -= w[i];
      if (roll <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  function aiAttack(unit, target) {
    const atk = pickLine(swingPool(unit), target.member);
    unit.lunge(d.posOf(target).x, d.posOf(target).z);
    d.faceTarget(unit, target.actor.x, target.actor.z); // you face what you swing at
    if (target.member) d.unitStrikesMember(unit, target.member, atk);
  }

  // The triage beat's doing (AI_PLAN M6): clamp-add to the ally's pool and
  // say so. No lunge - she reaches, the fight goes on.
  function aiSupport(unit, plan, spec) {
    const ally = plan.ally.ref;
    const amt = d.rand(spec.heal[0], spec.heal[1]);
    ally.hp = Math.min(ally.maxHp, ally.hp + amt);
    d.faceTarget(unit, ally.x, ally.z);
    d.fx.damageText(ally.x, ally.z, `+${amt}`, '#9fdf8a');
    d.log(`${spec.log || `${unit.def.name} patches up a colleague.`} +${amt} to ${ally.def.name}.`);
    d.refresh();
  }

  // The shot (AI_PLAN M5): the plan already ran the gauntlet - range, LOS,
  // shotOutcome - so this is resolution only. A redirect strikes the human
  // shield with the same line ("a human shield takes the blocked hit",
  // TACTICS_PLAN M6 ratified); everything else lands through
  // unitStrikesMember, the one member-strike sink, so cover's to-hit term,
  // soak, statuses and the downed rules all apply unchanged.
  function aiShoot(unit, target, sp) {
    const victim = sp.so.redirected ? sp.so.target : target.member;
    d.faceTarget(unit, d.bodyOf(victim).x, d.bodyOf(victim).z);
    d.fx.projectile(d.posOf(unit), d.posOf(victim), 'shot');
    if (sp.so.redirected) d.log(`${victim.sheet.name} is in the way. The shot is theirs now.`);
    d.unitStrikesMember(unit, victim, sp.line);
  }

  // The reinforcement beat's doing. The beat DOES the summon: it used to only
  // narrate one, because the spawn was a side effect of the readiness check up
  // in the ladder, so posting the req was free whenever a higher beat won the
  // turn and billed only when this arm happened to be the one taken. A maxed-out
  // HR posts nothing and says so.
  function aiSummon(unit, target, spec) {
    unit.lunge(d.posOf(target).x, d.posOf(target).z);
    const posted = d.resolveSummon(unit, 'enemy', spec);
    d.log(posted > 0
      ? (spec.log || `${unit.def.name} calls in reinforcements.`)
      : `${unit.def.name} calls for backup. Nobody is free.`);
  }

  // The topple beat's doing - one beat, two aims (AI_PLAN M4). Furniture goes
  // over through the shared `topple`; a partition comes off its feet and lands
  // flat on the far tile, on whoever stands there, which is the player's own
  // performPartitionTopple seen from the other side of the cubicle.
  function aiTopple(unit, plan) {
    if (!plan.edge) {
      unit.lunge(plan.x, plan.z);
      d.log(`${unit.def.name} puts a shoulder into the ${plan.def.label || 'furniture'}. ${d.topple(unit, plan)}`);
      return;
    }
    unit.lunge(plan.tx, plan.tz);
    d.faceTarget(unit, plan.tx, plan.tz);
    d.world.toppleEdge(unit.x, unit.z, plan.tx, plan.tz);
    d.world.setType(plan.tx, plan.tz, PARTITION_TOPPLE.becomes);
    d.fx.impact(plan.tx, plan.tz, 'slam', { y: 0.3 });
    d.fx.shake(0.08, 0.2);
    d.log(`${unit.def.name} puts a shoulder into the partition. It goes over flat.${d.dropOnto(unit, plan.tx, plan.tz, PARTITION_TOPPLE.damage)}`);
    d.engageMemo.clear(); // a retired edge changes routes mid-turn
  }

  // The shove beat's doing. ONE resolver, both sides (Q4-A): the AI's shove
  // wears the slam stun and the prop topple it had silently been missing. The
  // lunge goes first, as it always did - the body has to wind up before it
  // lands, and displaceBody moves the victim out from under the aim.
  // `notifyMemberDown` is the victim view's own onDeath - not repeated here.
  function aiShove(unit, plan) {
    unit.lunge(plan.victim.actor.x, plan.victim.actor.z);
    d.faceTarget(unit, plan.victim.actor.x, plan.victim.actor.z);
    const res = d.displaceBody(plan.victim, plan.dx, plan.dz, { by: unit });
    if (res.msg) d.log(res.msg);
  }

  // The break beat's doing. Two kinds behind one beat: a shut door opens by
  // hand, anything else is battered down by aiBreak. Both change the world
  // under the reachability memo, which is keyed on tiles and cleared per TURN
  // because "within a turn the only thing moving is the unit itself" - an
  // opened door or a demolished barrier breaks that assumption, and without
  // the clear the unit stays "sealed" for the rest of its own turn and stands
  // in the doorway it just opened. Returns the wait its animation needs.
  function aiOpenOrBreak(unit, plan) {
    let wait = 0.85;
    if (plan.kind === 'door') {
      unit.lunge(plan.tx, plan.tz);
      d.faceTarget(unit, plan.tx, plan.tz);
      d.world.openDoor(plan.key);
      d.log(`${unit.def.name} opens the door. It was never locked.`);
      wait = 0.5;
    } else {
      d.aiBreak(unit, plan);
    }
    d.engageMemo.clear();
    return wait;
  }

  return {
    meleeLines,
    rangedLines,
    swingPool,
    pickLine,
    aiAttack,
    aiSupport,
    aiShoot,
    aiSummon,
    aiTopple,
    aiShove,
    aiOpenOrBreak,
  };
}
