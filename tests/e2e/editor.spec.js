// Editor visual parity: the carpet-under-items pass runs live in the editor,
// so what you paint is what the game shows.
import { test, expect } from '@playwright/test';
import { waitForSmoothFrames } from './helpers.js';

test('carpet flows under items and repaints live', async ({ page }) => {
  await page.goto('/#editor');
  await page.waitForFunction(() => window.__editor, null, { timeout: 90_000 });
  await waitForSmoothFrames(page);

  // Level 1's rooms: props inherit their zone's carpet; plain floor never does.
  expect(await page.evaluate(() => window.__editor.carpetAt(3, 14))).toBe('it-floor'); // printer
  expect(await page.evaluate(() => window.__editor.carpetAt(2, 8))).toBe('break-floor'); // plant
  expect(await page.evaluate(() => window.__editor.carpetAt(8, 6))).toBe(null); // open floor
  expect(await page.evaluate(() => window.__editor.carpetAt(8, 2))).toBe(null); // desk on gray

  // Painting carpet beside the desk recolors under it immediately...
  await page.click('#brush-break-floor');
  await page.waitForTimeout(400); // camera settle
  const p = await page.evaluate(() => window.__editor.project(7, 2));
  await page.mouse.click(p.x, p.y);
  await expect.poll(
    () => page.evaluate(() => window.__editor.carpetAt(8, 2)),
    { timeout: 30_000 },
  ).toBe('break-floor');

  // ...and erasing it reverts the inheritance.
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect.poll(
    () => page.evaluate(() => window.__editor.carpetAt(8, 2)),
    { timeout: 30_000 },
  ).toBe(null);
});
