// Character creation (CHARACTER_PLAN). One boot, because the carousel is the
// slow path: every slide renders a .glb, which under CI's software GL costs
// tens of seconds each. This spec walks it exactly once and asserts everything
// it can from that one arrival.
import { test, expect } from '@playwright/test';

test('you can name yourself, and the game calls you that', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#resume-card')).toBeVisible();

  // Hire the first candidate on the desk - whoever it is. Naming the class
  // would mean paging the carousel, which is the cost this spec refuses.
  await page.click('#pick-office-drone');

  // Step 2 - the badge photo. The candidate stays on the spawn tile behind it:
  // this screen replaces the résumé CARD, not the body, which is what keeps it
  // free of a .glb reload.
  const badge = page.locator('#creation-badge');
  await expect(badge).toBeVisible();

  const name = page.locator('#creation-name');
  await expect(name).toHaveValue('Office Drone'); // prefilled with the job
  await name.fill('Dana');

  await page.click('#creation-pronoun-she');
  await expect(page.locator('#creation-pronoun-she')).toHaveAttribute('aria-pressed', 'true');

  // The read-back reflects both, live, under the button that commits them.
  await expect(page.locator('#creation-summary')).toContainText('Dana');
  await expect(page.locator('#creation-summary')).toContainText('she/her');

  await page.click('#creation-commit');
  await expect(badge).toBeHidden();

  // The name is the character's, and the JOB is still the job - every rule
  // reads className, so hiring an Office Drone must still produce one.
  const who = await page.evaluate(() => ({
    name: window.__game.stats.name,
    className: window.__game.stats.className,
    pronouns: window.__game.stats.pronouns,
  }));
  expect(who).toEqual({ name: 'Dana', className: 'Office Drone', pronouns: 'she' });
});

test('skipping the paperwork produces exactly the express-lane character', async ({ page }) => {
  // The invariant the whole ordering rule in createCharacter exists to protect:
  // an untouched draft is byte-for-byte what #class= has always produced.
  await page.goto('/#class=office-drone');
  await page.waitForFunction(() => window.__game && window.__game.stats);
  const express = await page.evaluate(() => {
    const s = window.__game.stats;
    return { name: s.name, maxHp: s.maxHp, maxAp: s.maxAp, attr: s.attr, base: s.base };
  });

  await page.goto('/');
  await expect(page.locator('#resume-card')).toBeVisible();
  await page.click('#pick-office-drone');
  await page.click('#creation-skip');
  await page.waitForFunction(() => window.__game && window.__game.stats);
  const skipped = await page.evaluate(() => {
    const s = window.__game.stats;
    return { name: s.name, maxHp: s.maxHp, maxAp: s.maxAp, attr: s.attr, base: s.base };
  });

  expect(skipped).toEqual(express);
});
