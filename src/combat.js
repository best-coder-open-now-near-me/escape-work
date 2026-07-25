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
import { SURFACES, GUM } from './data/surfaces.js';
import { truncateByBudget } from './pathfinding.js';
import { damageBonus, applyDamage, deflect, statusResist, hitChance, rollHit, accuracy, dodge, equippedAction, weaponProc } from './stats.js';
import { applyStatus, hasStatus, statusFx, tickTurn, clearStatuses, removeStatus, statusList } from './statuses.js';
import { toHitTerms, provokedBy, positionMods, TACTICS } from './tactics.js';
import { STATUSES } from './data/statuses.js';
import { PANEL_CHROME, BUTTON_CHROME } from './ui.js';
import { buildInitiativeOrder, rollInitiative, insertionIndex } from './initiative.js';

const pc = window.pc;
const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const cheb = (ax, az, bx, bz) => Math.max(Math.abs(ax - bx), Math.abs(az - bz));
// Radius of a target's ring marker. Cone tests use it so a body counts when
// the wedge CLIPS it, matching what the ring shows.
const TARGET_R = 0.5;
const THROW_RANGE = 5;
const SURPRISE_RADIUS = 2; // engaged from beyond this = loses the first turn

// The narration when a landed hit applies a status: an explicit per-attack/
// action line if given, else the status's own {name}-templated log, else a
// bare fallback naming it.
const appliesLine = (src, name) => {
  if (src.appliesLog) return src.appliesLog;
  const def = STATUSES[src.applies];
  return def?.log ? def.log.replace('{name}', name) : `${def?.name || 'A status'} sets in.`;
};

export function startCombat({ app, party, engaged, world, fx, callbacks, opening = null, rng = Math.random }) {
  // Per-member turn state: every party member fights with their own AP pool,
  // deflect stance and limited-use counters. `active` is whose action bar,
  // previews and clicks are live - with one member that is simply "you";
  // switching mid-fight arrives with the party bar.
  const members = party.members.map((m) => {
    const usesLeft = {};
    for (const id of m.sheet.actions) if (ACTIONS[id].uses) usesLeft[id] = ACTIONS[id].uses;
    // `done` marks a member End Turn has passed - it gates the auto-advance,
    // never the member (switch back manually and they can still act).
    return { sheet: m.sheet, actor: m.actor, ap: m.sheet.maxAp, done: false, usesLeft };
  });
  let active = members[party.active];
  // Everyone you control: party members plus any summons you've conjured
  // (temporary members, appended by resolveSummon). `livingParty` is the real
  // roster only - a party WIPE (no real member standing) is the sole game-over;
  // a summon falling never is, and a lone summon can't stave off defeat.
  const livingMembers = () => members.filter((m) => m.sheet.hp > 0 && m.actor);
  const livingParty = () => members.filter((m) => m.sheet.hp > 0 && m.actor && !m.isSummon);
  // The AI enemies hunt the whole player side - members and summons alike, all
  // members now. A target wraps { actor, member }; combat reads `member` to take
  // the hit on its sheet (deflect, gum, the downed rules).
  function pickTarget(unit) {
    let best = null;
    for (const m of livingMembers()) {
      const d = cheb(unit.x, unit.z, m.actor.x, m.actor.z);
      if (!best || d < best.d || (d === best.d && m.sheet.hp < best.m.sheet.hp)) best = { m, d };
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
  const ammoCostOf = (id) => {
    const base = ACTIONS[id].ammoCost || 0;
    return base > 1 ? Math.max(1, base - (talentFxOf(active).paperAmmoDiscount || 0)) : base;
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
  const accuracyOf = (u) => (u.sheet ? accuracy(u.sheet) : (u.def?.accuracy || 0));
  const dodgeOf = (u) => (u.sheet ? dodge(u.sheet) : (u.def?.dodge || 0));
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
  // The chance `attacker` lands on `defender` right now - what the hover tag
  // reads. Never rolls, never pins; purely the number.
  const chanceFor = (attacker, defender) => {
    const t = attackMods(attacker, defender);
    return hitChance(t.acc, t.dodge, t.mods);
  };
  // Roll that attack (honors the forceHit pin, records lastRoll).
  const rollAgainst = (attacker, defender) => {
    const t = attackMods(attacker, defender);
    return resolveHit(t.acc, t.dodge, t.mods);
  };
  // A weapon's on-hit proc chance, honoring the debug pin.
  const resolveProc = (chance) => (forceProc !== null ? forceProc : rollHit(chance, rng));
  const MISS_COLOR = '#b8c0d0';
  // Movement cost per unit distance, derived from the surface's `slow`
  // multiplier (0.5 => twice the AP) - one number in data drives both walk
  // speed and AP pricing, for everyone. Gum on a shoe surcharges every step;
  // a member's gum lives on their sheet, an AI unit's on the actor (see
  // aiAdvance).
  const surfaceStepCost = (x, z) => {
    const slow = SURFACES[world.surfaceIdAt(x, z)]?.slow;
    return slow ? 1 / slow : 1;
  };
  const stepCost = (x, z) => surfaceStepCost(x, z) * (statusFx(active.sheet).moveCostMult ?? 1);
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
  // Self-cast actions that used to fire on the first button press. They now
  // take a confirm click, so a stray click can't spend a turn's AP.
  const INSTANT_CONFIRM = new Set(['defend', 'heal', 'summon']);
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
  // (an AI actor - enemy or player-team summon). buildInitiativeOrder rolls
  // d20 + `initMod` and sorts; `turnPtr` is whose turn it is.
  const initRng = () => Math.random();
  const memberSlot = (m) => ({ member: m, team: 'player', initMod: m.sheet.attr?.hustle ?? 0 });
  // AI-driven units are always enemy-side; player-side summons are members
  // (memberSlot), never units.
  const unitSlot = (u) => ({ unit: u, team: 'enemy', initMod: u.def.ap || 0 });
  const slotActor = (s) => (s.member ? s.member.actor : s.unit);
  const slotAlive = (s) => (s.member ? s.member.sheet.hp > 0 && !!s.member.actor : !!s.unit.alive);
  const slotName = (s) => (s.member ? s.member.sheet.name : s.unit.def.name);
  let order = buildInitiativeOrder(
    [...members.map(memberSlot), ...engaged.filter((e) => e.alive).map(unitSlot)],
    initRng,
  );
  let turnPtr = 0;
  // Splice a fresh combatant (pulled-in bystander, summon) into the order by
  // its roll, keeping the current unit current.
  function insertSlot(slot) {
    slot.init = rollInitiative(slot.initMod, initRng);
    const idx = insertionIndex(order, slot.init);
    order.splice(idx, 0, slot);
    if (idx <= turnPtr) turnPtr += 1;
  }

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
  let preview = null; // { reach: [[x,z],...], tail: [[x,z],...] | null }
  let aimPoint = null; // hover point while a cone attack is armed
  let hoverHitChance = null; // to-hit chance shown for the enemy under an armed cursor

  function hidePreview() {
    preview = null;
    hoverHitChance = null;
    costTag.style.display = 'none';
  }

  // The live enemy under a hover point, if any (within a tile's reach of it).
  function enemyAtPoint(point) {
    let best = null;
    for (const en of world.liveEnemies()) {
      if (!en.entity) continue;
      const d = Math.hypot(en.x - point.x, en.z - point.z);
      if (d < 0.7 && (!best || d < best.d)) best = { en, d };
    }
    return best?.en || null;
  }

  // While a single-target attack is armed, the cost tag shows the to-hit chance
  // for the enemy under the cursor - the rings show range/validity, this shows
  // the odds (DOS2's most load-bearing bit of UI). A cone's wedge is its own
  // feedback and a shove auto-hits, so neither shows a percentage.
  function showHitPreview(point, sx, sy) {
    hoverHitChance = null;
    const a = ACTIONS[armed];
    if (!a || a.type !== 'attack' || a.cone) { costTag.style.display = 'none'; return; }
    const en = enemyAtPoint(point);
    if (!en) { costTag.style.display = 'none'; return; }
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

  function handleHover(point, sx, sy) {
    // While aiming, target rings replace the movement trail entirely.
    // Cone attacks additionally track the cursor - the wedge follows it.
    if (armed && ACTIONS[armed].cone) aimPoint = point;
    if (phase !== 'player' || active.actor.moving || !point) { hidePreview(); return; }
    // Armed: the movement trail yields to the to-hit readout over a target.
    if (armed) { showHitPreview(point, sx, sy); return; }
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
    const { points, cost, done, tail } = truncateByBudget(s, active.ap, stepCost);
    preview = { reach: points, tail };
    costTag.textContent = done ? `${fmtAp(cost)} AP` : `${fmtAp(cost)} AP - out of reach`;
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
    if (phase !== 'player' || !armed) return;
    const a = ACTIONS[armed];
    if (a.type !== 'attack' && a.type !== 'shove') return;
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
    for (const en of world.liveEnemies()) {
      if (!en.entity) continue;
      let ok;
      if (a.type === 'shove') {
        ok = cheb(active.actor.x, active.actor.z, en.x, en.z) <= 1 && active.ap >= a.ap;
      } else if (a.ammoCost) {
        ok = cheb(active.actor.x, active.actor.z, en.x, en.z) <= THROW_RANGE
          && world.hasLos(active.actor.x, active.actor.z, en.x, en.z)
          && active.sheet.paper >= ammoCostOf(armed) && active.ap >= a.ap;
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
  function buildActionBar() {
    actionsRow.innerHTML = '';
    buttons = [];
    for (const id of actionIdsOf(active)) {
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
    el('combat-ap').textContent = 'AP ' + '●'.repeat(full) + (half ? '◐' : '')
      + '○'.repeat(Math.max(0, active.sheet.maxAp - full - half)) + ` ${fmtAp(active.ap)}`;
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
      order.map((s, i) => {
        const cur = i === turnPtr;
        const carrier = s.member ? s.member.sheet : s.unit;
        const hp = s.member
          ? `${Math.max(0, s.member.sheet.hp)}/${s.member.sheet.maxHp}`
          : `${Math.max(0, s.unit.hp)}/${s.unit.maxHp}`;
        const dead = !slotAlive(s);
        const col = s.team === 'player' ? '#8adf76' : '#ffb3a0';
        // Live status icons trail the row - the at-a-glance read of who's
        // stunned, burning, deflecting, gummed.
        const icons = dead ? '' : statusList(carrier).map((st) => st.icon).join('');
        return `<div style="opacity:${dead ? '.4' : '.95'}; color:${col};`
          + `font-weight:${cur ? '700' : '400'};">`
          + `${cur ? '▸ ' : '&nbsp;&nbsp;'}${slotName(s)} &middot; ${dead ? '—' : hp}`
          + ` <span style="opacity:.6">(${s.init})</span>`
          + (icons ? ` ${icons}` : '') + `</div>`;
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
    joinCombat(en); // attacking a bystander drags them into the fight
    // Spend the cost first: a miss still burns the AP and the paper (HIT_PLAN
    // #4). The projectile/lunge also fires either way - the swing happened, it
    // just may not land.
    if (a.ammoCost) {
      active.sheet.paper -= ammoCostOf(id);
      fx.projectile({ x: active.actor.x, z: active.actor.z }, { x: en.x, z: en.z },
        id === 'paper-airplane' ? 'plane' : 'ball');
    } else {
      active.actor.lunge(en.x, en.z);
    }
    faceTarget(active, en.x, en.z); // you face what you swing at
    active.ap -= a.ap;
    // The attack roll: a miss spends the cost above and does nothing else - no
    // damage, no purge, no rider. Surprise, the attacker's accMod, the
    // target's dodgeMod (and later, position) are assembled by attackMods.
    if (!rollAgainst(active, en)) {
      fx.damageText(en.x, en.z, 'MISS', MISS_COLOR);
      log(a.missLog || `${a.log} It misses.`);
      armed = null;
      refresh();
      return;
    }
    let dmg = rand(a.min, a.max) + damageBonus(active.sheet); // carried staplers count
    if (a.ammoCost) dmg += talentFxOf(active).paperDamageBonus || 0;
    const died = en.takeDamage(dmg);
    fx.damageText(en.x, en.z, `-${dmg}`, '#ffd76b');
    let line = `${a.log} ${dmg} damage!`;
    // A purge (reboot) wipes the target's statuses - good and bad alike.
    if (a.purge && !died) {
      const woke = hasStatus(en, 'surprised');
      clearStatuses(en);
      if (woke) line += ' Their surprise is power-cycled away.';
    }
    // A status the action carries lands on a live target (enemies have no
    // Composure, so no resist). This is the player-action `applies` vector.
    if (a.applies && !died && applyStatus(en, a.applies)) {
      line += ` ${appliesLine(a, en.def.name)}`;
    }
    // The equipped weapon's on-hit proc - but only when this attack IS that
    // weapon's own swing (swing the gum stapler, fling gum).
    const proc = weaponProc(active.sheet);
    if (proc && !died && id === equippedAction(active.sheet)
      && resolveProc(proc.chance) && applyStatus(en, proc.applies)) {
      line += ` ${appliesLine(proc, en.def.name)}`;
    }
    log(line);
    if (died) callbacks.onEnemyKilled(en);
    armed = null; // back to movement mode after the swing
    refresh();
    if (!engaged.some((e) => e.alive)) victory();
  }

  // Fire an armed cone attack toward (tx, tz): per-target damage rolls for
  // every enemy in the wedge with line of sight, then the wedge's plain floor
  // is carpeted with the action's `leaves` surface.
  function fireCone(tx, tz) {
    const a = ACTIONS[armed];
    if (active.ap < a.ap) { log('Not enough AP.'); return; }
    const test = coneTest(a, tx, tz);
    if (!test) { log('Aim somewhere.'); return; }
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
        fx.damageText(en.x, en.z, 'MISS', MISS_COLOR);
        continue;
      }
      const dmg = rand(a.min, a.max) + damageBonus(active.sheet);
      const died = en.takeDamage(dmg);
      fx.damageText(en.x, en.z, `-${dmg}`, '#ffd76b');
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
          world.leaveSurface(x, z, a.leaves);
        }
      }
    }
    log(hits
      ? `${a.log} ${hits} hit${hits > 1 ? 's' : ''}. The paperwork settles everywhere.`
      : `${a.log} No casualties. Plenty of litter.`);
    armed = null;
    aimPoint = null;
    refresh();
    if (!engaged.some((e) => e.alive)) victory();
  }

  function handleEnemyClick(en) {
    if (phase !== 'player' || active.actor.moving || !en.alive) return;
    hidePreview();
    if (!armed) { log('Choose an action first, then a target.'); return; }
    const a = ACTIONS[armed];
    if (a.cone) { fireCone(en.x, en.z); return; }
    if (a.type === 'shove') {
      if (cheb(active.actor.x, active.actor.z, en.x, en.z) > 1) { log('Too far to shove.'); return; }
      if (active.ap < a.ap) { log('Not enough AP.'); return; }
      joinCombat(en); // shoving a bystander is also an opinion they'll return
      const dx = Math.sign(en.x - active.actor.x);
      const dz = Math.sign(en.z - active.actor.z);
      const tx = en.x + dx;
      const tz = en.z + dz;
      active.ap -= a.ap;
      active.actor.lunge(en.x, en.z);
      faceTarget(active, en.x, en.z);
      // A partition between the tiles counts as "something solid" too.
      if (!world.isWalkable(tx, tz) || !world.stepOpen(en.x, en.z, tx, tz)) {
        const died = en.takeDamage(2);
        fx.damageText(en.x, en.z, '-2', '#ffd76b');
        // A slam into a wall knocks the wind out of them - stunned (they lose
        // their next turn). The knockdown DOS2 shoves are for.
        let msg = `You shove ${en.def.name} into something solid. -2.`;
        if (!died && applyStatus(en, 'stunned')) msg += ' They crumple - dazed.';
        log(msg);
        if (died) callbacks.onEnemyKilled(en);
      } else {
        en.pushTo(tx, tz);
        const dmg = world.enemySurfDamage(tx, tz);
        if (dmg > 0) {
          const live = world.isElectrified && world.isElectrified(tx, tz);
          const surf = world.surfaceIdAt(tx, tz);
          const died = en.takeDamage(dmg);
          fx.damageText(tx, tz, `-${dmg}`, '#ffd76b');
          log(`You shove ${en.def.name} into the ${live ? 'LIVE water' : surf || 'hazard'}! -${dmg}.`);
          if (died) callbacks.onEnemyKilled(en);
        } else {
          log(`You shove ${en.def.name} back a step.`);
        }
      }
      armed = null;
      refresh();
      if (!engaged.some((e) => e.alive)) victory();
      return;
    }
    if (a.ammoCost) {
      // ranged: needs range, line of sight, ammo, AP
      if (cheb(active.actor.x, active.actor.z, en.x, en.z) > THROW_RANGE) { log('Too far to throw.'); return; }
      if (!world.hasLos(active.actor.x, active.actor.z, en.x, en.z)) { log('No clear line to throw.'); return; }
      if (active.sheet.paper < ammoCostOf(armed)) { log('Out of paper.'); return; }
      if (active.ap < a.ap) { log('Not enough AP.'); return; }
      active.actor.faceToward(en.x, en.z);
      performOn(armed, en);
      return;
    }
    // melee: walk up if needed, then strike
    if (cheb(active.actor.x, active.actor.z, en.x, en.z) <= 1) {
      if (active.ap < a.ap) { log('Not enough AP to attack.'); return; }
      active.actor.faceToward(en.x, en.z);
      performOn(armed, en);
      return;
    }
    // walk the cheapest route to their side, as far as AP allows
    let best = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const p = world.findPath(active.actor.x, active.actor.z, en.x + dx, en.z + dz, active.actor);
      if (p && (!best || p.length < best.length)) best = p;
    }
    if (!best || best.length < 2) { log('No way to reach them.'); return; }
    // walk up to their body, not the centre of the neighbouring tile
    const [gx, gz] = best[best.length - 1];
    const ep = en.entity ? en.entity.getPosition() : { x: en.x, z: en.z };
    const walk = walkActive(best, active.ap - a.ap, world.approach(gx, gz, ep.x, ep.z));
    if (!walk) { log('Not enough AP to reach them.'); return; }
    if (cheb(Math.round(walk.end[0]), Math.round(walk.end[1]), en.x, en.z) <= 1) {
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
    beginMove(active); // a deliberate move - leaving reach can provoke
    active.actor.setPath(points);
    active.ap = Math.max(0, roundAp(active.ap - cost));
    refresh();
    return { done, end: points[points.length - 1] };
  }

  function handleTileClick(tile, point = null) {
    if (phase !== 'player' || active.actor.moving || !tile) return;
    if (armed) {
      const a = ACTIONS[armed];
      // Cones fire at wherever you click - ground included.
      if (a.cone && point) { fireCone(point.x, point.z); return; }
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
      walkActive([[pos.x, pos.z], world.clampPoint(point.x, point.z)], active.ap);
      return;
    }
    const p = world.findPath(active.actor.x, active.actor.z, tile.x, tile.z, active.actor);
    if (!p || p.length < 2) return;
    walkActive(p, active.ap, point ? world.clampPoint(point.x, point.z) : null);
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
    if (a.type === 'attack' || a.type === 'shove') {
      armed = id; // arm it; clicking a ringed target fires it
      hidePreview(); // aiming now - the movement trail yields to targets
      log(`${a.label} armed. Click a target.`);
      refresh();
    } else if (INSTANT_CONFIRM.has(a.type)) {
      // Instant self-actions (Deflect, a heal, Post the Role) used to fire the
      // moment you touched the button - easy to spend a turn's AP by accident.
      // First press ARMS it, second press commits (right-click, or the button
      // again, backs out). Targeted actions already worked this way.
      if (pendingConfirm !== id) {
        pendingConfirm = id;
        log(`${a.label} - click again to confirm.`);
        refresh();
        return;
      }
      pendingConfirm = null;
      commitInstant(id, a);
    }
  }

  // The self-cast actions, once confirmed.
  function commitInstant(id, a) {
    if (a.type === 'defend') {
      if (hasStatus(active.sheet, 'deflecting')) { log('You are already deflecting. Save the AP.'); return; }
      active.ap -= a.ap;
      applyStatus(active.sheet, 'deflecting');
      log(a.log);
      refresh();
    } else if (a.type === 'heal') {
      if (a.uses && active.usesLeft[id] <= 0) return;
      if (active.sheet.hp >= active.sheet.maxHp) { log('Already at full health. Savor it.'); return; }
      if (a.uses) active.usesLeft[id] -= 1;
      active.ap -= a.ap;
      active.sheet.hp = Math.min(active.sheet.maxHp, active.sheet.hp + a.amount);
      fx.damageText(active.actor.x, active.actor.z, `+${a.amount}`, '#8adf76');
      log(a.log);
      refresh();
    } else if (a.type === 'summon') {
      // Post the role: applicants report for duty on your side, up to the
      // action's live cap. Instant, like heal/defend - no target to pick.
      if (a.uses && active.usesLeft[id] <= 0) return;
      const n = resolveSummon(active.actor, 'player', a);
      if (n <= 0) { log('No room - the applicants can\'t find a free desk.'); return; }
      if (a.uses) active.usesLeft[id] -= 1;
      active.ap -= a.ap;
      active.actor.lunge();
      log(`${a.log} ${n} report${n === 1 ? 's' : ''} for duty.`);
      refresh();
    }
  }
  // End Turn queues through the party: it ends the ACTIVE member's turn and
  // hands the floor to the next member who hasn't ended theirs - only the
  // last hand-off gives the round to the enemies. One member = the old
  // button exactly.
  endBtn.onclick = () => {
    if (phase !== 'player') return;
    advanceTurn();
  };

  // --- the turn order driver ---------------------------------------------------
  // One combatant acts at a time, in initiative order. advanceTurn moves to the
  // next slot (wrapping to a fresh round); beginTurn sets up whoever's up -
  // handing control to you for a member, or arming the AI's working state for a
  // unit. Dead/downed slots are skipped; a surprised unit burns its turn.
  function advanceTurn() {
    armed = null;
    pendingConfirm = null;
    pendingMelee = null;
    hidePreview();
    turnPtr += 1;
    if (turnPtr >= order.length) { newRound(); return; }
    beginTurn();
  }
  function newRound() {
    turnPtr = 0;
    // A full pass through the order is one round: age summoner cooldowns and
    // the fire/smoke lifecycle a tick.
    for (const e of engaged) if (e.summonCd > 0) e.summonCd -= 1;
    reactions.clear(); // everyone gets their reaction back (TACTICS_PLAN M2)
    callbacks.onRound?.();
    beginTurn();
  }
  function beginTurn() {
    // The fight can end on the boundary (a kill emptied one side).
    if (!engaged.some((e) => e.alive)) { victory(); return; }
    if (!livingParty().length) { defeat(); return; }
    const s = order[turnPtr];
    if (!slotAlive(s)) { advanceTurn(); return; } // a corpse/downed slot - skip
    const carrier = s.member ? s.member.sheet : s.unit;
    // Read incapacitation BEFORE ticking (the tick expires a 1-turn stun/
    // surprise): a skipTurn status costs the owner this turn.
    const skip = !!statusFx(carrier).skipTurn;
    const skipLine = skip ? skipTurnLine(s, carrier) : null;
    // Turn-clock statuses tick at the top of the owner's turn: a dot (burning)
    // bites, and every duration decrements - so a member's Deflect expires when
    // their next turn begins, and surprise/stun clear after they burn this one.
    const { damage } = tickTurn(carrier);
    if (damage > 0 && applyTurnDot(s, damage)) return; // owner fell to the dot
    if (skip) {
      if (s.member) {
        // A stunned member's turn is spent recovering - narrate and pass.
        log(skipLine);
        refresh();
        advanceTurn();
        return;
      }
      phase = 'ai';
      acting = { unit: s.unit, ap: 0, wait: 0.6 };
      log(skipLine);
      refresh();
      return;
    }
    if (s.member) {
      makeActive(s.member);
      s.member.ap = s.member.sheet.maxAp; // full AP at the top of your turn
      phase = 'player';
      const solo = members.length === 1;
      log(solo ? 'Your turn.' : `${s.member.sheet.name}'s turn.`);
      refresh();
      return;
    }
    phase = 'ai';
    acting = { unit: s.unit, ap: s.unit.def.ap, wait: 0.35 };
    refresh();
  }
  // The line for a turn spent incapacitated - stun reads differently from the
  // surprise it generalized.
  function skipTurnLine(s, carrier) {
    const name = s.member ? s.member.sheet.name : s.unit.def.name;
    if (hasStatus(carrier, 'stunned')) return `${name} is stuck in mandatory training. Attendance is taken.`;
    return `${name} is still grabbing their lanyard.`;
  }
  // Apply a turn-start dot (burning) to the slot's owner, with popup + death
  // handling. Returns true if the owner died (the caller then advances past the
  // now-empty slot), false if the turn should proceed.
  function applyTurnDot(s, damage) {
    const actor = s.member ? s.member.actor : s.unit;
    fx.damageText(actor.x, actor.z, `-${damage}`, '#ff7a3c');
    if (s.member) {
      const dead = applyDamage(s.member.sheet, damage);
      log(`${s.member.sheet.name} is on fire. -${damage}.`);
      if (!dead) { refresh(); return false; }
      s.member.toppled = true;
      s.member.actor.clearPath();
      s.member.actor.fx = { kind: 'death', t: 0 };
      if (!livingParty().length) { defeat(); return true; }
      advanceTurn();
      return true;
    }
    const died = s.unit.takeDamage(damage);
    log(`${s.unit.def.name} is on fire. -${damage}.`);
    if (!died) { refresh(); return false; }
    callbacks.onEnemyKilled(s.unit);
    if (!engaged.some((e) => e.alive)) { victory(); return true; }
    advanceTurn();
    return true;
  }

  // --- summons ----------------------------------------------------------------
  // Live minions a summoner still has on the board - the cap counts these.
  // Enemy-team summons are AI actors in the shared enemy list; player-team
  // summons are temporary MEMBERS (below), tagged with who conjured them.
  function liveSummonsOf(summoner) {
    const enemySummons = world.liveEnemies().filter((e) => e.summonedBy === summoner).length;
    const playerSummons = members.filter((m) =>
      m.isSummon && m.sheet.hp > 0 && m.summonedBy === summoner).length;
    return enemySummons + playerSummons;
  }
  // Post the req: spawn up to the descriptor's `count` for `team` beside the
  // summoner, never past its live `cap`. Returns how many actually showed up.
  //   enemy team -> AI actors: join `engaged` (counted for victory, queued next
  //     round) and take a `{unit}` initiative slot, surprised so they don't act
  //     the turn they're posted.
  //   player team -> temporary MEMBERS you control: a real sheet + body, its own
  //     action bar and AP, a `{member}` initiative slot. Not in party.members
  //     (outside the cap, unsaved); combat owns them, despawned at fight's end.
  function resolveSummon(summoner, team, d) {
    const room = (d.cap ?? d.count) - liveSummonsOf(summoner);
    const n = Math.min(d.count, Math.max(0, room));
    if (n <= 0) return 0;
    const spawned = world.spawnSummon(d.archetype, team, summoner, n) || [];
    for (const rec of spawned) {
      if (team === 'enemy') {
        if (!engaged.includes(rec)) engaged.push(rec);
        applyStatus(rec, 'surprised');
        insertSlot(unitSlot(rec));
      } else {
        const usesLeft = {};
        for (const id of rec.sheet.actions) if (ACTIONS[id].uses) usesLeft[id] = ACTIONS[id].uses;
        const m = {
          sheet: rec.sheet, actor: rec.actor, ap: rec.sheet.maxAp,
          done: false, usesLeft, isSummon: true, summonedBy: summoner,
        };
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
    const atk = unit.def.attacks[rand(0, unit.def.attacks.length - 1)];
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
    fx.damageText(m.actor.x, m.actor.z, `-${dmg}`);
    // Any status the attack carries lands here (gum, and now stun etc.),
    // Composure shrugging off some of a resistable one. Not onto a corpse.
    if (atk.applies && !dead && applyStatus(m.sheet, atk.applies, {}, statusResist(m.sheet))) {
      line += ` ${appliesLine(atk, m.sheet.name)}`;
    }
    log(line);
    refresh();
    if (dead) {
      m.toppled = true;
      m.actor.clearPath();
      m.actor.fx = { kind: 'death', t: 0 };
      if (!livingParty().length) { defeat(); return; } // party wipe - the only true loss
      log(m.isSummon
        ? `${m.sheet.name} is dismissed - back to the applicant pool.`
        : `${m.sheet.name} is out cold. They'll sit the rest of this one out.`);
      // Keep `active` (the sheet the HUD reflects, and the post-combat leader)
      // on a real member still standing - never a summon, which despawns.
      // Their initiative slot is simply skipped when it comes around.
      if (m === active) {
        active = livingParty()[0];
        party.active = members.indexOf(active);
      }
    }
  }

  // --- opportunity attacks (TACTICS_PLAN M2) ---------------------------------
  // Leaving a threatened tile hands the threatener a free swing, so walking
  // out of melee stops being free and kiting stops being strictly dominant.
  // Three rules keep it from becoming a blender:
  //   - one reaction per unit per ROUND (refilled by newRound)
  //   - unaware units don't react (surprised/stunned haven't registered it)
  //   - FORCED movement never provokes. A shove sets the logical tile through
  //     pushTo and glides the body, which skips the per-tile hook entirely
  //     (actors.js update), and only deliberate moves seed `moveStart` - so
  //     shove is the safe way to break contact (TACTICS_PLAN #9).
  const reactions = new Map(); // combatant -> reactions spent this round
  const moveStart = new Map(); // combatant -> tile its current move began on
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
  const standing = (u) => (u.sheet ? u.sheet.hp > 0 && !u.toppled : !!u.alive);
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
  const beginMove = (u) => { if (u) moveStart.set(u, { x: bodyOf(u).x, z: bodyOf(u).z }); };
  // Everyone on the far side of `mover` able to punish it right now.
  const threatsAgainst = (mover) => (mover.sheet ? engaged : members)
    .filter((u) => canReact(u))
    .map((u) => ({ x: bodyOf(u).x, z: bodyOf(u).z, ref: u }));

  // `ref` entered (x, z) under its own power. Anyone whose reach it just left
  // gets one free swing. The walk is NOT interrupted - its AP was charged up
  // front (TACTICS_PLAN #8) - so the mover takes the hit and keeps going,
  // unless it goes down.
  function notifyStep(ref, x, z) {
    if (phase === 'done') return;
    const mover = combatantFor(ref);
    if (!mover) return;
    const from = moveStart.get(mover);
    if (!from) return; // not a tracked deliberate move (a shove glide, a spawn)
    if (from.x === x && from.z === z) return;
    setFacing(mover, x - from.x, z - from.z); // you face where you're going
    moveStart.set(mover, { x, z }); // the next leg starts here
    if (!standing(mover)) return;
    for (const t of provokedBy(threatsAgainst(mover), from.x, from.z, x, z)) {
      if (!canReact(t.ref)) continue; // an earlier swing this step spent it
      reactions.set(t.ref, (reactions.get(t.ref) || 0) + 1);
      opportunityStrike(t.ref, mover);
      if (!standing(mover)) break; // dropped mid-flight - no further swings
    }
  }

  // The reaction swing: the attacker's own basic attack, at no AP cost, rolled
  // through the same assembler as every other attack. It deliberately carries
  // no weapon on-hit proc - a reflex, not a committed swing.
  function opportunityStrike(attacker, defender) {
    if (attacker.sheet) {
      // A party-side body catches a fleeing enemy.
      const a = ACTIONS[equippedAction(attacker.sheet)];
      if (!a) return; // no basic swing to make (shouldn't happen - punch is the floor)
      attacker.actor.lunge(defender.x, defender.z);
      faceTarget(attacker, defender.x, defender.z);
      if (!rollAgainst(attacker, defender)) {
        fx.damageText(defender.x, defender.z, 'MISS', MISS_COLOR);
        log(`${attacker.sheet.name} swings at ${defender.def.name} breaking away - and misses.`);
        refresh();
        return;
      }
      const dmg = rand(a.min, a.max) + damageBonus(attacker.sheet);
      const died = defender.takeDamage(dmg);
      fx.damageText(defender.x, defender.z, `-${dmg}`, '#ffd76b');
      log(`${attacker.sheet.name} catches ${defender.def.name} breaking away. ${dmg} damage!`);
      if (died) callbacks.onEnemyKilled(defender);
      refresh();
      return;
    }
    // An enemy catches a fleeing member (or summon) - same rules as its turn
    // attack, just reworded so the log reads as a punish, not a swing in turn.
    const base = attacker.def.attacks[rand(0, attacker.def.attacks.length - 1)];
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
    let best = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const tx = target.actor.x + dx;
      const tz = target.actor.z + dz;
      if (!world.isWalkable(tx, tz) && !(unit.x === tx && unit.z === tz)) continue;
      const p = world.findEnemyPath(unit.x, unit.z, tx, tz);
      if (p && p.length > 1 && (!best || p.length < best.length)) best = p;
    }
    if (!best) return 0;
    // Stand at reach of the target's BODY, not the middle of the adjacent
    // tile (the point stays inside that tile, so adjacency still holds).
    const [gx, gz] = best[best.length - 1];
    const pp = target.actor.entity ? target.actor.entity.getPosition() : { x: target.actor.x, z: target.actor.z };
    best[best.length - 1] = world.approach(gx, gz, pp.x, pp.z);
    const s = world.smoothEnemy(unit, best);
    // AI units pay the same surface movement tax the player does, plus their
    // own gum surcharge if they've stepped in a wad.
    const { points, cost } = truncateByBudget(s, budget,
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
          fx.damageText(x, z, `-${surf}`, '#ffd76b');
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
          unit.speed *= GUM.slow;
          log(`${unit.def.name} steps in gum. It's theirs now.`);
        }
        // wet floor: a slip ends their whole turn (they spend it getting up).
        // Gum is traction (slipProof), so a gummed unit can't slip.
        if (unit.alive && !statusFx(unit).slipProof && Math.random() < (world.slipChanceAt(x, z) || 0)) {
          unit.clearPath();
          unit.flinch();
          unit.slipped = true;
          fx.damageText(x, z, 'slip!', '#8ad4df');
          log(`${unit.def.name} slips in the water and goes down.`);
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
        if (en.alive && cheb(active.actor.x, active.actor.z, en.x, en.z) <= 1
          && active.ap >= ACTIONS[action].ap) {
          active.actor.faceToward(en.x, en.z);
          performOn(action, en);
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
    if (cheb(unit.x, unit.z, target.actor.x, target.actor.z) <= 1 && acting.ap >= unit.def.attackAp) {
      aiAttack(unit, target);
      acting.ap -= unit.def.attackAp;
      acting.wait = 0.55;
    } else if (acting.ap >= 1 && cheb(unit.x, unit.z, target.actor.x, target.actor.z) > 1) {
      const spent = aiAdvance(unit, acting.ap, target);
      if (spent <= 0) acting.ap = 0;
      else acting.ap = Math.max(0, roundAp(acting.ap - spent));
      acting.wait = 0.15;
    } else {
      advanceTurn(); // out of AP / nothing to do - next in initiative
    }
  }

  app.on('update', update);
  log('Combat!');
  // Kick off the initiative order. Started from the persistent hotbar, the
  // initiator AMBUSHES: the throwing member leads off regardless of their roll
  // (they caught the coworker cold - the same reason distant enemies start
  // surprised), then fires the armed opener as part of that turn. Otherwise
  // the highest roll simply goes first - which can be an enemy.
  if (opening && ACTIONS[opening.actionId] && opening.target?.alive) {
    const oi = order.findIndex((s) => s.member === members[party.active]);
    if (oi >= 0) turnPtr = oi;
    beginTurn();
    if (phase === 'player') {
      armed = opening.actionId;
      refresh();
      handleEnemyClick(opening.target);
    }
  } else {
    beginTurn();
  }

  // Read-only handle for tests, plus a few live setters god mode (god.js) uses
  // to edit turn state in place. Tests only ever read phase/ap/armed/enemies;
  // the added members are harmless to them. Everything single-character maps
  // to the ACTIVE member.
  window.__combat = {
    get phase() { return phase; },
    get ap() { return active.ap; },
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
    get usesLeft() { return active.usesLeft; }, // live { actionId: count } - edit in place, then call refresh()
    get party() {
      return members.map((m) => ({ name: m.sheet.name, hp: m.sheet.hp, ap: m.ap, active: m === active, statuses: statusList(m.sheet) }));
    },
    // Test/debug: apply a status to the active member (STATUS_PLAN e2e). Enemy
    // statuses arrive naturally (a shove stuns, a fire tile burns).
    applyStatus: (id, duration) => { applyStatus(active.sheet, id, { duration }); refresh(); },
    // The initiative order, top to bottom, with whose turn it is - for the
    // tracker UI and the e2e suite.
    get order() {
      return order.map((s, i) => ({
        name: slotName(s), team: s.team, init: s.init,
        member: !!s.member, current: i === turnPtr, alive: slotAlive(s),
      }));
    },
    get turn() { return order[turnPtr] ? slotName(order[turnPtr]) : null; },
    get summons() {
      return members.filter((m) => m.isSummon && m.sheet.hp > 0)
        .map((m) => ({ name: m.sheet.name, x: m.actor.x, z: m.actor.z, hp: m.sheet.hp }));
    },
    // Test/debug: drop a player-team summon beside the active member, as the
    // HR class's Post the Role will (M3). Bypasses caps - callers set the count.
    summonAlly: (id, n = 1) => resolveSummon(active.actor, 'player', { archetype: id, count: n, cap: n }),
    refresh,
  };

  return {
    handleTileClick,
    handleEnemyClick,
    handleHover,
    notifyMemberDown,
    // The body whose turn it is - a party member OR a summon you're driving.
    // main.js needs this because party.active can't point at a summon.
    get actingActor() { return active.actor; },
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
