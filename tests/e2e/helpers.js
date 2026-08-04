// Shared plumbing for the e2e suite: boot/warmup, carousel class picking,
// projected clicks, walk settling, and combat entry. Everything here assumes
// the CI reality of software GL - generous waits, and no projection trusted
// before frames tick smoothly (see game.spec.js header).
import { expect, test } from '@playwright/test';

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
  // The desk hands off to the short form beside the body. This helper's subject
  // is the DESK, so it commits one of the six as written and moves on - the
  // creation spec is where the form itself is exercised.
  await page.click('#creation-commit');
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
// Hold the world still for the duration of `steps`.
//
// `__god.timeScale = 0` stops dt, so nobody wanders, nobody charges, and no
// fight can start - while DOM events and the state they mutate still work
// (PlayCanvas keeps calling update, with dt 0). That is exactly what a test's
// out-of-combat STAGING needs: equipping from the pockets, arranging the bag,
// setting up geometry.
//
// Without it, staging races the floor. A red-aggression coworker two tiles away
// is walking at you the whole time a test is waiting for a panel to appear, and
// on a slow runner it arrives first - at which point a gear swap is correctly
// refused (mid-fight swaps are out, EQUIPMENT decision #6) and the failure
// surfaces as "the equip silently did nothing", twenty seconds and one poll
// away from its actual cause. It cost a red CI run on main to find that, so the
// idiom is here rather than copied into each spec that needs it.
export async function withWorldStill(page, steps) {
  await page.evaluate(() => { window.__god.timeScale = 0; });
  try {
    await steps();
  } finally {
    await page.evaluate(() => { window.__god.timeScale = 1; });
  }
}

// `seed` makes every fight in the run reproducible: it feeds startCombat's
// injected rng, which reaches EVERY in-fight roll - hits, damage, the AI's
// line picks, slips, and initiative, so turn ORDER is pinned too. That last
// one is what a positional AI test needs: whether the coworker or the party
// acts first decides whether a staged barrier is still standing by the time
// the beat under test is reached.
export async function bootStash(page, level, classId = 'office-drone', { seed = null } = {}) {
  await page.addInitScript((lvl) => {
    localStorage.clear(); // no campaign progress bleeding into a bespoke arena
    localStorage.setItem('escape-work.playtest', JSON.stringify(lvl));
  }, level);
  await page.goto(`/${seed == null ? '' : `?seed=${seed}`}#class=${classId}`);
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
export const onCanvas = (page, p) => page.evaluate(
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
// The budget is a FRACTION OF THE CALLER'S OWN TIMEOUT, not a constant. A flat
// 200s was the first attempt at this and it was wrong in a way worth recording:
// most specs call test.setTimeout(300_000), but smoke.spec takes the config
// default of 120s - so for that one caller the "budget" was larger than the
// whole test, and the helper reproduced the exact bug it was written to remove
// (an unattributable "Test timeout of 120000ms exceeded" instead of a
// diagnosis). Deriving it from test.info().timeout makes the guarantee hold for
// every caller, including any added later with a budget nobody thought about.
const ENGAGE_BUDGET_FRACTION = 0.6; // leave the caller ~40% to report and finish
const SETTLE_MS = 8_000; // per-attempt camera settle; it is a nicety, not the test

function engageBudgetMs() {
  let timeout = 300_000;
  try { timeout = test.info().timeout || timeout; } catch { /* called outside a test */ }
  return Math.max(30_000, Math.floor(timeout * ENGAGE_BUDGET_FRACTION));
}

export async function enterCombat(page) {
  // NB: an `startFightNow` fast path was tried here and REVERTED. Opening the
  // fight from where the player stands, rather than walking them to a coworker,
  // changes the geometry specs are written against: a touch-range verb like
  // Detain arrives out of reach, and classes.spec's Detain test failed
  // consistently because of it. It also never delivered - the HR/IT timeouts it
  // was meant to fix were unchanged, because it only helps when somebody is
  // already in range at boot. Walking is slow, but it is what the specs mean.
  const started = Date.now();
  const deadline = started + engageBudgetMs();
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
  // turn so callers can act.
  //
  // This used to swallow the timeout entirely, on a budget that could collapse
  // to 5s once the engage loop had eaten the rest. On a slow runner it returned
  // MID-AI-TURN, and the caller's next click then waited out its whole timeout
  // against a legitimately disabled button - a 300s hang reported as "element
  // is not enabled", with nothing about the fight that caused it. The floor is
  // 20s now, and the only tolerated failure is the documented one: a fight that
  // ENDED while we waited is not a hang.
  await settleOnPlayerTurn(page, Math.max(20_000, left()));
}

// Wait out any AI turns initiative handed out first. The only tolerated failure
// is the documented one: a fight that ENDED while we waited is not a hang.
async function settleOnPlayerTurn(page, timeout) {
  if (!(await page.evaluate(() => window.__game.inCombat))) return;
  try {
    await waitForPlayerTurn(page, timeout);
  } catch (err) {
    if (await page.evaluate(() => window.__game.inCombat)) throw err;
  }
}

// Everything worth knowing when a fight misbehaves, in one snapshot. Cheap, and
// it is the whole difference between "the button was disabled" and "the button
// was disabled because the Manager never finished its walk".
//
// A hung e2e run cannot be re-observed after the fact - the trace is an
// artifact somebody has to download - so the failure message has to carry the
// diagnosis with it.
export async function combatState(page) {
  return page.evaluate(() => {
    const g = window.__game;
    if (!g) return { note: 'no __game - the page never booted' };
    const base = { inCombat: g.inCombat, gameOver: g.gameOver };
    const c = window.__combat;
    if (!c) return { ...base, note: 'no __combat - no fight in progress' };
    return {
      ...base,
      phase: c.phase,
      turn: c.turn,
      ap: c.ap,
      armed: c.armed,
      acting: c.acting, // null on a player turn; { wait, moving, ... } on an AI one
      order: c.order.map((s) => `${s.name}${s.current ? '<' : ''}${s.alive ? '' : '(down)'}`),
      party: c.party.map((m) => `${m.name} hp${m.hp} ap${m.ap}${m.active ? '<' : ''}`),
      enemies: g.enemies.filter((e) => e.alive)
        .map((e) => `${e.name} hp${e.hp} @${e.x},${e.z}${e.moving ? ' MOVING' : ''}`),
    };
  });
}

// Wait until it's a party member's turn (phase 'player'). Under initiative an
// enemy can win the roll and act first, so a fresh fight may open on an AI
// turn - a test that wants to act must wait for control to come around.
//
// On timeout it reports WHY control never came, rather than the bare poll
// failure: `acting.moving` true means the AI is stuck part-way through a walk,
// `acting.wait` counting means it is merely slow, and no `acting` at all on a
// non-player phase means the turn engine handed the floor to nobody.
export async function waitForPlayerTurn(page, timeout = 90_000) {
  try {
    await expect.poll(
      () => page.evaluate(() => window.__combat?.phase),
      { timeout },
    ).toBe('player');
  } catch {
    const state = await combatState(page);
    throw new Error(
      `control never came back to the player within ${timeout}ms.\n`
      + `combat state: ${JSON.stringify(state, null, 2)}`,
    );
  }
}

// Give the acting member a full AP budget for this turn.
//
// `enterCombat` walks you into the fight, and combat triggers on ADJACENCY -
// which can happen PART-WAY along that walk, so the steps still queued are then
// priced as in-combat movement. A test that opens a fight and immediately
// spends AP therefore starts with an unpredictable budget: full on a fast
// machine, 3.7 of 6 on a slow one - and a 4 AP action simply greys out, which
// looks from the outside exactly like a hung fight.
//
// `__combat.ap` is a documented live setter (ARCHITECTURE.md's debug surface)
// meant for this. A test whose SUBJECT is the AP economy must not use it - it
// wants the real number - but a test about targeting rules should not be at the
// mercy of how far the walk-up got before the trigger fired.
export async function refillAp(page) {
  await page.evaluate(() => {
    window.__combat.ap = window.__game?.stats?.maxAp ?? window.__combat.ap;
  });
}

// Arm a combat action by clicking its bar button - but assert the preconditions
// instead of clicking blind. A bare page.click on a disabled button waits out
// the WHOLE test timeout and then reports only "element is not enabled", which
// is how a five-minute mystery gets logged instead of a diagnosis.
export async function clickAction(page, id, timeout = 30_000) {
  await waitForPlayerTurn(page);
  const btn = page.locator(`#hotbar-act-${id}`);
  try {
    // The shared bar never sets `disabled`: a disabled button dispatches no
    // mouse events at all, contextmenu included, which would make the slot you
    // most want to reassign the one slot you cannot (createHotbar's setInert).
    // An unusable slot stays pressable ON PURPOSE, so it can say why.
    //
    // That leaves nothing for `toBeEnabled()` to see - it passes instantly
    // here and would click straight through an action the member cannot
    // afford. `data-affordable` is the bar's own answer to "can this be
    // pressed right now", so that is what a test waits on.
    await expect(btn).toHaveAttribute('data-affordable', 'true', { timeout });
  } catch {
    const [state, title] = await Promise.all([
      combatState(page),
      btn.getAttribute('title').catch(() => null),
    ]);
    throw new Error(
      `#hotbar-act-${id} never became clickable within ${timeout}ms.\n`
      + `button title: ${title}\n`
      + `combat state: ${JSON.stringify(state, null, 2)}`,
    );
  }
  await btn.click();
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

// Click a living coworker's BODY, with the pick pinned.
//
// The naive version of this - project the body, click the pixel - was copied
// into four specs and flaked in three of them (Q905). It has two silent failure
// modes and no guard against either: the camera may still be easing, so the
// projection is of where the body WAS; and the point may land off-canvas or on
// a HUD panel, where the click is swallowed and the test waits out its timeout
// on an action that never happened.
//
// So this proves the pick landed before it commits: it settles the camera,
// re-projects the LIVE position each attempt (a coworker takes turns and moves),
// and polls `hoverKind` - which is the game's own pick, not a guess about it -
// until it says `enemy`. Only then does it click.
//
// `y` is how far up the body to aim. 0.9 is chest height for a standing body;
// a crouched one is a squashed pose and wants something nearer the floor.
export async function clickEnemyBody(page, y = 0.9) {
  const pp = await page.evaluate(() => window.__game.playerPos);
  await stableProject(page, pp.x, pp.z).catch(() => {});
  let p = null;
  await expect.poll(async () => {
    p = await page.evaluate((yy) => {
      const en = window.__game.enemies.find((e) => e.alive);
      return en ? window.__game.project3(en.px ?? en.x, yy, en.pz ?? en.z) : null;
    }, y);
    if (!onScreen(p) || !(await onCanvas(page, p))) return 'off-canvas';
    // The move is what makes the game run its pick; hoverKind is that pick.
    await page.mouse.move(p.x, p.y);
    return page.evaluate(() => window.__game.hoverKind);
  }, { timeout: 20_000, intervals: [200] }).toBe('enemy');
  await page.mouse.click(p.x, p.y);
  return p;
}
