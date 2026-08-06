import { test, expect } from '@playwright/test';
import { bootStash, enterCombat, stableProject } from './helpers.js';

const DIAGNOSTIC_ARENA = {
  name: 'Diagnostic Arena',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '#########',
    '#.......#',
    '#..@.M..#',
    '#.......#',
    '#########',
  ],
};

test('dialogue reports resolver math and filters it from a collapsed Advanced section', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DIAGNOSTIC_ARENA, 'office-drone');
  await enterCombat(page);

  const advanced = page.locator('#narration-advanced');
  await expect(advanced).toBeVisible();
  await expect(advanced).not.toHaveAttribute('open', '');
  await expect(advanced.locator('summary')).toHaveText('Advanced');

  // Force a visible, deterministic attack through both production resolvers.
  // The pin is part of the hit formula rather than masquerading as a random
  // roll, while damage still reports the die value the seeded fight drew.
  await page.evaluate(() => { window.__combat.forceHit = true; });
  const foe = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  await page.click('#hotbar-act-attack');
  const point = await stableProject(page, foe.x, foe.z);
  await page.mouse.click(point.x, point.y);

  const formulas = page.locator('#narration-lines [data-narration-type="formula"]');
  await expect(formulas.filter({ hasText: 'Hit ·' }).last()).toContainText('debug pin hit → HIT');
  await expect(formulas.filter({ hasText: 'Damage ·' }).last()).toContainText('Composure soak');

  await advanced.locator('summary').click();
  for (const type of ['narration', 'combat', 'formula', 'initiative']) {
    await expect(page.locator(`#narration-filter-${type}`)).toBeChecked();
  }
  await page.locator('#narration-filter-formula').uncheck();
  await expect(formulas).toHaveCount(0);
  await expect(page.locator('#narration-lines [data-narration-type="combat"]')).not.toHaveCount(0);

  // Filtering changes the projection, not the retained history.
  await page.locator('#narration-filter-formula').check();
  await expect(formulas.filter({ hasText: 'Hit ·' }).last()).toContainText('Hit ·');
  await expect(formulas.filter({ hasText: 'Damage ·' }).last()).toContainText('Damage ·');
});
