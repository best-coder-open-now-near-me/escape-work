// The PROVIDER half of Q041: does the facade combat.js actually builds still
// carry the keys the pure rules read?
//
// `world-contract.test.js` is the consumer half. It pins what each rule NEEDS
// off a `world` bag, and says in its own header why it stops there: "main.js is
// the entry point and importable.test.js excludes it on purpose, so the provider
// side cannot be reached from node". That was true while the facade was a
// 199-line object literal in the middle of `beginCombat`. It is `combat-world.js`
// now - a plain function returning a plain object - so the other half of the
// contract is finally testable, which is the whole reason that cut was worth
// making.
//
// The two halves check different failures, and this one is the failure that
// actually shipped: a key quietly dropped from the PROVIDER while the rules go
// on reading it. The consumer tests cannot see that - they build their own bags.
//
// Rather than restate the key lists here (two lists that must agree is exactly
// the drift this finding is about), these drive the REAL facade through the REAL
// rules. If `combat-world.js` stops carrying `stepOpen`, `aiTopplePlan` gets an
// undefined and this goes red - the same way it would in a fight, minus the
// fight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatWorld } from '../../src/combat-world.js';
import { aiTopplePlan, aiShovePlan } from '../../src/combat-plans.js';
import { hasSwingSpot } from '../../src/combat-geometry.js';

// Every dependency `createCombatWorld` reads, stubbed to the least interesting
// answer that still lets a rule run to a verdict. A rule that returns early
// proves nothing, so the tile is toppleable and the ground is open.
const deps = () => ({
  sheet: { name: 'stub', hp: 10, maxHp: 10, talent: null },
  player: { x: 0, z: 0 },
  combat: null,
  party: { members: [], active: 0 },
  enemies: [],
  summons: [],
  grid: {
    typeAt: () => 'floor',
    defAt: () => ({ topple: true, cover: false, solid: false }),
    terrainOpen: () => true,
    sightOpen: () => true,
    sightOpenCell: () => true,
    isElectrified: () => false,
    setType: () => {},
    propHpAt: () => 0,
    damageProp: () => {},
    edgeHpBetween: () => 0,
    damageEdge: () => {},
    wallEdgeBetween: () => null,
    removeEdgeBetween: () => {},
    stepOpen: () => true,
    edgeOpen: () => true,
    surfaceField: { quantum: 0.5 },
  },
  runtime: {
    surfaceAt: () => null,
    isBurning: () => false,
    isSmoke: () => false,
  },
  scene: { setTileType: () => {} },
  doors: {
    doorsBeside: () => [],
    setDoorOpen: () => {},
    doorBetween: () => null,
  },
  isWalkable: () => true,
  partyAt: () => false,
  summonAt: () => false,
  clampPoint: (x, z) => [x, z],
  approachTo: (gx, gz) => [gx, gz],
  floorAt: () => ({}),
  slipChanceAt: () => 0,
  stickGum: () => {},
  sightClear: () => true,
  segmentClear: () => true,
  sightOpen: () => true,
  smoothPath: (_open, p) => p,
  smoothFromBody: (p) => p,
  routeOpen: (open) => open,
  findPath: () => null,
  hazardCostFor: () => () => 1,
  enemyHazardCost: () => 1,
  enemyClearOfHazards: () => true,
  rawSurfDamage: () => 0,
  effectiveSurfDamage: () => 0,
  leaveSurfaceAt: () => {},
  leaveSurfaceCells: () => 0,
  summonPointsNear: () => [],
  spawnSummonUnits: () => [],
  dismissSummon: () => {},
  onTemporaryAllyStep: () => {},
});

const body = (x, z) => ({ x, z, actor: { x, z } });

// The three rules world-contract.test.js pins, run against the REAL facade
// instead of a hand-built bag. This is the half that catches a provider-side
// deletion: the rule names its needs, the facade either still answers them or
// this goes red.
test('aiTopplePlan runs against the real facade', () => {
  const world = createCombatWorld(deps());
  const plan = aiTopplePlan(1, 1, world, () => ({ id: 'victim' }));
  // The stub floor is toppleable with an open landing and a body on it, so the
  // rule must reach a verdict rather than refuse early - a refusal would mean
  // the facade answered "no" before any of the keys under test were read.
  assert.ok(plan, 'the rule refused on a bag that should have produced a plan');
});

test('aiShovePlan runs against the real facade', () => {
  const world = createCombatWorld(deps());
  assert.doesNotThrow(() => aiShovePlan(1, 1, {
    isWalkable: world.isWalkable,
    stepOpen: world.stepOpen,
    occupied: () => false,
  }, () => ({ id: 'victim' }), { disengage: true }));
});

test('hasSwingSpot runs against the real facade', () => {
  const world = createCombatWorld(deps());
  assert.doesNotThrow(() => hasSwingSpot(body(0, 0), body(1, 1), world));
});

test('the facade rejects physical overlap across distinct movement tiles', () => {
  const d = deps();
  const mover = { x: 0, z: 0, entity: { getPosition: () => ({ x: 0, z: 0 }) } };
  d.party.members.push({ sheet: { hp: 10 }, actor: mover });
  d.enemies.push({
    alive: true,
    x: 1,
    z: 0,
    entity: { getPosition: () => ({ x: 0.55, z: 0 }) },
  });
  const world = createCombatWorld(d);
  assert.equal(world.bodyClear(0, 0, mover), false,
    'a neighbour tile does not make overlapping continuous bodies legal');
  assert.equal(world.bodyClear(-0.1, 0, mover), true);
});
