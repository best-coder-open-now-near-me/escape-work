// Escape Work - entry point and game flow. A Baldur's Gate / Divinity-style
// CRPG reskinned for office life.
//
// This file only wires the pieces together and owns the game flow (what
// happens on a click, when combat starts, when you win). The pieces live in
// focused modules - see ARCHITECTURE.md for the map. Content (tiles, enemies,
// classes, actions) is data in src/data/; levels are hand-editable JSON - or
// paintable in the built-in editor (#editor / the link on the class picker).
import { LEVELS, FIRST_LEVEL } from './data/levels.js';
import { SURFACES, ELECTRIFIED, FIRE, GUM } from './data/surfaces.js';
import { createSurfaceRuntime } from './surfaces-runtime.js';
import { ENEMY_TYPES } from './data/enemies.js';
import { CLASSES } from './data/classes.js';
import { ACTIONS } from './data/actions.js';
import { parseLevel } from './grid.js';
import { findPath, smoothPath, segmentClear, clampToClearance, approachPoint, DIRS8 } from './pathfinding.js';
import { createSheet, gainXp, applyDamage, PAPER_CAP } from './stats.js';
import { PlayerActor, EnemyActor, NpcActor } from './actors.js';
import { createApp, buildLevel } from './scene.js';
import { placeModel, applyCharacterProportions } from './models.js';
import { addHighlight, setHighlight } from './shading.js';
import { throwProjectile, spawnDamageText, worldToScreenCss } from './fx.js';
import { createControls } from './controls.js';
import { createPicker } from './picking.js';
import { createLooting } from './looting.js';
import { startCombat } from './combat.js';
import { startEditor } from './editor.js';
import { NPCS } from './data/npcs.js';
import * as ui from './ui.js';

const pc = window.pc;
const STASH_KEY = 'escape-work.playtest';
const PROGRESS_KEY = 'escape-work.progress';
const app = createApp(document.getElementById('app'));

// Level resolution, in priority order:
// 1. a playtest level stashed by the editor (standalone - no campaign)
// 2. campaign progress (mid-run floor + character sheet, saved on floor clear)
// 3. the first shipped level
let activeLevel = LEVELS[FIRST_LEVEL];
let activeLevelId = FIRST_LEVEL;
let playtesting = false;
let restoredSheet = null;
try {
  const stash = localStorage.getItem(STASH_KEY);
  const progress = localStorage.getItem(PROGRESS_KEY);
  if (stash) {
    activeLevel = JSON.parse(stash);
    activeLevelId = null;
    playtesting = true;
  } else if (progress) {
    const p = JSON.parse(progress);
    if (LEVELS[p.levelId]) {
      activeLevel = LEVELS[p.levelId];
      activeLevelId = p.levelId;
      restoredSheet = p.sheet || null;
    }
  }
} catch { /* corrupted storage - fall back to the shipped level */ }

const clearProgress = () => localStorage.removeItem(PROGRESS_KEY);

if (location.hash.includes('editor')) {
  startEditor(app, activeLevel, STASH_KEY);
} else {
  startGame(activeLevel);
}
app.start();

// ---------------------------------------------------------------------------------
function startGame(level) {
  const grid = parseLevel(level);
  // Object picking: a click/hover resolves to the interactable ENTITY under
  // the cursor (door, enemy, NPC, prop), not just the floor tile behind it.
  // Built before the scene so doors/props can register as they're created.
  const picking = createPicker();
  const scene = buildLevel(app, grid, { picking });
  const { walls, updateWallFade, animateSurfaces, floorHeight } = scene;
  // Fire and its consequences live in the surface runtime; handleExplosion is
  // hoisted from below.
  const runtime = createSurfaceRuntime({
    grid,
    hooks: { addFlame: scene.addFlame, hideSurfaceVisual: scene.hideSurfaceVisual },
    onExplosion: handleExplosion,
  });

  // The sheet (and the player's model) only exist once a class is picked - the
  // picker overlay is the first thing the player sees.
  let sheet = null;
  const player = new PlayerActor(grid.playerSpawn.x, grid.playerSpawn.z);
  const enemies = grid.enemySpawns.map((s) => new EnemyActor(s.x, s.z, s.type, ENEMY_TYPES[s.type]));
  // Non-hostile coworkers you talk to (data/npcs.js) - separate from `enemies`
  // so combat never engages them and they take no turns.
  const npcs = grid.npcSpawns.map((s) => new NpcActor(s.x, s.z, s.type, NPCS[s.type]));

  let inCombat = false;
  let combat = null; // active tactical-combat controller
  let gameOver = false;
  let lastPath = null; // kept for debugging/tests
  let pendingAction = null; // walk-up interaction, runs on arrival
  let armedOoc = null; // hotbar action armed OUT of combat (targets an enemy)
  let hotbar = null; // persistent attack bar (built once a class is picked)
  let hotbarPaper = -1; // last paper count the hotbar rendered (refresh gate)

  // --- gameplay tuning --------------------------------------------------------
  const ENGAGE_RADIUS = 4; // Chebyshev tiles within which enemies join a fight
  const EXPLOSION_DAMAGE = 8; // shrapnel to the player standing beside a printer
  const VICTORY_HEAL = 5; // the breather after winning a fight
  const STAIRWELL_HEAL = 6; // the breather between floors

  // Looting (containers, bodies, pockets, the Alt overlay) lives in its own
  // module; approachAndDo is hoisted, so wiring it here is safe.
  const loot = createLooting({
    app, grid, runtime, player, enemies,
    getSheet: () => sheet,
    isInCombat: () => inCombat,
    isGameOver: () => gameOver,
    approachAndDo: (x, z, run) => approachAndDo(x, z, run),
    extraEntries: () => doorEntries(), // doors share the Alt overlay
  });

  function abortCombat() {
    if (combat) {
      combat.abort();
      combat = null;
    }
    inCombat = false;
  }

  const enemyAt = (x, z) => enemies.find((e) => e.alive && e.x === x && e.z === z) || null;
  const npcAt = (x, z) => npcs.find((n) => n.x === x && n.z === z) || null;
  // NPCs stand on their tile and block movement like any body.
  const isWalkable = (x, z) => grid.terrainOpen(x, z) && !enemyAt(x, z) && !npcAt(x, z);
  // Surface queries, consulting the runtime (fire) before static state.
  const surfEffect = (x, z) => {
    if (runtime.isBurning(x, z)) return FIRE.onEnter;
    if (grid.isElectrified(x, z)) return ELECTRIFIED.onEnter;
    return SURFACES[runtime.surfaceAt(x, z)]?.onEnter || null;
  };
  // Raw surface damage on a cell, before anyone's talents. ENEMY decisions
  // (pathing, wander avoidance) run on this: what hurts a coworker has
  // nothing to do with the player's shoes.
  const rawSurfDamage = (x, z) => surfEffect(x, z)?.amount || 0;
  // What a step actually costs the PLAYER, after talents (Origami Specialist,
  // Rubber-Soled Shoes).
  const effectiveSurfDamage = (x, z) => {
    const fx = surfEffect(x, z);
    if (!fx || !fx.amount) return 0;
    const t = sheet?.talent?.effects || {};
    if (t.shockImmune && grid.isElectrified(x, z) && !runtime.isBurning(x, z)) return 0;
    if (t.paperCutImmune && runtime.surfaceAt(x, z) === 'paper' && !runtime.isBurning(x, z)) return 0;
    return Math.max(0, fx.amount - (t.surfaceDamageResist || 0));
  };
  const isHazard = (x, z) => effectiveSurfDamage(x, z) > 0;
  const enemyIsHazard = (x, z) => rawSurfDamage(x, z) > 0;
  // Wet floors are SLIPPERY - unless electrified or burning, which are
  // different problems. Chance per tile entered; safety tread ignores it.
  // Talent-free by design: enemies consult it too.
  const slipChanceAt = (x, z) => {
    if (grid.isElectrified(x, z) || runtime.isBurning(x, z)) return 0;
    return SURFACES[runtime.surfaceAt(x, z)]?.slippery || 0;
  };
  // A gum wad sticks to whoever steps on it - the tile is spent (the wad is
  // on their shoe now). Returns true if there was gum to collect.
  const stickGum = (x, z) => {
    if (runtime.surfaceAt(x, z) !== 'gum') return false;
    grid.setType(x, z, 'floor');
    scene.hideSurfaceVisual(x, z);
    return true;
  };
  // Dangerous/uncomfortable surfaces cost extra to path through, so
  // characters route around them unless told otherwise or there is no other
  // way; smoothing must never straighten a route through a damaging cell the
  // route avoided. The player and enemies get separate cost models - talents
  // discount only the player's.
  const hazardCost = (x, z) => {
    if (runtime.isBurning(x, z)) return FIRE.pathCost;
    if (grid.isElectrified(x, z)) {
      return sheet?.talent?.effects?.shockImmune ? 1 : ELECTRIFIED.pathCost;
    }
    return SURFACES[runtime.surfaceAt(x, z)]?.pathCost || 0;
  };
  const enemyHazardCost = (x, z) => {
    if (runtime.isBurning(x, z)) return FIRE.pathCost;
    if (grid.isElectrified(x, z)) return ELECTRIFIED.pathCost;
    return SURFACES[runtime.surfaceAt(x, z)]?.pathCost || 0;
  };
  const clearOfHazards = (x, z) => isWalkable(x, z) && !isHazard(x, z);
  const enemyClearOfHazards = (x, z) => isWalkable(x, z) && !enemyIsHazard(x, z);

  // --- populate the scene -----------------------------------------------------
  const lift = floorHeight / 2;
  for (const en of enemies) {
    placeModel(app, `assets/characters/${en.def.model}.glb`, en.x, en.z, {
      lift, rotY: -90, animate: true,
      onReady: (e) => { applyCharacterProportions(e); en.attach(e); picking.register(e, 'enemy', en); },
    });
  }
  for (const npc of npcs) {
    placeModel(app, `assets/characters/${npc.def.model}.glb`, npc.x, npc.z, {
      lift, rotY: 90, animate: true,
      onReady: (e) => {
        applyCharacterProportions(e);
        npc.attach(e);
        npc.faceToward(player.x, player.z);
        picking.register(e, 'npc', npc);
      },
    });
  }
  // (Furniture is no longer set dressing here - props are solid tiles in the
  // level data, rendered by buildLevel and respected by pathfinding.)

  // --- game flow ----------------------------------------------------------------
  function spawnPlayerModel() {
    placeModel(app, `assets/characters/${sheet.model}.glb`, player.x, player.z, {
      lift, rotY: 90, animate: true, onReady: (e) => { applyCharacterProportions(e); player.attach(e); },
    });
    ui.updateStatsHud(sheet);
  }

  // --- class-carousel 3D preview ------------------------------------------------
  // While the picker is up, the browsed candidate idles on the spawn tile on
  // a slow turntable, camera dollied in. The token guards rapid carousel
  // flips against async .glb loads landing out of order.
  let previewEntity = null;
  let previewToken = 0;
  const previewSpin = (dt) => { if (previewEntity) previewEntity.rotate(0, 35 * dt, 0); };
  function previewClass(classId) {
    const token = ++previewToken;
    if (previewEntity) { previewEntity.destroy(); previewEntity = null; }
    placeModel(app, `assets/characters/${CLASSES[classId].model}.glb`, player.x, player.z, {
      lift, rotY: 45, animate: true, // start facing the head-on camera
      onReady: (e) => {
        applyCharacterProportions(e);
        if (token !== previewToken) { e.destroy(); return; }
        previewEntity = e;
      },
    });
  }
  function endClassPreview() {
    previewToken += 1;
    if (previewEntity) { previewEntity.destroy(); previewEntity = null; }
    app.off('update', previewSpin);
    controls.setView({ dist: 26, pitch: 55, focusY: 0.3 }); // tactical camera
  }

  function onClassPicked(classId) {
    endClassPreview();
    sheet = createSheet(classId);
    spawnPlayerModel();
    loot.refreshPanel(sheet);
    buildHotbar();
    ui.say(`${sheet.className}. Now get out of here. (Alt shows loot, I opens pockets, 1-9 to aim an attack.)`);
  }

  // Every way to die funnels through here: freeze the world, drop any active
  // combat, wipe the campaign save, roll credits.
  function loseGame(message) {
    gameOver = true;
    player.clearPath();
    abortCombat();
    clearProgress();
    ui.showLoseScreen(message);
  }

  // Every enemy death pays out the same way - combat kill, shove into live
  // water, or a printer taking them along. Promotions announce themselves.
  function awardKill(dead) {
    if (!sheet) return;
    const promoted = gainXp(sheet, dead.def.xp);
    if (promoted) ui.say(`Promotion! Level ${sheet.level}: fully rested, +1 damage.`);
    ui.updateStatsHud(sheet);
  }

  // Blowing up a printer: flash, clear the tile, flatten anyone beside it.
  function handleExplosion(x, z) {
    scene.explosionFlash(x, z);
    grid.setType(x, z, 'floor');
    scene.removePropVisual(x, z);
    const slain = enemies.filter((en) =>
      en.alive && Math.abs(en.x - x) <= 1 && Math.abs(en.z - z) <= 1);
    for (const en of slain) en.die();
    let msg = 'The printer detonates in a cloud of toner.';
    if (slain.length) msg += ` ${slain.length} coworker${slain.length === 1 ? '' : 's'} caught in the blast (+XP).`;
    if (sheet && player.entity && Math.abs(player.x - x) <= 1 && Math.abs(player.z - z) <= 1) {
      const dead = applyDamage(sheet, EXPLOSION_DAMAGE);
      player.flinch();
      vfx.damageText(player.x, player.z, `-${EXPLOSION_DAMAGE}`);
      msg += ` You catch shrapnel. -${EXPLOSION_DAMAGE} HP.`;
      if (dead) {
        ui.say(msg);
        loseGame('PC LOAD LETTER. Fatal.');
        return;
      }
    }
    ui.say(msg);
    for (const en of slain) awardKill(en);
    if (sheet) ui.updateStatsHud(sheet);
  }

  function igniteAt(x, z) {
    const wasProp = !!grid.defAt(x, z).ignitable;
    if (runtime.ignite(x, z)) {
      ui.say(wasProp
        ? 'You introduce the trash can to fire. It goes about as expected.'
        : 'A flick of the lighter. The paperwork ascends.');
    }
  }

  // Smooth a raw tile path into any-angle runs, starting from where the
  // player's body actually stands - not their tile centre, which they may be
  // nowhere near after a free-point stop.
  function smoothFromBody(p) {
    const pos = player.entity?.getPosition();
    if (pos) p = [[pos.x, pos.z], ...p.slice(1)];
    return smoothPath(clearOfHazards, p, grid.edgeOpen);
  }
  // Where the body may actually stand: the exact clicked point, pulled in
  // from walls/partitions so the model never clips them.
  const clampPoint = (x, z) => clampToClearance(grid.terrainOpen, grid.edgeOpen, x, z);
  // Walk-up landing spot: at reach of the target's body inside goal tile
  // (gx, gz), instead of the tile's dead centre.
  const approachTo = (gx, gz, tx, tz) => approachPoint(grid.terrainOpen, grid.edgeOpen, gx, gz, tx, tz);

  // Walk within reach of (x, z), then run the interaction.
  function approachAndDo(x, z, run) {
    if (!sheet || inCombat || gameOver) return;
    if (Math.abs(player.x - x) <= 1 && Math.abs(player.z - z) <= 1) {
      run();
      return;
    }
    let best = null;
    for (const [dx, dz] of DIRS8) {
      const ax = x + dx;
      const az = z + dz;
      if (!isWalkable(ax, az)) continue;
      const p = findPath(isWalkable, player.x, player.z, ax, az, hazardCost, grid.stepOpen);
      if (p && (!best || p.length < best.length)) best = p;
    }
    if (!best || best.length < 2) return;
    pendingAction = { x, z, run };
    const [gx, gz] = best[best.length - 1];
    best[best.length - 1] = approachTo(gx, gz, x, z);
    const s = smoothFromBody(best);
    player.setPath(s);
    lastPath = s;
  }

  // Walk to the exact clicked point (BG3-style free movement), not the tile
  // centre: route on the grid, then swap the final waypoint for the clamped
  // click point. A click inside the current tile just shuffles over.
  function moveTo(tile, point = null) {
    if (!tile || !sheet || inCombat || gameOver || !isWalkable(tile.x, tile.z)) return;
    pendingAction = null;
    if (point && tile.x === player.x && tile.z === player.z && player.entity) {
      const pos = player.entity.getPosition();
      const s = [[pos.x, pos.z], clampPoint(point.x, point.z)];
      player.setPath(s);
      lastPath = s;
      return;
    }
    const p = findPath(isWalkable, player.x, player.z, tile.x, tile.z, hazardCost, grid.stepOpen);
    if (p && p.length > 1) {
      if (point) p[p.length - 1] = clampPoint(point.x, point.z);
      // Smoothed: straight any-angle runs wherever line of sight is clear.
      const s = smoothFromBody(p);
      player.setPath(s);
      lastPath = s;
    }
  }

  // Walk to the open tile nearest an enemy; combat starts on arrival via the
  // adjacency check in onPlayerStep.
  function confront(en) {
    if (!en || !en.alive || inCombat || gameOver) return;
    pendingAction = null;
    let best = null;
    for (const [dx, dz] of DIRS8) {
      const ax = en.x + dx;
      const az = en.z + dz;
      if (!isWalkable(ax, az)) continue;
      const p = findPath(isWalkable, player.x, player.z, ax, az, hazardCost, grid.stepOpen);
      if (p && (!best || p.length < best.length)) best = p;
    }
    if (!best) return;
    if (best.length > 1) {
      const [gx, gz] = best[best.length - 1];
      const bp = en.entity?.getPosition() || en;
      best[best.length - 1] = approachTo(gx, gz, bp.x, bp.z);
      const s = smoothFromBody(best);
      player.setPath(s);
      lastPath = s;
    } else {
      checkCombatTrigger();
    }
  }

  // --- doors --------------------------------------------------------------------
  // A door is an EDGE, not a tile - clicks find the nearest door edge to the
  // precise ground point, walk to either side, and swing it.
  function doorNearPoint(point) {
    if (!point) return null;
    const x = Math.round(point.x);
    const z = Math.round(point.z);
    const dx = point.x - x;
    const dz = point.z - z;
    if (0.5 - Math.max(Math.abs(dx), Math.abs(dz)) > 0.3) return null; // not near any edge
    const key = Math.abs(dx) >= Math.abs(dz)
      ? 'v:' + (dx > 0 ? x + 1 : x) + ',' + z
      : 'h:' + x + ',' + (dz > 0 ? z + 1 : z);
    return grid.doors.has(key) ? key : null;
  }
  const doorSides = (key) => {
    const [x, z] = key.slice(2).split(',').map(Number);
    return key[0] === 'h' ? [[x, z - 1], [x, z]] : [[x - 1, z], [x, z]];
  };
  function toggleDoor(key) {
    if (inCombat || gameOver) return;
    const open = !grid.doors.get(key).open;
    grid.setDoorOpen(key, open);
    scene.refreshDoor(key);
    for (const e of enemies) e.clearPath(); // their routes may have just changed
    ui.say(open ? 'The door swings open.' : 'You pull the door shut.');
    if (loot.labelsVisible) loot.showLabels();
  }
  function approachDoor(key) {
    const sides = doorSides(key);
    const [ax, az] = isWalkable(sides[0][0], sides[0][1]) ? sides[0] : sides[1];
    approachAndDo(ax, az, () => toggleDoor(key));
  }
  // Doors join the Alt overlay through the looting module's extraEntries
  // hook (doors aren't loot, so the door logic stays here).
  function doorEntries() {
    const out = [];
    const near = (x, z) => Math.max(Math.abs(x - player.x), Math.abs(z - player.z)) <= 10;
    for (const [key, d] of grid.doors) {
      const [x, z] = key.slice(2).split(',').map(Number);
      const wx = key[0] === 'v' ? x - 0.5 : x;
      const wz = key[0] === 'h' ? z - 0.5 : z;
      if (!near(Math.round(wx), Math.round(wz))) continue;
      out.push({
        icon: '🚪',
        text: d.open ? 'Door (open)' : 'Door',
        world: { x: wx, y: 0.95, z: wz },
        onClick: () => approachDoor(key),
      });
    }
    return out;
  }

  // --- targeting, hover highlight, cursor --------------------------------------
  const THROW_RANGE = 5; // must match combat.js
  const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
  // Throws sail over chest-high partitions but not closed doors (grid.sightOpen).
  const hasLos = (a, b) => segmentClear(grid.terrainOpen, a.x, a.z, b.x, b.z, grid.sightOpen);
  const throwAmmoCost = (id) => {
    const base = ACTIONS[id].ammoCost || 0;
    const disc = sheet?.talent?.effects?.paperAmmoDiscount || 0;
    return base > 1 ? Math.max(1, base - disc) : base;
  };
  // Out of combat there's no AP budget: a thrown opener needs range + line +
  // ammo; melee/shove just walk you in, so they can always open a fight.
  const oocTargetOk = (id, en) => {
    const a = ACTIONS[id];
    if (a.ammoCost) {
      return cheb(player, en) <= THROW_RANGE && hasLos(player, en) && (sheet?.paper || 0) >= throwAmmoCost(id);
    }
    return true;
  };

  // BG3-style hover glow: one colored inverted-hull shell per interactable
  // (shading.addHighlight), built lazily, toggled/recolored as the cursor
  // moves. Color reads the target's nature: hostile red, talkable green,
  // lootable gold, neutral interactable (doors/props) cyan.
  const HL = {
    enemy: [1.0, 0.28, 0.2],
    npc: [0.42, 0.85, 0.42],
    loot: [1.0, 0.82, 0.4],
    interact: [0.5, 0.8, 1.0],
  };
  const canvasEl = document.getElementById('app');
  const hlShells = new WeakMap(); // holder entity -> highlight shell (or null)
  let hoverEntity = null;
  let hoverShell = null;
  let hoverKind = null; // exposed for tests
  function highlightShellFor(holder) {
    if (!hlShells.has(holder)) hlShells.set(holder, addHighlight(holder));
    return hlShells.get(holder);
  }
  function setHoverHighlight(holder, rgb) {
    if (holder === hoverEntity) {
      if (holder && hoverShell) setHighlight(hoverShell, true, rgb);
      return;
    }
    if (hoverShell) { try { setHighlight(hoverShell, false); } catch { /* holder gone */ } }
    hoverEntity = holder;
    hoverShell = holder ? highlightShellFor(holder) : null;
    if (hoverShell) setHighlight(hoverShell, true, rgb);
  }
  const clearHoverHighlight = () => setHoverHighlight(null, null);
  const setCursor = (c) => { if (canvasEl) canvasEl.style.cursor = c || ''; };

  const colorForHit = (hit) =>
    hit.kind === 'enemy' ? (hit.ref.alive ? HL.enemy : HL.loot)
      : hit.kind === 'npc' ? HL.npc : HL.interact;

  function cursorFor(hit, point) {
    if (armedOoc) {
      if (hit && hit.kind === 'enemy' && hit.ref.alive) {
        return oocTargetOk(armedOoc, hit.ref) ? 'crosshair' : 'not-allowed';
      }
      return 'default';
    }
    if (hit) {
      if (hit.kind === 'enemy') return hit.ref.alive ? 'crosshair' : 'pointer';
      if (hit.kind === 'npc') return 'help';
      return 'pointer'; // door, prop
    }
    // Flat targets the pick ray misses (corpses, dropped items, a door edge
    // clicked on the floor) still deserve the interact cursor.
    if (point) {
      const tx = Math.round(point.x);
      const tz = Math.round(point.z);
      if (doorNearPoint(point)) return 'pointer';
      if (loot.corpseAt(tx, tz) || loot.looseAt(tx, tz).length || grid.defAt(tx, tz).loot) return 'pointer';
    }
    return 'default';
  }

  // Out-of-combat hover: highlight what's under the cursor and pick a cursor.
  function worldHover(point, sx, sy) {
    const hit = picking.pick(controls.cameraEntity, sx, sy);
    hoverKind = hit ? hit.kind : null;
    if (hit) setHoverHighlight(hit.entity, colorForHit(hit));
    else clearHoverHighlight();
    setCursor(cursorFor(hit, point));
  }

  // Immediate-mode target rings for an armed hotbar action (redrawn each frame
  // while armed, like combat's own target rings).
  const RING_OK = new pc.Color(0.42, 0.78, 0.35);
  const RING_FAR = new pc.Color(0.85, 0.28, 0.24);
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
  function drawOocTargets() {
    for (const en of enemies) {
      if (!en.alive || !en.entity) continue;
      const pos = en.entity.getPosition();
      drawRing(pos.x, pos.z, 0.5, oocTargetOk(armedOoc, en) ? RING_OK : RING_FAR);
    }
  }

  // --- left-click verb dispatch (Divinity-style: the target picks the verb) ---
  function attackOrConfront(en) {
    const a = armedOoc && ACTIONS[armedOoc];
    if (a && (a.type === 'attack' || a.type === 'shove')) engageWithAction(en, armedOoc);
    else confront(en);
  }
  // Act on the interactable ENTITY under the cursor. Returns true if handled.
  function dispatchHit(hit) {
    const { kind, ref } = hit;
    if (kind === 'door') { approachDoor(ref); return true; }
    if (kind === 'npc') { approachAndDo(ref.x, ref.z, () => dialogue.open(ref)); return true; }
    if (kind === 'enemy') {
      if (ref.alive) { attackOrConfront(ref); return true; }
      if (ref.loot?.length) approachAndDo(ref.x, ref.z, () => loot.lootBody(ref)); // corpse
      return true;
    }
    if (kind === 'prop') { approachAndDo(ref.x, ref.z, () => loot.lootContainer(ref.x, ref.z)); return true; }
    return false;
  }

  // --- dialogue (minimal talking layer) ---------------------------------------
  const dialoguePanel = ui.createDialoguePanel();
  let dialogueNpc = null;
  const dialogue = {
    open(npc) {
      if (inCombat || gameOver || !npc) return;
      dialogueNpc = npc;
      npc.faceToward(player.x, player.z);
      loot.hideLabels();
      clearHoverHighlight();
      setCursor(null);
      renderDialogueNode(npc.def.dialogue.start);
    },
    close() { dialogueNpc = null; dialoguePanel.hide(); },
    get visible() { return dialoguePanel.visible; },
  };
  function renderDialogueNode(nodeId) {
    const tree = dialogueNpc?.def.dialogue;
    const node = tree?.nodes[nodeId];
    if (!node) { dialogue.close(); return; }
    dialoguePanel.show({
      name: dialogueNpc.def.name,
      text: node.text,
      options: (node.options || [{ label: 'Leave', next: null }]).map((o) => ({
        label: o.label,
        action: () => { if (o.next) renderDialogueNode(o.next); else dialogue.close(); },
      })),
    });
  }

  // --- persistent attack hotbar ------------------------------------------------
  // The offensive slice of the action list: things that target an enemy and
  // can OPEN a fight. Heal/defend stay combat-only (they're reactive - no
  // meaning with nobody swinging at you); out of combat you heal from pockets.
  function offensiveActionIds() {
    const throwables = Object.keys(ACTIONS).filter((id) => ACTIONS[id].ammoCost);
    const seen = new Set();
    return [...sheet.actions, 'shove', ...throwables].filter((id) => {
      if (seen.has(id) || !ACTIONS[id]) return false;
      seen.add(id);
      const t = ACTIONS[id].type;
      return t === 'attack' || t === 'shove';
    });
  }
  function buildHotbar() {
    const ids = offensiveActionIds();
    hotbar = ui.createHotbar(
      ids.map((id) => ({ id, label: ACTIONS[id].label, ap: ACTIONS[id].ap, ammoCost: ACTIONS[id].ammoCost })),
      { onArm: toggleOocArm },
    );
    hotbar.refresh(sheet);
    hotbarPaper = sheet.paper;
  }
  function toggleOocArm(id) {
    if (!sheet || inCombat || gameOver || dialogue.visible || !ACTIONS[id]) return;
    armedOoc = armedOoc === id ? null : id;
    hotbar?.setArmed(armedOoc);
    ui.say(armedOoc ? `${ACTIONS[armedOoc].label} ready — click a coworker to start it.` : 'You stand down.');
  }

  const adjacentEnemy = () =>
    enemies.find((e) => e.alive && Math.abs(player.x - e.x) <= 1 && Math.abs(player.z - e.z) <= 1) || null;

  // Start (or refuse to start) a fight. `engaged` is everyone joining now,
  // `primary` the coworker who triggered it (drives the flavor line + facing),
  // `opening` an optional { actionId, target } fired as the first move when the
  // fight is kicked off from the persistent hotbar.
  function beginCombat({ engaged, primary, opening = null }) {
    if (!sheet || inCombat || gameOver || !player.entity) return;
    player.clearPath();
    for (const e of enemies) e.clearPath(); // freeze any in-flight wander
    pendingAction = null;
    armedOoc = null;
    hotbar?.setArmed(null);
    dialogue.close();
    inCombat = true;
    ui.hideMenu();
    loot.hideLabels(); // no browsing the shelves mid-fight
    clearHoverHighlight();
    setCursor(null);
    // Everyone close enough joins the brawl (those further than 2 tiles are
    // surprised and lose their first turn - see combat.js). Bystanders
    // outside the radius join later if attacked (combat.js joinCombat).
    player.faceToward(primary.x, primary.z);
    primary.faceToward(player.x, player.z);
    const live = engaged.filter((e) => e.alive).length;
    ui.say(live > 1
      ? `${primary.def.name} has noticed you. So have ${live - 1} other${live > 2 ? 's' : ''}.`
      : `${primary.def.name} has noticed you.`);
    combat = startCombat({
      app,
      sheet,
      player,
      engaged,
      opening,
      world: {
        isWalkable,
        findPath: (sx, sz, tx, tz) => findPath(isWalkable, sx, sz, tx, tz, hazardCost, grid.stepOpen),
        // Enemy routing: never through the player's tile, and costed by the
        // enemy hazard model - the player's talents don't shape THEIR fears.
        findEnemyPath: (sx, sz, tx, tz) => findPath(
          (x, z) => isWalkable(x, z) && !(x === player.x && z === player.z),
          sx, sz, tx, tz, enemyHazardCost, grid.stepOpen),
        // Any-angle smoothing for combat walks. The player variant starts
        // from their body position; the enemy variant treats the enemy's own
        // tile as open (they're standing on it) and starts from their body.
        smooth: (p) => smoothFromBody(p),
        smoothEnemy: (en, p) => {
          const pos = en.entity?.getPosition();
          if (pos) p = [[pos.x, pos.z], ...p.slice(1)];
          return smoothPath(
            (x, z) => (x === en.x && z === en.z ? grid.terrainOpen(x, z) : enemyClearOfHazards(x, z)),
            p, grid.edgeOpen);
        },
        clampPoint,
        approach: approachTo,
        // Partitions (edge walls) are chest height: they block movement but
        // not throws - lob paper right over the cubicle wall. Closed doors go
        // floor to frame, so they DO stop throws (grid.sightOpen).
        hasLos: (ax, az, bx, bz) => segmentClear(grid.terrainOpen, ax, az, bx, bz, grid.sightOpen),
        stepOpen: grid.stepOpen,
        surfaceIdAt: (x, z) => runtime.surfaceAt(x, z),
        isElectrified: (x, z) => grid.isElectrified(x, z),
        enemySurfDamage: (x, z) => rawSurfDamage(x, z),
        slipChanceAt,
        stickGum,
        // Cone attacks carpet plain floor with a surface tile (Bulk Mail ->
        // paper). Only bare floor converts - carpets, surfaces, props stay.
        leaveSurface: (x, z, tileType) => {
          if (grid.typeAt(x, z) !== 'floor') return false;
          grid.setType(x, z, tileType);
          scene.addSurfaceVisual(x, z, tileType);
          return true;
        },
        // Anyone alive is a legal target - bystanders outside the initial
        // engagement get pulled in when attacked.
        liveEnemies: () => enemies.filter((e) => e.alive),
      },
      fx: vfx,
      callbacks: {
        say: ui.say,
        updateHud: () => ui.updateStatsHud(sheet),
        onEnemyKilled: awardKill,
        onWin: () => {
          inCombat = false;
          combat = null;
          // A breather after every victory, so back-to-back fights aren't a
          // death spiral - wounds still carry over, just less brutally.
          sheet.hp = Math.min(sheet.maxHp, sheet.hp + VICTORY_HEAL);
          ui.say(`The floor is yours. You catch your breath. (+${VICTORY_HEAL} HP)`);
          ui.updateStatsHud(sheet);
        },
        onLose: () => {
          inCombat = false;
          combat = null;
          loseGame('The office wins this round. Darkness falls between the cubicles.');
        },
      },
    });
  }

  // Proximity trigger: an adjacent coworker starts the fight (walk into range,
  // or get cornered). Everyone within the engage radius joins.
  function checkCombatTrigger() {
    if (!sheet || inCombat || gameOver || !player.entity) return;
    const en = adjacentEnemy();
    if (!en) return;
    const engaged = enemies.filter((e) =>
      e.alive && Math.max(Math.abs(e.x - player.x), Math.abs(e.z - player.z)) <= ENGAGE_RADIUS);
    beginCombat({ engaged, primary: en });
  }

  // Hotbar trigger: an armed attack, aimed at a coworker, opens combat with
  // that move. The clicked target joins even if it's beyond the engage radius
  // (a thrown opener can reach further than the auto-engage does).
  function engageWithAction(en, actionId) {
    if (!sheet || inCombat || gameOver || !en?.alive) return;
    const engaged = enemies.filter((e) =>
      e.alive && Math.max(Math.abs(e.x - player.x), Math.abs(e.z - player.z)) <= ENGAGE_RADIUS);
    if (!engaged.includes(en)) engaged.push(en);
    beginCombat({ engaged, primary: en, opening: { actionId, target: en } });
  }

  // Tile effects (data-driven from TILE_TYPES[..].onEnter) fire per step.
  // Hazards hit on any step; the exit only fires when it's the destination, so
  // pathing past it doesn't end the level by accident.
  function onPlayerStep(x, z, pathDone, changed = true) {
    const fx = grid.defAt(x, z).onEnter;
    if (fx) {
      if (fx.effect === 'exit' && pathDone && !inCombat) {
        gameOver = true;
        player.clearPath();
        // Mid-campaign exits lead to the next floor (the sheet - wounds, XP,
        // coffee habits - carries over via saved progress). The last floor,
        // and any playtest level, ends the run.
        if (!playtesting && level.next && LEVELS[level.next]) {
          // A breather in the stairwell, so you never start a floor one
          // puddle away from death.
          sheet.hp = Math.min(sheet.maxHp, sheet.hp + STAIRWELL_HEAL);
          localStorage.setItem(PROGRESS_KEY, JSON.stringify({ levelId: level.next, sheet }));
          ui.showFloorClear({ nextName: LEVELS[level.next].name }, () => location.reload());
        } else {
          clearProgress();
          ui.showWinScreen({ level: sheet.level, defeated: enemies.filter((e) => !e.alive).length });
        }
        return;
      }
      if (fx.effect === 'damage' && changed) {
        const dead = applyDamage(sheet, fx.amount);
        player.flinch();
        vfx.damageText(x, z, `-${fx.amount}`);
        ui.say(fx.message);
        ui.updateStatsHud(sheet);
        if (dead) {
          loseGame('Done in by the office itself. The floor was, in fact, wet.');
          return;
        }
      }
    }
    // Paper-cut bleeding drips on every tile entered while it lasts.
    if (changed && sheet.bleed > 0) {
      sheet.bleed -= 1;
      const bled = applyDamage(sheet, 1);
      vfx.damageText(x, z, '-1');
      ui.say('You drip on the carpet. -1 HP.');
      ui.updateStatsHud(sheet);
      if (bled) {
        loseGame('Death by a thousand paper cuts. Well - several.');
        return;
      }
    }
    // Surface effects (data/surfaces.js): fire and electrified pools hurt,
    // paper cuts (and arms you), water and coffee editorialize. Talents can
    // shrug damage off. Only on genuine tile entry.
    const sfx = changed ? surfEffect(x, z) : null;
    if (sfx) {
      if (sfx.ammo) {
        sheet.paper = Math.min(PAPER_CAP, sheet.paper + sfx.ammo);
        vfx.damageText(x, z, '+📄', '#8adf76');
      }
      // Gum on shoe: slowed, no kicking, but genuine traction (can't slip).
      if (sfx.applies === 'gum' && stickGum(x, z)) {
        const had = sheet.gum > 0;
        sheet.gum = GUM.steps;
        ui.say(had ? 'More gum. You are building a collection.' : sfx.message);
        ui.updateStatsHud(sheet);
      }
      const amount = effectiveSurfDamage(x, z);
      if (amount > 0) {
        if (sfx.bleed) sheet.bleed = Math.max(sheet.bleed, sfx.bleed);
        const dead = applyDamage(sheet, amount);
        player.flinch();
        vfx.damageText(x, z, `-${amount}`);
        ui.say(sfx.message);
        ui.updateStatsHud(sheet);
        if (dead) {
          loseGame('Done in by the office itself. Facilities sends their regards.');
          return;
        }
      } else if (sfx.amount) {
        ui.say(sheet.talent?.effects?.shockImmune && grid.isElectrified(x, z)
          ? 'The water crackles. Your ESD soles rate this a non-event. 0 damage.'
          : 'You glide across the drift, harvesting ammunition. The edges respect a master. (+1 paper)');
        ui.updateStatsHud(sheet);
      } else if (sfx.message && !sfx.applies) {
        ui.say(sfx.message);
      }
    }
    // Slippery surfaces: every wet tile entered risks a spill that ends the
    // walk right there. In combat the movement AP already spent stays spent -
    // that IS the penalty. slipImmune tread never slips; neither does a
    // gummed shoe - gum is traction.
    if (changed && !gameOver && !sheet.talent?.effects?.slipImmune && !(sheet.gum > 0)) {
      const chance = slipChanceAt(x, z);
      if (chance && Math.random() < chance) {
        player.clearPath();
        player.flinch();
        vfx.damageText(x, z, 'slip!', '#8ad4df');
        if (inCombat) combat?.notifySlip();
        else ui.say('The floor was, in fact, wet. You go down. Gracefully? No.');
      }
    }
    // Gum wears off with mileage.
    if (changed && sheet.gum > 0) {
      sheet.gum -= 1;
      if (sheet.gum === 0) {
        ui.say('The gum finally lets go of your sole. Freedom.');
        ui.updateStatsHud(sheet);
      }
    }
    // Walk-up interactions (lighting trash cans) fire on deliberate arrival.
    if (pendingAction && pathDone
      && Math.abs(x - pendingAction.x) <= 1 && Math.abs(z - pendingAction.z) <= 1) {
      const act = pendingAction;
      pendingAction = null;
      act.run();
    }
    checkCombatTrigger();
  }

  // --- input --------------------------------------------------------------------
  const controls = createControls({
    app,
    canvas: document.getElementById('app'),
    focus: grid.playerSpawn,
    onAnyLeftPress: () => ui.hideMenu(),
    onLeftClickTile: (tile, point, sx, sy) => {
      if (!sheet || gameOver) return;
      // In combat, targeting stays tile-based: the tactical grid (movement
      // previews, AP, target rings) is all tile/ground-keyed, and a click must
      // hit the enemy on the CLICKED tile, not whichever body the ray grazes.
      if (inCombat) {
        if (!tile) return;
        const en = enemyAt(tile.x, tile.z);
        if (en) combat?.handleEnemyClick(en);
        else combat?.handleTileClick(tile, point);
        return;
      }
      if (dialogue.visible) return; // talking: clicks belong to the panel
      // Out of combat, the interactable ENTITY under the cursor wins over the
      // floor tile behind it - what finally makes a click on the tall door
      // mesh (or a standing enemy) land on the thing you aimed at.
      const hit = picking.pick(controls.cameraEntity, sx, sy);
      if (hit && dispatchHit(hit)) return;
      if (!tile) return;
      // Ground fallback - also catches flat targets the pick ray skims over: a
      // door edge clicked on the floor, corpses, dropped items.
      const en = enemyAt(tile.x, tile.z);
      const npc = npcAt(tile.x, tile.z);
      const corpse = loot.corpseAt(tile.x, tile.z);
      const doorKey = doorNearPoint(point);
      if (en) attackOrConfront(en);
      else if (npc) approachAndDo(npc.x, npc.z, () => dialogue.open(npc));
      else if (doorKey) approachDoor(doorKey);
      else if (grid.defAt(tile.x, tile.z).loot) {
        approachAndDo(tile.x, tile.z, () => loot.lootContainer(tile.x, tile.z));
      } else if (corpse) {
        approachAndDo(corpse.x, corpse.z, () => loot.lootBody(corpse));
      } else if (loot.looseAt(tile.x, tile.z).length) {
        approachAndDo(tile.x, tile.z, () => loot.pickUpAt(tile.x, tile.z));
      } else moveTo(tile, point);
    },
    onHover: (point, sx, sy) => {
      if (inCombat && combat) { combat.handleHover(point, sx, sy); return; }
      if (!sheet || gameOver || dialogue.visible) { clearHoverHighlight(); setCursor(null); return; }
      worldHover(point, sx, sy);
    },
    onRightClickTile: (tile, sx, sy, point) => {
      if (!sheet || inCombat || gameOver || dialogue.visible) return;
      const hit = picking.pick(controls.cameraEntity, sx, sy);
      if (hit && hit.kind === 'npc') {
        ui.showMenu(sx, sy, [
          { label: `Talk to ${hit.ref.def.name}`, action: () => approachAndDo(hit.ref.x, hit.ref.z, () => dialogue.open(hit.ref)) },
          { label: 'Examine', action: () => ui.say(hit.ref.def.examine || 'A coworker. Non-hostile, for now.') },
        ]);
        return;
      }
      if (!tile) return;
      const doorKey = (hit && hit.kind === 'door') ? hit.ref : doorNearPoint(point);
      if (doorKey) {
        const open = grid.doors.get(doorKey).open;
        ui.showMenu(sx, sy, [
          { label: open ? 'Close the door' : 'Open the door', action: () => approachDoor(doorKey) },
          {
            label: 'Examine',
            action: () => ui.say(open
              ? 'An office door, ajar. A bold statement of availability.'
              : 'A closed office door. The universal sign for "do not perceive me."'),
          },
        ]);
        return;
      }
      const en = (hit && hit.kind === 'enemy' && hit.ref.alive) ? hit.ref : enemyAt(tile.x, tile.z);
      if (en) {
        ui.showMenu(sx, sy, [
          { label: `Confront ${en.def.name}`, action: () => confront(en) },
          { label: 'Avoid eye contact', action: () => ui.say('You study your shoes intently.') },
          { label: 'Examine', action: () => ui.say(en.def.examine) },
        ]);
      } else if (isWalkable(tile.x, tile.z)) {
        const surfId = runtime.surfaceAt(tile.x, tile.z);
        const flavor = runtime.isBurning(tile.x, tile.z)
          ? FIRE.examine
          : grid.isElectrified(tile.x, tile.z)
            ? ELECTRIFIED.examine
            : (surfId && SURFACES[surfId].examine) || 'Standard-issue office carpet. Faintly damp.';
        const items = [
          { label: 'Walk here', action: () => moveTo(tile, point) },
          { label: 'Examine', action: () => ui.say(flavor) },
        ];
        const here = loot.looseAt(tile.x, tile.z);
        if (here.length) {
          items.unshift({
            label: `Pick up ${loot.itemName(here[0].id)}${here.length > 1 ? ` (+${here.length - 1})` : ''}`,
            action: () => approachAndDo(tile.x, tile.z, () => loot.pickUpAt(tile.x, tile.z)),
          });
        }
        const corpse = loot.corpseAt(tile.x, tile.z);
        if (corpse) {
          items.unshift({
            label: `Loot ${corpse.def.name}'s body`,
            action: () => approachAndDo(corpse.x, corpse.z, () => loot.lootBody(corpse)),
          });
        }
        // The Smoker's lighter turns any flammable surface into an option.
        if (sheet?.talent?.effects?.hasLighter
          && surfId && SURFACES[surfId].flammable && !runtime.isBurning(tile.x, tile.z)) {
          items.unshift({
            label: 'Flick the lighter',
            action: () => approachAndDo(tile.x, tile.z, () => igniteAt(tile.x, tile.z)),
          });
        }
        ui.showMenu(sx, sy, items);
      } else if (grid.defAt(tile.x, tile.z).ignitable) {
        const items = [{
          label: 'Examine',
          action: () => ui.say(runtime.isBurning(tile.x, tile.z)
            ? 'The trash can is thoroughly on fire. Somewhere, an alarm should be going off.'
            : 'A trash can. Sixty percent paper, forty percent regret.'),
        }];
        if (runtime.ignitable(tile.x, tile.z)) {
          items.unshift({
            label: 'Set it on fire (why not)',
            action: () => approachAndDo(tile.x, tile.z, () => igniteAt(tile.x, tile.z)),
          });
        }
        items.unshift({
          label: 'Rummage',
          action: () => approachAndDo(tile.x, tile.z, () => loot.lootContainer(tile.x, tile.z)),
        });
        ui.showMenu(sx, sy, items);
      } else if (grid.defAt(tile.x, tile.z).explosive) {
        ui.showMenu(sx, sy, [
          { label: 'Rummage', action: () => approachAndDo(tile.x, tile.z, () => loot.lootContainer(tile.x, tile.z)) },
          { label: 'Examine', action: () => ui.say('The printer. It has jammed 4 times today. It is waiting.') },
        ]);
      } else {
        const def = grid.defAt(tile.x, tile.z);
        const items = [{ label: 'Examine', action: () => ui.say('A cubicle wall. It has seen things.') }];
        if (def.loot) {
          items[0] = { label: 'Examine', action: () => ui.say(`${def.label}. Probably contains secrets. Or staples.`) };
          items.unshift({
            label: 'Rummage',
            action: () => approachAndDo(tile.x, tile.z, () => loot.lootContainer(tile.x, tile.z)),
          });
        }
        ui.showMenu(sx, sy, items);
      }
    },
  });

  // --- keyboard: hold Alt for the loot overlay, I for the pockets ---------------
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') {
      e.preventDefault(); // keep focus off the browser's menu bar
      if (!e.repeat && sheet && !inCombat && !gameOver) loot.showLabels();
    } else if ((e.key === 'i' || e.key === 'I') && sheet && !gameOver) {
      loot.togglePanel(sheet);
    } else if (/^[1-9]$/.test(e.key) && sheet && !inCombat && !gameOver && !dialogue.visible) {
      // Number keys arm the matching hotbar slot (out-of-combat targeting).
      const id = offensiveActionIds()[Number(e.key) - 1];
      if (id) toggleOocArm(id);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') loot.hideLabels();
  });
  window.addEventListener('blur', () => loot.hideLabels());

  // Cosmetic combat feedback (projectiles, floating numbers). Defined after
  // controls exist because the damage text projects through the camera.
  const vfx = {
    projectile: (from, to, kind) => throwProjectile(app, from, to, kind),
    damageText: (x, z, text, color) =>
      spawnDamageText(app, controls.cameraEntity, x, 0.2, z, text, color),
  };

  // --- main loop ------------------------------------------------------------------
  const BASE_SPEED = 4;
  app.on('update', (dt) => {
    // Sticky surfaces (coffee) slow you while you're on them - queried from
    // the RUNTIME layer, so a surface that burns away stops slowing anyone.
    // Gum on the shoe slows you everywhere.
    player.speed = BASE_SPEED
      * (SURFACES[runtime.surfaceAt(player.x, player.z)]?.slow || 1)
      * (sheet?.gum > 0 ? GUM.slow : 1);
    player.update(dt, onPlayerStep);
    const world = {
      paused: inCombat || gameOver,
      isWalkable,
      isHazard: enemyIsHazard, // wander avoidance uses the ENEMY hazard model
      playerTile: player,
      occupied: (x, z, self) =>
        (x === player.x && z === player.z)
        || enemies.some((e) => e.alive && e !== self && e.x === x && e.z === z),
      slips: (x, z) => Math.random() < slipChanceAt(x, z),
      stickGum,
      // A wander route never crosses hazards, other actors, or the player's
      // tile; the enemy's own start tile counts as open. Returns it smoothed.
      findWanderPath: (en, tx, tz) => {
        const open = (x, z) => (x === en.x && z === en.z
          ? grid.terrainOpen(x, z)
          : enemyClearOfHazards(x, z) && !(x === player.x && z === player.z));
        const p = findPath(open, en.x, en.z, tx, tz, null, grid.stepOpen);
        if (!p || p.length < 2) return null;
        // amble to a loose spot in the tile, not its dead centre
        p[p.length - 1] = clampPoint(tx + (Math.random() - 0.5) * 0.7, tz + (Math.random() - 0.5) * 0.7);
        return smoothPath(open, p, grid.edgeOpen);
      },
    };
    let anyoneMoved = false;
    for (const en of enemies) {
      const beforeX = en.x;
      const beforeZ = en.z;
      en.update(dt, world);
      if (en.x !== beforeX || en.z !== beforeZ) anyoneMoved = true;
    }
    if (anyoneMoved) checkCombatTrigger(); // did someone just corner the player?
    for (const npc of npcs) npc.update(dt); // idle in place, ease their facing
    // Persistent hotbar: visible only when it can act; ammo counts refresh
    // when they change (the gate keeps DOM writes off the hot path). Armed
    // out-of-combat target rings redraw each frame, like combat's own.
    if (hotbar) {
      const show = !!sheet && !inCombat && !gameOver && !dialogue.visible;
      hotbar.setVisible(show);
      if (show && sheet.paper !== hotbarPaper) { hotbarPaper = sheet.paper; hotbar.refresh(sheet); }
      if (show && armedOoc) drawOocTargets();
    }
    if (!gameOver) runtime.tick(dt); // fire waits for no one, combat included
    animateSurfaces(dt);
    // The loot overlay tracks the world while held (the camera keeps easing).
    if (loot.labelsVisible) {
      loot.repositionLabels((w) => {
        const s = worldToScreenCss(app, controls.cameraEntity, w.x, w.y, w.z);
        return s.behind ? null : s;
      });
    }
    // Follow the player, gently biased toward the map centre so corner spawns
    // don't leave half the frame empty. Track the entity's CONTINUOUS position
    // (player.x/z is the logical tile, which jumps a whole tile at a time and
    // makes the camera step along with the walk).
    const pp = player.entity ? player.entity.getPosition() : player;
    // While the class carousel is up (no sheet yet), look dead at the
    // candidate so they sit centred in frame; in play, bias toward the map
    // centre so corner spawns don't leave half the frame empty.
    controls.follow(sheet ? {
      x: pp.x * 0.82 + ((grid.width - 1) / 2) * 0.18,
      z: pp.z * 0.82 + ((grid.height - 1) / 2) * 0.18,
    } : { x: pp.x, z: pp.z }, dt);
    updateWallFade(controls.cameraEntity, player.entity ? player.entity.getPosition() : null);
  });

  // --- boot -------------------------------------------------------------------------
  ui.addVignette();
  ui.say(grid.name);
  // The escape hatches live here (not only on the class picker) because a
  // mid-campaign reload skips the picker entirely.
  ui.showGameMenu([
    {
      id: 'menu-restart',
      label: 'Restart run',
      action: () => {
        clearProgress();
        localStorage.removeItem(STASH_KEY);
        location.hash = '';
        location.reload();
      },
    },
    {
      id: 'menu-editor',
      label: 'Level editor',
      action: () => {
        location.hash = '#editor';
        location.reload();
      },
    },
  ]);
  if (restoredSheet) {
    // Continuing a campaign run: same character, next floor - no picker.
    // Backfill fields older saves may predate, so no math ever meets
    // undefined.
    sheet = restoredSheet;
    sheet.inventory ||= []; // saves from before pockets existed
    sheet.paper ??= 0;
    sheet.bleed ??= 0;
    sheet.gum ??= 0;
    spawnPlayerModel();
    loot.refreshPanel(sheet);
    buildHotbar();
    ui.say(`${grid.name}. Keep going.`);
  } else {
    // The carousel: frame the spawn tile close and head-on (eye-ish level,
    // aimed at the chest) where previewClass parades the browsed candidate;
    // onClassPicked restores the tactical camera.
    controls.setView({ dist: 3, pitch: 14, focusY: 0.8 });
    app.on('update', previewSpin);
    ui.showClassPicker(CLASSES, ACTIONS, onClassPicked, () => {
      location.hash = '#editor';
      location.reload();
    }, previewClass);
  }
  if (playtesting) {
    ui.showPlaytestBadge(() => {
      location.hash = '#editor';
      location.reload();
    });
  }

  // Small read-only handle for tests and console poking.
  window.__game = {
    get playerTile() { return { x: player.x, z: player.z }; },
    get playerPos() {
      const p = player.entity?.getPosition();
      return p ? { x: p.x, z: p.z } : { x: player.x, z: player.z };
    },
    // World point -> CSS-pixel screen point, so tests can click precise
    // ground points (mouse events arrive in CSS pixels).
    project(x, z) {
      const s = worldToScreenCss(app, controls.cameraEntity, x, 0, z);
      return { x: s.x, y: s.y };
    },
    // Project an arbitrary world point (y too), so tests can aim at a tall
    // mesh - a door panel, an enemy's body - not just the floor under it.
    project3(x, y, z) {
      const s = worldToScreenCss(app, controls.cameraEntity, x, y, z);
      return { x: s.x, y: s.y };
    },
    get inCombat() { return inCombat; },
    get gameOver() { return gameOver; },
    get lastPath() { return lastPath; },
    get fadedWallCount() { return walls.filter((w) => w.faded).length; },
    get stats() { return sheet ? { ...sheet } : null; },
    get playerSpeed() { return player.speed; },
    get burning() { return runtime.burningCount; },
    get inventory() { return sheet ? [...sheet.inventory] : []; },
    get looseItems() { return loot.debug.looseItems(); },
    get lootLabelCount() { return document.querySelectorAll('.loot-label').length; },
    containerLootAt: loot.debug.containerLootAt,
    get doors() { return [...grid.doors].map(([key, d]) => ({ key, open: d.open })); },
    surfaceAt: (x, z) => runtime.surfaceAt(x, z),
    get enemies() {
      return enemies.map((e) => {
        const p = e.entity?.getPosition();
        return { name: e.def.name, x: e.x, z: e.z, px: p?.x, pz: p?.z, alive: e.alive };
      });
    },
    get npcs() { return npcs.map((n) => ({ name: n.def.name, x: n.x, z: n.z })); },
    // Out-of-combat targeting + hover state, for the e2e suite.
    get armed() { return armedOoc; },
    get hoverKind() { return hoverKind; },
    get cursor() { return canvasEl ? canvasEl.style.cursor : ''; },
    get dialogueOpen() { return dialogue.visible; },
  };
}
