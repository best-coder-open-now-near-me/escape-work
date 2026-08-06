// The WORLD FACADE: the ~36 questions a fight asks of the floor it is fought
// on. combat.js is pure of PlayCanvas and of the level; everything it needs to
// know - where the bodies are, what a tile is made of, whether a step is legal,
// what a shove costs - arrives through this one object.
//
// It used to be a 199-line literal in the middle of `beginCombat`, itself the
// largest function in `startGame`'s 4,400-line closure (Q039). Two things came
// of that. The obvious one is size. The other is Q041: `tests/unit/
// world-contract.test.js` pins what the pure plan modules NEED off this bag,
// and says in its own header that it deliberately cannot check the other side -
// "main.js is the entry point and importable.test.js excludes it on purpose, so
// the provider side cannot be reached from node". It can now. What this returns
// is a plain object built from plain callbacks, so a test can build one and ask
// whether it still carries the keys the rules read.
//
// Everything arrives on `d`. The MUTABLE bindings among them - `sheet`,
// `player`, `combat`, and the rosters - are passed as getters by main.js, not
// as values: a fight outlives a leader switch, and a facade holding the sheet
// somebody had when combat opened would answer every question about the wrong
// character.
import { createWorldEdits } from './world-edits.js';
import { livingMemberAt } from './member-rules.js';
import { acceptsSurface } from './data/tiles.js';

export function createCombatWorld(d) {
  const edits = createWorldEdits(d.grid, d.scene);
  return {
    isWalkable: d.isWalkable,
    doorsBeside: (x, z) => d.doors.doorsBeside(x, z),
    // The raw edit, for the side combat charges itself (AI_PLAN A10).
    openDoor: (key) => d.doors.setDoorOpen(key, true),
    // The acting body's own route: allies BLOCK in combat (no ending a
    // move stacked on a teammate; sequenced moves can afford the detour)
    // and the costs are the walker's own talents, not the leader's.
    // "The walker" includes a summon you're driving - it has its own sheet
    // and its own talents, so looking only at party.members made a shock-
    // immune leader route an employee straight through live water.
    // Summons block too: a member's move must not end stacked on one.
    findPath: (sx, sz, tx, tz, self = d.player) => {
      const walker = d.party.members.find((m) => m.actor === self)
        || d.summons.find((s) => s.actor === self);
      // A borrowed coworker is in NEITHER roster - combat's `members` is a
      // copy of this one - so ask the fight who is walking before falling
      // back to the leader. Without it a shock-immune leader routes a
      // borrowed body straight through live water, which is the exact
      // mistake the smoother's comment below says this costing prevents.
      const ms = walker?.sheet
        || (d.combat?.actingActor === self ? d.combat.actingSheet : null)
        || d.sheet;
      const blocked = (x, z) => !!livingMemberAt(
        [...d.party.members, ...d.summons], x, z, walker,
      );
      const open = (x, z) => d.isWalkable(x, z) && !blocked(x, z);
      return d.findPath(open, sx, sz, tx, tz, d.hazardCostFor(ms), d.grid.stepOpen);
  },
    // AI routing (enemies and player-team summons): never through a party
    // member's or another summon's tile, costed by the enemy hazard model -
    // your talents don't shape an AI unit's fears. The mover's own start
    // tile isn't re-checked by findPath, so a unit never blocks on itself.
    findEnemyPath: (sx, sz, tx, tz) => d.findPath(
      (x, z) => d.isWalkable(x, z) && !d.partyAt(x, z) && !d.summonAt(x, z),
      sx, sz, tx, tz, d.enemyHazardCost, d.grid.stepOpen),
    // Any-angle smoothing for combat walks, each mirroring ITS router's
    // world - a smoother that disagrees with the route it was handed
    // degrades to raw tile centres (or worse, straightens through a tile
    // the route detoured around). The party variant blocks the same
    // teammates findPath blocked and fears the WALKER's hazards, not the
    // leader's; the enemy variant blocks the party members and summons
    // findEnemyPath routed around. Both splice the body and both let the
    // route's own cells through (routeOpen, which also covers the mover's
    // own start tile - a body standing in a spill can smooth its way out).
    smooth: (p, actor) => {
      const walker = d.party.members.find((m) => m.actor === actor)
        || d.summons.find((s) => s.actor === actor);
      // Same borrowed-body case as findPath above, and it has to agree with
      // it: a smoother fearing different hazards than its router straightens
      // through the tile the route detoured around.
      const ms = walker?.sheet
        || (d.combat?.actingActor === actor ? d.combat.actingSheet : null)
        || d.sheet;
      const blocked = (x, z) => !!livingMemberAt(
        [...d.party.members, ...d.summons], x, z, walker,
      );
      return d.smoothFromBody(p, actor, (x, z) => !blocked(x, z), ms);
  },
    smoothEnemy: (en, p) => {
      const pos = en.entity?.getPosition();
      if (pos) p = [[pos.x, pos.z], ...p.slice(1)];
      const base = (x, z) => d.isWalkable(x, z) && !d.partyAt(x, z) && !d.summonAt(x, z);
      return d.smoothPath(
        d.routeOpen(base, p), p, d.grid.edgeOpen, d.enemyHazardSegmentCost,
      );
  },
    clampPoint: d.clampPoint,
    approach: d.approachTo,
    // Partitions (edge walls) are chest height: they block movement but
    // not throws - lob paper right over the cubicle wall. Closed doors go
    // floor to frame, so they DO stop throws (grid.sightOpen); so does smoke
    // (sightClear).
    hasLos: (ax, az, bx, bz) => d.segmentClear(d.sightClear, ax, az, bx, bz, d.grid.sightOpen),
    stepOpen: d.grid.stepOpen,
    surfaceIdAt: (x, z) => d.runtime.surfaceAt(x, z),
    isElectrified: (x, z) => d.grid.isElectrified(x, z),
    // Whether the tile is actually ALIGHT, which is not the same question
    // as "is its painted surface `fire`" - combat had to ask the second
    // because the facade never offered the first.
    isBurning: (x, z) => d.runtime.isBurning(x, z),
    enemySurfDamage: (x, z) => d.rawSurfDamage(x, z),
    // The tile's raw facts, so combat can run step-rules' own
    // `surfaceEffect` instead of being handed a pre-chewed answer per
    // question. Every other surface entry here is a a different question
    // asked of this same sheet; handing over the sheet is what stops the
    // facade growing a method every time a new one comes up (Q900).
    floorAt: d.floorAt,
    // Surface geometry is finer than movement terrain. Powers rasterise their
    // exact preview against this field, then hand the returned centres to the
    // atomic writer below.
    surfaceField: () => d.grid.surfaceField,
    traceSurfaceSegment: (...a) => d.grid.surfaceField.traceSegment(...a),
    // What a tile costs THIS member, after their talents (Q1-A, designer
    // 2026-08-02). The enemy model above consults none, which was right
    // while only enemies were billed by it - but the AI's shove and pull
    // land a MEMBER on a tile, and were reading it, so an IT Support in ESD
    // Steel-Toes took full shock damage from a forced landing and none from
    // walking onto the same tile. "The same tile means the same thing
    // however you got there" is the rule the walking model already states;
    // this is the seam that lets combat.js honour it.
    memberSurfDamage: (s, x, z) => d.effectiveSurfDamage(x, z, s),
    slipChanceAt: d.slipChanceAt,
    stickGum: d.stickGum,
    // Cone attacks carpet open floor with a surface tile (Bulk Mail ->
    // paper). Plain and coloured office carpet accept it; existing surfaces
    // and props do not.
    // `turns` > 0 marks the surface as LITTER rather than terrain: it
    // clears itself after that many rounds (see ageTempSurfaces).
    // The read-only twin of leaveSurface's own first line. The zone verb's
    // ring preview and its cursor count both need to know which tiles will
    // TAKE a surface without painting one to find out - and asking a
    // different question than the commit asks is how a preview starts
    // lying (the rings promised tiles the click then skipped).
    canTakeSurface: (x, z) => acceptsSurface(d.grid.typeAt(Math.round(x), Math.round(z)))
      && !d.runtime.surfaceAt(x, z),
    // Toppling (POWERS_PLAN M6) needs to read a prop's definition, test
    // whether the tile behind it is clear, and mutate both. setType is the
    // same call the exploding printer already makes, so the grid, the
    // renderer and pathfinding re-read a toppled prop exactly as they do a
    // destroyed one - no new invalidation path.
    tileDefAt: (x, z) => d.grid.defAt(x, z),
    terrainOpen: (x, z) => d.grid.terrainOpen(x, z),
    // The grid+mesh pairing is world-edits.js, shared with the out-of-combat
    // shove that used to write it out by hand.
    setType: (...a) => edits.setType(...a),
    // Partition toppling (TACTICS_PLAN M6): is a plain wall edge standing
    // between these cells, and knock it out of the world - grid rule and
    // mesh together, the same pairing setType already is. Doors never
    // appear in the wall sets, so they are untoppleable by construction.
    wallEdgeBetween: (x, z, nx, nz) => !!d.grid.wallEdgeBetween(x, z, nx, nz),
    toppleEdge: (...a) => edits.toppleEdge(...a),
    // Breaking cover down (TACTICS_PLAN M8). Grid keeps the pool, this
    // pairs the grid rule with the mesh exactly as setType/toppleEdge do:
    // a surviving prop leans (the damaged tell - the pool is hidden by
    // design, so the object has to wear the damage), a spent one is
    // REMOVED - tile to floor, edge out of the world, no debris ("gone
    // means gone", designer 2026-07-30). Returns hp remaining, 0 for
    // destroyed, null for a target with no pool.
    propHpAt: (x, z) => d.grid.propHpAt(x, z),
    damageProp: (x, z, amount) => {
      const left = d.grid.damageProp(x, z, amount);
      if (left === null) return null;
      if (left <= 0) {
        d.grid.setType(x, z, 'floor');
        d.scene.refreshTile?.(x, z);
        return 0;
      }
      d.scene.markPropDamaged?.(x, z);
      return left;
  },
    edgeHpBetween: (x, z, nx, nz) => d.grid.edgeHpBetween(x, z, nx, nz),
    damageEdge: (x, z, nx, nz, amount) => {
      const left = d.grid.damageEdge(x, z, nx, nz, amount);
      if (left === null) return null;
      if (left <= 0) {
        const e = d.grid.removeEdgeBetween(x, z, nx, nz);
        if (e) d.scene.removeEdgeWall?.(e.o, e.k);
        return 0;
      }
      const e = d.grid.wallEdgeBetween(x, z, nx, nz);
      if (e) d.scene.markEdgeDamaged?.(e.o, e.k);
      return left;
  },
    leaveSurface: d.leaveSurfaceAt,
    leaveSurfaceCells: (...a) => d.leaveSurfaceCells(...a),
    // Anyone alive is a legal target - bystanders outside the initial
    // engagement get pulled in when attacked.
    // A BORROWED coworker is off this list for the duration (TODO Phase 8).
    // Every AI target picker reads it, so dropping them here is the single
    // edit that turns their own colleagues against them - no side flag
    // threaded through the targeting code, because there is no side flag in
    // this engine to thread.
    liveEnemies: () => d.enemies.filter((e) => e.alive && !e.charmed),
    // Combat owns WHEN a body changes hands; main.js owns the lists, the
    // same division summons already use.
    setCharmed: (unit, on) => { unit.charmed = !!on; },
    // A borrowed coworker's step, run through the PLAYER side's own rules.
    //
    // It needs a seam because it is the one body neither roster covers:
    // combat's `members` is a copy, so the borrowed body never reaches
    // `party.members` (which this file's per-frame loop steps) nor
    // `summons`, and combat only installs an `onTile` in `aiAdvance`, which
    // a player-driven body never runs. Left alone it takes no surface
    // damage, catches nothing, picks up no gum, never slips, never ticks
    // the step clock, leaves no footprints and provokes nobody - the one
    // body on the floor the floor cannot touch (Q907).
    //
    // Routed through the shared player-side step pipeline, using the temporary
    // ally lifecycle policy rather than opening a third rule path. The carrier
    // comes from combat so `notifyStep` can resolve it - a fresh literal could
    // not. The shared stepper also gives this body a named narrator line.
    borrowedStep: (carrier, x, z, done, changed) => d.onTemporaryAllyStep(carrier, x, z, done, changed),
    borrowedTravel: (carrier, segment) => d.onTemporaryAllyTravel(carrier, segment),
    // Continuous body-clear rests around the exact aim. Preview and spawn call
    // the same deterministic search, so every ring is an actual arrival.
    summonSpots: (spec, tx, tz, n) => d.summonPointsNear(tx, tz, n, spec.placement),
    // A summon whose assignment lapsed (or one that fell) leaves the board
    // here - combat.js decides when, main.js owns the lists and the body.
    dismissSummon: (body) => d.dismissSummon(body),
    // The spawn path itself is shared with the out-of-combat post - see
    // spawnSummonUnits, above.
    spawnSummon: d.spawnSummonUnits,
  };
}
