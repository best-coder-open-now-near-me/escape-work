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
export function createAiAdvance(d) {
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
        // Breaking away from a party-side body hands it a free swing first -
        // an enemy that repositions out of your reach pays for it too.
        d.notifyStep(unit, x, z);
        if (!unit.alive) { unit.onTile = null; return; }
        // AI units feel the floor too - the damage, and now the riders that
        // come with it [stated] (designer, 2026-08-03, "yes all fixes").
        //
        // The same `surfaceEffect` the member side reads, off the same fact
        // sheet, because the alternative is a second opinion about what a tile
        // does. What it carries: a turn-clock status (fire -> burning), and a
        // `bleed` duration on the drift that cuts. Both were player-only, which
        // made fire area denial that worked in one direction and left `bleed`
        // with no way to reach a coworker at all - so the step clock right
        // below could only ever expire gum.
        const sfx = d.surfaceEffect(d.world.floorAt(x, z));
        if (sfx && sfx.applies && sfx.applies !== 'gum' && d.applyStatus(unit, sfx.applies)) {
          d.statusFxAt(unit, sfx.applies);
          d.refresh();
        }
        const surf = d.world.enemySurfDamage(x, z);
        if (surf > 0) {
          // Before the damage: a body that goes down on this tile still went
          // down bleeding, and the status list is what the death FX reads.
          if (sfx?.bleed) d.applyStatus(unit, 'bleed', { duration: sfx.bleed });
          const died = unit.takeDamage(surf);
          d.fx.impact(x, z, d.hazardKind(x, z), { y: 0.35 });
          if (died) d.deathFx(unit);
          d.fx.damageText(x, z, `-${surf}`, '#ffd76b', { big: died });
          d.log(`${unit.def.name} stumbles through the hazard. -${surf}.`);
          if (died) {
            d.callbacks.onEnemyKilled(unit);
            d.refresh();
          }
        }
        // The STEP clock, on the enemy side (Q2-A, designer 2026-08-02). It
        // had no caller here at all: ARCHITECTURE.md says "the step clock ticks
        // per tile walked, wherever you are", and for half the actors on the
        // floor it never ticked once. Gum on a coworker was permanent - the
        // comment below used to say so outright - and `bleed`, the only other
        // step-clocked status, would have dealt zero damage forever the day any
        // power aimed it at a coworker. Same `tickStep`, same durations, both
        // sides of the door.
        // Sampled BEFORE the step clock ticks, exactly as the member side does
        // (main.js `maybeSlip`, whose comment states the rule): the tile a gum
        // wad wears off on still keeps its traction. Adding this step clock
        // above the slip roll quietly undid that on the enemy side only, so a
        // coworker could lose the wad and their footing on the same tile - and
        // a slip costs a unit its whole turn.
        const wasSlipProof = !!d.statusFx(unit).slipProof;
        if (unit.alive) {
          const step = d.tickStep(unit);
          if (step.damage > 0) {
            const gone = unit.takeDamage(step.damage);
            d.fx.damageText(x, z, `-${step.damage}`, '#ffd76b', { big: gone });
            if (gone) {
              d.deathFx(unit);
              d.callbacks.onEnemyKilled(unit);
              d.refresh();
            }
          }
          if (step.expired.length) {
            d.syncUnitSpeed(unit); // a lapsed gum wad gives its speed back
            d.refresh();
          }
        }
        // gum wads stick to AI units too: it taxes their movement AP (via the
        // status's moveCostMult) and grants traction. It now WEARS OFF on the
        // same step clock a member's does, rather than lasting the fight.
        if (unit.alive && !d.hasStatus(unit, 'gum') && d.world.stickGum(x, z)) {
          d.applyStatus(unit, 'gum');
          d.statusFxAt(unit, 'gum');
          d.syncUnitSpeed(unit);
          d.log(`${unit.def.name} steps in gum. It's theirs now.`);
        }
        // wet floor: a slip ends their whole turn (they spend it getting up).
        // Gum is traction (slipProof), so a gummed unit can't slip.
        // The last direct Math.random in the fight. Through `rng` like the rest,
        // so a seeded run reproduces the slips too - they end a whole turn, so
        // an unseeded one is exactly the kind of thing that makes a resolution
        // test flaky for reasons that have nothing to do with what it asserts.
        if (unit.alive && d.slips({
          chance: d.world.slipChanceAt(x, z),
          roll: d.rng,
          slipProof: wasSlipProof,
        })) {
          unit.clearPath();
          unit.flinch();
          unit.slipped = true;
          d.fx.impact(x, z, 'slip', { y: 0.12 });
          d.fx.damageText(x, z, 'slip!', '#8ad4df');
          d.log(`${unit.def.name} slips in the water and goes down.`);
        }
        // Coworkers track the floor around too: a wounded one crossing a paper
        // drift prints blood behind it exactly like a party member does.
        if (unit.alive) {
          d.fx.footstep(unit, x, z, {
            bleeding: unit.hp <= unit.maxHp * 0.45,
            surface: d.world.surfaceIdAt(x, z),
            onPaper: d.world.surfaceIdAt(x, z) === 'paper',
          });
        }
      }
      if (done || !unit.alive) unit.onTile = null;
    };
    unit.setPath(points);
    return cost;
  }

  return aiAdvance;
}
