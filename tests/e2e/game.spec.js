// Headless smoke tests driving the real game with real mouse input, asserting
// against the window.__game / window.__editor read-only handles. These guard
// the wiring the unit tests can't reach: engine boot, click -> pathfinding ->
// movement, the DOM UI, and the editor.
//
// CI runners render through software GL (SwiftShader): the first seconds
// after boot go to shader compilation at seconds-per-frame, and everything
// stays slower than local. Every wait here is therefore generous, and boot
// helpers gate on frames actually ticking before any projection is trusted.
import { test, expect } from '@playwright/test';
import { waitForSmoothFrames, onScreen, bootAndPick, combatOrWalkDone, enterCombat, endTurnUntilPlayer, waitForPlayerTurn, clickAction, stableProject } from './helpers.js';

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

test('clicking open floor walks the player there', async ({ page }) => {
  await bootAndPick(page);
  const target = { x: 4, z: 4 };
  const p = await page.evaluate(([x, z]) => window.__game.project(x, z), [target.x, target.z]);
  await page.mouse.click(p.x, p.y);
  await expect.poll(
    () => page.evaluate(() => window.__game.playerTile),
    { timeout: 30_000 },
  ).toEqual(target);
});

test('the pockets toggle with I and start empty', async ({ page }) => {
  await bootAndPick(page);
  await page.keyboard.press('i');
  await expect(page.locator('#inventory-panel')).toBeVisible();
  // Pockets are unlimited now, so the header is a bare count, not "0/10".
  await expect(page.locator('#inventory-panel')).toContainText('POCKETS');
  await expect(page.locator('#inventory-panel')).toContainText('Empty');
  await page.keyboard.press('i');
  await expect(page.locator('#inventory-panel')).toBeHidden();
});

test('clicking a closed door walks up and swings it open', async ({ page }) => {
  await bootAndPick(page);
  const doors = await page.evaluate(() => window.__game.doors);
  expect(doors.length).toBeGreaterThan(0);
  expect(doors.every((d) => !d.open)).toBe(true); // all start closed
  // Click just shy of the cubicle-row door on the north edge of (8, 5) -
  // the walk-up crosses open corridor from the spawn.
  const p = await page.evaluate(() => window.__game.project(8, 4.58));
  await page.mouse.click(p.x, p.y);
  await expect.poll(
    () => page.evaluate(() => window.__game.doors.find((d) => d.key === 'h:8,5')?.open),
    { timeout: 60_000 },
  ).toBe(true);
});

test('confronting a coworker starts combat and an attack lands', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page);
  await enterCombat(page);
  await expect(page.locator('#combat-panel')).toBeVisible();
  // Under initiative the coworker can win the roll and act first - wait for
  // control to come around before doing anything.
  await waitForPlayerTurn(page);
  // A click can race the combat trigger and get spent as an in-combat walk;
  // if this turn's AP is too low to attack, cycle a turn for a fresh budget.
  if (await page.evaluate(() => window.__combat.ap) < 3) {
    await endTurnUntilPlayer(page);
  }
  // "YOUR TURN" used to be spelled out here, on top of a log line that said
  // the same thing again, next to a button that was already lit or was not -
  // three ways to say one fact. The turn line is blank for a solo party now;
  // the phase itself is the assertion worth making.
  expect(await page.evaluate(() => window.__combat.phase)).toBe('player');
  // Find an adjacent target; if nobody is beside us yet (the trigger can
  // fire off an enemy's own step, then they shuffle), cycle turns until the
  // AI closes in.
  const findFoe = () => page.evaluate(() => {
    const pt = window.__game.playerTile;
    return window.__combat.enemies.find((e) =>
      e.alive && Math.max(Math.abs(e.x - pt.x), Math.abs(e.z - pt.z)) <= 1) || null;
  });
  let foe = await findFoe();
  for (let i = 0; i < 3 && !foe; i++) {
    await endTurnUntilPlayer(page);
    foe = await findFoe();
  }
  expect(foe).toBeTruthy();
  // Attacks can miss now (HIT_PLAN) - pin the roll so this damage assertion
  // isn't a coin flip.
  await page.evaluate(() => { window.__combat.forceHit = true; });
  // Arm the basic attack and click the target. The camera keeps easing after
  // combat walks, so a projection taken mid-ease can round to the wrong tile
  // (which lowers the attack instead) - settle, then retry a couple times.
  const foeHp = ([x, z]) => page.evaluate(
    ([fx, fz]) => window.__combat.enemies.find((e) => e.x === fx && e.z === fz)?.hp,
    [x, z],
  );
  // Tile adjacency no longer means in reach: reach is a DISTANCE now
  // (TACTICS_PLAN revision), and `findFoe` above still scans by tile, so the
  // foe it picks can be up to 2.8 units away. A click then walks up and strikes
  // on arrival rather than swinging instantly - so wait for the damage instead
  // of assuming one click resolves inside 300ms.
  for (let i = 0; i < 6 && (await foeHp([foe.x, foe.z])) >= foe.hp; i++) {
    if (await page.evaluate(() => window.__combat.armed) !== 'attack') {
      await clickAction(page, 'attack');
      expect(await page.evaluate(() => window.__combat.armed)).toBe('attack');
    }
    // Settle and project in one step - the fixed sleep this replaces was
    // guessing at exactly what stableProject polls for.
    const fp = await stableProject(page, foe.x, foe.z);
    await page.mouse.click(fp.x, fp.y);
    await page.waitForTimeout(1400); // a walk-up plus the strike on arrival
  }
  expect(await foeHp([foe.x, foe.z])).toBeLessThan(foe.hp);
});

test('the editor loads level1 and paints with the wall brush', async ({ page }) => {
  await page.goto('/#editor');
  await page.waitForFunction(() => window.__editor, null, { timeout: 90_000 });
  await waitForSmoothFrames(page);
  expect(await page.evaluate(() => window.__editor.size)).toEqual({ width: 24, height: 18 });
  await page.click('#brush-wall');
  expect(await page.evaluate(() => window.__editor.brush)).toBe('wall');
  await page.waitForTimeout(400); // camera settle
  // Paint the map-centre tile - guaranteed on-screen at the default zoom.
  const p = await page.evaluate(() => window.__editor.project(11, 8));
  await page.mouse.click(p.x, p.y);
  await expect.poll(
    () => page.evaluate(() => window.__editor.charAt(11, 8)),
    { timeout: 30_000 },
  ).toBe('#');
});
