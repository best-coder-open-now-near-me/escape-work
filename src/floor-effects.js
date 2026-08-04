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
      const r = d.tickTurnClockOn(m.sheet, m.actor, (d) => d.applyDamage(m.sheet, d));
      if (r.damage > 0 || r.expired.length) d.syncHudFor(m.sheet);
      if (r.down) downed.push(m);
    }
    for (const s of [...d.summons]) {
      if (!s.actor || s.sheet.hp <= 0) continue;
      // A temp takes the rules in silence, like everywhere else in this file.
      if (d.tickTurnClockOn(s.sheet, s.actor, (d) => d.applyDamage(s.sheet, d)).down) {
        d.dismissSummon(s.actor);
      }
    }
    const slain = [];
    for (const en of d.enemies) {
      if (!en.alive) continue;
      if (d.tickTurnClockOn(en, en, (d) => en.takeDamage(d)).down) slain.push(en);
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
      say(had ? 'More gum. You are building a collection.' : sfx.message);
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
      d.vfx.impact(x, z, d.surfaceImpactKind(x, z), { y: 0.3 });
      d.vfx.damageText(x, z, `-${amount}`);
      say(sfx.message);
      d.syncHudFor(ms);
      return down;
    }
    if (sfx.amount) {
      say(ms.talent?.effects?.shockImmune && d.grid.isElectrified(x, z)
        ? 'The water crackles. Your ESD soles rate this a non-event. 0 damage.'
        : 'You glide across the drift; the edges respect a master. Not a scratch.');
      d.syncHudFor(ms);
    } else if (sfx.message && !sfx.applies) {
      say(sfx.message);
    }
    return false;
  }

  function maybeSlip(ms, actor, x, z, wasSlipProof, say) {
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
    if (d.inCombat) d.combat?.notifySlip();
    else say('The floor was, in fact, wet. You go down. Gracefully? No.');
  }

  return { advanceStatusTurn, applySurfaceOn, maybeSlip };
}
