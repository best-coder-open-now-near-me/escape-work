// Ranged WEAPONS: the first attacks that are fired rather than swung and cost
// no ammo to fire. Everything ranged before them was a paper throw, which is
// why `ammoCost` had quietly become the flag five call sites read to mean "is
// this ranged" - and why a weapon that fired for free would otherwise have
// resolved as a melee swing and lunged its owner across the room.
//
// The rules worth pinning are the ones a refactor can silently undo:
//   - it fires from range and spends NO paper (the split's whole point)
//   - it does not close the distance to fire when it doesn't have to
//   - it DOES close the distance when it has to, and fires on arrival - the
//     basic attack is what a bare click on a coworker uses, so refusing to
//     move would break the most obvious verb in the game for anyone holding one
//   - a solid wall refuses the shot, free of charge, like it refuses a throw
//
// The out-of-combat opener is used where it can be: it runs the same gate
// combat does and resolves with no AI turn in between, so the coworker cannot
// wander out of the geometry the test set up.
import { test, expect } from '@playwright/test';
import { bootStash, enterCombat, waitForPlayerTurn } from './helpers.js';

// The Manager three tiles east: inside the staple gun's range of 4, outside
// anyone's melee reach.
const RANGE_ARENA = {
  name: 'Firing Range',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '########',
    '#.@..M.#',
    '########',
  ],
};

// Seven tiles of corridor: further than the gun carries, so the shot has to be
// walked into range first.
const LONG_ARENA = {
  name: 'Long Corridor',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '############',
    '#.@......M.#',
    '############',
  ],
};

// The Manager SEALED in a pocket: no line for the staple, and no way round for
// the walk-in either. Note this is a harder case than the throwing suite's
// sealed arena, where a route around the wall exists - a blocked line alone
// does not refuse a WEAPON, because a weapon that can walk simply walks. Only
// "there is no shot from anywhere you can stand" is a refusal.
const SEALED_ARENA = {
  name: 'No Line of Fire',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '########',
    '#.@..#M#',
    '#....#.#',
    '########',
  ],
};

const paper = (page) => page.evaluate(() => window.__god.player.paper);
const playerTile = (page) => page.evaluate(() => window.__game.playerTile);
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

// Put a weapon in the leader's hand through the real inventory DOM - the path
// that rebuilds the hotbar around the swing it grants. Setting `equipped`
// directly would leave the bar showing the kit of the weapon before it.
async function equipWeapon(page, itemId) {
  await page.evaluate((id) => { window.__god.player.inventory = [id]; }, itemId);
  await page.keyboard.press('i');
  await expect(page.locator('#inventory-panel')).toBeVisible();
  await page.click('#inv-equip-0');
  await expect.poll(() => page.evaluate(() => window.__game.stats.equipped.weapon)).toBe(itemId);
  await page.keyboard.press('i'); // close the pockets before clicking the world
  await expect(page.locator('#inventory-panel')).toBeHidden();
}

test('a staple gun opens the fight from range, and spends no paper doing it', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, RANGE_ARENA);
  await equipWeapon(page, 'staple-gun');
  await page.evaluate(() => { window.__god.player.paper = 5; });
  const start = await playerTile(page);

  await page.click('#hotbar-act-staple-gun-fire');
  await clickManager(page);
  await expect.poll(() => page.evaluate(() => window.__game.inCombat), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(700);

  // Fired from where they stood: no walk-up, and the fight opened anyway.
  expect(await playerTile(page)).toEqual(start);
  // Ammo is for the specialty shots. A weapon that fires free stays free.
  expect(await paper(page)).toBe(5);
  expect(await lastLine(page)).toMatch(/staple gun|filing cabinet/i);
});

test('a sealed pocket refuses the shot, and the refusal is free', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, SEALED_ARENA);
  await equipWeapon(page, 'staple-gun');
  // The geometry the refusal is about: no line from the player to the pocket.
  expect(await page.evaluate(() => window.__game.losClear(2, 1, 6, 1))).toBe(false);
  const start = await playerTile(page);

  await page.click('#hotbar-act-staple-gun-fire');
  await clickManager(page);
  await page.waitForTimeout(900);

  expect(await page.evaluate(() => window.__game.inCombat)).toBe(false); // no fight opened
  expect(await playerTile(page)).toEqual(start); // and a refusal is not a walk
  expect(await lastLine(page)).toMatch(/shot|line/i);
});

test('out of range, the shot walks itself in and fires on arrival', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, LONG_ARENA);
  await equipWeapon(page, 'staple-gun');
  const start = await playerTile(page);

  await page.click('#hotbar-act-staple-gun-fire');
  await clickManager(page);
  await expect.poll(() => page.evaluate(() => window.__game.inCombat), { timeout: 30_000 }).toBe(true);
  // The walk, then the shot at the end of it. The roll cannot be pinned here -
  // the opening resolves as combat is published - so this asserts the shot was
  // TAKEN, hit or miss, which is the branch under test.
  await expect.poll(() => lastLine(page), { timeout: 40_000 })
    .toMatch(/staple gun|filing cabinet/i);

  const end = await playerTile(page);
  const en = await page.evaluate(() =>
    window.__combat.enemies.find((e) => e.name === 'The Manager'));
  expect(Math.abs(end.x - start.x)).toBeGreaterThan(0); // it closed the distance...
  // ...and stopped as soon as the shot was on, rather than walking to his elbow.
  expect(Math.max(Math.abs(end.x - en.x), Math.abs(end.z - en.z))).toBeLessThanOrEqual(4);
});

test('firing in a fight costs AP and no ammo, and never moves the shooter', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, RANGE_ARENA);
  await equipWeapon(page, 'spitball-straw');
  await page.evaluate(() => { window.__god.player.paper = 3; });
  await enterCombat(page);
  await page.evaluate(() => { window.__combat.forceHit = true; });
  await waitForPlayerTurn(page);

  const hp0 = await managerHp(page);
  const ap0 = await page.evaluate(() => window.__combat.ap);
  const where = await playerTile(page);

  await page.click('#act-spitball-shot');
  expect(await page.evaluate(() => window.__combat.armed)).toBe('spitball-shot');
  await clickManager(page);
  await page.waitForTimeout(900);

  expect(await managerHp(page)).toBeLessThan(hp0);
  expect(await page.evaluate(() => window.__combat.ap)).toBeLessThan(ap0);
  expect(await paper(page)).toBe(3); // the straw is not billed in paper
  expect(await playerTile(page)).toEqual(where); // and it did not lunge
});
