// Thrown weapons: the one whole verb the suite never exercised. Paper balls
// and airplanes are the game's only ranged option, and every rule about them
// went untested - the range and line-of-sight gates, the ammo spend, and
// HIT_PLAN's rule that A MISS STILL SPENDS THE COST. That last one is the
// expensive kind of gap: a regression that stops charging paper on a miss makes
// ranged strictly better than melee, and nothing goes red.
//
// Where a rule can be checked BEFORE a fight starts, it is: the out-of-combat
// hotbar opener runs the same range/line/ammo gate combat does, and it resolves
// with no AI turn in between, so the coworker cannot wander out of the geometry
// the test set up. The in-combat tests pin the roll with `__combat.forceHit`
// (true always lands, false always misses), which is what lets a test assert on
// the MISS branch at all.
import { test, expect } from '@playwright/test';
import { bootStash, enterCombat, waitForPlayerTurn } from './helpers.js';

// The Manager three tiles east of the player: inside the throw range of 5, with
// a clear line, and too far to melee.
const RANGE_ARENA = {
  name: 'Throwing Range',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '########',
    '#.@..M.#',
    '########',
  ],
};

// The same fight with a partition between thrower and target. Throws SAIL OVER
// chest-high partitions (ARCHITECTURE.md: hasLos is terrain + grid.sightOpen),
// so this proves the line test lets them through - the opposite of what a naive
// "is anything between us" test would do.
const PARTITION_ARENA = {
  name: 'Throwing Over Cubicles',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  walls: ['V 4 1 1'], // one partition, on the west face of (4,1) - between them
  map: [
    '########',
    '#.@..M.#',
    '########',
  ],
};

// A '#' cell wall is solid all the way up, and DOES stop a throw. The Manager
// sits in a side pocket with no line to the player.
const SEALED_ARENA = {
  name: 'No Line',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '#######',
    '#.@.#M#',
    '#...#.#',
    '#.....#',
    '#######',
  ],
};

const paper = (page) => page.evaluate(() => window.__god.player.paper);
const setPaper = (page, n) => page.evaluate((v) => {
  window.__god.player.paper = v;
  window.__combat?.refresh();
}, n);
const managerHp = (page) => page.evaluate(() =>
  window.__combat.enemies.find((e) => e.name === 'The Manager')?.hp ?? null);
const lastLine = (page) => page.evaluate(() => window.__game.narration.at(-1) || '');
const clickManager = async (page) => {
  const p = await page.evaluate(() => {
    const en = window.__game.enemies.find((e) => e.alive);
    return window.__game.project3(en.px ?? en.x, 0.9, en.pz ?? en.z);
  });
  await page.mouse.click(p.x, p.y);
};

// Arm a throw on the COMBAT bar and send it at the Manager. The projectile is
// cosmetic - the fight resolved before it existed - so a short settle is enough.
async function throwInCombat(page, actionId) {
  await waitForPlayerTurn(page);
  await page.click(`#hotbar-act-${actionId}`);
  expect(await page.evaluate(() => window.__combat.armed)).toBe(actionId);
  await clickManager(page);
  await page.waitForTimeout(700);
}

// --- the line test, decided before a fight can start ------------------------

test('a solid wall refuses the throw, and the refusal is free', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, SEALED_ARENA);
  await setPaper(page, 5);
  // The geometry the refusal is about: no line from the player to the pocket.
  expect(await page.evaluate(() => window.__game.losClear(2, 1, 5, 1))).toBe(false);

  await page.click('#hotbar-act-paper-ball');
  // Confirm the throw is ARMED before aiming it. Arming is async state behind
  // the click, and until it lands the next click on the Manager is not a
  // refused throw at all - it is a plain engage click. SEALED_ARENA blocks the
  // LINE but not the FLOOR (row 3 is open all the way round), so that click
  // walks the player around the wall and opens the fight, which is exactly how
  // this failed on CI: "expected inCombat false, received true".
  await expect.poll(() => page.evaluate(() => window.__game.armed),
    { timeout: 10_000 }).toBe('paper-ball');
  await clickManager(page);
  await page.waitForTimeout(900);

  expect(await page.evaluate(() => window.__game.inCombat)).toBe(false); // no fight opened
  expect(await paper(page)).toBe(5); // and a refusal costs nothing
  expect(await lastLine(page)).toMatch(/line/i);
});

test('a chest-high partition does NOT stop a throw', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, PARTITION_ARENA);
  await setPaper(page, 5);
  // Same span as the sealed arena, but the only thing between them is a
  // partition - and a throw sails over it.
  expect(await page.evaluate(() => window.__game.losClear(2, 1, 5, 1))).toBe(true);

  await page.click('#hotbar-act-paper-ball');
  await clickManager(page);
  // The opener IS the throw: combat starts with the paper already spent.
  await expect.poll(() => page.evaluate(() => window.__game.inCombat), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(700);
  expect(await paper(page)).toBe(4);
});

// --- the ammo rules, in a fight ---------------------------------------------

test('a throw costs its paper and lands from range', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, RANGE_ARENA);
  await enterCombat(page);
  await page.evaluate(() => { window.__combat.forceHit = true; });
  await setPaper(page, 5);

  const hp0 = await managerHp(page);
  await throwInCombat(page, 'paper-ball');

  expect(await paper(page)).toBe(4); // a paper ball is one sheet
  expect(await managerHp(page)).toBeLessThan(hp0);
});

test('a MISS still spends the paper (HIT_PLAN #4)', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, RANGE_ARENA);
  await enterCombat(page);
  // Pin every roll to a miss: the branch where the throw goes nowhere is the
  // whole subject of this test.
  await page.evaluate(() => { window.__combat.forceHit = false; });
  await setPaper(page, 5);

  const hp0 = await managerHp(page);
  await throwInCombat(page, 'paper-ball');

  expect(await managerHp(page)).toBe(hp0); // nothing landed...
  expect(await paper(page)).toBe(4); // ...and the sheet is gone anyway
  expect(await lastLine(page)).toMatch(/sails past|miss/i);
});

test('an empty pocket disables the throw on the combat bar', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, RANGE_ARENA);
  await enterCombat(page);
  await waitForPlayerTurn(page);

  await setPaper(page, 0);
  // The affordance says so before a click has to refuse.
  await expect(page.locator('#hotbar-act-paper-ball')).toHaveAttribute('data-affordable', 'false');
  await setPaper(page, 1);
  await expect(page.locator('#hotbar-act-paper-ball')).toHaveAttribute('data-affordable', 'true');
});

test('the Origami Specialist folds an airplane for one sheet, not two', async ({ page }) => {
  test.setTimeout(300_000);
  // The airplane's data cost is 2; the Office Drone's Origami Specialist talent
  // discounts multi-sheet throws to 1 (stats.js ammoCostOf). The bar, the
  // targeting gate and combat itself all have to agree about that - the
  // divergence that once greyed out a throw the click would have allowed.
  await bootStash(page, RANGE_ARENA, 'office-drone');
  await enterCombat(page);
  await page.evaluate(() => { window.__combat.forceHit = true; });
  await waitForPlayerTurn(page);
  await setPaper(page, 1); // exactly one sheet: affordable ONLY with the discount

  await expect(page.locator('#hotbar-act-paper-airplane')).toHaveAttribute('data-affordable', 'true');
  const hp0 = await managerHp(page);
  await throwInCombat(page, 'paper-airplane');

  expect(await paper(page)).toBe(0);
  expect(await managerHp(page)).toBeLessThan(hp0);
});
