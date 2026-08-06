import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSurfaceField, SURFACE_QUANTUM } from '../../src/surface-field.js';

test('world points resolve against fine cells, including movement-tile edges', () => {
  const field = createSurfaceField({ width: 2, height: 1 });
  assert.equal(field.quantum, SURFACE_QUANTUM);
  field.setCell(0, 0, 'water');
  field.setCell(1, 0, 'coffee');
  assert.equal(field.surfaceAt(-0.49, -0.49), 'water');
  assert.equal(field.surfaceAt(0, -0.49), 'coffee');
  assert.equal(field.surfaceAt(-0.5, -0.5), 'water');
  assert.equal(field.surfaceAt(1.5, 0), null, 'the far map edge is exclusive');
  assert.equal(field.surfaceAt(-0.5001, 0), null, 'out-of-bounds never aliases an edge cell');
});

test('fillTile uses the configured resolution rather than assuming 2x2', () => {
  const field = createSurfaceField({ width: 2, height: 2, quantum: 0.25 });
  const changeSets = [];
  field.onChange((changeSet) => changeSets.push(changeSet));
  assert.equal(field.fillTile(1, 0, 'paper', { source: 'authored' }), true);
  assert.equal(field.size, 16);
  assert.equal(changeSets.length, 1, 'one authored tile is one atomic mutation');
  assert.equal(changeSets[0].changes.length, 16);
  assert.equal(field.surfaceAt(0.51, -0.49), 'paper');
  assert.equal(field.surfaceAt(1.49, 0.49), 'paper');
  assert.equal(field.surfaceAt(0.49, 0), null, 'the neighbouring movement tile stays bare');
  assert.equal(field.recordAt(1, 0).source, 'authored');
});

test('nested edits emit one change set and unchanged writes stay quiet', () => {
  const field = createSurfaceField({ width: 2, height: 1 });
  const changeSets = [];
  field.onChange((changeSet) => changeSets.push(changeSet));
  field.edit(() => {
    field.fillTile(0, 0, 'water');
    field.fillTile(1, 0, 'water');
  });
  assert.equal(changeSets.length, 1);
  assert.equal(changeSets[0].changes.length, 8);
  assert.equal(field.fillTile(0, 0, 'water'), false);
  assert.equal(changeSets.length, 1, 'repainting identical cells does not invalidate consumers');
});

test('clearing a movement tile removes only its fine cells', () => {
  const field = createSurfaceField({ width: 2, height: 1 });
  field.edit(() => {
    field.fillTile(0, 0, 'paper');
    field.fillTile(1, 0, 'coffee');
  });
  assert.equal(field.clearTile(0, 0), true);
  assert.equal(field.surfaceAt(0, 0), null);
  assert.equal(field.surfaceAt(1, 0), 'coffee');
  assert.equal(field.size, 4);
});

test('invalid resolutions fail where they are configured', () => {
  assert.throws(
    () => createSurfaceField({ width: 1, height: 1, quantum: 0.3 }),
    /divide one movement tile exactly/,
  );
});
