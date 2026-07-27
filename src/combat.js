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
import { ACTIONS } from './data/actions.js';
import { SURFACES } from './data/surfaces.js';
import { truncateByBudget } from './pathfinding.js';
import { damageBonus, applyDamage, deflect, statusResist, hitChance, rollHit, accuracy, dodge, equippedAction, weaponProc, moveCostOf, reachOf, ammoCostOf as ammoCost, effectiveAttr, MOVE, REACH, THROW_RANGE } from './stats.js';
import { applyStatus, hasStatus, statusFx, clearStatuses, removeStatus, statusList, blockedBy, statusSeverity } from './statuses.js';
import { toHitTerms, provokedBy, positionMods, inReach, dist, TACTICS } from './tactics.js';
import { buffProblem, buffOutcome, buffRangeOf, isFriendly, controlProblem, controlOutcome, controlIsRanged, isControl, isZone, zoneProblem, zoneTiles, zoneRadiusOf, zoneRangeOf, isMobility, aimsAtAlly, mobilityProblem, mobilityRangeOf, dashDistanceOf, isStance, watchRadiusOf, watchTriggers, isToppleable, toppleLanding } from './powers.js';
import { STATUSES } from './data/statuses.js';
import { PANEL_CHROME, BUTTON_CHROME } from './ui.js';
import { createTurnOrder } from './turn-order.js';

const pc = window.pc;
const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const cheb = (ax, az, bx, bz) => Math.max(Math.abs(ax - bx), Math.abs(az - bz));
// Radius of a target's ring marker. Cone tests use it so a body counts when
// the wedge CLIPS it, matching what the ring shows.
const TARGET_R = 0.5;
const SURPRISE_RADIUS = 2; // engaged from beyond this = loses the first turn

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

export function startCombat({ app, party, engaged, world, fx, callbacks, opening = null, allies = [], rng = Math.random }) {
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
  const livingMembers = () => members.filter((m) => m.sheet.hp > 0 && m.actor);
  const livingParty = () => members.filter((m) => m.sheet.hp > 0 && m.actor && !m.isSummon);
  // The AI enemies hunt the whole player side - members and summons alike, all
  // members now. A target wraps { actor, member }; combat reads `member` to take
  // the hit on its sheet (deflect, gum, the downed rules).
  // The route to a tile the unit could stand on and swing from: the shortest
  // path to any of the target's eight neighbours, or null if none is reachable.
  // Shared by pickTarget and aiAdvance so the two can never disagree about who
  // is engageable - if the target picker says yes, the mover must find a route.
  function standTilePath(unit, target) {
    let best = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const tx = target.actor.x + dx;
      const tz = target.actor.z + dz;
      if (!world.isWalkable(tx, tz) && !(unit.x === tx && unit.z === tz)) continue;
      const p = world.findEnemyPath(unit.x, unit.z, tx, tz);
      if (p && p.length > 1 && (!best || p.length < best.length)) best = p;
    }
    return best;
  }

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
  function pickTarget(unit) {
    let best = null;
    for (const m of livingMembers()) {
      const d = cheb(unit.x, unit.z, m.actor.x, m.actor.z);
      const engageable = canEngage(unit, m);
      const better = !best
        || (engageable && !best.engageable)
        || (engageable === best.engageable
          && (d < best.d || (d === best.d && m.sheet.hp < best.m.sheet.hp)));
      if (better) best = { m, d, engageable };
    }
    return best ? { actor: best.m.actor, member: best.m } : null;
  }
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
  const actionIdsOf = (m) => [...m.sheet.actions, equippedAction(m.sheet), 'shove', ...throwablesFor(m)];
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
    u.speed = u.baseSpeed * (statusFx(u).speedMult ?? 1);
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

  // A member's reach comes from their weapon, an AI unit's from its def (like
  // attackAp). REACH.DEFAULT is the floor for both.
  function reachOfUnit(u) {
    return u.sheet ? reachOf(u.sheet) : (u.combat?.reach ?? REACH.DEFAULT);
  }

  // The CONTINUOUS position reach measures against. `actor.x/.z` are only
  // Math.round of this, which is why the old tile test let two units at
  // opposite far corners of diagonally adjacent tiles (2.83 apart) trade
  // swings while a deliberate walk-up stops at 0.85 (TACTICS_PLAN revision).
  // Falls back to the logical tile for a unit with no body in the scene yet.
  function posOf(u) {
    const a = u.actor || u;
    if (a.entity) {
      const p = a.entity.getPosition();
      return { x: p.x, z: p.z };
    }
    return { x: a.x, z: a.z };
  }

  // Is the defender within the attacker's reach DISTANCE? Ignores anything
  // solid in between on purpose: this is the melee/ranged split positionMods
  // needs, and whether a cubicle wall spoils a shot is a question about
  // proximity, not about whether the swing is legal.
  function withinReach(attacker, defender, r = null) {
    const a = posOf(attacker);
    const d = posOf(defender);
    return inReach(a.x, a.z, d.x, d.z, r ?? reachOfUnit(attacker));
  }

  // Can the attacker actually TOUCH the defender - reach distance, and nothing
  // solid in the way? THE melee predicate: swings, shoves and opportunity
  // attacks all read it, so reach means one thing everywhere. `r` overrides the
  // attacker's own reach, which the shove needs - a shove is arms-length
  // whatever you happen to be holding.
  //
  // The line test is what makes a partition terrain rather than decoration:
  // before it, cover was ranged-only AND melee ignored edges, so a cubicle wall
  // cost a melee attacker nothing - not even a step around it.
  function canReach(attacker, defender, r = null) {
    const a = posOf(attacker);
    const d = posOf(defender);
    return inReach(a.x, a.z, d.x, d.z, r ?? reachOfUnit(attacker), world.stepOpen);
  }

  // The to-hit terms for one attacker/defender pair (TACTICS_PLAN #1). THE
  // single place the terms are assembled: every roll site and the hover
  // preview read it, so the percentage the player sees is always the
  // arithmetic the roll actually uses. `positional` (cover/flank/backstab)
  // plugs in here in later milestones and reaches all four sites at once.
  const attackMods = (attacker, defender) => {
    // Position is a per-PAIR term - it depends on where the other one stands,
    // so it is computed at roll time and never cached on a unit.
    const A = bodyOf(attacker);
    const D = bodyOf(defender);
    // The attacker's own side, minus itself: a pincer needs a second body.
    const allies = (attacker.sheet ? members : engaged)
      .filter((u) => u !== attacker && standing(u))
      .map((u) => ({ x: bodyOf(u).x, z: bodyOf(u).z }));
    const pos = positionMods(A.x, A.z, D.x, D.z, {
      // Cover/flank/backstab geometry stays on TILE octants - a cover face and
      // a pincer are genuinely grid-shaped. Only the melee/ranged SPLIT moves
      // to real distance, and it reads reach without the line test so turning
      // walls on (M3) can't silently change who gets cover.
      melee: withinReach(attacker, defender),
      edgeOpen: world.stepOpen,
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
  const initRng = () => Math.random();
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
        if (!engaged.some((e) => e.alive)) return 'win';
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
        if (watching.delete(holder)) removeStatus(statusesOf(holder), 'watching');
      },
      beforeAdvance: () => {
        armed = null;
        pendingConfirm = null;
        pendingMelee = null;
        hidePreview();
      },
    },
  });
  // Thin readers, so the rest of the file reads the way it did.
  const advanceTurn = () => turns.advance();
  const beginTurn = () => turns.begin();
  const insertSlot = (slot) => turns.insert(slot);

  // --- UI ---------------------------------------------------------------------
  const panel = document.createElement('div');
  panel.id = 'combat-panel';
  Object.assign(panel.style, PANEL_CHROME, {
    position: 'fixed', left: '50%', bottom: '18px', transform: 'translateX(-50%)',
    zIndex: '30', width: 'min(640px, 94vw)', borderRadius: '10px',
    padding: '10px 14px', userSelect: 'none',
  });
  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:7px;">
      <div id="combat-turn" style="font-weight:700;"></div>
      <div id="combat-ap" style="letter-spacing:2px;"></div>
    </div>
    <div id="combat-log" style="min-height:32px; opacity:.9; margin-bottom:8px;"></div>
    <div id="combat-actions" style="display:flex; gap:7px; flex-wrap:wrap;"></div>`;
  document.body.appendChild(panel);

  const strip = document.createElement('div');
  strip.id = 'combat-strip';
  Object.assign(strip.style, PANEL_CHROME, {
    position: 'fixed', top: '54px', right: '12px', zIndex: '25', minWidth: '170px',
    borderRadius: '9px', padding: '9px 12px', font: '12px system-ui, sans-serif',
  });
  document.body.appendChild(strip);

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

  // While a single-target attack is armed, the cost tag shows the to-hit chance
  // for the enemy under the cursor - the rings show range/validity, this shows
  // the odds (DOS2's most load-bearing bit of UI). A cone's wedge is its own
  // feedback and a shove auto-hits, so neither shows a percentage.
  function showHitPreview(en, sx, sy) {
    hoverHitChance = null;
    // The readout REPLACES the movement trail. Clearing it here rather than at
    // the call sites is what makes that true: `preview` is redrawn every frame,
    // so a trail left over from the last patch of floor the cursor crossed kept
    // hanging off the character while they were plainly aiming at someone.
    preview = null;
    const a = ACTIONS[previewAction()];
    // A control rolls to hit like a swing does, so it earns the same readout -
    // an odds display that vanished the moment you armed Detain would make the
    // one power you most want to know the odds of the one that hides them.
    if (!a || (a.type !== 'attack' && !isControl(a)) || a.cone || !en) {
      costTag.style.display = 'none';
      return;
    }
    // The same terms the swing will roll - not a second copy of the math. The
    // reason string matters: a positional modifier the player can't see reads
    // as randomness (TACTICS_PLAN, ui.js note).
    const t = attackMods(active, en);
    hoverHitChance = hitChance(t.acc, t.dodge, t.mods);
    const why = t.covered ? ' - in cover'
      : (t.behind ? ' - from behind' : (t.flanked ? ' - flanked' : ''));
    costTag.textContent = `${Math.round(hoverHitChance * 100)}% to hit${why}`;
    costTag.style.left = `${sx + 14}px`;
    costTag.style.top = `${sy + 14}px`;
    costTag.style.display = 'block';
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
        preview = points; // the trail IS the affordance for a move
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
    if (armed && (ACTIONS[armed].cone || ACTIONS[armed].type === 'summon' || isZone(ACTIONS[armed]))) aimPoint = point;
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
      if (aimsAtAlly(ACTIONS[armed])) {
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

  // The wedge a cone attack would cover, aimed from the acting member's body
  // toward (tx, tz). Returns a tile test, or null when there's no meaningful
  // aim.
  function coneTest(a, tx, tz) {
    const pp = active.actor.entity ? active.actor.entity.getPosition() : { x: active.actor.x, z: active.actor.z };
    let dx = tx - pp.x;
    let dz = tz - pp.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) return null;
    dx /= len;
    dz /= len;
    const half = (a.cone.halfAngle * Math.PI) / 180;
    // `r` is the target's radius. A point test (r = 0) is right for carpeting
    // floor tiles, but WRONG for bodies: it demanded the wedge swallow a
    // target's centre, so the ring only went green once the cone visibly
    // covered the whole marker. Passing the ring's radius widens the wedge by
    // the angle the body subtends, so the cone catches anything it clips.
    const test = (wx, wz, r = 0) => {
      const vx = wx - pp.x;
      const vz = wz - pp.z;
      const d = Math.hypot(vx, vz);
      if (d < 0.3 || d - r > a.cone.range) return false;
      const slack = r > 0 ? Math.asin(Math.min(1, r / Math.max(d, 1e-6))) : 0;
      return (vx * dx + vz * dz) / d >= Math.cos(Math.min(Math.PI, half + slack));
    };
    test.origin = pp;
    test.angle = Math.atan2(dz, dx);
    return test;
  }

  // While an attack/shove is armed, rings mark the targets: green = usable on
  // them right now (melee walks you in), red = out of range / no line / short
  // on ammo or AP. Every live enemy is ringed, not just the engaged - a
  // clickable bystander deserves the same feedback. A cone draws its aimed
  // wedge instead, ringing whoever it would catch.
  function drawTargets() {
    if (phase !== 'player') return;
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
      return;
    }
    if (a.type !== 'attack' && a.type !== 'shove' && !isControl(a)) return;
    if (a.cone) {
      const test = aimPoint && coneTest(a, aimPoint.x, aimPoint.z);
      if (test) {
        const y = 0.14;
        const half = (a.cone.halfAngle * Math.PI) / 180;
        const pts = [];
        for (let i = 0; i <= 14; i++) {
          const ang = test.angle - half + (2 * half * i) / 14;
          pts.push(new pc.Vec3(test.origin.x + Math.cos(ang) * a.cone.range, y,
            test.origin.z + Math.sin(ang) * a.cone.range));
        }
        const o = new pc.Vec3(test.origin.x, y, test.origin.z);
        app.drawLine(o, pts[0], PREVIEW_OK);
        app.drawLine(o, pts[pts.length - 1], PREVIEW_OK);
        for (let i = 1; i < pts.length; i++) app.drawLine(pts[i - 1], pts[i], PREVIEW_OK);
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
    if (hoverFoe?.alive) {
      const me = posOf(active);
      drawRing(me.x, me.z, a.type === 'shove' ? REACH.SHOVE : reachOfUnit(active), REACH_RING);
    }
    for (const en of world.liveEnemies()) {
      if (!en.entity) continue;
      let ok;
      if (a.type === 'shove') {
        ok = canReach(active, en, REACH.SHOVE) && active.ap >= a.ap;
      } else if (isControl(a) && controlIsRanged(a)) {
        // A thrown control needs the range and the line, same as a throw. A
        // touch-range one falls to the melee case below: clicking a distant
        // target walks you in, so every reachable body rings green.
        ok = !controlProblem(a, {
          dist: cheb(active.actor.x, active.actor.z, en.x, en.z),
          los: world.hasLos(active.actor.x, active.actor.z, en.x, en.z),
          ap: active.ap,
          usesLeft: a.uses ? active.usesLeft[id] ?? 0 : null,
          alive: en.alive,
        });
      } else if (a.ammoCost) {
        ok = cheb(active.actor.x, active.actor.z, en.x, en.z) <= THROW_RANGE
          && world.hasLos(active.actor.x, active.actor.z, en.x, en.z)
          && active.sheet.paper >= ammoCostOf(id) && active.ap >= a.ap;
      } else {
        ok = active.ap >= a.ap; // melee: clicking a distant target walks you in
      }
      const pos = en.entity.getPosition();
      drawRing(pos.x, pos.z, TARGET_R, ok ? PREVIEW_OK : PREVIEW_FAR);
    }
    // A purge can also target yourself - ring the caster too.
    if (a.purge && active.actor.entity) {
      const pp = active.actor.entity.getPosition();
      drawRing(pp.x, pp.z, 0.5, active.ap >= a.ap ? PREVIEW_OK : PREVIEW_FAR);
    }
  }

  const actionsRow = panel.querySelector('#combat-actions');
  const endBtn = document.createElement('button');
  endBtn.id = 'combat-end-turn';
  endBtn.textContent = 'End Turn';
  Object.assign(endBtn.style, {
    minWidth: '90px', padding: '8px 10px', borderRadius: '7px',
    border: '1px solid #6a5a30', background: '#3d3524', color: '#f5e8c8',
    font: 'inherit', cursor: 'pointer',
  });
  // The action bar belongs to the ACTIVE member - rebuilt whenever control
  // changes hands, because different sheets bring different actions. The
  // `#act-<id>` DOM ids always mean "the active member's action".
  let buttons = [];
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
  function buildActionBar() {
    actionsRow.innerHTML = '';
    buttons = [];
    const ids = actionIdsOf(active);
    for (const id of (statusFx(active.sheet).shuffleActions ? scrambled(ids) : ids)) {
      const b = document.createElement('button');
      b.id = 'act-' + id;
      b.dataset.action = id;
      b.textContent = ACTIONS[id].label;
      Object.assign(b.style, BUTTON_CHROME, {
        flex: '1', minWidth: '110px', padding: '8px 6px', borderRadius: '7px',
      });
      b.onclick = () => onActionButton(id, b);
      actionsRow.appendChild(b);
      buttons.push(b);
    }
    actionsRow.appendChild(endBtn);
  }
  buildActionBar();

  // Point everything at the member whose initiative turn it now is:
  // party.active moves with it so the portrait bar highlights and the
  // out-of-combat leader bindings follow whoever last held the floor (main.js
  // syncLeaderBindings). No free switching - proper initiative means you
  // control each member only when its own turn comes up.
  function makeActive(m) {
    active = m;
    // A summon lives outside party.members, so it can't be party.active - leave
    // that pointing at the real member who last held the floor (the post-combat
    // leader). The initiative tracker shows whose turn it actually is.
    if (!m.isSummon) party.active = members.indexOf(m);
    armed = null;
    pendingConfirm = null;
    pendingMelee = null;
    hidePreview();
    buildActionBar();
  }
  // A member dropped to 0 HP outside its own turn (fire under a combat walk) -
  // main.js reports it here. Topple them; if it was the acting member, end
  // their turn; defeat only on a party wipe.
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

  const el = (id) => panel.querySelector('#' + id);
  function log(text) {
    el('combat-log').textContent = text;
    callbacks.say(text);
  }
  function refresh() {
    // Name whose turn it is (initiative interleaves your members with the
    // enemies). "YOUR TURN — Name" on a member you control; "Name's turn" on
    // an AI unit.
    const solo = members.length === 1;
    el('combat-turn').textContent = phase === 'player'
      ? (solo ? 'YOUR TURN' : `YOUR TURN — ${active.sheet.name}`)
      : phase === 'ai' && acting ? `${acting.unit.def.name}'s turn` : '';
    // Distance-priced movement leaves fractional AP - show it as a half pip.
    const full = Math.floor(active.ap + 1e-6);
    const half = active.ap - full >= 0.05 ? 1 : 0;
    // The movement allowance rides beside the AP pips as its own boot glyph,
    // and only for characters that have one - never advertise a resource a
    // character does not own.
    const freeLeft = active.freeAp || 0;
    const freeTag = freeMoveOf(active) > 0 ? `  🥾 ${fmtAp(freeLeft)} move` : '';
    el('combat-ap').textContent = 'AP ' + '●'.repeat(full) + (half ? '◐' : '')
      + '○'.repeat(Math.max(0, active.sheet.maxAp - full - half)) + ` ${fmtAp(active.ap)}`
      + freeTag;
    for (const b of buttons) {
      const id = b.dataset.action;
      const a = ACTIONS[id];
      let label = `${a.label} · ${a.ap}AP`;
      if (a.uses) label += ` (${active.usesLeft[id]})`;
      if (a.ammoCost) label += ` (${active.sheet.paper}📄)`;
      b.textContent = label;
      const affordable = phase === 'player' && active.ap >= a.ap
        && (!a.uses || active.usesLeft[id] > 0)
        && (!a.ammoCost || active.sheet.paper >= ammoCostOf(id))
        && !(a.footwork && statusFx(active.sheet).noFootwork); // no kicking with gum on the shoe
      // An armed action stays clickable even when unaffordable - that button is
      // the way to lower it (see onActionButton).
      b.disabled = !affordable && id !== armed && id !== pendingConfirm;
      b.style.opacity = affordable || id === armed || id === pendingConfirm ? '1' : '.4';
      // The live one pulses: armed (aiming) or awaiting its confirm click. A
      // static border was too easy to miss mid-fight.
      const live = id === armed || id === pendingConfirm;
      b.style.borderColor = live ? (id === pendingConfirm ? '#ffd76b' : '#8adf76') : '#3a3a52';
      b.style.animation = live ? 'act-pulse 1.1s ease-in-out infinite' : '';
      b.title = actionTip(id, a);
    }
    endBtn.disabled = phase !== 'player';
    endBtn.textContent = 'End Turn'; // your turn ends, initiative moves on
    // The initiative tracker: the turn order top-to-bottom, the current unit
    // marked, your side tinted friendly and the enemies warm. HP rides along;
    // the downed/dead show a dash.
    strip.innerHTML = `<div style="font-weight:700; margin-bottom:5px;">INITIATIVE</div>` +
      turns.order.map((s, i) => {
        const cur = i === turns.index;
        const carrier = s.member ? s.member.sheet : s.unit;
        const hp = s.member
          ? `${Math.max(0, s.member.sheet.hp)}/${s.member.sheet.maxHp}`
          : `${Math.max(0, s.unit.hp)}/${s.unit.maxHp}`;
        const dead = !slotAlive(s);
        const col = s.team === 'player' ? '#8adf76' : '#ffb3a0';
        // Live status icons trail the row - the at-a-glance read of who's
        // stunned, burning, deflecting, gummed.
        const icons = dead ? '' : statusList(carrier).map((st) => st.icon).join('');
        // Each row leads with the combatant's own rendered face (portraits.js).
        // It rides the ACTOR, so it is there for members, summons and enemies
        // alike, and simply absent until the render lands.
        const face = (s.member ? s.member.actor : s.unit)?.portraitUrl;
        const pic = face
          ? `<img src="${face}" alt="" style="width:22px; height:22px; border-radius:4px;`
            + `border:1px solid ${col}; vertical-align:middle; margin-right:5px; flex:none;">`
          : '';
        return `<div style="opacity:${dead ? '.4' : '.95'}; color:${col};`
          + `font-weight:${cur ? '700' : '400'}; display:flex; align-items:center; gap:2px; margin:1px 0;">`
          + `<span style="width:11px; flex:none;">${cur ? '▸' : ''}</span>${pic}`
          + `<span>${slotName(s)} &middot; ${dead ? '—' : hp}`
          + ` <span style="opacity:.6">(${s.init})</span>`
          + (icons ? ` ${icons}` : '') + `</span></div>`;
      }).join('');
    // Reflect the ACTING member on the persistent HUD, not the leader - in a
    // multi-member fight you control whoever's turn it is (their HP, their gum/
    // bleed chips). Out of combat, main.js's callback falls back to the leader.
    callbacks.updateHud(active.sheet);
  }

  function cleanup() {
    // Turn-clock statuses (Deflect, surprise, and later stun/burn) are
    // combat-scoped - there are no turns on the map, so sweep them from every
    // combatant as the fight ends. Step-clock statuses (gum/bleed) persist.
    for (const m of members) clearStatuses(m.sheet, { clock: 'turn' });
    for (const e of engaged) clearStatuses(e, { clock: 'turn' });
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
    phase = 'done';
    app.off('update', update);
    panel.remove();
    strip.remove();
    costTag.remove();
    delete window.__combat;
  }

  function victory() {
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
    if (a.ammoCost) {
      active.sheet.paper -= ammoCostOf(id);
      fx.projectile({ x: active.actor.x, z: active.actor.z }, { x: en.x, z: en.z },
        id === 'paper-airplane' ? 'plane' : 'ball');
    } else {
      active.actor.lunge(en.x, en.z);
    }
    faceTarget(active, en.x, en.z); // you face what you swing at
    active.ap -= a.ap;
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
    let dmg = rand(a.min, a.max) + damageBonus(active.sheet); // carried staplers count
    if (a.ammoCost) dmg += talentFxOf(active).paperDamageBonus || 0;
    const died = en.takeDamage(dmg);
    hitFx(en, a.ammoCost ? 'paper' : 'melee', active);
    if (died) deathFx(en);
    fx.damageText(en.x, en.z, `-${dmg}`, '#ffd76b', { big: died });
    let line = `${a.log} ${dmg} damage!`;
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
    if (!engaged.some((e) => e.alive)) victory();
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
    if (!dx && !dz) return { slammed: false, died: false, msg: '' };
    const tx = en.x + dx;
    const tz = en.z + dz;
    // A partition between the tiles counts as "something solid" too - and so
    // does a body. isWalkable only excludes enemies and NPCs, so without the
    // occupancy check a shove could glide a coworker onto a teammate's (or a
    // summon's) tile and leave two combatants permanently stacked.
    const occupied = members.some((m) =>
      m.sheet.hp > 0 && m.actor && m.actor.x === tx && m.actor.z === tz);
    if (occupied || !world.isWalkable(tx, tz) || !world.stepOpen(en.x, en.z, tx, tz)) {
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
          msg += ' They crumple - dazed.';
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
  function topplePlan(from, px, pz) {
    const def = world.tileDefAt(px, pz);
    if (!isToppleable(def)) return null;
    const b = bodyOf(from);
    const landing = toppleLanding(b.x, b.z, px, pz);
    if (!landing) return null;
    const [lx, lz] = landing;
    // Nothing behind it to fall into: it rocks and settles. No free
    // destruction against a wall - a prop pinned by geometry stays up, which
    // is also what stops toppling from being a way to demolish a corridor.
    if (!world.terrainOpen(lx, lz)) return null;
    if (!world.stepOpen(px, pz, lx, lz)) return null;
    return { def, x: px, z: pz, lx, lz };
  }

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
    const victimUnit = world.liveEnemies().find((e) => e.x === lx && e.z === lz);
    const victimMember = members.find((m) => m.sheet.hp > 0 && m.actor
      && m.actor.x === lx && m.actor.z === lz);
    const dmg = rand(t.damage[0], t.damage[1]);
    if (victimUnit) {
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
        // the same code.
        const blocked = blockedBy(victimUnit, 'stunned');
        if (applyStatus(victimUnit, 'stunned')) {
          statusFxAt(victimUnit, 'stunned');
          msg += ' They go down under it.';
        } else if (blocked) msg += ` ${immunityLine(blocked, victimUnit.def.name)}`;
      } else {
        callbacks.onEnemyKilled(victimUnit);
      }
    } else if (victimMember) {
      const dead = applyDamage(victimMember.sheet, dmg);
      hitFx(victimMember, 'slam', by);
      victimMember.actor.flinch();
      fx.damageText(lx, lz, `-${dmg}`, undefined, { big: dead });
      msg += ` It lands on ${victimMember.sheet.name}. -${dmg}.`;
      if (!dead) {
        applyStatus(victimMember.sheet, 'stunned', {}, statusResist(victimMember.sheet));
        statusFxAt(victimMember, 'stunned');
      } else {
        notifyMemberDown();
      }
    }
    return msg;
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
  function zoneCells(a, tx, tz) {
    const out = [];
    for (const [x, z] of zoneTiles(tx, tz, zoneRadiusOf(a))) {
      // The same question leaveSurface asks itself, asked without painting -
      // so the rings, the cursor's count and the click all agree about which
      // tiles will take it.
      if (!world.canTakeSurface(x, z)) continue;
      if (!world.hasLos(active.actor.x, active.actor.z, x, z)) continue;
      // Nobody gets a surface dropped on their feet - not a coworker, not a
      // teammate, not you. The cone already refused to carpet a member's tile;
      // this extends the same courtesy to everyone, because a zone is aimed
      // deliberately and "I did not mean to stand in that" is the cone's
      // problem, not this verb's.
      if (members.some((m) => m.sheet.hp > 0 && m.actor?.x === x && m.actor?.z === z)) continue;
      if (world.liveEnemies().some((e) => e.x === x && e.z === z)) continue;
      out.push([x, z]);
    }
    return out;
  }

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
    if (!engaged.some((e) => e.alive)) victory();
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
    if (!engaged.some((e) => e.alive)) victory();
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
    if (a.cone) { fireCone(en.x, en.z); return; }
    // Placing a summon on top of a coworker: the tile is taken, so they report
    // to the free ground ringing outward from it. Aiming at the enemy you want
    // them to swarm is a reasonable thing to click.
    if (a.type === 'summon') { placeSummon(en.x, en.z); return; }
    // Aiming a zone at a coworker is a reasonable thing to click - you want it
    // under THEM - so it resolves on their tile rather than refusing. Their own
    // tile is excluded from the footprint (zoneCells), so what lands is the
    // ring around their feet.
    if (isZone(a)) { performZone(armed, en.x, en.z); return; }
    // A RANGED control (a cone, or one carrying `range`) resolves from where
    // you stand. A touch-range one deliberately falls through to the melee
    // walk-up below rather than getting its own copy of it - Detain refusing
    // "too far" would make it the one arm's-length action in the game that
    // will not approach, and `strike` is what makes the arrival resolve as a
    // control instead of a swing.
    if (isControl(a) && controlIsRanged(a)) { performControl(armed, en); return; }
    if (a.type === 'shove') {
      if (!canReach(active, en, REACH.SHOVE)) { refuse('Too far to shove.'); return; }
      if (active.ap < a.ap) { refuse('Not enough AP.'); return; }
      joinCombat(en); // shoving a bystander is also an opinion they'll return
      active.ap -= a.ap;
      active.actor.lunge(en.x, en.z);
      faceTarget(active, en.x, en.z);
      log(displaceBody(en, Math.sign(en.x - active.actor.x), Math.sign(en.z - active.actor.z)).msg);
      armed = null;
      refresh();
      if (!engaged.some((e) => e.alive)) victory();
      return;
    }
    if (a.ammoCost) {
      // ranged: needs range, line of sight, ammo, AP
      if (cheb(active.actor.x, active.actor.z, en.x, en.z) > THROW_RANGE) { refuse('Too far to throw.'); return; }
      if (!world.hasLos(active.actor.x, active.actor.z, en.x, en.z)) { refuse('No clear line to throw.'); return; }
      if (active.sheet.paper < ammoCostOf(armed)) { refuse('Out of paper.'); return; }
      if (active.ap < a.ap) { refuse('Not enough AP.'); return; }
      active.actor.faceToward(en.x, en.z);
      performOn(armed, en);
      return;
    }
    // melee: walk up if needed, then strike
    if (canReach(active, en)) {
      if (active.ap < a.ap) { refuse('Not enough AP to attack.'); return; }
      active.actor.faceToward(en.x, en.z);
      strike(armed, en);
      return;
    }
    // walk the cheapest route to their side, as far as the budget allows
    let best = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const gx = en.x + dx;
      const gz = en.z + dz;
      // Already STANDING on a goal tile - out of reach only because the body
      // rests on its far side - means the "route" is a shuffle inside this
      // tile; the approach point below closes the last half-tile to their
      // body. findPath returns the one-tile path [[gx,gz]] here, and its
      // length of 1 used to win the shortest-path contest and then fail the
      // >= 2 check: the player CLOSEST to the target was the one told there
      // was no way to reach them.
      if (gx === active.actor.x && gz === active.actor.z) { best = [[gx, gz], [gx, gz]]; break; }
      const p = world.findPath(active.actor.x, active.actor.z, gx, gz, active.actor);
      if (p && p.length >= 2 && (!best || p.length < best.length)) best = p;
    }
    if (!best || best.length < 2) { refuse('No way to reach them.'); return; }
    // walk up to their body, not the centre of the neighbouring tile.
    // The budget is the SAME one an ordinary move spends - allowance first,
    // then real AP (`moveBudget`) - minus the swing this walk is for. Billing
    // the walk against bare `ap` ignored the free movement allowance entirely,
    // so a character wearing it stopped short of a target they could plainly
    // afford to reach and stood there instead of hitting anyone.
    const [gx, gz] = best[best.length - 1];
    const ep = en.entity ? en.entity.getPosition() : { x: en.x, z: en.z };
    const walk = walkActive(best, moveBudget(active) - a.ap, world.approach(gx, gz, ep.x, ep.z));
    if (!walk) { refuse('Not enough AP to reach them.'); return; }
    // The walk's endpoint is already a free point, so this asks the honest
    // question directly instead of rounding it back to a tile first: will we
    // be standing inside reach when the walk finishes?
    const endPos = posOf(en);
    if (inReach(walk.end[0], walk.end[1], endPos.x, endPos.z, reachOfUnit(active))) {
      pendingMelee = { en, action: armed }; // strike on arrival
    } else {
      armed = null;
      log('You close the distance.');
      refresh();
    }
  }

  // Smooth a raw tile route and walk the ACTIVE member along it, charging by
  // DISTANCE (stepCost per tile-length) and stopping mid-segment - at any
  // free point - when `budget` runs out. Optionally swap the final waypoint
  // for a precise clicked point. Spends their AP. Returns { done, end } or
  // null if nothing was walkable.
  function walkActive(rawPath, budget, endPoint = null) {
    if (endPoint) rawPath = [...rawPath.slice(0, -1), endPoint];
    const s = world.smooth(rawPath, active.actor);
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
        active.ap -= a.ap;
        const hadBleed = hasStatus(active.sheet, 'bleed');
        clearStatuses(active.sheet);  // reboot wipes every status - Deflect, bleed, gum
        armed = null;
        log(hadBleed
          ? 'You turn yourself off and on again. The bleeding stops. So does everything else.'
          : 'You turn yourself off and on again. All effects cleared. Classic fix.');
        refresh();
        return;
      }
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
          if (!engaged.some((e) => e.alive)) victory();
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
      }
      // Aiming: a left click NEVER cancels. Missing the target used to lower
      // the action (and, with a cone out of AP, could strand you unable to do
      // either) - so say what went wrong and stay armed. Right-click cancels.
      log('Invalid target.');
      return;
    }
    if (!world.isWalkable(tile.x, tile.z)) return;
    pendingMelee = null;
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
    if (a.ammoCost) out.push(`Costs ${ammoCostOf(id)} paper (you have ${active.sheet.paper})`);
    if (a.uses) out.push(`${active.usesLeft[id]} of ${a.uses} uses left this fight`);
    if (a.applies) out.push(`Applies ${STATUSES[a.applies]?.name || a.applies}`);
    if (a.purge) out.push('Clears every status - the good ones too');
    // The one line that says which HALF of the board a verb points at. Without
    // it a buff is indistinguishable from an attack on the bar, and the first
    // thing a player does with an unlabelled armed action is click an enemy.
    if (isFriendly(a)) out.push(`Aim at a teammate or yourself - range ${buffRangeOf(a)}, never misses`);
    if (isControl(a)) out.push('No damage - it takes their turn or their ground, not their HP');
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

  function onActionButton(id, b) {
    if (phase !== 'player') return;
    const a = ACTIONS[id];
    // Lowering an armed action must ALWAYS work, even once its button has gone
    // unaffordable: spending your AP while a cone was armed used to disable the
    // only control that could unarm it, stranding you (the button is disabled,
    // and a ground click just re-tried the cone).
    if (armed === id) {
      cancelArmed();
      refresh();
      return;
    }
    if (b.disabled) return;
    // Reaching for ANY other action drops whatever was awaiting confirmation -
    // a pending confirm shouldn't survive in the background while you arm
    // something else and spend the AP it was priced against.
    const wasPending = pendingConfirm;
    pendingConfirm = null;
    if (a.type === 'attack' || a.type === 'shove' || a.type === 'summon'
      || isFriendly(a) || isControl(a) || isZone(a) || isMobility(a)) {
      armed = id; // arm it; clicking a ringed target (or a spot) fires it
      hidePreview(); // aiming now - the movement trail yields to targets
      log(a.type === 'summon'
        ? `${a.label} armed. Click where they should report.`
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
      applyStatus(active.sheet, 'watching');
      statusFxAt(active, 'watching');
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
  const summonRange = (a) => a.range ?? 5;
  // Why a spot is unusable, or null when it's good. Shared by the click and the
  // hover preview so the ring you see is the rule that runs.
  function summonSpotProblem(a, tx, tz) {
    if (active.ap < a.ap) return 'Not enough AP.';
    if (a.uses && active.usesLeft[armed] <= 0) return 'No postings left this fight.';
    if (cheb(active.actor.x, active.actor.z, tx, tz) > summonRange(a)) return 'Too far - post it closer.';
    if (!world.hasLos(active.actor.x, active.actor.z, tx, tz)) return 'No clear line to that spot.';
    if (!world.summonSpots(tx, tz, 1).length) return 'No room for anyone to stand there.';
    return null;
  }
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
    log(`${a.log} ${n} report${n === 1 ? 's' : ''} for duty.`);
    armed = null;
    aimPoint = null;
    refresh();
  }
  // End Turn ends the ACTING unit's turn and initiative moves on - the next
  // slot may be a teammate, a summon you're driving, or an enemy. (It used to
  // queue through the party side before per-unit initiative replaced the
  // two-phase spine.)
  endBtn.onclick = () => {
    if (phase !== 'player') return;
    advanceTurn();
  };

  // --- what the turn engine asks this file ------------------------------------
  // turn-order.js owns the walk: advance, wrap into a round, skip anyone who
  // cannot act, spend a temp's contract, tick the turn clock. These are the
  // combat-side answers it calls out for - the ones that need a body, a panel
  // or the app, and so could never live in a pure module.

  // Somebody's turn opens for real: hand a member control (full AP and their
  // movement allowance), or arm the AI's working state for a unit.
  function takeTurn(s) {
    if (s.member) {
      makeActive(s.member);
      s.member.ap = s.member.sheet.maxAp; // full AP at the top of your turn
      s.member.freeAp = freeMoveOf(s.member); // and the movement allowance, if any
      phase = 'player';
      const solo = members.length === 1;
      log(solo ? 'Your turn.' : `${s.member.sheet.name}'s turn.`);
      refresh();
      return;
    }
    phase = 'ai';
    acting = { unit: s.unit, ap: s.unit.combat.ap, freeAp: freeMoveOf(s.unit), wait: 0.5 };
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
    log(`${slotName(s)}'s assignment ends. They gather their things and go.`);
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
    let best = standTilePath(unit, target);
    const pp = posOf(target);
    // Nowhere better to stand, but the tile is already the right one and only
    // the sub-tile position is wrong. Now that reach is a DISTANCE, one tile
    // can hold both a spot inside reach and a spot outside it, so close the
    // last of the gap in place instead of burning the turn. Without this an AI
    // hemmed into the single adjacent tile of a corridor can never get in
    // range, ends every turn having done nothing, and the fight never resolves.
    if (!best) {
      if (cheb(unit.x, unit.z, target.actor.x, target.actor.z) > 1) return 0;
      const here = posOf(unit);
      const step = world.approach(unit.x, unit.z, pp.x, pp.z);
      if (dist(here.x, here.z, step[0], step[1]) < 0.05) return 0; // as close as this tile allows
      // And only if shuffling would actually earn a swing. A partition between
      // the two bodies isn't a distance problem, so closing the gap can't solve
      // it - spending AP to end up equally unable to swing is the same stall
      // wearing a different hat.
      if (!inReach(step[0], step[1], pp.x, pp.z, reachOfUnit(unit), world.stepOpen)) return 0;
      best = [[here.x, here.z], step];
    } else {
      // Stand at reach of the target's BODY, not the middle of the adjacent
      // tile (the point stays inside that tile, so adjacency still holds).
      const [gx, gz] = best[best.length - 1];
      best[best.length - 1] = world.approach(gx, gz, pp.x, pp.z);
    }
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
        if (unit.alive && !statusFx(unit).slipProof && Math.random() < (world.slipChanceAt(x, z) || 0)) {
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
    drawPreview(); // immediate-mode lines last one frame - redraw while shown
    drawTargets();
    // prune anyone killed externally (printer explosions during combat)
    if (!engaged.some((e) => e.alive)) { victory(); return; }
    if (phase === 'player') {
      // finish a queued walk-up strike
      if (pendingMelee && !active.actor.moving) {
        const { en, action } = pendingMelee;
        pendingMelee = null;
        if (en.alive && canReach(active, en)
          && active.ap >= ACTIONS[action].ap) {
          active.actor.faceToward(en.x, en.z);
          strike(action, en);
        } else {
          armed = null;
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
    const sm = unit.def.summon;
    if (sm && (unit.summonCd || 0) <= 0 && acting.ap >= sm.ap
      && resolveSummon(unit, 'enemy', sm) > 0) {
      unit.summonCd = sm.cooldownRounds || 0;
      acting.ap = roundAp(acting.ap - sm.ap);
      unit.lunge(target.actor.x, target.actor.z);
      log(sm.log || `${unit.def.name} calls in reinforcements.`);
      acting.wait = 0.6;
      refresh();
      return;
    }
    if (canReach(unit, target) && unit.combat.attacks.length && acting.ap >= unit.combat.attackAp) {
      aiAttack(unit, target);
      acting.ap -= unit.combat.attackAp;
      acting.wait = 0.85; // outlast the swing animation so hits read one at a time
    } else if (moveBudget(acting) >= MOVE.COST_PER_TILE
      && !canReach(unit, target)) {
      const spent = aiAdvance(unit, moveBudget(acting), target);
      // Nothing walkable: burn the real AP so the turn can end, but never the
      // allowance - it cannot buy anything else, so leaving it is harmless.
      if (spent <= 0) acting.ap = 0;
      else billMove(acting, spent);
      acting.wait = 0.15;
    } else {
      advanceTurn(); // out of AP / nothing to do - next in initiative
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
    // The movement allowance left this turn (MOVEMENT_PLAN M2). 0 for a
    // character without the talent.
    get freeAp() { return active.freeAp || 0; },
    set ap(v) { active.ap = Math.max(0, roundAp(Number(v) || 0)); refresh(); },
    get armed() { return armed; },
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
      refresh();
      return ok;
    },
    // The initiative order, top to bottom, with whose turn it is - for the
    // tracker UI and the e2e suite.
    get order() {
      return turns.order.map((s, i) => ({
        name: slotName(s), team: s.team, init: s.init,
        member: !!s.member, current: i === turns.index, alive: slotAlive(s),
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
    beginTurn();
    if (phase === 'player') {
      armed = opening.actionId;
      refresh();
      handleEnemyClick(opening.target);
    }
  } else {
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
    notifyMemberDown,
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
