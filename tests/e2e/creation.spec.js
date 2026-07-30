// Character creation (CHARACTER_PLAN). The desk is the slow path: every slide
// renders a .glb, which under CI's software GL costs tens of seconds each.
// These specs are the only ones that walk it, and they need the room - the
// failures this replaced were the 120s budget running out mid-assertion, not
// the flow misbehaving.
import { test, expect } from '@playwright/test';

test.slow();

test('one of the six is played as written - no form to decline', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#resume-card')).toBeVisible();

  // Hire the first candidate on the desk. Naming a class would mean paging the
  // carousel, which is the cost this spec refuses.
  await page.click('#pick-office-drone');

  const card = page.locator('#creation-badge');
  await expect(card).toBeVisible();

  // A precut character is somebody already. There is no name field and no
  // wardrobe on this card: the job is the name and the class rig is the body,
  // and neither is a blank for the player to fill in. That is the whole rework
  // - every start used to walk into a customization screen.
  await expect(page.locator('#creation-name')).toHaveCount(0);
  await expect(page.locator('[id^="creation-rig-"]')).toHaveCount(0);
  // And what was removed outright is gone from both doors.
  await expect(page.locator('[id^="creation-tint-"]')).toHaveCount(0);
  await expect(page.locator('[id^="creation-build-"]')).toHaveCount(0);
  await expect(page.locator('[id^="creation-background-"]')).toHaveCount(0);

  // What IS asked: pronouns, and two points that explain themselves.
  await page.click('#creation-pronoun-she');
  await expect(page.locator('#creation-pronoun-she')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#creation-summary')).toContainText('she/her');
  await expect(page.locator('#creation-summary')).toContainText('Office Drone');

  await page.click('#creation-attr-savvy');
  await page.click('#creation-attr-savvy');
  await page.click('#creation-commit');
  await expect(card).toBeHidden();

  const who = await page.evaluate(() => ({
    name: window.__game.stats.name,
    className: window.__game.stats.className,
    pronouns: window.__game.stats.pronouns,
    model: window.__game.stats.model,
    rig: window.__game.stats.rig,
    savvy: window.__game.stats.attr.savvy,
    classSavvy: window.__game.classes['office-drone'].attr.savvy,
    classModel: window.__game.classes['office-drone'].model,
  }));
  expect(who.name).toBe('Office Drone'); // named for the job, never renamed
  expect(who.className).toBe('Office Drone');
  expect(who.pronouns).toBe('she');
  expect(who.rig).toBeUndefined(); // no body of their own - they track the class
  expect(who.model).toBe(who.classModel);
  expect(who.savvy).toBe(who.classSavvy + 2);
});

test('the blank card makes somebody, on a body nobody else wears', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#resume-card')).toBeVisible();

  // The custom door sits ON the desk alongside the six rather than behind them.
  // It is the last card, so one step backwards reaches it.
  await page.click('#carousel-prev');
  await expect(page.locator('#pick-custom')).toBeVisible();

  // Whose job you do is chosen ON the blank card: it is the one thing a custom
  // character must decide, and the kit listing is right there to decide from.
  await page.click('#custom-job-security');
  await page.click('#pick-custom');

  const card = page.locator('#creation-badge');
  await expect(card).toBeVisible();

  // Now there IS a name and a body, because now nobody has been decided yet.
  await page.fill('#creation-name', 'Dana');
  await expect(page.locator('#creation-summary')).toContainText('Dana');

  const rigs = page.locator('[id^="creation-rig-"]');
  await expect(rigs).not.toHaveCount(0);

  await page.click('#creation-commit');
  await expect(card).toBeHidden();

  const who = await page.evaluate(() => ({
    name: window.__game.stats.name,
    className: window.__game.stats.className,
    model: window.__game.stats.model,
    rig: window.__game.stats.rig,
    classModel: window.__game.classes.security.model,
  }));
  expect(who.name).toBe('Dana');
  expect(who.className).toBe('Security'); // the KIT is the job that was picked
  expect(who.rig).toBeTruthy();
  expect(who.model).toBe(who.rig);
  // The body is NOT the Security class's. A custom character never wears one of
  // the six, which is what stops them turning up looking like somebody else.
  expect(who.model).not.toBe(who.classModel);
});

test('backing out of the card returns to the desk instead of starting the run', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#resume-card')).toBeVisible();
  await page.click('#pick-office-drone');
  await expect(page.locator('#creation-badge')).toBeVisible();

  // Escape used to COMMIT: the handler called a "skip the paperwork" path that
  // started the run, so the one gesture that universally means cancel did the
  // opposite of cancelling, and there was no route back to the desk at all.
  await page.click('#creation-back');
  await expect(page.locator('#creation-badge')).toHaveCount(0);
  await expect(page.locator('#resume-card')).toBeVisible();
  expect(await page.evaluate(() => !!window.__game.stats)).toBe(false);

  await page.click('#pick-office-drone');
  await expect(page.locator('#creation-badge')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#creation-badge')).toHaveCount(0);
  await expect(page.locator('#resume-card')).toBeVisible();
  expect(await page.evaluate(() => !!window.__game.stats)).toBe(false);
});

test('#class= still hires with defaults, byte for byte', async ({ page }) => {
  // The express lane the whole suite boots through. It skips the desk AND the
  // card, and must produce exactly what createSheet always produced - which is
  // the invariant the ordering rule in createCharacter exists to protect.
  await page.goto('/#class=office-drone');
  await page.waitForFunction(() => window.__game && window.__game.stats);
  await expect(page.locator('#creation-badge')).toHaveCount(0);
  const who = await page.evaluate(() => ({
    name: window.__game.stats.name,
    maxHp: window.__game.stats.maxHp,
    classHp: window.__game.classes['office-drone'].maxHp,
    attrPoints: window.__game.stats.attrPoints,
    rig: window.__game.stats.rig,
  }));
  expect(who.name).toBe('Office Drone');
  expect(who.maxHp).toBe(who.classHp);
  expect(who.attrPoints).toBe(0);
  expect(who.rig).toBeUndefined();
});
