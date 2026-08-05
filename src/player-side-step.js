// The ordered consequences of a player-side body entering a tile. Real party
// members, summons, and borrowed coworkers share this sequence; their lifecycle
// policies (exit permission and what "down" means) arrive as callbacks.
export function createPlayerSideStepper(d) {
  return function stepPlayerSide(body, x, z, {
    pathDone = false,
    changed = true,
    canExit = false,
    onExit = () => {},
    onDown = () => {},
    say = () => {},
  } = {}) {
    const sheet = body.sheet;
    const actor = body.actor;
    const tileEffect = d.tileEffectAt(x, z);

    // Arrival matters for the exit, even when GridActor reports no tile change.
    if (tileEffect?.effect === 'exit' && pathDone && canExit) {
      onExit();
      return false;
    }
    if (!changed) return true;

    d.notifyStep(body, x, z);

    if (tileEffect?.effect === 'damage') {
      const dead = d.applyDamage(sheet, tileEffect.amount);
      actor.flinch();
      d.vfx.impact(x, z, 'slam', { y: 0.35, scale: 0.8 });
      d.vfx.damageText(x, z, `-${tileEffect.amount}`);
      say(tileEffect.message);
      d.syncHudFor(sheet);
      if (dead) {
        onDown('Done in by the office itself. The floor was, in fact, wet.');
        return false;
      }
    }

    // Keep the pre-tick answer: a gum status that expires on this tile still
    // protects this step from a slip.
    const wasSlipProof = !!d.statusFx(sheet).slipProof;
    if (d.tickStepOn(sheet, actor, x, z, say)) {
      onDown('Death by a thousand paper cuts. Well - several.');
      return false;
    }
    if (d.applySurfaceOn(sheet, actor, x, z, say)) {
      onDown('Done in by the office itself. Facilities sends their regards.');
      return false;
    }
    d.maybeSlip(sheet, actor, x, z, wasSlipProof, say);
    if (!d.gameOver) d.leaveFootprint(actor, sheet, x, z);
    return true;
  };
}
