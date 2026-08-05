// THE COVER-DENIAL PLANS: each shared pure rule with combat's own side tests
// threaded in.
//
// A slice off `startCombat` (Q037), and the cheapest kind there is - every
// function here is an ADAPTER. The arithmetic already left this file for
// combat-plans.js and powers.js; what stayed behind is the half only combat can
// answer, which is which side a body is on. Gathering the adapters together is
// what makes that division visible: nine dependencies for eighty lines, and not
// one of them writes anything.
//
// Three of the threaded-in tests are decisions rather than plumbing:
//
//   - the AI's shove gate asks exactly what the resolver will BILL, for the body
//     it will bill it on. `displaceBody` charges `memberSurfDamage` through the
//     victim's OWN talents, so a gate reading the talent-free model priced a
//     landing at 6 that bills 0 for anyone in ESD Steel-Toes - and the ladder
//     then ranked shove above the swing.
//   - a RANGED unit may shove purely to break contact where a melee unit needs
//     the slam or the hazard (A4, Q047/Q075/Q094). Kiting is priced because
//     stepping out of reach provokes; the disengage shove is the one escape
//     that does not, because forced movement never provokes. Without it the
//     Executive stood in the scrum trading punches.
//   - the puller's own body is NOT "their cover is a person". A face shielded
//     by a partition can still have somebody on the neighbouring cell, and in a
//     corridor that somebody is whoever walked up to reach over the barrier -
//     counting them refuses exactly the haul-over-a-wall the verb exists for.
//
// `rangedLines` is read through a wrapper because it is declared below the call
// site in combat.js; these arrows only ever run at decide time, so the lookup
// happens long after. That was true before the cut and is why it was safe then.
import { REACH } from './stats.js';

export function createCoverDenialPlans(d) {
  const topplePlan = (from, px, pz) => {
    const b = d.bodyOf(from);
    return d.toppleplanAt(b.x, b.z, px, pz, d.world);
  };

  // The AI's version of the same question - the victim test is combat's,
  // because only combat knows which side a body is on.
  const memberAt = (x, z) => d.members.find((m) => m.sheet.hp > 0 && m.actor
    && m.actor.x === x && m.actor.z === z) || null;
  const aiTopplePlan = (unit) => d.aiToppleplanFor(unit.x, unit.z, d.world,
    (x, z) => !!memberAt(x, z));
  // The rest of the cover-denial plans (AI_PLAN M4), each the shared pure
  // rule with combat's own side tests threaded in. All of them are gathered
  // per-DECIDE and priced by chooseBeat, exactly as the summon and the
  // furniture topple always were.
  const aiEdgeToppleFor = (unit) => d.aiEdgeTopplePlanShared(unit.x, unit.z, d.world,
    (x, z) => !!memberAt(x, z));
  // displacePlan needs an `occupied` test the facade does not carry - the
  // player's shove builds its own too (the two-combatants-stacked trap).
  // Any standing body blocks the landing, both sides alike.
  const aiShovePlanFor = (unit) => d.aiShovePlanShared(unit.x, unit.z, {
    isWalkable: d.world.isWalkable,
    stepOpen: d.world.stepOpen,
    occupied: (x, z) => !!d.unitStandingAt(x, z),
  }, memberAt, {
    // Ask exactly what the resolver will BILL, for the body it will bill. The
    // victim of an AI shove is always a member (`memberAt`), and displaceBody
    // charges `memberSurfDamage` - through that member's own talents - so a
    // gate reading the talent-free model priced a landing at 6 that bills 0 for
    // anyone in ESD Steel-Toes, and the ladder ranks shove ABOVE the swing.
    //
    // The slip term is gone with it: displaceBody rolls no slip anywhere, so
    // "there is water behind them" used to admit a plan whose entire effect was
    // a one-tile reposition, traded for the unit's best beat.
    hazardAt: (x, z, victim) => d.world.memberSurfDamage(victim.sheet, x, z) > 0,
    // A4's one carve-out, ratified and until now unwired (Q047/Q075/Q094):
    // a RANGED unit may shove purely to BREAK CONTACT, where a melee unit
    // needs the slam or the hazard. Doctrine #11 is the reason - kiting is
    // priced (stepping out of reach provokes), and the disengage shove is the
    // one escape that does not, because forced movement never provokes (#9).
    // Without this the Executive stood in the scrum trading punches, which is
    // the opposite of what a shooter is for.
    //
    // `rangedLines` is the same predicate `aiAdvance` and `aiBeatPlans`
    // already mean by "the ranged kit", so kit-hood does not get a second
    // definition here. It is declared below this one, which is safe because
    // this arrow only ever runs at decide time.
    disengage: d.rangedLines(unit).length > 0,
    // The same reach the player's shove is gated on.
    reaches: (victim) => d.canReach(unit, victim, REACH.SHOVE),
  });
  const aiPullPlanFor = (unit) => d.aiPullPlanShared(
    unit,
    d.members.filter((m) => d.standing(m)),
    (m) => {
      const s = d.crouchStateOf(m);
      return s && { ...s, faces: d.crouchFacesOf(m, unit) };
    },
    {
      stepOpen: d.world.stepOpen,
      open: (x, z) => d.world.isWalkable(x, z) && !d.unitStandingAt(x, z),
      // The puller's own body is NOT "their cover is a person" - the same
      // exclusion the player's wiring makes (`u !== active`), and it is not
      // optional. A face shielded by a PARTITION can still have somebody
      // standing on the neighbouring cell, and in a corridor that somebody is
      // whoever walked up to reach over the barrier. Counting them refuses
      // exactly the haul-over-a-wall the verb was written for.
      bodyAt: (x, z) => {
        const u = d.unitStandingAt(x, z);
        return !!u && u !== unit && d.standing(u);
      },
      // Per candidate, because this walks the whole standing roster - the
      // player's twin names one target once (pullPlanned) and cannot.
      nameOf: d.nameOf,
    },
  );
  const aiBreakPlanFor = (unit, target) => d.aiBreakPlanShared(
    unit.x, unit.z, target.actor.x, target.actor.z,
    { ...d.world, doorsBeside: d.world.doorsBeside });

  return {
    topplePlan,
    memberAt,
    aiTopplePlan,
    aiEdgeToppleFor,
    aiShovePlanFor,
    aiPullPlanFor,
    aiBreakPlanFor,
  };
}
