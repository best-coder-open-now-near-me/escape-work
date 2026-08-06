// What the FLOOR does to a body: the per-step surface effects, the slip roll,
// and the out-of-combat turn clock that ticks what those effects applied.
//
// Another slice off `startGame`'s closure (Q039). This one removes no shared
// variable - it is here because the three belong together and because they are
// rules about a tile and a sheet, which is a thing worth being able to read on
// its own. `step-rules.js` and `surfaces-runtime.js` already own the pure
// arithmetic; this is the layer that spends it on real bodies.
//
// Everything arrives on `d`. The mutable bindings - `sheet`, `party`, `combat`,
// `inCombat`, `gameOver`, `oocCrouch` - are getters on main.js's side, because
// a floor effect resolves against whoever is standing on it right now.
export function createFloorEffects(d) {
  function advanceStatusTurn() {
    if (!d.party) return;
    // `covered` is the one turn-clocked chip whose duration is a LEAK BOUND
    // rather than a clock (data/statuses.js): combat revalidates the crouch on
    // every consult and re-applies the chip while it holds, so only an
    // abandoned fight lets it lapse. Out here the crouch is `oocCrouch`, and
    // it holds until a deliberate walk breaks it - so re-apply on the same
    // terms rather than letting the new clock time it out from under a
    // stationary character. Without this, a crouch taken before a fight
    // evaporated after four ticks of standing still.
    // ...and the same revalidation combat does: the crouch is only real while
    // its position still has a shielded face. A partition toppled out of a
    // fight, or a coworker who wandered off the face they were covering, ends
    // it here rather than lingering until a fight starts and combat notices.
    if (d.oocCrouch && d.sheet) {
      if (d.oocCoverProblem(d.oocCrouch.at.x, d.oocCrouch.at.z)) d.clearOocCrouch();
      else d.applyStatus(d.sheet, 'covered');
    }
    const downed = [];
    for (const m of d.party.members) {
      if (!m.actor || m.sheet.hp <= 0) continue;
      const r = tickTurnClockOn(m.sheet, m.actor, (dmg) => d.applyDamage(m.sheet, dmg));
      if (r.damage > 0 || r.expired.length) d.syncHudFor(m.sheet);
      if (r.down) downed.push(m);
    }
    for (const s of [...d.summons]) {
      if (!s.actor || s.sheet.hp <= 0) continue;
      // A temp takes the rules in silence, like everywhere else in this file.
      if (tickTurnClockOn(s.sheet, s.actor, (dmg) => d.applyDamage(s.sheet, dmg)).down) {
        d.dismissSummon(s.actor);
      }
    }
    const slain = [];
    for (const en of d.enemies) {
      if (!en.alive) continue;
      if (tickTurnClockOn(en, en, (dmg) => en.takeDamage(dmg)).down) slain.push(en);
    }
    for (const en of slain) {
      d.vfx.impact(en.x, en.z, 'blood', { y: 0.4 });
      d.awardKill(en);
    }
    for (const m of downed) {
      d.downOrLose(m, 'Burned down at your desk. The incident report writes itself.');
      if (d.gameOver) return; // that was the wipe
    }
  }

  function applySurfaceOn(ms, actor, x, z, say) {
    const sfx = d.surfEffect(x, z);
    if (!sfx) return false;
    if (sfx.ammo) {
      ms.paper = Math.min(d.PAPER_CAP, ms.paper + sfx.ammo);
      d.vfx.impact(x, z, 'shreds', { y: 0.3, scale: 0.8 });
      d.vfx.damageText(x, z, '+📄', '#8adf76');
    }
    // Gum on shoe: slowed, no kicking, but genuine traction (can't slip).
    if (sfx.applies === 'gum' && d.stickGum(x, z)) {
      const had = d.hasStatus(ms, 'gum');
      d.applyStatus(ms, 'gum');
      d.vfx.impact(x, z, 'gum', { y: 0.12 });
      d.vfx.status(x, z, 'gum');
      say(
        had ? 'More gum. You are building a collection.' : sfx.message,
        had ? 'More gum. {name} is building a collection.' : sfx.namedMessage,
      );
      d.syncHudFor(ms);
    }
    // A turn-clock status a surface applies (fire -> burning), in a fight or
    // out of one [stated] (designer, 2026-08-03, on the Q906 gaps: "yes all
    // fixes"). This used to be gated on `inCombat` because the status "needs
    // combat's turns to tick" - which stopped being true when advanceStatusTurn
    // landed an out-of-combat turn clock (designer, 2026-07-31: they should all
    // be using the same thing in and out of combat). The gate outlived its
    // reason by three days; walking through flame now sets you alight wherever
    // you are, and the same clock ticks it down.
    if (sfx.applies && sfx.applies !== 'gum' && d.applyStatus(ms, sfx.applies)) {
      d.vfx.status(x, z, sfx.applies);
      d.syncHudFor(ms);
    }
    const amount = d.effectiveSurfDamage(x, z, ms);
    if (amount > 0) {
      if (sfx.bleed) d.applyStatus(ms, 'bleed', { duration: sfx.bleed });
      const down = d.applyDamage(ms, amount);
      actor.flinch();
      d.vfx.impact(x, z, surfaceImpactKind(x, z), { y: 0.3 });
      d.vfx.damageText(x, z, `-${amount}`);
      say(sfx.message, sfx.namedMessage);
      d.syncHudFor(ms);
      return down;
    }
    if (sfx.amount) {
      const immune = ms.talent?.effects?.shockImmune && d.grid.isElectrified(x, z);
      say(
        immune
          ? 'The water crackles. Your ESD soles rate this a non-event. 0 damage.'
          : 'You glide across the drift; the edges respect a master. Not a scratch.',
        immune
          ? `The water crackles. {name}'s ESD soles rate this a non-event. 0 damage.`
          : '{name} glides across the drift; the edges respect a master. Not a scratch.',
      );
      d.syncHudFor(ms);
    } else if (sfx.message && !sfx.applies) {
      say(sfx.message, sfx.namedMessage);
    }
    return false;
  }

  // Step-clock statuses: bleed drips its dot, gum wears down. True if it
  // dropped them.
  function tickStepOn(ms, actor, x, z, say) {
    const { damage, expired } = d.tickStep(ms);
    let down = false;
    if (damage > 0) {
      down = d.applyDamage(ms, damage);
      // "You drip on the carpet" is literal - the carpet keeps it. On the
      // BODY's spot, not the tile centre, so the drip lands under the walker
      // rather than in the middle of the square they're crossing.
      const drip = actor.entity ? actor.entity.getPosition() : { x, z };
      d.vfx.splat(drip.x, drip.z, { scale: 0.5 });
      d.vfx.damageText(x, z, `-${damage}`);
      say('You drip on the carpet. -1 HP.', '{name} drips on the carpet. -1 HP.');
      d.syncHudFor(ms);
    }
    if (expired.includes('gum')) {
      say('The gum finally lets go of your sole. Freedom.',
        `The gum finally lets go of {name}'s sole. Freedom.`);
      d.syncHudFor(ms);
    }
    return down;
  }

  // Turn-clock statuses OUT of combat (designer, 2026-07-31: "that clock
  // should've been used from the beginning ... they should all be using the
  // same thing in and out of combat, its not something new going on here").
  //
  // Exactly right, and the clock was already here. `turn-order.js` ticks these
  // as each combatant's turn opens; out of a fight the world clock below
  // stands in, and it already spends everything a combat round spends - fire,
  // smoke, summon assignments, the litter a power dropped. Statuses were the
  // ONE thing it did not spend, and that omission is what made a turn-clocked
  // status mean two different things depending on whether dice were out: a
  // 3-turn buff applied on the map was permanent, and a coworker set alight
  // outside a fight never burned. Same `tickTurn`, same durations, both sides.
  //
  // `hurt(damage)` is how this carrier takes a dot - a sheet and a coworker
  // count HP differently - and returns whether it dropped them. Returns the
  // expired ids too, because a caller may need to react to what lapsed.
  function tickTurnClockOn(carrier, actor, hurt) {
    const { damage, expired } = d.tickTurn(carrier);
    if (damage <= 0) return { down: false, damage, expired };
    // The dot's look rides the body, not the tile centre, so a status burning
    // somebody mid-walk lands its number on them.
    const p = actor?.entity ? actor.entity.getPosition() : actor;
    d.vfx.impact(p.x, p.z, 'fire', { y: 0.4 });
    d.vfx.damageText(p.x, p.z, `-${damage}`, '#ff7a3c');
    return { down: hurt(damage), damage, expired };
  }

  // Is this walker leaving a trail? A live bleed is the obvious case; so is
  // being badly enough hurt that you're dripping without a status saying so.
  const isBleeding = (s) => d.hasStatus(s, 'bleed') || s.hp <= Math.max(1, s.maxHp * 0.3);

  // What a hurting floor looks like when it bites: the burst matches the
  // hazard the tile actually IS right now (fire beats electrified beats the
  // painted surface), so a paper cut throws shreds and live water throws
  // sparks without either side hard-coding the other's list.
  const surfaceImpactKind = (x, z) => d.impactKindFor({
    burning: d.runtime.isBurning(x, z),
    electrified: d.grid.isElectrified(x, z),
    surface: d.runtime.surfaceAt(x, z),
  }, d.SURFACES);

  // One tile entered, one print left (or not) - the bookkeeping of which foot
  // and how bloody the sole still is lives in fx.js, keyed by the actor.
  function leaveFootprint(actor, s, x, z) {
    if (!actor?.entity) return;
    const surf = d.runtime.surfaceAt(x, z);
    d.vfx.footstep(actor, x, z, {
      bleeding: isBleeding(s),
      surface: surf,
      onPaper: surf === 'paper',
    });
  }

  function maybeSlip(ms, actor, x, z, wasSlipProof, say, speaker = null) {
    if (d.gameOver) return;
    if (!d.slips({
      chance: d.slipChanceAt(x, z),
      roll: Math.random,
      slipProof: wasSlipProof || d.statusFx(ms).slipProof || d.equippedStats(ms).slipProof,
      slipImmune: ms.talent?.effects?.slipImmune,
    })) return;
    actor.clearPath();
    actor.flinch();
    d.vfx.impact(x, z, 'slip', { y: 0.12 });
    d.vfx.damageText(x, z, 'slip!', '#8ad4df');
    if (d.inCombat) d.combat?.notifySlip(speaker);
    else say('The floor was, in fact, wet. You go down. Gracefully? No.',
      'The floor was, in fact, wet. {name} goes down. Gracefully? No.');
  }

  return {
    advanceStatusTurn, applySurfaceOn, maybeSlip, tickStepOn, tickTurnClockOn,
    isBleeding, surfaceImpactKind, leaveFootprint,
  };
}
