// Player-side movement has two independent event streams:
//
//   - logical tile entry owns occupancy, exits, office traps and reactions;
//   - exact feet travel owns distance clocks, surfaces, slips and footprints.
//
// Real party members, summons, and borrowed coworkers share both sequences;
// their lifecycle policies (exit permission and what "down" means) arrive as
// callbacks.
export function bodyAwareLine(name, secondPerson, named = secondPerson) {
  const line = name ? named : secondPerson;
  return String(line ?? '').replaceAll('{name}', () => name || 'You');
}

export function createPlayerSideStepper(d) {
  return function stepPlayerSide(body, x, z, {
    pathDone = false,
    changed = true,
    canExit = false,
    onExit = () => {},
    onDown = () => {},
    say = () => {},
    speaker = null,
  } = {}) {
    const sheet = body.sheet;
    const actor = body.actor;
    const tileEffect = d.tileEffectAt(x, z);
    const tell = (secondPerson, named) => say(bodyAwareLine(speaker, secondPerson, named));

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
      tell(tileEffect.message,
        tileEffect.namedMessage || `{name} takes ${tileEffect.amount} damage from the floor.`);
      d.syncHudFor(sheet);
      if (dead) {
        onDown('Done in by the office itself. The floor was, in fact, wet.');
        return false;
      }
    }

    return true;
  };
}

// Consume the exact segment GridActor walked. `advanceTravelExposure` returns
// consequences ordered by distance; events at the same point are grouped so
// the pre-clock traction answer survives that point (a wad that expires there
// still protects that step), matching the old ordered tile pipeline.
export function createPlayerSideTraveler(d) {
  const states = new WeakMap();
  const stateFor = (body) => {
    let state = states.get(body);
    if (!state) {
      state = d.createTravelExposureState();
      states.set(body, state);
    }
    return state;
  };

  const travelPlayerSide = (body, segment, {
    onDown = () => {},
    say = () => {},
    speaker = null,
  } = {}) => {
    const sheet = body.sheet;
    const actor = body.actor;
    const tell = (secondPerson, named) => say(bodyAwareLine(speaker, secondPerson, named));
    const events = d.advanceTravelExposure(stateFor(body), segment, {
      traceSegment: d.traceSegment,
      floorAt: d.floorAt,
      interval: d.exposureInterval(body),
    });

    for (let i = 0; i < events.length;) {
      const at = events[i].distance;
      let j = i + 1;
      while (j < events.length && Math.abs(events[j].distance - at) < 1e-8) j++;
      const group = events.slice(i, j);
      const point = group[group.length - 1].point;
      // Keep the PRE-clock answer for the slip that follows this exact beat.
      const wasSlipProof = !!d.statusFx(sheet).slipProof;

      for (const event of group) {
        if (event.kind !== 'step') continue;
        if (d.tickStepOn(sheet, actor, point.x, point.z, tell)) {
          onDown('Death by a thousand paper cuts. Well - several.');
          states.delete(body);
          return false;
        }
      }
      for (const event of group) {
        if (event.kind !== 'surface') continue;
        if (d.applySurfaceOn(sheet, actor, point.x, point.z, tell)) {
          onDown('Done in by the office itself. Facilities sends their regards.');
          states.delete(body);
          return false;
        }
      }

      const slipped = d.maybeSlip(sheet, actor, point.x, point.z,
        wasSlipProof, tell, speaker);
      if (!d.gameOver) d.leaveFootprint(actor, sheet, point.x, point.z);
      if (slipped) return false;
      i = j;
    }
    return true;
  };

  travelPlayerSide.reset = (body) => states.delete(body);
  return travelPlayerSide;
}
