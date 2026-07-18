// Escape Work - entry point and game flow. A Baldur's Gate / Divinity-style
// CRPG reskinned for office life.
//
// This file only wires the pieces together and owns the game flow (what
// happens on a click, when combat starts, when you win). The pieces live in
// focused modules - see ARCHITECTURE.md for the map. Content (tiles, enemies,
// classes, actions) is data in src/data/; levels are hand-editable JSON - or
// paintable in the built-in editor (#editor / the link on the class picker).
import { LEVELS, FIRST_LEVEL } from './data/levels.js';
import { SURFACES, ELECTRIFIED, FIRE } from './data/surfaces.js';
import { createSurfaceRuntime } from './surfaces-runtime.js';
import { ENEMY_TYPES } from './data/enemies.js';
import { CLASSES } from './data/classes.js';
import { ACTIONS } from './data/actions.js';
import { parseLevel } from './grid.js';
import { findPath, smoothPath, segmentClear, DIRS8 } from './pathfinding.js';
import { createSheet, gainXp, applyDamage } from './stats.js';
import { PlayerActor, EnemyActor } from './actors.js';
import { createApp, buildLevel, placeModel, throwProjectile, spawnDamageText } from './scene.js';
import { createControls } from './controls.js';
import { startCombat } from './combat.js';
import { startEditor } from './editor.js';
import * as ui from './ui.js';

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
  const scene = buildLevel(app, grid);
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

  let inCombat = false;
  let combat = null; // active tactical-combat controller
  let gameOver = false;
  let lastPath = null; // kept for debugging/tests
  let pendingAction = null; // walk-up interaction, runs on arrival

  function abortCombat() {
    if (combat) {
      combat.abort();
      combat = null;
    }
    inCombat = false;
  }

  const enemyAt = (x, z) => enemies.find((e) => e.alive && e.x === x && e.z === z) || null;
  const isWalkable = (x, z) => grid.terrainOpen(x, z) && !enemyAt(x, z);
  // Surface queries, consulting the runtime (fire) before static state.
  const surfEffect = (x, z) => {
    if (runtime.isBurning(x, z)) return FIRE.onEnter;
    if (grid.isElectrified(x, z)) return ELECTRIFIED.onEnter;
    return SURFACES[runtime.surfaceAt(x, z)]?.onEnter || null;
  };
  // What a step actually costs THIS character, after talents (Teflon Coating,
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
  // Dangerous/uncomfortable surfaces cost extra to path through, so
  // characters route around them unless told otherwise or there is no other
  // way; smoothing must never straighten a route through a damaging cell the
  // route avoided.
  const hazardCost = (x, z) => {
    if (runtime.isBurning(x, z)) return FIRE.pathCost;
    if (grid.isElectrified(x, z)) {
      return sheet?.talent?.effects?.shockImmune ? 1 : ELECTRIFIED.pathCost;
    }
    return SURFACES[runtime.surfaceAt(x, z)]?.pathCost || 0;
  };
  const clearOfHazards = (x, z) => isWalkable(x, z) && !isHazard(x, z);

  // --- populate the scene -----------------------------------------------------
  const lift = floorHeight / 2;
  for (const en of enemies) {
    placeModel(app, `assets/characters/${en.def.model}.glb`, en.x, en.z, {
      lift, rotY: -90, onReady: (e) => en.attach(e),
    });
  }
  // (Furniture is no longer set dressing here - props are solid tiles in the
  // level data, rendered by buildLevel and respected by pathfinding.)

  // --- game flow ----------------------------------------------------------------
  function spawnPlayerModel() {
    placeModel(app, `assets/characters/${sheet.model}.glb`, player.x, player.z, {
      lift, rotY: 90, onReady: (e) => player.attach(e),
    });
    ui.updateStatsHud(sheet);
  }

  function onClassPicked(classId) {
    sheet = createSheet(classId);
    spawnPlayerModel();
    ui.say(`${sheet.className}. Now get out of here.`);
  }

  // Blowing up a printer: flash, clear the tile, flatten anyone beside it.
  function handleExplosion(x, z) {
    scene.explosionFlash(x, z);
    grid.setType(x, z, 'floor');
    scene.removePropVisual(x, z);
    let slain = 0;
    for (const en of enemies) {
      if (en.alive && Math.abs(en.x - x) <= 1 && Math.abs(en.z - z) <= 1) {
        en.die();
        slain += 1;
        if (sheet) gainXp(sheet, en.def.xp);
      }
    }
    let msg = 'The printer detonates in a cloud of toner.';
    if (slain) msg += ` ${slain} coworker${slain === 1 ? '' : 's'} caught in the blast (+XP).`;
    if (sheet && player.entity && Math.abs(player.x - x) <= 1 && Math.abs(player.z - z) <= 1) {
      const dead = applyDamage(sheet, 8);
      player.flinch();
      vfx.damageText(player.x, player.z, '-8');
      msg += ' You catch shrapnel. -8 HP.';
      if (dead) {
        gameOver = true;
        player.clearPath();
        abortCombat();
        clearProgress();
        ui.say(msg);
        ui.showLoseScreen('PC LOAD LETTER. Fatal.');
        return;
      }
    }
    ui.say(msg);
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
    const s = smoothPath(clearOfHazards, best, grid.edgeOpen);
    player.setPath(s);
    lastPath = s;
  }

  function moveTo(tile) {
    if (!tile || !sheet || inCombat || gameOver || !isWalkable(tile.x, tile.z)) return;
    pendingAction = null;
    const p = findPath(isWalkable, player.x, player.z, tile.x, tile.z, hazardCost, grid.stepOpen);
    if (p && p.length > 1) {
      // Smoothed: straight any-angle runs wherever line of sight is clear.
      const s = smoothPath(clearOfHazards, p, grid.edgeOpen);
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
      const s = smoothPath(clearOfHazards, best, grid.edgeOpen);
      player.setPath(s);
      lastPath = s;
    } else {
      checkCombatTrigger();
    }
  }

  const adjacentEnemy = () =>
    enemies.find((e) => e.alive && Math.abs(player.x - e.x) <= 1 && Math.abs(player.z - e.z) <= 1) || null;

  function checkCombatTrigger() {
    if (!sheet || inCombat || gameOver || !player.entity) return;
    const en = adjacentEnemy();
    if (!en) return;
    player.clearPath();
    pendingAction = null;
    inCombat = true;
    ui.hideMenu();
    // Everyone close enough joins the brawl (those further than 2 tiles are
    // surprised and lose their first turn - see combat.js).
    const engaged = enemies.filter((e) =>
      e.alive && Math.max(Math.abs(e.x - player.x), Math.abs(e.z - player.z)) <= 4);
    player.faceToward(en.x, en.z);
    en.faceToward(player.x, player.z);
    ui.say(engaged.length > 1
      ? `${en.def.name} has noticed you. So have ${engaged.length - 1} other${engaged.length > 2 ? 's' : ''}.`
      : `${en.def.name} has noticed you.`);
    combat = startCombat({
      app,
      sheet,
      player,
      engaged,
      world: {
        isWalkable,
        findPath: (sx, sz, tx, tz) => findPath(isWalkable, sx, sz, tx, tz, hazardCost, grid.stepOpen),
        // Partitions (edge walls) are chest height: they block movement but
        // not throws - lob paper right over the cubicle wall.
        hasLos: (ax, az, bx, bz) => segmentClear(grid.terrainOpen, ax, az, bx, bz),
        stepOpen: grid.stepOpen,
        surfaceIdAt: (x, z) => runtime.surfaceAt(x, z),
        isElectrified: (x, z) => grid.isElectrified(x, z),
        enemySurfDamage: (x, z) => surfEffect(x, z)?.amount || 0,
      },
      fx: vfx,
      callbacks: {
        say: ui.say,
        updateHud: () => ui.updateStatsHud(sheet),
        onEnemyKilled: (dead) => {
          const promoted = gainXp(sheet, dead.def.xp);
          if (promoted) ui.say(`Promotion! Level ${sheet.level}: fully rested, +1 damage.`);
          ui.updateStatsHud(sheet);
        },
        onWin: () => {
          inCombat = false;
          combat = null;
          // A breather after every victory, so back-to-back fights aren't a
          // death spiral - wounds still carry over, just less brutally.
          sheet.hp = Math.min(sheet.maxHp, sheet.hp + 5);
          ui.say('The floor is yours. You catch your breath. (+5 HP)');
          ui.updateStatsHud(sheet);
        },
        onLose: () => {
          inCombat = false;
          combat = null;
          gameOver = true;
          clearProgress();
          ui.showLoseScreen('The office wins this round. Darkness falls between the cubicles.');
        },
      },
    });
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
          sheet.hp = Math.min(sheet.maxHp, sheet.hp + 6);
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
          gameOver = true;
          player.clearPath();
          clearProgress();
          ui.showLoseScreen('Done in by the office itself. The floor was, in fact, wet.');
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
        gameOver = true;
        player.clearPath();
        abortCombat();
        clearProgress();
        ui.showLoseScreen('Death by a thousand paper cuts. Well - several.');
        return;
      }
    }
    // Surface effects (data/surfaces.js): fire and electrified pools hurt,
    // paper cuts (and arms you), water and coffee editorialize. Talents can
    // shrug damage off. Only on genuine tile entry.
    const sfx = changed ? surfEffect(x, z) : null;
    if (sfx) {
      if (sfx.ammo) {
        sheet.paper = Math.min(8, sheet.paper + sfx.ammo);
        vfx.damageText(x, z, '+📄', '#8adf76');
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
          gameOver = true;
          player.clearPath();
          abortCombat();
          clearProgress();
          ui.showLoseScreen('Done in by the office itself. Facilities sends their regards.');
          return;
        }
      } else if (sfx.amount) {
        ui.say(sheet.talent?.effects?.shockImmune && grid.isElectrified(x, z)
          ? 'The water crackles. Your rubber soles hum smugly. 0 damage.'
          : 'You glide across the drift, harvesting ammunition. The edges respect a master. (+1 paper)');
        ui.updateStatsHud(sheet);
      } else if (sfx.message) {
        ui.say(sfx.message);
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
    onLeftClickTile: (tile) => {
      if (!tile || !sheet || gameOver) return;
      if (inCombat) {
        const en = enemyAt(tile.x, tile.z);
        if (en) combat?.handleEnemyClick(en);
        else combat?.handleTileClick(tile);
        return;
      }
      const en = enemyAt(tile.x, tile.z);
      if (en) confront(en);
      else moveTo(tile);
    },
    onRightClickTile: (tile, sx, sy) => {
      if (!tile || !sheet || inCombat || gameOver) return;
      const en = enemyAt(tile.x, tile.z);
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
          { label: 'Walk here', action: () => moveTo(tile) },
          { label: 'Examine', action: () => ui.say(flavor) },
        ];
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
        ui.showMenu(sx, sy, items);
      } else if (grid.defAt(tile.x, tile.z).explosive) {
        ui.showMenu(sx, sy, [
          { label: 'Examine', action: () => ui.say('The printer. It has jammed 4 times today. It is waiting.') },
        ]);
      } else {
        ui.showMenu(sx, sy, [
          { label: 'Examine', action: () => ui.say('A cubicle wall. It has seen things.') },
        ]);
      }
    },
  });

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
    // Sticky surfaces (coffee) slow you while you're on them.
    player.speed = BASE_SPEED * (SURFACES[grid.surfaceAt(player.x, player.z)]?.slow || 1);
    player.update(dt, onPlayerStep);
    const world = {
      paused: inCombat || gameOver,
      terrainOpen: grid.terrainOpen,
      isWalkable,
      isHazard,
      stepOpen: grid.stepOpen,
      playerTile: player,
    };
    let anyoneMoved = false;
    for (const en of enemies) {
      const beforeX = en.x;
      const beforeZ = en.z;
      en.update(dt, world);
      if (en.x !== beforeX || en.z !== beforeZ) anyoneMoved = true;
    }
    if (anyoneMoved) checkCombatTrigger(); // did someone just corner the player?
    if (!gameOver) runtime.tick(dt); // fire waits for no one, combat included
    animateSurfaces(dt);
    // Follow the player, gently biased toward the map centre so corner spawns
    // don't leave half the frame empty.
    controls.follow({
      x: player.x * 0.82 + ((grid.width - 1) / 2) * 0.18,
      z: player.z * 0.82 + ((grid.height - 1) / 2) * 0.18,
    });
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
    sheet = restoredSheet;
    spawnPlayerModel();
    ui.say(`${grid.name}. Keep going.`);
  } else {
    ui.showClassPicker(CLASSES, ACTIONS, onClassPicked, () => {
      location.hash = '#editor';
      location.reload();
    });
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
    get inCombat() { return inCombat; },
    get gameOver() { return gameOver; },
    get lastPath() { return lastPath; },
    get fadedWallCount() { return walls.filter((w) => w.faded).length; },
    get stats() { return sheet ? { ...sheet } : null; },
    get playerSpeed() { return player.speed; },
    get burning() { return runtime.burningCount; },
    get enemies() { return enemies.map((e) => ({ name: e.def.name, x: e.x, z: e.z, alive: e.alive })); },
  };
}
