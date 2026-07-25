// Opportunity attacks (TACTICS_PLAN M2): leaving a threatened tile costs you,
// and forced movement doesn't. Both assertions run inside the player's OWN
// turn, so the enemy's scheduled attack can't be mistaken for a reaction.
import { test, expect } from '@playwright/test';
import { bootStash, enterCombat, clickWorld } from './helpers.js';

// An open room with space to run: the player engages the Manager, then has
// somewhere far enough to break contact.
const DISENGAGE_ARENA = {
  name: 'Disengage Lab',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '############',
    '#..........#',
    '#...@M.....#',
    '#..........#',
    '############',
  ],
};

const foeOf = (page) => page.evaluate(() => {
  const e = window.__combat.enemies.find((f) => f.alive);
  return e ? { x: e.x, z: e.z, hp: e.hp } : null;
});

const reachOf = (page) => page.evaluate(() => {
  const p = window.__game.playerTile;
  const m = window.__combat.enemies.find((e) => e.alive);
  return Math.max(Math.abs(p.x - m.x), Math.abs(p.z - m.z));
});

test('walking out of an enemy reach provokes a free swing', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DISENGAGE_ARENA, 'office-drone');
  await enterCombat(page);
  // Pin the roll so the reaction lands, and top the player up so the only
  // damage that can possibly appear is the opportunity attack.
  await page.evaluate(() => {
    window.__combat.forceHit = true;
    const s = window.__god.player;
    s.hp = s.maxHp;
  });
  expect(await reachOf(page)).toBeLessThanOrEqual(1); // it threatens our tile

  const hp0 = await page.evaluate(() => window.__god.player.hp);
  // Break contact for the far corner. Still our turn - the Manager has not
  // been handed a turn to attack in, so any damage is the reaction.
  expect(await clickWorld(page, 1, 1)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__god.player.hp),
    { timeout: 30_000 }).toBeLessThan(hp0);
  expect(await reachOf(page)).toBeGreaterThan(1); // we did get out
});

test('circling inside its reach provokes nothing', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DISENGAGE_ARENA, 'office-drone');
  await enterCombat(page);
  await page.evaluate(() => {
    window.__combat.forceHit = true;
    const s = window.__god.player;
    s.hp = s.maxHp;
  });
  const foe = await foeOf(page);
  const hp0 = await page.evaluate(() => window.__god.player.hp);
  // Step to another tile that is STILL adjacent to the Manager - the threat
  // never lapses, so no reaction fires (the threat-set rule, not raw adjacency).
  const sidestep = [[foe.x, foe.z - 1], [foe.x, foe.z + 1], [foe.x - 1, foe.z + 1], [foe.x - 1, foe.z - 1]];
  let moved = false;
  for (const [tx, tz] of sidestep) {
    if (await page.evaluate(([x, z]) => {
      const p = window.__game.playerTile;
      return p.x === x && p.z === z;
    }, [tx, tz])) continue;
    if (!(await clickWorld(page, tx, tz))) continue;
    await page.waitForTimeout(1500);
    if (await reachOf(page) <= 1) { moved = true; break; }
  }
  expect(moved).toBe(true); // we relocated but stayed in its face
  expect(await page.evaluate(() => window.__god.player.hp)).toBe(hp0); // untouched
});

test('a shove does not provoke - forced movement is the safe disengage', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DISENGAGE_ARENA, 'office-drone');
  await enterCombat(page);
  await page.evaluate(() => { window.__combat.forceHit = true; });
  const before = await foeOf(page);

  // Shove it out of our reach. A shove into open floor deals no damage, so if
  // forced movement provoked, our own free swing would show up as HP loss.
  let shoved = false;
  for (let i = 0; i < 6 && !shoved; i++) {
    await page.waitForTimeout(700);
    const ap0 = await page.evaluate(() => window.__combat.ap);
    if (await page.evaluate(() => window.__combat.armed) !== 'shove') await page.click('#act-shove');
    const fp = await page.evaluate(([x, z]) => window.__game.project(x, z), [before.x, before.z]);
    await page.mouse.click(fp.x, fp.y);
    await page.waitForTimeout(400);
    const ap1 = await page.evaluate(() => window.__combat.ap);
    if (Math.abs(ap1 - (ap0 - 2)) < 0.01) shoved = true;
  }
  expect(shoved).toBe(true);

  const after = await foeOf(page);
  expect(after.x !== before.x || after.z !== before.z).toBe(true); // it did move
  expect(after.hp).toBe(before.hp); // and took nothing on the way out
});
