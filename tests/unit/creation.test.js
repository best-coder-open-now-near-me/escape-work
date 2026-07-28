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

// --- the draft -> sheet rule (CHARACTER_PLAN M3/M5) ------------------------
const {
  createDraft, createCharacter, cleanName, spendDraftPoint, undoDraftPoint,
  pointsLeft, draftAttr, CREATION_POINTS, DEFAULT_PRONOUNS, NAME_MAX,
} = await import('../../src/creation.js');
const { createSheet } = await import('../../src/stats.js');
const { CLASSES } = await import('../../src/data/classes.js');

test('an untouched draft reproduces today character exactly', () => {
  // This is what makes "skip the paperwork" a real skip rather than a subtly
  // different character - and it is the invariant the whole ordering rule in
  // createCharacter exists to protect.
  for (const id of Object.keys(CLASSES).filter((k) => CLASSES[k].playable !== false)) {
    const picked = createSheet(id);
    const created = createCharacter(createDraft(id));
    for (const field of ['className', 'maxHp', 'maxAp', 'level', 'bonusDmg']) {
      assert.deepEqual(created[field], picked[field], `${id}: ${field}`);
    }
    assert.deepEqual(created.attr, picked.attr, `${id}: attributes`);
    assert.deepEqual(created.base, picked.base, `${id}: the solved base residual`);
  }
});

test('spent points actually land - the base residual does not cancel them', () => {
  // The trap: feeding a MODIFIED spread into createSheet re-solves `base`
  // against the class's headline maxHp/maxAp, so the sheet would read +1 Grit
  // with unchanged HP. Building pristine and then spending avoids it.
  const plain = createSheet('office-drone');
  const draft = createDraft('office-drone');
  spendDraftPoint(draft, 'grit');
  spendDraftPoint(draft, 'grit');
  const built = createCharacter(draft);

  assert.equal(built.attr.grit, plain.attr.grit + 2, 'the attribute rose');
  assert.ok(built.maxHp > plain.maxHp, 'and the derived HP rose with it');
  assert.equal(built.attrPoints, 0, 'both points were spent, not banked');
});

test('a draft spends at most its two points', () => {
  const draft = createDraft('office-drone');
  assert.equal(pointsLeft(draft), CREATION_POINTS);
  for (let i = 0; i < 10; i++) spendDraftPoint(draft, 'savvy');
  assert.equal(draft.spends.length, CREATION_POINTS, 'the pool is a hard cap');
  assert.equal(pointsLeft(draft), 0);

  undoDraftPoint(draft);
  assert.equal(pointsLeft(draft), 1, 'and a point can be taken back');
  assert.equal(draftAttr(draft).savvy, CLASSES['office-drone'].attr.savvy + 1,
    'draftAttr previews the spread without minting a sheet');
});

test('an unknown attribute is not spendable', () => {
  const draft = createDraft('office-drone');
  spendDraftPoint(draft, 'charisma'); // not an office attribute
  assert.equal(draft.spends.length, 0);
});

test('the name is cleaned, clamped, and falls back to the job', () => {
  assert.equal(cleanName('  Dana   Scully  '), 'Dana Scully', 'runs of whitespace collapse');
  assert.equal(cleanName('x'.repeat(200)).length, NAME_MAX, 'and it cannot break the HUD card');
  assert.equal(cleanName('   ', 'Mail Room'), 'Mail Room', 'clearing the field means "use the job"');
  assert.equal(cleanName(null, 'Mail Room'), 'Mail Room');
});

test('pronouns default to they/them and reject anything unknown', () => {
  const draft = createDraft('office-drone');
  assert.equal(createCharacter(draft).pronouns, DEFAULT_PRONOUNS);
  assert.equal(createCharacter({ ...draft, pronouns: 'she' }).pronouns, 'she');
  assert.equal(createCharacter({ ...draft, pronouns: 'xyzzy' }).pronouns, DEFAULT_PRONOUNS,
    'a malformed draft falls back rather than storing junk');
});

test('a typed name survives onto the sheet, and className stays the job', () => {
  const draft = createDraft('mail-room');
  draft.name = 'Dana';
  const sheet = createCharacter(draft);
  assert.equal(sheet.name, 'Dana');
  assert.equal(sheet.className, CLASSES['mail-room'].name,
    'every rule that reads the JOB keeps reading the job');
});

// --- the wardrobe (CHARACTER_PLAN M4) --------------------------------------
const { RIGS, TINTS, BUILD_RANGE, clampBuild } = await import('../../src/data/looks.js');
const { draftModel, draftLook } = await import('../../src/creation.js');
const { lookOf } = await import('../../src/stats.js');
const fs = await import('node:fs');

test('every rig in the wardrobe is a .glb that actually ships', () => {
  // A rig naming a missing asset is a character who cannot be rendered - the
  // failure arrives as a blank spawn tile, which reads as an engine bug.
  const shipped = new Set(fs.readdirSync('assets/characters')
    .filter((f) => f.endsWith('.glb')).map((f) => f.replace(/\.glb$/, '')));
  for (const id of Object.keys(RIGS)) {
    assert.ok(shipped.has(id), `RIGS.${id} has no assets/characters/${id}.glb`);
  }
});

test('every class model is offerable as a rig', () => {
  // Otherwise a class could wear a body the player is not allowed to choose,
  // which makes the wardrobe read as arbitrary rather than complete.
  for (const [id, cls] of Object.entries(CLASSES)) {
    if (cls.playable === false || !cls.model) continue;
    assert.ok(RIGS[cls.model], `${id} wears "${cls.model}", which is not in RIGS`);
  }
});

test('every tint darkens or shifts - none of them brighten', () => {
  // Tints multiply the rig's baked diffuse, so a channel above 1 would blow the
  // colour out rather than tint it.
  for (const t of TINTS) {
    assert.equal(t.rgb.length, 3, `${t.id} needs three channels`);
    for (const c of t.rgb) {
      assert.ok(c > 0 && c <= 1, `${t.id} channel ${c} must be within (0, 1]`);
    }
  }
  assert.equal(new Set(TINTS.map((t) => t.id)).size, TINTS.length, 'tint ids are unique');
});

test('the build dials stay inside the range the shipped art already uses', () => {
  for (const [key, r] of Object.entries(BUILD_RANGE)) {
    assert.ok(r.min < r.max, `${key} range is inverted`);
    assert.ok(r.step > 0, `${key} needs a step`);
    assert.ok(r.label, `${key} needs a player-facing label`);
  }
  // clampBuild is the gate everything passes through - a hand-edited save, an
  // older palette, a future re-tune. applyCharacterProportions has no opinion
  // about what is sane and a torso of 40 is a broken-looking body.
  assert.deepEqual(clampBuild({ legs: 99, torso: -5 }),
    { legs: BUILD_RANGE.legs.max, torso: BUILD_RANGE.torso.min });
  assert.equal(clampBuild(null), null);
  assert.equal(clampBuild({ nonsense: 3 }), null, 'unknown dials are dropped, not clamped');
});

test('an untouched draft records NO look, so it keeps tracking its class', () => {
  // The difference matters: freezing a copy of the class look at creation would
  // mean a later art change never reaches a character who chose nothing.
  const draft = createDraft('office-drone');
  assert.equal(draftLook(draft), null);
  const sheet = createCharacter(draft);
  assert.equal(sheet.look, undefined);
  assert.deepEqual(lookOf(sheet), CLASSES['office-drone'].look ?? null);
});

test('a chosen rig and tint land on the sheet and win over the class', () => {
  const draft = createDraft('office-drone');
  draft.rig = 'executive';
  draft.tint = TINTS[2].rgb;
  const sheet = createCharacter(draft);
  assert.equal(sheet.rig, 'executive');
  assert.equal(sheet.model, 'executive', 'the body follows the choice');
  assert.deepEqual(lookOf(sheet).tint, TINTS[2].rgb);
  assert.equal(draftModel(draft), 'executive');
});

test('draftModel falls back to the class body when nothing is chosen', () => {
  assert.equal(draftModel(createDraft('it-support')), CLASSES['it-support'].model);
  assert.equal(draftModel({ classId: 'it-support', rig: 'not-a-rig' }), CLASSES['it-support'].model,
    'an unknown rig is ignored rather than rendered');
});

// --- backgrounds (CHARACTER_PLAN M5) ---------------------------------------
const { BACKGROUNDS } = await import('../../src/data/backgrounds.js');
const { ITEMS } = await import('../../src/data/items.js');
const { ACTIONS } = await import('../../src/data/actions.js');
const { EQUIP_SLOTS, ATTR_KEYS } = await import('../../src/stats.js');

test('every background is a SWAP - its attrBonus sums to zero', () => {
  // The load-bearing lint. Eight free stat lifts at creation would blow through
  // the curve-neutrality rule startGear was introduced under, and would make
  // exactly one background correct for every class. A swap costs something.
  for (const [id, bg] of Object.entries(BACKGROUNDS)) {
    const bonus = bg.effect?.attrBonus || {};
    const sum = Object.values(bonus).reduce((a, b) => a + b, 0);
    assert.equal(sum, 0, `${id} sums to ${sum} - a background must give and take`);
    assert.ok(Object.keys(bonus).length >= 2, `${id} must move at least two attributes`);
    for (const k of Object.keys(bonus)) {
      assert.ok(ATTR_KEYS.includes(k), `${id} moves "${k}", which is not an attribute`);
    }
  }
});

test('every background is presentable and its content resolves', () => {
  for (const [id, bg] of Object.entries(BACKGROUNDS)) {
    assert.ok(bg.name && bg.blurb && bg.line, `${id} needs name, blurb and read-back line`);
    for (const [slot, itemId] of Object.entries(bg.gear || {})) {
      assert.ok(EQUIP_SLOTS.includes(slot), `${id} names slot "${slot}"`);
      assert.ok(ITEMS[itemId], `${id} grants "${itemId}", which is not an item`);
      assert.equal(ITEMS[itemId].slot, slot, `${id}: ${itemId} does not go in ${slot}`);
    }
    if (bg.effect?.grantsAction) {
      assert.ok(ACTIONS[bg.effect.grantsAction], `${id} grants a missing action`);
    }
  }
});

test('a background swap lands on the sheet and moves the derived numbers', () => {
  const plain = createCharacter(createDraft('office-drone'));
  const draft = createDraft('office-drone');
  draft.background = 'night-shift'; // +1 grit, -1 hustle
  const built = createCharacter(draft);

  assert.equal(built.background, 'night-shift', 'recorded as what happened');
  assert.equal(built.attr.grit, plain.attr.grit + 1);
  assert.equal(built.attr.hustle, plain.attr.hustle - 1);
  assert.ok(built.maxHp > plain.maxHp, 'and Grit really did buy HP');
  assert.equal(built.hp, built.maxHp, 'a fresh character starts whole');
});

test('a background fills only an EMPTY slot - the class keeps its signature piece', () => {
  // Expensed It grants a stress ball, which is also the Drone's own startGear.
  const drone = createDraft('office-drone');
  drone.background = 'expensed-it';
  const droneSheet = createCharacter(drone);
  const plainDrone = createCharacter(createDraft('office-drone'));
  assert.equal(droneSheet.equipped.trinket, plainDrone.equipped.trinket,
    'the Drone keeps the class trinket - nothing was overwritten');

  // Any other class arrives carrying one.
  const other = createDraft('it-support');
  other.background = 'expensed-it';
  const otherSheet = createCharacter(other);
  assert.equal(otherSheet.equipped.trinket, 'stress-ball');
  assert.equal(otherSheet.equipped.weapon, createCharacter(createDraft('it-support')).equipped.weapon,
    'and its own weapon is untouched');
});

test('a background talent merges rather than replacing the class talent', () => {
  const draft = createDraft('office-drone');
  draft.background = 'former-smoker';
  const sheet = createCharacter(draft);
  assert.equal(sheet.talent.effects.hasLighter, true, 'the background verb arrived');
  // The class's own talent effects must survive the merge.
  const plain = createCharacter(createDraft('office-drone'));
  for (const [k, v] of Object.entries(plain.talent?.effects || {})) {
    assert.deepEqual(sheet.talent.effects[k], v, `class talent effect "${k}" survived`);
  }
});

test('a zero-allocation character still equals the class headline exactly', () => {
  // The invariant, restated with backgrounds in the picture: choosing NO
  // background and spending NO points must reproduce the class byte for byte.
  for (const id of Object.keys(CLASSES).filter((k) => CLASSES[k].playable !== false)) {
    const created = createCharacter(createDraft(id));
    assert.equal(created.maxHp, CLASSES[id].maxHp, `${id} maxHp`);
    assert.equal(created.maxAp, CLASSES[id].ap, `${id} maxAp`);
  }
});

test('draftAttr previews the background swap and the points together', () => {
  const draft = createDraft('office-drone');
  draft.background = 'night-shift';
  spendDraftPoint(draft, 'grit');
  const preview = draftAttr(draft);
  const built = createCharacter(draft);
  assert.deepEqual(preview, built.attr, 'the preview must match what commit produces');
});
