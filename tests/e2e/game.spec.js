// The class carousel is the one model-heavy selection flow not covered by the
// fast browser gate. Movement, inventory, doors, combat, and the editor each
// have a dedicated spec elsewhere.
import { test, expect } from '@playwright/test';

test('the class carousel browses every resume and hires one', async ({ page }) => {
  // This test renders EVERY class's .glb, one per slide, and under CI's
  // software GL each of those costs tens of seconds. Adding the Security class
  // pushed the walk past the default 120s, so it gets the same budget as the
  // other model-heavy specs - the work is inherently linear in class count.
  test.setTimeout(300_000);
  await page.goto('/');
  await page.click('#level-pick-level1'); // the floor-select desk comes first
  // One resume at a time, straight from the class registry; arrows browse.
  await expect(page.locator('#resume-card')).toBeVisible();
  await expect(page.locator('#resume-card')).toContainText('Office Drone');
  // Registry order (data/classes.js), skipping the non-playable employee.
  const classNames = ['Middle Manager', 'Mail Room', 'IT Support', 'Human Resources', 'Security'];
  for (const name of classNames) {
    await page.click('#carousel-next');
    await expect(page.locator('#resume-card')).toContainText(name);
    await expect(page.locator('#resume-card')).not.toContainText('Sick days');
  }
  // Then the blank card, which is the LAST one and is not one of the six. It is
  // checked by its own button rather than by its text: the blank résumé lists
  // whichever kit it would inherit, so every class name appears on it as a
  // choosable job and a text assertion here would pass for the wrong reason.
  await page.click('#carousel-next');
  await expect(page.locator('#pick-custom')).toBeVisible();
  await expect(page.locator('#pick-office-drone')).toHaveCount(0);
  // ...and one more wraps back to the drone; the active slide's button hires.
  await page.click('#carousel-next');
  await expect(page.locator('#pick-office-drone')).toBeVisible();
  await page.click('#pick-office-drone');
  // Picking one of the six opens the short form beside them: pronouns and two
  // points, nothing that could change who they are. Committing without
  // spending gives byte-for-byte the character this test always got - so the
  // HP assertion below is unchanged, and that is the point of it.
  await expect(page.locator('#creation-badge')).toBeVisible();
  await page.click('#creation-commit');
  await expect(page.locator('#stats')).toContainText('HP 22/22');
  const tile = await page.evaluate(() => window.__game.playerTile);
  expect(tile).toEqual({ x: 2, z: 2 }); // level1 spawn
});
