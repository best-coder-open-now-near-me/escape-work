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
import { findPath, smoothPath, routeOpen, segmentClear, clampToClearance, approachPoint, routeToFiringPosition, DIRS8 } from './pathfinding.js';
import { seesBody, coneBoundary, deriveFacing } from './stealth.js';
import {
  createSheetFrom, applyDamage, spendAttrPoint, spendClassPoint, grantTalent, classTrack,
  scaleEnemy, effectiveLevel, damageBonus, deflect, trackNode, PAPER_CAP, EQUIP_SLOTS, equippedAction, equippedStats,
  orderedActionIds, reachOf, rangeOf, ammoCostOf, pendingPoints as pending, spendablePoints,
  lookOf, stairwellHeal, REACH, STEALTH,
} from './stats.js';
import {
  createParty, leader as partyLeader, addMember, gainXpAll, createCompanionSheet,
  serializeProgress, parseProgress, PARTY_CAP, addCash,
} from './party.js';
import { applyStatus, removeStatus, statusFx, hasStatus, tickStep, tickTurn, statusLeft, statusList } from './statuses.js';
import { createDraft, createCharacter, draftModel, draftLook } from './creation.js';
import { CUSTOM_RIGS } from './data/looks.js';
import { aimsAtAlly, coneFrom, conePolyline, isToppleable, toppleLanding } from './powers.js';
import { PARTITION_TOPPLE, blocksSight } from './data/tiles.js';
import { shieldedFaces } from './tactics.js';
import { PlayerActor, EnemyActor, NpcActor, CompanionActor } from './actors.js';
import { COMPANIONS } from './data/companions.js';
import { createApp, buildLevel, buildLayeredLevel } from './scene.js';
import { createCombatWorld } from './combat-world.js';

import { loadRemoteStore, SAVE_KEY_STORAGE } from './remote-store.js';
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
import {
  surfaceEffect, rawSurfaceDamage, effectiveSurfaceDamage, slipChance, slips,
  hasGum, surfacePathCost, impactKindFor,
} from './step-rules.js';
import { createDoors, atDoor, COMBAT_DOOR_AP, doorMidpoint } from './doors.js';
import { createDialogue, shopKeyForNpc, sayRecruited } from './dialogue.js';
import { summonRange, summonRoom, dropCount, summonSpotProblem } from './summon-rules.js';
import {
  actionIdsFor, itemCountsFor, layoutFor, assignInto, slotViewModel, combatSlotViewModel,
  combatOnlyReason,
} from './hotbar-model.js';
import { startCombat } from './combat.js';
import { verbSides } from './combat-targeting.js';
import { cheb as chebOf, canReach as canReachAt } from './combat-geometry.js';
import { startEditor } from './editor.js';
import { NPCS } from './data/npcs.js';
import { installGodMode } from './god.js';
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
    let a = (Number(s) >>> 0) || 1;
    combatRng = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
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

// The floor-select desk: a plain fresh visit picks a level BEFORE a character
// (designer, 2026-08-01: "lets add a pre character selection menu with level
// selection"). Express lanes skip it - #class= boots (the e2e suite's fast
// path), #editor, ?level=, and editor playtest stashes all already said which
// level they mean. A saved campaign shows Continue on top; picking any floor
// instead starts fresh, and only the campaign's first floor writes progress.
//
// TWO runs can be on offer at once - this browser's, and the one the cloud
// save key points at - and the player picks (designer, 2026-08-03: "the
// recommended option A is fine for persistence"). The desk used to suppress
// the cloud lookup entirely whenever a local save existed, so the phrase's run
// was never read and the first floor this browser cleared pushed over it. Each
// offer gets its own button id and says which run it is, floor and age, so
// they can be told apart.
const AGE_UNITS = [[86400e3, 'day'], [3600e3, 'hour'], [60e3, 'minute']];
function describeAge(stamp) {
  if (!Number.isFinite(stamp) || stamp <= 0) return '';
  const ms = Date.now() - stamp;
  if (ms < 60e3) return ' — just now';
  for (const [size, unit] of AGE_UNITS) {
    const n = Math.floor(ms / size);
    if (n >= 1) return ` — ${n} ${unit}${n === 1 ? '' : 's'} ago`;
  }
  return '';
}
function showLevelMenu() {
  const overlay = document.createElement('div');
  overlay.id = 'level-menu';
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: 60, display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    background: 'rgba(4, 5, 12, 0.86)',
  });
  const panel = document.createElement('div');
  Object.assign(panel.style, {
    background: '#171923', border: '1px solid #33364a', borderRadius: '12px',
    padding: '22px 26px', minWidth: '340px', color: '#d7d9e4',
    fontFamily: 'Georgia, serif', boxShadow: '0 18px 60px rgba(0,0,0,0.55)',
  });
  panel.innerHTML = '<div style="font-size:20px; margin-bottom:4px;">Escape Work</div>'
    + '<div style="font-size:13px; opacity:0.65; margin-bottom:14px;">Pick a floor to report to.</div>';
  const button = (id, label, sub, onPick) => {
    const b = document.createElement('button');
    b.id = id;
    Object.assign(b.style, {
      display: 'block', width: '100%', textAlign: 'left', margin: '6px 0',
      padding: '10px 12px', background: '#20233199', color: '#d7d9e4',
      border: '1px solid #3a3d52', borderRadius: '9px', cursor: 'pointer',
      fontFamily: 'inherit', fontSize: '15px',
    });
    b.innerHTML = label + (sub ? `<span style="display:block; font-size:12px; opacity:0.6;">${sub}</span>` : '');
    b.onmouseenter = () => { b.style.background = '#2a2e42'; };
    b.onmouseleave = () => { b.style.background = '#20233199'; };
    b.onclick = onPick;
    panel.appendChild(b);
    return b;
  };
  const boot = (fn) => { overlay.remove(); fn(); };
  if (restoredProgress) {
    button('level-continue', 'Continue the run',
      `${LEVELS[restoredProgress.levelId]?.name || restoredProgress.levelId} — this browser`
        + describeAge(restoredProgress.savedAt),
      () => boot(() => startGame(activeLevel)));
  }
  for (const [id, level] of Object.entries(LEVELS)) {
    button(`level-pick-${id}`, level.name || id,
      id === FIRST_LEVEL ? 'Start a fresh run' : (level.layers ? 'Dev — layered spike' : 'Standalone visit'),
      () => boot(() => {
        activeLevel = LEVELS[id];
        activeLevelId = id;
        // Fresh start: a restored party must not walk into a hand-picked
        // floor. Off the campaign's first floor nothing writes progress -
        // the ?level= posture, chosen by click instead of URL.
        restoredProgress = null;
        playtesting = id !== FIRST_LEVEL;
        startGame(activeLevel);
      }));
  }
  // The save key (shown only when the cloud is configured): a private phrase
  // that becomes this player's cloud identity - hashed locally, never sent
  // raw - so nobody else's device stomps their rows, and the same phrase on
  // another machine picks the same saves up. Changing it reboots the desk so
  // the cloud lookup below re-runs under the new identity.
  if (remote.enabled) {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex', gap: '6px', marginTop: '14px', paddingTop: '12px',
      borderTop: '1px solid #2b2e40', alignItems: 'center',
    });
    const input = document.createElement('input');
    input.id = 'save-key-input';
    input.type = 'password';
    input.placeholder = localStorage.getItem(SAVE_KEY_STORAGE)
      ? 'cloud save key is set — enter a new one to change it'
      : 'cloud save key (optional) — saves follow it anywhere';
    Object.assign(input.style, {
      flex: '1', padding: '8px 10px', background: '#12141d', color: '#d7d9e4',
      border: '1px solid #3a3d52', borderRadius: '8px', fontFamily: 'inherit', fontSize: '13px',
    });
    const set = document.createElement('button');
    set.id = 'save-key-set';
    set.textContent = 'Set';
    Object.assign(set.style, {
      padding: '8px 14px', background: '#20233199', color: '#d7d9e4', cursor: 'pointer',
      border: '1px solid #3a3d52', borderRadius: '8px', fontFamily: 'inherit', fontSize: '13px',
    });
    const apply = () => {
      try {
        const key = input.value.trim();
        // An empty Set with a key stored is a deliberate clearing - back to
        // this-browser-only saves. An empty Set with nothing stored is a no-op.
        if (key) localStorage.setItem(SAVE_KEY_STORAGE, key);
        else if (localStorage.getItem(SAVE_KEY_STORAGE)) localStorage.removeItem(SAVE_KEY_STORAGE);
        else return;
        location.reload();
      } catch { /* private mode: the key has nowhere to live */ }
    };
    set.onclick = apply;
    input.onkeydown = (e) => { if (e.key === 'Enter') apply(); };
    row.appendChild(input);
    row.appendChild(set);
    panel.appendChild(row);
  }
  // A cloud save can land after the desk is up: this device pushed a run
  // before, or the browser was rebuilt, or the phrase belongs to a run made
  // somewhere else entirely. Offer it as its own Continue; clicking banks it
  // locally and reboots through the restore path that already knows how to
  // rebuild a party.
  //
  // The pull runs whether or not there is a local save. It used to be gated on
  // `!restoredProgress`, which is what made the cloud copy invisible to the
  // one browser most likely to overwrite it (Q017).
  if (remote.enabled) {
    remote.pull().then((row) => {
      if (!row?.data || !document.getElementById('level-menu')) return;
      if (document.getElementById('level-continue-cloud')) return;
      // Validate with the BOOT path's own check before offering it. The
      // button banks the row and reloads, and boot then runs
      // `parseProgress` + `LEVELS[levelId]` over it - so a row this build
      // cannot read (an older save naming a level id since renamed) came back
      // to the desk with no error and no run booted, and clicking again did
      // the same thing forever (Q067). Asking the same two questions here
      // means the offer only appears when accepting it will work.
      const p = parseProgress(row.data);
      if (!p || !LEVELS[p.levelId]) return;
      // `updatedAt` is the row's own stamp and beats anything inside the save
      // blob; `savedAt` is the fallback for rows written before saves carried
      // one. And when a local run is ALSO on offer, the sub-label says what
      // taking this one costs - banking it is what replaces the local save,
      // and the player is the one choosing that.
      const age = describeAge(Date.parse(row.updatedAt) || p.savedAt);
      const b = button('level-continue-cloud',
        restoredProgress ? 'Continue the cloud run' : 'Continue the run',
        `${LEVELS[p.levelId].name || p.levelId} — your save key${age}`
          + (restoredProgress ? ' · replaces this browser\'s run' : ''),
        () => {
          // The reload used to sit OUTSIDE this try, so a browser that can
          // read but not write - quota gone, private mode - reloaded onto a
          // desk with nothing banked, the same loop by the other door. Say so
          // and stay put instead.
          try {
            localStorage.setItem(PROGRESS_KEY, JSON.stringify(row.data));
          } catch {
            ui.toast('This browser cannot store a save - the cloud run stays in the cloud.');
            return;
          }
          location.reload();
        });
      // Above the floor list, and BELOW the local Continue when there is one -
      // the run this browser is already in the middle of stays the top offer.
      panel.insertBefore(b, panel.children[restoredProgress ? 3 : 2] || null);
    });
  }
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

if (location.hash.includes('editor')) {
  // The editor speaks single-storey levels; hand it the ground storey of a
  // layered one rather than crashing on level.layers.
  startEditor(app, activeLevel.layers
    ? { ...activeLevel, ...activeLevel.layers[0], layers: undefined }
    : activeLevel, STASH_KEY);
} else if (!playtesting && !location.hash.includes('class=')) {
  showLevelMenu();
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
  let playerLayer = 0; // which storey the leader is on
  const grid = floors ? layeredGrid(floors, level, () => playerLayer) : parseLevel(level);
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
  // Enemies scale to the floor's depth (stats.js) - a base coworker on a deep
  // floor is tougher. A placement may also name its own tier (`"G":
  // "manager@3"`), which is how a shallow floor asks for one harder body
  // without a second registry entry existing to BE the harder one. Either way
  // it is the same scaleEnemy doing it: there is one curve, and a level picks a
  // point on it rather than hand-writing a rival to it.
  const floorDepth = level.depth || 1;
  const enemies = grid.enemySpawns.map((s) => {
    const base = ENEMY_TYPES[s.type];
    const lvl = s.level ?? effectiveLevel(base, floorDepth);
    return new EnemyActor(s.x, s.z, s.type, scaleEnemy(base, lvl));
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
  // Cross-storey walking (layered levels): queued route legs, and the climb
  // currently riding the stairs if any. Inert on flat levels.
  const legQueue = [];
  let climbAnim = null;
  let pendingAction = null; // walk-up interaction, runs on arrival
  let armedOoc = null; // hotbar action armed OUT of combat (a coworker, or a spot)
  // The leader's out-of-combat crouch (TACTICS_PLAN M6 OOC): { x, z, edges,
  // at } in the same shape combat stores, so beginCombat can hand it straight
  // to startCombat's preCrouch and the fight starts with the leader already
  // tucked in. Any deliberate walk or leader change clears it.
  let oocCrouch = null;
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
  // employees show themselves out.
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
    grid.setType(x, z, 'floor');
    scene.hideSurfaceVisual(x, z);
    return true;
  };
  // Dangerous/uncomfortable surfaces cost extra to path through, so
  // characters route around them unless told otherwise or there is no other
  // way; smoothing must never straighten a route through a damaging cell the
  // route avoided. The player and enemies get separate cost models - talents
  // discount only the player's.
  const hazardCostFor = (ms) => (x, z) => surfacePathCost(floorAt(x, z), ms?.talent?.effects);
  const hazardCost = (x, z) => hazardCostFor(sheet)(x, z); // the leader's cost model
  // The enemy model is the same rule with NO talents - your shoes are not
  // their problem, and passing the leader's would have them fearing exactly
  // the tiles you are immune to.
  const enemyHazardCost = (x, z) => surfacePathCost(floorAt(x, z));
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
  // Drop a power's surface on bare floor: grid, visual and the litter clock in
  // one write. Combat's world callback and the out-of-combat cone both land
  // here, so a drift laid with no fight on ages and reverts exactly like one
  // laid mid-round - two copies of this rule is how the two would drift.
  function leaveSurfaceAt(x, z, tileType, turns = 0) {
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
    gameOver = true;
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
    clearOocCrouch(true); // the crouch belongs to the sheet that took it
    party.active = i;
    sheet = m.sheet;
    player = m.actor;
    controls.recenter(); // the survivor stepping up is who the view should find
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
    clearOocCrouch(true);
    sheet = lead.sheet;
    player = lead.actor;
    controls.recenter(); // control settled on them - a panned-away view follows
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
    // Summons stand beside a printer like anyone else. They were invisible to
    // both loops above - a player-team summon is filed in `summons`, which is
    // neither `enemies` nor `party.members` - so a blast that flattened the
    // whole party left the conjured coworker next to it untouched. One that
    // runs out of HP is DISMISSED rather than downed: no body, no loot, and
    // nothing for downOrLose to weigh, because a summon is not somebody the
    // run can be lost with (dismissSummon).
    const spent = [];
    for (const s of summons) {
      if (!s.actor?.entity || s.sheet.hp <= 0) continue;
      if (Math.abs(s.actor.x - x) > 1 || Math.abs(s.actor.z - z) > 1) continue;
      const gone = applyDamage(s.sheet, EXPLOSION_DAMAGE);
      s.actor.flinch();
      vfx.impact(s.actor.x, s.actor.z, 'slam');
      vfx.damageText(s.actor.x, s.actor.z, `-${EXPLOSION_DAMAGE}`);
      msg += ` ${s.sheet.name} catches shrapnel. -${EXPLOSION_DAMAGE} HP.`;
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
  function smoothFromBody(p, actor = player, extraClear = null) {
    const pos = actor.entity?.getPosition();
    if (pos) p = [[pos.x, pos.z], ...p.slice(1)];
    const base = extraClear
      ? (x, z) => isWalkable(x, z) && extraClear(x, z)
      : clearOfHazards;
    return smoothPath(routeOpen(base, p), p, grid.edgeOpen);
  }
  // Where the body may actually stand: the exact clicked point, pulled in
  // from walls/partitions so the model never clips them.
  const clampPoint = (x, z) => clampToClearance(grid.terrainOpen, grid.edgeOpen, x, z);
  // Walk-up landing spot: at reach of the target's body inside goal tile
  // (gx, gz), instead of the tile's dead centre.
  const approachTo = (gx, gz, tx, tz) => approachPoint(grid.terrainOpen, grid.edgeOpen, gx, gz, tx, tz);

  // The out-of-combat crouch ends the way the in-combat one does: the moment
  // a deliberate walk begins (moveTo / approachAndDo / walkToExact), or when
  // the leader changes hands. `quiet` skips the line for handoffs where the
  // crouch is being consumed rather than abandoned.
  function clearOocCrouch(quiet = false) {
    legQueue.length = 0; // a deliberate walk abandons any queued storey route
    if (!oocCrouch) return;
    oocCrouch = null;
    removeStatus(sheet, 'covered');
    if (player) player.crouched = false; // stand the body up (actors.js)
    if (!quiet) ui.say('You come out of cover.');
  }

  // Walk to EXACTLY (x, z), then run - the crouch and the partition shove
  // need a precise standing spot, where approachAndDo's "within reach" would
  // settle for a diagonal that shields (or shoves) nothing.
  // `end` is an optional FREE POINT inside the goal tile to finish on - the
  // same last-waypoint substitution every plain ground click already does.
  // The arrival check reads the logical tile, and a clamped point always
  // rounds back to its own tile, so `exact` still means exact.
  function walkToExact(x, z, run, end = null) {
    if (!sheet || inCombat || gameOver || climbAnim) return false;
    clearOocCrouch();
    if (player.x === x && player.z === z) { run(); return true; }
    const p = findPath(isWalkable, player.x, player.z, x, z, hazardCost, grid.stepOpen);
    if (!p || p.length < 2) return false;
    pendingAction = { x, z, run, exact: true };
    if (end) p[p.length - 1] = end;
    const s = smoothFromBody(p);
    player.setPath(s);
    lastPath = s;
    return true;
  }

  // Walk within reach of (x, z), then run the interaction.
  function approachAndDo(x, z, run) {
    if (!sheet || inCombat || gameOver || climbAnim) return;
    clearOocCrouch();
    // Rummaging, talking, shopping, looting: seeing to it ends the sneak
    // (SNEAK_PLAN D10). Doors stay exempt - they go through their own path,
    // and a sneak that ends at every door is no sneak in an office.
    const act = () => {
      if (sneak) endSneak('No staying quiet through this.');
      run();
    };
    if (Math.abs(player.x - x) <= 1 && Math.abs(player.z - z) <= 1) {
      act();
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
    pendingAction = { x, z, run: act };
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
    if (!tile || !sheet || inCombat || gameOver || climbAnim || !isWalkable(tile.x, tile.z)) return;
    clearOocCrouch(); // a deliberate walk is the one thing a crouch never survives
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

  // --- layered-storey walking (EDITOR_PLAN feasibility spike) ---------------
  // Click resolution against the visible storeys, cross-storey routing, and
  // the scripted stair climb. All of it is inert on flat levels.
  const walkableOn = (l) => (x, z) =>
    floors.layers[l].terrainOpen(x, z)
    // Bodies live on the ground storey only for now (parseFloors refuses
    // actors above it), so a mezzanine tile can't be blocked by a coworker
    // standing UNDER it.
    && (l !== 0 || (!enemyAt(x, z) && !npcAt(x, z)));
  // Screen point -> the topmost VISIBLE storey with real floor under the
  // pixel. Scanning top-down is what makes "you click what you see" true:
  // a cutaway-hidden storey never eats a click aimed at the floor below it,
  // and open air over the atrium falls through to the lobby floor.
  function layeredPick(sx, sy) {
    const cam = controls.cameraEntity.camera;
    const near = new pc.Vec3();
    const far = new pc.Vec3();
    cam.screenToWorld(sx, sy, cam.nearClip, near);
    cam.screenToWorld(sx, sy, cam.farClip, far);
    const dir = far.sub(near);
    if (Math.abs(dir.y) < 1e-6) return null;
    for (let l = floors.layers.length - 1; l >= 0; l--) {
      if (!scene.layerVisible(l)) continue;
      const t = (floors.baseY[l] - near.y) / dir.y;
      if (t < 0) continue;
      const px = near.x + dir.x * t;
      const pz = near.z + dir.z * t;
      const tx = Math.round(px);
      const tz = Math.round(pz);
      const g = floors.layers[l];
      if (tx < 0 || tx >= g.width || tz < 0 || tz >= g.height) continue;
      if (g.typeAt(tx, tz) === null) continue; // open air - the storey below owns this pixel
      return { tile: { x: tx, z: tz }, point: { x: px, z: pz }, layer: l, stair: floors.stairAt(l, tx, tz) };
    }
    return null;
  }
  // Send the leader to a tile on another storey: within-storey walks chained
  // through stair climbs, planned as one route so the click either commits
  // to a whole path or honestly refuses.
  function walkToLayer(tile, point, layer) {
    if (!sheet || inCombat || gameOver || climbAnim) return;
    clearOocCrouch(); // also clears any queued legs
    pendingAction = null;
    const route = planCrossLayerRoute(floors,
      { x: player.x, z: player.z, layer: playerLayer },
      { x: tile.x, z: tile.z, layer },
      walkableOn,
      // Surface-hazard avoidance is the leader's cost model on their own
      // storey; other storeys route on distance alone for now.
      (l) => (l === playerLayer ? hazardCost : null));
    if (!route) { ui.say('No way to get there from here.'); return; }
    const last = route.legs[route.legs.length - 1];
    if (point && last.kind === 'walk' && last.path.length > 1) {
      const g = floors.layers[last.layer];
      last.path[last.path.length - 1] = clampToClearance(g.terrainOpen, g.edgeOpen, point.x, point.z);
    }
    legQueue.push(...route.legs);
    startNextLeg();
  }
  // A click on a stair run means "take the stairs": up from its own storey,
  // back down from the one above.
  function routeViaStair(stair) {
    if (playerLayer === stair.upper) walkToLayer({ x: stair.entry.x, z: stair.entry.z }, null, stair.layer);
    else walkToLayer({ x: stair.top.x, z: stair.top.z }, null, stair.upper);
  }
  function startNextLeg() {
    const leg = legQueue.shift();
    if (!leg) return;
    if (leg.kind === 'walk') {
      if (leg.path.length < 2) { startNextLeg(); return; }
      const g = floors.layers[leg.layer];
      // The body's REAL position goes in BEFORE the smoother, not after. A
      // walk starts wherever the last one left the body - a clamped point
      // off the tile centre - and splicing that in afterwards handed the
      // first run a start the corridor checks never saw, so the opening leg
      // could clip the wall the smoother had carefully cleared from the
      // centre. Feeding it in first makes the first run the one that gets
      // checked.
      const path = leg.path.map((p) => [p[0], p[1]]);
      const pos = player.entity?.getPosition();
      if (pos) path[0] = [pos.x, pos.z];
      const smoothed = smoothPath(walkableOn(leg.layer), path, g.edgeOpen);
      player.setPath(smoothed);
      lastPath = smoothed;
    } else {
      // The scripted climb: walk the straight line entry -> landing while the
      // update loop rides the body's height up the flight. The flat first
      // half-tile is the approach to the bottom step; the last is the landing.
      climbAnim = {
        sx: leg.from.x, sz: leg.from.z, run: leg.run, toLayer: leg.to.layer,
        y0: floors.baseY[leg.from.layer] + lift, y1: floors.baseY[leg.to.layer] + lift,
      };
      // Both storeys stay visible for the whole ride - the cutaway stands
      // down until the landing (see the update loop).
      scene.holdForClimb(leg.from.layer, leg.to.layer);
      player.setPath([[leg.from.x, leg.from.z], [leg.to.x, leg.to.z]]);
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
      // Under-promise the CIRCLE the arrival re-check measures (DEGRID D4):
      // a corner tile inside the old cheb square but outside the radius would
      // be walked to and then refused.
      hasLos: (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz) <= range
        && hasLos({ x: ax, z: az }, { x: bx, z: bz }),
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
      return test(bp.x, bp.z, 0.5) && hasLos(leadBody(), { x: bp.x, z: bp.z });
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
  // The rules live in doors.js on the shopping.js host-callback pattern; what
  // stays here is the wiring - what "the world changed" means, and who is
  // currently holding the fight.
  const doors = createDoors({
    grid,
    scene,
    loot,
    isInCombat: () => inCombat,
    isGameOver: () => gameOver,
    getCombat: () => combat,
    getPlayer: () => player,
    isWalkable,
    approachAndDo,
    onWorldChanged: () => {
      for (const e of enemies) e.clearPath(); // their routes may have just changed
      approachEpoch += 1; // ...and so may yours: the armed target rings recheck
    },
  });
  const { doorNearPoint, combatDoorAt, toggleDoor, approachDoor } = doors;

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
  function examineTile(tx, tz) {
    const def = grid.defAt(tx, tz);
    // TERRAIN, not walkability. `isWalkable` also refuses a tile somebody is
    // STANDING on, so examining the floor under a coworker fell through the
    // whole solid ladder below and came out as the last-resort "a cubicle
    // wall" - on plain carpet, because the floor def carries no label of its
    // own. What is underfoot does not change because somebody is on it.
    if (grid.terrainOpen(tx, tz)) {
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
    // "Does this armed verb point at a BODY" - asked of the one owner
    // (combat-targeting.verbSides), not re-derived. This was a hand-written
    // `attack || shove || purge` ladder, which is the same list `ringsAtBodies`
    // carried and the same way it went stale: `pull` was missing from both, so
    // an armed Pull Over clicked on a coworker out here fell straight past this
    // arm into the ordinary walk-up.
    if (a && verbSides(a, rangeOf(armedOoc)).enemies) {
      engageWithAction(en, armedOoc);
      return;
    }
    // A sneaking click on a coworker in reach IS the ambush strike (SNEAK
    // M4): the ordinary unarmed path starts fights by walking INTO people
    // (the adjacency trigger), and a sneaker deliberately never triggers on
    // proximity (D1) - so the click that would have bumped them swings
    // instead, and the fight opens on the ambusher's terms.
    if (sneak && playerReaches(en)) {
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
  const dialogue = createDialogue({
    panel: dialoguePanel,
    getParty: () => party,
    getPlayer: () => player,
    partyCap: PARTY_CAP,
    isRecruitable: (npc) => npc instanceof CompanionActor,
    isInCombat: () => inCombat,
    isGameOver: () => gameOver,
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
    sayRecruited(npc.def.name);
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
  // The bar's rules live in hotbar-model.js; these bind them to whoever's bar
  // is on screen. The DOM, the arming and the pager stay here.
  const hotbarActionIds = () => actionIdsFor(barSheet());
  const hotbarItemIds = () => itemCountsFor(barSheet());
  const layoutOf = (s) => layoutFor(s, ui.HOTBAR_ROW_SLOTS);
  // In a fight the numbers are combat's - the acting member's AP, uses and
  // paper. Out of one they are this file's. Same slot, same fields, two
  // rule-owners, which is the point of the bar being one widget instead of two
  // that drift.
  const slotVm = (entry) => ((inCombat && combat && entry?.kind === 'action')
    ? combatSlotViewModel(entry, combat.actionState(entry.id), combat.actingSheet.name)
    : slotViewModel(entry, barSheet()));

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
  // The slot a visible position REALLY is. While the reorg is on, the bar
  // draws and presses a shuffled order but the layout being rearranged is the
  // player's own - so right-clicking slot 3 used to open the assign menu for
  // whatever sat at true index 3, which under a scramble is a different slot
  // from the one under the cursor. Press and assign now agree on what "this
  // slot" means: press already read the drawn order, and assign maps through
  // the same permutation before it writes.
  const trueSlot = (i) => {
    if (!inCombat || !combat) return i;
    const order = combat.scrambleOrder(layoutOf(barSheet()).length);
    return order ? order[i] ?? i : i;
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
    // `i` is a position on the BAR; `slot` is the layout entry it stands for.
    // Everything the menu shows is read off the drawn order (so a hint sends
    // the player to the slot they can actually see), and only the write goes
    // through `trueSlot`.
    const layout = barLayout();
    const slot = trueSlot(i);
    const here = layout[i];
    const placedAt = (kind, id) => layout.findIndex((s) => s && s.kind === kind && s.id === id);
    const rowOf = (at) => Math.floor(at / ui.HOTBAR_ROW_SLOTS) + 1;
    const slotHint = (kind, id) => {
      const at = placedAt(kind, id);
      if (at < 0) return null;
      return at === i ? 'in this slot' : `on ${rowOf(at)}·${(at % ui.HOTBAR_ROW_SLOTS) + 1}`;
    };
    const items = [{ label: `Slot ${rowOf(i)}·${(i % ui.HOTBAR_ROW_SLOTS) + 1}`, header: true }];
    if (here) items.push({ label: 'Clear this slot', action: () => assignHotbarSlot(slot, null) });
    items.push({ label: 'Powers', header: true });
    for (const id of hotbarActionIds()) {
      items.push({
        // Iconed like the slot it would fill, so the menu and the bar name the
        // same thing the same way.
        label: `${ACTIONS[id].icon || '❔'}  ${ACTIONS[id].label}`,
        hint: slotHint('action', id),
        action: () => assignHotbarSlot(slot, { kind: 'action', id }),
      });
    }
    const carried = hotbarItemIds();
    items.push({ label: 'From your pockets', header: true });
    if (!carried.size) items.push({ label: 'Nothing usable in there' });
    for (const [id, n] of carried) {
      items.push({
        label: `${ITEMS[id].icon || '❔'}  ${ITEMS[id].name}`,
        hint: slotHint('item', id) || (n > 1 ? `×${n}` : null),
        action: () => assignHotbarSlot(slot, { kind: 'item', id }),
      });
    }
    ui.showMenu(x, y, items);
  }
  function assignHotbarSlot(i, entry) {
    if (!sheet) return;
    barSheet().hotbar = assignInto(layoutOf(barSheet()), i, entry);
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
    // Out of combat a portrait click switches the leader; in one it steers the
    // open SHARED turn (INITIATIVE_PLAN) - combat refuses anyone not holding
    // the floor, so clicking a member who waits on their own slot does nothing,
    // exactly as before spans existed.
    onSelect: (i) => { if (!inCombat) switchLeader(i); else combat?.steerMember(party.members[i]); },
    // Double-click points the CAMERA at the member, switch or no switch. The
    // first click of the pair already ran onSelect, so out of combat the
    // camera lands on them as the new leader (recenter -> follow); a member
    // the click could NOT take over (downed, waiting on their initiative
    // slot) still gets looked at - that is the point of the second verb.
    onFocus: (i) => focusCameraOn(party.members[i]?.actor),
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
    // `spendablePoints`, not `pending`: class points keep accruing per level
    // while a track is finite, so a bought-out member reopened this fullscreen
    // modal after every victory with nothing purchasable (Q068). The character
    // sheet and the party bar keep showing `pending` - the points ARE banked,
    // and hiding them would be a different lie. This is only the decision to
    // interrupt.
    const queue = party.members.filter((m) => spendablePoints(m.sheet) > 0);
    let i = 0;
    const next = () => (i < queue.length ? openLevelUpFor(queue[i++], next) : refreshProgressUi());
    next();
  }
  function switchLeader(i) {
    if (!party || inCombat || gameOver || modalOpen()) return;
    const m = party.members[i];
    if (!m?.actor || m === partyLeader(party) || m.sheet.hp <= 0) return;
    // Both calls go BEFORE the rebind, like the two sibling handoffs at
    // forceLeader and syncLeaderBindings - `clearOocCrouch` reads the module's
    // `sheet`/`player`, so after the rebind it strips 'covered' off the
    // INCOMING leader and leaves the real croucher crouched forever, which is
    // precisely the leak (Q060/Q066). `quiet` because a handoff CONSUMES the
    // crouch rather than abandoning it, and the "You take point" line below is
    // already the sentence for this moment.
    clearOocCrouch(true); // the crouch belongs to the sheet that took it
    // A SOLO sneak names the leader, and the naming is derived live
    // (`sneakingMembers` filters on the current leader) while the chip was
    // stamped at toggle time - so a portrait click used to silently swap who
    // the sneak meant, leaving the outgoing scout wearing the chip, skipped by
    // the fight trigger and absent from the spot sweep: un-triggerable and
    // un-spottable until something else ended the mode (Q061). Ended rather
    // than handed over, because re-stamping `sneaking` onto the incoming
    // leader would slip somebody into a sneak while they are being watched,
    // which is the one thing D8 refuses. Group mode names everybody, so it
    // survives the handoff untouched.
    if (sneak?.mode === 'solo') endSneak('You break off. The scout straightens up.');
    player.clearPath();
    pendingAction = null;
    armedOoc = null;
    party.active = i;
    sheet = m.sheet;
    player = m.actor;
    controls.recenter(); // control moved - a panned-away view follows it back
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
    // ONE live slot at a time, out of a fight exactly as in one (designer,
    // 2026-07-31): pressing a different slot lowers the armed one and does
    // nothing else - arming the new one takes a second, deliberate press.
    // (A combat-only slot above still only explains itself: it could never
    // arm, so it does not count as reaching for another power.)
    if (armedOoc && armedOoc !== id) {
      armedOoc = null;
      hotbar?.setArmed(null);
      ui.say('You stand down.');
      return;
    }
    armedOoc = armedOoc === id ? null : id;
    hotbar?.setArmed(armedOoc);
    if (!armedOoc) { ui.say('You stand down.'); return; }
    const a = ACTIONS[armedOoc];
    // What the armed slot is waiting for. A summon aims at the FLOOR, so
    // "click a coworker" would be aiming instructions for the wrong thing -
    // and a cone needs no coworker at all, so its hint must not demand one.
    ui.say(a.type === 'summon'
      ? `${a.label} ready — click a spot within ${summonRange(a)} tiles to post it.`
      : a.cone
        ? `${a.label} ready — point it and click to fire.`
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
  const liveSummonsOf = (summoner) => summons.filter((s) =>
    s.sheet.hp > 0 && s.actor && s.summonedBy === summoner).length;
  const roomFor = (a) => summonRoom(a, liveSummonsOf(player));
  // The same ladder combat runs, minus the two legs a FIGHT owns - there is no
  // AP pool to spend out here and no per-fight `uses` to ration, so those
  // fields simply are not supplied.
  const summonDropProblem = (a, tx, tz) => summonSpotProblem(a, {
    // The drop range is a circle from the poster's body; the SPOT is a tile.
    dist: Math.hypot(leadBody().x - tx, leadBody().z - tz),
    los: hasLos(leadBody(), { x: tx, z: tz }),
    hasRoomToStand: freeTilesNear(tx, tz, 1, 0).length > 0,
    room: roomFor(a),
  });
  // The tiles the arrivals would land on: the clicked tile first, then the free
  // ground ringing outward, bounded by `count` and by what the cap has left.
  const summonDropSpots = (a, tx, tz) => (summonDropProblem(a, tx, tz)
    ? []
    : freeTilesNear(tx, tz, dropCount(a, roomFor(a)), 0));
  function postSummonAt(id, tx, tz) {
    const a = ACTIONS[id];
    const problem = summonDropProblem(a, tx, tz);
    if (problem) { ui.say(problem); return; }
    const spawned = spawnSummonUnits(
      a.archetype, 'player', player, dropCount(a, roomFor(a)), { x: tx, z: tz },
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
      // A sneaking body starts fights by being SEEN (the sweep), not by
      // proximity - standing unseen at somebody's shoulder is the whole
      // assassin fantasy (SNEAK_PLAN D1).
      if (hasStatus(m.sheet, 'sneaking')) continue;
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
  // --- sneaking (SNEAK_PLAN M2/M3) -------------------------------------------
  // A held MODE, not a verb: 'solo' sneaks the steered leader and parks the
  // followers where they stand; 'group' sneaks everyone (D4 - the pair BG3
  // ships). Detection is the deterministic cone (stealth.seesBody); spotted
  // means the fight starts (D3). THE RENDERED CONE IS THE RULE: the sweep and
  // the drawing read the same predicate with the same options.
  let sneak = null; // null | { mode: 'solo' | 'group' }
  const sneakingMembers = () => {
    if (!sneak || !party) return [];
    const lead = partyLeader(party);
    return party.members.filter((m) => m.actor?.entity && m.sheet.hp > 0
      && (sneak.mode === 'group' || m === lead));
  };
  const sneakSightOpts = () => ({
    // Forgettable Face (SNEAK M6): the steered sheet's talent narrows every
    // cone watching the party.
    halfAngle: Math.max(10,
      STEALTH.CONE_HALF_ANGLE - (sheet?.talent?.effects?.coneShrink || 0)),
    range: STEALTH.CONE_RANGE,
    sightClearLow: (x, z) => grid.sightOpenCellLow(x, z) && !runtime.isSmoke(x, z),
    edgeOpenLow: grid.sightOpenLow,
  });
  // The watcher's eyes: continuous body, facing = the VISUAL yaw. Unusual on
  // purpose - facing rules elsewhere refuse the eased tween (TACTICS #5), but
  // the cone is drawn from the model and D2 says the cone you can see is the
  // rule, so here the tween IS the truth the player reads.
  const watcherOf = (en) => {
    const p = en.entity.getPosition();
    const r = en.yaw * (Math.PI / 180);
    return { x: p.x, z: p.z, facing: { x: Math.sin(r), z: Math.cos(r) } };
  };
  const bodyOfMember = (m) => {
    const p = m.actor.entity.getPosition();
    return { x: p.x, z: p.z };
  };
  const anyWatcherSees = (body, opts = sneakSightOpts()) =>
    enemies.some((en) => en.alive && en.entity && seesBody(watcherOf(en), body, opts));
  function endSneak(line = null) {
    if (!sneak) return;
    sneak = null;
    for (const m of party?.members || []) {
      removeStatus(m.sheet, 'sneaking');
      // The pose belongs to the sneak unless a held crouch owns it.
      if (m.actor && !(m.sheet === sheet && oocCrouch)) m.actor.crouched = false;
    }
    if (line) ui.say(line);
  }
  function toggleSneak(mode) {
    if (!sheet || inCombat || gameOver || modalOpen()) return;
    if (sneak) { endSneak('You straighten up.'); return; }
    const lead = partyLeader(party);
    const would = party.members.filter((m) => m.actor?.entity && m.sheet.hp > 0
      && (mode === 'group' || m === lead));
    // D8 (DOS2-confirmed): no slipping into a sneak somebody is watching.
    if (would.some((m) => anyWatcherSees(bodyOfMember(m)))) {
      ui.say('Someone is watching. Break their line of sight first.');
      return;
    }
    sneak = { mode };
    for (const m of would) {
      applyStatus(m.sheet, 'sneaking');
      m.actor.crouched = true;
    }
    if (mode === 'solo') {
      for (const m of party.members) if (!would.includes(m)) m.actor?.clearPath();
    }
    ui.say(mode === 'group'
      ? 'The whole department goes quiet.'
      : `${lead.sheet.name} slips low. The others hold here.`);
  }
  // Group sneak's followers price watched ground like a hazard (SNEAK M5).
  // The cheap wedge test only (range + angle, no trace): a follower that
  // routes around ground that MIGHT see it beats one that path-lawyers the
  // desk line and clips a cone with its shoulder.
  const inAnyCone = (x, z) => {
    if (!sneak) return false;
    const opts = sneakSightOpts();
    const cosLim = Math.cos(opts.halfAngle * (Math.PI / 180));
    return enemies.some((en) => {
      if (!en.alive || !en.entity) return false;
      const w = watcherOf(en);
      const dx = x - w.x;
      const dz = z - w.z;
      const d = Math.hypot(dx, dz);
      if (d > opts.range) return false;
      if (d < 1e-6) return true;
      return (dx * w.facing.x + dz * w.facing.z) / d >= cosLim;
    });
  };
  // The sweep (M3): every body against every cone, on the follower cadence.
  // First seen body busts the sneak and starts the fight with the spotter as
  // primary - exactly the bump-into-them opener, minus the bumping.
  let sneakSweepT = 0;
  function sneakSweep() {
    const opts = sneakSightOpts();
    for (const en of enemies) {
      if (!en.alive || !en.entity) continue;
      const w = watcherOf(en);
      for (const m of sneakingMembers()) {
        if (!seesBody(w, bodyOfMember(m), opts)) continue;
        const who = m.sheet.name;
        endSneak(null);
        ui.say(`${en.def.name} spots ${who}!`);
        const engaged = enemies.filter((e) => e.alive
          && Math.max(Math.abs(e.x - m.actor.x), Math.abs(e.z - m.actor.z)) <= ENGAGE_RADIUS
          && canTakePart(m.actor, e));
        if (!engaged.includes(en)) engaged.push(en);
        beginCombat({ engaged, primary: en });
        return;
      }
    }
  }
  // The cones, drawn only while sneaking (both references confirmed) -
  // immediate-mode lines like every combat affordance, from coneBoundary's
  // rays, which run the SAME crouch-height trace the sweep does: a cone
  // visibly stops at the desk it cannot see over.
  const CONE_COLOR = () => new pc.Color(0.92, 0.28, 0.2, 0.55);
  function drawSneakCones() {
    const opts = sneakSightOpts();
    const y = 0.15;
    for (const en of enemies) {
      if (!en.alive || !en.entity) continue;
      const w = watcherOf(en);
      const pts = coneBoundary(w, opts);
      const eye = new pc.Vec3(w.x, y, w.z);
      let prev = eye;
      for (const [px, pz] of pts) {
        const v = new pc.Vec3(px, y, pz);
        app.drawLine(prev, v, CONE_COLOR());
        prev = v;
      }
      app.drawLine(prev, eye, CONE_COLOR());
      // A few interior rays so the wedge reads as a watched AREA, not an
      // outline that could pass for a wall.
      for (let i = 2; i < pts.length - 1; i += 4) {
        app.drawLine(eye, new pc.Vec3(pts[i][0], y, pts[i][1]), CONE_COLOR());
      }
    }
  }

  function beginCombat({ engaged, primary, opening = null }) {
    if (!sheet || inCombat || gameOver || !player.entity) return;
    // A fight begun while sneaking judges surprise by SIGHT (SNEAK M4/D6):
    // capture who saw the initiator BEFORE the sneak state is cleared.
    let sneakOpened = null;
    if (sneak) {
      const opts = sneakSightOpts();
      const p = player.entity.getPosition();
      sneakOpened = {
        saw: new Set(enemies.filter((en) => en.alive && en.entity
          && seesBody(watcherOf(en), { x: p.x, z: p.z }, opts))),
      };
    }
    // However the fight found you, the sneak is over (M3) - quietly: the
    // opener's own line says what happened.
    endSneak(null);
    for (const m of party.members) m.actor?.clearPath(); // followers freeze too
    for (const e of enemies) e.clearPath(); // freeze any in-flight wander
    pendingAction = null;
    armedOoc = null;
    hotbar?.setArmed(null);
    dialogue.close();
    shopping.close(); // the machine can wait; it is not going anywhere
    inCombat = true;
    controls.recenter(); // a fight starts AT the party - a panned-away view returns
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
      sneakOpened,
      rng: combatRng,
      // A crouch taken before the fight rides into it (TACTICS_PLAN M6 OOC):
      // combat owns it from here - the status chip is already on the sheet.
      preCrouch: (() => { const c = oocCrouch; oocCrouch = null; return c; })(),
      // Summons that outlived the last fight walk into this one - they're still
      // on the floor with turns left on the clock, so they fight.
      allies: summons.filter((s) => s.sheet.hp > 0),
      // The floor this fight is fought on (combat-world.js). The MUTABLE
      // bindings go in as getters, not values: a fight outlives a leader
      // switch, and a facade holding the sheet somebody had when combat opened
      // would answer every question about the wrong character.
      world: createCombatWorld({
        get sheet() { return sheet; },
        get player() { return player; },
        get combat() { return combat; },
        get party() { return party; },
        get enemies() { return enemies; },
        get summons() { return summons; },
        grid,
        runtime,
        scene,
        doors,
        isWalkable,
        partyAt,
        summonAt,
        clampPoint,
        approachTo,
        floorAt,
        slipChanceAt,
        stickGum,
        segmentClear,
        sightClear,
        smoothPath,
        smoothFromBody,
        routeOpen,
        freeTilesNear,
        hazardCostFor,
        enemyHazardCost,
        enemyClearOfHazards,
        rawSurfDamage,
        effectiveSurfDamage,
        leaveSurfaceAt,
        onSummonStep,
        spawnSummonUnits,
        // Both of these are ALSO facade keys, which is exactly why they need
        // naming here: inside the object literal `findPath(...)` no longer
        // resolves to main.js's function, it resolves to nothing.
        findPath,
        dismissSummon,
      }),
      fx: vfx,
      callbacks: {
        say: ui.say,
        // Double-click on an initiative row: put the camera on that body.
        // main.js owns the rig, so combat only names WHO.
        focusCamera: focusCameraOn,
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
          // fell, which made a two-turn-old employee feel like a prop; now the
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
  function engageWithAction(en, actionId, point = null) {
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
      // A cone fires from where you STAND, and its gate IS the wedge - the
      // same coneFrom the preview drew and the resolution will run, aimed at
      // the CLICK point when one came through (the armed ground click) and at
      // the target's body otherwise. The old gate here was a third geometry
      // (cheb square + tile-to-tile line) that could refuse a body the
      // preview's wedge plainly clipped (DEGRID M5).
      const lb = leadBody();
      const eb = enemyBody(en);
      const test = coneFrom(a, lb, point ? point.x : eb.x, point ? point.z : eb.z);
      if (!test || !(test(eb.x, eb.z, 0.5) && hasLos(lb, eb))) {
        ui.say(`They are not in the way of that ${a.label.toLowerCase()}.`);
        return;
      }
    } else if (a.type === 'shove') {
      // The ring's own test (oocTargetOk): arm's reach, or the office
      // standing in for your arms - a partition between you, or adjacent
      // furniture whose fall lands exactly on them. One test, so the ring
      // and this refusal cannot drift apart.
      if (!oocTargetOk(actionId, en)) {
        ui.say('Too far to shove. Walk your feelings over first.');
        return;
      }
    } else if (!playerReaches(en) && !bestApproachPath(en.x, en.z)) {
      ui.say('No way to reach them from here.');
      return;
    }
    const engaged = enemies.filter((e) =>
      e.alive && Math.max(Math.abs(e.x - player.x), Math.abs(e.z - player.z)) <= ENGAGE_RADIUS
      && canTakePart(player, e)); // same rule as checkCombatTrigger - see there
    if (!engaged.includes(en)) engaged.push(en);
    // The aimed point rides into the fight: the opener must fire the wedge
    // the player SAW, not one re-aimed at the target's tile centre.
    beginCombat({ engaged, primary: en, opening: { actionId, target: en, point } });
  }

  // A cone fired at an EMPTY wedge, with no fight on. It fires anyway
  // (designer, 2026-07-31: no target needed, in or out of combat) - combat's
  // fireCone already resolves this exact case as a swing with no casualties
  // and a carpeted wedge, so this is that outcome minus the two things a
  // fight owns (AP, per-fight uses), the same subtraction the out-of-combat
  // summon post makes. `test` is the wedge from coneFrom, aimed at (tx, tz).
  function fireOocCone(a, test, tx, tz) {
    player.lunge(tx, tz); // the fan of envelopes, aimed where you pointed
    if (a.leaves) {
      const R = Math.ceil(a.cone.range) + 1;
      for (let z = Math.floor(player.z) - R; z <= Math.ceil(player.z) + R; z++) {
        for (let x = Math.floor(player.x) - R; x <= Math.ceil(player.x) + R; x++) {
          if (!test(x, z)) continue;
          // No carpeting a tile a teammate is standing on - combat's own rule.
          if (partyAt(x, z)) continue;
          if (!hasLos(leadBody(), { x, z })) continue;
          leaveSurfaceAt(x, z, a.leaves, a.leavesTurns || 0);
        }
      }
    }
    ui.say(`${a.log} No casualties. Plenty of litter.`); // combat's own zero-hit line
    // One click, one volley: the slot disarms, same as a posted summon.
    armedOoc = null;
    hotbar?.setArmed(null);
  }

  // --- the office topples out of combat too (TACTICS_PLAN M6 OOC) -------------
  // The same furniture-topple rule combat runs, evaluated from the leader's
  // spot: sign-derived landing, open ground, no free demolition into a wall.
  const ORTHO4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function oocTopplePlanAt(px, pz) {
    const def = grid.defAt(px, pz);
    if (!isToppleable(def)) return null;
    const landing = toppleLanding(player.x, player.z, px, pz);
    if (!landing) return null;
    const [lx, lz] = landing;
    if (!grid.terrainOpen(lx, lz) || !grid.stepOpen(px, pz, lx, lz)) return null;
    return { def, x: px, z: pz, lx, lz };
  }

  // An armed SHOVE aimed at the office with no fight on (designer,
  // 2026-07-30): furniture and partitions topple out here too. With a
  // coworker standing where it lands, the topple IS the opener - the fight
  // starts and combat resolves the fall with its own save and pin. Returns
  // true when the click was a shove at the office (refusals included).
  function oocShoveAt(tile) {
    const def = grid.defAt(tile.x, tile.z);
    if (isToppleable(def)) {
      approachAndDo(tile.x, tile.z, () => {
        const plan = oocTopplePlanAt(tile.x, tile.z);
        if (!plan) { ui.say('It rocks, and settles. Nothing behind it to fall into.'); return; }
        const en = enemyAt(plan.lx, plan.lz);
        if (en?.alive) { engageWithAction(en, 'shove'); return; }
        if (npcAt(plan.lx, plan.lz) || partyAt(plan.lx, plan.lz)) {
          ui.say('Somebody is standing there. Not like this.');
          return;
        }
        grid.setType(plan.x, plan.z, 'floor');
        scene.refreshTile?.(plan.x, plan.z);
        grid.setType(plan.lx, plan.lz, plan.def.topple.becomes);
        scene.refreshTile?.(plan.lx, plan.lz);
        vfx.impact(plan.lx, plan.lz, 'slam', { y: 0.5 });
        vfx.shake(0.11, 0.28);
        ui.say(`${plan.def.label || 'It'} goes over.`);
        armedOoc = null;
        hotbar?.setArmed(null);
      });
      return true;
    }
    // A partition: the clicked tile is the side it falls ONTO - walk to the
    // tile across the edge and put a shoulder into it.
    if (grid.terrainOpen(tile.x, tile.z)) {
      let side = null;
      for (const [dx, dz] of ORTHO4) {
        const sx = tile.x + dx;
        const sz = tile.z + dz;
        if (!grid.wallEdgeBetween(sx, sz, tile.x, tile.z)) continue;
        if (sx === player.x && sz === player.z) { side = { x: sx, z: sz, here: true }; break; }
        if (!isWalkable(sx, sz)) continue;
        const p = findPath(isWalkable, player.x, player.z, sx, sz, hazardCost, grid.stepOpen);
        if (p && p.length >= 2 && (!side || p.length < side.len)) side = { x: sx, z: sz, len: p.length };
      }
      if (!side) return false; // no partition faces that tile - not a shove aim
      const resolve = () => {
        // Re-verify on arrival - the world had a whole walk to change.
        if (!grid.wallEdgeBetween(player.x, player.z, tile.x, tile.z)) {
          ui.say('The wall is not where you left it.');
          return;
        }
        const en = enemyAt(tile.x, tile.z);
        if (en?.alive) { engageWithAction(en, 'shove'); return; }
        if (npcAt(tile.x, tile.z) || partyAt(tile.x, tile.z)) {
          ui.say('Somebody is standing there. Not like this.');
          return;
        }
        const e = grid.removeEdgeBetween(player.x, player.z, tile.x, tile.z);
        if (!e) return;
        scene.removeEdgeWall?.(e.o, e.k);
        grid.setType(tile.x, tile.z, PARTITION_TOPPLE.becomes);
        scene.refreshTile?.(tile.x, tile.z);
        vfx.impact(tile.x, tile.z, 'slam', { y: 0.3 });
        vfx.shake(0.08, 0.2);
        ui.say('You put a shoulder into the partition. It goes over flat.');
        armedOoc = null;
        hotbar?.setArmed(null);
      };
      if (side.here) resolve();
      else if (!walkToExact(side.x, side.z, resolve)) { ui.say('No way to get at that wall.'); }
      return true;
    }
    return false;
  }

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
  const memberBodyAt = (x, z) => (party?.members || []).find((m) =>
    m.actor && m.sheet.hp > 0 && m.actor.x === x && m.actor.z === z)
    || summons.find((sm) => sm.sheet.hp > 0 && sm.actor.x === x && sm.actor.z === z)
    || null;
  const oocCoverCell = (x, z) => {
    const d = grid.defAt(x, z);
    if (d && (!!d.cover || (!!d.solid && !blocksSight(d)))) return true;
    return !!(enemyAt(x, z) || npcAt(x, z) || partyAt(x, z) || summonAt(x, z));
  };
  // Which faces of a tile would shield a crouch there. One helper, read by the
  // aim preview, the click and the held-crouch affordance, so none of the
  // three can describe a different crouch from the others.
  const oocCoverFaces = (x, z) => shieldedFaces(x, z, {
    edgeOpen: grid.stepOpen,
    coverCell: (cx, cz) => (cx === player.x && cz === player.z ? false : oocCoverCell(cx, cz)),
  });
  // Why this spot is not a crouch, or null when it is one.
  function oocCoverProblem(x, z) {
    const here = player.x === x && player.z === z;
    if (!here && (!isWalkable(x, z) || enemyAt(x, z) || npcAt(x, z) || partyAt(x, z))) {
      return 'No room to tuck in there.';
    }
    if (!oocCoverFaces(x, z).length) return 'Nothing there to hide behind.';
    return null;
  }
  // What is covering a spot, in words - the out-of-combat twin of combat's
  // `coverNames`, so "You tuck in behind..." names the same things on both
  // sides of a fight starting.
  function oocCoverNames(x, z) {
    const seen = [];
    for (const [ox, oz] of oocCoverFaces(x, z)) {
      const cx = x + ox;
      const cz = z + oz;
      const body = enemyAt(cx, cz) || npcAt(cx, cz) || memberBodyAt(cx, cz);
      if (body) {
        const name = body.sheet?.name || body.def?.name || 'them';
        if (!seen.includes(name)) seen.push(name);
        continue;
      }
      const d = grid.defAt(cx, cz);
      const label = d && (d.cover || d.solid)
        ? `the ${(d.label || 'cover').toLowerCase()}` : 'the partition';
      if (!seen.includes(label)) seen.push(label);
    }
    if (!seen.length) return 'cover';
    if (seen.length === 1) return seen[0];
    return `${seen.slice(0, -1).join(', ')} and ${seen[seen.length - 1]}`;
  }

  function oocTakeCoverAt(tile, point = null) {
    const problem = oocCoverProblem(tile.x, tile.z);
    if (problem) { ui.say(problem); return; }
    const commit = () => {
      // Re-ask on ARRIVAL: a coworker who wandered off during the walk is a
      // crouch that never happens, not one that lands on empty carpet.
      if (oocCoverProblem(tile.x, tile.z)) { ui.say('The moment passes - no cover taken.'); return; }
      oocCrouch = { at: { x: tile.x, z: tile.z } };
      applyStatus(sheet, 'covered');
      player.crouched = true; // the held pose (actors.js): torso down onto the legs
      paintHud(sheet);
      ui.say(`You tuck in behind ${oocCoverNames(tile.x, tile.z)}.`);
      armedOoc = null;
      hotbar?.setArmed(null);
    };
    if (player.x === tile.x && player.z === tile.z) {
      // Your own tile: a click on a meaningfully different POINT within it is
      // a sub-tile shuffle to fine-tune the tuck - the marker promised the
      // point, not the tile. The arrival hook fires on path-finished even
      // without a tile change (actors.js: `changed || finished`), so the
      // exact-tile pendingAction resolves like any other walk-then-crouch.
      const end = point ? clampPoint(point.x, point.z) : null;
      const pp = player.entity ? player.entity.getPosition() : player;
      if (end && Math.hypot(end[0] - pp.x, end[1] - pp.z) > 0.1) {
        clearOocCrouch();
        pendingAction = { x: tile.x, z: tile.z, run: commit, exact: true };
        const s = [[pp.x, pp.z], end];
        player.setPath(s);
        lastPath = s;
        return;
      }
      commit();
      return;
    }
    // Finish on the POINT you clicked, clamped to clearance - tucked where
    // you chose, not teleport-parked on the tile centre (designer,
    // 2026-07-31: "continuous and smooth"). Combat's crouch walk does the
    // same through walkActive's endpoint.
    if (!walkToExact(tile.x, tile.z, commit,
      point ? clampPoint(point.x, point.z) : null)) ui.say('No way in there.');
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

  // Turn-clock statuses OUT of combat (designer, 2026-07-31: "that clock
  // should've been used from the beginning ... they should all be using the
  // same thing in and out of combat, its not something new going on here").
  //
  // Exactly right, and the clock was already here. `turn-order.js` ticks these
  // as each combatant's turn opens; out of a fight the world clock below
  // stands in, and it already spends everything a combat round spends - fire,
  // smoke, summon assignments, the litter a power dropped. Statuses were the
  // ONE thing it did not spend, and that omission is what made a turn-clocked
  // status mean two different things depending on whether dice were out: a
  // 3-turn buff applied on the map was permanent, and a coworker set alight
  // outside a fight never burned. Same `tickTurn`, same durations, both sides.
  //
  // `hurt(damage)` is how this carrier takes a dot - a sheet and a coworker
  // count HP differently - and returns whether it dropped them. Returns the
  // expired ids too, because a caller may need to react to what lapsed.
  function tickTurnClockOn(carrier, actor, hurt) {
    const { damage, expired } = tickTurn(carrier);
    if (damage <= 0) return { down: false, damage, expired };
    // The dot's look rides the body, not the tile centre, so a status burning
    // somebody mid-walk lands its number on them.
    const p = actor?.entity ? actor.entity.getPosition() : actor;
    vfx.impact(p.x, p.z, 'fire', { y: 0.4 });
    vfx.damageText(p.x, p.z, `-${damage}`, '#ff7a3c');
    return { down: hurt(damage), damage, expired };
  }

  // One out-of-combat turn's worth of status clock, over everyone who can
  // carry one: the roster, the temps still on assignment, and the coworkers
  // wandering the floor. Deaths are collected and resolved AFTER the sweep,
  // the same shape handleExplosion uses - one casualty must not cut the tick
  // short for everybody else, or the XP for the coworkers it finished off.
  function advanceStatusTurn() {
    if (!party) return;
    // `covered` is the one turn-clocked chip whose duration is a LEAK BOUND
    // rather than a clock (data/statuses.js): combat revalidates the crouch on
    // every consult and re-applies the chip while it holds, so only an
    // abandoned fight lets it lapse. Out here the crouch is `oocCrouch`, and
    // it holds until a deliberate walk breaks it - so re-apply on the same
    // terms rather than letting the new clock time it out from under a
    // stationary character. Without this, a crouch taken before a fight
    // evaporated after four ticks of standing still.
    // ...and the same revalidation combat does: the crouch is only real while
    // its position still has a shielded face. A partition toppled out of a
    // fight, or a coworker who wandered off the face they were covering, ends
    // it here rather than lingering until a fight starts and combat notices.
    if (oocCrouch && sheet) {
      if (oocCoverProblem(oocCrouch.at.x, oocCrouch.at.z)) clearOocCrouch();
      else applyStatus(sheet, 'covered');
    }
    const downed = [];
    for (const m of party.members) {
      if (!m.actor || m.sheet.hp <= 0) continue;
      const r = tickTurnClockOn(m.sheet, m.actor, (d) => applyDamage(m.sheet, d));
      if (r.damage > 0 || r.expired.length) syncHudFor(m.sheet);
      if (r.down) downed.push(m);
    }
    for (const s of [...summons]) {
      if (!s.actor || s.sheet.hp <= 0) continue;
      // A temp takes the rules in silence, like everywhere else in this file.
      if (tickTurnClockOn(s.sheet, s.actor, (d) => applyDamage(s.sheet, d)).down) {
        dismissSummon(s.actor);
      }
    }
    const slain = [];
    for (const en of enemies) {
      if (!en.alive) continue;
      if (tickTurnClockOn(en, en, (d) => en.takeDamage(d)).down) slain.push(en);
    }
    for (const en of slain) {
      vfx.impact(en.x, en.z, 'blood', { y: 0.4 });
      awardKill(en);
    }
    for (const m of downed) {
      downOrLose(m, 'Burned down at your desk. The incident report writes itself.');
      if (gameOver) return; // that was the wipe
    }
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
    // A turn-clock status a surface applies (fire -> burning), in a fight or
    // out of one [stated] (designer, 2026-08-03, on the Q906 gaps: "yes all
    // fixes"). This used to be gated on `inCombat` because the status "needs
    // combat's turns to tick" - which stopped being true when advanceStatusTurn
    // landed an out-of-combat turn clock (designer, 2026-07-31: they should all
    // be using the same thing in and out of combat). The gate outlived its
    // reason by three days; walking through flame now sets you alight wherever
    // you are, and the same clock ticks it down.
    if (sfx.applies && sfx.applies !== 'gum' && applyStatus(ms, sfx.applies)) {
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
    if (gameOver) return;
    if (!slips({
      chance: slipChanceAt(x, z),
      roll: Math.random,
      slipProof: wasSlipProof || statusFx(ms).slipProof || equippedStats(ms).slipProof,
      slipImmune: ms.talent?.effects?.slipImmune,
    })) return;
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
            const saved = serializeProgress(party, level.next);
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
    // An `exact` action (a crouch spot, a partition shove side) fires only on
    // its precise tile - "within reach" would settle for a diagonal that
    // shields or shoves nothing.
    if (isLeader && pendingAction && pathDone
      && (pendingAction.exact
        ? x === pendingAction.x && z === pendingAction.z
        : Math.abs(x - pendingAction.x) <= 1 && Math.abs(z - pendingAction.z) <= 1)) {
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
        // A teammate's body with NO friendly verb armed: under a shared turn
        // this grabs the wheel (INITIATIVE_PLAN) - the same body click that
        // switches the leader out of combat. Steering only ever succeeds on a
        // member holding the open turn, so outside one the click falls
        // through to the mis-walk it always was.
        if ((bodyHit?.kind === 'party' || bodyHit?.kind === 'summon')
          && combat?.steerMember(bodyHit.ref)) return;
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
        // A door, before the tile fallback - otherwise the click walks you at
        // the door instead of working it. toggleDoor owns the rules from here:
        // it refuses with a reason when you are not beside it, and bills the
        // AP when you are.
        const dk = combatDoorAt(bodyHit, point);
        if (dk) { toggleDoor(dk); return; }
        if (!tile) return;
        combat?.handleTileClick(tile, point);
        return;
      }
      if (modalOpen()) return; // talking: clicks belong to the panel
      // Layered storeys: a click means what the eye sees - resolve it against
      // the visible storeys top-down. A stair run routes a climb, another
      // storey routes a cross-storey walk, and a same-storey hit simply
      // becomes the tile/point every verb below already reads.
      if (floors) {
        if (climbAnim) return; // the flight finishes before the next order
        // The flight's own boxes win the click before any ground plane: a
        // pixel on the risers would otherwise resolve to whatever tile the
        // ray reaches BEHIND the raised steps.
        const stairHit = picking.pick(controls.cameraEntity, sx, sy);
        if (stairHit?.kind === 'stair') { routeViaStair(stairHit.ref); return; }
        const res = layeredPick(sx, sy);
        if (!res) return;
        if (res.stair) { routeViaStair(res.stair); return; }
        if (res.layer !== playerLayer) { walkToLayer(res.tile, res.point, res.layer); return; }
        tile = res.tile;
        point = res.point;
      }
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
      // just drew - and an EMPTY wedge fires all the same (designer,
      // 2026-07-31): it needed a coworker in the way before, which made the
      // one cone whose whole point is the paper behind it the one attack you
      // could not fire at the floor.
      if (armedOoc && ACTIONS[armedOoc].cone && point) {
        const a = ACTIONS[armedOoc];
        // From the BODY, like the preview and the in-combat wedge - one
        // geometry for the whole click (DEGRID M5).
        const test = coneFrom(a, leadBody(), point.x, point.z);
        if (!test) { ui.say('Aim somewhere.'); return; } // the cursor is on you
        const caught = coneCatches(test);
        if (caught.length) {
          // The nearest one is the primary; the rest join through the engage
          // radius exactly as they would for any other opener.
          caught.sort((p, q) => cheb(player, p) - cheb(player, q));
          engageWithAction(caught[0], armedOoc, point);
          return;
        }
        fireOocCone(a, test, point.x, point.z);
        return;
      }
      // An armed SHOVE aimed at the office itself works out here too
      // (designer, 2026-07-30): furniture and partitions topple with no
      // fight on. Ahead of the entity pick, or the prop mesh under the click
      // would open its rummage panel instead of taking the shoulder.
      if (armedOoc && ACTIONS[armedOoc].type === 'shove' && tile && !enemyAt(tile.x, tile.z)
        && oocShoveAt(tile)) return;
      // An armed TAKE COVER: crouch before anyone has noticed you.
      if (armedOoc && ACTIONS[armedOoc].type === 'cover' && tile) {
        oocTakeCoverAt(tile, point);
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
        // The acting body's OWN tile is the click's first authority (see
        // onLeftClickTile): a self-cast or a shuffle in place must not be
        // stolen by an adjacent coworker's tall mesh overlapping the pixel.
        // The hover had no such rule, so on those pixels the crosshair and
        // the to-hit readout promised a swing that the click turned into an
        // in-place shuffle. Same test, same rounding as `screenToTile`, so
        // the two affordances answer together.
        const acting = combat.actingActor || party?.members[party.active]?.actor || player;
        const onOwnTile = !!acting && !!point
          && Math.round(point.x) === acting.x && Math.round(point.z) === acting.z;
        // A coworker under the cursor is a TARGET, armed or not - a bare click
        // swings the basic attack (combat.js), so the cursor has to say so.
        // combat.handleHover resolves WHO that is (this body pick first, the
        // ground point as fallback) and WHETHER a click would swing right now
        // (the click's own gate: your turn, standing still) - and the
        // crosshair keys off that one answer. Reading the raw pick here showed
        // a crosshair mid-walk and on AI turns, promising a swing while the
        // to-hit readout and the click itself refused.
        const picked = !onOwnTile && hit?.kind === 'enemy' && hit.ref.alive ? hit.ref : null;
        // The hovered door, resolved ONCE with the click's own predicate
        // (combatDoorAt) and handed to combat alongside the hover - the
        // pointer cursor and the threshold ring read this same answer, so
        // the two affordances light together and die together.
        const doorKey = combatDoorAt(hit, point);
        // handleHover still runs with the real point - a cone, a zone and a
        // summon drop all aim off it, and the shuffle's own move preview is
        // priced there too. It is `hoverFoe` that stands down, which takes
        // the crosshair, the glow, the ring and the readout together.
        const foe = combat.handleHover(point, sx, sy, picked,
          doorKey ? doorMidpoint(doorKey) : null, onOwnTile);
        // A coworker wins the cursor; failing that, a door you could work says
        // so with the same pointer it uses out of combat. The click reads the
        // very same predicate, so the two cannot disagree.
        hover.setCursor(foe ? 'crosshair' : (doorKey ? 'pointer' : null));
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
      // Layered: the hover point follows the same top-down storey pick as the
      // click, so the banner and the drop rings describe what the eye is on.
      if (floors) {
        const res = layeredPick(sx, sy);
        if (res) point = res.point;
      }
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
        // A teammate holding the open shared turn gets a steering item - the
        // in-combat sibling of the out-of-combat "Switch to" below.
        const wheel = (chit?.kind === 'party' || chit?.kind === 'summon')
          ? combat?.canSteer(chit.ref) : null;
        if (wheel) items.push({ label: `Steer ${wheel}`, action: () => combat.steerMember(chit.ref) });
        const text = examineAt(chit, tile, point);
        if (text) items.push({ label: 'Examine', action: () => ui.say(text) });
        if (items.length) ui.showMenu(sx, sy, items);
        return;
      }
      if (modalOpen()) return;
      // Layered: the menu describes the storey you are ON - a right-click
      // aimed at another storey stays silent rather than offering verbs the
      // walk rules would then refuse.
      if (floors) {
        if (climbAnim) return;
        const res = layeredPick(sx, sy);
        if (!res || res.layer !== playerLayer) return;
        tile = res.tile;
        point = res.point;
      }
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
        const test = coneFrom(a, leadBody(), oocAim.x, oocAim.z);
        if (!test) return null;
        const caught = coneCatches(test);
        // The wedge is ALWAYS usable - an empty one fires too (fireOocCone),
        // exactly as combat's own preview draws it - so the color must not
        // read as a refusal. `caught` still rings whoever it would open on.
        return { line: conePolyline(a, test), caught: caught.map((e) => [e.x, e.z]), usable: true };
      },
      summonDrop: () => {
        if (!armedOoc || inCombat || !oocAim) return null;
        const a = ACTIONS[armedOoc];
        if (a.type !== 'summon') return null;
        const x = Math.round(oocAim.x);
        const z = Math.round(oocAim.z);
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
        if (!armedOoc || inCombat || !oocAim || !sheet) return null;
        if (ACTIONS[armedOoc].type !== 'shove') return null;
        const x = Math.round(oocAim.x);
        const z = Math.round(oocAim.z);
        if (isToppleable(grid.defAt(x, z))) {
          const plan = oocTopplePlanAt(x, z);
          return { x, z, usable: !!plan, landing: plan ? [plan.lx, plan.lz] : null };
        }
        // A partition-far tile: the aim IS the landing.
        if (grid.terrainOpen(x, z)
          && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => grid.wallEdgeBetween(x + dx, z + dz, x, z))) {
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
        if (!armedOoc || inCombat || !oocAim || !sheet) return null;
        if (ACTIONS[armedOoc].type !== 'cover') return null;
        const x = Math.round(oocAim.x);
        const z = Math.round(oocAim.z);
        const usable = !oocCoverProblem(x, z);
        // px/pz is the CLAMPED stand point - the continuous marker, and
        // exactly the spot the commit will walk to. The raw cursor point can
        // sit inside a wall's clearance band; a marker there would promise a
        // spot the body cannot occupy.
        const [px, pz] = clampPoint(oocAim.x, oocAim.z);
        return { x, z, px, pz, usable, faces: usable ? oocCoverFaces(x, z) : [] };
      },
      // What is covering the leader RIGHT NOW, whatever is armed - the
      // held-crouch affordance, so a crouch taken before a fight shows its
      // shape out here too rather than only once the dice come out.
      heldCover: () => {
        if (inCombat || !oocCrouch || !sheet) return null;
        return { x: oocCrouch.at.x, z: oocCrouch.at.z, faces: oocCoverFaces(oocCrouch.at.x, oocCrouch.at.z) };
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
  const steeredActor = () => (inCombat && combat ? combat.actingActor || player : player);

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
      if (!sheet || gameOver) return;
      focusCameraOn(steeredActor());
    };
  }

  // --- keyboard: hold Alt for the loot overlay, I for the pockets ---------------
  // Camera pan keys (BG3/DOS2: WASD pans, and BG3 takes the arrows too -
  // dotesports.com/pcgamesn BG3 camera guides; DOS2 fextralife Controls).
  // Physical codes, not e.key, so WASD stays WASD on a non-QWERTY layout.
  // keydown/keyup maintain the held set; the update loop drives the rig from
  // it every frame, because pans are continuous and key-repeat isn't.
  const PAN_CODES = {
    KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  };
  const panHeld = new Set();
  window.addEventListener('keydown', (e) => {
    // Ctrl/meta chords stay the browser's (Ctrl+A, Cmd+D); a plain pan key is
    // ours. The typed-text surfaces (god panel, the creation name field)
    // already stop keydown propagation, so typing "was" never pans.
    if (PAN_CODES[e.code] && !e.ctrlKey && !e.metaKey) {
      panHeld.add(PAN_CODES[e.code]);
      // The arrows scroll the page hosting the game (the itch.io iframe) if
      // left to default; suppressing it is harmless for the letters.
      e.preventDefault();
    }
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
    } else if (/^[0-9]$/.test(e.key) && sheet && !gameOver && !modalOpen()) {
      // Number keys press the matching slot of the VISIBLE row, so 1 is always
      // the leftmost button on screen however many rows the kit needs - and 0
      // answers for the tenth slot (TACTICS_PLAN M8's row of ten).
      //
      // These used to be gated `!inCombat`, which meant a FIGHT - the half of
      // the game that is nothing but pressing verbs under pressure - was the
      // half with no keyboard shortcuts at all. The row you learn out of combat
      // is the row you get in one, which was always the stated point of the
      // layout living on the sheet.
      const i = hotbar?.indexAtKey(e.key === '0' ? 10 : Number(e.key)) ?? -1;
      if (i >= 0) pressHotbarSlot(i);
    } else if ((e.key === '[' || e.key === ']') && sheet && !gameOver && !modalOpen()) {
      // Page the hotbar rows from the keyboard - the pager buttons and the wheel
      // over the bar do the same thing.
      hotbar?.flip(e.key === ']' ? 1 : -1);
    } else if (e.key === 'Tab' && sheet && !gameOver && !modalOpen()) {
      // Tab cycles which member you lead out of combat - and, in one, which
      // member of an open SHARED turn you're steering (INITIATIVE_PLAN). With
      // no shared turn open the combat cycle refuses, so the key stays inert
      // on a solo turn rather than falling back to a leader switch.
      e.preventDefault();
      if (inCombat) combat?.cycleSteer();
      else cycleLeader();
    } else if ((e.key === 'h' || e.key === 'H') && sheet && !gameOver && !modalOpen()) {
      // Hide, the pair both references ship (SNEAK_PLAN D4): h sneaks the
      // character you steer and parks the rest; Shift+H sneaks the group.
      if (!inCombat) toggleSneak(e.shiftKey ? 'group' : 'solo');
    } else if ((e.key === 'c' || e.key === 'C') && sheet && !gameOver && !modalOpen()) {
      // The read-only character sheet for whoever you're controlling.
      charSheet.toggle(charSheetVm(sheet));
    } else if ((e.key === 't' || e.key === 'T') && sheet && !gameOver && !modalOpen()) {
      // Overhead tactical view - the same toggle as the rail button.
      controls.toggleTactical();
      tacticalBtn?.refresh();
    } else if (e.key === 'Home' && sheet && !gameOver) {
      // BG3's recenter key: put the camera back on whoever you're driving
      // (the acting combatant in a fight, the leader out of one).
      focusCameraOn(steeredActor());
    }
  });
  window.addEventListener('keyup', (e) => {
    if (PAN_CODES[e.code]) panHeld.delete(PAN_CODES[e.code]);
    if (e.key === 'Alt') { hover.setAlt(false); loot.hideLabels(); }
    if (e.key === 'Control') hover.setCtrl(false);
  });
  window.addEventListener('blur', () => {
    panHeld.clear(); // a key can't be 'still held' across a focus loss
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
  const surfaceImpactKind = (x, z) => impactKindFor({
    burning: runtime.isBurning(x, z),
    electrified: grid.isElectrified(x, z),
    surface: runtime.surfaceAt(x, z),
  }, SURFACES);

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
      // Quiet Shoes (SNEAK M6): the sneak penalty vanishes for its carrier.
      // Coarse on purpose: while sneaking, the talent restores FULL status
      // speed - a gummed sneaker with these shoes also walks off the gum for
      // the duration, an accepted sliver for one line instead of un-merging
      // the status view.
      * (m.sheet.talent?.effects?.sneakSpeed && hasStatus(m.sheet, 'sneaking')
        ? 1 : (statusFx(m.sheet).speedMult ?? 1));
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
    // Solo sneak parks the party where it stands (SNEAK_PLAN D4): the
    // scout slips ahead alone and the others hold this spot.
    if (sneak?.mode === 'solo') return;
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
        if (inAnyCone(sx, sz)) continue; // and no parking in a watch (SNEAK M5)
        if (!spot || Math.hypot(sx - m.actor.x, sz - m.actor.z) < Math.hypot(spot[0] - m.actor.x, spot[1] - m.actor.z)) {
          spot = [sx, sz];
        }
      }
      if (!spot) continue;
      claimed.add(spot[0] + ',' + spot[1]);
      const p = findPath(open, m.actor.x, m.actor.z, spot[0], spot[1],
        (x, z) => hazardCostFor(m.sheet)(x, z) + (inAnyCone(x, z) ? 6 : 0), grid.stepOpen);
      if (!p || p.length < 2) continue;
      // A loose spot in the formation tile, not its dead centre - the party
      // used to park on a perfect grid ring around the leader (the one body
      // cluster on screen that still LOOKED tiled) while wanderers already
      // ambled to scattered points. Same jitter as theirs.
      p[p.length - 1] = clampPoint(
        spot[0] + (Math.random() - 0.5) * 0.7,
        spot[1] + (Math.random() - 0.5) * 0.7);
      const pos = m.actor.entity.getPosition();
      const spliced = [[pos.x, pos.z], ...p.slice(1)];
      // Watched cells are walls to the smoother while sneaking, exactly the
      // hazard rule: never straighten across a cone the route detoured
      // around (the route's own cells stay open through routeOpen).
      const base = (x, z) => open(x, z) && effectiveSurfDamage(x, z, m.sheet) <= 0
        && !inAnyCone(x, z);
      const s = smoothPath(routeOpen(base, spliced), spliced, grid.edgeOpen);
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
      if (sneak && !inCombat && !gameOver) {
        sneakSweepT -= dt;
        if (sneakSweepT <= 0) {
          sneakSweepT = 0.25;
          sneakSweep();
        }
        if (sneak) drawSneakCones(); // the sweep may just have ended it
      }
    } else {
      player.update(dt); // idling on the spawn tile behind the class picker
    }
    // Layered levels: ride the climb (the body's height follows its progress
    // up the flight), chain the next queued route leg when one lands, and
    // keep the cutaway honest about which storeys cover the leader.
    if (floors) {
      if (climbAnim && player.entity) {
        const pos = player.entity.getPosition();
        const d = Math.hypot(pos.x - climbAnim.sx, pos.z - climbAnim.sz);
        const k = Math.min(1, Math.max(0, (d - 0.5) / climbAnim.run));
        player.entity.setPosition(pos.x, climbAnim.y0 + (climbAnim.y1 - climbAnim.y0) * k, pos.z);
        // The rig climbs WITH the body: easing the focus height along the
        // flight is what kills the snap (and half the pop) at the landing.
        controls.setView({ focusY: climbAnim.y0 - lift + (climbAnim.y1 - climbAnim.y0) * k + 0.3 });
        if (!player.moving) {
          playerLayer = climbAnim.toLayer;
          player.entity.setPosition(pos.x, climbAnim.y1, pos.z);
          controls.setView({ focusY: floors.baseY[playerLayer] + 0.3 });
          climbAnim = null;
        }
      }
      if (!climbAnim && legQueue.length && !player.moving && !inCombat) startNextLeg();
      // The covering test stands down mid-climb: the logical tile reaches the
      // landing before playerLayer flips, and judging "covered" off that
      // half-state is what popped the upper floor out and straight back in.
      if (!climbAnim) {
        scene.updateCutaway(playerLayer, (l) => {
          // In-bounds check first: typeAt reads 'wall' outside the map, and a
          // smaller upper storey must not count as covering the whole ground.
          const g = floors.layers[l];
          return player.x >= 0 && player.x < g.width && player.z >= 0 && player.z < g.height
            && g.typeAt(player.x, player.z) !== null;
        });
      }
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
      // The CHANCE, not a pre-rolled verdict: actors.js runs the same
      // step-rules.slips predicate combat and the party do, so the tread that
      // saves a wanderer is checked by the same rule that saves you.
      slipChanceAt,
      stickGum,
      // The same two the other side of the door already has: the tile's raw
      // facts, and what it bills a coworker. An amble runs the floor's rules
      // now [stated] (designer, 2026-08-03), and it runs them off the same
      // sheet and the same ENEMY damage model a coworker's combat walk uses -
      // what hurts a coworker has nothing to do with the player's shoes.
      floorAt,
      surfDamage: (x, z) => rawSurfDamage(x, z),
      // A wander route never crosses hazards, other actors, or a party
      // member's tile; the enemy's own start tile counts as open. Returns it
      // smoothed.
      findWanderPath: (en, tx, tz) => {
        const open = (x, z) => (x === en.x && z === en.z
          ? grid.terrainOpen(x, z)
          : enemyClearOfHazards(x, z) && !partyAt(x, z));
        const p = findPath(open, en.x, en.z, tx, tz, null, grid.stepOpen);
        if (!p || p.length < 2) return null;
        // The wanderer rests at last amble's loose point, not its tile centre
        // - smooth from the BODY like every other feeder, or the first step of
        // each amble snaps back toward the centre (setPath's precondition).
        const pos = en.entity?.getPosition();
        if (pos) p[0] = [pos.x, pos.z];
        // amble to a loose spot in the tile, not its dead centre
        p[p.length - 1] = clampPoint(tx + (Math.random() - 0.5) * 0.7, tz + (Math.random() - 0.5) * 0.7);
        return smoothPath(routeOpen(open, p), p, grid.edgeOpen);
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
      // What an armed slot rings depends on what it aims at: a coworker
      // (every attack and throw), a spot on the floor (a summon), the
      // hovered furniture/partition (shove - which ALSO rings coworkers,
      // they're targets too), or the hovered shield (take cover).
      // The crouch you are in draws whatever is armed - it is not an aim, it
      // is the state of the character. drawCoverAim is called EVERY frame and
      // gates itself on its own query, so its eased ring resets the moment
      // cover stops being the armed verb - gated at the call site, a disarm
      // would leave the ease pointing at wherever cover was last aimed.
      if (show && !inCombat) { hover.drawHeldCover(); hover.drawCoverAim(dt); }
      if (show && !inCombat && armedOoc) {
        if (ACTIONS[armedOoc].type === 'summon') hover.drawSummonDrop();
        else if (ACTIONS[armedOoc].cone) hover.drawConeAim();
        else if (ACTIONS[armedOoc].type === 'cover') { /* drawn above, every frame */ }
        else if (ACTIONS[armedOoc].type === 'shove') {
          hover.drawArmedTargets();
          hover.drawShoveAim();
        } else hover.drawArmedTargets();
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
        // ...and so are the statuses everyone is carrying. Same clock, same
        // `tickTurn`, same durations as a fight - see advanceStatusTurn.
        advanceStatusTurn();
        if (gameOver) break;
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
    const steeredSheet = inCombat && combat ? combat.actingSheet : sheet;
    const impair = !gameOver && steeredSheet ? statusFx(steeredSheet) : null;
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
    // Keyboard camera pan (WASD/arrows), gated like the other game keys: it
    // detaches the rig from the follow target until something recenters it.
    // Opposed keys cancel per axis rather than fighting.
    if (panHeld.size && sheet && !gameOver && !modalOpen()) {
      const rx = (panHeld.has('right') ? 1 : 0) - (panHeld.has('left') ? 1 : 0);
      const uz = (panHeld.has('up') ? 1 : 0) - (panHeld.has('down') ? 1 : 0);
      if (rx || uz) {
        controls.pan(rx, uz, dt);
        // The world just slid under a stationary cursor - re-ask what the
        // hover is on, or the glow/banner stay pinned to what WAS there.
        controls.refreshHover();
      }
    }
    // Follow whoever you're STEERING, keeping them centred in frame. Track the
    // entity's CONTINUOUS position (actor.x/z is the logical tile, which jumps
    // a whole tile at a time and makes the camera step along with the walk).
    // The walls ghost for the same body, or you would be driving a character
    // the room keeps solid.
    // (`steeredSheet` above is this same question asked of the SHEET - vision
    // already read the acting body correctly; only the camera read `player`.)
    const steeredBody = steeredActor();
    const pp = steeredBody.entity ? steeredBody.entity.getPosition() : steeredBody;
    controls.follow({ x: pp.x, z: pp.z }, dt);
    updateWallFade(controls.cameraEntity, steeredBody.entity ? steeredBody.entity.getPosition() : null);
  });

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
    // The desk. openDesk frames the spawn tile close and head-on (eye-ish
    // level, aimed at the chest) and parades the browsed candidate there; it is
    // its own function because BACK out of the creation card returns here, and
    // a screen you can only reach once is a screen you cannot back out of.
    openDesk();
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
    // Layered levels (feasibility spike): which storey the leader is on, and
    // each storey's base height - what lets a spec project a mezzanine tile.
    get playerLayer() { return playerLayer; },
    get layerBaseY() { return floors ? floors.baseY : [0]; },
    // Is the leader mid-walk? The suite's honest alternative to sleeping: a
    // spec that wants "and then nothing happens" can poll for stillness rather
    // than guess a duration, which under software GL is reliably either too
    // short or wasteful on different runs.
    get playerMoving() { return !!player?.moving || legQueue.length > 0 || !!climbAnim; },
    // Sneak state for the suite: the mode, and whether any watcher currently
    // sees the leader's body - the same predicate the sweep runs.
    get sneak() { return sneak ? { mode: sneak.mode } : null; },
    get leaderSeen() {
      if (!player?.entity) return false;
      const p = player.entity.getPosition();
      return anyWatcherSees({ x: p.x, z: p.z });
    },
    get playerPos() {
      const p = player.entity?.getPosition();
      return p ? { x: p.x, z: p.z } : { x: player.x, z: player.z };
    },
    // Where the body you are STEERING is - the camera's follow target. Out of
    // a fight this is `playerPos`; in one it is the acting member, which is a
    // DIFFERENT body the moment a shared turn hands you a teammate. The camera
    // specs assert against this one, because asserting against `playerPos`
    // is what let the follow read the leader for so long: with a one-member
    // party the two agree, and the spec passed on a true negative.
    get steeredPos() {
      const a = steeredActor();
      const p = a.entity?.getPosition();
      return p ? { x: p.x, z: p.z } : { x: a.x, z: a.z };
    },
    // Where the camera actually sits, for tests that assert on the framing
    // (the tactical view collapses the horizontal offset to ~nothing).
    get cameraPos() {
      const c = controls.cameraEntity.getPosition();
      return { x: c.x, y: c.y, z: c.z };
    },
    // The point the rig is looking at, and whether a keyboard pan has
    // detached it from the follow target - the pair the camera specs assert
    // on (cameraPos moves with pitch/zoom too, which is noise to them).
    get cameraFocus() { return controls.focus; },
    get cameraFree() { return controls.panning; },
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
    // The hidden pools (TACTICS_PLAN M8) - the demolition specs' only honest
    // window: the tile keeps its type until the pool empties, so "the hit
    // landed" is invisible from the type grid alone.
    propHpAt: (x, z) => grid.propHpAt(x, z),
    edgeHpAt: (x, z, nx, nz) => grid.edgeHpBetween(x, z, nx, nz),
    // The leader's out-of-combat crouch, for the specs that seed a fight
    // with one (TACTICS_PLAN M6 OOC).
    get oocCrouch() { return oocCrouch; },
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
    // For the sneak specs: a wandering watcher's cone drifts, and a spec
    // about DETECTION must not flake on where an amble happened to point a
    // gaze. Maxing the existing timer stills them without a special case in
    // the wander brain itself.
    debugStillEnemies: () => {
      for (const en of enemies) en.wanderTimer = Infinity;
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
      // In combat this steers the open shared turn instead - refused unless
      // party.members[i] is holding the floor (INITIATIVE_PLAN). Returns
      // whether the steer was ACCEPTED, because refusal is the common case
      // (no shared turn this round) and a spec that cannot tell "it steered"
      // from "it declined" has to guess which one it just asserted about.
      if (!inCombat) { switchLeader(i); return true; }
      return !!combat?.steerMember(party?.members[i]);
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
    // Talents are their own axis (TALENT_PLAN M1) and the picker that spends
    // talent points is M2, so this is how a test takes one through the real
    // grant path rather than hand-writing an effects bag.
    grantTalent: (sheet, talentId) => grantTalent(sheet, talentId),
    get doors() { return [...grid.doors].map(([key, d]) => ({ key, open: d.open })); },
    // Open or shut a door with no walk, no click and no AP. A door is the
    // only terrain a fight can change, so a test that needs one SHUT mid-fight
    // otherwise has to park the acting member on an exact tile and click an
    // edge midpoint that a frame's drift turns back into an ordinary step.
    // Same edit the player's own toggle makes (doors.setDoorOpen) - the price
    // and the gating are what this skips, not the rule.
    setDoor(key, open) {
      if (!grid.doors.has(key)) return false;
      doors.setDoorOpen(key, !!open);
      return true;
    },
    // Open a fight WHERE EVERYBODY STANDS, through the same entry the real
    // trigger uses (beginCombat) with the same engaged set (ENGAGE_RADIUS +
    // canTakePart) - only the walk-in is skipped. That walk is what a spec
    // cannot control: it ends wherever adjacency happens to fire, so the
    // geometry a positional test staged is gone by the time the fight opens.
    //
    // Deliberately NOT wired into the e2e enterCombat helper. That was tried
    // once as `startFightNow` and reverted for a good reason: opening from
    // where the player stands changes the geometry the existing specs are
    // written against (a touch-range verb like Detain arrives out of reach).
    // Opt-in per spec, so nothing already green re-interprets itself.
    fight(primaryName = null) {
      if (!sheet || inCombat || gameOver || !player.entity) return false;
      const live = enemies.filter((e) => e.alive);
      const primary = (primaryName && live.find((e) => e.def.name === primaryName))
        || live.find((e) => canTakePart(player, e))
        || live[0];
      if (!primary) return false;
      const engaged = live.filter((e) =>
        Math.max(Math.abs(e.x - player.x), Math.abs(e.z - player.z)) <= ENGAGE_RADIUS
        && canTakePart(player, e));
      if (!engaged.includes(primary)) engaged.push(primary);
      beginCombat({ engaged, primary });
      return true;
    },
    setDoorOpen(key, open) {
      if (!grid.doors.has(key)) return;
      grid.setDoorOpen(key, open);
      scene.refreshDoor(key);
      for (const e of enemies) e.clearPath(); // their routes may have changed
    },
    // Resolves an ENEMY_TYPES id or a class archetype (e.g. 'employee'), so a
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
    // the employee files out (the tuning knob milestone 4 left open).
    summonAlly(archetypeId = 'employee', n = 1, lifetimeTurns = null) {
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
