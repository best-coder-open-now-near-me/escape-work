// Character sheet + progression. Pure logic - no PlayCanvas, no DOM.
import { CLASSES } from './data/classes.js';
import { COMPANIONS } from './data/companions.js';
import { ITEMS } from './data/items.js';

// Thrown-weapon ammo cap: paper picked up from spills, spent on throws.
// Every pickup/use site clamps against this one value.
export const PAPER_CAP = 8;

// --- attributes & derived stats ---------------------------------------------
// The four office attributes are a character's single source of truth for its
// combat numbers; maxHp/maxAp are DERIVED from them (the same shape the grid
// uses - a logical value derived from raw state). A sheet carries its four
// `attr` scores plus an innate `base` floor; recomputeDerived folds them into
// the stored maxHp/maxAp that combat and the HUD read.
//
// All the progression knobs live in one block so balancing is a single edit
// (and the god panel can pin them). Attribute POINTS, the class track, and
// Savvy/Composure driving damage/deflect arrive in later milestones; this
// milestone only makes attributes the stat SOURCE, calibrated so every
// character's level-1 numbers are byte-for-byte today's.
export const PROGRESSION = {
  HP_PER_GRIT: 2,       // each point of Grit adds this much max HP
  AP_PER_HUSTLE: 4,     // every N points of Hustle adds +1 max AP (AP is precious)
  DMG_PER_SAVVY: 3,     // every N points of Savvy adds +1 attack damage
  COMP_PER_DEFLECT: 4,  // every N points of Composure softens a hit by 1
  // One point of EACH type every level - a flat, consistent cadence, not
  // "attributes fast, class points slow".
  ATTR_PER_LEVEL: 1,    // attribute points banked per level-up
  CP_PER_LEVEL: 1,      // class points banked per level-up (spent on the track, M3)
};

export const ATTR_KEYS = ['grit', 'hustle', 'savvy', 'composure'];

// A clean {grit,hustle,savvy,composure} object from any partial source.
export function normalizeAttr(src = {}) {
  const attr = {};
  for (const k of ATTR_KEYS) attr[k] = Number.isFinite(src[k]) ? src[k] : 0;
  return attr;
}

// The innate floor that, added to the attribute contribution, reproduces a
// given maxHp/maxAp. Stored on the sheet so raising attributes always lands
// ABOVE today's numbers rather than redefining them.
function baseFrom(maxHp, maxAp, attr) {
  return {
    hp: maxHp - attr.grit * PROGRESSION.HP_PER_GRIT,
    ap: maxAp - Math.floor(attr.hustle / PROGRESSION.AP_PER_HUSTLE),
  };
}

// Fold attributes + base into the stored derived stats. Called after sheet
// creation, save-load backfill, and (later) every point spend. hp is clamped
// down to a shrunken max but never raised - healing is the caller's job.
export function recomputeDerived(sheet) {
  const { attr, base } = sheet;
  sheet.maxHp = base.hp + attr.grit * PROGRESSION.HP_PER_GRIT;
  sheet.maxAp = base.ap + Math.floor(attr.hustle / PROGRESSION.AP_PER_HUSTLE);
  if (sheet.hp > sheet.maxHp) sheet.hp = sheet.maxHp;
  return sheet;
}

// Backfill attributes onto a sheet from an older save (pre-attributes). Prefer
// the character's own class/companion spread; the base is computed from the
// sheet's SAVED maxHp/maxAp so the loaded character keeps the exact stats it
// was saved with either way. Idempotent - a sheet that already has attributes
// is just recomputed.
export function ensureAttributes(sheet) {
  if (sheet.attr && sheet.base) return recomputeDerived(sheet);
  const block = (sheet.classId && CLASSES[sheet.classId])
    || (sheet.companionId && COMPANIONS[sheet.companionId]) || null;
  sheet.attr = normalizeAttr(block?.attr);
  const maxHp = sheet.maxHp ?? sheet.hp;
  const maxAp = sheet.maxAp ?? block?.ap ?? 0;
  sheet.base = baseFrom(maxHp, maxAp, sheet.attr);
  return recomputeDerived(sheet);
}

// The sheet is the persistent record of one character - the player or a
// companion. Combat mutates hp in place so wounds carry between fights.
// `block` is any class-shaped stat source (data/classes.js, or a companion
// entry from data/companions.js); `extra` stamps identity fields on top
// (classId for classes, companionId for companions).
export function createSheetFrom(block, extra = {}) {
  const actions = [...block.actions];
  // Talents can grant an extra combat action (Smoker's cigarette).
  if (block.talent?.effects?.grantsAction) actions.push(block.talent.effects.grantsAction);
  const attr = normalizeAttr(block.attr);
  const maxHp = block.maxHp ?? block.hp;
  const base = baseFrom(maxHp, block.ap, attr); // reproduces the block's maxHp/ap
  const sheet = {
    className: block.name,
    name: block.name, // display name - the class label, or the companion's own
    model: block.model,
    hp: maxHp,
    maxHp,
    maxAp: block.ap,
    attr, // the four office attributes - the source maxHp/maxAp derive from
    base, // innate floor; growth stacks on top (recomputeDerived)
    attrPoints: 0, // unspent attribute points, banked by gainXp, spent by hand
    classPoints: 0, // unspent class points, banked alongside (spent on the track)
    perks: [], // class-track node ids taken; each node's effect is baked in place
    level: 1,
    xp: 0,
    xpNext: 10,
    bonusDmg: block.bonusDmg,
    actions,
    talent: block.talent || null,
    paper: 0, // thrown-weapon ammo, picked up from paper spills
    bleed: 0, // paper-cut bleeding: lose 1 HP for this many more tiles
    gum: 0, // gum on shoe: slowed, no kicking, can't slip - for this many tiles
    inventory: [], // looted item ids (data/items.js) - persists across floors
    ...extra,
  };
  recomputeDerived(sheet); // no-op at creation (base was solved to match), but
  sheet.hp = sheet.maxHp;  // the invariant that keeps maxHp derived, not stored
  return sheet;
}

export function createSheet(classId) {
  const cls = CLASSES[classId];
  if (!cls) throw new Error(`Unknown class "${classId}"`);
  return createSheetFrom(cls, { classId });
}

// Normalize any unit archetype - an ENEMY_TYPES def or a class - into the
// combat stats the AI reads. The only field that differs by registry is max
// HP (enemies spell it `hp`, classes `maxHp`); everything else already lines
// up. This is the seam the class-as-shared-archetype direction widens: an
// AI-driven unit reads its stats through here whether it came from the enemy
// registry or the class registry (see SUMMON_PLAN.md).
export function unitCombat(def) {
  return {
    name: def.name,
    model: def.model,
    maxHp: def.maxHp ?? def.hp,
    ap: def.ap,
    attackAp: def.attackAp,
    attacks: def.attacks || [],
    xp: def.xp ?? 0,
    loot: def.loot || [],
  };
}

// Total damage bonus: Savvy (the office damage stat) + any flat class/item
// bonus. `bonusDmg` is the class/legacy flat bump (0 for every current class -
// damage now grows by spending points into Savvy, not automatically per level);
// the best carried item still counts (one stapler at a time, however many you
// hoard).
export function damageBonus(sheet) {
  let item = 0;
  for (const id of sheet.inventory || []) item = Math.max(item, ITEMS[id]?.bonusDmg || 0);
  const savvy = Math.floor((sheet.attr?.savvy || 0) / PROGRESSION.DMG_PER_SAVVY);
  return (sheet.bonusDmg || 0) + savvy + item;
}

// Composure buys flat damage mitigation - a small amount shaved off every
// incoming hit (one point of damage always lands, so it never fully negates).
export function deflect(sheet) {
  return Math.floor((sheet.attr?.composure || 0) / PROGRESSION.COMP_PER_DEFLECT);
}

// Returns true when the character levelled up ("got promoted"). Level-ups fully
// heal and BANK attribute points; the player spends them on the level-up screen
// (companions included - nothing auto-allocates). Damage no longer rises
// automatically - it comes from spending those points into Savvy.
export function gainXp(sheet, amount) {
  sheet.xp += amount;
  let promoted = false;
  while (sheet.xp >= sheet.xpNext) {
    sheet.xp -= sheet.xpNext;
    sheet.xpNext = Math.round(sheet.xpNext * 1.5);
    sheet.level += 1;
    sheet.attrPoints = (sheet.attrPoints || 0) + PROGRESSION.ATTR_PER_LEVEL;
    sheet.classPoints = (sheet.classPoints || 0) + PROGRESSION.CP_PER_LEVEL;
    sheet.hp = sheet.maxHp;
    promoted = true;
  }
  return promoted;
}

// Spend one banked attribute point raising `attr` by 1, then re-derive. Returns
// false (and changes nothing) if the pool is empty or the attribute unknown.
export function spendAttrPoint(sheet, attr) {
  if (!ATTR_KEYS.includes(attr) || (sheet.attrPoints || 0) <= 0) return false;
  sheet.attr[attr] += 1;
  sheet.attrPoints -= 1;
  recomputeDerived(sheet);
  return true;
}

// --- the class ability track (class points) ---------------------------------
// A track node is data on a class/companion (`track: [{ id, name, cost,
// requires?, effect }]`); its `effect` reuses the shapes the engine already
// understands, so spending a class point BAKES the effect into the sheet in
// place and every existing read site picks it up - no combat/stepping changes:
//   grantsAction: '<id>'      -> pushed onto sheet.actions (hotbar/combat render it)
//   attrBonus: { <attr>: n }  -> added to sheet.attr (recompute/damage/deflect read it)
//   talent: { <effect>: v }   -> merged into sheet.talent.effects (talentFxOf et al.)
// The perk id is recorded so the screen can grey a taken node; the baked state
// is what persists, so nothing is re-applied on load (no double-apply).
// (`upgradeAction` - patching an action's numbers - is deferred; it needs a
// combat-side action accessor. See PROGRESSION_PLAN.md.)
const TRACK_NODES = {};
for (const reg of [CLASSES, COMPANIONS]) {
  for (const def of Object.values(reg)) {
    for (const node of def.track || []) TRACK_NODES[node.id] = node;
  }
}

export const trackNode = (id) => TRACK_NODES[id] || null;

// The track the sheet's own class/companion offers.
export function classTrack(sheet) {
  const def = (sheet.classId && CLASSES[sheet.classId])
    || (sheet.companionId && COMPANIONS[sheet.companionId]) || null;
  return def?.track || [];
}

// A node is available when it isn't already taken, its prereqs are met, and the
// pool covers its cost.
export function nodeAvailable(sheet, node) {
  if (!node) return false;
  const perks = sheet.perks || [];
  if (perks.includes(node.id)) return false;
  if ((sheet.classPoints || 0) < (node.cost || 1)) return false;
  if (node.requires && !node.requires.every((r) => perks.includes(r))) return false;
  return true;
}

function bakeNodeEffect(sheet, effect = {}) {
  if (effect.grantsAction && !sheet.actions.includes(effect.grantsAction)) {
    sheet.actions.push(effect.grantsAction);
  }
  if (effect.attrBonus) {
    for (const k of ATTR_KEYS) sheet.attr[k] += effect.attrBonus[k] || 0;
  }
  if (effect.talent) {
    const base = sheet.talent?.effects || {};
    const merged = { ...base };
    for (const [k, v] of Object.entries(effect.talent)) {
      merged[k] = typeof v === 'number' ? (merged[k] || 0) + v : v;
    }
    sheet.talent = { name: sheet.talent?.name || 'Training', blurb: sheet.talent?.blurb || '', effects: merged };
  }
}

// Spend class points on a track node: validate, bake its effect, record the
// perk, re-derive. Returns false (changing nothing) if it isn't available.
export function spendClassPoint(sheet, nodeId) {
  const node = TRACK_NODES[nodeId];
  if (!nodeAvailable(sheet, node)) return false;
  bakeNodeEffect(sheet, node.effect);
  (sheet.perks = sheet.perks || []).push(nodeId);
  sheet.classPoints -= (node.cost || 1);
  recomputeDerived(sheet);
  return true;
}

export function applyDamage(sheet, amount) {
  sheet.hp = Math.max(0, sheet.hp - amount);
  return sheet.hp <= 0;
}
