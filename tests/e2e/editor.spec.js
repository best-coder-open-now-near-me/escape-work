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

  // Map characters are allocated PER LEVEL now, so the export must still be
  // the same level: every cell has to mean what it meant in the source file.
  // Compared through the LEGENDS rather than as raw text, because a character
  // is no longer a global name - what has to survive is the tile under each
  // cell, not the letter standing for it.
  const meaning = (level) => level.map.map((row) => row.split('').map((c) => {
    if (c === ' ') return null;
    return level.actors?.[c] ? `actor:${level.actors[c]}` : (level.tiles?.[c] || 'floor');
  }));
  expect(meaning(out), 'every cell means what it meant in the source file')
    .toEqual(meaning(level1));

  // And the legend names ONLY what the level uses - the point of the change:
  // it used to carry the entire tile registry, which is what made a character
  // a scarce global resource. Floor rides along for the cells under actors.
  const usedChars = new Set(out.map.flatMap((r) => r.split('')));
  for (const c of Object.keys(out.tiles)) {
    expect(usedChars.has(c) || out.tiles[c] === 'floor',
      `exported legend entry "${c}" (${out.tiles[c]}) is actually used`).toBe(true);
  }
});

test('the map opens in safe selection mode and analysis can focus an invalid route', async ({ page }) => {
  await page.goto('/#editor');
  await page.waitForFunction(() => window.__editor, null, { timeout: 90_000 });
  await waitForSmoothFrames(page);

  await expect(page.locator('#ed-mode-select')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#brush-wall')).toHaveAttribute('aria-pressed', 'false');
  const before = await page.evaluate(() => window.__editor.charAt(11, 8));
  const centre = await page.evaluate(() => window.__editor.project(11, 8));
  await page.mouse.click(centre.x, centre.y);
  await expect.poll(
    () => page.evaluate(() => window.__editor.selection),
    { timeout: 30_000 },
  ).toEqual({ kind: 'cell', x: 11, z: 8 });
  expect(await page.evaluate(() => window.__editor.charAt(11, 8))).toBe(before);

  const broken = {
    name: 'Broken Route',
    depth: 1,
    tiles: { '.': 'floor', '#': 'wall', '>': 'exit' },
    actors: { '@': 'player' },
    map: ['#######', '#..#..#', '#.@#.>#', '#..#..#', '#######'],
  };
  await page.click('#ed-export');
  await page.locator('#export-json').fill(JSON.stringify(broken));
  await page.click('#export-load');
  const blockedRoute = page.locator('#editor-problems .editor-problem')
    .filter({ hasText: 'cannot be walked to' });
  await expect(blockedRoute).toHaveCount(1);
  await blockedRoute.click();
  await expect.poll(
    () => page.evaluate(() => window.__editor.selection),
    { timeout: 30_000 },
  ).toEqual({ kind: 'cell', x: 5, z: 2 });
  await expect(page.locator('#editor-selection')).toContainText('5,2');
});

test('storey creation and undo restore the entire level document', async ({ page }) => {
  await page.goto('/#editor');
  await page.waitForFunction(() => window.__editor, null, { timeout: 90_000 });
  await waitForSmoothFrames(page);

  await page.click('#ed-storey-add');
  await expect.poll(
    () => page.evaluate(() => JSON.parse(window.__editor.toJson()).layers?.length ?? 0),
    { timeout: 30_000 },
  ).toBe(2);
  await page.keyboard.press('Control+z');
  await expect.poll(
    () => page.evaluate(() => {
      const out = JSON.parse(window.__editor.toJson());
      return { layers: out.layers?.length ?? 0, hasMap: Array.isArray(out.map) };
    }),
    { timeout: 30_000 },
  ).toEqual({ layers: 0, hasMap: true });
});

test('palette categories collapse, expand, and reveal filter matches', async ({ page }) => {
  await page.goto('/#editor');
  await page.waitForFunction(() => window.__editor, null, { timeout: 90_000 });
  await waitForSmoothFrames(page);

  const basics = page.locator('#ed-category-basics');
  const work = page.locator('#ed-category-work');
  await expect(basics).toHaveAttribute('aria-expanded', 'true');
  await expect(work).toHaveAttribute('aria-expanded', 'false');

  await page.locator('#ed-filter').fill('desk corner');
  await expect(work).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#brush-desk-corner')).toBeVisible();
  await page.locator('#ed-filter').fill('');
  await expect(work).toHaveAttribute('aria-expanded', 'false');

  await work.click();
  await expect(work).toHaveAttribute('aria-expanded', 'true');
});

test('the inspector holds diagnostics and canvas edges resize directly', async ({ page }) => {
  await page.goto('/#editor');
  await page.waitForFunction(() => window.__editor, null, { timeout: 90_000 });
  await waitForSmoothFrames(page);

  await expect(page.locator('#editor-inspector #editor-analysis')).toHaveCount(1);
  await expect(page.locator('#editor-shell > #editor-analysis')).toHaveCount(0);
  await expect(page.locator('#ed-resize-x-left-add')).toHaveAttribute('aria-label', 'Add one column at the left edge');
  await expect(page.locator('#ed-resize-y-bottom-add')).toHaveAttribute('aria-label', 'Add one row at the bottom edge');

  const before = await page.evaluate(() => window.__editor.size);
  await page.click('#ed-resize-x-left-add');
  await expect.poll(
    () => page.evaluate(() => window.__editor.size),
    { timeout: 30_000 },
  ).toEqual({ width: before.width + 1, height: before.height });
  await page.click('#ed-resize-y-bottom-add');
  await expect.poll(
    () => page.evaluate(() => window.__editor.size),
    { timeout: 30_000 },
  ).toEqual({ width: before.width + 1, height: before.height + 1 });
});
