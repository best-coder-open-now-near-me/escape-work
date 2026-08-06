import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS } from '../../src/data/actions.js';
import { createSurfaceField } from '../../src/surface-field.js';
import { createOocVerbs } from '../../src/ooc-verbs.js';

function zoneHarness() {
  const surfaceField = createSurfaceField({ width: 10, height: 10 });
  const said = [];
  let armed = 'paper-storm';
  let barArmed = 'paper-storm';
  let committed = null;
  let faced = null;
  let lunged = null;
  const d = {
    ACTIONS,
    grid: { surfaceField },
    leadBody: () => ({ x: 1.2, z: 1.2 }),
    hasLos: () => true,
    canTakeSurface: () => true,
    surfaceBodies: () => [{ x: 3.2, z: 3.1 }],
    leaveSurfaceCells: (cells, surfaceId, turns) => {
      committed = { cells, surfaceId, turns };
      return cells.length;
    },
    player: {
      faceToward: (x, z) => { faced = [x, z]; },
      lunge: (x, z) => { lunged = [x, z]; },
    },
    ui: { say: (line) => said.push(line) },
    setArmedOoc: (value) => { armed = value; },
    hotbarHost: { hotbar: { setArmed: (value) => { barArmed = value; } } },
  };
  return {
    verbs: createOocVerbs(d),
    state: () => ({ said, armed, barArmed, committed, faced, lunged }),
  };
}

test('TPS exploration preview is continuous and carves living body footprints', () => {
  const h = zoneHarness();
  const plan = h.verbs.oocZonePlan('paper-storm', 3.2, 3.1);
  assert.equal(plan.problem, null);
  assert.deepEqual([plan.x, plan.z], [3.2, 3.1], 'the exact aim is not tile-snapped');
  assert.ok(plan.cells.length > 1);
  assert.ok(!plan.cells.some(([x, z]) => Math.hypot(x - 3.2, z - 3.1) < 0.5),
    'the surface leaves a physical gap around the body');
  assert.equal(plan.quantum, 0.5);
});

test('TPS exploration click commits the exact preview plan and then disarms', () => {
  const h = zoneHarness();
  const plan = h.verbs.oocZonePlan('paper-storm', 3.2, 3.1);
  h.verbs.placeZoneAt('paper-storm', 3.2, 3.1);
  const state = h.state();
  assert.deepEqual(state.committed, {
    cells: plan.cells,
    surfaceId: 'paper',
    turns: ACTIONS['paper-storm'].leavesTurns,
  });
  assert.deepEqual(state.faced, [3.2, 3.1]);
  assert.deepEqual(state.lunged, [3.2, 3.1]);
  assert.equal(state.armed, null);
  assert.equal(state.barArmed, null);
});

test('TPS exploration click keeps aiming after a range refusal', () => {
  const h = zoneHarness();
  h.verbs.placeZoneAt('paper-storm', 8, 8);
  const state = h.state();
  assert.equal(state.committed, null);
  assert.equal(state.armed, 'paper-storm');
  assert.match(state.said.at(-1), /Too far/);
});
