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
