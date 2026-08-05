import test from 'node:test';
import assert from 'node:assert';
import {
  resizedDimension, shiftEditorStorey, resizeEditorStorey,
  paintDocumentCell, setDocumentEdge, stampDocumentEdges,
} from '../../src/editor-document.js';

const makeStorey = (rows, extra = {}) => ({
  rows: rows.map((row) => [...row]),
  hWalls: new Set(), vWalls: new Set(), hDoors: new Set(), vDoors: new Set(),
  propRot: new Map(),
  ...extra,
});

test('resize bounds never clamp an untouched or already-oversized axis', () => {
  assert.equal(resizedDimension(41, 0), 41);
  assert.equal(resizedDimension(41, 1), 41);
  assert.equal(resizedDimension(41, -1), 40);
  assert.equal(resizedDimension(39, 1), 40);
});

test('near-edge growth remaps cells, edges, and placement rotations together', () => {
  const source = makeStorey(['ab', 'cd'], {
    hWalls: new Set(['0,0']),
    vDoors: new Set(['2,1']),
    propRot: new Map([['1,1', 90]]),
  });
  const change = shiftEditorStorey(source, 1, 1, { blank: '.', minSize: 1 });

  assert.deepEqual(change.storey.rows.map((row) => row.join('')), ['...', '.ab', '.cd']);
  assert.deepEqual([...change.storey.hWalls], ['1,1']);
  assert.deepEqual([...change.storey.vDoors], ['3,2']);
  assert.deepEqual([...change.storey.propRot], [['2,2', 90]]);
});

test('near-edge shrink reports removed actors and drops their keyed metadata', () => {
  const source = makeStorey(['@abcd', 'efghi', 'jklmn', 'opqrs'], {
    hWalls: new Set(['0,0', '2,2']),
    propRot: new Map([['0,0', 90], ['2,2', 180]]),
  });
  const change = shiftEditorStorey(source, -1, 0, {
    blank: '.', minSize: 1, isActor: (char) => char === '@',
  });

  assert.equal(change.lostActors, 1);
  assert.equal(change.storey.rows[0].join(''), 'abcd');
  assert.deepEqual([...change.storey.hWalls], ['1,2']);
  assert.deepEqual([...change.storey.propRot], [['1,2', 180]]);
});

test('far-edge shrink filters rotations and reports actors with the cells', () => {
  const source = makeStorey(['abcd', 'efgh', 'ijkl', 'lmn@'], {
    propRot: new Map([['1,1', 90], ['3,2', 180], ['3,3', 270]]),
  });
  const change = resizeEditorStorey(source, 0, -1, {
    blank: '.', minSize: 1, isActor: (char) => char === '@',
  });

  assert.equal(change.lostActors, 1);
  assert.deepEqual(change.storey.rows.map((row) => row.join('')), ['abcd', 'efgh', 'ijkl']);
  assert.deepEqual([...change.storey.propRot], [['1,1', 90], ['3,2', 180]]);

  const narrower = resizeEditorStorey(change.storey, -1, 0, { blank: '.', minSize: 1 });
  assert.deepEqual([...narrower.storey.propRot], [['1,1', 90]]);
});

test('painting clears stale rotation and keeps exactly one player spawn', () => {
  const storey = makeStorey(['@a', 'bc'], {
    propRot: new Map([['0,0', 90], ['1,1', 180]]),
  });
  const result = paintDocumentCell(storey, 1, 1, '@', { blank: '.' });

  assert.equal(result.changed, true);
  assert.deepEqual(result.clearedPlayer, [{ x: 0, z: 0 }]);
  assert.deepEqual(storey.rows.map((row) => row.join('')), ['.a', 'b@']);
  assert.deepEqual([...storey.propRot], []);
});

test('stamped doors replace destination walls and stamped walls replace doors', () => {
  const storey = makeStorey(['....', '....', '....', '....'], {
    hWalls: new Set(['1,1']),
    vDoors: new Set(['2,1']),
  });
  stampDocumentEdges(storey, {
    hWalls: [], vWalls: [[0, 0]], hDoors: [[0, 0]], vDoors: [],
  }, { x: 1, z: 1 }, 4, 4);

  assert.equal(storey.hWalls.has('1,1'), false);
  assert.equal(storey.hDoors.has('1,1'), true);
  assert.equal(storey.vDoors.has('1,1'), false);
  assert.equal(storey.vWalls.has('1,1'), true);
  assert.equal(setDocumentEdge(storey, 'h', 1, 1, 'door'), false);
});
