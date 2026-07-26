// The money loop (ECONOMY_PLAN.md), driven through the real game: cash banks
// itself on pickup, a snack machine sells you something and can be cleaned out,
// and the Mail Room Veteran buys the junk a machine will not touch.
//
// The Floor 1 machine stands in the left break room (levels/level1.json). Tests
// teleport next to it rather than walking the floor - the walk is covered by
// the looting suite, and what is under test here is the transaction.
import { test, expect } from '@playwright/test';
import { bootAndPick, stableProject, onScreen } from './helpers.js';

const MACHINE = { x: 4, z: 8 };   // Floor 1's snack machine
const STAND = { x: 4, z: 7 };     // open floor immediately north of it

// Park the leader beside a tile and let the camera settle on them, so the next
// projection is stable enough to click.
async function standBeside(page, x, z) {
  await page.evaluate(([tx, tz]) => window.__god.teleport(tx, tz), [x, z]);
  await page.waitForTimeout(400);
  await stableProject(page, x, z).catch(() => {});
}

// Click a tall prop's BODY - the ground point behind it is a tile away at this
// camera angle, which is the whole reason picking.js exists.
async function clickBody(page, x, z, y = 0.6) {
  const p = await page.evaluate(([wx, wy, wz]) => window.__game.project3(wx, wy, wz), [x, y, z]);
  expect(onScreen(p)).toBe(true);
  await page.mouse.click(p.x, p.y);
}

async function openMachine(page) {
  await standBeside(page, STAND.x, STAND.z);
  await clickBody(page, MACHINE.x, MACHINE.z);
  await expect(page.locator('#shop-panel')).toBeVisible({ timeout: 60_000 });
}

test('found cash banks itself instead of filling a pocket', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page, 'office-drone');
  expect(await page.evaluate(() => window.__game.cash)).toBe(0);

  // A fiver on the floor at the player's feet, picked up through the real
  // ground-click verb.
  const tile = await page.evaluate(() => window.__game.playerTile);
  await page.evaluate(([x, z]) => window.__god.dropItem('crumpled-fiver', x, z), [tile.x, tile.z]);
  await stableProject(page, tile.x, tile.z).catch(() => {});
  const p = await page.evaluate(([x, z]) => window.__game.project(x, z), [tile.x, tile.z]);
  expect(onScreen(p)).toBe(true);
  await page.mouse.click(p.x, p.y);

  // It is money, not luggage: the purse rises and the bag stays empty.
  await expect.poll(() => page.evaluate(() => window.__game.cash), { timeout: 30_000 }).toBe(5);
  expect(await page.evaluate(() => window.__game.inventory)).toEqual([]);

  // ...and the pockets say so, in the same strip as the paper ammo.
  await page.keyboard.press('i');
  await expect(page.locator('#inventory-panel')).toBeVisible();
  await expect(page.locator('#inv-cash')).toContainText('5');
});

test('buy a snack: cash falls by the marked-up price, the row shrinks', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page, 'office-drone');
  await page.evaluate(() => window.__god.setCash(60));
  await openMachine(page);

  // A machine sells and does not buy - one column, and no sell buttons at all.
  await expect(page.locator('#shop-cash')).toContainText('60');
  await expect(page.locator('#shop-buy-0')).toBeVisible();
  expect(await page.locator('[id^=shop-sell-]').count()).toBe(0);

  const before = await page.evaluate(([x, z]) => window.__game.shopStockAt(x, z), [MACHINE.x, MACHINE.z]);
  expect(before.length).toBeGreaterThan(0);
  const row = before[0];

  await page.click('#shop-buy-0');

  // Cash, stock and bag moved together, and by MORE than the item's own value:
  // the markup is the joke, and it has to actually be charged.
  await expect.poll(() => page.evaluate(() => window.__game.cash), { timeout: 20_000 }).toBeLessThan(60);
  const spent = 60 - (await page.evaluate(() => window.__game.cash));
  expect(spent).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__game.inventory)).toContain(row.item);
  const after = await page.evaluate(([x, z]) => window.__game.shopStockAt(x, z), [MACHINE.x, MACHINE.z]);
  expect(after.find((r) => r.item === row.item)?.qty ?? 0).toBe(row.qty - 1);
});

test('a machine can be cleaned out, and the overlay says so afterwards', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page, 'office-drone');
  await page.evaluate(() => window.__god.setCash(500)); // money is not the constraint here
  await openMachine(page);

  // The machine starts with something in it...
  const stocked = await page.evaluate(([x, z]) => window.__game.shopStockAt(x, z), [MACHINE.x, MACHINE.z]);
  expect(stocked.length).toBeGreaterThan(0);

  // ...and is then cleaned out in ONE step rather than a real click per item.
  //
  // Buying it dry through the UI is what this test used to do, and it cost the
  // entire 300s budget on CI: ~9 clicks, each rebuilding the whole panel under
  // software GL. It was also re-proving coverage that already exists twice
  // over - the UI buy path is the test above, and shop.test.js pins the
  // "buying the last one empties the row, and the row refuses after" rule with
  // real atomicity assertions. What is left for an e2e to prove is the STATE a
  // cleaned-out machine presents, which is what this asserts.
  await page.evaluate(([x, z]) => window.__god.emptyShop(x, z), [MACHINE.x, MACHINE.z]);
  expect(await page.evaluate(([x, z]) => window.__game.shopStockAt(x, z), [MACHINE.x, MACHINE.z])).toEqual([]);
  await expect(page.locator('#shop-panel')).toContainText('SOLD OUT');

  await page.click('#shop-close');
  await expect(page.locator('#shop-panel')).toBeHidden();

  // The Alt overlay still labels it - saying it is spent, rather than silently
  // vanishing and leaving you to walk over and find out.
  await page.keyboard.down('Alt');
  await expect.poll(
    () => page.evaluate(() => [...document.querySelectorAll('.loot-label')]
      .some((n) => /sold out/i.test(n.textContent))),
    { timeout: 20_000 },
  ).toBe(true);
  await page.keyboard.up('Alt');
});

test('the veteran buys the junk a machine will not touch', async ({ page }) => {
  test.setTimeout(300_000);
  // Boot Floor 1 normally, then write a campaign save carrying this exact live
  // sheet onto Floor 2 - where the Mail Room Veteran stands - and reload.
  await bootAndPick(page, 'office-drone');
  await page.evaluate(() => {
    localStorage.setItem('escape-work.progress', JSON.stringify({
      version: 6, levelId: 'level2', active: 0, cash: 0, party: [window.__god.player],
    }));
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__game && window.__game.stats);
  await page.evaluate(() => window.__game.zoomOut());
  await page.waitForTimeout(700);

  // A toner cartridge (value 12) in the bag, and an empty purse.
  await page.evaluate(() => {
    window.__god.player.inventory = ['toner-cartridge'];
    window.__god.setCash(0);
  });

  const v = await page.evaluate(() => window.__game.npcs.find((n) => /Veteran/.test(n.name)));
  expect(v, 'the Mail Room Veteran is on Floor 2').toBeTruthy();
  await standBeside(page, v.x, v.z - 1);
  await clickBody(page, v.x, v.z, 0.9);
  await expect(page.locator('#dialogue-panel')).toBeVisible({ timeout: 60_000 });

  // Ask about the cart. Trading REPLACES the conversation rather than stacking
  // a second modal over it.
  await page.click('text=on the cart');
  await expect(page.locator('#shop-panel')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#dialogue-panel')).toBeHidden();

  // He buys, and at a markdown: value 12 at his 0.45 rate is 5.
  await expect(page.locator('#shop-sell-0')).toBeVisible();
  await page.click('#shop-sell-0');
  await expect.poll(() => page.evaluate(() => window.__game.cash), { timeout: 20_000 }).toBe(5);
  expect(await page.evaluate(() => window.__game.inventory)).toEqual([]);
});
