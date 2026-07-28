// Character creation (CHARACTER_PLAN.md). Pure logic - no PlayCanvas, no DOM.
//
// Today you do not create a character, you pick one: `createSheet(classId)`
// mints a sheet in which every field - name, body, colour, numbers - is a copy
// of the class, so two players who both hire the Mail Room get byte-identical
// characters called the same thing. This module owns the part of that which is
// a rule rather than a screen.
//
// A DRAFT is what the creation UI edits; `createCharacter` turns one into a
// real sheet. Keeping them apart is deliberate: a draft is plain data a test
// builds in one line, and the sheet-building step carries an invariant that is
// very easy to break by touching attributes in the wrong order (see below).
import { createSheet, spendAttrPoint, ATTR_KEYS } from './stats.js';
import { CLASSES } from './data/classes.js';
import { RIGS, TINTS, BUILD_RANGE, clampBuild } from './data/looks.js';

// The house voice is already they/them - combat narrates the party in the third
// person and one victory line reads "They gather their things and go". A field
// makes that a choice instead of an accident. Deliberately NOT inferred from
// the typed name: a name does not tell you someone's pronouns, and a wrong
// guess misgenders a real person in a way the neutral default never does.
export const PRONOUNS = ['she', 'he', 'they'];
export const DEFAULT_PRONOUNS = 'they';

// Long enough for a real name, short enough that it cannot break the HUD card,
// the party bar or a combat line.
export const NAME_MAX = 24;

// The two points spent at the self-assessment. They go through the level-up
// screen's own spendAttrPoint, so creation adds no second point economy.
export const CREATION_POINTS = 2;

// Tidy a typed name: collapse runs of whitespace, trim, clamp. An empty result
// falls back rather than producing a nameless character - the field is
// prefilled with the class label, and clearing it means "use that".
export function cleanName(raw, fallback = '') {
  const cleaned = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return cleaned || fallback;
}

// A fresh draft for a class, holding exactly today's defaults. Creating from an
// untouched draft must reproduce today's character byte for byte, which is what
// makes "skip the paperwork" a real skip rather than a different character.
export function createDraft(classId) {
  const cls = CLASSES[classId];
  return {
    classId,
    name: cls?.name || '',
    pronouns: DEFAULT_PRONOUNS,
    // Appearance starts as EXACTLY what the class would have given you, so an
    // untouched draft is not merely similar to today's character but identical.
    // `rig: null` means "whatever the class wears" rather than naming it - so a
    // later art change still reaches a character who never chose otherwise.
    rig: null,
    tint: cls?.look?.tint || null,
    build: clampBuild(cls?.look?.build) || null,
    // Attribute keys chosen at the self-assessment, in order. An array rather
    // than a tally so the UI can show and undo them one at a time.
    spends: [],
  };
}

// The model a draft would wear: its chosen rig, or the class's own.
export const draftModel = (draft) =>
  (draft?.rig && RIGS[draft.rig] ? draft.rig : CLASSES[draft?.classId]?.model) || null;

// The look a draft would produce, or null when it has not departed from the
// class at all. Null matters: it is what lets `lookOf` fall through to the class
// entry, so a character who chose nothing keeps tracking the class forever
// rather than freezing a copy of it at creation.
export function draftLook(draft) {
  const cls = CLASSES[draft?.classId];
  const tint = draft?.tint || null;
  const build = clampBuild(draft?.build);
  const same = JSON.stringify({ tint, build })
    === JSON.stringify({ tint: cls?.look?.tint || null, build: clampBuild(cls?.look?.build) });
  if (same) return null;
  const look = {};
  if (tint) look.tint = tint;
  if (build) look.build = build;
  return Object.keys(look).length ? look : null;
}

// How many creation points a draft has left to spend.
export const pointsLeft = (draft) => CREATION_POINTS - (draft?.spends?.length || 0);

// Add a point to `attr` if the draft has one left. Returns the draft.
export function spendDraftPoint(draft, attr) {
  if (!ATTR_KEYS.includes(attr) || pointsLeft(draft) <= 0) return draft;
  draft.spends.push(attr);
  return draft;
}

// Take back the last point spent.
export function undoDraftPoint(draft) {
  draft.spends.pop();
  return draft;
}

// The attribute spread a draft would produce, without building a sheet. The
// self-assessment UI needs to show the running numbers, and asking this
// question by minting a throwaway sheet per keystroke is the kind of thing that
// makes a screen feel slow.
export function draftAttr(draft) {
  const base = { ...(CLASSES[draft?.classId]?.attr || {}) };
  for (const k of draft?.spends || []) base[k] = (base[k] || 0) + 1;
  return base;
}

// Turn a draft into a real character sheet.
//
// THE ORDER HERE IS LOAD-BEARING. `createSheet` runs the class spread through
// `baseFrom`, which solves the innate `base` residual so that a level-1
// character's DERIVED maxHp/maxAp reproduce the class's headline numbers
// exactly. Hand it a pre-modified attribute spread and it re-solves `base`
// against those same headline numbers - silently cancelling every point spent,
// and leaving a character whose sheet says +1 Grit and whose HP is unchanged.
//
// So: build from the PRISTINE class, then spend through the same
// `spendAttrPoint` the level-up screen uses. The invariant then holds by
// construction rather than by care - a draft with no spends produces exactly
// the sheet `createSheet(classId)` produces today.
export function createCharacter(draft) {
  const sheet = createSheet(draft.classId);
  sheet.name = cleanName(draft.name, sheet.className);
  sheet.pronouns = PRONOUNS.includes(draft.pronouns) ? draft.pronouns : DEFAULT_PRONOUNS;
  // Appearance is sheet-owned from here (lookOf resolves sheet -> class ->
  // companion), so only a DEPARTURE from the class is recorded. A character who
  // changed nothing carries no look and keeps tracking their class entry, which
  // is how a later art change still reaches them.
  const look = draftLook(draft);
  if (look) sheet.look = look;
  if (draft.rig && RIGS[draft.rig]) {
    sheet.rig = draft.rig;
    sheet.model = draft.rig; // normalizeSheet validates this against RIGS on load
  }
  // Bank the points, then spend them through the real function. Banking first
  // matters: spendAttrPoint refuses when the pool is empty, which is what stops
  // a malformed draft from handing out free attributes.
  const spends = (draft.spends || []).slice(0, CREATION_POINTS);
  sheet.attrPoints = (sheet.attrPoints || 0) + spends.length;
  for (const attr of spends) spendAttrPoint(sheet, attr);
  return sheet;
}
