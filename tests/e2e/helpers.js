// Shared plumbing for the e2e suite: boot/warmup, carousel class picking,
// projected clicks, walk settling, and combat entry. Everything here assumes
// the CI reality of software GL - generous waits, and no projection trusted
// before frames tick smoothly (see game.spec.js header).
import { expect } from '@playwright/test';

// Wait until two consecutive animation frames arrive close together - i.e.
// shader warmup is over and wall-clock waits mean what they say.
export async function waitForSmoothFrames(page) {
  await page.waitForFunction(() => new Promise((resolve) => {
    requestAnimationFrame((a) => requestAnimationFrame((b) => resolve(b - a < 100)));
  }), null, { timeout: 90_000 });
}

// A mouse click at coordinates outside the viewport silently does nothing -
// guard every projected click with this.
export const onScreen = (p) => p && p.x > 10 && p.x < 1270 && p.y > 10 && p.y < 790;

// The class picker is a carousel: only the active slide's hire button exists
// (#pick-<classId>). Step through slides until the wanted one is up.
export async function pickClass(page, classId) {
  await expect(page.locator('#resume-card')).toBeVisible();
  for (let i = 0; i < 8; i++) {
    if (await page.locator(`#pick-${classId}`).count()) break;
    await page.click('#carousel-next');
  }
  await page.click(`#pick-${classId}`);
}

// Boot the game into a playable state: class picked, model spawned, renderer
// warmed up, camera settled - then zoom all the way out so the whole floor
// projects inside the viewport (far enemies would otherwise fall off-screen
// and clicks aimed at them would be silent no-ops).
export async function bootAndPick(page, classId = 'office-drone') {
  await page.goto('/');
  await pickClass(page, classId);
  await page.waitForFunction(() => window.__game && window.__game.stats);
  await waitForSmoothFrames(page);
  await page.mouse.move(640, 400); // wheel events need the pointer on canvas
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 120);
  await page.waitForTimeout(600); // camera ease-in
}

// Boot into a stashed playtest level (the editor's localStorage hand-off) -
// small bespoke arenas keep surface tests fast and deterministic.
export async function bootStash(page, level, classId = 'office-drone') {
  await page.goto('/');
  await page.evaluate((lvl) => {
    localStorage.clear();
    localStorage.setItem('escape-work.playtest', JSON.stringify(lvl));
  }, level);
  await page.reload();
  await pickClass(page, classId);
  await page.waitForFunction(() => window.__game && window.__game.stats);
  await waitForSmoothFrames(page);
  await page.mouse.move(640, 400);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 120);
  await page.waitForTimeout(600);
}

// Click the ground at world (x, z). Returns false when the point projects
// off-screen (the caller decides whether that's a failure).
export async function clickWorld(page, x, z) {
  const p = await page.evaluate(([wx, wz]) => window.__game.project(wx, wz), [x, z]);
  if (!onScreen(p)) return false;
  await page.mouse.click(p.x, p.y);
  return true;
}

// Wait until the player's continuous position stops changing.
export async function waitStill(page, timeout = 60_000) {
  let last = null;
  await expect.poll(async () => {
    const p = await page.evaluate(() => window.__game.playerPos);
    const still = !!last && Math.hypot(p.x - last.x, p.z - last.z) < 0.02;
    last = p;
    return still;
  }, { timeout, intervals: [700] }).toBe(true);
}

// Wait for combat to start, or for the player's current walk to finish -
// whichever comes first. Returns the latest inCombat state.
export async function combatOrWalkDone(page, capMs) {
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

// Does a CSS-pixel point actually land on the game canvas? Fixed UI overlays
// (the hotbar and combat panel sit bottom-center) swallow clicks aimed at the
// world behind them - a stray hit can even ARM an attack, and an armed click
// on the next enemy means an unintended fight.
const onCanvas = (page, p) => page.evaluate(
  ([x, y]) => document.elementFromPoint(x, y)?.id === 'app', [p.x, p.y]);

// Click live enemies round-robin until a fight starts - they wander inside a
// small leash (so a single long walk-up can arrive a tile short), and some
// start behind closed doors where no walk-up route exists at all. Each
// click's walk plays out fully before the next attempt.
export async function enterCombat(page) {
  let inCombat = false;
  for (let i = 0; i < 8 && !inCombat; i++) {
    const ens = await page.evaluate(() => window.__game.enemies.filter((e) => e.alive));
    const en = ens[i % ens.length];
    const p = await page.evaluate(([x, z]) => window.__game.project(x, z), [en.x, en.z]);
    if (!onScreen(p)) continue; // out of view even zoomed out - try the next
    if (!(await onCanvas(page, p))) continue; // hidden behind a UI overlay - next
    await page.mouse.click(p.x, p.y);
    inCombat = await combatOrWalkDone(page, 25_000);
  }
  expect(inCombat).toBe(true);
}

// End the enemy phase and wait for the turn to come back around.
export async function endTurnUntilPlayer(page) {
  await page.click('#combat-end-turn');
  await expect.poll(
    () => page.evaluate(() => window.__combat?.phase),
    { timeout: 60_000 },
  ).toBe('player');
}
