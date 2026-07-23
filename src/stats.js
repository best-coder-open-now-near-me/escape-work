// Character sheet + progression. Pure logic - no PlayCanvas, no DOM.
import { CLASSES } from './data/classes.js';
import { ITEMS } from './data/items.js';

// Thrown-weapon ammo cap: paper picked up from spills, spent on throws.
// Every pickup/use site clamps against this one value.
export const PAPER_CAP = 8;

// The sheet is the persistent record of one character - the player or a
// companion. Combat mutates hp in place so wounds carry between fights.
// `block` is any class-shaped stat source (data/classes.js, or a companion
// entry from data/companions.js); `extra` stamps identity fields on top
// (classId for classes, companionId for companions).
export function createSheetFrom(block, extra = {}) {
  const actions = [...block.actions];
  // Talents can grant an extra combat action (Smoker's cigarette).
  if (block.talent?.effects?.grantsAction) actions.push(block.talent.effects.grantsAction);
  return {
    className: block.name,
    name: block.name, // display name - the class label, or the companion's own
    model: block.model,
    hp: block.maxHp,
    maxHp: block.maxHp,
    maxAp: block.ap,
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

// Total damage bonus: levels/class plus the best carried item (you can only
// wield one stapler at a time, however many you hoard).
export function damageBonus(sheet) {
  let item = 0;
  for (const id of sheet.inventory || []) item = Math.max(item, ITEMS[id]?.bonusDmg || 0);
  return (sheet.bonusDmg || 0) + item;
}

// Returns true when the character levelled up ("got promoted"). Level-ups
// fully heal and add +1 damage.
export function gainXp(sheet, amount) {
  sheet.xp += amount;
  let promoted = false;
  while (sheet.xp >= sheet.xpNext) {
    sheet.xp -= sheet.xpNext;
    sheet.xpNext = Math.round(sheet.xpNext * 1.5);
    sheet.level += 1;
    sheet.bonusDmg += 1;
    sheet.hp = sheet.maxHp;
    promoted = true;
  }
  return promoted;
}

export function applyDamage(sheet, amount) {
  sheet.hp = Math.max(0, sheet.hp - amount);
  return sheet.hp <= 0;
}
