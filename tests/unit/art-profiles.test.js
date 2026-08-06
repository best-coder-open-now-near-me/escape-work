import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_ART_PROFILE,
  ART_PROFILES,
  characterArt,
  tileArt,
} from '../../src/data/art-profiles.js';

test('ordinary source and test runs stay on built-in art', () => {
  assert.equal(ACTIVE_ART_PROFILE, 'default');
  assert.equal(characterArt('worker'), 'worker');
});

test('the Synty profile remaps presentation without changing gameplay data', () => {
  assert.equal(characterArt('worker', 'synty'), 'synty/generic-business-male');
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
