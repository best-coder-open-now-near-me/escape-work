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
//
// This is the SLOW path, and the boot helpers below deliberately avoid it:
// every slide renders that candidate's .glb, which under CI's software GL
// costs tens of seconds EACH, so walking to the fifth class burned minutes
// before the test under it had started. Kept for the one spec whose subject
// is the carousel itself.
export async function pickClass(page, classId) {
  await expect(page.locator('#resume-card')).toBeVisible();
  for (let i = 0; i < 8; i++) {
    if (await page.locator(`#pick-${classId}`).count()) break;
    await page.click('#carousel-next');
  }
  await page.click(`#pick-${classId}`);
}

// Zoom out so the whole floor projects inside the viewport - far enemies would
// otherwise fall off-screen and clicks aimed at them are silent no-ops.
//
// This used to drive the rig with 4-8 real mouse-wheel events. Each one forces
// a camera apply and a re-render, which under CI's software GL costs SECONDS -
// measured at ~45s of the ~85s it took a test to reach its first click. The
// __game.zoomOut() hook reaches the identical end state (setView clamps to the
// rig's maxDist) in a single apply.
async function settleCamera(page) {
  await waitForSmoothFrames(page);
  await page.evaluate(() => window.__game.zoomOut());
  await page.mouse.move(640, 400); // park the pointer on the canvas
  await page.waitForTimeout(600); // camera ease-in
}

// Boot the game into a playable state: class hired straight off the URL
// (`#class=<id>`, see main.js preselectedClass), model spawned, renderer warmed
// up, camera settled.
export async function bootAndPick(page, classId = 'office-drone') {
  await page.goto(`/#class=${classId}`);
  await page.waitForFunction(() => window.__game && window.__game.stats);
  await settleCamera(page);
}

// Boot into a stashed playtest level (the editor's localStorage hand-off) -
// small bespoke arenas keep surface tests fast and deterministic. The stash is
// seeded by an init script so it is already in place on the FIRST load: the
// old goto -> write -> reload dance booted the whole engine twice per test.
export async function bootStash(page, level, classId = 'office-drone') {
  await page.addInitScript((lvl) => {
    localStorage.clear(); // no campaign progress bleeding into a bespoke arena
    localStorage.setItem('escape-work.playtest', JSON.stringify(lvl));
  }, level);
  await page.goto(`/#class=${classId}`);
  await page.waitForFunction(() => window.__game && window.__game.stats);
  await settleCamera(page);
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
//
// THE LOOP IS BUDGETED, and that budget is load-bearing. Each attempt can
// spend stableProject (20s) plus combatOrWalkDone (25s), so 18 attempts was a
// ~810s worst case running inside a caller's 300s `test.setTimeout` - nearly
// 3x. A struggling engage could therefore never reach the assertion at the
// bottom of this function: Playwright's own timeout fired first, mid
// `page.waitForTimeout`, and reported a bare "Test timeout of 300000ms
// exceeded" with a stack pointing into this helper and no indication of what
// it had been attempting. That is why these failures read as random.
//
// Now the loop stops while there is still time to REPORT, and the assertion
// says how many coworkers it tried and why it gave up. A healthy run is
// unchanged - it still gets all 18 attempts, because it never approaches the
// deadline.
const ENGAGE_BUDGET_MS = 200_000; // of a caller's 300s, leaving room to fail loudly
const SETTLE_MS = 8_000; // per-attempt camera settle; it is a nicety, not the test

export async function enterCombat(page) {
  const started = Date.now();
  const deadline = started + ENGAGE_BUDGET_MS;
  const left = () => deadline - Date.now();
  let inCombat = false;
  let attempts = 0;
  let why = 'no reachable coworker ever projected onto the canvas';
  for (let i = 0; i < 18 && !inCombat && left() > 3_000; i++) {
    // Let the camera settle before projecting - a walk-up leaves it easing,
    // and a stale projection lands the click a tile off (walks past the
    // target instead of engaging). Settling on the player fixes the whole
    // projection, enemies included.
    const pp = await page.evaluate(() => window.__game.playerPos);
    await stableProject(page, pp.x, pp.z, Math.max(1_000, Math.min(SETTLE_MS, left()))).catch(() => {});
    const pt = await page.evaluate(() => window.__game.playerTile);
    const ens = await page.evaluate(() => window.__game.enemies.filter((e) => e.alive && e.reachable));
    if (!ens.length) { why = 'every coworker was sealed off or out of reach'; await page.waitForTimeout(700); continue; }
    // ALWAYS the nearest reachable coworker: the shortest walk-up gives them
    // the least chance to wander out of reach before we arrive (a long walk
    // across the floor can arrive where the target no longer is - no
    // adjacency, no fight).
    ens.sort((a, b) =>
      Math.max(Math.abs(a.x - pt.x), Math.abs(a.z - pt.z))
      - Math.max(Math.abs(b.x - pt.x), Math.abs(b.z - pt.z)));
    const en = ens[0];
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
    if (!onScreen(p) || !(await onCanvas(page, p))) { why = 'the target was off-screen or under fixed UI'; continue; }
    attempts += 1;
    why = `walked at ${ens.length} reachable coworker(s) without a fight starting`;
    await page.mouse.click(p.x, p.y);
    // Never wait past the budget: an attempt that would overrun it is an
    // attempt whose result we could not report anyway.
    inCombat = await combatOrWalkDone(page, Math.max(2_000, Math.min(25_000, left())));
  }
  expect(inCombat,
    `never entered combat: ${attempts} engage attempt(s) over ${Math.round((Date.now() - started) / 1000)}s - ${why}`,
  ).toBe(true);
  // Initiative may hand the enemy the first turn(s); settle on the player's
  // turn so callers can act. (If the fight somehow ends first, don't hang.)
  if (await page.evaluate(() => window.__game.inCombat)) {
    await waitForPlayerTurn(page, Math.max(5_000, left())).catch(() => {});
  }
}

// Wait until it's a party member's turn (phase 'player'). Under initiative an
// enemy can win the roll and act first, so a fresh fight may open on an AI
// turn - a test that wants to act must wait for control to come around.
export async function waitForPlayerTurn(page, timeout = 90_000) {
  await expect.poll(
    () => page.evaluate(() => window.__combat?.phase),
    { timeout },
  ).toBe('player');
}

// End the current member's turn and wait for control to come back around
// (initiative runs the AI turns in between).
export async function endTurnUntilPlayer(page) {
  await page.click('#combat-end-turn');
  await expect.poll(
    () => page.evaluate(() => window.__combat?.phase),
    { timeout: 60_000 },
  ).toBe('player');
}
