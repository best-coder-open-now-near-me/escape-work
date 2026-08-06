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
import { createPlayerStrike } from './player-strike.js';
import { formatDamageFormula } from './combat-formulas.js';
import { createActionBar } from './action-bar.js';
import { createClickVerbs } from './click-verbs.js';
import { createDemolition } from './demolition.js';
import { createVerbs } from './verbs.js';
import { createTurnFlow } from './turn-flow.js';
import { createAiVerbs } from './ai-verbs.js';
import { createHitResolution, MISS_COLOR } from './hit-resolution.js';
import { createCoverDenialPlans } from './cover-denial-plans.js';
import { createSummonDesk } from './summon-desk.js';
import { createCrouch } from './cover-crouch.js';
import { ACTIONS, UNIVERSAL_ACTIONS, arrivalLine, summonSpec } from './data/actions.js';
import { SURFACES } from './data/surfaces.js';
import { throwablesFor as throwableIdsFor } from './hotbar-model.js';
import { truncateByBudget, routeToFiringPosition, trimToFirst } from './pathfinding.js';
import { pronounsOf, capitalize, verb } from './creation.js';
import { createSheetFrom, damageBonus, applyDamage, deflect, soakHit, statusResist, hitChance, rollHit, rollInt, accuracy, dodge, equippedAction, orderedActionIds, weaponProc, moveCostOf, reachOf, rangeOf, ammoCostOf as ammoCost, effectiveAttr, gritSaveChance, roundAp, fmtAp, MOVE, REACH } from './stats.js';
import {
  applyStatus, hasStatus, statusFx, clearStatuses, removeStatus, statusList, blockedBy,
  statusSeverity, tickStep,
} from './statuses.js';
import { cheb, toHitTerms, provokedBy, positionMods, inReach, dist, dirOctant, TACTICS, shieldingFace } from './tactics.js';
import { crouchFacesAt as facesAtCrouch, crouchProblem, enterCrouch } from './crouch-rules.js';
import {
  buffProblem, buffOutcome, buffRangeOf, isFriendly, controlProblem, controlOutcome, controlIsRanged, isControl, isZone, zoneProblem, zoneRadiusOf, zoneRangeOf, isMobility, aimsAtAlly, mobilityProblem, mobilityRangeOf, dashDistanceOf, isStance, watchRadiusOf, watchTriggers, isToppleable, aimsAtAnyone, isPurge, coneFrom, conePolyline, aimRangeOf, isBreakable, aimsAtProps, isPull,
} from './powers.js';
import { createAimPaint } from './aim-paint.js';
import { createAimView } from './combat-aim.js';
import { createCombatIntent } from './combat-intent.js';
import { createCombatDebug } from './combat-debug.js';
import { createCombatSession } from './combat-session.js';
import { createAiAdvance } from './combat-advance.js';
import { STATUSES } from './data/statuses.js';
import { blocksSight, PARTITION_TOPPLE } from './data/tiles.js';
import { PANEL_CHROME, createCombatReadout, apPips } from './ui.js';
import { createTurnOrder } from './turn-order.js';
import { slips, speedUnderStatus, impactKindFor, surfaceEffect,
} from './step-rules.js';
import {
  topplePlan as toppleplanAt, aiTopplePlan as aiToppleplanFor, breakPlan,
  aiShovePlan as aiShovePlanShared, aiEdgeTopplePlan as aiEdgeTopplePlanShared,
  aiPullPlan as aiPullPlanShared, aiBreakPlan as aiBreakPlanShared,
  pullPlan as pullplanFor, displacePlan,
} from './combat-plans.js';
import {
  standTilePath as standTileRoute, standTileRoutes, scoreDestination,
  pickTarget as pickBest, advanceRoute, firingTileRoutes,
  aiCrouchCovered, chooseBeat, beatStateFrom, lineWeights, aiSupportPlan,
  takeBeat as runBeat, aiBeatPlansFrom as gatherBeatPlans,
} from './combat-ai.js';
import {
  enemyRingOk, verbKind, verbSides, toppleRings, partitionRings, breakRings,
} from './combat-targeting.js';
import { summonSpotProblem as spotProblem, summonRoom as capRoom, dropCount, countLiveSummons } from './summon-rules.js';
import {
  TARGET_R, SURPRISE_RADIUS, reachOfUnit, posOf, withinReach,
  canReach as canReachAt, reachSpecOf, actRangeOf, verbReaches as verbReachesAt,
  swingPointAt as swingPointFrom, hasSwingSpot as hasSwingSpotFor, zoneCellsFor,
} from './combat-geometry.js';
import { createGroundMarks } from './ground-marks.js';
import { resolveSurfaceLanding } from './forced-landing.js';
import { NEIGHBOR_DIRS } from './directions.js';
import { mulberry32Uint } from './rng.js';
import { isLivingMember } from './member-rules.js';

const pc = globalThis.window?.pc;
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

export function startCombat({ app, party, engaged, world, fx, callbacks, opening = null, allies = [], preCrouch = null, sneakOpened = null, rng = Math.random }) {
  // Per-member turn state: every party member fights with their own AP pool,
  // deflect stance and limited-use counters. `session.activeMember` is whose action bar,
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
  const livingMembers = () => members.filter(isLivingMember);
  // Summons still standing from an EARLIER fight (they outlive it now - main.js
  // keeps them until their assignment runs out) walk back in as the temporary
  // members they already were: same sheet, same body, whatever turns they have
  // left. They enter after the real roster, so party.active still indexes right.
  for (const s of allies) {
    // Carrying the summoner in with them is what keeps the live cap honest
    // across fights: counted as summonedBy: null, two employees who survived
    // the last fight were invisible to the cap check and their summoner could
    // post a full new batch on top of them.
    if (isLivingMember(s)) {
      members.push(asMember(s, { isSummon: true, summonedBy: s.summonedBy || null }));
    }
  }
  // Shared encounter lifecycle: current driver, AI turn budget and the deal
  // shown by a confused action bar. The systems below all see this one owner.
  const session = createCombatSession(members[party.active]);
  // Everyone you control: party members plus any summons you've conjured
  // (temporary members, appended by resolveSummon). `livingParty` is the real
  // roster only - a party WIPE (no real member standing) is the sole game-over;
  // a summon falling never is, and a lone summon can't stave off defeat.
  // Every damage roll in this fight, bound to the injected rng.
  const rand = (lo, hi) => rollInt(rng, lo, hi);
  // Hoisted to the TOP of this closure on purpose. `canEngage` reads `canReach`
  // and `pickTarget` runs during the startCombat surprise sweep below - before
  // any turn exists - so anything the sweep can reach has to be initialised
  // before it. The file already said this in prose ("everything here must be
  // safe EAGERLY"); leaving the factory where the code came from put `canReach`
  // in its dead zone and startCombat threw on the first fight.
  // Does it land, and what does that look like (hit-resolution.js). The three
  // debug pins - `forceHit`, `forceProc`, `lastRoll` - are OWNED there: this
  // cluster was their only writer, so they moved with it and are reached back
  // through the accessors the debug surface already used.
  const hits = createHitResolution({
    world,
    members,
    fx,
    rng,
    get active() { return session.activeMember; },
    // A Map declared below this call - a getter, or it is a dead-zone read.
    get facings() { return facings; },
    aiAllies: (...a) => aiAllies(...a),
    bodyOf: (...a) => bodyOf(...a),
    standing: (...a) => standing(...a),
    posOf: (...a) => posOf(...a),
    nameOf: (...a) => nameOf(...a),
    carrierOf: (...a) => carrierOf(...a),
    unitStandingAt: (...a) => unitStandingAt(...a),
    guardStandingAt: (...a) => guardStandingAt(...a),
    coverCellFor: (...a) => coverCellFor(...a),
    crouchStateOf: (...a) => crouchStateOf(...a),
    crouchFacesOf: (...a) => crouchFacesOf(...a),
    log: (...a) => log(...a),
    formula: (...a) => formula(...a),
  });
  const {
    resolveHit, statusesOf, accuracyOf, dodgeOf, canReach, bodyDist, bodyLos,
    distToTile, losToTile, attackMods, rollAgainst, resolveProc, hitFx,
    statusFxAt, deathFx, hazardKind, surfaceStepCost, stepCost,
  } = hits;
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
    // The floor has to reach them. EnemyActor still calls GridActor before its
    // combat pause, so install both movement streams on the borrowed body.
    // Cleared in releaseCharm, or aiAdvance would inherit the player's rules
    // when the body changes hands again.
    unit.onTile = (x, z, done, changed) => world.borrowedStep?.(m, x, z, done, changed);
    unit.onTravel = (segment) => world.borrowedTravel?.(m, segment);
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
      // Hand the step seam back with the body. Left installed it would keep
      // routing their steps through the PLAYER's rules after they have gone
      // back to their own side, and aiAdvance would be assigning over it.
      unit.onTile = null;
      unit.onTravel = null;
      unit.hp = Math.max(0, m.sheet.hp); // whatever happened to them, happened
      // A death while borrowed is still a real enemy death: run the actor's
      // death path so its loot/body state is the same as any other casualty,
      // rather than only flipping `alive` and leaving an unlootable shell.
      if (!unit.hp) {
        if (unit.alive && unit.die) unit.die();
        else unit.alive = false;
      }
      world.setCharmed?.(unit, false);
      removeStatus(unit, 'charmed');
      // Back to their own side, in the same place in the round.
      turns.replace((slot) => slot.member === m, unitSlot(unit));
    }
    // The floor cannot be held by somebody who just left it - the same handoff
    // dismissSummon makes when an assignment lapses mid-turn.
    if (session.activeMember === m) makeActive(livingParty()[0] || members[0]);
    refresh();
  }

  // A borrowed body can fall to an enemy swing, forced movement, a surface,
  // or a turn-start status. Every path hands it back through this seam before
  // the turn engine asks who is alive. Keeping this beside releaseCharm makes
  // it impossible for one damage path to forget the enemy-side death effects.
  function releaseDeadCharm(m) {
    if (!m?.isCharmed || m.sheet.hp > 0) return false;
    const unit = m.unit;
    log(`${m.sheet.name}'s remote session ends the hard way.`);
    releaseCharm(m);
    if (unit) {
      deathFx(unit);
      callbacks.onEnemyKilled(unit);
    }
    return true;
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
  // Who is on the AI's OWN side right now (AI_PLAN M3/M6). `engaged` is not
  // that list: a charmed coworker stays in it, alive, and deliberately keeps
  // counting for `hostilesRemain` (charming the last enemy must not win the
  // fight) - but for the duration they are fighting for the PLAYER. So the
  // AI's ally-shaped questions - who completes my pincer, who do I patch up -
  // ask this instead, or an enemy ends up healing the colleague currently
  // swinging at it. Side is live state, never registry (AI_PLAN footgun 5).
  const aiAllies = () => engaged.filter((e) => e.alive && !hasStatus(statusesOf(e), 'charmed'));
  // The party proper: not summons, and not anyone merely BORROWED. A charmed
  // coworker standing while your whole roster is face down is not a party that
  // is still going - the run has ended, you are just driving somebody else for
  // another turn or two.
  const livingParty = () =>
    livingMembers().filter((m) => !m.isSummon && !m.isCharmed);
  // The AI enemies hunt the whole player side - members and summons alike, all
  // members now. A target wraps { actor, member }; combat reads `member` to take
  // the hit on its sheet (deflect, gum, the downed rules).
  // The route to a tile the unit could stand on and swing from: the shortest
  // path to any of the target's eight neighbours, or null if none is reachable.
  // Shared by pickTarget and aiAdvance so the two can never disagree about who
  // is engageable - if the target picker says yes, the mover must find a route.
  // "Could this unit swing at that body from tile (gx, gz)?" - the AI's half of
  // the question `combat-geometry.swingPointAt` has always answered for the
  // player. Threaded into the stand-tile fields so engageability means what it
  // says (REVIEW.md 2026-08-02 section 1.16).
  const swingFieldFor = (unit, target) => ({
    ...world,
    canSwingFrom: (gx, gz) => !!swingPointFrom(unit, target.actor || target, gx, gz, world),
  });
  const standTilePath = (unit, target) =>
    standTileRoute(unit.x, unit.z, target.actor.x, target.actor.z, swingFieldFor(unit, target));

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
  // The sparring tally (AI_PLAN M1): what this fight's AI did, in numbers a
  // seeded bout can diff. beats is the histogram of chosen AI beats - the
  // regression tripwire a damage total can't be (a change that zeroes
  // 'attack' broke gating, whatever the damage says). dmgDealt counts what
  // AI swings actually land on member sheets (OAs included - they resolve
  // through the same strike).
  //
  // oaCount is the AI's OWN provokes - opportunity attacks it walked its
  // coworkers into, which is the number M3's acceptance wants going DOWN as
  // the destination scorer learns to route around threat. It counted BOTH
  // sides for its whole life, which made it useless for that: the passive-
  // party bout the tally is designed around moves nobody, but any bout with a
  // player in it mixed the player's mistakes into the AI's score and could
  // rise while the AI got strictly better. Overwatch is deliberately outside
  // it - a held stance that fires is not a provoke, and no routing choice
  // avoids it.
  const bout = { rounds: 0, dmgDealt: 0, beats: {}, oaCount: 0 };

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

  // Which member this unit fights (combat-ai.pickTarget): engageable first,
  // then the scored blend - proximity, kill-securability, fragility - shaped
  // by the def's `focus` and held steady by stickiness on the standing mark
  // (AI_PLAN M2). Combat supplies the leaf facts; the rule lives in the pure
  // module.
  //
  // Everything here must be safe EAGERLY: pickTarget runs during the
  // startCombat surprise sweep, before any turn exists - which is why these
  // are declared before it and read no turn state.
  const aiTargets = new Map(); // unit -> the member it last committed to
  // Swings-to-down, on the unit's own lines: mean damage across its attack
  // entries vs the member's current HP. Soak and deflect deliberately ignored
  // (AI_PLAN M2) - this is a target-picking estimate, not a damage promise,
  // and reading a sheet's stance into it would make the choice twitchy.
  const expectedSwings = (unit, m) => {
    const lines = unit.combat.attacks;
    if (!lines.length) return Infinity;
    const avg = lines.reduce((s, a) => s + (a.min + a.max) / 2, 0) / lines.length;
    return Math.ceil(Math.max(1, m.sheet.hp) / Math.max(1, avg));
  };
  const pickTarget = (unit) =>
    pickBest(unit.x, unit.z, livingMembers(), (m) => canEngage(unit, m), {
      focus: unit.def.focus,
      current: aiTargets.get(unit) || null,
      expSwings: (m) => expectedSwings(unit, m),
    });

  // Enemies pulled in from a distance are surprised - they spend their first
  // turn realizing what's happening, so group openings don't alpha-strike you.
  // A fight begun FROM SNEAK judges surprise by SIGHT instead (SNEAK_PLAN
  // D6): whoever had no line to the initiator - facing away, behind the desk
  // row, out of the cone - loses turn one however close they stand, and the
  // distance proxy stays untouched for ordinary fights. `sneakOpened.saw` is
  // main.js's capture of who saw the initiator at the moment the sneak broke.
  for (const en of engaged) {
    if (sneakOpened) {
      if (!sneakOpened.saw.has(en)) applyStatus(en, 'surprised');
      continue;
    }
    const t = pickTarget(en);
    if (!t || cheb(en.x, en.z, t.actor.x, t.actor.z) > SURPRISE_RADIUS) applyStatus(en, 'surprised');
  }
  // Disgruntled (SNEAK M4): the opening strike of a sneak-opened fight, and
  // only that strike, carries the ambush bonus - consumed by the FIRST roll
  // that damages a coworker, whoever it lands on.
  let sneakAmbushArmed = !!sneakOpened;
  const ambushDmg = (dmg) => {
    if (!sneakAmbushArmed) return dmg;
    sneakAmbushArmed = false;
    const b = talentFxOf(session.activeMember)?.ambushDamage || 0;
    if (!b) return dmg;
    log('They never saw it coming.');
    return Math.round(dmg * (1 + b));
  };
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
  // Members carry talents on their sheet; an enemy archetype may carry the
  // same data shape on its def. Keeping that distinction here lets every
  // combat rule ask about talent effects without quietly becoming party-only.
  const talentFxOf = (u) => (u?.sheet
    ? u.sheet.talent?.effects
    : u?.def?.talent?.effects) || {};
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
    // The ALLOWANCE keeps its exact remainder; only the display rounds it
    // (`fmtAp`, in the AP tag). Rounding the running total to tenths made the
    // allowance a ratchet it could never climb down: a step costing 0.05 took
    // 0.05 off 1.0, rounded 0.95 straight back up to 1.0, and the free move
    // was still whole. Repeat it and you have unlimited free movement in
    // 0.05 doses. Real AP below still rounds - that is the currency the player
    // reads, and it errs toward charging rather than not.
    const left = (holder.freeAp || 0) - fromFree;
    holder.freeAp = left < 1e-9 ? 0 : left; // float dust is not an allowance
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
  // Which throws a member has: hotbar-model.js owns that rule for both bars.
  // Combat kept its own copy of the filter, and two copies of one rule is how
  // a learned power ended up on everybody's bar - the flag that fixed it here
  // did nothing out of combat until they were merged.
  const throwablesFor = (m) => throwableIdsFor(m.sheet);
  // Everyone can shove - it's an office, not a fencing academy - and everyone
  // has a basic weapon swing (the equipped weapon's, or bare-handed 'punch').
  // In the canonical order (stats.orderedActionIds), the same one the
  // out-of-combat hotbar renders: the basic swing, shove, throws, class powers,
  // what a talent granted, what is in hand. The two bars showing one kit in two
  // different orders is a tax paid mid-fight, when there is least attention to
  // spare for re-reading a row of buttons.
  const actionIdsOf = (m) => orderedActionIds(
    m.sheet,
    [...m.sheet.actions, equippedAction(m.sheet), ...UNIVERSAL_ACTIONS, ...throwablesFor(m)],
  );
  // A weapon equipped after initiative was rolled can introduce a per-fight
  // limited-use action that `asMember` could not seed at combat start. Seed it
  // once when the live kit is repainted; swapping away and back keeps the same
  // counter, while a genuinely new weapon starts with its authored allowance.
  const syncActionUses = (m) => {
    if (!m) return;
    for (const id of actionIdsOf(m)) {
      if (ACTIONS[id]?.uses && m.usesLeft[id] === undefined) {
        m.usesLeft[id] = ACTIONS[id].uses;
      }
    }
  };
  // The acting member's cost for a throw - the shared rule (stats.js), bound to
  // whoever currently has the floor.
  const ammoCostOf = (id) => ammoCost(session.activeMember.sheet, id);
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
  // AP is spent in tenths now that movement charges by distance - `roundAp`
  // and `fmtAp` come from stats.js, which owns that rate.

  // Proper per-unit initiative (initiative.js): ONE interleaved order for the
  // whole fight, not side-phases. `session.phase` says who's driving the
  // CURRENT turn: 'player' (a party member you control) | 'ai' (an enemy or a
  // player-team summon the AI drives) | 'done'.
  let pendingMelee = null; // { en, action } to strike when the walk-up completes
  let pendingCrouch = null; // { tx, tz, spot } to tuck in when the walk-up completes
  // EVERY instant self-cast takes a confirm click - the stances (Deflect,
  // Return to Sender) and every heal (Coffee, Espresso, Energy Drink, Snack
  // Cart, the smoke break). They all used to commit the moment you touched the
  // button, so a stray click could spend a turn's AP with nothing to undo it.
  // Targeted actions already worked this way: arm, then commit. Right-click
  // backs out of either. (Summons are targeted now - you pick the spot - so
  // they arm like an attack instead of confirming in place.)
  const INSTANT_CONFIRM = new Set(['defend', 'stance']);
  // Who is holding an overwatch right now: combatant -> the action id they
  // took it with (POWERS_PLAN M5). A stance lasts until the holder's OWN next
  // turn, so it is cleared in beginTurn rather than on a timer - "until your
  // next turn" is a position in the initiative order, not a duration, and
  // giving it a tick count would desynchronise the two the moment a joiner
  // was inserted mid-round.
  const watching = new Map();
  const crouched = new Map();
  // The crouch and what it is still behind (cover-crouch.js). `crouched` and
  // `watching` go in BY REFERENCE - they are Maps the host never reassigns, so
  // both sides mutate the one object and setters would be ceremony.
  const {
    guardStandingAt, nameOf, carrierOf, breakCrouch, coverCellFor,
    crouchFacesOf, crouchStateOf, shotOutcome, shotOutcomeFrom, crouchLabel, coverNames,
  } = createCrouch({
    crouched,
    watching,
    world,
    members,
    ACTIONS,
    posOf,
    blocksSight,
    applyStatus,
    removeStatus,
    hasStatus,
    aiAllies: (...a) => aiAllies(...a),
    bodyOf: (...a) => bodyOf(...a),
    standing: (...a) => standing(...a),
    unitStandingAt: (...a) => unitStandingAt(...a),
    log: (...a) => log(...a),
  });
  // One explicit owner for what the next click will do. The callbacks are
  // intentionally deferred: the aim view is constructed below, but no intent
  // can be cleared until the fight has finished constructing it.
  const intent = createCombatIntent({
    actions: ACTIONS,
    clearAim: () => aim.clearAim(),
    log: (...a) => log(...a),
  });
  const disarm = (...a) => intent.disarm(...a);
  const cancelArmed = (...a) => intent.cancel(...a);

  // The AI's advance (combat-advance.js) - the largest arm of the turn, and
  // the last one still living in this closure. It reads exactly one piece of
  // shared turn state (`facings`), which is what made it movable.
  const aiAdvance = createAiAdvance({
    get world() { return world; },
    get facings() { return facings; },
    get fx() { return fx; },
    get callbacks() { return callbacks; },
    rng,
    slips: (...a) => slips(...a),
    advanceRoute: (...a) => advanceRoute(...a),
    aiAllies: (...a) => aiAllies(...a),
    aiCrouchCovered: (...a) => aiCrouchCovered(...a),
    unitStandingAt: (...a) => unitStandingAt(...a),
    standing: (...a) => standing(...a),
    applyStatus: (...a) => applyStatus(...a),
    beginMove: (...a) => beginMove(...a),
    deathFx: (...a) => deathFx(...a),
    firingTileRoutes: (...a) => firingTileRoutes(...a),
    hasStatus: (...a) => hasStatus(...a),
    hazardKind: (...a) => hazardKind(...a),
    livingMembers: (...a) => livingMembers(...a),
    log: (...a) => log(...a),
    notifyStep: (...a) => notifyStep(...a),
    posOf: (...a) => posOf(...a),
    rangedLines: (...a) => rangedLines(...a),
    reachOfUnit: (...a) => reachOfUnit(...a),
    refresh: (...a) => refresh(...a),
    scoreDestination: (...a) => scoreDestination(...a),
    shotOutcomeFrom: (...a) => shotOutcomeFrom(...a),
    standTileRoutes: (...a) => standTileRoutes(...a),
    statusFx: (...a) => statusFx(...a),
    statusFxAt: (...a) => statusFxAt(...a),
    surfaceEffect: (...a) => surfaceEffect(...a),
    surfaceStepCost: (...a) => surfaceStepCost(...a),
    swingFieldFor: (...a) => swingFieldFor(...a),
    syncUnitSpeed: (...a) => syncUnitSpeed(...a),
    threatsAgainst: (...a) => threatsAgainst(...a),
    tickStep: (...a) => tickStep(...a),
    truncateByBudget: (...a) => truncateByBudget(...a),
  });

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
  // The same modifier as a member's, from the same attribute (initiative.js) -
  // AP used to stand in for it on this side only.
  const unitSlot = (u) => ({ unit: u, team: 'enemy', initMod: u.combat.hustle || 0 });
  const slotActor = (s) => (s.member ? s.member.actor : s.unit);
  const slotAlive = (s) => (s.member ? isLivingMember(s.member) : !!s.unit.alive);
  const slotName = (s) => (s.member ? s.member.sheet.name : s.unit.def.name);
  const slotCarrier = (s) => (s.member ? s.member.sheet : s.unit);
  // The traversal, the round wrap and the fixed sequence a turn opens with live
  // in turn-order.js - pure, and unit tested there. What stays here is what
  // needs a panel, a body or the app: the host answers below, and the four
  // functions they point at (takeTurn, skipTurnFor, expireSummon, applyTurnDot),
  // which now come off turn-flow.js, destructured a thousand lines below. They
  // used to be hoisted DECLARATIONS, so naming them here bare was fine; as
  // consts they are in their dead zone at this point in the file, and reading
  // one threw before the first fight could open. Wrapped, the lookup happens
  // when the turn engine actually asks.
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
      expire: (...a) => expireSummon(...a),
      dot: (...a) => applyTurnDot(...a),
      skip: (...a) => skipTurnFor(...a),
      take: (...a) => takeTurn(...a),
      roundStart: () => {
        // A full pass through the order is one round: age summoner cooldowns
        // and the fire/smoke lifecycle a tick.
        for (const e of engaged) {
          if (e.summonCd > 0) e.summonCd -= 1;
          if (e.supportCd > 0) e.supportCd -= 1; // the triage ration's pacing (AI_PLAN M6)
        }
        bout.rounds += 1;
        reactions.clear(); // everyone gets their reaction back (TACTICS_PLAN M2)
        callbacks.onRound?.();
      },
      turnStart: () => {
        engageMemo.clear(); // bounds how stale an answer can get
        session.beginScrambleTurn(); // a confused character's bar re-deals each turn
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
        disarm();
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
  // The floor marks and their palette, shared with hover.js (ground-marks.js)
  // so the aim ring and the hover ring cannot drift apart. Local aliases keep
  // the names the ~40 call sites below already use:
  //   REACH_RING    - dim and cool, information about YOU rather than a
  //                   judgement about a target (TACTICS_PLAN revision M5).
  //                   Drawn only while the cursor is over a coworker.
  //   PREVIEW_COVER - yellow, the reserved cover colour (M7's mapping), and
  //                   only ever on the HOVERED object: the designer's "there
  //                   would just be rings everywhere if not".
  const marks = createGroundMarks(app, pc);
  const PREVIEW_OK = marks.OK;
  const PREVIEW_FAR = marks.FAR;
  const REACH_RING = marks.REACH;
  const PREVIEW_COVER = marks.COVER;
  // Face bars are drawn while AIMING and again while the crouch HOLDS, off the
  // same live face list the shot resolves against - so a wall that comes down
  // goes dark on the next frame rather than lying until somebody shoots.
  const drawRing = marks.ring;
  const drawFaces = marks.faces;
  // The ground wash while a ranged verb is armed (TACTICS_PLAN M7): every tile
  // the aim can legally land on, line of sight included, painted translucent
  // blue. drawTargets drives it; `paintEpoch` names the world it was computed
  // against - refresh() bumps it, so anything that reshapes sight mid-turn (a
  // door opened, smoke landing) repaints on its next frame without this
  // module knowing why.
  const aimPaint = createAimPaint(app);
  // The aim VIEW (combat-aim.js): the wash, the walk preview, the ring drawers
  // and the five variables only they touch (`preview`, `previewDt`, `coverEase`,
  // `paintEpoch`, `aim.aimPoint`). Declared here, private there - the
  // point of the slice is that five thousand lines can no longer assign to
  // them, only ask through the named methods at the bottom of that file.
  // `view` hands over the turn, which IS still combat's: getters rather than
  // values, so a frame draws against the live turn and never a stale copy.
  const aim = createAimView({
    app,
    pc,
    marks,
    aimPaint,
    actions: ACTIONS,
    world,
    costTag,
    REACH,
    view: {
      get phase() { return session.phase; },
      get armed() { return intent.armed; },
      get active() { return session.activeMember; },
    },
    // Every rule is wrapped rather than passed by reference, and that is not
    // style. This object is built where `aim` is declared, which is ABOVE half
    // the closure - and six of these (`verbReaches`, `zoneCells`,
    // `summonSpotProblem`, `crouchFacesAt`, `friendlies`, `allyProblemFor`) are
    // `const` arrows declared further down. Passing those by reference reads
    // them in their temporal dead zone: the build is perfectly happy and the
    // first fight throws. Wrapping defers every lookup to call time, so the
    // bag cannot care where in the file a rule happens to live.
    ask: {
      TARGET_R,
      reachSpec: (id) => reachSpecOf(id),
      previewAction: () => previewAction(),
      isControl: (a) => isControl(a),
      isPurge: (a) => isPurge(a),
      isZone: (a) => isZone(a),
      isMobility: (a) => isMobility(a),
      isPull: (a) => isPull(a),
      isToppleable: (d) => isToppleable(d),
      aimsAtAlly: (a) => aimsAtAlly(a),
      rangeOf: (id) => rangeOf(id),
      ammoCostOf: (id) => ammoCostOf(id),
      shotOutcome: (u, en) => shotOutcome(u, en),
      crouchLabel: (b) => crouchLabel(b),
      nameOf: (u) => nameOf(u),
      bodyDist: (u, en) => bodyDist(u, en),
      bodyLos: (u, en) => bodyLos(u, en),
      canReach: (u, en, r) => canReach(u, en, r),
      hasSwingSpot: (en) => hasSwingSpot(en),
      routeIntoRange: (en, r) => routeIntoRange(en, r),
      routeBeside: (en) => routeBeside(en),
      previewWalk: (path, point, a, stop) => previewWalk(path, point, a, stop),
      controlIsRanged: (a) => controlIsRanged(a),
      controlProblem: (a, q) => controlProblem(a, q),
      attackMods: (u, t, plan) => attackMods(u, t, plan),
      hitChance: (acc, dodge, mods) => hitChance(acc, dodge, mods),
      mobilityProblem: (a, q) => mobilityProblem(a, q),
      dashDistanceOf: (a) => dashDistanceOf(a),
      truncateByBudget: (s2, b, c) => truncateByBudget(s2, b, c),
      stepCost: (...args) => stepCost(...args),
      moveBudget: (u) => moveBudget(u),
      roundAp: (v) => roundAp(v),
      fmtAp: (v) => fmtAp(v),
      allyAtPoint: (pt) => allyAtPoint(pt),
      enemyAtPoint: (pt) => enemyAtPoint(pt),
      verbSides: (a, r) => verbSides(a, r),
      coneTest: (a, x, z) => coneTest(a, x, z),
      conePolyline: (a, t) => conePolyline(a, t),
      toppleRings: (x, z, o) => toppleRings(x, z, o),
      topplePlan: (u, x, z) => topplePlan(u, x, z),
      // The tile click's own reach test, so the ring cannot promise a topple
      // the click then refuses as "Too far to shove" (Q100).
      toppleReaches: (x, z) => inReach(posOf(session.activeMember).x, posOf(session.activeMember).z, x, z, REACH.SHOVE),
      partitionRings: (x, z, w) => partitionRings(x, z, w),
      breakRings: (a, x, z, r, o) => breakRings(a, x, z, r, o),
      breakPlanAt: (id, x, z) => breakPlanAt(id, x, z),
      enemyRingOk: (a, q) => enemyRingOk(a, q),
      pullPlanFor: (en) => pullPlanFor(en),
      reachOfUnit: (u) => reachOfUnit(u),
      bodyOf: (u) => bodyOf(u),
      aimsAtAnyone: (a) => aimsAtAnyone(a),
      posOf: (u) => posOf(u),
      verbReaches: (id, en, x, z) => verbReaches(id, en, x, z),
      crouchStateOf: (u) => crouchStateOf(u),
      zoneProblem: (a, q) => zoneProblem(a, q),
      distToTile: (u, x, z) => distToTile(u, x, z),
      losToTile: (u, x, z) => losToTile(u, x, z),
      zoneCells: (a, x, z) => zoneCells(a, x, z),
      coneCells: (a, test) => coneCells(a, test),
      summonSpotProblem: (a, x, z) => summonSpotProblem(a, x, z),
      coverSpotProblem: (x, z) => coverSpotProblem(x, z),
      crouchFacesAt: (x, z) => crouchFacesAt(x, z),
      friendlies: () => friendlies(),
      allyProblemFor: (id, m) => allyProblemFor(id, m),
    },
  });
  // Three entry points where there were sixteen functions and eight shared
  // variables: the frame loop draws, main.js hovers, and combat hides the
  // readout when a turn or a verb ends.
  const { drawTargets, drawPreview, handleHover, hidePreview } = aim;
  // Test-only: what the last combat click resolved to. Every silent path
  // stamps a reason, so a wedged e2e run can say WHY a click did nothing
  // instead of leaving a trace full of clicks with no visible effect.
  let lastClickOutcome = null;

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
    let s = world.smooth(rawPath, session.activeMember.actor);
    // The identical trim the walk will apply - the ring has to sit where the
    // feet will stop, or the preview is describing a different walk.
    if (stopWhen) s = trimToFirst(s, stopWhen) || s;
    const { points, cost, done, tail } = truncateByBudget(
      s, Math.max(0, moveBudget(session.activeMember) - a.ap), stepCost);
    if (points.length < 2) return null;
    aim.setPreview({ reach: points, tail });
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
  // While a buff is armed, the cursor names WHO it would land on and what they
  // would get - or why they would get nothing. The friendly twin of the to-hit
  // readout: the same "say the outcome before the AP is spent" contract, on a
  // verb whose outcome is not a percentage.
  // While a dash is armed, the cursor prices the RUN: how far of it you would
  // actually cover, and that it costs a flat fee rather than the per-tile
  // charge the trail normally shows.
  // While a zone is armed, the cursor says how much of it would actually land.
  // That number is the whole question for this verb: the tiles it can take are
  // whatever happens to be plain floor, so the same click over open carpet and
  // over a cubicle row costs the same AP for very different results.
  // While a summon is armed, the cursor previews the DROP: how many employees
  // that spot fits, or why it doesn't work. Same rule the click runs.
  // Resolve the hover and return the enemy a click would swing at RIGHT NOW,
  // or null. main.js keys the crosshair cursor off the return value, so the
  // cursor, the to-hit readout and the click all run the same resolution AND
  // the same gate (handleEnemyClick's: your turn, standing still) - the cursor
  // used to read its own ungated body pick, promising a swing mid-walk or on
  // an AI turn that the readout and the click both refused.
  // `onOwnTile`: the ground point rounds to the ACTING body's own tile, which
  // main.js's click resolver treats as the first authority - a self-cast or a
  // shuffle in place, never a swing, whatever tall mesh overlaps the pixel.
  // The hover has to agree, and it has to agree HERE rather than only at the
  // cursor: `hoverFoe` is what draws the target ring and the to-hit readout,
  // so gating it in main.js alone would swap one lie for a quieter one.

  // The faces that would shield a crouch on this tile - the aim's twin of
  // `crouchFacesOf`, which asks the same of a unit already standing somewhere.
  const crouchFacesAt = (tx, tz) => facesAtCrouch(tx, tz, {
    edgeOpen: world.stepOpen,
    tileDefAt: world.tileDefAt,
    bodyAt: unitStandingAt,
    standing,
    exclude: [session.activeMember],
  });

  // The cover aim's eased ring position, and the frame's dt for the easing -
  // immediate-mode lines redraw every frame, so smoothness is state carried
  // between frames, not an animation the engine runs.

  // The wedge, aimed from the acting member's body. The geometry itself lives
  // in powers.js so the out-of-combat preview draws the identical shape; this
  // only binds the origin.
  const coneTest = (a, tx, tz) => coneFrom(a, posOf(session.activeMember), tx, tz);

  // While an attack/shove is armed, rings mark the targets: green = usable on
  // them right now (melee walks you in), red = out of range / no line / short
  // on ammo or AP. Every live enemy is ringed, not just the engaged - a
  // clickable bystander deserves the same feedback. A cone draws its aimed
  // wedge instead, ringing whoever it would catch.
  // The ground wash under an armed aim (TACTICS_PLAN M7). Independent of
  // everything below it - it paints whether or not anything is hovered, and it
  // must also know to VANISH when the turn ends, the verb is disarmed, or the
  // aimer starts walking.
  // The faces shielding whoever you are steering, right now, whatever is armed.
  // A crouch that says only "In Cover" is one you have to guess the shape of,
  // and in a corner the shape is the whole decision. Read through
  // `crouchStateOf`, so the bars are the faces the next shot resolves against
  // and a shield that falls takes its bar with it.
  // A door rings only UNDER THE CURSOR (designer, 2026-07-31): it used to ring
  // whenever the acting member stood beside one, whatever was armed, and a
  // marker that never leaves the threshold reads as state, not affordance. The
  // hover hands in the same predicate the pointer cursor reads, so ring and
  // cursor light together; matching against doorsBeside keeps it on doors the
  // member is actually AT. Green when the AP is there, red when it is not.
  // A zone rings the tiles it would actually cover - the same list the click
  // paints (zoneCells), so a tile that shows a ring is a tile that gets the
  // surface. Red on the aim point alone when the placement itself is refused.
  // Where the arrivals would actually stand: the spots the click will fill,
  // not the tile aimed at. Red on the aim point when the posting is refused.
  // The crouch aim: the eased ring on the spot, and the faces it would earn.
  // A buff rings the FRIENDLY side: green on every ally it could land on
  // right now, red on the ones out of range, out of line, or who would get
  // nothing from it. Same rule the click runs, so a green ring is a promise.
  // Returns true when it has HANDLED the pass. A friend-only verb has: there is
  // no other half to draw. A two-sided one (the purge) has NOT - it keeps going
  // and rings the coworkers too, because ringing only colleagues while the click
  // still resolves on the other side is an affordance describing half a verb.
  //
  // That fall-through is the one thing this extraction could have lost, since
  // the original arm simply ran off its end. Stated as a return value now,
  // rather than as the absence of one.
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
    const next = mulberry32Uint(session.scrambleTurn);
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
    if (!a || !actionIdsOf(session.activeMember).includes(id)) return null;
    const affordable = session.phase === 'player' && session.activeMember.ap >= a.ap
      && (!a.uses || session.activeMember.usesLeft[id] > 0)
      && (!a.ammoCost || session.activeMember.sheet.paper >= ammoCostOf(id))
      && !(a.footwork && statusFx(session.activeMember.sheet).noFootwork); // no kicking with gum on the shoe
    return {
      ap: a.ap,
      uses: a.uses ? session.activeMember.usesLeft[id] : null,
      ammoCost: a.ammoCost ? ammoCostOf(id) : 0,
      ammoRemaining: session.activeMember.sheet.paper,
      resourceAvailable: (!a.uses || session.activeMember.usesLeft[id] > 0)
        && (!a.ammoCost || session.activeMember.sheet.paper >= ammoCostOf(id)),
      affordable,
      // WHY it can't be pressed, in the slot's own tooltip. A dimmed button
      // that doesn't say what it wants teaches nothing, and out of combat the
      // bar already answered this (combatOnlyReason) - a fight should not be
      // the half of the game where the bar goes quiet.
      reason: affordable ? null
        : session.phase !== 'player' ? 'Not your turn.'
          : a.uses && session.activeMember.usesLeft[id] <= 0 ? `${a.label} is spent for this fight.`
            : a.ammoCost && session.activeMember.sheet.paper < ammoCostOf(id)
              ? `Needs ${ammoCostOf(id)} paper - you have ${session.activeMember.sheet.paper}.`
              : a.footwork && statusFx(session.activeMember.sheet).noFootwork
                ? 'Gum on your shoe - no footwork.'
                : `Not enough AP - ${a.label} costs ${a.ap}.`,
      // An armed action stays pressable even when it has gone unaffordable -
      // that press is the only way to lower it again (see pressAction).
      live: id === intent.armed ? 'armed' : id === intent.pendingConfirm ? 'confirm' : null,
      tip: actionTip(id, a),
    };
  }
  // The reorg (`confused`) used to shuffle a list this module built. The order
  // is the player's own layout now, so the status shuffles THAT - same
  // disorientation, same per-turn seed, applied to the bar they arranged.
  function scrambleEntries(entries) {
    const order = scrambleOrder(entries.length);
    return order ? order.map((i) => entries[i]) : entries;
  }
  // The permutation ITSELF, so a caller can map a slot the player is pointing
  // at back to the slot it really is. main.js needs both halves: the bar draws
  // and presses the scrambled order, but rearranging writes to the layout the
  // reorg is scrambling, and reading one through the other put the two verbs
  // on different slots. Null when nothing is scrambled, so the common path
  // stays identity rather than an allocated 0..n-1.
  function scrambleOrder(n) {
    if (!statusFx(session.activeMember.sheet).shuffleActions) return null;
    return scrambled(Array.from({ length: n }, (_, i) => i));
  }

  // Point everything at the member whose initiative turn it now is:
  // party.active moves with it so the portrait bar highlights and the
  // out-of-combat leader bindings follow whoever last held the floor (main.js
  // syncLeaderBindings). Switching exists only WITHIN an open shared turn
  // (INITIATIVE_PLAN): steering moves among the members holding the floor,
  // and everyone else still waits for their own slot to come up.
  function makeActive(m) {
    session.activeMember = m;
    // A summon lives outside party.members, so it can't be party.active - leave
    // that pointing at the real member who last held the floor (the post-combat
    // leader). The initiative tracker shows whose turn it actually is.
    //
    // A CHARMED coworker is the same story and was not covered: it is
    // `isCharmed`, never `isSummon`, and it is appended to `members` after the
    // real roster - so this wrote an index past the end of `party.members`,
    // and everything keyed off `party.members[party.active]` (the portrait
    // highlight, the leader bindings main.js re-reads when the dust settles)
    // was reading undefined until a real member's turn came round. The test is
    // the roster's own range rather than a list of exceptions, so the next
    // kind of borrowed body cannot reintroduce this.
    const at = members.indexOf(m);
    if (at >= 0 && at < party.members.length) party.active = at;
    disarm();
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
    let borrowedFell = false;
    for (const m of [...charmedMembers()]) borrowedFell = releaseDeadCharm(m) || borrowedFell;
    if (borrowedFell && !hostilesRemain()) { victory(); return; }
    for (const m of members) {
      if (m.sheet.hp > 0 || m.toppled) continue;
      m.toppled = true;
      m.actor?.clearPath();
      if (m.actor) m.actor.fx = { kind: 'death', t: 0 };
    }
    if (!livingParty().length) { defeat(); return; } // party wipe - the only loss
    if (session.phase === 'player' && session.activeMember.sheet.hp <= 0) {
      log(`${session.activeMember.sheet.name} goes down!`);
      // Hand the floor to somebody still standing BEFORE advancing. The active
      // member is what the HUD, party card and profile read; `advanceTurn`
      // does not rebind it - so a member who dropped on their own turn stayed
      // "active" through every enemy turn that followed, and the HUD sat on a
      // corpse until the order came back round. The same handoff `releaseCharm`
      // makes when the body it borrowed leaves the roster.
      const standing = livingParty()[0];
      if (standing && standing !== session.activeMember) makeActive(standing);
      advanceTurn();
    } else {
      refresh();
    }
  }

  function log(text) {
    readout.say(text);
    callbacks.say(text, 'combat');
  }
  // Detailed arithmetic belongs in the accumulating dialogue, not in the
  // compact action panel whose one line should remain the outcome. Callers
  // provide values captured at resolution time; the formatter never rerolls
  // or re-derives combat state.
  function formula(text) {
    callbacks.say(text, 'formula');
  }
  function reportDamage(details) {
    formula(formatDamageFormula(details));
  }
  function refresh() {
    syncActionUses(session.activeMember);
    // Anything worth redrawing the HUD for may also have reshaped what the
    // aim can see (a door toggled, smoke landed, a prop toppled) - stale the
    // aim wash's key so its next frame recomputes.
    aim.bumpEpoch();
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
    const freeTag = freeMoveOf(session.activeMember) > 0 ? `  🥾 ${fmtAp(session.activeMember.freeAp || 0)} move` : '';
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
      turnLabel: session.phase === 'player'
        ? (solo ? '' : session.activeMember.sheet.name)
        : session.phase === 'ai' && session.acting ? `${session.acting.unit.def.name}'s turn` : '',
      apText: apPips({
        ap: session.activeMember.ap, maxAp: session.activeMember.sheet.maxAp, text: fmtAp(session.activeMember.ap), freeText: freeTag,
      }),
      endEnabled: session.phase === 'player',
      // Under a shared turn the button names whose turn it ends - each member
      // retires their own (INITIATIVE_PLAN #2), so the label has to say which
      // one a press costs. Alone, it stays the plain verb it always was.
      endLabel: turns.held.length > 1 ? `End Turn — ${session.activeMember.sheet.name}` : 'End Turn',
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
    callbacks.updateHud(session.activeMember.sheet);
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
    for (const e of engaged) {
      e.onTile = null;
      e.onTravel = null;
    }
    // Stand everyone up and drop the chips: the crouch map dies with this
    // closure, and without this the pose and the 'covered' status would
    // outlive the fight that meant them (the status only ticks on the combat
    // turn clock, so out of a fight it would simply never expire).
    for (const u of [...crouched.keys()]) breakCrouch(u, true);
    session.finish();
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

  // One player swing, and what it did to whoever took it (player-strike.js).
  const { performOn, victimView } = createPlayerStrike({
    world,
    fx,
    callbacks,
    get active() { return session.activeMember; },
    rand: (...a) => rand(...a),
    log: (...a) => log(...a),
    refresh: (...a) => refresh(...a),
    disarm: (...a) => disarm(...a),
    victory: (...a) => victory(...a),
    hitFx: (...a) => hitFx(...a),
    deathFx: (...a) => deathFx(...a),
    statusFxAt: (...a) => statusFxAt(...a),
    faceTarget: (...a) => faceTarget(...a),
    rollAgainst: (...a) => rollAgainst(...a),
    resolveProc: (...a) => resolveProc(...a),
    ammoCostOf: (...a) => ammoCostOf(...a),
    ambushDmg: (...a) => ambushDmg(...a),
    joinCombat: (...a) => joinCombat(...a),
    hostilesRemain: (...a) => hostilesRemain(...a),
    notifyMemberDown: (...a) => notifyMemberDown(...a),
    syncUnitSpeed: (...a) => syncUnitSpeed(...a),
    talentFxOf: (...a) => talentFxOf(...a),
    appliesLine: (...a) => appliesLine(...a),
    immunityLine: (...a) => immunityLine(...a),
    reportDamage: (...a) => reportDamage(...a),
  });

  // One landing resolver for every non-walk relocation. A shove, pull and
  // Courier Swap travel differently, but the pair of feet at the destination
  // asks one question: what surface is under this exact rest point? The glide
  // itself intentionally has no distance ticks or intermediate contacts.
  function resolveForcedLanding(target, px, pz, { countForAi = false } = {}) {
    const v = target?.hazardAt ? target : victimView(target);
    return resolveSurfaceLanding(v, px, pz, {
      floorAt: (...a) => world.floorAt(...a),
      stickGum: (...a) => world.stickGum(...a),
      applyStatus: (...a) => applyStatus(...a),
      statusFxAt: (...a) => statusFxAt(...a),
      syncUnitSpeed: (...a) => syncUnitSpeed(...a),
      onDamage: (damage) => { if (countForAi) bout.dmgDealt += damage; },
      impact: (x, z) => fx.impact(x, z, hazardKind(x, z), { y: 0.4 }),
      damageText: (x, z, damage, color, died) =>
        fx.damageText(x, z, `-${damage}`, color, { big: died }),
    });
  }
  // Put a body somewhere else, and resolve what it hits. ONE resolver for both
  // sides (Q4-A): `aiShoveMember` used to be a hand-written parallel of this,
  // its comment claiming parity, and it had already lost two of the three slam
  // consequences - the `stunned` status and the topple of a prop the victim is
  // slammed into. A coworker shoved into a filing cabinet wore both; a member
  // shoved into the same cabinet wore neither.
  //
  // `by` is whoever is doing it - the acting member by default, an AI unit when
  // the enemy side shoves - and it decides the narration's subject and who the
  // impact FX are attributed to. Everything else is the same rule.
  function displaceBody(target, dx, dz, { verb = 'shove', slamDmg = 2, by = session.activeMember } = {}) {
    const v = victimView(target);
    const mine = by === session.activeMember;                 // the player's own shove?
    const Who = mine ? 'You' : by.def.name;
    const says = (s) => (mine ? `You ${s}` : `${Who} ${s.replace(/^(\w+)/, (w) => `${w}s`)}`);
    const push = displacePlan(v.x, v.z, dx, dz, {
      isWalkable: world.isWalkable,
      stepOpen: world.stepOpen,
      occupied: (x, z) => !!unitStandingAt(x, z) && unitStandingAt(x, z) !== target,
    });
    if (!push) return { slammed: false, died: false, msg: '' };
    const { tx, tz } = push;
    const bill = (d, x, z, big) => {
      if (!mine) bout.dmgDealt += d;            // the AI tally counts its own damage
      fx.damageText(x, z, `-${d}`, v.dmgColor, { big });
    };
    if (push.blocked) {
      // The "something solid" they hit might be a bookcase (POWERS_PLAN M6).
      // Slamming somebody into a toppleable prop brings it down on them - the
      // shove already said "into something solid", and this is the rest of
      // that sentence. The topple's own damage and stun land on whoever is in
      // the LANDING tile, which the slammed body may or may not be.
      // The body knocking the prop over is the one being SLAMMED into it, not
      // the one doing the shoving - `topplePlan` reads the pusher's position to
      // decide which way the furniture goes.
      const plan = topplePlan(v.ref, tx, tz);
      if (plan) {
        const died0 = slamDmg > 0 ? v.hurt(slamDmg) : false;
        hitFx(v.ref, 'slam', by);
        if (slamDmg > 0) bill(slamDmg, v.x, v.z, died0);
        const msg = `${says(`${verb} ${v.name}`)} into the ${plan.def.label || 'furniture'}. `
          + `${slamDmg > 0 ? `-${slamDmg}. ` : ''}${topple(by, plan)}`;
        if (died0) v.onDeath();
        return { slammed: true, died: died0, msg };
      }
      const died = slamDmg > 0 ? v.hurt(slamDmg) : false;
      hitFx(v.ref, 'slam', by);
      fx.shake(0.06, 0.2); // a body meeting drywall
      if (slamDmg > 0) bill(slamDmg, v.x, v.z, died);
      let msg = `${says(`${verb} ${v.name}`)} into something solid.${slamDmg > 0 ? ` -${slamDmg}.` : ''}`;
      // A slam into a wall knocks the wind out of them - stunned (they lose
      // their next turn). The knockdown DOS2 shoves are for.
      //
      // The shove is the one UNRATIONED stun in the game (2 AP, no use limit),
      // so it is the chain the anti-chain window exists to break - and the site
      // where the victim most needs to be told why the second slam didn't daze.
      if (!died) {
        const blocked = blockedBy(v.statusTarget, 'stunned');
        if (applyStatus(v.statusTarget, 'stunned', {}, v.resist)) {
          statusFxAt(v.member ? v.body : v.ref, 'stunned');
          msg += ` They crumple - ${STATUSES.stunned.name}, they lose their next turn.`;
        } else if (blocked) msg += ` ${immunityLine(blocked, v.name)}`;
      }
      if (died) v.onDeath();
      return { slammed: true, died, msg };
    }
    // Land carried PAST the centre along the push - momentum, not a snap to
    // grid. Deterministic (no rng draw: the rest point feeds cover octants
    // and body-to-body sight, so it must replay under a seed), and clamped
    // so the body still rounds home to the tile the plan chose.
    const pd = Math.hypot(dx, dz) || 1;
    const [lpx, lpz] = world.clampPoint(tx + (dx / pd) * 0.22, tz + (dz / pd) * 0.22);
    v.body.pushTo(tx, tz, lpx, lpz);
    const landing = resolveForcedLanding(v, lpx, lpz, { countForAi: !mine });
    if (landing.damage > 0) {
      return {
        slammed: false,
        died: landing.died,
        msg: `${says(`${verb} ${v.name}`)} into the ${landing.label}! -${landing.damage}.`,
      };
    }
    return { slammed: false, died: false, msg: `${says(`${verb} ${v.name}`)} back a step.` };
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
  // The cover-denial plans (cover-denial-plans.js): each shared pure rule with
  // combat's own side tests threaded in. Adapters only - they write nothing.
  const {
    topplePlan, memberAt, aiTopplePlan, aiEdgeToppleFor, aiShovePlanFor,
    aiPullPlanFor, aiBreakPlanFor,
  } = createCoverDenialPlans({
    world,
    members,
    livingMembers: (...a) => livingMembers(...a),
    toppleplanAt,
    aiToppleplanFor,
    aiEdgeTopplePlanShared,
    aiShovePlanShared,
    aiPullPlanShared,
    aiBreakPlanShared,
    bodyOf: (...a) => bodyOf(...a),
    standing: (...a) => standing(...a),
    unitStandingAt: (...a) => unitStandingAt(...a),
    crouchStateOf: (...a) => crouchStateOf(...a),
    crouchFacesOf: (...a) => crouchFacesOf(...a),
    nameOf: (...a) => nameOf(...a),
    canReach: (...a) => canReach(...a),
    // Declared below this call; these arrows only run at decide time.
    rangedLines: (...a) => rangedLines(...a),
  });
  // Putting the office over (demolition.js): toppling, dropping, breaking - the
  // two ways the office stops being cover, plus the stun a landing inflicts.
  const {
    breakDown, topple, landStun, dropOnto, performPartitionTopple, breakPlanAt,
    performBreak,
  } = createDemolition({
    world,
    fx,
    members,
    callbacks,
    rng,
    hits,
    get active() { return session.activeMember; },
    rand: (...a) => rand(...a),
    log: (...a) => log(...a),
    refresh: (...a) => refresh(...a),
    disarm: (...a) => disarm(...a),
    victory: (...a) => victory(...a),
    hitFx: (...a) => hitFx(...a),
    deathFx: (...a) => deathFx(...a),
    statusFxAt: (...a) => statusFxAt(...a),
    faceTarget: (...a) => faceTarget(...a),
    ammoCostOf: (...a) => ammoCostOf(...a),
    hostilesRemain: (...a) => hostilesRemain(...a),
    notifyMemberDown: (...a) => notifyMemberDown(...a),
    immunityLine: (...a) => immunityLine(...a),
    reportDamage: (...a) => reportDamage(...a),
  });
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
    enterCrouch({
      body: b,
      carrier: carrierOf(unit),
      faces,
      setState: (state) => crouched.set(unit, state),
      applyStatus,
    });
    statusFxAt(unit, 'covered');
    const fx_ = faces.reduce((acc, [ox, oz]) => [acc[0] + ox, acc[1] + oz], [0, 0]);
    if (fx_[0] || fx_[1]) (unit.actor || unit).faceToward?.(b.x + fx_[0], b.z + fx_[1]);
    log(`${nameOf(unit)} tucks in behind ${coverNames(b.x, b.z, faces)}.`);
    return true;
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
  // The fight half of crouch-rules.crouchProblem - same ladder, same words as the
  // out-of-combat crouch, which is what stops a spot from refusing on the map
  // and accepting the moment initiative rolls.
  function coverSpotProblem(tx, tz) {
    const occupant = unitStandingAt(tx, tz);
    return crouchProblem({
      here: session.activeMember.actor.x === tx && session.activeMember.actor.z === tz,
      roomFree: world.isWalkable(tx, tz) && !(occupant && occupant !== session.activeMember),
      faces: facesAtCrouch(tx, tz, {
        edgeOpen: world.stepOpen,
        tileDefAt: world.tileDefAt,
        bodyAt: unitStandingAt,
        standing,
        exclude: [session.activeMember],
      }).length,
    });
  }

  // The spot a click MEANT, when the click landed on a body.
  //
  // "Any character as cover" is the verb's own rule, and its tooltip says so
  // out loud - "aim at furniture, a tile against a partition, or a TEAMMATE".
  // But a body's own tile is occupied, so passing it straight to the spot test
  // refused every such click with "No room to tuck in there": the tooltip, the
  // arm message and the click branch's own comment all promised something the
  // verb always said no to.
  //
  // Aiming at a body means "get behind THEM", so the spot is the tile beside
  // them that is nearest you and legal to crouch on - which is also what "you
  // walk over and tuck in" describes.
  function coverSpotFor(tx, tz) {
    if (!coverSpotProblem(tx, tz)) return [tx, tz];
    const occupant = unitStandingAt(tx, tz);
    if (!occupant || occupant === session.activeMember) return null;
    const me = posOf(session.activeMember);
    let best = null;
    let bestD = Infinity;
    for (const [dx, dz] of NEIGHBOR_DIRS) {
      const sx = tx + dx;
      const sz = tz + dz;
      if (coverSpotProblem(sx, sz)) continue;
      const gap = Math.hypot(sx - me.x, sz - me.z);
      if (gap < bestD) { bestD = gap; best = [sx, sz]; }
    }
    return best;
  }

  function performTakeCover(rawX, rawZ, rawPoint = null) {
    const a = ACTIONS['take-cover'];
    const spot = coverSpotFor(rawX, rawZ);
    if (!spot) { log(coverSpotProblem(rawX, rawZ)); return; }
    const [tx, tz] = spot;
    // The clicked POINT belongs to the tile that was clicked. If the spot moved
    // (the click was on a body and we tucked in beside them), that point is
    // inside somebody else's tile - so the walk takes the spot's centre instead
    // of finishing on top of the shield.
    const point = (tx === rawX && tz === rawZ) ? rawPoint : null;
    const problem = coverSpotProblem(tx, tz);
    if (problem) { log(problem); return; }
    if (session.activeMember.ap < a.ap) { log('Not enough AP.'); return; }
    disarm();
    if (session.activeMember.actor.x === tx && session.activeMember.actor.z === tz) {
      // Your own tile. A click on a meaningfully different POINT within it is
      // a sub-tile shuffle - fine-tune the tuck, billed as the sliver of
      // movement it is - because the marker promised the point, not the tile.
      // Same logical tile, so nothing provokes and the arrival check holds.
      const pos = posOf(session.activeMember);
      const end = point ? world.clampPoint(point.x, point.z) : null;
      if (end && Math.hypot(end[0] - pos.x, end[1] - pos.z) > 0.1) {
        const walk = walkActive([[pos.x, pos.z], [tx, tz]],
          moveBudget(session.activeMember) - a.ap, end);
        if (walk?.done) { pendingCrouch = { spot: [tx, tz] }; return; }
      }
      session.activeMember.ap = roundAp(session.activeMember.ap - a.ap);
      crouchHere(session.activeMember);
      refresh();
      return;
    }
    const path = world.findPath(session.activeMember.actor.x, session.activeMember.actor.z, tx, tz, session.activeMember.actor);
    if (!path || path.length < 2) { log('No clear way in behind it.'); return; }
    // Reserve the crouch's own AP out of the walk budget, exactly as a
    // walk-up shot reserves its trigger pull. Same honest split as the
    // walk-ups: a degenerate route is not an AP problem.
    const crouchBudget = moveBudget(session.activeMember) - a.ap;
    // The walk ends at the POINT you clicked, clamped to body clearance -
    // not the tile's dead centre. Bodies in this engine rest at free points
    // (movement, walk-ups and dashes all do), and the crouch was the one
    // deliberate destination that still teleport-parked you on the centre.
    // "Continuous and smooth" (designer, 2026-07-31) means the spot you
    // chose is the spot you occupy; the RULE still reads the tile's faces.
    const walk = walkActive(path, crouchBudget,
      point ? world.clampPoint(point.x, point.z) : null);
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
    if (crouched.has(unit) || session.acting.ap < coverAp || !target) return false;
    if (canReach(unit, target)) return false; // melee ignores cover - swing instead
    const b = bodyOf(unit);
    const t = bodyOf(target);
    if (!aiCrouchCovered(b.x, b.z, t.x, t.z, {
      tileDefAt: world.tileDefAt,
      stepOpen: world.stepOpen,
      bodyAt: (x, z) => { const u = unitStandingAt(x, z); return !!u && u !== unit && standing(u); },
    })) return false;
    if (!crouchHere(unit)) return false;
    session.acting.ap = roundAp(session.acting.ap - coverAp);
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
    return s && { ...s, faces: crouchFacesOf(en, session.activeMember) };
  };
  const pullPlanned = (en) => pullplanFor(session.activeMember, en, pullCrouchOf(en), {
    stepOpen: world.stepOpen,
    open: (x, z) => world.isWalkable(x, z) && !unitStandingAt(x, z),
    bodyAt: (x, z) => {
      const u = unitStandingAt(x, z);
      return !!u && u !== en && u !== session.activeMember && standing(u);
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
    session.activeMember.actor.lunge(posOf(en).x, posOf(en).z);
    faceTarget(session.activeMember, en.x, en.z);
    // The crouch dies in your fist, quietly - the haul is the story. pushTo
    // is forced movement: no provoke, no per-tile hooks, the shove's seam.
    // The hauled body rests pulled toward YOU, not on the tile's dead centre
    // - deterministic, and inside the landing tile.
    breakCrouch(en, true);
    const pp = posOf(session.activeMember);
    const hd = Math.hypot(pp.x - lx, pp.z - lz) || 1;
    const [hpx, hpz] = world.clampPoint(
      lx + ((pp.x - lx) / hd) * 0.25,
      lz + ((pp.z - lz) / hd) * 0.25);
    en.pushTo(lx, lz, hpx, hpz);
    let msg = `You haul ${en.def.name} over the ${what}.`;
    // The same save everything manhandled rolls (stats.gritSaveChance), with
    // the same forceHit pin for the specs: true = the haul fully lands.
    const saved = hits.forceHit !== null ? !hits.forceHit : rollHit(gritSaveChance(en.combat.grit), rng);
    if (saved) {
      en.flinch?.();
      msg += ' They twist and land on their feet.';
    } else {
      const dmg = rand(a.crush[0], a.crush[1]);
      const died = en.takeDamage(dmg);
      hitFx(en, 'slam', session.activeMember);
      if (died) deathFx(en);
      fx.damageText(lx, lz, `-${dmg}`, '#ffd76b', { big: died });
      msg += ` They come down hard. -${dmg}.`;
      if (!died) {
        // Through landStun, the one crash-landing stun for either shape of
        // victim - resist and immunity narration included. This site predated
        // it and kept a hand-rolled copy that skipped the coworker's resist.
        // The line names the status the HUD chip names, and says what it
        // costs them: the status is a SKIPPED TURN (designer, 2026-07-31:
        // "what does it do?"), and a lost turn is worth reading as one.
        msg += landStun(en, ` ${STATUSES.stunned.name} - they lose their next turn.`);
        if (applyStatus(en, 'pinned')) statusFxAt(en, 'pinned');
      } else {
        callbacks.onEnemyKilled(en);
      }
    }
    // Landing them in a hazard is the puller's gift to give, whether they
    // saved against the hard fall or not. The shared resolver samples the
    // exact pulled rest point and applies entry once.
    if (en.alive) {
      const landing = resolveForcedLanding(en, hpx, hpz);
      if (landing.damage > 0) msg += ` The landing is ${landing.label}. -${landing.damage}.`;
    }
    log(msg);
    disarm();
    refresh();
    if (!hostilesRemain()) victory();
  }

  // --- the AI's cover-denial performs (AI_PLAN M4) --------------------------
  // Each mirrors the player's own perform with the roles reversed, reusing
  // the shared resolution pieces (pushTo, the Grit save shape, dropOnto's
  // prices) rather than inventing parallel rules - the unitStrikesMember
  // lesson applied forward. Members land through notifyMemberDown, the same
  // downed path everything else uses.

  // The pull, from the other side of the desk: performPull with the puller
  // an AI unit and the hauled body a member.
  function aiPullMember(unit, plan) {
    const m = plan.victim;
    const [lx, lz] = plan.landing;
    unit.lunge(posOf(m).x, posOf(m).z);
    faceTarget(unit, m.actor.x, m.actor.z);
    breakCrouch(m, true);
    const pp = posOf(unit);
    const hd = Math.hypot(pp.x - lx, pp.z - lz) || 1;
    const [hpx, hpz] = world.clampPoint(
      lx + ((pp.x - lx) / hd) * 0.25,
      lz + ((pp.z - lz) / hd) * 0.25);
    m.actor.pushTo(lx, lz, hpx, hpz);
    let msg = `${unit.def.name} hauls ${m.sheet.name} bodily over their own cover.`;
    const saved = hits.forceHit !== null ? !hits.forceHit
      : rollHit(gritSaveChance(effectiveAttr(m.sheet).grit), rng);
    if (saved) {
      m.actor.flinch();
      msg += ' They twist and land on their feet.';
    } else {
      const a = ACTIONS.pull;
      const dmg = rand(a.crush[0], a.crush[1]);
      bout.dmgDealt += dmg;
      const dead = applyDamage(m.sheet, dmg);
      hitFx(m, 'slam', unit);
      m.actor.flinch();
      fx.damageText(lx, lz, `-${dmg}`, undefined, { big: dead });
      msg += ` They come down hard. -${dmg}.`;
      if (dead) {
        log(msg);
        notifyMemberDown();
        refresh();
        return;
      }
      msg += landStun(m, ' They come down dazed.');
      if (applyStatus(m.sheet, 'pinned')) statusFxAt(m, 'pinned');
    }
    // Surface entry is independent of the Grit save. Previously this sat
    // inside the failed-save arm, so the better the landing, the less real the
    // fire underneath it became.
    if (m.sheet.hp > 0) {
      const landing = resolveForcedLanding(m, hpx, hpz, { countForAi: true });
      if (landing.damage > 0) msg += ` The landing is ${landing.label}. -${landing.damage}.`;
      if (landing.died) { log(msg); refresh(); return; }
    }
    log(msg);
    refresh();
  }

  // The shove, member-shaped: a slam into something solid, or a walk-back
  // into a hazard - the only two shapes the plan admits for a melee unit
  // (a shove that merely moves somebody was refused at the plan). Slam
  // damage matches displaceBody's own flat price; the hazard landing bills
  // the surface's number. Known v1 approximation, recorded in AI_PLAN:
  // the surface damage is the shared hazard value, so a member's personal
  // hazard immunities (talent-shaped, main.js's walking model) are not
  // consulted on a FORCED landing.

  // A sealed unit battering its way through (AI_PLAN A10): performBreak's
  // core with the unit's own attack line as the dice and attackAp as the
  // price - the same pools, the same world-facade removal, the same lazy
  // crouch revalidation. No walk-in, no rings: the plan already said the
  // barrier is adjacent.
  function aiBreak(unit, plan) {
    const line = unit.combat.attacks[rand(0, unit.combat.attacks.length - 1)];
    const prop = plan.kind === 'prop';
    const aimX = prop ? plan.tx : (plan.a[0] + plan.b[0]) / 2;
    const aimZ = prop ? plan.tz : (plan.a[1] + plan.b[1]) / 2;
    unit.lunge(aimX, aimZ);
    faceTarget(unit, aimX, aimZ);
    const rolled = rand(line.min, line.max);
    const dmg = rolled;
    // The break is demolition.breakDown - the same one the player's verb runs.
    // What is left here is what an AI break actually differs by: a random
    // attack line off its own kit, and third-person narration.
    const { label, left, gone } = breakDown(plan, dmg);
    reportDamage({
      attacker: unit.def.name,
      target: label,
      action: line.label || 'Break cover',
      roll: rolled,
      min: line.min,
      max: line.max,
      result: dmg,
    });
    if (gone) {
      log(prop
        ? `${unit.def.name} takes the ${label} apart. One less thing between you.`
        : `${unit.def.name} batters the partition down. Open plan, the hard way.`);
    } else {
      log(`${unit.def.name} lays into the ${label}.${left <= dmg ? ' It is coming apart.' : ''}`);
    }
    refresh(); // any crouch behind it revalidates here
  }

  // --- the mobility verb (POWERS_PLAN M4) ----------------------------------
  // The rest of the verbs (verbs.js): the halves that SPEND. Reached from a
  // click or an AI beat, never from the startCombat sweep.
  const {
    performDash, performSwap, zoneCells, performZone, performControl, strike,
    friendlies, allyAtPoint, allyProblemFor, buffReach, performBuff,
    handleAllyClick, fireCone, coneCells,
  } = createVerbs({
    world,
    fx,
    members,
    callbacks,
    get active() { return session.activeMember; },
    get armed() { return intent.armed; },
    get phase() { return session.phase; },
    rand: (...a) => rand(...a),
    log: (...a) => log(...a),
    refresh: (...a) => refresh(...a),
    disarm: (...a) => disarm(...a),
    victory: (...a) => victory(...a),
    hidePreview: (...a) => hidePreview(...a),
    canReach: (...a) => canReach(...a),
    bodyDist: (...a) => bodyDist(...a),
    bodyLos: (...a) => bodyLos(...a),
    distToTile: (...a) => distToTile(...a),
    losToTile: (...a) => losToTile(...a),
    rollAgainst: (...a) => rollAgainst(...a),
    hitFx: (...a) => hitFx(...a),
    deathFx: (...a) => deathFx(...a),
    statusFxAt: (...a) => statusFxAt(...a),
    breakCrouch: (...a) => breakCrouch(...a),
    faceTarget: (...a) => faceTarget(...a),
    displaceBody: (...a) => displaceBody(...a),
    resolveForcedLanding: (...a) => resolveForcedLanding(...a),
    performOn: (...a) => performOn(...a),
    joinCombat: (...a) => joinCombat(...a),
    charmUnit: (...a) => charmUnit(...a),
    livingMembers: (...a) => livingMembers(...a),
    hostilesRemain: (...a) => hostilesRemain(...a),
    coneTest: (...a) => coneTest(...a),
    ambushDmg: (...a) => ambushDmg(...a),
    immunityLine: (...a) => immunityLine(...a),
    reportDamage: (...a) => reportDamage(...a),
    // A module-level const in this file; imported back would be circular.
    appliesLine: (...a) => appliesLine(...a),
    setLastClickOutcome: (v) => { lastClickOutcome = v; },
  });
  const defaultAttack = () => equippedAction(session.activeMember.sheet);
  // What a click on a coworker would use RIGHT NOW: whatever you armed, else
  // that basic swing. Every preview reads this - the target rings, the to-hit
  // tag, and (through main.js) the cursor - so the affordances always describe
  // the swing that would actually land rather than only the armed case.
  const previewAction = () => (session.phase === 'player' && session.activeMember?.sheet ? (intent.armed || defaultAttack()) : null);

  // What a click in a fight means (click-verbs.js): the verb arms, the
  // enemy-click dispatcher, the routes a click may walk first, and the
  // tile-click resolver.
  const {
    finishVerb, closedTheDistance, clickShove, clickPull, clickRanged,
    clickMelee, handleEnemyClick, verbReaches, swingPointAt, hasSwingSpot,
    routeBeside, routeIntoRange, walkActive, handleTileClick,
  } = createClickVerbs({
    world,
    fx,
    members,
    callbacks,
    get active() { return session.activeMember; },
    get armed() { return intent.armed; },
    get phase() { return session.phase; },
    get pendingConfirm() { return intent.pendingConfirm; },
    get pendingMelee() { return pendingMelee; },
    get pendingCrouch() { return pendingCrouch; },
    get lastClickOutcome() { return lastClickOutcome; },
    log: (...a) => log(...a),
    refresh: (...a) => refresh(...a),
    disarm: (...a) => disarm(...a),
    cancelArmed: (...a) => cancelArmed(...a),
    victory: (...a) => victory(...a),
    hidePreview: (...a) => hidePreview(...a),
    defaultAttack: (...a) => defaultAttack(...a),
    canReach: (...a) => canReach(...a),
    bodyDist: (...a) => bodyDist(...a),
    bodyLos: (...a) => bodyLos(...a),
    stepCost: (...a) => stepCost(...a),
    moveBudget: (...a) => moveBudget(...a),
    billMove: (...a) => billMove(...a),
    beginMove: (...a) => beginMove(...a),
    ammoCostOf: (...a) => ammoCostOf(...a),
    faceTarget: (...a) => faceTarget(...a),
    breakCrouch: (...a) => breakCrouch(...a),
    crouchStateOf: (...a) => crouchStateOf(...a),
    unitStandingAt: (...a) => unitStandingAt(...a),
    shotOutcome: (...a) => shotOutcome(...a),
    hostilesRemain: (...a) => hostilesRemain(...a),
    joinCombat: (...a) => joinCombat(...a),
    enemyAtPoint: (...a) => enemyAtPoint(...a),
    previewWalk: (...a) => previewWalk(...a),
    allyAtPoint: (...a) => allyAtPoint(...a),
    friendlies: (...a) => friendlies(...a),
    strike: (...a) => strike(...a),
    displaceBody: (...a) => displaceBody(...a),
    topple: (...a) => topple(...a),
    topplePlan: (...a) => topplePlan(...a),
    breakPlanAt: (...a) => breakPlanAt(...a),
    performBreak: (...a) => performBreak(...a),
    performPartitionTopple: (...a) => performPartitionTopple(...a),
    performPull: (...a) => performPull(...a),
    pullPlanFor: (...a) => pullPlanFor(...a),
    pullRefusal: (...a) => pullRefusal(...a),
    performTakeCover: (...a) => performTakeCover(...a),
    performDash: (...a) => performDash(...a),
    performSwap: (...a) => performSwap(...a),
    performZone: (...a) => performZone(...a),
    performControl: (...a) => performControl(...a),
    performBuff: (...a) => performBuff(...a),
    placeSummon: (...a) => placeSummon(...a),
    fireCone: (...a) => fireCone(...a),
    crouchLabel: (...a) => crouchLabel(...a),
    nameOf: (...a) => nameOf(...a),
    setArmed: (v) => intent.arm(v),
    setPendingConfirm: (v) => intent.confirm(v),
    setPendingMelee: (v) => { pendingMelee = v; },
    setPendingCrouch: (v) => { pendingCrouch = v; },
    setLastClickOutcome: (v) => { lastClickOutcome = v; },
  });
  // Pressing a slot (action-bar.js): the tooltip, the press, and the instants
  // that need a second click.
  const {
    actionTip, pressAction, commitInstant, summonSpotProblem, placeSummon,
  } = createActionBar({
    world,
    fx,
    watching,
    INSTANT_CONFIRM,
    get active() { return session.activeMember; },
    get armed() { return intent.armed; },
    get phase() { return session.phase; },
    get pendingConfirm() { return intent.pendingConfirm; },
    log: (...a) => log(...a),
    refresh: (...a) => refresh(...a),
    disarm: (...a) => disarm(...a),
    cancelArmed: (...a) => cancelArmed(...a),
    hidePreview: (...a) => hidePreview(...a),
    hitFx: (...a) => hitFx(...a),
    statusFxAt: (...a) => statusFxAt(...a),
    faceTarget: (...a) => faceTarget(...a),
    distToTile: (...a) => distToTile(...a),
    losToTile: (...a) => losToTile(...a),
    actionState: (...a) => actionState(...a),
    ammoCostOf: (...a) => ammoCostOf(...a),
    summonRoomFor: (...a) => summonRoomFor(...a),
    resolveSummon: (...a) => resolveSummon(...a),
    setArmed: (v) => intent.arm(v),
    setPendingConfirm: (v) => intent.confirm(v),
  });
  // Whose turn it is, and what opening one costs (turn-flow.js). Reached from a
  // turn, never from the startCombat sweep, so it is wired in place.
  const {
    endTurnPressed, takeTurn, steerTo, skipTurnFor, expireSummon, skipTurnLine,
    applyTurnDot,
  } = createTurnFlow({
    world,
    fx,
    members,
    callbacks,
    applyDamage,
    get phase() { return session.phase; },
    get active() { return session.activeMember; },
    get acting() { return session.acting; },
    setPhase: (v) => { session.phase = v; },
    setActing: (v) => { session.acting = v; },
    freeMoveOf: (...a) => freeMoveOf(...a),
    releaseCharm: (...a) => releaseCharm(...a),
    releaseDeadCharm: (...a) => releaseDeadCharm(...a),
    advanceTurn: (...a) => advanceTurn(...a),
    beginTurn: (...a) => beginTurn(...a),
    livingParty: (...a) => livingParty(...a),
    makeActive: (...a) => makeActive(...a),
    refresh: (...a) => refresh(...a),
    log: (...a) => log(...a),
    hitFx: (...a) => hitFx(...a),
    statusesOf: (...a) => statusesOf(...a),
    carrierOf: (...a) => carrierOf(...a),
    nameOf: (...a) => nameOf(...a),
    dismissSummon: (...a) => dismissSummon(...a),
    slotCarrier: (...a) => slotCarrier(...a),
    slotActor: (...a) => slotActor(...a),
    slotName: (...a) => slotName(...a),
    slotAlive: (...a) => slotAlive(...a),
    disarm: (...a) => disarm(...a),
    cancelArmed: (...a) => cancelArmed(...a),
    syncUnitSpeed: (...a) => syncUnitSpeed(...a),
    breakCrouch: (...a) => breakCrouch(...a),
  });

  // --- summons ----------------------------------------------------------------
  // Live minions a summoner still has on the board - the cap counts these.
  // Enemy-team summons are AI actors in the shared enemy list; player-team
  // summons are temporary MEMBERS (below), tagged with who conjured them.
  // The temp desk in a fight (summon-desk.js): the per-summoner cap, posting a
  // req, and taking a temp off the board without killing it.
  const { roomFor: summonRoomFor, dismissSummon, postableNow, resolveSummon } = createSummonDesk({
    world,
    members,
    engaged,
    fx,
    dropCount,
    capRoom,
    countLiveSummons,
    get active() { return session.activeMember; },
    makeActive: (...a) => makeActive(...a),
    livingParty: (...a) => livingParty(...a),
    insertSlot: (...a) => insertSlot(...a),
    memberSlot: (...a) => memberSlot(...a),
    unitSlot: (...a) => unitSlot(...a),
    asMember: (...a) => asMember(...a),
    syncUnitSpeed: (...a) => syncUnitSpeed(...a),
    statusesOf: (...a) => statusesOf(...a),
    applyStatus,
    log: (...a) => log(...a),
  });

  // One AI unit's swing at its target. AI only ever drives ENEMIES (player-side
  // summons are player-controlled members - resolveSummon), and pickTarget only
  // ever returns a party-side member, so the hit always lands on a member's
  // sheet (deflect, gum, and the downed/handoff/party-wipe rules).
  // What the AI does with a beat (ai-verbs.js). Wired here rather than at the
  // top because everything it supplies is reached only from an AI turn - long
  // after the startCombat sweep that made the hit-resolution factory's position
  // load-bearing.
  const {
    meleeLines, rangedLines, swingPool, pickLine, aiAttack, aiSupport, aiShoot,
    aiSummon, aiTopple, aiShove, aiOpenOrBreak,
  } = createAiVerbs({
    world,
    fx,
    rng,
    lineWeights,
    hasStatus,
    get active() { return session.activeMember; },
    engageMemo,
    rand: (...a) => rand(...a),
    bodyOf: (...a) => bodyOf(...a),
    aiBreak: (...a) => aiBreak(...a),
    dropOnto: (...a) => dropOnto(...a),
    posOf: (...a) => posOf(...a),
    log: (...a) => log(...a),
    refresh: (...a) => refresh(...a),
    faceTarget: (...a) => faceTarget(...a),
    statusesOf: (...a) => statusesOf(...a),
    unitStrikesMember: (...a) => unitStrikesMember(...a),
    performOn: (...a) => performOn(...a),
    topple: (...a) => topple(...a),
    displaceBody: (...a) => displaceBody(...a),
    resolveSummon: (...a) => resolveSummon(...a),
    memberAt: (...a) => memberAt(...a),
    nameOf: (...a) => nameOf(...a),
    billMove: (...a) => billMove(...a),
    breakCrouch: (...a) => breakCrouch(...a),
    carrierOf: (...a) => carrierOf(...a),
    applyStatus,
    removeStatus,
  });

  // One AI unit's swing at a member: the roll, the Composure soak, the Deflect
  // stance, any applied status, and the downed/handoff/party-wipe rules. Split
  // out of aiAttack so an opportunity attack lands by exactly the same rules
  // as a turn attack rather than reimplementing them (TACTICS_PLAN M2).
  function unitStrikesMember(unit, m, atk) {
    // The same Savvy-derived bonus a member's swing adds (stats.damageBonus) -
    // a unit's attack lines are its weapon, the bonus is its hands.
    const rolled = rand(atk.min, atk.max);
    const bonus = unit.combat.dmgBonus || 0;
    let dmg = rolled + bonus;
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
    const beforeSoak = dmg;
    const soak = deflect(m.sheet);
    dmg = soakHit(dmg, soak);
    const beforeStance = dmg;
    const inMult = statusFx(m.sheet).incomingMult ?? 1;
    if (inMult < 1) {
      dmg = Math.max(1, Math.ceil(dmg * inMult));
      line += ` You deflect - only ${dmg} damage.`;
    } else {
      line += ` ${dmg} damage.`;
    }
    reportDamage({
      attacker: unit.def.name,
      target: m.sheet.name,
      action: atk.label || 'attack',
      roll: rolled,
      min: atk.min,
      max: atk.max,
      additions: [{ label: 'damage bonus', value: bonus }],
      stages: [
        { label: `Composure soak ${soak}`, before: beforeSoak, after: beforeStance },
        { label: `Deflect stance ×${inMult}`, before: beforeStance, after: dmg },
      ],
      result: dmg,
    });
    m.actor.flinch();
    bout.dmgDealt += dmg;
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
      if (releaseDeadCharm(m)) {
        if (!hostilesRemain()) victory();
        return;
      }
      m.toppled = true;
      deathFx(m);
      m.actor.clearPath();
      m.actor.fx = { kind: 'death', t: 0 };
      if (!livingParty().length) { defeat(); return; } // party wipe - the only true loss
      log(m.isSummon
        ? `${m.sheet.name} is dismissed - back to the employee pool.`
        : `${m.sheet.name} is out cold. They'll sit the rest of this one out.`);
      // Keep the active member (the sheet the HUD reflects and post-combat leader)
      // on a real member still standing - never a summon, which despawns.
      // This can fire mid-PLAYER-turn (an opportunity attack cut the acting
      // member down as they walked), so hand off properly: makeActive rebuilds
      // the survivor's action bar and clears the dead member's armed/pending
      // state. If it WAS their turn, end it too - otherwise the survivor
      // inherits the corpse's initiative slot and its leftover AP, then gets a
      // second full turn when their own slot comes up. During an AI turn the
      // acting enemy is mid-swing, so only the binding moves.
      if (m === session.activeMember) {
        makeActive(livingParty()[0]);
        if (session.phase === 'player') advanceTurn();
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
  // Everyone on the far side of `mover` able to punish it right now. Exit
  // Interview owns the ability to project this reaction threat; simply
  // carrying a melee swing is no longer enough. Each owner carries its OWN
  // reach, so a long weapon zones further than a pair of fists.
  // Who threatens this mover - the OTHER side, live. `engaged` is not that
  // list: a charmed coworker stays in it on purpose (charming the last hostile
  // must not win the fight) while fighting for the player, so reading it raw
  // handed your own borrowed Guard a free swing at the member walking past him
  // (REVIEW.md 2026-08-02 section 1.4). Commit b224733 made this substitution
  // at the two sites inside `aiAdvance`/`aiSupportPlan` and missed this one.
  // Side is live state, never registry (AI_PLAN footgun 5).
  const threatsAgainst = (mover) => (mover.sheet ? aiAllies() : members)
    .filter((u) => canReact(u) && talentFxOf(u).opportunityAttack)
    .map((u) => {
      const p = posOf(u);
      return { x: p.x, z: p.z, reach: reachOfUnit(u), ref: u };
    });

  // `ref` entered (x, z) under its own power. Anyone whose reach it just left
  // gets one free swing. The walk is NOT interrupted - its AP was charged up
  // front (TACTICS_PLAN #8) - so the mover takes the hit and keeps going,
  // unless it goes down.
  function notifyStep(ref, x, z) {
    if (session.phase === 'done') return;
    const mover = combatantFor(ref);
    if (!mover) return;
    // Frequent Flier (MOVEMENT_PLAN M3): this character never provokes, from
    // anyone, ever. Deliberately the ONLY exception to the rule that leaving
    // a threatened tile costs you - which is what makes it worth a class
    // point. Read the same way every other talent effect is, so an enemy
    // archetype can carry it too.
    const flier = talentFxOf(mover).noProvoke;
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
      // The watch circle is a true radius from the watcher's BODY to the
      // mover's - the same continuous metric the opportunity sweep two lines
      // down reads, so the two reaction systems can no longer disagree about
      // one movement (DEGRID M5; watch radius is a targeted range, D4).
      if (!watchTriggers(ACTIONS[actionId], {
        dist: dist(w.x, w.z, to.x, to.z),
        los: world.hasLos(w.x, w.z, to.x, to.z),
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
    if (flier) {
      // Say so once per escape, or "nothing happened" reads as a missing rule.
      // This sits AFTER overwatch deliberately: Frequent Flier prevents
      // opportunity attacks, not a held ranged stance firing across its line.
      if (provokedBy(threatsAgainst(mover), from.px, from.pz, to.x, to.z, world.stepOpen).length) {
        log(`${mover.sheet ? mover.sheet.name : mover.def.name} walks off untouched. Frequent flier.`);
      }
      return;
    }
    for (const t of provokedBy(threatsAgainst(mover), from.px, from.pz, to.x, to.z, world.stepOpen)) {
      if (!canReact(t.ref)) continue; // an earlier swing this step spent it
      reactions.set(t.ref, (reactions.get(t.ref) || 0) + 1);
      // Only when the AI walked into it - see the tally's own note. aiAllies()
      // is the side test Q011 made the single owner of "who is on THEIR side",
      // so a charmed coworker you are driving counts as yours here too.
      if (aiAllies().includes(mover)) bout.oaCount += 1;
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
      attacker.actor.lunge(posOf(defender).x, posOf(defender).z);
      faceTarget(attacker, defender.x, defender.z);
      if (!rollAgainst(attacker, defender)) {
        hitFx(defender, 'whiff');
        fx.damageText(defender.x, defender.z, 'MISS', MISS_COLOR);
        log(`${attacker.sheet.name} swings at ${defender.def.name} ${caught} - and misses.`);
        refresh();
        return;
      }
      // Roll, bonus, soak: the mirror of unitStrikesMember with the roles
      // reversed - the defender's Composure shaves this hit like a member's
      // shaves theirs.
      const rolled = rand(a.min, a.max);
      const bonus = damageBonus(attacker.sheet);
      const beforeSoak = rolled + bonus;
      const dmg = soakHit(beforeSoak, defender.combat.deflect);
      reportDamage({
        attacker: attacker.sheet.name,
        target: defender.def.name,
        action: `${a.label} reaction`,
        roll: rolled,
        min: a.min,
        max: a.max,
        additions: [{ label: 'damage bonus', value: bonus }],
        stages: [{
          label: `Composure soak ${defender.combat.deflect || 0}`,
          before: beforeSoak,
          after: dmg,
        }],
        result: dmg,
      });
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
    // The same contact-range pool aiAttack draws from (Q048). A reaction IS a
    // swing at somebody who just walked past you, so it cannot come out of the
    // rifle line; this used to draw uniformly over every line the def owns,
    // which let the Executive's ranged entry resolve at arm's length.
    // The draw stays UNWEIGHTED, deliberately: `pickLine`'s status weighting
    // is a chosen swing, and the comment above already calls this a reflex
    // rather than a committed one - routing it through pickLine is a separate
    // question, not a tidy-up.
    const pool = swingPool(attacker);
    const base = pool[rand(0, pool.length - 1)];
    attacker.lunge(posOf(defender).x, posOf(defender).z);
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
  // --- per-frame driver -------------------------------------------------------------

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
  function retireStaleMoveStarts() {
    for (const u of [...moveStart.keys()]) {
      const body = bodyOf(u);
      if (!body || !body.moving) moveStart.delete(u);
    }
  }

  // Finish a queued walk-up strike, if the walk has landed. Runs every player
  // frame and does nothing on most of them.
  function finishWalkUpStrike() {
    if (!pendingMelee || session.activeMember.actor.moving) return;
    const { en, action } = pendingMelee;
    pendingMelee = null;
    // Did we arrive somewhere this verb can act from? One predicate for
    // both shapes (verbReaches reads the power's own range, or the melee
    // reach a touch verb walks into), measured from the BODY - which is
    // where the trim stopped it, so the walk's promise and the arrival
    // check are the same question asked twice.
    const bp = posOf(session.activeMember);
    const arrived = verbReaches(action, en, bp.x, bp.z);
    // The crouch is re-resolved ON ARRIVAL (TACTICS_PLAN M6) - the world
    // had a whole walk to change. Blocked here quietly stands down; a
    // human shield takes the arriving shot by the same rule as a
    // standing one, except one of your own, which stands down too.
    const out = rangeOf(action) ? shotOutcome(session.activeMember, en) : { target: en };
    const fireable = !out.blocked && !(out.redirected && out.target.sheet);
    if (en.alive && arrived && fireable
      && session.activeMember.ap >= ACTIONS[action].ap) {
      session.activeMember.actor.faceToward(en.x, en.z);
      if (out.redirected) log(`${nameOf(out.target)} takes it instead. That is the job.`);
      strike(action, out.target);
    } else {
      // A cancelled arrival SAYS why. Standing down silently was half of
      // the stuck-walk-up bug's confusion: the walk happened, the strike
      // didn't, and nothing on screen admitted anything had failed.
      if (en.alive && arrived && !fireable) log(`No shot - ${en.def.name} is in cover.`);
      else if (en.alive && !arrived) log(`${en.def.name} is still out of reach.`);
      else if (en.alive) log(`Not enough AP left for ${ACTIONS[action].label}.`);
      disarm();
      refresh();
    }
  }

  // Finish a queued walk-up crouch (TACTICS_PLAN M6), if the walk has landed.
  // Deliberately NOT chained to the strike above: a failed arrival there calls
  // disarm(), which clears armed/pendingConfirm/aim.aimPoint but never
  // pendingCrouch, so failing the strike and then taking the crouch in the same
  // frame is a real path and always has been. Whether it SHOULD be is a design
  // question; the split is not the place to answer it.
  function finishWalkUpCrouch() {
    if (!pendingCrouch || session.activeMember.actor.moving) return;
    const { spot } = pendingCrouch;
    pendingCrouch = null;
    const a = ACTIONS['take-cover'];
    // `crouchHere` re-asks the faces on arrival, so a shield that moved or
    // fell during the walk-up is a crouch that never happens rather than
    // one that lands on nothing.
    if (session.activeMember.actor.x === spot[0] && session.activeMember.actor.z === spot[1] && session.activeMember.ap >= a.ap
      && crouchHere(session.activeMember)) {
      session.activeMember.ap = roundAp(session.activeMember.ap - a.ap);
      refresh();
    } else {
      log('The moment passes - no cover taken.');
      refresh();
    }
  }

  // Everything the beat ladder needs to DECIDE, and everything the beat it
  // picks needs to ACT - gathered in one place because the two halves cannot be
  // separated: a beat is only "available" once its plan exists, and the plan is
  // what the arm then takes. Returned rather than assigned, because `shootable`
  // in particular is a local the caller has to bind.
  function aiBeatPlans(unit, target) {
    // The gather is combat-ai's (`gatherBeatPlans`); what stays here is the
    // world it asks about. Every entry below is a closure-bound question -
    // where the bodies are, what the floor is made of, whose side somebody is
    // on - and none of the RULES (which plans are worth gathering at what
    // price, when a shot exists, when a crouch is worth taking) are in this
    // function any more.
    return gatherBeatPlans(unit, target, {
      ap: session.acting.ap,
      moveBudget: moveBudget(session.acting),
      summonSpec: (u) => summonSpec(u.def.summon),
      postableNow,
      supportSpec: (u) => u.def.support || null,
      // Everything the triage reads lives on the def, the summon descriptor's
      // pattern; the colleagues are flattened here because only combat knows
      // who is on this unit's side right now.
      supportPlan: (u, sup) => aiSupportPlan(u.x, u.z, sup,
        aiAllies().map((e) => ({
          x: e.x,
          z: e.z,
          hp: e.hp,
          maxHp: e.maxHp,
          expiring: (e.summonTurns ?? Infinity) <= 1,
          ref: e,
        })), {
          // The player's ally buff measures body-to-body and traces a line;
          // triage gets the same gate, with self as the one degenerate line.
          canSupport: (a) => a.ref === u || (
            bodyDist(u, a.ref) <= (sup.range ?? Infinity) && bodyLos(u, a.ref)
          ),
        }),
      topplePlan: aiTopplePlan,
      edgeTopplePlan: aiEdgeToppleFor,
      pullPlan: aiPullPlanFor,
      shovePlan: aiShovePlanFor,
      breakPlan: aiBreakPlanFor,
      canEngage: (u, t) => canEngage(u, t.member),
      inReach: canReach,
      crouched: (u) => crouched.has(u),
      // A redirect into a MEMBER human shield fires (the shield takes the
      // blocked hit, TACTICS_PLAN M6 ratified); a redirect into the unit's own
      // colleague refuses, mirroring the player's member-shield refusal -
      // milestone 5 does not ship friendly fire.
      shootable: (u, t) => {
        const rls = rangedLines(u);
        if (!rls.length) return null;
        // `bodyDist`/`bodyLos`, the same two the PLAYER's ranged gate asks -
        // this hand-rolled the distance and then asked line of sight of ROUNDED
        // TILES, which is the one that mattered: since DEGRID a body rests
        // wherever its walk left it, so the AI could refuse a shot the player
        // would be allowed from the same spot, or take one the shot resolver
        // then re-measured and blocked.
        const gap = bodyDist(u, t);
        const line = rls.find((a) => gap <= a.range && bodyLos(u, t));
        if (!line) return null;
        const so = shotOutcome(u, t.member);
        return (so.target && (!so.redirected || so.target.sheet)) ? { line, so } : null;
      },
      // The same legs the crouch doer walks: something here actually shields
      // us from the target.
      covered: (u, t) => {
        const b = bodyOf(u);
        const tb = bodyOf(t);
        return aiCrouchCovered(b.x, b.z, tb.x, tb.z, {
          tileDefAt: world.tileDefAt,
          stepOpen: world.stepOpen,
          bodyAt: (x, z) => { const o = unitStandingAt(x, z); return !!o && o !== u && standing(o); },
        });
      },
    }, {
      topple: ACTIONS.shove.ap,
      pull: ACTIONS.pull.ap,
      shove: ACTIONS.shove.ap,
      cover: ACTIONS['take-cover'].ap,
      move: MOVE.COST_PER_TILE,
    });
  }

  // The chosen beat, DONE. Nearly every arm is the same three lines - bill the
  // AP, do the thing, set a wait that outlasts its animation - which is what
  // the four extractions above were for; the two crouching arms bill nothing
  // here because tryAiCrouch bills itself, and the three refusing arms set no
  // wait at all, because nothing animated and the ladder should re-decide on
  // the very next frame rather than after a pause.
  //
  // The trailing `advanceTurn()` is the pass beat and belongs to this function,
  // not to its caller: every arm above it returns, and moving the tail out
  // would turn each of those returns into a fall-through into the pass. The
  // `entrench`, `advance` and `crouch` arms return WITHOUT ending the turn -
  // they add themselves to `refused` so the next frame's ladder skips them and
  // picks something lower down. That is a loop, and it is what makes a
  // shieldless entrench land as a plain shot.
  function takeBeat(beat, unit, target, plans, refused) {
    // The dispatch itself is combat-ai's (`runBeat`) - it is rules, not world,
    // and every arm of it now has a test. What stays here is the DOING: the
    // eleven closure-bound verbs it calls, and `acting`, which is the turn
    // state the frame loop reads next tick.
    runBeat(beat, {
      turn: session.acting,
      plans,
      unit,
      target,
      refused,
      round: roundAp,
      doers: {
        support: aiSupport,
        summon: aiSummon,
        topple: aiTopple,
        pull: aiPullMember,
        shove: aiShove,
        break: aiOpenOrBreak,
        attack: aiAttack,
        shoot: aiShoot,
        crouch: tryAiCrouch,
        // The budget is read at CALL time, from the same `acting` the biller
        // writes back to - so the two halves of a move cannot disagree about
        // which turn they belong to.
        advance: (u, t) => aiAdvance(u, moveBudget(session.acting), t),
        billMove: (spent) => billMove(session.acting, spent),
        refresh,
        pass: advanceTurn,
      },
    });
  }

  // The head is short enough now to invite tidying, so the three things it must
  // keep doing in this exact shape are written down rather than left to be
  // rediscovered. All three fail silently.
  //
  //  - The two draw calls are ORDERED and neither belongs in the player arm.
  //    `drawPreview` latches `previewDt = dt` as its first statement, before its
  //    own `!preview` bail, and `drawCoverRings` reads it later in the SAME
  //    frame through drawTargets; swap them and the crouch ring's ease runs on
  //    the last frame's dt (0 on the first frame of an aim), so it never glides.
  //    And `drawTargets` only LOOKS like player UI: it runs `drawAimWash()`
  //    unconditionally before its own phase gate, and the `aimPaint.hide()` in
  //    there is the only thing that takes the ground wash down - move the call
  //    inside `phase === 'player'` and the wash stays painted through every
  //    enemy turn.
  //  - The victory check is phase-agnostic on purpose. Every verb has its own,
  //    but this is the only one that catches a death combat.js did not cause -
  //    a printer going up mid-fight. In the player arm, a fight whose last
  //    hostile dies on an AI turn never ends.
  //  - The wait gate burns the WHOLE frame, including the frame the wait
  //    expires on. Letting it fall through when the decrement crosses zero is a
  //    one-line efficiency tidy that speeds every beat in the game up by a
  //    frame.
  function update(dt) {
    if (session.phase === 'done') return;
    retireStaleMoveStarts();
    drawPreview(dt); // immediate-mode lines last one frame - redraw while shown
    drawTargets();
    // prune anyone killed externally (printer explosions during combat)
    if (!hostilesRemain()) { victory(); return; }
    if (session.phase === 'player') {
      finishWalkUpStrike();
      finishWalkUpCrouch();
      return;
    }
    // The AI drives the ONE unit whose initiative turn it is (acting, set by
    // beginTurn). It takes beats until out of AP, then advanceTurn hands the
    // order on.
    if (session.phase !== 'ai' || !session.acting) return;
    if (session.acting.wait > 0) {
      session.acting.wait -= dt;
      return;
    }
    const { unit } = session.acting;
    if (!unit.alive) { advanceTurn(); return; }
    if (unit.moving) return; // let the current walk play out
    if (unit.slipped) {
      unit.slipped = false; // a spill ends their whole turn
      advanceTurn();
      return;
    }
    const target = pickTarget(unit);
    if (!target) { defeat(); return; } // no living player-side target = party wipe
    // The standing mark stickiness holds to - and it is recorded per DECISION,
    // which is why it sits below the `moving` guard: re-committing on every
    // frame of a walk would make it mean "who I am walking at" instead.
    aiTargets.set(unit, target.member);
    // Gather, decide, act. The decision is combat-ai's (chooseBeat, a pure
    // ladder over plain values); the gathering and the doing are this file's,
    // because both need the world. All three happen exactly once, in this
    // order, HERE - `refused` is minted once per turn and handed to both
    // callees, and the tally counts DECISIONS, refusals included, so it belongs
    // after the choice and before the doing.
    const plans = aiBeatPlans(unit, target);
    const refused = (session.acting.refused ??= new Set());
    const { beat } = chooseBeat(plans.beatState, refused);
    bout.beats[beat] = (bout.beats[beat] || 0) + 1;
    takeBeat(beat, unit, target, plans, refused);
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

  // The e2e/god-mode handle is a dedicated adapter now. This bag supplies the
  // live fight; combat-debug.js owns how it is projected and which mutation
  // doors are allowed.
  window.__combat = createCombatDebug({
    get phase() { return session.phase; },
    get acting() { return session.acting; },
    get active() { return session.activeMember; },
    get bout() { return bout; },
    get engaged() { return engaged; },
    watching,
    crouched,
    intent,
    aim,
    aimPaint,
    hits,
    get lastClickOutcome() { return lastClickOutcome; },
    members,
    turns,
    statuses: STATUSES,
    roundAp,
    refresh: (...a) => refresh(...a),
    posOf: (...a) => posOf(...a),
    crouchStateOf: (...a) => crouchStateOf(...a),
    nameOf: (...a) => nameOf(...a),
    coverNames: (...a) => coverNames(...a),
    statusList: (...a) => statusList(...a),
    hasStatus: (...a) => hasStatus(...a),
    applyStatus: (...a) => applyStatus(...a),
    removeStatus: (...a) => removeStatus(...a),
    charmUnit: (...a) => charmUnit(...a),
    crouchHere: (...a) => crouchHere(...a),
    advanceTurn: (...a) => advanceTurn(...a),
    slotName: (...a) => slotName(...a),
    slotAlive: (...a) => slotAlive(...a),
    resolveSummon: (...a) => resolveSummon(...a),
  });

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
    if (session.phase === 'player') {
      intent.arm(opening.actionId);
      refresh();
      // A cone opener fires the wedge the player AIMED outside the fight -
      // the click point rides in through `opening` - rather than one
      // re-pointed at the primary target (DEGRID M5's one-geometry rule).
      if (ACTIONS[opening.actionId].cone && opening.point) {
        fireCone(opening.point.x, opening.point.z);
      } else {
        handleEnemyClick(opening.target);
      }
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
    get armedIsFriendly() { return aimsAtAlly(ACTIONS[intent.armed]); },
    // --- the shared action bar -------------------------------------------------
    // main.js renders one bar for the whole game and asks these three things of
    // a fight: what does pressing a slot do, can it be pressed, and what has the
    // reorg done to the order. Combat keeps the rules; main.js keeps the DOM.
    pressAction,
    actionState,
    scrambleEntries,
    scrambleOrder,
    // Bill a verb that is not an ACTION against the acting member's pool - a
    // consumable, pressed from the bar or from the pockets. Returns false when
    // they cannot afford it, so the caller refuses without spending anything.
    // Everything else in a turn is billed; a free full heal every round would
    // be the strongest move in the game.
    spendAp: (n) => {
      if (session.phase !== 'player' || session.activeMember.ap < n) return false;
      // Through roundAp like every other spend. Nothing visibly breaks without
      // it - both callers pass whole numbers and every AP reader already
      // defends itself - but this was the last raw `.ap` write in the file, and
      // "the one that does it differently" is how the other three float-AP
      // sites got written in the first place.
      session.activeMember.ap = roundAp(session.activeMember.ap - n);
      refresh();
      return true;
    },
    // Which slot is awaiting its second, committing press (an instant
    // self-action). The bar rings it differently from an armed one.
    get pendingConfirm() { return intent.pendingConfirm; },
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
      if (session.phase !== 'player' || !ref) return false;
      const slot = turns.held.find((s) => s.member
        && (s.member === ref || s.member.sheet === ref.sheet || s.member.actor === ref));
      if (!slot || slot.member === session.activeMember || turns.isDone(slot)) return false;
      return turns.steer(slot);
    },
    // Is this body a member you could grab the wheel of right now? The
    // right-click menu asks before offering the item; returns the name to put
    // on it, or null.
    canSteer(ref) {
      if (session.phase !== 'player' || !ref) return null;
      const slot = turns.held.find((s) => s.member
        && (s.member === ref || s.member.sheet === ref.sheet || s.member.actor === ref));
      if (!slot || slot.member === session.activeMember || turns.isDone(slot) || slot.member.sheet.hp <= 0) return null;
      return slot.member.sheet.name;
    },
    // Tab in combat: cycle the floor through the un-done members of the open
    // shared turn, the same loop the key walks through the roster out of one.
    cycleSteer() {
      if (session.phase !== 'player') return false;
      const holders = turns.held.filter((s) => s.member && !turns.isDone(s) && s.member.sheet.hp > 0);
      if (holders.length < 2) return false;
      const i = holders.findIndex((s) => s.member === session.activeMember);
      return turns.steer(holders[(i + 1) % holders.length]);
    },
    // The body whose turn it is - a party member OR a summon you're driving.
    // main.js needs this because party.active can't point at a summon.
    get actingActor() { return session.activeMember.actor; },
    // ...and the sheet the HUD card is reflecting for that turn, so main.js's
    // per-tile hooks repaint the RIGHT character when a step hurts them.
    get actingSheet() { return session.activeMember.sheet; },
    // Per-member turn snapshot, for the party bar's in-combat AP readout.
    get party() {
      return members.map((m) => ({ name: m.sheet.name, hp: m.sheet.hp, ap: m.ap, active: m === session.activeMember }));
    },
    // main.js detected a slip mid-walk (tile effects live there) - narrate it
    notifySlip: (name = null) => log(name
      ? `${name} slips in the water. The rest of that movement is a donation.`
      : 'You slip in the water. The rest of that movement is a donation.'),
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
    get active() { return session.running; },
  };
}
