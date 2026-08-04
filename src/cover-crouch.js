// THE CROUCH, and what it is still behind.
//
// A slice off `startCombat` (Q037) - and the first cut into this file since a
// larger one was reverted, so it is deliberately scoped to the geometry rather
// than the verbs that spend AP on it.
//
// The whole cluster exists to answer one question in one place: is that cover
// still real? `crouchStateOf` is the sole owner of that answer, and it is LAZY
// on purpose - consulted at every read rather than hooked into every way a
// fight can move things, so it stays correct when a new displacement verb
// arrives without anyone remembering to notify it. A destroyed cabinet, a
// toppled partition, a shield who walked off and a shield who went down all
// fail the SAME way: the face they were covering stops being shielded, and a
// crouch with no faces left is a crouch behind nothing.
//
// `crouched` and `watching` arrive BY REFERENCE, not through setters. They are
// Maps, not rebindable bindings - the host never reassigns either, both sides
// only ever mutate the one object - so a getter/setter pair would be ceremony
// around a reference that is already shared. Same call the frame loop's
// `legQueue` got.
//
// Two locals in here were named `d`, which is the deps bag's name; they are
// `def` now. That collision is a documented trap in tools/check-extractions.mjs
// and it was sitting in the code before the cut began.
import { shieldingFace } from './tactics.js';

export function createCrouch(d) {
  // Is somebody holding a `guard` stance on this exact tile? Read by the cover
  // predicate, so a planted teammate shields the face they stand on.
  // `forUnit` is who is being SHOT AT: a guard stance shields the side that
  // planted it, and only that side. Without the test any planted body was
  // cover for anybody, so an enemy holding the line shielded the party member
  // they were holding it against - and the party's own guard did the same
  // favour for the coworkers. Sides are read live (`aiAllies`), the same rule
  // the pincer test uses, so a charmed coworker shields the player this turn.
  const guardStandingAt = (x, z, forUnit) => {
    const side = forUnit && (forUnit.sheet ? d.members : d.aiAllies());
    for (const [holder, actionId] of d.watching) {
      if (d.ACTIONS[actionId]?.mode !== 'guard') continue;
      if (side && !side.includes(holder)) continue;
      const b = d.bodyOf(holder);
      if (b && b.x === x && b.z === z && d.standing(holder)) return true;
    }
    return false;
  };

  // --- the take-cover crouch (TACTICS_PLAN M6) --------------------------------
  // A crouch is a POSITION, not a commitment to one object: unit -> { at }.
  //
  // It used to be three shapes wearing one map - a shield CELL (`x, z`), a
  // human shield (`shield`), or the tile's own partitions (`edges`) - each
  // with its own validity test and its own branch in shotOutcome. The two
  // object modes made you name a thing and then had `coverSpot` choose which
  // SIDE of it you stood on, which is why the aim emblem hopped tile to tile
  // and why you could not pick a side of a person (designer, 2026-07-31:
  // "makes it impossible to use as i cant pick a side of the person").
  //
  // One rule now, and it is the one edge mode already had: you crouch WHERE
  // YOU ARE, and whatever shields the faces of that tile covers you along
  // those faces - partitions and walls on the edges, props and BODIES on the
  // neighbouring cells (designer: "it should find the objects within its
  // target area range, whatever is there is the side of the object(s) we are
  // covered by"). Uncapped: a corner covering three faces covers three
  // directions.
  //
  // The rule the map buys is unchanged: a single-target RANGED attack from a
  // direction a shielded face points cannot touch the croucher - refused
  // outright behind an object, REDIRECTED into the shield when that face
  // holds a body (a tank that deleted shots would make teammates free walls).
  // Melee never asks - a crouch is no answer to someone at arm's length - and
  // area attacks (cones, zones) deliberately ignore it: flushing entrenched
  // targets is their job.
  const nameOf = (u) => (u.sheet ? u.sheet.name : u.def.name);
  const carrierOf = (u) => u.sheet || u;
  function breakCrouch(unit, quiet = false) {
    if (!d.crouched.delete(unit)) return;
    d.removeStatus(carrierOf(unit), 'covered');
    const b = d.bodyOf(unit);
    if (b) b.crouched = false; // stand the body up (actors.js holds the pose)
    if (!quiet) d.log(`${nameOf(unit)} is out of cover.`);
  }
  // What shields a CELL, for the crouch: a prop a shot passes over (the M6a
  // height rule - one threshold decides both, so a prop can never block the
  // shot AND grant cover for it), or any body standing there. The take-cover
  // verb has always treated "any character as cover" (designer); this is that
  // rule with the special case taken out - a person is a shielding cell like
  // a filing cabinet is, and stops being one by walking away or falling over.
  // `exclude` keeps a croucher from shielding themselves.
  const coverCellFor = (...exclude) => (cx, cz) => {
    const def = d.world.tileDefAt(cx, cz);
    if (def && (!!def.cover || (!!def.solid && !d.blocksSight(def)))) return true;
    const u = d.unitStandingAt(cx, cz);
    return !!u && !exclude.includes(u) && d.standing(u);
  };
  // Which faces of the tile `unit` stands on are shielded, right now. Read
  // LIVE off the world on every consult - a partition that fell, a cabinet
  // that broke, a teammate who walked off - so nothing has to tell the crouch
  // its cover is gone.
  // `against` is the character ASKING - excluded from being cover, because
  // your own body cannot shield the person you are shooting at. Without it,
  // standing next to a croucher made you their cover from yourself: the shot
  // refused, and so did Pull Over, whose whole geometry is "be on the far
  // side of the thing they are behind".
  const crouchFacesOf = (unit, against = null) => {
    const b = d.bodyOf(unit);
    if (!b) return [];
    return d.shieldedFaces(b.x, b.z, {
      edgeOpen: d.world.stepOpen,
      coverCell: coverCellFor(unit, against),
    });
  };
  // The validated crouch, or null - the ONE owner of "is that cover still
  // real": the croucher still on the tile they tucked in at, still standing,
  // and still with at least one shielded face. Lazy on purpose: consulted at
  // every read instead of hooked into every way a fight can move things, so it
  // stays correct when a new displacement verb arrives. While the crouch holds
  // it re-applies the status chip, so the chip's nominal duration can never
  // outlive the rule or lapse under it.
  //
  // One test now instead of three. A destroyed cabinet, a toppled partition, a
  // shield who walked off or went down all fail the SAME way - the face they
  // were covering stops being shielded - and a crouch with no faces left is a
  // crouch behind nothing.
  function crouchStateOf(unit) {
    const s = d.crouched.get(unit);
    if (!s) return null;
    const b = d.bodyOf(unit);
    let ok = !!b && b.x === s.at.x && b.z === s.at.z && d.standing(unit);
    if (ok) {
      s.faces = crouchFacesOf(unit);
      ok = s.faces.length > 0;
    }
    if (!ok) { breakCrouch(unit); return null; }
    if (!d.hasStatus(carrierOf(unit), 'covered')) d.applyStatus(carrierOf(unit), 'covered');
    return s;
  }
  // What a single-target ranged shot at `defender` actually does: passes
  // untouched, is BLOCKED by a shielded face pointing the shooter's way, or
  // lands on the body holding that face instead.
  //
  // One branch now instead of three. The face pointing at the shooter is what
  // decides - which is why flanking still beats a crouch however many faces
  // are covered, and why breaking THAT face opens the shot without disturbing
  // the others.
  function shotOutcome(attacker, defender) {
    const a = d.posOf(attacker);
    return shotOutcomeFrom(attacker, defender, a.x, a.z);
  }

  // The same question asked from a tile the shooter is NOT standing on yet -
  // "if I walked there, would the shot land?". The ranged kit's destination
  // search needs it: range and a sightline do not model an object shield or a
  // colleague in the redirect, so a field built on those two alone offered
  // tiles that cannot fire (REVIEW.md 2026-08-02 section 1.6).
  function shotOutcomeFrom(attacker, defender, ax, az) {
    const s = crouchStateOf(defender);
    if (!s) return { target: defender };
    // Direction between the BODIES (DEGRID M4); the face-neighbour queries
    // stay on the defender's tile, where the faces live.
    const A = { x: ax, z: az };
    const D = d.posOf(defender);
    const Dt = d.bodyOf(defender);
    // Re-asked without the SHOOTER counting as cover (see crouchFacesOf).
    const face = shieldingFace(crouchFacesOf(defender, attacker), A.x, A.z, D.x, D.z);
    if (!face) return { target: defender };
    // A BODY on that face eats the shot; furniture and partitions refuse it.
    const holder = d.unitStandingAt(Dt.x + face[0], Dt.z + face[1]);
    if (holder && holder !== defender && d.standing(holder)) {
      return { target: holder, redirected: true };
    }
    return { target: null, blocked: { ...s, face } };
  }
  // What the refusal calls the thing doing the blocking - the thing on the
  // face that actually stopped THIS shot, not a mode name.
  const crouchLabel = (s) => {
    if (!s?.face) return 'cover';
    const [ox, oz] = s.face;
    const cx = (s.at?.x ?? 0) + ox;
    const cz = (s.at?.z ?? 0) + oz;
    const body = d.unitStandingAt(cx, cz);
    if (body) return nameOf(body);
    const def = d.world.tileDefAt(cx, cz);
    if (def && (def.cover || def.solid)) return (def.label || 'cover').toLowerCase();
    return 'partition'; // nothing on the cell, so the face itself is the wall
  };

  return {
    guardStandingAt,
    nameOf,
    carrierOf,
    breakCrouch,
    coverCellFor,
    crouchFacesOf,
    crouchStateOf,
    shotOutcome,
    shotOutcomeFrom,
    crouchLabel,
  };
}
