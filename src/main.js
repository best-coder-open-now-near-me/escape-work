// Escape Work - entry point and game flow. A Baldur's Gate / Divinity-style
// CRPG reskinned for office life.
//
// This file only wires the pieces together and owns the game flow (what
// happens on a click, when combat starts, when you win). The pieces live in
// focused modules - see ARCHITECTURE.md for the map. Content (tiles, enemies,
// classes, actions) is data in src/data/; levels are hand-editable JSON - or
// paintable in the built-in editor (#editor / the link on the class picker).
import { LEVELS, FIRST_LEVEL } from './data/levels.js';
import { SURFACES, ELECTRIFIED } from './data/surfaces.js';
import { ENEMY_TYPES } from './data/enemies.js';
import { CLASSES } from './data/classes.js';
import { ACTIONS } from './data/actions.js';
import { parseLevel } from './grid.js';
import { findPath, smoothPath, DIRS8 } from './pathfinding.js';
import { createSheet, gainXp, applyDamage } from './stats.js';
import { PlayerActor, EnemyActor } from './actors.js';
import { createApp, buildLevel, placeModel } from './scene.js';
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
  const { walls, updateWallFade, animateSurfaces, floorHeight } = buildLevel(app, grid);

  // The sheet (and the player's model) only exist once a class is picked - the
  // picker overlay is the first thing the player sees.
  let sheet = null;
  const player = new PlayerActor(grid.playerSpawn.x, grid.playerSpawn.z);
  const enemies = grid.enemySpawns.map((s) => new EnemyActor(s.x, s.z, s.type, ENEMY_TYPES[s.type]));

  let inCombat = false;
  let gameOver = false;
  let lastPath = null; // kept for debugging/tests

  const enemyAt = (x, z) => enemies.find((e) => e.alive && e.x === x && e.z === z) || null;
  const isWalkable = (x, z) => grid.terrainOpen(x, z) && !enemyAt(x, z);
  // Surface queries. A cell is dangerous when stepping on it costs HP -
  // electrified pools and live cables; plain water and coffee are just
  // uncomfortable.
  const surfEffect = (x, z) =>
    grid.isElectrified(x, z) ? ELECTRIFIED.onEnter : SURFACES[grid.surfaceAt(x, z)]?.onEnter || null;
  const isHazard = (x, z) => (surfEffect(x, z)?.amount || 0) > 0;
  // Dangerous/uncomfortable surfaces cost extra to path through, so
  // characters route around them unless told otherwise or there is no other
  // way; smoothing must never straighten a route through a damaging cell the
  // route avoided.
  const hazardCost = (x, z) => {
    if (grid.isElectrified(x, z)) return ELECTRIFIED.pathCost;
    return SURFACES[grid.surfaceAt(x, z)]?.pathCost || 0;
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

  function moveTo(tile) {
    if (!tile || !sheet || inCombat || gameOver || !isWalkable(tile.x, tile.z)) return;
    const p = findPath(isWalkable, player.x, player.z, tile.x, tile.z, hazardCost);
    if (p && p.length > 1) {
      // Smoothed: straight any-angle runs wherever line of sight is clear.
      const s = smoothPath(clearOfHazards, p);
      player.setPath(s);
      lastPath = s;
    }
  }

  // Walk to the open tile nearest an enemy; combat starts on arrival via the
  // adjacency check in onPlayerStep.
  function confront(en) {
    if (!en || !en.alive || inCombat || gameOver) return;
    let best = null;
    for (const [dx, dz] of DIRS8) {
      const ax = en.x + dx;
      const az = en.z + dz;
      if (!isWalkable(ax, az)) continue;
      const p = findPath(isWalkable, player.x, player.z, ax, az, hazardCost);
      if (p && (!best || p.length < best.length)) best = p;
    }
    if (!best) return;
    if (best.length > 1) {
      const s = smoothPath(clearOfHazards, best);
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
    inCombat = true;
    ui.hideMenu();
    player.faceToward(en.x, en.z);
    en.faceToward(player.x, player.z);
    ui.say(`${en.def.name} has noticed you.`);
    startCombat({
      enemyDef: en.def,
      sheet,
      onChange: () => ui.updateStatsHud(sheet),
      onWin: () => {
        inCombat = false;
        en.die();
        // A breather after every victory, so back-to-back fights aren't a death
        // spiral - wounds still carry over, just less brutally.
        sheet.hp = Math.min(sheet.maxHp, sheet.hp + 5);
        const promoted = gainXp(sheet, en.def.xp);
        ui.say(promoted
          ? `Promotion! Level ${sheet.level}: fully rested, +1 damage.`
          : `+${en.def.xp} XP.`);
        ui.updateStatsHud(sheet);
      },
      onLose: () => { inCombat = false; gameOver = true; clearProgress(); },
    });
  }

  // Tile effects (data-driven from TILE_TYPES[..].onEnter) fire per step.
  // Hazards hit on any step; the exit only fires when it's the destination, so
  // pathing past it doesn't end the level by accident.
  function onPlayerStep(x, z, pathDone, changed = true) {
    const fx = grid.defAt(x, z).onEnter;
    if (fx) {
      if (fx.effect === 'exit' && pathDone) {
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
    // Surface effects (data/surfaces.js): electrified pools and cables hurt,
    // water and coffee just editorialize. Only on genuine tile entry.
    const sfx = changed ? surfEffect(x, z) : null;
    if (sfx) {
      if (sfx.amount) {
        const dead = applyDamage(sheet, sfx.amount);
        ui.say(sfx.message);
        ui.updateStatsHud(sheet);
        if (dead) {
          gameOver = true;
          player.clearPath();
          clearProgress();
          ui.showLoseScreen('Done in by the office itself. Electricity and water: still a bad mix.');
          return;
        }
      } else if (sfx.message) {
        ui.say(sfx.message);
      }
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
      if (!tile || !sheet || inCombat || gameOver) return;
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
        const surfId = grid.surfaceAt(tile.x, tile.z);
        const flavor = grid.isElectrified(tile.x, tile.z)
          ? ELECTRIFIED.examine
          : (surfId && SURFACES[surfId].examine) || 'Standard-issue office carpet. Faintly damp.';
        ui.showMenu(sx, sy, [
          { label: 'Walk here', action: () => moveTo(tile) },
          { label: 'Examine', action: () => ui.say(flavor) },
        ]);
      } else {
        ui.showMenu(sx, sy, [
          { label: 'Examine', action: () => ui.say('A cubicle wall. It has seen things.') },
        ]);
      }
    },
  });

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
    get enemies() { return enemies.map((e) => ({ name: e.def.name, x: e.x, z: e.z, alive: e.alive })); },
  };
}
