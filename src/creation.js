// Character creation (CHARACTER_PLAN.md). Pure logic - no PlayCanvas, no DOM.
//
// There are two ways in, and they are different doors rather than one door with
// a corridor behind it:
//
//   PRECUT - you pick one of the six people this game is about. They are their
//     job: named for it, wearing its rig, carrying its kit. Nothing about them
//     is a blank for you to fill in, because they are somebody already.
//   CUSTOM - you make one. You choose a name, whose job you do (for the kit),
//     and a body from the rigs nobody else wears.
//
// Both then spend two points at the self-assessment, and that is the whole of
// creation.
//
// It used to be one funnel: every start walked into a customization screen that
// offered a typed name, a colour palette, two build sliders and a "so why are
// you still here" background axis, on top of a wardrobe of all twelve rigs -
// including the ones worn by the bosses. None of that was asked for. What it
// cost was the precut characters: you could not play one AS WRITTEN without
// declining a form, and the form's own defaults did not match the bodies it was
// previewing.
//
// A DRAFT is what the creation UI edits; `createCharacter` turns one into a
// real sheet. Keeping them apart is deliberate: a draft is plain data a test
// builds in one line, and the sheet-building step carries an invariant that is
// very easy to break by touching attributes in the wrong order (see below).
import { createSheet, spendAttrPoint, ATTR_KEYS } from './stats.js';
import { CLASSES } from './data/classes.js';
import { CUSTOM_RIGS } from './data/looks.js';

// The house voice is already they/them - combat narrates the party in the third
// person and one victory line reads "They gather their things and go". A field
// makes that a choice instead of an accident. Deliberately NOT inferred from
// the typed name: a name does not tell you someone's pronouns, and a wrong
// guess misgenders a real person in a way the neutral default never does.
export const PRONOUNS = ['she', 'he', 'they'];
export const DEFAULT_PRONOUNS = 'they';

// The words each choice produces. Narration already speaks about the party in
// the third person, so these are what a line needs to be able to ask for -
// storing 'they' and leaving every caller to map it would guarantee that some
// line somewhere hardcodes one.
// `plural` drives VERB AGREEMENT, which is the part a caller cannot work out
// for itself: singular they takes a plural verb ("they gather"), so a line that
// only had the pronoun would still have to special-case it.
const PRONOUN_WORDS = {
  she: { subject: 'she', object: 'her', possessive: 'her', reflexive: 'herself', plural: false },
  he: { subject: 'he', object: 'him', possessive: 'his', reflexive: 'himself', plural: false },
  they: { subject: 'they', object: 'them', possessive: 'their', reflexive: 'themselves', plural: true },
};

// A character's pronoun words, defaulting to they/them for anyone who predates
// the field - which is what the house voice already used.
export const pronounsOf = (sheet) =>
  PRONOUN_WORDS[sheet?.pronouns] || PRONOUN_WORDS[DEFAULT_PRONOUNS];

// Capitalise a pronoun for the start of a sentence.
export const capitalize = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);

// Agree a verb with a character's pronoun. Pass the bare stem; singular gets
// the 's'. `es` is for stems that need it ("goes"), which English will not let
// us infer from the stem alone.
export const verb = (words, stem, suffix = 's') => (words.plural ? stem : stem + suffix);

// Long enough for a real name, short enough that it cannot break the HUD card,
// the party bar or a combat line.
export const NAME_MAX = 24;

// The two points spent at the self-assessment. They go through the level-up
// screen's own spendAttrPoint, so creation adds no second point economy.
export const CREATION_POINTS = 2;

// Tidy a typed name: collapse runs of whitespace, trim, clamp. An empty result
// falls back rather than producing a nameless character.
export function cleanName(raw, fallback = '') {
  const cleaned = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return cleaned || fallback;
}

// A fresh draft. `custom` is what makes the two doors different: a precut
// character is named for the job and wears its rig, and neither is editable, so
// the draft simply does not carry the fields that would edit them.
export function createDraft(classId, { custom = false } = {}) {
  const draft = { classId, pronouns: DEFAULT_PRONOUNS, spends: [] };
  if (custom) {
    draft.custom = true;
    draft.name = '';
    draft.rig = CUSTOM_RIGS[0];
  }
  return draft;
}

// The model a draft would wear: a custom character's chosen rig, or - for one
// of the six - the class's own, which is not up for discussion.
export const draftModel = (draft) =>
  (draft?.custom && CUSTOM_RIGS.includes(draft.rig) ? draft.rig : CLASSES[draft?.classId]?.model) || null;

// The look a draft would produce. A custom character on a borrowed rig gets no
// look of its own; a precut one keeps tracking its class entry forever, which
// is what lets a later art change still reach it.
export const draftLook = (draft) => (draft?.custom ? null : CLASSES[draft?.classId]?.look || null);

// The name a draft would produce: what a custom character typed, or the job.
export const draftName = (draft) => {
  const job = CLASSES[draft?.classId]?.name || '';
  return draft?.custom ? cleanName(draft.name, job) : job;
};

// How many creation points a draft has left to spend.
export const pointsLeft = (draft) => CREATION_POINTS - (draft?.spends?.length || 0);

// How many of the creation points went into one attribute.
export const spentOn = (draft, attr) =>
  (draft?.spends || []).filter((k) => k === attr).length;

// Add a point to `attr` if the draft has one left. Returns the draft.
export function spendDraftPoint(draft, attr) {
  if (!ATTR_KEYS.includes(attr) || pointsLeft(draft) <= 0) return draft;
  draft.spends.push(attr);
  return draft;
}

// Take a point back OUT of `attr`. Per-attribute rather than "pop the last
// one": the screen shows four rows of numbers going up and down, so the way to
// undo a row is a button on that row. A single global undo made the player
// remember what order they had clicked in to work out what it would take away.
export function unspendDraftPoint(draft, attr) {
  const i = (draft?.spends || []).lastIndexOf(attr);
  if (i >= 0) draft.spends.splice(i, 1);
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
  sheet.name = draftName(draft);
  sheet.pronouns = PRONOUNS.includes(draft.pronouns) ? draft.pronouns : DEFAULT_PRONOUNS;
  // Only a custom character owns a body. One of the six wears their class's
  // rig and carries no `rig` at all, so they keep tracking the class entry
  // rather than freezing a copy of it at creation.
  if (draft.custom && CUSTOM_RIGS.includes(draft.rig)) {
    sheet.rig = draft.rig;
    sheet.model = draft.rig; // normalizeSheet validates this against CUSTOM_RIGS on load
  }
  // Bank the points, then spend them through the real function. Banking first
  // matters: spendAttrPoint refuses when the pool is empty, which is what stops
  // a malformed draft from handing out free attributes.
  const spends = (draft.spends || []).slice(0, CREATION_POINTS);
  sheet.attrPoints = (sheet.attrPoints || 0) + spends.length;
  for (const attr of spends) spendAttrPoint(sheet, attr);
  return sheet;
}
