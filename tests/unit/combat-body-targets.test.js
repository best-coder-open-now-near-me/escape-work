import test from 'node:test';
import assert from 'node:assert/strict';
import { createAimView } from '../../src/combat-aim.js';
import { createBodyTargets } from '../../src/combat-body-targets.js';

function fixture({ cone = false } = {}) {
  const rings = [];
  const lines = [];
  const enemy = {
    alive: true,
    entity: { getPosition: () => ({ x: 4, z: 5 }) },
  };
  const active = {
    ap: 3,
    sheet: { paper: 4 },
    actor: { entity: { getPosition: () => ({ x: 1, z: 2 }) } },
  };
  class Vec3 {
    constructor(x, y, z) { Object.assign(this, { x, y, z }); }
  }
  const marks = {
    OK: 'ok', FAR: 'far', REACH: 'reach',
    ring: (...args) => rings.push(args),
  };
  const view = { active, armed: null };
  const ask = {
    TARGET_R: 0.4,
    rangeOf: () => 0,
    posOf: () => ({ x: 1.2, z: 2.3 }),
    isPull: () => false,
    reachOfUnit: () => 1.5,
    bodyDist: () => 2,
    bodyLos: () => true,
    ammoCostOf: () => 0,
    enemyRingOk: () => true,
    shotOutcome: () => ({ blocked: false }),
    canReach: () => true,
    hasSwingSpot: () => true,
    pullPlanFor: () => null,
    controlProblem: () => null,
    coneTest: () => (() => true),
    conePolyline: () => [[1, 2], [2, 3], [3, 4]],
  };
  const pass = createBodyTargets({
    app: { drawLine: (...args) => lines.push(args) },
    pc: { Vec3 },
    marks,
    world: { liveEnemies: () => [enemy] },
    REACH: { SHOVE: 1.2, PULL: 1.3 },
    view,
    ask,
    aimPoint: cone ? { x: 3, z: 4 } : null,
    hoverFoe: enemy,
  });
  return { pass, rings, lines, enemy, active, ask };
}

test('the body pass draws one shared reach and the enemy verdict ring', () => {
  const { pass, rings } = fixture();

  pass.draw({ type: 'attack', ap: 2 }, 'attack');

  assert.deepEqual(rings, [
    [1.2, 2.3, 1.5, 'reach'],
    [4, 5, 0.4, 'ok'],
  ]);
});

test('the cone pass draws its boundary and body-tested enemy ring', () => {
  const { pass, rings, lines } = fixture({ cone: true });

  pass.draw({ type: 'attack', ap: 2, cone: { range: 4 } }, 'cone');

  assert.equal(lines.length, 2);
  assert.deepEqual(rings, [[4, 5, 0.4, 'ok']]);
});

test('the aim view constructs the extracted body pass', () => {
  const marks = {
    OK: 'ok', FAR: 'far', COVER: 'cover', REACH: 'reach',
    ring: () => {}, faces: () => {},
  };
  const aim = createAimView({
    app: {}, pc: {}, marks,
    aimPaint: {}, actions: {}, world: {}, costTag: { style: {} },
    REACH: {}, view: {}, ask: { TARGET_R: 0.4 },
  });

  assert.equal(typeof aim.drawTargets, 'function');
});

test('the aim view preserves a cone cursor point until its boundary draws', () => {
  const lines = [];
  class Vec3 {
    constructor(x, y, z) { Object.assign(this, { x, y, z }); }
  }
  const action = { type: 'attack', ap: 2, cone: { range: 4, halfAngle: 35 } };
  const view = {
    phase: 'player',
    armed: 'mail-cone',
    active: {
      ap: 4,
      sheet: { paper: 0 },
      actor: { x: 1, z: 1, moving: false, entity: { getPosition: () => ({ x: 1, z: 1 }) } },
    },
  };
  let washHidden = 0;
  let painted = [];
  const aim = createAimView({
    app: { drawLine: (...args) => lines.push(args) },
    pc: { Vec3 },
    marks: {
      OK: 'ok', FAR: 'far', COVER: 'cover', REACH: 'reach',
      ring: () => {}, faces: () => {},
    },
    aimPaint: {
      hide: () => { washHidden += 1; },
      show: (_key, cells) => { painted = cells(); },
    },
    actions: { 'mail-cone': action },
    world: { liveEnemies: () => [], doorsBeside: () => [], surfaceField: () => ({ quantum: 0.5 }) },
    costTag: { style: {} },
    REACH: {},
    view,
    ask: {
      TARGET_R: 0.4,
      crouchStateOf: () => null,
      previewAction: () => 'mail-cone',
      rangeOf: () => 0,
      verbSides: () => ({ kind: 'cone', allies: false, enemies: true }),
      coneTest: () => (() => true),
      coneCells: () => [[1.25, 1.25], [1.75, 1.25]],
      conePolyline: () => [[1, 1], [2, 2], [3, 2]],
      bodyLos: () => true,
    },
  });

  aim.setAimPoint({ x: 3, z: 2 });
  aim.drawTargets();

  assert.deepEqual(aim.aimPoint, { x: 3, z: 2 }, 'draw pass must not erase the cursor it consumes');
  assert.equal(lines.length, 2, 'the cone boundary drew from that cursor point');
  assert.equal(washHidden, 0, 'a cone replaces the unrelated circular range wash');
  assert.deepEqual(painted, [[1.25, 1.25], [1.75, 1.25]], 'the exact cone mask is filled');
});
