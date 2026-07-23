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

// Wait until a world point's PROJECTION stops moving, then return its stable
// screen point. The camera eases toward the player for a beat after they stop
// (waitStill sees the player still, but the camera is not), so a projected
// click taken too early lands a tile off and walks. Polling the projection
// itself detects the camera settling directly.
export async function stableProject(page, x, z, timeout = 20_000) {
  let last = null;
  let stable = null;
  await expect.poll(async () => {
    const p = await page.evaluate(([wx, wz]) => window.__game.project(wx, wz), [x, z]);
    const ok = last && Math.abs(p.x - last.x) < 1.5 && Math.abs(p.y - last.y) < 1.5;
    last = p;
    if (ok) stable = p;
    return ok;
  }, { timeout, intervals: [150] }).toBe(true);
  return stable;
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

// Click live enemies until a fight starts. Two things make a naive round-robin
// flaky: some coworkers spawn SEALED behind walls + a closed door (no walk-up
// route ever exists - clicking them silently does nothing and wastes the
// attempt), and wanderers can drift a tile out of reach between attempts. So
// we target only enemies the game reports as `reachable` right now, nearest
// first, and re-query every attempt so a coworker who just wandered into reach
// becomes eligible. Each click's walk plays out fully before the next attempt.
export async function enterCombat(page) {
  let inCombat = false;
  for (let i = 0; i < 10 && !inCombat; i++) {
    const pt = await page.evaluate(() => window.__game.playerTile);
    const ens = await page.evaluate(() => window.__game.enemies.filter((e) => e.alive && e.reachable));
    if (!ens.length) { await page.waitForTimeout(700); continue; } // all sealed/far - let them wander
    ens.sort((a, b) => // nearest first: shortest walk-up, most likely on-screen
      Math.max(Math.abs(a.x - pt.x), Math.abs(a.z - pt.z))
      - Math.max(Math.abs(b.x - pt.x), Math.abs(b.z - pt.z)));
    const en = ens[i % ens.length];
    // Aim at the BODY, not the floor under it: the pick ray lands on the
    // enemy mesh (more accurate), and a chest-height point clears the fixed
    // bottom UI band far more often. Use the CONTINUOUS body position (px/pz)
    // - wanderers stand at loose points, and a chest-height ray at the tile
    // centre can miss the narrow mesh and fall to the floor behind them.
    // Fall back to the ground-tile point (resolved by tile, so it can't
    // miss), and only skip when both are covered or off-screen.
    let p = await page.evaluate(
      ([x, z]) => window.__game.project3(x, 0.9, z), [en.px ?? en.x, en.pz ?? en.z]);
    if (!onScreen(p) || !(await onCanvas(page, p))) {
      p = await page.evaluate(([x, z]) => window.__game.project(x, z), [en.x, en.z]);
    }
    if (!onScreen(p) || !(await onCanvas(page, p))) continue; // covered by UI - next
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
