// Object picking, hover feedback, the persistent attack hotbar, and the
// minimal dialogue layer. These all ride on the picking layer (src/picking.js)
// that resolves a cursor to the interactable ENTITY under it, not the floor
// tile behind a tall mesh - the same fix that makes a click on the raised door
// panel actually open the door.
import { test, expect } from '@playwright/test';
import { bootAndPick, bootStash, onScreen, waitStill, combatOrWalkDone, stableProject, enterCombat } from './helpers.js';

// Hover the on-screen position of a world point (a tall mesh, y > 0). Returns
// false if it projects off-screen so the caller can bail.
async function hover3(page, x, y, z) {
  const p = await page.evaluate(([wx, wy, wz]) => window.__game.project3(wx, wy, wz), [x, y, z]);
  if (!onScreen(p)) return false;
  await page.mouse.move(p.x, p.y);
  return true;
}

test('hovering the door mesh highlights it and shows the interact cursor', async ({ page }) => {
  await bootAndPick(page);
  // Aim at the door PANEL (mid-height on the h:8,5 edge), not the floor.
  expect(await hover3(page, 8, 0.4, 4.5)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.hoverKind), { timeout: 15_000 }).toBe('door');
  expect(await page.evaluate(() => window.__game.cursor)).toBe('pointer');
});

test('clicking the raised door mesh opens it (parallax fix)', async ({ page }) => {
  await bootAndPick(page);
  // Click the door's BODY, well above the floor - the ground point under this
  // pixel lands past the door, so only entity picking resolves it.
  const p = await page.evaluate(() => window.__game.project3(8, 0.55, 4.5));
  expect(onScreen(p)).toBe(true);
  await page.mouse.click(p.x, p.y);
  await expect.poll(
    () => page.evaluate(() => window.__game.doors.find((d) => d.key === 'h:8,5')?.open),
    { timeout: 60_000 },
  ).toBe(true);
});

test('hovering a coworker shows the attack cursor and enemy highlight', async ({ page }) => {
  await bootAndPick(page);
  // Hover the body (~0.8 up). Enemies WANDER, so re-read the live position on
  // every attempt rather than aiming at where one stood when the test started -
  // and read it off the entity, so a coworker caught mid-step between tiles is
  // still under the cursor.
  await expect.poll(async () => {
    const p = await page.evaluate(() => {
      const en = window.__game.enemies.find((e) => e.alive && e.entity);
      if (!en) return null;
      const w = en.entity.getPosition();
      return window.__game.project3(w.x, 0.8, w.z);
    });
    if (!onScreen(p)) return null;
    await page.mouse.move(p.x, p.y);
    return page.evaluate(() => window.__game.hoverKind);
  }, { timeout: 20_000 }).toBe('enemy');
  expect(await page.evaluate(() => window.__game.cursor)).toBe('crosshair');
});

test('the persistent hotbar shows attacks and arming targets a coworker', async ({ page }) => {
  await bootAndPick(page);
  await expect(page.locator('#hotbar')).toBeVisible();
  // Office Drone: attack + shove + two thrown weapons are offensive.
  await expect(page.locator('#hotbar-act-attack')).toBeVisible();
  await expect(page.locator('#hotbar-act-defend')).toHaveCount(0); // defensive stays combat-only

  await page.click('#hotbar-act-attack');
  expect(await page.evaluate(() => window.__game.armed)).toBe('attack');

  // Arming, then clicking a coworker, opens combat with that attack as the
  // opener (melee walks up first). Mirror the hardened enterCombat: target
  // only REACHABLE coworkers (some spawn sealed behind doors), nearest first,
  // aim at the settled body, and re-arm if a stray click lowered the attack.
  let inCombat = false;
  for (let i = 0; i < 14 && !inCombat; i++) {
    const pt = await page.evaluate(() => window.__game.playerTile);
    const ens = await page.evaluate(() => window.__game.enemies.filter((e) => e.alive && e.reachable));
    if (!ens.length) { await page.waitForTimeout(700); continue; }
    ens.sort((a, b) => Math.max(Math.abs(a.x - pt.x), Math.abs(a.z - pt.z))
      - Math.max(Math.abs(b.x - pt.x), Math.abs(b.z - pt.z)));
    const en = ens[0];
    const pp = await page.evaluate(() => window.__game.playerPos);
    await stableProject(page, pp.x, pp.z).catch(() => {}); // settle the camera
    let p = await page.evaluate(([x, z]) => window.__game.project3(x, 0.9, z), [en.px ?? en.x, en.pz ?? en.z]);
    if (!onScreen(p)) p = await page.evaluate(([x, z]) => window.__game.project(x, z), [en.x, en.z]);
    if (!onScreen(p)) continue;
    // combatOrWalkDone can report "walk finished" on the same poll that combat
    // is starting, so re-check before doing anything else - and never click the
    // hotbar once a fight owns the screen. Combat hides the out-of-combat
    // hotbar, and Playwright waits on a hidden button until the test times out.
    if (await page.evaluate(() => window.__game.inCombat)) { inCombat = true; break; }
    if (await page.evaluate(() => window.__game.armed) !== 'attack') {
      if (!(await page.locator('#hotbar-act-attack').isVisible())) break;
      await page.click('#hotbar-act-attack');
    }
    await page.mouse.click(p.x, p.y);
    inCombat = await combatOrWalkDone(page, 25_000);
  }
  expect(inCombat).toBe(true);
});

// A tiny arena with a talkable NPC right next to the spawn, so the walk-up is
// short and deterministic.
const TALK_LEVEL = {
  name: 'talk-test',
  tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
  actors: { '@': 'player', 'N': 'it-intern' },
  map: [
    '########',
    '#@.N..>#',
    '########',
  ],
};

test('clicking an NPC walks up and opens a dialogue you can advance and close', async ({ page }) => {
  await bootStash(page, TALK_LEVEL);
  const npc = await page.evaluate(() => window.__game.npcs[0]);
  expect(npc.name).toContain('Intern');

  // Talk cursor on hover.
  await hover3(page, npc.x, 0.8, npc.z);
  await expect.poll(() => page.evaluate(() => window.__game.hoverKind), { timeout: 15_000 }).toBe('npc');
  expect(await page.evaluate(() => window.__game.cursor)).toBe('help');

  // Click walks up and opens the conversation.
  const p = await page.evaluate(() => window.__game.project3(window.__game.npcs[0].x, 0.4, window.__game.npcs[0].z));
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#dialogue-panel')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__game.dialogueOpen), { timeout: 30_000 }).toBe(true);

  // Advancing a branch keeps the panel up; the last option closes it.
  await expect(page.locator('#dialogue-option-0')).toBeVisible();
  await page.click('#dialogue-option-0');
  await expect(page.locator('#dialogue-panel')).toBeVisible();
  // Walk the tree to an end - click the last option until the panel closes.
  for (let i = 0; i < 6; i++) {
    if (!(await page.evaluate(() => window.__game.dialogueOpen))) break;
    const count = await page.locator('.dialogue-option').count();
    await page.click(`#dialogue-option-${count - 1}`);
    await page.waitForTimeout(150);
  }
  expect(await page.evaluate(() => window.__game.dialogueOpen)).toBe(false);
});

// A single coworker two tiles off, in an open room - close enough that the
// walk-up is one step, so a click resolves inside a turn.
const DUEL_ARENA = {
  name: 'Duel',
  tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
  actors: { '@': 'player', 'M': 'manager' },
  map: [
    '#########',
    '#.......#',
    '#.@.M..>#',
    '#.......#',
    '#########',
  ],
};

test('clicking a coworker in combat attacks with the basic swing - no action armed first', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DUEL_ARENA, 'office-drone');
  await enterCombat(page);

  // Nothing is armed: this is the whole point of the test. The click below is
  // the only input, and it has to mean "hit them".
  expect(await page.evaluate(() => window.__combat.armed)).toBe(null);
  await page.evaluate(() => { window.__combat.forceHit = true; });

  const foe = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  expect(foe).toBeTruthy();
  const foeHp = () => page.evaluate(() => window.__combat.enemies.find((e) => e.alive)?.hp);

  // Click the body. The camera keeps easing after the walk-up, so settle and
  // retry a couple of times rather than trusting one projection.
  for (let i = 0; i < 4 && (await foeHp()) >= foe.hp; i++) {
    await page.waitForTimeout(1000);
    const p = await page.evaluate(([x, z]) => window.__game.project3(x, 0.9, z), [foe.x, foe.z]);
    if (!onScreen(p)) continue;
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(600);
  }
  expect(await foeHp()).toBeLessThan(foe.hp);
  // It swung the equipped weapon's action (bare-handed here), not a class power.
  expect(await page.evaluate(() => window.__combat.lastRoll)).not.toBe(null);
});
