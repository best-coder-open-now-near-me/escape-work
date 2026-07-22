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

// Wait until two consecutive animation frames arrive close together - i.e.
// shader warmup is over and wall-clock waits mean what they say.
async function waitForSmoothFrames(page) {
  await page.waitForFunction(() => new Promise((resolve) => {
    requestAnimationFrame((a) => requestAnimationFrame((b) => resolve(b - a < 100)));
  }), null, { timeout: 90_000 });
}

// A mouse click at coordinates outside the viewport silently does nothing -
// guard every projected click with this.
const onScreen = (p) => p && p.x > 10 && p.x < 1270 && p.y > 10 && p.y < 790;

// Boot the game into a playable state: class picked, model spawned, renderer
// warmed up, camera settled - then zoom all the way out so the whole floor
// projects inside the viewport (far enemies would otherwise fall off-screen
// and clicks aimed at them would be silent no-ops).
async function bootAndPick(page) {
  await page.goto('/');
  await page.click('#pick-office-drone');
  await page.waitForFunction(() => window.__game && window.__game.stats);
  await waitForSmoothFrames(page);
  await page.mouse.move(640, 400); // wheel events need the pointer on canvas
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 120);
  await page.waitForTimeout(600); // camera ease-in
}

test('boots to the class picker and picking a class starts the game', async ({ page }) => {
  await page.goto('/');
  // Three resumes on the desk, straight from the class registry.
  await expect(page.locator('#pick-office-drone')).toBeVisible();
  await expect(page.locator('#pick-middle-manager')).toBeVisible();
  await expect(page.locator('#pick-it-support')).toBeVisible();
  await page.click('#pick-office-drone');
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
  await expect(page.locator('#inventory-panel')).toContainText('0/10');
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

// Wait for combat to start, or for the player's current walk to finish -
// whichever comes first. Returns the latest inCombat state.
async function combatOrWalkDone(page, capMs) {
  const deadline = Date.now() + capMs;
  let lastPos = null;
  while (Date.now() < deadline) {
    await page.waitForTimeout(700);
    if (await page.evaluate(() => window.__game.inCombat)) return true;
    const pos = await page.evaluate(() => window.__game.playerPos);
    if (lastPos && Math.hypot(pos.x - lastPos.x, pos.z - lastPos.z) < 0.05) return false;
    lastPos = pos;
  }
  return page.evaluate(() => window.__game.inCombat);
}

test('confronting a coworker starts combat and an attack lands', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page);
  // Click live enemies round-robin until a fight starts - they wander inside
  // a small leash (so a single long walk-up can arrive a tile short), and
  // some start behind closed doors where no walk-up route exists at all.
  // Each click's walk plays out fully before the next attempt.
  let inCombat = false;
  for (let i = 0; i < 8 && !inCombat; i++) {
    const ens = await page.evaluate(() => window.__game.enemies.filter((e) => e.alive));
    const en = ens[i % ens.length];
    const p = await page.evaluate(([x, z]) => window.__game.project(x, z), [en.x, en.z]);
    if (!onScreen(p)) continue; // out of view even zoomed out - try the next
    await page.mouse.click(p.x, p.y);
    inCombat = await combatOrWalkDone(page, 25_000);
  }
  expect(inCombat).toBe(true);
  await expect(page.locator('#combat-panel')).toBeVisible();
  // A click can race the combat trigger and get spent as an in-combat walk;
  // if this turn's AP is too low to attack, cycle a turn for a fresh budget.
  if (await page.evaluate(() => window.__combat.ap) < 3) {
    await page.click('#combat-end-turn');
    await expect.poll(
      () => page.evaluate(() => window.__combat?.phase),
      { timeout: 60_000 },
    ).toBe('player');
  }
  await expect(page.locator('#combat-turn')).toHaveText('YOUR TURN');
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
    await page.click('#combat-end-turn');
    await expect.poll(
      () => page.evaluate(() => window.__combat?.phase),
      { timeout: 60_000 },
    ).toBe('player');
    foe = await findFoe();
  }
  expect(foe).toBeTruthy();
  // Arm the basic attack and click the target. The camera keeps easing after
  // combat walks, so a projection taken mid-ease can round to the wrong tile
  // (which lowers the attack instead) - settle, then retry a couple times.
  const foeHp = ([x, z]) => page.evaluate(
    ([fx, fz]) => window.__combat.enemies.find((e) => e.x === fx && e.z === fz)?.hp,
    [x, z],
  );
  for (let i = 0; i < 4 && (await foeHp([foe.x, foe.z])) >= foe.hp; i++) {
    await page.waitForTimeout(1000); // camera settle
    if (await page.evaluate(() => window.__combat.armed) !== 'attack') {
      await page.click('#act-attack');
      expect(await page.evaluate(() => window.__combat.armed)).toBe('attack');
    }
    const fp = await page.evaluate(([x, z]) => window.__game.project(x, z), [foe.x, foe.z]);
    await page.mouse.click(fp.x, fp.y);
    await page.waitForTimeout(300);
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
