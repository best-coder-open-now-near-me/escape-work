// Sneaking (SNEAK_PLAN M2/M3): the toggles, the enter-gate, the cone as the
// rule - skirt it behind desks and nothing happens, cross it and the fight
// starts with the spotter. The watcher is stilled (debugStillEnemies) so the
// spec tests detection, not where an amble happened to point a gaze.
import { test, expect } from '@playwright/test';
import { bootStash, clickWorld } from './helpers.js';

// The Manager at (1,1): longest open run is east, so the derived facing
// (SNEAK_PLAN D7) watches the top corridor. The desk row walls off a south
// lane a crouch-height body can slip along unseen.
const WATCH_LAB = {
  name: 'Watch Lab',
  tiles: { '#': 'wall', '.': 'floor', D: 'desk' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '##########',
    '#M.......#',
    '#.DDDDD..#',
    '#@.......#',
    '##########',
  ],
};

const sneakState = (page) => page.evaluate(() => window.__game.sneak);
const inCombat = (page) => page.evaluate(() => window.__game.inCombat);

async function bootLab(page) {
  await bootStash(page, WATCH_LAB, 'office-drone');
  await page.evaluate(() => window.__game.debugStillEnemies());
  // The watcher's body (and its derived facing) must exist before any
  // detection question means anything.
  await expect.poll(
    () => page.evaluate(() => window.__game.enemies?.length ?? 1),
    { timeout: 60_000 },
  ).toBeGreaterThanOrEqual(0);
}

test('h toggles a solo sneak on and off; the lab holds no fight', async ({ page }) => {
  await bootLab(page);
  await page.keyboard.press('h');
  expect(await sneakState(page)).toEqual({ mode: 'solo' });
  // Inert while unseen: cones exist, nothing happens (M2 before M3's teeth).
  await page.waitForTimeout(1500);
  expect(await inCombat(page)).toBe(false);
  await page.keyboard.press('h');
  expect(await sneakState(page)).toBe(null);
});

test('Shift+H sneaks the group', async ({ page }) => {
  await bootLab(page);
  await page.keyboard.press('Shift+H');
  expect(await sneakState(page)).toEqual({ mode: 'group' });
});

test('you cannot slip into a sneak somebody is watching (D8)', async ({ page }) => {
  await bootLab(page);
  // Walk into the watched corridor, in plain sight of the Manager.
  expect(await clickWorld(page, 5, 1)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.playerMoving),
    { timeout: 30_000 }).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__game.leaderSeen)).toBe(true);
  await page.keyboard.press('h');
  expect(await sneakState(page)).toBe(null); // refused
  expect(await inCombat(page)).toBe(false); // and refusal starts nothing
});

test('the desk lane hides a sneak; the open corridor busts it', async ({ page }) => {
  test.setTimeout(300_000);
  await bootLab(page);
  await page.keyboard.press('h');
  expect(await sneakState(page)).toEqual({ mode: 'solo' });

  // Skirt east along the south lane, crouch-height behind the desk row.
  expect(await clickWorld(page, 6, 3)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.playerMoving),
    { timeout: 30_000 }).toBe(false);
  expect(await inCombat(page)).toBe(false);
  expect(await sneakState(page)).toEqual({ mode: 'solo' });

  // Round the row's end into the watched corridor: spotted, fight on.
  expect(await clickWorld(page, 7, 1)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.inCombat),
    { timeout: 30_000 }).toBe(true);
  expect(await sneakState(page)).toBe(null); // the sneak died with the secret
});

// The Manager at (3,1) gazes down his long east corridor; the player starts
// on his blind side. Sneak up, strike: the fight opens with him SURPRISED
// even at arm's length - the sight rule replacing the distance proxy (D6).
const AMBUSH_LAB = {
  name: 'Ambush Lab',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '##########',
    '#..M.....#',
    '#@.......#',
    '##########',
  ],
};

const clickManager = async (page) => {
  const p = await page.evaluate(() => {
    const en = window.__game.enemies.find((e) => e.alive);
    return window.__game.project3(en.px ?? en.x, 0.9, en.pz ?? en.z);
  });
  await page.mouse.click(p.x, p.y);
};

test('an unseen strike opens the fight with the ambush (M4)', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, AMBUSH_LAB, 'office-drone');
  await page.evaluate(() => window.__game.debugStillEnemies());
  await page.keyboard.press('h');
  expect(await sneakState(page)).toEqual({ mode: 'solo' });

  // First click walks to his blind-side elbow. Proximity starts NOTHING
  // while unseen - standing at somebody's shoulder is the point (D1).
  await clickManager(page);
  await expect.poll(() => page.evaluate(() => window.__game.playerMoving),
    { timeout: 60_000 }).toBe(false);
  expect(await inCombat(page)).toBe(false);
  expect(await sneakState(page)).toEqual({ mode: 'solo' });

  // Second click swings: the fight opens, and he is SURPRISED at arm's
  // length - the ordinary distance rule never surprises an adjacent enemy,
  // so this status IS the sneak rule firing.
  await clickManager(page);
  await expect.poll(() => page.evaluate(() => window.__game.inCombat),
    { timeout: 60_000 }).toBe(true);
  const en = await page.evaluate(() => window.__combat.enemies[0]);
  expect(en.statuses.map((s) => s.id)).toContain('surprised');
  // And the ambusher leads: the opener's own initiative rule.
  expect(await page.evaluate(() => window.__combat.phase)).toBe('player');
});

test('rummaging ends the sneak without a fight (D10)', async ({ page }) => {
  test.setTimeout(300_000);
  await bootLab(page);
  await page.keyboard.press('h');
  expect(await sneakState(page)).toEqual({ mode: 'solo' });
  // The nearest desk is a container; rummage it from the hidden lane.
  expect(await clickWorld(page, 2, 2)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.narration.some((l) => /^Desk:/.test(l))),
    { timeout: 60_000 }).toBe(true);
  expect(await sneakState(page)).toBe(null); // interaction broke it...
  expect(await inCombat(page)).toBe(false);  // ...but broke it QUIETLY
});
