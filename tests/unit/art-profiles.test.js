import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_ART_PROFILE,
  ART_PROFILES,
  characterAccessory,
  characterArt,
  tileArt,
} from '../../src/data/art-profiles.js';
import { classesForProfile } from '../../src/data/classes.js';

test('ordinary source and test runs stay on built-in art', () => {
  assert.equal(ACTIVE_ART_PROFILE, 'default');
  assert.equal(characterArt('worker'), 'worker');
});

test('the Synty profile remaps presentation without changing gameplay data', () => {
  assert.equal(characterArt('worker', 'synty'), 'synty/generic-business-male');
  assert.deepEqual(
    Object.fromEntries(['worker', 'midmanager', 'mailroom', 'itsupport', 'hrrep', 'security']
      .map((model) => [model, characterArt(model, 'synty')])),
    {
      worker: 'synty/generic-business-male',
      midmanager: 'synty/generic-business-female',
      mailroom: 'synty/shops-worker-male',
      itsupport: 'synty/shops-clerk-male',
      hrrep: 'synty/shops-clerk-female',
      security: 'synty/shops-worker-female',
    },
  );
  const base = { solid: true, height: 0.5, primitive: 'printer', explosive: { damage: 8 } };
  const visual = tileArt('printer', base, 'synty');
  assert.equal(visual.model, 'synty/office/printer');
  assert.equal(visual.primitive, undefined);
  assert.equal(visual.solid, true);
  assert.equal(visual.height, 0.5);
  assert.deepEqual(visual.explosive, { damage: 8 });
  assert.deepEqual(base, {
    solid: true,
    height: 0.5,
    primitive: 'printer',
    explosive: { damage: 8 },
  });
});

test('every class-backed actor resolves its model through the active art profile', () => {
  const classes = classesForProfile('synty');
  assert.deepEqual(
    Object.fromEntries(Object.entries(classes).map(([id, def]) => [id, def.model])),
    {
      'office-drone': 'synty/generic-business-male',
      'middle-manager': 'synty/generic-business-female',
      'mail-room': 'synty/shops-worker-male',
      'it-support': 'synty/shops-clerk-male',
      'human-resources': 'synty/shops-clerk-female',
      security: 'synty/shops-worker-female',
      employee: 'synty/generic-business-male',
    },
  );
});

test('the six Synty roles have distinct modular hairstyles', () => {
  const models = Object.values(ART_PROFILES.synty.characters);
  const hair = models.map((model) => characterAccessory(model, 'synty'));
  assert.equal(hair.length, 6);
  assert.equal(new Set(hair.map((accessory) => accessory.model)).size, 6);
  for (const accessory of hair) {
    assert.match(accessory.model, /^synty\/hair\//);
    assert.equal(accessory.scale, 100);
    assert.equal(accessory.color.length, 3);
  }
});

test('profile asset mappings are unique, relative, and GLB-only', () => {
  for (const [id, profile] of Object.entries(ART_PROFILES)) {
    const targets = new Set();
    for (const asset of profile.assets) {
      for (const path of [asset.from, asset.to]) {
        assert.ok(path.endsWith('.glb'), `${id}: ${path} is a runtime GLB`);
        assert.ok(!path.startsWith('/') && !path.includes('..'), `${id}: ${path} is relative`);
      }
      assert.ok(!targets.has(asset.to), `${id}: ${asset.to} is written once`);
      targets.add(asset.to);
    }
  }
});

test('every Synty character override has a build-time asset mapping', () => {
  const shipped = new Set(ART_PROFILES.synty.assets
    .map(({ to }) => to.replace(/^characters\//, '').replace(/\.glb$/, '')));
  for (const model of Object.values(ART_PROFILES.synty.characters)) {
    assert.ok(shipped.has(model), `${model} is copied into the build`);
  }
});

test('every Synty hairstyle has a build-time asset mapping', () => {
  const shipped = new Set(ART_PROFILES.synty.assets
    .map(({ to }) => to.replace(/^characters\//, '').replace(/\.glb$/, '')));
  for (const accessory of Object.values(ART_PROFILES.synty.characterAccessories)) {
    assert.ok(shipped.has(accessory.model), `${accessory.model} is copied into the build`);
  }
});
