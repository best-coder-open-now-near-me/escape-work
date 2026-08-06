// Shared feet-travel consequences for AI-driven bodies, in and out of combat.
// Presentation arrives as callbacks; the status, damage, gum and slip order is
// one rule so a coworker cannot acquire different feet when initiative opens.

export function createEnemyTraveler(d) {
  const states = new WeakMap();
  const stateFor = (unit) => {
    let state = states.get(unit);
    if (!state) {
      state = d.createTravelExposureState();
      states.set(unit, state);
    }
    return state;
  };

  const travelEnemy = (unit, segment) => {
    const events = d.advanceTravelExposure(stateFor(unit), segment, {
      traceSegment: d.traceSegment,
      floorAt: d.floorAt,
      interval: d.exposureInterval(unit),
    });

    for (let i = 0; i < events.length;) {
      const at = events[i].distance;
      let j = i + 1;
      while (j < events.length && Math.abs(events[j].distance - at) < 1e-8) j++;
      const group = events.slice(i, j);
      const point = group[group.length - 1].point;
      const wasSlipProof = !!d.statusFx(unit).slipProof;

      for (const event of group) {
        if (event.kind !== 'step' || !unit.alive) continue;
        const step = d.tickStep(unit);
        if (step.damage > 0) {
          const died = unit.takeDamage(step.damage);
          d.onDamage?.(unit, step.damage, point, { kind: 'step', died });
          if (died) {
            states.delete(unit);
            return false;
          }
        }
        if (step.expired.length) {
          d.syncSpeed(unit);
          d.onExpired?.(unit, step.expired, point);
        }
      }

      for (const event of group) {
        if (event.kind !== 'surface' || !unit.alive) continue;
        const floor = event.floor || d.floorAt(point.x, point.z) || {};
        const sfx = d.surfaceEffect(floor);
        if (sfx?.applies && sfx.applies !== 'gum'
          && d.applyStatus(unit, sfx.applies)) {
          d.onStatus?.(unit, sfx.applies, point);
        }
        const amount = d.surfDamage(point.x, point.z);
        if (amount > 0) {
          if (sfx?.bleed) d.applyStatus(unit, 'bleed', { duration: sfx.bleed });
          const died = unit.takeDamage(amount);
          d.onDamage?.(unit, amount, point, { kind: 'surface', floor, sfx, died });
          if (died) {
            states.delete(unit);
            return false;
          }
        }
        if (!d.hasStatus(unit, 'gum') && d.stickGum(point.x, point.z)) {
          d.applyStatus(unit, 'gum');
          d.syncSpeed(unit);
          d.onGum?.(unit, point);
        }
      }

      if (unit.alive && d.slips({
        chance: d.slipChanceAt(point.x, point.z),
        roll: d.roll,
        slipProof: wasSlipProof || d.statusFx(unit).slipProof,
      })) {
        unit.clearPath();
        unit.flinch();
        d.onSlip?.(unit, point);
        return false;
      }
      if (unit.alive) d.onFootprint?.(unit, point);
      i = j;
    }
    return true;
  };

  travelEnemy.reset = (unit) => states.delete(unit);
  return travelEnemy;
}
