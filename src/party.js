// The party: the ordered roster of player-controlled characters. Pure logic -
// no PlayCanvas, no DOM. A member pairs a character sheet with its actor
// (opaque here - main.js owns the actors). `members[active]` is the LEADER:
// the character the player controls out of combat, and whose turn state is
// live in combat. Today the roster holds one member; recruitment
// (data/companions.js) grows it.
import { gainXp, createSheetFrom, ensureAttributes, EQUIP_SLOTS } from './stats.js';
import { ITEMS } from './data/items.js';
import { CLASSES } from './data/classes.js';
import { COMPANIONS } from './data/companions.js';

export const PARTY_CAP = 3; // leader + 2 companions - see PARTY_PLAN.md
export const SAVE_VERSION = 5; // v5 adds equipment slots (EQUIPMENT_PLAN.md)

export function createParty(sheet, actor = null) {
  return { members: [{ sheet, actor }], active: 0 };
}

export const leader = (party) => party.members[party.active];

export const livingMembers = (party) => party.members.filter((m) => m.sheet.hp > 0);

// Returns the new member, or null when the roster is full.
export function addMember(party, sheet, actor = null) {
  if (party.members.length >= PARTY_CAP) return null;
  const member = { sheet, actor };
  party.members.push(member);
  return member;
}

// XP fan-out: every living member earns the full amount - nobody lags, no
// split bookkeeping. Returns the members who levelled up, so the caller can
// announce each promotion.
export function gainXpAll(party, amount) {
  return party.members.filter((m) => m.sheet.hp > 0 && gainXp(m.sheet, amount));
}

// A companion's sheet, promoted to match the leader's level so recruits are
// never dead weight (PARTY_PLAN.md: companions join at the party's level).
export function createCompanionSheet(def, id, level = 1) {
  const sheet = createSheetFrom(def, { companionId: id });
  while (sheet.level < level) gainXp(sheet, sheet.xpNext - sheet.xp);
  return sheet;
}

// --- campaign progress -------------------------------------------------------
// current (SAVE_VERSION): { version, levelId, party: [sheet, ...], active }
//   - v3 added attributes + banked points; older v2 saves (same party shape,
//     pre-attributes) backfill on load via normalizeSheet/ensureAttributes.
// v1 (legacy): { levelId, sheet } - loads as a one-member party.
// parseProgress reads by SHAPE, so every version above loads without a switch.

export function serializeProgress(party, levelId) {
  return {
    version: SAVE_VERSION,
    levelId,
    party: party.members.map((m) => m.sheet),
    active: party.active,
  };
}

// Backfill fields older saves may predate, so no math ever meets undefined.
// `version` is the save's own version (0 when it predates the field): a
// migration that INVENTS state rather than defaulting it must run only for
// saves old enough to need it, or it re-applies itself on every single load.
function normalizeSheet(sheet, version = 0) {
  sheet.inventory ||= []; // saves from before pockets existed
  sheet.paper ??= 0;
  // v4: gum/bleed moved from numeric sheet fields into the status map. Carry any
  // in-flight step-clock counters from an older save across, then drop them.
  sheet.statuses ??= {};
  if (sheet.gum > 0 && !sheet.statuses.gum) sheet.statuses.gum = { left: sheet.gum };
  if (sheet.bleed > 0 && !sheet.statuses.bleed) sheet.statuses.bleed = { left: sheet.bleed };
  delete sheet.gum;
  delete sheet.bleed;
  sheet.name ??= sheet.className;
  // A character's MODEL is presentation derived from identity, not player
  // state, so re-derive it from the class/companion entry on every load rather
  // than trusting whatever was saved. That way art changes (new rigs landing,
  // a character reassigned to its own model) reach existing saves instead of
  // leaving old characters wearing the rig they were created with - and a save
  // can never point at a .glb that no longer exists.
  const block = (sheet.classId && CLASSES[sheet.classId])
    || (sheet.companionId && COMPANIONS[sheet.companionId]) || null;
  if (block?.model) sheet.model = block.model;
  sheet.attrPoints ??= 0; // pre-M2 saves never banked any
  sheet.classPoints ??= 0;
  sheet.perks ??= []; // taken track nodes; effects are already baked into the sheet
  // v5: equipment slots. The old "best carried stapler counts" rule became a
  // real weapon slot - auto-equip the best weapon still loose in the bag so no
  // migrated character loses the damage it used to get for free.
  sheet.equipped ??= {};
  for (const slot of EQUIP_SLOTS) sheet.equipped[slot] ??= null;
  // ...and only for a save that predates the slots. On a current save an empty
  // weapon slot is a CHOICE (you unequipped the stapler), and re-equipping the
  // best bag weapon every load quietly overrode it.
  if (version < 5 && !sheet.equipped.weapon) {
    let best = null;
    let bestDmg = 0;
    for (const id of sheet.inventory) {
      const it = ITEMS[id];
      if (it?.slot === 'weapon' && (it.stats?.dmg || 0) > bestDmg) { best = id; bestDmg = it.stats.dmg; }
    }
    if (best) {
      sheet.equipped.weapon = best;
      sheet.inventory.splice(sheet.inventory.indexOf(best), 1); // out of the bag, into the slot
    }
  }
  ensureAttributes(sheet); // pre-attribute saves get their class spread + derive
  return sheet;
}

// Parsed shape: { levelId, sheets, active } - or null if the save is not a
// progress record in any known format. Level validity is the caller's check.
export function parseProgress(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // Shape still decides HOW to read the save; `version` decides which one-time
  // migrations still need to run over it (0 for the pre-version legacy shape).
  const version = Number.isInteger(raw.version) ? raw.version : 0;
  if (Array.isArray(raw.party) && raw.party.length) {
    const active = Number.isInteger(raw.active) && raw.active >= 0 && raw.active < raw.party.length
      ? raw.active : 0;
    return { levelId: raw.levelId, sheets: raw.party.map((s) => normalizeSheet(s, version)), active };
  }
  if (raw.sheet && typeof raw.sheet === 'object') {
    return { levelId: raw.levelId, sheets: [normalizeSheet(raw.sheet, version)], active: 0 };
  }
  return null;
}
