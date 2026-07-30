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
import { findPath, smoothPath, segmentClear, clampToClearance, approachPoint, routeToFiringPosition, DIRS8 } from './pathfinding.js';
import {
  createSheetFrom, applyDamage, spendAttrPoint, spendClassPoint, classTrack,
  scaleEnemy, effectiveLevel, damageBonus, deflect, trackNode, PAPER_CAP, EQUIP_SLOTS, equippedAction, equippedStats,
  orderedActionIds, reachOf, rangeOf, ammoCostOf, pendingPoints as pending, lookOf, stairwellHeal, REACH,
} from './stats.js';
import {
  createParty, leader as partyLeader, addMember, gainXpAll, createCompanionSheet,
  serializeProgress, parseProgress, PARTY_CAP, addCash,
} from './party.js';
import { applyStatus, statusFx, hasStatus, tickStep, statusLeft, statusList } from './statuses.js';
import { inReach } from './tactics.js';
import { createDraft, createCharacter, draftModel } from './creation.js';
import { aimsAtAlly, coneFrom, conePolyline } from './powers.js';
import { PlayerActor, EnemyActor, NpcActor, CompanionActor } from './actors.js';
import { COMPANIONS } from './data/companions.js';
import { createApp, buildLevel } from './scene.js';
import { placeModel, applyCharacterProportions, cloneMaterials, tintMaterials } from './models.js';
import { createPortraits } from './portraits.js';
import {
  throwProjectile, spawnDamageText, worldToScreenCss, impact as impactFx, statusBurst,
  createAuraLayer, footstep, bloodSplat, CHEST_Y,
} from './fx.js';
import { createControls } from './controls.js';
import { createPicker } from './picking.js';
import { createHoverLayer } from './hover.js';
import { createVisionLayer } from './vision.js';
import { createLooting } from './looting.js';
import { createShopping } from './shopping.js';
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
  // Each source gets its OWN guard. Sharing one meant a corrupt playtest stash
  // threw before the campaign save was ever read, so a bad stash silently
  // discarded a real run and dropped you on floor one - the stash is scratch
  // space written by a tool, and it must never be able to cost somebody their
  // progress. Falling back PAST it to the campaign save is the whole point.
  const stash = localStorage.getItem(STASH_KEY);
  if (stash) {
    try {
      activeLevel = JSON.parse(stash);
      activeLevelId = null;
      playtesting = true;
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
      }
    } catch { /* corrupt save - the shipped level is the honest fallback */ }
  }
} catch { /* localStorage itself is unavailable (private mode, blocked) */ }

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
      // Paper caught fire, so the paper is gone. Retire it everywhere at once -
      // grid, visual, and the harvested-here mark - exactly as stickGum retires
      // a wad that is now on somebody's shoe. Doing only the visual left the
      // grid still holding a drift on a tile that plainly had none: no surface
      // could ever be laid there again (canTakeSurface wants 'floor'), it could
      // never burn again, and refreshTile would redraw paper over ash.
      spendFuel: (x, z) => {
        grid.setType(x, z, 'floor');
        scene.hideSurfaceVisual(x, z);
        loot?.forgetPaper?.(x, z); // a fresh drift here later is gatherable
      },
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
  // Enemies scale to the floor's depth: a base coworker on a deep floor is
  // tougher, a seniority variant keeps its tier on a shallow one (stats.js).
  const floorDepth = level.depth || 1;
  const enemies = grid.enemySpawns.map((s) => {
    const base = ENEMY_TYPES[s.type];
    return new EnemyActor(s.x, s.z, s.type, scaleEnemy(base, effectiveLevel(base, floorDepth)));
  });
  // Player-team summons (SUMMON_PLAN.md): temporary combatants conjured
  // mid-fight by a summon power. You CONTROL them like party members - each is
  // a { sheet, actor } pair (HP on the sheet, a CompanionActor body), taking
  // its own initiative turn. Not party members, not saved, not counted against
  // the party cap - they live only for the combat and are despawned when it
  // ends. They block enemies (like the party) but are pass-through for the party.
  const summons = [];
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
  let armedOoc = null; // hotbar action armed OUT of combat (a coworker, or a spot)
  let oocAim = null; // last ground point the cursor was over, out of combat
  let hotbar = null; // persistent action bar (built once a class is picked)
  let tacticalBtn = null; // overhead-camera toggle on the HUD rail (built with the HUD)
  let hotbarPaper = -1; // last paper count the hotbar rendered (refresh gate)
  let hotbarBagKey = ''; // last pocket contents the hotbar rendered (item slots)
  let hotbarRow = 0; // which hotbar row is showing - survives a bar rebuild
  let pendingGodPick = null; // god-mode click-to-place callback (see window.__god)
  let oocTurnClock = 0; // out-of-combat real-time accrued toward the next fire/smoke turn

  // --- gameplay tuning --------------------------------------------------------
  const ENGAGE_RADIUS = 4; // Chebyshev tiles within which enemies join a fight
  const EXPLOSION_DAMAGE = 8; // shrapnel to the player standing beside a printer
  const VICTORY_HEAL = 5; // the breather after winning a fight
  const STAIRWELL_HEAL = 6; // the breather between floors
  const OOC_TURN_SECONDS = 1.6; // out-of-combat seconds that count as one fire/smoke turn

  // Merchants (ECONOMY_PLAN.md). Built before looting because the Alt overlay
  // labels shop props through it. A machine's instance key is its tile.
  const shopping = createShopping({
    getSheet: () => sheet,
    getParty: () => party,
    isInCombat: () => inCombat,
    isGameOver: () => gameOver,
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
  // module; approachAndDo is hoisted, so wiring it here is safe.
  const loot = createLooting({
    app, grid, runtime, enemies,
    getActor: () => player, // the leader's actor - re-pointed on leader switch
    // In a fight "you" is whoever's turn it is, not the leader: initiative
    // decides who acts, so a snack out of the pockets has to come out of THEIR
    // pockets and heal THEIR sheet.
    getSheet: () => (inCombat && combat ? combat.actingSheet : sheet),
    isInCombat: () => inCombat,
    // A consumable is billed against the acting member's pool (looting.js).
    spendCombatAp: (n) => combat?.spendAp(n) ?? false,
    isGameOver: () => gameOver,
    approachAndDo: (x, z, run) => approachAndDo(x, z, run),
    extraEntries: () => doorEntries(), // doors share the Alt overlay
    // Equipping changes derived stats AND the basic weapon swing on the bars -
    // refresh the HUD, hotbar, and char sheet.
    onGearChange: () => refreshProgressUi(),
    // The pockets stay usable with a merchant open, and every verb in them
    // splices the bag - so the shop's sell column has to be repainted from the
    // live inventory rather than left holding the indexes it rendered with.
    // ...and an item slot on the hotbar counts what is in the bag, so the bar
    // repaints too - a coffee drunk from slot 3 has to stop offering itself.
    onBagChange: () => { shopping.refreshIfOpen(); refreshHotbarSlots(); },
    // Everyone else still standing can be handed an item. The recipient's
    // sheet takes it directly - pockets are unlimited, so there is nothing to
    // refuse for.
    recipients: () => (party?.members || [])
      .filter((m) => m !== partyLeader(party) && m.sheet.hp > 0)
      .map((m) => ({ name: m.sheet.name, take: (id) => m.sheet.inventory.push(id) })),
    // The purse is party state, so looting reaches it through the host rather
    // than the sheet (ECONOMY_PLAN #2).
    addCash: (n) => { if (party) addCash(party, n); },
    getCash: () => party?.cash || 0,
    openShop: (x, z) => openShopAt(x, z),
    shopSoldOut: (key) => shopping.soldOut(key),
  });

  function abortCombat() {
    if (combat) {
      combat.abort();
      combat = null;
    }
    inCombat = false;
    despawnSummons();
    syncLeaderBindings();
  }

  // Take one summon off the board. NOT a death - a summon's assignment simply
  // ends (combat.js dismissSummon, or the world clock below), so there is no
  // topple, no body, no loot. Destroying the entity auto-unregisters it from
  // picking (see ARCHITECTURE.md); nulling the node stops the actor's update
  // from animating a body that no longer exists.
  function dismissSummon(body) {
    if (!body) return;
    body.entity?.destroy();
    body.entity = null;
    body.visual = null;
    const i = summons.findIndex((s) => s.actor === body);
    if (i >= 0) summons.splice(i, 1);
    const e = enemies.indexOf(body);
    if (e >= 0) enemies.splice(e, 1);
  }

  // Clear the whole summon roster at once. Losing and aborting still do this -
  // a game over or a torn-down fight leaves nothing standing. VICTORY no longer
  // does: a summon with turns left on its assignment walks out of the fight
  // with you and joins the next one (see the world clock in the update loop).
  function despawnSummons() {
    // Over a COPY - dismissSummon splices the list it is walking.
    for (const s of [...summons]) dismissSummon(s.actor);
    summons.length = 0;
  }

  // Out-of-combat, a summon's assignment is spent by the world clock instead of
  // by initiative turns - one per fire/smoke turn - so temps don't loiter
  // forever just because you stopped fighting. Returns nothing; expired
  // applicants show themselves out.
  function ageSummons() {
    for (const s of [...summons]) {
      if (s.actor.summonTurns == null) continue;
      s.actor.summonTurns -= 1;
      if (s.actor.summonTurns > 0) continue;
      ui.toast(`${s.sheet.name}'s assignment ends. They head for the elevators.`);
      dismissSummon(s.actor);
    }
  }

  const enemyAt = (x, z) => enemies.find((e) => e.alive && e.x === x && e.z === z) || null;
  const npcAt = (x, z) => npcs.find((n) => n.x === x && n.z === z) || null;
  // Does a living party member stand on this tile? Enemy decisions (wander
  // targets, combat routing) treat every member the way they treated the
  // player. Pre-pick (no party yet) the lone spawn tile still counts.
  const partyAt = (x, z) => (party
    ? party.members.some((m) => m.actor && m.sheet.hp > 0 && m.actor.x === x && m.actor.z === z)
    : (x === player.x && z === player.z));
  // A living player-team summon on this tile. Summons block enemies (folded
  // into enemy pathing/occupancy below) but stay pass-through for the party -
  // isWalkable deliberately ignores them, so members walk right through.
  const summonAt = (x, z) => summons.some((s) => s.sheet.hp > 0 && s.actor.x === x && s.actor.z === z);
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
    // surfaceDamageResist is a RESERVED talent effect - the handler is live but
    // no class/companion sets it yet (a future flat surface-armor perk plugs in
    // here with zero systems change). See ARCHITECTURE.md talents.
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

  // The nearest open tiles around (cx,cz) for dropping summoned units onto:
  // walkable (no walls, bodies, or NPCs - isWalkable already excludes living
  // enemies), off any party member, and clear of the hazards a fresh arrival
  // shouldn't materialize into. Rings outward so reinforcements appear beside
  // their summoner, not across the room; returns up to `n` [x,z] pairs (fewer
  // when the area is boxed in). Used by world.spawnSummon.
  //   `minR` is the first ring to consider: 1 for "beside the summoner" (enemy
  //   reinforcements), 0 for a player-CHOSEN drop point, where the clicked tile
  //   itself is the first place they should try to stand.
  function freeTilesNear(cx, cz, n, minR = 1) {
    const spotOk = (x, z) =>
      isWalkable(x, z) && !partyAt(x, z) && !summonAt(x, z) && !enemyIsHazard(x, z);
    const out = [];
    for (let r = minR; r <= 4 && out.length < n; r++) {
      if (r === 0) {
        if (spotOk(cx, cz)) out.push([cx, cz]);
        continue;
      }
      for (let dz = -r; dz <= r && out.length < n; dz++) {
        for (let dx = -r; dx <= r && out.length < n; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // this ring shell only
          const x = cx + dx;
          const z = cz + dz;
          if (!spotOk(x, z)) continue;
          out.push([x, z]);
        }
      }
    }
    return out;
  }

  // --- populate the scene -----------------------------------------------------
  const lift = floorHeight / 2;
  // Surfaces a power DROPS during a fight are litter, not terrain: Bulk Mail's
  // paper drifts clear a few rounds later, so a cone can't permanently repaint
  // the floor (nor leave a renewable ammo pile behind it). Tracked here rather
  // than in surfaces-runtime because reverting needs the grid AND the visual,
  // both of which live on this side.
  const tempSurfaces = new Map(); // "x,z" -> { left, type }
  function ageTempSurfaces() {
    for (const [key, t] of [...tempSurfaces]) {
      const [x, z] = key.split(',').map(Number);
      // Fire ate it, or something repainted the tile - either way it is no
      // longer ours to clean up.
      if (grid.typeAt(x, z) !== t.type) { tempSurfaces.delete(key); continue; }
      if (t.left > 1) { t.left -= 1; continue; }
      tempSurfaces.delete(key);
      grid.setType(x, z, 'floor');
      scene.hideSurfaceVisual(x, z);
      loot.forgetPaper?.(x, z); // a fresh drift here later is gatherable again
    }
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
  const hudSheetNow = () => (inCombat && combat?.actingSheet) || sheet;
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
    paintHud(hudSheetNow());
    if (inCombat) combat?.refresh?.();
  };
  // Proportions BEFORE attach (it captures the rig lift); tint AFTER, because
  // attach is what clones the shared materials per instance.
  const dressUp = (e, actor, look, model = null) => {
    applyCharacterProportions(e, look?.build);
    actor.attach(e);
    actor.applyTint(look?.tint);
    // Kick off this character's portrait from the SAME model + look, so the
    // little picture and the body on the floor can never disagree. It lands
    // asynchronously and refreshes whatever is showing when it does.
    if (model) portraits.forActor(actor, model, look, onPortraitReady);
  };
  for (const en of enemies) {
    placeModel(app, `assets/characters/${en.def.model}.glb`, en.x, en.z, {
      lift, rotY: -90, animate: true,
      onReady: (e) => { dressUp(e, en, en.def.look, en.def.model); picking.register(e, 'enemy', en); },
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
  // 'applicant' - or an ENEMY_TYPES id) onto free tiles, wire their models, and
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
  function spawnSummonUnits(archetypeId, team, summoner, n, at = null) {
    const def = CLASSES[archetypeId] || ENEMY_TYPES[archetypeId];
    if (!def) return [];
    const ally = team === 'player';
    const out = [];
    const spots = at
      ? freeTilesNear(at.x, at.z, n, 0)
      : freeTilesNear(summoner.x, summoner.z, n, 1);
    for (const [x, z] of spots) {
      const actor = ally
        ? new CompanionActor(x, z, archetypeId, def)
        : new EnemyActor(x, z, archetypeId, def, { team, summoned: true, summonedBy: summoner });
      // Who called them is part of the record, not just of the fight they were
      // called in: a summon that outlives its fight walks into the NEXT one,
      // and the per-summoner live cap can only see it if the link survives the
      // trip (SUMMON_PLAN #7). Enemy-side summons carry the same link on the
      // actor itself.
      const rec = ally
        ? { sheet: createSheetFrom(def, { summon: true }), actor, summonedBy: summoner }
        : actor;
      (ally ? summons : enemies).push(rec);
      placeModel(app, `assets/characters/${def.model}.glb`, x, z, {
        lift, rotY: ally ? 90 : -90, animate: true,
        onReady: (e) => {
          dressUp(e, actor, ally ? lookOf(rec.sheet) : actor.def?.look, ally ? rec.sheet.model : actor.def?.model);
          picking.register(e, ally ? 'summon' : 'enemy', actor);
        },
      });
      out.push(rec);
    }
    return out;
  }

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
  function previewClass(classId) {
    const token = ++previewToken;
    if (previewEntity) { previewEntity.destroy(); previewEntity = null; }
    placeModel(app, `assets/characters/${CLASSES[classId].model}.glb`, player.x, player.z, {
      lift, rotY: 45, animate: true, // start facing the head-on camera
      onReady: (e) => {
        // The picker must show the character you will actually get, tint and
        // build included. There is no actor on this body, so it clones and
        // tints through the shared helpers directly - it used to carry its own
        // inline copy of the maths, which is how the compounding tint bug came
        // to exist in two places at once. The clones are kept on the entity so
        // a later re-tint (the creation flow's swatch row) computes from the
        // pristine colours rather than from the last tint's result.
        const look = CLASSES[classId].look;
        applyCharacterProportions(e, look?.build);
        e._mats = cloneMaterials(e);
        tintMaterials(e._mats, look?.tint);
        if (token !== previewToken) { e.destroy(); return; }
        previewEntity = e;
      },
    });
  }
  // The same staging as previewClass, reading the DRAFT instead of the class
  // entry - so the body on the spawn tile is the character being built rather
  // than the one that was picked. Shares previewClass's token guard, which is
  // what keeps a fast run along the wardrobe row from landing out of order.
  function previewDraft(draft) {
    const token = ++previewToken;
    if (previewEntity) { previewEntity.destroy(); previewEntity = null; }
    placeModel(app, `assets/characters/${draftModel(draft)}.glb`, player.x, player.z, {
      lift, rotY: 45, animate: true,
      onReady: (e) => {
        applyCharacterProportions(e, draft.build);
        e._mats = cloneMaterials(e);
        tintMaterials(e._mats, draft.tint);
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

  // A playable class named by the URL (`#class=it-support`), or null. Only
  // real, playable ids resolve - a typo shows the picker rather than booting
  // into a broken sheet.
  function preselectedClass() {
    const id = /(?:^|[#&])class=([\w-]+)/.exec(location.hash)?.[1];
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

  // The picker picked a job; now the badge photo. The candidate stays on the
  // spawn tile under the same dollied-in camera - the résumé card is what gets
  // replaced, not the body - so this costs no .glb load at all.
  function onClassPicked(classId) {
    const draft = createDraft(classId);
    draft.className = CLASSES[classId].name; // the read-back line quotes the job
    ui.showBadgeStep(draft, {
      onCommit: () => beginRun(createCharacter(draft)),
      // Skipping accepts every default, which is the same thing the `#class=`
      // express lane does - one code path, so the two can never diverge.
      onSkip: () => beginRun(createCharacter(createDraft(classId))),
      // Reflect the draft on the body already standing on the spawn tile. A rig
      // change is the ONE thing that costs a .glb load; tint and build mutate
      // the live entity in place, which is what lets a slider drive them every
      // frame instead of queueing a reload per tick (CHARACTER_PLAN #14).
      onPreview: (kind) => {
        if (kind === 'rig') { previewDraft(draft); return; }
        if (!previewEntity) return;
        applyCharacterProportions(previewEntity, draft.build);
        tintMaterials(previewEntity._mats || [], draft.tint);
      },
    });
  }

  // Every way to die funnels through here: freeze the world, drop any active
  // combat, end the campaign run, roll credits.
  function loseGame(message) {
    gameOver = true;
    player.clearPath();
    abortCombat();
    // Only a CAMPAIGN death ends a campaign run. A level launched from the
    // editor is standalone (STASH_KEY, its own party, no floor chain), so
    // dying in a playtest must not delete the saved run sitting in the same
    // browser - that is somebody's progress, wiped by a tool they were using
    // to check a room.
    if (!playtesting) clearProgress();
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
    paintHud(sheet);
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
    paintHud(sheet);
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

  // Blowing up a printer: flash, clear the tile, flatten anyone beside it.
  function handleExplosion(x, z) {
    scene.explosionFlash(x, z);
    vfx.impact(x, z, 'toner', { y: 0.5, scale: 1.4 });
    vfx.shake(0.16, 0.45); // the one moment in the office that earns a jolt
    grid.setType(x, z, 'floor');
    scene.removePropVisual(x, z);
    const slain = enemies.filter((en) =>
      en.alive && Math.abs(en.x - x) <= 1 && Math.abs(en.z - z) <= 1);
    for (const en of slain) en.die();
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
      if (!m.actor?.entity || m.sheet.hp <= 0) continue;
      if (Math.abs(m.actor.x - x) > 1 || Math.abs(m.actor.z - z) > 1) continue;
      const dead = applyDamage(m.sheet, EXPLOSION_DAMAGE);
      m.actor.flinch();
      vfx.impact(m.actor.x, m.actor.z, 'slam');
      vfx.damageText(m.actor.x, m.actor.z, `-${EXPLOSION_DAMAGE}`);
      msg += m === partyLeader(party)
        ? ` You catch shrapnel. -${EXPLOSION_DAMAGE} HP.`
        : ` ${m.sheet.name} catches shrapnel. -${EXPLOSION_DAMAGE} HP.`;
      if (dead) downed.push(m);
    }
    ui.say(msg);
    for (const en of slain) awardKill(en);
    if (sheet) paintHud(sheet);
    for (const m of downed) {
      downOrLose(m, 'PC LOAD LETTER. Fatal.');
      if (gameOver) return; // that was the wipe
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

  // The ranged twin of bestApproachPath: cheapest walk-up route to any tile a
  // weapon with `range` could FIRE at (x, z) from. The rule is pure and shared
  // with combat's routeIntoRange (pathfinding.js); only the bindings differ.
  function bestFiringPath(x, z, range) {
    return routeToFiringPosition({
      tx: x,
      tz: z,
      range,
      fromX: Math.round(player.x),
      fromZ: Math.round(player.z),
      isWalkable,
      hasLos: (ax, az, bx, bz) => hasLos({ x: ax, z: az }, { x: bx, z: bz }),
      findPath: (ax, az) => findPath(isWalkable, player.x, player.z, ax, az, hazardCost, grid.stepOpen),
    });
  }

  // Walk to the open tile nearest an enemy; combat starts on arrival via the
  // adjacency check in onMemberStep.
  // Everyone a wedge would catch right now: inside it, and with a clear line.
  // One rule, used by the preview and the click, so a ring can never promise
  // somebody the cone would miss.
  function coneCatches(test) {
    return enemies.filter((en) => {
      if (!en.alive || !en.entity) return false;
      const bp = en.entity.getPosition();
      return test(bp.x, bp.z, 0.5) && hasLos(player, en);
    });
  }

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
  // What working a door costs when there is a fight on. Cheaper than a verb:
  // the walk to reach it has already been billed as movement, and this is the
  // handle, not the journey.
  const COMBAT_DOOR_AP = 1;
  // Can the acting body reach this door's handle? In a fight there is no
  // walking-to-it - movement belongs to combat and is priced by the tile - so
  // the rule is the tactical one: you work a door you are standing beside.
  const atDoor = (key, actor) => !!actor
    && doorSides(key).some(([x, z]) => actor.x === x && actor.z === z);
  function toggleDoor(key) {
    if (gameOver) return;
    // Doors used to be refused outright while `inCombat`, with no comment - and
    // a closed door is the game's ONLY true line-of-sight blocker, so the half
    // of the game that is about positioning was the half where the one piece of
    // terrain you can change was untouchable. `examineAt` still described it.
    if (inCombat) {
      if (!atDoor(key, combat?.actingActor)) { ui.say('Too far - step up to the door first.'); return; }
      if (!(combat?.spendAp(COMBAT_DOOR_AP) ?? false)) {
        ui.say(`Not enough AP - working a door costs ${COMBAT_DOOR_AP}.`); return;
      }
    }
    const open = !grid.doors.get(key).open;
    grid.setDoorOpen(key, open);
    scene.refreshDoor(key);
    for (const e of enemies) e.clearPath(); // their routes may have just changed
    approachEpoch += 1; // ...and so may yours: the armed target rings recheck
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
  const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
  // Melee reach out of combat, measured the same way combat measures it: real
  // distance between continuous positions against the leader's weapon reach
  // (TACTICS_PLAN revision). These pre-flight an opener before a fight starts,
  // so they must agree with combat's own predicate or a click could open a
  // fight the attacker can't actually swing in.
  const posOf = (a) => {
    if (a?.entity) { const p = a.entity.getPosition(); return { x: p.x, z: p.z }; }
    return { x: a?.x ?? 0, z: a?.z ?? 0 };
  };
  const playerReaches = (en, r = null) => {
    const a = posOf(player);
    const b = posOf(en);
    return inReach(a.x, a.z, b.x, b.z, r ?? (sheet ? reachOf(sheet) : REACH.DEFAULT), grid.stepOpen);
  };
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
      const shot = cheb(player, en) <= range && hasLos(player, en);
      if (a.ammoCost) return shot && (sheet?.paper || 0) >= throwAmmoCost(id);
      // A weapon walks in to a FIRING position, not to their elbow - asking
      // canApproach here refused shots that were plainly on. This still refuses
      // a target nobody can close with (main.js's opener guard depends on that),
      // it just asks the question the weapon actually poses.
      return shot || canWalkIntoRange(en, range);
    }
    if (a.type === 'shove') return playerReaches(en, REACH.SHOVE);
    return playerReaches(en) || canApproach(en);
  };

  // --- Examine ------------------------------------------------------------
  // One source of truth for "what is this?", so every menu that offers Examine
  // - out of combat, in combat - says the same thing about the same object.
  // Flavor lives in the registries (data/tiles.js `examine`, an enemy or NPC
  // def's `examine`); this only decides which one applies.
  function examineTile(tx, tz) {
    const def = grid.defAt(tx, tz);
    if (isWalkable(tx, tz)) {
      if (runtime.isBurning(tx, tz)) return FIRE.examine;
      if (grid.isElectrified(tx, tz)) return ELECTRIFIED.examine;
      const surfId = runtime.surfaceAt(tx, tz);
      return (surfId && SURFACES[surfId].examine) || 'Standard-issue office carpet. Faintly damp.';
    }
    // Burning first: a trash can on fire is a different object than a trash can.
    if (def.ignitable && runtime.isBurning(tx, tz)) {
      return 'The trash can is thoroughly on fire. Somewhere, an alarm should be going off.';
    }
    if (def.examine) return def.examine;
    if (def.ignitable) return 'A trash can. Sixty percent paper, forty percent regret.';
    if (def.explosive) return 'The printer. It has jammed 4 times today. It is waiting.';
    if (def.shop) return 'A snack machine, humming. Row E7 has been stuck since before you were hired.';
    if (def.loot) return `${def.label}. Probably contains secrets. Or staples.`;
    // Naming it beats miscalling it. The cubicle wall is the LAST resort now:
    // as the catch-all for everything solid it introduced half the furniture in
    // the office - chairs, sofas, fridges, bookshelves - as a cubicle wall.
    return def.label
      ? `${def.label}. Office issue, and not going anywhere.`
      : 'A cubicle wall. It has seen things.';
  }
  const doorExamine = (open) => (open
    ? 'An office door, ajar. A bold statement of availability.'
    : 'A closed office door. The universal sign for "do not perceive me."');
  // Whatever the cursor resolves to: a body first, then a door, then the tile.
  function examineAt(hit, tile, point) {
    if (hit?.kind === 'npc') return hit.ref.def.examine || 'A coworker. Non-hostile, for now.';
    if (hit?.kind === 'party') return hit.ref.def?.examine || 'One of yours. Holding up, mostly.';
    if (hit?.kind === 'enemy') return hit.ref.def.examine || 'A coworker, in the way.';
    const doorKey = hit?.kind === 'door' ? hit.ref : (point ? doorNearPoint(point) : null);
    if (doorKey) return doorExamine(grid.doors.get(doorKey)?.open);
    return tile ? examineTile(tile.x, tile.z) : null;
  }

  const canvasEl = document.getElementById('app');
  // Which party member owns this actor, if any.
  const memberOf = (actor) => party?.members.find((m) => m.actor === actor) || null;

  // Land a friendly verb on a colleague OUT of combat. There is no AP out here -
  // the same reason a pocket item is free between fights - so this spends the
  // action's `uses` if it rations itself and nothing otherwise. Only the purge
  // payload is honoured: a heal is already refused out here by
  // combatOnlyReason ("heal from your pockets"), and keeping this to one
  // payload means it cannot quietly become a second, cheaper buff path.
  function oocFriendlyOn(id, m) {
    const a = ACTIONS[id];
    const carrying = statusList(m.sheet).length;
    if (!a.purge) { ui.say(`${a.label} is for a fight.`); return; }
    if (!carrying) {
      ui.say(`${m.sheet.name} is running clean. Nothing to clear.`);
      return;
    }
    approachAndDo(m.actor.x, m.actor.z, () => {
      m.sheet.statuses = {};
      armedOoc = null;
      hotbar?.setArmed(null);
      ui.say(`You power-cycle ${m.sheet.name}. Everything they were carrying clears.`);
      paintHud(sheet); // the leader's card, for a self-cast
      partyBarKey = ''; // and the roster bar re-renders next frame
    });
  }

  // --- left-click verb dispatch (Divinity-style: the target picks the verb) ---
  function attackOrConfront(en) {
    const a = armedOoc && ACTIONS[armedOoc];
    if (a && (a.type === 'attack' || a.type === 'shove' || a.type === 'purge')) {
      engageWithAction(en, armedOoc);
    }
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
      // An ARMED friendly verb owns the click, ahead of every body verb below.
      // Without this the click fell straight through to "switch to them", so a
      // power aimed at a colleague out of combat did nothing but hand them the
      // reins - there was no way to clear a teammate's bleed outside a fight at
      // all. Combat has had this gate all along (armedIsFriendly); exploration
      // simply never grew one.
      if (armedOoc && aimsAtAlly(ACTIONS[armedOoc]) && m.sheet.hp > 0) {
        oocFriendlyOn(armedOoc, m);
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
      hover.clear();
      renderDialogueNode(dialogueTree.start);
    },
    close() { dialogueNpc = null; dialogueTree = null; dialoguePanel.hide(); },
    get visible() { return dialoguePanel.visible; },
  };

  // Anything that owns the screen and the clicks while it is up. The dialogue
  // panel and the shop panel are both modal in exactly the same way, and every
  // gate below cares about "is a panel talking to me", not which one - so they
  // ask this rather than naming one and quietly forgetting the other.
  const modalOpen = () => dialogue.visible || shopping.visible;
  function renderDialogueNode(nodeId) {
    const node = dialogueTree?.nodes[nodeId];
    if (!node) { dialogue.close(); return; }
    const speaker = dialogueNpc;
    const options = (node.options || [{ label: 'Leave', next: null }])
      // A recruit offer only shows while it can be accepted (not already
      // aboard, roster not full).
      .filter((o) => !o.effect?.recruit || canRecruit(dialogueNpc))
      // ...and a trade offer only from someone who actually has a cart.
      .filter((o) => !o.effect?.shop || !!dialogueNpc.def?.shop)
      .map((o) => ({
        label: o.label,
        action: () => {
          if (o.effect?.recruit) recruitCompanion(dialogueNpc);
          // Trading REPLACES the conversation rather than layering on it: the
          // shop is its own modal, and two panels stacked over each other is
          // how you get a click that lands on neither (ECONOMY_PLAN #5).
          if (o.effect?.shop && speaker.def?.shop) {
            dialogue.close();
            // Keyed by WHO, not where: a person carries their stock around
            // (and a recruited one literally walks off with it), so their
            // instance key must survive them moving.
            shopping.open(`npc:${speaker.typeId || speaker.def.name}`, speaker.def.shop);
            return;
          }
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
  const barSheet = () => ((inCombat && combat) ? combat.actingSheet : sheet);
  function hotbarActionIds() {
    const s = barSheet();
    const throwables = Object.keys(ACTIONS).filter((id) => {
      const a = ACTIONS[id];
      return a.ammoCost && (!a.needsTalent || !!(s.talent?.effects || {})[a.needsTalent]);
    });
    return orderedActionIds(s, [...s.actions, equippedAction(s), 'shove', 'take-cover', ...throwables]);
  }
  // Consumables in the pockets, deduped, with how many are in there. These are
  // the ITEMS a slot can carry: something with a `heal` or an `ammo` on it does
  // something when pressed. Gear is deliberately not here - equipping is a
  // pockets-panel act with a stat fold behind it, not a hotbar press.
  function hotbarItemIds() {
    const counts = new Map();
    for (const id of barSheet()?.inventory || []) {
      const it = ITEMS[id];
      if (!it || !(it.heal || it.ammo)) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }
  // Why this action can't be used with no fight on, or null when it can be.
  // Attacks, shoves and throws OPEN a fight (engageWithAction); a summon posts
  // on the spot (postSummonAt). What's left is the reactive pair, and both need
  // a fight to mean anything: Deflect Blame halves an incoming hit nobody is
  // throwing, and a heal out here would be a free, per-fight-refilling pool of
  // HP - which is precisely the thing the pockets exist to sell you.
  function combatOnlyReason(id) {
    const a = ACTIONS[id];
    const t = a?.type;
    // A purge is at its MOST useful out here: bleed runs on a step clock, so
    // between fights is exactly when you want it gone. Gating it to combat
    // would have made IT Support's identity verb unusable in the situation it
    // most obviously answers.
    if (!a || t === 'attack' || t === 'shove' || t === 'summon' || t === 'purge') return null;
    if (t === 'heal') return `${a.label} is for a fight - out here, heal from your pockets.`;
    return `${a.label} only means something once someone is swinging at you.`;
  }
  // --- the layout ---------------------------------------------------------------
  // What sits in each slot, in order. The default is the whole kit in canonical
  // order; `sheet.hotbar` is the player's own arrangement once they've moved
  // something (right-click a slot), and it lives on the SHEET so it survives a
  // leader switch, a save and a floor - each character keeps their own bar. An
  // older save has no such field and simply gets the default.
  //
  // A layout entry is { kind: 'action'|'item', id }, or null for a slot left
  // empty on purpose. Assignments are kept even when what they name is
  // unreachable right now (a stapler stowed, a coffee drunk): the slot dims and
  // says why instead of the bar rearranging itself under the player's hands,
  // which is the one thing a muscle-memory surface must never do.
  const defaultLayout = () => hotbarActionIds().map((id) => ({ kind: 'action', id }));
  // The layout the BAR shows: what the character has, plus at least one empty
  // slot, padded out to whole rows. The spare slot is the whole discoverability
  // story - a bar with no free space has nowhere to put the coffee, and a player
  // who can't see an empty slot has no reason to right-click one. It is also
  // what grows the bar: fill the last row and the next one appears, pager and
  // all, which is how a second row of items comes to exist at all.
  const padLayout = (entries) => {
    const rows = Math.max(1, Math.ceil((entries.length + 1) / ui.HOTBAR_ROW_SLOTS));
    const out = [...entries];
    while (out.length < rows * ui.HOTBAR_ROW_SLOTS) out.push(null);
    return out;
  };
  const layoutOf = (s) => padLayout(s?.hotbar?.length ? s.hotbar : defaultLayout());
  // A slot's view-model. An assignment whose power the character no longer has
  // (a weapon swing from a weapon now in the bag) still renders - as itself,
  // greyed, with the reason - rather than vanishing.
  function slotVm(entry) {
    if (!entry) return null;
    if (entry.kind === 'item') {
      const def = ITEMS[entry.id];
      if (!def) return null;
      return {
        kind: 'item', id: entry.id, label: def.name, icon: def.icon,
        count: hotbarItemIds().get(entry.id) || 0,
      };
    }
    const a = ACTIONS[entry.id];
    if (!a) return null;
    // In a fight the rules belong to combat.js: what the ACTING member can
    // afford, out of their own kit, with their own uses and paper. Out of one
    // they belong here. Same slot, same fields, two rule-owners - which is the
    // point of the bar being one widget instead of two that drift.
    if (inCombat && combat) {
      const st = combat.actionState(entry.id);
      return {
        kind: 'action',
        id: entry.id,
        label: a.label,
        icon: a.icon,
        ap: a.ap,
        ammoCost: st?.ammoCost || 0,
        uses: st?.uses ?? null,
        // Armed (aiming) or awaiting its confirm click - the bar rings them
        // differently, as combat's own bar used to.
        live: st?.live || null,
        tip: st?.tip || null,
        unavailable: !st
          ? `${a.label} is not something ${combat.actingSheet.name} can do.`
          : (st.affordable || st.live) ? null : st.reason,
      };
    }
    const available = hotbarActionIds().includes(entry.id);
    return {
      kind: 'action',
      id: entry.id,
      label: a.label,
      icon: a.icon, // the face it wears on the bar (data/actions.js)
      ap: a.ap,
      // The ammo cost handed to the bar is THIS character's (the Origami
      // Specialist throws an airplane for one sheet, not two) - the same number
      // the targeting gate and combat itself charge. The bar used to be given
      // the raw data cost and greyed out throws the other two would allow.
      ammoCost: throwAmmoCost(entry.id),
      // Why the slot can't act: not the character's power any more, or one a
      // fight owns (combatOnlyReason).
      unavailable: available
        ? combatOnlyReason(entry.id)
        : `${a.label} is not something you can do right now.`,
    };
  }
  // What the bar's item slots are counting, as one string - the gate that keeps
  // a per-frame DOM repaint off the hot path (like hotbarPaper for ammo).
  const bagKey = () => (barSheet()?.inventory || []).join(',');
  // Re-read the slots against live pocket contents: an assigned item can run
  // out, refill, or change count, and the count is in the label. The slot
  // view-models carry it, so this is a rebuild - cheap, and it is the same path
  // a gear change or a level-up already takes.
  const refreshHotbarSlots = () => { if (hotbar && sheet) buildHotbar(); };
  // The slots the bar shows, in the order it shows them. In a fight the reorg
  // status (`confused`) can shuffle that order - the same disorientation it
  // always applied, now landing on the player's own arrangement instead of on
  // a separate list combat kept for itself.
  const barLayout = () => {
    const entries = layoutOf(barSheet());
    return inCombat && combat ? combat.scrambleEntries(entries) : entries;
  };
  function buildHotbar() {
    hotbarRow = hotbar?.row ?? hotbarRow;
    hotbar?.destroy(); // a leader switch rebuilds it for the new sheet
    hotbar = ui.createHotbar(barLayout().map(slotVm), {
      onPress: pressHotbarSlot,
      onAssign: openAssignMenu,
      startRow: hotbarRow, // the row you were on survives the rebuild
    });
    hotbar.refresh(barSheet());
    // A rebuild starts with no slot lit, but `armedOoc` survives it - spending
    // a level-up point mid-aim left the bar looking unarmed while the rings,
    // the crosshair and the next click all still acted on the armed action.
    // The bar shows what is actually armed, or nothing is.
    hotbar.setArmed(inCombat && combat ? combat.armed : armedOoc);
    hotbarPaper = barSheet().paper;
    hotbarBagKey = bagKey();
  }
  // Pressing a slot: arm the power, or use the item. An empty slot says what it
  // is for rather than nothing at all - a dead button teaches nothing.
  //
  // In a fight the press goes to combat, which owns arming, AP and the confirm
  // step. That routing is the only thing that differs - the slot, its icon, its
  // number key and its position are the player's either way.
  function pressHotbarSlot(i) {
    const entry = barLayout()[i];
    if (!entry) { ui.say('That slot is empty - right-click it to assign a power or an item.'); return; }
    if (entry.kind === 'item') { loot.useItemById(entry.id); return; }
    if (inCombat && combat) { combat.pressAction(entry.id); return; }
    toggleOocArm(entry.id);
  }
  // Right-click a slot: everything that can go in it, in the bar's own order,
  // with what is already placed marked as such. Assigning something already on
  // the bar SWAPS the two slots - that is how the bar gets rearranged, and it
  // means the same power can never end up in two places.
  // Rearranging works in a fight too. The layout is the same layout either way,
  // and "you may not touch your own bar while it matters" was an artefact of
  // combat owning a different widget, not a rule anybody chose.
  function openAssignMenu(i, x, y) {
    if (!sheet || gameOver || modalOpen()) return;
    const layout = layoutOf(barSheet());
    const here = layout[i];
    const placedAt = (kind, id) => layout.findIndex((s) => s && s.kind === kind && s.id === id);
    const rowOf = (at) => Math.floor(at / ui.HOTBAR_ROW_SLOTS) + 1;
    const slotHint = (kind, id) => {
      const at = placedAt(kind, id);
      if (at < 0) return null;
      return at === i ? 'in this slot' : `on ${rowOf(at)}·${(at % ui.HOTBAR_ROW_SLOTS) + 1}`;
    };
    const items = [{ label: `Slot ${rowOf(i)}·${(i % ui.HOTBAR_ROW_SLOTS) + 1}`, header: true }];
    if (here) items.push({ label: 'Clear this slot', action: () => assignHotbarSlot(i, null) });
    items.push({ label: 'Powers', header: true });
    for (const id of hotbarActionIds()) {
      items.push({
        // Iconed like the slot it would fill, so the menu and the bar name the
        // same thing the same way.
        label: `${ACTIONS[id].icon || '❔'}  ${ACTIONS[id].label}`,
        hint: slotHint('action', id),
        action: () => assignHotbarSlot(i, { kind: 'action', id }),
      });
    }
    const carried = hotbarItemIds();
    items.push({ label: 'From your pockets', header: true });
    if (!carried.size) items.push({ label: 'Nothing usable in there' });
    for (const [id, n] of carried) {
      items.push({
        label: `${ITEMS[id].icon || '❔'}  ${ITEMS[id].name}`,
        hint: slotHint('item', id) || (n > 1 ? `×${n}` : null),
        action: () => assignHotbarSlot(i, { kind: 'item', id }),
      });
    }
    ui.showMenu(x, y, items);
  }
  function assignHotbarSlot(i, entry) {
    if (!sheet) return;
    const layout = [...layoutOf(barSheet())];
    while (layout.length <= i) layout.push(null);
    if (entry) {
      const at = layout.findIndex((s) => s && s.kind === entry.kind && s.id === entry.id);
      if (at >= 0) layout[at] = layout[i] || null; // a swap, so nothing is ever in two places
    }
    layout[i] = entry;
    while (layout.length && !layout[layout.length - 1]) layout.pop(); // no trailing empties
    barSheet().hotbar = layout;
    buildHotbar();
    ui.say(entry
      ? `${entry.kind === 'item' ? ITEMS[entry.id].name : ACTIONS[entry.id].label} moves to slot ${Math.floor(i / ui.HOTBAR_ROW_SLOTS) + 1}·${(i % ui.HOTBAR_ROW_SLOTS) + 1}.`
      : 'You clear the slot.');
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
    onSelect: (i) => { if (!inCombat) switchLeader(i); }, // no switching mid-fight - you act on initiative
    onLevelUp: (i) => openLevelUpFor(party.members[i]),
  });
  let partyBarKey = ''; // last rendered roster state (refresh gate)

  // --- level-up allocation -----------------------------------------------------
  // Points bank on the sheet (stats.gainXp); the player spends them here. Every
  // member is built by hand - nothing auto-allocates (PROGRESSION_PLAN #7). The
  // pip by the HUD covers the leader (and the solo case); the party bar carries
  // a pip per companion.
  const levelUpPip = ui.createLevelUpPip({ onOpen: openLevelUps });
  // A short human blurb for a track node's effect, for the screen.
  function describeNode(effect = {}) {
    const bits = [];
    if (effect.attrBonus) for (const [k, v] of Object.entries(effect.attrBonus)) bits.push(`+${v} ${k[0].toUpperCase() + k.slice(1)}`);
    if (effect.grantsAction) bits.push(`Unlock ${ACTIONS[effect.grantsAction]?.label || effect.grantsAction}`);
    if (effect.talent) for (const [k, v] of Object.entries(effect.talent)) bits.push(typeof v === 'number' ? `+${v} ${k}` : k);
    return bits.join(' · ') || 'A perk.';
  }
  // The sheet's track as screen view-models (taken / locked / affordable).
  function trackNodesFor(sheet_) {
    return classTrack(sheet_).map((n) => ({
      id: n.id, name: n.name, cost: n.cost || 1, desc: describeNode(n.effect),
      taken: (sheet_.perks || []).includes(n.id),
      locked: !!(n.requires && !n.requires.every((r) => (sheet_.perks || []).includes(r))),
      affordable: (sheet_.classPoints || 0) >= (n.cost || 1),
    }));
  }
  // Read-only character sheet (press C). A plain view-model - main owns the
  // derived math (damageBonus/deflect) and the perk names.
  const charSheet = ui.createCharacterSheet({ onLevelUp: () => openLevelUps() });
  function charSheetVm(s) {
    return {
      name: s.name, className: s.className, level: s.level, xp: s.xp, xpNext: s.xpNext,
      attr: { ...s.attr }, hp: s.hp, maxHp: s.maxHp, maxAp: s.maxAp,
      damageBonus: damageBonus(s), deflect: deflect(s),
      equipped: Object.fromEntries(EQUIP_SLOTS.map((slot) => [slot, ITEMS[s.equipped?.[slot]]?.name || null])),
      talent: s.talent ? { name: s.talent.name } : null,
      perks: (s.perks || []).map((id) => trackNode(id)?.name || id),
      attrPoints: s.attrPoints || 0, classPoints: s.classPoints || 0,
    };
  }
  function refreshProgressUi() {
    if (sheet) { paintHud(sheet); buildHotbar(); } // a learned action joins the bar
    partyBarKey = ''; // force the bar to re-render its pips next frame
    levelUpPip.refresh(!inCombat && !gameOver && sheet ? pending(sheet) : 0);
    if (sheet) charSheet.refresh(charSheetVm(sheet)); // keep an open sheet live
  }
  function openLevelUpFor(member, after) {
    if (!member) { after?.(); return; }
    ui.showLevelUpScreen(member.sheet, {
      onSpend: (attr) => { spendAttrPoint(member.sheet, attr); refreshProgressUi(); },
      onLearn: (nodeId) => { spendClassPoint(member.sheet, nodeId); refreshProgressUi(); },
      nodesFor: () => trackNodesFor(member.sheet),
      onDone: () => { refreshProgressUi(); after?.(); },
    });
  }
  // Page through every member still holding points (of either type), one screen
  // at a time.
  function openLevelUps() {
    if (!party) return;
    const queue = party.members.filter((m) => pending(m.sheet) > 0);
    let i = 0;
    const next = () => (i < queue.length ? openLevelUpFor(queue[i++], next) : refreshProgressUi());
    next();
  }
  function switchLeader(i) {
    if (!party || inCombat || gameOver || modalOpen()) return;
    const m = party.members[i];
    if (!m?.actor || m === partyLeader(party) || m.sheet.hp <= 0) return;
    player.clearPath();
    pendingAction = null;
    armedOoc = null;
    party.active = i;
    sheet = m.sheet;
    player = m.actor;
    buildHotbar(); // their attacks, their ammo count
    paintHud(sheet);
    loot.refreshPanel(sheet);
    charSheet.refresh(charSheetVm(sheet)); // an open sheet follows control
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
    if (!sheet || inCombat || gameOver || modalOpen() || !ACTIONS[id]) return;
    // A slot a fight owns still ARMS nothing, but it says why. Listed-but-inert
    // was the old behavior of every non-attack (they weren't listed at all),
    // and a button that does nothing at all is indistinguishable from a bug.
    const blocked = combatOnlyReason(id);
    if (blocked) { ui.say(blocked); return; }
    armedOoc = armedOoc === id ? null : id;
    hotbar?.setArmed(armedOoc);
    if (!armedOoc) { ui.say('You stand down.'); return; }
    const a = ACTIONS[armedOoc];
    // What the armed slot is waiting for. A summon aims at the FLOOR, so
    // "click a coworker" would be aiming instructions for the wrong thing.
    ui.say(a.type === 'summon'
      ? `${a.label} ready — click a spot within ${summonRange(a)} tiles to post it.`
      : `${a.label} ready — click a coworker to start it.`);
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
  const summonRange = (a) => a.range ?? 5;
  const liveSummonsOf = (summoner) => summons.filter((s) =>
    s.sheet.hp > 0 && s.actor && s.summonedBy === summoner).length;
  const summonRoom = (a) => Math.max(0, (a.cap ?? a.count) - liveSummonsOf(player));
  // Why a spot is unusable, or null when it's good - shared by the click and
  // the hover rings, so what you see is the rule that runs (ARCHITECTURE.md on
  // previewAction). Deliberately the same four questions combat's
  // summonSpotProblem asks, less the AP and uses it can answer and we can't.
  function summonDropProblem(a, tx, tz) {
    const spot = { x: tx, z: tz };
    if (cheb(player, spot) > summonRange(a)) return 'Too far - post it closer.';
    if (!hasLos(player, spot)) return 'No clear line to that spot.';
    if (!freeTilesNear(tx, tz, 1, 0).length) return 'No room for anyone to stand there.';
    if (summonRoom(a) <= 0) return 'Your req is full - that is all the headcount you have.';
    return null;
  }
  // The tiles the arrivals would land on: the clicked tile first, then the free
  // ground ringing outward, bounded by `count` and by what the cap has left.
  function summonDropSpots(a, tx, tz) {
    if (summonDropProblem(a, tx, tz)) return [];
    return freeTilesNear(tx, tz, Math.min(a.count, summonRoom(a)), 0);
  }
  function postSummonAt(id, tx, tz) {
    const a = ACTIONS[id];
    const problem = summonDropProblem(a, tx, tz);
    if (problem) { ui.say(problem); return; }
    const spawned = spawnSummonUnits(
      a.archetype, 'player', player, Math.min(a.count, summonRoom(a)), { x: tx, z: tz },
    );
    if (!spawned.length) { ui.say('No room - nobody can find a free desk there.'); return; }
    for (const rec of spawned) {
      rec.actor.summonTurns = a.lifetimeTurns ?? null;
      vfx.impact(rec.actor.x, rec.actor.z, 'toner', { y: 0.5, scale: 0.55 });
    }
    player.faceToward(tx, tz); // you gesture at where you posted them
    ui.say(`${a.log} ${arrivalLine(spawned.length)}`);
    // One click, one post: the slot disarms so a stray second click walks you
    // somewhere instead of quietly filling the floor with temps.
    armedOoc = null;
    hotbar?.setArmed(null);
  }

  // First (enemy, member) adjacency in the party - any member can get
  // cornered, and the fight engages around whoever it was.
  function adjacentEnemyToParty() {
    for (const m of party?.members || []) {
      if (!m.actor?.entity || m.sheet.hp <= 0) continue;
      const en = enemies.find((e) =>
        e.alive && Math.abs(m.actor.x - e.x) <= 1 && Math.abs(m.actor.z - e.z) <= 1
        // Adjacency THROUGH a sealed doorway is not adjacency. Chebyshev alone
        // started fights across one - and because doors cannot be opened in
        // combat and closed doors block sight, the coworker on the far side
        // could then never be reached, shot or seen, while victory still
        // required them dead. The fight could not end.
        //
        // The test is the SAME one that picks the engaged set, deliberately:
        // "can these two take part in a fight together" should have one answer,
        // and using movement's stepOpen here asked a different question. That
        // rule needs all four edges around a diagonal corner open, which is
        // right for walking a body through and wrong for two people swinging at
        // each other past the end of a partition - so it refused fights that
        // plainly should have started.
        && canTakePart(m.actor, e));
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
    shopping.close(); // the machine can wait; it is not going anywhere
    inCombat = true;
    ui.hideMenu();
    loot.hideLabels(); // no browsing the shelves mid-fight
    hover.clear();
    // Everyone close enough joins the brawl (those further than 2 tiles are
    // surprised and lose their first turn - see combat.js). Bystanders
    // outside the radius join later if attacked (combat.js joinCombat).
    player.faceToward(primary.x, primary.z);
    primary.faceToward(player.x, player.z);
    const live = engaged.filter((e) => e.alive).length;
    ui.say(live > 1
      ? `${primary.def.name} has noticed you. So have ${live - 1} other${live > 2 ? 's' : ''}.`
      : `${primary.def.name} has noticed you.`);
    const controller = startCombat({
      app,
      party,
      engaged,
      opening,
      // Summons that outlived the last fight walk into this one - they're still
      // on the floor with turns left on the clock, so they fight.
      allies: summons.filter((s) => s.sheet.hp > 0),
      world: {
        isWalkable,
        // Doors the given tile is standing at, as edge midpoints, so combat can
        // ring them. Doors are the only terrain a fight can change and the only
        // true line-of-sight blocker, but they sit on EDGES rather than tiles -
        // so combat cannot find them the way it finds a prop, and until it
        // could, the one thing worth walking over to use had no affordance at
        // all. Returns the midpoint because that is where the door IS: 'h:x,z'
        // divides (x,z-1) from (x,z), so it lives at z - 0.5.
        doorsBeside: (x, z) => {
          const out = [];
          for (const key of grid.doors.keys()) {
            if (!doorSides(key).some(([sx, sz]) => sx === x && sz === z)) continue;
            const [dx, dz] = key.slice(2).split(',').map(Number);
            // The price rides along rather than being re-declared in combat.js:
            // one number, owned by the rule that charges it (toggleDoor).
            const mid = key[0] === 'h' ? { x: dx, z: dz - 0.5 } : { x: dx - 0.5, z: dz };
            out.push({ ...mid, ap: COMBAT_DOOR_AP });
          }
          return out;
        },
        // The acting body's own route: allies BLOCK in combat (no ending a
        // move stacked on a teammate; sequenced moves can afford the detour)
        // and the costs are the walker's own talents, not the leader's.
        // "The walker" includes a summon you're driving - it has its own sheet
        // and its own talents, so looking only at party.members made a shock-
        // immune leader route an applicant straight through live water.
        // Summons block too: a member's move must not end stacked on one.
        findPath: (sx, sz, tx, tz, self = player) => {
          const walker = party.members.find((m) => m.actor === self)
            || summons.find((s) => s.actor === self);
          const ms = walker?.sheet || sheet;
          const blocked = (x, z) => [...party.members, ...summons].some((m) =>
            m.actor && m.actor !== self && m.sheet.hp > 0 && m.actor.x === x && m.actor.z === z);
          const open = (x, z) => isWalkable(x, z) && !blocked(x, z);
          return findPath(open, sx, sz, tx, tz, hazardCostFor(ms), grid.stepOpen);
        },
        // AI routing (enemies and player-team summons): never through a party
        // member's or another summon's tile, costed by the enemy hazard model -
        // your talents don't shape an AI unit's fears. The mover's own start
        // tile isn't re-checked by findPath, so a unit never blocks on itself.
        findEnemyPath: (sx, sz, tx, tz) => findPath(
          (x, z) => isWalkable(x, z) && !partyAt(x, z) && !summonAt(x, z),
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
        // `turns` > 0 marks the surface as LITTER rather than terrain: it
        // clears itself after that many rounds (see ageTempSurfaces).
        // The read-only twin of leaveSurface's own first line. The zone verb's
        // ring preview and its cursor count both need to know which tiles will
        // TAKE a surface without painting one to find out - and asking a
        // different question than the commit asks is how a preview starts
        // lying (the rings promised tiles the click then skipped).
        canTakeSurface: (x, z) => grid.typeAt(x, z) === 'floor',
        // Toppling (POWERS_PLAN M6) needs to read a prop's definition, test
        // whether the tile behind it is clear, and mutate both. setType is the
        // same call the exploding printer already makes, so the grid, the
        // renderer and pathfinding re-read a toppled prop exactly as they do a
        // destroyed one - no new invalidation path.
        tileDefAt: (x, z) => grid.defAt(x, z),
        terrainOpen: (x, z) => grid.terrainOpen(x, z),
        setType: (x, z, type) => {
          grid.setType(x, z, type);
          scene.refreshTile?.(x, z);
        },
        // Partition toppling (TACTICS_PLAN M6): is a plain wall edge standing
        // between these cells, and knock it out of the world - grid rule and
        // mesh together, the same pairing setType already is. Doors never
        // appear in the wall sets, so they are untoppleable by construction.
        wallEdgeBetween: (x, z, nx, nz) => !!grid.wallEdgeBetween(x, z, nx, nz),
        toppleEdge: (x, z, nx, nz) => {
          const e = grid.removeEdgeBetween(x, z, nx, nz);
          if (e) scene.removeEdgeWall?.(e.o, e.k);
          return !!e;
        },
        leaveSurface: (x, z, tileType, turns = 0) => {
          if (grid.typeAt(x, z) !== 'floor') return false;
          grid.setType(x, z, tileType);
          scene.addSurfaceVisual(x, z, tileType);
          if (turns > 0) tempSurfaces.set(x + ',' + z, { left: turns, type: tileType });
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
          if (tileType === 'paper') loot.markPaperSpent?.(x, z);
          return true;
        },
        // Anyone alive is a legal target - bystanders outside the initial
        // engagement get pulled in when attacked.
        // A BORROWED coworker is off this list for the duration (TODO Phase 8).
        // Every AI target picker reads it, so dropping them here is the single
        // edit that turns their own colleagues against them - no side flag
        // threaded through the targeting code, because there is no side flag in
        // this engine to thread.
        liveEnemies: () => enemies.filter((e) => e.alive && !e.charmed),
        // Combat owns WHEN a body changes hands; main.js owns the lists, the
        // same division summons already use.
        setCharmed: (unit, on) => { unit.charmed = !!on; },
        // The tiles a summon aimed at (tx,tz) would actually land on - the
        // placement preview draws these rings, and spawnSummon fills them, so
        // what you see is where they stand.
        summonSpots: (tx, tz, n) => freeTilesNear(tx, tz, n, 0),
        // A summon whose assignment lapsed (or one that fell) leaves the board
        // here - combat.js decides when, main.js owns the lists and the body.
        dismissSummon: (body) => dismissSummon(body),
        // The spawn path itself is shared with the out-of-combat post - see
        // spawnSummonUnits, above.
        spawnSummon: spawnSummonUnits,
      },
      fx: vfx,
      callbacks: {
        say: ui.say,
        // Combat passes the acting member's sheet (initiative controls who you
        // drive); default to the leader for any callless use.
        updateHud: (s = sheet) => paintHud(s || sheet),
        // Repaint the shared bar. combat.js calls this wherever it used to
        // rebuild its own: control changing hands, and every refresh() that
        // moves AP, uses, paper or the armed slot.
        refreshBar: () => { if (hotbar && sheet) buildHotbar(); },
        // One combat round = one fire/smoke turn (combat.js calls this as it
        // hands the turn back to the player).
        onRound: () => { runtime.advanceTurn(); ageTempSurfaces(); },
        onEnemyKilled: awardKill,
        onWin: () => {
          inCombat = false;
          combat = null;
          // Summons stay. They used to blink out the instant the last coworker
          // fell, which made a two-turn-old applicant feel like a prop; now the
          // assignment (`lifetimeTurns`) is what ends them, whether that runs
          // out mid-fight, between fights, or in the next one. combat.js has
          // already swept any that were killed.
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
          paintHud(sheet);
          refreshHotbarSlots(); // the combat-only verbs dim again with the fight over
          openLevelUps(); // spend the fight's promotions now that it's safe
        },
        onLose: () => {
          inCombat = false;
          combat = null;
          despawnSummons();
          loseGame('The office wins this round. Darkness falls between the cubicles.');
        },
      },
    });
    // A hotbar opener can kill the last coworker before startCombat even
    // returns - onWin/onLose already tore the fight down and nulled `combat`,
    // so binding the returned controller here would resurrect a dead one (and
    // a later abort would run its cleanup a second time).
    if (inCombat) combat = controller;
    // Rebuild the bar NOW that combat's rules own it: the combat-only verbs
    // (Take Cover, Deflect, the heals) light up the moment a fight starts,
    // not at whatever next press happened to rebuild the slots - which is
    // exactly how it used to read: "disabled until I pushed something".
    refreshHotbarSlots();
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
      e.alive && Math.max(Math.abs(e.x - member.actor.x), Math.abs(e.z - member.actor.z)) <= ENGAGE_RADIUS
      // ...and who can actually take part. Somebody inside the radius but
      // sealed off joins a fight they can never act in, and victory needs
      // every engaged coworker down - so the fight would never end.
      && canTakePart(member.actor, e));
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
    if (rangeOf(actionId)) {
      if (!oocTargetOk(actionId, en)) {
        ui.say(a.ammoCost ? 'No line for that throw from here.' : 'No shot at them from here.');
        return;
      }
    } else if (a.cone) {
      // A cone fires from where you STAND: its reach is cone.range with a
      // clear line, not arm's length. Falling through to the melee test below
      // refused a wedge that plainly covered them, and then walked you in.
      if (cheb(player, en) > a.cone.range || !hasLos(player, en)) {
        ui.say(`They are not in the way of that ${a.label.toLowerCase()}.`);
        return;
      }
    } else if (a.type === 'shove') {
      if (!playerReaches(en, REACH.SHOVE)) { ui.say('Too far to shove. Walk your feelings over first.'); return; }
    } else if (!playerReaches(en) && !bestApproachPath(en.x, en.z)) {
      ui.say('No way to reach them from here.');
      return;
    }
    const engaged = enemies.filter((e) =>
      e.alive && Math.max(Math.abs(e.x - player.x), Math.abs(e.z - player.z)) <= ENGAGE_RADIUS
      && canTakePart(player, e)); // same rule as checkCombatTrigger - see there
    if (!engaged.includes(en)) engaged.push(en);
    beginCombat({ engaged, primary: en, opening: { actionId, target: en } });
  }

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
  const syncHudFor = (s) => { if (s && s === hudSheetNow()) paintHud(s); };

  // --- the per-tile rules, written once ----------------------------------------
  // Everything a body ON YOUR SIDE meets by standing somewhere: the step clock,
  // the surface under it, and the chance the floor takes its feet away. Members
  // and the temps you summon obey all three.
  //
  // These were hand-copied into onSummonStep, and the copy had already lost
  // two of them: a summon could not slip on water, and never caught a surface's
  // turn-clock status - so marching one through a puddle and into a fire
  // skipped both the spill and the burning that the same route lands on any
  // member. New effects are added HERE now, and reach both callers.
  //
  // `say` is the one thing that legitimately differs: the lines are written in
  // the player's voice, and a temp is not the player - so a summon passes a
  // no-op and takes the rules in silence.
  const quiet = () => {};

  // Step-clock statuses: bleed drips its dot, gum wears down. True if it
  // dropped them.
  function tickStepOn(ms, actor, x, z, say) {
    const { damage, expired } = tickStep(ms);
    let down = false;
    if (damage > 0) {
      down = applyDamage(ms, damage);
      // "You drip on the carpet" is literal - the carpet keeps it. On the
      // BODY's spot, not the tile centre, so the drip lands under the walker
      // rather than in the middle of the square they're crossing.
      const drip = actor.entity ? actor.entity.getPosition() : { x, z };
      vfx.splat(drip.x, drip.z, { scale: 0.5 });
      vfx.damageText(x, z, `-${damage}`);
      say('You drip on the carpet. -1 HP.');
      syncHudFor(ms);
    }
    if (expired.includes('gum')) {
      say('The gum finally lets go of your sole. Freedom.');
      syncHudFor(ms);
    }
    return down;
  }

  // Surfaces (data/surfaces.js): fire and electrified pools hurt, paper cuts
  // (and arms you), gum sticks, water and coffee editorialize. The walker's own
  // talents can shrug the damage off. True if it dropped them.
  function applySurfaceOn(ms, actor, x, z, say) {
    const sfx = surfEffect(x, z);
    if (!sfx) return false;
    if (sfx.ammo) {
      ms.paper = Math.min(PAPER_CAP, ms.paper + sfx.ammo);
      vfx.impact(x, z, 'shreds', { y: 0.3, scale: 0.8 });
      vfx.damageText(x, z, '+📄', '#8adf76');
    }
    // Gum on shoe: slowed, no kicking, but genuine traction (can't slip).
    if (sfx.applies === 'gum' && stickGum(x, z)) {
      const had = hasStatus(ms, 'gum');
      applyStatus(ms, 'gum');
      vfx.impact(x, z, 'gum', { y: 0.12 });
      vfx.status(x, z, 'gum');
      say(had ? 'More gum. You are building a collection.' : sfx.message);
      syncHudFor(ms);
    }
    // A turn-clock status a surface applies (fire -> burning) needs combat's
    // turns to tick, so it only takes hold in a fight; the instant surface
    // damage below is the out-of-combat story.
    if (sfx.applies && sfx.applies !== 'gum' && inCombat && applyStatus(ms, sfx.applies)) {
      vfx.status(x, z, sfx.applies);
      syncHudFor(ms);
    }
    const amount = effectiveSurfDamage(x, z, ms);
    if (amount > 0) {
      if (sfx.bleed) applyStatus(ms, 'bleed', { duration: sfx.bleed });
      const down = applyDamage(ms, amount);
      actor.flinch();
      vfx.impact(x, z, surfaceImpactKind(x, z), { y: 0.3 });
      vfx.damageText(x, z, `-${amount}`);
      say(sfx.message);
      syncHudFor(ms);
      return down;
    }
    if (sfx.amount) {
      say(ms.talent?.effects?.shockImmune && grid.isElectrified(x, z)
        ? 'The water crackles. Your ESD soles rate this a non-event. 0 damage.'
        : 'You glide across the drift; the edges respect a master. Not a scratch.');
      syncHudFor(ms);
    } else if (sfx.message && !sfx.applies) {
      say(sfx.message);
    }
    return false;
  }

  // Slippery surfaces: every wet tile entered risks a spill that ends the walk
  // right there. In combat the movement AP already spent stays spent - that IS
  // the penalty. slipImmune tread never slips; neither does a gummed shoe - gum
  // is traction. `wasSlipProof` is sampled BEFORE the step clock ticks, so the
  // tile a gum wad wears off on still keeps its grip.
  function maybeSlip(ms, actor, x, z, wasSlipProof, say) {
    if (gameOver || ms.talent?.effects?.slipImmune) return;
    if (wasSlipProof || statusFx(ms).slipProof || equippedStats(ms).slipProof) return;
    const chance = slipChanceAt(x, z);
    if (!chance || Math.random() >= chance) return;
    actor.clearPath();
    actor.flinch();
    vfx.impact(x, z, 'slip', { y: 0.12 });
    vfx.damageText(x, z, 'slip!', '#8ad4df');
    if (inCombat) combat?.notifySlip();
    else say('The floor was, in fact, wet. You go down. Gracefully? No.');
  }

  function onMemberStep(member, x, z, pathDone, changed = true) {
    // Stepping out of an enemy's reach mid-fight provokes it (TACTICS_PLAN M2).
    // Combat owns the rule and the bookkeeping; this just reports the step.
    if (changed && inCombat && combat) combat.notifyStep(member, x, z);
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
            m.sheet.hp = stairwellHeal(m.sheet, STAIRWELL_HEAL);
          }
          // Guarded like every other write (god.js:66): localStorage throws in
          // private mode and when the quota is gone, and this one runs in the
          // middle of a floor transition - an unguarded throw here would take
          // out the stairwell heal and the floor-clear screen with it, turning
          // "your save did not persist" into "the game stopped".
          try {
            localStorage.setItem(PROGRESS_KEY, JSON.stringify(serializeProgress(party, level.next)));
          } catch { /* no save is bad; losing the run to an exception is worse */ }
          ui.showFloorClear({ nextName: LEVELS[level.next].name }, () => location.reload());
        } else {
          // Same rule as loseGame: finishing a PLAYTEST level is not finishing
          // a campaign run, so it must not clear the campaign save either.
          if (!playtesting) clearProgress();
          ui.showWinScreen({ level: ms.level, defeated: enemies.filter((e) => !e.alive).length });
        }
        return;
      }
      if (fx.effect === 'damage' && changed) {
        const dead = applyDamage(ms, fx.amount);
        actor.flinch();
        vfx.impact(x, z, 'slam', { y: 0.35, scale: 0.8 });
        vfx.damageText(x, z, `-${fx.amount}`);
        ui.say(fx.message);
        syncHudFor(ms);
        if (dead) {
          downOrLose(member, 'Done in by the office itself. The floor was, in fact, wet.');
          return;
        }
      }
    }
    // Capture slip-proofing BEFORE the step clock ticks, so the tile a gum wad
    // wears off on still keeps its traction.
    const wasSlipProof = !!statusFx(ms).slipProof;
    if (changed) {
      if (tickStepOn(ms, actor, x, z, ui.say)) {
        downOrLose(member, 'Death by a thousand paper cuts. Well - several.');
        return;
      }
      if (applySurfaceOn(ms, actor, x, z, ui.say)) {
        downOrLose(member, 'Done in by the office itself. Facilities sends their regards.');
        return;
      }
      maybeSlip(ms, actor, x, z, wasSlipProof, ui.say);
    }
    // The trail you leave behind. A drift of shredded TPS reports CUTS
    // (data/surfaces.js), so crossing one is exactly how a walker starts
    // bleeding - and from that tile on they stamp bloody prints across the
    // office, darkest on the paper itself. Wet and coffee-soaked soles print
    // too, for a few tiles, until the shoe dries out. fx.js owns the shoe
    // state; this only reports the step and what's underfoot.
    if (changed && !gameOver) leaveFootprint(actor, ms, x, z);
    // Walk-up interactions (lighting trash cans) fire on deliberate arrival.
    if (isLeader && pendingAction && pathDone
      && Math.abs(x - pendingAction.x) <= 1 && Math.abs(z - pendingAction.z) <= 1) {
      const act = pendingAction;
      pendingAction = null;
      act.run();
    }
    checkCombatTrigger();
  }

  // A player summon's per-tile effects during its combat moves - the member
  // stepping's smaller cousin. Surface damage, gum and paper land on the
  // summon's own sheet; there's no exit, no leader, no bleed-to-lose. A summon
  // that falls just topples - combat.notifyMemberDown skips its initiative slot
  // and hands you a survivor if it was the one you were driving.
  function onSummonStep(s, x, z, done, changed) {
    if (!changed) return;
    // A summon breaking away from an enemy provokes just like a member does.
    if (inCombat && combat) combat.notifyStep(s, x, z);
    const ms = s.sheet;
    const actor = s.actor;
    const wasSlipProof = !!statusFx(ms).slipProof;
    // The same three rules a member's feet obey, in the same order - the temp
    // just takes them without the narration (the lines are the player's voice).
    if (tickStepOn(ms, actor, x, z, quiet)) {
      if (inCombat && combat) combat.notifyMemberDown();
      return;
    }
    if (applySurfaceOn(ms, actor, x, z, quiet)) {
      if (inCombat && combat) combat.notifyMemberDown();
      return;
    }
    maybeSlip(ms, actor, x, z, wasSlipProof, quiet);
    // A temp bleeds on the carpet like anybody else.
    if (!gameOver) leaveFootprint(actor, ms, x, z);
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
    onAnyLeftPress: () => ui.hideMenu(),
    // However the view is left - the button, T, a pitch drag, a raw setView -
    // the rail button repaints, so its lit state can never outlive the view.
    onTacticalChange: () => tacticalBtn?.refresh(),
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
      // In combat a click resolves in the same order the hover affordances do:
      // the body under the pixel, then a body near the ground point, then the
      // tile - so what the crosshair and the to-hit readout said is what the
      // click does.
      if (inCombat) {
        // Initiative: you control whoever's turn it is - a party member or a
        // summon you conjured. combat.actingActor is that body (party.active
        // can't point at a summon, which lives outside the roster). Clicks
        // target enemies or drive that unit; no switching (each acts on its
        // own turn).
        const actingActor = combat?.actingActor || party?.members[party.active]?.actor || player;
        // The acting member's OWN tile wins first: a self-cast (purge on
        // yourself) or a shuffle-in-place must not be stolen by an adjacent
        // enemy's tall body mesh overlapping the click.
        if (tile && actingActor && tile.x === actingActor.x && tile.z === actingActor.z) {
          combat?.handleTileClick(tile, point);
          return;
        }
        // A coworker's body under the cursor is a target (rings mark bodies;
        // the ground fallback behind a tall mesh is a mis-walk that burns AP).
        const bodyHit = picking.pick(controls.cameraEntity, sx, sy);
        // A FRIENDLY body, while a friendly verb is armed (POWERS_PLAN M1).
        // Gated on `armedIsFriendly` so a click on a teammate means nothing
        // different from before unless you are actually aiming a buff -
        // ungated, it would eat the clicks that walk you past your own party.
        if (combat?.armedIsFriendly
          && (bodyHit?.kind === 'party' || bodyHit?.kind === 'summon')) {
          const ally = combat.allyAtPoint(point)
            || (bodyHit.ref && combat.allyAtPoint({ x: bodyHit.ref.x, z: bodyHit.ref.z }));
          if (ally && combat.handleAllyClick(ally)) return;
        }
        if (bodyHit?.kind === 'enemy' && bodyHit.ref.alive) {
          combat?.handleEnemyClick(bodyHit.ref);
          return;
        }
        // Ground fallback: the same near-a-body test the hover affordances
        // run (combat.enemyAtPoint), so a click can't route into a walk on a
        // point where the crosshair was promising a swing. An exact-tile
        // match here was a third authority on "is this a coworker?" - it said
        // no on the outer band of a body the cursor said yes to.
        const near = point && combat?.enemyAtPoint(point);
        if (near) { combat?.handleEnemyClick(near); return; }
        if (!tile) return;
        combat?.handleTileClick(tile, point);
        return;
      }
      if (modalOpen()) return; // talking: clicks belong to the panel
      // An armed SUMMON aims at the floor, so while it is armed the world is a
      // placement grid and nothing else: the click posts the role where you
      // pointed rather than walking there, rummaging the desk behind the point,
      // or opening a fight with whoever is standing in the way. A refused spot
      // says why and stays armed (postSummonAt), so the next click can just be
      // a better one.
      if (armedOoc && ACTIONS[armedOoc].type === 'summon') {
        if (tile) postSummonAt(armedOoc, tile.x, tile.z);
        return;
      }
      // A CONE is aimed at a DIRECTION, so the ground is its natural target -
      // and the ground branch only ever handled summons, so aiming Bulk Mail at
      // the floor silently walked you there instead. It opens the fight on
      // whoever the wedge actually catches, which is the same rule the preview
      // just drew.
      if (armedOoc && ACTIONS[armedOoc].cone && point) {
        const a = ACTIONS[armedOoc];
        const test = coneFrom(a, { x: player.x, z: player.z }, point.x, point.z);
        const caught = test ? coneCatches(test) : [];
        if (!caught.length) {
          ui.say(`Nobody is in the way of that ${a.label.toLowerCase()}.`);
          return;
        }
        // The nearest one is the primary; the rest join through the engage
        // radius exactly as they would for any other opener.
        caught.sort((p, q) => cheb(player, p) - cheb(player, q));
        engageWithAction(caught[0], armedOoc);
        return;
      }
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
        const hit = picking.pick(controls.cameraEntity, sx, sy);
        // A coworker under the cursor is a TARGET, armed or not - a bare click
        // swings the basic attack (combat.js), so the cursor has to say so.
        // combat.handleHover resolves WHO that is (this body pick first, the
        // ground point as fallback) and WHETHER a click would swing right now
        // (the click's own gate: your turn, standing still) - and the
        // crosshair keys off that one answer. Reading the raw pick here showed
        // a crosshair mid-walk and on AI turns, promising a swing while the
        // to-hit readout and the click itself refused.
        const picked = hit?.kind === 'enemy' && hit.ref.alive ? hit.ref : null;
        const foe = combat.handleHover(point, sx, sy, picked);
        hover.setCursor(foe ? 'crosshair' : null);
        // Hovering a character glows their BODY and names them in the banner -
        // the DOS2 read, and the same one you already get out of combat. This
        // used to be held behind Ctrl, which meant the half of the game where
        // you aim at people was the half that wouldn't show you who you were
        // aiming at. Ctrl still adds the ground rings under EVERY character
        // (drawCharacterRings) - that's the at-a-glance read of the whole
        // board, which is a different question from "what is under my cursor".
        // A foe the hover resolved through the GROUND fallback (the pick ray
        // missed the mesh, but the point is on their body) counts as hovered
        // too: the crosshair is claiming you're aiming at them, so the glow
        // and the banner have to name the same coworker.
        const charHit = foe && !picked ? { kind: 'enemy', ref: foe, entity: foe.entity } : hit;
        const character = charHit && (charHit.kind === 'party' || charHit.kind === 'npc'
          || (charHit.kind === 'enemy' && charHit.ref.alive));
        hover.showCharacter(character ? charHit : null, point);
        return;
      }
      if (!sheet || gameOver || modalOpen()) { hover.clear(); oocAim = null; return; }
      // The ground point is remembered, not just consumed: an armed summon
      // draws its drop rings every frame (immediate-mode lines last one), and
      // hover events only arrive when the mouse actually moves.
      oocAim = point;
      hover.hover(point, sx, sy);
    },
    // The cursor left the world for the DOM UI: drop the world hover rather
    // than leaving the last-hovered body glowing and named behind the panel
    // the player is now using.
    onHoverLeave: () => {
      hover.clear();
      oocAim = null; // no cursor on the floor, no drop rings
      if (inCombat && combat) combat.handleHover(null, 0, 0);
    },
    onRightClickTile: (tile, sx, sy, point) => {
      if (!sheet || gameOver) return;
      // In combat, right-click is first the universal "back out": it lowers an
      // armed action or a pending confirm. Left-click never cancels (it reports
      // an invalid target), so aiming survives a near-miss.
      //
      // With nothing to back out of, it opens the context menu instead - the
      // Examine verb had no way in during a fight, which is the half of the
      // game where you most want to know what you're looking at. Only Examine:
      // every other verb in here spends a turn, and those belong on the action
      // bar where their AP cost is visible.
      if (inCombat) {
        if (combat?.cancelArmed()) return;
        const chit = picking.pick(controls.cameraEntity, sx, sy);
        const items = [];
        // A door you are standing beside. This is a turn-spending verb, so it
        // wears its price on the label - which is the same rule that keeps
        // everything else out of this menu and on the bar, honoured rather
        // than broken. Doors have no bar slot: they are terrain, not kit.
        const dk = chit?.kind === 'door' ? chit.ref : (point ? doorNearPoint(point) : null);
        if (dk && atDoor(dk, combat?.actingActor)) {
          const isOpen = grid.doors.get(dk)?.open;
          items.push({
            label: `${isOpen ? 'Pull the door shut' : 'Open the door'} - ${COMBAT_DOOR_AP} AP`,
            action: () => toggleDoor(dk),
          });
        }
        const text = examineAt(chit, tile, point);
        if (text) items.push({ label: 'Examine', action: () => ui.say(text) });
        if (items.length) ui.showMenu(sx, sy, items);
        return;
      }
      if (modalOpen()) return;
      const hit = picking.pick(controls.cameraEntity, sx, sy);
      if (hit && hit.kind === 'npc') {
        ui.showMenu(sx, sy, [
          { label: `Talk to ${hit.ref.def.name}`, action: () => approachAndDo(hit.ref.x, hit.ref.z, () => dialogue.open(hit.ref)) },
          { label: 'Examine', action: () => ui.say(examineAt(hit, tile, point)) },
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
          items.push({ label: 'Examine', action: () => ui.say(examineAt(hit, tile, point)) });
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
          { label: 'Examine', action: () => ui.say(doorExamine(open)) },
        ]);
        return;
      }
      const en = (hit && hit.kind === 'enemy' && hit.ref.alive) ? hit.ref : enemyAt(tile.x, tile.z);
      if (en) {
        ui.showMenu(sx, sy, [
          { label: `Confront ${en.def.name}`, action: () => confront(en) },
          { label: 'Avoid eye contact', action: () => ui.say('You study your shoes intently.') },
          { label: 'Examine', action: () => ui.say(en.def.examine || 'A coworker, in the way.') },
        ]);
      } else if (isWalkable(tile.x, tile.z)) {
        const surfId = runtime.surfaceAt(tile.x, tile.z);
        const items = [
          { label: 'Walk here', action: () => moveTo(tile, point) },
          { label: 'Examine', action: () => ui.say(examineTile(tile.x, tile.z)) },
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
        const items = [{ label: 'Examine', action: () => ui.say(examineTile(tile.x, tile.z)) }];
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
          { label: 'Examine', action: () => ui.say(examineTile(tile.x, tile.z)) },
        ]);
      } else {
        const def = grid.defAt(tile.x, tile.z);
        const items = [{ label: 'Examine', action: () => ui.say(examineTile(tile.x, tile.z)) }];
        if (def.shop) {
          items.unshift({
            label: `Buy from the ${def.label}`,
            action: () => approachAndDo(tile.x, tile.z, () => openShopAt(tile.x, tile.z)),
          });
        }
        if (def.loot && !def.shop) {
          items.unshift({
            label: 'Rummage',
            action: () => approachAndDo(tile.x, tile.z, () => loot.lootContainer(tile.x, tile.z)),
          });
        }
        ui.showMenu(sx, sy, items);
      }
    },
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
  const hover = createHoverLayer({
    app,
    canvas: canvasEl,
    picking,
    controls,
    ui,
    vision, // it still owns what the cursor SAYS; vision hides the OS one
    queries: {
      party: () => party,
      enemies: () => enemies,
      summons: () => summons,
      npcs: () => npcs,
      leader: () => (party ? partyLeader(party) : null),
      memberOf,
      playerEntity: () => player?.entity || null,
      reach: () => reachOf(sheet),
      armed: () => armedOoc,
      armedTargetOk: oocTargetOk,
      // Where an armed SUMMON would land right now: the hovered tile, the spots
      // its arrivals would fill, and why they couldn't. Null unless a summon is
      // armed with the cursor on the floor - the rings key off this one answer,
      // which is the same one the click runs (summonDropProblem).
      // The wedge an armed cone would cover right now, or null. Same geometry
      // combat uses, from the same pure function - only the origin differs.
      coneAim: () => {
        if (!armedOoc || inCombat || !oocAim || !sheet) return null;
        const a = ACTIONS[armedOoc];
        if (!a.cone) return null;
        const test = coneFrom(a, { x: player.x, z: player.z }, oocAim.x, oocAim.z);
        if (!test) return null;
        const caught = coneCatches(test);
        return { line: conePolyline(a, test), caught: caught.map((e) => [e.x, e.z]), usable: !!caught.length };
      },
      summonDrop: () => {
        if (!armedOoc || inCombat || !oocAim) return null;
        const a = ACTIONS[armedOoc];
        if (a.type !== 'summon') return null;
        const x = Math.round(oocAim.x);
        const z = Math.round(oocAim.z);
        return { x, z, problem: summonDropProblem(a, x, z), spots: summonDropSpots(a, x, z) };
      },
      inCombat: () => inCombat && !!combat,
      doorNear: doorNearPoint,
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

  // --- keyboard: hold Alt for the loot overlay, I for the pockets ---------------
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') {
      e.preventDefault(); // keep focus off the browser's menu bar
      hover.setAlt(true); // lights what the cursor is already on, without a re-hover
      // Held in a fight too: the overlay is how you SEE the doors, and a door
      // is the one piece of terrain a fight can change. The loot entries it
      // also carries stay refused with their own message - being able to read
      // the room beats being able to act on all of it.
      if (!e.repeat && sheet && !gameOver) loot.showLabels();
    } else if (e.key === 'Control') {
      hover.setCtrl(true); // rings under everyone while held (drawCharacterRings)
    } else if ((e.key === 'i' || e.key === 'I') && sheet && !gameOver) {
      loot.togglePanel(sheet);
    } else if (/^[1-9]$/.test(e.key) && sheet && !gameOver && !modalOpen()) {
      // Number keys press the matching slot of the VISIBLE row, so 1 is always
      // the leftmost button on screen however many rows the kit needs.
      //
      // These used to be gated `!inCombat`, which meant a FIGHT - the half of
      // the game that is nothing but pressing verbs under pressure - was the
      // half with no keyboard shortcuts at all. The row you learn out of combat
      // is the row you get in one, which was always the stated point of the
      // layout living on the sheet.
      const i = hotbar?.indexAtKey(Number(e.key)) ?? -1;
      if (i >= 0) pressHotbarSlot(i);
    } else if ((e.key === '[' || e.key === ']') && sheet && !gameOver && !modalOpen()) {
      // Page the hotbar rows from the keyboard - the pager buttons and the wheel
      // over the bar do the same thing.
      hotbar?.flip(e.key === ']' ? 1 : -1);
    } else if (e.key === 'Tab' && sheet && !inCombat && !gameOver && !modalOpen()) {
      // Tab cycles which member you lead OUT of combat. In a fight there's no
      // switching - initiative decides who acts, and you control each on their
      // own turn.
      e.preventDefault();
      cycleLeader();
    } else if ((e.key === 'c' || e.key === 'C') && sheet && !gameOver && !modalOpen()) {
      // The read-only character sheet for whoever you're controlling.
      charSheet.toggle(charSheetVm(sheet));
    } else if ((e.key === 't' || e.key === 'T') && sheet && !gameOver && !modalOpen()) {
      // Overhead tactical view - the same toggle as the rail button.
      controls.toggleTactical();
      tacticalBtn?.refresh();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') { hover.setAlt(false); loot.hideLabels(); }
    if (e.key === 'Control') hover.setCtrl(false);
  });
  window.addEventListener('blur', () => {
    loot.hideLabels();
    hover.releaseModifiers(); // a key can't be 'still held' across a focus loss
  });

  // Cosmetic feedback: projectiles, floating numbers, particle bursts, ground
  // decals and the camera's flinch. Defined after controls exist because the
  // damage text projects through the camera and the shake drives the rig.
  // Everything here is fire-and-forget - combat and the step handlers hand it
  // world coordinates and never wait on it (see fx.js).
  const auras = createAuraLayer(app);
  const vfx = {
    projectile: (from, to, kind) => throwProjectile(app, from, to, kind),
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

  // Is this walker leaving a trail? A live bleed is the obvious case; so is
  // being badly enough hurt that you're dripping without a status saying so.
  const isBleeding = (s) => hasStatus(s, 'bleed') || s.hp <= Math.max(1, s.maxHp * 0.3);

  // What a hurting floor looks like when it bites: the burst matches the
  // hazard the tile actually IS right now (fire beats electrified beats the
  // painted surface), so a paper cut throws shreds and live water throws
  // sparks without either side hard-coding the other's list.
  function surfaceImpactKind(x, z) {
    if (runtime.isBurning(x, z)) return 'fire';
    if (grid.isElectrified(x, z)) return 'zap';
    const surf = runtime.surfaceAt(x, z);
    if (surf === 'paper') return 'paper';
    if (surf === 'cable') return 'zap';
    return 'slam';
  }

  // One tile entered, one print left (or not) - the bookkeeping of which foot
  // and how bloody the sole still is lives in fx.js, keyed by the actor.
  function leaveFootprint(actor, s, x, z) {
    if (!actor?.entity) return;
    const surf = runtime.surfaceAt(x, z);
    vfx.footstep(actor, x, z, {
      bleeding: isBleeding(s),
      surface: surf,
      onPaper: surf === 'paper',
    });
  }

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
      * (statusFx(m.sheet).speedMult ?? 1);
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
    // Where everybody on your side already IS, or is already walking to. The
    // parking spots below are picked with `isWalkable`, which is deliberately
    // pass-through for the party (so a follower can route THROUGH a teammate) -
    // but routing through one and parking on one are different questions, and
    // asking the movement predicate got the second one wrong. A follower
    // already standing beside the leader has no reason to repath, so it never
    // reached the old claim set at all, and the next follower cheerfully
    // picked the tile it was standing on.
    const claimed = new Set();
    const claim = (a) => {
      if (!a) return;
      claimed.add(Math.round(a.x) + ',' + Math.round(a.z));
      const dest = a.path?.[a.path.length - 1];
      if (dest) claimed.add(Math.round(dest[0]) + ',' + Math.round(dest[1]));
    };
    for (const m of party.members) if (m.sheet.hp > 0) claim(m.actor);
    for (const s of summons) if (s.sheet.hp > 0) claim(s.actor);
    for (const m of party.members) {
      if (m === lead || !m.actor?.entity || m.sheet.hp <= 0) continue;
      m.followT = (m.followT ?? 0) - dt;
      if (m.followT > 0) continue;
      m.followT = 0.25;
      const dist = Math.max(Math.abs(m.actor.x - lead.actor.x), Math.abs(m.actor.z - lead.actor.z));
      if (dist <= FOLLOW_NEAR) continue; // near enough - let any walk finish
      // Through the party, around everything else - which is exactly
      // isWalkable. Spelling it out again here meant a change to what blocks
      // movement would silently miss the followers (never re-implement it).
      const open = isWalkable;
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
        || summonAt(x, z)
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
    // Player-team summons walk their combat paths and animate like a member;
    // each one's tile effects run against its own sheet (onSummonStep). They
    // only exist mid-fight, so there's no wander to gate.
    for (const s of summons) {
      s.actor.update(dt, (x, z, done, changed) => onSummonStep(s, x, z, done, changed));
    }
    for (const npc of npcs) npc.update(dt); // idle in place, ease their facing
    // The bottom narrator box gets general narration only when nothing else
    // owns the bottom of the screen: not mid-fight (combat has its own log),
    // not mid-conversation (the dialogue panel is up), not pre-class-pick.
    // The narration box stays up in combat and in conversation now: examine
    // text and incidental narration used to vanish entirely during both, which
    // is what made every examine description look broken.
    ui.setNarrationGate(!!sheet && !gameOver);
    // Persistent hotbar: visible only when it can act; ammo counts refresh
    // when they change (the gate keeps DOM writes off the hot path). Armed
    // out-of-combat target rings redraw each frame, like combat's own.
    if (hotbar) {
      // Visible whenever it can act - which now includes a fight. Hiding it in
      // combat was what forced combat.js to build a second bar, and cost the
      // fight the layout, the pager, the item slots and the number keys.
      const show = !!sheet && !gameOver && !modalOpen();
      hotbar.setVisible(show);
      const bs = barSheet();
      if (show && bs && bs.paper !== hotbarPaper) { hotbarPaper = bs.paper; hotbar.refresh(bs); }
      // Item slots count the pockets, and the pockets change from places that
      // don't route through onBagChange (god mode, a shop, an overflow drop).
      // Same shape as the party bar's key below: compare, repaint on a change.
      if (show && bagKey() !== hotbarBagKey) refreshHotbarSlots();
      // What an armed slot rings depends on what it aims at: a coworker (every
      // attack, shove and throw) or a spot on the floor (a summon).
      if (show && !inCombat && armedOoc) {
        if (ACTIONS[armedOoc].type === 'summon') hover.drawSummonDrop();
        else if (ACTIONS[armedOoc].cone) hover.drawConeAim();
        else hover.drawArmedTargets();
      }
    }
    // Ctrl rings redraw each frame while held (immediate-mode lines last one
    // frame) - in and out of combat alike.
    if (hover.ctrlHeld && sheet && !gameOver) hover.drawCharacterRings();
    // Same deal for the out-of-combat reach ring: immediate-mode, so it has to
    // be reissued every frame it's meant to be visible.
    if (hover.glowHeld && sheet && !inCombat && !gameOver && !modalOpen()) hover.drawReachRing();
    // Party bar: redraw only when the roster state changes (names/HP/active,
    // plus per-member AP mid-fight); visible only once there's an actual
    // party to show.
    if (party) {
      const cp = inCombat && combat ? combat.party : null;
      const key = party.members
        .map((m, i) => `${m.sheet.name}:${m.sheet.hp}/${m.sheet.maxHp}${i === party.active ? '*' : ''}${cp ? ':' + cp[i].ap : ''}:${m.sheet.attrPoints || 0}/${m.sheet.classPoints || 0}p`)
        .join('|');
      if (key !== partyBarKey) { partyBarKey = key; partyBar.refresh(party, cp); }
      partyBar.setVisible(party.members.length > 1 && !gameOver);
      // The HUD level-up pip tracks the leader's banked points, out of combat.
      levelUpPip.refresh(!inCombat && !gameOver && !modalOpen() && sheet ? pending(sheet) : 0);
    }
    // Fire/smoke age in TURNS. In combat, combat.js advances one per round (via
    // the onRound callback in beginCombat). Out of combat there are no rounds, so
    // a real-time clock stands in - about one turn per OOC_TURN_SECONDS.
    if (!gameOver && !inCombat) {
      oocTurnClock += dt;
      while (oocTurnClock >= OOC_TURN_SECONDS) {
        oocTurnClock -= OOC_TURN_SECONDS;
        runtime.advanceTurn();
        ageSummons(); // temps you brought out of the last fight are on the clock
        // ...and so is the litter a power dropped. This clock stands in for
        // combat's rounds, so it has to spend everything a round spends (see
        // the onRound callback): without it, a Bulk Mail drift laid in the last
        // round of a fight froze mid-countdown the moment the fight ended -
        // permanently repainting the floor, permanently cutting anyone who
        // crossed it, and leaving a paper pile you could harvest forever.
        ageTempSurfaces();
      }
    }
    animateSurfaces(dt);
    // Live statuses wear their look: embers off a burning coworker, drips off
    // a bleeding one, motes circling whoever is stuck in mandatory training.
    // What each one emits is DATA (`fx` on the status, data/statuses.js); this
    // only reports who is carrying what. The tracker throttles itself, and
    // only asks for the roster on the frames it emits on.
    if (!gameOver) auras.sync(dt, collectStatusCarriers);
    // Impaired sight, off whoever you are STEERING - in a fight that's the
    // member whose turn it is (combat.actingSheet stays pointed at the last
    // party-side body even on the AI's turn, which is right: you are still
    // looking through their eyes while the coworkers move), out of one it's the
    // leader. A blinded companion you are not driving costs you their accuracy,
    // not your screen.
    const steered = inCombat && combat ? combat.actingSheet : sheet;
    const impair = !gameOver && steered ? statusFx(steered) : null;
    vision.set(impair?.aimSway || 0, impair?.sightBlots || 0);
    vision.update(dt);
    // A drifting aim goes stale the moment the mouse stops, so re-ask the world
    // what the crosshair is on. hover.js's rule is that the preview IS the
    // click, and the click is sampling a sway that never stops moving.
    if (vision.strength > 0) controls.refreshHover();
    // The loot overlay tracks the world while held (the camera keeps easing).
    if (loot.labelsVisible) {
      loot.repositionLabels((w) => {
        const s = worldToScreenCss(controls.cameraEntity, w.x, w.y, w.z);
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
      // This IS the "new character" escape hatch CHARACTER_PLAN #17 asked for.
      // A separate menu item was drafted and then dropped: clearing progress
      // drops the character with it - the sheet lives in the save - so the two
      // would have been byte-identical actions under different labels, which is
      // worse than one honest one. A meaningful "same character, floor one"
      // needs run state to separate from character state first.
      id: 'menu-restart',
      label: 'Restart run',
      action: () => {
        clearProgress();
        localStorage.removeItem(STASH_KEY);
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
    beginRun(createCharacter(createDraft(preselectedClass())));
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
    // Test hook: jump straight to the fully zoomed-out tactical view (setView
    // clamps to the rig's maxDist). The e2e suite used to do this with eight
    // mouse-wheel events per test, and every one forced a camera apply plus a
    // re-render - ~45 SECONDS per test under CI's software GL, in every single
    // test. One apply does the same job.
    zoomOut: () => controls.setView({ dist: 1e4 }),
    // The class registry, read-only. Exposed so a test can assert a created
    // character AGAINST its class headline rather than restating the numbers -
    // a test that hardcodes 6 breaks on every balance pass for no reason.
    get classes() { return CLASSES; },
    get playerTile() { return { x: player.x, z: player.z }; },
    // Is the leader mid-walk? The suite's honest alternative to sleeping: a
    // spec that wants "and then nothing happens" can poll for stillness rather
    // than guess a duration, which under software GL is reliably either too
    // short or wasteful on different runs.
    get playerMoving() { return !!player?.moving; },
    get playerPos() {
      const p = player.entity?.getPosition();
      return p ? { x: p.x, z: p.z } : { x: player.x, z: player.z };
    },
    // Where the camera actually sits, for tests that assert on the framing
    // (the tactical view collapses the horizontal offset to ~nothing).
    get cameraPos() {
      const c = controls.cameraEntity.getPosition();
      return { x: c.x, y: c.y, z: c.z };
    },
    // World point -> CSS-pixel screen point, so tests can click precise
    // ground points (mouse events arrive in CSS pixels).
    project(x, z) {
      const s = worldToScreenCss(controls.cameraEntity, x, 0, z);
      return { x: s.x, y: s.y };
    },
    // Project an arbitrary world point (y too), so tests can aim at a tall
    // mesh - a door panel, an enemy's body - not just the floor under it.
    project3(x, y, z) {
      const s = worldToScreenCss(controls.cameraEntity, x, y, z);
      return { x: s.x, y: s.y };
    },
    get inCombat() { return inCombat; },
    get gameOver() { return gameOver; },
    // Which floor is under you. The campaign transition is the one seam where
    // that changes, and a spec crossing it has no other way to tell level2 from
    // level1 once the page has reloaded into it.
    get levelId() { return activeLevelId; },
    get lastPath() { return lastPath; },
    get fadedWallCount() { return walls.filter((w) => w.faded).length; },
    get stats() {
      // gum/bleed now live in the status map; expose them as counts so the
      // debug/e2e reads (window.__game.stats.gum) keep working.
      return sheet ? { ...sheet, gum: statusLeft(sheet, 'gum'), bleed: statusLeft(sheet, 'bleed') } : null;
    },
    get playerSpeed() { return player.speed; },
    get burning() { return runtime.burningCount; },
    get smoking() { return runtime.smokingCount; },
    isSmoke: (x, z) => runtime.isSmoke(x, z),
    losClear: (ax, az, bx, bz) => hasLos({ x: ax, z: az }, { x: bx, z: bz }),
    get inventory() { return sheet ? [...sheet.inventory] : []; },
    get cash() { return party?.cash || 0; },
    get shopOpen() { return shopping.visible; },
    // A machine's remaining stock, by tile - the shop's answer to
    // containerLootAt, so a spec can assert a sold-out row without the DOM.
    shopStockAt: (x, z) => shopping.debug.stockAt(shopKey(x, z)),
    get looseItems() { return loot.debug.looseItems(); },
    get lootLabelCount() { return document.querySelectorAll('.loot-label').length; },
    containerLootAt: loot.debug.containerLootAt,
    get doors() { return [...grid.doors].map(([key, d]) => ({ key, open: d.open })); },
    surfaceAt: (x, z) => runtime.surfaceAt(x, z),
    // The TILE TYPE under a point, as the grid currently holds it. Terrain is
    // mutable - a printer that detonates becomes floor (grid.setType), a prop
    // that burns out is spent - and a spec has no other way to see that the
    // world actually changed rather than merely stopped burning.
    tileAt: (x, z) => grid.typeAt(x, z),
    // Terrain-only walkability - the full isWalkable would fold in whatever
    // body happens to be standing there. (The chunky fallen twins are SOLID
    // now - an object on its side, designer 2026-07-30 - so a topple spec
    // asserts the landing tile is NOT walkable; the flat ones, a downed
    // coat rack or partition, still are.)
    walkable: (x, z) => grid.terrainOpen(x, z),
    // The edge rule between two cells, for specs about partitions falling:
    // the tile grid alone cannot say whether the wall between two open tiles
    // is still standing.
    stepOpenAt: (x, z, nx, nz) => grid.stepOpen(x, z, nx, nz),
    // Is that door open? Doors sit on EDGES ('h:x,z' / 'v:x,z'), not tiles, so
    // `tileAt` can never answer this - and a door is the only piece of terrain
    // a fight can change, which is exactly what wants asserting.
    doorOpen: (key) => grid.doors.get(key)?.open ?? null,
    // Put a named coworker on an exact tile. A spec about what happens TO a
    // body standing somewhere (a bookcase landing on it, cover being measured
    // across it) otherwise has to wait for the AI to wander there, which makes
    // the spec a test of pathing instead of the thing it is about. pushTo is
    // the same glide a shove uses, so nothing about it is a special case.
    debugPlaceEnemy: (name, x, z) => {
      const en = enemies.find((e) => e.alive && e.def.name === name);
      if (!en) return false;
      en.clearPath();
      en.pushTo(x, z);
      return true;
    },
    get enemies() {
      return enemies.map((e) => {
        const p = e.entity?.getPosition();
        // `reachable`: is there a walk-up route from the leader to a tile
        // beside them right now? Sealed-in coworkers (behind walls + a closed
        // door) are unreachable, so a click on them does nothing - the e2e
        // suite uses this to avoid wasting engage attempts on them.
        const reachable = e.alive
          && (playerReaches(e) || !!bestApproachPath(e.x, e.z));
        // `moving`: is this body part-way through a walk? An AI unit still
        // moving at the top of its beat is what stops its turn from ending
        // (combat.js's driver returns early on it), so it is the one field
        // that separates "the fight is slow" from "the fight is stuck".
        // `charmed` distinguishes "alive" from "hostile", which is exactly the
        // distinction a victory test has to make - so the suite can see it.
        return { name: e.def.name, x: e.x, z: e.z, px: p?.x, pz: p?.z, alive: e.alive, reachable,
          charmed: !!e.charmed,
          moving: !!e.moving, level: e.def.level || 1, hp: e.hp, maxHp: e.maxHp };
      });
    },
    get npcs() { return npcs.map((n) => ({ name: n.def.name, x: n.x, z: n.z })); },
    get summons() {
      return summons.filter((s) => s.sheet.hp > 0)
        .map((s) => ({
          name: s.actor.def.name, x: s.actor.x, z: s.actor.z, hp: s.sheet.hp,
          turnsLeft: s.actor.summonTurns,
        }));
    },
    get party() {
      return party ? party.members.map((m, i) => ({
        name: m.sheet.name, hp: m.sheet.hp, maxHp: m.sheet.maxHp,
        level: m.sheet.level, attrPoints: m.sheet.attrPoints || 0,
        classPoints: m.sheet.classPoints || 0, perks: [...(m.sheet.perks || [])],
        x: m.actor?.x, z: m.actor?.z, active: i === party.active,
      })) : [];
    },
    // Is the overhead tactical view up? (rail button / T key, for the e2e suite)
    get tactical() { return controls.tactical; },
    // Out-of-combat targeting + hover state, for the e2e suite.
    get armed() { return armedOoc; },
    get hoverKind() { return hover.hoverKind; },
    // The narration box's lines, newest last - for the e2e suite.
    get narration() { return ui.narrationLog(); },
    // What Examine would say about a tile, without opening a menu to find out.
    examineTile: (x, z) => examineTile(x, z),
    get ctrlHeld() { return hover.ctrlHeld; },
    // Is the hover body-glow actually LIT right now? (a tracked target, plus
    // either a held modifier or being in combat - the two halves of the gate)
    get hoverGlow() { return hover.glowing; },
    get cursor() { return canvasEl ? canvasEl.style.cursor : ''; },
    // Impaired sight (vision.js): how hard the aim is swaying, how far off the
    // mouse it currently is, and the verb the swaying reticles are wearing.
    get vision() { return vision.debug; },
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
    // The purse is party state (ECONOMY_PLAN #2), so it gets its own live
    // setter rather than hiding on a sheet card. Clamped at zero by addCash.
    get cash() { return party?.cash || 0; },
    setCash(n) {
      if (!party) return 0;
      party.cash = Math.max(0, Math.floor(Number(n) || 0));
      loot.refreshPanel(sheet);
      return party.cash;
    },
    switchTo(i) {
      if (!inCombat) switchLeader(i); // in combat, initiative controls the turn - no manual switch
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
    // Read an action's AP cost from the registry - so a test can assert
    // "affordable" without hardcoding a number that re-pricing would stale.
    actionAp: (id) => ACTIONS[id]?.ap ?? null,
    // Take a class-track node on a sheet, through the same function the
    // level-up screen calls - so a test exercises the real path rather than
    // hand-writing talent effects the game would never produce.
    spendClassPoint: (sheet, nodeId) => spendClassPoint(sheet, nodeId),
    get doors() { return [...grid.doors].map(([key, d]) => ({ key, open: d.open })); },
    setDoorOpen(key, open) {
      if (!grid.doors.has(key)) return;
      grid.setDoorOpen(key, open);
      scene.refreshDoor(key);
      for (const e of enemies) e.clearPath(); // their routes may have changed
    },
    // Resolves an ENEMY_TYPES id or a class archetype (e.g. 'applicant'), so a
    // tester can drop class-based units to feel out balance.
    spawnEnemy(typeId, x, z) {
      const base = ENEMY_TYPES[typeId] || CLASSES[typeId];
      if (!base) return null;
      const def = scaleEnemy(base, effectiveLevel(base, floorDepth)); // match the floor
      const en = new EnemyActor(x, z, typeId, def);
      enemies.push(en);
      placeModel(app, `assets/characters/${def.model}.glb`, x, z, {
        lift, rotY: -90, animate: true,
        onReady: (e) => { dressUp(e, en, def.look, def.model); picking.register(e, 'enemy', en); },
      });
      return en;
    },
    // Drop a player-team summon beside the active member (combat only) - the
    // console-side twin of the HR class's Post the Role, for tuning.
    // `lifetimeTurns` null = permanent, a number = turns of assignment before
    // the applicant files out (the tuning knob milestone 4 left open).
    summonAlly(archetypeId = 'applicant', n = 1, lifetimeTurns = null) {
      return window.__combat ? window.__combat.summonAlly(archetypeId, n, lifetimeTurns) : 0;
    },
    giveItem(id) {
      if (!sheet) return;
      sheet.inventory.push(id);
      loot.refreshPanel(sheet);
      paintHud(sheet);
    },
    dropItem(id, x, z) { loot.dropAt(x, z, id); },
    // Clean out a merchant in one step (ECONOMY_PLAN): the same end state as
    // buying every row, for looking at the sold-out presentation without
    // spending nine clicks getting there.
    emptyShop(x, z) { shopping.emptyStock(shopKey(x, z)); },
    teleport(x, z) {
      if (!player.entity) return;
      const p = player.entity.getPosition();
      player.clearPath();
      player.entity.setPosition(x, p.y, z);
      player.x = Math.round(x);
      player.z = Math.round(z);
    },
    refreshHud() { if (sheet) { paintHud(sheet); loot.refreshPanel(sheet); } },
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
