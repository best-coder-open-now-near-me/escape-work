// New status content the framework makes possible (STATUS_PLAN M4): a shove
// into a wall STUNS (the target loses its next turn), and BURNING ticks a dot
// at the owner's turn. Both drive real combat state, asserted through __combat.
import { test, expect } from '@playwright/test';
import { bootStash, enterCombat, endTurnUntilPlayer } from './helpers.js';

// Player and Manager already adjacent, the Manager backed against a wall so a
// shove away from the player slams it into something solid.
const STUN_CORNER = {
  name: 'Stun Corner',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '#####',
    '#.@M#',
    '#####',
  ],
};

const manager = (page) => page.evaluate(() =>
  window.__combat.enemies.find((e) => e.name === 'The Manager'));
const managerStunned = (page) => page.evaluate(() =>
  !!window.__combat.enemies.find((e) => e.name === 'The Manager')?.statuses.some((s) => s.id === 'stunned'));

test('a shove into a wall stuns the target, and the stun costs it a turn', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, STUN_CORNER, 'office-drone');
  await enterCombat(page);
  // Enemies can't land a hit for the duration - isolates the stun's effect on
  // the player's HP (a stunned Manager that acted would deal damage).
  await page.evaluate(() => { window.__combat.forceHit = false; });

  const foe = await manager(page);
  // Arm Shove and drive it into the Manager until the shove actually fires
  // (its 2 AP is spent) - it slams the wall-backed Manager into something solid.
  let shoved = false;
  for (let i = 0; i < 6 && !shoved; i++) {
    await page.waitForTimeout(700);
    const ap0 = await page.evaluate(() => window.__combat.ap);
    if (await page.evaluate(() => window.__combat.armed) !== 'shove') await page.click('#act-shove');
    const fp = await page.evaluate(([x, z]) => window.__game.project(x, z), [foe.x, foe.z]);
    await page.mouse.click(fp.x, fp.y);
    await page.waitForTimeout(300);
    const ap1 = await page.evaluate(() => window.__combat.ap);
    if (Math.abs(ap1 - (ap0 - 2)) < 0.01) shoved = true;
  }
  expect(shoved).toBe(true);
  expect(await managerStunned(page)).toBe(true); // the slam stunned it

  // Cycle a full round: the Manager's turn comes and goes without an attack
  // (skipTurn), and the stun clears as it burns that turn.
  const hp0 = await page.evaluate(() => window.__god.player.hp);
  await endTurnUntilPlayer(page);
  expect(await managerStunned(page)).toBe(false);        // the skip consumed the stun
  expect(await page.evaluate(() => window.__god.player.hp)).toBe(hp0); // it never got to swing
});

// A plain duel arena for the burning dot.
const DUEL_ARENA = {
  name: 'Burn Arena',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '###########',
    '#.........#',
    '#...@.M...#',
    '#.........#',
    '###########',
  ],
};

test('burning ticks a dot at the start of the owner turn', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DUEL_ARENA, 'office-drone');
  await enterCombat(page);
  // Isolate the dot: enemies miss, so the only damage is the fire.
  await page.evaluate(() => {
    window.__combat.forceHit = false;
    const s = window.__god.player;
    s.hp = s.maxHp;
    window.__combat.applyStatus('burning', 2); // catch fire (dot 2, two turns)
  });
  const hp0 = await page.evaluate(() => window.__god.player.hp);
  // Come back around to the member's turn: the dot fires at turn start.
  await endTurnUntilPlayer(page);
  const hp1 = await page.evaluate(() => window.__god.player.hp);
  expect(hp1).toBe(hp0 - 2); // one 2-point burning tick, nothing else
  // Still on fire for one more turn.
  expect(await page.evaluate(() =>
    window.__combat.party.find((m) => m.active)?.statuses.some((s) => s.id === 'burning'))).toBe(true);
});

test('blinded drops the attacker to-hit via accMod', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DUEL_ARENA, 'office-drone');
  await enterCombat(page);

  const foe = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  // Arm the attack and hover the foe to read the honest to-hit chance.
  const readChance = async () => {
    let c = null;
    for (let i = 0; i < 8 && c == null; i++) {
      await page.waitForTimeout(400);
      if (await page.evaluate(() => window.__combat.armed) !== 'attack') await page.click('#act-attack');
      const fp = await page.evaluate(([x, z]) => window.__game.project(x, z), [foe.x, foe.z]);
      await page.mouse.move(fp.x, fp.y);
      await page.waitForTimeout(150);
      c = await page.evaluate(() => window.__combat.hoverHitChance);
    }
    return c;
  };
  const base = await readChance();
  expect(typeof base).toBe('number');

  // Blind the attacker: their accuracy drops by the status's accMod (0.3).
  await page.evaluate(() => window.__combat.applyStatus('blinded', 2));
  const blind = await readChance();
  expect(base - blind).toBeCloseTo(0.3, 5); // the whole accMod, both ends unclamped here
});
