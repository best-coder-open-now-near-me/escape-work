// The movement economy (MOVEMENT_PLAN M1): movement and actions share one AP
// pool, and the rate is what decides whether repositioning is affordable. This
// pins the rate end-to-end - the constant alone proves nothing, since the cost
// is a product of base x surface x status and any factor could regress it.
import { test, expect } from '@playwright/test';
import { bootStash, enterCombat, clickWorld } from './helpers.js';

// A wide clean room: no surfaces and no hazards, so distance is the only thing
// being charged for. The pair start ADJACENT and central, which matters twice:
// enterCombat engages without walking the player somewhere unpredictable, and
// there is open floor on every side to walk into. (A corridor does not work -
// the Manager stands in the only lane, and a body blocks movement.)
const ROOM = {
  name: 'Move Lab',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '##################',
    '#................#',
    '#................#',
    '#........@M......#',
    '#................#',
    '#................#',
    '##################',
  ],
};

test('a tile of clean floor costs half an AP', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, ROOM, 'office-drone');
  await enterCombat(page);
  // Nothing armed, so a ground click walks.
  if (await page.evaluate(() => window.__combat.armed)) {
    const here = await page.evaluate(() => window.__game.project(window.__game.playerTile.x, window.__game.playerTile.z));
    await page.mouse.click(here.x, here.y, { button: 'right' });
  }
  const before = await page.evaluate(() => ({
    ap: window.__combat.ap, tile: window.__game.playerTile,
  }));
  // Four tiles directly away from the Manager - open floor, and a straight
  // line, so the distance charged is the distance intended.
  const foe = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  const away = Math.sign(before.tile.x - foe.x) || -1;
  const target = { x: before.tile.x + 4 * away, z: before.tile.z };
  expect(await clickWorld(page, target.x, target.z)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.playerTile),
    { timeout: 30_000 }).toEqual(target);

  const spent = before.ap - (await page.evaluate(() => window.__combat.ap));
  // Four tiles at half an AP each. Generous tolerance: movement is priced by
  // continuous DISTANCE, and the walk ends at the clicked point rather than
  // the tile centre, so the last fraction of a tile varies.
  expect(spent).toBeGreaterThan(1.5);
  expect(spent).toBeLessThan(2.6);
});

test('repositioning behind a foe still leaves AP to attack with', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, ROOM, 'office-drone');
  await enterCombat(page);
  // The trade this milestone exists to create: at the old rate a walk around a
  // body cost a whole attack, so backstab was never worth taking. Walk past
  // the Manager to its far side and the attack must still be affordable.
  const foe = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  if (await page.evaluate(() => window.__combat.armed)) {
    const here = await page.evaluate(() => window.__game.project(window.__game.playerTile.x, window.__game.playerTile.z));
    await page.mouse.click(here.x, here.y, { button: 'right' });
  }
  expect(await clickWorld(page, foe.x + 1, foe.z)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.playerTile),
    { timeout: 30_000 }).toEqual({ x: foe.x + 1, z: foe.z });
  // Still enough to swing, and the button says so. Read the cost from the
  // registry rather than hardcoding it, so re-pricing actions cannot make this
  // test quietly assert the wrong thing.
  const attackAp = await page.evaluate(() => window.__god.actionAp('attack'));
  expect(await page.evaluate(() => window.__combat.ap)).toBeGreaterThanOrEqual(attackAp);
  await expect(page.locator('#act-attack')).toBeEnabled();
});

test('the Pawn allowance pays for movement before AP does', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, ROOM, 'mail-room');
  await enterCombat(page);
  // Take Always Moving (the Pawn node) through the real progression path.
  expect(await page.evaluate(() => typeof window.__god.spendClassPoint)).toBe('function');
  await page.evaluate(() => {
    const s = window.__god.player;
    s.classPoints = 2;
    window.__god.spendClassPoint(s, 'mail-cart-legs');
    window.__god.spendClassPoint(s, 'mail-always-moving');
  });
  const granted = await page.evaluate(() => window.__god.player.talent?.effects?.freeMoveAp || 0);
  expect(granted).toBeGreaterThan(0);

  // Take the boots off first. The Mail Room starts in Warehouse Boots, which
  // cost 1.1 per tile (M4) - that is a real interaction, but it is not what
  // this test is about, and it leaves too little headroom in a 1.0 allowance
  // for the walk to stay inside it.
  await page.evaluate(() => { window.__god.player.equipped.shoes = null; });

  // The allowance only refreshes at the top of a turn, so cycle to one.
  await page.click('#combat-end-turn').catch(() => {});
  await expect.poll(() => page.evaluate(() => window.__combat?.phase), { timeout: 60_000 }).toBe('player');
  const ap0 = await page.evaluate(() => window.__combat.ap);
  const free0 = await page.evaluate(() => window.__combat.freeAp);
  expect(free0).toBeGreaterThan(0); // refreshed at the top of the turn
  const tile = await page.evaluate(() => window.__game.playerTile);
  const foe = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  const away = Math.sign(tile.x - foe.x) || -1;

  // One tile costs 0.5 - inside the allowance, so real AP must not move.
  expect(await clickWorld(page, tile.x + away, tile.z)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.playerTile),
    { timeout: 30_000 }).toEqual({ x: tile.x + away, z: tile.z });
  // The allowance paid for it: it went down, and real AP did not move at all.
  expect(await page.evaluate(() => window.__combat.freeAp)).toBeLessThan(free0);
  expect(await page.evaluate(() => window.__combat.ap)).toBe(ap0);
});

test('Frequent Flier walks out of melee without being hit', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, ROOM, 'middle-manager');
  await enterCombat(page);
  await page.evaluate(() => {
    window.__combat.forceHit = true;          // any reaction WOULD land
    const s = window.__god.player;
    s.hp = s.maxHp;
    s.classPoints = 1;
    window.__god.spendClassPoint(s, 'mgr-frequent-flier');
  });
  expect(await page.evaluate(() =>
    !!window.__god.player.talent?.effects?.noProvoke)).toBe(true);

  const hp0 = await page.evaluate(() => window.__god.player.hp);
  const roll0 = await page.evaluate(() => JSON.stringify(window.__combat.lastRoll ?? null));
  // Break contact. Without the talent this is exactly the walk that provokes.
  const tile = await page.evaluate(() => window.__game.playerTile);
  const foe = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  const away = Math.sign(tile.x - foe.x) || -1;
  expect(await clickWorld(page, tile.x + 4 * away, tile.z)).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const p = window.__game.playerTile;
    const m = window.__combat.enemies.find((e) => e.alive);
    return Math.max(Math.abs(p.x - m.x), Math.abs(p.z - m.z));
  }), { timeout: 30_000 }).toBeGreaterThan(1);

  expect(await page.evaluate(() => window.__god.player.hp)).toBe(hp0); // untouched
  // And nothing even ROLLED - the reaction never happened, it didn't just miss.
  expect(await page.evaluate(() => JSON.stringify(window.__combat.lastRoll ?? null))).toBe(roll0);
});
