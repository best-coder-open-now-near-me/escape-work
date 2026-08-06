// The AI's ADVANCE: how a coworker decides where to walk, and walks there.
//
// The largest single function in `startCombat` (192 lines) and the last big
// piece of the AI turn still living in that closure - `combat-ai.js` has owned
// the decision (`chooseBeat`), the gather (`aiBeatPlansFrom`) and the dispatch
// (`takeBeat`) since earlier today, and this is the one arm heavy enough to
// have stayed behind.
//
// Every dependency arrives on `d`, wrapped. The bag is large (37 entries) and
// that is the honest cost of this particular arm: it asks about routes, the
// floor, hazards, threat ranges, shot lines and status effects, because that
// is what "where should I stand" actually depends on. It reads exactly one
// piece of the turn's shared state - `facings` - which is why it could move at
// all when a same-sized cluster reaching for `active` and `phase` could not.
import { createEnemyTraveler } from './enemy-travel.js';
import {
  advanceTravelExposure,
  exposureDistanceFromComposure,
  resetTravelExposure,
  travelExposureStateFor,
} from './travel-exposure.js';

export function createAiAdvance(d) {
  const travelEnemy = createEnemyTraveler({
    advanceTravelExposure,
    travelExposureStateFor,
    resetTravelExposure,
    traceSegment: (...a) => d.world.traceSurfaceSegment(...a),
    floorAt: (...a) => d.world.floorAt(...a),
    exposureInterval: (unit) => exposureDistanceFromComposure(unit.combat.composure),
    statusFx: (...a) => d.statusFx(...a),
    tickStep: (...a) => d.tickStep(...a),
    syncSpeed: (...a) => d.syncUnitSpeed(...a),
    surfaceEffect: (...a) => d.surfaceEffect(...a),
    applyStatus: (...a) => d.applyStatus(...a),
    surfDamage: (...a) => d.world.enemySurfDamage(...a),
    hasStatus: (...a) => d.hasStatus(...a),
    stickGum: (...a) => d.world.stickGum(...a),
    slips: (...a) => d.slips(...a),
    slipChanceAt: (...a) => d.world.slipChanceAt(...a),
    roll: d.rng,
    onStatus: (unit, id) => {
      d.statusFxAt(unit, id);
      d.refresh();
    },
    onDamage: (unit, amount, point, info) => {
      if (info.kind === 'surface') {
        d.fx.impact(point.x, point.z, d.hazardKind(point.x, point.z), { y: 0.35 });
        d.log(`${unit.def.name} stumbles through the hazard. -${amount}.`);
      }
      d.fx.damageText(point.x, point.z, `-${amount}`, '#ffd76b', { big: info.died });
      if (info.died) {
        d.deathFx(unit);
        d.callbacks.onEnemyKilled(unit);
        d.refresh();
      }
    },
    onExpired: () => d.refresh(),
    onGum: (unit) => {
      d.statusFxAt(unit, 'gum');
      d.log(`${unit.def.name} steps in gum. It's theirs now.`);
    },
    onSlip: (unit, point) => {
      unit.slipped = true;
      d.fx.impact(point.x, point.z, 'slip', { y: 0.12 });
      d.fx.damageText(point.x, point.z, 'slip!', '#8ad4df');
      d.log(`${unit.def.name} slips in the water and goes down.`);
    },
    onFootprint: (unit, point) => {
      const surface = d.world.surfaceIdAt(point.x, point.z);
      d.fx.footstep(unit, point.x, point.z, {
        bleeding: unit.hp <= unit.maxHp * 0.45,
        surface,
        onPaper: surface === 'paper',
      });
    },
  });

  function aiAdvance(unit, budget, target) {
    // The whole field of swing-stand routes, scored (AI_PLAN M3): path cost
    // traded against a flanking or rear-arc arrival, the opportunity attacks
    // the walk would eat, and the floor's hazards. Combat gathers the leaf
    // facts; the rule is combat-ai's. canEngage keeps reading the cheap
    // shortest-route test - the two agree on EXISTENCE, which is all the
    // anti-stall contract needs.
    const tb = d.posOf(target);
    // The destination rule is the kit's (AI_PLAN M5): a shooter walks the
    // scored FIRING tile - in range, with a line, ideally shielded and out
    // of the party's reach - and falls back to the melee swing field when no
    // firing tile is routable (sealed LOS, say). Melee kits never consult
    // the firing field at all.
    const rls = d.rangedLines(unit);
    let routes = null;
    // Whether these routes are FIRING tiles, decided where the field is
    // actually chosen rather than after the fallback has overwritten it
    // (Q052). Read off `routes.length` below the fallback, it answered "this
    // unit owns a ranged line and has SOME field", which is true of a shooter
    // walking a melee swing field - so a shooter with no routable firing tile
    // scored plain swing tiles with the entrench-potential bonus and the
    // keep-away term, and could take a longer route to a shielded tile on a
    // turn it was going to punch from.
    let ranged = false;
    if (rls.length) {
      const rmax = Math.max(...rls.map((a) => a.range));
      routes = d.firingTileRoutes(unit.x, unit.z, target.actor.x, target.actor.z, rmax, {
        ...d.world,
        // Would the shot actually FIRE from there - not just reach and see.
        // A blocked outcome (an object shield, a colleague in the redirect) is
        // the case the old field could not express, so the shooter stood still.
        shotClearAt: (gx, gz) => {
          const so = d.shotOutcomeFrom(unit, target.member, gx, gz);
          return !!so.target && (!so.redirected || !!so.target.sheet);
        },
      });
      ranged = !!(routes && routes.length);
    }
    if (!routes || !routes.length) {
      routes = d.standTileRoutes(unit.x, unit.z, target.actor.x, target.actor.z,
        d.swingFieldFor(unit, target));
    }
    // A support kit hangs toward the edge of the scrum too: the keep-away
    // term biases WHICH swing tile she takes, never whether she advances -
    // it is a weight over an already-admitted field, so no stall can enter.
    const backline = ranged || !!(unit.def.support || unit.def.summon);
    const chosen = d.scoreDestination(
      routes,
      {
        target: { x: tb.x, z: tb.z },
        approach: d.world.approach,
        allies: d.aiAllies().filter((e) => e !== unit)
          .map((e) => { const p = d.posOf(e); return { x: p.x, z: p.z, reach: d.reachOfUnit(e) }; }),
        facing: d.facings.get(target.member) || null,
        threats: d.threatsAgainst(unit),
        edgeOpen: d.world.stepOpen,
        surfDamageAt: d.world.enemySurfDamage,
        slipChanceAt: d.world.slipChanceAt,
        // The ranged kit's terms: a shieldable face toward the target is a
        // future entrenchment; a spot inside the party's reach invites the
        // melee answer. Null for melee kits - the terms simply vanish.
        shieldFaceAt: ranged ? (gx, gz) => d.aiCrouchCovered(gx, gz, tb.x, tb.z, {
          tileDefAt: d.world.tileDefAt,
          stepOpen: d.world.stepOpen,
          // The SAME `bodyAt` the crouch beat supplies on arrival. Without it
          // this scored tiles by props alone, so a spot shielded by a standing
          // body scored as open ground - the unit walked past the cover it was
          // about to be offered, and the beat it walked there to take then
          // found a shield the scorer never counted. A destination scorer that
          // grades by a narrower rule than the one it will meet is choosing on
          // the wrong map.
          bodyAt: (x, z) => {
            const o = d.unitStandingAt(x, z);
            return !!o && o !== unit && d.standing(o);
          },
        }) : null,
        nearestThreatDist: backline ? (ax, az) => d.livingMembers()
          .reduce((best_, m) => {
            const p = d.posOf(m);
            return Math.min(best_, Math.hypot(p.x - ax, p.z - az));
          }, Infinity) : null,
      },
    );
    const best = d.advanceRoute(unit, target, chosen, d.world);
    if (!best) return 0;
    const s = d.world.smoothEnemy(unit, best);
    // AI units pay the same surface movement tax the player does, plus their
    // own gum surcharge if they've stepped in a wad.
    const { points, cost } = d.truncateByBudget(s, budget,
      // AI units aren't sheets and wear nothing, so there is no footwear term
      // here - just the floor and whatever is stuck to them.
      (x, z) => d.surfaceStepCost(x, z) * (d.statusFx(unit).moveCostMult ?? 1));
    if (points.length < 2 || cost < 0.05) return 0;
    d.beginMove(unit); // a deliberate move - leaving reach can provoke
    unit.onTile = (x, z, done, changed) => {
      if (changed) {
        // Reactions/occupancy remain logical tile events; the floor itself is
        // resolved from the exact feet segment in onTravel below.
        d.notifyStep(unit, x, z);
      }
      if (done || !unit.alive) {
        unit.onTile = null;
        unit.onTravel = null;
      }
    };
    unit.onTravel = (segment) => {
      const allowed = travelEnemy(unit, segment);
      if (!allowed) {
        unit.onTile = null;
        unit.onTravel = null;
      }
      return allowed;
    };
    unit.setPath(points);
    return cost;
  }

  return aiAdvance;
}
