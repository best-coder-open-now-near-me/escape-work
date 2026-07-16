// Escape Work - entry point and game flow. A Baldur's Gate / Divinity-style
// CRPG reskinned for office life.
//
// This file only wires the pieces together and owns the game flow (what
// happens on a click, when combat starts, when you win). The pieces live in
// focused modules - see ARCHITECTURE.md for the map. Content (tiles, enemies,
// classes, actions) is data in src/data/; levels are hand-editable JSON - or
// paintable in the built-in editor (#editor / the link on the class picker).
import shippedLevel from '../levels/level1.json';
import { ENEMY_TYPES } from './data/enemies.js';
import { CLASSES } from './data/classes.js';
import { ACTIONS } from './data/actions.js';
import { parseLevel } from './grid.js';
import { findPath, DIRS8 } from './pathfinding.js';
import { createSheet, gainXp, applyDamage } from './stats.js';
import { PlayerActor, EnemyActor } from './actors.js';
import { createApp, buildLevel, placeModel } from './scene.js';
import { createControls } from './controls.js';
import { startCombat } from './combat.js';
import { startEditor } from './editor.js';
import * as ui from './ui.js';

const STASH_KEY = 'escape-work.playtest';
const app = createApp(document.getElementById('app'));

// A playtest level stashed by the editor takes priority over the shipped one.
let activeLevel = shippedLevel;
let playtesting = false;
try {
  const stash = localStorage.getItem(STASH_KEY);
  if (stash) {
    activeLevel = JSON.parse(stash);
    playtesting = true;
  }
} catch { /* corrupted stash - fall back to the shipped level */ }

if (location.hash.includes('editor')) {
  startEditor(app, activeLevel, STASH_KEY);
} else {
  startGame(activeLevel);
}
app.start();

// ---------------------------------------------------------------------------------
function startGame(level) {
  const grid = parseLevel(level);
  const { walls, updateWallFade, floorHeight } = buildLevel(app, grid);

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
  const isHazard = (x, z) => grid.defAt(x, z).onEnter?.effect === 'damage';

  // --- populate the scene -----------------------------------------------------
  const lift = floorHeight / 2;
  for (const en of enemies) {
    placeModel(app, `assets/characters/${en.def.model}.glb`, en.x, en.z, {
      lift, rotY: -90, onReady: (e) => en.attach(e),
    });
  }
  // Set dressing. Like everything else, placement is one line per prop.
  placeModel(app, 'assets/furniture/desk.glb', 3, 1, { scale: 0.5, lift });
  placeModel(app, 'assets/furniture/chair.glb', 2, 1, { scale: 0.55, rotY: 90, lift });
  placeModel(app, 'assets/furniture/cabinet.glb', 9, 3, { scale: 0.5, lift });
  placeModel(app, 'assets/furniture/plant.glb', 10, 3, { scale: 0.9, lift });

  // --- game flow ----------------------------------------------------------------
  function onClassPicked(classId) {
    sheet = createSheet(classId);
    placeModel(app, `assets/characters/${sheet.model}.glb`, player.x, player.z, {
      lift, rotY: 90, onReady: (e) => player.attach(e),
    });
    ui.updateStatsHud(sheet);
    ui.say(`${sheet.className}. Now get out of here.`);
  }

  function moveTo(tile) {
    if (!tile || !sheet || inCombat || gameOver || !isWalkable(tile.x, tile.z)) return;
    const p = findPath(isWalkable, player.x, player.z, tile.x, tile.z);
    if (p && p.length > 1) {
      player.setPath(p);
      lastPath = p;
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
      const p = findPath(isWalkable, player.x, player.z, ax, az);
      if (p && (!best || p.length < best.length)) best = p;
    }
    if (!best) return;
    if (best.length > 1) {
      player.setPath(best);
      lastPath = best;
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
      onLose: () => { inCombat = false; gameOver = true; },
    });
  }

  // Tile effects (data-driven from TILE_TYPES[..].onEnter) fire per step.
  // Hazards hit on any step; the exit only fires when it's the destination, so
  // pathing past it doesn't end the level by accident.
  function onPlayerStep(x, z, pathDone) {
    const fx = grid.defAt(x, z).onEnter;
    if (fx) {
      if (fx.effect === 'exit' && pathDone) {
        gameOver = true;
        player.clearPath();
        ui.showWinScreen({ level: sheet.level, defeated: enemies.filter((e) => !e.alive).length });
        return;
      }
      if (fx.effect === 'damage') {
        const dead = applyDamage(sheet, fx.amount);
        ui.say(fx.message);
        ui.updateStatsHud(sheet);
        if (dead) {
          gameOver = true;
          player.clearPath();
          ui.showLoseScreen('Done in by the office itself. The floor was, in fact, wet.');
          return;
        }
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
        const flavor = isHazard(tile.x, tile.z)
          ? 'A suspicious puddle. The mop is on PTO.'
          : 'Standard-issue office carpet. Faintly damp.';
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
  app.on('update', (dt) => {
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
    controls.follow(player);
    updateWallFade(controls.cameraEntity, player.entity ? player.entity.getPosition() : null);
  });

  // --- boot -------------------------------------------------------------------------
  ui.say(grid.name);
  ui.showClassPicker(CLASSES, ACTIONS, onClassPicked, () => {
    location.hash = '#editor';
    location.reload();
  });
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
    get enemies() { return enemies.map((e) => ({ name: e.def.name, x: e.x, z: e.z, alive: e.alive })); },
  };
}
