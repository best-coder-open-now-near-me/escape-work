// THE TEMP WORKFORCE: who gets called in, how many, where they land, and when
// the assignment ends.
//
// A slice off `startGame` (Q039). These nine were scattered across four places
// in the file - the dismissal trio up by the level teardown, the spawner down
// among the model helpers, the cap-and-drop rules four hundred lines later -
// and they are one subsystem: every one of them is about the roster, and the
// invariants that keep it honest are only visible when they sit together.
//
// The roster itself STAYS in main.js. `summons` is world state, exactly like
// `enemies` and `npcs`, and fifteen readers outside this cluster ask for it;
// what belongs here is the set of operations that may change it, not the array.
// So this takes `get summons()` and owns nothing - the seam is behaviour, not
// storage, and pretending otherwise would have meant a getter in main.js
// wrapping a module wrapping an array.
//
// Two invariants live here and nowhere else:
//   - `dismissSummon` splices the list, so `despawnSummons` and `ageSummons`
//     both walk a COPY. Iterating the live array while dismissing from it skips
//     every other temp.
//   - who summoned whom outlives the fight it happened in. A summon with turns
//     left walks out with you and into the next fight (SUMMON_PLAN #7), and the
//     per-summoner live cap can only count it if that link survives the trip.
export function createSummonLayer(d) {
  function dismissSummon(body) {
    if (!body) return;
    body.entity?.destroy();
    body.entity = null;
    body.visual = null;
    const i = d.summons.findIndex((s) => s.actor === body);
    if (i >= 0) d.summons.splice(i, 1);
    const e = d.enemies.indexOf(body);
    if (e >= 0) d.enemies.splice(e, 1);
  }

  // Clear the whole summon roster at once. Losing and aborting still do this -
  // a game over or a torn-down fight leaves nothing standing. VICTORY no longer
  // does: a summon with turns left on its assignment walks out of the fight
  // with you and joins the next one (see the world clock in the update loop).
  function despawnSummons() {
    // Over a COPY - dismissSummon splices the list it is walking.
    for (const s of [...d.summons]) dismissSummon(s.actor);
    d.summons.length = 0;
  }

  // Out-of-combat, a summon's assignment is spent by the world clock instead of
  // by initiative turns - one per fire/smoke turn - so temps don't loiter
  // forever just because you stopped fighting. Returns nothing; expired
  // employees show themselves out.
  function ageSummons() {
    for (const s of [...d.summons]) {
      if (s.actor.summonTurns == null) continue;
      s.actor.summonTurns -= 1;
      if (s.actor.summonTurns > 0) continue;
      d.ui.toast(`${s.sheet.name}'s assignment ends. They head for the elevators.`);
      dismissSummon(s.actor);
    }
  }

  // A living player-team summon on this tile. Summons block enemies (folded
  // into enemy pathing/occupancy in main) but stay pass-through for the party -
  // isWalkable deliberately ignores them, so members walk right through.
  const summonAt = (x, z) => d.summons.some((s) => s.sheet.hp > 0 && s.actor.x === x && s.actor.z === z);

  function spawnSummonUnits(archetypeId, team, summoner, n, at = null) {
    const def = d.CLASSES[archetypeId] || d.ENEMY_TYPES[archetypeId];
    if (!def) return [];
    const ally = team === 'player';
    const out = [];
    const spots = at
      ? d.freeTilesNear(at.x, at.z, n, 0)
      : d.freeTilesNear(summoner.x, summoner.z, n, 1);
    for (const [x, z] of spots) {
      const actor = ally
        ? new d.CompanionActor(x, z, archetypeId, def)
        : new d.EnemyActor(x, z, archetypeId, def, { team, summoned: true, summonedBy: summoner });
      // Who called them is part of the record, not just of the fight they were
      // called in: a summon that outlives its fight walks into the NEXT one,
      // and the per-summoner live cap can only see it if the link survives the
      // trip (SUMMON_PLAN #7). Enemy-side summons carry the same link on the
      // actor itself.
      const rec = ally
        ? { sheet: d.createSheetFrom(def, { summon: true }), actor, summonedBy: summoner }
        : actor;
      (ally ? d.summons : d.enemies).push(rec);
      d.placeModel(d.app, `assets/characters/${def.model}.glb`, x, z, {
        lift: d.lift, rotY: ally ? 90 : -90, animate: true,
        onReady: (e) => {
          d.dressUp(e, actor, ally ? d.lookOf(rec.sheet) : actor.def?.look, ally ? rec.sheet.model : actor.def?.model);
          d.picking.register(e, ally ? 'summon' : 'enemy', actor);
        },
      });
      out.push(rec);
    }
    return out;
  }

  const liveSummonsOf = (summoner) => d.summons.filter((s) =>
    s.sheet.hp > 0 && s.actor && s.summonedBy === summoner).length;
  const roomFor = (a) => d.summonRoom(a, liveSummonsOf(d.player));
  // The same ladder combat runs, minus the two legs a FIGHT owns - there is no
  // AP pool to spend out here and no per-fight `uses` to ration, so those
  // fields simply are not supplied.
  const summonDropProblem = (a, tx, tz) => d.summonSpotProblem(a, {
    // The drop range is a circle from the poster's body; the SPOT is a tile.
    dist: Math.hypot(d.leadBody().x - tx, d.leadBody().z - tz),
    los: d.hasLos(d.leadBody(), { x: tx, z: tz }),
    hasRoomToStand: d.freeTilesNear(tx, tz, 1, 0).length > 0,
    room: roomFor(a),
  });
  // The tiles the arrivals would land on: the clicked tile first, then the free
  // ground ringing outward, bounded by `count` and by what the cap has left.
  const summonDropSpots = (a, tx, tz) => (summonDropProblem(a, tx, tz)
    ? []
    : d.freeTilesNear(tx, tz, d.dropCount(a, roomFor(a)), 0));

  return {
    dismissSummon,
    despawnSummons,
    ageSummons,
    summonAt,
    spawnSummonUnits,
    liveSummonsOf,
    roomFor,
    summonDropProblem,
    summonDropSpots,
  };
}
