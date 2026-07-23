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
import { createSheet, applyDamage, PAPER_CAP } from './stats.js';
import {
  createParty, leader as partyLeader, addMember, gainXpAll, createCompanionSheet,
  serializeProgress, parseProgress, PARTY_CAP,
} from './party.js';
import { PlayerActor, EnemyActor, NpcActor, CompanionActor } from './actors.js';
import { COMPANIONS } from './data/companions.js';
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
import { installGodMode } from './god.js';
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
let restoredProgress = null; // { levelId, sheets, active } - party.js handles old shapes
try {
  const stash = localStorage.getItem(STASH_KEY);
  const progress = localStorage.getItem(PROGRESS_KEY);
  if (stash) {
    activeLevel = JSON.parse(stash);
    activeLevelId = null;
    playtesting = true;
  } else if (progress) {
    const p = parseProgress(JSON.parse(progress));
    if (p && LEVELS[p.levelId]) {
      activeLevel = LEVELS[p.levelId];
      activeLevelId = p.levelId;
      restoredProgress = p;
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
    hooks: {
      addFlame: scene.addFlame,
      hideSurfaceVisual: scene.hideSurfaceVisual,
      addSmoke: scene.addSmoke,
      removeSmoke: scene.removeSmoke,
    },
    onExplosion: handleExplosion,
  });

  // The party (and the leader's model) only exist once a class is picked - the
  // picker overlay is the first thing the player sees. `sheet` and `player`
  // are the LEADER's live bindings - the character the player controls - and
  // are REASSIGNED when a portrait click hands control to another member, so
  // every leader-keyed closure follows along.
  let party = null;
  let sheet = null;
  let player = new PlayerActor(grid.playerSpawn.x, grid.playerSpawn.z);
  const enemies = grid.enemySpawns.map((s) => new EnemyActor(s.x, s.z, s.type, ENEMY_TYPES[s.type]));
  // Non-hostile coworkers you talk to (data/npcs.js) - separate from `enemies`
  // so combat never engages them and they take no turns.
  const npcs = grid.npcSpawns.map((s) => new NpcActor(s.x, s.z, s.type, NPCS[s.type]));
  // Recruitable companions (data/companions.js) stand among the NPCs until
  // they join - same blocking, same talk verb. One already in a restored
  // party doesn't respawn as a bystander; they arrive as a member below.
  for (const s of grid.companionSpawns) {
    if (restoredProgress?.sheets.some((sh) => sh.companionId === s.type)) continue;
    npcs.push(new CompanionActor(s.x, s.z, s.type, COMPANIONS[s.type]));
  }

  let inCombat = false;
  let combat = null; // active tactical-combat controller
  let gameOver = false;
  let lastPath = null; // kept for debugging/tests
  let pendingAction = null; // walk-up interaction, runs on arrival
  let armedOoc = null; // hotbar action armed OUT of combat (targets an enemy)
  let hotbar = null; // persistent attack bar (built once a class is picked)
  let hotbarPaper = -1; // last paper count the hotbar rendered (refresh gate)
  let pendingGodPick = null; // god-mode click-to-place callback (see window.__god)
  let oocTurnClock = 0; // out-of-combat real-time accrued toward the next fire/smoke turn

  // --- gameplay tuning --------------------------------------------------------
  const ENGAGE_RADIUS = 4; // Chebyshev tiles within which enemies join a fight
  const EXPLOSION_DAMAGE = 8; // shrapnel to the player standing beside a printer
  const VICTORY_HEAL = 5; // the breather after winning a fight
  const STAIRWELL_HEAL = 6; // the breather between floors
  const OOC_TURN_SECONDS = 1.6; // out-of-combat seconds that count as one fire/smoke turn

  // Looting (containers, bodies, pockets, the Alt overlay) lives in its own
  // module; approachAndDo is hoisted, so wiring it here is safe.
  const loot = createLooting({
    app, grid, runtime, enemies,
    getActor: () => player, // the leader's actor - re-pointed on leader switch
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
    syncLeaderBindings();
  }

  const enemyAt = (x, z) => enemies.find((e) => e.alive && e.x === x && e.z === z) || null;
  const npcAt = (x, z) => npcs.find((n) => n.x === x && n.z === z) || null;
  // Does a living party member stand on this tile? Enemy decisions (wander
  // targets, combat routing) treat every member the way they treated the
  // player. Pre-pick (no party yet) the lone spawn tile still counts.
  const partyAt = (x, z) => (party
    ? party.members.some((m) => m.actor && m.sheet.hp > 0 && m.actor.x === x && m.actor.z === z)
    : (x === player.x && z === player.z));
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
  // What a step actually costs a party member, after their talents (Origami
  // Specialist, ESD Steel-Toes). Defaults to the leader - the one whose
  // pathing decisions this shapes.
  const effectiveSurfDamage = (x, z, s = sheet) => {
    const fx = surfEffect(x, z);
    if (!fx || !fx.amount) return 0;
    const t = s?.talent?.effects || {};
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
  const hazardCostFor = (ms) => (x, z) => {
    if (runtime.isBurning(x, z)) return FIRE.pathCost;
    if (grid.isElectrified(x, z)) {
      return ms?.talent?.effects?.shockImmune ? 1 : ELECTRIFIED.pathCost;
    }
    return SURFACES[runtime.surfaceAt(x, z)]?.pathCost || 0;
  };
  const hazardCost = (x, z) => hazardCostFor(sheet)(x, z); // the leader's cost model
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
    // Registered as a `party` interactable like any companion, so a downed
    // ex-leader can be clicked for a hand up. Clicks on a healthy ACTIVE
    // member fall through to the ground (dispatchHit) - your own body is not
    // a target.
    placeModel(app, `assets/characters/${sheet.model}.glb`, player.x, player.z, {
      lift, rotY: 90, animate: true,
      onReady: (e) => { applyCharacterProportions(e); player.attach(e); picking.register(e, 'party', player); },
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
    party = createParty(sheet, player);
    spawnPlayerModel();
    loot.refreshPanel(sheet);
    buildHotbar();
    ui.say(`${sheet.className}. Now get out of here.`); // hotkeys live in the HUD strip
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

  // A member at 0 HP goes down - breathing, out of action, back at 1 HP
  // after a victory, a stairwell, or a hand up. The run only ends on a party
  // WIPE: if the fallen member was the one being controlled, a survivor
  // takes over on the spot (in combat, combat.js owns that handoff).
  function downOrLose(member, message) {
    const others = party.members.some((m) => m !== member && m.sheet.hp > 0 && m.actor);
    if (!others) {
      loseGame(message);
      return;
    }
    downCompanion(member);
    if (inCombat && combat) combat.notifyMemberDown();
    else if (member === partyLeader(party)) forceLeader();
  }

  // Emergency handoff (the controlled member dropped out of combat): the
  // first living member takes over, no questions asked.
  function forceLeader() {
    const i = party.members.findIndex((m) => m.sheet.hp > 0 && m.actor);
    if (i < 0 || i === party.active) return;
    const m = party.members[i];
    party.active = i;
    sheet = m.sheet;
    player = m.actor;
    pendingAction = null;
    armedOoc = null;
    buildHotbar();
    ui.updateStatsHud(sheet);
    loot.refreshPanel(sheet);
    ui.say(`${m.sheet.name} takes over.`);
  }

  // Combat may have handed control to another member; when the dust settles
  // the out-of-combat bindings follow whoever was active.
  function syncLeaderBindings() {
    if (!party) return;
    const lead = partyLeader(party);
    if (sheet === lead.sheet || !lead.actor) return;
    sheet = lead.sheet;
    player = lead.actor;
    pendingAction = null;
    armedOoc = null;
    buildHotbar();
    ui.updateStatsHud(sheet);
    loot.refreshPanel(sheet);
  }
  function downCompanion(m) {
    m.actor?.clearPath();
    if (m.actor) m.actor.fx = { kind: 'death', t: 0 };
    ui.say(`${m.sheet.name} goes down. Breathing, but done for now.`);
  }
  function helpUp(m) {
    if (!m || m.sheet.hp > 0) return;
    m.sheet.hp = 1;
    if (m.actor) m.actor.fx = null;
    ui.say(`You haul ${m.sheet.name} upright. They pretend that was a stretch.`);
  }

  // Every enemy death pays out the same way - combat kill, shove into live
  // water, or a printer taking them along. XP fans out to the whole party;
  // promotions announce themselves.
  function awardKill(dead) {
    if (!party) return;
    for (const m of gainXpAll(party, dead.def.xp)) {
      ui.say(`Promotion! Level ${m.sheet.level}: fully rested, +1 damage.`);
    }
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
    // Shrapnel hits every party member beside the printer, not just the leader.
    for (const m of party ? party.members : []) {
      if (!m.actor?.entity || m.sheet.hp <= 0) continue;
      if (Math.abs(m.actor.x - x) > 1 || Math.abs(m.actor.z - z) > 1) continue;
      const dead = applyDamage(m.sheet, EXPLOSION_DAMAGE);
      m.actor.flinch();
      vfx.damageText(m.actor.x, m.actor.z, `-${EXPLOSION_DAMAGE}`);
      msg += m === partyLeader(party)
        ? ` You catch shrapnel. -${EXPLOSION_DAMAGE} HP.`
        : ` ${m.sheet.name} catches shrapnel. -${EXPLOSION_DAMAGE} HP.`;
      if (dead) {
        if (m === partyLeader(party)) {
          ui.say(msg);
          loseGame('PC LOAD LETTER. Fatal.');
          return;
        }
        downCompanion(m);
      }
    }
    ui.say(msg);
    for (const en of slain) awardKill(en);
    if (sheet) ui.updateStatsHud(sheet);
  }

  // Who can start a fire: the Middle Manager's Smoker lighter (unlimited), or
  // anyone carrying a book of matches (consumed one per light).
  const hasLighter = () => !!sheet?.talent?.effects?.hasLighter;
  const canIgnite = () => hasLighter() || !!sheet?.inventory?.includes('matches');
  const igniteVerb = () => (hasLighter() ? 'Flick the lighter' : 'Strike a match');

  function igniteAt(x, z) {
    if (!canIgnite()) return;
    const wasProp = !!grid.defAt(x, z).ignitable;
    if (runtime.ignite(x, z)) {
      if (!hasLighter()) {
        const i = sheet.inventory.indexOf('matches');
        if (i >= 0) sheet.inventory.splice(i, 1); // a match is spent
        loot.refreshPanel(sheet);
      }
      ui.say(wasProp
        ? 'You introduce the trash can to fire. It goes about as expected.'
        : hasLighter()
          ? 'A flick of the lighter. The paperwork ascends.'
          : 'A match flares, then the paperwork. Ashes to ashes.');
    }
  }

  // Smooth a raw tile path into any-angle runs, starting from where the
  // walker's body actually stands - not their tile centre, which they may be
  // nowhere near after a free-point stop. Defaults to the leader.
  function smoothFromBody(p, actor = player) {
    const pos = actor.entity?.getPosition();
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

  // Cheapest walk-up route to any open tile beside (x, z), or null when the
  // target can't be reached at all (sealed behind walls or a closed door).
  function bestApproachPath(x, z) {
    let best = null;
    for (const [dx, dz] of DIRS8) {
      const ax = x + dx;
      const az = z + dz;
      if (!isWalkable(ax, az)) continue;
      const p = findPath(isWalkable, player.x, player.z, ax, az, hazardCost, grid.stepOpen);
      if (p && (!best || p.length < best.length)) best = p;
    }
    return best;
  }

  // Walk to the open tile nearest an enemy; combat starts on arrival via the
  // adjacency check in onMemberStep.
  function confront(en) {
    if (!en || !en.alive || inCombat || gameOver) return;
    pendingAction = null;
    const best = bestApproachPath(en.x, en.z);
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
  // A sight line for throws: open terrain that ISN'T hazed by smoke. Smoke
  // hangs floor-to-ceiling for a couple of turns and breaks line of sight;
  // movement ignores it, so this is separate from terrainOpen.
  const sightClear = (x, z) => grid.terrainOpen(x, z) && !runtime.isSmoke(x, z);
  // Throws sail over chest-high partitions but not closed doors (grid.sightOpen).
  const hasLos = (a, b) => segmentClear(sightClear, a.x, a.z, b.x, b.z, grid.sightOpen);
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
    party: [0.45, 0.9, 0.8],
    loot: [1.0, 0.82, 0.4],
    interact: [0.5, 0.8, 1.0],
  };
  const rgbCss = ([r, g, b]) => `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;

  // Aggression dot colours (data/enemies.js `aggression`): whether a coworker
  // will start a fight. Green = won't initiate, yellow = talks first, red =
  // straight to battle. Tints both the enemy's flanking dots and the banner
  // border, so the banner reads as one aggression signal.
  const AGGRO = {
    green: 'rgb(111, 200, 111)',
    yellow: 'rgb(224, 178, 58)',
    red: 'rgb(224, 80, 58)',
  };
  const aggroColor = (en) => AGGRO[en.def.aggression] || AGGRO.red;

  // The top focus banner's label for whatever the cursor is over: an
  // interactable entity, or a flat target the pick ray skims (a corpse,
  // dropped item, container, or door edge on the floor). Null over bare floor -
  // nothing worth naming. Mirrors dispatchHit/cursorFor so the banner always
  // describes the verb a click would actually take.
  function focusInfoFor(hit, point) {
    if (hit) {
      const { kind, ref } = hit;
      if (kind === 'enemy') {
        if (ref.alive) {
          const ag = aggroColor(ref);
          return { name: ref.def.name, sub: `HP ${ref.hp}/${ref.def.hp}`, color: ag, dotColor: ag };
        }
        return { name: ref.def.name, sub: ref.loot?.length ? 'Body · lootable' : 'Body · picked clean', color: rgbCss(HL.loot) };
      }
      if (kind === 'npc') return { name: ref.def.name, sub: 'Coworker · talk', color: rgbCss(HL.npc) };
      if (kind === 'party') {
        const m = memberOf(ref);
        if (!m || (m === partyLeader(party) && m.sheet.hp > 0)) return null; // yourself: not news
        const sub = m.sheet.hp <= 0 ? 'Down · help up' : `Party · HP ${m.sheet.hp}/${m.sheet.maxHp}`;
        return { name: m.sheet.name, sub, color: rgbCss(HL.party) };
      }
      if (kind === 'door') {
        const open = grid.doors.get(ref)?.open;
        return { name: open ? 'Door · open' : 'Door · closed', sub: open ? 'Close' : 'Open', color: rgbCss(HL.interact) };
      }
      if (kind === 'prop') {
        const def = grid.defAt(ref.x, ref.z);
        const sub = def.loot ? 'Rummage' : def.explosive ? 'Volatile' : def.ignitable ? 'Flammable' : 'Object';
        return { name: def.label || 'Object', sub, color: rgbCss(def.loot ? HL.loot : HL.interact) };
      }
    }
    if (point) {
      const tx = Math.round(point.x);
      const tz = Math.round(point.z);
      const corpse = loot.corpseAt(tx, tz);
      if (corpse) return { name: corpse.def.name, sub: 'Body · lootable', color: rgbCss(HL.loot) };
      const loose = loot.looseAt(tx, tz);
      if (loose.length) {
        const extra = loose.length > 1 ? ` +${loose.length - 1}` : '';
        return { name: loot.itemName(loose[0].id) + extra, sub: 'Pick up', color: rgbCss(HL.loot) };
      }
      const doorKey = doorNearPoint(point);
      if (doorKey) {
        const open = grid.doors.get(doorKey)?.open;
        return { name: open ? 'Door · open' : 'Door · closed', sub: open ? 'Close' : 'Open', color: rgbCss(HL.interact) };
      }
      if (grid.defAt(tx, tz).loot) return { name: grid.defAt(tx, tz).label, sub: 'Rummage', color: rgbCss(HL.loot) };
    }
    return null;
  }
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
      : hit.kind === 'npc' ? HL.npc
        : hit.kind === 'party' ? HL.party : HL.interact;
  const memberOf = (actor) => party?.members.find((m) => m.actor === actor) || null;

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
    ui.setFocusBanner(focusInfoFor(hit, point));
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

  // Hold Ctrl: a ground ring under EVERY character at their true position -
  // tall meshes read a tile off at this camera angle, so the ring is where a
  // click actually lands. Party teal, enemies red, NPCs green, the downed
  // gold (they're a help-up target, not a threat).
  const RING_PARTY = new pc.Color(0.45, 0.9, 0.8);
  const RING_DOWN = new pc.Color(1.0, 0.82, 0.4);
  const RING_HOSTILE = new pc.Color(1.0, 0.28, 0.2);
  const RING_FRIENDLY = new pc.Color(0.42, 0.85, 0.42);
  let ctrlHeld = false;
  function drawCharacterRings() {
    for (const m of party?.members || []) {
      if (!m.actor?.entity) continue;
      const p = m.actor.entity.getPosition();
      drawRing(p.x, p.z, 0.42, m.sheet.hp <= 0 ? RING_DOWN : RING_PARTY);
    }
    for (const en of enemies) {
      if (!en.alive || !en.entity) continue;
      const p = en.entity.getPosition();
      drawRing(p.x, p.z, 0.5, RING_HOSTILE);
    }
    for (const npc of npcs) {
      if (!npc.entity) continue;
      const p = npc.entity.getPosition();
      drawRing(p.x, p.z, 0.42, RING_FRIENDLY);
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
    if (kind === 'party') {
      const m = memberOf(ref);
      if (!m) return false;
      if (m.sheet.hp <= 0) { approachAndDo(ref.x, ref.z, () => helpUp(m)); return true; }
      if (m === partyLeader(party)) return false; // your own body: a ground click
      approachAndDo(ref.x, ref.z, () => dialogue.open(ref));
      return true;
    }
    if (kind === 'enemy') {
      if (ref.alive) { attackOrConfront(ref); return true; }
      if (ref.loot?.length) approachAndDo(ref.x, ref.z, () => loot.lootBody(ref)); // corpse
      return true;
    }
    if (kind === 'prop') { approachAndDo(ref.x, ref.z, () => loot.lootContainer(ref.x, ref.z)); return true; }
    return false;
  }

  // --- dialogue (minimal talking layer) ---------------------------------------
  // Recruitable companions use the same trees, plus option `effect`s: an
  // option carrying { recruit: true } signs the speaker onto the party when
  // picked. The tree is CAPTURED at open (pre-recruit conversations finish in
  // the tree they started in - the recruit option's own `next` node lives
  // there); the next open reads `recruitedDialogue` instead.
  const dialoguePanel = ui.createDialoguePanel();
  let dialogueNpc = null;
  let dialogueTree = null;
  const canRecruit = (npc) =>
    npc instanceof CompanionActor && !npc.recruited && !!party && party.members.length < PARTY_CAP;
  const dialogue = {
    open(npc) {
      if (inCombat || gameOver || !npc) return;
      const tree = (npc.recruited && npc.def.recruitedDialogue) || npc.def.dialogue;
      if (!tree) return; // nothing to say (a restored companion without lines)
      dialogueNpc = npc;
      dialogueTree = tree;
      npc.faceToward(player.x, player.z);
      loot.hideLabels();
      clearHoverHighlight();
      setCursor(null);
      ui.setFocusBanner(null);
      renderDialogueNode(dialogueTree.start);
    },
    close() { dialogueNpc = null; dialogueTree = null; dialoguePanel.hide(); },
    get visible() { return dialoguePanel.visible; },
  };
  function renderDialogueNode(nodeId) {
    const node = dialogueTree?.nodes[nodeId];
    if (!node) { dialogue.close(); return; }
    const options = (node.options || [{ label: 'Leave', next: null }])
      // A recruit offer only shows while it can be accepted (not already
      // aboard, roster not full).
      .filter((o) => !o.effect?.recruit || canRecruit(dialogueNpc))
      .map((o) => ({
        label: o.label,
        action: () => {
          if (o.effect?.recruit) recruitCompanion(dialogueNpc);
          if (o.next) renderDialogueNode(o.next); else dialogue.close();
        },
      }));
    dialoguePanel.show({ name: dialogueNpc.def.name, text: node.text, options });
  }

  // Sign a bystander onto the party: out of the `npcs` roster (they stop
  // blocking as an NPC - partyAt covers them now), sheet minted at the
  // leader's level, picking re-tagged so hover/clicks read them as one of
  // ours. The entity, model and position stay exactly where they were.
  function recruitCompanion(npc) {
    if (!canRecruit(npc)) return;
    const idx = npcs.indexOf(npc);
    if (idx >= 0) npcs.splice(idx, 1);
    npc.recruited = true;
    const member = addMember(party, createCompanionSheet(npc.def, npc.typeId, sheet.level), npc);
    if (!member) return;
    if (npc.entity) {
      picking.unregister(npc.entity);
      picking.register(npc.entity, 'party', npc);
    }
    ui.toast(`${npc.def.name} joins the party.`);
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
    hotbar?.destroy(); // a leader switch rebuilds it for the new sheet
    const ids = offensiveActionIds();
    hotbar = ui.createHotbar(
      ids.map((id) => ({ id, label: ACTIONS[id].label, ap: ACTIONS[id].ap, ammoCost: ACTIONS[id].ammoCost })),
      { onArm: toggleOocArm },
    );
    hotbar.refresh(sheet);
    hotbarPaper = sheet.paper;
  }

  // --- leader switching --------------------------------------------------------
  // A portrait click hands control to another member. Everything leader-keyed
  // re-keys through the `sheet`/`player` bindings: camera follow, click-to-
  // move, the hotbar (rebuilt - different sheets bring different actions), the
  // HUD, pathing costs, menu verbs, and the follower set. The outgoing leader
  // stops walking and their pending walk-up dies with the handoff.
  // In combat the portraits switch the ACTIVE combatant; out of it, the
  // leader. Same bar, same click, right verb for the moment.
  const partyBar = ui.createPartyBar({
    onSelect: (i) => (inCombat && combat ? combat.setActive(i) : switchLeader(i)),
  });
  let partyBarKey = ''; // last rendered roster state (refresh gate)
  function switchLeader(i) {
    if (!party || inCombat || gameOver || dialogue.visible) return;
    const m = party.members[i];
    if (!m?.actor || m === partyLeader(party) || m.sheet.hp <= 0) return;
    player.clearPath();
    pendingAction = null;
    armedOoc = null;
    party.active = i;
    sheet = m.sheet;
    player = m.actor;
    buildHotbar(); // their attacks, their ammo count
    ui.updateStatsHud(sheet);
    loot.refreshPanel(sheet);
    ui.say(`You take point as ${m.sheet.name}.`);
  }
  function cycleLeader() {
    if (!party || party.members.length < 2) return;
    for (let step = 1; step < party.members.length; step++) {
      const i = (party.active + step) % party.members.length;
      const m = party.members[i];
      if (m.sheet.hp > 0 && m.actor) { switchLeader(i); return; }
    }
  }
  function toggleOocArm(id) {
    if (!sheet || inCombat || gameOver || dialogue.visible || !ACTIONS[id]) return;
    armedOoc = armedOoc === id ? null : id;
    hotbar?.setArmed(armedOoc);
    ui.say(armedOoc ? `${ACTIONS[armedOoc].label} ready — click a coworker to start it.` : 'You stand down.');
  }

  // First (enemy, member) adjacency in the party - any member can get
  // cornered, and the fight engages around whoever it was.
  function adjacentEnemyToParty() {
    for (const m of party?.members || []) {
      if (!m.actor?.entity || m.sheet.hp <= 0) continue;
      const en = enemies.find((e) =>
        e.alive && Math.abs(m.actor.x - e.x) <= 1 && Math.abs(m.actor.z - e.z) <= 1);
      if (en) return { en, member: m };
    }
    return null;
  }

  // Start (or refuse to start) a fight. `engaged` is everyone joining now,
  // `primary` the coworker who triggered it (drives the flavor line + facing),
  // `opening` an optional { actionId, target } fired as the first move when the
  // fight is kicked off from the persistent hotbar.
  function beginCombat({ engaged, primary, opening = null }) {
    if (!sheet || inCombat || gameOver || !player.entity) return;
    for (const m of party.members) m.actor?.clearPath(); // followers freeze too
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
    ui.setFocusBanner(null);
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
      party,
      engaged,
      opening,
      world: {
        isWalkable,
        // The acting member's own route: allies BLOCK in combat (no ending a
        // move stacked on a teammate; sequenced moves can afford the detour)
        // and the costs are the walker's own talents, not the leader's.
        findPath: (sx, sz, tx, tz, self = player) => {
          const ms = party.members.find((m) => m.actor === self)?.sheet || sheet;
          const open = (x, z) => isWalkable(x, z) && !party.members.some((m) =>
            m.actor && m.actor !== self && m.sheet.hp > 0 && m.actor.x === x && m.actor.z === z);
          return findPath(open, sx, sz, tx, tz, hazardCostFor(ms), grid.stepOpen);
        },
        // Enemy routing: never through a party member's tile, and costed by
        // the enemy hazard model - your talents don't shape THEIR fears.
        findEnemyPath: (sx, sz, tx, tz) => findPath(
          (x, z) => isWalkable(x, z) && !partyAt(x, z),
          sx, sz, tx, tz, enemyHazardCost, grid.stepOpen),
        // Any-angle smoothing for combat walks. The party variant starts
        // from the acting member's body; the enemy variant treats the enemy's
        // own tile as open (they're standing on it) and starts from their body.
        smooth: (p, actor) => smoothFromBody(p, actor),
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
        // floor to frame, so they DO stop throws (grid.sightOpen); so does smoke
        // (sightClear).
        hasLos: (ax, az, bx, bz) => segmentClear(sightClear, ax, az, bx, bz, grid.sightOpen),
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
        // One combat round = one fire/smoke turn (combat.js calls this as it
        // hands the turn back to the player).
        onRound: () => runtime.advanceTurn(),
        onEnemyKilled: awardKill,
        onWin: () => {
          inCombat = false;
          combat = null;
          syncLeaderBindings(); // control stays with whoever had the floor
          // A breather after every victory, so back-to-back fights aren't a
          // death spiral - wounds still carry over, just less brutally. The
          // whole party catches its breath, and the downed come to at 1 HP.
          for (const m of party.members) {
            if (m.sheet.hp > 0) m.sheet.hp = Math.min(m.sheet.maxHp, m.sheet.hp + VICTORY_HEAL);
            else {
              m.sheet.hp = 1;
              if (m.actor) m.actor.fx = null;
              ui.toast(`${m.sheet.name} comes to.`);
            }
          }
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

  // Proximity trigger: a coworker adjacent to any party member starts the
  // fight (walk into range, or get cornered). Everyone within the engage
  // radius of the cornered member joins.
  function checkCombatTrigger() {
    if (!sheet || inCombat || gameOver || !player.entity) return;
    const hit = adjacentEnemyToParty();
    if (!hit) return;
    const { en, member } = hit;
    const engaged = enemies.filter((e) =>
      e.alive && Math.max(Math.abs(e.x - member.actor.x), Math.abs(e.z - member.actor.z)) <= ENGAGE_RADIUS);
    beginCombat({ engaged, primary: en });
  }

  // Hotbar trigger: an armed attack, aimed at a coworker, opens combat with
  // that move. The clicked target joins even if it's beyond the engage radius
  // (a thrown opener can reach further than the auto-engage does).
  function engageWithAction(en, actionId) {
    if (!sheet || inCombat || gameOver || !en?.alive) return;
    // Pre-flight the opener before any fight begins: an armed misclick on a
    // coworker nobody can actually reach (sealed behind walls and closed
    // doors) or throw at would otherwise open an unwinnable stalemate -
    // combat would start, and neither side could ever close the distance.
    const a = ACTIONS[actionId];
    if (a.ammoCost) {
      if (!oocTargetOk(actionId, en)) { ui.say('No line for that throw from here.'); return; }
    } else if (a.type === 'shove') {
      if (cheb(player, en) > 1) { ui.say('Too far to shove. Walk your feelings over first.'); return; }
    } else if (cheb(player, en) > 1 && !bestApproachPath(en.x, en.z)) {
      ui.say('No way to reach them from here.');
      return;
    }
    const engaged = enemies.filter((e) =>
      e.alive && Math.max(Math.abs(e.x - player.x), Math.abs(e.z - player.z)) <= ENGAGE_RADIUS);
    if (!engaged.includes(en)) engaged.push(en);
    beginCombat({ engaged, primary: en, opening: { actionId, target: en } });
  }

  // Tile effects (data-driven from TILE_TYPES[..].onEnter) fire per step, for
  // ANY party member walking - each member's own sheet takes the damage, the
  // gum, the ammo. Hazards hit on any step; the exit only fires when it's the
  // LEADER's deliberate destination, so pathing past it (or a follower
  // trailing over it) doesn't end the level by accident. Walk-up interactions
  // are the leader's too - they're what the player clicked.
  function onMemberStep(member, x, z, pathDone, changed = true) {
    const ms = member.sheet;
    const actor = member.actor;
    const isLeader = member === partyLeader(party);
    const fx = grid.defAt(x, z).onEnter;
    if (fx) {
      if (fx.effect === 'exit' && pathDone && !inCombat && isLeader) {
        gameOver = true;
        actor.clearPath();
        // Mid-campaign exits lead to the next floor (the party - wounds, XP,
        // coffee habits - carries over via saved progress). The last floor,
        // and any playtest level, ends the run.
        if (!playtesting && level.next && LEVELS[level.next]) {
          // A breather in the stairwell, so you never start a floor one
          // puddle away from death. The downed get carried and come to on
          // the landing.
          for (const m of party.members) {
            m.sheet.hp = Math.min(m.sheet.maxHp, Math.max(m.sheet.hp, 0) + STAIRWELL_HEAL);
          }
          localStorage.setItem(PROGRESS_KEY, JSON.stringify(serializeProgress(party, level.next)));
          ui.showFloorClear({ nextName: LEVELS[level.next].name }, () => location.reload());
        } else {
          clearProgress();
          ui.showWinScreen({ level: ms.level, defeated: enemies.filter((e) => !e.alive).length });
        }
        return;
      }
      if (fx.effect === 'damage' && changed) {
        const dead = applyDamage(ms, fx.amount);
        actor.flinch();
        vfx.damageText(x, z, `-${fx.amount}`);
        ui.say(fx.message);
        ui.updateStatsHud(sheet);
        if (dead) {
          downOrLose(member, 'Done in by the office itself. The floor was, in fact, wet.');
          return;
        }
      }
    }
    // Paper-cut bleeding drips on every tile entered while it lasts.
    if (changed && ms.bleed > 0) {
      ms.bleed -= 1;
      const bled = applyDamage(ms, 1);
      vfx.damageText(x, z, '-1');
      ui.say('You drip on the carpet. -1 HP.');
      ui.updateStatsHud(sheet);
      if (bled) {
        downOrLose(member, 'Death by a thousand paper cuts. Well - several.');
        return;
      }
    }
    // Surface effects (data/surfaces.js): fire and electrified pools hurt,
    // paper cuts (and arms you), water and coffee editorialize. The walking
    // member's talents can shrug damage off. Only on genuine tile entry.
    const sfx = changed ? surfEffect(x, z) : null;
    if (sfx) {
      if (sfx.ammo) {
        ms.paper = Math.min(PAPER_CAP, ms.paper + sfx.ammo);
        vfx.damageText(x, z, '+📄', '#8adf76');
      }
      // Gum on shoe: slowed, no kicking, but genuine traction (can't slip).
      if (sfx.applies === 'gum' && stickGum(x, z)) {
        const had = ms.gum > 0;
        ms.gum = GUM.steps;
        ui.say(had ? 'More gum. You are building a collection.' : sfx.message);
        ui.updateStatsHud(sheet);
      }
      const amount = effectiveSurfDamage(x, z, ms);
      if (amount > 0) {
        if (sfx.bleed) ms.bleed = Math.max(ms.bleed, sfx.bleed);
        const dead = applyDamage(ms, amount);
        actor.flinch();
        vfx.damageText(x, z, `-${amount}`);
        ui.say(sfx.message);
        ui.updateStatsHud(sheet);
        if (dead) {
          downOrLose(member, 'Done in by the office itself. Facilities sends their regards.');
          return;
        }
      } else if (sfx.amount) {
        ui.say(ms.talent?.effects?.shockImmune && grid.isElectrified(x, z)
          ? 'The water crackles. Your ESD soles rate this a non-event. 0 damage.'
          : 'You glide across the drift; the edges respect a master. Not a scratch.');
        ui.updateStatsHud(sheet);
      } else if (sfx.message && !sfx.applies) {
        ui.say(sfx.message);
      }
    }
    // Slippery surfaces: every wet tile entered risks a spill that ends the
    // walk right there. In combat the movement AP already spent stays spent -
    // that IS the penalty. slipImmune tread never slips; neither does a
    // gummed shoe - gum is traction.
    if (changed && !gameOver && !ms.talent?.effects?.slipImmune && !(ms.gum > 0)) {
      const chance = slipChanceAt(x, z);
      if (chance && Math.random() < chance) {
        actor.clearPath();
        actor.flinch();
        vfx.damageText(x, z, 'slip!', '#8ad4df');
        if (inCombat) combat?.notifySlip();
        else ui.say('The floor was, in fact, wet. You go down. Gracefully? No.');
      }
    }
    // Gum wears off with mileage.
    if (changed && ms.gum > 0) {
      ms.gum -= 1;
      if (ms.gum === 0) {
        ui.say('The gum finally lets go of your sole. Freedom.');
        ui.updateStatsHud(sheet);
      }
    }
    // Walk-up interactions (lighting trash cans) fire on deliberate arrival.
    if (isLeader && pendingAction && pathDone
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
      // God-mode click-to-place (spawn/drop/teleport) consumes the click before
      // any normal handling, reusing the game's own ground raycast.
      if (pendingGodPick) {
        const cb = pendingGodPick;
        pendingGodPick = null;
        cb(tile, point);
        return;
      }
      if (!sheet || gameOver) return;
      // In combat, targeting stays tile-based: the tactical grid (movement
      // previews, AP, target rings) is all tile/ground-keyed, and a click must
      // hit the enemy on the CLICKED tile, not whichever body the ray grazes.
      if (inCombat) {
        // Bodies first, via the pick ray: the target rings mark BODIES, and
        // the ground fallback behind a tall mesh is a mis-walk that burns AP.
        // Clicking a teammate's body hands them the floor; clicking a
        // coworker's body targets them. Ground clicks stay tile-based for
        // movement.
        // Your OWN tile wins first: a self-cast (purge on yourself) or a
        // shuffle-in-place must never be stolen by an adjacent enemy's tall
        // body mesh overlapping the click. Enemies can't stand on your tile,
        // so this is unambiguous.
        if (tile && tile.x === player.x && tile.z === player.z) {
          combat?.handleTileClick(tile, point);
          return;
        }
        const bodyHit = picking.pick(controls.cameraEntity, sx, sy);
        if (bodyHit?.kind === 'party') {
          const m = memberOf(bodyHit.ref);
          if (m && m.sheet.hp > 0 && m !== partyLeader(party)) {
            combat?.setActive(party.members.indexOf(m));
            return;
          }
          // your own body (or a downed member): fall through to the ground
        } else if (bodyHit?.kind === 'enemy' && bodyHit.ref.alive) {
          combat?.handleEnemyClick(bodyHit.ref);
          return;
        }
        if (!tile) return;
        const en = enemyAt(tile.x, tile.z);
        if (en) { combat?.handleEnemyClick(en); return; }
        // Clicking another member's ground tile also hands them the floor
        // (their own tile stays a ground click - purge self-casts, shuffles).
        const pm = party?.members.find((m) =>
          m.actor && m.sheet.hp > 0 && m.actor.x === tile.x && m.actor.z === tile.z);
        if (pm && pm !== partyLeader(party)) {
          combat?.setActive(party.members.indexOf(pm));
          return;
        }
        combat?.handleTileClick(tile, point);
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
      if (inCombat && combat) {
        combat.handleHover(point, sx, sy);
        // Hold Ctrl mid-fight and hovering a character glows their BODY (and
        // names them in the banner) - the same read you get out of combat.
        if (ctrlHeld) {
          const hit = picking.pick(controls.cameraEntity, sx, sy);
          const character = hit && (hit.kind === 'party' || hit.kind === 'npc'
            || (hit.kind === 'enemy' && hit.ref.alive));
          hoverKind = character ? hit.kind : null;
          if (character) {
            setHoverHighlight(hit.entity, colorForHit(hit));
            ui.setFocusBanner(focusInfoFor(hit, point));
          } else {
            clearHoverHighlight();
            ui.setFocusBanner(null);
          }
        } else {
          hoverKind = null;
          clearHoverHighlight();
          ui.setFocusBanner(null);
        }
        return;
      }
      if (!sheet || gameOver || dialogue.visible) { clearHoverHighlight(); setCursor(null); ui.setFocusBanner(null); return; }
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
      if (hit && hit.kind === 'party') {
        const m = memberOf(hit.ref);
        // Your own healthy body falls through to the ordinary tile menu.
        if (m && (m !== partyLeader(party) || m.sheet.hp <= 0)) {
          const items = [];
          if (m.sheet.hp <= 0) {
            items.push({ label: `Help ${m.sheet.name} up`, action: () => approachAndDo(hit.ref.x, hit.ref.z, () => helpUp(m)) });
          } else {
            if (hit.ref.def?.dialogue || hit.ref.def?.recruitedDialogue) {
              items.push({ label: `Talk to ${m.sheet.name}`, action: () => approachAndDo(hit.ref.x, hit.ref.z, () => dialogue.open(hit.ref)) });
            }
            const i = party.members.indexOf(m);
            if (i !== party.active) items.push({ label: `Switch to ${m.sheet.name}`, action: () => switchLeader(i) });
          }
          items.push({ label: 'Examine', action: () => ui.say(hit.ref.def?.examine || 'One of yours. Holding up, mostly.') });
          ui.showMenu(sx, sy, items);
          return;
        }
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
        // A lighter (Smoker) or a book of matches turns a flammable surface
        // into an option.
        if (canIgnite() && surfId && SURFACES[surfId].flammable && !runtime.isBurning(tile.x, tile.z)) {
          items.unshift({
            label: igniteVerb(),
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
        if (canIgnite() && runtime.ignitable(tile.x, tile.z)) {
          items.unshift({
            label: igniteVerb(),
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
    } else if (e.key === 'Control') {
      ctrlHeld = true; // rings under everyone while held (see drawCharacterRings)
    } else if ((e.key === 'i' || e.key === 'I') && sheet && !gameOver) {
      loot.togglePanel(sheet);
    } else if (/^[1-9]$/.test(e.key) && sheet && !inCombat && !gameOver && !dialogue.visible) {
      // Number keys arm the matching hotbar slot (out-of-combat targeting).
      const id = offensiveActionIds()[Number(e.key) - 1];
      if (id) toggleOocArm(id);
    } else if (e.key === 'Tab' && sheet && !gameOver && !dialogue.visible) {
      // Tab cycles who you control - the active combatant mid-fight, the
      // leader outside one.
      e.preventDefault();
      if (inCombat) combat?.cycleActive();
      else cycleLeader();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') loot.hideLabels();
    if (e.key === 'Control') ctrlHeld = false;
  });
  window.addEventListener('blur', () => { loot.hideLabels(); ctrlHeld = false; });

  // Cosmetic combat feedback (projectiles, floating numbers). Defined after
  // controls exist because the damage text projects through the camera.
  const vfx = {
    projectile: (from, to, kind) => throwProjectile(app, from, to, kind),
    damageText: (x, z, text, color) =>
      spawnDamageText(app, controls.cameraEntity, x, 0.2, z, text, color),
  };

  // --- main loop ------------------------------------------------------------------
  const BASE_SPEED = 4;
  const FOLLOW_NEAR = 2; // tiles from the leader - close enough, stand easy
  const CATCH_UP = 1.3; // a lagging follower hustles
  // Sticky surfaces (coffee) slow whoever stands in them - queried from the
  // RUNTIME layer, so a surface that burns away stops slowing anyone. Gum on
  // a shoe slows its owner everywhere. Followers who fall behind walk faster
  // than decorum allows.
  function memberSpeed(m) {
    let s = BASE_SPEED
      * (SURFACES[runtime.surfaceAt(m.actor.x, m.actor.z)]?.slow || 1)
      * (m.sheet.gum > 0 ? GUM.slow : 1);
    const lead = partyLeader(party);
    if (m !== lead && lead.actor
      && Math.max(Math.abs(m.actor.x - lead.actor.x), Math.abs(m.actor.z - lead.actor.z)) > FOLLOW_NEAR + 1) {
      s *= CATCH_UP;
    }
    return s;
  }
  // Followers trail the leader BG-style: when one drifts beyond FOLLOW_NEAR it
  // paths to a free tile beside the leader (distinct per follower), costed by
  // its OWN talents, pass-through for the rest of the party, and never parking
  // on a tile that would hurt it. A small repath cadence keeps Dijkstra off
  // the hot path; per-tile effects land through onMemberStep like any walk.
  function updateFollowers(dt) {
    const lead = partyLeader(party);
    if (!lead.actor?.entity) return;
    const claimed = new Set();
    for (const m of party.members) {
      if (m === lead || !m.actor?.entity || m.sheet.hp <= 0) continue;
      m.followT = (m.followT ?? 0) - dt;
      if (m.followT > 0) continue;
      m.followT = 0.25;
      const dist = Math.max(Math.abs(m.actor.x - lead.actor.x), Math.abs(m.actor.z - lead.actor.z));
      if (dist <= FOLLOW_NEAR) continue; // near enough - let any walk finish
      // Through the party, around everything else.
      const open = (x, z) => grid.terrainOpen(x, z) && !enemyAt(x, z) && !npcAt(x, z);
      let spot = null;
      for (const [dx, dz] of DIRS8) {
        const sx = lead.actor.x + dx;
        const sz = lead.actor.z + dz;
        if (!open(sx, sz) || claimed.has(sx + ',' + sz)) continue;
        if (effectiveSurfDamage(sx, sz, m.sheet) > 0) continue; // no parking in fire
        if (!spot || Math.hypot(sx - m.actor.x, sz - m.actor.z) < Math.hypot(spot[0] - m.actor.x, spot[1] - m.actor.z)) {
          spot = [sx, sz];
        }
      }
      if (!spot) continue;
      claimed.add(spot[0] + ',' + spot[1]);
      const p = findPath(open, m.actor.x, m.actor.z, spot[0], spot[1], hazardCostFor(m.sheet), grid.stepOpen);
      if (!p || p.length < 2) continue;
      p[p.length - 1] = clampPoint(spot[0], spot[1]);
      const pos = m.actor.entity.getPosition();
      const s = smoothPath((x, z) => open(x, z) && effectiveSurfDamage(x, z, m.sheet) <= 0,
        [[pos.x, pos.z], ...p.slice(1)], grid.edgeOpen);
      m.actor.setPath(s);
    }
  }
  app.on('update', (dt) => {
    // Every party member walks, steps and animates the same way; each one's
    // tile effects run against their own sheet (onMemberStep).
    if (party) {
      for (const m of party.members) {
        if (!m.actor) continue;
        m.actor.speed = memberSpeed(m);
        m.actor.update(dt, (x, z, done, changed) => onMemberStep(m, x, z, done, changed));
      }
      if (sheet && !inCombat && !gameOver) updateFollowers(dt);
    } else {
      player.update(dt); // idling on the spawn tile behind the class picker
    }
    const world = {
      paused: inCombat || gameOver,
      isWalkable,
      isHazard: enemyIsHazard, // wander avoidance uses the ENEMY hazard model
      blockedByParty: partyAt,
      occupied: (x, z, self) =>
        partyAt(x, z)
        || enemies.some((e) => e.alive && e !== self && e.x === x && e.z === z),
      slips: (x, z) => Math.random() < slipChanceAt(x, z),
      stickGum,
      // A wander route never crosses hazards, other actors, or a party
      // member's tile; the enemy's own start tile counts as open. Returns it
      // smoothed.
      findWanderPath: (en, tx, tz) => {
        const open = (x, z) => (x === en.x && z === en.z
          ? grid.terrainOpen(x, z)
          : enemyClearOfHazards(x, z) && !partyAt(x, z));
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
    // The bottom narrator box gets general narration only when nothing else
    // owns the bottom of the screen: not mid-fight (combat has its own log),
    // not mid-conversation (the dialogue panel is up), not pre-class-pick.
    ui.setNarrationGate(!!sheet && !inCombat && !gameOver && !dialogue.visible);
    // Persistent hotbar: visible only when it can act; ammo counts refresh
    // when they change (the gate keeps DOM writes off the hot path). Armed
    // out-of-combat target rings redraw each frame, like combat's own.
    if (hotbar) {
      const show = !!sheet && !inCombat && !gameOver && !dialogue.visible;
      hotbar.setVisible(show);
      if (show && sheet.paper !== hotbarPaper) { hotbarPaper = sheet.paper; hotbar.refresh(sheet); }
      if (show && armedOoc) drawOocTargets();
    }
    // Ctrl rings redraw each frame while held (immediate-mode lines last one
    // frame) - in and out of combat alike.
    if (ctrlHeld && sheet && !gameOver) drawCharacterRings();
    // Party bar: redraw only when the roster state changes (names/HP/active,
    // plus per-member AP mid-fight); visible only once there's an actual
    // party to show.
    if (party) {
      const cp = inCombat && combat ? combat.party : null;
      const key = party.members
        .map((m, i) => `${m.sheet.name}:${m.sheet.hp}/${m.sheet.maxHp}${i === party.active ? '*' : ''}${cp ? ':' + cp[i].ap : ''}`)
        .join('|');
      if (key !== partyBarKey) { partyBarKey = key; partyBar.refresh(party, cp); }
      partyBar.setVisible(party.members.length > 1 && !gameOver);
    }
    // Fire/smoke age in TURNS. In combat, combat.js advances one per round (via
    // the onRound callback in beginCombat). Out of combat there are no rounds, so
    // a real-time clock stands in - about one turn per OOC_TURN_SECONDS.
    if (!gameOver && !inCombat) {
      oocTurnClock += dt;
      while (oocTurnClock >= OOC_TURN_SECONDS) {
        oocTurnClock -= OOC_TURN_SECONDS;
        runtime.advanceTurn();
      }
    }
    animateSurfaces(dt);
    // The loot overlay tracks the world while held (the camera keeps easing).
    if (loot.labelsVisible) {
      loot.repositionLabels((w) => {
        const s = worldToScreenCss(app, controls.cameraEntity, w.x, w.y, w.z);
        return s.behind ? null : s;
      });
    }
    // Follow the player, keeping them centred in frame. Track the entity's
    // CONTINUOUS position (player.x/z is the logical tile, which jumps a whole
    // tile at a time and makes the camera step along with the walk).
    const pp = player.entity ? player.entity.getPosition() : player;
    controls.follow({ x: pp.x, z: pp.z }, dt);
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
  ], ['Alt — show loot', 'Ctrl — mark everyone', 'I — open pockets', '1–9 — aim an attack']);
  if (restoredProgress) {
    // Continuing a campaign run: same party, next floor - no picker. Field
    // backfills for older saves live in parseProgress. The active member gets
    // the PlayerActor; everyone else walks out of the stairwell beside them.
    party = createParty(restoredProgress.sheets[0]);
    for (const s of restoredProgress.sheets.slice(1)) addMember(party, s);
    party.active = restoredProgress.active;
    partyLeader(party).actor = player;
    sheet = partyLeader(party).sheet;
    spawnPlayerModel();
    for (const m of party.members) {
      if (m.actor) continue; // the leader, already placed
      const def = COMPANIONS[m.sheet.companionId]
        // A non-active class character (saved mid-switch) rides the same
        // follower plumbing with a minimal def - model from their own sheet.
        || { name: m.sheet.name, model: m.sheet.model, examine: 'One of yours. Holding up, mostly.' };
      let spot = grid.playerSpawn;
      for (const [dx, dz] of DIRS8) {
        const x = grid.playerSpawn.x + dx;
        const z = grid.playerSpawn.z + dz;
        if (isWalkable(x, z)) { spot = { x, z }; break; }
      }
      const comp = new CompanionActor(spot.x, spot.z, m.sheet.companionId || m.sheet.classId, def);
      comp.recruited = true;
      m.actor = comp;
      placeModel(app, `assets/characters/${m.sheet.model}.glb`, spot.x, spot.z, {
        lift, rotY: 90, animate: true,
        onReady: (e) => { applyCharacterProportions(e); comp.attach(e); picking.register(e, 'party', comp); },
      });
    }
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
    get smoking() { return runtime.smokingCount; },
    isSmoke: (x, z) => runtime.isSmoke(x, z),
    losClear: (ax, az, bx, bz) => hasLos({ x: ax, z: az }, { x: bx, z: bz }),
    get inventory() { return sheet ? [...sheet.inventory] : []; },
    get looseItems() { return loot.debug.looseItems(); },
    get lootLabelCount() { return document.querySelectorAll('.loot-label').length; },
    containerLootAt: loot.debug.containerLootAt,
    get doors() { return [...grid.doors].map(([key, d]) => ({ key, open: d.open })); },
    surfaceAt: (x, z) => runtime.surfaceAt(x, z),
    get enemies() {
      return enemies.map((e) => {
        const p = e.entity?.getPosition();
        // `reachable`: is there a walk-up route from the leader to a tile
        // beside them right now? Sealed-in coworkers (behind walls + a closed
        // door) are unreachable, so a click on them does nothing - the e2e
        // suite uses this to avoid wasting engage attempts on them.
        const reachable = e.alive
          && (cheb(player, e) <= 1 || !!bestApproachPath(e.x, e.z));
        return { name: e.def.name, x: e.x, z: e.z, px: p?.x, pz: p?.z, alive: e.alive, reachable };
      });
    },
    get npcs() { return npcs.map((n) => ({ name: n.def.name, x: n.x, z: n.z })); },
    get party() {
      return party ? party.members.map((m, i) => ({
        name: m.sheet.name, hp: m.sheet.hp, maxHp: m.sheet.maxHp,
        x: m.actor?.x, z: m.actor?.z, active: i === party.active,
      })) : [];
    },
    // Out-of-combat targeting + hover state, for the e2e suite.
    get armed() { return armedOoc; },
    get hoverKind() { return hoverKind; },
    get ctrlHeld() { return ctrlHeld; },
    get cursor() { return canvasEl ? canvasEl.style.cursor : ''; },
    get dialogueOpen() { return dialogue.visible; },
  };

  // God mode (human-testing tweak panel; toggle with ` or F8). Unlike __game,
  // this hands out LIVE references and mutators so the panel can edit runtime
  // state in place - see god.js. It reflects over the same objects the game
  // owns; the action methods below are the few things the panel can't reach
  // without this closure (spawning into `enemies`, dropping via `loot`, etc.).
  window.__god = {
    get player() { return sheet; }, // the ACTIVE member's live sheet, or null pre-pick
    get playerActor() { return player; },
    get party() { return party; }, // live - the god panel reflects every member's sheet
    switchTo(i) {
      if (inCombat && combat) combat.setActive(i);
      else switchLeader(i);
    },
    reviveMember(i) {
      const m = party?.members[i];
      if (m && m.sheet.hp <= 0) helpUp(m);
      window.__combat?.refresh();
    },
    // Recruit a companion standing on this floor (the same path a dialogue
    // effect takes). Returns false when they aren't here or the roster's full.
    recruit(id) {
      const npc = npcs.find((n) => n instanceof CompanionActor && n.typeId === id);
      if (!npc || !canRecruit(npc)) return false;
      recruitCompanion(npc);
      return true;
    },
    get enemies() { return enemies; },
    get combat() { return window.__combat || null; }, // live only mid-fight
    app,
    get timeScale() { return app.timeScale; },
    set timeScale(v) { app.timeScale = v; },
    get inCombat() { return inCombat; },
    get gameOver() { return gameOver; },
    get burningCount() { return runtime.burningCount; },
    get doors() { return [...grid.doors].map(([key, d]) => ({ key, open: d.open })); },
    setDoorOpen(key, open) {
      if (!grid.doors.has(key)) return;
      grid.setDoorOpen(key, open);
      scene.refreshDoor(key);
      for (const e of enemies) e.clearPath(); // their routes may have changed
    },
    spawnEnemy(typeId, x, z) {
      const def = ENEMY_TYPES[typeId];
      if (!def) return null;
      const en = new EnemyActor(x, z, typeId, def);
      enemies.push(en);
      placeModel(app, `assets/characters/${def.model}.glb`, x, z, {
        lift, rotY: -90, animate: true,
        onReady: (e) => { applyCharacterProportions(e); en.attach(e); },
      });
      return en;
    },
    giveItem(id) {
      if (!sheet) return;
      sheet.inventory.push(id);
      loot.refreshPanel(sheet);
      ui.updateStatsHud(sheet);
    },
    dropItem(id, x, z) { loot.dropAt(x, z, id); },
    teleport(x, z) {
      if (!player.entity) return;
      const p = player.entity.getPosition();
      player.clearPath();
      player.entity.setPosition(x, p.y, z);
      player.x = Math.round(x);
      player.z = Math.round(z);
    },
    refreshHud() { if (sheet) { ui.updateStatsHud(sheet); loot.refreshPanel(sheet); } },
    // Click-to-place: the panel arms a callback, the next left-click on the
    // ground (handled in onLeftClickTile) fires it with the picked tile/point.
    armPick(cb) { pendingGodPick = cb; },
    get picking() { return !!pendingGodPick; },
    // Step the fire/smoke lifecycle one turn (what a combat round does) - a
    // deterministic handle for the god panel and tests, independent of the
    // out-of-combat real-time clock.
    advanceFireTurn() { runtime.advanceTurn(); },
  };
  installGodMode(window.__god);
}
