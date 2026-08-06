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
import { ITEMS } from './data/items.js';
import { CLASSES } from './data/classes.js';
import { ACTIONS, arrivalLine } from './data/actions.js';
import { parseLevel } from './grid.js';
import { parseFloors, layeredGrid, planCrossLayerRoute } from './floors.js';
import { findPath, smoothPath, routeOpen, segmentClear, clampToClearance, approachPoint, routeToFiringPosition } from './pathfinding.js';
import { NEIGHBOR_DIRS as DIRS8 } from './directions.js';
import { seesBody, coneBoundary, deriveFacing } from './stealth.js';
import {
  createSheetFrom, applyDamage, spendAttrPoint, spendClassPoint, grantTalent, classTrack,
  scaleEnemy, damageBonus, deflect, trackNode, PAPER_CAP, EQUIP_SLOTS, equippedAction, equippedStats,
  orderedActionIds, reachOf, rangeOf, ammoCostOf, pendingPoints as pending, spendablePoints,
  lookOf, REACH, STEALTH, effectiveAttr,
} from './stats.js';
import {
  createParty, leader as partyLeader, addMember, gainXpAll, createCompanionSheet,
  serializeProgress, parseProgress, PARTY_CAP, addCash,
} from './party.js';
import { applyStatus, removeStatus, statusFx, hasStatus, tickStep, tickTurn, statusLeft, statusList } from './statuses.js';
import { createDraft, createCharacter, draftModel, draftLook } from './creation.js';
import { CUSTOM_RIGS } from './data/looks.js';
import { aimsAtAlly, coneFrom, conePolyline, isToppleable } from './powers.js';
import { PARTITION_TOPPLE, acceptsSurface, blocksSight } from './data/tiles.js';
import { cheb as chebOf } from './tactics.js';
import { crouchFacesAt, leaveCrouch } from './crouch-rules.js';
import { PlayerActor, EnemyActor, NpcActor, CompanionActor } from './actors.js';
import { COMPANIONS } from './data/companions.js';
import { createApp, buildLevel, buildLayeredLevel } from './scene.js';
import { createCombatWorld } from './combat-world.js';
import { createHotbarHost } from './hotbar-host.js';
import { createFloorEffects } from './floor-effects.js';
import { createPlayerSideStepper, createPlayerSideTraveler } from './player-side-step.js';
import {
  advanceTravelExposure,
  exposureDistanceFromComposure,
  resetTravelExposure,
  travelExposureStateFor,
} from './travel-exposure.js';
import { createEnemyTraveler } from './enemy-travel.js';
import { showLevelMenu } from './desk.js';
import { createOocVerbs } from './ooc-verbs.js';
import { createFrame } from './frame.js';
import { createCombatEntry } from './combat-entry.js';
import { createMouse } from './mouse.js';
import { createKeyboard } from './keyboard.js';
import { createExamine } from './examine.js';
import { createWorldEdits } from './world-edits.js';
import { createWalking } from './walking.js';
import { createSummonLayer } from './summon-layer.js';
import { createProgressionUi } from './progression-ui.js';
import { createSneakLayer } from './sneak-layer.js';
import { createPartyControl } from './party-control.js';
import { mulberry32 } from './rng.js';
import { isLivingMember, livingMemberAt } from './member-rules.js';

import { loadRemoteStore, SAVE_KEY_STORAGE } from './remote-store.js';
import { placeModel, applyCharacterProportions, cloneMaterials, tintMaterials } from './models.js';
import { createPortraits } from './portraits.js';
import {
  throwPaperFan, throwProjectile, spawnDamageText, worldToScreenCss, impact as impactFx, statusBurst,
  createAuraLayer, footstep, bloodSplat, CHEST_Y,
} from './fx.js';
import { createControls } from './controls.js';
import { createPicker } from './picking.js';
import { createHoverLayer } from './hover.js';
import { createAimPaint } from './aim-paint.js';
import { createVisionLayer } from './vision.js';
import { createLooting } from './looting.js';
import { createShopping } from './shopping.js';
import {
  surfaceEffect, rawSurfaceDamage, effectiveSurfaceDamage, slipChance, slips,
  hasGum, surfacePathCost, impactKindFor, speedUnderStatus,
} from './step-rules.js';
import { createDoors, atDoor, COMBAT_DOOR_AP } from './doors.js';
import { createDialogue, shopKeyForNpc, sayRecruited } from './dialogue.js';
import {
  summonRange, summonRoom, dropCount, summonSpotProblem, summonLandingPoints,
} from './summon-rules.js';
import { areaIntersectsBody, bodyPoint } from './area-geometry.js';
import { outOfCombatActionState } from './hotbar-model.js';
import { startCombat } from './combat.js';
import { verbSides } from './combat-targeting.js';
import { canReach as canReachAt, engagedAround } from './combat-geometry.js';
import { fineConeCells } from './surface-mask.js';
import { startEditor } from './editor.js';
import { NPCS } from './data/npcs.js';
import { installGodMode } from './god.js';
import { createGameDebug } from './game-debug.js';
import { createGodDebug } from './god-debug.js';
import { createRunSession } from './run-session.js';
import * as ui from './ui.js';

const pc = globalThis.window?.pc;
const STASH_KEY = 'escape-work.playtest';
const PROGRESS_KEY = 'escape-work.progress';
// Cloud saves (REMOTE_STORE.md): Supabase behind the local save, configured
// per-browser via localStorage['escape-work.remote']. Unconfigured, every
// call is an inert no-op - the game cannot tell the module is here.
// One warning per session, worded by cause - a paused free-tier project is
// the expected one (Supabase answers HTTP 540 for it) and names its fix.
let cloudWarned = false;
const remote = loadRemoteStore(null, null, (kind) => {
  if (cloudWarned) return;
  cloudWarned = true;
  ui.toast(kind === 'paused'
    ? 'Cloud saves offline: the Supabase project is paused — wake it in the dashboard. Saves stay local.'
    : kind === 'rejected'
      ? 'Cloud saves refused — check the key and table setup (REMOTE_STORE.md). Saves stay local.'
      : 'Cloud saves unreachable — no connection to the project. Saves stay local.', 6500);
});
const app = createApp(document.getElementById('app'));

// Level resolution, in priority order:
// 1. a playtest level stashed by the editor (standalone - no campaign)
// 2. campaign progress (mid-run floor + character sheet, saved on floor clear)
// 3. the first shipped level
let activeLevel = LEVELS[FIRST_LEVEL];
let activeLevelId = FIRST_LEVEL;
let playtesting = false;
// Whether THIS boot came from the editor's stash, as opposed to the ?level=
// express lane or a floor picked off the desk. Both suppress campaign writes;
// only one of them has an editor to go back to.
let fromStash = false;
let restoredProgress = null; // { levelId, sheets, active } - party.js handles old shapes
// Does the run about to be played OWN the campaign save? Only a run that was
// restored from it, or one that has since written it by clearing a floor.
//
// The two IMPLICIT retirements - dying, and winning a level with no next floor
// - are gated on this. They used to be gated on `!playtesting` alone, and
// "Start a fresh run" at the desk is a campaign run (`playtesting` false) that
// has written nothing: so picking it and then dying on floor one, which is
// exactly where a level-one party dies, deleted the saved campaign the desk
// had been offering two clicks earlier - local copy and cloud copy both (Q063).
// The player never chose 'Restart run'. That verb stays unconditional; this
// only stops a run destroying somebody else's save on its way out.
let campaignSaveIsOurs = false;
try {
  // Each source gets its OWN guard. Sharing one meant a corrupt playtest stash
  // threw before the campaign save was ever read, so a bad stash silently
  // discarded a real run and dropped you on floor one - the stash is scratch
  // space written by a tool, and it must never be able to cost somebody their
  // progress. Falling back PAST it to the campaign save is the whole point.
  const stash = localStorage.getItem(STASH_KEY);
  if (stash) {
    try {
      const parsed = JSON.parse(stash);
      // A stash that PARSES but is not a level used to brick the game and the
      // editor together, with no in-app recovery - the shape check is what
      // makes "unreadable" mean the same thing for both failure modes.
      if (!Array.isArray(parsed?.map) && !Array.isArray(parsed?.layers)) {
        throw new Error('stashed value is not a level');
      }
      activeLevel = parsed;
      activeLevelId = null;
      playtesting = true;
      fromStash = true;
    } catch {
      localStorage.removeItem(STASH_KEY); // unreadable, and it will stay that way
    }
  }
  if (!playtesting) {
    try {
      const progress = localStorage.getItem(PROGRESS_KEY);
      const p = progress && parseProgress(JSON.parse(progress));
      if (p && LEVELS[p.levelId]) {
        activeLevel = LEVELS[p.levelId];
        activeLevelId = p.levelId;
        restoredProgress = p;
        campaignSaveIsOurs = true; // this run continues the save, so it may retire it
      }
    } catch { /* corrupt save - the shipped level is the honest fallback */ }
  }
} catch { /* localStorage itself is unavailable (private mode, blocked) */ }

// Dev express lane: ?level=<id> boots any registered level standalone - no
// campaign restore, no progress writes (the same posture as an editor
// playtest). How the layered feasibility level is reached.
try {
  const forced = new URLSearchParams(location.search).get('level');
  if (forced && LEVELS[forced]) {
    activeLevel = LEVELS[forced];
    activeLevelId = forced;
    playtesting = true;
    restoredProgress = null;
  }
} catch { /* no URL machinery - keep whatever resolved above */ }

// Dev express lane: ?seed=<n> makes a fight repeatable (AI_PLAN M1's sparring
// bouts). The stream feeds startCombat's injected `rng`, and that reaches the
// rolls combat.js owns - hit rolls, damage and the AI's line picks (the
// module-level `rand` takes its randomness as an argument), initiative
// (`initRng`), and a UNIT's slip. REVIEW.md's "the rng seam is misleading"
// finding was closed before this landed: initiative rolls off the injected
// stream like everything else, so turn order is pinned too. mulberry32, the
// same mixer the confused-shuffle already trusts (combat.js). Absent means
// Math.random, the shipping default.
//
// Three things a seed does NOT pin, and this comment claimed two of them for
// most of its life:
//
//  - Two in-fight rolls escape the stream, both outside combat.js: a MEMBER's
//    slip (`maybeSlip` below) and a body's loot table (`actors.js` die() ->
//    rollLoot, defaulting to Math.random). Neither replays, and because they
//    never draw from the stream they do not move it either. The member slip is
//    on the open list in REVIEW.md; the earlier version of this comment said
//    "slips, loot" as though both were covered.
//  - The stream is built once at boot and never reset per fight, so each fight
//    draws from wherever the last one stopped. A seed pins the FIRST fight of
//    a run reliably; the second only replays if everything before it did.
//  - Where the bodies are when the fight OPENS: a walk-in ends wherever
//    adjacency happens to fire. That is what __god.fight() is for.
let combatRng = Math.random;
try {
  const s = new URLSearchParams(location.search).get('seed');
  if (s) {
    combatRng = mulberry32((Number(s) >>> 0) || 1);
  }
} catch { /* no URL machinery - unseeded like always */ }

const clearProgress = () => {
  // Guarded like every other localStorage touch in the file. This was the last
  // one that was not, and it runs after `gameOver = true` and before the lose
  // screen - so in a storage-blocked browser (which BOOTS fine, because the
  // boot read is guarded) the throw ate the lose screen and the Restart-run
  // escape with it (REVIEW.md 2026-08-02 section 1.13).
  try { localStorage.removeItem(PROGRESS_KEY); } catch { /* nowhere to remove from */ }
  // Outside the try on purpose: a dead localStorage must not also skip the
  // cloud delete, or the desk goes on offering a ghost of an abandoned run.
  remote.clear();
};

// The floor-select desk lives in desk.js. It reads and WRITES four of this
// file's variables, so they arrive as values and named setters rather than as
// assignments from another file.
const openFloorSelect = () => showLevelMenu({
  LEVELS,
  FIRST_LEVEL,
  SAVE_KEY_STORAGE,
  PROGRESS_KEY,
  parseProgress,
  remote,
  ui,
  startGame,
  get restoredProgress() { return restoredProgress; },
  get activeLevel() { return activeLevel; },
  setActiveLevel: (v) => { activeLevel = v; },
  setActiveLevelId: (v) => { activeLevelId = v; },
  setRestoredProgress: (v) => { restoredProgress = v; },
  setPlaytesting: (v) => { playtesting = v; },
});

if (location.hash.includes('editor')) {
  // The editor speaks storeys now (EDITOR_PLAN M4), so a layered level opens
  // as itself: storey 0 is the working set, the rest park behind the switcher,
  // and Export writes the whole stack back. It used to be handed the ground
  // storey alone, which meant opening a two-storey level and pressing Export
  // silently deleted every floor above the first.
  startEditor(app, activeLevel, STASH_KEY);

} else if (!playtesting && !location.hash.includes('class=')) {
  openFloorSelect();
} else {
  startGame(activeLevel);
}
app.start();

// ---------------------------------------------------------------------------------
function startGame(level) {
  // Layered level (EDITOR_PLAN feasibility spike): parse every storey and
  // answer the game's grid questions from the storey the leader is on. Flat
  // levels keep the single parse they always had.
  const floors = level.layers ? parseFloors(level) : null;
  const run = createRunSession();
  const grid = floors ? layeredGrid(floors, level, () => run.playerLayer) : parseLevel(level);
  // Object picking: a click/hover resolves to the interactable ENTITY under
  // the cursor (door, enemy, NPC, prop), not just the floor tile behind it.
  // Built before the scene so doors/props can register as they're created.
  const picking = createPicker();
  const scene = floors ? buildLayeredLevel(app, floors, { picking }) : buildLevel(app, grid, { picking });
  const { walls, updateWallFade, animateSurfaces, floorHeight } = scene;
  // Fire and its consequences live in the surface runtime; handleExplosion is
  // hoisted from below.
  const runtime = createSurfaceRuntime({
    grid,
    hooks: {
      addFlame: scene.addFlame,
      // Paper caught fire, so the paper is gone. Retire it everywhere at once -
      // grid, visual, and the harvested-here mark - exactly as stickGum retires
      // a wad that is now on somebody's shoe. Doing only the visual left the
      // grid still holding a drift on a tile that plainly had none: no surface
      // could ever be laid there again (canTakeSurface refuses an existing
      // surface), it could
      // never burn again, and refreshTile would redraw paper over ash.
      spendFuel: (x, z) => spendSurfaceFuelAt(x, z),
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
  // Enemies scale to the floor's depth (stats.js) - a base coworker on a deep
  // floor is tougher. A placement may also name its own tier (`"G":
  // "manager@3"`), which is how a shallow floor asks for one harder body
  // without a second registry entry existing to BE the harder one. Either way
  // it is the same scaleEnemy doing it: there is one curve, and a level picks a
  // point on it rather than hand-writing a rival to it.
  // `level.depth` is deliberately NOT read here any more. It stays in the
  // format as the floor's number - the lint checks it, the editor round-trips
  // it, the campaign-chain check orders by it - but nothing at runtime derives
  // a number from it. That was the floor curve, and it is gone.
  const enemies = grid.enemySpawns.map((s) => {
    const base = ENEMY_TYPES[s.type];
    // The tier the AUTHOR placed, or the enemy's own native tier. No floor
    // curve: `depth` is the floor's number, not a difficulty multiplier
    // (PROGRESSION_PLAN.md decisions 13-14, designer 2026-08-02).
    const lvl = s.level ?? (base.level || 1);
    return new EnemyActor(s.x, s.z, s.type, scaleEnemy(base, lvl));
  });
  // Player-team summons (SUMMON_PLAN.md): temporary combatants conjured
  // mid-fight by a summon power. You CONTROL them like party members - each is
  // a { sheet, actor } pair (HP on the sheet, a CompanionActor body), taking
  // its own initiative turn. Not party members and not counted against the
  // party cap; a compact record carries an unexpired assignment between floors.
  // They block enemies (like the party) but are pass-through for the party.
  const summons = [];
  // Grid+mesh edits, paired once (world-edits.js) - combat's facade builds its
  // own from the same factory, so the pairing has one definition either side.
  const worldEdits = createWorldEdits(grid, scene);
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

  // The sheet whose decisions the player is making right now. Out of combat
  // that is the leader; initiative owns it during a fight. HUD, pockets, and
  // any later steering-aware surface ask this one question.
  const steeredSheet = () => (run.inCombat && run.combat?.actingSheet) || sheet;
  // Cross-storey walking (layered levels): queued route legs, and the climb
  // currently riding the stairs if any. Inert on flat levels.
  const legQueue = [];
  // The leader's out-of-combat crouch (TACTICS_PLAN M6 OOC): { x, z, edges,
  // at } in the same shape combat stores, so beginCombat can hand it straight
  // to startCombat's preCrouch and the fight starts with the leader already
  // tucked in. Any deliberate walk or leader change clears it.
  let tacticalBtn = null; // overhead-camera toggle on the HUD rail (built with the HUD)

  // --- gameplay tuning --------------------------------------------------------
  const ENGAGE_RADIUS = 4; // Chebyshev tiles within which enemies join a fight
  const OOC_TURN_SECONDS = 1.6; // out-of-combat seconds that count as one fire/smoke turn

  // Merchants (ECONOMY_PLAN.md). Built before looting because the Alt overlay
  // labels shop props through it. A machine's instance key is its tile.
  const shopping = createShopping({
    getSheet: () => sheet,
    getParty: () => party,
    isInCombat: () => run.inCombat,
    isGameOver: () => run.gameOver,
    // A purchase changes the bag and the purse; a sale changes both too. Both
    // repaint the pockets so the panel behind the shop is never stale.
    onBought: () => loot.refreshPanel(sheet),
    onSold: () => loot.refreshPanel(sheet),
  });
  const shopKey = (x, z) => x + ',' + z;
  // Walk up to a machine and open it. The tile's `shop` field names the SHOPS
  // entry; the tile itself is the instance, so two machines on a floor keep
  // separate stock.
  function openShopAt(x, z) {
    const def = grid.defAt(x, z);
    if (!def.shop) return;
    if (runtime.isBurning(x, z)) { ui.say('It is on fire. The snacks are a write-off.'); return; }
    if (!shopping.open(shopKey(x, z), def.shop)) return;
    loot.hideLabels();
    hover.clear();
  }

  // Looting (containers, bodies, pockets, the Alt overlay) lives in its own
  // module. `approachAndDo` is no longer a hoisted declaration - it comes off
  // walking.js, destructured hundreds of lines below - so the wrapper is what
  // makes this safe now, not hoisting: the lookup happens on the click.
  const loot = createLooting({
    app, grid, runtime, enemies,
    getActor: () => player, // the leader's actor - re-pointed on leader switch
    // In a fight "you" is whoever's turn it is, not the leader: initiative
    // decides who acts, so a snack out of the pockets has to come out of THEIR
    // pockets and heal THEIR sheet.
    getSheet: steeredSheet,
    isInCombat: () => run.inCombat,
    // A consumable is billed against the acting member's pool (looting.js).
    spendCombatAp: (n) => run.combat?.spendAp(n) ?? false,
    isGameOver: () => run.gameOver,
    approachAndDo: (x, z, run) => approachAndDo(x, z, run),
    extraEntries: () => doors.overlayEntries(), // doors share the Alt overlay
    // Equipping changes derived stats AND the basic weapon swing on the bars -
    // refresh the HUD, hotbar, and char sheet.
    onGearChange: () => refreshProgressUi(),
    // The pockets stay usable with a merchant open, and every verb in them
    // splices the bag - so the shop's sell column has to be repainted from the
    // live inventory rather than left holding the indexes it rendered with.
    // ...and an item slot on the hotbar counts what is in the bag, so the bar
    // repaints too - a coffee drunk from slot 3 has to stop offering itself.
    onBagChange: () => { shopping.refreshIfOpen(); refreshHotbarSlots(); },
    // Everyone else still standing can be offered an item. Looting owns the
    // capacity gate and the atomic transfer; the host only identifies the
    // recipient sheet.
    recipients: () => (party?.members || [])
      .filter((m) => m !== partyLeader(party) && m.sheet.hp > 0)
      .map((m) => ({ name: m.sheet.name, sheet: m.sheet })),
    // The purse is party state, so looting reaches it through the host rather
    // than the sheet (ECONOMY_PLAN #2).
    addCash: (n) => { if (party) addCash(party, n); },
    getCash: () => party?.cash || 0,
    openShop: (x, z) => openShopAt(x, z),
    shopSoldOut: (key) => shopping.soldOut(key),
  });

  function abortCombat() {
    if (run.combat) {
      run.combat.abort();
    }
    run.clearCombat();
    despawnSummons();
    syncLeaderBindings();
  }

  // Take one summon off the board. NOT a death - a summon's assignment simply
  // ends (combat.js dismissSummon, or the world clock below), so there is no
  // topple, no body, no loot. Destroying the entity auto-unregisters it from
  // picking (see ARCHITECTURE.md); nulling the node stops the actor's update
  // from animating a body that no longer exists.
  // The temp workforce (summon-layer.js): the roster's operations, not the
  // roster - `summons` is world state like `enemies`, with readers all over
  // this file, so the array stays here and the module takes a getter for it.
  const summonLayer = createSummonLayer({
    get summons() { return summons; },
    get enemies() { return enemies; },
    get player() { return player; },
    get lift() { return lift; },
    app,
    ui,
    picking,
    CLASSES,
    ENEMY_TYPES,
    CompanionActor,
    EnemyActor,
    createSheetFrom,
    placeModel,
    lookOf,
    summonRoom,
    summonSpotProblem,
    dropCount,
    dressUp: (...a) => dressUp(...a),
    summonPointsNear: (...a) => summonPointsNear(...a),
    leadBody: (...a) => leadBody(...a),
    hasLos: (...a) => hasLos(...a),
  });
  const {
    dismissSummon, despawnSummons, ageSummons, summonAt, spawnSummonUnits, restoreSummons,
    roomFor, summonDropProblem, summonDropSpots,
  } = summonLayer;

  const enemyAt = (x, z) => enemies.find((e) => e.alive && e.x === x && e.z === z) || null;
  const npcAt = (x, z) => npcs.find((n) => n.x === x && n.z === z) || null;
  // Does a living party member stand on this tile? Enemy decisions (wander
  // targets, combat routing) treat every member the way they treated the
  // player. Pre-pick (no party yet) the lone spawn tile still counts.
  const partyAt = (x, z) => (party
    ? !!livingMemberAt(party.members, x, z)
    : (x === player.x && z === player.z));
  // NPCs stand on their tile and block movement like any body.
  const isWalkable = (x, z) => grid.terrainOpen(x, z) && !enemyAt(x, z) && !npcAt(x, z);
  // Surface queries, consulting the runtime (fire) before static state.
  // The floor's raw facts at a tile, as step-rules.js wants them. Reading the
  // dynamic layer (fire) here and the rules THERE is what stops the surface
  // rules from being re-derived per caller: everything below is the same
  // question asked of the same fact sheet.
  const floorAt = (x, z) => ({
    burning: runtime.isBurning(x, z),
    electrified: grid.isElectrified(x, z),
    surfaceId: runtime.surfaceAt(x, z),
  });
  const surfEffect = (x, z) => surfaceEffect(floorAt(x, z));
  // Raw surface damage on a cell, before anyone's talents. ENEMY decisions
  // (pathing, wander avoidance) run on this: what hurts a coworker has
  // nothing to do with the player's shoes.
  const rawSurfDamage = (x, z) => rawSurfaceDamage(floorAt(x, z));
  // What a step actually costs a party member, after their talents (Origami
  // Specialist, ESD Steel-Toes). Defaults to the leader - the one whose
  // pathing decisions this shapes.
  const effectiveSurfDamage = (x, z, s = sheet) =>
    effectiveSurfaceDamage(floorAt(x, z), s?.talent?.effects);
  const isHazard = (x, z) => effectiveSurfDamage(x, z) > 0;
  const enemyIsHazard = (x, z) => rawSurfDamage(x, z) > 0;
  const slipChanceAt = (x, z) => slipChance(floorAt(x, z));
  // A gum wad sticks to whoever steps on it - the tile is spent (the wad is
  // on their shoe now). Returns true if there was gum to collect. The rule is
  // step-rules.hasGum; retiring the wad is this file's, because it touches the
  // grid and the scene.
  const stickGum = (x, z) => {
    if (!hasGum(floorAt(x, z))) return false;
    grid.surfaceField.clearAt(x, z);
    return true;
  };
  // Dangerous/uncomfortable surfaces cost extra to path through, so
  // characters route around them unless told otherwise or there is no other
  // way; smoothing must never straighten a route through a damaging cell the
  // route avoided. The player and enemies get separate cost models - talents
  // discount only the player's.
  // Exact surface penalty along a continuous segment. The router calls this
  // for each centre-to-centre edge; the smoother calls the same integral when
  // considering a shortcut or rounded bend.
  const hazardSegmentCostFor = (ms) => (ax, az, bx, bz) =>
    grid.surfaceField.traceSegment(ax, az, bx, bz)
      .reduce((cost, span) => cost + span.distance * surfacePathCost(
        floorAt(span.midpoint.x, span.midpoint.z), ms?.talent?.effects,
      ), 0);
  const hazardCostFor = (ms) => {
    const segmentCost = hazardSegmentCostFor(ms);
    return (x, z, fromX, fromZ) => (Number.isFinite(fromX) && Number.isFinite(fromZ)
      ? segmentCost(fromX, fromZ, x, z)
      : surfacePathCost(floorAt(x, z), ms?.talent?.effects));
  };
  const hazardCost = (...a) => hazardCostFor(sheet)(...a); // the leader's cost model
  // The enemy model is the same rule with NO talents - your shoes are not
  // their problem, and passing the leader's would have them fearing exactly
  // the tiles you are immune to.
  const enemyHazardSegmentCost = hazardSegmentCostFor(null);
  const enemyHazardCost = (x, z, fromX, fromZ) =>
    (Number.isFinite(fromX) && Number.isFinite(fromZ)
      ? enemyHazardSegmentCost(fromX, fromZ, x, z)
      : surfacePathCost(floorAt(x, z)));
  const clearOfHazards = (x, z) => isWalkable(x, z) && !isHazard(x, z);
  const enemyClearOfHazards = (x, z) => isWalkable(x, z) && !enemyIsHazard(x, z);

  // Every summon rests at continuous body-clear points around its descriptor's
  // anchor. Terrain/partitions remain authored on movement tiles; bodies and
  // hazards are sampled where they physically are.
  function summonPointsNear(cx, cz, n, placement = {}) {
    const records = [
      ...(party?.members || []),
      ...summons,
      ...enemies.filter((en) => en.alive),
      ...npcs,
    ];
    const seen = new Set();
    const bodies = [];
    for (const record of records) {
      const actor = record.actor || record;
      if (!actor || seen.has(actor) || record.sheet?.hp <= 0) continue;
      const p = actor.entity?.getPosition?.() || actor.spawnPoint || actor;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
      seen.add(actor);
      bodies.push({ x: p.x, z: p.z });
    }
    return summonLandingPoints(cx, cz, n, {
      isOpen: grid.terrainOpen,
      edgeOpen: grid.stepOpen,
      pointOpen: placement.avoidHazards === false
        ? () => true
        : (x, z) => !enemyIsHazard(x, z),
      bodies,
      maxSearchRadius: placement.searchRadius ?? 4,
    });
  }

  // --- populate the scene -----------------------------------------------------
  const lift = floorHeight / 2;
  // Surfaces a power DROPS during a fight are litter, not terrain: Bulk Mail's
  // paper drifts clear a few rounds later, so a cone can't permanently repaint
  // the floor (nor leave a renewable ammo pile behind it). Tracked here rather
  // than in surfaces-runtime because reverting needs the grid AND the visual,
  // both of which live on this side.
  // One clock per CAST/source, not per movement tile. A single continuous
  // drift can cross several movement tiles and lose individual fine cells to
  // fire; the surviving pieces still expire together.
  const tempSurfaces = new Map(); // sourceKey -> { left, surfaceId, cells, tiles }
  let surfaceSourceSerial = 0;
  const cellsInTile = (x, z) => grid.surfaceField.entries().filter((cell) =>
    Math.floor(cell.ix / grid.surfaceField.cellsPerTile) === x
    && Math.floor(cell.iz / grid.surfaceField.cellsPerTile) === z);
  const tileHasSurface = (x, z, surfaceId) => cellsInTile(x, z)
    .some((cell) => cell.surfaceId === surfaceId);
  const forgetBarePaperTile = (tileKey) => {
    const [x, z] = tileKey.split(',').map(Number);
    if (!tileHasSurface(x, z, 'paper')) loot?.forgetPaper?.(x, z);
  };
  function spendSurfaceFuelAt(x, z) {
    const tileX = Math.round(x);
    const tileZ = Math.round(z);
    const index = grid.surfaceField.pointToCell(x, z);
    const before = index ? grid.surfaceField.cellAt(index.ix, index.iz) : null;
    grid.surfaceField.clearAt(x, z);
    if (before?.sourceKey && index) {
      const source = tempSurfaces.get(before.sourceKey);
      if (source) {
        source.cells.delete(grid.surfaceField.keyOf(index.ix, index.iz));
        if (!source.cells.size) tempSurfaces.delete(before.sourceKey);
      }
    }
    if (!tileHasSurface(tileX, tileZ, 'paper')) loot?.forgetPaper?.(tileX, tileZ);
  }
  function restoreTempSurface(sourceKey) {
    const source = tempSurfaces.get(sourceKey);
    if (!source) return;
    tempSurfaces.delete(sourceKey);
    grid.surfaceField.edit(() => {
      for (const key of source.cells) {
        const [ix, iz] = key.split(',').map(Number);
        if (grid.surfaceField.cellAt(ix, iz)?.sourceKey === sourceKey) {
          grid.surfaceField.clearCell(ix, iz);
        }
      }
    });
    // A fresh world drift on any now-bare tile is gatherable again.
    for (const tileKey of source.tiles) forgetBarePaperTile(tileKey);
  }
  function ageTempSurfaces() {
    for (const [sourceKey, t] of [...tempSurfaces]) {
      // Fire may eat only part of a drift. Retire stale keys, but keep the
      // cast clock alive while any cell with this exact source survives.
      for (const key of [...t.cells]) {
        const [ix, iz] = key.split(',').map(Number);
        if (grid.surfaceField.cellAt(ix, iz)?.sourceKey !== sourceKey) t.cells.delete(key);
      }
      if (!t.cells.size) {
        tempSurfaces.delete(sourceKey);
        for (const tileKey of t.tiles) forgetBarePaperTile(tileKey);
        continue;
      }
      if (t.left > 1) { t.left -= 1; continue; }
      restoreTempSurface(sourceKey);
    }
  }
  // Commit an already-rasterised preview mask. This is deliberately the ONLY
  // surface-placement writer used by zones and cones: geometry is decided
  // once, then preview and commit consume the same fine-cell centres.
  function leaveSurfaceCells(points, surfaceId, turns = 0) {
    const source = turns > 0 ? 'temporary' : 'runtime';
    const sourceKey = `${source}:${++surfaceSourceSerial}`;
    const accepted = [];
    const tiles = new Set();
    grid.surfaceField.edit(() => {
      for (const [x, z] of points) {
        const index = grid.surfaceField.pointToCell(x, z);
        if (!index || grid.surfaceField.cellAt(index.ix, index.iz)) continue;
        const tileX = Math.round(x);
        const tileZ = Math.round(z);
        if (!acceptsSurface(grid.typeAt(tileX, tileZ))) continue;
        if (!grid.surfaceField.setCell(index.ix, index.iz, surfaceId, {
          source, sourceKey, sourceX: x, sourceZ: z,
        })) continue;
        accepted.push(grid.surfaceField.keyOf(index.ix, index.iz));
        tiles.add(`${tileX},${tileZ}`);
      }
    });
    if (!accepted.length) return 0;
    if (turns > 0) tempSurfaces.set(sourceKey, {
      left: turns, surfaceId, cells: new Set(accepted), tiles,
    });
    // Ammo comes from the WORLD, never from a power. A paper-laying verb
    // that could be harvested afterwards is an AP-to-ammo converter, and
    // expiry alone does not prevent it: harvesting is refused in combat
    // but legal the moment a fight ends, and the litter clock runs at
    // OOC_TURN_SECONDS, so a cone laid late in a fight is still on the
    // floor for seconds after it - one click takes the whole patch.
    // Marking the tile picked-clean at birth closes that without touching
    // the surface itself: the sheets still burn, still cut, still fuel a
    // fire. `forgetPaper` drops the mark when the tile reverts to bare
    // floor, so a WORLD drift laid there later is gatherable again.
    if (surfaceId === 'paper') {
      for (const tileKey of tiles) {
        const [x, z] = tileKey.split(',').map(Number);
        loot.markPaperSpent?.(x, z);
      }
    }
    return accepted.length;
  }
  // Compatibility for single-tile/world callers: describe that movement tile
  // as its fine cells, then use the same atomic writer as shaped powers.
  function leaveSurfaceAt(x, z, surfaceId, turns = 0) {
    const points = [];
    const startX = x * grid.surfaceField.cellsPerTile;
    const startZ = z * grid.surfaceField.cellsPerTile;
    for (let iz = startZ; iz < startZ + grid.surfaceField.cellsPerTile; iz++) {
      for (let ix = startX; ix < startX + grid.surfaceField.cellsPerTile; ix++) {
        const centre = grid.surfaceField.cellCenter(ix, iz);
        if (centre) points.push([centre.x, centre.z]);
      }
    }
    return leaveSurfaceCells(points, surfaceId, turns) > 0;
  }
  const portraits = createPortraits(app);
  // The face on the HUD card belongs to whoever the card is SHOWING. It rides
  // the actor (portraits.js), so resolve it from the sheet on every repaint
  // rather than leaving it sticky in ui.js: the sticky copy was only ever
  // written when a portrait FINISHED RENDERING, so a leader switch, a combat
  // turn handoff and a summon taking the floor each left the previous
  // character's face sitting over the new one's name and HP - for the rest of
  // the session, since nothing else ever wrote it again.
  // Whose sheet the card is reflecting right now: the member whose combat turn
  // it is, else the leader.
  const actorForSheet = (s) => (
    party?.members.find((m) => m.sheet === s)?.actor
    || summons.find((x) => x.sheet === s)?.actor
    || (s === sheet ? partyLeader(party)?.actor || player : null)
  );
  const paintHud = (s = sheet) => {
    if (!s) return;
    ui.updateStatsHud(s, actorForSheet(s)?.portraitUrl || null);
  };
  // A portrait finishing is the only reason to repaint for it: refresh the
  // corner readout and the in-fight initiative strip.
  const onPortraitReady = () => {
    paintHud(steeredSheet());
    if (run.inCombat) run.combat?.refresh?.();
  };
  // Put a look ON a body. One order, always: proportions BEFORE the materials
  // are cloned (an actor's attach is what clones them, and it also captures the
  // rig lift proportions just applied), tint AFTER, because tinting a shared
  // material recolours every character built from the same .glb.
  //
  // The only thing that varies is who OWNS the cloned materials - an actor
  // keeps them on itself, a preview body has no actor and keeps them on the
  // entity. That difference used to be the excuse for three copies of this
  // sequence: this function, plus an inline copy in the class preview, plus a
  // second inline copy added for the creation preview. REVIEW flagged the first
  // and TODO M2 promised to fold it in; instead the count went up. It is one
  // function now, and the actor is just an argument.
  const dressBody = (e, look, actor = null) => {
    applyCharacterProportions(e, look?.build);
    if (actor) {
      actor.attach(e);
      actor.applyTint(look?.tint);
    } else {
      // Kept on the entity so a LATER re-tint computes from the pristine
      // colours rather than from the last tint's result - the compounding bug
      // that walks a body toward black (actors.js applyTint says the same).
      e._mats = e._mats || cloneMaterials(e);
      tintMaterials(e._mats, look?.tint);
    }
  };
  const dressUp = (e, actor, look, model = null) => {
    dressBody(e, look, actor);
    // Kick off this character's portrait from the SAME model + look, so the
    // little picture and the body on the floor can never disagree. It lands
    // asynchronously and refreshes whatever is showing when it does.
    if (model) portraits.forActor(actor, model, look, onPortraitReady);
  };
  for (const en of enemies) {
    placeModel(app, `assets/characters/${en.def.model}.glb`, en.x, en.z, {
      lift, rotY: -90, animate: true,
      onReady: (e) => {
        dressUp(e, en, en.def.look, en.def.model);
        picking.register(e, 'enemy', en);
        // A coworker who has never moved looks down their longest corridor,
        // not wherever the .glb happened to face (SNEAK_PLAN D7) - their
        // watch cone is only as sensible as this gaze. Wanderers overwrite
        // it the moment they amble.
        const f = deriveFacing(grid.terrainOpen, en.x, en.z);
        en.yaw = en.targetYaw = Math.atan2(f.x, f.z) * (180 / Math.PI);
        e.setEulerAngles(0, en.yaw, 0);
      },
    });
  }
  for (const npc of npcs) {
    placeModel(app, `assets/characters/${npc.def.model}.glb`, npc.x, npc.z, {
      lift, rotY: 90, animate: true,
      onReady: (e) => {
        dressUp(e, npc, npc.def.look, npc.def.model);
        npc.faceToward(player.x, player.z);
        picking.register(e, 'npc', npc);
      },
    });
  }
  // (Furniture is no longer set dressing here - props are solid tiles in the
  // level data, rendered by buildLevel and respected by pathfinding.)

  // Summon reinforcements: drop up to `n` archetype units (a class id - e.g.
  // 'employee' - or an ENEMY_TYPES id) onto free tiles, wire their models, and
  // hand the records back to whoever asked.
  //   enemy team -> an EnemyActor filed into `enemies` (AI-driven); every
  //     existing enemy system applies for free. Returned as the actor.
  //   player team -> a { sheet, actor } pair filed into `summons`: a real
  //     character sheet (HP, AP, actions) on a CompanionActor body, so it's
  //     CONTROLLED like a party member on its initiative turn. The actor
  //     registers as a 'summon' pick kind (contextual clicks in combat select
  //     it, like a teammate).
  // `at` is a chosen drop point ({x,z}) - the arrivals take that tile and the
  // free tiles ringing outward from it; without one (enemy AI) they file in
  // beside their summoner.
  //
  // This lives out here rather than on the `world` object handed to combat
  // because posting a req is no longer something only a fight can do: the
  // out-of-combat post (postSummonAt) needs the same spawn path, and a second
  // copy of it would be a second set of rules about who gets a body and a
  // sheet.
  // The out-of-combat verbs (ooc-verbs.js). This cluster WRITES shared state,
  // so those four arrive as named setters - a `setArmedOoc(id)` call is
  // greppable in a way that `armedOoc = id` from anywhere in this file is not.
  const oocVerbs = createOocVerbs({
    get sheet() { return sheet; },
    get player() { return player; },
    get party() { return party; },
    get enemies() { return enemies; },
    get summons() { return summons; },
    get inCombat() { return run.inCombat; },
    get gameOver() { return run.gameOver; },
    get armedOoc() { return run.armedOoc; },
    get oocCrouch() { return run.oocCrouch; },
    get pendingAction() { return run.pendingAction; },
    get lastPath() { return run.lastPath; },
    get partyBarKey() { return partyBarKey; },
    setArmedOoc: (v) => { run.armedOoc = v; },
    setOocCrouch: (v) => { run.oocCrouch = v; },
    setPendingAction: (v) => { run.pendingAction = v; },
    setLastPath: (v) => { run.lastPath = v; },
    setPartyBarKey: (v) => { partyBarKey = v; },
    grid,
    scene,
    ui,
    loot,
    ACTIONS,
    ENGAGE_RADIUS,
    PARTITION_TOPPLE,
    worldEdits,
    // Three consts declared BELOW this wiring, so they go in behind getters
    // and wrappers - by-reference would read them in their dead zone.
    get vfx() { return vfx; },
    get hotbarHost() { return hotbarHost; },
    approachTo: (...a) => approachTo(...a),
    beginCombat: (...a) => beginCombat(...a),
    bestApproachPath: (...a) => bestApproachPath(...a),
    canTakePart: (...a) => canTakePart(...a),
    checkCombatTrigger: (...a) => checkCombatTrigger(...a),
    clampPoint: (...a) => clampPoint(...a),
    clearOocCrouch: (...a) => clearOocCrouch(...a),
    endSneak: (...a) => endSneak(...a),
    enemyAt: (...a) => enemyAt(...a),
    enemyBody: (...a) => enemyBody(...a),
    hasLos: (...a) => hasLos(...a),
    hazardCost: (...a) => hazardCost(...a),
    isWalkable: (...a) => isWalkable(...a),
    leadBody: (...a) => leadBody(...a),
    memberBodyAt: (...a) => memberBodyAt(...a),
    modalOpen: (...a) => modalOpen(...a),
    npcAt: (...a) => npcAt(...a),
    oocCoverFaces: (...a) => oocCoverFaces(...a),
    oocTargetOk: (...a) => oocTargetOk(...a),
    paintHud: (...a) => paintHud(...a),
    summonAt: (...a) => summonAt(...a),
    partyAt: (...a) => partyAt(...a),
    playerReaches: (...a) => playerReaches(...a),
    roomFor: (...a) => roomFor(...a),
    smoothFromBody: (...a) => smoothFromBody(...a),
    spawnSummonUnits: (...a) => spawnSummonUnits(...a),
    summonDropProblem: (...a) => summonDropProblem(...a),
    applyStatus: (...a) => applyStatus(...a),
    approachAndDo: (...a) => approachAndDo(...a),
    outOfCombatActionState: (...a) => outOfCombatActionState(...a),
    coneFrom: (...a) => coneFrom(...a),
    dropCount: (...a) => dropCount(...a),
    findPath: (...a) => findPath(...a),
    isToppleable: (...a) => isToppleable(...a),
    rangeOf: (...a) => rangeOf(...a),
    statusList: (...a) => statusList(...a),
    walkToExact: (...a) => walkToExact(...a),
    arrivalLine: (...a) => arrivalLine(...a),
    summonRange: (...a) => summonRange(...a),
  });
  const {
    oocCoverProblem,
    oocTopplePlanAt,
    oocFriendlyOn,
    postSummonAt,
    toggleOocArm,
    engageWithAction,
    oocTakeCoverAt,
    oocShoveAt,
    oocShoveSide,
  } = oocVerbs;

  // Who is the leader, and where everybody else walks (party-control.js).
  // `sheet` and `player` go in as SETTERS: a leader switch is a thing that
  // happens, and it should look like one at the call site.
  const partyControl = createPartyControl({
    get sheet() { return sheet; },
    get player() { return player; },
    get party() { return party; },
    get summons() { return summons; },
    get npcs() { return npcs; },
    get inCombat() { return run.inCombat; },
    get gameOver() { return run.gameOver; },
    get sneak() { return sneakLayer.sneak; },
    get armedOoc() { return run.armedOoc; },
    get pendingAction() { return run.pendingAction; },
    get hotbarHost() { return hotbarHost; },
    get loot() { return loot; },
    get runtime() { return runtime; },
    setSheet: (v) => { sheet = v; },
    setPlayer: (v) => { player = v; },
    setArmedOoc: (v) => { run.armedOoc = v; },
    setPendingAction: (v) => { run.pendingAction = v; },
    grid,
    ui,
    picking,
    SURFACES,
    DIRS8,
    CompanionActor,
    // Four consts declared below this wiring - getters, or they would be read
    // in their dead zone.
    get controls() { return controls; },
    get BASE_SPEED() { return BASE_SPEED; },
    get CATCH_UP() { return CATCH_UP; },
    get FOLLOW_NEAR() { return FOLLOW_NEAR; },
    ITEMS,
    get combat() { return run.combat; },
    refreshHotbarSlots: (...a) => refreshHotbarSlots(...a),
    canRecruit: (...a) => canRecruit(...a),
    // An OBJECT, not a function - and declared below, so a getter either way.
    // The call-through wrapper every function dep gets made `d.charSheet` a
    // function, and `d.charSheet.refresh` undefined on every leader switch.
    get charSheet() { return charSheet; },
    charSheetVm: (...a) => charSheetVm(...a),
    clampPoint: (...a) => clampPoint(...a),
    clearOocCrouch: (...a) => clearOocCrouch(...a),
    effectiveSurfDamage: (...a) => effectiveSurfDamage(...a),
    endSneak: (...a) => endSneak(...a),
    speedUnderStatus,
    hazardCostFor: (...a) => hazardCostFor(...a),
    inAnyCone: (...a) => inAnyCone(...a),
    isWalkable: (...a) => isWalkable(...a),
    modalOpen: (...a) => modalOpen(...a),
    paintHud: (...a) => paintHud(...a),
    addMember: (...a) => addMember(...a),
    createCompanionSheet: (...a) => createCompanionSheet(...a),
    partyLeader: (...a) => partyLeader(...a),
    sayRecruited: (...a) => sayRecruited(...a),
    applyDamage: (...a) => applyDamage(...a),
    findPath: (...a) => findPath(...a),
    routeOpen: (...a) => routeOpen(...a),
    smoothPath: (...a) => smoothPath(...a),
    statusFx: (...a) => statusFx(...a),
    hasStatus: (...a) => hasStatus(...a),
    buildHotbar: (...a) => buildHotbar(...a),
  });
  const {
    memberSpeed,
    downCompanion,
    helpUp,
    recruitCompanion,
    forceLeader,
    switchLeader,
    syncLeaderBindings,
    updateFollowers,
    reviveIndex,
  } = partyControl;

  // --- game flow ----------------------------------------------------------------
  function spawnPlayerModel() {
    // Registered as a `party` interactable like any companion, so a downed
    // ex-leader can be clicked for a hand up. Clicks on a healthy ACTIVE
    // member fall through to the ground (dispatchHit) - your own body is not
    // a target.
    placeModel(app, `assets/characters/${sheet.model}.glb`, player.x, player.z, {
      lift, rotY: 90, animate: true,
      onReady: (e) => { dressUp(e, player, lookOf(sheet), sheet.model); picking.register(e, 'party', player); },
    });
    paintHud(sheet);
  }

  // --- class-carousel 3D preview ------------------------------------------------
  // While the picker is up, the browsed candidate idles on the spawn tile on
  // a slow turntable, camera dollied in. The token guards rapid carousel
  // flips against async .glb loads landing out of order.
  let previewEntity = null;
  let previewToken = 0;
  const previewSpin = (dt) => { if (previewEntity) previewEntity.rotate(0, 35 * dt, 0); };
  // Stand a body on the spawn tile wearing `look`. The picker and the creation
  // flow both want this and used to have one each; they differed only in where
  // the model name and the look came from, which is an argument, not a function.
  // The token guards rapid carousel flips against async .glb loads landing out
  // of order.
  function showPreview(model, look) {
    const token = ++previewToken;
    if (previewEntity) { previewEntity.destroy(); previewEntity = null; }
    placeModel(app, `assets/characters/${model}.glb`, player.x, player.z, {
      lift, rotY: 45, animate: true, // start facing the head-on camera
      onReady: (e) => {
        // The picker must show the character you will actually GET, build
        // included - so it dresses through the same path every other body on
        // the floor uses, with no actor to hang the materials on.
        dressBody(e, look);
        if (token !== previewToken) { e.destroy(); return; }
        previewEntity = e;
      },
    });
  }
  // Browsing the desk. A null id is the BLANK card, which previews the body a
  // custom character starts on rather than any class's - you are not going to
  // be one of these people, so parading one of them would be a lie.
  const previewClass = (classId) => (classId
    ? showPreview(CLASSES[classId].model, CLASSES[classId].look)
    : showPreview(CUSTOM_RIGS[0], null));
  function endClassPreview() {
    previewToken += 1;
    if (previewEntity) { previewEntity.destroy(); previewEntity = null; }
    app.off('update', previewSpin);
    controls.setView({ dist: 26, pitch: 55, focusY: 0.3 }); // tactical camera
  }

  // A playable class named by the URL (`#class=it-support`), or null. Only
  // real, playable ids resolve - a typo shows the picker rather than booting
  // into a broken sheet.
  function preselectedClass() {
    const id = new URLSearchParams(location.hash.startsWith('#')
      ? location.hash.slice(1) : location.hash).get('class');
    return id && CLASSES[id] && CLASSES[id].playable !== false ? id : null;
  }

  // Hiring, once the paperwork is done. `sheetFor` is whatever the flow built -
  // an untouched draft produces byte-for-byte what createSheet(classId) always
  // produced, which is what keeps the express lane and the skip link honest.
  function beginRun(builtSheet) {
    endClassPreview();
    sheet = builtSheet;
    party = createParty(sheet, player);
    spawnPlayerModel();
    loot.refreshPanel(sheet);
    buildHotbar();
    ui.say(`${sheet.className}. Now get out of here.`); // hotkeys live in the HUD strip
  }

  // A card was chosen at the desk; now the short form beside the body. The
  // candidate stays on the spawn tile under the same dollied-in camera - the
  // CARD is what gets replaced, not the body - so this costs no .glb load.
  //
  // `custom` is which door was taken. It changes what the form asks, not what
  // happens afterwards: both end at the same beginRun with a sheet built by the
  // same createCharacter.
  function onDeskPick(classId, { custom = false } = {}) {
    const draft = createDraft(classId, { custom });
    draft.className = CLASSES[classId].name; // the read-back line quotes the job
    if (custom) showPreview(draftModel(draft), draftLook(draft));
    ui.showCreationStep(draft, {
      onCommit: () => beginRun(createCharacter(draft)),
      // BACK and Escape return to the DESK. This used to start the run instead:
      // the handler called a "skip the paperwork" path that committed the
      // character, so backing out of the form was the one gesture that could
      // not be undone.
      onBack: () => openDesk(),
      // Only a custom character can change body, and it is the one thing that
      // costs a .glb load - everything else on this card is text.
      onPreview: () => showPreview(draftModel(draft), draftLook(draft)),
    });
  }

  // The résumé desk: six people you can be, plus a card for making somebody.
  function openDesk() {
    controls.setView({ dist: 3, pitch: 14, focusY: 0.8 });
    app.off('update', previewSpin); // backing out of the card lands here again
    app.on('update', previewSpin);
    ui.showClassPicker(CLASSES, ACTIONS, onDeskPick, () => {
      location.hash = '#editor';
      location.reload();
    }, previewClass);
  }

  // Every way to die funnels through here: freeze the world, drop any active
  // combat, end the campaign run, roll credits.
  function loseGame(message) {
    run.finishRun();
    player.clearPath();
    abortCombat();
    // Only a CAMPAIGN death ends a campaign run. A level launched from the
    // editor is standalone (STASH_KEY, its own party, no floor chain), so
    // dying in a playtest must not delete the saved run sitting in the same
    // browser - that is somebody's progress, wiped by a tool they were using
    // to check a room.
    if (!playtesting && campaignSaveIsOurs) clearProgress();
    ui.showLoseScreen(message);
  }

  // A member at 0 HP goes down - breathing, out of action, back at 1 HP
  // after a victory, a stairwell, or a hand up. The run only ends on a party
  // WIPE: if the fallen member was the one being controlled, a survivor
  // takes over on the spot (in combat, combat.js owns that handoff).
  function downOrLose(member, message) {
    const others = party.members.some((m) => m !== member && isLivingMember(m));
    if (!others) {
      loseGame(message);
      return;
    }
    downCompanion(member);
    if (run.inCombat && run.combat) run.combat.notifyMemberDown();
    else if (member === partyLeader(party)) forceLeader();
  }

  // Emergency handoff (the controlled member dropped out of combat): the
  // first living member takes over, no questions asked.
  // Combat may have handed control to another member; when the dust settles
  // the out-of-combat bindings follow whoever was active.
  // Every enemy death pays out the same way - combat kill, shove into live
  // water, or a printer taking them along. XP fans out to the whole party;
  // promotions announce themselves.
  function awardKill(dead) {
    if (!party) return;
    if (dead.summoned) return; // summoned minions pay no XP (SUMMON_PLAN #6)
    for (const m of gainXpAll(party, dead.combat.xp)) {
      const pts = m.sheet.attrPoints;
      // A promotion should look like one, wherever the promoted are standing.
      if (m.actor?.entity) {
        const p = m.actor.entity.getPosition();
        vfx.impact(p.x, p.z, 'levelup', { y: 0.4 });
      }
      ui.say(`Promotion! ${m.sheet.name} reaches level ${m.sheet.level} - ${pts} point${pts === 1 ? '' : 's'} to spend.`);
    }
    paintHud(sheet);
  }

  // Blowing up a printer: the prop descriptor supplies area and damage policy;
  // this resolver supplies the live bodies and their team-specific lifecycle.
  function handleExplosion(x, z, explosion) {
    const centre = { x, z };
    const area = explosion?.area;
    const playerDamage = explosion?.damage?.player ?? 0;
    scene.explosionFlash(x, z);
    vfx.impact(x, z, 'toner', { y: 0.5, scale: 1.4 });
    vfx.shake(0.16, 0.45); // the one moment in the office that earns a jolt
    grid.setType(x, z, 'floor');
    scene.removePropVisual(x, z);
    const enemyDamage = explosion?.damage?.enemy;
    const hitEnemies = enemies.filter((en) => en.alive && areaIntersectsBody(area, centre, en));
    const slain = [];
    for (const en of hitEnemies) {
      const died = enemyDamage === 'lethal'
        ? (en.die(), true)
        : Number.isFinite(enemyDamage) && en.takeDamage(enemyDamage);
      if (died) slain.push(en);
    }
    let msg = 'The printer detonates in a cloud of toner.';
    if (slain.length) msg += ` ${slain.length} coworker${slain.length === 1 ? '' : 's'} caught in the blast (+XP).`;
    // Shrapnel hits every party member beside the printer, not just the leader.
    // Deaths funnel through downOrLose like every other way to die: a member
    // going down is not the end of the run, even when it's the one you were
    // controlling (a survivor takes over). Only a party WIPE loses. Collect the
    // casualties and resolve them AFTER the loop, so one death can't cut short
    // the shrapnel for everyone else or the XP for the coworkers it killed.
    const downed = [];
    for (const m of party ? party.members : []) {
      if (!m.actor || m.sheet.hp <= 0 || !areaIntersectsBody(area, centre, m)) continue;
      const p = bodyPoint(m);
      const dead = applyDamage(m.sheet, playerDamage);
      m.actor.flinch();
      vfx.impact(p.x, p.z, 'slam');
      vfx.damageText(p.x, p.z, `-${playerDamage}`);
      msg += m === partyLeader(party)
        ? ` You catch shrapnel. -${playerDamage} HP.`
        : ` ${m.sheet.name} catches shrapnel. -${playerDamage} HP.`;
      if (dead) downed.push(m);
    }
    // Summons stand beside a printer like anyone else. They were invisible to
    // both loops above - a player-team summon is filed in `summons`, which is
    // neither `enemies` nor `party.members` - so a blast that flattened the
    // whole party left the conjured coworker next to it untouched. One that
    // runs out of HP is DISMISSED rather than downed: no body, no loot, and
    // nothing for downOrLose to weigh, because a summon is not somebody the
    // run can be lost with (dismissSummon).
    const spent = [];
    for (const s of summons) {
      if (!s.actor || s.sheet.hp <= 0 || !areaIntersectsBody(area, centre, s)) continue;
      const p = bodyPoint(s);
      const gone = applyDamage(s.sheet, playerDamage);
      s.actor.flinch();
      vfx.impact(p.x, p.z, 'slam');
      vfx.damageText(p.x, p.z, `-${playerDamage}`);
      msg += ` ${s.sheet.name} catches shrapnel. -${playerDamage} HP.`;
      if (gone) spent.push(s);
    }
    ui.say(msg);
    for (const s of spent) {
      ui.say(`${s.sheet.name}'s assignment ends in the toner cloud.`);
      dismissSummon(s.actor);
    }
    for (const en of slain) awardKill(en);
    if (sheet) paintHud(sheet);
    for (const m of downed) {
      downOrLose(m, 'PC LOAD LETTER. Fatal.');
      if (run.gameOver) return; // that was the wipe
    }
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
  //
  // The smoothing walkability is the hazard-averse base UNION the cells the
  // route itself steps on (routeOpen): the router only ever SURCHARGES a
  // surface (hazardCost), so a route legally crosses one when the detour is
  // dearer - and refusing to straighten across ground the route chose is what
  // used to un-smooth every walk near a spill into tile-centre stair-steps.
  // Cells the route avoided stay blocked, so a straight line still cannot cut
  // through the fire the Dijkstra paid to go around. `extraClear` narrows the
  // base further for callers with their own blockers (combat's teammate rule)
  // or their own sheet (the walker's talents, not the leader's).
  // The out-of-combat crouch ends the way the in-combat one does: the moment
  // a deliberate walk begins (moveTo / approachAndDo / walkToExact), or when
  // the leader changes hands. `quiet` skips the line for handoffs where the
  // crouch is being consumed rather than abandoned.
  function clearOocCrouch(quiet = false) {
    legQueue.length = 0; // a deliberate walk abandons any queued storey route
    if (!run.oocCrouch) return;
    leaveCrouch({
      body: player,
      carrier: sheet,
      clearState: () => { run.oocCrouch = null; return true; },
      removeStatus,
    });
    if (!quiet) ui.say('You come out of cover.');
  }

  // Walk to EXACTLY (x, z), then run - the crouch and the partition shove
  // need a precise standing spot, where approachAndDo's "within reach" would
  // settle for a diagonal that shields (or shoves) nothing.
  // `end` is an optional FREE POINT inside the goal tile to finish on - the
  // same last-waypoint substitution every plain ground click already does.
  // The arrival check reads the logical tile, and a clamped point always
  // rounds back to its own tile, so `exact` still means exact.
  // Walking the leader (walking.js): routes, smoothing, storeys. The three
  // shared bindings go back through setters - their other halves are the
  // arrival check in onMemberStep and the climb rider in the update loop - and
  // `legQueue` goes by reference, because a queue two sides push and shift is
  // better said as an array than as a pair of setters.
  const walking = createWalking({
    get player() { return player; },
    get sheet() { return sheet; },
    get inCombat() { return run.inCombat; },
    get gameOver() { return run.gameOver; },
    get climbAnim() { return run.climbAnim; },
    get playerLayer() { return run.playerLayer; },
    get grid() { return grid; },
    legQueue,
    floors,
    scene,
    pc,
    ui,
    DIRS8,
    smoothPath,
    routeOpen,
    findPath,
    clampToClearance,
    approachPoint,
    planCrossLayerRoute,
    routeToFiringPosition,
    get controls() { return controls; },
    get lift() { return lift; },
    get sneakLayer() { return sneakLayer; },
    isWalkable: (...a) => isWalkable(...a),
    clearOfHazards: (...a) => clearOfHazards(...a),
    hazardCost: (...a) => hazardCost(...a),
    hazardSegmentCostFor: (...a) => hazardSegmentCostFor(...a),
    enemyAt: (...a) => enemyAt(...a),
    npcAt: (...a) => npcAt(...a),
    hasLos: (...a) => hasLos(...a),
    clearOocCrouch: (...a) => clearOocCrouch(...a),
    endSneak: (...a) => endSneak(...a),
    setPendingAction: (v) => { run.pendingAction = v; },
    setLastPath: (v) => { run.lastPath = v; },
    setClimbAnim: (v) => { run.climbAnim = v; },
  });
  const {
    smoothFromBody, clampPoint, approachTo, walkToExact, approachAndDo, moveTo,
    walkableOn, layeredPick, walkToLayer, routeViaStair, startNextLeg,
    bestApproachPath, bestFiringPath,
  } = walking;

  // Walk to the open tile nearest an enemy; combat starts on arrival via the
  // adjacency check in onMemberStep.
  // Everyone a wedge would catch right now: inside it, and with a clear line.
  // One rule, used by the preview and the click, so a ring can never promise
  // somebody the cone would miss.
  function coneCatches(test) {
    return enemies.filter((en) => {
      if (!en.alive || !en.entity) return false;
      const bp = en.entity.getPosition();
      return test(bp.x, bp.z, 0.5) && hasLos(leadBody(), { x: bp.x, z: bp.z });
    });
  }

  function confront(en) {
    if (!en || !en.alive || run.inCombat || run.gameOver) return;
    run.pendingAction = null;
    const best = bestApproachPath(en.x, en.z);
    if (!best) return;
    if (best.length > 1) {
      const [gx, gz] = best[best.length - 1];
      const bp = en.entity?.getPosition() || en;
      best[best.length - 1] = approachTo(gx, gz, bp.x, bp.z);
      const s = smoothFromBody(best);
      player.setPath(s);
      run.lastPath = s;
    } else {
      checkCombatTrigger();
    }
  }

  // --- doors --------------------------------------------------------------------
  // The rules live in doors.js on the shopping.js host-callback pattern; what
  // stays here is the wiring - what "the world changed" means, and who is
  // currently holding the fight.
  const doors = createDoors({
    grid,
    scene,
    loot,
    isInCombat: () => run.inCombat,
    isGameOver: () => run.gameOver,
    getCombat: () => run.combat,
    getPlayer: () => player,
    isWalkable,
    approachAndDo,
    onWorldChanged: () => {
      for (const e of enemies) e.clearPath(); // their routes may have just changed
      approachEpoch += 1; // ...and so may yours: the armed target rings recheck
    },
  });
  const { combatDoorAt, toggleDoor, approachDoor } = doors;

  // --- targeting, hover highlight, cursor --------------------------------------
  const cheb = (a, b) => chebOf(a.x, a.z, b.x, b.z);
  // Melee reach out of combat, measured the same way combat measures it: real
  // distance between continuous positions against the leader's weapon reach
  // (TACTICS_PLAN revision). These pre-flight an opener before a fight starts,
  // so they must agree with combat's own predicate or a click could open a
  // fight the attacker can't actually swing in.
  // combat-geometry.js owns both; out of combat the "unit" is the leader's
  // body plus the leader's sheet, so reach reads the weapon they are holding.
  const playerReaches = (en, r = null) =>
    canReachAt({ actor: player, sheet }, en, r, grid.stepOpen);
  // A sight line for throws: cells a sightline passes (grid.sightOpenCell -
  // short furniture is shot OVER since TACTICS_PLAN M6a, only tall solids
  // block) that aren't hazed by smoke. Smoke hangs floor-to-ceiling for a
  // couple of turns and breaks line of sight; movement ignores it, so this is
  // separate from terrainOpen.
  const sightClear = (x, z) => grid.sightOpenCell(x, z) && !runtime.isSmoke(x, z);
  // Throws sail over chest-high partitions but not closed doors (grid.sightOpen).
  const hasLos = (a, b) => segmentClear(sightClear, a.x, a.z, b.x, b.z, grid.sightOpen);
  // The same sight line WITHOUT the smoke term. Whether a coworker can take
  // part in a fight is a question about walls and doors - permanent things -
  // not about a cloud that clears in two turns. Used to pick the engaged set,
  // where being briefly hazed must not decide who is in the fight.
  const canTakePart = (a, b) =>
    segmentClear(grid.sightOpenCell, a.x, a.z, b.x, b.z, grid.sightOpen);
  // The leader's continuous body. Targeted ranges and sight measure from HERE
  // (DEGRID D4/D6) - `player.x/z` are the logical tile, up to half a tile
  // from where the model visibly stands.
  const leadBody = () => {
    const p = player?.entity?.getPosition();
    return p ? { x: p.x, z: p.z } : { x: player.x, z: player.z };
  };
  const enemyBody = (en) => {
    const p = en?.entity?.getPosition();
    return p ? { x: p.x, z: p.z } : { x: en.x, z: en.z };
  };
  // The shared rule (stats.js), bound to the leader. A declaration, not a
  // const: the hotbar builder reads it and runs from paths that fire before
  // this point in the closure body.
  function throwAmmoCost(id) { return ammoCostOf(sheet, id); }
  // Can the leader actually get to a swing at `en`? The cheap half is reach;
  // the expensive half - "is there a route at all" - is a fan of Dijkstras and
  // cannot run per enemy per frame, so it is memoized against the only two
  // things that move the answer: the leader's tile, the target's tile, and a
  // door-change epoch.
  const approachCache = new Map(); // enemy -> { key, ok }
  let approachEpoch = 0;
  function canApproach(en) {
    const key = `${Math.round(player.x)},${Math.round(player.z)},${en.x},${en.z},${approachEpoch}`;
    const seen = approachCache.get(en);
    if (seen && seen.key === key) return seen.ok;
    const ok = !!bestApproachPath(en.x, en.z);
    approachCache.set(en, { key, ok });
    return ok;
  }
  // The same question for a weapon with reach: can the leader WALK somewhere the
  // shot is on? Cached on the same terms, with `range` in the key because two
  // weapons ask different questions about the same pair of tiles.
  const firingCache = new Map(); // enemy -> { key, ok }
  function canWalkIntoRange(en, range) {
    const key = `${Math.round(player.x)},${Math.round(player.z)},${en.x},${en.z},${range},${approachEpoch}`;
    const seen = firingCache.get(en);
    if (seen && seen.key === key) return seen.ok;
    const ok = !!bestFiringPath(en.x, en.z, range);
    firingCache.set(en, { key, ok });
    return ok;
  }
  // Out of combat there's no AP budget, but the affordances still have to
  // describe the click they precede - THE PREVIEW IS THE RULE (ARCHITECTURE.md
  // on previewAction). These are the same three tests engageWithAction runs
  // before it opens a fight: a throw needs range, line and ammo; a SHOVE needs
  // to already be in shove reach (it does not walk you in, and it refuses);
  // a melee swing needs reach or a route to it.
  //
  // This used to answer `true` for everything but a throw, so a Shove armed
  // across the room rang every coworker green under a crosshair, and the click
  // printed a refusal - the affordance promising the one thing the resolver
  // would not do.
  const oocTargetOk = (id, en) => {
    const a = ACTIONS[id];
    const range = rangeOf(id);
    if (range) {
      // Range, a line, and ammo only where the shot bills for it. A ranged
      // WEAPON also passes if it can walk into range, the way a melee swing
      // passes on a route it hasn't taken yet - combat's opener walks it in.
      // A range is a circle between the BODIES (DEGRID D4/D6).
      const lb = leadBody();
      const eb = enemyBody(en);
      const shot = Math.hypot(lb.x - eb.x, lb.z - eb.z) <= range && hasLos(lb, eb);
      if (a.ammoCost) return shot && (sheet?.paper || 0) >= throwAmmoCost(id);
      // A weapon walks in to a FIRING position, not to their elbow - asking
      // canApproach here refused shots that were plainly on. This still refuses
      // a target nobody can close with (main.js's opener guard depends on that),
      // it just asks the question the weapon actually poses.
      return shot || canWalkIntoRange(en, range);
    }
    if (a.type === 'shove') {
      // Arm's reach - or the office standing in for your arms: the same
      // partition-between / furniture-onto-them aims the click accepts
      // (engageWithAction), so the ring keeps the resolver's promise.
      return playerReaches(en, REACH.SHOVE)
        || (Math.abs(en.x - player.x) + Math.abs(en.z - player.z) === 1
          && !!grid.wallEdgeBetween(player.x, player.z, en.x, en.z))
        || DIRS8.some(([dx, dz]) => {
          const plan = oocTopplePlanAt(player.x + dx, player.z + dz);
          return plan && plan.lx === en.x && plan.lz === en.z;
        });
    }
    return playerReaches(en) || canApproach(en);
  };

  // --- Examine ------------------------------------------------------------
  // One source of truth for "what is this?", so every menu that offers Examine
  // - out of combat, in combat - says the same thing about the same object.
  // Flavor lives in the registries (data/tiles.js `examine`, an enemy or NPC
  // def's `examine`); this only decides which one applies.
  // What the thing under the cursor is called (examine.js).
  const { examineTile, doorExamine, examineAt } = createExamine({
    get grid() { return grid; },
    get runtime() { return runtime; },
    SURFACES,
    FIRE,
    ELECTRIFIED,
  });

  const canvasEl = document.getElementById('app');
  // Which party member owns this actor, if any.
  const memberOf = (actor) => party?.members.find((m) => m.actor === actor) || null;

  // Land a friendly verb on a colleague OUT of combat. There is no AP out here -
  // the same reason a pocket item is free between fights - so this spends the
  // action's `uses` if it rations itself and nothing otherwise. Only the purge
  // payload is honoured: a heal is already refused out here by
  // combatOnlyReason ("heal from your pockets"), and keeping this to one
  // payload means it cannot quietly become a second, cheaper buff path.
  // --- left-click verb dispatch (Divinity-style: the target picks the verb) ---
  function attackOrConfront(en) {
    const a = run.armedOoc && ACTIONS[run.armedOoc];
    // "Does this armed verb point at a BODY" - asked of the one owner
    // (combat-targeting.verbSides), not re-derived. This was a hand-written
    // `attack || shove || purge` ladder, which is the same list `ringsAtBodies`
    // carried and the same way it went stale: `pull` was missing from both, so
    // an armed Pull Over clicked on a coworker out here fell straight past this
    // arm into the ordinary walk-up.
    if (a && verbSides(a, rangeOf(run.armedOoc)).enemies) {
      engageWithAction(en, run.armedOoc);
      return;
    }
    // A sneaking click on a coworker in reach IS the ambush strike (SNEAK
    // M4): the ordinary unarmed path starts fights by walking INTO people
    // (the adjacency trigger), and a sneaker deliberately never triggers on
    // proximity (D1) - so the click that would have bumped them swings
    // instead, and the fight opens on the ambusher's terms.
    if (sneakLayer.sneak && playerReaches(en)) {
      engageWithAction(en, equippedAction(sheet));
      return;
    }
    confront(en);
  }
  // Act on the interactable ENTITY under the cursor. Returns true if handled.
  function dispatchHit(hit) {
    const { kind, ref } = hit;
    if (kind === 'door') { approachDoor(ref); return true; }
    if (kind === 'npc') { approachAndDo(ref.x, ref.z, () => dialogue.open(ref)); return true; }
    if (kind === 'party') {
      const m = memberOf(ref);
      if (!m) return false;
      // An ARMED friendly verb owns the click, ahead of every body verb below.
      // Without this the click fell straight through to "switch to them", so a
      // power aimed at a colleague out of combat did nothing but hand them the
      // reins - there was no way to clear a teammate's bleed outside a fight at
      // all. Combat has had this gate all along (armedIsFriendly); exploration
      // simply never grew one.
      if (run.armedOoc && aimsAtAlly(ACTIONS[run.armedOoc]) && m.sheet.hp > 0) {
        oocFriendlyOn(run.armedOoc, m);
        return true;
      }
      if (m.sheet.hp <= 0) { approachAndDo(ref.x, ref.z, () => helpUp(m)); return true; }
      if (m === partyLeader(party)) return false; // your own body: a ground click
      // Talk only to somebody who HAS something to say - a recruited companion
      // carries a tree on their def (and it is how you reach a merchant
      // coworker's stock). Your original character is a PlayerActor with no
      // def at all, so an unguarded dialogue.open threw mid-walk and took the
      // rest of the frame's update with it. Everyone else falls through to the
      // documented body-click verb: switch to them. Same priority the
      // right-click menu already uses.
      if (ref.def?.dialogue || ref.def?.recruitedDialogue) {
        approachAndDo(ref.x, ref.z, () => dialogue.open(ref));
        return true;
      }
      const i = party.members.indexOf(m);
      if (i >= 0) { switchLeader(i); return true; }
      return false;
    }
    if (kind === 'enemy') {
      if (ref.alive) { attackOrConfront(ref); return true; }
      if (ref.loot?.length) approachAndDo(ref.x, ref.z, () => loot.lootBody(ref)); // corpse
      return true;
    }
    if (kind === 'prop') {
      // A merchant prop sells; everything else rummages. A prop could one day
      // carry both, and `shop` winning is the right default - the machine's
      // coin return is a lesser prize than its contents.
      const def = grid.defAt(ref.x, ref.z);
      if (def.shop) { approachAndDo(ref.x, ref.z, () => openShopAt(ref.x, ref.z)); return true; }
      approachAndDo(ref.x, ref.z, () => loot.lootContainer(ref.x, ref.z));
      return true;
    }
    return false;
  }

  // --- dialogue (minimal talking layer) ---------------------------------------
  // Recruitable companions use the same trees, plus option `effect`s: an
  // option carrying { recruit: true } signs the speaker onto the party when
  // picked. The tree is CAPTURED at open (pre-recruit conversations finish in
  // the tree they started in - the recruit option's own `next` node lives
  // there); the next open reads `recruitedDialogue` instead.
  const dialoguePanel = ui.createDialoguePanel();
  const dialogue = createDialogue({
    panel: dialoguePanel,
    getParty: () => party,
    getPlayer: () => player,
    partyCap: PARTY_CAP,
    isRecruitable: (npc) => npc instanceof CompanionActor,
    isInCombat: () => run.inCombat,
    isGameOver: () => run.gameOver,
    onRecruit: (npc) => recruitCompanion(npc),
    onShop: (npc) => shopping.open(shopKeyForNpc(npc), npc.def.shop),
    onOpen: () => { loot.hideLabels(); hover.clear(); },
  });
  const canRecruit = (npc) => dialogue.canRecruit(npc);

  // Anything that owns the screen and the clicks while it is up. The dialogue
  // panel and the shop panel are both modal in exactly the same way, and every
  // gate below cares about "is a panel talking to me", not which one - so they
  // ask this rather than naming one and quietly forgetting the other.
  const modalOpen = () => dialogue.visible || shopping.visible;

  // Sign a bystander onto the party: out of the `npcs` roster (they stop
  // blocking as an NPC - partyAt covers them now), sheet minted at the
  // leader's level, picking re-tagged so hover/clicks read them as one of
  // ours. The entity, model and position stay exactly where they were.
  // --- persistent hotbar --------------------------------------------------------
  // Everything the character can DO, in one bar, in and out of a fight.
  //
  // It used to be the OFFENSIVE slice only - attacks, shove, throws - on the
  // theory that with no fight on, the only thing worth aiming at is a coworker.
  // That quietly hid whole classes from themselves: HR's Post the Role never
  // appeared until a fight was already running, so the power you picked the
  // class for was invisible for half the game and looked like it didn't exist.
  // The bar now lists the full kit and says which slots a fight owns, which is
  // also what keeps the number-key slots stable - the row you learn out of
  // combat is the row you get.
  //
  // The ORDER is stats.orderedActionIds - the same one combat's bar renders, so
  // the kit reads the same in and out of a fight: the basic swing, shove, the
  // throws, the class powers, what a talent granted, what is in hand. A
  // throwable the character can't fold (needsTalent) is not theirs to list.
  // Whose bar this is. In a fight, the ACTING member's - initiative decides who
  // acts, so the slots must show their kit, their pockets and their paper. Out
  // of one it is the leader's, exactly as before. Without this the layout came
  // from the leader while combat priced it against whoever was acting, which is
  // the same two-sources-of-truth drift the bars themselves had.
  // The bar's DOM host (hotbar-host.js). It owns `hotbar`, `hotbarRow`,
  // `hotbarBagKey` and `hotbarPaper` - four variables written by one function
  // and read from a scope shared with 87 others until now. The mutable
  // bindings go in as getters: the bar is rebuilt across leader switches and
  // turn handoffs and must always read the live one.
  const hotbarHost = createHotbarHost({
    get sheet() { return sheet; },
    get combat() { return run.combat; },
    get inCombat() { return run.inCombat; },
    get gameOver() { return run.gameOver; },
    get armedOoc() { return run.armedOoc; },
    ui,
    loot,
    modalOpen,
    steeredSheet: (...a) => steeredSheet(...a),
    toggleOocArm: (id) => toggleOocArm(id),
  });
  const { buildHotbar, refreshHotbarSlots } = hotbarHost;

  // --- leader switching --------------------------------------------------------
  // A portrait click hands control to another member. Everything leader-keyed
  // re-keys through the `sheet`/`player` bindings: camera follow, click-to-
  // move, the hotbar (rebuilt - different sheets bring different actions), the
  // HUD, pathing costs, menu verbs, and the follower set. The outgoing leader
  // stops walking and their pending walk-up dies with the handoff.
  // In combat the portraits switch the ACTIVE combatant; out of it, the
  // leader. Same bar, same click, right verb for the moment.
  const partyBar = ui.createPartyBar({
    // Out of combat a portrait click switches the leader; in one it steers the
    // open SHARED turn (INITIATIVE_PLAN) - combat refuses anyone not holding
    // the floor, so clicking a member who waits on their own slot does nothing,
    // exactly as before spans existed.
    onSelect: (i) => { if (!run.inCombat) switchLeader(i); else run.combat?.steerMember(party.members[i]); },
    // Double-click points the CAMERA at the member, switch or no switch. The
    // first click of the pair already ran onSelect, so out of combat the
    // camera lands on them as the new leader (recenter -> follow); a member
    // the click could NOT take over (downed, waiting on their initiative
    // slot) still gets looked at - that is the point of the second verb.
    onFocus: (i) => focusCameraOn(party.members[i]?.actor),
    onLevelUp: (i) => openLevelUpFor(party.members[i]),
  });
  let partyBarKey = ''; // last rendered roster state (refresh gate)

  const progression = createProgressionUi({
    get sheet() { return sheet; },
    get party() { return party; },
    get inCombat() { return run.inCombat; },
    get gameOver() { return run.gameOver; },
    ui,
    ACTIONS,
    ITEMS,
    EQUIP_SLOTS,
    classTrack,
    trackNode,
    damageBonus,
    deflect,
    pending,
    spendablePoints,
    spendAttrPoint,
    spendClassPoint,
    paintHud: (...a) => paintHud(...a),
    buildHotbar: (...a) => buildHotbar(...a),
    setPartyBarKey: (v) => { partyBarKey = v; },
  });
  const {
    levelUpPip, charSheet, charSheetVm, refreshProgressUi, openLevelUps,
    openLevelUpFor,
  } = progression;
  function cycleLeader() {
    if (!party || party.members.length < 2) return;
    for (let step = 1; step < party.members.length; step++) {
      const i = (party.active + step) % party.members.length;
      const m = party.members[i];
      if (isLivingMember(m)) { switchLeader(i); return; }
    }
  }
  // --- posting the role with no fight on ----------------------------------------
  // A summon power is not a combat power, it is a power. Post the Role used to
  // be unreachable until a fight was already running - the hotbar listed
  // attacks only, and the placement flow lived entirely inside combat.js - so
  // the HR class's whole identity switched off the moment the last coworker
  // fell.
  //
  // Out here the rule is combat's, minus the two things a FIGHT owns: there is
  // no AP pool to spend and no per-fight `uses` to ration. The live `cap` and
  // the contract clock are the whole limit - `lifetimeTurns` is spent by the
  // world clock out of combat (ageSummons), so a temp posted between fights
  // sees itself out on its own, and one posted just before a fight walks into
  // it (startCombat's `allies`) with whatever assignment is left.
  // First (enemy, member) adjacency in the party - any member can get
  // cornered, and the fight engages around whoever it was.
  // How a fight starts (combat-entry.js): noticing one, opening one, and the
  // trigger the walk loop polls. `inCombat`/`combat` go in as setters because
  // opening a fight is a thing that HAPPENS, and the rest of this file reads
  // them constantly.
  const { adjacentEnemyToParty, beginCombat, checkCombatTrigger } = createCombatEntry({
    get sheet() { return sheet; },
    get player() { return player; },
    get party() { return party; },
    get combat() { return run.combat; },
    get inCombat() { return run.inCombat; },
    get gameOver() { return run.gameOver; },
    get enemies() { return enemies; },
    get summons() { return summons; },
    get oocCrouch() { return run.oocCrouch; },
    get armedOoc() { return run.armedOoc; },
    get pendingAction() { return run.pendingAction; },
    get grid() { return grid; },
    get runtime() { return runtime; },
    get hover() { return hover; },
    get controls() { return controls; },
    get hotbarHost() { return hotbarHost; },
    get sneakLayer() { return sneakLayer; },
    get vfx() { return vfx; },
    app,
    pc,
    ui,
    scene,
    doors,
    loot,
    dialogue,
    shopping,
    combatRng,
    ENGAGE_RADIUS,
    STEALTH,
    startCombat,
    createCombatWorld,
    partyLeader,
    seesBody,
    coneBoundary,
    segmentClear,
    smoothPath,
    routeOpen,
    findPath,
    applyStatus,
    removeStatus,
    hasStatus,
    canTakePart: (...a) => canTakePart(...a),
    sneakSightOpts: (...a) => sneakSightOpts(...a),
    watcherOf: (...a) => watcherOf(...a),
    endSneak: (...a) => endSneak(...a),
    isWalkable: (...a) => isWalkable(...a),
    partyAt: (...a) => partyAt(...a),
    summonAt: (...a) => summonAt(...a),
    clampPoint: (...a) => clampPoint(...a),
    approachTo: (...a) => approachTo(...a),
    floorAt: (...a) => floorAt(...a),
    slipChanceAt: (...a) => slipChanceAt(...a),
    stickGum: (...a) => stickGum(...a),
    sightClear: (...a) => sightClear(...a),
    smoothFromBody: (...a) => smoothFromBody(...a),
    summonPointsNear: (...a) => summonPointsNear(...a),
    hazardCostFor: (...a) => hazardCostFor(...a),
    hazardSegmentCostFor: (...a) => hazardSegmentCostFor(...a),
    enemyHazardCost: (...a) => enemyHazardCost(...a),
    enemyHazardSegmentCost: (...a) => enemyHazardSegmentCost(...a),
    enemyClearOfHazards: (...a) => enemyClearOfHazards(...a),
    rawSurfDamage: (...a) => rawSurfDamage(...a),
    effectiveSurfDamage: (...a) => effectiveSurfDamage(...a),
    leaveSurfaceAt: (...a) => leaveSurfaceAt(...a),
    leaveSurfaceCells: (...a) => leaveSurfaceCells(...a),
    onTemporaryAllyStep: (...a) => onTemporaryAllyStep(...a),
    onTemporaryAllyTravel: (...a) => onTemporaryAllyTravel(...a),
    spawnSummonUnits: (...a) => spawnSummonUnits(...a),
    dismissSummon: (...a) => dismissSummon(...a),
    focusCameraOn: (...a) => focusCameraOn(...a),
    awardKill: (...a) => awardKill(...a),
    loseGame: (...a) => loseGame(...a),
    despawnSummons: (...a) => despawnSummons(...a),
    ageTempSurfaces: (...a) => ageTempSurfaces(...a),
    syncLeaderBindings: (...a) => syncLeaderBindings(...a),
    openLevelUps: (...a) => openLevelUps(...a),
    buildHotbar: (...a) => buildHotbar(...a),
    paintHud: (...a) => paintHud(...a),
    refreshHotbarSlots: (...a) => refreshHotbarSlots(...a),
    modalOpen: (...a) => modalOpen(...a),
    toggleSneak: (...a) => toggleSneak(...a),
    sneakingMembers: (...a) => sneakingMembers(...a),
    sneakSweep: (...a) => sneakSweep(...a),
    drawSneakCones: (...a) => drawSneakCones(...a),
    anyWatcherSees: (...a) => anyWatcherSees(...a),
    bodyOfMember: (...a) => bodyOfMember(...a),
    inAnyCone: (...a) => inAnyCone(...a),
    setInCombat: (v) => { run.inCombat = v; },
    setCombat: (v) => { run.combat = v; },
    setPendingAction: (v) => { run.pendingAction = v; },
    setArmedOoc: (v) => { run.armedOoc = v; },
    setOocCrouch: (v) => { run.oocCrouch = v; },
  });

  const sneakLayer = createSneakLayer({
    get sheet() { return sheet; },
    get party() { return party; },
    get enemies() { return enemies; },
    get oocCrouch() { return run.oocCrouch; },
    get inCombat() { return run.inCombat; },
    get gameOver() { return run.gameOver; },
    get grid() { return grid; },
    get runtime() { return runtime; },
    app,
    pc,
    ui,
    STEALTH,
    ENGAGE_RADIUS,
    partyLeader: (...a) => partyLeader(...a),
    applyStatus: (...a) => applyStatus(...a),
    removeStatus: (...a) => removeStatus(...a),
    seesBody: (...a) => seesBody(...a),
    coneBoundary: (...a) => coneBoundary(...a),
    modalOpen: (...a) => modalOpen(...a),
    canTakePart: (...a) => canTakePart(...a),
    beginCombat: (...a) => beginCombat(...a),
  });
  const {
    sneakingMembers, sneakSightOpts, watcherOf, bodyOfMember, anyWatcherSees,
    endSneak, toggleSneak, inAnyCone, sneakSweep, drawSneakCones,
  } = sneakLayer;

  // Hotbar trigger: an armed attack, aimed at a coworker, opens combat with
  // that move. The clicked target joins even if it's beyond the engage radius
  // (a thrown opener can reach further than the auto-engage does).
  // A cone fired at an EMPTY wedge, with no fight on. It fires anyway
  // (designer, 2026-07-31: no target needed, in or out of combat) - combat's
  // fireCone already resolves this exact case as a swing with no casualties
  // and a carpeted wedge, so this is that outcome minus the two things a
  // fight owns (AP, per-fight uses), the same subtraction the out-of-combat
  // summon post makes. `test` is the wedge from coneFrom, aimed at (tx, tz).
  const bodyPoint = (record) => {
    const body = record.actor || record;
    const p = body.entity?.getPosition?.();
    return p ? { x: p.x, z: p.z } : { x: body.x, z: body.z };
  };
  const oocConeCells = (a, test) => fineConeCells(grid.surfaceField, test, a.cone.range, {
    canInclude: (x, z) => acceptsSurface(grid.typeAt(Math.round(x), Math.round(z)))
      && !runtime.surfaceAt(x, z),
    hasLos: (ox, oz, x, z) => hasLos({ x: ox, z: oz }, { x, z }),
    origin: test.origin,
    excludeBodies: [...(party?.members || []), ...summons]
      .filter((m) => m.sheet.hp > 0)
      .map(bodyPoint),
  });
  function fireOocCone(a, test, tx, tz) {
    player.lunge(tx, tz); // the fan of envelopes, aimed where you pointed
    if (a.leaves === 'paper') vfx.paperFan(test.origin, test.angle, a.cone);
    if (a.leaves) leaveSurfaceCells(oocConeCells(a, test), a.leaves, a.leavesTurns || 0);
    ui.say(`${a.log} No casualties. Plenty of litter.`); // combat's own zero-hit line
    // One click, one volley: the slot disarms, same as a posted summon.
    run.armedOoc = null;
    hotbarHost.hotbar?.setArmed(null);
  }

  // --- the office topples out of combat too (TACTICS_PLAN M6 OOC) -------------
  // The same furniture-topple rule combat runs, evaluated from the leader's
  // spot: sign-derived landing, open ground, no free demolition into a wall.
  // An armed SHOVE aimed at the office with no fight on (designer,
  // 2026-07-30): furniture and partitions topple out here too. With a
  // coworker standing where it lands, the topple IS the opener - the fight
  // starts and combat resolves the fall with its own save and pin. Returns
  // true when the click was a shove at the office (refusals included).
  // An armed TAKE COVER with no fight on: crouch before anyone has noticed
  // you. The crouch rides into the fight that starts (beginCombat hands it to
  // startCombat as preCrouch), which is the whole point of taking it early.
  //
  // The same rule combat runs, and for the same reason it changed there: you
  // aim at the SPOT YOU WILL STAND, and whatever shields that spot's faces
  // covers you along them - partitions, props, and PEOPLE. Out here used to
  // refuse a person outright ("people move - the character shield is a combat
  // commitment"), which read as arbitrary from the player's side: the verb was
  // on the bar, the coworker was right there, and the refusal named a rule
  // nothing else in the game observed. People move, and when they do the
  // crouch breaks - which is exactly what happens in a fight, and what
  // `crouchStateOf` has always done. That is the rule, not a reason to have
  // two verbs (designer, 2026-07-31: "it wont let me take cover on a person
  // out of combat but i can in combat").
  // A member's or summon's record standing on a cell, for naming who is
  // covering you. `partyAt`/`summonAt` answer "is anyone there"; this answers
  // "who", which the narration needs and they do not carry.
  const memberBodyAt = (x, z) => livingMemberAt(
    [...(party?.members || []), ...summons], x, z,
  );
  // Which faces of a tile would shield a crouch there. One helper, read by the
  // aim preview, the click and the held-crouch affordance, so none of the
  // three can describe a different crouch from the others.
  const oocCoverFaces = (x, z) => crouchFacesAt(x, z, {
    edgeOpen: grid.stepOpen,
    tileDefAt: grid.defAt,
    bodyAt: (cx, cz) => (
      cx === player.x && cz === player.z
        ? null
        : enemyAt(cx, cz) || npcAt(cx, cz) || memberBodyAt(cx, cz)
    ),
  });
  // Why this spot is not a crouch, or null when it is one.
  // What is covering a spot, in words - the out-of-combat twin of combat's
  // `coverNames`, so "You tuck in behind..." names the same things on both
  // sides of a fight starting.
  // Tile effects (data-driven from TILE_TYPES[..].onEnter) fire per step, for
  // ANY party member walking - each member's own sheet takes the damage, the
  // gum, the ammo. Hazards hit on any step; the exit only fires when it's the
  // LEADER's deliberate destination, so pathing past it (or a follower
  // trailing over it) doesn't end the level by accident. Walk-up interactions
  // are the leader's too - they're what the player clicked.
  // The sheet the HUD card is showing RIGHT NOW: in combat that's whoever has
  // initiative (combat repaints it from its own refresh), out of combat it's
  // the leader. A stepping member repaints the card only when it's their own -
  // otherwise a member taking surface damage on their combat turn redrew the
  // pre-combat LEADER's card, so the damage appeared to hit nobody.
  const syncHudFor = (s) => { if (s && s === steeredSheet()) paintHud(s); };

  // Player-side bodies share one step pipeline: tile effects, opportunity
  // attacks, step-clock statuses, surfaces, slips, and footprints. The caller
  // supplies only lifecycle policy: can it exit, and what does 0 HP mean?
  //
  // What the floor does to a body (floor-effects.js): the per-step surface
  // effects, the slip roll, and the out-of-combat turn clock. The mutable
  // bindings go in as getters - a floor effect resolves against whoever is
  // standing on it right now, not whoever was when the game booted.
  const floorFx = createFloorEffects({
    get sheet() { return sheet; },
    get party() { return party; },
    get combat() { return run.combat; },
    get inCombat() { return run.inCombat; },
    get gameOver() { return run.gameOver; },
    get oocCrouch() { return run.oocCrouch; },
    get enemies() { return enemies; },
    get summons() { return summons; },
    grid,
    get runtime() { return runtime; },
    SURFACES,
    PAPER_CAP,
    // `vfx` is a `const` declared BELOW this call, so passing it by reference
    // would read it in its temporal dead zone - a build that is perfectly
    // happy and a first step that throws. Wrapped, the lookup happens when a
    // body actually stands on something.
    vfx: {
      impact: (...a) => vfx.impact(...a),
      damageText: (...a) => vfx.damageText(...a),
      status: (...a) => vfx.status(...a),
      splat: (...a) => vfx.splat(...a),
      footstep: (...a) => vfx.footstep(...a),
    },
    applyDamage,
    applyStatus,
    hasStatus,
    impactKindFor,
    statusFx,
    equippedStats,
    slips,
    tickStep,
    tickTurn,
    surfEffect,
    effectiveSurfDamage,
    slipChanceAt,
    stickGum,
    syncHudFor,
    awardKill,
    downOrLose,
    dismissSummon,
    clearOocCrouch,
    oocCoverProblem,
  });
  const {
    advanceStatusTurn, applySurfaceOn, maybeSlip, tickStepOn, tickTurnClockOn,
    isBleeding, leaveFootprint,
  } = floorFx;

  const stepPlayerSide = createPlayerSideStepper({
    tileEffectAt: (x, z) => grid.defAt(x, z).onEnter,
    notifyStep: (body, x, z) => {
      if (run.inCombat && run.combat) run.combat.notifyStep(body, x, z);
    },
    get gameOver() { return run.gameOver; },
    applyDamage,
    statusFx,
    tickStepOn,
    applySurfaceOn,
    maybeSlip,
    leaveFootprint,
    syncHudFor,
    // `vfx` is declared below this point. These wrappers defer its lookup until
    // a step actually needs it, avoiding the temporal-dead-zone trap.
    vfx: {
      impact: (...a) => vfx.impact(...a),
      damageText: (...a) => vfx.damageText(...a),
    },
  });

  const travelPlayerSide = createPlayerSideTraveler({
    advanceTravelExposure,
    travelExposureStateFor,
    resetTravelExposure,
    traceSegment: grid.surfaceField.traceSegment,
    floorAt,
    exposureInterval: (body) => exposureDistanceFromComposure(
      effectiveAttr(body.sheet).composure,
    ),
    get gameOver() { return run.gameOver; },
    statusFx,
    tickStepOn,
    applySurfaceOn,
    maybeSlip,
    leaveFootprint,
  });
  const travelEnemy = createEnemyTraveler({
    advanceTravelExposure,
    travelExposureStateFor,
    resetTravelExposure,
    traceSegment: grid.surfaceField.traceSegment,
    floorAt,
    exposureInterval: (unit) => exposureDistanceFromComposure(unit.combat.composure),
    statusFx,
    tickStep,
    syncSpeed: (unit) => {
      if (unit.baseSpeed === undefined) unit.baseSpeed = unit.speed;
      unit.speed = speedUnderStatus(unit.baseSpeed, statusFx(unit));
    },
    surfaceEffect,
    applyStatus,
    surfDamage: rawSurfDamage,
    hasStatus,
    stickGum,
    slips,
    slipChanceAt,
    roll: Math.random,
    onStatus: (unit, id, point) => vfx.status(point.x, point.z, id),
    onDamage: (unit, amount, point, info) => {
      const kind = info.kind === 'surface'
        ? impactKindFor({
          burning: !!info.floor?.burning,
          electrified: !!info.floor?.electrified,
          surface: info.floor?.surfaceId,
        }, SURFACES)
        : 'blood';
      vfx.impact(point.x, point.z, kind, { y: 0.35 });
      vfx.damageText(point.x, point.z, `-${amount}`, '#ffd76b', { big: info.died });
      if (info.died) awardKill(unit);
    },
    onGum: (_unit, point) => vfx.status(point.x, point.z, 'gum'),
    onSlip: (_unit, point) => {
      vfx.impact(point.x, point.z, 'slip', { y: 0.12 });
      vfx.damageText(point.x, point.z, 'slip!', '#8ad4df');
    },
    onFootprint: (unit, point) => {
      const surface = runtime.surfaceAt(point.x, point.z);
      vfx.footstep(unit, point.x, point.z, {
        bleeding: unit.hp <= unit.maxHp * 0.45,
        surface,
        onPaper: surface === 'paper',
      });
    },
  });

  function onMemberStep(member, x, z, pathDone, changed = true) {
    const isLeader = member === partyLeader(party);
    if (!stepPlayerSide(member, x, z, {
      pathDone,
      changed,
      canExit: !run.inCombat && isLeader,
      onExit: () => {
        const { sheet: ms, actor } = member;
        run.finishRun();
        actor.clearPath();
        // Mid-campaign exits lead to the next floor (the party - wounds, XP,
        // coffee habits - carries over via saved progress). The last floor,
        // and any playtest level, ends the run.
        if (!playtesting && level.next && LEVELS[level.next]) {
          // NO stairwell breather. This used to heal the party +6 and revive
          // anyone downed, which is what made "carried to the landing" true.
          // Struck 2026-08-02 with the rest of the automatic healing: you take
          // a floor's damage to the next floor, and you take its casualties
          // there too. A downed member arrives downed and needs a kit.
          // Guarded like every other write (god.js:66): localStorage throws in
          // private mode and when the quota is gone, and this one runs in the
          // middle of a floor transition - an unguarded throw here would take
          // out the stairwell heal and the floor-clear screen with it, turning
          // "your save did not persist" into "the game stopped".
          try {
            const saved = serializeProgress(party, level.next, Date.now(), summons);
            localStorage.setItem(PROGRESS_KEY, JSON.stringify(saved));
            campaignSaveIsOurs = true; // the save is this run's from here on
            // Fire-and-forget: the local write above is the save; the cloud
            // copy is the carrier that survives a rebuilt browser.
            remote.push(saved);
          } catch { /* no save is bad; losing the run to an exception is worse */ }
          ui.showFloorClear({ nextName: LEVELS[level.next].name }, () => location.reload());
        } else {
          // Same rule as loseGame: finishing a PLAYTEST level is not finishing
          // a campaign run, so it must not clear the campaign save either.
          if (!playtesting && campaignSaveIsOurs) clearProgress();
          ui.showWinScreen({ level: ms.level, defeated: enemies.filter((e) => !e.alive).length });
        }
      },
      onDown: (message) => downOrLose(member, message),
      say: ui.say,
    })) return;

    // Walk-up interactions (lighting trash cans) fire on deliberate arrival.
    // An `exact` action (a crouch spot, a partition shove side) fires only on
    // its precise tile - "within reach" would settle for a diagonal that
    // shields or shoves nothing.
    if (isLeader && run.pendingAction && pathDone
      && (run.pendingAction.exact
        ? x === run.pendingAction.x && z === run.pendingAction.z
        : Math.abs(x - run.pendingAction.x) <= 1 && Math.abs(z - run.pendingAction.z) <= 1)) {
      const act = run.pendingAction;
      run.pendingAction = null;
      act.run();
    }
    checkCombatTrigger();
  }

  function onMemberTravel(member, segment) {
    return travelPlayerSide(member, segment, {
      onDown: (message) => downOrLose(member, message),
      say: ui.say,
    });
  }

  function onTemporaryAllyStep(s, x, z, done, changed) {
    stepPlayerSide(s, x, z, {
      pathDone: done,
      changed,
      onDown: () => { if (run.inCombat && run.combat) run.combat.notifyMemberDown(); },
      say: ui.say,
      speaker: s.sheet.name,
    });
  }

  function onTemporaryAllyTravel(s, segment) {
    return travelPlayerSide(s, segment, {
      onDown: () => { if (run.inCombat && run.combat) run.combat.notifyMemberDown(); },
      say: ui.say,
      speaker: s.sheet.name,
    });
  }

  function onEnemyTravel(unit, segment) {
    return travelEnemy(unit, segment);
  }

  // --- input --------------------------------------------------------------------
  // Impaired sight (vision.js), built before the controls because it is what
  // bends their aim: while the character you are steering is blinded, the point
  // the world is asked about drifts away from the mouse, three cursors sway
  // over the floor, and ink swims across the view. Fed per frame from the
  // steered sheet's merged statuses, down in the update loop.
  const vision = createVisionLayer({ canvas: canvasEl });
  const controls = createControls({
    app,
    canvas: document.getElementById('app'),
    focus: grid.playerSpawn,
    aim: (sx, sy) => vision.aim(sx, sy),
    ...createMouse({
      get sheet() { return sheet; },
      get player() { return player; },
      get party() { return party; },
    get combat() { return run.combat; },
    get inCombat() { return run.inCombat; },
    get gameOver() { return run.gameOver; },
    get climbAnim() { return run.climbAnim; },
    get armedOoc() { return run.armedOoc; },
    get playerLayer() { return run.playerLayer; },
    get pendingGodPick() { return run.pendingGodPick; },
      get grid() { return grid; },
      get hover() { return hover; },
      get controls() { return controls; },
      get tacticalBtn() { return tacticalBtn; },
      get loot() { return loot; },
      get dialogue() { return dialogue; },
      floors,
      picking,
      SURFACES,
      get runtime() { return runtime; },
      get enemies() { return enemies; },
      get summons() { return summons; },
      partyLeader,
      memberOf: (...a) => memberOf(...a),
      helpUp: (...a) => helpUp(...a),
      reviveIndex: (...a) => reviveIndex(...a),
      ITEMS,
      confront: (...a) => confront(...a),
      isWalkable: (...a) => isWalkable(...a),
      openShopAt: (...a) => openShopAt(...a),
      switchLeader: (...a) => switchLeader(...a),
      canIgnite: (...a) => canIgnite(...a),
      igniteAt: (...a) => igniteAt(...a),
      igniteVerb: (...a) => igniteVerb(...a),
      ui,
      ACTIONS,
      COMBAT_DOOR_AP,
      atDoor,
      coneFrom,
      cheb: (...a) => cheb(...a),
      enemyAt: (...a) => enemyAt(...a),
      npcAt: (...a) => npcAt(...a),
      leadBody: (...a) => leadBody(...a),
      modalOpen: (...a) => modalOpen(...a),
      moveTo: (...a) => moveTo(...a),
      walkToLayer: (...a) => walkToLayer(...a),
      layeredPick: (...a) => layeredPick(...a),
      routeViaStair: (...a) => routeViaStair(...a),
      approachAndDo: (...a) => approachAndDo(...a),
      approachDoor: (...a) => approachDoor(...a),
      combatDoorAt: (...a) => combatDoorAt(...a),
      toggleDoor: (...a) => toggleDoor(...a),
      dispatchHit: (...a) => dispatchHit(...a),
      attackOrConfront: (...a) => attackOrConfront(...a),
      engageWithAction: (...a) => engageWithAction(...a),
      fireOocCone: (...a) => fireOocCone(...a),
      coneCatches: (...a) => coneCatches(...a),
      oocShoveAt: (...a) => oocShoveAt(...a),
      oocTakeCoverAt: (...a) => oocTakeCoverAt(...a),
      postSummonAt: (...a) => postSummonAt(...a),
      examineAt: (...a) => examineAt(...a),
      examineTile: (...a) => examineTile(...a),
      doorExamine: (...a) => doorExamine(...a),
      setOocAim: (v) => { run.oocAim = v; },
      setPendingGodPick: (v) => { run.pendingGodPick = v; },
    }),
  });

  // Everything the cursor SAYS - the body glow, the cursor shape, the focus
  // banner and the ground rings - lives in hover.js. It is built here because
  // it projects through the camera rig, and it asks for the world through live
  // queries rather than captured values: the leader, their sheet and the armed
  // action are all re-pointed by a leader switch.
  //
  // The one rule worth restating at the seam: `armedTargetOk` hands it the
  // CLICK RESOLVER's own test. The rings and the crosshair answer the question
  // the click will answer, rather than a second copy of it that can drift.
  const oocAimPaint = createAimPaint(app);
  const hover = createHoverLayer({
    app,
    canvas: canvasEl,
    picking,
    controls,
    ui,
    vision, // it still owns what the cursor SAYS; vision hides the OS one
    aimPaint: oocAimPaint,
    queries: {
      party: () => party,
      enemies: () => enemies,
      summons: () => summons,
      npcs: () => npcs,
      leader: () => (party ? partyLeader(party) : null),
      memberOf,
      playerEntity: () => player?.entity || null,
      reach: () => reachOf(sheet),
      armed: () => run.armedOoc,
      armedTargetOk: oocTargetOk,
      armedHitOk: (id, hit) => {
        if (!hit || !ACTIONS[id]) return null;
        const sides = verbSides(ACTIONS[id], rangeOf(id));
        if (hit.kind === 'enemy') {
          return sides.enemies && hit.ref.alive ? oocTargetOk(id, hit.ref) : null;
        }
        if (hit.kind === 'party') {
          const m = memberOf(hit.ref);
          return sides.allies && m ? m.sheet.hp > 0 : null;
        }
        return null;
      },
      // Where an armed SUMMON would land right now: the hovered tile, the spots
      // its arrivals would fill, and why they couldn't. Null unless a summon is
      // armed with the cursor on the floor - the rings key off this one answer,
      // which is the same one the click runs (summonDropProblem).
      // The wedge an armed cone would cover right now, or null. Same geometry
      // combat uses, from the same pure function - only the origin differs.
      coneAim: () => {
        if (!run.armedOoc || run.inCombat || !run.oocAim || !sheet) return null;
        const a = ACTIONS[run.armedOoc];
        if (!a.cone) return null;
        const test = coneFrom(a, leadBody(), run.oocAim.x, run.oocAim.z);
        if (!test) return null;
        const caught = coneCatches(test);
        // The wedge is ALWAYS usable - an empty one fires too (fireOocCone),
        // exactly as combat's own preview draws it - so the color must not
        // read as a refusal. `caught` still rings whoever it would open on.
        return {
          key: `${run.armedOoc}:${test.origin.x},${test.origin.z}:${run.oocAim.x},${run.oocAim.z}`,
          line: conePolyline(a, test),
          cells: oocConeCells(a, test),
          quantum: grid.surfaceField.quantum,
          caught: caught.map((e) => [e.x, e.z]),
          usable: true,
        };
      },
      summonDrop: () => {
        if (!run.armedOoc || run.inCombat || !run.oocAim) return null;
        const a = ACTIONS[run.armedOoc];
        if (a.type !== 'summon') return null;
        const x = run.oocAim.x;
        const z = run.oocAim.z;
        return { x, z, problem: summonDropProblem(a, x, z), spots: summonDropSpots(a, x, z) };
      },
      // What the hovered SHOVE aim would topple and where it lands, or null
      // when the cursor isn't on anything toppleable - the same rules
      // oocShoveAt runs on the click (designer: the out-of-combat aim showed
      // nothing at all). The landing is computed from where the player
      // stands NOW; the click's walk-up recomputes at arrival, so a long
      // approach can land the fall differently - the ring is the aim's
      // honest current answer, not a promise about the future.
      shoveAim: () => {
        if (!run.armedOoc || run.inCombat || !run.oocAim || !sheet) return null;
        if (ACTIONS[run.armedOoc].type !== 'shove') return null;
        const x = Math.round(run.oocAim.x);
        const z = Math.round(run.oocAim.z);
        if (isToppleable(grid.defAt(x, z))) {
          const plan = oocTopplePlanAt(x, z);
          return { x, z, usable: !!plan, landing: plan ? [plan.lx, plan.lz] : null };
        }
        // A partition-far tile: the aim IS the landing. It asks the CLICK's own
        // question (`oocShoveSide`) rather than "is there a wall edge nearby" -
        // the weaker test lit the ring for a partition whose far side is solid
        // wall, where the click then refused by silently doing nothing.
        if (grid.terrainOpen(x, z) && oocShoveSide(x, z)) {
          return { x, z, usable: true, landing: [x, z] };
        }
        return null;
      },
      // The hovered TAKE COVER shield, or null over plain floor - only the
      // hovered object rings (the rings-everywhere-is-noise rule).
      // The aim is the SPOT YOU WOULD STAND, and the faces are what would
      // cover you there - the same pair combat draws, off the same rule
      // (oocCoverProblem / oocCoverFaces), so the two sides of a fight
      // starting cannot promise different crouches.
      coverAim: () => {
        if (!run.armedOoc || run.inCombat || !run.oocAim || !sheet) return null;
        if (ACTIONS[run.armedOoc].type !== 'cover') return null;
        const x = Math.round(run.oocAim.x);
        const z = Math.round(run.oocAim.z);
        const usable = !oocCoverProblem(x, z);
        // px/pz is the CLAMPED stand point - the continuous marker, and
        // exactly the spot the commit will walk to. The raw cursor point can
        // sit inside a wall's clearance band; a marker there would promise a
        // spot the body cannot occupy.
        const [px, pz] = clampPoint(run.oocAim.x, run.oocAim.z);
        return { x, z, px, pz, usable, faces: usable ? oocCoverFaces(x, z) : [] };
      },
      // What is covering the leader RIGHT NOW, whatever is armed - the
      // held-crouch affordance, so a crouch taken before a fight shows its
      // shape out here too rather than only once the dice come out.
      heldCover: () => {
        if (run.inCombat || !run.oocCrouch || !sheet) return null;
        return { x: run.oocCrouch.at.x, z: run.oocCrouch.at.z, faces: oocCoverFaces(run.oocCrouch.at.x, run.oocCrouch.at.z) };
      },
      inCombat: () => run.inCombat && !!run.combat,
      doorOpen: (key) => grid.doors.get(key)?.open,
      tileDef: (x, z) => grid.defAt(x, z),
      shopSoldOut: (x, z) => shopping.soldOut(shopKey(x, z)),
      corpseAt: (x, z) => loot.corpseAt(x, z),
      looseAt: (x, z) => loot.looseAt(x, z),
      itemName: (id) => loot.itemName(id),
    },
  });

  // The overhead tactical camera toggle - third in the bottom-left cluster,
  // after the profile card and the bag. Built here rather than with the rest of
  // the HUD because it reads the camera rig, which only exists from this point
  // on. `isOn` asks the rig rather than tracking a flag of its own, so the lit
  // state stays honest when an orbit drag tilts back out of the view.
  tacticalBtn = ui.createTacticalButton({
    onToggle: () => controls.toggleTactical(),
    isOn: () => controls.tactical,
  });

  // Keyboard pan may not fly the view off the carpet into the void - fence it
  // to the floor plus a little slack. Once per boot: a floor change reloads
  // the page, so the grid the fence was measured against can't go stale.
  controls.setPanBounds({ minX: -2, maxX: grid.width + 1, minZ: -2, maxZ: grid.height + 1 });

  // Point the camera at a body. The one the rig FOLLOWS gets recenter() -
  // follow resumes, so the view stays with them as they walk. Anyone else
  // gets a glide to where they stand right now: follow can't attach to a
  // body the rig doesn't track, and pretending otherwise would drift the
  // view back to the followed character a frame later.
  // Who the player is DRIVING right now: the acting combatant in a fight, the
  // leader out of one. `player` answers a DIFFERENT question - "who leads the
  // party" - and while a fight is on those two stop being the same body:
  // `makeActive` hands you a teammate to steer without touching `player`, and
  // `switchLeader` returns early in combat by design.
  //
  // Letting the camera read `player` meant steering a companion through a
  // shared turn drove a body the rig was not tracking, and `Home` - the key
  // whose comment promises "whoever you're driving" - resolved to the panTo
  // branch below, DETACHING the rig and freezing it where that member stood.
  // Nothing re-attached until control changed hands. One function is where
  // that question gets answered now, and the follow loop, the wall fade, the
  // recenter key, the profile card and the initiative rows all read it.
  //
  // Follow the acting character (designer, 2026-07-31: "agreed") - which is
  // also what BG3 and DOS2 do with the character whose turn it is.
  const steeredActor = () => (run.inCombat && run.combat ? run.combat.actingActor || player : player);

  function focusCameraOn(actor) {
    if (!actor) return;
    // Re-ATTACH when the target is the body the rig already follows; glide to
    // a detached point when it is anyone else (another member's card, an
    // enemy's initiative row), where snapping follow onto them would be a lie.
    if (actor === steeredActor()) { controls.recenter(); return; }
    const p = actor.entity?.getPosition();
    if (p) controls.panTo({ x: p.x, z: p.z });
    else controls.panTo({ x: actor.x, z: actor.z });
  }
  // The bottom-left profile card doubles as a recenter button (double-click),
  // the way the reference games' portraits do. It names the ACTING combatant
  // in a fight (paintHud follows initiative), so the camera goes to whoever
  // the card is showing, not blindly to the leader. #hud is pointer-events:
  // none so the banner stays click-through; the card opts back in - it sits
  // over the world's corner, and every other HUD surface already swallows
  // its clicks rather than letting them fall through to the floor.
  const statsCard = document.getElementById('stats');
  if (statsCard) {
    statsCard.style.pointerEvents = 'auto';
    statsCard.onmousedown = (e) => e.stopPropagation(); // clicks stay off the canvas
    statsCard.ondblclick = () => {
      if (!sheet || run.gameOver) return;
      focusCameraOn(steeredActor());
    };
  }

  // What the keys do (keyboard.js). `panHeld` comes back live - the update loop
  // drives the camera rig from it every frame.
  const { panHeld } = createKeyboard({
    get sheet() { return sheet; },
    get gameOver() { return run.gameOver; },
    get inCombat() { return run.inCombat; },
    get combat() { return run.combat; },
    get tacticalBtn() { return tacticalBtn; },
    get controls() { return controls; },
    get hotbarHost() { return hotbarHost; },
    get charSheet() { return charSheet; },
    hover,
    loot,
    modalOpen: (...a) => modalOpen(...a),
    cycleLeader: (...a) => cycleLeader(...a),
    toggleSneak: (...a) => toggleSneak(...a),
    charSheetVm: (...a) => charSheetVm(...a),
    focusCameraOn: (...a) => focusCameraOn(...a),
    steeredActor: (...a) => steeredActor(...a),
  });

  // Cosmetic feedback: projectiles, floating numbers, particle bursts, ground
  // decals and the camera's flinch. Defined after controls exist because the
  // damage text projects through the camera and the shake drives the rig.
  // Everything here is fire-and-forget - combat and the step handlers hand it
  // world coordinates and never wait on it (see fx.js).
  const auras = createAuraLayer(app);
  const vfx = {
    projectile: (from, to, kind) => throwProjectile(app, from, to, kind),
    paperFan: (from, angle, cone) => throwPaperFan(app, from, angle, cone),
    damageText: (x, z, text, color, opts) =>
      spawnDamageText(app, controls.cameraEntity, x, 0.2, z, text, color, opts),
    // A burst at chest height on a body, or at ground level for a floor event.
    impact: (x, z, kind, opts) => impactFx(app, x, opts?.y ?? CHEST_Y, z, kind, opts),
    status: (x, z, id) => statusBurst(app, x, z, id),
    splat: (x, z, opts) => bloodSplat(app, x, z, opts),
    footstep: (actor, x, z, info) => footstep(app, actor, x, z, info),
    shake: (amp, dur) => controls.shake(amp, dur),
  };

  // Everyone on the map who could be wearing a status aura, in one list the
  // tracker re-reads (see the update loop). Bodies only: a downed member and a
  // dismissed summon have nothing to wreathe.
  const auraScratch = [];
  function collectStatusCarriers() {
    auraScratch.length = 0;
    if (party) {
      for (const m of party.members) {
        if (m.actor?.entity && m.sheet.hp > 0) {
          auraScratch.push({ entity: m.actor.entity, statuses: statusList(m.sheet) });
        }
      }
    }
    for (const s of summons) {
      if (s.actor?.entity && s.sheet.hp > 0) {
        auraScratch.push({ entity: s.actor.entity, statuses: statusList(s.sheet) });
      }
    }
    for (const en of enemies) {
      if (en.alive && en.entity) auraScratch.push({ entity: en.entity, statuses: statusList(en) });
    }
    return auraScratch;
  }

  // --- main loop ------------------------------------------------------------------
  const BASE_SPEED = 4;
  const FOLLOW_NEAR = 2; // tiles from the leader - close enough, stand easy
  const CATCH_UP = 1.3; // a lagging follower hustles
  // Sticky surfaces (coffee) slow whoever stands in them - queried from the
  // RUNTIME layer, so a surface that burns away stops slowing anyone. Gum on
  // a shoe slows its owner everywhere. Followers who fall behind walk faster
  // than decorum allows.
  // Followers trail the leader BG-style: when one drifts beyond FOLLOW_NEAR it
  // paths to a free tile beside the leader (distinct per follower), costed by
  // its OWN talents, pass-through for the rest of the party, and never parking
  // on a tile that would hurt it. A small repath cadence keeps Dijkstra off
  // the hot path; per-tile effects land through onMemberStep like any walk.
  // What happens every frame (frame.js). The four bindings a frame writes go
  // back through setters - each is read elsewhere in this file, and a frame is
  // not their owner.
  app.on('update', createFrame({
    get sheet() { return sheet; },
    get player() { return player; },
    get party() { return party; },
    get combat() { return run.combat; },
    get inCombat() { return run.inCombat; },
    get gameOver() { return run.gameOver; },
    get enemies() { return enemies; },
    get summons() { return summons; },
    get npcs() { return npcs; },
    get armedOoc() { return run.armedOoc; },
    get climbAnim() { return run.climbAnim; },
    get playerLayer() { return run.playerLayer; },
    get partyBarKey() { return partyBarKey; },
    get oocTurnClock() { return run.oocTurnClock; },
    get grid() { return grid; },
    get runtime() { return runtime; },
    get hover() { return hover; },
    get controls() { return controls; },
    get vision() { return vision; },
    get auras() { return auras; },
    get hotbarHost() { return hotbarHost; },
    get levelUpPip() { return levelUpPip; },
    get partyBar() { return partyBar; },
    get sneakLayer() { return sneakLayer; },
    get loot() { return loot; },
    get lift() { return lift; },
    floors,
    legQueue,
    panHeld,
    scene,
    ui,
    ACTIONS,
    OOC_TURN_SECONDS,
    pending,
    statusFx,
    findPath,
    smoothPath,
    routeOpen,
    animateSurfaces,
    updateWallFade,
    worldToScreenCss,
    memberSpeed: (...a) => memberSpeed(...a),
    updateFollowers: (...a) => updateFollowers(...a),
    onMemberStep: (...a) => onMemberStep(...a),
    onMemberTravel: (...a) => onMemberTravel(...a),
    onTemporaryAllyStep: (...a) => onTemporaryAllyStep(...a),
    onTemporaryAllyTravel: (...a) => onTemporaryAllyTravel(...a),
    onEnemyTravel: (...a) => onEnemyTravel(...a),
    startNextLeg: (...a) => startNextLeg(...a),
    checkCombatTrigger: (...a) => checkCombatTrigger(...a),
    advanceStatusTurn: (...a) => advanceStatusTurn(...a),
    ageSummons: (...a) => ageSummons(...a),
    ageTempSurfaces: (...a) => ageTempSurfaces(...a),
    collectStatusCarriers: (...a) => collectStatusCarriers(...a),
    steeredActor: (...a) => steeredActor(...a),
    modalOpen: (...a) => modalOpen(...a),
    isWalkable: (...a) => isWalkable(...a),
    isHazard: (...a) => isHazard(...a),
    enemyIsHazard: (...a) => enemyIsHazard(...a),
    enemyClearOfHazards: (...a) => enemyClearOfHazards(...a),
    enemyHazardSegmentCost: (...a) => enemyHazardSegmentCost(...a),
    partyAt: (...a) => partyAt(...a),
    summonAt: (...a) => summonAt(...a),
    floorAt: (...a) => floorAt(...a),
    rawSurfDamage: (...a) => rawSurfDamage(...a),
    slipChanceAt: (...a) => slipChanceAt(...a),
    stickGum: (...a) => stickGum(...a),
    clampPoint: (...a) => clampPoint(...a),
    setPlayerLayer: (v) => { run.playerLayer = v; },
    setClimbAnim: (v) => { run.climbAnim = v; },
    setPartyBarKey: (v) => { partyBarKey = v; },
    setOocTurnClock: (v) => { run.oocTurnClock = v; },
  }));

  // --- boot -------------------------------------------------------------------------
  ui.addVignette();
  ui.say(grid.name);
  // The escape hatches live here (not only on the class picker) because a
  // mid-campaign reload skips the picker entirely.
  ui.showGameMenu([
    {
      // This IS the "new character" escape hatch, at the only moment it can
      // safely be offered.
      // A separate menu item was drafted and then dropped: clearing progress
      // drops the character with it - the sheet lives in the save - so the two
      // would have been byte-identical actions under different labels, which is
      // worse than one honest one. A meaningful "same character, floor one"
      // needs run state to separate from character state first.
      id: 'menu-restart',
      // While playtesting, "the run" is a scratch level someone is editing -
      // not a campaign. This was the THIRD ungated clearProgress (its two
      // siblings at loseGame and the exit handler were fixed; this one was
      // missed), and it took the campaign save, its cloud row, AND the level in
      // the editor with it. Both halves are gated now, and the label says which
      // thing it is about to throw away.
      label: playtesting ? 'Restart this level' : 'Restart run',
      action: () => {
        if (!playtesting) {
          clearProgress();
          localStorage.removeItem(STASH_KEY);
        }
        // A playtest keeps its stash - restarting the level means replaying it,
        // not losing the thing you are editing.
        location.hash = ''; // drop any #class= express lane, or it skips the desk
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
    party.cash = restoredProgress.cash || 0; // the purse rides the stairwell too
    // The member on point may be a COMPANION - you can take the stairs with one
    // leading. Handing them the bare PlayerActor dropped their registry `def`,
    // and with it their dialogue and their examine line; the loss was permanent
    // rather than cosmetic, because switchLeader reuses whatever actor a member
    // already carries, so they never got a proper body again for the rest of
    // the run. Embody the active member as what they actually are, and let
    // `player` point at that - which is all `player` has ever meant.
    const onPoint = partyLeader(party);
    const onPointDef = COMPANIONS[onPoint.sheet.companionId];
    if (onPointDef) {
      const body = new CompanionActor(player.x, player.z, onPoint.sheet.companionId, onPointDef);
      body.recruited = true; // they are already in the party; they walked here
      onPoint.actor = body;
      player = body;
    } else {
      onPoint.actor = player;
    }
    sheet = onPoint.sheet;
    spawnPlayerModel();
    for (const m of party.members) {
      if (m.actor) continue; // the leader, already placed
      const def = COMPANIONS[m.sheet.companionId]
        // A non-active class character (saved mid-switch) rides the same
        // follower plumbing with a minimal def - model from their own sheet.
        || { name: m.sheet.name, model: m.sheet.model, examine: 'One of yours. Holding up, mostly.' };
      // Beside the leader, on a tile nobody has taken yet. isWalkable alone
      // ignores the party, and DIRS8 is a fixed order, so two restored
      // companions both picked the SAME first open neighbour and spawned
      // stacked - only separating once the leader walked far enough to make
      // the followers repath.
      let spot = grid.playerSpawn;
      for (const [dx, dz] of DIRS8) {
        const x = grid.playerSpawn.x + dx;
        const z = grid.playerSpawn.z + dz;
        if (isWalkable(x, z) && !partyAt(x, z)) { spot = { x, z }; break; }
      }
      const comp = new CompanionActor(spot.x, spot.z, m.sheet.companionId || m.sheet.classId, def);
      comp.recruited = true;
      m.actor = comp;
      placeModel(app, `assets/characters/${m.sheet.model}.glb`, spot.x, spot.z, {
        lift, rotY: 90, animate: true,
        onReady: (e) => { dressUp(e, comp, lookOf(m.sheet), m.sheet.model); picking.register(e, 'party', comp); },
      });
    }
    restoreSummons(restoredProgress.temporaryAllies, party, grid.playerSpawn);
    loot.refreshPanel(sheet);
    buildHotbar();
    ui.say(`${grid.name}. Keep going.`);
  } else if (preselectedClass()) {
    // `#class=<id>` hires straight off the URL, skipping the carousel - the
    // same kind of boot-time affordance as `#editor` and `#god`. The e2e suite
    // lives on this: browsing the carousel renders each candidate's .glb as it
    // slides, which under CI's software GL costs ~30s PER SLIDE, so a test
    // that wanted the fifth class paid minutes before it began. An unknown or
    // unplayable id falls through to the normal picker.
    //
    // It skips CREATION too, not just the carousel - straight to beginRun with
    // an untouched draft. That is byte-for-byte the character this hash always
    // produced, so the whole existing suite keeps booting exactly as it did,
    // and the one place that wants to exercise creation asks for it by name.
    if (playtesting) {
      try { localStorage.setItem('escape-work.playtest.class', preselectedClass()); } catch { /* ignore */ }
    }
    beginRun(createCharacter(createDraft(preselectedClass())));
  } else {
    // The desk. openDesk frames the spawn tile close and head-on (eye-ish
    // level, aimed at the chest) and parades the browsed candidate there; it is
    // its own function because BACK out of the creation card returns here, and
    // a screen you can only reach once is a screen you cannot back out of.
    openDesk();
  }
  // The badge belongs to a STASHED level specifically. `playtesting` also covers
  // the ?level= express lane and a desk pick, neither of which has an editor to
  // go back to - which is why picking Floor 2 used to raise a playtest badge.
  if (playtesting && fromStash) {
    ui.showPlaytestBadge(() => {
      location.hash = '#editor';
      location.reload();
    }, () => {
      // Drop ONLY the stash. The campaign save is not this button's business -
      // that distinction is the whole reason this exists.
      localStorage.removeItem(STASH_KEY);
      location.hash = '';
      location.reload();
    });
  }

  // Read-only test/console adapter. The bag is live; game-debug.js owns the
  // stable public projections and keeps mutable registries behind snapshots.
  window.__game = createGameDebug({
    classes: CLASSES,
    controls,
    get player() { return player; },
    get playerLayer() { return run.playerLayer; },
    get floors() { return floors; },
    legQueue,
    get climbAnim() { return run.climbAnim; },
    sneakLayer,
    anyWatcherSees: (...a) => anyWatcherSees(...a),
    steeredActor: (...a) => steeredActor(...a),
    worldToScreenCss,
    get inCombat() { return run.inCombat; },
    get gameOver() { return run.gameOver; },
    get activeLevelId() { return activeLevelId; },
    get lastPath() { return run.lastPath; },
    walls,
    get sheet() { return sheet; },
    statusLeft,
    runtime,
    hasLos: (...a) => hasLos(...a),
    get party() { return party; },
    shopping,
    shopKey,
    loot,
    document,
    grid,
    get oocCrouch() { return run.oocCrouch; },
    enemies,
    playerReaches: (...a) => playerReaches(...a),
    bestApproachPath: (...a) => bestApproachPath(...a),
    npcs,
    summons,
    get armedOoc() { return run.armedOoc; },
    hover,
    ui,
    examineTile: (...a) => examineTile(...a),
    canvasEl,
    vision,
    dialogue,
  });

  // Mutable god-mode adapter. Live objects are deliberate here; god-debug.js
  // owns every mutation that needs more than a reflected primitive write.
  window.__god = createGodDebug({
    get sheet() { return sheet; },
    get player() { return player; },
    get party() { return party; },
    get inCombat() { return run.inCombat; },
    get gameOver() { return run.gameOver; },
    get combat() { return window.__combat || null; },
    app,
    runtime,
    actions: ACTIONS,
    classes: CLASSES,
    enemyTypes: ENEMY_TYPES,
    loot,
    shopping,
    grid,
    doors,
    scene,
    enemies,
    npcs,
    CompanionActor,
    EnemyActor,
    picking,
    lift,
    get pendingGodPick() { return run.pendingGodPick; },
    setPendingGodPick: (callback) => { run.pendingGodPick = callback; },
    switchLeader: (...a) => switchLeader(...a),
    // God mode displays the diagnostic combat projection, but steering is a
    // controller command. Keep those two surfaces distinct.
    steerMember: (member) => run.combat?.steerMember(member) ?? false,
    helpUp: (...a) => helpUp(...a),
    canRecruit: (...a) => canRecruit(...a),
    recruitCompanion: (...a) => recruitCompanion(...a),
    spendClassPoint: (...a) => spendClassPoint(...a),
    grantTalent: (...a) => grantTalent(...a),
    canTakePart: (...a) => canTakePart(...a),
    engagedAround: (...a) => engagedAround(...a),
    engageRadius: ENGAGE_RADIUS,
    beginCombat: (...a) => beginCombat(...a),
    scaleEnemy: (...a) => scaleEnemy(...a),
    placeModel: (...a) => placeModel(...a),
    dressUp: (...a) => dressUp(...a),
    paintHud: (...a) => paintHud(...a),
    shopKey: (...a) => shopKey(...a),
  });
  installGodMode(window.__god);
}
