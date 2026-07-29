// Unit tests for character creation (CHARACTER_PLAN). The module exists from
// M2 on even though the flow does not yet - the first thing it has to prove is
// that dressing a body is IDEMPOTENT, because a build slider and a swatch row
// dress the same body dozens of times a second where every existing call site
// dressed each body exactly once.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// models.js reads `window.pc` at import time and uses Vec3/Color-ish objects.
// A minimal stub is enough: these two functions only read and write local
// transforms and material colours.
class Vec3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }
class Color {
  constructor(r = 1, g = 1, b = 1) { this.r = r; this.g = g; this.b = b; }
  clone() { return new Color(this.r, this.g, this.b); }
  copy(o) { this.r = o.r; this.g = o.g; this.b = o.b; return this; }
  set(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
}
globalThis.window = globalThis.window || {};
globalThis.window.pc = { Vec3, Color, Quat: class {}, math: { RAD_TO_DEG: 57.29577951308232 } };

const { applyCharacterProportions, cloneMaterials, tintMaterials } = await import('../../src/models.js');

// A bone: just a named node with a local position and scale.
const bone = (name, y = 0) => ({
  name,
  _pos: new Vec3(0, y, 0),
  _scale: new Vec3(1, 1, 1),
  getLocalPosition() { return this._pos; },
  setLocalPosition(x, yy, z) { this._pos = new Vec3(x, yy, z); },
  getLocalScale() { return this._scale; },
  setLocalScale(x, yy, z) { this._scale = new Vec3(x, yy, z); },
});

// A rigged mini: the bones applyCharacterProportions looks for, under a parent
// that receives the hip lift.
function rig() {
  const parent = bone('scene-node', 0);
  const bones = {
    root: bone('root'), 'leg-left': bone('leg-left', 0.5), 'leg-right': bone('leg-right', 0.5),
    torso: bone('torso'), head: bone('head'), 'arm-left': bone('arm-left'), 'arm-right': bone('arm-right'),
  };
  bones.root.parent = parent;
  return { parent, findByName: (n) => bones[n] || null };
}

test('applyCharacterProportions is idempotent - ten dressings equal one', () => {
  const build = { legs: 1.9, torso: 1.2 };
  const once = rig();
  applyCharacterProportions(once, build);
  const liftedOnce = once.parent.getLocalPosition().y;

  const many = rig();
  for (let i = 0; i < 10; i++) applyCharacterProportions(many, build);

  // The bug: the lift READ the current position and added to it, so by the
  // tenth slider tick the character was at the ceiling.
  assert.equal(many.parent.getLocalPosition().y, liftedOnce,
    'the hip lift must not accumulate across re-dressings');
  assert.ok(liftedOnce > 0, 'and it must actually lift - the test would pass on a no-op otherwise');
});

test('applyCharacterProportions returns to the same place when the build changes back', () => {
  const r = rig();
  applyCharacterProportions(r, { legs: 1.9 });
  const tall = r.parent.getLocalPosition().y;
  applyCharacterProportions(r, { legs: 1.55 });
  const short = r.parent.getLocalPosition().y;
  applyCharacterProportions(r, { legs: 1.9 });
  assert.equal(r.parent.getLocalPosition().y, tall, 'dragging a slider back and forth is stable');
  assert.ok(short < tall, 'and shorter legs really do sit lower');
});

// A render component holding one mesh instance with one material.
const entityWithMaterial = (rgb = [1, 1, 1]) => {
  const material = {
    diffuse: new Color(...rgb),
    emissive: new Color(0, 0, 0),
    clone() { const c = { ...this, diffuse: this.diffuse.clone(), emissive: this.emissive.clone() }; c.clone = this.clone; c.update = () => {}; return c; },
    update() {},
  };
  return { findComponents: () => [{ meshInstances: [{ material }] }] };
};

test('tintMaterials is idempotent - ten tints equal one', () => {
  const e = entityWithMaterial([0.8, 0.6, 0.4]);
  const mats = cloneMaterials(e);
  tintMaterials(mats, [0.5, 0.5, 0.5]);
  const { r, g, b } = mats[0].mat.diffuse;

  for (let i = 0; i < 9; i++) tintMaterials(mats, [0.5, 0.5, 0.5]);
  // The bug: multiplying the LIVE diffuse compounded, so clicking along a
  // swatch row walked the body toward black instead of between colours.
  assert.deepEqual(
    [mats[0].mat.diffuse.r, mats[0].mat.diffuse.g, mats[0].mat.diffuse.b], [r, g, b],
    're-tinting must recompute from the pristine colour');
  assert.ok(r < 0.8, 'and the tint must actually darken - a no-op would pass otherwise');
});

test('tintMaterials with no tint restores the original colours', () => {
  const e = entityWithMaterial([0.8, 0.6, 0.4]);
  const mats = cloneMaterials(e);
  tintMaterials(mats, [0.2, 0.2, 0.2]);
  tintMaterials(mats, null); // "none" is a choice, not a dead end
  assert.deepEqual(
    [mats[0].mat.diffuse.r, mats[0].mat.diffuse.g, mats[0].mat.diffuse.b], [0.8, 0.6, 0.4]);
});

test('cloneMaterials does not recolour the shared .glb material', () => {
  const e = entityWithMaterial([0.8, 0.6, 0.4]);
  const shared = e.findComponents()[0].meshInstances[0].material;
  const mats = cloneMaterials(e);
  tintMaterials(mats, [0.1, 0.1, 0.1]);
  assert.deepEqual([shared.diffuse.r, shared.diffuse.g, shared.diffuse.b], [0.8, 0.6, 0.4],
    'every other character built from this rig must be untouched');
});


// --- the two doors ----------------------------------------------------------
// A precut character is one of the six, played as written. A custom one is
// somebody you make. The rule that matters most is that neither door invents a
// second way to build a sheet: both end at createCharacter.
const {
  createDraft, createCharacter, draftModel, draftLook, draftName, draftAttr,
  spendDraftPoint, unspendDraftPoint, spentOn, pointsLeft, cleanName, pronounsOf, verb,
  CREATION_POINTS, NAME_MAX,
} = await import('../../src/creation.js');
const { createSheet } = await import('../../src/stats.js');
const { CLASSES } = await import('../../src/data/classes.js');
const { CUSTOM_RIGS } = await import('../../src/data/looks.js');
const { COMPANIONS } = await import('../../src/data/companions.js');
const { ENEMY_TYPES } = await import('../../src/data/enemies.js');

test('an untouched precut draft reproduces the class character exactly', () => {
  for (const id of Object.keys(CLASSES).filter((c) => CLASSES[c].playable !== false)) {
    const made = createCharacter(createDraft(id));
    const plain = createSheet(id);
    // Pronouns are the one field creation adds to a precut character.
    delete made.pronouns;
    assert.deepEqual(made, plain, `${id} built from an untouched draft is the class character`);
  }
});

test('a precut character is named for the job and carries no rig of its own', () => {
  const sheet = createCharacter(createDraft('security'));
  assert.equal(sheet.name, CLASSES.security.name);
  assert.equal(sheet.className, CLASSES.security.name);
  // No `rig` means it keeps tracking the class entry, so a later art change
  // still reaches a character who never chose otherwise.
  assert.equal(sheet.rig, undefined);
  assert.equal(sheet.model, CLASSES.security.model);
  assert.equal(draftLook(createDraft('security')), CLASSES.security.look);
});

test('a precut draft has no name or rig to edit in the first place', () => {
  const d = createDraft('office-drone');
  assert.equal(d.custom, undefined);
  assert.equal(d.name, undefined);
  assert.equal(d.rig, undefined);
  assert.equal(draftName(d), 'Office Drone');
});

test('a custom character types a name and takes a body nobody else wears', () => {
  const d = createDraft('it-support', { custom: true });
  assert.equal(d.custom, true);
  assert.ok(CUSTOM_RIGS.includes(d.rig), 'starts on a real custom rig');
  d.name = '  Dana   Wu  ';
  d.rig = CUSTOM_RIGS[1];
  const sheet = createCharacter(d);
  assert.equal(sheet.name, 'Dana Wu', 'collapsed and trimmed');
  assert.equal(sheet.className, CLASSES['it-support'].name, 'the JOB is still the job');
  assert.equal(sheet.rig, CUSTOM_RIGS[1]);
  assert.equal(sheet.model, CUSTOM_RIGS[1], 'the chosen body wins over the class body');
  assert.equal(draftLook(d), null, 'a borrowed rig carries no class look');
});

test('a custom character with a blank name falls back to the job', () => {
  const d = createDraft('mail-room', { custom: true });
  d.name = '   ';
  assert.equal(createCharacter(d).name, CLASSES['mail-room'].name);
});

test('a rig nobody offers is refused, and the class body takes over', () => {
  const d = createDraft('security', { custom: true });
  d.rig = 'executive'; // a boss's body - not in the custom wardrobe
  assert.equal(draftModel(d), CLASSES.security.model);
  assert.equal(createCharacter(d).rig, undefined);
});

test('draftModel falls back to the class body when nothing is chosen', () => {
  assert.equal(draftModel(createDraft('human-resources')), CLASSES['human-resources'].model);
});

// --- the wardrobe -----------------------------------------------------------
test('every custom rig is a .glb that actually ships', async () => {
  const { existsSync } = await import('node:fs');
  for (const rig of CUSTOM_RIGS) {
    assert.ok(existsSync(`assets/characters/${rig}.glb`), `assets/characters/${rig}.glb exists`);
  }
});

// The rule the old wardrobe broke. It offered all twelve rigs, so you could
// start the game wearing the Executive you fight on the last floor, or the IT
// person who later joins your party. A body belongs to whoever the game says it
// belongs to, and the custom wardrobe is only what is left over.
test('no custom rig is worn by anybody in the cast', () => {
  const taken = new Map();
  for (const [id, c] of Object.entries(CLASSES)) if (c.model) taken.set(c.model, `class "${id}"`);
  for (const [id, c] of Object.entries(COMPANIONS)) if (c.model) taken.set(c.model, `companion "${id}"`);
  for (const [id, c] of Object.entries(ENEMY_TYPES)) if (c.model) taken.set(c.model, `enemy "${id}"`);
  for (const rig of CUSTOM_RIGS) {
    assert.ok(!taken.has(rig),
      `custom rig "${rig}" is worn by ${taken.get(rig)} - take it out of CUSTOM_RIGS or give them another body`);
  }
});

test('the custom wardrobe is not empty', () => {
  assert.ok(CUSTOM_RIGS.length > 0, 'a custom character needs somewhere to start');
  assert.equal(new Set(CUSTOM_RIGS).size, CUSTOM_RIGS.length, 'no duplicates');
});

// --- the self-assessment ----------------------------------------------------
test('spent points actually land - the base residual does not cancel them', () => {
  const d = createDraft('office-drone');
  spendDraftPoint(d, 'grit');
  spendDraftPoint(d, 'grit');
  const sheet = createCharacter(d);
  const plain = createSheet('office-drone');
  assert.equal(sheet.attr.grit, plain.attr.grit + 2);
  assert.ok(sheet.maxHp > plain.maxHp, 'Grit moved the DERIVED number too');
  assert.equal(sheet.attrPoints, 0, 'both points are spent, none banked');
});

test('a draft spends at most its two points', () => {
  const d = createDraft('office-drone');
  for (let i = 0; i < 10; i++) spendDraftPoint(d, 'savvy');
  assert.equal(d.spends.length, CREATION_POINTS);
  assert.equal(pointsLeft(d), 0);
  unspendDraftPoint(d, 'savvy');
  assert.equal(pointsLeft(d), 1);
});

// Each row's minus takes back a point from THAT row. A single global undo
// popped whichever point was spent last, so undoing a row meant remembering
// what order you had clicked in.
test('taking a point back is per-attribute, not "whatever was last"', () => {
  const d = createDraft('office-drone');
  spendDraftPoint(d, 'grit');
  spendDraftPoint(d, 'savvy');
  assert.equal(spentOn(d, 'grit'), 1);
  assert.equal(spentOn(d, 'savvy'), 1);

  unspendDraftPoint(d, 'grit'); // the one spent FIRST
  assert.equal(spentOn(d, 'grit'), 0);
  assert.equal(spentOn(d, 'savvy'), 1, 'the other row is untouched');
  assert.equal(pointsLeft(d), 1);

  const base = CLASSES['office-drone'].attr;
  assert.equal(draftAttr(d).grit, base.grit);
  assert.equal(draftAttr(d).savvy, base.savvy + 1);
});

test('taking back from an empty row does nothing', () => {
  const d = createDraft('office-drone');
  spendDraftPoint(d, 'grit');
  unspendDraftPoint(d, 'composure'); // nothing of yours in that row
  assert.equal(pointsLeft(d), 1);
  assert.equal(spentOn(d, 'grit'), 1);
});

test('an unknown attribute is not spendable', () => {
  const d = createDraft('office-drone');
  spendDraftPoint(d, 'charisma');
  assert.equal(d.spends.length, 0);
});

test('both doors spend the same two points', () => {
  for (const custom of [false, true]) {
    const d = createDraft('security', { custom });
    assert.equal(pointsLeft(d), CREATION_POINTS);
    spendDraftPoint(d, 'composure');
    assert.equal(draftAttr(d).composure, CLASSES.security.attr.composure + 1);
  }
});

test('draftAttr previews the spend without minting a sheet', () => {
  const d = createDraft('middle-manager');
  assert.deepEqual(draftAttr(d), CLASSES['middle-manager'].attr);
  spendDraftPoint(d, 'hustle');
  assert.equal(draftAttr(d).hustle, CLASSES['middle-manager'].attr.hustle + 1);
});

test('a zero-allocation character still equals the class headline exactly', () => {
  for (const id of Object.keys(CLASSES).filter((c) => CLASSES[c].playable !== false)) {
    const sheet = createCharacter(createDraft(id));
    assert.equal(sheet.maxHp, CLASSES[id].maxHp, `${id} keeps its headline HP`);
    assert.equal(sheet.maxAp, CLASSES[id].ap, `${id} keeps its headline AP`);
  }
});

// --- names and pronouns -----------------------------------------------------
test('the name is cleaned, clamped, and falls back', () => {
  assert.equal(cleanName('  a   b  '), 'a b');
  assert.equal(cleanName('', 'Mail Room'), 'Mail Room');
  assert.equal(cleanName('x'.repeat(100)).length, NAME_MAX);
});

test('pronouns default to they/them and reject anything unknown', () => {
  const d = createDraft('office-drone');
  assert.equal(d.pronouns, 'they');
  d.pronouns = 'xyzzy';
  assert.equal(createCharacter(d).pronouns, 'they');
});

test('pronounsOf answers with words, and defaults to they/them', () => {
  assert.equal(pronounsOf({ pronouns: 'she' }).object, 'her');
  assert.equal(pronounsOf({}).subject, 'they');
  assert.equal(pronounsOf(null).possessive, 'their');
});

test('verb agreement handles singular they', () => {
  assert.equal(verb(pronounsOf({ pronouns: 'they' }), 'gather'), 'gather');
  assert.equal(verb(pronounsOf({ pronouns: 'he' }), 'gather'), 'gathers');
  assert.equal(verb(pronounsOf({ pronouns: 'she' }), 'go', 'es'), 'goes');
});
