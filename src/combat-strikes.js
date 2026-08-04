// STRIKES and DISPLACEMENTS: one body hitting another, and one body being put
// somewhere it did not walk to.
//
// The fifth slice off `startCombat` (Q037/Q042), and the largest that writes
// none of the closure's shared turn state - which is exactly why it could
// move. `unitStrikesMember` is the AI's swing landing on a person;
// `opportunityStrike` is the free swing a walk-away earns; `displaceBody` and
// `dropOnto` are a shove's glide and a toppled prop's landing. They share the
// same handful of questions - who is standing there, what does the floor do,
// how does a save roll - which is what makes them one module rather than four
// functions that happen to be adjacent.
//
// Everything arrives on `d`, wrapped rather than passed by reference: half of
// these are `const` arrows declared further down `startCombat` than the wiring
// is, and passing those directly reads them in their temporal dead zone - the
// build stays green and the first swing throws.
export function createStrikes(d) {
  function landStun(victim, line) {
    const target = victim.sheet || victim;
    const name = victim.sheet ? victim.sheet.name : victim.def.name;
    const resist = victim.sheet ? d.statusResist(victim.sheet) : 0;
    const blocked = d.blockedBy(target, 'stunned');
    if (d.applyStatus(target, 'stunned', {}, resist)) {
      d.statusFxAt(victim, 'stunned');
      return line;
    }
    return blocked ? ` ${immunityLine(blocked, name)}` : '';
  }

  function displaceBody(target, dx, dz, { verb = 'shove', slamDmg = 2, by = active } = {}) {
    const v = d.victimView(target);
    const mine = by === active;                 // the player's own shove?
    const Who = mine ? 'You' : by.def.name;
    const says = (s) => (mine ? `You ${s}` : `${Who} ${s.replace(/^(\w+)/, (w) => `${w}s`)}`);
    const push = d.displacePlan(v.x, v.z, dx, dz, {
      isWalkable: d.world.isWalkable,
      stepOpen: d.world.stepOpen,
      occupied: (x, z) => !!d.unitStandingAt(x, z) && d.unitStandingAt(x, z) !== target,
    });
    if (!push) return { slammed: false, died: false, msg: '' };
    const { tx, tz } = push;
    const bill = (d, x, z, big) => {
      if (!mine) d.bout.dmgDealt += d;            // the AI tally counts its own damage
      fx.damageText(x, z, `-${d}`, v.dmgColor, { big });
    };
    if (push.blocked) {
      // The "something solid" they hit might be a bookcase (POWERS_PLAN M6).
      // Slamming somebody into a toppleable prop brings it down on them - the
      // shove already said "into something solid", and this is the rest of
      // that sentence. The topple's own damage and stun land on whoever is in
      // the LANDING tile, which the slammed body may or may not be.
      // The body knocking the prop over is the one being SLAMMED into it, not
      // the one doing the shoving - `topplePlan` reads the pusher's position to
      // decide which way the furniture goes.
      const plan = d.topplePlan(v.ref, tx, tz);
      if (plan) {
        const died0 = slamDmg > 0 ? v.hurt(slamDmg) : false;
        d.hitFx(v.ref, 'slam', by);
        if (slamDmg > 0) bill(slamDmg, v.x, v.z, died0);
        const msg = `${says(`${verb} ${v.name}`)} into the ${plan.def.label || 'furniture'}. `
          + `${slamDmg > 0 ? `-${slamDmg}. ` : ''}${d.topple(by, plan)}`;
        if (died0) v.onDeath();
        return { slammed: true, died: died0, msg };
      }
      const died = slamDmg > 0 ? v.hurt(slamDmg) : false;
      d.hitFx(v.ref, 'slam', by);
      fx.shake(0.06, 0.2); // a body meeting drywall
      if (slamDmg > 0) bill(slamDmg, v.x, v.z, died);
      let msg = `${says(`${verb} ${v.name}`)} into something solid.${slamDmg > 0 ? ` -${slamDmg}.` : ''}`;
      // A slam into a wall knocks the wind out of them - stunned (they lose
      // their next turn). The knockdown DOS2 shoves are for.
      //
      // The shove is the one UNRATIONED stun in the game (2 AP, no use limit),
      // so it is the chain the anti-chain window exists to break - and the site
      // where the victim most needs to be told why the second slam didn't daze.
      if (!died) {
        const blocked = d.blockedBy(v.statusTarget, 'stunned');
        if (d.applyStatus(v.statusTarget, 'stunned')) {
          d.statusFxAt(v.member ? v.body : v.ref, 'stunned');
          msg += ` They crumple - ${d.STATUSES.stunned.name}, they lose their next turn.`;
        } else if (blocked) msg += ` ${immunityLine(blocked, v.name)}`;
      }
      if (died) v.onDeath();
      return { slammed: true, died, msg };
    }
    // Land carried PAST the centre along the push - momentum, not a snap to
    // grid. Deterministic (no rng draw: the rest point feeds cover octants
    // and body-to-body sight, so it must replay under a seed), and clamped
    // so the body still rounds home to the tile the plan chose.
    const pd = Math.hypot(dx, dz) || 1;
    const [lpx, lpz] = d.world.clampPoint(tx + (dx / pd) * 0.22, tz + (dz / pd) * 0.22);
    v.body.pushTo(tx, tz, lpx, lpz);
    // The riders that come WITH a hazard tile, not just its number. The facade's
    // own memberSurfDamage comment states the rule this restores - "the same
    // tile means the same thing however you got there" - and Q1-A made the
    // DAMAGE honour it while leaving these behind: a body shoved into fire took
    // the 4 and never caught, and one shoved onto a drift was cut without being
    // left bleeding, while walking onto either tile did both.
    //
    // Same pure `surfaceEffect` off the same `floorAt` sheet the walk sites
    // read, so there is no second opinion about what a tile does. `applies`
    // lands whether or not the tile bites; `bleed` rides the damage, which is
    // the order main.js's applySurfaceOn uses.
    const dmg = v.hazardAt(tx, tz);
    const sfx = d.surfaceEffect(d.world.floorAt(tx, tz));
    if (sfx?.applies && sfx.applies !== 'gum' && d.applyStatus(v.statusTarget, sfx.applies)) {
      d.statusFxAt(v.statusTarget, sfx.applies);
    }
    if (dmg > 0) {
      if (sfx?.bleed) d.applyStatus(v.statusTarget, 'bleed', { duration: sfx.bleed });
      const live = d.world.isElectrified && d.world.isElectrified(tx, tz);
      const surf = d.world.surfaceIdAt(tx, tz);
      const died = v.hurt(dmg);
      fx.impact(tx, tz, d.hazardKind(tx, tz), { y: 0.4 });
      bill(dmg, tx, tz, died);
      if (died) v.onDeath();
      return {
        slammed: false,
        died,
        msg: `${says(`${verb} ${v.name}`)} into the ${live ? 'LIVE water' : surf || 'hazard'}! -${dmg}.`,
      };
    }
    return { slammed: false, died: false, msg: `${says(`${verb} ${v.name}`)} back a step.` };
  }

  function dropOnto(by, lx, lz, range) {
    const victimUnit = d.world.liveEnemies().find((e) => e.x === lx && e.z === lz);
    const victimMember = d.members.find((m) => m.sheet.hp > 0 && m.actor
      && m.actor.x === lx && m.actor.z === lz);
    const dmg = d.rand(range[0], range[1]);
    const saved = (grit) => (forceHit !== null ? !forceHit : d.rollHit(d.gritSaveChance(grit), rng));
    let msg = '';
    if (victimUnit) {
      if (saved(victimUnit.combat.grit)) { // via unitCombat - the def carries it as attr.grit
        victimUnit.flinch?.();
        return ` ${victimUnit.def.name} dives clear.`;
      }
      const died = victimUnit.takeDamage(dmg);
      d.hitFx(victimUnit, 'slam', by);
      if (died) d.deathFx(victimUnit);
      fx.damageText(lx, lz, `-${dmg}`, '#ffd76b', { big: died });
      msg += ` It lands on ${victimUnit.def.name}. -${dmg}.`;
      if (!died) {
        // `stunned`, not a new knocked-down: toppling inherits the anti-chain
        // immunity window rather than becoming a second way to lock somebody
        // out of a fight. Slam a guard into drywall and then drop a cabinet on
        // them and they get the same "they have had their daze" refusal, from
        // the same code. The pin is the failed save's own price and carries
        // no window - see `pinned` in data/statuses.js.
        msg += landStun(victimUnit, ' They go down under it.');
        if (d.applyStatus(victimUnit, 'pinned')) d.statusFxAt(victimUnit, 'pinned');
      } else {
        callbacks.onEnemyKilled(victimUnit);
      }
    } else if (victimMember) {
      if (saved(d.effectiveAttr(victimMember.sheet).grit)) {
        victimMember.actor.flinch();
        return ` ${victimMember.sheet.name} dives clear.`;
      }
      const dead = d.applyDamage(victimMember.sheet, dmg);
      d.hitFx(victimMember, 'slam', by);
      victimMember.actor.flinch();
      fx.damageText(lx, lz, `-${dmg}`, undefined, { big: dead });
      msg += ` It lands on ${victimMember.sheet.name}. -${dmg}.`;
      if (!dead) {
        msg += landStun(victimMember, ' They go down under it.');
        if (d.applyStatus(victimMember.sheet, 'pinned')) d.statusFxAt(victimMember, 'pinned');
      } else {
        d.notifyMemberDown();
      }
    }
    return msg;
  }

  function unitStrikesMember(unit, m, atk) {
    let dmg = d.rand(atk.min, atk.max);
    // The attack roll. A miss skips damage, the deflect interaction, the
    // flinch, and any applied status; the enemy's AP was already committed
    // by the caller.
    // Same assembler as the player's swings, with the roles reversed - the
    // unit attacks, the member defends (attackMods reads either shape).
    if (!d.rollAgainst(unit, m)) {
      d.hitFx(m, 'whiff');
      fx.damageText(m.actor.x, m.actor.z, 'MISS', MISS_COLOR);
      d.log(atk.missLog || `${unit.def.name}'s attack goes wide.`);
      d.refresh();
      return;
    }
    let line = atk.log;
    // Composure soaks a flat slice off the hit (one point always lands),
    // before the Deflect Blame stance (incomingMult) halves whatever is left.
    const soak = d.deflect(m.sheet);
    if (soak > 0) dmg = Math.max(1, dmg - soak);
    const inMult = d.statusFx(m.sheet).incomingMult ?? 1;
    if (inMult < 1) {
      dmg = Math.max(1, Math.ceil(dmg * inMult));
      line += ` You d.deflect - only ${dmg} damage.`;
    } else {
      line += ` ${dmg} damage.`;
    }
    m.actor.flinch();
    d.bout.dmgDealt += dmg;
    const dead = d.applyDamage(m.sheet, dmg);
    d.hitFx(m, 'melee', unit);
    // Taking one is worth a flinch from the camera too - small, and only when
    // it's a body you control, so the office stays still while you swing.
    fx.shake(dead ? 0.09 : 0.05, 0.2);
    fx.damageText(m.actor.x, m.actor.z, `-${dmg}`, undefined, { big: dead });
    // Any status the attack carries lands here (gum, and now stun etc.),
    // Composure shrugging off some of a resistable one. Not onto a corpse. This
    // is the side of the anti-chain window that matters most: the Security Guard
    // and the Regional Executive both stun on an ordinary attack, with nothing
    // rationing it, so without a window a party member could lose every turn of
    // a fight in a row.
    if (atk.applies && !dead) {
      const blocked = d.blockedBy(m.sheet, atk.applies);
      if (d.applyStatus(m.sheet, atk.applies, {}, d.statusResist(m.sheet))) {
        d.statusFxAt(m, atk.applies);
        line += ` ${appliesLine(atk, m.sheet.name)}`;
        // Composure blunted it (statuses.js severity). Say so, once, where the
        // player is already reading: a stat whose work is invisible is a stat
        // nobody spends a point on, and "it landed weaker" is not something a
        // number on the character sheet can show you mid-fight.
        if (d.statusSeverity(m.sheet, atk.applies) < 1) line += ' They shrug off the worst of it.';
      } else if (blocked) line += ` ${immunityLine(blocked, m.sheet.name)}`;
    }
    d.log(line);
    d.refresh();
    if (dead) {
      m.toppled = true;
      d.deathFx(m);
      m.actor.clearPath();
      m.actor.fx = { kind: 'death', t: 0 };
      if (!d.livingParty().length) { d.defeat(); return; } // party wipe - the only true loss
      d.log(m.isSummon
        ? `${m.sheet.name} is dismissed - back to the employee pool.`
        : `${m.sheet.name} is out cold. They'll sit the rest of this one out.`);
      // Keep `active` (the sheet the HUD reflects, and the post-combat leader)
      // on a real member still standing - never a summon, which despawns.
      // This can fire mid-PLAYER-turn (an opportunity attack cut the acting
      // member down as they walked), so hand off properly: makeActive rebuilds
      // the survivor's action bar and clears the dead member's armed/pending
      // state. If it WAS their turn, end it too - otherwise the survivor
      // inherits the corpse's initiative slot and its leftover AP, then gets a
      // second full turn when their own slot comes up. During an AI turn the
      // acting enemy is mid-swing, so only the binding moves.
      if (m === active) {
        d.makeActive(d.livingParty()[0]);
        if (phase === 'player') d.advanceTurn();
        else d.refresh();
      }
    }
  }

  function opportunityStrike(attacker, defender, reason = 'flee') {
    const caught = reason === 'overwatch' ? 'crossing your line' : 'breaking away';
    if (attacker.sheet) {
      // A party-side body catches a fleeing enemy.
      const a = ACTIONS[d.equippedAction(attacker.sheet)];
      if (!a) return; // no basic swing to make (shouldn't happen - punch is the floor)
      attacker.actor.lunge(d.posOf(defender).x, d.posOf(defender).z);
      d.faceTarget(attacker, defender.x, defender.z);
      if (!d.rollAgainst(attacker, defender)) {
        d.hitFx(defender, 'whiff');
        fx.damageText(defender.x, defender.z, 'MISS', MISS_COLOR);
        d.log(`${attacker.sheet.name} swings at ${defender.def.name} ${caught} - and misses.`);
        d.refresh();
        return;
      }
      const dmg = d.rand(a.min, a.max) + d.damageBonus(attacker.sheet);
      const died = defender.takeDamage(dmg);
      d.hitFx(defender, 'melee', attacker);
      if (died) d.deathFx(defender);
      fx.damageText(defender.x, defender.z, `-${dmg}`, '#ffd76b', { big: died });
      d.log(`${attacker.sheet.name} catches ${defender.def.name} ${caught}. ${dmg} damage!`);
      if (died) callbacks.onEnemyKilled(defender);
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
    unitStrikesMember(attacker, defender, {
      ...base,
      log: `${attacker.def.name} catches ${defender.sheet.name} pulling away.`,
      missLog: `${attacker.def.name} grabs at ${defender.sheet.name} and comes up empty.`,
    });
  }

  return { landStun, displaceBody, dropOnto, unitStrikesMember, opportunityStrike };
}
