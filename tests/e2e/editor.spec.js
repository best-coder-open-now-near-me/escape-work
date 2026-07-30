// Editor visual parity: the carpet-under-items pass runs live in the editor,
// so what you paint is what the game shows.
import { test, expect } from '@playwright/test';
import level1 from '../../levels/level1.json' with { type: 'json' };
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

// The editor is what the export modal - and ARCHITECTURE.md - point you at for
// editing levels/, so a load -> export round trip must not LOSE anything. It
// used to: `canonical()` mapped any actor id outside ENEMY_TYPES to the floor
// char on the way in, and the export legend only ever named the player and the
// enemies on the way out. Both shipped floors place a recruitable companion, so
// opening either one and exporting it deleted a companion - no error, no
// warning, and the level lint would not object because a floor without
// companions is perfectly valid.
test('loading a shipped level and exporting it keeps its companions', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/#editor');
  await page.waitForFunction(() => window.__editor, null, { timeout: 90_000 });
  await waitForSmoothFrames(page);

  // Level 1 places the IT companion ('N' -> it-support in its own legend).
  await page.selectOption('#ed-level', 'level1');
  // Poll for the LOAD rather than sleeping through it: a fixed wait is either
  // slower than it needs to be or shorter than the load, and under software GL
  // it is reliably both on different runs. The level being in the editor's own
  // output is the actual condition.
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.__editor.toJson())?.name ?? null),
    { timeout: 20_000 },
  ).toBeTruthy();

  const out = JSON.parse(await page.evaluate(() => window.__editor.toJson()));

  // The legend can NAME him...
  const named = Object.entries(out.actors).find(([, id]) => id === 'it-support');
  expect(named, 'the exported legend names the intern').toBeTruthy();
  // ...and he is still standing somewhere on the map under that char.
  const [char] = named;
  expect(out.map.some((row) => row.includes(char)),
    'the intern is still placed on the exported map').toBe(true);

  // ...and the WHOLE roster survives, not just the one we went looking for:
  // every actor the source file places is still placed in the export. Compared
  // against the shipped JSON itself, so adding an actor to level1 extends this
  // check for free instead of quietly falling outside it.
  const placed = (level) => {
    const used = new Set(level.map.flatMap((r) => r.split('')));
    return Object.entries(level.actors)
      .filter(([c]) => used.has(c)).map(([, id]) => id).sort();
  };
  expect(placed(out)).toEqual(placed(level1));
});
