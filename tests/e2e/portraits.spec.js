// Live character portraits (portraits.js): each is the character's OWN model,
// rendered offscreen and copied into the HUD. These tests care about two
// things a static badge could fake - that a real render happened, and that a
// different character produces a different picture.
import { test, expect } from '@playwright/test';
import { bootAndPick, bootStash, enterCombat } from './helpers.js';

// Decode a data URL in the page and report what is actually in the pixels.
// A blank/erroring render still produces a valid PNG, so "it exists" proves
// nothing - the give-away is whether anything differs from the background.
const inspect = (page, url) => page.evaluate((src) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    let opaque = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 8) opaque += 1;
      seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
    }
    resolve({ w: img.width, h: img.height, colors: seen.size, opaque });
  };
  img.onerror = () => resolve(null);
  img.src = src;
}), url);

const leaderPortrait = (page) => page.evaluate(() =>
  window.__god.playerActor?.portraitUrl || null);

test('the leader portrait is a real render of their own model', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page, 'office-drone');

  // It arrives asynchronously - one offscreen render, once per character type.
  await expect.poll(() => leaderPortrait(page), { timeout: 60_000 }).not.toBe(null);
  const url = await leaderPortrait(page);
  expect(url.startsWith('data:image/png')).toBe(true);

  const info = await inspect(page, url);
  expect(info).not.toBe(null);
  expect(info.w).toBe(128);
  expect(info.h).toBe(128);
  // A failed render is a flat fill of the clear colour. A real one has a lit
  // character in it, so it carries many distinct colours.
  expect(info.colors).toBeGreaterThan(6);
  expect(info.opaque).toBeGreaterThan(1000);

  // And it reaches the HUD frame the player actually looks at.
  await expect(page.locator('#stats-portrait-slot img')).toBeVisible();
  expect(await page.locator('#stats-portrait-slot img').getAttribute('src')).toBe(url);
});

test('different characters render different portraits', async ({ page }) => {
  test.setTimeout(300_000);
  // IT Support uses its own rig; the Manager enemies use theirs. Two different
  // models must not produce the same picture.
  await bootAndPick(page, 'it-support');
  await expect.poll(() => leaderPortrait(page), { timeout: 60_000 }).not.toBe(null);
  const mine = await leaderPortrait(page);

  await expect.poll(() => page.evaluate(() =>
    window.__god.enemies.some((e) => e.portraitUrl)), { timeout: 60_000 }).toBe(true);
  const theirs = await page.evaluate(() =>
    window.__god.enemies.find((e) => e.portraitUrl).portraitUrl);

  expect(theirs).not.toBe(mine); // different model => different pixels
  const info = await inspect(page, theirs);
  expect(info.colors).toBeGreaterThan(6);
});

const DUEL = {
  name: 'Portrait Duel',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '#########',
    '#..@M...#',
    '#########',
  ],
};

test('the initiative strip shows a face for every combatant', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DUEL, 'office-drone');
  await enterCombat(page);
  // One row per combatant, each led by that combatant's own rendered face.
  await expect.poll(async () => page.locator('#combat-strip img').count(),
    { timeout: 60_000 }).toBeGreaterThan(1);
});
