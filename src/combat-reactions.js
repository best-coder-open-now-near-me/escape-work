// WHAT A MOVE PROVOKES.
//
// A slice off `startCombat` (Q037/Q042): opportunity attacks (TACTICS_PLAN M2)
// and the overwatch stance that shares their budget (POWERS_PLAN M5).
//
// Leaving a threatened tile hands the threatener a free swing, so walking out
// of melee stops being free and kiting stops being strictly dominant. Three
// rules keep it from becoming a blender:
//   - one reaction per unit per ROUND (refilled by the engine's roundStart,
//     which is why `clearReactions` is exported rather than the map)
//   - unaware units don't react (surprised/stunned haven't registered it)
//   - FORCED movement never provokes. A shove sets the logical tile through
//     pushTo and glides the body, which skips the per-tile hook entirely
//     (actors.js update), and only deliberate moves seed `moveStart` - so
//     shove is the safe way to break contact (TACTICS_PLAN #9).
//
// It is a seam because it OWNS its state: `reactions` and `moveStart` are two
// of the closure's shared maps and nothing outside this file writes either one.
// That is the test Q037 says to cut by, and it is the reason this moved without
// a design argument to have.
//
// What deliberately did NOT come along, and why the same measurement said so:
// `bodyOf`, `standing` and `faceTarget` read as if they belong here - they are
// declared beside the maps - but they are used 14, 42 and 20 times across the
// rest of the closure. They are generic one-liners that happen to live next to
// this rule, not part of it, so they arrive as dependencies instead.
//
// The read side was measured before the cut too, which is the other half of
// Q037's lesson (`combat-strikes.js` was reverted because a cluster that WROTE
// no shared state still READ the live turn from four directions). This one
// reads `phase` once, as a getter, and never touches `active` or `armed`.
export function createReactions(d) {
  const reactions = new Map(); // combatant -> reactions spent this round
  // combatant -> where its current move began: { x, z } logical tile plus
  // { px, pz } continuous position (what threat radii are measured against)
  const moveStart = new Map();

  const canReact = (u) => d.standing(u)
    && (d.TACTICS.REACTIONS_PER_ROUND - (reactions.get(u) || 0)) > 0
    && !d.hasStatus(d.statusesOf(u), 'surprised')
    && !d.hasStatus(d.statusesOf(u), 'stunned');

  // main.js owns the per-tile hooks for members and summons, and its records
  // are NOT the objects combat wraps them in - so resolve through the shared
  // actor, which both sides hold a reference to.
  const combatantFor = (ref) => {
    if (!ref) return null;
    const body = d.bodyOf(ref);
    return d.members.find((m) => m.actor === body) || d.engaged.find((e) => e === body) || null;
  };

  // Mark the tile a deliberate move begins on. Only moves that come through
  // here can provoke - which is exactly how forced movement stays exempt.
  // Carries the tile (for facing and per-leg bookkeeping) AND the continuous
  // position, which is what threat is measured from now that reach is a radius.
  const beginMove = (u) => {
    if (!u) return;
    const b = d.bodyOf(u);
    const p = d.posOf(u);
    moveStart.set(u, { x: b.x, z: b.z, px: p.x, pz: p.z });
  };

  // Everyone on the far side of `mover` able to punish it right now. Each
  // carries its OWN reach: threat is whatever ground that unit could swing at,
  // so a long weapon zones further than a pair of fists.
  // Who threatens this mover - the OTHER side, live. `engaged` is not that
  // list: a charmed coworker stays in it on purpose (charming the last hostile
  // must not win the fight) while fighting for the player, so reading it raw
  // handed your own borrowed Guard a free swing at the member walking past him
  // (REVIEW.md 2026-08-02 section 1.4). Commit b224733 made this substitution
  // at the two sites inside `aiAdvance`/`aiSupportPlan` and missed this one.
  // Side is live state, never registry (AI_PLAN footgun 5).
  const threatsAgainst = (mover) => (mover.sheet ? d.aiAllies() : d.members)
    .filter((u) => canReact(u))
    .map((u) => {
      const p = d.posOf(u);
      return { x: p.x, z: p.z, reach: d.reachOfUnit(u), ref: u };
    });

  // The reaction swing: the attacker's own basic attack, at no AP cost, rolled
  // through the same assembler as every other attack. It deliberately carries
  // no weapon on-hit proc - a reflex, not a committed swing.
  // `reason` picks the wording only: 'flee' (the default) is the classic
  // opportunity attack on somebody breaking away, 'overwatch' is a stance
  // firing on somebody entering covered ground. The RULES are identical - one
  // basic swing, one reaction spent - so they share the resolution rather than
  // growing a second copy of the roll, the damage and the death handling.
  function opportunityStrike(attacker, defender, reason = 'flee') {
    const caught = reason === 'overwatch' ? 'crossing your line' : 'breaking away';
    if (attacker.sheet) {
      // A party-side body catches a fleeing enemy.
      const a = d.ACTIONS[d.equippedAction(attacker.sheet)];
      if (!a) return; // no basic swing to make (shouldn't happen - punch is the floor)
      attacker.actor.lunge(d.posOf(defender).x, d.posOf(defender).z);
      d.faceTarget(attacker, defender.x, defender.z);
      if (!d.rollAgainst(attacker, defender)) {
        d.hitFx(defender, 'whiff');
        d.fx.damageText(defender.x, defender.z, 'MISS', d.MISS_COLOR);
        d.log(`${attacker.sheet.name} swings at ${defender.def.name} ${caught} - and misses.`);
        d.refresh();
        return;
      }
      const dmg = d.rand(a.min, a.max) + d.damageBonus(attacker.sheet);
      const died = defender.takeDamage(dmg);
      d.hitFx(defender, 'melee', attacker);
      if (died) d.deathFx(defender);
      d.fx.damageText(defender.x, defender.z, `-${dmg}`, '#ffd76b', { big: died });
      d.log(`${attacker.sheet.name} catches ${defender.def.name} ${caught}. ${dmg} damage!`);
      if (died) d.callbacks.onEnemyKilled(defender);
      d.refresh();
      return;
    }
    // An enemy catches a fleeing member (or summon) - same rules as its turn
    // attack, just reworded so the log reads as a punish, not a swing in turn.
    // A unit with no attack set has nothing to punish with: `unitCombat`
    // normalizes that to an empty list rather than undefined, so this is a
    // check instead of a crash (a CLASS backing an AI unit need not declare
    // `attacks` at all - see stats.js).
    if (!attacker.combat.attacks.length) return;
    // The same contact-range pool aiAttack draws from (Q048). A reaction IS a
    // swing at somebody who just walked past you, so it cannot come out of the
    // rifle line; this used to draw uniformly over every line the def owns,
    // which let the Executive's ranged entry resolve at arm's length.
    // The draw stays UNWEIGHTED, deliberately: `pickLine`'s status weighting
    // is a chosen swing, and the comment above already calls this a reflex
    // rather than a committed one - routing it through pickLine is a separate
    // question, not a tidy-up.
    const pool = d.swingPool(attacker);
    const base = pool[d.rand(0, pool.length - 1)];
    attacker.lunge(d.posOf(defender).x, d.posOf(defender).z);
    d.unitStrikesMember(attacker, defender, {
      ...base,
      log: `${attacker.def.name} catches ${defender.sheet.name} pulling away.`,
      missLog: `${attacker.def.name} grabs at ${defender.sheet.name} and comes up empty.`,
    });
  }

  // `ref` entered (x, z) under its own power. Anyone whose reach it just left
  // gets one free swing. The walk is NOT interrupted - its AP was charged up
  // front (TACTICS_PLAN #8) - so the mover takes the hit and keeps going,
  // unless it goes down.
  function notifyStep(ref, x, z) {
    if (d.phase === 'done') return;
    const mover = combatantFor(ref);
    if (!mover) return;
    // Frequent Flier (MOVEMENT_PLAN M3): this character never provokes, from
    // anyone, ever. Deliberately the ONLY exception to the rule that leaving
    // a threatened tile costs you - which is what makes it worth a class
    // point. Read the same way every other talent effect is, so an enemy
    // archetype can carry it too.
    const flier = mover.sheet
      ? mover.sheet.talent?.effects?.noProvoke
      : mover.def?.talent?.effects?.noProvoke;
    // A step off the crouch tile ends the crouch, whoever took it - the same
    // lazy validity every consult runs, invoked here so the chip drops the
    // moment the AI (or a walking member) leaves cover rather than at the
    // next shot that asks (TACTICS_PLAN M6).
    if (d.crouched.has(mover)) d.crouchStateOf(mover);
    const from = moveStart.get(mover);
    if (!from) return; // not a tracked deliberate move (a shove glide, a spawn)
    if (from.x === x && from.z === z) return;
    d.setFacing(mover, x - from.x, z - from.z); // you face where you're going
    // Threat is a radius now, so the leg is measured between the BODY's real
    // positions rather than the tiles they round to. The hook still fires on
    // tile changes, so a reaction can land up to a tile after the radius was
    // actually crossed - bounded, and cheap compared with sampling every frame.
    const to = d.posOf(mover);
    moveStart.set(mover, { x, z, px: to.x, pz: to.z }); // the next leg starts here
    if (!d.standing(mover)) return;
    if (flier) {
      // Say so once per escape, or "nothing happened" reads as a missing rule.
      if (d.provokedBy(threatsAgainst(mover), from.px, from.pz, to.x, to.z, d.world.stepOpen).length) {
        d.log(`${mover.sheet ? mover.sheet.name : mover.def.name} walks off untouched. Frequent flier.`);
      }
      return;
    }
    // OVERWATCH fires first (POWERS_PLAN M5), and it is a different question
    // from the one below: an opportunity attack punishes LEAVING somebody's
    // reach, overwatch punishes ENTERING the ground a watcher is covering. A
    // mover crossing a watched doorway has not left anyone's reach, so the
    // provokedBy sweep would never see them.
    //
    // It shares the ROUND budget rather than getting its own, which is what
    // keeps the two from stacking into two free swings per mover per round -
    // and it is why holding a stance is a real cost, not a free extra.
    for (const [watcher, actionId] of d.watching) {
      if (watcher === mover) continue;
      // Only a `watch` stance swings. A `guard` shares the same held-posture
      // bookkeeping (one map, one lapse rule) but pays out as cover, not as a
      // reaction - so it must not quietly become a second overwatch.
      if (d.ACTIONS[actionId]?.mode !== 'watch') continue;
      const w = d.posOf(watcher);
      const sameSide = !!watcher.sheet === !!mover.sheet;
      // The watch circle is a true radius from the watcher's BODY to the
      // mover's - the same continuous metric the opportunity sweep two lines
      // down reads, so the two reaction systems can no longer disagree about
      // one movement (DEGRID M5; watch radius is a targeted range, D4).
      if (!d.watchTriggers(d.ACTIONS[actionId], {
        dist: d.dist(w.x, w.z, to.x, to.z),
        los: d.world.hasLos(w.x, w.z, to.x, to.z),
        hasReaction: canReact(watcher),
        sameSide,
        moverStanding: d.standing(mover),
      })) continue;
      reactions.set(watcher, (reactions.get(watcher) || 0) + 1);
      // The stance is SPENT once it fires. Overwatch that re-armed itself for
      // free every time the reaction refilled would cover the whole fight off
      // one turn's AP.
      d.watching.delete(watcher);
      d.removeStatus(d.statusesOf(watcher), 'watching');
      opportunityStrike(watcher, mover, 'overwatch');
      if (!d.standing(mover)) return; // dropped in the doorway - nothing left to punish
    }
    for (const t of d.provokedBy(threatsAgainst(mover), from.px, from.pz, to.x, to.z, d.world.stepOpen)) {
      if (!canReact(t.ref)) continue; // an earlier swing this step spent it
      reactions.set(t.ref, (reactions.get(t.ref) || 0) + 1);
      // Only when the AI walked into it - see the tally's own note. aiAllies()
      // is the side test Q011 made the single owner of "who is on THEIR side",
      // so a charmed coworker you are driving counts as yours here too.
      if (d.aiAllies().includes(mover)) d.bout.oaCount += 1;
      opportunityStrike(t.ref, mover);
      if (!d.standing(mover)) break; // dropped mid-flight - no further swings
    }
  }

  // A `moveStart` record means "this unit is mid-deliberate-move, and it
  // began there". It has to stop meaning that when the move stops. Nothing
  // ever retired one, and `notifyStep` re-seeds it on every leg, so the
  // record outlived the walk that made it - which broke the exemption
  // performDash and performSwap rely on. Both opt out of provoking by NOT
  // seeding a record (see performDash), so a stale one left over from any
  // earlier walk meant the next dash provoked after all: the one verb sold
  // as the answer to a threat ring quietly stopped being it.
  // Safe to read `moving` here: setPath assigns `path` synchronously, so a
  // walk seeded by beginMove is already moving before this frame runs.
  function retireStaleMoveStarts() {
    for (const u of [...moveStart.keys()]) {
      const body = d.bodyOf(u);
      if (!body || !body.moving) moveStart.delete(u);
    }
  }

  return {
    canReact,
    combatantFor,
    beginMove,
    threatsAgainst,
    notifyStep,
    opportunityStrike,
    retireStaleMoveStarts,
    // The round refill. The engine's `roundStart` owns WHEN everyone gets their
    // reaction back; this file owns what that means, so the map itself stays in
    // here and the engine asks.
    clearReactions: () => reactions.clear(),
  };
}
