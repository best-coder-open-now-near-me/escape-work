import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CROUCH_NO_COVER,
  CROUCH_NO_ROOM,
  crouchCoverCell,
  crouchFacesAt,
  crouchProblem,
  enterCrouch,
  leaveCrouch,
} from '../../src/crouch-rules.js';

test('the shared crouch refusal ladder is occupancy before cover', () => {
  assert.equal(crouchProblem({ here: false, roomFree: false, faces: 0 }), CROUCH_NO_ROOM);
  assert.equal(crouchProblem({ here: true, roomFree: false, faces: 0 }), CROUCH_NO_COVER);
  assert.equal(crouchProblem({ here: false, roomFree: true, faces: 1 }), null);
});

test('props and standing bodies are one cover-cell rule', () => {
  const shield = { id: 'shield' };
  const world = {
    tileDefAt: (x) => (x === 1 ? { solid: true, height: 0.5 } : null),
    bodyAt: (x) => (x === 2 ? shield : null),
    standing: () => true,
  };
  assert.equal(crouchCoverCell(1, 0, world), true, 'short solid prop');
  assert.equal(crouchCoverCell(2, 0, world), true, 'standing body');
  assert.equal(crouchCoverCell(2, 0, { ...world, exclude: [shield] }), false, 'excluded body');
  assert.equal(crouchCoverCell(3, 0, world), false, 'open cell');
});

test('cover faces compose the shared cell rule with edge cover', () => {
  const faces = crouchFacesAt(5, 5, {
    edgeOpen: (x, z, nx, nz) => !(nx === 5 && nz === 4),
    tileDefAt: (x, z) => (x === 6 && z === 5 ? { cover: true } : null),
    bodyAt: () => null,
  });
  assert.deepEqual(faces, [[1, 0], [0, -1]]);
});

test('enter and leave own the crouch record, pose, and status together', () => {
  const body = { x: 4.25, z: 3.75, crouched: false };
  const carrier = {};
  let state = null;
  const statuses = new Set();
  const entered = enterCrouch({
    body,
    carrier,
    faces: [[1, 0]],
    setState: (next) => { state = next; },
    applyStatus: (_, id) => statuses.add(id),
  });
  assert.deepEqual(entered, { at: { x: 4.25, z: 3.75 }, faces: [[1, 0]] });
  assert.equal(body.crouched, true);
  assert.equal(statuses.has('covered'), true);

  assert.equal(leaveCrouch({
    body,
    carrier,
    clearState: () => { state = null; return true; },
    removeStatus: (_, id) => statuses.delete(id),
  }), true);
  assert.equal(state, null);
  assert.equal(body.crouched, false);
  assert.equal(statuses.has('covered'), false);
});

test('a coverless enter and an absent leave change nothing', () => {
  const body = { x: 1, z: 1, crouched: false };
  assert.equal(enterCrouch({
    body,
    carrier: {},
    faces: [],
    setState: () => assert.fail('no state'),
    applyStatus: () => assert.fail('no status'),
  }), null);
  assert.equal(leaveCrouch({
    body,
    carrier: {},
    clearState: () => false,
    removeStatus: () => assert.fail('no status'),
  }), false);
  assert.equal(body.crouched, false);
});
