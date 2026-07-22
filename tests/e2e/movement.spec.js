// Free-form movement: clicks land on exact points (not tile centres), and a
// click inside the current tile shuffles the body over.
import { test, expect } from '@playwright/test';
import { bootAndPick, clickWorld, waitStill } from './helpers.js';

test('a click walks to the exact point, not the tile centre', async ({ page }) => {
  await bootAndPick(page);
  const target = { x: 4.32, z: 3.63 }; // open floor near spawn, off-centre on purpose
  expect(await clickWorld(page, target.x, target.z)).toBe(true);
  await page.waitForTimeout(500);
  await waitStill(page);
  const pos = await page.evaluate(() => window.__game.playerPos);
  expect(Math.hypot(pos.x - target.x, pos.z - target.z)).toBeLessThan(0.15);
  // genuinely off the tile lattice
  const off = Math.max(Math.abs(pos.x - Math.round(pos.x)), Math.abs(pos.z - Math.round(pos.z)));
  expect(off).toBeGreaterThan(0.1);
});

test('a click inside the current tile shuffles the body over', async ({ page }) => {
  await bootAndPick(page);
  const start = await page.evaluate(() => window.__game.playerPos);
  const target = { x: start.x - 0.35, z: start.z + 0.3 };
  expect(await clickWorld(page, target.x, target.z)).toBe(true);
  await page.waitForTimeout(400);
  await waitStill(page);
  const pos = await page.evaluate(() => window.__game.playerPos);
  expect(Math.hypot(pos.x - target.x, pos.z - target.z)).toBeLessThan(0.15);
});
