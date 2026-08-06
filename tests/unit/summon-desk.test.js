import test from 'node:test';
import assert from 'node:assert/strict';
import { createSummonDesk } from '../../src/summon-desk.js';

test('summon resolution preserves the complete descriptor through the world seam', () => {
  let call = null;
  const world = {
    liveEnemies: () => [],
    spawnSummon: (...args) => { call = args; return []; },
  };
  const desk = createSummonDesk({
    world,
    members: [],
    capRoom: () => 1,
    countLiveSummons: () => 0,
    dropCount: () => 1,
  });
  const summoner = { x: 1.1, z: 2.2 };
  const spec = {
    type: 'summon',
    archetype: 'employee',
    count: 1,
    placement: { anchor: 'aim', avoidHazards: true, futurePolicy: 'still-here' },
  };
  const aim = { x: 3.25, z: 4.5 };

  desk.resolveSummon(summoner, 'player', spec, aim);

  assert.equal(call[0], spec, 'the descriptor itself reaches the consumer');
  assert.deepEqual(call.slice(1), ['player', summoner, 1, aim]);
});
