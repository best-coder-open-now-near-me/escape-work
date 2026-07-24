// The party: the ordered roster of player-controlled characters. Pure logic -
// no PlayCanvas, no DOM. A member pairs a character sheet with its actor
// (opaque here - main.js owns the actors). `members[active]` is the LEADER:
// the character the player controls out of combat, and whose turn state is
// live in combat. Today the roster holds one member; recruitment
// (data/companions.js) grows it.
import { gainXp, createSheetFrom, ensureAttributes } from './stats.js';

export const PARTY_CAP = 3; // leader + 2 companions - see PARTY_PLAN.md
export const SAVE_VERSION = 3; // v3 adds attributes + banked points (PROGRESSION_PLAN.md)

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
function normalizeSheet(sheet) {
  sheet.inventory ||= []; // saves from before pockets existed
  sheet.paper ??= 0;
  sheet.bleed ??= 0;
  sheet.gum ??= 0;
  sheet.name ??= sheet.className;
  sheet.attrPoints ??= 0; // pre-M2 saves never banked any
  sheet.classPoints ??= 0;
  sheet.perks ??= []; // taken track nodes; effects are already baked into the sheet
  ensureAttributes(sheet); // pre-attribute saves get their class spread + derive
  return sheet;
}

// Parsed shape: { levelId, sheets, active } - or null if the save is not a
// progress record in any known format. Level validity is the caller's check.
export function parseProgress(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (Array.isArray(raw.party) && raw.party.length) {
    const active = Number.isInteger(raw.active) && raw.active >= 0 && raw.active < raw.party.length
      ? raw.active : 0;
    return { levelId: raw.levelId, sheets: raw.party.map(normalizeSheet), active };
  }
  if (raw.sheet && typeof raw.sheet === 'object') {
    return { levelId: raw.levelId, sheets: [normalizeSheet(raw.sheet)], active: 0 };
  }
  return null;
}
