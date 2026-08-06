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
import {
  countLiveSummons, summonAnchorPoint, summonPlacement,
} from './summon-rules.js';
import { livingMemberAt } from './member-rules.js';

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
  const summonAt = (x, z) => !!livingMemberAt(d.summons, x, z);

  function spawnSummonUnits(spec, team, summoner, n, aim = null) {
    const archetypeId = spec?.archetype;
    const def = d.CLASSES[archetypeId] || d.ENEMY_TYPES[archetypeId];
    if (!def) return [];
    const ally = team === 'player';
    const out = [];
    // The descriptor survives all the way to the system that consumes it.
    // `placement.anchor` chooses the origin; the landing search itself owns
    // non-negotiable physical clearance for every character it creates.
    const summonerPoint = summoner.entity?.getPosition?.() || summoner.spawnPoint || summoner;
    const anchor = summonAnchorPoint(spec, summonerPoint, aim);
    const spots = anchor
      ? d.summonPointsNear(anchor.x, anchor.z, n, summonPlacement(spec))
      : [];
    for (const [x, z] of spots) {
      const tileX = Math.round(x);
      const tileZ = Math.round(z);
      const actor = ally
        ? new d.CompanionActor(tileX, tileZ, archetypeId, def)
        : new d.EnemyActor(tileX, tileZ, archetypeId, def, { team, summoned: true, summonedBy: summoner });
      // The logical movement tile is derived from the rest point; keep the
      // latter while the async model load is still pending so FX and later
      // placement passes see where the body physically arrived.
      actor.spawnPoint = { x, z };
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

  // Rebuild the compact records party.js carried across a floor. Placement is
  // anchored at the exact party entry and the same continuous landing search
  // fans each arrival into body-clear space. The archetype supplies all static
  // sheet data again.
  function restoreSummons(saved, party, at) {
    const out = [];
    for (const state of saved || []) {
      const summoner = party?.members[state.summonedBy]?.actor
        || party?.members[party.active]?.actor;
      if (!summoner) continue;
      const [rec] = spawnSummonUnits({
        archetype: state.archetypeId,
        placement: { anchor: 'aim', avoidHazards: true },
      }, 'player', summoner, 1, at);
      if (!rec) continue; // unknown archetype or no safe entry tile
      rec.sheet.hp = Math.min(rec.sheet.maxHp, state.hp);
      rec.sheet.statuses = { ...(state.statuses || {}) };
      rec.actor.summonTurns = state.turnsLeft;
      out.push(rec);
    }
    return out;
  }

  const roomFor = (a) => d.summonRoom(a, countLiveSummons(d.player, d.summons));
  // The same ladder combat runs, minus the two legs a FIGHT owns - there is no
  // AP pool to spend out here and no per-fight `uses` to ration, so those
  // fields simply are not supplied.
  const landingSpots = (a, tx, tz, n) => d.summonPointsNear(
    tx, tz, n, summonPlacement(a),
  );
  const summonDropProblem = (a, tx, tz) => d.summonSpotProblem(a, {
    // The drop range is a circle from the poster's body to the exact aim.
    dist: Math.hypot(d.leadBody().x - tx, d.leadBody().z - tz),
    los: d.hasLos(d.leadBody(), { x: tx, z: tz }),
    hasRoomToStand: landingSpots(a, tx, tz, 1).length > 0,
    room: roomFor(a),
  });
  // The continuous points the arrivals would land on: the exact click first,
  // then body-clear ground ringing outward, bounded by `count` and cap room.
  const summonDropSpots = (a, tx, tz) => (summonDropProblem(a, tx, tz)
    ? []
    : landingSpots(a, tx, tz, d.dropCount(a, roomFor(a))));

  return {
    dismissSummon,
    despawnSummons,
    ageSummons,
    summonAt,
    spawnSummonUnits,
    restoreSummons,
    roomFor,
    summonDropProblem,
    summonDropSpots,
  };
}
