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

const pc = window.pc;
const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const cheb = (ax, az, bx, bz) => Math.max(Math.abs(ax - bx), Math.abs(az - bz));
const THROW_RANGE = 5;
const ENEMY_ATTACK_AP = 3;

export function startCombat({ app, sheet, player, engaged, world, fx, callbacks }) {
  // Enemies pulled in from a distance are surprised - they spend their first
  // turn realizing what's happening, so group openings don't alpha-strike you.
  for (const en of engaged) {
    en.surprised = cheb(en.x, en.z, player.x, player.z) > 2;
  }
  // world: { isWalkable, findPath(sx,sz,tx,tz), hasLos(ax,az,bx,bz),
  //          stepOpen(x,z,nx,nz), surfaceIdAt(x,z), enemySurfDamage(x,z) }
  // fx:    { projectile(from,to,kind), damageText(x,z,text,color) } - cosmetic
  // callbacks: { say, updateHud, onEnemyKilled(en), onWin, onLose }
  const talentFx = sheet.talent?.effects || {};
  const throwableIds = Object.keys(ACTIONS).filter((id) => ACTIONS[id].ammoCost);
  // Everyone can shove - it's an office, not a fencing academy.
  const allActionIds = [...sheet.actions, 'shove', ...throwableIds];
  const usesLeft = {};
  for (const id of sheet.actions) if (ACTIONS[id].uses) usesLeft[id] = ACTIONS[id].uses;
  const ammoCostOf = (id) => {
    const base = ACTIONS[id].ammoCost || 0;
    return base > 1 ? Math.max(1, base - (talentFx.paperAmmoDiscount || 0)) : base;
  };
  // Movement cost per unit distance: sticky surfaces cost double to cross.
  const stepCost = (x, z) => (SURFACES[world.surfaceIdAt(x, z)]?.slow ? 2 : 1);
  // AP is spent in tenths now that movement charges by distance.
  const roundAp = (v) => Math.round(v * 10) / 10;
  const fmtAp = (v) => String(roundAp(v)).replace(/\.0$/, '');

  let phase = 'player'; // 'player' | 'enemies' | 'done'
  let ap = sheet.maxAp;
  let defended = false;
  let armed = sheet.actions.find((id) => ACTIONS[id].type === 'attack') || 'attack';
  let pendingMelee = null; // enemy to strike when the walk-up completes
  let enemyQueue = [];
  let acting = null; // { en, ap, wait }

  // --- UI ---------------------------------------------------------------------
  const panel = document.createElement('div');
  panel.id = 'combat-panel';
  Object.assign(panel.style, {
    position: 'fixed', left: '50%', bottom: '18px', transform: 'translateX(-50%)',
    zIndex: '30', width: 'min(640px, 94vw)', background: '#232334',
    border: '1px solid #3a3a52', borderRadius: '10px', padding: '10px 14px',
    color: '#f0f0f5', font: '13px system-ui, sans-serif', userSelect: 'none',
    boxShadow: '0 10px 30px rgba(0,0,0,.5)',
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
  Object.assign(strip.style, {
    position: 'fixed', top: '54px', right: '12px', zIndex: '25', minWidth: '170px',
    background: '#232334', border: '1px solid #3a3a52', borderRadius: '9px',
    padding: '9px 12px', color: '#f0f0f5', font: '12px system-ui, sans-serif',
    boxShadow: '0 8px 24px rgba(0,0,0,.45)',
  });
  document.body.appendChild(strip);

  // --- movement preview -------------------------------------------------------
  // Hovering open floor shows the smoothed route, where this turn's AP runs
  // out (green = affordable, red = the rest), and the exact cost at the
  // cursor - the other half of what makes free movement feel free.
  const costTag = document.createElement('div');
  costTag.id = 'combat-move-cost';
  Object.assign(costTag.style, {
    position: 'fixed', zIndex: '26', padding: '2px 8px', borderRadius: '6px',
    background: 'rgba(22,22,36,.88)', border: '1px solid #3a3a52',
    color: '#f0f0f5', font: '12px system-ui, sans-serif',
    pointerEvents: 'none', display: 'none',
  });
  document.body.appendChild(costTag);
  const PREVIEW_OK = new pc.Color(0.42, 0.78, 0.35);
  const PREVIEW_FAR = new pc.Color(0.85, 0.28, 0.24);
  let preview = null; // { reach: [[x,z],...], tail: [[x,z],...] | null }

  function hidePreview() {
    preview = null;
    costTag.style.display = 'none';
  }

  function handleHover(point, sx, sy) {
    if (phase !== 'player' || player.moving || !point) { hidePreview(); return; }
    const tx = Math.round(point.x);
    const tz = Math.round(point.z);
    if (!world.isWalkable(tx, tz)) { hidePreview(); return; } // enemies/walls: no route preview
    let raw;
    if (tx === player.x && tz === player.z) {
      const pos = player.entity?.getPosition();
      if (!pos) { hidePreview(); return; }
      raw = [[pos.x, pos.z], world.clampPoint(point.x, point.z)];
    } else {
      const p = world.findPath(player.x, player.z, tx, tz);
      if (!p || p.length < 2) { hidePreview(); return; }
      raw = [...p.slice(0, -1), world.clampPoint(point.x, point.z)];
    }
    const s = world.smooth(raw);
    const { points, cost, done, tail } = truncateByBudget(s, ap, stepCost);
    preview = { reach: points, tail };
    costTag.textContent = done ? `${fmtAp(cost)} AP` : `${fmtAp(cost)} AP - out of reach`;
    costTag.style.left = `${sx + 14}px`;
    costTag.style.top = `${sy + 14}px`;
    costTag.style.display = 'block';
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
    const SEGS = 18;
    let prev = null;
    for (let i = 0; i <= SEGS; i++) {
      const a = (i / SEGS) * Math.PI * 2;
      const p = new pc.Vec3(ex + Math.cos(a) * 0.32, y, ez + Math.sin(a) * 0.32);
      if (prev) app.drawLine(prev, p, PREVIEW_OK);
      prev = p;
    }
  }

  const actionsRow = panel.querySelector('#combat-actions');
  const buttons = [];
  const mkButton = (id, label) => {
    const b = document.createElement('button');
    b.id = 'act-' + id;
    b.dataset.action = id;
    b.textContent = label;
    Object.assign(b.style, {
      flex: '1', minWidth: '110px', padding: '8px 6px', borderRadius: '7px',
      border: '1px solid #3a3a52', background: '#2e2e46', color: '#f0f0f5',
      font: 'inherit', cursor: 'pointer',
    });
    actionsRow.appendChild(b);
    buttons.push(b);
    return b;
  };
  for (const id of allActionIds) mkButton(id, ACTIONS[id].label);
  const endBtn = document.createElement('button');
  endBtn.id = 'combat-end-turn';
  endBtn.textContent = 'End Turn';
  Object.assign(endBtn.style, {
    minWidth: '90px', padding: '8px 10px', borderRadius: '7px',
    border: '1px solid #6a5a30', background: '#3d3524', color: '#f5e8c8',
    font: 'inherit', cursor: 'pointer',
  });
  actionsRow.appendChild(endBtn);

  const el = (id) => panel.querySelector('#' + id);
  function log(text) {
    el('combat-log').textContent = text;
    callbacks.say(text);
  }
  function refresh() {
    el('combat-turn').textContent = phase === 'player' ? 'YOUR TURN' : phase === 'enemies' ? 'THEIR TURN' : '';
    // Distance-priced movement leaves fractional AP - show it as a half pip.
    const full = Math.floor(ap + 1e-6);
    const half = ap - full >= 0.05 ? 1 : 0;
    el('combat-ap').textContent = 'AP ' + '●'.repeat(full) + (half ? '◐' : '')
      + '○'.repeat(Math.max(0, sheet.maxAp - full - half)) + ` ${fmtAp(ap)}`;
    for (const b of buttons) {
      const id = b.dataset.action;
      const a = ACTIONS[id];
      let label = `${a.label} · ${a.ap}AP`;
      if (a.uses) label += ` (${usesLeft[id]})`;
      if (a.ammoCost) label += ` (${sheet.paper}📄)`;
      b.textContent = label;
      const affordable = phase === 'player' && ap >= a.ap
        && (!a.uses || usesLeft[id] > 0)
        && (!a.ammoCost || sheet.paper >= ammoCostOf(id));
      b.disabled = !affordable;
      b.style.opacity = affordable ? '1' : '.4';
      b.style.borderColor = ((a.type === 'attack' || a.type === 'shove') && id === armed) ? '#8adf76' : '#3a3a52';
    }
    endBtn.disabled = phase !== 'player';
    strip.innerHTML = `<div style="font-weight:700; margin-bottom:5px;">COMBAT</div>
      <div>You &middot; ${sheet.hp}/${sheet.maxHp}</div>` +
      engaged.filter((e) => e.alive).map((e) =>
        `<div style="opacity:.9">${e.def.name} &middot; ${e.hp}/${e.def.hp}</div>`).join('');
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
    let dmg = rand(a.min, a.max) + (sheet.bonusDmg || 0);
    if (a.ammoCost) {
      sheet.paper -= ammoCostOf(id);
      dmg += talentFx.paperDamageBonus || 0;
      fx.projectile({ x: player.x, z: player.z }, { x: en.x, z: en.z },
        id === 'paper-airplane' ? 'plane' : 'ball');
    } else {
      player.lunge(en.x, en.z);
    }
    ap -= a.ap;
    const died = en.takeDamage(dmg);
    fx.damageText(en.x, en.z, `-${dmg}`, '#ffd76b');
    log(`${a.log} ${dmg} damage!`);
    if (died) callbacks.onEnemyKilled(en);
    refresh();
    if (!engaged.some((e) => e.alive)) victory();
  }

  function handleEnemyClick(en) {
    if (phase !== 'player' || player.moving || !en.alive) return;
    hidePreview();
    const a = ACTIONS[armed];
    if (a.type === 'shove') {
      if (cheb(player.x, player.z, en.x, en.z) > 1) { log('Too far to shove.'); return; }
      if (ap < a.ap) { log('Not enough AP.'); return; }
      const dx = Math.sign(en.x - player.x);
      const dz = Math.sign(en.z - player.z);
      const tx = en.x + dx;
      const tz = en.z + dz;
      ap -= a.ap;
      player.lunge(en.x, en.z);
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
      refresh();
      if (!engaged.some((e) => e.alive)) victory();
      return;
    }
    if (a.ammoCost) {
      // ranged: needs range, line of sight, ammo, AP
      if (cheb(player.x, player.z, en.x, en.z) > THROW_RANGE) { log('Too far to throw.'); return; }
      if (!world.hasLos(player.x, player.z, en.x, en.z)) { log('No clear line to throw.'); return; }
      if (sheet.paper < ammoCostOf(armed)) { log('Out of paper.'); return; }
      if (ap < a.ap) { log('Not enough AP.'); return; }
      player.faceToward(en.x, en.z);
      performOn(armed, en);
      return;
    }
    // melee: walk up if needed, then strike
    if (cheb(player.x, player.z, en.x, en.z) <= 1) {
      if (ap < a.ap) { log('Not enough AP to attack.'); return; }
      player.faceToward(en.x, en.z);
      performOn(armed, en);
      return;
    }
    // walk the cheapest route to their side, as far as AP allows
    let best = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const p = world.findPath(player.x, player.z, en.x + dx, en.z + dz);
      if (p && (!best || p.length < best.length)) best = p;
    }
    if (!best || best.length < 2) { log('No way to reach them.'); return; }
    const walk = walkPlayer(best, ap - a.ap);
    if (!walk) { log('Not enough AP to reach them.'); return; }
    if (cheb(Math.round(walk.end[0]), Math.round(walk.end[1]), en.x, en.z) <= 1) {
      pendingMelee = en; // strike on arrival
    } else {
      log('You close the distance.');
    }
  }

  // Smooth a raw tile route and walk it, charging by DISTANCE (stepCost per
  // tile-length) and stopping mid-segment - at any free point - when `budget`
  // runs out. Optionally swap the final waypoint for a precise clicked point.
  // Spends the AP. Returns { done, end } or null if nothing was walkable.
  function walkPlayer(rawPath, budget, endPoint = null) {
    if (endPoint) rawPath = [...rawPath.slice(0, -1), endPoint];
    const s = world.smooth(rawPath);
    const { points, cost, done } = truncateByBudget(s, Math.max(0, budget), stepCost);
    if (points.length < 2 || cost < 0.05) return null;
    hidePreview();
    player.setPath(points);
    ap = Math.max(0, roundAp(ap - cost));
    refresh();
    return { done, end: points[points.length - 1] };
  }

  function handleTileClick(tile, point = null) {
    if (phase !== 'player' || player.moving || !tile) return;
    if (!world.isWalkable(tile.x, tile.z)) return;
    pendingMelee = null;
    if (point && tile.x === player.x && tile.z === player.z && player.entity) {
      // shuffling within the current tile is a move too
      const pos = player.entity.getPosition();
      walkPlayer([[pos.x, pos.z], world.clampPoint(point.x, point.z)], ap);
      return;
    }
    const p = world.findPath(player.x, player.z, tile.x, tile.z);
    if (!p || p.length < 2) return;
    walkPlayer(p, ap, point ? world.clampPoint(point.x, point.z) : null);
  }

  for (const b of buttons) {
    b.onclick = () => {
      if (phase !== 'player' || b.disabled) return;
      const id = b.dataset.action;
      const a = ACTIONS[id];
      if (a.type === 'attack' || a.type === 'shove') {
        armed = id; // arm it; clicking an enemy fires it
        log(`${a.label} armed. Click a target.`);
        refresh();
      } else if (a.type === 'defend') {
        ap -= a.ap;
        defended = true;
        log(a.log);
        refresh();
      } else if (a.type === 'heal') {
        if (a.uses && usesLeft[id] <= 0) return;
        if (a.uses) usesLeft[id] -= 1;
        ap -= a.ap;
        sheet.hp = Math.min(sheet.maxHp, sheet.hp + a.amount);
        fx.damageText(player.x, player.z, `+${a.amount}`, '#8adf76');
        log(a.log);
        refresh();
      }
    };
  }
  endBtn.onclick = () => {
    if (phase !== 'player') return;
    startEnemyPhase();
  };

  // --- enemy phase ----------------------------------------------------------------
  function startEnemyPhase() {
    phase = 'enemies';
    pendingMelee = null;
    hidePreview();
    enemyQueue = engaged.filter((e) => e.alive);
    acting = null;
    log('Their turn...');
    refresh();
  }

  function startPlayerTurn() {
    phase = 'player';
    ap = sheet.maxAp;
    defended = false;
    log('Your turn.');
    refresh();
  }

  function enemyAttack(en) {
    const atk = en.def.attacks[rand(0, en.def.attacks.length - 1)];
    let dmg = rand(atk.min, atk.max);
    let line = atk.log;
    if (defended) {
      dmg = Math.ceil(dmg / 2);
      line += ` You deflect - only ${dmg} damage.`;
    } else {
      line += ` ${dmg} damage.`;
    }
    en.lunge(player.x, player.z);
    player.flinch();
    sheet.hp = Math.max(0, sheet.hp - dmg);
    fx.damageText(player.x, player.z, `-${dmg}`);
    log(line);
    refresh();
    if (sheet.hp <= 0) defeat();
  }

  // Route toward the cheapest player-adjacent tile and walk it in ONE smooth
  // run, as far as `budget` allows (1 AP per tile-length) - no more
  // hop-pause-hop. Surface damage lands per tile entered via the actor's
  // onTile hook. Returns the AP actually spent (0 = couldn't move).
  function enemyAdvance(en, budget) {
    let best = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const tx = player.x + dx;
      const tz = player.z + dz;
      if (!world.isWalkable(tx, tz) && !(en.x === tx && en.z === tz)) continue;
      const p = world.findEnemyPath(en.x, en.z, tx, tz);
      if (p && p.length > 1 && (!best || p.length < best.length)) best = p;
    }
    if (!best) return 0;
    const s = world.smoothEnemy(en, best);
    const { points, cost } = truncateByBudget(s, budget, () => 1);
    if (points.length < 2 || cost < 0.05) return 0;
    en.onTile = (x, z, done, changed) => {
      if (changed) {
        // enemies feel the floor too
        const surf = world.enemySurfDamage(x, z);
        if (surf > 0) {
          const died = en.takeDamage(surf);
          fx.damageText(x, z, `-${surf}`, '#ffd76b');
          log(`${en.def.name} stumbles through the hazard. -${surf}.`);
          if (died) {
            callbacks.onEnemyKilled(en);
            refresh();
          }
        }
      }
      if (done || !en.alive) en.onTile = null;
    };
    en.setPath(points);
    return cost;
  }

  // --- per-frame driver -------------------------------------------------------------
  function update(dt) {
    if (phase === 'done') return;
    drawPreview(); // immediate-mode lines last one frame - redraw while shown
    // prune anyone killed externally (printer explosions during combat)
    if (!engaged.some((e) => e.alive)) { victory(); return; }
    if (phase === 'player') {
      // finish a queued walk-up strike
      if (pendingMelee && !player.moving) {
        const en = pendingMelee;
        pendingMelee = null;
        if (en.alive && cheb(player.x, player.z, en.x, en.z) <= 1 && ap >= ACTIONS[armed].ap) {
          player.faceToward(en.x, en.z);
          performOn(armed, en);
        }
      }
      return;
    }
    if (phase !== 'enemies') return;
    if (acting && acting.wait > 0) {
      acting.wait -= dt;
      return;
    }
    if (!acting) {
      const en = enemyQueue.shift();
      if (!en) { startPlayerTurn(); return; }
      if (!en.alive) return;
      if (en.surprised) {
        en.surprised = false;
        log(`${en.def.name} is still grabbing their lanyard.`);
        acting = { en, ap: 0, wait: 0.6 };
        return;
      }
      acting = { en, ap: en.def.ap, wait: 0.35 };
      return;
    }
    const { en } = acting;
    if (!en.alive) { acting = null; return; }
    if (en.moving) return; // let the current walk play out
    if (cheb(en.x, en.z, player.x, player.z) <= 1 && acting.ap >= ENEMY_ATTACK_AP) {
      enemyAttack(en);
      acting.ap -= ENEMY_ATTACK_AP;
      acting.wait = 0.55;
    } else if (acting.ap >= 1 && cheb(en.x, en.z, player.x, player.z) > 1) {
      const spent = enemyAdvance(en, acting.ap);
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

  // Read-only handle for tests.
  window.__combat = {
    get phase() { return phase; },
    get ap() { return ap; },
    get armed() { return armed; },
    get enemies() { return engaged.map((e) => ({ name: e.def.name, x: e.x, z: e.z, hp: e.hp, alive: e.alive })); },
  };

  return {
    handleTileClick,
    handleEnemyClick,
    handleHover,
    abort: cleanup, // for deaths resolved outside combat (surfaces, explosions)
    get active() { return phase !== 'done'; },
  };
}
