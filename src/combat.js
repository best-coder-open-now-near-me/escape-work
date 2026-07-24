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
import { damageBonus, applyDamage, deflect } from './stats.js';
import { PANEL_CHROME, BUTTON_CHROME } from './ui.js';

const pc = window.pc;
const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const cheb = (ax, az, bx, bz) => Math.max(Math.abs(ax - bx), Math.abs(az - bz));
const THROW_RANGE = 5;
const SURPRISE_RADIUS = 2; // engaged from beyond this = loses the first turn

export function startCombat({ app, party, engaged, world, fx, callbacks, opening = null }) {
  // Per-member turn state: every party member fights with their own AP pool,
  // deflect stance and limited-use counters. `active` is whose action bar,
  // previews and clicks are live - with one member that is simply "you";
  // switching mid-fight arrives with the party bar.
  const members = party.members.map((m) => {
    const usesLeft = {};
    for (const id of m.sheet.actions) if (ACTIONS[id].uses) usesLeft[id] = ACTIONS[id].uses;
    // `done` marks a member End Turn has passed - it gates the auto-advance,
    // never the member (switch back manually and they can still act).
    return { sheet: m.sheet, actor: m.actor, ap: m.sheet.maxAp, defended: false, done: false, usesLeft };
  });
  let active = members[party.active];
  const livingMembers = () => members.filter((m) => m.sheet.hp > 0 && m.actor);
  const liveAllies = () => (world.liveAllies ? world.liveAllies() : []); // player-team summons
  // Everything an AI unit could swing at on the far side. An enemy hunts the
  // party AND any player-team summons; a player-team summon hunts the enemies.
  // A target wraps { actor, member }: `member` is set only for a party member
  // (its sheet takes the hit, with the downed/handoff rules); a bare actor - an
  // enemy, or a summon on either side - takes damage through takeDamage.
  const targetHp = (t) => (t.member ? t.member.sheet.hp : t.actor.hp);
  function hostilesFor(unit) {
    if (unit.team === 'player') return world.liveEnemies().map((a) => ({ actor: a, member: null }));
    return [
      ...livingMembers().map((m) => ({ actor: m.actor, member: m })),
      ...liveAllies().map((a) => ({ actor: a, member: null })),
    ];
  }
  // Nearest hostile (Chebyshev), ties broken by lowest HP - the rule the
  // party's enemies always used, now team-agnostic so summons on either side
  // pick targets the same way.
  function pickTarget(unit) {
    let best = null;
    for (const t of hostilesFor(unit)) {
      const d = cheb(unit.x, unit.z, t.actor.x, t.actor.z);
      if (!best || d < best.d || (d === best.d && targetHp(t) < targetHp(best.t))) best = { t, d };
    }
    return best?.t || null;
  }
  // Enemies pulled in from a distance are surprised - they spend their first
  // turn realizing what's happening, so group openings don't alpha-strike you.
  for (const en of engaged) {
    const t = pickTarget(en);
    en.surprised = !t || cheb(en.x, en.z, t.actor.x, t.actor.z) > SURPRISE_RADIUS;
  }
  // A bystander outside the engagement radius who gets attacked anyway joins
  // the fight - surprised, so they lose the turn they spend taking offense.
  // Without this they'd soak thrown damage forever without ever hitting back.
  function joinCombat(en) {
    if (engaged.includes(en)) return;
    engaged.push(en);
    en.surprised = true;
  }
  // world: { isWalkable, findPath(sx,sz,tx,tz), hasLos(ax,az,bx,bz),
  //          stepOpen(x,z,nx,nz), surfaceIdAt(x,z), enemySurfDamage(x,z) }
  // fx:    { projectile(from,to,kind), damageText(x,z,text,color) } - cosmetic
  // callbacks: { say, updateHud, onRound, onEnemyKilled(en), onWin, onLose }
  const talentFxOf = (m) => m.sheet.talent?.effects || {};
  const throwableIds = Object.keys(ACTIONS).filter((id) => ACTIONS[id].ammoCost);
  // Everyone can shove - it's an office, not a fencing academy.
  const actionIdsOf = (m) => [...m.sheet.actions, 'shove', ...throwableIds];
  const ammoCostOf = (id) => {
    const base = ACTIONS[id].ammoCost || 0;
    return base > 1 ? Math.max(1, base - (talentFxOf(active).paperAmmoDiscount || 0)) : base;
  };
  // Movement cost per unit distance, derived from the surface's `slow`
  // multiplier (0.5 => twice the AP) - one number in data drives both walk
  // speed and AP pricing, for everyone. Gum on a shoe surcharges every step;
  // a member's gum lives on their sheet, an AI unit's on the actor (see
  // aiAdvance).
  const surfaceStepCost = (x, z) => {
    const slow = SURFACES[world.surfaceIdAt(x, z)]?.slow;
    return slow ? 1 / slow : 1;
  };
  const stepCost = (x, z) => surfaceStepCost(x, z) * (active.sheet.gum > 0 ? GUM.moveCost : 1);
  // AP is spent in tenths now that movement charges by distance.
  const roundAp = (v) => Math.round(v * 10) / 10;
  const fmtAp = (v) => String(roundAp(v)).replace(/\.0$/, '');

  let phase = 'player'; // 'player' | 'allies' | 'enemies' | 'done'
  // Nothing is pre-aimed: arm an attack/shove, THEN pick a target. While
  // armed, hover switches from the movement trail to target rings.
  let armed = null;
  let pendingMelee = null; // { en, action } to strike when the walk-up completes
  let aiQueue = []; // the AI units taking their beats this phase (allies or enemies)
  let acting = null; // { en, ap, wait }

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

  function hidePreview() {
    preview = null;
    costTag.style.display = 'none';
  }

  function handleHover(point, sx, sy) {
    // While aiming, target rings replace the movement trail entirely.
    // Cone attacks additionally track the cursor - the wedge follows it.
    if (armed && ACTIONS[armed].cone) aimPoint = point;
    if (phase !== 'player' || active.actor.moving || !point || armed) { hidePreview(); return; }
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
    const cosLimit = Math.cos((a.cone.halfAngle * Math.PI) / 180);
    const test = (wx, wz) => {
      const vx = wx - pp.x;
      const vz = wz - pp.z;
      const d = Math.hypot(vx, vz);
      if (d < 0.3 || d > a.cone.range) return false;
      return (vx * dx + vz * dz) / d >= cosLimit;
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
        const hit = test && test(en.x, en.z) && world.hasLos(active.actor.x, active.actor.z, en.x, en.z);
        drawRing(pos.x, pos.z, 0.5, hit && active.ap >= a.ap ? PREVIEW_OK : PREVIEW_FAR);
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
      drawRing(pos.x, pos.z, 0.5, ok ? PREVIEW_OK : PREVIEW_FAR);
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

  // The raw handoff: point everything at another member. party.active moves
  // with it so the portrait bar highlights - and so the out-of-combat leader
  // bindings follow whoever had the floor when the fight ends (main.js
  // syncLeaderBindings).
  function applyActive(i) {
    party.active = i;
    active = members[i];
    armed = null;
    pendingMelee = null;
    hidePreview();
    buildActionBar();
    refresh();
  }
  // Hand control to another member mid-fight (portrait click, Tab, or a click
  // on their body). Their AP pool is wherever they left it - switching is
  // free and reversible, the Divinity courtesy.
  function setActive(i) {
    const m = members[i];
    if (phase !== 'player' || !m || m === active || m.sheet.hp <= 0 || !m.actor) return;
    if (active.actor.moving) { log('Let the current move land first.'); return; }
    applyActive(i);
    log(`${m.sheet.name} has the floor. ${fmtAp(m.ap)} AP.`);
  }
  function cycleActive() {
    for (let step = 1; step < members.length; step++) {
      const i = (members.indexOf(active) + step) % members.length;
      if (members[i].sheet.hp > 0 && members[i].actor) { setActive(i); return; }
    }
  }
  // A member dropped to 0 HP outside the enemy phase (fire under a combat
  // walk) - main.js reports it here. Topple them, hand off if it was the
  // active member, defeat only on a wipe.
  function notifyMemberDown() {
    for (const m of members) {
      if (m.sheet.hp > 0 || m.toppled) continue;
      m.toppled = true;
      m.actor?.clearPath();
      if (m.actor) m.actor.fx = { kind: 'death', t: 0 };
    }
    if (!livingMembers().length) { defeat(); return; }
    if (active.sheet.hp <= 0) {
      const i = members.findIndex((m) => m.sheet.hp > 0 && m.actor);
      log(`${active.sheet.name} goes down! ${members[i].sheet.name} steps up.`);
      applyActive(i);
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
    el('combat-turn').textContent = phase === 'player' ? 'YOUR TURN'
      : phase === 'allies' ? 'SUMMONS MOVE' : phase === 'enemies' ? 'THEIR TURN' : '';
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
        && !(a.footwork && active.sheet.gum > 0); // no kicking with gum on the shoe
      b.disabled = !affordable;
      b.style.opacity = affordable ? '1' : '.4';
      b.style.borderColor = ((a.type === 'attack' || a.type === 'shove') && id === armed) ? '#8adf76' : '#3a3a52';
    }
    endBtn.disabled = phase !== 'player';
    // The label says what the click will actually do: pass to a teammate who
    // hasn't ended their turn, or hand the round to the other side.
    endBtn.textContent = members.some((m) => m !== active && !m.done && m.sheet.hp > 0 && m.actor)
      ? 'Next Member' : 'End Turn';
    // One member reads as "You"; a real party lists everyone by name, the
    // downed marked as such.
    strip.innerHTML = `<div style="font-weight:700; margin-bottom:5px;">COMBAT</div>` +
      members.map((m) => {
        const label = members.length === 1 ? 'You' : m.sheet.name;
        const state = m.sheet.hp <= 0 ? 'DOWN' : `${m.sheet.hp}/${m.sheet.maxHp}`;
        return `<div>${label} &middot; ${state}</div>`;
      }).join('') +
      // Your summons fight on your side of the ledger, tinted friendly.
      liveAllies().map((s) =>
        `<div style="opacity:.85; color:#8adf76">${s.def.name} &middot; ${s.hp}/${s.maxHp}</div>`).join('') +
      engaged.filter((e) => e.alive).map((e) =>
        `<div style="opacity:.9">${e.def.name} &middot; ${e.hp}/${e.maxHp}</div>`).join('');
    callbacks.updateHud();
  }

  function cleanup() {
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
    if (a.footwork && active.sheet.gum > 0) {
      log('You wind up the kick... the gum disagrees. Pick something else.');
      armed = null;
      refresh();
      return;
    }
    joinCombat(en); // attacking a bystander drags them into the fight
    let dmg = rand(a.min, a.max) + damageBonus(active.sheet); // carried staplers count
    if (a.ammoCost) {
      active.sheet.paper -= ammoCostOf(id);
      dmg += talentFxOf(active).paperDamageBonus || 0;
      fx.projectile({ x: active.actor.x, z: active.actor.z }, { x: en.x, z: en.z },
        id === 'paper-airplane' ? 'plane' : 'ball');
    } else {
      active.actor.lunge(en.x, en.z);
    }
    active.ap -= a.ap;
    const died = en.takeDamage(dmg);
    fx.damageText(en.x, en.z, `-${dmg}`, '#ffd76b');
    let line = `${a.log} ${dmg} damage!`;
    // A purge (reboot) wipes the target's statuses - good and bad alike.
    if (a.purge && !died && en.surprised) {
      en.surprised = false;
      line += ' Their surprise is power-cycled away.';
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
    let hits = 0;
    for (const en of world.liveEnemies()) {
      if (!test(en.x, en.z)) continue;
      if (!world.hasLos(active.actor.x, active.actor.z, en.x, en.z)) continue;
      joinCombat(en); // a bystander caught in the mail joins the fight
      const dmg = rand(a.min, a.max) + damageBonus(active.sheet);
      fx.projectile({ x: active.actor.x, z: active.actor.z }, { x: en.x, z: en.z }, 'plane');
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
      // A partition between the tiles counts as "something solid" too.
      if (!world.isWalkable(tx, tz) || !world.stepOpen(en.x, en.z, tx, tz)) {
        const died = en.takeDamage(2);
        fx.damageText(en.x, en.z, '-2', '#ffd76b');
        log(`You shove ${en.def.name} into something solid. -2.`);
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
        const hadBleed = active.sheet.bleed > 0;
        active.sheet.bleed = 0;
        active.defended = false;
        armed = null;
        log(hadBleed
          ? 'You turn yourself off and on again. The bleeding stops. So does everything else.'
          : 'You turn yourself off and on again. All effects cleared. Classic fix.');
        refresh();
        return;
      }
      // aiming: a ground click lowers the action instead of walking
      log(`You lower the ${a.label.toLowerCase()}.`);
      armed = null;
      refresh();
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

  function onActionButton(id, b) {
    if (phase !== 'player' || b.disabled) return;
    const a = ACTIONS[id];
    if (a.type === 'attack' || a.type === 'shove') {
      if (armed === id) {
        armed = null; // clicking again lowers it
        log(`You lower the ${a.label.toLowerCase()}.`);
      } else {
        armed = id; // arm it; clicking a ringed target fires it
        hidePreview(); // aiming now - the movement trail yields to targets
        log(`${a.label} armed. Click a target.`);
      }
      refresh();
    } else if (a.type === 'defend') {
      if (active.defended) { log('You are already deflecting. Save the AP.'); return; }
      active.ap -= a.ap;
      active.defended = true;
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
    active.done = true;
    const next = members.find((m) => m !== active && !m.done && m.sheet.hp > 0 && m.actor);
    if (next) {
      setActive(members.indexOf(next));
      return;
    }
    startAlliesPhase();
  };

  // --- AI phases (allies, then enemies) --------------------------------------------
  // Player-team summons act between your turn and the enemies' - the ally step
  // of player -> allies -> enemies. With no summons it's invisible: hand
  // straight to the enemies so an ordinary fight is byte-for-byte as before.
  function startAlliesPhase() {
    const allies = liveAllies();
    if (!allies.length) { startEnemyPhase(); return; }
    phase = 'allies';
    pendingMelee = null;
    armed = null;
    hidePreview();
    aiQueue = allies.slice();
    acting = null;
    log('Your summons move...');
    refresh();
  }

  function startEnemyPhase() {
    phase = 'enemies';
    pendingMelee = null;
    armed = null;
    hidePreview();
    // One enemy phase is one round: age every summoner's cooldown a tick, so a
    // capped/cooling HR fights instead of re-posting the same req every turn.
    for (const e of engaged) if (e.summonCd > 0) e.summonCd -= 1;
    aiQueue = engaged.filter((e) => e.alive);
    acting = null;
    log('Their turn...');
    refresh();
  }

  function startPlayerTurn() {
    phase = 'player';
    for (const m of members) {
      m.ap = m.sheet.maxAp;
      m.defended = false;
      m.done = false;
    }
    callbacks.onRound?.(); // a full round elapsed - age fire/smoke one turn
    log('Your turn.');
    refresh();
  }

  // --- summons ----------------------------------------------------------------
  // Live minions a summoner still has on the board - the cap counts these.
  // Enemy-team summons live in the shared enemy list (world.liveEnemies);
  // player-team summons arrive with the ally phase (M2).
  function liveSummonsOf(summoner) {
    return [...world.liveEnemies(), ...liveAllies()].filter((e) => e.summonedBy === summoner).length;
  }
  // Post the req: spawn up to the descriptor's `count` for `team` beside the
  // summoner, never past its live `cap`. Enemy-team arrivals join `engaged` so
  // they count toward victory and queue next round - they don't act the turn
  // they're summoned. Returns how many actually showed up.
  function resolveSummon(summoner, team, d) {
    const room = (d.cap ?? d.count) - liveSummonsOf(summoner);
    const n = Math.min(d.count, Math.max(0, room));
    if (n <= 0) return 0;
    const spawned = world.spawnSummon(d.archetype, team, summoner, n) || [];
    for (const a of spawned) {
      if (team === 'enemy' && !engaged.includes(a)) engaged.push(a);
    }
    return spawned.length;
  }

  // One AI unit's swing at its target. A party member takes it on their sheet
  // (deflect, gum, and the downed/handoff/party-wipe rules); a bare actor - an
  // enemy struck by a player summon, or a player summon struck by an enemy -
  // takes it through takeDamage, with no downed courtesy (a spent minion just
  // falls, never a game-over).
  function aiAttack(unit, target) {
    const atk = unit.def.attacks[rand(0, unit.def.attacks.length - 1)];
    let dmg = rand(atk.min, atk.max);
    unit.lunge(target.actor.x, target.actor.z);
    if (target.member) {
      const m = target.member;
      let line = atk.log;
      // Composure soaks a flat slice off the hit (one point always lands),
      // before the Deflect Blame stance halves whatever is left.
      const soak = deflect(m.sheet);
      if (soak > 0) dmg = Math.max(1, dmg - soak);
      if (m.defended) {
        dmg = Math.max(1, Math.ceil(dmg / 2));
        line += ` You deflect - only ${dmg} damage.`;
      } else {
        line += ` ${dmg} damage.`;
      }
      m.actor.flinch();
      const dead = applyDamage(m.sheet, dmg);
      fx.damageText(m.actor.x, m.actor.z, `-${dmg}`);
      if (atk.applies === 'gum') {
        m.sheet.gum = GUM.steps;
        line += ' Gum. On your shoe.';
      }
      log(line);
      refresh();
      if (dead) {
        m.toppled = true;
        m.actor.clearPath();
        m.actor.fx = { kind: 'death', t: 0 };
        if (!livingMembers().length) { defeat(); return; } // party wipe - the only true loss
        if (m === active) {
          // The member you were controlling fell - a survivor steps up so the
          // fight goes on.
          const i = members.findIndex((mm) => mm.sheet.hp > 0 && mm.actor);
          log(`${m.sheet.name} goes down! ${members[i].sheet.name} steps up.`);
          applyActive(i);
        } else {
          log(`${m.sheet.name} is out cold.`);
        }
      }
      return;
    }
    // Bare actor: an enemy (a player summon's swing) or a player summon (an
    // enemy's swing). takeDamage flinches on a hit and topples on a kill.
    const a = target.actor;
    const died = a.takeDamage(dmg);
    fx.damageText(a.x, a.z, `-${dmg}`, '#ffd76b');
    log(`${atk.log} ${dmg} damage.`);
    if (died && unit.team === 'player') callbacks.onEnemyKilled(a);
    refresh();
    if (unit.team === 'player' && !engaged.some((e) => e.alive)) victory();
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
      (x, z) => surfaceStepCost(x, z) * (unit.gummed ? GUM.moveCost : 1));
    if (points.length < 2 || cost < 0.05) return 0;
    unit.onTile = (x, z, done, changed) => {
      if (changed) {
        // AI units feel the floor too
        const surf = world.enemySurfDamage(x, z);
        if (surf > 0) {
          const died = unit.takeDamage(surf);
          fx.damageText(x, z, `-${surf}`, '#ffd76b');
          log(`${unit.def.name} stumbles through the hazard. -${surf}.`);
          if (died) {
            if (unit.team !== 'player') callbacks.onEnemyKilled(unit);
            refresh();
          }
        }
        // gum wads stick to AI units too: slowed for good, but sure-footed
        if (unit.alive && !unit.gummed && world.stickGum(x, z)) {
          unit.gummed = true;
          unit.speed *= GUM.slow;
          log(`${unit.def.name} steps in gum. It's theirs now.`);
        }
        // wet floor: a slip ends their whole turn (they spend it getting up)
        if (unit.alive && !unit.gummed && Math.random() < (world.slipChanceAt(x, z) || 0)) {
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
    // One shared driver runs both AI phases - allies, then enemies - just
    // pointed at a different queue and a different hostile team.
    if (phase !== 'allies' && phase !== 'enemies') return;
    if (acting && acting.wait > 0) {
      acting.wait -= dt;
      return;
    }
    if (!acting) {
      const unit = aiQueue.shift();
      if (!unit) { phase === 'allies' ? startEnemyPhase() : startPlayerTurn(); return; }
      if (!unit.alive) return;
      if (unit.surprised) {
        unit.surprised = false;
        log(`${unit.def.name} is still grabbing their lanyard.`);
        acting = { unit, ap: 0, wait: 0.6 };
        return;
      }
      acting = { unit, ap: unit.def.ap, wait: 0.35 };
      return;
    }
    const { unit } = acting;
    if (!unit.alive) { acting = null; return; }
    if (unit.moving) return; // let the current walk play out
    if (unit.slipped) {
      unit.slipped = false;
      acting.ap = 0; // the rest of the turn goes to getting up with dignity
      acting.wait = 0.6;
      return;
    }
    const target = pickTarget(unit);
    if (!target) {
      // Enemies with no living player-side target means a party wipe. An ally
      // with no enemies left just idles out the queue (victory already fired
      // from the kill that emptied them).
      if (phase === 'enemies') { defeat(); return; }
      acting = null;
      return;
    }
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
      acting = null; // out of AP - next
    }
  }

  app.on('update', update);
  log('Combat! Your move.');
  refresh();

  // Started from the persistent hotbar: the fight opens with the armed action
  // aimed at the coworker you clicked. handleEnemyClick sorts out the rest -
  // melee walks up and strikes on arrival, a throw fires if in range and line.
  if (opening && ACTIONS[opening.actionId] && opening.target?.alive) {
    armed = opening.actionId;
    refresh();
    handleEnemyClick(opening.target);
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
    get enemies() { return engaged.map((e) => ({ name: e.def.name, x: e.x, z: e.z, hp: e.hp, alive: e.alive })); },
    get maxAp() { return active.sheet.maxAp; },
    get defended() { return active.defended; },
    set defended(v) { active.defended = !!v; refresh(); },
    get usesLeft() { return active.usesLeft; }, // live { actionId: count } - edit in place, then call refresh()
    get party() {
      return members.map((m) => ({ name: m.sheet.name, hp: m.sheet.hp, ap: m.ap, active: m === active }));
    },
    get summons() {
      return liveAllies().map((s) => ({ name: s.def.name, x: s.x, z: s.z, hp: s.hp }));
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
    setActive,
    cycleActive,
    notifyMemberDown,
    // Per-member turn snapshot, for the party bar's in-combat AP readout.
    get party() {
      return members.map((m) => ({ name: m.sheet.name, hp: m.sheet.hp, ap: m.ap, active: m === active }));
    },
    // main.js detected a slip mid-walk (tile effects live there) - narrate it
    notifySlip: () => log('You slip in the water. The rest of that movement is a donation.'),
    abort: cleanup, // for deaths resolved outside combat (surfaces, explosions)
    get active() { return phase !== 'done'; },
  };
}
