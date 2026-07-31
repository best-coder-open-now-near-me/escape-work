// Tactical combat - Baldur's Gate style, on the map. No more modal duel:
// combat happens where you stand. Each side takes turns spending Action
// Points; movement is free-form and priced by DISTANCE - 1 AP per tile-length
// along the smoothed route (double through sticky coffee), stopping at any
// point (not just a tile centre) when the budget runs out. Hovering the floor
// previews the route and its cost. Actions carry their own AP costs
// (data/actions.js). Melee needs adjacency (clicking a far enemy walks you in
// first), thrown weapons need range and line of sight. Nearby enemies join
// the fight; enemies have persistent map HP and take surface damage like you
// do. Fire keeps burning throughout.
import { ACTIONS, arrivalLine, summonSpec } from './data/actions.js';
import { SURFACES } from './data/surfaces.js';
import { truncateByBudget, routeToFiringPosition, trimToFirst } from './pathfinding.js';
import { pronounsOf, capitalize, verb } from './creation.js';
import { createSheetFrom, damageBonus, applyDamage, deflect, statusResist, hitChance, rollHit, accuracy, dodge, equippedAction, orderedActionIds, weaponProc, moveCostOf, reachOf, rangeOf, ammoCostOf as ammoCost, effectiveAttr, gritSaveChance, MOVE, REACH } from './stats.js';
import { applyStatus, hasStatus, statusFx, clearStatuses, removeStatus, statusList, blockedBy, statusSeverity } from './statuses.js';
import { toHitTerms, provokedBy, positionMods, inReach, dist, crouchShields, hasCover, shieldedFaces, TACTICS } from './tactics.js';
import {
  buffProblem, buffOutcome, buffRangeOf, isFriendly, controlProblem, controlOutcome, controlIsRanged, isControl, isZone, zoneProblem, zoneTiles, zoneRadiusOf, zoneRangeOf, isMobility, aimsAtAlly, mobilityProblem, mobilityRangeOf, dashDistanceOf, isStance, watchRadiusOf, watchTriggers, isToppleable, aimsAtAnyone, isPurge, coneFrom, conePolyline, aimRangeOf, rangeTiles, isBreakable, aimsAtProps, isPull,
} from './powers.js';
import { createAimPaint } from './aim-paint.js';
import { STATUSES } from './data/statuses.js';
import { blocksSight, PARTITION_TOPPLE } from './data/tiles.js';
import { PANEL_CHROME, createCombatReadout, apPips } from './ui.js';
import { createTurnOrder } from './turn-order.js';
import { slips, speedUnderStatus } from './step-rules.js';
import {
  topplePlan as toppleplanAt, aiTopplePlan as aiToppleplanFor, breakPlan,
  pullPlan as pullplanFor, displacePlan,
} from './combat-plans.js';
import {
  standTilePath as standTileRoute, pickTarget as pickBest, advanceRoute,
  aiCrouchCovered, chooseBeat, afterFailedAdvance,
} from './combat-ai.js';
import {
  enemyRingOk, ringsAtBodies, verbKind, toppleRings, partitionRings, breakRings,
} from './combat-targeting.js';
import { summonSpotProblem as spotProblem } from './summon-rules.js';
import {
  cheb, TARGET_R, SURPRISE_RADIUS, AROUND, ORTHO, reachOfUnit, posOf, withinReach,
  canReach as canReachAt, reachSpecOf, actRangeOf, verbReaches as verbReachesAt,
  swingPointAt as swingPointFrom, hasSwingSpot as hasSwingSpotFor, zoneCellsFor,
} from './combat-geometry.js';

const pc = window.pc;
// Inclusive integer roll. Takes its randomness as an ARGUMENT rather than
// reading Math.random, because a module-scope read is unreachable from the
// injected `rng` - which meant damage was the one part of a resolution a seeded
// test could not pin, and so the whole roll -> damage -> status chain could
// only ever be tested a piece at a time.
const randWith = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

// The narration when a landed hit applies a status: an explicit per-attack/
// action line if given, else the status's own {name}-templated log, else a
// bare fallback naming it.
const appliesLine = (src, name) => {
  if (src.appliesLog) return src.appliesLog;
  const def = STATUSES[src.applies];
  return def?.log ? def.log.replace('{name}', name) : `${def?.name || 'A status'} sets in.`;
};

// The counterpart for a status TURNED AWAY by a live anti-chain window
// (statuses.js). The bound is only fair if the player can watch it work - on
// their target and on themselves alike - so a stun that doesn't land says why
// instead of silently doing nothing. `id` is the blocking window's id, from
// blockedBy.
const immunityLine = (id, name) => {
  const def = STATUSES[id];
  return def?.log ? def.log.replace('{name}', name) : `${def?.name || 'An immunity'} holds.`;
};

export function startCombat({ app, party, engaged, world, fx, callbacks, opening = null, allies = [], preCrouch = null, rng = Math.random }) {
  // Per-member turn state: every party member fights with their own AP pool,
  // deflect stance and limited-use counters. `active` is whose action bar,
  // previews and clicks are live - with one member that is simply "you";
  // switching mid-fight arrives with the party bar.
  const asMember = (rec, extra) => {
    const usesLeft = {};
    // The equipped weapon's own swing joins the bar without being in the
    // sheet's list, so it is seeded here too - otherwise a rationed weapon
    // attack would read as unlimited.
    for (const id of [...rec.sheet.actions, equippedAction(rec.sheet)]) {
      if (ACTIONS[id]?.uses) usesLeft[id] = ACTIONS[id].uses;
    }
    return { sheet: rec.sheet, actor: rec.actor, ap: rec.sheet.maxAp, usesLeft, ...extra };
  };
  const members = party.members.map((m) => asMember(m));
  // Summons still standing from an EARLIER fight (they outlive it now - main.js
  // keeps them until their assignment runs out) walk back in as the temporary
  // members they already were: same sheet, same body, whatever turns they have
  // left. They enter after the real roster, so party.active still indexes right.
  for (const s of allies) {
    // Carrying the summoner in with them is what keeps the live cap honest
    // across fights: counted as summonedBy: null, two applicants who survived
    // the last fight were invisible to the cap check and their summoner could
    // post a full new batch on top of them.
    if (s.sheet.hp > 0 && s.actor) {
      members.push(asMember(s, { isSummon: true, summonedBy: s.summonedBy || null }));
    }
  }
  let active = members[party.active];
  // Which deal the confused action bar is on. Declared up here with the rest of
  // the turn state because the turn engine's `turnStart` hook bumps it, and
  // that closure is built long before the action bar itself (`scrambled`).
  let scrambleTurn = 0;
  // Everyone you control: party members plus any summons you've conjured
  // (temporary members, appended by resolveSummon). `livingParty` is the real
  // roster only - a party WIPE (no real member standing) is the sole game-over;
  // a summon falling never is, and a lone summon can't stave off defeat.
  // Every damage roll in this fight, bound to the injected rng.
  const rand = (lo, hi) => randWith(rng, lo, hi);
  const livingMembers = () => members.filter((m) => m.sheet.hp > 0 && m.actor);
  // --- charm (TODO Phase 8) -------------------------------------------------
  // Borrow a coworker: they leave their own side, take their turns under your
  // control, and are handed back intact when the session drops.
  //
  // There is no allegiance FLAG in this engine - sides are inferred from shape
  // (`!!x.sheet`), because members and summons carry a sheet and units do not.
  // That looked like the obstacle and turned out to be the answer: a player-side
  // summon is not an AI unit with a friendly bit set, it is pushed into
  // `members` with a sheet, so it already takes a normal player turn with its
  // own action bar and AP. Charm borrows into machinery that already exists.
  //
  // The one thing that genuinely had to be built is `turns.replace`: a slot's
  // team is fixed at creation and `insert` had no inverse, so the first attempt
  // left a borrowed coworker being driven by the AI against you while sitting in
  // your party. `replace` swaps the slot in place, keeping its initiative - the
  // same body acts at the same moment, only whose it is changes.
  function charmUnit(unit, turnsLeft) {
    if (!unit?.alive || unit.charmed) return false;
    // An enemy def is NOT a class block: it carries `attacks` (inline damage
    // rolls the AI reads) where a sheet needs `actions` (ids the bar renders).
    // So a borrowed body gets a synthesized block, and what it can DO is the
    // universal verbs - which is the honest answer anyway. You are driving
    // somebody you do not know: you can move them and swing them, not perform
    // their training.
    const sheet = createSheetFrom({
      name: unit.def.name,
      model: unit.def.model,
      maxHp: Math.max(1, unit.maxHp ?? unit.hp),
      ap: unit.def.ap ?? 4,
      bonusDmg: 0,
      attr: unit.def.attr,
      actions: ['punch', 'shove'],
      talent: null,
    }, { charmedFrom: unit.archetypeId || null });
    sheet.hp = unit.hp; // they arrive as hurt as you left them
    const m = asMember({ sheet, actor: unit }, { isCharmed: true, unit });
    // The lifetime rides the field a summon's does, so the turn engine ages it
    // with no second clock to keep in step. The ENDINGS differ, not the clock.
    unit.summonTurns = turnsLeft;
    members.push(m);
    turns.replace((slot) => slot.unit === unit, memberSlot(m));
    world.setCharmed?.(unit, true); // out of liveEnemies: their side turns on them
    refresh();
    return true;
  }

  // Hand a borrowed coworker back. Reached three ways - the session lapsing,
  // the fight ending, and them dying mid-session - and all three have to leave
  // the roster and the order in a state the rest of the engine understands.
  function releaseCharm(m) {
    const unit = m.unit;
    const i = members.indexOf(m);
    if (i >= 0) members.splice(i, 1);
    if (unit) {
      unit.summonTurns = undefined;
      unit.hp = Math.max(0, m.sheet.hp); // whatever happened to them, happened
      if (!unit.hp) unit.alive = false;
      world.setCharmed?.(unit, false);
      removeStatus(unit, 'charmed');
      // Back to their own side, in the same place in the round.
      turns.replace((slot) => slot.member === m, unitSlot(unit));
    }
    // The floor cannot be held by somebody who just left it - the same handoff
    // dismissSummon makes when an assignment lapses mid-turn.
    if (active === m) makeActive(livingParty()[0] || members[0]);
    refresh();
  }

  const charmedMembers = () => members.filter((m) => m.isCharmed);

  // Is anyone still FIGHTING you? The victory test, in one place.
  //
  // It was `!engaged.some((e) => e.alive)` written out at seven call sites, and
  // seven copies of a rule is seven chances for one of them to fall behind the
  // others. Charm makes that concrete: a charmed coworker is alive and engaged
  // but is on YOUR side for the moment, so a fight whose last hostile is
  // charmed must not sit unwinnable - and a fight must not declare victory
  // while one is still borrowed either. One function is where that decision
  // can be made once.
  // A BORROWED coworker still counts. Charming the last hostile must not win
  // the fight: they are still your opponent, just not acting against you for a
  // few turns, and the session drops long before the run does. Counting them as
  // gone made charm a win button - 3 AP to end an encounter outright - which is
  // strictly better than killing anybody and would have been the correct play
  // every time.
  const hostilesRemain = () => engaged.some((e) => e.alive);
  // The party proper: not summons, and not anyone merely BORROWED. A charmed
  // coworker standing while your whole roster is face down is not a party that
  // is still going - the run has ended, you are just driving somebody else for
  // another turn or two.
  const livingParty = () =>
    members.filter((m) => m.sheet.hp > 0 && m.actor && !m.isSummon && !m.isCharmed);
  // The AI enemies hunt the whole player side - members and summons alike, all
  // members now. A target wraps { actor, member }; combat reads `member` to take
  // the hit on its sheet (deflect, gum, the downed rules).
  // The route to a tile the unit could stand on and swing from: the shortest
  // path to any of the target's eight neighbours, or null if none is reachable.
  // Shared by pickTarget and aiAdvance so the two can never disagree about who
  // is engageable - if the target picker says yes, the mover must find a route.
  const standTilePath = (unit, target) =>
    standTileRoute(unit.x, unit.z, target.actor.x, target.actor.z, world);

  // Can this unit actually FIGHT that member - reach it now, or walk to a tile
  // it could swing from?
  //
  // Memoized, and that is not an optimisation detail: pickTarget runs on the
  // PER-FRAME driver (see update), and standTilePath is up to eight A* searches
  // per member. Paying that every frame of every AI turn is a real frame-rate
  // cost, and it is one this revision introduced - before reach became a
  // distance, picking a target was pure arithmetic. It cost enough on CI's
  // software GL to push combat tests past their timeouts.
  //
  // The key is exactly what the answer depends on: both bodies' tiles. Cleared
  // at the top of every turn (beginTurn), so an opened door or a destroyed prop
  // can never leave a stale "unreachable" behind for longer than one turn -
  // within a turn the only thing moving is the unit itself, and its tile is in
  // the key.
  const engageMemo = new Map(); // "ux,uz|mx,mz" -> boolean
  function canEngage(unit, m) {
    const key = `${unit.x},${unit.z}|${m.actor.x},${m.actor.z}`;
    const memo = engageMemo.get(key);
    if (memo !== undefined) return memo;
    // Cheap test first: already in reach needs no pathfinding at all.
    const val = canReach(unit, m) || !!standTilePath(unit, m);
    engageMemo.set(key, val);
    return val;
  }

  // Nearest living member - but ENGAGEABLE first. Once a partition blocks a
  // swing (M3), the closest member by distance can be one the unit can neither
  // reach nor walk to: on the far side of a cubicle wall with the way round
  // sealed. Targeting them means walking to the wall and swinging at nothing,
  // every turn, forever. So a member the unit can actually fight outranks a
  // nearer one it cannot, and distance only breaks ties within each group.
  const pickTarget = (unit) =>
    pickBest(unit.x, unit.z, livingMembers(), (m) => canEngage(unit, m));

  // Enemies pulled in from a distance are surprised - they spend their first
  // turn realizing what's happening, so group openings don't alpha-strike you.
  for (const en of engaged) {
    const t = pickTarget(en);
    if (!t || cheb(en.x, en.z, t.actor.x, t.actor.z) > SURPRISE_RADIUS) applyStatus(en, 'surprised');
  }
  // A bystander outside the engagement radius who gets attacked anyway joins
  // the fight - surprised, so they lose the turn they spend taking offense.
  // Without this they'd soak thrown damage forever without ever hitting back.
  function joinCombat(en) {
    if (engaged.includes(en)) return;
    engaged.push(en);
    applyStatus(en, 'surprised');
    insertSlot(unitSlot(en)); // takes an initiative slot; surprised, so loses turn one
  }
  // world: { isWalkable, findPath(sx,sz,tx,tz), hasLos(ax,az,bx,bz),
  //          stepOpen(x,z,nx,nz), surfaceIdAt(x,z), enemySurfDamage(x,z) }
  // fx:    { projectile(from,to,kind), damageText(x,z,text,color) } - cosmetic
  // callbacks: { say, updateHud, onRound, onEnemyKilled(en), onWin, onLose }
  const talentFxOf = (m) => m.sheet.talent?.effects || {};
  // --- the movement allowance (MOVEMENT_PLAN M2, "the Pawn") -----------------
  // A talent may grant AP that ONLY movement can spend. It is drawn from first,
  // so a reposition stops competing with a swing; once it is dry a long walk
  // falls through to real AP and costs what it always did. Works for a member
  // (talent on the sheet) or an AI unit (talent on its def), so an enemy
  // archetype can carry it too.
  const freeMoveOf = (u) => (u.sheet
    ? (u.sheet.talent?.effects?.freeMoveAp || 0)
    : (u.def?.talent?.effects?.freeMoveAp || 0));
  // Bill `cost` against a { freeAp, ap } pair, allowance first. Returns what
  // came out of real AP. truncateByBudget only ever needs a TOTAL, so the split
  // happens here rather than inside the sampler.
  const billMove = (holder, cost) => {
    const fromFree = Math.min(holder.freeAp || 0, cost);
    holder.freeAp = roundAp((holder.freeAp || 0) - fromFree);
    const fromAp = roundAp(cost - fromFree);
    holder.ap = Math.max(0, roundAp(holder.ap - fromAp));
    return fromAp;
  };
  // A ROOT zeroes the movement budget (POWERS_PLAN M2). This is the one place
  // both sides price movement through - the player's click, the route preview,
  // and the AI's advance all reach it - so one line binds a rooted member and
  // a rooted coworker identically. `holder` is a member ({sheet}), the AI's
  // working turn state ({unit}), or a bare unit.
  const rootedNow = (holder) => !!statusFx(holder.sheet || holder.unit || holder).rooted;
  const moveBudget = (holder) => (rootedNow(holder)
    ? 0
    : Math.max(0, (holder.freeAp || 0) + holder.ap));
  const throwableIds = Object.keys(ACTIONS).filter((id) => ACTIONS[id].ammoCost);
  // A throwable can be gated behind a talent effect (`needsTalent`): folding a
  // dart that lands in someone's eye is a craft, so paper airplanes belong to
  // the Origami Specialist. Anyone can crumple a wad.
  const throwablesFor = (m) => throwableIds.filter((id) => {
    const need = ACTIONS[id].needsTalent;
    return !need || !!(m.sheet.talent?.effects || {})[need];
  });
  // Everyone can shove - it's an office, not a fencing academy - and everyone
  // has a basic weapon swing (the equipped weapon's, or bare-handed 'punch').
  // In the canonical order (stats.orderedActionIds), the same one the
  // out-of-combat hotbar renders: the basic swing, shove, throws, class powers,
  // what a talent granted, what is in hand. The two bars showing one kit in two
  // different orders is a tax paid mid-fight, when there is least attention to
  // spare for re-reading a row of buttons.
  const actionIdsOf = (m) => orderedActionIds(
    m.sheet, [...m.sheet.actions, equippedAction(m.sheet), 'shove', 'take-cover', 'pull', ...throwablesFor(m)],
  );
  // The acting member's cost for a throw - the shared rule (stats.js), bound to
  // whoever currently has the floor.
  const ammoCostOf = (id) => ammoCost(active.sheet, id);
  // An AI unit's walk speed, DERIVED from its live statuses against a base
  // remembered once - the way a member's is (main.js `memberSpeed`).
  //
  // Gum used to be multiplied into `unit.speed` in place when it landed, which
  // nothing could undo: the player's reboot cleared the status but left the
  // limp, so the coworker walked at 0.6x for the rest of the fight with no
  // status to explain it - and the `!hasStatus` guard then let a SECOND wad
  // multiply it again, down to 0.36x on one gum status.
  const syncUnitSpeed = (u) => {
    if (!u) return;
    if (u.baseSpeed === undefined) u.baseSpeed = u.speed;
    u.speed = speedUnderStatus(u.baseSpeed, statusFx(u));
  };
  // A debug/test pin (exposed as window.__combat.forceHit): true forces every
  // roll to hit, false forces a miss, null (the default) rolls honestly. It
  // lets the e2e suite make combat deterministic and a tester slam hit rates
  // live - the same "pin a value" affordance the god panel gives other state.
  let forceHit = null;
  let forceProc = null; // pin for the weapon on-hit proc roll (debug/e2e)
  let lastRoll = null; // { chance, hit } of the most recent attack roll (debug/e2e)
  // One attack roll (HIT_PLAN.md): base + attacker accuracy - defender dodge +
  // mods, rolled against combat's injectable `rng` (unless pinned above). The
  // computed chance and outcome are stashed on `lastRoll` for the debug surface.
  const resolveHit = (accFrac, dodgeFrac, mods = 0) => {
    const chance = hitChance(accFrac, dodgeFrac, mods);
    const hit = forceHit !== null ? forceHit : rollHit(chance, rng);
    lastRoll = { chance, hit };
    return hit;
  };
  // A combatant here is either a party-side MEMBER ({ sheet, actor, ap }) or
  // an AI UNIT (an actor carrying `def`). These three accessors are the only
  // place that difference matters, which lets the roll math below stay
  // uniform - and lets an enemy and a member be attacker or defender
  // interchangeably. Statuses live on a member's sheet, but on a unit itself.
  const statusesOf = (u) => u.sheet || u;
  const accuracyOf = (u) => (u.sheet ? accuracy(u.sheet) : (u.combat?.accuracy || 0));
  const dodgeOf = (u) => (u.sheet ? dodge(u.sheet) : (u.combat?.dodge || 0));
  // Reach joins them - but as hoisted FUNCTION declarations, not the const
  // arrows the three above use. pickTarget is called eagerly during
  // startCombat (the surprise sweep, well before this point in the body), and
  // it now needs canReach: a const here would sit in its temporal dead zone
  // and throw ReferenceError mid-setup, starting a fight whose panel never
  // gets built. Functions hoist, so call order stops mattering.

  // Reach, position and the melee predicate all live in combat-geometry.js
  // now; this binds the world's edge test so every call site keeps asking the
  // one-argument question it always asked. Still a hoisted `function` for the
  // reason above - the surprise sweep reaches it before this line runs.
  function canReach(attacker, defender, r = null) {
    return canReachAt(attacker, defender, r, world.stepOpen);
  }

  // The to-hit terms for one attacker/defender pair (TACTICS_PLAN #1). THE
  // single place the terms are assembled: every roll site and the hover
  // preview read it, so the percentage the player sees is always the
  // arithmetic the roll actually uses. `positional` (cover/flank/backstab)
  // plugs in here in later milestones and reaches all four sites at once.
  // `plan` (optional) is a continuous point the attacker WOULD act from - the
  // walk-in preview's planned stand point. The odds it shows must be priced
  // from where the swing will actually happen: cover, flank and the
  // melee/ranged split all move with the attacker, and a percentage computed
  // from the tile being LEFT is a lie about the attack being promised.
  const attackMods = (attacker, defender, plan = null) => {
    // Position is a per-PAIR term - it depends on where the other one stands,
    // so it is computed at roll time and never cached on a unit.
    const A = plan ? { x: Math.round(plan.x), z: Math.round(plan.z) } : bodyOf(attacker);
    const D = bodyOf(defender);
    const dp = plan ? posOf(defender) : null;
    // The attacker's own side, minus itself: a pincer needs a second body.
    const allies = (attacker.sheet ? members : engaged)
      .filter((u) => u !== attacker && standing(u))
      .map((u) => ({ x: bodyOf(u).x, z: bodyOf(u).z }));
    const pos = positionMods(A.x, A.z, D.x, D.z, {
      // Cover/flank/backstab geometry stays on TILE octants - a cover face and
      // a pincer are genuinely grid-shaped. Only the melee/ranged SPLIT moves
      // to real distance, and it reads reach without the line test so turning
      // walls on (M3) can't silently change who gets cover.
      melee: plan
        ? inReach(plan.x, plan.z, dp.x, dp.z, reachOfUnit(attacker))
        : withinReach(attacker, defender),
      edgeOpen: world.stepOpen,
      // A toppled prop shields the tile behind it (POWERS_PLAN M7). Note this
      // rides the same `!melee` gate as every other cover: a fallen cabinet
      // spoils SHOTS, not swings, and a melee attacker walks around it. That
      // is deliberate - it makes toppling a specific counter to throwers
      // rather than a universal answer.
      // ...and so does a teammate holding a GUARD stance, because a body
      // planted on the face between you and the shooter is doing exactly what
      // a toppled cabinet does (POWERS_PLAN M5's deferred `guard` mode). This
      // is why the cell predicate was the right shape: "does the thing
      // standing here shield the defender?" answers both without a second
      // mechanism, and it inherits the ranged-only rule and the
      // at-most-once-per-attack rule for free.
      // ...and since TACTICS_PLAN M6a, so does any STANDING solid a shot can
      // pass over: the same height rule that lets the shot sail over a desk
      // (grid.sightOpenCell) says the desk shields whoever crouches behind it.
      // One threshold decides both, so a prop can never block the shot AND
      // grant cover for it.
      coverCell: (x, z) => {
        const d = world.tileDefAt(x, z);
        return !!d && (!!d.cover || (!!d.solid && !blocksSight(d))) || guardStandingAt(x, z);
      },
      allies,
      facing: facings.get(defender) || null,
    });
    return {
      ...toHitTerms({
        accuracy: accuracyOf(attacker),
        dodge: dodgeOf(defender),
        surprised: hasStatus(statusesOf(defender), 'surprised'),
        accMod: statusFx(statusesOf(attacker)).accMod || 0,
        dodgeMod: statusFx(statusesOf(defender)).dodgeMod || 0,
        positional: pos.positional,
      }),
      covered: pos.covered, // for the hover tag's reason string
      flanked: pos.flanked,
      behind: pos.behind,
    };
  };
  // (There was a `chanceFor` helper here that claimed to be "what the hover tag
  // reads". Nothing called it - the tag needs the whole term set, not just the
  // number, so it goes through `attackMods` directly like the roll does. A dead
  // helper describing itself as the live one is a trap: the next edit to it
  // would have changed nothing and looked like it changed the preview.)
  // Roll that attack (honors the forceHit pin, records lastRoll).
  const rollAgainst = (attacker, defender) => {
    const t = attackMods(attacker, defender);
    return resolveHit(t.acc, t.dodge, t.mods);
  };
  // A weapon's on-hit proc chance, honoring the debug pin.
  const resolveProc = (chance) => (forceProc !== null ? forceProc : rollHit(chance, rng));
  const MISS_COLOR = '#b8c0d0';

  // --- the FX vocabulary ------------------------------------------------------
  // Combat's cosmetics all route through these four, so a swing that lands in
  // three different code paths (a turn attack, an opportunity swing, a cone)
  // looks the same in all of them. Every one of them is fire-and-forget - the
  // fight has already resolved by the time a particle exists (fx.js).
  //
  // Hits land on the BODY, not the tile centre: posOf is the continuous
  // position everything else in this file measures against, and a spark
  // pluming from a tile centre while the model stands half a tile away reads
  // as a miss that dealt damage.
  const hitFx = (target, kind = 'melee', from = null) => {
    const p = posOf(target);
    let dir = null;
    if (from) {
      const a = posOf(from);
      const dx = p.x - a.x;
      const dz = p.z - a.z;
      const d = Math.hypot(dx, dz) || 1;
      dir = { x: dx / d, z: dz / d }; // debris flies away from the attacker
    }
    fx.impact(p.x, p.z, kind, { dir });
  };
  // A status landing is worth seeing on the body it landed on - buffs bloom
  // upward off the feet, debuffs fall onto the head (data/statuses.js `fx`).
  const statusFxAt = (carrier, id) => {
    const p = posOf(carrier);
    fx.status(p.x, p.z, id);
  };
  // Somebody hits the carpet: debris, blood, and the smallest jolt the camera
  // is willing to give a death.
  const deathFx = (target) => {
    const p = posOf(target);
    fx.impact(p.x, p.z, 'death', { y: 0.7 });
    fx.shake(0.07, 0.22);
  };
  // What the floor of a tile throws when it hurts somebody standing on it.
  const hazardKind = (x, z) => {
    if (world.isElectrified && world.isElectrified(x, z)) return 'zap';
    const surf = world.surfaceIdAt(x, z);
    if (surf === 'fire') return 'fire';
    if (surf === 'paper') return 'paper';
    if (surf === 'cable') return 'zap';
    return 'slam';
  };
  // Movement cost per unit distance, derived from the surface's `slow`
  // multiplier (0.5 => twice the AP) - one number in data drives both walk
  // speed and AP pricing, for everyone. Gum on a shoe surcharges every step;
  // a member's gum lives on their sheet, an AI unit's on the actor (see
  // aiAdvance).
  // AP per tile: the base rate, then the surface's own drag. A `slow` surface
  // multiplies the cost (coffee at slow 0.5 costs double), so terrain bites
  // proportionally harder now that the base is cheaper - which is the point,
  // per MOVEMENT_PLAN #7.
  const surfaceStepCost = (x, z) => {
    const slow = SURFACES[world.surfaceIdAt(x, z)]?.slow;
    return MOVE.COST_PER_TILE * (slow ? 1 / slow : 1);
  };
  const stepCost = (x, z) => surfaceStepCost(x, z)
    * (statusFx(active.sheet).moveCostMult ?? 1)
    * moveCostOf(active.sheet); // footwear (MOVEMENT_PLAN M4)
  // AP is spent in tenths now that movement charges by distance.
  const roundAp = (v) => Math.round(v * 10) / 10;
  const fmtAp = (v) => String(roundAp(v)).replace(/\.0$/, '');

  // Proper per-unit initiative (initiative.js): ONE interleaved order for the
  // whole fight, not side-phases. `phase` now only says who's driving the
  // CURRENT turn: 'player' (a party member you control) | 'ai' (an enemy or a
  // player-team summon the AI drives) | 'done'.
  let phase = 'player';
  // Nothing is pre-aimed: arm an attack/shove, THEN pick a target. While
  // armed, hover switches from the movement trail to target rings.
  let armed = null;
  let pendingConfirm = null; // an instant self-action awaiting its second click
  let pendingMelee = null; // { en, action } to strike when the walk-up completes
  let pendingCrouch = null; // { tx, tz, spot } to tuck in when the walk-up completes
  let acting = null; // the AI unit's working turn state: { unit, ap, wait }
  // EVERY instant self-cast takes a confirm click - the stances (Deflect,
  // Return to Sender) and every heal (Coffee, Espresso, Energy Drink, Snack
  // Cart, the smoke break). They all used to commit the moment you touched the
  // button, so a stray click could spend a turn's AP with nothing to undo it.
  // Targeted actions already worked this way: arm, then commit. Right-click
  // backs out of either. (Summons are targeted now - you pick the spot - so
  // they arm like an attack instead of confirming in place.)
  const INSTANT_CONFIRM = new Set(['defend', 'heal', 'stance']);
  // Who is holding an overwatch right now: combatant -> the action id they
  // took it with (POWERS_PLAN M5). A stance lasts until the holder's OWN next
  // turn, so it is cleared in beginTurn rather than on a timer - "until your
  // next turn" is a position in the initiative order, not a duration, and
  // giving it a tick count would desynchronise the two the moment a joiner
  // was inserted mid-round.
  const watching = new Map();
  // Is somebody holding a `guard` stance on this exact tile? Read by the cover
  // predicate, so a planted teammate shields the face they stand on.
  const guardStandingAt = (x, z) => {
    for (const [holder, actionId] of watching) {
      if (ACTIONS[actionId]?.mode !== 'guard') continue;
      const b = bodyOf(holder);
      if (b && b.x === x && b.z === z && standing(holder)) return true;
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
  const crouched = new Map();
  const nameOf = (u) => (u.sheet ? u.sheet.name : u.def.name);
  const carrierOf = (u) => u.sheet || u;
  function breakCrouch(unit, quiet = false) {
    if (!crouched.delete(unit)) return;
    removeStatus(carrierOf(unit), 'covered');
    const b = bodyOf(unit);
    if (b) b.crouched = false; // stand the body up (actors.js holds the pose)
    if (!quiet) log(`${nameOf(unit)} is out of cover.`);
  }
  // What shields a CELL, for the crouch: a prop a shot passes over (the M6a
  // height rule - one threshold decides both, so a prop can never block the
  // shot AND grant cover for it), or any body standing there. The take-cover
  // verb has always treated "any character as cover" (designer); this is that
  // rule with the special case taken out - a person is a shielding cell like
  // a filing cabinet is, and stops being one by walking away or falling over.
  // `exclude` keeps a croucher from shielding themselves.
  const coverCellFor = (...exclude) => (cx, cz) => {
    const d = world.tileDefAt(cx, cz);
    if (d && (!!d.cover || (!!d.solid && !blocksSight(d)))) return true;
    const u = unitStandingAt(cx, cz);
    return !!u && !exclude.includes(u) && standing(u);
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
    const b = bodyOf(unit);
    if (!b) return [];
    return shieldedFaces(b.x, b.z, {
      edgeOpen: world.stepOpen,
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
    const s = crouched.get(unit);
    if (!s) return null;
    const b = bodyOf(unit);
    let ok = !!b && b.x === s.at.x && b.z === s.at.z && standing(unit);
    if (ok) {
      s.faces = crouchFacesOf(unit);
      ok = s.faces.length > 0;
    }
    if (!ok) { breakCrouch(unit); return null; }
    if (!hasStatus(carrierOf(unit), 'covered')) applyStatus(carrierOf(unit), 'covered');
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
    const s = crouchStateOf(defender);
    if (!s) return { target: defender };
    const A = bodyOf(attacker);
    const D = bodyOf(defender);
    // Re-asked without the SHOOTER counting as cover (see crouchFacesOf).
    const face = shieldingFaceFrom(crouchFacesOf(defender, attacker), A.x, A.z, D.x, D.z);
    if (!face) return { target: defender };
    // A BODY on that face eats the shot; furniture and partitions refuse it.
    const holder = unitStandingAt(D.x + face[0], D.z + face[1]);
    if (holder && holder !== defender && standing(holder)) {
      return { target: holder, redirected: true };
    }
    return { target: null, blocked: { ...s, face } };
  }
  // The shielded face pointing at the attacker, or null. A diagonal attacker
  // is blocked by either of the two faces their way; when both are shielded
  // the x face answers first, which only matters for naming the blocker.
  function shieldingFaceFrom(faces, ax, az, dx, dz) {
    const sx = Math.sign(ax - dx);
    const sz = Math.sign(az - dz);
    if (sx === 0 && sz === 0) return null;
    return (faces || []).find(([ox, oz]) =>
      (sx !== 0 && ox === sx && oz === 0) || (sz !== 0 && oz === sz && ox === 0)) || null;
  }
  // What the refusal calls the thing doing the blocking - the thing on the
  // face that actually stopped THIS shot, not a mode name.
  const crouchLabel = (s) => {
    if (!s?.face) return 'cover';
    const [ox, oz] = s.face;
    const cx = (s.at?.x ?? 0) + ox;
    const cz = (s.at?.z ?? 0) + oz;
    const body = unitStandingAt(cx, cz);
    if (body) return nameOf(body);
    const d = world.tileDefAt(cx, cz);
    if (d && (d.cover || d.solid)) return (d.label || 'cover').toLowerCase();
    return 'partition'; // nothing on the cell, so the face itself is the wall
  };
  // Back out of whatever is armed or awaiting confirmation. RIGHT-CLICK does
  // this from anywhere; a left click never cancels (it reports an invalid
  // target instead), so aiming can't be lost by a near-miss.
  function cancelArmed(quiet = false) {
    const was = armed || pendingConfirm;
    armed = null;
    pendingConfirm = null;
    aimPoint = null;
    if (was && !quiet) log(`You lower the ${ACTIONS[was].label.toLowerCase()}.`);
    return !!was;
  }

  // --- initiative order --------------------------------------------------------
  // A slot wraps one combatant: `{ member }` (player-controlled) or `{ unit }`
  // (an AI actor - enemy or player-team summon). initiative.js rolls d20 +
  // `initMod` and sorts them; turn-order.js walks the result.
  // Initiative rolls off the SAME injected source as everything else, so one
  // seed reproduces a whole fight rather than most of one.
  const initRng = () => rng();
  // Hustle through `effectiveAttr`, like every other attribute-derived number:
  // gear `attrBonus` flows through EVERY derivation (EQUIPMENT_PLAN #3), and
  // reading the raw attr here meant a +1 Hustle lanyard lifted your AP and your
  // dodge but not the roll that decides when you act - while the identical +1
  // from a class-track node, baked into `attr`, did.
  const memberSlot = (m) => ({ member: m, team: 'player', initMod: effectiveAttr(m.sheet).hustle ?? 0 });
  // AI-driven units are always enemy-side; player-side summons are members
  // (memberSlot), never units.
  const unitSlot = (u) => ({ unit: u, team: 'enemy', initMod: u.combat.ap || 0 });
  const slotActor = (s) => (s.member ? s.member.actor : s.unit);
  const slotAlive = (s) => (s.member ? s.member.sheet.hp > 0 && !!s.member.actor : !!s.unit.alive);
  const slotName = (s) => (s.member ? s.member.sheet.name : s.unit.def.name);
  const slotCarrier = (s) => (s.member ? s.member.sheet : s.unit);
  // The traversal, the round wrap and the fixed sequence a turn opens with live
  // in turn-order.js - pure, and unit tested there. What stays here is what
  // needs a panel, a body or the app: the host answers below, and the four
  // functions they point at (takeTurn, skipTurnFor, expireSummon, applyTurnDot),
  // which sit together further down under "what the turn engine asks this file".
  // They are declarations, so naming them here before they are written is fine.
  const turns = createTurnOrder({
    entries: [...members.map(memberSlot), ...engaged.filter((e) => e.alive).map(unitSlot)],
    rng: initRng,
    host: {
      alive: slotAlive,
      carrier: slotCarrier,
      outcome: () => {
        if (!hostilesRemain()) return 'win';
        if (!livingParty().length) return 'lose';
        return null;
      },
      win: victory,
      lose: defeat,
      lifetimeLeft: (s) => slotActor(s)?.summonTurns ?? null,
      spendLifetime: (s) => { slotActor(s).summonTurns -= 1; },
      expire: expireSummon,
      dot: applyTurnDot,
      skip: skipTurnFor,
      take: takeTurn,
      roundStart: () => {
        // A full pass through the order is one round: age summoner cooldowns
        // and the fire/smoke lifecycle a tick.
        for (const e of engaged) if (e.summonCd > 0) e.summonCd -= 1;
        reactions.clear(); // everyone gets their reaction back (TACTICS_PLAN M2)
        callbacks.onRound?.();
      },
      turnStart: () => {
        engageMemo.clear(); // bounds how stale an answer can get
        scrambleTurn += 1; // a confused character's bar re-deals each turn
      },
      afterTick: (s) => {
        if (!s.member) syncUnitSpeed(s.unit); // gum wearing off gives the legs back
        // A stance lasts UNTIL THE HOLDER'S NEXT TURN, so it lapses as that
        // turn opens (POWERS_PLAN M5). This hook rather than a tick count
        // because "until your next turn" is a position in the initiative
        // order, not a duration - a joiner inserted mid-round would drift the
        // two apart immediately. It fires on skipped turns too, which is
        // correct: a stunned watcher's stance still expires on schedule.
        const holder = s.member || s.unit;
        if (watching.delete(holder)) {
          // Drop whichever chip the stance wore - the two modes share the map
          // and the lapse rule, so they have to share the cleanup too.
          removeStatus(statusesOf(holder), 'watching');
          removeStatus(statusesOf(holder), 'guarding');
        }
      },
      beforeAdvance: () => {
        armed = null;
        pendingConfirm = null;
        pendingMelee = null;
        pendingCrouch = null;
        hidePreview();
      },
      // SHARED TURNS (INITIATIVE_PLAN #1): consecutive member slots hold the
      // floor together. Every member slot is controlled - your roster, your
      // summons, a borrowed coworker alike - and AI units never are, so an
      // enemy between two members in the order is exactly what breaks a span.
      controlled: (s) => !!s.member,
      // The engine moved the floor within an open span - `finish` passing it
      // on, or a steer the player asked for. Re-key the bindings to the new
      // member; makeActive already knows the whole dance.
      steer: (s) => steerTo(s),
    },
  });
  // Thin readers, so the rest of the file reads the way it did.
  const advanceTurn = () => turns.advance();
  const beginTurn = () => turns.begin();
  // A joiner's roll goes to the chat log like everyone else's - typed, so a
  // later filter can drop the dice as a category (see logInitiative).
  const insertSlot = (slot) => {
    const s = turns.insert(slot);
    callbacks.say(`${slotName(s)} rolls ${s.init} for initiative.`, 'initiative');
    return s;
  };
  // The rolled order, one line into the bottom-right chat log at the fight's
  // open. The initiative strip stopped printing numbers (INITIATIVE_PLAN #10 -
  // noise in a player-facing panel), so this line is where the rolls live:
  // a record you can scroll past, not a label on every row. Typed
  // 'initiative' so the log can filter the whole category out later.
  const logInitiative = () => callbacks.say(
    `Initiative — ${turns.order.map((s) => `${slotName(s)} ${s.init}`).join(', ')}.`,
    'initiative');

  // --- UI ---------------------------------------------------------------------
  // The readout is a dumb view in ui/combat.js now. What stays here is the
  // view-MODEL: this file knows whose turn it is, what a pip is worth and what
  // End Turn costs, and hands the panel a decided picture rather than the state
  // to decide from.
  const readout = createCombatReadout({
    onEndTurn: () => endTurnPressed(),
    onFocusSlot: (i) => {
      const s = turns.order[i];
      if (s) callbacks.focusCamera?.(s.member ? s.member.actor : s.unit);
    },
  });

  // --- movement preview -------------------------------------------------------
  // Hovering open floor shows the smoothed route, where this turn's AP runs
  // out (green = affordable, red = the rest), and the exact cost at the
  // cursor - the other half of what makes free movement feel free.
  const costTag = document.createElement('div');
  costTag.id = 'combat-move-cost';
  Object.assign(costTag.style, PANEL_CHROME, {
    position: 'fixed', zIndex: '26', padding: '2px 8px', borderRadius: '6px',
    background: 'rgba(22,22,36,.88)', font: '12px system-ui, sans-serif',
    boxShadow: 'none', pointerEvents: 'none', display: 'none',
  });
  document.body.appendChild(costTag);
  const PREVIEW_OK = new pc.Color(0.42, 0.78, 0.35);
  const PREVIEW_FAR = new pc.Color(0.85, 0.28, 0.24);
  // The reach ring: dim and cool, so it reads as information about YOU rather
  // than a judgement about a target (TACTICS_PLAN revision M5). Drawn only
  // while the cursor is actually over a coworker - "can I swing at THEM from
  // here?" is a question you ask about a target, and burning it into every
  // frame of your turn turned the answer into wallpaper nobody read.
  const REACH_RING = new pc.Color(0.55, 0.62, 0.78);
  // Yellow, the reserved cover colour (M7's mapping): the ring on a hovered
  // take-cover shield. Only ever drawn on the HOVERED object - the designer's
  // "there would just be rings everywhere if not".
  const PREVIEW_COVER = new pc.Color(0.95, 0.8, 0.3);
  // The ground wash while a ranged verb is armed (TACTICS_PLAN M7): every tile
  // the aim can legally land on, line of sight included, painted translucent
  // blue. drawTargets drives it; `paintEpoch` names the world it was computed
  // against - refresh() bumps it, so anything that reshapes sight mid-turn (a
  // door opened, smoke landing) repaints on its next frame without this
  // module knowing why.
  const aimPaint = createAimPaint(app);
  let paintEpoch = 0;
  let preview = null; // { reach: [[x,z],...], tail: [[x,z],...] | null }
  let aimPoint = null; // hover point while a cone attack is armed
  // The enemy the cursor is on as of the last hover event - the body pick when
  // main.js has one, else the ground-point fallback (enemyAtPoint). This is
  // the ONE answer to "am I aiming at someone?": the crosshair cursor, the
  // to-hit readout and the reach ring all read it, because computing it per
  // consumer is what let the crosshair promise a swing the readout denied.
  // Tracked even on gated frames (mid-move, AI turn) so the reach ring keeps
  // drawing while a walk finishes.
  let hoverFoe = null;
  let hoverHitChance = null; // to-hit chance shown for the enemy under an armed cursor
  // Test-only: what the last combat click resolved to. Every silent path
  // stamps a reason, so a wedged e2e run can say WHY a click did nothing
  // instead of leaving a trace full of clicks with no visible effect.
  let lastClickOutcome = null;

  function hidePreview() {
    preview = null;
    hoverHitChance = null;
    costTag.style.display = 'none';
  }

  // The live enemy near a ground point, if any - the fallback for pick rays
  // that miss the body mesh. Measured against the BODY's continuous position,
  // not the derived x/z tile: a body rests wherever its last walk clamped it
  // (approach points, budget truncation), and at this camera pitch the ground
  // point under a body pixel already lands ~0.7 tiles of parallax past the
  // feet - measuring the tile centre on top of that blanked the readout while
  // the cursor sat plainly on a coworker.
  function enemyAtPoint(point) {
    let best = null;
    for (const en of world.liveEnemies()) {
      if (!en.entity) continue;
      const pos = en.entity.getPosition();
      const d = Math.hypot(pos.x - point.x, pos.z - point.z);
      if (d < 0.7 && (!best || d < best.d)) best = { en, d };
    }
    return best?.en || null;
  }

  // The walk a click on this target would take, WITHOUT taking it: the same
  // route, endpoint swap, smoothing and budget arithmetic as walkActive,
  // stored as the movement trail instead of walked (drawPreview then shows the
  // affordable stretch green, the rest red, and rings the stop point - the
  // planned stand position, BG3-style). Returns { end, cost, done } or null
  // for a degenerate walk.
  function previewWalk(rawPath, endPoint, a, stopWhen = null) {
    if (endPoint) rawPath = [...rawPath.slice(0, -1), endPoint];
    let s = world.smooth(rawPath, active.actor);
    // The identical trim the walk will apply - the ring has to sit where the
    // feet will stop, or the preview is describing a different walk.
    if (stopWhen) s = trimToFirst(s, stopWhen) || s;
    const { points, cost, done, tail } = truncateByBudget(
      s, Math.max(0, moveBudget(active) - a.ap), stepCost);
    if (points.length < 2) return null;
    preview = { reach: points, tail };
    return { end: points[points.length - 1], cost, done };
  }

  // While a single-target attack is armed, the cost tag shows the to-hit chance
  // for the enemy under the cursor - the rings show range/validity, this shows
  // the odds (DOS2's most load-bearing bit of UI). A cone's wedge is its own
  // feedback and a shove auto-hits, so neither shows a percentage.
  //
  // A target the verb would WALK to previews the whole commitment before the
  // click spends it: the route it will take, the stand point it will stop at,
  // and the total AP - move plus swing. The odds are priced FROM that planned
  // point (attackMods' `plan`), because cover, flanking and the melee/ranged
  // split all move with the attacker - a percentage computed from the tile
  // being LEFT would be a lie about the attack being promised.
  function showHitPreview(en, sx, sy) {
    hoverHitChance = null;
    // The readout REPLACES the movement trail. Clearing it here rather than at
    // the call sites is what makes that true: `preview` is redrawn every frame,
    // so a trail left over from the last patch of floor the cursor crossed kept
    // hanging off the character while they were plainly aiming at someone.
    // (previewWalk re-fills it when a walk is genuinely part of the click.)
    preview = null;
    const id = previewAction();
    const a = ACTIONS[id];
    // A control rolls to hit like a swing does, so it earns the same readout -
    // an odds display that vanished the moment you armed Detain would make the
    // one power you most want to know the odds of the one that hides them.
    if (!a || (a.type !== 'attack' && !isControl(a) && !isPurge(a)) || a.cone || !en) {
      costTag.style.display = 'none';
      return;
    }
    const place = (text) => {
      costTag.textContent = text;
      costTag.style.left = `${sx + 14}px`;
      costTag.style.top = `${sy + 14}px`;
      costTag.style.display = 'block';
    };
    // A crouched target reshapes the readout before any odds exist
    // (TACTICS_PLAN M6): no angle means NO number - a percentage over an
    // unhittable target is a lie - and a human shield shows the odds against
    // the body that would actually take it.
    let target = en;
    let shieldNote = '';
    let plan = null; // planned stand point while the click includes a walk
    let planCost = 0; // what that walk takes out of this turn's budget
    const range = rangeOf(id);
    if (range) {
      const so = shotOutcome(active, en);
      if (so.blocked || (so.redirected && so.target.sheet)) {
        place(so.blocked
          ? `No shot - in cover behind the ${crouchLabel(so.blocked)}`
          : `No shot - you would hit ${nameOf(so.target)}`);
        return;
      }
      if (so.redirected) {
        target = so.target;
        shieldNote = ` vs ${nameOf(so.target)} (human shield)`;
      }
      const far = cheb(active.actor.x, active.actor.z, en.x, en.z) > range;
      const noLine = !world.hasLos(active.actor.x, active.actor.z, en.x, en.z);
      if (far || noLine) {
        // A throw refuses where it stands (the click's own rule) - say so
        // instead of quoting odds for a throw that will not happen.
        if (a.ammoCost) { place(far ? 'Too far to throw.' : 'No clear line to throw.'); return; }
        const stop = (px, pz) => verbReaches(id, en, px, pz);
        const route = routeIntoRange(en, range);
        const w = route && route.length >= 2 ? previewWalk(route, null, a, stop) : null;
        if (!w) { place('No way to get a shot at them.'); return; }
        if (!w.done || !stop(w.end[0], w.end[1])) {
          place('Out of range this turn - a click closes the distance.');
          return; // the trail stays up: green as far as the budget carries
        }
        plan = { x: w.end[0], z: w.end[1] };
        planCost = w.cost;
      }
    } else if (!(isControl(a) && controlIsRanged(a)) && !canReach(active, en)) {
      // The melee walk-in (swings, touch controls, a purge): preview the same
      // route the click will take, to the same legal stand point.
      const stop = (px, pz) => verbReaches(id, en, px, pz);
      const best = routeBeside(en);
      if (!best) { place('No way to get a swing at them.'); return; }
      const w = previewWalk(best.path, best.point, a, stop);
      if (!w) { place('Already as close as the route gets.'); return; }
      if (!w.done || !stop(w.end[0], w.end[1])) {
        place('Out of reach this turn - a click closes the distance.');
        return;
      }
      plan = { x: w.end[0], z: w.end[1] };
      planCost = w.cost;
    }
    // The same terms the swing will roll - not a second copy of the math. The
    // reason string matters: a positional modifier the player can't see reads
    // as randomness (TACTICS_PLAN, ui.js note).
    const t = attackMods(active, target, plan);
    hoverHitChance = hitChance(t.acc, t.dodge, t.mods);
    const why = t.covered ? ' - in cover'
      : (t.behind ? ' - from behind' : (t.flanked ? ' - flanked' : ''));
    let text = `${Math.round(hoverHitChance * 100)}% to hit${why}${shieldNote}`;
    // Price the whole click while a walk is part of it: what the move takes
    // out of real AP (the allowance is spent first, exactly as billMove
    // spends it) plus the swing itself.
    if (plan && planCost > 0.02) {
      const free = Math.min(active.freeAp || 0, planCost);
      const total = roundAp(roundAp(planCost - free) + a.ap);
      text += ` · ${fmtAp(total)} AP after the walk`;
    }
    place(text);
  }

  // While a buff is armed, the cursor names WHO it would land on and what they
  // would get - or why they would get nothing. The friendly twin of the to-hit
  // readout: the same "say the outcome before the AP is spent" contract, on a
  // verb whose outcome is not a percentage.
  function showAllyPreview(point, sx, sy) {
    preview = null; // aiming replaces the movement trail, same as a swing
    const a = ACTIONS[armed];
    const m = allyAtPoint(point);
    if (!m) { hidePreview(); return; }
    const problem = allyProblemFor(armed, m);
    const who = m === active ? 'yourself' : m.sheet.name;
    costTag.textContent = problem || `${a.label} on ${who} · ${a.ap} AP`;
    costTag.style.left = `${sx + 14}px`;
    costTag.style.top = `${sy + 14}px`;
    costTag.style.display = 'block';
  }

  // While a dash is armed, the cursor prices the RUN: how far of it you would
  // actually cover, and that it costs a flat fee rather than the per-tile
  // charge the trail normally shows.
  function showDashPreview(point, sx, sy) {
    preview = null;
    const a = ACTIONS[armed];
    // handleHover admits a ground point of null (a pick can land on a body
    // whose ground ray misses the world entirely - a chest pixel beside a
    // wall), and a dash is aimed at the FLOOR, so there is nothing to price.
    if (!point) { hidePreview(); return; }
    const tx = Math.round(point.x);
    const tz = Math.round(point.z);
    const problem = mobilityProblem(a, {
      ap: active.ap,
      usesLeft: a.uses ? active.usesLeft[armed] ?? 0 : null,
    });
    if (!problem && world.isWalkable(tx, tz)) {
      const raw = world.findPath(active.actor.x, active.actor.z, tx, tz, active.actor);
      if (raw && raw.length >= 2) {
        const s = world.smooth([...raw.slice(0, -1), world.clampPoint(point.x, point.z)], active.actor);
        const { points, done } = truncateByBudget(s, dashDistanceOf(a), () => 1);
        // The trail IS the affordance for a move - but it has to be stored in
        // the shape drawPreview reads (`{ reach, tail }`, declared where
        // `preview` is). A bare array left `preview.reach` undefined, and
        // drawPreview walks it every frame: `pts.length` on undefined threw
        // once per frame for as long as a dash was armed over a legal route.
        // A dash has no `tail` - it stops where the budget stops, and the
        // "as far as it reaches" wording on the cost tag already says so.
        preview = { reach: points, tail: null };
        costTag.textContent = done
          ? `${a.label} · ${a.ap} AP · no opportunity attacks`
          : `${a.label} · ${a.ap} AP · as far as it reaches`;
        costTag.style.left = `${sx + 14}px`;
        costTag.style.top = `${sy + 14}px`;
        costTag.style.display = 'block';
        return;
      }
    }
    costTag.textContent = problem || 'No route there.';
    costTag.style.left = `${sx + 14}px`;
    costTag.style.top = `${sy + 14}px`;
    costTag.style.display = 'block';
  }

  // While a zone is armed, the cursor says how much of it would actually land.
  // That number is the whole question for this verb: the tiles it can take are
  // whatever happens to be plain floor, so the same click over open carpet and
  // over a cubicle row costs the same AP for very different results.
  function showZonePreview(point, sx, sy) {
    preview = null;
    const a = ACTIONS[armed];
    const tx = Math.round(point.x);
    const tz = Math.round(point.z);
    const problem = zoneProblem(a, {
      dist: cheb(active.actor.x, active.actor.z, tx, tz),
      los: world.hasLos(active.actor.x, active.actor.z, tx, tz),
      ap: active.ap,
      usesLeft: a.uses ? active.usesLeft[armed] ?? 0 : null,
    });
    const n = problem ? 0 : zoneCells(a, tx, tz).length;
    costTag.textContent = problem || `Cover ${n} tile${n === 1 ? '' : 's'} · ${a.ap} AP`;
    costTag.style.left = `${sx + 14}px`;
    costTag.style.top = `${sy + 14}px`;
    costTag.style.display = 'block';
  }

  // While a summon is armed, the cursor previews the DROP: how many applicants
  // that spot fits, or why it doesn't work. Same rule the click runs.
  function showSummonPreview(point, sx, sy) {
    preview = null; // the drop zone replaces the trail, same as the hit readout
    const a = ACTIONS[armed];
    const tx = Math.round(point.x);
    const tz = Math.round(point.z);
    const problem = summonSpotProblem(a, tx, tz);
    const room = problem ? 0 : world.summonSpots(tx, tz, a.count).length;
    costTag.textContent = problem
      || `Post ${room} applicant${room === 1 ? '' : 's'} here · ${a.ap} AP`;
    costTag.style.left = `${sx + 14}px`;
    costTag.style.top = `${sy + 14}px`;
    costTag.style.display = 'block';
  }

  // Resolve the hover and return the enemy a click would swing at RIGHT NOW,
  // or null. main.js keys the crosshair cursor off the return value, so the
  // cursor, the to-hit readout and the click all run the same resolution AND
  // the same gate (handleEnemyClick's: your turn, standing still) - the cursor
  // used to read its own ungated body pick, promising a swing mid-walk or on
  // an AI turn that the readout and the click both refused.
  function handleHover(point, sx, sy, picked = null) {
    // While aiming, target rings replace the movement trail entirely. Cone
    // attacks and summon placement additionally track the cursor - the wedge
    // (or the drop zone) follows it.
    // A zone tracks the cursor the way a cone and a summon placement do - the
    // footprint follows the aim, because where it lands IS the decision.
    if (armed && (ACTIONS[armed].cone || ACTIONS[armed].type === 'summon'
      || ACTIONS[armed].type === 'cover' || isZone(ACTIONS[armed]))) aimPoint = point;
    // Who is the cursor on? The body pick wins - it sees what the pixel shows.
    // The ground point is only a fallback for rays that miss the mesh, and a
    // pick can land on a body whose ground ray misses the world entirely (a
    // chest pixel next to a wall), so the pick must not require a point.
    hoverFoe = (picked?.alive ? picked : null) || (point ? enemyAtPoint(point) : null);
    if (phase !== 'player' || active.actor.moving || (!point && !hoverFoe)) { hidePreview(); return null; }
    // Armed: the movement trail yields to the to-hit readout over a target.
    if (armed) {
      if (ACTIONS[armed].type === 'summon') {
        if (point) showSummonPreview(point, sx, sy); else hidePreview();
        return hoverFoe;
      }
      if (isZone(ACTIONS[armed])) {
        if (point) showZonePreview(point, sx, sy); else hidePreview();
        // A zone is aimed at the GROUND, so it must not claim a foe - the
        // crosshair would promise a swing the click does not make.
        return null;
      }
      // A buff points the other way, so it must NOT return a foe: main.js
      // keys the crosshair off this return value, and a crosshair over a
      // coworker while Performance Review is armed promises a swing the click
      // would refuse - the exact class of lie the one-hover-answer rule
      // exists to prevent (ARCHITECTURE, hover.js).
      // An ANY-target verb belongs to whichever half the cursor is on: over a
      // coworker it must promise the swing the click will make, over a
      // colleague the friendly cast. Only a friends-ONLY verb returns null
      // unconditionally - that is the lie-prevention rule, not a ban on verbs
      // that legitimately point both ways.
      if (aimsAtAlly(ACTIONS[armed]) && !(aimsAtAnyone(ACTIONS[armed]) && hoverFoe)) {
        showAllyPreview(point, sx, sy);
        return null;
      }
      // A dash is aimed at the FLOOR, so it keeps the movement trail rather
      // than a target readout - what the player needs to see is where they
      // would end up, which is the one preview the game already draws well.
      if (isMobility(ACTIONS[armed])) { showDashPreview(point, sx, sy); return null; }
      showHitPreview(hoverFoe, sx, sy);
      return hoverFoe;
    }
    // Nothing armed, but a coworker under the cursor is still a target - the
    // click swings by default, so preview the odds rather than falling through
    // to a movement route (their tile isn't walkable, so that showed nothing at
    // all, which read as "a click here does nothing").
    if (hoverFoe) { showHitPreview(hoverFoe, sx, sy); return hoverFoe; }
    const tx = Math.round(point.x);
    const tz = Math.round(point.z);
    if (!world.isWalkable(tx, tz)) { hidePreview(); return; } // enemies/walls: no route preview
    let raw;
    if (tx === active.actor.x && tz === active.actor.z) {
      const pos = active.actor.entity?.getPosition();
      if (!pos) { hidePreview(); return; }
      raw = [[pos.x, pos.z], world.clampPoint(point.x, point.z)];
    } else {
      const p = world.findPath(active.actor.x, active.actor.z, tx, tz, active.actor);
      if (!p || p.length < 2) { hidePreview(); return; }
      raw = [...p.slice(0, -1), world.clampPoint(point.x, point.z)];
    }
    const s = world.smooth(raw, active.actor);
    const { points, cost, done, tail } = truncateByBudget(s, moveBudget(active), stepCost);
    preview = { reach: points, tail };
    // Show what it actually costs YOU: the allowance is spent first, so a short
    // reposition can read as free even though the route has a distance cost.
    const free = Math.min(active.freeAp || 0, cost);
    const apPart = roundAp(cost - free);
    const label = free > 0
      ? (apPart > 0 ? `${fmtAp(apPart)} AP + ${fmtAp(free)} move` : `${fmtAp(free)} move (free)`)
      : `${fmtAp(cost)} AP`;
    costTag.textContent = done ? label : `${label} - out of reach`;
    costTag.style.left = `${sx + 14}px`;
    costTag.style.top = `${sy + 14}px`;
    costTag.style.display = 'block';
  }

  function drawRing(cx, cz, r, color, y = 0.14) {
    const SEGS = 18;
    let prev = null;
    for (let i = 0; i <= SEGS; i++) {
      const a = (i / SEGS) * Math.PI * 2;
      const p = new pc.Vec3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
      if (prev) app.drawLine(prev, p, color);
      prev = p;
    }
  }

  // The shielded faces of a tile, as bars laid on the floor along the tile's
  // own edges. This is the affordance the crouch never had: the rule always
  // knew which sides were covered and the player never did, so tucking into a
  // corner told you "In Cover" and left you to guess which way was open
  // (designer, 2026-07-31: "i have no indication of which partition is my
  // actual cover"). Drawn while AIMING and again while the crouch HOLDS, off
  // the same live face list the shot resolves against - so a wall that comes
  // down goes dark on the next frame rather than lying until somebody shoots.
  function drawFaces(cx, cz, faces, color, y = 0.15) {
    const H = 0.42; // half the bar's length: a little short of the full edge
    for (const [ox, oz] of faces) {
      // The edge midpoint, then out along the perpendicular.
      const mx = cx + ox * 0.5;
      const mz = cz + oz * 0.5;
      const px = oz; // perpendicular to the face
      const pz = ox;
      app.drawLine(
        new pc.Vec3(mx - px * H, y, mz - pz * H),
        new pc.Vec3(mx + px * H, y, mz + pz * H), color);
    }
  }
  // The faces that would shield a crouch on this tile - the aim's twin of
  // `crouchFacesOf`, which asks the same of a unit already standing somewhere.
  const crouchFacesAt = (tx, tz) => shieldedFaces(tx, tz, {
    edgeOpen: world.stepOpen,
    coverCell: coverCellFor(active),
  });

  function drawPreview() {
    if (!preview) return;
    const y = 0.14; // above the floor top (0.1) and surface decals (0.12)
    const seg = (pts, color) => {
      for (let i = 1; i < pts.length; i++) {
        app.drawLine(new pc.Vec3(pts[i - 1][0], y, pts[i - 1][1]),
          new pc.Vec3(pts[i][0], y, pts[i][1]), color);
      }
    };
    seg(preview.reach, PREVIEW_OK);
    if (preview.tail) seg(preview.tail, PREVIEW_FAR);
    // ring where the walk would stop
    const [ex, ez] = preview.reach[preview.reach.length - 1];
    drawRing(ex, ez, 0.32, PREVIEW_OK, y);
  }

  // The wedge, aimed from the acting member's body. The geometry itself lives
  // in powers.js so the out-of-combat preview draws the identical shape; this
  // only binds the origin.
  const coneTest = (a, tx, tz) => coneFrom(a, posOf(active), tx, tz);

  // While an attack/shove is armed, rings mark the targets: green = usable on
  // them right now (melee walks you in), red = out of range / no line / short
  // on ammo or AP. Every live enemy is ringed, not just the engaged - a
  // clickable bystander deserves the same feedback. A cone draws its aimed
  // wedge instead, ringing whoever it would catch.
  function drawTargets() {
    // The aim wash first, and unconditionally: it must also KNOW to vanish
    // when the turn ends, the verb is disarmed, or the aimer is mid-walk (a
    // wash painted from a tile you are leaving is a promise about ground you
    // no longer own). The key makes the repaint free while nothing changes.
    // reachSpecOf is the ONE answer to "how far does this verb reach": the
    // shapes powers.js owns plus a plain ranged ATTACK's (stats.rangeOf, where
    // a throw's undeclared THROW_RANGE lives). The wash, the target rings and
    // every walk-up read it, so the three cannot disagree.
    const spec = phase === 'player' && armed && !active.actor.moving
      ? reachSpecOf(armed)
      : null;
    if (!spec) {
      aimPaint.hide();
    } else {
      const ax = active.actor.x;
      const az = active.actor.z;
      // An ANY-target verb (a purge - Reboot) has TWO reaches, and the wash is
      // sized by the wider one: a colleague can be rebooted from across the
      // room (the friendly click resolves at buff range), while a coworker
      // goes down handleEnemyClick's melee walk-in and has to be walked up to.
      // Painting the friendly radius over a coworker promises a cast that
      // would actually be a walk, so those tiles drop out of the wash - it
      // covers the ground an aim LANDS on right now, and the coworker's own
      // ring (which already reads the walk-in rule) says the rest.
      //
      // Scoped to `aimsAtAnyone` deliberately: every other verb's wash radius
      // IS its act range, so the test would be a no-op - and a cone, whose
      // range lives in `cone` rather than where actRangeOf looks, would have
      // holes punched in a wash that is perfectly honest.
      const twoReaches = aimsAtAnyone(ACTIONS[armed]);
      const body = posOf(active);
      const walkOnly = (x, z) => {
        if (!twoReaches) return false;
        const en = world.liveEnemies().find((e) => e.x === x && e.z === z);
        return !!en && !verbReaches(armed, en, body.x, body.z);
      };
      aimPaint.show(`${armed}:${ax},${az}:${paintEpoch}`, () => rangeTiles(
        ax, az, spec.r,
        // Paintable ground: open floor the aimer can SEE. Solid cells stay
        // unpainted - they read as objects standing in the wash, and the
        // shadow they cast behind themselves is the whole lesson.
        (x, z) => world.terrainOpen(x, z) && world.hasLos(ax, az, x, z) && !walkOnly(x, z),
        spec.euclid,
      ));
    }
    if (phase !== 'player') return;
    // What is covering the character you are steering, RIGHT NOW, whatever is
    // armed - the held-crouch half of the aiming affordance above. A crouch
    // that says only "In Cover" is a crouch you have to guess the shape of,
    // and in a corner the shape is the whole decision. Read through
    // `crouchStateOf`, so the bars are the faces the next shot will actually
    // be resolved against, and a shield that falls takes its bar with it.
    {
      const s = crouchStateOf(active);
      if (s) drawFaces(s.at.x, s.at.z, s.faces, PREVIEW_COVER);
    }
    // A door you are standing at, rung before anything else and regardless of
    // what is armed. It is not an ACTION - it has no bar slot, it lives on the
    // right-click menu - so gating it behind `previewAction` would hide the one
    // affordance for the only terrain a fight can change. Green when the AP is
    // there for it, red when it is not, same as every other ring here.
    for (const mid of world.doorsBeside?.(active.actor.x, active.actor.z) || []) {
      drawRing(mid.x, mid.z, 0.3, active.ap >= mid.ap ? PREVIEW_OK : PREVIEW_FAR);
    }
    // Not gated on `armed`: with nothing armed a click still swings (the basic
    // attack), and a swing you can't see coming is worse than no swing at all -
    // the rings are how you know which coworker a click would hit and whether
    // you can afford it. previewAction() is that same fallback, so what's drawn
    // is always what would happen.
    const id = previewAction();
    if (!id) return;
    const a = ACTIONS[id];
    // A zone rings the tiles it would actually cover - the same list the click
    // paints (zoneCells), so a tile that shows a ring is a tile that gets the
    // surface. Red on the aim point alone when the placement itself is refused.
    if (isZone(a)) {
      if (!armed || !aimPoint) return;
      const tx = Math.round(aimPoint.x);
      const tz = Math.round(aimPoint.z);
      const problem = zoneProblem(a, {
        dist: cheb(active.actor.x, active.actor.z, tx, tz),
        los: world.hasLos(active.actor.x, active.actor.z, tx, tz),
        ap: active.ap,
        usesLeft: a.uses ? active.usesLeft[id] ?? 0 : null,
      });
      if (problem) { drawRing(tx, tz, 0.42, PREVIEW_FAR); return; }
      for (const [x, z] of zoneCells(a, tx, tz)) drawRing(x, z, 0.42, PREVIEW_OK);
      return;
    }
    // A summon rings the tiles its applicants would actually land on (green),
    // or the aimed tile alone in red when the spot is unusable - so "where do
    // they go?" is answered before the AP is spent.
    if (a.type === 'summon') {
      if (!armed || !aimPoint) return;
      const tx = Math.round(aimPoint.x);
      const tz = Math.round(aimPoint.z);
      const spots = summonSpotProblem(a, tx, tz) ? [] : world.summonSpots(tx, tz, a.count);
      if (!spots.length) { drawRing(tx, tz, 0.42, PREVIEW_FAR); return; }
      for (const [sx, sz] of spots) drawRing(sx, sz, 0.42, PREVIEW_OK);
      return;
    }
    // Take Cover rings the SPOT YOU WOULD STAND, in the cover yellow, and
    // draws the faces that would shield it. Ringing the shield instead was
    // the old aim's own confusion made visible: it told you which object you
    // had named while the side you would end up on - the thing that decides
    // which shots you are safe from - was chosen for you and never shown.
    // Now the ring is where you go and the bars are what covers you, so a
    // corner reads as a corner and you can see the open angle you are leaving.
    if (a.type === 'cover') {
      if (!armed || !aimPoint) return;
      const tx = Math.round(aimPoint.x);
      const tz = Math.round(aimPoint.z);
      const ok = !coverSpotProblem(tx, tz);
      drawRing(tx, tz, 0.42, ok ? PREVIEW_COVER : PREVIEW_FAR);
      if (ok) drawFaces(tx, tz, crouchFacesAt(tx, tz), PREVIEW_COVER);
      return;
    }
    // A buff rings the FRIENDLY side instead: green on every ally it could
    // land on right now, red on the ones out of range, out of line, or who
    // would get nothing from it. Same rule the click runs (buffProblem), so a
    // green ring is a promise.
    if (aimsAtAlly(a)) {
      if (!armed) return; // never auto-armed - only shown while deliberately aiming
      for (const m of friendlies()) {
        if (!m.actor?.entity) continue;
        const pos = m.actor.entity.getPosition();
        drawRing(pos.x, pos.z, TARGET_R, allyProblemFor(id, m) ? PREVIEW_FAR : PREVIEW_OK);
      }
      // An ANY-target verb keeps going and rings the other half too. Returning
      // here would ring only colleagues while the click still resolved on
      // coworkers - the affordance describing half the verb.
      if (!aimsAtAnyone(a)) return;
    }
    if (!ringsAtBodies(a)) return;
    if (a.cone) {
      const test = aimPoint && coneTest(a, aimPoint.x, aimPoint.z);
      if (test) {
        const y = 0.14;
        const line = conePolyline(a, test);
        for (let i = 1; i < line.length; i++) {
          app.drawLine(new pc.Vec3(line[i - 1][0], y, line[i - 1][1]),
            new pc.Vec3(line[i][0], y, line[i][1]), PREVIEW_OK);
        }
      }
      for (const en of world.liveEnemies()) {
        if (!en.entity) continue;
        const pos = en.entity.getPosition();
        // Test the BODY (where the ring is drawn), not the tile centre, so the
        // ring and the rule agree about what the cone catches.
        const hit = test && test(pos.x, pos.z, TARGET_R)
          && world.hasLos(active.actor.x, active.actor.z, en.x, en.z);
        drawRing(pos.x, pos.z, TARGET_R, hit && active.ap >= a.ap ? PREVIEW_OK : PREVIEW_FAR);
      }
      return;
    }
    // Reach is a RADIUS, so the honest affordance is a circle on the floor.
    // Highlighting whole tiles would draw a plus-with-corners that lies about
    // the shape, and without any affordance a long weapon is an invisible
    // statistic - the player would feel the extra tile without being told why.
    // Drawn on the ACTOR's continuous position, which is what the rule measures,
    // and ONLY while a coworker is under the cursor - the same hoverFoe the
    // crosshair and the readout key off, so the three affordances can't
    // disagree about whether you're aiming at someone. It's the answer to "can
    // I hit them from here?", a question you only ask while aiming; always-on,
    // it was just a circle that followed you around.
    // A RANGED attack is not answered by this circle: its rule is a Chebyshev
    // square plus a line of sight, which a radius describes wrongly at the
    // corners, and the melee reach drawn under a staple gun says the opposite
    // of the truth. The per-enemy rings below answer it exactly for those.
    if (hoverFoe?.alive && !rangeOf(id)) {
      const me = posOf(active);
      const r = a.type === 'shove' ? REACH.SHOVE : isPull(a) ? REACH.PULL : reachOfUnit(active);
      drawRing(me.x, me.z, r, REACH_RING);
    }
    // Props are targets too, and nothing ever said so. A shove that puts a
    // filing cabinet on somebody is strictly the better move where it is
    // available - it damages, it stuns, and it leaves cover the other side has
    // to walk around - so the affordance for it should not be "the player
    // happened to try it". Eight neighbours, the same scan the AI runs, and
    // `topplePlan` is the same rule the click runs: a green ring here is the
    // same promise it is anywhere else on this bar.
    if (a.type === 'shove') {
      const b = bodyOf(active);
      const afford = active.ap >= a.ap;
      for (const { x, z, plan } of toppleRings(b.x, b.z, {
        isToppleableAt: (px, pz) => isToppleable(world.tileDefAt(px, pz)),
        planAt: (px, pz) => topplePlan(active, px, pz),
      })) {
        const canDrop = !!plan && afford;
        drawRing(x, z, 0.42, canDrop ? PREVIEW_OK : PREVIEW_FAR);
        // ...and WHERE it lands (designer, 2026-07-30): the fall is
        // sign-derived from where you stand, so the read must be too - a
        // smaller ring on the landing tile, tied to the prop's by a line.
        if (plan) {
          drawRing(plan.lx, plan.lz, 0.28, canDrop ? PREVIEW_OK : PREVIEW_FAR);
          app.drawLine(new pc.Vec3(x, 0.14, z),
            new pc.Vec3(plan.lx, 0.14, plan.lz), canDrop ? PREVIEW_OK : PREVIEW_FAR);
        }
      }
      for (const { x, z, clear } of partitionRings(b.x, b.z, world)) {
        drawRing(x, z, 0.42, clear && afford ? PREVIEW_OK : PREVIEW_FAR);
      }
    }
    // Breakable cover rings under an ARMED attack (TACTICS_PLAN M8) - the
    // same promise the shove's prop rings make: green means the click lands
    // the hit. A melee swing rings its neighbourhood, a ranged attack
    // everything it could hit; adjacent partitions ring like the shove's do
    // (a DISTANT partition stays un-rung - the shove's own partial-affordance
    // precedent `[proposed]` - though the ranged click still resolves).
    //
    // ARMED is load-bearing, and was not enforced. The coworker rings above
    // are deliberately drawn with nothing armed, because a bare click still
    // swings; these are not the same. `aimsAtProps` passes for the plain
    // basic attack, so every partition edge you stood beside rang green for
    // the whole fight - a ring on the tile ACROSS a cubicle wall, promising
    // a verb nobody had reached for (designer, 2026-07-31). Breaking cover
    // down is a thing you go looking for; its affordance appears when you do.
    if (armed) {
      const b = bodyOf(active);
      const paid = (!a.ammoCost || active.sheet.paper >= ammoCostOf(id)) && active.ap >= a.ap;
      const { props, edges } = breakRings(a, b.x, b.z, rangeOf(id), {
        tileDefAt: world.tileDefAt,
        planAt: (px, pz) => breakPlanAt(id, px, pz),
        edgeHpBetween: world.edgeHpBetween,
      });
      for (const { x, z, landable } of props) {
        drawRing(x, z, 0.42, landable && paid ? PREVIEW_OK : PREVIEW_FAR);
      }
      for (const { x, z } of edges) drawRing(x, z, 0.42, paid ? PREVIEW_OK : PREVIEW_FAR);
    }
    // The verdict ladder is combat-targeting.enemyRingOk; everything gathered
    // here is a leaf fact only this file can answer. The lazy getters matter:
    // shotOutcome and pullPlanFor are not free, and only one branch of the
    // ladder ever reads them.
    const range = rangeOf(id);
    for (const en of world.liveEnemies()) {
      if (!en.entity) continue;
      // ONE shotOutcome per enemy, memoised and LAZY, because it runs
      // crouchStateOf - which lazily BREAKS a stale crouch. Idempotent (a
      // second call finds nothing left to break), but this is a per-frame path
      // and asking twice where one answer will do is waste.
      //
      // Lazy is safe, and worth saying why: the ladder's `&&` chain means an
      // out-of-range or blind target never reads it, so the incidental
      // revalidation this used to do every frame no longer happens here. It
      // does not need to. `refresh()` is the OWNER of crouch revalidation
      // (it walks every crouch), and every event that can stale one - a shove
      // glide, a topple taking the shield, a swap, a step - goes through it.
      // Between refreshes only the cursor moves, and a cursor cannot invalidate
      // a crouch.
      let shot = null;
      const outcome = () => (shot ??= shotOutcome(active, en));
      const ok = enemyRingOk(a, {
        ap: active.ap,
        ammoOk: !a.ammoCost || active.sheet.paper >= ammoCostOf(id),
        range,
        dist: cheb(active.actor.x, active.actor.z, en.x, en.z),
        los: world.hasLos(active.actor.x, active.actor.z, en.x, en.z),
        get shoveReach() { return canReach(active, en, REACH.SHOVE); },
        get pullOk() { return !!pullPlanFor(en); },
        get controlRefused() {
          return controlProblem(a, {
            dist: cheb(active.actor.x, active.actor.z, en.x, en.z),
            los: world.hasLos(active.actor.x, active.actor.z, en.x, en.z),
            ap: active.ap,
            usesLeft: a.uses ? active.usesLeft[id] ?? 0 : null,
            alive: en.alive,
          });
        },
        get shotBlocked() { return !!outcome().blocked; },
        get shotRedirectedToAlly() {
          const so = outcome();
          return !!so.redirected && !!so.target?.sheet;
        },
        get meleeReachable() { return canReach(active, en) || hasSwingSpot(en); },
      });
      const pos = en.entity.getPosition();
      drawRing(pos.x, pos.z, TARGET_R, ok ? PREVIEW_OK : PREVIEW_FAR);
    }
    // A purge can also target yourself - ring the caster too.
    if (a.purge && active.actor.entity) {
      const pp = active.actor.entity.getPosition();
      drawRing(pp.x, pp.z, 0.5, active.ap >= a.ap ? PREVIEW_OK : PREVIEW_FAR);
    }
  }

  // The reorg (`confused`). Every power still works and still says what it
  // does - it is just not where you left it. Deterministic per turn rather than
  // Math.random, and re-dealt only at turnStart: a bar that reshuffled on every
  // incidental repaint would move the button out from under a click in flight,
  // which is a different (and much worse) thing than losing your bearings.
  //
  // The seed is AVALANCHED (mulberry32's mixer) rather than fed to a plain
  // LCG: consecutive turn numbers differ by one bit, and a bare
  // `seed * A + C` walk turned that into consecutive deals that shared their
  // first swaps - Deflect Blame led the bar and Shove closed it three turns
  // running, which is a reorg that keeps giving you back your two landmarks.
  function scrambled(ids) {
    const out = [...ids];
    let seed = scrambleTurn >>> 0;
    const next = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) >>> 0;
    };
    for (let i = out.length - 1; i > 0; i--) {
      const j = next() % (i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  // One affordability site for both halves of the game. main.js owns the bar's
  // DOM and the player's slot layout; this owns "can I press that right now",
  // because it is a combat question and there must be one answer to it.
  // Returns null for a power the acting member does not have at all.
  function actionState(id) {
    const a = ACTIONS[id];
    if (!a || !actionIdsOf(active).includes(id)) return null;
    const affordable = phase === 'player' && active.ap >= a.ap
      && (!a.uses || active.usesLeft[id] > 0)
      && (!a.ammoCost || active.sheet.paper >= ammoCostOf(id))
      && !(a.footwork && statusFx(active.sheet).noFootwork); // no kicking with gum on the shoe
    return {
      ap: a.ap,
      uses: a.uses ? active.usesLeft[id] : null,
      ammoCost: a.ammoCost ? ammoCostOf(id) : 0,
      affordable,
      // WHY it can't be pressed, in the slot's own tooltip. A dimmed button
      // that doesn't say what it wants teaches nothing, and out of combat the
      // bar already answered this (combatOnlyReason) - a fight should not be
      // the half of the game where the bar goes quiet.
      reason: affordable ? null
        : phase !== 'player' ? 'Not your turn.'
          : a.uses && active.usesLeft[id] <= 0 ? `${a.label} is spent for this fight.`
            : a.ammoCost && active.sheet.paper < ammoCostOf(id)
              ? `Needs ${ammoCostOf(id)} paper - you have ${active.sheet.paper}.`
              : a.footwork && statusFx(active.sheet).noFootwork
                ? 'Gum on your shoe - no footwork.'
                : `Not enough AP - ${a.label} costs ${a.ap}.`,
      // An armed action stays pressable even when it has gone unaffordable -
      // that press is the only way to lower it again (see pressAction).
      live: id === armed ? 'armed' : id === pendingConfirm ? 'confirm' : null,
      tip: actionTip(id, a),
    };
  }
  // The reorg (`confused`) used to shuffle a list this module built. The order
  // is the player's own layout now, so the status shuffles THAT - same
  // disorientation, same per-turn seed, applied to the bar they arranged.
  function scrambleEntries(entries) {
    if (!statusFx(active.sheet).shuffleActions) return entries;
    return scrambled(entries.map((_, i) => i)).map((i) => entries[i]);
  }

  // Point everything at the member whose initiative turn it now is:
  // party.active moves with it so the portrait bar highlights and the
  // out-of-combat leader bindings follow whoever last held the floor (main.js
  // syncLeaderBindings). Switching exists only WITHIN an open shared turn
  // (INITIATIVE_PLAN): steering moves among the members holding the floor,
  // and everyone else still waits for their own slot to come up.
  function makeActive(m) {
    active = m;
    // A summon lives outside party.members, so it can't be party.active - leave
    // that pointing at the real member who last held the floor (the post-combat
    // leader). The initiative tracker shows whose turn it actually is.
    if (!m.isSummon) party.active = members.indexOf(m);
    armed = null;
    pendingConfirm = null;
    pendingMelee = null;
    pendingCrouch = null;
    hidePreview();
    callbacks.refreshBar?.();
  }
  // A member dropped to 0 HP outside its own turn (fire under a combat walk) -
  // main.js reports it here. Topple them; if it was the STEERED member, retire
  // their turn - under a shared turn `advanceTurn` is finish-the-steered, so
  // the floor passes to a teammate still holding it rather than costing the
  // whole group the turn (INITIATIVE_PLAN #12); a held member downed while
  // somebody else was steering needs nothing here - steering already flows
  // past the fallen. Defeat only on a party wipe.
  function notifyMemberDown() {
    for (const m of members) {
      if (m.sheet.hp > 0 || m.toppled) continue;
      m.toppled = true;
      m.actor?.clearPath();
      if (m.actor) m.actor.fx = { kind: 'death', t: 0 };
    }
    if (!livingParty().length) { defeat(); return; } // party wipe - the only loss
    if (phase === 'player' && active.sheet.hp <= 0) {
      log(`${active.sheet.name} goes down!`);
      advanceTurn();
    } else {
      refresh();
    }
  }

  function log(text) {
    readout.say(text);
    callbacks.say(text);
  }
  function refresh() {
    // Anything worth redrawing the HUD for may also have reshaped what the
    // aim can see (a door toggled, smoke landed, a prop toppled) - stale the
    // aim wash's key so its next frame recomputes.
    paintEpoch += 1;
    // ...and may have invalidated somebody's crouch (a shove glide, a topple
    // taking the shield, a swap). Revalidating here keeps the status chips
    // honest without hooking every displacement path (TACTICS_PLAN M6).
    for (const u of [...crouched.keys()]) crouchStateOf(u);
    // Name whose turn it is - only when that is actually a question. With one
    // party member, End Turn being lit already says it is your turn ("YOUR
    // TURN" here and "Your turn." in the log were the same fact said three
    // times over, next to a button that is either pressable or is not). A
    // multi-member party still needs the name, because the button alone
    // cannot say WHICH of your people is up; an AI turn still needs the
    // enemy's name, because nothing else on screen carries it.
    const solo = members.length === 1;
    // The movement allowance rides beside the AP pips as its own boot glyph,
    // and only for characters that have one - never advertise a resource a
    // character does not own. Distance-priced movement leaves fractional AP,
    // which apPips renders as a half pip.
    const freeTag = freeMoveOf(active) > 0 ? `  🥾 ${fmtAp(active.freeAp || 0)} move` : '';
    // The verbs repaint on the shared bar, which main.js owns - affordability,
    // tooltips and the armed/confirm ring all come from actionState().
    callbacks.refreshBar?.();
    // The initiative tracker: the turn order top-to-bottom, the current unit
    // marked, your side tinted friendly and the enemies warm. HP rides along;
    // the downed/dead show a dash. The rolled NUMBER is gone from every row
    // (INITIATIVE_PLAN #10 [ratified]: "itll be nothing but noise to the
    // player" - the order already says who acts when, and the dice line in
    // the chat log keeps the record). A shared turn wears a bracket: every
    // holder gets the tinted left edge, ▸ marks the one being steered, ✓ the
    // ones whose End Turn is already pressed.
    const heldSet = new Set(turns.held);
    const bracket = heldSet.size > 1;
    readout.render({
      // Name whose turn it is - only when that is actually a question. With one
      // party member, End Turn being lit already says it is your turn ("YOUR
      // TURN" here and "Your turn." in the log were the same fact said three
      // times over, next to a button that is either pressable or is not). A
      // multi-member party still needs the name, because the button alone
      // cannot say WHICH of your people is up; an AI turn still needs the
      // enemy's name, because nothing else on screen carries it.
      turnLabel: phase === 'player'
        ? (solo ? '' : active.sheet.name)
        : phase === 'ai' && acting ? `${acting.unit.def.name}'s turn` : '',
      apText: apPips({
        ap: active.ap, maxAp: active.sheet.maxAp, text: fmtAp(active.ap), freeText: freeTag,
      }),
      endEnabled: phase === 'player',
      // Under a shared turn the button names whose turn it ends - each member
      // retires their own (INITIATIVE_PLAN #2), so the label has to say which
      // one a press costs. Alone, it stays the plain verb it always was.
      endLabel: turns.held.length > 1 ? `End Turn — ${active.sheet.name}` : 'End Turn',
      // The turn order top-to-bottom, the current unit marked, your side tinted
      // friendly and the enemies warm. HP rides along; the downed/dead show a
      // dash. The rolled NUMBER is gone from every row (INITIATIVE_PLAN #10
      // [ratified]: "itll be nothing but noise to the player" - the order
      // already says who acts when, and the dice line in the chat log keeps the
      // record). A shared turn wears a bracket.
      order: turns.order.map((s, i) => {
        const holds = bracket && heldSet.has(s);
        const dead = !slotAlive(s);
        const carrier = s.member ? s.member.sheet : s.unit;
        return {
          name: slotName(s),
          hp: s.member
            ? `${Math.max(0, s.member.sheet.hp)}/${s.member.sheet.maxHp}`
            : `${Math.max(0, s.unit.hp)}/${s.unit.maxHp}`,
          dead,
          current: i === turns.index,
          holds,
          finished: holds && turns.isDone(s),
          team: s.team,
          // Live status icons trail the row - the at-a-glance read of who's
          // stunned, burning, deflecting, gummed.
          icons: dead ? '' : statusList(carrier).map((st) => st.icon).join(''),
          portrait: (s.member ? s.member.actor : s.unit)?.portraitUrl || null,
        };
      }),
    });
    // Reflect the ACTING member on the persistent HUD, not the leader - in a
    // multi-member fight you control whoever's turn it is (their HP, their gum/
    // bleed chips). Out of combat, main.js's callback falls back to the leader.
    callbacks.updateHud(active.sheet);
  }

  function cleanup() {
    // Turn-clock statuses used to be swept off every combatant here, because
    // "there are no turns on the map". There are now: main.js's out-of-combat
    // clock spends a status turn the same way it spends a fire turn (designer,
    // 2026-07-31 - one clock, in and out of combat), so these keep counting
    // down where they stand instead of being cured by the fight ending.
    //
    // That sweep was doing real damage to the fiction on its way out: walking
    // out of a fight put out the fire you were carrying, cleared the stun mid
    // -sentence, and handed back a Deflect you had spent. What it protected
    // against - a status hanging on a sheet forever with nothing to tick it -
    // is exactly what the clock now prevents. Step-clock statuses (gum/bleed)
    // persisted through this all along; the two clocks agree at last.
    // Summons OUTLIVE the fight now (main.js keeps them until their assignment
    // runs out), with one exception: one that fell is gone for good. There is no
    // body to loot and no revive courtesy, so sweep it here rather than leaving
    // a toppled temp lying on the carpet forever.
    for (const m of members) if (m.isSummon && m.actor && m.sheet.hp <= 0) dismissSummon(m);
    // Drop the per-walk step hooks the AI installed. An enemy still MID-WALK
    // when the fight tears down keeps walking (actors run their path before the
    // paused check, and main.js updates every enemy each frame regardless of
    // gameOver), and the closure it was carrying belongs to a fight that no
    // longer exists: it dealt surface damage, logged into a panel already
    // removed from the DOM, and called onEnemyKilled - handing XP and a kill
    // line to a party that had just been wiped.
    for (const e of engaged) e.onTile = null;
    // Stand everyone up and drop the chips: the crouch map dies with this
    // closure, and without this the pose and the 'covered' status would
    // outlive the fight that meant them (the status only ticks on the combat
    // turn clock, so out of a fight it would simply never expire).
    for (const u of [...crouched.keys()]) breakCrouch(u, true);
    phase = 'done';
    app.off('update', update);
    aimPaint.destroy();
    // Only this REGION leaves - the dock and the slot row in it belong to the
    // half of the game that is still running.
    readout.destroy();
    costTag.remove();
    delete window.__combat;
  }

  function victory() {
    // Hand every borrowed coworker back BEFORE the fight closes, or one would
    // be carried into the roster the run is saved from.
    for (const m of charmedMembers()) releaseCharm(m);
    cleanup();
    callbacks.onWin();
  }
  function defeat() {
    cleanup();
    callbacks.onLose();
  }

  // --- player actions ------------------------------------------------------------
  function performOn(id, en) {
    const a = ACTIONS[id];
    // Footwork actions (the kick) need an un-gummed shoe.
    if (a.footwork && statusFx(active.sheet).noFootwork) {
      log('You wind up the kick... the gum disagrees. Pick something else.');
      armed = null;
      refresh();
      return;
    }
    // Rationed attacks (Detain) are rationed HERE too, not only on heals and
    // summons: the button gate alone left the counter frozen, so Detain fired
    // as often as the AP allowed while its tooltip went on promising "2 of 2
    // uses left this fight" forever.
    if (a.uses && active.usesLeft[id] <= 0) {
      log(`No ${a.label.toLowerCase()} left this fight.`);
      armed = null;
      refresh();
      return;
    }
    joinCombat(en); // attacking a bystander drags them into the fight
    // Spend the cost first: a miss still burns the AP, the paper and the use
    // (HIT_PLAN #4 - a swing that happened is spent whether or not it landed).
    // The projectile/lunge also fires either way.
    // A ranged attack flies; a melee one lunges. Keyed off rangeOf rather than
    // `ammoCost`, or a staple gun would lunge its owner across four desks into
    // the target's face - the exact thing holding a ranged weapon is for.
    if (rangeOf(id)) {
      if (a.ammoCost) active.sheet.paper -= ammoCostOf(id);
      let flight = 'shot'; // fired: a small pellet, flat and quick
      if (id === 'paper-airplane') flight = 'plane';
      else if (a.ammoCost) flight = 'ball';
      fx.projectile({ x: active.actor.x, z: active.actor.z }, { x: en.x, z: en.z }, flight);
    } else {
      active.actor.lunge(en.x, en.z);
    }
    faceTarget(active, en.x, en.z); // you face what you swing at
    active.ap = roundAp(active.ap - a.ap);
    if (a.uses) active.usesLeft[id] -= 1;
    // The attack roll: a miss spends the cost above and does nothing else - no
    // damage, no purge, no rider. Surprise, the attacker's accMod, the
    // target's dodgeMod (and later, position) are assembled by attackMods.
    if (!rollAgainst(active, en)) {
      hitFx(en, 'whiff');
      fx.damageText(en.x, en.z, 'MISS', MISS_COLOR);
      log(a.missLog || `${a.log} It misses.`);
      armed = null;
      refresh();
      return;
    }
    // AN ACTION WITH NO DICE IS A PURE EFFECT. Reboot is the case that forced
    // the rule: power-cycling somebody strips their statuses, it does not
    // bruise them, and the entry used to carry 4-7 damage that contradicted its
    // own description. Rolling `rand(undefined, undefined)` here produced NaN,
    // and NaN damage made hp NaN - never `<= 0`, so the target became
    // unkillable and the fight could not end. Reading the dice as the SIGNAL
    // means a dice-less verb resolves as what it is, rather than being a
    // special case bolted on beside a damage step it never wanted.
    const hasDice = Number.isFinite(a.min) && Number.isFinite(a.max);
    let dmg = 0;
    let died = false;
    if (hasDice) {
      dmg = rand(a.min, a.max) + damageBonus(active.sheet); // carried staplers count
      if (a.ammoCost) dmg += talentFxOf(active).paperDamageBonus || 0;
      died = en.takeDamage(dmg);
      // Anything that arrived from over there lands as a projectile hit, not a
      // punch: light debris thrown away from the shooter.
      hitFx(en, rangeOf(id) ? 'paper' : 'melee', active);
      if (died) deathFx(en);
      fx.damageText(en.x, en.z, `-${dmg}`, '#ffd76b', { big: died });
    }
    let line = hasDice ? `${a.log} ${dmg} damage!` : a.log;
    // A purge (reboot) wipes the target's statuses - good and bad alike.
    if (a.purge && !died) {
      const woke = hasStatus(en, 'surprised');
      clearStatuses(en);
      syncUnitSpeed(en); // the gum goes with it, and so does the limp
      if (woke) line += ' Their surprise is power-cycled away.';
    }
    // A status the action carries lands on a live target (enemies have no
    // Composure, so no resist). This is the player-action `applies` vector.
    // A window read BEFORE the apply, so a stun Detain can't land is narrated
    // rather than swallowed - checking after would see the window this very
    // application just granted.
    if (a.applies && !died) {
      const blocked = blockedBy(en, a.applies);
      if (applyStatus(en, a.applies)) {
        statusFxAt(en, a.applies);
        line += ` ${appliesLine(a, en.def.name)}`;
      } else if (blocked) line += ` ${immunityLine(blocked, en.def.name)}`;
    }
    // The equipped weapon's on-hit proc - but only when this attack IS that
    // weapon's own swing (swing the gum stapler, fling gum).
    const proc = weaponProc(active.sheet);
    if (proc && !died && id === equippedAction(active.sheet)
      && resolveProc(proc.chance) && applyStatus(en, proc.applies)) {
      statusFxAt(en, proc.applies);
      line += ` ${appliesLine(proc, en.def.name)}`;
    }
    log(line);
    if (died) callbacks.onEnemyKilled(en);
    armed = null; // back to movement mode after the swing
    refresh();
    if (!hostilesRemain()) victory();
  }

  // --- displacement, shared (POWERS_PLAN M2) -------------------------------
  // Push a body one tile along (dx, dz): onto whatever is behind them, or into
  // the solid thing that stops them. Lifted out of the shove so a `control`
  // carrying `displace` moves people by EXACTLY the same rules - the shove's
  // occupancy check, its wall-slam, its surface damage and its anti-chain
  // narration were a paragraph of behaviour trapped inside one click handler,
  // and a second verb that moved bodies would otherwise have grown a second,
  // subtly different copy of all of it.
  //
  // Returns { slammed, died, msg }; the caller logs. It does NOT spend AP or
  // clear `armed` - displacement is a consequence, not an action.
  function displaceBody(en, dx, dz, { verb = 'shove', slamDmg = 2 } = {}) {
    const push = displacePlan(en.x, en.z, dx, dz, {
      isWalkable: world.isWalkable,
      stepOpen: world.stepOpen,
      occupied: (x, z) => members.some((m) =>
        m.sheet.hp > 0 && m.actor && m.actor.x === x && m.actor.z === z),
    });
    if (!push) return { slammed: false, died: false, msg: '' };
    const { tx, tz } = push;
    if (push.blocked) {
      // The "something solid" they hit might be a bookcase (POWERS_PLAN M6).
      // Slamming somebody into a toppleable prop brings it down on them - the
      // shove already said "into something solid", and this is the rest of
      // that sentence. The topple's own damage and stun land on whoever is in
      // the LANDING tile, which the slammed body may or may not be.
      const plan = topplePlan(en, tx, tz);
      if (plan) {
        const died0 = en.takeDamage(slamDmg);
        hitFx(en, 'slam', active);
        if (died0) deathFx(en);
        if (slamDmg > 0) fx.damageText(en.x, en.z, `-${slamDmg}`, '#ffd76b', { big: died0 });
        const msg = `You ${verb} ${en.def.name} into the ${plan.def.label || 'furniture'}. `
          + `${slamDmg > 0 ? `-${slamDmg}. ` : ''}${topple(active, plan)}`;
        if (died0) callbacks.onEnemyKilled(en);
        return { slammed: true, died: died0, msg };
      }
      const died = slamDmg > 0 ? en.takeDamage(slamDmg) : false;
      hitFx(en, 'slam', active);
      fx.shake(0.06, 0.2); // a body meeting drywall
      if (died) deathFx(en);
      if (slamDmg > 0) fx.damageText(en.x, en.z, `-${slamDmg}`, '#ffd76b', { big: died });
      // A slam into a wall knocks the wind out of them - stunned (they lose
      // their next turn). The knockdown DOS2 shoves are for.
      let msg = `You ${verb} ${en.def.name} into something solid.${slamDmg > 0 ? ` -${slamDmg}.` : ''}`;
      // The shove is the one UNRATIONED stun in the game (2 AP, no use
      // limit), so it is the chain the anti-chain window exists to break -
      // and the site where the player most needs to be told why the second
      // slam didn't daze.
      if (!died) {
        const blocked = blockedBy(en, 'stunned');
        if (applyStatus(en, 'stunned')) {
          statusFxAt(en, 'stunned');
          msg += ` They crumple - ${STATUSES.stunned.name}, they lose their next turn.`;
        } else if (blocked) msg += ` ${immunityLine(blocked, en.def.name)}`;
      }
      if (died) callbacks.onEnemyKilled(en);
      return { slammed: true, died, msg };
    }
    en.pushTo(tx, tz);
    const dmg = world.enemySurfDamage(tx, tz);
    if (dmg > 0) {
      const live = world.isElectrified && world.isElectrified(tx, tz);
      const surf = world.surfaceIdAt(tx, tz);
      const died = en.takeDamage(dmg);
      fx.impact(tx, tz, hazardKind(tx, tz), { y: 0.4 });
      if (died) deathFx(en);
      fx.damageText(tx, tz, `-${dmg}`, '#ffd76b', { big: died });
      if (died) callbacks.onEnemyKilled(en);
      return {
        slammed: false,
        died,
        msg: `You ${verb} ${en.def.name} into the ${live ? 'LIVE water' : surf || 'hazard'}! -${dmg}.`,
      };
    }
    return { slammed: false, died: false, msg: `You ${verb} ${en.def.name} back a step.` };
  }

  // --- toppling (POWERS_PLAN M6) -------------------------------------------
  // Tall freestanding furniture goes over when shoved, and lands on whoever is
  // behind it. The office stops being scenery you fight IN and becomes
  // something you fight WITH - which is what the shove has been implying since
  // it started slamming people into walls.
  //
  // Whether the prop at (px, pz) can be knocked over by `from` right now, and
  // where it would land. Returns null when it cannot. Shared by the click, the
  // hover affordance and the AI, so all three agree.
  const topplePlan = (from, px, pz) => {
    const b = bodyOf(from);
    return toppleplanAt(b.x, b.z, px, pz, world);
  };

  // The AI's version of the same question - the victim test is combat's,
  // because only combat knows which side a body is on.
  const aiTopplePlan = (unit) => aiToppleplanFor(unit.x, unit.z, world,
    (x, z) => members.some((m) => m.sheet.hp > 0 && m.actor
      && m.actor.x === x && m.actor.z === z));

  // Put it over. `by` is whoever caused it (for the narration and the facing).
  function topple(by, plan) {
    const { def, x, z, lx, lz } = plan;
    const t = def.topple;
    // The prop leaves its tile and lands on the next one. setType is the same
    // call an exploding printer already makes, so the grid, the renderer and
    // pathfinding all re-read it exactly as they do for destruction.
    world.setType(x, z, 'floor');
    world.setType(lx, lz, t.becomes);
    fx.impact(lx, lz, 'slam', { y: 0.5 });
    fx.shake(0.11, 0.28); // a bookcase hitting the carpet is worth more than a punch
    let msg = `${def.label || 'It'} goes over.`;
    // Whoever is standing in the landing tile wears it - coworker, teammate or
    // you. A bookcase does not check your badge.
    msg += dropOnto(by, lx, lz, t.damage);
    return msg;
  }

  // Whatever just came down lands on (lx, lz): whoever stands there rolls the
  // Grit save (TACTICS_PLAN M6, designer: "a strength or whatever equivalent
  // check ... crushing damage and maybe pinned too"). Pass and they throw
  // themselves clear - no crush, no daze, no pin. Fail and they wear all of
  // it: the damage, the existing stun (anti-chain window intact), and PINNED
  // - rooted under the thing until they work free. Shared by the furniture
  // topple and the partition topple, so one save rule covers everything that
  // falls. `forceHit` pins the save too (true = the drop fully lands = the
  // save fails), so the specs stay deterministic. Returns the narration
  // fragment, leading space included, or '' for empty carpet.
  function dropOnto(by, lx, lz, range) {
    const victimUnit = world.liveEnemies().find((e) => e.x === lx && e.z === lz);
    const victimMember = members.find((m) => m.sheet.hp > 0 && m.actor
      && m.actor.x === lx && m.actor.z === lz);
    const dmg = rand(range[0], range[1]);
    const saved = (grit) => (forceHit !== null ? !forceHit : rollHit(gritSaveChance(grit), rng));
    let msg = '';
    if (victimUnit) {
      if (saved(victimUnit.def.grit ?? 2)) {
        victimUnit.flinch?.();
        return ` ${victimUnit.def.name} dives clear.`;
      }
      const died = victimUnit.takeDamage(dmg);
      hitFx(victimUnit, 'slam', by);
      if (died) deathFx(victimUnit);
      fx.damageText(lx, lz, `-${dmg}`, '#ffd76b', { big: died });
      msg += ` It lands on ${victimUnit.def.name}. -${dmg}.`;
      if (!died) {
        // `stunned`, not a new knocked-down: toppling inherits the anti-chain
        // immunity window rather than becoming a second way to lock somebody
        // out of a fight. Slam a guard into drywall and then drop a cabinet on
        // them and they get the same "they have had their daze" refusal, from
        // the same code. The pin is the failed save's own price and carries
        // no window - see `pinned` in data/statuses.js.
        const blocked = blockedBy(victimUnit, 'stunned');
        if (applyStatus(victimUnit, 'stunned')) {
          statusFxAt(victimUnit, 'stunned');
          msg += ' They go down under it.';
        } else if (blocked) msg += ` ${immunityLine(blocked, victimUnit.def.name)}`;
        if (applyStatus(victimUnit, 'pinned')) statusFxAt(victimUnit, 'pinned');
      } else {
        callbacks.onEnemyKilled(victimUnit);
      }
    } else if (victimMember) {
      if (saved(effectiveAttr(victimMember.sheet).grit)) {
        victimMember.actor.flinch();
        return ` ${victimMember.sheet.name} dives clear.`;
      }
      const dead = applyDamage(victimMember.sheet, dmg);
      hitFx(victimMember, 'slam', by);
      victimMember.actor.flinch();
      fx.damageText(lx, lz, `-${dmg}`, undefined, { big: dead });
      msg += ` It lands on ${victimMember.sheet.name}. -${dmg}.`;
      if (!dead) {
        applyStatus(victimMember.sheet, 'stunned', {}, statusResist(victimMember.sheet));
        statusFxAt(victimMember, 'stunned');
        if (applyStatus(victimMember.sheet, 'pinned')) statusFxAt(victimMember, 'pinned');
      } else {
        notifyMemberDown();
      }
    }
    return msg;
  }

  // Put a shoulder into the cubicle wall itself (TACTICS_PLAN M6, designer
  // 2026-07-30): the shove verb aimed across an adjacent partition edge. The
  // panel comes off its feet and lands FLAT on the far tile - walkable, no
  // cover: a board, not a bookcase - and whoever stands there rolls the same
  // Grit save everything falling already demands. Doors never topple; they
  // are not in the wall sets (grid.wallEdgeBetween). Returns true when the
  // click was a partition shove (refusals included), false to fall through.
  function performPartitionTopple(tx, tz) {
    const a = ACTIONS.shove;
    const me = { x: active.actor.x, z: active.actor.z };
    if (Math.abs(tx - me.x) + Math.abs(tz - me.z) !== 1) return false; // square-on, arm's reach
    if (!world.wallEdgeBetween(me.x, me.z, tx, tz)) return false;
    if (!world.terrainOpen(tx, tz)) {
      log('The partition rocks against whatever is behind it, and stays up.');
      return true;
    }
    if (active.ap < a.ap) { log('Not enough AP.'); return true; }
    active.ap = roundAp(active.ap - a.ap);
    active.actor.lunge(tx, tz);
    faceTarget(active, tx, tz);
    world.toppleEdge(me.x, me.z, tx, tz);
    world.setType(tx, tz, PARTITION_TOPPLE.becomes);
    fx.impact(tx, tz, 'slam', { y: 0.3 });
    fx.shake(0.08, 0.2);
    log(`You put a shoulder into the partition. It goes over flat.${dropOnto(active, tx, tz, PARTITION_TOPPLE.damage)}`);
    armed = null;
    refresh();
    if (!hostilesRemain()) victory();
    return true;
  }

  // --- breaking cover down (TACTICS_PLAN M8) --------------------------------
  // An attack aimed at the FURNITURE: melee and ranged both, per the designer
  // ("melee could gradually break down a barrier", clarified "melee and
  // ranged"). Only the cover-grade set carries an HP pool (data/tiles.js), and
  // at zero the object is REMOVED - not toppled, not substituted: "gone means
  // gone", because every other verb keeps the barrier in play. Objects do not
  // dodge `[proposed]`: the swing auto-hits, spends its full cost, and rolls
  // its normal damage - pricing is what keeps demolition from being free.

  // What the armed attack resolves on at (tx, tz): a breakable prop ON the
  // tile, or a partition edge - square-on for a swing (the topple's own aim),
  // or on the clicked tile's face TOWARD the shooter for a shot. Returns
  // { kind } to commit, { refusal } to explain, null to fall through. Melee
  // does not walk in for v1 `[proposed]` - the rings only promise reach.
  const breakPlanAt = (id, tx, tz) => breakPlan(id, active, tx, tz, world);

  // Put the hit in. One resolver for both shapes: spend, swing or shoot,
  // roll the dice into the pool, and either report the dent (the world
  // facade leans the mesh - the pool is hidden, the object wears it) or
  // watch the world facade delete the thing. The crouch behind it needs no
  // hook: refresh()'s revalidation finds the shield missing.
  function performBreak(id, plan) {
    const a = ACTIONS[id];
    if (active.ap < a.ap) { log('Not enough AP.'); return; }
    if (a.ammoCost && active.sheet.paper < ammoCostOf(id)) { log('Out of paper.'); return; }
    const prop = plan.kind === 'prop';
    const px = prop ? plan.tx : (plan.a[0] + plan.b[0]) / 2;
    const pz = prop ? plan.tz : (plan.a[1] + plan.b[1]) / 2;
    const label = prop
      ? (world.tileDefAt(plan.tx, plan.tz)?.label || 'furniture').toLowerCase()
      : 'partition';
    if (a.ammoCost) active.sheet.paper -= ammoCostOf(id);
    active.ap = roundAp(active.ap - a.ap);
    if (a.uses) active.usesLeft[id] -= 1;
    if (rangeOf(id)) {
      fx.projectile({ x: active.actor.x, z: active.actor.z }, { x: px, z: pz },
        a.ammoCost ? 'ball' : 'shot');
    } else {
      active.actor.lunge(px, pz);
    }
    faceTarget(active, px, pz);
    const dmg = rand(a.min, a.max) + damageBonus(active.sheet);
    const left = prop
      ? world.damageProp(plan.tx, plan.tz, dmg)
      : world.damageEdge(plan.a[0], plan.a[1], plan.b[0], plan.b[1], dmg);
    fx.damageText(px, pz, `-${dmg}`, '#ffd76b', { big: left === 0 });
    fx.impact(px, pz, 'slam', { y: 0.4 });
    if (left === 0) {
      fx.shake(0.09, 0.24);
      log(prop
        ? `The ${label} comes apart. The office is short one piece of cover.`
        : 'The partition comes apart. Open plan, the hard way.');
    } else {
      log(`You lay into the ${label}. -${dmg}.${left <= dmg ? ' It is coming apart.' : ''}`);
    }
    armed = null;
    refresh(); // any crouch behind it revalidates here
    if (!hostilesRemain()) victory();
  }

  // --- take cover (TACTICS_PLAN M6) -----------------------------------------

  // Whoever is standing on (x, z) - member, summon or coworker. The take-cover
  // verb treats any body as a shield ("any character as cover", designer).
  function unitStandingAt(x, z) {
    const m = members.find((u) => standing(u) && u.actor && u.actor.x === x && u.actor.z === z);
    if (m) return m;
    return engaged.find((e) => e.alive && e.x === x && e.z === z) || null;
  }

  // Tuck `unit` in WHERE THEY STAND. Shared by the player's verb and the AI's
  // turtle beat, so both sides crouch by identical rules. Hopping cover-to
  // -cover replaces the old crouch - the verb has no cooldown and no need to
  // stand up first (designer).
  //
  // One entry point where there were two (`crouchAt` behind a cell,
  // `crouchAtEdges` against the partitions), because there is one rule now:
  // the faces of the tile you are on. `faceToward` points you at the middle of
  // whatever is covering you, which for a corner is the diagonal between the
  // two walls - the pose reads as "tucked into the corner" rather than
  // arbitrarily facing one of them.
  function crouchHere(unit) {
    breakCrouch(unit, true);
    const b = bodyOf(unit);
    const faces = crouchFacesOf(unit);
    if (!faces.length) return false;
    crouched.set(unit, { at: { x: b.x, z: b.z }, faces });
    b.crouched = true; // the held pose (actors.js): torso down onto the legs
    applyStatus(carrierOf(unit), 'covered');
    statusFxAt(unit, 'covered');
    const fx_ = faces.reduce((acc, [ox, oz]) => [acc[0] + ox, acc[1] + oz], [0, 0]);
    if (fx_[0] || fx_[1]) (unit.actor || unit).faceToward?.(b.x + fx_[0], b.z + fx_[1]);
    log(`${nameOf(unit)} tucks in behind ${coverNames(b.x, b.z, faces)}.`);
    return true;
  }
  // What is covering you, in words: "the partition", "the filing cabinet and
  // Dave". Named from the faces rather than a mode, so a corner reads as the
  // two things it actually is instead of a singular "the partition" that was
  // wrong the moment there was more than one.
  function coverNames(x, z, faces) {
    const seen = [];
    for (const [ox, oz] of faces) {
      const body = unitStandingAt(x + ox, z + oz);
      if (body) { if (!seen.includes(nameOf(body))) seen.push(nameOf(body)); continue; }
      const d = world.tileDefAt(x + ox, z + oz);
      const label = d && (d.cover || d.solid)
        ? `the ${(d.label || 'cover').toLowerCase()}` : 'the partition';
      if (!seen.includes(label)) seen.push(label);
    }
    if (!seen.length) return 'cover';
    if (seen.length === 1) return seen[0];
    return `${seen.slice(0, -1).join(', ')} and ${seen[seen.length - 1]}`;
  }

  // The player's verb: walk to the shield and crouch. Priced as "the walk,
  // plus 1 AP" (designer: distance cost + 1) - the walk is billed by the same
  // movement engine as every other step, the +1 is the action's own `ap`, and
  // the crouch resolves ON ARRIVAL (the pendingMelee pattern), so a walk cut
  // short by an opportunity attack downs the crouch with it.
  // You aim at the SPOT YOU WANT TO STAND, not at a shield. That inversion is
  // the whole fix: naming a shield made the side you ended up on an output of
  // `coverSpot`, so the aim emblem hopped between that object's free
  // neighbours and there was no way to say "the other side of Dave"
  // (designer, 2026-07-31). Aiming at the ground answers it by construction -
  // west of Dave and east of Dave are two different aim points - and it is
  // what makes a continuous aim meaningful, since a floor position varies
  // smoothly where "which object" cannot.
  //
  // A spot is legal when you could stand on it and at least one of its faces
  // is shielded. What is doing the shielding never comes up.
  function coverSpotProblem(tx, tz) {
    const here = active.actor.x === tx && active.actor.z === tz;
    const occupant = unitStandingAt(tx, tz);
    if (!here && (!world.isWalkable(tx, tz) || (occupant && occupant !== active))) {
      return 'No room to tuck in there.';
    }
    if (!shieldedFaces(tx, tz, {
      edgeOpen: world.stepOpen,
      coverCell: coverCellFor(active),
    }).length) return 'Nothing there to hide behind.';
    return null;
  }

  function performTakeCover(tx, tz) {
    const a = ACTIONS['take-cover'];
    const problem = coverSpotProblem(tx, tz);
    if (problem) { log(problem); return; }
    if (active.ap < a.ap) { log('Not enough AP.'); return; }
    armed = null;
    if (active.actor.x === tx && active.actor.z === tz) {
      active.ap = roundAp(active.ap - a.ap);
      crouchHere(active);
      refresh();
      return;
    }
    const path = world.findPath(active.actor.x, active.actor.z, tx, tz, active.actor);
    if (!path || path.length < 2) { log('No clear way in behind it.'); return; }
    // Reserve the crouch's own AP out of the walk budget, exactly as a
    // walk-up shot reserves its trigger pull. Same honest split as the
    // walk-ups: a degenerate route is not an AP problem.
    const crouchBudget = moveBudget(active) - a.ap;
    const walk = walkActive(path, crouchBudget);
    if (!walk) {
      log(crouchBudget > 0.05 ? 'No closer way in.' : 'Not enough AP to reach it.');
      return;
    }
    if (walk.done && Math.round(walk.end[0]) === tx && Math.round(walk.end[1]) === tz) {
      pendingCrouch = { spot: [tx, tz] };
    } else {
      log('You close the distance toward cover.');
    }
  }

  // The AI's turtle beat: with nobody in reach and nowhere useful to walk, a
  // unit tucks in behind an adjacent cell that actually stands between it and
  // its target - crouching on the WRONG side of the desk is worse than
  // standing there looking available, so no shielding neighbour means no
  // crouch. Symmetric by decision #11; ratified for v1 (designer, 2026-07-30).
  function tryAiCrouch(unit, target) {
    const coverAp = ACTIONS['take-cover'].ap;
    if (crouched.has(unit) || acting.ap < coverAp || !target) return false;
    if (canReach(unit, target)) return false; // melee ignores cover - swing instead
    const b = bodyOf(unit);
    const t = bodyOf(target);
    if (!aiCrouchCovered(b.x, b.z, t.x, t.z, {
      tileDefAt: world.tileDefAt,
      stepOpen: world.stepOpen,
      bodyAt: (x, z) => { const u = unitStandingAt(x, z); return !!u && u !== unit && standing(u); },
    })) return false;
    if (!crouchHere(unit)) return false;
    acting.ap = roundAp(acting.ap - coverAp);
    refresh();
    return true;
  }

  // --- Pull Over (TACTICS_PLAN M8) ------------------------------------------
  // The third universal cover verb (designer: "all cover related moves are
  // universal"): reach across the thing a target crouches behind and haul
  // them onto your side of it. The barrier STAYS STANDING - the shove
  // relocates cover, the break-down deletes it, this one moves the PERSON -
  // and the trip over is dropOnto's own Grit save arrived at from the far
  // side: pass lands them on their feet, fail wears the crush, the existing
  // stun, and the pin.

  // Can the pull haul `en` right now, and where do they land? Null when any
  // leg fails. pullRefusal walks the same legs in the same order, so the
  // click's explanation can never disagree with the plan.
  // The target's crouch as the PULLER sees it: validated as always, but with
  // the puller's own body not counted among what covers them. Standing beside
  // somebody is how you reach over their barrier, not a barrier of your own.
  const pullCrouchOf = (en) => {
    const s = crouchStateOf(en);
    return s && { ...s, faces: crouchFacesOf(en, active) };
  };
  const pullPlanned = (en) => pullplanFor(active, en, pullCrouchOf(en), {
    stepOpen: world.stepOpen,
    open: (x, z) => world.isWalkable(x, z) && !unitStandingAt(x, z),
    bodyAt: (x, z) => {
      const u = unitStandingAt(x, z);
      return !!u && u !== en && u !== active && standing(u);
    },
    name: en.def.name,
  });
  // The two faces the click wants: the plan when it works, the reason when it
  // does not. One walk down the legs underneath, so they cannot disagree.
  const pullPlanFor = (en) => {
    const r = pullPlanned(en);
    return r.refusal ? null : { s: r.crouch, landing: r.landing };
  };
  const pullRefusal = (en) => pullPlanned(en).refusal;

  function performPull(id, en, plan) {
    const a = ACTIONS[id];
    const [lx, lz] = plan.landing;
    const what = crouchLabel(plan.s);
    active.actor.lunge(en.x, en.z);
    faceTarget(active, en.x, en.z);
    // The crouch dies in your fist, quietly - the haul is the story. pushTo
    // is forced movement: no provoke, no per-tile hooks, the shove's seam.
    breakCrouch(en, true);
    en.pushTo(lx, lz);
    let msg = `You haul ${en.def.name} over the ${what}.`;
    // The same save everything manhandled rolls (stats.gritSaveChance), with
    // the same forceHit pin for the specs: true = the haul fully lands.
    const saved = forceHit !== null ? !forceHit : rollHit(gritSaveChance(en.def.grit ?? 2), rng);
    if (saved) {
      en.flinch?.();
      msg += ' They twist and land on their feet.';
    } else {
      const dmg = rand(a.crush[0], a.crush[1]);
      const died = en.takeDamage(dmg);
      hitFx(en, 'slam', active);
      if (died) deathFx(en);
      fx.damageText(lx, lz, `-${dmg}`, '#ffd76b', { big: died });
      msg += ` They come down hard. -${dmg}.`;
      if (!died) {
        const blocked = blockedBy(en, 'stunned');
        if (applyStatus(en, 'stunned')) {
          statusFxAt(en, 'stunned');
          // Name the status the HUD chip names, and say what it costs them.
          // "Dazed." named nothing on the sheet and sounded like a to-hit
          // penalty; the status is a SKIPPED TURN (designer, 2026-07-31: "what
          // does it do?"), and a lost turn is worth reading as one.
          msg += ` ${STATUSES.stunned.name} - they lose their next turn.`;
        } else if (blocked) msg += ` ${immunityLine(blocked, en.def.name)}`;
        if (applyStatus(en, 'pinned')) statusFxAt(en, 'pinned');
      } else {
        callbacks.onEnemyKilled(en);
      }
    }
    // Landing them in a hazard is the puller's gift to give - the same
    // surface rule the shove's glide applies.
    if (en.alive) {
      const sdmg = world.enemySurfDamage(lx, lz);
      if (sdmg > 0) {
        const died = en.takeDamage(sdmg);
        fx.impact(lx, lz, hazardKind(lx, lz), { y: 0.4 });
        if (died) deathFx(en);
        fx.damageText(lx, lz, `-${sdmg}`, '#ffd76b', { big: died });
        msg += ` The landing is ${world.isElectrified && world.isElectrified(lx, lz) ? 'LIVE' : 'a hazard'}. -${sdmg}.`;
        if (died) callbacks.onEnemyKilled(en);
      }
    }
    log(msg);
    armed = null;
    refresh();
    if (!hostilesRemain()) victory();
  }

  // --- the mobility verb (POWERS_PLAN M4) ----------------------------------
  // Repositioning that the AP economy cannot buy. A dash carries you a fixed
  // DISTANCE for a flat cost; a swap trades places with a teammate across the
  // room. Both are free of opportunity attacks, and that is the point: until
  // now the only answer to the threat ring was the Manager's `noProvoke`
  // talent, which is a passive nobody chooses in the moment. This is the
  // counterplay as a decision.
  //
  // NOT provoking is achieved by NOT calling beginMove: `notifyStep` only
  // punishes a mover it has a `moveStart` record for, which is the same seam a
  // shove glide already uses ("forced movement never provokes", TACTICS_PLAN
  // #9). Granted movement joins forced movement rather than growing a second
  // exemption the threat code would have to learn.
  function performDash(id, tx, tz, point) {
    const a = ACTIONS[id];
    const problem = mobilityProblem(a, {
      ap: active.ap,
      usesLeft: a.uses ? active.usesLeft[id] ?? 0 : null,
    });
    if (problem) { lastClickOutcome = `refused:${problem}`; log(problem); return; }
    const raw = (tx === active.actor.x && tz === active.actor.z)
      ? null
      : world.findPath(active.actor.x, active.actor.z, tx, tz, active.actor);
    if (!raw || raw.length < 2) { log('No route there.'); return; }
    const end = point ? world.clampPoint(point.x, point.z) : null;
    const smoothed = world.smooth(end ? [...raw.slice(0, -1), end] : raw, active.actor);
    // Truncated by DISTANCE, at a flat cost per tile-length, so the terrain's
    // `slow` does not tax a dash the way it taxes a walk. A dash that got
    // shorter through coffee would be a walk with extra steps.
    const { points, done } = truncateByBudget(smoothed, dashDistanceOf(a), () => 1);
    if (points.length < 2) { log('Nowhere to go.'); return; }
    active.ap = roundAp(active.ap - a.ap);
    if (a.uses) active.usesLeft[id] -= 1;
    hidePreview();
    active.actor.setPath(points); // deliberately WITHOUT beginMove - see above
    log(done ? a.log : `${a.log} You run out of corridor.`);
    armed = null;
    refresh();
  }

  // Trade places with a teammate. Both bodies move, neither provokes, and the
  // swap is legal even when the two tiles could not be walked between - it is
  // a courier's trick, not a route.
  function performSwap(id, m) {
    const a = ACTIONS[id];
    const problem = mobilityProblem(a, {
      dist: cheb(active.actor.x, active.actor.z, m.actor.x, m.actor.z),
      los: world.hasLos(active.actor.x, active.actor.z, m.actor.x, m.actor.z),
      ap: active.ap,
      usesLeft: a.uses ? active.usesLeft[id] ?? 0 : null,
      allyHp: m.sheet.hp,
    });
    if (problem) { lastClickOutcome = `refused:${problem}`; log(problem); return; }
    if (m === active) { log('You are already there.'); return; }
    const mine = { x: active.actor.x, z: active.actor.z };
    const theirs = { x: m.actor.x, z: m.actor.z };
    active.ap = roundAp(active.ap - a.ap);
    if (a.uses) active.usesLeft[id] -= 1;
    // pushTo is the existing "move a body without it counting as a walk" call
    // (the shove's glide). Using it here means the swap cannot provoke and
    // cannot trigger a per-tile hazard hook mid-flight.
    // Both bodies changed tiles, so neither crouch survives - the swap is
    // exactly the "pull the wounded out of cover" verb (TACTICS_PLAN M6);
    // refresh()'s revalidation would catch it, but breaking here logs it in
    // the same beat as the trade instead of a surprise line later.
    breakCrouch(active);
    breakCrouch(m);
    active.actor.pushTo(theirs.x, theirs.z);
    m.actor.pushTo(mine.x, mine.z);
    log(`${a.log} You and ${m.sheet.name} trade places.`);
    armed = null;
    refresh();
  }

  // --- the zone verb (POWERS_PLAN M3) --------------------------------------
  // `leaves` used to be welded to the cone attack, so the only way to put
  // paper on the floor was to also swing at somebody. Freed into its own verb,
  // placing a surface becomes a PLAN - fuel you lay before you light it,
  // caltrops across the doorway they have to come through - and it hands the
  // fire/conduction simulation a player-driven source instead of only the
  // hazards the level author painted.
  //
  // Which tiles a zone may actually take, given the grid: plain floor only
  // (leaveSurface's own rule), never under a living body. Shared by the click
  // and the preview so the tiles you saw are the tiles you get.
  // The zone's covered tiles - the geometry in combat-geometry.js, the
  // occupancy question answered here because only combat knows who is standing
  // where.
  const zoneCells = (a, tx, tz) => zoneCellsFor(a, active.actor, tx, tz, {
    canTakeSurface: world.canTakeSurface,
    hasLos: world.hasLos,
    occupied: (x, z) => members.some((m) => m.sheet.hp > 0 && m.actor?.x === x && m.actor?.z === z)
      || world.liveEnemies().some((e) => e.x === x && e.z === z),
  });

  function performZone(id, tx, tz) {
    const a = ACTIONS[id];
    const problem = zoneProblem(a, {
      dist: cheb(active.actor.x, active.actor.z, tx, tz),
      los: world.hasLos(active.actor.x, active.actor.z, tx, tz),
      ap: active.ap,
      usesLeft: a.uses ? active.usesLeft[id] ?? 0 : null,
    });
    if (problem) { lastClickOutcome = `refused:${problem}`; log(problem); return; }
    const cells = zoneCells(a, tx, tz);
    active.ap = roundAp(active.ap - a.ap);
    if (a.uses) active.usesLeft[id] -= 1;
    faceTarget(active, tx, tz);
    active.actor.lunge(tx, tz);
    let laid = 0;
    for (const [x, z] of cells) {
      if (world.leaveSurface(x, z, a.leaves, a.leavesTurns || 0)) laid += 1;
    }
    // Saying how much of it landed matters more here than on any other verb:
    // the tiles a zone can take are whatever happens to be plain floor, so the
    // same click over carpet and over a cubicle row spends the same AP for
    // very different results, and silence would read as a dud.
    log(laid ? `${a.log} ${laid} tile${laid > 1 ? 's' : ''} covered.` : `${a.log} Nothing here will take it.`);
    armed = null;
    aimPoint = null;
    refresh();
  }

  // --- the control verb (POWERS_PLAN M2) -----------------------------------
  // Control deals NO damage. That is the design rule, not an omission: a power
  // that stuns AND hits is two powers, and the AP economy (2 AP against a 5-7
  // pool) cannot price both. It still rolls to hit, because a guaranteed stun
  // at 2 AP is the degenerate case - and because HIT_PLAN's "a miss spends the
  // cost and does nothing else" is what keeps the anti-chain window from being
  // the only counterplay control has.
  function performControl(id, en) {
    const a = ACTIONS[id];
    const ranged = controlIsRanged(a);
    const problem = controlProblem(a, {
      dist: cheb(active.actor.x, active.actor.z, en.x, en.z),
      los: world.hasLos(active.actor.x, active.actor.z, en.x, en.z),
      inReach: canReach(active, en),
      ap: active.ap,
      usesLeft: a.uses ? active.usesLeft[id] ?? 0 : null,
      alive: en.alive,
    });
    if (problem) { lastClickOutcome = `refused:${problem}`; log(problem); return; }
    joinCombat(en);
    // Spend first, as every other action does: a miss burns the AP and the use
    // (HIT_PLAN #4).
    active.ap = roundAp(active.ap - a.ap);
    if (a.uses) active.usesLeft[id] -= 1;
    if (ranged) {
      fx.projectile({ x: active.actor.x, z: active.actor.z }, { x: en.x, z: en.z }, 'ball');
    } else {
      active.actor.lunge(en.x, en.z);
    }
    faceTarget(active, en.x, en.z);
    if (!rollAgainst(active, en)) {
      hitFx(en, 'whiff');
      fx.damageText(en.x, en.z, 'MISS', MISS_COLOR);
      log(a.missLog || `${a.log} It does not take.`);
      armed = null;
      refresh();
      return;
    }
    const plan = controlOutcome(a);
    let line = a.log || `${a.label}.`;
    // The status first, THEN the displacement: a control that both roots and
    // pushes should root them where they LAND, and the reverse order would
    // also let a lethal slam swallow the status silently.
    if (plan.applies) {
      const blocked = blockedBy(en, plan.applies);
      if (applyStatus(en, plan.applies, {}, 0)) {
        statusFxAt(en, plan.applies);
        line += ` ${appliesLine(a, en.def.name)}`;
        // `charmed` is the one status that changes which SIDE somebody is on
        // rather than anything about them, so the roster and turn-order move
        // happens here rather than in an `effects` block the status system
        // would have to learn a whole new kind of.
        if (plan.applies === 'charmed') charmUnit(en, STATUSES.charmed.duration);
      } else if (blocked) line += ` ${immunityLine(blocked, en.def.name)}`;
    }
    if (plan.displace) {
      const dx = Math.sign(en.x - active.actor.x) * plan.displace;
      const dz = Math.sign(en.z - active.actor.z) * plan.displace;
      const res = displaceBody(en, dx, dz, { verb: 'send', slamDmg: 0 });
      if (res.msg) line += ` ${res.msg}`;
    }
    log(line);
    armed = null;
    refresh();
    if (!hostilesRemain()) victory();
  }

  // What a landed melee action DOES on arrival. The walk-up path and the
  // already-in-reach path both route through here, so a control that walked
  // you in resolves as a control and not as a swing - the one dispatch a new
  // touch-range verb has to join, instead of a branch in each of the three
  // places that finish an approach.
  const strike = (id, en) => (isControl(ACTIONS[id]) ? performControl(id, en) : performOn(id, en));

  // --- the friendly verb (POWERS_PLAN M1) ----------------------------------
  // Everyone a buff may be aimed at: living party members AND your summons,
  // yourself included. A summon is a member with a sheet, so healing or
  // commending one is free of special cases - which is the payoff for
  // SUMMON_PLAN having made player-side summons real members rather than a
  // parallel kind of thing.
  const friendlies = () => livingMembers();

  // The ally whose BODY is nearest this ground point, or null. The friendly
  // twin of enemyAtPoint, measured against continuous positions for the same
  // reason: the logical tile is rounded, and at this camera angle a tall mesh
  // reads a tile off.
  function allyAtPoint(point) {
    if (!point) return null;
    let best = null;
    for (const m of friendlies()) {
      const p = posOf(m);
      const d = Math.hypot(p.x - point.x, p.z - point.z);
      if (d < 0.7 && (!best || d < best.d)) best = { m, d };
    }
    return best?.m || null;
  }

  // Why an ally-aimed action cannot land on this teammate, or null. ONE
  // dispatch for the two verbs that point at friends, so the rings, the cursor
  // and the click ask the same question of both - three call sites each
  // consulting its own verb's rule is exactly how the crosshair and the
  // readout came to disagree once already.
  const allyProblemFor = (id, m) => {
    const a = ACTIONS[id];
    const common = {
      ...buffReach(m),
      ap: active.ap,
      usesLeft: a.uses ? active.usesLeft[id] ?? 0 : null,
    };
    if (isMobility(a)) return mobilityProblem(a, { ...common, allyHp: m.sheet.hp });
    return buffProblem(a, {
      ...common,
      hp: m.sheet.hp,
      maxHp: m.sheet.maxHp,
      statusCount: statusList(m.sheet).length,
    });
  };

  // Distance and line to an ally, in the units buffProblem expects.
  const buffReach = (m) => ({
    dist: cheb(active.actor.x, active.actor.z, m.actor.x, m.actor.z),
    // Aiming at yourself never needs a line to yourself - and hasLos on your
    // own tile is a degenerate trace that has no reason to be asked.
    los: m === active || world.hasLos(active.actor.x, active.actor.z, m.actor.x, m.actor.z),
  });

  // Commit a buff on an ally. No hit roll: you do not miss a colleague you are
  // trying to help, and gating a support action behind the same whiff that
  // gates a swing would make the support class the one that fails at its job
  // (HIT_PLAN gates DAMAGE, which this deals none of).
  function performBuff(id, m) {
    const a = ACTIONS[id];
    const problem = buffProblem(a, {
      ...buffReach(m),
      hp: m.sheet.hp,
      maxHp: m.sheet.maxHp,
      statusCount: statusList(m.sheet).length,
      ap: active.ap,
      usesLeft: a.uses ? active.usesLeft[id] ?? 0 : null,
    });
    if (problem) { lastClickOutcome = `refused:${problem}`; log(problem); return; }
    const plan = buffOutcome(a, { hp: m.sheet.hp, maxHp: m.sheet.maxHp });
    active.ap = roundAp(active.ap - a.ap);
    if (a.uses) active.usesLeft[id] -= 1;
    if (m !== active) faceTarget(active, m.actor.x, m.actor.z);
    const who = m === active ? 'yourself' : m.sheet.name;
    let line = `${a.log || a.label + '.'}`;
    if (plan.purges) {
      clearStatuses(m.sheet);
      line += m === active
        ? ' Everything you were carrying clears.'
        : ` Everything ${m.sheet.name} was carrying clears.`;
    }
    if (plan.healed > 0) {
      m.sheet.hp += plan.healed;
      hitFx(m, 'heal');
      fx.damageText(m.actor.x, m.actor.z, `+${plan.healed}`, '#8adf76');
      line += ` +${plan.healed} HP.`;
    }
    // A buff is never resisted - `commended`/`onboarded` are resistable:false,
    // so the resist argument would be inert anyway, but passing the target's
    // own Composure would be actively wrong: it would make helping a composed
    // teammate WORSE than helping a rattled one.
    if (plan.applies && applyStatus(m.sheet, plan.applies)) {
      statusFxAt(m, plan.applies);
      line += ` ${appliesLine(a, who)}`;
    }
    log(line);
    armed = null;
    refresh();
  }

  // A click on a friendly body while a buff is armed. Mirrors
  // handleEnemyClick's gate exactly - your turn, standing still - so the two
  // halves of the board refuse for the same reasons.
  function handleAllyClick(m) {
    if (phase !== 'player' || active.actor.moving || !m?.actor || m.sheet.hp <= 0) {
      lastClickOutcome = phase !== 'player' ? 'gate:phase'
        : (active.actor.moving ? 'gate:moving' : 'gate:dead');
      return;
    }
    if (!armed || !aimsAtAlly(ACTIONS[armed])) return false;
    hidePreview();
    lastClickOutcome = 'acted';
    if (isMobility(ACTIONS[armed])) performSwap(armed, m);
    else performBuff(armed, m);
    return true;
  }

  // Fire an armed cone attack toward (tx, tz): per-target damage rolls for
  // every enemy in the wedge with line of sight, then the wedge's plain floor
  // is carpeted with the action's `leaves` surface.
  function fireCone(tx, tz) {
    const a = ACTIONS[armed];
    if (active.ap < a.ap) { log('Not enough AP.'); return; }
    const test = coneTest(a, tx, tz);
    if (!test) { log('Aim somewhere.'); return; }
    // A rationed cone (All Hands) spends its use here. fireCone never
    // decremented one because the only cone that existed was unlimited - which
    // is exactly the bug Detain already had on the single-target path: a
    // counter that never moves while the tooltip goes on promising uses left.
    if (a.uses) {
      if (active.usesLeft[armed] <= 0) { log(`No ${a.label.toLowerCase()} left this fight.`); return; }
      active.usesLeft[armed] -= 1;
    }
    active.ap = roundAp(active.ap - a.ap);
    active.actor.lunge(tx, tz);
    faceTarget(active, tx, tz); // the cone points where you aimed it
    let hits = 0;
    for (const en of world.liveEnemies()) {
      // Same body-radius test the ring previewed - what you saw is what lands.
      const bp = en.entity ? en.entity.getPosition() : { x: en.x, z: en.z };
      if (!test(bp.x, bp.z, TARGET_R)) continue;
      if (!world.hasLos(active.actor.x, active.actor.z, en.x, en.z)) continue;
      joinCombat(en); // a bystander caught in the mail joins the fight
      fx.projectile({ x: active.actor.x, z: active.actor.z }, { x: en.x, z: en.z }, 'plane');
      // Roll per target. A dodged envelope flies but doesn't land; the wedge's
      // `leaves` surface still carpets below (HIT_PLAN #4). A surprised target
      // is easier to catch.
      if (!rollAgainst(active, en)) {
        hitFx(en, 'whiff');
        fx.damageText(en.x, en.z, 'MISS', MISS_COLOR);
        continue;
      }
      // A CONTROL cone (All Hands) lands its status on everyone it catches and
      // rolls no damage - the verb's rule holds whether it is aimed at one
      // coworker or a wedge of them. Sharing fireCone rather than forking it is
      // what keeps the wedge geometry, the LOS test and the per-target roll
      // identical between the two.
      if (isControl(a)) {
        const blocked = blockedBy(en, a.applies);
        if (a.applies && applyStatus(en, a.applies, {}, 0)) {
          statusFxAt(en, a.applies);
          hits += 1;
        } else if (blocked) {
          log(immunityLine(blocked, en.def.name));
        }
        continue;
      }
      const dmg = rand(a.min, a.max) + damageBonus(active.sheet);
      const died = en.takeDamage(dmg);
      hitFx(en, 'paper', active);
      if (died) deathFx(en);
      fx.damageText(en.x, en.z, `-${dmg}`, '#ffd76b', { big: died });
      hits += 1;
      if (died) callbacks.onEnemyKilled(en);
    }
    if (a.leaves) {
      const R = Math.ceil(a.cone.range);
      for (let z = Math.floor(test.origin.z) - R; z <= Math.ceil(test.origin.z) + R; z++) {
        for (let x = Math.floor(test.origin.x) - R; x <= Math.ceil(test.origin.x) + R; x++) {
          if (!test(x, z)) continue;
          // No carpeting a tile a party member is standing on.
          if (members.some((m) => m.sheet.hp > 0 && m.actor?.x === x && m.actor?.z === z)) continue;
          if (!world.hasLos(active.actor.x, active.actor.z, x, z)) continue;
          world.leaveSurface(x, z, a.leaves, a.leavesTurns || 0);
        }
      }
    }
    log(isControl(a)
      ? (hits
        ? `${a.log} ${hits} caught.`
        : `${a.log} Nobody in the room is having it.`)
      : (hits
        ? `${a.log} ${hits} hit${hits > 1 ? 's' : ''}. The paperwork settles everywhere.`
        : `${a.log} No casualties. Plenty of litter.`));
    armed = null;
    aimPoint = null;
    refresh();
    if (!hostilesRemain()) victory();
  }

  // Clicking a coworker with nothing armed is an attack - the basic swing from
  // whatever is in your hand (stats.equippedAction; bare hands fall back to
  // 'punch'). The old behavior was a nag ("choose an action first"), which made
  // the most obvious verb in the game the one thing a click could NOT do. Arming
  // a power still overrides it; that's what arming is for.
  const defaultAttack = () => equippedAction(active.sheet);
  // What a click on a coworker would use RIGHT NOW: whatever you armed, else
  // that basic swing. Every preview reads this - the target rings, the to-hit
  // tag, and (through main.js) the cursor - so the affordances always describe
  // the swing that would actually land rather than only the armed case.
  const previewAction = () => (phase === 'player' && active?.sheet ? (armed || defaultAttack()) : null);

  function handleEnemyClick(en) {
    if (phase !== 'player' || active.actor.moving || !en.alive) {
      // This return is SILENT by design - a click on an AI turn or mid-walk
      // is simply ignored - which also made it invisible in flake traces:
      // "the click did nothing and nothing said why". The breadcrumb names
      // the reason for the e2e suite without changing behavior.
      lastClickOutcome = phase !== 'player' ? 'gate:phase'
        : (active.actor.moving ? 'gate:moving' : 'gate:dead');
      return;
    }
    hidePreview();
    let autoArmed = false;
    if (!armed) {
      // Not enough AP for even the basic swing: say so once, rather than
      // silently walking them into the enemy's face.
      const id = defaultAttack();
      if (active.ap < ACTIONS[id].ap) { log('Not enough AP to attack.'); return; }
      armed = id;
      autoArmed = true;
      refresh(); // the bar lights the swing that is about to happen
    }
    // A refusal keeps a USER-armed action armed - aim survives a near-miss,
    // right-click lowers it. The default the click just auto-armed is not
    // aim: the player never raised it, so a refusal must put it back down.
    // Left dangling, it sat lit on the bar until a right-click, and anything
    // waiting for the swing to resolve (the e2e idle() helper) hung forever.
    const refuse = (msg) => {
      lastClickOutcome = `refused:${msg}`;
      log(msg);
      if (autoArmed) { armed = null; refresh(); }
    };
    lastClickOutcome = 'acted'; // overwritten by refuse(); the gate stamped its own
    const a = ACTIONS[armed];
    // WHICH verb this click is, from the same classifier the target rings
    // dispatch on (combat-targeting.verbKind). Two hand-written ladders of
    // `a.type` tests in slightly different orders is exactly how the rings came
    // to contradict the click; there is one ladder now, and the arms below are
    // what each branch DOES.
    const kind = verbKind(a, rangeOf(armed));
    // Take Cover clicked on a coworker: they are the shield ("any character
    // as cover" - crouching behind your enemy is legal, if bold).
    if (kind === 'cover') { performTakeCover(en.x, en.z); return; }
    if (kind === 'cone') { fireCone(en.x, en.z); return; }
    // Placing a summon on top of a coworker: the tile is taken, so they report
    // to the free ground ringing outward from it. Aiming at the enemy you want
    // them to swarm is a reasonable thing to click.
    if (kind === 'summon') { placeSummon(en.x, en.z); return; }
    // Aiming a zone at a coworker is a reasonable thing to click - you want it
    // under THEM - so it resolves on their tile rather than refusing. Their own
    // tile is excluded from the footprint (zoneCells), so what lands is the
    // ring around their feet.
    if (kind === 'zone') { performZone(armed, en.x, en.z); return; }
    // A RANGED control (a cone, or one carrying `range`) resolves from where
    // you stand. A touch-range one classifies as 'melee' and falls through to
    // the walk-up below rather than getting its own copy of it - and `strike`
    // is what makes the arrival resolve as a control instead of a swing.
    if (kind === 'control') { performControl(armed, en); return; }
    if (kind === 'shove') {
      if (!canReach(active, en, REACH.SHOVE)) {
        // Out of reach - but the office between you might BE the shove: a
        // cubicle wall to bring down on them (designer, 2026-07-30)...
        if (performPartitionTopple(en.x, en.z)) return;
        // ...or furniture beside you whose fall lands exactly on them. One
        // gesture: click the coworker behind the cabinet, wear the cabinet.
        for (const [dx, dz] of AROUND) {
          const plan = topplePlan(active, active.actor.x + dx, active.actor.z + dz);
          if (!plan || plan.lx !== en.x || plan.lz !== en.z) continue;
          if (active.ap < a.ap) { refuse('Not enough AP.'); return; }
          active.ap = roundAp(active.ap - a.ap);
          active.actor.lunge(plan.x, plan.z);
          faceTarget(active, plan.x, plan.z);
          log(topple(active, plan));
          armed = null;
          refresh();
          if (!hostilesRemain()) victory();
          return;
        }
        refuse('Too far to shove.');
        return;
      }
      if (active.ap < a.ap) { refuse('Not enough AP.'); return; }
      joinCombat(en); // shoving a bystander is also an opinion they'll return
      active.ap = roundAp(active.ap - a.ap);
      active.actor.lunge(en.x, en.z);
      faceTarget(active, en.x, en.z);
      log(displaceBody(en, Math.sign(en.x - active.actor.x), Math.sign(en.z - active.actor.z)).msg);
      armed = null;
      refresh();
      if (!hostilesRemain()) victory();
      return;
    }
    if (kind === 'pull') {
      const plan = pullPlanFor(en);
      if (!plan) { refuse(pullRefusal(en)); return; }
      if (active.ap < a.ap) { refuse('Not enough AP.'); return; }
      joinCombat(en);
      active.ap = roundAp(active.ap - a.ap);
      performPull(armed, en, plan);
      return;
    }
    const range = rangeOf(armed);
    if (kind === 'ranged') {
      const thrown = !!a.ammoCost; // a wad and a staple miss differently
      const far = cheb(active.actor.x, active.actor.z, en.x, en.z) > range;
      const blocked = !world.hasLos(active.actor.x, active.actor.z, en.x, en.z);
      // What the shot would ACTUALLY do from here (TACTICS_PLAN M6): a crouch
      // behind furniture refuses it outright - free, like every other
      // refusal - and a human shield takes it instead. Shooting THROUGH one
      // of your own is a decision this game does not take for you, so a
      // member-shield also refuses rather than quietly rerouting the damage.
      const out = shotOutcome(active, en);
      if (out.blocked) {
        refuse(`No shot - ${en.def.name} is tucked in behind the ${crouchLabel(out.blocked)}. Find an angle.`);
        return;
      }
      if (out.redirected && out.target.sheet) {
        refuse(`No shot - you would hit ${nameOf(out.target)}.`);
        return;
      }
      // A THROW refuses where it stands, exactly as it always has: you armed it
      // deliberately, it is billed in paper, and spending your last sheet at the
      // end of a walk you did not ask for is worse than being told no.
      if (thrown) {
        if (far) { refuse('Too far to throw.'); return; }
        if (blocked) { refuse('No clear line to throw.'); return; }
        if (active.sheet.paper < ammoCostOf(armed)) { refuse('Out of paper.'); return; }
        if (active.ap < a.ap) { refuse('Not enough AP.'); return; }
        active.actor.faceToward(en.x, en.z);
        if (out.redirected) log(`${nameOf(out.target)} takes it instead. That is the job.`);
        strike(armed, out.target);
        return;
      }
      if (!far && !blocked) {
        if (active.ap < a.ap) { refuse('Not enough AP.'); return; }
        active.actor.faceToward(en.x, en.z);
        if (out.redirected) log(`${nameOf(out.target)} takes it instead. That is the job.`);
        strike(armed, out.target);
        return;
      }
      // A ranged WEAPON closes until it can fire, the same way the melee swing
      // closes until it can hit. Its basic attack is what a bare click on a
      // coworker uses (defaultAttack), so refusing here would break the most
      // obvious verb in the game for anyone holding one: click a coworker two
      // rooms away with a stapler and you walk over; with a staple gun you
      // would have stood still and read a refusal. It walks the same route, it
      // just stops the moment the shot is on rather than at their elbow.
      // Route to a FIRING position, not to their elbow. routeIntoRange already
      // ends at the nearest tile the shot is legal from, so there is no
      // walk-further-then-cut-back step: the route costs the steps it needs and
      // not one more, by construction.
      const route = routeIntoRange(en, range);
      if (!route || route.length < 2) { refuse('No way to get a shot at them.'); return; }
      const shotBudget = moveBudget(active) - a.ap;
      // Stop at the first point THIS weapon can fire from, not at the firing
      // tile's centre: routeIntoRange picks the nearest legal tile, but the
      // route often crosses into range a step before reaching it - and a
      // 6-tile straw that walks to a tile it could have fired at from six
      // tiles back is the "much closer than needed" complaint in its ranged
      // form.
      const shotWalk = walkActive(route, shotBudget, null,
        (px, pz) => verbReaches(armed, en, px, pz));
      // Same honest split as the melee walk-up: a degenerate route is not an
      // AP problem, and must not be narrated as one.
      if (!shotWalk) {
        refuse(shotBudget > 0.05 ? 'No better shot to walk to.' : 'Not enough AP to get in range.');
        return;
      }
      // Will we be able to fire when the walk finishes? The arrival check
      // (pendingMelee, in the update loop) is authoritative either way - this
      // only decides whether to promise the shot or report the walk. Same
      // predicate the trim above stopped on, so the two cannot disagree.
      if (shotWalk.done && verbReaches(armed, en, shotWalk.end[0], shotWalk.end[1])) {
        pendingMelee = { en, action: armed }; // fire on arrival
      } else {
        armed = null;
        log('You close the distance.');
        refresh();
      }
      return;
    }
    // Everything above dispatched the verbs that DO resolve on a coworker.
    // Whatever is still here falls through to the melee walk-up, which ends in
    // `strike` - and `strike` sends anything that is not a control to
    // `performOn`, which opens with `rand(a.min, a.max)`. An action carrying no
    // dice (a buff, a heal, a dash) rolls NaN there, and NaN damage used to
    // make hp NaN: never `<= 0`, so the target could not die and the fight
    // could not end. `takeDamage` now refuses non-finite amounts, but arriving
    // there at all means a verb was pointed at the wrong half of the board -
    // say so instead of walking them into a swing they never defined.
    // A dice-less action IS admitted when it carries a payload to deliver -
    // Reboot strips statuses and deals nothing, and performOn now resolves that
    // as a pure effect. What stays refused is a verb with neither dice nor
    // payload, which is a verb pointed at the wrong half of the board.
    const carries = a.purge || a.applies || Number.isFinite(a.amount);
    if (!isControl(a) && !carries
      && !(Number.isFinite(a.min) && Number.isFinite(a.max))) {
      refuse(`${a.label} is not aimed at them.`);
      return;
    }
    // melee: walk up if needed, then strike
    if (canReach(active, en)) {
      if (active.ap < a.ap) { refuse('Not enough AP to attack.'); return; }
      active.actor.faceToward(en.x, en.z);
      strike(armed, en);
      return;
    }
    // walk the cheapest route to a tile the swing is legal from
    const best = routeBeside(en);
    // Sealed off, or every stand point beside them is line-blocked (ringed in
    // partitions): either way there is no swing to walk to, and saying so
    // beats the AP message this used to wear.
    if (!best) { refuse('No way to get a swing at them.'); return; }
    // walk up to their body, not the centre of the neighbouring tile.
    // The budget is the SAME one an ordinary move spends - allowance first,
    // then real AP (`moveBudget`) - minus the swing this walk is for. Billing
    // the walk against bare `ap` ignored the free movement allowance entirely,
    // so a character wearing it stopped short of a target they could plainly
    // afford to reach and stood there instead of hitting anyone.
    const budget = moveBudget(active) - a.ap;
    const walk = walkActive(best.path, budget, best.point,
      (px, pz) => verbReaches(armed, en, px, pz));
    // A null walk has two honest readings, and only one is about AP: with
    // budget in hand it means the route degenerated to nothing (walkActive's
    // no-progress guard). Blaming AP for that was this bug's face: "Not
    // enough AP to reach them" at 5.9 of 6 AP.
    if (!walk) {
      refuse(budget > 0.05 ? 'Already as close as the route gets.' : 'Not enough AP to reach them.');
      return;
    }
    // The walk's endpoint is already a free point, so this asks the honest
    // question directly instead of rounding it back to a tile first: will we
    // be standing inside reach when the walk finishes? Same predicate the trim
    // stopped on and the arrival check re-runs, LINE TEST INCLUDED - promising
    // on distance alone let a partition cancel the strike this walk was for,
    // silently.
    if (walk.done && verbReaches(armed, en, walk.end[0], walk.end[1])) {
      pendingMelee = { en, action: armed }; // strike on arrival
    } else {
      armed = null;
      log('You close the distance.');
      refresh();
    }
  }


  // THE verb's own reach, as one spec: a declared `range` (aimRangeOf - the
  // shapes powers.js owns) or a plain ranged attack's (stats.rangeOf, which is
  // where a throw's undeclared THROW_RANGE lives), and null for a touch verb
  // that walks into melee reach. The aim wash, the target rings and every
  // walk-up read it, so a power's range means one thing everywhere.
  // The reach vocabulary - all four now live in combat-geometry.js, bound
  // here to the world and to whoever is acting. `reachSpecOf`/`actRangeOf` need
  // neither, so they are re-exported straight through.
  const verbReaches = (id, en, px, pz) =>
    verbReachesAt(id, active, en, px, pz, world);
  const swingPointAt = (en, gx, gz) => swingPointFrom(active, en, gx, gz, world);
  const hasSwingSpot = (en) => hasSwingSpotFor(active, en, world);

  // The cheapest walkable route to a tile BESIDE `en` from which the swing
  // actually LANDS, plus the exact point to stop at: { path, point }, or null
  // when no adjacent tile offers a legal swing. Choosing by path length alone
  // used to send the walk to the nearest tile even when a partition blocked
  // every swing from it - the arrival check then cancelled the strike it had
  // promised, and every re-click regenerated the same dead-end point: a
  // zero-length walk, reported (falsely) as an AP shortage.
  function routeBeside(en) {
    let best = null;
    for (const [dx, dz] of AROUND) {
      const gx = en.x + dx;
      const gz = en.z + dz;
      const point = swingPointAt(en, gx, gz);
      if (!point) continue;
      // Already STANDING on a legal goal tile - out of reach only because the
      // body rests on its far side - means the "route" is a shuffle inside
      // this tile; the approach point closes the last half-tile to their
      // body. findPath returns the one-tile path [[gx,gz]] here, and its
      // length of 1 used to win the shortest-path contest and then fail the
      // >= 2 check: the player CLOSEST to the target was the one told there
      // was no way to reach them.
      if (gx === active.actor.x && gz === active.actor.z) {
        return { path: [[gx, gz], [gx, gz]], point };
      }
      const p = world.findPath(active.actor.x, active.actor.z, gx, gz, active.actor);
      if (p && p.length >= 2 && (!best || p.length < best.path.length)) best = { path: p, point };
    }
    return best;
  }

  // The cheapest walkable route to a tile this weapon could FIRE from, or null
  // if none is reachable. The rule itself is pure and shared with the
  // out-of-combat twin (pathfinding.js) - only the world bindings differ.
  //
  // A target crouched behind furniture (TACTICS_PLAN M6) shrinks the set of
  // legal firing tiles to the angles its shield does not block - so the
  // walk-into-range a ranged weapon already does becomes a walk-into-FLANK
  // for free. A human shield does not shrink it: the shot resolves on the
  // shield from anywhere (performOn decides whether that is a shot you take).
  const routeIntoRange = (en, range) => {
    const s = crouchStateOf(en);
    const angleClear = (x, z) => {
      if (!s) return true;
      // A face held by a BODY does not shrink the set: the shot resolves on
      // that body from anywhere, and whether to take it is performOn's call.
      const face = shieldingFaceFrom(s.faces, x, z, en.x, en.z);
      if (!face) return true;
      return !!unitStandingAt(en.x + face[0], en.z + face[1]);
    };
    return routeToFiringPosition({
      tx: en.x,
      tz: en.z,
      range,
      fromX: active.actor.x,
      fromZ: active.actor.z,
      isWalkable: (x, z) => world.isWalkable(x, z),
      hasLos: (x, z, tx, tz) => world.hasLos(x, z, tx, tz) && angleClear(x, z),
      findPath: (x, z) => world.findPath(active.actor.x, active.actor.z, x, z, active.actor),
    });
  };

  // Smooth a raw tile route and walk the ACTIVE member along it, charging by
  // DISTANCE (stepCost per tile-length) and stopping mid-segment - at any
  // free point - when `budget` runs out. Optionally swap the final waypoint
  // for a precise clicked point. Spends their AP. Returns { done, end } or
  // null if nothing was walkable.
  // `stopWhen` (optional) ends the walk at the first point along the SMOOTHED
  // route where it holds - a walk-up stops the moment its verb is live rather
  // than continuing to the tile beside the target. Trimming after smoothing is
  // what puts the stop point on the line actually being walked; trimming the
  // raw tile route would put it back on the grid.
  function walkActive(rawPath, budget, endPoint = null, stopWhen = null) {
    // Moving is the one thing a crouch does not survive (TACTICS_PLAN M6,
    // designer default): the commitment ends the moment the walk begins, not
    // when it lands somewhere else.
    breakCrouch(active);
    if (endPoint) rawPath = [...rawPath.slice(0, -1), endPoint];
    let s = world.smooth(rawPath, active.actor);
    if (stopWhen) s = trimToFirst(s, stopWhen) || s;
    const { points, cost, done } = truncateByBudget(s, Math.max(0, budget), stepCost);
    if (points.length < 2 || cost < 0.05) return null;
    hidePreview();
    // Walking spends the AP a pending confirm was priced against, so the
    // confirm lapses here rather than committing later at a price this member
    // can no longer pay (which drove AP negative and broke refresh()).
    pendingConfirm = null;
    beginMove(active); // a deliberate move - leaving reach can provoke
    active.actor.setPath(points);
    billMove(active, cost); // the movement allowance first, then real AP
    refresh();
    return { done, end: points[points.length - 1] };
  }

  function handleTileClick(tile, point = null) {
    lastClickOutcome = 'tile'; // the click resolved to ground, not a coworker
    if (phase !== 'player' || active.actor.moving || !tile) return;
    if (armed) {
      const a = ACTIONS[armed];
      // Cones fire at wherever you click - ground included.
      if (a.cone && point) { fireCone(point.x, point.z); return; }
      // A summon is placed at the clicked tile (the whole point of arming it).
      if (a.type === 'summon') { placeSummon(tile.x, tile.z); return; }
      // A zone lands where you clicked - ground, and only ground.
      if (isZone(a)) { performZone(armed, tile.x, tile.z); return; }
      // A buff aimed at the ground resolves to whoever is STANDING there -
      // yourself included. This branch sits above the purge self-cast below
      // deliberately: Remote Restart is a `buff` that happens to purge, and
      // falling through to the attack-purge path would clear your statuses
      // without spending the use, then narrate it as a reboot.
      if (aimsAtAlly(a)) {
        const m = allyAtPoint(point)
          || friendlies().find((f) => f.actor.x === tile.x && f.actor.z === tile.z);
        if (m) {
          if (isMobility(a)) performSwap(armed, m); else performBuff(armed, m);
          return;
        }
        log('Aim at a teammate - or at yourself.');
        return;
      }
      // A dash is aimed at the ground, like a walk - because that is what it
      // is, bought at a flat price and free of opportunity attacks.
      if (isMobility(a)) { performDash(armed, tile.x, tile.z, point); return; }
      // A purge (reboot) can target YOURSELF: wipes your statuses too -
      // paper-cut bleeding stops, but so does your Deflect.
      if (a.purge && tile.x === active.actor.x && tile.z === active.actor.z) {
        if (active.ap < a.ap) { log('Not enough AP.'); return; }
        active.ap = roundAp(active.ap - a.ap);
        const hadBleed = hasStatus(active.sheet, 'bleed');
        clearStatuses(active.sheet);  // reboot wipes every status - Deflect, bleed, gum
        armed = null;
        log(hadBleed
          ? 'You turn yourself off and on again. The bleeding stops. So does everything else.'
          : 'You turn yourself off and on again. All effects cleared. Classic fix.');
        refresh();
        return;
      }
      // Take Cover aimed at the ground resolves on whatever the tile holds -
      // furniture or a body - and performTakeCover says why when it is
      // neither (TACTICS_PLAN M6).
      if (a.type === 'cover') { performTakeCover(tile.x, tile.z); return; }
      // Shove a PROP over (POWERS_PLAN M6). The same verb, aimed at furniture
      // instead of a person: walk up, put your shoulder into the bookcase, and
      // it lands on whoever is behind it. It costs the shove's own AP and
      // needs the shove's own reach, so nothing new has to be learned.
      if (a.type === 'shove') {
        const plan = topplePlan(active, tile.x, tile.z);
        if (plan) {
          if (active.ap < a.ap) { log('Not enough AP.'); return; }
          if (!inReach(posOf(active).x, posOf(active).z, tile.x, tile.z, REACH.SHOVE)) {
            log('Too far to shove.');
            return;
          }
          active.ap = roundAp(active.ap - a.ap);
          active.actor.lunge(tile.x, tile.z);
          faceTarget(active, tile.x, tile.z);
          log(topple(active, plan));
          armed = null;
          refresh();
          if (!hostilesRemain()) victory();
          return;
        }
        // A toppleable prop with nothing behind it just rocks - say so, rather
        // than falling through to the generic "Invalid target", which reads as
        // "this prop is not the kind that falls" and is a different (wrong)
        // lesson.
        if (isToppleable(world.tileDefAt(tile.x, tile.z))) {
          log('It rocks, and settles. Nothing behind it to fall into.');
          return;
        }
        // A cubicle wall between you and the clicked tile: the shove knocks
        // the PARTITION over onto it (designer, 2026-07-30).
        if (performPartitionTopple(tile.x, tile.z)) return;
      }
      // Pull Over aimed at the ground resolves on whoever HOLDS the tile -
      // the same rule Take Cover reads, and for the same reason: its whole
      // target class is crouched bodies, and a crouched body is a squashed
      // pose that is easy to click past (TACTICS_PLAN M8).
      if (isPull(a)) {
        const en = world.liveEnemies().find((e) => e.x === tile.x && e.z === tile.z);
        if (en) { handleEnemyClick(en); return; }
        log('Aim at a coworker dug in behind cover.');
        return;
      }
      // An attack aimed at the furniture (TACTICS_PLAN M8): a breakable prop
      // on the tile, or a partition on its face toward you, takes the hit -
      // melee and ranged both, and "gone means gone" at zero.
      if (aimsAtProps(a)) {
        const plan = breakPlanAt(armed, tile.x, tile.z);
        if (plan?.refusal) { log(plan.refusal); return; }
        if (plan) { performBreak(armed, plan); return; }
      }
      // Aiming: a left click NEVER cancels. Missing the target used to lower
      // the action (and, with a cone out of AP, could strand you unable to do
      // either) - so say what went wrong and stay armed. Right-click cancels.
      log('Invalid target.');
      return;
    }
    if (!world.isWalkable(tile.x, tile.z)) return;
    pendingMelee = null;
    pendingCrouch = null;
    if (point && tile.x === active.actor.x && tile.z === active.actor.z && active.actor.entity) {
      // shuffling within the current tile is a move too
      const pos = active.actor.entity.getPosition();
      walkActive([[pos.x, pos.z], world.clampPoint(point.x, point.z)], moveBudget(active));
      return;
    }
    const p = world.findPath(active.actor.x, active.actor.z, tile.x, tile.z, active.actor);
    if (!p || p.length < 2) return;
    walkActive(p, moveBudget(active), point ? world.clampPoint(point.x, point.z) : null);
  }

  // Hover text for a power. Assembled from the action's own data so a new
  // action documents itself; `desc` in data/actions.js adds the hand-written
  // line on top. Live numbers (your damage bonus, paper on hand, uses left)
  // come from the acting member, so the tip answers "what happens if I press
  // this, now" rather than quoting the registry.
  function actionTip(id, a) {
    const out = [`${a.label} - ${a.ap} AP`];
    if (a.desc) out.push(a.desc);
    if (a.min != null && a.max != null) {
      const bonus = damageBonus(active.sheet);
      out.push(`Damage ${a.min}-${a.max}${bonus ? ` +${bonus}` : ''}`);
    }
    if (a.amount) out.push(`Restores ${a.amount} HP`);
    if (a.cone) out.push(`Cone - ${a.cone.range} tiles, ${a.cone.halfAngle * 2} degrees wide`);
    // Range is the whole reason to hold a ranged weapon, so the tip says it -
    // otherwise the only way to learn a staple gun outreaches a straw by two
    // tiles is to stand somewhere and be refused.
    if (rangeOf(id) && !a.cone) out.push(`Range ${rangeOf(id)} tiles - needs a clear line`);
    if (a.ammoCost) out.push(`Costs ${ammoCostOf(id)} paper (you have ${active.sheet.paper})`);
    if (a.uses) out.push(`${active.usesLeft[id]} of ${a.uses} uses left this fight`);
    if (a.applies) out.push(`Applies ${STATUSES[a.applies]?.name || a.applies}`);
    if (a.purge) out.push('Clears every status - the good ones too');
    // The one line that says which HALF of the board a verb points at. Without
    // it a buff is indistinguishable from an attack on the bar, and the first
    // thing a player does with an unlabelled armed action is click an enemy.
    if (isFriendly(a)) out.push(`Aim at a teammate or yourself - range ${buffRangeOf(a)}, never misses`);
    if (isControl(a)) out.push('No damage - it takes their turn or their ground, not their HP');
    if (a.type === 'cover') {
      out.push('Aim at furniture, a tile against a partition, or a teammate; you walk over and tuck in (the walk bills as movement)');
      out.push('Ranged attacks from the shielded side cannot touch you - melee and flanking still can');
      out.push('Moving breaks it; attacking does not');
    }
    if (isPull(a)) {
      out.push('Aim at an enemy dug in behind cover, from its far side - you reach over and haul them past you, clear of what they were tucked behind');
      out.push(`Grit save: pass lands them on their feet, fail is ${a.crush[0]}-${a.crush[1]} damage, a skipped turn (${STATUSES.stunned.name}) and pinned`);
      out.push('Their cover stays standing');
    }
    if (isStance(a)) {
      out.push(`Watches ${watchRadiusOf(a)} tiles until your next turn`);
      out.push('Spends your reaction when it fires - one per round, shared with opportunity attacks');
    }
    if (isMobility(a)) {
      out.push(aimsAtAlly(a)
        ? `Trade places with a teammate - range ${mobilityRangeOf(a)}`
        : `Move up to ${dashDistanceOf(a)} tiles for a flat ${a.ap} AP`);
      out.push('Provokes no opportunity attacks');
    }
    if (isZone(a)) {
      out.push(`Covers a ${zoneRadiusOf(a) * 2}-tile area with ${a.leaves} - range ${zoneRangeOf(a)}`);
    }
    if (a.footwork) out.push('Footwork - gum on your shoe prevents it');
    return out.join('\n');
  }

  function pressAction(id) {
    if (phase !== 'player') return;
    const a = ACTIONS[id];
    if (!a) return;
    // Lowering an armed action must ALWAYS work, even once its slot has gone
    // unaffordable: spending your AP while a cone was armed used to disable the
    // only control that could unarm it, stranding you (the slot is inert, and
    // a ground click just re-tried the cone).
    if (armed === id) {
      cancelArmed();
      refresh();
      return;
    }
    const st = actionState(id);
    // Same rule the bar renders: unaffordable is uncommittable, except for the
    // one awaiting its confirm click. It still ANSWERS rather than doing
    // nothing - the slot stays pressable precisely so it can say why, which is
    // the bar's own rule and used to be lost the moment a button went dead.
    if (!st) return;
    if (!st.affordable && id !== pendingConfirm) { log(st.reason); return; }
    // Reaching for ANY other action drops whatever was awaiting confirmation -
    // a pending confirm shouldn't survive in the background while you arm
    // something else and spend the AP it was priced against.
    const wasPending = pendingConfirm;
    pendingConfirm = null;
    if (a.type === 'attack' || a.type === 'shove' || a.type === 'summon' || a.type === 'cover'
      || isPull(a) || isFriendly(a) || isControl(a) || isZone(a) || isMobility(a) || isPurge(a)) {
      armed = id; // arm it; clicking a ringed target (or a spot) fires it
      hidePreview(); // aiming now - the movement trail yields to targets
      log(a.type === 'summon'
        ? `${a.label} armed. Click where they should report.`
        : a.type === 'cover'
          ? `${a.label} armed. Click something solid - or somebody brave.`
          : isPull(a)
          ? `${a.label} armed. Click a coworker dug in behind cover.`
          : isZone(a)
          ? `${a.label} armed. Click where it should land.`
          : isMobility(a) && !aimsAtAlly(a)
            ? `${a.label} armed. Click where you want to be.`
            : aimsAtAlly(a)
          // Naming the SIDE matters on the one verb that points the other way:
          // armed the same way an attack is, aimed at the opposite half of the
          // board, and nothing else on the bar behaves like that yet.
          ? `${a.label} armed. Click a teammate - or yourself.`
          : `${a.label} armed. Click a target.`);
      refresh();
    } else if (INSTANT_CONFIRM.has(a.type)) {
      // Instant self-actions (Deflect, a heal) used to fire the moment you
      // touched the button - easy to spend a turn's AP by accident. First
      // press ARMS it, second press commits (right-click, or the button
      // again, backs out). Targeted actions already worked this way.
      if (wasPending !== id) {
        pendingConfirm = id;
        log(`${a.label} - click again to confirm.`);
        refresh();
        return;
      }
      commitInstant(id, a);
    }
  }

  // The self-cast actions, once confirmed. Every branch re-checks AP: a
  // pending confirm survives the movement that happens between the two
  // clicks (arm Coffee, walk, confirm), so the button being enabled when it
  // was armed proves nothing about affordability NOW. Committing anyway drove
  // AP negative, and a negative AP wrecked refresh()'s pip repeat().
  function commitInstant(id, a) {
    if (active.ap < a.ap) { log('Not enough AP any more.'); refresh(); return; }
    if (a.type === 'defend') {
      if (hasStatus(active.sheet, 'deflecting')) { log('You are already deflecting. Save the AP.'); return; }
      active.ap = roundAp(active.ap - a.ap);
      applyStatus(active.sheet, 'deflecting');
      statusFxAt(active, 'deflecting');
      log(a.log);
      refresh();
    } else if (isStance(a)) {
      // A stance is the one action that spends nothing NOW and everything
      // later: it costs the AP up front and then sits on the reaction budget
      // until the holder's next turn. Re-taking one you already hold is a
      // refusal rather than a refresh, because the only thing it could buy is
      // a second reaction, and the round budget is what stops overwatch from
      // being a blender.
      if (watching.has(active)) { log('You are already holding that.'); return; }
      if (a.uses && active.usesLeft[id] <= 0) return;
      if (a.uses) active.usesLeft[id] -= 1;
      active.ap = roundAp(active.ap - a.ap);
      watching.set(active, id);
      const chip = a.mode === 'guard' ? 'guarding' : 'watching';
      applyStatus(active.sheet, chip);
      statusFxAt(active, chip);
      log(a.log);
      refresh();
    } else if (a.type === 'heal') {
      if (a.uses && active.usesLeft[id] <= 0) return;
      if (active.sheet.hp >= active.sheet.maxHp) { log('Already at full health. Savor it.'); return; }
      if (a.uses) active.usesLeft[id] -= 1;
      active.ap = roundAp(active.ap - a.ap);
      active.sheet.hp = Math.min(active.sheet.maxHp, active.sheet.hp + a.amount);
      hitFx(active, 'heal');
      fx.damageText(active.actor.x, active.actor.z, `+${a.amount}`, '#8adf76');
      log(a.log);
      refresh();
    }
  }

  // --- targeted summoning -------------------------------------------------------
  // Post the role AT a spot you pick (Divinity-style placement) rather than
  // wherever the summoner happens to stand: arm the action, then click a tile
  // within `range` with a clear line to it. The applicants take that tile and
  // the free tiles ringing outward from it, so a click into open floor puts
  // them exactly where you wanted them - flanking, or screening a corridor.
  // Why a spot is unusable, or null when it's good. Shared by the click and the
  // hover preview so the ring you see is the rule that runs.
  // The same ladder main.js runs out of combat - with the two legs a FIGHT owns
  // (the AP pool, the per-fight ration) supplied here and simply absent there.
  const summonSpotProblem = (a, tx, tz) => spotProblem(a, {
    ap: active.ap,
    usesLeft: active.usesLeft[armed],
    dist: cheb(active.actor.x, active.actor.z, tx, tz),
    los: world.hasLos(active.actor.x, active.actor.z, tx, tz),
    hasRoomToStand: world.summonSpots(tx, tz, 1).length > 0,
  });
  function placeSummon(tx, tz) {
    const a = ACTIONS[armed];
    const problem = summonSpotProblem(a, tx, tz);
    if (problem) { log(problem); return; }
    const n = resolveSummon(active.actor, 'player', a, { x: tx, z: tz });
    if (n <= 0) { log('No room - the applicants can\'t find a free desk there.'); return; }
    if (a.uses) active.usesLeft[armed] -= 1;
    active.ap = roundAp(active.ap - a.ap);
    active.actor.lunge(tx, tz);
    faceTarget(active, tx, tz); // you gesture at where you posted them
    log(`${a.log} ${arrivalLine(n)}`);
    armed = null;
    aimPoint = null;
    refresh();
  }
  // End Turn ends the STEERED member's turn - under a shared turn the floor
  // passes to the next member still holding it, and only when every holder
  // has pressed theirs does initiative move on (INITIATIVE_PLAN #2: each
  // member ends their own; one press must never skip a teammate who hasn't
  // acted - the accidental group-skip BG3 was criticised for). With a single
  // holder this is exactly the advance it always was.
  function endTurnPressed() {
    if (phase !== 'player') return;
    advanceTurn();
  }

  // --- what the turn engine asks this file ------------------------------------
  // turn-order.js owns the walk: advance, wrap into a round, skip anyone who
  // cannot act, spend a temp's contract, tick the turn clock. These are the
  // combat-side answers it calls out for - the ones that need a body, a panel
  // or the app, and so could never live in a pure module.

  // Somebody's turn opens for real: hand a member control (full AP and their
  // movement allowance), or arm the AI's working state for a unit. Under a
  // shared turn `held` is every member holding the floor - EACH gets a full
  // budget at the top (per-member AP predates spans; several members having
  // independent pools at once is why this line is a loop and nothing else
  // changed), and the first is steered.
  function takeTurn(s, held = [s]) {
    if (s.member) {
      for (const h of held) {
        h.member.ap = h.member.sheet.maxAp; // full AP at the top of your turn
        h.member.freeAp = freeMoveOf(h.member); // and the movement allowance, if any
      }
      makeActive(s.member);
      phase = 'player';
      // The turn is not SAID any more - the strip and the lit End Turn carry
      // it (character-start branch's de-duplication). The one exception is a
      // SHARED turn: the strip brackets the span visually, but this line is
      // the only TEXT naming the whole span at once, and the shared-turns
      // branch landed it without knowing the announcements were going.
      if (held.length > 1) {
        log(`Shared turn — ${held.map((h) => h.member.sheet.name).join(', ')}.`);
      }
      refresh();
      return;
    }
    phase = 'ai';
    acting = { unit: s.unit, ap: s.unit.combat.ap, freeAp: freeMoveOf(s.unit), wait: 0.5 };
    refresh();
  }

  // The floor moved to another member of the open span - `finish` passing it
  // on when one member's turn ends, or a steer the player asked for (the party
  // bar, Tab, a body click - main.js routes them here in combat).
  function steerTo(s) {
    if (!s?.member) return;
    makeActive(s.member);
    log(`${s.member.sheet.name} has the floor.`);
    refresh();
  }

  // A turn spent incapacitated. A member simply loses it and play moves on; an
  // AI unit HOLDS the turn for a beat, so a dazed coworker visibly stands there
  // rather than being skipped between frames.
  function skipTurnFor(s) {
    log(skipTurnLine(s, slotCarrier(s)));
    if (s.member) {
      refresh();
      return 'advance';
    }
    phase = 'ai';
    acting = { unit: s.unit, ap: 0, freeAp: 0, wait: 0.6 };
    refresh();
    return 'hold';
  }

  // A summon's turns ran out with the fight still on: it leaves mid-battle,
  // which is the cost of fielding temps. Dismissing an enemy-side one can empty
  // the enemy list - the engine re-reads the outcome on the next attempt, so
  // this only has to take the body off the board.
  function expireSummon(s) {
    // A BORROWED coworker is RETURNED, not dismissed. They share the lifetime
    // clock with summons - one clock, nothing to keep in step - but the endings
    // are opposites: a summon is destroyed, a colleague walks away.
    if (s.member?.isCharmed) {
      log(`The session drops. ${s.member.sheet.name} is theirs again.`);
      releaseCharm(s.member);
      return;
    }
    // The house voice was already they/them here; now it ASKS the character
    // rather than assuming, which is the whole point of storing the field.
    const w = pronounsOf(s.member?.sheet);
    log(`${slotName(s)}'s assignment ends. ${capitalize(w.subject)} `
      + `${verb(w, 'gather')} ${w.possessive} things and ${verb(w, 'go', 'es')}.`);
    dismissSummon(s.member || s.unit);
    refresh();
  }

  // The line for a turn spent incapacitated - stun reads differently from the
  // surprise it generalized.
  function skipTurnLine(s, carrier) {
    const name = s.member ? s.member.sheet.name : s.unit.def.name;
    if (hasStatus(carrier, 'stunned')) return `${name} is stuck in mandatory training. Attendance is taken.`;
    return `${name} is still grabbing their lanyard.`;
  }
  // Apply a turn-start dot (burning) to the slot's owner, with the popup and
  // the death handling. Returns 'fell' if it dropped them - the engine then
  // moves past the now-empty slot, re-reading the win/lose outcome as it opens
  // the next one - or 'stands' if the turn should proceed.
  function applyTurnDot(s, damage) {
    const actor = s.member ? s.member.actor : s.unit;
    hitFx(actor, 'fire');
    fx.damageText(actor.x, actor.z, `-${damage}`, '#ff7a3c');
    if (s.member) {
      const dead = applyDamage(s.member.sheet, damage);
      log(`${s.member.sheet.name} is on fire. -${damage}.`);
      if (!dead) { refresh(); return 'stands'; }
      s.member.toppled = true;
      s.member.actor.clearPath();
      s.member.actor.fx = { kind: 'death', t: 0 };
      // Burning to death at the top of your own turn: move the bindings off the
      // corpse before passing the turn on, or the HUD, the party bar and the
      // post-combat leader all keep pointing at a downed member through the
      // enemies' turns (and past a victory landing in that window).
      if (s.member === active && livingParty().length) makeActive(livingParty()[0]);
      return 'fell';
    }
    const died = s.unit.takeDamage(damage);
    log(`${s.unit.def.name} is on fire. -${damage}.`);
    if (!died) { refresh(); return 'stands'; }
    callbacks.onEnemyKilled(s.unit);
    return 'fell';
  }

  // --- summons ----------------------------------------------------------------
  // Live minions a summoner still has on the board - the cap counts these.
  // Enemy-team summons are AI actors in the shared enemy list; player-team
  // summons are temporary MEMBERS (below), tagged with who conjured them.
  function liveSummonsOf(summoner) {
    const enemySummons = world.liveEnemies().filter((e) => e.summonedBy === summoner).length;
    const playerSummons = members.filter((m) =>
      m.isSummon && m.sheet.hp > 0 && m.actor && m.summonedBy === summoner).length;
    return enemySummons + playerSummons;
  }
  // A summon's assignment ran out (or the fight it was called for is over and
  // main.js is sweeping): take it off the board WITHOUT killing it. This is not
  // a death - no topple, no corpse, no loot, no XP - the temp just leaves.
  //   a member  -> drop its body; a null `actor` is exactly what slotAlive,
  //                livingMembers and the initiative strip already read as "not
  //                in this fight", so nothing else needs to know.
  //   an AI unit -> mark it not-alive so victory can be reached, and hand the
  //                body back to main.js to destroy.
  function dismissSummon(target) {
    if (target.sheet) {
      const body = target.actor;
      target.actor = null;
      world.dismissSummon(body);
      // The floor can't be held by someone who just walked out.
      if (active === target) makeActive(livingParty()[0] || members[0]);
      return;
    }
    target.alive = false;
    target.loot = [];
    world.dismissSummon(target);
  }
  // Post the req: spawn up to the descriptor's `count` for `team` beside the
  // summoner, never past its live `cap`. Returns how many actually showed up.
  //   enemy team -> AI actors: join `engaged` (counted for victory, queued next
  //     round) and take a `{unit}` initiative slot, surprised so they don't act
  //     the turn they're posted.
  //   player team -> temporary MEMBERS you control: a real sheet + body, its own
  //     action bar and AP, a `{member}` initiative slot. Not in party.members
  //     (outside the cap, unsaved); combat owns them, despawned at fight's end.
  //   `at` is the player's chosen drop point ({x,z}); without one (enemy AI,
  //   the debug hook) they report beside the summoner as before.
  function resolveSummon(summoner, team, d, at = null) {
    const room = (d.cap ?? d.count) - liveSummonsOf(summoner);
    const n = Math.min(d.count, Math.max(0, room));
    if (n <= 0) return 0;
    const spawned = world.spawnSummon(d.archetype, team, summoner, n, at) || [];
    for (const rec of spawned) {
      // The contract. `lifetimeTurns` is how many of its OWN turns the unit
      // serves before it files out (beginTurn spends them; main.js's world
      // clock spends them out of combat). Omit it and the summon is permanent,
      // which is the old behavior and still what a descriptor gets by default.
      const body = team === 'enemy' ? rec : rec.actor;
      body.summonTurns = d.lifetimeTurns ?? null;
      if (team === 'enemy') {
        if (!engaged.includes(rec)) engaged.push(rec);
        applyStatus(rec, 'surprised');
        // Arriving is an event: the temp lands in a puff of onboarding.
        fx.impact(body.x, body.z, 'toner', { y: 0.5, scale: 0.55 });
        insertSlot(unitSlot(rec));
      } else {
        const m = asMember(rec, { isSummon: true, summonedBy: summoner });
        fx.impact(body.x, body.z, 'toner', { y: 0.5, scale: 0.55 });
        members.push(m);
        insertSlot(memberSlot(m)); // slots in by its own roll; acts when its turn comes
      }
    }
    return spawned.length;
  }

  // One AI unit's swing at its target. AI only ever drives ENEMIES (player-side
  // summons are player-controlled members - resolveSummon), and pickTarget only
  // ever returns a party-side member, so the hit always lands on a member's
  // sheet (deflect, gum, and the downed/handoff/party-wipe rules).
  function aiAttack(unit, target) {
    const atk = unit.combat.attacks[rand(0, unit.combat.attacks.length - 1)];
    unit.lunge(target.actor.x, target.actor.z);
    faceTarget(unit, target.actor.x, target.actor.z); // you face what you swing at
    if (target.member) unitStrikesMember(unit, target.member, atk);
  }

  // One AI unit's swing at a member: the roll, the Composure soak, the Deflect
  // stance, any applied status, and the downed/handoff/party-wipe rules. Split
  // out of aiAttack so an opportunity attack lands by exactly the same rules
  // as a turn attack rather than reimplementing them (TACTICS_PLAN M2).
  function unitStrikesMember(unit, m, atk) {
    let dmg = rand(atk.min, atk.max);
    // The attack roll. A miss skips damage, the deflect interaction, the
    // flinch, and any applied status; the enemy's AP was already committed
    // by the caller.
    // Same assembler as the player's swings, with the roles reversed - the
    // unit attacks, the member defends (attackMods reads either shape).
    if (!rollAgainst(unit, m)) {
      hitFx(m, 'whiff');
      fx.damageText(m.actor.x, m.actor.z, 'MISS', MISS_COLOR);
      log(atk.missLog || `${unit.def.name}'s attack goes wide.`);
      refresh();
      return;
    }
    let line = atk.log;
    // Composure soaks a flat slice off the hit (one point always lands),
    // before the Deflect Blame stance (incomingMult) halves whatever is left.
    const soak = deflect(m.sheet);
    if (soak > 0) dmg = Math.max(1, dmg - soak);
    const inMult = statusFx(m.sheet).incomingMult ?? 1;
    if (inMult < 1) {
      dmg = Math.max(1, Math.ceil(dmg * inMult));
      line += ` You deflect - only ${dmg} damage.`;
    } else {
      line += ` ${dmg} damage.`;
    }
    m.actor.flinch();
    const dead = applyDamage(m.sheet, dmg);
    hitFx(m, 'melee', unit);
    // Taking one is worth a flinch from the camera too - small, and only when
    // it's a body you control, so the office stays still while you swing.
    fx.shake(dead ? 0.09 : 0.05, 0.2);
    fx.damageText(m.actor.x, m.actor.z, `-${dmg}`, undefined, { big: dead });
    // Any status the attack carries lands here (gum, and now stun etc.),
    // Composure shrugging off some of a resistable one. Not onto a corpse. This
    // is the side of the anti-chain window that matters most: the Security Guard
    // and the Regional Executive both stun on an ordinary attack, with nothing
    // rationing it, so without a window a party member could lose every turn of
    // a fight in a row.
    if (atk.applies && !dead) {
      const blocked = blockedBy(m.sheet, atk.applies);
      if (applyStatus(m.sheet, atk.applies, {}, statusResist(m.sheet))) {
        statusFxAt(m, atk.applies);
        line += ` ${appliesLine(atk, m.sheet.name)}`;
        // Composure blunted it (statuses.js severity). Say so, once, where the
        // player is already reading: a stat whose work is invisible is a stat
        // nobody spends a point on, and "it landed weaker" is not something a
        // number on the character sheet can show you mid-fight.
        if (statusSeverity(m.sheet, atk.applies) < 1) line += ' They shrug off the worst of it.';
      } else if (blocked) line += ` ${immunityLine(blocked, m.sheet.name)}`;
    }
    log(line);
    refresh();
    if (dead) {
      m.toppled = true;
      deathFx(m);
      m.actor.clearPath();
      m.actor.fx = { kind: 'death', t: 0 };
      if (!livingParty().length) { defeat(); return; } // party wipe - the only true loss
      log(m.isSummon
        ? `${m.sheet.name} is dismissed - back to the applicant pool.`
        : `${m.sheet.name} is out cold. They'll sit the rest of this one out.`);
      // Keep `active` (the sheet the HUD reflects, and the post-combat leader)
      // on a real member still standing - never a summon, which despawns.
      // This can fire mid-PLAYER-turn (an opportunity attack cut the acting
      // member down as they walked), so hand off properly: makeActive rebuilds
      // the survivor's action bar and clears the dead member's armed/pending
      // state. If it WAS their turn, end it too - otherwise the survivor
      // inherits the corpse's initiative slot and its leftover AP, then gets a
      // second full turn when their own slot comes up. During an AI turn the
      // acting enemy is mid-swing, so only the binding moves.
      if (m === active) {
        makeActive(livingParty()[0]);
        if (phase === 'player') advanceTurn();
        else refresh();
      }
    }
  }

  // --- opportunity attacks (TACTICS_PLAN M2) ---------------------------------
  // Leaving a threatened tile hands the threatener a free swing, so walking
  // out of melee stops being free and kiting stops being strictly dominant.
  // Three rules keep it from becoming a blender:
  //   - one reaction per unit per ROUND (refilled by the engine's roundStart)
  //   - unaware units don't react (surprised/stunned haven't registered it)
  //   - FORCED movement never provokes. A shove sets the logical tile through
  //     pushTo and glides the body, which skips the per-tile hook entirely
  //     (actors.js update), and only deliberate moves seed `moveStart` - so
  //     shove is the safe way to break contact (TACTICS_PLAN #9).
  const reactions = new Map(); // combatant -> reactions spent this round
  // combatant -> where its current move began: { x, z } logical tile plus
  // { px, pz } continuous position (what threat radii are measured against)
  const moveStart = new Map();
  // LOGICAL facing (TACTICS_PLAN M5): a sign-vector per combatant, written
  // only when a unit attacks (it faces its target) or moves (it faces its
  // heading). Never read off the actor's eased visual yaw. A unit that has
  // not acted has no entry and cannot be backstabbed.
  const facings = new Map();
  const setFacing = (u, fx, fz) => { if (fx || fz) facings.set(u, { x: Math.sign(fx), z: Math.sign(fz) }); };
  const faceTarget = (u, tx, tz) => {
    const b = bodyOf(u);
    setFacing(u, tx - b.x, tz - b.z);
  };
  const bodyOf = (u) => u.actor || u; // a member wraps an actor; a unit IS one
  // On its feet AND on the board. The `actor` check is not paranoia: a summon
  // whose assignment lapsed has its body dropped (dismissSummon) while its
  // member record lives on at full HP, and a bodiless member has no tile to
  // flank from, take cover behind, or throw an opportunity attack out of.
  const standing = (u) => (u.sheet ? u.sheet.hp > 0 && !u.toppled && !!u.actor : !!u.alive);
  const canReact = (u) => standing(u)
    && (TACTICS.REACTIONS_PER_ROUND - (reactions.get(u) || 0)) > 0
    && !hasStatus(statusesOf(u), 'surprised')
    && !hasStatus(statusesOf(u), 'stunned');
  // main.js owns the per-tile hooks for members and summons, and its records
  // are NOT the objects combat wraps them in - so resolve through the shared
  // actor, which both sides hold a reference to.
  const combatantFor = (ref) => {
    if (!ref) return null;
    const body = bodyOf(ref);
    return members.find((m) => m.actor === body) || engaged.find((e) => e === body) || null;
  };
  // Mark the tile a deliberate move begins on. Only moves that come through
  // here can provoke - which is exactly how forced movement stays exempt.
  // Carries the tile (for facing and per-leg bookkeeping) AND the continuous
  // position, which is what threat is measured from now that reach is a radius.
  const beginMove = (u) => {
    if (!u) return;
    const b = bodyOf(u);
    const p = posOf(u);
    moveStart.set(u, { x: b.x, z: b.z, px: p.x, pz: p.z });
  };
  // Everyone on the far side of `mover` able to punish it right now. Each
  // carries its OWN reach: threat is whatever ground that unit could swing at,
  // so a long weapon zones further than a pair of fists.
  const threatsAgainst = (mover) => (mover.sheet ? engaged : members)
    .filter((u) => canReact(u))
    .map((u) => {
      const p = posOf(u);
      return { x: p.x, z: p.z, reach: reachOfUnit(u), ref: u };
    });

  // `ref` entered (x, z) under its own power. Anyone whose reach it just left
  // gets one free swing. The walk is NOT interrupted - its AP was charged up
  // front (TACTICS_PLAN #8) - so the mover takes the hit and keeps going,
  // unless it goes down.
  function notifyStep(ref, x, z) {
    if (phase === 'done') return;
    const mover = combatantFor(ref);
    if (!mover) return;
    // Frequent Flier (MOVEMENT_PLAN M3): this character never provokes, from
    // anyone, ever. Deliberately the ONLY exception to the rule that leaving
    // a threatened tile costs you - which is what makes it worth a class
    // point. Read the same way every other talent effect is, so an enemy
    // archetype can carry it too.
    const flier = mover.sheet
      ? mover.sheet.talent?.effects?.noProvoke
      : mover.def?.talent?.effects?.noProvoke;
    // A step off the crouch tile ends the crouch, whoever took it - the same
    // lazy validity every consult runs, invoked here so the chip drops the
    // moment the AI (or a walking member) leaves cover rather than at the
    // next shot that asks (TACTICS_PLAN M6).
    if (crouched.has(mover)) crouchStateOf(mover);
    const from = moveStart.get(mover);
    if (!from) return; // not a tracked deliberate move (a shove glide, a spawn)
    if (from.x === x && from.z === z) return;
    setFacing(mover, x - from.x, z - from.z); // you face where you're going
    // Threat is a radius now, so the leg is measured between the BODY's real
    // positions rather than the tiles they round to. The hook still fires on
    // tile changes, so a reaction can land up to a tile after the radius was
    // actually crossed - bounded, and cheap compared with sampling every frame.
    const to = posOf(mover);
    moveStart.set(mover, { x, z, px: to.x, pz: to.z }); // the next leg starts here
    if (!standing(mover)) return;
    if (flier) {
      // Say so once per escape, or "nothing happened" reads as a missing rule.
      if (provokedBy(threatsAgainst(mover), from.px, from.pz, to.x, to.z, world.stepOpen).length) {
        log(`${mover.sheet ? mover.sheet.name : mover.def.name} walks off untouched. Frequent flier.`);
      }
      return;
    }
    // OVERWATCH fires first (POWERS_PLAN M5), and it is a different question
    // from the one below: an opportunity attack punishes LEAVING somebody's
    // reach, overwatch punishes ENTERING the ground a watcher is covering. A
    // mover crossing a watched doorway has not left anyone's reach, so the
    // provokedBy sweep would never see them.
    //
    // It shares the ROUND budget rather than getting its own, which is what
    // keeps the two from stacking into two free swings per mover per round -
    // and it is why holding a stance is a real cost, not a free extra.
    for (const [watcher, actionId] of watching) {
      if (watcher === mover) continue;
      // Only a `watch` stance swings. A `guard` shares the same held-posture
      // bookkeeping (one map, one lapse rule) but pays out as cover, not as a
      // reaction - so it must not quietly become a second overwatch.
      if (ACTIONS[actionId]?.mode !== 'watch') continue;
      const w = posOf(watcher);
      const sameSide = !!watcher.sheet === !!mover.sheet;
      if (!watchTriggers(ACTIONS[actionId], {
        dist: cheb(Math.round(w.x), Math.round(w.z), x, z),
        los: world.hasLos(Math.round(w.x), Math.round(w.z), x, z),
        hasReaction: canReact(watcher),
        sameSide,
        moverStanding: standing(mover),
      })) continue;
      reactions.set(watcher, (reactions.get(watcher) || 0) + 1);
      // The stance is SPENT once it fires. Overwatch that re-armed itself for
      // free every time the reaction refilled would cover the whole fight off
      // one turn's AP.
      watching.delete(watcher);
      removeStatus(statusesOf(watcher), 'watching');
      opportunityStrike(watcher, mover, 'overwatch');
      if (!standing(mover)) return; // dropped in the doorway - nothing left to punish
    }
    for (const t of provokedBy(threatsAgainst(mover), from.px, from.pz, to.x, to.z, world.stepOpen)) {
      if (!canReact(t.ref)) continue; // an earlier swing this step spent it
      reactions.set(t.ref, (reactions.get(t.ref) || 0) + 1);
      opportunityStrike(t.ref, mover);
      if (!standing(mover)) break; // dropped mid-flight - no further swings
    }
  }

  // The reaction swing: the attacker's own basic attack, at no AP cost, rolled
  // through the same assembler as every other attack. It deliberately carries
  // no weapon on-hit proc - a reflex, not a committed swing.
  // `reason` picks the wording only: 'flee' (the default) is the classic
  // opportunity attack on somebody breaking away, 'overwatch' is a stance
  // firing on somebody entering covered ground. The RULES are identical - one
  // basic swing, one reaction spent - so they share the resolution rather than
  // growing a second copy of the roll, the damage and the death handling.
  function opportunityStrike(attacker, defender, reason = 'flee') {
    const caught = reason === 'overwatch' ? 'crossing your line' : 'breaking away';
    if (attacker.sheet) {
      // A party-side body catches a fleeing enemy.
      const a = ACTIONS[equippedAction(attacker.sheet)];
      if (!a) return; // no basic swing to make (shouldn't happen - punch is the floor)
      attacker.actor.lunge(defender.x, defender.z);
      faceTarget(attacker, defender.x, defender.z);
      if (!rollAgainst(attacker, defender)) {
        hitFx(defender, 'whiff');
        fx.damageText(defender.x, defender.z, 'MISS', MISS_COLOR);
        log(`${attacker.sheet.name} swings at ${defender.def.name} ${caught} - and misses.`);
        refresh();
        return;
      }
      const dmg = rand(a.min, a.max) + damageBonus(attacker.sheet);
      const died = defender.takeDamage(dmg);
      hitFx(defender, 'melee', attacker);
      if (died) deathFx(defender);
      fx.damageText(defender.x, defender.z, `-${dmg}`, '#ffd76b', { big: died });
      log(`${attacker.sheet.name} catches ${defender.def.name} ${caught}. ${dmg} damage!`);
      if (died) callbacks.onEnemyKilled(defender);
      refresh();
      return;
    }
    // An enemy catches a fleeing member (or summon) - same rules as its turn
    // attack, just reworded so the log reads as a punish, not a swing in turn.
    // A unit with no attack set has nothing to punish with: `unitCombat`
    // normalizes that to an empty list rather than undefined, so this is a
    // check instead of a crash (a CLASS backing an AI unit need not declare
    // `attacks` at all - see stats.js).
    if (!attacker.combat.attacks.length) return;
    const base = attacker.combat.attacks[rand(0, attacker.combat.attacks.length - 1)];
    attacker.lunge(defender.actor.x, defender.actor.z);
    unitStrikesMember(attacker, defender, {
      ...base,
      log: `${attacker.def.name} catches ${defender.sheet.name} pulling away.`,
      missLog: `${attacker.def.name} grabs at ${defender.sheet.name} and comes up empty.`,
    });
  }

  // Route toward the cheapest target-adjacent tile and walk it in ONE smooth
  // run, as far as `budget` allows (1 AP per tile-length) - no more
  // hop-pause-hop. Surface damage lands per tile entered via the actor's
  // onTile hook. Returns the AP actually spent (0 = couldn't move).
  function aiAdvance(unit, budget, target) {
    const best = advanceRoute(unit, target, standTilePath(unit, target), world);
    if (!best) return 0;
    const s = world.smoothEnemy(unit, best);
    // AI units pay the same surface movement tax the player does, plus their
    // own gum surcharge if they've stepped in a wad.
    const { points, cost } = truncateByBudget(s, budget,
      // AI units aren't sheets and wear nothing, so there is no footwear term
      // here - just the floor and whatever is stuck to them.
      (x, z) => surfaceStepCost(x, z) * (statusFx(unit).moveCostMult ?? 1));
    if (points.length < 2 || cost < 0.05) return 0;
    beginMove(unit); // a deliberate move - leaving reach can provoke
    unit.onTile = (x, z, done, changed) => {
      if (changed) {
        // Breaking away from a party-side body hands it a free swing first -
        // an enemy that repositions out of your reach pays for it too.
        notifyStep(unit, x, z);
        if (!unit.alive) { unit.onTile = null; return; }
        // AI units feel the floor too
        const surf = world.enemySurfDamage(x, z);
        if (surf > 0) {
          const died = unit.takeDamage(surf);
          fx.impact(x, z, hazardKind(x, z), { y: 0.35 });
          if (died) deathFx(unit);
          fx.damageText(x, z, `-${surf}`, '#ffd76b', { big: died });
          log(`${unit.def.name} stumbles through the hazard. -${surf}.`);
          if (died) {
            callbacks.onEnemyKilled(unit);
            refresh();
          }
        }
        // gum wads stick to AI units too: it taxes their movement AP (via the
        // status's moveCostMult) and grants traction. Like today, an AI unit's
        // gum is for keeps - the status is applied once and never ticked, so it
        // stays slowed and sure-footed for the rest of the fight.
        if (unit.alive && !hasStatus(unit, 'gum') && world.stickGum(x, z)) {
          applyStatus(unit, 'gum');
          statusFxAt(unit, 'gum');
          syncUnitSpeed(unit);
          log(`${unit.def.name} steps in gum. It's theirs now.`);
        }
        // wet floor: a slip ends their whole turn (they spend it getting up).
        // Gum is traction (slipProof), so a gummed unit can't slip.
        // The last direct Math.random in the fight. Through `rng` like the rest,
        // so a seeded run reproduces the slips too - they end a whole turn, so
        // an unseeded one is exactly the kind of thing that makes a resolution
        // test flaky for reasons that have nothing to do with what it asserts.
        if (unit.alive && slips({
          chance: world.slipChanceAt(x, z),
          roll: rng,
          slipProof: statusFx(unit).slipProof,
        })) {
          unit.clearPath();
          unit.flinch();
          unit.slipped = true;
          fx.impact(x, z, 'slip', { y: 0.12 });
          fx.damageText(x, z, 'slip!', '#8ad4df');
          log(`${unit.def.name} slips in the water and goes down.`);
        }
        // Coworkers track the floor around too: a wounded one crossing a paper
        // drift prints blood behind it exactly like a party member does.
        if (unit.alive) {
          fx.footstep(unit, x, z, {
            bleeding: unit.hp <= unit.maxHp * 0.45,
            surface: world.surfaceIdAt(x, z),
            onPaper: world.surfaceIdAt(x, z) === 'paper',
          });
        }
      }
      if (done || !unit.alive) unit.onTile = null;
    };
    unit.setPath(points);
    return cost;
  }

  // --- per-frame driver -------------------------------------------------------------
  function update(dt) {
    if (phase === 'done') return;
    // A `moveStart` record means "this unit is mid-deliberate-move, and it
    // began there". It has to stop meaning that when the move stops. Nothing
    // ever retired one, and `notifyStep` re-seeds it on every leg, so the
    // record outlived the walk that made it - which broke the exemption
    // performDash and performSwap rely on. Both opt out of provoking by NOT
    // seeding a record (see performDash), so a stale one left over from any
    // earlier walk meant the next dash provoked after all: the one verb sold
    // as the answer to a threat ring quietly stopped being it.
    // Safe to read `moving` here: setPath assigns `path` synchronously, so a
    // walk seeded by beginMove is already moving before this frame runs.
    for (const u of [...moveStart.keys()]) {
      const body = bodyOf(u);
      if (!body || !body.moving) moveStart.delete(u);
    }
    drawPreview(); // immediate-mode lines last one frame - redraw while shown
    drawTargets();
    // prune anyone killed externally (printer explosions during combat)
    if (!hostilesRemain()) { victory(); return; }
    if (phase === 'player') {
      // finish a queued walk-up strike
      if (pendingMelee && !active.actor.moving) {
        const { en, action } = pendingMelee;
        pendingMelee = null;
        // Did we arrive somewhere this verb can act from? One predicate for
        // both shapes (verbReaches reads the power's own range, or the melee
        // reach a touch verb walks into), measured from the BODY - which is
        // where the trim stopped it, so the walk's promise and the arrival
        // check are the same question asked twice.
        const bp = posOf(active);
        const arrived = verbReaches(action, en, bp.x, bp.z);
        // The crouch is re-resolved ON ARRIVAL (TACTICS_PLAN M6) - the world
        // had a whole walk to change. Blocked here quietly stands down; a
        // human shield takes the arriving shot by the same rule as a
        // standing one, except one of your own, which stands down too.
        const out = rangeOf(action) ? shotOutcome(active, en) : { target: en };
        const fireable = !out.blocked && !(out.redirected && out.target.sheet);
        if (en.alive && arrived && fireable
          && active.ap >= ACTIONS[action].ap) {
          active.actor.faceToward(en.x, en.z);
          if (out.redirected) log(`${nameOf(out.target)} takes it instead. That is the job.`);
          strike(action, out.target);
        } else {
          // A cancelled arrival SAYS why. Standing down silently was half of
          // the stuck-walk-up bug's confusion: the walk happened, the strike
          // didn't, and nothing on screen admitted anything had failed.
          if (en.alive && arrived && !fireable) log(`No shot - ${en.def.name} is in cover.`);
          else if (en.alive && !arrived) log(`${en.def.name} is still out of reach.`);
          else if (en.alive) log(`Not enough AP left for ${ACTIONS[action].label}.`);
          armed = null;
          refresh();
        }
      }
      // finish a queued walk-up crouch (TACTICS_PLAN M6)
      if (pendingCrouch && !active.actor.moving) {
        const { spot } = pendingCrouch;
        pendingCrouch = null;
        const a = ACTIONS['take-cover'];
        // `crouchHere` re-asks the faces on arrival, so a shield that moved or
        // fell during the walk-up is a crouch that never happens rather than
        // one that lands on nothing.
        if (active.actor.x === spot[0] && active.actor.z === spot[1] && active.ap >= a.ap
          && crouchHere(active)) {
          active.ap = roundAp(active.ap - a.ap);
          refresh();
        } else {
          log('The moment passes - no cover taken.');
          refresh();
        }
      }
      return;
    }
    // The AI drives the ONE unit whose initiative turn it is (acting, set by
    // beginTurn). It takes beats until out of AP, then advanceTurn hands the
    // order on.
    if (phase !== 'ai' || !acting) return;
    if (acting.wait > 0) {
      acting.wait -= dt;
      return;
    }
    const { unit } = acting;
    if (!unit.alive) { advanceTurn(); return; }
    if (unit.moving) return; // let the current walk play out
    if (unit.slipped) {
      unit.slipped = false; // a spill ends their whole turn
      advanceTurn();
      return;
    }
    const target = pickTarget(unit);
    if (!target) { defeat(); return; } // no living player-side target = party wipe
    // A summoner reinforces before it wades in: off cooldown, able to afford
    // the post, and under its live cap (resolveSummon returns 0 when full, so a
    // maxed HR just fights). Posting the req is the whole beat. Enemy-side only
    // today - the player summons from the action bar, not on autopilot.
    // The ladder itself is combat-ai.chooseBeat; everything here is the DOING.
    // The summon and the topple both have to be planned before the decision
    // can be honest about whether they are available - `resolveSummon` is the
    // only way to know a maxed-out HR has nobody left to post, and the topple
    // needs its plan anyway to take it.
    const sm = summonSpec(unit.def.summon);
    const summonReady = !!sm && (unit.summonCd || 0) <= 0 && acting.ap >= sm.ap
      && resolveSummon(unit, 'enemy', sm) > 0;
    const toppleAp = ACTIONS.shove.ap;
    const tp = acting.ap >= toppleAp ? aiTopplePlan(unit) : null;
    const beatState = {
      ap: acting.ap,
      moveBudget: moveBudget(acting),
      moveCost: MOVE.COST_PER_TILE,
      inReach: canReach(unit, target),
      hasAttack: unit.combat.attacks.length > 0,
      attackAp: unit.combat.attackAp,
      summon: sm ? { ap: sm.ap, ready: summonReady } : null,
      toppleAp,
      canTopple: !!tp,
      canCrouch: true, // tryAiCrouch runs its own (world-shaped) test
      coverAp: ACTIONS['take-cover'].ap,
    };
    const { beat } = chooseBeat(beatState);
    if (beat === 'summon') {
      unit.summonCd = sm.cooldownRounds || 0;
      acting.ap = roundAp(acting.ap - sm.ap);
      unit.lunge(target.actor.x, target.actor.z);
      log(sm.log || `${unit.def.name} calls in reinforcements.`);
      acting.wait = 0.6;
      refresh();
      return;
    }
    if (beat === 'topple') {
      acting.ap = roundAp(acting.ap - toppleAp);
      unit.lunge(tp.x, tp.z);
      log(`${unit.def.name} puts a shoulder into the ${tp.def.label || 'furniture'}. ${topple(unit, tp)}`);
      acting.wait = 0.85;
      refresh();
      return;
    }
    if (beat === 'attack') {
      aiAttack(unit, target);
      acting.ap = roundAp(acting.ap - unit.combat.attackAp);
      acting.wait = 0.85; // outlast the swing animation so hits read one at a time
      return;
    }
    if (beat === 'advance') {
      const spent = aiAdvance(unit, moveBudget(acting), target);
      if (spent > 0) { billMove(acting, spent); acting.wait = 0.15; return; }
      // The advance went nowhere. Same tail the ladder gives a unit that never
      // had a move to make.
      if (afterFailedAdvance(beatState).beat === 'crouch' && tryAiCrouch(unit, target)) {
        acting.wait = 0.5;
        return;
      }
      acting.ap = 0; // burn the real AP so the turn can end; the allowance buys nothing
      acting.wait = 0.15;
      return;
    }
    if (beat === 'crouch' && tryAiCrouch(unit, target)) { acting.wait = 0.5; return; }
    advanceTurn(); // out of AP / nothing to do - next in initiative
  }

  // A crouch taken OUT of combat rides into the fight (TACTICS_PLAN M6 OOC):
  // the leader tucked in before anyone noticed them, and the fight starting
  // must not stand them up. Seeded in the exact shape the in-fight verb
  // stores, so every later consult validates it lazily like any other crouch
  // (the 'covered' chip is already on the sheet; crouchStateOf keeps it).
  if (preCrouch) {
    const lead = members.find((m) => m.sheet === party.members[party.active]?.sheet);
    if (lead && standing(lead)) {
      crouched.set(lead, { at: { x: preCrouch.at.x, z: preCrouch.at.z } });
      bodyOf(lead).crouched = true; // usually already true; seeding must not depend on it
    }
  }

  app.on('update', update);
  log('Combat!');

  // Read-only handle for tests, plus a few live setters god mode (god.js) uses
  // to edit turn state in place. Tests only ever read phase/ap/armed/enemies;
  // the added members are harmless to them. Everything single-character maps
  // to the ACTIVE member.
  window.__combat = {
    get phase() { return phase; },
    // The AI's working state for the unit whose turn it is, or null on a
    // player turn. This exists for DIAGNOSIS: when a fight stops handing out
    // turns, the action bar just reads "disabled", and the three explanations -
    // the AI beat is waiting, the acting unit is stuck part-way through a walk
    // (the driver returns early while `moving`), or the turn engine stalled -
    // are indistinguishable from outside. `wait` and `moving` tell them apart.
    get acting() {
      if (!acting) return null;
      const u = acting.unit;
      return {
        name: u.def.name, ap: acting.ap, wait: Number(acting.wait?.toFixed?.(2) ?? acting.wait),
        moving: !!u.moving, alive: !!u.alive, x: u.x, z: u.z,
      };
    },
    get ap() { return active.ap; },
    // Where the acting member's BODY is (continuous, not the rounded tile) -
    // what a test aims project3 at to click on themselves. The tile alone is
    // off by up to half a tile at this camera angle, which is exactly the
    // mis-click the body-pick-first rule exists to prevent.
    get actingAt() { const p = posOf(active); return { x: p.x, z: p.z }; },
    // Who is holding an overwatch, by name (POWERS_PLAN M5). A stance is a
    // commitment that pays off on somebody ELSE's turn, so a test that cannot
    // see it can only assert the swing and guess at the cause.
    get watching() {
      return [...watching.keys()].map((u) => (u.sheet ? u.sheet.name : u.def.name));
    },
    // Who is crouched, and behind which cell (TACTICS_PLAN M6) - the suite's
    // window into the take-cover commitment and its lazy breaks. Edge-mode
    // crouches (against a partition) carry `edges` and no cell.
    // Who is crouched, WHERE, and which faces are covering them. `x, z` is
    // the tile they stand on - the crouch IS a position now, so there is no
    // separate shield cell to report - and `faces` is the live list the next
    // shot resolves against, which is what a spec should assert on.
    get crouched() {
      return [...crouched.entries()].map(([u]) => {
        const s = crouchStateOf(u);
        return s && {
          name: nameOf(u), x: s.at.x, z: s.at.z,
          faces: s.faces.map(([ox, oz]) => `${ox},${oz}`),
          covers: coverNames(s.at.x, s.at.z, s.faces),
        };
      }).filter(Boolean);
    },
    // The movement allowance left this turn (MOVEMENT_PLAN M2). 0 for a
    // character without the talent.
    get freeAp() { return active.freeAp || 0; },
    set ap(v) { active.ap = Math.max(0, roundAp(Number(v) || 0)); refresh(); },
    get armed() { return armed; },
    // The aim wash (TACTICS_PLAN M7): which aim is painted and how many tiles
    // it covers. A test that can't see the wash can only assert the click.
    get aimPaint() { return aimPaint.debug; },
    get enemies() { return engaged.map((e) => ({ name: e.def.name, x: e.x, z: e.z, hp: e.hp, alive: e.alive, statuses: statusList(e) })); },
    get maxAp() { return active.sheet.maxAp; },
    get defended() { return hasStatus(active.sheet, 'deflecting'); },
    set defended(v) {
      if (v) applyStatus(active.sheet, 'deflecting');
      else removeStatus(active.sheet, 'deflecting');
      refresh();
    },
    // The hit-roll pin (HIT_PLAN.md): true = always hit, false = always miss,
    // null = roll honestly. The e2e suite sets it to make combat deterministic.
    get forceHit() { return forceHit; },
    set forceHit(v) { forceHit = v == null ? null : !!v; },
    // The weapon on-hit proc pin (EQUIPMENT_PLAN #8): true = always proc,
    // false = never, null = roll. The e2e suite pins it deterministic.
    get forceProc() { return forceProc; },
    set forceProc(v) { forceProc = v == null ? null : !!v; },
    // The most recent attack roll { chance, hit }, and the to-hit chance the
    // armed-hover preview is currently showing - both for the e2e suite to
    // assert the previewed odds match the math that actually rolls.
    get lastRoll() { return lastRoll; },
    get hoverHitChance() { return hoverHitChance; },
    get lastClickOutcome() { return lastClickOutcome; },
    // Is the movement trail currently drawn? Aiming at a coworker must replace
    // it with the to-hit readout, not draw both.
    get movePreview() { return !!preview; },
    get usesLeft() { return active.usesLeft; }, // live { actionId: count } - edit in place, then call refresh()
    get party() {
      return members.map((m) => ({ name: m.sheet.name, hp: m.sheet.hp, ap: m.ap, active: m === active, statuses: statusList(m.sheet) }));
    },
    // Test/debug: apply a status to the active member (STATUS_PLAN e2e). Enemy
    // statuses arrive naturally (a shove stuns, a fire tile burns).
    // Debug/e2e pin: land `id` on the acting member. `resist` defaults to 0 -
    // an unresisted, full-severity application, so a test pinning a status gets
    // exactly what it asked for - and pass a number to exercise Composure's
    // blunting (statuses.js severity) without building a character for it.
    // Apply a status to the acting member, or - with `targetName` - to a named
    // coworker. The enemy-side target exists because statuses on THEM are half
    // the system and were unreachable from outside: a spec that wants a
    // coworker to hold still (to drop a bookcase on them, to measure cover)
    // could only get there by playing out the power that applies it, which
    // makes the spec a test of that power instead of the thing it is about.
    applyStatus: (id, duration, resist = 0, targetName = null) => {
      const target = targetName
        ? engaged.find((e) => e.alive && e.def.name === targetName)
        : active.sheet;
      if (!target) return false;
      const ok = applyStatus(target, id, { duration }, resist);
      // Charm routes through the real borrow, so a spec that pins it exercises
      // the same code the action does rather than a parallel imitation.
      if (ok && id === 'charmed' && target !== active.sheet) {
        charmUnit(target, duration ?? STATUSES.charmed.duration);
      }
      refresh();
      return ok;
    },
    // Crouch a named coworker where they stand. Same rationale as the status
    // pin above: the enemy-side crouch is half of Pull Over's testable surface
    // (TACTICS_PLAN M8), and the only natural route there is steering the AI
    // into its turtle beat - which would make a pull spec a test of AI pathing
    // instead of the verb. Routes through the real `crouchHere`, so the
    // commitment it plants is the one the pull actually reads - and it returns
    // false when that tile has no shielded face, rather than planting a crouch
    // the rules would refuse.
    crouch: (targetName) => {
      const u = engaged.find((e) => e.alive && e.def.name === targetName);
      if (!u || !crouchHere(u)) return false;
      refresh();
      return true;
    },
    // End the ACTING turn programmatically. The e2e suite needs this: driving
    // rounds by clicking End Turn costs a DOM round-trip and a settle per turn,
    // which under software GL is seconds each - a spec that has to advance
    // three rounds spends its whole budget on the clicking rather than on what
    // it is testing. Same call the button makes.
    endTurn: () => { advanceTurn(); refresh(); },
    // The initiative order, top to bottom, with whose turn it is - for the
    // tracker UI and the e2e suite.
    // `current` stays SINGLE under a shared turn - it is the steered slot -
    // while `held`/`done` say who else is holding the open turn and who has
    // already ended theirs. `init` stays here for the tests even though the
    // strip no longer prints it.
    get order() {
      const heldSet = new Set(turns.held);
      return turns.order.map((s, i) => ({
        name: slotName(s), team: s.team, init: s.init,
        member: !!s.member, current: i === turns.index, alive: slotAlive(s),
        held: heldSet.has(s), done: turns.isDone(s),
      }));
    },
    get turn() { return turns.current ? slotName(turns.current) : null; },
    get summons() {
      return members.filter((m) => m.isSummon && m.sheet.hp > 0 && m.actor)
        .map((m) => ({
          name: m.sheet.name, x: m.actor.x, z: m.actor.z, hp: m.sheet.hp,
          turnsLeft: m.actor.summonTurns,
        }));
    },
    // Test/debug: drop a player-team summon beside the active member, as the
    // HR class's Post the Role does. Bypasses caps - callers set the count -
    // and takes an optional lifetime so a test can watch one time out.
    summonAlly: (id, n = 1, lifetimeTurns = null) =>
      resolveSummon(active.actor, 'player', { archetype: id, count: n, cap: n, lifetimeTurns }),
    refresh,
  };

  // Kick off the initiative order. Started from the persistent hotbar, the
  // initiator AMBUSHES: the throwing member leads off regardless of their roll
  // (they caught the coworker cold - the same reason distant enemies start
  // surprised), then fires the armed opener as part of that turn. Otherwise
  // the highest roll simply goes first - which can be an enemy.
  // This runs AFTER window.__combat is published: an opening strike can kill
  // the last enemy outright, and that victory's cleanup() deletes the handle -
  // which a later assignment would have resurrected, leaving a dead controller
  // on window while __game.inCombat said the fight was over.
  if (opening && ACTIONS[opening.actionId] && opening.target?.alive) {
    turns.lead((s) => s.member === members[party.active]);
    logInitiative(); // after lead - the ambusher's raised roll is the real order
    beginTurn();
    if (phase === 'player') {
      armed = opening.actionId;
      refresh();
      handleEnemyClick(opening.target);
    }
  } else {
    logInitiative();
    beginTurn();
  }

  return {
    handleTileClick,
    handleEnemyClick,
    handleHover,
    // The hover's ground fallback, exported so main.js's combat click runs the
    // SAME near-a-body test the crosshair just ran - an exact-tile match there
    // was a third authority, and it routed clicks into a walk on points where
    // the cursor was promising a swing.
    enemyAtPoint,
    // The friendly half of the same contract (POWERS_PLAN M1): main.js routes
    // a pick on a party/summon body here so a buff lands on the mesh the
    // player clicked, not on the floor tile behind it.
    handleAllyClick,
    allyAtPoint,
    // Is the armed action aimed at friends? main.js asks before it decides
    // which side of the board a click belongs to - it must not consult
    // ACTIONS itself, or there would be two answers to one question.
    get armedIsFriendly() { return aimsAtAlly(ACTIONS[armed]); },
    // --- the shared action bar -------------------------------------------------
    // main.js renders one bar for the whole game and asks these three things of
    // a fight: what does pressing a slot do, can it be pressed, and what has the
    // reorg done to the order. Combat keeps the rules; main.js keeps the DOM.
    pressAction,
    actionState,
    scrambleEntries,
    // Bill a verb that is not an ACTION against the acting member's pool - a
    // consumable, pressed from the bar or from the pockets. Returns false when
    // they cannot afford it, so the caller refuses without spending anything.
    // Everything else in a turn is billed; a free full heal every round would
    // be the strongest move in the game.
    spendAp: (n) => {
      if (phase !== 'player' || active.ap < n) return false;
      active.ap -= n;
      refresh();
      return true;
    },
    // Which slot is awaiting its second, committing press (an instant
    // self-action). The bar rings it differently from an armed one.
    get pendingConfirm() { return pendingConfirm; },
    notifyMemberDown,
    // --- steering the shared turn ----------------------------------------------
    // The party bar, Tab, body clicks and the debug switchTo all route here IN
    // combat instead of switchLeader (INITIATIVE_PLAN #9): steering re-keys the
    // combat bindings only - makeActive, via the engine's steer hook - and
    // never touches the out-of-combat leader. `ref` is whatever the caller
    // holds: a party record, a combat member, or a body's actor.
    //
    // Refusal is the common case and it is load-bearing: only a member holding
    // the OPEN turn, not yet done, not the one already steered, is accepted -
    // so out of a shared turn every route falls through to what it always did
    // (a bar click highlights nobody new, a body click stays a mis-walk).
    steerMember(ref) {
      if (phase !== 'player' || !ref) return false;
      const slot = turns.held.find((s) => s.member
        && (s.member === ref || s.member.sheet === ref.sheet || s.member.actor === ref));
      if (!slot || slot.member === active || turns.isDone(slot)) return false;
      return turns.steer(slot);
    },
    // Is this body a member you could grab the wheel of right now? The
    // right-click menu asks before offering the item; returns the name to put
    // on it, or null.
    canSteer(ref) {
      if (phase !== 'player' || !ref) return null;
      const slot = turns.held.find((s) => s.member
        && (s.member === ref || s.member.sheet === ref.sheet || s.member.actor === ref));
      if (!slot || slot.member === active || turns.isDone(slot) || slot.member.sheet.hp <= 0) return null;
      return slot.member.sheet.name;
    },
    // Tab in combat: cycle the floor through the un-done members of the open
    // shared turn, the same loop the key walks through the roster out of one.
    cycleSteer() {
      if (phase !== 'player') return false;
      const holders = turns.held.filter((s) => s.member && !turns.isDone(s) && s.member.sheet.hp > 0);
      if (holders.length < 2) return false;
      const i = holders.findIndex((s) => s.member === active);
      return turns.steer(holders[(i + 1) % holders.length]);
    },
    // The body whose turn it is - a party member OR a summon you're driving.
    // main.js needs this because party.active can't point at a summon.
    get actingActor() { return active.actor; },
    // ...and the sheet the HUD card is reflecting for that turn, so main.js's
    // per-tile hooks repaint the RIGHT character when a step hurts them.
    get actingSheet() { return active.sheet; },
    // Per-member turn snapshot, for the party bar's in-combat AP readout.
    get party() {
      return members.map((m) => ({ name: m.sheet.name, hp: m.sheet.hp, ap: m.ap, active: m === active }));
    },
    // main.js detected a slip mid-walk (tile effects live there) - narrate it
    notifySlip: () => log('You slip in the water. The rest of that movement is a donation.'),
    // A party-side body entered a tile under its own power - main.js owns the
    // per-tile hooks for members and summons, so it reports the step here and
    // combat resolves any opportunity attack it provoked (TACTICS_PLAN M2).
    notifyStep,
    // Repaint the panel and initiative strip - main.js calls this when a
    // character's portrait finishes rendering mid-fight.
    refresh,
    // Right-click backs out of an armed action / a pending confirm. Returns
    // true if it consumed the click, so main.js can suppress the context menu.
    cancelArmed: () => {
      const consumed = cancelArmed();
      if (consumed) refresh();
      return consumed;
    },
    abort: cleanup, // for deaths resolved outside combat (surfaces, explosions)
    get active() { return phase !== 'done'; },
  };
}
