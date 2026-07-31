// The melee walk-up keeps its promises (the stuck-walk-up bug): a click on a
// coworker no swing can reach says so honestly instead of blaming AP, and a
// coworker whose only clean swing is a walk AROUND a partition gets walked
// around and hit. Both arenas start the player orthogonally adjacent to the
// Manager across a chest-high partition - the exact geometry that used to
// wedge the fight into "Not enough AP to reach them" at nearly full AP.
import { test, expect } from '@playwright/test';
import { bootStash, clickWorld, waitForPlayerTurn, enterCombat, refillAp } from './helpers.js';

// The Manager boxed in by partitions on all four edges: no stand point offers
// a legal swing, so the click must refuse with the truth (not an AP excuse).
const SEALED = {
  name: 'Sealed Swing Floor',
  tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
  actors: { '@': 'player', M: 'manager' },
  walls: ['V 3 2 1', 'V 4 2 1', 'H 3 2 1', 'H 3 3 1'],
  map: [
    '##########',
    '#........#',
    '#.@M.....#',
    '#........#',
    '#.......>#',
    '##########',
  ],
};

// Open floor, the Manager across the room: a clean read on WHERE a walk-up
// stops. It must stop at the verb's own reach - not march to the target's
// elbow - and on the line it actually walked, not offset onto the
// target -> goal-tile line.
const APPROACH_LAB = {
  name: 'Approach Lab',
  tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '############',
    '#..........#',
    '#.@......M.#',
    '#..........#',
    '#.........>#',
    '############',
  ],
};

// A three-edge partition strip between the two: the swing from the player's
// own tile is line-blocked, but the tiles on the Manager's open side are
// legal - the click should route around and land the hit.
const STRIP = {
  name: 'Partition Strip Floor',
  tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
  actors: { '@': 'player', M: 'manager' },
  walls: ['V 3 1 3'],
  map: [
    '##########',
    '#........#',
    '#.@M.....#',
    '#........#',
    '#.......>#',
    '##########',
  ],
};

// Nobody moves at boot and the combat trigger only runs on movement - start a
// short walk; adjacency does the rest the moment anyone stirs.
async function nudgeIntoCombat(page) {
  expect(await clickWorld(page, 2, 1)).toBe(true);
  await page.waitForFunction(() => window.__game.inCombat && window.__combat, null, { timeout: 30_000 });
  await waitForPlayerTurn(page);
}

// Wait out any in-progress walk (and the strike that may follow its arrival).
async function settled(page, timeout = 30_000) {
  await expect.poll(
    () => page.evaluate(() => window.__game.playerMoving),
    { timeout },
  ).toBe(false);
  await page.waitForTimeout(700); // arrival strikes resolve a beat later
}

// Click the Manager's body, retrying past the click gates (mid-walk, AI
// turn). Returns what the click resolved to (`lastClickOutcome`).
async function clickFoe(page) {
  let out = null;
  for (let i = 0; i < 6; i++) {
    const en = (await page.evaluate(() => window.__game.enemies))[0];
    // Ground-point projection: the pixel at the body's feet resolves through
    // enemyAtPoint (d ~ 0) even when the mesh ray misses under software GL;
    // a chest-height pixel's ground fallback lands ~0.7 tiles of parallax
    // behind them and walks instead.
    const p = await page.evaluate(([x, z]) => window.__game.project(x, z), [en.px ?? en.x, en.pz ?? en.z]);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(600);
    out = await page.evaluate(() => window.__combat?.lastClickOutcome);
    if (out && !String(out).startsWith('gate:')) break;
    await settled(page);
  }
  return out;
}

test('a coworker no swing can reach refuses honestly, not with an AP excuse', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, SEALED);
  await nudgeIntoCombat(page);
  await settled(page);

  const before = await page.evaluate(() => ({
    ap: window.__combat.party[0].ap, pos: window.__game.playerPos,
  }));
  const out = await clickFoe(page);
  await settled(page);
  const after = await page.evaluate(() => ({
    ap: window.__combat.party[0].ap, pos: window.__game.playerPos,
  }));
  expect(out).toBe('refused:No way to get a swing at them.');
  expect(after.ap).toBe(before.ap); // the refusal was free
  expect(Math.hypot(after.pos.x - before.pos.x, after.pos.z - before.pos.z)).toBeLessThan(0.05);

  // The hover says the same thing the click does - the preview IS the click.
  const en = (await page.evaluate(() => window.__game.enemies))[0];
  const fp = await page.evaluate(([x, z]) => window.__game.project(x, z), [en.px ?? en.x, en.pz ?? en.z]);
  await page.mouse.move(fp.x, fp.y);
  await expect(page.locator('#combat-move-cost')).toContainText('No way to get a swing', { timeout: 10_000 });
});

test('a swing blocked from here walks around the partition and lands', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, STRIP);
  await nudgeIntoCombat(page);
  await page.evaluate(() => { window.__combat.forceHit = true; }); // the pin persists across turns

  // While the Manager still waits on his spawn tile, hovering him previews
  // the walk-in commitment: odds plus the total price after the walk.
  const en = (await page.evaluate(() => window.__game.enemies))[0];
  if (en.x === 3 && en.z === 2 && !(await page.evaluate(() => window.__game.playerMoving))) {
    const fp = await page.evaluate(([x, z]) => window.__game.project(x, z), [en.px ?? en.x, en.pz ?? en.z]);
    await page.mouse.move(fp.x, fp.y);
    await expect(page.locator('#combat-move-cost')).toContainText('% to hit', { timeout: 10_000 });
  }

  // A Manager turn can gum the walker (move costs double), turning the detour
  // into a legitimate two-turn approach - so play it like a player would:
  // click, let the walk spend the turn, end it, click again on the next.
  const hp0 = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive)?.hp);
  let hp = hp0;
  for (let round = 0; round < 4 && !(hp < hp0); round++) {
    const out = await clickFoe(page);
    await settled(page, 45_000);
    hp = await page.evaluate(() => window.__combat?.enemies.find((e) => e.alive)?.hp);
    console.log(`round ${round}: click=${out} hp=${hp}`);
    if (hp < hp0) break;
    await page.click('#combat-end-turn');
    await waitForPlayerTurn(page);
  }
  expect(hp).toBeLessThan(hp0);
});

test('a walk-up stops at reach, on the line it walked', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, APPROACH_LAB);
  await enterCombat(page);
  await waitForPlayerTurn(page);

  // Stage the geometry rather than hoping for it: both bodies on row z=2 with
  // a five-tile gap, so the approach line is unambiguous and the walk is long
  // enough that overshooting would be obvious. (enterCombat necessarily walks
  // the player up; this puts them back.)
  const setup = await page.evaluate(() => {
    const place = (a, x, z) => {
      const y = a.entity.getPosition().y;
      a.path = null;
      a.slideTo = null;
      a.entity.setPosition(x, y, z);
      a.x = Math.round(x);
      a.z = Math.round(z);
    };
    const foe = window.__god.enemies.find((e) => e.alive);
    place(foe, 9, 2);
    place(window.__god.playerActor, 4, 2);
    window.__combat.refresh();
    return { from: { x: 4, z: 2 }, foe: { x: 9, z: 2 } };
  });
  await refillAp(page);
  await page.waitForTimeout(400);
  await settled(page);

  const { from, foe } = setup;
  await clickFoe(page);
  await settled(page, 45_000);
  const at = await page.evaluate(() => window.__game.playerPos);
  const foeNow = await page.evaluate(() => {
    const e = window.__game.enemies.find((f) => f.alive);
    return e ? { x: e.px ?? e.x, z: e.pz ?? e.z } : null;
  });
  // The fight can end on arrival (the strike lands) - the stop point is still
  // what's under test, so read the body's last known spot either way.
  const target = foeNow || foe;
  const gap = Math.hypot(at.x - target.x, at.z - target.z);

  // Stopped INSIDE bare-hands reach (stats REACH.DEFAULT is 1.5)...
  expect(gap).toBeLessThanOrEqual(1.5 + 0.05);
  // ...and did not keep closing after the swing was already on. The old
  // approach point walked to 0.85 of the body - a half-tile past the point the
  // verb was live, which is what "much closer than needed" was.
  expect(gap, 'kept closing past the reach the swing needed').toBeGreaterThan(1.0);

  // ON the line it walked: the stop point sits near the segment from where the
  // walk started to the target, rather than offset around the target onto a
  // goal tile's own approach line.
  const vx = target.x - from.x;
  const vz = target.z - from.z;
  const len2 = vx * vx + vz * vz;
  const t = ((at.x - from.x) * vx + (at.z - from.z) * vz) / len2;
  const offLine = Math.hypot(at.x - (from.x + vx * t), at.z - (from.z + vz * t));
  expect(offLine, 'stopped off to the side of the approach line').toBeLessThan(0.5);
});
