// Fire, and the printer that has been waiting all game.
//
// surfaces-runtime.test.js already drives the state machine against a STUB
// grid, which is the point: the stub is exactly what these tests are not. What
// went untested was the WIRING - that igniting through the world menu reaches
// the runtime, that a burnt-out drift is really gone from the grid, that a
// detonation clears the prop off the terrain and hurts whoever was standing
// beside it. `__game.burning`, `smoking` and `surfaceAt` were exposed for specs
// that were never written; this is them.
//
// The Middle Manager is the class here for one reason: the Smoker talent
// carries a lighter, so ignition needs no matches to be found first.
import { test, expect } from '@playwright/test';
import { bootStash, waitStill } from './helpers.js';

// A trash can with a paper drift running off it to a printer. Fire spreads
// through the flammable paper and fuses the explosive at the end of it.
const FUSE_ROW = {
  name: 'Fuse Row',
  tiles: { '#': 'wall', '.': 'floor', T: 'trash', p: 'paper', R: 'printer' },
  actors: { '@': 'player' },
  map: [
    '##########',
    '#@.Tpppp##',
    '#......R##',
    '##########',
  ],
};

// The player standing next to the printer when it goes, with the paper they
// light diagonally placed so they never have to walk onto the blast tile.
const BLAST_ROOM = {
  name: 'PC Load Letter',
  tiles: { '#': 'wall', '.': 'floor', p: 'paper', R: 'printer' },
  actors: { '@': 'player' },
  map: [
    '#####',
    '#p..#',
    '#R@.#',
    '#####',
  ],
};

const burning = (page) => page.evaluate(() => window.__game.burning);
const hp = (page) => page.evaluate(() => window.__god.player.hp);
const tileAt = (page, x, z) => page.evaluate(([a, b]) => window.__game.tileAt(a, b), [x, z]);
const surfaceAt = (page, x, z) => page.evaluate(([a, b]) => window.__game.surfaceAt(a, b), [x, z]);

// Right-click a tile and pick a menu entry by its label. The world menu is how
// a player lights anything, so the test lights things the same way.
async function worldMenu(page, x, z, label) {
  const p = await page.evaluate(([a, b]) => window.__game.project(a, b), [x, z]);
  expect(p.x > 5 && p.y > 5, `(${x},${z}) projects on screen`).toBe(true);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const item = page.locator('#context-menu div', { hasText: label });
  await expect(item.first()).toBeVisible({ timeout: 10_000 });
  await item.first().click();
  await waitStill(page); // the verb walks you into reach first
}

test('lighting a trash can spreads fire down a paper drift', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, FUSE_ROW, 'middle-manager');

  expect(await burning(page)).toBe(0);
  await worldMenu(page, 3, 1, 'Flick the lighter');
  await expect.poll(() => burning(page), { timeout: 30_000 }).toBeGreaterThan(0);

  // The world clock advances fire a turn at a time out of combat, so the drift
  // catches without anyone taking a turn.
  await expect.poll(() => burning(page), { timeout: 60_000 }).toBeGreaterThan(1);

  // ...and it burns ITSELF out: paper is spent, and the grid no longer carries
  // the surface. (The can survives as a prop - only the drift is consumed.)
  await expect.poll(() => burning(page), { timeout: 120_000 }).toBe(0);
  await expect.poll(() => surfaceAt(page, 4, 1), { timeout: 30_000 }).toBe(null);
  expect(await tileAt(page, 3, 1)).toBe('trash'); // the can is scorched, not gone
});

test('smoke follows the fire, then clears', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, FUSE_ROW, 'middle-manager');
  await worldMenu(page, 3, 1, 'Flick the lighter');

  // Paper starts smoking on its last burning turn and the haze outlives the
  // flame - which is what makes smoke a real obstacle rather than decoration.
  await expect.poll(() => page.evaluate(() => window.__game.smoking), { timeout: 90_000 })
    .toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__game.smoking), { timeout: 120_000 }).toBe(0);
});

test('the printer detonates, clears its own tile, and shrapnels whoever is beside it', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, BLAST_ROOM, 'middle-manager');
  expect(await tileAt(page, 1, 2)).toBe('printer');

  const before = await hp(page);
  // Light the drift diagonally above the printer; the flame fuses it, and the
  // fuse is the telegraphed turn you would use to walk away. The player stays
  // put, one tile from the blast.
  await worldMenu(page, 1, 1, 'Flick the lighter');

  // The prop comes OFF the terrain when it goes - the tile is walkable floor
  // afterwards, not a printer-shaped hole in the pathing.
  await expect.poll(() => tileAt(page, 1, 2), { timeout: 120_000 }).toBe('floor');
  // ...and standing next to it costs you.
  expect(await hp(page)).toBeLessThan(before);
});
