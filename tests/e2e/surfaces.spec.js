// Surface behavior in a bespoke stashed arena: plain water slips walkers
// harmlessly, gum-on-shoe slows/marks/tractions/wears off, and the Mail
// Room's Warehouse Soles never slip at all.
import { test, expect } from '@playwright/test';
import { bootStash, clickWorld, waitStill } from './helpers.js';

// A corridor with an unavoidable 2-wide water strip and one gum wad off to
// the side at (1,1). No cables: the water stays plain.
const SLIP_LAB = {
  name: 'Slip Lab',
  tiles: { '#': 'wall', '.': 'floor', '~': 'water', 'g': 'gum' },
  actors: { '@': 'player' },
  map: [
    '.....~~.....',
    '.g...~~.....',
    '.....~~.....',
    '.@...~~.....',
    '.....~~.....',
    '.....~~.....',
    '.....~~.....',
  ],
};

const subtitle = (page) => page.evaluate(() => document.getElementById('subtitle')?.textContent || '');

// Cross the strip n times; count walks that ended short of the target
// (a slip drops the walker mid-stride). Finishes interrupted crossings so
// laps keep alternating cleanly.
async function crossings(page, n) {
  let slips = 0;
  let sawSlipLine = false;
  for (let i = 0; i < n; i++) {
    const target = i % 2 === 0 ? [9, 3] : [1, 3];
    await clickWorld(page, target[0], target[1]);
    await page.waitForTimeout(400);
    await waitStill(page);
    const pt = await page.evaluate(() => window.__game.playerTile);
    if (pt.x !== target[0] || pt.z !== target[1]) {
      slips += 1;
      if (/wet|slip/i.test(await subtitle(page))) sawSlipLine = true;
      await clickWorld(page, target[0], target[1]);
      await page.waitForTimeout(400);
      await waitStill(page).catch(() => {});
    }
  }
  return { slips, sawSlipLine };
}

test('plain water slips the walker, harmlessly', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, SLIP_LAB);
  const hp0 = await page.evaluate(() => window.__game.stats.hp);
  const { slips, sawSlipLine } = await crossings(page, 8);
  // 16 wet tiles entered at 45%: zero slips is a ~10^-4 fluke.
  expect(slips).toBeGreaterThanOrEqual(1);
  expect(sawSlipLine).toBe(true);
  expect(await page.evaluate(() => window.__game.stats.hp)).toBe(hp0); // dignity only
});

// The longest test in the suite, and the only one that needed its own budget.
// It walks the player through ~32 click-settle cycles - a wad, eight water dips
// to prove gum is traction, then fourteen more tiles to wear it off - and every
// `waitStill` costs two 700ms polls before it can agree the body has stopped.
//
// 300s was not enough on CI and this is arithmetic, not flake: the test takes
// ~175s here on one uncontended worker, `surfaces.spec.js` was already the
// second-slowest FILE on main's own run (13.2m), and CI runs two workers over a
// suite that keeps growing - 121 tests in 1.7h on main, 131 in 1.9h here. A
// test sitting at 60% of its budget uncontended has nowhere to go when the
// runner is shared, which is exactly what happened: it hit 300s twice, on the
// run and on the retry, while every assertion in it passes locally.
//
// Raised rather than trimmed because what makes it slow is what makes it worth
// having: the eight dips are the sample size that proves traction, and the
// fourteen tiles are how the step clock actually gets spent.
test('gum sticks, slows, shows on the HUD, grants traction, wears off', async ({ page }) => {
  test.setTimeout(600_000);
  await bootStash(page, SLIP_LAB);
  // Step on the wad.
  await clickWorld(page, 1, 1);
  await page.waitForTimeout(400);
  await waitStill(page);
  expect(await page.evaluate(() => window.__game.stats.gum)).toBeGreaterThan(0);
  await expect(page.locator('#status-effects')).toContainText('Gum on shoe ·20');
  expect(await page.evaluate(() => window.__game.playerSpeed)).toBeCloseTo(2.4, 1); // 4 * 0.6

  // Gum is traction: repeated single-tile water dips, zero slip lines.
  await clickWorld(page, 4, 1);
  await page.waitForTimeout(300);
  await waitStill(page);
  let dips = 0;
  for (let i = 0; i < 8; i++) {
    if ((await page.evaluate(() => window.__game.stats.gum)) < 2) break;
    await clickWorld(page, 5, 1);
    await page.waitForTimeout(300);
    await waitStill(page);
    expect(/wet floor|go down/i.test(await subtitle(page))).toBe(false);
    dips += 1;
    await clickWorld(page, 4, 1);
    await page.waitForTimeout(300);
    await waitStill(page);
  }
  expect(dips).toBeGreaterThanOrEqual(5);

  // It wears off with mileage.
  for (let i = 0; i < 14 && (await page.evaluate(() => window.__game.stats.gum)) > 0; i++) {
    await clickWorld(page, i % 2 === 0 ? 1 : 4, i % 2 === 0 ? 5 : 3);
    await page.waitForTimeout(300);
    await waitStill(page).catch(() => {});
  }
  expect(await page.evaluate(() => window.__game.stats.gum)).toBe(0);
});

test('Warehouse Soles (Mail Room) never slip', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, SLIP_LAB, 'mail-room');
  const { slips } = await crossings(page, 8);
  expect(slips).toBe(0);
});
